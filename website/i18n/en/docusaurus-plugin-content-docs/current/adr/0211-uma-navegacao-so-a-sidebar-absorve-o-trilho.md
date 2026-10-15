---
traducao_de: 4069e0dabf04a99d889663c95b89b6daba1a5904
---

# ADR 0211 — A single navigation: the sidebar absorbs the project rail

## Status

**Accepted.** 2026-10-03 (AT-404; owner decision on 03/10: "The expandable
navigation bar on the left becomes the ONLY one; remove the other navigation bar,
but include in this one all items of the removed bar"). Revises
[ADR 0126](0126-trilho-vertical-de-navegacao-do-projeto.md) — which stays
accepted and is not edited — and
[RN-201](../business-rules/autenticacao.md#rn-201).

## Context

Since ADR 0126 the project tabs existed in TWO places: the 180px vertical rail
(`ProjectRail.tsx`, mounted in `ProjectPage.tsx`) and the sidebar's per-project
list (`LinhaDeAba`, [RN-196](../business-rules/autenticacao.md#rn-196)).
CLAUDE.md declared this as a gap ("reconciling is a separate product decision"),
along with the frame's price: 492px on the Code tab (264 of the sidebar + 180 of
the rail + 48 of the `CodeShell`).

Measured before changing, what only the rail had: the three GROUPS with a
heading; the ACTIVE tab marked (`aria-selected`); the five counters (Insights,
PRs, Approvals, Backlog, Architecture), each on its tab and never summed — the
sidebar showed only Approvals, from the dashboard summary; the keyboard
(`ArrowDown`/`ArrowUp`/`Home`/`End` with wrap-around, crossing groups); the
active one scrolled into view; the vertical `role="tablist"`; and, on the phone
([RN-643](../business-rules.md#rn-643)), the scrollable horizontal bar above the
panel. The sidebar had, and the rail did not: the project collapsed in the 62px
rail, the phone drawer and the link to another browser window.

## Decision

1. **The sidebar is the project's only navigation.** `ProjectRail.tsx`, its CSS
   and its mounting in `ProjectPage.tsx` go. The project list in the sidebar
   becomes `AbasDoProjeto` (`apps/web/src/routes/AbasDoProjeto.tsx`), with
   everything the rail had: groups from `GRUPOS_DO_PROJETO`, active tab,
   per-tab counters, keyboard, a vertical `tablist` named by the project, roving
   tabindex and the active one scrolled into view. Each tab is a link to
   `/projects/<id>?tab=<chave>`.
2. **The five counters have the SAME source, with no new request.** The five
   queues are now read by a single hook, `useContagensDoProjeto`
   (`apps/web/src/lib/contagens-do-projeto.ts`), which the frame uses for the
   "needs you" panel ([RN-467](../business-rules.md#rn-467)) and the sidebar uses
   for the numbers. Same `queryKey`s, deduplicated. The sidebar only turns it on
   while the project frame is MOUNTED — that was the only place the rail
   existed; on another project screen (the Session, for example) and on closed
   projects the Approvals number from the summary stays, as before. The
   `*.orcamento.test.tsx` budgets pass without changing any ceiling.
3. **The active tab comes from the frame.** `ProjectPage` publishes the tab it
   shows (`publicarAbaAtiva`) — the URL is not enough, because the "needs you"
   panel switches tabs without going through the router. The sidebar ASKS the
   frame for the clicked tab (`pedirAba`, an event and not state, so two frames
   never pull each other) and navigates with `?tab=`. The project link without
   `?tab=` goes back to the default tab.
4. **Collapsed, a flyout.** In the 62px rail, the OPEN project's square opens a
   flyout with the same tabs (closes on Esc, on choosing and on the second
   click), without expanding the sidebar. The other projects still expand.
5. **On the phone, the drawer.** RN-643's horizontal bar goes; the tabs live in
   the drawer, which closes when one is chosen.
6. **The `CodeShell`'s 48px rail stays:** it is the editor's activity, not
   project navigation.

## Consequences

- The Code tab's frame drops from 492px to **312px** with the sidebar expanded
  (264 + 48) and to **110px** collapsed (62 + 48).
- The gap "the tabs exist in two places" closes.
- Switching tabs requires the expanded sidebar, the flyout or the drawer. Whoever
  collapsed the sidebar and navigated through the rail now uses the flyout.
- The sidebar list loses the router's `<Link>` per tab: it is an `<a>` with the
  click intercepted, calling `navigate`. Middle button/Ctrl still open in another
  window.
- `rail.ariaLabel` leaves both languages; the list is named by
  `sidebar.projects.tabsAriaLabel` ("Abas de {{name}}").

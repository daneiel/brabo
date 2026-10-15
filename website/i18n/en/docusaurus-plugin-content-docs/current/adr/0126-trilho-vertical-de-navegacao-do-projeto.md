# ADR 0126 — The project page navigates by a vertical rail, and the Code tab stops auto-collapsing the sidebar

- **Status:** accepted
- **Date:** 2026-08-30
- **References (without editing):**
  [ADR 0078](0078-moldura-de-tela-e-o-registro-de-abas-diverge-do-handoff.md)
  (the screen frame and the tab registry — it moved the tab strip's spacing
  into the `Tabs` primitive, which this ADR now retires from the project
  page), [ADR 0074](0074-tema-alcancavel-e-o-boot-sob-csp.md) (the contrast
  debt that keeps the counter badge solid instead of tinted),
  [ADR 0125](0125-projectsettingstab-dividido-por-secao.md) (PR 0 of the same
  accepted 8-PR effort this is PR 1 of).
- **Revises:** [RN-201](../business-rules/autenticacao.md#rn-201) — the
  auto-collapse half is removed; the `brabo.project`/`brabo.tab` persistence
  half is untouched.

## Context

The project page has **12 tabs in 3 groups plus 3 loose tabs**
(`apps/web/src/routes/project-tabs.ts`), rendered by a two-level horizontal
strip (`components/ui/GroupedTabs.tsx` over the `Tabs` primitive). A design
review of the product's UI ranked "replace the tab strip with a rail" first.

**Two of that review's three justifications were factually wrong, and are
recorded here so nobody re-litigates them:**

1. *"The second level opens on top of the content."* False. It is an inline
   row below the top row — `GroupedTabs.tsx:143`, a sibling `<div>` inside
   the same column wrapper. Nothing ever overlaid anything.
2. *"The counter disappears when the group is closed."* False. A closed
   group summed its children's counters and showed the total —
   `somarContagens`, `GroupedTabs.tsx:33`, covered by
   `GroupedTabs.test.tsx:141`.

**The surviving argument is the only rationale for this change: 12 items in
a horizontal bar does not scale.** The strip was designed for the handoff's
~6 tabs; grouping bought room by hiding 9 of the 12 behind a click, which is
a compression, not a fit. On a narrow window the top row already scrolled
horizontally (`Tabs.module.css`, `overflow-x: auto`).

A third claim of the review — that the five counters should be summed into
group totals — is **rejected here as it was rejected before**: the five
queues (insights, PRs, approvals, backlog, architecture) stay separate,
because summing them hides *which* queue is asking for attention. That is a
standing product decision, already written into `ContagensDeAba`'s doc
comment and into `ProjectPage.tsx`.

## Decision

`GroupedTabs` is replaced by `apps/web/src/routes/ProjectRail.tsx`, a
vertical rail sitting between the project header and the tab panel.

### The three groups are open at the same time

That is what the change buys, and it is why a group header stopped being a
selectable button and became a **heading**. There is no "open group" state
left, and therefore no "last child visited per group" memory
(`ultimaFilhaPorGrupo`) either — a deep link into a group tab now needs no
plumbing at all to reveal it, because it was never hidden.

Group headers reuse the existing i18n keys `groups.*.label` and tab labels
reuse `tabs.*.label`, both in the `nav` namespace. **`project-tabs.ts` does
not change**: it was already the single source of the structure, and the
rail consumes the same `GRUPOS_DO_PROJETO` the strip did. (Its known
asymmetry — registry key `arquitetura` mapping to i18n key
`tabs.architecture.label` — is left exactly as it is.)

### Geometry borrowed from `CodeShell`'s rail, not from `Shell`'s

`routes/code/CodeShell.module.css` (`.rail`/`.railItem`/`.railItemAtivo`) is
**the only rail in the repository with an active state drawn**: a
`--surface-1` band with a right divider, a 32px item at `--radius-sm`, and
the active item tinted `color-mix(in srgb, var(--accent) 12%, transparent)`
over `--accent` text. The sidebar's `.trilha` (`Shell.tsx:444-477`) could
not be the model: it has no active item and no keyboard navigation, so it
answers neither question this component has to answer.

**One divergence, declared:** the width. `CodeShell`'s rail is 48px because
it is icon-only. This one is 180px because it carries tab *labels* and group
*headings* — which is the whole mechanism by which three groups stay open.
Everything else (band surface, divider, item height, radius, active tint,
hover, `:focus-visible` ring) is the same treatment.

The counter badge stays **solid** `--accent`/`--on-accent`, not the
handoff's 18% tint. That divergence is deliberate and already recorded in
`design/SCREENS.md`: the tinted pair falls inside the contrast debt (3.88:1)
and this is 10px text.

### The keyboard contract is ported, not dropped

`GroupedTabs.onKeyDownDaLinha` (`GroupedTabs.tsx:49-71`) handled
`ArrowRight`/`ArrowLeft`/`Home`/`End` with wrap, and two of its seven test
cases covered it (`GroupedTabs.test.tsx:102,124`). Deleting tested
accessibility without replacing it is a regression, not a refactor, so the
same contract reappears on the rail with the axis swapped:
`ArrowDown`/`ArrowUp`/`Home`/`End`, wrapping, selecting as it moves
(automatic activation, the same as before).

The implementation is better than what it replaces. `GroupedTabs`
correlated **positionally**, querying `[role="tab"]` out of the DOM, because
the `Tabs` primitive exposed no refs. The rail owns its buttons, so a
`Map` of refs keyed by tab key gives the correlation without consulting the
document. Arrow keys traverse the whole flattened list, crossing group
boundaries — in a rail there is no "outer row" and "inner row" to separate.

ARIA: the rail is `role="tablist"` with `aria-orientation="vertical"`; the
group wrappers and their headings are `role="presentation"`, which keeps all
12 tabs as direct owned elements of the tablist while grouping them
visually.

### `GroupedTabs` is deleted; `Tabs` stays

Both were single-use — `GroupedTabs` only by `ProjectPage`, `Tabs` only by
`GroupedTabs` — but they are not the same kind of thing, and the deciding
evidence is `ds-bundle/`, the design system generated **from this app**
(`.ds-build-meta.json`: `source: web@0.1.0`, 66 components, namespace
`BraboDS`):

- **`Tabs` is in it**, as `components/primitivas/Tabs` — three entries in
  `_ds_sync.json` (`.jsx`, `.d.ts`, `.prompt.md`) and a story in
  `.stories-map.json`. Deleting it would shrink the design system as a side
  effect of one screen's layout change. A generic primitive with no current
  consumer is stock, not dead code. It stays, with a comment saying why.
- **`GroupedTabs` is not in it** — zero hits anywhere under `ds-bundle/`.
  It was project-page-specific composition over the primitive, with exactly
  one caller, and it goes, together with its stylesheet and
  `GroupedTabs.test.tsx`.

## Consequences

### RN-201 loses its auto-collapse half

The Code tab force-collapsed the Shell sidebar through `AutoCollapseContext`
/ `useAutoCollapseSidebar` (`apps/web/src/lib/sidebar-state.ts`), registered
by `ProjectCodeTab.tsx` — the only caller — and OR-ed into the Shell's
collapse at `Shell.tsx:369-371,412`. **All of it is removed**: the context,
the hook, the `autoColapsado` state, the `Provider` around `<Outlet />`, the
`disabled` state of the collapse button that existed only to protect the
auto path, and the `sidebar.collapseButton.autoCollapsed` string in both
locales.

The reason is structural: with a project rail always present, keeping
auto-collapse would put the Shell's `.trilha` icon rail immediately beside
the new project rail — two adjacent vertical rails, permanently, on the
heaviest tab in the product.

**The cost is real and was reviewed and accepted before this was written.**
Measured in the browser, not estimated: the Code tab now renders with the
Shell sidebar **expanded** (264px) + the project rail (180px) +
`CodeShell`'s own rail (48px) = **492px of chrome before the first character
of code, against ~110px before** (62px collapsed sidebar + 48px code rail).
That is a loss of editor width, and it is the price being paid.

What is bought: auto-collapse was the *system* deciding for the user;
manual collapse is the *user* deciding. Removing the system's decision while
honoring the user's is the trade. Manual collapse still works and still
persists in `brabo.sidebar.collapsed`.

**The double rail is not gone — it is relocated to a user-chosen state.**
Collapsing manually still produces the Shell's icon rail beside the project
rail. The difference is who chose it. Saying otherwise would be pretending.

RN-201 is rewritten in place, keeping its number and its `{#rn-201}` anchor
(anchors are the contract). Its `brabo.project`/`brabo.tab` persistence half
is untouched.

### Tab navigation now exists in two places — and already did

`Shell.tsx` renders its own per-project tab list in the sidebar
(`LinhaDeAba`, RN-196), reading the same `ABAS_DO_PROJETO`. With the rail,
the project page shows those same 12 tabs a second time, a few hundred
pixels to the right. **This is pre-existing, not introduced here** — the
horizontal strip duplicated the sidebar list in exactly the same way — but
the rail makes the duplication visually parallel (two vertical lists of the
same 12 labels) where before it was a row against a column. Reconciling the
two is a separate product decision and is not taken here.

### Tests

- `GroupedTabs.test.tsx` (7 cases) is deleted with its component. Its two
  keyboard cases reappear as five on the rail (`ProjectRail.test.tsx`,
  17 cases: groups open together, the tablist's vertical orientation and
  12 owned tabs, active marking, deep link, the five separate counters with
  no group sum, a counter-less tab showing no badge, and
  ArrowDown/ArrowUp/Home/End with wrap in both directions).
- **Two cases in `apps/web/src/routes/project-tabs.test.tsx` were rewritten
  rather than left**, and this is the one place this change edits a test
  that was meant to survive. Both asserted the *dying component's* contract
  through `ProjectPage`, not the registry:
  - `'a régua de TOPO mostra os grupos e as abas soltas … nunca as 12 chaves
    achatadas'` asserted that **exactly 6** elements had `role="tab"`. The
    rail's entire purpose is that all 12 do. Rewritten to assert the same
    declared order, flattened, plus that the three group headings exist and
    that none of them is a tab.
  - `'o selo do GRUPO é a SOMA dos selos das filhas'` asserted a summed
    group badge. There is no closed group left to summarize, and summing is
    the thing this product deliberately does not do. Rewritten to assert
    that each queue keeps its own badge and that no group heading carries a
    number.

  Every other case in that file, and all four in `ProjectPage.test.tsx`,
  all of `Shell.test.tsx`, and the `'projeto e aba ativos'` describe in
  `sidebar-state.test.ts`, pass **unedited**. The `useAutoCollapseSidebar`
  describe in `sidebar-state.test.ts` is deleted because the hook is.
- Full web suite green: 142 files, 1 540 tests.

## Discarded alternatives

- **A 48px icon-only rail, literally mirroring `CodeShell`.** Rejected: 12
  tabs would need 12 distinct icons that do not exist, and the three group
  headings — the mechanism that makes simultaneous groups readable — have no
  icon form at all. The result would be a row of unlabeled squares needing a
  tooltip each, which is worse than the strip it replaces.
- **Keeping `GroupedTabs` and making it vertical.** Rejected: what would
  survive is its top-level/second-level split, and that split is exactly
  what is being removed. The remaining code — the DOM-positional keyboard
  handler, `somarContagens`, `ultimaFilhaPorGrupo` — is all machinery for
  hiding children.
- **Keeping auto-collapse and letting the two rails sit adjacent.**
  Rejected: it hands the user a permanent, system-imposed double rail on the
  tab where horizontal space matters most, and the user cannot undo it (the
  collapse button was disabled precisely while auto-collapse was on).
- **Deleting `Tabs` too, since it now has no caller.** Rejected on evidence:
  it is a published design-system primitive, and one screen's layout change
  is not a reason to change the DS inventory.

---
id: auditoria-visual-rodada-29
title: Visual audit, before and after Rodada 29
description: AT-290's screen audit — the main routes captured in both themes at 1440 px and 390 px, the layout checker run on every screen, and what Rodada 29 fixed, what persists and what is new, measured on 2026-09-30 against dev at 79e6b1209f.
---

# Visual audit, before and after Rodada 29

> AT-290 (EP-031, HS-074). A **measurement, not a change**: nothing in `apps/`
> was touched to write this page. The "before" capture ran on 2026-09-30
> against `dev` at `de18e6a6e2`; the "after" capture ran the same day against
> `dev` at `79e6b1209f`, which already carries all of Rodada 29 — the neutral
> black theme with the soft terracotta accent (AT-283/284), `Card`/`Chip`/
> `Badge`/`Button` (AT-286..288), the mobile shell (AT-316), the session bar
> (AT-317), the thread cut (AT-319), the approvals fixes (AT-296..299, AT-310,
> AT-318, AT-320), the Settings budget (AT-321), the PRs and Containers texts
> (AT-323, AT-324), and the i18n pass (AT-289, AT-326).
>
> The screenshots are **not** in the repository. Every finding cites the
> capture file name so whoever holds the capture folder can open it; every
> finding that the checker measured also cites the number.

## How the product was brought up (and what that does not cover)

The task asks for the production compose through `docker/smoke.sh` with
`SMOKE_KEEP_UP=1`. It was tried, on a throwaway compose project
(`COMPOSE_PROJECT_NAME=r30visual`), and it **fails in this environment** for
the same reason the "before" run recorded: the egress proxy blocks
`dl-cdn.alpinelinux.org` (and `repo.hex.pm`/`builds.hex.pm`), so the first
`apk add --no-cache build-base git` of `docker/engine/Dockerfile.prod` exits 2
and no production image builds. The throwaway project was removed with
`down -v`.

So the "after" ran on the **same stand-in the "before" used**, on purpose — a
different stack would make the comparison measure the stack:

- **Postgres**: `pgvector/pgvector:pg16` in a container, the api migrations and
  `pnpm seed` (the seed ran cleanly on a fresh database).
- **api**: `node dist/main` built from this checkout, port 3000.
- **engine**: an HTTP stub on port 4000 that answers 200 to everything. No
  Phoenix channel, no `engine.*` schema.
- **web**: `vite` dev server on port 5173.
- **data**: the seed plus the same scripted population the "before" used — a
  creative session with conversation, brief, business rule, a Criativo→PO
  handoff, epic/story/task and a `module_map`; a second creative session with a
  realistic thread and an `agent.error`; and **4 pending `proposed_actions` in
  3 sessions** (3 `terminal`, 1 `git_push`), the same shape as before.

Consequences for reading this page:

- The session socket always fails, so the turn's activity strip and the Code
  terminal never render, and sessions poll on the fallback interval.
- `GET /workspaces/:id/projects-summary` answers 500 because
  `engine.dev_agent_states` does not exist — an artifact of the stub, as in the
  "before". "0 agentes" on the Dashboard is not a finding.
- The data is **not identical** to the "before": the seed now activates its own
  session, the Criativo→PO offer was superseded when the PO's backlog events
  arrived (AT-291/292), and the most recent session is a consultative one. Where
  a "before" finding depends on data that no longer exists, it is marked **not
  re-verified** instead of "fixed".
- The captures are `fullPage`, but most screens scroll inside an inner
  container, so they show the viewport. Targeted crops (`detalhe-*`) cover what
  the full captures cannot.

The capture was **paced** — 6 s between screens and 65 s between theme/viewport
passes — and recorded zero 429 responses. The "before" was not paced, so its
Settings captures were partly taken under the rate limit; the rate limit is
measured separately below (G1).

## Files

Kept outside the repository, in the session scratchpad (`shots-depois/`):

- `<screen>--<dark|light>--<desktop|mobile>.png`: 19 screens (login, dashboard,
  the 12 project tabs, two sessions, `/containers`, `/account`, `/status`) × 2
  themes × 2 viewports (1440×900 and 390×844) = 76 captures.
- `detalhe-*`: the session at 1280 and 1024, the top of the thread, the
  collapsed side-sessions panel, the end of a session, "Precisa de você", the
  mobile drawer in both themes, the 11 Settings sections and the last section
  reached under the rate limit.
- `validacao-visual.json`: the output of `scripts/dev/validacao-visual.js`
  injected in each capture, plus the theme actually applied (`data-theme`), the
  page's horizontal scroll width, the requests to the api during the load and
  the 429s.
- `console-erros.json`, `sondas-dark.json`, `g1.json`, `g1-cliques.json`: the
  console errors and the DOM probes quoted below.

The capture scripts (`capturar-depois.mjs`, `detalhes-depois.mjs`, `g1.mjs`,
`g1-cliques.mjs`, `gaveta.mjs`) are the "before" scripts with the pacing and
the probes added.

## The checker, screen by screen

`validacao-visual.js` counts four kinds of layout defect (`texto-cortado`,
`fora-da-viewport`, `recortado-por-ancestral`, `alvo-pequeno` under 24 px). The
numbers are the same in both themes on every screen, before and after, so one
column per viewport is enough. The "before" mobile numbers are **not directly
comparable**: before AT-316 most content was pushed off-screen, and what the
checker cannot see it does not count.

| screen | desktop before → after | mobile before → after | api requests per load (after) |
|---|---|---|---|
| login | 6 → 6 | 8 → 8 | — |
| dashboard | 0 → 0 | 1 → 0 | 6 |
| overview | 3 → 1 | 12 → 2 | 32 |
| executors | 0 → 0 | 4 → 0 | 22 |
| creative | 0 → 0 | 7 → 3 | 20 |
| chat | 0 → 0 | 5 → 1 | 16 |
| insights | 0 → 0 | 4 → 0 | 17 |
| code | 0 → 0 | 2 → 0 | 16 |
| PRs | 0 → 0 | 5 → 1 | 18 |
| approvals | 1 → 1 | 13 → 1 | 23 |
| backlog | 0 → 0 | 5 → 2 | 16 |
| architecture | 0 → 0 | 11 → 0 | 15 |
| spend | 0 → 0 | 9 → 0 | 18 |
| settings | 12 → 6 | 120 → 35 | 52 |
| session | 5 → 2 | 14 → 21 | 21 |
| session 2 | 4 → 1 | 21 → 19 | 21 |
| containers | 1 → 1 | 9 → 8 | 7 |
| account | 0 → 0 | 6 → 2 | 7 |
| status | 1 → 1 | 1 → 1 | 2 |

Only one screen scrolls the whole page sideways at 390 px: `/status`
(`scrollWidth` 413 against 390, both themes).

## The "before" findings, one by one

Severity as in the "before": **A** high (breaks use or misleads), **M**
medium, **B** low (polish). Status: **fixed**, **partial**, **persists**, or
**not re-verified** (the data that showed it no longer exists).

### Shell and navigation

| # | Sev | Status | What the "after" shows | Evidence |
|---|---|---|---|---|
| S1 | A | partial | The shell reflows at 390 px: the sidebar becomes a drawer, the project rail a horizontal strip, and no authenticated screen but `/status` scrolls sideways. The **session** route did not follow — see N1. | `*--mobile.png`, `detalhe-gaveta-mobile--*.png` |
| S2 | M | persists | Sidebar "ATIVIDADES — Nenhum agente entrou em ação ainda." next to an Overview with the Criativo "aguardando" and 4 pending approvals. | `projeto-overview--dark--desktop.png` |
| S3 | M | persists | The sidebar tab list has no counters and does not mark the current tab; the rail shows "Aprovações 4" and "Arquitetura 1" and highlights the tab. | idem |
| S4 | M | fixed | One active treatment now: terracotta tint with terracotta text on the rail; the sidebar project row is neutral. | idem |
| S5 | B | persists | The theme toggle still reads the state ("Tema escuro"/"Tema claro"); "sair" still lower-case. | any authenticated screen |
| S6 | B | persists | Project name in mono in the sidebar and in display type in the header. | idem |

### Login, Dashboard

| # | Sev | Status | What the "after" shows | Evidence |
|---|---|---|---|---|
| L1 | B | persists | The same 4 targets under 24 px. | `validacao-visual.json`, `login--*` |
| L2 | B | persists | The same text clipped by its box. | idem |
| D1 | M | persists | "0 / 0 USD" and "0%" in green on a project without a budget. | `dashboard--dark--desktop.png` |
| D2 | M | persists | "Sem atividade ainda" on a project with 4 sessions and dozens of events (partly the stub's 500, see the top). | idem |
| D3 | B | persists | "+ Novo projeto" with an icon; "+ Nova ideação" and "+ Nova conversa" with a literal "+". | dashboard × creative × chat |

### Overview

| # | Sev | Status | What the "after" shows | Evidence |
|---|---|---|---|---|
| O1 | M | not re-verified | The feed only shows the latest (consultative) session, which has no PO/Arquiteto events. | `projeto-overview--*` |
| O2 | M | persists | Longer now: "dev-web: ação aguardando decisão — A política decidiu por: default (sem regra aplicável) · raiz do escopo: pasta gerenciada “core-api-665191a6”". | idem |
| O3 | B | not re-verified | The team timeline is empty with this data. | idem |
| O4 | B | partial | The per-origin footers are gone ("1 de 1 carregados"), but the header reads "1 eventos" — see N9. | idem |

### Creative, Chat, Insights, Executors

| # | Sev | Status | What the "after" shows | Evidence |
|---|---|---|---|---|
| C1 | M | persists | Mono pills in Criativo and Chat, rectangular sans tabs in PRs. | `projeto-criativo--*`, `projeto-chat--*`, `projeto-prs--*` |
| C2 | B | partial | "1 história" now pluralizes; "3 ação(ões) proposta(s) … 0 decidida(s) … auto-aprovada(s)" and "0 chamada(s)" remain (`sessions.json:164,172,173`, `spend.json:20,37`). | creative, chat, spend |
| C3 | B | not re-verified | The seed session is now `active`, so the double "aguardando" does not appear. | creative |
| C4 | B | persists | Four empty-state shapes (plain text in Insights, lock card in Code, none in Chat, a red card in the Backlog's traceability). | tabs |
| C5 | B | persists | Percepções and Arquitetura start their title at y≈145, the other tabs at y≈116; Histórias has only the eyebrow. | `projeto-insights--*`, `projeto-arquitetura--*`, `projeto-backlog--*` |
| C6 | B | persists | "Conversar/Buscar" above the "Chat" title. | `projeto-chat--*` |

### Code and PRs

| # | Sev | Status | What the "after" shows | Evidence |
|---|---|---|---|---|
| P1 | M | fixed | PRs says "A lista de PRs ainda não está liberada" and explains the shared gate; Code says "A aba Código ainda não está liberada". | `projeto-prs--*`, `projeto-code--*` |
| P2 | B | persists | The "Já sabe o id?" rule still touches the bottom of the gate card. | `projeto-prs--dark--desktop.png` |

### Approvals

| # | Sev | Status | What the "after" shows | Evidence |
|---|---|---|---|---|
| A1 | A | fixed | The rail, the Approvals tab and "Precisa de você" show **4**, the database's number, including the `git_push` from another session; the side-sessions panel in a session shows the 3 that belong to the others. | `projeto-approvals--*`, `detalhe-precisa-de-voce--dark.png`, `detalhe-sessao2-topo--dark.png` |
| A2 | A | fixed | The `git_push` card offers Aprovar/Negar/Modo automático, no "Sempre permitir". | `projeto-approvals--*` |
| A3 | M | persists | Still several variants: 4 buttons plus a long mono note in the tab, 3 buttons and no note in "Precisa de você", 3 stretched buttons in the side-sessions panel. The "Sempre permitir" note still says two things: "grava a regra em .brabo/permissions.json" in the thread and "libera este tipo de ação só para dev-api" in the panel. | `detalhe-sessao2-topo--dark.png`, `detalhe-precisa-de-voce--dark.png` |
| A4 | B | persists | The ⚠ glyph is still ~8 px and the mono paragraph outweighs the decision. | `projeto-approvals--*` |
| A5 | B | persists | The command still appears between straight quotes in the proportional font. | idem |

### Session

| # | Sev | Status | What the "after" shows | Evidence |
|---|---|---|---|---|
| X1 | A | fixed | At 1440, 1280 and 1024 the bar fits: the model and the answer language became one chip, the title and the meta are whole, "Encerrar" turns into an icon at 1024. The only clip left is the chip's own ellipsis ("… · pt…", 230 px in 217). | `sessao*--*--desktop.png`, `detalhe-sessao-1280--dark.png`, `detalhe-sessao-1024--dark.png`, `sondas-dark.json` |
| X2 | A | partial | The panel now has the thread's width (x 302–1082), groups proposals per session ("2 propostas na sessão #cde43f7c") and no longer repeats the label. It is still a fixed block of **345 of 900 px** above the composer, and the item behind it shows through its top border (y≈387). | `detalhe-sessao2-topo--dark.png`, `detalhe-sessao-fim--dark.png`, `sondas-dark.json` |
| X3 | A | fixed | No origin groups; the thread reads question → answer in order. | `detalhe-sessao2-topo--dark.png` (`grupos: []` in `sondas-dark.json`) |
| X4 | M | partial | The handoff card is not in this data (the offer was superseded), but the composer still says "Endereçar handoff". | `sessao*--*` |
| X5 | M | not re-verified | No handoff card to compare widths with. | — |
| X6 | M | persists | "ARTEFATOS GERADOS 3" lists one group ("PO 1"); in the second session the brief exists and the panel says "0 · Nada ainda". | `sessao--*`, `sessao2--*` |
| X7 | B | partial | "ORIGEM: 0 REF(S)" became "ORIGEM: 0 REFERÊNCIA" — no jargon, wrong number; see N9. | `sessao2--*` |
| X8 | B | persists | The same session opened at different scroll positions in the two themes. | `sessao2--dark--desktop.png` × `sessao2--light--desktop.png` |

### /containers, /account, /status

| # | Sev | Status | What the "after" shows | Evidence |
|---|---|---|---|---|
| K1 | M | fixed | "Parar" and "Remover" are `disabled` (opacity 0.5) and the row says "Nunca provisionado: não há container para parar nem remover". | `containers--*--desktop.png`, `sondas-dark.json` |
| K2 | M | fixed | The broker reason is one line with a "Por quê?" disclosure; no `BROKER_URL` in the UI. | idem |
| K3 | B | persists | Project link 53×14 px. | `validacao-visual.json` |
| U1 | M | fixed | The "only this page is translated" sentence is gone. | `account--*` |
| U2 | B | fixed | No RN number in the subtitles ("Agente local"); the long paragraph before the table stays. | idem |
| T1 | B | persists | Raw ISO timestamp, "Último check", "—" for the engine, and "Voltar" as a small link. At 390 px the page also overflows — see N5. | `status--*` |

### Settings

| # | Sev | Status | What the "after" shows | Evidence |
|---|---|---|---|---|
| G1 | A | partial | The screen's own path is fixed: one load (52 requests) plus clicking the 11 entries of "Nesta página" costs **18** more requests in 28 s, no 429. Reloading by deep link (`?section=`) still costs **52 per load** (55 before): the sixth reload inside 16 s tripped the limit and the page showed "Limite de requisições excedido" (`g1.json`: 362 requests, 51 × 429 in 30 s). | `g1-cliques.json`, `g1.json`, `detalhe-g1-ultima-secao--dark.png` |
| G2 | M | partial | The four columns are gone: "Nesta página" lies above the sections. "Modelos por agente" still clips the agent name ("QA de Performance e Segurança", 201 px in 119) and the model (173 in 143). On mobile the table collapses — see N4. | `projeto-settings--*--desktop.png`, `validacao-visual.json` |
| G3 | M | partial | "Tarefas bloqueadas seguidas até parar" replaced "Tasks blocked"; "dev agent(s)", "bind-mount", "permissions.json" and "runner" remain in the Execution and "Onde o código mora" sections. | `projeto-settings--*--desktop.png` |
| G4 | M | persists | "Salvar" in Execução is active (terracotta) with nothing pending and no count; "Converter" is inert. | idem |
| G5–G7 | B | not re-verified | The anchored-section outline, the capability chips and the PAT placeholder were not re-captured under the same conditions. | — |

### Architecture, Backlog, Spend, light theme

| # | Sev | Status | What the "after" shows | Evidence |
|---|---|---|---|---|
| R1 | B | persists | "a partir do module_map (create_c4_diagram)". | `projeto-arquitetura--*` |
| R2 | B | persists | Orphan paragraph on top, "Gastos do workspace" inside a project tab, an axis-only chart. | `projeto-spend--*` |
| R3 | B | persists | The story icon is still the Criativo's light bulb. | `projeto-backlog--*` |
| CL1 | M | persists | Inert "Converter" is still barely visible on the light background. | `projeto-settings--light--desktop.png` |

## New findings

Things the "before" did not list — either new, or hidden until a fix made the
screen reachable. None was fixed here; each is a candidate AT.

| # | Sev | Screen / theme | Finding | Evidence |
|---|---|---|---|---|
| N1 | A | Session, both themes, 390 px | The session page did not get the mobile layout. "Contexto da sessão" keeps ~320 px, the thread gets ~70 px and wraps one word per line, the side-sessions panel is unreadable, and "Iniciar ideação"/"Encerrar" fall off the right edge. | `sessao--*--mobile.png`, `sessao2--*--mobile.png`, `detalhe-sessao2-mobile--*.png`; checker 19–21 `texto-cortado` |
| N2 | M | Session, both themes | Every `chat.message` is drawn as the **viewer** — avatar and name come from the logged-in user, never from `actorKind`/`actorId` (`apps/web/src/routes/session-timeline-montagem.tsx:379-395`). An agent's `chat.message` shows as "owner@brabo.dev"; in a shared session another person's message would show under the viewer's name. It was hidden while the thread folded history into origin groups (X3). | `detalhe-sessao2-topo--dark.png`; `sondas-dark.json` (`autoriaChatMessage`: three times "owner@brabo.dev" for user, agent, user) |
| N3 | M | /containers, both themes, 390 px | The table squeezes its seven columns into the width: the headers "REGISTRADO/OBSERVADO/RECURSOS/DESDE" overlap, cells wrap one word per line, and the action buttons are cut at the right. | `containers--*--mobile.png`; checker 8 `texto-cortado` |
| N4 | M | Settings, both themes, 390 px | "Modelos por agente" is unusable on mobile: the agent name gets a 6 px box, the model trigger 0 px. | `projeto-settings--*--mobile.png`; checker 33–35 `texto-cortado` |
| N5 | B | /status, both themes, 390 px | The only page that scrolls sideways: `scrollWidth` 413 against 390; the table's right edge is cut. | `status--*--mobile.png`, `validacao-visual.json` |
| N6 | B | Dashboard, both themes, 390 px | The search collapses to "Bus" and "Novo projeto" wraps into two lines. | `dashboard--*--mobile.png` |
| N7 | B | Criativo, both themes, 390 px | The session id of each row gets a 0 px box ("#ae1e5746", "#cde43f7c"), so rows lose what identifies them. | `projeto-criativo--*--mobile.png`, `validacao-visual.json` |
| N8 | B | Project rail, both themes, 390 px | The active tab is not scrolled fully into view ("Config…" cut, the "4" of Aprovações clipped) and nothing signals that the strip scrolls. | `projeto-settings--*--mobile.png`, `projeto-approvals--*--mobile.png` |
| N9 | B | Overview and session, both themes | Plural slips of the i18next pass: "1 eventos" (`overview.json:70` has one form only) and "0 referência" (the pt rule puts 0 in `one`, so `origemRefs_one` is used for zero). | `projeto-overview--*--desktop.png`, `sessao2--*` |
| N10 | B | Login, both themes | The backdrop glow is `--success-soft` (`apps/web/src/routes/AuthLayout.module.css:80-84`): with the old teal it read as the brand; on the neutral theme it is a green haze behind a terracotta page. | `login--dark--desktop.png`, `login--light--desktop.png` |
| N11 | B | Approvals tab, both themes | Every card carries "Motivo da política fora dos eventos carregados nesta tela" — true (the reason lives in the other session's log) but it is the tool explaining itself, repeated per card. | `projeto-approvals--*` |

## What this page does not measure

- Contrast. That is arithmetic over the tokens and lives in the web suite
  (`apps/web/src/lib/contraste.ts`); the checker here only sees layout.
- Anything behind the engine: the live turn strip, the terminal, dev agents'
  presence. The stub cannot produce them.
- The production build. `vite` dev serves the same components and CSS, but not
  the production CSP or the nginx in front of the web image.

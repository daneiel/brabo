---
sidebar_position: 13
---

# Audit: fluxo.yml × code (v3, ADR 0085)

An isolated audit session — **read-only**. Cross-references `docs/fluxo.yml`
(the target model declared by ADR 0085) against the real code, to answer two
questions: what's missing for the code to honor everything the flow declares
as `active`, and what's genuinely staged behind each trigger in the
[activation-trigger table](modelo-de-time.md#activation-trigger-table)
of `modelo-de-time.md`. No production code line was changed in this session;
none of the three model documents (`fluxo.yml`, `gates.yml`,
`agent-areas.ts`) was edited — each divergence found between them is
treated as a **finding**, not a license to fix in passing.

> ADR 0085's doctrine: a `proposto` (proposed) role declares who absorbs it
> today and the objective criterion for separation — the target org chart
> is an activation sequence, never an aspiration. This audit doesn't
> anticipate any `proposto`/`planned` role; where it found something beyond
> what should exist, it's explicitly marked as a finding.

## How to read this document

- **Section A — Divergences.** The flow declares X, the code (or its
  sibling `gates.yml`) does Y. It's a conflict between sources and requires
  a decision from the product owner — none was fixed here.
- **Section B — Gaps in active roles.** Declared work (never "proposed")
  on roles that already operate today — implementable right now, without
  waiting for any trigger.
- **Section C — Staged behind a trigger.** What each trigger in the
  activation table would unlock, with a scope estimate, and whether it has
  already fired.
- **Section D — Wave plan.** A proposed sequencing, ordered from the gate
  cheapest to verify by script to the most expensive (the one requiring an
  ADR and a product decision).

---

## A. Divergences

| # | Severity | Item | Evidence |
|---|---|---|---|
| A1 | **Critical** | `gate_saida: paralelismo-autorizado` of `dev-lead` — `docs/fluxo.yml` (role `dev-lead`) declares `status: ativo`; `docs/gates.yml:239-248` declares `status: planned`, with the comment "FASE 14d — becomes active once it closes." FASE 14d closed on 2026-08-07 (the same day as FASE 15, which created `gates.yml`) and the mechanism has been active, tested and in production ever since — `gates.yml` was never updated afterward. | Real mechanism: `apps/api/src/application/use-cases/execution/request-parallelization.use-case.ts:35-78` (above the cap, creates a `proposed_action` of type `parallelize`); guarded against auto-approval in `apps/api/src/domain/actions/decide.ts:266-276` (`parallelize`/`raise_max_parallel` never leave `require_approval`); tests: `apps/api/test/application/use-cases/execution/request-parallelization.use-case.spec.ts:97`, `apps/api/test/domain/actions/decide.spec.ts:273-303`. `docs/fluxo.yml` itself already records this gate as `ativo` — the divergence is `gates.yml` × (fluxo.yml + code), not fluxo.yml × code. |
| A2 | High | The `dev-lead`'s `plano-de-paralelismo` output, declared `via: proposed_action` (RN-083/154). What the code actually produces is a plain `execution.plan_proposed` event (`apps/engine/lib/engine/agents/dev_lead_tools.ex:14-18,60-77`), **without** an approval pipeline — a deliberate decision, documented in the code's own comment ("turning the proposal into an action to decide would make the user decide twice"). The `parallelize`-type `proposed_action` that actually exists (the same mechanism as A1) is triggered by a **user action in the UI** requesting reinforcement above the cap (`apps/web/src/routes/ProjectOverviewTab.tsx:361` → `POST /sessions/:sessionId/execution/parallelize`), not by the dev-lead's initial plan output. `fluxo.yml` merges two distinct mechanisms into a single output. | `apps/engine/lib/engine/agents/dev_lead_tools.ex:14-18,60-77`; `apps/web/src/routes/ProjectOverviewTab.tsx:361`; `apps/engine/lib/engine_web/router.ex:57`. |
| A3 | Medium | The `dev` state machine — `fluxo.yml:134` declares 4 states (`working\|awaiting_gate\|idle\|idle_tripped`); the real code has **5**: it adds `:awaiting_approval` (Phase 12e, ADR 0052), a persisted state with its own transitions, not a transient one. | `apps/engine/lib/engine/dev/dev_agent_server.ex:17-18,300-333,622-654`. |
| A4 | Low | The RN-160 citation attached to the `backlog-promovido` entry (origin `po`) of the Architect. The real RN-160 is about the "Confirm architecture ready" gate on the **output** side (Architect → Dev Lead), not the PO → Architect input. | `docs/business-rules.md:5606-5622` vs. `docs/fluxo.yml` (role `arquiteto`, inputs). |
| A5 | Low | The RN-161 citation attached to the Architect's `handoff-duplo` output. The real RN-161 (ADR 0069) is about the **next** step — accepting the handoff to the Dev Lead chains execution activation —, not about the double handoff itself. | `docs/business-rules.md:5624-5644` vs. `docs/fluxo.yml` (role `arquiteto`, outputs). |
| A6 | Low | The "Confirm architecture ready" gate (RN-160, ≥1 promoted story) is only guaranteed on the **client** (`SessionPage.tsx`, `hasPromotedStory`); the backend (`OfferInfraHandoffUseCase`) doesn't revalidate it. A direct call to the internal route, bypassing the UI, would ignore the rule entirely. Not a divergence declared in `fluxo.yml` — it's an additional finding from the audit. | `apps/api/src/application/use-cases/agents/offer-infra-handoff.use-case.ts:19-38`. |
| A7 | Informational | The Creative agent's output artifact is `artifact.product_brief` in the code, not literally `necessidade-de-negocio` — it's the same concept with a different event name; terminology imprecision, not structural. | `apps/engine/lib/engine/agents/criativo_server.ex:396-420`. |
| A8 | Low | The `dev`'s `worktree-por-agente` input is labeled "origin: harness"; `WorktreeManager` lives in `Engine.Dev`, and isn't one of the 4 components listed for the `harness` role (`PromptAssembler`, `ToolLoop`, `ContextManager`, `Hooks`, `fluxo.yml:244`). | `apps/engine/lib/engine/dev/worktree_manager.ex:19-49` vs. `docs/fluxo.yml` (role `harness`, components). |
| A9 | Nuance (not a divergence) | The `dev`'s `pr-remota` output declares a simultaneous destination `[area-qa, secops]`; the real mechanism is sequential and ordered by a state machine — QA always before SecOps, never in parallel. Doesn't quite contradict fluxo.yml (both are indeed final destinations), but could be read as simultaneous fan-out. | `apps/api/src/domain/execution/pr-gate-state-machine.ts:21-30`. |

**Finding discarded by verification.** An initial exploration flagged the
`achado_aberto: AE` label (`fluxo.yml:158`, role `area-qa`) as an "orphan
reference." Verification: **it's a real, documented reference** —
`docs/explanation/achados-execucao-real.md:618` (`### AE. The QA agent
tries to fix the code it's judging (P2)`) and
`docs/explanation/backlog.md:40`. No divergence here; recorded so the
search isn't repeated.

---

## B. Gaps in active roles (already implementable work)

All items below are on roles with `status: active` — none depends on a
`proposto`/`planned` role existing first.

| # | Gap | Where in the model | What's missing, concretely |
|---|---|---|---|
| B1 | **Dev Lead → dev delegation** (ADR 0053 item 5) | `fluxo.yml`, `dev-lead`'s `delegacao` output, `status: lacuna` | Confirmed absent: `dev_lead_server.ex` only registers `DevLeadTools.spec()` (`apps/engine/lib/engine/agents/dev_lead_server.ex:75`); the `delegations` table already accepts a generic `area: text` (`apps/api/src/db/schema.ts:1051-1091`), but the only callers of `RecordDelegationUseCase` are `qa_lead_server.ex` and `infra_lead_server.ex` — none with `area = 'dev'`. The pattern to copy already exists twice (QA and Infra); it's missing on the Dev Lead. |
| B2 | **`necessidade-validada` gate** (Creative agent → PO) | `modelo-de-time.md`, "State of the mesh" — "new gate = ADR" | Doesn't exist in `gates.yml`, nor in code. `modelo-de-time.md` already lists an open proposal ("Anti-pattern of the Creative agent as real gate validation") — missing is the objective criterion's decision, the ADR and registration in `gates.yml` (can be born `warn`, like `implementavel`/`operavel`). |
| B3 | **`implementavel` gate** (dev-lead's `gate_futuro`) | `docs/gates.yml:250-259`, `status: planned`, owner `dev-lead` | The dev-lead is already an active role; the gate doesn't depend on `qa-estrategia`/`appsec` existing — it's the opposite: it's this gate's CREATION that activates them (see C1). Missing is the "implementable" criterion (e.g., a story with a minimum acceptance criterion, no blocking dependency) and registration in `gates.yml`. |
| B4 | **Product metrics → PO** | `fluxo.yml`, PO's `metricas-de-produto` input, `status: lacuna`; target output of `analytics` (proposed) | `po_server.ex` has no product-metrics tool at all (`apps/engine/lib/engine/agents/po_server.ex:86-99`). `modelo-de-time.md:21-25` already records the principle: "analytics is born as a new output of `medicao` before becoming a role" — meaning this does NOT need to wait for the `analytics` role to split off; it's an extension of `medicao` (already active, with `sumGroupedBy` in production) that, once it exists, is itself the act of crossing the "product metrics become an input to the PO" trigger (see C2). |
| B5 | **`docs/gates.yml` out of date** (same finding as A1) | — | Fix `status: planned` → `active` for `paralelismo-autorizado`, with `evidencia` `event_log`/`proposed_action.created` filtered by `actionType: parallelize`, `onde: request-parallelization.use-case.ts`. This is a metadata fix, instantly verifiable by `pnpm --filter api validacao:gates` — the script would already have real evidence to cite. |
| B6 | **RN-160 without backend revalidation** (finding A6) | — | Optional hardening: `OfferInfraHandoffUseCase` should require ≥1 promoted story before emitting the double handoff — today only the UI disables the button. |
| B7 | **DORA report via `medicao`** | `fluxo.yml`, `delivery-metricas` role (proposed, `status: — (never)` in the activation table — "becomes a `medicao` REPORT, never an agent") | Since the role never becomes an agent, this item isn't staged behind any trigger — it's work available today on the already-active `medicao`: lead time, deployment frequency, MTTR and change failure rate extracted from the event log + `gates.yml`, in the same pattern as `medir:execucao`/`sumGroupedBy`. |

---

## C. Staged behind a trigger

Activation table (`modelo-de-time.md:52-62`), each row with the real state
verified in this audit.

| Trigger | Roles it activates | Fired? | Estimated scope, if crossed |
|---|---|---|---|
| `implementavel` gate created | `qa-estrategia` + `appsec` — "second moment" of the **existing** agents (`qa-lead`/`secops` gain a "design" mode, no new agent) | **No.** `implementavel` remains `planned`, with no route/use case consuming it (exhaustive search: zero occurrences outside `gates.yml`) | **M.** Depends on B3 closing first. Then: `dev-lead` invokes `qa-lead`/`secops` in a "design" mode (test-plan, threat-model) before proposing parallelism — reuses the agents, no new table, no new worker. |
| Product metrics become a mandatory PO input | `analytics` splits off from `medicao` | **No** — but crossing it is B4, already within reach today | **P/M** to produce the metric (B4); the `analytics` role's own separation stays behind another subjective criterion ("when it becomes a mandatory input," still an open proposal in `modelo-de-time.md`) — a product decision, not additional technical scope. |
| `DEPLOY_ENABLED` flips | `platform` activates → then `secops-runtime` | **No.** No real reading of `DEPLOY_ENABLED` in application code — only mentions in comments/docs; `tag-release.yml` explicitly documents there's no hidden deploy job | **G.** Own program: real deploy environment, GitHub Environments, a green pipeline consumed by `platform`, SLO/dashboard/runbook — and only afterward `secops-runtime` (detection with real traffic). Largest item in the flow's backlog. |
| Anamnese steps out of refinement | The `staff`'s trigger regains an owner | **No — and it went in the opposite direction.** `ANAMNESE_ENABLED=false` since 2026-08-10, an explicit user decision ("today it isn't bringing much-value data," RN-115, `docs/business-rules.md:4597-4655`) | The "proposer-of-the-cap (RN-086)" dependency cited in `fluxo.yml:263` is **implemented and tested in code** (`ProposeMaxParallelUseCase`, hardcoded actor `anamnese`; `apps/engine/lib/engine/workers/anamnese_worker.ex:270-286`; tests in `anamnese_worker_test.exs:387-411`) — just **dormant behind a flag**. Not an engineering gap; a paused product decision, waiting for "future refinement of what Anamnese derives" (`docs/explanation/backlog.md:349`). |
| Managed project with its own UI | `ux-designer` splits off from the Creative agent | **No.** Search for a prototype/design artifact delivered to a client project (outside `design_handoff_brabo/`, which is Brabo's own): zero occurrences | **G.** Depends on the Code tab gaining UI EDITING/design capability — today it's declaredly read-only (FASE 26). |
| Real data volume | `dbre` splits off from Dev Lead/Platform | **No.** No real production load/volume metric referenced anywhere in code | **G.** Depends on real production operation at scale, outside the team's control today. |
| — (never) | `delivery-metricas` becomes a report, not an agent | N/A by design | See B7 — the report itself doesn't wait on a trigger. |

---

## D. Proposed wave plan

Ordered from the gate cheapest to verify by script (pure metadata, no new
logic) to the most expensive (requiring an ADR and a product decision).
Each wave is a future session with a single deliverable — **none was
started in this session**.

| Wave | Single deliverable | Items | Cost | Verification |
|---|---|---|---|---|
| **1** | `fluxo.yml`/`gates.yml` up to date | A1/B5 (`paralelismo-autorizado` gate status), A3–A5, A8 (RN citations and the `dev` state machine fixed) | P | `pnpm docs:check` green; `pnpm --filter api validacao:gates` citing real evidence for `paralelismo-autorizado` |
| **2** | Dev Lead delegates to dev; "architecture ready" proven server-side | B1 (private delegation tool on the dev-lead, same pattern as `qa_lead_server.ex`/`infra_lead_server.ex`), B6 (RN-160 revalidated in `OfferInfraHandoffUseCase`) | M | Test proving `delegations` recorded with `area='dev'`; test that the internal route refuses the double handoff without a promoted story |
| **3** | `medicao` speaks of product | B7 (DORA report), B4 (product metrics as a PO input — crosses trigger C2) | M | Script extracts the 4 DORA metrics from a known fixture; test that the PO reads `metricas-de-produto` when present |
| **4** | The `implementavel` gate is born | B3 (the "implementable" criterion on the dev-lead, registration in `gates.yml` — can be born `warn`) | M, with ADR | Accepted ADR; `validacao:gates` covering the new evidence |
| **5** | QA and SecOps gain the second moment | C1 (`qa-lead`/`secops` in "design" mode: test-plan, threat-model) — depends on Wave 4 closed | M | Test that the dev-lead receives a test-plan and threat-model before proposing parallelism |
| **6** | `necessidade-validada` gate | B2 (objective need-validation criterion, ADR, registration in `gates.yml`) | M, with ADR and prior decision | Accepted ADR; `validacao:gates` covering the new evidence |

**Out of wave** (recorded backlog, no session estimate — depends on a
real scale/infra decision or on the product owner flipping something back
on, not on schedulable engineering): `DEPLOY_ENABLED`/`platform`/
`secops-runtime` (C3, G, its own program), reactivating Anamnese/the
`staff`'s trigger (C4, user decision), `ux-designer` (C5, depends on the
Code tab gaining editing — frozen as read-only by FASE 26), `dbre` (C6,
depends on real production data volume).

---

## Documentation infrastructure note (out of scope for this audit)

`docs/explanation/modelo-de-time.md` exists and is complete, but **isn't
listed in `website/sidebars.ts`** — only reachable by direct link, not
through the site's menu. Not a `fluxo.yml` × code finding; it's a
pre-existing publication gap, flagged here so it isn't lost, with no fix
in this session (out of the declared scope: "no code change").

---

## Summary

- **9 divergences** (A1–A9): 1 critical (a gate mismarked `planned` in a
  document that already operates it `active`), 1 high (the parallelism
  plan's approval mechanism doesn't match what's declared), 2 medium, 4
  low, 1 informational, 1 nuance with no real contradiction.
- **7 gaps in active roles** (B1–B7), all implementable without waiting
  for a trigger.
- **7 activation-table triggers**, none fired — one of them (Anamnese)
  moved in the opposite direction since the last reading of fluxo.yml.
- **Zero findings of code anticipating a `proposto`/`planned` role** —
  the declared gaps are genuinely empty across every audited role.

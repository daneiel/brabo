---
id: primeiro-dogfooding
title: What the first dogfooding run taught
sidebar_label: First dogfooding
sidebar_position: 4
description: The Phase 10 harvest — the seventeen findings from the first time Brabo built Brabo itself, what got measured, and what was lost by not being recorded.
keywords: [dogfooding, harvest, Phase 10, findings, operability]
---

# What the first dogfooding run taught

In Phase 10, Brabo built part of itself: Bitbucket support and the
`GenericGitProvider` were delivered by the product's own agents, on a fork,
with a human in the user role. It was the first real execution outside a demo.

This document is the **harvest** of that run. It exists because `CLAUDE.md`
had referenced it since Phase 10 and it had never been written — an absence
worth recording, and one of the findings in its own right.

:::warning What was lost

The mission's observation table (`docs/missions/dogfooding-mission.md:488-490`)
has **a single filled-in row**: #1, the manual seed, recorded before the first
session began. No run was counted.

The repository has no record of the number of engine restarts, manual
interventions, approval clicks, or cost per session. The mission itself warned
(`colheita-esqueleto.md:63-68`) that `engine restarts` has **no record
whatsoever in the system** — it's human annotation only, and if it isn't
recorded live, it's gone.

That's why everything quantitative here appears as **`not measured`**, never
as an estimate. That's the harvest's own rule: no number goes in without a
query that produced it (`colheita-esqueleto.md:22-24`).

:::

## What was recorded, and is real

What survived is the **qualitative** part, and it's dense: seventeen findings
with file and line, verified in the code during the run. All of Phase 12
came out of it.

### Before the first session: the manual seed

The run began with an intervention that wasn't in the plan. The experiment
ran against a fork, and the `project_repositories` and `repo_bootstraps` rows
were **inserted by hand**, marked as converged, so the product wouldn't try
to resume a bootstrap (`dogfooding-mission.md:104-134`).

The reason is finding #1: the product only knew how to **create** a
repository. `createRepo` was unconditional and `getRepo` had existed with no
caller since Phase 2.

> It was the experiment's first manual intervention, and it happened **before
> the experiment began** (`:130-133`).

### During: the batches

The run's second structural fact was finding #10: **a dev agent processed one
task and stopped**. `:work` was only triggered on activation and on accepting
parallelization; nothing moved the agent from an opened PR back to "free to
claim".

The operational consequence is described in `:393-416`: the phase ran in
**batches**. Each following task required restarting the engine — dev agents
are `restart: :temporary`, they die and don't come back — and reactivating
execution. Reactivating without restarting didn't fix it either: the
supervisor returned the existing agent without triggering `:work`, and it
also created an orphan session (finding #11).

The number of restarts is **not measured**. What's known for certain is the
property: by the design at the time, **one restart per delivered task** was
the floor, not an observed average.

### The third one: promotion without a human step

Finding #13 was P2 in the original classification and was later promoted to
P1. The `draft → ready` transition happened **automatically on creation**;
`TransitionStoryUseCase` validated and emitted the event, but wasn't wired to
any route — dead code. The Backlog tab was read-only.

In other words: the PO, an LLM agent, decided on its own what entered the dev
agents' work queue, in a product whose stated principle is the user's final
authority.

## The seventeen findings

Kept verbatim from the mission, with the priority they received at the time.
The ones Phase 12 closed are marked.

### From the survey before the first session

| # | finding | where | prio | state |
|---|---|---|---|---|
| 1 | The product doesn't know how to point a project at an existing repository. `createRepo` is unconditional; `getRepo` exists and is called by no use case; the DTO has no field for `externalId` | `provision-repository.use-case.ts:144` | **P1** | **closed** — [ADR 0044](../adr/0044-adocao-de-repositorio-existente.md) |
| 2 | GitHub's `protectBranch` applies `enforce_admins: true` + 1 reviewer over the existing protection, without reading the current state — can lock out the owner's manual merge | `github-provider.ts:170-175` | **P1** | **closed** — became a product rule ([RN-045](../business-rules.md#rn-045)) |
| 3 | The bootstrap creates and protects an `rc` branch that Brabo's branch policy (Phase 6) doesn't use | `bootstrap-steps.ts:94,195` | P2 | **closed** — [RN-029](../business-rules.md#rn-029) |
| 4 | `agent_areas`/`agent_area_members` don't exist; areas, leads, and members are hardcoded in two places that can diverge | `schema.ts:781-786` | P2 | Phase 8 recorded cut |
| 5 | The six Phase 9b LLM providers didn't land, and CLAUDE.md described Phase 9 as if they had | ADR 0042:147-156 | P2 | closed in Phase 11 |
| 6 | `git-providers.md` claims Bitbucket and Generic are "out of scope"; CLAUDE.md marked both as an active phase | `docs/reference/git-providers.md:170-174` | P2 | closed in Phase 10 itself |
| 7 | The comment in `git-errors.ts` says "8 operations"; the contract has 10 | `git-errors.ts:3` | P3 | **closed** — and the count became a test |
| 8 | The contract suite's header says only Local exercises it; GitHub and GitLab have run it since Phase 2 | `git-provider.contract.ts:12-18` | P3 | **closed** — and the list of callers became a test |

### From the survey during the run

| # | finding | where | prio | state |
|---|---|---|---|---|
| 9 | **The Creative agent can't be skipped.** The claim requires a `ready` story; `ready` requires ≥1 business rule; the id is validated against a real event; and only the Creative agent has `emit_artifact` | `story-readiness.ts:46`, `po_server.ex:18` | **P1** | open |
| 10 | **A dev agent processes ONE task and stops.** `:work` is only triggered on activation and on accepting parallelization | `dev_agent_server.ex:76-91,306-327` | **P1** | **closed** — [ADR 0045](../adr/0045-reagendamento-por-evento-do-dev-agent.md) |
| 11 | Reactivating execution doesn't re-trigger `:work` and also creates an extra session with no linked agents | `dev_agent_supervisor.ex:33-52` | P2 | **closed** — [RN-053](../business-rules.md#rn-053) |
| 12 | There's no manual handoff to an agent of choice, and ADR 0038's target validation was never implemented | `SessionPage.tsx:403-407` | P2 | **half closed** — target validation in [RN-054](../business-rules.md#rn-054); manual handoff remains open |
| 13 | There's no "promote to ready": promotion is automatic on creation. `TransitionStoryUseCase` isn't wired to any route — it's dead code | `create-story.use-case.ts:75-78` | P2 → **P1** | **closed** — [ADR 0046](../adr/0046-promocao-de-story-com-autoridade-do-usuario.md) |
| 14 | There's no way to return a story to the PO — no state, event, or button | — | P2 | **closed** together with #13 |
| 15 | The team panel and the Psychologist's hypotheses share the same tab, which is the project's default | `ProjectOverviewTab.tsx:227-263` | P2 | **closed** — dedicated Insights tab, with counter |
| 16 | No screen totals approvals per session; the on-demand Anamnese has no button | `hooks.ts:153-160` | P3 | **partly closed** — see note below |
| 17 | **The phase's main metric isn't in the event log.** `proposed_action.approved`/`.denied` only go to the outbox | `approve-action.use-case.ts:98` | **P1** | **closed** — [ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md) |

:::note Finding #16 had one half that was wrong

When closing it, verification showed that the second claim — "the on-demand
Anamnese has no button" — **was already false when the finding was written**:
the route `POST /projects/:projectId/anamnese/run` exists
(`anamnese.controller.ts:71`) and the "Run now" button is in Settings ›
Proficiency (`ProjectSettingsTab.tsx:777`), covered by
`ProficiencySection.test.tsx`.

The first half was real and got closed: the Sessions tab now totals proposed
actions **per session**, separating what you clicked (`decidedBy`) from what
policy auto-approved (`resolvedPolicy`). Before, everything came from
`usePendingActions`, which requires a `sessionId`, and all three callers
passed the most recent session's — a decision forgotten in an earlier session
stayed invisible forever.

The record stays because **the harvest doesn't correct itself by erasing**: a
partly wrong finding is information about how the run was conducted.

:::

Two items entered as **record, not defect**, so the harvest wouldn't confuse
them with a gap: **merge staying outside the product**
(`awaiting_user` is a terminal state by design,
[RN-014](../business-rules.md#rn-014) — the engine doesn't even know about
`git_merge`) and **QA being skipped by keyword** in the NFR
(`qa_lead.ex:20-28`), which is declared heuristic, not NLP.

## What wasn't measured

Listed explicitly, so it doesn't look like an oversight:

| what | why |
|---|---|
| engine restarts per task | not recorded in the system; depended on live human annotation |
| manual interventions and their reasons | same — the observation table was blank from row 2 onward |
| approval clicks per session | finding #17 explains it: `proposed_action.approved` didn't go to `session_events`; the durable source was `proposed_actions.decided_at`, which the run never consolidated. Later closed by [ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md) — the metric exists from that point on, but doesn't retroactively apply to this run |
| token cost per agent and per provider | `token_usage` has the data, but no query was ever run and that execution's database wasn't preserved |
| gate correction round-trips | same |

Finding #17 is the costliest item in this set, and the lesson is about
instrumentation: **an experiment's main metric needs to be in the durable log
before the experiment starts.** It wasn't, and that's why the quantitative
half of the harvest doesn't exist. It was later closed by
[ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md), and that holds
for the **next** experiment too: no fix reconstructs data that was never
recorded.

## What Phase 12 did about this

The three operability P1 findings — #1, #10, and #13 — were closed in
Phase 12, and the proof that they died in a single execution is in
[Phase 12 validation](./validacao-fase-12.md).

The fourth P1, #17, was closed later by
[ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md), together with the
D5 that ADR 0045 had left on record.

The rest remain open, listed above, and none was fixed in passing: fixing a
finding outside the phase that addresses it is exactly what the mission
forbade (principle 3).

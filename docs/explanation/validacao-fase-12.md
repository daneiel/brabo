---
id: validacao-fase-12
title: The validation that the three findings died
sidebar_label: Phase 12 validation
sidebar_position: 5
description: The auditable script that exercises adoption, manual promotion, and rescheduling in a single execution — with event ids extracted from the database, and what the validation deliberately doesn't prove.
keywords: [validation, Phase 12, dogfooding, adoption, rescheduling, promotion]
---

# The validation that the three findings died

The [first dogfooding harvest](./primeiro-dogfooding.md) left three P1
operability findings. Phase 12 addressed them one by one; this document is
the proof that all three died **in the same execution**, and not only in
unit tests each slice wrote for itself.

The validation is a script: `pnpm --filter api validacao:fase-12`. It exits
with a nonzero code when a criterion isn't met — it's an acceptance
criterion, not a report — and at the end it prints the evidence table
**read from the database**. The ids below aren't transcribed by hand.

## What it does NOT prove

This comes first, not as a footnote, because a validation that hides its own
limits is worth less than none.

**It doesn't prove remote GitHub.** Adoption runs against the
`LocalGitProvider`. The reason isn't convenience: the fork used in Phase 10
was **never named** — line 135 of the mission is still a
`TODO(humano): which owner/repo of the fork?` — so there's no target to
re-adopt. The path exercised is the same in both providers (`getRepo` →
plan → `origin: 'adopted'`); what changes is the network, and that
difference is covered by the `adopt-repository.smoke.spec.ts` smoke test,
which only runs with real `ADOPT_TEST_REPO` and `GITHUB_TEST_TOKEN`.

**It doesn't prove the gates' judgment.** QA and SecOps are LLM agents. Here
the verdict enters through `RecordGateVerdictUseCase` — which is the
**real** funnel their opinion goes through, and where the
`task.gate_resolved` outbox line is born. What Phase 12b needs to prove is
the chain verdict → outbox → wake → claim, not whether the model can read a
test suite. The judgment itself remains covered by Phase 4a's acceptance
tests, which [ADR 0020](../adr/0020-destravar-gates-qa-secops.md) explicitly
declares **non-deterministic** with a local model.

**It doesn't merge.** Merging into a protected branch is the user's
decision, by design ([RN-014](../business-rules.md#rn-014)). Step 6 of the
script shows the lock refusing exactly that, with `auto_approve` autonomy
and `permissions.json` allowing it.

**It doesn't use an LLM anywhere.** The dev is the `NoopDevAgentServer`. It
doesn't write real code — but since Phase 12d it exercises the **same state
machine** as the real agent (`Engine.Dev.AgentIo`), and that's what's under
test here. Before that, the Noop would process one task and stop: finding
#10 survived inside the measuring instrument itself, which would have
failed the "zero restarts" criterion due to a defect in the tool, not the
product.

## The script

| # | step | what is asserted |
|---|---|---|
| 0 | create project | born with `story_promotion = manual` **without anyone configuring anything** |
| 1 | adopt a pre-existing bare repo, with `main` and `develop`, without `qa` or `rc` | `origin = 'adopted'`; the plan diagnoses a missing branch **and** a branch outside the template; `plan_decision` stays **null**; no row inserted by hand |
| 1b | decide "adopt as is" | the template is **not** forced onto the user's repository ([RN-045](../business-rules/custo.md#rn-045)) |
| 2 | the PO creates a complete story, with 3 tasks | the story becomes `draft` + `proposed_ready`; **`claimNext` returns `null`** |
| 3 | the user promotes | the story becomes `ready`; the proposal leaves the queue; the event records `user`, not `agent/po` |
| 4 | activate execution and resolve 3 gates in sequence | 3 tasks, 1 agent, **0 engine restarts** |
| 5 | empty queue | explicit `dev.idle`, process alive |
| 6 | propose a merge into a protected branch with everything allowed | `pending` — still your decision |

Step 2 is what kills finding #13 in a verifiable way: it's not enough for
the story to become `draft`, it also has to be true that **nothing is
claimable**. That's why the script calls `claimNext` directly and requires
`null`. Step 4 is what kills #10: from the second round on, nobody triggers
`:work` — the agent claims on its own, woken by the previous round's
`task.gate_resolved`.

## The evidence

Paste here the table the script prints. Each line is a `session_events.id`
(ULID) that exists in the database and can be queried later.

Run on **2026-08-07**, exit `0`, with the dev stack up and the script
running from inside the api container. The ids below came out of the
database during the run itself — project `f84f7226`, backlog session
`680ab9e9`, execution session `91f384fa`.

| step | event | id | seq |
|---|---|---|---|
| 1. adoption | `bootstrap.repository_adopted` | `01KZCW6SBGZZ5J2DTNKR35EQPC` | 1 |
| 1. adoption (as is) | `bootstrap.adopted_as_is` | `01KZCW6SETRNVJEX5V018GY5Q0` | 2 |
| 2. the PO proposes | `backlog.story_promotion_proposed` | `01KZCW6SGJJQX623FW4TQ28ZV3` | 3 |
| 3. you promote | `backlog.story_transitioned` | `01KZCW6SH7F14Y1QCJQHNJNF50` | 4 |
| 4. dev claims | `dev.working` | `01KZCW6SWFY33TF8DDX9MYHG40` | 5 |
| 4. PR opened, waiting on the gate | `dev.awaiting_gate` | `01KZCW6TB712EMZCC29WDK7YJC` | 14 |
| 4. dev claims | `dev.working` | `01KZCW6VAYQD1R0XH6J3VKKKJ9` | 18 |
| 4. PR opened, waiting on the gate | `dev.awaiting_gate` | `01KZCW6VQ3TZSH72CHAECBHZSX` | 27 |
| 4. dev claims | `dev.working` | `01KZCW6XA40AVK9N71PPRWKG4N` | 31 |
| 4. PR opened, waiting on the gate | `dev.awaiting_gate` | `01KZCW6XKXYTNW6ARDWF4VRW42` | 40 |
| 5. empty queue, agent idle | `dev.idle` | `01KZCW6Y812HAPVG3ZYS2CM6WA` | 43 |

The three `dev.working` → `dev.awaiting_gate` pairs are the three tasks,
**with a single agent and no engine restart between them** — finding #10,
proven by execution instead of by unit test. The final `dev.idle` is step
5: an empty queue with the process alive, not dead.

## What the first run cost

The table above took **four fixes** to exist, and it's worth recording
which, because three were in the INSTRUMENT and one was in the PRODUCT —
the distinction is the point.

**In the instrument** (the script and the `NoopDevAgentServer`):

1. The test fixture was born in `os.tmpdir()`, local to the container. The
   api is who adopts; the dev agent, which runs in the engine, is who
   clones to set up the worktree. The bare repo sat in the api's `/tmp` and
   the engine couldn't see it. It now gets created in
   `GIT_LOCAL_REPOS_ROOT`, the shared volume — which the script's own
   header already declared as a prerequisite.
2. The Noop marked the task `in_review` and stopped there, without calling
   `open_gate`: `tasks.gate_status` stayed NULL. `awaiting_gate` with no
   gate open, and nothing to judge.
3. `{:pr_settled, %{opened: true}}` arriving while the agent was already in
   `:awaiting_gate` had no matching clause in the Noop. `FunctionClauseError`,
   and since the server is `restart: :temporary`, the process died for
   good.

All three are the same story: the Noop was aligned with the real agent in
Phase 12d, but didn't keep up with what came after. It's exactly the risk
this document already named — *"finding #10 survived inside the measuring
instrument itself"* — now in three new instances.

**In the product**, and this is the finding that only a real execution
finds:

4. With the queue empty, `POST /internal/sessions/:id/tasks/claim` responds
   `201` with `content-length: 0`. The use case returns `null`, but NestJS
   serializes that as an EMPTY body; `Req` delivers `""`, which isn't
   `nil`, and `AgentIo.try_claim/2` matched the "task found" clause —
   calling `run_task("")` and throwing `BadMapError`.

   `try_claim/2` lives in `AgentIo`, **shared with the real
   `DevAgentServer`**: every dev agent would die the moment its module's
   queue emptied, which is the most common outcome there is. And it died
   for good — server `restart: :temporary`, with `Monitor` wiping the
   state row behind it. The exact opposite of what Phase 12b delivered:
   instead of supervised, event-wakeable `dev.idle`, a dead process.

   The suite never caught this because the fake correctly returns `nil`.
   It's fixed at the boundary (`claim_task/4`) and guarded in the contract
   (`try_claim/2`), without touching the route's HTTP status.

Finding 4 is the empirical answer to the question this phase exists to ask:
what does a real execution prove that a test doesn't.

The script refuses to end successfully if any step it claimed to exercise
leaves no evidence in the event log — without that check, a wrong query
would produce a short table and the validation would pass anyway, which is
the classic failure mode of a generated report.

## Before × now

The **Phase 10** column cites only what's derivable from what was written
down. Everything that would depend on a live count appears as
`not measured`, for the reason explained in the
[harvest](./primeiro-dogfooding.md).

| | Phase 10 | Now |
|---|---|---|
| pointing the project at an existing repository | manual seed in two tables, **before the first session** (`dogfooding-mission.md:104-134`) | adoption route; `origin = 'adopted'`; zero hand-written data |
| repository policy diverging | no diagnosis existed — bootstrap was the only path, and it forced the template | dry-run plan that **describes** the divergence and applies nothing without approval |
| engine restarts per delivered task | **1, by construction** — a property of finding #10 (`:666`), not an observed estimate. Real total: **not measured** | **0** |
| batches | the entire phase ran in batches (`:393-416`) | don't exist: the agent works through the module's queue on its own |
| agent with no task | dead process (`restart: :temporary`) | explicit `idle`, supervised, event-wakeable |
| sequence of failures | burned budget in a row | circuit breaker stops at `idle_tripped` ([RN-047](../business-rules/custo.md#rn-047)) |
| story → `ready` | automatic on creation, no human step (finding #13, `:669`) | user decision, actor recorded in the event log ([RN-048](../business-rules/custo.md#rn-048)) |
| declining a story | no state, event, or button existed (finding #14) | returned to the PO with the reason pinned to their session |
| total manual interventions | **not measured** — the observation table stayed blank (`:488-490`) | those from the approval pipeline, which the phase did **not** change |
| merge into a protected branch | manual, by design | manual, by design — unchanged, and step 6 proves it |

The last row matters as much as the others. Phase 12 is about the agent not
dying between tasks and about the decision returning to the user; it does
**not** expand autonomy at all. The approval pipeline is exactly as it was.

## How to run it

```bash
# the dev stack up (api and engine sharing /data)
pnpm dev

# from inside the api container
docker compose -f docker/docker-compose.yml exec api \
  pnpm --filter api validacao:fase-12
```

If a criterion isn't met, the script says which — the message starts with
`CRITÉRIO NÃO FECHOU:` and names the failed assertion.

# ADR 0012 — Real DevAgent: ToolLoop, per-task budget and blocking discipline

- Status: accepted
- Date: 2026-07-24
- Phase: 4a (session 2 — replaces the NoopDevAgent)

## Context

The previous session built the execution infrastructure (worktrees, commit
identity, git pipeline, merge lock, atomic claim) and validated it with a
**NoopDevAgent** (no LLM). This session replaces the dumb body with the
**real DevAgent**: it claims the task, assembles rich context via the
existing Phase 3 Harness, implements via a **ToolLoop** inside the worktree,
only opens a PR with a green suite (run by itself via terminal), respects a
per-task token budget, and returns a blocked task with a diagnosis when it
can't succeed.

## Decisions

### 1. ToolLoop gains hook-driven halt and a token ceiling (additive)

`Engine.Harness.ToolLoop` previously had only two outcomes (`{:ok, ctx}` /
`{:limit_reached, ctx}`); no agent in production used `.Default`
(Creative/PO/Architect each reimplement their own loop) — low risk in
extending it. Two new outcomes:

- `{:halted, reason, ctx}`: the `:post_tool_use` hook already supported
  `{:halt, reason}` (`Engine.Harness.Hooks`), but the result was DISCARDED
  (`_ = Hooks.run(...)`). Now `dispatch/2` uses `Enum.reduce_while` and
  propagates the halt — this is the mechanism the DevAgent uses to end the
  loop on the exact turn it signals completion or blocking (item 2).
- `{:budget_exceeded, ctx}`: `ctx.tokens_spent_micros` accumulates the
  `usage.costMicros` that each `llm_turn` already returned (and was being
  ignored); `ctx.token_budget_micros` (optional, default `nil` = no ceiling)
  is checked BEFORE the next turn — it never spends beyond what's
  configured, the same spirit as `limit_reached` (never an infinite loop,
  now also never infinite spend).
- `ctx.tools` (the tool registry) and `ctx.hooks` become explicit overrides
  — `Engine.Harness.Tools.specs/1`/`find/2` now accept an alternate
  registry (default the fixed one, preserving EchoAgent/tests). The
  DevAgent uses `Engine.Dev.Tools.registry/0` (no `EmitArtifact`; with
  `ReportDone`/`ReportBlocked`).
- `ctx.workspace_root` overrides the file/AGENTS.md root (default the
  project's shared workspace) — `WorkspaceFiles`, `InstructionFiles` and
  `ContextBuilder.build_layers/3` now accept this explicit root. The
  DevAgent passes the **worktree** — ReadFile/WriteFile/SearchWorkspace and
  the AGENTS.md it reads operate on the right branch/commit, not on the
  shared clone.
- **Terminal in the worktree** (fix for a real gap): `TerminalExecutor.run/3`
  ALWAYS ran in the project's shared workspace, never in the agent's
  worktree — without the fix, the DevAgent's tests would run outside the
  code it changed. An optional `cwd` flows through:
  `ActionPipeline` (the `terminal` tool's payload) →
  `ExecuteTerminalActionUseCase`/`ApiToEngineClient` (api) →
  `POST /internal/actions/execute` → `TerminalExecutor` (engine).

### 2. Termination discipline — ReportDone/ReportBlocked ENFORCED

`Engine.Dev.Tools.ReportDone` doesn't trust the LLM: it looks for the LAST
`tool` "terminal" message in the history and REQUIRES it to start with
`"exit 0"` (the exact format from `ActionPipeline.terminal_result/1`) —
without that, it returns an error (the model tries again). `ReportBlocked`
always accepts `{reason, diagnosis}`. A new `:post_tool_use` hook
(`Engine.Dev.Hooks.Termination`) halts the loop when either one succeeded —
using the mechanism from item 1. `DevAgentServer` handles 5 possible
outcomes from `ToolLoop.run/1`: `report_done` (opens the PR),
`report_blocked`, `limit_reached`, `budget_exceeded`, and `{:ok, ctx}` (the
model stopped without signaling — treated as a safety block). No path opens
a PR without proof of a green suite; none leaves a task stuck without a
resolution.

### 3. PR referencing the story + `in_review` status

`taskStatusEnum` gains `'in_review'` (`todo → in_progress → in_review →
done`; the transition to `done` is left for when QA exists — out of scope).
The PR body is the Markdown checklist of the story's DoD (`- [ ] item`); the
title references the story+task. Context comes from
`GetDevTaskContextUseCase` (api, new): the full story (RF/RNF/DoD/DoR),
resolved business rules (`session_events` `artifact.business_rule`, same
pattern as `CreateStoryUseCase`) and the project's ADRs (no filter by
module — the same simplification as `GetArchitectureUseCase`, documented).

### 4. Per-task budget — resolved in the engine, no new table

Budgets (`budgets` table) are scoped only to project OR session; a task has
no session of its own (all tasks of a module run in the same execution
session). Instead of an invasive migration on `budgets`/`token_usage`, the
per-task ceiling is resolved ENTIRELY in the engine: each `run_task` calls
`ToolLoop.run/1` ONCE, so the accumulated `tokens_spent_micros` IS the
task's cost, isolated per run. `taskBudgetMicros` (configurable at
activation, `POST execution/activate`, default US$0.50 if omitted) flows
through `ActivateExecutionUseCase` → `startExecution` → `dev_agent_states`
(new column, migration) → `ctx.token_budget_micros` on the `ToolLoop`.

### 5. Task blocking — reclaim enforcement

`tasks` gains `blocked boolean` + `blocked_reason text` (migration).
Blocking is NOT a new status value (the task returns to `todo`) — it's an
orthogonal flag. `ClaimNextTaskUseCase`/`claimNext` excludes `blocked =
true` from the atomic claim — without this, a chronically impossible task
would be reclaimed and re-blocked in a loop. A human unblocks it via
`UnblockTaskUseCase` (`POST sessions/:id/tasks/:id/unblock`) after reading
the diagnosis.

### 6. Real bug found by the concurrency test: `FOR UPDATE OF t`

The test with N simultaneous claims (item 6) exposed that `claimNext`'s
`FOR UPDATE SKIP LOCKED` WITHOUT `OF t` was also trying to lock the joined
`stories` row — since several tasks share the SAME story, this serialized
concurrent claims on the story's lock (SKIP LOCKED discarded them instead of
trying another task), losing claims even with tasks available. Fixed with
`FOR UPDATE OF t` (lock only the `tasks` row). Without a real concurrency
test (only sequential, as the previous session had), this bug would have
gone unnoticed.

## Consequences

- UI: current task/iteration/tokens spent live (via the enriched
  `agent.response`, existing polling); blocked tasks highlighted (the style
  already used for "Cross-validation gaps").
- Tests: `tool_loop_test` (hook-driven halt, token ceiling, custom
  registry); `dev_agent_server_test` (happy path, impossible task →
  blocked, budget exceeded → blocked, report_done without a green suite →
  rejected); `claim-next-task` (real concurrency — found the item 6 bug);
  `mark-task-blocked`/`get-dev-task-context` (new).

## Scope & assumptions

Only the **DevAgent** (replacing Noop) — QA/SecOps/Infra and the full team
panel via Phoenix channels remain out of this session. `in_review → done` is
left for when QA exists. ADRs per module remain unfiltered for real (all of
the project's ADRs). DevAgent context window fixed at 128,000 tokens (TODO:
use the resolved model's real window once the LLM turn returns that to the
engine — today the engine never learns that number).

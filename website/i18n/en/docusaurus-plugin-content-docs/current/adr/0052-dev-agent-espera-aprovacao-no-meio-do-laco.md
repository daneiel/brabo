# ADR 0052 — The dev agent waits for approval mid-loop

- **Status:** Accepted — implemented and proven by test in phase A
- **Date:** 2026-08-05
- **Context:** PHASE 13b — first real execution of the dev agent with an API model

## Context

The dev agent's `terminal` is a `:pipeline` tool: the
`Engine.Harness.Hooks.ActionPipeline` hook creates a `proposed_action` on
the api, which decides via `permissions.json`. When the decision is
`auto_approve`, the api executes right away and the hook returns the
command's real output. When it's `require_approval`, the hook returns
**the string** `proposed_action <id> status pending` as the tool's result
— and the ToolLoop moves on to the next iteration.

The agent has no way to wait. It reads "pending," learns nothing about the
command, tries something else, and each attempt burns one iteration of
the cap.

In a real execution (project `saudacao-local`, task `cd652d85`), the
outcome was:

```
toolloop.limit_reached  {"iteration": 8, "max_iterations": 8}
backlog.task_blocked    {"reason": "limite de iterações atingido"}
```

Eight iterations burned, not a single line written, and the approvals the
user granted arrived after the loop had already exhausted itself — they
were useless.

### Why the allowlist doesn't solve it

`DEV_TERMINAL_ALLOW_PATTERNS` exists precisely to avoid this, and the
comment at `activate-execution.use-case.ts:139-144` describes the failure
accurately. But it's a list of predicted commands, and the model invents
commands. After adding read-only ones (`ls`, `find`, `pwd`, `cat`…), the
same agent progressed a good deal — worktree created, command with
`exit 0`, files read — and got stuck again on `git branch -a` and
`git rev-parse`.

Every new model, every new stack, a new gap. The allowlist is mitigation
and cannot be the answer.

### What already exists and proves the path

`:awaiting_approval` **already is** a dev agent state, created in Phase
12e for the end of a task: when `pr_open` is pending, the agent holds onto
its worktree and is released by `task.pr_settled`, emitted by the api and
routed by `DevAgentWakeWorker`. The whole mechanism — persisted state,
worktree retention, outbox event, worker, `Wake.deliver` — is ready and
exercised.

What's missing is applying it mid-loop, not inventing it.

## Decision

When a `:pipeline` tool comes back `pending`, the ToolLoop **stops** and
the agent enters `:awaiting_approval`, holding onto everything. The user's
decision emits an event that wakes it, and the loop **resumes from where
it stopped**, with the command's real result in place of the "pending"
string.

### Why stop instead of blocking while waiting

The obvious alternative — the hook waiting by polling — is simpler and is
wrong: the ToolLoop runs **inside the agent's GenServer callback**
(`dev_agent_server.ex:365`). Blocking there would freeze the very mailbox
that would bring the decision, on top of graceful shutdown and the
circuit breaker. Stopping and resuming by message is what `pr_settled`
already does, and for the same reason.

### Messages stay in memory

The loop's `ctx` (with the history) stays in the GenServer's state while
the agent waits. It isn't persisted: the agent stays alive, just idle.
This preserves the property recovery from restart already declares — a
turn's messages only exist in memory, and a restart mid-task blocks with a
diagnostic (`dev_agent_server.ex:153-159`). An approval pending across a
restart falls into that same path, which is honest and already exists.

## The five pieces

| # | Where | What |
|---|---|---|
| 1 | `apps/api/.../approve-action.use-case.ts`, `deny-action.use-case.ts` | emit `task.action_settled` when the action's actor is a dev agent — with `actionId`, `status`, and the execution result |
| 2 | `apps/engine/.../hooks/action_pipeline.ex` | on receiving `pending`, signal a stop instead of returning the string |
| 3 | `apps/engine/.../harness/tool_loop.ex` | support `{:awaiting_approval, action_id, ctx}` as an outcome, alongside the `halted` states that already exist |
| 4 | `apps/engine/.../dev/dev_agent_server.ex` | store `ctx`, persist `:awaiting_approval` + `action_id`, and resume `ToolLoop.run/1` on receiving `{:action_settled, …}` |
| 5 | `apps/engine/.../workers/dev_agent_wake_worker.ex` | route `task.action_settled` to the agent, as it already does for `task.pr_settled` |

### Denial is a response too

A denied action resumes the loop with the denial reason in place of the
result — the agent learns that path is closed and tries another. Denying
doesn't block the task: it's the user's decision, and the same principle
that applies to `pr_settled` with `opened: false` applies here (it doesn't
count toward the circuit breaker).

### Wait cap

Waiting forever is an immortal session by another name. The agent waits
up to the task's inactivity cap; once that's hit, it blocks with
`origin: política` (policy) — the task stopped because nobody decided,
which is different from a code or model defect.

## Consequences

**For**

- The agent stops burning iterations on what it can't execute, and the
  user's approvals now count regardless of when they arrive.
- The allowlist stops being the only defense and goes back to the role it
  was designed for: skipping approval for what's routine, not making the
  agent viable at all.
- The user starts seeing `dev.awaiting_approval` in the feed and knows
  the agent is waiting for **them**, instead of seeing a task blocked by
  "iteration limit."

**Against**

- An agent waiting occupies the worktree and doesn't pick up the next
  task. It's the same cost already accepted in `awaiting_gate`, and for
  the same reason: the worktree belongs to the AGENT, not the task.
- `ctx` in memory means a restart during the wait loses the turn. It
  falls into the blocking-with-diagnostic path that already exists;
  persisting message history is a separate problem, not this ADR's.

## Alternatives considered

**Raise `max_iterations`.** Only postpones it: with an approval pending,
every iteration is wasted, so any cap gets hit eventually.

**Auto-approve `terminal` via `agent_autonomy`.** Would free ANY command
inside the engine's container, and that's exactly what
`dev-terminal-patterns.ts:11-15` rejects — with the file, `deny` still
beats `allow` and `BUILTIN_DENY_PATTERNS` stay active.

**Polling in the hook.** Freezes the GenServer, as explained above.

## References

- [ADR 0045](0045-reagendamento-por-evento-do-dev-agent.md) — the state
  machine and event-driven rescheduling this ADR extends
- [RN-047](../business-rules/custo.md#rn-047) — the dev agent's circuit breaker
- Real execution: project `saudacao-local`, task `cd652d85`, 2026-08-05

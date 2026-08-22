# ADR 0057 — The gate agent waits for approval, like the dev agent waits

- **Status:** accepted
- **Date:** 2026-08-07
- **Context:** PHASE 13b, finding AB
- **Extends:** [ADR 0052](0052-dev-agent-espera-aprovacao-no-meio-do-laco.md)

## Context

[ADR 0052](0052-dev-agent-espera-aprovacao-no-meio-do-laco.md) resolved, for
the **dev agent**, the problem of a tool that needs approval in the middle of
the loop: the agent SUSPENDS while retaining its history, and the decision
resumes it with the real result in the place where the word `pending` would
be.

The **gate** agents were left out of that fix, and nobody noticed because no
execution ever reached them. PHASE 13b arrived.

In the 6th real execution, `qa-automacao` ran:

```
ls -la && find . -name "AGENTS.md" -o -name "package.json" | head -50
```

Compound command with one segment outside `allow` — correctly rejected, and
correctly suspended by the `ToolLoop`. What happened next is the defect: the
`QaLeadServer` had no clause for that outcome, fell through to the catch-all,
and recorded:

```
delegation.failed  failureOrigin: "infra"
"QA Automation did not complete its report — unexpected ToolLoop outcome"
```

Two things wrong at once:

1. **the task got blocked** by a decision nobody had made yet;
2. **the origin was a lie.** Nothing about infrastructure failed. This
   contradicts the rule that [ADR 0020](0020-destravar-gates-qa-secops.md)
   fixed: origin is NAMED, never obtained by elimination.

## Decision

**Gate agents suspend and resume, exactly like the dev agent.**

The subagent gains a third outcome, alongside `{:ok, verdict}` and
`{:blocked, info}`:

```elixir
{:awaiting, %{action_id:, tool_call_id:, tool_name:, ctx:}}
```

The whole `ctx` travels along — it is what makes resumption possible, and is
the same choice ADR 0052 made.

The **Lead** becomes the one that waits. It was already a per-project
`GenServer`, so it gained three things:

- it subscribes to `Engine.Dev.Wake` for the **subagents**
  (`qa-automacao`, `qa-performance-seguranca`), because `task.action_settled`
  arrives keyed by the actor who PROPOSED the action, and the one proposing
  is the subspecialty;
- it holds the in-flight state (`pending`) — the suspended delegation, what
  has already been collected, what still needs to run;
- on `{:action_settled, ...}` with the `action_id` it is waiting for, it
  resumes that subagent and **continues the area from the point it stopped**.

### What changed shape, and why

`rodar_ativas` was an `Enum.map` over the active delegations: a straight
line with no way to stop midway. It became `continuar_area/4`, recursive
over the list of remaining ones, with the collected results accumulated.
It is this shape that allows suspending between two delegations without
losing the first.

## Consequences

**Approval stops killing the gate.** While pending, the area does not
consolidate, does not emit a verdict, and does not block the task — it
waits. The user's click unblocks it, instead of arriving too late.

**Rejection also resumes.** The reason goes in the place of the result and
the agent learns that path closed, instead of waiting forever. Same rule as
ADR 0052.

**The `infra` origin stops being used for a pending decision.** What is left
in the catch-all is a genuinely unexpected outcome.

### What this does NOT resolve

It does not eliminate approval, and it should not. The allowlist remains a
closed list and the agent keeps inventing commands — findings **X**, **Z**,
and **AD** from PHASE 13b remain open. What changes is the consequence: what
used to be a wall becomes a decision queue.

**A restart in the middle of the wait loses the loop.** The `pending` state
lives in `QaLeadServer`'s memory, and it is `restart: :temporary`. The dev
agent solved this by persisting status in `dev_agent_states`; the gate has no
equivalent table, and creating one is its own scope. It is left recorded as
a known limitation — the gate runs again via the `Dispatcher` when the task
returns to the cycle.

## Alternatives considered

**Let the gate run with full autonomy**, without going through the approval
pipeline. Rejected: the gate runs commands in the dev's worktree, and the
boundary exists precisely because it is third-party code being executed.
Swapping the wall for a hole is not a solution.

**Only fix the origin** (`infra` → `politica`), without suspending. This was
the intermediate step, and it was not enough: the gate kept dying, just with
the right label. Honest, and useless.

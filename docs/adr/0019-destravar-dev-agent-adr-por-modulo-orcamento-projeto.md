# ADR 0019 — Unblocking the real DevAgent: writing, terminal, ADR by module, and per-project budget

- Status: accepted
- Date: 2026-07-25
- Phase: 4a (closing the deviations of the real DevAgent)

## Context

The real DevAgent (ADR 0012) was complete on paper — ToolLoop in the worktree,
`ReportDone` requiring a green suite, blocking with diagnostics, per-task
budget — but **had never run the acceptance criterion with a real LLM**. When
attempted, the audit found the reason: it **couldn't implement anything**.

## Decisions

### 1. The DevAgent was blocked at TWO points (the central finding)

- `write_file` from a `dev-*` was not in the `WriteFilePolicy` whitelist (the
  default only had `echo`), so it turned into a `proposed_action` — and
  `write_file` **has no executor in the api**, meaning even approved it
  wouldn't write.
- `terminal` had no rule at all: `decide()` fell into `require_approval` and
  the action was born pending.

Since `ReportDone` only releases a PR after a `terminal` with `exit 0` in the
history, a green suite was **unreachable**: every task ended up blocked by the
iteration limit. The enforcement of the completion discipline was correct;
what was missing was the agent's ability to act.

**Fixes:**
- `WriteFilePolicy` gains agent prefixes (`:write_file_agent_prefixes`,
  default `["dev-"]`): the dev writes to any path in its own root. This is
  safe because its root IS the worktree and `WorkspaceFiles.write_file/3`
  already blocks traversal — **the sandbox is the worktree, not the path
  prefix list**.
- `DEV_TERMINAL_ALLOW_PATTERNS` (api domain) is seeded into `permissions.json`
  on activation. NARROW test/build patterns (`Terminal(pnpm test)`,
  `Terminal(npm test)`, `Terminal(mix test)`, …), with override in the DTO.
  Deliberately **not** `agent_autonomy auto_approve` for `terminal`: that
  would release any command. Being a file rule, `deny` still wins, the
  `BUILTIN_DENY_PATTERNS` remain active, and a compound command requires
  every segment to match.

### 2. ADRs filtered by module
`open_adr_pr` gains `modules?: string[]` (filled in by the Architect's tool).
`GetDevTaskContextUseCase` filters by the dev's module; an ADR **without**
`modules` is cross-cutting and always included — which covers the entire
pre-existing collection before the field, with no data migration. With no
module informed there is no filter, preserving the QA/SecOps gates, which
reuse the same context.

### 3. Prompt discard priority was inverted
`estado_tarefa` was `[story, task | adrs]` and `PromptAssembler.fit_units/3`
discards **from the head**: under context pressure, the story (FR/NFR/DoD)
was sacrificed and the ADRs survived — the opposite of what serves whoever is
going to implement. It's now `adrs ++ [story, task]`.

### 4. Per-task budget persisted on the project
It was just an activation parameter, living in `engine.dev_agent_states`:
reactivating without passing it again would silently fall back to the
default. New column `projects.task_budget_micros`; resolution
**parameter → project → default**, with persistence when it comes from the
parameter.

### 5. `task_blocked` artifact
The block only emitted an event + a flag in the database. It now also emits
`artifact.task_blocked`, validated by `ArtifactSchemas` — server-emitted,
never via tool call (the model doesn't get to choose to declare that it gave
up).

### 6. Diagnosability: an LLM error must not turn into an empty diagnostic
`ToolLoop` returned `{:ok, ctx}` both when the model stopped without
signaling and when the call to the provider FAILED — and `DevAgentServer`
would block the task with an empty `""` diagnostic. The ctx now carries
`:last_error` and the diagnostic distinguishes the two cases. This isn't
theoretical: the first real demo died on an invisible
`Req.TransportError{reason: :timeout}`.

### 7. LLM turn timeout
`llm_turn` used Req's default. With a local model, the FIRST turn still loads
several GB of weights before the first token and times out. New
`llm_turn_timeout_ms` (default 300s, env `LLM_TURN_TIMEOUT_MS`).

### 8. Node in the engine image
The managed project's suite runs **inside the engine container** (that's
where `terminal` executes, in the worktree). Without the toolchain, `npm
test` never returns exit 0. **Known limitation:** this doesn't scale to
arbitrary stacks — the real solution is a per-project sandbox, out of scope
for Phase 4a.

## Consequences

- New tests: `write_file_policy` (dev writes in its root; traversal
  blocked), the dev's `context_builder` (FR/NFR/DoD + module ADRs +
  AGENTS.md actually in the prompt; ADRs discarded before the story), red
  suite up to the limit with the test output in the diagnostic,
  `task_blocked` artifact, ADR filtering by module, `activate-execution`
  (budget order, terminal patterns, never `git_merge`), and
  `lib/execution.ts` on the web.
- UI: task title in the panel (previously only the `task-<8hex>` branch),
  backlog invalidation via the channel (blocked live) and an unblock
  button.

## Acceptance criterion result (honest)

The entire chain was exercised end to end with a local LLM: atomic claim,
isolated worktree, assembled context, LLM turn, and the block outcome with
diagnostics and artifact. **What did NOT close were the 2 green PRs** — and
the cause is the model, not the platform: `qwen2.5-coder:7b` doesn't
implement tool calling in the Ollama template. Verified directly against
`/api/chat`, with `stream: false` and a correct `tools` payload, the response
comes back with `tool_calls: null` and the call written as JSON in
`content`. No adjustment to `OllamaProvider` fixes this.

Closing the criterion requires a model with a real tools template
(`llama3.1:8b` or larger) or a paid provider. It's the user's decision — the
platform is ready for either.

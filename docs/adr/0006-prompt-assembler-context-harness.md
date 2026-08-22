# 0006 — Agent harness: deterministic context assembly

## Context

Phase 3a assembles the agent harness in `apps/engine` (Elixir/OTP) BEFORE
any product agent. CLAUDE.md lists 5 behaviours; this first session is
explicitly **LLM-free** — just deterministic context assembly — and
implements 3 of them: **PromptAssembler**, **InstructionFiles**, and
**Hooks**. ToolLoop and ContextManager (which touch the LLM via the api)
are left for future sessions.

The engine had nothing prompt/agent/instruction-related: no table, no
workspace file reader, no tokenizer, no hooks structure. This ADR
records the shape decisions for that foundation.

## Decisions

### Layer model + deterministic trimming (PromptAssembler)

The prompt is assembled in 5 ORDERED layers (identity →
instruction_files → project_context → business_rules → task_state),
each with a token budget. `PromptAssembler` is a PURE function agnostic
to the data source (the `ContextBuilder` is what collects it) — this
keeps the algorithm, the heart of the acceptance criteria, testable in
isolation.

Each layer declares a trimming strategy, applied when the budget is
exceeded — always DETERMINISTIC and documented:

- `:drop_whole_units` (unit-based layers, e.g. business rules) —
  discards WHOLE units from the head of the list until it fits. **Never
  truncates in the middle of a unit.** The list arrives in discard
  order: business rules, oldest first; instruction files, lowest
  precedence first. A single unit larger than the budget is discarded
  whole (the layer can end up empty), never split.
- `:truncate_tail` (blob, e.g. project context) — keeps a prefix sized
  to the budget (respecting UTF-8) + a `[… truncated …]` marker.
- `:keep_or_drop` (blob, e.g. identity) — all-or-nothing: if it fits,
  keep it; if not, drop the whole layer (half an identity is useless).

Rejected: truncating any layer by raw character count (it would lose
the "never split a business rule" guarantee). Also rejected: a single
global trimming mode — layers have different natures (list vs. blob vs.
identity) and deserve different strategies, all explicit.

### Token estimation (Tokenizer)

With no LLM and no new lib (respecting "don't install libs without
justification"): the count is a local ESTIMATE via `bytes/4` with a
cap — the same heuristic already used in
`Engine.Actions.TerminalExecutor` (`@bytes_per_token 4`). Every result
is marked `estimated: true` in the layers and in the report.
`Engine.Harness.Tokenizer` is a swappable behaviour via
`Application.get_env(:engine, :tokenizer, ...Approximate)` — a real
tokenizer can be plugged in later without touching the assembler.

### InstructionFiles: precedence and cache

Sources: the project workspace root's `AGENTS.md` + each subdirectory's
`AGENTS.md` (recursive walk, skipping `.git`) + the agent's file in the
database (`agent_instructions`). **Documented precedence: database >
directory > root** — and, among directories, the deepest (most
specific) wins over the root. Sources are returned in ASCENDING
precedence order (root first, database last): the database is read last
and wins on conflict ("last wins"), and it's this same order that
trimming uses (discarding the least authoritative, the root, first).

Reload via **simple invalidation, no fs watch** (for now). Cache in
ETS: a minimal supervised process (`InstructionFiles.Cache`) only
creates and holds the named public table; the fs+database I/O happens
in the CALLING process of `load/2` — this way the cache never touches
the database and doesn't collide with the Ecto sandbox in tests. It's
the **first use of ETS in the engine**: justified as Elixir's standard
cache primitive, and to avoid the pain of a GenServer reading the
database under sandbox.

### Hooks: pure functional registry

`Engine.Harness.Hooks` is a VALUE (a map from phase to a list of
handlers in registration order), not a process — deterministic,
testable with no mutable global state, matching the codebase's taste
(no global registries beyond process identity). Phases: `pre_tool_use`,
`post_tool_use`, `session_start`, `session_end`. `run/3` runs the
handlers in registration order (`reduce_while`); a handler that returns
`{:halt, reason}` interrupts the chain. It's the base that the action
pipeline and the terminal executor will plug into as handlers in a
future session — each one building and running the hooks value per
invocation.

### Ownership of `agent_instructions`

The table references `projects` (domain data of the api) → it's created
by a **Drizzle migration in apps/api** (`public` schema), and the engine
only READS via an Ecto schema `@schema_prefix "public"`
(`Engine.AgentInstructions.Instruction`), never a migration of its own —
engine migrations only live in the `engine` schema. Same pattern as
`Engine.Projects.ProjectRepository`/`SessionEvents`. In the engine's
tests (`engine_test` database, isolated from the api's database), the
table exists via a raw fixture in `test_helper.exs`, just like
`outbox_events`/`session_events`/`project_repositories`.

## Consequences

- The `:business_rules` and `:task_state` layers come out EMPTY in this
  session — there's no source yet (business_rule is emitted by the
  Creative agent in Phase 3b; task state comes from the ToolLoop/agents).
  The trimming algorithm already handles them (empty = 0 tokens) and is
  exercised in tests with synthetic units. Inventing tables for them
  would be Phase 3b scope.
- The agent's identity is a minimal static map (`Engine.Harness.Agents`),
  one line per roster slug — not "implementing an agent" (no behavior,
  no LLM), just content for the layer to exist.
- Acceptance criteria satisfied by `Engine.Harness.Debug.print/2` (a
  debug function callable from IEx, no Mix.Task — no precedent in the
  engine for that), which prints each layer with its (estimated) token
  count and the assembled prompt.
- Per-layer budgets are module constants with reasonable defaults,
  overridable via `opts[:budgets]`. Without an LLM yet, they serve to
  exercise trimming and give visibility in debug; they'll be calibrated
  once the ToolLoop lands.

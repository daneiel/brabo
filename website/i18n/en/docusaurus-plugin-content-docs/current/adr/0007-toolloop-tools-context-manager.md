# 0007 — ToolLoop, tools, ContextManager (harness with LLM)

## Context

Second session of Phase 3a: wiring the deterministic harness (ADR 0006) to the
LLM. A `ToolLoop` that runs LLM turns, registered tools (read_file,
search_workspace, write_file, terminal, emit_artifact), a `ContextManager`
that compacts above a threshold, the hooks wired into the action pipeline, and
a validation `EchoAgent`. Hard rule from CLAUDE.md: the engine NEVER talks to
an LLM provider directly — every call goes through the api (metering +
budget).

Discovery that shaped the work: there was no internal LLM endpoint
(engine→api) with tool-calling or metering — only the web-facing `/chat` (SSE,
human user, no tools) — and the Ollama provider didn't send `tools` or parse
`tool_calls`. So this session involved substantial work in the api
(TypeScript) besides the engine (Elixir).

## Decisions

### Internal turn-result LLM endpoint (not streamed to the engine)

`POST /internal/sessions/:id/llm-turn` (EngineServiceGuard) → `RunLlmTurnUseCase`.
Consumes the provider's stream INTERNALLY in the api (like `/chat`) and
returns the COMPLETE turn (assistant message + `toolCalls` + usage) as a
single JSON. The ToolLoop is turn-by-turn; the "streaming" happens at the
provider→api layer. Streaming NDJSON all the way to the engine was rejected:
in a tool loop the engine needs the complete message (with tool_calls) before
dispatching tools, so streaming would only add live deltas — it doesn't
change the acceptance criteria (each tool call, context.compacted, cost) and
would cost stream consumption in Elixir. Confirmed with the user.

The endpoint writes `token_usage` (metering MANDATORY via
`RecordLlmUsageUseCase`, requires `sessionId`) but does NOT write
`session_events`: the engine owns the narrative in the event log
(`agent.response`, `tool.call`, `tool.result`, `toolloop.limit_reached`) —
avoids duplicate logging. Tool-calling: `ChatMessage`/`ChatOptions`/
`ChatStreamChunk` gained tool fields (packages/shared), and the Ollama
provider started sending `tools` and parsing `message.tool_calls`.

### Tools: direct vs. pipeline

- Direct (execute in-process in the engine): `read_file`, `search_workspace`,
  `write_file` within the agent's whitelist, `emit_artifact`. All file access
  goes through `WorkspaceFiles.safe_path/2` — **path traversal blocked**
  (nothing escapes `<PROJECT_WORKSPACES_ROOT>/<project_id>`).
- Pipeline (via proposed_action in the api): `terminal` (ALWAYS), and
  `write_file` OUTSIDE the whitelist. The `:pre_tool_use` hook creates the
  `proposed_action` (api's decide/permissions); `auto_approved` terminal is
  auto-executed (existing branch) and the result becomes the tool's result;
  write_file outside the whitelist stays `pending` (post-approval execution
  is a future phase). New `ActionType` `write_file` (developer). The engine
  does NOT create proposed_actions directly — it goes through a new internal
  endpoint `POST /internal/sessions/:id/actions`.

### emit_artifact = typed session_event (no table)

There is no artifact table nor per-type validation in the api. An artifact is
a `session_event` `"artifact.<type>"` with payload validated IN THE ENGINE
(`ArtifactSchemas`, required keys per type; only `"note"` for now — the
product types come in 3b), emitted via `append_event`. Creating an artifact
table now was rejected (would be 3b scope).

### Hooks wired (item 4)

`:pre_tool_use` = where the pipeline check happens (`ActionPipeline`);
`:post_tool_use` = writes `tool.result` to the event log (`EventLog`).
Default registration for the ToolLoop, but swappable (it's a value on
Hooks). Foundation for the action pipeline to plug in deeper later.

### ContextManager: compaction preserving pinned entries

When estimated tokens exceed `threshold * model window`, summarizes the
oldest NON-pinned turns via the `agent`/"context-manager" binding (a cheap
model — no new schema, it's a free-form slug), replaces them with a summary,
preserves the pinned entries (system prompt + task) and the `keep_recent`
most recent ones, and emits `context.compacted` with
`tokensBefore`/`tokensAfter`. Deterministic fallback if the summarizer fails
(never loses the thread). Internal messages are string-keyed maps (thread
format) + `:pinned` (removed before sending).

### Where the ToolLoop runs

`EchoAgent.run/2` runs the `ToolLoop` synchronously (observable in IEx for
the acceptance criterion). In production, a per-session driver (a Task under
`Engine.TaskSupervisor`, coordinated by the SessionServer) avoids blocking
the heartbeat GenServer — a future session refinement; in this session the
trigger is IEx (no Mix.Task precedent, same as `Debug.print`).

## Consequences

- Every new behaviour (`ToolLoop`, `ContextManager`) follows the
  behaviour + swappable impl pattern via `Application.get_env`, no Mox;
  deterministic tests use a fake `EngineApiClient` that scripts `llm_turn`/
  `propose_action` through the process dictionary (the loop runs
  synchronously in the test process) and `send`s events to `:test_pid`.
- The acceptance criterion (EchoAgent in a real session with Ollama) needs a
  tool-capable model in Ollama and the bindings (session + "context-manager").
  Automated tests use the fake (real Ollama is the manual demo).
- `OpenAIProvider` got a cast to keep compiling with the widened `ChatRole`
  (tool calling on it is out of scope for this phase — Ollama only).

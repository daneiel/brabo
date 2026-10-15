# ADR 0008 — Conversational Creative agent in the harness + handoff foundation

- Status: accepted
- Date: 2026-07-24
- Phase: 3b (session 1)

## Context

Phase 3a delivered the deterministic harness + the **one-shot** ToolLoop
(autonomous, runs until it stops) and the human chat is a **stateless
api-only** echo (`SendChatMessageUseCase` sends only the current message to
the provider — no history, no harness, no tools; the engine doesn't even
participate). Phase 3b needs a **conversational Creative agent** that drives
ideation WITH the user, emits `business_rule` throughout the conversation and
— only after explicit user confirmation — emits `product_brief` and offers a
handoff to the PO. It also needs the **handoff** foundation, with the rule
that gates agent activation.

Hard rule from CLAUDE.md: "Agents ALWAYS run inside a Harness" and "the
engine NEVER talks to an LLM provider directly". So the Creative agent lives
in the engine (harness), and every turn goes through the api (metering +
budget).

## Decisions

### 1. Creative agent as a stateful GenServer (not stateless)
An `Engine.Agents.CriativoServer` (GenServer, `restart: :temporary`) per
session, supervised by a `CriativoSupervisor` (DynamicSupervisor), registered
in `Engine.Sessions.Registry` under the key `"criativo:<session_id>"` —
mirrors `SessionServer`. Conversation history lives in memory and is
**rehydrated** from `session_events` (chat.message/agent.response) in
`init` — the event log is the durable source of truth. Started by a user
command (the exception to the activation rule), via the api →
`ApiToEngineClient.startAgent` → engine `POST /internal/sessions/:id/agent/start`.

Discarded alternative: rebuilding the history from the event log on every
turn (no live process). We chose the GenServer to have a natural place for
per-session state and lifecycle (consistent with `SessionServer`).

### 2. Token-by-token streaming via SSE engine→api and Phoenix rebroadcast
Each user message runs ONE **streamed** turn: `StreamLlmTurnUseCase` (an SSE
sibling of the 3a `RunLlmTurnUseCase`, which remains turn-result for the
ToolLoop) transmits deltas; the `CriativoServer` consumes the SSE
(`EngineApiClient.llm_turn_stream`) and **rebroadcasts** the deltas to the
web over the Phoenix channel `session:<id>` (`agent.delta`/`agent.done`) —
which the web already connected to only for heartbeat. Final persistence
(`agent.response` + artifacts) arrives via the `session-events` poll (3s)
that `SessionPage` already performs. Metering (token_usage) is mandatory and
runs in the api; the engine never talks to the provider directly. This
partially reverts the 3a turn-result decision **only** for interactive
agents.

### 3. Handoffs: table with mutable status + immutable events
New table `handoffs {from_agent, to_agent, artifact_id, status:
offered|accepted|completed|rejected}`. Unlike event tables, `status` is
MUTABLE (it's the current state); each transition also becomes an immutable
`session_event` `handoff.*`. The api owns the table — the engine creates the
handoff via `POST /internal/sessions/:id/handoffs` (it never writes the
api's table directly).

### 4. Agent activation rule (pure domain)
`domain/sessions/agent-activation.ts`: an agent can only be activated in a
session with a handoff `accepted` addressed to it; **single exception: the
Creative agent** (started by user command — `USER_STARTED_AGENTS`). Pure and
tested in isolation (mirrors `decide.ts`/`session-state-machine.ts`);
`ActivateAgentUseCase` loads the handoffs and applies the rule before
spinning up the process in the engine.

### 5. Readiness is a user action; product_brief is server-emitted (domain guardrail)
"Readiness confirmation is a user action (button), not model inference." The
`business_rule` is emitted by the model via the `emit_artifact` tool (with
`origin` — references to the conversation — validated as NON-empty in
`ArtifactSchemas`). The `product_brief` is NOT tool-emittable
(`known/0` excludes it; `EmitArtifact` blocks system-emitted types) — it only
comes out when the user clicks "I'm ready to produce"
(`ConfirmReadinessUseCase` → engine `confirm_readiness`): at that point the
`CriativoServer` runs a consolidation turn, emits the `product_brief`
directly (`append_event_returning`, capturing the id) and creates the
`offered` handoff to the PO. This makes "brief only after confirmation" a
domain guarantee, not a prompt guarantee.

### 6. Artifacts remain typed session_events
No artifact table: `business_rule`/`product_brief` are `session_events`
`artifact.<type>` with payload validated in the engine (`ArtifactSchemas`).
The web reads them from the same event poll (rule cards in the side panel;
handoff divider in the chat when `handoff.offered` appears).

## Scope

Only the handoff foundation (table + rule + **offered** handoff) and the
Creative agent. The **PO** (accepting the handoff, activating the PO,
backlog) is a later session of 3b. No Bitbucket/GenericGitProvider; queues
remain on Postgres (Oban), no Redis.

## Consequences

- The web gains a second chat path (agent vs. human), decided by
  `agent.activated` in the event log; sessions without a Creative agent stay
  on the human chat.
- The `CriativoServer` rehydrates from the event log — survives a restart
  without losing the thread of the conversation.
- Deterministic tests: activation rule (unit), `ArtifactSchemas` (mandatory
  origin), and `CriativoServer` via direct `init/1` + `handle_call/3` with
  the scripted LLM fake (streaming, product_brief guardrail,
  readiness→brief+handoff, broadcast, rehydration).

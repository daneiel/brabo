---
id: business-rules
title: Regras de negócio
sidebar_label: Regras de negócio
sidebar_position: 3
description: As regras de domínio do Brabo, numeradas, com onde vivem no código e o teste que cobre cada uma.
keywords: [regras de negócio, domínio, máquina de estados, aprovação, RBAC]
---

# Business rules

Each rule has a **statement**, **where it lives** (`file:line`), and **the
test that covers it**. If you change a rule, update the line here in the same
change — that's what
[`.docmap.yml`](https://github.com/daneiel/brabo/blob/dev/docs/.docmap.yml)
requires with `block` severity.

They all live in `apps/api/src/domain/`, which is **pure**: no IO, no
framework, no database. That's why each one has a fast, deterministic unit
test.

## Business context

Brabo executes engineering work through AI agents. Two forces shape virtually
every rule here:

**The agent is not trustworthy by construction.** It's a language model: it
can hallucinate, get stuck in a loop, or request something destructive. The
rules exist so the possible damage is bounded by structure, not by prompt
quality.

**Spend is real and continuous.** Every turn consumes a paid token. Budget,
ceiling, and metering aren't administrative conveniences — they're what
stops an agent loop from turning into a loss.

### Actors

| actor | who it is | authority |
|---|---|---|
| **User** | the person. Roles: `viewer`, `developer`, `maintainer`, `owner` | final decision on any action with external effect; merge is theirs exclusively |
| **Agent** | long-running process with a role (Creative, PO, Architect, Dev, Infra, QA, SecOps, Psychologist, Anamnesis) | proposes; never decides alone what policy doesn't allow |
| **System** | api and engine | enforces policy, records the event, measures cost |

The vocabulary is in the [glossary](glossary.md).

---

## Session

### RN-001 — The session has five states and closed transitions {#rn-001}

`created → active → closing → closed`, with `closed_abnormally` reachable
from any non-terminal state. **From `closing` there's never a way back to
`active`**, and terminal states have no exit.

```mermaid
stateDiagram-v2
  [*] --> created
  created --> active
  created --> closed_abnormally: provisioning failure
  active --> closing
  active --> closed_abnormally
  closing --> closed
  closing --> closed_abnormally
  closed --> [*]
  closed_abnormally --> [*]
```

- **Where:** `apps/api/src/domain/sessions/session-state-machine.ts:29`
- **Test:** `test/domain/sessions/session-state-machine.spec.ts`
- **Edge case:** `closing` is a **transient** state. A session stuck there
  means the drain started and didn't complete — there's an alert for that,
  see the [runbook](runbook.md).

### RN-002 — Every session event is immutable and `seq` is dense {#rn-002}

There's never an `UPDATE` on `session_events`. `seq` is unique per session
(`unique(session_id, seq)`) and has no gaps: it starts at 1 and is contiguous.

- **Where:** `apps/api/src/db/schema.ts` (table `session_events`)
- **Test:** verified on restore — `docker/backup/restore.sh` fails if
  `count(*) ≠ max(seq) − min(seq) + 1` or `min(seq) ≠ 1`
- **Why:** it's what makes the Psychologist's evidence traceable and the
  backup verifiable. State that needs to change lives in its own table,
  alongside.

### RN-097 — The session's kind is creation intent; execution stays an event {#rn-097}

The session is born `consultiva` (consultative) or `criativa` (creative),
chosen by **whoever opens it** and recorded in `sessions.kind`. `consultiva`
is just conversation; `criativa` is the one that produces — it opens ideation
with the Creative agent and is the **only** one that enters execution. The
kind **never changes**: there's no route that swaps it.

The risk in this rule isn't the field, it's the **second source of truth**.
The product already knew how to say whether a session is executing, and knew
it through another path: `findActiveExecutionSession` looks for the `active`
session that carries the `execution.activated` event (it's what makes
reactivation land on the session where the dev agents already are, finding
#11 of the first dogfooding). The two coexist under a rule that keeps them
from fighting:

- **`kind` classifies creation INTENT.** A `criativa` session that never
  activated execution **is not** the current execution session, and the
  event-based derivation keeps not looking at `kind` — if it started to, every
  open creative session would become a candidate to receive the dev agents.
- **The event classifies execution STATE**, as always.
- **`execution.activated` on a `consultiva` session is an ERROR** (409), never
  silent conversion. This is the point that decides which of the two sources
  wins: letting the event promote the kind would be exactly having them write
  over each other.

The guard lives in the **funnel** — `AppendSessionEventUseCase` — not in
`ActivateExecutionUseCase`, because both paths that write an event (the
user's route and the engine's `/internal/*`) go through it. The extra session
read is only paid when the event is the execution one. The refusal happens
**before** `incrementSeq`: a refused attempt can't consume `seq`, or
[RN-002](#rn-002) would break.

The column's DEFAULT is `consultiva` — the kind that can do **less**: a row
arriving through a path that doesn't go through the route (migration,
maintenance SQL) doesn't earn the right to execute. The migration's
**backfill** does the opposite and is deliberate, by the 0033 reasoning: at
the moment it runs, every session predates the distinction, and some are
sessions where dev agents are working — waking them up as `consultiva` would
make reactivating an in-progress project fail without anyone having decided
anything.

- **Where:** `apps/api/src/domain/sessions/session-kind.ts:50`
  (`podeAtivarExecucao`), `apps/api/src/db/schema.ts:392` (the column),
  `apps/api/src/application/use-cases/sessions/append-session-event.use-case.ts:53`
  (the guard)
- **Test:** `apps/api/test/application/use-cases/sessions/session-kind-e-nome.spec.ts`
- **Origin:** [ADR 0061](adr/0061-tipo-da-sessao-na-criacao.md)

### RN-098 — The session name adds to the hashtag, never replaces it {#rn-098}

The session can receive a friendly name (`sessions.name`, optional), at
creation or later, via `PATCH /projects/:projectId/sessions/:sessionId`. The
label shown on screen is **composite**: `<name> · #<first 8 characters of the
id>`. With no name, it degrades to the **hashtag alone**.

The hashtag never disappears, and the reason is operational: it's what gets
pasted into a URL, a command, or a conversation, and a name chosen by a
person **isn't unique** — two sessions named "Checkout" are normal. A blank
name (or whitespace only) counts as **absence**, both on creation and on
renaming: writing `''` would turn the label into `" · #a1b2c3d4"`, worse than
the hashtag alone. `null` in the `PATCH` body is the way to **undo**.

Renaming is **not** a session event. The event log is what the session lived
through, and the name is a navigation label, changed as many times as
desired — N renaming events would push exactly what matters out of the
200-event tail.

- **Where:** `apps/web/src/lib/session-label.ts:50` (`rotuloDaSessao`),
  `apps/api/src/application/ports/session-repository.port.ts:52` (`rename`).
  Reachable both from inside the session
  (`apps/web/src/routes/SessionPage.tsx:445`, `handleRename`) and from the
  project's list, without needing to open the session first
  (`apps/web/src/routes/ProjectSessionsTab.tsx:101`, `handleRenomear`) — both
  screens call the same `renameSession` and the same `rotuloDaSessao`.
- **Test:** `apps/web/src/lib/session-label.test.ts`,
  `apps/api/test/application/use-cases/sessions/session-kind-e-nome.spec.ts`,
  `apps/web/src/routes/ProjectSessionsTab.test.tsx`
- **Origin:** [ADR 0061](adr/0061-tipo-da-sessao-na-criacao.md)

### RN-104 — The tab derives from the recorded kind, and creates in that kind {#rn-104}

The project has **two** session tabs — **Creative** and **Chat** — and each
one is a `kind`: it lists the sessions whose `sessions.kind` is its own, and
its CTA creates in that `kind`, **without asking again**. There's no third
tab listing both together.

The kind was already immutable ([RN-097](#rn-097)), and that's what makes it
a legitimate navigation coordinate instead of a saved filter: a session never
switches tabs. The tab reads the **recorded** field — it doesn't derive the
kind from any event, for the same reason as RN-097: `execution.activated`
classifies execution STATE, and a tab that looked at it would move on its
own.

Two consequences the rule fixes, and which aren't screen detail:

- **The kind choice leaves the form.** It used to live in a radio-button
  `fieldset`, and now it happens the moment the person clicks the tab.
  Keeping both would offer the chance to create a session that contradicts
  the place you're standing in. What's left in the form is the **name**,
  which stays optional ([RN-098](#rn-098)).
- **One action, one place at a time.** "Start ideation" still exists — it's
  what brings the Creative agent into the session, and from there on the
  owner's key starts being spent ([RN-058](#rn-058)); no one steps in alone.
  What changed is where it lives: **inside the invite** while the invite is
  on screen, and in the topbar when it isn't. The invite used to POINT to the
  topbar ("use Start ideation, at the top of the screen"), which is the
  literal version of the problem that originated [RN-097](#rn-097) — the
  action in one place and the explanation in another. The topbar can't
  simply lose the button: it's possible to type into a creative session
  without ever having called the Creative agent, and then the invite leaves
  the scene.

The three screens honor the three states of [RN-088](#rn-088), with **error
before empty**: the filtered list is empty in both cases, and saying "no
ideation yet" after a 429 would be lying about what happened.

The Chat's deep-link key stays `sessions`, not `chat`. That's what makes an
old bookmarked `?tab=sessions` link open the Chat **with the tab marked in
the tab bar** — resolving the old key as an alias only in the panel would
leave the tab bar with no selection at all, because `Tabs` compares `active`
to `key`, and whoever writes `active` receives the raw key from
`validateSearch`.

- **Where:** `apps/web/src/routes/project-tabs.ts:95` (both entries),
  `apps/web/src/routes/ProjectSessionsTab.tsx:114` (the filter by recorded
  `kind`) and `:98` (the CTA creating in the tab's `kind`),
  `apps/web/src/routes/SessionPage.tsx:553` (`conviteVisivel`, the one
  question the topbar and the invite share)
- **Test:** `apps/web/src/routes/ProjectSessionsTab.test.tsx`,
  `apps/web/src/routes/project-tabs.test.tsx`,
  `apps/web/src/routes/SessionPage.sessao.test.tsx`
- **Edge case:** a project with no session of that kind shows the empty
  state OF THAT KIND, even when it has sessions of the other kind — that's
  information, not an error.
- **Origin:** [ADR 0061](adr/0061-tipo-da-sessao-na-criacao.md)

### RN-123 — Creative session with no active Creative agent: the first message ALSO activates it {#rn-123}

In a `kind: 'criativa'` session ([RN-097](#rn-097)) with no `agent.activated`
yet, sending the first message through the composer activates the Creative
agent first (waiting for activation to finish) and only then delivers that
message to it through the real path (`sendAgentMessage` — history, system
prompt, `emit_artifact` tool). Before this rule, whoever typed without
clicking "Start ideation" fell into a generic SSE chat with no history and no
business rules: it was NOT the real Creative agent, and the conversation
recorded nothing in the domain.

The "Start ideation" click still exists ([RN-104](#rn-104)) — it's still
what triggers activation when the person prefers the explicit gesture, and
it's from it that the owner's key ([RN-058](#rn-058)) starts being spent on
either of the two paths. What changed is that the FIRST MESSAGE now also
counts as that gesture: no one should need a separate click before talking
to whoever the screen already invited them to talk to.

- **Where:** `apps/web/src/routes/SessionPage.tsx:627` (`handleSend`)
- **Test:** `apps/web/src/routes/SessionPage.ideacao-automatica.test.tsx`
- **Edge case:** a `consultiva` session has no Creative agent — the rule
  doesn't apply, and the generic SSE path stays the right one for it.

### RN-119 — The session's ACTIVE agent is the one with the most recent `agent.activated` — never a fixed chain {#rn-119}

`SessionPage` decides two things from the SAME agent: who the composer's
message goes to, and which agent the topbar resolves the displayed model
from (the full cascade session→agent→area→project→workspace, the same one
`RunLlmTurnUseCase` uses to actually run the turn). The two questions used
to have DIFFERENT answers before this rule: routing used a fixed precedence
chain (architect > po > creative, based on historical EXISTENCE — "has
already activated once", which never "turned off"), and the displayed model
didn't even know who was active — the model-binding route received no agent
at all and always fell back to the Creative agent's fixed fallback
(`herdarModeloDeStart`), even after a handoff to the PO, Architect, or Dev
Lead.

The single definition: the ACTIVE agent is the one with the most RECENT
`agent.activated` (by `seq`), among the conversational agents of the chat
flow (Creative, PO, Architect, Dev Lead). **Infra Lead is left out**:
`agent_command_controller.ex` (engine) only has a `message` route for
po/dev-lead/arquiteto (plus Creative, as the last clause's implicit
fallback) — Infra never had `message` wired, only `start`. Sending a message
to "infra" today would silently fall through to the Creative agent; treating
it as the composer's active agent would reopen that trap instead of closing
one.

- **Where:** `apps/web/src/routes/SessionPage.tsx:273` (`activeAgent`),
  `apps/web/src/lib/api-client.ts:773` (`getSessionModelBinding`, the
  `agentId`), `apps/api/src/interfaces/http/llm/model-bindings.controller.ts:147`
  (`getSessionBinding`, `@Query('agentId')`)
- **Test:** `apps/web/src/routes/SessionPage.agente-mais-recente.test.tsx`,
  `apps/web/src/routes/SessionPage.modelo-do-agente-ativo.test.tsx`,
  `apps/api/test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`
- **Edge case:** Infra Lead doesn't participate in composer routing nor in
  the "active agent" definition — it's proactive (Phase 4), not
  conversational through the composer.

### RN-120 — The session's event poll pauses during an in-progress turn {#rn-120}

`useSessionEvents` fetched events every few seconds with NO awareness of an
in-progress turn. If the poll landed DURING a turn (common — turns usually
last longer than the interval), it brought already-persisted
`chat.message`/`agent.response`, which rendered ALONGSIDE the
optimistic/streaming state still on screen: the same message, twice.

The fix pauses only the TIMER (`refetchInterval`) while `streaming` is
`true` — the query stays `enabled`, so the explicit invalidation that
already fires at the end of the turn (`finalizarTurnoDoAgente`) keeps
fetching fresh data at the right time. `pausarPoll` is an OPTIONAL
parameter, default `false`: the hook's other consumers (Overview, Code,
Provisioning, AdoptionPlan) have no conversational turn in progress and
stay as they were.

- **Where:** `apps/web/src/lib/hooks.ts:135` (`useSessionEvents`),
  `apps/web/src/routes/SessionPage.tsx:208` (`eventsQuery`)
- **Test:** `apps/web/src/lib/hooks.pausar-poll.test.tsx`
- **Edge case:** pausing the timer isn't disabling the query — explicit
  invalidation keeps working, and the fix depends on it to never miss data.

### RN-122 — The "Stop" button cancels the turn FOR REAL, killing the task holding the LLM call {#rn-122}

Until now there was no cancellation anywhere. The root was structural:
`agent_command_controller.ex` handled the user's message with
`GenServer.call(pid, {:user_message, texto}, ...)` — SYNCHRONOUS — and the
entire turn (tool loop + SSE call to the LLM) ran INSIDE `handle_call`. The
agent's process stayed blocked until the turn finished and handled NO other
message in the meantime — not even a future cancel command.

The fix: the turn `handle_call`/`handle_cast` of the four conversational
agents (Creative, PO, Architect, Dev Lead) spawns a
`Task.Supervisor.async_nolink/2` (`Engine.Agents.TurnoAssincrono`, new,
shared by all four) with the heavy work and returns `{:noreply, state}` —
the reply to the original `GenServer.call` is DEFERRED until the task
finishes (`GenServer.reply/2`, fired when `{ref, resultado}` arrives at
`handle_info`). Since the agent process STOPS being blocked, a new
`handle_cast(:cancel, state)` arrives and is handled while the turn runs:
`Task.shutdown/2` in `:brutal_kill` mode kills the task, which drops the
HTTP (SSE) connection it holds with the api — that's what makes cancellation
actually save tokens, not just stop rendering on the client. The original
`from` receives `{:error, :cancelado}`, and a TERMINAL `agent.error` is
recorded with origin `"politica"` (policy — the same origin as
budget/credential/binding — cancelling is a user decision to stop spending
tokens, not a fifth value in ADR 0020's closed vocabulary) — without it,
`GetSessionPendingWorkUseCase` would see `agent.activated` with no
subsequent `agent.response`/`agent.error`, and the session would stay hung
on the pending-work signal.

Two competing messages to the same agent (the user sends again while a turn
is already running) never spawn a second task:
`TurnoAssincrono.iniciar/3` replies `{:error, :turno_em_andamento}`
(turn in progress) right away.

- **Where:** `apps/engine/lib/engine/agents/turno_assincrono.ex` (the
  mechanism), `apps/engine/lib/engine/agents/{criativo,po,arquiteto,dev_lead}_server.ex`
  (the four turn `handle_call`/`handle_cast`), `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:170`
  (`cancel/2`), `apps/engine/lib/engine_web/router.ex` (`POST
  /internal/sessions/:sessionId/agent/cancel`),
  `apps/api/src/application/use-cases/agents/cancel-agent-turn.use-case.ts`,
  `apps/api/src/interfaces/http/agents/agents.controller.ts` (`POST
  /projects/:projectId/sessions/:sessionId/agents/:agent/cancel`),
  `apps/web/src/routes/SessionPage.tsx` (`handleCancel`, "Stop" button in
  the composer)
- **Test:** `apps/engine/test/engine/agents/turno_assincrono_test.exs` (the
  task dies FOR REAL — `Process.alive?/1` before and after — not just
  "stopped importing the result"), `apps/api/test/application/use-cases/agents/cancel-agent-turn.use-case.spec.ts`
- **Edge case:** cancelling with no turn in progress is an idempotent
  NO-OP — there's no task to kill nor pending `from` to reply to.
  Cancellation does NOT undo a side effect that already ran BEFORE the task
  died (e.g., a tool that had already been dispatched and recorded its
  event) — it only interrupts what hasn't happened yet.
- **Origin:** this session's investigation; no dedicated ADR (a concurrency
  pattern change INSIDE the harness, not a layer/database boundary).

### RN-142 — Confirming readiness with NO business rule at all is refused by the engine, not just hidden in the UI {#rn-142}

Before, clicking "I'm ready to produce" — or calling the route directly —
ALWAYS created the `product_brief` and offered the handoff to the PO, even
in a conversation where zero business rules had been captured.
`business_rule_refs(state)` already existed in `criativo_server.ex`, but
only to POPULATE the brief's `"rules"` field — never as a blocking
condition. In the UI, `SessionPage.tsx` disabled the button only during
`streaming`, without checking the rule count.

The real guarantee had to live on the server, not on the screen: whoever
calls the route directly (or a future client that isn't this frontend)
can't punch through the guardrail just because the button is drawn
disabled. `CriativoServer.handle_call(:confirm_readiness, ...)` now checks
`business_rule_refs(state)` BEFORE spawning the
`Engine.Agents.TurnoAssincrono` `Task` ([RN-122](#rn-122)) — empty, it
refuses right there, without running the consolidation turn, without a
`product_brief`, without a handoff.

The refusal doesn't turn into an HTTP 4xx:
`agent_command_controller.ex#readiness/2` IGNORES this `GenServer.call`'s
return and always answers 202, the same pattern `message/2` already uses
since RN-122 ("this response is just the acknowledgment" — the real
outcome lives in the event log). That's why the refusal is narrated as a
DURABLE `agent.error` (RN-059), with origin `"politica"` (policy — it's a
product decision, not an infra/model/turn failure) — and a message
explaining why; the session thread already knows how to render this event
type (`lerFalhaDeTurno`, the same red bubble as any other turn failure).

The complementary UX, in `SessionPage.tsx`: the button is born `disabled`
(with a `title` explaining why) while `events` has no
`artifact.business_rule` — the SAME source that already feeds the
"Business rules" panel (`ContextAside`), with no second read that could
diverge from the first.

- **Where:** `apps/engine/lib/engine/agents/criativo_server.ex`
  (`handle_call(:confirm_readiness, ...)`, `emit_falha_sem_regra/1`),
  `apps/web/src/routes/SessionPage.tsx` (`hasBusinessRule`, the "I'm ready
  to produce" button)
- **Test:**
  `apps/engine/test/engine/agents/criativo_server_test.exs` ("readiness:
  refuses when NO business rule was captured" — no turn, no brief, no
  handoff; the refusal narrated with origin `"politica"`),
  `apps/web/src/routes/SessionPage.readiness-exige-regra.test.tsx` (button
  disabled with no rule, enabled with 1+)
- **Edge case:** the session already had `readiness.confirmed` recorded by
  the api BEFORE signaling the engine (`ConfirmReadinessUseCase`) — that
  doesn't change: it's the record of the user's CLICK, a fact that happened
  independent of the engine accepting or refusing afterward.
- **Origin:** code investigation confirming a user report — no ADR (new
  guardrail on an already-existing flow, no layer/database boundary
  change).

---

## Action approval

The heart of the system. Every action with an external effect is born as a
`proposed_action`.

### RN-003 — The action has six states, and denied is terminal {#rn-003}

```mermaid
stateDiagram-v2
  [*] --> pending
  [*] --> auto_approved: policy allowed it
  pending --> approved: user approves
  pending --> denied: user denies
  approved --> executed
  approved --> failed
  auto_approved --> executed
  auto_approved --> failed
  denied --> [*]
  executed --> [*]
  failed --> [*]
```

- **Where:** `apps/api/src/domain/actions/action-state-machine.ts:36`
- **Test:** `test/domain/actions/action-state-machine.spec.ts`
- **Edge case:** an approved action that executed becomes `executed`,
  **not** still `approved`. Counting approvals by `status = 'approved'`
  gives the wrong number — the correct criterion is `decided_by IS NOT
  NULL`.

### RN-004 — The decision is evaluated in three stages, and `deny` wins immediately {#rn-004}

Order: **(a) IAM → (b) `agent_autonomy` → (c) `permissions.json`**. Each
stage can only **raise** permissiveness; a silent stage never lowers the
previous one. `deny` at any stage returns immediately.

- **Where:** `apps/api/src/domain/actions/decide.ts:116`
- **Test:** `test/domain/actions/decide.spec.ts` (10 KB — the largest in
  the domain)

### RN-005 — Minimum role per action type {#rn-005}

Before any policy, IAM: each `ActionType` requires a minimum effective
role. Without it, `deny` with an explicit reason.

- **Where:** `apps/api/src/domain/actions/decide.ts:37` (`MIN_ROLE_FOR_ACTION_TYPE`)
- **Test:** `test/domain/actions/decide.spec.ts`

### RN-006 — Ceiling: merge into a protected branch is never auto-approvable {#rn-006}

`dev`, `qa`, `rc`, and `main` are protected. A `git_merge` targeting one of
them is downgraded from `auto_approve` to `require_approval` **after** all
the policy has run. Neither `agent_autonomy` nor `permissions.json` can
promote it.

`rc` stays on the list even after the step left the policy
([ADR 0030](adr/0030-politica-de-branches-mecanizada.md)) and the bootstrap
stopped creating it ([RN-029](#rn-029)). This list decides what the lock
**refuses**, and repositories bootstrapped by earlier versions still have
the branch: protecting one that doesn't exist costs nothing; unprotecting
one that exists costs dearly.

- **Where:** `apps/api/src/domain/actions/decide.ts:149` + `protected-branches.ts:4`
- **Test:** `test/domain/actions/decide.spec.ts`
- **Origin:** [ADR 0011](adr/0011-infra-dev-agents-worktrees-merge-lock.md) §1
- **Note:** the equivalent protection **on the platform** (GitHub/GitLab)
  diverges between providers and isn't the gate — see
  [ADR 0028](adr/0028-protecao-de-branch-divergencia-entre-providers.md).

### RN-007 — Ceiling: an instruction patch is never auto-approvable {#rn-007}

Changing an agent's instruction always requires a human decision. The
feature's value is in the human seeing the diff; auto-approving would be
the agent rewriting itself.

- **Where:** `apps/api/src/domain/actions/decide.ts:166`
- **Test:** `test/domain/actions/decide.spec.ts`
- **Origin:** [ADR 0016](adr/0016-anamnese-proficiencia-patches-instrucao.md) §8

### RN-008 — Command matching is by pattern, not substring {#rn-008}

`permissions.json` matches a terminal command by structured pattern, with
the command properly tokenized — not by `includes()`.

- **Where:** `apps/api/src/domain/actions/command-matcher.ts`
- **Test:** `test/domain/actions/command-matcher.spec.ts`

---

## Backlog

### RN-009 — The story has four states, and `done` is terminal {#rn-009}

`draft → ready → in_progress → done`. Rework is allowed: `ready → draft` and
`in_progress → ready`.

```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> ready: passes readiness check (RN-010)
  ready --> in_progress
  ready --> draft: rework
  in_progress --> done
  in_progress --> ready: returned
  done --> [*]
```

- **Where:** `apps/api/src/domain/backlog/story-state-machine.ts:27`
- **Test:** `test/domain/backlog/story-state-machine.spec.ts`

### RN-010 — `draft → ready` requires four things, validated in the domain {#rn-010}

For a story to become `ready` it needs, **all of them**:

1. `dod` not empty — Definition of Done
2. `dor` not empty — Definition of Ready
3. at least 1 functional requirement (`rf`)
4. at least 1 linked business rule (`businessRuleIds`)

The error names **exactly what's missing**, not a generic "invalid".

- **Where:** `apps/api/src/domain/backlog/story-readiness.ts:39`
- **Test:** `test/domain/backlog/story-readiness.spec.ts`
- **Origin:** [ADR 0009](adr/0009-agente-po-backlog-rastreabilidade.md) §3
- **Why:** it's what stops the PO from dumping a vague story into the dev
  queue.

### RN-011 — Business rule with no story is a finding, not an error {#rn-011}

Rule→story coverage is computed, and what has no story shows up as
**pending** — information, not a failure.

- **Where:** `apps/api/src/domain/backlog/coverage.ts`
- **Test:** `test/domain/backlog/coverage.spec.ts`

### RN-012 — A module removed from `module_map` demotes the story {#rn-012}

A story linked to a module that ceased to exist goes back to `draft`, with
a `backlog.story_demoted` event.

- **Where:** `apps/api/src/domain/architecture/module-resolution.ts`; the
  event is emitted in
  `application/use-cases/architecture/create-module-map.use-case.ts:73`
- **Test:** `test/domain/architecture/module-resolution.spec.ts`

### RN-013 — The module graph cannot have a cycle {#rn-013}

- **Where:** `apps/api/src/domain/architecture/module-graph.ts`
- **Test:** `test/domain/architecture/module-graph.spec.ts`

---

## PR Gates

### RN-014 — The gate order is immutable and `awaiting_user` is terminal {#rn-014}

`awaiting_qa → awaiting_secops → awaiting_user`. Approving QA **never**
skips straight to the user. `changes_requested` sends it back to the dev
**on the same branch**, with no new PR.

```mermaid
stateDiagram-v2
  [*] --> awaiting_qa
  awaiting_qa --> awaiting_secops: QA approves
  awaiting_qa --> awaiting_qa: changes_requested (back to dev)
  awaiting_secops --> awaiting_user: SecOps approves
  awaiting_secops --> awaiting_secops: changes_requested
  awaiting_user --> [*]: merge is the human's
```

- **Where:** `apps/api/src/domain/execution/pr-gate-state-machine.ts:24`
- **Test:** `test/domain/execution/pr-gate-state-machine.spec.ts`
- **Origin:** [ADR 0013](adr/0013-gates-qa-secops-pr.md) §1
- **Edge case:** `awaiting_user` is terminal **by design** — the system
  never merges (RN-006).

### RN-015 — Cycle K: the correction ceiling is finite and inherited {#rn-015}

Every gate return consumes a lap. Once the ceiling is exhausted, the task
is **blocked** with a reason, instead of spinning forever. A subagent
created by parallelization **inherits** the base agent's ceiling.

Since Phase 8b the ceiling also applies to the QA AREA, with no code
change: `QaLeadServer` is the only caller of `record_gate_verdict`, so one
gate round — no matter how many specializations it consulted underneath —
still consumes exactly ONE lap. See
[RN-036](#rn-036).

- **Where:** `DEFAULT_MAX_GATE_CORRECTIONS = 3` in
  `apps/api/src/application/use-cases/execution/record-gate-verdict.use-case.ts:21`;
  applied in `activate-execution.use-case.ts:85` and, in the engine, in
  `qa_lead_server.ex:268` and `secops_agent_server.ex:142`
- **Test:** `apps/engine/test/engine/gates/qa_automacao_agent_test.exs`
  (the specialization returns `{:blocked, ...}` without calling the api)
  and `qa_lead_server_test.exs` (the Lead NEVER calls
  `record_gate_verdict` in that case — that's what stops the correction
  from being burned)
- **Origin:** [ADR 0017](adr/0017-lock-de-workspace-e-monitor-de-dev-agents.md) §4

### RN-016 — The gate's verdict prevails over the task's statement {#rn-016}

If the task description says one thing and the gate's verdict says
another, the verdict wins.

Since Phase 8b, "the verdict" can come from two specializations — the rule
doesn't change: each one prevails over the task WITHIN what it evaluates
(Automation over test coverage; Performance/Security over performance NFRs
and code findings). `QaLead.consolidar/1` doesn't arbitrate between them
and the task: any `changes_requested` from any of them already fails the
whole thing (see [RN-036](#rn-036)).

- **Where:** prompt for each specialization in
  `apps/engine/lib/engine/gates/qa_automacao_agent.ex` and
  `qa_performance_seguranca_agent.ex`
- **Origin:** [ADR 0020](adr/0020-destravar-gates-qa-secops.md) §9

### RN-036 — QA becomes an area: the Lead consolidates without changing the gate's contract {#rn-036}

The Automation specialization (Phase 4a's `QAAgent`) always delegates;
Performance/Security only when the story has a pertinent performance NFR
(`Engine.Gates.QaLead.rnf_de_performance?/1` — a keyword heuristic, not
NLP). The decision NOT to delegate is always recorded — a `dispensed`
delegation with a justification, never silence.

Consolidation: `approved` only if ALL delegations that ran approved; any
`changes_requested` fails the whole thing, with `itens` (items) from the
specialization(s) that requested changes, each item prefixed with the
label of whoever raised it (`"[QA de Automação] ..."`) — that's how the
origin is traced WITHOUT changing `itens` from `string[]` to another
shape. Delegation failure (any origin — `infra`, `modelo`, `codigo`,
`politica`) NEVER becomes `changes_requested`: the Lead blocks the task
with the real origin (RN-015).

The `qa_verdict` that reaches the api is the SAME artifact and goes
through the SAME route as always (`RecordGateVerdictUseCase`,
`nextGateStatus`) — neither of the two changed. What the api learns about
the area lives only in the `delegation.completed`/`delegation.failed`/
`delegation.dispensed` events, which the specialization and the Lead
record separately.

- **Where:** `apps/engine/lib/engine/gates/qa_lead.ex` (`consolidar/1`,
  `rnf_de_performance?/1`), `qa_lead_server.ex` (the wiring);
  `apps/api/src/application/use-cases/execution/record-delegation.use-case.ts`;
  `apps/api/src/db/schema.ts` (table `delegations`, enum `failure_origin`)
- **Test:** `apps/engine/test/engine/gates/qa_lead_test.exs` (the pure
  decision tree), `qa_lead_server_test.exs` (the wiring: decision →
  delegation → recording → consolidation → the SAME call as always), and —
  the proof that the contract didn't change —
  `record-gate-verdict.use-case.spec.ts`, `pr-gate-state-machine.spec.ts`
  and `record-infra-gate-verdict.use-case.spec.ts` pass **with no change
  at all**
- **Origin:** [ADR 0038](adr/0038-hierarquia-de-agentes.md)

On the `apps/web` side (Phase 8d): the team panel groups `qa`/
`qa-automacao`/`qa-performance-seguranca` as lead + collapsible
specializations, the PR timeline expands the consolidated verdict into
its internals (`ProjectApprovalsTab.tsx`, `PrGateTimeline.tsx`), and the
feed narrates `delegation.*` — see `apps/web/src/lib/agents.ts`
(`AREAS`/`areaFor`).

---

### RN-054 — External handoff addresses the area's lead or an agent with no area — never a subagent {#rn-054}

Whoever talks to an area **from outside** talks to the lead. A handoff
addressed to a subagent (`qa-automacao`, `qa-performance-seguranca`,
`infra-workflows`) is refused with a typed error that **names the lead**
the caller should have addressed — refusing without saying the right path
would just trade a hierarchy breach for a stuck agent.

The refusal happens **before** the INSERT. Refusing afterward would leave
a ghost handoff in the table and a `handoff.offered` — an immutable
event — asserting an offer the policy doesn't allow.

Internal delegation (lead → subagent) does **not** go through here: it's
private to the area, has its own table (`delegations`) and its own path
(`RecordDelegationUseCase`). The rule is about the area's external
boundary, not about what happens inside it.

ADR 0038 called for this validation, naming the place —
`CreateHandoffUseCase` is the only one in the system that writes
`toAgent` — and it had never been implemented (finding #12 of the first
dogfooding). The engine's `offer_handoff` passed `to_agent` through as a
free string, so until now nothing stopped an agent from breaching the
hierarchy.

**Area, lead, and members have ONE source** since PHASE 18:
`apps/api/src/domain/agents/agent-areas.ts`. The list used to be
hand-written in three places (api, web, engine) and the test only
compared api against web — the engine silently diverged. Now
`apps/web/src/lib/agent-areas.generated.ts` and
`apps/engine/lib/engine/agents/areas.ex` are produced by
`pnpm --filter api gerar:areas`, and the test fails what's stale on disk.
The list is still the CATALOG; `agent_areas` is the per-project STATE
(RN-094), and the two answer different questions.

- **Where:** `apps/api/src/domain/agents/agent-areas.ts`
  (`assertHandoffTargetAllowed`, `HandoffToSubagentError`),
  `apps/api/src/application/use-cases/agents/create-handoff.use-case.ts`
- **Test:** `test/domain/agents/agent-areas.spec.ts` (the rule + the check
  that the derived copies don't diverge from the source),
  `test/application/use-cases/agents/create-handoff.use-case.spec.ts`
  (refusal with no row and no event)
- **Origin:** [ADR 0038](adr/0038-hierarquia-de-agentes.md), closed from
  finding #12 of the [first dogfooding](explanation/primeiro-dogfooding.md)

---

### RN-037 — Infra becomes an area: Workflows generates CI per provider, Lead consolidates into a single PR {#rn-037}

Second instance of the ADR 0038 model, after the QA area (RN-036) — with
one structural difference: the Infra area's two delegations ALWAYS run
(Dockerfiles/compose by the Lead itself — "delegates to itself"; CI
pipeline by the Workflows subagent), never is one dispensed. `Workflows`
decides the pipeline format from the context's `gitProvider`
(`GetInfraContextUseCase`, read from `project_repositories.provider` —
**not** from `GitProvider` `capabilities`, which are the SAME for GitHub
and GitLab): `"gitlab"` generates `.gitlab-ci.yml`; any other value
(`"github"`, `"local"`, or unknown) generates `.github/workflows/ci.yml`.
Each file goes through `validate_infra_file` before finishing — hadolint
for Dockerfile, `actionlint` for GitHub Actions workflow
([ADR 0039](adr/0039-actionlint-e-validacao-do-pipeline-de-ci-gerado.md);
`.gitlab-ci.yml` has no local validation, a documented gap, not a
half-solution).

Consolidation: the two delegates' files are merged by `path` (Workflows'
wins on collision) into a SINGLE PR — the mechanism to propose the PR
(`propose_infra_pr`) changes from "the tool calls the api directly" to
"the tool signals the Lead, which consolidates and calls once" — the
`open_infra_pr` the api receives is the SAME as always, byte for byte
(`ExecuteInfraPrUseCase` untouched). Failure of any delegate (origin
`infra`/`modelo`/`codigo`/`politica`) NEVER opens a partial PR — the same
rule as RN-036, one level up again.

Each delegate (even the Lead, on itself) is tracked as a `delegations`
row — reused exactly as RN-036 left it, with ONE correction: the
`task_id` column became NULLABLE (the Infra area delegates on the
SESSION, with no backlog task behind an infra PR), and the route
`POST /internal/sessions/:sessionId/delegations` stopped being nested
under `/tasks/:taskId` — `taskId` now goes in the body, optional. Cycle K
and budget have no dedicated column in the Infra area (the original
InfraAgent never had per-task budget, and this work didn't introduce
one).

- **Where:** `apps/engine/lib/engine/infra/infra_lead.ex` (`consolidar/2`),
  `infra_lead_server.ex` (the wiring), `workflows_agent.ex`,
  `tools/validate_infra_file.ex` (dispatch by extension),
  `apps/api/src/application/use-cases/execution/get-infra-context.use-case.ts`
  (`gitProvider`), `record-delegation.use-case.ts` (`taskId` optional)
- **Test:** `apps/engine/test/engine/infra/infra_lead_test.exs` (the merge
  and the block, pure), `infra_lead_server_test.exs` (the wiring: single
  PR with both file sets, two delegations, `gitProvider: "gitlab"` →
  `.gitlab-ci.yml`, Workflows failure → no PR), `workflows_agent_test.exs`
  — and the proof that the `ExecuteInfraPrUseCase`/`InfraGateRunner`
  contract didn't change: `execute-infra-pr.use-case.spec.ts` and
  `infra_gate_runner_test.exs` pass **with no change at all**
- **Origin:** [ADR 0038](adr/0038-hierarquia-de-agentes.md), [ADR 0039](adr/0039-actionlint-e-validacao-do-pipeline-de-ci-gerado.md)

On the `apps/web` side (Phase 8d): the team panel groups `infra`/
`infra-workflows` the same way as QA (RN-036), and the feed narrates the
area's delegations — the same `AREAS`/`areaFor` registry from
`apps/web/src/lib/agents.ts`, with no Infra-specific code in the UI.

---

### RN-140 — A gate cycle that dies mid-way resumes on its own, with no manual intervention {#rn-140}

`QaLeadServer`/`SecOpsAgentServer` are `restart: :temporary`, and the
gate's intermediate transitions (`DevAgentServer.correct/3`,
`Dispatcher.run_secops/2`) are direct in-memory calls — made AFTER
`record_gate_verdict` has already durably advanced `gate_status` on the
api. A crash between the two used to trap the PR forever in
`awaiting_qa`/`awaiting_secops`: nothing knew that step had been left
pending, and no engine restart fixed it — [ADR 0057](adr/0057-o-gate-espera-a-aprovacao.md)
itself already declared suspension in `{:awaiting, ...}` as a known
limit, and investigating again found that the window between a recorded
verdict and a dispatch call is, in practice, easier to hit.

`gate_states` (schema `engine`, key `{project_id, task_id, gate}`)
records the in-flight cycle at the SAME points where the transitions
already happened — `"in_progress"` before any subagent/scanner runs,
`"dispatch_pending"` right after `record_gate_verdict` returns
`correct`/`run_secops` and before the in-process call.
`Engine.Gates.GateRescuer` scans rows stuck for more than 15 minutes
(configurable, `GATE_RESCUE_STALE_AFTER_SECONDS`) — generous on purpose,
because a QA subagent's ToolLoop legitimately runs up to
`TOOL_LOOP_MAX_ITERATIONS_GATE` (60) iterations, and a short threshold
would rescue (and duplicate) a cycle that's merely slow — and resumes:
`"in_progress"` restarts the whole area (no surgical resumption of
`ctx`, which doesn't survive a restart, the same choice as the dev
agent); `"dispatch_pending"` resends exactly the lost call. Called on
boot and by an Oban tick self-rescheduled every 5 minutes
(`GATE_RESCUE_INTERVAL_SECONDS`),
`Engine.Workers.GateRescueSchedulerWorker` — the same idiom as
`ModelSyncSchedulerWorker`/`AnamneseSchedulerWorker`.

Two guards against duplicating work: a process alive ON THE SAME node
(`Registry.lookup`) is never disturbed, and the staleness threshold
covers what the local guard doesn't reach (remote replica — `Registry`
is local to the node, the same caveat as `Engine.Dev.Wake` since
[ADR 0045](adr/0045-reagendamento-por-evento-do-dev-agent.md)). The
worst outcome of a residual race is duplicated, cheap work — the api
rejects a second `record_gate_verdict` for a gate that no longer owns
`gate_status` (`nextGateStatus`), and `DevAgentServer.correct/3` is
already idempotent via a state guard since ADR 0052 — never
inconsistent data.

- **Where:** `apps/engine/lib/engine/gates/gate_state.ex`,
  `gate_rescuer.ex`, the write points in `qa_lead_server.ex`
  (`run_area/3`, `apply_gate_result/6`) and `secops_agent_server.ex`
  (`run_secops/3`, `apply_verdict/6`), and
  `apps/engine/lib/engine/workers/gate_rescue_scheduler_worker.ex`
- **Test:** `apps/engine/test/engine/gates/gate_rescuer_test.exs` — kills a
  real `QaLeadServer` with the cycle in flight
  (`DynamicSupervisor.terminate_child/2`, the durable row surviving the
  process) and proves `GateRescuer.run/0` reconnects the area on its own
  up to a real outcome; the scenario in the statement (lost
  `run_secops`) and the lost `correct` return, both with REAL process and
  dispatch, no `FakeGateDispatcher`; and the two guards (a live local
  process isn't disturbed; a recent row isn't touched)
- **Origin:** [ADR 0067](adr/0067-o-gate-sobrevive-ao-restart.md), which
  extends [ADR 0057](adr/0057-o-gate-espera-a-aprovacao.md)

---

## Cost

### RN-017 — Budget has an exclusive scope: project **or** session {#rn-017}

A `budget` references a project or a session, never both — guaranteed by
a `check` in the database, not just in code.

- **Where:** `apps/api/src/db/schema.ts` (`budgets_scope_check`)
- **Test:** the constraint is the guarantee

### RN-018 — Budget notification at 70%, 90%, and 100%, without repeating {#rn-018}

Each threshold fires **once**; the last one notified is persisted in
`budgets.last_threshold_notified`.

- **Where:** `apps/api/src/domain/llm/budget-threshold.ts:1`
- **Test:** `test/domain/llm/budget-threshold.spec.ts`

### RN-019 — `policy = 'block'` refuses the call; `'allow'` only records {#rn-019}

- **Where:** `apps/api/src/domain/llm/budget-threshold.ts:4`
- **Edge case:** a project in `allow` **doesn't stop itself** at the
  ceiling. It's the most common cause of "the budget didn't hold" — see
  the [runbook](runbook.md).

### RN-020 — The model is resolved by cascade, from most specific to most general {#rn-020}

`session > agent > area > project > workspace`. The first one that
exists wins. `area` entered in PHASE 23 — see [RN-102](#rn-102) for its
position and what changes for whoever already read this cascade.

- **Where:** `apps/api/src/domain/llm/binding-resolver.ts`
- **Test:** `test/domain/llm/binding-resolver.spec.ts`

### RN-040 — Agent binding requires native tool calling {#rn-040}

Binding a model to an **agent** (`scope = 'agent'`) is only allowed if the
model has `supports_tool_calling`. An agent only exists inside the
ToolLoop, and the ToolLoop only works if the model knows how to
**request** tools; without that, the failure would show up downstream as
"the agent stopped without finishing", which is exactly the
diagnosis-by-elimination that [ADR 0020](adr/0020-destravar-gates-qa-secops.md)
forbade. The refusal is a 422 and the message points to the **"fit for
agents"** filter — without that pointer the rule becomes a dead end.

The engine's `ToolCallRecovery` recovers calls the model wrote in prose,
but it's a **rescue, not a license**: it depends on the model getting the
format right by chance.

Only `agent` validates. `workspace` and `project` are the human chat's
fallback and `session` is conversation — none of them run a ToolLoop, and
locking them would forbid chat-only models in the product. The
`context-manager` agent is covered by construction: it's a slug
**within** the `agent` scope, not its own scope.

- **Where:** `apps/api/src/domain/llm/model-capabilities.ts:38`
- **Test:** `test/domain/llm/model-capabilities.spec.ts`,
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`
- **Origin:** [ADR 0041](adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)

### RN-041 — Token count the provider didn't give is marked as estimated {#rn-041}

When the provider's response doesn't carry `usage`, the OpenAI-compatible
base counts locally with the tokenizer and emits the chunk with
`estimated: true`. The number still serves for billing, but the mark
preserves the difference between **"the provider said zero"** and **"the
provider said nothing"** — and it's what lets the UI qualify the cost
instead of showing a value with no provenance.

The other two providers diverge, and the divergence is normalized, not
hidden: Ollama simply doesn't emit `usage` without the `done` line;
Anthropic can't omit the count, because `usage` is mandatory in its
protocol's `message_start`. The three responses are in
[docs/reference/llm-providers.md](reference/llm-providers.md#normalized-divergences).

- **Where:** `apps/api/src/infrastructure/llm/openai-compatible-provider.ts:150`
- **Test:** `test/contract/llm-provider.contract.ts` (scenario
  `sem_usage`, run against the three providers)
- **Origin:** [ADR 0041](adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)

### RN-042 — Metering records who SERVED the call, not just where it came in {#rn-042}

When the call goes through a hub that reports the real provider,
`token_usage` records that provider in `upstream_provider` in addition to
the entry provider. With no hub — or a hub that didn't report — the field
is **`null`**, never an empty string: the cost-by-provider query needs to
distinguish "didn't go through a hub" from "went through one and the hub
didn't say".

In metrics the `upstream_provider` label repeats the provider itself when
there's no hub, so `sum by (upstream_provider)` keeps summing the whole
cost.

- **Where:** `apps/api/src/application/use-cases/llm/record-llm-usage.use-case.ts:58`
- **Test:** `test/application/use-cases/llm/record-llm-usage.use-case.spec.ts`
- **Origin:** [ADR 0041](adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)

### RN-043 — A discovered model enters disabled; a model that disappears is marked, never deleted {#rn-043}

Catalog sync has three outcomes, and none of them is destructive:

1. **A new model** enters **with no curation row in any workspace**, and
   the absence of a row IS the disabled state. A provider's catalog has
   hundreds of rows — dumping them in active would make choosing
   impossible and would turn on an expensive model without anyone
   deciding. Activating is the owner's curation, and it applies only in
   their workspace ([RN-052](#rn-052)).
2. **A model that disappeared from the remote catalog** receives
   `availability = 'unavailable'` and **stays in the table**:
   `model_bindings` and `token_usage` point to the row, and deleting it
   would take the cost history along with it.
3. **A model that came back** returns to `available` with the curation
   **untouched** — the owner's choice survives a temporary absence from
   the provider.

The two axes are deliberately independent: curation is a person's
decision, `availability` is an observation of the provider. Neither
writes to the other — and since
[ADR 0049](adr/0049-curadoria-de-modelo-por-workspace.md) they don't even
live in the same table, so sync has no curation field to run over even if
it wanted to.

Three consequences in the rest of the system:

- a **NEW** binding for an inactive or unavailable model is refused in
  the domain (`ModelNotBindableError`, 422). Bindings that already exist
  stand;
- `resolveBinding`'s **cascade** skips the unavailable candidate, records
  what it skipped in `skipped`, and — when the turn carries tools —
  revalidates `supports_tool_calling` at EVERY level. Without that, the
  fallback would land an agent on a chat-only model and silently violate
  [RN-040](#rn-040);
- **a provider that failed doesn't make anything unavailable**: a 401 is
  "I don't know what's there", not "there's nothing there". The provider
  is skipped, with the failure's ORIGIN (`infra` | `modelo`) in the
  report — never diagnosis by elimination.

- **Where:** `apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts:160`,
  `apps/api/src/domain/llm/binding-resolver.ts:63`,
  `apps/api/src/domain/llm/model-capabilities.ts:49`
- **Test:** `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`,
  `test/domain/llm/binding-resolver.spec.ts`,
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`
- **Origin:** [ADR 0042](adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)

### RN-044 — Price applies from here on, and old cost still checks out {#rn-044}

Every `token_usage` row records the price that produced its
`cost_micros`. Changing a model's price **doesn't reprice past
consumption** — and more than that: old cost stays **reproducible**,
because `tokens × recorded price` matches the recorded cost even after
three corrections to the `models` table.

Every price change writes a row to `model_price_changes`, append-only,
with the before/after pair and the origin (`manual` | `sync`). The pair
is recorded together on purpose: reconstructing the "before" from the
previous row would depend on no write having escaped the audited path,
which is exactly what the audit exists to prove. A price equal to the
current one is a no-op — a row saying "changed from 10 to 10" would turn
the log into noise.

The rule applies to **every** path that changes price, not just the
screen's. Two writes used to escape it: catalog sync (which changed
price via `upsert`, never producing the `sync` origin the domain had
declared since Phase 9c) and `seed.ts` (which runs on an already-seeded
database — `BRABO_FORCE_SEED=1` in k8s's `bootstrap.sh` — and therefore
silently corrected price). Both now audit, with the seed reusing
`UpdateModelPricingUseCase` itself.

- **Where:** `apps/api/src/application/use-cases/llm/update-model-pricing.use-case.ts:44`,
  `apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts:213`,
  `apps/api/src/db/seed.ts:376`
- **Test:** `test/application/use-cases/llm/update-model-pricing.use-case.spec.ts`,
  `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`
- **Origin:** [ADR 0042](adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)

### RN-189 — Embedding returns one vector per input, or an error {#rn-189}

`embed` is a BATCH operation: it receives N texts and returns N vectors,
**in the same order**. Order is the only link between input and vector,
and that's why a shorter response isn't usable — the i-th vector would
end up belonging to another sentence, and the index would silently go
wrong, with the symptom showing up in SEARCH, weeks later and far from
the cause.

So the contract refuses, rather than degrading, three things: an
incomplete batch, an empty vector, and different dimensions in the same
response. An empty input list is also refused before it goes out over the
network — answering `[]` to it would make the caller record an empty
index thinking it had indexed something.

The result carries four fields, and each answers a question that already
cost dearly somewhere else in the product: `dimensions` is checked
against what CAME BACK (never copied from the catalog); `model` is what
the provider **said** it used, because an alias resolves to a dated
version and it's that name that goes to metering, for the same reason as
the frozen price ([RN-044](#rn-044)); and `inputTokens` comes with
`estimated`, preserving the "the provider said zero" × "the provider said
nothing" distinction from [RN-041](#rn-041).

The error is **thrown**, normalized by `code`, instead of becoming a
chunk like in `chat`. The chunk's reason is to preserve the spend of an
in-progress turn; here there's nothing to preserve — either the provider
returned the vectors and charged, or it didn't return them and didn't
charge. It's the same choice as `listModels`, and the taxonomy is the
same: no new `LLMErrorCode`.

- **Where:** `apps/api/src/application/ports/llm-provider.port.ts:61`,
  `apps/api/src/infrastructure/llm/embedding-result.ts:26`
- **Test:** `test/contract/llm-provider.contract.ts` (five cases, run
  against every provider that declares the capability)
- **Origin:** [ADR 0075](adr/0075-embeddings-no-contrato-de-llm-provider.md)

### RN-190 — Embedding has a capability in two layers, and the model's is exclusion {#rn-190}

As with tool calling ([RN-040](#rn-040)), the capability has two layers:
the PROVIDER (`capabilities.embeddings`, the ceiling) and the MODEL
(`supportsEmbeddings` on the catalog row). The difference between the two
cases is exactly what the rule exists to state:

- **tool calling is a gradient** — a model that doesn't request tools
  still converses, and that's why only the agent binding is refused;
- **embedding is exclusion** — `nomic-embed-text` doesn't answer a
  question and `llama3.2` doesn't return a vector. They're disjoint sets,
  and the Ollama daemon proves it by answering **`501`** ("This server
  does not support embeddings") to an embedding request with a chat
  model.

`assertCanEmbed` checks both in the order that fails best: the provider
first, because switching models doesn't fix a provider that doesn't
embed. A model **with no declaration** is also refused, with a different
message — absence means "the provider didn't say"
([ADR 0041](adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)),
never permission, and the right action for the reader is to sync the
catalog rather than switch models. Deducing the capability from the
model's NAME is forbidden: it would be a guess dressed up as data.

- **Where:** `apps/api/src/domain/llm/embedding-capability.ts:64`,
  `apps/api/src/infrastructure/llm/ollama-provider.ts:319`
- **Test:** `test/domain/llm/embedding-capability.spec.ts`,
  `test/infrastructure/llm/ollama-provider.spec.ts`
- **Origin:** [ADR 0075](adr/0075-embeddings-no-contrato-de-llm-provider.md)

### RN-191 — `embeddings: true` requires execution, not documentation {#rn-191}

The house rule ([ADR 0041](adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)/[ADR 0043](adr/0043-seis-providers-de-llm-e-o-fechamento-da-fase-9b.md))
applied to the new capability: **only `ollama` declares `true`**, and the
proof is `POST /api/embed` run against the real 0.32.1 daemon with
`nomic-embed-text` — two inputs, two 768-dimension vectors,
`prompt_eval_count: 10`.

The other eight declare `false`, for two distinct reasons:

- **lack of proof** (seven): there's no key for them in the environment,
  and the only paid smoke test that has ever run
  ([acceptance](explanation/aceite-providers.md)) was for CHAT — in a
  hub, embedding routes to different providers than chat does, and proof
  of one endpoint isn't proof of the other;
- **operation absent** (Anthropic): there's no dedicated embedding
  endpoint, and its docs point to a third party, which is a different
  provider with a different key and a different dialect.

The OpenAI-compatible base's DIALECT is proven separately, with the
contract suite running a second time over it with the capability turned
on. That's what makes it cheap to flip a provider to `true` the day its
key exists: it changes one line of the literal, and the parsing is
already exercised. A provider that declares `false` and still exposes
the method **refuses the call** before touching the network.

- **Where:** `apps/api/src/infrastructure/llm/ollama-provider.ts:73`,
  `apps/api/src/infrastructure/llm/openai-compatible-provider.ts:302`
- **Test:** `test/contract/llm-provider.contract.ts`,
  `test/infrastructure/llm/openai-compatible-provider.contract.spec.ts`,
  `test/infrastructure/llm/ollama-provider.embeddings.smoke.spec.ts`
  (manual, against the real daemon)
- **Origin:** [ADR 0075](adr/0075-embeddings-no-contrato-de-llm-provider.md)

### RN-045 — An adopted repository is only changed by an approved plan {#rn-045}

Adopting an existing repository **diagnoses without acting**. Adoption
validates access (`getRepo`), writes the project's rows, and produces a
**plan**: the serialized list of what the bootstrap would do, obtained by
calling each step's `check()` — the same one that has provided idempotency
since [RN-029](#rn-029) — without ever running the corresponding
mutation.

While `repo_bootstraps.plan_decision` is **null**, no mutation runs. The
gate is **before** the executor, not inside it: the bootstrap runner is
the same one from Phase 2, with no filter, and it simply isn't called.
Added to the guard that already skipped protected branches, there's no
code path that touches a branch outside an approved plan.

The two outcomes:

- **approve** is all-or-nothing (approving loose steps would break the
  `dev←main, qa←dev` cascade). What executes is the plan
  **re-derived** at execution time: equal to or smaller than the one
  shown, **never larger** — a branch that turned protected in the
  meantime is skipped;
- **adopt as-is** waives the bootstrap, records the decision, and does
  **not** tamper with the cursor to fake convergence. The plan is kept
  as evidence of what was deliberately not applied.

Deciding on a regenerated plan is refused (409): the decision carries the
`planGeneratedAt` the user saw, and a "yes" given about something else
doesn't count.

Normal provisioning refuses (409) to run on an adopted repository —
without this guard, the resumption path would run the bootstrap on a
third party's repository with no plan at all.

**Known limit:** "divergent protection" here is presence × absence,
because that's all the contract exposes (`GitBranch.protected` is a
boolean, and
[ADR 0028](adr/0028-protecao-de-branch-divergencia-entre-providers.md)
deferred a normalized `ProtectionPolicy`). A branch with PARTIAL
protection counts as "unprotected" and can be overwritten — but only
within an approved plan.

- **Where:** `apps/api/src/application/use-cases/git/decide-bootstrap-plan.use-case.ts`,
  `apps/api/src/application/use-cases/git/bootstrap-plan.ts`,
  `apps/api/src/application/use-cases/git/bootstrap-steps.ts:112`
- **Test:** `test/application/use-cases/git/decide-bootstrap-plan.use-case.spec.ts`,
  `test/application/use-cases/git/bootstrap-plan.spec.ts`
- **Origin:** [ADR 0044](adr/0044-adocao-de-repositorio-existente.md)

### RN-046 — Every project repository declares its origin {#rn-046}

`project_repositories.origin` and `repo_bootstraps.origin` say whether
Brabo **created** the repository (`created`) or **adopted** one that
already existed (`adopted`). The origin is written explicitly by whoever
writes the row — not by the column's default — and doesn't change
afterward.

It isn't decoration: it's what makes the product treat as a legitimate
case what Phase 10 had to do by hand (inserting rows into
`project_repositories` and `repo_bootstraps` to point a project at a
fork). An `adopted` repository has its own branch policy, doesn't go
through provisioning, and is only changed per [RN-045](#rn-045).

Migration `0031`'s backfill marks everything that already existed as
`created`, and can be blind about it: adoption didn't exist before it,
so there's no adopted row to misclassify.

- **Where:** `apps/api/src/db/schema.ts`, `apps/api/src/db/migrations/0031_special_winter_soldier.sql`,
  `apps/api/src/domain/git/repo-bootstrap.entity.ts`
- **Test:** `test/application/use-cases/git/adopt-repository.use-case.spec.ts`
- **Origin:** [ADR 0044](adr/0044-adocao-de-repositorio-existente.md)

### RN-047 — Dev agent circuit breaker: N consecutive blocked stops it, without burning budget in a loop {#rn-047}

Each dev agent keeps a counter (`dev_agent_states.consecutive_blocked`)
of how many tasks ENDED `blocked` in a row — locally (in the ToolLoop) or
remotely (the gate's correction ceiling exhausted). On hitting the
per-project ceiling (`max_consecutive_blocked`, default 3), the agent
stops at `idle_tripped` **without trying to claim the next task**. An
approved terminal outcome resets the counter; an individual blocked task
continues the normal flow (returned with a diagnosis, available for a
human to unblock) — the breaker is about the SEQUENCE, not the task.

The only way out of `idle_tripped` is an explicit rearm
(`POST .../agents/:agentId/rearm`, role `developer`): it resets the
counter and the agent starts trying to claim again. There's no automatic
unlock — the same principle as `MarkTaskBlockedUseCase`/`unblock`,
applied to the sequence instead of the task. Rearming an agent that is
**not** tripped is **409**, not silent success: the `dev.rearmed` event
is immutable, and recording it for a rearm that didn't happen would be a
lie in the event log.

A block that comes from OUTSIDE the agent (`QaLeadServer` failing
internally, for example) also needs to wake it — that's why the
`task.gate_resolved` emission lives in `MarkTaskBlockedUseCase`, the
funnel every block passes through, and not in
`RecordGateVerdictUseCase`, which only sees part of them. Without this
the agent would stay in `awaiting_gate` forever, with the task dead and
the breaker's counter never incrementing.

Restarting the engine with an agent in `working` does **not** count
toward the counter: the retained task is blocked with a restart
diagnosis, but that block isn't the agent "burning the ceiling" — it's
the infrastructure going down. The counter only rises when the dev↔gate
cycle itself produces a real `blocked`.

- **Where:** `apps/engine/lib/engine/dev/dev_agent_server.ex` (`finish_task/2`,
  `resume_state/2`), `apps/api/src/application/use-cases/execution/rearm-dev-agent.use-case.ts`,
  `apps/api/src/db/schema.ts` (`projects.max_consecutive_blocked`)
- **Test:** `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  (describe `circuit breaker`), `apps/engine/test/engine/dev/dev_rehydrator_test.exs`
  (describe `the four rehydrated states`), `test/application/use-cases/execution/rearm-dev-agent.use-case.spec.ts`
- **Origin:** [ADR 0045](adr/0045-reagendamento-por-evento-do-dev-agent.md)

### RN-053 — Reactivating execution wakes whoever is stopped, inside the session that already exists {#rn-053}

Activating execution for a project that's **already executing** is
reactivation, not a fresh start: it lands on the current execution
session and wakes the agents that were stopped. Two parts, one on each
side of the system.

**The session is reused.** Activation uses the project's `active` session
that already carries an `execution.activated`; it only creates one when
there's none. There's no column saying "this session is an execution
session" — what distinguishes one is the event it holds, and that's what
gets queried. Closing the session is still the way to start fresh: a
closed one isn't a candidate, and the next activation opens a new one.

Before, `create` was unconditional, and the engine **discards** the new
`session_id` when the agent is already alive. Every click on "activate"
left behind an active session that received the `execution.activated`
and nothing else — the agents' events kept going to the previous
activation's session.

**The agent is woken by wake, not by `work`.** A fresh start triggers the
cycle (`:work` — emits `dev.started` and claims). An agent that was
already alive receives `{:wake, :became_claimable}`, and it's the
server's state guard that decides:

| agent state | what reactivation does |
|---|---|
| `idle` | claims the next task |
| `working`, `awaiting_gate`, `awaiting_approval` | nothing — the in-progress task isn't abandoned |
| `idle_tripped` | nothing — only the explicit rearm unlocks it ([RN-047](#rn-047)) |

Firing `:work` for everyone would be worse than the defect: it claims
unconditionally, and for an `awaiting_gate` agent it would mean dropping
the worktree the gate is sweeping — on top of bypassing the circuit
breaker with a click.

- **Where:** `apps/api/src/application/use-cases/execution/activate-execution.use-case.ts`,
  `apps/api/src/infrastructure/persistence/drizzle/session.repository.ts`
  (`findActiveExecutionSession`),
  `apps/engine/lib/engine_web/controllers/execution_command_controller.ex`
  (`acordar/4`)
- **Test:** `test/application/use-cases/execution/activate-execution.use-case.spec.ts`
  (describe `reactivation doesn't open an orphan session`),
  `test/infrastructure/persistence/session-execution.repository.spec.ts`,
  `apps/engine/test/engine_web/controllers/execution_command_controller_test.exs`
  (describe `reactivation`)
- **Origin:** finding #11 of the
  [first dogfooding](explanation/primeiro-dogfooding.md)

### RN-048 — Story promotion is the user's by default; the mode changes who triggers it, never what gets validated {#rn-048}

`projects.story_promotion` chooses WHO promotes a story from `draft` to
`ready`:

- **`manual`** (new project's default): the PO leaves the story complete
  and it stays `draft` with `stories.proposed_ready = true`. **None of
  its tasks are claimable** — `claimNext` requires `story.status =
  'ready'` — and it's the user who promotes it, individually or in
  batch, from the Backlog.
- **`auto`**: the PO promotes on its own upon finishing a complete story.
  This is the behavior that predates Phase 12c, kept as an explicit
  option.

**The mode changes the trigger, not the criterion.** Both paths go
through `assertPromotable` — readiness (RF/DoD/DoR/rule) and modules
resolved against the current `module_map` — and that's what the symmetry
test in `story-promotion.spec.ts` locks down: for every story,
`isPromotable` agrees with what `assertPromotable` raises. Before the
phase, validation was duplicated and asymmetric (creation called
`canBecomeReady`, transition called `assertReady` +
`assertModulesResolved`): two doors to the same state, with different
locks. Making the trigger configurable required unifying them first, or
else "promote via the UI" and "promote on creation" would be distinct
rules with the same name.

An **incomplete** story is never proposed. `proposed_ready` only turns on
when the story would already pass validation — proposing what the domain
would refuse would push the PO's work onto the user disguised as a
decision.

**Refusal** returns the story to the PO: it records
`returned_reason`/`returned_at`, turns off `proposed_ready`, emits
`backlog.story_promotion_returned`, and injects the reason as a PINNED
message in the PO's session, with the same precedence wording as a gate
returned to the dev (a lesson from ADR 0020). The refusal is recorded
**before** talking to the engine, and the engine failing doesn't undo
it — it's the reverse of the rearm order in [RN-047](#rn-047), and for a
reason: there the event asserts something ABOUT the engine, here it
asserts something about the user, which is true whether or not there's a
PO standing by to listen.

Batch promotion is **not all-or-nothing**: each story is its own
transaction, and one that lost readiness between the proposal and the
decision comes back `failed` with the reason, without knocking down the
others the user just reviewed.

The `backlog.story_transitioned` event records the **real actor** —
`user` on manual promotion, `agent/po` on automatic. The event log is
immutable and it's what the audit reads: recording the PO on a user's
decision would erase exactly the human step the rule exists to give
back.

Migration `0033` does a **directed** backfill, not a blind one: the
column is born `manual` and every project that already existed is moved
to `auto`. The new default applies to whoever comes afterward; an
in-progress project can't stop producing because of a deploy.

- **Where:** `apps/api/src/domain/backlog/story-promotion.ts`,
  `apps/api/src/db/migrations/0033_absurd_domino.sql`,
  `apps/api/src/application/use-cases/backlog/promote-stories.use-case.ts`,
  `apps/api/src/application/use-cases/backlog/return-story.use-case.ts`,
  `apps/engine/lib/engine/agents/po_server.ex` (`revision_message/1`)
- **Test:** `test/domain/backlog/story-promotion.spec.ts` (symmetry),
  `test/db/story-promotion-migration.spec.ts` (directed backfill),
  `test/application/use-cases/backlog/promote-stories.use-case.spec.ts`,
  `test/application/use-cases/backlog/return-story.use-case.spec.ts`,
  `apps/engine/test/engine/agents/po_server_test.exs` (describe `revise/2`)
- **Origin:** [ADR 0046](adr/0046-promocao-de-story-com-autoridade-do-usuario.md)

### RN-049 — Every decision on a proposed action stays in the event log, with who decided {#rn-049}

`proposed_action.created`, `.approved`, and `.denied` are domain events in
`session_events`, in addition to the outbox rows that carry them to the
engine. The outbox is **not** memory: it's drained, marked with
`processed_at`, and pruned.

`actor` is who really decided — the **user** on `.approved`/`.denied`,
the **agent** that proposed on `.created`. And `created.payload.status`
says how the action was born (`pending`, `auto_approved`, `denied`).

That yields the distinction that gives the metric: **human decision =
`proposed_action.approved` event**; policy deciding alone shows up only
in `.created` with `status: auto_approved` and an agent actor, and is
never confused with a click. That count — "approval clicks" — was
exactly what Phase 10 wanted to measure and couldn't, because the
decision existed nowhere queryable (finding #17). `approve_always`
counts as an approval because it delegates to the same use case, and
emits `permission.granted` on top.

Left out, by decision: the `proposed_action.created` that the repository
bootstrap emits directly to the outbox. Those mutations are already
narrated by `bootstrap.step_*` in the same session, and duplicating them
would count the same fact twice in an approval metric.

- **Where:** `apps/api/src/application/use-cases/actions/propose-action.use-case.ts`,
  `.../approve-action.use-case.ts`, `.../deny-action.use-case.ts`
- **Test:** `test/application/use-cases/actions/approve-deny-action.use-case.spec.ts`
  (describe `the decision in the event log`)
- **Origin:** [ADR 0048](adr/0048-decisao-no-log-e-a-ordem-do-gate.md)

### RN-050 — With no PR open, no gate opens {#rn-050}

The dev agent proposes commit, push, and PR and **reads each one's
outcome**. It only opens the gate if all three executed. If one stayed
`pending` — the agent's autonomy at `require_approval` — it enters
`awaiting_approval`, **holding the worktree**, and opens no gate at all.

Without this the gate opened regardless, and the damage was silent: QA
scans the **worktree**, not the PR; it found the files, approved; SecOps
approved; the task closed as completed — **with not one line committed
and no PR at all**. Only later, when approving the commit, would the
user see the action fail (with an empty diagnosis, because
`System.cmd` on a deleted directory returns `{"", 2}`).

What releases the agent is `task.pr_settled`, emitted by the api when
`pr_open` reaches a terminal outcome: `opened: true` opens the gate;
`opened: false` (denied or failed) returns the task with a diagnosis,
instead of leaving the agent waiting forever for a gate no one is going
to open.

A denied PR **doesn't count toward the circuit breaker** of
[RN-047](#rn-047): the decision was the user's, not the agent burning
the ceiling — the same principle as restart recovery.

This rule also eliminates D5 (worktree recycled under pending approval)
as a consequence: the worktree is only released on `gate_resolved`, the
gate only opens after the PR, and the PR only opens after commit and
push.

- **Where:** `apps/engine/lib/engine/dev/agent_io.ex` (`propose/3`),
  `apps/engine/lib/engine/dev/dev_agent_server.ex` (`abrir_gate/1`,
  `aguardar_aprovacao/2`),
  `apps/api/src/application/use-cases/actions/execute-git-action.use-case.ts`
  (`settlePrOpen`)
- **Test:** `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  (describe `pending approval doesn't open a gate`)
- **Origin:** [ADR 0048](adr/0048-decisao-no-log-e-a-ordem-do-gate.md)

### RN-051 — A manually typed price beats the provider's catalog {#rn-051}

A `models` row with `manual_pricing = true` has a number someone typed
after reading the provider's docs. Catalog sync **doesn't touch it** —
not even when the remote catalog brings its own price. That's what the
schema always said ("whoever syncs price CANNOT overwrite a row marked
here without an explicit decision") and what the code didn't do: the
remote always won whenever it brought a price, and the next sync would
undo the correction of whoever had fixed a wrong number.

The rule exists because for several providers the typed number is the
**only one that exists**: NVIDIA NIM and Bitdeer don't publish
per-token price in any doc
([providers reference](reference/llm-providers.md)), and the seeded
value is a market approximation. Letting the remote catalog overwrite
that would trade one known approximation for another, with no one
deciding.

A NEW model is born with the flag coming from the catalog, not from a
fixed default: discovered **with** a price, `manual_pricing = false`
(the source is the sync, and it's the one keeping the row up to date);
discovered **without** a price, `true` — the row is waiting for someone
to type one, and flagging it already protects that number from the
first catalog that decides to report a price.

- **Where:** `apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts`
  (`resolverPreco`), `apps/api/src/db/schema.ts:507`
- **Test:** `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`
  (`manually typed price beats a catalog that REPORTS a price`)
- **Origin:** [ADR 0042](adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)

### RN-052 — Model curation applies only to the workspace that decided it {#rn-052}

Turning a model on or off in the selector is a decision **of that
workspace**, and doesn't reach its neighbor. The catalog itself stays
global — name, price, window, and capabilities are provider facts, the
same for everyone, and duplicating them per workspace would create N
truths about the same model on top of splitting `token_usage.model_id`
in half.

Before this, `models.is_active` was a column for the whole installation:
whoever clicked "activate" decided for every workspace, and the screen
gave no sign of that at all. The practical effect was one workspace
turning on an expensive model in another's selector — and the spend
showing up in the budget of someone who decided nothing.

Three derived rules:

1. **Absence of a row is the disabled state.** There's no separate
   "never decided" state; a model the sync discovered has no row and
   doesn't show up in the selector ([RN-043](#rn-043)).
2. **Disabling is `UPDATE`, not `DELETE`.** Deleting the row would also
   delete who decided and when. Reads treat both cases as inactive; the
   record exists for whoever audits.
3. **The `agent` and `session` scopes don't check curation.** Neither
   has a workspace anchor — agent binding is by global slug. The check
   receives `null` and only checks availability, leaving the gap
   explicit instead of guessing a workspace.

- **Where:** `apps/api/src/db/schema.ts` (`workspace_models`),
  `apps/api/src/application/use-cases/llm/set-models-active.use-case.ts`,
  `apps/api/src/application/use-cases/llm/set-model-binding.use-case.ts`
  (`workspaceDoEscopo`)
- **Test:** `test/application/use-cases/llm/set-models-active.use-case.spec.ts`
  (`activating in one workspace does NOT turn on the model in its neighbor`)
- **Origin:** [ADR 0049](adr/0049-curadoria-de-modelo-por-workspace.md)

### RN-061 — A TOOL failure is also an event, and goes back to the model {#rn-061}

A tool call's result is never discarded. It becomes `tool.result` in the
event log (`ok`, and when it fails, `erro`), the agent **says** what
happened in the thread, and the reason **goes back to the model** in the
`tool` role — for it to correct and reemit on the next turn. A tool
error is input to the loop, not the end of the line.

The Creative agent was the only one that discarded it
(`_ = EmitArtifact.run(args, state)`) — the PO and the Architect already
fed it back. In a real execution the model emitted `titulo`/`descricao`
against a schema that requires `title`/`description`/`origin`: the
**four business rules from the conversation were refused**, no event was
recorded, and it kept saying "I recorded the rules" with an empty panel.

The tool's description now NAMES each type's required fields, in
English and with a filled-in example — including that
`business_rule.origin` is a **non-empty list** of `seq` from the
messages that originated the rule, not free text. Without that the model
guesses, and guesses in the conversation's language.

It's the same rule as [RN-059](#rn-059) applied to the other failure
path: two policies for the same problem would be two chances to swallow
the error.

- **Where:** `apps/engine/lib/engine/agents/criativo_server.ex` (`dispatch_tool`,
  `realimentar`), `apps/engine/lib/engine/harness/tools/emit_artifact.ex`
  (`descricao/0`), `apps/engine/lib/engine/harness/artifact_schemas.ex`
  (`required/1`)
- **Test:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  (`a refused tool becomes a tool.result with an error, and the agent speaks`)
- **Origin:** PHASE 13b real execution

### RN-065 — One module_map per SESSION; revision is another session {#rn-065}

`create_module_map` refuses a second emission **within the same
session**, with a message stating the next step. Between sessions the
map keeps versioning (`version + 1`, `findCurrent` returns the highest)
— revising architecture is desired behavior.

The distinction is the point: between sessions, a new emission is a
**revision**; within the same one, it's the model **re-deciding from
scratch**. In a real execution the Architect emitted four maps in a row,
with different names and cuts each time —
`greeting`, `hello_core`, `greeting`, `hello-api-core` — and the loop
only ended because the network dropped
(`%Req.TransportError{reason: :timeout}`).

The refusal goes back to the model via the tool-result ([RN-061](#rn-061)):
it reads that one already exists and moves on to
`assign_story_modules`, which is step 2 of its kickoff. That's why the
turn does **not** end when the map is emitted — the Architect still has
three steps ahead (linking stories, proposing an ADR, recording
tensions), and ending there would kill all three.

- **Where:** `apps/api/src/application/use-cases/architecture/create-module-map.use-case.ts`
- **Test:** `test/application/use-cases/architecture/create-module-map.use-case.spec.ts`
  (`refuses the SECOND map of the same session`; and cross-session
  versioning is still proven alongside)
- **Origin:** PHASE 13b real execution

### RN-066 — Every response about modules carries the canonical names {#rn-066}

The Architect **has no tool to read** the current module_map. That's
why the three responses it gets about modules need to state the names:

1. A successful `create_module_map` returns the modules **as the api
   recorded them** — not just the version.
2. A refused `assign_story_modules` lists the **valid** modules, in
   addition to the nonexistent ones.
3. `create_module_map` refused by [RN-065](#rn-065) says **which**
   modules the session already defined, not how many.

With no map at all there are no names to offer, and an empty list reads
as "guess again": that path names the real problem — kickoff step 1 is
missing.

The reason is concrete. In a real execution the Architect emitted the
map (`saudacao`, `api_http`), couldn't reread it, and resorted to brute
force: 18 guesses in a row — `api`, `core`, `http`, `greeting`,
`domain`, `web`, `hello-api`, `hello`, `greeting-api`, `saudacao`,
`app`, `server`, `publico`, `public-api`, `api-publica` — until it hit
**one by luck**. In its own words in the event log: *"I'll figure out
the valid names by testing plausible candidates"*.

The damage wasn't the waste, it was the result: the **four** stories
ended up in the same module (`saudacao`), including the endpoint's,
`api_http` ended up with no story at all, and the outcome asserted
*"All 4 stories were successfully linked to modules"*. Since execution
spins up **one dev agent per module**, the designed architecture
wouldn't be the one built.

The loop from [RN-065](#rn-065) was a symptom of this: the Architect kept
reemitting the map precisely to try to pin down names it couldn't read.

- **Where:** `apps/api/src/application/use-cases/architecture/assign-story-modules.use-case.ts`,
  `apps/api/src/application/use-cases/architecture/create-module-map.use-case.ts`,
  `apps/engine/lib/engine/harness/tools/create_module_map.ex`
- **Test:** `test/application/use-cases/architecture/assign-story-modules.use-case.spec.ts`
  (`the refusal lists the VALID modules`; `with no module_map, it directs
  creating the map`) and
  `create-module-map.use-case.spec.ts` (`the refusal says WHICH modules
  there are`)
- **Origin:** PHASE 13b real execution

### RN-067 — Every session is born emitting `session.created` {#rn-067}

`CreateSessionUseCase` is the **only** place that creates a session. It
emits `session.created` to the outbox **in the same transaction** as the
insert, and it's that event that makes the engine spin up the session's
`SessionServer`.

Whoever called `sessions.create(...)` directly produced a session the
engine never knew about. The effect is a silent cascade:

- the Phoenix channel replies `REFUSED JOIN` forever — the UI only
  complains in the console and keeps retrying every 10 seconds;
- with no channel there's no live update: the thread stays stuck on the
  typing indicator, even with the agent already `idle`;
- no one hits the heartbeat, and since it's the heartbeat that closes
  the session ([RN-064](#rn-064)), it stays `active` **forever**.

Three paths did this: `provision-repository` (two calls),
`adopt-repository`, and `activate-execution` — the last of which creates
the session where the **dev agents** run.

The proof by contrast, from a real execution: the wizard's session had
no `session.created`, had an empty `engine.session_states`, and
`REFUSED JOIN`; the session opened via the normal route had the event,
the state row, and `JOINED`.

The test is about the SOURCE on purpose: a behavior test would prove one
path at a time, and the defect here is the path no one thought of.

- **Where:** `apps/api/src/application/use-cases/sessions/create-session.use-case.ts`
  (the owner), `git/provision-repository.use-case.ts`,
  `git/adopt-repository.use-case.ts`,
  `execution/activate-execution.use-case.ts` (the callers)
- **Test:** `test/application/use-cases/sessions/toda-sessao-emite-created.spec.ts`
  (`only CreateSessionUseCase calls sessions.create`)
- **Origin:** PHASE 13b real execution

### RN-068 — The dev agent reads the worktree without asking permission {#rn-068}

Activating execution seeds two command families into the project's
`allow`: **reading the worktree itself** (`ls`, `pwd`, `find`, `cat`,
`head`, `tail`, `grep`, `wc`, `echo`, `git status`, `git diff`, `git
log`) and **build and test**.

The second already existed: `ReportDone` only lets a PR open after a
`terminal` with `exit 0`. The first was added because the agent
**looks before it builds**, and without it it couldn't get started.

The reason is concrete. A pending `:pipeline` tool returns
`proposed_action <id> status pending` as the RESULT — not the command's
output — and the ToolLoop moves on. On a freshly provisioned repository,
every `ls -la` from the agent fell into approval, taught it nothing, and
burned an iteration. In a real execution the outcome was
`toolloop.limit_reached {iteration: 8, max_iterations: 8}`, task blocked
for "iteration limit reached", with not one line written — and the
approvals the user granted arrived after the loop was exhausted.

Freeing up reads doesn't loosen the pipeline, and that's what the test
asserts: `deny` beats `allow`, `BUILTIN_DENY_PATTERNS` stay active,
matching is by TOKEN prefix (an allowed `ls` doesn't allow `lsof`), and a
composite command requires EVERY segment to match — `ls && rm -rf /`
doesn't pass because of the `ls`.

The allowlist is mitigation, not a solution: it's a list of foreseen
commands and the model invents commands. The structural fix — the agent
WAITING for the decision instead of burning iterations — is in
[ADR 0052](adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md).

- **Where:** `apps/api/src/domain/actions/dev-terminal-patterns.ts`,
  seeded by `application/use-cases/execution/activate-execution.use-case.ts`
- **Test:** `test/domain/actions/dev-terminal-patterns.spec.ts`
  (`allows ls -la`; `a composite command doesn't hitch a ride on the
  allowed segment`)
- **Origin:** PHASE 13b real execution

### RN-143 — A read-only git subcommand is only allowed anchored by the flag that makes the read unambiguous, never by the bare verb {#rn-143}

Querying a real execution's database, dev agents burned dozens of manual
approvals on exploration subcommands — `git branch -a`, `git
remote -v`, `git worktree list`, `git show origin/dev --stat`, `git log
--all --oneline --graph`, `git for-each-ref`, `git ls-tree -r origin/dev
--name-only`, `git config user.name` — none covered by [RN-068](#rn-068),
which only allowed `git status`/`diff`/`log` (with no extra flags).
Since prefix-by-token matching requires EVERY segment of a composite
command to be in `allow`, a long exploration chain fell entirely into
`require_approval` the moment ONE of these subcommands showed up in the
middle.

`DEV_TERMINAL_ALLOW_PATTERNS` gained
`git branch -a/-r/-v/--list/--show-current`, `git remote -v`/`git remote
show`, `git worktree list`, `git show`, `git for-each-ref`, `git
ls-tree`, `git rev-parse`, and `git config --get`. `git log` didn't need
a new pattern: matching is already by token PREFIX (extra trailing
tokens are allowed), so `Terminal(git log)` already covered `git log
--all --graph --oneline --decorate`.

**The caution here is the same one RN-068 already shows for
`ls`/`lsof`, applied to verbs with a MUTATING sibling that accepts the
same truncated form of the pattern.** `Terminal(git branch)` would match
`git branch -D nome` (deletes) just as much as `git branch nome-nova`
(creates) or `git branch` alone — the pattern doesn't see what comes
AFTER the prefix it checked. That's why none of the four verbs with a
mutating form (`branch`, `remote`, `worktree`, `config`) was admitted by
the bare verb; each was ANCHORED by the flag that makes the read
unambiguous regardless of anything that follows it:

- `git branch` — anchored on `-a`/`-r`/`-v`/`--list`/`--show-current`,
  never the verb alone; `-D`/`-d`/`-m`/`-M` (delete/rename) and a bare
  branch name (create) stay out.
- `git remote` — anchored on `-v` and `show` (which only accepts a
  remote name afterward, always a read); `add`/`remove`/`set-url` stay
  out.
- `git worktree` — anchored on `list`; `add`/`remove`/`prune` stay out.
- `git config` — only `--get` was admitted, because it's the only flag
  git itself guarantees is a read regardless of what follows (a key, or
  a key + value pattern). `git config user.name`/`git config
  user.email` WITHOUT `--get` were deliberately left out: a second
  token after the key (`git config user.name "new value"`) is a WRITE,
  and prefix matching doesn't distinguish "no more tokens" from "one
  more token" without inventing a new argument-counting parser — the
  same limitation that already blocks a bare `git branch`.
  `--global`/`--system` were never anchored.

- **Where:** `apps/api/src/domain/actions/dev-terminal-patterns.ts`
- **Test:** `test/domain/actions/dev-terminal-patterns.spec.ts` (describe
  `read-only git subcommands (found live)` — covers the composite chain
  observed live auto-approving, and each mutating variant with the SAME
  command word — `git branch -D`, `git remote add`, `git worktree add`,
  `git config --global user.name` — staying in `require_approval`)
- **Origin:** query against a real session's database, found during use

### RN-069 — Retrying a task recreates the branch, doesn't fail {#rn-069}

`WorktreeManager.add_worktree/3` uses `git worktree add -B` (creates
**or** resets), not `-b`. It already removed the previous worktree's
directory, but left the branch behind — and since its name comes from
the task's slug, the second attempt on the SAME task always fell into
`fatal: a branch named 'feature/<slug>' already exists`.

The effect was permanent: unblocking the task didn't help, reactivating
execution didn't help, and the circuit breaker disarmed with no way
out. In a real execution the only way out was a manual
`git worktree prune` in the project's workspace.

Resetting is the right call: the previous worktree has already been
removed, that attempt's work is worthless (the task went back to the
queue), and the branch is reborn from the current point of `work_dir`.

- **Where:** `apps/engine/lib/engine/dev/worktree_manager.ex`
- **Test:** `apps/engine/test/engine/dev/worktree_manager_test.exs`
  (`retrying the SAME task recreates the worktree instead of failing`)
- **Origin:** PHASE 13b real execution

### RN-070 — Every declared gate points to the evidence that proves it {#rn-070}

No entry in `docs/gates.yml` exists without `evidencia`, and the
registry can't claim more than it verifies: a `block` gate requires
`verificacao: script`, and a `planned` gate carries no evidence of
something that hasn't happened yet.

Evidence is a **locator**, not prose: `event_log` carries the event
types and the payload filter that distinguishes them from their
neighbors; `teste` and `ci` carry the path, and a target that
disappeared FAILS. It's the same failure mode the docmap calls a dead
glob — a rule that never fires and fakes coverage.

Three types because not every gate lives in the event log:
[`merge-protegida`](#rn-014) is a ceiling in a pure rule that emits no
event of its own (what guarantees it is a test) and `backmerge` is CI
with state in `.release/gate.json`. Downgrading them to `warn` for that
reason would lie about the product's hardest locks.

The filter matters as much as the type: `qa-verificada` and
`secops-segura` record the SAME `pr.gate_changed`, and the same type
fires on the gate's OPENING with no `veredito` — without the filter,
opening would count as passing. The same holds for the two infra PR
gates. That's why no (`event_types` + `filtro`) pair can repeat.

The filter only reaches the PAYLOAD, on purpose: accepting an arbitrary
column would open up the whole query. Who promoted a story (human or
the PO) lives in the `actor_kind` column and stays outside the
declarative vocabulary.

- **Where:** `apps/api/src/domain/gates/gate-registry.ts`, registered in
  `docs/gates.yml`, measured in `apps/api/scripts/validacao-gates.ts`
- **Test:** `apps/api/test/domain/gates/gate-registry.spec.ts`
  (`is valid: no accumulated problem`; `no (event_types + filtro) pair
  repeats between gates`)
- **Origin:** PHASE 15a (ADR 0054)

### RN-071 — The four user-authority gates cannot be declared automatic {#rn-071}

`acao-aprovada`, `story-promovida`, `plano-de-adocao`, and
`merge-protegida` have `aprovacao_humana: true` by construction. The
list lives in the DOMAIN (`GATES_HUMANOS_IMUTAVEIS`), not in the test:
touching it has to be a deliberate act, reviewed like code.

`aprovacao_humana: true` means the decision is the user's — directly by
a click, or delegated by a policy they themselves wrote in
`permissions.json`. That's what lets `acao-aprovada` coexist with
`status: auto_approved`: policy deciding alone is the user having
decided beforehand. `merge-protegida` is the case where not even the
delegation exists — the ceiling downgrades `auto_approve` to
`require_approval` even with autonomy turned on.

The opposite also fails: an id in the list with no matching gate is a
dead rule, pointing at nothing.

- **Where:** `apps/api/src/domain/gates/gate-registry.ts`
  (`GATES_HUMANOS_IMUTAVEIS`); the ceiling in
  `apps/api/src/domain/actions/decide.ts`
- **Test:** `apps/api/test/domain/gates/gate-registry.spec.ts`
  (`%s cannot have aprovacao_humana false`); the ceiling in
  `apps/api/test/domain/actions/decide.spec.ts`
- **Origin:** PHASE 15a (ADR 0054)

### RN-072 — With no explicit choice, the model is the Creative agent's {#rn-072}

When the binding cascade lands on the **workspace** default — that is,
no one decided anything for this project — the inherited model is the
**Creative** agent's, not the global default.

The Creative agent is always a project's entry door: it's the one the
first conversation happens with, and its binding represents "the model
this project uses to think".

Inheritance fills the **gap**, never overrides: session, agent, or
project bindings are someone's explicit choices and still win. That's
why it's a step AFTER the cascade and not a new scope within it — it
doesn't compete for precedence. And the inherited model passes through
the same filters: gone from the catalog or with no tool calling means
it isn't inherited, for the same reason the cascade skips them
([RN-043](#rn-043)).

What this fixes: the workspace default is global and tends to be a
small local model. A new session and a dev agent — which have no
binding of their own — used to be born in it, and
[ADR 0020](adr/0020-destravar-gates-qa-secops.md) forbids a small local
model at the semantic step. In a real execution, the model had to be
switched by hand in every open session, and the three dev agents came
up on `llama3.2:1b` with no one having asked for it.

- **Where:** `apps/api/src/domain/llm/binding-resolver.ts`
  (`herdarModeloDeStart`), applied in
  `application/use-cases/llm/resolve-model-binding.use-case.ts`
- **Test:** `apps/api/test/domain/llm/binding-resolver.spec.ts`
  (`fills the gap`; `does NOT override %s's explicit choice`)
- **Origin:** findings B and O of the real execution (PHASE 13c, phase A)

### RN-073 — A pending approval SUSPENDS the loop, doesn't burn it {#rn-073}

When a pipeline tool returns `pending`, the ToolLoop **stops** and the
dev agent enters `:awaiting_approval`, holding onto the task, the
worktree, and the loop's history. The user's decision emits
`task.action_settled`, which wakes it: the real result takes the place
where the word "pending" would be, and the loop resumes from where it
stopped.

Two properties the test locks down:

- **Nothing is recorded while waiting.** The tool message's slot stays
  empty. Recording "pending" there would tell the model that's what the
  command answered — which was exactly the defect.
- **A refusal is a response.** The reason takes the result's place and
  the agent learns that path closed, instead of waiting forever for
  something no one is going to approve. It's the same principle as
  `pr_settled` with `opened: false` ([RN-047](#rn-047)), one level down.
- **The wake has to ARRIVE.** `task.action_settled` is born on the
  `task` aggregate, not on the `proposed_action` the table name
  suggests: the engine's drain reads a closed list of aggregates
  (`session` and `task`). Emitted outside that list, the event is
  recorded successfully, stays with a null `processed_at`, and is never
  even read — no job, no error, no log, and the agent waits forever.
  The contract crosses two languages, and that's why it's pinned on
  both sides.

If the engine **restarts** during the wait, the rule no longer applies
to that task: the suspended loop only exists in memory, so it goes back
to the queue blocked with origin `infra`, and the decision made
afterward has nowhere to be applied. Blocking with a diagnosis is
deliberate — the alternative was the silent eternal wait, which is
exactly what this rule exists to end.

What this fixes: `pending` used to come back as the tool's RESULT and
the loop kept going. The model read that as the command's answer,
learned nothing, tried something else — and each attempt burned an
iteration until `toolloop.limit_reached {iteration: 8,
max_iterations: 8}`, with the task blocked for "iteration limit
reached" with not one line written. The approvals granted arrived
after the loop was exhausted and were useless.

The terminal allowlist ([RN-068](#rn-068)) still applies, but stops
being the only defense: it's a list of foreseen commands, and the model
invents commands.

- **Where:** `apps/engine/lib/engine/harness/hooks/action_pipeline.ex`,
  `harness/tool_loop.ex`, `dev/dev_agent_server.ex`,
  `workers/dev_agent_wake_worker.ex`; emission in
  `apps/api/src/application/use-cases/actions/{approve,deny}-action.use-case.ts`
- **Test:** `apps/engine/test/engine/dev/dev_agent_awaiting_approval_test.exs`
  (`pending action STOPS the agent`; `approved: resumes the loop with
  the REAL output`; `restart during the wait BLOCKS the task`) and
  `apps/engine/test/engine/dev/wake_do_outbox_ao_agente_test.exs`, which
  walks the whole chain — outbox, drain, queue, and process — because
  the per-link tests were all green with the delivery broken; the
  aggregate is pinned on the api side in
  `apps/api/test/application/use-cases/actions/approve-deny-action.use-case.spec.ts`
- **Origin:** [ADR 0052](adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md),
  triage phase A

### RN-135 — Activating execution closes the CHAT session that originated the request {#rn-135}

`ActivateExecutionUseCase` always resolved the EXECUTION session
(`findActiveExecutionSession`, or created a new `criativa` one), but
never transitioned the CHAT session the click on "activate execution"
came from — the Dev Lead/PO conversing in a separate session. It stayed
`active` forever, even with execution already running on its own in
another session, and kept showing up as an open conversation in the
list.

`execute()` gained `originSessionId`, optional and last — an old caller
(today only activation from Overview, with no session context) keeps
working IDENTICALLY, closing nothing. When passed, at the END of the
method (after everything else has happened: module_map, areas,
autonomy, `startExecution`, `execution.activated`):

- **never closes the execution session itself** — if `originSessionId`
  equals the session that just received `execution.activated`, closing
  is skipped, because closing it would destroy the process the dev
  agents just gained;
- **only closes what's `active`** — the same caution as
  `decide-bootstrap-plan.use-case.ts#fecharSessao`, nothing to do if
  the session no longer exists or is no longer open;
- **reuses `GetSessionPendingWorkUseCase`** ([RN-073](#rn-073)) — the
  SAME guard that holds off closing on inactivity heartbeat: an offered
  handoff, a pending `proposed_action`, or an agent `working` with no
  subsequent `idle` prevent closing;
- goes through `closing` before `closed` — the state machine
  (`active -> closing -> closed`) doesn't allow the direct jump.

A failure or pending state here NEVER propagates to whoever called
`execute()`: the
ativação da execução já aconteceu e é o efeito principal; fechar o chat de
origem é um efeito colateral *best-effort*.

- **Onde:** `apps/api/src/application/use-cases/execution/activate-execution.use-case.ts`
  (`closeOriginSession`), `apps/api/src/interfaces/http/execution/dto/activate-execution.dto.ts`
  (`originSessionId`), `apps/api/src/interfaces/http/execution/execution.controller.ts`
- **Teste:** `apps/api/test/application/use-cases/execution/activate-execution.use-case.spec.ts`,
  describe `fecha a sessão de origem (RN-135)` — fecha sem pendência,
  NÃO fecha com pendência, NÃO fecha sessão já não-`active`, chamador
  antigo sem o parâmetro não fecha nada, e nunca fecha a própria sessão de
  execução mesmo se `originSessionId` coincidir com ela
- **Origem:** achado de investigação de código — sessão criativa com
  execução ativada continuava `active` na lista mesmo com 35 eventos de
  dev agents dentro dela

### RN-074 — A saída de terminal tem teto de bytes {#rn-074}

A saída de um comando é cortada em `TERMINAL_OUTPUT_MAX_BYTES` (default 32 KiB)
antes de virar resultado da ferramenta, e o corte deixa uma **marca** dizendo os
dois tamanhos e o que fazer:

```
[saída truncada: 32768 de 1048576 bytes. Refine o comando (head, grep,
-maxdepth) para ver o que falta.]
```

Três propriedades que o teste fixa:

- **O teto é `>`, não `>=`.** Saída que cabe exatamente no limite passa
  intacta — marcá-la faria o modelo refinar um comando que já deu tudo.
- **O corte não parte caractere multibyte.** `binary_part/3` corta por byte;
  cair no meio de um `é` produz binário inválido que quebra a serialização
  JSON antes de o resultado chegar ao modelo.
- **`raw_bytes` continua sendo o tamanho REAL produzido**, não o truncado. É
  medição, e mentir nela esconderia justamente o comportamento que motivou o
  teto. Quem quiser detectar truncagem compara `byte_size(stdout)` com
  `raw_bytes`.

O que isso conserta: a saída de cada comando fica no histórico do laço e viaja
em **todo** turno seguinte. Sem teto, um `find` numa árvore grande basta — a
execução do `hello-limpo` morreu com `{413, "request entity too large"}` no
turno 18, sem uma linha escrita. O estouro é de **bytes da requisição**, não de
janela de contexto: a maior chamada bem-sucedida tinha 28.993 tokens de entrada.

A marca é endereçada ao **modelo**, não ao humano — sem dizer o que fazer, ele
tende a repetir o mesmo comando.

- **Onde:** `apps/engine/lib/engine/actions/terminal_executor.ex`
  (`truncate/2`), teto em `apps/engine/config/runtime.exs`
- **Teste:** `apps/engine/test/engine/actions/terminal_executor_test.exs`
  (describe `teto de bytes da saída`)
- **Origem:** achado S de
  [achados-execucao-real.md](explanation/achados-execucao-real.md), Fase F do
  [backlog](explanation/backlog.md)

### RN-075 — Comando de terminal é avaliado por onde toca, não só pelo verbo {#rn-075}

A pasta do projeto (`<PROJECT_WORKSPACES_ROOT>/<workspace_dir_name>` — o
UUID puro num projeto de antes do [RN-109](#rn-109), `<slug>-<8 chars do
id>` num projeto novo) é o **escopo**.
Um comando de `terminal` que toca qualquer caminho fora dela **nunca** é
auto-aprovado, por mais que o verbo esteja em `allow`. Dentro dela, `cd` deixa
de exigir permissão — ele é a declaração de escopo, não um verbo.

Quatro propriedades que os testes fixam:

- **Aperta:** `Terminal(cat)` liberado deixa de auto-executar
  `cat /workspace/apps/engine/.../git_executor.ex`. Era o achado U: o
  casamento é por VERBO, então o agente lia o código da plataforma que o
  executava, e alcançava o worktree de outros projetos.
- **Afrouxa:** `cd <dentro> && cat README.md` vira `auto_approve`. Era o
  defeito mais caro da escada — o dev agent emite sempre `cd <caminho> &&
  <verbo>`, `cd` não estava em `allow` nenhum, e comando composto exige que
  TODOS os segmentos casem.
- **Permite sem isentar:** dentro do escopo, verbo fora do `allow` continua
  pedindo. Estar na pasta do projeto não torna `curl … | sh` seguro.
- **Fora do escopo é `require_approval`, nunca `deny`:** o agente pode ter
  razão legítima para olhar fora, e a decisão continua sendo do usuário.

`deny` continua vencendo primeiro, e os dois tetos ([RN-006](#rn-006),
[RN-007](#rn-007)) seguem intocados. Sem raiz informada ao `decide()`, o
veredito é o de antes desta regra — nenhum chamador tem comportamento alterado
por omissão.

A normalização é **léxica**, não `realpath`: `<raiz>/../..` é resolvido e
reprovado, mas link simbólico de dentro apontando para fora não é detectado.
`decide()` é puro por contrato e resolver symlink exigiria IO no domínio.
Escopo é política; isolamento é outro problema, declarado em aberto no ADR.

**Sem regex sobre a entrada, de propósito.** Tirar as barras finais da raiz era
`.replace(/\/+$/, '')`, e o CodeQL apontou ReDoS polinomial
(`js/polynomial-redos`, HIGH): o padrão obriga o motor a tentar cada posição
inicial e varrer até o fim, degradando em O(n²). Hoje é varredura O(n),
equivalente inclusive no caso degenerado — a raiz `/` vira string vazia nos
dois, e é isso que faz `startsWith('/')` valer para todo caminho absoluto.
Quem for "simplificar" de volta para regex reabre o alerta.

- **Onde:** `apps/api/src/domain/actions/path-scope.ts`,
  `domain/actions/decide.ts` (teto do escopo e o `cd` no escopo),
  raiz derivada em
  `infrastructure/filesystem/project-workspaces-root.ts`
- **Teste:** `apps/api/test/domain/actions/path-scope.spec.ts` e
  `apps/api/test/domain/actions/decide.spec.ts`
  (describe `decide — escopo de caminho`)
- **Origem:** [ADR 0055](adr/0055-escopo-de-caminho-na-politica-de-terminal.md),
  achado U, Fase F do [backlog](explanation/backlog.md)

O escopo só vale enquanto ele próprio estiver dentro da raiz — quem garante isso
é a [RN-092](#rn-092).

### RN-092 — O `projectId` é segmento de caminho, e o escopo nunca sai da raiz {#rn-092}

`projectScopeRoot()` **recusa** um `projectId` que não seja segmento de caminho
simples (`^[A-Za-z0-9_-]{1,64}$`), lançando em vez de montar o caminho.

O motivo é que o id chega de `@Param('projectId')` sem pipe de validação, e o
Express **decodifica o percent-encoding do segmento antes de entregá-lo**: um
`..%2F..%2Fetc` chega como `../../etc`, e o `join` resolveria para fora da raiz
sem reclamar. Os dois consumidores da função sofrem, e o segundo é o grave:

- o `permissions.json` seria lido **e escrito** em caminho arbitrário;
- o escopo da [RN-075](#rn-075) autoriza comando de `terminal` sob essa pasta.
  Um escopo que escapa da raiz é a política de aprovação apontando para o lugar
  errado — falha de SEGURANÇA, não de arquivo não encontrado.

A checagem é deliberadamente **mais larga que UUID** (aceita letra, dígito,
hífen e sublinhado) para não amarrar o formato do id, e estreita o bastante para
que o resultado nunca escape. E fica **onde a raiz é derivada**, não em cada
chamador, pela mesma razão que fez a função existir: as duas derivações têm que
concordar, e checagem duplicada é checagem que um dia diverge.

O caminho feliz não muda — todo id real é UUID vindo do banco.

- **Onde:** `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`projectScopeRoot`)
- **Teste:** `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
- **Origem:** [ADR 0058](adr/0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md),
  alertas `js/path-injection` do CodeQL

### RN-095 — A leitura de repositório é contida ao projeto e limitada {#rn-095}

A superfície de leitura de código (`GET /projects/:projectId/code/{tree,file,search}`
e o diff de PR) tem **duas** garantias, e as duas são do mesmo tipo: o produto
recusando fazer o que o cliente pediu.

**Contenção.** Todo caminho de arquivo vindo do cliente passa por
`caminhoDeRepositorioContido()`, que ancora o pedido na pasta do projeto e
recusa o que sair dela — `../`, absoluto, ou byte NUL. Ela é uma função só, no
mesmo arquivo do `projectScopeRoot` da [RN-092](#rn-092), reusando as primitivas
do escopo de terminal (`normalizarCaminho`/`dentroDoEscopo`). **Nenhuma rota
valida caminho por conta própria**, e é isso que a regra afirma: quatro
implementações da mesma contenção seriam quatro chances de divergir, e o
CLAUDE.md já registra que a decisão foi manter a checagem central e pagar o
preço no painel do CodeQL (barreira em outra função ele não enxerga).

Ela devolve o caminho **normalizado**, e o chamador usa o que voltou. Devolver o
original permitiria conferir `b` e mandar `a/../b` ao provider — a forma mais
comum de a contenção existir e não valer.

O vetor não é "ler o arquivo errado". Em `github`/`gitlab` o caminho vira
segmento de URL da API do provider, então um `../` **troca de endpoint** com a
credencial do owner do workspace na mão ([RN-058](#rn-058)/[RN-082](#rn-082)).
Em `local` ele vira o lado direito de `git show <ref>:<path>`. A `ref` é
conferida no mesmo lugar, pelo mesmo motivo, e `..` nela é recusado porque para
o git `dev..main` é intervalo de commits, não revisão.

**Limite.** Árvore e diff já vêm cortados pelo contrato
(`GIT_TREE_ENTRY_LIMIT`, `GIT_DIFF_FILE_LIMIT`, FASE 26a). A **busca** não: ela
não é operação do contrato — é composta sobre `listTree` e `getFileContent`, e
é a única leitura cujo custo cresce com o TAMANHO do repositório em vez do
tamanho do pedido. Três orçamentos a param (diretórios percorridos, arquivos
abertos, casamentos devolvidos), um cache de TTL curto evita repetir as mesmas
chamadas, e `truncated` diz que o corte aconteceu. Sem eles, um `viewer`
gastaria a credencial e o rate limit do owner à vontade — a mesma família de
defeito dos 3.824 req/min do dashboard ([RN-090](#rn-090)).

Cortar é sempre **visível**: toda resposta que pode ter sido cortada diz isso
num campo. `filesScanned` vai junto na busca porque o custo que ninguém vê é o
que ninguém corrige.

**Ler não vira `proposed_action`.** Leitura não é efeito externo, e transformá-la
em ação de aprovação encheria a fila de ruído até ninguém mais ler as de
verdade. O congelamento da fase é o outro lado disso: a aba é só leitura, e
escrita — quando vier — nasce `proposed_action`.

- **Onde:**
  `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`caminhoDeRepositorioContido`),
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`,
  `apps/api/src/domain/git/git-read-limits.ts`,
  `apps/api/src/domain/git/git-read-cache.ts`,
  `apps/api/src/interfaces/http/git/code.controller.ts`
- **Teste:**
  `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (a contenção isolada),
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (o caminho malicioso recusado nas três rotas **antes** de o provider ser
  chamado, e cada um dos três orçamentos parando a busca),
  `apps/api/test/domain/git/git-read-cache.spec.ts`
- **Origem:** FASE 26b, item 34 do programa 16–26; a contenção estende a
  [RN-092](#rn-092) ([ADR 0058](adr/0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md))

### RN-127 — `ref`/`path` da aba Code recusam chegar como ARRAY, não só como caminho fora do escopo {#rn-127}

`@Query('ref') ref?: string` e `@Query('path') path?: string`
(`code.controller.ts`) extraem o valor cru sem DTO/`class-validator` no
meio, e o `ValidationPipe` global (`main.ts`) não ajuda: ele pula tipo
primitivo nativo (`String`) por desenho do Nest, então nada intercepta
`ref`/`path` antes de chegarem como argumento de método. O Express entrega
`?ref=a&ref=b` como **array**, não string — a anotação `string` do
TypeScript só existe em compile-time.

Um array escapava das DUAS checagens que a [RN-095](#rn-095) já fazia
tratando o valor como string: `ref.includes('..')` tem semântica de
ELEMENTO EXATO (não substring) em array, e `REF_VALIDO.test(ref)` chama
`.toString()` no array antes de casar — um valor como `['x/../y']`
continha `..` e ainda assim passaria pelas duas.

`garantirQueryEscalar(valor, criarErro)` recusa o array ANTES de qualquer
outra checagem, num lugar só, reusado pelos DOIS pontos que tratavam query
como string: `caminhoDeRepositorioContido` (mesmo arquivo da RN-092/095) e
`ReadProjectCodeUseCase.alvo` (`ref`). O erro concreto (`CaminhoForaDoEscopoError`
ou `BadRequestException`) é decidido por quem chama, passado como fábrica —
a função central não decide o tipo de erro, só a forma da checagem.

O caminho feliz não muda: todo `ref`/`path` legítimo já era string.

- **Onde:** `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`garantirQueryEscalar`, usada em `caminhoDeRepositorioContido`),
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (`alvo`, `ref`)
- **Teste:**
  `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (`garantirQueryEscalar` isolada e `caminhoDeRepositorioContido` recusando
  array), `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (`ref`/`path` como array são 400 em `tree`, que todas as outras rotas
  reusam via `alvo`)
- **Origem:** alerta CRÍTICO do CodeQL (confusão de tipo em query param HTTP)
  bloqueando a promoção qa→main, achado durante a PR #256; estende a
  [RN-095](#rn-095)

### RN-093 — Em produção, a api não sobe com a chave de exemplo do `state` de OAuth {#rn-093}

`resolveOauthStateSecret()` **derruba o boot** quando `NODE_ENV === 'production'`
e `GIT_OAUTH_STATE_SECRET` está ausente, é igual ao literal de exemplo do
repositório, ou tem menos de 16 caracteres. Fora de produção o default de
desenvolvimento continua valendo.

Essa chave assina o `state` do OAuth de git, e o `state` é o único que impede o
callback `GET /git/oauth/:provider/callback` — rota pública, por necessidade —
de ser forjado. Com a chave conhecida, qualquer um assina um `state` para
`{projectId, userId, provider}` à escolha e faz o callback gravar, no projeto
apontado por esse payload, o token de git obtido do provider.

**Por que rejeitar o literal, e não só o vazio.** O default estava no
`.env.example` de um repositório open source — é segredo publicado, não segredo
fraco. E o `docker-compose.prod.yml` o supria como fallback, então no caminho
real de erro a variável estava **definida**: uma verificação de "não vazia"
passaria por cima do defeito inteiro.

A resolução fica em função única, e não em cada chamador, pela mesma razão da
[RN-092](#rn-092) — eram duas cópias do mesmo literal, e cópias divergem.
Divergindo aqui, o callback recusaria todo `state` legítimo.

- **Onde:** `apps/api/src/infrastructure/security/oauth-state-secret.ts`
  (`resolveOauthStateSecret`), chamada no boot em `apps/api/src/main.ts`
- **Teste:** `apps/api/test/infrastructure/security/oauth-state-secret.spec.ts`
- **Origem:** [ADR 0059](adr/0059-segredo-do-state-de-oauth-sem-default.md)

### RN-114 — Os quatro segredos irmãos do `GIT_OAUTH_STATE_SECRET` também não sobem em produção com o valor de exemplo {#rn-114}

O [ADR 0059](adr/0059-segredo-do-state-de-oauth-sem-default.md) fechou o
padrão para `GIT_OAUTH_STATE_SECRET` e deixou declaradamente aberto que o
mesmo modo de falha valia para quatro segredos irmãos, todos com default de
desenvolvimento no `docker-compose.prod.yml`: `AUTH_JWT_SECRET`,
`BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY` e `SECRET_KEY_BASE`. Esta RN
fecha os quatro, replicando exatamente a mesma regra — não é decisão nova,
é a mesma decisão aplicada aos irmãos.

Em produção (`NODE_ENV === 'production'`), cada resolutor **derruba o boot**
quando a variável está ausente/só com espaços, é igual ao literal de exemplo
do repositório (que é público — está no `.env.example`), ou tem menos de 16
caracteres. Fora de produção o default de desenvolvimento continua valendo,
porque `docker compose up` sem `.env` tem que funcionar.

- `AUTH_JWT_SECRET` — deriva o par Ed25519 que assina o access token. Com o
  default público, qualquer um forja um access token válido.
- `BRABO_SERVICE_TOKEN` — autentica o tráfego interno api ↔ engine. Com o
  default público, qualquer um chama as rotas `/internal/*` sem passar pelo
  `EngineServiceGuard`.
- `CREDENTIALS_MASTER_KEY` — embrulha os DEKs que cifram as credenciais do
  usuário (chaves de LLM, tokens de git). Com o default público, qualquer um
  decripta o acervo. **Fora de escopo aqui**: qualquer mecanismo de rotação —
  esse já existe (`CREDENTIALS_MASTER_KEY_PREVIOUS` +
  `src/scripts/rewrap-deks.ts`) e não muda; esta é só a checagem de BOOT.
- `SECRET_KEY_BASE` (engine) — já derrubava o boot sem a variável
  (`runtime.exs`, bloco `:prod`, boilerplate padrão do Phoenix). O defeito
  real não era falta de checagem no Elixir: era o `docker-compose.prod.yml`
  suprir o literal público como fallback, o que fazia a variável chegar
  sempre DEFINIDA e mascarava o `raise` que já existia. A correção aqui foi
  só remover o fallback do compose — nenhuma linha de Elixir mudou.

Vale a mesma razão do ADR 0059 para rejeitar o literal, e não só o vazio: o
`docker-compose.prod.yml` supria os quatro literais como fallback, então no
caminho real de erro as variáveis estavam **definidas** — uma verificação de
"não vazia" passaria por cima do defeito inteiro.

- **Onde:** `apps/api/src/infrastructure/security/auth-key-material.ts`
  (`passphraseAtual`), `apps/api/src/infrastructure/security/service-token.ts`
  (`tokenDeServicoAtual`) e
  `apps/api/src/infrastructure/security/envelope-encryption.service.ts`
  (`EnvelopeEncryptionService`, checagem no construtor) — os dois primeiros
  chamados no boot em `apps/api/src/main.ts`, o terceiro exercitado quando o
  `NestFactory.create` monta o grafo de providers. `SECRET_KEY_BASE` em
  `apps/engine/config/runtime.exs` (inalterado) com o fallback removido de
  `docker/docker-compose.prod.yml`
- **Teste:** `apps/api/test/infrastructure/security/auth-key-material.spec.ts`,
  `apps/api/test/infrastructure/security/service-token.spec.ts` e o describe
  `validação de produção` em
  `apps/api/test/infrastructure/security/envelope-encryption.service.spec.ts`
- **Origem:** [ADR 0059](adr/0059-segredo-do-state-de-oauth-sem-default.md)

### RN-076 — A credencial de git nunca é escrita em arquivo {#rn-076}

O engine trabalha em repositório remoto pedindo o **remoto de trabalho** à api
(`GET /internal/projects/:projectId/git-remote`), que devolve a origem **limpa**
e o token do owner à parte. O token entra na invocação do git pelo **ambiente do
processo filho** e em nenhum outro lugar:

- **não no `origin`** — é a URL limpa que fica gravada no `.git/config`;
- **não em argv** — `ps` mostra a linha de comando de qualquer processo;
- **não em arquivo** — nem helper persistido, nem `~/.git-credentials`.

O helper de credencial é passado por `-c`, vale só para aquele processo, e vem
depois de um `credential.helper=` vazio: helpers são acumulativos e o primeiro a
responder ganha, então sem zerar antes um helper do host responderia no lugar.

**Por que isso é regra e não preferência.** Escrever
`https://x-access-token:TOKEN@github.com/…` no `origin` — o que quase todo
tutorial ensina — grava a credencial em texto puro **dentro da pasta do
projeto**, exatamente onde a [RN-075](#rn-075) dá ao dev agent leitura
**auto-aprovada**. Um `cat .git/config` devolveria o token sem passar por
aprovação nenhuma, e ele viajaria ao provider de LLM no histórico do laço. O
escopo de caminho protege contra o agente ler para FORA do projeto; não tem como
proteger contra um segredo que o próprio produto colocou DENTRO.

A credencial é a do **owner do workspace**, pelo mesmo resolvedor da
[RN-058](#rn-058) — duas regras de "de quem é a credencial" divergiriam.
Provider `local` não tem token nem consulta a api: é resolvido direto do banco,
e é o caminho que o `pnpm dev` e a suite inteira exercitam.

- **Onde:** `apps/engine/lib/engine/actions/git_auth.ex`,
  `engine/projects/project_repository.ex` (`remoto_de_trabalho/1`),
  `apps/api/src/application/use-cases/git/get-project-git-remote.use-case.ts`
- **Teste:** `apps/engine/test/engine/actions/git_auth_test.exs` (o token não
  aparece em argv nem no helper) e
  `apps/api/test/application/use-cases/git/get-project-git-remote.use-case.spec.ts`
  (a origem devolvida não contém o token nem `@`)
- **Origem:** [ADR 0056](adr/0056-o-engine-trabalha-em-repositorio-remoto.md),
  achado N, Fase B do [backlog](explanation/backlog.md)

### RN-077 — A origem da falha é sempre uma das quatro {#rn-077}

Todo desfecho de falha nomeia a ORIGEM no vocabulário **fechado** do
[ADR 0020](adr/0020-destravar-gates-qa-secops.md) —
`infra | modelo | codigo | politica`. Não há quinto valor: `null` e
`"indeterminada"` deixaram de ser possíveis.

Duas garantias estruturais, e nenhuma depende de alguém lembrar:

- **`AgentIo.block_task/4` não tem default para a origem.** Ela era
  "obrigatória em espírito", com `"indeterminada"` de default — e o desfecho
  mais caro da execução real saiu exatamente assim, porque o call site não
  passou nada. Sem default, esquecer vira erro de compilação.
- **`FalhaDeTurno.origem/1` sempre devolve uma das quatro**, e há teste de
  tabela que falha se alguma entrada — inclusive uma forma nunca vista —
  produzir outra coisa.

**Por que `indeterminada` saiu.** Ela existiu com um argumento razoável: não
chutar seria mais honesto que escolher no escuro. O efeito real foi o oposto —
`indeterminada` **não aponta ação nenhuma**, e quem triava a rodada seguinte
recomeçava a investigação do zero. O que ela significava de fato era *o
classificador não reconheceu esta forma*, que é lacuna do nosso código: `codigo`
é a origem que aponta a ação certa (acrescentar a cláusula que falta). O
diagnóstico continua indo verbatim, então nada se perde.

**As origens não são chute.** Cada desfecho do ToolLoop diz quem decidiu parar:
`report_blocked` e teto de iterações são do **modelo** (ele decidiu, ou gastou o
que tinha); orçamento e PR não aprovada são **política** (foi uma decisão, nada
quebrou); restart e falha ao montar contexto são **infra**; e quando há
`last_error`, a origem sai do MESMO erro que o diagnóstico narra — era esse par
que se contradizia, com `diagnosis` dizendo `{413, …}` e `origem` dizendo
"indeterminada" na mesma linha.

- **Onde:** `apps/engine/lib/engine/agents/falha_de_turno.ex`,
  `engine/dev/agent_io.ex` (`block_task/4`, sem default),
  `engine/dev/dev_agent_server.ex` (`origem_da_parada/1`)
- **Teste:** `apps/engine/test/engine/agents/falha_de_turno_test.exs`
  (`o vocabulário é fechado`) e
  `apps/engine/test/engine/dev/dev_agent_server_test.exs`, que afirma a origem
  no evento emitido
- **Origem:** achados P, Q e T de
  [achados-execucao-real.md](explanation/achados-execucao-real.md), Fase G do
  [backlog](explanation/backlog.md)

### RN-078 — Falha em proteger branches pode ser reconhecida, e só ela {#rn-078}

`protect_branches` falha em repositório privado no plano gratuito do GitHub — e
o wizard **avisa isso antes de começar**. O usuário pode reconhecer a falha e
seguir; o bootstrap fecha e o projeto passa a ser alcançável.

**O que isso destrava é maior do que parece.** O único botão oferecido depois da
falha era "Tentar novamente", que falha sempre pelo mesmo motivo. E
`provision_failed` faz o dashboard **redirecionar o clique do projeto de volta
para a página de provisionamento** — o projeto ficava inalcançável para sempre,
preso num passo que não tem como suceder.

**Só a proteção pode ser reconhecida.** Ela é o ÚLTIMO passo e a única cuja
falha deixa um repositório utilizável: o repo existe, os arquivos foram
commitados, as branches foram criadas. Falhar em criar o repositório ou em
commitar é outra coisa — ali "seguir" produziria um projeto sem onde trabalhar,
e o botão seria uma segunda mentira em cima da primeira. A recusa diz isso, em
vez de só negar.

**A garantia do produto não muda.** A trava de merge ([RN-006](#rn-006)) é
aplicada em `decide.ts`, não pela proteção do provider. Seguir sem ela remove a
segunda camada, a do GitHub — não a do Brabo. É o que torna esta saída honesta
em vez de um atalho.

A decisão vai para o event log com o **usuário** como ator e o erro original no
payload: seguir sem proteção é escolha dele, e quem ler depois precisa saber o
que exatamente foi dispensado.

- **Onde:** `apps/api/src/application/use-cases/git/acknowledge-protection-failure.use-case.ts`,
  rota em `interfaces/http/git/git.controller.ts`, botão em
  `apps/web/src/routes/ProvisioningPage.tsx`
- **Teste:** `apps/api/test/application/use-cases/git/acknowledge-protection-failure.use-case.spec.ts`
  (destrava; a decisão no log com o ator; e a recusa para falha anterior)
- **Origem:** achado D, Fase D do [backlog](explanation/backlog.md)

### RN-079 — O Psicólogo não analisa sessão sem evento analisável {#rn-079}

Antes de gastar um turno de modelo, a análise pergunta se há o que analisar. Não
havendo, ela **não roda** e o desfecho vira `psychologist.analysis_skipped`.

**Analisável exclui duas coisas, por motivos diferentes:**

- **o rastro dos próprios analistas.** O Psicólogo grava o turno dele no log da
  sessão que está analisando (`agent.response`, `tool.call`, `tool.result`, a
  hipótese). Contar isso faria uma sessão vazia parecer povoada **a partir da
  primeira análise**, e cada retentativa a encheria mais — o critério nunca mais
  reprovaria. Vale igual para a Anamnese;
- **`bootstrap.*`**, que é provisionamento de repositório rodando sozinho: nove
  passos de máquina não dizem nada sobre a pessoa.

Tudo o mais conta, inclusive `proposed_action.*` — o usuário aprovando e negando
sem escrever mensagem nenhuma **é** comportamento, lição que a Anamnese já tinha
aprendido ([RN-063](#rn-063)).

**São duas contagens, e elas não se substituem.** A crua dimensiona o trabalho
(quanto log ler, logo qual tier de triagem, leve ou pesado); a analisável decide
se há trabalho. Confundi-las é o defeito: uma sessão só de bootstrap passava por "20
eventos" sem ter nenhum, ganhava a análise, e o modelo — sem nada para citar —
inventava `seq` inexistentes até a validação de evidência rejeitar e ele
desistir, com o orçamento já gasto.

**Pular vale também para reprocessamento manual.** Reprocessar não fabrica
material: quem clicou recebe o motivo no log em vez de uma hipótese inventada
sobre um log que não existe.

O skip vira **evento**, ao contrário do da Anamnese, que é só log — aquele roda
a cada 15 min e viraria ruído, este roda uma vez por fechamento de sessão, e uma
análise ausente sem nada narrado é indiagnosticável.

- **Onde:** `apps/engine/lib/engine/session_events/event.ex` (`count_analisaveis/1`),
  `apps/engine/lib/engine/psychologist/triage.ex` (`should_run?/1`),
  `apps/engine/lib/engine/workers/psychologist_worker.ex`
- **Teste:** `apps/engine/test/engine/session_events/event_analisaveis_test.exs`
  (inclui a reprodução da sessão do achado: 14 eventos, nenhum analisável),
  `apps/engine/test/engine/workers/psychologist_worker_test.exs`
- **Origem:** achado J, Fase E do [backlog](explanation/backlog.md)

### RN-080 — Regra de negócio duplicada é recusada na entrada {#rn-080}

`business_rule` cujo título já existe **no projeto** não é gravada. A recusa
volta ao modelo pelo mesmo caminho de um payload inválido, e ele segue para a
próxima regra em vez de parar.

**Na entrada porque não há outro lugar.** Não existe tabela de regras: o
artefato É o evento `artifact.business_rule`, e evento de domínio não é apagado
nem editado. Deixar entrar significa conviver com a duplicata para sempre.

**Escopo de projeto, não de sessão** — é entre sessões que a duplicata nasce.
Rodar o Criativo de novo abre sessão nova, e uma checagem por sessão não veria a
rodada anterior, que é exatamente o caso do achado.

A comparação normaliza caixa, acento e espaço redundante; pontuação fica.
**Duplicata semântica continua passando, e isso é declarado, não esquecido:**
"Saudação com nome" e "Quem chama pode se identificar" seguem sendo duas regras,
porque separá-las é julgamento e não cabe num `if`.

- **Onde:** `apps/engine/lib/engine/harness/artifact_dedupe.ex`,
  `apps/engine/lib/engine/harness/tools/emit_artifact.ex`,
  `apps/engine/lib/engine/session_events/event.ex` (`titulos_de_regras/1`)
- **Teste:** `apps/engine/test/engine/harness/artifact_dedupe_test.exs`,
  `apps/engine/test/engine/harness/emit_artifact_dedupe_test.exs`
- **Origem:** achado K, Fase E do [backlog](explanation/backlog.md)

### RN-081 — História repetida: título igual recusa, justificativa igual avisa {#rn-081}

Duas respostas diferentes para dois problemas diferentes:

- **título idêntico** no projeto é erro, não escolha: a história é **recusada** e
  nada é criado;
- **mesma justificativa** — todas as regras de negócio que a história cita já
  estavam cobertas por outra — é suspeita, não erro. A história **é criada** e
  sai um `backlog.story_overlap_warned`. Um segundo recorte da mesma regra pode
  ser legítimo, então quem julga é o usuário; o produto só se recusa a deixar
  passar despercebido.

**Contido, não intersecção.** Duas histórias compartilharem uma regra é normal, e
avisar disso viraria ruído que ninguém lê. O sinal só existe quando a nova não
acrescenta cobertura nenhuma. História que não cita regra alguma não gera aviso:
tratar o conjunto vazio como subconjunto de tudo acusaria todas.

**O limite é o mesmo da [RN-080](#rn-080), e o par do achado o atravessa:**
"Endpoint público de saudação determinística" e "Endpoint público GET /hello que
responde saudação imediata" cobrem o mesmo endpoint com títulos e justificativas
diferentes — nada mecânico os liga, e eles continuam passando. Há teste
afirmando isso, para o limite ficar visível em vez de implícito.

- **Onde:** `apps/api/src/domain/backlog/story-overlap.ts`,
  `apps/api/src/application/use-cases/backlog/create-story.use-case.ts`
- **Teste:** `apps/api/test/domain/backlog/story-overlap.spec.ts`,
  `apps/api/test/application/use-cases/backlog/create-story.use-case.spec.ts`
- **Origem:** achado R, Fase E do [backlog](explanation/backlog.md)

### RN-082 — A credencial de git de uma ação é a do OWNER do workspace {#rn-082}

Quando a api executa uma ação de git contra provider remoto (`pr_open`,
`git_merge`), o token vem do **owner do workspace** — o mesmo resolvedor da
[RN-058](#rn-058), não de quem decidiu a ação.

**Resolver por quem decidiu só funcionava com clique humano.** Ação
auto-aprovada por política não tem decisor: `decided_by` fica `NULL`, o token
fica `undefined`, e o GitHub responde `Requires authentication`. Na prática,
com autonomia ligada — que é o modo que o ADR 0055 existe para viabilizar —
**nenhum dev agent conseguia abrir PR em provider remoto**.

**O contraste que expôs o defeito** aconteceu dentro de uma execução só: no
mesmo run, `git_push` passou e `pr_open` falhou. O push é executado pelo
ENGINE, que já injetava a credencial do owner
([RN-076](#rn-076)); a PR é aberta pela API, que estava fora de simetria.

Não apareceu antes porque toda validação anterior usou o `LocalGitProvider`,
onde o token nem é consultado.

O princípio é o mesmo da RN-058, e vale repetir porque é o que impede as duas
regras de divergirem com o tempo: **quem banca a conta banca os agentes**, e
isso não muda conforme quem clica. Por isso o resolvedor é REUSADO em vez de
reimplementado.

- **Onde:** `apps/api/src/application/use-cases/actions/execute-git-action.use-case.ts`,
  reusando `application/use-cases/llm/resolve-credential-owner.use-case.ts`
- **Teste:** `apps/api/test/application/use-cases/actions/execute-git-action.use-case.spec.ts`
  (`pr_open` auto-aprovado, com `decidedBy: null`, pede a credencial do owner)
- **Origem:** achado AA, [validação real da 13b](explanation/validacao-real.md)

### RN-083 — O lead decide o paralelismo; acima do teto, você autoriza {#rn-083}

Quantos agentes sobem deixa de ser um número no código: quem avalia é o **lead
da área**. Mas a decisão dele não é soberana sobre GASTO — até
`agent_areas.max_parallel` (default **2**) ele sobe e segue; **acima disso vira
`proposed_action` do tipo `parallelize`**, pelo mesmo pipeline de toda ação com
efeito externo.

**O teto é da SESSÃO, não do módulo.** É a única parte da regra que não é
óbvia, e a que um refactor desatento desfaz: contar por módulo permitiria N
módulos × 2 agentes sem autorização nenhuma — o buraco anterior com outro nome.
Há teste afirmando exatamente isso.

**Teto zero ou negativo é configuração inválida, não "sem limite".** Tratá-lo
como ilimitado transformaria um erro de digitação em gasto irrestrito, que é o
oposto do que o pipeline existe para fazer.

**Quem PEDE é o lead; quem DECIDE é você.** A `proposed_action` nasce com o
lead como ator, e a decisão fica no event log com o seu nome — é essa distinção
que faz a história ser reconstituível depois ([ADR 0048](adr/0048-decisao-no-log-e-a-ordem-do-gate.md)).

O motivo viaja no payload IMUTÁVEL, com os três números (quantos há, quantos
pede, qual o teto): quem ler daqui a seis meses precisa entender o que foi
autorizado sem reconstruir o estado da sessão.

`AcceptParallelizationUseCase` não muda: ele continua sendo quem EXECUTA, tanto
no caminho direto quanto quando a ação é aprovada. Absorvê-lo por dentro, em vez
de reescrevê-lo, é o que mantém a suite da Fase 4 verde sem modificação — que é
a prova de que a troca não vazou para o contrato externo.

**O teto é configurável por área, e só por você.** `PATCH
/projects/:projectId/agent-areas/:key/max-parallel` exige `maintainer` — o mesmo
papel de ativar a execução, e pelo mesmo motivo: mudar o teto é decidir quanto o
produto pode gastar sem perguntar. Não existe caminho automático de subi-lo. A
Anamnese pode PROPOR, quando notar que a autorização virou rotina, e a proposta
continua passando por esta rota depois que você aceita — um produto que eleva o
próprio teto de gasto é exatamente o que o pipeline de aprovação existe para
impedir.

Mudar o teto vale para os PRÓXIMOS pedidos. O que já está aguardando decisão
continua aguardando: a ação carrega no payload o teto vigente quando foi criada,
e reinterpretá-la sob o teto novo mudaria o que você está prestes a decidir
depois de ler.

- **Onde:** `apps/api/src/domain/execution/paralelismo.ts` (a regra pura),
  `application/use-cases/execution/request-parallelization.use-case.ts`,
  `application/use-cases/execution/set-area-max-parallel.use-case.ts`,
  exposto em `interfaces/http/execution/execution.controller.ts` e configurado
  em `apps/web/src/routes/ProjectSettingsTab.tsx` (`ParallelismSection`)
- **Teste:** `apps/api/test/domain/execution/paralelismo.spec.ts`,
  `test/application/use-cases/execution/request-parallelization.use-case.spec.ts`,
  `test/application/use-cases/execution/set-area-max-parallel.use-case.spec.ts`
  e `apps/web/src/routes/ProjectSettingsTab.test.tsx` (`ParallelismSection`)
- **Gate:** `docs/gates.yml` (`paralelismo-autorizado`) — `status: active`
  desde a auditoria fluxo.yml × código (achado A1/B5); o mecanismo em si não
  mudou, só o registro que ficou `planned` por engano desde a FASE 14d, ver
  [gates.md](explanation/gates.md#a-registry-can-age-in-the-wrong-direction--stale-not-inactive)
- **Origem:** [ADR 0053](adr/0053-dev-lead-e-paralelismo-autorizado.md), FASE 14d

### RN-094 — A área de agentes nasce com o projeto {#rn-094}

Criar um projeto grava as três áreas (`dev`, `qa`, `infra`) em `agent_areas`,
com o lead de cada uma e os membros **enumeráveis** em `agent_area_members` —
na MESMA transação da criação. Se o seeding falha, o projeto não nasce: projeto
sem área é projeto onde a RN-083 lê tabela vazia e cai no default sem que
ninguém tenha decidido nada.

**Isto é a correção de um defeito, não uma capacidade nova.** `agent_areas`
existe desde a FASE 14d e nunca foi gravada — `AgentAreaRepository.upsert`
tinha teste e não tinha NENHUM chamador. Em produção a tabela estava vazia,
`GET /projects/:projectId/agent-areas` devolvia `[]`, e os quatro casos de uso
que a leem operavam sobre o nada. É a mesma falha da própria FASE 14d, escrita
no CLAUDE.md: **testar a peça não é testar o caminho até ela**. Por isso o
teste desta regra entra pelo caso de uso que a rota chama, com repositório
real: um fake aqui provaria exatamente o que já estava provado e quebrado.

**Semeia em DOIS lugares, e cada um responde uma pergunta diferente.** A
criação do projeto faz a área EXISTIR — a tela de Configurações lê num projeto
que nunca executou. A ativação da execução diz quem são os MEMBROS da área de
`dev`: um `dev-<modulo>` por módulo do `module_map`, que não existia quando o
projeto nasceu. Enquanto não há membros gravados, quem sustenta a regra de
endereçamento (RN-087) é o predicado `ehDevDeModulo`, que não consulta o banco.

**O seeding nunca manda `max_parallel`.** A ativação é repetível, e mandar o
default faria um teto que você subiu para 5 voltar para 2 em silêncio — o
produto desfazendo a sua decisão. O mesmo vale para a migração de backfill: ela
faz a área existir e para aí.

Projetos criados antes disto são cobertos pela migração `0038`, com `ON
CONFLICT DO NOTHING` nas duas tabelas. Sem ela, o defeito ficaria corrigido só
para quem começasse do zero.

- **Onde:**
  `apps/api/src/application/use-cases/agents/seed-agent-areas.use-case.ts`,
  chamado por `application/use-cases/iam/create-project.use-case.ts` e
  `application/use-cases/execution/activate-execution.use-case.ts`;
  lista canônica em `apps/api/src/domain/agents/agent-areas.ts`;
  backfill em `apps/api/src/db/migrations/0038_wandering_lila_cheney.sql`
- **Teste:**
  `test/application/use-cases/iam/create-project-semeia-areas.spec.ts` (o
  caminho, contra o banco, incluindo a falha que derruba a criação),
  `test/db/agent-areas-backfill.spec.ts` (a migração rodada de verdade, duas
  vezes) e `test/application/use-cases/execution/activate-execution.use-case.spec.ts`
  (os membros de dev, e o teto nunca enviado)
- **Origem:** FASE 18, defeito achado na investigação do programa 16–26;
  a tabela vem do [ADR 0053](adr/0053-dev-lead-e-paralelismo-autorizado.md)

### RN-084 — A esteira exibida deriva do registro de gates {#rn-084}

O painel do time mostra a etapa em que uma PR está **derivando-a de
`docs/gates.yml`**, não de uma lista escrita na tela. Gate que sai do registro
some da esteira; gate `planned` nunca aparece.

**A regra existe por uma forma específica de envelhecimento.** Antes da FASE
15b a tela tinha as etapas fixas no componente, e o registro (FASE 15a)
descrevia os gates em outro lugar. Nada ligava os dois: acrescentar um gate ao
YAML não mudava a tela, e remover um deixava a tela mostrando uma etapa que já
não existia — sem nenhum teste falhar, porque as duas fontes estavam certas
cada uma por si. É o mesmo apodrecimento que o `docs/.docmap.yml` existe para
impedir, e a resposta é a mesma: uma fonte só, com o consumo cobrado.

Três decisões de borda, todas para a tela **degradar** em vez de sumir:

- gate de PR que a tela ainda não sabe desenhar é **ignorado**, não quebra o
  render — o registro pode ganhar um gate antes de a tela ganhar o rótulo;
- os **rótulos são de tela**, não do registro: o YAML descreve engenharia, e a
  tela fala com quem espera uma PR;
- **sem registro** (a rota falhou), mostra a esteira completa em vez de vazia —
  uma esteira genérica informa mais que nada.

- **Onde:** `apps/web/src/components/PrGateTimeline.tsx` (`etapasDaEsteira`),
  lendo `GET /gates` (`apps/api/src/interfaces/http/gates/gates.controller.ts`)
- **Teste:** `apps/web/src/components/PrGateTimeline.test.ts`
  (`gate que SAI do registro some da tela`, `gate de PR que a tela ainda não
  sabe desenhar é IGNORADO`, `sem registro, mostra a esteira completa`)
- **Origem:** [ADR 0054](adr/0054-gates-como-registro-declarativo.md), FASE 15b

### RN-085 — O teto de iterações é por TIPO de agente {#rn-085}

Quantas voltas um agente pode dar no laço de ferramenta depende do trabalho que
ele faz: **8** para quem conversa, **60** para o dev agent e para os subagentes
de QA. Não há mais um número único.

**O teto de 8 nasceu de agente conversacional e foi herdado por quem trabalha.**
Na validação real da 13b isso apareceu como bloqueio: o dev agent gastou as
oito voltas explorando um repositório recém-provisionado e **nunca escreveu um
arquivo**; com 25, escreveu três e rodou os testes. O desfecho registrado era
`limite de iterações atingido` com origem `modelo` — tecnicamente verdade e
praticamente inútil, porque o modelo nunca chegou a julgar nada.

**Subir o default global seria a correção errada**, e é isso que a regra
protege: o Criativo não precisa de 60 voltas para conversar, e o teto também é
a trava contra laço infinito.

**Quem pode subir não é "quem trabalha muito", é quem tem trava de gasto por
baixo.** O teto de iterações protege contra laço infinito; quem protege o
BOLSO é o `token_budget_micros`. Dev agents e subagentes de QA rodam com o
`task_budget_micros` da task, então afrouxar as voltas não afrouxa a conta.
`infra-workflows` usa ferramenta pesada e mesmo assim **fica em 8**: ele roda
sem budget, e para ele o teto é a única trava que existe.

Duas bordas com teste próprio:

- **`dev-lead` é conversacional**, apesar do prefixo `dev-` que identifica os
  dev agents (`dev-<modulo>`, `dev-<modulo>-2`). O lead decide e delega, e sem
  a cláusula explícita nasceria com o teto do trabalho pesado por acidente de
  nomenclatura.
- **Agente desconhecido cai no teto mais baixo.** Errar para o lado barato:
  quem precisa de mais voltas aparece como `limite de iterações atingido` e é
  corrigido; quem ganha 60 por engano gasta calado.

- **Onde:** `apps/engine/lib/engine/harness/iteracoes.ex`, aplicado em
  `apps/engine/lib/engine/harness/tool_loop.ex` (`init/1`)
- **Teste:** `apps/engine/test/engine/harness/iteracoes_test.exs` e
  `apps/engine/test/engine/harness/tool_loop_test.exs`
  (`o teto vem do TIPO do agente quando o chamador não passa um`,
  `teto explícito do chamador VENCE o do tipo`)
- **Origem:** achado X, [validação real da 13b](explanation/validacao-real.md);
  [ADR 0053](adr/0053-dev-lead-e-paralelismo-autorizado.md), FASE 14d

### RN-086 — Gastar com mais agentes nunca se auto-aprova {#rn-086}

As duas ações que mexem em **quanto o produto pode gastar sozinho** —
`parallelize` (ultrapassar o teto agora) e `raise_max_parallel` (mudar o teto)
— nunca são auto-aprováveis. Nem por `agent_autonomy`, nem por
`permissions.json`. É a mesma classe de garantia da trava de merge e do teto do
patch de instrução.

**Sem isto o teto da [RN-083](#rn-083) seria decorativo.** Um `permissions.json`
com `Parallelize()` no `allow` faria toda ultrapassagem se aprovar sozinha — a
regra que existe para EXIGIR a decisão do usuário passaria a dispensá-la. E
`raise_max_parallel` é o caso mais grave: seria o produto elevando o próprio
limite de gasto, exatamente o que o pipeline de aprovação existe para impedir.

**A Anamnese pode PROPOR, e é isso que ela faz.** Quando autorizar mais um
agente vira rotina, o teto está errado, e quem percebe primeiro é quem lê o
histórico. O sinal já chegava a ela: as decisões do usuário na janela vêm de
`proposed_actions`, com `actionType` e `status`.

O limiar é **três aprovações e nenhuma negação**, e as duas metades importam:

- **duas não são rotina — são duas.** Três é o que separa "aconteceu" de "está
  acontecendo sempre";
- **uma negação derruba o sinal inteiro**, por mais aprovações que haja. Se o
  usuário recusou alguma vez, o teto está fazendo o trabalho dele, e propor
  subi-lo seria ler o sinal ao contrário.

Propor um teto **igual ou menor** que o vigente é recusado pela api: a Anamnese
roda periodicamente e reproporia a mesma coisa a cada rodada, enchendo de ruído
uma fila que o usuário precisa ler.

Aprovar aplica o valor do **payload**, não um recalculado na hora — é o número
que você leu ao decidir.

- **Onde:** `apps/api/src/domain/actions/decide.ts` (o teto),
  `application/use-cases/execution/propose-max-parallel.use-case.ts`,
  `execute-max-parallel-raise.use-case.ts`,
  `apps/engine/lib/engine/anamnese/tools/propose_max_parallel.ex` e o limiar em
  `apps/engine/lib/engine/workers/anamnese_worker.ex` (`nota_de_paralelismo/1`)
- **Teste:** `apps/api/test/domain/actions/decide.spec.ts`
  (`decide — teto do paralelismo`),
  `test/application/use-cases/execution/propose-max-parallel.use-case.spec.ts`,
  `execute-max-parallel-raise.use-case.spec.ts`,
  `apps/engine/test/engine/anamnese/tools_test.exs` e
  `test/engine/workers/anamnese_worker_test.exs` (`duas aprovacoes NAO sao
  rotina`, `uma NEGACAO derruba o sinal`)
- **Origem:** [ADR 0053](adr/0053-dev-lead-e-paralelismo-autorizado.md), FASE 14d

### RN-087 — O Dev Lead é o único endereço externo da execução {#rn-087}

Existe um agente `dev-lead`, conversacional, que recebe o handoff do Arquiteto
e propõe o **plano de execução**: quantos agentes por módulo e por quê. Ele não
escreve código — distribui trabalho e responde por ele.

**Antes dele, a frase "quem decide é o lead" da [RN-083](#rn-083) não tinha
dono.** O Arquiteto terminava e a execução subia por um botão, sem ninguém no
meio para avaliar quanto trabalho havia.

**Os `dev-<modulo>` deixaram de ser endereçáveis por handoff.** Isso não é
exceção nova: é a regra do [ADR 0038](adr/0038-hierarquia-de-agentes.md) —
handoff externo endereça só lead de área ou agente sem área — passando a valer
para o dev como já valia para QA e Infra. Enquanto não havia Dev Lead, eles
eram agentes SEM área e por isso alvos válidos; virando membros, deixam de ser.

**A área de `dev` é a primeira DINÂMICA**, e é o que forçou o predicado: os
membros são um por módulo do `module_map`, decididos pelo Arquiteto e
diferentes em cada projeto, então não há lista a enumerar. `dev-lead` casa com
o mesmo prefixo `dev-` dos membros, e quem o exclui é a regra genérica **o lead
nunca é membro da própria área** — que vale para qualquer área e vive num lugar
só. A primeira versão repetia essa exclusão em três pontos, e a verificação por
mutação mostrou que nenhuma das cópias era alcançável por teste: cada uma
sobrevivia à mutação da outra.

**O plano é `proposed_action` (revisado pelo [ADR 0086](adr/0086-dev-lead-plano-suspende-para-aprovacao.md), [RN-284](#rn-284)).**
Até essa mudança o plano virava EVENTO simples, sem aprovação: o argumento era
que propor não tem efeito externo — o gasto acontece quando os agentes sobem,
e é lá que o teto cobra autorização; transformar a proposta em ação a decidir
faria você decidir duas vezes a mesma coisa. Uma auditoria de
`docs/fluxo.yml` × código encontrou que o fluxo já declarava esta saída como
`via: proposed_action` desde o ADR 0085, e o código nunca foi ajustado para
bater — o dono do produto decidiu que o código errava: o plano é a PRIMEIRA
decisão real de quanto a sessão vai gastar com paralelismo, e o usuário passou
a decidir ativar a execução tendo VISTO uma aprovação de verdade, não só lido
uma linha no fio. A lição antiga não desapareceu — é o motivo pelo qual
`propose_execution_plan` NÃO entrou no bloco de tetos absolutos de
`decide.ts` (ver RN-284).

**O plano BEM-SUCEDIDO encerra o turno — no caminho SEM suspensão.** Na
primeira execução real o Dev Lead registrou **dois** `execution.plan_proposed`
na mesma sessão — textos diferentes, mesmo total —, porque o laço voltava ao
modelo e ele propunha de novo. O event log é imutável: ficaram duas propostas
e nada dizendo qual valia. A instrução "use uma vez" no spec da ferramenta é
pedido, não garantia; quem garante é o laço parar. Desde o ADR 0086, quando a
proposta fica `pending`, quem encerra o turno é a PARADA por suspensão
(RN-284) — o sucesso imediato (`auto_approved`/`executed`/`approved`, ver
RN-284) continua fechando o laço do mesmo jeito de sempre.

**Bem-sucedido, e não "chamou a ferramenta"**: um plano recusado (vazio, ou com
zero agente num módulo) deixa o laço seguir, senão a recusa vira fim de turno e
o modelo nunca chega a corrigir. A primeira versão desta guarda olhava só o
nome da ferramenta e tinha esse defeito — encontrado pelo teste comportamental,
não pela leitura.

Um plano vazio, ou com zero agente num módulo, é recusado **antes de propor
qualquer coisa** — a proposta, uma vez criada, é decisão real do usuário, e um
plano meio proposto não teria como ser retratado.

- **Onde:** `apps/engine/lib/engine/agents/dev_lead_server.ex` e
  `dev_lead_tools.ex`; a regra de endereçamento em
  `apps/api/src/domain/agents/agent-areas.ts`; o handoff em
  `application/use-cases/agents/offer-infra-handoff.use-case.ts`
- **Teste:** `apps/engine/test/engine/agents/dev_lead_tools_test.exs`,
  `dev_lead_server_test.exs` (`o plano ENCERRA o turno`, `o plano recusado NÃO
  encerra o turno`),
  `apps/api/test/domain/agents/agent-areas.spec.ts` (`o dev de módulo DEIXOU de
  ser endereçável`, `` `dev-lead` É endereçável, apesar do prefixo ``) e
  `test/application/use-cases/agents/offer-infra-handoff.use-case.spec.ts`
- **Origem:** [ADR 0053](adr/0053-dev-lead-e-paralelismo-autorizado.md), FASE 14d;
  o mecanismo de aprovação revisado pelo [ADR 0086](adr/0086-dev-lead-plano-suspende-para-aprovacao.md)

### RN-064 — Heartbeat não encerra sessão com trabalho pendente {#rn-064}

O timeout de heartbeat mede inatividade da **aba**, não do **trabalho**. Antes
de encerrar, o `SessionServer` pergunta à api se sobrou trabalho
(`GET /internal/sessions/:id/pending-work`); havendo, reagenda o timeout e
registra o motivo no log em vez de matar a sessão.

O default são **30 segundos**. Sair da sessão para a aba de Backlog já bastava
para matá-la — e numa execução real isso prendeu um handoff `offered` para o
Arquiteto dentro de uma sessão fechada: épico e quatro histórias prontos, e a
cadeia sem como seguir, porque não existe onde aceitar handoff de sessão morta.

Fechar sessão é sobre o trabalho ter acabado, não sobre quem está olhando.

**A api fora do ar NÃO impede o encerramento**: `{:error, _}` encerra assim
mesmo, com aviso no log. Trocar sessão órfã por sessão imortal seria trocar um
defeito por outro.

"Trabalho pendente" são **três** sinais — o segundo entrou pelo achado V, o
terceiro pelo bug real do Criativo→PO→Arquiteto:

1. **handoff `offered`** — o caso original acima;
2. **`proposed_action` com status `pending`** — alguém está esperando a SUA
   decisão, e um agente pode estar suspenso esperando o desfecho
   ([RN-073](#rn-073));
3. **agente ATIVADO ainda em turno** — o último `agent.status` de cada ator
   que já falou na sessão é `working` sem um `idle` posterior.

O segundo é o mesmo defeito do primeiro um nível abaixo, e a execução do
`hello-limpo` mostrou o custo: a sessão nasceu 23:34:12, uma ação ficou
`pending` às 23:34:13, e o heartbeat a fechou às **23:34:42 — exatamente os 30s
do timeout**. O dev agent seguiu trabalhando por mais de uma hora numa sessão
que o banco dava por encerrada, e isso envenena toda métrica por sessão:
duração, custo e "quantas terminaram bem" passam a ler um estado que não
descreve o que houve.

O terceiro é a mesma janela, um passo antes de qualquer um dos dois primeiros
existir: `AcceptHandoffUseCase` marca o handoff antigo como `accepted` e ativa
o próximo agente na hora, mas a ativação no engine é `GenServer.cast`
fire-and-forget — responde 201 antes de o agente sequer começar. O PO ativado
pelo handoff do Criativo roda um kickoff de até 12 iterações de LLM usando só
ferramentas `category: :direct` (`create_epic`/`create_story`/`create_task`),
que nunca geram `proposed_action`, e só oferece o handoff seguinte (o sinal 1)
no FIM do turno inteiro. Entre a ativação e esse fim, nem o sinal 1 nem o sinal
2 existiam — só o ping do canal Phoenix a cada 10s segurava a sessão, e
qualquer atraso maior que os 30s do timeout fechava a sessão com o PO ainda
gerando o backlog, quebrando a cadeia de handoff pela raiz: o handoff seguinte
acabava sendo oferecido numa sessão já `closed`, que não aceita mais nada.

`agent.status` (`working`/`idle`) é o que todo agente conversacional
(Criativo/PO/Arquiteto/Dev Lead/Infra) já narra nos limites de turno, e é
PERSISTIDO no event log, não só broadcastado no canal
(`Engine.Sessions.LiveBroadcast.agent_status/4`, [ADR 0021](adr/0021-fechamento-4a-infra-e-painel.md))
— o mesmo sinal que o painel do time já lê para derivar o roster
(`conversationalStatus` em `apps/web/src/lib/agent-status.ts`). Reaproveitá-lo
aqui não exigiu evento novo nenhum: o terceiro sinal é o último `agent.status`
de CADA ator que já falou na sessão, e é genérico por tipo de evento — cobre
qualquer agente ativado por handoff, não só o PO.

A versão anterior desta regra dizia, por escrito, que incluir trabalho de agente
"sem um teste que prove a interação seria adivinhar". A execução produziu a
prova, e o teste agora existe.

**O que continua fora:** task `in_progress` sem ação pendente nem handoff nem
turno em aberto. O dev agent tem máquina de estados própria e retém o worktree
por conta dele; o sinal que a api possui e que a execução comprovou é a ação
pendente. Incluir a task exigiria a api ler `dev_agent_states`, que é do
engine — decisão de fronteira, não conserto de passagem. Os dev agents também
não emitem `agent.status` (rodam com máquina de estados própria, não com o
loop conversacional de turno) — o terceiro sinal não os cobre, e não precisa:
a ação pendente já cobre o caminho deles.

- **Onde:** `apps/api/src/application/use-cases/sessions/get-session-pending-work.use-case.ts`,
  `apps/api/src/application/ports/session-event-repository.port.ts`
  (`listByTypeInSession`), `apps/engine/lib/engine/sessions/session_server.ex`
  (`handle_info(:heartbeat_timeout, …)`)
- **Teste:** `apps/engine/test/engine/sessions/session_lifecycle_test.exs`
  (`heartbeat NÃO encerra sessão com trabalho pendente` e o caso oposto) e
  `apps/api/test/application/use-cases/sessions/get-session-pending-work.use-case.spec.ts`
  (os três sinais, a ação já decidida que NÃO segura, o `idle` que libera, o
  isolamento por ator, a genericidade por tipo de agente e o escopo por
  sessão)
- **Origem:** execução real da FASE 13b; achado V, Fase H do
  [backlog](explanation/backlog.md); bug real do encadeamento
  Criativo→PO→Arquiteto

### RN-063 — Encerrar sem produzir é desfecho, não falha {#rn-063}

A Anamnese tem uma ferramenta para dizer **"não há nada a emitir, e este é o
motivo"** (`skip_proficiency`). A rodada encerra com `anamnese.run_skipped` e o
motivo no payload — nunca com `anamnese.run_failed`.

Antes ela não tinha esse verbo. A única ferramenta era `emit_proficiency`, que
recusa lista vazia (com razão: perfil vazio não é perfil). Numa janela sem
membro elegível a Anamnese descobria isso na PRIMEIRA iteração, escrevia em
prosa "não há membros elegíveis", chamava `emit_proficiency` com `profiles: []`,
era recusada — e repetia até o teto de iterações. Cada volta reenvia o
histórico, que cresce a cada volta.

Numa execução real isso custou **145 mil tokens de entrada e 4× o gasto do
Criativo e do PO somados**, sem produzir nada. E voltava a cada tick do
agendador, a cada 15 minutos, para sempre.

O teto de iterações funcionava — não era laço infinito. O desperdício era **por
rodada, repetido indefinidamente**, que é pior: um laço trava e alguém percebe;
este sangrava devagar.

Narrar `run_failed` para uma rodada que fez a coisa certa também é defeito: quem
lê o log aprende a ignorar o evento de falha.

- **Onde:** `apps/engine/lib/engine/anamnese/tools/skip_proficiency.ex`,
  `apps/engine/lib/engine/anamnese/hooks/termination.ex`,
  `apps/engine/lib/engine/workers/anamnese_worker.ex` (`handle_outcome`)
- **Teste:** `apps/engine/test/engine/workers/anamnese_worker_test.exs`
  (`encerrar sem perfis é DESFECHO: narra run_skipped com o motivo, não falha`)
- **Origem:** execução real da FASE 13b

### RN-062 — Mensagem a agente conversacional REIDRATA o processo {#rn-062}

Uma mensagem endereçada a Criativo, PO ou Arquiteto sobe o processo se ele não
estiver de pé, antes de entregar. O `init` de cada servidor já reconstrói o
histórico do event log; faltava quem o chamasse.

Antes, um restart do engine matava a conversa em silêncio: a sessão sobrevivia
como `active`, o processo do agente não, e a próxima mensagem morria com
`GenServer.call ... exited` — sem evento, sem erro na tela, sem nada. O usuário
via a própria mensagem aparecer e nenhuma resposta chegar, para sempre.

O comentário de `revise/2` dizia que agente morto nesta rota "é um bug". É — e
basta o engine reiniciar para acontecer. É a mesma garantia que a Fase 12b deu
aos dev agents, aplicada aos conversacionais.

- **Onde:** `apps/engine/lib/engine_web/controllers/agent_command_controller.ex`
  (`message/2`)
- **Teste:** coberto pela suite de agentes; a prova de execução está em
  docs/explanation/validacao-real.md
- **Origem:** execução real da FASE 13b

### RN-060 — O gasto das chaves é do owner, e só ele vê {#rn-060}

O relatório de consumo por credencial (`GET /workspaces/:id/credential-spend`)
exige **`owner`** no workspace. Não é `maintainer`: desde a
[RN-058](#rn-058) os agentes de todos os projetos gastam a credencial do dono,
e a fatura dele não é assunto de quem só opera um projeto.

O relatório agrupa por **provider**, porque é essa a unidade da credencial —
uma chave por provider, por pessoa. Um total único não bateria com fatura
nenhuma.

E separa **agente** de **pessoa**: as duas coisas saem da mesma chave desde a
RN-058, e "meus agentes estão caros?" é uma pergunta diferente de "eu uso muito
o chat?". Por isso este é o único agregado de custo do produto **sem** o filtro
`actor_kind = 'agent'` da [RN-038](#rn-038) — aqui a pergunta é quanto saiu da
chave, e o chat do próprio owner sai dela.

Gasto de credencial **já removida** continua no relatório, marcado: o consumo
aconteceu, e escondê-lo daria um total que não fecha com o extrato do provider.

Nenhum segredo atravessa: a resposta tem provider, tokens e custo — nunca a
chave, nem cifrada ([ADR 0050](adr/0050-credencial-sempre-cifrada-verificacao-explicita.md)).

- **Onde:**
  `apps/api/src/application/use-cases/llm/get-credential-spend.use-case.ts`,
  `apps/api/src/interfaces/http/llm/budgets.controller.ts`,
  `apps/web/src/components/CredentialSpendSection.tsx`
- **Teste:** `test/application/use-cases/llm/get-credential-spend.use-case.spec.ts`
  (agrupa por provider; separa agente de pessoa; chave removida fica marcada);
  `apps/web/src/components/CredentialSpendSection.test.tsx`
- **Origem:** decisão do usuário junto com a RN-058

### RN-101 — O mesmo gasto, duas audiências: a fatura é do owner, o consumo é de quem gastou {#rn-101}

O produto responde **duas perguntas diferentes** sobre `token_usage`, e nenhuma
é recorte da outra.

**A do owner é por CREDENCIAL.** `GET /workspaces/:id/credential-spend` continua
como a [RN-060](#rn-060) o deixou — por provider, exigindo `owner`, respondendo
"quanto saiu da minha chave". Junto dele, `GET /workspaces/:id/spend-report`
(também `owner`) quebra o workspace por **modelo, provider, projeto, ator e
dia** — o eixo de provider entrou pela [RN-186](#rn-186). O owner vê os dois
porque é a única pessoa que pode ver os dois.

**A do membro é por ATOR.** `GET /projects/:id/spend/me` (papel `viewer`)
devolve, em tokens e custo **estimado**, o que **quem chamou** consumiu naquele
projeto, por sessão e por dia. Ela **não quebra por provider nem por
credencial** — a chave que rodou é a do owner ([RN-058](#rn-058)), e uma fatia
da fatura dele não é o que o membro está perguntando.

O ator **não é parâmetro**: sai do usuário autenticado, e não existe onde
escrever o id de outra pessoa. "Membro não vê linha de outro ator" é propriedade
da assinatura do caso de uso, não uma checagem que alguém pode esquecer de
chamar.

**Agente não entra na conta do membro.** `token_usage` registra quem GASTOU, não
quem mandou gastar; atribuir o agente a quem o iniciou seria inventar um dado
que a tabela não tem. Gasto de agente aparece no relatório do owner, de quem é a
chave.

**O eixo de `provider` existe, e o membro não o alcança.** Até o
[ADR 0076](adr/0076-provider-volta-a-ser-dimensao-de-gasto.md) ele simplesmente
não existia na agregação, e era a ausência que continha a visão do membro. Hoje
`sumGroupedBy` tem seis dimensões (`model`, `provider`, `project`, `actor`,
`session`, `day`) e a contenção mudou de forma, não de força: quem contém é o
TIPO — ver [RN-186](#rn-186) e [RN-187](#rn-187). O que não mudou é que dois
providers servindo o mesmo nome de modelo continuam caindo numa linha só na
dimensão `model`.

- **Onde:**
  `apps/api/src/application/use-cases/llm/get-my-spend.use-case.ts`,
  `apps/api/src/application/use-cases/llm/get-workspace-spend-report.use-case.ts`,
  `apps/api/src/application/ports/token-usage-repository.port.ts`,
  `apps/api/src/interfaces/http/llm/spend.controller.ts`,
  `apps/web/src/routes/ProjectSpendTab.tsx`
- **Teste:** `apps/api/test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  (o membro não enxerga linha de outro ator, nem de agente, nem do owner; o
  filtro é pelo par `(kind, id)`; a resposta não carrega provider);
  `apps/web/src/routes/ProjectSpendTab.test.tsx`
- **Origem:** [ADR 0063](adr/0063-duas-audiencias-para-o-mesmo-gasto.md) (FASE 22),
  revisto pelo [ADR 0076](adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-186 — `provider` é dimensão do relatório do owner, e só dele {#rn-186}

`sumGroupedBy` aceita `provider` como dimensão, e
`GET /workspaces/:id/spend-report` devolve a lista `porProvider` ao lado de
modelo, projeto, ator e dia. O [ADR 0063](adr/0063-duas-audiencias-para-o-mesmo-gasto.md)
tinha deixado o eixo de fora; o [ADR 0076](adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)
o devolveu **sem revogar o argumento**: quebrar gasto por provider continua
sendo quebrar por CREDENCIAL, e por isso o eixo mora numa rota que já exige
`owner` ([RN-060](#rn-060)) — a mesma régua de `credential-spend`, que segue
respondendo a pergunta da FATURA (por mês, com o vínculo à chave que existe
hoje).

`GET /projects/:id/spend/me` **não ganhou nada**. A assimetria é o desenho: as
duas respostas continuam não sendo recorte uma da outra ([RN-101](#rn-101)).

A dimensão `model` **não mudou**: dois providers servindo o mesmo nome de modelo
continuam numa linha só. Quem quer a quebra por credencial tem a lista própria,
e cruzar as duas dimensões multiplicaria as linhas do ranking sem responder
pergunta que as duas listas separadas já não respondam.

- **Onde:** `apps/api/src/application/ports/token-usage-repository.port.ts:123`
  (`SpendDimension`),
  `apps/api/src/infrastructure/persistence/drizzle/token-usage.repository.ts:245`
  (o `GROUP BY`), `apps/api/src/application/use-cases/llm/get-workspace-spend-report.use-case.ts:112`,
  `apps/api/src/interfaces/http/llm/spend.controller.ts:56`
- **Teste:** `apps/api/test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  ("quebra por PROVIDER, e o mesmo nome de modelo em dois providers segue UMA
  linha")
- **Origem:** [ADR 0076](adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-187 — A visão do membro não alcança `provider`, e quem garante é o TIPO {#rn-187}

Enquanto o eixo não existia, o que continha a visão do membro era a **ausência**
de argumento a passar. Com o eixo de volta, a contenção passou a ser da
assinatura: `sumGroupedBy` tem **duas sobrecargas**, e a que aceita um escopo com
`actor` — o da audiência do membro, e o único que ele tem — só recebe
`SpendDimensionDoAtor`, que é `Exclude<SpendDimension, 'provider'>`.
`sumGroupedBy('provider', escopoComAtor)` **não compila**.

Nem o repositório nem o caso de uso têm `if` sobre essa combinação, de
propósito: uma checagem em tempo de execução daria a impressão de que a garantia
é dinâmica, quando quem a sustenta é o compilador — e um `if` é o tipo de coisa
que a próxima refatoração remove sem que nenhum teste fique vermelho.

A barreira é dupla e as duas metades são independentes: a rota do membro
**também não tem parâmetro de dimensão** (só `projectId` e `dias`), então uma
query inventada como `?dimensao=provider` é descartada pelo Nest antes de
chegar ao handler.

`Exclude` em vez de uma segunda lista escrita à mão é deliberado: dimensão nova
nasce alcançável pelas duas audiências, e tirá-la do alcance do membro vira ato
explícito **neste ponto** — nunca um esquecimento em outro arquivo.

- **Onde:** `apps/api/src/application/ports/token-usage-repository.port.ts:107`
  (as duas sobrecargas), `:138` (`SpendDimensionDoAtor`), `:154`/`:164` (os dois
  escopos), `apps/api/src/application/use-cases/llm/get-my-spend.use-case.ts:73`,
  `apps/api/src/interfaces/http/llm/spend.controller.ts:98`
- **Teste:** `apps/api/test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  ("não compila pedir `provider` com escopo de ator" — um `@ts-expect-error` que
  o `tsc` reprova como diretiva NÃO USADA se a barreira cair; e "só pede as
  dimensões `session` e `day`"),
  `apps/api/test/interfaces/spend.controller.spec.ts` (a rota do membro aceita
  `dias` e mais nada)
- **Origem:** [ADR 0076](adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-188 — Pessoa e agente são partição da lista por ator, sem consulta a mais {#rn-188}

O relatório do owner traz `porOwner` (linhas de `actor_kind = 'user'`) e
`porAgente` (`actor_kind = 'agent'`) além de `porAtor`, que continua inteira.
Os dois blocos são **derivados** de `porAtor` no caso de uso — `actorKind` já
vem na linha desde a FASE 22 —, e não duas consultas com `where actor_kind`.
O motivo é medido: o [ADR 0063](adr/0063-duas-audiencias-para-o-mesmo-gasto.md)
mostrou que o custo destas consultas cresce com o tamanho de `token_usage` e
não com o do pedido, então varrer a janela duas vezes a mais para separar o que
já está separado em memória seria caro pelo motivo errado.

`actor_kind` que não seja pessoa nem agente (hoje, `system`) **não entra em
nenhum dos dois blocos** e continua visível em `porAtor` e no total. Abrir um
terceiro bloco para ele diria que o produto tem uma audiência que ele não tem.

O rótulo "Por owner" é do handoff de design e vale pela [RN-058](#rn-058) — é a
chave do owner que todas essas linhas gastam. Quem é o dono do workspace
continua sendo o campo `ownerId`, não o `actorKind` de cada linha.

- **Onde:** `apps/api/src/application/use-cases/llm/get-workspace-spend-report.use-case.ts:120`
- **Teste:** `apps/api/test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  ("separa PESSOA de AGENTE em dois blocos, sem perder a lista por ator")
- **Origem:** [ADR 0076](adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-102 — O modelo da área é padrão herdável; divergir é decisão do agente, e voltar a herdar apaga a decisão {#rn-102}

A cascata de binding ganhou um nível: `sessão > agente > **área** > projeto >
workspace`. `area` fica ENTRE agente e projeto — é o PADRÃO que o lead e os
subagentes de uma área compartilham (`qa`/`qa-automacao`/
`qa-performance-seguranca`, `infra`/`infra-workflows`, `dev`/`dev-<módulo>`), e
o binding do próprio agente é a DIVERGÊNCIA que o sobrepõe. Se a área viesse
ACIMA do agente ela venceria sempre, e "padrão herdável" seria, na prática,
"padrão imposto" — nenhum agente conseguiria escolher outro modelo.

O nível novo entra na MESMA revalidação de capability da
[RN-041](#rn-041)/[RN-043](#rn-043): modelo da área que sumiu do provider ou
que não faz tool calling é PULADO e registrado em `skipped`, exatamente como
`agent` já era. `assertModelFitsBindingScope` (RN-040) passou a exigir
`supports_tool_calling` também no escopo `area` — ela nunca é lida por chat
humano, só por agente, então deixá-la passar adiaria a mesma falha silenciosa
em um nível.

**"Voltar a herdar" apaga o binding, nunca copia o modelo do nível de baixo
para o de cima.** Gravar no agente o modelo que a área decidiu pareceria igual
na tela e não é: viraria uma CÓPIA, e a próxima mudança da área deixaria esse
agente para trás sem ninguém notar. Herdar é a AUSÊNCIA de decisão própria, e
desfazer uma divergência é remover a linha — `DELETE
/projects/:id/agent-bindings/:slug` e `DELETE
/projects/:id/area-bindings/:key`, ambos 204, ambos 404 quando o escopo já
herda (idempotência que MENTIRIA se fosse 204 silencioso: apagar o que não
existia e apagar de verdade são respostas diferentes para a mesma tela).

Mudar o modelo da ÁREA exige `maintainer`, e não `developer` como o do agente
individual — pelo mesmo motivo do teto de paralelismo
([RN-083](#rn-083)): o binding da área alcança o lead e TODOS os subagentes de
uma vez, e escolher modelo é decidir quanto o produto gasta sem perguntar.

- **Onde:** `apps/api/src/domain/llm/binding-resolver.ts` (precedência),
  `apps/api/src/domain/llm/model-capabilities.ts` (capability de `area`),
  `apps/api/src/application/use-cases/llm/resolve-model-binding.use-case.ts`
  (a área do agente sai do catálogo `agent-areas.ts`, sem round-trip ao
  banco), `apps/api/src/application/use-cases/llm/clear-model-binding.use-case.ts`,
  `apps/api/src/interfaces/http/llm/model-bindings.controller.ts`
  (`area-bindings`, `DELETE` em `agent-bindings` e `area-bindings`),
  `apps/web/src/routes/ProjectSettingsTab.tsx` (`AreaModelsSection`, coluna
  Origem com "voltar a herdar")
- **Teste:** `test/domain/llm/binding-resolver.spec.ts`,
  `test/domain/llm/model-capabilities.spec.ts`,
  `test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`,
  `test/application/use-cases/llm/clear-model-binding.use-case.spec.ts`,
  `apps/web/src/routes/ProjectSettingsTab.test.tsx`
- **Origem:** [ADR 0064](adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md) (FASE 23)

### RN-103 — O binding de agente é POR PROJETO, não mais global {#rn-103}

Até a FASE 23, `scope = 'agent'` guardava um SLUG global
(`scope_id = 'qa'`), e `PUT /projects/:id/agent-bindings/:slug` recebia
`:projectId` na rota e o DESCARTAVA de propósito — escolher o modelo do
Arquiteto na tela de um projeto mudava o modelo dele em TODOS os projetos.
Isso deixou de se sustentar quando a área virou padrão herdável (RN-102): a
área é por projeto, e um binding de agente global ACIMA de um padrão por
projeto faria o mesmo agente resolver modelos diferentes só onde existisse
área — e faria "voltar a herdar" apagar uma decisão que alcançava projetos
que ninguém está olhando.

A saída foi tornar `agent` por projeto também, e não rebaixar a área para
abaixo do agente: `scope_id` de `agent` e de `area` virou COMPOSTO —
`<projectId>:<slug do agente|chave da área>` — em vez de inventar uma tabela
nova só para guardar um projeto por binding. UUID de projeto e slug de agente
nunca contêm `:`, o que torna o primeiro `:` um separador não ambíguo; a
leitura corta nele, e não em todos, para um slug com `:` (nenhum existe hoje,
mas nada impede) não virar três pedaços.

`scope_id` sem o projeto (o formato antigo) é RECUSADO na escrita, não aceito
e ignorado: gravá-lo criaria um binding que a cascata nunca mais encontraria
— invisível, e não um erro. A migração 0040 espalha cada binding de agente
global existente para uma linha por projeto (preservando o que cada projeto
resolvia antes da mudança) e apaga o formato antigo; é ESPALHAR e não
apagar porque a linha global nunca guardou informação de a quem "pertencia" —
inventar um projeto dono seria inventar dado que não existia.

- **Onde:** `apps/api/src/domain/llm/binding-scope-id.ts` (formato e
  validação), `apps/api/src/application/use-cases/llm/set-model-binding.use-case.ts`
  (`workspaceDoEscopo` passou a derivar o workspace de `agent`/`area` também —
  a curadoria da RN-043 não era verificável neles antes), `apps/api/src/db/migrations/0040_tearful_night_nurse.sql`
- **Teste:** `test/domain/llm/binding-scope-id.spec.ts`,
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`,
  `test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`
  ("o binding de agente é POR PROJETO: o vizinho não o enxerga")
- **Origem:** [ADR 0064](adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md) (FASE 23)

### RN-059 — Falha de turno é evento durável com origem, e o agente fala {#rn-059}

Quando um turno de LLM falha, o agente grava **`agent.error`** no event log
com três campos: `origem` (vocabulário do ADR 0020), `mensagem` em português e
o `reason` bruto. E a mensagem aparece **no fio da conversa**, não só no log.

Era o contrário, e o desfecho era o pior possível: os quatro agentes
conversacionais gravavam `agent.response` com conteúdo **vazio** —
indistinguível de sucesso no log imutável — e mandavam o motivo por
`broadcast`, que é efêmero. Quem não estivesse com a aba aberta naquele
segundo nunca saberia que houve erro; quem estivesse, via um balão em branco.

Havia um segundo caminho, pior ainda: quando a api narrava a falha no PRÓPRIO
frame final (budget, credencial ausente, binding faltando), o turno não caía no
ramo de erro e **não emitia evento nenhum** — silêncio absoluto.

Esse mesmo ramo, uma vez corrigido, custou uma segunda rodada: no PO, no
Arquiteto e no Dev Lead ele devolvia `{state, ""}` — uma TUPLA onde todos os
outros ramos de `run_turn` devolvem o `state` (um mapa). O `Map.put/3` de
`TurnoAssincrono.tratar_resultado/2` levantava `BadMapError` dentro do
`handle_info`, e como os quatro conversacionais são `restart: :temporary`, o
agente MORRIA e não voltava. A falha deixava de ser silenciosa e virava uma
queda — com os gatilhos mais corriqueiros que existem. A regra vale inteira: o
agente narra a falha **e continua de pé**. Por isso `tratar_resultado/2` tem
uma segunda barreira, no ponto compartilhado pelos quatro: resultado de turno
que não é mapa vira `agent.error` com origem `codigo`, nunca um processo morto.

A origem NUNCA é adivinhada: cada padrão em `FalhaDeTurno.origem/1` tem um
motivo escrito, e o que não casa com nenhum sai como **`codigo`** — a lacuna é
do nosso classificador, e essa é a origem que aponta a ação certa (ADR 0020).

Os eventos já gravados não se apagam — a tela os NOMEIA como resposta vazia
anterior a esta regra, em vez de mostrar branco.

- **Onde:** `apps/engine/lib/engine/agents/falha_de_turno.ex`,
  `criativo_server.ex`, `po_server.ex`, `arquiteto_server.ex`,
  `dev_lead_server.ex`, `infra_lead_server.ex` (`emit_falha/2`),
  `turno_assincrono.ex` (`tratar_resultado/2`, a segunda barreira),
  `apps/web/src/lib/session-falha.ts`
- **Teste:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  (evento durável com origem; nunca grava resposta vazia; erro narrado no frame
  final também vira evento); `po_server_test.exs` (o frame final com erro não
  derruba o agente — GenServer de VERDADE, com `Process.alive?/1`);
  `arquiteto_server_test.exs` e `dev_lead_server_test.exs` (mesmo caminho, ciclo
  completo); `turno_assincrono_test.exs` (a segunda barreira narra em vez de
  derrubar); `apps/web/src/lib/session-falha.test.ts`
- **Origem:** execução real da FASE 13b

### RN-116 — Falha ao CRIAR um handoff não derruba o agente {#rn-116}

`confirm_readiness` (Criativo → PO) e `offer_infra_handoff`/`offer_dev_handoff`
(Arquiteto → Infra/Dev Lead) chamam a api pra criar o handoff DEPOIS de o
turno já ter rodado — no caso do Criativo, depois de o `product_brief` já
estar gravado no event log. Se essa chamada falhar (api fora, 5xx, etc.), o
handoff não existe, mas isso NUNCA derruba o GenServer do agente: a falha vira
`agent.error` durável, com `origem` (`FalhaDeTurno.origem/1`) e uma mensagem
que diz o que JÁ foi salvo (o product_brief, as regras) e o que não foi (o
handoff) — para o usuário saber que confirmar de novo é seguro, não repete
trabalho.

Era o oposto: as três chamadas usavam `{:ok, _handoff} = EngineApiClient.create_handoff(...)`
— um match rígido. `{:error, _}` virava `MatchError`, e como os três agentes
sobem com `restart: :temporary` num `DynamicSupervisor` `:one_for_one`, o
processo simplesmente SUMIA — sem `agent.error`, sem resposta no fio, só
silêncio. Do lado de quem observava: a informação (regras, product brief)
parecia ter "passado" (estava gravada), mas nada iniciava do lado do agente
seguinte, porque o handoff nunca chegou a existir. Reabrir a conversa não
resolvia sozinho — só uma NOVA mensagem reativa o processo (rehidratando do
event log), e só uma nova confirmação de prontidão tenta o handoff de novo.

A mensagem NÃO reusa `FalhaDeTurno.mensagem/1` (a de `RN-059`, "não consegui
completar este turno... nada foi gasto"): nos três call sites o trabalho já
rodou (ou nem precisava rodar, no caso de `offer_dev_handoff`) — dizer "nada
foi gasto" seria falso quando tokens já tinham sido gastos no turno de
consolidação. Reusa só `FalhaDeTurno.origem/1`, que classifica pelo FORMATO
do motivo (status HTTP, exceção de transporte), não por ser turno de LLM.

O `Engine.Harness.Tools.OfferHandoff` (a ferramenta que o PO usa via tool
call, dentro do ToolLoop) já tratava `{:error, reason}` sem crashar — o
defeito era só nestes três handlers server-driven, que chamam
`EngineApiClient.create_handoff/5` DIRETO em vez de passar pela ferramenta.

- **Onde:** `apps/engine/lib/engine/agents/criativo_server.ex`
  (`handle_call(:confirm_readiness, ...)`, `emit_falha_handoff/3`),
  `apps/engine/lib/engine/agents/arquiteto_server.ex`
  (`handle_call(:offer_infra_handoff, ...)`, `handle_call(:offer_dev_handoff, ...)`,
  `emit_falha_handoff/3`)
- **Teste:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  ("prontidão: falha ao criar o handoff NÃO derruba o processo, e vira
  agent.error durável"); `apps/engine/test/engine/agents/arquiteto_server_test.exs`
  (as quatro variantes de `offer_infra_handoff`/`offer_dev_handoff`, sucesso e
  falha)
- **Origem:** relato de uso real no projeto `exp-001` (Criativo → PO); a
  mesma falha estrutural foi achada por leitura de código nos dois handoffs
  do Arquiteto, sem reprodução separada para eles

### RN-058 — A chave que o AGENTE gasta é a do owner do workspace {#rn-058}

Credencial de LLM pertence a uma pessoa (`user_credentials.user_id`), e agente
não é pessoa. O turno de agente resolve a chave pelo **owner do workspace**
(`workspaces.created_by`), não por quem abriu a sessão nem por quem criou o
projeto: quem banca a conta banca os agentes, e isso não muda quando outra
pessoa da equipe começa a sessão.

`created_by` e não `workspace_members.role = 'owner'`: pode haver vários
owners, e "qualquer um deles" faria a chave usada variar sem ninguém decidir.

Antes disto o turno passava o **slug do agente** (`agentId ?? sessionId`) na
coluna de usuário. A consulta ia ao banco com `user_id = 'criativo'`, o
Postgres recusava o UUID inválido, e o erro virava **resposta vazia** no fio —
sem métrica, sem evento de falha, sem nada na tela. O efeito prático, que só
uma execução real revelou: **nenhum agente jamais usou um provider com
credencial**. Só `ollama` funcionava, porque para ele a busca é pulada — e foi
com modelo local que a Fase 4, o dogfooding da Fase 10 e todas as demos
rodaram.

O chat humano nunca teve o defeito: ele usa `actor.id`, que é o usuário de
verdade.

- **Onde:**
  `apps/api/src/application/use-cases/llm/resolve-credential-owner.use-case.ts`,
  `apps/api/src/application/use-cases/llm/stream-llm-turn.use-case.ts`,
  `apps/api/src/application/use-cases/llm/run-llm-turn.use-case.ts`
- **Teste:** `test/application/use-cases/llm/resolve-credential-owner.use-case.spec.ts`
  (o owner vence quem criou o projeto; a chave encontrada é a dele; projeto
  inexistente é 404 e não erro de banco)
- **Origem:** execução real da FASE 13b

### RN-056 — Faceta de capability vem do provider; silêncio preserva o que estava {#rn-056}

`supports_vision`, `supports_reasoning` e `generates_image` são **fato do
provider**, não opinião: saem do catálogo remoto no sync, com o mesmo fallback
de `supports_tool_calling` — remoto, depois local, depois `false`.

No OpenRouter (o único que publica isso hoje) as três saem de:
`architecture.input_modalities` contém `image`,
`supported_parameters` contém `reasoning`, e
`architecture.output_modalities` contém `image`. Aceitar imagem e **produzir**
imagem são eixos distintos: fundi-los mandaria o usuário para o modelo errado.

Antes, o sync lia `supportsVision` do que já estava GRAVADO e nunca consultava
o remoto — a coluna nascia `false` e não havia caminho para virar verdadeira.
Os 338 modelos do primeiro sync real ficaram todos `false`, incluindo 181 que o
provider declara como multimodais.

**Ausência de declaração não é declaração de ausência**
([ADR 0041](adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)): o
parser OMITE o campo quando o provider se cala, e `undefined` preserva o valor
local. Por isso a tela usa as facetas só como filtro POSITIVO e nunca escreve
"não lê imagem" — `false` aqui quer dizer "o provider não declarou".

- **Onde:** `apps/api/src/infrastructure/llm/openrouter-provider.ts`
  (`temModalidade`, `parseCatalogoOpenRouter`),
  `apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts`,
  `apps/api/src/db/schema.ts` (`models`)
- **Teste:**
  `test/infrastructure/llm/openrouter-provider.contract.spec.ts`
  (`modalidade não declarada OMITE o campo em vez de afirmar false`);
  `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`
  (`catálogo que se cala sobre modalidade preserva a faceta gravada`)
- **Origem:** [ADR 0051](adr/0051-facetas-de-capability-e-curadoria-por-uso.md)

### RN-057 — "Para que serve" é curadoria do workspace, e marcar uso não liga o modelo {#rn-057}

Nenhum catálogo de provider publica "bom para código". Isso é **opinião de quem
opera**, descoberta usando — então mora em `workspace_models.uses`, ao lado da
outra decisão do workspace ([RN-052](#rn-052)), e não em `models`.

Vocabulário FECHADO — `codigo`, `documentacao`, `analise`, `imagem`,
`conversa` —, com prova de exaustividade em tempo de compilação nos dois lados.
Texto livre daria `code`, `coding` e `código` no mesmo filtro em uma semana.

Duas regras que mantêm os eixos separados:

1. **Marcar uso não liga o modelo.** `workspace_models.is_active` tem DEFAULT
   `true`, então a linha criada por uma marcação de uso é inserida com
   `is_active = false` explícito. Sem isso, opinar sobre um modelo o autorizaria
   a gastar, contra a [RN-043](#rn-043).
2. **Trocar o uso não desliga o que estava ligado.** `is_active` fica fora do
   `SET` do `ON CONFLICT`.

A lista de usos **substitui** a anterior, não soma: lista vazia é como se
desmarca tudo, e é um estado legítimo — "ninguém opinou" não é "não serve".

- **Onde:** `apps/api/src/domain/llm/model-uses.ts`,
  `apps/api/src/db/schema.ts` (`workspace_models.uses`),
  `apps/api/src/infrastructure/persistence/drizzle/workspace-model.repository.ts`
  (`setUses`),
  `apps/api/src/application/use-cases/llm/set-model-uses.use-case.ts`
- **Teste:** `test/application/use-cases/llm/set-model-uses.use-case.spec.ts`
  (`marcar uso NÃO liga o modelo — a linha nova nasce inativa`,
  `trocar o uso não desliga o que já estava ligado`,
  `o uso vale só neste workspace`)
- **Origem:** [ADR 0051](adr/0051-facetas-de-capability-e-curadoria-por-uso.md)

### RN-038 — Agente contado no resumo do workspace = gastou tokens este mês {#rn-038}

O resumo do dashboard de projetos ("N projetos ativos · M agentes · gasto
este mês") conta como "agente" quem tem pelo menos uma linha em
`token_usage` com `actor_kind = 'agent'` no mês corrente, somando todos os
projetos do workspace. Sem o filtro de `actor_kind`, um `user` mandando
chat ou um `system` registrando uso inflaria a contagem — `token_usage`
grava para qualquer tipo de ator, não só agente. O corte por mês usa
`created_at >= date_trunc('month', now())`; um agente que trabalhou só no
mês anterior não conta, mesmo que ainda apareça no roster de alguma
sessão. A contagem naturalmente inclui as subespecialidades de área da
Fase 8 (`qa-automacao`, `qa-performance-seguranca`, `infra-workflows`):
cada uma tem seu próprio `actor_id` quando gasta tokens.

- **Onde:** `apps/api/src/infrastructure/persistence/drizzle/token-usage.repository.ts`
  (`summarizeForWorkspaceThisMonth`)
- **Teste:** `test/application/use-cases/iam/get-workspace-summary.use-case.spec.ts`

---

## Painel de projetos

### RN-039 — Dot de status do projeto: risco sempre vence inatividade {#rn-039}

A sidebar do dashboard mostra um dot de saúde por projeto, derivado de três
sinais independentes: orçamento (mesmos limiares 70%/90% do RN-018), task
bloqueada (`tasks.blocked`) e atividade recente (7 dias). Cores: verde =
saudável e ativo; âmbar = orçamento ≥70%; vermelho = orçamento ≥90% **ou**
task bloqueada; cinza = sem atividade nos últimos 7 dias. Quando um sinal
de risco (âmbar/vermelho) e o de inatividade (cinza) se aplicam ao mesmo
tempo, o de risco vence — um projeto estourado e parado ainda é algo a
olhar, não algo a esconder atrás de "sem atividade".

- **Onde:** `apps/web/src/lib/project-status.ts` (`deriveProjectStatus`)
- **Teste:** `apps/web/src/lib/project-status.test.ts`
- **Origem:** fidelidade do dashboard de projetos ao design aprovado

### RN-088 — Falha de carregamento é dita na tela; 429 não se retenta {#rn-088}

Toda tela que carrega dado da api distingue três estados, e nunca dois:
**carregando** (esqueleto), **erro** (a mensagem que a api mandou, com o
`trace_id` e um botão de tentar de novo) e **vazio** (o texto de lista vazia).
`if (!dado) return null` colapsa os três, e o desfecho observado foi o pior
possível: com a api limitando por `429`, a área principal de `/projects/:id`
ficava **completamente em branco** — sem mensagem, sem erro, sem esqueleto — e
o motivo existia só no console. No dashboard era pior que branco: `!projects`
também era verdadeiro no erro, então a tela convidava a criar o **primeiro**
projeto de um workspace que podia ter vinte.

É a [RN-059](#rn-059) do outro lado do fio: falha nunca vira resposta vazia.
Quem falha, diz.

A frase é a **da api**, extraída por `mensagemDaApi` — a mesma função que o
caminho de mutação já usava nos toasts. Um texto genérico nosso não sabe a
diferença entre "limite de requisições excedido, tente em instantes" (espere) e
"acesso negado" (não adianta esperar).

O outro lado da mesma regra é não responder ao limite com mais tráfego. **4xx
não se retenta**: `429` é literalmente o servidor mandando parar, e `401` já
foi renovado uma vez dentro de `request()`. E **poll para quando a query erra**
— volta no foco da janela, na remontagem ou no botão. Antes eram três
retentativas por falha somadas a ~25 polls de 3 a 5 segundos que não sabiam
parar: uma sessão real acumulou **1128 erros 429** contra um limite de 300
requisições por minuto por usuário (`RateLimitGuard`), e o laço impedia a
janela deslizante de se refazer. 5xx e falha de rede continuam com as três
tentativas, onde repetir é a reação certa.

- **Onde:** `apps/web/src/lib/query-policy.ts` (`deveRetentar`,
  `pollQueParaNoErro`), `apps/web/src/components/ErroDeCarregamento.tsx`,
  `apps/web/src/routes/ProjectPage.tsx`, `apps/web/src/routes/Dashboard.tsx`,
  `apps/web/src/routes/Shell.tsx`, `apps/web/src/main.tsx`
- **Teste:** `apps/web/src/lib/query-policy.test.ts`;
  `apps/web/src/routes/ProjectPage.test.tsx` (429 vira mensagem com a frase da
  api; 403 mostra o motivo do 403; carregando não é erro);
  `apps/web/src/routes/Dashboard.test.tsx` (erro na lista não vira "nenhum
  projeto ainda"); `apps/web/src/routes/Shell.test.tsx` (a sidebar diz em vez
  de ficar vazia)
- **Origem:** navegação real em `/projects/:id` com 1128 erros 429 no console

### RN-089 — Projeto de nome repetido se desempata na barra lateral {#rn-089}

Nome de projeto **não é único** — nada no domínio impede. Quando dois ou mais
projetos da lista têm o mesmo nome, cada um deles mostra na sidebar o id
abreviado e a data de criação (`#a1b2c3d4 · 07/08 14:32`), os dois já presentes
no payload do projeto. Quem tem nome único não mostra nada: a legenda em toda
linha seria ruído no lugar com menos espaço da tela.

Origem concreta: uma execução de validação criou vinte projetos chamados
`validacao-real`, e as vinte linhas da sidebar eram visualmente idênticas.

- **Onde:** `apps/web/src/lib/project-label.ts` (`nomesRepetidos`,
  `desempateDoProjeto`), `apps/web/src/routes/Shell.tsx`
- **Teste:** `apps/web/src/routes/Shell.test.tsx` (nome repetido ganha
  desempate, nome único não)
- **Origem:** navegação real com a sidebar cheia de projetos de validação

### RN-090 — O dashboard lê o workspace, não um projeto de cada vez {#rn-090}

A grade de cards e os dots da barra lateral se alimentam de **uma** requisição
por ciclo — `GET /workspaces/:workspaceId/projects-summary` —, e o número de
requisições **não cresce com a quantidade de projetos**.

O card mostra provedor de git, status de provisionamento, orçamento, chips de
agentes e última atividade; a sidebar mostra o dot de status e o contador de
não lidos. Tudo isso vinha de sete consultas em POLL por projeto, o que fazia
23 projetos custarem 3.824 requisições por minuto contra um limite de 300
(`RateLimitGuard`) — a tela derrubava a si mesma em 429 antes de terminar de
carregar. A [RN-088](#rn-088) fez a app parar de insistir quando isso acontece;
esta reduz o pedido.

Duas fronteiras que a regra fixa, e que não são detalhe de implementação:

- **A api responde fatos, não roster.** `roster` traz o que aconteceu no event
  log (execução ativada, módulos, gate já aberto, subagentes delegados, infra
  aceita). Quem é lead de área, que ícone cada agente tem e como os membros
  viram um chip continua sendo do web — e a regra de PRESENÇA é uma só
  (`rosterFromFacts`), compartilhada com o painel do time, para que um agente
  novo não apareça num lugar e falte no outro.
- **A gaveta do sino só busca quando aberta.** Ela era, até a
  [RN-091](#rn-091), a única leitura que continuava sendo uma requisição por
  projeto — o corte de "onde parei de ler" é `seq` guardado no navegador
  (`read-state`), que o servidor não conhece. Hoje o navegador **manda** esse
  corte, e a gaveta também é uma requisição só.

Efeito colateral aceito e desejado: `gatesEverOpened` e `delegatedSubagents`
passam a cobrir a sessão INTEIRA. O cliente derivava dos últimos 200 eventos e
perdia chips em sessão longa (ver
[ADR 0021](adr/0021-fechamento-4a-infra-e-painel.md)) — o texto de
`deriveAgentRoster` sempre disse "já abriu alguma vez".

- **Onde:**
  `apps/api/src/application/ports/projects-summary-repository.port.ts`,
  `apps/api/src/infrastructure/persistence/drizzle/projects-summary.repository.ts`,
  `apps/api/src/interfaces/http/iam/workspaces.controller.ts`
  (`getProjectsSummary`), `apps/web/src/lib/hooks.ts` (`useProjectsSummary`),
  `apps/web/src/lib/agent-status.ts` (`rosterFromFacts`),
  `apps/web/src/routes/Dashboard.tsx`, `apps/web/src/routes/Shell.tsx`
- **Teste:** `apps/web/src/routes/Dashboard.fanout.test.tsx` (30 projetos
  custam o mesmo que 3; nenhum endpoint por projeto é chamado);
  `apps/api/test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  (o número de consultas ao banco não cresce com N);
  `apps/web/src/lib/agent-status.test.ts` (os fatos da api produzem os mesmos
  chips que o event log)
- **Origem:** dashboard de 23 projetos medido no navegador — 3.824 req/min
  antes, 12 depois

### RN-091 — O navegador manda onde parou de ler; o sino é uma requisição {#rn-091}

Com a gaveta de notificações **aberta**, o conteúdo dela sai de **uma**
requisição por ciclo — `POST /workspaces/:workspaceId/unread-events` — e o
número de requisições **não cresce com a quantidade de projetos**.

É a metade que faltava da [RN-090](#rn-090). Aquela derrubou o dashboard de
3.824 para 12 req/min, mas o sino continuou buscando um projeto de cada vez:
23 projetos com a gaveta aberta mediam **286 req/min** contra o limite de 300
(`RateLimitGuard`). Passava, e sumia com um projeto a mais.

**O obstáculo, e por que a saída é esta.** Não existe "marcar como lido" no
servidor, de propósito: o corte é um `seq` por projeto guardado no
`localStorage` de cada navegador (`read-state`). Havia duas saídas, e a
diferença entre elas é de PRODUTO:

- parar de repolar enquanto a gaveta está aberta muda a atualidade do que o
  usuário vê — **recusada**, ninguém pediu essa troca;
- o navegador **mandar** o mapa `projeto → afterSeq` devolve exatamente os
  mesmos dados na mesma cadência. **É batelamento puro: nada muda para quem
  olha a tela**, nem a frescura nem o conteúdo.

**É `POST` sem mutar nada**, e a api responde `200` (nunca `201`) para dizer
isso. O verbo foi escolhido por ser o único com CORPO: são dezenas de pares, e
em query string isso vira URL longa — que proxy trunca — além de pôr id de
projeto do usuário em log de acesso, contra a regra de não passar dado pessoal
por query string.

Três garantias de semântica que a rota fixa, porque batelar leituras com cortes
diferentes é onde o erro fácil mora:

- **mapa vazio devolve vazio**, e sem tocar no banco. "Não perguntei nada" não
  é "me dê tudo";
- **cada projeto respeita o SEU corte** — `seq` estritamente maior que o dele;
- **o teto de 50 eventos é por projeto**, o mesmo que `GET .../events` aplica
  sem `limit`. Um limite na resposta inteira deixaria o projeto barulhento
  comer a cota dos calados.

Cursor apontando para projeto de outro workspace é **ignorado**, não recusado:
ele vem do armazenamento local de quem chama e pode ser sobra de um workspace
antigo.

- **Onde:**
  `apps/api/src/application/ports/projects-summary-repository.port.ts`
  (`unreadEventsForWorkspace`),
  `apps/api/src/infrastructure/persistence/drizzle/projects-summary.repository.ts`,
  `apps/api/src/interfaces/http/iam/workspaces.controller.ts`
  (`getUnreadEvents`), `apps/api/src/interfaces/http/iam/dto/unread-events.dto.ts`,
  `apps/web/src/lib/notifications.ts` (`useNotificationGroups`),
  `apps/web/src/lib/api-client.ts` (`getUnreadEvents`)
- **Teste:** `apps/web/src/routes/Dashboard.fanout.test.tsx` (com a gaveta
  ABERTA: uma requisição, e 30 projetos custam o mesmo que 3);
  `apps/api/test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  (o número de consultas ao banco não cresce com N; mapa vazio, corte por
  projeto, teto por projeto e isolamento de workspace)
- **Origem:** residual medido da [RN-090](#rn-090) — 286 req/min com a gaveta
  aberta num workspace de 23 projetos

### RN-099 — Atividades pagina o passado sem repolar o que não muda {#rn-099}

A coluna de **Atividade** da Visão geral mostra uma **janela** de 100 eventos
ancorada na **cauda** da sessão, e desce no passado de página em página. Cada
página usa o `afterSeq`/`nextCursor` que
`GET /projects/:p/sessions/:s/events` **já** devolve: nenhuma rota nova,
nenhum parâmetro novo.

**Duas perguntas, duas queries.** `useSessionEvents` responde "como está
agora" — os últimos 200 em poll — e alimenta o painel do time, a linha do
tempo em árvore, a seção de execução e a aba de Aprovações. Nenhuma delas
pagina. A de Atividades responde "o que aconteceu", e era a única que fazia
essa pergunta com a resposta da outra: 200 itens de uma vez, sem começo nem
fim, e ainda assim sem alcançar o início de uma sessão longa.

**A âncora é a cauda, não o começo da sessão.** O endpoint pagina para
FRENTE, e não existe `beforeSeq` — inventar um seria contrato novo. Mas abrir
o feed no evento nº 1 de uma sessão de milhares entrega a tela errada: quem
abre Atividades quer o que acabou de acontecer. Então a primeira página é a
mesma leitura `latest` que a tela já faz, com a **mesma `queryKey`** (o React
Query serve as duas com UMA busca), e cada clique desce uma janela fixa com
`afterSeq`.

**O que a paginação não pode custar.** Uma requisição por ciclo de poll — a
mesma de antes, e a economia da [RN-090](#rn-090)/[RN-091](#rn-091) não
regride. Três peças garantem isso:

- a cauda é a query que a tela já tinha, compartilhada por `queryKey`;
- o primeiro clique **não** vira requisição: a leitura `latest` traz 200 e a
  janela mostra 100, então revelar o que já se pagou vem antes de pedir de
  novo;
- página antiga é uma janela **fechada** de `seq` sobre eventos **imutáveis**
  (nunca há UPDATE em tabela de evento): `staleTime: Infinity` e
  **nenhum** `refetchInterval`. Um poll ali seria pagar N requisições para
  receber N respostas idênticas.

**A contagem é honesta sobre o que ela sabe.** Os filtros por agente e por
tipo rodam sobre a **página carregada**, não sobre a sessão — então a UI diz
`N de M carregados`, e não "N resultados". Levar o filtro ao servidor daria o
total verdadeiro e mexeria no repositório de eventos; não é desta fase, e
dizer o total errado seria pior que dizer menos.

Os três estados da [RN-088](#rn-088) valem aqui: **erro antes de vazio** — a
coluna dizia "nenhuma atividade" quando a api tinha recusado.

- **Onde:** `apps/web/src/lib/hooks.ts` (`useSessionEventHistory`,
  `EVENTOS_POR_PAGINA`), `apps/web/src/components/ActivityFeed.tsx`,
  `apps/web/src/routes/ProjectOverviewTab.tsx`,
  `apps/api/src/infrastructure/persistence/drizzle/session-event.repository.ts`
  (`listPaginated`, já existente)
- **Teste:** `apps/web/src/lib/session-history.test.tsx` (abre na cauda; o
  primeiro clique não custa requisição; o seguinte pagina com `afterSeq`
  contíguo; o laço termina no começo da sessão; montado junto com o estado
  atual a cauda é UMA busca; página antiga não repolla);
  `apps/web/src/components/ActivityFeed.test.tsx` (o "N de M carregados"
  acompanha o filtro; sem as props de paginação nada muda)
- **Origem:** pedido do usuário na primeira navegação real — "Atividades na
  aba Visão Geral deve ser paginada, para não ficar infinita"

### RN-100 — A ordem do sino é do SQL, não do front {#rn-100}

A gaveta de notificações mostra os eventos **do mais recente para o mais
antigo**, e quando um projeto tem mais não lidos que o teto de 50 os que
aparecem são os **mais NOVOS**.

**A ordenação é do banco por necessidade, não por gosto.** A consulta corta em
50 **por projeto** com uma função de janela
(`row_number() OVER (PARTITION BY session_id ORDER BY seq DESC)`), e é ela que
decide **quais** 50 eventos sobrevivem — não só em que ordem eles saem. Com
`ASC` sobreviviam os 50 mais **antigos**, e um `.sort()` no cliente ordenaria
por recência justamente a janela que a consulta já tinha escolhido errado:
num projeto com 300 não lidos, o 251º evento apareceria como "o mais recente".
É por isso que não há ordenação nenhuma no caminho do front, e o comentário no
componente diz que não pode haver.

**A consequência, e por que o corte de leitura não mudou.** O corte é um `seq`
por projeto no `localStorage`, e **não existe endpoint de marcar lido**, por
decisão registrada na [RN-091](#rn-091). Um corte por `seq` marca um
**prefixo**; a gaveta agora mostra um **sufixo**. Marcar como lidas "as 50
exibidas" é inexprimível sem um conjunto de lidos **por evento** — tabela nova,
fora de escopo. Os dois únicos cortes expressáveis continuam sendo "nada" e
"tudo até agora".

A saída não foi mudar a semântica (ela continua avançando para o último `seq`,
exatamente como antes), foi **parar de esconder o que esse avanço engole**:

- cada projeto mostra o **total** de não lidos, não o tamanho da janela, e
  declara quantos ficaram de fora (`+ N mais antigos`);
- o botão passa a dizer o que faz — `marcar as N como lidas` — quando há algo
  fora da janela;
- o número que falta sai de **subtração**, não de requisição: `latestSeq`
  menos o corte já vem no resumo do workspace ([RN-090](#rn-090)).

Como a semântica do corte não mudou, **não há ADR** nesta regra: o que mudou
foi qual janela a consulta escolhe e o que a gaveta declara sobre ela.

- **Onde:**
  `apps/api/src/infrastructure/persistence/drizzle/projects-summary.repository.ts`
  (`unreadEventsForWorkspace`),
  `apps/api/src/application/ports/projects-summary-repository.port.ts`,
  `apps/api/src/interfaces/http/iam/dto/iam.response.dto.ts`
  (`ProjectUnreadEventsResponseDto`),
  `apps/web/src/lib/notifications.ts` (`useNotificationGroups`),
  `apps/web/src/components/NotificationBell.tsx`
- **Teste:**
  `apps/api/test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  ("com mais não lidos que o teto, voltam os MAIS RECENTES, do novo para o
  velho" — afirma o CONJUNTO antes da ordem);
  `apps/web/src/components/NotificationBell.test.tsx` (renderiza na ordem
  recebida, sem reordenar; o contador é o total; o botão diz quantas marca);
  `apps/web/src/lib/notifications.test.tsx` (o que ficou fora da janela sai
  por subtração, sem segunda requisição);
  `apps/web/src/routes/Dashboard.fanout.test.tsx` (a gaveta continua sendo
  UMA requisição)
- **Origem:** pedido do usuário na primeira navegação real — "Sino e
  notificações devem sempre ordenar para última data modificada em descendente
  para a mais antiga"

---

### RN-118 — A árvore do time expõe detalhe de execução por marco, e abre os "5 últimos" {#rn-118}

`AgentTimelineTree`/`timeline-tree.ts` (FASE 14b) já agrupava o event log por
agente, mas com três lacunas: o critério de abrir um ramo era só
ativo/parado (sem relação com quantos agentes existiam), o contador do
cabeçalho era o TOTAL de marcos (nunca "o que é novo"), e `tool.call`/
`tool.result`/`agent.response` viravam marco mostrando só o nome da
ferramenta — `args`, `result` e `iteration`, que o event log já grava,
nunca chegavam na tela.

**Abertura padrão** passa a ser "os 5 agentes de atividade mais recente
(maior `seq` do último marco)", com ativo mantendo prioridade sobre
recência — não se soma: como `montarArvore` já ordena ativos primeiro e,
dentro de cada grupo, do mais recente pro mais antigo, os dois critérios
colapsam numa fatia só (`ramosAbertosPorPadrao`, os primeiros
`max(nº de ativos, 5)` ramos). Mais de 5 ativos: todos abrem, sem corte.

**Contador de novidade** por agente usa o MESMO mecanismo do sino
(`read-state.ts`, `localStorage`), granular por `projectId:agentId` em vez
de só `projectId` — não existia "último visto" nessa granularidade antes.
Ramo colapsado com marco de `seq` maior que o último visto daquele agente
mostra a contagem de NOVIDADE no lugar do total; abrir o ramo (automático
ou manual) marca como visto até o `seq` mais recente.

**Detalhe expansível** é por MARCO, não por ramo — só `tool.call`,
`tool.result` e `agent.response` (`EVENTOS_EXPANSIVEIS`) viram botão
individual, porque só eles carregam payload que vale expandir. O
agrupamento visual por ITERAÇÃO usa `iteration` do payload de
`agent.response` quando existe (ToolLoop — `tool.call`/`tool.result`
herdam a iteração da resposta que os despachou, porque no ToolLoop eles
são emitidos DEPOIS dela); agentes fora do ToolLoop (PO, Criativo, sem
`iteration` no payload) ganham um contador PRÓPRIO por agente, incrementado
a cada resposta — inferência por proximidade de `seq`, não um campo novo no
event log.

- **Onde:** `apps/web/src/lib/timeline-tree.ts` (`Marco.iteracao`,
  `Marco.eventType`, `Marco.payload`, `ramosAbertosPorPadrao`,
  `marcoExpansivel`), `apps/web/src/components/AgentTimelineTree.tsx`,
  `apps/web/src/lib/read-state.ts` (`getAgentLastSeenSeq`/
  `setAgentLastSeenSeq`)
- **Teste:** `apps/web/src/lib/timeline-tree.test.ts` (agrupamento por
  iteração real e inferida, `ramosAbertosPorPadrao` com ativo/recência/sem
  corte), `apps/web/src/components/AgentTimelineTree.test.tsx` (abertura
  padrão, contador de novidade aparecendo/sumindo, marco expandindo com
  args/resultado/iteração)
- **Origem:** pedido do usuário — lacunas confirmadas por investigação no
  componente existente da FASE 14b; sem ADR, mesma semântica de "não visto"
  do sino, só granularidade nova

---

### RN-096 — Toda decisão diz em português o que acontece; o payload cru nasce colapsado {#rn-096}

Todo tipo de `proposed_action` tem uma **frase em português** que descreve o
efeito de aprovar, e ela é a primeira coisa visível no card — antes de qualquer
detalhe, nas três telas onde uma decisão é pedida (a fila de Aprovações, o card
dentro do chat da sessão e a aba Insights). O payload cru continua acessível,
**dentro de um colapso que nasce fechado**, e nunca é despejado na tela.

**O que existia era um despejo.** Todo tipo sem corpo visual próprio caía num
`Object.entries(payload).map(([k, v]) => k + ': ' + JSON.stringify(v))`, sempre
aberto. Quem abria a fila lia `worktree: /workspaces/dev-api`,
`coAuthor: Brabo User <user@brabo.dev>` e `proposto: 4` — e tinha de deduzir o
que ia acontecer se clicasse em Aprovar. Aprovação que exige dedução é
aprovação que se dá no automático, e o produto inteiro se apoia em o usuário
ser a autoridade final.

**A frase degrada, e é isso que a torna confiável.** Nenhuma delas assume que
uma chave do payload existe: com payload vazio a frase continua sendo uma frase
verdadeira, só menos específica ("Registra um commit no repositório do
projeto."). O payload vem do engine e de dez casos de uso diferentes, e nenhum
deles promete um formato — frase que só funciona com a fixture certa é frase
que quebra na primeira aprovação real.

**Tipo que o web ainda não conhece não é caso teórico.** A união `ActionType`
do web já ficou defasada duas vezes: primeiro com os três tipos do bootstrap de
Gitflow, e de novo com `parallelize`/`raise_max_parallel`, que entraram na FASE
14d. O compilador não pega: a lista canônica está em `apps/api`, que o web não
importa. Por isso duas coisas ao mesmo tempo — o card **degrada** (verbo neutro
+ "ver detalhes", com o payload colapsado, em vez do `undefined` no mapa de
ícones que derrubava a árvore inteira do React), e o **teste lê o `decide.ts`
do backend** e reprova quando um tipo entra sem frase.

**O default de aberto/fechado é derivado, não configurado.** A regra é uma só —
abre o que ainda espera decisão de quem está olhando: no chat, ação `pending`;
na fila, nunca (são N cards, e N detalhes abertos são a mesma parede de texto);
em Insights, hipótese `proposed`. E o payload CRU não abre em variante nenhuma.
A consequência de projeto é que `ApprovalCard` **não ganhou prop nova
obrigatória**: o default sai de `variant` e `status`, que já existiam.

**Verbo e frase saem de um módulo só**, consumido pelas três telas. A hipótese
do Psicólogo usa literalmente o verbo do `instruction_patch` em vez de um
vocabulário paralelo — e a frase dela diz o que o accept faz de verdade
(enfileira para a Anamnese, que **pode** propor o ajuste, que ainda vem para
aprovação), nunca "a instrução será alterada".

**`write_file` tinha frase, mas não corpo.** Ele nasceu de fora de
`COM_CORPO_PROPRIO`: a frase mostrava só o `path`, e o detalhe caía no mesmo
despejo de JSON cru colapsado que esta RN existe para evitar — então um write
que genuinamente pedia aprovação (fora do prefixo `dev-`, ou caminho fora do
escopo do agente) exigia um clique a mais para ver o `content`. Entrou em
`COM_CORPO_PROPRIO` com corpo próprio: `path` e um preview do `content` (até
25 linhas/4.000 caracteres, com aviso de truncamento — nunca o arquivo
inteiro, mesma regra do payload cru), aberto por padrão no chat enquanto
pendente, igual `terminal`.

**Payload vazio não é payload ausente.** `command` (terminal) ou
`path`/`content` (write_file) chegando como string vazia — tool-call
malformada do modelo, não bug de renderização — degradava para um prompt
`$ ` ou um preview em branco, que o usuário lia como defeito da tela. Os dois
corpos agora distinguem os dois casos e mostram "o modelo não produziu um
X válido para esta ação" em vez de um branco.

- **Onde:** `apps/web/src/lib/aprovacoes.ts` (`VERBO_DA_ACAO`, `fraseDaAcao`,
  `descreverAcao`, `descreverHipotese`), consumido por
  `apps/web/src/components/ApprovalCard.tsx` (Aprovações + chat da sessão,
  `COM_CORPO_PROPRIO`, `previewConteudo` para o `content` de `write_file`) e
  `apps/web/src/components/HypothesisCard.tsx` (Insights); colapso pelo
  `Disclosure` de `apps/web/src/components/ui/Disclosure.tsx`
- **Teste:** `apps/web/src/lib/aprovacoes.test.ts` (lê `ACTION_TYPES` de
  `apps/api/src/domain/actions/decide.ts` e exige verbo + frase para cada tipo,
  com payload vazio); `apps/web/src/components/ApprovalCard.test.tsx`
  (`frase e colapso` — payload colapsado nas duas variantes, JSON legível ao
  abrir, tipo desconhecido não derruba a tela, `write_file` com corpo próprio
  aberto por padrão e truncamento do preview, `command`/`path`/`content`
  vazios mostrando a mensagem de fallback);
  `apps/web/src/components/HypothesisCard.test.tsx` (`frase e colapso`)
- **Origem:** FASE 19 do programa 16–26, do pedido "hoje está muito difícil a
  leitura" na primeira navegação real depois do reset do banco

---

### RN-121 — Dev agent e QA são "executores": aba própria, fora do "Time de agentes" {#rn-121}

O grid "Time de agentes" e a "Linha do tempo do time" da Visão geral
misturavam Criativo/PO/Arquiteto/Infra com dev-`<módulo>` e QA (lead +
`qa-automacao`/`qa-performance-seguranca`) — sete, oito agentes na mesma
grade, sem distinguir quem CRIA/DECIDE de quem IMPLEMENTA/VERIFICA. A aba
**Executores** isola os dois últimos, com a MESMA renderização da Visão
geral (`AgentCard`, o grid de área — extraído para `AgentTeamGrid.tsx` — e
`AgentTimelineTree`), nunca um card reinventado.

**A regra de separação é uma função só**, `isExecutorGroup`/
`isExecutorAgentId` (`lib/agent-status.ts`): `dev-lead`/`dev-<qualquer
módulo>` e a área `qa` inteira (lead + subespecialidades) são executor;
o resto não é. As DUAS telas filtram o MESMO `groupRosterByArea` com essa
função — a Visão geral com `!isExecutorGroup`, Executores com
`isExecutorGroup` — então um agente não pode aparecer nos dois nem sumir
dos dois: é sempre exatamente um lado.

**A árvore não duplica**: cada aba filtra os EVENTOS antes de passar para
`AgentTimelineTree` (por `actor.id` pertencer ou não ao conjunto de
executores), então o ramo de um dev agent aparece só em Executores, nunca
também na Visão geral. A coluna de Atividade (`ActivityFeed`, RN-099/100)
NÃO foi filtrada — ela responde "o que aconteceu" na sessão inteira,
dev/QA inclusive, e o filtro por agente do próprio componente já lista
todo mundo que falou; só o grid e a árvore de "quem está fazendo o quê"
mudam de lugar.

- **Onde:** `apps/web/src/lib/agent-status.ts` (`isExecutorGroup`,
  `isExecutorAgentId`, `autonomyActionTypeFor` — movido de
  `ProjectOverviewTab.tsx`), `apps/web/src/components/AgentTeamGrid.tsx`
  (extraído do grid que já existia), `apps/web/src/routes/
  ProjectExecutorsTab.tsx`, `apps/web/src/routes/ProjectOverviewTab.tsx`,
  `apps/web/src/routes/project-tabs.ts` (`key: 'executores'`, `ordem: 12`
  — logo depois da Visão geral, antes de Criativo/Chat/Code)
- **Teste:** `apps/web/src/lib/agent-status.test.ts` (`isExecutorAgentId`/
  `isExecutorGroup` — dev-`<módulo>`, `dev-lead`, área `qa` inteira são
  executor; criativo/po/arquiteto/infra/secops não são);
  `apps/web/src/routes/ProjectExecutorsTab.test.tsx` (mostra só dev/QA,
  estado vazio sem os dois, contagem do cabeçalho);
  `apps/web/src/routes/ProjectOverviewTab.test.tsx` (dev-backend/QA somem
  do grid, o resto do time continua); `apps/web/src/routes/
  project-tabs.test.tsx` (a aba nova entra na varredura genérica do
  registro — régua, painel, deep-link, ordem única)
- **Borda:** SecOps NÃO é executor — ele entra na roster pelo MESMO
  `pr.gate_changed` que traz QA (Fase 4a, `rosterFactsFromEvents`), mas
  fica na Visão geral. `dev-lead` está na lista de executores por
  completude (RN-087 o descreve como conversacional), embora hoje nenhum
  caminho o instancie na roster da sessão (a delegação Dev Lead →
  `dev-<módulo>` segue fora de escopo, ADR 0053 item 5).
- **Origem:** pedido do usuário — "Executores" própria pra dev agent e QA,
  fora do grid misturado da Visão geral.

---

### RN-125 — O aceite de handoff é INLINE no fio, com CTA pro Dev Lead apontando pra Executores {#rn-125}

O divisor "X passou o bastão ao Y" que já existia na timeline (`handoff.offered`)
vira um **card acionável** — com o botão de aceitar embutido — sempre que
representa a oferta pendente **atual** (a mesma que `offeredHandoff` já
resolvia para o botão da topbar). O botão da topbar **saiu**: com o aceite
morando dentro do fio, no lugar exato onde a passagem aconteceu, manter os
dois puxaria dois botões com o texto IDÊNTICO visíveis ao mesmo tempo — o
mesmo problema que `ApprovalCard` já evita ao nunca duplicar a ação fora do
fio (RN-096).

**Qual evento vira o card é decidido por PAR, não por id.** O payload de
`handoff.offered` carrega só `toAgent`; o `fromAgent` é o `actor` do evento
(RN-054 já usava essa leitura para o texto do divisor). Sem o id do handoff
no evento, "esta é a oferta atual" é respondido achando o `handoff.offered`
mais RECENTE (maior `seq`) com o MESMO par `fromAgent`/`toAgent` de
`offeredHandoff` — o que impede reabrir um convite de aceite que uma oferta
mais antiga pro mesmo par já tenha resolvido (aceita, recusada ou superada
por uma oferta nova).

**O card pro Dev Lead ganha um segundo link**, "Acompanhe a execução em
Executores", pra aba que já existe (RN-121) — é o início da EXECUÇÃO, e quem
aceita precisa saber onde olhar depois. As outras ofertas (PO, Arquiteto…)
não ganham o link: a sessão delas segue sendo o próprio lugar de acompanhar,
não há "onde mais olhar".

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`timeline` — bloco
  `handoff.offered`, `offeredHandoffEventSeq`; `isActive` subiu para antes do
  `useMemo`), `apps/web/src/routes/SessionPage.module.css` (`.handoffCard`,
  `.timelineLink`)
- **Teste:** `apps/web/src/routes/SessionPage.handoff-inline-e-links.test.tsx`
  (card acionável só na oferta atual, oferta antiga do mesmo par fica muda,
  handoff já aceito não mostra botão nenhum, link de Executores só no
  `dev-lead`); `apps/web/src/routes/SessionPage.pista-e-status.test.tsx`
  atualizado para o botão inline (não mais na topbar)
- **Verificado por execução real:** aceitar um handoff pro PO numa sessão
  criativa contra um build isolado (stack Docker próprio, projeto/sessão
  reais) — o card vira divisor mudo e o log de eventos avança assim que o
  clique volta da api; o CTA pro Dev Lead navega pra `?tab=executores` de
  verdade.
- **Origem:** pedido do usuário — aceite de handoff também inline no fio,
  não só na topbar.

### RN-124 — O PO narra épico/história criados no fio, com link direto pro Backlog {#rn-124}

`backlog.epic_created`/`backlog.story_created` — que o PO já gravava no
event log (`CreateEpicUseCase`/`CreateStoryUseCase`) — não tinham
tratamento nenhum na timeline da sessão: criar história não deixava rastro
NENHUM no fio, só na aba Backlog, pra quem já soubesse ir olhar lá. Os dois
tipos ganham entrada na timeline, no MESMO corpo visual das outras
mensagens do agente (`.message`/`.bubble`) — nenhuma classe nova pro chip
em si, só o link.

O link ("Ver no Backlog") reusa o deep-link genérico da aba (`?tab=backlog`,
o mesmo mecanismo do CTA "Definir orçamento" do card do dashboard) — não
tenta realçar a história recém-criada dentro da aba, que é fora de escopo.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`timeline` — bloco
  `backlog.epic_created`/`backlog.story_created`)
- **Teste:** `apps/web/src/routes/SessionPage.handoff-inline-e-links.test.tsx`
  (`item 2`)
- **Verificado por execução real:** épico e história inseridos no event log
  de uma sessão real aparecem como "Épico criado"/"História criada" com o
  título, e o link navega pra `?tab=backlog` de verdade.
- **Origem:** pedido do usuário — link do PO pras histórias criadas, direto
  pro Backlog.

### RN-126 — Promoção de história é decidível INLINE no fio, com o mesmo mecanismo da aba Backlog {#rn-126}

`backlog.story_promotion_proposed` (RN-048) ganha o mesmo tratamento que
RN-125 deu ao handoff: o evento vira **card acionável** na timeline da
sessão, com os botões "Promover" e "Devolver" chamando os MESMOS
`promoteStories`/`returnStory` que `PromotionQueue`
(`ProjectBacklogTab.tsx`) já usa — nenhum endpoint novo, nenhuma segunda
fonte de verdade. A decisão continua acontecendo em UM lugar (o backend), só
o gatilho ganhou um segundo caminho.

**Resolução por evento posterior, não por status derivado à parte.** O card
some sozinho (vira divisor mudo, sem botões) assim que um evento de seq
MAIOR decidir o destino da MESMA história —
`backlog.story_transitioned{storyId}` (promovida, emitido por
`PromoteStoriesUseCase` via `TransitionStoryUseCase`) ou
`backlog.story_promotion_returned{storyId}` (devolvida). Sem essa checagem,
promover ou devolver deixaria os mesmos dois botões plantados no fio,
oferecendo de novo uma decisão já tomada.

`backlog.story_promotion_returned` ganha narração simétrica no fio (motivo
incluído), reusando a mesma frase que `apps/web/src/lib/activity.ts` já
usava só no log colapsado da sidebar.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`timeline` — blocos
  `backlog.story_promotion_proposed`/`backlog.story_promotion_returned`,
  `handlePromoteStory`/`handleReturnStory`, modal de motivo reusando
  `Modal`/`Textarea`)
- **Teste:** `apps/web/src/routes/SessionPage.promocao-inline-e-volta.test.tsx`
  (card com os botões, promover chama `promoteStories` com o `storyId` do
  payload, devolver exige motivo e chama `returnStory`, história resolvida
  por `story_transitioned` posterior vira divisor mudo, `story_promotion_returned`
  narra com o motivo)
- **Origem:** pedido do usuário — promoção de história inline no fio, opção
  barata reusando RN-048 em vez de gatear a criação da história.

### RN-131 — Três corridas confirmadas AO VIVO no fio da sessão: convite por cima do histórico, indicador ansioso e turno preso em `handleReadiness` {#rn-131}

Três defeitos achados navegando `SessionPage.tsx` de verdade no Chrome, não
por teste — e os três eram condição de corrida ou critério incompleto
disfarçado de decisão de produto.

**1. `conversaComecou` virou "existe QUALQUER evento", não "existe
`chat.message`/`agent.response`".** O critério anterior (achado G) nasceu
pra não confundir os cards do bootstrap do git com conversa, mas tinha o
efeito contrário: uma sessão criada pelo `git-bootstrap` (ações de
commit/branch já aprovadas, zero `chat.message`) mostrava o convite por
cima delas, e o mesmo acontecia — de forma bem mais grave — na sessão que a
ativação de execução usa, com dezenas de eventos reais (`tool.call`,
`tool.result`, eventos de task) e nenhum `chat.message`/`agent.response`: o
convite cobria o histórico de execução **inteiro**. Sessão nova é a única
sem nenhum evento — essa é a pergunta certa.

**2. `conviteVisivel` espera `useSessionEvents` terminar de carregar.** Em
cache frio (reload de página), `session` podia chegar enquanto `events`
ainda era `[]` — o default de `data?.items`, indistinguível de "sessão
vazia de verdade" até o primeiro fetch resolver. Sem o gate
`!eventsQuery.isPending`, o convite piscava por cima de sessões com
histórico grande.

**3. O indicador de "pensando" (bolha com os 3 pontinhos) só liga depois de
5s sem nenhum texto chegar.** Antes ele ligava no instante em que
`streaming`/`statusAgent` virava truthy — ruído visual na maioria dos
turnos, que respondem em menos de um segundo. Um `useEffect` arma um
`setTimeout(…, 5000)` quando o turno começa sem texto ainda, e o desarma (via
cleanup) assim que o primeiro delta chega ou o turno termina antes do prazo.
Texto de verdade (`streamingText`) continua aparecendo **na hora**, nunca
espera o timer — só o indicador vazio é que ganhou paciência.

**4. `handleReadiness` ganhou a mesma rede de segurança que `handleSend` já
tinha.** `confirmReadiness` é, como `sendAgentMessage`, um `GenServer.call`
síncrono no engine (até 120s) — e o canal Phoenix pode não ter terminado de
conectar (ticket + join, RN-108) quando o turno acaba, perdendo o broadcast
de `agent.done` pra sempre. `handleSend` já chamava
`finalizarTurnoDoAgente()` assim que a chamada síncrona resolvia,
independente do canal ter entregue o evento; `handleReadiness` tinha ficado
de fora dessa correção, e sem ela a bolha do agente ficava presa vazia
(`streaming: true`, sem texto) até a página recarregar.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`conversaComecou`,
  `conviteVisivel`, o `useEffect` de `pensandoVisivel` logo abaixo de
  `agenteExibido`, e o bloco de sucesso de `handleReadiness`)
- **Teste:**
  `apps/web/src/routes/SessionPage.convite-so-em-sessao-vazia.test.tsx`
  (sessão vazia mostra o convite; sessão com eventos de git-bootstrap ou com
  dezenas de `tool.call`/`tool.result` esconde; `eventsQuery.isPending`
  segura o convite até o primeiro fetch resolver),
  `apps/web/src/routes/SessionPage.pista-e-status.test.tsx` (achado B —
  indicador não aparece antes de 5s, aparece depois, some no primeiro delta
  e nunca aparece quando o turno termina antes do prazo), e
  `apps/web/src/routes/SessionPage.readiness-turno-preso.test.tsx`
  (`confirmReadiness` resolvendo sem `onAgentDone` reconcilia o estado do
  mesmo jeito que `SessionPage.turno-preso.test.tsx` já prova pra
  `handleSend`)
- **Origem:** investigação AO VIVO do produto no Chrome — os três reproduzidos
  manualmente antes da correção.

### RN-136 — O card acionável de handoff no chat só considera quem CONVERSA nesta tela {#rn-136}

`OfferInfraHandoffUseCase` oferece o handoff pro Infra e, na MESMA
confirmação, oferece pro Dev Lead logo em seguida (FASE 14d) — duas chamadas
separadas, a de Infra primeiro. `handoffs` (o que `SessionPage.tsx` lê de
`useHandoffs`) vem ordenado por `createdAt` ASC
(`DrizzleHandoffRepository#findBySession`), e o `offeredHandoff` que decide
qual card vira "acionável" resolvia com um `.find()` puro — sempre o
`offered` mais **antigo**. Como o Infra Lead não é conversacional (não está
em `AGENTES_DE_CHAT`, e nunca é aceito por esta tela), o card do Dev Lead só
ficaria acionável depois de alguém aceitar o de Infra num lugar que esta
tela não mostra — na prática, nunca: o usuário só via "aceitar handoff de
Infra" e o convite pro Dev Lead ficava invisível atrás dele.

O filtro restringe `offeredHandoff` a handoffs endereçados a um agente de
`AGENTES_DE_CHAT`. O handoff pro Infra continua **narrado** no fio — o
`handoff.offered` dele vira divisor mudo, como qualquer oferta que não é "a
atual" — só o card com botão é que passa a ignorá-lo: Infra nunca teve (nem
precisa ter) um jeito de ser aceito por aqui.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`offeredHandoff`)
- **Teste:**
  `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`,
  describe "problema 1" — Infra mais antigo + Dev Lead mais novo resolve pro
  card do Dev Lead, nunca pro de Infra; só Infra `offered` não mostra card
  nenhum
- **Origem:** investigação de código + teste ao vivo no Chrome — o handoff
  pro Dev Lead nunca ficava acionável depois da FASE 14d

### RN-137 — "Ativar execução" tem atalho inline no card do Dev Lead, sem baixar a exigência de papel {#rn-137}

O card de aceite do handoff pro Dev Lead ganhou um botão "Ativar execução"
ao lado do link "Acompanhe a execução em Executores" — atalho pra quem já
sabe o que quer, sem passar pela conversa. Chama a MESMA
`activateExecution` que a Visão Geral usa, agora com `sessionId` (a sessão
de chat aberta) como `originSessionId` — sem isto a sessão que trouxe o
Dev Lead ficava `active` para sempre, mesmo com a execução (numa sessão
SEPARADA) já tendo decolado por este atalho ([RN-135](#rn-135)).

**A rota continua exigindo `maintainer`** — DELIBERADAMENTE não alinhada ao
`developer` que já basta pra aceitar o handoff no mesmo card. Quem ativa
vira `session.createdBy` da sessão de execução, e é esse papel que
`ProposeActionUseCase` resolve (`ResolveEffectiveRoleUseCase.forProject`)
como o EFETIVO de todo `git_commit`/`git_push`/`pr_open` que os dev agents
propuserem dali em diante — é o mesmo motivo que já justificava o
`maintainer` do botão da Visão Geral
(`ExecutionController#activate`). Baixar a exigência aqui inverteria essa
resolução em silêncio: toda PR que a execução abrisse passaria de
`auto_approve` para `require_approval` sempre que quem clicou fosse
`developer`, sem ninguém ter decidido isso. Quem não é `maintainer` recebe
a frase real da api ("Papel insuficiente para esta ação", via
`mensagemDaApi`) em vez de um erro genérico.

Sem gate de `module_map` client-side: quando este card existe, o Arquiteto
já o definiu — é o artefato que precede a oferta do handoff pro Dev Lead —,
então replicar o `disabled={!hasModuleMap}` da Visão Geral travaria o botão
à toa. O caso raro (sessão inconsistente) cai no mesmo catch que trata
403/outros erros.

- **Onde:** `apps/web/src/routes/SessionPage.tsx`
  (`handleActivateExecution`), `apps/web/src/lib/api-client.ts`
  (`activateExecution` ganhou `originSessionId`)
- **Teste:**
  `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`,
  describe "problema 2" — clique chama `activateExecution` com
  `sessionId`; 403 mostra a frase real da api; o botão convive com o de
  aceitar o handoff e com o link de Executores
- **Origem:** investigação de código + teste ao vivo no Chrome — pedido de
  atalho, com a divergência de papel confirmada e mantida por decisão
  (não corrigida por alinhamento automático)

### RN-138 — Mensagens de um agente colapsam depois que ele passa o bastão {#rn-138}

A timeline do chat mostrava tudo sempre expandido, sem agrupar por autor —
numa sessão longa com Criativo, PO e Arquiteto se revezando, o histórico de
quem já saiu de cena competia por espaço com quem está falando agora. Cada
entrada da timeline ganhou um `agentId` (o `actor.id` de quem a gerou,
quando é um agente — `agent.response`, `agent.error`, épico/história
criados pelo PO, card de aprovação); entradas de usuário e as que marcam
uma TRANSIÇÃO (handoff, promoção de história) ficam sem `agentId` de
propósito, porque são pontos de corte por natureza.

Uma sequência CONSECUTIVA do mesmo `agentId` vira cabeçalho colapsável
(`Disclosure` do design system, fechado por padrão — nome do agente +
contagem, reabre com um clique) quando as duas condições valem:

1. **o agente já passou o bastão** — existe um handoff dele (`fromAgent`)
   com `status: 'accepted'` (a mesma verdade que o `handoff.accepted` do
   event log grava, sem precisar reconstruir por junção de evento); e
2. **nenhuma ação dele está `pending`** — a checagem é por `actor.id` em
   TODAS as `actions` da sessão, não só nas da sequência corrente: uma
   corrida de aprovação em aberto não pode ficar escondida atrás de um
   clique em NENHUM ponto do fio.

Uma sequência de 1 entrada nunca colapsa — "Fulano · 1 mensagem" no lugar
da própria mensagem não ganha nada. Qualquer entrada sem `agentId`, ou de
um agente diferente, quebra a sequência corrente exatamente como uma troca
de agente quebra — só agrupa o que é realmente consecutivo.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`TimelineEntry.agentId`,
  `timelineAgrupada`), `apps/web/src/routes/SessionPage.module.css`
  (`.agentGroup*`)
- **Teste:**
  `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`,
  describe "problema 3" — colapsa com bastão passado e sem ação pendente;
  não colapsa sem handoff aceito; não colapsa com ação pendente do mesmo
  agente; mensagem de outro autor no meio quebra o agrupamento
- **Origem:** investigação de código + teste ao vivo no Chrome — pedido de
  colapso, com `AgentTimelineTree`/`timeline-tree.ts` como referência de
  FORMA (agrupar por agente, nome + contagem, aberto/fechado), adaptada à
  timeline heterogênea intercalada do chat

---

## Psicólogo e Anamnese

### RN-021 — Hipótese sem evidência válida não é gravada {#rn-021}

Os `evidenceEventIds` precisam apontar para eventos **que existem e pertencem à
sessão analisada**. A validação é atômica por lote: um id inválido reprova o
lote inteiro.

- **Onde:** `apps/api/src/domain/psychologist/hypothesis-evidence.ts`
- **Teste:** `test/domain/psychologist/hypothesis-evidence.spec.ts`
- **Origem:** [ADR 0015](adr/0015-psicologo-real-toolloop-hipoteses-evidencia.md) §3

### RN-022 — O ciclo de vida da hipótese é compare-and-swap {#rn-022}

`proposed → accepted | dismissed`. Duas decisões concorrentes sobre a mesma
hipótese: uma vence, a outra recebe conflito — não 500, não silêncio.

- **Onde:** `apps/api/src/domain/psychologist/hypothesis-lifecycle.ts`
- **Teste:** `test/domain/psychologist/hypothesis-lifecycle.spec.ts`
- **Origem:** [ADR 0022](adr/0022-fechamento-4b-psicologo.md) §7

### RN-023 — A causa de término é classificação determinística {#rn-023}

Vem do **motivo** registrado, nunca de julgamento do LLM e nunca por
eliminação. Toda falha registra a origem: `infra | modelo | código | política`.

- **Onde:** `apps/engine/lib/engine/psychologist/termination_classifier.ex`
- **Origem:** [ADR 0022](adr/0022-fechamento-4b-psicologo.md) §5 e
  [ADR 0020](adr/0020-destravar-gates-qa-secops.md) §6

### RN-024 — A Anamnese só perfila competência do catálogo — guarda-corpo estrutural {#rn-024}

Competências de processo são **seis**, fechadas: `git`, `agile`, `arquitetura`,
`testes`, `seguranca`, `infra`. Mais as stacks técnicas derivadas do
`module_map`. Qualquer outra coisa — "ansiedade", "saúde mental" — **não tem
caminho de escrita**: é erro no domínio, não instrução de prompt.

- **Onde:** `apps/api/src/domain/anamnese/competency-catalog.ts:16`
- **Teste:** `test/domain/anamnese/competency-catalog.spec.ts`
- **Origem:** [ADR 0016](adr/0016-anamnese-proficiencia-patches-instrucao.md) §1
- **Por quê:** a Anamnese perfila **competência técnica**, não pessoa. O limite
  é estrutural porque uma instrução de prompt não é garantia.

### RN-025 — Apagar o perfil apaga de verdade, e o opt-out impede a re-derivação {#rn-025}

- **Onde:** `apps/api/src/domain/anamnese/proficiency-profile.entity.ts` +
  tabela `anamnese_opt_outs`
- **Origem:** [ADR 0016](adr/0016-anamnese-proficiencia-patches-instrucao.md) §2

### RN-026 — Patch de instrução negado não é reproposto {#rn-026}

A comparação é sobre o conteúdo **normalizado**, não sobre o texto literal:
reindentar o mesmo patch não o transforma em proposta nova. Não há tabela de
dedup — a fonte é o próprio histórico de `proposed_action` com `actionType =
instruction_patch` e `status = denied`.

- **Onde:** `apps/api/src/domain/instructions/patch-dedup.ts:22`
- **Teste:** `test/domain/instructions/patch-dedup.spec.ts`

### RN-027 — Rollback de instrução é operação **para frente** {#rn-027}

Reverter cria uma versão nova com o conteúdo antigo; não apaga histórico. A
tabela de versões é append-only.

- **Onde:** `apps/api/src/domain/instructions/`
- **Origem:** [ADR 0016](adr/0016-anamnese-proficiencia-patches-instrucao.md) §4

---

## Git

### RN-028 — Capability decide, não o nome do provider {#rn-028}

Operação não suportada (proteção de branch no provider local) é declarada em
`capabilities` e rejeitada com `GitNotSupportedError` — nunca falha silenciosa.

São **quatro** capabilities: `protectBranch` e `pullRequests` desde a Fase 2, e
`listTree` e `pullRequestDiff` desde a FASE 26 (aba Code, só leitura). A regra
não mudou com elas — mudou o alcance. E o critério de declarar continua sendo
prova: capability só é `true` quando a suite a exercita naquele provider; sem
prova, declara-se `false` e degrada (mesmo critério dos ADRs 0041/0042).

- **Onde:** `packages/shared/src/index.ts` (`GitProviderCapabilities`); os
  tetos das duas operações de leitura em
  `apps/api/src/domain/git/git-read-limits.ts`, fora do shared porque ele é
  100% tipo
- **Teste:** suite de contrato única, `test/contract/git-provider.contract.ts`,
  rodada contra os três providers
- **Origem:** [ADR 0001](adr/0001-git-provider-contract-shape.md)

### RN-029 — O bootstrap de Gitflow é idempotente e retomável {#rn-029}

Cinco passos; cada um verifica antes de agir e pode ser retomado do ponto que
falhou. `skip` é sucesso, não erro.

Eram seis. O sexto criava a branch `rc`, degrau que o
[ADR 0030](adr/0030-politica-de-branches-mecanizada.md) removeu da política —
o bootstrap continuou criando, protegendo e **documentando no repositório do
usuário** uma escada que o produto já tinha abandonado (achado #3 do primeiro
dogfooding). O valor `create_rc_branch` continua no enum `bootstrap_step`:
linhas antigas o referenciam, e passo que aconteceu de verdade não se apaga do
histórico.

- **Onde:** `apps/api/src/application/use-cases/git/bootstrap-steps.ts` +
  `domain/git/repo-bootstrap.entity.ts` (`RETIRED_BOOTSTRAP_STEPS`)
- **Teste:** `test/domain/git/repo-bootstrap-status.spec.ts`
- **Origem:** [ADR 0005](adr/0005-repo-bootstrap-idempotent-steps.md)

---

## Credenciais

Chave de LLM e token de git do usuário vivem na mesma tabela
(`user_credentials`), sob o mesmo envelope encryption. Esta seção vale para as
duas.

### RN-055 — Credencial é sempre cifrada e gravada; verificar é ação à parte, com três respostas {#rn-055}

O cadastro **não julga a credencial**: cifra e grava, mesmo que o provider
fosse recusá-la. Verificar é uma ação explícita sobre a credencial **já
gravada** — a api decifra, chama o provider e devolve só o veredito. O texto
plano nunca volta em resposta nenhuma, nem em pedaço, nem no motivo da recusa.

Era o contrário: o cadastro testava antes de persistir e recusava a gravação
([ADR 0004](adr/0004-git-credential-registration.md), estendido às chaves de
LLM na Fase 11a). O modo de falha real foi o oposto do previsto — como o campo
é write-only e a tela nunca reexibe o que foi digitado, uma recusa deixava o
usuário **sem credencial e sem o texto para corrigir**.

O veredito tem **três** valores, e o terceiro é obrigatório:

| | quando |
|---|---|
| `ok` | o provider aceitou |
| `recusado` | o provider rejeitou — carrega o motivo **dele** |
| `nao_suportado` | não há endpoint de teste verificado (`ollama`, `anthropic`, `openai`) |

Sem `nao_suportado`, um provider cujo tester é NO-OP voltaria `ok` e a tela
afirmaria uma verificação que nunca aconteceu. É a regra de capability do
[ADR 0041](adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)
aplicada aqui: só se declara o que foi provado. Por isso o port declara
`supports()` — o silêncio de `test()` sozinho é ambíguo.

Chave ruim **não é exceção HTTP**: o caso de uso captura
`LLMCredentialConnectionTestFailedError`/`GitCredentialConnectionTestFailedError`
e devolve resultado, com 200. A única exceção é não existir credencial para
(usuário, provider) — 404, porque aí não há o que testar.

- **Onde:**
  `apps/api/src/application/use-cases/credentials/test-stored-credential.use-case.ts`,
  `apps/api/src/application/use-cases/llm/upsert-user-credential.use-case.ts`,
  `apps/api/src/application/use-cases/git/register-git-credential.use-case.ts`,
  `apps/api/src/application/ports/llm-credential-connection-tester.port.ts`
  (`supports`)
- **Teste:**
  `test/application/use-cases/credentials/test-stored-credential.use-case.spec.ts`
  (os três resultados, o despacho git×LLM, o 404 e a ausência do segredo na
  resposta); `test/application/use-cases/llm/upsert-user-credential.use-case.spec.ts`
  e `test/application/use-cases/git/register-git-credential.use-case.spec.ts`
  (a gravação incondicional, que é a inversão)
- **Origem:** [ADR 0050](adr/0050-credencial-sempre-cifrada-verificacao-explicita.md)

---

## Autenticação

Regras do auth first-party. Todas valem no domínio da api, que desde a 7.2 é
também o **emissor** dos tokens de acesso — o Keycloak saiu num corte atômico,
sem período de coexistência.
Decisões em [ADR 0031](adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)
e [ADR 0032](adr/0032-corte-do-keycloak-e-sessao-em-cookie.md).

### RN-030 — Reapresentar um refresh já usado revoga a família inteira {#rn-030}

Cada refresh consome o token apresentado e emite um filho com o **mesmo**
`family_id` e o mesmo `family_started_at`. Apresentar um token que já foi
consumido é a assinatura de um roubo — alguém está usando uma cópia — e a
resposta é revogar todos os tokens vivos daquela família, com evento de
segurança.

O usuário legítimo é deslogado junto. Isso é o comportamento correto, não um
defeito: do lado do servidor, um duplo-submit do cliente e um replay de ladrão
são idênticos.

- **Onde:** `apps/api/src/domain/auth/refresh-token.ts:50` +
  `application/use-cases/auth/refresh.use-case.ts:98`
- **Teste:** `test/application/use-cases/auth/rotacao-e-reuso.spec.ts`
- **Borda:** quem apresenta um token de família **já revogada** é vítima a
  jusante, não novo roubo: registra `refresh_revoked` e **não** dispara segunda
  cascata. Sem essa distinção, cada aba do usuário legítimo geraria um alarme
  falso durante o incidente.
- **Origem:** [ADR 0031](adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)

### RN-031 — Falha de login é contada por e-mail e por IP, e o bloqueio escala {#rn-031}

Janela deslizante de 15 minutos no Postgres, sem Redis. Dois baldes por
tentativa e o mais restritivo vence: e-mail (5 falhas → 30s, 8 → 5min, 12 →
15min) e IP (20 → 30s, 30 → 2min). Um login bem-sucedido limpa o balde do
e-mail; o de IP drena só por tempo.

A chave do balde é o **e-mail normalizado**, nunca o id do usuário. Com id, o
balde só existiria depois de encontrar a conta, e o próprio lockout viraria
oráculo de existência.

- **Onde:** `apps/api/src/domain/auth/lockout-policy.ts:97` +
  `infrastructure/persistence/drizzle/drizzle-login-throttle.ts:74`
- **Teste:** `test/application/use-cases/auth/lockout.spec.ts`
- **Borda:** enquanto bloqueado, a tentativa **não** é registrada. Se fosse, um
  atacante manteria a conta da vítima travada para sempre só continuando a
  tentar — o lockout viraria negação de serviço contra quem ele protege.
- **Por quê:** o balde de IP não pode ser limpo no sucesso; quem tem uma conta
  válida zeraria a janela à vontade e pulverizaria palpites sem limite.
- **Origem:** [ADR 0031](adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)

### RN-032 — Nenhuma resposta distingue conta existente de inexistente {#rn-032}

Qualquer resposta diferente da falha uniforme só é alcançável **depois** de uma
verificação de senha bem-sucedida. No login, e-mail inexistente, senha errada e
conta bloqueada devolvem o mesmo 401 e gastam o mesmo tempo — o ramo sem conta
verifica contra um hash dummy gerado com **os mesmos parâmetros** do real. No
registro e no pedido de reset, endereço conhecido e desconhecido devolvem 202.

- **Onde:** `apps/api/src/application/use-cases/auth/login.use-case.ts:79` +
  `register.use-case.ts:74`
- **Teste:** `test/application/use-cases/auth/enumeracao.spec.ts`
- **Borda:** a checagem de bloqueio por e-mail roda **depois** do argon2, não
  antes. Sair mais cedo é a otimização que qualquer revisor sugeriria, e é
  exatamente o vazamento — o teste fica vermelho se alguém a introduzir.
- **Borda:** o usuário MIGRADO do Keycloak (existe em `users`, sem linha em
  `auth_credentials`) também recebe o 401 uniforme — e o link de "definir
  senha" é disparado em silêncio. Responder `password_pending` confirmaria que
  o endereço existe **e** que é conta legada. Por isso `findByEmail` é um LEFT
  JOIN numa consulta só: duas consultas encadeadas fariam esse ramo pagar uma
  ida a mais ao banco, e o relógio revelaria o que o corpo esconde.
- **Por quê:** o que se afirma é "nenhum ramo pula o trabalho caro e nenhum
  produz resposta distinguível", **não** tempo constante. Ver as consequências
  no ADR.
- **Origem:** [ADR 0031](adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md),
  borda do migrado em
  [ADR 0032](adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)

### RN-033 — Token de verificação e de reset vale uma vez só {#rn-033}

Consumo por UPDATE condicional com `returning`: o próprio UPDATE é a guarda.
Zero linhas cobre inexistente, de outro propósito, já consumido, invalidado e
expirado — todos com a mesma resposta. Pedir um link novo invalida o anterior.
Concluir um reset revoga **todas** as sessões do usuário e não emite tokens.

- **Onde:** `apps/api/src/infrastructure/persistence/drizzle/account-token.repository.ts:76`
- **Teste:** `test/application/use-cases/auth/tokens-de-conta.spec.ts`
- **Borda:** dois envios simultâneos não passam os dois. A corrida é o caso
  **normal**, não a exceção: scanner de e-mail corporativo abre todo link de
  toda mensagem, então o robô costuma consumir o token antes do humano clicar.
- **Por quê:** o reset não emite sessão de propósito — logar direto a partir de
  um link recebido por e-mail faria comprometer o e-mail equivaler a tomar a
  conta, sem segundo passo.
- **Origem:** [ADR 0031](adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)

### RN-034 — A sessão da web vive em cookie httpOnly, com CSRF {#rn-034}

O refresh token vai num cookie `brabo_refresh` (`httpOnly`, `SameSite=Strict`,
`Path=/auth`, `Secure` em produção) e **não** aparece no corpo de nenhuma
resposta. O access token, de 15 minutos, fica em memória no cliente e viaja no
`Authorization: Bearer`.

`/auth/refresh` e `/auth/logout` exigem `X-CSRF-Token` igual ao cookie
`brabo_csrf`, comparado em tempo constante.

- **Onde:** `apps/api/src/interfaces/http/auth/session-cookies.ts:53` +
  `interfaces/http/auth/auth.controller.ts`
- **Teste:** `test/interfaces/session-cookies.spec.ts`
- **Borda:** falha de CSRF é **403**, não 401. Com 401 o cliente tentaria
  renovar a sessão e entraria em laço — a credencial está boa, quem está errada
  é a requisição.
- **Por quê:** devolver o refresh também no corpo anularia o `httpOnly` —
  bastaria um XSS ler a resposta do login, e levaria a sessão longa em vez dos
  15 minutos do access.
- **Origem:** [ADR 0032](adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)

### RN-035 — O tráfego interno engine ↔ api exige o segredo de serviço {#rn-035}

As 32 rotas `/internal/*` são `@ServiceRoute()`: ficam fora do JWT de usuário e
fora do rate limit. Quem autentica é o `EngineServiceGuard`, comparando
`X-Brabo-Service-Token` com `BRABO_SERVICE_TOKEN` em tempo constante. O mesmo
segredo vale nos dois sentidos, e `BRABO_SERVICE_TOKEN_PREVIOUS` é aceito só na
verificação, para a rotação não ter janela de indisponibilidade.

- **Onde:** `apps/api/src/interfaces/http/auth/engine-service.guard.ts:44` +
  `infrastructure/security/service-token.ts` +
  `apps/engine/lib/engine_web/plugs/verify_service_token.ex`
- **Teste:** `apps/engine/test/engine_web/plugs/verify_service_token_test.exs`
  e `test/interfaces/route-surface.spec.ts`
- **Borda:** a isenção de rate limit vem do METADADO da rota, não do guard. O
  `RateLimitGuard` é `APP_GUARD` e roda antes de qualquer guard de controller —
  quando ele decide, o `EngineServiceGuard` ainda não rodou.
- **Origem:** [ADR 0032](adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)

### RN-128 — `sessionId`/`projectId`/`agent`/`agentId` são validados ANTES de virar segmento de URL da requisição interna ao engine {#rn-128}

`HttpApiToEngineClient` interpola estes valores em template string pra
montar a URL de `/internal/*` — sem DTO/`class-validator` no meio, igual
à [RN-127](#rn-127): eles chegam de `@Param`/lookup de sessão sem pipe de
validação em algum ponto da cadeia, e nada garante a forma deles antes da
interpolação. Um valor malicioso poderia injetar segmento de path extra
ou caracteres que quebram a URL montada — o `EngineServiceGuard` autentica
o CHAMADOR (RN-035), não CONFERE o que o chamador manda na URL.

`garantirSegmentoDeUrlInterna` reusa a mesma largura de
`NOME_DE_PASTA_VALIDO` (RN-092/109) — hex, hífen e sublinhado, 1 a 64
chars — e é chamada em DOIS lugares, cobrindo TODOS os métodos que
interpolam id em URL, não só os que o CodeQL reportou:

- dentro de `postCommand`, que a maioria dos métodos já usa
  (`startAgent`, `sendAgentMessage`, `confirmReadiness`, `cancelAgentTurn`,
  `offerInfraHandoff`, `offerDevHandoff`, `invalidateInstructions`,
  `startExecution`, `acceptParallelization`, `rearmDevAgent`,
  `reviseStory`) — o chamador lista as tuplas `(nome, valor)` que já
  interpolou no `path`, e `postCommand` valida TODAS antes de montar a
  requisição;
- direto em `reanalyzeSession`/`runAnamnese`, que não passam por
  `postCommand` (precisam distinguir 503 de falha de transporte) e por
  isso eram os dois únicos pontos que o CodeQL alcançou.

O caminho feliz não muda: `sessionId`/`projectId` são sempre UUID vindo do
banco, e `agent`/`agentId` são sempre slug curto.

- **Onde:** `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`
  (`garantirSegmentoDeUrlInterna`, `postCommand`)
- **Teste:** `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts`
  (id malformado é recusado ANTES de tocar a rede — provado apontando
  `ENGINE_URL` pra uma porta que nada escuta — e o caminho feliz chega a
  fazer a requisição)
- **Origem:** alerta CRÍTICO do CodeQL (URL de requisição interna montada
  com valor não validado) bloqueando a promoção qa→main, achado durante a
  PR #256; mesmo padrão do [RN-092](#rn-092)

### RN-105 — Sem imagem decidida pelo Arquiteto, o container não sobe e o Code não abre {#rn-105}

A aba Code (`GET /projects/:id/code/*`, [ADR 0060](adr/0060-superficie-de-leitura-de-codigo.md))
responde **409** enquanto o projeto estiver em `sem_decisao` — o estado inicial
de todo projeto. `sem_decisao` vira `decidido` só quando o Arquiteto emite
`artifact.project_image` pela ferramenta `choose_project_image`, com imagem OCI
de tag explícita (`latest` recusado), `rationale` e postura de rede.

A checagem mora no MESMO funil que a contenção de caminho da
[RN-095](#rn-095) (`ReadProjectCodeUseCase.alvo`), e não em cada uma das sete
rotas (árvore, arquivo, busca, diff de PR, [blame](#rn-110), [lista de
PRs](#rn-111) e [branches detalhadas](#rn-112), FASE 26b) — checagem
duplicada em sete chamadores é checagem que um dia diverge em um deles
([ADR 0058](adr/0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md)).
Contagem corrigida aqui: este registro dizia "quatro rotas" desde a FASE 26,
e ficou desatualizado quando a FASE 26b acrescentou as três últimas ao mesmo
funil sem que ninguém revisasse este número.

O artefato não tem tabela: é o próprio evento no event log, versionado
(`version` cresce a cada emissão, o vigente é o de maior `version`), do mesmo
jeito que `artifact.module_map`. Revisar a imagem é emitir uma versão nova,
nunca sobrescrever a anterior.

- **Onde:** `apps/api/src/domain/containers/project-container.ts`,
  `apps/api/src/application/use-cases/containers/decidir-imagem-do-projeto.use-case.ts`,
  `apps/api/src/application/use-cases/containers/obter-container-do-projeto.use-case.ts`,
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts` (método
  `portaoDoContainer`), `apps/engine/lib/engine/harness/tools/choose_project_image.ex`
- **Teste:**
  `apps/api/test/domain/containers/project-container.spec.ts`,
  `apps/api/test/application/use-cases/containers/container-do-projeto.use-case.spec.ts`,
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (bloco "o portão do container")
- **Borda:** 409 e não 403 — nada está errado com quem pediu nem com a
  permissão dele; o recurso ainda não existe NESTE ESTADO. E não é 404: a aba
  existe, só não está liberada. A mensagem diz o que falta, para a tela mostrar
  o motivo em vez de um erro mudo (RN-088).
- **Origem:** [ADR 0065](adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

### RN-106 — `git push`, PR e deploy não saem pelo terminal — mesmo dentro do escopo do projeto {#rn-106}

**REVISADA pela [RN-418](#rn-418) (ADR 0102, decisão GLOBAL do dono do
produto)**: o `deny` que este registro descreve virou TETO ABSOLUTO
(`require_approval` incondicional) — o resto desta entrada é histórico,
fiel ao que valia até a revisão.

Dentro do container do projeto o agente é livre (ADR 0065): o allowlist de
verbos do [ADR 0055](adr/0055-escopo-de-caminho-na-politica-de-terminal.md) não
converge (achados Z e AD — verbo, forma e invocação são espaços distintos), e a
saída é a parede, não uma lista mais longa. Mas três efeitos atravessam a
parede e chegam no mundo, e a decisão do usuário foi textual: *"agente livre
para o que quiser desde que não seja comandos de git ligado ao deploy e ao PR —
estas ações ainda devem ser humanas"*.

`decide()` reconhece `git push`, `git remote add/set-url`, `git merge`, os CLIs
de provider (`gh pr create`, `gh pr merge`, `glab mr create/merge`, releases e
workflow dispatch) e os comandos de deploy comuns (`kubectl apply`, `helm
upgrade`, `terraform apply`, `docker push`, `npm publish`, ...) por PREFIXO de
tokens, ignorando flags globais no meio (`git -C /tmp push` casa). Qualquer
segmento do comando composto que case é **`deny`** — não `require_approval`:
"sempre permitir" grava o padrão em `allow`, e um clique bastaria para a
segunda porta ficar aberta para sempre. `deny` vence `allow` em qualquer
estágio, e é aplicado ANTES de qualquer estágio permissivo em `decide()`.

Negar não tira poder do agente: a mensagem redireciona para a ação TIPADA
(`git_push`, `git_merge`, `pr_open`) — que nasce `proposed_action`, tem papel
mínimo próprio e registra no event log o que foi empurrado e para onde. É o
caminho que o dev agent já usa (`agent_io.ex` propõe `git_push`); o que muda é
que agora está garantido por `deny`, não só combinado por convenção.

- **Onde:** `apps/api/src/domain/actions/external-effect.ts`,
  `apps/api/src/domain/actions/decide.ts` (bloco "FRONTEIRA DO CONTAINER")
- **Teste:** `apps/api/test/domain/actions/external-effect.spec.ts`,
  `apps/api/test/domain/actions/decide.spec.ts` (describe "a fronteira do
  container")
- **Borda:** a fronteira NÃO se sobrepõe à trava de merge em branch protegida
  (RN-014, sempre manual) nem ao escopo de caminho (RN-095/ADR 0055) — as três
  regras coexistem, cada uma vetando por um motivo diferente.
- **Origem:** [ADR 0065](adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

### RN-107 — A aba Code tem um QUARTO estado: bloqueada por decisão pendente {#rn-107}

Os três estados da [RN-088](#rn-088) (carregando/erro/vazio) não descrevem
`sem_decisao` ([RN-105](#rn-105)): não é carregando (a api já respondeu), não é
erro (ela respondeu CERTO) e não é vazio (não falta dado — falta uma DECISÃO,
que é outra coisa). Tratar `sem_decisao` como "vazio" mostraria um editor sem
arquivos, convidando a pensar que o repositório está vazio; tratar como "erro"
faria a tela sugerir "tentar de novo" para algo que só o Arquiteto resolve.

A aba pergunta o estado do container ANTES de tentar ler código
(`GET /projects/:id/container`), em vez de esperar a primeira árvore ou
arquivo devolver 409 — a mesma checagem que a api já faz no funil de
`ReadProjectCodeUseCase` (RN-105), só que perguntada primeiro, para o quarto
estado nascer como mensagem própria e não como o rodapé de um erro genérico.
Enquanto bloqueada, a tela reconsulta sozinha a cada 15s — depois de decidida
a imagem não muda sem ação humana nova, e ficar reconsultando um estado
estável seria a mesma família de tráfego desnecessário da PÓS-FASE 15.

A apresentação do quarto estado foi EXTRAÍDA para `ContainerImageGateNotice`
(`apps/web/src/components/ContainerImageGate.tsx`) — achado de uso: a aba PRs
(`apps/web/src/routes/code/PrListAndDiff.tsx`, consumida por
`ProjectPrsTab.tsx` e por `CodeDiffPanel.tsx`) chama `getCodePullRequests`/
`getCodeDiff`, que passam pelo MESMO funil (RN-105) e podem devolver o MESMO
409 — mas, ao contrário desta aba, sem perguntar antes. Ela mostrava esse 409
no banner de erro genérico com "Tentar de novo", a afordância errada para um
estado que só o Arquiteto resolve. `isContainerImageGateError`
(`apps/web/src/lib/api-client.ts`) identifica a causa pelo `status === 409`
— única causa de `ConflictException` em `ReadProjectCodeUseCase.alvo` — e
`PrListAndDiff` troca o banner por `ContainerImageGateNotice` quando ela bate,
sem pré-checagem própria (reage ao 409 da query que já ia rodar).

- **Onde:** `apps/web/src/routes/ProjectCodeTab.tsx`,
  `apps/web/src/routes/ProjectCodeTab.module.css`,
  `apps/web/src/components/ContainerImageGate.tsx` (apresentação
  compartilhada), `apps/web/src/routes/code/PrListAndDiff.tsx` (consumidor
  reativo ao 409), `apps/web/src/lib/api-client.ts`
  (`isContainerImageGateError`)
- **Teste:** `apps/web/src/routes/ProjectCodeTab.test.tsx` ("o gate"),
  `apps/web/src/routes/code/CodeDiffPanel.test.tsx`,
  `apps/web/src/routes/ProjectPrsTab.test.tsx` ("o gate do container não é
  erro genérico")
- **Borda:** a checagem no front NÃO substitui a da api — é conveniência de
  UX. Se a api mudar de estado entre a consulta do gate e a leitura de
  verdade, a rota de leitura ainda recusa com 409 (RN-105); o front só evita
  o caso comum de mostrar o editor vazio por um instante. A aba PRs não faz
  pré-checagem: ela descobre o bloqueio quando a query já falhou, porque não
  há árvore/arquivo nenhum ali para o instante "vazio" que a pré-checagem da
  aba Code evita.
- **Origem:** [ADR 0065](adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

### RN-110 — `blame` é a 13ª operação do `GitProviderContract`, com o mesmo vocabulário de ausência das outras leituras {#rn-110}

Fundação da pendência de blame declarada na FASE 26 (nenhuma tela consome
ainda — vem na onda seguinte). `blame(ref, path)` devolve `GitBlame | null`,
`null` significando exatamente o que já significa em `getFileContent`/
`listTree`: arquivo ausente naquela ref, ou ref inexistente. Dois vocabulários
de "não existe" para a mesma aba fariam a tela tratar o mesmo caso de duas
formas — a mesma razão que já valia para as duas operações anteriores.

Cada provider computa por meios PRÓPRIOS, porque não há endpoint comum: o
GitHub não tem blame na REST (só GraphQL — a única operação do provider que
fala GraphQL), o GitLab tem `repository/files/:path/blame`, e o local sai de
`git blame --porcelain`, o único dos três testado contra um repositório de
verdade nesta sessão (os outros dois só contra os backends fake do teste de
contrato — sem `GITHUB_TEST_TOKEN`/`GITLAB_TEST_TOKEN` no ambiente, quem prova
contra a API real é o smoke manual). `GIT_BLAME_LINE_LIMIT` (2000) corta
arquivo genuinamente enorme — já cortado por bytes na rota de conteúdo, mas
`blame` lê o arquivo inteiro do provider antes de decidir.

- **Onde:** `packages/shared/src/index.ts` (`BlameInput`, `GitBlame`,
  `GitBlameLine`, capability `blame`),
  `apps/api/src/infrastructure/git/{github,gitlab,local}-provider.ts`,
  `apps/api/src/domain/git/git-read-limits.ts` (`GIT_BLAME_LINE_LIMIT`),
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (método `blame`), `apps/api/src/interfaces/http/git/code.controller.ts`
  (`GET /projects/:id/code/blame`)
- **Teste:** `apps/api/test/contract/git-provider.contract.ts` (bloco "blame"),
  exercitado pelos três specs de provider — o do `local` contra git de
  verdade — e `read-project-code.use-case.spec.ts` (bloco "blame")
- **Origem:** FASE 26b (fundação das pendências declaradas da FASE 26/
  [ADR 0060](adr/0060-superficie-de-leitura-de-codigo.md))

### RN-111 — `listPullRequests` é a 14ª operação do `GitProviderContract`; a lista navegável abre o mesmo diff por id {#rn-111}

`CodeDiffPanel.tsx` consome `listPullRequests(state?)` numa lista clicável
(id/número/título/autor/estado/branches, com filtro por estado); clicar num
item reusa o MESMO fluxo de diff por id que já existia — não há caminho novo
de leitura, só como CHEGAR ao id sem precisar saber de cor. Quem já sabe o id
(ex.: veio de Aprovações) continua podendo colar direto.

`listPullRequests(state?)` devolve um RESUMO por PR
(`GitPullRequestSummary`: id, número, título, autor, estado, branches,
`updatedAt`) — não `GitPullRequest`, que é o tipo de ESCREVER (abrir/mesclar) e
nunca teve título nem autor porque nenhuma das duas operações precisava. Um
tipo próprio evita que a escrita ganhe campos que só a leitura usa.

O `local` TEM PR — o store sidecar da Fase 4a já é a fonte, e a suposição do
enunciado ("PR não existe no conceito de repositório local puro") não se
sustentou: o self-contained dos dev agents criou PR local desde então. As três
capabilities são `true`. `GIT_PR_LIST_LIMIT` (100) é uma página só, sem
paginação de seguimento — navegação humana, não sincronização de histórico.

- **Onde:** `packages/shared/src/index.ts` (`ListPullRequestsInput`,
  `GitPullRequestSummary`, `GitPullRequestList`, capability
  `pullRequestsList`), `apps/api/src/infrastructure/git/{github,gitlab,
  local}-provider.ts`, `apps/api/src/domain/git/git-read-limits.ts`
  (`GIT_PR_LIST_LIMIT`), `read-project-code.use-case.ts` (método
  `pullRequests`), `code.controller.ts` (`GET /projects/:id/code/pull-requests`),
  `apps/web/src/routes/code/CodeDiffPanel.tsx` (lista clicável, filtro por
  estado, reuso do fluxo de diff por id)
- **Teste:** `git-provider.contract.ts` (bloco "listPullRequests"),
  `read-project-code.use-case.spec.ts` (bloco "lista de PRs"),
  `apps/web/src/routes/code/CodeDiffPanel.test.tsx`
- **Origem:** FASE 26b

### RN-112 — `listBranchesDetailed` é operação PRÓPRIA, separada de `listBranches` {#rn-112}

Fundação do dropdown rico, agora consumida por `CodeBranchPicker.tsx`
(`ahead`/`behind`, badge de PR — a onda seguinte à FASE 26b fechou a
pendência que `CodeShell.tsx` declarava). A decisão foi NÃO estender `listBranches` — a
13ª operação original, que o bootstrap de Gitflow chama sem precisar de nada
disso: enriquecer custa uma chamada extra ao provider POR BRANCH (duas no
GitLab, que não tem endpoint que devolva os dois lados de uma comparação numa
chamada só, ao contrário de `compareCommitsWithBasehead` do GitHub e de `git
rev-list --left-right --count` no local). Encostar esse custo em toda
adoção/criação de branch transformaria o bootstrap numa varredura cara. As
duas operações convivem no contrato: `listBranches` pro bootstrap,
`listBranchesDetailed` (a 15ª) pra aba Code — `GitBranchDetail` estende
`GitBranch` só na FORMA, nunca no CONTRATO de quem chama.

`ahead`/`behind` são sempre relativos à branch DEFAULT do repositório
(`ListBranchesDetailedInput.defaultBranch`, que o chamador já sabe — pedi-la
de novo ao provider seria uma chamada a mais só pra redescobrir o que já
tinha). `null` nos dois quando o provider não consegue computar (branch órfã,
histórico não relacionado) é degradação honesta, nunca um número inventado.
`GIT_BRANCH_DETAIL_LIMIT` (30) corta pelas mesmas razões de tráfego do item 34
da FASE 26 — sem ele, um repositório com centenas de branches viraria centenas
de chamadas por abertura do dropdown.

- **Onde:** `packages/shared/src/index.ts` (`ListBranchesDetailedInput`,
  `GitBranchDetail`, `GitBranchDetailList`, `GitBranchPullRequestRef`,
  capability `branchesDetailed`), `apps/api/src/infrastructure/git/{github,
  gitlab,local}-provider.ts`, `git-read-limits.ts`
  (`GIT_BRANCH_DETAIL_LIMIT`), `read-project-code.use-case.ts` (método
  `branches`), `code.controller.ts` (`GET /projects/:id/code/branches`);
  no web, `apps/web/src/lib/api-client.ts` (`getCodeBranches`) e
  `apps/web/src/routes/code/CodeBranchPicker.tsx` — o dropdown em si, aberto
  a partir de `CodeShell.tsx`
- **Teste:** `git-provider.contract.ts` (bloco "listBranchesDetailed"),
  `read-project-code.use-case.spec.ts` (bloco "branches detalhadas"),
  `apps/web/src/routes/code/CodeBranchPicker.test.tsx`
- **Borda:** o método `branches()` mora no MESMO caso de uso das outras seis
  leituras (`ReadProjectCodeUseCase`), não perto do bootstrap — é uma LEITURA
  da aba Code, com a mesma resolução de credencial e o mesmo portão de
  container (RN-105) que as demais; tratá-la como operação de bootstrap
  duplicaria os dois. Uma ref fora da lista de branches (tag ou sha) segue
  alcançável — o rodapé do dropdown tem um campo manual, porque
  `listBranchesDetailed` não enumera essas duas coisas.
- **Origem:** FASE 26b (fundação); onda seguinte fechou a UI

### RN-113 — Blame no editor é anotação SOB DEMANDA — um toggle, nunca embutida na leitura do arquivo {#rn-113}

A UI que consome a fundação da [RN-110](#rn-110) entra aqui: o editor da aba
Code (`CodeEditor.tsx`) só chama `getCodeBlame` quando o usuário liga o toggle
"Blame" — nunca junto da leitura de arquivo, que já dispara sozinha ao abrir
uma aba. O motivo é o mesmo dos orçamentos de leitura composta (ADR 0060):
blame é uma SEGUNDA chamada ao provider por arquivo aberto, e um arquivo perto
do teto (`GIT_BLAME_LINE_LIMIT`, 2000 linhas) já é caro o bastante para não
pagá-lo de graça em toda navegação. `truncated` (que a RN-110 já expõe) vira
aviso visível, no mesmo padrão do aviso de `fileQuery.data.truncated`.

Linhas consecutivas do MESMO commit mostram autor e sha curto só na PRIMEIRA
linha do bloco — repetir o mesmo texto em cada linha de um bloco de dezenas
de linhas seria ruído, não anotação; a linha só some do texto, nunca some da
anotação (o `title` do elemento continua com data completa e resumo do
commit em qualquer linha do bloco).

- **Onde:** `apps/web/src/routes/code/CodeEditor.tsx`,
  `apps/web/src/routes/code/CodeEditor.module.css`
- **Teste:** `apps/web/src/routes/code/CodeEditor.test.tsx`
- **Origem:** onda de UI da FASE 26b (blame — dropdown rico de branches e
  lista de PRs são UI de outros dois agentes, sem risco de colisão)

### RN-115 — A Anamnese pode ser pausada globalmente; a pausa é do PRODUTO, nunca apaga dado {#rn-115}

`ANAMNESE_ENABLED` (env var do engine, boolean, default `false` a partir
desta regra) decide se uma rodada NOVA da Anamnese pode acontecer — periódica
(`AnamneseSchedulerWorker`) ou sob demanda (`AnamneseCommandController`).
Decisão de PRODUTO do usuário em 2026-08-10 ("hoje ele não está trazendo
dados de muito valor"), não bug — ver docs/explanation/backlog.md. Desativada,
NENHUM dado existente é tocado: hipóteses, perfis de proficiência e patches
de instrução já gravados continuam intactos e visíveis, e o opt-out POR
MEMBRO (RN-025) continua um conceito separado — a pausa é do SISTEMA, não do
perfilamento individual.

`AnamneseSchedulerWorker.kickoff/0` (chamado uma vez no boot) NÃO agenda o
job periódico quando desativado, em vez de agendar e deixar `perform/1`
no-opar a cada tick — mais barato (a fila do Oban não recebe um job a cada
`ANAMNESE_INTERVAL_SECONDS` só para não fazer nada) e mais claro para quem
inspeciona a fila. **Correção em 2026-08-10** (achado real em execução, não
hipótese): a versão original desta regra deixava `perform/1` incondicional
de propósito, para a corrente entre rodadas não carregar a decisão de
ligar/desligar consigo — mas isso significava que uma corrente já agendada
ANTES de a flag existir (ou de alguém desativá-la) continuava se
reagendando pra sempre, rodando Anamnese de verdade com a flag dizendo
`false`. Foi exatamente o que aconteceu num Postgres de dev mais antigo que
o PR original, remediado manualmente cancelando os jobs agendados.
`perform/1` agora confere `enabled?/0` a cada tick, igual `kickoff/0`: se
desativado, nem `enqueue_projects/0` nem o reagendamento acontecem, e a
corrente morre ali — o que também AUTO-CURA sozinho o cenário de job antigo
que ainda dispara uma vez, sem precisar de intervenção manual.

`AnamneseCommandController.run/2` (rota sob demanda, "reanalisar agora" nas
Configurações) responde **503** com corpo `{"error": "anamnese_desativada"}`
quando desativado — distinto de propósito do 409 vazio que já existia para
"projeto sem sessão" (os dois eram fáceis de confundir num 409 puro, e são
causas bem diferentes). `RunAnamneseUseCase`, do lado api, converte o 503 do
engine em `ServiceUnavailableException` com `reason: "anamnese_disabled"` no
corpo — nunca um 500 genérico nem um 409 reaproveitado. A web
(`ProjectSettingsTab.tsx`) descobre o estado no primeiro clique de "Rodar
agora" (não há hoje uma leitura prévia do estado global) e, a partir daí,
desabilita o botão e mantém a explicação VISÍVEL na tela — não só um toast
que some (RN-088: nunca falha silenciosa ou confusa).

- **Onde:** `apps/engine/lib/engine/workers/anamnese_scheduler_worker.ex`
  (`enabled?/0`, `kickoff/0`),
  `apps/engine/lib/engine_web/controllers/anamnese_command_controller.ex`,
  `apps/engine/config/runtime.exs`,
  `apps/api/src/domain/anamnese/anamnese-disabled.error.ts`,
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`
  (`runAnamnese`), `apps/api/src/application/use-cases/anamnese/run-anamnese.use-case.ts`,
  `apps/web/src/routes/ProjectSettingsTab.tsx` (`ProficiencySection`)
- **Teste:**
  `apps/engine/test/engine/workers/anamnese_scheduler_worker_test.exs`
  (`kickoff/0` não agenda desativado, agenda ativado, default desligado;
  `perform/1` desativado no meio da corrente não faz fan-out nem reagenda),
  `apps/engine/test/engine_web/controllers/anamnese_command_controller_test.exs`
  (503 distinto de 409, com e sem sessão),
  `apps/api/test/application/use-cases/anamnese/run-anamnese.use-case.spec.ts`,
  `apps/web/src/routes/ProjectSettingsTab.test.tsx` (`ProficiencySection`)
- **Borda:** a flag é GLOBAL (todos os projetos/workspaces), não por projeto
  — ao contrário do teto de paralelismo (RN-083) ou do modelo herdável por
  área (RN-102), que são decisões por escopo. Ligar de volta é
  `ANAMNESE_ENABLED=true` e reiniciar o engine; não há botão na UI para isso
  (é operacional, não uma preferência de projeto).
- **Origem:** sem ADR — decisão de produto reversível, não mudança estrutural
  de arquitetura. Ver docs/explanation/backlog.md.

### RN-117 — O Psicólogo pode ser pausado globalmente; a pausa é do PRODUTO, nunca apaga dado {#rn-117}

`PSYCHOLOGIST_ENABLED` (env var do engine, boolean, default `false`) decide
se uma rodada NOVA do Psicólogo pode acontecer — automática (fechamento de
sessão, roteado pelo `Engine.Outbox.Drain`) ou sob demanda
(`PsychologistCommandController.reanalyze/2`). Mesma decisão de PRODUTO do
usuário em 2026-08-10 já aplicada à Anamnese (RN-115, "hoje ele não está
trazendo dados de muito valor") — não bug, ver docs/explanation/backlog.md.
Desativado, NENHUM dado existente é tocado: análises e hipóteses já
emitidas continuam intactas e visíveis.

Diferente da Anamnese (cujo gatilho automático é um TICK periódico que a
própria flag decide se reagenda), o gatilho automático do Psicólogo é o
fechamento de sessão — o `Engine.Outbox.Drain` roteia
`session.closed`/`session.closed_abnormally` pra `PsychologistWorker` só
quando `PsychologistWorker.enabled?/0` é true (`Drain.handlers_for/1`);
desativado, só `SessionLifecycleWorker` roda, e o job do Psicólogo nem
nasce. `PsychologistWorker.perform/1` continua incondicional de propósito —
mas NÃO é mais "o mesmo padrão" do `AnamneseSchedulerWorker` (ver a correção
de 2026-08-10 na RN-115 acima): lá `perform/1` passou a conferir a flag
porque ele PRÓPRIO reagenda a corrente a cada tick, e um job antigo
disparando incondicionalmente reabria a Anamnese com a flag desligada. O
Psicólogo não tem corrente nenhuma que se reagende sozinha — cada job nasce
de UM evento (`session.closed`), e quem decide é o `Drain` no momento em que
RECEBE o evento, não o worker no momento em que RODA; um job de Psicólogo
já enfileirado antes de desligar a flag é, no máximo, a última rodada
pendente, nunca uma corrente infinita. Por isso a suite pré-existente de
`PsychologistWorker` (que chama `perform/1` direto) não precisou mudar.

`PsychologistCommandController.reanalyze/2` (rota sob demanda,
"Reanalisar" na aba Insights) responde **503** com corpo
`{"error": "psicologo_desativado"}` quando desativado, sem sequer criar o
job. `ReanalyzeSessionUseCase`, do lado api, converte o 503 do engine em
`ServiceUnavailableException` com `reason: "psychologist_disabled"` no
corpo — nunca um 500 genérico. Isto descobre a pausa quando já existe uma
análise para reprocessar; a tela SEM hipótese nenhuma tem uma leitura
prévia própria, que não existia aqui — ver [RN-454](#rn-454).

- **Onde:** `apps/engine/lib/engine/workers/psychologist_worker.ex`
  (`enabled?/0`), `apps/engine/lib/engine/outbox/drain.ex`
  (`handlers_for/1`),
  `apps/engine/lib/engine_web/controllers/psychologist_command_controller.ex`,
  `apps/engine/config/runtime.exs`,
  `apps/api/src/domain/psychologist/psychologist-disabled.error.ts`,
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`
  (`reanalyzeSession`),
  `apps/api/src/application/use-cases/execution/reanalyze-session.use-case.ts`,
  `apps/web/src/routes/ProjectInsightsTab.tsx`
- **Teste:**
  `apps/engine/test/engine/outbox/drain_test.exs` (`session.closed` só
  enfileira o Psicólogo quando ativado),
  `apps/engine/test/engine_web/controllers/psychologist_command_controller_test.exs`
  (503 sem criar job, 202 com job enfileirado quando ativado),
  `apps/api/test/application/use-cases/execution/reanalyze-session.use-case.spec.ts`,
  `apps/web/src/routes/ProjectInsightsTab.test.tsx`
- **Borda:** a flag é GLOBAL (todos os projetos/workspaces), como a da
  Anamnese. Ligar de volta é `PSYCHOLOGIST_ENABLED=true` e reiniciar o
  engine; não há botão na UI para isso.
- **Origem:** sem ADR — decisão de produto reversível, não mudança estrutural
  de arquitetura. Ver docs/explanation/backlog.md.

### RN-108 — O socket da sessão exige um ticket opaco de uso único, não o JWT reaproveitado {#rn-108}

`EngineWeb.SessionSocket.connect/3` recusava a conexão inteira só com o
`session_id` (UUID) precisando existir no Registry — quem descobrisse o UUID
entrava no canal `session:<id>` e recebia todos os broadcasts ao vivo da
sessão. Fechar isso era limitação deliberada documentada no próprio módulo
desde a Fase 3.

`POST /projects/:projectId/sessions/:sessionId/socket-ticket` (`scope:
"heartbeat"|"terminal"`) emite um ticket opaco (32 bytes de CSPRNG,
`TokenFactory`), TTL de **30 segundos**, uso único. `scope: "heartbeat"` exige
papel `viewer`; `scope: "terminal"` exige `developer` — o mesmo papel mínimo
de `MIN_ROLE_FOR_ACTION_TYPE.terminal` em `domain/actions/decide.ts` (hoje
nenhum caminho pede `terminal` de verdade; o valor nasce certo para a FASE 25,
o terminal interativo). A api persiste só o HASH (SHA-256 **puro**, não
`hashDeToken`/HMAC — o engine não tem o pepper da api, e um token de 256 bits
de CSPRNG não precisa de pepper contra dicionário, mesmo raciocínio que o
próprio `hashDeToken` já registra), nunca o token bruto.

O consumo é do ENGINE, que lê `session_socket_tickets` direto (mesmo padrão de
`Engine.Outbox.Event` sobre `outbox_events` — nunca changeset/insert, só a
escrita estreita que o uso único exige) em DUAS etapas:
`SocketTicket.validar/1` (peek, sem marcar nada — chamado por `connect/3`,
que ainda não sabe qual `session_id` vai ser pedido) e
`SocketTicket.consumir/2` (`UPDATE` condicional exigindo o `session_id` do
tópico bater com o da linha — chamado por `SessionChannel.join/3`, que
também confere o `project_id` do ticket contra o da sessão, defesa em
profundidade contra ticket de um projeto abrindo canal de outro). Sem ticket,
ou com um inválido: a conexão inteira é recusada (`{:error, %{reason:
"unauthorized"}}`), não só o join do canal.

O web (`session-channel.ts`) busca um ticket NOVO antes de TODA
`socket.connect()` — inclusive em reconexão automática, que existe. O
reconnect nativo do `Phoenix.Socket` reusaria o mesmo `params` da construção
(o ticket velho, já expirado ou consumido), então ele é neutralizado
(`reconnectAfterMs` que praticamente nunca dispara) e a reconexão passa a ser
inteiramente manual, com busca de ticket fresco a cada tentativa.

- **Onde:** `apps/api/src/db/schema.ts` (`sessionSocketTickets`),
  `apps/api/src/domain/sessions/socket-ticket-scope.ts`,
  `apps/api/src/application/use-cases/sessions/create-socket-ticket.use-case.ts`,
  `apps/api/src/interfaces/http/sessions/sessions.controller.ts` (rota
  `socket-ticket`), `apps/engine/lib/engine/sessions/socket_ticket.ex`,
  `apps/engine/lib/engine_web/channels/session_socket.ex`,
  `apps/engine/lib/engine_web/channels/session_channel.ex`,
  `apps/web/src/lib/session-channel.ts`
- **Teste:**
  `apps/api/test/application/use-cases/sessions/create-socket-ticket.use-case.spec.ts`,
  `apps/api/test/domain/sessions/socket-ticket-scope.spec.ts`,
  `apps/api/test/infrastructure/persistence/session-socket-ticket.repository.spec.ts`,
  `apps/engine/test/engine/sessions/socket_ticket_test.exs` (reuso falha,
  session_id errado falha, corrida concorrente só um vence),
  `apps/engine/test/engine_web/channels/session_socket_test.exs` (sem ticket
  a conexão é recusada),
  `apps/engine/test/engine_web/channels/session_channel_test.exs` (ticket de
  outro projeto: join falha), `apps/web/src/lib/session-channel.test.ts`
- **Borda:** o ticket NÃO é o JWT reaproveitado — TTL curto, uso único, escopo
  fechado, e nasce de uma rota própria que já checa papel efetivo, não de
  decodificar o access token existente.
- **Origem:** sem ADR — extração/hardening pontual, não mudança estrutural.

### RN-109 — O nome de pasta do workspace é congelado na criação, e projeto antigo mantém o UUID {#rn-109}

A pasta física de um projeto em `PROJECT_WORKSPACES_ROOT` era o UUID puro —
ilegível ao abrir no disco. `projects.workspace_dir_name` (NOT NULL, UNIQUE)
passou a guardar o nome de verdade: `<slug>-<8 chars do id>` para projeto
NOVO (`workspaceDirNameFor` em
`apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`), gerado
em código — o id nasce de `crypto.randomUUID()` no
`CreateProjectUseCase`, não do `defaultRandom()` do Postgres, porque o nome
da pasta precisa do id ANTES do insert. Os 8 caracteres seguem a mesma
convenção do rótulo de sessão (`apps/web/src/lib/session-label.ts`).

O nome é CONGELADO no momento da criação e nunca recalculado: `UpdateProjectUseCase`
permite editar o `slug` depois, e isso NÃO toca `workspace_dir_name` — reservar a
pasta física, com working tree e worktrees de agente possivelmente abertos, é
risco real que a decisão evita por construção, não por disciplina de quem
chama.

Projeto criado ANTES desta migração (0042) manteve a pasta física que já
tinha: o backfill grava `workspace_dir_name = id` para toda linha existente —
o mesmo valor que já era verdade no disco — e NUNCA renomeia diretório
nenhum. Um trigger `BEFORE INSERT` (`projects_workspace_dir_name_default_trg`)
aplica o MESMO fallback (`id::text`) para qualquer insert que chegue sem o
campo — rede de segurança para quem esquecer de gravá-lo (nunca o caminho
principal, que sempre grava explícito), e o que mantém as dezenas de
fixtures de teste existentes, que não conhecem este conceito, funcionando
sem precisar reescrever cada uma.

A derivação de caminho a partir do nome (`projectScopeRoot`, RN-092/RN-075)
passou a receber `workspace_dir_name` em vez do `projectId` cru — mesma
validação de charset, mesma pureza. O engine lê a MESMA coluna
(`Engine.Projects.Project.workspace_dir_name/1`) para resolver
`Engine.Actions.Workspace.workspace_dir/1`, nunca recomputando o nome a
partir do id: as duas derivações (api e engine) são, na prática, a mesma
leitura contra o mesmo banco — é o que garante que RN-075 (escopo de
terminal) e RN-092 (leitura de código) continuam apontando para a MESMA
pasta que o engine realmente usa.

- **Onde:** `apps/api/src/db/schema.ts` (`projects.workspaceDirName`),
  `apps/api/src/db/migrations/0042_tough_captain_midlands.sql`,
  `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`workspaceDirNameFor`, `projectScopeRoot`),
  `apps/api/src/application/use-cases/iam/create-project.use-case.ts`,
  `apps/engine/lib/engine/projects/project.ex`
  (`workspace_dir_name/1`, `all_workspace_dirs/0`),
  `apps/engine/lib/engine/actions/workspace.ex` (`workspace_dir/1,2`),
  `apps/engine/lib/engine/dev/worktree_cleanup.ex`
- **Teste:**
  `apps/api/test/db/workspace-dir-name-migration.spec.ts` (trigger, backfill
  equivalente, unicidade),
  `apps/api/test/application/use-cases/iam/create-project-semeia-areas.spec.ts`
  (`workspaceDirName` nasce `<slug>-<8 chars>`, dois projetos com o mesmo
  slug em workspaces diferentes não colidem de pasta),
  `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
- **Borda:** o teto de paralelismo e o gate de merge não mudam — RN-109 é só
  NOME de pasta, nunca política. Renomear o slug depois da criação não
  renomeia a pasta; a pasta só se lê pelo `workspace_dir_name` gravado.
- **Origem:** ADR 0066 (revisa o ADR 0055).

### RN-129 — O ToolLoop nunca grava `agent.response` vazio; falha de transporte vira `agent.error` durável {#rn-129}

A [RN-059](#rn-059) fechou o balão vazio para os quatro agentes
conversacionais, mas eles não passam pelo `Engine.Harness.ToolLoop` — cada um
chama `EngineApiClient.llm_turn_stream/6` no próprio módulo. O `ToolLoop`
(usado por dev agents, QA Automação/Performance-Segurança, Infra-Workflows,
Anamnese e Psicólogo) tinha o MESMO defeito num caminho diferente: emitia
`agent.response` a cada iteração, mesmo quando o modelo só chamou ferramenta
sem texto, ou terminou o turno sem produzir nada — e a falha de transporte
(provider fora do ar, timeout) virava `agent.response` com `content` ausente,
igualmente indistinguível de sucesso.

Achado ao vivo numa sessão de execução real (dev agents): duas bolhas com o
texto de compatibilidade da RN-059 ("resposta vazia — evento anterior...")
apareceram numa sessão criada minutos antes — não eram eventos antigos, eram
o mesmo defeito acontecendo de novo, só que na aba de execução.

Duas correções, no ponto ESTRUTURAL comum a todo consumidor do `ToolLoop`,
não módulo por módulo:

1. **Conteúdo vazio nunca vira `agent.response`.** Iteração que só chamou
   ferramenta já está narrada por `tool.call`/`tool.result`; iteração que não
   produziu nada (nem texto, nem tool call) deixa o desfecho para quem chamou
   o loop decidir — `ctx.last_error`/`{:ok, ctx}` carregam a informação, e
   quem consome (ex.: `DevAgentServer.handle_outcome/4`) já grava o evento
   durável do PRÓPRIO domínio (`dev.blocked`, com `origem`).
2. **Falha de transporte vira `agent.error` durável**, com `origem`
   (`Engine.Agents.FalhaDeTurno.origem/1` — o MESMO helper que os quatro
   agentes conversacionais usam, sem duplicar classificação) e `mensagem` em
   português — nunca mais `agent.response` sem `content`.

- **Onde:** `apps/engine/lib/engine/harness/tool_loop.ex` (`loop/1`,
  `emit_falha/2`)
- **Teste:** `apps/engine/test/engine/harness/tool_loop_test.exs`
  ("iteração só com tool call (sem texto) não grava agent.response vazio",
  "modelo termina o turno sem texto e sem tool call...", "falha de
  transporte... grava agent.error durável com origem")
- **Origem:** RN-059 (regra que esta estende) — achado ao vivo numa sessão de
  execução real com dev agents

### RN-139 — A aba Executores lê a sessão de execução VIGENTE, nunca a mais recente do projeto {#rn-139}

`ProjectExecutorsTab` buscava os eventos de dev agent/QA pela sessão que
`useLatestSession` devolvia — a de `createdAt` mais recente do projeto, sem
filtrar por `kind` nem exigir `execution.activated`. Funcionava só por
**coincidência**: a sessão de execução costuma ser a mais nova. Assim que
qualquer sessão nasce depois dela — uma ideação nova, um chat consultivo — a
aba passa a olhar essa sessão nova, vazia de eventos de execução, em
silêncio: nenhuma pista na tela dizia qual sessão estava sendo exibida.

A leitura correta já existia no backend: `findActiveExecutionSession`
(`SessionRepository`) — a sessão `active` mais recente que carrega
`execution.activated` — mas só era usada internamente por
`ActivateExecutionUseCase` para decidir se reativa ou cria. A correção expõe
o MESMO critério por HTTP, em vez de duplicá-lo no front:

- **`GET /projects/:projectId/execution/session`** (`role:viewer`) devolve a
  sessão vigente ou `null` — nunca infere pela mais recente;
- `ProjectExecutorsTab` troca `useLatestSession` por `useActiveExecutionSession`
  (novo hook sobre a rota acima) como fonte da sessão que a aba inteira lê;
- o cabeçalho da aba sempre mostra QUAL sessão está sendo exibida — o rótulo
  dela (hashtag + nome) linkando para `SessionPage`, ou "Nenhuma execução
  ativa" quando `null` — nunca mais implícito. Os três estados da
  [RN-088](#rn-088) se aplicam à própria busca da sessão: carregando, erro
  (com `trace_id`) e vazio (`null`) são três renders distintos, nunca um
  `if (!sessão) return null` que os colapsa.

- **Onde:**
  `apps/api/src/application/use-cases/execution/get-active-execution-session.use-case.ts`,
  `apps/api/src/interfaces/http/execution/execution.controller.ts` (`getSession`),
  `apps/web/src/lib/hooks.ts` (`useActiveExecutionSession`),
  `apps/web/src/routes/ProjectExecutorsTab.tsx`
- **Teste:**
  `apps/web/src/routes/ProjectExecutorsTab.test.tsx` — mostra a sessão de
  execução mesmo com sessão mais recente existindo no projeto, estado
  "nenhuma execução ativa" explícito, e erro de rede tratado (não em branco)
- **Origem:** achado de investigação de código + teste ao vivo — a mesma
  classe de defeito que a RN-088 fechou para 429, agora para "qual sessão a
  tela está olhando"

### RN-141 — O conteúdo lido por `read_file` também tem teto de bytes {#rn-141}

A [RN-074](#rn-074) travou a saída do **terminal** contra
`{413, "request entity too large"}`, mas deixou aberta a mesma porta pelo
`read_file`: ele lia o arquivo INTEIRO, sem teto, e esse conteúdo entrava no
histórico do laço e viajava em todo turno seguinte. Um PR com arquivo grande
(lockfile, bundle, arquivo gerado) bastava pra travar dev agents E o QA de
Performance/Segurança — que só tem `ReadFile`/`SearchWorkspace` (sem
`Terminal`, de propósito) pra investigar uma PR, então não tinha rota de
escape nenhuma quando o arquivo era grande demais.

O conteúdo é cortado em `READ_FILE_MAX_BYTES` (default 32 KiB, mesmo valor da
RN-074 por coincidência de contexto, não por acoplamento — as duas variáveis
são independentes) antes de virar resultado da ferramenta, com marca dizendo
o arquivo e os dois tamanhos:

```
[arquivo package-lock.json truncado: mostrando 32768 de 1048576 bytes. Use
search_workspace para localizar um trecho específico em vez de reler o
arquivo inteiro.]
```

Mesmas três propriedades da RN-074 (teto é `>` não `>=`; corte não parte
caractere multibyte; a marca é endereçada ao modelo, dizendo o que fazer). A
truncagem mora na FERRAMENTA (`Engine.Harness.Tools.ReadFile`), não em
`Engine.Harness.WorkspaceFiles.read_file/2` — essa é a base genérica de
acesso a arquivo, compartilhada por `write_file`/`search_workspace`, e
truncar ali cortaria conteúdo de quem não precisa desse teto.

`search_workspace` não teve o mesmo tratamento: ele devolve só os PATHS que
bateram (`matched_content` é booleano), nunca o conteúdo do arquivo — o vetor
de estouro que motivou esta RN não se aplica a ele.

- **Onde:** `apps/engine/lib/engine/harness/tools/read_file.ex`
  (`truncate/2`), teto em `apps/engine/config/runtime.exs`
  (`read_file_max_bytes`)
- **Teste:** `apps/engine/test/engine/harness/tools/read_file_test.exs`
  (describe `teto de bytes do conteúdo`)
- **Origem:** achado ao vivo no event log de uma execução real — os 4 dev
  agents de um projeto e os QA de Automação/Performance-Segurança bloqueados
  com `{413, "request entity too large"}`, mesma causa raiz da RN-074, porta
  diferente

### RN-144 — A aba Criativo não lista a sessão de execução vigente {#rn-144}

A sessão que recebe `execution.activated` e os eventos de tool-call dos dev
agents precisa nascer com `kind: 'criativa'` — regra estrutural (RN-097,
`garantirQuePodeAtivarExecucao`), sem isso o evento é recusado. Como
`ProjectSessionsTab` (a aba Criativo, RN-104) lista sessões filtrando só por
`session.kind === 'criativa'`, a sessão de execução aparecia MISTURADA na
lista ao lado de ideações de verdade — abrir ela em `SessionPage.tsx` mostra
uma timeline inteira de tool-calls de dev agent, parecendo (pro usuário) "o
dev escrevendo no chat do Criativo". Confirmado ao vivo: uma sessão real com
35+ eventos de dev agent aparecia normal na lista, ao lado de sessões reais
de ideação.

A correção reusa o sinal que a [RN-139](#rn-139) já expõe —
`useActiveExecutionSession`/`GET /projects/:projectId/execution/session` — em
vez de o backend calcular um campo novo por sessão (`hasExecutionActivated`
ou equivalente). A aba Criativo busca a sessão vigente e a exclui da lista
renderizada:

- a busca só roda na aba Criativo (`enabled` desligado em `kind !==
  'criativa'`) — a aba Chat nunca fez essa chamada e continua sem fazer;
- o filtro é por `id`, depois do filtro por `kind` já existente — não muda o
  que a lista É, só o que ela EXCLUI.

**Decisão deliberada de escopo:** isto cobre só a execução VIGENTE, não
execuções ANTIGAS já encerradas (`execution.activated` gravado numa sessão
que hoje está `closed`). Calcular isso pediria o backend anotar, por sessão,
se ela tem o evento gravado — mudança no repositório e no endpoint de
listagem, para um caso residual: uma sessão de execução ANTIGA aparece com o
badge `closed`, o que já sinaliza "não é uma ideação ativa" de um jeito bem
menos ambíguo do que a vigente (que aparecia `active`, indistinguível de uma
ideação em andamento). Se isso voltar a confundir na prática, a saída é o
endpoint de listagem devolver o sinal por sessão — não um `filter` a mais no
front por sessão antiga.

- **Onde:** `apps/web/src/routes/ProjectSessionsTab.tsx`
  (`ProjectSessionsTab`)
- **Teste:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — a vigente
  some da lista Criativo com sessões normais ao lado, a aba Chat não chama a
  busca de execução vigente, e sem execução vigente (`null`) a lista aparece
  inteira
- **Origem:** achado de investigação de código + teste ao vivo — sessão real
  com execução ativa aparecendo misturada na aba Criativo

### RN-145 — O Arquiteto também tem um botão de prontidão, e a MESMA confirmação oferece Infra e Dev Lead {#rn-145}

`OfferInfraHandoffUseCase` (`POST .../agents/arquiteto/handoff-infra`) já
existia desde a Fase 4a — grava `architecture.readiness_confirmed` e chama o
engine, que oferece o handoff ao Infra e, na MESMA confirmação, ao Dev Lead
(FASE 14d/ADR 0053). O que faltava era o jeito de chegar até ele: nenhum
lugar do frontend chamava o endpoint. O botão "Confirmar arquitetura pronta"
existe pro Criativo desde sempre ("Estou pronto para produzir",
[RN-131](#rn-131)/[RN-142](#rn-142)) — o Arquiteto não tinha equivalente
nenhum, e sem o clique o handoff nunca nascia: a correção de prioridade do
card no fio ([RN-125](#rn-125)) ficava sem efeito prático, porque não havia o
que mostrar.

`arquitetoActive` espelha `criativoActive` (existe um `agent.activated` pro
Arquiteto nesta sessão) e `arquiteturaJaDeclarada` espelha
`prontidaoJaDeclarada` (existe QUALQUER handoff saindo do Arquiteto — a prova
de que a confirmação já aconteceu, já que `OfferInfraHandoffUseCase` cria
pelo menos o de Infra na mesma chamada). O botão aparece no composer só
quando o primeiro é verdadeiro e o segundo não é — some depois do clique
pelo mesmo motivo que o do Criativo some depois da prontidão.

Ao contrário do Criativo, o Arquiteto NÃO tem guardrail de servidor
bloqueando a confirmação sem `module_map` — `ArquitetoServer.offer_infra_handoff`
não recusa nada, diferente de `CriativoServer.confirm_readiness`
([RN-142](#rn-142)). O botão só desabilita durante `streaming`; não replicar
aqui o `disabled={!hasModuleMap}` da Visão Geral é decisão deliberada, pelo
mesmo raciocínio que já vale para "Ativar execução" no card do Dev Lead
([RN-137](#rn-137)) — quando este card existe, o Arquiteto já decidiu a
arquitetura.

- **Onde:** `apps/api/src/interfaces/http/agents/agents.controller.ts`
  (`handoffInfra`, rota preexistente), `apps/web/src/lib/api-client.ts`
  (`confirmArchitectureReadiness`), `apps/web/src/routes/SessionPage.tsx`
  (`arquitetoActive`, `arquiteturaJaDeclarada`, `handleArchitectureReadiness`,
  botão "Confirmar arquitetura pronta")
- **Teste:**
  `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`, describe
  "problema 1" — botão ausente sem o Arquiteto ativo, caminho feliz chama o
  endpoint dedicado, falha mostra toast de erro, e o botão some com a
  arquitetura já declarada
- **Origem:** investigação de código — o endpoint e a lógica do engine
  existiam desde a Fase 4a/14d sem NENHUM caminho de UI até eles

### RN-146 — `agent.response` carrega o nome do modelo que gerou a resposta {#rn-146}

O nome do modelo só existia em `token_usage`, sem vínculo com o evento
`agent.response` específico que ele produziu — `SessionPage.tsx` mostrava a
string FIXA `"modelo"` ao lado do nome do agente, nunca o nome real.

A mudança atravessa as três camadas, todas com o MESMO nome de campo
(`modelName`), para que não seja preciso traduzir entre elas:

1. **api** — `StreamLlmTurnUseCase`/`RunLlmTurnUseCase` já resolviam o
   modelo (`resolveModelBinding` → `models.findById`) para chamar o
   provider; o frame `final`/`RunLlmTurnResult` ganham `modelName: string |
   null`. `null` só quando o turno falhou ANTES de resolver um modelo (sem
   binding, ou binding para modelo inexistente) — nos demais casos,
   inclusive orçamento excedido, o binding já tinha resolvido e o nome
   viaja mesmo no frame de erro.
2. **engine** — os quatro agentes conversacionais (`criativo_server.ex`,
   `po_server.ex`, `arquiteto_server.ex`, `dev_lead_server.ex`) extraem
   `Map.get(frame, "modelName")` do frame `final` e o incluem no payload de
   `emit_response`/`agent.response` (`%{content: content, modelName:
   model_name}`).
3. **web** — `SessionPage.tsx` lê `event.payload.modelName`. Evento
   GRAVADO antes desta mudança não tem a chave (`undefined`), e um turno
   cuja api não resolveu modelo nenhum grava `null` — os dois degradam para
   o rótulo genérico `"modelo"`, nunca para `undefined`/`null` na tela; o
   mesmo padrão que `text === ''` já usa para resposta anterior à RN-059.

- **Onde:** `apps/api/src/application/use-cases/llm/stream-llm-turn.use-case.ts`
  (`LlmTurnStreamEvent`), `apps/api/src/application/use-cases/llm/run-llm-turn.use-case.ts`
  (`RunLlmTurnResult`), `apps/api/src/interfaces/http/internal/dto/internal.response.dto.ts`
  (`LlmTurnResponseDto`/`LlmTurnStreamEventResponseDto`),
  `apps/engine/lib/engine/agents/{criativo,po,arquiteto,dev_lead}_server.ex`
  (`emit_response/3`), `apps/web/src/routes/SessionPage.tsx` (bloco
  `agent.response` da timeline)
- **Teste:** `apps/api/test/application/use-cases/llm/run-llm-turn.use-case.spec.ts`,
  `apps/api/test/application/use-cases/llm/stream-llm-turn.use-case.spec.ts`
  (`modelName` no caminho feliz, no erro do provider e sem binding),
  `apps/engine/test/engine/agents/{criativo,po,arquiteto,dev_lead}_server_test.exs`
  (`agent.response` carrega o nome do modelo; borda do frame sem a chave),
  `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`, describe
  "problema 2" — nome real, evento antigo sem a chave, `modelName: null`
- **Origem:** investigação de código — confirmado que o dado já existia em
  `token_usage`, mas nunca chegava ao payload do evento

### RN-147 — O cabeçalho do grupo colapsado mostra o ícone do agente, não só o nome {#rn-147}

O `Disclosure` de `timelineAgrupada` ([RN-138](#rn-138)) recebia só a STRING
do nome em `titulo` — cada mensagem expandida já tem um avatar (`.avatar` +
ícone), e o cabeçalho colapsado perdia essa pista visual justamente onde ela
mais ajuda a escanear o fio.

`AvatarDoAgente` reusa a MESMA caixa `.avatar` das mensagens expandidas, mas
o ícone escolhido é o do ROSTER (`AGENTS[id].icon`) — a mesma fonte que já
identifica "quem está falando" no indicador de streaming (`agenteExibido.icon`,
[RN-131](#rn-131)) — e não o ícone por TIPO de evento que cada entrada
expandida usa (`ModelIcon` em `agent.response`, `StackIcon` em
`backlog.*_created`, `AlertCircleIcon` em `agent.error`). Um grupo colapsado
pode misturar esses tipos de entrada de um mesmo agente; o cabeçalho
representa o AGENTE, não a última entrada dele, e só o ícone do roster é
estável para isso. Sem `id`, ou agente fora do roster, degrada para
`ModelIcon` — nunca para uma caixa vazia.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`AvatarDoAgente`,
  `timelineAgrupada`), `apps/web/src/routes/SessionPage.module.css`
  (`.agentGroupTitulo`)
- **Teste:** `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`,
  describe "problema 3" — o cabeçalho colapsado tem o PATH do ícone do PO
  (`UserIcon`), não só um SVG decorativo genérico
- **Origem:** investigação de código — `Disclosure` já aceitava `ReactNode`
  em `titulo`; faltava passar o avatar junto do nome

### RN-148 — Histórias com promoção pendente ao mesmo tempo viram carrossel, não N cards {#rn-148}

O PO cria histórias uma a uma, e cada `backlog.story_promotion_proposed`
([RN-126](#rn-126)) virava um card avulso na timeline — numa leva de várias
histórias, isso empilhava N cards idênticos disputando o mesmo espaço,
misturados com o resto da narração.

Uma **leva** é o conjunto de propostas de promoção AINDA PENDENTES na
sessão, avaliado a cada render — não "criadas em sequência sem
interrupção". O critério é o MESMO que cada card avulso já usava sozinho
para decidir se virou card acionável ou divisor (nenhum
`backlog.story_transitioned`/`backlog.story_promotion_returned` posterior
com o mesmo `storyId`), só que olhado de uma vez para a sessão inteira:

- **0 ou 1 pendente:** nada muda — card avulso de sempre (a degradação é
  deliberada: um carrossel de um slide só não ganha nada virando carrossel).
- **2+ pendentes ao mesmo tempo:** viram UM `Carousel` (novo no design
  system, `apps/web/src/components/ui/Carousel.tsx`), inserido na posição
  da PRIMEIRA proposta ainda pendente; as demais somem como card
  individual — cada uma vira um SLIDE dele. Cada slide mostra a mesma
  frase do card avulso ("história … pronta, aguardando sua promoção"), um
  resumo/RF se o payload trouxer (hoje não traz — ver abaixo), e os botões
  Promover/Devolver daquela história específica, chamando os MESMOS
  `promoteStories`/`returnStory` de sempre.
- **"Aprovar todas"** no cabeçalho do carrossel chama `promoteStories` com
  os ids de TODAS as pendentes numa chamada só — o endpoint já era lote
  (`promoteStories(projectId, storyIds[])`, RN-048), então não houve mudança
  de contrato nenhuma, só de quem monta a lista.
- Uma história resolvida (promovida ou devolvida) enquanto o carrossel está
  aberto sai da leva no próximo render (a query de eventos é invalidada nas
  duas ações) — se sobrar só 1 pendente, o carrossel se desfaz sozinho e o
  card volta a ser avulso.

`resumo`/RF no slide é campo PRONTO, não usado: `CreateStoryUseCase` hoje só
grava `storyId`/`epicId`/`title` no payload de `backlog.story_promotion_proposed`
— sem descrição nem requisitos funcionais. O slide já sabe exibir
`description`/`rf` se o payload um dia carregar (degrada pro título sozinho
até lá); estender o payload ficou fora desta entrega, por não ter sido
pedido.

- **Onde:** `apps/web/src/components/ui/Carousel.tsx` (componente novo,
  navegação genérica), `apps/web/src/routes/SessionPage.tsx`
  (`promocoesPendentes`, `ehLevaDeHistorias`, `StorySlide`,
  `handlePromoteAll`), `apps/web/src/routes/SessionPage.module.css`
  (`.storySlide`)
- **Teste:** `apps/web/src/components/ui/Carousel.test.tsx` (navegação,
  ARIA, só o slide atual montado, índice clampado quando a lista encolhe),
  `apps/web/src/routes/SessionPage.carrossel-historias.test.tsx` (3+
  pendentes viram carrossel; "Aprovar todas" manda o lote inteiro; promoção
  e devolução unitárias continuam funcionando a partir de um slide
  navegado; 1 pendente degrada pro card simples; história resolvida sai da
  leva e o carrossel recalcula a contagem)
- **Origem:** pedido do usuário — histórias produzidas em lote pelo PO
  ficavam difíceis de decidir uma por uma no fio

### RN-149 — O Container level do diagrama C4 é derivado do module_map, nunca redigitado pelo modelo {#rn-149}

`create_c4_diagram` (ferramenta nova do Arquiteto) gera as duas sintaxes
Mermaid do diagrama C4 (Context + Container, modelo de Simon Brown). O tool
call carrega só `system_name`/`system_description`/`actors` — os módulos e
as dependências do nível Container NÃO fazem parte da entrada: o caso de uso
busca o `module_map` VIGENTE do projeto (`ModuleMapRepository.findCurrent`,
mesma leitura de `GetArchitectureUseCase`) e deriva o Container level dele,
com os MESMOS nomes e dependências que `create_module_map` já validou sem
ciclo.

A alternativa óbvia — deixar o modelo descrever os módulos de novo no tool
call do diagrama, como ele já faz para `create_module_map` — foi descartada
de propósito: um segundo lugar onde o modelo escreve "os módulos são X, Y,
Z" é um segundo lugar onde essa lista pode divergir da primeira, e a
divergência seria SILENCIOSA — nada recusaria um diagrama com um módulo que
não existe mais no mapa real. Derivar do repositório fecha essa divergência
por construção: o diagrama pode ficar DESATUALIZADO se o `module_map` mudar
depois (reemitir é gerar de novo, sem trava — ver ADR 0068), mas nunca
MENTE sobre o que existia no momento em que foi gerado.

Sem `module_map` vigente, `create_c4_diagram` é recusado com 400 — não há
Container level sem módulos para desenhar, e a mensagem de erro instrui o
Arquiteto a chamar `create_module_map` primeiro (RN-061: a recusa volta
pelo tool-result, com o motivo inteiro).

O artefato `artifact.c4_diagram` é versionado no event log sem tabela
própria — mesmo desenho de `artifact.project_image` (ADR 0065): o vigente é
o de maior `version`, e revisar é gerar de novo, nunca sobrescrever.

- **Onde:** `apps/api/src/domain/architecture/c4-diagram.ts`
  (`gerarDiagramaContexto`/`gerarDiagramaContainer`, puras),
  `apps/api/src/application/use-cases/architecture/create-c4-diagram.use-case.ts`,
  `apps/api/src/application/use-cases/architecture/get-c4-diagram.use-case.ts`,
  `apps/engine/lib/engine/harness/tools/create_c4_diagram.ex`,
  `apps/web/src/components/C4DiagramView.tsx` (renderização, três estados —
  RN-088), `apps/web/src/lib/mermaid-render.ts` (o `mermaid` fica isolado
  aqui, `import()` dinâmico)
- **Teste:** `apps/api/test/domain/architecture/c4-diagram.spec.ts` (sintaxe
  Mermaid válida a partir de um `module_map` de exemplo, aresta pendurada
  ignorada, ids deduplicados),
  `apps/api/test/application/use-cases/architecture/create-c4-diagram.use-case.spec.ts`
  (sem module_map recusa com 400 e não grava nada; Container reflete os
  módulos/dependências reais; versiona ao reemitir),
  `apps/engine/test/engine/harness/tools/create_c4_diagram_test.exs`,
  `apps/web/src/components/C4DiagramView.test.tsx` (sucesso vira SVG, erro
  de sintaxe vira Alert legível sem quebrar a tela, diagrama vazio não tenta
  renderizar)
- **Origem:** pedido do usuário — diagrama C4 do Arquiteto na Visão Geral do
  projeto (ADR 0068)

### RN-150 — `search_workspace` tem teto de QUANTIDADE de hits e de BYTES, cada um com sua marca {#rn-150}

Achado numa revisão de PR: `search_workspace` (dev agents e os dois agentes
de QA/gate, `qa_tools.ex` e `qa_performance_seguranca_agent.ex` — este
último só tem `read_file`/`search_workspace`, sem `Terminal`, de propósito)
devolvia TODOS os resultados da busca, sem teto nenhum — mesma classe do
achado S (`Engine.Actions.TerminalExecutor.truncate/2`) e da correção de
`read_file` (`Engine.Harness.Tools.ReadFile.truncate/2`): o resultado fica
no histórico do laço e viaja em todo turno seguinte, e uma árvore grande
basta pra estourar `{413, "request entity too large"}` do provider.

Dois tetos independentes, porque a busca estoura de duas formas diferentes:

1. **Quantidade de hits** — uma árvore com milhares de arquivos batendo o
   termo produz milhares de linhas `- caminho` mesmo que nenhum arquivo
   individual seja grande. Truncar só por BYTES no fim ainda pagaria o custo
   de escanear e ler o conteúdo de cada um desses arquivos antes de montar a
   string. Por isso o teto de quantidade (`SEARCH_WORKSPACE_MAX_HITS`,
   default 500) vive em `WorkspaceFiles.search/3`, que já PARA de consumir a
   busca assim que encontra hit suficiente — o pipeline roda sobre um
   `Stream`, e `Enum.take(stream, max_hits + 1)` só lê da fonte o que
   precisa pra produzir os `max_hits + 1` primeiros resultados. O "+1" é o
   que permite dizer que HAVIA mais sem continuar escaneando o resto pra
   contar o total exato — contar o total pagaria de novo o I/O que o teto
   existe pra evitar, então a marca diz "mostrando os N primeiros" e nunca
   inventa um total.
2. **Bytes do texto final** — mesmo com hits limitados, caminhos muito
   longos podem produzir uma string grande. Teto de bytes
   (`SEARCH_WORKSPACE_MAX_BYTES`, default 32.768), mesmo padrão de
   `terminal_output_max_bytes`/`read_file_max_bytes` — variável PRÓPRIA,
   não reaproveita as outras duas: mesma classe de estouro, divergir uma não
   deve exigir tocar as outras.

A marca de truncagem é dirigida ao MODELO, não ao humano: diz o que foi
cortado (hits e/ou bytes) e instrui a refinar o termo da busca — mesmo
espírito das marcas de `TerminalExecutor`/`ReadFile`.

- **Onde:** `apps/engine/lib/engine/harness/workspace_files.ex`
  (`search/3`, `take_capped/2`),
  `apps/engine/lib/engine/harness/tools/search_workspace.ex`
  (`truncate/3`, `marca_de_truncagem/5`),
  `apps/engine/config/runtime.exs` (`search_workspace_max_hits`,
  `search_workspace_max_bytes`)
- **Teste:** `apps/engine/test/engine/harness/workspace_files_test.exs`
  (`search/3` com `max_hits` corta a QUANTIDADE e marca truncagem só
  quando há mais que o teto),
  `apps/engine/test/engine/harness/search_workspace_test.exs` (busca com
  poucos resultados não é alterada; busca com mais hits que o teto é
  truncada com aviso claro; texto final maior que o teto de bytes também é
  cortado)
- **Origem:** achado de revisão de PR — segunda causa real do 413 em
  revisões, depois da correção de `read_file`

---

### RN-151 — O badge de projeto na sidebar é aprovações pendentes, não atividade não lida {#rn-151}

O número ao lado do nome de cada projeto em `Shell.tsx` vinha de
`useProjectsUnread` — `latestSeq` (o `seq` mais recente já gravado na sessão)
menos o cursor de "última vez visto" que o navegador guarda em
`read-state.ts`. Isso conta QUALQUER evento novo — `tool.call`,
`agent.response`, chat — não só decisão pendente. Um projeto de teste
mostrava "392" na sidebar (atividade acumulada de uma execução real) enquanto
a aba Aprovações do MESMO projeto mostrava "8" (a contagem de verdade). Um
número que não corresponde a nada acionável ao clicar é pior que nenhum.

O read model do dashboard (`ProjectsSummaryRepository.summarizeForWorkspace`,
RN-090) ganhou `pendingApprovalsCount`: `COUNT(*)` de `proposed_actions` com
`status = 'pending'`, agregado por `project_id` numa consulta a mais no
`Promise.all` já existente — mesmo formato de `storiesAwaitingPromotion`
(RN-048), sem crescer o número de idas ao banco por projeto. A soma é do
projeto INTEIRO, todas as sessões — de propósito diferente da aba Aprovações
(`ProjectApprovalsTab.tsx`), que mostra só as pendências da sessão MAIS
RECENTE: o badge é por PROJETO, não por sessão, e uma pendência numa sessão
antiga continua sendo uma pendência.

`Shell.tsx` parou de importar `useProjectsUnread` — o único consumidor dele
ali era este badge. `Dashboard.tsx`/`ProjectCard.tsx` ganharam o mesmo fio:
o prop `unreadCount` de `ProjectCard` nunca tinha chamador (`ProjectCardContainer`
não o passava), e virou `pendingApprovalsCount` com o mesmo valor da sidebar
— duas telas, um número, uma fonte.

- **Onde:** `apps/api/src/application/ports/projects-summary-repository.port.ts`
  (`ProjectCardSummary.pendingApprovalsCount`),
  `apps/api/src/infrastructure/persistence/drizzle/projects-summary.repository.ts`
  (`summarizeForWorkspace`, consulta agregada sobre `proposed_actions`),
  `apps/web/src/routes/Shell.tsx`, `apps/web/src/routes/Dashboard.tsx`,
  `apps/web/src/components/ProjectCard.tsx`
- **Teste:**
  `apps/api/test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  (`pendingApprovalsCount soma o projeto INTEIRO...`, só `pending` conta, não
  vaza entre projetos, número de consultas continua constante),
  `apps/web/src/routes/Shell.test.tsx` (badge de aprovações pendentes)
- **Origem:** achado do usuário navegando a app — badge da sidebar mostrando
  "392" contra "8" de verdade na aba Aprovações do mesmo projeto

---

### RN-152 — A branch de uma task diz de qual dev agent e módulo ela é, no dropdown da aba Code {#rn-152}

`CodeBranchPicker` já listava toda branch do repositório, inclusive as dos
dev agents (`feature/task-XXXXXXXX`, `Engine.Dev.AgentIo`), mas sem pista
nenhuma de quem a criou — só o nome cru. `ReadProjectCodeUseCase.branches`
resolve isso sem chamada a mais ao provider de git: os 8 chars depois de
`feature/task-` são exatamente o primeiro grupo hifenizado do uuid da task
(`"feature/task-" <> String.slice(to_string(row.task_id), 0, 8)`, não um
substring arbitrário), então casam contra `TaskRepository
.findByProjectAndIdPrefix` (join por PROJETO, pra prefixo de 8 chars nunca
vazar task de outro projeto). O `assignedTo` da task é o agent_id
(`dev-<modulo>`/`dev-<modulo>-2`, RN-087); o módulo é resolvido comparando
contra o `module_map` VIGENTE do projeto pelas MESMAS funções que o geraram
(`devAgentId`/`extraDevAgentId` em `activate-execution.use-case.ts`) — nunca
por regex reversa, que degeneraria em ambiguidade pra nome de módulo com
caractere especial.

`producedBy: { agentId, moduleId } | null` é degradação honesta, do mesmo
jeito que `ahead`/`behind` já são: `null` pra branch sem o padrão (manual do
usuário, ou `main`/`dev`/`qa`), e também quando o padrão bate mas a
task/módulo não são mais resolvíveis (task apagada, módulo removido do mapa
vigente) — nunca um valor inventado. No dropdown, cada branch produzida por
um dev ganha o ícone e a cor do agente (`AGENTS`/`agents.ts`, RN-087),
reaproveitando a MESMA degradação que `apps/web/src/lib/agent-status.ts` já
usa pro roster ao vivo: módulo sem chave fixa em `AGENTS` herda ícone/cor de
`dev-backend`.

- **Onde:** `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (`branches`/`producedBy`/`moduloDoAgente`),
  `apps/api/src/application/ports/backlog-repository.port.ts`
  (`TaskRepository.findByProjectAndIdPrefix`),
  `apps/api/src/infrastructure/persistence/drizzle/backlog.repository.ts`,
  `apps/api/src/interfaces/http/git/dto/code.response.dto.ts`
  (`CodeBranchProducedByResponseDto`), `apps/web/src/lib/api-types.ts`
  (`CodeBranchProducedBy`), `apps/web/src/routes/code/CodeBranchPicker.tsx`
  (`IconeDoAgenteProdutor`/`defDoAgenteProdutor`)
- **Teste:**
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (describe "producedBy da branch de task" — task resolvida com módulo e com
  o agente extra `-2`, branch fora do padrão nunca ganha `producedBy` mesmo
  com task de prefixo casável, prefixo sem task no projeto, módulo removido
  do mapa vigente e task sem dono ainda degradam pra `null`),
  `apps/web/src/routes/code/CodeBranchPicker.test.tsx` (branch de task mostra
  o selo do dev agent dono; branch sem padrão não ganha selo nenhum)
- **Origem:** pedido do usuário — nenhuma pista visual de quem criou a
  branch no dropdown rico da FASE 26b

### RN-153 — "Auto mode": o `ApprovalCard` liga autonomia pra QUALQUER ação futura de um agente {#rn-153}

Antes deste RN, `agent_autonomy` só sabia conceder autonomia por
`(projeto, agente, TIPO de ação)` — uma linha por tipo, upsert de UMA regra
por vez (`SetAgentAutonomyUseCase`,
`apps/api/src/application/use-cases/actions/set-agent-autonomy.use-case.ts`).
Confiar amplamente num agente exigia uma linha por tipo — `terminal`,
`write_file`, `pr_open`… — e tipo novo nascia sem regra, de volta a
`require_approval`.

"Auto mode" é o valor especial `actionType: "*"` na MESMA tabela e no MESMO
endpoint (`PUT /projects/:projectId/agent-autonomy`) — não é mecanismo novo,
é a coluna existente (`agent_autonomy.action_type`, `text` livre, sem enum
nem FK — `apps/api/src/db/schema.ts`) aceitando um valor a mais. A curinga
significa "autonomia pra qualquer tipo de ação DESTE agente" e é resolvida
em `DrizzleAgentAutonomyRepository.findMode`
(`apps/api/src/infrastructure/persistence/drizzle/agent-autonomy.repository.ts`):
busca a regra ESPECÍFICA e a curinga na mesma consulta, e a específica
sempre vence — gravar `terminal: deny` com `"*": auto_approve` já ligado
continua negando `terminal` desse agente, e liberando o resto. `decide()`
(`apps/api/src/domain/actions/decide.ts`) não muda: ele recebe o
`PermissionPolicy` já resolvido em `ctx.autonomyMode`, exatamente como antes
da curinga existir — é por isso que os tetos absolutos valem sem precisar
saber que "auto mode" existe (ver [RN-154](#rn-154)).

O `ApprovalCard` (`apps/web/src/components/ApprovalCard.tsx`) ganha o botão
"Modo automático" ao lado de "Sempre permitir", visível só quando: (a) a
ação está `pending`, (b) quem propôs é um AGENTE (`actor.kind === 'agent'` —
não há autonomia de agente para conceder a um usuário) e (c) quem chama
(`ProjectApprovalsTab.tsx`/`SessionPage.tsx`) já confirmou papel
`maintainer`/`owner` no workspace — mesma exigência do endpoint
(`@RequireRole('maintainer')`, inalterado). O prop `onActivateAutoMode` é
`undefined` para quem não tem o papel — o card ESCONDE o botão em vez de
mostrá-lo desabilitado, e a checagem mora em quem chama, não no card
(componente presentational, sem query própria).

**Desligar** reusa o toggle manual/auto que o card do agente já tinha (Fase
8d) — nenhuma tela nova. `AgentTeamGrid.tsx` passa a procurar a regra
curinga do agente ANTES da representativa (`autonomyActionTypeFor`): se
existir, o toggle do card reflete e edita a CURINGA, não mais o tipo
representativo — desligar é gravar a mesma curinga como
`require_approval`, e o toggle no card do agente é exatamente esse
"desligar".

- **Onde:** `apps/api/src/domain/actions/decide.ts`
  (`AGENT_AUTONOMY_ALL_ACTIONS`, `AgentAutonomyActionType`),
  `apps/api/src/infrastructure/persistence/drizzle/agent-autonomy.repository.ts`
  (`findMode` com precedência específica > curinga),
  `apps/api/src/interfaces/http/actions/dto/set-agent-autonomy.dto.ts`
  (aceita `"*"`), `apps/web/src/components/ApprovalCard.tsx` (botão "Modo
  automático"), `apps/web/src/components/AgentTeamGrid.tsx` (toggle
  passa a priorizar a curinga), `apps/web/src/routes/ProjectApprovalsTab.tsx`
  e `apps/web/src/routes/SessionPage.tsx` (`handleActivateAutoMode`, gate de
  papel via `useCurrentWorkspaceWithRole`)
- **Teste:**
  `apps/api/test/infrastructure/persistence/drizzle/agent-autonomy.repository.spec.ts`
  (precedência específica > curinga; curinga é por agente; desligar é
  regravar a curinga como `require_approval`),
  `apps/api/test/application/use-cases/actions/propose-action.use-case.spec.ts`
  (auto mode auto-aprova ação comum SEM bater em `permissions.json`; regra
  específica em `deny` vence a curinga),
  `apps/api/test/interfaces/http/actions/agent-autonomy.controller.spec.ts`
  (`PUT`/`GET` continuam exigindo `maintainer`; DTO aceita `"*"` e recusa
  string fora da lista), `apps/web/src/components/ApprovalCard.test.tsx`
  (botão some sem `onActivateAutoMode`; clique chama o callback; nota
  explica os tetos que continuam pedindo decisão)
- **Origem:** pedido do usuário — "Sempre permitir" só grava um padrão de
  comando específico, e `agent_autonomy` só cobria um tipo de ação por vez;
  faltava confiar amplamente num agente com um clique só

### RN-154 — Os três tetos absolutos continuam bloqueando MESMO com "auto mode" ligado {#rn-154}

O desenho do "auto mode" ([RN-153](#rn-153)) é deliberadamente incapaz de
furar os três tetos que já existiam em `decide()` — eles são aplicados por
ÚLTIMO, sobre `current.policy`, sem olhar de onde veio a permissividade
(`agent_autonomy` com tipo específico, curinga, ou `permissions.json` — a
função nunca soube distinguir as origens, e continua sem saber):

1. **Merge em branch protegida** (`git_merge` com destino em
   `dev`/`qa`/`rc`/`main`, [RN-006](#rn-006)) — a trava de merge
   (`isProtectedBranch`) rebaixa `auto_approve` para `require_approval`
   sempre, mesmo com `"*": auto_approve` ligado pro agente.
2. **`instruction_patch`** ([RN-007](#rn-007)) — mudar a instrução de outro
   agente exige o humano ver o diff; auto mode não muda isso.
3. **`parallelize`/`raise_max_parallel`** ([RN-086](#rn-086)) — subir o
   teto de paralelismo, ou pedir mais agente acima dele, continua decisão
   do usuário; um agente com auto mode ligado não consegue se auto-conceder
   mais poder de gasto.

A prova é por CONSTRUÇÃO, não por caso a caso: como os três tetos verificam
só `current.policy === 'auto_approve'` — nunca a origem —, e "auto mode" só
consegue chegar em `current.policy === 'auto_approve'` pelo MESMO caminho
que uma regra específica de `agent_autonomy` já usava
(`ctx.autonomyMode`), os tetos que já continham `agent_autonomy` continuam
contendo a curinga sem precisar de código novo. O risco real não era o
teto — era alguém, ao generalizar `agent_autonomy` pra aceitar `"*"`,
inserir a checagem da curinga ANTES dos tetos e reabrir a porta; por isso
`AGENT_AUTONOMY_ALL_ACTIONS` foi resolvido inteiramente no REPOSITÓRIO
(antes de `decide()` rodar), e `decide()` em si não ganhou nenhuma linha
nova — só o suficiente pra não ter onde a curinga furar.

- **Onde:** `apps/api/src/domain/actions/decide.ts` (os três blocos de teto,
  linhas ~207–258, inalterados por esta feature)
- **Teste:**
  `apps/api/test/application/use-cases/actions/propose-action.use-case.spec.ts`
  ("auto mode NÃO auto-aprova merge em branch protegida", "... instruction_patch",
  "... parallelize/raise_max_parallel" — os três com `agent_autonomy` "*"
  gravado como `auto_approve` e o veredito continuando `require_approval`)
- **Origem:** restrição de design confirmada pelo usuário ao pedir o "auto
  mode" — os três tetos são a garantia que não pode regredir

### RN-155 — ordenação da timeline usa o vínculo `proposed_action.created`, nunca `action.seq` cru {#rn-155}

A `timeline` de `SessionPage.tsx` ordena eventos e ações propostas por um
único eixo numérico comparável. Para eventos, é `event.seq` (gapless, por
sessão). Para ações, é o `seq` do evento `proposed_action.created` correlato
(achado por `payload.actionId === action.id`, gravado por
`ProposeActionUseCase` na MESMA transação que cria a ação) — nunca
`action.seq`, que é `bigserial` único e global de toda a tabela
`proposed_actions`, compartilhado por todas as sessões e projetos do
sistema, e portanto incomparável com `event.seq` (contraste deliberado, ver
`apps/api/src/db/schema.ts`). Comparar os dois direto produzia ordem
imprevisível toda vez que um `ApprovalCard` entrava na mistura com eventos
normais. Ações sem esse vínculo (só o bootstrap de Gitflow —
`git_repo_create`/`git_branch_create`, que gravam apenas outbox) degradam
para uma posição interpolada por `createdAt`, ancorada no último evento
anterior.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`ordemDaAcaoNaTimeline`)
- **Teste:** `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
- **Origem:** achado de PR #286 — cards de aprovação apareciam fora de ordem
  na timeline, misturados com eventos normais

### RN-156 — indicador de espera de 5s tem texto fixo, sem interpolar o agente {#rn-156}

O indicador que aparece depois de 5s sem resposta (`pensandoVisivel`) mostra
a frase fixa "Reunindo informações...", sem o nome do agente interpolado —
substitui o texto anterior "{Agente} está escrevendo…". O nome do agente já
é visível no cabeçalho assim que o streaming de texto real começa; repeti-lo
no indicador de espera não ajudava a leitura.

- **Onde:** `apps/web/src/routes/SessionPage.tsx`
- **Teste:** `apps/web/src/routes/SessionPage.pista-e-status.test.tsx`,
  `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
- **Origem:** achado de PR #286 — o texto anterior nomeava um agente que já
  estava visível no cabeçalho

### RN-157 — criação de épico/história pelo PO vira aviso compacto, não bolha completa {#rn-157}

Os eventos `backlog.epic_created`/`backlog.story_created` deixam de
renderizar como bolha completa de mensagem (`.message`/`.bubble`, avatar de
32px — o mesmo peso visual de uma resposta de agente de verdade) e passam a
usar o mesmo formato de aviso compacto que `.handoffDivider`/`.handoffPill`
já usa para a passagem de bastão: linha centralizada com filete horizontal e
pílula compacta, mantendo o link "Ver no Backlog". `agentId` continua
populado no `TimelineEntry` — ao contrário do divisor de handoff, isto não
marca uma transição entre agentes, é uma ação do PO dentro do próprio turno
dele, e segue elegível ao colapso por agente ([RN-138](#rn-138)).

- **Onde:** `apps/web/src/routes/SessionPage.tsx`
- **Teste:** `apps/web/src/routes/SessionPage.handoff-inline-e-links.test.tsx`,
  `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
- **Origem:** achado de PR #286 — a bolha completa tinha peso visual igual a
  uma resposta de agente de verdade, para uma ação de metadado do PO

### RN-158 — Markdown leve com highlight no chat {#rn-158}

`agent.response` no fio da Sessão renderiza um subconjunto de Markdown
(negrito `**texto**`, itálico `*texto*`/`_texto_`, código inline
`` `texto` ``, cabeçalho `#`/`##`/`###`, lista `-`/`1.`, link
`[texto](url)` e fence de código ```` ```linguagem ````), via parser
próprio por regex (`apps/web/src/lib/markdown.ts`), sem dependência nova.
`chat.message` (texto digitado pelo usuário) permanece literal — Markdown
só se aplica à SAÍDA de um agente/LLM, nunca à entrada humana.

Segurança: o parser nunca produz HTML — devolve uma árvore de dados que
`MarkdownMessage.tsx` converte em elementos React diretamente (nunca
`dangerouslySetInnerHTML`). Um link só vira `<a href>` clicável quando o
esquema da URL é `http`, `https` ou relativo (`/...`, `#...`); qualquer
outro esquema (`javascript:`, `data:`, etc.) degrada para o texto do link,
nunca para um `href` executável.

Código dentro de um fence ganha realce por token, reusando
`highlightLine`/`highlightFile` de `apps/web/src/routes/code/highlight.ts`
— a mesma função que já colore a aba Code. `sh`/`bash` ganharam
vocabulário próprio de palavras-chave de shell (antes só tinham o
comentário de linha `#` mapeado e caíam no fallback de JS). Fences
```` ```sh ````/```` ```bash ```` ganham a estética visual de terminal
(prompt `$` por linha de comando), consistente com o `$ comando` que
`ApprovalCard` já usa para a ação `terminal`.

- **Onde:** `apps/web/src/lib/markdown.ts`,
  `apps/web/src/components/ui/MarkdownMessage.tsx`,
  `apps/web/src/routes/code/highlight.ts`
- **Teste:** `apps/web/src/lib/markdown.test.ts`,
  `apps/web/src/components/ui/MarkdownMessage.test.tsx`,
  `apps/web/src/routes/code/highlight.test.ts`,
  `apps/web/src/routes/SessionPage.markdown-resposta.test.tsx`
- **Origem:** PR #288 — respostas de agente com listas, código e links
  chegavam como texto cru no fio, sem estrutura nenhuma

### RN-159 — Artefatos Gerados agrupados por agente {#rn-159}

O painel "Artefatos gerados" da Sessão (`ContextAside` em
`SessionPage.tsx`) lista PR de dev (`pr_open`), PR de ADR do Arquiteto
(`open_adr_pr`) e épico/história criados pelo PO
(`backlog.epic_created`/`backlog.story_created`), agrupados por
`agentId` — quem gerou cada artefato — com o mesmo padrão de
`Disclosure` colapsável da [RN-138](#rn-138) (nome do agente + contagem,
expansível pro título de cada artefato).

Cada artefato navega pro lugar onde ele vive: PR (dev ou ADR) abre a URL
real (`executionResult.pullRequestUrl`, mesmo campo que
`ProjectOverviewTab.tsx` já lê para PR de ADR); épico/história navega
para `/projects/:projectId?tab=backlog` (mesmo padrão `Link` já usado nos
avisos compactos do PO no fio principal, [RN-124](#rn-124)/
[RN-157](#rn-157)). PR ainda sem `pullRequestUrl` (execução pendente)
aparece no painel sem virar link clicável.

Fora de escopo, por decisão registrada em comentário no código
(`ContextAside` em `SessionPage.tsx`): module_map/C4 — são estado
VIGENTE do projeto (uma versão corrente, sobrescrita a cada geração), não
um artefato datado por SESSÃO como PR/épico/história; a aba Visão Geral
(`ProjectOverviewTab.tsx`) já é o lugar deles hoje, sem âncora própria —
endereçar isso é fora do escopo desta entrega.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`ContextAside`)
- **Teste:** `apps/web/src/routes/SessionPage.artefatos-gerados.test.tsx`
- **Origem:** PR #288 — o painel não distinguia quem gerou cada artefato
  nem cobria PR de ADR e épico/história, só PR de dev

### RN-160 — "Confirmar arquitetura pronta" exige pelo menos 1 história promovida {#rn-160}

O botão "Confirmar arquitetura pronta" (handoff Arquiteto→Dev Lead, via
`confirmArchitectureReadiness`) nasce `disabled` até existir no backlog do
projeto pelo menos 1 história com status diferente de `draft` — ou seja, já
promovida por `PromoteStoriesUseCase`/`TransitionStoryUseCase` ([RN-048](#rn-048)),
não bastando ter regra de negócio capturada. `in_progress`/`done` também
contam, porque só se chega lá tendo passado por `ready`. A fonte é a MESMA
que a aba Backlog já usa (`useBacklog`, `ProjectBacklogTab.tsx`, mesma
queryKey `['backlog', projectId]`) — sem round-trip novo. Enquanto não há
história promovida, o botão mostra a dica em `title` explicando o motivo.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`hasPromotedStory`,
  render do botão)
- **Teste:** `apps/web/src/routes/SessionPage.readiness-arquitetura-exige-historia.test.tsx`
- **Origem:** pedido do usuário — o botão de handoff Arquiteto→Dev Lead
  não tinha gate nenhum

Só valia no CLIENTE: uma chamada HTTP direta ignorava a regra. Fechado por
[RN-404](#rn-404) (ADR 0094), que revalida no backend.

### RN-161 — Aceitar o handoff pro Dev Lead encadeia a ativação de execução quando o papel efetivo já autoriza {#rn-161}

`handleAcceptHandoff` (`SessionPage.tsx`) encadeia `activateExecution`
automaticamente quando `toAgent === 'dev-lead'` E o papel EFETIVO de quem
aceita — lido do mesmo `useCurrentWorkspaceWithRole()` que já autoriza o
"Auto mode" ([RN-153](#rn-153)) e as telas de Aprovações/Configurações — é
`owner` ou `maintainer`. Para `developer` (ou papel ainda não resolvido), o
fluxo atual continua intocado: aceitar não ativa nada, e "Ativar execução"
permanece como segundo botão. A checagem é só no cliente —
`POST .../execution/activate` continua exigindo `maintainer` no backend
([RN-137](#rn-137)); a fusão só evita um clique redundante para quem já
tinha os dois papéis. Reusa a MESMA `handleActivateExecution` que o botão
"Ativar execução" já chama, que trata o próprio erro (toast +
`mensagemDaApi`) e nunca relança — evita que um erro de ativação tardio
seja reportado como "não foi possível aceitar o handoff".

- **Onde:** `apps/web/src/routes/SessionPage.tsx`
  (`podeFundirHandoffComExecucao`, `handleAcceptHandoff`)
- **Teste:** `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`,
  describe "problema 4"
- **Decisão arquitetural:** [ADR 0069](adr/0069-fusao-condicional-do-handoff-com-a-ativacao-de-execucao.md)
- **Origem:** pedido do usuário (desenho aprovado)

### RN-162 — Perguntas estruturadas do Criativo {#rn-162}

O Criativo pode, quando faz VÁRIAS perguntas na mesma resposta, emitir a
lista em formato ESTRUTURADO em vez de deixar o usuário responder item por
item em texto livre — ferramenta nova `ask_structured_questions`
(`apps/engine/lib/engine/harness/tools/ask_structured_questions.ex`,
`:direct`), registrada ao lado de `emit_artifact`. Schema:
`{ questions: [{ id, label, type?, options? }] }` — `id` único e não-vazio,
`label` não-vazio, `type` ∈ `text|textarea|select` (default `text`),
`options` obrigatório e não-vazio quando `type: select`. Grava
`chat.structured_question`.

O frontend (`StructuredQuestionCard`, `SessionPage.tsx`) renderiza um
formulário com um campo por pergunta — `Input`/`Textarea`/`Select` do
design system, conforme `type`. `POST .../agents/:agent/structured-
question/:questionSetId/answer` (`AnswerStructuredQuestionUseCase`) valida
que toda pergunta tem resposta não-vazia, grava
`chat.structured_question_answered` (referenciando `questionSetId` = id do
evento da pergunta) e REUSA `SendAgentMessageUseCase` — as respostas viram
uma mensagem concatenada ("1. {label}: {resposta}\n2. ..."), como se o
usuário tivesse digitado no fio; não há canal novo de "o agente lê a
resposta estruturada". Um conjunto de perguntas só pode ser respondido
UMA vez: reenvio é recusado com 409, e o formulário nem chega a
reaparecer — o card vira somente leitura assim que existe um
`chat.structured_question_answered` posterior com o mesmo `questionSetId`.

- **Onde:** `apps/engine/lib/engine/harness/tools/ask_structured_questions.ex`,
  `apps/engine/lib/engine/agents/criativo_server.ex`,
  `apps/api/src/application/use-cases/agents/answer-structured-question.use-case.ts`,
  `apps/api/src/interfaces/http/agents/agents.controller.ts`,
  `apps/web/src/routes/SessionPage.tsx` (`StructuredQuestionCard`)
- **Teste:** `apps/engine/test/engine/harness/tools/ask_structured_questions_test.exs`,
  `apps/engine/test/engine/agents/criativo_server_test.exs`,
  `apps/api/test/application/use-cases/agents/answer-structured-question.use-case.spec.ts`,
  `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx`
- **Origem:** pedido do usuário — sem precedente de input estruturado no chat

### RN-163 — O Criativo cumpre a promessa de tentar de novo {#rn-163}

Cada turno do Criativo roda um **laço bounded de tool use**, com teto de **12**
idas ao modelo — o mesmo desenho que o PO e o Arquiteto já tinham. Antes o
modelo era chamado UMA vez por turno: o resultado da ferramenta era anexado ao
histórico em memória e ninguém mais o lia, então a frase *"vou corrigir e
tentar de novo"* — literal no código — só se cumpria se o usuário mandasse
outra mensagem. Para quem usava, o Criativo simplesmente parava de responder
depois de dizer que ia corrigir.

Quatro consequências, e cada uma é uma regra:

1. **Erro de ferramenta é entrada, não fim de linha.** O motivo volta ao modelo
   como mensagem `tool` e o laço chama o modelo de novo, que reemite corrigido
   DENTRO do mesmo turno.
2. **Nada se anuncia que o código não vá executar.** A frase de retentativa é
   decidida depois de despachar as ferramentas e sabendo quantas voltas
   sobraram: com volta disponível, o agente diz que vai corrigir; sem volta, ele
   não promete.
3. **A falha de ferramenta virou `agent.error` durável, com origem**
   ([RN-059](#rn-059)) — era `agent.response`, indistinguível no event log de
   uma resposta normal. `origem: infra` quando a api recusou o `append_event`;
   `origem: modelo` para o payload que o modelo escreveu (chave errada,
   `origin` que não é lista, regra duplicada, tipo system-emitted). O payload
   carrega `tool` e `retentativa`.
4. **Teto esgotado não termina em silêncio.** Vira `agent.error` com
   `reason: "limite_de_iteracoes"` e `origem: modelo`, a mesma leitura do
   `toolloop.limit_reached` do `ToolLoop`. O nome do evento NÃO é reusado: este
   agente não roda dentro do `ToolLoop`, e o evento mentiria sobre quem o
   produziu.

Duas fronteiras do laço, ambas deliberadas: `ask_structured_questions`
bem-sucedida **encerra** o turno (a bola está com o usuário, e as respostas
voltam num turno futuro — [RN-162](#rn-162)); e um turno que teve falha em
alguma volta fecha com um desfecho CONSOLIDADO no fio, para a última palavra
não ser o erro de uma volta que já foi corrigida depois.

- **Onde:** `apps/engine/lib/engine/agents/criativo_server.ex`
  (`run_turn_capturing/3`, `continuar/4`, `emit_falha_de_ferramenta/4`,
  `emit_falha_limite/2`)
- **Teste:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  (laço que corrige de verdade, teto esgotado narrado, origem `infra` vs
  `modelo`, pergunta estruturada que encerra o turno)
- **Origem:** uso real no projeto `exp001` — "o Criativo não respondeu depois
  de dizer que iria corrigir e tentar de novo"

### RN-169 — O projeto escolhe onde o código mora: Local ou Container {#rn-169}

**REVISADA pela [RN-421](#rn-421) (ADR 0104)**: `workspace_mode`/`local`
viraram `execution_mode` de TRÊS valores (`container`/`mounted`/`runner`,
migração `0048`) — o resto desta entrada é histórico, fiel ao que valia até
a revisão.

Um projeto nasce com um **modo de workspace** (`projects.workspace_mode`,
migração `0043`), e é ele que decide de onde a raiz de escopo é derivada:

- **`container`** (DEFAULT, e o comportamento que sempre existiu): a pasta
  GERENCIADA pelo produto, `join(PROJECT_WORKSPACES_ROOT, workspace_dir_name)`
  ([RN-109](#rn-109));
- **`local`**: uma pasta DO USUÁRIO, no caminho absoluto de
  `projects.workspace_path`.

O par é amarrado por CHECK no banco
(`(workspace_mode = 'local') = (workspace_path IS NOT NULL)`), e não só pelo
caso de uso: a coluna é lida por DOIS processos (api e engine) e escrita por
scripts de seed/backfill que não passam por ele. `local` sem caminho seria
escopo de terminal apontando para lugar nenhum; `container` com caminho seria
uma segunda fonte de verdade esperando divergir da primeira.

A derivação continua **única** — `projectScopeRoot` passou a receber a
localização (`{workspaceDirName, workspaceMode, workspacePath}`) e escolhe o
ramo; nenhum dos quatro consumidores ([RN-092](#rn-092)) ganhou validação
própria. O engine resolve o mesmo localizador na CONSULTA (nome de pasta no
`container`, caminho absoluto no `local`) e distingue os dois pela barra
inicial, que é inequívoca porque o nome de pasta é validado contra
`^[A-Za-z0-9_-]{1,64}$`.

Duas consequências explícitas do modo `local`:

1. **O portão da imagem do Arquiteto ([RN-105](#rn-105)) NÃO vale.** Projeto
   Local não sobe container, então a aba Code libera sem esperar decisão que
   nunca vai acontecer. A dispensa mora no mesmo funil do portão na api, e a
   tela concorda: `ProjectCodeTab` nem chega a perguntar o estado do container
   ([RN-107](#rn-107)) quando o projeto é Local — se só a api dispensasse, a
   aba continuaria bloqueada na tela por uma decisão inexistente.
2. **O `permissions.json` mora na pasta do usuário**, junto com o código —
   porque a política tem que ser lida da MESMA raiz que o escopo de terminal
   autoriza.

`workspace_mode` não confunde com o `GitProviderName` `'local'`: um diz onde o
CÓDIGO mora em disco, o outro onde o REPOSITÓRIO git vive, e as duas escolhas
são ortogonais.

- **Onde:** `apps/api/src/db/schema.ts` (`projects`),
  `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`projectScopeRoot`), `apps/api/src/domain/iam/project.entity.ts`,
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (`portaoDoContainer`), `apps/web/src/routes/ProjectCodeTab.tsx`,
  `apps/engine/lib/engine/projects/project.ex`,
  `apps/engine/lib/engine/actions/workspace.ex` (`workspace_dir/2`),
  `apps/engine/lib/engine/dev/worktree_cleanup.ex` (que era a segunda
  derivação escrita à mão, e passou a usar a única),
  `apps/web/src/routes/NewProjectWizard.tsx`
- **Teste:** `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (describe "projectScopeRoot no modo local"),
  `apps/api/test/infrastructure/filesystem/fs-permissions-file-store.spec.ts`
  (o permissions.json na pasta do usuário),
  `apps/api/test/application/use-cases/iam/create-project-modo-de-workspace.spec.ts`,
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (projeto Local não passa pelo portão),
  `apps/api/test/interfaces/http/iam/project-dto-modo-de-workspace.spec.ts`
  (o modo é congelado: PATCH não o muda),
  `apps/web/src/routes/ProjectCodeTab.test.tsx` (a tela também dispensa o gate),
  `apps/engine/test/engine/actions/workspace_test.exs`
  (describe "workspace_dir/2 com o localizador já resolvido"),
  `apps/web/src/routes/NewProjectWizard.test.tsx`
- **Decisão arquitetural:** [ADR 0072](adr/0072-projeto-local-ou-container.md)
- **Origem:** pedido do usuário (decisão dele, com a variante de caminho livre
  escolhida explicitamente)

### RN-170 — Caminho Local é validado na CRIAÇÃO, e a recusa ensina {#rn-170}

**REVISADA pela [RN-422](#rn-422) (ADR 0104)**: a validação de criação passou
a DIVERGIR por modo — `mounted` (o `local` renomeado) continua tocando disco
como descrito aqui, `runner` valida só o LÉXICO, sem I/O — o resto desta
entrada é histórico, fiel ao que valia até a revisão.

Criar um projeto no modo `local` com um caminho que a api não alcança produz um
projeto que **trava depois** — na primeira ferramenta do primeiro agente, longe
da tela onde a decisão foi tomada. Por isso a criação **recusa com 400**, e a
mensagem diz o que falta fazer.

O caminho precisa ser:

1. **absoluto**, sem `..` nem `.` em nenhum segmento (o caminho gravado é o
   caminho que se lê; `/srv/app/../../etc` é `/etc` e não parece);
2. **existente e uma pasta** dentro do container da api;
3. **gravável pelo processo** (`access(W_OK|X_OK)`) — as imagens rodam non-root
   ([ADR 0024](adr/0024-fase5-imagens-producao-ci.md)), e pasta do host com
   outro dono chega montada como somente leitura na prática;
4. **fora da raiz e das pastas de sistema** (`/`, `/etc`, `/usr`, `/var`,
   `/data`… e tudo abaixo delas): a raiz do projeto é o escopo que AUTORIZA o
   terminal do agente ([ADR 0055](adr/0055-escopo-de-caminho-na-politica-de-terminal.md)),
   e um projeto com raiz em `/etc` transforma "o agente escreve no projeto dele"
   em "o agente reescreve o container";
5. **sem sobreposição com o checkout do Brabo, nos DOIS sentidos** — a pasta que
   CONTÉM o monorepo e a pasta DENTRO dele. O segundo caso é o problema que o
   ADR 0055 relata acontecendo de verdade.

O caminho gravado é o **normalizado**, não a string crua: validar uma string e
gravar outra é como a validação deixa de valer no dia seguinte. `workspacePath`
enviado junto com `workspace_mode: container` é RECUSADO, não ignorado — campo
descartado em silêncio vira "mas eu configurei".

A parte LÉXICA (itens 1, 4 e 5) roda **também na leitura**, a cada derivação de
`projectScopeRoot`: o único jeito de burlar a criação é escrever direto no
banco, e o que se ganha ali é escopo de terminal em `/`. A parte de DISCO
(itens 2 e 3) roda só na criação, onde o usuário ainda pode corrigir.

A recusa por pasta ausente traz a instrução de montagem — o arquivo, os dois
serviços e a linha (`- <caminho>:<caminho>`), com o ponteiro para
[o runbook](runbook.md). Montar só na api produz um projeto que a api aceita e o
engine não enxerga: ela valida o que ela vê, e não tem como saber o que está
montado no outro container.

- **Onde:** `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`validarCaminhoDeWorkspaceLocal`, `CaminhoLocalInvalidoError`),
  `apps/api/src/application/use-cases/iam/create-project.use-case.ts`
  (`caminhoValidado`), `apps/api/src/interfaces/http/iam/dto/create-project.dto.ts`,
  `apps/web/src/lib/wizard.ts` (`caminhoLocalParecePlausivel`)
- **Teste:** `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (describe "validarCaminhoDeWorkspaceLocal"),
  `apps/api/test/application/use-cases/iam/create-project-modo-de-workspace.spec.ts`
  (describe "a criação RECUSA o caminho que travaria depois"),
  `apps/web/src/lib/wizard.test.ts`, `apps/web/src/routes/NewProjectWizard.test.tsx`
- **Decisão arquitetural:** [ADR 0072](adr/0072-projeto-local-ou-container.md)
- **Origem:** guarda exigida pela variante de caminho livre (ADR 0072)

---

### RN-164 — O PO LÊ o que já existe, escopado ao projeto {#rn-164}

O PO ganhou duas ferramentas de LEITURA — `listar_regras_de_negocio` e
`listar_backlog` (`:direct`, sem parâmetro nenhum) — servidas por duas rotas
internas escopadas ao **projeto**: `GET /internal/projects/:projectId/business-rules`
e `GET /internal/projects/:projectId/backlog`.

A primeira devolve todo `artifact.business_rule` das sessões do projeto com a
`description` inteira, quais histórias já citam cada regra e o
`uncoveredCount`; a segunda devolve a MESMA árvore épico → história → tarefa
da aba Backlog, pelo mesmo `ListBacklogUseCase` (três leituras por projeto,
nunca N+1). O texto que volta ao modelo põe as regras DESCOBERTAS primeiro e
os épicos ÓRFÃOS antes da árvore — é o que gera trabalho.

O que a regra corrige: até aqui o PO tinha **quatro ferramentas e todas de
escrita**. O contexto dele era montado uma vez, no kickoff, a partir dos 200
últimos eventos da **sessão** — dali em diante ele não sabia quais regras
existiam, quais já tinha coberto, nem o que já havia criado. O escopo é o
projeto e não a sessão de propósito: regra capturada numa sessão anterior é
exatamente o que a leitura por sessão escondia.

Ler **não** vira `proposed_action` (não é efeito externo), mas é CONTIDA no
sentido do ADR 0060: nenhuma das duas rotas aceita parâmetro além do id do
projeto — sem busca, sem paginação, sem filtro —, o custo por chamada é
constante, e o texto entregue ao modelo tem teto de linhas dizendo o total
real quando trunca.

- **Onde:** `apps/engine/lib/engine/harness/tools/listar_regras_de_negocio.ex`,
  `apps/engine/lib/engine/harness/tools/listar_backlog.ex`,
  `apps/engine/lib/engine/agents/po_server.ex`,
  `apps/engine/lib/engine/sessions/engine_api_client.ex`,
  `apps/api/src/application/use-cases/backlog/list-business-rules.use-case.ts`,
  `apps/api/src/interfaces/http/internal/internal-projects.controller.ts`
- **Teste:** `apps/engine/test/engine/harness/tools/listar_regras_de_negocio_test.exs`,
  `apps/engine/test/engine/harness/tools/listar_backlog_test.exs`,
  `apps/engine/test/engine/agents/po_server_test.exs`,
  `apps/api/test/application/use-cases/backlog/list-business-rules.use-case.spec.ts`
- **Origem:** uso real no projeto `exp001` — "crie ferramenta para o PO
  conseguir listar as regras de negócio"

---

### RN-165 — Épico sem história é cobrado, e o PO pergunta quando não sabe {#rn-165}

Quando o PO encerra um turno tendo criado um épico e **nenhuma história para
ele**, isso vira desfecho EXPLÍCITO: evento durável
`backlog.epic_without_story` (com `origem: "modelo"`, os ids e títulos dos
épicos e a mensagem) mais o broadcast `agent.error` — o padrão da
[RN-059](#rn-059): o log é o que sobrevive, o broadcast é o agente dizendo no
fio. A cobrança é por OCORRÊNCIA: reportada uma vez, a lista de pendências é
esvaziada, e não vira alarme que repete a cada turno.

O que conta é a criação que **deu certo**: um `create_story` recusado pela api
(`business_rule_id` inexistente, por exemplo) não quita o épico. Tratá-lo como
se quitasse seria trocar um silêncio por outro. Os épicos pendentes vivem no
state do `PoServer` e NÃO são reidratados: a cobrança é sobre a obrigação
assumida no turno, e reconstruí-la do event log reabriria épico antigo que o
usuário já resolveu de outro jeito.

Junto vieram as duas peças que faltavam para o PO ter uma saída além de parar:
`ask_structured_questions` — a MESMA ferramenta do Criativo
([RN-162](#rn-162)), só passada a advertisar no `po_server` — e a instrução de
kickoff dizendo, com todas as letras, que épico sem história trava a execução
e que **faltando informação se PERGUNTA**, nunca se para nem se inventa. A
instrução anterior não dizia uma palavra sobre o que fazer diante de uma
lacuna, e diante de uma lacuna sem instrução um modelo escolhe entre inventar
e parar.

- **Onde:** `apps/engine/lib/engine/agents/po_server.ex`
  (`anotar_obrigacao/4`, `encerrar_turno/1`, `obrigacoes/0`),
  `apps/engine/lib/engine/harness/tools/create_epic.ex` (`id_no_resultado/1`),
  `apps/web/src/lib/activity.ts`
- **Teste:** `apps/engine/test/engine/agents/po_server_test.exs`
  (describe "RN-165"), `apps/web/src/lib/activity.test.ts`
- **Origem:** uso real no projeto `exp001` — backlog sem história, logo sem
  tarefa, logo execução travada sem erro visível

---

### RN-166 — O teto de iterações do PO deixa rastro {#rn-166}

Esgotado o teto de iterações do laço de ferramentas do `PoServer` (12), o
turno emite `toolloop.limit_reached` com `{iteration, max_iterations}` —
o MESMO tipo e o mesmo payload que o `Engine.Harness.ToolLoop` já emitia
desde a Fase 3. Antes, a cláusula devolvia o state e pronto: de fora, um laço
esgotado era indistinguível de um turno que simplesmente acabou.

Reusar o identificador em vez de criar um `po.*` é deliberado: é o mesmo fato
(o laço bateu no teto), e quem lê o event log não deve precisar aprender um
segundo nome por causa de o agente conversacional ter laço próprio em vez de
usar o `ToolLoop`.

- **Onde:** `apps/engine/lib/engine/agents/po_server.ex` (`run_turn/2`,
  cláusula `remaining <= 0`)
- **Teste:** `apps/engine/test/engine/agents/po_server_test.exs`
  ("teto de iterações emite toolloop.limit_reached")
- **Origem:** investigação do travamento do `exp001` — o laço terminava em
  silêncio

---

### RN-172 — Handoff e aprovação são o DESFECHO do turno {#rn-172}

No fio da sessão, o **handoff oferecido** e o **card de aprovação** aparecem
DEPOIS da última fala do turno em que nasceram — nunca no meio dele.

Isto **não corrige ordenação**: a RN-155 continua valendo inteira, e a
timeline segue ordenada pelo `seq` do event log. O que o log registra é a
verdade: `po_server.ex` (`run_turn/2`) emite, na MESMA iteração, o
`agent.response` do turno, DEPOIS o `tool.call` de `offer_handoff` (que grava
`handoff.offered`) e SÓ ENTÃO recursa para o `agent.response` de fechamento.
O `seq` do handoff é honestamente menor que o da última fala. O mesmo vale
para `proposed_action.created`, que nasce no meio do turno enquanto o agente
ainda tem o que dizer. Mostrar "passou o bastão" ou "aprove isto" no meio da
conversa é leitura errada de um dado certo — então a regra é de
APRESENTAÇÃO, aplicada numa passada separada e explícita
(`afundarDesfechos`), depois do `sort` por `seq`, e não escondida num
comparador com três termos.

Turnos diferentes **nunca se misturam**. Um desfecho desce até o fim do
trecho logo abaixo dele e para na primeira entrada que falhe qualquer uma das
três condições:

1. **mesmo turno** — turno é o `seq` da última ABERTURA anterior à entrada, e
   abertura é evento de ator `user` (`chat.message`, `agent.activated`,
   promoção/devolução de história). Protege o caso em que a fronteira entre
   dois turnos não tem entrada VISÍVEL nenhuma: `agent.activated` abre turno e
   não vira item do fio.
2. **mesmo autor** — em sessão de EXECUÇÃO vários agentes escrevem sem que o
   usuário fale uma única vez, e todos ficam no mesmo turno; o desfecho de um
   não pode atravessar a fala de outro.
3. **não é desfecho** — dois desfechos seguidos preservam a ordem entre si (o
   `handoff.offered` do Infra antes do Dev Lead, na mesma confirmação).

Ator `system` NÃO abre turno: é ruído de infraestrutura no meio do fio, não
decisão de quem conversa.

- **Onde:** `apps/web/src/routes/SessionPage.tsx`
  (`aberturasDeTurno`, `turnoDoSeq`, `afundarDesfechos`, e os campos
  `autor`/`turno`/`desfecho` de `TimelineEntry`)
- **Teste:** `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
  (describes "RN-172 — turno e desfecho (unidade)" e "RN-172 — a sequência
  REAL do engine, renderizada")
- **Origem:** uso real no `exp001` — "a passagem de bastão do PO para o
  arquiteto está aparecendo acima da última mensagem do PO" e "a mensagem de
  aprovação apareceu acima do chat do arquiteto até ele finalizar a resposta"

---

### RN-173 — O fio acompanha tudo que cresce, e só quem já estava no fim {#rn-173}

O chat rola para o fim quando o conteúdo cresce — **e não só quando chega
evento novo**. As duas fontes da timeline são queries SEPARADAS (`events` e
`actions`), e a altura ainda muda sem nenhuma das duas: abrir/fechar um
`Disclosure` (colapso por agente da RN-138, "Detalhes" do card de aprovação),
Markdown reflowando, diagrama renderizando depois. Por isso são dois
mecanismos: as dependências do efeito cobrem o que o React sabe
(`events.length`, `actions.length`, `streamingText`), e um `ResizeObserver`
sobre o CONTEÚDO do fio cobre o que só o layout sabe.

A guarda continua **inalterada e deliberada**: só rola quem já está a menos de
120px do fim. Quem subiu para reler o histórico não é arrastado — o fio segue
a conversa, não sequestra a leitura.

No mesmo fio, o card de aprovação da variante `chat` deixa de ocupar os 780px
inteiros da coluna: ganha teto de 560px e fica centralizado, como
`.handoffCard`/`.handoffDivider` já são. Recuar 45px como as bolhas seria
errado — o card não é fala de ninguém, é uma decisão pedida ao usuário. A
fila da aba Aprovações (`variant="queue"`) não muda: lá o card DEVE preencher
a coluna do grid.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`acompanharOFim` e os dois
  efeitos que o chamam); `apps/web/src/components/ApprovalCard.module.css`
  (`.card.chat`)
- **Teste:** `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
  (describe "RN-173 — o fio acompanha o que cresce", com o caso de o usuário
  ter rolado para cima)
- **Origem:** uso real no `exp001` — "o scroll do chat deve ficar sempre no
  final seguindo o chat" e "aprovação mal diagramado deve ficar ao centro"

### RN-171 — A pergunta de lista tem saída por texto livre, por default {#rn-171}

Pergunta `type: "select"` de `ask_structured_questions` (RN-162) aceita
resposta **fora da lista**. O campo é `allowOther`, e o **default é `true`**:
quem não declara nada oferece a saída. Fechar a lista exige
`allowOther: false` explícito, e só faz sentido quando ela é genuinamente
fechada ("Sim"/"Não").

O default aberto não é preferência de estilo. Uma lista fechada por
ESQUECIMENTO do modelo trava a conversa inteira e o usuário não tem como
destravá-la de fora — foi exatamente o que o uso real encontrou: o modelo
ofereceu uma opção do tipo "Escreva você mesmo" e o formulário não tinha onde
escrever, porque o schema do tool não sabia expressar "além destas, o que
você quiser". Uma lista aberta por engano, no pior caso, oferece um campo a
mais. Os dois erros não custam a mesma coisa. Pelo mesmo motivo a descrição
do tool **proíbe** criar uma opção "Outro" dentro de `options`: o formulário
já a oferece sozinha, e duas escapatórias na mesma lista confundem.

`allowOther` só existe em `select` — em `text`/`textarea` o campo já é texto
livre, e o engine normaliza esses dois para `false` em vez de gravar estado
sem significado no event log. Na tela, escolher "Outra (escrever)" troca o
`Select` por um `Input`: o sentinela de interface (`__outra__`) **nunca**
viaja para o backend, e o que vai é o TEXTO digitado. O botão de envio
continua exigindo TODAS as perguntas preenchidas — `AnswerStructuredQuestion
UseCase` recusa com 400 listando o que falta, então habilitar com campo vazio
só produziria um erro do servidor —, e estar em "Outra" com o texto ainda em
branco NÃO conta como preenchido.

O card também deixou de ser o único item do fio alinhado a nada: ele passa a
ser centralizado com o mesmo teto de 560px do `ApprovalCard` na variante
`chat` ([RN-173](#rn-173)) e ganha o avatar e a cor do agente, que é o que o
faz ler como FALA de alguém em vez de formulário órfão. Antes ele nascia
encostado à esquerda com teto de 480px, enquanto as bolhas começam 45px
adentro.

- **Onde:** `apps/engine/lib/engine/harness/tools/ask_structured_questions.ex`
  (schema, validação e `normalizar/1`), `apps/web/src/lib/api-types.ts`
  (`StructuredQuestion.allowOther`), `apps/web/src/routes/SessionPage.tsx`
  (`StructuredQuestionCard`, `OUTRA_RESPOSTA`, `permiteOutra`),
  `apps/web/src/routes/SessionPage.module.css` (`.structuredQuestionCard`,
  `.structuredQuestionCabecalho`)
- **Teste:** `apps/engine/test/engine/harness/tools/ask_structured_questions_test.exs`
  (default aberto, `false` explícito, `allowOther` não booleano recusado),
  `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx`
  (describe "saída por texto livre no select")
- **Origem:** uso real no `exp001` — "sempre dê a opção de input do usuário
  quando ele seleciona Escreva"

### RN-174 — Ação que dispara turno de agente arma o indicador do fio {#rn-174}

O indicador de "o agente está trabalhando" (os três pontinhos depois de 5s,
[RN-131](#rn-131)/[RN-156](#rn-156)) só aparece enquanto `streaming` ou
`statusAgent` valem, e eles eram ligados em três lugares: o composer
(`handleSend`), as confirmações de prontidão e o canal Phoenix. **Toda ação da
tela que dispara um turno síncrono no engine passa a armá-lo também.**

São duas, e nenhuma delas é o composer:

1. **Responder o formulário de perguntas estruturadas** —
   `AnswerStructuredQuestionUseCase` reusa `SendAgentMessageUseCase`
   ([RN-162](#rn-162)), e a chamada só resolve depois do turno inteiro.
2. **Devolver uma história ao PO** — `ReturnStoryUseCase` chama `reviseStory`,
   que é `handle_call({:revise, …})` no `po_server`: a resposta HTTP espera o
   PO reescrever a história.

O canal Phoenix não cobre o buraco, e é isso que torna a correção necessária
em vez de redundante: quando ele ainda não terminou de conectar (ticket +
join, [RN-108](#rn-108)) o broadcast de `agent.status` "working" não tem
ouvinte e se perde — a tela fica em silêncio absoluto por dezenas de segundos,
que é indistinguível de "não vai acontecer nada".

O par é `iniciarTurnoDoAgente(agente)` **antes** do `await` (o `agent.status`
do canal pode chegar primeiro, e sem o agente fixado o indicador nasceria sem
saber quem fala) e `finalizarTurnoDoAgente()` no `finally` — nos DOIS
caminhos, porque um erro que deixasse `streaming` ligado travaria o composer
até o próximo turno. Resolver a chamada é sinal de fim de turno tão confiável
quanto o `agent.done` do canal, e `finalizarTurnoDoAgente` é idempotente. O
prazo de 5s não muda: turno que responde rápido continua sem mostrar nada.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`iniciarTurnoDoAgente`,
  `handleReturnStory`, `StructuredQuestionCard`)
- **Teste:** `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx`
  e `apps/web/src/routes/SessionPage.promocao-inline-e-volta.test.tsx`
  (describes de RN-174, com o caso de falha provando que o indicador não fica
  preso)
- **Origem:** uso real no `exp001` — "caso a web, api e engine demore mais de
  5s para ter uma resposta, a web deve apresentar uma animação no chat
  mostrando que o agente está pensando"

### RN-175 — Toda resposta de agente diz com qual modelo foi gerada {#rn-175}

`agent.response` carrega `modelName` nos **três** produtores do evento, e não
só nos quatro agentes conversacionais:

| produtor | quem passa por ali | antes |
|---|---|---|
| os quatro conversacionais (`criativo`/`po`/`arquiteto`/`dev_lead`) | chat | já gravava, desde a [RN-146](#rn-146) |
| `Engine.Harness.ToolLoop` | TODO agente de execução e de gate — `dev-*`, QA, SecOps, Infra-Workflows, Psicólogo, Anamnese | **nunca gravou** |
| `SendChatMessageUseCase` (api) | chat sem agente ativo, em que quem responde é o modelo | **nunca gravou** |

Nenhuma chamada nova: `RunLlmTurnUseCase` já devolve `modelName` no corpo e
`StreamLlmTurnUseCase` já o põe no frame `final` — o valor é o nome do modelo
do **binding resolvido** (`model.name`), não o eco do provider. Ele é `null`
quando o turno falhou antes de resolver o binding, e ausente em evento gravado
antes desta regra.

Na tela, o modelo deixou de ser a palavra solta `modelo` em mono 10px
`--text-muted` ao lado do nome do agente — que se lê como se o modelo se
CHAMASSE "modelo", e que reprova o contraste de texto de leitura. Virou um
**chip** com o ícone de modelo, `--text-secondary` sobre `--surface-2`, e o
rótulo de desconhecido passou a ser "modelo não registrado". A tela **não**
adivinha o modelo pelo binding ATUAL do agente quando o dado falta: atribuir a
uma resposta antiga um modelo que talvez nem existisse quando ela foi gerada
seria inventar procedência, e procedência inventada é pior que ausente — o
mesmo argumento do preço congelado em `token_usage` ([RN-044](#rn-044)).

Fora do escopo, declarado: `agent.error` continua sem o modelo nos quatro
servidores, mesmo quando a api o mandou no frame de erro (budget estourado, por
exemplo). É mudança de outro evento, com outra pergunta a responder.

- **Onde:** `apps/engine/lib/engine/harness/tool_loop.ex`,
  `apps/api/src/application/use-cases/llm/send-chat-message.use-case.ts`,
  `apps/web/src/routes/SessionPage.tsx` (o chip em `agent.response`),
  `apps/web/src/routes/SessionPage.module.css` (`.messageModelo`)
- **Teste:** `apps/engine/test/engine/harness/tool_loop_test.exs`,
  `apps/api/test/application/use-cases/llm/send-chat-message.use-case.spec.ts`,
  `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`,
  `apps/web/src/design-contraste.test.ts` (o par do chip)
- **Origem:** uso real no `exp001` — "PO não mostrou o modelo que estava
  utilizando; todos os agentes devem apresentar o seu modelo ao lado do nome"

### RN-176 — Tabela em Markdown no fio vira tabela de verdade {#rn-176}

O Markdown leve do chat ([RN-158](#rn-158)) passa a reconhecer **tabela GFM** e
a renderizá-la com o `Table` do design system — o mesmo componente de
Configurações, Gastos e Executores, não uma `<table>` própria: "como o Brabo
desenha uma tabela" é uma decisão só. Antes, a tabela do Mapa de Módulos que o
Arquiteto escreve na resposta saía como parágrafo com pipes literais.

O que distingue tabela de prosa com `|` é a **linha separadora**, e ela é
obrigatória como no GFM: sem ela o bloco continua sendo parágrafo, então
"escolha entre a | b | c" não vira tabela por engano. O cabeçalho manda no
número de colunas — linha curta ganha célula vazia, linha longa perde o
excesso —, `\|` escapado fica dentro da célula, e o alinhamento sai dos
dois-pontos do separador. Zero dependência nova: o parser continua sendo o
próprio, por regex, e a árvore de dados continua virando elementos React
diretos (nenhum `dangerouslySetInnerHTML`).

**O artefato `artifact.module_map` continua FORA do fio**, e a escolha é
deliberada: ele é estado VIGENTE do projeto, não artefato datado por sessão —
a mesma decisão já registrada na [RN-159](#rn-159) —, e vive na Visão Geral.
O que o usuário pediu foi a tabela **dentro da mensagem**, e é ela que passou
a ser desenhada; a correção serve a QUALQUER agente que escreva uma tabela, e
não só ao Mapa de Módulos.

No balão, a tabela **rola na horizontal** em vez de espremer coluna: o fio tem
~700px e um `module_map` tem 4 colunas.

- **Onde:** `apps/web/src/lib/markdown.ts` (bloco `table`, `celulasDaLinha`),
  `apps/web/src/components/ui/MarkdownMessage.tsx` (`TabelaMarkdown`),
  `apps/web/src/components/ui/MarkdownMessage.module.css`
- **Teste:** `apps/web/src/lib/markdown.test.ts` (describe "tabela (RN-176)"),
  `apps/web/src/components/ui/MarkdownMessage.test.tsx`
- **Origem:** uso real no `exp001` — "a tabela dentro da mensagem do Mapa de
  Módulos do arquiteto tem que ficar bem estruturada em formato tabela,
  utilizar design system do próprio Brabo"

### RN-177 — O log mostra tudo, e o histórico se recolhe por ORIGEM {#rn-177}

O feed de atividade escondia seis tipos de evento (`tool.call`, `tool.result`,
`agent.response`, `agent.delta`, `agent.status`, `context.compacted`) **sem
oferecer alternativa nenhuma**: quem quisesse ver o que o agente e o harness
trocam entre si tinha de abrir o banco. O filtro continua, e continua
**desligado por padrão** — a razão dele não mudou (116 de 193 eventos reais
eram desses tipos, ver `isMachineEvent`) —, mas virou **escolha**: um botão
"Eventos de máquina" no mesmo trilho dos chips de tipo.

Mostrar tudo só resolve metade: uma sessão longa vira uma lista que ninguém
percorre. Por isso as **5 mais recentes ficam abertas** e o resto entra em
colapsos por **ORIGEM** — uma classificação NOVA, que não substitui o
`ActivityKind`: `kind` diz de que ASSUNTO o evento fala (commit, PR, permissão)
e decide ícone e cor; `origem` diz de que CAMADA ele veio, e é ela que torna o
histórico legível em punhados. As seis saem do dado que existe — `actor.kind` e
o prefixo do `type` —, nunca de suposição:

| origem | o que cai nela |
|---|---|
| `harness` | `tool.*`, `toolloop.*`, `agent.status`, `context.compacted` |
| `llm` | `agent.response`, `agent.delta`, `llm.*` |
| `usuario` | qualquer evento com `actor.kind === 'user'` |
| `sistema` | qualquer evento com `actor.kind === 'system'` |
| `agente` | `agent.*` restante, `handoff.*`, `delegation.*`, `chat.*` de agente |
| `eventos` | o event log de domínio (backlog, git, PR, artefato, bootstrap…) |

A **precedência** é o que torna a classificação previsível, e está na ordem dos
`if`: mecanismo (`harness`, `llm`) vence ator, porque um `tool.call` é do
harness qualquer que seja o ator; e ator vence prefixo de agente, porque
`chat.message` existe dos dois lados e quem os distingue é quem falou. Tipo que
ninguém previu cai em `eventos` — nunca some, nunca inventa categoria.

**A mesma regra vale no FIO da sessão**, com o eixo invertido: o fio é
crescente (o mais novo junto do composer), então as 5 últimas entradas ficam
abertas em baixo e o histórico recolhido fica no TOPO. O corte é sobre a lista
já agrupada por agente ([RN-138](#rn-138)) — quem conta é o que o usuário vê, e
um colapso de doze mensagens é UMA entrada na tela.

- **Onde:** `apps/web/src/lib/activity.ts:94` (`OrigemDeEvento`), `:125`
  (`origemDoEvento`), `:152` (`agruparPorOrigem`);
  `apps/web/src/components/ActivityFeed.tsx:34` (o corte de 5), `:66` (o
  toggle); `apps/web/src/routes/SessionPage.tsx:284` (o corte do fio), `:1898`
  (`fio`)
- **Teste:** `apps/web/src/lib/activity-origem.test.ts`,
  `apps/web/src/components/ActivityFeed.test.tsx` (describe "ordem,
  agrupamento e o toggle de máquina"),
  `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx` (describe
  "RN-177")
- **Origem:** uso real no `exp001` — "em log de eventos mostrar também log do
  sistema, concentrar a mensagem em grupo, ou seja mantém as últimas 5
  mensagens mas abaixo vira o grupo de log de eventos, sistema, llm, harness,
  agente, usuário"

### RN-178 — O painel da sessão lê do último para o primeiro, e a lista de regras pagina {#rn-178}

As quatro seções do painel de contexto (regras de negócio, artefatos gerados,
arquivos tocados e log de eventos) eram **crescentes**: abriam no começo da
sessão. Numa sessão de milhares de eventos isso entrega a tela errada — quem
abre o painel quer o que acabou de acontecer. As quatro passaram a ser
**decrescentes**, inclusive dentro da árvore de backlog ([RN-179](#rn-179)).

Uma consequência que veio junto: o botão "Carregar mais antigos" do feed
([RN-099](#rn-099)) **mudou de lado**. Ele ficava ACIMA da lista porque a lista
era crescente e o passado estava em cima; com a ordem invertida o passado está
no fim, e um botão no topo pediria para rolar na direção contrária à que ele
carrega — o mesmo argumento de antes, com o sinal trocado.

E **acima de 5 regras a lista pagina**, em vez de crescer sem fim: o painel tem
a largura de uma coluna e uma sessão de ideação passa de vinte regras sem
esforço. A página vigente é resolvida por *clamp* (`min(pagina, total - 1)`) e
não por efeito de sincronização: uma regra nova chegando pelo poll alonga a
lista, e um `useEffect` renderizaria uma vez com a página inválida antes de
corrigir. Com 5 ou menos, o paginador **não existe** — controle que não pagina
nada é ruído ocupando altura.

- **Onde:** `apps/web/src/routes/SessionPage.tsx:2988` (`REGRAS_POR_PAGINA`) e
  a ordenação das quatro seções em `ContextAside`;
  `apps/web/src/components/ActivityFeed.tsx:98` (o `sort` decrescente)
- **Teste:** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  (describe "RN-178"), `apps/web/src/components/ActivityFeed.test.tsx`
- **Origem:** uso real no `exp001` — "mostrar log de eventos, arquivos tocados
  e regras de negócio sempre em ordem do último para o primeiro de acordo com
  a data" e "caso as regras de negócio ficar acima de 5, deve-se paginar"

### RN-179 — O artefato do PO é uma ÁRVORE: épico → história → tarefa {#rn-179}

O painel "Artefatos gerados" ([RN-159](#rn-159)) listava épico e história lado
a lado, planos, e **ignorava `backlog.task_created`** — justamente o que um dev
agent pega para trabalhar. Os três passaram a formar uma árvore, com o filho
dentro de um colapso do pai, e as tarefas nascem FECHADAS: um épico com trinta
tarefas tomaria o painel inteiro sem que ninguém tivesse pedido.

O parentesco sai do **vínculo que o evento já carrega** —
`backlog.story_created` grava `epicId`, `backlog.task_created` grava `storyId`
—, nunca da vizinhança no log. Nó cujo pai não está entre os eventos carregados
**sobe para a raiz** em vez de ser pendurado no épico mais próximo: inventar
parentesco é pior que mostrar o nó solto, e uma tarefa cuja história ficou fora
da janela é caso normal, não erro.

Cada nível continua sendo um **link** para o Backlog, e o colapso dos filhos
vem ABAIXO da linha em vez de dentro do cabeçalho — cabeçalho de `Disclosure` é
`<button>`, e um `<a>` dentro de um `<button>` é HTML inválido e alvo de clique
ambíguo. O contador do cabeçalho da seção conta a árvore INTEIRA, não só as
raízes: dizer "3" com dezoito tarefas dentro seria o mesmo tipo de número que
não corresponde a nada que a [RN-151](#rn-151) tirou da sidebar.

- **Onde:** `apps/web/src/routes/SessionPage.tsx:2904`
  (`montarArvoreDeBacklog`), `:3097` (as raízes viram item), `:3114` (a
  contagem da árvore)
- **Teste:** `apps/web/src/routes/SessionPage.artefatos-gerados.test.tsx`
  (casos "épico/história/tarefa do PO viram árvore" e "nó sem pai carregado
  aparece na raiz")
- **Origem:** uso real no `exp001` — "mostrar também as tarefas criadas no
  artefato do PO, mas abaixo do épico e ter opção de colapsar"

### RN-180 — O painel diz o que NÃO está mostrando {#rn-180}

`useSessionEvents` busca `{ limit: 200, latest: true }`, e o painel de contexto
lia esse recorte por prop. Consequência: numa sessão de milhares de eventos as
quatro seções mostravam a cauda **como se fosse a sessão inteira** — regra de
negócio capturada no começo da ideação simplesmente não existia, sem aviso
nenhum.

O painel passou a ler o mesmo histórico paginado que a aba de Atividade da
Visão Geral já usava ([RN-099](#rn-099)), com a `queryKey` da cauda
compartilhada com o fio — **zero requisição a mais** no ciclo de poll
([RN-090](#rn-090)/[RN-091](#rn-091)). Duas coisas mudaram com isso:

1. **O feed ganhou o pager que o componente sempre teve.** As props
   `onLoadOlder`/`hasOlder`/`loadingOlder` são opcionais desde a RN-099 e este
   call site nunca as passava — era essa a razão de a sessão perder o começo em
   silêncio.
2. **Uma nota conta quantos eventos faltam.** O número sai de SUBTRAÇÃO sobre o
   `seq` (gapless e por sessão): `menor seq baixado − 1`. Nunca de uma
   requisição a mais — o mesmo mecanismo do "+ N mais antigos" do sino
   ([RN-100](#rn-100)). Alcançando o começo da sessão a nota **desaparece**, em
   vez de afirmar um zero.

As seções derivadas leem `baixados` (tudo que já veio) e não `events` (a janela
de 100 do feed): elas não paginam item a item, e cortá-las na janela as faria
mostrar MENOS do que mostravam antes desta mudança. É o mesmo botão que
alimenta as duas.

O `pausarPoll` desce por `useSessionEventHistory` até `useSessionEvents`, e não
é detalhe: o intervalo de refetch é de cada OBSERVADOR, não da query. Um
segundo observador da mesma chave com timer ligado ressuscitaria o poll que a
tela pausa durante o turno — e com ele a duplicata visual da bolha em
streaming.

- **Onde:** `apps/web/src/lib/hooks.ts:246` (o `pausarPoll` do histórico),
  `:325` (`baixados`); `apps/web/src/routes/SessionPage.tsx:3032`
  (`eventosAnteriores`) e o `ActivityFeed` com o pager, no fim de
  `ContextAside`
- **Teste:** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  (describe "RN-180")
- **Origem:** revisão da própria rodada — o teto de 200 existia em silêncio nas
  quatro seções

### RN-181 — Delegação de área aparece no fio {#rn-181}

Quando uma área (QA, Infra) delega a subagentes e consolida o veredito, os três
desfechos que o lead registra — `delegation.completed`, `delegation.failed` e
`delegation.dispensed` — só existiam no painel de log. Quem acompanhava a
sessão via o gate abrir e fechar **sem nenhum sinal** de que houve uma segunda
tentativa por baixo.

Os três passaram a ser narrados no fio como **aviso compacto**, no formato da
[RN-157](#rn-157) — não bolha: é notificação do que aconteceu dentro da área,
não uma fala. A FRASE sai de `classifyEvent`, a mesma do painel, porque duas
redações do mesmo evento divergem na primeira mudança de payload; e ela já
nomeia o subagente e a área, então o lead **não** é prefixado (produziria "QA
Lead QA Automação concluiu a delegação (qa)").

O contrato externo da área **não muda** (ADR 0038): o fio não passa a endereçar
subagente, só a narrar o que o lead já registrou. A origem da falha viaja junto
em `delegation.failed`, pela mesma razão da [RN-059](#rn-059) — é ela que diz
se o próximo passo é trocar a chave, esperar o provider ou abrir um bug.

- **Onde:** `apps/web/src/routes/SessionPage.tsx:1687`
- **Teste:** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  (describe "RN-181")
- **Origem:** uso real no `exp001` — "quando houver uma nova tentativa e
  consolidação de algum agente deve apresentar no chat"

### RN-182 — O tema é escolhido, persistido e aplicado antes do primeiro paint {#rn-182}

O tema claro existe em `design/tokens.css` desde o começo, sob
`[data-theme='light']`, e **nada em `apps/web` escrevia esse atributo**: o
único jeito de ver o tema claro era digitar o atributo no DevTools. Ele passa a
ser alcançável.

A preferência mora em `localStorage['brabo.theme']`, aceita **só** `'dark'` ou
`'light'`, e o default é `dark` — o tema primário do design system. Quem aplica
é `apps/web/public/theme-boot.js`, **síncrono no `<head>` e antes do bundle**:
`data-theme` decide as cores de todo o `tokens.css`, e aplicá-lo depois da
hidratação faria o usuário do tema claro ver um flash escuro a cada carga.

É **arquivo, não script inline**, e a razão é a mesma que fez as fontes serem
auto-hospedadas (ADR 0036): a imagem de produção serve sob `script-src 'self'`
(`docker/web/nginx.conf`), sem `'unsafe-inline'` e sem nonce. Inline
funcionaria em `pnpm dev:web` e seria **bloqueado na imagem publicada** — o
pior modo de falha possível, porque só aparece depois do deploy.

O caminho inteiro degrada em vez de quebrar: `localStorage` pode lançar (modo
privado, storage bloqueado em iframe) e tema é preferência, não função; valor
desconhecido cai no default em vez de virar um `data-theme` que o CSS não
conhece e que renderizaria sem tema nenhum.

- **Onde:** `apps/web/public/theme-boot.js:41`,
  `apps/web/index.html:53`
- **Teste:** `apps/web/src/lib/tema.test.ts` (describe "contrato com o script
  de boot")
- **ADR:** [0074](adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-183 — A preferência de tema tem uma fonte, e o atributo do `<html>` é a verdade {#rn-183}

Ler, gravar, alternar e observar o tema é `apps/web/src/lib/tema.ts` — o botão
mora no shell e consome essa API, nunca escreve `data-theme` por conta própria.

Três decisões dentro dela:

1. **`temaAtual()` lê o ATRIBUTO primeiro**, e só depois o `localStorage` e o
   default. É o atributo que a tela está mostrando; cair na preferência gravada
   antes dele faria a UI afirmar um tema diferente do que se vê, no exato caso
   em que o boot falhou.
2. **`lerTemaSalvo()` devolve `null`, não o default**, quando não há preferência
   gravada. Quem nunca escolheu pode um dia seguir o sistema operacional
   (`prefers-color-scheme`), e apagar essa distinção aqui tiraria a informação
   de quem decidir isso depois.
3. **`observarTema()` cobre o evento `storage`**, que o navegador dispara nas
   OUTRAS abas do mesmo origin. Sem isso dois separadores abertos ficariam em
   temas diferentes até o próximo reload.

A chave e o default são repetidos em `public/theme-boot.js` porque ele roda
antes do bundle e não pode importar nada. É a única duplicação possível de
divergir em silêncio, e por isso o teste lê o arquivo de boot e reprova se os
dois deixarem de bater.

- **Onde:** `apps/web/src/lib/tema.ts:73`
- **Teste:** `apps/web/src/lib/tema.test.ts`
- **ADR:** [0074](adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-184 — Contraste é medido nos DOIS temas {#rn-184}

Enquanto o tema claro era inalcançável ([RN-182](#rn-182)), medir só o escuro
era honesto: medir uma tela que ninguém pode abrir é medir uma intenção. Com o
botão de tema, deixar de medir o claro passaria a esconder metade da superfície
visível do produto — então os pares passam a ser cobrados nos dois temas, com o
mesmo piso (4,5:1 para texto, 3:1 para elemento de interface).

Para isso, **seis tokens do tema claro mudaram de valor**. O fundo mais
exigente do claro é o `--code-bg` (papel, `#efe4d2`, a um passo das
superfícies), e quem fecha contra ele fecha contra o resto: `--accent`
3,56 → 4,81, `--warning` 3,15 → 4,98, `--success` 3,89 → 5,12, `--violet`
4,16 → 4,95, `--text-muted` 2,76 → 5,17, e `--accent-hover` seguiu o accent um
degrau abaixo. O tema escuro **não mudou um valor**, e a dívida conhecida dele
segue travada pelos mesmos cinco números (3,89 / 3,10 / 3,88 / 3,88 / 4,41).

O `--text-muted` do claro não era dívida: a 2,40:1 sobre `--surface-2` ele
reprovava até o piso de **elemento de interface**, que é o mais baixo que
existe. Era defeito, e o tema claro não tem por que ser pior que o primário.

- **Onde:** `design/tokens.css:208`
- **Teste:** `apps/web/src/lib/contraste.test.ts`,
  `apps/web/src/design-contraste.test.ts`,
  `apps/web/test/design-contraste.test.ts`
- **ADR:** [0074](adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-185 — Os oito papéis de sintaxe, e o valor do handoff só entra medido {#rn-185}

A paleta de realce era três tokens próprios (`--syntax-function`,
`--syntax-comment`, `--syntax-operator`) e cinco reusos de semântico
(`--accent`, `--warning`, `--violet`, `--success`, `--text-primary`). É esse
reuso que fazia a paleta ser medida só no escuro: no claro os semânticos
reprovavam contra o `--code-bg` de papel.

Passa a ter os **oito papéis** do handoff, com o prefixo `--syntax-*` que o
repositório já usa, e cada um com valor próprio por tema. Nomear os oito é o
que permite o realce divergir do semântico no dia em que precisar.

**Valor do handoff só entra quando a medição aprova.** Contra o próprio
`--code-bg` do handoff, cinco dos oito reprovam os 4,5:1 que texto de código
exige — `--syn-cm` 4,09:1 no escuro e 2,32:1 no claro, `--syn-kw` 4,34:1,
`--syn-str` 4,20:1, `--syn-fn` 4,14:1, `--syn-op` 4,00:1. Onde o handoff
reprova, vale o número medido: é a mesma régua do ADR 0036 — a intenção do
handoff vale, o mecanismo (ou o número) que quebra o produto, não.

Os cinco semânticos continuam sendo quem pinta (`SyntaxTokens.module.css` não
mudou nesta entrega) e por isso vão **medidos ao lado** dos oito: enquanto
forem o pixel de verdade, é deles que o piso é cobrado. No tema claro cada
papel tem hoje o MESMO número do semântico que o pinta, de propósito — duas
fontes com números diferentes para o mesmo pixel divergiriam na primeira
correção feita de um lado só.

- **Onde:** `design/tokens.css:111`
- **Teste:** `apps/web/src/lib/contraste.test.ts` (describe "contraste — paleta
  de sintaxe sobre --code-bg")
- **ADR:** [0074](adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-195 — A sidebar recolhe para uma trilha de ícones, com a preferência persistida {#rn-195}

`Shell.tsx` tinha largura fixa (248px) e nenhum jeito de encolher. Passa a
alternar entre `--sidebar-w` (264px) e `--sidebar-w-collapsed` (62px) — os
dois tokens que a Onda 1/frente A já tinha criado em `design/tokens.css` —
com `transition: width .18s ease`. Recolhida, vira uma trilha vertical: um
quadrado de iniciais por projeto (borda na cor de identidade,
[RN-197](#rn-197)) mais um ícone de Atividades; clicar num projeto na
trilha reexpande a barra, abre aquele projeto e navega para ele.

A preferência é do usuário e sobrevive a reload: `brabo.sidebar.collapsed`
(`'1'`/`'0'`) em `apps/web/src/lib/sidebar-state.ts`. Ela é **manual**
(`colapsadoManual`) e se soma por OR a um segundo estado, **automático**
(`autoColapsado`, [RN-201](#rn-201)) — o colapso visível é a união dos dois,
mas só o manual é gravado.

- **Onde:** `apps/web/src/routes/Shell.tsx:340-351` (estado e toggle),
  `apps/web/src/routes/Shell.module.css` (`.sidebar`, `.colapsado .sidebar`,
  `.trilha*`), `apps/web/src/lib/sidebar-state.ts`
  (`lerColapsado`/`gravarColapsado`)
- **Teste:** `apps/web/src/lib/sidebar-state.test.ts` (describe "colapso"),
  `apps/web/src/routes/Shell.test.tsx`
- **Origem:** PROGRAMA 28, Onda 2, frente B —
  `design_handoff_brabo/README.md` seção "Navigation shell"

### RN-196 — Projetos expansíveis revelam as abas do projeto, N ao mesmo tempo {#rn-196}

Cada projeto na sidebar ganha um chevron: clicar nele expande a linha e
revela a lista de abas daquele projeto (Visão geral, Executores, Criativo,
Chat, Code, Backlog, Aprovações, Insights, Gastos, Configurações), cada uma
um link para `/projects/$projectId?tab=<chave>`. Vários projetos podem ficar
abertos ao mesmo tempo — o estado é um `Set<string>` de ids, persistido em
`brabo.sidebar.open`.

A lista de abas e os rótulos vêm de `ABAS_DO_PROJETO`
(`apps/web/src/routes/project-tabs.ts`, dono da frente C, rodando em
paralelo nesta mesma onda) — a sidebar só **lê** o array exportado, nunca
reescreve nomes de aba. **Suposição de shape**, para conferir contra o que a
frente C entregou: `AbaDoProjeto` tem `key: string`, `label: string` e
`count?: (contagens: ContagensDeAba) => number | undefined`, com
`ContagensDeAba = { promocoesPendentes, aprovacoesPendentes,
hipotesesPendentes }`. A sidebar só consegue preencher
`aprovacoesPendentes` de graça (`pendingApprovalsCount` já vem no resumo do
dashboard, [RN-151](#rn-151)); `promocoesPendentes`/`hipotesesPendentes`
entram como `0` — calculá-los exigiria uma consulta nova POR PROJETO
ABERTO na sidebar, a mesma classe de N+1 que a RN-090/091 fechou no
dashboard. Os dois selos continuam corretos dentro da régua da própria
`ProjectPage`; só o preview na sidebar é parcial, e é uma omissão
deliberada, não um bug.

O projeto da rota ATUAL sempre aparece expandido (`projetosAbertosEfetivo`),
mesmo sem estar no `Set` persistido — abrir "de graça" pela rota não grava
nada; só o clique explícito no chevron entra em `brabo.sidebar.open`.

- **Onde:** `apps/web/src/routes/Shell.tsx:353-374` (estado e o efetivo),
  `apps/web/src/routes/Shell.tsx` (`LinhaDeAba`), `apps/web/src/lib/sidebar-state.ts`
  (`lerProjetosAbertos`/`gravarProjetosAbertos`)
- **Teste:** `apps/web/src/lib/sidebar-state.test.ts` (describe "conjuntos"),
  `apps/web/src/routes/Shell.test.tsx`
- **Origem:** PROGRAMA 28, Onda 2, frente B

### RN-197 — Duas cores de projeto, dois propósitos: identidade não é status {#rn-197}

O handoff pede um "ponto de cor do projeto" na linha expandida e o mesmo
princípio de cor na trilha recolhida. O produto já tinha um dot ali —
`NavStatusDot` — mas ele é **status** (orçamento/atividade recente,
derivado sem consulta própria de `useProjectsSummary`/`useProjectsStatus`,
RN-039), não identidade: a cor dele MUDA com o tempo.

Decisão, documentada em vez de resolvida: a linha expandida continua
mostrando só `NavStatusDot` (é informação acionável; duplicar um segundo
dot ao lado seria ruído). A cor de IDENTIDADE — estável por projeto, hash
determinístico do id sobre uma paleta fixa de tokens (`corDoProjeto`,
sem tabela nova, mesma ideia de `AGENTS[key].color`) — aparece só na
trilha recolhida, como borda do quadrado de iniciais, que é onde não há
espaço para os dois dots e onde a identidade (não o status) é o que ajuda a
achar o projeto certo entre vários quadrados parecidos.

Do mesmo jeito, o handoff pede "badge com o total de últimas iterações" no
projeto; o produto usa `pendingApprovalsCount` desde a RN-151, que é
posterior ao handoff e resolve um defeito real (um número que não
correspondia a nada acionável ao clicar). Este badge **não muda** — RN-151
continua valendo, e é o handoff que diverge aqui.

- **Onde:** `apps/web/src/lib/sidebar-state.ts` (`corDoProjeto`),
  `apps/web/src/routes/Shell.tsx` (`NavStatusDot`, comentário da divergência)
- **Teste:** `apps/web/src/lib/sidebar-state.test.ts` (describe "corDoProjeto")
- **Origem:** PROGRAMA 28, Onda 2, frente B — divergência entre
  `design_handoff_brabo/CHECKLIST-CONFRONTO.md` e RN-151

### RN-198 — Atividades agrupa por agente-base/instância REAL, nunca por contador inventado {#rn-198}

A seção Atividades da sidebar é a mesma lógica de agrupamento de
`AgentTimelineTree.tsx`/`timeline-tree.ts` (já usada na Visão geral do
projeto), movida para um lugar novo — não reescrita. `montarArvore` já
agrupa por `evento.actor.id`; a novidade é `agruparPorInstancia`
(`apps/web/src/lib/timeline-tree.ts`), que decide quais ramos formam um
grupo visual de dois níveis.

A "instância" não é um contador renumerado (`-01`/`-02`) — é o `agent_id`
REAL que o produto já escreve: `devAgentId`/`extraDevAgentId`
(`apps/api/src/application/use-cases/execution/activate-execution.use-case.ts:27-38`)
produzem `dev-<modulo>` e `dev-<modulo>-2` (sufixo sempre exatamente `-2`,
porque o teto é DOIS por módulo, [RN-154](#rn-154)). Um ramo só vira
"instância extra" de outro se o agente-base (sem o sufixo) TAMBÉM tiver um
ramo na mesma lista — senão ele é o próprio agente. Agente com uma instância
abre direto nos eventos; com duas, revela um segundo nível, uma linha por
instância, cada uma com sua própria contagem — reaproveitando
`getAgentLastSeenSeq`/`setAgentLastSeenSeq` (`read-state.ts`) que já existia
para o contador de novidade da árvore.

Escopo: só o projeto da ROTA ATUAL (`pathname`), não todos os projetos do
workspace — agregar todos exigiria uma consulta de eventos POR projeto, a
mesma classe de N+1 que a RN-090/091 fechou no dashboard. Reusa o MESMO par
de hooks que `AgentTimelineTree`/`SessionPage` já usam
(`useActiveExecutionSession` + `useSessionEvents`, mesma `queryKey`) — zero
requisição nova quando as duas telas estão montadas juntas.

O que abre/fecha é persistido em `brabo.sidebar.agents`, com o formato do
handoff adaptado aos ids reais: `agenteBase` (grupo aberto, ex.:
`dev-backend`) ou `${agenteBase}/${instancia}` (uma instância específica
aberta, ex.: `dev-backend/dev-backend-2`).

- **Onde:** `apps/web/src/lib/timeline-tree.ts` (`agruparPorInstancia`,
  `GrupoDeAgente`), `apps/web/src/routes/Shell.tsx:237-311`
  (`GrupoDeAtividade`, `InstanciaDeAgente`), `apps/web/src/routes/Shell.tsx:376-399`
  (escopo e persistência)
- **Teste:** `apps/web/src/lib/timeline-tree.test.ts` (describe
  "agruparPorInstancia"), `apps/web/src/lib/sidebar-state.test.ts`
- **Origem:** PROGRAMA 28, Onda 1/frente B0 (achado, sem código) e Onda
  2/frente B (implementação)

### RN-199 — Botão de tema no rodapé, funcional recolhido {#rn-199}

O rodapé da sidebar ganha um botão sol/lua que consome a API de
`apps/web/src/lib/tema.ts` da Onda 1/frente A (`temaAtual`,
`alternarTema`, `observarTema`) sem reimplementar nada — só o BOTÃO é novo.
Funciona recolhido (62px): o rótulo textual some, mas `aria-label`/`title`
continuam descrevendo o tema atual e o clique continua alternando.

- **Onde:** `apps/web/src/routes/Shell.tsx:130-148` (`BotaoDeTema`)
- **Teste:** `apps/web/src/lib/tema.test.ts` (a API, inalterada por esta RN)
  — `Shell.test.tsx` não duplica a suite do tema, só monta o Shell
- **Origem:** PROGRAMA 28, Onda 2, frente B

### RN-200 — Só Projetos e Atividades como itens globais {#rn-200}

Os dois itens sem rota do rodapé da nav ("Chat global"/"Configurações",
`title="em breve"`) saem. O handoff é explícito: só Projetos e Atividades
são itens GLOBAIS — tudo o mais é escopado a um projeto. "Configurações"
continua existindo, como ABA de projeto ([RN-196](#rn-196)) dentro da linha
expandida — o que sai é o item solto sem destino.

- **Onde:** `apps/web/src/routes/Shell.tsx` (o bloco `.globalNav`/
  `.inertNavItem` da FASE 17a foi removido, sem substituto global)
- **Teste:** `apps/web/src/routes/Shell.test.tsx` (describe "sem itens
  globais inertes")
- **Origem:** PROGRAMA 28, Onda 2, frente B —
  `design_handoff_brabo/README.md` seção "Navigation shell"

### RN-201 — Projeto/aba ativos persistem entre páginas; a aba Código recolhe sem gravar preferência {#rn-201}

Duas chaves finais do handoff: `brabo.project` (o projeto ativo) e
`brabo.tab` (a aba ativa) — gravadas quando o usuário clica um link de aba
NA SIDEBAR (`LinhaDeAba`/o link de nome do projeto). `?tab=` na URL só vale
como deep-link INICIAL (`project-tabs.ts`, FASE 24) — trocar de aba dentro
de `ProjectPage.tsx` é estado local e não escreve na URL depois do
primeiro load, então estas chaves são o único jeito de a preferência
sobreviver entre uma navegação e outra.

**Auto-collapse do Código, sem gravar preferência.** A rota de Código
(`ProjectCodeTab.tsx`) não é uma URL própria — é uma ABA dentro de
`ProjectPage.tsx`, montada/desmontada por troca de `tab` (React desmonta o
componente anterior ao trocar o `component` da aba ativa). Isso descarta a
alternativa óbvia ("observar a URL no Shell"): a URL não muda ao trocar de
aba, só no load inicial. A solução é um `Context` — `AutoCollapseContext`
(`apps/web/src/lib/sidebar-state.ts`) —, porque `Shell.tsx` fica ACIMA de
`<Outlet />` na árvore e não há como uma aba passar uma prop pra cima sem
um canal explícito. `useAutoCollapseSidebar()` chama `registrar(true)` no
`useEffect` de montagem e `registrar(false)` na limpeza; o Shell soma esse
sinal (`autoColapsado`) por OR ao colapso manual, e só o manual é
persistido — por isso o estado anterior volta sozinho ao sair do Código.

- **Onde:** `apps/web/src/lib/sidebar-state.ts` (`AutoCollapseContext`,
  `useAutoCollapseSidebar`, `lerProjetoAtivo`/`gravarProjetoAtivo`,
  `lerAbaAtiva`/`gravarAbaAtiva`), `apps/web/src/routes/Shell.tsx`
  (`autoCollapseValue`, o `Provider` em torno de `<Outlet />`),
  `apps/web/src/routes/ProjectCodeTab.tsx` (a única chamadora hoje)
- **Teste:** `apps/web/src/lib/sidebar-state.test.ts` (describe
  "useAutoCollapseSidebar", "projeto e aba ativos")
- **Origem:** PROGRAMA 28, Onda 2, frente B —
  `design_handoff_brabo/CHECKLIST-CONFRONTO.md` seção 1, "Auto-collapse"
### RN-202 — A aba `sessions` continua "Chat", nunca "Chat RAG" {#rn-202}

O handoff de design mais recente do PROGRAMA 28 chama a aba consultiva de
"Chat RAG" (`designs/Brabo Chat.dc.html`), mas o produto não tem essa
funcionalidade: não há pipeline de indexação por projeto, não há índice
vetorial, não há UI de citação de fonte. O ADR 0075 pôs `embed` no contrato de
`LLMProvider` — a operação existe e é PROVADA no Ollama —, mas nada ainda a
CONSOME. A aba `sessions` de hoje é o Chat consultivo comum da
[RN-104](#rn-104): um agente respondendo com o contexto da sessão, sem
produzir backlog, sem RAG nenhum por trás.

Rotular a aba "Chat RAG" hoje anunciaria uma capacidade que não existe — o
mesmo erro que o [ADR 0042](adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
já recusa para modelo de catálogo ("não ativar modelo descoberto
automaticamente"). O rótulo muda no dia em que a funcionalidade chegar, junto
com o dado por trás dele — nunca antes.

- **Onde:** `apps/web/src/routes/project-tabs.ts:144` (entrada `key:
  'sessions'`)
- **Teste:** `apps/web/src/routes/project-tabs.test.tsx` (describe "abas do
  projeto derivam de um registro só", `'RN-202 — a aba \`sessions\` continua
  "Chat", nunca "Chat RAG"'`)
- **ADR:** [0078](adr/0078-moldura-de-tela-e-o-registro-de-abas-diverge-do-handoff.md)

### RN-203 — O handoff é referência visual, não teto de quantas abas o produto tem {#rn-203}

O handoff de design lista 7 abas de projeto (Visão geral, Criativo, Código,
Chat RAG, Gastos, Aprovações, Configurações); o registro
(`apps/web/src/routes/project-tabs.ts`) tem 10. As três a mais —
`executores` ([RN-121](#rn-121)), `backlog` ([RN-048](#rn-048)) e
`insights` (hipóteses do Psicólogo aguardando decisão) — nasceram DEPOIS do
handoff ser desenhado, todas com dado real, contador derivado de consulta e
pelo menos uma RN própria com teste.

O handoff fixa como cada tela deve se PARECER — cores, tipografia,
espaçamento, o desenho da moldura —, e essa parte foi seguida à risca nesta
mesma mudança (header, régua, rolagem, largura do conteúdo). Ele não congela o
inventário de abas no dia em que foi escrito. Apagar as três para "bater" com
o handoff destruiria informação que o produto já sabia mostrar, pelo motivo
errado.

- **Onde:** `apps/web/src/routes/project-tabs.ts:91` (o `REGISTRO`)
- **Teste:** `apps/web/src/routes/project-tabs.test.tsx` (describe "abas do
  projeto derivam de um registro só", `'RN-203 — as 3 abas que o handoff não
  previu continuam no registro'`)
- **ADR:** [0078](adr/0078-moldura-de-tela-e-o-registro-de-abas-diverge-do-handoff.md)
### RN-210 — "Recomendado" é uso real e custo, nunca nota calculada {#rn-210}

O bloco "Melhores modelos por capacidade" (Configurações) não tem coluna de
score. O handoff mostra uma nota por capacidade (código 9.4, imagem 9.1…), mas
é dado FICTÍCIO do mock — nenhum provider publica "qualidade de código" e o
produto não mede isso em lugar nenhum. Calcular um número aqui seria o mesmo
"palpite vestido de dado" que o [ADR 0041](adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)
proíbe para capability de MODELO, agora sobre qualidade.

Em vez disso, "recomendado"/"alternativa" saem de dois sinais reais, entre os
modelos que a curadoria DESTE workspace marcou para aquela capacidade (`uses`,
[RN-057](#rn-057)): primeiro os mais usados por agentes DESTE projeto — a
mesma cascata que resolve o binding vigente de cada agente —, custo (do
catálogo, ascendente) como desempate. "O que o time já escolheu" é o sinal
mais honesto disponível sem inventar nota. Capacidade sem nenhum modelo curado
mostra "sem cobertura curada" — nunca esconde a linha, mesmo padrão que a
coluna Origem de `ModelsSection` já usa para o binding pulado.

- **Onde:** `apps/web/src/routes/ProjectSettingsTab.tsx`
  (`MelhoresModelosPorCapacidadeSection`)
- **Teste:** `apps/web/src/routes/ProjectSettingsTab.test.tsx`
  (describe "MelhoresModelosPorCapacidadeSection")
- **ADR:** [0077](adr/0077-ranking-de-modelos-por-capacidade-sem-nota-inventada.md)

### RN-211 — Gasto por provider na tela é Ranking, não paleta categórica inventada {#rn-211}

O handoff pede barras diárias empilhadas por provider e uma quebra por
provider. A skill de dataviz do repositório manda validar paleta
categórica por script antes de usar, nunca por olho: `validate_palette.js`
reprova toda combinação de 3+ tokens de `design/tokens.css` contra pelo
menos um dos dois temas — `--accent`+`--violet` é o único par que passa
nos dois (vários `--syntax-*` são literalmente o mesmo hex de
`--warning`/`--violet`/`--success`, medido). Com 9 providers (ADR 0043) e
2 cores validadas, ciclar a paleta é o anti-padrão que a própria skill
nomeia ("a 9th series is never a generated hue"), e inventar hex novo
violaria a instrução desta frente. A quebra por provider vira `Ranking` —
a mesma peça de "Por modelo"/"Por projeto"/"Por agente e pessoa", sem
identidade por cor. A série DIÁRIA por provider não é entregue:
`sumGroupedBy` (ADR 0076) agrupa por uma dimensão de cada vez, e não existe
agregação cruzada dia×provider no backend desta onda.

- **Onde:** `apps/web/src/lib/spend.ts` (bloco "Gasto por PROVIDER na
  tela"), `apps/web/src/routes/ProjectSpendTab.tsx` (`GastoDoWorkspace`)
- **Teste:** `apps/web/src/routes/ProjectSpendTab.test.tsx` (describe "a
  audiência do owner" — `'mostra os cinco recortes do workspace,
  incluindo provider'`)
- **ADR:** [0076](adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-212 — Bloco "por projeto" é o TokenMeter plugado ao orçamento real {#rn-212}

A aba de Gastos ganha um bloco por PROJETO (não por audiência):
`OrcamentoDoProjeto` lê `GET /projects/:id/budget` e planta o resultado
direto no `TokenMeter` existente, que já implementa os limiares 70/90
(`tokenThreshold`) — nenhum componente novo. Três leituras: carregando
(silencioso, evita piscar antes do papel resolver a audiência de baixo),
sem orçamento definido (nota em texto, sem CTA) e erro (silencioso — na
prática quase sempre 403 de quem tem papel de WORKSPACE mas não é
`maintainer` no PROJETO, e mostrar banner de propósito seria alarme falso
para a maioria dos membros, o mesmo padrão já usado pelo `TokenMeter`
compacto de `ProjectPage.tsx`).

- **Onde:** `apps/web/src/routes/ProjectSpendTab.tsx`
  (`OrcamentoDoProjeto`)
- **Teste:** `apps/web/src/routes/ProjectSpendTab.test.tsx` (describe "o
  orçamento do projeto")

### RN-213 — Alerta de custo é leitura de `lastThresholdNotified`, nunca recálculo {#rn-213}

`alertaDeOrcamento` não reimplementa `crossedThresholds`
(`apps/api/src/domain/llm/budget-threshold.ts`): lê o campo que o backend
já grava no momento em que uma chamada real cruza 70/90/100%, e só decide
a cor (`warning` abaixo de 90, `danger` a partir de 90) e se o texto deve
avisar bloqueio ativo (`policy === 'block' && spentMicros >=
limitMicros`). Nenhuma regra de negócio nova — puramente apresentação de
um dado que já existe.

- **Onde:** `apps/web/src/lib/spend.ts` (`alertaDeOrcamento`)
- **Teste:** `apps/web/src/lib/spend.test.ts` (describe "alertaDeOrcamento
  (RN-213)"); `apps/web/src/routes/ProjectSpendTab.test.tsx` (describe "o
  orçamento do projeto")

### RN-214 — KPI de economia com modelo local fica de fora por falta de preço contrafactual {#rn-214}

`TokenMeter` já tem `savingsBRL`/`savingsPct` prontos para receber o
número, e permanecem não alimentados de propósito. O card exigiria um
preço CONTRAFACTUAL — quanto a mesma chamada teria custado num modelo
pago — que não existe em lugar nenhum do produto: o catálogo (ADR 0042)
só congela o preço do modelo REALMENTE usado (RN-044), e não há
mapeamento declarado "modelo local X ~ modelo pago Y". Inventá-lo aqui
seria a mesma classe de "nota vestida de dado" que a RN-210 já recusou
para ranking de capacidade. Pendência registrada no backlog para quando
existir um preço contrafactual defensável e versionado.

- **Onde:** `apps/web/src/routes/ProjectSpendTab.tsx` (comentário "KPI de
  economia com modelos locais — CORTE DECLARADO", fim do arquivo)

### RN-215 — Aba Problemas nasce com estado vazio honesto {#rn-215}

Não há lint nem teste integrado sobre o código do projeto gerido; a aba
Problemas do painel inferior (handoff `design_handoff_brabo`) diz isso
explicitamente em vez de mostrar contagem inventada (o mock do handoff traz
badge "3"). Mesmo padrão já usado pelo Terminal (FASE 25b) e pelo item
"Testes" desabilitado do rail.

- **Onde:** `apps/web/src/routes/code/CodeBottomPanel.tsx`
- **Teste:** `apps/web/src/routes/code/CodeBottomPanel.test.tsx` —
  "Problemas diz honestamente que não há lint/teste integrado, sem
  contagem inventada"

### RN-216 — Aba Saída nasce com estado vazio honesto {#rn-216}

Não há stream de comando de build/deploy nesta aba — ele dependeria do
terminal interativo (FASE 25b), que não existe. A aba explica isso e lembra
que `git push`/PR/deploy não saem pelo terminal de qualquer forma (RN-106).

- **Onde:** `apps/web/src/routes/code/CodeBottomPanel.tsx`
- **Teste:** `apps/web/src/routes/code/CodeBottomPanel.test.tsx` — "Saída
  diz honestamente que não há stream de comando, sem simular execução"

### RN-217 — Status bar da aba Código só mostra dado real {#rn-217}

A status bar de 24px (`CodeShell.tsx`) mostra `↑N ↓M` de commits da branch
atual (via `getCodeBranches`, mesma `queryKey` de `CodeBranchPicker` —
dedup, zero requisição extra, RN-090/091) e a linguagem do arquivo ativo
(`linguagemPorCaminho`). Posição do cursor e contagem de erros/testes do
mock do handoff ficaram de fora: `CodeEditor` não expõe seleção/caret
rastreável e não há lint/teste integrado (mesma decisão da RN-215).

- **Onde:** `apps/web/src/routes/code/CodeShell.tsx`
- **Teste:** `apps/web/src/routes/code/CodeShell.test.tsx` — "a status bar
  mostra ↑/↓ real da branch atual" e "sem ahead/behind (branch em dia), a
  status bar não mostra o par vazio"

### RN-218 — Foco visível nas abas próprias do painel inferior {#rn-218}

As abas de `CodeBottomPanel.tsx` são implementação própria (não o `Tabs` do
design system) e não herdavam o `:focus-visible` calibrado que
`Tabs.module.css` ganhou na Onda 2/frente C. Corrigido com o mesmo padrão de
`Input.module.css` (ADR 0036), incluindo `forced-colors`.

- **Onde:** `apps/web/src/routes/code/CodeBottomPanel.module.css`

### RN-219 — Os três escopos do índice de chunks são honestos, e mutuamente exclusivos por CHECK {#rn-219}

O índice do Chat RAG cobre só três fontes de texto que o produto já sabe de
onde vieram: `docs`, `adr` e `session`. Código-fonte e Pull Requests ficam
de fora de propósito — indexá-los sem um watcher de reindexação a cada
`push` faria o índice mentir sobre cobertura, a mesma classe de erro que o
ADR 0042 já recusa para capability de modelo. `session_id`/`source_path`
são mutuamente exclusivos por CHECK, não por convenção de aplicação, mesmo
padrão de `projects.workspace_mode`/`workspace_path` (ADR 0072): `scope =
'session'` exige `session_id` e recusa `source_path`; `docs`/`adr` exigem
`source_path` e recusam `session_id`. A trava fica no banco porque quem vai
escrever esta tabela é um pipeline (Onda 4) que não necessariamente passa
pelo mesmo caso de uso toda vez.

- **Onde:** `apps/api/src/db/schema.ts` (`chunkScopeEnum` e os dois CHECK
  da tabela `chunks`)
- **Teste:** `apps/api/test/infrastructure/persistence/chunk.repository.spec.ts`
  ("recusa chunk de docs sem source_path — o CHECK da migração 0045, não
  validação de aplicação")
- **ADR:** [0079](adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-220 — Vetor e busca léxica vivem na mesma linha, nunca em tabelas separadas {#rn-220}

`chunks.embedding` (pgvector) e `chunks.search_vector` (tsvector) são
colunas irmãs da MESMA tabela, não duas tabelas ligadas por `chunk_id`.
Separar exigiria um JOIN em toda busca híbrida (Onda 4) e abriria espaço
para as duas divergirem — um trecho com vetor mas sem entrada léxica, ou
vice-versa — sem nenhum mecanismo do banco impedindo. Uma linha, uma fonte
de verdade para as duas metades da busca.

- **Onde:** `apps/api/src/db/schema.ts` (tabela `chunks`)
- **Teste:** `apps/api/test/infrastructure/persistence/chunk.repository.spec.ts`
  (as três specs escrevem e leem as duas colunas na mesma linha)
- **ADR:** [0079](adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-221 — `search_vector` nunca é escrita pela aplicação — é coluna GENERATED {#rn-221}

`search_vector` é `GENERATED ALWAYS AS (to_tsvector('portuguese', content))
STORED`. Nenhum caso de uso, repositório ou script escreve nela — o
Postgres a mantém coerente com `content` por construção, pronta na mesma
transação do `INSERT`, sem depender de nenhum provider de LLM responder
(diferente de `embedding`, que só chega quando um pipeline de indexação
existir).

- **Onde:** `apps/api/src/db/schema.ts` (coluna `search_vector`)
- **Teste:** `apps/api/test/infrastructure/persistence/chunk.repository.spec.ts`
  ("grava um chunk de docs com vetor e devolve o search_vector gerado pela
  GENERATED ALWAYS AS")
- **ADR:** [0079](adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-222 — A dimensão do vetor é documentada, não adivinhada, e `embedding` chega depois do chunk {#rn-222}

`chunks.embedding` é `vector(768)` — a dimensão real do `nomic-embed-text`
do Ollama, o único provider que hoje declara `capabilities.embeddings:
true` (RN-191, ADR 0075). Um índice vetorial tem dimensão FIXA: trocar de
modelo de embedding no futuro é migração nova, nunca parâmetro de runtime.
A coluna é NULLABLE: esta tabela guarda o CHUNK (texto recortado), e o
VETOR pode chegar depois via um pipeline de indexação assíncrono que ainda
não existe (Onda 4) — sem isso, chunking teria que esperar embedding,
misturando duas falhas de natureza diferente (parsing de documento contra
chamada de rede a um provider) numa escrita atômica só.

- **Onde:** `apps/api/src/db/schema.ts` (coluna `embedding`)
- **Teste:** `apps/api/test/infrastructure/persistence/chunk.repository.spec.ts`
  ("grava um chunk de docs com vetor..." grava com `embedding` preenchido;
  as outras duas specs gravam sem ele, confirmando a nulabilidade)
- **ADR:** [0079](adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md); [RN-191](#rn-191)

### RN-223 — O índice vetorial é HNSW, não IVFFlat, porque a tabela nasce vazia {#rn-223}

IVFFlat precisa de linhas já carregadas para treinar as listas (`lists`) e
fica ruim se construído sobre tabela vazia — que é exatamente o estado
desta tabela ao nascer, sem pipeline de indexação ainda (Onda 4). HNSW
constrói o grafo incrementalmente, inserção por inserção, sem etapa de
treino — bom desde a primeira linha. `vector_cosine_ops` porque é a
métrica que embeddings de texto geralmente esperam (o ranking de
similaridade não deveria mudar com a magnitude do vetor).

- **Onde:** `apps/api/src/db/migrations/0045_shallow_randall.sql`
  (`chunks_embedding_idx`)
- **ADR:** [0079](adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-224 — A migração cria a extensão pgvector sozinha, de forma idempotente {#rn-224}

A migration `0045` executa `CREATE EXTENSION IF NOT EXISTS vector` antes de
criar a tabela, em vez de assumir que `docker/postgres/init.sql` já rodou —
esse arquivo só executa na PRIMEIRA inicialização do volume Postgres, e um
ambiente com volume antigo pode não ter a extensão. `IF NOT EXISTS` é
idempotente: local (onde a extensão já estava instalada) e um ambiente
novo passam pela mesma linha sem diferença de comportamento.

- **Onde:** `apps/api/src/db/migrations/0045_shallow_randall.sql`
- **ADR:** [0079](adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-225 — Migração que pode exigir privilégio de operador nasce em `breaking/` {#rn-225}

Criar uma extensão exige que o role da aplicação tenha `CREATEDB` (ou que a
extensão esteja marcada "trusted" pelo DBA). Localmente o role é
superusuário, mas nada garante isso em produção — gerenciadores de
Postgres administrado frequentemente não dão superusuário à aplicação. Se
a migration falhar aí, é ação do OPERADOR antes do deploy (rodar `CREATE
EXTENSION vector;` uma vez, como superusuário), não bug do produto — o
critério do CLAUDE.md para nascer em `breaking/` em vez de
`feature/`/`bugfix/`.

- **Onde:** branch `breaking/tabela-de-chunks`,
  `apps/api/src/db/migrations/0045_shallow_randall.sql` (comentário que
  documenta a decisão dentro da própria migration)
- **ADR:** [0079](adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-226 — `ChunkRepository` cobre só escrita/leitura básica; `createMany` é operação de lote {#rn-226}

O port só tem `create`, `createMany`, `findById` e `listByProject` — busca
híbrida (vetor + léxico, pesos, limiar) é da Onda 4 (G2) e deliberadamente
NÃO entra aqui: o port guarda dado, o caso de uso decide o que fazer com
ele. `createMany` existe porque uma indexação recorta N trechos de um
documento/sessão de uma vez, evitando N round-trips por documento
indexado.

- **Onde:** `apps/api/src/application/ports/chunk-repository.port.ts`,
  `apps/api/src/infrastructure/persistence/drizzle/chunk.repository.ts`
- **Teste:** `apps/api/test/infrastructure/persistence/chunk.repository.spec.ts`
  ("createMany grava um lote e listByProject filtra por escopo, sem
  misturar docs e session")
- **ADR:** [0079](adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-227 — Selo de status da sessão cobre os 5 estados reais, não os 4 do handoff {#rn-227}

O handoff pede 4 selos (ativa/aguardando/fechada/abortada) para os 5
estados reais da máquina (`created/active/closing/closed/closed_abnormally`).
`closed_abnormally`→abortada e `created`→aguardando são diretos. `closing`
NÃO é fundido com "fechada": ganha selo próprio ("encerrando", tom
`accent`, pulsante), porque em `closing` o desfecho (`closed` ou
`closed_abnormally`) ainda não é conhecido — chamá-la de "fechada"
mentiria sobre isso.

- **Onde:** `apps/web/src/routes/ProjectSessionsTab.tsx` (`SELO_DO_STATUS`)
- **Teste:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — describe
  "ProjectSessionsTab — selo de status (RN-227)"

### RN-228 — Filtro pill agrupa os 2 estados sem pill própria por TRAJETÓRIA {#rn-228}

Os filtros pill do handoff (todas/ativas/fechadas/abortadas) só cobrem 4
dos 5 estados. `created` (aguardando) entra no pill "Ativas" — ainda não
chegou a lugar nenhum, é "sessão em jogo". `closing` entra no pill
"Fechadas" — já está a caminho de fechar sem erro. O SELO de cada linha
(RN-227) nunca é reescrito pelo filtro; o pill só agrupa.

- **Onde:** `apps/web/src/routes/ProjectSessionsTab.tsx`
  (`correspondeAoFiltro`)
- **Teste:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — describe
  "filtro pill agrupa os 2 estados sem pill própria (RN-228)"

### RN-229 — KPI "custo do mês" da aba Criativo é o consumo do ATOR, não o total do projeto {#rn-229}

Reaproveita `getMySpend(projectId, 30)` — a MESMA queryKey que
`ProjectSpendTab.tsx#MeuConsumo` usa para a visão do membro (RN-101, ADR
0063), sem agregação nova. NUNCA mostra o total do projeto somando todo
mundo (`porProjeto` em `getWorkspaceSpendReport`), porque esse dado é
owner-only e a aba Criativo é vista por qualquer membro do projeto —
mostrar o total geral vazaria gasto alheio para quem a RN-060/101 não
autoriza a ver.

- **Onde:** `apps/web/src/routes/ProjectSessionsTab.tsx` (`CriativoKpis`)
- **Teste:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — describe
  "KPIs da aba Criativo", casos "caminho feliz" e "CASO DE FALHA"

### RN-230 — KPI "taxa ideação → commit" é declarado ausente, nunca calculado {#rn-230}

Não existe, em lugar nenhum do produto, vínculo entre uma sessão criativa e
o commit que ela produziu. A aba Criativo mostra "—" com a frase "não
medido: sessão não é vinculada a commit hoje" em vez de inventar um
cálculo — mesma classe de erro que o ADR 0042 já recusa para nota de
modelo.

- **Onde:** `apps/web/src/routes/ProjectSessionsTab.tsx` (`CriativoKpis`)
- **Teste:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — "'Taxa
  ideação → commit' é DECLARADA ausente — nunca um número calculado"

## PROGRAMA 28 — Onda 4, frente G2: pipeline de indexação e busca híbrida do Chat RAG (RN-231..238, ADR 0080)

### RN-231 — `ChunkRepository` ganha DELETE e as duas metades da busca híbrida {#rn-231}

O port da Onda 3 (RN-226) só cobria escrita/leitura básica. A Onda 4
acrescentou `deleteByScope`/`deleteBySession` (para reindexação idempotente
por full rebuild — apagar e recriar, nunca UPDATE) e
`searchByVector`/`searchByLexicalQuery` (as duas metades da busca híbrida,
cada uma uma consulta independente, aproveitando o índice feito para ela —
HNSW ou GIN). `deleteByScope` é tipado `Exclude<ChunkScope, 'session'>`:
apagar `session` por projeto inteiro apagaria sessões que não estão sendo
reindexadas agora, então sessão só apaga por `deleteBySession`.

- **Onde:** `apps/api/src/application/ports/chunk-repository.port.ts`
  (linhas 105-146), `apps/api/src/infrastructure/persistence/drizzle/chunk.repository.ts`
- **Teste:** `apps/api/test/infrastructure/persistence/chunk.repository.spec.ts`
  — describes "Onda 4 (G2)" (delete por escopo/sessão, busca por
  vetor/léxico, caso feliz e vazio de cada um)
- **ADR:** [0080](adr/0080-busca-hibrida-pesos-limiar-e-citacao.md)

### RN-232 — Origem do texto indexado: `docs`/`adr` do repositório do PRÓPRIO projeto, `session` só de `chat.message`/`agent.response` {#rn-232}

`docs`/`adr` são indexados via `ReadProjectCodeUseCase` — a mesma superfície
da aba Code, com a mesma credencial do owner, o mesmo portão de container
(RN-105) e a mesma checagem de caminho (RN-095) — nunca a documentação do
Brabo enquanto produto. `session` indexa só dois tipos de evento
(`chat.message`, `agent.response`); o resto do event log (`tool.call`,
`agent.status`, `agent.error`...) é mecanismo/falha, não conhecimento
citável.

- **Onde:** `apps/api/src/application/use-cases/rag/index-project-docs.use-case.ts`
  (linhas 16-17, 64), `apps/api/src/application/use-cases/rag/index-session.use-case.ts`
  (linha 29, 45)
- **Teste:** `apps/api/test/application/use-cases/rag/index-project-docs.use-case.spec.ts`,
  `apps/api/test/application/use-cases/rag/index-session.use-case.spec.ts`
  (casos felizes + "projeto sem docs/" + "evento sem payload.text é
  ignorado")
- **ADR:** [0080](adr/0080-busca-hibrida-pesos-limiar-e-citacao.md)

### RN-233 — Provider de embedding indisponível: grava sem vetor e declara a lacuna, nunca finge indexação completa {#rn-233}

Quando `ollama`/`nomic-embed-text` não responde, `RagEmbeddingService.embedMany`
não lança — devolve `available: false` e `null` por entrada pedida. O
pipeline grava os chunks mesmo assim (`embedding: null`; `search_vector` é
`GENERATED ALWAYS AS` e não depende de provider nenhum), e o relatório de
indexação declara a lacuna (`embedding: { available, embedded, skipped,
reason }`). A mesma degradação vale na busca: `HybridSearchUseCase` roda só
com o sinal léxico e `vectorAvailable: false` avisa.

- **Onde:** `apps/api/src/application/use-cases/rag/rag-embedding.service.ts`
  (linhas 53-58)
- **Teste:** `apps/api/test/application/use-cases/rag/rag-embedding.service.spec.ts`
  — "CASO DE FALHA: provider sem a capability..." e "CASO DE FALHA: provider
  que lança no meio do lote..."; `index-project-docs.use-case.spec.ts`/
  `index-session.use-case.spec.ts` — "CASO DE FALHA: provider de embedding
  indisponível grava os chunks SEM vetor..."; `hybrid-search.use-case.spec.ts`
  — "quando o embedding está indisponível, degrada para busca só léxica"
- **ADR:** [0080](adr/0080-busca-hibrida-pesos-limiar-e-citacao.md)

### RN-234 — Busca híbrida: duas consultas independentes, fusão por peso (0.6/0.4), limiar 0.2, e o contrato de citação {#rn-234}

`searchByVector`/`searchByLexicalQuery` são consultas SEPARADAS (nunca um
JOIN), fundidas em `HybridSearchUseCase` por soma ponderada
(`RAG_SEARCH_WEIGHT_VECTOR = 0.6`, `RAG_SEARCH_WEIGHT_LEXICAL = 0.4` — as
escalas de cosseno e `ts_rank` normalizado não são comparáveis por
natureza) e cortadas em `RAG_SEARCH_SCORE_THRESHOLD = 0.2`. Nenhum dos
quatro números vem de calibração com dado real — são ponto de partida
documentado. A citação (`HybridSearchHit`) expõe
`chunkId`/`content`/scores separados (`null`, não zero, quando o sinal não
achou o chunk)/`origin` como união discriminada por `kind` (`file` com
`sourcePath`/`headingPath`, `session` com `sessionId`/`eventId`).

- **Onde:** `apps/api/src/application/use-cases/rag/hybrid-search.use-case.ts`
  (linhas 44-113), `apps/api/src/domain/rag/rag-search-limits.ts`
  (linhas 60-93), `apps/api/src/domain/rag/rag-citation.ts` (linhas 12-71)
- **Teste:** `apps/api/test/application/use-cases/rag/hybrid-search.use-case.spec.ts`
  (fusão/ordenação/limiar, query fora da faixa, degradação léxico-only,
  origin de sessão) e `apps/api/test/infrastructure/persistence/chunk.repository.spec.ts`
  (as consultas SQL de fato, contra pgvector/tsvector real)
- **ADR:** [0080](adr/0080-busca-hibrida-pesos-limiar-e-citacao.md)

### RN-235 — Chunking: 1200 caracteres, 150 de sobreposição, por parágrafo/heading {#rn-235}

`CHUNK_TARGET_CHARS = 1200` (~300 tokens em português),
`CHUNK_OVERLAP_CHARS = 150` (12,5%), com corte preferindo quebra de
parágrafo, depois de palavra, dentro de uma janela de 200 caracteres.
Markdown (`docs`/`adr`) é dividido por HEADING antes de ser recortado por
tamanho, preservando `headingPath`. Números documentados como ponto de
partida ajustável, não calibrados contra dado real de qualidade de
recuperação (não existe, ainda, um corpo de perguntas reais rodado contra
este índice).

- **Onde:** `apps/api/src/domain/rag/chunking.ts` (linhas 30-31, 53 em
  diante)
- **Teste:** `apps/api/test/domain/rag/chunking.spec.ts` (texto que
  cabe/não cabe, texto vazio, sobreposição real, texto patológico sem
  espaço, headings aninhados, markdown sem heading)
- **ADR:** [0080](adr/0080-busca-hibrida-pesos-limiar-e-citacao.md)

### RN-236 — Reindexação é sempre MANUAL, full rebuild idempotente {#rn-236}

Não há watcher por push nem por fechamento de sessão. `ReindexProjectUseCase`
roda `docs`/`adr` uma vez e uma `IndexSessionUseCase` por sessão do projeto,
cada indexação apagando o escopo/sessão antes de recriar — rodar duas vezes
seguidas não duplica. Disparado por `POST /projects/:projectId/rag/reindex`,
`role:maintainer`.

- **Onde:** `apps/api/src/application/use-cases/rag/reindex-project.use-case.ts`
  (linha 36)
- **Teste:** `apps/api/test/application/use-cases/rag/reindex-project.use-case.spec.ts`
  (agrega docs+sessões, embeddingAvailable falso quando qualquer rodada
  falha, projeto inexistente)
- **ADR:** [0080](adr/0080-busca-hibrida-pesos-limiar-e-citacao.md)

### RN-237 — Cobertura do índice é contagem REAL, nunca "há N minutos" inventado {#rn-237}

`GetRagCoverageUseCase` conta arquivos `.md` reais no repositório do
projeto contra quantos têm chunk, e sessões do projeto contra quantas têm
chunk. Não existe coluna de timestamp de indexação por escopo, e a
resposta não inclui nenhum "reindexado há Xmin" — um número chutado
mentiria (mesma régua do ADR 0042 para nota de modelo).

- **Onde:** `apps/api/src/application/use-cases/rag/get-rag-coverage.use-case.ts`
  (linha 47)
- **Teste:** `apps/api/test/application/use-cases/rag/get-rag-coverage.use-case.spec.ts`
- **ADR:** [0080](adr/0080-busca-hibrida-pesos-limiar-e-citacao.md)

### RN-238 — As três rotas HTTP do RAG dividem papel por quem MUDA o que o produto gasta {#rn-238}

`POST .../rag/search` e `GET .../rag/coverage` são `role:viewer` (leitura
pura); `POST .../rag/reindex` é `role:maintainer`, porque dispara N
chamadas ao repositório do projeto e ao provider de embedding — mesma
régua "muda o que o produto gasta sem perguntar" do teto de paralelismo de
área (RN-083).

- **Onde:** `apps/api/src/interfaces/http/rag/rag.controller.ts` (linhas
  50, 57, 81, 98), `docs/security-surface.md`
- **Teste:** `apps/api/test/interfaces/route-surface.spec.ts`
  (classificação de papel, tags fechadas, metadados OpenAPI das três
  rotas)
- **ADR:** [0080](adr/0080-busca-hibrida-pesos-limiar-e-citacao.md)

## PROGRAMA 28 — Onda 4, frente E2: virtualização de linha e minimapa na aba Code (RN-239..242)

### RN-239 — Virtualização de linha: só a janela visível vira nó de DOM {#rn-239}

`CodeEditor.tsx` renderiza só as linhas dentro da janela visível (mais
`OVERSCAN = 20` de margem) como `[data-line-row]`; o resto vira dois
espaçadores que reservam a altura sem existir como nó. A decisão de NÃO
usar `react-window`/`react-virtual`: a altura de linha é FIXA
(`ALTURA_LINHA = 21`, monoespaçado), o que reduz "qual linha está visível"
a uma divisão inteira sobre `scrollTop` — o problema que essas libs
resolvem de verdade é altura VARIÁVEL por item, que não é o caso da aba
Code.

- **Onde:** `apps/web/src/routes/code/CodeEditor.tsx` (linhas 38-96, 45,
  48)
- **Teste:** `apps/web/src/routes/code/CodeEditor.test.tsx` — describe
  "CodeEditor — virtualização", "caminho feliz: arquivo de 5.000 linhas
  renderiza uma janela pequena de nós, não o arquivo inteiro" (`< 150` nós
  `[data-line-row]`) e "rolar para o meio do arquivo troca a janela —
  linha 1 some, linhas do meio aparecem"

### RN-240 — Sem medição de altura, degrada para janela padrão generosa, nunca renderiza tudo {#rn-240}

Quando `containerHeight` ainda não foi medido (1º render, ou jsdom sem
`ResizeObserver` em teste), a janela cai para `LINHAS_SEM_MEDICAO = 40` —
generosa o bastante para não truncar os arquivos pequenos que os testes
usam, pequena o bastante para nunca virar "renderiza tudo" num arquivo
grande de verdade.

- **Onde:** `apps/web/src/routes/code/CodeEditor.tsx` (linha 57)
- **Teste:** `apps/web/src/routes/code/CodeEditor.test.tsx` — "falha/borda:
  sem medição de altura (jsdom sem ResizeObserver, clientHeight 0),
  degrada para uma janela padrão em vez de não renderizar nada"

### RN-241 — Minimapa reusa a MESMA tokenização da virtualização — zero segundo passe sobre o arquivo {#rn-241}

`minimap.ts` não tokeniza nada: ele resume a saída que `highlight.ts` já
produziu (`HighlightToken[][]` de `highlightFile`, chamada uma vez só) —
a MESMA que a virtualização usa para colorir as linhas visíveis.
Tokenizar de novo só para o minimapa pagaria o custo de leitura do
arquivo pela segunda vez, e por isso o minimapa só entra depois de a
virtualização estar de pé, nunca antes.

- **Onde:** `apps/web/src/routes/code/minimap.ts` (linhas 1-18, 39)
- **Teste:** `apps/web/src/routes/code/minimap.test.ts`

### RN-242 — Minimapa é CANVAS, um nó de DOM só, nunca um `<div>` por linha {#rn-242}

O desenho é em `<canvas>` (`desenharMinimapa`), não em elemento por
linha: um minimapa com um nó por linha dobraria de novo a contagem que a
virtualização (RN-239) acabou de cortar. Sem contexto de canvas 2D
disponível (jsdom sem o pacote `canvas`), o overlay clicável continua
funcionando — só o desenho é pulado, nunca a interação.

- **Onde:** `apps/web/src/routes/code/minimap.ts` (linhas 14-16, 91)
- **Teste:** `apps/web/src/routes/code/CodeEditor.test.tsx` — describe
  "CodeEditor — minimapa", "caminho feliz: clicar no minimapa rola o
  editor e troca a janela renderizada" e "falha: sem contexto de canvas
  2D (jsdom sem o pacote `canvas`), o overlay continua clicável e nada
  quebra"

### RN-243 — O ciclo de vida do container é TABELA, e nenhuma linha dela chama Docker {#rn-243}

`project_containers` (migração `0046`) grava o ESTADO mutável do container
de um projeto — distinto de `artifact.project_image` no event log (ADR
0065), que é a DECISÃO imutável do Arquiteto. Nem
`RegistrarTransicaoDeContainerUseCase` nem
`ObterCicloDeVidaDoContainerUseCase` chamam um daemon Docker: nenhum
serviço do produto monta `/var/run/docker.sock` nem roda `privileged`
hoje, e conceder isso é decisão de segurança fora do escopo desta regra.
Um orquestrador real, quando existir, CONSOME esta tabela depois de agir
de verdade — nunca o contrário.

- **Onde:** `apps/api/src/domain/containers/container-lifecycle.ts`,
  `apps/api/src/application/use-cases/containers/registrar-transicao-de-container.use-case.ts`
- **Teste:** `apps/api/test/application/use-cases/containers/ciclo-de-vida-do-container.use-case.spec.ts`
- **ADR:** [0081](adr/0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md)

### RN-244 — A máquina de estados do container: só `removed` sai reprovisionando {#rn-244}

`provisioning → running ⇄ stopped`, com `failed` alcançável de
`provisioning`/`running`/`stopped`, e `removed → provisioning` como a
ÚNICA saída de `removed` — nenhum estado é terminal de verdade, porque um
projeto pode reprovisionar com uma imagem revisada pelo Arquiteto.
Transição fora da tabela lança `InvalidContainerTransitionError`, que o
caso de uso traduz para 409 — mesmo formato de `session-state-machine.ts`
e `pr-gate-state-machine.ts`.

- **Onde:** `apps/api/src/domain/containers/container-lifecycle.ts`
  (`ALLOWED_TRANSITIONS`)
- **Teste:** `apps/api/test/domain/containers/container-lifecycle.spec.ts`
- **ADR:** [0081](adr/0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md)

### RN-245 — A primeira transição exige a imagem já decidida, e CONGELA versão e recursos {#rn-245}

Não existe linha até a primeira chamada com `to: 'provisioning'`, e ela só
é aceita se o Arquiteto já tiver decidido a imagem do projeto (RN-105) —
o mesmo portão que já protege a aba Code, aplicado na origem em vez de
duplicado. A versão de `artifact.project_image` e os recursos declarados
naquele instante são CONGELADOS na linha nova (`image_version`, `cpus`,
`memory_mb`, `pids_limit`): uma revisão posterior do artefato não muda
retroativamente o que uma instância já provisionada promete.

- **Onde:** `apps/api/src/application/use-cases/containers/registrar-transicao-de-container.use-case.ts`
- **Teste:** `apps/api/test/application/use-cases/containers/ciclo-de-vida-do-container.use-case.spec.ts`
  — "a primeira transição (provisioning) cria a linha…" e "sem decisão de
  imagem do Arquiteto, não há o que provisionar"
- **ADR:** [0081](adr/0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md)

### RN-246 — Projeto em modo `local` não tem ciclo de vida de container {#rn-246}

Um projeto com `workspace_mode: 'local'` (ADR 0072, RN-169) roda no
container do AGENTE de sempre — não sobe container próprio. Pedir
qualquer transição para um projeto `local` é recusado com 400 ANTES de
tocar a tabela, na origem, não filtrado depois na UI.

- **Onde:** `apps/api/src/application/use-cases/containers/registrar-transicao-de-container.use-case.ts`
- **Teste:** `apps/api/test/application/use-cases/containers/ciclo-de-vida-do-container.use-case.spec.ts`
  — "projeto em modo `local` não tem ciclo de vida de container (ADR 0072)"
- **ADR:** [0081](adr/0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md)

### RN-247 — Uma linha por projeto: `project_id` é único {#rn-247}

Só existe UM container vigente por projeto de cada vez — o mesmo desenho
de `dev_agent_states` no engine (ADR 0045). A constraint única mora no
BANCO (`project_containers_project_id_unique`), não só no caso de uso:
`create` chamado duas vezes para o mesmo projeto falha na escrita, nunca
produz uma segunda linha silenciosa.

- **Onde:** `apps/api/src/db/migrations/0046_chilly_forgotten_one.sql`
- **Teste:** `apps/api/test/infrastructure/persistence/drizzle/container.repository.spec.ts`
  — "só uma linha por projeto — create duplicado viola a constraint única"
- **ADR:** [0081](adr/0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md)

### RN-248 — Teto de recursos DECLARADO, não aplicado — o campo existe para quando houver orquestrador {#rn-248}

`cpus`/`memory_mb`/`pids_limit` gravam o que o artefato do Arquiteto
prometia no momento do provisionamento, mas nenhum processo hoje faz o
kernel respeitar esse teto — não há orquestrador chamando `docker run
--cpus … --memory … --pids-limit …`. O campo nasce mesmo assim porque
adiar a coluna para quando o orquestrador existir obrigaria uma migration
de correção no dia em que ele chegasse; declarar sem aplicar é honesto
enquanto a tabela não mentir sobre APLICAR (nenhuma tela ou resposta de
API hoje afirma "o container está limitado a X" — só "a intenção
registrada era X").

- **Onde:** `apps/api/src/db/schema.ts` (`projectContainers`)
- **Teste:** `apps/api/test/infrastructure/persistence/drizzle/container.repository.spec.ts`
  — "create nasce em `provisioning`, com a versão e os recursos passados"
- **ADR:** [0081](adr/0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md)

## PROGRAMA 28 — Onda 4, frente H4: os colapsos ad-hoc restantes migram para o `Disclosure` (RN-249..251)

### RN-249 — Alvo de clique do marco com detalhe sobe de 20px para o piso de 24px do `Disclosure` {#rn-249}

O marco COM detalhe de `AgentTimelineTree` tinha `min-height: 20px` no
cabeçalho clicável — abaixo do WCAG 2.2 AA 2.5.8 (Target Size, mínimo
24px) que um comentário anterior já prometia sem cumprir. A migração
para o `Disclosure` compartilhado corrige isso de graça: o componente
genérico já nasce em 24px, e não é preciso lembrar de setar a régua em
cada novo consumidor.

- **Onde:** `apps/web/src/components/AgentTimelineTree.module.css`
  (linhas 135-155, `.marcoLinha`)
- **Teste:** `apps/web/src/components/AgentTimelineTree.test.tsx`
- **ADR:** nenhum — correção pontual de a11y, mesmo padrão do ADR 0036

### RN-250 — Faixa de arquivo do diff em `ApprovalCard` NÃO migra para o `Disclosure` — a animação própria é a razão {#rn-250}

A faixa de arquivo do diff em `ApprovalCard` gira o chevron por
`transform: rotate(90deg)` com transição própria
(`.chevron.open`/`ApprovalCard.module.css`); o `Disclosure` genérico
TROCA o ícone (seta direita → seta baixo) sem animação nenhuma. Forçar a
migração apagaria a micro-interação sem ganho — a exclusividade (só um
arquivo aberto por vez) já vem de fora (`expandedFile`), o mesmo que o
`Disclosure` controlado faria. O que faltava, e não era peculiaridade —
é o mesmo defeito que o `Disclosure` existe para fechar —, era
`aria-controls` apontando para uma região nomeada: corrigido diretamente,
sem trocar de componente.

- **Onde:** `apps/web/src/components/ApprovalCard.tsx` (linhas 511-539)
- **Teste:** `apps/web/src/components/ApprovalCard.test.tsx`

### RN-251 — Cinco call sites migram para o `Disclosure` compartilhado; o componente ganha `testId` como único hook novo {#rn-251}

`ModelCatalogSection` (a referência original que gerou o componente na
FASE 16), `AgentTimelineTree` (ramo + marco), `code/CodeExplorer.tsx`
(pasta da árvore) e `code/CodeShell.tsx` (painel inferior) passam a usar
o `Disclosure` compartilhado — nenhuma das seis implementações ad-hoc que
sobreviveram à FASE 16 fica de fora, exceto a exceção declarada da
RN-250. `testId` é o único prop novo que um consumidor precisou (`data-
testid` no cabeçalho, para os testes existentes continuarem
selecionando o botão certo sem reescrever a suíte inteira). A região
controlada existe no DOM mesmo fechada — só `hidden` e sem os filhos
montados —, porque `aria-controls` apontando para um id que não resolve
é pior que não ter o atributo (leitor de tela anunciaria controle de
algo inexistente); é essa mesma propriedade que permite colapsar listas
caras (o catálogo do OpenRouter tem 338 modelos) sem montar o que
ninguém está vendo.

- **Onde:** `apps/web/src/components/ui/Disclosure.tsx` (linhas 33-71),
  `apps/web/src/components/ModelCatalogSection.tsx`,
  `apps/web/src/components/AgentTimelineTree.tsx`,
  `apps/web/src/routes/code/CodeExplorer.tsx`,
  `apps/web/src/routes/code/CodeShell.tsx`
- **Teste:** `apps/web/src/components/ui/Disclosure.test.tsx`,
  `apps/web/src/routes/code/CodeExplorer.test.tsx`,
  `apps/web/src/routes/code/CodeShell.test.tsx`

## PROGRAMA 28 — Onda 5, frente G3: a tela do Chat RAG (RN-252..254, ADR 0082)

### RN-252 — A tela do Chat RAG mostra as duas degradações honestas que o backend já declara, nunca as esconde {#rn-252}

`HybridSearchUseCase` já devolve `vectorAvailable: false` quando o provider
de embedding não respondeu (RN-233) e `GetRagCoverageUseCase` já nunca
inclui timestamp de indexação (RN-237) — mas um contrato honesto no
backend não garante uma tela honesta se ela decidir não ler os dois
campos. `ProjectRagTab` mostra um aviso acima dos resultados quando
`vectorAvailable` é `false` (com `vectorUnavailableReason`, quando
existe), e `RagCoveragePanel` só renderiza contagem REAL (`filesIndexed`/
`filesInRepo`, `sessionsIndexed`/`sessionsInProject`) — nenhum texto do
tipo "reindexado há Xmin" nasce nesta tela, porque a resposta não carrega
esse dado e inventá-lo mentiria (mesma régua do ADR 0042 para nota de
modelo).

- **Onde:** `apps/web/src/routes/ProjectRagTab.tsx` (linhas 27-31, 176-182),
  `apps/web/src/components/rag/RagCoveragePanel.tsx` (linhas 27-34)
- **Teste:** `apps/web/src/routes/ProjectRagTab.test.tsx` — "CASO DE FALHA
  (degradação honesta): vectorAvailable false avisa..."; `apps/web/src/components/rag/RagCoveragePanel.test.tsx`
  — "CASO DE FALHA (degradação honesta): nunca escreve..."
- **ADR:** [0082](adr/0082-chat-rag-aba-de-busca-hibrida.md)

### RN-253 — Citação de origem `session` navega até o EVENTO exato, reusando o mecanismo do Psicólogo {#rn-253}

`RagCitationCard` não inventa um segundo caminho de navegação: origem
`{ kind: 'session', sessionId, eventId }` chama `useNavigate` para
`/projects/:projectId/sessions/:sessionId` com `search: { highlightEvent:
eventId }` — a MESMA rota e o MESMO parâmetro que os chips de evidência
do Psicólogo já usam (`HypothesisCard.tsx`, Fase 4b) para rolar o fio até
o evento e destacá-lo. Origem `{ kind: 'file' }` mostra caminho e
`headingPath` como texto, sem link: a aba Código não tem hoje deep-link
por caminho, e construir essa navegação está fora do escopo desta
frente.

- **Onde:** `apps/web/src/components/rag/RagCitationCard.tsx` (linhas
  32-38, 49-56)
- **Teste:** `apps/web/src/components/rag/RagCitationCard.test.tsx` —
  "caminho feliz: origem de sessão navega até o evento exato ao clicar"
- **ADR:** [0082](adr/0082-chat-rag-aba-de-busca-hibrida.md)

### RN-254 — O botão de reindexar é maintainer/owner na TELA, espelhando a régua da rota {#rn-254}

`POST .../rag/reindex` já exige `role:maintainer` (RN-238) — quem
garante é a api. `ProjectRagTab` espelha a régua no CLIENTE pelo mesmo
padrão que `ProjectSettingsTab`/`ProjectApprovalsTab` já usam para outros
gates de `maintainer` (`useCurrentWorkspaceWithRole`, já que não existe
hoje um papel de PROJETO no cliente, só o de workspace que a listagem
devolve): o botão "Reindexar agora" nem aparece para quem não é
`owner`/`maintainer`, em vez de aparecer desabilitado — reindexar dispara
N chamadas ao repositório do projeto e ao provider de embedding (mesma
régua "muda o que o produto gasta sem perguntar" do teto de paralelismo,
RN-083), e um botão visível mas sempre recusado só ensinaria a
ignorar o 403.

- **Onde:** `apps/web/src/routes/ProjectRagTab.tsx` (linhas 43-44, 109)
- **Teste:** `apps/web/src/routes/ProjectRagTab.test.tsx` — "botão de
  reindexar só aparece para maintainer/owner..."; "maintainer vê e pode
  disparar a reindexação"
- **ADR:** [0082](adr/0082-chat-rag-aba-de-busca-hibrida.md)

### RN-267 — `GET /projects/:projectId/container/lifecycle` é a primeira exposição HTTP do ciclo de vida do container {#rn-267}

O ADR 0081 criou `ObterCicloDeVidaDoContainerUseCase` sem rota, de propósito
("expor uma seria adivinhar contrato" antes de existir um consumidor real).
A Onda 5/F2 é esse consumidor (RN-268), e a rota nasce como espelho fiel do
caso de uso: `null` quando o projeto nunca foi provisionado — o resultado
esperado hoje, porque nenhum orquestrador real transiciona
`project_containers` em produção (`RegistrarTransicaoDeContainerUseCase` não
tem chamador nenhum fora de teste) — ou o estado registrado
(`status`/`imageVersion`/`resources`/`failureReason`/`statusChangedAt`), NUNCA
confirmado contra um daemon Docker, porque não existe cliente Docker no
produto (RN-243). Mesma permissão da rota irmã (`GET
/projects/:projectId/container`): `viewer`, GET, sem `@Post` — quem
transicionaria o ciclo de vida é um orquestrador que ainda não existe.

- **Onde:** `apps/api/src/interfaces/http/containers/containers.controller.ts`
  (`cicloDeVida`), `apps/api/src/interfaces/http/containers/dto/containers.response.dto.ts`
  (`CicloDeVidaDoContainerResponseDto`)
- **Teste:** `apps/api/test/interfaces/http/containers/containers.controller.spec.ts`
- **Borda:** `id`/`projectId`/`containerId` da linha interna NÃO vazam na
  resposta — o contrato HTTP não é a mesma forma que a linha do banco.
- **ADR:** [0083](adr/0083-terminal-mostra-estado-real-do-container.md)
  (revisa o [0081](adr/0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md))

### RN-268 — A aba Terminal mostra o estado REAL do container, nunca finge um terminal que não existe {#rn-268}

O plano original desta frente era o terminal interativo completo, mas a
investigação confirmou que a FASE 25b continua cortada: nenhum serviço monta
`/var/run/docker.sock`, e mesmo depois do ADR 0081 (Onda 4) nada transiciona
`project_containers` em produção. Implementar um terminal que finge executar
comandos — ou que roda no mesmo container do monorepo do Brabo, a dívida que
o ADR 0055 já descreve como política e não isolamento — seria inventar
capacidade, o mesmo erro que os ADRs 0041/0042 já recusam para provider de
LLM e modelo de catálogo.

O que a aba GANHA é honesto: sob o texto explicativo que já existia (FASE
26b), `CodeBottomPanel` busca `GET .../container/lifecycle` (RN-267) só
enquanto a aba Terminal está aberta (`enabled: aba === 'terminal'` — sem
polling em segundo plano, a mesma disciplina de tráfego da RN-107) e mostra
o status com um `Badge` (`provisioning`/`running`/`stopped`/`failed`/
`removed`, em pt-BR), há quanto tempo, e o `failureReason` quando o estado é
`failed`. Projeto nunca provisionado — o caso comum hoje — mostra a frase
"ainda não foi provisionado", nunca um badge inventado.

- **Onde:** `apps/web/src/routes/code/CodeBottomPanel.tsx`,
  `apps/web/src/routes/code/CodeBottomPanel.module.css`,
  `apps/web/src/lib/api-client.ts` (`getContainerLifecycle`),
  `apps/web/src/lib/api-types.ts` (`CicloDeVidaDoContainer`)
- **Teste:** `apps/web/src/routes/code/CodeBottomPanel.test.tsx`
  (describe "Terminal — o estado REAL do ciclo de vida do container")
- **Borda:** o terminal interativo em si NÃO nasce aqui — é FASE 25b, que
  segue cortada e depende da parede física do container (o worktree do
  agente vivendo lá dentro), não desta rota de leitura.
- **ADR:** [0083](adr/0083-terminal-mostra-estado-real-do-container.md)

### RN-272 — O callback do login social decide em ORDEM: identidade conhecida, depois vínculo por e-mail, depois conta nova {#rn-272}

`SocialLoginCallbackUseCase` resolve a identidade do provider em três
passos, nesta ordem, e nunca fora dela: `(provider, providerUserId)`
já vinculada → login direto; sem vínculo mas o e-mail bate com uma conta
existente → decide por [RN-274](#rn-274)/[RN-275](#rn-275); nenhuma das
duas → provisiona conta nova ([RN-278](#rn-278)). A chave de busca do
primeiro passo é sempre `providerUserId`, nunca e-mail — evita que trocar
o e-mail no provider "perca" o vínculo.

- **Onde:** `apps/api/src/application/use-cases/auth/social-login-callback.use-case.ts`
- **Teste:** `apps/api/test/application/use-cases/auth/social-login-callback.use-case.spec.ts`
  — os sete casos de `SocialLoginCallbackUseCase`
- **ADR:** [0084](adr/0084-login-social-github-e-gitlab.md)

### RN-273 — O `state` do login social tem propósito PRÓPRIO, mesmo assinado pela mesma chave do fluxo de conexão de git {#rn-273}

`domain/auth/social-oauth-state.ts` assina com `GIT_OAUTH_STATE_SECRET` —
a MESMA chave HMAC do `state` de "conectar git ao projeto X"
(`domain/git/oauth-state.ts`) — mas o payload carrega
`purpose: 'social_login'`, checado ANTES de qualquer outro campo. Um
`state` do fluxo de conexão de git, mesmo com assinatura válida, é
recusado aqui: sem o discriminante, aceitá-lo equivaleria a logar como o
`userId` de quem iniciou aquela conexão — escalação de privilégio.

- **Onde:** `apps/api/src/domain/auth/social-oauth-state.ts`
- **Teste:** `apps/api/test/domain/auth/social-oauth-state.spec.ts`
  — "RN-273: rejeita um state do fluxo de CONEXÃO de git, mesma chave"
- **ADR:** [0084](adr/0084-login-social-github-e-gitlab.md)

### RN-274 — Vincular identidade social a conta existente exige e-mail VERIFICADO pelo provider {#rn-274}

Quando o e-mail devolvido pelo provider bate com uma conta já cadastrada,
o vínculo só acontece se o provider marca aquele e-mail como verificado
(`emailVerified: true`) — GitHub via `GET /user/emails`, GitLab via
`confirmed_at`. Um e-mail digitado mas não verificado não é prova de
identidade: qualquer um pode registrar um e-mail alheio num provider
OAuth. Aceitar o vínculo sem essa checagem abriria account takeover —
quem já tem `alguem@empresa.com` na Brabo não pediu para um GitHub
alheio, com aquele endereço só DIGITADO, herdar a conta. A recusa é
`403`, e nenhum vínculo é gravado.

- **Onde:** `apps/api/src/application/use-cases/auth/social-login-callback.use-case.ts`
  (`vincularAContaExistente`)
- **Teste:** `apps/api/test/application/use-cases/auth/social-login-callback.use-case.spec.ts`
  — "RECUSA vincular quando o e-mail bate mas NÃO está verificado pelo provider"
- **ADR:** [0084](adr/0084-login-social-github-e-gitlab.md)

### RN-275 — Provisionar conta NOVA não exige e-mail verificado — só vincular a uma existente exige {#rn-275}

A verificação de e-mail da RN-274 protege uma conta que já existe; quando
não há conta correspondente, não há nada a proteger, só uma conta nova a
nascer. Exigir e-mail verificado nesse caso encareceria o caminho comum
(a maioria dos usuários de GitHub tem e-mail verificado, mas nem todos, e
recusar o login por isso seria atrito sem ganho de segurança
correspondente) sem reduzir risco nenhum — o pior caso é uma conta nova
com um e-mail não comprovado, o mesmo risco que o registro por senha já
aceita implicitamente até o clique no link de verificação.

- **Onde:** `apps/api/src/application/use-cases/auth/social-login-callback.use-case.ts`
  (`provisionarContaNova`)
- **Teste:** `apps/api/test/application/use-cases/auth/social-login-callback.use-case.spec.ts`
  — "provisiona conta nova mesmo com e-mail NÃO verificado"
- **ADR:** [0084](adr/0084-login-social-github-e-gitlab.md)

### RN-276 — `providerUserId`, nunca e-mail ou login, é a chave de identidade social {#rn-276}

`social_identities` tem índice único em `(provider, provider_user_id)` —
o id NUMÉRICO e estável do provider. E-mail e login (username) podem
mudar de dono ou de valor no provider sem aviso; usá-los como chave
faria uma troca de e-mail no GitHub "perder" o vínculo de quem já tinha
conta, ou pior, herdar silenciosamente o vínculo de outra pessoa que
reusou aquele endereço depois.

- **Onde:** `apps/api/src/db/migrations/0047_complete_hannibal_king.sql`,
  `apps/api/src/application/ports/social-identity-repository.port.ts`
- **Teste:** `apps/api/test/application/use-cases/auth/social-login-callback.use-case.spec.ts`
  — "identidade já conhecida: login direto, sem criar segunda linha"
- **ADR:** [0084](adr/0084-login-social-github-e-gitlab.md)

### RN-277 — Login social pede escopo MÍNIMO, nunca o de conexão de repositório {#rn-277}

`buildLoginAuthorizeUrl` pede `read:user user:email` (GitHub) e
`read_user` (GitLab) — nunca o `repo`/`api` que o fluxo de CONEXÃO de git
pede. Entrar na conta não deveria conceder acesso a repositório nenhum;
os dois fluxos reusam o MESMO app OAuth (RN-281) mas pedem autorizações
diferentes, decididas na hora da autorização, não na configuração do app.

- **Onde:** `apps/api/src/infrastructure/git/github-oauth-client.ts`,
  `apps/api/src/infrastructure/git/gitlab-oauth-client.ts`
  (`buildLoginAuthorizeUrl`)
- **Teste:** `apps/api/test/application/use-cases/auth/social-login-callback.use-case.spec.ts`
  — "StartSocialLoginUseCase › caminho feliz"
- **ADR:** [0084](adr/0084-login-social-github-e-gitlab.md)

### RN-278 — Conta provisionada por login social nasce SEM senha — mesmo estado "pendente" da migração do Keycloak {#rn-278}

Provisionar por login social grava uma linha em `users` e NENHUMA em
`auth_credentials` — o mesmo par que a migração do Keycloak já deixava
para "conta sem senha ainda" (ver RN-032 e `migracao-keycloak.spec.ts`).
`LoginUseCase` e `ResetPasswordUseCase` já tratam esse estado; não foi
necessário um segundo mecanismo de "senha pendente" para o login social.

- **Onde:** `apps/api/src/application/ports/auth-credential-repository.port.ts`
  (`criarUsuarioSemCredencial`),
  `apps/api/src/infrastructure/persistence/drizzle/auth-credential.repository.ts`
- **Teste:** `apps/api/test/application/use-cases/auth/social-login-callback.use-case.spec.ts`
  — "caminho feliz: provisiona um usuário NOVO, sem senha (RN-278)"
- **ADR:** [0084](adr/0084-login-social-github-e-gitlab.md)

### RN-279 — Vincular por e-mail verificado também verifica o e-mail da conta existente {#rn-279}

Quando uma conta registrada por senha (e nunca verificada) é vinculada a
uma identidade social cujo e-mail o provider marca como verificado, a
conta ganha `emailVerifiedAt` preenchido como efeito colateral. O
provider acabou de provar, por um caminho independente, exatamente o que
o clique no link de verificação provaria — não faz sentido a conta
continuar bloqueada do login por senha (RN-032) depois de provar posse
do e-mail por outro caminho igualmente forte.

- **Onde:** `apps/api/src/application/use-cases/auth/social-login-callback.use-case.ts`
  (`vincularAContaExistente`)
- **Teste:** `apps/api/test/application/use-cases/auth/social-login-callback.use-case.spec.ts`
  — "vincula a conta existente (…) e marca o e-mail dela como verificado (RN-274/279)"
- **ADR:** [0084](adr/0084-login-social-github-e-gitlab.md)

### RN-280 — Login social recusa conta DESABILITADA, mesma régua do login por senha {#rn-280}

Identidade social vinculada a uma conta com `auth_credentials.disabled_at`
preenchido é recusada com `403`, tanto no login direto (identidade já
conhecida) quanto na tentativa de vincular. Desabilitar uma conta não
pode ser contornado trocando de método de entrada.

- **Onde:** `apps/api/src/application/use-cases/auth/social-login-callback.use-case.ts`
  (`entrarComIdentidadeConhecida`, `vincularAContaExistente`)
- **Teste:** `apps/api/test/application/use-cases/auth/social-login-callback.use-case.spec.ts`
  — "recusa login de identidade vinculada a conta DESABILITADA"
- **ADR:** [0084](adr/0084-login-social-github-e-gitlab.md)

### RN-281 — O login social reusa o MESMO app OAuth da conexão de git — sem variável de ambiente nova {#rn-281}

`GITHUB_OAUTH_CLIENT_ID`/`_SECRET` e `GITLAB_OAUTH_CLIENT_ID`/`_SECRET`
continuam sendo os únicos client id/secret cadastrados. O que muda por
fluxo é o `redirect_uri` (`/auth/oauth/<provider>/callback` contra
`/git/oauth/<provider>/callback`) e o `scope` (RN-277) — os dois
decididos em tempo de requisição. Ação do OPERADOR continua necessária
(cadastrar o segundo callback URL no app de cada provider), documentada
em `.env.example` — é essa exigência, não uma env var nova, que justifica
o branch nascer `breaking/`.

- **Onde:** `.env.example`,
  `apps/api/src/application/use-cases/auth/start-social-login.use-case.ts`
- **Teste:** manual (cadastro no app OAuth) — não há como testar
  automaticamente uma configuração externa ao produto
- **ADR:** [0084](adr/0084-login-social-github-e-gitlab.md)

### RN-282 — O access token do login social nunca viaja na URL nem no corpo do callback {#rn-282}

`GET /auth/oauth/:provider/callback` grava os cookies de sessão
(`definirCookiesDeSessao`, a MESMA função do login por senha) e
redireciona para `WEB_ORIGIN/`. O boot da web (`restaurarSessao()`,
chamado em toda carga de página) troca o refresh recém-gravado por um
access token — nenhum código novo do lado do cliente além dos botões e o
alias de rota de erro.

- **Onde:** `apps/api/src/interfaces/http/auth/auth.controller.ts`
  (`oauthCallback`)
- **Teste:** `apps/api/test/interfaces/route-surface.spec.ts` — cobre a
  classificação pública e os metadados OpenAPI da rota; o fluxo completo
  de cookie→boot é E2E, fora do escopo de teste de unidade
- **ADR:** [0084](adr/0084-login-social-github-e-gitlab.md)

### RN-283 — Falha do callback de login social não vaza o motivo na URL {#rn-283}

Qualquer falha (`state` inválido, code rejeitado pelo provider, conta
desabilitada, e-mail não verificado) redireciona para
`WEB_ORIGIN/login?oauth_error=1` — um único sinal genérico, nunca o
motivo real. Mesmo padrão do callback de conexão de git
(`WEB_ORIGIN/git-error`).

- **Onde:** `apps/api/src/interfaces/http/auth/auth.controller.ts`
  (`oauthCallback`, bloco `catch`)
- **Teste:** `apps/api/test/application/use-cases/auth/social-login-callback.use-case.spec.ts`
  — cobre os desfechos de falha que o controller mapeia para o mesmo
  redirect genérico
- **ADR:** [0084](adr/0084-login-social-github-e-gitlab.md)

---

## Auditoria fluxo.yml × código — o plano do Dev Lead vira aprovação de verdade (RN-284, ADR 0086)

Não é fase planejada: é a correção de uma divergência que a auditoria de
`docs/fluxo.yml` × código encontrou (`docs/explanation/auditoria-fluxo-vs-codigo.md`,
achado A2) — o fluxo já declarava a saída `plano-de-paralelismo` do `dev-lead`
como `via: proposed_action`, e o código nunca foi ajustado para bater.

### RN-284 — O turno do agente conversacional pode SUSPENDER esperando aprovação humana {#rn-284}

Primeira vez que um agente conversacional (Criativo, PO, Arquiteto, Dev Lead —
todos rodam turno síncrono via `GenServer.call` de até 180s, mediado por
`Engine.Agents.TurnoAssincrono`) suspende esperando uma decisão humana. O
padrão já existia para o dev agent ([RN-073](#rn-073), ADR 0052) e os gates de
QA/Infra (ADR 0057), mas os dois são disparados por `cast` e nunca esperavam
resposta síncrona — é exatamente esse ponto que este mecanismo resolve, e o
teto de paralelismo que fez o Dev Lead existir ([RN-083](#rn-083)) é a razão
de a primeira aprovação suspensa ser a dele.

**O mecanismo, em quatro peças:**

1. `Engine.Agents.DevLeadTools.run/2`
   (`apps/engine/lib/engine/agents/dev_lead_tools.ex:81-107`) chama
   `EngineApiClient.propose_action/5` em vez de `append_event/3`, e devolve
   `{:ok, texto}` (status `executed`/`auto_approved`/`approved` — os três
   contam como sucesso, porque `propose_execution_plan` não tem execute-*
   pipeline própria e a aprovação manual fica em `"approved"` para sempre),
   `{:pending, action_id}` ou `{:error, texto}`.
2. `Engine.Agents.DevLeadServer.run_turn/2`
   (`apps/engine/lib/engine/agents/dev_lead_server.ex`, bloco de despacho de
   `tool_calls`) usa `Enum.reduce_while` para PARAR no primeiro `:pending`,
   sem processar as chamadas seguintes nem recursar — e devolve o `state` com
   a chave `:aguardando_aprovacao` setada
   (`%{action_id:, tool_call_id:, tool_name:, remaining:}`, o `remaining`
   já descontando a iteração suspensa contra o teto). A mensagem `role:
   "tool"` NÃO entra em `state.messages` nesse momento — gravar "pending" ali
   mentiria pro modelo que o comando já respondeu isso (mesmo raciocínio do
   dev agent, `Engine.Harness.Hooks.ActionPipeline`).
3. `Engine.Agents.TurnoAssincrono.tratar_resultado/2`
   (`apps/engine/lib/engine/agents/turno_assincrono.ex`) responde ao `from`
   do mesmo jeito e na mesma hora de sempre — é o que rompe o bloqueio
   síncrono no momento certo —, mas em vez de `finalizar/1` (que emite
   `agent.done` e `agent.status: idle`) chama `suspender/1`: só
   `agent.status: awaiting_approval`, sem `agent.done`, porque o turno não
   terminou. A checagem é pelo VALOR da chave (`Map.get/2`, truthy), nunca
   pela presença dela — o Dev Lead carrega `aguardando_aprovacao: nil` desde
   o `init/1`, então a chave em si está sempre presente.
4. `Engine.Sessions.LiveBroadcast.agent_status/4`
   (`apps/engine/lib/engine/sessions/live_broadcast.ex:38-39`) ampliou a
   guarda de `["working", "idle"]` para incluir `"awaiting_approval"` — sem
   isto o `agent.status` do passo 3 nem seria persistido.

**A retomada.** `Engine.Agents.DevLeadServer` assina
`Engine.Dev.Wake.subscribe(project_id, "dev-lead")` no `init/1` — o MESMO
módulo que `Engine.Gates.QaLeadServer` já reusa para os subagentes de QA,
apesar do nome ser "dev": a entrega de `{:action_settled, ...}` é por AGENTE,
roteada pelo `agentId` do payload (`apps/engine/lib/engine/workers/dev_agent_wake_worker.ex`),
não por tipo de agente. Quando a decisão chega, um `handle_info` monta a
mensagem `role: "tool"` com o resultado REAL (`texto_do_desfecho/1`, mesmo
vocabulário do dev agent e do `QaLeadServer`), zera `aguardando_aprovacao` e
retoma com `TurnoAssincrono.iniciar(state, nil, fn -> run_turn(state,
pendente.remaining) end)`.

**Enquanto suspenso, uma segunda `user_message` não inicia turno novo** — um
guard em `handle_call({:user_message, _text}, _from, %{aguardando_aprovacao:
%{}})`, testado ANTES da cláusula genérica, emite `agent.error` (origem
`politica`) explicando que há uma decisão pendente em Aprovações, sem subir
task nenhuma.

**Lacuna aceita, declarada — restart durante a espera.** Ao contrário do dev
agent (que reidrata `laco_pendente` via `handle_continue` no `init/1`, ADR
0052), o Dev Lead NÃO reidrata `aguardando_aprovacao` — é só em memória. Se o
engine reiniciar enquanto ele está suspenso, a decisão continua registrada e
visível em Aprovações (é durável na api), mas o Dev Lead não narra o desfecho
automaticamente: o processo que assinou o `Wake` morreu, e o próximo restart
sobe um Dev Lead novo, sem inscrição para aquela ação. Fechar isto exigiria o
mesmo mecanismo do ADR 0052 — fora do escopo desta mudança, que só faz o
comportamento bater com o que `docs/fluxo.yml` já declarava.

- **Onde:** `apps/engine/lib/engine/agents/dev_lead_tools.ex`,
  `dev_lead_server.ex`; `apps/engine/lib/engine/agents/turno_assincrono.ex`
  (compartilhado pelos quatro conversacionais); `apps/engine/lib/engine/sessions/live_broadcast.ex`;
  `apps/api/src/domain/actions/decide.ts` (`propose_execution_plan`)
- **Teste:** `apps/engine/test/engine/agents/dev_lead_tools_test.exs`,
  `dev_lead_server_test.exs` (describe "suspensão em aprovação"),
  `turno_assincrono_test.exs` (describe "resultado com :aguardando_aprovacao"),
  `live_broadcast_test.exs`, `wake_do_outbox_ao_dev_lead_test.exs` (a
  corrente INTEIRA — outbox → drain → worker → `Engine.Dev.Wake` → o
  processo do Dev Lead, mesmo padrão de `Engine.Dev.WakeDoOutboxAoAgenteTest`),
  `apps/api/test/domain/actions/decide.spec.ts` (describe "plano de
  execução do Dev Lead")
- **ADR:** [0086](adr/0086-dev-lead-plano-suspende-para-aprovacao.md)
  (revisa parte do [ADR 0053](adr/0053-dev-lead-e-paralelismo-autorizado.md);
  precedente direto: [ADR 0052](adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md)
  e [ADR 0057](adr/0057-o-gate-espera-a-aprovacao.md))

---

## UX Designer — o quinto agente conversacional (RN-285..287, ADR 0087)

Não é gatilho de separação disparado (`docs/fluxo.yml` sempre declarou "quando
o projeto GERENCIADO tiver interface própria a desenhar" como critério) — é
decisão consciente do dono do produto de antecipar o papel. `teste-de-
usabilidade` (exige usuário humano real) fica fora de alcance; `metricas-de-
uso` segue lacuna, porque depende do papel `analytics`, que continua
`proposto`.

### RN-285 — O UX Designer é conversacional SOLO, sem área {#rn-285}

`Engine.Agents.UxDesignerServer` (`apps/engine/lib/engine/agents/ux_designer_server.ex:40`)
espelha `Engine.Agents.ArquitetoServer`/`DevLeadServer`: GenServer por sessão,
laço bounded de tool use próprio com teto 14 (mesmo calibre de Arquiteto/Dev
Lead — agente de raciocínio, não conversação leve como Criativo/PO). Ativado
por handoff `accepted` endereçado a "ux-designer" — mecanismo GENÉRICO já
existente (`ActivateAgentUseCase`/`canActivateAgent` na api não ganharam
linha nenhuma: qualquer agente com handoff aceito já é ativável).

O kickoff (`build_kickoff/1`, `ux_designer_server.ex:222`) lê a
`artifact.product_brief` mais recente da sessão — a MESMA "necessidade de
negócio" que o Criativo produz, sem artefato novo. O sistema de design
(`design/tokens.css`, `design/COMPONENTS.md`) é DESCRITO na identidade
(`Engine.Harness.Agents`, entrada `"ux-designer"`), texto estático, porque os
agentes conversacionais não têm ferramenta de leitura de arquivo do repo — é
a única camada do prompt presente em TODO turno, não só no kickoff.

Sem área, sem subagentes: `docs/fluxo.yml` já classificava o papel como
`camada_produto`, ao lado de Criativo e PO, nenhum dos quais tem área.

### RN-286 — `propose_prototype` grava artefato sem tabela e sem caso de uso dedicado, e oferece DOIS handoffs sobre o MESMO artefato {#rn-286}

`artifact.prototipo_navegavel` segue o desenho sem tabela de
`artifact.project_image`/`artifact.c4_diagram` ([RN-149](#rn-149)) — o event
log é o registro —, mas por um caminho DIFERENTE do que os dois usam.
`choose_project_image`/`create_c4_diagram` precisam de caso de uso NA API
(`DecidirImagemDoProjetoUseCase`/`CreateC4DiagramUseCase`) porque têm
conteúdo DERIVADO de outro artefato (o Container level vem do `module_map`
vigente) ou recusa de domínio compartilhada por mais de um consumidor (teto
de recursos da imagem). `propose_prototype`
(`Engine.Agents.UxDesignerTools.run/2`,
`apps/engine/lib/engine/agents/ux_designer_tools.ex:122`) não tem nenhum dos
dois motivos — é conteúdo AUTOCONTIDO que só o próprio UX Designer escreve e
só ele lê de volta —, então a validação de FORMA mora no engine
(`Engine.Harness.ArtifactSchemas`, tipo `"prototipo_navegavel"`,
`artifact_schemas.ex:49/135` — personas e jornadas não-vazias, ao menos uma
tela) e a gravação usa o caminho GENÉRICO que a api já expõe para qualquer
tipo de evento (`EngineApiClient.append_event_returning/3`), o mesmo
mecanismo do `artifact.product_brief` do Criativo. Nenhuma rota nova na api.

Depois de gravar, `gravar_e_ofertar_handoffs/2` (`ux_designer_tools.ex:149`)
oferece DOIS handoffs sobre o MESMO artefato — `create_handoff` para "po" e
para "dev-lead", os dois com o `artifactId` do protótipo. Nunca um segundo
artefato para "spec-visual" (`docs/fluxo.yml`): o PO lê `resumo`/`prototipo`
para desenhar o backlog, o Dev Lead lê as MESMAS `telas`/`anotacoes` como
referência visual de implementação — duplicar o conteúdo arriscaria as duas
cópias divergirem na revisão seguinte, o mesmo argumento por trás do C4 não
redigitar o `module_map`.

Falha ao ofertar UM dos dois handoffs não desfaz o artefato já gravado nem o
outro handoff (RN-116) — o motivo volta como texto do tool-result, entrada do
laço e não fim de linha (RN-163): o modelo lê e pode reportar ao usuário na
resposta seguinte.

Um `propose_prototype` BEM-SUCEDIDO encerra o turno
(`ux_designer_server.ex:120`, mesma guarda de `propose_execution_plan` no Dev
Lead) — sem isso o laço voltaria ao modelo, que poderia propor de novo e
produzir dois protótipos com o mesmo total. Só existe UMA ferramenta aqui
(não há um segundo tool call a encadear como no Arquiteto), então "para no
primeiro sucesso" não perde nada.

### RN-287 — `uxDesignerActive` no roster, nas DUAS fontes (RN-090) {#rn-287}

Mesmo critério de `infraActive`: handoff `accepted` endereçado a
"ux-designer" na sessão. `apps/web/src/lib/agent-status.ts`
(`rosterFactsFromEvents`/`rosterFromFacts`) ganhou o fato e o empurra
condicionalmente no roster como agente SOLO — sem `pushAreaMembers`
correspondente, porque ele não é área.

A RN-090 exige as DUAS fontes em sincronia (painel do time via event log; o
card do dashboard via `ProjectCardSummary.roster`, computado na api) para que
um agente novo não apareça num lugar e falte no outro. O fato entrou nas
duas: `apps/api/src/infrastructure/persistence/drizzle/projects-summary.repository.ts`
amplia a MESMA consulta de `infraActive` (um `inArray(handoffs.toAgent,
['infra', 'ux-designer'])` no lugar do `eq` único, partido em dois `Set` por
`toAgent`) — nenhuma consulta nova, a contagem de doze consultas constantes
que `projects-summary.repository.spec.ts` prova não cresce.

- **Onde:** `apps/engine/lib/engine/agents/ux_designer_server.ex`,
  `ux_designer_tools.ex`, `ux_designer_supervisor.ex`;
  `apps/engine/lib/engine/harness/agents.ex` (identidade),
  `artifact_schemas.ex` (tipo `prototipo_navegavel`);
  `apps/engine/lib/engine/application.ex`;
  `apps/engine/lib/engine_web/controllers/agent_command_controller.ex`;
  `apps/web/src/lib/agents.ts`, `agent-status.ts`;
  `apps/api/src/application/ports/projects-summary-repository.port.ts`,
  `apps/api/src/infrastructure/persistence/drizzle/projects-summary.repository.ts`
- **Teste:** `apps/engine/test/engine/agents/ux_designer_server_test.exs`,
  `ux_designer_tools_test.exs`; `apps/web/src/lib/agent-status.test.ts`;
  `apps/api/test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  (describe com os dois `toAgent` na mesma sessão)
- **ADR:** [0087](adr/0087-ux-designer-agente.md)

---

## Staff: código pronto, dormente para disparo automático (RN-305/RN-306, ADR 0088)
Não é fase planejada: `docs/fluxo.yml` declara o Staff/Principal Engineer como
`status: planned` desde o ADR 0085 ("contrato pronto, ativação decidida,
aguarda gatilho"). O dono do produto decidiu antecipar o CÓDIGO mesmo sabendo
que o gatilho automático (a Anamnese notando um problema sistêmico
RECORRENTE) não vai disparar — a Anamnese está pausada
(`ANAMNESE_ENABLED=false`, decisão de produto de 2026-08-10). Ver a
pendência já documentada em RN-086: o mesmo sinal que faria a Anamnese
propor subir o teto de paralelismo é o que faria ela propor um handoff ao
Staff, e nenhum dos dois dispara enquanto ela estiver pausada.

### RN-305 — O Staff ativa pelo caminho GENÉRICO de handoff, sem `USER_STARTED_AGENTS`, e sem `kickoff/1`

`USER_STARTED_AGENTS` (`apps/api/src/domain/sessions/agent-activation.ts`) é
a exceção do Criativo (inicia SEM handoff, por comando do usuário) — o Staff
NÃO entra nela. Investigação confirmou que `canActivateAgent` já ativa
qualquer agente com handoff `accepted` endereçado a ele, o mesmo caminho que
já vale para `dev-lead`/`arquiteto`/`infra`; e `assertHandoffTargetAllowed`
(`apps/api/src/domain/agents/agent-areas.ts`) só recusa handoff endereçado a
SUBAGENTE de área — o Staff não tem área, então nenhuma mudança de domínio
na api foi necessária. "Acionável manualmente" significa que a MECÂNICA de
domínio permite (qualquer agente pode chamar
`EngineApiClient.create_handoff(..., "staff", ...)`, e um humano aceita pela
rota já existente), não que existe hoje uma tela dedicada para escolher
"endereçar handoff ao Staff" — a UI genérica de handoff a agente à escolha
segue no backlog (`docs/explanation/backlog.md`), como já estava antes desta
mudança.

`Engine.Agents.StaffServer` (`apps/engine/lib/engine/agents/staff_server.ex`)
é o quinto agente conversacional solo (junto de Criativo, PO, Arquiteto, Dev
Lead), espelhando o Arquiteto — `GenServer` por sessão, rehydration do event
log, laço bounded de tool use com teto 14 (`staff_server.ex:49`) — mas **sem
`kickoff/1`**: os outros leads sintetizam uma instrução de abertura a partir
de um artefato anterior no event log da sessão (product_brief, module_map,
backlog); o Staff não tem essa fonte, porque o problema sistêmico nasce de
fora da sessão. `StaffSupervisor.start_agent/2` sobe o processo (rehidrata o
histórico) e ele fica ocioso até a primeira `user_message`
(`staff_server.ex:60`) — que é como quem endereçou o handoff explica o
problema. `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:60`
(cláusula `start/2` de `"staff"`) nunca chama `kickoff` (a função nem
existe), ao contrário de po/arquiteto/dev-lead/infra.

- **Onde:** `apps/api/src/domain/sessions/agent-activation.ts`
  (`canActivateAgent`, `USER_STARTED_AGENTS` — intocado),
  `apps/api/src/domain/agents/agent-areas.ts`
  (`assertHandoffTargetAllowed` — intocado),
  `apps/engine/lib/engine/agents/staff_server.ex`,
  `staff_supervisor.ex`,
  `apps/engine/lib/engine_web/controllers/agent_command_controller.ex`
  (cláusulas `start/2`/`message/2`/`via_for/2` de `"staff"`),
  `apps/engine/lib/engine/application.ex` (`Engine.Agents.StaffSupervisor`
  na árvore de supervisão)
- **Teste:** `apps/engine/test/engine/agents/staff_server_test.exs`
  (rehydration, ausência de kickoff automático — o turno só roda por
  `user_message`)
- **ADR:** [0088](adr/0088-staff-agente-dormente-para-disparo-automatico.md)

### RN-306 — `propose_rfc` grava o artefato DIRETO e devolve o handoff no MESMO tool call, sem `proposed_action`

`Engine.Agents.StaffTools.propose_rfc`
(`apps/engine/lib/engine/agents/staff_tools.ex:41`) é a única ferramenta do
Staff: problema, opções com trade-offs, recomendação e o escopo de uma PoC
DESCARTÁVEL (`descartavel: true` é FIXO — nunca escrito pelo modelo). `run/2`
(`staff_tools.ex:89`) grava `artifact.rfc_staff` via
`EngineApiClient.append_event_returning/3` — mesmo padrão SEM tabela e SEM
caso de uso dedicado de `Engine.Harness.Tools.EmitInsight` (o `emit_insight`
do Arquiteto), e não o de `artifact.c4_diagram` (ADR 0068), que tem caso de
uso próprio na api porque DERIVA o nível Container do `module_map` vigente —
o RFC não deriva nada do lado de lá, todo o payload vem do tool call.

Depois de gravar, o MESMO `run/2` chama
`EngineApiClient.create_handoff(..., "staff", "arquiteto", artifact_id)` —
sem confirmação humana no meio, mesmo padrão de
`CriativoServer.executar_confirm_readiness/1` emitindo o product_brief e
oferecendo o handoff ao PO na mesma resposta. `propose_rfc` NÃO é
`proposed_action`: registrar um documento de arquitetura não é efeito
externo (não é git, terminal, nem gasto de agente) — a decisão real
(adotar, adaptar, recusar a recomendação) é do Arquiteto, no handoff que a
ferramenta já devolve. Falha ao criar o handoff NÃO derruba o processo nem
perde o RFC já gravado (RN-116) — o motivo entra no tool-result, e o modelo
sabe que precisa tentar de novo só o handoff, não reescrever o RFC.

- **Onde:** `apps/engine/lib/engine/agents/staff_tools.ex`
- **Teste:** `apps/engine/test/engine/agents/staff_server_test.exs`
  ("propõe o RFC, grava o artefato e devolve o handoff ao arquiteto";
  "propose_rfc com opções vazias vira tool-result de erro"; "falha ao
  devolver o handoff ao arquiteto NÃO derruba o processo")
- **ADR:** [0088](adr/0088-staff-agente-dormente-para-disparo-automatico.md)

**Declarado, não escondido**: a roster do painel do time
(`apps/web/src/lib/agent-status.ts`, `staffActive`) e o card do dashboard
(`ProjectCardSummary.roster`, `apps/api/.../projects-summary.repository.ts`)
mostram o Staff quando ativo, mesmo critério de `infraActive` — evitando a
divergência que o comentário de `RosterFacts` já alertava. `SessionPage.tsx`
NÃO foi tocado: `staff` fica fora de `AGENTES_DE_CHAT`, o mesmo padrão já
aceito para `infra` (um lead REAL e ATIVO também fora dessa lista — o
handoff para ele "nunca é aceito por AQUI", conforme o comentário do próprio
arquivo). O caminho ponta a ponta de uso hoje é a rota interna
(`POST .../agent/message`, `agent: "staff"`), não a tela de Sessão.

---

## O gate `implementavel` ativa — QA-estratégia como segundo momento do qa-lead (RN-340/341, ADR 0090)

### RN-340 — O gate `implementavel` decide a story ANTES do dev agent escrever código {#rn-340}

`docs/gates.yml` declarava o gate `implementavel` (dono `dev-lead`) desde a
FASE 14d com `status: planned` — nunca ativado. O [ADR 0090](adr/0090-qa-estrategia-e-appsec-segundo-momento.md)
ativa: a ferramenta `assess_implementability` do Dev Lead propõe o **parecer
de implementabilidade** de uma story (`implementavel`/`inviavel` +
justificativa) como `proposed_action`, MESMO padrão de
`propose_execution_plan` ([RN-284](#rn-284)) — três desfechos
(`{:ok, texto} | {:pending, action_id} | {:error, texto}`), papel mínimo
`maintainer` em `decide.ts`, e DELIBERADAMENTE fora do bloco de tetos
absolutos (é decisão inicial, não ultrapassagem de teto).

**O parecer depende do plano de teste, que é um PRÉ-REQUISITO, não um
argumento.** `run_assessment/2` lê o `artifact.plano_de_teste` mais recente
da story no HISTÓRICO da própria sessão do Dev Lead (emitido pela
QA-estratégia, [RN-341](#rn-341)):

1. **Sem plano ainda** — dispara `Engine.Gates.Dispatcher.run_qa_estrategia/3`
   (mesma indireção trocável em teste que `run_qa/2`/`run_secops/2` já usam)
   e devolve `{:error, texto}` pedindo para tentar de novo em instantes. Erro
   de ferramenta é ENTRADA do laço, não fim de linha ([RN-163](#rn-163)): o
   Dev Lead tem teto de 14 iterações para tentar de novo. A janela de espera
   é aceita e declarada — a QA-estratégia roda em processo separado
   (`qa-lead`), e um `run/2` síncrono não pode bloquear esperando o
   resultado sem acoplar os dois processos.
2. **Com plano** — monta o parecer com o plano de teste EMBUTIDO no payload
   (síntese e critérios executáveis), para o usuário decidir sem precisar
   abrir dois eventos, e propõe a ação.

- **Onde:** `apps/engine/lib/engine/agents/dev_lead_tools.ex`
  (`run_assessment/2`, `spec_assess_implementability/0`),
  `dev_lead_server.ex` (`run_tool/3`); `apps/engine/lib/engine/gates/dispatcher.ex`
  (`run_qa_estrategia/3`); `apps/api/src/domain/actions/decide.ts`
  (`assess_implementability`); `docs/gates.yml` (`implementavel`,
  `status: active`)
- **Teste:** `apps/engine/test/engine/agents/dev_lead_tools_test.exs`
  (describe "assess_implementability"), `dev_lead_server_test.exs`
  (describe "suspensão em aprovação" — os dois testes novos),
  `apps/api/test/domain/actions/decide.spec.ts` (describe "parecer de
  implementabilidade do Dev Lead")
- **Origem:** [ADR 0090](adr/0090-qa-estrategia-e-appsec-segundo-momento.md)

### RN-341 — A QA-estratégia é o segundo MOMENTO do qa-lead, e nunca suspende {#rn-341}

`docs/fluxo.yml` declarava o papel `qa-estrategia` como `proposto`, com o
critério de separação escrito no próprio registro: "pode ser o próprio
qa-lead em segundo MOMENTO, não necessariamente agente novo — a separação é
de entregável". O [ADR 0090](adr/0090-qa-estrategia-e-appsec-segundo-momento.md)
constrói exatamente isso: `Engine.Gates.QaEstrategiaAgent` é módulo SEM
ESTADO (não é `GenServer`), acionado por `Engine.Gates.QaLeadServer.run_design/3`
— um ponto de entrada NOVO e ADITIVO no MESMO processo `qa-lead`, sem tocar
`run/2` (o caminho de sempre, revisão de PR, amarrado a
`DevAgentState.find_by_task_id`).

**O contexto é LEVE, e é aí que a separação de entregável aparece.**
`Engine.Gates.QaEstrategiaContext.fetch/3` busca SÓ story (de
`EngineApiClient.list_backlog/1`, a árvore que o PO já lê — [RN-164](#rn-164))
e `module_map` vigente (de `EngineApiClient.get_infra_context/2`, o MESMO
`GetInfraContextUseCase` que o Infra Lead consome, aqui só pelo campo
`moduleMap`) — SEM `dev_state`, SEM `worktree_path`: o gate `implementavel`
roda PRE-DEV, antes de existir dev agent, worktree ou `task_id`. Nenhuma
rota nova na api — as duas funções já existiam.

**Nunca suspende.** O registro de ferramentas (`ReadFile`, `SearchWorkspace`,
`EmitPlanoDeTeste`) não inclui `terminal` nem `write_file` — as DUAS únicas
tools que `Engine.Harness.Hooks.ActionPipeline` intercepta para criar
`proposed_action`. Sem chamada nenhuma passando pelo pipeline de ações, o
`ToolLoop` deste agente nunca produz `:pending`, e `run_design/3` roda
SÍNCRONO dentro do próprio `handle_cast` — sem mecanismo de
suspensão/retomada, ao contrário do resto da área de QA.

**O teto de iterações fica em 8 (conversacional), não 60 (gate) — de
propósito, não lacuna.** Este agente roda SEM `token_budget_micros` — não há
task nem budget de task ainda. O critério da [RN-085](#rn-085) não é "quem
trabalha muito": é "o que segura o gasto além do teto de iterações". Sem
budget por baixo, subir o teto multiplicaria o pior caso sem nada para
conter — a MESMA razão pela qual `infra-workflows` fica em 8 mesmo usando
ferramenta. `"qa-estrategia"` NÃO ganhou cláusula própria em
`Engine.Harness.Iteracoes.tipo/1`: cair no default é a decisão certa.

O entregável — `emit_plano_de_teste` (síntese, critérios executáveis
verificáveis, estratégia de automação GENÉRICA e sem framework — decisão de
escopo desta frente, na `spec/0` que o modelo lê, não uma validação em
código) — vira o artefato `artifact.plano_de_teste`
(`ArtifactEmitter.emit/5`, schema validado, `criteriosExecutaveis` não pode
ser vazio), no event log da MESMA sessão que chamou `run_design/3` — é lá
que `assess_implementability` ([RN-340](#rn-340)) o lê depois. Falha
(limite de iterações, orçamento, modelo que para sem emitir) NUNCA é
silenciosa: `agent.error` durável com origem, mesma régua da
[RN-059](#rn-059).

- **Onde:** `apps/engine/lib/engine/gates/qa_estrategia_agent.ex`,
  `qa_estrategia_context.ex`, `qa_lead_server.ex` (`run_design/3`),
  `tools/emit_plano_de_teste.ex`, `hooks/termination_plano_de_teste.ex`;
  `apps/engine/lib/engine/harness/artifact_schemas.ex` (`plano_de_teste`);
  `apps/engine/lib/engine/harness/iteracoes.ex` (SEM cláusula nova, ver
  acima); `docs/fluxo.yml` (`qa-estrategia`, `status: active`)
- **Teste:** `apps/engine/test/engine/gates/qa_estrategia_agent_test.exs`,
  `qa_estrategia_context_test.exs`, `qa_lead_server_test.exs` (describe
  "run_design"), `apps/engine/test/engine/harness/artifact_schemas_test.exs`
  (describe "plano_de_teste"), `iteracoes_test.exs` ("qa-estrategia é
  conversacional DE PROPÓSITO")
- **Origem:** [ADR 0090](adr/0090-qa-estrategia-e-appsec-segundo-momento.md)

---

## O appsec ganha o segundo momento do secops (RN-360/361, ADR 0090)

`docs/fluxo.yml` já declarava o `id: appsec` como `proposto`, com o critério
de separação escrito por antecipação: "mesmo padrão do QA: dois MOMENTOS, não
dois agentes por ora". Esta mudança constrói esse segundo momento — threat
model de DESIGN, ANTES de existir código/PR — decisão consciente do dono do
produto de antecipar a ativação, sem esperar o gate `implementavel` que o
próprio registro citava como gatilho.

### RN-360 — O threat model de DESIGN roda sobre story + module_map, sem worktree/task_id, no MESMO processo do secops {#rn-360}

Quem roda o appsec é o MESMO `Engine.Gates.SecOpsAgentServer` que já existe
para o veredito determinístico de PR — não um processo novo. `run_design/2`
(`apps/engine/lib/engine/gates/secops_agent_server.ex:76`) é um `GenServer.cast`
para a mesma chave de `Registry` (`{project_id, "secops"}`) que `run/2` já
usa; o `handle_cast({:run_design, story_id}, state)`
(`secops_agent_server.ex:93`) busca o contexto por
`Engine.Gates.AppSecContextBuilder.fetch/2`
(`apps/engine/lib/engine/gates/appsec_context_builder.ex:31`) — a story no
backlog do projeto (`EngineApiClient.list_backlog/1`, a MESMA leitura que a
RN-164 deu ao PO) e o `module_map` vigente da sessão que criou a story
(`EngineApiClient.get_infra_context/2`, a MESMA leitura sem task/story que a
área de Infra já faz) — e então chama `Engine.Gates.AppSecAgent.run/3`
(`apps/engine/lib/engine/gates/appsec_agent.ex:47`).

`AppSecAgent` é módulo SEM ESTADO (não é GenServer, mesma forma de
`QaPerformanceSegurancaAgent`), com registro de ferramentas SEM `Terminal` —
`[ReadFile, SearchWorkspace, EmitThreatModel]` — rodando um checklist
STRIDE-lite (Spoofing/Tampering/Repudiation/Information disclosure/Denial of
service/Elevation of privilege) via `Engine.Harness.ToolLoop.run/1`. A
diferença estrutural do "segundo momento sem Terminal, sem task_id" para o
padrão de gate anterior: nenhum `dev_state`/`worktree_path` entra no `ctx` —
`ReadFile`/`SearchWorkspace` degradam para o fallback de
`Engine.Actions.Workspace.workspace_dir/1` (o checkout COMPARTILHADO do
projeto, não um worktree de agente), e `session_id` vem de
`story["sessionId"]`, nunca de um `dev_state`. `EmitThreatModel`
(`apps/engine/lib/engine/gates/tools/emit_threat_model.ex`) não tem veredito
`approved`/`changes_requested` — o appsec sempre TERMINA registrando o
threat model, nunca aprovando/reprovando nada —, e por isso não reaproveita
`Engine.Gates.Hooks.Termination` (a forma extraída é outra): tem hook
PRÓPRIO, `Engine.Gates.Hooks.AppSecTermination`.

Terminado com sucesso, `run_appsec_design/3`
(`secops_agent_server.ex:234`) emite `artifact.threat_model`
(`storyId`/`threatModel`/`requisitosDeSeguranca`/`riscos`, schema em
`apps/engine/lib/engine/harness/artifact_schemas.ex:51` — `riscos` fica de
fora das chaves obrigatórias porque lista vazia é resposta válida). Falha
(teto de iterações, orçamento, ou o modelo parando sem chamar
`emit_threat_model`) vira `agent.error` durável com origem
(`modelo`/`politica`/`infra`), mesma régua da RN-059 — nunca resposta vazia
nem silêncio só em broadcast.

**Lacuna declarada, não bug**: `run_design/2` é ACIONÁVEL, mas nada aciona
sozinho ainda. O ponto de disparo natural é `assess_implementability` do Dev
Lead (frente `qa-estrategia`, gate `implementavel`, mesmo ADR 0090) — fora do
escopo desta entrega, que foi mantida autocontida (nenhum arquivo de outra
frente tocado: `decide.ts`, `docs/gates.yml` e `dev_lead_tools.ex`
intocados).

- **Onde:** `apps/engine/lib/engine/gates/secops_agent_server.ex` (`run_design/2`,
  `handle_cast/2`, `run_appsec_design/3`, `emit_threat_model/3`,
  `emit_bloqueio_appsec/3`); `apps/engine/lib/engine/gates/appsec_agent.ex`;
  `apps/engine/lib/engine/gates/appsec_context_builder.ex`;
  `apps/engine/lib/engine/gates/tools/emit_threat_model.ex`;
  `apps/engine/lib/engine/gates/hooks/appsec_termination.ex`;
  `apps/engine/lib/engine/harness/artifact_schemas.ex` (schema `threat_model`)
- **Teste:** `apps/engine/test/engine/gates/appsec_agent_test.exs`,
  `apps/engine/test/engine/gates/appsec_context_builder_test.exs`,
  `apps/engine/test/engine/gates/secops_agent_server_test.exs` (os três
  testes de `run_design`)
- **Origem:** [ADR 0090](adr/0090-qa-estrategia-e-appsec-segundo-momento.md)

### RN-361 — O threat model concluído cria TRÊS handoffs, sempre endereçando o LEAD {#rn-361}

`criar_handoffs_appsec/3` (`secops_agent_server.ex:266`) cria um handoff por
alvo declarado em `docs/fluxo.yml` (`saidas` do `appsec`): arquiteto,
dev-lead e infra — mesmo padrão de
`OfferInfraHandoffUseCase`/`ArquitetoServer.executar_offer_infra_handoff/1`
(chamadas SEPARADAS, uma por alvo, para uma falha de handoff não desfazer os
outros dois já criados). O id do fluxo é `area-infra`, mas o AGENTE
endereçável é `"infra"` (`apps/api/src/domain/agents/agent-areas.ts` —
`lead: 'infra'`), nunca `area-infra`: handoff externo endereça só o LEAD de
área (ADR 0038), e `CreateHandoffUseCase.assertHandoffTargetAllowed`
recusaria um `toAgent` que não resolve a um lead/agente-sem-área. Falha de UM
alvo vira `agent.error` narrado por alvo (RN-116) — os outros dois handoffs
já criados não são desfeitos.

- **Onde:** `apps/engine/lib/engine/gates/secops_agent_server.ex:55`
  (`@appsec_handoff_targets`), `:266` (`criar_handoffs_appsec/3`)
- **Teste:** `apps/engine/test/engine/gates/secops_agent_server_test.exs`
  ("run_design: threat model concluído emite artifact.threat_model e cria
  os TRÊS handoffs")
- **Origem:** [ADR 0090](adr/0090-qa-estrategia-e-appsec-segundo-momento.md)

---

## Analytics e delivery-metricas: os dois papéis viram RELATÓRIO (RN-320..322, ADR 0089)

Decisão consciente do dono do produto de ANTECIPAR a construção dos papéis
`analytics` e `delivery-metricas` (`docs/fluxo.yml`, `status: proposto`) sem
esperar o gatilho orgânico que cada um já declarava. Os dois viram um SCRIPT
só — `apps/api/scripts/analise-funil.ts` — no mesmo formato de
`medir-execucao.ts` (Fase 13b): `NestFactory.createApplicationContext`,
`--projeto <uuid>` obrigatório, leitura pura via Drizzle, sem escrita
nenhuma. A forma é a que o próprio fluxo já prescrevia: `analytics` é
"absorvido por `medicao`" e `delivery-metricas` "nunca vira agente" —
nenhum GenServer, nenhum agente de LLM.

### RN-320 — `analise-funil.ts` é script, nunca agente — mesmo esqueleto de `medir-execucao.ts` {#rn-320}

O comando é `pnpm --filter api analise:funil -- --projeto <uuid> [--json]`.
Só lê `proposed_actions` (filtrado por `actionType IN (git_commit, pr_open,
git_merge)`) e `projects`, nunca escreve. A guarda
`if (process.argv[1]?.endsWith('analise-funil.ts')) void main();` no fim do
arquivo é a mesma de `medir-execucao.ts`: sem ela, importar o módulo no
teste subiria o Nest inteiro e derrubaria o processo no `process.exit` do
parser de argumentos.

- **Onde:** `apps/api/scripts/analise-funil.ts:64-73` (`lerOpcoes`),
  `:256-319` (`main`), `:390` (guarda de execução)
- **Teste:** `apps/api/test/scripts/analise-funil.spec.ts` (só as funções
  puras — a parte que fala com o banco é exercitada por execução real,
  mesmo padrão de `medir-execucao.spec.ts`)
- **ADR:** [0089](adr/0089-analytics-e-delivery-metricas-como-relatorio.md)

### RN-321 — O funil conta SESSÃO por etapa, só ação `executed`, e o lead time usa `updated_at` da execução {#rn-321}

`calcularFunil` conta quantas sessões produziram pelo menos um `git_commit`,
`pr_open` e `git_merge` com `status: 'executed'` — uma sessão com três
commits entra uma vez só em cada etapa que alcançou, nunca três. A taxa de
conversão de uma etapa é `sessões-da-etapa / sessões-da-etapa-anterior`, e é
`null` (não `0`, não `Infinity`) quando o denominador é zero — não há
"conversão de" nada para medir. `calcularLeadTimes` usa `updated_at` da
linha de `proposed_actions`, não `created_at`: é o instante em que
`ExecuteGitActionUseCase#record` gravou o `execution_result` de verdade
(`updateExecutionResult` bumba `updatedAt`), não quando a ação foi
PROPOSTA — a mesma distinção que `token_usage`/preço congelado já fazem em
outro contexto (RN-042). Merge cujo `updated_at` precede o do commit (duas
levas na mesma sessão, ou dado incoerente) é descartado, nunca vira lead
time negativo.

- **Onde:** `apps/api/scripts/analise-funil.ts:115-160` (`calcularFunil`),
  `:170-193` (`calcularLeadTimes`)
- **Teste:** `apps/api/test/scripts/analise-funil.spec.ts` (describe
  "calcularFunil", "calcularLeadTimes")
- **ADR:** [0089](adr/0089-analytics-e-delivery-metricas-como-relatorio.md)

### RN-322 — Deployment frequency real filtra merge em branch PROTEGIDA; três métricas ficam DECLARADAS ausentes, nunca aproximadas {#rn-322}

`deploymentFrequencyPorDia` só conta `git_merge` `executed` cujo
`executionResult.targetBranch` está em `PROTECTED_BRANCHES`
(`apps/api/src/domain/actions/protected-branches.ts`) — merge numa branch de
feature não é deploy. Cruza por REFERÊNCIA com o gate `backmerge`
(`docs/gates.yml`): a evidência dele é CI, em `.release/gate.json`, fora do
alcance de um script que só lê o banco, então não há junção de dado, só o
mesmo recorte de branch que o gate observa.

Três métricas saem do relatório com uma seção "Não medido, de propósito" em
vez de um número aproximado:

1. **Funil de produto completo (ideação → commit).** `sessions` não tem
   `storyId` — [RN-230](#rn-230) já declara a lacuna na aba Criativo.
   Fechá-la exige schema novo, fora do escopo desta frente (nenhuma
   migration).
2. **Evidência de adoção por feature.** Não é dado que falta coletar: o
   Brabo não instrumenta os projetos que ele CONSTRÓI, e não há caminho
   nenhum para essa telemetria existir hoje.
3. **MTTR e change failure rate.** Exigem sinal de INCIDENTE de produção
   real — a mesma dependência que `docs/fluxo.yml` já registra para
   `secops-runtime`/`platform` (`status: proposto`/`planned`, ativação
   sincronizada com `DEPLOY_ENABLED`).

- **Onde:** `apps/api/scripts/analise-funil.ts:220-247`
  (`deploymentFrequencyPorDia`), `:372-386` (seção "Não medido" impressa)
- **Teste:** `apps/api/test/scripts/analise-funil.spec.ts` (describe
  "deploymentFrequencyPorDia")
- **ADR:** [0089](adr/0089-analytics-e-delivery-metricas-como-relatorio.md)

---

## `secops-runtime` — relatório de abuso sobre `rate_limit_hits` (RN-375..377, ADR 0091)

Decisão consciente do dono do produto de antecipar o papel `secops-runtime`
(`docs/fluxo.yml`, `camada_seguranca`), que nasceu `proposto` com o critério
de separação "produção com tráfego real (pós `DEPLOY_ENABLED` + `platform`
ativo)". Esse gatilho não disparou — não há tráfego de produção. O que existe
hoje é `rate_limit_hits` (`RateLimitGuard`, ADR 0027): uma linha por request
contado, gravada mesmo sob tráfego de dev/CI. `secops-runtime` entra como
SCRIPT (`pnpm --filter api relatorio:seguranca-runtime`), não agente LLM nem
`GenServer` — não há decisão a tomar, só dado a agregar.

### RN-375 — O relatório declara a janela, nunca finge um histórico maior {#rn-375}

`DomainGaugesCollector.pruneRateLimit`
(`apps/api/src/infrastructure/observability/domain-gauges.collector.ts:177-186`)
apaga hits mais velhos que `2 × RATE_LIMIT_WINDOW_MS` (240s com o default de
60s), a cada `METRICS_GAUGE_INTERVAL_MS` (15s por padrão) — a tabela nunca
guarda mais que uns poucos minutos. `relatorio-seguranca-runtime.ts` imprime
DUAS janelas, nunca uma só: a CONFIGURADA (o teto teórico da poda) e a
OBSERVADA (o que os dados efetivamente cobrem, do primeiro ao último
`occurred_at` lido). Quando as duas coincidem, o relatório diz explicitamente
que é sinal de poda — hits mais antigos podem ter existido e já foram
apagados — nunca "não houve mais hits que isso".

### RN-376 — O ranking trabalha só com o que `bucket_key` guarda: balde e quando {#rn-376}

`RateLimitGuard.registrarEContar`
(`apps/api/src/interfaces/http/shared/rate-limit.guard.ts:150-170`) grava só
`bucket_key` (`user:<uuid>` ou `ip:<endereço>`) e `occurred_at` — NÃO há
rota, método HTTP nem motivo do bloqueio. `rankingDeBaldes` e
`interpretarBalde` (`apps/api/scripts/relatorio-seguranca-runtime.ts`)
classificam por esses dois campos e só eles; um `bucket_key` fora do formato
`user:`/`ip:` cai em `desconhecido` em vez de estourar, para o script não
quebrar se um `RateLimitGuard` futuro gravar outro formato. Pedir "ranking de
IP por rota" seria inventar dimensão que a tabela nunca guardou.

### RN-377 — A seção "não medido" é permanente, e cita as três lacunas por nome {#rn-377}

`montarRelatorio` sempre inclui `naoMedido`: detecção automática de
incidente, resposta a incidente e postmortem de segurança. As três dependem
do mesmo gatilho que `docs/fluxo.yml` já declarava para `secops-runtime` —
tráfego de produção real — e nenhuma delas é simulada com incidente de
exemplo nem número inventado (mesmo princípio dos ADRs 0041/0042/0077: sem o
dado real, a lacuna fica visível em vez de fingida). A seção só sai da lista
quando o produto tiver tráfego real para medir contra ela — não é um TODO a
apagar na próxima limpeza.

- **Onde:** `apps/api/scripts/relatorio-seguranca-runtime.ts`,
  `apps/api/package.json` (`relatorio:seguranca-runtime`)
- **Teste:** `apps/api/test/scripts/relatorio-seguranca-runtime.spec.ts`
- **ADR:** [0091](adr/0091-secops-runtime-relatorio-de-abuso.md)

---

## `platform` ganha uma primeira entrega: relatório de telemetria sob demanda (RN-385/386, ADR 0092)

### RN-385 — O papel `platform` nasce como SCRIPT de leitura pontual, sobre as mesmas fontes do `DomainGaugesCollector` {#rn-385}

`docs/fluxo.yml` descreve `platform` (`camada_plataforma`) como "SRE / Platform
— dono do loop de retorno", `status: planned`, com ativação sincronizada a
`DEPLOY_ENABLED` — que não existe. O dono do produto decidiu antecipar a
metade que já tem dado real por trás: `pnpm --filter api relatorio:telemetria
[--projeto <uuid>] [--json]` lê, sob demanda, as MESMAS perguntas que o
`DomainGaugesCollector` já responde a cada `METRICS_GAUGE_INTERVAL_MS` para o
scrape do Prometheus — sessões ativas/closing por projeto, tasks bloqueadas
por projeto, estado do último backup (idade, status, tamanho, sempre GLOBAL,
nunca por projeto, porque o produto tem um backup só). Não é agente LLM nem
`GenServer`: é leitura avulsa, sem estado, que termina depois de imprimir.

As consultas SQL são REPLICADAS, não importadas do coletor — os métodos dele
(`collectSessions`/`collectBlockedTasks`/`collectBackup`) são privados e
terminam escrevendo num gauge Prometheus (`this.metrics.*.set(...)`); não há
uma metade pura de "só a query" para reusar sem acoplar um script avulso ao
ciclo de vida de um `@Injectable` do NestJS. O script também NÃO é um segundo
coletor: não registra métrica nenhuma, não roda em `setInterval`.

A saída sempre traz "onde ver mais" (os três dashboards versionados em
`deploy/k8s/observability/dashboards/*.json`, os alertas em
`deploy/k8s/observability/alerts/brabo-alerts.yaml`, `docs/runbook.md
#observabilidade` e `pnpm dev:obs` para observabilidade local) — o script
LINKA para o que já existe, nunca duplica.

- **Onde:** `apps/api/scripts/relatorio-telemetria.ts`; espelha
  `apps/api/src/infrastructure/observability/domain-gauges.collector.ts`
- **Teste:** `apps/api/test/scripts/relatorio-telemetria.spec.ts` (funções
  puras — `parseArgs`, `formatarIdade`, `formatarBytes` — mesmo recorte de
  `medir-execucao.spec.ts`: a parte que fala com o banco é exercitada rodando
  o script contra um banco real)
- **ADR:** [0092](adr/0092-platform-relatorio-de-telemetria-sob-demanda.md)

### RN-386 — O relatório de telemetria declara, sem inventar, o que NÃO mede {#rn-386}

O gatilho real do papel `platform` (`DEPLOY_ENABLED`) não existe: não há
ambiente de produção com tráfego real, não há SLO numérico definido em lugar
nenhum do produto, e não há postmortem possível sem incidente de verdade.
`relatorio-telemetria.ts` diz isso na PRÓPRIA saída, numa seção "não medido",
em vez de fingir cobertura que não tem — a mesma disciplina do ADR 0042 para
nota de modelo e do ADR 0077 para qualidade de código: sem o dado real, o
produto DECLARA a lacuna, nunca inventa o número.

Três lacunas, todas explícitas: **SLO numérico formal** (nenhum está
definido); **postmortem** (depende de incidente real que não aconteceu); e
**telemetria de volta ao produto em loop fechado** (o script é leitura
pontual sob demanda — observar, decidir e agir sozinho é o que tornaria
`platform` `active` em `docs/fluxo.yml`, e por isso o `gate_saida: { id:
operavel, status: planned }` do papel permanece `planned`, intocado por esta
mudança).

- **Onde:** `apps/api/scripts/relatorio-telemetria.ts` (função `imprimir`,
  seção "Não medido"); `docs/fluxo.yml` (`camada_plataforma › platform ›
  saidas_alvo`, artefato `telemetria-consolidada`, campo `nota`)
- **Teste:** cobertura indireta — a seção é texto fixo verificado por leitura
  do arquivo; não há verdade condicional a testar aqui (nada a errar entre
  "medido" e "não medido" além do texto em si)
- **ADR:** [0092](adr/0092-platform-relatorio-de-telemetria-sob-demanda.md)

---

## O papel `dbre` vira dois scripts mecânicos (RN-400..403, ADR 0093)

### RN-400 — O parecer de migração é análise ESTÁTICA de SQL, e ignora o padrão de risco quando ele só aparece em comentário {#rn-400}

`lintarConteudo` (o núcleo puro de `lint-migracao.ts`) varre cada `.sql` de
`apps/api/src/db/migrations/` linha a linha, sem depender de `--projeto`
nem de banco — o risco que ele acha é de SCHEMA, não de carga, e por isso
não depende de volume real de dados nenhum (o critério de separação que
`docs/fluxo.yml` já declarava para o papel). Cinco padrões, cada um com a
razão anexada ao achado: `DROP TABLE`/`TRUNCATE` (perda total,
irreversível), `DROP COLUMN` (perda da coluna, irreversível),
`ALTER COLUMN ... TYPE`/`SET DATA TYPE` (pode reescrever a tabela inteira)
e `ADD COLUMN ... NOT NULL` sem `DEFAULT` (falha contra tabela não-vazia —
o padrão que `0042_tough_captain_midlands.sql` evitou conscientemente,
com nullable-primeiro-depois-backfill-depois-`SET NOT NULL`).

Linha que começa com `--` (comentário) é ignorada de propósito: este
repositório explica em prosa, no próprio SQL, por que um padrão foi
EVITADO — analisar o texto do comentário acharia o padrão exatamente na
frase que descreve por que ele não foi usado.

- **Onde:** `apps/api/scripts/lint-migracao.ts` (`REGRAS`, linha 75;
  `lintarConteudo`, linha 126)
- **Teste:** `apps/api/test/scripts/lint-migracao.spec.ts` — cada padrão
  individualmente, combinação de vários na mesma migration, e "ignora o
  padrão de risco quando ele aparece só em COMENTÁRIO"
- **ADR:** [0093](adr/0093-dbre-linter-de-migracao-e-relatorio-de-backup.md)

### RN-401 — O linter não é gate de CI: varre o repositório inteiro, não o diff da PR {#rn-401}

Rodar `pnpm --filter api lint:migracao` contra as migrations reais do
repositório ACHA três ocorrências em migrations já mergeadas e aceitas
(`0006_whole_princess_powerful.sql:22` e `0034_quick_saracen.sql:33` —
`DROP COLUMN`; `0007_groovy_bullseye.sql:2` — `ALTER COLUMN ... SET DATA
TYPE`). Isso não é defeito a corrigir de passagem (mesma regra do
CLAUDE.md que protege os achados Z/AD/AE): são migrations já aceitas, e
apagá-las apagaria a evidência de por que a decisão foi tomada. É também
por isso que o script sai `!= 0` mas **não** está wireado em
`.github/workflows/ci.yml` — um gate que reprova o repositório inteiro
reprovaria toda PR para sempre, por um achado que não é dela. Virar gate
de bloqueio de verdade exige escopar ao DIFF contra a base do PR (a mesma
técnica de `scripts/ci/pr-police.ts`), deixado para quando `dbre` precisar
BLOQUEAR merge — hoje ele é parecer manual, não veredito automático.

- **Onde:** `apps/api/scripts/lint-migracao.ts` (`principal`, exit code no
  fim do arquivo); decisão documentada no cabeçalho do arquivo e no ADR
- **Teste:** não aplicável a CI (não há step); a execução manual contra o
  repositório real está registrada no ADR 0093, seção Consequências
- **ADR:** [0093](adr/0093-dbre-linter-de-migracao-e-relatorio-de-backup.md)

### RN-402 — O relatório de backup relê exatamente a lógica de `collectBackup()`, nunca uma segunda forma de calcular {#rn-402}

`relatorio-backup.ts` não é um gauge Prometheus novo — é a MESMA leitura
de `backup_runs` que `DomainGaugesCollector.collectBackup()` já faz
(último SUCESSO, para idade e tamanho; a ÚLTIMA execução, para pegar o
caso de estar falhando há dias com um backup bom mais antigo), sob
demanda. `avaliarBackup` é pura — recebe as duas linhas e o instante
atual, devolve `status`
(`ok`|`atrasado`|`nunca_houve`|`falha_recente_com_sucesso_antigo`). O
limiar de "atrasado" (26h = `BACKUP_AGE_ATRASADO_SEGUNDOS`) é o MESMO do
alerta `brabo-backup-atrasado`
(`deploy/k8s/observability/alerts/brabo-alerts.yaml`), duplicado (não
importado — o YAML do Grafana não é lido pelo processo Node) e sujeito a
divergir se um lado mudar sem o outro.

- **Onde:** `apps/api/scripts/relatorio-backup.ts` (`avaliarBackup`, linha
  82; `BACKUP_AGE_ATRASADO_SEGUNDOS`, linha 54)
- **Teste:** `apps/api/test/scripts/relatorio-backup.spec.ts` — nunca
  houve backup, backup ok, atrasado, exatamente no limiar (não conta como
  atrasado), falha recente com sucesso antigo, atrasado tem prioridade
  sobre falha recente, idade nunca negativa
- **ADR:** [0093](adr/0093-dbre-linter-de-migracao-e-relatorio-de-backup.md)

### RN-403 — O relatório de backup NÃO reexecuta o restore; ele aponta para o procedimento já testado {#rn-403}

O procedimento de restaurar de verdade (`make test-restore` /
`deploy/k8s/test-restore.sh`) já foi executado e está documentado em
`docs/runbook.md#restore`, com RTO real (~40s contra um banco de ~108 KB)
registrado na seção "Última execução verificada" daquele documento.
`relatorio-backup.ts` responde uma pergunta mais estreita e mais
frequente — "o backup que esse restore usaria está saudável agora?" — e
cita o runbook para quem precisa de fato restaurar, em vez de duplicar o
procedimento ou reexecutá-lo.

- **Onde:** `apps/api/scripts/relatorio-backup.ts` (mensagem final de
  `imprimir`, citando `docs/runbook.md#restore`)
- **Teste:** não aplicável (é texto estático apontando para o runbook,
  não lógica); a existência do procedimento testado é RN de
  `docs/runbook.md#restore` em si
- **ADR:** [0093](adr/0093-dbre-linter-de-migracao-e-relatorio-de-backup.md)

---

## Auditoria fluxo.yml × código — Onda 2: RN-160 no backend e delegação Dev Lead → dev (RN-404/405, ADR 0094)

Fecha os dois últimos achados da auditoria (seção D,
`docs/explanation/auditoria-fluxo-vs-codigo.md`): B6 (RN-160 garantida só no
cliente) e B1 (a delegação Dev Lead → `dev-<modulo>` declarada pelo ADR 0053
item 5 e nunca implementada).

### RN-404 — "Confirmar arquitetura pronta" (RN-160) é revalidada no BACKEND, não só desabilitada na UI {#rn-404}

[RN-160](#rn-160) garantia a regra ("pelo menos 1 história promovida antes do
handoff duplo Arquiteto→Dev Lead/Infra") só desabilitando o botão em
`SessionPage.tsx` — uma chamada HTTP direta a
`POST /agents/arquiteto/handoff-infra`, sem passar pela UI, ignorava a regra
por completo. `OfferInfraHandoffUseCase.execute` agora consulta
`StoryRepository.findByProject(projectId)` e recusa com `BadRequestException`
quando NENHUMA história do projeto tem `status !== 'draft'` — a checagem vem
ANTES de gravar `architecture.readiness_confirmed` e ANTES de qualquer
chamada ao engine (`offerInfraHandoff`/`offerDevHandoff`): uma recusa não
pode deixar rastro de handoff meio-ofertado no event log, que é imutável.
`StoryRepository` foi escolhido (e não `ListBacklogUseCase`) por ser mais
leve — não precisa montar a árvore épico→história→tarefa para responder
"existe alguma não-draft?".

- **Onde:** `apps/api/src/application/use-cases/agents/offer-infra-handoff.use-case.ts`
  (linhas 27-34, a checagem; injeção de `StoryRepository` no construtor)
- **Teste:** `apps/api/test/application/use-cases/agents/offer-infra-handoff.use-case.spec.ts`
  — zero história promovida recusa com ZERO chamada ao engine e ZERO evento
  gravado; com ao menos uma `ready`/`in_progress`/`done`, segue o fluxo normal
- **ADR:** [0094](adr/0094-delegacao-dev-lead-vira-dado.md)

### RN-405 — A delegação Dev Lead → dev vira dado em `delegations`, com `parecerArtifactId` redefinido para "o que justificou a decisão" {#rn-405}

O ADR 0053 (FASE 14d) já previa a delegação Dev Lead → `dev-<modulo>` como
"o mesmo caminho de QA e Infra" (`delegations`, `area = 'dev'`), mas
declarou isso fora de escopo. `dev_lead_server.ex` nunca gravava a tabela —
só QA (`qa_lead_server.ex`) e Infra (`infra_lead_server.ex`) gravavam, e os
dois do lado ENGINE, porque é lá que o subagente produz um PARECER (veredito
de rodada única) que justifica `parecerArtifactId`.

O Dev Lead não tem esse padrão: a ativação de um `dev-<modulo>` acontece do
lado API, em `AcceptParallelizationUseCase.execute` — chamada tanto pelo
caminho direto (`RequestParallelizationUseCase`, abaixo do teto de sessão da
[RN-083](#rn-083)) quanto pelo aprovado (`ExecuteParallelizationUseCase`,
depois que o usuário aprova a `proposed_action` tipo `parallelize`). A
gravação entrou DENTRO desse método — cobre os dois caminhos de graça,
porque os dois já convergem ali —, com `status: 'completed'` REDEFINIDO para
esta área: significa "a delegação foi EFETIVADA" (o agente subiu), não "o
subagente terminou e emitiu parecer" como em QA/Infra (decisão registrada no
[ADR 0094](adr/0094-delegacao-dev-lead-vira-dado.md)).

`parecerArtifactId` aponta para o `id` do evento `artifact.module_map` mais
recente e vigente do projeto — obtido de
`SessionEventRepository.listByTypeForProject(projectId, 'artifact.module_map')`
(método genérico já existente, usado por `computeCoverage` para
`artifact.business_rule`; nenhuma consulta nova foi escrita, só uma chamada a
mais dele — o último item da lista é o mais recente, porque a função ordena
por `createdAt` ASC) — o artefato que justificou a decisão de delegar.
`area: 'dev'`, `leadAgent: 'dev-lead'`, `subagent` é o id exato do agente
ativado (`extraDevAgentId(module)`, a MESMA função que constrói o id em todo
o resto do use case — nenhum formato novo). Sem `artifact.module_map` no
projeto (não deveria acontecer — é entrada obrigatória do Dev Lead em
`docs/fluxo.yml`), a delegação NÃO é gravada com um id inventado: só loga o
estado inesperado, pela mesma lição da RN-059 (nunca falha silenciosa, mas
também nunca finge uma justificativa que não existe). E falha de
`RecordDelegationUseCase.execute` (ex.: banco fora do ar) é capturada e
logada, nunca propagada — a ativação do dev agent já é sucesso quando a
tentativa de gravar a delegação acontece, e não pode ser derrubada por uma
gravação auxiliar.

- **Onde:** `apps/api/src/application/use-cases/execution/accept-parallelization.use-case.ts`
  (`recordDevDelegation`, chamado ao fim de `execute`)
- **Teste:** `apps/api/test/application/use-cases/execution/accept-parallelization.use-case.spec.ts`,
  describe "delegação Dev Lead → dev (área dev, ADR 0094)" — grava com
  `area: 'dev'` apontando pro module_map mais recente; sem module_map não
  grava (e não lança); `RecordDelegationUseCase` falhando não derruba a
  ativação
- **ADR:** [0094](adr/0094-delegacao-dev-lead-vira-dado.md)

---

## Auditoria fluxo.yml × código — Onda 6 (última): o gate `necessidade-validada` (RN-406, ADR 0095)

Fecha o último achado do plano da auditoria (seção D,
`docs/explanation/auditoria-fluxo-vs-codigo.md`) — B2. As outras cinco
ondas já tinham fechado (a 3, 4 e 5 antecipadas fora de ordem pelos ADRs
0089/0090; a 1 e a 2 nos PRs anteriores). `docs/fluxo.yml` (papel
`criativo`) declarava `gate_saida: { id: necessidade-validada, status:
proposto }` desde o ADR 0085 sem mecanismo nenhum atrás — e
`modelo-de-time.md` já registrava por que: o Criativo (o modelo) decidir
sozinho que a necessidade que ele mesmo produziu está validada seria
autovalidação, não gate de verdade.

### RN-406 — O gate `necessidade-validada` se fecha com um clique SEPARADO do usuário, nunca com o Criativo se autovalidando {#rn-406}

`SessionPage.tsx` ganha um terceiro botão de confirmação, no MESMO padrão
interacional de "Estou pronto para produzir" (RN-142) e "Confirmar
arquitetura pronta" ([RN-160](#rn-160)): "Confirmar necessidade validada"
(`handleValidateNecessity`) chama `POST
.../agents/criativo/validate-necessity`, que grava `necessity.validated`
com `payload.productBriefId` apontando para o `artifact.product_brief`
mais recente da sessão.

O botão só habilita DEPOIS que `confirm_readiness` já consolidou o
`product_brief` (`hasProductBrief`, `events.some(e => e.type ===
'artifact.product_brief')`) — não faz sentido "validar" um resumo
executivo que ainda não foi produzido, e é essa a leitura mais
consistente com `docs/fluxo.yml`: `necessidade-validada` é gate de SAÍDA
do Criativo, o momento em que o trabalho dele já entregou um artefato
concreto. `ValidateNecessityUseCase` revalida a mesma pré-condição no
BACKEND (`SessionEventRepository.listByTypeInSession(sessionId,
'artifact.product_brief')`, pega o último por `seq`) — a UI desabilitada
sozinha não bastaria, mesma lição da [RN-404](#rn-404).

Diferente de `OfferInfraHandoffUseCase` (RN-160), esta confirmação NÃO
sinaliza o engine: o handoff Criativo→PO já aconteceu dentro do próprio
`confirm_readiness`
(`CriativoServer.executar_confirm_readiness/1`), então não há agente
nenhum esperando por este evento — ele é só o registro de que um humano
validou o MÉRITO do que já foi entregue. `ValidateNecessityUseCase` não
recebe `ApiToEngineClient` no construtor.

`docs/gates.yml` ganha o gate `necessidade-validada`: `status: active`,
`aprovacao_humana: true` (é literalmente um clique humano),
`verificacao: script`, mas `severidade: warn` — nada no produto hoje
CONSULTA a passagem deste gate antes de deixar o PO seguir (diferente de
`story-promovida`/`plano-de-adocao`, que são `block` porque uma trava
real de código os impede de serem pulados). `docs/fluxo.yml` (papel
`criativo`) passa `status: proposto` → `status: ativo`.

- **Onde:** `apps/api/src/application/use-cases/agents/validate-necessity.use-case.ts`;
  `apps/api/src/interfaces/http/agents/agents.controller.ts`
  (`validateNecessityHandoff`); `apps/web/src/routes/SessionPage.tsx`
  (`hasProductBrief`, `necessidadeJaValidada`, `handleValidateNecessity`)
- **Teste:** `apps/api/test/application/use-cases/agents/validate-necessity.use-case.spec.ts`
  — sem `product_brief`, recusa ANTES de gravar qualquer evento; com um ou
  mais, grava referenciando o MAIS RECENTE;
  `apps/web/src/routes/SessionPage.validar-necessidade.test.tsx` — botão
  desabilitado sem `product_brief`, habilitado com ele, some depois de
  `necessity.validated`
- **ADR:** [0095](adr/0095-gate-necessidade-validada.md)

---

### RN-407 — O PO lê o funil de entrega e DORA parcial, terceira leitura escopada ao projeto {#rn-407}

O PO ganhou uma TERCEIRA ferramenta de leitura — `listar_metricas_de_produto`
(`:direct`, sem parâmetro nenhum) — servida por
`GET /internal/projects/:projectId/product-metrics`, mesmo desenho das duas
irmãs da [RN-164](#rn-164): escopo fechado no projeto, sem termo de busca,
sem paginação.

`docs/fluxo.yml` (papel `po`, entrada `metricas-de-produto`) declarava
`status: lacuna` desde o [ADR 0089](adr/0089-analytics-e-delivery-metricas-como-relatorio.md),
que já tinha entregue o DADO — o script `pnpm --filter api analise:funil`
mede o funil real sessão → commit → PR → merge, o lead time real e a
deployment frequency real a partir de `proposed_actions`. O que faltava era
só o MECANISMO: o PO nunca tinha como reler esse relatório dentro do turno.
Fecha o item B4 da auditoria `fluxo.yml` × código
([docs/explanation/auditoria-fluxo-vs-codigo.md](explanation/auditoria-fluxo-vs-codigo.md)) —
a ÚLTIMA pendência da tabela "Backlog do modelo de time"
(docs/explanation/backlog.md), que fica vazia depois desta.

O CÁLCULO é o MESMO do script, nunca duplicado: as funções puras
(`calcularFunil`/`calcularLeadTimes`/`leadTimeMedioMs`/
`deploymentFrequencyPorDia`) e a query que monta `AcaoGit[]`
(`buscarAcoesGitDoFunil`) foram extraídas de `apps/api/scripts/analise-funil.ts`
para `apps/api/src/application/services/funil-metrics.ts` — um caso de uso em
`src/` não pode importar de `scripts/`, e o script passou a REEXPORTAR dali
em vez de definir localmente, sem mudar assinatura nem comportamento (o
teste de regressão do script continua verde sem ser tocado).

O corpo JSON que a rota devolve **não tem campo nenhum** para as três
ausências permanentes que o script já declarava em texto ("Não medido, de
propósito": funil de produto completo ideação → commit, evidência de adoção
por feature, MTTR/change failure rate) — o shape do relatório nunca reservou
espaço para elas. A ferramenta do PO cita as três pelo NOME no TEXTO que
devolve ao modelo, sempre, e não só quando o número dá zero: sem essa
seção o PO leria só os números do funil e concluiria por omissão que não há
lacuna nenhuma.

- **Onde:** `apps/api/src/application/services/funil-metrics.ts`;
  `apps/api/scripts/analise-funil.ts` (reexporta);
  `apps/api/src/application/use-cases/backlog/list-product-metrics.use-case.ts`;
  `apps/api/src/interfaces/http/internal/internal-projects.controller.ts`;
  `apps/api/src/interfaces/http/internal/dto/product-metrics.response.dto.ts`;
  `apps/engine/lib/engine/harness/tools/listar_metricas_de_produto.ex`;
  `apps/engine/lib/engine/agents/po_server.ex`;
  `apps/engine/lib/engine/sessions/engine_api_client.ex`
- **Teste:** `apps/api/test/application/use-cases/backlog/list-product-metrics.use-case.spec.ts`;
  `apps/api/test/scripts/analise-funil.spec.ts` (regressão — continua
  importando de `scripts/analise-funil.ts`, sem alteração);
  `apps/engine/test/engine/harness/tools/listar_metricas_de_produto_test.exs`;
  `apps/engine/test/engine/agents/po_server_test.exs`
- **Origem:** mesmo padrão da [RN-164](#rn-164) (leitura de agente escopada
  ao projeto, sem efeito externo, sem `proposed_action`); o dado é do
  [ADR 0089](adr/0089-analytics-e-delivery-metricas-como-relatorio.md) — esta RN só
  fecha o mecanismo de leitura que faltava.

### RN-408 — `MAIL_TRANSPORT=smtp` deriva o boot pelo padrão da RN-114, sem o default público {#rn-408}

Fecha o item de backlog "SMTP real no MailSender" ([ADR 0096](adr/0096-smtp-real-no-mailsender.md)).
`resolverConfigSmtp()` valida `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`/
`SMTP_FROM` no MESMO formato da [RN-114](#rn-114) — em produção
(`NODE_ENV === 'production'`), cada um derruba o boot se estiver ausente, só
com espaços, ou (no caso de `SMTP_HOST`) igual ao literal de exemplo
publicado (comentado) em `.env.example`. `SMTP_FROM` tem uma checagem a
mais: precisa casar `"Nome <email@dominio>"` ou só `email@dominio`.
`SMTP_PORT` inválida (não numérica ou fora de 1–65535) também derruba o boot
em produção.

A diferença para a RN-114 original é estrutural, não de rigor: os quatro
segredos da RN-114 (`AUTH_JWT_SECRET` e companhia) TÊM um default de
desenvolvimento público, e é a existência desse default que torna "não
vazia" uma checagem insuficiente. Aqui não há default nenhum — `SMTP_HOST`
fica em branco se ninguém setar —, então a régua inteira só é aplicada
quando `NODE_ENV=production` E `MAIL_TRANSPORT=smtp`. Fora de produção, ou
com o transporte em `log` (o default, inclusive em produção), nenhuma das
cinco variáveis é exigida: enviar e-mail de verdade é opt-in do operador, e
sem esse opt-in explícito o comportamento continua sendo o log-only de
sempre — inclusive em produção, para quem já roda o produto hoje não
quebrar ao atualizar.

A validação roda dentro do construtor de `SmtpMailSender`, exercitado pelo
`useFactory` de `AuthUseCasesModule` na montagem do grafo de providers do
Nest (`NestFactory.create()`) — não por uma chamada eager em `main.ts`, como
os quatro segredos da RN-114 original. A diferença é deliberada: aqueles
quatro protegem caminho que QUALQUER requisição pode exercitar a qualquer
momento, então falhar antes de subir importa. `SmtpMailSender` só é
instanciado quando o operador optou por `smtp`, e `AuthUseCasesModule` é
importado incondicionalmente (via `AuthHttpModule`), então a validação
ainda acontece no boot — mesmo desenho que `CREDENTIALS_MASTER_KEY` já usa
(validada no construtor de `EnvelopeEncryptionService`, exercitado pela
mesma montagem de grafo).

- **Onde:** `apps/api/src/infrastructure/mail/smtp-config.ts`
  (`resolverConfigSmtp`, `resolverModoDeTransporte`),
  `apps/api/src/infrastructure/mail/smtp-mail-sender.ts` (`SmtpMailSender`,
  chama `resolverConfigSmtp()` no construtor),
  `apps/api/src/application/use-cases/auth/auth-use-cases.module.ts`
  (`useFactory` do `MailSender`)
- **Teste:** `apps/api/test/infrastructure/mail/smtp-config.spec.ts`
  (mesmo padrão de `auth-key-material.spec.ts`/`service-token.spec.ts`),
  `apps/api/test/infrastructure/mail/smtp-mail-sender.spec.ts`
- **Origem:** [ADR 0096](adr/0096-smtp-real-no-mailsender.md), estendendo o
  padrão da [RN-114](#rn-114) (que por sua vez estende o
  [ADR 0059](adr/0059-segredo-do-state-de-oauth-sem-default.md))

---

## "N agentes online" no dashboard — status AO VIVO, nunca presença histórica (RN-409, ADR 0097)

Item do backlog anterior. Investigação prévia (`docs/explanation/backlog.md`)
confirmou que não existia agregado de liveness nenhum — nem por projeto, nem
por workspace: o que existia era só presença HISTÓRICA
(`RosterFacts` — "já apareceu na sessão alguma vez") e status ao vivo de
VERDADE só no cliente, derivado do event log, e só quando um projeto está
ABERTO (`deriveAgentRoster`). O card do dashboard hoje forçava
`() => 'ocioso'` porque não desenhava status nenhum — este é o hardcode que
a RN substitui.

### RN-409 — "N online" soma dois mecanismos pela MESMA régua: não ocioso, não travado {#rn-409}

`ProjectCardSummary.onlineAgentCount` (`GET /workspaces/:workspaceId/
projects-summary`) é a contagem de agentes ONLINE agora — trabalhando ou com
uma pendência esperando decisão —, nunca tamanho de equipe. Chamar de
"online" um número que na verdade é "já apareceu alguma vez" seria enganoso
(mesmo princípio dos [ADR 0041](adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)/
[0042](adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)/
[0077](adr/0077-ranking-de-modelos-por-capacidade-sem-nota-inventada.md) contra dado
fingido).

Duas FONTES, uma régua:

- **Dev agents** — `engine.dev_agent_states.status`, agregado em lote por
  `project_id` (`status NOT IN ('idle', 'idle_tripped')`). `working`,
  `awaiting_gate` e `awaiting_approval` contam (RN-047/ADR 0052 — os cinco
  estados da máquina do dev); `idle`/`idle_tripped` não. `dev-<modulo>` e
  `dev-<modulo>-2` são chaves DISTINTAS (`agent_id` na tabela), então contam
  separado sem esforço nenhum — é a própria chave primária que já separa.
- **Agentes conversacionais** (criativo/po/arquiteto/dev-lead/ux-designer/
  staff/infra) — último evento `agent.status` de cada `actor_id`, na sessão
  MAIS RECENTE do projeto (mesmo escopo de sessão que o resto de `RosterFacts`
  usa, RN-090). `agent.status` só tem três valores possíveis
  (`Engine.Sessions.LiveBroadcast.agent_status/4` recusa qualquer outro):
  `working`/`awaiting_approval` contam, `idle` não.

**QA/SecOps NUNCA contam** — não é filtro, é AUSÊNCIA de dado: nenhum dos
dois emite `agent.status` (rodam veredito único por invocação, sem noção de
"ocioso" entre chamadas — o status deles vem de `pr.gate_changed`/
`infra.gate_changed`, um mecanismo à parte que `deriveAgentRoster` já trata
separado). Não precisou de exclusão explícita: a consulta só soma o que tem
o tipo de evento certo.

A régua é a MESMA que `deriveAgentRoster` já aplicaria se o projeto estivesse
aberto (`'trabalhando'`/`'aguardando'` no cliente ≅ `working`/
`awaiting_gate`/`awaiting_approval` no backend) — os DOIS caminhos calculam
"online" a partir do mesmo eventual estado (event log/tabela de estado
persistida), só que por MECANISMOS diferentes (agregação SQL no backend,
dobra sobre eventos já buscados no cliente), no mesmo espírito de
`infraActive`/`uxDesignerActive`/`staffActive` (RN-090/RN-287: duas fontes,
uma régua). Não há função compartilhada entre `apps/api` e `apps/web` para
isto — os dois já divergem de linguagem/runtime para o resto de `RosterFacts`
também, e introduzir um pacote compartilhado só para uma contagem seria
peso maior que o problema.

**Consulta nova contra schema que a api não migra.** `engine.dev_agent_states`
é tabela do ENGINE (Ecto, schema Postgres `"engine"`), mesmo banco físico,
mesma conexão — não uma segunda fonte de dados, um segundo NAMESPACE no
mesmo Postgres. O precedente já existia: `apps/api/scripts/medir-execucao.ts`
já lê `engine.oban_peers` pelo mesmo caminho (raw SQL via Drizzle), só que
como SCRIPT manual, nunca testado. Esta RN eleva o padrão para código de
PRODUÇÃO testado — ver o [ADR 0097](adr/0097-leitura-direta-do-schema-do-engine-para-online-agent-count.md)
para a decisão de NÃO expor isto como rota HTTP interna no engine.

**Custo medido, não fingido grátis.** As duas consultas novas levam o total
do read model de DOZE para CATORZE (RN-090 continua valendo — catorze é
CONSTANTE, provado por `projects-summary.repository.spec.ts` contando idas
ao banco com 2 e com 20 projetos). Nenhuma tem `WHERE` por tempo — a de
`agent.status` escaneia os mesmos `session_events` das sessões mais recentes
que `lastEvents`/`marcos` já escaneiam ao lado dela, então o custo marginal é
o de mais um filtro de `type` sobre um plano de consulta que já ia acontecer,
não uma tabela nova sendo varrida do zero. Lacuna DECLARADA: não há execução
real recente (dogfooding) com volume de produção para medir `ms` de verdade
contra a régua da Fase 22 (525 mil linhas, `EXPLAIN ANALYZE`) — as duas
consultas novas ficam sem número medido, só o argumento estrutural acima.

- **Onde:** `apps/api/src/application/ports/projects-summary-repository.port.ts`,
  `apps/api/src/infrastructure/persistence/drizzle/projects-summary.repository.ts`,
  `apps/api/src/interfaces/http/iam/dto/iam.response.dto.ts`,
  `apps/web/src/lib/api-types.ts`, `apps/web/src/components/ProjectCard.tsx`,
  `apps/web/src/routes/Dashboard.tsx`
- **Teste:** `apps/api/test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  (`describe('onlineAgentCount (RN-409)')` — dev agent working/idle/
  idle_tripped, awaiting_gate/awaiting_approval, duas instâncias do mesmo
  agente-base, agente conversacional working/idle/awaiting_approval, só o
  ÚLTIMO `agent.status` conta, QA/SecOps nunca contam, soma entre as duas
  fontes, isolamento entre projetos);
  `apps/api/test/support/global-setup.ts` (`ensureEngineFixture` — a tabela
  do engine criada como fixture MÍNIMA e declarada, só para o teste acima
  poder existir);
  `apps/web/src/components/ProjectCard.test.tsx` (badge "N online" some com
  `0`/`undefined`, aparece com `onlineAgentCount > 0`)
- **Origem:** `docs/explanation/backlog.md` (item herdado da FASE 13c/
  colheita do dogfooding); decisão de produto de que o número tinha de ser
  liveness de verdade, não presença histórica, registrada no prompt que
  encomendou esta correção

---

### RN-411 — O quarto sinal de trabalho pendente: dev agents falam `dev.*`, não `agent.status` {#rn-411}

Achado por USO real, não por teste: numa sessão de execução, cinco dev
agents subiram, ficaram `idle_tripped` (o circuit breaker da
[RN-047](#rn-047), travados esperando o usuário desbloquear uma task
manualmente), e o heartbeat de 30 segundos
(`Engine.Sessions.SessionServer.handle_info(:heartbeat_timeout, state)`)
fechou a sessão por baixo enquanto o trabalho — e a espera por decisão
humana — continuava.

`GetSessionPendingWorkUseCase` já tinha um terceiro sinal
([RN-064](#rn-064)) para o mesmo problema: agente ativado, sem `idle`
posterior, segura a sessão. Mas esse sinal só lê `agent.status`, o
vocabulário dos agentes CONVERSACIONAIS (Criativo/PO/Arquiteto/Dev
Lead/UX Designer/Staff/Infra). `Engine.Dev.DevAgentServer` (via
`Engine.Dev.AgentIo`) nunca emite `agent.status` — usa vocabulário
PRÓPRIO no event log da sessão: `dev.started`, `dev.working`,
`dev.awaiting_gate`, `dev.awaiting_approval`, `dev.idle`,
`dev.idle_tripped`, `dev.blocked`, `dev.error`. Uma sessão de execução
com dev agent trabalhando OU travado sempre devolvia `pending: false`
pelo terceiro sinal, porque nenhum `agent.status` existe para ele.

O QUARTO sinal busca o ÚLTIMO evento `dev.*` de cada `actor.id`
(`dev-<modulo>`/`dev-<modulo>-2`, a mesma chave da
[RN-195](#rn-195)) que já apareceu na sessão — igual ao terceiro sinal,
mas sobre múltiplos tipos de evento em vez de um só, porque o estado do
dev agent não é UM tipo com um `payload.status` variável, são tipos DE
evento distintos por transição. A régua: `pending: true` quando o
último for `dev.working`, `dev.blocked` ou `dev.idle_tripped` — os três
significam "tem trabalho rolando ou um humano precisa agir", e travado
esperando desbloqueio É trabalho pendente (é literalmente o que o
usuário estava fazendo quando a sessão fechou na execução real). Só
`dev.idle` (sem tarefa nenhuma pra pegar, drenado de verdade) não
conta.

`dev.awaiting_gate` e `dev.awaiting_approval`, como último evento, NÃO
disparavam este sinal originalmente — ficaram de fora da régua tal como
decidida à época. `awaiting_gate` era uma lacuna residual CONHECIDA; a
[RN-412](#rn-412) a fechou, junto com `awaiting_approval` (por um
argumento novo, não o original — ver RN-412).

- **Onde:** `apps/api/src/application/use-cases/sessions/get-session-pending-work.use-case.ts`
- **Teste:** `apps/api/test/application/use-cases/sessions/get-session-pending-work.use-case.spec.ts`
  (dev agent `dev.working`/`dev.blocked`/`dev.idle_tripped` como último
  evento → `pending: true`; `dev.idle` → `pending: false`; sessão sem
  evento `dev.*` preserva o comportamento anterior; só o ÚLTIMO evento de
  cada agente importa; `dev-<modulo>-2` também segura; isolamento entre
  sessões)
- **Origem:** achado por uso real — sessão de execução real com cinco dev
  agents em `idle_tripped` fechada pelo heartbeat enquanto o usuário
  ainda desbloqueava tarefas manualmente

---

### RN-412 — `dev.awaiting_gate`/`dev.awaiting_approval` seguram a sessão; a janela efetiva de compactação é coerente com o transporte {#rn-412}

Achado por USO real ("nas PRs sempre está estourando entity too
large"), com dois defeitos que se encadeiam. O gate de QA/SecOps
morria com `413 request entity too large` → o dev agent que esperava o
veredito ficava preso em `dev.awaiting_gate` indefinidamente → esse
estado NÃO era um dos três que a [RN-411](#rn-411) segurava → o
heartbeat de 30s fechava a sessão por baixo → a aba Executores exigia
sessão ativa (`findActiveExecutionSession`) e apagava o roster inteiro,
mesmo com trabalho real pendurado.

**A causa do 413 era da própria api do Brabo, nunca do provider de
LLM** — ver [ADR 0098](adr/0098-limites-de-transporte-e-janela-efetiva-de-compactacao.md).
Duas correções, as duas necessárias (uma sem a outra só adia o
estouro):

1. `apps/api/src/main.ts` nunca configurou limite de body do Express —
   valia o default de 100 KB, o gargalo mais estreito no sentido
   engine→api (o Phoenix aceita até 8 MB). `POST
   /internal/sessions/:sessionId/llm-turn` reenvia o histórico INTEIRO
   da conversa a cada iteração do `ToolLoop`, e 3-4 tool results de
   32 KiB (teto individual da RN-150) já somavam mais que 100 KB.
   `API_JSON_BODY_LIMIT` (default `10mb`) fecha essa ponta.
2. `Engine.Harness.ContextManager.Default` tinha dois defeitos que
   deixavam a compactação inalcançável antes do corpo estourar:
   `estimate/1` contava só `content`, então mensagens de `assistant`
   com `toolCalls` pesados custavam ~zero tokens na estimativa; e a
   janela de compactação usava só `context_window` (128.000 tokens nos
   agentes de gate — `qa_automacao_agent.ex`, `qa_performance_seguranca_agent.ex`,
   `qa_estrategia_agent.ex`, `appsec_agent.ex`, `dev_agent_server.ex`),
   dando ~350 KB antes de compactar (`threshold` 0.7 × janela). A
   janela EFETIVA agora é `min(context_window, teto_de_transporte)`
   (`transport_max_body_bytes`, config única, default 8 MiB), e o corte
   sempre acontece em FRONTEIRA DE ITERAÇÃO do `ToolLoop`
   (`group_by_iteration/1`) — nunca separando uma mensagem `assistant`
   com `toolCalls` dos `role: "tool"` que a respondem, que quebraria o
   protocolo de tool-use do provider.

**A régua de trabalho pendente** (`DEV_PENDING_TYPES`,
`get-session-pending-work.use-case.ts`) ganhou dois tipos:
`dev.awaiting_gate` (o argumento original — o gate agora não deveria
mais morrer, mas travar a sessão por causa dele nunca foi correto, é
defesa em profundidade) e `dev.awaiting_approval`, por um argumento
DIFERENTE do que a RN-411 tinha descartado: a decisão de
aprovação/negação grava `proposed_actions.status` de forma SÍNCRONA na
transação do `ApproveActionUseCase` (o segundo sinal já não vê mais
`pending` ali), mas a retomada do dev agent é ASSÍNCRONA — só depois de
`avisarQuemEsperava()` gravar `task.action_settled`/`task.pr_settled`
na outbox é que `Engine.Outbox.Drain` enfileira o job do Oban que
acorda `DevAgentServer`. Nessa janela, nada segurava a sessão: o mesmo
defeito da RN-411, um nível mais fundo.

**A aba Executores/Visão Geral** tinham o defeito irmão do lado web:
`executionActivated` era derivado de `events.some((e) => e.type ===
'execution.activated')` sobre a janela de só 200 eventos de
`useSessionEvents` (`{ limit: 200, latest: true }`) — `execution.activated`
é dos PRIMEIROS eventos de uma sessão de execução e saía da janela em
qualquer sessão real. O valor correto já existia, agregado sobre TODOS
os eventos (`bool_or(...)`, [RN-090](#rn-090)), no resumo do workspace
(`ProjectCardSummary.roster.executionActivated`) — `ProjectExecutorsTab.tsx`
e `ProjectOverviewTab.tsx` passaram a consumi-lo em vez de derivar da
janela. `gatesEverOpened` sofre da MESMA classe de defeito e ficou
DECLARADO como limitação conhecida, não corrigido aqui — corrigi-lo
exigiria mudar a assinatura de `deriveAgentRoster`/`rosterFactsFromEvents`,
fora do escopo desta correção.

- **Onde:** `apps/api/src/main.ts`, `apps/engine/lib/engine/harness/context_manager.ex`,
  `apps/engine/lib/engine/harness/tokenizer.ex`,
  `apps/api/src/application/use-cases/sessions/get-session-pending-work.use-case.ts`,
  `apps/web/src/routes/ProjectExecutorsTab.tsx`, `apps/web/src/routes/ProjectOverviewTab.tsx`
- **Teste:** `apps/api/test/main.spec.ts` (body de 1 MB aceito; acima do
  limite → 413); `apps/engine/test/engine/harness/context_manager_test.exs`
  (toolCalls pesados disparam compactação; `:pinned` sobrevive; teto de
  transporte força compactação mesmo com janela de modelo grande);
  `get-session-pending-work.use-case.spec.ts` (último evento
  `dev.awaiting_gate`/`dev.awaiting_approval` → `pending: true`);
  `ProjectExecutorsTab.test.tsx`/`ProjectOverviewTab.test.tsx` (sessão
  com >200 eventos ainda mostra o roster via resumo agregado)
- **Origem:** achado por uso real — "nas PRs sempre está estourando
  entity too large", investigado em conjunto com o dono do produto

---

### RN-413 — Templates de prompt vivem fora do código, versionados no grafo {#rn-413}

Todo prompt de agente era heredoc Elixir inline até esta entrega —
identidades (`Engine.Harness.Agents`), kickoffs de PO/Arquiteto/Dev
Lead/UX/Infra, o prompt de sumarização do `ContextManager`. Um template
de prompt agora pode viver como `(:PromptTemplate {name})-[:HAS_VERSION]->
(:PromptVersion {version, body, hash, active})` no Neo4j, gravado via
`POST /internal/graph/prompt-templates` e lido via `GET
/internal/graph/prompt-templates/:name`. Upsert é idempotente por hash —
gravar o MESMO conteúdo duas vezes não cria versão nova, só a versão com
hash igual já existente é devolvida.

Primeira leva extraída para `prompts/*.md` (front-matter `name`/`version`,
placeholders documentados numa seção "Variáveis" para trechos que no
`.ex` original eram interpolação): `ux-designer-identity`,
`psychologist-kickoff`, `anamnese-kickoff`, `context-manager-summarize`.
`scripts/dev/seed-prompts.ts` lê `prompts/*.md`, calcula hash sha256 do
corpo e envia ao endpoint acima. **Nenhum `.ex` foi editado nesta
entrega** — os quatro GenServers continuam com o texto inline; consumir
os templates do grafo (fonte `:graph` do `InstructionFiles`, precedência
`db > graph > dir > root`) é a Onda seguinte, declarada fora daqui.

- **Onde:** `apps/api/src/application/use-cases/graph/upsert-prompt-template.use-case.ts`,
  `get-prompt-template.use-case.ts`; `apps/api/src/interfaces/http/internal/internal-graph.controller.ts`;
  `prompts/*.md`, `prompts/README.md`; `scripts/dev/seed-prompts.ts`
- **Teste:** casos de uso com `GraphStore` mockado (upsert com mesmo hash
  não duplica) + teste de integração contra Neo4j real, pulando
  graciosamente quando indisponível; `scripts/dev/seed-prompts.spec.ts`
  (parsing de front-matter, hash determinístico, template malformado
  reprova com mensagem clara)
- **Origem:** decisão do dono do produto, inspirada no repositório
  [ErickWendel/neo4j-ai-experiments](https://github.com/ErickWendel/neo4j-ai-experiments)
  (ver [ADR 0099](adr/0099-neo4j-grafo-de-conhecimento-e-templates.md))

---

### RN-414 — `rag_search`: agentes ganham a ferramenta que o produto nunca tinha exposto {#rn-414}

`grep -rn "rag" apps/engine/lib` dava ZERO ocorrências antes desta
entrega — o RAG completo (pgvector, busca híbrida) só era consumido pela
aba web "Chat RAG". A tool nova `rag_search`
(`apps/engine/lib/engine/harness/tools/rag_search.ex`, categoria
`:direct`, leitura não é efeito externo) chama `POST /internal/rag/search`
— rota nova que REUSA `HybridSearchUseCase` sem duplicar a lógica de
busca — e devolve hits formatados com citação (`path` + trecho), sempre
com `degraded: true` visível no INÍCIO do texto quando o embedding não
estava disponível (nunca escondido pelo corte de teto).

Tetos próprios, no espírito da RN-150: `top_k` clampado a 10 dentro da
própria tool (não confia no que a api aceitaria), teto de 16 KiB no texto
formatado (menor que os 32 KiB de `search_workspace`/`read_file` — cada
hit de RAG já é chunk+excerpt inteiro). Falha de rede vira erro legível
ao modelo, nunca crash do `ToolLoop` (RN-163).

Registrada em `Engine.Harness.Tools` (PO/Arquiteto/conversacionais) e
`Engine.Dev.Tools` (dev agent); estendida também aos gates de leitura que
já citam ADR/convenção indexada (QA-automação, QA-estratégia, AppSec,
QA-performance/segurança) — não a `Infra.WorkflowsAgent` nem
Psicólogo/Anamnese, que raciocinam sobre event log, não sobre docs/código
do projeto.

- **Onde:** `apps/engine/lib/engine/harness/tools/rag_search.ex`;
  `apps/engine/lib/engine/sessions/engine_api_client.ex` (`rag_search/4`);
  `apps/api/src/interfaces/http/internal/internal-rag.controller.ts`
- **Teste:** `rag_search_test.exs` (hits formatados com citação;
  degradação visível; falha de rede sem crash; teto de bytes truncando
  com marca clara; clamp de `top_k`); `engine_api_client_rag_test.exs`
- **Origem:** ver [ADR 0100](adr/0100-rag-search-e-modelos-garantidos-no-boot.md)

---

### RN-415 — Modelos Ollama garantidos no boot, degradação do RAG declarada {#rn-415}

`nomic-embed-text` (`RAG_EMBEDDING_MODEL`) nunca era puxado
automaticamente — bug real, não só desta feature: o entrypoint do
serviço `ollama` só puxava `llama3.2:1b`, e o RAG degradava para
léxico-only em SILÊNCIO em qualquer ambiente limpo, sem nenhum sinal de
que isso estava acontecendo. Serviço novo `ollama-model-loader` (one-shot,
`docker-compose.yml` dev e prod), lendo `OLLAMA_REQUIRED_MODELS`
(default `gemma3:1b,yi-coder:1.5b,nomic-embed-text`), aditivo ao serviço
`ollama` existente — o entrypoint dele continua intocado.

A degradação deixou de ser silenciosa: `rag_search` (RN-414) e a busca
híbrida da api já devolviam `degraded: true` quando o embedding falhava
— o que faltava era um CONSUMIDOR que tornasse essa flag visível. Agora
que a tool existe, o próprio modelo vê o aviso no texto formatado, e o
model-loader reduz a chance de a degradação acontecer em primeiro lugar.

- **Onde:** `docker/docker-compose.yml`, `docker/docker-compose.prod.yml`,
  `docker/ollama/pull-models.sh`; `deploy/k8s/base/neo4j/`,
  `deploy/k8s/base/ollama/job-model-loader.yaml` (template, NÃO wireado
  em nenhuma kustomization — `deploy/k8s/` ainda não tem Service `ollama`
  pra apontar, ligar isso hoje faria CrashLoopBackOff em todo deploy real)
- **Teste:** `scripts/dev/verificar-modelos-ollama.sh`, executado de
  ponta a ponta com um modelo pequeno real (`all-minilm`) para não pagar
  o custo de vários GB da lista de produção numa máquina compartilhada
- **Origem:** achado durante a fundação do grafo de conhecimento — ver
  [ADR 0100](adr/0100-rag-search-e-modelos-garantidos-no-boot.md)

---

### RN-416 — O grafo é memória DERIVADA, reconstruível por projeção da outbox {#rn-416}

A alternativa de o engine escrever no Neo4j direto foi RECUSADA — abriria
um segundo caminho de escrita além do event log, quebrando a garantia de
fonte única de verdade. `GraphProjector` (api) drena uma SEGUNDA linha de
outbox, mesma transação de sempre, `aggregateType: 'graph_projection'`
— valor que o `Engine.Outbox.Drain` do lado engine nunca casa (o filtro
dele é `aggregate_type IN ('session', 'task')`), evitando a corrida que
existiria se reusasse `'session'` (o engine já drena e marca esse tipo em
~2s). Mesmo padrão de `deny-action.use-case.ts`, que já grava em dois
`aggregateType` na mesma transação.

Instrumentado em dois pontos: `AppendSessionEventUseCase` (para
`handoff.offered`, `psychologist.hypothesis_proposed`,
`anamnese.profile_updated` — payload só `{eventId}`, o projector RELÊ o
envelope completo do event log na hora de projetar, nunca confia numa
cópia potencialmente velha) e `TransitionSessionUseCase` (para
`session.closed`/`session.closed_abnormally`, que não passam por
`session_events`). `GraphProjector` é um poller (~2s, mesmo formato do
`DomainGaugesCollector`) que chama os casos de uso de gravação já
existentes da fundação anterior — a idempotência mora NELES (chave
natural por tipo: `Hipotese.id`, `Handoff(sessionId,seq)`,
`PerfilAnamnese(userId,dimensao)`, `Interacao.sessionId` com extensão de
faixa). `GraphUnavailableError` no meio de um lote PARA o ciclo inteiro
(o resto falharia pelo mesmo motivo) — a linha fica não-processada e
tenta de novo sozinha no próximo ciclo, sem intervenção.

- **Onde:** `apps/api/src/application/graph-projection/graph-projector.ts`;
  `apps/api/src/domain/graph/graph-projection-events.ts`;
  `apps/api/src/application/use-cases/sessions/append-session-event.use-case.ts`,
  `transition-session.use-case.ts`
- **Teste:** `graph-projector.spec.ts` (caminho feliz dos quatro tipos;
  resolução evidência→seq de hipótese; `GraphUnavailableError` deixa a
  linha sem marcar e para o ciclo; ciclo seguinte reprocessa com
  sucesso; reprocessar a MESMA linha duas vezes não duplica no grafo);
  testes novos em `append-session-event.use-case.spec.ts`/
  `transition-session.use-case.spec.ts` (tipo projetável grava a segunda
  linha; tipo não-projetável não grava nada extra)
- **Origem:** ver [ADR 0101](adr/0101-memoria-relacional-como-projecao-do-event-log.md)

---

### RN-417 — Psicólogo e Anamnese consultam por relevância, com degradação declarada para recência {#rn-417}

`Psychologist.ContextBuilder`/`Anamnese.ContextBuilder` continuam lendo o
que sempre leram (eventos recentes / janela temporal), e ganham uma
SEGUNDA fonte, `EngineApiClient.rag_search/4`, com uma query derivada do
GATILHO da análise — a causa de término já classificada, no Psicólogo;
competências do catálogo ainda sem `current_profile`, na Anamnese
(NUNCA texto livre de hipótese/racional, pela proibição já estabelecida
de a Anamnese jamais inferir saúde/personalidade/idade/gênero — a query
só contém nomes de competência/membro/projeto). Os hits entram no
orçamento EXISTENTE de `Triage` (`max_prompt_events`/`max_payload_chars`)
— descontam vagas da janela de recentes, nunca somam por fora dela.

A chamada ao RAG é estritamente ADITIVA: sem hit (RAG indisponível, erro,
ou simplesmente sem resultado), o comportamento é IDÊNTICO ao de antes
desta RN — nenhum teste pré-existente precisou mudar. `degraded: true`
(RAG caiu pra léxico-only por falta de embedding) aparece EXPLICITAMENTE
no contexto final, nos dois agentes — nunca escondido pelo corte de
teto.

Os kickoffs de Psicólogo (`psychologist-kickoff`) e Anamnese
(`anamnese-kickoff`) passam a resolver como TEMPLATE do grafo
(`EngineApiClient.get_prompt_template/2`) quando `graph_templates_enabled?`
está ligada (`GRAPH_TEMPLATES_ENABLED`, default `false`) — com fallback
obrigatório pro texto inline em qualquer falha (api fora, template não
semeado, flag desligada). `:pinned => true` continua igual nos dois
caminhos.

**Consumo do restante do grafo (`query_user_context` — hipóteses com
evidência e perfis lidos DIRETO do Neo4j) fica DECLARADO fora desta
entrega**: ainda sem rota HTTP exposta do lado api; Psicólogo/Anamnese
hoje só consultam o RAG (pgvector) via `rag_search`, não o grafo de
relações em si.

- **Onde:** `apps/engine/lib/engine/psychologist/context_builder.ex`,
  `apps/engine/lib/engine/workers/psychologist_worker.ex`;
  `apps/engine/lib/engine/anamnese/context_builder.ex`,
  `apps/engine/lib/engine/workers/anamnese_worker.ex`
- **Teste:** `context_builder_test.exs` dos dois agentes (hits presentes;
  falha do RAG degrada sem erro; `degraded: true` visível; clamp de
  `top_k`; query derivada do gatilho); `psychologist_worker_test.exs`/
  `anamnese_worker_test.exs` (template com sucesso e com fallback;
  `:pinned` idêntico nos dois caminhos; flag desligada nunca chama a api)
- **Origem:** ver [ADR 0101](adr/0101-memoria-relacional-como-projecao-do-event-log.md)

---

### RN-418 — Efeito externo git e comando privilegiado (sudo/doas) viram teto absoluto, nunca `deny` {#rn-418}

Revisa a [RN-106](#rn-106) por decisão GLOBAL e explícita do dono do
produto: `git push`, abertura de PR, deploy (a mesma detecção por
prefixo que a RN-106 já tinha) e `sudo`/`doas` (novo — casados por VERBO
em `comandoPrivilegiadoNoComando`, varrendo todos os segmentos do
comando) deixam de ser `deny` incondicional e viram TETO ABSOLUTO —
`require_approval` incondicional, no MESMO bloco final e MESMO padrão de
código dos outros tetos (merge protegida, `instruction_patch`,
`parallelize`/`raise_max_parallel`, escopo de caminho):
`current.policy === 'auto_approve'` → sobrescrito. Nunca auto-aprovável
por `agent_autonomy` (inclusive o curinga `"*"` do modo automático) nem
por `permissions.json`.

A condição que torna isto seguro — sem a qual o teto seria decorativo —
é a metade que fecha "sempre permitir" NA FONTE:
`ApproveAlwaysActionUseCase`/`patternForAction` recusam gravar padrão em
`allow` pra ação de terminal com efeito externo git ou comando
privilegiado. A instância específica ainda pode ser aprovada pelo fluxo
normal (`ApproveActionUseCase`); só o clique que gravaria um padrão pra
sempre é recusado, com mensagem clara. É o mesmo argumento que a RN-106
original usava pra justificar `deny` — resolvido na origem, não mais
bloqueando o sintoma.

Um aviso automático de segurança sinalizou esta mudança durante a
implementação (reescrever uma regra que o produto documentava como
`deny` absoluto merece escrutínio) — o dono do produto confirmou
explicitamente, depois de revisar, que a decisão era essa.

- **Onde:** `apps/api/src/domain/actions/decide.ts` (bloco de tetos
  absolutos), `apps/api/src/domain/actions/external-effect.ts`
  (`comandoPrivilegiadoNoComando`, `mensagemDeComandoPrivilegiado`),
  `apps/api/src/application/use-cases/actions/approve-always-action.use-case.ts`
- **Teste:** `decide.spec.ts` (`git push` com auto mode `"*"` E com
  `allow` casando no `permissions.json` resolvem pra `require_approval`;
  `sudo` idem; os tetos anteriores continuam intactos — regressão
  completa); `approve-always-action.use-case.spec.ts` ("sempre permitir"
  sobre git com efeito externo/sudo não grava padrão; comando comum
  continua gravando normalmente — regressão); `external-effect.spec.ts`
- **Origem:** ver [ADR 0102](adr/0102-revisao-do-adr-0065-teto-absoluto-substitui-deny.md)

---

### RN-419 — O runner local se autentica por ticket de uso único, escopado a projeto e papel {#rn-419}

**REVISADA pela [RN-421](#rn-421) (ADR 0104)**: a condição de recusa do
ticket citada abaixo (`workspaceMode !== 'local'`) virou `executionMode
!== 'runner'` — mesma régua, nome novo. O resto desta entrada continua
valendo tal como está.

O canal `terminal:<projectId>` (socket Phoenix novo, `/runner`) recebe
dois papéis distintos — `:runner` (o CLI na máquina do usuário, no
máximo UM por projeto, exclusividade garantida por
`:global.register_name/3`) e `:web` (a aba Terminal, múltiplos
simultâneos) — e os dois entram autenticados por TICKET DE USO ÚNICO,
mesmo padrão de segurança da RN-108 (ticket de socket de sessão), com uma
inversão de propriedade: o ticket é EMITIDO PELO ENGINE
(`runner_socket_tickets`, schema `"engine"`, migration Ecto própria — não
uma extensão da tabela de ticket de sessão, que é da api), e a API o pede
via rota HTTP interna nova (`POST /internal/projects/:projectId/runner-tickets`)
— o inverso do fluxo de ticket de sessão, onde a api grava direto na
própria tabela.

`POST /projects/:projectId/runner-ticket` (role `developer`+, recusa se
`workspaceMode !== 'local'`) e `POST /projects/:projectId/terminal-ticket`
(role `viewer`+, qualquer modo) são as duas rotas públicas que emitem o
ticket pro cliente certo — o runner pede a primeira, a web pede a
segunda. Ticket consumido (validação + `UPDATE` condicional de uso
único) no `join` do canal; ticket de OUTRO projeto ou reusado nunca abre
o tópico.

- **Onde:** `apps/engine/lib/engine/runners/socket_ticket.ex`,
  `apps/engine/lib/engine/runners/registry.ex`,
  `apps/engine/lib/engine_web/channels/{runner_socket,terminal_channel}.ex`;
  `apps/api/src/interfaces/http/runner/runner-tickets.controller.ts`,
  `apps/api/src/application/use-cases/runner/request-runner-ticket.use-case.ts`
- **Teste:** `runner_socket_test.exs`/`terminal_channel_test.exs` (join
  com ticket válido sucede; ticket reusado recusa; ticket de outro
  projeto não abre o tópico errado; segundo `:runner` no mesmo projeto é
  recusado; um segundo runner consegue conectar depois que o primeiro
  cai); `request-runner-ticket.use-case.spec.ts`/
  `runner-tickets.controller.spec.ts` (recusa pra projeto não-`local` no
  ticket de runner; ticket de terminal funciona pra qualquer modo)
- **Origem:** ver [ADR 0103](adr/0103-runner-local-execucao-na-maquina-do-usuario.md)

---

### RN-420 — Comando de agente roteado ao runner passa pelo MESMO pipeline de aprovação; PTY é ação do usuário, auditada {#rn-420}

**REVISADA pela [RN-423](#rn-423) (ADR 0104)**: a condição pra rotear deixou
de ser binária. `workspace_mode == "local"` virou `execution_mode ==
"runner"` **E** `workspace_verified_at` não-nulo **E** runner conectado —
faltando qualquer uma das TRÊS, o comando é RECUSADO explicitamente, nunca
cai no `System.cmd`/bind-mount de `mounted` (que não existe pra um projeto
`runner`, sem bind-mount nenhum). O resto desta entrada — o pipeline de
aprovação de sempre, PTY como ação do usuário — continua valendo tal como
está.

`Engine.Actions.TerminalExecutor` decide rotear um comando pro runner (em
vez do `System.cmd` de sempre, dentro do container) **DEPOIS** que o
pipeline normal (`decide()`/`proposed_action`) já aprovou — o roteamento
é só uma escolha de DESTINO pro mesmo comando já autorizado, nunca um
segundo caminho de execução que escapa da política (que continua com os
tetos absolutos da RN-418 valendo igual, sudo/git incluídos). Condição
pra rotear (histórico, ver revisão acima): `workspace_mode == "local"` E
runner conectado (`Engine.Runners.Registry.connected?/1`) — sem qualquer
uma das duas, o comportamento de sempre continua (`System.cmd` no
container via bind-mount, ADR 0072 vira FALLBACK, nunca removido).

PTY interativo é DIFERENTE: é ação do USUÁRIO autenticado digitando no
terminal da própria máquina, não do agente — por isso NÃO passa por
`proposed_action`. Mas precisa deixar rastro: `pty_open`/`pty_close`
vindos da web emitem `terminal.session.started`/`terminal.session.ended`
no event log (endereçados à sessão mais recente do projeto,
`ProjectSession.latest_id/1`, mesmo mecanismo que a Anamnese já usa pra
narrar algo project-scoped). Achado real na consolidação: sem runner
conectado, a web precisa de um `pty_error` EXPLÍCITO de volta — descartar
o pedido só com um log no servidor deixaria a aba presa em "carregando"
pra sempre, nunca alcançando o estado "sem runner" que a tela já sabia
mostrar.

- **Onde:** `apps/engine/lib/engine/actions/terminal_executor.ex`,
  `apps/engine/lib/engine/runners/runner_router.ex`,
  `apps/engine/lib/engine_web/channels/terminal_channel.ex`
- **Teste:** `terminal_executor_test.exs` (roteia pro runner com modo
  `local` + runner conectado; `cwd` passa adiante; cai no caminho atual
  sem runner conectado; nunca roteia em modo `container`);
  `terminal_channel_test.exs` (`pty_open` sem runner conectado devolve
  `pty_error` pra web, nunca fica sem resposta)
- **Origem:** ver [ADR 0103](adr/0103-runner-local-execucao-na-maquina-do-usuario.md)

## Workspace pessoal automático no cadastro (RN-410)

Achado navegando o produto depois de um reset de banco: o botão "Novo
projeto"/"+" do dashboard não fazia NADA, sem erro nenhum. A causa raiz
estava em duas camadas. A visível: `Dashboard.tsx` só abre o
`NewProjectWizard` quando `useCurrentWorkspace()` acha um workspace
(`list[0]?.workspace` de `GET /workspaces`); sem nenhum, o clique não tem
onde ir. A funda: `RegisterUseCase` criava usuário e credencial mas NUNCA
um workspace, e o mesmo valia para `SocialLoginCallbackUseCase` no ramo
que provisiona conta nova — TODO cadastro novo, por senha ou por login
social, caía nessa parede. Só não tinha aparecido antes porque
`db/seed.ts` sempre cria um workspace junto dos dados de demonstração, e
nenhuma tela do produto chama `createWorkspace` (a rota, o caso de uso e
o client HTTP existem — só não têm chamador nenhum na UI).

### RN-410 — Toda conta NOVA nasce com um workspace pessoal, na MESMA transação da conta {#rn-410}

`RegisterUseCase` (registro por e-mail/senha) e `SocialLoginCallbackUseCase`
(provisionamento de conta nova via login social) criam o workspace e
adicionam o usuário como `owner` — mesmo par `create`/`addMember` que
`CreateWorkspaceUseCase` já usa — dentro da MESMA transação que já cria
usuário e credencial. Não é uma segunda chamada ao use case: ele abre a
PRÓPRIA transação, e o ponto é nunca existir usuário sem workspace se algo
falhar no meio.

Nome e slug saem de UMA função pura,
`nomeESlugDoWorkspacePessoal(nome, email, userId)`
(`apps/api/src/domain/auth/personal-workspace.ts`), reusada pelos dois
pontos de criação — para a regra não divergir em dois arquivos, o mesmo
motivo por trás de `normalizarEmail`/`exigirSenhaValida` morarem no
domínio. O nome usa o `nome` informado (login social usa o login do
provider), com o local-part do e-mail como fallback quando não há nome —
nunca inventa nenhum dos dois. O slug é kebab-case do mesmo texto, SEMPRE
sufixado com `userId.slice(0, 8)` (mesmo padrão de
`extraDevAgentId`/`workspaceDirName`/rótulo de sessão): `workspaces.slug`
é `UNIQUE` no banco e nada no produto faz retry-on-conflict, então dois
cadastros com nome ou local-part iguais colidiriam sem o sufixo. Nome ou
e-mail sem NENHUM caractere alfanumérico degradam para o literal
`workspace-<8 chars>`, nunca para uma string vazia.

- **Onde:** `apps/api/src/domain/auth/personal-workspace.ts`
  (`nomeESlugDoWorkspacePessoal`),
  `apps/api/src/application/use-cases/auth/register.use-case.ts`,
  `apps/api/src/application/use-cases/auth/social-login-callback.use-case.ts`
  (método `provisionarContaNova`)
- **Teste:** `apps/api/test/domain/auth/personal-workspace.spec.ts` (nome
  com/sem `nome`, fallback para o local-part do e-mail, acento/maiúscula
  virando kebab-case ASCII, fallback `workspace-<id>` sem caractere
  alfanumérico nenhum, slug sempre único por conta do sufixo);
  `apps/api/test/application/use-cases/auth/register.use-case.spec.ts`
  (conta nova ganha workspace com o usuário como `owner`, e-mail duplicado
  não cria um segundo); `apps/api/test/application/use-cases/auth/
  social-login-callback.use-case.spec.ts` (mesma prova no ramo que
  provisiona conta nova via login social)
- **ADR:** nenhum — correção de um caminho que devia ter feito isso desde
  o início, não decisão estrutural nova
- **Origem:** achado por uso real, navegando o produto — não item de
  backlog planejado

## Onda 1 do ADR 0104 — `execution_mode` em três valores, workspace verificado pelo runner

O ADR 0072 (RN-169/RN-170) e o ADR 0103 (RN-419/RN-420) nunca se falaram: o
runner reusava a mesma flag `workspace_mode == 'local'` sem bind-mount
nenhum, então usar o runner de verdade continuava exigindo passar pela
validação de PASTA MONTADA. O ADR 0104 reconcilia os dois. Migração `0048`
recria o enum (`project_workspace_mode` → `project_execution_mode`,
`local` → `mounted`) numa transação só — `ALTER TYPE ... ADD VALUE` não
pode ser referenciado na mesma transação em que foi adicionado — e soma
`workspace_verified_at` (nullable).

### RN-421 — `execution_mode` tem TRÊS valores: `container`/`mounted`/`runner` {#rn-421}

`projects.workspace_mode` (dois valores) virou `projects.execution_mode`
(três): `container` (DEFAULT, inalterado), `mounted` (o antigo `local`,
RENOMEADO — mesmo comportamento, mesma validação de disco na criação) e
`runner` (NOVO: uma pasta do usuário sem bind-mount, confirmada pelo CLI
`brabo-runner`). O CHECK do banco passou a ser `(execution_mode <>
'container') = (workspace_path IS NOT NULL)` — cobre os dois modos não-
`container` com a MESMA condição, sem `OR` explícito por valor.

`projectScopeRoot`/`Project.workspace_dir_name` (api e engine) derivam a
raiz pela MESMA regra nos dois modos não-`container`: o caminho do usuário
é a raiz, distinguido do nome de pasta gerenciada pela barra inicial. O que
muda entre `mounted` e `runner` não é ONDE a raiz fica — é QUANDO/QUEM
confirma que ela existe de verdade ([RN-422](#rn-422)/[RN-423](#rn-423)).

- **Onde:** `apps/api/src/db/migrations/0048_quiet_iron_fist.sql`,
  `apps/api/src/db/schema.ts` (`projectExecutionModeEnum`),
  `apps/api/src/domain/iam/project.entity.ts` (`PROJECT_EXECUTION_MODES`),
  `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`projectScopeRoot`), `apps/engine/lib/engine/projects/project.ex`
- **Teste:** `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (describe "projectScopeRoot nos modos mounted/runner"),
  `apps/engine/test/engine/projects/project_test.exs`
- **Decisão arquitetural:**
  [ADR 0104](adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
- **Origem:** reconciliação pedida pelo dono do produto, entre os ADRs 0072
  e 0103

### RN-422 — A validação de criação DIVERGE por modo: `mounted` toca disco, `runner` só o léxico {#rn-422}

`CreateProjectUseCase.caminhoValidado` ganhou um terceiro ramo. `mounted`
continua exatamente como `local` era (RN-170, histórico): recusa com `400`
o caminho que não existe, não é pasta ou não é gravável dentro do
container, com a instrução de montagem. `runner` valida só o
LÉXICO — mesma lista de proibições (absoluto, sem `..`, fora de raiz/pasta
de sistema, sem sobreposição com o checkout do Brabo) — sem tocar disco:
só o runner, rodando no HOST de verdade, tem autoridade para confirmar que
a pasta existe. O projeto nasce com `workspace_verified_at: null`.

`caminhoDeWorkspaceLocalValido` (o predicado léxico) foi EXPORTADO de
`project-workspaces-root.ts` para ser reusado nos dois lados que precisam
dele sem tocar disco: a criação de projeto `runner` e a confirmação do
runner ([RN-423](#rn-423)) — a mesma função, nunca duas cópias que um dia
divergem.

- **Onde:** `apps/api/src/application/use-cases/iam/create-project.use-case.ts`
  (`caminhoValidado`), `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`caminhoDeWorkspaceLocalValido`, exportada), `apps/api/src/interfaces/http/iam/dto/create-project.dto.ts`
- **Teste:** `apps/api/test/application/use-cases/iam/create-project-modo-de-workspace.spec.ts`
  (bloco `runner`), `apps/api/test/interfaces/http/iam/project-dto-modo-de-workspace.spec.ts`,
  `apps/web/src/lib/wizard.test.ts` (`canAdvanceFromWorkspace` para `runner`)
- **Decisão arquitetural:**
  [ADR 0104](adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
- **Origem:** reconciliação do ADR 0104

### RN-423 — O runner CONFIRMA o caminho; sem confirmação, o comando é recusado — nunca cai no container {#rn-423}

O runner é a **fonte da verdade** do caminho de um projeto `runner`, não o
que foi digitado no wizard. Logo depois do canal Phoenix conectar
(`terminal:<projectId>`, papel `:runner`), `apps/runner/src/index.ts`
empurra `workspace_confirm` com o `--dir` que recebeu na linha de comando.
O engine repassa (`Engine.Sessions.EngineApiClient.confirm_workspace/4`)
para `POST /internal/projects/:projectId/workspace-verification`
(`ConfirmProjectWorkspaceUseCase`), que:

1. Recusa com `400` se o projeto não estiver no modo `runner`;
2. Revalida o caminho pelo MESMO predicado léxico da criação
   ([RN-422](#rn-422)) — mesmo vindo do runner, raiz de sistema e
   sobreposição com o Brabo continuam proibidas;
3. **SOBRESCREVE** `workspacePath` com o caminho normalizado e grava
   `workspaceVerifiedAt = now()` — sem exigir igualdade com o que foi
   digitado na criação: o runner manda;
4. É IDEMPOTENTE — reconectar reportando o MESMO caminho não regrava nada
   (`changed: false`); um caminho DIFERENTE regrava, porque o runner
   continua sendo a fonte da verdade a cada reconexão;
5. Sem sessão no projeto ainda (`ProjectSession.latest_id/1` devolve
   `nil`): o `UPDATE` acontece do mesmo jeito, só o evento
   `project.workspace_verified` (e a evidência do gate
   `workspace-verificado`) fica ausente — a MESMA degradação que
   `pty_open`/`pty_close` já aceitam (RN-108/RN-420). Lacuna aceita e
   declarada, não silenciosa.

`Engine.Actions.TerminalExecutor.decisao_de_execucao/1` ganhou QUATRO
saídas, não duas: `runner` com `workspace_verified_at: nil` recusa
(`:recusar_nao_verificado`); `runner` verificado sem runner conectado
recusa (`:recusar_runner_desconectado`); `runner` verificado e conectado
roteia (`:rotear_runner`); qualquer outro modo segue o caminho de sempre
(`:caminho_de_sempre`). As duas recusas NUNCA caem no `System.cmd` — um
projeto `runner` não tem bind-mount, e "cair pro caminho de sempre" seria
executar às cegas numa pasta que o processo do engine não enxerga. A
mesma recusa vale na corrida (`Registry` dizia conectado no início de
`run/3`, mas o runner caiu antes do dispatch responder).

- **Onde:** `apps/api/src/application/use-cases/iam/confirm-project-workspace.use-case.ts`,
  `apps/api/src/interfaces/http/internal/internal-projects.controller.ts`
  (`POST :projectId/workspace-verification`),
  `apps/engine/lib/engine/actions/terminal_executor.ex`
  (`decisao_de_execucao/1`), `apps/engine/lib/engine_web/channels/terminal_channel.ex`
  (`handle_in("workspace_confirm", ...)`), `apps/engine/lib/engine/sessions/engine_api_client.ex`
  (`confirm_workspace/4`), `apps/runner/src/channel.ts`
  (`enviarWorkspaceConfirm`), `apps/runner/src/index.ts`
- **Teste:** `apps/api/test/application/use-cases/iam/confirm-project-workspace.use-case.spec.ts`,
  `apps/engine/test/engine/actions/terminal_executor_test.exs`
  (describe "roteamento pro runner local"),
  `apps/engine/test/engine_web/channels/terminal_channel_test.exs`
  (describe "workspace_confirm"), `apps/runner/src/channel.spec.ts`
  (`enviarWorkspaceConfirm` depois do join)
- **Borda:** o `docs/gates.yml` registra `workspace-verificado` como
  `severidade: warn` — quem trava de verdade é a recusa explícita do
  engine, o gate é só o registro/evidência.
- **Decisão arquitetural:**
  [ADR 0104](adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
- **Origem:** reconciliação do ADR 0104, decisão confirmada com o dono do
  produto (o runner é a fonte da verdade; sem sessão, o UPDATE acontece
  mesmo assim; comando recusado explicitamente sem verificação/conexão)

---

### RN-424 — PAT autentica SÓ `runner-ticket`, por construção — nunca dual-auth com JWT nessa rota {#rn-424}

Um Personal Access Token (`brb_…`) nunca autoriza nenhuma rota além de
`POST /projects/:projectId/runner-ticket`. A garantia não é um `if` que
uma rota nova poderia esquecer de checar: é estrutural. `@RequirePatAuth()`
marca o handler com `IS_PAT_ROUTE_KEY`; `JwtAuthGuard` (o `APP_GUARD`
global) checa esse metadado ANTES de tentar `verify()` de JWT e devolve
`true` sem validar nada — o mesmo formato de bypass que `IS_PUBLIC_KEY` e
`IS_SERVICE_ROUTE_KEY` já usam. `PatAuthGuard`, aplicado só nesse handler
via `@UseGuards()`, é quem de fato autentica: extrai o bearer, recusa
(401) qualquer valor que não comece com `brb_` sem consultar o
repositório — nunca tenta validar como JWT nessa rota, e nenhuma outra
rota aceita `brb_…` como bearer.

Depois que o `PatAuthGuard` popula `request.user`, `RolesGuard`/
`ResolveEffectiveRoleUseCase` continuam rodando, inalterados — cinto e
suspensório: se o dono do PAT perder papel suficiente no projeto pela via
normal (`ProjectMember`/workspace), o token para de autorizar mesmo sem
ter sido revogado explicitamente.

A alternativa considerada e recusada: o `JwtAuthGuard` global reconhecer
o prefixo `brb_` e popular `request.user` direto, pra QUALQUER rota. Isso
autorizaria o PAT a tudo que o papel do usuário permite no resto da api —
o escopo "só pede ticket de runner" viraria decorativo.

- **Onde:** `apps/api/src/interfaces/http/auth/pat-route.decorator.ts`
  (`IS_PAT_ROUTE_KEY`/`@RequirePatAuth()`),
  `apps/api/src/interfaces/http/auth/jwt-auth.guard.ts` (o terceiro
  early-out), `apps/api/src/interfaces/http/auth/pat-auth.guard.ts`
  (`PatAuthGuard`), `apps/api/src/interfaces/http/runner/runner-tickets.controller.ts`
  (`runnerTicket`, o único handler marcado)
- **Teste:** `apps/api/test/interfaces/pat-auth.guard.spec.ts`,
  `apps/api/test/interfaces/jwt-auth.guard.spec.ts` (`@RequirePatAuth()`
  passa sem tentar `verify()`), `apps/api/test/interfaces/http/runner/runner-tickets.controller.spec.ts`
  (`runnerTicket` tem o decorator, `terminalTicket` não)
- **Decisão arquitetural:**
  [ADR 0105](adr/0105-personal-access-token-do-runner-escopado-por-construcao.md)

### RN-425 — Validação de PAT colapsa inexistente/revogado/expirado numa resposta só; escopo errado é 403; `last_used_at` nunca throttla {#rn-425}

`PersonalAccessTokenRepository.validarEUsar(hash)` é UMA query:
`UPDATE personal_access_tokens SET last_used_at = now() WHERE token_hash
= $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at >
now()) RETURNING id, user_id, project_id`. Zero linhas devolve `null`, e
o guard responde **401 pra "não existe", "revogado" e "expirado" com a
MESMA mensagem** — quem apresenta um token roubado ou expirado não
descobre qual dos três é o motivo (mesmo padrão de
`AccountTokenRepository.consumir()`).

Escopo de projeto incorreto é uma categoria DIFERENTE: se `project_id`
devolvido pela query não bate com `:projectId` da rota, é **403**, não
401 — o token autenticou de verdade, só não tem direito a ESTE projeto.

`last_used_at` é atualizado de forma INCONDICIONAL, na MESMA query de
validação — nunca com um throttle (ex.: "só se `last_used_at` for `NULL`
ou tiver mais de 5 minutos") no mesmo `WHERE`. Um throttle ali é um bug
real: um PAT reapresentado duas vezes em menos de 5 minutos cairia fora
do `WHERE` na segunda vez (porque `last_used_at` estaria "fresco
demais"), e a query devolveria zero linhas pra um token **válido** —
rejeitando com 401 uma reconexão legítima. O laço de retry do runner
reconecta em segundos, não minutos. O custo de não throttlar é um
`UPDATE` de uma linha por índice único a cada chamada — irrelevante no
pior caso real (até 10 tentativas seguidas, teto do runner).

- **Onde:** `apps/api/src/infrastructure/persistence/drizzle/personal-access-token.repository.ts`
  (`validarEUsar`), `apps/api/src/interfaces/http/auth/pat-auth.guard.ts`
- **Teste:** `apps/api/test/infrastructure/persistence/personal-access-token.repository.spec.ts`
  (inexistente/revogado/expirado → `null`; "toca `last_used_at` sempre
  que válido, sem throttle" — regressão do bug acima),
  `apps/api/test/interfaces/pat-auth.guard.spec.ts` (escopo errado → 403,
  não 401)
- **Decisão arquitetural:**
  [ADR 0105](adr/0105-personal-access-token-do-runner-escopado-por-construcao.md)

### RN-426 — Listar/revogar PAT é escopado ao PRÓPRIO usuário, no WHERE da query — sem admin cross-user nesta onda {#rn-426}

`ListPersonalAccessTokensUseCase`/`RevokePersonalAccessTokenUseCase`
filtram por `userId` dentro da consulta SQL (`WHERE user_id = $1 AND ...`),
nunca trazendo tudo e filtrando depois em memória. Cada usuário só
enxerga e só revoga os PRÓPRIOS tokens — inclusive dentro de um projeto
onde ele é `maintainer`.

`revogar(id, userId, motivo)` é IDEMPOTENTE: se o `UPDATE` (com o mesmo
`WHERE user_id = $1`) não acha linha porque já estava revogado, uma
segunda consulta de desempate devolve a linha (revogar de novo não é
erro); se não acha porque o token não existe OU não é do usuário
chamador, devolve `null` — a MESMA resposta (404 no controller) pros
dois casos, pra não vazar a existência de um token alheio pelo código de
status.

**Fechado pela RN-427**: um `maintainer` revogar o PAT de outro usuário —
o caso de resposta a incidente (dev desligado com token vazando) — que
esta seção declarava fora de escopo saiu do backlog e está implementado.
Esta régua (autorevogação, escopo por `userId`) não mudou em nada.

- **Onde:** `apps/api/src/application/use-cases/auth/list-personal-access-tokens.use-case.ts`
  (`ListPersonalAccessTokensUseCase`), `apps/api/src/application/use-cases/auth/revoke-personal-access-token.use-case.ts`,
  `apps/api/src/infrastructure/persistence/drizzle/personal-access-token.repository.ts`
  (`listarDoUsuarioNoProjeto`, `revogar`)
- **Teste:** `apps/api/test/application/use-cases/auth/list-personal-access-tokens.use-case.spec.ts`,
  `apps/api/test/application/use-cases/auth/revoke-personal-access-token.use-case.spec.ts`,
  `apps/api/test/infrastructure/persistence/personal-access-token.repository.spec.ts`
  (revogar token de outro usuário → `null`)
- **Decisão arquitetural:**
  [ADR 0105](adr/0105-personal-access-token-do-runner-escopado-por-construcao.md)

---

### RN-427 — `maintainer` revoga PAT de QUALQUER usuário do projeto, escopado por `project_id` — resposta a incidente {#rn-427}

Extensão do modelo da RN-426, não uma decisão de arquitetura nova: mesmo
padrão já usado para fechar a RN-407 (PO lendo métricas de produto) sobre
um modelo já decidido, sem ADR próprio. Fecha o corte que o ADR 0105
declarava "fora desta onda" — resposta a incidente real (dev desligado
com token vazando), onde esperar o próprio usuário revogar não é opção.

`ListPersonalAccessTokensAsMaintainerUseCase`/
`RevokePersonalAccessTokenAsMaintainerUseCase` são casos de uso NOVOS,
em rotas SEPARADAS (`GET .../personal-access-tokens/all`,
`DELETE .../personal-access-tokens/:tokenId/admin`, ambas
`@RequireRole('maintainer')`) — nunca um `if` dentro dos handlers de
self-service, mesmo princípio já usado no resto do produto para
autorização por nível (`OfferInfraHandoffUseCase`). A rota de
autorevogação (RN-426) não muda em nada.

`listarDoProjeto` traz TODOS os tokens do projeto — sem filtro de
`userId` — com um `innerJoin` em `users` pro e-mail do dono, mesmo padrão
que a listagem de membros do projeto já usa: sem o e-mail, um
`maintainer` vendo "revogar token de quem?" só teria um UUID cru, e o
próprio motivo do item (resposta a incidente) pede saber QUEM é o dono.

`revogarComoMaintainer(id, projectId, motivo)` é o mesmo desenho
idempotente de `revogar()` — `UPDATE` condicional seguido de `SELECT` de
desempate quando o `UPDATE` não acha linha —, mas o `WHERE` compara
`project_id`, nunca `user_id`: um `maintainer` revoga qualquer dono
DENTRO do projeto dele, nunca um token de outro projeto. Sem linha
nenhuma (token não existe OU é de outro projeto), devolve `null` — a
MESMA resposta (404) pros dois casos, mesma disciplina de não vazar
existência que a RN-426 já aplicava.

- **Onde:** `apps/api/src/application/use-cases/auth/list-personal-access-tokens-as-maintainer.use-case.ts`,
  `apps/api/src/application/use-cases/auth/revoke-personal-access-token-as-maintainer.use-case.ts`,
  `apps/api/src/infrastructure/persistence/drizzle/personal-access-token.repository.ts`
  (`listarDoProjeto`, `revogarComoMaintainer`),
  `apps/api/src/interfaces/http/runner/personal-access-tokens.controller.ts`
  (`listAllPats`, `revokePatAsMaintainer`),
  `apps/web/src/routes/ProjectSettingsTab.tsx` (`PersonalAccessTokensSection`,
  sub-lista visível só para `owner`/`maintainer`)
- **Teste:** `apps/api/test/application/use-cases/auth/list-personal-access-tokens-as-maintainer.use-case.spec.ts`,
  `apps/api/test/application/use-cases/auth/revoke-personal-access-token-as-maintainer.use-case.spec.ts`,
  `apps/api/test/infrastructure/persistence/personal-access-token.repository.spec.ts`
  (`listarDoProjeto`/`revogarComoMaintainer`),
  `apps/api/test/interfaces/http/runner/personal-access-tokens.controller.spec.ts`,
  `apps/web/src/routes/ProjectSettingsTab.test.tsx`
- **Decisão arquitetural:**
  [ADR 0105](adr/0105-personal-access-token-do-runner-escopado-por-construcao.md)
  (extensão do modelo existente, sem ADR novo)

---

### RN-428 — Carrossel de promoção de histórias sobrevive à janela de eventos {#rn-428}

`promocoesPendentes`/o carrossel de promoção do PO (RN-148) não depende mais
de scan sobre a janela dos últimos 200 eventos de `useSessionEvents`. A fonte
de conteúdo/contagem é `useBacklog` (`Story.proposedReady`, por sessão,
completa e sem janela) — numa sessão longa, `backlog.story_promotion_proposed`
sai da janela enquanto a história continua pendente de verdade, e antes disso
o carrossel encolhia (ou sumia) silenciosamente. Mesma classe de bug que a
RN-180 já corrigiu para `ContextAside`.

Quando a story não está no backlog carregado (query ainda não respondeu),
degrada story a story para o scan de janela de sempre. O ancoramento na
timeline continua vindo do evento dentro da janela quando ele existir; se o
evento que abriu a leva já saiu da janela, o carrossel ancora no TOPO do
trecho visível em vez de sumir — nunca esconder um estado real por causa de
corte de leitura.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`useMemo` `timeline`)
- **Teste:** `apps/web/src/routes/SessionPage.carrossel-janela-estourada.test.tsx`
- **ADR:** nenhum — correção de bug, mesma classe já corrigida pela RN-180
- **Origem:** achado por uso real ("o chat falhou em mostrar o carrossel do PO")

---

### RN-429 — Navegação de pasta local é relay puro pelo Runner, nunca a api enumerando o container {#rn-429}

O canal `terminal:<projectId>` ganha dois eventos, no MESMO desenho de relay
do PTY: `fs_list_dir`/`fs_home_dir` (`:web` pede, engine faz relay DIRETO
pro pid do runner registrado, erro imediato quando não há runner conectado
— nunca fica esperando uma resposta que não vem) e
`fs_list_dir_reply`/`fs_home_dir_reply` (`:runner` responde, broadcast
filtrado só pra `:web`, correlacionado por `ref` gerado pelo cliente). A api
NÃO ganha rota nova nenhuma — ela continua sem enumerar filesystem, o
argumento que a ADR 0072 já tinha fixado contra um seletor de pasta continua
de pé. `apps/runner/src/guard.ts` (que restringe `cwd` de comando já
aprovado à raiz do projeto) de propósito NÃO se aplica à navegação — listar
diretório é leitura livre pela máquina do usuário, com os privilégios que
ele já tem, e uma entrada sem permissão é pulada, não aborta a listagem
inteira.

Gap declarado: o ticket do canal é emitido POR PROJETO já existente — na
tela de criação de projeto (`NewProjectWizard.tsx`), o projeto só nasce na
confirmação, então `FolderBrowserModal` recebe `projectId: null` ali e
mostra o estado declarado em vez de tentar uma conexão impossível; o campo
de texto livre continua sendo o caminho manual, como antes.

- **Onde:** `apps/engine/lib/engine_web/channels/terminal_channel.ex`;
  `apps/runner/src/fs-browser.ts`, `apps/runner/src/channel.ts`,
  `apps/runner/src/index.ts`; `apps/web/src/lib/fs-browser-channel.ts`,
  `apps/web/src/components/FolderBrowserModal.tsx`,
  `apps/web/src/components/RunnerOnboardingPanel.tsx`,
  `apps/web/src/routes/NewProjectWizard.tsx`,
  `apps/web/src/routes/code/TerminalPanel.tsx`
- **Teste:** `terminal_channel_test.exs` (relay puro web↔runner, erro
  imediato sem runner, papel errado ignorado); `fs-browser.spec.ts`
  (ordenação, pasta vazia/inexistente/arquivo, permissão por entrada);
  `FolderBrowserModal.test.tsx` (projectId nulo, navegação, seleção, sem
  runner); `NewProjectWizard.test.tsx` (botão "Procurar pasta...")
- **ADR:** [0107](adr/0107-navegacao-de-pasta-local-via-o-runner.md), revisa
  a [0072](adr/0072-projeto-local-ou-container.md) sem editá-la
- **Origem:** pedido do dono do produto — "não consegui linkar com uma
  pasta do usuário"

---

### RN-430 — PRs são project-wide; a decisão usa o sessionId da própria ação, nunca a mais recente {#rn-430}

A aba `prs` resolve o defeito de `ProjectApprovalsTab.tsx`, que escopava a
seção "PRs em revisão" a `usePendingActions(projectId, latestSession?.id)`
— a revisão pendente de uma sessão anterior desaparecia assim que uma
sessão nova nascia. A listagem vem direto do provider (`GET
/projects/:id/code/pull-requests`, já project-wide por desenho); o
cruzamento com a `proposed_action` correspondente (ex.: `git_merge`) usa
`ProposedActionRepository.findPendingByProject(projectId, actionType?)`,
novo, ao lado do já existente escopado por sessão. A decisão
(aprovar/negar/sempre permitir) usa o `sessionId` que a própria
`ProposedAction` carrega, nunca `latestSession` — a ação pode ter nascido
numa sessão diferente da atual.

A aba PRs é a primeira produtora real de `git_merge` pela UI (`actor.kind:
'user'`); a trava de branch protegida em `decide.ts` (RN-154) segue
absoluta independente de quem propõe. `git_merge` ganhou corpo próprio no
card de aprovação em vez do despejo de JSON cru (mesmo defeito que a
RN-096 já corrigiu para outros tipos).

- **Onde:** `apps/api/src/application/ports/proposed-action-repository.port.ts`,
  `apps/api/src/infrastructure/persistence/drizzle/proposed-action.repository.ts`,
  `apps/api/src/application/use-cases/actions/list-project-pending-actions.use-case.ts`,
  `apps/api/src/interfaces/http/actions/project-actions.controller.ts`
  (`GET /projects/:projectId/actions?status=pending&actionType=`),
  `apps/web/src/routes/ProjectPrsTab.tsx`, `apps/web/src/components/ApprovalCard.tsx`
- **Teste:** `list-project-pending-actions.use-case.spec.ts` (ação pendente
  de sessão antiga encontrada project-wide; filtro por actionType; nunca
  devolve ação decidida); `propose-action.use-case.spec.ts` (git_merge com
  payload real da aba PRs segue pending mesmo com `GitMerge()` em allow, e
  com agent_autonomy curinga ligado); `ProjectPrsTab.test.tsx` (PRs de
  múltiplas sessões aparecem juntas; decisão usa o sessionId da ação, não o
  da sessão mais recente); `ApprovalCard.test.tsx` (corpo próprio de
  `git_merge`)
- **ADR:** nenhum — extensão de um caminho de leitura já existente, sem
  mudar o pipeline de decisão
- **Origem:** pedido do dono do produto — "não há maneiras de gerir PRs"

---

### RN-431 — O selo da aba Arquitetura conta pendência de validação, nunca "diagrama não gerado" {#rn-431}

`contagens.arquiteturaPendente` (régua de abas) vem de
`architecture.pendencies.length` (divergência de validação cruzada
história↔módulo), não de `c4Diagram.status === 'sem_diagrama'`. As outras
três contagens da régua (`promocoesPendentes`, `aprovacoesPendentes`,
`hipotesesPendentes`) significam todas "algo espera SUA decisão" — gerar o
diagrama é trabalho do Arquiteto, não fila de decisão do usuário, e
badigar por isso seria ruído.

- **Onde:** `apps/web/src/routes/ProjectPage.tsx`
- **Teste:** `ProjectPage.test.tsx`
- **ADR:** nenhum
- **Origem:** decisão de design tomada ao extrair a aba Arquitetura da
  Visão Geral

---

### RN-432 — Preferência de idioma vem no payload de login/refresh, nunca numa chamada extra {#rn-432}

Fundação de i18n da interface (Onda 6a de um programa maior — a extração em
massa das strings do resto do app é etapa separada, em paralelo). Coluna
`locale` em `users` (`'pt-BR' | 'en'`, default `'pt-BR'` — nunca flipa
silenciosamente quem já tem conta). `EmitirSessaoUseCase` é o ÚNICO ponto
que emite sessão (login, refresh, login social) — `locale` embutido no
corpo de `/auth/login`/`/auth/refresh` a partir dele, sem round-trip
adicional. `GET/PATCH /users/me/preferences` existe como via REDUNDANTE,
pra `AccountPage` reafirmar o valor sem esperar o próximo refresh.

`en` é o idioma DEFAULT do app a partir de agora (`react-i18next`, nova
dependência — mesma régua de "dependência nova precisa de justificativa"
que `mermaid`/`@xterm/xterm` já seguiram); `pt-BR` continua disponível.
`apps/web/src/lib/idioma.ts` (mesmo desenho de `tema.ts`): o SERVIDOR é a
fonte de verdade, `localStorage['brabo.locale']` é só cache pra evitar
flash de idioma errado no primeiro paint. Usuário sem conta ainda usa
`navigator.language` só como sugestão de EXIBIÇÃO, nunca persiste nada
antes de existir conta.

- **Onde:** `apps/api/src/application/use-cases/auth/emitir-sessao.use-case.ts`,
  `apps/api/src/interfaces/http/iam/user-preferences.controller.ts`,
  `apps/web/src/lib/idioma.ts`, `apps/web/src/lib/i18n.ts`,
  `apps/web/src/routes/AccountPage.tsx`
- **Teste:** `apps/web/src/lib/idioma.test.ts`,
  `apps/web/src/routes/AccountPage.test.tsx`,
  `apps/api/test/application/use-cases/auth/*.spec.ts`,
  `apps/api/test/interfaces/route-surface.spec.ts`
- **ADR:** nenhum — extensão aditiva de um choke point já existente, sem
  mudar o formato de sessão pra ninguém que não usa o campo novo
- **Origem:** pedido do dono do produto — interface e docs em inglês por
  padrão, com português preservado

---

## Terminal do runner local preso em "Abrindo terminal..." para sempre (RN-433)

Achado testando um projeto novo no modo `runner` (ADR 0103/0104) e abrindo
Code → Dev → Terminal: a tela nunca saía do skeleton de carregamento, e o
console mostrava `socket do terminal com erro`/`socket do terminal fechado`
em loop, com backoff crescente até estabilizar em ~5-6s — o padrão do
backoff PADRÃO do `phoenix.js`.

### RN-433 — O socket do terminal desiste depois de um timeout, o default de `ENGINE_PUBLIC_URL` é alcançável PELO BROWSER, e o endpoint não duplica path {#rn-433}

Três defeitos empilhados. Os dois primeiros foram achados investigando o
sintoma; o TERCEIRO só apareceu depois de corrigir os dois primeiros — sem
eles, o browser nunca alcançava o engine pra revelar o bug de path por
baixo. Corrigir só um deixa os outros de pé:

1. `ENGINE_PUBLIC_URL` (RN-419) nunca tinha default nenhum no
   `docker/docker-compose.yml` — só `ENGINE_URL` (`http://engine:4000`,
   hostname que SÓ resolve dentro da rede do Compose). O fallback do
   código (`process.env.ENGINE_PUBLIC_URL ?? process.env.ENGINE_URL ?? …`,
   `request-runner-ticket.use-case.ts`) caía silenciosamente no valor
   errado, e o browser tentava abrir um WebSocket contra um hostname que
   ele nunca resolve. `docker/docker-compose.yml` ganhou
   `ENGINE_PUBLIC_URL: ${ENGINE_PUBLIC_URL:-http://localhost:4000}` no
   serviço `api` — o MESMO default que `VITE_ENGINE_URL` já usa no
   serviço `web`, pelo mesmo motivo.
2. Mesmo com a URL certa, um transporte que NUNCA abre (engine fora do ar,
   firewall, reconfiguração futura errada) não tinha teto nenhum:
   `apps/web/src/lib/terminal-channel.ts` nunca passava `reconnectAfterMs`
   pro `Socket`, então o `phoenix.js` caía no backoff PADRÃO dele e ficava
   tentando reconectar sozinho pra sempre — o próprio docblock do módulo
   já declarava a intenção de "sem reconexão automática" (mesma régua de
   `session-channel.ts`/RN-108), mas nunca era cumprida na prática. Sem
   `onError`/`onClose` chamando `handlers.onErro`, `TerminalPanel` ficava
   preso em `'carregando'` (RN-088 — toda tela distingue carregando/erro/
   vazio — violada em silêncio). Corrigido com `reconnectAfterMs` devolvendo
   um valor que praticamente nunca dispara (24h, mesmo padrão de
   `session-channel.ts`) e um timeout PRÓPRIO de 8s
   (`TIMEOUT_CONEXAO_MS`): se `onOpen` não disparar antes disso, o módulo
   chama `handlers.onErro` com mensagem acionável e desconecta.
3. **O defeito que de fato impedia a conexão, mascarado pelos dois
   acima**: `terminal-channel.ts` concatenava `'/runner/websocket'` a um
   `engineWsUrl` que a api já devolve PRONTO — `ws://host:porta/runner`
   (`engineWsUrlPublico()`) —, e o PRÓPRIO `Socket` do `phoenix.js` ainda
   acrescenta `/websocket` sozinho no construtor
   (`this.endPoint = ${endPoint}/websocket`). O resultado batia no engine
   como `GET /runner/runner/websocket/websocket`, que
   `Phoenix.Router.NoRouteError` recusa — confirmado no log do engine
   (`docker logs brabo-engine-1`) durante a verificação end-to-end desta
   correção. `apps/runner/src/channel.ts` (o lado do CLI) já fazia
   certo — passa `engineWsUrl` direto pro `Socket`, sem tocar — e o teste
   de `terminal-channel.ts` nunca pegou porque o mock de
   `getTerminalTicket` usava um `engineWsUrl` (`http://engine.local`, sem
   `/runner`) que não reflete o contrato real da api; corrigido junto.
   Fix: `terminal-channel.ts` passa a usar `engineWsUrl` (só com o
   `.replace(/^http/, 'ws')` defensivo) direto, sem concatenar path
   nenhum.

Verificado END TO END contra `exp001` (modo `runner`, sem `brabo-runner`
real conectado): antes da correção, a aba girava pra sempre; depois, o
log do engine mostra `CONNECTED TO EngineWeb.RunnerSocket` →
`JOINED terminal:<projectId>` → `pty_resize descartado — sem runner
conectado`, e a tela mostra `RunnerOnboardingPanel` com o comando
`brabo-runner` em menos de 1s — nunca o timeout de 8s do item 2, que
segue como rede de segurança pro caso do engine estar genuinamente fora
do ar.

- **Onde:** `docker/docker-compose.yml`, `.env.example`,
  `apps/web/src/lib/terminal-channel.ts`
- **Teste:** `apps/web/src/lib/terminal-channel.test.ts` (socket que nunca
  abre chama `onErro` dentro do timeout, sem reconexão automática do
  phoenix; `engineWsUrl` do mock corrigido pra refletir o contrato real —
  já com `/runner`, sem `/websocket` — e a asserção do caminho feliz
  passa a exigir a URL usada no `Socket` IGUAL ao `engineWsUrl` do
  ticket, sem concatenação)
- **ADR:** nenhum — correção de bug restaurando o comportamento que o ADR
  0103/0104 e o próprio docblock do módulo já declaravam como intenção
- **Origem:** achado testando manualmente um projeto novo no modo
  `runner`; o item 3 só apareceu ao verificar a correção dos itens 1/2
  ponta a ponta no browser contra o engine real

---

### RN-434 — No Linux, `--dir` do runner local só é aceito dentro do `$HOME` do usuário {#rn-434}

O CLI `brabo-runner` (modo `runner`, ADR 0103/0104) validava só que
`--dir` existe e é uma pasta — sem restrição nenhuma de ONDE essa pasta
podia estar no sistema de arquivos. `lerArgumentos()`
(`apps/runner/src/index.ts`) passou a chamar
`validarDirDentroDoHomeNoLinux(dir, process.platform, homedir())`
(`apps/runner/src/guard.ts`) logo depois da checagem de existência: no
Linux (`process.platform === 'linux'`), `--dir` só é aceito dentro de
`os.homedir()` — o próprio `$HOME` ou qualquer subpasta dele; um caminho
fora dessa árvore (`/etc`, `/root`, `/`, ou até outra conta em `/home`)
é recusado com `process.exit(2)` e mensagem explicando o motivo e
mostrando o home esperado. Fora do Linux (macOS, Windows) o
comportamento não muda — a restrição é só para Linux.

A checagem reusa `dentroDoEscopo`/`semBarraFinal`, os mesmos primitivos
de comparação de caminho que `validarCwdDentroDaRaiz` já usa no mesmo
módulo, mas é deliberadamente mais simples que ela: sem `realpath` nem
proteção a TOCTOU/symlink, porque não protege contra um SERVIDOR
malicioso (aquele é o papel de `validarCwdDentroDaRaiz`, exercido a cada
`exec`) — é uma checagem de STARTUP do próprio CLI local, orientando o
usuário que digitou um caminho errado ao subir o runner.

- **Onde:** `apps/runner/src/guard.ts`
  (`DirForaDoHomeError`/`validarDirDentroDoHomeNoLinux`),
  `apps/runner/src/index.ts` (`lerArgumentos`)
- **Teste:** `apps/runner/src/guard.spec.ts`
  (`describe('validarDirDentroDoHomeNoLinux', …)` — aceita o próprio
  home e subpasta dele no Linux, recusa caminho fora do home e outra
  conta dentro de `/home` no Linux, e confirma que a restrição NÃO se
  aplica fora do Linux)
- **ADR:** [0104](adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
  (extensão aditiva — o runner já era declarado "fonte da verdade do
  caminho"; esta regra só estreita o que ele aceita como `--dir` no
  Linux)
- **Origem:** pedido explícito do dono do produto, durante um teste real
  de criação de projeto (tentativa de apontar `--dir` para um caminho
  fora do home, `/home/dev/exp001`, que não existia na máquina — levou
  à decisão de travar caminhos fora do `$HOME` no Linux)

---

### RN-435 — `--dir` do runner local inexistente é criado, não recusado {#rn-435}

O CLI `brabo-runner` (modo `runner`, ADR 0103/0104) recusava com
`process.exit(2)` qualquer `--dir` que ainda não existisse no disco — a
pasta do projeto tinha de ser criada manualmente antes de subir o CLI.
`garantirDiretorio()` (`apps/runner/src/guard.ts`) passou a criar a pasta
automaticamente (`mkdirSync(dir, { recursive: true })`) quando ela não
existe, e `lerArgumentos()` (`apps/runner/src/index.ts`) chama essa função
LOGO DEPOIS de `validarDirDentroDoHomeNoLinux` (RN-434) — a ORDEM é a
regra: a checagem do `$HOME` funciona em caminho que ainda não existe (só
`resolve()`, sem tocar disco), então roda primeiro e continua recusando
`--dir` fora do home no Linux mesmo quando ele ainda não existe, ANTES de
qualquer tentativa de criação — criar primeiro reabriria a brecha que a
RN-434 tinha acabado de fechar. `--dir` apontando para um ARQUIVO já
existente continua erro real (`DirNaoEUmaPastaError`, `process.exit(2)`,
sem tentar criar nada) — este CLI nunca sobrescreve um arquivo
silenciosamente. Falha na criação em si (permissão negada, disco cheio,
etc.) também recusa (`NaoConsegiuCriarDiretorioError`), com a mensagem do
erro original embutida.

- **Onde:** `apps/runner/src/guard.ts`
  (`garantirDiretorio`/`DirNaoEUmaPastaError`/`NaoConsegiuCriarDiretorioError`),
  `apps/runner/src/index.ts` (`lerArgumentos`)
- **Teste:** `apps/runner/src/guard.spec.ts`
  (`describe('garantirDiretorio', …)` — não faz nada quando a pasta já
  existe, cria recursivamente quando não existe, recusa sem criar quando o
  caminho já existe e é um arquivo, e embrulha falha de `mkdir` em
  `NaoConsegiuCriarDiretorioError`; e um caso a mais em
  `describe('validarDirDentroDoHomeNoLinux', …)` provando que um `--dir`
  fora do home e AINDA INEXISTENTE continua recusado, confirmando que a
  ordem das duas checagens não abre brecha)
- **ADR:** [0104](adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
  (extensão aditiva — não muda o desenho do runner como fonte da verdade
  do caminho, só reduz o atrito de subir um projeto novo)
- **Origem:** pedido do dono do produto, ao notar que a pasta de um
  projeto novo no modo `runner` não existia na máquina e precisava ser
  criada manualmente antes de rodar o CLI — o mesmo cenário que motivou a
  RN-434 (`/home/dev/exp001` inexistente), agora resolvido criando a
  pasta em vez de só recusar

---

### RN-453 — `--dir` relativo do runner local resolve contra `INIT_CWD`, não contra o cwd rebaseado do pnpm {#rn-453}

`resolve(dirBruto)` em `lerArgumentos()` resolvia `--dir` relativo contra
`process.cwd()` — correto quando o CLI roda direto (binário standalone,
`npm install -g @brabo/runner`), mas ERRADO no único caminho de invocação
que existe hoje sem publicação real no npm (achado real, ADR 0106/backlog):
`pnpm --filter runner start` REBASEIA `process.cwd()` para a pasta do
PACOTE (`apps/runner`), não a pasta de onde o usuário digitou o comando.
`pnpm --filter runner start -- --dir ../exp001`, rodado de `~/dev/brabo`,
criava `~/dev/brabo/apps/exp001` em vez de `~/dev/exp001` — silenciosamente,
sem erro, porque RN-435 já faz `--dir` inexistente ser criado em vez de
recusado.

`resolverDir()` (`apps/runner/src/guard.ts`) resolve contra `INIT_CWD`
quando presente — a variável que npm/pnpm SEMPRE define com a pasta
original de invocação, existente só quando o processo nasce de um script
do `package.json` — e cai em `process.cwd()` quando ausente (binário
direto, onde já é a pasta certa). `resolve()` do Node já ignora a base
quando `dirBruto` é absoluto, então caminho absoluto (o caso documentado no
README) não muda de comportamento.

- **Onde:** `apps/runner/src/guard.ts` (`resolverDir`), `apps/runner/src/index.ts` (`lerArgumentos`)
- **Teste:** `apps/runner/src/guard.spec.ts` (`describe('resolverDir', …)`
  — relativo contra `INIT_CWD` quando presente, cai no cwd do processo
  quando ausente, absoluto ignora as duas bases)
- **ADR:** [0104](adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
  (extensão aditiva, mesma categoria de RN-435 — reduz atrito de invocação,
  não muda o runner como fonte da verdade do caminho)
- **Origem:** achado em uso real, rodando `pnpm --filter runner start --
  dir ../exp001` de dentro do checkout do monorepo — o único caminho de
  invocação disponível hoje, porque `@brabo/runner` ainda não foi publicado
  de verdade no npm (`NPM_TOKEN` pendente, ver backlog do ADR 0106)

---

## O explorador de pasta do Runner vira três colunas, e a criação de um projeto `runner` deixa de esperar o passo final (RN-436/436)

Duas mudanças pedidas pelo dono do produto depois de testar a criação de um
projeto real: (1) o navegador de pasta existente
(`FolderBrowserModal`) era uma lista simples com breadcrumb, quando a
referência visual que ele mandou (um picker estilo GNOME Files/GTK, de três
colunas) já existia como handoff de design pronto pra adaptar; (2) "Procurar
pasta..." não funcionava na TELA DE CRIAÇÃO do projeto — só depois de
criado — porque o ticket do canal do Runner (ADR 0107) é ancorado a um
`projectId` que, até esta correção, só nascia na confirmação.

### RN-436 — `FolderBrowserModal` vira um explorador de três colunas: atalhos, lista com um clique seleciona/duplo clique entra, e um painel de detalhes {#rn-436}

O layout de lista única virou três colunas dentro do `Modal size="full"`:
atalhos (Pasta pessoal, que chama `diretorioInicial()`; Raiz, `/`), a lista
central com breadcrumb, e um painel de detalhes à direita. O protocolo
(`FsEntrada`, em `apps/web/src/lib/fs-browser-channel.ts`) só tem
`{ nome, isDir }` — sem tamanho nem data de modificação — e não foi
estendido (mexeria em `apps/engine`/`apps/runner`, fora do escopo desta
entrega); o painel de detalhes só mostra o que dá pra derivar client-side:
nome, tipo, e a contagem de itens quando o item exibido é a pasta JÁ ABERTA
(nunca de uma pasta só selecionada, que exigiria uma chamada extra ao
runner).

Os DOIS gestos que antes estavam fundidos num único clique (que já navegava
pra dentro da pasta) foram separados: um clique agora só SELECIONA (destaca
o item e atualiza o painel de detalhes) e um duplo clique ENTRA. O botão
final ("Usar esta pasta", renomeado de "Selecionar esta pasta" — a chave
`folderBrowserModal.select` de `pt-BR`/`en` mudou junto) usa o item
selecionado quando houver um (`selected.kind === 'dir' ? join(path,
selected.name) : path`) ou a pasta aberta no momento quando não houver
nenhum. A lista deixou de filtrar arquivos — a listagem inteira aparece
agora, com arquivos renderizados como `<div aria-disabled>` em vez de
`<button>`: visualmente apagados e sem gesto nenhum, porque só pasta
continua navegável/selecionável.

- **Onde:** `apps/web/src/components/FolderBrowserModal.tsx`,
  `FolderBrowserModal.module.css`,
  `apps/web/src/locales/{pt-BR,en}/terminal.json`
- **Teste:** `apps/web/src/components/FolderBrowserModal.test.tsx` — clique
  único seleciona sem chamar `listarDiretorio` de novo; duplo clique navega;
  arquivo aparece na lista mas não é alcançável por `getByRole('button')`;
  atalhos "Pasta pessoal"/"Raiz"; e "Usar esta pasta" usa o selecionado
  quando houver, senão a pasta aberta
- **ADR:** nenhum — redesenho de UI sobre um componente que já existia, sem
  mudança de protocolo nem de fronteira de dado (o ADR 0107 continua
  descrevendo o mecanismo por trás)
- **Origem:** pedido do dono do produto, depois de testar a criação de um
  projeto real e achar o navegador de pasta pouco parecido com um
  explorador de arquivos de verdade — referência visual enviada por ele
  (picker de três colunas, estilo GNOME Files/GTK)

### RN-437 — No modo `runner`, "Procurar pasta..." cria o projeto ANTECIPADAMENTE, e a confirmação final reusa por SNAPSHOT de identidade {#rn-437}

O ADR 0107 já tinha declarado esta lacuna na própria seção de Consequências:
sem projeto ainda, o ticket do canal (RN-429) não tem a quem se ancorar, e
"Procurar pasta..." caía sempre no estado "disponível depois que o projeto
existir" — mesmo no modo `runner`, onde a criação NÃO depende de validar
disco (ADR 0104, item 2). Fechado pelo [ADR 0108](adr/0108-projeto-runner-nasce-ao-navegar-pasta-no-wizard.md):
`NewProjectWizard.tsx` (`handleProcurarPasta`) chama `createProject` ao
clicar "Procurar pasta..." quando `modoDeWorkspace === 'runner'` — usando o
caminho já digitado, ou um placeholder lexicalmente válido e claramente
provisório (`/workspace-a-confirmar`) quando o campo ainda está vazio, nunca
bloqueando o clique. O modo `mounted` **não muda**: continua com
`projectId={null}` até a confirmação, porque ali a validação de disco roda
na criação e criar cedo com caminho vazio devolveria a recusa da RN-422 num
momento em que o usuário nem pensou em caminho ainda.

Um SNAPSHOT de identidade (`{ name, externalId, adotando }` — nunca
`caminhoLocal`, cujo refino é o PROPÓSITO de navegar) decide quando reusar:
clicar "Procurar pasta..." de novo com a identidade intacta reabre o modal
com o MESMO projeto, sem criar outro; mudar o nome (ou voltar e trocar o
repositório a adotar) invalida o snapshot, e a próxima navegada cria um
projeto novo. `handleConfirm` aplica a mesma régua — reusa o projeto
já criado ao navegar quando o snapshot ainda bate, e só chama `createProject`
quando não há nada pra reusar. `montarPayloadDeCriacao`, função pura extraída
do que antes vivia só dentro de `handleConfirm`, é reaproveitada pelos dois
caminhos.

- **Onde:** `apps/web/src/routes/NewProjectWizard.tsx`
  (`handleProcurarPasta`, `handleConfirm`, `montarPayloadDeCriacao`,
  `snapshotDeIdentidade`/`mesmaIdentidade`)
- **Teste:** `apps/web/src/routes/NewProjectWizard.test.tsx`, describe
  `navegação de pasta antecipada no modo Runner` — cria o projeto e abre o
  modal com o id real; usa o placeholder quando o campo está vazio; clicar
  de novo sem mudar nada não cria outro; mudar o nome invalida o snapshot e
  cria um projeto diferente; `handleConfirm` reusa em vez de duplicar. O
  teste preexistente "'Procurar pasta...' mostra o estado declarado" (modo
  `mounted`) continua verde, sem alteração — prova que o escopo não vazou
- **ADR:** [0108](adr/0108-projeto-runner-nasce-ao-navegar-pasta-no-wizard.md)
  — mudança estrutural (QUANDO um projeto passa a existir no fluxo de
  criação), com o efeito colateral aceito de projeto "não provisionado"
  órfão quando o wizard é fechado sem terminar (o MESMO estado que qualquer
  criação interrompida hoje já produz, não uma regressão nova)
- **Origem:** pedido do dono do produto, depois de testar a criação de um
  projeto real no modo Runner e não conseguir navegar pastas antes de
  confirmar — a lacuna que o ADR 0107 já tinha declarado e adiado

### RN-438 — `fs-browser-channel.ts` tinha o MESMO bug de path duplicado que a RN-433 já tinha corrigido no `terminal-channel.ts` irmão {#rn-438}

Achado ao verificar a RN-437 ponta a ponta no Chrome, contra o engine real:
o modal abria com o `projectId` certo, mas a conexão caía na hora com "A
conexão com o runner caiu — feche e reabra para tentar de novo." em vez de
mostrar `RunnerOnboardingPanel`. `apps/web/src/lib/fs-browser-channel.ts`
concatenava `'/runner/websocket'` a um `engineWsUrl` que a api já devolve
PRONTO (`ws://host:porta/runner`, de `engineWsUrlPublico()`) — o mesmo
`Socket` do `phoenix.js` ainda acrescenta `/websocket` sozinho no
construtor, e o resultado batia no engine como `GET
/runner/runner/websocket/websocket`, que `Phoenix.Router.NoRouteError`
recusa. É EXATAMENTE o item 3 da RN-433, só que no módulo IRMÃO — a
correção de lá nunca tinha sido replicada aqui, e nenhuma suite pegava
porque este módulo não tinha teste nenhum até agora (o próprio docblock
dizia, incorretamente, que `terminal-channel.test.ts` cobria "indiretamente").
Fix: mesma linha da RN-433 — `engineWsUrl.replace(/^http/, 'ws')`, sem
concatenar path nenhum.

Verificado END TO END contra um projeto `runner` real (owner logado,
`teste-navegacao`, criado pela RN-437): antes da correção, o modal caía
direto no erro de conexão; depois, mostra `RunnerOnboardingPanel` com o
comando `brabo-runner --project <id-real> --dir <pasta>` em menos de 2s —
o resultado esperado sem um runner de verdade conectado.

- **Onde:** `apps/web/src/lib/fs-browser-channel.ts`
- **Teste:** `apps/web/src/lib/fs-browser-channel.test.ts` (novo — o
  módulo não tinha teste próprio nenhum até esta correção). Caminho feliz
  confirma `socket.url === engineWsUrl` sem concatenação; mais
  `diretorioInicial`/`listarDiretorio` roundtrip, falha ao buscar ticket, e
  `fechar()` idempotente
- **ADR:** nenhum — restaura o comportamento que o ADR 0103/0107 e a RN-433
  já declaravam como intenção, só que num módulo que a correção anterior não
  alcançou
- **Origem:** achado testando manualmente a RN-437 (criação antecipada de
  projeto `runner`) contra o Chrome e o engine real — a primeira vez que
  `FolderBrowserModal` foi exercitado ponta a ponta contra uma conexão de
  verdade, porque antes desta entrega "Procurar pasta..." nunca alcançava
  um projeto real antes da confirmação

### RN-439 — `POST .../runner-ticket` autentica E autoriza no MESMO guard; `RolesGuard` (global) se abstém em rota `@RequirePatAuth()` {#rn-439}

`POST /projects/:projectId/runner-ticket` respondia `403 "Não autenticado"`
para TODO PAT, mesmo válido, recém-emitido, escopado ao projeto certo —
achado numa verificação AO VIVO do `brabo-runner` conectando a um projeto
real, nunca por teste automatizado. Causa raiz: `JwtAuthGuard` e
`RolesGuard` são os dois `APP_GUARD` — GLOBAIS — e um guard global SEMPRE
roda ANTES de um guard LOCAL de rota (`@UseGuards`), não importa a ordem dos
decorators no controller. `JwtAuthGuard` já sabia se abster nesta rota (o
desvio de `IS_PAT_ROUTE_KEY` já existia, sem popular `request.user`,
contando com `PatAuthGuard` pra autenticar depois); `RolesGuard` não sabia,
e recusava toda chamada com `request.user` ainda vazio — `PatAuthGuard`
nunca chegava a rodar. O comentário do controller descrevia a ordem ao
contrário ("`RolesGuard` roda DEPOIS do `PatAuthGuard`"), e nunca foi assim.

A correção seguiu o MESMO padrão que `JwtAuthGuard` já usava para este
problema: `RolesGuard` ganhou o desvio gêmeo (`IS_PAT_ROUTE_KEY` →
retorna `true` sem checar `request.user`), delegando a autorização inteira
para quem passa a ser o ÚNICO guard rodando depois de `request.user`
populado nesta rota — o próprio `PatAuthGuard`, que agora também lê
`@RequireRole` (via `Reflector`) e resolve o papel efetivo
(`ResolveEffectiveRoleUseCase.forProject`), recusando com a MESMA mensagem
que `RolesGuard` usaria ("Papel insuficiente para esta ação"). A lógica é
duplicada entre os dois guards de PROPÓSITO — `RolesGuard` mora em `iam`,
`PatAuthGuard` mora em `auth`, e uma dependência cruzada só para reusar
~10 linhas não valeria a pena.

Um SEGUNDO defeito ficou escondido atrás do primeiro, e só apareceu quando
o teste de integração passou a exercitar os dois guards JUNTOS: `PatAuthGuard`
comparava o token BRUTO direto contra `personal_access_tokens.token_hash`
em `validarEUsar` — que sempre espera o HASH (`hashDeToken`, HMAC-SHA256+
pepper, o mesmo que `TokenFactory`/`IssuePersonalAccessTokenUseCase` usam
para gravar). Corrigido para `this.tokens.validarEUsar(hashDeToken(token))`.
Enquanto `RolesGuard` recusava tudo antes, este segundo bug nunca chegava a
se manifestar — corrigir só o primeiro teria trocado um 403 sempre por um
401 sempre, e o runner continuaria nunca conectando de verdade.

- **Onde:** `apps/api/src/interfaces/http/iam/roles.guard.ts` (desvio
  `IS_PAT_ROUTE_KEY`); `apps/api/src/interfaces/http/auth/pat-auth.guard.ts`
  (autorização por papel + hash do token); `apps/api/src/interfaces/http/runner/runner-http.module.ts`
  (`IamUseCasesModule` importado, pelo `ResolveEffectiveRoleUseCase` que
  `PatAuthGuard` passou a precisar); comentário corrigido em
  `apps/api/src/interfaces/http/runner/runner-tickets.controller.ts`
- **Teste:** `apps/api/test/interfaces/pat-auth.guard.spec.ts` (autorização
  por papel isolada + hash do token); `apps/api/test/interfaces/roles.guard.spec.ts`
  (desvio `IS_PAT_ROUTE_KEY`); `apps/api/test/interfaces/http/runner/runner-tickets.guards.integration.spec.ts`
  (NOVO — sobe `JwtAuthGuard`+`RolesGuard`+`PatAuthGuard` num Nest real, com
  `supertest`, na MESMA ordem relativa do `AppModule`: é o teste que
  faltava, porque cada guard só era exercitado isolado antes disto).
  Verificado também AO VIVO: `brabo-runner` conectou de verdade a um
  projeto `runner` real com um PAT emitido depois da correção
- **ADR:** [0105](adr/0105-personal-access-token-do-runner-escopado-por-construcao.md)
  — correção de bug na implementação da decisão já tomada lá (PAT
  autentica esta rota), não uma decisão nova
- **Origem:** achado rodando o `brabo-runner` de verdade contra um projeto
  real e isolando com `curl` direto — nunca por teste automatizado, porque
  nenhuma suíte exercitava `RolesGuard` e `PatAuthGuard` na mesma
  requisição

### RN-443 — Budget de área é ADITIVO ao de projeto/sessão, nunca cascata; só `maintainer` muda o teto {#rn-443}

Fecha o item "budget por área" do corte do ADR 0038, em aberto desde a
FASE 8. `agent_areas` ganha `budget_micros` (nullable — `null` é SEM
TETO, o default) e `spent_micros` (`NOT NULL DEFAULT 0`), espelhando
exatamente `max_parallel`: mesma linha, mesmo dono da decisão, mesmo
`AgentAreaRepository`. **Não é** a cascata de binding de modelo do ADR
0064 (`sessão > agente > área > projeto > workspace`, "o mais específico
vence") — os dois mecanismos usam a palavra "área" e não têm mais nada em
comum. Budget de área é um TERCEIRO teto independente ao lado dos de
projeto e sessão que já existiam: `CheckBudgetGateUseCase.execute` agora
resolve a área do `agentId` (via `areaDo`, função pura, sem tocar banco a
menos que ache correspondência) e checa os três em paralelo — qualquer um
bloqueado já recusa a chamada, sem hierarquia entre eles.

`RecordLlmUsageUseCase` incrementa `spent_micros` da área do ator SEMPRE
que ele pertence a uma (lead ou membro — `areaDo` devolve área pros dois),
com ou sem `budget_micros` configurado: o gasto real da área fica visível
antes mesmo de alguém configurar um teto. Ator sem área (usuário no chat,
agente fora de qualquer área) não grava nada — não é omissão silenciosa,
é o comportamento correto quando não há o que incrementar.

`SetAreaBudgetUseCase` exige `maintainer` (mesma régua de
`SetAreaMaxParallelUseCase` — mudar quanto o produto pode gastar sem
perguntar), converte dólar→micro-USD no controller (mesma convenção de
`BudgetsController`) e não emite evento de domínio (config de projeto, sem
sessão pra gravar — mesmo raciocínio já registrado em
`SetAreaMaxParallelUseCase`). `null` LIMPA o teto — campo obrigatório que
aceita `null` como valor válido (`ValidateIf`, não `IsOptional`), mesmo
padrão de `RenameSessionDto`.

- **Onde:** `apps/api/src/db/schema.ts` (`agentAreas`, colunas
  `budgetMicros`/`spentMicros` e os dois CHECK); `apps/api/src/domain/llm/area-budget.ts`
  (`isAreaBudgetExceeded`); `apps/api/src/application/use-cases/llm/check-budget-gate.use-case.ts`;
  `apps/api/src/application/use-cases/llm/record-llm-usage.use-case.ts`;
  `apps/api/src/application/use-cases/execution/set-area-budget.use-case.ts`;
  `apps/api/src/infrastructure/persistence/drizzle/agent-area.repository.ts`
  (`setBudget`/`incrementSpent`); `apps/api/src/interfaces/http/execution/execution.controller.ts`
  (`PUT agent-areas/:key/budget`); `apps/web/src/routes/ProjectSettingsTab.tsx`
  (`BudgetSection`)
- **Teste:** `apps/api/test/application/use-cases/llm/check-budget-gate.use-case.spec.ts`
  (describe `budget de área — aditivo, não cascata`: área excedida bloqueia
  com projeto/sessão OK e vice-versa, sem teto nunca bloqueia, agente sem
  área não é afetado); `apps/api/test/application/use-cases/llm/record-llm-usage.use-case.spec.ts`
  (describe `gasto por área`: incrementa pro membro e pro lead, não faz
  nada nocivo sem área, soma sem teto configurado);
  `apps/api/test/application/use-cases/execution/set-area-budget.use-case.spec.ts`
  (grava, limpa com `null`, recusa negativo/NaN/Infinity, zero é válido);
  `apps/api/test/infrastructure/persistence/drizzle/agent-area.repository.spec.ts`
  (`setBudget`/`incrementSpent`, atomicidade sob concorrência)
- **ADR:** [0110](adr/0110-budget-por-area-aditivo-nao-cascata.md)
- **Origem:** item de backlog aprovado pelo dono do produto numa sessão de
  planejamento explícita — `docs/explanation/backlog.md`, tabela "Older
  backlog"

---

### RN-440 — `addressableAgents()` é o catálogo FECHADO do handoff manual, mais estrito que `assertHandoffTargetAllowed` {#rn-440}

Handoff manual a agente à escolha (backlog, ADR 0109): `assertHandoffTargetAllowed`
(ADR 0038) só recusa um SUBAGENTE de área — um agente citando "abc" como
alvo passaria por ela sem erro, porque uma AGENTE só cita alvos que ele já
conhece pela própria instrução. Isso deixa de ser verdade quando quem
escolhe é um HUMANO, num `<select>` alimentado por um cliente que pode
divergir do backend. `addressableAgents()` (`apps/api/src/domain/agents/agent-areas.ts`)
é o catálogo FECHADO — leads de área (`AGENT_AREAS.map(a => a.lead)`) ∪
`SOLO_CONVERSATIONAL_AGENTS` (`criativo`, `po`, `arquiteto`, `ux-designer`,
`staff`) — e `RequestManualHandoffUseCase` recusa com 400 qualquer
`toAgent` fora dele, ANTES de chamar `CreateHandoffUseCase`.

`SOLO_CONVERSATIONAL_AGENTS` é uma lista PRÓPRIA, não derivada do roster
`apps/web/src/lib/agents.ts` (que também lista agentes de gate e o
Psicólogo/Anamnese, nenhum endereçável por handoff) nem do gerador
`gerar:areas` (Fase 18, que só cobre `AGENT_AREAS`). O mirror manual do
lado web (`apps/web/src/lib/agents.ts`, mesma constante) não é cruzado por
teste automático com o do lado api — divergir produz, no pior caso, uma
opção velha no seletor que o backend ainda recusa com 400, nunca uma
escrita indevida.

- **Onde:** `apps/api/src/domain/agents/agent-areas.ts` (`addressableAgents`,
  `SOLO_CONVERSATIONAL_AGENTS`); `apps/api/src/application/use-cases/agents/request-manual-handoff.use-case.ts`;
  `apps/web/src/lib/agents.ts` (mirror manual)
- **Teste:** `apps/api/test/domain/agents/agent-areas.spec.ts`
  (`describe('addressableAgents (ADR 0109)')`); `apps/api/test/application/use-cases/agents/request-manual-handoff.use-case.spec.ts`
  (recusa subagente E recusa agente desconhecido); `apps/web/src/lib/agents.test.ts`
- **ADR:** [0109](adr/0109-handoff-manual-a-agente-a-escolha.md)
- **Origem:** backlog do modelo de time — item aberto desde a FASE 13c,
  fechado pelo caso real do Staff (ADR 0088) e do UX Designer (ADR 0087),
  os dois com plumbing de engine pronto e nenhum caminho humano até eles

---

### RN-441 — `POST .../sessions/:sessionId/handoffs` exige `developer`; handoff manual nasce `offered`, sem estado novo {#rn-441}

O único caminho para gravar `toAgent` continua sendo `CreateHandoffUseCase`
(ADR 0038) — não um segundo mecanismo. `RequestManualHandoffUseCase`
resolve `fromAgent` sozinho (o `agent.activated` mais RECENTE da sessão,
via `SessionEventRepository.listByTypeInSession` — mesmo critério de
`activeAgent` em `SessionPage.tsx`, achado 9-fix; sessão sem nenhum agente
ativado ainda cai no sentinela `"usuario"`, nunca um nome adivinhado) e
chama `CreateHandoffUseCase.execute` passando `actor: {kind: 'user', id:
userId}` — `CreateHandoffInput` ganhou o campo opcional `actor?: Actor`
para isso, com default `{kind:'agent', id: fromAgent}` preservando o
comportamento de sempre para o chamador interno (o engine). O handoff
nasce `offered`, do MESMO jeito que um automático, e o card de aceite
já existente (`offeredHandoff`/`handleAcceptHandoff` em `SessionPage.tsx`)
o pega sozinho no próximo poll de `useHandoffs` — sem NENHUMA mudança no
caminho de aceite.

A rota (`POST projects/:projectId/sessions/:sessionId/handoffs`) exige
papel `developer`, o mesmo de `handoffs/:handoffId/accept` (RN-136: quem
CONVERSA nesta tela). `ux-designer` e `staff` entraram em `AGENTES_DE_CHAT`
(`SessionPage.tsx`) na mesma mudança — as duas cláusulas de `message/2` já
existiam em `agent_command_controller.ex` (ADR 0087/0088), verificado por
leitura ANTES de escrever qualquer linha de web, e nenhuma delas tinha
caminho humano até si.

- **Onde:** `apps/api/src/interfaces/http/agents/agents.controller.ts`
  (`requestManual`); `apps/api/src/interfaces/http/agents/dto/request-manual-handoff.dto.ts`;
  `apps/api/src/application/use-cases/agents/create-handoff.use-case.ts`
  (`actor?: Actor`); `apps/web/src/routes/SessionPage.tsx`
  (`AGENTES_DE_CHAT`, `.manualHandoffRow`, `handleRequestManualHandoff`);
  `apps/web/src/lib/api-client.ts` (`requestManualHandoff`)
- **Teste:** `apps/api/test/interfaces/http/agents/agents.controller.spec.ts`
  (papel exigido); `apps/api/test/application/use-cases/agents/request-manual-handoff.use-case.spec.ts`
  (`fromAgent` derivado, sentinela `"usuario"`, `actor: user`);
  `docs/security-surface.md` + `apps/api/test/interfaces/route-surface.spec.ts`
  (classificação `role:developer` em runtime)
- **ADR:** [0109](adr/0109-handoff-manual-a-agente-a-escolha.md)
- **Origem:** backlog do modelo de time (ver RN-440)

---

### RN-447 — Converter `execution_mode` de projeto EXISTENTE recusa (409) enquanto qualquer dev agent do projeto não está `idle` {#rn-447}

`ConvertProjectExecutionModeUseCase` (`PUT .../execution-mode`, papel
`maintainer`) lê `engine.dev_agent_states` DIRETO (cross-schema, mesmo
banco físico — mesmo caminho da RN-409) por `project_id`, em TODAS as
sessões do projeto, não só a mais recente. Qualquer status diferente de
`idle` (`working`/`blocked`/`idle_tripped`/`awaiting_gate`/
`awaiting_approval`) recusa a conversão: `Engine.Dev.DevAgentServer` NÃO
re-resolve o worktree sozinho — `workspace_root` é capturado UMA vez, na
criação do worktree, e trocar a coluna por baixo dele deixaria o agente
escrevendo num escopo que o `permissions.json` e a política de terminal
(ADR 0055) já abandonaram. A decisão é RECUSAR e explicar (mesmo padrão
"recusa e ensina" da RN-088/RN-422) — nunca drenar ou forçar a migração de
um agente vivo.

`idle_tripped` conta como ATIVO aqui, diferente da RN-409 (que o exclui de
`onlineAgentCount`): as duas perguntas são diferentes — "alguém está
olhando este agente trabalhar agora" (RN-409) contra "existe um ponteiro
de escopo que ficaria obsoleto" (aqui). Um agente com o circuit breaker
disparado ainda tem `workspace_root` capturado, esperando desbloqueio
humano — não é "ocioso" para efeito de conversão, mesmo não sendo
"online" para efeito de contagem.

Mesmo (modo, caminho) de hoje é NO-OP: a checagem de dev agent nem roda —
reenviar o formulário sem mudar nada não deveria custar uma varredura de
agentes ativos.

- **Onde:** `apps/api/src/application/use-cases/iam/convert-project-execution-mode.use-case.ts`;
  `apps/api/src/application/ports/dev-agent-activity.port.ts`;
  `apps/api/src/infrastructure/persistence/drizzle/dev-agent-activity.repository.ts`
- **Teste:** `apps/api/test/application/use-cases/iam/convert-project-execution-mode.use-case.spec.ts`
  (recusa com dev agent ativo, sem gravar nada; no-op não checa);
  `apps/api/test/infrastructure/persistence/drizzle/dev-agent-activity.repository.spec.ts`
  (`idle` não conta, todo o resto conta, isolamento entre projetos)
- **ADR:** [0111](adr/0111-conversao-de-execution-mode-de-projeto-existente.md)
- **Origem:** correção registrada em `docs/explanation/backlog.md` durante
  a implementação da Onda 1 do runner (ADR 0104), fechada nesta Onda 2

---

### RN-448 — `permissions.json` é RELOCALIZADO na conversão — o conteúdo nunca muda, só o caminho {#rn-448}

`PermissionsFileStore.move(from, to)` lê o arquivo na localização ANTIGA
(`projectScopeRoot(localAntiga)`), grava o MESMO conteúdo na localização
NOVA e apaga o antigo (best-effort — se já não existir, não há o que
apagar). O conteúdo (padrões `allow`/`deny`/`ask`) não carrega caminho nem
modo dentro de si, então não há nada para REESCREVER, só para mover.
`from === to` (nenhuma raiz efetiva mudou) é no-op.

Confirmado por leitura de `projectScopeRoot` (`project-workspaces-root.ts`):
para `mounted`/`runner` a raiz É o `workspacePath`, tratado como caminho
DENTRO DO CONTAINER DA API — em `runner`, isso já era verdade ANTES desta
entrega (sem bind-mount, o arquivo mora numa pasta que só coincide em
STRING com a pasta real do usuário, desconectada dela). A conversão não
muda essa propriedade existente, só a relocaliza de forma consistente —
sem caso especial para `runner` além de usar `move()` como qualquer outro
par.

- **Onde:** `apps/api/src/application/ports/permissions-file-store.port.ts`
  (`move`); `apps/api/src/infrastructure/filesystem/fs-permissions-file-store.ts`
- **Teste:** `apps/api/test/infrastructure/filesystem/fs-permissions-file-store.spec.ts`
  (conteúdo sobrevive e é apagado da origem; origem sem arquivo grava vazio
  sem lançar; `from === to` é no-op)
- **ADR:** [0111](adr/0111-conversao-de-execution-mode-de-projeto-existente.md)

---

### RN-449 — Saindo de `container`, o ciclo de vida do container é encerrado (`removed`) ANTES da coluna mudar {#rn-449}

`ConvertProjectExecutionModeUseCase` chama
`RegistrarTransicaoDeContainerUseCase` (ADR 0081) para levar a linha de
`project_containers` a `removed` — via `stopped` primeiro quando está
`running` (`container-lifecycle.ts` não tem aresta direta
`running -> removed`) — ANTES de gravar o novo `execution_mode`. A ordem é
obrigatória: `RegistrarTransicaoDeContainerUseCase` recusa (400) qualquer
transição num projeto que não esteja em `execution_mode = 'container'`
NO MOMENTO da chamada, então chamá-lo depois de trocar a coluna sempre
falharia. Sem linha de container (projeto que nunca provisionou), nenhuma
transição é disparada.

Entrar em `container` a partir de `mounted`/`runner` NÃO auto-provisiona
nada — o portão da imagem do Arquiteto (RN-105) e o ciclo de vida normal
valem a partir daí, como para qualquer projeto `container` — nunca um
atalho que pula o portão porque o projeto "já tinha código em algum
lugar".

- **Onde:** `apps/api/src/application/use-cases/iam/convert-project-execution-mode.use-case.ts`
  (`removerContainerSeExistir`)
- **Teste:** `apps/api/test/application/use-cases/iam/convert-project-execution-mode.use-case.spec.ts`
  (`running` passa por `stopped`; `provisioning` vai direto; sem linha,
  nenhuma transição; entrar em `container` nunca dispara transição)
- **ADR:** [0111](adr/0111-conversao-de-execution-mode-de-projeto-existente.md)

---

### RN-450 — `workspaceVerifiedAt` zera em TODA conversão real, mesmo voltando para `runner` com o "mesmo" caminho {#rn-450}

Só faz sentido em `execution_mode: 'runner'` (RN-423): um timestamp
provando que um runner CONECTADO confirmou o caminho no host real.
Qualquer conversão que muda de fato o par (modo, caminho) — incluindo uma
que pousa de novo em `runner` com um caminho de aparência igual — zera o
campo, forçando confirmação NOVA: o timestamp antigo atesta uma
verificação que aconteceu sob um par DIFERENTE, e carregá-lo adiante
afirmaria uma confirmação que nunca aconteceu para o estado novo. O
no-op (RN-447) é a única exceção — nada muda, então nada zera.

- **Onde:** `apps/api/src/application/use-cases/iam/convert-project-execution-mode.use-case.ts`
- **Teste:** `apps/api/test/application/use-cases/iam/convert-project-execution-mode.use-case.spec.ts`
  (`runner -> container` zera; no-op preserva)
- **ADR:** [0111](adr/0111-conversao-de-execution-mode-de-projeto-existente.md)

---

### RN-451 — Smoke do binário standalone roda o SUBPROCESSO real, nunca mock {#rn-451}

O mesmo padrão de disciplina que `smoke-dist.mjs` (ADR 0106) já aplica ao
`dist/index.cjs` publicado no npm passa a valer também para
`dist-bin/brabo-runner-<platform>-<arch>[.exe]` (ADR 0112): nenhuma suíte
prova que um artefato EMPACOTADO funciona lendo o código-fonte dele — só
executando o artefato de verdade, como subprocesso, e observando saída
real. `scripts/smoke-bin.mjs` roda o binário COMPILADO (nunca
`node src/index.ts` nem qualquer forma não-compilada) com `--self-test-pty`
— uma flag interna, não documentada em `uso()` — que resolve `node-pty`
exatamente como produção e spawna um PTY real via `GerenciadorDePty`,
escrevendo e lendo dele. Só a linha `node-pty carregado com sucesso` +
`SELF_TEST_PTY_OK:` no stdout do processo real conta como prova; nenhum
mock de `node-pty` nem de `child_process` é aceitável para este teste
específico, porque o que ele existe para provar é justamente que o `.node`
nativo embutido (`with { type: 'file' }`, `native-pty-embed.generated.ts`)
carrega e funciona DENTRO do binário — mockar qualquer peça do caminho
apagaria a única coisa que o teste precisa provar.

- **Onde:** `apps/runner/scripts/smoke-bin.mjs`; `apps/runner/src/index.ts`
  (`rodarAutoTestePty`, a implementação de `--self-test-pty`)
- **Teste:** o próprio `smoke-bin.mjs` — não há teste unitário que o
  substitua, de propósito (é o mesmo desenho de `smoke-dist.mjs`, que
  também não tem par unitário)
- **ADR:** [0112](adr/0112-binario-standalone-do-runner-via-bun-build-compile.md)
- **Origem:** requisito explícito do dono do produto para este item de
  backlog ("no mocking")

---

### RN-452 — `node-pty` resolvido por injeção, não import estático — e a lacuna que isso abriu no smoke do npm foi fechada no mesmo commit {#rn-452}

`pty.ts` deixou de fazer `import * as nodePty from 'node-pty'` estático no
topo do módulo — passou a receber o módulo já resolvido por injeção no
construtor de `GerenciadorDePty`, resolvido uma vez em `main()`
(`src/index.ts`) via `native-pty-loader.ts#carregarNodePty()`. A mudança
existe para o binário standalone (ADR 0112): o caminho compilado precisa
extrair os arquivos embutidos pra um diretório real ANTES de resolver
`node-pty`, o que exige uma chamada assíncrona — incompatível com um
`import` estático hoisted. Fora do binário compilado, o comportamento é
idêntico a antes (`await import('node-pty')`, resolvido do `node_modules`
de quem instalou o pacote).

**A lacuna que a mudança abriu, fechada no MESMO commit**: a ADR 0106 já
registrava que o `import` estático de `node-pty`, por ser hoisted antes de
qualquer parsing de argumento, fazia `smoke-dist.mjs` provar que o binding
nativo carregava só por IMPORTAR `dist/index.cjs` — mesmo no caminho de
`uso()` (zero argumentos), que nunca chega a `main()`. Mover a resolução
pra dentro de `main()` quebrou essa garantia em silêncio, porque
`smoke-dist.mjs` só exercitava o caminho de `uso()`. `smoke-dist.mjs`
ganhou uma terceira checagem — roda o CLI com argumentos válidos (mas sem
api/engine reais do outro lado) e espera a linha `node-pty carregado com
sucesso` no stdout antes de matar o processo — fechando a lacuna que a
própria mudança abriu, em vez de deixá-la como perda de cobertura
silenciosa.

- **Onde:** `apps/runner/src/pty.ts` (`GerenciadorDePty`, injeção de
  `NodePtyModule`); `apps/runner/src/native-pty-loader.ts`
  (`carregarNodePty`); `apps/runner/src/index.ts` (`main`, resolve uma vez);
  `apps/runner/scripts/smoke-dist.mjs` (terceira checagem,
  `verificarNodePtyCarrega`)
- **Teste:** `apps/runner/scripts/smoke-dist.mjs` (caminho npm/tsup) e
  `apps/runner/scripts/smoke-bin.mjs` (caminho binário, RN-451) — os dois
  únicos lugares que exercitam o artefato empacotado de verdade, nenhum
  teste unitário substitui
- **ADR:** [0112](adr/0112-binario-standalone-do-runner-via-bun-build-compile.md)
- **Origem:** necessidade técnica do binário standalone; a lacuna no smoke
  do npm foi achada por auditoria própria da mudança, não por execução real
  reportando falha

### RN-454 — A aba Insights sabe que o Psicólogo está pausado ANTES de o usuário esbarrar no 503 {#rn-454}

Achado por USO: a aba Insights, com zero hipóteses, mostrava "Sem hipóteses
ainda — o Psicólogo analisa cada sessão encerrada" mesmo com
`PSYCHOLOGIST_ENABLED=false` — a mesma frase que aparece quando o Psicólogo
está ATIVO e só ainda não rodou. As duas situações são indistinguíveis pelo
texto, o que é a mesma classe de defeito que a RN-088/RN-107 já fecharam
para outras telas: um estado que existe e o produto sabe, mas não mostra.

A [RN-117](#rn-117) já cobria a descoberta da pausa, mas só no CLIQUE de
"Reanalisar" (503 → `PsychologistDisabledError`) — e esse botão só existe
na faixa de análises, que só aparece quando `runs.length > 0`. Uma sessão
sem hipótese nenhuma nunca chega perto dele, então a pausa era invisível
justamente na tela vazia.

`GET /internal/psychologist/status` (engine, `PsychologistCommandController.status/2`)
é leitura pura de `PsychologistWorker.enabled?/0` — SEM efeito colateral,
diferente de `/reanalyze`, que cria um job quando ativado. A api expõe
`GET /projects/:projectId/psychologist/status` (`GetPsychologistStatusUseCase`,
`role:viewer`) por cima disso — projeto na URL só por consistência com as
rotas irmãs (`hypotheses`, `psychologist/analyses`); a flag em si é GLOBAL,
como a RN-117 já registra. `ProjectInsightsTab.tsx` consome essa leitura
(`usePsychologistStatus`) e escolhe a frase do estado vazio por ela: pausado
mostra "O Psicólogo está pausado — nenhuma sessão é analisada até ser
reativado" (`insights.projectInsightsTab.emptyPaused`); do contrário, mantém
a frase original, que É honesta quando a feature está de fato ativa. O
aviso persistente (`pausedNotice`) e os botões de "Reanalisar" também
passaram a refletir essa leitura proativa, e não só o `useState` descoberto
pelo 503 — que continua existindo, como reforço, para o caso raro de a
flag mudar EM VOO entre a leitura de status e o clique.

- **Onde:** `apps/engine/lib/engine_web/controllers/psychologist_command_controller.ex`
  (`status/2`), `apps/engine/lib/engine_web/router.ex`
  (`GET /internal/psychologist/status`),
  `apps/api/src/application/ports/api-to-engine-client.port.ts`
  (`getPsychologistStatus`),
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`,
  `apps/api/src/application/use-cases/execution/get-psychologist-status.use-case.ts`,
  `apps/api/src/interfaces/http/psychologist/psychologist.controller.ts`
  (`status`), `apps/web/src/lib/api-client.ts` (`getPsychologistStatus`),
  `apps/web/src/lib/hooks.ts` (`usePsychologistStatus`),
  `apps/web/src/routes/ProjectInsightsTab.tsx`
- **Teste:**
  `apps/engine/test/engine_web/controllers/psychologist_command_controller_test.exs`
  (`status/2`, `enabled: true`/`false`),
  `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts`
  (`getPsychologistStatus`),
  `apps/api/test/application/use-cases/execution/get-psychologist-status.use-case.spec.ts`,
  `apps/web/src/routes/ProjectInsightsTab.test.tsx`
- **Borda:** a flag continua GLOBAL (ver RN-117) — a rota da api aceita
  `projectId` na URL só para bater com o padrão das rotas irmãs do
  controller, e não porque a resposta varia por projeto.
- **Origem:** achado por USO real navegando a aba Insights com
  `PSYCHOLOGIST_ENABLED=false`, não roteiro. Sem ADR — extensão pontual do
  mecanismo de leitura já existente da RN-117, mesmo padrão da RN-088/
  RN-107 para o resto do produto.

---

## Pasta local anexada vira o quarto escopo do índice RAG, lido pelo NAVEGADOR (RN-455..457, ADR 0113)

Pedido do dono do produto: anexar uma pasta da PRÓPRIA máquina do usuário a
um projeto como referência de leitura para os agentes — sem exigir o CLI
`brabo-runner` (ADR 0103), diferente de `execution_mode: runner`
(ADR 0104), que precisa de um caminho de HOST real porque roteia comando
para lá. O navegador lê o CONTEÚDO dos arquivos (`File.text()`) e o caminho
RELATIVO dentro da pasta escolhida (`File.webkitRelativePath`) — nunca um
caminho absoluto de máquina, porque a API de `File` do navegador não expõe
um, para nenhum site. O que atravessa a rede é texto que o navegador já
tinha o direito de ler, o mesmo modelo de confiança de qualquer upload de
arquivo comum.

### RN-455 — `chunks.scope` ganha `'local'`, reusando o pipeline de RAG inteiro {#rn-455}

`ChunkScope` passa de `'docs' | 'adr' | 'session'` para incluir `'local'`
(migração `0052`, `ALTER TYPE ... ADD VALUE`) — aditivo, sem migração de
dado, sem CHECK novo: os dois CHECK de `chunks` (migração `0045`) já são
escritos como "é `session` ou não é", então `local` cai do mesmo lado de
`docs`/`adr` (tem `source_path`, não tem `session_id`) sem mudança
nenhuma além do valor do enum. `origemDoChunk` (`domain/rag/rag-citation.ts`)
não precisou de nenhum ramo novo: um chunk `local` carrega `sourcePath`
exatamente como `docs`/`adr`, então cai no `kind: 'file'` que a citação já
sabia renderizar.

- **Onde:** `apps/api/src/db/schema.ts` (`chunkScopeEnum`),
  `apps/api/src/db/migrations/0052_chunks_local_scope.sql`,
  `apps/api/src/application/ports/chunk-repository.port.ts` (`ChunkScope`),
  `apps/api/src/application/use-cases/rag/index-local-folder.use-case.ts`
- **Teste:** `apps/api/test/application/use-cases/rag/index-local-folder.use-case.spec.ts`
  (caminho feliz e full rebuild), `apps/api/test/interfaces/http/rag/rag.controller.spec.ts`
- **ADR:** [0113](adr/0113-pasta-local-anexada-via-navegador-vira-chunks-scope-local.md)
- **Origem:** pedido do dono do produto

### RN-456 — Teto agregado REJEITA (400) o upload inteiro; arquivo individual grande/binário só é PULADO {#rn-456}

Diferente de `docs`/`adr` (uma varredura em background, sem ninguém
olhando), anexar uma pasta é um gesto ÚNICO com um seletor de pasta na
tela. `IndexLocalFolderUseCase` recusa (400) o lote inteiro quando a
quantidade de arquivos (`RAG_LOCAL_FILE_COUNT_LIMIT`, 500) ou os bytes
somados (`RAG_LOCAL_TOTAL_BYTES_LIMIT`, 8 MiB) estouram — nunca trunca em
silêncio, porque quem clicou "Anexar" pode escolher uma pasta menor. Um
arquivo individual grande demais (`RAG_LOCAL_FILE_BYTES_LIMIT`, 512 KiB) ou
de extensão não reconhecida (`RAG_LOCAL_ALLOWED_EXTENSIONS`, allowlist) é
só PULADO (`filesSkipped`), nunca derruba o lote — a mesma distinção que
`IndexProjectDocsUseCase` já faz implicitamente ao filtrar só `.md`.
Caminho com `..` ou barra inicial é RECUSADO (400), nunca aceito
silenciosamente, mesma disciplina de nunca confiar em caminho vindo do
cliente (RN-092/095) mesmo quando ele "não deveria" conter isso.
`apps/web/src/lib/rag-local-limits.ts` espelha os mesmos números no
cliente, só como conveniência de UX (resumo antes de enviar) — quem
garante de verdade é o servidor.

- **Onde:** `apps/api/src/domain/rag/rag-search-limits.ts` (`RAG_LOCAL_*`),
  `apps/api/src/application/use-cases/rag/index-local-folder.use-case.ts`
- **Teste:** `apps/api/test/application/use-cases/rag/index-local-folder.use-case.spec.ts`
  (tetos de quantidade e bytes somados rejeitam; arquivo grande/binário é
  pulado; caminho com `..`/barra inicial é recusado)
- **ADR:** [0113](adr/0113-pasta-local-anexada-via-navegador-vira-chunks-scope-local.md)
- **Origem:** pedido do dono do produto

### RN-457 — `maintainer`, e reanexar é o MECANISMO de resincronizar — nunca o "Reindexar agora" genérico {#rn-457}

`POST .../rag/local` exige `maintainer`, mesma régua de `POST .../rag/reindex`
(RN-238): as duas chamam o provider de embedding e substituem o que o
projeto já tinha indexado. `ReindexProjectUseCase` NÃO foi estendido para
cobrir `local` — ele reindexa lendo de uma fonte que o SERVIDOR consegue
revisitar (o repositório do projeto, o event log), e `local` não tem
fonte nenhuma para revisitar: o texto só existe no navegador de quem
anexou, e o servidor nunca guardou caminho de host nenhum (não há um).
Chamar `deleteByScope(projectId, 'local')` no botão genérico apagaria a
referência anexada sem ter como recriá-la — reanexar a pasta (novo
upload) É o mecanismo de resincronizar, e é um botão deliberadamente
separado. Os dois casos de uso carregam comentário cruzado explicando o
porquê, para uma "correção" futura não religar os dois e apagar
silenciosamente o material do usuário.

- **Onde:** `apps/api/src/interfaces/http/rag/rag.controller.ts`
  (`anexarPastaLocal`, `@RequireRole('maintainer')`),
  `apps/api/src/application/use-cases/rag/reindex-project.use-case.ts`
  (comentário "Por que `local` NÃO entra aqui")
- **Teste:** `apps/api/test/interfaces/http/rag/rag.controller.spec.ts`
- **ADR:** [0113](adr/0113-pasta-local-anexada-via-navegador-vira-chunks-scope-local.md)
- **Origem:** pedido do dono do produto

### RN-458 — Cobertura de `local` é forma PRÓPRIA, e `lastAttachedAt` é a ÚNICA exceção real ao "nunca Xmin" (RN-237) {#rn-458}

`RagCoverage.local` não reusa `RagFileCoverage` (RN-237, ADR 0080): não há
"total no repositório" pra comparar — uma pasta anexada não tem um total
que o servidor possa recontar. `RagLocalCoverage` mostra o que está
indexado AGORA (`filesIndexed`, `folderName`) e `lastAttachedAt`, um
`MAX(chunks.created_at)` REAL sobre o escopo — a única exceção declarada
à regra de nunca mostrar um "reindexado há Xmin" chutado, porque aqui o
valor real EXISTE e é barato de calcular (mesmo `todosOsChunks` que
`GetRagCoverageUseCase` já busca).

- **Onde:** `apps/api/src/application/use-cases/rag/get-rag-coverage.use-case.ts`
  (`RagLocalCoverage`), `apps/web/src/components/rag/RagCoveragePanel.tsx`
- **Teste:** `apps/api/test/application/use-cases/rag/get-rag-coverage.use-case.spec.ts`,
  `apps/web/src/components/rag/RagCoveragePanel.test.tsx`
- **ADR:** [0113](adr/0113-pasta-local-anexada-via-navegador-vira-chunks-scope-local.md)
- **Origem:** pedido do dono do produto

### RN-459 — Teto de iterações não termina mais calado em quatro dos seis agentes conversacionais {#rn-459}

Achado durante a investigação da faixa de atividade do turno (RN-460):
`arquiteto_server.ex`, `dev_lead_server.ex`, `ux_designer_server.ex` e
`staff_server.ex` terminavam CALADOS quando o teto de iterações estourava
(`defp run_turn(state, remaining) when remaining <= 0, do: state`, sem
evento nenhum) — contradizendo a regra permanente de que laço de agente
não termina calado. Só o PO já emitia `toolloop.limit_reached`
(RN-166); o Criativo diverge deliberadamente com `agent.error` (`reason:
"limite_de_iteracoes"`, decisão documentada no próprio código — reusar o
nome do `ToolLoop` mentiria sobre quem produziu o evento) e não foi
tocado. Os quatro corrigidos passam a emitir `toolloop.limit_reached`
(mesmo evento do PO, mesmo payload `iteration`/`max_iterations`) antes de
retornar — nenhuma mudança na estrutura de `dispatch_tool` de cada um.

- **Onde:** `apps/engine/lib/engine/agents/arquiteto_server.ex:193`,
  `dev_lead_server.ex:244`, `ux_designer_server.ex:121`,
  `staff_server.ex:113`
- **Teste:** `apps/engine/test/engine/agents/{arquiteto,dev_lead,
  ux_designer,staff}_server_test.exs` ("teto de iterações emite
  toolloop.limit_reached")
- **Origem:** achado por leitura completa dos seis servers, durante a
  implementação da RN-460; escopo estendido por decisão do dono do
  produto

### RN-460 — A faixa de atividade do turno narra em tempo real, e o fio só recebe a resposta no fim {#rn-460}

A tela de Sessão mostra, ACIMA do composer, uma faixa que narra em
linguagem humana o que um agente conversacional (Criativo, PO, Arquiteto,
Dev Lead, UX Designer, Staff) está fazendo DURANTE o turno — referência
visual: a linha de status do Claude Code. O fio só recebe a bolha de
resposta DEPOIS que o turno termina; a regra é do CHAT (canal Phoenix) e
vale só para os seis agentes conversacionais — o chat consultivo sem
agente ativo (SSE, `streamChatMessage`) continua com a bolha de streaming
de sempre, intocada.

**Mecanismo (engine)**: os seis servers já emitem `tool.call` DURÁVEL no
event log; passam a também fazer `broadcast(state, "tool.call", %{tool:
name, agent: @agent})` — EFÊMERO, sem `args` (nunca payload cru, mesma
régua da RN-096/RN-412) — logo depois, pro canal `session:<id>` entregar
em tempo real. Não há behaviour/macro compartilhado entre os seis
`dispatch_tool` (quatro formas estruturais distintas confirmadas por
leitura completa): a mudança é seis edições adaptadas à forma local de
cada um.

**Mecanismo (web)**: um reducer PURO
(`reduzirAtividadeDoTurno`/`lib/atividade-do-turno.ts`) acumula o texto do
`agent.delta` como "corrente"; ao chegar um `tool.call` do canal, arquiva
o corrente não-vazio como linha de NARRAÇÃO, zera, e SEMPRE adiciona uma
linha de FERRAMENTA com `fraseDaFerramenta(tool)` (dicionário das 19
ferramentas dos seis agentes, `lib/narracao-de-ferramentas.ts`, sem RN
própria — só existe pra servir esta regra) — duas chamadas consecutivas
sem delta entre elas viram duas linhas separadas, nunca uma. Fim de turno
reseta (`finalizarTurnoDoAgente`, ÚNICO ponto de reset). `turnoViaCanal`
é uma flag PRÓPRIA (nunca derivada de `statusAgent`/`streamingAgent`, que
passam por janelas legitimamente `null` no meio de um turno) que decide
se a faixa aparece OU a bolha antiga — nunca as duas.

**Regra de apresentação (histórico)**: `agruparNarracoesDoTurno`, nova
passada pura que roda DEPOIS de `afundarDesfechos` (RN-172) no mesmo
`useMemo` — dentro de um mesmo `turno`+`autor`, `agent.response`
consecutivas viram um `Disclosure` compacto ("Passos do turno · N"),
deixando só a última intacta e fora dele. `turno === 0` (o prólogo
sentinela de `turnoDoSeq`) fica de FORA do agrupamento, de propósito —
não é um turno de verdade, e fixtures antigas empilham `agent.response`
sem fronteira de turno pra testar outro mecanismo (RN-138/RN-177).
Função agnóstica a agente (só lê `turno`/`autor`), `afundarDesfechos` em
si não muda.

- **Onde:** `apps/engine/lib/engine/agents/{po,criativo,arquiteto,
  dev_lead,ux_designer,staff}_server.ex` (broadcast de `tool.call`);
  `apps/web/src/lib/atividade-do-turno.ts` (reducer);
  `apps/web/src/components/TurnActivityStrip.tsx` (componente);
  `apps/web/src/lib/session-channel.ts:50` (`onToolCall`);
  `apps/web/src/routes/SessionPage.tsx:281` (`agruparNarracoesDoTurno`),
  `SessionPage.tsx:854` (`turnoViaCanal`)
- **Teste:** `apps/web/src/lib/atividade-do-turno.test.ts`,
  `apps/web/src/components/TurnActivityStrip.test.tsx`,
  `apps/web/src/lib/session-channel.test.ts`,
  `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
  (`agruparNarracoesDoTurno`), suite de `apps/engine/test/engine/agents/
  *_server_test.exs` (broadcast de `tool.call` sem args crus)
- **Origem:** pedido do dono do produto

---

## Quando dá errado

| situação | o que o sistema faz |
|---|---|
| Transição de estado inválida | erro tipado (`InvalidSessionTransitionError` etc.), traduzido para 4xx — nunca grava estado inconsistente |
| Agente estoura o teto de iterações ou tokens | encerra e registra artefato de bloqueio com a origem da falha |
| Task esgota o ciclo K | bloqueada com motivo, não gira para sempre (RN-015) |
| Provider de LLM cai no meio | registrado como falha de **infra**, nunca "o modelo parou" (RN-023) |
| Duas decisões concorrentes na mesma hipótese | conflito explícito (RN-022) |
| Réplica do engine cai | sessão é adotada por outra ou encerra como `closed_abnormally / node_shutdown` — nunca fica órfã |
| `QaLeadServer`/`SecOpsAgentServer` cai no meio de um ciclo de gate | `Engine.Gates.GateRescuer` retoma sozinho — reinicia a área (nenhum veredito gravado) ou reenvia a chamada perdida (veredito já gravado) — sem intervenção manual (RN-140) |
| Rate limit indisponível | a requisição **passa**: o guard protege contra abuso, não contra acesso indevido |
| Rate limit **estourado** (429) | a tela diz o que a api respondeu e o poll para; a app nunca responde ao limite com mais tráfego (RN-088) |
| Credencial errada, conta inexistente ou conta bloqueada | **a mesma** resposta 401, com o mesmo custo de argon2 (RN-032) |
| Refresh já usado reapresentado | família revogada e evento de segurança; o usuário legítimo também é deslogado (RN-030) |
| Tráfego interno sem o segredo de serviço | 403 na api, 401 no engine — nunca alcança o controller (RN-035) |
| Provider recusa a chave durante o sync de catálogo | provider **pulado** com a origem da falha; nenhum modelo é marcado como sumido (RN-041) |
| Modelo do binding some do provider | a cascata cai para o nível de baixo e AVISA qual escopo pulou — nunca troca o modelo em silêncio (RN-041) |
| Preço do modelo muda | vale daqui em diante; o custo gravado e o preço que o produziu ficam intocados (RN-042) |
| Criar o handoff falha (Criativo→PO, Arquiteto→Infra/Dev Lead) | `agent.error` durável, o processo do agente CONTINUA vivo; o que já foi gravado antes (product_brief, regras) não se perde (RN-116) |
| Caminho de projeto **Local** não montado no container | a criação é **recusada** (400) com a linha de compose a acrescentar — o projeto não nasce para travar depois (RN-170) |
| Login social: e-mail do provider bate com conta existente mas NÃO verificado | recusado com 403, nenhum vínculo gravado — e-mail não verificado não é prova de identidade (RN-274) |
| Login social: `state` inválido/expirado, ou de outro PROPÓSITO (fluxo de conexão de git) | recusado, nenhuma chamada ao provider nem escrita no banco (RN-273) |
| Validar a necessidade sem `product_brief` nenhum na sessão | recusado (400) ANTES de gravar qualquer evento — não há o que validar ainda (RN-406) |
| Converter `execution_mode` com dev agent trabalhando ou travado | recusado (409) ANTES de mexer no permissions.json ou no ciclo de vida do container — nunca migra um agente vivo (RN-447) |
| Pasta local anexada estoura o teto de arquivos ou de bytes somados | recusado (400), o lote inteiro — nunca trunca em silêncio (RN-456) |
| Arquivo individual da pasta local é grande demais ou de extensão não reconhecida | só PULADO (`filesSkipped`), nunca derruba o upload inteiro (RN-456) |

> **TODO(humano):** as RNs acima foram extraídas do código e dos testes. Falta
> confirmar se existe regra de negócio **não implementada** que deveria estar
> aqui — algo combinado e ainda não codificado não aparece nesta varredura.

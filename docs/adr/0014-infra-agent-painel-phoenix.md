# ADR 0014 — InfraAgent and the live team panel (Phase 4a closure)

- Status: accepted
- Date: 2026-07-24
- Phase: 4a (session 4 — closure)

## Context

The last two items of Phase 4a: the **InfraAgent** (reads the module_map +
the Architect's infra ADRs, proposes Dockerfiles/compose/CI via PR — never
applies anything to an environment) and the **full team panel** (all agents
instantiated, live status via Phoenix channels, no longer a static/uniform
status). With this, Phase 4a closes; Phase 4b (Psychologist/Anamnese) is
left for later.

Acceptance criterion: in the test project, InfraAgent delivers a PR with a
valid Dockerfile that passes the gates (syntactic QA + SecOps scan), and
the panel shows the whole team with correct states during a real execution.

## Decisions

### 1. Architect→Infra handoff — same mechanism, new offer point

InfraAgent belongs to the SAME family as the session-scoped agents
(Creative/PO/Architect) — not the project-scoped pattern of
Dev/QA/SecOps — because it's activated by an explicit handoff, not
instantiated one-per-module. `ArquitetoServer` gains
`handle_call(:offer_infra_handoff, ...)` (mirroring the Creative agent's
`confirm_readiness`): runs a closing turn and calls
`EngineApiClient.create_handoff(project_id, session_id, "arquiteto",
"infra", nil)`. A dedicated human endpoint
`POST projects/:id/sessions/:id/agents/arquiteto/handoff-infra` →
`OfferInfraHandoffUseCase` — it does **not** reuse the Creative agent's
`readiness` endpoint (different agents and different moments in the flow).

`AcceptHandoffUseCase` gains an autonomy seed conditioned on
`toAgent === "infra"`: `agent_autonomy (infra, open_infra_pr) =
auto_approve` (PROPOSING the PR is safe to auto-approve — InfraAgent never
applies anything to an environment) and `(infra, terminal) = deny`.
`ArquitetoSupervisor`/`agent-activation.ts` are already generic by agent
name — no change needed beyond `agent_command_controller.ex` gaining the
`"infra"` clause.

### 2. The terminal restriction is structural + policy, not a new ActionType

`decide()` evaluates IAM → agent_autonomy → permissions.json, with each
stage only able to RAISE permissiveness — a `deny` in agent_autonomy
SHORT-CIRCUITS before permissions.json is even consulted. So "deny generic
terminal but allow hadolint" doesn't need (and shouldn't) be expressed
under the SAME ActionType `terminal`: InfraAgent's hadolint validation
(`ValidateInfraFile`, a `:direct` tool) runs as a direct call to
`System.cmd` via `Engine.Actions.HadolintDetector`, with no proposed_action
at all — the same pattern as the SecOps detectors. The denial of the
generic `terminal` is twofold: **structural** (InfraAgent's tool registry —
`[ValidateInfraFile.spec(), ProposeInfraPr.spec()]` — never includes
`Terminal`) and **policy** (`agent_autonomy (infra, terminal) = deny`,
defense in depth testable via `decide()` but not the actual mechanism that
prevents misuse).

### 3. `open_infra_pr` generalizes `open_adr_pr` to N files

New `ActionType` (`decide.ts`) calibrated like `open_adr_pr`
(maintainer/pending by default). `domain/git/infra-pr-execution-result.ts`
mirrors `AdrPrExecutionResult`, but with `paths: string[]` (a single commit
with multiple files). `ExecuteInfraPrUseCase` generalizes
`ExecuteAdrPrUseCase`: `GitProvider.commitFiles` already accepted
`files: {path,content}[]` — only the consumer was fixed at 1 file. Fixed
branch `feature/infra-setup` (one per session, not per slug like the ADR
one).

**Correction cycle without a new PR**: a session produces a SINGLE infra PR
cycle — the correction after `changes_requested` reuses the SAME
branch/PR instead of opening another one. `ExecuteInfraPrUseCase` detects
this via `InfraArtifactRepository.findBySessionId` (new): if an artifact
already exists for the session, the call is treated as a correction —
`commitFiles` only, no `createBranch`/`openPullRequest`, no new row in
`infra_artifacts` (it reuses the `pullRequestUrl`/`pullRequestId` from the
ORIGINAL execution, read back via `listByProjectAndType`).
`InfraAgentServer` gains `handle_cast({:correct, findings}, state)`
(mirroring `DevAgentServer.correct/3`): instructs the model to fix and call
`propose_infra_pr` again — the SAME tool, with no special branch for the
correction case (the differentiation lives entirely in the api).

### 4. Infra gates: a light parallel table, the same state machine

An infra PR has no task/story/worktree behind it (files are born as direct
content, just like an ADR — they never touch a worktree). Instead of
forcing the fit into `tasks`, a new table `infra_artifacts` (migration
0016) with the SAME gate columns that `tasks` has (`gate_status`,
`gate_correction_count`, `blocked`, `blocked_reason`) + `pr_action_id`
(the id of the `open_infra_pr` proposed_action — the only id the engine
knows in return). Unlike `tasks` (which exists BEFORE the PR and opens the
gate afterward via `OpenGateUseCase`), the infra artifact is only born once
the PR has already been opened — `gate_status` already arrives at
`'awaiting_qa'`.

`RecordInfraGateVerdictUseCase` reuses the SAME `nextGateStatus` (pure
domain, already agnostic of Task) against `InfraArtifactRepository`
instead of `TaskRepository` — keyed by `prActionId`, not `taskId`
(`findByPrActionId`). Comments on the PR go via `listByProjectAndType` (not
`findInSessionForUpdate`, which is for exclusive use inside a transaction
with a lock).

`Engine.Infra.InfraGateRunner` (new) is DETERMINISTIC end to end (no own
GenServer, no LLM) — `run_qa/3` runs `hadolint` over each Dockerfile in the
PR payload (fetched via the new `GetInfraPrFilesUseCase` + endpoint
`GET .../infra-artifacts/:prActionId/files`, since there's no worktree to
point the detectors at); `run_secops/3` runs `gitleaks`+`semgrep` (the same
detectors as dev SecOps) against a TEMPORARY directory written on the spot
with the payload's files (removed in the `try`'s `after`). Triggered via
`Engine.Gates.Dispatcher.run_infra_qa/3`/`run_infra_secops/3` (the same
testable indirection as Dev↔Gates, but using `Task.start` —
fire-and-forget — instead of its own GenServer, since the runner doesn't
need state between calls).

### 5. Live team panel — broadcast at existing emission points

No new outbox-relay (a bigger, unnecessary change for this acceptance
criterion): `Engine.Sessions.LiveBroadcast.event_appended/4` (new, small)
is called alongside `EngineApiClient.append_event` in ALL the
project-scoped GenServers that only wrote events without broadcasting
(`DevAgentServer`, `QaAgentServer`, `SecOpsAgentServer`, `InfraAgentServer`,
`InfraGateRunner`) — broadcast on the `session:<id>` channel, event
`event.appended`. The conversational agents (Creative/PO/Architect/Infra)
gain `agent.status` (`working`/`idle`) at existing turn boundaries
(start/end of each `handle_cast`/`handle_call` that runs `run_turn`).

Web: `session-channel.ts` gains `onEvent`/`onAgentStatus` — on receipt,
`queryClient.invalidateQueries(['session-events', ...])` (reuses the
parsing/cache the polling already had, just triggers the refetch earlier).
`ProjectOverviewTab` opens its OWN channel (`connectSessionHeartbeat`),
independent of what `SessionPage` already opens, since they are
different routes/tabs mounted at different moments.

`lib/agent-status.ts` (new) — `deriveAgentRoster(events, moduleMap,
executionActivated, handoffs)` builds the REAL roster: creative/po/architect
always; `dev-<module>` per module_map module when execution was activated
(synthesizes an `AgentDef` reusing the generic "dev-backend" icon/color,
since there's no fixed entry for a dynamic id); qa/secops when any gate
(dev OR infra) has ever opened; infra when the handoff was accepted.
Status: conversational agents via the last `agent.status`; dev via a
heuristic over its own last events (`dev.*`/`backlog.task_blocked`);
qa/secops via the `gateStatus` of the most recent verdict (`awaiting_qa`/
`awaiting_secops` says which of the two currently has the ball — they are
project-wide singletons, processed serially). `ProjectOverviewTab`'s
"Agent team" now uses this, with `model`/`autonomy` (`AgentCard`, which
already accepted the props) resolved via
`getAgentModelBinding`/`listAgentAutonomy` once per page load.

### 6. Activity feed and the Approvals tab

`activity.ts` gains branches `infra.gate_changed`, `infra.pr_opened`/
`infra.pr_failed`, `infra.artifact_blocked` and
`architecture.readiness_confirmed` (mirroring the existing
`pr.gate_changed`/`adr.*` branches, with text making clear it's an "infra
PR"). `artifact.qa_verdict`/`secops_verdict` (existing branch, reused by
both dev AND infra) checks `prActionId` in the payload to differentiate the
text without duplicating the branch.

New human endpoint `GET projects/:id/infra-artifacts`
(`ListInfraArtifactsUseCase`) + `useInfraArtifacts` hook. `PrGateTimeline`
(already-existing component, used by dev PRs) has its `task: Task` prop
narrowed to a structural interface `GateSubject { title, blocked,
blockedReason, gateStatus }` — both `Task` and `InfraArtifact` satisfy it
structurally, without coupling the component to the backlog domain. New
"Infra PRs under review" section in the Approvals tab, same component.

## Consequences

- Tests: `decide.spec.ts` proves the short-circuit (a deny in
  agent_autonomy never reaches permissions.json, even with a broad allow);
  integration `ProposeActionUseCase` (InfraAgent proposing `terminal`
  becomes `denied`); `RecordInfraGateVerdictUseCase` (full mirror of the
  task-gate tests, including an already-blocked artifact rejecting a new
  verdict). Engine: `ValidateInfraFile` (missing hadolint doesn't break the
  turn), `InfraAgentServer` (happy path with N files, correction, deltas +
  `agent.status`, rehydration), `InfraGateRunner` (lint with a finding,
  approval triggers the next gate, missing scanner skips without
  breaking).
- `docker build --check` is out of scope — it would require mounting the
  host socket into the engine's container (Alpine, no docker CLI/daemon
  today), a real risk not taken on without an explicit request. Only
  hadolint (`Engine.Actions.HadolintDetector`, optional binary, same
  pattern as the other detectors).
- The "live" panel is via broadcast at existing emission points — no new
  generic api→engine→Phoenix outbox-relay.
- Phase 4b (Psychologist/Anamnese) remains out of scope.

## Scope & assumptions

A session produces ONE infra PR cycle (corrections reuse the same
branch/PR — never a second, competing PR). No deep diff↔scanner-finding
correlation (same simplification as ADR 0013). Dev/qa/secops status in the
panel is heuristic (best-effort over the event log, not a transactional
source of truth) — good enough for the panel, not used by any gate
decision.

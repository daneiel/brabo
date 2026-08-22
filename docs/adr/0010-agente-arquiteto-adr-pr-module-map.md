# ADR 0010 — Architect agent: ADRs via a real PR, module_map and cross-validation

- Status: accepted
- Date: 2026-07-24
- Phase: 3b (final session — closes Phase 3)

## Context

Closes the Creative → PO → **Architect** cycle. Activated by an accepted
handoff from the PO, the Architect produces: (a) **ADRs** committed to
`docs/adr/` of the PROJECT'S repo via the Phase 2 git pipeline, on a
`feature/adr-*` branch, with a **real PR** that the user approves/merges;
(b) a **module_map** validated against dependency cycles. It enforces
**cross-validation** (a story only moves to `ready` if every module it
references exists in the current module_map) and emits **insights** about
rule↔architecture tension.

## Decisions

### 1. ADR = new `open_adr_pr` ActionType with a git executor
Git actions had no post-approval executor (`ApproveActionUseCase` only
routed `terminal`). We added `open_adr_pr` (git effect, `require_approval`,
min role maintainer). The Architect's `propose_adr` tool creates the
proposed_action (existing pipeline); on approval, `ApproveActionUseCase`
routes to `ExecuteAdrPrUseCase`, which via the `GitProviderContract` (Phase
2) does `createBranch(feature/adr-<slug>)` +
`commitFiles(docs/adr/<slug>.md)` + `openPullRequest` and records
`executionResult` {pullRequestUrl, …}. **Two user steps**: approving the
action (opens the PR) and merging the real PR on the provider. The merge
stays with the user (the app only opens the PR — as the acceptance criterion
requires).

### 2. module_map in its own table, validated against cycles in the domain
A dedicated tool `create_module_map` (not `emit_artifact`): it needs to be
STORED for cross-validation. `module_maps` table (immutable history;
**current = highest version**). `domain/architecture/module-graph.ts`
detects cycles (DFS) and **rejects** the map (error → tool-result). It also
emits `artifact.module_map` to the event log (narrative).

### 3. Story↔module_map cross-validation (blocking + revalidation)
Stories gain `module_ids[]` (jsonb). `TransitionStoryUseCase` (draft→ready):
besides readiness (DoD/DoR/RF/rule), it requires that ALL `module_ids`
exist in the current module_map (`assertModulesResolved`) — an empty
moduleIds passes (it's a gap, not a blocker, respecting the stories from the
previous session). A new module_map **revalidates** `ready` stories and
**demotes to draft** the orphaned ones (removed module), with a
`backlog.story_demoted` event — which is the notification (surfaces in the
feed/bell via poll). The Architect links modules to stories with
`assign_story_modules` (validates existence) — that's how a story comes to
reference valid modules.

### 4. Architect as a GenServer with a `:pipeline` tool
`ArquitetoServer` mirrors `PoServer` (streaming + bounded tool-use loop +
rehydration + kickoff). Tools: `create_module_map`/`assign_story_modules`/
`emit_insight` (`:direct`) and `propose_adr` (`:pipeline` → `propose_action`).
The **PO** gained `offer_handoff` and now offers a handoff to the Architect
at the end of its kickoff; the user accepts it (via the
`AcceptHandoffUseCase` flow), activating the Architect through the same
activation rule from session 1.

### 5. Insights as a typed artifact
`emit_insight` writes `artifact.insight` when the model sees tension
between a rule and the architecture (e.g., an RNF with no module that
addresses it). No domain logic — it's the agent's judgment, narrated in the
feed.

## Consequences

- The project overview gains an **Architecture** section: the module_map
  (modules with `depends_on` as chips), ADRs (link to the PR + status
  badge) and cross-validation gaps in red. The "accept handoff" button on
  the session became generic (any agent), and the composer routes to the
  most-advanced active agent.
- Tests: domain (`module-graph` rejects a cycle, `module-resolution`),
  use-case (`CreateModuleMap` rejects a cycle + revalidates/demotes an
  orphan; `TransitionStory` blocks ready with a missing module;
  `ExecuteAdrPr` with a fake GitProvider opens the PR), and
  `arquiteto_server` (kickoff chains module_map→assign→ADR→insight; a cycle
  becomes an error tool-result; broadcast; rehydration).

## Scope

Final session of Phase 3. Does not implement execution agents (Phase 4).
The credential used to open the PR is the approver's (`decidedBy`),
consistent with provisioning (Phase 2). No Bitbucket/GenericGitProvider;
queues on Postgres (Oban).

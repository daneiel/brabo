# ADR 0011 — Dev agent infrastructure: worktrees, git executors and the merge lock

- Status: accepted
- Date: 2026-07-24
- Phase: 4a (session 1 — execution infrastructure)

## Context

Start of Phase 4 (execution agents). Before the real devs, this session
builds the INFRASTRUCTURE and validates it with a **NoopDevAgent** (no LLM):
dynamic instantiation of one dev per module_map module, isolated git
worktrees, `dev-<module>[bot]` commit identity, the protected-branch merge
lock, one-click parallelization suggestions, and orphan worktree cleanup.
User decision: **100% local, self-contained** git flow.

## Decisions

### 1. Merge lock as a domain-level CEILING (decide.ts)
New `ActionType git_merge` (payload `{sourceBranch, targetBranch}`).
`decide()` evaluates IAM → agent_autonomy → permissions (each stage only
RAISES permissiveness); at the end, a **ceiling**: if `git_merge` targets
`targetBranch ∈ {dev,qa,rc,main}` (protected branches), the policy is NEVER
`auto_approve` — it's downgraded to `require_approval`, regardless of
agent_autonomy and permissions.json. Deny still wins. A test proves that
neither autonomy nor permissions can override it. Merging into a protected
branch is ALWAYS manual (CLAUDE.md).

### 2. Git executors via the pipeline; local commit in the worktree
`git_commit`/`git_push`/`pr_open`/`git_merge` gain executors (previously
only `terminal`/`open_adr_pr` had one). `git_commit`/`git_push` run IN THE
ENGINE (`GitExecutor`, `System.cmd git` in the worktree — commit with
`--author=dev-<module>[bot]` + `Co-authored-by`), via an internal endpoint
mirroring the terminal one. `pr_open`/`git_merge` run in the api via
`GitProvider`. `ExecuteGitActionUseCase` routes them; `ApproveAction`/
`ProposeAction` (auto_approved) call it. Every git operation is born as a
proposed_action (item 3), respecting autonomy/permissions.

### 3. LocalGitProvider gains local PRs (self-contained)
`openPullRequest`/`mergePullRequest` implemented with a lightweight store
(sidecar JSON in the bare repo) + a git-based merge; `capabilities.pullRequests`
becomes `true`. This (additively) reverts the Phase 2 decision not to
support PRs locally — needed for the demo to run without GitHub. The single
contract suite now covers local PRs too.

### 4. Worktrees off the local working tree; 1 per agent; orphan cleanup
`WorktreeManager` creates worktrees under `<workspace>/.worktrees/<agent_id>`
(branch `feature/<task>`) from the working tree that `Engine.Actions.Workspace`
already builds from the bare repo. 1 worktree per agent (guaranteed by the
per-agent_id directory); `WorktreeCleanupWorker` (a self-rescheduling Oban
job) prunes the orphans (a worktree with no live agent in
`Engine.Dev.Registry`).

### 5. Dynamic dev agents: supervision + rehydration
`DevAgentSupervisor` (DynamicSupervisor) + `Engine.Dev.Registry` (key
`{project_id, agent_id}`), one `DevAgentServer` per module. Durable state in
`dev_agent_states` (`engine` schema); `DevRehydrator` recreates the agents on
boot (same idiom as `SessionServer`/`Rehydrator`) — rehydration does NOT
re-trigger the `:work` cycle. The NoopDevAgent (`:work`): claims a task
(atomic claim, `FOR UPDATE SKIP LOCKED`) → worktree → trivial file → proposes
commit/push/pr_open. `ActivateExecutionUseCase` seeds instructions +
`auto_approve` autonomy (git ops) per module and tells the engine to spin up
the agents.

### 6. Suggested parallelization; one-click acceptance
On activation, modules with ≥2 claimable tasks (independent, available
branches — a simplified task-dependency graph for now) emit
`execution.parallelization_suggested`. Acceptance (a button in the UI →
engine) spins up a `dev-<module>-2` with its own worktree.

## Consequences

- The project overview gains an **Execution** section: an "Activate
  execution" button (when a module_map exists), the dev agents with their
  branch/task, the parallelization suggestion with "Accept", and the open
  PRs. The feed narrates `dev.*`/`execution.*`.
- Tests: `decide` (merge lock — neither autonomy nor permissions
  auto-approve a merge into a protected branch); `ClaimNextTaskUseCase`
  (atomic claim, distinct per agent); LocalGitProvider PR (contract);
  `worktree_manager` (2 parallel worktrees without conflict + orphan
  cleanup); `dev_agent_server` (Noop cycle + persistence/rehydration).

## Scope & assumptions

Only the **NoopDevAgent** (no LLM) — the real devs (harness + LLM) are the
next session. The full live team panel (Phoenix channels) and QA/SecOps/
Infra come later. `git_merge` executes (via GitProvider) only on manual
approval — the demo exercises REJECTING auto-merge. **Dev-env assumption:**
the api and engine share the FS of the bare repos
(`GIT_LOCAL_REPOS_ROOT`) and of the workspaces (`PROJECT_WORKSPACES_ROOT`) —
volumes in Compose.

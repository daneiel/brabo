---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0145 — Docker becomes a real prerequisite of the `runner` mode

## Context

The `runner` mode (ADR 0104) exists for code that lives in a user folder WITHOUT
a bind-mount to the server, confirmed by a CLI (`brabo-runner`) running on their
machine. Since ADR 0137 (RN-497), that same CLI also brings up a Docker container
ON THE USER'S MACHINE, and `Engine.Actions.TerminalExecutor` routes every
approved terminal command to the runner whenever the workspace is VERIFIED and
the runner is CONNECTED — without checking whether there is any `running`
container. The host-vs-container choice was entirely INTERNAL to the runner
(`EstadoDoRunner.containerAtivo`): with a container up, it ran via
`docker exec`; without one, it silently fell back to the bare HOST, executing
the command outside any isolation.

That left `runner` inconsistent with `container`/`mounted`, which since ADR 0143
(RN-502) already REFUSE to run a terminal without a registered `running`
container — they never degrade to local `System.cmd`. For `runner`, the "local"
was the user's own host: the same silent fallback ADR 0143 closed for the other
two modes remained open here, outside the server.

A second defect, declared since RN-478 and never fixed: the materialization of
the dev agent's working tree (`Engine.Actions.Workspace.ensure!/4`) tried a LOCAL
`File.mkdir_p!`/`System.cmd("git", ...)`, inside the engine process, against a
path that only physically exists on the user's machine — the engine process has
no bind-mount there at all. The previous fix only improved the MESSAGE of an
inevitable failure; the dev agent still had nowhere to work.

A third point, found during the investigation: `container_start` (the action
that actually brings up the container, ADR 0130/0133) also served `runner`, but
its payload (`imagem`/`network`/`resources`/`rationale` — Infra ELECTS a
candidate from the Arquiteto's routing) never made sense for that path: the
broker never reaches a `runner` project's folder, so there is no routing to elect
against, and the image that comes up is simply the one already decided.

## Decision

**Docker becomes a real prerequisite of the `runner` mode, with no fallback to
the host.** The three preconditions `runner` needs for any command to reach the
user's machine — workspace CONFIRMED, runner CONNECTED and container REGISTERED
`running` (`ProjectContainerLifecycle.running?/1`, the SAME predicate as
`container`/`mounted`) — live in a single function,
`Engine.Runners.RunnerReadiness`, with two consumers: `TerminalExecutor` (which
already checked the first two) and the new module below.

**Worktree materialization now happens INSIDE the project's real container, on
the user's machine — through the SAME channel that already executes the
terminal.** `Engine.Actions.Workspace.ensure!/4` forks by `execution_mode`:
local for `container`/`mounted` (unchanged), via
`Engine.Actions.Workspace.RunnerGit` (new) for `runner`. `RunnerGit` does
`git init`/`remote add`/`fetch`/`checkout`, and the equivalents of
`File.dir?`/`ls`/`rm_rf` that `Engine.Dev.WorktreeManager` needs, as normal
shell commands, delivered by `Engine.Runners.RunnerRouter.exec/5` — never a new
mechanism, always after `RunnerReadiness.verificar/1` confirms the three
preconditions. `WorktreeManager` (`create/3`, `remove/2`, `list/1`,
`cleanup_orphans/2`) forks by the same criterion, and the periodic job
`Engine.Dev.WorktreeCleanup` now SKIPS (does not fail) a `runner` project
without a runner ready RIGHT NOW, continuing normally for the others.

**The `exec`/`exec_result` protocol gains an optional `env` field.** The
authenticated `git fetch` needs the provider credential (ADR 0056), which can
only travel in the child process's environment — never argv, never a file. Since
that child process is now born on the user's machine, `env` (a
`Record<string,string>`) enters the payload the engine dispatches; the runner
MERGES that `env` on top of `process.env` before the `spawn` (never replaces it
— it would lose PATH) and never passes it to the `docker exec` path (no `env`
support in `packages/docker-port`, on purpose — see Consequences) nor prints it
in any log.

**`container_start` migrates entirely to being exclusive to
`container`/`mounted` (both through the broker, RN-503).
`container_start_via_runner` is born, a new action type, exclusive to
`runner`.** Same caliber as `container_start` (`maintainer`, `require_approval`
by default, configurable in `permissions.json`) — but the schema only has an
optional `rationale`: it elects no candidate at all, it brings up the image
already DECIDED (`ObterSpecDeContainerUseCase`). `Engine.Infra.Tools.
ProposeContainerStartViaRunner`, the Infra Lead's new tool, is intercepted by
the `InfraLeadServer` BEFORE calling `propose_action` — it LOCALLY queries
(`Project.get/1` + `Engine.Runners.Registry.connected?/1`, without HTTP, in the
same BEAM process) the `execution_mode` and the presence of a connected runner,
refusing with a named reason instead of proposing blindly.

## Consequences

- **A `runner` project without a `running` container loses the terminal and the
  dev agent's worktree until someone proposes and approves
  `container_start_via_runner`.** Accepted cost, MEASURED against the real
  precedent: the sibling change for `container`/`mounted` (ADR 0143, RN-502)
  already had the same shape — "now requires where it did not before" — and
  shipped as `feature/`, MINOR, without a `breaking/` branch. No existing
  `runner` project had guaranteed isolation before this delivery (the silent
  fallback to the host is exactly what is being closed), so there is no prior
  correct behavior being taken away — only an unsafe behavior ceasing to exist.
- **`env` only reaches the `git fetch` when the runner chooses the HOST path.**
  If the runner already has an active container (`EstadoDoRunner.containerAtivo`),
  `tratarExec` routes EVERY `exec` — including those of `RunnerGit` — via
  `docker exec`, which has no `env` field (a measured decision of ADR 0130:
  keep the Docker port with a closed type, with no free `-e`). A `git fetch`
  dispatched in that state silently loses the credential for a private
  repository. Not solved in this delivery — extending `packages/docker-port` to
  accept `env` would touch BOTH of its consumers (runner and broker) and was
  out of scope; declared for when the volume of `runner` projects with a private
  repository justifies it.
- **`RunnerReadiness.verificar/1` runs again on each `RunnerGit` call** (one
  more query per git/worktree operation) — acceptable because no function of
  this module is on the hot path (the same rule that already held for
  `Engine.Actions.Workspace.ensure!/4` before this delivery).
- **The gap RN-494 declared for `propose_container_start`** (neither it nor
  `GetInfraContextUseCase` restrict by `executionMode` — the Infra Lead can
  propose blindly) **remains exactly as it was for that tool.** The NEW tool
  (`container_start_via_runner`) is born without that gap because it is born
  knowing how to refuse — but that is not retroactive: `propose_container_start`
  still cannot distinguish the mode, a separate decision, outside the
  API/domain scope.

---
traducao_de: eb32fa72c74cb4f32985f16a3c1440e93357c0b9
---

# ADR 0134 — Dev agents execute INSIDE the project's real container, and the terminal gains an auto-approval floor in there

## Context

ADR 0133 (PR 1.5) closed the `container_start` path (`proposed_action` →
approval → broker → `project_containers`) end to end and declared, in so many
words: "dev agents do NOT YET work inside the container that comes up [...]
what runs inside the container, for now, is only what the broker brings up —
with no consumer yet." This is the PR that provides the consumer.

Today, even with a real container up, `Engine.Actions.TerminalExecutor` keeps
running EVERY dev agent terminal command via `System.cmd` INSIDE the engine's
own process, against the shared folder (`PROJECT_WORKSPACES_ROOT`) — exactly as
it always did. The container sits idle: nothing in it is ever `docker exec`ed.

## Decision

**When the project is in `execution_mode: container` with a REGISTERED
`running` row in `project_containers`, the dev agent's terminal command now
runs INSIDE the container, via `docker exec` (through the broker) — no longer
via local `System.cmd`.**

### The fifth outcome of `decisao_de_execucao/1`

`Engine.Actions.TerminalExecutor` already had FOUR outcomes (RN-423, ADR 0104,
the routing to the local runner). It gains a fifth, `:executar_no_container`,
conditioned on `execution_mode == "container"` AND
`Engine.Containers.ProjectContainerLifecycle.running?/1` — a new read-only read,
directly on the `project_containers` table (same pattern as
`Engine.Projects.Project` reading `projects`: the engine reads the column the
api writes, without duplicating the derivation).

`mounted` NEVER falls into that outcome: the broker refuses to bring up a
container for that mode (`ModoDeExecucaoNaoSuportadoError`, deliberate policy
until PR 1.7 revisits the three modes), so the question does not even make
sense for it.

### The new leg: engine → api → broker.exec

`ContainerBrokerPort.exec` (ADR 0130) already existed, with the whole scope
validation on the broker side (`DiretorioForaDoEscopoError` outside `/work`) —
but it had ZERO callers. It is closed with:

1. A new internal route, `POST internal/projects/:projectId/container-exec`, in
   `InternalProjectsController` (not in `InternalContainersController` — see
   "Why not in the broker's controller", below) — the same `EngineServiceGuard`
   as always, called by the ENGINE, not by the broker.
2. `ExecutarComandoNoContainerUseCase`: calls `ContainerBrokerPort.exec` and
   handles `BrokerRecusouError`/`BrokerIndisponivelError` by returning a TYPED
   failure result (`{ sucesso: false, motivo }`) — it never lets the exception
   leak through the HTTP route. Any OTHER error (a real defect) keeps
   propagating — it is not disguised as a command failure.
3. `Engine.Sessions.EngineApiClient.executar_comando_no_container/4` — the
   usual checklist (callback + delegator + `Req.post` impl + test fake), calling
   the new route.
4. `Engine.Actions.TerminalExecutor` gains `run_no_container/4` (mold:
   `run_via_runner/4`), which calls the client above and maps the result to
   `build_result`/`failed_result`.

**A broker.exec failure NEVER becomes a crash nor a silent fallback to
`System.cmd` outside the container.** `sucesso: false` (the broker refused or
did not answer) and an engine→api transport failure become a normal
`failed_result` — clear message, `exit_code: nil`, exactly like any other
command that failed. A container killed or removed from outside between the
registered `running` and the moment of the call (RN-486: registered and
observed never merge) IS that case — it is not a bug, it is the price of
"registered" never being a guarantee. Falling back to `System.cmd` outside the
container would reopen exactly the isolation-escape vector this PR exists to
close.

### Why not in the broker's controller

`InternalContainersController` (the `container-spec` route) has an explicit
comment: "sem `@Post` aqui, e isso não é esquecimento" — because whoever WRITES
the container lifecycle is `RegistrarTransicaoDeContainer`, and giving the
BROKER write authority there would confuse who decides the state. The new route
differs on both axes that comment protects: the CALLER is the engine (not the
broker reading from the api), and what it does is not write
`project_containers` — it runs a command and returns the result. That is why it
lives in `InternalProjectsController`, next to `confirm-workspace-verification`
(another route the engine calls, not the broker).

### The dev agent's worktree ALREADY appears in `/work` — without changing `Workspace.ensure!/4`

Hypothesis checked: **confirmed.** `apps/broker/src/operacoes.ts`,
`especificacaoDoProjeto/2`, composes `raizDoProjeto` as
`${PROJECT_WORKSPACES_HOST_ROOT}/${workspaceDirName}` — the SAME root
(`workspace_dir_name`, RN-109) that `Engine.Actions.Workspace.workspace_dir/2`
already uses to resolve `<PROJECT_WORKSPACES_ROOT>/<workspace_dir_name>` inside
the engine process. `packages/docker-port/src/docker-cli.ts` mounts that
`raizDoProjeto` as the ONLY bind
(`${spec.raizDoProjeto}:${PONTO_DE_MONTAGEM}:rw`,
`PONTO_DE_MONTAGEM = '/work'`). That is: **it is the SAME physical directory**,
only reached by two paths — from inside the engine, via
`PROJECT_WORKSPACES_ROOT` (a bind/volume on the engine side); from inside the
freshly started container, via `/work` (a bind resolved by the daemon against
`PROJECT_WORKSPACES_HOST_ROOT` on the HOST). The worktree the dev agent already
uses today — created the usual way, `Workspace.ensure!/4` running
`System.cmd("git", ...)` inside the engine process, writing to the shared
volume — already appears INSIDE the container at `/work`, without
`Workspace.ensure!/4`/`ensure_remoto/2` changing AT ALL. The container is just
one more observer of the SAME directory.

This depends on `PROJECT_WORKSPACES_HOST_ROOT` being configured correctly to
point to the HOST path that makes the SAME physical folder that
`PROJECT_WORKSPACES_ROOT` resolves inside the engine's container — that is the
operator's responsibility (already documented in the comments of
`docker-compose.yml`), and it remains so: nothing changes here.

### `cwd`: translation from HOST to `/work`

`opts[:cwd]` arrives at `TerminalExecutor.run/3` as an ABSOLUTE HOST path
(inside `project_workspaces_root` — the shared root, or the
`.worktrees/<agent_id>` subdirectory of a specific dev agent, via
`Engine.Dev.WorktreeManager`). `run_no_container/4` translates that path into
`/work` BEFORE sending it to the broker: it swaps the prefix
`<project_workspaces_root>/<workspace_dir_name>` for `/work`, preserving the
suffix. An absent `cwd` (runs at the workspace root) becomes `nil` — the broker
defaults to `/work`. A `cwd` that is not inside that root (it should not happen
for `execution_mode: container`) is sent as it came, without trying to guess —
the broker refuses with `DiretorioForaDoEscopoError` if it is not inside
`/work`, defense in depth instead of a silently fabricated path.

### Decision 3: autonomy inside the container

**A terminal command whose scope is the project folder INSIDE the real
container auto-approves — but that is a FLOOR, not a new ceiling, and the five
absolute ceilings of `decide.ts` stay byte for byte as they were.**

Mechanism: `ProposeActionUseCase.execute` queries the SAME
`ObterCicloDeVidaDoContainerUseCase` the execution uses (only when
`actionType === 'terminal' && project.executionMode === 'container'` — sparing
the query everywhere else) and builds `containerExecutionActive` in the
`DecideContext`. Inside `decide()` (which remains PURE — zero IO), the INITIAL
value of `current` stops being always `{ policy: 'require_approval', reason:
'default' }` and becomes `{ policy: 'auto_approve', ... }` when
`action.actionType === 'terminal' && ctx.containerExecutionActive`.

**Why this is safe without duplicating the ceilings mechanism that already
exists:** every following stage (`agent_autonomy`, `permissions.json`) already
REPLACES `current` when it has an explicit opinion — that is how the usual
default `require_approval` could already be downgraded by an explicit `deny` or
kept by an `ask`. Changing the INITIAL value does not change that property: an
explicit `agent_autonomy: deny`, or a `permissions.json` with `ask`/`deny`
matching the command, keep downgrading the container floor exactly as they
already downgraded the default `require_approval` — it is not a new path, it is
the same `current` with a different starting point. And the absolute ceilings
(scope, git push/privileged command, protected merge, instruction_patch,
parallelism) keep running AFTER, over `current.policy === 'auto_approve'` —
including when that `auto_approve` came from the container floor, not from an
explicit rule.

**The security justification is a boundary swap, not the absence of one.**
Outside the container, the terminal scope boundary (`ADR 0055`) is LEXICAL:
`terminalNoEscopo` compares `cwd`/`command` against `ctx.projectScopeRoot`, a
HOST path — and that check is what makes it safe to auto-approve by
`permissions.json allow` today. Inside the real container, Docker's mount
namespace is a STRONGER boundary: the process running the command physically
does not see anything outside `/work` (it closes the symlink vector the comment
of `path-scope.ts` records as open for `mounted`/`runner`, finding U — there
there is no mount namespace at all, here there is). The `/work` validation the
broker already does (`DiretorioForaDoEscopoError`,
`apps/broker/src/operacoes.ts`) is the SECOND layer, over the already
translated `cwd`. **The lexical scope ceiling (`terminalNoEscopo`) keeps running
on top of the floor, with no exception at all** — it operates on the SAME HOST
paths as always (the `cwd`/`command` that arrive at `decide()` are NEVER
translated to `/work`; that translation happens only later, in the engine, when
building the call to the broker) — it is defense in depth, not replacement: a
command `decide()` would mark out of scope today stays marked out of scope with
the floor on, and again requires a human decision.

**Why a FLOOR and not a seeded `agent_autonomy` rule:** a seeded rule (like the
auto mode of `open_adr_pr`) would need to be written/deleted every time the
container goes up/down, and would diverge from what is REGISTERED in
`project_containers` the instant the container fell from outside — the same
two-sources-of-truth problem ADR 0130 already avoids by never merging
registered and observed (RN-486). Querying the lifecycle at decision time is
the SAME source the execution queries at execution time — zero synchronization
between the two.

## Consequences

**`ContainerBrokerPort.exec` gets its FIRST real caller** — the last of the
five operations of ADR 0128/0130 without one. `stop`/`remove` remain without
their own `proposed_action`, unchanged by this PR.

**`mounted`/`runner` still have no container at all** — RN-421/RN-423 remain as
they were; the structural containment gate of the `join` remains absent for
those two modes (finding of ADR 0072, not closed here).

**The question "how many modules, a single container" remains as it is** —
`project_id UNIQUE` in `project_containers`, no change in this delivery.

**The lexical terminal scope (ADR 0055) loses no consumer.** It remains the
only boundary for `mounted`/`runner` (which have no mount namespace protecting
them), and keeps running ON TOP of the container floor as a second layer — it
was not replaced anywhere.

**Alternative considered and discarded: translating the `cwd` inside
`decide()` too, to compare against `/work`.** It would make the scope ceiling
operate on the FINAL path, more "correct" in appearance — but it would move an
INFRASTRUCTURE decision (where the broker mounted the volume) into a function
the rest of the file deliberately keeps pure and without knowledge of any
container, and would duplicate the `cwd` translation in two places
(`decide.ts` and `TerminalExecutor`) that would need to agree forever.
Discarded: the scope ceiling remains useful operating on the HOST paths it has
always operated on — it is REDUNDANT with the mount namespace inside the
container, not replaced by it, and redundancy that requires no synchronization
is the defense in depth this ADR seeks.

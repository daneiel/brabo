---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0137 — `brabo-runner` brings up the project's container on the user's machine

## Context

The image gate (RN-105) has applied in all THREE execution modes since RN-494
(ADR 0135): `mounted`/`runner` need a decided `artifact.project_image` for the
Code tab to open, exactly like `container`. What RN-494 left declared, in so
many words: "what does not come up is the container itself — `mounted`/`runner`
still have no container of their own on the server." This is the PR that closes
that half, but not on the SERVER side — on the USER side.

Today, a project in `runner`/`mounted` mode executes EVERY terminal command
directly on the user's machine (`child_process`, no isolation at all) — the same
`brabo-runner` that already keeps the Phoenix channel `terminal:<projectId>`
(ADR 0103/0104) and already knows how to TALK to ITS Docker
(`@brabo/docker-port`, proven by `--self-test-docker` since ADR 0128, with no
real consumer until now). The broker (`apps/broker`, ADR 0130) already provides
that isolation for the `container` mode, bringing up a container on the SERVER
— but it will NEVER bring up a container for `mounted`/`runner`: their code
lives in a USER folder the server does not see
(`ModoDeExecucaoNaoSuportadoError`, `apps/broker/src/operacoes.ts`). The only
process that sees that folder is the runner itself, on the machine of whoever
has the folder.

## Decision

**`container_start`/`container_stop`/`container_remove` gain a SECOND execution
path, branched by the project's `executionMode` — `container` stays through the
broker, `mounted`/`runner` now ask the connected RUNNER, via the SAME Phoenix
channel that already exists.**

### Reuse of the exec/exec_result pair, three times

`apps/runner/src/channel.ts` already had the exact pattern for "server asks the
runner something, runner answers, correlated by `ref`, with timeout":
`exec`/`exec_result`, on the runner side; `Engine.Runners.RunnerRouter.exec/4` +
`EngineWeb.TerminalChannel` (`handle_info({:dispatch_exec, ...})` +
`handle_in("exec_result", ...)`), on the engine side. This PR REPLICATES that
pattern, three times — it never invents a new one:

- `container_start`/`container_start_result`
- `container_stop`/`container_stop_result`
- `container_remove`/`container_remove_result`

On the engine side, `RunnerRouter` gains `start_container/3`,
`stop_container/3` and `remove_container/3`, factored over a common private
`dispatch/5` (the three differed only in the event atom and the result atom —
`exec/4` keeps its own code, untouched). `TerminalChannel` gains four
`handle_info({:dispatch_container_*, ...})` (`despachar_pedido/6`, a mold common
with `dispatch_exec`) and three `handle_in("container_*_result", ...)`
(`responder_pedido_pendente/3`, which now also serves `exec_result` — the same
`pending_execs`, a generic ref→from map that neither knows nor needs to know
WHICH request is pending).

On the runner side, `channel.ts` gains the three message types +
`enviarContainerStartResult`/`Stop`/`Remove`; `RunnerChannelHandlers` gains
`onContainerStart`/`onContainerStop`/`onContainerRemove`; `index.ts` gains
`tratarContainerStart`/`Stop`/`Remove`, which call `DockerViaCli` — the SAME
port the broker uses on the server side (`packages/docker-port`, ADR 0130),
with the USER's Docker.

### The new HTTP path: api → engine → runner

`ApiToEngineClient` (the port the api already uses for
`executeTerminalAction`, synchronous) gains `startContainerViaRunner`/
`stopContainerViaRunner`/`removeContainerViaRunner`.
`EngineWeb.ContainerCommandController`
(`POST internal/projects/:projectId/containers/{start,stop,remove}`) is the only
caller on the engine side — it forwards to `RunnerRouter` and never writes
`project_containers` (whoever writes remains
`RegistrarTransicaoDeContainerUseCase`, on the api side, after the call
returns).

**The engine's answer is ALWAYS 200** — same discipline as
`ActionCommandController`/`ExecutarComandoNoContainerUseCase` (ADR 0134):
`sucesso: false` in the BODY, never an HTTP error status, for the two causes
that are NORMAL failure — no runner connected/timeout (`motivoCodigo`), and the
runner having tried and refused (Docker unavailable on the user's machine,
invalid specification). `HttpApiToEngineClient` throws
`RunnerNaoConectadoError` only in the first case, `RunnerRecusouContainerError`
in the second — the three use cases catch BOTH together (same reasoning as
`BrokerRecusouError`/`BrokerIndisponivelError`) and record `failed` with the
reason, never let it propagate.

### The image: READ, never ELECTED again

`ExecuteContainerStartUseCase` (ADR 0133) elects a candidate image from the
Arquiteto's routing and emits a new version of `artifact.project_image`
(`DecidirImagemDoProjetoUseCase`, `decidedBy: 'infra-lead'`) BEFORE asking the
broker to bring it up — that is specific to the `container` path, and the
`mounted`/`runner` path does NOT repeat that step. It only READS the CURRENT
decision via `ObterSpecDeContainerUseCase` — the SAME use case that already
composes `GET .../container-spec` for the broker (ADR 0130), called DIRECTLY,
without HTTP, because `ExecuteContainerStartUseCase` and
`ObterSpecDeContainerUseCase` run in the same api process. Without a decided
image (RN-105), it fails BEFORE asking the engine — the same gate that already
applies to the other three parts of the product.

The payload that travels to the runner (`EspecificacaoDeContainerParaRunner`) is
the SAME fields as `EntradaDeEspecificacao` (`packages/docker-port`) MINUS
`raizDoProjeto` — the runner fills that field itself, with `estado.dir`. That is
not bandwidth saving: it is the decision that NO host path travels from the
server to the runner, for the same reason none travels from the server to the
broker (`apps/broker`, ADR 0130) — whoever knows the REAL path is whoever is on
the machine.

### `Engine.Actions.TerminalExecutor` did NOT gain a new outcome

Finding confirmed by reading the code: `decisao_de_execucao/1` already routes
UNCONDITIONALLY every command of a VERIFIED and CONNECTED `runner` project to
`RunnerRouter.exec/4` (RN-423, ADR 0104) — it does not ask "is there a
container?", only "is there a runner?". The decision "run on the host or inside
the container I brought up" is INTERNAL to the runner, not to the engine, and
so the engine does not need to know it exists.

What changes is only `apps/runner/src/index.ts`: `EstadoDoRunner` gains
`containerAtivo: string | null` (the NAME of the container THIS runner brought
up — `brabo-<workspaceDirName>` — or `null`); `tratarExec` now checks that
field — with an active container, it runs via `DockerViaCli.exec(nome, {
comando, cwd })`; without one, it falls back to the usual path
(`executarComando` directly on the host). `cwd` (already validated by
`validarCwdDentroDaRaiz` against the project root) is translated into `/work`
by PREFIX swap (`cwdParaContainer(raiz, cwd, pontoDeMontagem)`, `guard.ts`) —
same reasoning as `cwd_para_container/2` on the engine side (RN-492, ADR 0134):
the root becomes the mount point, the rest of the path stays the same.

`containerAtivo` survives channel reconnections (it is part of `estado`, which
persists across the `while` of `main()`) — the Docker container itself does not
fall when the WebSocket falls, and the runner should not "forget" it because of
a reconnection.

### `guard.ts`/RN-434 already covers the mount, with no new code

The original plan recorded the question: does the container's bind-mount need a
second "valid mount path" validation? **Confirmed it does not, by reading the
whole of `guard.ts`.** `estado.dir` ALREADY is the confirmed root — validated by
`validarDirDentroDoHomeNoLinux` (RN-434, refuses `--dir` outside `$HOME` on
Linux) and by `garantirDiretorio` (RN-435), both at CLI STARTUP, BEFORE any
channel connects or any container comes up. The container mount IS
`estado.dir`, period — there is not (nor does there need to be) a second check
like `caminhoDeWorkspaceLocalValido` on the runner side. RN-434 "now also covers
the mounted path" only because the mount uses the SAME variable it already
validated, not because anything new was written.

## Consequences

**`packages/docker-port` gains REAL USE on the runner side** — before only
proven by `--self-test-docker` (ADR 0112/0128); now `DockerViaCli.start/stop/
exec` are actually called, with the user's Docker.

**The FIVE operations of the `DockerPort` still have no sixth** — `start`/
`stop`/`remove`/`inspect`/`exec` remain the same five; this PR only gives them a
SECOND consumer (the runner, besides the broker), never a new field in the
specification.

**`mounted` gains the SAME path as `runner`** — the branching in the three use
cases is by `executionMode !== 'container'`, not by
`executionMode === 'runner'`; `mounted` can now also bring up its own container,
as long as it has a connected runner (`brabo-runner` runs the same in both
modes, RN-169/RN-421/RN-422).

**The structural containment of the `join` (broker, ADR 0055) remains absent
for `mounted`/`runner`** — the symlink vector ADR 0055 already recorded remains
open; what this PR closes is the LACK of any isolation, not a boundary as strong
as the server's. `guard.ts` remains best-effort, by invariant — not a gap of
this PR.

**Exclusivity by `{project_id, machine_id}` remains deferred** (gap already
declared in CLAUDE.md, ADR 0104) — two runners connected to the same project
remain impossible through the `Registry`'s exclusivity (`:global`), not through
a container check.

**Alternative considered and discarded: re-electing the image on the
`mounted`/`runner` path too, calling `DecidirImagemDoProjetoUseCase`.** It would
make the two paths symmetric in appearance, but would force the
`container_start` payload to carry `network`/`resources`/`rationale` even when
nobody uses them (the runner does not need them: it only reads the current
decision). Discarded: the `mounted`/`runner` path already has the image decision
— someone decided EARLIER, through the Arquiteto or Infra, the usual way — and
re-electing here would duplicate a decision that already exists, with no new
candidate to elect between.

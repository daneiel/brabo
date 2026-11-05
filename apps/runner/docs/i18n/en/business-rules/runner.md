---
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
id: rn-runner
title: 'Regras de negócio — Runner'
sidebar_label: Runner
description: 'As RNs hospedadas na raiz runner.'
keywords: [regras de negócio, runner]
---

# Runner

## Wave 1 of ADR 0104 — `execution_mode` in three values, workspace verified by the runner

### RN-423 — The runner CONFIRMS the path; without confirmation, the command is refused — it never falls into the container {#rn-423}

The runner is the **source of truth** for a `runner` project's path, not
what was typed in the wizard. Right after the Phoenix channel connects
(`terminal:<projectId>`, `:runner` role), `apps/runner/src/index.ts`
pushes `workspace_confirm` with the `--dir` it received on the command line.
The engine passes it on (`Engine.Sessions.EngineApiClient.confirm_workspace/4`)
to `POST /internal/projects/:projectId/workspace-verification`
(`ConfirmProjectWorkspaceUseCase`), which:

1. Refuses with `400` if the project isn't in `runner` mode;
2. Revalidates the path with the SAME lexical predicate as creation
   ([RN-422](api.md#rn-422)) — even coming from the runner, system root and
   overlap with Brabo remain forbidden;
3. **OVERWRITES** `workspacePath` with the normalized path and writes
   `workspaceVerifiedAt = now()` — without requiring equality with what was
   typed at creation: the runner rules;
4. Is IDEMPOTENT — reconnecting reporting the SAME path rewrites nothing
   (`changed: false`); a DIFFERENT path rewrites, because the runner
   remains the source of truth at each reconnection;
5. With no session in the project yet (`ProjectSession.latest_id/1` returns
   `nil`): the `UPDATE` happens all the same, only the
   `project.workspace_verified` event (and the evidence for the
   `workspace-verificado` gate) is absent — the SAME degradation that
   `pty_open`/`pty_close` already accept (RN-108/RN-420). An accepted and
   declared gap, not a silent one.

`Engine.Actions.TerminalExecutor.decisao_de_execucao/1` gained FOUR
outputs, not two: `runner` with `workspace_verified_at: nil` refuses
(`:recusar_nao_verificado`); verified `runner` without a connected runner
refuses (`:recusar_runner_desconectado`); verified and connected `runner`
routes (`:rotear_runner`); any other mode follows the usual path
(`:caminho_de_sempre`). The two refusals NEVER fall into `System.cmd` — a
`runner` project has no bind-mount, and "falling to the usual path" would be
executing blindly in a folder the engine's process doesn't see. The
same refusal applies in the race (`Registry` said connected at the start of
`run/3`, but the runner dropped before the dispatch answered).

- **Where:** `apps/api/src/application/use-cases/iam/confirm-project-workspace.use-case.ts`,
  `apps/api/src/interfaces/http/internal/internal-projects.controller.ts`
  (`POST :projectId/workspace-verification`),
  `apps/engine/lib/engine/actions/terminal_executor.ex`
  (`decisao_de_execucao/1`), `apps/engine/lib/engine_web/channels/terminal_channel.ex`
  (`handle_in("workspace_confirm", ...)`), `apps/engine/lib/engine/sessions/engine_api_client.ex`
  (`confirm_workspace/4`), `apps/runner/src/channel.ts`
  (`enviarWorkspaceConfirm`), `apps/runner/src/index.ts`
- **Test:** `apps/api/test/application/use-cases/iam/confirm-project-workspace.use-case.spec.ts`,
  `apps/engine/test/engine/actions/terminal_executor_test.exs`
  (describe "roteamento pro runner local"),
  `apps/engine/test/engine_web/channels/terminal_channel_test.exs`
  (describe "workspace_confirm"), `apps/runner/src/channel.spec.ts`
  (`enviarWorkspaceConfirm` after the join)
- **Edge case:** `docs/gates.yml` registers `workspace-verificado` as
  `severidade: warn` — what really locks is the engine's explicit refusal,
  the gate is only the record/evidence.
- **Architectural decision:**
  [ADR 0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
- **Origin:** reconciliation of ADR 0104, decision confirmed with the product
  owner (the runner is the source of truth; with no session, the UPDATE happens
  anyway; command explicitly refused without verification/connection)

---

### RN-429 — Local folder navigation is a pure relay through the Runner, never the api enumerating the container {#rn-429}

The `terminal:<projectId>` channel gains two events, in the SAME relay
design as the PTY: `fs_list_dir`/`fs_home_dir` (`:web` asks, the engine relays DIRECTLY
to the registered runner's pid, immediate error when there's no connected runner
— it never waits for a response that won't come) and
`fs_list_dir_reply`/`fs_home_dir_reply` (`:runner` answers, a broadcast
filtered only to `:web`, correlated by a client-generated `ref`). The api
does NOT gain any new route — it still doesn't enumerate the filesystem, the
argument ADR 0072 had already fixed against a folder picker still
stands. `apps/runner/src/guard.ts` (which restricts the `cwd` of an already
approved command to the project root) on purpose does NOT apply to navigation — listing
a directory is a free read on the user's machine, with the privileges
they already have, and an entry without permission is skipped, it doesn't abort the
whole listing.

Declared gap: the channel's ticket is issued PER already existing PROJECT — on
the project creation screen (`NewProjectWizard.tsx`), the project is only born on
confirmation, so `FolderBrowserModal` receives `projectId: null` there and
shows the declared state instead of trying an impossible connection; the free
text field remains the manual path, as before.

- **Where:** `apps/engine/lib/engine_web/channels/terminal_channel.ex`;
  `apps/runner/src/fs-browser.ts`, `apps/runner/src/channel.ts`,
  `apps/runner/src/index.ts`; `apps/web/src/lib/fs-browser-channel.ts`,
  `apps/web/src/components/FolderBrowserModal.tsx`,
  `apps/web/src/components/RunnerOnboardingPanel.tsx`,
  `apps/web/src/routes/NewProjectWizard.tsx`,
  `apps/web/src/routes/code/TerminalPanel.tsx`
- **Test:** `terminal_channel_test.exs` (pure web↔runner relay, immediate
  error without runner, wrong role ignored); `fs-browser.spec.ts`
  (ordering, empty/nonexistent folder/file, permission per entry);
  `FolderBrowserModal.test.tsx` (null projectId, navigation, selection, no
  runner); `NewProjectWizard.test.tsx` ("Browse folder..." button)
- **ADR:** [0107](../adr/0107-navegacao-de-pasta-local-via-o-runner.md), revises
  [0072](../adr/0072-projeto-local-ou-container.md) without editing it
- **Origin:** product owner's request — "I couldn't link to a
  user folder"

---

## Local runner terminal stuck at "Opening terminal..." forever (RN-433)

### RN-434 — On Linux, the local runner's `--dir` is only accepted inside the user's `$HOME` {#rn-434}

The `brabo-runner` CLI (`runner` mode, ADR 0103/0104) only validated that
`--dir` exists and is a folder — with no restriction at all on WHERE that folder
could be in the file system. `lerArgumentos()`
(`apps/runner/src/index.ts`) now calls
`validarDirDentroDoHomeNoLinux(dir, process.platform, homedir())`
(`apps/runner/src/guard.ts`) right after the existence check: on
Linux (`process.platform === 'linux'`), `--dir` is only accepted inside
`os.homedir()` — the `$HOME` itself or any subfolder of it; a path
outside that tree (`/etc`, `/root`, `/`, or even another account in `/home`)
is refused with `process.exit(2)` and a message explaining the reason and
showing the expected home. Outside Linux (macOS, Windows) the
behavior doesn't change — the restriction is Linux-only.

The check reuses `dentroDoEscopo`/`semBarraFinal`, the same path comparison
primitives that `validarCwdDentroDaRaiz` already uses in the same
module, but is deliberately simpler than it: no `realpath` nor
TOCTOU/symlink protection, because it doesn't protect against a malicious
SERVER (that's the role of `validarCwdDentroDaRaiz`, exercised on each
`exec`) — it's a STARTUP check of the local CLI itself, guiding the
user who typed a wrong path when bringing up the runner.

- **Where:** `apps/runner/src/guard.ts`
  (`DirForaDoHomeError`/`validarDirDentroDoHomeNoLinux`),
  `apps/runner/src/index.ts` (`lerArgumentos`)
- **Test:** `apps/runner/src/guard.spec.ts`
  (`describe('validarDirDentroDoHomeNoLinux', …)` — accepts the home
  itself and a subfolder of it on Linux, refuses a path outside home and another
  account inside `/home` on Linux, and confirms the restriction does NOT
  apply outside Linux)
- **ADR:** [0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
  (additive extension — the runner was already declared "source of truth of the
  path"; this rule only narrows what it accepts as `--dir` on
  Linux)
- **Origin:** explicit request from the product owner, during a real
  project creation test (an attempt to point `--dir` at a path
  outside home, `/home/dev/exp001`, which didn't exist on the machine — it led
  to the decision to lock paths outside `$HOME` on Linux)

---

### RN-435 — A nonexistent local runner `--dir` is created, not refused {#rn-435}

The `brabo-runner` CLI (`runner` mode, ADR 0103/0104) refused with
`process.exit(2)` any `--dir` that didn't yet exist on disk — the
project folder had to be created manually before bringing up the CLI.
`garantirDiretorio()` (`apps/runner/src/guard.ts`) now creates the folder
automatically (`mkdirSync(dir, { recursive: true })`) when it doesn't
exist, and `lerArgumentos()` (`apps/runner/src/index.ts`) calls that function
RIGHT AFTER `validarDirDentroDoHomeNoLinux` (RN-434) — the ORDER is the
rule: the `$HOME` check works on a path that doesn't exist yet (only
`resolve()`, without touching disk), so it runs first and keeps refusing
`--dir` outside home on Linux even when it doesn't exist yet, BEFORE
any creation attempt — creating first would reopen the hole that
RN-434 had just closed. `--dir` pointing to an already existing FILE
remains a real error (`DirNaoEUmaPastaError`, `process.exit(2)`,
without trying to create anything) — this CLI never overwrites a file
silently. A failure in the creation itself (permission denied, disk full,
etc.) also refuses (`NaoConsegiuCriarDiretorioError`), with the original
error's message embedded.

- **Where:** `apps/runner/src/guard.ts`
  (`garantirDiretorio`/`DirNaoEUmaPastaError`/`NaoConsegiuCriarDiretorioError`),
  `apps/runner/src/index.ts` (`lerArgumentos`)
- **Test:** `apps/runner/src/guard.spec.ts`
  (`describe('garantirDiretorio', …)` — does nothing when the folder already
  exists, creates recursively when it doesn't, refuses without creating when the
  path already exists and is a file, and wraps a `mkdir` failure in
  `NaoConsegiuCriarDiretorioError`; and one more case in
  `describe('validarDirDentroDoHomeNoLinux', …)` proving that a `--dir`
  outside home and NOT YET EXISTING stays refused, confirming that the
  order of the two checks opens no hole)
- **ADR:** [0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
  (additive extension — it doesn't change the design of the runner as source of truth
  of the path, it only reduces the friction of bringing up a new project)
- **Origin:** product owner's request, upon noticing that the folder of a
  new project in `runner` mode didn't exist on the machine and needed to be
  created manually before running the CLI — the same scenario that motivated
  RN-434 (nonexistent `/home/dev/exp001`), now solved by creating the
  folder instead of just refusing

---

## The Runner's folder explorer becomes three columns, and creating a `runner` project no longer waits for the final step (RN-436/436)

### RN-452 — `node-pty` resolved by injection, not static import — and the gap this opened in the npm smoke was closed in the same commit {#rn-452}

`pty.ts` stopped doing a static `import * as nodePty from 'node-pty'` at the
top of the module — it now receives the already resolved module by injection in the
constructor of `GerenciadorDePty`, resolved once in `main()`
(`src/index.ts`) via `native-pty-loader.ts#carregarNodePty()`. The change
exists for the standalone binary (ADR 0112): the compiled path needs to
extract the embedded files to a real directory BEFORE resolving
`node-pty`, which requires an asynchronous call — incompatible with a
hoisted static `import`. Outside the compiled binary, the behavior is
identical to before (`await import('node-pty')`, resolved from the
`node_modules` of whoever installed the package).

**The gap the change opened, closed in the SAME commit**: ADR 0106 already
recorded that the static `import` of `node-pty`, being hoisted before
any argument parsing, made `smoke-dist.mjs` prove that the native binding
loaded just by IMPORTING `dist/index.cjs` — even on the
`uso()` path (zero arguments), which never reaches `main()`. Moving the resolution
into `main()` silently broke that guarantee, because
`smoke-dist.mjs` only exercised the `uso()` path. `smoke-dist.mjs`
gained a third check — it runs the CLI with valid arguments (but without
real api/engine on the other side) and waits for the line `node-pty carregado com
sucesso` on stdout before killing the process — closing the gap the
change itself opened, instead of leaving it as a silent loss of coverage.

- **Where:** `apps/runner/src/pty.ts` (`GerenciadorDePty`, injection of
  `NodePtyModule`); `apps/runner/src/native-pty-loader.ts`
  (`carregarNodePty`); `apps/runner/src/index.ts` (`main`, resolves once);
  `apps/runner/scripts/smoke-dist.mjs` (third check,
  `verificarNodePtyCarrega`)
- **Test:** `apps/runner/scripts/smoke-dist.mjs` (npm/tsup path) and
  `apps/runner/scripts/smoke-bin.mjs` (binary path, RN-451) — the only two
  places that exercise the really packaged artifact, no
  unit test replaces them
- **ADR:** [0112](../adr/0112-binario-standalone-do-runner-via-bun-build-compile.md)
- **Origin:** a technical need of the standalone binary; the gap in the npm
  smoke was found by an audit of the change itself, not by a real run
  reporting failure

## Runner configuration through the browser (RN-464..466, ADR 0118)

### RN-466 — `brabo-runner` runs without `--project`/`--dir`/`--token` when the folder has a local config written by the browser {#rn-466}

> **Revised by [RN-687](web.md#rn-687) ([ADR 0203](../adr/0203-aposenta-o-fluxo-do-runner-pelo-navegador.md), 10/01):**
> the browser no longer writes these files — the flow was retired. The
> READ remains intact: a folder configured before ADR 0203 keeps
> working, and it's also through `--dir` pointing to
> `$XDG_CONFIG_HOME/brabo/` that the machine unit finds the key created in
> the terminal (RN-551).

`apps/runner/src/device-key.ts` (a NEW module, separate on purpose from
`auth.ts`) reads — never writes — `brabo-runner.config.json`
(`{projectId, apiUrl}`) and `brabo-runner-device-key.jwk.json` from the current
`cwd()`; the absence of either of the two returns `null`, never throws, because
that absence is the NORMAL case of whoever still uses explicit flags. In
`lerArgumentos` (`apps/runner/src/index.ts`), the rule is the SAME three times —
an explicit flag always beats the local file: `--project` beats
`configLocal.projectId`; an absent `--dir` falls to `.` (the very folder where
the command runs) when there was a local config, instead of the usage error from
before; `--token`/`BRABO_ACCOUNT_TOKEN` beats the local device key when
both exist. With NO credential at all (neither token nor local key), the CLI
keeps refusing with the usage message — nothing here makes authentication
optional, only which of the two forms is used.

- **Where:** `apps/runner/src/device-key.ts` (`lerConfigLocal`,
  `lerChaveDeDispositivo`), `apps/runner/src/index.ts:95-206`
  (`lerArgumentos`)
- **Test:** `apps/runner/src/device-key.spec.ts` (happy path of each
  read; `null` without throwing for a missing file/invalid JSON/missing
  field; respects the received `cwd`; the module doesn't import
  `writeFileSync`/`mkdirSync`)
- **ADR:** [0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)
- **Origin:** product owner's request

## The conversational agents' decision artifact (RN-505)

### RN-507 — Docker becomes a real prerequisite of `runner` mode: the THREE execution modes require the SAME predicate {#rn-507}

Until now, `Engine.Actions.TerminalExecutor.decisao_de_execucao/1` checked only
TWO preconditions to route the terminal to an `execution_mode: runner` project
— workspace CONFIRMED and runner CONNECTED now — and routed unconditionally
as soon as both matched, without checking whether there was a REGISTERED `running` container
(`Engine.Containers.ProjectContainerLifecycle.running?/1`), the same predicate
`container`/`mounted` had already required since RN-502 (ADR 0143). The runner on the
other side decided on its own whether the command ran inside the container it
brought up (ADR 0137) or fell to the bare HOST — and without Docker up on the
user's machine, it always fell to the host, silently: the isolation ADR 0134
sought to create for `container` never applied to `runner`.

**The fix unifies the three modes under the SAME question.** `runner` gains a
THIRD precondition, in the same order as the other two: verified →
connected → `running` container. The three named refusals (workspace not
verified, runner disconnected, no container) live today in
`Engine.Runners.RunnerReadiness` — extracted because a SECOND consumer
was born in the same PR (`Engine.Actions.Workspace.RunnerGit`, below): "they aren't
two derivations, it's this function with two consumers", the same reasoning as
the moduledoc of `ProjectContainerLifecycle`.

**The dev agent's worktree materialization changes mechanism, not
result.** `Engine.Actions.Workspace.ensure!/4` tried LOCAL `File.mkdir_p!`/
`System.cmd("git", ...)` against the HOST path, even in `runner`
mode — the gap RN-478 recorded and left OPEN on purpose ("the dev agent's
working tree has nowhere to be born", since the engine's process has
no bind-mount at all for a folder that lives on the user's machine). The
fix isn't "improve the error message" again: `ensure!/4` now
forks by `execution_mode` — LOCAL for `container`/`mounted` (unchanged:
`mounted` already sees its folder via `BRABO_PROJECTS_BASE`, a bind-mount by
identity in the engine since ADR 0141), via `Engine.Actions.Workspace.
RunnerGit` for `runner`. `RunnerGit` does `git init`/`remote add`/`fetch`/
`checkout` (and the equivalents of `File.dir?`/`ls`/`rm_rf` that
`Engine.Dev.WorktreeManager` needs) as NORMAL shell commands,
delivered through the SAME Phoenix channel that already executes approved terminal commands
(`Engine.Runners.RunnerRouter.exec/5`) — never a new mechanism, and always
after `RunnerReadiness.verificar/1` confirms the three preconditions
(it raises with a named message before attempting any I/O, never a blind
`exec`). `Engine.Dev.WorktreeManager` (`create/3`, `remove/2`, `list/1`,
`cleanup_orphans/2`) forks by the same criterion.

**The periodic cleanup job SKIPS silently, never fails.**
`Engine.Dev.WorktreeCleanup.run/0` swept `File.dir?(work_dir)` to decide
whether to prune — always `false` for `runner` (the path is the HOST's, the engine doesn't
see it), so `runner` was never really pruned nor tested through that
path. The gate becomes by MODE: `File.dir?` stays for `container`/`mounted`;
for `runner`, `RunnerReadiness.pronto?/1` decides — with no runner connected or
no `running` container NOW, the project is skipped IN THIS round (`"can't
know now"`, never an error, never a worktree treated as an orphan by
mistake), and `Enum.each/2` continues to the following projects without any
exception crossing it.

**The `exec`/`exec_result` protocol gains a NEW field: `env` (ADR 0056).** The
authenticated `git fetch` of `RunnerGit` needs the provider's credential —
which can only travel in the child process's ENVIRONMENT (never argv, never
`.git/config`, the same discipline as the local `Engine.Actions.GitAuth`). Since the
child process is now born on the user's machine, the `env` field (optional,
`Record<string,string>`) enters the payload that `RunnerRouter.exec/5`
dispatches — present only when there's a real credential (the `local` provider
never carries it). On the runner's side: `apps/runner/src/exec.ts` MERGES (never
replaces) `opts.env` on top of `process.env` before the `spawn` — an `env`
defined without merge would discard PATH and break the resolution of the
`git`/`sh` binary itself. `apps/runner/src/index.ts` passes `msg.env` only to the
HOST path (`executarComando`) — the container (`docker exec`, via
`packages/docker-port`) didn't gain `env` support (out of scope of this
delivery: the port's `exec` operation still lacks that field, on purpose,
ADR 0130). No runner log prints `env` anywhere — audited by
grep, `console.log`/`console.warn`/`console.error` keep citing only
`ref`/`command`/`cwd`/`exitCode`.

- **Where:** `apps/engine/lib/engine/actions/terminal_executor.ex`
  (`decisao_de_execucao/1`); `apps/engine/lib/engine/runners/
  runner_readiness.ex` (new); `apps/engine/lib/engine/actions/workspace.ex`
  (`ensure!/4`); `apps/engine/lib/engine/actions/workspace/runner_git.ex`
  (new); `apps/engine/lib/engine/dev/worktree_manager.ex`;
  `apps/engine/lib/engine/dev/worktree_cleanup.ex`;
  `apps/engine/lib/engine/projects/project.ex` (`all_workspace_dirs/0` gains
  `execution_mode`); `apps/engine/lib/engine/runners/runner_router.ex`
  (`exec/5`); `apps/engine/lib/engine_web/channels/terminal_channel.ex`;
  `apps/runner/src/channel.ts` (`ExecMessage.env`); `apps/runner/src/exec.ts`;
  `apps/runner/src/index.ts`
- **Test:** `apps/engine/test/engine/actions/terminal_executor_test.exs`,
  `apps/engine/test/engine/actions/workspace_runner_test.exs`,
  `apps/engine/test/engine/dev/worktree_manager_test.exs`,
  `apps/engine/test/engine/dev/worktree_cleanup_test.exs`,
  `apps/runner/src/channel.spec.ts`
- **ADR:** [0145](../adr/0145-docker-pre-requisito-do-runner.md)
- **Origin:** the product owner's decision — Docker becomes a real prerequisite of
  `runner` mode, with no fallback to the host

## The mirror copies the work to the user's folder (RN-516)

### RN-516 — The mirror destination travels in the join GRANT, the mirror copies the git list in one direction only and never deletes, and the trigger is a named moment — never a watcher {#rn-516}

Half B of session 6 of PHASE 28: the `espelho` capability
([RN-514](engine.md#rn-514), [ADR 0147](../adr/0147-agente-local-com-capacidades.md))
comes to EXIST. [RN-515](api.md#rn-515) decided **where the destination lives** and did not
copy any file; this one decides **how it reaches the local agent, what is
copied and when**.

**The destination travels in the `join` grant, never in runner configuration.**
The `join` reply of the `terminal:<projectId>` channel is no longer empty for
the `:runner` role: when the project has a declared destination
(`projects.mirror_path`) **and** the `espelho` capability was granted, it
carries `%{espelho: %{destino: "<caminho>"}}`. The runner keeps this in
`estado.destinoDoEspelho`, which dies with the connection, and **refuses
`mirror_sync` for a destination not granted to it on that connection** (ADR
0147, point 4). Never an environment variable, never a local file: a
global destination would make project B's artifact land in project A's folder, and the
user would find that out **through the content, not through an error**.

A declared consequence, and it is the price: **changing the destination with the runner
connected requires reconnecting it.** The grant belongs to the join, and a new destination
arriving through another door would be exactly the global configuration the rule
refuses.

**A non-null `mirror_path` now REQUIRES the capability.** It does not enter the map
by `execution_mode` — what requires it is a project DATUM, not the mode (and
`mounted` and `runner` can have a destination while `container` cannot). This is
the **first REAL case** of the refusal mechanism RN-514 left
implemented and never firing: a `brabo-runner` older than this version
connected to a project with a destination **stops connecting**, with a named refusal
(`JoinRecusadoError`, fatal and with no retry). It is **opt-in** — it only happens where
someone configured a destination — and the cost is declared in ADR 0147 itself.

**The THREE refusals of the guard, and the `realpath` pass is not redundant.**
`apps/runner/src/espelho-guard.ts` is a **sibling of `guard.ts`, not an extension
of it**: it reuses `semBarraFinal`/`dentroDoEscopo`/`realpathMaisProximo` and the double
lexical-then-`realpath` pass of `validarCwdDentroDaRaiz`, and inherits in
writing the same **TOCTOU** caveat — it is best-effort, not a security
boundary. It refuses (1) a symlink escaping the destination, (2) a destination that
**contains** the workspace and (3) a destination **inside** the workspace; (2) and (3) are
the same loop in opposite directions, and with the identity bind of
[ADR 0141](../adr/0141-base-unica-dos-projetos-montados.md) writing the mirror
inside the source makes the mirror copy itself. The api already refused the
**lexical** half ([RN-515](api.md#rn-515)) and says, in the code itself, that it is only the
lexicon — it has no disk on which to resolve a symlink on the user's computer.
`destino/atalho -> /caminho/do/projeto` passes through there unseen, and it is here
that it is resolved.

A difference in mechanism, found while implementing: `realpathMaisProximo` falls back to the
first ancestor that exists, and the mirror destination almost never exists (it is the
`mkdir -p` of this round that creates it). Collapsing both sides onto the ancestor would make
`/base-outra` and `/base` both become `/`, and the guard would refuse every sibling
folder. That is why the second pass resolves the ancestor and **puts the suffix back** —
a symlink can only live in a segment that exists, so what remains never hides
any link. Refusal (1) also has a second half, **per file**
(`caminhoNoDestino`): a `destino/sub` that links to `/etc` would make the copy of
`sub/passwd` write outside, with the destination itself perfectly valid.

**One direction, and it NEVER deletes.** Workspace → destination. Never `--delete`, never
`unlink`, never `rm`. **A file deleted in the workspace remains in the destination**, and
that is a decision, not carelessness: the user's folder is not a replica, it is an accumulation — an
agent that deletes a file in someone's personal folder because of a `git clean`
on the other side is the surprise the product exists not to produce.
Overwriting a file that changed is expected; removing never is. The price, declared
in the ADR: the destination only grows, and no automatic mechanism cleans it.

**What is copied is the GIT LIST, and nothing else.** The **tracked** files
(`git ls-files`) plus the **untracked ones that are not ignored**
(`git ls-files --others --exclude-standard`), with `-z` (git quotes and escapes
a path with a space or accent without it). That is exactly "the work": it skips
`node_modules`, `dist`, build output and `.git` itself **without keeping any exclusion
list**, which would age with every new stack — the project's `.gitignore`
is already the list, maintained by whoever maintains the project. The workspace is
a git repository **by construction** (the product provisions Gitflow in it and
materializes it with `git init`/`fetch`/`checkout`), so the precondition belongs to the
PRODUCT, not an assumption about the machine. Git that fails or a folder that is not a
repository **fail with a named reason** — never a `cp -r` of everything as a
plan B, which is how an entire `node_modules` would end up in someone's personal folder.

Two properties verified and declared, not hidden: a **nested** git repository
comes back as ONE directory entry and is not descended into — the worktree
of each dev agent (`<workspace>/.worktrees/<agent_id>`) is one of those, so the
mirror shows the **main checkout**, never the work still isolated in a
worktree; and **a symlink at the source is skipped**, because following the link would bring
content from outside the project into the personal folder. What is left out is
COUNTED (`pulados`/`recusados`), never swallowed. And there is no
"did it change?" heuristic: always copying costs bytes that are already equal, while skipping by size+mtime
would make the mirror silently not copy a file that changed.

**Its OWN predicate, and the mirror does not require Docker.**
`Engine.Runners.RunnerReadiness` stays **byte for byte as it is** (ADR 0147,
point 3) — `Engine.Runners.Espelho` does not call it, does not extend it and receives
nothing from it. The mirror has TWO preconditions, confirmed workspace and connected
runner, and not the third that [RN-507](#rn-507) added (container
REGISTERED `running`). A `RunnerReadiness` with a "skip container" flag is
precisely the mechanism by which that third one would fall by accident for `exec`
in a future refactoring, and
[ADR 0145](../adr/0145-docker-pre-requisito-do-runner.md) exists so that
it does not fall. And the mirror legitimately does not need it: the third exists
because there were two possible executions and the wrong one was invisible; a file copy
on the user's machine has no container to fall from. It also does not
ask for the `execution_mode` — whoever already decided that was the api when writing the
destination ([RN-515](api.md#rn-515) refuses `container`), and repeating the decision would be the
second source of the same rule.

**Trigger by a NAMED MOMENT, never a watcher.** The engine pushes `mirror_sync`
from a point in the code that has a name — today the **successful commit**
(`EngineWeb.ActionCommandController`, `git_commit`). Never `fs.watch`: a watcher
is unbounded work triggered by anything — a dependency install, a build, and worse,
by the mirror's own writes, which is a loop —
and would run continuously on the user's machine without anyone having asked, which is the
opposite of what "local agent" should mean. The push is **fire-and-forget**:
no `from`, no `pending_execs` and no `mirror_sync_result`, because whoever
triggered it is in the middle of something else and the sync telemetry is point
7 of the ADR, from another session. A mirror failure becomes a local log, never an exception that
takes the runner down and never silence.

**It is NOT a `proposed_action`, and must not become one.** Writing the mirror is
configuration the user declared, not an agent asking to act — ADR
0147 is explicit about it, and syncing via a terminal command would fall into the scope
of [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) and become a
queue of routine approvals, eroding the ceiling that gives the click its meaning.

- **Where:** `apps/runner/src/espelho-guard.ts` (the three refusals, the double
  pass with the suffix preserved, the inherited TOCTOU caveat);
  `apps/runner/src/espelho.ts` (the git list, the one-direction copy, the
  `mkdir -p` only AFTER the guard); `apps/runner/src/guard.ts` (the three
  helpers are now exported — a single source of path comparison);
  `apps/runner/src/channel.ts` (`CAPACIDADES_DO_RUNNER` gains `espelho`,
  `MirrorSyncMessage`, `EspelhoConcedido`, `espelhoConcedidoDaResposta`);
  `apps/runner/src/index.ts` (`EstadoDoRunner.destinoDoEspelho`,
  `tratarMirrorSync` — the refusal of the non-granted destination);
  `apps/engine/lib/engine/runners/capacidades.ex` (`exigidas/2`/`conceder/3`
  and `destino?/1` — the destination, not the mode, is what requires);
  `apps/engine/lib/engine/runners/espelho.ex` (the own predicate, the
  `destino/1` of the join and the fire-and-forget `sincronizar/2`);
  `apps/engine/lib/engine/projects/project.ex` (`mirror_path` in the read
  schema); `apps/engine/lib/engine_web/channels/terminal_channel.ex` (the
  grant in the join reply and the `dispatch_mirror_sync`);
  `apps/engine/lib/engine_web/controllers/action_command_controller.ex` (the
  commit trigger)
- **Test:** `apps/runner/src/espelho-guard.spec.ts` (destination inside,
  destination containing, real symlink in `tmp` escaping through the destination
  itself and through a middle segment, `/base-outra` vs `/base`, the per-file
  target, `lstat` vs `stat`); `apps/runner/src/espelho.spec.ts` (real git
  repository: tracked + untracked-not-ignored, ignored left out,
  **file deleted at the source remains in the destination**, nested repository
  skipped, source symlink skipped, destination symlink refused, guard before
  the `mkdir`, folder without git failing named);
  `apps/runner/src/channel.spec.ts` (the destination coming in the join reply, the
  three declared capabilities, `mirror_sync` reaching the handler);
  `apps/runner/src/index-handlers.spec.ts` (`describe "tratarMirrorSync"` — the
  non-granted destination refused, the connection without a grant, the failure that does not
  throw, and the channel with no push back at all);
  `apps/engine/test/engine/runners/capacidades_test.exs` (the destination requiring
  the capability, the legacy binary refused, `destino?/1`);
  `apps/engine/test/engine/runners/espelho_test.exs` (the TWO preconditions
  and the ABSENCE of the third — `:pronto` with no container registered at all);
  `apps/engine/test/engine_web/channels/terminal_channel_test.exs`
  (`describe "o destino do espelho na concessão do join"` — the grant, the
  two refusals and the `mirror_sync` push);
  `apps/engine/test/engine_web/controllers/action_command_controller_test.exs`
  (the trigger: a successful commit fires, a failing commit does not fire)
- **ADR:** [0147](../adr/0147-agente-local-com-capacidades.md), points 2, 3, 4 and 8
- **Origin:** PHASE 28, session 6 (half B). The second named moment of point 8,
  "end of agent turn", was declared and **not** wired: the engine has
  two disjoint things with that name and neither is an unambiguous hook —
  `Engine.Agents.TurnoAssincrono.finalizar/1` closes the turn of the six
  conversational agents, which have no write tool in the workspace, and also
  fires on crash and on cancellation; `Engine.Dev.AgentIo.finish_task/3` is not an
  idleness boundary (it claims the next task in the same call) and what
  the dev agent writes lives in the worktree, which the mirror deliberately does not
  descend into. Choosing one would be inventing product where the ADR named a moment without
  naming a function

---

## The local agent becomes a USER service, and `status` does not collapse state (RN-518)

### RN-518 — `brabo-runner service install|uninstall|status` installs at USER level and never root; `uninstall` cleans the folder the UNIT records; `status` answers four states without collapsing any; Windows is a named refusal {#rn-518}

Session 7 of PHASE 28 and **point 5** of
[ADR 0147](../adr/0147-agente-local-com-capacidades.md). Until now the local agent
was **foreground only**: a process ended by SIGINT/SIGTERM, which dies
with the terminal and does not come back with the user's session. There was no
precedent at all — no mention of `systemd`, `launchd` or `LaunchAgent` in
`apps/runner/`.

**User level, ALWAYS — and root is a REFUSAL, not a warning.** `systemd --user`
on Linux, `LaunchAgent` on macOS. This is not a packaging preference: the
docblock of `apps/runner/src/guard.ts:9-31` declares *"the runner runs ON the user's
machine, with HIS privileges"* as the premise on which the product's three real
boundaries rest (authentication, approval pipeline,
consent) — and the `cwd` guard is best-effort **in writing**, precisely
because it is not what holds anything. A system service running as root
would break the invariant and leave the best-effort guard as the only thing between
an approved command and the machine's disk. That is why `install` with `uid` 0
**refuses naming the reason**, without writing any file and without running any
command: installing-and-warning would leave the wrong installation up, and the warning would be
read only once.

**Windows is OUT OF SCOPE, and the refusal is named.** The build matrix already
produces the Windows binary ([ADR 0112](../adr/0112-binario-standalone-do-runner-via-bun-build-compile.md)),
but a user service there is a **third mechanism** (OS Services with a
user account, or Task Scheduler at logon) — not a variation of the
two. The three subcommands answer naming the platform, saying that the
decision is declared, and pointing to the path that keeps working (running in
the foreground). Never a mute failure, never an "installed" that installed nothing.
Any other platform falls into the same refusal.

**One unit PER PROJECT, named by the `projectId`** — `brabo-runner-<id>.service`
/ `dev.brabo.runner.<id>` — because the server **already enforces one runner per
project**: a second `join` on the same `terminal:<projectId>` is refused by
`Engine.Runners.Registry`. Naming by FOLDER would allow installing two units that
can never be up at the same time, and the second would show up as a connection
failure instead of an installation error. Installing again, from another folder,
**overwrites**. `uninstall` and `status` reach exactly the same unit because
they derive the name from the SAME `projectId`, resolved by the SAME two sources in the
same order as the usual CLI (`--project`, otherwise `brabo-runner.config.json`), and
the folder comes from `resolverDir` of `guard.ts` — never a second rule. On Linux
the file goes where systemd **looks**, with its precedence:
`$XDG_CONFIG_HOME/systemd/user` when the variable is set, `~/.config/systemd/user`
when not — choosing only the second would make the unit be born where the manager never
looks, and the failure would show up as *"unit file does not exist"* on `enable`,
visible but for the wrong reason.

**The `projectId` becomes a FILE NAME, so it is validated here.** It comes from
two sources that are not the server (a typed flag and a file in the folder), and
a `--project ../../etc/systemd` would write outside the units directory. Only
letters, digits, `.`, `-` and `_`, up to 64 characters — a UUID, the real format of
every project of the product, passes whole. A runner path and a folder with a double
quote or a line break are also a named refusal: a line break in a unit
file is directive injection, not an edge case.

**A service authenticates with a DEVICE KEY, never with a token.** `install`
requires a valid `brabo-runner-device-key.jwk.json` in the folder and refuses without it,
ignoring `--token`/`BRABO_ACCOUNT_TOKEN` on purpose: writing an account token
inside a unit file would leave it on disk, readable by any
process of the user and surviving the shell that exported it — and this CLI **never
wrote a credential to disk** (the docblock of `auth.ts` has a test lock
against exactly that). [RN-434](#rn-434) runs the same, through the SAME function:
a service pointing outside `$HOME` on Linux is refused, because doing via a
unit what the CLI refuses to do via a flag would be getting around the rule through the
back door.

**`Restart=on-abnormal`, and never `on-failure`** (in the plist, `KeepAlive` with
`Crashed`, and never `SuccessfulExit`). The runner exits with 1 when the join was
**REFUSED** — invalid ticket, another runner on the project, a missing capability
([RN-514](engine.md#rn-514)) — or when it exhausted its own retry ceiling, and both
things are "stop and call a human". `on-failure` would restart a fatal refusal
in a loop, which is exactly what the CLI refuses to do on its own. Signal, OOM and
watchdog — what `on-abnormal` covers — are the only failure that restarting
fixes. The `PATH` goes **frozen** into the unit, with the cost declared in the
file itself: both managers give the service a minimal PATH, and the runner calls
`git` (the mirror, [RN-516](#rn-516)) and `docker` ([ADR 0137](../adr/0137-o-runner-sobe-o-container-do-projeto.md));
without it the service would come up perfectly and both functions would fail with "not
found". It is a snapshot, and it only changes by reinstalling.

**The TWO halves of the unit file do NOT have the same syntax, and
`WorkingDirectory=` goes WITHOUT quotes.** `ExecStart=` is parsed with *unquoting* and
word splitting — that is why each argument goes in quotes —, and
`WorkingDirectory=` **is not**: systemd takes the whole rest of the line as the
path. Treating the two as if they were the same cost an entire release: with
quotes the value no longer starts with `/`, the unit is refused at load
(`Loaded: bad-setting`, `WorkingDirectory= path is not absolute`) and **never
starts** — in both kinds, in no installation at all. The suite was green the
whole time, because each assertion asked back for exactly the wrong form: that is
why the proof is now made against `systemd-analyze --user verify`, the real
validator, and not against text. What REMAINS to escape is **one** character, and
it is not the space (the line goes whole, so `/home/eu/pasta com espaço` works
literally): it is `%`, because that directive goes through **specifier
expansion** — `/home/dan/50%off` becomes `/home/dan/50<id-do-os-release>ff`
with no error at all, and the service comes up in the wrong folder. `%%` is the way to say a literal
`%`. Reading back accepts **both** forms, and that is a deliberate
debt to whoever already has a broken unit on disk: `status` and `uninstall`
need to keep reaching its folder. Whoever is in that state fixes it
**by reinstalling** — `install` overwrites the whole file.

**And there is a THIRD syntax in the same file: `Environment=` (AT-095).** It is
a LIST of space-separated assignments, with *unquoting* and C-style
escaping, and it also expands specifiers. Written raw — as the
`XDG_CONFIG_HOME` of the MACHINE unit and the `PATH` of both kinds came out —,
`Environment=XDG_CONFIG_HOME=/home/dan/50%off com espaco` reached the service
as `/home/dan/50popff`: `%o` expanded and `com`/`espaco` discarded by the
word splitting. The unit loads, `verify` approves, the service comes up — and the
agent looks for the base and the key in a folder that does not exist, silently. That is why the
WHOLE assignment goes in quotes (`Environment="VAR=valor"`), with `\` and `"`
escaped by backslash and `%` as `%%`; `$` is not escaped there (`Environment=` does not
expand variables). The `--dir` of `ExecStart=` had the same class and went along:
each argument still goes in quotes, and now `\` becomes `\\`, `%` becomes `%%` and `$`
becomes `$$` (the variable substitution of `ExecStart=`). A line break in
`PATH`/`XDG_CONFIG_HOME` is REFUSED before writing — in a unit file it
is a new directive, not a value. None of this changes the READING back: it only reads the
`WorkingDirectory=`, and neither of the two environment values is read from disk. The
proof is the EFFECTIVE VALUE, not `verify` (which approves the broken form): the
very `systemd --test --user --unit=<u>`, over a temporary units
folder, dumps the resolved configuration, and the test compares what
systemd UNDERSTOOD with what was written.

**An activation that fails does NOT delete the file, and does not say "installed".** Writing the
unit and activating it are two steps, and the manager may not be there
(`systemctl` out of the PATH, `launchd` refusing). The file **stays** — it is what the
person needs to finish by hand — and the answer is a third outcome, which
names the pending command and the reason. Deleting the file would turn "I could not
activate" into "nothing happened", which is false.

**`uninstall` removes the THREE, and the folder comes from the UNIT — never from the `cwd`.** The ADR is
explicit: the unit file, the `brabo-runner.config.json` and the
`brabo-runner-device-key.jwk.json`. The last two live in the runner's folder, and
the folder that matters is the one that was **INSTALLED**, not the one from which the person
happened to type the command — that is why the `WorkingDirectory` is read back from the
unit file itself, which is the record of what was installed. **Without a unit there is
no record**: the two files are only removed with an explicit `--dir`, and the
message says why. Guessing by the `cwd` would delete the key of a project that
nobody asked to remove. A failing deactivation becomes a **warning** and the file is
removed anyway — a unit the manager no longer recognizes is no
reason to leave the file behind.

**And `uninstall` SAYS what it did not do: the key left the disk, not the
server.** The corresponding public key remains in `runner_device_keys`, and
revoking it is something else (`DELETE /projects/:projectId/runner-device-keys/:deviceKeyId`,
[ADR 0147](../adr/0147-agente-local-com-capacidades.md) point 6). A "removed"
that let the person think they had revoked would be worse than removing nothing. The
LaunchAgent log is also **not** deleted: it is the user's record of
what happened, and deleting it was not asked for.

**`status` answers FOUR states, and they do not collapse** ([RN-088](web.md#rn-088)):
*not installed*, *installed and running*, *installed and stopped*, and *installed and
I could not ask*. The first answer comes from the **DISK** — is there a unit
file? —, and that is why it stays right on a machine where the manager
does not exist; only afterwards is the manager asked. A `spawn` that failed (binary
absent from the PATH) **never** becomes "the manager said no": they are different
answers, separated at the source, and a word this CLI does not know how to interpret
also falls into "could not ask" instead of becoming "stopped" by guesswork.
Each state has **its own sentence** and **its own exit code** (0 / 3 / 4 / 5,
with 1 and 2 left out because they already mean generic failure and usage error in this CLI):
a single `exit(1)` for the three "not running" ones would collapse through the code
exactly what the sentence separates.

**Nothing here is a `proposed_action`.** It is the user running a command on their own
machine, about their own service — not an agent asking to act. `service`
is dispatched **before** `lerArgumentos`, because none of the three subcommands
connects to anything and what matters most (`status`) needs to work in a folder
whose configuration is broken, which is precisely when someone asks.

- **Where:** `apps/runner/src/servico.ts` (new — the vocabulary, the two
  platforms as answers to the SAME five questions, the refusals, the four
  states and `CODIGO_POR_ESTADO`); `apps/runner/src/servico-sistema.ts` (new —
  the real disk and `systemctl`/`launchctl` adapter, separated so that the
  guarantee "`servico.ts` does not touch `node:fs`/`node:child_process`" stays
  verifiable); `apps/runner/src/index.ts` (`comandoDoRunnerParaServico`,
  `rodarSubcomandoDeServico`, the dispatch of `service` in `main()` before
  `lerArgumentos`, and the new line in `uso()`)
- **Test:** `apps/runner/src/servico.spec.ts` (new — happy path on both
  platforms with the real content of the unit/plist; root refused without writing
  anything; Windows named; without a device key; a `projectId` that would become a
  path; absent `systemctl` leaving the file and saying it did not activate; the
  RN-434 passed through; `uninstall` reading the folder from the unit and not from the `cwd`, without a unit
  and without `--dir` touching no file at all, and the failing `disable` becoming a
  warning; the FOUR states of `status` plus the unknown word and the three
  outcomes of `launchctl`; and the four distinct exit codes);
  `apps/runner/src/index.spec.ts`
  (`describe "brabo-runner service é despachado antes de exigir credencial"` —
  a REAL process in a folder without any credential: `status` answers 4 instead
  of the usage block, and an unknown subcommand falls into the `service` usage);
  `apps/runner/src/servico-systemd.spec.ts` (the GENERATED unit asked of the
  real `systemd-analyze --user verify`, in both kinds, with a folder that
  has a space and a folder that has `%` — plus the OLD form, in quotes, being
  REJECTED by the same validator; without systemd on the machine the file SKIPS
  naming the reason, never passes silently nor fails because of the environment) — and,
  since AT-095, `describe "o valor EFETIVO de Environment= é o valor
  gravado"` and `describe "o --dir do ExecStart= e o WorkingDirectory= também
  chegam intactos"`, which ask the dump of `systemd --test --user` for the
  RESOLVED value of `XDG_CONFIG_HOME`, `PATH`, `WorkingDirectory` and of the `--dir`
  with `%`, space, quotes, backslash and `$`, and pin the old form of
  `Environment=` as delivering ANOTHER value; `servico.spec.ts` gained the two
  line-break refusals and the project unit without `XDG_CONFIG_HOME`
- **ADR:** [0147](../adr/0147-agente-local-com-capacidades.md), point 5
- **Origin:** PHASE 28, session 7. Declared and NOT done: **BRB-031** (the
  manual `chmod +x` of the flow of [ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md))
  does **not** die here — whoever runs `brabo-runner service install` already had to
  make the binary executable to get to the command, and ADR 0147 ties
  that side effect to the installation coming from the versioned bootstrap of
  [ADR 0146](../adr/0146-base-consentida-no-bootstrap.md), which this delivery does not
  touch. Also out: any `start`/`stop`/`restart` subcommand (what
  manages the lifecycle is the OS service manager, and duplicating it in the
  CLI would create a second source of truth about the state) and Windows, above

---

## The flag that turns an agent on has to REACH the process (RN-540)

### RN-529 — `brabo-runner` is born with a local BASE, each project is a subfolder of it, and the base NEVER invalidates `--dir` {#rn-529}

The local agent had no notion of a base. The only root was `--dir`, resolved by
`resolverDir` against `INIT_CWD ?? process.cwd()`; without the flag, the root was the
`cwd` itself. `estado.dir` is **one** path, singular — that of the project of that
connection —, and there was no constant, variable or field saying where the
projects live on that machine. The word "base" only appeared in comments.

**The base is LOCAL, and never arrives over the network.** It is the broker's design
([ADR 0144](../adr/0144-a-segunda-raiz-do-broker.md)) applied to the local agent:
whoever has the root is whoever executes, and what crosses the network is the **relative
segment**. There is no base field coming from the server, and
`resolverPastaDoProjetoNaBase` refuses an ABSOLUTE segment lexically — never
"accepts it and reinterprets".

**Two sources, and the flag wins.** `--base <caminho>` on the command line, and
`$XDG_CONFIG_HOME/brabo/runner.json` (otherwise `~/.config/brabo/runner.json`), which
is where the installer ([ADR 0150](../adr/0150-instalador-de-uma-linha.md)) writes it. The
file belongs to the USER and not to a project on purpose: the base is **one** for N
projects, and storing it in `brabo-runner.config.json` — which is per project, lives
INSIDE the project folder and is written by the BROWSER — would give N copies of the same
value with N chances of diverging. An environment variable was refused for two
reasons: `BRABO_PROJECTS_BASE` already exists and is the base of `mounted` projects on the
SERVER side ([RN-500](api.md#rn-500)), the namespace collision that
[ADR 0141](../adr/0141-base-unica-dos-projetos-montados.md) refused in writing; and
under `systemd --user`/LaunchAgent ([RN-518](#rn-518)) the environment is the unit's, not
that of the shell of whoever installed. The flag alone would not be enough either: the base would go into the
`ExecStart` of each unit, and changing it would require rewriting them all.

**`--dir` keeps meaning exactly what it always meant, and the base
does NOT enter its validation.** This is the api's prohibition transposed:
`project-workspaces-root.ts` forbids in writing that the base rule go down into
`caminhoDeWorkspaceLocalValido`, because that predicate runs on every READ and
a legacy project outside the base would blow up when read — *"the base is a rule of
CREATION and CONVERSION; the lexicon is forever"* ([RN-501](api.md#rn-501)). On this side
it holds the same: `--dir` stays validated by `validarDirDentroDoHomeNoLinux` +
`garantirDiretorio` ([RN-434](#rn-434)/[RN-435](#rn-435)), and being OUTSIDE the base
does not invalidate it. Without this the base would be `breaking/` with no gain, against the
legacy binary of [RN-514](engine.md#rn-514). The base decides **only** where a NEW project folder
is born.

**The guard reuses the rule; a fourth copy is not born.** `base-guard.ts` is the
THIRD sibling of `guard.ts`, next to `espelho-guard.ts`: it imports
`semBarraFinal`, `dentroDoEscopo` and `realpathMaisProximo` — the three helpers that
stopped being private precisely for this ([RN-516](#rn-516)) —, repeats the
lexical-then-`realpath` **double pass** of `validarCwdDentroDaRaiz`, and reuses
`validarDirDentroDoHomeNoLinux` WHOLE to require the base inside `$HOME` on
Linux (a base inside `$HOME` implies every subfolder inside it, so the two
checks keep agreeing). From the loop refusal of `espelho-guard.ts` it reuses
what is rule — `dentroDoEscopo`, comparison by SEGMENT and never raw `startsWith`,
so `/base-outra` does not count as inside `/base` — and **not** the
`recusarLaco` function, which throws `DestinoDeEspelhoInvalidoError` and would report a
malformed base as a mirror problem. The same lesson as [RN-515](api.md#rn-515): one reuses
the rule, not the message.

**The loop here is ASYMMETRIC, and that is the finding.** In the mirror both directions
are a defect. Here the project folder INSIDE the base is the NORMAL arrangement — it is
literally what "each project is a subfolder of it" means. It is the opposite
direction that is a loop: a base inside this project's root (or equal to it) would make
every new project be born inside this one, with this one's git and mirror starting to
sweep the others. Only that one is refused.

**A refusal has a different disposition per SOURCE, and none is silent.** An absent
base is the NORMAL state (`null`, the legacy intact). A base from the FLAG that does not
pass the guard exits with code 2 — it is an explicit request typed just now and
impossible to honor, the same disposition as a refused `--dir`. A base from the FILE
that does not pass is stated on `stderr`, names what is lost ("it will have nowhere to create the
folder of a new project") and the runner **continues without a base**: taking down a local
agent serving a project because of a configuration it does not even use yet
would be disproportionate. A file that exists and does not declare `base` is absence, not
refusal — it is configuration WITHOUT a consented base, not broken configuration. And the
startup line states the base in BOTH states, because omitting "none" would leave
someone looking for why the folder did not appear.

**This is BEST-EFFORT, and the TOCTOU caveat is inherited in writing** from
`guard.ts` and `espelho-guard.ts`: a symlink created AFTER the check and BEFORE the
`mkdir` is not covered, nor a link whose target does not exist yet. The security
boundary is still authentication + approval pipeline + the consent
of whoever ran the CLI.

Nothing here CREATES a folder: the base validation does not require it to exist (what creates it
is the installer, and it is the same reasoning as
[ADR 0142](../adr/0142-validacao-de-workspace-montado-adiada.md) — validating disk where
only the lexicon is knowable would prevent consenting to a base before it exists). The
only disk question is the one that is never ambiguous: a path that ALREADY exists and is not
a folder will never become one.

- **Where:** `apps/runner/src/base.ts:69` (`caminhoDoArquivoDeBase`, the
  XDG precedence of `servico.ts`), `:106` (`lerBaseConsentida`, the four
  outcomes) and `:181` (`resolverBaseConsentida`, the order of the sources and the origin
  of the refusal); `apps/runner/src/base-guard.ts:128`
  (`validarBaseDeProjetos`), `:209` (`recusarLacoComARaiz`, the asymmetric loop)
  and `:296` (`resolverPastaDoProjetoNaBase`, the subfolder and the double pass);
  `apps/runner/src/index.ts:321` (the resolution in `lerArgumentos`, AFTER
  `garantirDiretorio` and without touching the validation of `--dir`) and `:452`
  (`EstadoDoRunner.base`)
- **Test:** `apps/runner/src/base-guard.spec.ts` (happy path with a base that
  does not exist yet; the sibling with a common prefix that is NOT confused; `..`, `/`,
  file, `$HOME` on Linux; the loop in both directions, including the one built
  by a REAL symlink; the absolute segment, with `..`, the one pointing to the base
  itself and the one escaping through a link in the middle);
  `apps/runner/src/base.spec.ts` (the XDG precedence, the four outcomes of the
  read, the flag beating the file, and the refusal carrying the ORIGIN)
- **ADR:** [0151](../adr/0151-base-consentida-no-runner.md) points 1 and 2
- **Origin:** PHASE 29. The `workspace_create`/`workspace_create_result` pair and the
  `workspace` capability (points 3 to 6 of the ADR), declared here as not
  done, CLOSED in [RN-532](#rn-532) — the base came to have a consumer.
  Still declared and NOT done: the `install.sh`, which is what will write the file
---

## The local agent's base gains a consumer: the project folder is born through the channel (RN-532)

### RN-532 — `workspace_create` creates the folder under the LOCAL base, and what WRITES is still the `workspace_confirm` that already existed {#rn-532}

[RN-529](#rn-529) gave `brabo-runner` a BASE and validated it, and declared in
writing that **nothing consumed it**. This is the consumer: the
`workspace_create`/`workspace_create_result` pair, the `workspace` capability and an
own predicate in the engine.

**The pair is REQUEST WITH REPLY, and could not be modeled on
`workspace_confirm`.** That one is UNIDIRECTIONAL: `handle_in("workspace_confirm",
…)` answers `{:noreply, socket}` and pushes nothing back. Whoever requests the
creation of a folder needs to know whether it appeared, and with what path — so the
mold is that of `exec`/`exec_result` (`despachar_pedido` + `pending_execs` +
`responder_pedido_pendente/3`), the same as the three container pairs. A record of
precision, because the name circulated: **`workspace.verified` does not exist** in this
repository — what exists is the `project.workspace_verified` event and the column
`workspace_verified_at`.

**Only the SEGMENT crosses the network.** The base is local and never comes from the server
(RN-529); the engine sends `projectId` and the RELATIVE segment, and it is
`resolverPastaDoProjetoNaBase` — on the runner side, which has the root — that
joins them. It is the invariant of [ADR 0130](../adr/0130-broker-de-container.md)/
[ADR 0144](../adr/0144-a-segunda-raiz-do-broker.md) applied to the local agent: whoever
has the root is whoever executes. An ABSOLUTE segment is refused by LEXICON, never
accepted and reinterpreted.

**The confirmation REUSES `workspace_confirm`, and that is what saves an entire
front.** Having created the folder, the runner pushes the `workspace_confirm` that
has existed since [RN-423](#rn-423) — and it is that which writes, through the path already
built: channel → engine → internal HTTP → `ConfirmProjectWorkspaceUseCase`,
which revalidates the lexicon, is idempotent and stamps `workspace_verified_at`.
**No new write route is born**, the engine still does not write the
table, and the only path that stamps remains a single one. The ORDER is the
mechanism, not aesthetics: the two pushes reach the SAME channel process, in
order, and the `workspace_confirm` handler is synchronous — sending it BEFORE the
result is what guarantees the stamp already exists when the requester unblocks from the
`receive`.

**The `workspace` capability enters the vocabulary in the session in which the code
enters**, on both sides ([ADR 0151](../adr/0151-base-consentida-no-runner.md)
point 4). [RN-514](engine.md#rn-514) had made the opposite bet with `espelho` — a name
on the server without code on the other side — and it only paid off because someone
called it in; repeating it would be repeating the silent defect the negotiation exists to
prevent.

**It is the only one of the four whose declaration depends on the STATE of that execution,
and not on the binary's version.** The runner only declares it when it has a consented base
(`capacidadesDoRunner`), and it is through that line — and no other — that the
server KNOWS a base exists: the engine does not read the user's disk and has no
table of bases. Nobody REQUIRES it at join, and that is a decision: requiring it in
`runner` would make every binary without a base stop connecting, which is `breaking/` and
MAJOR, for a function that project may never use. It is opt-in from the
other end — whoever has a base declares it, and only whoever declared receives the message.

**Its OWN predicate, and `RunnerReadiness` stays byte for byte.**
`Engine.Runners.PastaDoProjeto` has TWO preconditions — runner connected, base
consented — and the ADR literally adopts the refusal that `Engine.Runners.Espelho` had already
written: a shared function with a "skip container" flag is precisely
the path by which the third precondition falls BY ACCIDENT for `exec` in a
future refactoring ([RN-507](#rn-507)/[ADR 0145](../adr/0145-docker-pre-requisito-do-runner.md)
exists so that it does not fall). And here the third would be worse than unnecessary: it is
**circular** — a `runner` project only comes to have a REGISTERED `running` container
after the runner itself starts it, and the container starts over the folder
this message exists to create.

It also does NOT ask for `workspace_verified_at` (unlike the mirror: here
it is the RESULT, and requiring it would make the message unreachable precisely in the
case it was made for) nor the `execution_mode` (the second source of the same
rule — whoever has a consented base is the local agent, and a local agent only exists
where it exists).

**Where each precondition is answered, and why they are not both in the same
place.** "Runner connected" belongs to the `Registry`, and the module answers it on its own.
"Base consented" is a property of that CONNECTION: it lives in `socket.assigns` and
**never in a table** (the rule of
[ADR 0147](../adr/0147-agente-local-com-capacidades.md)), so what answers it is the
dispatch — the channel refuses BEFORE pushing and returns `motivo: "sem-base"` through the
SAME `ref`, in the format the module already expects, exactly as `dispatch_exec`
does with the 126. Never a timeout, which is how the silent defect would show up. The
two reasons, the two messages and the order in which they apply live in the module, and
nowhere else.

**A NAMED error, and five reasons that do not collapse.** `sem-base`, `segmento`,
`nao-e-pasta`, `mkdir` and `git` travel as `motivo` alongside the `erro` text —
separated on purpose: the text is for a human to read, the reason is for the other
side to DECIDE, and collapsing them would force the engine to match a pt-BR substring. Only
`sem-base` becomes its own atom in the engine (`:sem_base`), because only it has its own
fix; the other four are `:recusado` with the runner's message. The failing
`init`/clone is a named error and **never a plan B**: a folder without
`.git` would break the dev agent's worktree, the mirror and the user's own versioning
in a place far from the cause.

**Idempotent, and the three outcomes do not collapse.** `mkdir -p` is already idempotent;
what needed a decision was the repository — a folder that is ALREADY a repository
comes back as SUCCESS, with the `ja-era-repositorio` mode, never an `init` on top
(which would lie about what happened) nor a clone (which would fail due to a non-empty
folder and turn "it was already ready" into an error). It is the same disposition as
`ConfirmProjectWorkspaceUseCase`, and for the same reason: the message can arrive
twice.

**`estado.dir` does NOT change.** The folder created is the project's from the
SERVER's point of view — and it is `workspace_confirm` that records it there. The root `guard.ts` uses
to contain an approved command remains that of this execution: changing it at
runtime would move a containment boundary because of a network message, and
this CLI never does that.

**This is NOT a `proposed_action`, and no ceiling gains an exception.** Creating the folder of the
project the user just asked for is CONSENTED configuration, not an agent
asking to act — the same line the mirror already established
([RN-516](#rn-516)). Doing it through a terminal command would fall into the scope of
[ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) and become a
queue of routine approvals, eroding the ceiling that gives the click its meaning.

- **Where:** `apps/runner/src/pasta-do-projeto.ts:132` (`criarPastaDoProjeto` —
  the guard→disk→versioning order and the five reasons);
  `apps/runner/src/channel.ts:173` (`WorkspaceCreateMessage`), `:194`
  (`WorkspaceCreateResultMessage`), `:476` (`CAPACIDADE_DE_WORKSPACE` and
  `capacidadesDoRunner`); `apps/runner/src/index.ts:1027`
  (`tratarWorkspaceCreate` — the order `workspace_confirm` before the result);
  `apps/engine/lib/engine/runners/pasta_do_projeto.ex:107` (`verificar/1`) and
  `:134` (`criar/3`); `apps/engine/lib/engine/runners/runner_router.ex:181`
  (`create_workspace/3`); `apps/engine/lib/engine/runners/capacidades.ex:95`
  (`workspace` in the vocabulary, and out of the legacy);
  `apps/engine/lib/engine_web/channels/terminal_channel.ex:666`
  (`handle_info({:dispatch_workspace_create, …})`, the named refusal) and `:380`
  (`handle_in("workspace_create_result", …)`)
- **Test:** `apps/runner/src/pasta-do-projeto.spec.ts` (happy path with
  `init` and with clone; idempotency proven with the REAL versioning
  binary; the five reasons, with distinct texts, and the folder that is NOT born outside
  the base); `apps/runner/src/index-handlers.spec.ts` (the ORDER
  `workspace_confirm` → `workspace_create_result`; without a base, no confirm;
  a dropped connection pushes nothing); `apps/runner/src/channel.spec.ts`
  (`workspace` only declared with a base; payload without `segmento`/`projectId`
  discarded; malformed `env` becoming `undefined`);
  `apps/engine/test/engine/runners/pasta_do_projeto_test.exs` (the two
  preconditions WITHOUT a database — the assertion is the pure `ExUnit.Case` —, the exact
  payload, the four reasons and the success without a path that does not become success);
  `apps/engine/test/engine/runners/runner_router_test.exs` (the roundtrip and the
  timeout); `apps/engine/test/engine/runners/capacidades_test.exs`
  (`workspace` declarable, never in the legacy, never required);
  `apps/engine/test/engine_web/channels/terminal_channel_test.exs` (the refusal
  named through the same `ref`, and nothing pushed to the runner)
- **ADR:** [0151](../adr/0151-base-consentida-no-runner.md) points 3 to 6
- **Origin:** PHASE 29, session 8. Declared and NOT done: what CALLS
  `PastaDoProjeto.criar/3` — the web→api→engine path belongs to session 9 —, and the
  `install.sh` that writes the base file, which belongs to another front

---

## The local agent opens N connections, one per project (RN-544, PHASE 30)

### RN-544 — The local agent opens N connections, one per project discovered by the route — and the retry ceiling and the join refusal stop belonging to the PROCESS {#rn-544}

[RN-543](produto.md#rn-543) opened `GET runner/projects` and was left without a caller. The
`brabo-runner` still required `--project`: `index.ts` had
`if (!projectId) uso()`, and there was no execution without a project. This RN is the
consumer — and it is the half of [ADR 0154](../adr/0154-chave-de-dispositivo-de-maquina.md)
that proves its finding: *"a single process that opens N connections — one per
project it serves — satisfies items 1, 2 and 3 byte for byte"*. **Nothing in the
engine changes**: the `terminal:<projectId>` topic, the socket id and the ticket
describe a CONNECTION, and N connections remain N connections. The refusal of a
second runner on the same project stays intact, and it is a real guarantee, not an accident.

**Two modes, and the old one stays byte for byte.** `--project`/`--dir` with a
project credential — including the browser flow
([ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md),
[RN-464](api.md#rn-464)) — is the usual path: ONE connection, and its outcome
remains that of the process. The new mode requires BOTH things, and for different
reasons: a MACHINE credential, because that is what the route accepts; and a **consented
base** ([RN-529](#rn-529)), because without it there is nowhere to derive each
project's folder from, and inventing one would be writing on the user's disk a path
they did not consent to. Without a base, running without `--project` still falls into `uso()`,
saying which of the two was missing.

**The runner does not know what kind its own key is, and that is a decision.** On
disk, machine key and project key are the SAME file: a private JWK
with a `kid` ([RN-475](web.md#rn-475)). What knows is the SERVER, which finds the public key
by that `kid`. So the CLI asks, and the named 403 of `PatAuthGuard` becomes
`CredencialNaoEDeMaquinaError`, with the api's words and the fix
(`--project`) — never a generic "connection failure". A local guess would be
a second source of truth about the same thing, and the local one would be the wrong one. The
JWT of that call goes **without** the `projectId` claim, because the guard compares
`payload.projectId !== request.params.projectId` and on a route without a project both
need to be `undefined`.

**N connections require N states.** Four fields of `EstadoDoRunner` are PER
PROJECT — `dir`, `canalAtual`, `containerAtivo`, `destinoDoEspelho` — plus
`gerenciadorPty`, which is born from `dir`. A shared state would make one project's
`docker exec` run in ANOTHER's container, and one's PTY open in
another's folder. `docker` and `base` belong to the MACHINE and go in as the SAME value in
all of them, never copies that could diverge. The type did not change, and the handlers
(`tratarExec`, `tratarMirrorSync`, `tratarWorkspaceCreate`…) did not change a
line: the mirror ([RN-516](#rn-516)) and `workspace_create`
([RN-532](#rn-532)) were already per project and already traveled in the `join` grant
of that connection, which is exactly what makes them correct with N.

**The ceiling and the refusal become the PROJECT's.** They were the process's: a join refusal gave
`process.exit(1)`, and an exhausted `TETO_DE_TENTATIVAS_SEGUIDAS` too. With N
connections, killing everything because of one would take down the agent for all the projects
that are working. So each project has its own loop and counter; a
project that refuses or exhausts **ends on its own, NAMED**, and the others continue —
and only when NONE is left does the process exit with 1, with a summary stating the outcome
of each one. Every loop log is prefixed by the project's name: with N
interleaved loops, an ownerless "connection failure" is the form silence takes when
there are N of something. In `projeto` mode the old disposition stays identical, and by the same
reasoning inverted: with ONE connection, there is nothing left to serve.

**The list is queried ONCE, at start.** Re-querying periodically was
considered and refused: it costs a recurring call for a rare event, and the real
price is not traffic — it is that a list that comes back SMALLER is ambiguous (project
deleted, mode converted, role revoked, or a transient 500 disguising itself as
the three), and taking down a LIVE connection because of that ambiguity
would trade a right state for a guess. The process **SAYS** so when it starts, and the
gesture to pick up a new project is reconnecting the agent — a single command, with the
user service of [RN-518](#rn-518).

**An EMPTY list is a NORMAL state, and the exit is 0.** It is the state of every
freshly installed machine: the installer brings up the agent before any project exists
([ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md)). It is not an error, so
it is not an error code — and `Restart=on-abnormal` ([RN-518](#rn-518)) does not
bring it back up, which is right: there is nothing to bring back. Staying up with zero connections
would be an "active" service that does nothing, and the unit's `status` would start to
lie.

**Each project's folder is `<base>/<workspaceDirName>`, through the guards that already
exist.** `resolverPastaDoProjetoNaBase` (the SAME one `workspace_create` uses,
and for the same reason: the name came over the network), plus
`validarDirDentroDoHomeNoLinux` ([RN-434](#rn-434)) and `garantirDiretorio`
([RN-435](#rn-435)) — no fourth copy of the rule is born. Creating the folder is
RN-435 applied to a DERIVED path instead of a typed one; what does NOT happen
here is `git init`/clone, which remains `workspace_create`
([RN-532](#rn-532)). A project whose folder is refused leaves the plan named and
does not take down the others. `OpcoesDaBase.raizDoProjeto` accepts `null` in machine
mode: without `--project` there is no `--dir`, the loop refusal is left **without a subject**
(every root is derived from the base, so "the base inside a project's root" has
no way to be built), and passing the base itself there would be worse —
`dentroDoEscopo(base, base)` is true and every base would be refused.
- **Code:** `apps/runner/src/index.ts` (the gate in `lerArgumentos`,
  `lerArgumentosDeMaquina`, `manterConexaoDoProjeto`, `criarEstado`,
  `rodarComoAgenteDeMaquina`); `apps/runner/src/projetos.ts`
  (`listarProjetosDoRunner`, `planejarConexoes`,
  `CredencialNaoEDeMaquinaError`); `apps/runner/src/auth.ts`
  (`assinarDescobertaComChaveDeDispositivo` — the JWT without the `projectId` claim);
  `apps/runner/src/base-guard.ts` (null `OpcoesDaBase.raizDoProjeto`)
- **Test:** `apps/runner/src/projetos.spec.ts` — happy path of the route and of the
  plan, the 403 becoming its OWN error, a response outside the contract, and the segment
  that escapes the base being refused WITHOUT taking down the neighbor (including by
  symlink, in the second pass); `apps/runner/src/index.spec.ts` — the GATE in the
  real process (without a base, `uso()` with the reason; with a base, the refusal comes
  from the credential); `apps/runner/src/base-guard.spec.ts` — a null `raizDoProjeto`
  does not loosen any other refusal
- **Gap DECLARED, CLOSED later by [RN-552](api.md#rn-552):** when this RN
  closed, nobody CREATED a machine key (it was `install.sh`, ADR 0155 point
  4), so the new mode was only exercisable with a key registered by hand — the
  half RN-543 already declared. The `apiUrl` in machine
  mode comes from `--api-url`/`BRABO_API_URL`/default, and **not** from
  `brabo-runner.config.json`, which is per PROJECT: an installation on a different port or
  host needs the flag in `ExecStart`, and what writes it is the per-machine
  unit, which is session 4 of this phase. And the unit is still PER PROJECT —
  this PR changes the PROCESS, not the service
- **ADR:** [0154](../adr/0154-chave-de-dispositivo-de-maquina.md)
- **Origin:** PHASE 30, session 3 —
  [the phase's scope](../explanation/fase-30-runner-por-maquina.md)

## The MACHINE unit, coexisting with the per-project ones (RN-545)

### RN-545 — `service install --machine` installs ONE unit for the machine, and the two kinds do not overlap {#rn-545}

[RN-544](#rn-544) made the machine agent exist as a PROCESS — N connections,
one per project discovered by the route — and declared in writing what was missing:
*"the unit is still PER PROJECT; this PR changes the PROCESS, not the service"*.
This RN is the other half, and it is the fifth and last of the five couplings
[ADR 0154](../adr/0154-chave-de-dispositivo-de-maquina.md) measured
(`apps/runner/src/servico.ts:264,391`). The other four are already closed or
declared untouchable: items 1, 2 and 3 describe a CONNECTION and N connections
satisfy them byte for byte, and item 4 closed in [RN-543](produto.md#rn-543).

**The machine unit's name cannot collide with any `projectId`, and it does not
collide by construction.** `brabo-runner.service` / `dev.brabo.runner`, without a
suffix, against `brabo-runner-<projectId>.service` /
`dev.brabo.runner.<projectId>`. `PROJECT_ID_VALIDO` requires **at least one
character**, so the project name always has a `-` (or a separating `.`,
in launchd) where the machine one ends — the two never produce the same string.
It is locked by a test, and not by reading the regex.

**The platform layer is now keyed by KIND, not by
`projectId`.** Six of the eight members of `PlataformaDeServico` received
`projectId: string`; they now receive `AlvoDaUnidade`, a discriminated type
(`{especie:'projeto', projectId}` | `{especie:'maquina'}`) — and never
`projectId: string | null`, because with the null each member would decide on its own
what to do with it and the compiler would demand nothing. `PlanoDeInstalacao` becomes a
union for the same reason: the three fields of the project plan lose meaning on the
machine, where there is no project, there is no `--dir` (each root comes from the base) and the api cannot
come from a file that is per project. `caminhoDaUnidade` went DOWN from a member
to a function, because the two platforms answered the same thing — folder plus
name — and keeping two identical implementations was the chance for them to diverge
when the second kind arrived.

**The discriminator is the `--machine` flag, and NEVER the absence of `--project`.** The
ADR 0154 point 5 wrote *"`service install` without `--project` installs the machine
unit"*, and that was measured in this session and could **not** be implemented to
the letter: `resolverProjeto` has TWO sources, and today's normal path is running
`install` without any flag from inside the folder the browser configured — it is
`brabo-runner.config.json` that answers. Treating "without `--project`" as "machine"
would silently convert the installation of whoever already uses the product, which is exactly
what point 5 of the same ADR promises not to do. So the new kind is **explicit
opt-in**, the two project sources stay byte for byte, and `--machine` together with
`--project` is a named refusal instead of an invented precedence.

**`install --machine` refuses more than the project half, and the two refusals
of its own are measured.** The first: the folder cannot have
`brabo-runner.config.json`. `lerArgumentos` resolves the `projectId` from that
file when `--project` is missing, and machine mode is precisely "without
`projectId`" — a machine unit whose `WorkingDirectory` has that file
would bring up the process in PROJECT mode, silently, serving ONE project and
calling itself the machine's agent. The second: without a **consented base**
([RN-529](#rn-529)) the machine agent exits in `uso()` on the first boot
([RN-544](#rn-544)), and writing a service that never starts is the "wrong installation
left up" this module refuses everywhere — the base comes in INJECTED
(`DependenciasDeInstalacao.resolverBase`), like the other four dependencies,
so that `servico.ts` keeps reading neither disk nor environment on its own.

**The unit freezes `XDG_CONFIG_HOME`, and never the base's VALUE.** It is the same decision
as the `PATH` of [RN-518](#rn-518), with a bigger consequence: it is that variable that
decides WHERE the base file lives (`base.ts`), and `systemd --user` does not pass on the
environment of the installer's shell — without it, a user with the variable pointed
outside `~/.config` would have the service reading the wrong base, or none. The
base's value is left out on purpose: changing it remains editing the file and
restarting, never reinstalling, which is what the docblock of `base.ts` already defended when
rejecting "only the `--base` flag".

**The machine unit's `apiUrl` reads `BRABO_API_URL`, and the project one does not.** The
precedence of the PROJECT plan stays byte for byte (`--api-url` › that folder's config
› default), because there a file answers. In the machine one that
file is per project and does not serve, so without the variable the only alternative to
`--api-url` would be the `localhost` default — installing from a shell with
`BRABO_API_URL` set would silently generate a unit pointing to the wrong
place. It goes into `ContextoDoServico` (`apiUrlDoAmbiente`), never read
directly from `process.env`.

**`install` REFUSES when the other kind is already installed, and nothing is
removed.** The machine agent serves EVERY project in `runner` mode of the key's
owner; adding a per-project unit to it (or the opposite) puts two processes
competing for the same `terminal:<projectId>`, and the server denies one of the two —
probably the one the person just installed, which is the worst possible order
to discover the problem. It is a refusal by the SAME criterion as the root refusal that already
lives in that file: *"installing and warning would leave the wrong installation up, and the
message would be read only once"*. The unit that already exists stays intact, the message
names the `uninstall` of each one, and **there is no `--force`** — a flag that knocks down
a guard whose symptom is silent brings back the silent symptom. This does NOT
contradict point 5 of the ADR: what it guarantees is that an already installed per-project unit
keeps working, and it does, byte for byte; what is refused is
creating the overlap NOW.

**`status` answers about the asked kind, and the four states do not become
eight.** The exit code is still that of the ASKED unit
([RN-088](web.md#rn-088)) — summing the two would erase which one is asking for attention, in the
same way summing the five decision queues would erase which queue is which. The
coexistence shows up in TEXT, and it is an answer from the **DISK**: the units of the other
kind are listed by name, without asking the manager the state of each one,
and the output SAYS it did not ask. It is point 5 of ADR 0154 fulfilled —
*"letting six processes compete for three projects silently"* is the defect
that block exists to prevent. Without `--machine` and without a resolvable project, the
main one is the **machine** unit (the only one whose name needs no argument) and
the output names `--project` for whoever wanted the other; before this RN the same
input answered "needs to know WHICH project", which is a question and not an
answer for whoever has exactly the installation the installer produces.

**`uninstall` does NOT inherit that default, and the asymmetry is deliberate.** Reading the
wrong kind costs a wrong line; removing the wrong kind costs a service
and a device key. Without `--machine` and without a resolvable project it REFUSES,
listing what exists on disk with the exact command for each one — and never removes
both, which would be removing more than was asked.

**`Restart=on-abnormal` stays byte for byte, in both kinds.** Exit 1 is a fatal
join refusal or an exhausted retry ceiling, and restarting would be the loop the CLI
refuses to do on its own ([RN-514](engine.md#rn-514)). Moreover: RN-544 made an **empty list exit
with 0** precisely so that `on-abnormal` does not bring the service back up on a
new installation, where there is nothing to serve — swapping for `on-failure` would undo both
decisions at once.

- **Code:** `apps/runner/src/servico.ts` (`AlvoDaUnidade`, `ALVO_DE_MAQUINA`,
  `alvoDeProjeto`, `resolverEspecie`, `PlanoDeInstalacao` as a union,
  `caminhoDaUnidade`/`projetosInstalados`/`maquinaInstalada`,
  `prepararPlanoDeProjeto`/`prepararPlanoDeMaquina`, `recusaDeSobreposicao`,
  `linhasDoQueExiste`/`linhasDeCoexistencia`,
  `ContextoDoServico.apiUrlDoAmbiente`,
  `DependenciasDeInstalacao.resolverBase`, `SistemaDeServico.listarPasta`);
  `apps/runner/src/servico-sistema.ts` (`listarPasta` over `readdirSync`);
  `apps/runner/src/index.ts` (the `resolverBase` adapter over
  `resolverBaseConsentida`, `apiUrlDoAmbiente`, the usage text)
- **Test:** `apps/runner/src/servico.spec.ts` — `service install --machine` (the
  unit without `--project`/`--dir`, the absence of name collision, the freezing of
  `XDG_CONFIG_HOME` without the base's value, the launchd Label and log, the
  `BRABO_API_URL`) and the five refusals of its own (project config in the folder, without
  a base, invalid base, without a key, `--machine` with `--project`); and the two
  kinds not overlapping (refusal in BOTH directions without removing anything, the
  `status` of each side saying about the other without summing codes nor asking the
  manager, the `status` without an argument falling on the machine, the
  `uninstall --machine` leaving the project one intact, and the `uninstall` without a
  kind refusing and listing both)
- **Gap DECLARED:** `install --machine` **does not know** whether that
  folder's key is really a machine one — on disk the two kinds are the same file, a
  JWK with `kid` ([RN-475](web.md#rn-475)), and what knows is the SERVER
  ([RN-544](#rn-544)). A folder with a PROJECT key installs the unit without error, and
  the refusal only shows up on the first boot, as `CredencialNaoEDeMaquinaError`.
  Verifying at `install` would require a network call in a subcommand that today
  makes none, and inventing a local guess would produce the second source of
  truth RN-544 refused. And, at the time of this RN, nobody CREATED a machine
  key: what registers it is `install.sh`
  ([ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) point 4), in
  session 6 — this session delivers the subcommand it will call, and the route
  it calls arrived in [RN-552](api.md#rn-552)
- **ADR:** [0154](../adr/0154-chave-de-dispositivo-de-maquina.md)
- **Origin:** PHASE 30, session 4 —

---

## The machine agent waits for the first project, and the key is born in the terminal (RN-550/551, PHASE 30)

### RN-550 — With ZERO connections the local agent does NOT exit: it waits and re-queries the list; with a live connection the query is still only at start {#rn-550}

Session 8 of [PHASE 30](../explanation/fase-30-runner-por-maquina.md).
[RN-544](#rn-544) made an empty list a NORMAL state and the process exit with **0**,
saying *"create a project in Runner mode and bring the agent up again — the list is
queried only at start"*. That contradicted, in writing,
[ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) point 5 — *"it
**waits**… when the person creates the first project on the web, the agent is already
there"* — and broke exactly the case the phase pursues: the new installation, which
is the installation with ZERO projects. The installer brought up the agent, the agent
found there was nothing and went away, and the person who created the first
project minutes later would go back to the terminal without ever having been told about it.

**The rule is ASYMMETRIC, and the asymmetry is the design:**

```
conexões > 0  →  a lista é consultada SÓ no start   (a RN-544 fica byte a byte)
conexões = 0  →  reconsulta, com cadência declarada
```

**And it does NOT undo RN-544's decision.** That session's argument remains
whole: a list that comes back **SMALLER** is ambiguous — project deleted, converted
mode, role revoked, or a transient 500 disguising itself as the three —, and
taking down a **LIVE** connection because of that ambiguity would trade a right
state for a guess. With **zero** connections there is nothing to take down and no
ambiguity at all: any project that shows up is pure gain, and no
decision is made about what disappeared. The re-query **STOPS** the moment the
first non-empty list arrives, and from then on the behavior is byte for byte
today's — the waiting module is not called again while the process lives.

**The `exit 0` argument fell because its premise fell.** RN-544 wrote
that *"staying up with zero connections would be an 'active' service that does
nothing, and the unit's `status` would start to lie"* — and that depended on the process doing
nothing. It is that premise this RN removes: it re-queries, with a declared
cadence, and SAYS it is doing so. `active (running)` becomes
true, and what lied was the exit with 0, which left the new installation without an
agent precisely in the minute the person was going to create the first project.

**The cadence escalates and STABILIZES: 15s, 30s, 60s, and the last one repeats
forever.** The two short steps exist because the case to serve is that of someone
creating the first project NOW; a ceiling of minutes would make the agent show up
after the person gave up looking. The 60s plateau is the steady-state price — ONE
request per minute, from one installation, against a route that returns the list of the
credential's own owner. Growing beyond that would save traffic nobody
is paying for and worsen the only thing the wait delivers.

**There is a ceiling, and it is on FAILURES, never on waiting.** Waiting has no limit —
waiting is the normal state of a new installation, and can last days. What has a
ceiling are **CONSECUTIVE** query failures: ten, and then the process exits with 1
NAMING the number, as the connection loop already does with
`TETO_DE_TENTATIVAS_SEGUIDAS` and for the same reason (not hammering the api
forever when the problem is not transient). A query that ANSWERS resets the
counter — including when it answers EMPTY, which is success, because the empty list
is the right answer. The constant is SEPARATE on purpose, with the same value: one
counts failures to CONNECT and the other, failures to LIST, and tying them would make a
change in connection cadence touch, without anyone asking, the time a
new installation waits before giving up. `CredencialNaoEDeMaquinaError` (the 403
by key kind, [RN-544](#rn-544)) does **not** count toward the ceiling: it is fatal on the
spot, because a project key does not become a machine key by waiting one more
minute.

**Staying up silently would be worse than exiting.** "Waiting" and "stuck" are the
same picture to whoever reads `journalctl`, so the process states the cadence when
entering the wait, says when the first project shows up, and beats a HEARTBEAT every
30 queries (half an hour, on the plateau) reporting **how many** queries there
have been. Not every query becomes a line, also on purpose: one log per minute,
forever, is the noise that buries the lines that matter.

**`Restart=on-abnormal` stays byte for byte, in BOTH unit kinds
([RN-545](#rn-545)), and nothing in them changes.** Measured: `on-abnormal` restarts on
SIGNAL, watchdog or timeout — never on exit code, neither 0 nor 1. The exit
with 0 was never what prevented the service from being restarted; what prevented it is that
`on-abnormal` looks at no code at all. The real effect of the change is the opposite of what was
feared: the MACHINE unit, which is the one running this mode, now stays
`active (running)` for real instead of ending in `inactive (dead)` seconds
after starting — and `service status --machine` now answers `rodando` (0)
where before it answered `parado` (3) on a new installation. The PROJECT unit
is not affected in any line: it runs the `projeto` mode, which never gets here.

**One exception, declared: a NON-empty list whose projects are all refused
still exits with 1.** That is also zero connections, and even so it does not wait —
because there each refusal names a concrete local defect (a segment escaping the
base, a folder that is a file) with its own fix, and re-querying would repeat the
same refusals indefinitely, burying in the log the line that says what to
fix. The wait is for *"no project exists yet"*, never for *"it exists and
I cannot serve it"*.

- **Code:** `apps/runner/src/espera-de-projetos.ts:127`
  (`esperarPrimeiroProjeto`), `:60` (`CADENCIA_DA_ESPERA_MS`), `:75`
  (`TETO_DE_FALHAS_DE_CONSULTA`), `:88` (`CONSULTAS_POR_BATIMENTO`);
  `apps/runner/src/index.ts:1465` (the wait inside
  `rodarComoAgenteDeMaquina`, and the exception for the refused ones right below)
- **Test:** `apps/runner/src/espera-de-projetos.spec.ts` — the happy path
  (waits, re-queries, returns the first non-empty list and STOPS there), the
  cadence that stabilizes, the heartbeat every N queries, the ceiling of consecutive failures
  with the number in the message, the answer in the middle RESETTING the counter, the
  kind 403 coming up intact and SIGTERM returning `parado`;
  `apps/runner/src/index.spec.ts` — the JUNCTION in the real PROCESS, against a
  fake api that returns `[]`: the process SAYS it stays up and **does not
  end**, which was the defect
- **ADR:** [0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) point 5
- **Origin:** PHASE 30, session 8 —
  [the phase's scope](../explanation/fase-30-runner-por-maquina.md)

### RN-551 — `brabo-runner device-key create`/`finish`: the Ed25519 pair is born ON THE MACHINE, the private key never travels, and the file the runner reads never exists without `kid` {#rn-551}

Session 8 of [PHASE 30](../explanation/fase-30-runner-por-maquina.md), the other
half. Until now, **only the browser** generated a device key pair
(`apps/web/src/lib/runner-bootstrap.ts`, [ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md),
[RN-464](api.md#rn-464)); the CLI only knew how to **read** what someone had put in the folder
(`device-key.ts`). [ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md)
point 4 asks for the other side: *"the pair is generated **on the machine**; the private key never
travels… keeps true the sentence RN-519 uses to refuse the
`maintainer` view: 'the private key of a device key never leaves the browser' —
becomes 'never leaves the machine'"*. Without it, [RN-543](produto.md#rn-543),
[RN-544](#rn-544) and [RN-545](#rn-545) all kept the same declared
gap: **nobody creates a machine key**.

**There are TWO steps, and the reason is the `kid`.** The `kid` written inside the private JWK
IS the record's id on the server ([RN-475](web.md#rn-475)) — the whole chain only
PASSES IT ON (the runner reads `jwk.kid`, the JWT carries it in the header, `PatAuthGuard` finds the
public key by it), and nobody derives it from anything else. It only exists **after**
the public key is registered, and a private key written before that is born useless, which is
literally the defect RN-475 cost a hunt to find. The browser solves it by keeping the pair in
MEMORY between registration and writing; the CLI solves it
with a **PARTIAL** file:

```sh
PUB=$(brabo-runner device-key create)          # gera aqui, imprime a PÚBLICA
ID=$(… registra PUB na api …  | jq -r .id)     # quem registra é o instalador
brabo-runner device-key finish --id "$ID"      # carimba o kid e grava
```

**At no instant does a `brabo-runner-device-key.jwk.json` exist without `kid`.** The
`create` writes to `…jwk.json.parcial`, a name `lerChaveDeDispositivo` does not
look for; the `finish` stamps and writes the real name. The file the runner READS
is either complete or does not exist, and an interruption between the two steps leaves a
`.parcial` the runner IGNORES and the next `create` NAMES — saying that the
record of that attempt may have been ORPHANED, which is inert and shows up in the
listing of [RN-519](api.md#rn-519).

**The CLI does NOT talk to the api, and the reason is a SECRET one, not a technical one.** What registers
the machine key is the installer, authenticated by the `BRABO_SERVICE_TOKEN`
it just generated ([ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md)
point 1). Making `brabo-runner` call the route would require putting that token in its
hands — an INSTALLATION secret, which opens internal routes, handed to a process
that today only sees a device credential and that stays up forever on the user's
machine. The cut is the opposite: **each side keeps exactly one secret, and
neither sees the other's**. What crosses the boundary between them is the PUBLIC JWK and
the id — nothing that needs protecting.

**The default destination is the machine's configuration folder, and the precedence is
REUSED.** `$XDG_CONFIG_HOME/brabo/` (otherwise `~/.config/brabo/`), next to the
`runner.json` of [RN-529](#rn-529) and for the same reason — it is MACHINE
configuration, and a machine key has no project folder in which to live.
`pastaDeConfiguracaoDoBrabo` was EXTRACTED from `caminhoDoArquivoDeBase` when it
gained the second consumer, never copied. This does **not** reopen the door Wave 2 of
[ADR 0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
closed (a credential in a global and IMPLICIT path): `device-key.ts` still reads only from the `cwd` the caller
passes, and what points to this folder is the `--dir` of the machine unit
([RN-545](#rn-545)), explicitly, written in the service. `--dir` exists and also serves
a project folder — on disk the two kinds are the same file, and
what knows the difference is the SERVER ([RN-544](#rn-544)): this command asserts no
kind at all.

**The private key is written with mode 600, explicit, and never left to `umask`.** The
folder is born 700 when it is THIS command that creates it; a folder that already existed belongs to the
user (it may be the one the browser configured) and is not re-tightened. The `--dir`
goes through the SAME `validarDirDentroDoHomeNoLinux` of [RN-434](#rn-434), reused
whole: what is written is a user secret, and a folder outside their `$HOME`
is not where their `systemd --user` will look.

**The stdout carries ONE value, on one line, and everything else is stderr.** That is the
contract `install.sh` depends on (`PUB=$(…)`): mixing the two would
force the script to filter human output, which is how a contract breaks
without anyone noticing. In `create` the stdout is the public JWK; in `finish`, the
file's PATH — the value the next step (`service install --machine
--dir <pasta>`) needs.

**Overwriting a complete key is REFUSED, and there is no `--force`.** Swapping the key
of an already paired machine would swap the identity of an agent that may be
up NOW, silently: the public key would remain registered and the process would start
signing with a key nobody knows. The refusal names the gesture (revoke,
delete, recreate), and a flag that knocks down a guard whose symptom is silent
would bring back the silent symptom.

- **Code:** `apps/runner/src/criar-chave-de-dispositivo.ts:202`
  (`criarChaveDeDispositivo`), `:275` (`finalizarChaveDeDispositivo`), `:82`
  (`SUFIXO_PARCIAL`), `:177` (`resolverDestino`); `apps/runner/src/base.ts:85`
  (`pastaDeConfiguracaoDoBrabo`, extracted);
  `apps/runner/src/index.ts:1280` (the dispatch before `lerArgumentos`, and the
  stdout/stderr separation)
- **Test:** `apps/runner/src/criar-chave-de-dispositivo.spec.ts` — the end-to-end
  happy path (the public key on stdout, the partial at 600, the `finish`
  stamping, and the resulting key read by `lerChaveDeDispositivo` and SIGNING
  a real ticket JWT), the `--dir`, and the refusals: `finish` without `create`,
  without `--id`, with `--id` pasted from the whole JSON, a complete key already in place
  (in both commands), a partial that is not the JWK, an unknown subcommand and the
  orphan warning; `apps/runner/src/index.spec.ts` — the JUNCTION in the real
  process: `device-key create` runs in a folder WITHOUT any credential, and the
  stdout contains only the public JWK
- **Gap DECLARED, and CLOSED in both halves:** what REGISTERS the public key
  did not exist in this repository when this RN closed — the route arrived in
  [RN-552](api.md#rn-552) and the `install.sh` that chains the two commands, in
  [RN-547](produto.md#rn-547). The contract this command assumes is the one the PROJECT
  key route already has (`{ name, publicKeyJwk }`, with `publicKeyJwk` being the
  JSON of the Ed25519 public JWK — `kty` "OKP", `crv` "Ed25519", `x` — and a response
  with `id`), and that is what `create`'s stdout produces: one line in that format.
  The command also does **not** choose the device's `name`, on purpose — it is a
  field of the record, and whoever names is whoever registers
- **ADR:** [0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) point 4
- **Origin:** PHASE 30, session 8 —
  [the phase's scope](../explanation/fase-30-runner-por-maquina.md)

---

## The credential that does not cross the local agent's container (RN-558)

### RN-558 — A credential in `exec` with an active container is REFUSED by the runner, with a named outcome and origin `politica` {#rn-558}

A gap declared in writing when closing [RN-507](#rn-507)/[RN-508](api.md#rn-508)
([ADR 0145](../adr/0145-docker-pre-requisito-do-runner.md)) and measured again here,
link by link, before any line was written.

**The chain, measured.** `Engine.Runners.RunnerReadiness.verificar/1`
(`runner_readiness.ex:52`) requires a REGISTERED `running` container before
ANY operation of `Engine.Actions.Workspace.RunnerGit` — including the
initial authenticated `git fetch`, which comes out of `fetch!/3`
(`runner_git.ex:226`, via `exec/4` at `:288`). The ONLY way for that record to
exist in a `runner` project is the SAME runner having started its own container
([ADR 0137](../adr/0137-o-runner-sobe-o-container-do-projeto.md)), and it is that same
success that marks `estado.containerAtivo` in it
(`apps/runner/src/index.ts:822`, in `tratarContainerStart`). With
`containerAtivo` set, `tratarExec` routes the command into the container
(`index.ts:728`–`730`, and the new refusal at `:693`), and the `exec` operation of
`packages/docker-port` **has no `env` field** — on purpose ([ADR 0130](../adr/0130-broker-de-container.md):
no free `-e` at all). The `env` field RN-507 added to the
`exec`/`exec_result` pair (`RunnerRouter.exec/5`, `runner_router.ex:50`;
`ExecMessage.env`, `apps/runner/src/channel.ts:62`) is only applied on the
HOST path, where `apps/runner/src/exec.ts:94` MERGES it over `process.env`.

Result: the moment RN-507 lets the authenticated `fetch` run, the
container is almost always already up on the SAME runner — and that is where the
credential ([ADR 0056](../adr/0056-o-engine-trabalha-em-repositorio-remoto.md),
`GitAuth.env_de_auth/1`) was discarded, **silently, with no error**. `git`
ran with the ephemeral helper installed by `-c` and the two variables EMPTY, and
exited with an authentication failure — indistinguishable from an invalid token, wrong
permission or network down. The person hunted the wrong thing, and the product said
nothing.

**The fix is the NAMED outcome, not delivering the credential.** The `docker
exec` still has no `env` field — touching that is changing the containment door,
and it is an ADR decision, not a cut (see the gap declared below). What changes is
that the pair (`env` present, active container) stops being executed and starts being
**refused**, with a mark, a message and an origin.

**What refuses is the RUNNER, and only it can.** It is the only process that knows both
halves at the same time: that the command carries a credential and that it goes
inside the container. The engine does not know the second, and that was MEASURED:
`estado.containerAtivo` is born `null` on each runner execution
(`index.ts:1449`) and is only set by `tratarContainerStart`, so a
`running` container REGISTERED in the database **does not imply** an active container in that process
— a restarted runner with the container up routes to the HOST, and there the
credential arrives normally. Moving the check up to `RunnerReadiness` or to
`RunnerGit` would refuse a path that works. And `RunnerReadiness` stays BYTE FOR
BYTE as it is: it gains no flag nor fourth precondition — it is the same rule
[RN-516](#rn-516) already stated about not hanging a "skip
container" flag on it.

**The MARK is a PROTOCOL constant, not a message detail.**
`MARCA_DE_CREDENCIAL_NAO_ENTREGUE` (`index.ts`) and `@marca`
(`credencial_de_git.ex`) carry the SAME token, and it is through it — not through the sentence —
that the engine recognizes the refusal after it has crossed a `rescue` and
become a loose string. Changing only one side breaks no compilation: the refusal
keeps happening and only the CLASSIFICATION goes back to being wrong, which is the exact form of the
defect this RN closes. Neither of the two suites reaches the other language
(ExUnit does not read TypeScript, the runner's vitest does not read Elixir), so the guard
lives in `scripts/ci/`, with the other tests that read the whole repository as
text.

**The origin is `politica`, and the choice points to ACTION.** The four of
[ADR 0020](../adr/0020-destravar-gates-qa-secops.md) do not assign blame, they say what to
do. This is not a clause nobody wrote (`codigo`) nor a network that went down
(`infra`): it is the containment of ADR 0130 working as designed, against a case
it did not foresee. Whoever reads `politica` knows there is no bug to hunt — there is a
pending product decision. `Engine.Runners.CredencialDeGit.desfecho/1`
adds ONE case and reclassifies no other: any other worktree
failure keeps byte for byte `{"falha ao preparar o worktree", "codigo"}`, in
BOTH dev agents (the real one and the Noop, which exists to exercise THIS path and not
a copy of it).

**The CONTAINMENT refusal wins, and the order is a decision.** It comes AFTER
`validarCwdDentroDaRaiz` (`guard.ts`): a command pointed outside the root
needs to hear **that**, because there a containment boundary is being
refused, while here there is a missing capability. Collapsing the two would make an
out-of-scope command look like a credential problem — the same
diagnosis defect, with another sign.

**The `env` never appears in the refusal — only the COUNT.** RN-507's invariant is
that `msg.env` goes to no log at all, and this output goes to the product's event log:
the refusal says "2 variável(is) de ambiente", never a name or a value.
The number already says what needs to be known there.

**What is NOT affected, confirmed by reading:** a `local` repository (provider
without a token) — `GitAuth.env_de_auth/1` returns `[]`, `fetch!/3` converts it to
`nil`, the field does not even enter the payload, and the refusal does not fire; the
`container` and `mounted` modes — they never go through `RunnerGit` (`Workspace.ensure!/4`
forks by `execution_mode` and only `runner` goes there), and their container
comes up via the broker, on the other side of the network; and an ordinary terminal command, which never
carried `env`. `workspace_create` also carries `env`, and is also not affected:
it runs on the HOST (`criarPastaDoProjeto`), not in the container.

- **Code:** `apps/runner/src/index.ts` (`MARCA_DE_CREDENCIAL_NAO_ENTREGUE` and
  the refusal in `tratarExec`, after the
  `cwd` validation), `apps/runner/src/channel.ts`
  (the docblock of `ExecMessage.env`, which promised "runs only without the credential"),
  `apps/engine/lib/engine/runners/credencial_de_git.ex` (new — the mark,
  `recusada?/1`, `mensagem/2` and `desfecho/1`),
  `apps/engine/lib/engine/actions/workspace/runner_git.ex` (the new clause in
  `fetch!/3`, before the generic one, and the moduledoc),
  `apps/engine/lib/engine/dev/dev_agent_server.ex` and
  `apps/engine/lib/engine/dev/noop_dev_agent_server.ex` (the outcome of
  `{:error, reason}` in the worktree creation)
- **Test:** `apps/runner/src/index-handlers.spec.ts`, block *"a credencial não
  atravessa o docker exec (RN-558)"* — the happy path (without a container, the `env`
  reaches the host and nothing is refused), the failure case (with a container, named
  refusal and `docker.exec` NOT called), the negative proof that the variables' name and value
  do not leak in the output, an empty `env` not becoming a refusal, and the
  containment refusal of `guard.ts` beating this one when the `cwd` is outside the root;
  `apps/engine/test/engine/actions/workspace_runner_test.exs` (the two
  `RN-558` tests: the refusal that becomes a named message with origin `politica`, and the REAL
  fetch failure that keeps the usual message with origin `codigo` — the
  negative pair that proves the new clause did not hijack the old one);
  `apps/engine/test/engine_web/channels/credencial_no_runner_test.exs` (AT-111,
  the whole CHAIN through the real `TerminalChannel`: the `env` reaches the channel only on
  `fetch`, the runner's reply is the fixture
  `apps/runner/fixtures/exec-result-recusa-de-credencial.json` — which the runner's
  spec compares byte for byte with the real output of `tratarExec` —, `RunnerGit`
  returns the named message, and `DevAgentServer` records `dev.blocked` with origin
  `politica`; plus the branch without an active container, in which the `fetch` answers 0, and the
  real failure, which stays `codigo`. It does NOT prove the bridge between languages by
  execution: no `node` process starts in ExUnit, and the pair that closes it is the
  shared fixture. Verified by mutation: cutting the `env` in the channel, in
  `RunnerGit`, the recognition of the refusal, `desfecho/1` or its use in the dev
  agent fails the test; turning off the refusal in `tratarExec` fails the
  runner's spec);
  `scripts/ci/marca-de-credencial-do-runner.spec.ts` (the identical mark on both
  sides). Verified by mutation: neutralizing the `fetch!/3` clause fails
  the engine test with the old message in view
- **Gap DECLARED, which is the HALF that remains open — CLOSED by
  [RN-676](#rn-676) ([ADR 0193](../adr/0193-git-credenciado-no-host-do-runner.md),
  owner's decision of 10/01):** the credentialed fetch goes MARKED by the engine and
  runs on the runner's HOST even with an active container; this refusal shrank to the
  `env` WITHOUT the mark (in practice, a runner older than ADR 0193). The text
  below is from when it closed the silence half: the credential
  still does **not cross** the `docker exec`. AUTHENTICATED clone/fetch of a remote
  repository in `runner` mode remains impossible with the container up —
  what changed is that now it fails SAYING so, instead of looking like a
  token error. Closing it requires deciding HOW a credentialed operation talks to a `docker
  exec` without an `env` field, and the known options all touch the
  containment door of ADR 0130 (giving the operation `env`; a credential file mounted
  and deleted; running the `fetch` on the host even with an active container, which would break
  the invariant that the work happens inside the container). It is an ADR, never a
  passing fix. The ADJACENCY this delivery also declared — the
  refusal happened AFTER `init_from_bare!/5` had already done `git init`, and the
  `git_dir?/2` of `ensure!/5` marked the workspace ready on the next attempt
  because it found the `.git`, so the second attempt failed further on at
  `worktree add` instead of repeating the refusal — **CLOSED in AT-112**: the
  initialization that fails (any step, not only the credentialed `fetch`)
  UNDOES the `.git` it itself created (`inicializar_ou_desfazer!` in
  `Engine.Actions.Workspace` and in `RunnerGit`) and re-raises the original exception,
  so the next attempt repeats the SAME cause. The undo only runs on the branch where
  there was NO `.git` — that of the "workspace from before the mark" (which has a `.git` and
  is not re-initialized) stays intact, so it deletes nobody's work. On the
  `runner` side the `rm -rf` is best-effort (the runner may have dropped, one of the
  causes of the failure). Signals considered and refused: an "in
  progress" marker (a second file to maintain, and orphaned if the process dies between the
  two steps) and checking the expected ref (the empty repository, without
  `origin/<branch>`, is a LEGITIMATE state and would fall as a failure)
- **ADR:** none new — the delivery moves no boundary at all. It CONSUMES
  [0130](../adr/0130-broker-de-container.md) (the door without `env`),
  [0137](../adr/0137-o-runner-sobe-o-container-do-projeto.md) (the container on the
  user's machine), [0145](../adr/0145-docker-pre-requisito-do-runner.md) (the
  precondition and the `env` field) and [0020](../adr/0020-destravar-gates-qa-secops.md) (the
  four origins)
- **Origin:** `AT-053` — the gap ADR 0145 left declared in writing

---

## Credentialed git runs on the runner's host (RN-676)

### RN-676 — With an active container, `RunnerGit`'s credentialed `git fetch` runs on the runner's HOST, marked by the engine; the code stays in the container {#rn-676}

Owner decision (10/01), recorded in
[ADR 0193](../adr/0193-git-credenciado-no-host-do-runner.md): a CREDENTIALED git
operation runs on the runner's HOST, and the code runs in the container. It closes the
half that [RN-558](#rn-558) left open — the authenticated fetch in
`runner` mode with the container up, which is the common path, always ended in the
named refusal.

1. **The engine marks, and only at one point.** `RunnerGit.fetch!/3` dispatches the
   credentialed fetch through `RunnerRouter.exec_git_credenciado/5`, which puts
   `gitCredenciado: true` in the `exec` payload and requires a non-empty `env` by
   guard. The dev agent's terminal command goes through `RunnerRouter.exec/4` and
   never carries the mark. Without credentials (provider `local`), the fetch goes without the mark.
2. **The runner runs on the host only with the CONJUNCTION**: the literal mark `true` **and**
   a non-empty `env`. Then the command goes to `executarComando` (the `env` merged over
   `process.env`), even with an active container. The folder is the same: `estado.dir` is
   the bind-mount of `/work`.
3. **`env` without the mark does not get the host.** With an active container, that pair stays
   REFUSED with the RN-558 mark and origin `politica`. Today no engine caller
   produces it; in practice it comes from a `brabo-runner` older than ADR
   0193, which does not read the mark — and the engine's message says to update it. The
   mark without `env` changes nothing either: the command goes to the container.
4. **No containment changes**: `DockerPort.exec` remains without `env` (ADR 0130), and
   `RunnerReadiness` (RN-507) stays byte for byte — the mark decides WHERE the runner
   executes, never WHETHER the engine dispatches.
5. **The log never carries the name or value of an `env` variable**: the refusal gives the
   count, and the host path's log adds only `[git credenciado, no host]`.

- **Code:** `apps/runner/src/index.ts:694` (`gitCredenciadoNoHost`), `:659`
  (`tratarExec`); `apps/runner/src/channel.ts:71` (`gitCredenciado`), `:627`
  (`gitCredenciado`); `apps/engine/lib/engine/runners/runner_router.ex:93`
  (`exec_git_credenciado`), `:98` (`despachar_exec`);
  `apps/engine/lib/engine/actions/workspace/runner_git.ex:338` (`exec`), `:426`
  (`despachar`); `apps/engine/lib/engine_web/channels/terminal_channel.ex:609`
  (`git_credenciado`); `apps/engine/lib/engine/runners/credencial_de_git.ex:93`
  (`mensagem`)
- **Test:** `apps/runner/src/index-handlers.spec.ts:366` (the real `git`
  helper receives the credential on the host with an active container — happy path),
  `:391` (a real `git fetch origin` succeeds on the host), `:430` (`env` without the mark
  stays refused — failure case); `apps/runner/src/channel.spec.ts:208`;
  `apps/engine/test/engine/actions/workspace_runner_test.exs:451`, `:466`,
  `:476`; `apps/engine/test/engine_web/channels/credencial_no_runner_test.exs:149`
  (AT-111: the chain through the real `TerminalChannel` ends in `{:ok, _}`), `:177`.
  The ExUnit tests did not run in this delivery's environment (`repo.hex.pm` 403); the
  CI proves them.
- **Origin:** AT-116 (proof: AT-111), owner decision of 10/01

## The Anamnese switched back on: eligible subject and profile fact (RN-680)

### RN-688 — The runner binary reads the PTY with its own reader under Bun, and the self-test proves the SECOND read {#rn-688}

Under Bun (the `bun build --compile` binary, [ADR 0112](../adr/0112-binario-standalone-do-runner-via-bun-build-compile.md)),
the `tty.ReadStream` with which `node-pty` reads the PTY's master side is an
`fs.ReadStream`, and the first read with no data from the non-blocking fd RAISES as
`EAGAIN`: the stream destroys itself, closes the fd, and no `onData` arrives after that
(oven-sh/bun#25822). The binary's interactive terminal stopped after the first
chunk of output on all THREE Unix platforms; Linux passed the proof only because the
first read already brought the echo and the answer together.

**The rule:** under Bun and outside Windows, `node-pty`'s `spawn` runs with the
`tty.ReadStream` swapped for its own reader that reads the SAME fd with `fs.read`
and, on `EAGAIN`, WAITS and retries (from 4 ms, doubling up to 32 ms, back
to the minimum on every piece of data); `EIO` or zero bytes is the end. The swap applies only DURING the
`spawn` and is restored even when it throws; under Node the module comes back
INTACT. The fd and the child process remain the real ones — nothing simulates output.
And `--self-test-pty` makes TWO rounds, the second after a pause with nothing to
read: it is the pause that forces the read through an `EAGAIN`, and it is through it that the
old reader fails on Linux too. When it fails, the self-test says why
(chunks, the child's output, a probe on a second PTY and the stream's events) — the
verdict does not change.

It was the probe that measured Windows: there the read side is ConPTY's named
pipe, opened by `node-pty` as a `net.Socket`, without an fd the reader could
take over, and the pipe ends after the first chunk — which is why `win32-x64`
left the matrix ([ADR 0187](../adr/0187-runner-sem-binario-win32-x64.md)) instead of
getting a workaround.

- **Where:** `apps/runner/src/leitor-de-pty.ts:60` (`precisaDoLeitorProprio`),
  `:70` (`LeitorDeFdNaoBloqueante`), `:115` (`agendar`), `:152`
  (`comLeitorDePtyProprio`); `apps/runner/src/native-pty-loader.ts:114`
  (`comLeitorDePtyProprio`); `apps/runner/src/index.ts:1268`
  (`PAUSA_ENTRE_VOLTAS_MS`), `:1291` (`sondarPty`), `:1346`
  (`rodarAutoTestePty`)
- **Test:** `apps/runner/src/leitor-de-pty.spec.ts:14` (only under Bun and outside
  Windows), `:23` (outside it, the SAME module), `:28` (swap only during the
  `spawn`, restored when it throws — failure case), `:48` (the two rounds of
  a real `cat`, with `EAGAIN` between them); the end-to-end proof is the
  matrix's `smoke:bin`, green on `darwin-arm64`, `linux-x64` and `linux-arm64`
  in rehearsal `36779817686`
- **ADR:** [0112](../adr/0112-binario-standalone-do-runner-via-bun-build-compile.md),
  [0187](../adr/0187-runner-sem-binario-win32-x64.md)
- **Origin:** AT-342, AT-343

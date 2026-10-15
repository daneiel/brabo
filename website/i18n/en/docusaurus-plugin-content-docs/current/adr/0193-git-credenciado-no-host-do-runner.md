---
traducao_de: 94baaa08c45cd0a4b4685d1b071035095fc6285a
---

# 0193 — Credentialed git runs on the runner's HOST; the code runs in the container

## Status

**Accepted.** 2026-10-01 (AT-116, story HS-037, epic EP-010, round 36; owner
decision on 01/10: *"credentialed git operations on the HOST, code in the
container"*). Closes the half that [RN-558](../business-rules.md#rn-558) left
declared as open and references, without editing them,
[ADR 0130](0130-broker-de-container.md) (the Docker port without a free `-e`),
[ADR 0145](0145-docker-pre-requisito-do-runner.md) (`RunnerReadiness` and the
three preconditions of `runner` mode) and
[ADR 0056](0056-o-engine-trabalha-em-repositorio-remoto.md) (the git credential
only in the child process's ENVIRONMENT). The proof is AT-111.

## Context

Measured on `dev` on 2026-10-01, before changing:

- The ONLY engine `exec` carrying `env` is the authenticated `git fetch` of
  `Engine.Actions.Workspace.RunnerGit.fetch!/3` (`GitAuth.env_de_auth/1`,
  converted into a map; `nil` for a provider without a token).
  `TerminalExecutor` calls `RunnerRouter.exec/4` and never passes `env`. There is
  no credentialed `push` nor `clone` via `exec` in `runner` mode: the folder
  creation clone travels in `workspace_create` (RN-532), which already runs on
  the HOST (`criarPastaDoProjeto`).
- `RunnerReadiness` (ADR 0145) requires a REGISTERED `running` container before
  any `RunnerGit` operation, and in a `runner` project that record only exists
  because the SAME runner brought up the container — which sets
  `estado.containerAtivo`. With it set, `tratarExec`
  (`apps/runner/src/index.ts`) routed EVERY command to `docker exec`, which has
  no `env` field (ADR 0130). Since RN-558 that pair (`env` present, container
  active) was REFUSED with the mark `credencial-nao-atravessa-o-container`: the
  COMMON path of the authenticated fetch ended in a named refusal, never in
  success.
- The folder is the SAME on both sides: `tratarContainerStart` mounts
  `estado.dir` (the root confirmed by the runner) at `/work`
  (`DockerViaCli.start`, `${raizDoProjeto}:/work:rw`, `PONTO_DE_MONTAGEM` in
  `packages/docker-port/src/docker-port.ts`), and every `exec`'s `cwd` is
  validated inside `estado.dir` (`validarCwdDentroDaRaiz`) and translated to
  `/work/...` only when it goes to the container. The `.git` a fetch updates on
  the host is the one the container sees.

The two vetoed exits stay vetoed: a free `-e` on `DockerPort` (ADR 0130 refused
it) and a "skip container" flag in `RunnerReadiness` (it would knock down ADR
0145's third precondition for the whole `exec`).

## Decision

1. **The credentialed git operation runs on the runner's HOST, even with an
   active container.** The dev agent's command still goes to `docker exec`. The
   credential reaches the child process by the path that always worked:
   `apps/runner/src/exec.ts` merges `env` over `process.env`.

2. **The discriminator is an EXPLICIT MARK set by the engine, not the `env`.**
   The `exec` payload gains `gitCredenciado: true`, optional, and whoever sets it
   is `RunnerRouter.exec_git_credenciado/5`, called from ONE point
   (`RunnerGit.despachar/5`, from `fetch!/3`, only when there is a credential).
   The function requires a non-empty `env` by a clause guard. The runner runs on
   the host ONLY with the CONJUNCTION (literal `true` mark **and** non-empty
   `env`).

   Why not the `env` alone, which already existed: with it, any `exec` arriving
   with an `env` would escape the container — the `env` would become the exit
   door from the containment ADR 0145 set for code. With the mark, the exit is a
   NAMED decision of a single engine caller, and an `env` without the mark does
   not get the host. The mark is not enough on its own either: without a
   credential there is nothing to protect, and the command follows the usual
   routing.

3. **No ADR 0130 port changes.** `DockerPort.exec` still has no `env` field; the
   image, the network, the mount and the broker are not touched.
   `RunnerReadiness` stays byte for byte: the mark changes WHERE the runner
   executes, never WHETHER the engine dispatches — the registered `running`
   container precondition still holds for the fetch too.

4. **RN-558's refusal still exists, and shrinks to one case.** The pair (`env`
   present, container active) WITHOUT the mark is still refused with the same
   protocol mark and origin `politica`. No engine caller produces that pair
   today; in practice it appears through a version MISMATCH — a `brabo-runner`
   older than this ADR does not read the mark, routes the fetch to the container
   and refuses as before. That is why the message of
   `Engine.Runners.CredencialDeGit.mensagem/2` now states the fix (update the
   runner, or stop the container), instead of "the missing half does not
   exist". The runner's refusal text also changes (it says "WITHOUT the
   credentialed git mark"), and the fixture
   `apps/runner/fixtures/exec-result-recusa-de-credencial.json` changes along.

5. **The log invariant holds.** Neither the refusal nor the host path's log cite
   the name or value of an `env` variable — the refusal gives the COUNT, and the
   host log adds only `[git credenciado, no host]`. The command text is still
   logged as always (it carries ADR 0056's helper, which references the
   variables by name, but never the value — that does not change here).

## Consequences

- AUTHENTICATED fetch/clone of a remote repository in `runner` mode now works
  with the container up, which is the common path. RN-558 stops firing on it.
- **Old runner + new engine:** the runner ignores the mark and refuses with the
  RN-558 mark; the engine says "update the runner". **New runner + old engine:**
  the engine does not send the mark, and the runner refuses as before. No
  combination goes back to silent discard.
- Credentialed git runs with the HOST's user and `git`, not the container's. The
  files the fetch writes in `.git` are born owned by the runner process's owner
  — who is the mounted folder's owner. **Not measured:** a `runner` project
  container whose `--user` is not that owner would see the updated `.git` with
  another owner; today the spec the api sends to the runner
  (`EspecificacaoDeContainerParaRunner`) has no `usuario`, so the container runs
  with the image's user, and the effect was not exercised against real Docker.
- RN-558 listed this option as the one that "would break the invariant that work
  happens inside the container". The owner's decision accepts it with that price
  written down: what leaves the container is `git`'s CONVERSATION with the
  remote (the credentialed fetch), never the project's code — the dev agent's
  `npm install`, tests and build remain in `docker exec`. What the fetch brings
  is git objects, and they only become working files in a
  `checkout`/`worktree add` that carries no credential and follows the usual
  routing.
- The host needs `git` installed. It already did: `workspace_create` (RN-532) and
  the path without a container always ran `git` on the host.
- The mark is a second protocol constant in the `exec` pair, alongside `env`. It
  only travels when it is `true` (the ordinary terminal payload stays byte for
  byte as before), and the runner accepts only the boolean `true` — any other
  value is absence.
- Left out: credentialed `push` through the runner's `exec` does not exist
  today; if it is born, it enters through the same function
  (`exec_git_credenciado/5`), never through a second mark path.
- The proof (AT-111) swaps refusal for success on both sides:
  `apps/runner/src/index-handlers.spec.ts` (with an active container and the
  mark, the real `git` helper receives the credential and a real
  `git fetch origin` succeeds on the host, without `docker.exec`; `env` without
  the mark stays refused) and
  `apps/engine/test/engine_web/channels/credencial_no_runner_test.exs` (through
  the real `TerminalChannel`, the fetch goes marked and the chain ends in
  `{:ok, _}`). The ExUnit tests did not run in this delivery's environment
  (`repo.hex.pm` answered 403); CI is what proves them.

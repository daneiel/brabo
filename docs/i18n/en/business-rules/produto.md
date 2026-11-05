---
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
id: rn-produto
title: 'Regras de negócio — Produto'
sidebar_label: Produto
description: 'As RNs hospedadas na raiz produto.'
keywords: [regras de negócio, produto]
---

# Produto

## Backlog

### RN-012 — A module removed from `module_map` demotes the story {#rn-012}

A story linked to a module that ceased to exist goes back to `draft`, with
a `backlog.story_demoted` event.

- **Where:** `apps/api/src/domain/architecture/module-resolution.ts`; the
  event is emitted in
  `application/use-cases/architecture/create-module-map.use-case.ts:73`
- **Test:** `test/domain/architecture/module-resolution.spec.ts`

## Projects panel

### RN-096 — Every decision says in plain language what happens; the raw payload is born collapsed {#rn-096}

Every `proposed_action` type has a **sentence in Portuguese** describing the
effect of approving, and it is the first visible thing on the card — before any
detail, on the three screens where a decision is asked for (the Approvals queue, the card
inside the session chat, and the Insights tab). The raw payload remains accessible,
**inside a collapse that is born closed**, and is never dumped on the screen.

**What existed was a dump.** Every type without its own visual body fell into an
`Object.entries(payload).map(([k, v]) => k + ': ' + JSON.stringify(v))`, always
open. Whoever opened the queue read `worktree: /workspaces/dev-api`,
`coAuthor: Brabo User <user@brabo.dev>`, and `proposto: 4` — and had to deduce what
would happen if they clicked Approve. Approval that requires deduction is
approval given on autopilot, and the whole product rests on the user
being the final authority.

**The sentence degrades, and that's what makes it reliable.** None of them assumes that
a payload key exists: with an empty payload the sentence is still a true
sentence, just less specific ("Records a commit in the project's
repository."). The payload comes from the engine and from ten different use cases, and none
of them promises a format — a sentence that only works with the right fixture is a sentence
that breaks on the first real approval.

**A type the web doesn't know yet is not a theoretical case.** The web's `ActionType`
union has already fallen behind twice: first with the three Gitflow bootstrap
types, and again with `parallelize`/`raise_max_parallel`, which came in during PHASE
14d. The compiler doesn't catch it: the canonical list is in `apps/api`, which the web doesn't
import. Hence two things at once — the card **degrades** (neutral verb
+ "see details", with the payload collapsed, instead of the `undefined` in the
icon map that took down the whole React tree), and the **test reads the backend's
`decide.ts`** and fails when a type comes in without a sentence.

**The open/closed default is derived, not configured.** The rule is a single one —
it opens what is still waiting for a decision from whoever is looking: in the chat, a `pending` action;
in the queue, never (there are N cards, and N open details are the same wall of text);
in Insights, a `proposed` hypothesis. And the RAW payload doesn't open in any variant.
The project consequence is that `ApprovalCard` **gained no new mandatory
prop**: the default comes from `variant` and `status`, which already existed.

**Verb and sentence come from a single module**, consumed by the three screens. The Psicólogo's
hypothesis literally uses the `instruction_patch` verb instead of a
parallel vocabulary — and its sentence says what accept really does
(queues it for the Anamnese, which **may** propose the adjustment, which still comes for
approval), never "the instruction will be changed".

**`write_file` had a sentence, but no body.** It was born outside
`COM_CORPO_PROPRIO`: the sentence showed only the `path`, and the detail fell into the same
collapsed raw-JSON dump this RN exists to avoid — so a write
that genuinely asked for approval (outside the `dev-` prefix, or a path outside the
agent's scope) required one more click to see the `content`. It entered
`COM_CORPO_PROPRIO` with its own body: `path` and a preview of the `content` (up to
25 lines/4,000 characters, with a truncation notice — never the entire
file, same rule as the raw payload), open by default in the chat while
pending, like `terminal`.

**An empty payload is not an absent payload.** `command` (terminal) or
`path`/`content` (write_file) arriving as an empty string — a malformed tool call
from the model, not a rendering bug — degraded into a `$ ` prompt
or a blank preview, which the user read as a screen defect. The two
bodies now distinguish the two cases and show "the model did not produce a
valid X for this action" instead of a blank.

- **Where:** `apps/web/src/lib/aprovacoes.ts` (`VERBO_DA_ACAO`, `fraseDaAcao`,
  `descreverAcao`, `descreverHipotese`), consumed by
  `apps/web/src/components/ApprovalCard.tsx` (Approvals + session chat,
  `COM_CORPO_PROPRIO`, `previewConteudo` for the `write_file` `content`) and
  `apps/web/src/components/HypothesisCard.tsx` (Insights); collapse via the
  `Disclosure` of `apps/web/src/components/ui/Disclosure.tsx`
- **Test:** `apps/web/src/lib/aprovacoes.test.ts` (reads `ACTION_TYPES` from
  `apps/api/src/domain/actions/decide.ts` and requires verb + sentence for each type,
  with an empty payload); `apps/web/src/components/ApprovalCard.test.tsx`
  (`frase e colapso` — payload collapsed in both variants, readable JSON on
  opening, an unknown type doesn't take the screen down, `write_file` with its own body
  open by default and preview truncation, empty `command`/`path`/`content`
  showing the fallback message);
  `apps/web/src/components/HypothesisCard.test.tsx` (`frase e colapso`)
- **Origin:** PHASE 19 of program 16–26, from the request "today reading is very
  hard" on the first real navigation after the database reset

---

## "N agents online" on the dashboard — LIVE status, never historical presence (RN-409, ADR 0097)

An item from the previous backlog. Prior investigation (`docs/explanation/backlog.md`)
confirmed that there was no liveness aggregate at all — neither per project, nor
per workspace: what existed was only HISTORICAL presence
(`RosterFacts` — "has appeared in the session at some point") and REAL live status
only on the client, derived from the event log, and only when a project is
OPEN (`deriveAgentRoster`). The dashboard card today forced
`() => 'ocioso'` because it drew no status at all — that's the hardcode
this RN replaces.

### RN-409 — "N online" adds two mechanisms by the SAME ruler: not idle, not tripped {#rn-409}

`ProjectCardSummary.onlineAgentCount` (`GET /workspaces/:workspaceId/
projects-summary`) is the count of agents ONLINE now — working or with
a pending item waiting for a decision —, never team size. Calling
"online" a number that is really "has appeared at some point" would be misleading
(same principle as [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)/
[0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)/
[0077](../adr/0077-ranking-de-modelos-por-capacidade-sem-nota-inventada.md) against faked
data).

Two SOURCES, one ruler:

- **Dev agents** — `engine.dev_agent_states.status`, aggregated in batch by
  `project_id` (`status NOT IN ('idle', 'idle_tripped')`). `working`,
  `awaiting_gate`, and `awaiting_approval` count (RN-047/ADR 0052 — the five
  states of the dev's machine); `idle`/`idle_tripped` don't. `dev-<modulo>` and
  `dev-<modulo>-2` are DISTINCT keys (`agent_id` in the table), so they count
  separately with no effort at all — it's the primary key itself that already separates them.
- **Conversational agents** (criativo/po/arquiteto/dev-lead/ux-designer/
  staff/infra) — the last `agent.status` event of each `actor_id`, in the project's MOST
  RECENT session (the same session scope the rest of `RosterFacts`
  uses, RN-090). `agent.status` has only three possible values
  (`Engine.Sessions.LiveBroadcast.agent_status/4` refuses any other):
  `working`/`awaiting_approval` count, `idle` doesn't.

**QA/SecOps NEVER count** — it isn't a filter, it's an ABSENCE of data: neither of
the two emits `agent.status` (they run a single verdict per invocation, with no notion of
"idle" between calls — their status comes from `pr.gate_changed`/
`infra.gate_changed`, a separate mechanism that `deriveAgentRoster` already handles
separately). No explicit exclusion was needed: the query only sums what has
the right event type.

The ruler is the SAME that `deriveAgentRoster` would already apply if the project were
open (`'trabalhando'`/`'aguardando'` on the client ≅ `working`/
`awaiting_gate`/`awaiting_approval` on the backend) — BOTH paths compute
"online" from the same eventual state (event log/persisted state
table), only by different MECHANISMS (SQL aggregation on the backend,
a fold over already fetched events on the client), in the same spirit as
`infraActive`/`uxDesignerActive`/`staffActive` (RN-090/RN-287: two sources,
one ruler). There's no shared function between `apps/api` and `apps/web` for
this — the two already diverge in language/runtime for the rest of `RosterFacts`
too, and introducing a shared package just for one count would be
a heavier weight than the problem.

**A new query against a schema the api doesn't migrate.** `engine.dev_agent_states`
is an ENGINE table (Ecto, Postgres schema `"engine"`), same physical database,
same connection — not a second data source, a second NAMESPACE in the
same Postgres. The precedent already existed: `apps/api/scripts/medir-execucao.ts`
already reads `engine.oban_peers` the same way (raw SQL via Drizzle), only
as a manual SCRIPT, never tested. This RN raises the pattern to tested PRODUCTION
code — see [ADR 0097](../adr/0097-leitura-direta-do-schema-do-engine-para-online-agent-count.md)
for the decision NOT to expose this as an internal HTTP route in the engine.

**Cost measured, not pretended free.** The two new queries take the read
model's total from TWELVE to FOURTEEN (RN-090 still holds — fourteen is
CONSTANT, proven by `projects-summary.repository.spec.ts` counting trips
to the database with 2 and with 20 projects). Neither has a time `WHERE` — the
`agent.status` one scans the same `session_events` of the most recent sessions
that `lastEvents`/`marcos` already scan next to it, so the marginal cost is
that of one more `type` filter over a query plan that was going to happen anyway,
not a new table being scanned from scratch. DECLARED gap: there's no recent
real execution (dogfooding) with production volume to measure real `ms`
against the Phase 22 ruler (525 thousand rows, `EXPLAIN ANALYZE`) — the two
new queries remain without a measured number, only the structural argument above.

- **Where:** `apps/api/src/application/ports/projects-summary-repository.port.ts`,
  `apps/api/src/infrastructure/persistence/drizzle/projects-summary.repository.ts`,
  `apps/api/src/interfaces/http/iam/dto/iam.response.dto.ts`,
  `apps/web/src/lib/api-types.ts`, `apps/web/src/components/ProjectCard.tsx`,
  `apps/web/src/routes/Dashboard.tsx`
- **Test:** `apps/api/test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  (`describe('onlineAgentCount (RN-409)')` — dev agent working/idle/
  idle_tripped, awaiting_gate/awaiting_approval, two instances of the same
  base agent, conversational agent working/idle/awaiting_approval, only the
  LAST `agent.status` counts, QA/SecOps never count, sum between the two
  sources, isolation between projects);
  `apps/api/test/support/global-setup.ts` (`ensureEngineFixture` — the engine's
  table created as a MINIMAL and declared fixture, only so the test above
  can exist);
  `apps/web/src/components/ProjectCard.test.tsx` (the "N online" badge disappears with
  `0`/`undefined`, appears with `onlineAgentCount > 0`)
- **Origin:** `docs/explanation/backlog.md` (item inherited from PHASE 13c/
  the dogfooding harvest); product decision that the number had to be
  real liveness, not historical presence, recorded in the prompt that
  commissioned this fix

---

## The Runner's folder explorer becomes three columns, and creating a `runner` project no longer waits for the final step (RN-436/436)

### RN-451 — The standalone binary smoke runs the real SUBPROCESS, never a mock {#rn-451}

The same discipline pattern that `smoke-dist.mjs` (ADR 0106) already applies to
the `dist/index.cjs` published to npm now also applies to
`dist-bin/brabo-runner-<platform>-<arch>[.exe]` (ADR 0112): no suite
proves that a PACKAGED artifact works by reading its source code — only by
executing the real artifact, as a subprocess, and observing real
output. `scripts/smoke-bin.mjs` runs the COMPILED binary (never
`node src/index.ts` nor any non-compiled form) with `--self-test-pty`
— an internal flag, not documented in `uso()` — which resolves `node-pty`
exactly as production does and spawns a real PTY via `GerenciadorDePty`,
writing to and reading from it. Only the line `node-pty carregado com sucesso` +
`SELF_TEST_PTY_OK:` in the real process's stdout counts as proof; no
mock of `node-pty` nor of `child_process` is acceptable for this specific
test, because what it exists to prove is precisely that the embedded native `.node`
(`with { type: 'file' }`, `native-pty-embed.generated.ts`)
loads and works INSIDE the binary — mocking any piece of the path
would erase the only thing the test needs to prove.

- **Where:** `apps/runner/scripts/smoke-bin.mjs`; `apps/runner/src/index.ts`
  (`rodarAutoTestePty`, the implementation of `--self-test-pty`)
- **Test:** `smoke-bin.mjs` itself — there's no unit test that
  replaces it, on purpose (it's the same design as `smoke-dist.mjs`, which
  also has no unit counterpart)
- **ADR:** [0112](../adr/0112-binario-standalone-do-runner-via-bun-build-compile.md)
- **Origin:** explicit requirement from the product owner for this backlog
  item ("no mocking")

---

## Local runner terminal stuck at "Opening terminal..." forever (RN-433)

### RN-453 — A relative local runner `--dir` resolves against `INIT_CWD`, not against pnpm's rebased cwd {#rn-453}

`resolve(dirBruto)` in `lerArgumentos()` resolved a relative `--dir` against
`process.cwd()` — correct when the CLI runs directly (standalone binary,
`npm install -g @brabo/runner`), but WRONG in the only invocation path
that exists today without a real npm publication (a real finding, ADR 0106/backlog):
`pnpm --filter runner start` REBASES `process.cwd()` to the PACKAGE's
folder (`apps/runner`), not the folder from which the user typed the command.
`pnpm --filter runner start -- --dir ../exp001`, run from `~/dev/brabo`,
created `~/dev/brabo/apps/exp001` instead of `~/dev/exp001` — silently,
with no error, because RN-435 already makes a nonexistent `--dir` get created instead of
refused.

`resolverDir()` (`apps/runner/src/guard.ts`) resolves against `INIT_CWD`
when present — the variable that npm/pnpm ALWAYS defines with the original
invocation folder, existing only when the process is born from a
`package.json` script — and falls back to `process.cwd()` when absent (direct
binary, where it's already the right folder). Node's `resolve()` already ignores the base
when `dirBruto` is absolute, so an absolute path (the case documented in the
README) doesn't change behavior.

- **Where:** `apps/runner/src/guard.ts` (`resolverDir`), `apps/runner/src/index.ts` (`lerArgumentos`)
- **Test:** `apps/runner/src/guard.spec.ts` (`describe('resolverDir', …)`
  — relative against `INIT_CWD` when present, falls back to the process's cwd
  when absent, absolute ignores both bases)
- **ADR:** [0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
  (additive extension, same category as RN-435 — it reduces invocation friction,
  it doesn't change the runner as source of truth of the path)
- **Origin:** found in real use, running `pnpm --filter runner start --
  dir ../exp001` from inside the monorepo checkout — the only invocation
  path available today, because `@brabo/runner` hasn't really been published
  on npm yet (`NPM_TOKEN` pending, see ADR 0106's backlog)

---

## RAG search leaves a trace, and the trace freezes the weights (RN-479..481)

### RN-481 — `rag.search`/`rag.feedback` are timeline NARRATION, and only exist when there's a session {#rn-481}

The two events enter the event log **only on the agent's path** — the tab's search
is a project one and has no session in which to narrate. That's a declared asymmetry,
not a gap: **the table is the measurement's source, the event is narration**. Measuring through the
event log would lose half of the searches, and precisely the half with human
judgment.

A narration failure takes down neither the search nor the vote: the table's row is already
written, and it's what the measurement reads. The failure becomes a log with origin `infra`, never
silence.

`'rag'` enters `PREFIXOS_DE_EVENTO` (`scripts/docs/generate.mjs`) in the same
commit — without it the generated inventory of `docs/reference/events.md` doesn't see
the two types, and `pnpm docs:check` would be green over an incomplete list:
a doc that passes while lying is worse than a doc that fails.

- **Where:** `apps/api/src/domain/rag/rag-telemetry.ts`
  (`EVENTO_RAG_SEARCH`/`EVENTO_RAG_FEEDBACK`),
  `apps/api/src/application/use-cases/rag/hybrid-search.use-case.ts`,
  `apps/api/src/application/use-cases/rag/record-rag-feedback.use-case.ts`,
  `scripts/docs/generate.mjs` (`PREFIXOS_DE_EVENTO`)
- **Test:**
  `apps/api/test/application/use-cases/rag/hybrid-search.use-case.spec.ts`
  (narrates with a session; does NOT narrate without a session),
  `apps/api/test/application/use-cases/rag/record-rag-feedback.use-case.spec.ts`
  (the same pair, for the vote)
- **ADR:** [0129](../adr/0129-telemetria-de-busca-do-rag-como-tabela.md)
- **Origin:** the product owner's plan, Part 2 / Stage 1

### RN-485 — The container broker doesn't accept a specification: it receives a project and COMPOSES {#rn-485}

The broker (`apps/broker`) is the only process of the product with access to a Docker
daemon on the server. The rule that makes it non-arbitrary isn't an allowlist: it's the
**shape of the input**.

**It receives `projectId` and one of the five operations — nothing else.** The five are those
of the `DockerPort` of [ADR 0128](../adr/0128-porta-de-docker-e-a-prova-de-empacotamento.md)
(`start`, `stop`, `remove`, `inspect`, `exec`), and a sixth is a product decision
with an ADR, never one more parameter. `start`, `stop`, and `remove` have an EMPTY body;
`exec` takes a command and `cwd`, and nothing else.

**The specification is read from the api and COMPOSED here.** The broker calls
`GET /internal/projects/:projectId/container-spec`, which returns the project's
identity, execution mode, and the Arquiteto's current image decision. Image,
network, resources, and the single mount come from there. There's no field where one writes
`privileged`, `cap_add`, `network: host`, or a free `-v` — because there's no
field. If the specification traveled in the body, the containment of a
root-equivalent process on the host would depend on the CALLER being correct, and containment that
depends on the caller isn't containment.

**It revalidates what the api returned, and the two validations aren't the same.**
`validarDecisaoDeImagem` (api) asks "is this architecture decision
reviewable?" — it requires `rationale`, refuses `latest`, applies `RECURSOS_MAXIMOS`, and
returns the refusal to the MODEL through the tool-result (RN-061). `especificacaoValidada`
(broker) asks "can I hand this to the daemon?" — it's the PARSE of an untrusted
JSON into the closed type. The ceilings here are the BROKER's, the last
resort it never exceeds wherever the request comes from; today the numbers
coincide with the api's on purpose, and if one day they diverge the smaller wins without
anything breaking, because neither of the two claims to be the other. One check exists only
on this side: an image reference starting with `-` would be read by the CLI as a
FLAG, and `execFile` without a shell solves COMMAND injection, not ARGUMENT injection.

**The api sends no PATH at all.** The `-v` of a `docker run` is resolved by the
DAEMON, against the HOST's filesystem — a path from inside the api's container
would make the daemon create and mount an EMPTY folder, with the dev agent working in a
directory with no code and nothing indicating why. The broker composes the path with
`PROJECT_WORKSPACES_HOST_ROOT`, ITS configuration, plus the `workspaceDirName`
frozen at creation (RN-109). Without that variable, `start` REFUSES naming it; the
other four operations keep working. Refusing is the rule: guessing
would produce the empty mount silently.

**A `mounted`/`runner` project is refused with 409**, because their folder lives on the
user's machine and the broker's host doesn't see it — there, whoever brings up the container is the
runner. It's the same policy `RegistrarTransicaoDeContainerUseCase` already applies
in the api, stated where the broker can state it.

**Nothing triggers a startup.** There's no loop, no queue, no `container_start`
`proposed_action`: the broker acts when called, and the only caller that exists
today does a READ. External effect still requires approval.

- **Where:** `apps/broker/src/operacoes.ts` (the five, and the composition in
  `especificacaoDoProjeto`), `apps/broker/src/servidor.ts` (the closed list of
  routes and the status table),
  `packages/docker-port/src/spec-de-container.ts` (the parse and the ceilings),
  `apps/api/src/application/use-cases/containers/obter-spec-de-container.use-case.ts`
  (what the api returns, and the path it doesn't return),
  `apps/api/src/interfaces/http/internal/internal-containers.controller.ts`
- **Test:** `apps/broker/src/servidor.spec.ts` (image, network, resources, and mount
  sent in the body are IGNORED; an artifact with an image starting with `-` is 422
  and nothing is touched; a sixth operation is 404; a `cwd` outside `/work` is refused,
  including `/workspace`; without `PROJECT_WORKSPACES_HOST_ROOT` the `start` refuses
  saying which variable is missing),
  `packages/docker-port/src/spec-de-container.spec.ts` (the parse field by field),
  `apps/api/test/application/use-cases/containers/spec-e-observacao-de-container.use-case.spec.ts`
  (the api returns no path at all, nor `rationale`),
  `apps/api/test/infrastructure/http-clients/container-broker.client.spec.ts`
  (`start` sends an empty body)
- **ADR:** [0130](../adr/0130-broker-de-container.md)

### RN-497 — `brabo-runner` brings up the project's container ON THE USER'S MACHINE, with THEIR Docker {#rn-497}

Closes the half that RN-494 (ADR 0135) left declared: `mounted`/`runner`
came to REQUIRE a decided image (RN-105's gate applies in the three modes),
but still brought up NO container — only `execution_mode: container`
had someone (the broker, `apps/broker`) capable of really calling Docker.
`container_start`/`container_stop`/`container_remove` (RN-491/495) now have
a SECOND execution path, branched by the project's `executionMode`
inside `ExecuteContainerStartUseCase`/`ExecuteContainerStopUseCase`/
`ExecuteContainerRemoveUseCase` — never in the action's PROPOSAL nor APPROVAL,
which remain mode-agnostic (`decide.ts` doesn't change).

**`container` goes through the broker, with no change at all.** `mounted`/`runner`
ask the ENGINE (`ApiToEngineClient.startContainerViaRunner`/
`stopContainerViaRunner`/`removeContainerViaRunner`, synchronous like
`executeTerminalAction`) to pass on to the connected RUNNER — the CLI that already
keeps the `terminal:<projectId>` channel (ADR 0103/0104) gains THREE new event
pairs, `container_start`/`_result`, `container_stop`/`_result`,
`container_remove`/`_result` (`apps/runner/src/channel.ts`), in the SAME mold
as `exec`/`exec_result`: `Engine.Runners.RunnerRouter` dispatches to the channel
correlated by `ref` and stays blocked on `receive`, the runner calls
`DockerViaCli.start/stop/remove` (`@brabo/docker-port`, ADR 0128) with the
USER'S DOCKER — not the server's — and answers. `EngineWeb.
ContainerCommandController` (routes `POST internal/projects/:projectId/
containers/{start,stop,remove}`) is the only caller; no other path
reaches those three operations on the engine side.

**The image that comes up isn't ELECTED again** — unlike the
`container` path, which reuses `DecidirImagemDoProjetoUseCase` to write a new
version of `artifact.project_image`. The `mounted`/`runner` path only READS the
CURRENT decision (`ObterSpecDeContainerUseCase`, the SAME use case that already
composes `GET .../container-spec` for the broker — called directly, without HTTP,
because both run in the api's process) and sends it to the runner; without a decided
image (RN-105), it fails BEFORE asking the engine.

**"No runner connected" is a NORMAL FAILURE, never a generic exception** — the same
discipline as `BrokerIndisponivelError`/`BrokerRecusouError` on the
`container` path. `RunnerNaoConectadoError` (no runner, or timeout) and
`RunnerRecusouContainerError` (the runner answered and REFUSED — Docker
unavailable on the user's machine, invalid specification) are the two
classes `HttpApiToEngineClient` throws; the three use cases catch them
and write `failed` with the reason, never letting them propagate. On the engine side, the
response is ALWAYS 200 — `sucesso: false` in the body, with `motivoCodigo`
("not_connected"/"timeout") only when the engine DIDN'T EVEN GET to ask the
runner (`RunnerRouter` returned `{:error, _}`), never an HTTP error status
for what is a normal failure of the command.

**`Engine.Actions.TerminalExecutor` did NOT gain a new output.** The decision
"run the command on the host or inside the container this runner brought up" is
INTERNAL to the runner — `decisao_de_execucao/1` already routes UNCONDITIONALLY
every command of a connected `runner` project to `RunnerRouter.exec/4`
(RN-423). What changes is only `apps/runner/src/index.ts`: `EstadoDoRunner` gains
`containerAtivo` (the NAME of the container THIS runner brought up, or `null`), and
`tratarExec` now routes to `DockerViaCli.exec` (via `docker exec`)
when there's an active container, or to the usual path (`executarComando`
directly on the host) when there isn't — the `cwd`, already validated by
`validarCwdDentroDaRaiz` against the project root, is translated into
`/work` by PREFIX swap (`cwdParaContainer`, `guard.ts`), the same
reasoning as `cwd_para_container/2` on the engine side (RN-492).

**`guard.ts` (containment in `$HOME` on Linux, RN-434) now also covers the
mounted path, with NO new validation.** The container's bind-mount IS
`estado.dir` — the same root `validarDirDentroDoHomeNoLinux` already validated
at the CLI's startup, before any container came up. There's no
second check of "valid mount path" because there doesn't need to be: the
mount IS the confirmed root, period.

- **Where:** `apps/runner/src/channel.ts`, `apps/runner/src/index.ts`
  (`EstadoDoRunner.containerAtivo`, `tratarContainerStart/Stop/Remove`,
  `tratarExec`), `apps/runner/src/guard.ts` (`cwdParaContainer`),
  `apps/engine/lib/engine/runners/runner_router.ex`
  (`start_container/stop_container/remove_container`),
  `apps/engine/lib/engine_web/channels/terminal_channel.ex`,
  `apps/engine/lib/engine_web/controllers/container_command_controller.ex`,
  `apps/engine/lib/engine_web/router.ex`,
  `apps/api/src/application/ports/api-to-engine-client.port.ts`
  (`RunnerNaoConectadoError`, `RunnerRecusouContainerError`),
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`,
  `apps/api/src/application/use-cases/actions/execute-container-start.use-case.ts`,
  `apps/api/src/application/use-cases/actions/execute-container-stop.use-case.ts`,
  `apps/api/src/application/use-cases/actions/execute-container-remove.use-case.ts`
- **Test:**
  `apps/runner/src/channel.spec.ts` (roundtrip of the three new pairs),
  `apps/runner/src/index-handlers.spec.ts` (`tratarExec` routes host vs.
  container; `tratarContainerStart/Stop/Remove` never throw),
  `apps/runner/src/guard.spec.ts` (`cwdParaContainer`),
  `apps/engine/test/engine/runners/runner_router_test.exs`,
  `apps/engine/test/engine_web/channels/terminal_channel_test.exs`,
  `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts`,
  `apps/api/test/application/use-cases/actions/execute-container-start.use-case.spec.ts`,
  `apps/api/test/application/use-cases/actions/execute-container-stop.use-case.spec.ts`,
  `apps/api/test/application/use-cases/actions/execute-container-remove.use-case.spec.ts`
  (the three with describe "mounted/runner (ADR 0137)")
- **Architectural decision:** [ADR 0137](../adr/0137-o-runner-sobe-o-container-do-projeto.md)
- **Origin:** the product owner's plan, Part 1 / PR 1.3

## PHASE 29 — the one-line installation: signing what is published

### RN-525 — The binary proxy checks the hash against the manifest of the same release, refuses when it cannot check, and SAYS that this is integrity and not provenance {#rn-525}

`GET /runner-releases/binary` is `@Public()`, without authentication, and it is step 4 of the
browser setup flow ([RN-473](web.md#rn-473),
[ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)). Until
session 3 of PHASE 29 it validated the INPUT (`platform` against a closed
allowlist) and streamed the bytes from GitHub straight to the client, **without verifying
anything** — it is the consumer that [ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md)
names and [RN-524](ci.md#rn-524) left pending.

Now it **checks the sha256 of the bytes against the `checksums.txt` of the SAME
release** before answering anything, and the `Content-Digest` header
(RFC 9530) repeats the checked hash, so whoever receives it can redo the math.

**What this verification does NOT do, and it is written where it is done.** It does **not
verify the signature** of the manifest (`checksums.txt.bundle`). This is
**integrity against the manifest, not provenance**: whoever can rewrite the
Release rewrites both files and passes. The two ways of closing this were
MEASURED in this session, and both were refused:

| path | measured | why not |
|---|---|---|
| `cosign` in the api image | **155 MB** (`cosign-linux-amd64` v2.6.1) | nearly doubles the runtime image (Alpine + Node), published by digest on GHCR ([ADR 0119](../adr/0119-imagens-publicadas-no-ghcr-por-digest.md)), to verify an optional download |
| `@sigstore/verify` + `@sigstore/tuf` | **2.5 MB, 12 packages** | size is not the cost. `getTrustedRoot()` refreshes TUF metadata against `tuf-repo-cdn.sigstore.dev` (the package's `seeds.json` only seeds the `root.json`), so a public route that today depends on ONE third-party host would come to depend on two. And, by the rule of ADRs [0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)/[0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md) — a capability is only declared when **proven** —, there is no way to prove the path today: **no Release has `checksums.txt.bundle`**, because the `checksums` job was born in session 2 and only runs on a final tag, a gap [RN-524](ci.md#rn-524) itself already declares on the signer's side |

What verifies the SIGNATURE is `install.sh` (session 4/7), which has a real `cosign`
and downloads it pinned with `sha256sum -c` (decision 4 of ADR 0149). **BRB-005
remains open for the provenance half of this route**, and
[the registry](../reference/brb.md) says so — it is not a footnote, it is the limit of what the route
proves.

**A Release without `checksums.txt` is a REFUSAL, never "I serve with a warning".** A warning that
one accepts by clicking is a verification that does not exist (ADR 0149, decision 3) — and
it would be the cheapest downgrade possible: deleting 400 bytes from the Release would turn off
everyone's check. The cost is measured and small: in v5.0.0 there are two
binaries (`linux-x64`, `linux-arm64`) and no manifest, and the binary step is
**best-effort** in the browser flow ([RN-473](web.md#rn-473), step 4) — it falls back to
`npm install -g @brabo/runner`, which depends on no release at all. Every release
prior to the first tag after ADR 0149 falls into that path, by construction.

**The six 502 outcomes do not collapse.** The status alone does not separate them and
they ask different actions of whoever called, so the refusal carries a `motivo`
in the body — `plataforma_nao_publicada`, `release_sem_manifesto`,
`manifesto_nao_cobre_a_plataforma`, `manifesto_ilegivel`, `download_falhou`,
`hash_divergente`. It is the rule of [RN-470](web.md#rn-470) in an api response: "this
platform has not come out yet" says to wait for the next release, "release without a
manifest" says to use npm, and "divergent hash" is an incident. In particular,
"manifest not listed in the release" and "listed manifest that failed to download"
are DIFFERENT outcomes — confusing them would send the person to install via npm because
of a momentary network failure.

**Checking a hash requires reading all the bytes, and that goes through disk.** Buffering
the binary's ~79 MB in memory would be trivial exhaustion on a public route (the api
pod has `limits.memory: 512Mi`), and caching the bytes would be worse — five
platforms × 79 MB. The bytes come down in a **stream** to a temporary file in
`/tmp` (an `emptyDir` mounted precisely because the api's rootfs is read-only), with
the hash computed along the way, and the file is re-read in a stream to the client **only
after** the hash matches: constant memory, and no unchecked byte reaches
the client. A ceiling of 256 MiB aborts an absurd response before filling `/tmp`.
The existing cache (URLs, 5 min) **stays**, and now also keeps the already
parsed manifest — hundreds of bytes of TEXT, never binary bytes —, in the SAME
entry and never in a cache of its own: in different windows, a release published
in the middle would make the new hash be checked against the old binary, and the outcome
would be a `hash_divergente` that would look like tampering.

- **Where:** `apps/api/src/interfaces/http/runner/runner-releases.controller.ts`
  (the verification, the byte ceiling, the temporary file and the `Content-Digest`),
  `apps/api/src/interfaces/http/runner/checksums.ts` (the pure reading of the
  manifest and the union of `MotivoDaRecusa`),
  `apps/web/src/lib/runner-bootstrap.ts` (`baixarBinario` now reads `message`
  and `motivo` from the body, and the sentence reaches `falhaDoBinario`)
- **Test:** `apps/api/test/interfaces/runner-releases.controller.spec.ts`
  (happy path with `Content-Digest`; divergent hash with NO byte or
  header in the body; release without a manifest refusing before downloading the binary;
  manifest that does not cover the platform; unreadable manifest; failed download; and
  the cache keeping release and manifest together) and the `describe('parsearChecksums')`
  of the same file; `apps/web/src/lib/runner-bootstrap.test.ts` (the api's sentence
  and the `motivo` reaching the caller, and a non-JSON body not becoming a second
  exception)
- **Origin:** PHASE 29, session 3. [ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md),
  the third consumer of the table of decision 3 — for the HALF the api can
  prove today, with the other half named instead of faked
| `BACKUP_DIR` points to a directory that exists and does NOT accept writes | the backup refuses BEFORE the `pg_dump`, saying it is WRITING — a read-only destination would pass an existence test and fail later, with the diagnosis pointing to the wrong place (RN-528) |
| A concurrent `git gc` deletes a packfile in the middle of the bare repos `tar` | the execution becomes **`failed`** in `backup_runs`, with the `tar` status named — never a partial archive announcing itself as good, because only a failure becomes an alert (RN-528) |
| `git_local_repos` volume not mounted in the backup container (the k8s CronJob) | the step is **SKIPPED and stated in the log** — and "not mounted" is never collapsed with "mounted and empty", which is the normal state of an installation without a `local` project (RN-528) |
| There are bare repos in the volume and NO archive in the `git-daily/` prefix | `brabo-restore-git` **fails** saying this volume is without coverage — absent-and-empty is another outcome, and exits successfully (RN-528) |
| Truncated bare repos archive | fails when **READ** (`tar -tzf`), never by size: a cut tar has bytes to spare. It is the `pg_restore --list` of the git side (RN-528) |
| `brabo-restore-git --restaurar` on a volume that already has bare repos | refused: overlaying two repository states raises no error at all and only shows up in a `fetch` with the wrong history. `RESTORE_GIT_FORCE=1` for whoever really wants it (RN-528) |
| `brabo-restore-git --restaurar` without being able to write to the volume (uid 70 × api owner) | refuses **BEFORE** the `tar`, naming `--user 0:0` — finding out in the middle of the extraction would leave the volume half done. And what is extracted as root goes back to the DIRECTORY's owner (RN-528) |

### RN-526 — The installer verifies its own origin, NAMES what it found before asking, and never deletes a user folder {#rn-526}

`install.sh` (repository root, versioned and published as a Release asset)
is the single installation door. Four guarantees, and each one exists against a
concrete defect:

**The invocation preserves stdin and leaves a FILE.** The documented form is
`curl -fsSLO …/install.sh && bash install.sh` — download and run a file with
`bash` —, and **never** `curl … | sh`: with the script arriving through the pipe, the process's
`stdin` IS the download, and any `read` reads bytes of the script itself or
hits EOF. An installer that cannot ask would choose on its own where to
create folders on someone's computer — the opposite of the rule RN-511 already applies
to the base consent. Until AT-083 the documented form was
`sh -c "$(curl -fsSL …)"`, and it **never worked**: the verification of its own
origin (the next paragraph) computes the hash of `$0`, and in `X -c "…"` the `$0` is the
shell's name, not a file; with `dash` as `sh` the script died earlier, at
`set -o pipefail`. The maintainer's decision (09/18) was to change the DOC and keep the
verification by `$0`, **without** a skip door (ADR 0150). The wrong forms
became **named refusals**, before the first download, that print the right
form: running under a shell that is not bash (POSIX block at the top, before
`set -o pipefail`) and running without a file (`exigir_o_proprio_arquivo`, which requires the
top-level `BASH_SOURCE` **and** a readable `$0` — `/bin/bash -c` leaves
`$0=/bin/bash`, which exists, and without the first half its hash would go to the
manifest and the person would read the tampering sentence). The form is ONE constant
(`COMO_RODAR`), used by the refusals and by the report without a TTY.

**It verifies its own origin before acting**, and the chain has two links: the
signature of the Release's `checksums.txt` (RN-524), and the hash **of this file**
inside the verified manifest. The `cosign` that performs the verification is itself
pinned by version and checked by hash against the value written in the script — whoever
trusts `install.sh` enough to execute it trusts the hash it
carries, and the chain does not become more fragile than the link that starts it. A failure in
any link is a **named refusal, never a warning**.

**Computing a hash has ONE function and TWO accepted tools** — `sha256sum` or
`shasum -a 256` —, resolved **before the first download** and never in the middle of
a verification: a machine that has nothing to check with should not get to have
anything to check. Lacking both is its OWN **refusal**, which names the two
tools, says where each one lives and asserts that nothing was downloaded — never the
divergent-hash refusal, which is the **incident** one (*"stop and investigate"*). The
distinction is not style: the script called `sha256sum` directly at the five
verification points, macOS does not ship it, and the `command not found` reached whoever
was installing as an accusation of tampering — blocking every installation on the
platform the script itself supports (there is a pinned `cosign` `darwin-*` in it) and
teaching people to ignore the sentence on the day it is true. `--print-plan` runs
without either and declares which one the script accepts (`conferir-hash`). And there is a
THIRD refusal, since AT-083: the tool exists but **cannot read the
file**. Without it, `hash_sha256` returned empty from inside the command
substitution (`errexit` does not reach the subshell) and the next comparison failed with
the caller's incident text — the tampering accusation of AT-091 by another
path. Now it is `falha_ao_calcular_hash`, which names the file and says there was
nothing to compare.

**Detection names what it found.** Through the marker
(`$XDG_STATE_HOME/brabo/install-state.json`) when it exists; through signals
(compose project `brabo*`, units `brabo-runner-*`, binary in the PATH) when
not — and the list is printed **before** any question. There is no path
"I found something and decide on my own". Without a TTY the script **reports and exits 0**, as
`consentir-base.mjs` already does.

**It never deletes a user folder.** The projects base and the mirror folder
are out of reach of any confirmation — the same rule as the mirror
(RN-516): a user folder is accumulation, not product state. A named volume only
goes with confirmation, and listed one by one before asking.

The marker lives in `$XDG_STATE_HOME` and **not** in `~/.brabo/`, which is where the
runner keeps things per PROJECT: installation state and project configuration
are different lives, and joining them would make removing one delete the other.

**Where:** `install.sh` (root).
**Test:** `scripts/dev/install.spec.ts` — the `--print-state` and
`--print-plan` modes prove the DECISION without a TTY, without network and without effect, in the mold of
`bootstrap.spec.ts`; and the block *"o hash num PATH sem sha256sum"* runs the
hash functions in the real shell, with the `PATH` assembled tool by
tool, checking the TWO refusals (absent tool × divergent hash)
and that the first never uses the second's vocabulary;
`scripts/dev/install-invocacao.spec.ts` runs the script through the wrong forms
(`bash -c`, `/bin/bash -c`, pipe, `dash -c`, `dash install.sh`) and demands the
named refusal with the right form before any download, the third hash refusal,
and that runbook, bootstrap and header teach the SAME form.
**Origin:** PHASE 29, session 3 ([ADR 0150](../adr/0150-instalador-de-uma-linha.md)).
In this session the script **installs nothing** — bringing up the compose, generating secrets and
installing the runner are sessions 4 and 7, and it **says so** in the output instead of
ending silently.

### RN-531 — The installer consents ONE base for both sides and installs the local agent already executable {#rn-531}

**One base, consented once.** `install.sh` asks where the projects will
live and writes the same path in BOTH places: `BRABO_PROJECTS_BASE` in `.env`
(the server, [ADR 0141](../adr/0141-base-unica-dos-projetos-montados.md)) and the
`base` field of `runner.json` (the local agent,
[RN-529](runner.md#rn-529)). What differs between `mounted` and `runner` is **who executes**,
not where the code lives — two different bases for the same folder would be the
namespace collision ADR 0141 refused in writing.

The base is refused when it is not absolute, when it is **inside** the Brabo
checkout and when it **contains** the checkout — both directions, as `preflight.mjs`
already does on the server side. The `~` is not expanded on purpose: the value goes
into a configuration file, and a `~` written there is read literally.

**The local agent is installed already executable.** The binary is downloaded, checked
against the **same** signed `checksums.txt` the script already verified to
check itself (RN-524) — downloading it twice would be two chances of getting
different manifests, and the second would not be verified — and installed with
`install -m 0755`, which sets the execute bit in the same act in which it copies.

**This closes BRB-031.** The manual `chmod +x` survived PHASE 28 because
installing as a service did not come from a versioned artifact: whoever got to
run `brabo-runner service install` had already needed to make the binary executable
to get to the command. Coming from the installer, the step disappears — the browser's File System
Access API does not preserve the bit, a script does.

A release without the platform's binary **does not interrupt the installation**: the rest is already
up, and the message points to `npm install -g @brabo/runner`. It is the same
disposition as the binary step in the browser setup (RN-473), and the
reason is the same — the local agent is the last stage, not a prerequisite.

**Where:** `install.sh`, `consentir_base` and `instalar_o_runner`.
**Test:** `scripts/dev/install.spec.ts` — `install -m 0755` present, the
`chmod` instruction addressed to the user absent, and the check against the
signed manifest named.
**Origin:** PHASE 29, session 7 ([ADR 0150](../adr/0150-instalador-de-uma-linha.md),
[ADR 0151](../adr/0151-base-consentida-no-runner.md)).

### RN-534 — The installer enters the signed manifest, and is exercised on a clean machine {#rn-534}

Two halves of the same guarantee.

**`install.sh` enters `checksums.txt` and the Release.** Without that the verification
it does of itself (RN-526) would be a dead letter: it checks its own hash
against the signed manifest, and the manifest did not cover it. The file comes from the
**tag's checkout**, not from a download — it is the same commit that produced everything else
being signed in the same job.

**And it is exercised on a clean machine**, which is what the ephemeral Actions
runner is: a freshly created host, without Brabo, without `.env`, without a marker. The E2E proves,
in this order: the **plan** did not stop promising what it never deletes; the **state**
on a clean machine does not invent a marker or signals; **without a TTY** the installer
reports, exits 0 and **does not write**; and, with a real TTY (not a pipe — the pipe is
precisely what would kill consent), the full installation verifies the
signature, checks its own hash, writes the marker and leaves the `.env` in mode
**600**.

**Correction (AT-083):** the "TTY simulated by `script -qec`" this paragraph
asserted **was never a TTY for the installer**. The step ran
`script -qec "… ./install.sh … < respostas"`, with the `<` INSIDE the `script`
command: the installer's stdin was the file, `[ -t 0 ]` was always false, and the
interactive flow was never exercised. Today what runs the installer is a PTY driver
in Python (`python3 -I`, no new dependency), which puts it on the slave side
of the pty and WAITS for each question before answering — and, for the two password
ones, waits for the echo to be OFF, which proves the "no echo" of RN-547 and prevents
the password from appearing in the output. The E2E also downloads and runs the installer through the SAME
form the runbook prescribes (`curl -fsSLO` + `bash install.sh`, RN-526), and
fails right away if the installer says "Sem terminal interativo". Since the
workflow still does not run on PRs, the driver is extracted from it and exercised in
`scripts/dev/install-e2e.spec.ts` against a fake installer (terminal
seen, answers in order, password out of the output, and the two named stops),
with the old form pinned as the one that did NOT give a terminal.

**It does not run on `pull_request`**, and the reason is the same as for the signature: the
signed manifest only exists after a final tag. Making the script run on a PR
would require giving it a door to SKIP verification — the door ADR 0150
refuses, and which once opened would hold for anyone, not only for CI. It is the
decision the RAG golden-set had already taken by the same reasoning
([ADR 0138](../adr/0138-golden-set-do-rag-em-ci-agendado.md)): what is not
exercisable on a PR runs on its own cadence, and the workflow **says why** instead
of faking coverage.

**Where:** `.github/workflows/install-e2e.yml`;
`.github/workflows/build-runner-binaries.yml`, job `checksums`.
**Test:** the workflow itself — and `scripts/dev/install.spec.ts` keeps
covering the decision without network; `scripts/dev/install-e2e.spec.ts` (block *"o TTY
do E2E é um TTY para o INSTALADOR"*) exercises the PTY driver on PRs.
**Origin:** PHASE 29, session 10 ([ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md),
[ADR 0150](../adr/0150-instalador-de-uma-linha.md)).

> **TODO(humano):** the RNs above were extracted from code and tests. It remains
> to confirm whether there is a business rule **not implemented** that should be
> here — something agreed on and not yet coded does not show up in this sweep.

---

## The agents' artifacts become files, in `docs/` (RN-523)

### RN-542 — The installer compares the installed version with the one it is going to install, and the offer is specific per relation {#rn-542}

`install.sh` detected a previous installation since [RN-530](infra.md#rn-530) and
offered to migrate with a proven backup. What it did **not** know was **which** version
was there: the marker (`$XDG_STATE_HOME/brabo/install-state.json`) recorded
`schemaVersion`, `instaladoEm`, platform, source, digests and paths — and nothing
that said 5.0.0. The question *"migrate this installation?"* was blind on both
sides, and whoever answered had no way of knowing whether it went up, down or repeated.

The information was always at hand and was ignored: the Release's `images.json` carries
`"versao"` next to `commit` and `publicadoEm`, and `resolver_imagens_do_ghcr` read
only `repositorio` and `digest`. From the other end, `--source=local` already requires a
**clean tree on a tag** — so `git describe` is a reliable version there, through the two
refusals that already happened before.

**The order is the decision.** The images are now resolved **before**
detection: knowing what comes in is a prerequisite for asking whether what exists goes out.
The marker goes up to `schemaVersion: 2` and records `versao` and `commit` — the two
together, because a new marker without the field would pass for an old one.

With both versions in hand, the offer stops being one question and becomes four,
one per relation:

| relation | offer | default |
|---|---|---|
| greater | `Atualizar 5.0.0 → 5.1.0?` | **yes** — it is what the person came to do, and the proven backup makes it reversible |
| equal | `Já é a 5.0.0. Reinstalar do zero mesmo assim?` | no — there is no gain to offer |
| lesser | names a **downgrade**, warning that a database migration does not go backwards | no — there may be no going back |
| unknown | a schema 1 marker has no version: says so, and **does not guess** | no |

The `maior` branch is the **only** one with a default of yes, and it is the only one that can have it: the
step is reversible through the backup that was just proven. The other three require
a typed `s`.

**In any branch the installation is deleted and recreated from scratch**, never brought up
on top — a decision of the product owner, and the same reason as RN-530: an `up` over
volumes of another version is damage that gives no warning, and half a migration is worse than
none. The chain backup → **PROVE** → ask → delete → install →
restore does not change in any of them.
`comparar_versoes` is implemented by hand and **not** with `sort -V`: macOS's BSD `sort`
gained `-V` late, and this script runs on other people's machines — the same
discipline that already made `sha_do_cosign` refuse an associative array because of
bash 3.2. It echoes the verdict instead of returning an exit code, because under
`set -e` a legitimate `return 1` would kill the script.

In the `pnpm bootstrap` menu, *Docker › Instalar (install.sh)* **reports** the plan
and does not install — mechanics, not preference: a menu item runs with stdin at
`/dev/null` so the menu keeps reading keys from the same terminal, and this installer
exists to ASK (that is the reason [ADR 0150](../adr/0150-instalador-de-uma-linha.md)
refuses `curl | sh`). It is the same design as the *Base de projetos* item
([RN-511](infra.md#rn-511)), and the item's note carries the command that really installs.

- **Code:** `install.sh` (`comparar_versoes`, `campo_do_marcador`,
  `resolver_imagens_do_ghcr`, `resolver_imagens_locais`, `main`);
  `scripts/dev/bootstrap.sh` (item `1.7`)
- **Test:** `scripts/dev/install.spec.ts` — *"a comparação de versões"* and
  *"o marcador registra a versão"*; the function is extracted from the script and run by
  `bash`, never reimplemented in TS (a copy keeps passing after the
  shell breaks)
- **Found by running, not by reading:** `cut -d.` on a string **without a dot**
  returns the whole line, not empty — so `5.0.0` vs `5` answered `menor`.
  Normalized with `.0.0` at the end, with a regression test.
- **ADR:** [0150](../adr/0150-instalador-de-uma-linha.md)
- **Origin:** request of the product owner — *"o sh deve ser inteligente de
  entender que já há uma versão e verificar se será uma nova versão a ser
  executada ou não... caso seja uma nova ou escolhido isso pelo usuário deverá
  deletar a anterior e instalar do zero para evitar possíveis erros"*

## The device key can now belong to the MACHINE (RN-543, PHASE 30)

### RN-543 — A null `runner_device_keys.project_id` is the MACHINE key: it holds for the OWNER's projects, resolved against the requested project {#rn-543}

The local agent's identity was per PROJECT. A machine with three projects in
`runner` mode had three keys, three folders with
`brabo-runner-device-key.jwk.json` and three service units — and the person went
three times through the same browser flow ([RN-464](api.md#rn-464)..[466](runner.md#rn-466),
[RN-475](web.md#rn-475)) to describe **one** machine. It is item 4 of the five
couplings [ADR 0154](../adr/0154-chave-de-dispositivo-de-maquina.md)
measured; items 1, 2 and 3 (topic, socket id, ticket) describe a **connection**
and N connections satisfy them byte for byte, so **nothing in the engine changes here**.

**One table, two kinds.** Filled `project_id` = the usual PROJECT key.
NULL `project_id` = the MACHINE key. A sibling table was considered and
refused in the ADR: `PatAuthGuard` finds the public key by `kid` and does not need to know the
kind, and two tables would make two lookups — the second forgotten exactly
once. NULL and not a sentinel: the FK is real, and `project_id = '00000000-…'` would require
a fake row in `projects`. `user_id` stays `NOT NULL` — the ADR refuses a
key that crosses users, because the credential describes **who** acts.

**The point that decides everything is a single one.** `PatAuthGuard.autorizarPapel` refused
when the credential's project differed from the route's project. That comparison
was **not** deleted: it is what prevents project A's key from serving project
B, and it disappears **only** for a null `project_id`, because then there is nothing to compare. The
role is now resolved against the **REQUESTED** project, which is ADR 0154 point 2
to the letter — *"authorization remains the usual one, resolved against the
requested project"*. **No new ceiling and none loosened**: the machine key
gives the runner nothing its OWNER did not already have, and an insufficient role in the
requested project is still 403. The PAT branch does not change —
`personal_access_tokens.project_id` stays `NOT NULL`.

**The agent ASKS which projects it serves.** `GET runner/projects` returns the
projects in `execution_mode: 'runner'` in which the credential's owner reaches
at least `developer` — the SAME minimum as `runner-ticket`, because listing a
project whose ticket would be refused is promising what the next route denies. It
asks instead of sweeping the disk: the machine's base belongs to the user and may have a
folder that is no project at all, and guessing by folder name is the class of
error [ADR 0141](../adr/0141-base-unica-dos-projetos-montados.md) refused.
What travels is the SEGMENT (`workspaceDirName`, [RN-109](api.md#rn-109)) and never an
absolute path — the same invariant as the broker.

It is the **first `@RequirePatAuth()` route without `:projectId` in the path**, and the
two consequences are locked by tests: only a MACHINE credential gets in
(a project one describes a single project and has nothing to discover — 403 with its
OWN message, never the "wrong project" one, which would lie about the reason), and
there is no `@RequireRole`, because there is no project to resolve it against. The minimum
is applied per **ROW**, with the product's SINGLE rule
(`ResolveEffectiveRoleUseCase.forProject`, `projectRole ?? workspaceRole` —
[RN-471](web.md#rn-471)); the candidates query in SQL is `alcança`, never `tem
papel`, and rewriting the `??` there would be a second rule. That is why
`route-surface.spec.ts` classifies it as `jwt` — the classifier reads
`@RequireRole` and does not see the mechanism — and `docs/security-surface.md` corrects the
reading in prose, exactly as it already does for `runner-ticket`.

**The listing of [RN-519](api.md#rn-519) now states the KIND.** A machine
key serves every project of the owner, so it enters the listing of all of them —
marked (`especie: 'maquina'`, `projectId: null`). Both halves are
mandatory: without entering the list it would be invisible and permanent on every
screen, which is the defect RN-519 closed reborn in the new kind; without the
mark, the same row would appear in N projects looking like N different keys. The
kind is DERIVED from `project_id` in a single place — there is no column for it, and there
must not be.

**And revocation now has a PLURAL target.** [RN-520](api.md#rn-520) takes down the live
connection of `{projeto, usuário}`, and a machine key names no project at all.
Not taking it down would reopen exactly what RN-520 closed — the key dies for a
NEW ticket and the live connections keep executing approved commands —, now in
N connections instead of one. So revoking a machine key requests a
`disconnectRunnerOfUser` **per project** in `runner` mode the owner reaches. It is
the consequence the ADR declared in advance (*"revoking will take down
all of that machine's projects"*), and it fits **without touching the engine**: the
`{projeto, usuário}` signature stays byte for byte, it is just called N times. The list
comes from the CANDIDATES, without a role filter, and that is deliberate — disconnecting is not
an authorization decision, and missing a project would leave standing what the revocation
exists to kill.

- **Code:** `apps/api/src/db/schema/auth.ts` (`runnerDeviceKeys.projectId`,
  without `.notNull()`); `apps/api/src/db/migrations/0058_public_war_machine.sql`;
  `apps/api/src/interfaces/http/auth/pat-auth.guard.ts` (`autorizarPapel`);
  `apps/api/src/interfaces/http/runner/runner-projects.controller.ts`;
  `apps/api/src/application/use-cases/runner/list-runner-projects.use-case.ts`;
  `apps/api/src/infrastructure/persistence/drizzle/project.repository.ts`
  (`listRunnerModeReachableBy`);
  `apps/api/src/infrastructure/persistence/drizzle/runner-device-key.repository.ts`;
  `apps/api/src/application/use-cases/auth/revoke-runner-device-key.use-case.ts`
- **Test:** `apps/api/test/interfaces/pat-auth.guard.spec.ts` — *"chave de
  MÁQUINA"*, with BOTH directions locked (the machine one holds in any
  project; the PROJECT one stays refused in a different project) and the route without
  `:projectId`; `apps/api/test/application/use-cases/runner/list-runner-projects.use-case.spec.ts`
  (a role below `developer` is left out);
  `apps/api/test/infrastructure/persistence/drizzle/runner-device-key.repository.spec.ts`
  and `.../project-runner-mode.repository.spec.ts` (against Postgres — what
  changed is a `NOT NULL` and a `WHERE`, and no fake proves either of the
  two); `apps/api/test/application/use-cases/auth/revoke-runner-device-key.use-case.spec.ts`
  (*"o alvo da desconexão vira PLURAL"*);
  `apps/api/test/interfaces/http/runner/runner-projects.controller.spec.ts`
- **Gap DECLARED, and CLOSED by [RN-552](api.md#rn-552):** when this RN
  closed, no api route **created** a machine key — the route would be born in the
  PR that had the first real caller, `install.sh`
  ([ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) point 4), never
  before. That is what happened: `POST /internal/machine-device-keys`. The port's type is already the COLUMN's
  (`projectId: string | null`), so the future consumer has nothing to change
  there. And the web still has no screen on which to list or revoke a device key
  (the open half of RN-519): the new kind makes the gap bigger, and it stays
  declared, not closed here. **CLOSED later by [RN-561](web.md#rn-561)**, which is
  the screen — and the kind mark created here is what it uses not to lie
  about the reach of revoking.
- **ADR:** [0154](../adr/0154-chave-de-dispositivo-de-maquina.md)
- **Origin:** PHASE 30, session 2 —
  [the phase's scope](../explanation/fase-30-runner-por-maquina.md)

## An installation's first account is born in the terminal (RN-546)

### RN-546 — An internal route creates the FIRST account, already verified, and refuses when any user exists {#rn-546}

Session 5 of [PHASE 30](../explanation/fase-30-runner-por-maquina.md), decided by
[ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md). It is the api half
of the step that closes the one-line installation; the `install.sh` that consumes this
route is session 6, and it arrived in [RN-547](#rn-547).

**The hole, measured.** In a new installation nobody can get in. The `.env`
the installer generates has **no** email variable at all, `MAIL_TRANSPORT`
falls back to the default `log` (`docker/docker-compose.install.yml`), and normal registration
requires verifying the email — which through a disabled channel does not close. The installation
ends saying "Ready" and the only way out is fishing the link from
`docker compose logs api`.

**The route.** `POST /internal/first-account`, `engine-service` — authenticated by
`BRABO_SERVICE_TOKEN`, in the same header and with the same constant-time
comparison as the other internal routes. Body `{ email, senha, nome? }`, response
`{ userId, email, workspaceId }`, `201`.

**Why internal, and never public.** A public "create the first
owner" route is a race between whoever installed and whoever scanned the port, and whoever loses
the race loses the installation: `owner` of the first workspace is not a role one
recovers via HTTP. The service token closes the race in the right place — it is
generated by `install.sh` itself and written to `.env` with mode `600`, so
presenting it proves control of the **machine**, which is the credential this step
really wants.

**The account is born VERIFIED, and that is the only thing this route loosens.** What
email verification proves is *"this person controls this inbox"*; whoever runs the
installer has already proven something stronger — the machine, the `.env` with the five
secrets and the Docker daemon. Demanding the weaker proof from them, through a channel
the installation knows is off, is theater. **Normal registration stays byte
for byte**: the ADR creates a path for a named case, it does not touch the other one.

**The refusal is about the INSTALLATION, not about the email.**
`UserRepository.existeAlgumUsuario()` (`SELECT 1 … LIMIT 1`, never `count(*)`),
and `409` if there is any user. The question is about `users` and not about
`auth_credentials`, because an account provisioned by social login
([RN-278](api.md#rn-278)) is born without a credential and asking about the credential would say "there is
nobody" in a populated installation. Inheriting the per-email idempotency of
`provisionarUsuario` would turn the route into an account creator with a misleading
name — it would be enough to vary the address. In a migration
([RN-530](infra.md#rn-530)) the users come in the restore and the step goes silent by the same
criterion.

**Personal workspace in the SAME transaction** ([RN-410](api.md#rn-410)). This is the THIRD
account creation point, and it gains no name/slug rule of its own: it calls the
same `nomeESlugDoWorkspacePessoal` as the other two. Without it the installation
would close with a login that goes through and a dashboard where "New project" has nowhere
to create — the half of the hole this phase came to plug, not the other.

**The extraction, and why not `BRABO_FORCE_SEED`.** `provisionarUsuario` refuses
to run with `NODE_ENV=production`, and the installer runs exactly in production. What
the refusal protects is written in its docblock: a **known** password created
**without human interaction**. The route is another category — the password is chosen by a
human in the TTY, read without echo and confirmed, behind the service token, and only when
there is no user at all. So the core (the trio of writes that makes the account
be born verified) became `ProvisionarUsuarioUseCase`, and **the refusal stayed in the
script**, which is what it protects. Telling the installer to declare itself a "forced
seed" would make it cross a rule that never spoke about it, and would loosen the
refusal precisely where it holds.

**One password rule, not two.** The domain's `exigirSenhaValida`, called by the
SAME code registration calls — and that is why this route's DTO does **not** repeat
a `@MinLength`: the call covers the policy's FIVE refusals, not only the
length. The `@MaxLength` stays, because it is not policy: it is argon2id
protection, which copies the input before deriving. `PoliticaDeSenhaError` is a domain
`Error` and has no global filter, so the use case **translates** it to
`400` — without that the installer would read "server error" where the right answer is
"choose another password". Translating there does not touch normal registration.

**Its own kind in the auth trail.** `first_account_created`, and not
`register_created`: the account is born verified without any email having been
sent, and whoever audits later needs to see that written, not deduce it from the
absence of an `email_verified` alongside. A closed union in TypeScript, a `text`
column in the database — a new kind costs no migration.

**No `GET`.** "Is there any user?" is a question nobody needs to ask from
outside: the `POST` answers `201` or `409`, and the `409` is already the answer. A read
route would publish the same fact with one more surface, and its answer
would be exactly the signal a scanner wants.

**The new surface is declared, not hidden.** A second
user creation path that works in PRODUCTION comes to exist. It is narrow on three
independent counts (first account, internal route, service token) and disappears
as soon as the installation has people. It is in
[`security-surface.md`](../security-surface.md), in the ADR's Consequences and here.

**A declared window, not closed.** The "is there any user" check runs
INSIDE the transaction, but `READ COMMITTED` does not prevent two concurrent calls
with different emails from passing together. Closing it would require an advisory lock
on the absence of rows, and that is not where containment lives: whoever reaches the route
already has the service token, that is, already controls the whole installation. What the
condition prevents is the route BECOMING a permanent account creation surface, and
that it prevents.

**What did NOT come in, by the ADR's decision:** a public first-owner route; a password
generated by the code or a default (the password is never written — neither in `.env`, nor in the
marker, nor in a log); SMTP turned on by itself (`MAIL_TRANSPORT=log` stays the
declared default); LLM credential (it belongs to whoever is going to spend,
[RN-058](api.md#rn-058)); and any change to normal registration.

- **Code:** `apps/api/src/application/use-cases/auth/criar-primeira-conta.use-case.ts`
  (the refusal for a populated installation, the password rule, the personal workspace and the
  event), `apps/api/src/application/use-cases/auth/provisionar-usuario.use-case.ts`
  (the extracted core, without the production refusal),
  `apps/api/src/scripts/provisionar-usuario.ts` (only the refusal, plus the
  delegation), `apps/api/src/interfaces/http/internal/internal-first-account.controller.ts`,
  `apps/api/src/interfaces/http/internal/dto/first-account-internal.dto.ts` and
  `…/first-account-internal.response.dto.ts`,
  `apps/api/src/application/ports/user-repository.port.ts` and
  `apps/api/src/infrastructure/persistence/drizzle/user.repository.ts`
  (`existeAlgumUsuario`), `apps/api/src/domain/auth/auth-event.ts`
  (`first_account_created`),
  `apps/api/src/domain/auth/password-policy.ts` (UNTOUCHED — it is the reused rule)
- **Test:** `apps/api/test/application/use-cases/auth/criar-primeira-conta.use-case.spec.ts`
  (happy path with a verified account and personal workspace, the own kind, the
  `409` with a populated installation, the `400` for length and the `400` for a reason
  that is NOT length, and the name fallback);
  `apps/api/test/interfaces/http/internal/internal-first-account.controller.spec.ts`
  (the pass-through to the use case, the absent `nome` becoming `null`, and the three
  guard refusals: absent header, wrong token, right token);
  `apps/api/test/scripts/provisionar-usuario.spec.ts` (the production refusal
  STAYED in the script, and the delegation);
  `apps/api/test/interfaces/route-surface.spec.ts` (the route classified)
- **ADR:** [0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md), which depends
  on [0154](../adr/0154-chave-de-dispositivo-de-maquina.md)

## `install.sh` closes the installation (RN-547, PHASE 30)

### RN-547 — The installer creates the first account, registers this machine's key and brings up the agent as a service — and what fails in the middle is REPORTED, never undone nor swallowed {#rn-547}

Session 6 of [PHASE 30](../explanation/fase-30-runner-por-maquina.md), decided by
[ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md). The session would touch
three workspaces at once and was **split into three**: the two pieces of the agent
and of the api have already closed ([RN-546](#rn-546), [RN-551](runner.md#rn-551), [RN-552](api.md#rn-552),
over the unit of [RN-545](runner.md#rn-545)), and what remained here is `install.sh` as an
**orchestrator and nothing more** — no line of `apps/` was touched, and no
route was born.

**The hole it closes.** A new installation ended saying "Ready" with a
login that NOBODY got through: the generated `.env` has no email variable
at all, `MAIL_TRANSPORT` falls back to the default `log`, and normal registration requires
verifying the email. The only way out was fishing the link from
`docker compose logs api`. And the local agent stayed installed without a credential,
waiting for someone to go back to the browser to pair a folder.

**The chain, and every link already existed.** `POST /internal/first-account`
([RN-546](#rn-546)) → `brabo-runner device-key create` ([RN-551](runner.md#rn-551)) →
`POST /internal/machine-device-keys` ([RN-552](api.md#rn-552)) → `device-key finish
--id <id>` → `brabo-runner service install --machine`
([RN-545](runner.md#rn-545)). The `id` the api returns on registration is what becomes the private key's `kid`,
and the whole chain only PASSES IT ON — nobody derives it from anything else
([RN-475](web.md#rn-475)). The service's `--dir` comes from the PATH the `finish`
printed, not from a second calculation by the script about where the configuration folder
is.

**What happens when a middle link fails: nothing is undone, everything is
REPORTED, and the script always exits 0.** It is this delivery's decision, and the argument is
that the links already fulfilled are useful on their own — with the account created the person gets in,
with the key registered the machine is paired, and the service is the only step
they repeat by hand with a command the script prints. Undoing would require deleting the
account and revoking the key, and there is no route for that nor should there be one the
installer calls on its own. The price is that an installation can end up half
done; what it never does is end half done SILENTLY — each failure
becomes a named line in a **"What was left pending"** block, at the end, where whoever
installed is still looking. Taking down the whole installation because of the last
step would trade half an installation for none.

**Idempotency is the HTTP CODE, and `409` is not a failure.** Both routes answer
`409` when the installation already has people — a second run, or a migration
([RN-530](infra.md#rn-530)) whose restore brought the users. That is the
EXPECTED outcome: the step goes silent saying why, and does **not** enter the pending items.
Any other code is a failure, and shows up with the code and the api's response
alongside. `000` — the curl that never got to talk to the api — has its own treatment
for the same reason: collapsing it with a response code would make "the api did not come up"
read as "the api refused". And the agent step only runs when THIS run
created the account: with a pre-existing user, registering a machine key would mint
a durable credential for someone who asked for nothing in this round.

**The password touches neither disk nor `argv`.** Read in the TTY without echo (`stty -echo`, with the
terminal mode restored at the end), confirmed, and sent to the api via the `curl`'s
**STDIN** — never via `--data` on the command line, which `/proc/<pid>/cmdline`
publishes to any user of the machine, and never via a file. The header with
the `BRABO_SERVICE_TOKEN` goes in a mode-600 `--config`, deleted right after: it
is a secret too, and that secret already lives on disk, in `.env`, with the same mode.
Without `stty` on the machine the step is **refused**, never degraded to asking
with echo — promising no echo and delivering with echo is worse than not asking. The password
does not go to `.env`, does not go to the marker and does not go to any log; the
marker gains the **email**, which identifies and is not a secret, and
`MARCADOR_SCHEMA` goes up to **3** together with the field, by the same rule that made it
go up to 2 when gaining `versao`.

**The password refusal is repeatable, and the ceiling is 3.** The policy is the domain's
([RN-546](#rn-546)), the same as normal registration, and it is only known AFTER the
POST. Aborting the installation there would leave someone with the compose up and the
second run falling into the migration path — so the loop is over the
question+answer pair, and exhausting the ceiling becomes a named pending item instead of a refusal.
A typed password different from the confirmation never leaves the machine.
A tab in what was typed is **refused** and never silently removed: an
installer that rewrites the password produces an account whose password is not the one the
person typed.

**The refusal of `service install --machine` is the COMMON case on a developer's
machine, and it arrives in its own words.** `install --machine` refuses
when there is a per-PROJECT unit installed, without `--force` ([RN-545](runner.md#rn-545):
*"installing and warning would leave the wrong installation up"*). The installer
passes on the CLI's output WHOLE instead of summarizing it — it is what names the
`uninstall` of each unit found, which is the gesture — and the pending item carries the
exact command to repeat later.

**The key's `name` is the `hostname`, and the choice is this script's.**
[RN-551](runner.md#rn-551) declares in writing that the CLI does **not** name: the `name` is a
field of the record, and whoever names is whoever registers. Whoever opens the list of device
keys needs to know WHICH machine to go to, and the hostname is the name the
person already uses to talk about their machines — it is what the shell prompt shows.
It is not a secret, it is not unique, and the api derives nothing from it. Quotes and slashes go
(they would move out of place inside the JSON), the cut is at 80 (the DTO's `@MaxLength(80)`,
applied here so the refusal does not come from the api) and the total absence of `hostname` and
`uname` returns a fixed name — empty would become a `400` by `@MinLength(1)`, after
the account already exists.

**The `.parcial` left over when the registration does not close STAYS where it is, and is
named.** The `create` writes the private key to a file with a `.parcial` suffix that the
runner ignores by construction ([RN-551](runner.md#rn-551)), and if the registration fails it
is left over. Deleting it would be the installer deciding it knows something it does not: a
timeout after the api writes is indistinguishable from a timeout before, and the
file may be the only copy of the private half of an already registered key. It
is inert, the next `device-key create` names it and replaces it, and the message
says both things.

**What this script does NOT do, and now says it right.** The last line of the output
announced, months after the functions existed, that it *"does not pair the local
agent"* and that the key *"still comes from the project screen"*. The text was
rewritten: SMTP stays off by decision (`MAIL_TRANSPORT=log`, here as
in production — and the account created is born verified precisely because of that), the LLM credential
still belongs to whoever is going to spend
([RN-058](api.md#rn-058)), and pairing through the project screen
([ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md))
still exists for whoever wants it — what changed is that it stopped being
mandatory. The `--help` suffered from the same defect in a place no test
reached (it prints the HEADER, which is a comment, and the rule forbidding talk
of "phase sessions" only read code lines): it said *"THIS VERSION INSTALLS
NOTHING"*. Fixed, and the fixed line range that cut it off
silently became "up to the first line that is not a comment".

**What did NOT come in:** a new route of any kind (the session is orchestration —
if something were missing on the other side, the gesture was to stop and report); SMTP; LLM
credential; a password written anywhere; and any path that creates an account without
a TTY — without an interactive terminal the script reports and **exits 0**, at the step that already
existed, before any write.

- **Code:** `install.sh:1664` (`fechar_a_instalacao`, the chaining and the
  "always 0"), `:1463` (`perguntar_e_criar_a_conta`, the consent, the loop and
  the ceiling), `:1563` (`parear_esta_maquina`, the `id` becoming `--id`), `:1640`
  (`subir_o_agente_como_servico`, the refusal passed on whole), `:1366`
  (`post_interno`, the body via stdin and the header via the 600 `--config`),
  `:1385` (`criar_primeira_conta`) and `:1426` (`registrar_chave_de_maquina`) —
  the verdicts of the two routes —, `:1441` (`ler_sem_eco`), `:1345`
  (`nome_da_maquina`), `:1586` (`avisar_chave_parcial`), `:1208`/`:1215`
  (`escapar_json`/`sem_controle`), `:108` (`MARCADOR_SCHEMA=3`), `:1871` (the
  call, after the runner and before the marker), `:1882` (the `ownerEmail`).
  Numbers re-read by symbol on 09/18 (AT-096), on 09/27 (AT-065, which
  added the Mac Intel branch in `instalar_o_runner`) and on 10/01 (AT-122);
  those of `:966`/`:682` no longer matched on 09/17
- **Test:** `scripts/dev/install-fechamento.spec.ts` — the shell functions
  run FOR REAL (the whole script loaded by `source`, minus the call
  to `main`) against a real `node:http` server and a stand-in `brabo-runner`: the
  account's happy path (body, service token and password arriving), `409`/`400`/
  `500`/no-response with DIFFERENT verdicts, the password loop and the ceiling of 3, the
  order `create → registrar → finish → service install` with the `--id` being the
  api's `id`, the `service install` refusal passed on in its own words, the
  `.parcial` that stays when the registration fails, the `create` that refuses without anything
  being registered, and the closing without the agent's binary; `scripts/dev/install.spec.ts`
  (the printable plan, and the `--help` that stopped lying)
- **Gap DECLARED:** the end-to-end installation on a clean machine —
  real compose, real api, real runner binary, unit written
  and agent waiting for the first project — is the **E2E** of the phase's session 8, and only
  it can prove it. Here `brabo-runner` is a shell stand-in and the api is a
  test server; what is proven is the CHAINING, never the integration. And the
  main flow of `install.sh` (verifying its own origin against the signed
  `checksums.txt`) still has no coverage, for the reason
  `install.spec.ts` already recorded: no Release has that asset until the next
  final tag
- **ADR:** [0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md)
- **Origin:** PHASE 30, session 6 —
  [the phase's scope](../explanation/fase-30-runner-por-maquina.md)

## The self-movement ceiling on the WORKSPACE upsert, and the self-promotion that closes (RN-557)

### RN-557 — Changing one's OWN role is refused with 403 on both membership routes, in both directions {#rn-557}

> **Extended by [RN-615](api.md#rn-615) (ADR 0173):** the workspace member removal route
> said below not to exist came to exist, with the SAME ceiling
> (removing oneself is 403) — and it is that clause that holds the last owner, without
> counting. The reasoning below about ceiling 1 still holds.

The third and last door of the line opened by [RN-472](api.md#rn-472) and continued by
[RN-556](api.md#rn-556). [ADR 0127](../adr/0127-tetos-de-rebaixamento-em-project-members.md)
declared this one in writing — *"`POST workspaces/:workspaceId/members` remains an
upsert with no ceiling at all — same class of defect, scope above"* — and
[ADR 0156](../adr/0156-teto-de-auto-rebaixamento-na-remocao.md) reaffirmed it as
"different scope, separate decision". It is `BRB-002`, security P1.

**The defect, measured.** `AddWorkspaceMemberUseCase.execute` received
`(workspaceId, userId, role)` and called `workspaces.addMember` — **it did not receive the
actor** —, and the controller (`@Post(':workspaceId/members')`,
`@RequireRole('owner')`) called it with the bare body, without `@CurrentUser()`. There
was nothing with which to apply any ceiling.

**Why it is more serious one scope above.** Two things that exist in the project do not
exist here: (a) **there is no level above to catch the fall** — in the project,
demoting oneself drops the effective role to the workspace role, which often
holds it; in the workspace the role is the role, and an `owner` who writes themselves `viewer`
loses the entire workspace, with all the projects and the very capacity to invite
whoever would restore them; (b) **there is no member removal route** —
`WorkspacesController` has no member `@Delete` (measured, and ADR 0156 had
already used that fact). Undoing is this same route, which requires the just
abandoned `owner`.

**Self-PROMOTION was a loophole, and it closes.** ADR 0127 recorded in the Consequences
that it stayed: *"A `maintainer` can write themselves as `owner` of the project (…) the
ceilings are about going down"*. This RN **revises** that sentence. The two halves are the
same movement — a person deciding alone what authority they have — and the upper one
is the only one that **escalates privilege**: ADR 0127 could say its ceilings
were not about escalation ("nobody gains a role they did not have"), and about promotion
that is false.

| movement | outcome |
|---|---|
| changing one's own role in the PROJECT, downward | **403** — [RN-472](api.md#rn-472), unchanged |
| changing one's own role in the PROJECT, upward | **403** — it was allowed, and this is what changes |
| changing one's own role in the WORKSPACE, in any direction | **403** — the new door |
| rewriting one's own role with the SAME value | passes — an idempotent upsert is not a movement |
| an `owner` demoting ANOTHER `owner` in the workspace | passes — it is the only way to revoke ownership |
| associating/demoting ANOTHER person, in any scope | passes — the usual legitimate capability |
| self-promotion through REMOVAL of the project row | passes — protected by ADR 0156, point 3 |

**The ceiling does NOT count owners.** Refusing only when the caller is the last
owner was considered and refused by the literal criterion of ADR 0127: *"it is stated in a
clause, it has no number to age"*. A count adds a read
that can get out of phase with the write, has to judge whether an inactive second owner
counts, and makes the same call with the same body pass today and refuse tomorrow without
anything the caller controls having changed. And the clause **already produces the
invariant the count would exist to guarantee**: a workspace is never left without an
`owner`, because removing the last one would require them to do it themselves.

**Ceiling 1 has no counterpart in this scope, and it was considered, not mirrored.**
Unlike removal ([RN-556](api.md#rn-556)), here the movement EXISTS — an `owner`
can demote another. The refusal comes from ceiling 1 being a rule about **hierarchy
inversion**: in the project the row overlays the workspace one ([RN-471](web.md#rn-471)) and
a `maintainer` reaches whoever is ABOVE them; in the workspace
`@RequireRole('owner')` already guarantees nobody reaches someone bigger than themselves — the
precondition is absent. Putting the counterpart, added to the absence of a removal route, would make
`owner` an **absorbing state**: nobody would leave it via HTTP, and offboarding,
ownership rotation and correcting a wrong invite would come to require a direct write
to the database — the class of state ADR 0127 was born to eliminate, with the
sign flipped.

**The rule is not copied: the comparison becomes ONE classifier.**
`autoMovimentoDoProprioPapel` returns the DIRECTION
(`'rebaixamento' | 'promocao' | null`) instead of a boolean, because whoever calls
needs it to choose the message. `ehAutoRebaixamento` keeps existing
as a READING of the classifier, and for a behavior reason and not a
compatibility one: `remocaoEhAutoRebaixamento` delegates to it, and widening it would make
REMOVAL also refuse self-promotion — removing one's own row that restricted
someone is precisely how one undoes the restriction ceiling 1 prevents from creating,
a movement ADR 0156 protected in writing.

**Four messages, one per DIRECTION and per SCOPE.** Whoever tried to promote themselves does not
receive the demotion sentence (it is not what they did), and whoever hits the
workspace ceiling is not told to talk to a `maintainer` — there the role that undoes is
`owner`. The same discipline as point 5 of [RN-556](api.md#rn-556) and of
[RN-470](web.md#rn-470).

**The actor's role comes from the repository, not from `ResolveEffectiveRoleUseCase`** —
the inverse of RN-556's choice, for the same reason it gave: in the project use
cases the other one comes in so the actor's role does not become a second hand-written
composition of `projectRole ?? workspaceRole`; in the workspace there is no composition
to protect (`forWorkspace` IS `workspaces.findMemberRole`), and this use case already
has the repository in hand.

**The PROMOTION half in the workspace is unreachable via HTTP, and is applied
anyway.** With `@RequireRole('owner')` the actor is already at the top and there is nowhere to
go up. It goes in and is tested for the reason ceiling 2 always had for not having a
threshold: the use case does not presume the guard, and it is what stays right on the day
the route changes its minimum. The same design as the capability refusal of
[RN-514](engine.md#rn-514), implemented before it had any trigger.

**No web line changes, and it is not an omission:** `POST /workspaces/:workspaceId/members`
has no caller in `apps/web` — measured; the only occurrence is the generated type in
`api-types.generated.ts`. There is no toast to adjust nor `Select` to close.

- **Code:** `apps/api/src/domain/iam/tetos-de-rebaixamento.ts`
  (`autoMovimentoDoProprioPapel`, the type `SentidoDoAutoMovimento`, the three
  new messages and the `ehAutoRebaixamento` that became a reading of the
  classifier),
  `apps/api/src/application/use-cases/iam/add-workspace-member.use-case.ts`
  (the signature with `atorId`, the read of the actor's role and the two 403s),
  `apps/api/src/application/use-cases/iam/add-project-member.use-case.ts`
  (the swap of `ehAutoRebaixamento` for the classifier, which is what closes the
  self-promotion there),
  `apps/api/src/interfaces/http/iam/workspaces.controller.ts`
  (`@CurrentUser()`, the `@ApiForbiddenResponse` and the description),
  `apps/api/src/interfaces/http/iam/dto/add-member.dto.ts` and
  `apps/api/src/interfaces/http/iam/projects.controller.ts` (the descriptions that
  promised "no ceiling at all" and "downgrading yourself"),
  `apps/api/src/db/seed.ts` (the `owner.id` as actor),
  `apps/api/src/application/use-cases/iam/resolve-effective-role.use-case.ts`
  (UNTOUCHED, third ADR in a row)
- **Test:** `apps/api/test/application/use-cases/iam/tetos-de-rebaixamento.use-case.spec.ts`,
  block *"Teto de auto-movimento no WORKSPACE — a quarta porta"* (the refusal with
  another owner present, the refusal of the sole owner, the unreachable promotion, the
  message per scope, the idempotent upsert, the `owner` demoting another `owner`
  and the association of third parties), plus the three cases in the ceiling 2 block — the
  self-promotion test INVERTED, with the name keeping its origin, the assertion that
  each direction has its sentence, and the idempotent upsert in the project
- **ADR:** [0157](../adr/0157-teto-de-auto-movimento-no-upsert-de-workspace.md),
  which references [0127](../adr/0127-tetos-de-rebaixamento-em-project-members.md)
  and [0156](../adr/0156-teto-de-auto-rebaixamento-na-remocao.md), and revises the first's
  sentence about self-promotion
- **Origin:** `BRB-002`, Security P1 of the maintainer's registry — the last
  movement the two previous ADRs left declared

---

## The device key gets a screen, and the screen states the reach of revoking (RN-561)

### RN-570 — The installer brings up the installation only with files the Release signed, checked before asking or writing anything {#rn-570}

[RN-549](ci.md#rn-549) measured, the first time the installer ran on a clean
machine, that the published `install.sh` **brought up nothing on its own**: it called
`docker compose -f docker/docker-compose.install.yml`, a path RELATIVE to the
directory it ran from, and that file was not a Release asset, did not enter
the signed `checksums.txt` and was not downloaded anywhere. Whoever followed the
runbook's one-liner died in *"no such file or directory"* AFTER the script
had written the `.env` with the secrets. The maintainer decided the way out on
2026-09-13 — a signed asset, and not a clone ([ADR 0160](../adr/0160-o-compose-do-instalador-viaja-assinado.md)).

**The rule:**

1. **Four files travel with the installer, in the SAME manifest.** The installation
   compose and the three the installation uses by relative path — the
   `postgres/init.sql` and the `ollama/pull-models.sh` that the compose bind-mounts, and the
   `backup/test-restore-compose.sh` that the migration ([RN-530](infra.md#rn-530)) executes —
   are published as `brabo-install-*` assets by the `checksums` job and enter the
   `sha256sum` that generates the signed `checksums.txt`. The fourth was not in the
   E2E's workaround and was found while implementing: in a folder without a checkout the
   migration would die there. The job checks each manifest line against the file
   (`sha256sum -c --strict`) before attaching.
2. **The table has two sides and a guard.** The publisher reads
   `scripts/ci/assets-do-instalador.ts`; the downloader reads the `case` of
   `destino_do_asset_do_instalador` in `install.sh` (bash 3.2, without Node). The spec
   fails the divergence between the two AND derives from the compose every `./…` bind-mount
   that is not in the table — which is exactly how the defect was born.
3. **Verifying comes right after its own origin, and before everything.** The
   installer downloads the four and compares each sha256 against the `checksums.txt` that
   `verificar_a_si_mesmo` already verified (never a second download), by
   EXACT name equality. The three refusals are distinct — asset not published,
   manifest that does not cover it, hash that does not match — and all happen with the
   machine untouched.
4. **It never falls back to the relative path.** `COMPOSE_DE_INSTALACAO` is born EMPTY and only gets an
   absolute path when the verified copies are put under the installation's folder,
   at the first instant they are needed (the migration or the
   startup). Whatever is already there is REPLACED, never read — with `rm` before the
   `cp`, so a symlink does not carry the write outside.

**What this rule does NOT close:** the end-to-end proof only happens on the first
final tag after the merge — `install-e2e.yml` does not run on PRs (ADR 0150) —, and
no already published Release gains the assets: they stay with the old
installer and the workaround of running it from inside a checkout at the tag. The adjacency
ADR 0160 declared — `test-restore-compose.sh` called Compose without
`--env-file`, and Compose looks for the `.env` in the compose's folder — closed in
AT-102: the installer passes `BRABO_ENV_FILE` (`--env-file`, and not
`--project-directory`, which would also change the project's name and the base of the
relative paths) and the installation compose declares the `backup_local` volume
that the `backup` service references, whose absence refused the whole file with the
profile on. Covered by `scripts/dev/prova-de-restauracao-env.spec.ts`.

- **Code:** `install.sh:128` (`COMPOSE_DE_INSTALACAO` empty until materialized),
  `:587` (`ASSETS_DO_INSTALADOR`), `:589` (`destino_do_asset_do_instalador`, the
  downloader side's table), `:614` (`baixar_e_verificar_os_arquivos_da_instalacao`),
  `:607`/`:615`/`:617` (the three refusals), `:648`
  (`materializar_os_arquivos_da_instalacao`), `:1573` (the migration materializes
  before the backup), `:1677` (the verification right after its own origin),
  `:1831` (the startup materializes before the `up`);
  `scripts/ci/assets-do-instalador.ts:55` (the publisher side's table), `:93`
  (`problemasDoMapeamento`), `:135` (`prepararAssets`);
  `.github/workflows/build-runner-binaries.yml:468` (the assets prepared from the
  tag's checkout), `:494` (in the same `sha256sum`), `:520` (the
  `--strict` check), `:527` (attached together with the manifest)
- **Test:** `scripts/dev/install-arquivos-da-instalacao.spec.ts:144` (happy
  path against a fake Release), `:162` (absent asset, `.env` never
  written — failure case), `:179` (hash that does not match — failure case), `:191`
  (manifest that does not cover), `:202` (a similar name does not cover), `:217`
  (materializing without verifying is a refusal), `:225` (what was already there is replaced,
  and the symlink does not carry the write outside), `:258`/`:273`/`:280` (the order in
  `main` and in the migration); `scripts/ci/assets-do-instalador.spec.ts:89` (every
  relative bind-mount is an asset), `:114` (the shell's `case` is the
  TypeScript table), `:148`/`:152`/`:161` (the pipeline signs, checks and attaches);
  `scripts/dev/install-e2e.spec.ts:247` (the manual workaround does not come back, and the E2E
  asserts the installer downloaded them), `:295` (the token that downloads the manifest is not
  in the installer's environment)
- **Origin:** AT-026 — the finding of AT-008 (RN-549), decided by the maintainer on
  2026-09-13

## The container broker in the installation, with consent (RN-575)

### RN-575 — The installer only turns on the container broker with a typed "s", measures the socket's group from inside a container, and writes the four lines together or none {#rn-575}

In an installation by Release, a `container` or `mounted` project never executed:
what starts the container of those two modes is the broker ([ADR 0144](../adr/0144-a-segunda-raiz-do-broker.md)),
and the installation did not have the service because the image was not published (ADR 0150,
decision 7). [ADR 0162](../adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)
publishes the image as the fifth and puts the service in the installation compose,
OFF; this rule is what decides when it turns on, because turning it on hands the
machine's Docker socket to an installation service.

**The rule:**

1. **Only a typed "s"/"sim" turns it on.** The question comes after the base (the broker's second
   root derives from it) and before the `.env`, and SAYS in text what it grants —
   this machine's Docker socket, and that whoever commands the broker commands
   Docker — and what contains it. Enter, any other answer and the lack of a
   terminal leave it off, and the lack of a terminal is STATED, never decided
   silently. While the answer is not yes, Docker is not touched.
2. **The socket's group is MEASURED, from inside a container**, with the broker's own
   image, no network, read-only rootfs and the socket mounted by
   `--mount type=bind` — which refuses a nonexistent source instead of creating a
   folder on the host, as `-v` would. It is the gid seen from inside that `group_add`
   needs (in Docker Desktop the host's says nothing). A measurement that fails, a path
   that is not a socket or a gid that is not a number are a named REFUSAL, which teaches to
   run again answering no — never the compose default's `999`.
3. **The four lines go together or none goes:** `COMPOSE_PROFILES=container-broker`,
   `BROKER_URL=http://broker:8090`, `DOCKER_GID` and `PROJECT_WORKSPACES_HOST_ROOT`.
   A profile without a URL brings up a broker nobody calls; a URL without a profile points the
   api to a service that does not come up. `escrever_env` refuses to write the block without the
   measured gid — a defect of the script, not of the machine. `BRABO_BROKER_IMAGE` is
   ALWAYS written, on or not: Compose interpolates the whole file before
   filtering by profile.
4. **The managed folder's root is COMPUTED and then CHECKED.** Before
   startup, `<DockerRootDir>/volumes/brabo_project_workspaces/_data`; after,
   compared with the volume's `Mountpoint`. Diverging, or the api not reaching the
   broker over the internal network, becomes a named PENDING item at the end — never a refusal, which
   would take down an installation that is up because of a step fixed by editing the
   `.env`.
5. **The decision shows up in the final summary**, in both directions, and the sentence about what
   the installer does NOT do stops saying that only the Mounted folder stays without a
   container: `container` does too.

**What this rule does NOT close:** the `DOCKER_GID` and the computed root were not
measured on Docker Desktop for macOS, and the tag's E2E runs the interactive half only
on Linux. Rootless or remote Docker does not have the socket at `/var/run/docker.sock`,
which is the path the compose mounts, and falls into the refusal of item 2 — turning the broker on
there is not offered by another path.

- **Code:** `install.sh:1050` (`consentir_broker`), `:1002`
  (`medir_gid_do_socket`), `:1037` (`calcular_raiz_gerenciada`), `:1034`
  (`conferir_o_broker`), `:792` (`escrever_env_do_broker`), `:855` (the broker in the
  manifest), `:1812` (the order: after the base, before the `.env`);
  `docker/docker-compose.install.yml` (the `broker` service and the `broker` network)
- **Test:** `scripts/dev/install-broker.spec.ts:158` (without a terminal: off,
  stated, Docker untouched — failure case), `:169` (Enter), `:179` (`n`), `:187`
  (`s` turns on, with `--mount` and no network), `:208`/`:221`/`:229` (the three refusals),
  `:237` (the root as a pending item), `:248` (the final sentence);
  `scripts/dev/install-env.spec.ts:250`/`:259` (the four lines together or
  none), `:270` (the gid guard), `:291`/`:307` (the `.env` against Compose's
  parser: the broker comes up without a flag, with the token, the two roots and the gid, and the api
  points to it — or none of that); `scripts/dev/composes-em-conformidade.spec.ts:114`
  (the layers of ADR 0130 in the file that travels)
- **ADR:** [0162](../adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)
- **Origin:** AT-097 — decided by the maintainer on 2026-09-18

---

## The installer offers the local models, and does not mistake dev for an installation (RN-691, RN-692)

### RN-691 — `install.sh` ASKS whether to switch on the local models (profile `llm`), measures the Ollama port before writing, and composes ONE `COMPOSE_PROFILES` line {#rn-691}

Measured in a real installation of v7.0.0 (AT-351): every business rule recorded
`backlog.semantic_duplicate_check_skipped` with `getaddrinfo EAI_AGAIN ollama`,
because the installation from a Release starts without the `llm` profile and the installer never
asked; switching it on by hand hit `address already in use` on 11434, the
port of a NATIVE Ollama on the host.

**The rule:** after the broker question ([RN-575](#rn-575)), the installer states
the COST (disk for the image and for the models the `ollama-model-loader` downloads, RAM
with a model loaded) and what is LOST without it (the semantic
duplicate check of [RN-681](api.md#rn-681) and a local model for the agents), and only a typed "s"
switches it on; without a terminal it stays off SAYING so. Switching on MEASURES the host
port before writing anything — 11434, or the first free one up to 11443,
through bash's own `/dev/tcp` (3.2 included) — and the whole range being taken is a NAMED
refusal, with nothing written, never an `address already in use` on startup.
The `.env` gets `OLLAMA_PORT` and the `llm` profile; the consented profiles go out
in a SINGLE `COMPOSE_PROFILES` line (`container-broker,llm`), because two
lines do not add up — the last one would win and the broker would silently vanish.

Left OUT, declared: the session stating ONCE that the semantic check was
skipped (api side, another front); and the tag's E2E answers NO (switching on would
download GBs of models), so startup with the `llm` profile is not proven end
to end.

- **Where:** `install.sh:1128` (`consentir_llm`), `:1113`
  (`escolher_porta_do_ollama`), `:1103` (`porta_em_uso`), `:800`
  (`escrever_env_do_llm`), `:821` (`escrever_env_dos_profiles`)
- **Test:** `scripts/dev/install-llm.spec.ts` (without a terminal it stays off
  stating the cost; 11434 taken picks the next one; whole range taken fails
  — failure case; a listening server is measured as in use; broker and models
  in a single line); `scripts/dev/install-e2e.spec.ts` (the answer to the new question
  is in the TTY driver's list, in order)
- **Origin:** AT-351

### RN-692 — Only the `brabo` compose project is a previous installation, and migration offers reinstalling FROM SCRATCH after the proven backup {#rn-692}

`detectar_por_sinais` matched `"Name":"brabo[^"]*"`, and the DEV compose
(`brabo-dev`, ADR 0170) counted as a previous installation — the installer
offered to migrate the development environment. Now it matches only the EXACT name
`brabo`.

And the migration confirmation gets a third answer: `z` reinstalls FROM
SCRATCH. The order of ADR 0150 does not change — backup, PROOF, question, delete, install —,
but the old data is NOT restored: the proven backup stays in the folder, and
restoring it later is the runbook's `#restore`. `s` keeps restoring, and Enter
still deletes nothing.

Along with it, the wrap-up stops saying that pairing a folder through the project screen
"still exists (ADR 0118)": that flow left in ADR 0203 ([RN-687](web.md#rn-687)).

- **Where:** `install.sh:370` (`detectar_por_sinais`), `:1694`
  (`migrar_instalacao_anterior`)
- **Test:** `scripts/dev/install-llm.spec.ts` (`brabo-dev` does not count and `brabo`
  counts; `z` deletes after the proof and leaves `MIGRAR_DE` empty; Enter does not delete —
  failure case; the ADR 0118 sentence does not come back)
- **Origin:** AT-358

---
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
id: rn-ci
title: 'Regras de negócio — CI'
sidebar_label: CI
description: 'As RNs hospedadas na raiz ci.'
keywords: [regras de negócio, ci]
---

# CI

## PR Gates

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
([ADR 0039](../adr/0039-actionlint-e-validacao-do-pipeline-de-ci-gerado.md);
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
- **Origin:** [ADR 0038](../adr/0038-hierarquia-de-agentes.md), [ADR 0039](../adr/0039-actionlint-e-validacao-do-pipeline-de-ci-gerado.md)

On the `apps/web` side (Phase 8d): the team panel groups `infra`/
`infra-workflows` the same way as QA (RN-036), and the feed narrates the
area's delegations — the same `AREAS`/`areaFor` registry from
`apps/web/src/lib/agents.ts`, with no Infra-specific code in the UI.

---

## The `dbre` role becomes two mechanical scripts (RN-400..403, ADR 0093)

### RN-401 — The linter is not a CI gate: it scans the whole repository, not the PR's diff {#rn-401}

Running `pnpm --filter api lint:migracao` against the repository's real
migrations FINDS three occurrences in migrations already merged and accepted
(`0006_whole_princess_powerful.sql:22` and `0034_quick_saracen.sql:33` —
`DROP COLUMN`; `0007_groovy_bullseye.sql:2` — `ALTER COLUMN ... SET DATA
TYPE`). That's not a defect to fix in passing (same CLAUDE.md
rule that protects findings Z/AD/AE): they're already accepted migrations, and
deleting them would erase the evidence of why the decision was made. It's also
why the script exits `!= 0` but is **not** wired into
`.github/workflows/ci.yml` — a gate that fails the whole repository
would fail every PR forever, for a finding that isn't its own. Becoming a real
blocking gate requires scoping to the DIFF against the PR's base (the same
technique as `scripts/ci/pr-police.ts`), left for when `dbre` needs to
BLOCK a merge — today it's a manual opinion, not an automatic verdict.

- **Where:** `apps/api/scripts/lint-migracao.ts` (`principal`, exit code at the
  end of the file); decision documented in the file's header and in the ADR
- **Test:** not applicable to CI (there's no step); the manual run against the
  real repository is recorded in ADR 0093, Consequences section
- **ADR:** [0093](../adr/0093-dbre-linter-de-migracao-e-relatorio-de-backup.md)

## "N agents online" on the dashboard — LIVE status, never historical presence (RN-409, ADR 0097)

### RN-411 — The fourth pending-work signal: dev agents speak `dev.*`, not `agent.status` {#rn-411}

Found by real USE, not by test: in an execution session, five dev
agents came up, became `idle_tripped` (the circuit breaker of
[RN-047](engine.md#rn-047), stuck waiting for the user to unblock a task
manually), and the 30-second heartbeat
(`Engine.Sessions.SessionServer.handle_info(:heartbeat_timeout, state)`)
closed the session from underneath while the work — and the wait for a human
decision — continued.

`GetSessionPendingWorkUseCase` already had a third signal
([RN-064](web.md#rn-064)) for the same problem: an agent activated, with no later
`idle`, holds the session. But that signal only reads `agent.status`, the
vocabulary of CONVERSATIONAL agents (Criativo/PO/Arquiteto/Dev
Lead/UX Designer/Staff/Infra). `Engine.Dev.DevAgentServer` (via
`Engine.Dev.AgentIo`) never emits `agent.status` — it uses its OWN
vocabulary in the session's event log: `dev.started`, `dev.working`,
`dev.awaiting_gate`, `dev.awaiting_approval`, `dev.idle`,
`dev.idle_tripped`, `dev.blocked`, `dev.blocked_by_container`,
`dev.error`. An execution session
with a dev agent working OR stuck always returned `pending: false`
by the third signal, because no `agent.status` exists for it.

The FOURTH signal fetches the LAST `dev.*` event of each `actor.id`
(`dev-<modulo>`/`dev-<modulo>-2`, the same key as
[RN-195](web.md#rn-195)) that has already appeared in the session — like the third signal,
but over multiple event types instead of just one, because the
dev agent's state isn't ONE type with a variable `payload.status`, it's distinct event
TYPES per transition. The ruler: `pending: true` when the
last one is `dev.working`, `dev.blocked`, or `dev.idle_tripped` — all three
mean "there's work running or a human needs to act", and stuck
waiting for unblocking IS pending work (it's literally what the
user was doing when the session closed in the real execution). Only
`dev.idle` (no task at all to pick up, truly drained) doesn't
count.

`dev.awaiting_gate` and `dev.awaiting_approval`, as the last event, did NOT
originally trigger this signal — they were left out of the ruler as
decided at the time. `awaiting_gate` was a KNOWN residual gap; 
[RN-412](api.md#rn-412) closed it, together with `awaiting_approval` (by a
new argument, not the original — see RN-412).

`dev.blocked_by_container` came in LATER, by the same argument and through an
equally real finding. The type was born with
[RN-502](engine.md#rn-502)/[ADR 0143](../adr/0143-agentes-de-dev-so-depois-do-container.md) — the dev
agent doesn't claim a task before the project has a registered `running`
container — and the use case's `DEV_EVENT_TYPES` list didn't keep up.
Since it's the list the use case QUERIES, the event became invisible: the
api didn't see it even to ignore it. In the real `exp004` execution (session
`f782257e`) five dev agents emitted `dev.started` and
`dev.blocked_by_container` at 22:41:38, the engine closed by
`heartbeat_timeout` at 22:42:07 — exactly 30 seconds —, and events
from that session kept arriving 13 and 32 minutes later. The last
VISIBLE event per agent was `dev.started`, which is deliberately
outside the ruler. The five were waiting for a HUMAN to bring up the container, which is the
definition of pending work the other signals already use.

The claim that the list was "the complete vocabulary, confirmed by
direct reading of the engine's code" was true when it was written —
and it's what silently aged. What keeps it true now is
MECHANISM: `scripts/ci/vocabulario-de-eventos-dev.spec.ts` extracts the
`dev.*` types from `apps/engine/lib/**/*.ex` and fails when they diverge
from the use case's two lists, naming the missing type. It COMPARES
instead of GENERATING (the `agent-areas.ts` precedent) because only half of the
pair is derivable: `DEV_EVENT_TYPES` is mechanical, `DEV_PENDING_TYPES` is
judgment — which states mean "a human needs to act".

The SAME drift had a third instance, in the WEB, and the mechanism
now covers it. `DEV_STATUS_EVENTS`
(`apps/web/src/lib/agent-status.ts`), which the team panel queries to
tell each dev agent's state, also didn't know
`dev.blocked_by_container` nor `dev.awaiting_approval` — and there the
consequence wasn't invisibility, it was a LIE: both fell into the
`switch`'s `default: return 'trabalhando'`, so in `exp004` the panel
said that five dev agents stopped for HOURS, waiting for a human to
bring up the container, were working. Both map to
`aguardando`, the same state `dev.awaiting_gate` already used (the agent
doesn't proceed until something OUTSIDE it happens), with no new state in
`AgentStatus`; `dev.error`, which wasn't in any list and therefore
made the panel go back to the previous `dev.working`, maps to `falhou`.
The list stopped being a list: it became a `type -> AgentStatus` MAP, which
erases the `default` and makes it impossible to add a type without answering what
it means. And the cross test gained the engine × web pair, with a
requirement the api doesn't have — an explicit DECISION per type, mapped OR
declared in `DEV_STATUS_EVENTS_FORA` (`type -> reason`, empty today) —,
because in the panel a `dev.*` type MAY legitimately not matter; what
it can't do is be left out by forgetfulness.

- **Where:** `apps/api/src/application/use-cases/sessions/get-session-pending-work.use-case.ts`
- **Test:** `apps/api/test/application/use-cases/sessions/get-session-pending-work.use-case.spec.ts`
  (dev agent `dev.working`/`dev.blocked`/`dev.idle_tripped`/`dev.blocked_by_container`
  as the last event → `pending: true`, including the five agents of the
  `exp004` scenario and with `dev.blocked_by_container` beating an earlier
  `dev.idle`; `dev.idle` → `pending: false`; a session without a
  `dev.*` event keeps the previous behavior; only each agent's LAST event
  matters; `dev-<modulo>-2` also holds; isolation between
  sessions), `scripts/ci/vocabulario-de-eventos-dev.spec.ts` (the engine's
  `dev.*` vocabulary × the api's two lists AND × the panel's
  map, plus the three fabricated cases that prove the
  `DEV_STATUS_EVENTS_FORA` valve, which no real data exercises today), and
  `apps/web/src/lib/agent-status.test.ts` (`dev.blocked_by_container` and
  `dev.awaiting_approval` → `aguardando`, `dev.error` → `falhou`, never
  `trabalhando`; and the most recent event still prevailing)
- **Origin:** found by real use — a real execution session with five dev
  agents in `idle_tripped` closed by the heartbeat while the user
  was still unblocking tasks manually; and, later, five dev agents
  in `blocked_by_container` in `exp004`, by the same mechanism

---

## RAG search leaves a trace, and the trace freezes the weights (RN-479..481)

### RN-498 — The RAG golden-set runs in real CI, SCHEDULED — and the gate stays `warn` {#rn-498}

RN-490 recorded the RAG golden-set (ADR 0132) being born as a manual `mix
golden_set.rag`, "never in CI", for the same reason as the QA golden-set
(ADR 0123): without an API LLM secret or new infra, there was no way to
run a real Ollama on a CI runner. This RN closes that half —
only for RAG, never for QA — with a dedicated workflow
(`.github/workflows/golden-set-rag.yml`, `schedule` + `workflow_dispatch`)
that pulls `nomic-embed-text` into a real Ollama service (the same pinned version
as the rest of the product, today `0.34.4`) and really runs `mix golden_set.rag`.

**The difference that makes this tractable for RAG and not for QA:** the
RAG golden-set only calls the EMBEDDING model — CPU, deterministic,
no sampling — never a CHAT model making a judgment, which is what the
QA golden-set requires (expensive, it measures something non-deterministic by nature,
as ADR 0123 itself records with real rounds varying from 1 to 5 hits
out of 6). `ubuntu-latest`, with no GPU at all, suffices here — it wouldn't suffice for
QA. The QA golden-set **doesn't change at all** with this RN: it remains entirely
manual, a `TODO(humano)` in CLAUDE.md.

**`severidade: warn` (`docs/gates.yml`) STAYS `warn`, and the reason changed.**
It's no longer "there's no CI with an LLM" — it becomes cadence: the workflow is
SCHEDULED (nightly + manual trigger), it never runs on `pull_request`. `block`
would promise a merge lock that doesn't exist — the same reasoning that
already held in Stage 2, now applied to the right reason. A regression in search
accuracy becomes a trend signal visible within 24h (or immediately, via
`workflow_dispatch`), never a gate that blocks a PR — a trade-off accepted
explicitly by the product owner, given the cost of pulling the model and
running 17 searches (a few minutes) in every window.

**No secret needs to be generated in the workflow.** `seed-golden-set-rag.ts`
never defines `NODE_ENV`, and the four secrets the api would refuse with an
example literal in production (RN-114) are only checked when
`NODE_ENV === 'production'` — the script falls into the development branch and uses
the dev literals without complaint, unlike `docker/smoke.sh`, which comes up
with `NODE_ENV=production` on purpose and therefore generates its own with
`openssl rand`.

**The permanent exclusion of the `:golden_set_rag` tag in `test_helper.exs`
(RN-490) doesn't change.** It protects the regular `mix test` — including on the machine
of any developer with Ollama up — never the new workflow, which
invokes `mix golden_set.rag` explicitly, just as it was always
necessary to run it manually.

**Fixed after measuring: the workflow above never ran green once.**
Five consecutive scheduled runs (09/05 to 09/09/2026) failed, and there were
**three** stacked defects, each hiding the next:

1. **`mix golden_set.rag` is an alias that calls `test`, and Mix refuses that
   outside the `:test` environment** — `** (Mix) "mix test" is running in the "dev"
   environment` —, before running anything. `def cli` in
   `apps/engine/mix.exs` now declares `preferred_envs` for BOTH
   golden-set tasks: that's what makes the short command, the only one documented
   everywhere, work without an environment prefix. Requiring `MIX_ENV=test` from
   whoever calls would transfer the fix to all the prose that teaches the
   command — and to whoever forgot, again.
2. **The job never brought up the api**, and the test SKIPS when `API_URL` doesn't respond
   (an environment precondition declared in ADR 0132). With item 1 fixed, the
   job would be green without measuring anything. It now brings up the real api (build,
   `node dist/main.js`, waiting for `/health`) — satisfying the precondition, and
   never loosening the test, which would be changing the judgment to fit the CI.
   What does the work is still `seed-golden-set-rag.ts`, which brings up its
   own Nest context; the instance exists to answer `/health`.
3. **The seed died with 409 at the image gate.** It created the project as
   `runner` precisely to ESCAPE the gate (RN-105), relying on the exemption
   that RN-169/RN-421 gave to `mounted`/`runner` — an exemption **revoked by
   RN-494** (ADR 0135), with the script's comment still citing it.
   Now the seed CROSSES the gate through the real path: it decides the image via
   `DecidirImagemDoProjetoUseCase`, the same use case as the Arquiteto's
   `choose_project_image`, in a `consultiva` session it
   opens (the decision event requires `session_id`, which is `NOT NULL`) — never
   a hand-written artifact INSERT, which would make the golden-set measure against a
   state production doesn't know how to produce.

**And the job now requires the golden-set to have MEASURED.** The guard is the result
line (`N/N casos acertaram`), which is only printed after the 17
cases run; without it the step fails naming the reason. It's necessary
because the `{:skip, motivo}` the test returns from the BODY **is inert** — there's
no runtime skip in ExUnit, and what you see is `Result: 1 passed`. That was
exactly what happened when measuring: with the seed dying with 409, the test
passed. `excluded` does NOT work as a signal here, unlike what the sibling guard
in `ci.yml` checks: the legitimate output carries over a thousand excluded, which
are all the other engine tests, out by the tag.

Measured after the three fixes, on this machine, through the path the job
now follows: **17/17 in the top-5**, the same as the two manual rounds that
recorded the floor.

- **Where:** `.github/workflows/golden-set-rag.yml`, `docs/gates.yml`
  (`rag-acertivo`), `apps/engine/mix.exs`,
  `apps/api/scripts/seed-golden-set-rag.ts`
- **ADR:** [0138](../adr/0138-golden-set-do-rag-em-ci-agendado.md)
- **Origin:** the product owner's plan, Part 2 / Stage 3

## PHASE 29 — the one-line installation: signing what is published

| situation | what the system does |
|---|---|
| Invalid state transition | typed error (`InvalidSessionTransitionError` etc.), translated to 4xx — never writes inconsistent state |
| Agent blows the iteration or token ceiling | ends and records a blocking artifact with the failure's origin |
| Task exhausts the K cycle | blocked with a reason, does not spin forever (RN-015) |
| LLM provider goes down midway | recorded as an **infra** failure, never "the model stopped" (RN-023) |
| Two concurrent decisions on the same hypothesis | explicit conflict (RN-022) |
| Engine replica goes down | the session is adopted by another or ends as `closed_abnormally / node_shutdown` — never stays orphaned |
| `QaLeadServer`/`SecOpsAgentServer` goes down in the middle of a gate cycle | `Engine.Gates.GateRescuer` resumes on its own — restarts the area (no verdict recorded) or resends the lost call (verdict already recorded) — without manual intervention (RN-140) |
| Rate limit unavailable | the request **passes**: the guard protects against abuse, not against improper access |
| Rate limit **exceeded** (429) | the screen says what the api answered and the poll stops; the app never answers the limit with more traffic (RN-088) |
| Wrong credential, nonexistent account or blocked account | **the same** 401 response, with the same argon2 cost (RN-032) |
| An already used refresh presented again | family revoked and a security event; the legitimate user is also logged out (RN-030) |
| Internal traffic without the service secret | 403 in the api, 401 in the engine — never reaches the controller (RN-035) |
| Provider refuses the key during catalog sync | provider **skipped** with the failure's origin; no model is marked as gone (RN-041) |
| The binding's model disappears from the provider | the cascade falls to the level below and WARNS which scope it skipped — never swaps the model silently (RN-041) |
| Model price changes | it holds from now on; the recorded cost and the price that produced it stay untouched (RN-042) |
| Creating the handoff fails (Criativo→PO, Arquiteto→Infra/Dev Lead) | durable `agent.error`, the agent process STAYS alive; what was already recorded before (product_brief, rules) is not lost (RN-116) |
| **Mounted folder** project path outside `BRABO_PROJECTS_BASE` | creation is **refused** (400) naming the base and suggesting `<base>/<nome>` — the project is not born only to get stuck later (RN-170/RN-501) |
| **Mounted folder** project folder unreachable when the Infra starts the container | `container_start` ends `failed` NAMED (variable, path, folder owner, next step) and the lifecycle does **not** reach `provisioning` (RN-501) |
| `BRABO_PROJECTS_BASE` absent | the api answers `projectsBase: null` and project creation **does not offer** the Mounted folder mode — never offer a mode the installation does not honor (RN-500) |
| Folder browser receives a `path` outside the base (including the `<base>2` prefix trap) | **400** naming the base — malformed, and not 403: no role browses outside it (RN-504) |
| Folder browser receives a `path` inside the base that the api cannot open | **404** saying WHICH of the two it is (does not exist / exists and cannot be read) — never a 500 with an `fs` message (RN-504) |
| Browsed folder only has files, symlinks, or more than 500 subfolders | the listing comes back with `arquivos`/`simbolicos`/`truncado` and the screen SAYS what was left out — a folder full of code never presents itself as empty (RN-504) |
| `BRABO_PROJECTS_BASE` overlapping the Brabo checkout (in both directions) | `pnpm dev` **refuses to start**, naming both paths. No api validation catches this: it compares against `process.cwd()`, which inside its container is `/workspace` (RN-500) |
| `BRABO_PROJECTS_HOST_BASE` absent in the broker and `container_start` of a `mounted` project | refusal **naming the variable** (503, origin `infra`), without touching any container — never falls back to the other root, which would point to another project's folder (RN-503) |
| LEGACY `mounted` project, with the folder outside the base | the spec returns `localizacao.tipo: 'indisponivel'` with the reason naming the base and the path; the broker refuses with 409 and the fix is **moving the folder**, not changing mode (RN-503) |
| Broker down (it starts under `profiles` and does NOT start by default) and `container_start` of a `mounted` project | the action ends `failed` with the reason of `BrokerIndisponivelError`, never an exception — and nothing transitions in the lifecycle (RN-503) |
| Incoherent project location in the database (mode/path pair written outside creation) | execution activation refuses with **400** and the reason in pt-BR, never a 500 without a body (RN-478) |
| Social login: provider email matches an existing account but is NOT verified | refused with 403, no link recorded — an unverified email is not proof of identity (RN-274) |
| Social login: invalid/expired `state`, or from another PURPOSE (git connection flow) | refused, no call to the provider nor write to the database (RN-273) |
| Validating the need without any `product_brief` in the session | refused (400) BEFORE recording any event — there is nothing to validate yet (RN-406) |
| Converting `execution_mode` with a dev agent working or stuck | refused (409) BEFORE touching permissions.json or the container lifecycle — never migrates a live agent (RN-447) |
| Attached local folder exceeds the file ceiling or the summed bytes | refused (400), the whole batch — never truncates silently (RN-456) |
| An individual file of the local folder is too big or of an unrecognized extension | only SKIPPED (`filesSkipped`), never takes down the whole upload (RN-456) |
| Confirming a model pull request that is no longer `pending_confirmation` | refused (409) — the confirmation is not re-executable (RN-462) |
| Hugging Face model pull fails in Ollama | request ends `failed` with the origin declared (infra/model), nothing is activated in the catalog (RN-462) |
| Runner binary unavailable (release without an asset, GitHub down) during browser setup | the chosen folder and the two configuration files STAY; the screen says the reason and swaps the instruction for the `npm install -g @brabo/runner` path (RN-473) |
| Runner does not connect within the wait's ceiling | the screen says it did not see it, declares that this is not proof of absence and points to the Code tab — never "verifying" forever (RN-474) |
| Runner folder with a device key present and invalid (broken JSON, or without `kid`) | the CLI refuses NAMING the file and the reason, and offers the two ways out — never the usage block, which is the answer for whoever configured nothing (RN-475) |
| Creating the repository fails before a bootstrap row exists | the status endpoint reports `provision_failed` with the reason read from the `proposed_action`, and `failedStep` stays NULL — no Gitflow step was attempted, and naming one would be inventing (RN-477) |
| Bootstrap's `step.check` fails (expired token, 403, timeout) | becomes `status: 'failed'` + `lastError` on the row and `bootstrap.step_failed` in the event log — before it went up without touching anything and the screen polled forever (RN-477) |
| Provisioning does not converge within the screen's ceiling | the wait STOPS at 3 minutes, declares that this does not prove failure and offers to look again — without firing a second POST (RN-477) |
| Applying a model to all agents and the api refusing PART of them | the rows that passed stay written and are re-read; the warning says how many out of how many and NAMES those that remained — never "saved" nor "not saved", which would both be lies (RN-476) |
| INSERT of the RAG search telemetry fails | the search **answers anyway**, with `searchId: null`, and the failure becomes a log with origin `infra` — the measuring instrument does not take down what it measures, and it does not vanish silently either (RN-479) |
| Vote on a `searchId`/`chunkId` that that search did not return | a 400 that teaches, nothing recorded — a vote without rank does not distinguish "poor index" from "wrong weights", and a meaningless number is worse than no number (RN-480) |
| `medir:rag` over a window in which `vector_available` was `false` the whole time | **fails (exit 1)**: what was measured is not the hybrid search, it is its lexical half, and calibrating the vector weight against that would be calibrating against another system (RN-479) |
| `route_modules_to_infra` called without a current `module_map`, with an empty list, a repeated module, a module outside the map, or an invalid image (`latest`/no tag/short `rationale`) | 400 naming what is missing or what is wrong — via the agent, an error tool-result the model fixes, never a crash (RN-487) |
| `container_start` elects an image outside the candidates of the Arquiteto's current routing | the action becomes `failed` naming the refused image and listing the valid candidates — neither is the image decided nor is the broker called (RN-491) |
| Broker refuses or is unavailable when starting the container (`BrokerRecusouError`/`BrokerIndisponivelError`) | the action becomes `failed` with the broker's message — never propagates, never stays pending (RN-491) |
| `emit_artifact` with `type: decision_record` missing `context`/`options`/`choice`/`consequences` | error tool-result naming the missing key(s) — the model fixes it on the next turn of the loop, never a crash (RN-505) |
| Terminal/worktree in a `runner` project verified and connected, but WITHOUT a `running` container | NAMED refusal (`RunnerReadiness`), never falls back to the bare host — Docker is a real prerequisite, with no fallback (RN-507) |
| `RunnerGit` tries to materialize the worktree without the three preconditions of RN-507 | raises with a named message BEFORE any `exec` — never tries blindly and lets the channel timeout explain (RN-507) |
| Periodic worktree cleanup job finds a `runner` project without a connected runner or without a `running` container | SKIPS the project this round, silently — never an error, never stops pruning the other projects (RN-507) |
| `container_start_via_runner` proposed for a `container`/`mounted` project, or `runner` without a connected runner | the Infra Lead REFUSES locally, naming the reason, without calling `propose_action` even once (RN-508) |
| `container_start_via_runner` approved without a decided image (RN-105) | the action becomes `failed` naming the absence of a decision — never calls the engine (RN-508) |
| Runner connected to a project whose `execution_mode` requires a capability it did not declare at `join` | join **refused** naming the capability and telling to update the binary — a fatal refusal, no retry, never silent degradation (RN-514) |
| Runner that declares a capability THIS server does not know | the name is **ignored** and the join passes — a runner newer than the engine connects (RN-514) |
| `exec` dispatched to a runner that did not declare the `exec` capability | answers the caller in the same `exec_result` format, with `exitCode` 126 and the cause in `output` — never lets the `RunnerRouter` wait until the timeout (RN-514) |
| `pty_*` relayed to a runner that did not declare the `pty` capability | the message is NOT delivered and the `:web` receives a named `pty_error` — never "loading" forever (RN-514) |
| Mirror destination inside the project's `workspacePath`, or containing it | **400** naming the direction of the loop — both are the same refusal, and the comparison is by SEGMENT, so `/base-outra` does NOT count as inside `/base` (RN-515) |
| Mirror destination declared in an `execution_mode: container` project | **400** NAMING the reason (the source is a server volume, the local agent does not see it) — never accept and never copy (RN-515) |
| `PUT .../mirror-path` without the `mirrorPath` key in the body | **400** — omitting would be indistinguishable from asking to CLEAR, and clearing silently is the defect; clearing is an explicit `null` (RN-515) |
| `brabo-runner service install` run as root | **named refusal**, without writing a file or running a command — the service is a user one by design, and a root one would break the premise of the product's three boundaries (RN-518) |
| `brabo-runner service <qualquer>` on Windows (or on any platform other than Linux/macOS) | **refusal naming the platform**, saying the decision is declared and pointing to the foreground — never a mute failure, never an "installed" that did not install (RN-518) |
| `service install` in a folder without a valid device key | **refusal naming the file** — a service authenticates by key, never by token, which would stay on disk inside the unit (RN-518) |
| `systemctl`/`launchctl` unavailable during `service install` | the unit file **STAYS**, and the answer says it did not activate, naming the pending command — deleting it would become "nothing happened", which is false (RN-518) |
| `service uninstall` without an installed unit and without `--dir` | answers NOT INSTALLED and **touches no file at all**: without the unit's record, guessing by the `cwd` would delete another project's key (RN-518) |
| `service status` on a machine without the service manager in the PATH | answers "installed, and I could NOT ask" with its own code — "I don't know" never becomes "stopped" (RN-518) |
| Workspace project that NEVER provisioned a container, on the `/containers` page | appears in the list with `registrado: null` and the text **"never provisioned"** — never `stopped`, never "not observed", and never spends one of the broker's 20 checks (RN-521) |
| "Start" clicked on a project without a decided `artifact.project_image` | the button does not even become active: the screen SAYS the image remains to be decided, in text, instead of proposing an action already known to end in failure (RN-521/RN-105) |
| "Start" on a `runner` project whose `workspaceVerifiedAt` is null | inert button with its OWN reason ("no local agent ever confirmed the folder") — never collapsed with "no image decided" (RN-521) |
| "Start" on a `runner` project with a confirmed folder but the runner possibly off | the screen OFFERS and writes the caveat: folder confirmation is not agent presence (RN-468), and the action fails when approved if it is not up (RN-521) |
| Role below `maintainer` on the `/containers` page | inert controls with the reason said ONCE in text; state, image and resources stay VISIBLE (RN-521/RN-102, ADR 0064) |
| `brabo-runner --base <caminho>` with a relative path, with `..`, equal to `/`, pointing to a file, or (on Linux) outside `$HOME` | **refusal naming the reason** and exits with code 2 — an explicit request typed just now that cannot be honored, the same disposition as a refused `--dir` (RN-529) |
| `--base` INSIDE this project's folder, or equal to it | refusal `base-dentro-da-raiz`: every new project would be born inside this one. The OPPOSITE direction (the project folder inside the base) is the normal arrangement and passes (RN-529) |
| `$XDG_CONFIG_HOME/brabo/runner.json` corrupted, or with a base the guard refuses | the refusal is STATED on `stderr`, names what is lost, and the runner **continues without a base** — taking down an agent serving a project because of a configuration it does not use yet would be disproportionate (RN-529) |
| Base file that exists and does not declare `base` | it is **absence**, not refusal: configuration without a consented base, not broken configuration — the runner runs as always (RN-529) |
| Project whose folder (`--dir`) is OUTSIDE the configured base | stays **valid**, without a warning: the base is a creation rule, and the lexicon of `--dir` is forever — the same prohibition written in `project-workspaces-root.ts` (RN-529/RN-501) |
| ABSOLUTE project segment, with `..`, pointing to the base itself, or escaping it by symlink | named refusal with its own reason, in the double pass (lexical and by `realpath`) — never accepted and reinterpreted, because what crosses the network is the SEGMENT (RN-529, ADR 0130) |

## When things go wrong

[PHASE 28](../explanation/fase-28-pasta-do-usuario.md) refused in writing the
one-line installer while the artifacts were not signed (BRB-005), and
that is why [PHASE 29](../explanation/fase-29-instalacao-de-uma-linha.md)
signs **before** installing. Session 2, [ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md).

### RN-524 — A published artifact is signed by workflow identity, verified in the same run, and the verification refuses instead of warning {#rn-524}

Every final tag signs what it publishes, and **verifies what it signed before
publishing the Release**:

- the **five images** are signed **by DIGEST** (they were four when this
  rule was written; the fifth, the broker, came in with
  [ADR 0162](../adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)), read from
  `.release/images.json` — never by tag. A tag is a moving pointer: signing
  `:5.0.0` would attest what that tag pointed to at the instant of signing, and not
  what it points to when someone downloads. The digest is what the manifest already records
  and what the production overlay already applies (ADR 0119);
- the runner **binaries** (five targets when this rule was born, **four**
  since [ADR 0174](../adr/0174-runner-sem-binario-darwin-x64.md), which removed
  `darwin-x64`) are covered by **ONE** signed `checksums.txt`, and not by
  one signature per binary — whoever verifies three and forgets the fourth has
  no way of knowing they forgot;
- the signature is **keyless** (GitHub Actions OIDC): the identity that signs is
  the workflow itself, and there is no private key in custody. An own key pair
  would mean one more CI secret, and this repository has already seen a PAT
  expire silently and fail two runs of `tag-release`
  ([ADR 0139](../adr/0139-o-alarme-de-esteira-ganha-destinatario.md));
- **a verification failure is a named refusal, never a warning.** A warning one accepts
  by clicking is a verification that does not exist.

The manifest **declares what it covers**. The matrix is `fail-fast: false` on purpose,
so a target that did not build does not prevent the other four from having a manifest —
but the job names in the log the targets that were left out, because a `checksums.txt`
that lists four and keeps silent about the fifth is worse than none: whoever verifies the
four concludes they verified the release. This half was **written intention and
a mechanism that did not fulfill it**: with `needs: build`, a target that does not build did not
prevent, it DELAYED by a day — see [RN-565](#rn-565), which makes it true and
measures the number.

**Where:** `.github/workflows/release.yml` (steps "Instalar o cosign" and "Assinar
as imagens publicadas", with `id-token: write` in the `permissions` block);
`.github/workflows/build-runner-binaries.yml` (job `checksums`, **without** `needs:`
since [RN-565](#rn-565) — the wait is for the assets, with a ceiling).

**Test:** `scripts/ci/actions-pinadas.spec.ts` covers the SHA pin of
`sigstore/cosign-installer` (with the version comment alongside, which is what
tells a human and Dependabot which version that hash is). The signature itself
is only proven on a real tag — declared, like the rest of the release pipeline.

**Origin:** PHASE 29, session 2. Closes **BRB-005** for images and binaries. Does NOT
cover the operating-system *code-signing* of the binaries (macOS notarization,
Windows Authenticode), which requires a paid identity and stays in the backlog.

## `install.sh` closes the installation (RN-547, PHASE 30)

### RN-549 — The E2E on a clean machine proves the WHOLE installation: the five links, the agent up and waiting, and the first project picked up without anyone going back to the terminal {#rn-549}

Session 8 of [PHASE 30](../explanation/fase-30-runner-por-maquina.md), the last — and the
only one that could answer the question the whole phase pursues: *on a clean
machine, does `install.sh` end with the local agent up and paired, and does the person create
the first project in Runner mode without going back to the terminal?* Until now the answer was
a written intention: [RN-547](produto.md#rn-547) chained the five commands and declared,
in writing, that in its tests `brabo-runner` is a shell stand-in and the api is a
`node:http` — *"what is proven is the CHAINING, never the integration"*.

**The harness was not born here: it was EXTENDED.** `.github/workflows/install-e2e.yml`
has existed since PHASE 29 ([RN-534](produto.md#rn-534)) and already runs the published installer on an
ephemeral Actions runner — which is literally a clean machine, without Brabo, without
`.env`, without a marker. What it proved stopped at `.env`: plan, state, the three
promises to never delete, the path without a TTY, and the startup with a simulated TTY. A
second workflow would duplicate the expensive side (waiting for the Release, downloading, verifying the
signature) to measure the cheap side.

**It does NOT run on `pull_request`, and the consequence is declared instead of
hidden.** The installer verifies its own origin against a Release's **signed**
`checksums.txt` ([RN-526](produto.md#rn-526)), which only exists after a final
tag; the only way to make it run on a PR would be giving it a door to SKIP
verification — the door [ADR 0150](../adr/0150-instalador-de-uma-linha.md)
refuses, and which once opened would hold for anyone, not only for CI. Hence: **the
PR that wrote this E2E did not execute it**, and its checks passed without exercising
a single line of what it added. It is the same decision as the RAG golden-set
([ADR 0138](../adr/0138-golden-set-do-rag-em-ci-agendado.md)), for the same reason.

**Hence the half that RUNS on PRs, and it is the reason it exists.** A workflow that only runs
on tags is a workflow whose error shows up on the tag, when the release is already going out and
nobody looks at the PR that broke it anymore. `scripts/dev/install-e2e.spec.ts` measures the
two known ways for this E2E to rot silently: someone **loosening** the gate
(putting `pull_request` in the trigger, or passing a skip-verification flag), and someone
**rewriting a sentence** of `install.sh` — with which every `grep` of the workflow comes
to match nothing, and the assertions do not fail, they VANISH. The prompts canary is
derived, not memorized: the TTY answers go via file, **in order**, and a
new `read -r` in the installer misaligns all the following ones — the base would become the
password —, so the test counts the prompts and says to look at the answers file.

**What the E2E came to prove, and each assertion has an owner.** The five links of
[RN-547](produto.md#rn-547), one by one, against a REAL api and binary — the account
([RN-546](produto.md#rn-546)), the pair generated on the machine and the stamped `kid`
([RN-551](runner.md#rn-551)), the registration of the public key ([RN-552](api.md#rn-552)) and the
per-machine unit ([RN-545](runner.md#rn-545)). Plus the invariant of [RN-475](web.md#rn-475) measured on the
DISK and not in the output (the file the runner reads has `kid`, has `d`, and the
`.parcial` vanished when `finish` closed), the password absent from `.env`, from the
marker and from the log, and the `ownerEmail` present in the marker.

**The NEGATIVE proof is the one worth the most, and it is the absence of the pending block.**
[RN-547](produto.md#rn-547) says to report each link that fails in a named final block — and
exit **0** all the same. An E2E that looked at the exit code would go green with
four of the five links broken. *"No pending items"* is the only way to assert
that the five closed, including the ones the workflow does not know how to name.

**The signal that the agent is UP waiting is the LINE, never the manager's state — and that
choice is this E2E's central decision.**
`perguntarEstado` maps `activating` to `rodando` ([RN-088](web.md#rn-088), with
reason: "coming up" is not "stopped"), so both `systemctl is-active` and
`brabo-runner service status --machine` answer *up* for a process that will
die two seconds later. It is exactly the race a fixed `sleep` hides, and
measuring the wrong artifact here — a binary on disk, a written unit — is the
easiest way for an E2E to go green without proving anything. The chosen signal is the line the
process writes when ENTERING the wait ([RN-550](runner.md#rn-550)): it only exists after
the agent has read the machine key from disk, gotten a ticket, talked to the real api
and received an EMPTY list — it proves pairing and waiting at once. And it is not
state sampling: it is a fact already written to the journal, which does not undo itself. That is why
waiting for it with a ceiling is not a race — either it shows up, or the ceiling blows and the
step fails showing the whole journal. `service status --machine` comes in
**after** it, as confirmation that the exit code answers what the
operator will see, never in its place.

**The phase's outcome is measured through the API, and not the BROWSER.** The subject of the
assertion is the AGENT, not the page: what it observes is `GET /runner/projects`
([RN-543](produto.md#rn-543)), an api fact. A browser would create the project through the SAME
route with one more layer that fails for reasons unrelated to the promise — and would not
make the assertion stronger, because it remains the line in the agent's
journal. The browser layer exists (`e2e/`,
[ADR 0120](../adr/0120-e2e-de-navegador-contra-o-compose-de-producao.md)), answers
another question (three origins, `httpOnly` cookie, CSRF), has its own lockfile and
assumes the production compose up: dragging it here would make the installer's E2E
depend on a second harness installed on a machine that should be clean.
Proving the wizard is the web suite's job, and it is already covered there. What the step
measures is the whole chain: the account born in the terminal **gets through the login** without
any verification link, the personal workspace of [RN-410](api.md#rn-410) exists, the
project is born `runner`, and the agent picks it up on its own within the
15s/30s/60s cadence of [RN-550](runner.md#rn-550).

**Idempotency is measured by the half the E2E reaches without reinstalling.** The api
really answers `409` to a second `first-account` — with a GENERATED password, never
a constant, because `exigirSenhaValida` runs BEFORE the conflict and a weak password
would give `400`, measuring the wrong thing. What the installer DOES with that `409`
(go silent, and not become a pending item) is HTTP code classification, covered in
`install-fechamento.spec.ts` against a test server: repeating it here would require
a whole second installation, which goes through the MIGRATION path
([RN-530](infra.md#rn-530)) — proven backup, delete, recreate — and is its own delivery.

**The only divergence between this runner and a clean machine belongs to the ENVIRONMENT, and it is
named.** On a real machine whoever installs has a login session and
`systemd --user` is already up; the Actions job runs non-interactively, without a session, and
without it `systemctl --user` has no bus to talk to — the `service install
--machine` would become a pending item for a reason that is not the product's, and the E2E
would "prove" a lab failure. `loginctl enable-linger` brings the
user manager up; it is not an installer flag, it skips no verification and does not
change what the unit does.

**Two defects showed up while writing this, and both were invisible because the
workflow never ran.** The first was in the harness itself: the answers
file started with `nao-migrar`, which on a clean machine falls into the
MARKER question — it does not match `s|S|sim|SIM`, the script said *"Nada foi gravado"* and exited
0, and the marker assertion right below would have failed. The migration question
is under `if [ -n "$marcador" ] || [ -n "$sinais" ]`, and on a clean machine both
are empty: it does not happen. Fixed to the SEVEN real answers.

**The second is a FINDING and was not fixed here, on purpose.** The published
`install.sh` **cannot bring anything up on its own on a clean machine**: it brings up the stack
with `docker compose -f docker/docker-compose.install.yml`, a path RELATIVE to the
directory it runs from — and that file **is not a Release asset, does not enter the
signed `checksums.txt` ([RN-524](#rn-524)), and the script does not download it
anywhere** (its only downloads are `cosign`, the manifest, its own hash and the
runner binary). The compose also bind-mounts `./postgres/init.sql`, so there are
THREE files and not one. Whoever follows the runbook's `sh -c "$(curl … install.sh)"`
dies in *"no such file or directory"* **after** having already verified the signature,
chosen the base and written the `.env`. Fixing it means deciding whether the compose becomes a
signed asset or whether the installer starts cloning — its own delivery, not something to do
in passing inside the E2E that discovered the hole. The workflow brings the three by hand, from the
tag, in a step that SAYS it is a finding; the PR test demands both halves (the step
exists, and the installer keeps using the compose without downloading it), and the day the
installer fetches them on its own the test fails — and the right thing then is to delete the step,
not relax the test.

**What did NOT come in:** any door to skip origin verification; `apps/`
untouched (the finding became a report, not a passing fix); no second
installer E2E workflow; and no loosened gate — in particular, the E2E
stays out of `pull_request`.

- **Code:** `.github/workflows/install-e2e.yml:16` (the trigger that stays without
  `pull_request`), `:111` (the finding's step — the three files the installer
  does not download), `:172` (the systemd user session, the declared divergence),
  `:204` (the full installation with the SEVEN answers), `:241`–`:245` (the five
  links of RN-547, one per line), `:253` (the negative proof — no pending items),
  `:267`–`:274` (the `kid`, the `d` and the `.parcial`, measured on DISK and not in the
  output), `:278` (the password that did not leak), `:307` (the
  agent up, by the journal line and not by the manager), `:354` (the first
  project via the api, and the agent picking it up), `:415` (the `409` of the second account)
- **Test:** `scripts/dev/install-e2e.spec.ts` — the half that runs on PRs: the
  trigger read from the DOCUMENT (not from the text, which would match the comment that
  explains why `pull_request` is not there), the absence of a skip-verification flag
  in both files, the sentence contract between workflow and
  `install.sh` (the five links plus the usual four), the two lines of
  `apps/runner` the assertions depend on, the interactive prompts canary, the
  ORDER between the journal line and `service status --machine`, and the two halves
  of the compose finding. Verified by mutation: rewriting an installer
  sentence and putting `pull_request` in the trigger fail
- **Gap DECLARED:** this E2E **does not run on the PR that wrote it**, and none of its
  checks proves a line of what was added — the first real execution is
  the next final tag. Also left out, and not by forgetfulness: the second
  run of the installer through the MIGRATION path ([RN-530](infra.md#rn-530)) — backup,
  restore proof, delete and recreate —, macOS (the full step is Linux:
  `launchd`, and the Docker the hosted runner does not have), and the browser
- **ADR:** [0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md)
- **Origin:** PHASE 30, session 8 —
  [the phase's scope](../explanation/fase-30-runner-por-maquina.md)

## The device key gets a screen, and the screen states the reach of revoking (RN-561)

### RN-565 — The signed manifest goes out with what the Release HAS, and does not wait for the platform that never builds {#rn-565}

The signed `checksums.txt` ([RN-524](#rn-524)) is the precondition of two other
rules: without it, `GET /runner-releases/binary` refuses with
`release_sem_manifesto` ([RN-525](produto.md#rn-525)) and `install.sh` refuses itself
([RN-526](produto.md#rn-526)) — **on all platforms, including those that attached a
binary properly**. A manifest that is late is not a late manifest: for
whoever installs in that interval, it is an absent manifest.

**The measurement, against the three tags that exist.** In `v4.0.0`, `v4.0.1` and
`v5.0.0`, the `darwin-x64` target (`macos-13`) spent **24h00m01s** in the queue and was
cancelled by the Actions ceiling — the SAME number in all three, which says it
never gets scheduled. The other four jobs end in at most
**4m18s** (`linux-x64` in `v4.0.1`, 17:38:28Z → 17:42:44Z). The `checksums` job
had `needs: build`: the `always()` guaranteed that it RAN (a cancelled dependency
is covered), never WHEN.

**The rule:** the manifest job **does not depend on the matrix**. It waits for the Release's
**ASSETS**, not the **JOBS** — with a ceiling —, and publishes whatever exists,
naming in the log what it does not cover. The absence of a target is a foreseen outcome
(`::notice::`), never an error; the absence of the **Release** remains a named
error, because this workflow only ATTACHES and never creates; and **no**
attached binary remains an error, because an empty `checksums.txt` would assert that the
release has no binaries when what happened was the whole matrix failing.

**The binaries ceiling is 1200s, and the number is not arbitrary:** it is the
`timeout-minutes: 20` of the `build` job itself — the most a target **with a
runner** can take after starting. What it deliberately does not cover is
**queue** time, and not covering queue time is the whole point. The loop exits
early when all targets arrive, which is the happy path.

**Nothing the job DOES changes.** It still builds the manifest from the
assets (and not from `dist-bin/`, empty there), signing with keyless `cosign` and
verifying before attaching — [RN-524](#rn-524) intact, one manifest and not
five signatures. And a target that attaches AFTER the ceiling is not orphaned: the
`--clobber` already existed for that, and redoing the manifest is a
`workflow_dispatch` with the same tag.

**What this rule does NOT do:** `darwin-x64` still does not build. Changing the
label, removing the platform or paying for a runner is the owner's decision, and the manifest cannot
depend on it — it is precisely because it depended on it that it did not come out.

> Measured later, in AT-065 (2026-09-13, by a rehearsal `workflow_dispatch`):
> `macos-13` is a label without a runner (image retired by GitHub in Dec/2025;
> 30min in the queue, cancelled, run `34769280227`). `macos-15-intel` schedules in
> 3–22s and builds, but fails at `--self-test-pty` because, under Bun, the
> `onData` of `node-pty` does not deliver the child's output (oven-sh/bun#25822,
> open); the same proof passes under Node on the same runner (run `34770476634`).
> The pending decision stopped being about the runner and became waiting for Bun or
> removing the platform. The rule above does not change because of that.

> **Decided on 2026-09-27 ([ADR 0174](../adr/0174-runner-sem-binario-darwin-x64.md), AT-065):
> the platform left.** The matrix went to FOUR targets, and `ALVOS_ESPERADOS`
> followed — it is against it that the absence is declared, and leaving `darwin-x64`
> there would make every manifest announce, forever, a gap that is a decision. The
> Mac Intel stays with `npm install -g @brabo/runner` (under Node, where the same
> proof passes): `install.sh` says so without trying to download, the
> `GET /runner-releases/binary` proxy refuses `darwin-x64` with its own 400 pointing to
> npm, and the browser panel does not even ask for the download. This RN's rule does not
> change: it keeps holding for any target left without a runner, and
> `scripts/ci/alvos-do-runner.spec.ts` fails when the matrix, the api's list,
> the installer's `case` and the browser's diverge.

- **Code:** `.github/workflows/build-runner-binaries.yml:283` (the job, now
  without `needs:`), `:318` (`timeout-minutes: 40`, which fits both waits),
  `:335` (`ALVOS_ESPERADOS` at the JOB level, so both steps read the same list),
  `:397` (the step that waits), `:401`/`:402` (the two ceilings), `:410` (the absent
  Release, which is an error), `:433` (the binaries ceiling, which is a `notice`), `:499` (the
  manifest naming what it does not cover)
- **Test:** `scripts/ci/checksums-nao-espera-a-matriz.spec.ts` — that the job has
  no `needs:`, that both ceilings exist, that the binaries ceiling is derived
  from the `build`'s `timeout-minutes` (and not copied), that it fits in the
  job's own `timeout-minutes`, that the absence of a target is `notice` and the absence
  of the Release is `error`, that `ALVOS_ESPERADOS` matches the matrix, and the four
  guarantees of ADR 0149 this change does not touch (one signature, verifying
  before attaching, `id-token: write`, the `install.sh` in the manifest). It is STATIC,
  and the limit is declared at the top of the file: the job is only proven on a final tag,
  and it has never run on any
- **Gap DECLARED:** the matrix has THREE targets since
  [ADR 0187](../adr/0187-runner-sem-binario-win32-x64.md) (`win32-x64` left by the
  same mold as ADR 0174, and `ALVOS_ESPERADOS` followed) and the Release
  keeps receiving **two** — `darwin-arm64` is proven in rehearsal
  ([RN-688](runner.md#rn-688)) and only needs a final tag to exercise it. The manifest will be born covering two and will
  **say** so, which is the difference between partial and silent. And, with the matrix
  failing entirely, the job spends both waits before refusing
- **ADR:** [0149](../adr/0149-assinatura-dos-artefatos-publicados.md)
- **Origin:** AT-051 (EP-009/HS-035)

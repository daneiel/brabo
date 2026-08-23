---
sidebar_position: 8
---

# Triaged backlog

Output of **FASE 13c**. Gathers the open findings from real execution
([achados-execucao-real.md](achados-execucao-real.md)) and the older items
that were scattered across ADRs and CLAUDE.md.

> This is a **proposal**. The classification and grouping below are an
> argument about what costs more to wait on; the priority decision belongs
> to the user.

## How it's classified

**P1** — blocks the product from doing what it promises. **P2** — the
product does it, but lies or confuses whoever's looking. **P3** — quality,
with no one stuck.

**Cost**: P (one session), M (one small phase), G (its own phase, with an
ADR).

**Risk of waiting** is the column that breaks ties: a defect that corrupts
data or erases evidence costs more later than now; a cosmetic one costs
the same either way.

## The board

| proposed phase | items | prio | cost | risk of waiting |
|---|---|---|---|---|
| ~~A — Unblock the task~~ | ~~ADR 0052, O/B~~ | **DONE** | — | RN-072 and RN-073 |
| ~~B — Engine on a remote provider~~ | ~~N~~ | **DONE** | — | RN-076; ADR 0056 accepted |
| ~~F — Executor boundary and cap~~ | ~~S, U~~ | **DONE** | — | RN-074 and RN-075; ADR 0055 accepted |
| ~~C — The UI can't lie about agents~~ | ~~C, I, H, L, G~~ | **DONE** | — | all five items |
| ~~D — The wizard tells the truth and has an exit~~ | ~~D, E, F~~ | **DONE** | — | RN-078; E and F were already done |
| ~~G — The failure outcome tells the truth~~ | ~~P, Q, T~~ | **DONE** | — | RN-077 |
| ~~H — Session state doesn't lie~~ | ~~V~~ | **DONE** | — | RN-064 extended |
| ~~E — Quality of what agents produce~~ | ~~K, R, J~~ | **DONE** | — | RN-079, RN-080 and RN-081 |
| ~~— standalone~~ | ~~promotion-check with no spec~~ | **DONE** | — | 10 cases, mutation-verified |
| ~~I — The dev agent starts from zero~~ | ~~X, Y~~ | **DONE** | — | RN-085; Y closed in 13b, X in FASE 14d |

**Coverage: 19 of 19** of the real-execution findings, plus **eight new
ones** (W, X, Y, Z, AA, AB, AC, AD, AE) from the FASE 13b validation — see
[validacao-real.md](validacao-real.md).

Of these, **five closed**: W, Y, AA, AB and AC within 13b itself, and X via
FASE 14d ([RN-085](../business-rules.md#rn-085)) — the iteration cap became
per agent TYPE, which was the shape the triage had proposed and the product
decision that was missing.

**Three remain open**, and none is a bug to fix:

| finding | what it is | why it isn't a fix |
|---|---|---|
| **Z** and **AD** | the verb allowlist doesn't converge — verb, form and invocation are distinct spaces | the allowlist does exactly what it promises, and the refusal of `bash` proves the boundary holds. It's a PRODUCT decision about policy by agent profile, with an ADR |
| **AE** | the QA agent tries to fix the code it's judging | nothing leaked: blocked by two independent barriers. The data point is the divergence between what the prompt asks and what the model does |

13b's practical conclusion has already been implemented and awaits
nothing: the path isn't loosening policy, it's making the agent WAIT for
the decision instead of dying
([ADR 0057](../adr/0057-o-gate-espera-a-aprovacao.md), extending 0052).

The phase letters (A–H) and the finding letters (B–V) collide by
inheritance from the two lists; where there's ambiguity the text says
"finding."

Two items left the open list since the first triage: **A**
([RN-067](../business-rules.md#rn-067)) and **M**
([RN-066](../business-rules.md#rn-066)), both closed and confirmed in
production. And **ADR 0052**, which was half of Phase A, was implemented
and proven by test — the wake delivery was fixed and covered end to end
afterward.

The rest (older items) is under [Older backlog](#older-backlog), with no
priority assigned: these are product decisions, not defects.

---

## Phase A — Unblock the task (P1) — **DONE**

**No dev agent had ever finished a task.** That was the fact that ordered
everything: the gate registry from FASE 15a shows `qa-verificada`,
`secops-segura` and both infra gates as *"never passed"* — not for lack of
execution, but because there was never a PR for any gate to judge.

| item | what it was | how it closed |
|---|---|---|
| **ADR 0052** | pending approval returned `status pending` as the tool's result and burned an iteration; the agent died at the cap without writing anything | the loop SUSPENDS and resumes ([RN-073](../business-rules.md#rn-073)); the outcome delivery was fixed later — the event was born in an aggregate the engine's drain didn't read — and the path is now covered end to end |
| **O / B** | the session and dev agents were born on local `llama3.2:1b`, which ADR 0020 forbids in the semantic step | when the cascade lands on the workspace default, the inherited model is the **Creative agent's** ([RN-072](../business-rules.md#rn-072)) |

The inheritance fills the **gap** and never overrides: session, agent or
project binding are explicit choices and still win. And the inherited
model goes through the same cascade filters — missing from the catalog or
without tool calling is not inherited.

Closing this phase **wasn't** enough, and that's its most useful finding:
the agent started walking and died of something else (Phase F, the
`413`). *"No dev agent had ever finished a task"* remained true — what
changed was the reason.

**Risk of waiting: high.** Until this closes, remote PR, QA/SecOps gates
and 13b's measurement stay dammed up behind it — and every dogfooding
round spends money just to reconfirm the same blockage.

## Phase B — Engine on a remote provider (P1) — **DONE**

**N** — `get_local_repo_path/1` returned `unsupported_provider` for
anything other than `local`, and four consumers stopped along with it. The
**api** speaks GitHub over HTTP; the **engine** works on the file system
and only knew local bare repos, so a remote project ran the conversational
half and stalled in the build half.

Closed via [ADR 0056](../adr/0056-o-engine-trabalha-em-repositorio-remoto.md)
and [RN-076](../business-rules.md#rn-076): the engine requests the working
remote from the api, which holds the master key, and the credential comes
in **per invocation** — the origin recorded in `.git/config` is wiped.

**The finding that shrank the problem:** two of the four consumers never
actually needed a credential. `Diff` and `ProjectContext` only use the
branch NAME — they were stalling as collateral damage from a function
returning more than they'd asked for.

### What Phase B did NOT close

- **Isolation**, again. The token left the disk, but the agent still runs
  in the same container as the Brabo monorepo. It's the same pending item
  ADR 0055 already declared, and it now has two phases pointing at it.
- **Proof against a real GitHub.** `fetch` and `push` go through `GitAuth`,
  and the tests cover the local path end to end (a push that arrives at
  the other side's bare repo) and the named errors. What no test can give
  is a real remote repository with a real token — that's 13b's execution,
  which now has a way to happen.

## Phase F — Executor boundary and cap (P1) — **DONE**

The `hello-limpo` execution died here, and both items shared the same
root: the terminal executor had no limit — neither on **where** a command
could reach, nor on **how much** it returned.

| item | what it was | how it closed |
|---|---|---|
| **S** | accumulated context overflowed the provider's byte limit and the call came back `413`. Every terminal output stayed in the history and traveled along in every subsequent turn | a byte cap in the executor, with a marker addressed to the model ([RN-074](../business-rules.md#rn-074)) |
| **U** | `/workspace` inside the executor is the **Brabo monorepo itself**, and `/data/project-workspaces/*/` grants access to other projects' worktrees | path scope in the decision ([RN-075](../business-rules.md#rn-075), [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) accepted) |

Scope closed both sides at once: it **tightened** (an allowed verb
pointing outward stopped auto-approving) and it **loosened** (`cd`ing
inward stopped rejecting the composite command, which was the ladder's
most expensive defect).

### What Phase F did NOT close

Recorded here rather than declared done:

- **Isolation.** ADR 0055 is policy, and says so of itself. As long as the
  Brabo monorepo is mounted in the container that executes the commands,
  the boundary depends on the rule getting it right. Normalization is
  lexical: `..` is rejected, a symlink pointing outward from inside isn't
  detected.
- **ADR point 6 — generalizing "always allow."** Still records the literal
  command, which never matches again. It wasn't included because
  generalizing EXPANDS what a click authorizes (approving `cat foo` would
  end up allowing `cat` on anything), and that's a product decision that
  deserves its own scrutiny rather than a free ride.
- **ADR point 7 — the event recording which scope authorized it.** The
  decision's reason already says so, but it isn't persisted in
  `proposed_action.created`.

## Phase C — The UI can't lie about agents (P2) — **DONE**

Five items with the same root: the screen told a different story than
the event log.

| item | what the screen does | state |
|---|---|---|
| **C** | the live bubble comes labeled with the **model**; the agent only appears once the persisted event arrives — and the message stays duplicated until reload | **DONE** — the delta now carries the agent, and the refetch is deferred while the turn is streaming |
| **G** | the Creative agent's invitation doesn't appear on a created project, because the thread already has the bootstrap cards | **DONE** — the condition became "the conversation started," not "the thread is empty" |
| **L** | the footer button still reads "I'm ready to produce" after the handoff out of the Creative agent | **DONE** — it disappears once there's a handoff leaving the Creative agent |
| **H** | bootstrap events all appear as "activity in system" | **DONE** — the five types got their own family, with the step translated |
| **I** | changing the session's model retroactively rewrites old actions' labels | **DONE** — the card stopped asserting a model it has no way of knowing |

**C** was the most severe of the five and was flagged by you during the
run: it's the agent that speaks, the model is an execution detail.

**I deserved a decision, not just a fix.** The card received the
session's CURRENT model, and there's no source of truth for the model per
action — `proposed_actions` doesn't store it, and `token_usage` isn't
linked to the action. Between making one up and no longer asserting one,
the second is the only honest choice: who proposed it is already on the
card, in bold, and it's the **agent**, which is the part that doesn't
change. The label went away along with the prop, which was left with no
other consumer.

**H** turned into copywriting: the five `bootstrap.step_*` types got
their own family with the step translated into Portuguese, and only
`step_failed` is marked as bad — `degraded` and `skipped` are expected
outcomes, and painting them red would teach people to ignore red.
`create_rc_branch` still gets translated even though it's retired
(ADR 0030), because projects bootstrapped before have the event in the
log.

## Phase D — The wizard tells the truth and has an exit (P2) — **DONE**

| item | what it was | how it closed |
|---|---|---|
| **D** | `Protect branches` fails on a private repo on the free plan, and the wizard **warns about it beforehand**. The only action offered afterward was "Try again," which always fails | [RN-078](../business-rules.md#rn-078) |
| **E** | the repository preview lied: `repo: brabo/{slug}` hardcoded, with the real owner coming from the PAT | already done (commit `4dd7a073`) — the label now shows only the slug, which is what's actually known |
| **F** | the "Branch policy" step listed `rc` among the permanent branches | already done (commit `4dd7a073`) |

**E and F were already fixed** by the time I went after them, in a commit
that closed four findings at once. Discovering that cost a read; the
backlog didn't know because it was written earlier.

**Item D was bigger than the description suggests.** It wasn't just "a
dead-end screen": `provision_failed` makes the dashboard **redirect the
project's click back to the provisioning page**, so the project became
unreachable forever, stuck on a step that can never succeed. The exit
needed a route, a use case and an event — not just a button.

**Only the protection step can be acknowledged**, and that's the decision
that matters: it's the last step and the only one whose failure still
leaves a usable repository. Offering "continue" on an earlier failure
would be a second lie on top of the first.

## Phase G — The failure outcome tells the truth (P2) — **DONE**

The same CLAUDE.md rule violated three times: **P** (`dev.blocked` with
`origin: null`), **Q** (`agent.error` with `"undetermined"`) and **T**
(a recurrence: `dev.blocked` with `"undetermined"` on a failure whose
`diagnosis` field named the cause on the SAME line).

Closed via [RN-077](../business-rules.md#rn-077), and the root-cause
diagnosis is what changed the shape of the fix: **the classifier already
existed and would already have gotten it right** —
`FalhaDeTurno.origem/1` maps status ≥ 400 to `codigo`, which correctly
classifies finding T's `413`. The defect was never a missing rule; it was
`block_task` having `"undetermined"` as its **default**, with the call
sites passing nothing.

So the fix is structural, no longer another rule: **the default is
gone.** Forgetting the origin is now a compile error, instead of a
syntactically valid, semantically empty event.

`indeterminada` no longer exists. It meant *the classifier didn't
recognize this shape* — a gap in our own code —, and `codigo` is the
origin that points to the right action. `indeterminada` pointed to none,
which was exactly the finding's complaint.

## Phase H — Session state doesn't lie (P2) — **DONE**

**V** — session `1f94de49` showed `closed` since 23:34:42 and execution
kept going until 00:56.

The cause wasn't the state machine: it was **the heartbeat**. The session
was born at 23:34:12 and closed at 23:34:42 — exactly the 30s of
`SESSION_HEARTBEAT_TIMEOUT_MS`. [RN-064](../business-rules.md#rn-064)
already required checking for pending work before closing, but "pending
work" only meant a **`offered` handoff** — and there was a `pending`
action since 23:34:13, created one second after the session was born.

An action awaiting a decision now counts. It's the same defect one level
below the handoff: someone is waiting on **you**, and an agent may be
suspended waiting on the outcome ([RN-073](../business-rules.md#rn-073)).

**The rule's earlier version said, in writing, that including agent work
"without a test proving the interaction would be guessing."** The
execution produced the proof, and that's what separates this fix from a
guess.

### What Phase H did NOT close

- **A task `in_progress` with no pending action and no handoff.** The
  signal would require the api to read `dev_agent_states`, which belongs
  to the engine — a boundary decision, not a passing fix.
- **`closed` still accepting approval.** With the heartbeat fixed, the
  session stops closing with a dangling action, so the case becomes rare.
  Blocking the decision on an already-closed session is a behavior change
  with its own consequence: an orphaned action from an already-closed
  session would have no one left to decide it.

## Phase E — Quality of what agents produce (P3)

| item | what happens |
|---|---|
| **K** | running the Creative agent twice on the same project left 10 rules, 5 orphaned — no dedupe or warning |
| **R** | the PO generated two stories covering the same endpoint |
| **J** | the Psychologist runs on a freshly opened session with the previous session's hypotheses and an empty log, tries to cite non-existent events and gives up |

**DONE**, with a declared cut in the middle.

**J was mechanism, contrary to what this section assumed.** An empty log
is a verifiable condition, and the defect was in the count that decided
whether it was worth running: it summed the bootstrap's machine steps
and — worse — the trail the Psychologist itself leaves in the session
while analyzing it, which made an empty session look populated starting
from the first analysis, and more populated with every retry. Closed via
[RN-079](../business-rules.md#rn-079), with the finding's session
reproduced as a test.

**K and R were the same prompt, and that's why they only closed as far as
code can reach.** An EXACT duplicate rule is refused at emission
([RN-080](../business-rules.md#rn-080)); a story with an identical title
is refused and one that adds no coverage becomes a warning
([RN-081](../business-rules.md#rn-081)) — a warning, not a block, because
a second cut of the same rule can be legitimate and it's the user who
judges.

What was **not** resolved, and is written into the three RNs instead of
left implicit: semantic duplicates. The exact pair from finding R —
"Deterministic public greeting endpoint" and "Public GET /hello endpoint
that returns an immediate greeting" — still gets through, because nothing
mechanical links the two. There's a test asserting this limit, so it's a
visible decision rather than a forgotten gap.

## Standalone

~~**`promotion-check` with no spec of its own**~~ — **DONE**. It was the
only required check in the family without a test (`pr-police`,
`approval-ladder` and `gate` all have one). Found while writing the gate
registry (FASE 15a, PR #145).

`scripts/ci/promotion-check.spec.ts` covers both pure functions, asserting
the RULE and not the implementation: which stamp each destination
requires (`qa` requires `dev`, `main` requires `qa`, `dev` requires
nothing), and what counts as a stamp for **that specific** commit — a tag
on another commit doesn't count, a tag for another stage doesn't count,
and a tag that failed to resolve a sha doesn't count as a stamp by
default. It's this set that keeps `qa` from receiving code that never
went through `dev`.

~~**The four sibling secrets of the production compose**~~ — **DONE**
([RN-114](../business-rules.md#rn-114)). `AUTH_JWT_SECRET`,
`BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY` and `SECRET_KEY_BASE` had
development defaults in `docker/docker-compose.prod.yml`, which runs with
`NODE_ENV=production` — the same pattern
[ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md) had
already closed for `GIT_OAUTH_STATE_SECRET`, for the same reason: the
value is public, it's in this repository.

The worry recorded below — that each one deserved its own decision —
wasn't pointing at four different DECISIONS, only at three checks living
in different places: `passphraseAtual()` (`auth-key-material.ts`),
`tokenDeServicoAtual()` (`service-token.ts`) and the
`EnvelopeEncryptionService` constructor, each with the SAME rule as
`resolveOauthStateSecret()` (missing/example/short crashes the boot in
production). `CREDENTIALS_MASTER_KEY` refusing to BOOT isn't the same
problem it feared — it doesn't touch rotation at all, which still exists
via `CREDENTIALS_MASTER_KEY_PREVIOUS` + `rewrap-deks.ts`; the check only
stops the example key from reaching production. `SECRET_KEY_BASE` already
had the right `raise` in `runtime.exs` — the real defect was the compose
masking it with a public fallback, and the fix was just removing that
fallback, without touching any Elixir code.

---

## Older backlog

Items that already existed before this round. These aren't defects, they
are deferred product decisions — hence no priority here.

| item | where it was decided |
|---|---|
| ~~Budget per area~~ | **FIXED AND CLOSED.** `agent_areas` gained `budget_micros`/`spent_micros` — a THIRD independent ceiling next to project/session, additive (not the ADR 0064 cascade), mirroring `max_parallel`'s pattern on the same row ([RN-443](../business-rules.md#rn-440), [ADR 0110](../adr/0110-budget-por-area-aditivo-nao-cascata.md)) |
| Dev Lead and `module_map`-based areas | **left the backlog**: ADR 0053, implemented by FASE 14d |
| ~~Manual handoff to an agent of choice~~ | **CLOSED** — [ADR 0109](../adr/0109-handoff-manual-a-agente-a-escolha.md)/[RN-440](../business-rules.md#rn-440)/[RN-441](../business-rules.md#rn-441). `SessionPage.tsx` gained a picker over `addressableAgents()` (leads ∪ solo agents) POSTing to `POST .../sessions/:sessionId/handoffs` — the SAME `CreateHandoffUseCase` an agent's own `offer_handoff` uses, with `actor: {kind:'user'}` recording who decided. The Staff (ADR 0088) and `ux-designer` (ADR 0087), both found reachable only via the internal route, entered `AGENTES_DE_CHAT` in the same change |
| MFA, social login, OIDC, federation | [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md) — social login (GitHub/GitLab) LEFT the ban and is implemented (ADR 0084); the rest stays out of scope |
| Deploy (`DEPLOY_ENABLED` + Environments) | the `operavel` gate is already declared `planned` |
| Return of `rc`/`rcfix` | [ADR 0030](../adr/0030-politica-de-branches-mecanizada.md) |
| ~~Community mode of the approval-ladder~~ | **FIXED AND CLOSED.** The reference "becomes a change to `aprovacao_humana` in the gate registry" was imprecise — it came from a speculative sentence in ADR 0054, not from something actually missing. The `community` mode is already implemented and tested since FASE 6 (`scripts/ci/approval-ladder.ts`), just switched off by `APPROVAL_MODE=solo` (default); `aprovacao_humana` for the `aprovacoes-da-escada` gate is already `true` in both modes, with no `APPROVAL_MODE` awareness in the schema. What was genuinely missing was the `TODO(humano)` in `branching-policy.md` — the criterion for who joins each approver list —, closed by `GOVERNANCE.md` (repository root). Actually activating the mode remains an operational decision (recruiting real people for the three roles), not an engineering pending item |
| ~~Currency preference with manual exchange rate~~ | **WON'T DO** — decision recorded. Converting would require a manually-maintained exchange rate, which ages; a wrong number is worse than an honest USD number (same principle already applied in `formatarCustoMicros`, `ProjectSettingsTab.tsx`) |
| Reactivate the Anamnese (`ANAMNESE_ENABLED=true`) | paused by user decision on 2026-08-10 — "today it isn't bringing much-value data" ([RN-115](../business-rules.md#rn-115)). No data was erased (hypotheses, proficiency profiles and instruction patches remain intact and visible); the pause is only on the new-round PATH, awaiting future refinement of what Anamnese derives before turning it back on |
| Reactivate the Psychologist (`PSYCHOLOGIST_ENABLED=true`) | paused by user decision on 2026-08-10, same reason and same pattern as Anamnese above ([RN-117](../business-rules.md#rn-117)). No data was erased (already-emitted analyses and hypotheses remain intact and visible); the pause is only on the new-round PATH (automatic and on-demand) |

## Backlog of the runner/execution_mode (ADR 0104)

First finding of the "two ADRs diverging from each other" kind recorded in
this document — the table precedents below (the `fluxo.yml`×code audit,
already closed) were always doc-declarative × code, never ADR × ADR. The
table's shape is reused; the kind of finding is new.

**The divergence, closed by [ADR 0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
— reconciliation ACCEPTED, Wave 1 (RN-421/422/423) DONE:**

| # | Severity | Item | Evidence (file:line) |
|---|---|---|---|
| 1 | **CLOSED** (RN-423) | RN-170 required bind-mount at creation; RN-420 routed to the runner under the same `workspace_mode == 'local'` flag, with no bind-mount at all | `apps/api/src/application/use-cases/iam/confirm-project-workspace.use-case.ts` (the runner confirms and becomes the source of truth); `apps/engine/lib/engine/actions/terminal_executor.ex` (`decisao_de_execucao/1`, four outcomes — explicit refusal without a verified workspace/connected runner, never a fallback to the container) |
| 2 | **CLOSED** (RN-422) | The wizard only taught bind-mount, never the runner command, even though it already existed | `apps/web/src/routes/NewProjectWizard.tsx` — third entry in `MODOS_DE_WORKSPACE` (`runner`), with the command `brabo-runner --project <id> --dir <pasta>` right in the "Where the code will live" step, not just in the Terminal |
| 3 | **CLOSED** (RN-421) | A 2-value enum (`workspace_mode`) didn't express 3 physically distinct execution modes | `apps/api/src/db/migrations/0048_quiet_iron_fist.sql` (`project_execution_mode`, three values); `apps/api/src/domain/iam/project.entity.ts` (`PROJECT_EXECUTION_MODES`) |

**Correction recorded during Wave 1's implementation, CLOSED separately**
(not itself one of this document's numbered runner waves — see below):
item 4 of ADR 0104 stated that converting between the three modes of an
EXISTING project "becomes allowed without recreating the project." Wave 1
found that incorrect — `UpdateProjectDto` still deliberately excluded
`executionMode`/`workspacePath`, and only the three-value field at
CREATION had actually been delivered. **[ADR 0111](../adr/0111-conversao-de-execution-mode-de-projeto-existente.md)
makes the sentence TRUE again**, via a dedicated route (`PUT
.../execution-mode`, `ConvertProjectExecutionModeUseCase`, RN-447..450) —
not by editing ADR 0104's accepted text, which stays as it was written,
wrong at the time and corrected here instead:

| item | cost | activation criterion | where it was decided |
|---|---|---|---|
| ~~Converting `execution_mode` on an EXISTING project, without recreating it~~ | **CLOSED** (RN-447..450) | — | [ADR 0111](../adr/0111-conversao-de-execution-mode-de-projeto-existente.md) |

**Wave 2 — PAT, [ADR 0105](../adr/0105-personal-access-token-do-runner-escopado-por-construcao.md), DONE (RN-424/425/426; RN-427 closed later, same decision wave):**

The "long-lived account token" item in the original table had TWO textual
errors, corrected during implementation instead of being followed
blindly — recorded here because the table below repeated them:

1. **"argon2 hash in the database" was wrong.** The product's real
   pattern for a HIGH-entropy secret (256 bits of CSPRNG) is
   HMAC-SHA256 + pepper via `hashDeToken()`/`TokenFactory` — the same
   mechanism as refresh tokens and account tokens. Argon2 is for a
   LOW-entropy secret (password), where dictionary resistance matters;
   here it would just break the indexed lookup `WHERE token_hash = $1`
   for no gain.
2. **"reusing the refresh-token-family rotation infrastructure" was
   imprecise.** A PAT is presented repeatedly WITHOUT CHANGING — never
   consumed-and-reissued like a refresh token. Only the generation
   (`TokenFactory.gerar()`) and the hashing are reused; the whole
   family/rotation would be inventing a behavior the PAT doesn't need.

| # | Severity | Item | Evidence (file:line) |
|---|---|---|---|
| 1 | **CLOSED** (RN-424) | The PAT needed to authenticate `runner-ticket` without becoming a valid credential for any other route of the user | `apps/api/src/interfaces/http/auth/pat-route.decorator.ts` (`@RequirePatAuth()`), `apps/api/src/interfaces/http/auth/jwt-auth.guard.ts` (third early-out), `apps/api/src/interfaces/http/auth/pat-auth.guard.ts` (`PatAuthGuard`, applied only to `runnerTicket`) |
| 2 | **CLOSED** (RN-425) | High-entropy token validation without leaking which of the three refusal reasons (nonexistent/revoked/expired) applies; `last_used_at` not regressing on a legitimate reconnection | `apps/api/src/infrastructure/persistence/drizzle/personal-access-token.repository.ts` (`validarEUsar` — a single conditional UPDATE, no throttle on the same WHERE) |
| 3 | **CLOSED** (RN-426) | Issuing/revoking/listing without leaking one user's token to another | `apps/api/src/application/use-cases/auth/*-personal-access-token*.use-case.ts`, scoped by `userId` in the query's WHERE |
| 4 | **CLOSED** (RN-427) | `maintainer` revoking ANOTHER user's PAT (incident response — a dev leaving with a leaking token), declared out of scope at the time | `apps/api/src/application/use-cases/auth/*-personal-access-token-as-maintainer.use-case.ts`, `apps/api/src/interfaces/http/runner/personal-access-tokens.controller.ts` (`listAllPats`/`revokePatAsMaintainer`, separate routes, `@RequireRole('maintainer')`), scoped by `projectId` in the query's WHERE |

`apps/runner/src/auth.ts` completely lost interactive login, cookies and
`~/.brabo/runner-credentials.json` — it only validates the format and
passes through `--token`/`BRABO_ACCOUNT_TOKEN`, never written to disk by
the CLI.

**Wave 3 — npm distribution, [ADR 0106](../adr/0106-distribuicao-do-runner-via-tsup-e-npm-publish.md), DONE:**

| # | Severity | Item | Evidence (file:line) |
|---|---|---|---|
| 1 | **CLOSED** | `apps/runner` was `"private": true`, with `bin` pointing at a raw `.ts`, reachable only by cloning the monorepo | `apps/runner/tsup.config.ts` (`format: cjs`, `external: ['node-pty']`), `apps/runner/package.json` (`bin` → `dist/index.cjs`, `publishConfig.access: public`), `.github/workflows/publish-runner.yml` (publishes on every final tag, its own workflow, parallel to `release.yml`) |

Real finding during implementation, tested empirically before it went
into the code: the obvious fix for `index.ts`'s auto-run guard
(`import.meta.url === pathToFileURL(argv[1]).href`) was BROKEN in exactly
the case this wave exists to enable — invocation via the installed `bin`
(`npm install -g` creates a symlink, and `process.argv[1]` is never
resolved by realpath while `import.meta.url` always is). The final fix
applies `realpathSync` to `argv[1]` before comparing — see ADR 0106.

**What's left for later — backlog prioritized by the product owner, in
this order:**

| item | cost | activation criterion | where it was decided |
|---|---|---|---|
| Standalone binary (`pkg`/`bun build --compile`) | G | not blocking; no trigger defined, future item separate from npm distribution | ADR 0104 |
| Runner exclusivity by `{project_id, machine_id}` instead of just `project_id` (`apps/engine/lib/engine/runners/registry.ex`) | M | DEFERRED — explicit activation criterion: a second dev actually using the same project simultaneously | ADR 0104 |

`apps/runner/src/guard.ts` (best-effort lexical check of `cwd`) **is not
a backlog item** — it's an invariant declared since ADR 0103 and
REAFFIRMED by ADR 0104: the runner's real security boundary is
authentication + the usual approval pipeline + user consent, never
sandboxing.

## Backlog of the team model (ADR 0085) — AUDIT CLOSED

Output of the `fluxo.yml` × code audit
([auditoria-fluxo-vs-codigo.md](auditoria-fluxo-vs-codigo.md)). These were
items declared in the model (`docs/fluxo.yml`) about roles already
**active** — none was waiting for any `proposto`/`planned` role to
activate first. The plan's six waves closed, and this table is now
**empty**: the last item (B4, the PO reading `metricas-de-produto`)
closed with RN-407, no new ADR — the same pattern already established by
RN-164 (agent reads scoped to the project, no external effect). The audit
document has the full wave plan, with cost and verification criteria per
item, for anyone who wants the history.

**Closed since the audit** (not removed from the original reference, only
from this pending-items table): the `implementavel` gate (B3, ADR 0090);
`docs/gates.yml` out of date for `paralelismo-autorizado` (A1/B5, fixed
alongside A3–A5/A8 — wrong RN citations and labels in `fluxo.yml`); real
deployment frequency and lead time via `analise:funil` (part of B7, ADR
0089) — the rest of B7 (MTTR, change failure rate) didn't close: it
remains declared as a PERMANENT gap in `fluxo.yml` (role
`delivery-metricas`), not an engineering pending item; the Dev Lead →
dev delegation (B1) and RN-160 without backend revalidation (A6/B6) —
audit Wave 2, ADR 0094, RN-404/405; the `necessidade-validada` gate (B2)
— audit Wave 6 (the last), ADR 0095, RN-406; **product metrics → PO
(B4)** — the report (`analise:funil`, ADR 0089) already existed, all
that was missing was the PO READING `metricas-de-produto`; closed with the
`listar_metricas_de_produto` tool and the pure functions extracted into
`apps/api/src/application/services/funil-metrics.ts` (RN-407) — the
table's last pending item, closing the audit.

## What this triage does NOT do

It fixes nothing. The discipline that's held since Phase 10 continues:
each finding waits for the phase that addresses it, and fixing it outside
that phase erases the evidence of why it existed.

And it doesn't invent priority where there's no data: the items in the
older backlog got no P1/P2/P3 because their decision belongs to the
product, not to engineering — and a guess dressed up as a classification
would be worse than the raw list.

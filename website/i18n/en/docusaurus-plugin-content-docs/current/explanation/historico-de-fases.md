---
id: historico-de-fases
title: Phase history
sidebar_label: Phase history
sidebar_position: 14
description: Immutable record of Brabo's completed phases — what each one delivered, cut and found, and why.
keywords: [history, phases, ADR, RN, changelog]
traducao_de: a65c25acf8e673b8ee0d104512a284ee5f8606c5
---

# Phase history

> Immutable record of Brabo's completed phases, moved from CLAUDE.md on
> 2026-08-23 without rewriting. The product's CURRENT state lives in CLAUDE.md,
> in the RNs (docs/business-rules.md) and in the ADRs — this file answers "how
> we got here", never "what holds today". An accepted ADR is never edited; the
> ADR corrections recorded in this text remain valid where they are.

## Status {#status}
- FASE 1 (MVP) — COMPLETED: IAM/RBAC, sessions with an immutable event log,
  chat with an LLM router (Ollama + APIs), token metering/budget,
  proposed_actions pipeline + permissions.json, Elixir/OTP engine with
  supervision and a termination event.
- FASE 2 — COMPLETED: GitProvider (Local/GitHub/GitLab) with a contract
  suite and capabilities, encrypted credentials, idempotent Gitflow
  bootstrap resumable through the pipeline, wizard with live
  progress.
- FASE 3 — COMPLETED: Harness (PromptAssembler, ToolLoop,
  ContextManager, InstructionFiles, Hooks), explicit handoffs,
  Criativo, PO and Arquiteto agents with artifacts and validations in the
  domain.
- FASE 4 — COMPLETED: execution agents (dynamic per-module devs
  in isolated worktrees, QA and SecOps as PR gates, proactive
  Infra), protected-merge lock, live team panel;
  real Psicólogo and Anamnese with a closed loop. Gates validated by
  real execution (ADR 0020).
- FASE 5 — COMPLETED: non-root production images and CI (ADR 0024),
  Kubernetes with Kustomize, HPA by Oban queue, NetworkPolicies and
  ESO (ADR 0025), graceful shutdown + OpenTelemetry + dashboards
  (ADR 0026), backup with tested restore, runbooks and hardening
  (ADR 0027).
- FASE DOC — COMPLETED: docs/ as the single source with Diátaxis, a
  Docusaurus site in website/ reading from docs/, generated references,
  docs/.docmap.yml + drift check (docs:check) in CI, a
  community layer, MIT verified, mechanism documented in
  docs/explanation/documentation-workflow.md.
- FASE 6 — COMPLETED: mechanized branch policy (ADR 0030) —
  pr-police, approval-ladder with both modes, promote/tag-release
  with a calculated version and a tree anchor, backmerge gate with
  automatic back-propagation, versioned rulesets. Pipeline exercised
  end to end (v0.1.0 → v0.2.0) and the hotfix chain validated by
  real execution.
- FASE 7 — COMPLETED: first-party auth replacing Keycloak —
  argon2id, Ed25519 access, refresh rotation with family
  revocation, progressive lockout, account tokens and a log-only MailSender
  (ADR 0031, RN-030..033); atomic cutover with its own issuer, RBAC
  untouched, /internal/* with a service token, httpOnly cookie + CSRF,
  user migration and total removal of Keycloak (ADR 0032,
  RN-034/035); OpenAPI on the 23 controllers with type-locked DTOs,
  a table test requiring metadata, docs/reference/api/ generated with
  a hash manifest (ADR 0033).
- FASE 8 — COMPLETED WITH A CUT: agent hierarchy — areas with a single
  lead as the external contact, private internal delegations (table
  `delegations`, `area` as TEXT), consolidated verdict with
  traceability, failure with origin; QA as an area (Lead + Automation +
  Performance/Security, the gates' external contract unchanged — the Fase 4
  suite green without modification); Infra as an area with a Workflows
  subagent generating CI per provider; team panel by area and
  Psicólogo/Anamnese targeting subagents (ADR 0038).
  SCOPE CUT of the time, REVOKED by FASE 14d:
  `agent_areas`/`agent_area_members` exist since then, per project,
  with configurable `max_parallel` — it was the dev area, the first
  DYNAMIC one, that forced it. What remains cut is only the **budget per area**
  (real budget ceilings remain project, session and task).
  The `apps/web/src/lib/agents.ts` list survived for color, icon and
  the addressing RULE; dev members come from the table.
- FASE 9 — COMPLETED: LLMProvider contract suite running
  against the existing ones, OpenAICompatibleProvider base on
  node:http with an INACTIVITY timeout, error normalized by `code`,
  capabilities in two layers (ADR 0041); catalog sync with a discovered
  model coming in disabled, a vanished model marked instead of
  deleted, price frozen in `token_usage` with append-only auditing
  (ADR 0042); ModelPicker regrouped by origin with curation.
  The six 9b providers came in through Fase 11 (ADR 0043).
- FASE 10 — COMPLETED: Bitbucket + GenericGitProvider delivered VIA
  dogfooding (the first real run of Brabo building Brabo itself,
  in a fork with a manual seed, batches with a restart between tasks,
  Criativo mandatory in the chain). Harvest written in Fase 12d, in
  docs/explanation/primeiro-dogfooding.md — the 17 findings with
  file:line are real; the QUANTITATIVE half (restarts,
  interventions, cost) stayed as `não medido`, because the observation
  table was never filled in. The three operability P1s were
  closed by Fase 12. The other 14 remain open and listed in the
  harvest — don't fix them in passing.
- FASE 11 — COMPLETED: the six Fase 9b providers as config on top of
  the base, each one investigated from scratch against the official docs (inheriting
  quirks forbidden); LLM_PROVIDER_NAMES from 3 to 9; credential DTO and
  connection tester deriving from a single list; capability only
  declared when proven, with two live reversals (DeepInfra and
  Vultr); a single new hook in the base (`parseErrorFrame`, +31 lines)
  proven necessary by OpenRouter (ADR 0043).
  Pending smokes with a real credential: absorbed by FASE 13.
- FASE 12 — COMPLETED: post-dogfooding operability, the three P1
  findings closed and proven in a single run (ADR 0047).
  12a — adoption of an existing repository: its own route, `getRepo`
  validating access before writing, `origin` (created|adopted) in both
  tables, and the PLAN as the gate — a dry-run that describes the divergence and
  changes nothing while the decision is null; re-adopting converges
  (ADR 0044, RN-045/046).
  12b — event-driven rescheduling of the dev agent: a persisted state
  machine (working|awaiting_gate|idle|idle_tripped) reacting to two
  events of the existing outbox, `awaiting_gate` retaining the worktree (which
  is per AGENT, not per task) until the gate ends, and a circuit breaker
  with explicit rearm (ADR 0045, RN-047).
  12c — story promotion with the user's authority: `story_promotion`
  per project with `manual` as the NEW DEFAULT (a targeted backfill puts the
  existing projects in `auto`), `proposed_ready` as a proposal and not a
  state, promotion reusing TransitionStoryUseCase (dead code from
  finding #13) and refusal returning to the PO with the reason pinned in its
  session (ADR 0046, RN-048).
  12d — the Noop entered the 12b state machine; the script
  `pnpm --filter api validacao:fase-12` that exits != 0 when the criterion
  doesn't close and extracts the evidence from the database; Fase 10 harvest
  written; docmap covering engine/dev and engine/agents.
  Pending items (running the validation; Local/Noop limits declared):
  absorbed by FASE 13.
- Don't refactor what is done without an explicit request.

## FASE 13 — COMPLETED on 2026-08-07 (prove it for real and triage) {#fase-13--concluída-em-2026-08-07-provar-de-verdade-e-triar}
No new feature. The phase closes the declared pending items, proves what
the Local/Noop validation admittedly doesn't prove, and turns the
19 open findings into a prioritized plan. Lesson incorporated: the
manual table of Fase 10 was never filled in — in this phase EVERY metric is
extracted by script from the event log/token_usage, never noted by hand.

### 13a — Close the declared pending items {#13a--fechar-as-pendências-declaradas}
1. COMPLETED on 2026-08-07: `pnpm --filter api validacao:fase-12` exits `0`
   and the table of event ids is in docs/explanation/validacao-fase-12.md
   (the TODO(humano) came out). It cost four fixes — three to the INSTRUMENT
   (the guinea pig was born in /tmp, invisible to the engine; the Noop didn't open the
   gate; the Noop died at `pr_settled`) and one to the PRODUCT (finding W: the
   dev agent died when the queue emptied).
2. PARTIAL on 2026-08-07: the **OpenRouter** smoke ran with a real credential
   and closed (real cost US$ 0.000005, read from `token_usage`). The
   other five remain skipped — there is no key for them in the environment. The smoke
   had rotted against ADR 0049 and had never run; fixed
   along with it. Dated result in docs/explanation/aceite-providers.md

### 13b — COMPLETED on 2026-08-07 (v2.4.0) {#13b--concluída-em-2026-08-07-v240}
The whole chain proven against REAL GitHub (`daneiel/test`), in ten
runs: remote adoption → plan with the user's decision → manual
promotion of ONE story → real dev agent writing code → commit, push and
REMOTE PR → gate opens → area delegates and dismisses with justification →
subagent SUSPENDS on approval → the user's refusal RESUMES the loop →
`changes_requested` verdict by LLM. Zero engine restarts. Merge
out, by design (RN-014).
3. The script is `pnpm --filter api validacao:real`, with phases split
   by COST (`--ate adocao|backlog|execucao`) — the cheap one runs alone
   first, and that is how configuration errors showed up before
   costing money. It requires running FROM INSIDE the api container: the
   policy is a file in a shared volume, and from the host it is born
   in a filesystem the engine doesn't see.
4. `pnpm --filter api medir:execucao` is the instrument, and it is PROVEN:
   it reproduces on its own the numbers the previous dogfooding had noted by hand
   (18 calls, 292,211 tokens, ~US$ 0.03).
5. Result in docs/explanation/validacao-real.md, with the ten
   runs and what each one taught.

SEVEN P1s closed along the way, all found by EXECUTION and none by
test: W (dev agent died with an empty queue), Y (the search didn't distinguish
empty from not-found), AA (git credential resolved by whoever
clicks, not by whoever pays — RN-082), AB (the gate called a pending decision
an infra failure — ADR 0057), AC (redirection made any
command unapprovable), the ReDoS in the path scope (CodeQL HIGH), and the
postgrex CVE.

Of the findings the phase opened, X closed later (FASE 14d, RN-085 — the
iteration ceiling became per agent TYPE). TWO remain open, and their
argument is worth more than the numbers: Z and AD (the verb allowlist
does NOT converge: verb, form and invocation are distinct spaces, and
runs 6/7/8 got stuck on one of each), and AE (the QA agent tries to
fix the code it judges, against its own prompt — contained by
two independent barriers, allowlist and scope). Neither of them is a
bug to fix: they are a product decision, and are in
docs/explanation/achados-execucao-real.md.

The conclusion the phase delivers, and that matters more than the PR: the path
to autonomy does NOT go through loosening policy. It goes through the agent
WAITING for the decision instead of dying — what ADR 0057 did for the
gates, extending 0052.

### 13c — COMPLETED: the triage became docs/explanation/backlog.md {#13c--concluída-a-triagem-virou-docsexplanationbacklogmd}
The 19 findings are closed (19 of 19). The document stays alive and
received the new findings from 13b.
6. Triage session: read docs/explanation/primeiro-dogfooding.md and
   classify the 19 findings into P1/P2/P3 with a proposed grouping
   into cohesive phases (by theme and dependency between them), estimated relative
   cost (S/M/L) and the risk of waiting. The output is a PROPOSAL — the
   priority decision is the user's.
7. Consolidate the full backlog into a living document
   (docs/explanation/backlog.md or equivalent): triaged findings +
   old items — budget per area (ADR 0038; the areas apparatus and the
   Dev Lead left the backlog with ADR 0053, implemented
   by FASE 14d), manual handoff to an agent of choice,
   MFA/social/OIDC/federation (ADR 0031),
   real SMTP in MailSender, deploy (DEPLOY_ENABLED + Environments),
   return of rc/rcfix (ADR 0030), community mode of approval-ladder,
   "N agents online" on the dashboard, currency preference with a manual
   rate.

## FASE 14 — COMPLETED on 2026-08-07 (what real execution demanded) {#fase-14--concluída-em-2026-08-07-o-que-a-execução-real-exigiu}
The hello world run didn't get past the first turn and revealed defects that
no suite caught, because everything before ran with a LOCAL model. The fixes
are already in; what remains is a feature decided by the user during the run.

### 14a — Agent operability (COMPLETED) {#14a--operabilidade-dos-agentes-concluída}
- A turn failure became a DURABLE `agent.error` with origin, and the agent SPEAKS in
  the thread; the four conversational ones stopped writing an empty `agent.response`
  (RN-059). The error path narrated in the final frame, which emitted no
  event at all, also closed.
- The Criativo chat opens with an invitation instead of empty: it is activated and waits
  for the user to speak first, and the screen now says so — including that technology
  and code are NOT its job.
- The key the agent spends is the workspace OWNER's (RN-058). Before, the turn
  looked for the credential by the agent's SLUG in a UUID column: no agent
  ever used a provider with a credential, and only `ollama` worked.
- Key spend report, only for the owner, with agent separate from
  person (RN-060).
- Gitflow bootstrap on GitHub: a freshly created repo answers 409 on the whole Git
  Data API, and the first commit goes through the Contents API. The tests' fake
  backend lied (404 where GitHub answers 409) — fixed along with it, it is what
  made the suite stay green with the product broken.

### 14b — Tree timeline (COMPLETED) {#14b--linha-do-tempo-em-árvore-concluída}
One branch per agent, from the first milestone to what it is doing NOW, derived
100% from the event log the screen already fetches. The chronological feed remains, in the
activity column: it answers "what happened", the tree answers "who is
doing what".

Revisited after FASE 26 (no new phase, same spirit of a targeted
fix as 12d/POST-FASE 15): the default opening criterion went from just
"active/stopped" to the 5 agents with the most RECENT activity — active keeps
priority (RN-118); each collapsed branch got its own NOVELTY counter,
with a per-agent "last seen" in `read-state.ts` (same mechanism
as the bell, now granular); and `tool.call`/`tool.result`/`agent.response`
started expanding INDIVIDUALLY (args, result, iteration), grouped
by ToolLoop iteration boundary.

### 14c — Automatic UI validation (COMPLETED) {#14c--validação-automática-de-ui-concluída}
Contrast became a test on `design/tokens.css`, with the known debt measured
and locked; layout (cut-off text, menu outside the viewport, dropdown clipped
by an ancestor, target < 24px) became a browser checker in
`scripts/dev/validacao-visual.js`. No new dependency.

### 14d — COMPLETED: parallelism decided by the LEAD, authorized by you {#14d--concluída-paralelismo-decidido-pelo-lead-autorizado-por-você}
Delivered in four PRs (#181, #182, #183, #184). ADR 0053 became
ACCEPTED, revoking for good the three cuts (Dev Lead, dynamic areas via
module_map and the generic areas apparatus).

1. **Areas became data**: `agent_areas`/`agent_area_members` per
   project, with `max_parallel` default 2. What forced it was the
   **dev** area — the first DYNAMIC one, whose members are one per module of the
   module_map. What is not enumerable in code has to be data.
2. **The ceiling is the SESSION's, not the module's** (RN-083). Counting per module
   would allow N modules × 2 without any authorization — the previous hole
   under another name. Above the ceiling it becomes a `proposed_action`.
3. **Configurable per area** in Settings, requiring `maintainer`
   for the same reason as activating execution: changing the ceiling is deciding how much
   the product spends without asking.
4. **The Anamnese proposes raising it** when authorizing has become routine — three
   approvals and NO denial (RN-086). One denial kills the signal:
   if you ever refused, the ceiling is doing its job.
5. **The Dev Lead exists** (RN-087), conversational, receiving the handoff
   from the Arquiteto in the same confirmation that already delivers to Infra, and
   proposing the plan: how many agents per module and why. The
   `dev-<modulo>` stopped being addressable by handoff — the rule of
   ADR 0038 starting to apply to dev as it already did to QA and Infra.

**Finding X** was closed here (RN-085): `TOOL_LOOP_MAX_ITERATIONS`
became a ceiling PER TYPE — 8 conversational, 60 execution and gate. The criterion
of who goes up is NOT "who works a lot": it is who has
`token_budget_micros` underneath holding the spend. `infra-workflows`
uses a heavy tool and stays at 8, because it runs without a budget.

**Three gaps of the phase itself, found by me while writing the next
slice, and all the same failure**: the ceiling rule came in with green
tests and the product didn't exercise it — no route called the use
case, approving the action executed nothing, and the type could be
auto-approved by permissions.json (closed by RN-086). Testing the piece
is not testing the path to it.

**Out of scope, by declared decision** (ADR 0053 item 5): the
"Activate execution" button changing owner. The Dev Lead → `dev-<modulo>` delegation
through the `delegations` table with `area = "dev"`, which this same item also
declared, STOPPED being out of scope — closed by ADR 0094
(fluxo.yml × code audit, Wave 2, RN-405). The button remains
reversible; execution remains on the current path, and the post-gate fix
still goes straight to the dev who opened the PR.

## FASE 15 — COMPLETED on 2026-08-07 (gates as data) {#fase-15--concluída-em-2026-08-07-gates-como-dado}
No NEW gate. The phase extracts into docs/gates.yml the gates that ALREADY
exist implicitly in the product, with script verification and severity,
in the same spirit as docs/.docmap.yml. An agent gate that doesn't exist
(dev-lead, platform) comes in as `status: planned` referencing the
backlog — never active. The gates' external contract does NOT change.

### 15a — COMPLETED: declarative registry {#15a--concluída-registro-declarativo}
1. docs/gates.yml with the existing gates (see ADR 0054, which extends
   ADR 0048 — the decision in the event log is what makes passing a
   gate measurable), schema validated by test.
2. Loader in the api reading the registry; internal read endpoint.
3. Script `pnpm --filter api validacao:gates` that extracts from the event log
   the last pass of each active gate and exits != 0 if some
   `block` gate has no evidence of script verification.

Not every gate has proof in the event log, and the registry says where it lives:
`merge-protegida` is guaranteed by TEST (the lock in decide.ts emits no
event of its own) and `backmerge` is CI, with state in .release/gate.json.
That is why each gate declares `evidencia: event_log | teste | ci` with the
locator — demoting them to `warn` would be lying about the product's hardest
locks.

### 15b — COMPLETED: consumption {#15b--concluída-consumo}
4. The team panel shows the gate each story/PR is waiting on,
   derived from the registry (not hardcoded).
5. docs/explanation/gates.md explaining the mechanism, in the docmap.

## POST-FASE 15 — COMPLETED on 2026-08-08 (v2.5.0 and v2.5.1) {#pós-fase-15--concluído-em-2026-08-08-v250-e-v251}
Not a planned phase: it is what USE found after 15, and it is here
because the origin of each item matters. None of this came from a script — it came
from browsing the app in Chrome and reading the security panel.

**UI defects, found while browsing** (RN-088..091):
- `429` turned into a WHITE SCREEN and the app answered with more traffic. The rule
  became general: every screen distinguishes THREE states — loading, error (with
  `trace_id` and a button) and empty. `if (!dado) return null` collapses all three.
- The dashboard made one request per project: **3,824 → 12 req/min**, with
  `GET /workspaces/:id/projects-summary`. The bell was the missing half:
  **289 → one** request per cycle (RN-090/091).

**Security hardening, with both panels at ZERO**:
- ADR 0058 — CSP closed in the api (`default-src 'none'`), revising item
  7 of ADR 0027; and the `projectId` contained in the root (RN-092), which hit
  not only `permissions.json` but the scope that AUTHORIZES the terminal.
- ADR 0059 — `GIT_OAUTH_STATE_SECRET` without a default in production (RN-093).
  The default was PUBLIC (`.env.example`) and the production compose supplied it
  as a fallback: requiring "not empty" would have caught nothing, because on the
  real error path the variable was DEFINED.
- An alert that didn't hold up was DISMISSED with a written justification,
  never silenced — and dismissing is the user's decision, not the agent's.

**Three operational lessons that cost a CI cycle, and hold as a rule:**
1. **Green CodeQL on a PR doesn't prove an old alert closed** — the PR
   check reports a NEW alert. An alert closes on the scan of the DEFAULT branch,
   that is, only after the fix reaches `main`.
2. **Gitleaks scans commits reachable from `refs/heads/*`, not the tree.**
   A high-entropy value committed once fails CI forever
   on that branch; fixing on top does NOT clean it. The way out is for the commit to stop
   being reachable (rebuild from `dev` and DELETE the old
   branch BEFORE opening the new PR) — never an allowlist, which blinds the scanner
   on that path for every commit. PR refs are out of scope.
   A fixture that represents a secret is born WITHOUT entropy.
3. **A barrier that lives in another function CodeQL doesn't see** — hence the
   three `js/path-injection` surviving the fix. The centralized check
   was kept (RN-092) and the price was paid on the panel: duplicating it in each
   caller would be a check that one day diverges.

## PROGRAMA 16–26 — what browsing asked for (in progress) {#programa-1626--o-que-a-navegação-pediu-em-execução}
Eleven requests born from the FIRST real browsing of the app after the database
reset. It's not a script: it's use. Three discoveries from the investigation defined the
size and the ORDER of the program, and it's worth recording each one, because none
was in the original request:

1. There is a COMPLETE design handoff in `design_handoff_brabo/` — 8
   high-fidelity screens, tokens, typography and brand. The decision was to adopt it
   WHOLE and FIRST: that way the eleven requests are born in the new look instead of
   being done twice.
2. The Code tab's terminal became an ARCHITECTURE decision. Each project now
   has its own container, and it is the ARQUITETO who decides the image. Inside it the
   agent is free; `git push`, PR and deploy remain human. This pays off the
   product's biggest open debt — today the agent runs in the SAME container
   as Brabo's monorepo, and ADR 0055 says of itself that it is policy, not
   isolation.
3. Two real defects showed up along the way, and neither was requested:
   `agent_areas` is NEVER written (`upsert` without a caller, the API returns `[]`),
   and the bell drawer orders `seq ASC` in SQL — it shows the OLDEST.

Execution ceiling: at most FOUR subagents in parallel. The phases were
cut by CONTESTED FILE, not by theme — that is what makes parallelism
possible. The backend's limiter is `apps/api/src/db/migrations/meta/_journal.json`
and the drizzle snapshots: ONE migration per wave, because resolving a snapshot
conflict by hand is a path to a divergent schema. RN ranges and ADR numbers
are PRE-ALLOCATED before the wave starts: two parallel phases writing
`RN-094` make one renumber at merge, and a renumbered RN breaks the
`#rn-0xx` links that `pnpm docs:check` fails.

### FASE 16 — COMPLETED: foundations (unblock parallelism) {#fase-16--concluída-fundações-destravar-o-paralelismo}
None of the eleven requests delivers here. The phase exists because three of them touch
the SAME four points of `router.tsx`/`ProjectPage.tsx`, and another three
run into the lack of a common piece. Without it, the waves collapse into serial
execution.
1. `design/tokens.css` gets `--violet` (agents/AI) and whatever else the handoff
   defines. The fonts REMAIN self-hosted — following the handoff there would break the
   app under nginx's CSP (ADR 0036). The contrast test covers the new
   pairs, and the known debt of 4 pairs stays locked.
2. The tab stops being a closed list in TWO places: a single registry from which
   `PROJECT_TABS`, `type TabKey`, the ruler and the render start to derive. A test
   that fails a key present in one place and absent in the other — that's the real defect.
3. `Disclosure` in the design system, with the semantics of the most
   complete implementation that already exists (`ModelCatalogSection`). COMPONENT ONLY: none of the
   six ad-hoc implementations migrates here, otherwise the phase would open the three
   most contested files of the program.
4. The session label becomes a helper and the five inline `slice(0, 8)` migrate. It is
   this migration that keeps FASE 20 from colliding with 19.
5. `CLAUDE.md` enters the definition of done (see the Documentation section), with
   a `warn` rule in the docmap. DELIVERED: the rule is `claude-md` in
   docs/.docmap.yml, triggered by `package.json`, `pnpm-workspace.yaml`,
   `apps/*/package.json`, `apps/engine/mix.exs`, `docs/adr/*.md` and
   `docs/gates.yml` — the sentence "today it has ZERO coverage" that was here
   described the state BEFORE the phase and kept lying after it.

### FASE 17 — COMPLETED: the 8 screens per the handoff {#fase-17--concluída-as-8-telas-conforme-o-handoff}
Visual fidelity BEFORE behavior, so as not to redo work. No
business rule changes: if a screen needs data that doesn't exist, that becomes a
declared pending item, not a hitchhiking feature.
6. Login and App/project list.
7. Project and Session, preserving the three states of RN-088 (error before empty).
8. Approvals and Settings — Approvals is the visual base of FASE 19.
9. Proof that fidelity happened: contrast measured on the tokens and
   layout verified by `scripts/dev/validacao-visual.js` on ALL the screens
   touched. The `.dc.html` is a reference, NOT code to copy — the handoff's own
   README says so.

### FASE 18 — COMPLETED: the area exists in the database (a defect, fixed first) {#fase-18--concluída-a-área-existe-no-banco-defeito-corrigido-antes}
10. `AgentAreaRepository.upsert` has NO caller at all, so four use
    cases operate on an empty table. Provision on project creation +
    backfill, with a test that proves a freshly created project HAS areas — it's the
    same failure as FASE 14d: testing the piece is not testing the path to it.
11. Collapse the THREE copies of the areas list (api, web, engine) into one source.

### FASE 19 — COMPLETED: an approval you can read {#fase-19--concluída-aprovação-que-se-lê}
12. Kill the generic fallback of `ApprovalCard`, which dumps
    `chave: JSON.stringify(valor)` — the likely cause of "hard to read".
    Every type gets a SENTENCE in pt-BR; a type without a sentence shows verb + "see
    details" and the raw payload is born COLLAPSED, never dumped.
13. Collapse in THREE places: Approvals, Insights and the card in the chat, with verb
    and sentence coming from ONE module.
14. Project constraint: the collapse does NOT introduce a new required prop in
    `ApprovalCard`. That is what keeps `SessionPage.tsx` untouched and removes the
    edge with FASE 20.

### FASE 20 — COMPLETED: the session gets an identity {#fase-20--concluída-a-sessão-ganha-identidade}
15. `sessions` gets `kind` and `name` in the SAME migration — two migrations
    on the same table collide in the journal and the snapshots.
16. Reconcile with the event-based derivation: `kind` classifies the creation
    INTENT, `execution.activated` keeps classifying execution STATE,
    and neither rewrites the other. `execution.activated` in a consultative session is an
    explicit error, not a silent conversion.
17. Rename preserving the hashtag; without a name, it degrades to the hashtag alone.
18. A back-to-dashboard button — today `SessionPage.tsx` imports neither `Link`
    nor `useNavigate`, and NO navigation leaves the screen. Destination revised in a
    later round: the button goes back to the session's PROJECT
    (`/projects/:projectId`), no longer to the root dashboard — a session is always
    born inside a project.

### FASE 21 — COMPLETED: the volume of events (RN-099/100) {#fase-21--concluída-o-volume-de-eventos-rn-099100}
19. `useSessionEvents` remains the CURRENT STATE (`latest`, four
    consumers: roster, tree, execution, Approvals). The HISTORY became
    `useSessionEventHistory`, only for Activities, with the `afterSeq` the
    endpoint already returned. No new route, no new parameter.
    The anchor is the TAIL, not the start of the session: the endpoint pages
    forward and there is no `beforeSeq`, but opening the feed on event #1 of a
    session with thousands delivers the wrong screen. So the first page is the
    same `latest` read (SAME `queryKey`, deduplicated) and each click goes down
    a fixed window backwards.
20. The bell orders `DESC` in SQL. The "read" cutoff did NOT change semantics, and
    that's why there's no ADR: a cutoff by `seq` marks a PREFIX and the drawer shows
    a SUFFIX, so "mark the 50 shown" is inexpressible without a per-event read
    table. What changed is the drawer no longer hiding what the advance
    swallows — total per project, `+ N older`, and the button saying how many
    it marks. The missing number comes from SUBTRACTION (`latestSeq` minus the cutoff),
    not from a request.
21. The RN-090/091 savings didn't regress: one request per cycle, and the
    first "load older" costs ZERO — the `latest` read brings 200
    and the window shows 100. An old page has `staleTime: Infinity` and no
    `refetchInterval`: a closed `seq` window over an immutable event doesn't change.

### FASE 22 — COMPLETED on 2026-08-09 (spend with two audiences) {#fase-22--concluída-em-2026-08-09-gasto-com-duas-audiências}
Delivered as the **Spend** tab (ADR 0063, RN-101).
22. The missing AGGREGATIONS came into a single method —
    `sumGroupedBy(dimensao, escopo)` with `model`, `project`, `actor`,
    `session` and `day`. `provider` is NOT one of its dimensions, and the absence is
    structural: breaking down by provider is breaking down by CREDENTIAL, and that is
    what keeps the member's view from gaining the axis by carelessness — there is no
    argument to pass.
23. No charting library: daily bars and a ranking in inline SVG. The daily
    series comes DENSE from the api (a day without spend comes in with zero), otherwise three
    calls in three weeks become three bars stuck together.
24. The collision was resolved by separating the QUESTIONS, not the filters. The
    per-CREDENTIAL report stays exclusive to the owner (RN-060) and gained
    alongside it the workspace breakdown by model/project/actor/day, also
    `owner`. The member's view is by ACTOR, in tokens and estimated cost,
    without provider and without credential — and the actor comes from the authenticated
    TOKEN, with no parameter where one could write another person's id. An agent doesn't count in the
    member's account: `token_usage` records who spent, not who ordered the
    spending.

No migration, but WITH measurement: at 525 thousand rows the queries take
55 ms and 38 ms by seq scan, and an index on `token_usage(created_at)` would
bring them to 32 ms and 19 ms. The number is in the ADR; the index comes in the wave that
has the slot.

### FASE 23 — COMPLETED on 2026-08-09 (model inheritable per area) {#fase-23--concluída-em-2026-08-09-modelo-herdável-por-área}
25. The `area` scope entered the cascade (`session > agent > area > project >
    workspace`), BETWEEN agent and project: it is the default that lead and subagents
    share, and the agent diverges by overriding it (ADR 0064, RN-102).
26. The incoherence resolved BEFORE coding: the agent binding was GLOBAL
    (`scope_id` = plain slug, the route's `:projectId` ignored since Fase 9a) and
    area is per project since ADR 0053. A per-project scope above a global
    scope would make the same agent resolve different models only where there was an
    area. Decision: the agent binding became per project too —
    the `scope_id` of `agent`/`area` became composite, `<projectId>:<slug|chave>`
    (RN-103) — and not the area below the agent, which would contradict "inheritable
    default" (almost every binding today is an agent's).
27. The UI shows who INHERITS and who DIVERGED (`AreaModelsSection` and the
    Origin column of `ModelsSection`, in `ProjectSettingsTab.tsx`); "go back to
    inheriting" is a `DELETE` on the agent/area binding, never writes into it the model
    of the level below — copying would become a copy that diverges on its own at the area's next
    change. The `maintainer` role to change the area's model (same
    rule as the parallelism ceiling, RN-083); the agent's stays `developer`.

### FASE 24 — COMPLETED: Chat and Criativo as places (RN-104) {#fase-24--concluída-chat-e-criativo-como-lugares-rn-104}
28. Two tabs on the PROJECT screen, each listing the sessions of its `kind` and
    creating in that `kind` without asking again. The Session remains its own
    screen — the tab did not become a chat container.
29. The collision was resolved with "Sessions" LEAVING the ruler. What remained of it is
    the deep-link KEY: Chat carries `key: 'sessions'`, and that is what makes an
    old `?tab=sessions` open on Chat with the tab MARKED. An alias resolved only
    in the panel would open the right panel and leave the ruler without a selection, because
    `Tabs` compares `active` with `key` and whoever writes `active` is
    `ProjectPage` — one of the two files the wave kept closed.
30. **Verdict on "Start ideation"**: it STAYS. Half the problem had already
    closed in FASE 20 (the button vanished from the consultative session, RN-097), and the other
    half wasn't redundancy: it is what brings the Criativo, and from there on
    the owner's key is spent (RN-058). What was wrong was the PLACE — the
    invitation spent a paragraph pointing at the topbar. Now the action lives
    INSIDE the invitation while it is on screen, and goes back to the topbar when it
    isn't; `conviteVisivel` is the only question the two share, so
    that it neither shows up twice nor disappears.

### FASE 25 — COMPLETED WITH A CUT: Container per project (the boundary stops being just policy) {#fase-25--concluída-com-corte-container-por-projeto-a-fronteira-deixa-de-ser-só-política}
The biggest architectural change of the program, and the one that pays the debt Phases B
and F already pointed at separately. Delivered 25a (the Arquiteto's decision and the
gate) and 25c (the external-effect boundary); 25b (the container's
lifecycle) was CUT and declared — not half-implemented (ADR 0065, RN-105
and RN-106).
30. COMPLETED: the ARQUITETO decides which image comes up for the project, as
    its artifact (`artifact.project_image` in the event log, versioned, without a
    table) — auditable, not hidden configuration. Until it
    decides, the Code tab answers 409 and doesn't unlock (RN-105).
31. NOT DELIVERED AT THE TIME, declared: per-project lifecycle (provision,
    recycle, clean, resource ceiling actually applied), with the agent's
    worktree living inside the container. Container state is MUTABLE and
    asked for its own table — improvising it in the event log just so as not to wait for the
    migration slot would produce the fix right after.
    PARTIALLY REVOKED by Wave 4/front F1 of PROGRAMA 28: the state
    TABLE (`project_containers`, ADR 0081) arrived. What is still missing,
    without softening, is the half that made the table worth anything: no
    real orchestrator calls Docker yet, and the agent's worktree remains outside
    the container. The "inside, the agent is free" half of the terminal policy
    has NOT CHANGED YET — ADR 0055 keeps holding as it is until the container
    actually comes up.
32. COMPLETED AT THE TIME, REVISED by the local runner (ADR 0102/0103, RN-418):
    the external-effect boundary. `git push`, PR and deploy don't go out through the
    terminal — not even inside the project scope —, and the rule WAS `deny`
    (not `require_approval`, because of "always allow"), with the
    message redirecting to the TYPED action (`git_push`/`git_merge`/
    `pr_open`), which is born a `proposed_action` (RN-106, revised). The `deny`
    became an ABSOLUTE CEILING (unconditional `require_approval`, never
    auto-approvable) — the product owner's decision, "always allow" closed
    at the source so it wouldn't become decorative (see the local runner section). Merge into a protected branch
    remains manual (RN-014), untouched. Network and spend have their own verdict in the
    image ARTIFACT (`network: none`/`egress`, a cpus/memory/pids ceiling
    that refuses instead of silently downgrading) — decided ONCE, not
    command by command, for the same reason Z and AD proved that a verb
    allowlist doesn't converge. Closing Z and AD itself depends on 25b (the
    physical wall), which hasn't come up yet.

### FASE 26 — COMPLETED: Code, read-only {#fase-26--concluída-code-só-leitura}
33. COMPLETED (26a): `GitProviderContract` gained `listTree` and PR diff
    (11th/12th operation), capability declared ONLY when proven by the suite.
34. COMPLETED (26b): the four routes of `code.controller.ts` — tree,
    file, search and diff — behind the CENTRALIZED check of RN-092/095, with
    a ceiling and cache on the search (which is COMPOSITE, not a contract operation).
35. COMPLETED: the screen (`ProjectCodeTab`/`code/*`), registered in
    `project-tabs.ts` without touching `router.tsx`/`ProjectPage.tsx`. Rail
    (Explorer/Search — the only ones with real data), explorer loaded by
    DIRECTORY, editor tabs with breadcrumb, real search with
    `filesScanned`/`truncated`, PR diff by known id (with
    `patch: null` treated as "no text", never "no change"). Syntax
    highlighting is its OWN regex tokenizer (`code/highlight.ts`) — ZERO
    new dependency, against the 15-90 KB of Prism/highlight.js/Shiki for
    what the tab needs; three new color tokens (`--syntax-function/
    -comment/-operator`) calibrated at 4.5:1 against `--code-bg` in BOTH
    themes. The fourth state of RN-088 — blocked by the Arquiteto's pending
    decision (RN-105) — became RN-107, asked BEFORE trying to read
    code, with its own re-query every 15s while blocked.

    Pending items DECLARED, with no real data behind them: interactive terminal
    (FASE 25b, which remains cut — an honest empty state in the tab), blame,
    list of PRs inside the tab (the diff is only reachable by known
    id, coming from Approvals) and a Problems/lint/tests panel.
    Line virtualization was also left out at the time — the handoff itself
    calls the code tab "the most costly of the program"; the 512 KB per
    file ceiling (`GIT_BLOB_MAX_BYTES`) limited the worst case until then. CLOSED
    by Wave 4/front E2 of PROGRAMA 28 (RN-239..242): only the visible window
    becomes a DOM node, and the minimap reuses the same tokenization without a second
    pass.

### FASE 26b — COMPLETED: blame foundation, navigable PRs and a rich branch {#fase-26b--concluída-fundação-de-blame-prs-navegáveis-e-branch-rica}
The phase started as ONLY the API layer, and the sentence "no UI" that stayed here
described the state of the FIRST batch — it aged and started teaching wrong. The
THREE UIs exist: the rich branch dropdown (item 38, `CodeBranchPicker.tsx`),
the on-demand blame toggle (`CodeEditor.tsx`, RN-113) and the list of PRs inside
the tab (`CodeDiffPanel.tsx`), the last two delivered in v3.0.0. The three
declared pending items of blame,
rich branch dropdown and PR list would touch the SAME files
(contract, the three providers, the use case, the controller, the contract
suite) if attacked separately by agents in parallel; the decision was to
deliver all three together, at once, and leave the UI of each to three
following agents with no risk of collision.
36. `GitProviderContract` gained `blame`, `listPullRequests` and
    `listBranchesDetailed` (13th, 14th and 15th operation — RN-110/111/112),
    capability declared only when proven by the contract suite against the
    three providers (`local` against real git; `github`/`gitlab`
    mocked — the real smokes remain skipped without
    `GITHUB_TEST_TOKEN`/`GITLAB_TEST_TOKEN` in the environment, same situation as
    FASE 13a). `listBranchesDetailed` is its OWN operation, not an extension of
    `listBranches` (RN-112) — enriching costs an extra call to the provider
    PER BRANCH, and `listBranches` remains the Gitflow bootstrap's,
    which doesn't pay that cost.
37. Three new routes in `code.controller.ts` (`GET .../code/blame`,
    `GET .../code/pull-requests`, `GET .../code/branches`), same `role:
    viewer` and the same central path check (RN-095) as the four
    earlier ones. `apps/web/src/lib/api-client.ts`/`api-types.ts` gained the
    corresponding functions and types (`getCodeBlame`, `getCodePullRequests`,
    `getCodeBranches`) for the next wave to consume — `CodeShell.tsx` and
    `CodeDiffPanel.tsx` were NOT touched beyond the comment documenting
    that the foundation already exists.
38. COMPLETED: the rich branch dropdown (RN-112) — `CodeBranchPicker.tsx`,
    opened from `CodeShell.tsx`, replaces the plain text field with a
    selector listing each branch with `ahead`/`behind` relative to the default and the
    associated PR, when there is one (`aberta`/`mesclada`/`fechada`). A ref outside the
    list (tag or sha) remains reachable — `listBranchesDetailed` doesn't
    enumerate those two, so the dropdown's footer has a manual field.

**The program's freeze:** each phase declares what it doesn't do, and the hardest is
26's — code READ-ONLY, no saving through the tab. Editing is the next
phase, and when it comes, writing is an external effect: it is born a `proposed_action`.

## POST-PROGRAMA 16–26 — what use asked for afterwards (RN-148) {#pós-programa-1626--o-que-o-uso-pediu-depois-rn-148}
Same spirit as POST-FASE 15: not a planned phase, it is what USE asked for.
Stories with pending promotion at the same time (RN-048/RN-126) became N
loose cards in the PO session's timeline when it produced several in one
batch. `Carousel` (`apps/web/src/components/ui/Carousel.tsx`) is the design system's first
item-by-item navigation component — 2+ pending
become ONE navigable carousel (arrows, dots, keyboard), with "Approve all"
promoting the whole batch in a single call (`promoteStories` was already a batch,
no contract change); 1 pending remains the usual simple card. The
decision of when a "batch" forms is re-evaluated on each render — the
set of promotions STILL PENDING in the session, not "created in sequence
without interruption" — so that resolving a story in the middle of the carousel
recomputes the batch on its own, with no state of its own to synchronize.

**Local or Container project (RN-169/RN-170, ADR 0072).** The product
owner's request: "cross the boundary of only writing code in the container and be able to
write code from a user folder", with the **freely typed path**
variant chosen by him, aware that it only works mounted in the
container. `projects` gets (`workspace_mode`, `workspace_path`) in migration
`0043`, with `container` as the default — nothing changes for whoever doesn't choose. ADR
0072 REVISES part of 0065 and touches the ground of 0055, which decided the
opposite direction (the container wall), and so the consequence is written without
softening: the STRUCTURAL containment of `join(env, coluna)` — no
corrupted column leaving the managed root — ceases to exist for a Local project, and
what remains is the creation guard plus the lexical revalidation on read. 
FASE 25b remains cut: a Local project runs in the SAME container as today, only
the folder changed.

**The Arquiteto's C4 diagram (RN-149, ADR 0068).** New deliverable:
`create_c4_diagram` generates Context + Container (Simon Brown) in Mermaid,
rendered in the Overview. The Container level is DERIVED from the current
`module_map` by the use case — never retyped by the model — so as not to open
a second source that diverges from the first; only the Context (system name and
external actors) comes from the tool call. `artifact.c4_diagram` is an artifact without a
table, versioned in the event log, same design as `artifact.project_image`
(ADR 0065). `mermaid` came in as a new RUNTIME dependency of
`apps/web` — the first of its kind (the docs site already uses Mermaid, but at
build time) — isolated behind `apps/web/src/lib/mermaid-render.ts` with dynamic
`import()`; `vite build` confirmed that only the entrypoint loads
eagerly and Mermaid's heavy chunks stay on demand, and none of them uses
`eval`/`new Function` — the closed CSP of ADR 0058 stayed intact, with no
configuration change.

## RODADA exp003 — COMPLETED (RN-150..162, PRs #278–#293) {#rodada-exp003--concluída-rn-150162-prs-278293}
Not a phase: it is 17 points USE found in a live test session
on the `exp003` project, fixed in five waves sequenced by
CONTESTED FILE — four of them converging on `SessionPage.tsx`, which
forced serialization. The origin matters: none of these was found by a test.

**What the round taught, worth more than the list**: the biggest fix
(RN-155) was invisible to any suite because the defect was in comparing
two DIFFERENT numeric spaces that happen to both be `number` — the
`event.seq` (gapless, per SESSION) against the `action.seq`
(`proposed_actions.seq`, a global `bigserial` of the WHOLE table, shared
by every project and every session in the system, and documented in the schema as a
deliberate contrast). The order only seemed right while the table was
small. The fix didn't invent a field: it used the
`proposed_action.created` event that `ProposeActionUseCase` already writes in the SAME
transaction, with `payload.actionId` pointing back.

**Engine and contained reading (RN-150)** — `search_workspace` returned ALL
the hits, without a ceiling: the second real cause of the `413` in PR review, after
the `read_file` fix. Two INDEPENDENT ceilings, because the search
blows up in two ways — number of hits (`SEARCH_WORKSPACE_MAX_HITS`,
500, over a `Stream` that STOPS scanning at `max_hits + 1`) and bytes of the
final text (`SEARCH_WORKSPACE_MAX_BYTES`, 32,768). Their own variables, not
reused from the other two: same class of overflow, diverging one shouldn't
require touching the others. The truncation mark is addressed to the MODEL
(it tells it to refine the term) and never invents a total, because counting the total
would pay again the I/O the ceiling exists to avoid.

**Numbers that lie (RN-151)** — the project badge in the sidebar counted
ANY unread event: `exp003` showed 392 while the Approvals tab
of the same project showed 8. A number that doesn't correspond to anything actionable
when clicked is worse than none. It became `pendingApprovalsCount` in the read model
that already existed (RN-090), in one more aggregation in the `Promise.all` — never
N+1.

**Traceability of what the agent produced (RN-152)** — the
`feature/task-XXXXXXXX` branch in the Code tab's dropdown now says which dev
agent and module it belongs to. The module comes from the current `module_map` through the SAME
functions that generated it, never by reverse regex on the name; without a link,
it degrades to `null` instead of guessing.

**Auto mode (RN-153/154, see Conventions)** — the `actionType: "*"` wildcard.
What matters is where it lives: resolution is the REPOSITORY's (`findMode`),
and `decide.ts` didn't gain a line — that is what makes the three absolute
ceilings true by CONSTRUCTION, and not by one more `if` that one day
someone forgets.

**The session thread you can read (RN-155..159)** — ordering (above); the
5s indicator with the fixed text "Gathering information..." instead of
interpolating the agent, which already appears in the header (RN-156); the PO's
epic/story creation becoming a compact notice instead of a bubble with the same
visual weight as a real reply (RN-157); light Markdown with highlighting
in the chat by its OWN regex parser, zero new dependency and no
`dangerouslySetInnerHTML`, and only the agent's OUTPUT is rendered — what the
human types stays literal (RN-158); and "Generated artifacts" grouped by
agent with the `Disclosure` of RN-138, each artifact navigating to where it
lives (RN-159). The module_map/C4 stayed OUT by recorded decision: it is the project's
CURRENT state, not a session-dated artifact.

**Order of authority (RN-160/161, ADR 0069)** — "Confirm architecture
ready" only enables with at least 1 PROMOTED story (having a captured rule
isn't enough); and accepting the handoff to the Dev Lead chains the activation of
execution when the effective role of whoever accepts already authorizes it. The fusion is only on the
client: the backend still requires `maintainer` (RN-137), so it avoids
a redundant click without moving the authorization boundary.

**Structured input (RN-162)** — `ask_structured_questions`, the Criativo's:
the model declares the questions in a schema, the form is rendered by
`StructuredQuestionCard`, and the answer REUSES `SendAgentMessageUseCase` instead
of opening a second message path. Answering is a single act —
resending is 409, not an overwrite.

## RODADA exp001 — the Criativo keeps its promise (RN-163) {#rodada-exp001--o-criativo-cumpre-a-promessa-rn-163}
Same spirit as the other rounds: it came from USE, not from a script. The report was
"the Criativo didn't reply after saying it would fix it and try again",
and the sentence was literal in the code — `run_turn_capturing/1` called the model ONCE,
dispatched the tools and returned. The tool's result went into the
in-memory history and nobody read it again, so the promised fix only
happened if the user sent another message.

The Criativo was the only conversational one without a tool-use loop; it got the same as the
PO, with its own ceiling of 12. What matters beyond the fix: **whoever decides what is
announced became the ceiling**, and not a fixed text — the retry promise
only enters the sentence when there is still a round to keep it. An exhausted ceiling became
a narrated `agent.error` (`po_server` ended silently in that case, and that was the
next obvious debt — closed just below by RN-166), and the tool
failure stopped being an `agent.response`
— in the event log it was indistinguishable from a normal reply and stated no
origin at all, exactly what RN-059 closed for turn failure.

## RODADA exp001 — the PO reads what already exists and is held to account (RN-164..166) {#rodada-exp001--o-po-lê-o-que-já-existe-e-é-cobrado-rn-164166}
Not a phase: it is a defect found by real USE, and the origin matters because
no suite would catch it. The backlog came out with an epic and **no story** — hence
no task, hence execution stuck **with no error at all**. The investigation found
four stacked causes, and the first three are the same: the PO had no way to
know and no way to warn.

1. **The PO had four tools, all of them WRITE tools.** The context was
   built ONCE, at kickoff, from the last 200 events of the SESSION —
   from then on it never re-read anything: it didn't know which rules existed,
   which it had already covered, nor what it had itself already created. In came
   `listar_regras_de_negocio` and `listar_backlog` (RN-164), served by two
   internal routes scoped to the PROJECT — and the scope is the point: reading per
   session was exactly what hid the rule captured earlier. They reuse the
   plumbing that already existed (`listByTypeForProject`, `ListBacklogUseCase`,
   `computeCoverage`); what was missing was the route, the client method and the tool.
2. **Nothing demanded the story after the epic** and **the loop ended silently**.
   An epic without a story became an EXPLICIT outcome — `backlog.epic_without_story`,
   durable, in the pattern of RN-059 (RN-165) — and the `PoServer`'s iteration ceiling
   started emitting `toolloop.limit_reached`, the SAME type as the `ToolLoop`, which
   the conversational agents never emitted because they have their own loop (RN-166).
3. **The kickoff instruction didn't say a word about what to do when
   information is missing** — and faced with a gap without instruction a model chooses
   between inventing and stopping. Stopping is what it did. The third way out came to
   be written, with the tool to exercise it: `ask_structured_questions`,
   the SAME one as the Criativo's (RN-162), now advertised to the PO too.

Two design decisions that hold beyond this case: only a `create_story` that
**succeeded** discharges the epic's obligation (a story refused by the api
covered nothing, and treating it as if it had is trading one silence for another); and the
demand is per OCCURRENCE, reported once, never an alarm that repeats every
turn until someone learns to ignore it.

## RODADA exp001 — the thread reads as the turn happens (RN-172/173) {#rodada-exp001--o-fio-se-lê-como-o-turno-acontece-rn-172173}
Same origin as the others: USE, not a script. Four complaints about the
Session screen — the PO's handoff appearing ABOVE its last line, the approval
going up into the middle of the Arquiteto's reply and only coming down when it
finished, the approval card "badly laid out" and the scroll that didn't follow the
conversation.

**The investigation found that the ordering was RIGHT**, and that is the round's
lesson. RN-155 is faithful to the event log; what the log says is that
`po_server.ex#run_turn/2` emits, in the SAME iteration, the `agent.response`, THEN
the `offer_handoff` `tool.call` and ONLY THEN recurses into the closing line
— so the handoff's `seq` is honestly SMALLER than the last line's. The same
for `proposed_action.created`. The fix, therefore, isn't about ordering: it is
a declared PRESENTATION rule (RN-172), in a separate pass
(`afundarDesfechos`) AFTER the `sort` by `seq` — not a comparator with three
terms nobody would be able to justify a year later.

What keeps turns from mixing are three barriers, and each one exists
because of a real case: **turn** (the boundary between two turns may have no
VISIBLE entry — `agent.activated` opens a turn and doesn't become a thread item),
**author** (in an execution session several agents write without the user speaking
even once, and they all stay in the same turn) and **non-outcome** (two outcomes
in a row preserve the order between them — Infra before the Dev Lead).

RN-173 closes the other two complaints, and they were the same: the scroll
effect depended only on `[events.length, streamingText]`, and `actions` is a
SEPARATE query — a card arriving pushed the conversation off screen without
scrolling anything. Dependency fixed, plus a `ResizeObserver` on the content
for what NO dependency list reaches (`Disclosure` collapse,
Markdown reflowing). The guard of 120px from the end stays intact, on
purpose: the thread follows the conversation, it doesn't hijack the reading of whoever scrolled up.

## RODADA exp001 — the thread says who speaks, with which model and what it asks (RN-171/174/175/176) {#rodada-exp001--o-fio-diz-quem-fala-com-qual-modelo-e-o-que-pergunta-rn-171174175176}
Same origin: USE. Four complaints about the Session screen, and three of them
share the same lesson — **the product knew the information and didn't
show it**.

**The question at the center, and with a way out (RN-171).** The report was literal: "always
give the user the input option when they select Write". The model
offered a "Write it yourself" kind of option and the form had nowhere to
write — the `ask_structured_questions` schema couldn't express "besides
these, whatever you want". `allowOther` came into `select` with **default
`true`**, and the asymmetry is the argument: a list closed by FORGETFULNESS locks the
conversation and the user can't unlock it from outside; a list opened by mistake offers one
more field. The interface sentinel never travels to the backend, and the submit
button still requires everything filled in (the backend refuses with 400 either
way). The box also became centered with the 560px ceiling of
`ApprovalCard` and got an avatar: it was the only thread item aligned to nothing.

**An action that triggers a turn arms the indicator (RN-174).** The "thinking" animation
already existed — what was missing was COVERAGE. Two actions on the screen trigger a
synchronous turn in the engine and armed nothing: answering the form
(`AnswerStructuredQuestionUseCase` reuses `SendAgentMessageUseCase`) and returning a
story to the PO (`ReturnStoryUseCase` calls `reviseStory`, which is
`handle_call({:revise, …})`). The Phoenix channel doesn't cover the hole: with the join
still in progress (RN-108) the "working" `agent.status` has no listener and gets lost.

**The model, for EVERYONE (RN-175).** The premise that the defect was the PO's didn't
hold: the four conversational ones have written `modelName` since RN-146, with a
green test. Whoever never wrote it was the **`ToolLoop`** — the path of every execution
and gate agent — and the chat without an active agent in the api. No new
call: `RunLlmTurnUseCase` already returned the field in the body. The screen stopped
writing the loose word "model" (which reads as if the model were called
that) and became a readable chip; without the data, it SAYS it wasn't recorded —
guessing from the current binding would attribute to an old reply a model that
maybe didn't even exist, the same error RN-044's frozen price avoids.

**A Markdown table becomes a table (RN-176).** Two ways out were possible, and the
chosen one was to support tables in the chat's Markdown, with the design
system's `Table`. Rendering `artifact.module_map` in the thread was REFUSED by a decision
already recorded: it is the project's CURRENT state, not a session-dated
artifact (RN-159), and it lives in the Overview. Besides, the request was about the
table **inside the message** — and the fix serves any agent that
writes one, not just the Module Map. The separator line remains
mandatory (GFM), so prose with `|` never becomes a table by mistake.

## RODADA exp001 — the panel groups, orders and says what it doesn't show (RN-177..181) {#rodada-exp001--o-painel-agrupa-ordena-e-diz-o-que-não-mostra-rn-177181}
Same origin as the others: USE, not a script. Five complaints about the
context panel and the Session log, and the round's lesson is a single one — **the panel showed
a slice as if it were the whole, in three different dimensions at once**:
it hid six event types without offering an alternative, read from oldest to
newest, and cut the session at 200 events without saying so.

**Origin as a new classification (RN-177).** `ActivityKind` answers "what
SUBJECT the event is about" and decides icon and color; `origem` answers "what LAYER
it came from", and it is what makes the history readable — `eventos`, `sistema`, `llm`,
`harness`, `agente`, `usuario`, derived from the data that EXISTS (`actor.kind` and the
`type` prefix). The precedence is what makes it predictable and is in the order
of the `if`s: mechanism beats actor (a `tool.call` belongs to the harness whoever it is), and
actor beats agent prefix (`chat.message` exists on both sides). The 5 most
recent stay open and the rest collapse by origin, **in both places** —
in the log panel and in the thread, where the axis is inverted (the thread is ascending, so the
history stays at the TOP). The machine-noise filter **stays on by
default**: its reason didn't change (116 of 193 real events), what changed is that it
became a CHOICE instead of a done deal.

**Order and pagination (RN-178).** The four sections became descending, and the
"Load older" button switched sides as a consequence — the argument from
before, with the sign flipped. Business rules above 5 paginate, with the page
resolved by *clamp* and not by a synchronization effect.

**The PO's tree (RN-179).** `backlog.task_created` never entered the panel;
now epic → story → task form a tree, through the LINK the event already
carries (`epicId`/`storyId`), never by proximity in the log — a node without a loaded
parent goes up to the root instead of being hung by guesswork.

**The ceiling that started showing (RN-180), and it is the item worth most.** The panel
read 200 events by prop and had no way to say there were more. It started reading the
paginated history of RN-099 (same `queryKey` as the tail, ZERO extra requests
— RN-090/091), got the pager `ActivityFeed` always had and no call
site passed, and the note counts how many are missing by SUBTRACTION on the `seq`, like
the bell of RN-100. The derived sections read `baixados` (everything already fetched) and not the
feed's window, otherwise they would start showing LESS than they showed before.

**Delegation in the thread (RN-181).** `delegation.completed|failed|dispensed` only
existed in the log panel: the gate opened and closed with no sign at all that there was
a second attempt underneath. They became a compact notice in the RN-157 format,
with the sentence coming from `classifyEvent` — the same as the panel's. The area's external
contract doesn't change (ADR 0038): the thread narrates what the lead recorded, it doesn't start
addressing a subagent.

## PROGRAMA 28 — Wave 1, front A: the theme stops being unreachable (RN-182..185) {#programa-28--onda-1-frente-a-o-tema-deixa-de-ser-inalcançável-rn-182185}
The light theme existed in `design/tokens.css`, had a parity test and was
described in `design/README.md` as if it were a screen — and **nothing in `apps/web`
wrote `data-theme`**. The only way to see it was to type the attribute in
DevTools. The two contrast tests knew and said so: one asserted by `expect`
that THREE light pairs fail, "a record of what is inherited, not a guarantee of what
is rendered". While it lasted, the argument was honest — measuring a screen
nobody can open is measuring an intention. With the theme button arriving, it
flips sign.

**The boot is a FILE** (`apps/web/public/theme-boot.js`), synchronous in `<head>`,
before the bundle. The handoff says to use an INLINE script; the image serves under
`script-src 'self'` (ADR 0058), so inline would work in `pnpm dev:web` and
be blocked in production — ADR 0036's failure with another subject. `tema.ts`
is the API the shell consumes; the button doesn't live in it. A `localStorage` that throws
degrades to "paints and doesn't persist", and an unknown value falls to the default.

**Six light-theme tokens changed value** (ADR 0074), because the light theme's most
demanding background is the paper `--code-bg`: accent 3.56 → 4.81, warning
3.15 → 4.98, success 3.89 → 5.12, violet 4.16 → 4.95, text-muted 2.76 → 5.17,
plus accent-hover one step below. The DARK didn't change any, and its debt
stays locked at the same five numbers. Two side effects recorded: the
five pairs that are debt in the dark PASS in the light, and the "known exception of the
design system" (`--on-accent` over `--accent`, 3.20:1) disappears in the light — the
fix the test's comment described, darkening down to `--terracota-500`, is
what the light theme now does.

**Five of the handoff's eight `--syn-*` values were REFUSED by measurement** (the
worst, `--syn-cm`, gives 2.32:1 in the light). Where the handoff fails, the measured
number holds: it's the same rule as the fonts. The eight roles now exist with the prefix
`--syntax-*`; the five semantic ones that still paint are measured alongside them.

## PROGRAMA 28 — Wave 1, front D0: spend by provider (RN-186..188) {#programa-28--onda-1-frente-d0-gasto-por-provider-rn-186188}
**The containment changed nature, and that is what matters — not the new axis.**
`provider` became a dimension of `sumGroupedBy` again, revising ADR 0063 by
the product owner's decision. Before, the member couldn't reach the breakdown by
CREDENTIAL because it didn't exist — ADR 0063 wrote "there is no argument to
pass". Now it exists, and whoever contains it is the TYPE: two overloads, and the scope that
carries `actor` (the only one of the member's view) only accepts
`Exclude<SpendDimension, 'provider'>`. The guarantee went from "impossible to
express" to "impossible to compile", which is weaker — and that is why the
barriers are TWO and independent: the member's route also has no dimension
parameter at all. No `if` on the combination, on purpose (same lesson as
RN-153/154), and the proof was by INVERSION: without the `@ts-expect-error`, `tsc` flags
`TS2769` on the exact line.

`porOwner`/`porAgente` are a partition of `porAtor` by `actor_kind`, with no extra
query; `system` stays out of both and remains in the total. The index on
`token_usage(created_at)` that ADR 0063 measured and postponed came in in migration `0044`.
The SCREEN didn't change — that's a later wave.

## PROGRAMA 28 — Wave 2, front H2: model ranking without an invented score (RN-210, ADR 0077) {#programa-28--onda-2-frente-h2-ranking-de-modelos-sem-nota-inventada-rn-210-adr-0077}
The handoff asked for two things that depended on the SAME data the product doesn't
have: a quality score per capability (mock: "code → claude-sonnet-4 /
qwen2.5-coder:14b (9.4)") and an "ideal" badge in `ModelPicker` when the
model covers "all the capabilities required by the agent". The investigation
confirmed twice that this second data doesn't exist: `ModelsSection` itself
had already renamed the "Agent · capabilities" column to just
"Agent" for that reason, and the agent-binding `ModelPicker` reads
`GET /projects/:id/models` (role `viewer`) — the curation (`uses`, ADR 0051)
only exists in `ModelComCuradoria`, from a `maintainer`-only route. The badge was NOT
built; the "Best models per capability" table WAS, with two
real signals: how many of the project's agents already resolve, through the cascade, to
each curated model, and the catalog cost as a tiebreaker — never a
calculated score.
## PROGRAMA 28 — Wave 2, front B: the sidebar collapses (RN-195..201) {#programa-28--onda-2-frente-b-sidebar-recolhe-rn-195201}
264px/62px with an icon track when collapsed; expandable projects revealing the
tabs (read from `project-tabs.ts`, never hardcoded); the Activities section grouped
by REAL base agent/instance — the `-2` suffix of `extraDevAgentId`, never an
invented `-01/-02` counter (finding of Wave 1/front B0) —, scoped to the
current route's project, not all of them, so as not to open N+1 event reads. Theme button
in the footer; the two inert global items go, only Projects and Activities
are global; auto-collapse of the Code tab via `AutoCollapseContext`
(`sidebar-state.ts`), without saving a preference. Persistence centralized in
`sidebar-state.ts`, the handoff's six `brabo.*` keys.

Two divergences from the handoff documented and NOT resolved (RN-197): the project
badge remains `pendingApprovalsCount` (RN-151 wins, it's more recent) and the
handoff's identity color only appears on the collapsed track — the expanded
line keeps only the existing status dot (RN-039), two dots would be noise.
## PROGRAMA 28 — Wave 2, front C: screen frame (RN-202/203, ADR 0078) {#programa-28--onda-2-frente-c-moldura-de-tela-rn-202203-adr-0078}
The four literal fixes of the handoff's "screen frame" checklist:
`.headerTop` got `min-height: var(--header-h)` — a FLOOR, not a ceiling, because the
project header (identity + compact `TokenMeter`) is richer than the
generic header of the handoff's 6 internal screens, and forcing 60px would cut the
budget alert, the same class of error RN-088 forbids; the active tab with
`box-shadow: inset 0 -2px 0 var(--accent)` instead of `border-bottom`; horizontal
scrolling on the ruler; a content container with `max-width: 1040px` on the
document-shaped tabs (not on the `semRespiro` ones). The ruler's spacing values
that lived as a descendant CSS override in `ProjectPage.module.css`
since FASE 16 migrated to `Tabs.module.css`, now with the same owner.

The part that required a decision, not just CSS: the handoff lists 7 project tabs and the
registry (`project-tabs.ts`) has 10. `executores` (RN-121), `backlog`
(RN-048) and `insights` (Psicólogo hypotheses) were born AFTER the handoff, with
real data and their own RN, and they STAY — the handoff is a VISUAL fidelity reference,
not a ceiling on how many tabs the product has (RN-203, ADR 0078). And the
`sessions` key remains labeled "Chat", never "Chat RAG" as the handoff's most
recent version asks (RN-202): "Chat RAG" would describe a feature that doesn't
exist — the embeddings contract is ready (ADR 0075) but nothing consumes it yet,
with no indexing pipeline and no citation UI — and renaming the tab
today would be the same error ADR 0042 already refuses for a catalog model:
announcing a capability before it exists. No export SHAPE changed
(`AbaDoProjeto`, `ABAS_DO_PROJETO`); only the `code` label went from "Code" to
"Código".

## PROGRAMA 28 — Wave 2, front H1: visible focus (ADR 0036) {#programa-28--onda-2-frente-h1-foco-visível-adr-0036}
`Select`, `Modal` (close button) and `ProjectCard` got `:focus-visible`
with the same calibrated treatment as `Input.module.css`, including the
`forced-colors` block: none of the three had a focus indication reachable by
keyboard alone. The `Modal` close button went up from 30px to 32px, the desktop
touch-target floor. `Table` and `Badge` were audited and did NOT need
change — neither exposes an interactive affordance of its own: a
`Table` row is pure presentation (whoever needs a clickable row already uses
`<button>`/`<a>` inside the cell, via `render`) and `Badge` is not used with
`onClick` anywhere in the product.

## PROGRAMA 28 — Wave 3, front H3: the Criativo tab gets KPIs without faking data that doesn't exist (RN-227..230) {#programa-28--onda-3-frente-h3-a-aba-criativo-ganha-kpis-sem-fingir-dado-que-não-existe-rn-227230}
The handoff asks for 4 status seals for the session's 5 real states
(`created/active/closing/closed/closed_abnormally`). `closed_abnormally`→
aborted and `created`→waiting are direct; `closing` was NOT merged with
"closed" — it gets its own seal ("closing", `accent` tone, pulsing),
because in `closing` the outcome isn't known yet and calling it "closed" would
lie about that. The pill filters (only 4, for the same reason) group
`created` and `closing` by TRAJECTORY, not appearance: `created` falls in
"Active" (still in play), `closing` falls in "Closed" (on the way to closing
without error) — the row's seal is never rewritten by the filter, only the grouping
changes. Of the 4 KPIs, two are honest about missing data: "cost this month"
REUSES `getMySpend` (same `queryKey` as the Spend tab, the
member's view/RN-101) and never shows the project total — which is the owner's data
(`porProjeto`), and the Criativo tab is seen by any member; "ideation
→ commit rate" is DECLARED absent (shows "—"), because there is no link between
session and commit in the product today — inventing the calculation would be the same class
of error ADR 0042 already refuses for a model score.

## PROGRAMA 28 — Wave 4, front G2: the RAG Chat gets an indexing pipeline and hybrid search (RN-231..238, ADR 0080) {#programa-28--onda-4-frente-g2-o-chat-rag-ganha-pipeline-de-indexação-e-busca-híbrida-rn-231238-adr-0080}
On top of the `chunks` table from Wave 3 (ADR 0079): MANUAL indexing (no
watcher, `POST .../rag/reindex`, idempotent full rebuild — deletes the
scope/session before recreating) of the three honest scopes — `docs`/`adr`
via `ReadProjectCodeUseCase` (same credential/gate/path check
as the Code tab) and `session` only from `chat.message`/`agent.response`. Chunking
by heading/paragraph, 1200 characters with 150 of overlap —
documented as a starting point, not a calibration against real data (there
isn't, yet, a body of questions run against the index). Hybrid search
is TWO independent queries (vector via HNSW, lexical via GIN),
fused by a weighted sum (0.6/0.4) and cut at a threshold (0.2) —
numbers that are also a starting point. When the embedding provider (fixed:
`ollama`) doesn't answer, the pipeline writes the chunks WITHOUT a vector and declares the
gap in the report — it never fakes complete indexing, and the search degrades
to lexical-only with a warning. The screen (RAG Chat as its own tab) belongs to Wave
5; this front is just the backend.

## PROGRAMA 28 — Wave 4, front F1: the container lifecycle becomes a table, without an orchestrator (RN-243..248, ADR 0081) {#programa-28--onda-4-frente-f1-ciclo-de-vida-do-container-vira-tabela-sem-orquestrador-rn-243248-adr-0081}
See item 31 of FASE 25 (PARTIALLY REVOKED): `project_containers`
(migration `0046`) writes the mutable STATE — `provisioning → running ⇄
stopped`, `failed` reachable from all three, `removed` only leaves by reprovisioning
— distinct from `artifact.project_image` (the Arquiteto's immutable
DECISION). Confirmed by investigation (grep, zero occurrences):
NO service of the product mounts `/var/run/docker.sock` nor runs
`privileged` — both use cases only WRITE and READ, no real call
to Docker. The first transition requires the image already decided (RN-105)
and FREEZES version/resources in the row; a `local` project (ADR 0072) is
refused, because it doesn't bring up its own container. The resource ceiling
(`cpus`/`memory_mb`/`pids_limit`) is DECLARED, not applied — no
screen asserts "the container is limited to X", only "the recorded intention
was X". No new HTTP route at the time: without a real consumer yet, exposing
one would be guessing a contract — closed by Wave 5/front F2 just below.

## PROGRAMA 28 — Wave 5, front G3: the RAG Chat gets its own tab (RN-252..254, ADR 0082) {#programa-28--onda-5-frente-g3-o-chat-rag-ganha-aba-própria-rn-252254-adr-0082}
The screen that RN-202 (Wave 2/C) had postponed — "Chat RAG" would describe a
capability that didn't exist yet — arrives together with the backend of Wave
4/G2: `key: 'rag'`, a NEW tab (`ordem: 28`, between Code and Backlog),
NEVER renaming `sessions`. The distinction stays the same, only the reason
changed: `sessions` is a conversation with an ACTIVATED agent (spends the owner's key
per turn, RN-058); `rag` is a search over an already built index, with no
agent at all in between, read-only by nature. The screen consumes the three
contracts of ADR 0080 without guessing shape and shows the two honest
degradations the backend already declared and no screen read — `vectorAvailable:
false` becomes a visible warning, and the coverage never invents "reindexed
Xmin ago". A citation with `session` origin navigates to the exact EVENT, reusing the
mechanism the Psicólogo's evidence chips already use; `file` origin
shows path/heading as text, without a link — the Code tab has no
deep link by path today, out of scope here.

## PROGRAMA 28 — Wave 5, front F2: the real consumer of the container lifecycle (not the terminal) (RN-267/268, ADR 0083) {#programa-28--onda-5-frente-f2-o-consumidor-real-do-ciclo-de-vida-do-container-não-o-terminal-rn-267268-adr-0083}
The original plan for this front was the complete interactive terminal. The
investigation confirmed that FASE 25b remains cut: no service
mounts `/var/run/docker.sock`, and even after ADR 0081 nothing in
production transitions `project_containers` — there is no real container
to open a terminal INSIDE it. Implementing a faked terminal, or one
running in the same container as Brabo's monorepo (the debt ADR 0055
already describes as policy, not isolation), would invent capability — the
same error ADRs 0041/0042 refuse for an LLM provider and a catalog
model. The real delivery: `GET /projects/:projectId/container/lifecycle`
(role:viewer), the first HTTP exposure of the lifecycle (revises ADR
0081, which had postponed the route for lack of a consumer), and the Terminal tab
showing that state — translated badge, failure reason — UNDER the
explanatory text that already existed, never in its place, fetched only while the
tab is open. `null` (never provisioned) is the honest and
most common result today.

## PROGRAMA 28 — Wave 5, front I: social login revokes the prohibition from the ADR 0031 backlog (RN-272..283, ADR 0084) {#programa-28--onda-5-frente-i-login-social-revoga-a-proibição-do-backlog-do-adr-0031-rn-272283-adr-0084}
Explicit request from the product owner, aware of the security
consequences — the prohibition goes away only for GitHub/GitLab; MFA, OIDC provider and
generic federation remain out of scope (see "What NOT to do").
`SocialLoginCallbackUseCase` ends in the SAME `EmitirSessaoUseCase` as the
password login — no second session format. It reuses the existing OAuth
client, but the `state` has its OWN purpose
(`purpose: 'social_login'`, checked BEFORE any other field):
it never accepts the `state` of the git CONNECTION flow to a project, which
would be privilege escalation. New table `social_identities` (migration
`0047`), key `(provider, provider_user_id)` — never email/login.
A three-step decision: known identity → login; email matches an
existing account AND verified by the provider → links (and verifies the
account's email if it wasn't yet); email matches but NOT verified →
refuses — a typed email isn't proof of ownership, accepting it would open
account takeover; no matching account → provisions a new account without
a password, same "pending" state as the Keycloak migration. It reuses the SAME
OAuth app as the git connection — zero new environment variables, only
different `redirect_uri`/`scope` per flow; the OPERATOR's action of
registering the second callback in the provider is what justifies the
`breaking/` branch.

## fluxo.yml × code audit — the Dev Lead's plan becomes a real approval (RN-284, ADR 0086) {#auditoria-fluxoyml--código--o-plano-do-dev-lead-vira-aprovação-de-verdade-rn-284-adr-0086}
Not a planned phase: it closes the divergence a read-only audit of
`docs/fluxo.yml` × code found (finding A2,
`docs/explanation/auditoria-fluxo-vs-codigo.md`) — the flow already declared the
`dev-lead`'s `plano-de-paralelismo` output as `via: proposed_action`
since ADR 0085, and the code was never adjusted to match. The product
owner decided the code was wrong.

`propose_execution_plan` entered `decide.ts` (minimum role
`maintainer`), DELIBERATELY outside the absolute ceilings block — it can be
configured to auto-approve, unlike
`parallelize`/`raise_max_parallel`. The Dev Lead is the FIRST conversational
agent (they all run a synchronous turn via `GenServer.call` of up to
180s) to suspend waiting for a human decision — the pattern already existed for
the dev agent (ADR 0052) and the QA/Infra gates (ADR 0057), but those two are
triggered by `cast` and never had to deal with a pending synchronous `from`.
`TurnoAssincrono.tratar_resultado/2` gained a branch: when the
`:aguardando_aprovacao` key is present (checked by VALUE, not by presence —
the Dev Lead carries it as `nil` since `init/1`), it replies to `from` the same
way and at the same time as always, but emits only `agent.status:
awaiting_approval` instead of `agent.done` — the turn hasn't ended.
`LiveBroadcast.agent_status/4` got the new status in its guard. The resumption
uses the SAME `Engine.Dev.Wake` that `QaLeadServer` already reuses for the
QA subagents (delivery is per AGENT, not per type).

**Accepted gap, declared**: without its own state table, an engine restart
while the Dev Lead is suspended loses the subscription — the decision
remains recorded and visible in Approvals, but it doesn't narrate the outcome
on its own. Closing this would require the same persistence mechanism as ADR
0052; out of scope for this fix, which only aligns the behavior with what
`docs/fluxo.yml` already declared.

## UX Designer — the fifth conversational agent, brought forward (RN-285..287, ADR 0087) {#ux-designer--o-quinto-agente-conversacional-antecipado-rn-285287-adr-0087}
It's not a triggered separation trigger — `docs/fluxo.yml` always declared
"when the MANAGED project has its own interface to design" as the
criterion, and it didn't fire: the design system remains static input.
A CONSCIOUS decision by the product owner to bring the role forward anyway.

`Engine.Agents.UxDesignerServer` mirrors `DevLeadServer` — a GenServer per
session, ceiling of 14 iterations, activated by an `accepted` handoff addressed to
"ux-designer" through the already existing GENERIC mechanism (no line changed in
`ActivateAgentUseCase`). SOLO: no area, no subagents. The kickoff reads the
most recent `artifact.product_brief` — the SAME "business need"
the Criativo produces, without a new artifact — and the design system
(`design/tokens.css`, `design/COMPONENTS.md`) is DESCRIBED in the
agent's identity (`Engine.Harness.Agents`), static text: the conversational agents
have no tool to read repository files.

`propose_prototype` is the ONLY tool (`personas`, `jornadas`,
`prototipo` with `telas`/`anotacoes`, `resumo`). It writes
`artifact.prototipo_navegavel` **without a dedicated use case in the api** —
unlike `choose_project_image`/`create_c4_diagram`, which need one
because they have content DERIVED from another artifact or a shared domain
refusal; neither reason holds here, so the shape validation
lives in the engine (`ArtifactSchemas`) and the write uses the generic
`append_event_returning` the api already exposes, the same path as `artifact.product_brief`. One
single artifact, two handoffs about it — to "po" and to "dev-lead" — never
a second artifact for "spec-visual": the prototype (screens + annotations) IS the
visual spec, and duplicating it would risk the two copies diverging later. It reuses
the half of ADR 0086's design that survives without its suspension:
a successful `propose_prototype` ends the turn, so the model doesn't propose
again and duplicate the artifact — without the "aguardando_aprovacao", because proposing
a prototype has no external effect.

`apps/web/src/lib/agents.ts` got the entry (`color: var(--accent)`, the
least reused semantic token of the roster; `icon: PencilIcon`).
`uxDesignerActive` entered the roster in BOTH sources RN-090 requires in
sync — the team panel (`agent-status.ts`) and the dashboard card
(`projects-summary.repository.ts`, the same `infraActive` query
widened, no new query).

**Out of reach, declared**: `teste-de-usabilidade` requires a real human
user — no agent replaces that. `metricas-de-uso` remains a gap even
with `analytics` `active` (ADR 0089): the funnel report measures
session→commit→PR→merge, not feature adoption by the FINAL users of the
project Brabo builds — "evidence of adoption per feature" is
DECLARED as a metric with no path to exist today, not a pending item to
close next round.

## Staff — code ready, dormant for automatic triggering (RN-305/306, ADR 0088) {#staff--código-pronto-dormente-para-disparo-automático-rn-305306-adr-0088}
Not a planned phase: `docs/fluxo.yml` declares the Staff/Principal Engineer
as `status: planned` since ADR 0085 ("contract ready, activation
decided, waiting for a trigger"). A CONSCIOUS decision by the product owner:
bring the CODE forward knowing the AUTOMATIC trigger (the Anamnese
noticing a RECURRING systemic problem) won't fire — the Anamnese
is paused (`ANAMNESE_ENABLED=false`, decision of 2026-08-10). Dormant
for automatic triggering, not for MANUAL invocation.

The sixth solo conversational agent (`Engine.Agents.StaffServer`), alongside
Criativo/PO/Arquiteto/Dev Lead/UX Designer, mirroring the Arquiteto (bounded
loop, ceiling 14) with two differences: NO `kickoff/1` (there is no session
artifact to summarize — it comes up and stays idle until the first `user_message`,
which is how whoever addressed the handoff explains the problem) and activated by the
GENERIC path of `canActivateAgent` (an `accepted` handoff addressed to
"staff"), without entering `USER_STARTED_AGENTS` — investigation confirmed that
no domain change in the api was necessary, because
`assertHandoffTargetAllowed` only refuses an area subagent and the Staff has no
area. The only tool, `propose_rfc` (problem, options with trade-offs,
recommendation, disposable PoC), writes `artifact.rfc_staff` DIRECTLY via
`append_event_returning` — the same tableless pattern as `emit_insight`, and
not that of `artifact.c4_diagram` (which derives the Container level from the
module_map in the api) — and returns the handoff to the Arquiteto in the SAME tool call,
without a `proposed_action` (recording a document is not an external effect).

`staffActive` entered the team panel roster and the dashboard card
(`ProjectCardSummary.roster`), same criterion as `infraActive`, so as not to
open the divergence the `RosterFacts` comment already warned about.
**Declared, not hidden**: `SessionPage.tsx`/`AGENTES_DE_CHAT` were not
touched — the same pattern already accepted for `infra` (a REAL and ACTIVE lead
also outside that list). The end-to-end usage path today is the internal
route (`POST .../agent/message`, `agent: "staff"`), not the Session
screen; the generic "manual handoff to an agent of choice" UI remains in the
backlog.

## The `implementavel` gate active — QA strategy as the qa-lead's second moment (ADR 0090) {#o-gate-implementavel-ativo--qa-estratégia-como-segundo-momento-do-qa-lead-adr-0090}
A conscious decision by the product owner to bring forward the trigger
`docs/fluxo.yml` already foresaw ("when the implementavel gate activates") — the
trigger HERE is the very work of building the mechanism, not a usage symptom
waiting to happen. `docs/gates.yml`, `implementavel`:
`status: planned` → `active` (owner `dev-lead`, `severidade: warn`
untouched — the registry already said "it's born warn even when it activates").

**QA strategy stops being a `proposto` role**: it is the `qa-lead` ITSELF, in a
second MOMENT — same process, a deliverable separate from the PR verdict,
exactly as `docs/fluxo.yml` already declared ("it may be the qa-lead itself
in a second MOMENT, not necessarily a new agent: the separation is by
deliverable"). `Engine.Gates.QaLeadServer.run_design/3` is a NEW and ADDITIVE entry
point (without touching `run/2`, the usual path, tied to
`DevAgentState.find_by_task_id`), triggered by
`Engine.Gates.Dispatcher.run_qa_estrategia/3` (the same test-swappable indirection
`run_qa/2`/`run_secops/2` already use).

`Engine.Gates.QaEstrategiaAgent` is a STATELESS module (not a `GenServer`),
the same shape as `QaPerformanceSegurancaAgent` — a registry without `Terminal`
(`ReadFile`, `SearchWorkspace`, `EmitPlanoDeTeste`) —, but the CONTEXT is
different: `Engine.Gates.QaEstrategiaContext.fetch/3` fetches ONLY the story (from
`list_backlog`) and the current `module_map` (from `get_infra_context`, reused only
for the `moduleMap` field — zero new route), without `dev_state` or
`worktree_path`, because the gate runs PRE-DEV: there is no dev agent, worktree
or `task_id` yet. None of the three tools goes through the
`ActionPipeline` (only `terminal`/`write_file` do), so this agent
NEVER suspends — `run_design/3` runs synchronously inside its own
`handle_cast`. The iteration ceiling stays at 8 (conversational), not 60
(gate) — ON PURPOSE: with no `token_budget_micros` underneath (there is no task,
PRE-DEV), the same reason `infra-workflows` stays at 8 even while using a
tool (RN-085). The deliverable (`emit_plano_de_teste`: synthesis,
executable criteria, a GENERIC automation strategy with no framework)
becomes `artifact.plano_de_teste` in the event log of the calling session.

`assess_implementability`, a new Dev Lead tool, reads the most recent
`artifact.plano_de_teste` of the story in its OWN session's
history: with no plan yet, it triggers the assessment and returns an error asking for a
retry (a tool error is loop INPUT, not the end of the line —
RN-163); with a plan, it proposes the opinion (`implementavel`/`inviavel` +
justification, plan embedded in the payload) as a `proposed_action`, the SAME
three-outcome pattern as `propose_execution_plan` (ADR 0086) —
`maintainer`, DELIBERATELY outside the absolute ceilings block of
`decide.ts`.

**`appsec` stops being `proposto`** — the SecOps second moment comes in the
next section.

## appsec gets the secops second moment (RN-360/361, ADR 0090) {#o-appsec-ganha-o-segundo-momento-do-secops-rn-360361-adr-0090}
`docs/fluxo.yml` (`id: appsec`, camada_seguranca) declared in advance
"same pattern as QA: two MOMENTS, not two agents for now" — a
conscious decision by the product owner to bring the activation forward, without waiting for the
`implementavel` gate (front `qa-estrategia`, same conceptual ADR 0090) that the
registry itself cited as the trigger.

`Engine.Gates.SecOpsAgentServer.run_design/2` runs in the SAME process as the
PR secops (same `Registry` key), without any `Diff`/`Scanner`/
`DevAgentState`: it fetches the story from the backlog + the current `module_map`
(`Engine.Gates.AppSecContextBuilder`, without `dev_state`/`worktree_path`) and
calls `Engine.Gates.AppSecAgent.run/3` — a STATELESS module (not a GenServer,
the same shape as `QaPerformanceSegurancaAgent`), a tool registry WITHOUT
`Terminal`, running a STRIDE-lite checklist via `ToolLoop.run/1` over the
story's DESIGN, never over code. It ends by emitting `artifact.threat_model`
and creating a handoff to the three declared leads (arquiteto, dev-lead,
`infra` — the addressable AGENT of the id `area-infra`, RN-361).

**Declared gap, not a bug**: `run_design/2` is INVOKABLE, but nothing invokes it
on its own yet — the natural trigger is the Dev Lead's `assess_implementability`
(front `qa-estrategia`), out of scope for this delivery, which was kept
self-contained (`decide.ts`/`docs/gates.yml`/`dev_lead_tools.ex` untouched).

## `analytics`/`delivery-metricas` become a report (RN-320..322, ADR 0089) {#analyticsdelivery-metricas-viram-relatório-rn-320322-adr-0089}
A conscious decision by the product owner to BRING FORWARD two roles of the
target model (`docs/fluxo.yml`, `status: proposto`) without waiting for the
organic trigger each one already declared. The shape is the one the flow itself
prescribed: `analytics` "absorbed by `medicao`" until a PRODUCT metric
becomes mandatory PO input, `delivery-metricas` "never becomes an agent —
it becomes a REPORT of `medicao`". Both become a single SCRIPT —
`apps/api/scripts/analise-funil.ts` (`pnpm --filter api analise:funil --
--projeto <uuid> [--json]`), in the SAME format as `medir-execucao.ts`
(Fase 13b): a pure read via Drizzle, zero writes, no GenServer, no
LLM agent.

It measures FOR REAL, over `proposed_actions.execution_result` of the dev agent's three git
actions (`git_commit`/`pr_open`/`git_merge`, only `status:
'executed'`): a real funnel (how many sessions produced a commit / opened PR /
merged PR, and the conversion between stages — it counts SESSIONS, not actions), real lead
time (first commit to the session's first merge, by the EXECUTION's
`updated_at`, not the proposal's) and real deployment frequency (merge into a
`PROTECTED_BRANCHES` branch, per day, cross-referencing the
`backmerge` gate of `docs/gates.yml` — whose evidence is CI, out of reach of
a script that only reads the database).

Three metrics stay in a "Not measured, on purpose" section — a
PERMANENT declaration, not a gap to close next round: **the complete product
funnel ideation → commit** (`sessions` without `storyId`, RN-230, would require
a new schema — no migration in this front); **evidence of adoption per
feature** (it's not data that is missing collection — Brabo doesn't instrument the
projects it BUILDS, with no path at all for that telemetry to
exist today); **MTTR and change failure rate** (they require a real production
INCIDENT signal, the same dependency as `secops-runtime`/`platform` —
another front).

## `secops-runtime` as a report script (RN-375..377, ADR 0091) {#secops-runtime-como-script-de-relatório-rn-375377-adr-0091}
A decided bringing-forward by the product owner of the `secops-runtime` role
(`docs/fluxo.yml`, `camada_seguranca`, previously `proposto`), without waiting for the
declared trigger ("production with real traffic, after `DEPLOY_ENABLED` +
`platform` active"). Only what the trigger does NOT require comes in: `pnpm --filter api
relatorio:seguranca-runtime` reads `rate_limit_hits` — the data that the
ADR 0027 `RateLimitGuard` already writes, including under dev/CI traffic — and
produces a ranking of buckets (`user:<uuid>`/`ip:<endereço>`, the only two
formats written; no route or reason, which the table never stored) and a
temporal distribution in fixed slices. It's a SCRIPT, not an LLM agent nor a
`GenServer`: there's no decision to make about the data, only aggregation.

Automatic incident detection, incident response and security
postmortem remain OUT — they depend on the same trigger that didn't fire — and
the report lists them in a PERMANENT "not measured" section, without simulating an
example incident nor inventing a number (same principle as ADRs
0041/0042/0077). The retained window is short by design
(`DomainGaugesCollector.pruneRateLimit` deletes hits older than
`2 × RATE_LIMIT_WINDOW_MS`, 240s by default), and the report declares both
windows — CONFIGURED and OBSERVED — never letting the second pass for a
longer history than it is.

## `platform` gets a first delivery: an on-demand telemetry report (RN-385/386, ADR 0092) {#platform-ganha-uma-primeira-entrega-relatório-de-telemetria-sob-demanda-rn-385386-adr-0092}
A conscious decision by the product owner to bring forward part of the `platform` role
(`docs/fluxo.yml`, `camada_plataforma`) — whose `status` remains `planned` and
whose `ativacao` remains synchronized with `DEPLOY_ENABLED`, which doesn't exist.
`pnpm --filter api relatorio:telemetria [--projeto <uuid>] [--json]` is a
SCRIPT (not an LLM agent, not a `GenServer`) that reads, on demand, the SAME
questions `DomainGaugesCollector` already collects for the
Prometheus scrape — active/closing sessions per project, blocked tasks per
project, state of the last backup (always GLOBAL, never per project, because the
product backs up the whole database) — and ends after printing. The
SQL queries are REPLICATED, not imported from the collector: its methods are
private and end by writing to a Prometheus gauge, with no pure "just
the query" half to reuse without coupling a CLI script to the lifecycle of an
`@Injectable`.

The output always includes "where to see more" (the versioned dashboards in
`deploy/k8s/observability/dashboards/*.json`, the alerts in
`deploy/k8s/observability/alerts/brabo-alerts.yaml`, `docs/runbook.md
#observabilidade`, `pnpm dev:obs` for local observability) — a link, never
duplication — and a "not measured" section that DECLARES, without inventing: no
numeric SLO is defined in the product, a postmortem depends on a real incident that
didn't happen, and telemetry back into the product in a closed loop is what
would make `platform` `active` — the trigger (`DEPLOY_ENABLED`) remains absent. The
role's `gate_saida: { id: operavel, status: planned }` doesn't change;
`docs/fluxo.yml` only gets a `nota` on the `telemetria-consolidada` output
saying the manual/on-demand version is already real.

## dbre becomes two mechanical scripts (RN-400..403, ADR 0093) {#dbre-vira-dois-scripts-mecânicos-rn-400403-adr-0093}
Of the fluxo.yml `dbre` role, only two of the four deliverables depend on
real data volume (`plano-de-capacidade`, `tuning` — they remain a gap,
with no deadline). The other two don't need a real load: `parecer-de-
migracao` is pattern recognition in SQL text
(`apps/api/scripts/lint-migracao.ts`, scans `apps/api/src/db/migrations/
*.sql`, flags `DROP TABLE`/`TRUNCATE`/`DROP COLUMN`/`ALTER COLUMN ...
TYPE`/`ADD COLUMN ... NOT NULL` without `DEFAULT`, `!= 0` if it finds something — today
it finds 3 occurrences in migrations already merged and accepted, informative, not
fixed in passing); `backup-restore-testado` was already real since
Fase 5 (CronJob + `backup_runs` + `make test-restore` executed, RTO
~40s) — all that was missing was an on-demand report (`relatorio:backup`, the same
read as `DomainGaugesCollector.collectBackup()`). Neither of the two
goes into CI yet: the linter scans the whole repository, not the diff of
a PR, and would become a gate that fails a PR for a finding that isn't its own — see
ADR 0093 for the scoping technique (`pr-police.ts`) when that changes. The
"one migration per wave" rule (`meta/_journal.json`) stopped being
called the "mechanized version" of this role: it avoids snapshot
conflicts between agents in parallel, a concern orthogonal to "this SQL
has a risky pattern".

## fluxo.yml × code audit — Wave 1: fluxo.yml/gates.yml up to date {#auditoria-fluxoyml--código--onda-1-fluxoymlgatesyml-em-dia}
The first of the six waves of the audit plan (section D,
`docs/explanation/auditoria-fluxo-vs-codigo.md`) to close — Waves 3, 4 and
5 had already been brought forward out of order (analytics/DORA, the
`implementavel` gate, QA strategy/appsec); this one is only metadata, no ADR, no
line of production code.

`docs/gates.yml` (`paralelismo-autorizado`): `status: planned` → `active`,
with `evidencia` in the SAME format as the neighboring `implementavel` gate —
`event_types: [proposed_action.created/approved/denied]`, `filtro: {
actionType: parallelize }`, `onde:
request-parallelization.use-case.ts` (finding A1/B5 — `fluxo.yml` already
said `ativo` since ADR 0053/FASE 14d, only `gates.yml` lagged behind).
`docs/fluxo.yml` got three more fixes from the audit, all of citation
or label, none of behavior: the `dev`'s state machine went
from 4 to 5 states (`awaiting_approval` came in, Fase 12e/ADR 0052 — A3); the
RN-160 citation left the Arquiteto's `backlog-promovido` input and went
to where it really applies, the `handoff-duplo` output (the
"Confirm architecture ready" button it locks — A4); the RN-161 citation
left `handoff-duplo` and became a note on the Dev Lead's input (it is the step of
ACCEPTING the handoff that chains execution activation, not the double handoff
itself — A5); and the origin of the `dev`'s `worktree-por-agente` stopped saying
`harness` (`Engine.Dev.WorktreeManager` is not one of the 4 components of the
`harness` role — A8). `docs/explanation/backlog.md` was also
updated: the line about the outdated `gates.yml` left the table of
pending items (closed here), together with the `implementavel` gate (B3, already
closed by ADR 0090 before this wave, without anyone having removed it from the table)
and the part of B7 (deployment frequency/lead time) that `analise:funil`
(ADR 0089) already actually delivers — MTTR/change failure rate remain
out, but as a PERMANENT gap already declared in `fluxo.yml`, not an
engineering pending item.

Verification: `pnpm --filter api validacao:gates -- --sem-banco` (valid
registry, no `ativo-sem-evidencia`) and `pnpm docs:check` green. Phase 3 of the
script (real evidence in the event log) requires `--projeto <uuid>` against a
database with data — out of reach of this fix, which is metadata only.

**Pending items of the same plan, not of this wave**: Wave 2 (Dev Lead →
dev delegation, RN-160 revalidated in the backend) and Wave 6 (the `necessidade-validada` gate,
which requires an ADR and a product decision before coding).

## fluxo.yml × code audit — Wave 2: RN-160 in the backend and Dev Lead → dev delegation (RN-404/405, ADR 0094) {#auditoria-fluxoyml--código--onda-2-rn-160-no-backend-e-delegação-dev-lead--dev-rn-404405-adr-0094}
The second of the six waves of the audit plan (section D), the TWO items of
largest scope after Wave 1 — the other four (3, 4, 5 brought forward out
of order; 6 still pending, requires an ADR and a product decision). Both live
exclusively in `apps/api`; no change in `engine`/`web` was
necessary.

**B6 — RN-160 revalidated in the backend.** The rule ("Confirm architecture
ready" requires at least 1 promoted story) was only guaranteed on the CLIENT
(`SessionPage.tsx`, `hasPromotedStory`) — a direct HTTP call to
`POST /agents/arquiteto/handoff-infra` ignored the rule entirely.
`OfferInfraHandoffUseCase.execute` now queries
`StoryRepository.findByProject` and refuses with `BadRequestException` BEFORE
writing the event or calling the engine, when no story has
`status !== 'draft'`.

**B1 — the Dev Lead → dev delegation becomes data.** ADR 0053 (item 5) already
foresaw this and declared it out of scope at the time — CLAUDE.md listed it as a
reversible cut. Closed here: `AcceptParallelizationUseCase.execute`
(API side, covers both the direct AND the approved-for-free paths, because both already
converge on it) writes `delegations` with `area: 'dev'`, `leadAgent:
'dev-lead'`, `subagent` = the id of the freshly activated `dev-<modulo>`. Unlike
QA/Infra (which write on the ENGINE side, because that's where the subagent produces
an opinion), `status: 'completed'` was REDEFINED for this area: it means
"the delegation was CARRIED OUT" (the agent came up), not "opinion issued" — and
`parecerArtifactId` points to the project's most recent `artifact.module_map`
(via `SessionEventRepository.listByTypeForProject`, an already
existing method, no new query). Without a module_map in the project — it shouldn't
happen —, the delegation isn't written with a fake id: it only logs the
unexpected state and moves on, because the dev agent's activation is already a success when that
write is attempted; a failure in `RecordDelegationUseCase` also doesn't bring down the
activation, for the same reason. Decision recorded in ADR 0094, which also
revokes the cut of ADR 0053 item 5.

`docs/fluxo.yml` (`dev-lead`, output `delegacao`): `status: lacuna` →
`status: ativo, regra: RN-405`.

## fluxo.yml × code audit — Wave 6 (last): the `necessidade-validada` gate (RN-406, ADR 0095) {#auditoria-fluxoyml--código--onda-6-última-o-gate-necessidade-validada-rn-406-adr-0095}
It closes the LAST of the six waves of the audit plan (section D,
`docs/explanation/auditoria-fluxo-vs-codigo.md`) — all six closed: 3,
4 and 5 had been brought forward out of order (analytics/DORA, the
`implementavel` gate, QA strategy/appsec, ADRs 0089/0090); 1 and 2
closed in the previous PRs (fluxo.yml/gates.yml up to date; RN-160 in the
backend + Dev Lead → dev delegation). This is the 6th: the
`necessidade-validada` gate (Criativo → PO), declared `proposto` since ADR
0085 with no mechanism at all behind it.

`modelo-de-time.md` already recorded why it stood still: the Criativo (the
model) deciding on its own that the need it produced itself is
validated would be self-validation, not a real gate. The product owner's
decision was a SEPARATE human confirmation — a third button in
`SessionPage.tsx`, "Confirm need validated", in the SAME pattern as
"Confirm architecture ready" (RN-160): a dedicated route
(`POST .../agents/criativo/validate-necessity`), a dedicated use case
(`ValidateNecessityUseCase`), its own event (`necessity.validated`).
It never reused `confirm_readiness`/RN-142 (which remains just the
structural floor, "≥1 captured rule") nor the PO's acceptance of the handoff
(`AcceptHandoffUseCase`, structural, without judgment of content).

The chaining chosen: the button only enables AFTER `confirm_readiness`
has consolidated the `artifact.product_brief` (`hasProductBrief`) — it makes no
sense to "validate" a summary that doesn't exist yet, and it is the most
consistent reading of `docs/fluxo.yml` (the gate is the Criativo's OUTPUT, the
moment its work has already delivered a concrete artifact).
Unlike `OfferInfraHandoffUseCase`, this confirmation does NOT signal the
engine — the Criativo→PO handoff already happened inside
`confirm_readiness` itself, so the new event is only the record of MERIT, with no
trigger at all waiting for it.

`docs/gates.yml` gets the `necessidade-validada` gate: `active`,
`aprovacao_humana: true`, but `severidade: warn` — nothing in the product today
CHECKS the passing of this gate before letting the PO proceed, unlike the
`block` ones of `story-promovida`/`plano-de-adocao`, which have a real code
lock behind them. `docs/fluxo.yml` (`criativo`, `gate_saida`): `status:
proposto` → `status: ativo, regra: RN-406`.

## fluxo.yml × code audit — B4 (the LAST pending item): the PO reads product metrics (RN-407) {#auditoria-fluxoyml--código--b4-a-última-pendência-o-po-lê-métricas-de-produto-rn-407}
It closes item B4 — the last line of the table "Team model backlog
(ADR 0085)" in `docs/explanation/backlog.md`; the table is EMPTY after
this fix, and the fluxo.yml × code audit ends here. No new
ADR: it follows the same pattern already established by RN-164 (agent read
scoped to the project, no external effect, no `proposed_action`), just with
a new RN. `docs/fluxo.yml` (role `po`, input `metricas-de-produto`):
`status: lacuna` → `regra: RN-407`.

The DATA already existed since ADR 0089 (`analise:funil` — real funnel
session → commit → PR → merge, real lead time, real deployment frequency);
all that was missing was for the PO to be able to READ that report within the turn. The PO's third
read tool, `listar_metricas_de_produto`
(`GET .../product-metrics`), the exact same design as the two siblings of
RN-164 — `:direct`, no parameter, scope closed to the project. The pure
CALCULATION functions and the query (`calcularFunil`/`calcularLeadTimes`/
`leadTimeMedioMs`/`deploymentFrequencyPorDia`/`buscarAcoesGitDoFunil`)
migrated from `apps/api/scripts/analise-funil.ts` to
`apps/api/src/application/services/funil-metrics.ts` — a MECHANICAL and
necessary refactoring (`scripts/` can't live in `src/`, and `src/` doesn't
import from `scripts/`): the script started to RE-EXPORT from there, without changing
signature or behavior, and the script's regression test stays
green without being touched. The JSON body has no field for the three permanent
absences the script already declared only in text (complete product funnel
ideation → commit, evidence of adoption per feature, MTTR/change
failure rate) — the PO's tool cites them by name in the TEXT it returns
to the model, always, so it never concludes from the omission of the numbers that
there is no gap.

## GOVERNANCE.md — the criterion of the `community` mode, not its mechanism {#governancemd--o-critério-do-modo-community-não-o-mecanismo-dele}
An item of the previous backlog ("Community mode of approval-ladder") became a
record correction, not an implementation: investigation confirmed that the `community` mode
already exists in code since FASE 6 (`scripts/ci/approval-ladder.ts`), tested
on both sides, only turned off by `APPROVAL_MODE=solo` (default). The backlog's
sentence ("it becomes a change of `aprovacao_humana` in the gates registry") came from
a SPECULATIVE line of ADR 0054 — not edited, by rule, but the imprecision
is recorded in `docs/explanation/backlog.md`: the `aprovacao_humana` of the
`aprovacoes-da-escada` gate is already a fixed `true` in both modes, with no field at all in
the `Gate` schema that reacts to `APPROVAL_MODE`.

What was really missing was another `TODO(humano)`, in
`docs/explanation/branching-policy.md`: the criterion for who goes into each
approvers list (`devs`/`po`/`gestão`) — who comes in, who leaves, based
on what. `GOVERNANCE.md` (repo root, new) closes that: the MECHANISM stays
in `branching-policy.md` (the ladder, distinct people, the step by step of the
variable switch), the CRITERION now lives in `GOVERNANCE.md`. It's a proposal,
not a functioning committee — the project still has a single maintainer, and the
document is explicit about it: most of it describes what comes into
force WHEN there are more people, not a structure already active. A new `warn` rule
in the docmap (`governanca`) demands a review when `approval-ladder.ts`/
`branching-policy.md` change — separate from the existing `block` rule
(`politica-de-branches`) for the same reason `checks-e-rulesets` is separate
from it: MECHANISM follows from the code, CRITERION is a human decision.

## Real SMTP in MailSender (RN-408, ADR 0096) {#smtp-real-no-mailsender-rn-408-adr-0096}
It closes the backlog item open since the Keycloak cutover (ADR 0032, "real SMTP
remains future config"). `nodemailer` over pure SMTP transport
(a LINE protocol with state/MIME/STARTTLS/AUTH, unlike the HTTP
JSON APIs the rest of the product integrates), behind `MAIL_TRANSPORT` — `log`
(default, INCLUDING in production: sending real email is the operator's
opt-in) or `smtp`, selected by `useFactory` in `AuthUseCasesModule`
without touching any use case (`RegisterUseCase`,
`RequestPasswordResetUseCase`, `LoginUseCase`, the
`migrate-keycloak-users.ts` script keep just injecting `MailSender`).
`SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` follow the RN-114 pattern
in production when the mode is `smtp` — but WITHOUT the public default the
four original RN-114 ones have, so the rule only kicks in when the operator opted
for `smtp`; the validation runs in the constructor of `SmtpMailSender`, exercised
by the `useFactory` when the provider graph is assembled (the same design as
`CREDENTIALS_MASTER_KEY`), not by an eager call in `main.ts`. Body in
PLAIN TEXT, never HTML — the port carries no structure for a rich body, and
a template engine would be injection surface with no gain at all.

Investigation found a real gap before coding: `email_verification` had
no web route at all — `verificarEmail` existed in
`apps/web/src/lib/auth.ts` since Fase 7a with NO caller, so the
verification email's link would lead nowhere as soon as SMTP
started sending real email. `/verificar-email`
(`VerifyEmailPage.tsx`) closes that, mirroring `SetPasswordPage.tsx` — the same
`validateSearch` pattern in `router.tsx`, the same single response for a
nonexistent/expired/already used link — with one difference: no form, the
confirmation fires on its own on mount, so the screen needs the three
states of RN-088 (loading/error/success), not just two.
## "N agents online" on the dashboard — LIVE status, never historical presence (RN-409, ADR 0097) {#n-agentes-online-no-dashboard--status-ao-vivo-nunca-presença-histórica-rn-409-adr-0097}
An item of the previous backlog closed. Prior investigation confirmed there
was no liveness aggregate at all, neither per project nor per workspace — only
HISTORICAL presence (`RosterFacts`, "has appeared at some point") and real
live status only on the client, derived from the event log, only when a project
is OPEN. `ProjectCardSummary.onlineAgentCount` adds two mechanisms by the
SAME rule ("not idle, not stuck"): dev agents
(`engine.dev_agent_states.status NOT IN ('idle', 'idle_tripped')`,
aggregated in batch in the engine) and conversational agents (the last `agent.status`
of the most recent session with `status !== 'idle'`, a `payload` that only accepts
`working`/`idle`/`awaiting_approval`). QA/SecOps never count — they don't emit
`agent.status`, a single verdict per invocation, with no notion of "idle" between
calls.

The architecture decision worth recording: the query reads
`engine.dev_agent_states` DIRECTLY, via raw SQL batched by workspace, inside
the SAME `Promise.all` that already adds up eleven queries of the RN-090 read model
(TWELVE → FOURTEEN, still CONSTANT) — instead of opening a new internal HTTP route
in the engine. `api` and `engine` share the SAME physical database,
separated only by Postgres schema, and there was already a precedent
(`apps/api/scripts/medir-execucao.ts` already reads `engine.oban_peers`); this
decision raises the pattern from a manual script to TESTED production code
(a minimal, declared fixture of the engine table in
`test/support/global-setup.ts`). Consequence accepted and declared in ADR
0097: the query assumes whoever operates the product migrates both sides
together (`db:migrate` AND `engine:migrate`), and fails loudly/visibly if only the api
migrated — no try/catch hiding the error.

## An execution session no longer closes with a pending dev agent (RN-411) {#sessão-de-execução-não-fecha-mais-com-dev-agent-pendente-rn-411}
A fix for a defect found in a REAL execution session, not a script
item: five dev agents came up, became `idle_tripped` (RN-047, the
circuit breaker) stuck waiting for the user to unblock task by
task, and the session's 30s heartbeat (`Engine.Sessions.SessionServer`)
closed the session underneath while the manual unblocking went on. The
third signal of `GetSessionPendingWorkUseCase` (RN-064) only reads
`agent.status`, the conversational agents' vocabulary — dev agents
speak `dev.*` (`Engine.Dev.AgentIo`) and never emit `agent.status`, so
no dev agent ever held the session through that signal. The fourth signal
reads the last `dev.*` event of each `dev-<modulo>`/`dev-<modulo>-2` in the
session: `dev.working`/`dev.blocked`/`dev.idle_tripped` hold the session
(stuck waiting for a human decision IS pending work); only `dev.idle`
(truly drained) doesn't hold it. `dev.awaiting_gate`/`dev.awaiting_approval`
ENTERED the rule through RN-412 — see below; the residual gap this
paragraph described was closed.
## Automatic personal workspace on sign-up (RN-410) {#workspace-pessoal-automático-no-cadastro-rn-410}
Found while browsing: the dashboard's "New project" button did NOTHING, with no
error. Root cause: `RegisterUseCase` and `SocialLoginCallbackUseCase` (in the branch
that provisions a new account) created a user and a credential but NEVER a
workspace — EVERY new sign-up hit that wall, and it only didn't show before
because `seed.ts` always creates a workspace along with the demo data.
Both points now create the workspace and add the user as `owner`
in the SAME transaction that already creates the account. Name/slug come from a single pure
function, `nomeESlugDoWorkspacePessoal` (`domain/auth/personal-workspace.ts`),
so the rule doesn't diverge across two files; the slug is always suffixed with
`userId.slice(0, 8)` (the same pattern as `extraDevAgentId`) to be unique
without a round trip to the database (RN-410).

## 413 on PRs and Executors "without execution" — the two ends and the chain (RN-412, ADR 0098) {#413-nas-prs-e-executores-sem-execução--as-duas-pontas-e-o-encadeamento-rn-412-adr-0098}
Not a planned phase: a fix requested by real USE ("on PRs it's always
blowing up with entity too large") plus the sibling defect of the Executors tab
showing up empty with real work going on. Investigation found the two
chained: the gate dies with `413` → devs get stuck in
`dev.awaiting_gate` → that state didn't hold the session (the gap of
RN-411) → the 30s heartbeat closes the session underneath → the tab requires an
active session and vanishes with the whole roster.

**The cause of the 413 was Brabo's API, not the LLM provider** — the
comments that attributed the error to the provider (`runtime.exs`,
`terminal_executor.ex`, `docker-compose.yml`) were wrong;
`FalhaDeTurno.origem({413, _})` already classified it as `"codigo"`, and
was right. `apps/api/src/main.ts` never configured Express's body
limit — the 100 KB default applied, far below the 8 MB that
Phoenix accepts, in the transport's heaviest direction (engine → api,
`POST /internal/sessions/:sessionId/llm-turn`, which resends the WHOLE
history on each ToolLoop iteration). `API_JSON_BODY_LIMIT` (default
10 MB) closes the transport end.

The second end, without which raising the limit would only postpone the overflow: the
engine's `ContextManager` (ADR 0098) had TWO defects that
kept compaction unreachable before the body overflowed —
`estimate/1` counted only `content`, so `assistant` messages
full of `toolCalls` cost ~zero tokens in the estimate; and the compaction
window used only `context_window` (128,000 tokens in the gate
agents), which gave ~350 KB before compacting — well after
any reasonable transport ceiling. The EFFECTIVE window is now
`min(context_window, teto_de_transporte)`, with the cut always on a
ToolLoop ITERATION BOUNDARY (never separating an `assistant` with
`toolCalls` from the `role: "tool"` ones that answer it — it would break the provider's
tool-use protocol).

**RN-412** extends RN-411: `DEV_PENDING_TYPES` gained
`dev.awaiting_gate` (the original argument — a gate can die and lock
the dev agent in that state indefinitely) and also
`dev.awaiting_approval`, by a new argument found in the investigation:
the approval decision writes `proposed_actions.status`
SYNCHRONOUSLY, but the dev agent's resumption via outbox/Oban is ASYNCHRONOUS —
in the window between the two, nothing held the session, the same defect as
RN-411 one level deeper.

**The Executors/Overview tab** had the sibling defect on the web side:
`executionActivated` was derived from `events.some(...)` over the window
of only 200 events of `useSessionEvents` — `execution.activated` is among the
FIRST events of a session and left the window in any real
execution, erasing the whole roster. The correct value already existed, aggregated
over ALL the events, in the workspace summary (RN-090,
`projects-summary.repository.ts`) — the two screens started consuming
that value. A bonus finding along the way: `ExecutionSection` (Overview)
recomputed `activated` again, independently, over the
same window — a long execution went back to offering "Activate execution"
as if it had never started; fixed along with it. `gatesEverOpened`
suffers from the SAME class of defect and was DECLARED as a known
limitation, not fixed here — fixing it would require changing the signature
of `deriveAgentRoster`/`rosterFactsFromEvents`, out of scope for this
targeted fix.

## Neo4j as a knowledge graph — the foundation (RN-413/414/415, ADR 0099/0100) {#neo4j-como-grafo-de-conhecimento--a-fundação-rn-413414415-adr-00990100}
The product owner's request: Neo4j + `ollama-model-loader` (gemma:1b,
yi-coder:1.5b, nomic-embed-text), explicitly inspired by the repository
[ErickWendel/neo4j-ai-experiments](https://github.com/ErickWendel/neo4j-ai-experiments)
— acknowledgment recorded in ADR 0099 and in `prompts/README.md`, for the
concrete inspiration of the "prompt as a versioned file, not a string
stuck in the code" pattern and of the graph as agent memory.

Two responsibilities, one foundation: **versioned prompt templates**
(`PromptTemplate`/`PromptVersion`, idempotent by hash — RN-413) and
**relational memory** (interactions, Psicólogo hypotheses with evidence,
Anamnese profiles, handoffs — real consumption is a future wave, this delivery
only builds the mechanism). The graph is DERIVED memory, never a source of
truth; pgvector remains the chunks' vector index, without
duplicating embeddings in two databases. The `neo4j-driver` driver in the api (not in the
engine) — the api already owns all persistence and the RAG, the engine
consumes through internal HTTP with a service token, as always.

`rag_search` (RN-414) closes the biggest gap of the existing RAG: no agent
queried it, only the web "Chat RAG" tab. A new tool in the engine, its own ceilings
(RN-150), degradation always visible at the start of the text to the model.
`ollama-model-loader` (RN-415) closes a separate real bug: `nomic-embed-text`
was never pulled automatically and the RAG degraded to lexical-only
silently in any clean environment.

First batch of templates extracted to `prompts/*.md` (ux-designer,
Psicólogo, Anamnese, `ContextManager` summarization).

## Graph consumption — templates without touching GenServers, relevance without replacing recency (RN-416/417, ADR 0101) {#consumo-do-grafo--templates-sem-tocar-genservers-relevância-sem-substituir-recência-rn-416417-adr-0101}
`InstructionFiles` gained a `:graph` source (`db > graph > dir > root` —
the user's `instruction_patch` still beats everything), and THREE agents
started TRYING to resolve the template from the graph before the inline text, which
became a mandatory fallback: ux-designer (`graph_instruction_templates_enabled?`),
Psicólogo and Anamnese (`graph_templates_enabled?`, the same key for the
two). Two flags, not one — they would collide with OPPOSITE defaults between
parallel fronts if they shared the key; both defaults are `false`.
Only `context-manager-summarize` (of the four templates in the batch) was left without a
consumer at the time — a gap ADR 0101 declared open and that closed
later, through the FOURTH consumer of the SAME `graph_templates_enabled?`: the
`ContextManager`'s summarization prompt (`prompt/1`, see RN-417).

`Psychologist.ContextBuilder`/`Anamnese.ContextBuilder` gained a
SECOND context source — `rag_search`, with a query derived from the analysis
trigger — in COMPOSITION with the usual recent/time-window
read, never as a replacement: with no hit, the behavior is identical to
before. The excerpts go into the EXISTING `Triage` budget, and
the RAG's `degraded: true` is always visible in the context, never hidden.

The graph writes itself: `GraphProjector` (api) drains a SECOND
outbox line (`aggregateType: 'graph_projection'`, same transaction,
a value the engine's filter — `IN ('session', 'task')` — never matches,
avoiding the race with `Engine.Outbox.Drain`, which already drains `'session'`
in ~2s) and calls the already existing write use cases. The engine
NEVER writes to the graph directly — it preserves the event log as the single source of
truth; the graph can be rebuilt by replay.

**A real finding during verification, recorded because it teaches**: the
body limit test of RN-412 (`apps/api/test/main.spec.ts`) had a
LATENT bug — `AppModule` imported STATICALLY at the top of the file evaluates
`DrizzleModule` (which creates its connection pool at MODULE scope, not
in a Nest factory) BEFORE `beforeAll` can point
`DATABASE_URL` to the test database. It stayed masked while the local dev
database was also migrated (same table, so the query "found" it even
pointing at the wrong place); it got unstuck as soon as the dev database was
recreated empty (by this very wave's real smoke test against
Neo4j+Postgres). Fixed with a DYNAMIC `await import(...)` inside
`beforeAll`, after `DATABASE_URL` is already set — it is the pattern to follow
whenever a test needs to redirect `DATABASE_URL` to a real
`AppModule`.

## Local runner — execution on the user's machine (RN-418/419/420, ADR 0102/0103) {#runner-local--execução-na-máquina-do-usuário-rn-418419420-adr-01020103}
The product owner's request: an agent running on the USER'S MACHINE, in the
project's local folder, through the user's default terminal — plus a real
interactive terminal in the Code tab. Two changes, one depending on the other.

**Policy (ADR 0102 — a GLOBAL decision, explicitly confirmed by the product
owner after an automatic security warning about the change)**:
`git push`/PR/deploy (RN-106) and `sudo`/`doas` (new) leave the unconditional
`deny` and become an ABSOLUTE CEILING — unconditional `require_approval`,
in the SAME block and SAME pattern as the neighboring ceilings (`current.policy ===
'auto_approve'`), never auto-approvable by `agent_autonomy` (wildcard `"*"`)
nor by `permissions.json`. The gap the original `deny` plugged by force
was closed at the SOURCE: `ApproveAlwaysActionUseCase`/`patternForAction`
refuse to write an `allow` pattern for an action with a git external effect or a
privileged command — "always allow" approves only the instance, never the
pattern, for those two cases. Without that second half, the ceiling would be
decorative. `sudo`/`doas` match by VERB in `comandoPrivilegiadoNoComando`
(`external-effect.ts`), scanning all the command's segments, same
principle as `efeitoExternoNoComando`.

**Runner (`apps/runner`, a new Node/TS workspace, ADR 0103)**: a CLI
(`brabo-runner --project <id> --dir <pasta> --token brb_...`) that the
user runs on their own machine, connects to the ENGINE through a NEW Phoenix channel
(`/runner`,
topic `terminal:<projectId>`) authenticated by a SINGLE-USE ticket (same
pattern as RN-108, but a ticket ISSUED BY THE ENGINE — schema `"engine"`,
its own migration — and requested by the api through an internal HTTP route, inverting the
session ticket's flow). It runs `exec` (an ALREADY APPROVED agent command
— the routing in `TerminalExecutor` only happens AFTER the usual
`decide()`/`proposed_action` pipeline, never before) in the user's `$SHELL`,
and an interactive PTY mode for the Terminal tab (`pty_open`/`pty_data`/
`pty_input`/`pty_resize`/`pty_close` — the engine does pure RELAY, never
interprets the bytes). Only ONE runner per project (`Engine.Runners.Registry`,
`:global`, exclusivity of `:global.register_name/3`); `runner` mode WITHOUT a
verified workspace or WITHOUT a connected runner REFUSES explicitly — it never
falls into `System.cmd`/bind-mount, which doesn't exist for a `runner` project
(revised by ADR 0104/RN-423, see above; the fallback to the usual path
remains valid, but only for `container`/`mounted`). PTY is an action of the
authenticated USER, it doesn't go through `proposed_action`, but it audits
(`terminal.session.started`/`ended` in the event log, even when the tab
drops without an explicit `pty_close`).

The runner's security boundary is NOT sandboxing — it is authentication
(the CLI presents a Personal Access Token of the user's ACCOUNT) + the
usual approval pipeline + the consent of the user running the
CLI on their own machine, with their privileges. `apps/runner/src/guard.ts`
validates `cwd` inside the root by lexical resolution, but it is declared
BEST-EFFORT, not the real guarantee.

**The PAT closed the automation token gap (ADR 0105/RN-424..426).** The
real finding of Wave 1 — "the product has no LONG-LIVED account token
mechanism for automation, so the runner replicates the browser login
(cookie/CSRF persisted in `~/.brabo/runner-credentials.json`)" — was
closed in Wave 2: `personal_access_tokens` (`brb_…`, HMAC-SHA256+
pepper hash via `hashDeToken()`, never argon2 — wrong for a HIGH-entropy
secret) is issued in the project's Settings, scoped to ONE project,
revocable, with optional expiry. `apps/runner/src/auth.ts` lost
completely the interactive login, cookies and the credentials file — it only
validates the format and passes on `--token`/`BRABO_ACCOUNT_TOKEN`, NEVER written
to disk by the CLI. The PAT never authenticates outside
`POST .../runner-ticket`, by CONSTRUCTION (`IS_PAT_ROUTE_KEY`/
`@RequirePatAuth()` + `PatAuthGuard`) — never a branch in the global `JwtAuthGuard`,
which would let `RolesGuard` authorize the PAT for any route of the
user's role.

**`maintainer` revokes another user's PAT (RN-427)**, closing the item
ADR 0105 had declared out of scope for now (incident
response — a dismissed dev with a leaking token). An extension of the same model,
without a new ADR: SEPARATE routes (`GET .../personal-access-tokens/all`,
`DELETE .../personal-access-tokens/:tokenId/admin`), scope by
`projectId` instead of `userId` — each user's self-revocation
(RN-426) doesn't change.

`@xterm/xterm`/`@xterm/addon-fit` (web) and `phoenix`/`node-pty` (runner)
are the four new dependencies — the same exception rule as `mermaid`
(ADR 0068): dynamic `import()`, no `eval`/`new Function` confirmed by
grep in the installed package (not a formal guarantee against obfuscation, only
strong evidence — declared as uncertainty, not asserted as certainty).

**ADR 0104 — Wave 1 COMPLETED (RN-421/422/423):** ADRs 0072 and 0103
never talked to each other — RN-170 required a bind-mount at creation, and the routing to the
runner (RN-420) reused the same `workspace_mode == 'local'` flag without
any bind-mount, so actually using the runner was still forced to
go through the mounted-folder validation. `workspace_mode` (2 values) became
`execution_mode` (`container`/`mounted`/`runner`, migration `0048`) —
RN-170 (now RN-422) applies only to `mounted`; `runner` is born with a
path validated only LEXICALLY (no I/O) and `workspaceVerifiedAt: null`,
promoted to verified when a runner connects and confirms the path on the
HOST (`POST /internal/projects/:projectId/workspace-verification`, RN-423)
— the runner is the SOURCE OF TRUTH of the path, overwriting what was
typed in the wizard. `Engine.Actions.TerminalExecutor.decisao_de_execucao/1`
gained FOUR outcomes: it routes only with a verified workspace AND a connected
runner; without either of the two, it REFUSES explicitly — it never falls into
`mounted`'s `System.cmd`/bind-mount, which doesn't exist for a `runner`
project.

**A finding of the implementation, correcting the ADR (which is not edited — the
correction lives here and in
[backlog.md](backlog.md#backlog-of-the-runnerexecution_mode-adr-0104)):**
ADR 0104's sentence that converting between the three modes of an
existing project "is now allowed without recreating the project" is INCORRECT.
`UpdateProjectDto` still excludes `executionMode`/`workspacePath` on
purpose — it isn't a trivial PATCH (worktree, permissions.json and the
engine cache point to the old scope). Wave 1 delivered only the three-value
field at CREATION; converting an existing project is a future wave, with
its own design, not yet planned. Runner backlog: Wave 2 (PAT,
ADR 0105) closed the item that blocked `npm publish @brabo/runner`, and
Wave 3 (ADR 0106) delivered the distribution itself — `tsup` bundles
`apps/runner` into a single `dist/index.cjs` (`node-pty` as a mandatory
`external`, native binding), published on each final tag by its own
workflow (`publish-runner.yml`), parallel to `release.yml`. A real finding
tested empirically: the auto-run guard of `index.ts` needed
`realpathSync` on `process.argv[1]` — without it, `main()` never ran
when the CLI was invoked through the `bin` installed via `npm install -g`
(a symlink, which `process.argv[1]` never resolves by realpath but
`import.meta.url` always does). Declared operational pending item: the
actual publication requires the product owner to create the npm Automation Token
and configure the `NPM_TOKEN` secret — without it, the workflow warns and skips,
never fails. Exclusivity by `{project_id, machine_id}` remains postponed
until a second real simultaneous dev; best-effort `guard.ts` is a
REAFFIRMED invariant, not a gap. See
[ADR 0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)/
[ADR 0105](../adr/0105-personal-access-token-do-runner-escopado-por-construcao.md)/
[ADR 0106](../adr/0106-distribuicao-do-runner-via-tsup-e-npm-publish.md).

## DEVELOPMENT TOOL — `pnpm bootstrap` {#ferramenta-de-desenvolvimento--pnpm-bootstrap}
A terminal menu in `scripts/dev/bootstrap.sh` grouping what is done
day to day: Docker, K8s, Database and Test. It exists because those commands live
in THREE places that don't talk to each other — `package.json`, `Makefile` and scripts in
`deploy/k8s/`/`docker/` — and memorized knowledge rots.

It **reimplements nothing**: each leaf calls the command that already exists. The
`--print-commands` mode resolves the whole tree without a TTY and without executing, and it is
on it that the test runs (`scripts/dev/bootstrap.spec.ts`) — a TUI can't be
unit tested, but the menu→command mapping can, and that's what goes wrong.
Zero new dependencies; the colors come from `design/tokens.css` in 24-bit ANSI
with degradation to 256 colors and to none.

The output of a running command is SCROLLABLE (mouse wheel in SGR, `j`/`k`,
PageUp/PageDown, `G` to go back to the end). What was missing wasn't reading the wheel: it was
OFFSET — `tail -n` only knows how to show the end —, so the window became a slice
with `sed -n 'a,bp'`, testable without a TTY through `--print-window`. Two consequences
the footer announces: scrolling back FREEZES the window (like `less +F`, otherwise
the 5 Hz redraw undoes the scrolling) and mouse tracking, turned on only on the
execution screen, is turned off on EVERY exit — `\e[?1006l\e[?1000l` in
`restaurar_terminal`, which the EXIT trap covers. The escape parser is a generic
CSI one (reads up to the final byte): reading two fixed bytes left the rest of the sequence
in the buffer, and since the menu treats `[1-9]` as a choice, a wheel turn fired
menu items.

Three recorded decisions: `Create` provisions from scratch and `Deploy` publishes
into an environment that already exists (that's why only `Deploy` has a per-service choice);
in K8s only `All` works, and Api/Engine/Web appear DISABLED instead of
vanishing, because the menu should say what the product doesn't do; and
`Database › Delete` recreates the pgvector extension, since
`docker/postgres/init.sql` only runs on the volume's first initialization —
a plain `DROP SCHEMA` would make the next migration fail, and since the engine
shares the same database, recovering requires `db:migrate` AND `engine:migrate`.

**`Docker › Reset total`** (`scripts/dev/reset-total.sh`) adds up that
whole sequence into a single leaf — preflight, `up --build --wait` (the
`--wait` of Compose v2.17+ is the "until everything is healthy", with no health loop
written by hand), the same `DROP SCHEMA` as Delete, `db:migrate` +
`engine:migrate` and the seed — with its OWN confirmation screen
(`confirmar_reset`, requires typing `RESET`), distinct from Delete's (which
requires the database NAME) and without Delete's "postgres already up" precondition,
because it is the command itself that brings up compose from scratch. The seed
(`apps/api/src/db/seed.ts`) gained a step that activates a provider credential
from `.env`, reusing the SAME `<PROVIDER>_TEST_KEY` variables
that the LLM smokes already use
(`apps/api/test/infrastructure/llm/*.smoke.spec.ts`) — a single naming
convention, two consumers; a provider without a defined variable doesn't come in, without
error, and the credential stays with the OWNER (RN-058).

Two findings when running the reset for the first time, and not about the item itself —
neither of them is hypothetical, both broke the real run:

1. `gemma:1b` doesn't exist in the Ollama registry (`manifest unknown` — only
   `gemma3:1b` exists), so `ollama-model-loader` always failed and the
   `--wait` never closed green. Fixed in the six places that carried the
   wrong value as CODE — `docker-compose.yml`/`.prod.yml`,
   `.env.example`, `docker/ollama/pull-models.sh`,
   `scripts/dev/verificar-modelos-ollama.sh`,
   `deploy/k8s/base/ollama/job-model-loader.yaml` and RN-415 in
   `docs/business-rules.md` — without touching ADRs 0099/0100 (accepted) nor the
   historical narrative of this same section of CLAUDE.md, which describe what
   was requested/decided at the time, not the current operational value.
2. More serious, and older — `Database › Delete` (item 3.4, existing
   since the menu was created) never really dropped: `DROP SCHEMA public
   CASCADE` doesn't reach `engine.*` (Ecto/Oban lives in its OWN schema,
   `engine`) nor `drizzle.__drizzle_migrations` (drizzle-kit's control
   lives in its OWN schema, `drizzle`). Result: `mix ecto.migrate` hit
   `duplicate_table` on the engine tables that survived, and
   `pnpm db:migrate` — worse, WITHOUT any error — saw drizzle-kit's
   control intact, concluded it had already run everything and recreated
   NO api table. `Delete`/`Reset total` now drop `engine` and
   `drizzle` too, in that order, before `public`.

## Grouped tabs, project-wide PRs, local folder via Runner, the PO's carousel (2026-08-20) {#abas-agrupadas-prs-project-wide-pasta-local-via-runner-carrossel-do-po-2026-08-20}
Five independent waves, run in parallel by contested file, coming
from real use of the project screen — none planned in advance. The sixth wave
of the same program (complete translation of product and documentation, i18n) is
bigger than the five together; its FOUNDATION (Wave 6a — mechanism, no
content translation yet) has already closed: `react-i18next`+`i18next` on the web
(`en` became the app's default language, `pt-BR` kept — RN-425), a
`locale` column in `users` embedded in the login/refresh payload, a new `AccountPage`
(`/account`) proving the mechanism, and Docusaurus with
`i18n.defaultLocale: 'en'`/`locales: ['en', 'pt-BR']` — the current pt-BR snapshot
of `docs/` is already preserved in
`website/i18n/pt-BR/docusaurus-plugin-content-docs/current/`. Wave 6b
(mass extraction of the interface + translation of `docs/`) advanced a lot on
2026-08-22, in four parallel fronts — see CHANGELOG.md (Unreleased/
Documentation) for the detail of each — but it has NOT YET closed: missing are
`docs/business-rules.md` (only the front-matter was translated; the body, with
hundreds of RNs, remains 100% in Portuguese — it is the largest file of the whole
doc and grows faster than it can be translated in passing) and a
residual slice of smaller `.tsx` components. When it really closes,
this section gets the final summary and the rest of CLAUDE.md (Stack,
"Documentation") is fully revised to record English as the real primary
language.

- **Grouped tab ruler**: 11 loose tabs became 6 at the top — Overview,
  **Agents ▾** (Executors, Criativo, Chat, Insights), **Dev ▾**
  (Code, PRs, Approvals), **Documentation ▾** (Backlog, Architecture),
  Spend, Settings — via a new `GroupedTabs` (`apps/web/src/components/
  ui/GroupedTabs.tsx`), built ON TOP of the generic `Tabs`, which
  remains without groups for the other screens. `ChaveDeAba` remains flat — only the
  presentation became grouped, so as not to touch the `?tab=` deep link. Chat and
  RAG Chat become ONE tab (`ProjectChatShell.tsx`) with an internal segmented
  control ("Converse"/"Search") — the business distinction between the two
  (RN-202: conversing activates an agent and spends the owner's key per turn; RAG is
  a read over an index, without an agent) didn't change, only the UI container.
- **PRs tab, project-wide**: `ProjectApprovalsTab` scoped "PRs under
  review" to the most recent session — the review of a PR from a previous session
  vanished from the screen as soon as a new session proposed another one. The new `prs` tab
  lists straight from the git provider (never per session) and cross-references with
  a pending `proposed_action` via `findPendingByProject`, new, alongside the
  already existing session-scoped method — the decision uses the `sessionId` of the
  action ITSELF, never `latestSession` (RN-423). It is the first real producer
  of `git_merge` through the UI; the protected-branch lock (RN-154) remains
  absolute and untouched — the "Merge" button only PROPOSES, human approval
  remains the only way to execute.
- **Architecture tab**: extracted from the Overview (module_map, C4 diagram,
  ADRs, pending items), which keeps a condensed summary + link. The design system's first
  lightbox — `Modal` gained `size="full"` — to enlarge the
  C4 diagram (SVG, without quality loss) (RN-424).
- **Local folder navigation via the Runner (RN-422, ADR 0104)**: revises
  ADR 0072 (which had explicitly refused a folder picker) WITHOUT
  editing it — navigation exists, but through the Runner, which already runs with the
  user's real privilege on their machine, never through the api enumerating the
  container's filesystem. Two new events on the already existing channel
  (`fs_list_dir`/`fs_home_dir`), pure relay by the engine, same pattern as the PTY.
  `FolderBrowserModal` works where the project already exists. At creation
  (`NewProjectWizard.tsx`), the gap stayed declared until ADR 0108: in
  `mounted` mode the project is still only born at confirmation (the path validation
  touches disk there), but in `runner` mode "Browse folder..." now creates the
  project IN ADVANCE — reused by an identity snapshot instead of
  duplicated on each click — so it can anchor the channel ticket before the
  confirmation (RN-437, ADR 0108). A new `RunnerOnboardingPanel`
  (shared with the Terminal tab) replaces the raw `<code>` from before.
  `apps/runner` got a README — actually publishing to npm/packaging a
  signed binary remains out of scope, declared in the README.
  The folder explorer itself became three columns (shortcuts, a list where one
  click selects/double click enters, a details panel — RN-436),
  following the product owner's visual reference.
- **The PO's carousel bug fixed (RN-421)**: the batch of pending
  promotions depended on a scan over the last 200 events
  (`useSessionEvents`) — in a long session, the proposal left the window and the
  carousel degraded to a single card or vanished. The same class of bug that
  RN-180 had already fixed for `ContextAside`; the source is now
  `useBacklog` (complete, no window), with a per-story fallback when the
  backlog hasn't answered yet.

## Manual handoff to an agent of choice (RN-440/441, ADR 0109) {#handoff-manual-a-agente-à-escolha-rn-440441-adr-0109}
It closes the backlog item open since FASE 13c. `CreateHandoffUseCase`
remains the ONLY place that writes `toAgent` (ADR 0038) — it only gained an
optional `actor?: Actor`, defaulting to the usual `{kind:'agent', id: fromAgent}`.
`RequestManualHandoffUseCase` (a new route, `POST
.../sessions/:sessionId/handoffs`, role `developer`) validates `toAgent`
against `addressableAgents()` — a CLOSED catalog (area leads ∪
`SOLO_CONVERSATIONAL_AGENTS`), stricter than `assertHandoffTargetAllowed`
(which only refuses a subagent) — resolves `fromAgent` through the session's most recent
`agent.activated` (sentinel `"usuario"` when there is none), and writes
`actor: {kind:'user'}`. The handoff is born `offered` just like an automatic one:
the already existing acceptance card (`SessionPage.tsx`) picks it up on its own, zero
change in the acceptance path.

Investigation BEFORE coding found `ux-designer` (ADR 0087) in the SAME
situation as the Staff (ADR 0088) that motivated the item: a `message/2` clause
ready in `agent_command_controller.ex`, no human path to it.
Both entered `AGENTES_DE_CHAT` in the same change — `infra`/`qa`
remain out, the same pattern already documented there (leads without `kickoff/1`
or a `message` clause). Declared, not hidden: the mirror of
`SOLO_CONVERSATIONAL_AGENTS` on the web side (`apps/web/src/lib/agents.ts`)
is NOT cross-checked by test with the api's — diverging produces, at worst, a
stale option in the selector that the backend still refuses with 400.

## Budget per area — closes the cut of ADR 0038 (RN-443, ADR 0110) {#budget-por-área--fecha-o-corte-do-adr-0038-rn-443-adr-0110}
An approved backlog item ("Older backlog", `docs/explanation/backlog.md`).
`agent_areas` gets `budget_micros`/`spent_micros`, mirroring exactly
`max_parallel` — same row, same decision owner (`maintainer`), without a
new table. It is a THIRD ADDITIVE ceiling alongside project and session
(`CheckBudgetGateUseCase` checks all three in parallel, any one blocked
already refuses), **not** the model binding cascade of ADR 0064 (`session >
agent > area > project > workspace`, "the most specific wins") — the two
mechanisms share the word "area" and nothing else; not confusing the
two is the central point of ADR 0110, in the same way RN-101/ADR 0063 already
separates the owner's view from the member's view in the spend report.
`spent_micros` always adds up when the actor belongs to an area (lead or
member, via `areaDo` — a pure function, without touching the database for an actor without an area),
with or without `budget_micros` configured (`null` is the default, no ceiling).

## The runner's standalone binary (2026-08-23, RN-451/452, ADR 0112) {#binário-standalone-do-runner-2026-08-23-rn-451452-adr-0112}
A backlog item of ADR 0104 ("standalone binary, `pkg`/`bun build
--compile`"), companion of ADR 0106 (distribution via npm). The product
owner's explicit decision: a truly SINGLE binary, a complete matrix
with Windows since v1 — the cheaper alternative ("binary + a
`node-pty-native/` folder next to it") was offered and refused.

`bun build --compile` embeds `node-pty`'s native `.node` through
`with { type: 'file' }` and extracts it to a REAL TEMPORARY directory at
runtime (`native-pty-loader.ts`) — necessary because `node-pty` resolves its
own addon through a `require()` of a COMPUTED path
(`lib/utils.js#loadNativeModule`), which Bun can't embed on its own
(the build passes, the runtime throws `Cannot find module`, tested before
designing the fix). Five platforms
(`linux-x64`/`linux-arm64`/`darwin-x64`/`darwin-arm64`/`win32-x64`), each
one built on its NATIVE runner
(`.github/workflows/build-runner-binaries.yml`, final tag trigger,
same pattern as `publish-runner.yml`), the binary attached to the already
existing Release.

**Honest validation, per platform**: only `linux-x64` was actually executed
in this environment (`build:bin`+`smoke:bin` green, repeatedly —
it was by running the real binary that the two bugs below showed up). The other
four — Windows especially, with THREE native files instead of one —
were reasoned about by reading `node-pty`'s source code, never executed
on a real machine of that OS; their first real run is the NEXT
version tag, not this PR. No per-platform fallback was applied
preventively — nothing in this investigation PROVED that any of the five doesn't
work this way; if a real tag shows that it does, that becomes a new item, not
today's assumption.

Two defects found only by running the compiled binary, not by reading the API:
`--external node-pty` needs to be in the `bun build` command even without
any static `import` of `node-pty` in the code — the fallback `await import(...)`
(used only outside the binary) is discovered and embedded by Bun
anyway, and fails at runtime with a misleading error; and the
auto-run guard (ADR 0106) needed a second branch — `process.argv[1]` inside
the binary is a VIRTUAL path (`/$bunfs/root/...`) that `realpathSync`
can't reach, throwing `ENOENT` outside any `try/catch` before
`main()` is attempted.

## Converting the execution_mode of an existing project (RN-447..450, ADR 0111) {#converter-execution_mode-de-projeto-existente-rn-447450-adr-0111}
It closes the correction that the runner's Wave 1 (ADR 0104) had recorded in
`docs/explanation/backlog.md`: item 4 of that ADR said that converting
`execution_mode` between `container`/`mounted`/`runner` in a project that already
exists "is now allowed without recreating the project", and that was false until
here — `UpdateProjectDto` still excludes both fields on purpose.
`PUT projects/:projectId/execution-mode` (`maintainer`,
`ConvertProjectExecutionModeUseCase`) is a DEDICATED route, not a loosened
`PATCH`: it orchestrates the migration instead of just switching the column.

It refuses with 409 while any dev agent of the project (in ANY session,
read straight from `engine.dev_agent_states` by `project_id`, the same path as
RN-409) isn't `idle` — `idle_tripped` COUNTS as active here, unlike
RN-409's "online" criterion, because the agent still has
`workspace_root` captured in memory waiting for human unblocking
(RN-447). `PermissionsFileStore` gained `move(from, to)`: the content of
permissions.json never changes, only the physical path, because `projectScopeRoot`
derives from the (mode, path) pair (RN-448). Leaving `container` with a provisioned
container, the lifecycle (ADR 0081) is taken to `removed` — via
`stopped` first if it was `running` — BEFORE the column changes, because
`RegistrarTransicaoDeContainerUseCase` refuses a transition outside
`container` mode; entering `container` never auto-provisions (RN-449).
`workspaceVerifiedAt` is reset on every real conversion, including going back to
`runner` with a path that looks the same (RN-450). The same (mode, path) as
today is a no-op — it doesn't even check for an active dev agent.

**Declared consequence, not hidden**: the conversion NEVER copies the code
already written between the old root and the new one. That is safe for what was already
COMMITTED — the engine derives the worktree from the bare repo from scratch
(`Engine.Actions.Workspace.ensure!/4`) whenever the destination folder isn't
yet marked ready, so the next agent rebuilds the working
tree in the new root from the real git. What does NOT survive is an
UNCOMMITTED diff in the abandoned worktree — it stays orphaned on the old disk,
never migrated nor deleted. The active dev agent ceiling (RN-447) reduces the
risk (it never converts with a `working` agent) but doesn't eliminate it: an
`idle` agent between tasks may be sitting on a dirty diff, and nothing here
inspects the working tree's cleanliness before converting.

## A local folder attached as a RAG Chat reference (2026-08-23, RN-455..457, ADR 0113) {#pasta-local-anexada-como-referência-do-chat-rag-2026-08-23-rn-455457-adr-0113}
The product owner's request: attach a folder from the user's OWN machine to
a project as a READ reference for the agents — without the
`brabo-runner` CLI (ADR 0103). Explicitly NOT project execution/workspace:
`execution_mode: runner` (ADR 0104) needs the CLI because it needs
a real HOST path for the container to route commands; this is more
like "attaching files to a conversation". The browser reads the CONTENT
(`File.text()`) and the RELATIVE path (`File.webkitRelativePath`) of the
chosen files — never an absolute host path (the `File` API
doesn't expose one, to any site), and that's why ADR 0113 is explicit that it is NOT
a revision of what ADRs 0072/0107 refused: those refused
RESOLVING a host path from the browser; here there is no path
at all to resolve, only bytes the browser already had the right to read.

`chunks.scope` (ADR 0079/0080) gains a FOURTH value, `'local'` (migration
`0052`, `ALTER TYPE ... ADD VALUE`, additive — the two CHECKs of migration
`0045` are already written as "it's `session` or it isn't", so `local` falls on the
same side as `docs`/`adr` without a new CHECK). `IndexLocalFolderUseCase`
mirrors `IndexProjectDocsUseCase` closely — Markdown-aware chunking for
`.md`/`.mdx`, `RagEmbeddingService`, a chunk without a vector instead of failing
when the embedding drops (RN-233) — but REJECTS (400) the whole upload
when the AGGREGATE ceilings overflow (number of files, summed
bytes), never truncates silently: it's a SINGLE gesture by the user with a
folder picker on screen, not a background scan. An individual
file that's too big or has an unrecognized extension is only SKIPPED
(`filesSkipped`), never brings down the batch (RN-456). `origemDoChunk` didn't
need any new branch: `local` carries `sourcePath` like
`docs`/`adr`, falls into the `kind: 'file'` that the citation already knew how to render.

**It never enters the generic "Reindex now" (RN-457)**: `ReindexProjectUseCase`
reindexes by reading from a source the SERVER can revisit (the project's
repository, the event log); `local` has no source at all to revisit — the
text only exists in the browser of whoever attached it. Reattaching the folder (a new
upload to `POST .../rag/local`, `maintainer`) IS the
resync mechanism, a deliberately separate button, with a cross-comment
in both use cases pointing at each other and at ADR 0113, so that a future
"fix" doesn't wire the two back together and erase the user's material. The
coverage (`RagCoverage.local`) has its OWN shape — there's no "total in the
repository" to compare — and `lastAttachedAt` is the ONLY real exception to the
"never Xmin" rule (RN-237): a real `MAX(chunks.created_at)`, not a
guess (RN-458).

## The turn's activity strip — the thread only receives the reply at the end (RN-459/460) {#faixa-de-atividade-do-turno--o-fio-só-recebe-a-resposta-no-fim-rn-459460}

The product owner's request: the Session screen starts showing, ABOVE the
composer, a strip that narrates in human language what a conversational
agent (Criativo, PO, Arquiteto, Dev Lead, UX Designer, Staff)
is doing DURING the turn — visual reference: Claude Code's status
line. The thread only receives the reply bubble AFTER the turn
ends; the rule belongs to the CHAT (Phoenix channel) and applies only to the six
conversational ones — the consultative chat without an active agent (SSE,
`streamChatMessage`) keeps the usual streaming bubble,
untouched.

**Mechanism**: the six servers already emitted a DURABLE `tool.call`; they now
also `broadcast(state, "tool.call", %{tool: name, agent: @agent})` —
EPHEMERAL, without `args` (RN-096/RN-412) — for the channel to deliver in real time.
There is no shared behaviour/macro between the six `dispatch_tool`s
(four distinct structural shapes, confirmed by a complete read) —
the change was six edits adapted to each one's local shape, not a
refactoring. On the web side, a PURE reducer
(`reduzirAtividadeDoTurno`/`lib/atividade-do-turno.ts`) accumulates the
`agent.delta` as current text; when `tool.call` arrives, it archives the
non-empty current text as a narration line, resets it, and always adds a
tool line with `fraseDaFerramenta(tool)` (a dictionary of the 19
tools, `lib/narracao-de-ferramentas.ts`, without its own RN). Its OWN
flag (`turnoViaCanal`, never derived from `statusAgent`/`streamingAgent`,
which go through legitimately `null` windows in the middle of the turn) decides whether the
strip appears or the old bubble — never both.

**Presentation rule (history)**: `agruparNarracoesDoTurno`, a new
pure pass after `afundarDesfechos` (RN-172) in the same `useMemo` —
consecutive `agent.response`s of the same `turno`+`autor` become a
compact `Disclosure` ("Turn steps · N"), only the last stays intact
outside it. `turno === 0` (the sentinel prologue of `turnoDoSeq`) stays
OUT of the grouping — old fixtures stack `agent.response` without a
turn boundary to test another mechanism (RN-138/RN-177), and without the
exclusion the new grouping would produce a `Disclosure` inside a
`Disclosure` there. `afundarDesfechos` itself didn't change.

**A finding along the way, scope extended by the product owner's decision**: the
investigation found that FOUR of the six servers (Arquiteto, Dev Lead, UX
Designer, Staff) ended SILENTLY at the iteration ceiling —
`defp run_turn(state, remaining) when remaining <= 0, do: state`, without
any event, contradicting the permanent rule that an agent loop doesn't
end silently. Only the PO already emitted `toolloop.limit_reached` (RN-166); the
Criativo deliberately diverges with `agent.error` (a decision documented
in the code itself). The four fixed now emit
`toolloop.limit_reached`, the same event as the PO (RN-459).


## Migrated from the CLAUDE.md index on 2026-09-11 {#migrado-do-índice-do-claudemd-em-2026-09-11}

The entries below came from the `CLAUDE.md` index table and **had no
section of their own in this file** — their narrative existed in a single place. They were
moved without rewriting, in the order they were in, when the table was reduced to an
index. Whatever is here is history; what holds today lives in the RNs, the ADRs
and the "Current and open state" section of `CLAUDE.md`.

### PROGRAMA 16–26 (ADR 0060–0072) {#programa-1626-adr-00600072}
Design handoff adopted; 8 screens; session kind; paginated events; Spend;
model per area; container per project (25b cut); Code tab

### pnpm bootstrap {#pnpm-bootstrap}
Terminal menu over existing commands; Reset total

### Native Ollama / Hugging Face pull (RN-461..463, ADR 0114–0115) {#ollama-nativo--pull-de-hugging-face-rn-461463-adr-01140115}
The dev bootstrap asks once and persists the Ollama mode in `.env`;
a Hub model browser with a two-step pull and an allowlist of official
publishers

### The website's own lockfile (ADR 0117) {#lockfile-próprio-do-website-adr-0117}
`website/` leaves the root pnpm workspace — lockfile and security overrides
isolated, the product's `pnpm audit` stops reporting the Docusaurus tree

### Automatic runner configuration through the browser (RN-464..466, ADR 0118) {#configuração-automática-do-runner-pelo-navegador-rn-464466-adr-0118}
An Ed25519 device key generated in the browser, additive to the PAT; a binary
proxy via GitHub Releases; the File System Access API writes the configured folder,
with a download fallback outside Chromium; `--project/--dir/--token` become
optional in the CLI

### Images published to GHCR (ADR 0119) {#imagens-publicadas-no-ghcr-adr-0119}
`release.yml` publishes the four images on each final tag and records the digests
in `.release/images.json`; the production overlay stops pointing at a
placeholder

### Schema per aggregate (ADR 0121) {#schema-por-agregado-adr-0121}
`db/schema.ts` becomes a barrel; the 51 tables and 34 enums become 16 files under
`db/schema/`, one per aggregate of `domain/*`

### `SessionPage.tsx` in 5 mechanical PRs (ADR 0122) {#sessionpagetsx-em-5-prs-mecânicos-adr-0122}
3,807 → 2,661 lines; timeline/turn, `StorySlide`, `StructuredQuestionCard`,
backlog tree + `ContextAside`, hook `useSessionReadiness` — the turn
channel cluster and `ProjectSettingsTab.tsx` remain out, declared

### The `SessionPage.tsx` turn channel hook (ADR 0124) {#hook-do-canal-de-turno-do-sessionpagetsx-adr-0124}
2,661 → 2,479 lines; a mechanical dedup PR
(`iniciarTurnoDoAgente`/`finalizarTurnoDoAgente`/`cancelarTurnoOtimista`)
followed by the extraction of state + effect of the Phoenix channel into the hook
`useTurnoDoAgente` (`lib/session-turno.ts`) — closes the item ADR 0122
left declared open; `ProjectSettingsTab.tsx` remains out, a separate
decision

### `ProjectSettingsTab.tsx` by section (ADR 0125) {#projectsettingstabtsx-por-seção-adr-0125}
2,532 → 77 lines; the 17 sections become one file each under `routes/settings/`
(+ `shared.ts` with the TWO helpers with more than one caller), and the old file
stays on the path as an entry and barrel — the path and the 11 exported names are
the contract of 3 tests. Closes the LAST half of the debt line in
`docs/architecture.md`

### The project's vertical navigation rail (ADR 0126, RN-201) {#trilho-vertical-de-navegação-do-projeto-adr-0126-rn-201}
The two-level horizontal ruler (`GroupedTabs`) becomes a vertical rail with
the THREE groups open at the same time; geometry of the `CodeShell` rail,
keyboard ported, the 5 counters remain separate. Revises RN-201: the
Code tab no longer collapses the sidebar on its own

### Anchored Settings table of contents (CHANGELOG) {#sumário-ancorado-de-configurações-changelog}
The tab's 17 sections get an `id`, a `<section>` with an accessible name and a table of contents
in four groups INSIDE the content area — no new vertical strip, the frame
stays at the 444px of ADR 0126. Registry in `routes/settings/sumario.ts`
(the third list of the same design as `project-tabs.ts`), deep link `?section=`,
spy by `IntersectionObserver`; only a section that MOUNTED enters the table of contents

### A single pattern for an inherited value (CHANGELOG) {#padrão-único-de-valor-herdado-changelog}
The FOUR wordings of "has no value of its own" in the Settings tab become two
poles and a verb, from a single source (`routes/settings/heranca.tsx`): the label says
the STATE, the detail says the CONSEQUENCE. Vocabulary unified, shape not — the
mark only goes where the control doesn't show the state on its own

### Save by section in Settings (RN-469) {#salvar-por-seção-em-configurações-rn-469}
Parallelism and Spend ceiling swap N row buttons for ONE for the section
(`settings/secao-salvavel.tsx`), with a count of pending rows and an outcome
PER ROW — saving is N calls, not a transaction, and the screen never asserts what
it didn't get. The three autosave sections and Credentials stay out, each
one for a declared reason

### The "needs you" panel (RN-467) {#painel-precisa-de-você-rn-467}
A chip at the top of the project opens the FIVE decision queues in a single place —
separated, ordered by urgency, with no sum at all (not even on the chip). Approvals
and merges are decided there through the `ApprovalCard`; the other three lead to the tab.
An architecture pending item borrows the story's date and SAYS it borrowed it

### The model cascade as a visible chain (RN-470) {#cascata-de-modelo-como-cadeia-visível-rn-470}
The Origin column stops printing the database enum and becomes `workspace › projeto ›
área › agente` with four states per node (`settings/cascata.tsx`) — separating
the TWO meanings of `origin: 'agent'` without touching the api. The warning of a
discarded level enters the chain; the three `—` get three texts. Closes the
UI improvements canvas (7 of 7 items taken)

### Folder before the runner (RN-473/474) {#pasta-antes-do-runner-rn-473474}
The runner configuration through the browser (ADR 0118) inverts the order:
`showDirectoryPicker` is the FIRST step and the binary the LAST, best-effort — a
release without the asset returned 502 before the picker opened, and the folder became
unreachable. A binary failure keeps both written files and swaps the
instruction for the `npm install -g @brabo/runner` path. After the instruction,
`EsperaDoRunner` probes `workspaceVerifiedAt` with three states and a ceiling

### The `kid` in the device key (RN-475) {#o-kid-na-chave-de-dispositivo-rn-475}
ADR 0118's automatic mode NEVER authenticated: the browser discarded the `id`
the registration returned, and the written JWK was born without a `kid` — the CLI refused it
always. Registration and export become ONE function
(`registrarChaveEExportarPrivada`), on BOTH paths; and the CLI's refusal stops
being indistinguishable from "there is no key". The test that let it pass asserted
that the file had been OPENED, never its content

### Provisioning that doesn't stay silent (RN-477) {#provisionamento-que-não-fica-calado-rn-477}
Two failures didn't become any state — `step.check` outside the `try` and the refusal
of `createRepo` BEFORE the bootstrap row existed —, and the screen polled
"Starting…" forever without a button. Root cause of it all: `/data/git-repos` and
`/data/project-workspaces` were born `root` in the DEV images, which
`Dockerfile.prod` already knew how to create before `USER`

### The policy file and the terminal scope (RN-478) {#o-arquivo-de-política-e-o-escopo-do-terminal-rn-478}
`projectScopeRoot` had TWO consumers with opposite needs, and the
`runner` mode (without a bind-mount) separated them: the scope keeps pointing at the HOST, the
`permissions.json` now lives in the MANAGED root. Execution activation
returned 500 (`mkdir '/home/<usuario>'`), and the READ degraded silently — in a
`runner` project the file never existed. Along with it: a typed error with 400 instead of a
raw `Error`, the Overview no longer swallowing the api's message, and the OpenAPI
annotation that promised 409 for two cases that were never 409

### Warning about the human step before the click (RN-473/477) {#aviso-do-passo-humano-antes-do-clique-rn-473477}
The runner's terminal step was announced only in the success state; it now
is also said in the initial one, and the final command gets `cd <caminho>` when it can
be asserted that the chosen folder is the project's. The button label does NOT change —
it talks about the folder, which really is automatic

### One model for all agents (RN-476) {#um-modelo-para-todos-os-agentes-rn-476}
The `Modelos por agente` table gets a bar that applies ONE model to all 17
at once, writing at the AGENT level (through the project it would be `maintainer`, and
it would touch the session default). The first EXCEPTION to RN-469's "a named value saves
on `onChange`" rule — the selector is an action argument, not configuration —,
with RN-469's own three-state outcome

### Demotion ceilings in `project_members` (ADR 0127, RN-472) {#tetos-de-rebaixamento-em-project_members-adr-0127-rn-472}
The `projectRole ?? workspaceRole` override STAYS in both directions (it's a
capability, not a bug); what comes in are two 403 ceilings in the use case —
nobody demotes the workspace `owner`, nobody demotes themselves. The three
OpenAPI descriptions that RN-471 declared false now describe the
code; the `Select` gate is a separate PR, because the screen has no way to compute the
first ceiling

### RAG search telemetry (RN-479..481) {#telemetria-de-busca-do-rag-rn-479481}
The hybrid search leaves a trail: `rag_searches` (with the weights FROZEN in the
row) and `rag_feedback` (the useful/irrelevant vote, the only real signal).
A TABLE and not just an event, because `session_events.session_id` is `NOT NULL` and the
tab's search has no session — the `rag.search`/`rag.feedback` event is NARRATION,
only when there is a session. A `rag_feedback` tool (`:direct`) in the six agents
that already had `rag_search`, and `medir:rag` to read it. NOTHING calibrated — this
stage only instruments

### Container broker (ADR 0130, RN-485/486) {#broker-de-container-adr-0130-rn-485486}
`apps/broker` is born, the ONLY process that talks to a Docker daemon on the
server — and it does NOT accept a specification: it receives `projectId` + operation, READS the
Arquiteto's decision from the api and COMPOSES image, network, resources and the single mount. The
ADR 0128 port MOVES from `apps/runner/src/` to `packages/docker-port` (both
consumers bundle it; the api can't consume it). The lifecycle
route now returns observed alongside registered, without merging them

### Routing modules to infra (PR 1.4) (ADR 0131, RN-487) {#roteamento-de-módulos-para-infra-pr-14-adr-0131-rn-487}
The Arquiteto's seventh tool, `route_modules_to_infra`: one item `{modulo,
imagemCandidata, porque}` per module of the current `module_map`, written as
`artifact.module_routing` (no table, the same design as
`artifact.project_image`/`artifact.c4_diagram`). It NOMINATES — the image of
each item goes through the same `validarDecisaoDeImagem` as `choose_project_image`
—, and whoever ELECTS among the candidates is Infra, in a separate PR (1.5, closed
just below)

### The RAG accuracy golden set (ADR 0132, RN-490) {#golden-set-de-acerto-do-rag-adr-0132-rn-490}
The QA golden-set mold (ADR 0123) applied to the hybrid search: since the
judgment doesn't live in the engine (it is `HybridSearchUseCase`, in the api),
`seed-golden-set-rag.ts` provisions ONE project with a real curated corpus (22
files from `docs/`) AND runs the search for 17 questions composed from real
RNs/ADRs; `rag_golden_test.exs` only invokes the script and applies the floor. The hit
criterion — file path, top-5, never exact chunk/rank 1 — is a tested pure
function. A new `rag-acertivo` gate, `warn` (no CI with an LLM). Actually measured,
twice, deterministically: 17/17 in the top-5

### Dev agents execute INSIDE the real container (PR 1.6) (ADR 0134, RN-492/493) {#dev-agents-executam-dentro-do-container-real-pr-16-adr-0134-rn-492493}
It closes what RN-491 declared pending: `Engine.Actions.TerminalExecutor`
gets the FIFTH outcome, `:executar_no_container` — an `execution_mode:
container` project with a REGISTERED `running` row
(`Engine.Containers.ProjectContainerLifecycle`, a direct read, the same pattern
as `Engine.Projects.Project`) — and the command crosses engine → api (`POST
internal/projects/:projectId/container-exec`,
`ExecutarComandoNoContainerUseCase`) → broker (`ContainerBrokerPort.exec`, the
FIRST real caller of the last of the five operations of ADR 0128/0130),
running via `docker exec` instead of a local `System.cmd`. `cwd` is translated from the
HOST path to inside `/work` in the engine, BEFORE the call — confirmed
in code to be the SAME physical directory `Workspace.ensure!/4` already writes
(the dev agent's worktree changes neither place nor mechanism).
`BrokerRecusouError`/`BrokerIndisponivelError`/a transport failure become a
normal `failed_result`, never a crash nor a silent fallback outside the
container (RN-486: a registered `running` never guarantees the container is up).
A terminal INSIDE the container gets an auto-approval FLOOR
(`ProposeActionUseCase`/`decide.ts`, `containerExecutionActive`) — the five
absolute ceilings and the usual lexical scope keep running on top, byte for
byte

### The runner brings up the project's container (PR 1.3, Part 1 out of order — closes the half that RN-494/PR 1.7 had left declared) (ADR 0137, RN-497) {#o-runner-sobe-o-container-do-projeto-pr-13-parte-1-fora-de-ordem--fecha-a-metade-que-a-rn-494pr-17-tinha-deixado-declarada-adr-0137-rn-497}
`container_start`/`container_stop`/`container_remove` get a SECOND execution
path, branched by `executionMode`: `container` keeps going through the broker
(unchanged); `mounted`/`runner` now ask the connected RUNNER, through THREE
new pairs on the Phoenix channel (`container_start`/`_result`,
`container_stop`/`_result`, `container_remove`/`_result`, the same mold as
`exec`/`exec_result`) — `EngineWeb.ContainerCommandController` passes it on to the
`RunnerRouter`, which the runner serves with `DockerViaCli` (ITS Docker,
`@brabo/docker-port`, which gets real use beyond `--self-test-docker`). The
image is READ (`ObterSpecDeContainerUseCase`, the same use case as the broker's),
never re-elected. "No runner"/"timeout" (`RunnerNaoConectadoError`) and "runner
refused" (`RunnerRecusouContainerError`) become a named `failed`, never an
exception. `Engine.Actions.TerminalExecutor` didn't get a new outcome — it already
routed every command of a connected `runner` project to the channel
unconditionally; the host-vs-container choice is INTERNAL to the runner
(`EstadoDoRunner.containerAtivo`, `tratarExec` routes via `docker exec` with
`cwd` translated by prefix swapping, `cwdParaContainer`). `guard.ts`/RN-434
now covers the bind-mount without ANY new validation — the mount IS the root already
confirmed at the CLI's startup

### The Infra handoff could be accepted by no screen at all (D0) (RN-499) {#o-handoff-da-infra-podia-ser-aceito-por-tela-nenhuma-d0-rn-499}
`offeredHandoff` filters the thread's card by `AGENTES_DE_CHAT`, which excludes
`infra` — and the filter is RIGHT (the engine has no `message` clause for the
Infra Lead; widening it would make the screen offer a thread that doesn't exist and the composer
send a message to the Criativo). The defect was the consequence, which the code's own
comment recorded as accepted: `acceptHandoff` had ONE consumer
only, behind that filter, so the `OfferInfraHandoffUseCase` handoff stayed
`offered` forever, the Infra Lead was never activated,
`propose_container_start` was never called and NO project in any mode
ever got a container up. Fix: its OWN actionable card, outside the thread,
on the fixed strip between the scrolling area and the composer — the same one that already hosts the
manual handoff and declares itself the place for handoff actions that aren't conversation
—, calling the `acceptHandoff` that already existed, closed by the same `activeFor`.
The Infra `handoff.offered` remains NARRATED in the thread as a mute divider

### The single base of mounted projects (PR 1, BREAKING) (ADR 0141, RN-500) {#a-base-única-dos-projetos-montados-pr-1-breaking-adr-0141-rn-500}
Creating a `mounted` project required a bind-mount line written BY HAND in `api`
AND `engine` plus a restart of both — which kills every agent turn, terminal
socket and LLM call in flight in the installation, to onboard ONE project.
`BRABO_PROJECTS_BASE` is born: ONE base, configured once by the operator,
mounted by IDENTITY (`$X:$X`) in both services, with all mounted projects
inside it and NOTHING edited per project. Identity and not a fixed mountpoint
because `workspace_path` is typed by the user and shown back to them
— and it is what keeps `projectScopeRoot`/`workspace_dir/2` correct without
new code. Its OWN variable (a namespace collision with the UNIQUE `workspace_dir_name`
would `git init` in another project's folder; opposite owner; the base is
browsable and the managed root shouldn't be). ABSENT is normal: `projectsBase:
null` (`GET workspaces/:id/projects-base`, `maintainer`) and the mode isn't
offered. And `pnpm dev` REFUSES to start with the base overlapping the checkout — the
only possible check, because the api compares against `/workspace`. Two declared
costs: a symlink under the base and a single base

### Container for a mounted project (PR 3) (ADR 0144, RN-503) {#container-de-projeto-montado-pr-3-adr-0144-rn-503}
A `mounted` project couldn't get ANY container, because of two independent
blocks — the api sent every non-`container` mode to the RUNNER (which requires
a connected `brabo-runner`) and the broker refused non-`container` at the source. The
two were about GEOMETRY, not the mode's name, and ADR
0141's single base changed the geometry. The branching becomes by DESTINATION: `container` AND
`mounted` → broker, only `runner` → runner (and `container_stop`/`_remove` change
TOGETHER with `_start`, otherwise it comes up on the server and stops on the user's machine). The
ADR 0130 invariant doesn't move — no absolute path crosses the network:
the broker gets a SECOND root (`BRABO_PROJECTS_HOST_BASE`) and the api sends a
DISCRIMINATED locator (`gerenciada` \|`montada` \|`indisponivel`) saying
against which root the relative segment applies. THREE variants because
`indisponivel` has two different fixes (`runner` × a legacy `mounted` outside
the base), and a missing root is NEVER supplied by the other one. `mounted` ELECTS the
image like `container` — the broker composes from `artifact.project_image`, so an
unrecorded election is an inert election (ADR 0133 in a second mode)

### Dev agents only after the container (PR 7) (ADR 0143, RN-502) {#agentes-de-dev-só-depois-do-container-pr-7-adr-0143-rn-502}
In a real run of `exp001`, TEN dev tasks got stuck at once — and the
finding wasn't the folder that failed, it was that **nothing ordered container before
dev agent**. `Engine.Dev.AgentIo.try_claim/2` — the SINGLE claim point — now
queries `ProjectContainerLifecycle.running?/1` (the predicate ADR 0134
already had) BEFORE calling the api: without a REGISTERED `running` row, the agent falls
into `:idle`, persists and emits `dev.blocked_by_container`. In the ENGINE and not only in the
api's `activate-execution` because REHYDRATION reaches `try_claim/2` without
going through any route (`init/1` → `finish_restart_recovery/1`). `:idle` and
NOT a new status, for the reason `try_claim/2`'s own docblock already
recorded since Fase 12b — it is the only state from which a wake still rescues,
and all the guards of `handle_info/2` rely on that; whoever distinguishes "empty
queue" from "no container" is the EVENT, never the status. The wake comes through the outbox:
`RegistrarTransicaoDeContainerUseCase` publishes `container.running` in the SAME
transaction that writes the arrival at `running`, in a NEW `aggregate_type`
(`container`, the third one `Engine.Outbox.Drain` reads) instead of borrowing `task`,
with the PROJECT as the `aggregateId`; the message delivered is the `{:wake,
:became_claimable}` that already existed. Second half: `TerminalExecutor` stops
degrading silently — `container` without `running` fell into `System.cmd` INSIDE the
engine process, and now it REFUSES, with `mounted` in the same branch

### A pipeline merge alarm with a recipient (ADR 0139) {#alarme-de-merge-de-esteira-com-destinatário-adr-0139}
The rule "promotion is `--no-ff`" was broken THREE times (#367, #394, #464 — the
third was the PR that fixed the first two). The finding: the detection ALREADY
existed and ALREADY worked (`tag-release` failed the first two with the
right message) — what was missing was WHOM to ring, because a `push` workflow that fails
on a permanent branch has no PR to go red on and the repo had zero issues.
`tag-release` gets the `avisar` job, which opens an issue (and comments on the already open one,
never duplicates) with `github.token` and never with the PAT — an invalid PAT is one of the
failures it reports — and that stopped being hypothetical: the `BRABO_BOT_TOKEN`
expired on 2026-09-03 at night, failed two `tag-release` runs, and was
rotated on 2026-09-04; v4.0.0 stamped and TRIGGERED the Release, which only
happens with a valid PAT (a tag created with `GITHUB_TOKEN` doesn't trigger a workflow).
The rule now covers `dev` NARROWLY: the only defect is a PR that brought a
NEW EDGE (head was a merge whose second parent wasn't in the base), never the
squash of a work PR, which is the convention. Turning off squash in the repo was
MEASURED and refused (it would tax every PR and touch `changelog.mjs`, which runs
`--no-merges`)

### The conversational agents' decision artifact (Front 3, generic slice) (RN-505) {#o-artefato-de-decisão-dos-conversacionais-frente-3-fatia-genérica-rn-505}
`decision_record` reuses the GENERIC pattern of `emit_artifact`/`ArtifactSchemas`
(the same as `note`/`business_rule`) instead of the dedicated one of
`project_image`/`c4_diagram` — a decision is an append-only log, never a
"current" one that gets replaced. PO, Arquiteto, Dev Lead, UX Designer and Staff
get the tool (alias + `tool_specs` + `run_tool/3` + the same sentence in
`system_prompt/1`); the Criativo already had `emit_artifact` since Fase 3b and only
got the new type, with no change to it. Distinct from `open_adr_pr` (only the
Arquiteto, a real commit + PR + human approval): the two COEXIST for
different scales of decision. Out of scope, declared: execution agents
(`ToolLoop`, without a common harness) and the tie-in with the Infra Lead — emitting
`decision_record` when proposing `container_start_via_runner` — which depends on a
tool from another front of the same plan, in a separate branch

### "Always allow" separated per module Dev Agent (RN-509) {#sempre-permitir-separado-por-dev-agent-de-módulo-rn-509}
Clicking "always allow" on an action of a `dev-<modulo>` wrote to
`permissions.json`, the WHOLE PROJECT scope — it released the same command for
any other agent. It now writes to `agent_autonomy(projeto, agente,
tipo)`, the SAME mechanism already used for the 3 git actions seeded on execution
activation. `dev-lead` (leads the area, isn't a member of it) and any
non-modular actor keep going to the usual `permissions.json`; the two absolute
ceilings (a terminal with an external effect/privileged command,
`container_remove`) keep refusing the whole click BEFORE the new branch.
No migration: old entries remain in `permissions.json`, a conscious
decision

### Docker becomes a real prerequisite of Runner mode (RN-507/508, ADR 0145) {#docker-vira-pré-requisito-real-do-modo-runner-rn-507508-adr-0145}
`runner` routed every approved terminal to the CLI as soon as a verified workspace
+ connected runner matched, without checking for a `running` container — without Docker up,
the runner fell on its own to the pure HOST, the SAME silent fallback that ADR 0143
had already closed for `container`/`mounted`. `Engine.Runners.RunnerReadiness`
unifies the THREE preconditions (verified, connected, `running` container) with
two consumers: `TerminalExecutor` and the materialization of the dev
agent's worktree, which stops trying a LOCAL `File.mkdir_p!`/`git init` against the
HOST path (the gap open since RN-478) and starts running INSIDE the real
container, on the user's machine, through the SAME `exec`/`exec_result` channel
(`Engine.Actions.Workspace.RunnerGit`, new) — `WorktreeManager` forks by the
same criterion, and the periodic cleanup job silently SKIPS a
`runner` project without a ready runner now. The `exec` protocol gets an optional `env` for
the git credential (ADR 0056) to travel in the environment of the HOST's child process —
merged over `process.env`, never passed on to `docker exec` nor logged.
`container_start` stops serving `runner` (its payload, with image
election, never made sense there); `container_start_via_runner` is born — a schema
with only `rationale`, it brings up the already decided image —, with the Infra Lead's new tool
refusing LOCALLY (without HTTP) before proposing blindly

### RN-505 duplicated in dev, fixed {#rn-505-duplicada-em-dev-corrigida}
The "decision artifact" and the "always allow per Dev Agent" merged 2
minutes apart, each one allocating RN-505 without seeing the other; "always
allow per Dev Agent" was renumbered to RN-509 (`docs/business-rules.md`,
CHANGELOG, the comment in `approve-always-action.use-case.ts` and in
`ApprovalCard.test.tsx`), freeing the `{#rn-505}` anchor for the
`decision_record`. Found along with it: the 505→507/506→508 renumbering done during the
conflict resolution of another PR (Docker/runner, ADR 0145) had been left
INCOMPLETE — three mentions of "RN-505" remained in this very file, also
fixed to "RN-507"

### FASE 28 (session 5) — the local agent's `join` stops being mute (RN-514, ADR 0147 point 1) {#fase-28-sessão-5--o-join-do-agente-local-deixa-de-ser-mudo-rn-514-adr-0147-ponto-1}
The `join` of the `terminal:<projectId>` channel was mute on BOTH sides — the runner
sent `{}` and the server did `_params` —, so the server had no way to
know whether the binary on the other side understands a new message, and the defect was the
worst possible: the message arrives, the handler doesn't exist and NOTHING happens, without
error and without log. Now the runner DECLARES in the params
(`Engine.Runners.Capacidades`, vocabulary `exec`/`pty`/`espelho`) and the
server GRANTS the intersection with what it KNOWS, in `socket.assigns` and NEVER
in a table (a capability is a property of that CONNECTION). The runner declares only
`exec` and `pty` — declaring `espelho` without implementing it is exactly the defect
the negotiation prevents; it comes in as a vocabulary NAME and nothing more, and
session 6 implements it. Absent/empty params are the LEGACY binary and grant
`{exec, pty}` — a FACT, not benevolence: they are the two functions the runner
was born with, and refusing legacy would be `breaking/` and MAJOR. Unknown is IGNORED
(a runner NEWER than the engine connects); required-and-not-declared refuses the join
NAMING the missing one, BEFORE the `Registry` — a mechanism implemented and tested
that today does NOT fire (`runner` requires `exec`, which every binary has; nothing requires
`espelho` yet), and that is the design. The half that delivers value TODAY:
a message without the capability is REFUSED with a named reply — `exec` replies in the
`exec_result` format (126 + cause) instead of the `RunnerRouter` waiting for the
timeout, and `pty_*` becomes `pty_error` in the tab instead of vanishing. `RunnerReadiness`
byte for byte as it is

### FASE 28 (session 6, half B) — the mirror comes into existence (RN-516, ADR 0147 points 2/3/4/8) {#fase-28-sessão-6-metade-b--o-espelho-passa-a-existir-rn-516-adr-0147-pontos-2348}
The `espelho` capability goes from a vocabulary name to code on BOTH
sides. The DESTINATION travels in the `join` GRANT (the reply stops being empty
for `:runner`: `%{espelho: %{destino: ...}}`), lives only in that connection and the
runner REFUSES `mirror_sync` for a destination not granted — never global
configuration nor a variable, which would make project B's artifact land in project
A's folder. A non-null `mirror_path` now REQUIRES the capability, and that is the FIRST
real firing of RN-514's refusal mechanism: an old binary in a project with a
destination STOPS connecting, named and fatal — opt-in, cost declared in the ADR.
`espelho-guard.ts` is born a SIBLING of `guard.ts` (reuses the three helpers and the double
pass, inherits the TOCTOU caveat in writing) and refuses the ADR's three
things; a finding while implementing: `realpathMaisProximo` falls back to the ancestor, and since the
destination almost never exists, collapsing both sides would make `/base-outra` and
`/base` become `/` — the second pass resolves the ancestor and PUTS BACK the
suffix. ONE direction and it NEVER deletes: a file deleted at the origin STAYS at the
destination (the user's folder is accumulation, not a replica). What gets copied is the GIT
LIST (tracked + untracked-not-ignored), with no exclusion list
of its own; a failing git becomes a NAMED error, never a fallback `cp -r`; a nested git
repo (the dev agent's worktree) comes back as ONE entry and isn't descended into, and
a symlink at the origin is skipped. Its OWN predicate (`Engine.Runners.Espelho`), TWO
preconditions and NEVER `RunnerReadiness` with a flag — `runner_readiness.ex` stays
byte for byte. Trigger: the COMMIT, a named moment, fire-and-forget and never a
watcher; "end of an agent turn" stays DECLARED and not wired, because there is no
unambiguous hook

### The broker that never came up (fix of RN-512) (RN-512, ADR 0130/0146) {#o-broker-que-nunca-subiu-correção-da-rn-512-rn-512-adr-01300146}
RN-512 took the broker out of `profiles` so it would be up in dev, and it NEVER
came up: `corepack prepare` ran as ROOT at build (cache in `/root/.cache`),
the container runs as uid 1000, and without a cache corepack tries to DOWNLOAD pnpm in a
service whose only network is `internal: true` — `EAI_AGAIN registry.npmjs.org`,
`Exited (1)` five seconds later. Without a healthcheck, `up --wait` said
`Healthy` and the reset total announced "reset complete" with the process dead;
while there was a profile, whoever brought up the broker was someone already watching it. The
fix takes the registry out of RUNTIME and does NOT open the network (the first of the five
layers of ADR 0130): `COREPACK_HOME` prepared at build with the runtime uid's
owner, `pnpm install` as a BUILD step, and — because the three
`node_modules` volumes cover what the image installed and Docker only seeds an EMPTY
volume — an entrypoint that reconciles them against a copy outside `/workspace`,
stamped with the sha256 of the build's lockfile (the same stamp WARNS that the image
fell behind, without refusing to start). A healthcheck on the service, from inside the
container. Production didn't suffer from this and doesn't change

### FASE 28 (session 7) — the local agent becomes a user service (RN-518, ADR 0147 point 5) {#fase-28-sessão-7--o-agente-local-vira-serviço-de-usuário-rn-518-adr-0147-ponto-5}
`brabo-runner service install|uninstall|status`, and the precedent was ZERO
(no mention of `systemd`/`launchd` in `apps/runner/`; the model was
foreground killed by SIGINT). USER level always — `systemd
--user`/`LaunchAgent` —, and root is a REFUSAL, not a warning: `guard.ts`'s docblock
declares "runs with HIS privileges" as the premise of the three real
boundaries, and a root service would leave the best-effort `cwd` guard as the only
thing between an approved command and the disk. Windows is a NAMED refusal (a third
mechanism, not a variation of the two). One unit per PROJECT because the server already
enforces one runner per project — naming by folder would create two units that never
come up together, and the second would appear as a connection failure instead of an
installation error; on Linux the file goes where systemd LOOKS
(`$XDG_CONFIG_HOME/systemd/user`, otherwise `~/.config`). `Restart=on-abnormal` and
NEVER `on-failure` (in the plist, `KeepAlive`/`Crashed`): the runner's exit 1 is a
fatal join refusal (RN-514) or an exhausted attempt ceiling, and restarting
would be the loop the CLI refuses to do on its own. The service authenticates by DEVICE
KEY and never by token — writing it into a unit would leave it on disk, and this
CLI never wrote a credential to disk. `uninstall` removes the THREE by reading the
UNIT's folder and never the `cwd` (without a unit, only with `--dir` — guessing would delete
another project's key), and SAYS that the key left the disk and was NOT revoked on the
server. `status` answers FOUR states with their own sentence and code
(0/3/4/5), and the first answer comes from DISK — that's why it stays right on a
machine without a manager; a failed `spawn` never becomes "the manager said
no". BRB-031 does NOT close here

### The runner's spec went without `projectId`, and the path NEVER brought up a container (RN-508, ADR 0145) {#a-spec-do-runner-ia-sem-projectid-e-o-caminho-nunca-subiu-container-rn-508-adr-0145}
`container_start_via_runner` (RN-508, ADR 0145) ended `failed` 100% of the
time — *"container specification refused at `projectId`: expected non-empty
text, got undefined"* —, and in a real run of `exp004` what was seen
was the EFFECT: ten dev tasks with no agent claiming them. That block
was RIGHT (RN-507 and RN-502/ADR 0143 refuse without a REGISTERED `running`
container); what was wrong was the previous step.
`EspecificacaoDeContainerParaRunner` was born with NINE fields and
`especificacaoValidada` (`packages/docker-port`) always required TEN — the data
was at hand in `SpecDeContainer.projectId` and simply wasn't copied; the engine
passes the map on OPAQUELY, so nothing was lost in the middle. By contrast the
BROKER always worked because it FETCHES the spec from the api and receives the
whole `SpecDeContainer` — that's why only `runner` mode broke. Three
green suites didn't catch it because each link built its own fixture: nobody
tested the CHAIN. It comes in — the payload the REAL use case composes
crossing the REAL validator, and the SET of fields locked (`raizDoProjeto`
is the only one the api doesn't send) — in the api suite, through a RELATIVE import, the only
place where both sides exist alive; the
`api-nao-consome-docker-port` invariant stays green and was EXTENDED to fail a relative
import from `src/`. Siblings checked and RIGHT:
`container_stop`/`container_remove` send only `workspaceDirName`, which is all
that `nomeDeWorkspaceValidado` asks for

### The pause that couldn't be undone (RN-540) {#a-pausa-que-não-podia-ser-desfeita-rn-540}
Anamnese and Psicólogo had been PAUSED since 2026-08-10 and three places called
the pause reversible — the docblocks of
`AnamneseSchedulerWorker.enabled?/0`/`PsychologistWorker.enabled?/0` ("Turning
it back on is `X=true` and restarting the engine") and
`docs/reference/configuration.md`. It wasn't reversible in ANY environment: the
`environment:` of the `engine` service mapped the THIRTEEN
Anamnese/Psicólogo variables — all cost CEILINGS — and neither of the two PRODUCT ones, and
`docker compose` does NOT pass on the host's environment, so `ANAMNESE_ENABLED=true`
in `.env` was inert and `runtime.exs` fell back to the `"false"` default SILENTLY.
Measured in the dev container: `[true] [] []`. Likely origin: when the default
became `false`, nobody needed the variable to TURN IT OFF — only whoever tries to
TURN IT ON discovers the wire doesn't exist, months later. The EIGHT boolean flags
(`System.get_env("X", "true"|"false") == "true"`) go into BOTH composes with
the SAME default as the code — the four extra ones (`START_MODEL_SYNC`,
`START_GATE_RESCUE`, the two `GRAPH_*`) because they are the same defect, found
by the mechanism itself, and excepting them would require four excuses. Zero change
in behavior: the product decision to keep both off stays byte
for byte, what comes into existence is the SWITCH. The mechanism is
`scripts/ci/flags-do-engine-no-compose.spec.ts`, which DERIVES the list from
`runtime.exs` (the other 50 variables are ceilings with a good default and release
things, legitimately absent) and demands an equal default only in the DEV compose —
the production one turns off the background agents on purpose. `deploy/k8s/` does NOT
change, for coherence: the layer that breaks doesn't exist there

### FASE 29 (session 1) — one-line installation, planning only (ADR 0149-0152, fase-29-instalacao-de-uma-linha.md) {#fase-29-sessão-1--instalação-de-uma-linha-só-planejamento-adr-0149-0152-fase-29-instalacao-de-uma-linhamd}
Installing Brabo is THREE disconnected gestures (compose with five secrets by hand,
runner through the browser with `chmod +x`, `pnpm bootstrap` that only exists in a
checkout), and FASE 28 refused in writing the one-line installer while
the artifacts weren't signed (BRB-005) — that's why the phase signs BEFORE
installing. Four `Proposed` ADRs: keyless `cosign` signing by DIGEST plus
ONE signed `checksums.txt`, never five signatures (0149); the installer
invoked by `sh -c "$(curl …)"` and NEVER `curl|sh`, because with the pipe the script
IS the stdin and consent dies (0150); the runner's consented base,
reusing `dentroDoEscopo` and the per-SEGMENT loop refusal of
`espelho-guard.ts` instead of a fourth copy of the rule (0151); and
backup/restore against compose (0152). The measurement corrected FIVE points of the
original scope: `workspace.verified` does NOT exist (what exists is
`workspace_confirm`, and it is ONE-WAY), point 5 of ADR 0146 versions
`consentir-base.mjs` and not an `install.sh`, `docker-compose.prod.yml` doesn't
consume GHCR and declares itself a VALIDATION compose, `make test-restore` is a Kubernetes
path with a Postgres-only backup, and "one runner per project" is
enforced in FIVE independent places — which took the per-machine runner out of
this phase, to FASE 30. Its own finding: **`git_local_repos` isn't in any
backup**, and losing it is losing the code of the `local` projects.
`docs/reference/brb.md` is born — and the finding is that the BRB register **isn't the
repository's**: it lives in the maintainer's vault, with 33 items, and here only two ids
appeared in prose. Measuring: BRB-032 and BRB-033 describe defects that **no longer
reproduce**, and **BRB-004 isn't what the id suggests** — it asks for third-party images
by DIGEST, not the tag #419 pinned. The file here keeps the EVIDENCE
(measured state, `file:line`); the vault remains the owner of the finding. Range
RN-524..538 and ADRs 0149-0152, skipping what is IN FLIGHT: three collisions
observed at the same moment (ADR 0148 ×2, RN-522 ×2, RN-523 ×2), resolved
later by the DATE criterion — whoever allocated first kept the number, and the
branches of 08/09 became ADR 0153, RN-539 and RN-540

### FASE 29 (session 2) — the pipeline signs what it publishes (RN-524, ADR 0149) {#fase-29-sessão-2--a-esteira-assina-o-que-publica-rn-524-adr-0149}
The product signed **nothing**: `cosign`/`sigstore`/`attestation` didn't exist in
`.github/`, `scripts/` or `docker/`, and the only provenance was the
`--provenance` of the runner's **npm** package. `release.yml` published the four
images **without** `id-token: write`; `build-runner-binaries.yml` uploaded the five
binaries with `gh release upload` and nothing more — while the `sha256sum -c`s that
already existed verify **third-party** binaries, the pattern the repository
knew how to apply and never applied to itself. Now the images are signed by
**DIGEST** (never by tag, a moving pointer) and the binaries get **ONE**
signed `checksums.txt`, in a `checksums` job that waits for the matrix — not five
signatures, because whoever verifies four and forgets the fifth doesn't know they
forgot. The job is `if: always()` on purpose (`fail-fast: false` in the matrix) and
**names what the manifest doesn't cover**. Both workflows **verify before
publishing**. Keyless because of the house's history: a private key would be one more
CI secret, and a PAT has already expired silently (ADR 0139). A verification
procedure in the runbook, with the two `--certificate-*` flags **mandatory** —
without them `cosign` accepts a valid signature from ANYONE. Closes BRB-005
for images and binaries; left out, declared, are OS code-signing and the
download proxy

### FASE 29 (session 3) — the installer that doesn't install yet (RN-526, ADR 0150) {#fase-29-sessão-3--o-instalador-que-ainda-não-instala-rn-526-adr-0150}
`install.sh` is born at the ROOT, versioned and served by the Release. The form is `sh
-c "$(curl …)"` and **never** `curl|sh`, for a MECHANICAL reason: with the pipe, the
process's `stdin` IS the download, and every `read` reads bytes of the script itself or
hits EOF — an installer that doesn't ask would choose on its own where to create a folder
on someone's machine. It VERIFIES ITS OWN ORIGIN (the signature of RN-524's
`checksums.txt`, and its own hash INSIDE the verified manifest), with
`cosign` pinned and checked by `sha256sum` against the hash written in the script;
DETECTION names what it found before asking; without a TTY it reports and exits 0; and
it **never deletes a user folder** — the projects base and the mirror folder stay
outside any confirmation, by the mirror's rule (RN-516). A marker in
`$XDG_STATE_HOME/brabo/`, never in `~/.brabo/`, which is PER PROJECT. **It doesn't
install anything in this version, and SAYS so** instead of ending silently.
`--print-plan`/`--print-state` expose the decision without a TTY, without network and without effect
— the mold of `bootstrap.sh`'s `--print-commands`, tested the same way. Two bash
bugs found while running, both of the same kind: under `set -e`+`pipefail`, a `[
cond ] && assignment` that is false KILLS the script, and an `ls` that doesn't match
brings down the whole substitution — in a function whose normal case is "found
nothing". The repository ROOT wasn't covered by any docmap (the root globs
are literal names); the `instalador` rule is born

### FASE 29 (session 4) — the installation comes up from its own compose (RN-527, ADR 0150) {#fase-29-sessão-4--a-instalação-sobe-de-um-compose-próprio-rn-527-adr-0150}
`docker/docker-compose.install.yml` is born, GENERATED from the production one and
different in three points: the four images come from a **mandatory variable**
(`${BRABO_API_IMAGE:?…}` — with a default, a missing variable would bring up half the
stack with an image nobody chose, and the error would become strange behavior
instead of a refusal), **no `build:`** survives, and the **`broker` service does NOT
exist** because its image isn't published (the bake has four targets) — with
`--source=ghcr`, `mounted` doesn't bring up a container, and the compose SAYS so in the
`BROKER_URL` comment. `docker-compose.prod.yml` stays intact: it
declares itself a VALIDATION compose and is what `smoke.sh` uses building locally. The
cost of the two files is declared and the ceiling is MECHANICAL —
`composes-em-conformidade.spec.ts` fails an extra service/volume/port,
a surviving `build:` and a loosened third-party image. Two things from the plan
died on contact with the disk, for opposite reasons: **migrate isn't a step**
(compose chains `api`→`migrate-api` with `service_completed_successfully`,
and two places ordering migration would be two sources of the same truth) and **the
`smoke.sh` isn't reused** (it BUILDS what the installation downloaded by digest,
and tears down the stack at the end) — in its place, the installer ASKS before asserting,
hitting `/health` on both

### FASE 29 (session 6) — migrating requires a PROVEN backup (RN-530, ADR 0150/0152) {#fase-29-sessão-6--migrar-exige-backup-provado-rn-530-adr-01500152}
Installing over an existing installation **isn't offered** — either it migrates, or it
stops: `up` over another version's volumes is damage that gives no warning. The order is
backup → **PROVE** → ask → delete → install → restore, and the middle step
is what gives the installer the right to delete: a backup nobody
tried to restore is a file, and the time to find that out isn't after the
`down -v`. The proof runs `test-restore-compose.sh` (the SAME three validations
of ADR 0152); a backup or proof that fails stops the migration **without deleting anything**.
The destination is a HOST folder — the compose default is the `backup_local` volume,
which `down -v` would delete ALONG with what one wants to preserve. The Postgres dump
is NOT restored on its own over a populated database (it's destructive, and `brabo-restore`
never touches the origin); the local git repos are, because they would be born empty

### FASE 29 (session 7) — one base for both sides, and BRB-031 closes (RN-531, ADR 0150/0151) {#fase-29-sessão-7--uma-base-para-os-dois-lados-e-o-brb-031-fecha-rn-531-adr-01500151}
The installer asks for the base ONCE and writes it in BOTH places:
`BRABO_PROJECTS_BASE` in `.env` (server, ADR 0141) and the `base` field of
`runner.json` (local agent, RN-529) — what differs between `mounted` and `runner`
is WHO executes, not where the code lives, and two bases for the same folder would be
the collision ADR 0141 refused. A refusal in BOTH directions against the checkout,
and `~` isn't expanded on purpose (the value goes into a configuration file,
where `~` is read literally). The runner binary is checked against the
**same** `checksums.txt` the script already verified to check itself —
downloading it again would be two chances to get different manifests, and the
second wouldn't be verified — and installed with `install -m 0755`. **BRB-031
closes here**: it survived FASE 28 because the installation didn't come from a
versioned artifact, and whoever reached `service install` had already needed the
`chmod`. A Release without the platform's binary does NOT interrupt the installation

### FASE 29 (sessions 8-10) — the protocol, the picker and the E2E (RN-532..534, ADR 0149/0150/0151) {#fase-29-sessões-8-10--o-protocolo-o-picker-e-o-e2e-rn-532534-adr-014901500151}
**8 (RN-532)**: the `workspace_create`/`_result` pair is born in the mold of
`exec`/`exec_result`, and the confirmation REUSES the `workspace_confirm` that already
exists — no new write route, the engine still doesn't write the table.
The predicate is its OWN for a stronger reason than the mirror's: there the
third precondition would be **circular** — a `runner` project only has a
`running` container after the runner brings it up, and the container comes up ON the folder that
this message creates. The `workspace` capability is the only one whose declaration depends
on STATE (consented base), not on the binary's version. **9 (RN-533)**: the
picker goes back to reading the user's disk through `fs_list_dir`, and the decision NOT to
hide the mode without a runner is symmetric to RN-513, not contrary — there the api HAS a
signal and without a base the creation ends in 400; here there's no presence signal (
RN-521 already declares it), and hiding would be deciding "doesn't have" from "don't know".
Finding: the screen decided by matching the SENTENCE `'Nenhum runner conectado'` that lives
in an engine `.ex` — it became a discriminated reason. **10 (RN-534)**: the
`install.sh` enters the signed `checksums.txt` (without it the verification it
does of ITSELF was a dead letter) and is exercised on a clean machine, with a TTY
simulated by `script -qec` and never by a pipe — the pipe is what kills
consent. It does NOT run on PRs, for the same reason as the signature

### FASE 29 (session 8) — the local agent's base gets a consumer (RN-532, ADR 0151 points 3–6) {#fase-29-sessão-8--a-base-do-agente-local-ganha-um-consumidor-rn-532-adr-0151-pontos-36}
RN-529 built the BASE and declared in writing that nothing consumed it. In comes the
`workspace_create`/`workspace_create_result` pair, in the REQUEST WITH
REPLY mold of `exec`/`exec_result` — and NEVER in that of `workspace_confirm`, which is
ONE-WAY (`{:noreply, socket}`, pushes nothing back), a precision that
the phase had already recorded along with "`workspace.verified` does NOT exist". Only the
relative SEGMENT crosses the network (the invariant of ADR 0130/0144: whoever has the
root is whoever executes), and an ABSOLUTE segment is refused lexically. The confirmation
REUSES the `workspace_confirm` that already existed, and that is what saves a whole
front: **no new write route is born**, the engine still doesn't
write the table, and the only path that stamps `workspace_verified_at`
remains a single one — with ORDER as the mechanism (confirm BEFORE the result,
because both reach the same channel process in order and the
confirm handler is synchronous). The `workspace` capability enters the vocabulary IN THE SESSION
IN WHICH THE CODE COMES IN, on both sides — RN-514 made the opposite bet with
`espelho` and it only paid off because someone demanded it —, and it is the ONLY one of the
four whose declaration depends on the STATE of that execution: the runner only
declares it with a consented base, and it is through that line, and no other, that the
server KNOWS a base exists (the engine doesn't read the user's disk). NOBODY
requires it at join, on purpose: requiring it in `runner` would be `breaking/` and MAJOR
for a function that project may never use. Its OWN predicate
(`Engine.Runners.PastaDoProjeto`), TWO preconditions, `RunnerReadiness` byte
for byte — and here the third would be worse than unnecessary, it would be CIRCULAR: a
`runner` project only gets a `running` container after the runner brings it
up, and the container comes up on the folder this message exists to create.
It also doesn't ask about `workspace_verified_at` (here that's the RESULT) nor the
mode. The TWO preconditions are answered in different places because "consented
base" is a property of the CONNECTION (`socket.assigns`, never a table): the channel
refuses BEFORE pushing, with `motivo: "sem-base"` through the same `ref`, in the
format the module expects — never a timeout. Five named reasons that don't
collapse, idempotency with its OWN outcome (`ja-era-repositorio` is a success),
and `estado.dir` does NOT change. It isn't a `proposed_action` and no ceiling gets an exception

### FASE 29 (session 5) — the backup starts covering what hurts to lose (ADR 0152, RN-528) {#fase-29-sessão-5--o-backup-passa-a-cobrir-o-que-perder-dói-adr-0152-rn-528}
The backup covered ONE database and ran in ONE place: `make test-restore` is a
Kubernetes path (it requires `kubectl`, a cluster and the CronJob) and `docker-compose.prod.yml`
had NO `backup` service at all — migrating a compose installation had no
proven path. The decision starts by REFUSING the easy move ("back up
all the volumes") and CLASSIFYING the seven: `neo4j_data` and
`project_workspaces` are derived, `ollama_data` can be re-obtained,
`brabo_projects_base` is the user's — copying them gives an impression of coverage without
adding recovery. The sources of truth are TWO, and the finding is the second:
**`git_local_repos` wasn't in any backup**, and a project with the `local`
provider keeps its *bare* repo there — it isn't rebuildable from Postgres (the event log
keeps the NARRATIVE, not the git objects), so losing the volume is losing the
agents' code. The runbook's prose asserted the opposite ("the real
repositories live in GitHub/GitLab") and it is what explains the years without
coverage: it holds for `github`/`gitlab`, and for `local` there's no upstream. The
file's guarantee is DECLARED and smaller than a "snapshot" — consistency by
REFERENCE (git writes objects before moving the ref, and swaps the ref by atomic
rename), without a global instant and without `git fsck` (the image has no git, on
purpose); a concurrent `gc` becomes a FAILURE and not a partial file, with the `tar`
status captured in a FILE because in POSIX `sh` a pipe's status is that of the
last command. The five S3 variables stop being mandatory and become the
configuration of ONE destination (`BACKUP_DIR` chooses disk; absent, S3 — the
inference is what keeps the CronJob INTACT). `make test-restore-compose`
triggers a REAL backup and calls the SAME `brabo-restore` with the SAME three
validations: the WRAPPER changes, never the judgment, and
`deploy/k8s/test-restore.sh` stays INTACT (unifying would make the compose one
depend on `kubectl`); `restore.sh` still doesn't touch the ORIGIN database.
Restoring the repos is a SIBLING command (`brabo-restore-git`, verifies by default,
writes only with `--restaurar`) and not a phase of the other — two artifacts, two
judgments, and joining them would make a git failure fail the event log validation.
A finding while RUNNING, which reading wouldn't give: the volume is shared by three
images with different uids and carries the owner of whoever mounted it first (measured
`1000:1000`, mode 0755), while the image runs as uid 70 — the extraction
died halfway leaving the volume half done; now it refuses BEFORE the `tar`
naming `--user 0:0`, and what's extracted as root goes back to the DIRECTORY's owner,
otherwise the volume would come back intact and USELESS (api and engine, non-root, unable
to write to what was just restored). Neo4j gets REPROJECTION and
not backup — not built here (BRB-018): a migrated installation is born with the
graph EMPTY, a named degradation and not data loss (the RAG lives in pgvector,
inside the dump)

### FASE 30 — the machine's local agent (ADRs 0154/0155, RN-543..552, closes in session 8 with RN-549) {#fase-30--o-agente-local-da-máquina-adrs-01540155-rn-543552-fecha-na-sessão-8-com-a-rn-549}
FASE 29 delivered installing in one line and STOPPED at two points the
product itself already declared in writing: the local agent was still paired per
PROJECT (whoever wanted to use the installed binary went back to the browser to paste
a command into the terminal), and **nobody could get in** — the generated `.env` has
no email variable, `MAIL_TRANSPORT` falls to `log` and registration requires
verifying the email, so the way out was fishing the link from `docker compose logs api`.
Both were solved in the same place, and that's what made a single phase. The finding that
defined its SIZE came from re-measuring with `file:line` FASE
29's claim that "one runner per project is enforced in five places": **three of the
five didn't need to change**, because topic, socket id and ticket describe a
CONNECTION, and a process that opens N connections — one per project — satisfies them byte
for byte, preserving the refusal of a second runner on the same project, which is a real
guarantee and not an accident. **Nothing in the engine changed in the whole phase**, and that's what
kept `RunnerReadiness`, the mirror and `workspace_create` intact. What remained
was what belongs to the PROCESS: the credential (`runner_device_keys.project_id` becomes
nullable, RN-543 — and the listing starts returning the TWO kinds, marked,
otherwise a machine key would be invisible and permanent, the defect RN-519
closed, reborn) and the unit (RN-545, `service install --machine`, one per
machine, COEXISTING with the per-project ones). Two decisions contradicted the letter of the
ADRs and both were MEASURED: the unit's discriminator is the `--machine` flag and not
the absence of `--project` (`resolverProjeto` has two sources, and the normal path
is to run `install` without a flag from inside the folder the browser configured — taken
literally, the ADR would silently convert the installation of whoever already uses the product), and
`install` REFUSES when the other kind is already installed, without `--force`, because
the two together would be two processes competing for the same project. Session 6
would touch three workspaces at once and was SPLIT into three, with the two
disjoint pieces going out first and `install.sh` after them, as orchestrator and nothing
more. From that split came the phase's most interesting revision: with ZERO connections
the agent stopped EXITING and started WAITING, re-querying at 15s/30s/60s
(RN-550) — RN-544's argument against re-querying stays whole where it
holds (a list that comes back SMALLER is ambiguous, and bringing down a LIVE connection through ambiguity
trades a certain state for a guess), and with zero connections there's nothing to bring down; what
fell was the `exit 0` argument ("an active service that does nothing"),
because the process started doing something and SAYING it does. Measured: `Restart=on-abnormal`
**doesn't look at the exit code**, so no unit changed and the effect is that the machine one
is genuinely `active (running)`. The other piece (RN-551) closes "nobody CREATES a
machine key" from the agent's side, and the decision there is the CUT: the CLI does **not**
talk to the api, because whoever registers is the installer with the `BRABO_SERVICE_TOKEN`
— each side keeps a secret and neither sees the other's. From that follows the two-step
design, and from it follows the invariant: the `kid` IS the registration id and only exists
after it, so `create` writes a `.parcial` the reader ignores and
`finish` writes the real name — **the file the runner reads never exists without a
`kid`**, the defect of RN-475 made impossible by construction. The api half
(RN-552) declared the cost instead of hiding it: the credential is the service token,
and a leaked token can now MANUFACTURE a lasting credential — that's why three
containments live in the ROUTE and not in the text (there's no `userId` in the body; registering
REPLACES the owner's active machine keys in the same transaction, so a reinstalled
machine passes and a thousand keys are impossible by clause, with no number that
ages; and a JWK with `d` is refused by name). Session 6 (RN-547) chained the
five commands and fixed three rules: a middle link that fails undoes nothing, becomes a
named line in a final block and the script ALWAYS exits 0 (undoing would require deleting an
account and revoking a key, and there's no route for that nor should there be one the
installer calls on its own); idempotency is the HTTP CODE, and `409` is an EXPECTED
outcome and not a failure, with `000` handled apart so "the api didn't come up" isn't
read as "the api refused"; and the password travels through `curl`'s STDIN, never through
`argv`, because `/proc/<pid>/cmdline` is readable by any user on the machine.
A finding of that session: `--help` had been LYING for months (*"THIS VERSION INSTALLS
NOTHING"*) because it prints the header, which is a comment, and the rule forbidding
talk of "phase sessions" only read code lines. Session 7 (RN-548) gave
the kind marker a consumer, and the decision was one of HONESTY: with a key and without
a live connection — the most common case — the screen says the two things it knows and names
the two it doesn't (*a registered key isn't an agent running*, *the list belongs to your
ACCOUNT and not this browser*), `accent` tone and never `success`. Session 8
(RN-549) is the only one that could prove the whole, and it EXTENDED the workflow that
FASE 29 already had instead of creating a second one. Its central decision is the SIGNAL:
`perguntarEstado` maps `activating` to `rodando` — with reason —, so
`systemctl is-active` and `service status --machine` would give green to a process
that's going to die in two seconds; the chosen signal is the LINE the agent
writes when entering the wait, which only exists after it has read the key,
taken a ticket, talked to the api and received an EMPTY list, and which is a RECORDED FACT
and not a sampling of state. The outcome is proven through the API and not the
browser, because the subject of the claim is the AGENT and what it observes is
`GET /runner/projects` — a browser would create the project through the same route with one
more layer that fails for unrelated reasons, and the assertion would still be the
journal line. And the E2E stays OUT of `pull_request`, with the consequence
declared instead of hidden (**the PR that wrote it didn't run it**): opening
that door is giving the installer a way to skip the origin verification, which is
what ADR 0150 refuses — hence the half that runs on PRs being a TEST
(`scripts/dev/install-e2e.spec.ts`), guarding the two ways the workflow can
rot silently, the loosened gate and the rewritten `install.sh` sentence (which makes
the assertions not fail, but VANISH). Two defects showed up, both
invisible because the workflow had never run: the TTY answers started with
`nao-migrar`, which on a clean machine falls into the MARKER question and made the
script exit 0 saying "Nothing was written"; and the FINDING that stayed a finding — the
published `install.sh` **brings up nothing on its own on a clean machine**, because
`docker/docker-compose.install.yml` (with `./postgres/init.sql` along) isn't a
Release asset, doesn't enter the signed `checksums.txt` and it doesn't download it
anywhere, so whoever follows the runbook's `curl … install.sh` dies at "no
such file or directory" AFTER having already verified the signature and written the
`.env`. Fixing it means deciding between a signed asset and a clone, and it's a delivery of its own.
What the phase left DECLARED and not done: revocation still reaches
`{project, user}` and never `{key}`, and now it costs more (it brings down the agent in
ALL the projects of that machine); there's no screen to list and revoke a device
key, and the phase added a kind to list without building the screen — the
gap became LARGER, on purpose; one process per machine is a single point of
failure, the design's price; and `install --machine` still doesn't know whether the key
in that folder really is a machine one, because on disk both kinds are the same
file and whoever knows is the server

### The QA golden set measures again and runs on a schedule, weekly (AT-076/AT-149, ADR 0168) {#o-golden-set-do-qa-volta-a-medir-e-roda-agendado-semanal-at-076at-149-adr-0168}

Two deliveries, one human decision between them. AT-067 had measured that the
clock fit in an `ubuntu-latest` without a GPU and that the instrument didn't measure: since
RN-502 the `npm test` of a `container` project without a `running` container is
refused, and the seed never brought one up — 0/6 by construction. The maintainer chose
"path 1" and AT-076 delivered it: the seed brings up each case's container through the
PRODUCTION path (`module_map` → routing → `container_start` proposed by
Infra and approved by the owner → `ExecuteContainerStartUseCase` → broker → `running`
through the state machine), with `node:24.11.1-bookworm-slim` pinned by digest,
RN-502 intact, and a container that doesn't come up becoming a NAMED error that fails the
ExUnit (before, the body's `{:skip, _}` passed green silently). Two runs in CI
gave 3/6 and 3/6 against the 1/6 floor, with different cases, in 52 and 86 min of
job. AT-149 closed the cadence: WEEKLY (Saturday 01:17 UTC, plus
`workflow_dispatch`, never `pull_request`), in `golden-set-qa.yml`, in the mold of
`golden-set-rag.yml`. Weekly and not nightly because a run costs up to 86 min and
VARIES — the same total through different cases —, and once a week is enough for the floor
to flag a drop. `timeout-minutes: 150` for the worst measured case. The verdict is
the test's own; the workflow adds only two INSTRUMENT guards (the score
line must exist, and the event log can't have an RN-502 refusal) and, on
failure, prints the logs like the RAG one — no issue. The image to pull before the seed
is READ from the seed's constant, never from a second literal, because the broker's `docker run`
runs under the 30 s control ceiling (RN-604). The proof run, with a
temporary `push` trigger removed before the PR, was 36327281774: 3/6
again, zero RN-502 refusals, 10 min of `mix golden_set.qa` and 13 min 41 s of
job. Declared: the CI broker doesn't have the compose's five layers, the heartbeat
closes the seed's sessions while QA is still working on them (with no visible
effect), and a PR that touches the workflow doesn't run it.

### The Infra Lead converses through the composer (AT-141, ADR 0175, RN-617) {#o-infra-lead-conversa-pelo-composer-at-141-adr-0175-rn-617}

RN-584 (AT-098) removed the chat's default recipient and left the product
question in writing: does the Infra Lead converse? The maintainer said yes on
2026-09-27, with the condition RN-584 itself had set — the turn first.
The Infra Lead's turn ran ENTIRELY inside `handle_call`/`handle_cast`: without
acceptance, without "Stop", outside `TurnoOrfao`, with the loop's 14th step ending
silently and a 180 s ceiling smaller than the 225 s of the container `propose_action`
(RN-605). The kickoff, being a `cast`, didn't hold a click, but it held the process —
8.4 min measured in AT-089 —, and a message in the meantime would wait in the queue.
Stage 1 put the three turns (kickoff, gate correction, message) into
`TurnoAssincrono`, with the Workflows consolidation inside the Task; a gate
correction arriving with a turn in progress got a queue, because `TurnoAssincrono`
without `from` would discard it. Stage 2 gave `infra` the `message/2` clause
(the `agente_sem_conversa` refusal went away), the `via_for` of "Stop" and a place in
`AGENTES_DE_CHAT`; the acceptance of its handoff stayed in RN-499's own card, and
the thread card excludes it by name. `SOLO_CONVERSATIONAL_AGENTS` didn't change: the Infra
Lead is an area lead. Declared: it didn't get structured questions nor
backlog reading.

### Credentialed git runs on the runner's host, the code in the container (AT-116, ADR 0193, RN-676) {#o-git-credenciado-roda-no-host-do-runner-o-código-no-container-at-116-adr-0193-rn-676}

2026-10-01, round 36. RN-558 had closed the SILENCE half — the authenticated `git
fetch` in `runner` mode, with the container up, stopped running with
empty variables and started being refused with the mark
`credencial-nao-atravessa-o-container` — and declared the other half as a pending
ADR, because every known option touched the containment port of ADR 0130.
The owner's decision (01/10) chose the one that doesn't touch it: credentialed git operation
on the HOST, code in the container. Measured before: the engine's only `exec` with `env`
was `RunnerGit.fetch!/3`'s fetch; there was no credentialed `push` nor `clone`
through `exec` (the folder-creation clone already ran on the host, RN-532); and the folder is
the same on both sides (`estado.dir` mounted at `/work`). The chosen discriminator
was an explicit MARK from the engine (`gitCredenciado: true`, set only
by `RunnerRouter.exec_git_credenciado/5`), and not the `env` that already existed —
with `env` as the key, any command with `env` would escape the container. RN-558's
refusal survived shrunk, for `env` without the mark, and in practice
came to mean "runner older than ADR 0193". The proof is AT-111, on both
sides: on the runner, a real `git credential fill` and `git fetch origin` with
`GitAuth`'s helper succeed on the host with the container active; on the engine, the chain
through the real `TerminalChannel` ends in `{:ok, _}`. The ExUnit tests didn't run in the
delivery environment (`repo.hex.pm` 403) and were left for CI.

### The consultative session without an agent asks for an agent (AT-254, RN-682) {#a-consultiva-sem-agente-pede-um-agente-at-254-rn-682}

2026-10-01, round 36. In the real use of 29/09 a consultative session without an agent
answered "I don't have access to previous conversations": the message without a
recipient went to the SSE of `POST .../chat`, which sends the bound model only the
current text — no history, no system prompt — and writes the reply with the
model's name as the actor. The owner's decision (01/10) was to ask for an agent instead
of giving history to the free chat. Measured before: the screen was the only client of the
route (the `curl` printed by the seed is a development hint, in a creative
session), and the `SendChatMessageUseCase` use case had a second legitimate
consumer, the provider smokes, which use it as an end-to-end instrument
in a session without an agent. That's why the api's refusal lives in the ROUTE, in its own
guard, and the use case stayed intact. On the screen, the recipient line started
carrying the manual handoff's own selector when there's no agent — the same
usual gesture, now in the place where it is the only way for the message to have a
destination —, and the Criativo stayed off the list because the consultative session promises it
doesn't come in.

### Revocation targets the key, and not the `{project, user}` pair (AT-013, ADR 0201, RN-685) {#a-revogação-mira-a-chave-e-não-o-par-projeto-usuário-at-013-adr-0201-rn-685}

2026-10-01, round 36. RN-520 had made revocation reach the live
connection, with the `{project, user}` target because the credential's identity died
in `PatAuthGuard`; ADR 0154 put *"revocation by key"* among what it didn't
do, and PR #534 gave the machine key the same pair applied project by
project. AT-013 stayed blocked by scope and by decision until the owner
chose (01/10): by KEY, with an ADR, touching the engine. Measured before: the
ticket was born from `{userId, kind}`, the socket kept only project/user/kind,
and the channel compared the user — the same user's runner with a PAT or another
key fell along; the machine key's connection in a project outside the api's
list stayed up; a ticket issued before the revocation got in after it; and
revoking a PAT brought down nothing. Delivered: two nullable columns in the ticket
(an Ecto migration, the table is the engine's — Drizzle's journal stayed at `0068`),
the guard annotating the credential after authorizing, the socket id gaining the
kind and id of the credential, and a `runner/disconnect-credential` route that voids
the pending tickets and asks every runner in the cluster whether it was born from it. The
AT-013 prohibition (not ceasing to bring down what used to fall) became two transition
pieces: the legacy connection falls through the pair in the row's projects, and an engine
without the route makes the api go back to the pair. The pair stayed as the target of member
removal. The screen changed only the confirmation text (RN-561). The runner didn't change.
The ExUnit tests didn't run in the delivery environment (`repo.hex.pm` 403) and were left
for CI.

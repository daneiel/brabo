# Mission: first dogfooding — Bitbucket and Generic by the agents' own hand

Phase 10 delivers two git providers from the backlog — `BitbucketProvider`
and `GenericGitProvider` — and delivers alongside it the first real
execution of Brabo building production software. The software is Brabo
itself.

**The method is part of the scope.** This document is not an
implementation plan: it is the experiment's protocol. The agents do the
implementing, driven from inside the product. You observe. Deviating from
the protocol is a finding, not a shortcut.

This file is not a site page — `docs/missions/**` is excluded from the
Docusaurus build (`website/docusaurus.config.ts:186-187`), the same reason
`doc-mission.md` lives here. It is versioned working material, meant to be
read in the repository.

---

## What is being measured

Two things at once, and it matters not to conflate them:

1. **Does the product deliver?** Do the two providers exist at the end,
   passing the single contract suite?
2. **What is it like to live with it?** How many approval clicks per task.
   How many times you had to intervene by hand, and why. What it cost.
   Whether the QA Lead's consolidated verdict said something useful or was
   noise.

The second is the one you can't recover afterward. An agent hanging at
2am, unstuck on impulse and never recorded, is data lost forever. The
table in Part 4 exists for this.

---

## Non-negotiable principles

1. **A hang is a very high-value finding.** If the agents get stuck, the
   answer is **never** to open the editor and implement the provider from
   the outside. It is to record the hang with its origin (`infra` |
   `modelo` | `código` | `política`), unstick it via a **documented**
   intervention, and move on. An experiment that never hangs measures
   nothing.

2. **No instruction adjustment outside the Anamnese flow.** If an agent is
   misbehaving, that's a symptom to be observed — not a bug to be fixed by
   editing the prompt mid-course. The legitimate path is for the
   Psychologist to propose a hypothesis and for the Anamnese to turn it
   into a patch, which **you approve or deny**. Editing an instruction
   from the outside invalidates the whole loop, which is precisely one of
   the things under test.

3. **No product refactoring during the phase.** A finding becomes a
   prioritized backlog item at harvest time (Part 5), never an embedded
   fix. Fixing while measuring destroys the measurement.

4. **The repository's full pipeline applies fully to an agent's PR.**
   `pr-police`, `approval-ladder`, QA and SecOps gates. No exception, no
   bypass, no "it's just a test".

5. **Merge into a protected branch is always yours, manual.** This isn't a
   rule of the experiment — it's a product guarantee (`decide.ts:149-160`:
   a merge with a protected target is never auto-approvable, not by
   `agent_autonomy`, not by `permissions.json`). It's here just to make
   clear there's nothing to loosen.

6. **Don't invent a number at harvest time.** Every metric in Part 5 has
   to close against the event log. Whatever doesn't close goes in as "not
   measured", never as an estimate.

---

# PART 1 — SETUP

## 1.1 The blocker that shapes the setup

The original plan was to point a project inside Brabo at Brabo's own
repository. **The product doesn't know how to do that**, and the
discovery is the phase's first finding.

`ProvisionRepositoryUseCase` only has two paths: resume a repository
already persisted for that project, or call `provider.createRepo(...)` —
no condition, no alternative (`provision-repository.use-case.ts:144`). The
only provisioning route is
`POST projects/:projectId/git/:provider/repository`
(`git.controller.ts:159`), and the DTO only accepts `name`, `visibility`,
and `namespace`
(`apps/api/src/interfaces/http/git/dto/provision-repository.dto.ts`) —
there's no field for `externalId` or the URL of an existing repository.

The `getRepo` method, which would read someone else's repository by id,
exists on the provider (`github-provider.ts:82`) and **is not called by
any use case**. It's a dead capability for this flow.

Against a repository that already exists, `createRepo` raises
`GitRepoAlreadyExistsError` (`github-provider.ts:73`) — treated as an
error, never as an adoption opportunity.

And forcing the path would be worse than failing. The `protect_branches`
step of the bootstrap runs `updateBranchProtection` with
`enforce_admins: true` and `required_approving_review_count: 1`
(`github-provider.ts:170-175`), over the four branches of
`PROTECTED_BRANCH_NAMES` (`bootstrap-steps.ts:94`: `main`, `rc`, `qa`,
`dev`). This would **overwrite the Phase 6 protections** and could block
your own manual merge in a single-owner repository — a risk that
`docs/adr/0028-protecao-de-branch-divergencia-entre-providers.md:83-84`
already documents in prose. The bootstrap would also create an `rc`
branch (`bootstrap-steps.ts:195`) that Brabo's branch policy doesn't use.

## 1.2 The procedure: fork, manual seed, no bootstrap

**Decision:** the experiment runs against a **fork** of `brabo`, and the
provisioned-repository rows are inserted by hand, marked as converged.
Gitflow bootstrap **does not run**.

Why a fork and not a new repository through the wizard: a new repository
is born empty. The agents need Brabo's code to implement the providers
inside it, and they need the `pr-police`/`approval-ladder`/gate workflows
for principle 4 to hold. The fork gives all three for free — history,
`dev`/`qa`/`main`, and `.github/workflows/`.

Why not run the bootstrap: the six steps are idempotent and most would
come back `skipped` against a fork (the branches already exist), but two
**would act** — `create_rc_branch` would create `rc`, and
`protect_branches` would overwrite the inherited protection. Neither is
wanted, and "skip is success" (RN-029) doesn't help when the step isn't a
skip.

Steps:

1. Fork `brabo` into your account. Note the resulting `owner/repo`.
2. Register the GitHub PAT via `POST users/me/git-credentials`. The token
   is tested **before** it's encrypted
   (`register-git-credential.use-case.ts:23`), so an invalid token never
   gets written.
3. Create the project in Brabo through the UI as usual, **without**
   provisioning a repository.
4. Insert the `provisioned_repositories` row by hand, pointing to the fork
   (`provider: 'github'`, `external_id: '<owner>/<repo>'`,
   `default_branch: 'dev'`), and the corresponding `repo_bootstraps` row
   marked as converged — so the product doesn't try to resume any
   bootstrap.
5. Record this as **entry #1** of the observation table. It's the
   experiment's first manual intervention, and it happened before the
   experiment began.

> **TODO(human):** which `owner/repo` for the fork? The procedure above
> needs the literal value for the `provisioned_repositories` row — and the
> harvest will want to cite it.

## 1.3 Preconditions — actual status

Assessed against the code, not against CLAUDE.md.

| # | precondition | status | evidence |
|---|---|---|---|
| 1 | Project pointing at Brabo's own repository | ⛔ **blocked** — worked around by the fork (1.2) | `provision-repository.use-case.ts:144` |
| 2 | Valid GitHub credential | ✅ ready — the route exists and tests the connection before encrypting | `register-git-credential.use-case.ts:23` |
| 3 | QA and Infra areas active | ➖ **not applicable** — there's nothing to activate (see 1.3.1) | `apps/api/src/db/schema.ts:781-786` |
| 4 | Per-agent model bindings | ✅ ready — `PUT projects/:projectId/agent-bindings/:agentSlug` | `model-bindings.controller.ts:153` |
| 5 | Per-task budget | ✅ ready — `projects.task_budget_micros`, via `POST .../execution/activate` | `apps/api/src/db/schema.ts:288` |
| 5b | Per-area budget | ⛔ **doesn't exist** — only sketched in ADR 0038 | see 1.3.1 |
| 6 | Model catalog synced | ⚠️ **partial** — only OpenAI lists a catalog (see 1.3.2) | `openai-provider.ts:22` |
| 7 | Manual autonomy everywhere | ✅ ready **by default** — nothing to configure (see 2.1) | `decide.ts:125-128` |
| 8 | Base seed | ⚠️ partial — creates workspace, project, and 7 models; no git, no budget, no execution | `apps/api/src/db/seed.ts` |

### 1.3.1 On item 3: the `agent_areas` table doesn't exist

The generic areas apparatus from ADR 0038 was cut from scope in Phase 8.
The schema comment says so literally
(`apps/api/src/db/schema.ts:781-786`): *"No
`agent_areas`/`agent_area_members` (the ADR 0038 generic apparatus)"*.

What exists is the `delegations` table
(`apps/api/src/db/schema.ts:791-831`), with `area` as free TEXT — today
only `"qa"` and `"infra"`. Area, lead, and members are **hardcoded**:
`apps/web/src/lib/agents.ts:167-180` on the front end, and fixed behavior
in `apps/engine/lib/engine/gates/qa_lead_server.ex` and
`apps/engine/lib/engine/infra/infra_lead_server.ex` in the engine.

Practical consequence: **there's no route to activate an area on a
project**. The area comes into play whenever the Dispatcher triggers QA
or Infra — always. It's not pending configuration; it's configuration
that doesn't exist because it isn't configurable.

Since `agent_areas.budget_micros` also doesn't exist, **there's no budget
cap per area**. The available caps are: project and session (`budgets`
table), and task (`projects.task_budget_micros`). CLAUDE.md describes a
per-area budget as part of the completed Phase 8 — it isn't implemented.

### 1.3.2 On item 6: which LLM providers actually exist

`LLM_PROVIDER_NAMES` has three entries — `ollama`, `anthropic`, `openai`
(`apps/api/src/domain/llm/llm-provider-names.ts`). The six providers
described in Phase 9b (OpenRouter, NVIDIA NIM, Together, Deep Infra,
Bitdeer, Vultr) **did not land**; the
`docs/adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md:147-156`
records them as "what's left for later".

Also, only OpenAI declares `listModels: true` (`openai-provider.ts:22`).
Ollama (`ollama-provider.ts:34-40`) and Anthropic
(`anthropic-provider.ts:48-53`) declare `false` and are skipped by the
sync — honestly, with the reason in the comment. In other words, "synced
catalog" only has an effect for OpenAI; for Anthropic the models come from
the seed (`apps/api/src/db/seed.ts` seeds `claude-opus-4-8`,
`claude-sonnet-5`, and `claude-haiku-4-5-20251001`).

This doesn't block the experiment — Anthropic and OpenAI are enough for
the API bindings. But it changes what item 6 means: there's no catalog to
sync for the provider you'll probably use for the dev agent.

## 1.4 What depends on you before starting

- [ ] Create the fork and note the `owner/repo`
- [ ] Register the GitHub PAT (`repo` scope)
- [ ] Insert the `provisioned_repositories` and `repo_bootstraps` rows
- [ ] Choose the dev's model and fill in the table in 2.2
- [ ] Set the two caps for the exit criteria (4.4)
- [ ] Record entry #1 of the observation table

> ⛔ **STOP HERE.** Part 2 only starts once the six items above are
> closed. Setting up halfway and discovering, in the third session, that
> the gate binding was on a local 7B model contaminates everything that
> came before.

---

# PART 2 — RULES OF THE EXPERIMENT

## 2.1 Manual autonomy: don't configure it, and don't relax it

**Explicit approval for everything is already the default behavior.**
With no configuration at all, `decide()` falls into `require_approval`
with reason `"default (no applicable rule)"` (`decide.ts:125-128`), and a
new project's `permissions.json` is born empty
(`permissions-file.ts:14-18`). There's nothing to turn on.

The rule of the experiment is the opposite of configuring: **don't
loosen**.

- Never use `approve_always` — it writes a pattern into `allow`, and the
  click stops existing from then on. The clicks are the data; spending
  them erases the measurement.
- Never populate `allow` by hand in `permissions.json`.
- Never write a row into `agent_autonomy`.

If approval fatigue becomes unbearable, **that is the result**, not a
setup problem. Note it in the free-text column and continue.

Two caps stay active regardless of anything else, and it's good to know
they exist so as not to mistake them for a bug: merge into a protected
branch (`decide.ts:149-160`) and instruction patches
(`decide.ts:166-175`) are never auto-approvable. There is also a set of
always-denied patterns (`decide.ts:84`).

## 2.2 Bindings fixed before starting, and not touched afterward

Changing the model midway invalidates the cost and quality comparison
between sessions. Fix it once, record it here, and if you need to change
it — note it as a manual intervention with a reason.

The slugs below are the real ones, from
`apps/web/src/lib/agents.ts:25-38`. Note that the QA lead is `qa` (not
`qa-lead`; that name only exists as the engine's internal actor), and
that there's no generic `dev-<module>` slug in the fixed roster — the
per-module dynamic devs are derived from the `module_map` at runtime.

| agent | role in the phase | model | why |
|---|---|---|---|
| `po` | structures epic and stories | | |
| `arquiteto` | ADR for the semantics, validates module_map | | |
| `dev-backend` | implements the two providers | | |
| `qa` | area lead, consolidates the verdict | | |
| `qa-automacao` | suite + coverage matrix | | |
| `qa-performance-seguranca` | NFRs and support for the checklist | | |
| `secops` | its own deterministic gate | — | doesn't use an LLM |
| `infra` | infra area lead | | |
| `infra-workflows` | CI pipeline | | |
| `psicologo` | hypotheses about the session | | |
| `psicologo-leve` | cheap step | | |
| `anamnese` | profile and instruction patches | | |
| `criativo` | **dismissed** — scope already known | — | |

> **TODO(human):** which model for each row? Two constraints the phase
> imposes: the dev needs a strong API model (the work is implementing
> against a contract, not completing boilerplate), and **no gate can be
> on a local 7B for the semantic step** — that exact combination is what
> took `docs/adr/0020-destravar-gates-qa-secops.md` nine executions to
> diagnose.

Every model bound to an agent needs `supports_tool_calling`; the domain
rejects the binding with a 422 if it doesn't (RN-040). A model discovered
by sync comes in inactive and needs curation before it can appear for
binding.

## 2.3 Instructions: the only path is the Anamnese

Restating principle 2 with the mechanism: an instruction patch is born as
a `proposed_action` and is **never** auto-approvable
(`decide.ts:166-175`). You see the diff and decide.

The rule of the experiment: **deny at least one patch on purpose**. This
is what exercises RN-026 — a denied patch is not re-proposed, and the
comparison is over normalized content, so re-indenting the same patch
doesn't turn it into a new proposal. If the Anamnese re-proposes a patch
you denied, that is a big finding, and the kind of thing that only shows
up in real execution.

---

# PART 3 — EXECUTION (10b)

The order of the sessions inside the product. Each section describes what
the product **actually** does — in several places this diverges from what
CLAUDE.md described, and the divergence is recorded in the findings table
at the end of this document.

## 3.0 Before session 0 — stack smoke test

Don't spend a real session on an environment that doesn't close the loop.
Run this first:

```bash
pnpm --filter api demo:pr-gates-area-qa
```

It exercises the whole QA area (delegation to the two subspecialties,
consolidation into a single verdict) against the fake server. If it
doesn't close, no session will close either.

Two engine guards matter here:

- **`START_OUTBOX_DRAIN=true` is required.** It's the drain that delivers
  `session.closed` to the `PsychologistWorker`
  (`apps/engine/lib/engine/outbox/drain.ex:58-61`). Without it the
  Psychologist never runs and step 3.6 doesn't happen. The dev compose
  already ships with `true`.
- **`START_ANAMNESE`** is worth turning off during execution and on
  between batches. `docs/runbook.md#ambiente-de-inferencia` records that
  the Psychologist and the Anamnese consume LLM turns in parallel with the
  execution agents and can drop the connection mid-cycle. Note the
  warning there: **the guard doesn't purge the queue** — old jobs run on
  the next boot regardless.

Also check the rest of that runbook section
(`OLLAMA_CONTEXT_LENGTH`, resident models, GPU). These are the five causes
that took ADR 0020 nine executions to isolate.

## 3.1 Session 0 — Criativo (Creative)

**This session was not in the original plan, and it is mandatory.** The
reason is finding #9: without the Creative agent, no story ever reaches
`ready` and no dev picks up a task. The Creative agent is the only one
with `emit_artifact`, and a business rule is a readiness prerequisite.

1. Open a new session. The Creative agent leads it.
2. Paste the text from `docs/missions/inputs/00-handoff-criativo.md`.
3. Converse until it has emitted **one `business_rule` per semantic to
   cover**.
4. **Non-negotiable exit criterion:** confirm the rules exist before
   continuing. They appear in the session thread as emitted artifacts. If
   you move on without them, session 1 is born dead and you only find out
   in sessions 3+, when no dev manages to pick up a task.
5. Click **"I'm ready to produce"**. The Creative agent offers the
   handoff to the PO.
6. Accept the handoff (**"Accept handoff and start po"**).

Don't ask it to decide the Bitbucket semantics — that's the Architect's
job, against the official docs, in session 2.

## 3.2 Session 1 — PO

The PO **doesn't wait for instruction**: on activation it does an
automatic `:kickoff` and generates the whole backlog at once, from the
brief and the rules the Creative agent left in the event log
(`apps/engine/lib/engine/agents/po_server.ex:68-80`).

What the product does, differing from the original plan:

- **There's no "promote to ready".** Promotion is automatic on creation,
  if the story is already born with a DoD, DoR, ≥1 functional requirement,
  and ≥1 linked rule (`create-story.use-case.ts:75-78`). What you control
  is the quality of the input, not a gate in the middle.
- **There's no returning it to the PO.** No button, no state, no event.
  Rejection is just conversation in the thread — so **it only exists in
  the table if you note it**. Note it: it's experiment data, and it's the
  only record that will survive.
- The **Backlog** tab is read-only. It's for reviewing after the fact.

Two deliberate instructions when refining with it:

- **Many modules, few tasks each.** Per finding #10, each dev agent
  processes **one** task per activation. Real parallelism comes from
  distinct modules, not from a task queue. A backlog with 3 modules × 2
  tasks moves much better than 1 module × 6.
- **At least one story with a performance NFR**, written with one of the
  keywords the QA Lead recognizes
  (`apps/engine/lib/engine/gates/qa_lead.ex:20-28`): `performance`,
  `desempenho`, `latência`, `throughput`, `vazão`, `tempo de resposta`,
  `escalabilidade`. The check is a substring match, not semantic — "needs
  to be fast" does **not** match. Without this, the QA Lead dismisses the
  Performance/Security subspecialty on every task and the experiment
  never exercises the second delegation.

## 3.3 Session 2 — Architect

The Architect validates the stories against the `module_map` and produces
the semantics ADR via a real PR, with gates. It's your first reading of an
agent verdict in the phase.

Three things that only show up here and stall execution if missed:

- **`assign_story_modules` is what puts `module_ids` on the story.** The
  claim SQL matches `s.module_ids ? module`
  (`apps/api/src/infrastructure/persistence/drizzle/backlog.repository.ts:189`).
  A story without an assigned module is invisible to every dev, even when
  `ready`.
- **Publishing a new `module_map` demotes an orphaned `ready` story back
  to `draft`** (`create-module-map.use-case.ts:63-82`), with actor
  `system/module-map-revalidation`. If the Architect republishes the map
  after the PO has closed the backlog, part of it goes back to `draft`
  without warning.
- **Activating execution requires a current `module_map`.** Without one
  the response is a 400 with the message "Project has no current
  module_map" (`activate-execution.use-case.ts:88-92`) — not a 409.

## 3.4 Sessions 3+ — Devs, in batches

This is where reality diverges quite a bit from the original plan, because
of finding #10: **a dev agent processes exactly one task and stops.**
There's no rescheduling after the gate; no worker fires again. Reactivating
execution doesn't help either — the supervisor returns the existing agent,
`:work` isn't dispatched, and an extra session with no agents attached is
even born (finding #11).

The cycle of a **batch**:

1. Activate execution (`maintainer`). This creates the session, spins up
   one dev agent per module, and dispatches one task to each.
2. Optionally accept parallelization (below) — adds `dev-<module>-2`,
   which handles one more task in that module.
3. Watch the gates (3.5) and merge on GitHub — the merge happens outside
   the product, see 3.5.
4. **Restart the engine.** Dev agents are `restart: :temporary`
   (`dev_agent_server.ex:16`): they die and don't come back.
5. Reactivate execution. Now the registry is empty, the agents come back
   up, and pick up the next task.

Record the restart count in the table. **It's the most honest metric in
the phase**: the number of manual restarts per delivered task says more
about the experience of living with it than any other column.

**Parallelization.** The suggestion is computed **once, at activation**,
for every module with ≥2 claimable tasks
(`activate-execution.use-case.ts:159-172`) — it'll be there from the first
minute, not appearing "when the system figures it out". Serial is the
default because you **don't** click "Accept". Accept it in the second half
and compare the measurements, as planned.

**Cycle K.** `DEFAULT_MAX_GATE_CORRECTIONS = 3`
(`record-gate-verdict.use-case.ts:21`), configurable at activation. Once
exhausted, the task becomes `blocked`, loses its owner, and **drops out of
automatic claiming**; unblocking is manual, via
`POST .../sessions/:sessionId/tasks/:taskId/unblock`, with a button in the
"Blocked tasks" section of the Overview.

> **Note so it isn't confused with rule 2.1:** activation **writes on its
> own** the `DEV_TERMINAL_ALLOW_PATTERNS` into the project's
> `permissions.json` (`activate-execution.use-case.ts:115-118`). This is a
> product mechanism — without it every dev's `terminal` call would fall
> into approval and no suite would ever close. It is not a violation of
> "never populate `allow`", which still holds **for you**.

## 3.5 Gates on every PR

Where to look: the project's **Approvals** tab, the PR timeline component.
Each verdict is an expandable card; inside it are the items, the
`coverageMatrix`, the **per-subspecialty sub-verdicts**, and the
**dismissals** with justification.

- **QA Lead** consolidates. A dismissal is never silent: it becomes
  `delegation.dispensed` with `justification`.
- **SecOps** is deterministic, no LLM — runs semgrep and gitleaks over the
  diff. A missing scanner is skipped and recorded in the summary, never
  breaks the gate.
- The order is immutable: `awaiting_qa → awaiting_secops → awaiting_user`.
  Trying to skip a step is rejected by the domain.

**The merge is not a product step.** `awaiting_user` is terminal by
design — the engine doesn't know about `git_merge` or `awaiting_user`. You
read the consolidated verdict, click "view PR", and **merge on GitHub**.
This is by design, not a gap (RN-014).

## 3.6 End of each session — mandatory order

In this order, no skipping:

1. **End it via the "End" button** at the top of the session. It fires
   `closing` and then `closed`
   (`apps/web/src/routes/SessionPage.tsx:271-276`).
2. **Let the Psychologist process it.** It runs on its own in ~2s, via the
   outbox drain — there's no button to press. It's idempotent and only
   reacts to the two terminal events.
3. **Fill in the table row BEFORE opening the next session.** The
   interventions column is the one that evaporates.
4. **Don't read the hypotheses.** They're read in a batch, only at harvest
   time.

The concrete anti-contamination protocol — because the team panel you need
and the hypotheses you must avoid live on the **same tab** (finding #15):

- In the **Activity** feed, pin the type filter to "Delegations". It's
  exclusive: shows only the chosen type, and hides the hypotheses.
- **Don't scroll down to the Insights section** of the Overview. It has no
  collapse.
- **Don't click an evidence chip** of a hypothesis: besides making you
  read the hypothesis, the link opens the analyzed session already with
  the event log expanded.
- Inside a session's thread you're safe: the "Event log" is born
  collapsed.

---

# PART 4 — OBSERVATION

## 4.1 The table

One row per session. Fill it in **during**, not after — the interventions
column is the one that evaporates.

| # | session | task | approval clicks | manual interventions + reason | engine restarts | cost | gate verdicts | free note |
|---|---|---|---|---|---|---|---|---|
| 1 | — (pre-experiment) | — | 0 | Manual seeding of `provisioned_repositories`/`repo_bootstraps` pointing at the fork. Reason: the product doesn't know how to adopt an existing repository (`provision-repository.use-case.ts:144`) | 0 | 0 | — | The phase's first finding, before the first session. Becomes P1 at harvest time |
| 2 | | | | | | | | |

Conventions for filling it in:

- **approval clicks** — raw count of your decisions in the Approvals
  screen during that session, approved and denied summed. It's a proxy
  for fatigue, so the raw count matters more than the ratio. No screen
  totals this for you (finding #16): the count comes out of the event log,
  at harvest time.
- **manual interventions** — anything you did that the agent should have
  done, or that the product should have allowed. Always with a reason. If
  the reason is "it got stuck", record the **origin** (`infra` | `modelo`
  | `código` | `política`) — never by elimination.
- **engine restarts** — how many times you had to restart the engine for
  the next batch to move forward (3.4). Count it separately from the other
  interventions: it's the metric that measures finding #10's bottleneck,
  and the one that matters most at harvest time.
- **cost** — in USD, from the session's `TokenMeter`. Cross-checking
  against the event log is done at harvest time.
- **gate verdicts** — `approved` or `changes_requested` per gate, and if
  there was a correction cycle, how many rounds.

## 4.2 Where each column is validated in the event log

The table is a human note; the event log is the proof. At harvest time
(Part 5), each column is checked against these types — all of which exist,
confirmed in `docs/reference/events.md`:

> ⚠️ **Correction (finding #17):** the table's most important column
> **does not** validate against the event log. `ApproveActionUseCase`
> writes `proposed_action.approved` only to the outbox
> (`approve-action.use-case.ts:98`), never to `session_events` —
> confirmed by query, zero `proposed_action.*` events in a database with
> hundreds of actions. The durable source is the `proposed_actions` table,
> and the ready-made queries are in `docs/missions/colheita-queries.sql`.

| column | where it's checked |
|---|---|
| approval clicks | `proposed_actions.decided_at IS NOT NULL` — **not** the event log. `decided_at` is only set once a person decided. Two traps: counting by `status` undercounts (an approved action that executes becomes `executed`), and `status = 'denied'` includes what policy blocked before ever reaching a human (`resolved_policy = 'deny'`) |
| cost | `token_usage` table — each row records the price that produced the cost, so yesterday's number is still reproducible (RN-044); plus `budget.threshold_crossed` for the thresholds |
| gate verdicts | `pr.gate_changed` and `infra.gate_changed`; the verdict content in the `qa_verdict` / `secops_verdict` artifacts |
| quality of the consolidated verdict | `delegation.completed` / `delegation.failed` / `delegation.dispensed` — one per subspecialty, with the `parecerArtifactId` of the INTERNAL verdict; the dismissal carries a `justification` |
| manual interventions | `chat.message` with actor `user` during the execution phase, cross-checked against what you noted by hand |
| failure origin | `payload.failureOrigin` in `delegation.failed`, and the deterministic termination classification (RN-023) |
| Psychologist loop | `psychologist.hypothesis_proposed` / `_accepted` / `_dismissed` / `_accepted_for_anamnese`, and `anamnese.run_completed` |
| task hang | `backlog.task_blocked` — correction cap exhausted or an impediment |

If a column doesn't close against the log, it goes into the harvest as
**not measured**. Don't estimate.

## 4.3 The Psychologist → Anamnese loop

The loop is only exercised if the hypotheses are decided both ways. An
experiment that accepts everything tests nothing.

**Reading rule:** hypotheses are read **in a batch, only at harvest
time**. Reading them midway changes your behavior as an observer and
contaminates the following sessions. The exception is the decision
itself — which needs to happen for the loop to run.

What to decide on purpose, and what each decision exercises:

| decision | exercises |
|---|---|
| Accept at least one hypothesis and forward it to the Anamnese | the `psychologist.hypothesis_accepted_for_anamnese` link — the only path that closes the loop |
| Dismiss at least one | RN-022: the cycle is compare-and-swap, `proposed → accepted \| dismissed` |
| Deny at least one resulting instruction patch | RN-026: a denied patch is not re-proposed (comparison over normalized content) |
| If an approved patch makes the agent worse, roll it back | RN-027: rollback is a **forward** operation — creates a new version, doesn't erase history |

Worth observing without intervening: a hypothesis with no valid evidence
never gets recorded (RN-021, atomic batch validation). If the Psychologist
proposes little, it may be getting rejected at that gate — which is
information, not a defect.

## 4.4 Exit criteria

The phase ends when **any one** of these is true:

1. **Success** — `BitbucketProvider` and `GenericGitProvider` pass the
   single contract suite, and the corresponding PRs were merged by you
   through the normal pipeline.
2. **Cost cap** — the experiment's accumulated spend reaches the value
   below.
3. **Time cap** — the experiment reaches the number of days below.

Both caps exist so the experiment doesn't turn into a project. Hitting
either one **is not a failure**: it's a result, and the harvest is written
the same way, with whatever was obtained up to that point.

> **TODO(human):** what's the experiment's total cost cap, in USD? It
> should be a number you'd accept spending with zero return — because
> that's the worst case.

> **TODO(human):** what's the calendar-day cap? Counted from the start of
> 10b's first session, not from setup.

> **TODO(human):** if the suite closes on both providers before either
> cap is hit, does the experiment continue to gather more experience data,
> or end right away? Either answer works; the one that doesn't work is
> deciding it in the heat of the moment.

---

# PART 5 — HARVEST (10c)

Only starts after the exit. **The kit is already ready:**

| file | what it is |
|---|---|
| `docs/missions/colheita-queries.sql` | the 11 queries that produce each number, already validated against the real schema |
| `docs/missions/colheita-esqueleto.md` | the report's mold, with each number tied to the query that fills it, plus the ADR outline |

Before running anything: **`pnpm --filter api db:migrate`**. The cost
queries use `input_price_per_million_micros`,
`output_price_per_million_micros`, and `upstream_provider`, which only
exist starting with the Phase 9 migrations.

In this order:

1. **Check the table against the database**, column by column, using the
   4.2 map — with finding #17's correction in mind: clicks come from
   `proposed_actions`, not the event log. Whatever doesn't close becomes
   "not measured", explicitly, in the text.

2. **Fill in `colheita-esqueleto.md` and move it** to
   `docs/explanation/primeiro-dogfooding.md`. Only then does it become a
   site page, and at that point it needs frontmatter (`id`, `title`,
   `sidebar_label`, `sidebar_position`, `description`, `keywords`, in the
   pattern of `docs/explanation/documentation-workflow.md`) and an entry
   in `website/sidebars.ts`. Content: the validated metrics, the real cost
   per provider, the interventions, and the diff between promise and
   reality in honest prose — **including what the agents did better than
   expected**. No invented numbers.

3. **Review the Psychologist's hypotheses in a batch**, one by one, and
   evaluate the resulting Anamnese patches. This is where you answer
   whether the loop produced something useful or just expensive noise.

4. **"First dogfooding" ADR** with the next free number. Learnings and
   findings turned into a **prioritized P1/P2/P3 backlog** — never
   embedded fixes. The ADR records what was decided to do about it, it
   doesn't do it.

5. **Update whatever the phase made false.** In particular
   `docs/reference/git-providers.md`, which today states that Bitbucket
   and Generic are out of scope (see finding #6 below).

---

# Findings already known, before the first session

These came out of preparation (10a) and enter the harvest already with a
suggested priority. None was fixed — fixing during the phase would violate
principle 3.

| # | finding | where | prio |
|---|---|---|---|
| 1 | The product doesn't know how to point a project at an existing repository. `createRepo` is unconditional; `getRepo` exists and isn't called by any use case; the DTO has no field for `externalId` | `provision-repository.use-case.ts:144`, `github-provider.ts:82` | **P1** |
| 2 | `protectBranch` on GitHub applies `enforce_admins: true` + 1 reviewer over an existing protection, without reading the current state — can lock the owner out of their own manual merge | `github-provider.ts:170-175`, ADR 0028:83-84 | **P1** |
| 3 | The bootstrap creates and protects an `rc` branch that Brabo's branch policy (Phase 6) doesn't use | `bootstrap-steps.ts:94,195` | P2 |
| 4 | `agent_areas`/`agent_area_members` don't exist; areas, leads, and members are hardcoded in two places that can diverge (frontend and engine). No per-area budget | `apps/api/src/db/schema.ts:781-786`, `apps/web/src/lib/agents.ts:167-180` | P2 |
| 5 | The six Phase 9b LLM providers didn't land, and CLAUDE.md describes Phase 9 as if they had | ADR 0042:147-156 | P2 |
| 6 | `docs/reference/git-providers.md:170-174` states Bitbucket and Generic are "out of scope — a decision, not a forgotten backlog item"; CLAUDE.md marks the two as an active phase. That's the doc the PO reads as truth | `docs/reference/git-providers.md:170-174` | P2 |
| 7 | The `git-errors.ts` comment says "8 operations"; the contract has 10 | `apps/api/src/domain/git/git-errors.ts:3` | P3 |
| 8 | The contract suite's header says only Local exercises it; GitHub and GitLab have already been running it since Phase 2 | `apps/api/test/contract/git-provider.contract.ts:12-18` | P3 |

Finding #6 has extra value: fixing it is the first doc change the agents
will make in this phase, which turns the fix into a test of the drift
check itself.

## Findings from assessing the execution plan (Part 3)

These came out of checking whether the 10b steps were actually
executable. Four weren't. None was fixed, per the same principle 3.

| # | finding | where | prio |
|---|---|---|---|
| 9 | **The Creative agent cannot be skipped.** Claiming requires a `ready` story; `ready` requires ≥1 business rule; the rule id is validated against a real event; and only the Creative agent has `emit_artifact` — the PO doesn't. Without the Creative agent, no dev picks up a task | `backlog.repository.ts:188`, `story-readiness.ts:46`, `create-story.use-case.ts:55-59`, `po_server.ex:18` | **P1** |
| 10 | **A dev agent processes ONE task and stops.** `:work` is only dispatched at activation and when parallelization is accepted; `report_done` opens the gate and doesn't reschedule itself; no Oban worker re-dispatches. Cap per module: 1 task, or 2 with parallelization | `execution_command_controller.ex:35,75`, `dev_agent_server.ex:76-91,306-327` | **P1** |
| 11 | Reactivating execution doesn't re-dispatch `:work` (the supervisor returns `:existing`), and it also creates an extra session with no agents attached. The 409 "execution already active" the Swagger docs promise **doesn't exist** in the use case | `execution.controller.ts:50-52`, `dev_agent_supervisor.ex:33-52` | P2 |
| 12 | There's no manual handoff to an agent of your choice — only Creative→PO (button) and Architect→Infra (route, no button on the web). And the ADR 0038 target validation (`assertHandoffTargetAllowed`, `HandoffToSubagentError`) **was never implemented**; `toAgent` is a free string | `SessionPage.tsx:403-407,476-478` | P2 |
| 13 | There's no "promote to ready": promotion is automatic on creation. `TransitionStoryUseCase` validates and emits `backlog.story_transitioned`, but **isn't wired to any route** — it's dead code. The Backlog tab is read-only | `create-story.use-case.ts:75-78` | P2 |
| 14 | There's no returning it to the PO — no state, event, or button. `backlog.story_demoted` is something else (`module_map` revalidation). Rejection only exists if the human notes it | `create-module-map.use-case.ts:63-82` | P2 |
| 15 | The team panel and the Psychologist's hypotheses share the same tab, which is the project's default — the batch-reading protocol depends on filter discipline, not on the product | `ProjectOverviewTab.tsx:227-263,278-285,576-714` | P2 |
| 16 | No screen totals approvals per session; on-demand Anamnese has no button (only a route) | `hooks.ts:153-160`, `anamnese.controller.ts:71-81` | P3 |
| 17 | **The phase's main metric is not in the event log.** `proposed_action.approved`/`.denied` only go to the outbox, never to `session_events` — Part 4.2 claimed the opposite and was corrected. The durable source is `proposed_actions.decided_at`; the outbox retains the rows (`processed_at`) and serves as a cross-check | `approve-action.use-case.ts:98`, `deny-action.use-case.ts:50` | **P1** |

Two of these are not defects, and they're included only as a note so the
harvest doesn't confuse them with a gap: **merge outside the product**
(`awaiting_user` is terminal by design, RN-014 — the engine doesn't even
know about `git_merge`), and the **QA dismissal by keyword** in the NFR
(`qa_lead.ex:20-28`), which is a declared heuristic, not NLP.

---

# The inputs

Nobody starts from scratch in 10b. The four files in `docs/missions/inputs/`
are the input material:

| file | for whom | what it is |
|---|---|---|
| `inputs/00-handoff-criativo.md` | you, in session 0 | the **literal text** to paste to the Creative agent, plus the PO's refinement prompts |
| `inputs/01-contrato-gitprovider.md` | PO and Architect | what already exists: the 10 operations, the capabilities, the normalized errors, the single suite |
| `inputs/02-bitbucket-cloud-a-investigar.md` | Architect | **questions**, not answers — what to verify in Bitbucket Cloud's official docs before coding |
| `inputs/03-escopo-do-generic.md` | Architect | what "minimal capabilities" means, and how to degrade honestly |

The Creative agent is **not** skipped, contrary to what the original plan
expected: it's the only path to the PO and the only agent capable of
emitting the business rules that unblock execution (finding #9). The
scope is still known — what changes is that it now goes through the
Creative agent instead of straight into the PO.

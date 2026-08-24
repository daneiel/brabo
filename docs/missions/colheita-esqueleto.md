# Harvest skeleton (10c)

Working material. **This file is not the report** — it is its mold.

Once 10b has run, fill in the markers, write the prose, and **move** the
result to `docs/explanation/primeiro-dogfooding.md`, which is a published
page and therefore needs frontmatter (`id`, `title`, `sidebar_label`,
`sidebar_position`, `description`, `keywords`, in the pattern of
`docs/explanation/documentation-workflow.md`) and an entry in
`website/sidebars.ts`. This file lives in `docs/missions/`, excluded from
the build, precisely so the skeleton never ships saying nothing.

**How to fill it in.** Each number appears as `<!-- query: name -->`. The
name is the corresponding block in `docs/missions/colheita-queries.sql`. Run:

```bash
pnpm --filter api db:migrate     # required: the cost queries use Phase 9 columns
docker exec -i brabo-postgres-1 psql -U brabo -d brabo \
  -f - < docs/missions/colheita-queries.sql
```

**Rule that matters more than the deadline:** no number goes in without the
query that produces it. Whatever doesn't close goes in as "not measured" —
never as an estimate (principle 6 of the mission).

---

## 1. The answer

> The question the phase exists to answer: **how much did each provider
> cost, in money and in human attention — and does Brabo pay off?**

Answer in three paragraphs, in this order, before any table. Whoever reads
this a year from now wants the conclusion, not the audit trail.

| provider | sessions | LLM calls | cost (USD) | clicks it cost |
|---|---|---|---|---|
| Bitbucket | <!-- query: a-pergunta-da-fase --> | | | |
| Generic | <!-- query: a-pergunta-da-fase --> | | | |

**Does it pay off?** Don't answer with the isolated cost. The honest
comparison is against what the same work would cost outside Brabo — and the
number nobody else measures is the right-hand column: how many times a
person had to stop what they were doing to decide.

> ⚠️ If the Architect did not separate the two providers into distinct
> modules in the `module_map`, this table doesn't separate them either.
> That's a finding — record it in §8 instead of an invented split.

---

## 2. Consolidation by session

Copy the filled-in table from the mission (Part 4.1) and cross-check it
against the database.

| # | session | task | clicks | interventions | restarts | cost | gates | note |
|---|---|---|---|---|---|---|---|---|
| | | | <!-- query: cliques-por-sessao --> | | | <!-- query: custo-por-agente --> | <!-- query: voltas-de-gate --> | |

**A divergence between the note and the database is a finding about
observability, not your error.** Record the two columns side by side when
they diverge, and explain in §8. Two sources of divergence already known
before starting:

- the click count **is not in the event log** (finding #17) — the source is
  `proposed_actions.decided_at`;
- `engine restarts` has no record anywhere in the system. It's only your
  note. If you didn't note it, it's lost.

---

## 3. Where human attention was spent

<!-- query: cliques-por-tipo -->

| action type | clicks | went through without a click | % that required a human |
|---|---|---|---|

The reading that matters: **which action type concentrated the fatigue.**
If a single type accounts for most of the clicks, that's the natural
candidate for loosening policy — and the phase measured precisely the cost
of *not* having loosened anything.

---

## 4. Cost

### By agent

<!-- query: custo-por-agente -->

| agent | calls | tokens in | tokens out | USD | estimated counts |
|---|---|---|---|---|---|

The **estimated counts** column matters: these are calls where the provider
didn't report `usage` and the number came from the local tokenizer
(RN-041). Cost with many estimates is less reliable, and saying so is more
honest than rounding.

### By LLM provider

<!-- query: custo-por-provider-de-llm -->

| input provider | actual provider | model | calls | USD |
|---|---|---|---|---|

### Is the cost reproducible?

<!-- query: custo-reproduzivel -->

Expected: **no row in the `nao_fecha` category**. Rows in
`sem_preco_gravado` predate the Phase 9 migrations and are not a defect.

If `nao_fecha` shows up, it contradicts RN-044 and becomes a P1 finding
about the metering — more important than any other number in this section,
because it puts every other number in doubt.

---

## 5. Gates

### Correction rounds

<!-- query: voltas-de-gate -->

| task | gate | rounds | blocked | origin |
|---|---|---|---|---|

A task blocked with `blocked_origin` filled in exhausted cycle K (cap 3,
unless configured on activation). **The origin is the data**: `infra` and
`modelo` say opposite things about the product — the first is environment,
the second is the agent not managing.

### Did the QA area work?

<!-- query: delegacoes-e-dispensas -->

| area | lead | subagent | status | how many | with failure |
|---|---|---|---|---|---|

Three questions to answer in prose:

1. Did the consolidated verdict say something **useful**, or was it a
   collage of the sub-verdicts?
2. Were the dismissals justified in a **verifiable** way?
3. Did the Performance/Security subspecialty ever run? If it was only
   dismissed, the likely cause is that no story had an NFR with one of the
   keywords the QA Lead recognizes — which is a finding about the
   heuristic, not about QA.

---

## 6. The Psychologist → Anamnese loop

**Read the hypotheses now, in a batch — not before.** If you read them
during the phase, say so here: it contaminates the interpretation, and
it's honest to record it.

<!-- query: hipoteses-e-decisoes -->

| target agent | status | how many | average confidence | evidence per hypothesis |
|---|---|---|---|---|

<!-- query: hipotese-para-patch -->

| hypothesis | decision | became a patch? | version | patch decision |
|---|---|---|---|---|

What the table needs to prove:

- **accepted hypothesis that didn't become a patch** (`patch_id` null) — the
  loop didn't close, and that's a finding;
- **denied patch that was re-proposed** — contradicts RN-026 and is a big
  finding;
- if you denied at least one on purpose, as the mission asked (2.3), say
  what happened afterward.

---

## 7. PR timeline

<!-- query: linha-do-tempo-das-prs -->

| when | who opened it | title | branch | where it stopped |
|---|---|---|---|---|

Remember that `awaiting_user` is terminal **by design**: the merge happens
at the git provider, outside the product. A PR stopped there isn't
stuck — it's waiting for you, as designed.

---

## 8. Promise × reality

The most important section, and the only one that doesn't come from a
query. Honest prose.

### What didn't work as promised

Findings #1–#17 from the mission are already raised and **don't need to be
rediscovered** — reference them. What this section adds is what only
execution reveals: where the product actually got stuck, how many times,
and how much it cost to work around it.

### What the agents did BETTER than expected

Mandatory section — resist leaving it empty out of modesty or bias: a
report that only lists failures is as useless as one that only lists
successes. Questions that help find material:

- Did any QA verdict catch something **you** would have let through?
- Did any agent resolve a backlog ambiguity without needing to ask?
- Did the deterministic SecOps find something real, or just noise?
- Was any Psychologist hypothesis **correct** in a way that surprised you?
- Did the Architect's ADR turn out better than what you would have written
  in the same time?

### What changed your mind

If the phase made you change your mind about any earlier architectural
decision, this is the place. It's the most valuable paragraph in the
document and the easiest to omit.

---

## 9. ADR outline

The ADR is born **here**, at harvest time, with the next free number at
that moment — not before. An ADR is a record of a decision, and decisions
come from the data; an ADR created empty would burn the number and be born
destined to be rewritten, against the rule that an accepted ADR is never
edited.

Suggested title: **"first dogfooding"**. Three sections, only these
(Context, Decision, Consequences), like every ADR in the repository.

**Context** — what the phase set out to measure and what it actually
measured.

**Decision** — the **structural** learnings, not the bug list. What the
phase taught about the product's design that's worth changing. Candidates
the preparation already suggests, to confirm or refute with the data:

- is the one-task-per-agent bottleneck a design limitation or an
  implementation one?
- is the phase's central metric not being in the event log an accident, or
  a symptom that the event log serves a different purpose?
- did hardcoded areas resolve well enough, or is the ADR 0038 table
  missed?

**Consequences** — the prioritized backlog. Format:

| # | item | prio | justification |
|---|---|---|---|
| | | P1/P2/P3 | why this priority, with the data behind it |

**P1** = prevents the product from doing what it promises. **P2** =
expensive in attention or money, but has a workaround. **P3** = annoyance
or clarity debt.

**No embedded fixes.** The ADR records what was decided to do; it doesn't
do it.

---

## 10. Technical delivery

Status verified on **2026-08-01**, before 10b ran. Re-check at harvest
time.

| criterion | status | evidence |
|---|---|---|
| contract suite green across the 5 providers | ⛔ **3** — local, github, gitlab | 5 calls to `runGitProviderContract`, 3 distinct providers |
| wizard with Bitbucket and Generic | ⛔ absent | `apps/web/src/routes/NewProjectWizard.tsx:34-36` |
| Generic degradation tested | ⛔ doesn't exist | no `*generic-git*` file under `apps/` |
| "no Bitbucket in the UI" divergence removed | ⛔ locked in by a test | `apps/web/src/components/ProjectCard.test.tsx:69` asserts "only github, gitlab, or local — no Bitbucket"; `design/COMPONENTS.md:222` calls for a 2x2 grid **with** Bitbucket |
| docmap / CHANGELOG / docs green | ✅ | `pnpm docs:check` and `pnpm docs:build` pass |

About the fourth item: the divergence **is not an oversight** — it's locked
in by a test that asserts only three providers exist. Implementing
Bitbucket will fail that test, and that's the mechanism working. At harvest
time, record whether the agent understood this on its own or needed
intervention.

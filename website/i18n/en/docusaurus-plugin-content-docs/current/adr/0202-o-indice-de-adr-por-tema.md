---
traducao_de: a5e4f1bc5ada7985eb268f8b7322903a396032ee
---

# ADR 0202 — The ADR index by theme, with the theme outside the ADR

## Status

**Accepted.** 2026-10-01 (AT-137, story HS-014, epic EP-011, finding `BRB-026`,
round 36; owner decision on 01/10: *"yes, reorganize by theme, with the theme
OUTSIDE the ADR"* — a mapping file ADR → theme next to the index, checked by
`docs:check`, and no accepted ADR edited). The **taxonomy** — the list of 15
themes and the theme of each of the 191 ADRs — is a PROPOSAL of this lane, and
the owner reviews it in the PR: changing an ADR's theme or merging two themes is a
change to `docs/adr/temas.yml`, not to this text.

## Context

`docs/adr/index.md` was grouped by PHASE. That helped while phases were the way
the project moved; it stopped helping when phases ended and work started being
born from the kanban: measured on 2026-10-01, of the index's 191 rows, **148**
lived under a single heading, `## Phase 12 — Post-dogfooding operability`, from
0044 to 0197 — the section that was "the rest" became the index. Whoever looks
for "what was decided about the broker" or "why the machine key is like this" has
nowhere to start except reading 148 lines.

AT-027 did the counting half of `BRB-026` (the index said 134 with 156 written)
and separated this half in writing, with the question that blocked it: the theme
would be a `tema:` metadata in each ADR's frontmatter — and adding frontmatter to
an accepted ADR is editing it, which the index convention forbids without
exception. The owner's decision solves the question from the other side: the
theme lives OUTSIDE the ADR.

What already existed and remains: `verificarIndiceAdr`
(`scripts/docs/generate.mjs`) fails an ADR without a link in the index, and
`verificarContagensEmProsa` checks the count in the index's `description` and
"the next one is **NNNN**". Neither knows anything about grouping.

## Decision

**1. The theme lives in `docs/adr/temas.yml`, next to the index.** Two keys:
`temas:` — the CLOSED list, in order, each with `id` (kebab-case, the anchor
`{#tema-<id>}` and the map's value), `titulo` (the section heading in the index,
in English like the index) and `descricao` — and `adrs:`, the map
`"NNNN": <id>`. Each ADR has ONE theme, the main one: when two fit, the one where
someone would look first wins. No accepted ADR is touched.

**2. The index is CHECKED, not generated.** Each index row is a curated sentence
about the ADR, and no script writes it (the reason `verificarIndiceAdr` already
recorded). Generating the index would require moving the 191 sentences into the
YAML — trading readable Markdown for a long YAML string, to gain an ordering the
check already guarantees. The index now has one section
`## <titulo> {#tema-<id>}` per theme, in list order, with the one-line sentence
of the `descricao` and the usual table, in numeric order.

**3. `scripts/docs/temas-de-adr.mjs` checks, and `docs:check` fails**
(`verificarTemasDeAdr`, sibling of `verificarIndiceAdr`, called right after it):
an ADR in `docs/adr/` without a theme; a theme in the map not in the list; a map
entry for an ADR that does not exist; a list theme with no ADR; a list with a
repeated id or title; in the index, a theme section missing, repeated, with a
title different from the list's, out of list order or of a nonexistent theme;
and an ADR row under another theme's section, outside any theme section,
repeated or out of numeric order. Unreadable YAML, an empty list or map, or an
index with no theme section is `CEGO` and fails. Each rule is proven by mutation
in `scripts/docs/temas-de-adr.spec.ts`, like the other checkers.

**4. The proposed taxonomy has 15 themes.** It comes from the product's FRONTS —
the same that organize `CLAUDE.md` and the `agent-areas.ts` catalog —, not from
phases nor code folders:

| id | theme | ADRs |
|---|---|---|
| `git` | Git, repository and branch policy | 11 |
| `agentes` | Agent harness, turns and sessions | 11 |
| `time` | The agent team — roles, areas and handoffs | 26 |
| `gates` | Gates, QA and security review | 12 |
| `execucao` | Execution, terminal policy and approvals | 13 |
| `modos` | Where the code lives — execution modes | 9 |
| `container` | Project container and broker | 15 |
| `runner` | The local runner | 11 |
| `iam` | Auth, access and secrets | 13 |
| `llm` | LLM providers, models and spend | 16 |
| `conhecimento` | RAG, knowledge graph and artifacts | 11 |
| `web` | Web UI and design system | 12 |
| `operacao` | Operation, deploy and installation | 15 |
| `engenharia` | CI, release and supply chain | 10 |
| `docs` | Documentation | 7 |

Why THIS list, and the boundaries that are not obvious:

- **`agentes` × `time`.** `agentes` is HOW an agent runs (context, tool loop,
  turn, session, message queue, response language); `time` is WHICH agents exist
  and what they deliver to whom (roles, areas, delegation, handoff, the Psicólogo
  and the Anamnese). Together they would make 37 ADRs — a smaller "Phase 12". The
  conversational Infra Lead (0175) falls in `agentes` because it decides its
  turn; the Dev Lead (0053) in `time` because it decides the role.
- **`modos` × `container` × `runner`.** Three fronts that touch each other in
  every ADR since 0104, and therefore separated by the QUESTION: where the folder
  lives (`modos`), who brings up the container and with what containment
  (`container`), the CLI on the user's machine (`runner`). The runner bringing up
  the container (0137) is `container`; credentialed `git` on the runner's host
  (0193) is `runner`.
- **`execucao` × `gates`.** `execucao` is the policy that holds the agent that
  ACTS (`proposed_action`, path scope, automatic mode, absolute ceilings);
  `gates` is the verdict on what was done.
- **`operacao` joins deploy and installation.** Both answer "how the product runs
  on a machine that is not its developer's" and share backup and the
  installation compose; separated, installation would have 7 ADRs and be the 16th
  theme.
- **`engenharia` takes what belongs to the REPOSITORY and not the product:** the
  pipeline, published images, signing, Trivy, pin by digest, the test layers and
  the schema split by aggregate (0121) — the api's only structural refactoring,
  which would not be looked for in any other theme. The splits of
  `SessionPage.tsx`/`ProjectSettingsTab.tsx` stay in `web`, where whoever touches
  those files looks.
- **Language is not a theme** (only 0177 decides on it, and it is in
  `agentes`); **security is not a theme** — it crosses `iam` (CSP, CORS,
  envelope), `execucao` (ceilings), `container` (broker containment) and
  `engenharia` (supply chain), and a "security" theme would empty four to fill
  one.

Ten to fifteen was the requested range: fewer than ten would join
`modos`/`container`/`runner` or `agentes`/`time`, which is where the by-phase
index failed; more than fifteen would make the theme become the folder.

**5. Who decides a new ADR's theme:** whoever writes it, in the same PR — one
line in `adrs:` and the index row in the theme's section, in numeric order.
Whoever reviews the PR confirms. A NEW theme is a change to the list in
`temas.yml`, justified in the PR that creates it; going beyond 15 requires an ADR
revising this one.

## Consequences

- The index stops having a section per phase, and with it go the opening
  sentences of each phase. The per-phase narrative stays where it was always
  complete, `docs/explanation/historico-de-fases.md`; the open acceptance
  criterion notice of ADRs 0020/0021 goes with them to `gates`.
- A new ADR costs one more line (`temas.yml`), and forgetting it FAILS
  `docs:check` — the same price and the same reason as `verificarIndiceAdr`.
- The theme is a CLASSIFICATION and several ADRs serve two. The index shows each
  one once, in the main one; whoever looks under the other theme does not find it
  there. It is the price of "one theme per ADR", and the alternative (a secondary
  theme) was considered and did not go in: it would duplicate the curated row or
  leave it in two places that age separately.
- Parallel ADRs: the mapping covers the ADRs that existed on `origin/dev` on
  2026-10-01 (from 0001 to 0197, plus this one). Whoever integrates an ADR born on
  another branch adds its line — `docs:check` points out which is missing.
- The pt-BR translation of the index (`website/i18n/pt-BR/.../adr/index.md`)
  stays by PHASE and was already behind (103 of 191 rows); it is not reorganized
  here. The docmap's `traducao-pt-br` rule warns, in `warn`, as always.

## What this ADR does NOT do

- It edits no ADR, not even to fix a title.
- It does not generate the index: the sentences stay hand-curated.
- It creates no RN: the rule is about documentation, like the runbook
  procedures one.

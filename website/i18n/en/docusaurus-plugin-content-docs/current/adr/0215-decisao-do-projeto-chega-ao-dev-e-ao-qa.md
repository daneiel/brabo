---
traducao_de: 1f58364ef056b293fa60dc3aa0ddc5731b64f515
---

# 0215 — The project's decision reaches the dev and QA

## Status

**Accepted.** 2026-10-14 (AT-526; owner decisions on 14/10). REVISES part of
[ADR 0214](0214-pergunta-em-aberto-vira-pendencia.md): the dev context rule "a
decision without an `afeta` touching the task does not go in". Rules in RN-870,
RN-871 and RN-872.

Theme: `gates`. The effect that matters is the QA gate's: it stops repeating a
question the user already answered.

## Context

Measured in TP-01 (15th round, `viralabs-app-2026-10-11b`):

- The user answered "does a nonexistent or deleted code respond 404?" at 15:45.
  The "list and delete links" task belonged to ANOTHER story, and its QA stated
  that the question was still unanswered, gave `needs_user_decision` and the gate
  parked with no open question in the project — the thread had nothing to answer.
- The `afeta.regras` the Criativo records are rule TITLES, and ADR 0214's filter
  (`afetaAlgum`) compares with IDS: no Criativo decision ever matched. Even with
  ids, the cited rules were not those of the task's story.
- The verdict accepted an `openQuestionId` of a nonexistent or already answered
  question, and would park forever.

## Decision

1. **The verdict's `openQuestionId` is checked** (RN-870): it must exist in the
   project and be OPEN, before any write. Nonexistent (or of another project) is
   404 `pergunta_nao_encontrada`; already answered is 409
   `pergunta_ja_respondida` with the decision text in the body (`decisao`),
   without a write and without `pr.gate_changed` — QA reads the decision instead
   of waiting.
2. **`afeta.regras` accepts the exact title** (RN-871): in the event funnel, the
   exact title of a project `artifact.business_rule` becomes the id (the most
   recent, if the title repeats); what is neither an id nor an exact title is a
   named 400. The dev context read also matches by the TITLE of the story's
   rules, for decisions recorded before this rule.
3. **The project's other decisions arrive too** (RN-872, the owner's option
   (a)): `GET /internal/sessions/:sessionId/dev-context` returns, besides
   `decisoes` (those touching the task), `decisoesDoProjeto` — the project's
   other `decision_record`s, in a SEPARATE list, within the SAME ceiling of 10:
   the task's come first and consume the ceiling before. That is what revises
   ADR 0214, whose sentence "a decision without `afeta` does not go in" stops
   holding for the project list (it still holds for `decisoes`).

## Consequences

- The new field is additive: the engine ignores it until the engine lane prints
  the "Other project decisions" section in the dev's kickoff and QA's cut
  (`context_builder.ex` reads the context by `Map.get` with a named key).
- The ceiling of 10 is SHARED. In a project with many decisions, the old ones not
  touching the task are left out — the price of not widening the context.
- `decisoesDoProjeto` includes every project `decision_record`, not only those
  born from a question answered by the user (the Criativo's about technical
  constraints too, RN-711).
- A title repeated across rule versions resolves to the most recent; there is no
  refusal for ambiguity.

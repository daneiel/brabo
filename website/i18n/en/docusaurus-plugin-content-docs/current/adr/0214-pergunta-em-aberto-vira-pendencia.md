---
traducao_de: 9c7537aa5bade6f0ca4b80237a1928a72b654a38
---

# ADR 0214 — An open question becomes a pending item to resolve

## Status

**Accepted.** 2026-10-11 (AT-521; owner decisions on 11/10). Extends
[ADR 0207](0207-ciclo-de-gate-velho-estaciona.md) (gate cycle parking) and
REVISES part of [ADR 0212](0212-historia-arquivada.md) (story correction). Rules
in RN-858, RN-859, RN-860 and RN-861.

Theme: `gates`. The mechanism that really changes behaviour is QA's new verdict,
which does not consume a cycle and parks through ADR 0207's mechanism; the record
and the queue exist so that verdict has someone to ask.

## Context

Measured in TP-01 (14th round):

- The Criativo left **four questions** to the user only in the response TEXT.
  None became a record; nothing on screen listed them after the thread scrolled.
- QA failed `GET /:codigo` for "not confirmed by the user" until it EXHAUSTED the
  correction cycle (RN-762) — **twice**. The second came AFTER the owner answered
  in the chat: the story was already `ready`, ADR 0212 only allows correcting a
  `draft` story, and QA read the story's DoR, which still said "not confirmed".
  The dev had nothing to fix: the decision was the user's, and
  `changes_requested` spent a cycle on every round.

Three things were missing: a RECORD of the question with state, a VERDICT that
says "this depends on the user" without punishing the dev, and a path for the
ANSWER to reach whoever works (the dev's context, QA's cut, the story itself).

## Decision

### 1. The record

- `artifact.open_question` (append-only, in the log of the session where it is
  born): `{ questionId, pergunta (≤ 500), sugestao (≤ 300, optional),
  afeta: { regras, historias, tarefas }, autor, sessionId }`.
- It closes with `open_question.answered`
  `{ questionId, resposta, aceitouSugestao, decisionEventId, respondidaPor }`.
  The STATUS comes from the log (open = no `answered`), never from a table.
- The answer records a `decision_record` (actor: the user) with `context` = the
  question, `choice` = the answer, `consequences` = what it affects, and the
  `questionId`. It is the same generic artifact as RN-505.

### 2. The origin is only the tool

`declare_open_question` (Criativo, PO, Arquiteto, Dev Lead), with ONE CENTRAL
instruction sentence, not repeated per server: "Every doubt you leave for the
user becomes `declare_open_question`, with your suggestion and what it affects;
do not end the turn with a question only in the text."

### 3. Who answers

Only the AUTHOR of the session where the question was born. For QA's question,
the author of the execution session (whoever activated execution). Other members
see the question with the control inert and the reason in text (ADR 0064).

### 4. The routes

- `GET /projects/:projectId/open-questions?status=open|answered|all` —
  `viewer`, `limit` 50 with the total (RN-180).
- `POST /projects/:projectId/open-questions/:questionId/answer` — body
  `{ resposta }` or `{ aceitarSugestao: true }`; 403 `so_o_autor_da_sessao`,
  409 `pergunta_ja_respondida`, 404 for a question of another project.

### 5. Readiness warns and moves on

"I'm ready" (Criativo) and "Confirm architecture ready" show "N questions are
still open — answer", with a shortcut to the queue. They do not block.

### 6. The `needs_user_decision` verdict

`emit_qa_verdict` gains `needs_user_decision` with `{ pergunta, sugestao }` (or an
existing `openQuestionId`). The api does NOT increment the correction counter
(RN-762), records the `open_question` (author `qa-agent`, affecting the task) and
the cycle stays PARKED through ADR 0207's mechanism (`gate.rescue_parked`). The
task appears as "waiting for you". Answering the question turns the gate back on
through `GateRescuer.retomar_estacionado/3` (RN-724's path), and QA judges with
the decision in context. In the QA Lead's consolidation, a subspecialty's
`needs_user_decision` wins over `approved`. QA's cut rule: a requirement marked
"not confirmed by the user" (or contradicted by a current decision) →
`needs_user_decision`, never `changes_requested`.

This EXTENDS ADR 0207: there the cycle parked due to idle time; here it also
parks due to a pending user decision. The resume gesture is the same mechanism,
triggered by the answer.

### 7. The decision reaches whoever works

`GET .../dev-context` returns `decisoes` — those linked to the story/task through
`afeta`, ceiling 10 and 1,500 characters. The dev's kickoff and QA's cut show
"User decisions — they win over FR/DoR when they conflict".

### 8. The PO corrects a `ready` story by the user's answer (revises ADR 0212)

What CHANGES in ADR 0212: `recusaDeCorrecaoDeHistoria` now accepts a `ready`
story when the correction request cites an ANSWERED `questionId`; the PO receives
the answer and fixes FR/DoR. What does NOT change: the refusal with an
`in_review` (and `in_progress`) task stays; archiving stays only for `draft`;
correcting `ready` without an answered `questionId` stays refused; editing by the
user in the Backlog tab follows 0212's rule.

### 9. The screen

An "Open questions" queue in the chat's pending block, with its own title and
count (never summed with the other queues, RN-467): the question, who asked, what
it affects, the suggestion with "Accept suggestion" and a short field with
"Answer" — both only for the session's author. The "N open questions" notice sits
next to "I'm ready" and "Confirm architecture ready".

## Consequences

- Token cost: ~60 tokens per conversational turn (the central sentence and the
  tool description) and up to ~400 in QA's cut / the dev's kickoff when there are
  linked decisions (ceiling of 10 and 1,500 characters).
- The correction cycle stops being spent on what the dev cannot solve.
- The question has an owner: the session's author. A member who is not the
  author does not unlock — declared price (see Alternatives).
- What does NOT change: the absolute ceilings (RN-418), the manual merge into a
  protected branch, the correction cycle ceiling (it only stops counting this
  verdict), ADR 0212's archiving rule, and ADR 0207's time-based parking.

## Alternatives considered

- **Blocking readiness with an open question.** Refused: the question may be a
  detail that does not prevent the PO from moving on; blocking would trade
  forgetting for a lockup. Warning with a shortcut solves the forgetting.
- **Detecting questions in the agent's text.** Refused: a heuristic over prose
  errs both ways and creates pending items nobody declared. The origin is the
  tool, and the central instruction is what makes the agent use it.
- **QA going ahead with the agent's suggestion.** Refused: approving on a guess
  hides the user's decision and is exactly the "not confirmed" requirement QA
  exists not to let through.
- **Any `developer` member answering.** Refused by owner decision: the question
  is about the intent of whoever conducted the session; another member answering
  would swap the owner's decision without them knowing.

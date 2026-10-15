---
traducao_de: 78383039b5006cf39f88edb5054e4f5bb1b43aea
---

# ADR 0185 — "I'm ready — the need is validated": one click closes readiness, the `necessidade-validada` gate and the PO's acceptance

## Status

**Accepted.** 2026-09-30 (AT-311 and AT-312, story HS-079, epic EP-031,
round 32). Owner decision, with the two questions of the AT-309 survey answered
YES:

> "Can a single click 'I'm ready — the need is validated' close both gates,
> even with the product_brief produced after the click?"
>
> "Can the PO's acceptance be implicit in 'I'm ready'?"

Revises the design of [ADR 0095](0095-gate-necessidade-validada.md) (the
`necessidade-validada` gate closes with a SEPARATE click) and
[RN-406](../business-rules.md#rn-406). It does not edit 0095: it records what
changes and what of it still holds.

## Context

Measured on `origin/dev` (`94e5dc721d`), from the AT-309 survey:

- **"Validate need" locked nothing.** The button was enabled only with
  `artifact.product_brief` in the session (`hasProductBrief`,
  `session-readiness.ts`), came AFTER "I'm ready to produce", recorded only
  `necessity.validated` (`ValidateNecessityUseCase`), and the gate is `warn` in
  `docs/gates.yml` — RN-406 itself says nothing in the product CHECKS the
  passage.
- **Accepting the PO was one more click right after "I'm ready".** The
  Criativo→PO handoff is born inside the turn that "I'm ready" triggers
  (`CriativoServer.executar_confirm_readiness/1` →
  `EngineApiClient.create_handoff` → `POST /internal/sessions/:id/handoffs`),
  and the acceptance card called `AcceptHandoffUseCase`, which records the
  transition to `accepted`, `handoff.accepted` (actor the person),
  `agent.activated` (actor the person) and, by RN-635, the `handoff.superseded`
  of the other offers to the PO in the project.
- Three clicks — ready, validate, accept — to express one intent: "what the
  Criativo gathered is right, go ahead".

0095 explicitly refused merging the validation into `confirm_readiness`, with
an argument that is still right: `confirm_readiness` alone is the structural
FLOOR ("≥1 captured rule", RN-142), not a judgment of MERIT, and merging the two
"would keep the shallow floor disguised as a new gate". What answers that
objection here is the LABEL: the click stops being "I'm ready to produce" and
becomes "I'm ready — the need is validated". The person declares both things
with the words of both; the structural floor is still checked by the engine, and
merit is still declared by a human.

## Decision

### 1. One POST, two events (RN-657)

`POST .../sessions/:id/readiness` (`ConfirmReadinessUseCase`) records
`readiness.confirmed`, calls the engine and, **only if the engine accepted the
turn**, records `necessity.validated` with the same person as actor,
`productBriefId: null`, `via: 'readiness.confirmed'` and the `readinessEventId`.
A null `productBriefId` is the answer to the second half of the owner's
question: the brief is born from the turn the click triggers, and the event
points to the CLICK, not to a brief that does not exist yet.

The engine's refusal (409 turn in progress, 422 no rule) surfaces before the
second event: without an accepted turn there is no brief on the way, and the
need is not validated. `readiness.confirmed` is still recorded BEFORE the
command, as always (ADR 0163).

The gate stays `warn`. Nothing started checking it, and promoting it remains a
product decision with its own ADR, as 0095 said.

### 2. The PO's acceptance is implicit, with the SAME events (RN-658)

The `readiness.confirmed` of the new click carries the mark
`{ necessidadeValidada: true, aceiteImplicitoDoPo: true }`. When the engine
creates the Criativo→PO offer through the internal route, the api asks
(`decidirAceiteImplicitoDoPo`, a pure rule) whether it is the offer that click
asked for — `criativo` → `po`, `offered`, from this session, carrying the
`product_brief` born AFTER the most recent marked `readiness.confirmed` — and,
if so, accepts it through `AcceptHandoffUseCase`, the SAME use case as the card,
on behalf of whoever clicked.

The auditable trail is the card's, with no new event: `handoff.accepted` and
`agent.activated` with the person as actor, and the mark
`implicito: { via: 'readiness.confirmed', readinessEventId }` in the payload of
both. Of the two options the owner left (a new event, or the same ones with a
human actor and a mark), the second was chosen because every reader today —
`canActivateAgent`, the handoff list, the graph projection, the screen —
already understands `handoff.accepted`; a new event would require teaching each
one, and a forgotten one would read the PO as never accepted. No event is
edited.

Acceptance happens on the internal route and not on the click's POST because
the offer does not exist at the moment of the click. The acceptance failure does
not surface to the engine (the Criativo would narrate "I couldn't offer the
handoff", false): it becomes a durable `agent.error`, actor
`system`/`aceite-implicito`, with origin. The 400 "is not `offered`" is not a
failure — another tab decided the offer in the interval, and that is already in
the log.

### 3. The engine does not change

Measured: the Criativo expects nothing from the acceptance (the internal route's
response is only matched with `{:ok, _}`), and the PO is activated by the same
usual `startAgent`, whose `kickoff` is a `GenServer.cast`. The only difference
is the MOMENT: the PO comes up inside the offer creation call, still in the
Criativo's turn, and not after a human click.

### 4. The screen

The button is called "Estou pronto — a necessidade está validada" (en: "I'm
ready — the need is validated"), the enabled title says what the click closes
and that the PO comes in on its own, and the success notice repeats that. The
"Confirm validated need" button went away, with `handleValidateNecessity` and
the client's `validateNecessity`. The click also makes the PO the composer's
recipient — it is the gesture of calling it, the same as accepting through the
card (RN-631).

## Consequences

**For**

- From three clicks to one, without touching any ceiling: accepting the PO does
  not provision a repository (only Arquiteto and Dev Lead, RN-582), does not
  merge nor push.
- Validation is still done by a PERSON, never by the Criativo — the
  anti-pattern 0095 existed to avoid is still avoided.
- The acceptance trail is the same as the card's, readable by every existing
  consumer, and the mark says which click it came from.

**Against, declared**

- `necessity.validated` stops pointing to the brief it validated: the link is
  through `readinessEventId`, and the brief is the `artifact.product_brief`
  following that click. Whoever needs the exact pair reads the log in order.
- The validation is declared BEFORE the person reads the summary. That is what
  the owner decided; the gate is `warn` and measures the declaration, not the
  reading.
- `POST .../agents/criativo/validate-necessity` stays in the api, with no
  consumer on screen: it is the path for a session whose "I'm ready" predates
  this ADR (there the acceptance card also stays, because the old event does not
  have the mark). Removing it is an API contract break and is left for when no
  old session uses it.
- The PO comes up without a human click at the moment it comes up. The human
  decided earlier, at the click, and is the recorded actor.

## Alternatives considered

**A new event (`handoff.accepted_implicitly`).** Refused: see point 2 — every
reader of `handoff.accepted` would have to learn the second type.

**Accepting on the click's POST, pre-creating the offer.** Refused: the offer
carries the `product_brief` as artifact and is born from the Criativo's turn;
creating it earlier would require changing the engine and offering a handoff
without the artifact that justifies it.

**Letting the engine call the human acceptance route.** Refused: the human route
requires an authenticated user, and an agent activating an agent is exactly what
the internal route's description refuses. Here the api decides, through the mark
the PERSON recorded.

## References

- [ADR 0095](0095-gate-necessidade-validada.md) — the design this revises
- [ADR 0163](0163-o-clique-responde-ao-aceitar.md) — the click responds on accept
- [ADR 0182](0182-ciclo-de-vida-do-handoff.md) — `superseded`, preserved
- [RN-406](../business-rules.md#rn-406), [RN-657](../business-rules.md#rn-657),
  [RN-658](../business-rules.md#rn-658), [RN-633](../business-rules.md#rn-633),
  [RN-635](../business-rules.md#rn-635)
- `apps/api/src/domain/sessions/estou-pronto.ts`
- `apps/api/src/application/use-cases/agents/confirm-readiness.use-case.ts`
- `apps/api/src/application/use-cases/agents/aceite-implicito-do-po.use-case.ts`

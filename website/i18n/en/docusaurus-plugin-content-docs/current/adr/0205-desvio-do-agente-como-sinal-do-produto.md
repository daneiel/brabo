---
traducao_de: f9a111fcc133a5fcd7195d7ccc74ab40ee414777
---

# ADR 0205 — The agent deviation the Anamnese observes becomes a product signal, without personal data

## Status

**Accepted.** 2026-10-02 (AT-356 part 2, owner decision on 02/10: *"Yes, a
product signal"*). Complements
[ADR 0196](0196-anamnese-religada-com-sujeito-e-fato-do-perfil.md) without
editing it: the Anamnese still maintains the PERSON's profile; what this ADR adds
is a second record, about the AGENTS.

## Context

In the 02/10 test store (AT-376) the Anamnese read as a user trait what was an
agent failure: *"Não vi o handoff aparecer. Pode passar ao Arquiteto?"* became a
"continuity driver" — it was the person covering for the PO's failure. The same
holds for an agent in a loop and for a turn cancelled by the user. That signal
has value, but for whoever improves the PRODUCT, and not for the profile of
whoever produced it.

Measured on `dev` before changing: the Anamnese only had verbs about the person
(`emit_proficiency`, `skip_proficiency`) and about instructions/ceiling
(`propose_instruction_patch`, `propose_max_parallel`, which become
`proposed_action`). There was nowhere to say "agent X deviated" without
attributing it to someone.

## Decision

1. **Its own durable event, `anamnese.agent_deviation`**, recorded in the event
   log of the round's session by the new tool `report_agent_deviation`
   (`:direct`, does not end the round, actor `agent`/`anamnese`).
2. **No personal data, by construction.** The payload is assembled in the engine
   by an ALLOW list: `agente`, `tipo` (closed vocabulary: `laco`,
   `cancelamento_pelo_usuario`, `reparo_pelo_usuario`) and `evidenceEventIds`
   (deduplicated, ceiling of 20). There is no free-text field — it is in one that
   the model would write a name or trait. Session and project come from the
   event's envelope. An extra field the model invents is discarded.
3. **Outside the user's graph.** `GraphEventTranslator` does NOT translate the
   type: the graph is the PERSON's memory (profile, accepted facts), and the
   signal is not theirs. A test pins its absence in
   `EVENTOS_DO_LOG_PROJETAVEIS`.
4. **Reading by event, no new screen.** Whoever improves the product reads by
   querying the event log (`session_events` with
   `type = 'anamnese.agent_deviation'`). The Insights tab gains no reading now:
   it is per project and for whoever decides, and this signal's reader is the
   product's maintainer.

## Consequences

- The user's profile stops absorbing agent failure: the kickoff tells it to
  record the repair as a deviation (RN-716/RN-717).
- **Declared gaps:** the api does not check that the `evidenceEventIds` exist
  (the internal append does not validate this type's payload); there is no
  aggregation nor screen; and recognizing the deviation is the model's — the
  code only guarantees the shape and the absence of personal data.
- Changing the `tipo` vocabulary is a change of this contract, with an RN.

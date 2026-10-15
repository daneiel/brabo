---
traducao_de: 5dd3fb94351ce5b525491df69f91a5b069f21226
---

# 0196 — The Anamnese turned back on: it does not run without a subject, and the accepted hypothesis becomes a profile fact

## Status

**Accepted.** 2026-10-01 (AT-277, story HS-072, epic EP-030, round 36; owner
decision on 01/10: *"turn the Anamnese back on with fixes"* — an eligible
subject guard, and the ACCEPTED hypothesis becomes a profile fact in the graph
and enters the context of the agents that converse with the person; the refused
one is only recorded). Ends the 2026-08-10 pause only for the Anamnese — the
Psicólogo stays paused (`PSYCHOLOGIST_ENABLED=false`). Uses the graph of
[ADR 0099](0099-neo4j-grafo-de-conhecimento-e-templates.md) as it was designed
(memory DERIVED from the event log) and the language's ephemeral guidance path
(RN-622) without editing either.

## Context

Measured in the `dev` code and in the report of the real use of 2026-09-29,
before changing:

- **Six rounds, six `anamnese.run_skipped` written by the MODEL** with the same
  reason, "no eligible member" (sessions `be70`, `67f3`, `d7e9` ×2, `5d66` ×2),
  for 8,933 micros in 6 calls. `anamnese_runs` = 0, `proficiency_profiles` = 0.
- **Where the subject came from:** `GetAnamneseContextUseCase` read
  `ProjectRepository.listMembers`, which is ONLY `project_members`. Creating a
  project writes no row there (`CreateProjectUseCase`), and authorization treats
  the workspace owner as a project member through `projectRole ?? workspaceRole`
  (RN-471). In a one-person project, the list always came back empty.
- **The worker did not look at the list:** `AnamneseWorker.maybe_analyze/3`
  only asked the triage (window volume, hypothesis queue), and a hypothesis in
  the queue FORCED the round. The prompt said "(no eligible member)" and the
  model was paid to conclude that.
- **The accepted hypothesis had no real consumer:** `AcceptHypothesisUseCase`
  enqueued in `anamnese_queue` (3 rows in real use), and the only consumption
  was a round's `propose_instruction_patch` — which, in `5d66` seq 17, answered
  "there is no agent instruction file available in the context". The graph did
  not project `psychologist.hypothesis_accepted`.
- **The graph's read path had no consumer:** `QueryUserContextUseCase` existed
  (hypotheses, profiles, handoffs per user and project) and no code called it.
- `ANAMNESE_ENABLED` had a `false` default in `runtime.exs` and in the three
  composes since RN-540; the report records the real-use engine with the flag
  `true` via environment.

## Decision

1. **The round does not run without an eligible subject.**
   `Engine.Anamnese.Elegibilidade` decides BEFORE the triage, without exception
   (not even the hypothesis queue crosses it): a subject is the project's
   EFFECTIVE member, outside the opt-out, with their OWN interaction in what the
   prompt shows — an `actor_kind: "user"` event of theirs in the window, or a
   decision of theirs. Without a subject: no LLM call, no RAG search, a named
   reason in the engine log (`sem_sujeito_elegivel`, with `nenhum_membro` or
   `nenhuma_interacao_propria` and the numbers) and, only in the round requested
   by hand (`origem: "manual"`), a durable `anamnese.run_skipped`. The prompt
   now lists only the subjects.
2. **A project member is the EFFECTIVE member.** `ProjectRepository` gains
   `listEffectiveMembers` (`membrosEfetivos`, RN-471's rule: the project row
   overrides the workspace one in both directions), used by the Anamnese's three
   use cases. `listMembers` is still only `project_members`, which is what the
   Members screen edits.
3. **The accepted hypothesis becomes a profile FACT, derived from the event
   log.** `psychologist.hypothesis_accepted` now carries `projectId`, `sujeito`
   (the author of the analyzed session), `hipotese`, `sugestao` and
   `fatoDoPerfil`. The `GraphEventTranslator` — the SAME one as the projector
   and `grafo:reprojetar` — translates it into
   `(:FatoDoPerfil {hypothesisId})-[:SOBRE]->(:Usuario)` and
   `-[:NO_PROJETO]->(:Projeto)` (`RecordProfileFactUseCase`, `MERGE` by the
   hypothesis, a new unique constraint). The event is self-sufficient:
   reprojecting does not read `psychologist_hypotheses`.
4. **The fact is only born from the subject's own click.** `fatoDoPerfil` is
   `true` when whoever accepted IS the session's author. A third party's
   acceptance still holds for everything else (status, Anamnese queue) and says
   in the payload why it did not become a fact (`motivoSemFato`). The refused
   one does not change: it is only recorded.
5. **The fact enters the context of the agents that converse with the person.**
   `SendAgentMessageUseCase` reads the facts of the message's AUTHOR through
   `QueryUserContextUseCase` — scoped to the project, the 5 most recent, with the
   total beside — and sends them to the engine as `perfilDoAutor`, text built by
   `textoDoPerfilDoAutor` (2,000 characters at most, cut stated). The engine puts
   them into the turn by the SAME path as the language: the controller joins
   both in a map, `IdiomaDaResposta.com_idioma_do_autor/2` recognizes it, and the
   `EngineApiClient` facade appends the text as an EPHEMERAL `system` message
   before the language guidance (`Engine.Harness.PerfilDoAutor`). No agent server
   changes. Graph down becomes a log, and the turn goes on without the facts.
6. **Turning back on.** The `ANAMNESE_ENABLED` default goes back to `true` in
   `runtime.exs` and in the three composes (the
   `flags-do-engine-no-compose.spec.ts` rule still holds: compose repeats the
   code). `START_ANAMNESE` does not change anywhere: `true` in code, in dev and in
   the installation; `false` in the production compose, a divergence already
   declared. `PSYCHOLOGIST_ENABLED` does not change.

## Consequences

- The 29/09 real use stops spending: a project without a subject does not reach
  the LLM. And the workspace owner in a project without their own row now IS a
  subject — the Anamnese turned back on now does something in the most common
  case, instead of nothing.
- **Declared price:** the Anamnese now profiles whoever is a member only through
  the workspace. A workspace member who never interacted in the project is not
  profiled (not a subject), and the opt-out still holds.
- **Declared price:** each message to a conversational agent makes one more read
  in the graph (four `QueryUserContextUseCase` queries). Without Neo4j
  configured, it is an immediate `GraphUnavailableError` and a log.
- **Declared price:** the facts reach EVERY turn of the author, including the
  agent that was not the hypothesis's target — the label says whom it addressed,
  and filtering by agent is an open decision.
- **Out, declared:** the three acceptances of the real use were recorded before
  this change, without the fact fields, and do NOT become facts on reprojection.
  They remain in the Anamnese queue, which reads them in the next round WITH a
  subject. A turn without an author (kickoff, dev agents, gates) gets no facts.
  The Staff still has no automatic trigger: the Anamnese never fired it in code.
- A tick round without a subject does not become an event (it would be a notice
  every 15 minutes per project); only the one requested by hand narrates.

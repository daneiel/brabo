---
traducao_de: 6aea992eb40df66f9d66e187efea4051efe796d3
---

# 0186 — The PO's handoff to the Arquiteto is accepted without a click when the backlog is covered and the repository is local

## Status

**Accepted.** 2026-09-30 (AT-314, story HS-079, round 32; owner decision on
30/09: *"Can a handoff offered by the PO (LLM) provision the local repository
without a click?"* — **yes**). On top of
[ADR 0165](0165-o-repositorio-nasce-no-handoff-ao-arquiteto.md), which placed
the repository's birth in the acceptance of the handoff to the Arquiteto and
had, as an implicit premise, that this acceptance is always a person's click.
It does not edit it: it **adds a second author of the same acceptance**, with
closed conditions, and leaves the place of provisioning exactly where 0165 put
it.

## Context

Measured in the `dev` code on 2026-09-30 (AT-309 survey):

- The PO finishes the backlog and calls `offer_handoff(to_agent: "arquiteto")`
  (`po_server.ex`, kickoff: *"Cubra TODAS as regras com ao menos uma história.
  Quando o backlog estiver pronto, ofereça um handoff ao arquiteto"*). The offer
  is born `offered` and waits for the "Accept handoff and start Arquiteto"
  click.
- That click is what provisions the repository (`AcceptHandoffUseCase`,
  RN-582). For the `local` repository — the only one the acceptance creates,
  because it is the only provider without a credential — the click chooses
  nothing: there is no hosting to decide nor secret to resolve. It is a
  confirmation step on a path without alternatives.
- Backlog coverage already has ONE computation in the product,
  `computeCoverage` (`domain/backlog/coverage.ts`), used by the Backlog tab
  (`GetCoverageUseCase`) and by the PO's read tool
  (`ListBusinessRulesUseCase`, RN-164): a rule is covered when at least one
  story cites it in `businessRuleIds`.
- The survey's table counted ~11 decision clicks (+N promotions) from the brief
  to execution; this is one of those that protect only themselves.

## Decision

1. **When.** The `po → arquiteto` offer is accepted by the system, in the SAME
   request in which the engine creates it (`POST /internal/sessions/:id/handoffs`),
   after the offer's transaction and never inside it, if and only if:
   - the offer is `offered`;
   - the **backlog is covered** — an objective definition, measured over what
     the PO records: the project has **at least one** business rule
     (`artifact.business_rule`) and **no** rule without a story citing it in
     `businessRuleIds`, through the SAME `computeCoverage` as the Backlog tab.
     Zero rules is not covered: "nothing to cover" does not prove the PO worked;
   - the repository the acceptance touches is **local and without a
     credential**: the project has no repository (the acceptance will provision
     `local`) or the one it has is `local`, and the project has no git
     connection (OAuth) registered in `project_git_connections`;
   - whoever opened the session still has, in the project, the role the human
     acceptance route requires (`developer`, effective role of RN-471).
   The decision is the pure predicate `decidirAceiteAutomatico`
   (`domain/sessions/aceite-automatico-do-handoff.ts`); each "no" has a named
   reason, and that is what the response to the engine returns.
2. **Whoever accepts is still `AcceptHandoffUseCase`.** The new use case
   (`AceitarHandoffAutomaticamenteUseCase`) only READS and DECIDES; with "yes"
   it calls the usual acceptance, which provisions the repository BEFORE
   `activateAgent` (RN-582, ADR 0165). There is no second provisioning path.
3. **Auditable.** The automatic acceptance's `handoff.accepted` is recorded with
   the SYSTEM actor `{kind: 'system', id: 'handoff-auto-accept'}` and payload
   `automatico: true`, `emNomeDe` (whoever opened the session — the repository
   is provisioned on their behalf, `provisionedBy`) and `criterio` (`regras`,
   `cobertas`, `repositorio`). The following `agent.activated` carries the SAME
   actor. Human acceptance does not change: actor `user`, without those fields.
4. **Failure does not surface.** The offer is already committed when the
   automatic acceptance runs, and the engine waits for its response; an
   exception there would become "failed to offer handoff" on an offer that
   exists. So the failure becomes the NEW event `handoff.auto_accept_failed`
   (system actor, `origem: 'infra'`, `error`) and the response says `falhou`.
   The offer card stays there when the acceptance did not get to mark
   `accepted`.
5. **The model is told.** The internal route's response gains
   `aceiteAutomatico: {aceito, criterio?, motivo?}` and, with `aceito: true`,
   `status: 'accepted'`; the engine's `offer_handoff` tells the PO that the
   Arquiteto was already activated and that it should not offer again
   (re-offering would give `409 agente_ja_ativo`, ADR 0182).

## Consequences

- The common path (new project, local repository, a PO that covers the rules)
  loses one click; the thread shows the acceptance with the criterion ("the
  backlog covers the N business rules and the repository is local").
- **A remote or credentialed repository still asks for the click**, as the
  owner asked. A manual handoff (ADR 0109) too: it does not go through the
  internal route.
- A handoff offered by an LLM now produces a git effect (the `local` provider's
  `git init --bare` and the Gitflow bootstrap) without a human click. That is
  the declared price, and it is what the owner approved; the absolute ceilings
  (push, PR, deploy, merge into a protected branch — RN-418) do not move,
  because none of that happens in local provisioning.
- Offers to other destinations, and the offer to the Arquiteto by another
  agent, do NOT get automatic acceptance. Extending to another pair is a new
  ADR.
- The response to the engine takes as long as local provisioning and
  `startAgent` take, within `Req`'s default `receive_timeout`. Not measured on a
  real installation in this session.
- Not measured: the engine was not compiled nor tested in this session (no
  Elixir in the environment); the new `offer_handoff` clause and its ExUnit test
  were written and are left for CI.

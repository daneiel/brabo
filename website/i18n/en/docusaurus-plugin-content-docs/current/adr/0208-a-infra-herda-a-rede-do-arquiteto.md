---
traducao_de: 8d6d3ff7815b9c1a57462ad2061380c148299f42
---

# 0208 — Infra inherits the network the Arquiteto declared

## Status

**Accepted.** 2026-10-02 (AT-392; owner decision on 02/10, "direct egress").
Revises, without editing them, point 3 of
[ADR 0190](0190-a-infra-sobe-o-container-no-aceite.md) (the server's start-up
with a literal `network: "none"`) and departs from §4 of
[ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md),
which asked for the user's authorization for `egress`.

## Context

Measured on 02/10 (project `loja-teste-2`): the Arquiteto decided
`artifact.project_image` v1 with `network: "egress"` ("Egress needed for npm
install…"). On acceptance of the Infra handoff, the server's automatic start-up
(`subir_no_aceite/2`, `infra_lead_server.ex`) proposed `container_start` with
`none`, and `ExecuteContainerStartUseCase` recorded v2 (`infra-lead`) with
`none`, overwriting the Arquiteto's decision. The Node container came up without
network, and `npm install` does not run.

## Decision

1. Infra's election INHERITS the network of the most recent
   `artifact.project_image` emitted by the Arquiteto (`actor_id: "arquiteto"`),
   in any session of the project — read locally by the engine
   (`Event.rede_do_arquiteto/1`, the same Postgres, no HTTP in the loop). It
   applies to the server's start-up on acceptance and to the
   `propose_container_start` tool when the model does not pass `network`.
2. Without an Arquiteto decision (or with a value outside `none`/`egress`), it
   stays `none`, as before.
3. The start-up still happens on its own: ADR 0190's
   `container_start: auto_approve` seed does not change, so `egress` comes up
   without a click.

## Consequences

- The price is DECLARED, not paid: the `egress` network reaches the machine's
  published ports (ADR 0189, edge 5), and the reasoning of `external-effect.ts`
  that "without a network, `curl | sh` reaches nothing" stops holding for every
  project where the Arquiteto declared `egress`. The user consent ADR 0065 §4
  asked for leaves the path by owner decision.
- The version recorded by Infra now repeats the Arquiteto's network instead of
  downgrading it; the artifact's history stays coherent.
- Rule: [RN-723](../business-rules.md#rn-723).

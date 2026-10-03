# 0208 — A Infra herda a rede que o Arquiteto declarou

## Status

**Accepted.** 2026-10-02 (AT-392; decisão do dono em 02/10, "egress direto").
Revisa, sem editá-los, o ponto 3 do
[ADR 0190](0190-a-infra-sobe-o-container-no-aceite.md) (a subida do servidor
com `network: "none"` literal) e se afasta do §4 do
[ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md), que pedia
autorização do usuário para `egress`.

## Context

Medido em 02/10 (projeto `loja-teste-2`): o Arquiteto decidiu
`artifact.project_image` v1 com `network: "egress"` ("Egress necessário para
npm install…"). No aceite do handoff da Infra, a subida automática do servidor
(`subir_no_aceite/2`, `infra_lead_server.ex`) propôs `container_start` com
`none`, e `ExecuteContainerStartUseCase` gravou a v2 (`infra-lead`) com `none`,
sobrescrevendo a decisão do Arquiteto. O container Node subiu sem rede, e o
`npm install` não roda.

## Decision

1. A eleição da Infra HERDA a rede da `artifact.project_image` mais recente
   emitida pelo Arquiteto (`actor_id: "arquiteto"`), em qualquer sessão do
   projeto — lida localmente pelo engine (`Event.rede_do_arquiteto/1`, o mesmo
   Postgres, sem HTTP no laço). Vale para a subida do servidor no aceite e para
   a tool `propose_container_start` quando o modelo não passa `network`.
2. Sem decisão do Arquiteto (ou com valor fora de `none`/`egress`), segue
   `none`, como antes.
3. A subida continua sozinha: a semente `container_start: auto_approve` do ADR
   0190 não muda, então `egress` sobe sem clique.

## Consequences

- O preço é DECLARADO, não pago: a rede `egress` alcança as portas publicadas
  da máquina (ADR 0189, borda 5), e o raciocínio de `external-effect.ts` de que
  "sem rede, `curl | sh` não alcança nada" deixa de valer para todo projeto em
  que o Arquiteto declarou `egress`. O consentimento do usuário que o ADR 0065
  §4 pedia sai do caminho por decisão do dono.
- A versão gravada pela Infra passa a repetir a rede do Arquiteto em vez de
  rebaixá-la; o histórico do artefato fica coerente.
- Regra: [RN-723](../business-rules.md#rn-723).

# ADR 0215 — A decisão do projeto chega ao dev e ao QA

## Status

**Accepted.** 2026-10-14 (AT-526; decisões do dono em 14/10). REVISA uma parte
do [ADR 0214](0214-pergunta-em-aberto-vira-pendencia.md): a regra "decisão sem
`afeta` que toque a tarefa não entra" do contexto do dev. Regras em RN-870,
RN-871 e RN-872.

Tema: `gates`. O efeito que importa é o do gate de QA: ele deixa de repetir
uma pergunta que o usuário já respondeu.

## Context

Medido no TP-01 (15ª rodada, `viralabs-app-2026-10-11b`):

- O usuário respondeu "código inexistente ou apagado responde 404?" às 15:45.
  A tarefa "listagem e exclusão de links" era de OUTRA história, e o QA dela
  afirmou que a pergunta seguia sem resposta, deu `needs_user_decision` e o
  gate estacionou sem pergunta aberta no projeto — o fio não tinha o que
  responder.
- O `afeta.regras` que o Criativo grava são TÍTULOS de regra, e o filtro do
  ADR 0214 (`afetaAlgum`) compara com IDS: nenhuma decisão do Criativo casava
  nunca. Mesmo com ids, as regras citadas não eram as da história da tarefa.
- O veredito aceitava `openQuestionId` de pergunta inexistente ou já
  respondida, e estacionaria para sempre.

## Decision

1. **O `openQuestionId` do veredito é conferido** (RN-870): tem de existir no
   projeto e estar ABERTO, antes de qualquer escrita. Inexistente (ou de outro
   projeto) é 404 `pergunta_nao_encontrada`; já respondida é 409
   `pergunta_ja_respondida` com o texto da decisão no corpo (`decisao`), sem
   escrita e sem `pr.gate_changed` — o QA lê a decisão em vez de esperar.
2. **`afeta.regras` aceita o título exato** (RN-871): no funil de eventos, o
   título exato de um `artifact.business_rule` do projeto vira o id (o mais
   recente, se o título se repete); o que não é id nem título exato é 400
   nomeado. A leitura do contexto do dev também casa pelo TÍTULO das regras da
   história, para as decisões gravadas antes desta regra.
3. **As outras decisões do projeto chegam também** (RN-872, opção (a) do
   dono): `GET /internal/sessions/:sessionId/dev-context` devolve, além de
   `decisoes` (as que tocam a tarefa), `decisoesDoProjeto` — as demais
   `decision_record` do projeto, numa lista SEPARADA, dentro do MESMO teto de
   10: as da tarefa vêm primeiro e consomem o teto antes. É isto que revisa o
   ADR 0214, cuja frase "decisão sem `afeta` não entra" deixa de valer para a
   lista do projeto (continua valendo para `decisoes`).

## Consequences

- O campo novo é aditivo: o engine o ignora até a lane do engine imprimir a
  seção "Outras decisões do projeto" no kickoff do dev e no recorte do QA
  (`context_builder.ex` lê o contexto por `Map.get` com chave nomeada).
- O teto de 10 é COMPARTILHADO. Num projeto com muitas decisões, as antigas
  que não tocam a tarefa ficam de fora — o preço de não alargar o contexto.
- `decisoesDoProjeto` inclui toda `decision_record` do projeto, não só as
  nascidas de pergunta respondida pelo usuário (as do Criativo sobre
  restrição técnica também, RN-711).
- Título que se repete entre versões de regra resolve para a mais recente;
  não há recusa por ambiguidade.

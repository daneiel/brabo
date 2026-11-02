# ADR 0233 — O membro vê o gasto do projeto por agente e por área, nunca por provider

- **Status:** aceito
- **Data:** 2026-10-31
- **Revisa:** [ADR 0063](0063-duas-audiencias-para-o-mesmo-gasto.md) (as duas
  audiências do mesmo gasto), no ponto em que o membro só enxergava o PRÓPRIO
  consumo; o [ADR 0076](0076-provider-volta-a-ser-dimensao-de-gasto.md) segue
  valendo inteiro (provider é eixo do owner e fora do alcance por tipo)
- **Contexto anterior:** [RN-058](../business-rules/custo.md#rn-058),
  [RN-060](../business-rules/custo.md#rn-060),
  [RN-101](../business-rules/custo.md#rn-101),
  [RN-187](../business-rules/custo.md#rn-187)

## Contexto

O pedido do dono (AT-632, 31/10) separa a página de gastos em GLOBAL e POR
PROJETO. O ADR 0063 deixava o membro só com `spend/me` (o próprio consumo como
ator), embora o custo por agente já apareça para `developer` em Configurações >
Modelos. A decisão do dono foi: o membro vê o TOTAL do projeto e o custo por
agente/área, sem provider nem credencial.

## Decisão

1. `GET /projects/:projectId/spend/team` (`viewer`): total do projeto e custo por
   agente e por área do catálogo. O escopo é o do projeto, sem ator, mas o caso
   de uso só pede a dimensão `actor`; não há parâmetro de dimensão na rota.
   Provider e credencial continuam exclusivos do owner (RN-060, RN-186).
2. `GET /workspaces/:workspaceId/spend/me` (`viewer`): o consumo PRÓPRIO somado
   por projeto, para o não-owner na página global. Escopo de ator, então
   `provider` nem compila (RN-187).
3. O relatório do owner ganha `?projectId=` (404 para projeto de outro
   workspace) e a dimensão `session`.
4. A marca curada `billing` (`api|subscription|free`) em `models` separa
   `assinaturaMicros` do US$ pago.

## Consequências

- O membro passa a ver quanto o time (agentes) gastou no projeto. Isso é fato
  do projeto, não da fatura da chave; a fatura segue do owner.
- O que o membro NÃO ganha: provider, credencial, consumo de outra pessoa.
- A recusa em `CriativoKpis` (web) deixa de ser regra; a tela é da lane web.

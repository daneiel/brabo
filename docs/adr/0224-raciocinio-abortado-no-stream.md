# ADR 0224 — O raciocínio é contado no stream e abortado no limite, e o custo é estimado e reconciliado

## Status

**Accepted.** 2026-10-22 (AT-589, EP-026, decisões do dono). Tema: `llm`.
Complementa, sem editá-lo, o [0223](0223-orcamento-de-raciocinio-por-modelo.md) e usa a
coluna `price_implicit` do [0188](0188-o-custo-real-do-provider-vira-o-numero-do-metering.md).

## Contexto

O [0223](0223-orcamento-de-raciocinio-por-modelo.md) só limita quem respeita o campo
`reasoning.max_tokens`. O `deepseek/deepseek-v4.1-flash` ignora todo campo de limite
(8192 de raciocínio em 8192), e foi para ele que a AT-589 nasceu: abortar a conexão no
stream é a única forma de limitá-lo. Medição paga de 22/10 (OpenRouter): todo chunk de
raciocínio traz `delta.reasoning` (texto); `caracteres/4` aproxima os tokens (3,9 no
deepseek, 3,8 no qwen); abortar cobra só o que já foi gerado (~521 de 529 tokens). Mas a
resposta abortada NÃO traz `usage` nem `finish_reason`, e o custo real só aparece em
`GET /api/v1/generation?id=` uns 5 minutos depois (antes, 404).

## Decisão

1. O provider OpenAI-compatível conta `delta.reasoning` (caracteres/4) quando o modelo
   tem `reasoning_budget`, e ao passar do limite aborta a conexão e emite o chunk
   `truncated` com `motivo: "raciocinio"` (o truncamento por `max_tokens` não tem motivo).
   Modelo sem orçamento não conta nem aborta.
2. Gasto da chamada abortada = ESTIMATIVA NA HORA: tokens de saída = caracteres/4 (de
   raciocínio e texto), de entrada pelo estimador (ou caracteres/4 se não houver), ao
   preço do catálogo, com `price_implicit` e a nova `token_usage.custo_a_reconciliar`.
3. RECONCILIAÇÃO: `ReconciliarCustoEstimadoUseCase` roda por `setInterval` no próprio
   processo da api (o mesmo mecanismo dos projetores; sem fila nova, sem Redis), a cada
   `CUSTO_RECONCILIACAO_INTERVAL_MS` (5 min; `0` desliga). Só olha linhas marcadas das
   últimas 24 h, e troca pelo `total_cost` do `/generation` apenas com 200; a linha
   trocada guarda a estimativa em `catalog_cost_micros`. Qualquer outra resposta deixa a
   linha para a próxima passada; após 24 h a estimativa fica definitiva.
4. A migração 0075 cria a coluna e põe `reasoning_budget` 2048 no
   `deepseek/deepseek-v4.1-flash` (openrouter), no molde da 0074.

## Consequências

- O contrato do provider ganha `truncated.motivo` e `usage.abortadoPeloRaciocinio`
  (aditivos); o metering ganha a coluna.
- Limites declarados: o `spentMicros` de budget e área NÃO é corrigido pela reconciliação
  (a estimativa já o incrementou; a diferença é de centavos); a chave usada é a do owner
  do workspace; várias instâncias da api reconciliam em paralelo sem dano (a troca só
  atua em linha ainda marcada); tool calls parciais do stream abortado são descartadas.

## Referências

- [0223](0223-orcamento-de-raciocinio-por-modelo.md), [0188](0188-o-custo-real-do-provider-vira-o-numero-do-metering.md).
- [RN-915](../business-rules/custo.md#rn-915), [RN-914](../business-rules.md#rn-914).

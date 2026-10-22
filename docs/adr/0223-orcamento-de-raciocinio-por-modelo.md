# ADR 0223 — O orçamento de raciocínio é capability POR MODELO, curada à mão

## Status

**Accepted.** 2026-10-22 (AT-569, EP-026, opção C do dono). Tema: `llm`. Segue o
[0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md) e o
[0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md) (capability
só é afirmada quando provada; curadoria manual) e revisa, sem editá-la, a
[RN-782](../business-rules.md#rn-782) pela [RN-914](../business-rules.md#rn-914).

## Contexto

O PO no `deepseek/deepseek-v4.1-flash` gastou 8192 de 8192 tokens só em
raciocínio, três vezes seguidas, e nenhuma história foi criada (TP-01 18ª). A
RN-782 tirou o campo `reasoning` de todos os modelos porque no Haiku ele era
ignorado ou ligava o raciocínio. A medição paga de 22/10 (16 chamadas, ids de
geração em `~/brabo-gravacoes/raciocinio-smoke-2026-10-22/resultados.jsonl`,
conferidos em `GET /api/v1/generation`) separou os modelos.

## Decisão

1. Capability `reasoningBudget` POR MODELO: coluna `models.reasoning_budget`
   (inteiro, `NULL` = não provado), curada à mão pela migration, nunca
   descoberta — o upsert do sync não a escreve.
2. `qwen/qwen3.7-flash` = provado: `reasoning: { max_tokens: N }` foi respeitado
   exato (1024 pedidos, 1024 em `native_tokens_reasoning`, nas duas chamadas).
   N = **2048**. O `buildBody` manda o campo só para modelo com orçamento, com
   `max_tokens` = saída visível + N (RN-741).
3. `deepseek/deepseek-v4.1-flash` = `NULL` por medição: `reasoning.max_tokens`
   (1024 e 256), `reasoning.effort` e `reasoning_effort` deram os mesmos 8192 de
   raciocínio, sem texto nem tool call. Fica fora por prova, não por omissão; a
   contenção dele segue sendo `reasoningOff` (RN-783/838).
4. `effort` nunca é usado: ignorado no qwen (1191 contra 643 sem campo) e no
   deepseek.
5. Ressalva do qwen: o limite contém o raciocínio, mas NÃO garante a tool call —
   no prompt difícil ele continuou pensando no texto visível (11 551 caracteres)
   e esgotou o teto sem chamar a ferramenta.

## Consequências

- Modelo sem orçamento: corpo byte a byte o de antes (RN-782).
- Marcar outro modelo exige smoke próprio citado no PR.
- Pendência: a faceta de thinking da tela do catálogo não mostra o orçamento.

## Referências

- [0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md),
  [0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md).
- [RN-782](../business-rules.md#rn-782), [RN-914](../business-rules.md#rn-914).

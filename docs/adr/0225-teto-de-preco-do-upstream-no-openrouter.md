# ADR 0225 — O OpenRouter recebe um teto de preço por chamada (`provider.max_price` = catálogo × 1,5)

## Status

**Accepted.** 2026-10-28 (AT-606, EP-026, decisões do dono de 27/10). Tema: `llm`.
Estende o [0166](0166-preferencia-de-roteamento-no-binding-de-modelo.md) (que só
mandava `provider.sort` e deixava `max_price` como decisão de produto própria)
e convive com o [0221](0221-upstream-preso-por-sessao.md) (`session_id`), sem
editar nenhum dos dois. Segue o
[0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md): a
capability só vira `true` com prova contra a API real.

## Contexto

Na 18ª rodada do TP-01, o `deepseek/deepseek-v4.1-flash` passou por 17
upstreams e o custo real foi 1,85× o de catálogo; o custo por milhão de entrada
variou de US$ 0,044 a 0,268. O `session_id` do 0221 prende o agente ao upstream
que o atendeu, mas pode prendê-lo a um upstream CARO (o Together, onde o smoke
da AT-580 grudou, custa 2,1× a entrada e 2,9× a saída do catálogo). O
`provider.max_price` do OpenRouter é um FILTRO por preço (US$ por milhão,
entrada e saída) que se combina com o `sort`, que é uma ORDEM.

## Decisão

1. O Brabo manda `provider.max_price = { prompt, completion }` = **preço de
   catálogo do modelo × 1,5**, por chamada, nas chamadas ao OpenRouter
   (`StreamLlmTurnUseCase`, `RunLlmTurnUseCase`, `SendChatMessageUseCase`). O
   fator (`FATOR_DO_TETO_DE_PRECO`) é **fixo no código** e **ligado por padrão**
   em todo modelo com preço de catálogo > 0 nas duas pontas; preço 0
   (desconhecido) não manda teto. Com 1,5 passam cerca de 11 dos 41 endpoints do
   deepseek, e ficam de fora o Together e os de US$ 0,30+. Mudar o fator é ADR
   novo.
2. Capability nova `priceCeiling` em `LLMProviderCapabilities`, `false` nos
   nove outros providers e `true` no OpenRouter depois do smoke
   `openrouter-provider.teto.smoke.spec.ts`. Declará-la sem o hook
   `campoDeTetoDePreco` falha na construção. O objeto `provider` do teto é
   MESCLADO com o do `sort` (espalhá-los lado a lado apagaria o `sort`).
3. **404 por nenhum upstream no teto**: o 404 de uma chamada que levava teto vira
   o erro NOMEADO `LLMPriceCeilingError` (`code: price_ceiling`), distinto de
   `LLMModelNotFoundError`. Os três casos de uso **repetem UMA vez sem teto**
   (no mesmo laço da RN-916), gravam `token_usage.price_ceiling_factor` nulo
   nessa linha e avisam no log; o turno não falha por política de custo.
4. **Metering:** `token_usage.price_ceiling_factor` (`real`, nulável) congela o
   fator que FOI AO FIO, no molde do `routing_preference` (RN-583). `null` =
   nada enviado.
5. **Fora**: filtro de quantização (a qualidade por upstream não foi medida e
   seria um segundo critério), `provider.only`/`ignore` (lista curada por modelo
   fica velha sozinha e pede mapa nome→slug) e `order` (desliga o sticky). O Jev
   (ADR 0179) não recebe o teto.

## Consequências

- O `sort` escolhe a ordem entre os baratos; o `session_id` mantém o upstream; o
  teto tira os caros do sorteio quando o grude cai.
- Preço de catálogo velho ou manual (`manual_pricing`) dá teto errado; sem
  upstream no teto, a repetição sem teto mede o excesso (linha com fator nulo).
- O DTO de `GET /llm/provider-capabilities` ganha `priceCeiling`.

## Referências

- [0166](0166-preferencia-de-roteamento-no-binding-de-modelo.md) — a preferência
  de roteamento.
- [0221](0221-upstream-preso-por-sessao.md) — o `session_id`.
- [RN-917](../business-rules/custo.md#rn-917).

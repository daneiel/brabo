# 0188 — O custo real que o provider devolve vira o número do metering

## Status

**Accepted.** 2026-09-30 (AT-270 e AT-272, história HS-070, épico EP-030, rodada 34;
decisão do dono em 30/09: *"o custo real vira o número"* — quando o provider
devolve o que cobrou, é esse o valor gravado e mostrado, com
`estimated = false`; o preço do catálogo fica só onde não há custo real).
Complementa o
[ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
(preço congelado e auditável) e o
[ADR 0076](0076-provider-volta-a-ser-dimensao-de-gasto.md) (o provider como
dimensão de gasto) sem editá-los: o preço congelado continua existindo e
continua sendo o número de toda chamada cuja resposta não diz o custo; o que
muda é qual das duas fontes vence quando as duas existem. Estende ao CHAT o
desenho que o [ADR 0179](0179-o-laco-pergunta-ao-jev-qual-ferramenta.md) pôs
para o custo da decisão de ferramenta do Jev — a MESMA coluna
`price_implicit` e a MESMA função `precoImplicitoPorMilhao` —, em vez de uma
segunda forma de dizer "este custo é o real".

## Context

Medido no código de `dev` em 2026-09-30, antes de mudar:

- O custo gravado em `token_usage.cost_micros` saía de UM lugar, repetido em
  três casos de uso — `RunLlmTurnUseCase` (276 das 305 linhas do uso real de
  29/09), `StreamLlmTurnUseCase` (28) e `SendChatMessageUseCase` (1):
  `calculateCostMicros(tokens, preço de models)`. Nenhum outro caminho grava
  metering (`RecordLlmUsageUseCase` é o único, e só repassa o número).
- `OpenAICompatibleProvider.chat` lia, do frame de `usage`, só
  `prompt_tokens` e `completion_tokens`. Descartava `usage.cost` (o custo que o
  OpenRouter cobrou, em USD), `model` (o modelo que SERVIU — o alias
  `~deepseek/deepseek-flash-latest` resolve para uma versão datada) e `id`
  (`gen-…`, o identificador que `GET /api/v1/generation?id=` aceita). O
  achado da análise de uso real (`openai-compatible-provider.ts:237-245`)
  reproduz byte a byte em `dev`.
- A distância é medida, não suposta: o uso real de 29/09 somou US$ 0,314259
  pelo preço congelado (20 000 / 600 000 micros por milhão), e a chave de teste
  registrou US$ 0,5807 no dia (1,85×). Repreçado pelo provider SUBJACENTE que
  `upstream_provider` já gravava, o teto sem cache dá ≈ US$ 0,917. O preço de
  catálogo de um hub é o de UMA rota; o hub cobra pela rota que usou.
- O `usage.cost` já era a fonte de gasto de todas as medições pagas feitas
  contra o OpenRouter (`docs/explanation/medicao-do-idioma.md`,
  `medicao-do-jev.md`, `scripts/idioma/validar.ts`): o campo existe na
  resposta real de `/chat/completions` e é por ele que o gasto delas foi
  somado, nunca pelo contador de `/key`.

## Decision

1. **Precedência.** Quando o chunk de `usage` traz `costMicros`, ele É o
   `cost_micros` da linha, o número que o engine soma ao orçamento local do
   laço (`usage.costMicros` do turno), o que incrementa os budgets de projeto,
   sessão e área, e o que a aba Gastos soma. Sem ele, o preço congelado do
   catálogo (ADR 0042) produz o número, como sempre. Uma função de domínio
   decide as duas coisas — `custoDaChamada` (`domain/llm/custo-da-chamada.ts`)
   —, e os três casos de uso passam por ela; não há segunda régua.
2. **O preço da linha com custo real é IMPLÍCITO.** `custo ÷ tokens`, o mesmo
   valor nas duas colunas de preço (o provider devolve UM custo; dividi-lo entre
   entrada e saída seria inventar a proporção), e `price_implicit = true` diz
   isso. É o que mantém `tokens × preço = custo` (RN-044) reproduzível, a menos
   do arredondamento do preço inteiro, sem fingir que existe um preço de tabela
   que produziu o número. É a MESMA fórmula (`precoImplicitoPorMilhao`) e a
   MESMA coluna do ADR 0179.
3. **O que o catálogo teria cobrado vai ao lado**, em `catalog_cost_micros`,
   só nas linhas cujo número é o real (`null` nas outras). É o que o card pedia
   ("gravar o custo real ao lado do estimado") e é o que deixa medir, linha a
   linha, a distância que a análise de 29/09 mediu no agregado.
4. **`estimated` não muda de significado.** Ele continua dizendo se os
   TOKENS foram contados pelo provider ou estimados localmente (RN-041). Uma
   linha com custo real tem `estimated = false` porque o custo só chega junto
   do `usage` do provider; a marca de que o CUSTO é o real é `price_implicit`.
   Reaproveitar `estimated` para as duas perguntas apagaria a distinção
   "o provider disse 0 tokens" × "o provider não disse nada".
5. **O modelo resolvido e o id da geração são gravados** — `resolved_model_name`
   e `generation_id`, lidos de `model` e `id` do frame por TODO provider do
   dialeto (são campos do próprio dialeto `/chat/completions`, não quirk de
   hub). `model_name` continua sendo o nome do CATÁLOGO: é a dimensão dos
   relatórios (RN-101/RN-186) e o vínculo com `model_id`; trocá-lo pelo
   resolvido partiria o mesmo binding em N linhas de relatório a cada nova
   versão datada do alias.
6. **Quem lê o custo é um hook de config, não a base.** `extrairCustoReal`
   em `OpenAICompatibleConfig`, configurado SÓ no OpenRouter
   (`extrairCustoRealOpenRouter`). Provider sem o hook ignora um `usage.cost`
   mesmo presente — a unidade e o significado do campo são do hub, e a regra
   da Fase 9 é que particularidade de provider vira hook/flag, nunca `if`. Não
   nasce capability nova em `LLMProviderCapabilities`: o custo é observado POR
   RESPOSTA, e a ausência dele degrada sozinha para o catálogo, linha a linha.
7. **BYOK não é custo real.** Com `usage.is_byok === true`, o `cost` é a
   taxa do hub e a inferência é cobrada pelo provedor por fora; gravar só a
   taxa seria gravar MENOS do que foi cobrado — o defeito que este ADR fecha
   —, então a linha cai no catálogo. Custo que não é número finito e não
   negativo também é "não disse", nunca zero; zero de verdade (modelo
   gratuito) é custo real.

8. **As partes da entrada e da saída são gravadas** (AT-272, RN-666):
   `cached_input_tokens` (`usage.prompt_tokens_details.cached_tokens`) e
   `reasoning_tokens` (`usage.completion_tokens_details.reasoning_tokens`),
   lidos pela base para todo provider do dialeto, porque são campos da própria
   OpenAI. São PARTES de `input_tokens`/`output_tokens`, nunca somadas a eles,
   e não recalculam custo: com o custo real, o desconto do cache já está no
   número; sem ele, o catálogo não tem preço de cache para aplicar, e inventar
   um seria outra estimativa. `null` é "não disse", distinto de 0. A medição
   (`medir-execucao.ts`) passa a dizer, por agente, quanto da entrada foi cache
   lido — só sobre as chamadas que informaram, e em quantas — e em quantas o
   custo é o real. O intervalo que a análise de 29/09 deixou como hipótese
   (entre US$ 0,58 e 0,92, dependendo do cache) passa a ser medível nas
   chamadas novas; as 305 antigas seguem sem a informação.

## Consequences

- O número da aba Gastos, dos budgets e do orçamento local do laço passa a ser
  o que o OpenRouter cobra, nas chamadas que ele mede. Um mesmo relatório soma
  linhas reais e linhas estimadas; `price_implicit` distingue as duas por linha.
- **Budget pode "saltar".** Um budget calibrado sobre o preço de catálogo
  enxerga, a partir daqui, um gasto até ~1,85× maior pelas mesmas chamadas
  (a medida de 29/09): thresholds de 70/90/100% chegam antes. É o comportamento
  pedido — o orçamento passa a ser do dinheiro, não da estimativa —, e fica
  declarado para quem calibrou teto antes.
- **A tela ainda diz "estimado".** O subtítulo da aba Gastos do membro
  (RN-101) afirma que o custo é estimado. Como a tela distingue real de
  estimado — um rótulo por linha, uma proporção, ou só trocar a frase — é
  decisão de produto pendente do dono; nenhuma tela foi tocada aqui, e a api
  não expõe `price_implicit` em rota nenhuma ainda.
- **Prova sem chave.** Não há credencial do OpenRouter nesta máquina: a prova
  é a RESPOSTA GRAVADA na suíte de contrato
  (`openrouter-provider.contract.spec.ts`, com a forma de `usage` que as
  medições pagas leram) e o smoke manual (`openrouter-provider.smoke.spec.ts`)
  passa a exigir `price_implicit` e o `gen-…` com credencial. O significado de
  `cost` em BYOK é LEITURA da documentação, não medição.
- **Uma coluna, dois autores.** `price_implicit` nasceu na migration 0066 (o
  Jev); esta decisão só acrescenta um segundo escritor dela, e a migration 0067
  cria apenas as três colunas novas. Uma linha com `price_implicit = true` é o
  Jev (`model_name = typesafe/jev-1.13`, `model_id` nulo) ou uma chamada de
  chat com custo real (`model_id` preenchido, `catalog_cost_micros` não nulo);
  o Jev não grava `catalog_cost_micros`, porque não tem preço de catálogo.
- **Anthropic fica de fora das partes.** Ele informa cache no protocolo
  próprio (`cache_read_input_tokens`), que o adaptador dele não lê; as linhas
  dele gravam `null` nas duas colunas. Nenhum outro provider muda.
- O que o modelo resolvido e o id destravam — conferir a cobrança de uma
  linha com `GET /generation?id=`, repreçar por versão datada — fica por
  construir; aqui só se grava.

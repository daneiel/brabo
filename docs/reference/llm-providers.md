---
id: llm-providers
title: Providers de LLM
sidebar_label: Providers de LLM
sidebar_position: 9
description: O contrato único que torna Ollama, OpenAI e Anthropic intercambiáveis, com capabilities por provider e por modelo, sync de catálogo, ciclo de vida do modelo, erros normalizados e teto de inatividade.
keywords: [LLM, provider, OpenAI, Anthropic, Ollama, capabilities, tool calling, streaming, catálogo, preço]
---

# Providers de LLM

Todo agente e todo chat do Brabo falam com um modelo por trás de um contrato
só. Quem chama não sabe se do outro lado está um Ollama no disco, a API da
OpenAI ou a da Anthropic — e não deveria saber.

Decisão em [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md),
com o teto de inatividade herdado do [ADR 0020](../adr/0020-destravar-gates-qa-secops.md).

## O contrato

`LLMProvider` (`apps/api/src/application/ports/llm-provider.port.ts`) tem uma
operação só, e ela é sempre streaming:

```ts
abstract class LLMProvider {
  abstract readonly name: LLMProviderName;
  abstract readonly capabilities: LLMProviderCapabilities;
  abstract chat(
    messages: ChatMessage[],
    options: ChatOptions,
  ): AsyncGenerator<ChatStreamChunk>;
}
```

Não há método separado para tool calling nem para contagem de tokens: as
ferramentas vão em `options.tools` e tudo volta pelo mesmo stream, como um dos
quatro tipos de `ChatStreamChunk`.

| chunk | quando |
| --- | --- |
| `text_delta` | pedaço de texto gerado |
| `tool_calls` | o modelo pediu ferramentas (chunk único, não incremental) |
| `usage` | contagem de tokens, com a marca `estimated` |
| `error` | falha classificada por `code` — **nunca uma exceção** |

Uma falha vira chunk, e não exceção, porque o turno já gastou tokens: o
metering precisa acontecer mesmo quando a resposta não veio.

## Capabilities: duas camadas

**Do provider** é o teto do que aquele backend sabe fazer. **Do modelo** é o que
aquela linha da tabela `models` sabe fazer. Um modelo pode ser mais pobre que o
provider, nunca mais rico.

| capability | onde vive | usada para |
| --- | --- | --- |
| `streaming` | provider + `models.supports_streaming` | — |
| `toolCalling` | provider + `models.supports_tool_calling` | recusar binding de agente ([RN-040](../business-rules.md#rn-040)) |
| `listModels` | só provider | ligar/pular o sync de catálogo ([RN-043](../business-rules.md#rn-043)) |
| `context_length` | `models.context_window` | orçamento de contexto |
| `vision` | `models.supports_vision` | reservado |

<!-- BEGIN:GENERATED:providers-capabilities -->

> ⚠️ Bloco gerado por `pnpm docs:generate`. Não edite à mão — o próximo build sobrescreve.

Lido dos literais de `capabilities` em `apps/api/src/infrastructure/llm/` — **9 providers**.

| provider | streaming | tool calling | list_models | credencial | origem dos modelos | quirks resumidos | fonte |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `anthropic` | sim | sim | sim | chave de API | sync + seed | — | `apps/api/src/infrastructure/llm/anthropic-provider.ts` |
| `bitdeer` | sim | sim | não | chave de API | seed | `Authorization: Bearer <chave>` CONFIRMADO; `GET /v1/models` existe e é autenticado; Três ids de modelo REAIS confirmados; Nenhum quirk de stream/erro confirmado | `apps/api/src/infrastructure/llm/bitdeer-provider.ts` |
| `deepinfra` | sim | sim | sim | chave de API | sync + seed | O catálogo é PÚBLICO — sem autenticação nenhuma; `stream_options.include_usage` confirmado suportado; Erro em shape padrão | `apps/api/src/infrastructure/llm/deepinfra-provider.ts` |
| `nvidia-nim` | sim | sim | não | chave de API | seed | Sem header próprio; Tool calling é por MODELO, não por API; `stream_options.include_usage` não confirmado | `apps/api/src/infrastructure/llm/nvidia-nim-provider.ts` |
| `ollama` | sim | sim | sim | nenhuma (local) | sync + seed | — | `apps/api/src/infrastructure/llm/ollama-provider.ts` |
| `openai` | sim | sim | sim | chave de API | sync + seed | — | `apps/api/src/infrastructure/llm/openai-provider.ts` |
| `openrouter` | sim | sim | sim | chave de API | sync | Headers próprios; Id de modelo prefixado pelo upstream; Catálogo com pricing na própria linha; Erro NO MEIO do stream | `apps/api/src/infrastructure/llm/openrouter-provider.ts` |
| `together` | sim | sim | sim | chave de API | sync + seed | Unidade do preço NÃO documentada explicitamente pela Together; Ids namespaced; `stream_options.include_usage` não confirmado; 429 carrega `error_type: dynamic_request_limited \| dynamic_token_limited` | `apps/api/src/infrastructure/llm/together-provider.ts` |
| `vultr` | sim | sim | não | chave de API | seed | Tool calling CONFIRMADO com exemplo real; Sufixo `-normalize` | `apps/api/src/infrastructure/llm/vultr-provider.ts` |

Provider sem `list_models` é PULADO pelo sync de catálogo, com o motivo
registrado no relatório — nunca tratado como "o catálogo ficou vazio".
"Origem dos modelos": `sync` descobre sozinho, `seed` só entra por
`apps/api/src/db/seed.ts`, `sync + seed` tem os dois (seed é só bootstrap
antes do primeiro sync). "Quirks resumidos" são os RÓTULOS em negrito da
seção de prosa do provider abaixo — o porquê de cada um está lá, não aqui.
<!-- END:GENERATED:providers-capabilities -->

O default de `supports_tool_calling` é `false`. É de propósito: modelo
descoberto por sync automático (Fase 9c) entra sem promessa que ninguém
verificou. Os modelos do seed declaram a capability explicitamente, e a
migração `0026` faz o mesmo backfill nos bancos já existentes — dirigido às
sete linhas do seed, nunca um `UPDATE` cego na tabela.

:::caution Modelo inserido à mão
`models` não tem endpoint HTTP de edição: quem acrescenta um modelo faz por
`seed.ts` ou por SQL direto. Nos dois casos, **declare
`supports_tool_calling`** se pretende vincular esse modelo a um agente — o
default `false` faz o binding ser recusado, inclusive quando o modelo é
apontado por `DEMO_QA_MODEL` nos scripts de demo dos gates.
:::

## Catálogo de modelos: descoberta e ciclo de vida

Quem declara `listModels` sabe listar o próprio catálogo. A base compatível
implementa o `GET /models` do dialeto que já fala, com o parsing substituível
por configuração (`parseCatalogo`) — um hub devolve preço e janela na mesma
linha, e isso não pode virar `if` dentro do parsing padrão.

**Ollama e Anthropic agora declaram `true`** — o backlog que o
[ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
deixou aberto. Eles declaravam `false` não por falta de endpoint, mas porque o
formato não tinha sido verificado na doc oficial, e a regra é não codar contra
contrato adivinhado. Os dois formatos foram verificados antes de uma linha de
código:

- **Anthropic** — `GET /v1/models` devolve
  `{ data: [{ id, display_name, max_input_tokens, ... }], has_more, last_id }`,
  paginado **por cursor** (não por offset): `last_id` vira o `after_id` da
  próxima página, com `limit` de 1 a 1000. Quem percorre é o
  `client.models.list` do SDK oficial, que já faz a auto-paginação — refazer o
  laço de cursor à mão seria reescrever código mantido pelo vendor. Preço **não
  vem** na resposta, então o modelo entra sem preço em vez de com preço
  inventado.
- **Ollama** — `GET /api/tags` devolve `{ models: [{ name, model, size, ... }] }`
  no host local (`OLLAMA_HOST`, default `http://localhost:11434`). Sem preço,
  como convém a um runtime local.

Os dois LANÇAM em caso de erro, como o contrato exige: devolver lista vazia
seria lido pela reconciliação como "sumiram todos" e indisponibilizaria o
catálogo inteiro ([RN-043](../business-rules.md#rn-043)).

### Os dois eixos de disponibilidade

Um modelo tem dois estados INDEPENDENTES, e confundi-los era o buraco que a
Fase 9c fechou:

| onde | quem escreve | o que significa |
| --- | --- | --- |
| `workspace_models.is_active` | o **owner daquele workspace**, pela tela de curadoria | aparece no seletor e pode receber binding novo |
| `models.availability` | o **sync**, sozinho | `unavailable` = sumiu do catálogo do provider |

Um modelo pode estar ativo E indisponível ao mesmo tempo — é esse cruzamento
que gera o aviso na tela. Quando o provider o traz de volta, a escolha do owner
continua valendo: o sync nunca religa o que alguém desligou de propósito.

Os dois eixos deixaram de morar na mesma tabela no
[ADR 0049](../adr/0049-curadoria-de-modelo-por-workspace.md). A curadoria é
**por workspace** — `models.is_active` era uma coluna para a instalação
inteira, e um owner do workspace A ligando um modelo o ligava para o B
([RN-052](../business-rules.md#rn-052)). O que sobrou em `models` é fato do
provider: nome, preço, capabilities e disponibilidade, iguais para todo mundo.

**Ausência de linha em `workspace_models` É o desligado.** Não existe estado
"nunca decidido" separado, e é assim que a RN-043 continua valendo sem coluna
nenhuma que o sync possa atropelar.

### As três regras da reconciliação

1. **Modelo novo entra INATIVO** — sem linha de curadoria em workspace nenhum.
   Um catálogo tem centenas de linhas; despejá-las ativas tornaria a escolha
   impossível e ligaria modelo caro sem ninguém decidir.
2. **Modelo que sumiu vira `unavailable`, nunca é deletado.** `model_bindings` e
   `token_usage` apontam para a linha; apagá-la levaria junto o histórico de
   custo.
3. **Falha do provider não indisponibiliza nada.** Um 401 significa "não sei o
   que tem lá", não "não tem nada lá" — marcar tudo como sumido por causa de uma
   chave revogada derrubaria todos os bindings daquele provider de uma vez. O
   provider é PULADO, com a origem da falha (`infra` | `modelo`) no relatório.

### E as duas regras de preço da reconciliação

4. **`manual_pricing` vence o catálogo remoto.** Linha marcada assim tem um
   número que alguém digitou da doc do provider, e o sync não encosta nele —
   nem quando o catálogo traz preço próprio
   ([RN-051](../business-rules.md#rn-051)).
5. **Toda troca de preço pelo sync deixa linha em `model_price_changes`**, com
   origem `sync` e `changed_by` nulo ([RN-044](../business-rules.md#rn-044)).

Modelo NOVO descoberto pelo sync nasce `manual_pricing = false` quando o
catálogo informou preço — a origem é o sync, e é ele quem mantém a linha em
dia. Descoberto SEM preço, nasce `true`: a linha está esperando alguém digitar,
e marcá-la já protege esse número do primeiro catálogo que resolver informar
preço.

### A cascata revalida capability ao cair de nível

`resolveBinding` pula o candidato indisponível e segue a precedência. Quando o
turno carrega ferramentas, ele também pula quem não faz tool calling **em todo
nível** — sem isso o fallback de um agente pousaria num modelo chat-only e
violaria a [RN-040](../business-rules.md#rn-040) em silêncio: a falha só
apareceria depois, no ToolLoop, como "o agente parou sozinho". O que foi pulado
volta em `skipped`, e a UI mostra.

### Quem agenda e quem executa

O engine agenda (worker Oban auto-reagendado, `MODEL_SYNC_INTERVAL_SECONDS`,
6h por default) e a api executa, porque é ela que tem as credenciais e o
registry de providers. O botão "Atualizar catálogo" da tela de curadoria chama
o **mesmo** caso de uso — não existem duas reconciliações que possam divergir.

## Preço: vale daqui em diante, nunca para trás

`token_usage` guarda o preço que produziu cada `cost_micros`
(`input_price_per_million_micros` e `output_price_per_million_micros`). O custo
histórico já era imutável antes da Fase 9c; o que faltava era ser
**reproduzível** — sem o preço gravado, `tokens × preço = custo` deixava de
fechar assim que alguém corrigisse a tabela.

Toda mudança de preço grava uma linha em `model_price_changes`, append-only,
com o par antes/depois e a origem (`manual` | `sync`). O par vai junto de
propósito: reconstruir o "antes" a partir da linha anterior dependeria de
nenhuma escrita ter escapado do caminho auditado, que é justamente o que a
auditoria existe para provar.

:::caution Duas escritas escapavam
A origem `sync` existia no domínio desde a Fase 9c e **nenhuma escrita a
produzia**: o sync trocava preço pelo `upsert`, por fora do caminho auditado.
O `seed.ts` fazia o mesmo — e ele roda sobre banco já semeado (`BRABO_FORCE_SEED=1`
no `bootstrap.sh` do k8s), então corrigir um preço no seed trocava o número em
silêncio. Os dois passaram a auditar; o seed reusa o
`UpdateModelPricingUseCase` em vez de repetir a lógica, e o chama **antes** do
upsert — depois dele os dois valores já seriam iguais e a auditoria trataria
como no-op.
:::

:::note Não é evento de outbox
`model_price_changes` é tabela própria, e não uma linha em `outbox_events`. O
`Engine.Outbox.Drain.run_once/0` filtra `aggregate_type == "session"` — uma
linha de preço lá ficaria com `processed_at` nulo para sempre e sujaria a
métrica de lag da outbox. É log de domínio imutável, como `session_events`.
:::

## Erros normalizados

Ninguém decide nada por substring da mensagem do vendor: a decisão é pelo
`code` do chunk. As classes vivem em
`apps/api/src/domain/llm/llm-provider-errors.ts`.

| status do provider | `code` | significa |
| --- | --- | --- |
| 401, 403 | `auth` | chave ausente, inválida ou sem acesso ao modelo |
| 404 | `model_not_found` | o modelo não existe nesse provider |
| 429 | `rate_limit` | cota ou throughput estourado |
| 413, ou 400 com marcador de contexto | `context_length` | o prompt não cabe na janela |
| — | `timeout` | o provider ficou **mudo** além do teto de inatividade |
| — | `connection` | nem chegou a falar com o provider |
| qualquer outro | `upstream` | falhou do lado de lá por outro motivo |

O 400 só vira `context_length` quando o corpo traz um marcador conhecido
(`context_length_exceeded` e variantes). Casar por marcador é frágil, então o
413 — que é inequívoco — vem antes, e um 400 sem marcador cai em `upstream` em
vez de mentir sobre a causa.

## Teto de inatividade

O teto não é de duração total, é de **silêncio**. Um turno legítimo pode
demorar muito (um modelo processa milhares de tokens de prompt antes do
primeiro token), mas nunca fica quieto. É a lição do ADR 0020, onde o `fetch`
desistia aos 300s fixos do undici com um opaco "fetch failed" e o agente
registrava "o modelo parou" para uma requisição que nunca foi respondida.

| provider | mecanismo | env |
| --- | --- | --- |
| Ollama | timeout de socket do `node:http` | `OLLAMA_REQUEST_TIMEOUT_MS` |
| Base OpenAI-compatível | idem | `LLM_REQUEST_TIMEOUT_MS` |
| Anthropic | `withIdleTimeout` sobre o stream do SDK | `LLM_REQUEST_TIMEOUT_MS` |

O Ollama tem env própria porque um modelo local tem outra ordem de grandeza de
latência até o primeiro token.

## A base OpenAI-compatível

`OpenAICompatibleProvider` implementa o dialeto `/chat/completions` uma vez só.
Nove providers nascem dela: OpenAI (a primeira instância), OpenRouter (Fase
11a, o hub), e os cinco da Fase 11b — NVIDIA NIM, Together, DeepInfra,
Bitdeer, Vultr. Todos mudam `baseUrl`, header de auth e flags — nunca o
parsing (a única exceção provada necessária foi o `parseCatalogo` de cada
um, quando a capability é `true` — ver as seções por provider abaixo).

```ts
interface OpenAICompatibleFlags {
  streamOptionsIncludeUsage: boolean;
  maxTokensField: 'max_tokens' | 'max_completion_tokens';
}
```

Cada flag existe porque um provider real diverge. Não acrescente flag sem um
provider que precise dela.

## Divergências normalizadas

Os três providers passam o mesmo contrato, mas os dialetos não são iguais. O
que diverge está normalizado, não escondido:

| assunto | Ollama | Base compatível | Anthropic |
| --- | --- | --- | --- |
| formato | NDJSON | SSE `data:` | SSE com eventos nomeados |
| transporte | `node:http` | `node:http` | SDK oficial + `withIdleTimeout` |
| ids de tool call | não manda — geramos | manda; geramos se faltar | manda |
| argumentos de tool call | já desserializados | string fatiada, remontada por índice | `input_json_delta`, remontado pelo SDK |
| resposta sem `usage` | não emite chunk | conta local com `estimated: true` | **impossível** — `usage` é obrigatório no `message_start` |
| papel `tool` | mensagem própria | `role: "tool"` + `tool_call_id` | bloco `tool_result` num turno de `user` |

A última linha do Anthropic é a que mais custa: resultados de chamadas
paralelas precisam vir no **mesmo** turno de `user`, então mensagens `tool`
consecutivas são agrupadas.

## OpenRouter — o primeiro hub (Fase 11a)

`OpenRouterProvider` é `OpenAICompatibleProvider` com `openrouterConfig()`
(`apps/api/src/infrastructure/llm/openrouter-provider.ts`). Declara
`listModels: true` — o único ponto de código que muda quando uma capability
liga é a config, o `SyncModelCatalogUseCase` já lida com o resto.

Quirks encontrados e testados
(`test/infrastructure/llm/openrouter-provider.contract.spec.ts`):

- **Headers próprios**: `HTTP-Referer` (de `API_PUBLIC_URL`) e `X-Title:
  "Brabo"` — opcionais na doc oficial (atribuição/ranking no site do
  OpenRouter), mandados sempre porque não custam nada;
- **Id de modelo prefixado pelo upstream** (`openai/gpt-4o-mini`,
  `anthropic/claude-3-5-sonnet`): o prefixo é o vendor PEDIDO, não o que
  respondeu — ver `extrairUpstreamProvider` abaixo;
- **Catálogo com pricing na própria linha**: `GET /v1/models` devolve
  `pricing.prompt`/`pricing.completion` como STRING decimal em USD **por
  token**, diferente do padrão `{ data: [{ id }] }` só-com-id da OpenAI.
  `parseCatalogoOpenRouter` converte para micro-USD por milhão
  (`* 1e12`, arredondado — a coluna é `bigint`);
- **Erro NO MEIO do stream**: o OpenRouter aceita a conexão e começa a mandar
  texto antes de saber se o provedor real por trás vai falhar — um modo de
  falha que a OpenAI não tem, porque não roteia pra infraestrutura de
  terceiros. O frame vem como
  `{"error":{"code":"...","message":"..."},"choices":[...]}`; presença de
  `error` truthy é o sinal. Código numérico usa o mesmo `normalizeHttpStatus`
  do erro pré-stream; código string é mapeado por substring
  (`mapearCodigoDeFrame`) com `upstream` como default seguro — nunca silêncio,
  mesmo pra um código fora do mapa;
- **Teste de conexão**: `GET /key` (doc oficial) valida a chave sem gastar
  tokens numa chamada de chat real. É o primeiro `LLMCredentialConnectionTester`
  do lado LLM. Desde o [ADR 0050](../adr/0050-credencial-sempre-cifrada-verificacao-explicita.md)
  ele **não roda no cadastro**: a credencial é cifrada e gravada sem
  julgamento, e a verificação é a ação explícita
  `POST /users/me/credentials/{provider}/test`, sobre a chave já gravada.
  Provider sem teste declarado (hoje: `ollama`/`anthropic`/`openai`) responde
  `nao_suportado` — nunca um `ok` de mentira ([RN-055](../business-rules.md#rn-055)).

O aceite com credencial real que a Fase 11a exige — cadastro, sync populando
o catálogo, ativação curada e sessão de chat de ponta a ponta com custo
congelado em `token_usage` — é
`test/infrastructure/llm/openrouter-provider.smoke.spec.ts`. Nunca roda em
CI: sem `OPENROUTER_TEST_KEY` no ambiente, o `describe` inteiro é pulado com
um aviso. Mesmo molde dos smokes de git contra API real
(`github-provider.smoke.spec.ts`, `gitlab-provider.smoke.spec.ts`).

## NVIDIA NIM (Fase 11b)

`NvidiaNimProvider` é `OpenAICompatibleProvider` com `nvidiaNimConfig()`
(`apps/api/src/infrastructure/llm/nvidia-nim-provider.ts`), apontado pro
endpoint **hospedado** (`integrate.api.nvidia.com`) — não o produto de
container auto-hospedado, que é outro produto com outro endereço.

- **`listModels: false`**: `GET /v1/models` existe (doc oficial verificada
  nesta sessão) e devolve `id`/`object`/`created`/`owned_by`, mas nenhuma doc
  encontrada traz preço por token — catálogo real, porém inutilizável para o
  custo por modelo que o metering exige (capabilities em duas camadas, ADR
  0041). O provider vive de **seed manual**
  (`apps/api/src/db/seed.ts`) até alguém confirmar um endpoint de preço, se
  existir;
- **Sem header próprio**: `Authorization: Bearer nvapi-...` — bearer padrão,
  a chave só tem o prefixo `nvapi-` por convenção da NVIDIA;
- **Tool calling é por MODELO, não por API**: só modelos específicos (Llama
  3.1 70B/405B, variantes Nemotron, ...) suportam de fato — mas isso nunca é
  um flag de config, é inteiramente `models.supports_tool_calling`
  (seed/curadoria), confirmado lendo `buildBody()` na base: o flag de
  `capabilities.toolCalling` só decide se o parâmetro `tools` é enviado, não
  se o modelo específico sabe usá-lo;
- **`stream_options.include_usage` não confirmado** para o endpoint
  hospedado (só documentado para o software NIM auto-hospedado) —
  `streamOptionsIncludeUsage: false`; o fallback `estimated` da base cobre o
  caso de o campo nunca vir;
- **Teste de conexão**: sem endpoint de validação dedicado (nenhum
  "whoami"/saldo encontrado) — `GET /v1/models` com a chave, só o
  status importa (200 vs 401/403).

:::info A NVIDIA não cobra por token
A busca por preço oficial foi refeita e chegou a uma resposta melhor que "não
encontrei": **não existe preço por token pra encontrar**. A doc oficial
([docs.api.nvidia.com/nim/docs/product](https://docs.api.nvidia.com/nim/docs/product))
diz que o endpoint hospedado é acesso gratuito de **prototipagem** pra membro
do Developer Program, e que produção exige licença NVIDIA AI Enterprise —
"These licenses start at $4500 per GPU per year or ~ $1 per GPU per hour in the
cloud". A unidade é GPU/hora, não token.

Os três modelos de NIM no seed seguem, portanto, com preço **estimado** por
comparação com equivalentes noutros providers e `manual_pricing = true`: é o
suficiente pra o teto de orçamento ter o que descontar, e é o máximo de
honestidade possível enquanto o modelo comercial do vendor não for por token.
:::

O aceite com credencial real fica em
`test/infrastructure/llm/nvidia-nim-provider.smoke.spec.ts`, gated por
`NVIDIA_NIM_TEST_KEY`. Diferente do OpenRouter, o passo de "sync" não
descobre nada (a capability é `false` de propósito) — o smoke confirma que o
provider é `pulado: 'sem_capability'` no relatório e cura um modelo inserido
manualmente, exatamente como um owner faria em produção.

## Together AI (Fase 11b)

`TogetherProvider` é `OpenAICompatibleProvider` com `togetherConfig()`
(`apps/api/src/infrastructure/llm/together-provider.ts`).

- **`listModels: true`**: `GET /v1/models` documentado com `pricing:
  {input, output, cached_input, base, hourly, finetune}` — só `input`/
  `output` são usados;
- **Unidade do preço NÃO documentada explicitamente pela Together**: os
  valores são NÚMERO (não string como o OpenRouter) e, por comparação com
  preço de mercado publicado (Llama 3.3 70B a US$ 1,04/1M em
  together.ai/models — mesma ordem de grandeza do exemplo `"input": 0.3` do
  schema oficial), a inferência é **USD por MILHÃO de tokens direto**, não
  por token. O smoke test é quem confirma isto contra uma chave real (ver
  comentário no topo de `together-provider.smoke.spec.ts`) — se algum dia
  provar errado, é achado a corrigir aqui e no parser, não silenciar;
- **Ids namespaced**: `meta-llama/Llama-3.3-70B-Instruct-Turbo` — um id
  "achatado" tipo OpenAI (`gpt-4o`) responde 404;
- **`stream_options.include_usage` não confirmado** na doc — mesmo
  tratamento cauteloso da NIM, fallback `estimated` cobre;
- **429 carrega `error_type: dynamic_request_limited | dynamic_token_limited`**
  no corpo — não testado à parte porque o corpo ainda é
  `{error: {message}}`, compatível com o parsing padrão da base; só relevante
  se algum dia precisarmos distinguir os dois tipos de rate limit;
- **Teste de conexão**: sem endpoint dedicado — `GET /v1/models` status-only.

O aceite com credencial real fica em
`test/infrastructure/llm/together-provider.smoke.spec.ts`, gated por
`TOGETHER_TEST_KEY`.

## DeepInfra (Fase 11b)

`DeepInfraProvider` é `OpenAICompatibleProvider` com `deepinfraConfig()`
(`apps/api/src/infrastructure/llm/deepinfra-provider.ts`), `baseUrl`
`https://api.deepinfra.com/v1/openai` (a superfície OpenAI-compatível —
DeepInfra também tem endpoints nativos fora dela, não usados aqui).

- **`listModels: true`**, confirmado AO VIVO nesta sessão contra
  `GET {baseUrl}/models` (o MESMO endpoint que a base já chama por padrão,
  nenhuma extensão precisou ser feita): a resposta traz `metadata.pricing.
  {input_tokens,output_tokens}` (USD por milhão, número — mesma convenção
  inferida pra Together) e `metadata.context_length` por linha;
- **O catálogo é PÚBLICO — sem autenticação nenhuma**, confirmado ao vivo
  (a chamada funcionou sem header `Authorization`). Isso tem uma
  consequência real: **não existe teste de conexão pra DeepInfra**
  (`llm-credential-connection-tester.ts` não tem entrada pra ela) — uma
  chave inválida só seria descoberta na primeira chamada de CHAT de
  verdade, nunca no cadastro. Nenhum outro endpoint autenticado de
  validação foi encontrado publicamente documentado;
- **O catálogo mistura chat com imagem/áudio/vídeo/embedding na MESMA
  lista**, cada tipo com um shape de `pricing` diferente
  (`per_image_unit`, `input_characters`, `output_seconds`, ...) —
  `parseCatalogoDeepInfra` filtra por `metadata.tags.includes('chat')`
  antes de tentar ler `input_tokens`/`output_tokens`; sem o filtro, um
  modelo de imagem entraria com um preço fabricado a partir de um campo
  que não é "por token" nenhum;
- **`stream_options.include_usage` confirmado suportado** na doc
  (diferente de NIM/Together) — `streamOptionsIncludeUsage: true`;
- **Erro em shape padrão** `{"error": {"message", "type", "param", "code"}}`
  — compatível com o parsing padrão da base, sem `parseErrorFrame` próprio.

O aceite com credencial real fica em
`test/infrastructure/llm/deepinfra-provider.smoke.spec.ts`, gated por
`DEEPINFRA_TEST_KEY` — e é o primeiro smoke onde o passo de CADASTRO não
valida nada, só o passo de CHAT descobriria uma chave ruim.

## Bitdeer (Fase 11b)

`BitdeerProvider` é `OpenAICompatibleProvider` com `bitdeerConfig()`
(`apps/api/src/infrastructure/llm/bitdeer-provider.ts`) — a doc pública
mais rasa dos cinco desta fase.

- **`listModels: false`**: nenhum shape de catálogo/preço foi encontrado
  publicamente (a página de preço renderiza via JS, sem exemplo acessível a
  uma busca não-interativa) — sem shape verificado, não há `parseCatalogo`
  honesto pra escrever. Reverificado: `bitdeer.ai/en/pricing/ai-models`
  continua montando a tabela no cliente (o HTML servido não traz **nenhum**
  nome de modelo) e não há doc de preço fora dela. O preço do seed segue
  ESTIMADO;
- **`Authorization: Bearer <chave>` CONFIRMADO** (exemplo de curl real
  encontrado na doc da API de embeddings da Bitdeer nesta sessão) — mesmo
  quando o resto do dialeto não tinha exemplo nenhum;
- **`GET /v1/models` existe e é autenticado** (401 ao vivo sem chave,
  confirmado nesta sessão) — vira teste de conexão (status-only, igual aos
  outros sem endpoint dedicado);
- **Três ids de modelo REAIS confirmados** em exemplos de configuração do
  próprio blog da Bitdeer (não são nome de vitrine): `moonshotai/Kimi-K2.5`,
  `zai-org/GLM-5`, `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B` — semeados em
  `apps/api/src/db/seed.ts` com preço ESTIMADO (mercado do modelo/família
  noutros providers, não confirmado pela própria Bitdeer);
- **Nenhum quirk de stream/erro confirmado** — a claim "OpenAI REST API
  standards" da Bitdeer não veio acompanhada de exemplo real de
  `/chat/completions`, então o contract test não hidrata nenhuma
  particularidade que a doc não provou. O smoke test é a PRIMEIRA
  confirmação real do dialeto.

O aceite com credencial real fica em
`test/infrastructure/llm/bitdeer-provider.smoke.spec.ts`, gated por
`BITDEER_TEST_KEY`.

## Vultr Serverless Inference (Fase 11b)

`VultrProvider` é `OpenAICompatibleProvider` com `vultrConfig()`
(`apps/api/src/infrastructure/llm/vultr-provider.ts`) — o único dos cinco
onde a decisão de `listModels` **mudou durante a implementação** em relação
ao plano original.

- **`listModels: false`** (o plano original apontava `true`): a base
  SEMPRE chama `{baseUrl}/models` (`openai-compatible-provider.ts`,
  `listModels()`), e a própria referência oficial da Vultr
  (`api.vultrinference.com`) descreve `GET /models` como devolvendo só
  `id`/`created`/`object`/`owned_by`/`features` — **sem preço**. O
  endpoint que a doc associa a preço (`GET /provider`, com `cost`/
  `contextWindow`) devolveu **404 ao vivo** no caminho testado nesta sessão
  — dado insuficiente pra escrever um `parseCatalogo` sem risco de apontar
  pra uma URL errada ("true frágil"). `GET /v1/models` em si está
  confirmado (401 ao vivo sem chave, duas vezes) — só não tem preço;
- **Tool calling CONFIRMADO com exemplo real**: doc oficial
  (`docs.vultr.com/how-to-use-tool-calling-with-vultr-serverless-inference`)
  mostra `kimi-k2-instruct` respondendo com `finish_reason: "tool_calls"` —
  dialeto OpenAI padrão puro, sem campo estranho nesse exemplo específico;
  os outros dois modelos semeados (`llama-3.3-70b-instruct-fp8`,
  `deepseek-r1-distill-llama-70b`) não têm confirmação de tool calling —
  `supportsToolCalling: false` pra eles;
- **Sufixo `-normalize`**: pesquisa inicial apontava um proxy normalizador
  documentado — NÃO foi possível reconfirmar essa doc nesta sessão (a busca
  direcionada não encontrou o termo nas páginas verificadas). Não usado por
  padrão de qualquer forma (mantemos id de modelo cru);
- **Teste de conexão**: `GET /v1/models`, status-only.

:::tip Preço da Vultr é OFICIAL, e é tarifa única
Diferente de NIM e Bitdeer, a Vultr **publica** a tarifa —
[na doc de uso e custo do Serverless Inference](https://docs.vultr.com/support/products/serverless/how-do-i-monitor-the-usage-and-cost-of-my-vultr-serverless-inference-subscription):
"Requests are billed at $0.55 per 1,000,000 input tokens and $2.75 per
1,000,000 output tokens." É tarifa **do serviço**, não do modelo — a doc não
diferencia por modelo, e por isso as três linhas do seed repetem o mesmo par
(`550_000` / `2_750_000` micros).

A estimativa que estava lá errava na direção perigosa: `400_000` de **saída**
em dois dos três modelos, contra `2_750_000` reais. O metering subestimava o
custo de saída em quase 7× — e é a saída que domina a conta de um agente que
escreve código.

`manual_pricing` continua `true`, e isso não é contradição: a flag significa
"preço digitado por gente lendo doc, em vez de vindo de sync"
(`apps/api/src/db/schema.ts`). O que mudou é que o número agora é o do
provider, não uma comparação de mercado.
:::

O aceite com credencial real fica em
`test/infrastructure/llm/vultr-provider.smoke.spec.ts`, gated por
`VULTR_TEST_KEY`.

## Hubs e o custo real

Num **hub** (OpenRouter) quem aparece na chamada é o hub, mas quem custa é o
provedor que serviu. O metering registra os dois:

- `ChatUsageChunk.upstreamProvider` — o provider preenche quando o hub informa;
- `token_usage.upstream_provider` — texto livre e **nullable**. Não é enum: o
  conjunto é do hub, muda sem aviso e não é nosso para versionar. `null`
  significa "não veio de hub, ou o hub não informou";
- as métricas `brabo_llm_tokens_total` e `brabo_llm_cost_micros_total` ganharam
  o rótulo `upstream_provider`, e o dashboard executivo tem um painel de custo
  por provedor subjacente. Sem hub, o rótulo repete o próprio provider — com
  rótulo vazio, `sum by (upstream_provider)` mostraria só o que passou por hub
  e faria parecer que o resto não custou nada.

A leitura do campo no frame é um **hook de configuração** da base
(`extrairUpstreamProvider`), não um `if` dentro do parsing: cada hub põe a
informação num lugar diferente, e a regra da fase é que particularidade de
provider vira configuração.

`models.manual_pricing` marca preço digitado da doc do provider em vez de
sincronizado. O sync de catálogo **não sobrescreve** preço de linha marcada sem
decisão explícita — e quando o catálogo remoto não informa preço, o valor
gravado é preservado em vez de zerado: campo ausente significa "o provider não
disse", nunca "é de graça".

### Exemplo: o mesmo modelo, hub × direto

A promessa da Fase 11a ("custo comparável entre 'mesmo modelo via hub' e
'direto' fica consultável") só vira uso real quando o MESMO modelo aparece
dos dois lados — hoje é o caso de qualquer modelo que a OpenAI/Anthropic
publicam e que também está no catálogo do OpenRouter (ex.: GPT-4o):

```promql
# Razão de custo: servido via OpenRouter vs. servido direto na OpenAI,
# no mesmo período. > 1 significa que o hub saiu mais caro que o direto.
sum(rate(brabo_llm_cost_micros_total{provider="openrouter", upstream_provider="openai"}[1h]))
  /
sum(rate(brabo_llm_cost_micros_total{provider="openai"}[1h]))
```

Isto é o gancho que `upstream_provider` habilita — hoje sem nenhum
consumidor automático. A leitura pretendida (registrada como semente, não
implementada) é o Psicólogo um dia sugerir "este modelo sai mais barato
direto que via hub" a partir da mesma métrica.

## A suite de contrato

`apps/api/test/contract/llm-provider.contract.ts` roda a mesma bateria contra
qualquer implementação, como a suite de git faz desde a Fase 2. A divisão é o
ponto: **o contrato é dono das asserções, o harness é dono do dialeto.**

Um provider novo escreve só o harness — traduzir cada cenário para o seu
formato de fio — e herda os testes de stream com frame partido, usage
presente e ausente, tool calling, os quatro erros e o servidor mudo. O
servidor falso é um `node:http` de verdade em porta efêmera, não um mock de
`fetch`: o que está sob teste é justamente o comportamento de socket.

## Tool calling e o resgate do engine

O `ToolCallRecovery` do engine (ADR 0020) recupera chamadas que um modelo
pequeno escreveu em prosa em vez de usar o campo `tools`. Ele é **resgate, não
licença**: depende de o modelo acertar o formato por acaso e falha em silêncio
quando não acerta. Por isso vincular um modelo sem tool calling nativo a um
agente é recusado no domínio, e não apenas desencorajado.

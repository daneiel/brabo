---
id: llm-providers
title: Providers de LLM
sidebar_label: Providers de LLM
sidebar_position: 9
description: O contrato único que torna Ollama, OpenAI e Anthropic intercambiáveis, com capabilities por provider e por modelo, erros normalizados e teto de inatividade.
keywords: [LLM, provider, OpenAI, Anthropic, Ollama, capabilities, tool calling, streaming]
---

# Providers de LLM

Todo agente e todo chat do Brabo falam com um modelo por trás de um contrato
só. Quem chama não sabe se do outro lado está um Ollama no disco, a API da
OpenAI ou a da Anthropic — e não deveria saber.

Decisão em [ADR 0040](../adr/0040-base-openai-compativel-e-contrato-de-llm-providers.md),
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
| `toolCalling` | provider + `models.supports_tool_calling` | recusar binding de agente ([RN-038](../business-rules.md#rn-038)) |
| `context_length` | `models.context_window` | orçamento de contexto |
| `vision` | `models.supports_vision` | reservado para a Fase 9c |

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
A OpenAI é a primeira instância dela; os providers da Fase 9b (NVIDIA NIM, Deep
Infra, Together, Bitdeer, Vultr, OpenRouter) mudam `baseUrl`, header de auth e
flags — nunca o parsing.

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

## Hubs e o custo real (preparo da Fase 9b)

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
sincronizado. Quem sincronizar preço na Fase 9c não pode sobrescrever uma linha
marcada sem decisão explícita — para provider que não expõe catálogo, o número
manual é o único que existe.

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

# ADR 0075 — Embeddings no contrato de LLMProvider

- **Status:** aceito
- **Data:** 2026-08-14
- **Estende:** [ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md),
  [ADR 0043](0043-seis-providers-de-llm-e-o-fechamento-da-fase-9b.md)

## Contexto

O Chat RAG que vem por aí precisa transformar texto em vetor, e o produto não
sabe fazer isso. A busca é literal: **a palavra "embedding" aparecia em um
comentário**, na prosa do `bitdeer-provider.ts`, explicando que o único exemplo
de `curl` autenticado encontrado na doc da Bitdeer era o da API de embeddings
deles. Nenhum provider implementa a operação, nenhum tipo a descreve, nenhuma
capability a declara.

Três coisas tornam isto mais do que "acrescentar um método".

**1. A capability é uma dimensão nova, não uma variação das que existem.** As
capabilities de hoje — `streaming`, `toolCalling`, `listModels`, e as colunas
`supports_*` de `models` — falam de como o modelo CONVERSA. Embedding não é uma
conversa mais pobre: é outra operação, com outro endpoint, outro corpo e outro
tipo de resposta.

**2. A camada de modelo aqui é EXCLUSÃO, não gradiente.** Tool calling admite
degradação: um modelo que não pede ferramentas ainda responde texto, e é por
isso que a [RN-040](../business-rules/custo.md#rn-040) só recusa o binding de agente
em vez de proibir o modelo. Embedding não admite: `nomic-embed-text` não
responde uma pergunta e `llama3.2` não devolve vetor. São dois conjuntos
disjuntos de modelos, e a pergunta "este modelo é de embedding?" não cabia em
nenhuma coluna existente.

**3. Declarar por leitura de documentação já custou caro.** O
[ADR 0043](0043-seis-providers-de-llm-e-o-fechamento-da-fase-9b.md) registra
duas reversões AO VIVO — DeepInfra e Vultr — de capabilities que a doc
prometia e a execução desmentiu. Todo provider de nuvem tem uma página
dizendo que serve `/embeddings`; nenhuma delas é prova.

## Decisão

### A operação: `embed`, opcional, com erro que LANÇA

```ts
embed?(
  inputs: readonly string[],
  options: EmbeddingOptions,
): Promise<EmbeddingResult>;
```

Opcional pelo mesmo contrato de dois lados que `listModels` cumpre desde a
Fase 9c: **quem declara a capability implementa o método, e quem não declara
não o expõe**. Quem consome degrada olhando a capability, nunca descobrindo na
falha.

**Lote, não unidade.** Um índice recebe N trechos de uma vez, e todo provider
aceita `input` como array. A ordem é o único vínculo entre entrada e vetor, e
disso sai a garantia mais importante do contrato: **um vetor por entrada ou
erro** — nunca uma lista mais curta. Uma resposta parcialmente recusada é
indetectável depois, porque o i-ésimo vetor passa a ser de outra frase e o
índice fica errado em silêncio.

**O retorno diz quatro coisas**, e cada uma existe por um motivo:

| campo | por quê |
| --- | --- |
| `vectors` | o resultado, na ordem das entradas |
| `dimensions` | conferido contra o que VEIO, não copiado do catálogo — índice vetorial tem dimensão fixa, e gravar tamanho diferente falha longe da causa |
| `model` | o que o provider DIZ ter usado, que nem sempre é o pedido (alias resolve para versão datada) — é ele que vai ao metering, pelo mesmo motivo do preço congelado ([RN-044](../business-rules/custo.md#rn-044)) |
| `inputTokens` + `estimated` | embedding gasta, e a distinção "disse zero" × "não disse nada" é a mesma da [RN-041](../business-rules/custo.md#rn-041) |

**O erro LANÇA, normalizado por `code`**, em vez de virar chunk como no `chat`.
A razão do chunk é preservar o gasto de um turno que já aconteceu; aqui não há
nada a preservar — ou o provider devolveu os vetores e cobrou, ou não devolveu
e não cobrou. É a mesma escolha que `listModels` fez, com o mesmo argumento, e
a taxonomia é a MESMA (`auth`, `rate_limit`, `model_not_found`,
`context_length`, `timeout`, `connection`, `upstream`): nenhum código novo.

### A capability em duas camadas

**Provider** — `LLMProviderCapabilities.embeddings`, obrigatório (não
opcional), pelo mesmo argumento que tornou `code` obrigatório em
`ChatErrorChunk`: com campo opcional, um provider novo esquece de declarar e
ninguém percebe.

**Modelo** — `ModeloDoCatalogo.supportsEmbeddings` e `embeddingDimensions`,
ambos opcionais, porque ausência é **"o provider não disse"** e nunca `false`
inventado (ADR 0041). O Ollama é o único dos nove que publica isto por modelo:
`capabilities: ["embedding"]` no `/api/tags`, com `details.embedding_length`
dando a dimensão.

O guarda `assertCanEmbed` confere as duas na ordem em que falham melhor: o
provider primeiro, porque trocar de modelo não resolve provider que não embeda.
Ele recusa também o modelo **sem declaração**, com mensagem diferente — a ação
de quem lê é sincronizar o catálogo, não trocar de modelo. Deduzir a capability
do NOME do modelo seria palpite vestido de dado, exatamente o que o ADR 0041
proíbe.

### A prova: um `true`, oito `false`

A suite de contrato ganhou cinco casos, rodados contra todo provider que
declara a capability: um vetor por entrada na ordem certa, dimensão e modelo
usados, lote incompleto virando erro, erro do provider normalizado por `code`,
e lista de entradas vazia recusada antes de sair pela rede.

**Só o `ollama` declara `embeddings: true`**, e a prova é execução: `POST
/api/embed` contra o daemon 0.32.1 com `nomic-embed-text`, duas entradas → dois
vetores de 768 e `prompt_eval_count: 10`. A mesma execução produziu o achado
que virou teste: **um modelo de chat responde `501`** ("This server does not
support embeddings") — a camada de modelo falhando no lugar mais tarde
possível, que é a razão de `assertCanEmbed` existir.

Os outros oito declaram `false`, e por dois motivos diferentes que a prosa de
cada um registra. Sete são **falta de prova**: não há chave deles no ambiente,
e o único smoke pago que já rodou (OpenRouter, Fase 13a) foi de CHAT — num hub,
embedding roteia para provedores diferentes dos de chat, e a prova de um
endpoint não é a do outro. O oitavo é **ausência da operação**: a Anthropic não
tem endpoint de embedding próprio, e a doc dela manda usar um terceiro, que é
outro provider com outra chave e outro dialeto.

O dialeto `/embeddings` da base OpenAI-compatível, porém, está **provado** —
a suite de contrato roda uma segunda vez sobre a base configurada com a
capability ligada. Isso é o que torna barato virar um provider para `true` no
dia em que a chave existir: muda uma linha do literal, e o parsing já está
exercitado.

## Consequências

**O gasto de embedding ainda não é medido, e isto é um corte declarado, não um
esquecimento.** O retorno carrega `inputTokens`/`estimated` exatamente para
alimentar o `RecordLlmUsageUseCase`, que continua sendo o único caminho de
metering — e `calculateCostMicros(input, 0, …)` já serve, porque embedding não
tem saída em tokens. O que falta é estrutural e não cabia aqui: `token_usage`
tem `session_id` **NOT NULL** com FK para `sessions`, e indexar um repositório
não acontece dentro de uma sessão. Improvisar uma sessão sintética para ter
onde gravar produziria a correção logo depois; a decisão é da onda que
implementa o consumidor.

**A camada de modelo ainda não tem coluna.** Ela vive hoje na linha de catálogo
(`ModeloDoCatalogo.supportsEmbeddings`), e `models` não ganhou
`supports_embeddings` porque o slot de migration desta onda é de outra frente —
duas migrations concorrentes colidem no `_journal.json` e nos snapshots do
drizzle, que é o limitador declarado do programa. A consequência honesta: o
sync de catálogo lê a capability e ainda não tem onde persisti-la, então quem
consumir precisa perguntar ao provider ou carregar a coluna junto. `assertCanEmbed`
recebe um `Pick` estreito de propósito, para servir às duas fontes sem mudar
quando a coluna existir.

**Nove providers passaram a declarar um campo a mais.** O custo é real e foi
pago de uma vez: capability obrigatória é o que impede o próximo provider de
nascer sem resposta. O `TracedLLMProvider` encaminha `embed` condicionalmente,
como faz com `listModels` — e ganhou teste próprio, porque foi exatamente aí
que `listModels` sumiu do produto inteiro em silêncio uma vez.

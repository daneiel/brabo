# 0166 — A preferência de roteamento mora no binding de modelo, viaja com ele, e congela no metering

## Status

**Accepted.** Decidido pelo mantenedor em 2026-09-18 (AT-090): *"a preferência
de roteamento é CONFIGURÁVEL POR BINDING"*. Estende o
[ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)
(capability em duas camadas, só declarada quando provada) e o
[ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
(o que produziu o número vai congelado na linha de `token_usage`). Não edita
nenhum dos dois. A regra que nasce daqui é a
[RN-583](../business-rules/custo.md#rn-583).

## Context

Medido no `token_usage` da instalação v6.1.0 (2026-09-14): 24 chamadas de
`~deepseek/deepseek-v4-flash-latest` via `openrouter`. O `upstream_provider`
([RN-042](../business-rules/custo.md#rn-042)) já dizia quem serviu cada uma:
**Relace em 23**, com latência média de 69,5 s (entre 32 e 47 tok/s), e
**Baidu em 1**, com 37,8 s (~190 tok/s). O OpenRouter escolhe o upstream por
um balanceamento que privilegia PREÇO quando o pedido não diz nada — e o
`openrouter-provider.ts` não dizia nada: o corpo do `/chat/completions` saía
sem `provider`/`sort`.

O hub aceita `provider: { sort: "price" | "throughput" | "latency" }` no corpo.
A pergunta que sobra é de PRODUTO, não de fio: *quem* escolhe o critério, e
*onde* essa escolha mora.

## Decision

### 1. Uma coluna no binding, no agregado `llm`

`routing_preference` (enum `routing_preference`: `price | throughput |
latency`), **anulável**, em `model_bindings`. `null` é o comportamento de hoje:
nada é enviado e o hub decide sozinho. A coluna entra em
`apps/api/src/db/schema/llm.ts`, onde o binding já mora — o agregado é o do
modelo, e o enum mora com as duas tabelas que o chamam (a regra de enum do
[ADR 0121](0121-schema-dividido-por-agregado-de-dominio.md)).

### 2. A preferência NÃO cascateia sozinha: ela viaja com o binding que venceu

A cascata (`session > agent > area > project > workspace`, mais o passo
pós-cascata do Criativo) continua sendo uma cascata **de binding**. O binding
vencedor traz o modelo E a preferência dele; nenhum nível "herda só a
preferência" de outro. Três motivos:

- **A preferência só tem sentido junto do modelo com que foi escolhida.** Ela
  existe para UM provider (o hub); cascatear à parte produziria combinações
  que ninguém escolheu — o modelo do agente num provider sem a capability e o
  `throughput` do projeto, ou o `latency` do workspace aplicado a um modelo que
  o dono do workspace nunca viu.
- **Uma cascata independente exigiria uma segunda cadeia na tela.** A
  [RN-470](../business-rules/custo.md#rn-470) fez a cadeia do MODELO visível
  nó a nó; duas cadeias que pousam em níveis diferentes na mesma linha seriam
  exatamente o estado que a tela não sabe explicar.
- **O nível que a cascata PULA leva a preferência junto.** Um binding pulado
  por indisponibilidade ou por falta de tool calling deixa de valer inteiro —
  modelo e critério. Sobreviver só o critério seria o mesmo defeito do
  primeiro motivo, criado pela queda.

Consequência escrita: para pôr `throughput` numa área inteira, grava-se no
binding da ÁREA; o agente que diverge com binding próprio tem a preferência
DELE (nula até alguém escolher).

### 3. A escrita: ausente preserva, `null` limpa, provider sem capability recusa

`PUT .../model-binding` (todos os cinco escopos) ganha
`routingPreference?: 'price' | 'throughput' | 'latency' | null`:

- **ausente** — preserva a preferência gravada, *se o provider do modelo novo
  aceita*; senão ela vira `null`. Omitir não pode limpar em silêncio (é assim
  que a troca de modelo de sempre e o "aplicar a todos" continuam chamando a
  rota), e também não pode deixar gravado um critério que o provider novo não
  entende;
- **`null`** — limpa, explícito;
- **valor, com provider sem a capability** — 422
  (`RoutingPreferenceNotSupportedError`), no mesmo filtro das outras recusas
  de binding. O pedido está bem formado; o que não se sustenta é a combinação.

O invariante que as três regras sustentam: **nenhum binding guarda
preferência para provider que não a declara.**

### 4. Capability de PROVIDER, declarada `false` enquanto não provada

`LLMProviderCapabilities.routingPreference`, obrigatória como `embeddings`
(campo opcional seria o provider novo que esquece de declarar). Os nove
declaram. O mapeamento de fio (`provider: { sort }`) é particularidade do
OpenRouter e entra como hook da config dele (`campoDeRoteamento`), no desenho
de `extrairUpstreamProvider`: a base só o chama quando a capability é `true` E
há preferência — nunca `if (name === 'openrouter')` no parsing.

A camada de MODELO não ganha coluna: o `sort` é critério do HUB sobre os
upstreams que servem o modelo, o catálogo do OpenRouter não o publica por
linha, e um modelo com um só upstream o recebe como no-op. Inventar a coluna
seria capability sem fonte.

**O valor do OpenRouter é o que a prova disser.** A capability só vira `true`
com o smoke contra a API real (`openrouter-provider.roteamento.smoke.spec.ts`)
devolvendo o upstream escolhido. Sem credencial no ambiente de quem implementa,
ela nasce `false` e a feature nasce DORMENTE: a rota recusa com 422 e a tela
diz em texto que nenhum provider desta instalação tem a opção provada.

### 5. O que foi PEDIDO vai congelado em `token_usage`

`token_usage.routing_preference`, anulável, gravado por chamada: a
preferência que **foi ao fio** — `null` quando o binding não tinha, e `null`
também quando tinha mas o provider não a declara (não foi enviada, então não é
procedência de nada). É a mesma régua do preço congelado: sem ela, comparar o
`upstream_provider` e a `latency_ms` de antes e depois de ligar `throughput`
dependeria de reconstruir o estado do binding naquele instante, que não fica
registrado em lugar nenhum.

### 6. A tela descobre a capability por uma rota de PROVIDER

`GET llm/provider-capabilities` devolve as capabilities dos nove providers,
lidas das instâncias do registro — a mesma fonte que o adapter usa. Rota nova,
e não campo em resposta existente, porque nenhuma resposta existente é sobre
PROVIDER: o modelo é linha de catálogo (fato do vendor, `MesmasChaves` com a
entidade) e o binding é decisão de um escopo. Sem papel (só autenticação), como
`users/me/credentials`: é fato do código desta instalação, igual para todos.

O controle mora onde o binding é editado — a tabela de agentes e a seção de
áreas em Configurações —, com o mínimo de papel do ENDPOINT
([RN-102](../business-rules/custo.md#rn-102)): `developer` no agente,
`maintainer` na área. Só é editável na linha que TEM binding próprio; na linha
que herda, diz de qual nível veio o critério vigente. Modelo cujo provider não
tem a capability não ganha opção — ganha a frase do porquê.

## Consequences

- Com a capability `true`, pôr `throughput` num binding do OpenRouter muda o
  corpo de toda chamada que resolve para ele, e a linha de `token_usage` diz
  qual critério foi pedido e quem serviu — a comparação antes/depois é uma
  consulta, não uma reconstituição.
- Enquanto a capability for `false`, nada muda no fio para ninguém: o código
  está no lugar, a rota recusa e a tela explica. Virar a flag é um PR de uma
  linha acompanhado da saída do smoke.
- Preço declarado: `sort: throughput` pode rotear para um upstream mais CARO.
  O metering continua cobrando o preço do catálogo do modelo (ADR 0042), que é
  o preço de referência do OpenRouter e não o do upstream — essa diferença já
  existia e não é medida aqui.

**Fora de escopo, declarado:**

- a sessão (`SessionPage`) e os níveis de projeto e workspace não têm
  controle na tela: a API aceita o campo nos cinco escopos, mas projeto e
  workspace não têm seletor de modelo em tela nenhuma (medido: nenhum
  `setProjectModelBinding`/`setWorkspaceModelBinding` é chamado pelo web), e o
  seletor de sessão é outra superfície;
- o card do agente (Visão Geral/Executores) mostra o modelo e NÃO edita
  binding — o controle não foi para lá, porque lá não se edita binding;
- os outros campos do objeto `provider` do OpenRouter (`order`, `only`,
  `ignore`, `allow_fallbacks`, `max_price`) e o sufixo `:nitro`: nenhum foi
  pedido, e cada um é uma decisão de produto própria.

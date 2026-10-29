# ADR 0227 — O OpenCode Zen entra como o 11º provider de LLM, só no dialeto OpenAI

## Status

**Accepted.** 2026-10-29 (AT-568, EP-026). Tema: `llm`. Estende o
[0043](0043-seis-providers-de-llm-e-o-fechamento-da-fase-9b.md) e o
[0222](0222-provider-9router-de-llm.md) (a lista de providers, que passa de dez
para onze) sem editá-los, e segue o
[0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md) e o
[0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md): a
capability só vira `true` com prova contra a API real, e o catálogo é curadoria.

## Contexto

O OpenCode Zen é um gateway de modelos com uma faixa de modelos `-free`. A doc
pública mostra três dialetos: `/chat/completions` (OpenAI, em
`https://opencode.ai/inference/openai/v1`), `/responses` e `/v1/messages`
(Anthropic), além do Google. A base `OpenAICompatibleProvider` só fala
`/chat/completions`, e a lista de modelos (`/inference/v1/models`) não está em
`{baseUrl}/models`, que é o que a base chama. Entre os grátis, só
`deepseek-v4.1-flash-free` e `glm-5.3-flash-free` declaram retenção zero e sem
treino com os dados.

## Decisão

1. **Só o dialeto OpenAI.** `opencode-zen` é uma `OpenAICompatibleProvider` com
   base `https://opencode.ai/inference/openai/v1` e `Authorization: Bearer`.
   Os modelos de `/responses`, `/messages` e Google ficam fora, assim como o Jev
   do Zen (o `ToolRouter` é só do OpenRouter, ADR 0179).
2. **`listModels: false`.** A rota de modelos é outra e pública; o catálogo vem
   do seed curado. Pelo mesmo motivo o teste de conexão da credencial não
   declara teste para ele: um GET público passaria com chave inválida.
3. **Seed só com os dois de retenção zero**, preço 0 e `manualPricing: true`;
   os outros grátis entram por curadoria manual na tela (ADR 0042), nunca no
   seed. `supportsToolCalling` e as capabilities nascem `false`.
4. **Capabilities `false` além de `streaming`** (que a suite de contrato exige)
   e `streamOptionsIncludeUsage: false` até o smoke com `OPENCODE_ZEN_TEST_KEY`
   provar tool call e `usage` em `deepseek-v4.1-flash-free` e
   `glm-5.3-flash-free`.

## Consequências

- A lista de providers passa a onze no enum (migration 0077), no registry, na
  web e nos docs.
- Modelo grátis é "por tempo limitado": o catálogo envelhece sozinho, sem
  sync; o modelo que sumir vira erro do upstream, normalizado.
- Enquanto o smoke não rodar, o provider conversa por texto e não serve a agente
  com ferramenta.

## Referências

- [0043](0043-seis-providers-de-llm-e-o-fechamento-da-fase-9b.md) — a lista de
  providers.
- [0222](0222-provider-9router-de-llm.md) — o provider anterior, molde deste.

# ADR 0222 — O 9Router entra como o 10º provider de LLM, com URL por instalação

## Status

**Accepted.** 2026-10-22 (AT-576a, EP-026). Tema: `llm`. Estende o
[0043](0043-seis-providers-de-llm-e-o-fechamento-da-fase-9b.md) (a lista de
providers, que passa de nove para dez) sem editá-lo, e segue o
[0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md) e o
[0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md): a
capability só vira `true` com prova contra a API real, e o preço é curadoria
manual.

## Contexto

O 9Router é um gateway local do dono (Node, MIT), com endpoint
OpenAI-compatível em `http://localhost:20128/v1` e roteamento por combos. Ele
roda FORA do compose, na máquina do dono, e usa contas e assinaturas dele.
Diferente dos nove providers de nuvem, o endereço não é fixo.

## Decisão

1. **URL por instalação.** `NINE_ROUTER_BASE_URL`, padrão
   `http://host.docker.internal:20128/v1` (molde do `OLLAMA_HOST`), lida pelo
   provider e pelo teste de conexão. Os composes de instalação e de produção
   ganham `extra_hosts: host.docker.internal:host-gateway` na api.
2. **Credencial obrigatória.** A chave de API é criada no painel do 9Router; o
   provider entra em `LLM_PROVIDER_NAMES_COM_CREDENCIAL`. Ler ou criar combos
   pelo painel exigiria a SENHA dele como segundo segredo e fica fora (576b).
3. **Preço manual, com o preço público.** A resposta não traz custo. Por
   decisão do dono (22/10), modelo de assinatura registra o **preço público da
   API equivalente**, não zero: o orçamento conta o custo de oportunidade. É
   curadoria (ADR 0042), nunca descoberta.
4. **Capabilities `false` até o smoke** (`toolCalling`, `routingPreference`,
   `embeddings`, `promptCaching`, `stickySession`), com `listModels: true` e
   `streaming: true` (a suite de contrato exige `streaming` de todo provider) e parser próprio das `capabilities` do `GET /v1/models`.
5. **Token Saver desligado.** O RTK Token Saver comprime `tool_result`; o
   provider manda `x-9router-token-saver: off` em toda chamada e o smoke confere
   que o `tool_result` chega intacto. Smoke e TP-01 só com modelos
   `free`/`auto:free`.

## Consequências

- A lista de providers passa a dez no enum, na migration, no registry, na web e
  nos docs.
- 9Router fora do ar é erro de infra normalizado, como qualquer provider.
- O valor do cabeçalho do Token Saver não foi achado na fonte
  (**TODO(humano)**): o smoke é quem diz se `off` vale.

## Referências

- [0043](0043-seis-providers-de-llm-e-o-fechamento-da-fase-9b.md) — a lista de
  providers.
- [0166](0166-preferencia-de-roteamento-no-binding-de-modelo.md) — roteamento
  é do hub; combo não é `provider.sort`.
- [RN-909](../business-rules.md#rn-909).

# ADR 0221 — O hub prende a conversa de cada agente ao upstream que a atendeu, por `session_id`

## Status

**Accepted.** 2026-10-21 (AT-580). Tema: `llm`. Estende o
[0166](0166-preferencia-de-roteamento-no-binding-de-modelo.md) (que só
mandava `provider.sort`; seu docblock dizia que os outros campos do objeto
`provider` são decisão de produto própria) sem editá-lo, e segue o
[0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md) e o
[0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md): a
capability só vira `true` com prova contra a API real.

## Contexto

No TP-01 da 18ª rodada, o mesmo modelo foi servido por 17 upstreams
diferentes e o acerto de cache dos dev agents caiu. O OpenRouter já tem a
memória pedida (*provider sticky routing*): prende a conversa no upstream que a
atendeu e só cai para o próximo se ele falhar, por 10 minutos de inatividade.
Sem `session_id`, a "conversa" é o hash da primeira mensagem `system` mais a
primeira não-`system`, e o grude só liga depois de um acerto de cache; cada
tarefa do dev abre com outra primeira mensagem, então cada uma sorteava um
upstream novo. Com `session_id` no corpo (até 256 caracteres), o grude liga na
primeira resposta com sucesso.

## Decisão

1. O Brabo manda `session_id` = `brabo:<sessionId>:<agentId>` (sem agente,
   `brabo:<sessionId>`) nas chamadas ao OpenRouter, montado em
   `StreamLlmTurnUseCase` e `RunLlmTurnUseCase` (`chaveDeSessao`) e levado em
   `ChatOptions.sessionKey`. **Por agente + sessão**, nunca por projeto:
   cada agente tem prefixo próprio (instruções + ferramentas) e misturar dois
   num grude não ganha cache.
2. Capability nova `stickySession` em `LLMProviderCapabilities`, obrigatória
   nos nove providers, `false` em oito; no OpenRouter é `true` depois do
   smoke `openrouter-provider.sessao.smoke.spec.ts` (6 de 6 chamadas no mesmo
   upstream com a chave, 4 upstreams em 6 sem ela). Declará-la sem o hook
   `campoDeSessao` falha na construção.
3. **Fora**: `provider.order`, `only` e `allow_fallbacks` — `order` desliga o
   sticky routing, pede o slug (e gravamos o nome do frame) e escolher o
   "melhor" exigiria ler `token_usage` por chamada (teto do ADR 0060). Só
   entra como evolução se a medição pós-entrega mostrar o upstream grudado
   ruim.
4. Sem tabela, sem engine: a chave é derivável de `token_usage`
   (`session_id` + `actor_id`) e o hub guarda a memória. O Jev (ADR 0179) não
   recebe a chave.

## Consequências

- `routingPreference` (`sort`) convive: o `sort` escolhe o primeiro
  upstream, o grude o mantém.
- O grude vale para o cache implícito e para o explícito (RN-892).
- A espera por gate ou aprovação de mais de 10 minutos solta o grude; o
  próximo sorteio é do hub.
- O DTO de `GET /llm/provider-capabilities` ganha `stickySession`.

## Referências

- [0166](0166-preferencia-de-roteamento-no-binding-de-modelo.md) — a
  preferência de roteamento.
- [RN-907](../business-rules/custo.md#rn-907).

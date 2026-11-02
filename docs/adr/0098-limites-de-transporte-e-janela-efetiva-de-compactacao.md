# ADR 0098 — Limites de transporte e janela efetiva de compactação coerentes

- **Status:** Aceito
- **Data:** 2026-08-19
- **Contexto:** correção do `413 request entity too large` nas PRs
  (achado por uso real), RN-412

## Contexto

O gate de QA/SecOps morria com `413 request entity too large` em PRs
legítimas. Comentários espalhados pelo código (`apps/engine/config/runtime.exs`,
`apps/engine/lib/engine/actions/terminal_executor.ex`, `docker/docker-compose.yml`)
atribuíam o erro ao PROVIDER de LLM. A investigação confirmou que essa
atribuição estava errada: `Engine.Agents.FalhaDeTurno.origem({413, _})`
já classificava a falha como `"codigo"`, não `"modelo"` — e o
classificador estava certo, só ninguém tinha seguido a pista até o
fim.

A causa real tem duas pontas independentes, e as duas precisam fechar
juntas — corrigir só uma adia o estouro, não o resolve:

1. **A api nunca configurou limite de body do Express.** `NestFactory.create`
   em `apps/api/src/main.ts` não tocava o parser JSON, então valia o
   default do Express: **100 KB**. O Phoenix (engine) aceita corpos de
   até 8 MB. No sentido mais pesado do transporte — engine → api,
   especificamente `POST /internal/sessions/:sessionId/llm-turn`, que
   recebe o HISTÓRICO INTEIRO da conversa a cada iteração do `ToolLoop`
   — a api era o gargalo mais estreito por um fator de 80×, sem que
   ninguém tivesse decidido isso: era ausência de configuração, não
   escolha.
2. **A compactação de contexto do engine era estruturalmente
   inalcançável antes do estouro.** `Engine.Harness.ContextManager.Default`
   decide compactar quando a estimativa de tokens ultrapassa
   `threshold * context_window`. Dois defeitos empurravam esse gatilho
   para muito depois do limite de transporte:
   - `estimate/1` somava só o campo `content` das mensagens.
     Mensagens `assistant` com `toolCalls` (o formato de uma chamada de
     ferramenta) têm `content` vazio — os argumentos da tool call, que
     SÃO bytes reais no corpo HTTP, contavam como ~zero tokens.
   - A janela de compactação usava só `context_window` — 128.000
     tokens nos cinco agentes de gate/dev (`qa_automacao_agent.ex`,
     `qa_performance_seguranca_agent.ex`, `qa_estrategia_agent.ex`,
     `appsec_agent.ex`, `dev_agent_server.ex`). Com `threshold: 0.7`,
     isso dá compactação em ~350 KB de payload estimado — bem depois
     de qualquer limite de transporte razoável, e pior ainda quando a
     estimativa em si já estava subcontando.

Com um gate de 60 iterações (teto de agentes de execução/gate) e três
a quatro tool results de 32 KiB (o teto INDIVIDUAL já fechado pela
RN-150), o corpo acumulado ultrapassava 100 KB muito antes de a
compactação sequer considerar agir.

## Decisão

**As duas pontas fecham na mesma correção, deliberadamente juntas:**

1. `apps/api/src/main.ts` passa a configurar explicitamente o limite
   do parser JSON (`app.useBodyParser('json', { limit })`), lido de
   `API_JSON_BODY_LIMIT` com default `10mb` — folga sobre os 8 MB que
   o Phoenix já aceita, sem exigir novo deploy se o teto do engine
   mudar.
2. `Engine.Harness.ContextManager.Default` ganha:
   - `estimate/1` conta `content` de TODA mensagem MAIS a serialização
     JSON de `toolCalls` de mensagens `assistant` — a heurística de
     bytes-por-token é a MESMA do tokenizer aproximado
     (`Engine.Harness.Tokenizer.bytes_per_token/0`, nova função
     pública, para não duplicar a constante).
   - A janela EFETIVA de compactação vira `min(context_window,
     teto_de_transporte)`, onde o teto de transporte é UMA config nova
     (`transport_max_body_bytes`, default 8 MiB — o teto do PRÓPRIO
     transporte do engine, não replicado nos cinco arquivos de agente,
     que continuam declarando `context_window: 128_000` porque isso
     descreve o MODELO, não o transporte).
   - O corte entre mensagens antigas (sumarizadas) e recentes
     (preservadas) passa a respeitar FRONTEIRA DE ITERAÇÃO do
     `ToolLoop` (`group_by_iteration/1`) — uma mensagem `assistant` com
     `toolCalls` e os `role: "tool"` que a respondem viajam sempre
     juntas para o mesmo lado do corte. Cortar no meio quebraria o
     protocolo de tool-use do provider (resultado de ferramenta sem a
     chamada correspondente no histórico).

A regra geral que esta ADR registra: **a compactação deve disparar
ANTES do corpo estourar o limite HTTP real, não antes do modelo
"esquecer" a janela dele.** Um teto de transporte que só existe
implicitamente (o default de uma lib) não é um teto — é uma falha
esperando o payload certo.

## Consequências

- O valor de `transport_max_body_bytes` (8 MiB) é config declarada, não
  calibrada contra tráfego real — mesma régua de honestidade que os
  pesos da busca híbrida (RAG) e os tetos de `search_workspace`
  (RN-150) já seguem: ponto de partida ajustável, não número definitivo.
- Subir só o limite da api sem corrigir a estimativa do engine (ou
  vice-versa) reintroduz o defeito sob outra forma: ou o corpo volta a
  crescer sem freio até um teto maior, ou a compactação passa a agir
  cedo demais e resumir contexto que ainda caberia no transporte. As
  duas pontas nasceram no mesmo commit.
- `dev.awaiting_gate` como estado do dev agent deveria ficar mais raro
  na prática (o gate não morre mais por 413 em payload legítimo), mas
  a RN-412 também estende `DEV_PENDING_TYPES` para segurar a sessão
  nesse estado — defesa em profundidade, não dependência de que este
  ADR feche 100% dos casos de gate lento/travado por outro motivo.

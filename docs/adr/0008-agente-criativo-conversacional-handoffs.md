# ADR 0008 — Agente Criativo conversacional no harness + fundação de handoffs

- Status: aceito
- Data: 2026-07-24
- Fase: 3b (sessão 1)

## Contexto

A Fase 3a entregou o harness determinístico + o ToolLoop **one-shot**
(autônomo, roda até parar) e o chat humano é um echo **stateless api-only**
(`SendChatMessageUseCase` manda só a mensagem atual ao provider — sem
histórico, sem harness, sem tools; o engine nem participa). A Fase 3b precisa
de um **Agente Criativo conversacional** que conduz a ideação COM o usuário,
emite `business_rule` ao longo da conversa e — só após confirmação explícita do
usuário — emite `product_brief` e oferece handoff ao PO. Também precisa da
fundação de **handoffs** com a regra que porteia a ativação de agentes.

Regra dura do CLAUDE.md: "Agentes rodam SEMPRE dentro de um Harness" e "o
engine NUNCA fala com provider de LLM direto". Logo o Criativo vive no engine
(harness), e todo turno passa pela api (metering + budget).

## Decisões

### 1. Criativo como GenServer com estado (não stateless)
Um `Engine.Agents.CriativoServer` (GenServer, `restart: :temporary`) por sessão,
supervisionado por um `CriativoSupervisor` (DynamicSupervisor), registrado em
`Engine.Sessions.Registry` com chave `"criativo:<session_id>"` — espelha o
`SessionServer`. O histórico da conversa vive em memória e é **rehidratado** dos
`session_events` (chat.message/agent.response) no `init` — o event log é a fonte
durável da verdade. Iniciado por comando do usuário (a exceção da regra de
ativação), via a api → `ApiToEngineClient.startAgent` → engine
`POST /internal/sessions/:id/agent/start`.

Alternativa descartada: reconstruir o histórico do event log a cada turno (sem
processo vivo). Escolhemos o GenServer para ter um lugar natural de estado e
lifecycle por sessão (consistente com o `SessionServer`).

### 2. Streaming token-a-token via SSE engine→api + rebroadcast Phoenix
Cada mensagem do usuário roda UM turno **streamado**: `StreamLlmTurnUseCase`
(irmão SSE do `RunLlmTurnUseCase` da 3a, que permanece turn-result pro
ToolLoop) transmite deltas; o `CriativoServer` consome a SSE
(`EngineApiClient.llm_turn_stream`) e **rebroadcasta** os deltas ao web pelo
canal Phoenix `session:<id>` (`agent.delta`/`agent.done`) — que o web já
conectava só pra heartbeat. A persistência final (`agent.response` + artefatos)
chega pelo poll de `session-events` (3s) que a `SessionPage` já faz. O metering
(token_usage) é obrigatório e roda na api; o engine nunca fala com provider
direto. Reverte parcialmente a decisão turn-result da 3a **só** pros agentes
interativos.

### 3. Handoffs: tabela com status mutável + eventos imutáveis
Nova tabela `handoffs {from_agent, to_agent, artifact_id, status:
offered|accepted|completed|rejected}`. Diferente das tabelas de evento, o
`status` é MUTÁVEL (é o estado corrente); cada transição também vira um
`session_event` `handoff.*` imutável. A api é dona da tabela — o engine cria o
handoff via `POST /internal/sessions/:id/handoffs` (nunca escreve tabela da api
direto).

### 4. Regra de ativação de agente (domínio puro)
`domain/sessions/agent-activation.ts`: um agente só é ativado numa sessão com um
handoff `accepted` endereçado a ele; **exceção única: o Criativo** (inicia por
comando do usuário — `USER_STARTED_AGENTS`). Puro e testado isoladamente
(espelha `decide.ts`/`session-state-machine.ts`); o `ActivateAgentUseCase`
carrega os handoffs e aplica a regra antes de subir o processo no engine.

### 5. Prontidão é ação do usuário; product_brief é server-emitted (guardrail no domínio)
"Confirmação de prontidão é ação do usuário (botão), não inferência do modelo."
O `business_rule` é emitido pelo modelo via a ferramenta `emit_artifact` (com
`origin` — refs à conversa — validada NÃO-vazia em `ArtifactSchemas`). O
`product_brief` NÃO é tool-emittable (`known/0` exclui; `EmitArtifact` bloqueia
tipos system-emitted) — ele só sai quando o usuário clica "Estou pronto para
produzir" (`ConfirmReadinessUseCase` → engine `confirm_readiness`): aí o
`CriativoServer` roda um turno de consolidação, emite o `product_brief` direto
(`append_event_returning`, capturando o id) e cria o handoff `offered` ao PO.
Isso torna "brief só após confirmação" uma garantia de domínio, não de prompt.

### 6. Artefatos continuam sendo session_events tipados
Sem tabela de artefatos: `business_rule`/`product_brief` são `session_events`
`artifact.<tipo>` com payload validado no engine (`ArtifactSchemas`). O web os
lê do mesmo poll de eventos (cards de regra no painel lateral; divisor de
handoff no chat quando `handoff.offered` aparece).

## Escopo

Só a fundação de handoffs (tabela + regra + handoff **offered**) e o Criativo.
O **PO** (aceitar handoff, ativar PO, backlog) é sessão posterior da 3b. Sem
Bitbucket/GenericGitProvider; filas seguem no Postgres (Oban), sem Redis.

## Consequências

- O web ganha um segundo caminho de chat (agente vs. humano) decidido por
  `agent.activated` no event log; sessões sem Criativo seguem no chat humano.
- O `CriativoServer` reidrata do event log — sobrevive a restart sem perder o
  fio da conversa.
- Testes determinísticos: regra de ativação (unit), `ArtifactSchemas`
  (origem obrigatória), e `CriativoServer` via `init/1` + `handle_call/3`
  diretos com o fake de LLM scriptado (streaming, guardrail de product_brief,
  prontidão→brief+handoff, broadcast, rehydration).

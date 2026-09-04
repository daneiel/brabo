# 0007 — ToolLoop, ferramentas, ContextManager (harness com LLM)

## Contexto

Segunda sessão da Fase 3a: ligar o harness determinístico (ADR 0006) ao LLM.
Um `ToolLoop` que roda turnos de LLM, ferramentas registradas (read_file,
search_workspace, write_file, terminal, emit_artifact), um `ContextManager`
que compacta acima de um limite, o wiring dos hooks ao pipeline de ações, e um
`EchoAgent` de validação. Regra dura do CLAUDE.md: o engine NUNCA fala com
provider de LLM direto — toda chamada passa pela api (metering + budget).

Descoberta que moldou o trabalho: não existia endpoint de LLM interno
(engine→api) com tool-calling nem metering — só o `/chat` web-facing (SSE,
usuário humano, sem tools), e o provider Ollama não mandava `tools` nem
parseava `tool_calls`. Então esta sessão teve trabalho substancial na api
(TypeScript) além do engine (Elixir).

## Decisões

### Endpoint de LLM interno turn-result (não streamado pro engine)

`POST /internal/sessions/:id/llm-turn` (EngineServiceGuard) → `RunLlmTurnUseCase`.
Consome o stream do provider INTERNAMENTE na api (como o `/chat`) e devolve o
turno COMPLETO (mensagem do assistente + `toolCalls` + uso) como um JSON. O
ToolLoop é turno-a-turno; o "streaming" acontece na camada provider→api.
Rejeitado streamar NDJSON até o engine: num tool loop o engine precisa da
mensagem completa (com tool_calls) antes de despachar ferramentas, então
streaming só adicionaria deltas ao vivo — não muda os critérios de aceite
(cada tool call, context.compacted, custo) e custaria consumo de stream em
Elixir. Confirmado com o usuário.

O endpoint grava `token_usage` (metering OBRIGATÓRIO via `RecordLlmUsageUseCase`,
exige `sessionId`) mas NÃO grava `session_events`: o engine é dono da narrativa
no event log (`agent.response`, `tool.call`, `tool.result`,
`toolloop.limit_reached`) — evita log duplicado. Tool-calling: `ChatMessage`/
`ChatOptions`/`ChatStreamChunk` ganharam campos de tool (packages/shared), e o
provider Ollama passou a mandar `tools` e parsear `message.tool_calls`.

### Ferramentas: diretas vs pipeline

- Diretas (executam em processo no engine): `read_file`, `search_workspace`,
  `write_file` dentro da whitelist do agente, `emit_artifact`. Todo acesso a
  arquivo passa por `WorkspaceFiles.safe_path/2` — **path traversal bloqueado**
  (nada escapa de `<PROJECT_WORKSPACES_ROOT>/<project_id>`).
- Pipeline (via proposed_action na api): `terminal` (SEMPRE), e `write_file`
  FORA da whitelist. O hook `:pre_tool_use` cria o `proposed_action` (decide/
  permissions da api); terminal `auto_approved` é auto-executado (branch
  existente) e o resultado vira o resultado da ferramenta; write_file fora da
  whitelist fica `pending` (execução pós-aprovação é fase futura). Novo
  `ActionType` `write_file` (developer). O engine NÃO cria proposed_actions
  direto — passa por um novo endpoint interno `POST /internal/sessions/:id/actions`.

### emit_artifact = session_event tipado (sem tabela)

Não há tabela de artefatos nem validação por tipo na api. Um artefato é um
`session_event` `"artifact.<tipo>"` com payload validado NO ENGINE
(`ArtifactSchemas`, chaves obrigatórias por tipo; só `"note"` por ora — os
tipos de produto são 3b), emitido via `append_event`. Rejeitado criar tabela
de artefatos agora (seria escopo de 3b).

### Hooks ligados (item 4)

`:pre_tool_use` = onde a consulta ao pipeline acontece (`ActionPipeline`);
`:post_tool_use` = grava `tool.result` no event log (`EventLog`). Registro
default do ToolLoop, mas trocável (é um valor de Hooks). Base pro pipeline de
ações plugar mais fundo depois.

### ContextManager: compactação preservando pinned

Quando os tokens estimados passam de `threshold * janela do modelo`, sumariza
os turnos mais antigos NÃO-pinned via o binding `agent`/"context-manager"
(modelo barato — sem schema novo, é slug livre), substitui-os por um resumo,
preserva os pinned (system prompt + tarefa) e os `keep_recent` mais recentes,
e emite `context.compacted` com `tokensBefore`/`tokensAfter`. Fallback
determinístico se o sumarizador falhar (nunca perde o fio). Mensagens internas
são maps chave-string (formato de fio) + `:pinned` (removido antes de enviar).

### Onde o ToolLoop roda

O `EchoAgent.run/2` roda o `ToolLoop` de forma síncrona (observável no IEx pro
critério de aceite). Em produção, um driver por-sessão (Task sob
`Engine.TaskSupervisor`, coordenado pelo SessionServer) evita bloquear o
GenServer de heartbeat — refinamento de sessão futura; nesta sessão o gatilho
é IEx (sem precedente de Mix.Task, igual `Debug.print`).

## Consequências

- Todo behaviour novo (`ToolLoop`, `ContextManager`) segue o padrão
  behaviour + impl trocável via `Application.get_env`, sem Mox; testes
  determinísticos usam um fake de `EngineApiClient` que scripta `llm_turn`/
  `propose_action` pelo dicionário de processo (o loop roda síncrono no
  processo de teste) e `send`a eventos pro `:test_pid`.
- O critério de aceite (EchoAgent numa sessão real com Ollama) precisa de um
  modelo tool-capable no Ollama e dos bindings (sessão + "context-manager").
  Os testes automatizados usam o fake (Ollama real é a demo manual).
- `OpenAIProvider` ganhou um cast pra continuar compilando com o `ChatRole`
  ampliado (tool calling nele é fora de escopo desta fase — só Ollama).

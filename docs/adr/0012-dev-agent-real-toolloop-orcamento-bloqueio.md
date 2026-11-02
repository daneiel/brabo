# ADR 0012 — DevAgent real: ToolLoop, orçamento por task e disciplina de bloqueio

- Status: aceito
- Data: 2026-07-24
- Fase: 4a (sessão 2 — substitui o NoopDevAgent)

## Contexto

A sessão anterior construiu a infraestrutura de execução (worktrees, identidade
de commit, pipeline git, trava de merge, claim atômico) e a validou com um
**NoopDevAgent** (sem LLM). Esta sessão substitui o corpo burro pelo **DevAgent
real**: reivindica a task, monta contexto rico via o Harness já existente da
Fase 3, implementa via **ToolLoop** dentro do worktree, só abre PR com suite
verde (rodada por ele via terminal), respeita orçamento de tokens por task, e
devolve task bloqueada com diagnóstico quando não consegue.

## Decisões

### 1. ToolLoop ganha halt-via-hook e teto de tokens (aditivo)

`Engine.Harness.ToolLoop` tinha só dois desfechos (`{:ok, ctx}` /
`{:limit_reached, ctx}`); nenhum agente em produção usava `.Default`
(Criativo/PO/Arquiteto reimplementam seu próprio loop) — baixo risco em
estendê-lo. Dois desfechos novos:

- `{:halted, reason, ctx}`: o hook `:post_tool_use` já suportava `{:halt,
  reason}` (`Engine.Harness.Hooks`), mas o resultado era DESCARTADO
  (`_ = Hooks.run(...)`). Agora `dispatch/2` usa `Enum.reduce_while` e
  propaga o halt — é o mecanismo que o DevAgent usa pra terminar o loop no
  exato turno em que sinaliza conclusão ou bloqueio (item 2).
- `{:budget_exceeded, ctx}`: `ctx.tokens_spent_micros` acumula o
  `usage.costMicros` que cada `llm_turn` já devolvia (e era ignorado);
  `ctx.token_budget_micros` (opcional, default `nil` = sem teto) checa ANTES
  do próximo turno — nunca gasta além do configurado, mesmo espírito do
  `limit_reached` (nunca loop infinito, agora também nunca gasto infinito).
- `ctx.tools` (registry de ferramentas) e `ctx.hooks` viram overrides
  explícitos — `Engine.Harness.Tools.specs/1`/`find/2` aceitam um registry
  alternativo (default o fixo, preserva EchoAgent/testes). O DevAgent usa
  `Engine.Dev.Tools.registry/0` (sem `EmitArtifact`; com `ReportDone`/
  `ReportBlocked`).
- `ctx.workspace_root` sobrescreve a raiz de arquivos/AGENTS.md (default o
  workspace compartilhado do projeto) — `WorkspaceFiles`, `InstructionFiles`
  e `ContextBuilder.build_layers/3` passam a aceitar essa raiz explícita. O
  DevAgent passa o **worktree** — ReadFile/WriteFile/SearchWorkspace e o
  AGENTS.md lido operam no branch/commit certo, não no clone compartilhado.
- **Terminal no worktree** (correção de gap real): `TerminalExecutor.run/3`
  SEMPRE rodava no workspace compartilhado do projeto, nunca no worktree do
  agente — sem correção, os testes do DevAgent rodariam fora do código que
  ele mudou. `cwd` opcional flui: `ActionPipeline` (payload da tool
  `terminal`) → `ExecuteTerminalActionUseCase`/`ApiToEngineClient` (api) →
  `POST /internal/actions/execute` → `TerminalExecutor` (engine).

### 2. Disciplina de término — ReportDone/ReportBlocked ENFORÇADOS

`Engine.Dev.Tools.ReportDone` não confia no LLM: procura a ÚLTIMA mensagem
`tool` "terminal" no histórico e EXIGE que comece com `"exit 0"` (formato
exato do `ActionPipeline.terminal_result/1`) — sem isso, devolve erro (o
modelo tenta de novo). `ReportBlocked` sempre aceita `{reason, diagnosis}`.
Um hook `:post_tool_use` novo (`Engine.Dev.Hooks.Termination`) halta o loop
quando um dos dois teve sucesso — usa o mecanismo do item 1. `DevAgentServer`
trata 5 desfechos possíveis do `ToolLoop.run/1`: `report_done` (abre PR),
`report_blocked`, `limit_reached`, `budget_exceeded`, e `{:ok, ctx}` (modelo
parou sem sinalizar — tratado como bloqueio de segurança). Nenhum caminho
abre PR sem prova de suite verde; nenhum deixa a task presa sem desfecho.

### 3. PR referenciando a story + status in_review

`taskStatusEnum` ganha `'in_review'` (`todo → in_progress → in_review →
done`; a transição pra `done` fica pra quando o QA existir — fora de escopo).
O corpo do PR é a checklist Markdown do DoD da story (`- [ ] item`); o
título referencia story+task. Contexto vem de `GetDevTaskContextUseCase`
(api, novo): story completa (RF/RNF/DoD/DoR), regras de negócio resolvidas
(`session_events` `artifact.business_rule`, mesmo padrão de
`CreateStoryUseCase`) e ADRs do projeto (sem filtro por módulo — mesma
simplificação de `GetArchitectureUseCase`, documentada).

### 4. Orçamento por task — resolvido no engine, sem tabela nova

Budgets (`budgets` table) são escopados só a projeto OU sessão; task não tem
sessão própria (todas as tasks de um módulo correm na mesma sessão de
execução). Em vez de uma migração invasiva em `budgets`/`token_usage`, o teto
por task é resolvido INTEIRAMENTE no engine: cada `run_task` chama
`ToolLoop.run/1` UMA vez, então `tokens_spent_micros` acumulado É o custo da
task, isolado por execução. `taskBudgetMicros` (configurável na ativação,
`POST execution/activate`, default US$0,50 se omitido) flui
`ActivateExecutionUseCase` → `startExecution` → `dev_agent_states` (nova
coluna, migração) → `ctx.token_budget_micros` do `ToolLoop`.

### 5. Bloqueio de task — enforcement de reclaim

`tasks` ganha `blocked boolean` + `blocked_reason text` (migração). Bloqueio
NÃO é um novo valor de status (a task volta a `todo`) — é uma flag ortogonal.
`ClaimNextTaskUseCase`/`claimNext` exclui `blocked = true` do claim atômico —
sem isso, uma task cronicamente impossível seria reclaimada e re-bloqueada
em loop. Um humano libera via `UnblockTaskUseCase`
(`POST sessions/:id/tasks/:id/unblock`) depois de ler o diagnóstico.

### 6. Bug real achado pelo teste de concorrência: `FOR UPDATE OF t`

O teste de N claims simultâneos (item 6) expôs que `claimNext`'s
`FOR UPDATE SKIP LOCKED` SEM `OF t` também tentava lockar a linha de
`stories` do join — como várias tasks compartilham a MESMA story, isso
serializava claims concorrentes pelo lock da story (SKIP LOCKED os
descartava em vez de tentar outra task), perdendo claims mesmo com tasks
disponíveis. Corrigido com `FOR UPDATE OF t` (lock só na linha de `tasks`).
Sem o teste real de concorrência (só sequencial, como a sessão anterior
tinha), esse bug passaria despercebido.

## Consequências

- UI: task atual/iteração/tokens gastos ao vivo (via o `agent.response`
  enriquecido, polling já existente); tasks bloqueadas em destaque (estilo
  já usado por "Pendências de validação cruzada").
- Testes: `tool_loop_test` (halt via hook, teto de tokens, registry
  customizado); `dev_agent_server_test` (fluxo feliz, task impossível →
  blocked, orçamento estourado → blocked, report_done sem suite verde →
  recusado); `claim-next-task` (concorrência real — achou o bug do item 6);
  `mark-task-blocked`/`get-dev-task-context` (novos).

## Escopo & assunções

Só o **DevAgent** (substituindo o Noop) — QA/SecOps/Infra e o painel de time
completo via canais Phoenix continuam fora desta sessão. `in_review → done`
fica pra quando o QA existir. ADRs por módulo continuam sem filtro real
(todos os ADRs do projeto). Janela de contexto do DevAgent fixada em
128.000 tokens (TODO: usar a janela real do modelo resolvido quando o turno
de LLM devolver isso pro engine — hoje o engine nunca soube desse número).

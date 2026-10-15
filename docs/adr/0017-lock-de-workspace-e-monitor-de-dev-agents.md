# ADR 0017 — Lock de inicialização do workspace, Monitor de dev agents e herança de teto

- Status: aceito
- Data: 2026-07-25
- Fase: 4a (correções pós-auditoria)

## Contexto

Auditoria da Fase 4a contra os 7 itens da sessão original e o critério de aceite.
Quatro defeitos confirmados (um deles quebrando o critério de aceite) e uma
flakiness de ~50% na suite do engine. Este ADR registra o que muda de estrutural;
as decisões originais estão no [ADR 0011](0011-infra-dev-agents-worktrees-merge-lock.md).

## Decisões

### 1. `Workspace.ensure!/3` serializa a inicialização por projeto (revisa 0011 §4)

O ADR 0011 aceitou a corrida do working tree como "não é um requisito do critério
de aceite". **Era**: na ativação, os N dev agents do projeto sobem juntos e todos
chamam `ensure!/3` vendo o working tree ainda inexistente. Os `git init`/`fetch`
colidiam no mesmo diretório (`could not lock config file`, `cannot copy
.../hooks/*.sample`). Medido: com 8 agentes, 7 morriam; com 2 — o número do
critério de aceite — 1 morria, reprodutível em 6/6 execuções.

A inicialização passa a rodar dentro de `:global.trans({{Workspace, project_id},
self()})`, com recheque dentro da seção crítica (quem esperou encontra o working
tree pronto). O lock é por projeto: projetos distintos seguem em paralelo. O
caminho quente (working tree já existente) nem toca no lock.

### 2. `Workspace.ensure/3` não levanta; falha de worktree devolve a task

`ensure!/3` levantava `MatchError`, e o `DevAgentServer` é `restart: :temporary` —
o agente morria em definitivo. Pior: a task já fora reivindicada (`in_progress`,
`blocked = false`), ficando invisível pro claim (que só pega `todo`) e fora do
alcance do unblock. Task travada sem caminho de recuperação pela UI.

Novo `ensure/3` devolve `{:ok, dir} | {:error, mensagem}`, usado pelo
`WorktreeManager.create/3`; o `DevAgentServer` fixa o `task_id` no state **antes**
de montar o worktree e chama `block_task/3` na falha.

### 3. `Engine.Dev.Monitor` — dev agents ganham o Monitor que só sessões tinham

`DevAgentState.delete/2` existia sem nenhum call site: a linha sobrevivia ao
processo e o `DevRehydrator` ressuscitava, a cada boot, todo dev agent que já
existiu (inclusive os mortos por crash, que voltavam sem ciclo de trabalho e
seguravam o `agent_id` no Registry — deixando o `WorktreeCleanupWorker` inócuo,
já que agente "vivo" nunca tem worktree órfão).

Novo `Engine.Dev.Monitor` espelha o `Engine.Sessions.Monitor`, com uma distinção
que o de sessões não faz: **`:shutdown` preserva a linha** (é exatamente o caso
que a rehydration cobre — o nó descendo), qualquer outro motivo a apaga.

Os dois Monitors são **singletons**: se morrem, o engine perde de uma vez o
monitoramento de todos os processos observados. O `delete` no banco passa a ser
guardado (`rescue`/`catch :exit`) nos dois — uma indisponibilidade do banco não
pode ter esse efeito. Era também a causa raiz da flakiness restante da suite.

### 4. O subagente da paralelização herda os tetos do agente base

`parallelize` subia o `dev-<modulo>-2` com os defaults `nil`. Como a guarda do
`ToolLoop` é `when is_integer(budget)`, `nil` significa **ilimitado**: o aceite de
um clique criava um agente sem teto de gasto. A api não serve de fonte — ela não
persiste o orçamento escolhido na ativação —, então o extra herda do estado
durável do agente base; sem agente base, o engine recusa com 409 em vez de criar
um agente sem teto. O `AcceptParallelizationUseCase` passa a chamar o engine
**antes** de gravar o evento, já que o event log é imutável.

### 5. `persist/1` grava `max_gate_corrections` explicitamente

A coluna está na lista de `:replace` do `on_conflict`; omiti-la no upsert a zerava
no primeiro ciclo de task. Os gates leem esse campo do banco
(`qa_agent_server`/`secops_agent_server`), então o teto escolhido pelo usuário
virava silenciosamente o `DEFAULT_MAX_GATE_CORRECTIONS = 3` da api.

## Consequências

- O critério de aceite de dois devs em paralelo passa a valer em projeto novo.
- Testes novos: 8 `ensure/3` concorrentes no mesmo projeto; `ensure/3` devolvendo
  erro sem levantar; falha de worktree devolvendo a task; tetos sobrevivendo ao
  `persist`; Monitor apagando no crash e preservando no `:shutdown`; herança de
  teto na paralelização e o 409 sem agente base.
- Suite do engine: 173 testes, 12/12 execuções verdes (linha de base: 9 falhas em
  18 execuções).
- `workspace_test.exs` e `workspace_files_test.exs` viram `async: false` — eram os
  únicos módulos `async: true` mutando o `Application.env` global
  `:project_workspaces_root`.

## Não resolvido (auditoria)

Fica registrado o que a auditoria achou e esta sessão não trata: a sugestão de
paralelização ainda é `count >= 2`, não grafo de dependências (não há dependência
entre tasks no schema); `dev_agent_states.status` nunca sai de `"working"`; a
branch não é persistida; a trava de merge não cobre `git_merge` sem `targetBranch`
no payload (hoje inalcançável — nenhum agente propõe `git_merge`); e o outbox só
drena `aggregate_type = "session"`.

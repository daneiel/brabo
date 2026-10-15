# ADR 0011 — Infraestrutura dos dev agents: worktrees, executores git e trava de merge

- Status: aceito
- Data: 2026-07-24
- Fase: 4a (sessão 1 — infraestrutura de execução)

## Contexto

Início da Fase 4 (agentes de execução). Antes dos devs reais, esta sessão constrói a
INFRAESTRUTURA e a valida com um **NoopDevAgent** (sem LLM): instanciação dinâmica de um dev
por módulo do module_map, worktrees git isolados, identidade de commit `dev-<modulo>[bot]`,
a trava de merge em branch protegida, sugestão de paralelização com aceite de um clique, e
limpeza de worktrees órfãos. Decisão do usuário: fluxo git **100% local self-contained**.

## Decisões

### 1. Trava de merge como TETO no domínio (decide.ts)
Novo `ActionType git_merge` (payload `{sourceBranch, targetBranch}`). `decide()` avalia IAM →
agent_autonomy → permissions (cada estágio só SOBE a permissividade); ao final, um **teto**:
se `git_merge` com `targetBranch ∈ {dev,qa,rc,main}` (branches protegidas), a policy NUNCA é
`auto_approve` — rebaixa pra `require_approval`, independente de agent_autonomy e
permissions.json. Deny ainda vence. Teste prova que nem autonomy nem permissions
sobrescrevem. Merge em branch protegida é SEMPRE manual (CLAUDE.md).

### 2. Executores git via pipeline; commit local no worktree
`git_commit`/`git_push`/`pr_open`/`git_merge` ganham executores (antes só `terminal`/
`open_adr_pr`). `git_commit`/`git_push` rodam NO ENGINE (`GitExecutor`, `System.cmd git` no
worktree — commit com `--author=dev-<modulo>[bot]` + `Co-authored-by`), via um endpoint
interno espelhando o terminal. `pr_open`/`git_merge` rodam na api via `GitProvider`.
`ExecuteGitActionUseCase` roteia; `ApproveAction`/`ProposeAction` (auto_approved) chamam-no.
Toda operação git nasce como proposed_action (item 3), respeitando autonomia/permissions.

### 3. LocalGitProvider ganha PR local (self-contained)
`openPullRequest`/`mergePullRequest` implementados com um store leve (sidecar JSON no bare
repo) + merge via git; `capabilities.pullRequests` vira `true`. Reverte (aditivamente) a
decisão da Fase 2 de não suportar PR no local — necessário pro demo rodar sem GitHub. A
suite de contrato única passa a cobrir PR no local.

### 4. Worktrees off o working tree local; 1 por agente; limpeza de órfãos
`WorktreeManager` cria worktrees em `<workspace>/.worktrees/<agent_id>` (branch
`feature/<task>`) a partir do working tree que `Engine.Actions.Workspace` já monta do bare
repo. 1 worktree por agente (o dir por agent_id garante); `WorktreeCleanupWorker` (Oban
auto-reagendado) poda os órfãos (worktree sem agente vivo no `Engine.Dev.Registry`).

### 5. Dev agents dinâmicos: supervisão + rehydration
`DevAgentSupervisor` (DynamicSupervisor) + `Engine.Dev.Registry` (chave `{project_id,
agent_id}`), um `DevAgentServer` por módulo. Estado durável em `dev_agent_states` (schema
`engine`); `DevRehydrator` recria os agentes no boot (mesmo idioma do `SessionServer`/
`Rehydrator`) — rehydration NÃO redispara o ciclo `:work`. O NoopDevAgent (`:work`): pega
task (claim atômico `FOR UPDATE SKIP LOCKED`) → worktree → arquivo trivial → propõe
commit/push/pr_open. A `ActivateExecutionUseCase` semeia instruções + autonomia
`auto_approve` (git ops) por módulo e manda o engine subir os agentes.

### 6. Paralelização sugerida; aceite de um clique
Na ativação, módulos com ≥2 tasks pegáveis (ramos independentes disponíveis — grafo de deps
de tasks simplificado por ora) emitem `execution.parallelization_suggested`. O aceite (botão
na UI → engine) sobe um `dev-<modulo>-2` com worktree próprio.

## Consequências

- A visão geral do projeto ganha a seção **Execução**: botão "Ativar execução" (quando há
  module_map), os dev agents com branch/task, a sugestão de paralelização com "Aceitar", e
  as PRs abertas. O feed narra `dev.*`/`execution.*`.
- Testes: `decide` (trava de merge — nem autonomy nem permissions auto-aprovam merge em
  protegida); `ClaimNextTaskUseCase` (claim atômico, distinto por agente); LocalGitProvider
  PR (contrato); `worktree_manager` (2 worktrees paralelos sem conflito + limpeza de
  órfãos); `dev_agent_server` (ciclo Noop + persistência/rehydration).

## Escopo & assunções

Só o **NoopDevAgent** (sem LLM) — os devs reais (harness + LLM) são a próxima sessão. O
painel de time ao vivo completo (canais Phoenix) e o QA/SecOps/Infra vêm depois. `git_merge`
executa (GitProvider) só na aprovação manual — o demo exercita a REJEIÇÃO do auto-merge.
**Assunção do dev-env:** api e engine compartilham o FS dos bare repos (`GIT_LOCAL_REPOS_ROOT`)
e dos workspaces (`PROJECT_WORKSPACES_ROOT`) — volumes no Compose.

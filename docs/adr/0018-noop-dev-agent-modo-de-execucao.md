# ADR 0018 — NoopDevAgent como modo de execução permanente

- Status: aceito
- Data: 2026-07-25
- Fase: 4a (validação da infraestrutura de execução)

## Contexto

O NoopDevAgent existiu na Fase 4a (ADR 0011) como o corpo do `:work` do
`DevAgentServer` e foi **substituído** pelo agente real na sessão seguinte
(ADR 0012). Com isso, a única forma de exercitar a infraestrutura de execução
de ponta a ponta — worktree isolado, identidade `dev-<modulo>[bot]`, pipeline
de `proposed_actions`, PR — passou a ser rodar o agente REAL, que depende de
LLM: caro, lento e não determinístico. Um smoke test de infraestrutura não
pode depender de um modelo.

Esta sessão traz o Noop de volta, agora como um **modo de execução
permanente** que convive com o agente real.

## Decisões

### 1. `Engine.Dev.AgentIo` — os efeitos colaterais compartilhados
Novo módulo com `via/2`, `emit/3`, `claim_task/1`, `propose/3`,
`propose_commit/2` (a identidade), `propose_push/1`, `propose_pr/3`,
`persist/1`, `block_task/3` e `worktree_manager/0`, extraídos do
`DevAgentServer` sem mudança de comportamento. **Os dois servers usam o mesmo
código**: um Noop que reimplementasse worktree/identidade/pipeline validaria
uma cópia, não a infraestrutura. `dev_agent_server_test.exs` (12 casos) é a
rede de segurança da extração — passou sem edição.

### 2. `Engine.Dev.NoopDevAgentServer` — modo, não identidade
GenServer próprio, mesmo Registry, **mesmo `agent_id`** (`dev-<modulo>`) e
mesmo estado durável do agente real. Por ser o mesmo agent_id, a autonomia e
as instruções seedadas pela api valem sem nenhuma mudança. Ciclo: claim →
worktree → arquivo trivial → commit → push → PR → task `in_review`.
**Não abre gate** (QA é agente de LLM): o Noop para na PR. `{:correct, _}`
tem cláusula defensiva que devolve a task com diagnóstico em vez de derrubar
o processo — `DevAgentServer.correct/3` é um cast no `via/2` e chegaria aqui.

### 3. `dev_agent_states.impl` — o modo é durável
Coluna nova (`"real"` default). A reidratação é quem escolhe o módulo a
subir: sem persistir o modo, um Noop voltaria como agente **real** depois de
um restart do nó — passando a gastar token sem ninguém pedir.
`DevAgentSupervisor.start_agent/7` recebe `impl`; `server_for/1` mapeia
modo → módulo (qualquer coisa fora de `"noop"` cai no real — o default
seguro é o de produção). O aceite da paralelização **herda o `impl`** do
agente base, pela mesma razão que já herdava os tetos.

### 4. Aceite da paralelização passa a seedar o subagente extra
Correção de um bug real: `AcceptParallelizationUseCase` não criava linha de
`agent_autonomy` nem instrução pro `dev-<modulo>-2`. Sem autonomia, `decide()`
cai no default `require_approval` — o "aceite de um clique" virava três
aprovações manuais por task, e o critério de aceite ("ver o terceiro
trabalhando") não fechava. Agora seeda instrução + `auto_approve` nos mesmos
`DEV_AUTO_GIT_ACTIONS` do agente base, **antes** de chamar o engine.
`git_merge` continua de fora.

### 5. Bare repos montados RW pro engine no Compose
Era `git_local_repos:/data/git-repos:ro`. Desde a Fase 4a o executor
`git_push` roda NO ENGINE e empurra a branch do worktree pro bare repo — com
o mount read-only o push morre em `remote unpack failed: unable to create
temporary object directory` e a PR do dev agent nunca abre. O `:ro` era uma
premissa da Fase 1 (o engine só fazia checkout) que a Fase 4a invalidou sem
que ninguém percebesse: o demo do critério de aceite **não passava** com a
configuração anterior.

## Consequências

- `POST /projects/:id/execution/activate` aceita `devAgentImpl: 'real' |
  'noop'` (omitido = `real`). A UI **não muda** — o modo Noop é ferramenta de
  validação, não recurso de produto; o demo o aciona via script.
- `pnpm --filter api demo:noop-execution` roda o critério de aceite inteiro
  contra a stack do Compose.
- Testes novos: `noop_dev_agent_server_test.exs` (ciclo, identidade, ausência
  de LLM, worktree falhando, 2 agentes em paralelo),
  `dev_rehydrator_test.exs` (o modo sobrevive ao restart, `:work` não é
  redisparado, idempotência) e `git_executor_test.exs` (a identidade no
  **git de verdade**: author bot + `Co-authored-by`, worktrees isolados) —
  este último cobria uma lacuna: até agora só se afirmava o payload da
  proposta, nunca o commit resultante.

## Escopo & assunções

O Noop não substitui o agente real em nada: não lê contexto de task, não roda
suite, não passa por gates. Serve pra responder "a infraestrutura de execução
está de pé?" sem acender um LLM. A sugestão de paralelização continua sendo
`countClaimableByModule >= 2`, não um grafo de dependências de tasks (não há
dependência entre tasks no schema) — segue em aberto, como ADR 0017 já
registrava.

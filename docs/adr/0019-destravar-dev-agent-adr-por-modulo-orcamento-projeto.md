# ADR 0019 — Destravar o DevAgent real: escrita, terminal, ADR por módulo e orçamento por projeto

- Status: aceito
- Data: 2026-07-25
- Fase: 4a (fechamento dos desvios do DevAgent real)

## Contexto

O DevAgent real (ADR 0012) estava completo no papel — ToolLoop no worktree,
`ReportDone` exigindo suite verde, bloqueio com diagnóstico, orçamento por task
— mas **nunca tinha rodado o critério de aceite com LLM de verdade**. Ao tentar,
a auditoria achou o motivo: ele **não conseguia implementar nada**.

## Decisões

### 1. O DevAgent estava travado em DOIS pontos (o achado central)

- `write_file` de um `dev-*` não estava na whitelist do `WriteFilePolicy` (o
  default só tinha `echo`), então virava `proposed_action` — e `write_file`
  **não tem executor na api**, ou seja, nem aprovado escrevia.
- `terminal` não tinha nenhuma regra: `decide()` caía em `require_approval` e a
  ação nascia pendente.

Como `ReportDone` só libera PR depois de um `terminal` com `exit 0` no
histórico, a suite verde era **inalcançável**: toda task terminava bloqueada por
limite de iterações. O enforcement da disciplina de término estava certo; o que
faltava era o agente poder agir.

**Correções:**
- `WriteFilePolicy` ganha prefixos de agente (`:write_file_agent_prefixes`,
  default `["dev-"]`): o dev escreve em qualquer caminho da sua raiz. É seguro
  porque a raiz dele É o worktree e `WorkspaceFiles.write_file/3` já barra
  travessia — **o sandbox é o worktree, não a lista de prefixos de path**.
- `DEV_TERMINAL_ALLOW_PATTERNS` (domínio da api) é seedado no `permissions.json`
  na ativação. Padrões ESTREITOS de teste/build (`Terminal(pnpm test)`,
  `Terminal(npm test)`, `Terminal(mix test)`, …), com override no DTO.
  Deliberadamente **não** é `agent_autonomy auto_approve` pra `terminal`: isso
  liberaria qualquer comando. Sendo regra de arquivo, `deny` continua vencendo,
  os `BUILTIN_DENY_PATTERNS` seguem ativos e comando composto exige que cada
  segmento case.

### 2. ADRs filtrados por módulo
`open_adr_pr` ganha `modules?: string[]` (a ferramenta do Arquiteto o preenche).
`GetDevTaskContextUseCase` filtra pelo módulo do dev; ADR **sem** `modules` é
transversal e entra sempre — o que inclui todo o acervo anterior ao campo, sem
migração de dados. Sem módulo informado não há filtro, preservando os gates
QA/SecOps, que reusam o mesmo contexto.

### 3. Prioridade de descarte do prompt estava invertida
`estado_tarefa` era `[story, task | adrs]` e `PromptAssembler.fit_units/3`
descarta **pela cabeça**: sob pressão de contexto, a story (RF/RNF/DoD) era
sacrificada e os ADRs sobreviviam — o contrário do que serve a quem vai
implementar. Agora é `adrs ++ [story, task]`.

### 4. Orçamento por task persistido no projeto
Era só parâmetro da ativação, vivendo em `engine.dev_agent_states`: reativar sem
repassá-lo voltava silenciosamente ao default. Nova coluna
`projects.task_budget_micros`; resolução **parâmetro → projeto → default**, com
persistência quando vem no parâmetro.

### 5. Artefato `task_blocked`
O bloqueio só emitia evento + flag no banco. Agora emite também
`artifact.task_blocked`, validado por `ArtifactSchemas` — server-emitted, nunca
por tool call (o modelo não escolhe declarar que desistiu).

### 6. Diagnosticabilidade: erro de LLM não pode virar diagnóstico vazio
`ToolLoop` devolvia `{:ok, ctx}` tanto quando o modelo parava sem sinalizar
quanto quando a chamada ao provider FALHAVA — e o `DevAgentServer` bloqueava a
task com diagnóstico `""`. O ctx passa a carregar `:last_error` e o diagnóstico
distingue os dois casos. Isto não é teórico: o primeiro demo real morreu num
`Req.TransportError{reason: :timeout}` invisível.

### 7. Timeout de turno de LLM
`llm_turn` usava o default do Req. Com modelo local, o PRIMEIRO turno ainda
carrega vários GB de pesos antes do primeiro token e estoura. Novo
`llm_turn_timeout_ms` (default 300s, env `LLM_TURN_TIMEOUT_MS`).

### 8. Node na imagem do engine
A suite do projeto gerido roda **dentro do container do engine** (é lá que o
`terminal` executa, no worktree). Sem o toolchain, `npm test` nunca dá exit 0.
**Limitação conhecida:** isso não escala pra stacks arbitrárias — a saída real é
um sandbox por projeto, fora do escopo da Fase 4a.

## Consequências

- Testes novos: `write_file_policy` (dev escreve na raiz; travessia barrada),
  `context_builder` do dev (RF/RNF/DoD + ADRs do módulo + AGENTS.md realmente no
  prompt; ADRs descartados antes da story), suite vermelha até o limite com a
  saída do teste no diagnóstico, artefato `task_blocked`, filtro de ADR por
  módulo, `activate-execution` (ordem do orçamento, padrões de terminal, nunca
  `git_merge`), e `lib/execution.ts` no web.
- UI: título da task no painel (antes só a branch `task-<8hex>`), invalidação do
  backlog pelo canal (blocked ao vivo) e botão de desbloquear.

## Resultado do critério de aceite (honesto)

Toda a cadeia foi exercitada de ponta a ponta com LLM local: claim atômico,
worktree isolado, contexto montado, turno de LLM, e o desfecho de bloqueio com
diagnóstico e artefato. **O que NÃO fechou foram as 2 PRs verdes** — e a causa é
o modelo, não a plataforma: `qwen2.5-coder:7b` não implementa tool calling no
template do Ollama. Verificado direto contra `/api/chat`, com `stream: false` e
payload de `tools` correto, a resposta vem com `tool_calls: null` e a chamada
escrita como JSON no `content`. Nenhum ajuste no `OllamaProvider` corrige isso.

Fechar o critério exige um modelo com template de tools de verdade (`llama3.1:8b`
ou maior) ou um provider pago. É decisão do usuário — a plataforma está pronta
pra ambos.

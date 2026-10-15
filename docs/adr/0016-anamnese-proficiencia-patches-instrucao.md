# ADR 0016 — Anamnese: perfil de proficiência, patches de instrução e loop fechado

- Status: aceito
- Data: 2026-07-24
- Fase: 4b (sessão 2 — fecha a Fase 4)

## Contexto

O Psicólogo (ADR 0015) já produz hipóteses com evidência e emite
`psychologist.hypothesis_accepted_for_anamnese` — um evento
deliberadamente sem consumidor, documentado lá como "gancho pra 4.6".
Esta sessão constrói o consumidor: a **Anamnese**, job Oban periódico
por projeto que deriva `proficiency_profile` por usuário+competência a
partir de janelas do event log, propõe `instruction_patch` nos arquivos
de agente (com diff, aprovação e rollback) e fecha o loop
hipótese→patch→versão.

Critério de aceite: a Anamnese propõe 1 patch com diff compreensível;
aceitar uma hipótese faz o patch seguinte referenciá-la; rollback faz o
agente voltar ao comportamento anterior.

## Decisões

### 1. Guarda-corpo é ESTRUTURAL, não uma instrução de prompt

`domain/anamnese/competency-catalog.ts` deriva o catálogo permitido
deterministicamente: stacks do `module_map` vigente (normalizadas) +
uma lista de competências de processo **hard-coded**
(`git`, `agile`, `arquitetura`, `testes`, `seguranca`, `infra`).
`validateProficiencyBatch` rejeita o LOTE INTEIRO se qualquer entrada
citar algo fora do catálogo.

O ponto: um modelo que tentasse emitir "ansiedade", "saúde mental" ou
"personalidade" **não tem caminho de escrita que aceite** — a proibição
não depende do prompt obedecer. O prompt reforça, o domínio garante. Há
teste explícito com 8 atributos sensíveis.

### 2. Apagar o perfil apaga de verdade — e o opt-out impede a re-derivação

`DELETE` das linhas + uma linha em `anamnese_opt_outs`. Sem o opt-out, a
rodada seguinte re-derivaria exatamente o mesmo perfil e o botão
"apagar" seria cosmético. O usuário volta a ser perfilado só com opt-in
explícito. Usuário opted-out é filtrado em DOIS pontos (o contexto que
vai pro prompt e a validação do lote), então nem entra no prompt nem
consegue virar linha.

### 3. Histórico de instrução em tabela append-only separada

`agent_instructions` tinha `unique(project_id, agent)` e bumpava
`version` destrutivamente — o conteúdo anterior era perdido, rollback
era impossível.

Em vez de reformar essa tabela, `agent_instruction_versions` (nova,
append-only) guarda o histórico e **`agent_instructions` segue intocada
como ponteiro do "current"** — que é exatamente o que o engine lê via
Ecto read-only. Resultado: nenhuma mudança no schema do engine nem no
fixture de teste dele.

**Backfill retroativo**: tudo que foi semeado antes desta fase tem
instrução mas nenhuma versão no histórico. `ApplyInstructionVersionService`
captura o conteúdo vigente como versão ANTES de sobrescrever, quando o
histórico está vazio — sem isso o primeiro rollback não teria pra onde
voltar.

### 4. Rollback é operação PRA FRENTE

Reverter pra v2 grava uma versão NOVA com o conteúdo da v2. Nada é
apagado nem reescrito: dá pra "desfazer o desfazer", e a trilha de
auditoria mostra quando cada reversão aconteceu. A versão restaurada
preserva o `sourceHypothesisId` original, então a rastreabilidade
sobrevive ao rollback.

`ApplyInstructionVersionService` é o ponto ÚNICO por onde o conteúdo
muda (patch aprovado e rollback passam os dois por ele), o que garante
que nenhum caminho esqueça de gravar a versão ou invalidar o cache.

### 5. Cache de instrução: match-delete em TODAS as raízes

Descoberta desta sessão: `InstructionFiles.invalidate/3` existia mas
**nunca era chamado em produção** — só no teste. Pior, a chave do cache
é `{project_id, agent, root}` e a `root` varia (nil pro workspace
compartilhado, path do worktree pros dev agents), então invalidar uma
chave deixaria o dev servindo a instrução velha.

Novo `Cache.delete_agent/2` (`:ets.match_delete` por
`{{project_id, agent, :_}, :_}`) + `InstructionFiles.invalidate_all/2` +
endpoint interno `POST /internal/projects/:id/agents/:agent/instructions/invalidate`,
chamado pela api depois de todo patch/rollback.

**Limitação conhecida e aceita**: agentes que montam o system prompt a
cada `run` (dev-*, QA, SecOps, Psicólogo, Anamnese — os alvos típicos de
um patch) pegam a mudança na PRÓXIMA execução; os conversacionais
(Criativo/PO/Arquiteto/Infra) congelam o prompt no `init` e só pegam ao
reiniciar. Rebuild de prompt em GenServer vivo foi descartado
deliberadamente: mexeria em 4 GenServers da Fase 3 que o CLAUDE.md pede
pra não refatorar sem necessidade, e o critério de aceite fecha sem
isso. A invalidação é **best-effort** — falhar nela não reprova o
patch (o conteúdo já está no banco).

### 6. Diff LCS escrito à mão, sem dependência nova

`domain/instructions/text-diff.ts`, ~60 linhas puras. Justificativa
(CLAUDE.md pede justificar libs): o formato de saída já era ditado pelo
renderer que JÁ existe em `ApprovalCard.tsx`
(`{kind: 'add'|'del'|'ctx', content, lineNo}`), instruções são arquivos
de dezenas a poucas centenas de linhas (n·m trivial, não precisa de
Myers), e o repo favorece funções de domínio puras e testadas. O
`ProposeInstructionPatchUseCase` já entrega `files[].lines` no formato
do renderer — a UI não ganhou differ próprio.

### 7. "Não repropor patch negado" sem tabela nova

`isDuplicateOfRejected` compara contra os conteúdos das
`proposed_actions` do tipo `instruction_patch` com status `denied` —
derivado dos dados que já existem, sem estrutura nova pra manter em
sincronia. A normalização enxerga através de CRLF, espaço à direita e
padding de linhas em branco (ruído de formatação), mas **preserva
indentação à esquerda** (pode mudar o sentido em markdown), então uma
reindentação conta como patch diferente.

### 8. Patch de instrução NUNCA é auto-aprovável

Teto em `decide.ts` no mesmo espírito da trava de merge: nem
`agent_autonomy` nem `permissions.json` conseguem promover
`instruction_patch` a `auto_approve`. O valor da feature está no humano
ver o diff antes; auto-aprovar seria o agente reescrevendo a si mesmo.

### 9. Loop fechado por fila explícita, não por outbox

`AcceptHypothesisUseCase` enfileira em `anamnese_queue` (unique por
`hypothesisId`, idempotente) ao lado dos eventos que já emitia. Enfileirar
aqui é determinístico — não depende de rotear o outbox nem de o
consumidor estar de pé. `Engine.Anamnese.Triage.should_run?/2` faz
hipótese na fila **sempre forçar** a rodada (mesmo com janela silenciosa):
ignorá-la quebraria o loop que o usuário acabou de pedir.

A cadeia completa: hipótese aceita → `anamnese_queue` → prompt da rodada
como "input PRIORIZADO" → `propose_instruction_patch` com
`hypothesisId` → payload da proposed_action → `sourceHypothesisId` na
versão gravada → badge de origem na UI.

### 10. Rodada periódica: scheduler global com fan-out por projeto

`AnamneseSchedulerWorker` reusa o idioma exato do `OutboxDrainWorker`
(sem `:unique` no `use` — o job em execução colidiria consigo mesmo e
mataria a corrente; `unique:` só no `kickoff/0` com
`states: [:available, :scheduled, :retryable]`). Tick de 15 min;
os jobs FILHOS têm `unique` por `project_id`, então um projeto lento não
empilha rodadas.

A Anamnese é project-scoped mas `append_event`/`token_usage` são
session-scoped por FK — o scheduler escolhe a sessão mais recente do
projeto como endereço da narração (precedente: `repo_bootstraps` usa uma
sessão dedicada). Projeto sem sessão nenhuma não roda.

Rodada que não conclui **não grava** `anamnese_runs`, então a janela é
reprocessada na próxima (mesma disciplina do Psicólogo); rodada sem
material novo e sem fila é **pulada sem gastar LLM**.

## Consequências

- Novo `SessionEventRepository.listForProjectInWindow` (api) e
  `Engine.SessionEvents.Event.list_for_project_window/4` (engine) — não
  existia consulta por janela de tempo. O engine lê a janela direto do
  Postgres (mais barato que trafegar o log por HTTP), juntando em
  `sessions` porque `session_events` não carrega `project_id`.
- Nova `Engine.Sessions.ProjectSession` (read-only) e
  `Engine.Projects.Project.list_ids/0` — o engine não sabia listar
  projetos nem achar a sessão de um.
- "Comandos que aprova/nega" não são session_events (só outbox + a
  tabela `proposed_actions`, onde vive o `rejectionReason` em texto
  livre). Nesta sessão a janela cobre os eventos de usuário do log; ler
  as decisões de `proposed_actions` fica como evolução natural do
  contexto.
- UI: duas seções novas em `ProjectSettingsTab` (perfil com evidências
  clicáveis e botão de apagar; histórico de versões com diff e
  rollback), branch `instruction_patch` no `ApprovalCard` com badge da
  hipótese de origem, e branches `instruction.*`/`anamnese.*` em
  `activity.ts`.
- `Engine.Harness.Agents` — a identity de `"anamnese"` descrevia
  onboarding de projeto; reescrita pro papel real (perfilamento com
  evidência e proibição explícita de atributo sensível).

## Escopo & assunções

Fora: sincronizar a união `ActionType` do web com os 12 tipos do backend
(dívida pré-existente — só `instruction_patch` entrou, por ter
renderização própria); rebuild de prompt em GenServer conversacional
vivo; índice novo em `session_events` pra janela por projeto (se a
varredura virar gargalo, vira follow-up); edição manual de instrução
pela UI (só patch proposto + rollback).

O nível de proficiência é uma escala de três (`iniciante`/
`intermediario`/`avancado`) — deliberadamente grossa: a precisão de uma
escala maior não seria sustentável a partir de evidência observacional.

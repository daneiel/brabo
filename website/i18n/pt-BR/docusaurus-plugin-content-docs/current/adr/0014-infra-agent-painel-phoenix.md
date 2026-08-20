# ADR 0014 — InfraAgent e painel do time ao vivo (fechamento da Fase 4a)

- Status: aceito
- Data: 2026-07-24
- Fase: 4a (sessão 4 — fechamento)

## Contexto

Últimos dois itens da Fase 4a: o **InfraAgent** (lê module_map + ADRs de
infra do Arquiteto, propõe Dockerfiles/compose/CI via PR — nunca aplica em
ambiente) e o **painel do time completo** (todos os agentes instanciados,
status ao vivo via canais Phoenix, não mais status estático/uniforme). Com
isso a Fase 4a fecha; a Fase 4b (Psicólogo/Anamnese) fica pra depois.

Critério de aceite: no projeto-cobaia, o InfraAgent entrega PR com
Dockerfile válido que passa os gates (QA sintática + SecOps scan), e o
painel mostra o time inteiro com estados corretos durante uma execução
real.

## Decisões

### 1. Handoff Arquiteto→Infra — mesmo mecanismo, novo ponto de oferta

O InfraAgent segue a MESMA família dos agentes session-scoped
(Criativo/PO/Arquiteto) — não o padrão project-scoped do Dev/QA/SecOps —
porque é ativado por handoff explícito, não instanciado um-por-módulo.
`ArquitetoServer` ganha `handle_call(:offer_infra_handoff, ...)` (mirror de
`confirm_readiness` do Criativo): roda um turno de fechamento e chama
`EngineApiClient.create_handoff(project_id, session_id, "arquiteto",
"infra", nil)`. Endpoint humano dedicado
`POST projects/:id/sessions/:id/agents/arquiteto/handoff-infra` →
`OfferInfraHandoffUseCase` — **não** reaproveita o endpoint `readiness` do
Criativo (agentes e momentos diferentes do fluxo).

`AcceptHandoffUseCase` ganha a seed de autonomia condicionada a
`toAgent === "infra"`: `agent_autonomy (infra, open_infra_pr) =
auto_approve` (a PROPOSTA da PR é segura de auto-aprovar — o InfraAgent
nunca aplica nada em ambiente) e `(infra, terminal) = deny`. `ArquitetoSupervisor`/
`agent-activation.ts` já são genéricos por nome de agente — nenhuma mudança
necessária além do `agent_command_controller.ex` ganhar a clause `"infra"`.

### 2. Restrição de terminal é estrutural + policy, não um novo ActionType

`decide()` avalia IAM → agent_autonomy → permissions.json, cada estágio só
SOBE a permissividade — um `deny` em agent_autonomy CURTO-CIRCUITA antes de
permissions.json ser consultado. Logo, "negar terminal genérico mas liberar
hadolint" não dá (e não precisa) ser expresso no MESMO ActionType
`terminal`: a validação hadolint do InfraAgent (`ValidateInfraFile`, tool
`:direct`) roda como chamada direta a `System.cmd` via
`Engine.Actions.HadolintDetector`, sem proposed_action nenhuma — mesmo
padrão dos detectors do SecOps. A negação do `terminal` genérico é dupla:
**estrutural** (o tool registry do InfraAgent — `[ValidateInfraFile.spec(),
ProposeInfraPr.spec()]` — nunca inclui `Terminal`) e **policy** (`agent_autonomy
(infra, terminal) = deny`, defesa em profundidade testável via `decide()`
mas não o mecanismo real que impede o uso indevido).

### 3. `open_infra_pr` generaliza `open_adr_pr` pra N arquivos

Novo `ActionType` (`decide.ts`) calibrado como `open_adr_pr`
(maintainer/pending por padrão). `domain/git/infra-pr-execution-result.ts`
espelha `AdrPrExecutionResult`, mas `paths: string[]` (commit único com
vários arquivos). `ExecuteInfraPrUseCase` generaliza `ExecuteAdrPrUseCase`:
`GitProvider.commitFiles` já aceitava `files: {path,content}[]` — só o
consumidor estava fixo em 1 arquivo. Branch fixa `feature/infra-setup`
(uma por sessão, não por slug como o ADR).

**Ciclo de correção sem PR nova**: uma sessão produz UM único ciclo de PR
de infra — a correção depois de `changes_requested` reaproveita a MESMA
branch/PR em vez de abrir outra. `ExecuteInfraPrUseCase` detecta isso via
`InfraArtifactRepository.findBySessionId` (novo): se já existe um artefato
pra sessão, a chamada é tratada como correção — `commitFiles` só, sem
`createBranch`/`openPullRequest`, sem nova linha em `infra_artifacts`
(reaproveita o `pullRequestUrl`/`pullRequestId` da execução ORIGINAL, lidos
de volta via `listByProjectAndType`). `InfraAgentServer` ganha
`handle_cast({:correct, findings}, state)` (mirror de
`DevAgentServer.correct/3`): instrui o modelo a corrigir e chamar
`propose_infra_pr` de novo — o MESMO tool, sem ramificação especial pro
caso de correção (a diferenciação vive inteiramente na api).

### 4. Gates de infra: tabela paralela leve, mesma máquina de estados

PR de infra não tem task/story/worktree por trás (arquivos nascem como
conteúdo direto, igual ADR — nunca tocam um worktree). Em vez de forçar o
encaixe em `tasks`, nova tabela `infra_artifacts` (migração 0016) com as
MESMAS colunas de gate que `tasks` tem (`gate_status`, `gate_correction_count`,
`blocked`, `blocked_reason`) + `pr_action_id` (id da proposed_action
`open_infra_pr` — o único id que o engine conhece de volta). Diferente de
`tasks` (que existe ANTES da PR e abre o gate depois via
`OpenGateUseCase`), o artefato de infra só nasce quando a PR já foi
aberta — `gate_status` já chega `'awaiting_qa'`.

`RecordInfraGateVerdictUseCase` reaproveita a MESMA `nextGateStatus`
(domínio puro, já agnóstico de Task) contra `InfraArtifactRepository` em
vez de `TaskRepository` — chaveado por `prActionId`, não `taskId`
(`findByPrActionId`). Comentário na PR via `listByProjectAndType` (não
`findInSessionForUpdate`, que é de uso exclusivo dentro de transação com
lock).

`Engine.Infra.InfraGateRunner` (novo) é DETERMINÍSTICO de ponta a ponta
(sem GenServer próprio, sem LLM) — `run_qa/3` roda `hadolint` sobre cada
Dockerfile do payload da PR (buscado via novo `GetInfraPrFilesUseCase` +
endpoint `GET .../infra-artifacts/:prActionId/files`, já que não há
worktree pra apontar os detectors); `run_secops/3` roda
`gitleaks`+`semgrep` (mesmos detectors do SecOps de dev) contra um
diretório TEMPORÁRIO escrito na hora com os arquivos do payload (removido
no `after` do `try`). Disparado via `Engine.Gates.Dispatcher.run_infra_qa/3`/
`run_infra_secops/3` (mesma indireção testável do Dev↔Gates, mas usando
`Task.start` — fire-and-forget — em vez de um GenServer próprio, já que o
runner não precisa de estado entre chamadas).

### 5. Painel do time ao vivo — broadcast nos pontos de emissão existentes

Sem outbox-relay novo (mudança maior, desnecessária pro critério de
aceite): `Engine.Sessions.LiveBroadcast.event_appended/4` (novo, pequeno)
é chamado ao lado de `EngineApiClient.append_event` em TODOS os
GenServers project-scoped que só escreviam evento sem broadcast
(`DevAgentServer`, `QaAgentServer`, `SecOpsAgentServer`,
`InfraAgentServer`, `InfraGateRunner`) — broadcast no canal
`session:<id>`, evento `event.appended`. Os agentes conversacionais
(Criativo/PO/Arquiteto/Infra) ganham `agent.status` (`working`/`idle`) nos
limites de turno existentes (início/fim de cada `handle_cast`/`handle_call`
que roda `run_turn`).

Web: `session-channel.ts` ganha `onEvent`/`onAgentStatus` — ao receber,
`queryClient.invalidateQueries(['session-events', ...])` (reaproveita o
parsing/cache já existente do polling, só antecipa o refetch).
`ProjectOverviewTab` abre seu PRÓPRIO canal (`connectSessionHeartbeat`),
independente do que `SessionPage` já abre, já que são rotas/abas
diferentes montadas em momentos diferentes.

`lib/agent-status.ts` (novo) — `deriveAgentRoster(events, moduleMap,
executionActivated, handoffs)` monta o roster REAL: criativo/po/arquiteto
sempre; `dev-<modulo>` por módulo do module_map quando a execução foi
ativada (sintetiza um `AgentDef` reaproveitando ícone/cor do "dev-backend"
genérico, já que não há entrada fixa pra id dinâmico); qa/secops quando
algum gate (dev OU infra) já abriu alguma vez; infra quando o handoff foi
aceito. Status: agentes conversacionais via último `agent.status`; dev via
heurística sobre os últimos eventos próprios (`dev.*`/`backlog.task_blocked`);
qa/secops via `gateStatus` do parecer mais recente (`awaiting_qa`/
`awaiting_secops` diz qual dos dois está com a bola — são singletons por
projeto, processam serializado). `ProjectOverviewTab`'s "Time de agentes"
passa a usar isso, com `model`/`autonomy` (`AgentCard`, já aceitava as
props) resolvidos via `getAgentModelBinding`/`listAgentAutonomy` uma vez
por carga de página.

### 6. Feed de atividade e tab Aprovações

`activity.ts` ganha branches `infra.gate_changed`, `infra.pr_opened`/
`infra.pr_failed`, `infra.artifact_blocked` e `architecture.readiness_confirmed`
(mirror dos branches `pr.gate_changed`/`adr.*` já existentes, texto
deixando claro "PR de infra"). `artifact.qa_verdict`/`secops_verdict`
(branch já existente, reusado por dev E infra) checa `prActionId` no
payload pra diferenciar o texto sem duplicar o branch.

Novo endpoint humano `GET projects/:id/infra-artifacts` (`ListInfraArtifactsUseCase`)
+ hook `useInfraArtifacts`. `PrGateTimeline` (componente já existente,
usado pelas PRs de dev) tem seu prop `task: Task` estreitado pra uma
interface estrutural `GateSubject { title, blocked, blockedReason,
gateStatus }` — tanto `Task` quanto `InfraArtifact` satisfazem
estruturalmente, sem acoplar o componente ao domínio de backlog. Nova
seção "PRs de infra em revisão" na tab Aprovações, mesmo componente.

## Consequências

- Testes: `decide.spec.ts` prova o curto-circuito (deny em agent_autonomy
  nunca chega a consultar permissions.json, mesmo com allow amplo);
  integração `ProposeActionUseCase` (InfraAgent propondo `terminal` vira
  `denied`); `RecordInfraGateVerdictUseCase` (mirror completo dos testes
  de gate de task, incluindo artefato já bloqueado rejeitando novo
  parecer). Engine: `ValidateInfraFile` (hadolint ausente não quebra o
  turno), `InfraAgentServer` (fluxo feliz N arquivos, correção, deltas +
  `agent.status`, rehydration), `InfraGateRunner` (lint com achado,
  aprovação dispara o próximo gate, scanner ausente pula sem quebrar).
- `docker build --check` fica fora de escopo — exigiria montar o socket
  do host no container do engine (Alpine, sem docker CLI/daemon hoje),
  risco real não assumido sem pedido explícito. Só hadolint
  (`Engine.Actions.HadolintDetector`, binário opcional, mesmo padrão dos
  demais detectors).
- Painel "ao vivo" via broadcast nos pontos de emissão já existentes — sem
  outbox-relay genérico api→engine→Phoenix novo.
- Fase 4b (Psicólogo/Anamnese) continua fora.

## Escopo & assunções

Uma sessão produz UM ciclo de PR de infra (correções reaproveitam a mesma
branch/PR — nunca uma segunda PR concorrente). Sem correlação profunda
diff↔achado de scanner (mesma simplificação do ADR 0013). Status de
dev/qa/secops no painel é heurístico (best-effort sobre o event log, não
uma fonte de verdade transacional) — suficiente pro painel, não usado por
nenhuma decisão de gate.

# ADR 0015 — Psicólogo real: ToolLoop, hipóteses com evidência e triagem de custo

- Status: aceito
- Data: 2026-07-24
- Fase: 4b (sessão 1 — substitui o PsychologistStub)

## Contexto

O `PsychologistWorker` da Fase 1 era um placeholder explícito: lia o event
log e gravava um `psychologist.hypothesis` de texto fixo
(`Engine.Psychologist.Stub.summarize/1`), sem LLM, sem evidência, sem
idempotência (a própria docstring documentava que uma retentativa do Oban
duplicaria o evento).

Esta sessão o substitui pelo Psicólogo real: consumer de
`session.closed`/`session.closed_abnormally` (qualquer causa) que monta
contexto (event log completo + regras de negócio do projeto + hipóteses
anteriores não descartadas) e produz via harness hipóteses estruturadas —
cada uma OBRIGATORIAMENTE com evidência apontando pra event ids reais.

Critério de aceite: encerrar 3 sessões (normal, kill, erro) gera hipóteses
com evidências navegáveis nos 3 casos, custos distintos entre triagem leve
e pesada visíveis no metering.

## Decisões

### 1. Oban job chamando ToolLoop direto — sem GenServer

Diferente de QA/SecOps/Dev/Infra (GenServers por projeto/sessão, que
recebem casts repetidos ao longo da vida do projeto), o Psicólogo roda
UMA vez por fechamento de sessão e nunca precisa ser endereçado depois. O
Oban já dá processo supervisionado com retentativa (`max_attempts: 5`),
então um GenServer/Supervisor/Registry seria cerimônia sem função.
`PsychologistWorker.perform/1` monta o ctx e chama `ToolLoop.run/1`
sincronamente — mesma forma do `QaAgentServer.run_qa/2`, sem o wrapper.

### 2. "Até M tentativas" é o `max_iterations` do ToolLoop

Não há subsistema de retry novo. O mecanismo que a CLAUDE.md pede
("hipótese sem evidência válida é rejeitada e re-solicitada ao modelo,
até M tentativas") já é o loop normal do harness: uma tool que retorna
`{:error, reason}` tem essa string injetada como o próximo `tool`-result,
e o modelo corrige no turno seguinte. `M` é literalmente
`Triage.max_iterations(tier)` no ctx (4 no tier leve, 8 no pesado).

`Engine.Psychologist.Tools.EmitHypotheses` é a tool obrigatória (mesma
forma de `EmitArtifact`/`EmitQaVerdict`); `Engine.Psychologist.Hooks.
Termination` é o `:post_tool_use` que dá halt SÓ quando a validação
passou. Dois estágios de propósito: a tool valida, o hook termina.

### 3. Validação de evidência mora no domínio da api, atômica por lote

`ProposeHypothesesUseCase` resolve cada `evidenceEventId` via
`SessionEventRepository.findById` e exige que o evento exista E pertença
à sessão analisada (mesmo padrão de `CreateStoryUseCase` pra
`business_rule_id`); `domain/psychologist/hypothesis-evidence.ts`
(`validateHypothesisBatch`, puro) aplica as regras restantes (evidência
não-vazia, confiança 0–100 inteira, `terminationAnalysis` obrigatória em
ao menos uma hipótese quando a sessão caiu anormalmente).

O LOTE INTEIRO é rejeitado se qualquer hipótese falhar — parcial-aceite
faria o modelo acreditar que parte foi registrada quando o tool-result é
agregado, quebrando a clareza do ciclo de correção.

### 4. Ciclo de vida exige tabela mutável (eventos são imutáveis)

`session_events` é append-only (CLAUDE.md), então o estado que muda
(`proposed → accepted | dismissed`) mora numa tabela dedicada
`psychologist_hypotheses` — mesmo padrão de `tasks.gate_status`/
`infra_artifacts.gate_status`. Cada transição TAMBÉM emite seu evento
imutável (`psychologist.hypothesis_proposed`/`_accepted`/`_dismissed`,
`psychologist.analysis_completed`/`_failed`) pra trilha de auditoria.

`domain/psychologist/hypothesis-lifecycle.ts` (`assertHypothesisTransition`,
puro) só permite sair de `proposed` — evita corrida de double-accept.

### 5. Idempotência: índice parcial único + "run falho não grava linha"

`psychologist_analyses` tem
`uniqueIndex('psychologist_analyses_current_idx').on(sessionId).where(superseded = false)`
— no máximo UMA análise current por sessão, sempre. Isso É a "chave única
session_id + já processado".

Duas camadas: o worker pré-checa `alreadyAnalyzed` (curto-circuito barato,
não gasta LLM numa retentativa do Oban) e o índice é a rede de segurança
contra corrida real.

**Uma linha só nasce quando a análise CONCLUI.** Um run que estoura
limite/orçamento sem emitir hipóteses válidas não grava nada — de
propósito: isso distingue "duplicar uma análise concluída" (bloqueado) de
"retentar uma que falhou" (permitido, e é exatamente o cenário
kill-do-engine/análise-pós-restart do critério de aceite). O desfecho
falho ainda narra `psychologist.analysis_failed` — nunca fica sem
desfecho, mesma disciplina do DevAgent/QA.

**Reprocessamento explícito** (`triggeredBy: "manual"`, via `POST
projects/:id/sessions/:id/psychologist/reanalyze` → engine enfileira o
job) sempre roda: marca a análise anterior `superseded = true` (NUNCA
apaga) e insere a nova. Histórico preservado de graça — as hipóteses
antigas continuam lá, só não são mais "current".

### 6. Causa de término é classificação determinística, não julgamento do LLM

`Engine.Psychologist.TerminationClassifier.classify/2` é pattern-match
puro sobre `sessions.termination_reason` — reconhecer "heartbeat_timeout"
vs um sinal de kill vs uma mensagem de exceção é casamento de padrão, não
semântica (mesma racional do ADR 0013 pro SecOps determinístico). A causa
entra no prompt como FATO; o modelo analisa as CONSEQUÊNCIAS dela.

Isso exigiu fechar um gap: `ReportSessionTerminationUseCase` recebia
`reason` do engine mas só logava. Agora threada até uma coluna nova
`sessions.termination_reason` (nullable — fecho humano/gracioso fica
null).

### 7. Triagem: bindings de agente genuinamente diferentes

`Engine.Psychologist.Triage.decide/1` — menos de **20** eventos → `:leve`,
senão `:pesada`. Racional do limiar: abaixo disso a sessão tipicamente é
alguém abrindo e trocando duas mensagens, sem sinal comportamental
suficiente pra justificar um modelo forte.

O tier escolhe o **slug do agente** no ctx (`"psicologo-leve"` vs
`"psicologo"`), não um override de modelo em código — assim a cascata de
binding que já existe (`session > agent > project > workspace`) resolve
sozinha, o operador continua controlando os dois tiers pela tabela de
bindings do `ProjectSettingsTab` sem tela nova, e o custo diverge de
verdade no `token_usage` que `RunLlmTurnUseCase` já grava
incondicionalmente. O seed liga `psicologo → Opus 4.8` e
`psicologo-leve → Haiku 4.5`.

O tier também define `max_iterations` e `token_budget_micros` (50k vs
300k micro-USD), enforced pelo mecanismo que já existe no ToolLoop
(`{:budget_exceeded, ctx}`) — zero código de enforcement novo.

## Consequências

- UI: nova seção **Insights** no `ProjectOverviewTab`, escopo de PROJETO
  (não da sessão aberta — o critério de aceite fecha 3 sessões
  diferentes), hipóteses agrupadas por agente alvo, `HypothesisCard` com
  confiança, análise de término e chips de evidência clicáveis. Cada chip
  navega pra `/projects/:id/sessions/:sessionId?highlightEvent=:eventId`
  — `SessionPage` ganhou um painel "Log de eventos" colapsável
  (reaproveitando `ActivityFeed`/`EventItem`, que já classificam todo
  tipo de evento) que abre sozinho e rola até o evento destacado.
  `activity.ts` ganhou branches `psychologist.*` reais — o branch antigo
  `startsWith('hypothesis')` era código morto (nunca batia em
  `psychologist.hypothesis`).
- Testes: domínio (`hypothesis-lifecycle`, `hypothesis-evidence` — id
  inexistente, id de outra sessão, `terminationAnalysis` faltando),
  `ProposeHypothesesUseCase` (feliz, rejeição atômica, supersede),
  `GetPsychologistContextUseCase`, `ReportSessionTerminationUseCase`
  (motivo persistido); engine: `Triage` (fronteira do limiar),
  `TerminationClassifier` (5 causas), `EmitHypotheses` (mensagem da api
  preservada verbatim pro modelo corrigir), `PsychologistWorker`
  (idempotência não chama LLM, triagem escolhe o agent certo, término
  anormal exige `terminationAnalysis`, kill→restart conclui).
- O evento pra Anamnese (`psychologist.hypothesis_accepted_for_anamnese`)
  é emitido como um TIPO distinto (não uma flag no payload) — filtrável
  por um consumidor futuro sem inspecionar payload, mesmo espírito de
  `session.closed` vs `session.closed_abnormally` serem tipos separados.
  Sem outbox: não há consumidor ainda, e rotear pelo outbox exigiria
  nomear um worker inexistente em `handlers_for/1`.

## Escopo & assunções

Fora desta sessão: a **Anamnese** em si (jobs periódicos,
`proficiency_profile`, `instruction_patch` como proposed_action,
versionamento/rollback de arquivo de agente — Fase 4.6); qualquer lógica
de priorização/consumo do evento encaminhado a ela; dashboard de custo
além do número por análise; `Oban unique:` no nível do job (a constraint
de banco + pré-check já bastam — fica como follow-up se flakiness
aparecer na prática); reanálise em lote.

O status de "já analisada" é por SESSÃO, não por projeto — cada sessão
encerrada rende no máximo uma análise current, e reanalisar uma não
afeta as outras.

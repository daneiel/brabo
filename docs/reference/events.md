---
id: events
title: Eventos
sidebar_label: Eventos
sidebar_position: 2
description: Os tipos de evento do log imutável, os broadcasts de canal e os spans de trace — três coisas diferentes com nomes parecidos.
keywords: [eventos, event log, session_events, broadcast, span, outbox]
---

# Eventos

Três famílias de nome convivem no Brabo e são fáceis de confundir porque todas
usam `assunto.verbo`:

| família | onde vive | durabilidade |
|---|---|---|
| **Evento de domínio** | linha em `session_events` | **permanente e imutável** |
| **Broadcast** | canal Phoenix → browser | efêmero, não é persistido |
| **Span** | trace OpenTelemetry | retenção do Tempo (24 h no local) |

Só a primeira é contrato. As outras duas são transporte e observação.

## Evento de domínio

Uma linha em `session_events`, append-only, com `seq` densa por sessão
([RN-002](../business-rules.md#rn-002)). Colunas:

| coluna | o quê |
|---|---|
| `id` | uuid |
| `session_id` | a sessão dona |
| `seq` | ordem dentro da sessão, começando em 1, sem buraco |
| `type` | o identificador abaixo |
| `actor` | quem causou: `{kind, id}` — usuário, agente ou sistema |
| `payload` | jsonb, formato específico por tipo |
| `created_at` | — |

> **O `type` é `string` livre no código** — não existe union TypeScript nem
> enum no banco listando os tipos válidos. A lista abaixo foi extraída dos
> pontos de emissão, e é por isso que ela pode envelhecer sem quebrar nada. Ver
> a nota no fim desta página.

### Sessão

| tipo | quando |
|---|---|
| `session.created` | sessão nasce em `created` |
| `session.activated` | passou para `active` |
| `session.draining` | o nó que hospedava está drenando |
| `session.closed` | encerramento normal |
| `session.closed_abnormally` | encerramento com causa — `node_shutdown` é a mais comum |

### Chat e agentes

| tipo | quando |
|---|---|
| `chat.message` | mensagem no fio da sessão, do usuário ou do agente |
| `agent.activated` | um agente assumiu trabalho na sessão |
| `agent.response` | resposta completa do agente, já consolidada |
| `tool.result` | resultado de uma execução de ferramenta, gravado pelo hook `Engine.Harness.Hooks.EventLog` |
| `handoff.offered` | um agente ofereceu o trabalho a outro |
| `handoff.accepted` | o destinatário aceitou |

### Ações propostas

| tipo | quando |
|---|---|
| `proposed_action.created` | nasceu a ação — antes de qualquer execução |
| `proposed_action.approved` | decidida pelo usuário |
| `proposed_action.denied` | negada — estado terminal |
| `proposed_action.executed` | executou com sucesso |
| `action.failed` | executou e falhou |
| `permission.granted` | concessão registrada na política |

### Backlog

| tipo | quando |
|---|---|
| `backlog.epic_created` | — |
| `backlog.story_created` | — |
| `backlog.story_transitioned` | mudança de estado da história |
| `backlog.story_demoted` | módulo sumiu do `module_map`; a história voltou para `draft` ([RN-012](../business-rules.md#rn-012)) |
| `backlog.story_modules_assigned` | vínculo história ↔ módulo |
| `backlog.task_created` | — |
| `backlog.task_claimed` | um dev agent pegou a task |
| `backlog.task_status_changed` | — |
| `backlog.task_blocked` | teto de correções esgotado, ou impedimento registrado |
| `backlog.task_unblocked` | — |

### Execução e gates

| tipo | quando |
|---|---|
| `execution.activated` | a fase de execução começou |
| `execution.parallelization_suggested` | o sistema propôs paralelizar |
| `execution.parallelization_accepted` | aceita — o subagente herda o teto do agente base |
| `pr.gate_changed` | o PR mudou de gate (`awaiting_qa` → `awaiting_secops` → `awaiting_user`) |
| `infra.gate_changed` | gate do Infra |
| `infra.artifact_blocked` | artefato do Infra reprovado |

### Artefatos

| tipo | schema |
|---|---|
| `artifact.product_brief` | `title`, `summary`, `rules` |
| `artifact.business_rule` | `title`, `description`, `origin` |
| `artifact.module_map` | o mapa de módulos do Arquiteto |
| `artifact.insight` | — |

Os schemas são fechados: campo faltando reprova a emissão
(`Engine.Harness.ArtifactSchemas`).

### Arquitetura e prontidão

| tipo | quando |
|---|---|
| `architecture.readiness_confirmed` | — |
| `readiness.confirmed` | — |

### Git e bootstrap

| tipo | quando |
|---|---|
| `project.git_connected` | credencial de git vinculada ao projeto |
| `project.repository_provisioned` | repositório criado/adotado |
| `bootstrap.step_started` | um dos seis passos do Gitflow começou |
| `bootstrap.step_completed` | concluído |
| `bootstrap.step_skipped` | já estava feito — **é sucesso**, não erro ([RN-029](../business-rules.md#rn-029)) |
| `bootstrap.step_degraded` | concluiu sem uma capability do provider (ex.: proteção de branch no Local) |
| `bootstrap.step_failed` | falhou; o bootstrap é retomável deste ponto |

### Custo

| tipo | quando |
|---|---|
| `budget.threshold_crossed` | 70%, 90% ou 100% — **uma vez por limiar** ([RN-018](../business-rules.md#rn-018)) |

### Psicólogo

| tipo | quando |
|---|---|
| `psychologist.analysis_completed` | — |
| `psychologist.analysis_failed` | com causa classificada: `infra`, `modelo`, `código` ou `política` |
| `psychologist.hypothesis_proposed` | hipótese com `evidenceEventIds` válidos ([RN-021](../business-rules.md#rn-021)) |
| `psychologist.hypothesis_accepted` | — |
| `psychologist.hypothesis_dismissed` | — |
| `psychologist.hypothesis_accepted_for_anamnese` | aceita e encaminhada — é o elo que fecha o loop com a Anamnese |

### Anamnese e instruções

| tipo | quando |
|---|---|
| `anamnese.run_completed` | — |
| `anamnese.run_failed` | — |
| `anamnese.profile_updated` | o `proficiency_profile` mudou |
| `instruction.rolled_back` | reversão de versão de instrução — cria versão nova, não apaga ([RN-027](../business-rules.md#rn-027)) |

---

## Broadcast

Mensagens de canal Phoenix para o browser. **Não** são persistidas: quem
recarrega a página não as recupera — recupera o event log.

| broadcast | o quê |
|---|---|
| `agent.delta` | pedaço de texto do streaming do modelo |
| `agent.status` | mudança de estado visível do agente |
| `agent.done` | turno terminou |
| `agent.error` | turno falhou |
| `event.appended` | um evento novo entrou no log — é o gatilho de atualização do painel |

Um evento de domínio quase sempre gera um `event.appended`; o inverso não vale.

## Span

Nomes de span OpenTelemetry. Uma sessão é uma **trace raiz** atravessando api e
engine ([ADR 0026](../adr/0026-fase5-observabilidade-e-graceful-shutdown.md)).

| span | onde |
|---|---|
| `session.create` | api — a raiz |
| `agent.turn` | engine — uma volta do ToolLoop |
| `llm.turn` | engine — a chamada ao modelo |
| `tool.call` | engine — a execução de uma ferramenta |
| `gate.scanner` | engine — um scanner do SecOps, com o nome do scanner no atributo |

Como navegar de uma sessão até um `tool.call` está no
[runbook](../runbook.md#observabilidade).

---

## Como o evento chega ao engine

Não por fila externa. A api grava o evento e a intenção de publicá-lo **na
mesma transação** (transactional outbox); o Oban consome do próprio Postgres. É
o que impede "gravou o evento mas o engine não soube".

```mermaid
sequenceDiagram
  participant A as api
  participant P as postgres
  participant E as engine

  A->>P: BEGIN
  A->>P: insert session_events
  A->>P: insert outbox
  A->>P: COMMIT
  E->>P: Oban consome a outbox
  E->>E: processa
```

---

## Inventário completo

As seções acima dizem **quando** cada evento acontece. Esta é a varredura
mecânica dos pontos de emissão, refeita a cada `pnpm docs:generate` — é o que
faz um identificador novo aparecer aqui mesmo que ninguém tenha escrito a
respeito.

<!-- BEGIN:GENERATED:eventos-inventario -->

> ⚠️ Bloco gerado por `pnpm docs:generate`. Não edite à mão — o próximo build sobrescreve.

Extraído dos pontos de emissão: **66 identificadores**, todos descritos acima.

- `action.failed` <sub>(apps/api/src/application/use-cases/actions/execute-git-action.use-case.ts)</sub>
- `agent.activated` <sub>(apps/api/src/application/use-cases/agents/activate-agent.use-case.ts)</sub>
- `agent.delta` <sub>(apps/engine/lib/engine/agents/arquiteto_server.ex)</sub>
- `agent.done` <sub>(apps/engine/lib/engine/agents/arquiteto_server.ex)</sub>
- `agent.error` <sub>(apps/engine/lib/engine/agents/arquiteto_server.ex)</sub>
- `agent.response` <sub>(apps/api/src/application/use-cases/llm/send-chat-message.use-case.ts)</sub>
- `agent.status` <sub>(apps/engine/lib/engine/agents/arquiteto_server.ex)</sub>
- `agent.turn` <sub>(apps/engine/lib/engine/harness/tool_loop.ex)</sub>
- `anamnese.profile_updated` <sub>(apps/api/src/application/use-cases/anamnese/record-proficiency.use-case.ts)</sub>
- `anamnese.run_completed` <sub>(apps/api/src/application/use-cases/anamnese/record-proficiency.use-case.ts)</sub>
- `anamnese.run_failed` <sub>(apps/engine/lib/engine/workers/anamnese_worker.ex)</sub>
- `architecture.readiness_confirmed` <sub>(apps/api/src/application/use-cases/agents/offer-infra-handoff.use-case.ts)</sub>
- `artifact.business_rule` <sub>(apps/engine/lib/engine/agents/arquiteto_server.ex)</sub>
- `artifact.insight` <sub>(apps/engine/lib/engine/harness/tools/emit_insight.ex)</sub>
- `artifact.module_map` <sub>(apps/api/src/application/use-cases/architecture/create-module-map.use-case.ts)</sub>
- `artifact.product_brief` <sub>(apps/engine/lib/engine/agents/arquiteto_server.ex)</sub>
- `backlog.epic_created` <sub>(apps/api/src/application/use-cases/backlog/create-epic.use-case.ts)</sub>
- `backlog.story_created` <sub>(apps/api/src/application/use-cases/backlog/create-story.use-case.ts)</sub>
- `backlog.story_demoted` <sub>(apps/api/src/application/use-cases/architecture/create-module-map.use-case.ts)</sub>
- `backlog.story_modules_assigned` <sub>(apps/api/src/application/use-cases/architecture/assign-story-modules.use-case.ts)</sub>
- `backlog.story_transitioned` <sub>(apps/api/src/application/use-cases/backlog/transition-story.use-case.ts)</sub>
- `backlog.task_blocked` <sub>(apps/api/src/application/use-cases/execution/mark-task-blocked.use-case.ts)</sub>
- `backlog.task_claimed` <sub>(apps/api/src/application/use-cases/execution/claim-next-task.use-case.ts)</sub>
- `backlog.task_created` <sub>(apps/api/src/application/use-cases/backlog/create-task.use-case.ts)</sub>
- `backlog.task_status_changed` <sub>(apps/api/src/application/use-cases/execution/mark-task.use-case.ts)</sub>
- `backlog.task_unblocked` <sub>(apps/api/src/application/use-cases/execution/unblock-task.use-case.ts)</sub>
- `bootstrap.step_completed` <sub>(apps/api/src/application/use-cases/git/provision-repository.use-case.ts)</sub>
- `bootstrap.step_degraded` <sub>(apps/api/src/application/use-cases/git/provision-repository.use-case.ts)</sub>
- `bootstrap.step_failed` <sub>(apps/api/src/application/use-cases/git/provision-repository.use-case.ts)</sub>
- `bootstrap.step_skipped` <sub>(apps/api/src/application/use-cases/git/provision-repository.use-case.ts)</sub>
- `bootstrap.step_started` <sub>(apps/api/src/application/use-cases/git/provision-repository.use-case.ts)</sub>
- `budget.threshold_crossed` <sub>(apps/api/src/application/use-cases/llm/record-llm-usage.use-case.ts)</sub>
- `chat.message` <sub>(apps/api/src/application/use-cases/agents/send-agent-message.use-case.ts)</sub>
- `event.appended` <sub>(apps/engine/lib/engine/sessions/live_broadcast.ex)</sub>
- `execution.activated` <sub>(apps/api/src/application/use-cases/execution/activate-execution.use-case.ts)</sub>
- `execution.parallelization_accepted` <sub>(apps/api/src/application/use-cases/execution/accept-parallelization.use-case.ts)</sub>
- `execution.parallelization_suggested` <sub>(apps/api/src/application/use-cases/execution/activate-execution.use-case.ts)</sub>
- `gate.scanner` <sub>(apps/engine/lib/engine/gates/scanner.ex)</sub>
- `handoff.accepted` <sub>(apps/api/src/application/use-cases/agents/accept-handoff.use-case.ts)</sub>
- `handoff.offered` <sub>(apps/api/src/application/use-cases/agents/create-handoff.use-case.ts)</sub>
- `infra.artifact_blocked` <sub>(apps/api/src/application/use-cases/execution/mark-infra-artifact-blocked.use-case.ts)</sub>
- `infra.gate_changed` <sub>(apps/api/src/application/use-cases/execution/record-infra-gate-verdict.use-case.ts)</sub>
- `instruction.rolled_back` <sub>(apps/api/src/application/use-cases/instructions/rollback-instruction.use-case.ts)</sub>
- `llm.turn` <sub>(apps/engine/lib/engine/sessions/engine_api_client.ex)</sub>
- `permission.granted` <sub>(apps/api/src/application/use-cases/actions/approve-always-action.use-case.ts)</sub>
- `pr.gate_changed` <sub>(apps/api/src/application/use-cases/execution/open-gate.use-case.ts)</sub>
- `project.git_connected` <sub>(apps/api/src/application/use-cases/git/handle-git-oauth-callback.use-case.ts)</sub>
- `project.repository_provisioned` <sub>(apps/api/src/application/use-cases/git/provision-repository.use-case.ts)</sub>
- `proposed_action.approved` <sub>(apps/api/src/application/use-cases/actions/approve-action.use-case.ts)</sub>
- `proposed_action.created` <sub>(apps/api/src/application/use-cases/actions/propose-action.use-case.ts)</sub>
- `proposed_action.denied` <sub>(apps/api/src/application/use-cases/actions/deny-action.use-case.ts)</sub>
- `proposed_action.executed` <sub>(apps/api/src/application/use-cases/actions/execute-git-action.use-case.ts)</sub>
- `psychologist.analysis_completed` <sub>(apps/api/src/application/use-cases/execution/propose-hypotheses.use-case.ts)</sub>
- `psychologist.analysis_failed` <sub>(apps/engine/lib/engine/workers/psychologist_worker.ex)</sub>
- `psychologist.hypothesis_accepted` <sub>(apps/api/src/application/use-cases/execution/accept-hypothesis.use-case.ts)</sub>
- `psychologist.hypothesis_accepted_for_anamnese` <sub>(apps/api/src/application/use-cases/execution/accept-hypothesis.use-case.ts)</sub>
- `psychologist.hypothesis_dismissed` <sub>(apps/api/src/application/use-cases/execution/dismiss-hypothesis.use-case.ts)</sub>
- `psychologist.hypothesis_proposed` <sub>(apps/api/src/application/use-cases/execution/propose-hypotheses.use-case.ts)</sub>
- `readiness.confirmed` <sub>(apps/api/src/application/use-cases/agents/confirm-readiness.use-case.ts)</sub>
- `session.activated` <sub>(apps/api/src/db/seed.ts)</sub>
- `session.closed` <sub>(apps/engine/lib/engine/outbox/drain.ex)</sub>
- `session.closed_abnormally` <sub>(apps/engine/lib/engine/outbox/drain.ex)</sub>
- `session.created` <sub>(apps/api/src/application/use-cases/sessions/create-session.use-case.ts)</sub>
- `session.draining` <sub>(apps/engine/lib/engine/shutdown.ex)</sub>
- `tool.call` <sub>(apps/engine/lib/engine/agents/arquiteto_server.ex)</sub>
- `tool.result` <sub>(apps/engine/lib/engine/harness/hooks/event_log.ex)</sub>
<!-- END:GENERATED:eventos-inventario -->

---

> **TODO(humano):** `type` é `string` livre em
> `application/ports/session-event-repository.port.ts` — nada impede um typo de
> criar um tipo novo em silêncio, e nada garante que esta página cubra todos.
> Um union TypeScript exportado do `packages/shared` resolveria os dois
> problemas e permitiria **gerar** esta lista em vez de mantê-la. Enquanto isso
> não existe, a lista acima é uma extração datada dos pontos de emissão.

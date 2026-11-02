# ADR 0013 — Gates de PR: QAAgent e SecOpsAgent

- Status: aceito
- Data: 2026-07-24
- Fase: 4a (sessão 3 — gates de QA e SecOps)

## Contexto

O DevAgent real (sessão anterior) implementa a task e abre PR, mas a PR não
passa por nenhuma revisão automatizada — vai direto pra `in_review`. Esta
sessão adiciona os dois gates que faltavam: **QA** (roda a suite, monta a
matriz regra→teste, aponta regras sem cobertura) e **SecOps** (roda
semgrep/gitleaks, cruza com ADRs de segurança) — cada um com parecer
registrado como artefato + comentário na PR, devolução pro dev na MESMA
branch quando reprova, e um limite de correções antes de virar `blocked`.

Critério de aceite: task com (a) uma regra sem teste e (b) um segredo
hardcoded → QA devolve a primeira, dev corrige, SecOps barra o segundo, dev
corrige, PR chega a `awaiting_user` com os 4 pareceres na linha do tempo.

## Decisões

### 1. Máquina de estados do gate como teto puro

`domain/execution/pr-gate-state-machine.ts` (mesmo padrão de
`action-state-machine.ts`/`story-state-machine.ts`): `PrGateStatus =
'awaiting_qa' | 'awaiting_secops' | 'awaiting_user'`. `nextGateStatus`
recebe o gate ATUAL + o veredito e devolve o próximo status (ou `'blocked'`
se o teto de correções estourou) — cada gate só pode agir sobre o SEU
status (`InvalidGateActionError` se QA tenta decidir sobre `awaiting_secops`
ou vice-versa), garantindo a ORDEM imutável (aprovar QA nunca pula direto
pra `awaiting_user`). `tasks` ganha `gate_status`/`gate_correction_count`
(migração `0015`) — sem tabela nova pra pareceres: eles são
`session_events` `artifact.qa_verdict`/`artifact.secops_verdict`, mesmo
padrão de `EmitArtifact`.

`RecordGateVerdictUseCase` é o ÚNICO lugar que aplica a máquina, posta
comentário na PR (`GitProvider.commentOnPullRequest`, 10ª operação do
contrato — best-effort, nunca trava a decisão do gate) e devolve pro engine
a próxima ação (`correct`/`run_secops`/`done`/`blocked`) — mesmo princípio
de sempre: api decide, engine executa.

### 2. Handoff conversacional NÃO reaproveitado

`domain/sessions/handoff.entity.ts` é modelado pra ativação de agente
CONVERSACIONAL (`offered/accepted`), sem noção de branch/worktree/task —
forçar esse encaixe teria sido pior do que criar um caminho novo. A
devolução "QA/SecOps reprovou → volta pro dev na MESMA branch" é uma
chamada direta engine→engine: `DevAgentServer.correct/3` (distinto de
`work/2`, que reivindica task NOVA) reaproveita `state.worktree`/
`state.branch`/`state.task_id` já guardados — NUNCA chama
`worktree_manager().create/3` de novo. No `report_done` da correção, só
`propose_commit`/`propose_push` (a PR já existe, mesma branch) — nunca
`propose_pr` de novo.

### 3. QA usa ToolLoop/LLM; SecOps é determinístico — assimetria intencional

Cruzar a descrição de uma regra de negócio com o nome/conteúdo de um teste
é julgamento SEMÂNTICO — o `QaAgentServer` usa o `ToolLoop` real (mesmo
harness do DevAgent), com `Engine.Gates.Tools.EmitQaVerdict` ENFORÇADO
exatamente como `ReportDone`: só aceita `veredito: "approved"` se o último
`terminal` no histórico saiu com `exit 0`.

Achar um segredo hardcoded ou uma vulnerabilidade é checagem ESTRUTURADA
sobre saída de scanner — um SecOps DETERMINÍSTICO (sem LLM) é mais
confiável do que um modelo resumindo achado de segurança (risco de
alucinação/omissão numa checagem que deveria ser binária). O
`SecOpsAgentServer` roda `gitleaks`+`semgrep` (`Engine.Actions.
GitleaksDetector`/`SemgrepDetector`, mesmo padrão de detecção opcional do
`RtkDetector` — `System.find_executable/1`, nunca assume instalado) e lista
os ADRs `securityRelevant` (campo novo, opcional, no payload de
`open_adr_pr` — checklist informativo, sem correlação profunda linha-a-
linha). Achado zero → `approved`; qualquer achado → `changes_requested`.

**Ambos scanners foram testados no Dockerfile real do engine (Alpine) e
instalam/rodam sem problema** (`gitleaks` via binário estático do release
do GitHub; `semgrep` via pip) — a preocupação inicial de instabilidade em
musl/Alpine não se confirmou nesta sessão. A detecção opcional continua
como defesa em profundidade (ambiente sem os binários não quebra o gate).

### 4. QA/SecOps compartilham o worktree do dev

Nenhum dos dois cria worktree próprio — acham o do dev via
`DevAgentState.find_by_task_id/2` (nova consulta) — já que só leem/rodam
comando, nunca escrevem código. `Engine.Gates.Diff.compute/2` calcula
`git diff <default_branch>...HEAD` (não existia cálculo de diff nenhum no
engine antes disso) — usado pro resumo do parecer (contagem de arquivos
mudados), não como filtro linha-a-linha dos achados de scanner
(simplificação documentada: correlacionar path de scanner ↔ diff de forma
confiável é frágil o bastante pra não valer o esforço nesta sessão).

### 5. Indireção de disparo (Dispatcher) — testabilidade

`Engine.Gates.Dispatcher` (`.run_qa/2`, `.run_secops/2`) é o único ponto
onde o `DevAgentServer`/`QaAgentServer` disparam o PRÓXIMO gate — trocável
em teste (`Engine.Gates.FakeGateDispatcher`) pelo mesmo motivo de
`worktree_manager()`: sem essa indireção, os testes do `DevAgentServer`
subiriam um `QaAgentServer` REAL fora do sandbox Ecto do processo de teste
(descoberto rodando a suite — o GenServer crashava tentando `DevAgentState.
find_by_task_id` sem dono da conexão). A devolução gate→dev
(`DevAgentServer.correct/3`) NÃO passa pela indireção — é um `GenServer.
cast` via `:via`/`Registry`, que já é fire-and-forget por natureza do OTP
(silencioso se o processo não existir, nunca derruba o chamador).

## Consequências

- UI: `ProjectApprovalsTab` ganha a seção "PRs em revisão" — stepper
  horizontal dev→qa→secops→você (`PrGateTimeline`, novo componente) por
  task com gate aberto, pareceres expansíveis, e a `coverageMatrix` do QA
  renderizada com `ui/Table`. `activity.ts` narra `pr.gate_changed`/
  `artifact.qa_verdict`/`artifact.secops_verdict`.
- Testes: máquina de estados (ordem imutável, teto de correções),
  `RecordGateVerdictUseCase` (comentário best-effort, K excedido bloqueia),
  `DevAgentServer.correct/3` (mesma branch/worktree, sem PR nova),
  `QaAgentServer` (enforcement do `emit_qa_verdict`), `SecOpsAgentServer`
  (segredo plantado → changes_requested; scanner ausente → pula sem
  quebrar).

## Escopo & assunções

QA/SecOps só pra PRs do DevAgent — Infra e o painel de time completo via
canais Phoenix continuam fora. `securityRelevant` em ADRs é só um flag
informativo (Arquiteto da Fase 3b não muda além de aceitar o campo
opcional). Sem correlação profunda diff↔achado de scanner. `in_review →
done` (aprovação final do usuário) continua fora desta sessão — o gate
termina em `awaiting_user`, e a ação humana de merge já é sempre manual.

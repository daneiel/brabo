---
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
id: rn-engine
title: 'Regras de negócio — Engine'
sidebar_label: Engine
description: 'As RNs hospedadas na raiz engine.'
keywords: [regras de negócio, engine]
---

# Engine

## PR Gates

### RN-016 — The gate's verdict prevails over the task's statement {#rn-016}

If the task description says one thing and the gate's verdict says
another, the verdict wins.

Since Phase 8b, "the verdict" can come from two specializations — the rule
doesn't change: each one prevails over the task WITHIN what it evaluates
(Automation over test coverage; Performance/Security over performance NFRs
and code findings). `QaLead.consolidar/1` doesn't arbitrate between them
and the task: any `changes_requested` from any of them already fails the
whole thing (see [RN-036](#rn-036)).

- **Where:** prompt for each specialization in
  `apps/engine/lib/engine/gates/qa_automacao_agent.ex` and
  `qa_performance_seguranca_agent.ex`
- **Origin:** [ADR 0020](../adr/0020-destravar-gates-qa-secops.md) §9

## Psicólogo and Anamnese

### RN-023 — The termination cause is a deterministic classification {#rn-023}

It comes from the recorded **reason**, never from the LLM's judgment and never by
elimination. Every failure records its origin: `infra | modelo | código | política`.

- **Where:** `apps/engine/lib/engine/psychologist/termination_classifier.ex`
- **Origin:** [ADR 0022](../adr/0022-fechamento-4b-psicologo.md) §5 and
  [ADR 0020](../adr/0020-destravar-gates-qa-secops.md) §6

## PR Gates

### RN-036 — QA becomes an area: the Lead consolidates without changing the gate's contract {#rn-036}

The Automation specialization (Phase 4a's `QAAgent`) always delegates;
Performance/Security only when the story has a pertinent performance NFR
(`Engine.Gates.QaLead.rnf_de_performance?/1` — a keyword heuristic, not
NLP). The decision NOT to delegate is always recorded — a `dispensed`
delegation with a justification, never silence.

Consolidation: `approved` only if ALL delegations that ran approved; any
`changes_requested` fails the whole thing, with `itens` (items) from the
specialization(s) that requested changes, each item prefixed with the
label of whoever raised it (`"[QA de Automação] ..."`) — that's how the
origin is traced WITHOUT changing `itens` from `string[]` to another
shape. Delegation failure (any origin — `infra`, `modelo`, `codigo`,
`politica`) NEVER becomes `changes_requested`: the Lead blocks the task
with the real origin (RN-015).

The `qa_verdict` that reaches the api is the SAME artifact and goes
through the SAME route as always (`RecordGateVerdictUseCase`,
`nextGateStatus`) — neither of the two changed. What the api learns about
the area lives only in the `delegation.completed`/`delegation.failed`/
`delegation.dispensed` events, which the specialization and the Lead
record separately.

- **Where:** `apps/engine/lib/engine/gates/qa_lead.ex` (`consolidar/1`,
  `rnf_de_performance?/1`), `qa_lead_server.ex` (the wiring);
  `apps/api/src/application/use-cases/execution/record-delegation.use-case.ts`;
  `apps/api/src/db/schema/agents.ts` (table `delegations`, enum `failure_origin`)
- **Test:** `apps/engine/test/engine/gates/qa_lead_test.exs` (the pure
  decision tree), `qa_lead_server_test.exs` (the wiring: decision →
  delegation → recording → consolidation → the SAME call as always), and —
  the proof that the contract didn't change —
  `record-gate-verdict.use-case.spec.ts`, `pr-gate-state-machine.spec.ts`
  and `record-infra-gate-verdict.use-case.spec.ts` pass **with no change
  at all**
- **Origin:** [ADR 0038](../adr/0038-hierarquia-de-agentes.md)

On the `apps/web` side (Phase 8d): the team panel groups `qa`/
`qa-automacao`/`qa-performance-seguranca` as lead + collapsible
specializations, the PR timeline expands the consolidated verdict into
its internals (`ProjectApprovalsTab.tsx`, `PrGateTimeline.tsx`), and the
feed narrates `delegation.*` — see `apps/web/src/lib/agents.ts`
(`AREAS`/`areaFor`).

---

### RN-047 — Dev agent circuit breaker: N consecutive blocked stops it, without burning budget in a loop {#rn-047}

Each dev agent keeps a counter (`dev_agent_states.consecutive_blocked`)
of how many tasks ENDED `blocked` in a row — locally (in the ToolLoop) or
remotely (the gate's correction ceiling exhausted). On hitting the
per-project ceiling (`max_consecutive_blocked`, default 3), the agent
stops at `idle_tripped` **without trying to claim the next task**. An
approved terminal outcome resets the counter; an individual blocked task
continues the normal flow (returned with a diagnosis, available for a
human to unblock) — the breaker is about the SEQUENCE, not the task.

The only way out of `idle_tripped` is an explicit rearm
(`POST .../agents/:agentId/rearm`, role `developer`): it resets the
counter and the agent starts trying to claim again. There's no automatic
unlock — the same principle as `MarkTaskBlockedUseCase`/`unblock`,
applied to the sequence instead of the task. Rearming an agent that is
**not** tripped is **409**, not silent success: the `dev.rearmed` event
is immutable, and recording it for a rearm that didn't happen would be a
lie in the event log.

A block that comes from OUTSIDE the agent (`QaLeadServer` failing
internally, for example) also needs to wake it — that's why the
`task.gate_resolved` emission lives in `MarkTaskBlockedUseCase`, the
funnel every block passes through, and not in
`RecordGateVerdictUseCase`, which only sees part of them. Without this
the agent would stay in `awaiting_gate` forever, with the task dead and
the breaker's counter never incrementing.

Restarting the engine with an agent in `working` does **not** count
toward the counter: the retained task is blocked with a restart
diagnosis, but that block isn't the agent "burning the ceiling" — it's
the infrastructure going down. The counter only rises when the dev↔gate
cycle itself produces a real `blocked`.

- **Where:** `apps/engine/lib/engine/dev/dev_agent_server.ex` (`finish_task/2`,
  `resume_state/2`), `apps/api/src/application/use-cases/execution/rearm-dev-agent.use-case.ts`,
  `apps/api/src/db/schema/iam.ts` (`projects.max_consecutive_blocked`)
- **Test:** `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  (describe `circuit breaker`), `apps/engine/test/engine/dev/dev_rehydrator_test.exs`
  (describe `the four rehydrated states`), `test/application/use-cases/execution/rearm-dev-agent.use-case.spec.ts`
- **Origin:** [ADR 0045](../adr/0045-reagendamento-por-evento-do-dev-agent.md)

### RN-050 — With no PR open, no gate opens {#rn-050}

The dev agent proposes commit, push, and PR and **reads each one's
outcome**. It only opens the gate if all three executed. If one stayed
`pending` — the agent's autonomy at `require_approval` — it enters
`awaiting_approval`, **holding the worktree**, and opens no gate at all.

Without this the gate opened regardless, and the damage was silent: QA
scans the **worktree**, not the PR; it found the files, approved; SecOps
approved; the task closed as completed — **with not one line committed
and no PR at all**. Only later, when approving the commit, would the
user see the action fail (with an empty diagnosis, because
`System.cmd` on a deleted directory returns `{"", 2}`).

What releases the agent is `task.pr_settled`, emitted by the api when
`pr_open` reaches a terminal outcome: `opened: true` opens the gate;
`opened: false` (denied or failed) returns the task with a diagnosis,
instead of leaving the agent waiting forever for a gate no one is going
to open.

A denied PR **doesn't count toward the circuit breaker** of
[RN-047](#rn-047): the decision was the user's, not the agent burning
the ceiling — the same principle as restart recovery.

This rule also eliminates D5 (worktree recycled under pending approval)
as a consequence: the worktree is only released on `gate_resolved`, the
gate only opens after the PR, and the PR only opens after commit and
push.

- **Where:** `apps/engine/lib/engine/dev/agent_io.ex` (`propose/3`),
  `apps/engine/lib/engine/dev/dev_agent_server.ex` (`abrir_gate/1`,
  `aguardar_aprovacao/2`),
  `apps/api/src/application/use-cases/actions/execute-git-action.use-case.ts`
  (`settlePrOpen`)
- **Test:** `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  (describe `pending approval doesn't open a gate`)
- **Origin:** [ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md)

### RN-059 — Falha de turno é evento durável com origem, e o agente fala {#rn-059}

Quando um turno de LLM falha, o agente grava **`agent.error`** no event log
com três campos: `origem` (vocabulário do ADR 0020), `mensagem` em português e
o `reason` bruto. E a mensagem aparece **no fio da conversa**, não só no log.

Era o contrário, e o desfecho era o pior possível: os quatro agentes
conversacionais gravavam `agent.response` com conteúdo **vazio** —
indistinguível de sucesso no log imutável — e mandavam o motivo por
`broadcast`, que é efêmero. Quem não estivesse com a aba aberta naquele
segundo nunca saberia que houve erro; quem estivesse, via um balão em branco.

Havia um segundo caminho, pior ainda: quando a api narrava a falha no PRÓPRIO
frame final (budget, credencial ausente, binding faltando), o turno não caía no
ramo de erro e **não emitia evento nenhum** — silêncio absoluto.

Esse mesmo ramo, uma vez corrigido, custou uma segunda rodada: no PO, no
Arquiteto e no Dev Lead ele devolvia `{state, ""}` — uma TUPLA onde todos os
outros ramos de `run_turn` devolvem o `state` (um mapa). O `Map.put/3` de
`TurnoAssincrono.tratar_resultado/2` levantava `BadMapError` dentro do
`handle_info`, e como os quatro conversacionais são `restart: :temporary`, o
agente MORRIA e não voltava. A falha deixava de ser silenciosa e virava uma
queda — com os gatilhos mais corriqueiros que existem. A regra vale inteira: o
agente narra a falha **e continua de pé**. Por isso `tratar_resultado/2` tem
uma segunda barreira, no ponto compartilhado pelos quatro: resultado de turno
que não é mapa vira `agent.error` com origem `codigo`, nunca um processo morto.

A origem NUNCA é adivinhada: cada padrão em `FalhaDeTurno.origem/1` tem um
motivo escrito, e o que não casa com nenhum sai como **`codigo`** — a lacuna é
do nosso classificador, e essa é a origem que aponta a ação certa (ADR 0020).

Os eventos já gravados não se apagam — a tela os NOMEIA como resposta vazia
anterior a esta regra, em vez de mostrar branco.

- **Onde:** `apps/engine/lib/engine/agents/falha_de_turno.ex`,
  `criativo_server.ex`, `po_server.ex`, `arquiteto_server.ex`,
  `dev_lead_server.ex`, `infra_lead_server.ex` (`emit_falha/2`),
  `turno_assincrono.ex` (`tratar_resultado/2`, a segunda barreira),
  `apps/web/src/lib/session-falha.ts`
- **Teste:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  (evento durável com origem; nunca grava resposta vazia; erro narrado no frame
  final também vira evento); `po_server_test.exs` (o frame final com erro não
  derruba o agente — GenServer de VERDADE, com `Process.alive?/1`);
  `arquiteto_server_test.exs` e `dev_lead_server_test.exs` (mesmo caminho, ciclo
  completo); `turno_assincrono_test.exs` (a segunda barreira narra em vez de
  derrubar); `apps/web/src/lib/session-falha.test.ts`
- **Origem:** execução real da FASE 13b

### RN-061 — A TOOL failure is also an event, and goes back to the model {#rn-061}

A tool call's result is never discarded. It becomes `tool.result` in the
event log (`ok`, and when it fails, `erro`), the agent **says** what
happened in the thread, and the reason **goes back to the model** in the
`tool` role — for it to correct and reemit on the next turn. A tool
error is input to the loop, not the end of the line.

The Creative agent was the only one that discarded it
(`_ = EmitArtifact.run(args, state)`) — the PO and the Architect already
fed it back. In a real execution the model emitted `titulo`/`descricao`
against a schema that requires `title`/`description`/`origin`: the
**four business rules from the conversation were refused**, no event was
recorded, and it kept saying "I recorded the rules" with an empty panel.

The tool's description now NAMES each type's required fields, in
English and with a filled-in example — including that
`business_rule.origin` is a **non-empty list** of `seq` from the
messages that originated the rule, not free text. Without that the model
guesses, and guesses in the conversation's language.

It's the same rule as [RN-059](#rn-059) applied to the other failure
path: two policies for the same problem would be two chances to swallow
the error.

- **Where:** `apps/engine/lib/engine/agents/criativo_server.ex` (`dispatch_tool`,
  `realimentar`), `apps/engine/lib/engine/harness/tools/emit_artifact.ex`
  (`descricao/0`), `apps/engine/lib/engine/harness/artifact_schemas.ex`
  (`required/1`)
- **Test:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  (`a refused tool becomes a tool.result with an error, and the agent speaks`)
- **Origin:** PHASE 13b real execution

### RN-062 — Mensagem a agente conversacional REIDRATA o processo {#rn-062}

Uma mensagem endereçada a Criativo, PO ou Arquiteto sobe o processo se ele não
estiver de pé, antes de entregar. O `init` de cada servidor já reconstrói o
histórico do event log; faltava quem o chamasse.

Antes, um restart do engine matava a conversa em silêncio: a sessão sobrevivia
como `active`, o processo do agente não, e a próxima mensagem morria com
`GenServer.call ... exited` — sem evento, sem erro na tela, sem nada. O usuário
via a própria mensagem aparecer e nenhuma resposta chegar, para sempre.

O comentário de `revise/2` dizia que agente morto nesta rota "é um bug". É — e
basta o engine reiniciar para acontecer. É a mesma garantia que a Fase 12b deu
aos dev agents, aplicada aos conversacionais.

- **Onde:** `apps/engine/lib/engine_web/controllers/agent_command_controller.ex`
  (`message/2`)
- **Teste:** coberto pela suite de agentes; a prova de execução está em
  docs/explanation/validacao-real.md
- **Origem:** execução real da FASE 13b

### RN-063 — Encerrar sem produzir é desfecho, não falha {#rn-063}

A Anamnese tem uma ferramenta para dizer **"não há nada a emitir, e este é o
motivo"** (`skip_proficiency`). A rodada encerra com `anamnese.run_skipped` e o
motivo no payload — nunca com `anamnese.run_failed`.

Antes ela não tinha esse verbo. A única ferramenta era `emit_proficiency`, que
recusa lista vazia (com razão: perfil vazio não é perfil). Numa janela sem
membro elegível a Anamnese descobria isso na PRIMEIRA iteração, escrevia em
prosa "não há membros elegíveis", chamava `emit_proficiency` com `profiles: []`,
era recusada — e repetia até o teto de iterações. Cada volta reenvia o
histórico, que cresce a cada volta.

Numa execução real isso custou **145 mil tokens de entrada e 4× o gasto do
Criativo e do PO somados**, sem produzir nada. E voltava a cada tick do
agendador, a cada 15 minutos, para sempre.

O teto de iterações funcionava — não era laço infinito. O desperdício era **por
rodada, repetido indefinidamente**, que é pior: um laço trava e alguém percebe;
este sangrava devagar.

Narrar `run_failed` para uma rodada que fez a coisa certa também é defeito: quem
lê o log aprende a ignorar o evento de falha.

- **Onde:** `apps/engine/lib/engine/anamnese/tools/skip_proficiency.ex`,
  `apps/engine/lib/engine/anamnese/hooks/termination.ex`,
  `apps/engine/lib/engine/workers/anamnese_worker.ex` (`handle_outcome`)
- **Teste:** `apps/engine/test/engine/workers/anamnese_worker_test.exs`
  (`encerrar sem perfis é DESFECHO: narra run_skipped com o motivo, não falha`)
- **Origem:** execução real da FASE 13b

### RN-069 — Retrying a task recreates the branch, doesn't fail {#rn-069}

`WorktreeManager.add_worktree/3` uses `git worktree add -B` (creates
**or** resets), not `-b`. It already removed the previous worktree's
directory, but left the branch behind — and since its name comes from
the task's slug, the second attempt on the SAME task always fell into
`fatal: a branch named 'feature/<slug>' already exists`.

The effect was permanent: unblocking the task didn't help, reactivating
execution didn't help, and the circuit breaker disarmed with no way
out. In a real execution the only way out was a manual
`git worktree prune` in the project's workspace.

Resetting is the right call: the previous worktree has already been
removed, that attempt's work is worthless (the task went back to the
queue), and the branch is reborn from the current point of `work_dir`.

- **Where:** `apps/engine/lib/engine/dev/worktree_manager.ex`
- **Test:** `apps/engine/test/engine/dev/worktree_manager_test.exs`
  (`retrying the SAME task recreates the worktree instead of failing`)
- **Origin:** PHASE 13b real execution

### RN-073 — A pending approval SUSPENDS the loop, doesn't burn it {#rn-073}

When a pipeline tool returns `pending`, the ToolLoop **stops** and the
dev agent enters `:awaiting_approval`, holding onto the task, the
worktree, and the loop's history. The user's decision emits
`task.action_settled`, which wakes it: the real result takes the place
where the word "pending" would be, and the loop resumes from where it
stopped.

Two properties the test locks down:

- **Nothing is recorded while waiting.** The tool message's slot stays
  empty. Recording "pending" there would tell the model that's what the
  command answered — which was exactly the defect.
- **A refusal is a response.** The reason takes the result's place and
  the agent learns that path closed, instead of waiting forever for
  something no one is going to approve. It's the same principle as
  `pr_settled` with `opened: false` ([RN-047](#rn-047)), one level down.
- **The wake has to ARRIVE.** `task.action_settled` is born on the
  `task` aggregate, not on the `proposed_action` the table name
  suggests: the engine's drain reads a closed list of aggregates
  (`session` and `task`). Emitted outside that list, the event is
  recorded successfully, stays with a null `processed_at`, and is never
  even read — no job, no error, no log, and the agent waits forever.
  The contract crosses two languages, and that's why it's pinned on
  both sides.

If the engine **restarts** during the wait, the rule no longer applies
to that task: the suspended loop only exists in memory, so it goes back
to the queue blocked with origin `infra`, and the decision made
afterward has nowhere to be applied. Blocking with a diagnosis is
deliberate — the alternative was the silent eternal wait, which is
exactly what this rule exists to end.

What this fixes: `pending` used to come back as the tool's RESULT and
the loop kept going. The model read that as the command's answer,
learned nothing, tried something else — and each attempt burned an
iteration until `toolloop.limit_reached {iteration: 8,
max_iterations: 8}`, with the task blocked for "iteration limit
reached" with not one line written. The approvals granted arrived
after the loop was exhausted and were useless.

The terminal allowlist ([RN-068](api.md#rn-068)) still applies, but stops
being the only defense: it's a list of foreseen commands, and the model
invents commands.

- **Where:** `apps/engine/lib/engine/harness/hooks/action_pipeline.ex`,
  `harness/tool_loop.ex`, `dev/dev_agent_server.ex`,
  `workers/dev_agent_wake_worker.ex`; emission in
  `apps/api/src/application/use-cases/actions/{approve,deny}-action.use-case.ts`
- **Test:** `apps/engine/test/engine/dev/dev_agent_awaiting_approval_test.exs`
  (`pending action STOPS the agent`; `approved: resumes the loop with
  the REAL output`; `restart during the wait BLOCKS the task`) and
  `apps/engine/test/engine/dev/wake_do_outbox_ao_agente_test.exs`, which
  walks the whole chain — outbox, drain, queue, and process — because
  the per-link tests were all green with the delivery broken; the
  aggregate is pinned on the api side in
  `apps/api/test/application/use-cases/actions/approve-deny-action.use-case.spec.ts`
- **Origin:** [ADR 0052](../adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md),
  triage phase A

### RN-074 — A saída de terminal tem teto de bytes {#rn-074}

A saída de um comando é cortada em `TERMINAL_OUTPUT_MAX_BYTES` (default 32 KiB)
antes de virar resultado da ferramenta, e o corte deixa uma **marca** dizendo os
dois tamanhos e o que fazer:

```
[saída truncada: 32768 de 1048576 bytes. Refine o comando (head, grep,
-maxdepth) para ver o que falta.]
```

Três propriedades que o teste fixa:

- **O teto é `>`, não `>=`.** Saída que cabe exatamente no limite passa
  intacta — marcá-la faria o modelo refinar um comando que já deu tudo.
- **O corte não parte caractere multibyte.** `binary_part/3` corta por byte;
  cair no meio de um `é` produz binário inválido que quebra a serialização
  JSON antes de o resultado chegar ao modelo.
- **`raw_bytes` continua sendo o tamanho REAL produzido**, não o truncado. É
  medição, e mentir nela esconderia justamente o comportamento que motivou o
  teto. Quem quiser detectar truncagem compara `byte_size(stdout)` com
  `raw_bytes`.

O que isso conserta: a saída de cada comando fica no histórico do laço e viaja
em **todo** turno seguinte. Sem teto, um `find` numa árvore grande basta — a
execução do `hello-limpo` morreu com `{413, "request entity too large"}` no
turno 18, sem uma linha escrita. O estouro é de **bytes da requisição**, não de
janela de contexto: a maior chamada bem-sucedida tinha 28.993 tokens de entrada.

A marca é endereçada ao **modelo**, não ao humano — sem dizer o que fazer, ele
tende a repetir o mesmo comando.

- **Onde:** `apps/engine/lib/engine/actions/terminal_executor.ex`
  (`truncate/2`), teto em `apps/engine/config/runtime.exs`
- **Teste:** `apps/engine/test/engine/actions/terminal_executor_test.exs`
  (describe `teto de bytes da saída`)
- **Origem:** achado S de
  [achados-execucao-real.md](../explanation/achados-execucao-real.md), Fase F do
  [backlog](../explanation/backlog.md)

### RN-076 — A credencial de git nunca é escrita em arquivo {#rn-076}

O engine trabalha em repositório remoto pedindo o **remoto de trabalho** à api
(`GET /internal/projects/:projectId/git-remote`), que devolve a origem **limpa**
e o token do owner à parte. O token entra na invocação do git pelo **ambiente do
processo filho** e em nenhum outro lugar:

- **não no `origin`** — é a URL limpa que fica gravada no `.git/config`;
- **não em argv** — `ps` mostra a linha de comando de qualquer processo;
- **não em arquivo** — nem helper persistido, nem `~/.git-credentials`.

O helper de credencial é passado por `-c`, vale só para aquele processo, e vem
depois de um `credential.helper=` vazio: helpers são acumulativos e o primeiro a
responder ganha, então sem zerar antes um helper do host responderia no lugar.

**Por que isso é regra e não preferência.** Escrever
`https://x-access-token:TOKEN@github.com/…` no `origin` — o que quase todo
tutorial ensina — grava a credencial em texto puro **dentro da pasta do
projeto**, exatamente onde a [RN-075](api.md#rn-075) dá ao dev agent leitura
**auto-aprovada**. Um `cat .git/config` devolveria o token sem passar por
aprovação nenhuma, e ele viajaria ao provider de LLM no histórico do laço. O
escopo de caminho protege contra o agente ler para FORA do projeto; não tem como
proteger contra um segredo que o próprio produto colocou DENTRO.

A credencial é a do **owner do workspace**, pelo mesmo resolvedor da
[RN-058](api.md#rn-058) — duas regras de "de quem é a credencial" divergiriam.
Provider `local` não tem token nem consulta a api: é resolvido direto do banco,
e é o caminho que o `pnpm dev` e a suite inteira exercitam.

- **Onde:** `apps/engine/lib/engine/actions/git_auth.ex`,
  `engine/projects/project_repository.ex` (`remoto_de_trabalho/1`),
  `apps/api/src/application/use-cases/git/get-project-git-remote.use-case.ts`
- **Teste:** `apps/engine/test/engine/actions/git_auth_test.exs` (o token não
  aparece em argv nem no helper) e
  `apps/api/test/application/use-cases/git/get-project-git-remote.use-case.spec.ts`
  (a origem devolvida não contém o token nem `@`)
- **Origem:** [ADR 0056](../adr/0056-o-engine-trabalha-em-repositorio-remoto.md),
  achado N, Fase B do [backlog](../explanation/backlog.md)

### RN-077 — A origem da falha é sempre uma das quatro {#rn-077}

Todo desfecho de falha nomeia a ORIGEM no vocabulário **fechado** do
[ADR 0020](../adr/0020-destravar-gates-qa-secops.md) —
`infra | modelo | codigo | politica`. Não há quinto valor: `null` e
`"indeterminada"` deixaram de ser possíveis.

Duas garantias estruturais, e nenhuma depende de alguém lembrar:

- **`AgentIo.block_task/4` não tem default para a origem.** Ela era
  "obrigatória em espírito", com `"indeterminada"` de default — e o desfecho
  mais caro da execução real saiu exatamente assim, porque o call site não
  passou nada. Sem default, esquecer vira erro de compilação.
- **`FalhaDeTurno.origem/1` sempre devolve uma das quatro**, e há teste de
  tabela que falha se alguma entrada — inclusive uma forma nunca vista —
  produzir outra coisa.

**Por que `indeterminada` saiu.** Ela existiu com um argumento razoável: não
chutar seria mais honesto que escolher no escuro. O efeito real foi o oposto —
`indeterminada` **não aponta ação nenhuma**, e quem triava a rodada seguinte
recomeçava a investigação do zero. O que ela significava de fato era *o
classificador não reconheceu esta forma*, que é lacuna do nosso código: `codigo`
é a origem que aponta a ação certa (acrescentar a cláusula que falta). O
diagnóstico continua indo verbatim, então nada se perde.

**As origens não são chute.** Cada desfecho do ToolLoop diz quem decidiu parar:
`report_blocked` e teto de iterações são do **modelo** (ele decidiu, ou gastou o
que tinha); orçamento e PR não aprovada são **política** (foi uma decisão, nada
quebrou); restart e falha ao montar contexto são **infra**; e quando há
`last_error`, a origem sai do MESMO erro que o diagnóstico narra — era esse par
que se contradizia, com `diagnosis` dizendo `{413, …}` e `origem` dizendo
"indeterminada" na mesma linha.

- **Onde:** `apps/engine/lib/engine/agents/falha_de_turno.ex`,
  `engine/dev/agent_io.ex` (`block_task/4`, sem default),
  `engine/dev/dev_agent_server.ex` (`origem_da_parada/1`)
- **Teste:** `apps/engine/test/engine/agents/falha_de_turno_test.exs`
  (`o vocabulário é fechado`) e
  `apps/engine/test/engine/dev/dev_agent_server_test.exs`, que afirma a origem
  no evento emitido
- **Origem:** achados P, Q e T de
  [achados-execucao-real.md](../explanation/achados-execucao-real.md), Fase G do
  [backlog](../explanation/backlog.md)

### RN-079 — O Psicólogo não analisa sessão sem evento analisável {#rn-079}

Antes de gastar um turno de modelo, a análise pergunta se há o que analisar. Não
havendo, ela **não roda** e o desfecho vira `psychologist.analysis_skipped`.

**Analisável exclui duas coisas, por motivos diferentes:**

- **o rastro dos próprios analistas.** O Psicólogo grava o turno dele no log da
  sessão que está analisando (`agent.response`, `tool.call`, `tool.result`, a
  hipótese). Contar isso faria uma sessão vazia parecer povoada **a partir da
  primeira análise**, e cada retentativa a encheria mais — o critério nunca mais
  reprovaria. Vale igual para a Anamnese;
- **`bootstrap.*`**, que é provisionamento de repositório rodando sozinho: nove
  passos de máquina não dizem nada sobre a pessoa.

Tudo o mais conta, inclusive `proposed_action.*` — o usuário aprovando e negando
sem escrever mensagem nenhuma **é** comportamento, lição que a Anamnese já tinha
aprendido ([RN-063](#rn-063)).

**São duas contagens, e elas não se substituem.** A crua dimensiona o trabalho
(quanto log ler, logo qual tier de triagem, leve ou pesado); a analisável decide
se há trabalho. Confundi-las é o defeito: uma sessão só de bootstrap passava por "20
eventos" sem ter nenhum, ganhava a análise, e o modelo — sem nada para citar —
inventava `seq` inexistentes até a validação de evidência rejeitar e ele
desistir, com o orçamento já gasto.

**Pular vale também para reprocessamento manual.** Reprocessar não fabrica
material: quem clicou recebe o motivo no log em vez de uma hipótese inventada
sobre um log que não existe.

O skip vira **evento**, ao contrário do da Anamnese, que é só log — aquele roda
a cada 15 min e viraria ruído, este roda uma vez por fechamento de sessão, e uma
análise ausente sem nada narrado é indiagnosticável.

- **Onde:** `apps/engine/lib/engine/session_events/event.ex` (`count_analisaveis/1`),
  `apps/engine/lib/engine/psychologist/triage.ex` (`should_run?/1`),
  `apps/engine/lib/engine/workers/psychologist_worker.ex`
- **Teste:** `apps/engine/test/engine/session_events/event_analisaveis_test.exs`
  (inclui a reprodução da sessão do achado: 14 eventos, nenhum analisável),
  `apps/engine/test/engine/workers/psychologist_worker_test.exs`
- **Origem:** achado J, Fase E do [backlog](../explanation/backlog.md)

### RN-080 — Regra de negócio duplicada é recusada na entrada {#rn-080}

`business_rule` cujo título já existe **no projeto** não é gravada. A recusa
volta ao modelo pelo mesmo caminho de um payload inválido, e ele segue para a
próxima regra em vez de parar.

**Na entrada porque não há outro lugar.** Não existe tabela de regras: o
artefato É o evento `artifact.business_rule`, e evento de domínio não é apagado
nem editado. Deixar entrar significa conviver com a duplicata para sempre.

**Escopo de projeto, não de sessão** — é entre sessões que a duplicata nasce.
Rodar o Criativo de novo abre sessão nova, e uma checagem por sessão não veria a
rodada anterior, que é exatamente o caso do achado.

A comparação normaliza caixa, acento e espaço redundante; pontuação fica.
**Duplicata semântica continua passando, e isso é declarado, não esquecido:**
"Saudação com nome" e "Quem chama pode se identificar" seguem sendo duas regras,
porque separá-las é julgamento e não cabe num `if`.
Desde a [RN-681](api.md#rn-681) a duplicata semântica de TÍTULO é **avisada** por
embedding depois de gravar — continua passando, nunca é recusada aqui.

- **Onde:** `apps/engine/lib/engine/harness/artifact_dedupe.ex`,
  `apps/engine/lib/engine/harness/tools/emit_artifact.ex`,
  `apps/engine/lib/engine/session_events/event.ex` (`titulos_de_regras/1`)
- **Teste:** `apps/engine/test/engine/harness/artifact_dedupe_test.exs`,
  `apps/engine/test/engine/harness/emit_artifact_dedupe_test.exs`
- **Origem:** achado K, Fase E do [backlog](../explanation/backlog.md)

### RN-085 — O teto de iterações é por TIPO de agente {#rn-085}

Quantas voltas um agente pode dar no laço de ferramenta depende do trabalho que
ele faz: **8** para quem conversa, **60** para o dev agent e para os subagentes
de QA. Não há mais um número único.

**O teto de 8 nasceu de agente conversacional e foi herdado por quem trabalha.**
Na validação real da 13b isso apareceu como bloqueio: o dev agent gastou as
oito voltas explorando um repositório recém-provisionado e **nunca escreveu um
arquivo**; com 25, escreveu três e rodou os testes. O desfecho registrado era
`limite de iterações atingido` com origem `modelo` — tecnicamente verdade e
praticamente inútil, porque o modelo nunca chegou a julgar nada.

**Subir o default global seria a correção errada**, e é isso que a regra
protege: o Criativo não precisa de 60 voltas para conversar, e o teto também é
a trava contra laço infinito.

**Quem pode subir não é "quem trabalha muito", é quem tem trava de gasto por
baixo.** O teto de iterações protege contra laço infinito; quem protege o
BOLSO é o `token_budget_micros`. Dev agents e subagentes de QA rodam com o
`task_budget_micros` da task, então afrouxar as voltas não afrouxa a conta.
`infra-workflows` usa ferramenta pesada e mesmo assim **fica em 8**: ele roda
sem budget, e para ele o teto é a única trava que existe.

Duas bordas com teste próprio:

- **`dev-lead` é conversacional**, apesar do prefixo `dev-` que identifica os
  dev agents (`dev-<modulo>`, `dev-<modulo>-2`). O lead decide e delega, e sem
  a cláusula explícita nasceria com o teto do trabalho pesado por acidente de
  nomenclatura.
- **Agente desconhecido cai no teto mais baixo.** Errar para o lado barato:
  quem precisa de mais voltas aparece como `limite de iterações atingido` e é
  corrigido; quem ganha 60 por engano gasta calado.

- **Onde:** `apps/engine/lib/engine/harness/iteracoes.ex`, aplicado em
  `apps/engine/lib/engine/harness/tool_loop.ex` (`init/1`)
- **Teste:** `apps/engine/test/engine/harness/iteracoes_test.exs` e
  `apps/engine/test/engine/harness/tool_loop_test.exs`
  (`o teto vem do TIPO do agente quando o chamador não passa um`,
  `teto explícito do chamador VENCE o do tipo`)
- **Origem:** achado X, [validação real da 13b](../explanation/validacao-real.md);
  [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md), FASE 14d

### RN-115 — The Anamnese can be paused globally; the pause belongs to the PRODUCT, it never deletes data {#rn-115}

`ANAMNESE_ENABLED` (engine env var, boolean, default `false` as of
this rule) decides whether a NEW Anamnese round can happen — periodic
(`AnamneseSchedulerWorker`) or on demand (`AnamneseCommandController`).
A PRODUCT decision by the user on 2026-08-10 ("hoje ele não está trazendo
dados de muito valor"), not a bug — see docs/explanation/backlog.md. Disabled,
NO existing data is touched: hypotheses, proficiency profiles and instruction
patches already stored remain intact and visible, and the PER-MEMBER
opt-out (RN-025) remains a separate concept — the pause belongs to the SYSTEM, not to
individual profiling.

`AnamneseSchedulerWorker.kickoff/0` (called once at boot) does NOT schedule the
periodic job when disabled, instead of scheduling it and letting `perform/1`
no-op on every tick — cheaper (the Oban queue does not receive a job every
`ANAMNESE_INTERVAL_SECONDS` just to do nothing) and clearer for whoever
inspects the queue. **Correction on 2026-08-10** (a real finding in execution, not a
hypothesis): the original version of this rule left `perform/1` unconditional
on purpose, so the chain between rounds would not carry the decision to
turn on/off with it — but that meant a chain already scheduled
BEFORE the flag existed (or before someone disabled it) kept
rescheduling itself forever, running the Anamnese for real with the flag saying
`false`. That is exactly what happened on a dev Postgres older than
the original PR, remedied by hand by cancelling the scheduled jobs.
`perform/1` now checks `enabled?/0` on every tick, like `kickoff/0`: if
disabled, neither `enqueue_projects/0` nor the rescheduling happens, and the
chain dies there — which also SELF-HEALS the scenario of an old job
that still fires once, without needing manual intervention.

`AnamneseCommandController.run/2` (on-demand route, "reanalisar agora" in
Settings) answers **503** with body `{"error": "anamnese_desativada"}`
when disabled — deliberately distinct from the empty 409 that already existed for
"project without session" (the two were easy to confuse in a bare 409, and they are
quite different causes). `RunAnamneseUseCase`, on the api side, converts the engine's
503 into `ServiceUnavailableException` with `reason: "anamnese_disabled"` in the
body — never a generic 500 nor a reused 409. The web
(`ProjectSettingsTab.tsx`) discovers the state on the first click of "Rodar
agora" (there is currently no prior read of the global state) and, from then on,
disables the button and keeps the explanation VISIBLE on screen — not just a toast
that disappears (RN-088: never a silent or confusing failure).

- **Where:** `apps/engine/lib/engine/workers/anamnese_scheduler_worker.ex`
  (`enabled?/0`, `kickoff/0`),
  `apps/engine/lib/engine_web/controllers/anamnese_command_controller.ex`,
  `apps/engine/config/runtime.exs`,
  `apps/api/src/domain/anamnese/anamnese-disabled.error.ts`,
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`
  (`runAnamnese`), `apps/api/src/application/use-cases/anamnese/run-anamnese.use-case.ts`,
  `apps/web/src/routes/settings/ProficiencySection.tsx`
- **Test:**
  `apps/engine/test/engine/workers/anamnese_scheduler_worker_test.exs`
  (`kickoff/0` does not schedule when disabled, schedules when enabled, default off;
  `perform/1` disabled in the middle of the chain does no fan-out nor reschedules),
  `apps/engine/test/engine_web/controllers/anamnese_command_controller_test.exs`
  (503 distinct from 409, with and without session),
  `apps/api/test/application/use-cases/anamnese/run-anamnese.use-case.spec.ts`,
  `apps/web/src/routes/ProjectSettingsTab.test.tsx` (`ProficiencySection`)
- **Edge case:** the flag is GLOBAL (all projects/workspaces), not per project
  — unlike the parallelism ceiling (RN-083) or the model inheritable per
  area (RN-102), which are per-scope decisions. Turning it back on is
  `ANAMNESE_ENABLED=true` and restarting the engine; there is no UI button for it
  (it is operational, not a project preference).
- **Origin:** no ADR — a reversible product decision, not a structural
  architecture change. See docs/explanation/backlog.md.

### RN-116 — Falha ao CRIAR um handoff não derruba o agente {#rn-116}

`confirm_readiness` (Criativo → PO) e `offer_infra_handoff` (Arquiteto → Infra;
o `offer_dev_handoff`, Arquiteto → Dev Lead, saiu na
[RN-672](api.md#rn-672), e o handoff ao Dev Lead que a Infra
oferece segue a mesma régua) chamam a api pra criar o handoff DEPOIS de o
turno já ter rodado — no caso do Criativo, depois de o `product_brief` já
estar gravado no event log. Se essa chamada falhar (api fora, 5xx, etc.), o
handoff não existe, mas isso NUNCA derruba o GenServer do agente: a falha vira
`agent.error` durável, com `origem` (`FalhaDeTurno.origem/1`) e uma mensagem
que diz o que JÁ foi salvo (o product_brief, as regras) e o que não foi (o
handoff) — para o usuário saber que confirmar de novo é seguro, não repete
trabalho.

Era o oposto: as três chamadas usavam `{:ok, _handoff} = EngineApiClient.create_handoff(...)`
— um match rígido. `{:error, _}` virava `MatchError`, e como os três agentes
sobem com `restart: :temporary` num `DynamicSupervisor` `:one_for_one`, o
processo simplesmente SUMIA — sem `agent.error`, sem resposta no fio, só
silêncio. Do lado de quem observava: a informação (regras, product brief)
parecia ter "passado" (estava gravada), mas nada iniciava do lado do agente
seguinte, porque o handoff nunca chegou a existir. Reabrir a conversa não
resolvia sozinho — só uma NOVA mensagem reativa o processo (rehidratando do
event log), e só uma nova confirmação de prontidão tenta o handoff de novo.

A mensagem NÃO reusa `FalhaDeTurno.mensagem/1` (a de `RN-059`, "não consegui
completar este turno... nada foi gasto"): nos três call sites o trabalho já
rodou (ou nem precisava rodar, no caso de `offer_dev_handoff`) — dizer "nada
foi gasto" seria falso quando tokens já tinham sido gastos no turno de
consolidação. Reusa só `FalhaDeTurno.origem/1`, que classifica pelo FORMATO
do motivo (status HTTP, exceção de transporte), não por ser turno de LLM.

O `Engine.Harness.Tools.OfferHandoff` (a ferramenta que o PO usa via tool
call, dentro do ToolLoop) já tratava `{:error, reason}` sem crashar — o
defeito era só nestes três handlers server-driven, que chamam
`EngineApiClient.create_handoff/5` DIRETO em vez de passar pela ferramenta.

- **Onde:** `apps/engine/lib/engine/agents/criativo_server.ex`
  (`handle_call(:confirm_readiness, ...)`, `emit_falha_handoff/3`),
  `apps/engine/lib/engine/agents/arquiteto_server.ex`
  (`handle_call(:offer_infra_handoff, ...)`, `emit_falha_handoff/3`);
  `apps/engine/lib/engine/infra/infra_lead_server.ex`
  (`emit_falha_do_handoff_ao_dev_lead/2`, RN-672)
- **Teste:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  ("prontidão: falha ao criar o handoff NÃO derruba o processo, e vira
  agent.error durável"); `apps/engine/test/engine/agents/arquiteto_server_test.exs`
  (`offer_infra_handoff`, sucesso e falha);
  `apps/engine/test/engine/infra/infra_lead_server_test.exs` (o handoff ao Dev
  Lead que a Infra oferece, recusado com 500)
- **Origem:** relato de uso real no projeto `exp-001` (Criativo → PO); a
  mesma falha estrutural foi achada por leitura de código nos dois handoffs
  do Arquiteto, sem reprodução separada para eles

### RN-117 — The Psicólogo can be paused globally; the pause belongs to the PRODUCT, it never deletes data {#rn-117}

`PSYCHOLOGIST_ENABLED` (engine env var, boolean, default `false`) decides
whether a NEW Psicólogo round can happen — automatic (session
closing, routed by `Engine.Outbox.Drain`) or on demand
(`PsychologistCommandController.reanalyze/2`). The same PRODUCT decision by the
user on 2026-08-10 already applied to the Anamnese (RN-115, "hoje ele não está
trazendo dados de muito valor") — not a bug, see docs/explanation/backlog.md.
Disabled, NO existing data is touched: analyses and hypotheses already
emitted remain intact and visible.

Unlike the Anamnese (whose automatic trigger is a periodic TICK that the
flag itself decides whether to reschedule), the Psicólogo's automatic trigger is
session closing — `Engine.Outbox.Drain` routes
`session.closed`/`session.closed_abnormally` to `PsychologistWorker` only
when `PsychologistWorker.enabled?/0` is true (`Drain.handlers_for/1`);
disabled, only `SessionLifecycleWorker` runs, and the Psicólogo job is not even
born. `PsychologistWorker.perform/1` remains unconditional on purpose —
but it is NO longer "the same pattern" as `AnamneseSchedulerWorker` (see the
2026-08-10 correction in RN-115 above): there `perform/1` started checking the flag
because it ITSELF reschedules the chain on every tick, and an old job
firing unconditionally reopened the Anamnese with the flag off. The
Psicólogo has no chain that reschedules itself — each job is born
from ONE event (`session.closed`), and what decides is the `Drain` at the moment it
RECEIVES the event, not the worker at the moment it RUNS; a Psicólogo job
already enqueued before turning the flag off is, at most, the last pending
round, never an infinite chain. That is why the pre-existing suite of
`PsychologistWorker` (which calls `perform/1` directly) did not need to change.

`PsychologistCommandController.reanalyze/2` (on-demand route,
"Reanalisar" in the Insights tab) answers **503** with body
`{"error": "psicologo_desativado"}` when disabled, without even creating the
job. `ReanalyzeSessionUseCase`, on the api side, converts the engine's 503 into
`ServiceUnavailableException` with `reason: "psychologist_disabled"` in the
body — never a generic 500. This discovers the pause when there is already an
analysis to reprocess; the screen with NO hypothesis at all has its own prior
read, which did not exist here — see [RN-454](#rn-454).

- **Where:** `apps/engine/lib/engine/workers/psychologist_worker.ex`
  (`enabled?/0`), `apps/engine/lib/engine/outbox/drain.ex`
  (`handlers_for/1`),
  `apps/engine/lib/engine_web/controllers/psychologist_command_controller.ex`,
  `apps/engine/config/runtime.exs`,
  `apps/api/src/domain/psychologist/psychologist-disabled.error.ts`,
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`
  (`reanalyzeSession`),
  `apps/api/src/application/use-cases/execution/reanalyze-session.use-case.ts`,
  `apps/web/src/routes/ProjectInsightsTab.tsx`
- **Test:**
  `apps/engine/test/engine/outbox/drain_test.exs` (`session.closed` only
  enqueues the Psicólogo when enabled),
  `apps/engine/test/engine_web/controllers/psychologist_command_controller_test.exs`
  (503 without creating a job, 202 with the job enqueued when enabled),
  `apps/api/test/application/use-cases/execution/reanalyze-session.use-case.spec.ts`,
  `apps/web/src/routes/ProjectInsightsTab.test.tsx`
- **Edge case:** the flag is GLOBAL (all projects/workspaces), like the
  Anamnese's. Turning it back on is `PSYCHOLOGIST_ENABLED=true` and restarting the
  engine; there is no UI button for it.
- **Origin:** no ADR — a reversible product decision, not a structural
  architecture change. See docs/explanation/backlog.md.

## Session

### RN-122 — The "Stop" button cancels the turn FOR REAL, killing the task holding the LLM call {#rn-122}

Until now there was no cancellation anywhere. The root was structural:
`agent_command_controller.ex` handled the user's message with
`GenServer.call(pid, {:user_message, texto}, ...)` — SYNCHRONOUS — and the
entire turn (tool loop + SSE call to the LLM) ran INSIDE `handle_call`. The
agent's process stayed blocked until the turn finished and handled NO other
message in the meantime — not even a future cancel command.

The fix: the turn `handle_call`/`handle_cast` of the four conversational
agents (Creative, PO, Architect, Dev Lead) spawns a
`Task.Supervisor.async_nolink/2` (`Engine.Agents.TurnoAssincrono`, new,
shared by all four) with the heavy work and returns `{:noreply, state}` —
the reply to the original `GenServer.call` is DEFERRED until the task
finishes (`GenServer.reply/2`, fired when `{ref, resultado}` arrives at
`handle_info`). Since the agent process STOPS being blocked, a new
`handle_cast(:cancel, state)` arrives and is handled while the turn runs:
`Task.shutdown/2` in `:brutal_kill` mode kills the task, which drops the
HTTP (SSE) connection it holds with the api — that's what makes cancellation
actually save tokens, not just stop rendering on the client. The original
`from` receives `{:error, :cancelado}`, and a TERMINAL `agent.error` is
recorded with origin `"politica"` (policy — the same origin as
budget/credential/binding — cancelling is a user decision to stop spending
tokens, not a fifth value in ADR 0020's closed vocabulary) — without it,
`GetSessionPendingWorkUseCase` would see `agent.activated` with no
subsequent `agent.response`/`agent.error`, and the session would stay hung
on the pending-work signal.

Two competing messages to the same agent (the user sends again while a turn
is already running) never spawn a second task:
`TurnoAssincrono.iniciar/3` replies `{:error, :turno_em_andamento}`
(turn in progress) right away.

> **Revised by [RN-578](#rn-578) (ADR 0163):** the reply to the original
> `GenServer.call` is no longer deferred until the task finishes — it goes out
> on ACCEPTANCE, as soon as the task is up, and cancelling answers nobody (the
> caller already has `:ok`). `{:error, :turno_em_andamento}` stopped being
> discarded by the controller: it is a named 409 and a durable `agent.error`.

- **Where:** `apps/engine/lib/engine/agents/turno_assincrono.ex` (the
  mechanism), `apps/engine/lib/engine/agents/{criativo,po,arquiteto,dev_lead}_server.ex`
  (the four turn `handle_call`/`handle_cast`), `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:361`
  (`cancel/2`), `apps/engine/lib/engine_web/router.ex` (`POST
  /internal/sessions/:sessionId/agent/cancel`),
  `apps/api/src/application/use-cases/agents/cancel-agent-turn.use-case.ts`,
  `apps/api/src/interfaces/http/agents/agents.controller.ts` (`POST
  /projects/:projectId/sessions/:sessionId/agents/:agent/cancel`),
  `apps/web/src/routes/SessionPage.tsx` (`handleCancel`, "Stop" button in
  the composer)
- **Test:** `apps/engine/test/engine/agents/turno_assincrono_test.exs` (the
  task dies FOR REAL — `Process.alive?/1` before and after — not just
  "stopped importing the result"), `apps/api/test/application/use-cases/agents/cancel-agent-turn.use-case.spec.ts`
- **Edge case:** cancelling with no turn in progress is an idempotent
  NO-OP — there's no task to kill nor pending `from` to reply to.
  Cancellation does NOT undo a side effect that already ran BEFORE the task
  died (e.g., a tool that had already been dispatched and recorded its
  event) — it only interrupts what hasn't happened yet.
- **Origin:** this session's investigation; no dedicated ADR (a concurrency
  pattern change INSIDE the harness, not a layer/database boundary).

### RN-129 — The ToolLoop never writes an empty `agent.response`; a transport failure becomes a durable `agent.error` {#rn-129}

[RN-059](#rn-059) closed the empty bubble for the four conversational
agents, but they do not go through `Engine.Harness.ToolLoop` — each one
calls `EngineApiClient.llm_turn_stream/6` in its own module. The `ToolLoop`
(used by dev agents, QA Automação/Performance-Segurança, Infra-Workflows,
Anamnese and Psicólogo) had the SAME defect on a different path: it emitted
`agent.response` on every iteration, even when the model only called a tool
without text, or ended the turn without producing anything — and the transport failure
(provider down, timeout) became an `agent.response` with absent `content`,
equally indistinguishable from success.

Found live in a real execution session (dev agents): two bubbles with the
RN-059 compatibility text ("resposta vazia — evento anterior...")
appeared in a session created minutes earlier — they were not old events, they were
the same defect happening again, only in the execution tab.

Two fixes, at the STRUCTURAL point common to every `ToolLoop` consumer,
not module by module:

1. **Empty content never becomes `agent.response`.** An iteration that only called a
   tool is already narrated by `tool.call`/`tool.result`; an iteration that
   produced nothing (neither text nor tool call) leaves the outcome for the loop's caller
   to decide — `ctx.last_error`/`{:ok, ctx}` carry the information, and
   the consumer (e.g.: `DevAgentServer.handle_outcome/4`) already writes the durable event
   of its OWN domain (`dev.blocked`, with `origem`).
2. **A transport failure becomes a durable `agent.error`**, with `origem`
   (`Engine.Agents.FalhaDeTurno.origem/1` — the SAME helper the four
   conversational agents use, without duplicating classification) and `mensagem` in
   Portuguese — never again an `agent.response` without `content`.

- **Where:** `apps/engine/lib/engine/harness/tool_loop.ex` (`loop/1`,
  `emit_falha/2`)
- **Test:** `apps/engine/test/engine/harness/tool_loop_test.exs`
  ("iteração só com tool call (sem texto) não grava agent.response vazio",
  "modelo termina o turno sem texto e sem tool call...", "falha de
  transporte... grava agent.error durável com origem")
- **Origin:** RN-059 (the rule this one extends) — found live in a real
  execution session with dev agents

## PR Gates

### RN-140 — A gate cycle that dies mid-way resumes on its own, with no manual intervention {#rn-140}

`QaLeadServer`/`SecOpsAgentServer` are `restart: :temporary`, and the
gate's intermediate transitions (`DevAgentServer.correct/3`,
`Dispatcher.run_secops/2`) are direct in-memory calls — made AFTER
`record_gate_verdict` has already durably advanced `gate_status` on the
api. A crash between the two used to trap the PR forever in
`awaiting_qa`/`awaiting_secops`: nothing knew that step had been left
pending, and no engine restart fixed it — [ADR 0057](../adr/0057-o-gate-espera-a-aprovacao.md)
itself already declared suspension in `{:awaiting, ...}` as a known
limit, and investigating again found that the window between a recorded
verdict and a dispatch call is, in practice, easier to hit.

`gate_states` (schema `engine`, key `{project_id, task_id, gate}`)
records the in-flight cycle at the SAME points where the transitions
already happened — `"in_progress"` before any subagent/scanner runs,
`"dispatch_pending"` right after `record_gate_verdict` returns
`correct`/`run_secops` and before the in-process call.
`Engine.Gates.GateRescuer` scans rows stuck for more than 15 minutes
(configurable, `GATE_RESCUE_STALE_AFTER_SECONDS`) — generous on purpose,
because a QA subagent's ToolLoop legitimately runs up to
`TOOL_LOOP_MAX_ITERATIONS_GATE` (60) iterations, and a short threshold
would rescue (and duplicate) a cycle that's merely slow — and resumes:
`"in_progress"` restarts the whole area (no surgical resumption of
`ctx`, which doesn't survive a restart, the same choice as the dev
agent); `"dispatch_pending"` resends exactly the lost call. Called on
boot and by an Oban tick self-rescheduled every 5 minutes
(`GATE_RESCUE_INTERVAL_SECONDS`),
`Engine.Workers.GateRescueSchedulerWorker` — the same idiom as
`ModelSyncSchedulerWorker`/`AnamneseSchedulerWorker`.

Two guards against duplicating work: a process alive ON THE SAME node
(`Registry.lookup`) is never disturbed, and the staleness threshold
covers what the local guard doesn't reach (remote replica — `Registry`
is local to the node, the same caveat as `Engine.Dev.Wake` since
[ADR 0045](../adr/0045-reagendamento-por-evento-do-dev-agent.md)). The
worst outcome of a residual race is duplicated, cheap work — the api
rejects a second `record_gate_verdict` for a gate that no longer owns
`gate_status` (`nextGateStatus`), and `DevAgentServer.correct/3` is
already idempotent via a state guard since ADR 0052 — never
inconsistent data.

- **Where:** `apps/engine/lib/engine/gates/gate_state.ex`,
  `gate_rescuer.ex`, the write points in `qa_lead_server.ex`
  (`run_area/3`, `apply_gate_result/6`) and `secops_agent_server.ex`
  (`run_secops/3`, `apply_verdict/6`), and
  `apps/engine/lib/engine/workers/gate_rescue_scheduler_worker.ex`
- **Test:** `apps/engine/test/engine/gates/gate_rescuer_test.exs` — kills a
  real `QaLeadServer` with the cycle in flight
  (`DynamicSupervisor.terminate_child/2`, the durable row surviving the
  process) and proves `GateRescuer.run/0` reconnects the area on its own
  up to a real outcome; the scenario in the statement (lost
  `run_secops`) and the lost `correct` return, both with REAL process and
  dispatch, no `FakeGateDispatcher`; and the two guards (a live local
  process isn't disturbed; a recent row isn't touched)
- **Origin:** [ADR 0067](../adr/0067-o-gate-sobrevive-ao-restart.md), which
  extends [ADR 0057](../adr/0057-o-gate-espera-a-aprovacao.md)

---

### RN-141 — The content read by `read_file` also has a byte ceiling {#rn-141}

[RN-074](#rn-074) locked the **terminal** output against
`{413, "request entity too large"}`, but left the same door open through
`read_file`: it read the WHOLE file, with no ceiling, and that content entered the
loop history and traveled in every following turn. A PR with a large file
(lockfile, bundle, generated file) was enough to lock up dev agents AND the
Performance/Security QA — which only has `ReadFile`/`SearchWorkspace` (no
`Terminal`, on purpose) to investigate a PR, so it had no escape
route at all when the file was too large.

The content is cut at `READ_FILE_MAX_BYTES` (default 32 KiB, the same value as
RN-074 by coincidence of context, not by coupling — the two variables
are independent) before becoming the tool result, with a marker stating
the file and the two sizes:

```
[arquivo package-lock.json truncado: mostrando 32768 de 1048576 bytes. Use
search_workspace para localizar um trecho específico em vez de reler o
arquivo inteiro.]
```

The same three properties as RN-074 (the ceiling is `>` not `>=`; the cut does not split
a multibyte character; the marker is addressed to the model, saying what to do). The
truncation lives in the TOOL (`Engine.Harness.Tools.ReadFile`), not in
`Engine.Harness.WorkspaceFiles.read_file/2` — that is the generic file access
base, shared by `write_file`/`search_workspace`, and
truncating there would cut content of those who do not need that ceiling.

`search_workspace` did not get the same treatment: it returns only the PATHS that
matched (`matched_content` is a boolean), never the file content — the
overflow vector that motivated this RN does not apply to it.

- **Where:** `apps/engine/lib/engine/harness/tools/read_file.ex`
  (`truncate/2`), ceiling in `apps/engine/config/runtime.exs`
  (`read_file_max_bytes`)
- **Test:** `apps/engine/test/engine/harness/tools/read_file_test.exs`
  (describe `teto de bytes do conteúdo`)
- **Origin:** found live in the event log of a real execution — the 4 dev
  agents of a project and the Automação/Performance-Segurança QAs blocked
  with `{413, "request entity too large"}`, the same root cause as RN-074, a different
  door

## Session

### RN-142 — Confirming readiness with NO business rule at all is refused by the engine, not just hidden in the UI {#rn-142}

Before, clicking "I'm ready to produce" — or calling the route directly —
ALWAYS created the `product_brief` and offered the handoff to the PO, even
in a conversation where zero business rules had been captured.
`business_rule_refs(state)` already existed in `criativo_server.ex`, but
only to POPULATE the brief's `"rules"` field — never as a blocking
condition. In the UI, `SessionPage.tsx` disabled the button only during
`streaming`, without checking the rule count.

The real guarantee had to live on the server, not on the screen: whoever
calls the route directly (or a future client that isn't this frontend)
can't punch through the guardrail just because the button is drawn
disabled. `CriativoServer.handle_call(:confirm_readiness, ...)` now checks
`business_rule_refs(state)` BEFORE spawning the
`Engine.Agents.TurnoAssincrono` `Task` ([RN-122](#rn-122)) — empty, it
refuses right there, without running the consolidation turn, without a
`product_brief`, without a handoff.

The refusal doesn't turn into an HTTP 4xx:
`agent_command_controller.ex#readiness/2` IGNORES this `GenServer.call`'s
return and always answers 202, the same pattern `message/2` already uses
since RN-122 ("this response is just the acknowledgment" — the real
outcome lives in the event log). That's why the refusal is narrated as a
DURABLE `agent.error` (RN-059), with origin `"politica"` (policy — it's a
product decision, not an infra/model/turn failure) — and a message
explaining why; the session thread already knows how to render this event
type (`lerFalhaDeTurno`, the same red bubble as any other turn failure).

The complementary UX, in `SessionPage.tsx`: the button is born `disabled`
(with a `title` explaining why) while `events` has no
`artifact.business_rule` — the SAME source that already feeds the
"Business rules" panel (`ContextAside`), with no second read that could
diverge from the first.

- **Where:** `apps/engine/lib/engine/agents/criativo_server.ex`
  (`handle_call(:confirm_readiness, ...)`, `emit_falha_sem_regra/1`),
  `apps/web/src/routes/SessionPage.tsx` (`hasBusinessRule`, the "I'm ready
  to produce" button)
- **Test:**
  `apps/engine/test/engine/agents/criativo_server_test.exs` ("readiness:
  refuses when NO business rule was captured" — no turn, no brief, no
  handoff; the refusal narrated with origin `"politica"`),
  `apps/web/src/routes/SessionPage.readiness-exige-regra.test.tsx` (button
  disabled with no rule, enabled with 1+)
- **Edge case:** the session already had `readiness.confirmed` recorded by
  the api BEFORE signaling the engine (`ConfirmReadinessUseCase`) — that
  doesn't change: it's the record of the user's CLICK, a fact that happened
  independent of the engine accepting or refusing afterward.
- **Origin:** code investigation confirming a user report — no ADR (new
  guardrail on an already-existing flow, no layer/database boundary
  change).

---

### RN-150 — `search_workspace` has a ceiling on hit COUNT and on BYTES, each with its own marker {#rn-150}

Found in a PR review: `search_workspace` (dev agents and the two
QA/gate agents, `qa_tools.ex` and `qa_performance_seguranca_agent.ex` — the latter
only has `read_file`/`search_workspace`, without `Terminal`, on purpose)
returned ALL search results, with no ceiling at all — the same class as
finding S (`Engine.Actions.TerminalExecutor.truncate/2`) and as the
`read_file` fix (`Engine.Harness.Tools.ReadFile.truncate/2`): the result stays
in the loop history and travels in every following turn, and a large tree
is enough to blow the provider's `{413, "request entity too large"}`.

Two independent ceilings, because the search overflows in two different ways:

1. **Hit count** — a tree with thousands of files matching the
   term produces thousands of `- caminho` lines even if no individual
   file is large. Truncating only by BYTES at the end would still pay the cost
   of scanning and reading the content of each of those files before building the
   string. That is why the count ceiling (`SEARCH_WORKSPACE_MAX_HITS`,
   default 500) lives in `WorkspaceFiles.search/3`, which already STOPS consuming the
   search as soon as it finds enough hits — the pipeline runs over a
   `Stream`, and `Enum.take(stream, max_hits + 1)` only reads from the source what it
   needs to produce the first `max_hits + 1` results. The "+1" is what
   allows saying there WERE more without continuing to scan the rest to
   count the exact total — counting the total would pay again the I/O the ceiling
   exists to avoid, so the marker says "showing the first N" and never
   invents a total.
2. **Bytes of the final text** — even with limited hits, very
   long paths can produce a large string. Byte ceiling
   (`SEARCH_WORKSPACE_MAX_BYTES`, default 32,768), same pattern as
   `terminal_output_max_bytes`/`read_file_max_bytes` — its OWN variable,
   it does not reuse the other two: same class of overflow, diverging one should not
   require touching the others.

The truncation marker is addressed to the MODEL, not to the human: it says what was
cut (hits and/or bytes) and instructs to refine the search term — the same
spirit as the `TerminalExecutor`/`ReadFile` markers.

- **Where:** `apps/engine/lib/engine/harness/workspace_files.ex`
  (`search/3`, `take_capped/2`),
  `apps/engine/lib/engine/harness/tools/search_workspace.ex`
  (`truncate/3`, `marca_de_truncagem/5`),
  `apps/engine/config/runtime.exs` (`search_workspace_max_hits`,
  `search_workspace_max_bytes`)
- **Test:** `apps/engine/test/engine/harness/workspace_files_test.exs`
  (`search/3` with `max_hits` cuts the COUNT and marks truncation only
  when there are more than the ceiling),
  `apps/engine/test/engine/harness/search_workspace_test.exs` (a search with
  few results is not altered; a search with more hits than the ceiling is
  truncated with a clear warning; a final text larger than the byte ceiling is also
  cut)
- **Origin:** PR review finding — the second real cause of the 413 in
  reviews, after the `read_file` fix

---

### RN-162 — The Criativo's structured questions {#rn-162}

The Criativo can, when it asks SEVERAL questions in the same response, emit the
list in a STRUCTURED format instead of letting the user answer item by
item in free text — a new tool `ask_structured_questions`
(`apps/engine/lib/engine/harness/tools/ask_structured_questions.ex`,
`:direct`), registered next to `emit_artifact`. Schema:
`{ questions: [{ id, label, type?, options? }] }` — `id` unique and non-empty,
`label` non-empty, `type` ∈ `text|textarea|select` (default `text`),
`options` mandatory and non-empty when `type: select`. It writes
`chat.structured_question`.

The frontend (`StructuredQuestionCard`, `SessionPage.tsx`) renders a
form with one field per question — `Input`/`Textarea`/`Select` from the
design system, according to `type`. `POST .../agents/:agent/structured-
question/:questionSetId/answer` (`AnswerStructuredQuestionUseCase`) validates
that every question has a non-empty answer, writes
`chat.structured_question_answered` (referencing `questionSetId` = the id of the
question event) and REUSES `SendAgentMessageUseCase` — the answers become
a concatenated message ("1. {label}: {resposta}\n2. ..."), as if the
user had typed in the thread; there is no new "the agent reads the
structured answer" channel. A set of questions can only be answered
ONCE: resubmission is refused with 409, and the form does not even
reappear — the card becomes read-only as soon as there is a later
`chat.structured_question_answered` with the same `questionSetId`.

- **Where:** `apps/engine/lib/engine/harness/tools/ask_structured_questions.ex`,
  `apps/engine/lib/engine/agents/criativo_server.ex`,
  `apps/api/src/application/use-cases/agents/answer-structured-question.use-case.ts`,
  `apps/api/src/interfaces/http/agents/agents.controller.ts`,
  `apps/web/src/routes/SessionPage.tsx` (`StructuredQuestionCard`)
- **Test:** `apps/engine/test/engine/harness/tools/ask_structured_questions_test.exs`,
  `apps/engine/test/engine/agents/criativo_server_test.exs`,
  `apps/api/test/application/use-cases/agents/answer-structured-question.use-case.spec.ts`,
  `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx`
- **Origin:** user request — no precedent of structured input in the chat

### RN-163 — The Criativo keeps the promise to try again {#rn-163}

Each Criativo turn runs a **bounded tool-use loop**, with a ceiling of **12**
trips to the model — the same design the PO and the Arquiteto already had. Before, the
model was called ONCE per turn: the tool result was appended to the
in-memory history and nobody read it again, so the sentence *"vou corrigir e
tentar de novo"* — literal in the code — was only fulfilled if the user sent
another message. For whoever used it, the Criativo simply stopped answering
after saying it was going to fix it.

Four consequences, and each one is a rule:

1. **A tool error is input, not the end of the line.** The reason goes back to the model
   as a `tool` message and the loop calls the model again, which re-emits it corrected
   WITHIN the same turn.
2. **Nothing is announced that the code will not execute.** The retry sentence is
   decided after dispatching the tools and knowing how many rounds
   are left: with a round available, the agent says it will fix it; without a round, it
   does not promise.
3. **The tool failure became a durable `agent.error`, with origin**
   ([RN-059](#rn-059)) — it was an `agent.response`, indistinguishable in the event log from
   a normal response. `origem: infra` when the api refused the `append_event`;
   `origem: modelo` for the payload the model wrote (wrong key,
   `origin` that is not a list, duplicated rule, system-emitted type). The payload
   carries `tool` and `retentativa`.
4. **An exhausted ceiling does not end in silence.** It becomes an `agent.error` with
   `reason: "limite_de_iteracoes"` and `origem: modelo`, the same reading as
   the `ToolLoop`'s `toolloop.limit_reached`. The event name is NOT reused: this
   agent does not run inside the `ToolLoop`, and the event would lie about who
   produced it.

Two boundaries of the loop, both deliberate: a successful `ask_structured_questions`
**ends** the turn (the ball is with the user, and the answers
come back in a future turn — [RN-162](#rn-162)); and a turn that had a failure in
some round closes with a CONSOLIDATED outcome in the thread, so the last word
is not the error of a round that was already corrected later.

- **Where:** `apps/engine/lib/engine/agents/criativo_server.ex`
  (`run_turn_capturing/3`, `continuar/4`, `emit_falha_de_ferramenta/4`,
  `emit_falha_limite/2`)
- **Test:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  (a loop that really corrects, an exhausted ceiling narrated, origin `infra` vs
  `modelo`, a structured question that ends the turn)
- **Origin:** real use in the `exp001` project — "o Criativo não respondeu depois
  de dizer que iria corrigir e tentar de novo"

### RN-164 — The PO READS what already exists, scoped to the project {#rn-164}

The PO gained two READ tools — `listar_regras_de_negocio` and
`listar_backlog` (`:direct`, with no parameter at all) — served by two internal
routes scoped to the **project**: `GET /internal/projects/:projectId/business-rules`
and `GET /internal/projects/:projectId/backlog`.

The first returns every `artifact.business_rule` of the project's sessions with the
whole `description`, which stories already cite each rule and the
`uncoveredCount`; the second returns the SAME epic → story → task tree
as the Backlog tab, through the same `ListBacklogUseCase` (three reads per project,
never N+1). The text returned to the model puts the UNCOVERED rules first and
the ORPHAN epics before the tree — that is what generates work.

What the rule fixes: until now the PO had **four tools, all of them
write tools**. Its context was built once, at kickoff, from the 200
last events of the **session** — from then on it did not know which rules
existed, which it had already covered, nor what it had already created. The scope is the
project and not the session on purpose: a rule captured in a previous session is
exactly what the per-session read hid.

Reading does **not** become a `proposed_action` (it is not an external effect), but it is CONTAINED in the
sense of ADR 0060: neither of the two routes accepts a parameter beyond the project
id — no search, no pagination, no filter —, the cost per call is
constant, and the text delivered to the model has a line ceiling stating the real
total when it truncates.

- **Where:** `apps/engine/lib/engine/harness/tools/listar_regras_de_negocio.ex`,
  `apps/engine/lib/engine/harness/tools/listar_backlog.ex`,
  `apps/engine/lib/engine/agents/po_server.ex`,
  `apps/engine/lib/engine/sessions/engine_api_client.ex`,
  `apps/api/src/application/use-cases/backlog/list-business-rules.use-case.ts`,
  `apps/api/src/interfaces/http/internal/internal-projects.controller.ts`
- **Test:** `apps/engine/test/engine/harness/tools/listar_regras_de_negocio_test.exs`,
  `apps/engine/test/engine/harness/tools/listar_backlog_test.exs`,
  `apps/engine/test/engine/agents/po_server_test.exs`,
  `apps/api/test/application/use-cases/backlog/list-business-rules.use-case.spec.ts`
- **Origin:** real use in the `exp001` project — "crie ferramenta para o PO
  conseguir listar as regras de negócio"

---

### RN-165 — An epic without a story is called out, and the PO asks when it does not know {#rn-165}

When the PO ends a turn having created an epic and **no story for
it**, that becomes an EXPLICIT outcome: a durable event
`backlog.epic_without_story` (with `origem: "modelo"`, the ids and titles of the
epics and the message) plus the `agent.error` broadcast — the pattern of
[RN-059](#rn-059): the log is what survives, the broadcast is the agent saying it in the
thread. The call-out is per OCCURRENCE: once reported, the pending list is
emptied, and it does not become an alarm that repeats on every turn.

What counts is the creation that **succeeded**: a `create_story` refused by the api
(nonexistent `business_rule_id`, for example) does not settle the epic. Treating it as
if it did would be trading one silence for another. The pending epics live in the
`PoServer` state and are NOT rehydrated: the call-out is about the obligation
assumed in the turn, and rebuilding it from the event log would reopen an old epic the
user has already resolved some other way.

Along with it came the two pieces that were missing for the PO to have a way out other than stopping:
`ask_structured_questions` — the SAME tool as the Criativo's
([RN-162](#rn-162)), just advertised in `po_server` — and the kickoff
instruction saying, in so many words, that an epic without a story blocks execution
and that **when information is missing, one ASKS**, never stops nor invents. The
previous instruction did not say a word about what to do in the face of a
gap, and in the face of a gap without instruction a model chooses between inventing
and stopping.

- **Where:** `apps/engine/lib/engine/agents/po_server.ex`
  (`anotar_obrigacao/4`, `encerrar_turno/1`, `obrigacoes/0`),
  `apps/engine/lib/engine/harness/tools/create_epic.ex` (`id_no_resultado/1`),
  `apps/web/src/lib/activity.ts`
- **Test:** `apps/engine/test/engine/agents/po_server_test.exs`
  (describe "RN-165"), `apps/web/src/lib/activity.test.ts`
- **Origin:** real use in the `exp001` project — a backlog without stories, hence without
  tasks, hence execution stuck without a visible error

---

### RN-166 — The PO's iteration ceiling leaves a trace {#rn-166}

Once the iteration ceiling of the `PoServer` tool loop (12) is exhausted, the
turn emits `toolloop.limit_reached` with `{iteration, max_iterations}` —
the SAME type and the same payload that `Engine.Harness.ToolLoop` already emitted
since Fase 3. Before, the clause returned the state and that was it: from outside, an exhausted
loop was indistinguishable from a turn that simply ended.

Reusing the identifier instead of creating a `po.*` is deliberate: it is the same fact
(the loop hit the ceiling), and whoever reads the event log should not need to learn a
second name because the conversational agent has its own loop instead of
using the `ToolLoop`.

- **Where:** `apps/engine/lib/engine/agents/po_server.ex` (`run_turn/2`,
  clause `remaining <= 0`)
- **Test:** `apps/engine/test/engine/agents/po_server_test.exs`
  ("teto de iterações emite toolloop.limit_reached")
- **Origin:** investigation of the `exp001` hang — the loop ended
  silently

---

### RN-171 — The list question has a free-text way out, by default {#rn-171}

A `type: "select"` question of `ask_structured_questions` (RN-162) accepts
an answer **outside the list**. The field is `allowOther`, and the **default is `true`**:
whoever declares nothing offers the way out. Closing the list requires an explicit
`allowOther: false`, and only makes sense when it is genuinely
closed ("Sim"/"Não").

The open default is not a style preference. A list closed by the model's
OVERSIGHT locks the whole conversation and the user has no way to
unlock it from outside — that is exactly what real use found: the model
offered an option of the kind "Escreva você mesmo" and the form had nowhere to
write, because the tool schema did not know how to express "besides these, whatever
you want". A list opened by mistake, in the worst case, offers one field
too many. The two errors do not cost the same. For the same reason the tool
description **forbids** creating an "Outro" option inside `options`: the form
already offers it by itself, and two escape hatches in the same list confuse.

`allowOther` only exists in `select` — in `text`/`textarea` the field is already free
text, and the engine normalizes these two to `false` instead of writing a meaningless
state in the event log. On screen, choosing "Outra (escrever)" swaps the
`Select` for an `Input`: the interface sentinel (`__outra__`) **never**
travels to the backend, and what goes is the typed TEXT. The submit button
keeps requiring ALL questions filled — `AnswerStructuredQuestion
UseCase` refuses with 400 listing what is missing, so enabling it with an empty field
would only produce a server error —, and being on "Outra" with the text still
blank does NOT count as filled.

The card also stopped being the only item in the thread aligned to nothing: it is now
centered with the same 560px ceiling as the `ApprovalCard` in the
`chat` variant ([RN-173](web.md#rn-173)) and gets the agent's avatar and color, which is what
makes it read as SOMEONE's utterance instead of an orphan form. Before, it was born
pushed to the left with a 480px ceiling, while the bubbles start 45px
inward.

- **Where:** `apps/engine/lib/engine/harness/tools/ask_structured_questions.ex`
  (schema, validation and `normalizar/1`), `apps/web/src/lib/api-types.ts`
  (`StructuredQuestion.allowOther`), `apps/web/src/routes/SessionPage.tsx`
  (`StructuredQuestionCard`, `OUTRA_RESPOSTA`, `permiteOutra`),
  `apps/web/src/routes/SessionPage.module.css` (`.structuredQuestionCard`,
  `.structuredQuestionCabecalho`)
- **Test:** `apps/engine/test/engine/harness/tools/ask_structured_questions_test.exs`
  (open default, explicit `false`, non-boolean `allowOther` refused),
  `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx`
  (describe "saída por texto livre no select")
- **Origin:** real use on `exp001` — "sempre dê a opção de input do usuário
  quando ele seleciona Escreva"

### RN-175 — Every agent response says which model it was generated with {#rn-175}

`agent.response` carries `modelName` in the **three** producers of the event, and not
only in the four conversational agents:

| producer | who goes through there | before |
|---|---|---|
| the four conversational ones (`criativo`/`po`/`arquiteto`/`dev_lead`) | chat | already wrote it, since [RN-146](api.md#rn-146) |
| `Engine.Harness.ToolLoop` | EVERY execution and gate agent — `dev-*`, QA, SecOps, Infra-Workflows, Psicólogo, Anamnese | **never wrote it** |
| `SendChatMessageUseCase` (api) | chat without an active agent, in which the one answering is the model | **never wrote it** |

No new call: `RunLlmTurnUseCase` already returns `modelName` in the body and
`StreamLlmTurnUseCase` already puts it in the `final` frame — the value is the name of the model
of the **resolved binding** (`model.name`), not the provider's echo. It is `null`
when the turn failed before resolving the binding, and absent in an event written
before this rule.

On screen, the model stopped being the loose word `modelo` in mono 10px
`--text-muted` next to the agent's name — which reads as if the model were
CALLED "modelo", and which fails the reading-text contrast. It became a
**chip** with the model icon, `--text-secondary` over `--surface-2`, and the
unknown label became "modelo não registrado". The screen does **not**
guess the model from the agent's CURRENT binding when the data is missing: attributing to
an old response a model that perhaps did not even exist when it was generated
would be inventing provenance, and invented provenance is worse than absent — the
same argument as the frozen price in `token_usage` ([RN-044](api.md#rn-044)).

Out of scope, declared: `agent.error` still lacks the model in the four
servers, even when the api sent it in the error frame (budget exceeded, for
example). It is a change to another event, with another question to answer.

- **Where:** `apps/engine/lib/engine/harness/tool_loop.ex`,
  `apps/api/src/application/use-cases/llm/send-chat-message.use-case.ts`,
  `apps/web/src/routes/SessionPage.tsx` (the chip in `agent.response`),
  `apps/web/src/routes/SessionPage.module.css` (`.messageModelo`)
- **Test:** `apps/engine/test/engine/harness/tool_loop_test.exs`,
  `apps/api/test/application/use-cases/llm/send-chat-message.use-case.spec.ts`,
  `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`,
  `apps/web/src/design-contraste.test.ts` (the chip's pair)
- **Origin:** real use on `exp001` — "PO não mostrou o modelo que estava
  utilizando; todos os agentes devem apresentar o seu modelo ao lado do nome"

## fluxo.yml × code audit — the Dev Lead's plan becomes a real approval (RN-284, ADR 0086)

It's not a planned phase: it's the fix for a divergence that the
`docs/fluxo.yml` × code audit found (`docs/explanation/auditoria-fluxo-vs-codigo.md`,
finding A2) — the flow already declared the `dev-lead`'s `plano-de-paralelismo` output
as `via: proposed_action`, and the code was never adjusted to match.

### RN-284 — A conversational agent's turn can SUSPEND waiting for human approval {#rn-284}

> **Revised by [RN-677](api.md#rn-677) (ADR 0194):** `propose_execution_plan`
> gained an execution pipeline — approving the plan records the tasks' module
> ([RN-678](api.md#rn-678)) and ACTIVATES execution; the action ends `executed` or
> `failed`, and that outcome is what the Dev Lead reads when resuming. Item 1 below
> ("has no execute-* pipeline") no longer holds for this type.

> **Revised by [RN-578](#rn-578) (ADR 0163):** EVERY conversational agent's turn
> stopped holding the `GenServer.call` — the `from` is answered
> on acceptance, and the suspension described here changed only the turn's CLOSING
> (`awaiting_approval` instead of `agent.done`), no longer the moment of the response.
> A `user_message` refused during suspension now becomes 409 on the click.

The first time a conversational agent (Criativo, PO, Arquiteto, Dev Lead —
all run a synchronous turn via a `GenServer.call` of up to 180s, mediated by
`Engine.Agents.TurnoAssincrono`) suspends waiting for a human decision. The
pattern already existed for the dev agent ([RN-073](#rn-073), ADR 0052) and the
QA/Infra gates (ADR 0057), but both are triggered by `cast` and never waited for a
synchronous response — that's exactly the point this mechanism solves, and the
parallelism ceiling that made the Dev Lead exist ([RN-083](api.md#rn-083)) is the reason
the first suspended approval is its.

**The mechanism, in four pieces:**

1. `Engine.Agents.DevLeadTools.run/2`
   (`apps/engine/lib/engine/agents/dev_lead_tools.ex:81-107`) calls
   `EngineApiClient.propose_action/5` instead of `append_event/3`, and returns
   `{:ok, texto}` (status `executed`/`auto_approved`/`approved` — all three
   count as success, because `propose_execution_plan` has no execute-*
   pipeline of its own and manual approval stays at `"approved"` forever),
   `{:pending, action_id}`, or `{:error, texto}`.
2. `Engine.Agents.DevLeadServer.run_turn/2`
   (`apps/engine/lib/engine/agents/dev_lead_server.ex`, `tool_calls`
   dispatch block) uses `Enum.reduce_while` to STOP at the first `:pending`,
   without processing the following calls nor recursing — and returns the `state` with
   the key `:aguardando_aprovacao` set
   (`%{action_id:, tool_call_id:, tool_name:, remaining:}`, the `remaining`
   already discounting the suspended iteration against the ceiling). The `role:
   "tool"` message does NOT enter `state.messages` at that moment — writing "pending" there
   would lie to the model that the command had already answered that (same reasoning as the
   dev agent, `Engine.Harness.Hooks.ActionPipeline`).
3. `Engine.Agents.TurnoAssincrono.tratar_resultado/2`
   (`apps/engine/lib/engine/agents/turno_assincrono.ex`) answers the `from`
   the same way and at the same time as always — that's what breaks the synchronous
   block at the right moment —, but instead of `finalizar/1` (which emits
   `agent.done` and `agent.status: idle`) it calls `suspender/1`: only
   `agent.status: awaiting_approval`, no `agent.done`, because the turn hasn't
   ended. The check is by the key's VALUE (`Map.get/2`, truthy), never
   by its presence — the Dev Lead carries `aguardando_aprovacao: nil` since
   `init/1`, so the key itself is always present.
4. `Engine.Sessions.LiveBroadcast.agent_status/4`
   (`apps/engine/lib/engine/sessions/live_broadcast.ex:38-39`) widened the
   guard from `["working", "idle"]` to include `"awaiting_approval"` — without
   this, the `agent.status` from step 3 wouldn't even be persisted.

**The resumption.** `Engine.Agents.DevLeadServer` subscribes
`Engine.Dev.Wake.subscribe(project_id, "dev-lead")` in `init/1` — the SAME
module that `Engine.Gates.QaLeadServer` already reuses for the QA subagents,
despite the name being "dev": delivery of `{:action_settled, ...}` is per AGENT,
routed by the payload's `agentId` (`apps/engine/lib/engine/workers/dev_agent_wake_worker.ex`),
not by agent type. When the decision arrives, a `handle_info` builds the
`role: "tool"` message with the REAL result (`texto_do_desfecho/1`, same
vocabulary as the dev agent and `QaLeadServer`), clears `aguardando_aprovacao`, and
resumes with `TurnoAssincrono.iniciar(state, nil, fn -> run_turn(state,
pendente.remaining) end)`.

**While suspended, a second `user_message` doesn't start a new turn** — a
guard on `handle_call({:user_message, _text}, _from, %{aguardando_aprovacao:
%{}})`, tested BEFORE the generic clause, emits `agent.error` (origin
`politica`) explaining that there's a pending decision in Approvals, without starting
any task.

**Accepted gap, declared — restart during the wait.** Unlike the dev
agent (which rehydrates `laco_pendente` via `handle_continue` in `init/1`, ADR
0052), the Dev Lead does NOT rehydrate `aguardando_aprovacao` — it's in memory only. If the
engine restarts while it's suspended, the decision remains recorded and
visible in Approvals (it's durable in the api), but the Dev Lead doesn't narrate the outcome
automatically: the process that subscribed to `Wake` died, and the next restart
brings up a new Dev Lead, with no subscription for that action. Closing this would require the
same mechanism as ADR 0052 — outside the scope of this change, which only makes the
behavior match what `docs/fluxo.yml` already declared.

- **Where:** `apps/engine/lib/engine/agents/dev_lead_tools.ex`,
  `dev_lead_server.ex`; `apps/engine/lib/engine/agents/turno_assincrono.ex`
  (shared by the four conversational agents); `apps/engine/lib/engine/sessions/live_broadcast.ex`;
  `apps/api/src/domain/actions/decide.ts` (`propose_execution_plan`)
- **Test:** `apps/engine/test/engine/agents/dev_lead_tools_test.exs`,
  `dev_lead_server_test.exs` (describe "suspensão em aprovação"),
  `turno_assincrono_test.exs` (describe "resultado com :aguardando_aprovacao"),
  `live_broadcast_test.exs`, `wake_do_outbox_ao_dev_lead_test.exs` (the
  ENTIRE chain — outbox → drain → worker → `Engine.Dev.Wake` → the
  Dev Lead's process, same pattern as `Engine.Dev.WakeDoOutboxAoAgenteTest`),
  `apps/api/test/domain/actions/decide.spec.ts` (describe "plano de
  execução do Dev Lead")
- **ADR:** [0086](../adr/0086-dev-lead-plano-suspende-para-aprovacao.md)
  (revises part of [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md);
  direct precedent: [ADR 0052](../adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md)
  and [ADR 0057](../adr/0057-o-gate-espera-a-aprovacao.md))

---

## UX Designer — the fifth conversational agent (RN-285..287, ADR 0087)

It's not a triggered separation trigger (`docs/fluxo.yml` always declared "when
the MANAGED project has its own interface to design" as the criterion) — it's a
conscious decision by the product owner to bring the role forward. `teste-de-
usabilidade` (requires a real human user) stays out of reach; `metricas-de-
uso` remains a gap, because it depends on the `analytics` role, which is still
`proposto`.

### RN-285 — The UX Designer is a SOLO conversational agent, with no area {#rn-285}

`Engine.Agents.UxDesignerServer` (`apps/engine/lib/engine/agents/ux_designer_server.ex:40`)
mirrors `Engine.Agents.ArquitetoServer`/`DevLeadServer`: a GenServer per session,
its own bounded tool-use loop with a ceiling of 14 (same caliber as Arquiteto/Dev
Lead — a reasoning agent, not light conversation like Criativo/PO). Activated
by an `accepted` handoff addressed to "ux-designer" — an already existing GENERIC
mechanism (`ActivateAgentUseCase`/`canActivateAgent` in the api gained
no line at all: any agent with an accepted handoff is already activatable).

The kickoff (`build_kickoff/1`, `ux_designer_server.ex:222`) reads the session's most recent
`artifact.product_brief` — the SAME "business
need" the Criativo produces, with no new artifact. The design system
(`design/tokens.css`, `design/COMPONENTS.md`) is DESCRIBED in the identity
(`Engine.Harness.Agents`, entry `"ux-designer"`), static text, because the
conversational agents have no tool for reading files from the repo — it's
the only prompt layer present in EVERY turn, not only in the kickoff.

No area, no subagents: `docs/fluxo.yml` already classified the role as
`camada_produto`, alongside Criativo and PO, neither of which has an area.

### RN-286 — `propose_prototype` records an artifact with no table and no dedicated use case, and offers TWO handoffs over the SAME artifact {#rn-286}

`artifact.prototipo_navegavel` follows the table-less design of
`artifact.project_image`/`artifact.c4_diagram` ([RN-149](api.md#rn-149)) — the event
log is the record —, but through a DIFFERENT path from the one those two use.
`choose_project_image`/`create_c4_diagram` need a use case IN THE API
(`DecidirImagemDoProjetoUseCase`/`CreateC4DiagramUseCase`) because they have
content DERIVED from another artifact (the Container level comes from the current
`module_map`) or a domain refusal shared by more than one consumer (the image's
resource ceiling). `propose_prototype`
(`Engine.Agents.UxDesignerTools.run/2`,
`apps/engine/lib/engine/agents/ux_designer_tools.ex:122`) has neither of the
two reasons — it's SELF-CONTAINED content that only the UX Designer itself writes and
only it reads back —, so FORM validation lives in the engine
(`Engine.Harness.ArtifactSchemas`, type `"prototipo_navegavel"`,
`artifact_schemas.ex:49/135` — non-empty personas and journeys, at least one
screen) and recording uses the GENERIC path the api already exposes for any
event type (`EngineApiClient.append_event_returning/3`), the same
mechanism as the Criativo's `artifact.product_brief`. No new route in the api.

After recording, `gravar_e_ofertar_handoffs/2` (`ux_designer_tools.ex:149`)
offers TWO handoffs over the SAME artifact — `create_handoff` to "po" and
to "dev-lead", both with the prototype's `artifactId`. Never a second
artifact for "spec-visual" (`docs/fluxo.yml`): the PO reads `resumo`/`prototipo`
to design the backlog, the Dev Lead reads the SAME `telas`/`anotacoes` as a
visual implementation reference — duplicating the content would risk the two
copies diverging on the next revision, the same argument behind the C4 not
retyping the `module_map`.

Failing to offer ONE of the two handoffs doesn't undo the already recorded artifact nor the
other handoff (RN-116) — the reason comes back as tool-result text, an input to the
loop and not the end of the line (RN-163): the model reads it and can report to the user in the
next response.

A SUCCESSFUL `propose_prototype` ends the turn
(`ux_designer_server.ex:120`, same guard as `propose_execution_plan` in the Dev
Lead) — without it the loop would go back to the model, which could propose again and
produce two prototypes with the same total. There's only ONE tool here
(there's no second tool call to chain as in the Arquiteto), so "stops at the
first success" loses nothing.

## Staff: code ready, dormant for automatic triggering (RN-305/RN-306, ADR 0088)

It's not a planned phase: `docs/fluxo.yml` declares the Staff/Principal Engineer as
`status: planned` since ADR 0085 ("contract ready, activation decided,
awaiting trigger"). The product owner decided to bring the CODE forward even knowing
that the automatic trigger (the Anamnese noticing a RECURRING systemic
problem) won't fire — the Anamnese is paused
(`ANAMNESE_ENABLED=false`, product decision of 2026-08-10). See the
pending item already documented in RN-086: the same signal that would make the Anamnese
propose raising the parallelism ceiling is what would make it propose a handoff to the
Staff, and neither fires while it is paused.

### RN-305 — The Staff activates through the GENERIC handoff path, without `USER_STARTED_AGENTS`, and without `kickoff/1` {#rn-305}

`USER_STARTED_AGENTS` (`apps/api/src/domain/sessions/agent-activation.ts`) is
the Criativo's exception (starts WITHOUT a handoff, by user command) — the Staff
does NOT enter it. Investigation confirmed that `canActivateAgent` already activates
any agent with an `accepted` handoff addressed to it, the same path that
already applies to `dev-lead`/`arquiteto`/`infra`; and `assertHandoffTargetAllowed`
(`apps/api/src/domain/agents/agent-areas.ts`) only refuses a handoff addressed to an area
SUBAGENT — the Staff has no area, so no domain change
in the api was necessary. "Manually triggerable" means the domain
MECHANICS allow it (any agent can call
`EngineApiClient.create_handoff(..., "staff", ...)`, and a human accepts through the
already existing route), not that there's a dedicated screen today to choose
"address handoff to the Staff" — the generic UI for handoff to an agent of choice
remains in the backlog (`docs/explanation/backlog.md`), as it already was before this
change.

`Engine.Agents.StaffServer` (`apps/engine/lib/engine/agents/staff_server.ex`)
is the fifth solo conversational agent (along with Criativo, PO, Arquiteto, Dev
Lead), mirroring the Arquiteto — a `GenServer` per session, rehydration from the event
log, bounded tool-use loop with a ceiling of 14 (`staff_server.ex:49`) — but **without
`kickoff/1`**: the other leads synthesize an opening instruction from
a previous artifact in the session's event log (product_brief, module_map,
backlog); the Staff has no such source, because the systemic problem is born outside
the session. `StaffSupervisor.start_agent/2` brings up the process (rehydrates the
history) and it stays idle until the first `user_message`
(`staff_server.ex:60`) — which is how whoever addressed the handoff explains the
problem. `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:60`
(the `start/2` clause for `"staff"`) never calls `kickoff` (the function doesn't even
exist), unlike po/arquiteto/dev-lead/infra.

- **Where:** `apps/api/src/domain/sessions/agent-activation.ts`
  (`canActivateAgent`, `USER_STARTED_AGENTS` — untouched),
  `apps/api/src/domain/agents/agent-areas.ts`
  (`assertHandoffTargetAllowed` — untouched),
  `apps/engine/lib/engine/agents/staff_server.ex`,
  `staff_supervisor.ex`,
  `apps/engine/lib/engine_web/controllers/agent_command_controller.ex`
  (the `start/2`/`message/2`/`via_for/2` clauses for `"staff"`),
  `apps/engine/lib/engine/application.ex` (`Engine.Agents.StaffSupervisor`
  in the supervision tree)
- **Test:** `apps/engine/test/engine/agents/staff_server_test.exs`
  (rehydration, absence of automatic kickoff — the turn only runs via
  `user_message`)
- **ADR:** [0088](../adr/0088-staff-agente-dormente-para-disparo-automatico.md)

### RN-306 — `propose_rfc` records the artifact DIRECTLY and returns the handoff in the SAME tool call, without `proposed_action` {#rn-306}

`Engine.Agents.StaffTools.propose_rfc`
(`apps/engine/lib/engine/agents/staff_tools.ex:41`) is the Staff's only
tool: problem, options with trade-offs, recommendation, and the scope of a
DISPOSABLE PoC (`descartavel: true` is FIXED — never written by the model). `run/2`
(`staff_tools.ex:89`) records `artifact.rfc_staff` via
`EngineApiClient.append_event_returning/3` — the same pattern WITHOUT a table and WITHOUT a
dedicated use case as `Engine.Harness.Tools.EmitInsight` (the Arquiteto's `emit_insight`),
and not that of `artifact.c4_diagram` (ADR 0068), which has its own use
case in the api because it DERIVES the Container level from the current `module_map` —
the RFC derives nothing from that side, the whole payload comes from the tool call.

After recording, the SAME `run/2` calls
`EngineApiClient.create_handoff(..., "staff", "arquiteto", artifact_id)` —
with no human confirmation in between, same pattern as
`CriativoServer.executar_confirm_readiness/1` emitting the product_brief and
offering the handoff to the PO in the same response. `propose_rfc` is NOT a
`proposed_action`: recording an architecture document isn't an external
effect (it isn't git, terminal, nor agent spend) — the real decision
(adopt, adapt, refuse the recommendation) is the Arquiteto's, in the handoff the
tool already returns. Failing to create the handoff does NOT take down the process nor
lose the already recorded RFC (RN-116) — the reason goes into the tool-result, and the model
knows it needs to retry only the handoff, not rewrite the RFC.

- **Where:** `apps/engine/lib/engine/agents/staff_tools.ex`
- **Test:** `apps/engine/test/engine/agents/staff_server_test.exs`
  ("propõe o RFC, grava o artefato e devolve o handoff ao arquiteto";
  "propose_rfc com opções vazias vira tool-result de erro"; "falha ao
  devolver o handoff ao arquiteto NÃO derruba o processo")
- **ADR:** [0088](../adr/0088-staff-agente-dormente-para-disparo-automatico.md)

**Declared, not hidden**: the team panel's roster
(`apps/web/src/lib/agent-status.ts`, `staffActive`) and the dashboard card
(`ProjectCardSummary.roster`, `apps/api/.../projects-summary.repository.ts`)
show the Staff when active, same criterion as `infraActive` — avoiding the
divergence the `RosterFacts` comment already warned about. `SessionPage.tsx`
was NOT touched: `staff` stays out of `AGENTES_DE_CHAT`, the same pattern already
accepted for `infra` (a REAL and ACTIVE lead also outside that list — the
handoff to it "is never accepted HERE", as the file's own comment
says). Today's end-to-end usage path is the internal route
(`POST .../agent/message`, `agent: "staff"`), not the Session screen.

---

## appsec gains secops's second moment (RN-360/361, ADR 0090)

`docs/fluxo.yml` already declared `id: appsec` as `proposto`, with the
separation criterion written in advance: "same pattern as QA: two MOMENTS, not
two agents for now". This change builds that second moment — a DESIGN threat
model, BEFORE code/PR exists — a conscious decision by the product
owner to bring the activation forward, without waiting for the `implementavel` gate the
registry itself cited as the trigger.

### RN-360 — The DESIGN threat model runs over story + module_map, without worktree/task_id, in the SAME secops process {#rn-360}

Whoever runs appsec is the SAME `Engine.Gates.SecOpsAgentServer` that already exists
for the deterministic PR verdict — not a new process. `run_design/2`
(`apps/engine/lib/engine/gates/secops_agent_server.ex:76`) is a `GenServer.cast`
to the same `Registry` key (`{project_id, "secops"}`) that `run/2` already
uses; the `handle_cast({:run_design, story_id}, state)`
(`secops_agent_server.ex:93`) fetches the context via
`Engine.Gates.AppSecContextBuilder.fetch/2`
(`apps/engine/lib/engine/gates/appsec_context_builder.ex:31`) — the story in the
project's backlog (`EngineApiClient.list_backlog/1`, the SAME read that
RN-164 gave the PO) and the current `module_map` of the session that created the story
(`EngineApiClient.get_infra_context/2`, the SAME read without task/story that the
Infra area already does) — and then calls `Engine.Gates.AppSecAgent.run/3`
(`apps/engine/lib/engine/gates/appsec_agent.ex:47`).

`AppSecAgent` is a STATELESS module (not a GenServer, same shape as
`QaPerformanceSegurancaAgent`), with a tool registry WITHOUT `Terminal` —
`[ReadFile, SearchWorkspace, EmitThreatModel]` — running a STRIDE-lite
checklist (Spoofing/Tampering/Repudiation/Information disclosure/Denial of
service/Elevation of privilege) via `Engine.Harness.ToolLoop.run/1`. The
structural difference of the "second moment without Terminal, without task_id" from the
earlier gate pattern: no `dev_state`/`worktree_path` enters the `ctx` —
`ReadFile`/`SearchWorkspace` degrade to the fallback of
`Engine.Actions.Workspace.workspace_dir/1` (the project's SHARED checkout,
not an agent worktree), and `session_id` comes from
`story["sessionId"]`, never from a `dev_state`. `EmitThreatModel`
(`apps/engine/lib/engine/gates/tools/emit_threat_model.ex`) has no
`approved`/`changes_requested` verdict — appsec always ENDS by recording the
threat model, never approving/failing anything —, and that's why it doesn't reuse
`Engine.Gates.Hooks.Termination` (the extracted shape is different): it has its
OWN hook, `Engine.Gates.Hooks.AppSecTermination`.

Finished successfully, `run_appsec_design/3`
(`secops_agent_server.ex:234`) emits `artifact.threat_model`
(`storyId`/`threatModel`/`requisitosDeSeguranca`/`riscos`, schema in
`apps/engine/lib/engine/harness/artifact_schemas.ex:71` — `riscos` stays out
of the required keys because an empty list is a valid answer). Failure
(iteration ceiling, budget, or the model stopping without calling
`emit_threat_model`) becomes a durable `agent.error` with origin
(`modelo`/`politica`/`infra`), same ruler as RN-059 — never an empty response
nor silence only in broadcast.

**The automatic trigger exists since [RN-539](#rn-539)**. This delivery was
kept self-contained on purpose (no file of another front touched:
`decide.ts`, `docs/gates.yml`, and `dev_lead_tools.ex` untouched), and declared the
gap: `run_design/2` was TRIGGERABLE and nothing triggered it on its own. The trigger
point it named — the Dev Lead's `assess_implementability`, front
`qa-estrategia`, gate `implementavel`, same ADR 0090 — became the
real caller, in parallel and only once per story.

- **Where:** `apps/engine/lib/engine/gates/secops_agent_server.ex` (`run_design/2`,
  `handle_cast/2`, `run_appsec_design/3`, `emit_threat_model/3`,
  `emit_bloqueio_appsec/3`); `apps/engine/lib/engine/gates/appsec_agent.ex`;
  `apps/engine/lib/engine/gates/appsec_context_builder.ex`;
  `apps/engine/lib/engine/gates/tools/emit_threat_model.ex`;
  `apps/engine/lib/engine/gates/hooks/appsec_termination.ex`;
  `apps/engine/lib/engine/harness/artifact_schemas.ex` (schema `threat_model`)
- **Test:** `apps/engine/test/engine/gates/appsec_agent_test.exs`,
  `apps/engine/test/engine/gates/appsec_context_builder_test.exs`,
  `apps/engine/test/engine/gates/secops_agent_server_test.exs` (the three
  `run_design` tests)
- **Origin:** [ADR 0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md)

### RN-361 — The completed threat model creates THREE handoffs, always addressing the LEAD {#rn-361}

`criar_handoffs_appsec/3` (`secops_agent_server.ex:326`) creates one handoff per
target declared in `docs/fluxo.yml` (`saidas` of `appsec`): arquiteto,
dev-lead, and infra — same pattern as
`OfferInfraHandoffUseCase`/`ArquitetoServer.executar_offer_infra_handoff/1`
(SEPARATE calls, one per target, so that one handoff failure doesn't undo the
other two already created). The flow id is `area-infra`, but the addressable
AGENT is `"infra"` (`apps/api/src/domain/agents/agent-areas.ts` —
`lead: 'infra'`), never `area-infra`: an external handoff addresses only the area's
LEAD (ADR 0038), and `CreateHandoffUseCase.assertHandoffTargetAllowed`
would refuse a `toAgent` that doesn't resolve to a lead/agent-with-no-area. Failure of ONE
target becomes an `agent.error` narrated per target (RN-116) — the other two handoffs
already created are not undone.

**Since [RN-636](#rn-636) the three are ASKED, no longer always
created:** a destination that already has a pending offer or is already active in the project doesn't
get another one, and that isn't a failure.

- **Where:** `apps/engine/lib/engine/gates/secops_agent_server.ex:55`
  (`@appsec_handoff_targets`), `:362` (`criar_handoffs_appsec/3`)
- **Test:** `apps/engine/test/engine/gates/secops_agent_server_test.exs`
  ("run_design: threat model concluído emite artifact.threat_model e cria
  os TRÊS handoffs")
- **Origin:** [ADR 0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md)

---

## "N agents online" on the dashboard — LIVE status, never historical presence (RN-409, ADR 0097)

### RN-414 — `rag_search`: agents get the tool the product had never exposed {#rn-414}

`grep -rn "rag" apps/engine/lib` gave ZERO occurrences before this
delivery — the complete RAG (pgvector, hybrid search) was only consumed by the
"Chat RAG" web tab. The new tool `rag_search`
(`apps/engine/lib/engine/harness/tools/rag_search.ex`, category
`:direct`, reading isn't an external effect) calls `POST /internal/rag/search`
— a new route that REUSES `HybridSearchUseCase` without duplicating the search
logic — and returns hits formatted with citation (`path` + excerpt), always
with `degraded: true` visible at the START of the text when embedding wasn't
available (never hidden by the ceiling cut).

Its own ceilings, in the spirit of RN-150: `top_k` clamped to 10 within the
tool itself (it doesn't trust what the api would accept), a 16 KiB ceiling on the formatted
text (smaller than the 32 KiB of `search_workspace`/`read_file` — each
RAG hit is already a whole chunk+excerpt). A network failure becomes an error readable
by the model, never a `ToolLoop` crash (RN-163).

Registered in `Engine.Harness.Tools` (PO/Arquiteto/conversational) and
`Engine.Dev.Tools` (dev agent); also extended to the read gates that
already cite indexed ADRs/conventions (QA-automation, QA-strategy, AppSec,
QA-performance/security) — not to `Infra.WorkflowsAgent` nor
Psicólogo/Anamnese, which reason over the event log, not over the project's docs/code.

- **Where:** `apps/engine/lib/engine/harness/tools/rag_search.ex`;
  `apps/engine/lib/engine/sessions/engine_api_client.ex` (`rag_search/4`);
  `apps/api/src/interfaces/http/internal/internal-rag.controller.ts`
- **Test:** `rag_search_test.exs` (hits formatted with citation;
  visible degradation; network failure without crash; byte ceiling truncating
  with a clear mark; `top_k` clamp); `engine_api_client_rag_test.exs`
- **Origin:** see [ADR 0100](../adr/0100-rag-search-e-modelos-garantidos-no-boot.md)

---

### RN-417 — Psicólogo and Anamnese query by relevance, with declared degradation to recency {#rn-417}

`Psychologist.ContextBuilder`/`Anamnese.ContextBuilder` keep reading what
they always read (recent events / time window), and gain a
SECOND source, `EngineApiClient.rag_search/4`, with a query derived from the
analysis's TRIGGER — the already classified termination cause, in the Psicólogo;
catalog competencies still without `current_profile`, in the Anamnese
(NEVER free text of a hypothesis/rationale, by the already established prohibition
on the Anamnese ever inferring health/personality/age/gender — the query
only contains competency/member/project names). The hits enter the
EXISTING `Triage` budget (`max_prompt_events`/`max_payload_chars`)
— they take slots from the recents window, never adding outside it.

The RAG call is strictly ADDITIVE: with no hit (RAG unavailable, error,
or simply no result), the behavior is IDENTICAL to before
this RN — no pre-existing test needed to change. `degraded: true`
(RAG fell back to lexical-only for lack of embedding) appears EXPLICITLY
in the final context, in both agents — never hidden by the ceiling
cut.

The kickoffs of the Psicólogo (`psychologist-kickoff`) and the Anamnese
(`anamnese-kickoff`) now resolve as a graph TEMPLATE
(`EngineApiClient.get_prompt_template/2`) when `graph_templates_enabled?`
is on (`GRAPH_TEMPLATES_ENABLED`, default `false`) — with a mandatory
fallback to the inline text on any failure (api down, template not
seeded, flag off). `:pinned => true` stays the same on both
paths.

The THIRD consumer of the same flag is the `ContextManager`'s summarization prompt
(`context-manager-summarize`, the fourth and last template of the
[RN-413](infra.md#rn-413) batch — it was the only one still without a consumer, a gap that
[ADR 0101](../adr/0101-memoria-relacional-como-projecao-do-event-log.md)
declared open and that closes here). Same ruler, byte for byte: flag on
tries the template and replaces `{{turnos}}` with the SAME `<role>:
<content>` body the inline path already built; any outcome that isn't
`{"body" => corpo}` with a non-empty binary body falls to the inline — WITHOUT an error and
WITHOUT an error log, because flag off, template not yet seeded, and the graph
api down are the SAME degradation path. With the flag off (the
default) the api isn't even called. The render is its OWN private function, not a
shared helper: the set of placeholders belongs to the template, not to the
mechanism — each of the three consumers has its own. And the deterministic
fallback for when the MODEL fails (`"(N turnos anteriores
omitidos)"`) is something else and does NOT go through any template: it's code
behavior, not prompt text, and the template's own `.md` declares so.

> **Since [RN-621](#rn-621)** the summary prompt, on both paths, asks that
> each turn keep its original language and that quotation and code not be translated;
> the versioned template went up to version `"2"`.

**Consumption of the rest of the graph (`query_user_context` — hypotheses with
evidence and profiles read DIRECTLY from Neo4j) stays DECLARED out of this
delivery**: still with no exposed HTTP route on the api side; Psicólogo/Anamnese
today only query RAG (pgvector) via `rag_search`, not the relations
graph itself.

- **Where:** `apps/engine/lib/engine/psychologist/context_builder.ex`,
  `apps/engine/lib/engine/workers/psychologist_worker.ex`;
  `apps/engine/lib/engine/anamnese/context_builder.ex`,
  `apps/engine/lib/engine/workers/anamnese_worker.ex`;
  `apps/engine/lib/engine/harness/context_manager.ex` (`prompt/1`,
  `render_template/2`, `prompt_inline/1`)
- **Test:** `context_builder_test.exs` of both agents (hits present;
  RAG failure degrades without error; `degraded: true` visible; `top_k`
  clamp; query derived from the trigger); `psychologist_worker_test.exs`/
  `anamnese_worker_test.exs` (template with success and with fallback;
  `:pinned` identical on both paths; flag off never calls the api);
  `context_manager_test.exs` (template with `{{turnos}}` replaced;
  `{:error, :not_found}` falls to the inline and compaction ends normally;
  flag off never calls `get_prompt_template`)
- **Origin:** see [ADR 0101](../adr/0101-memoria-relacional-como-projecao-do-event-log.md)

---

### RN-419 — The local runner authenticates with a single-use ticket, scoped to project and role {#rn-419}

**REVISED by [RN-421](api.md#rn-421) (ADR 0104)**: the ticket's refusal condition
cited below (`workspaceMode !== 'local'`) became `executionMode
!== 'runner'` — same ruler, new name. The rest of this entry still
holds as is.

The `terminal:<projectId>` channel (new Phoenix socket, `/runner`) receives
two distinct roles — `:runner` (the CLI on the user's machine, at
most ONE per project, exclusivity guaranteed by
`:global.register_name/3`) and `:web` (the Terminal tab, multiple
simultaneous) — and both come in authenticated by a SINGLE-USE TICKET,
the same security pattern as RN-108 (session socket ticket), with an
ownership inversion: the ticket is ISSUED BY THE ENGINE
(`runner_socket_tickets`, schema `"engine"`, its own Ecto migration — not
an extension of the session ticket table, which belongs to the api), and the API requests it
via a new internal HTTP route (`POST /internal/projects/:projectId/runner-tickets`)
— the inverse of the session ticket flow, where the api writes directly into its
own table.

`POST /projects/:projectId/runner-ticket` (role `developer`+, refuses if
`workspaceMode !== 'local'`) and `POST /projects/:projectId/terminal-ticket`
(role `viewer`+, any mode) are the two public routes that issue the
ticket to the right client — the runner asks for the first, the web asks for the
second. The ticket is consumed (validation + single-use conditional `UPDATE`)
at the channel's `join`; a ticket from ANOTHER project or reused never opens
the topic.

- **Where:** `apps/engine/lib/engine/runners/socket_ticket.ex`,
  `apps/engine/lib/engine/runners/registry.ex`,
  `apps/engine/lib/engine_web/channels/{runner_socket,terminal_channel}.ex`;
  `apps/api/src/interfaces/http/runner/runner-tickets.controller.ts`,
  `apps/api/src/application/use-cases/runner/request-runner-ticket.use-case.ts`
- **Test:** `runner_socket_test.exs`/`terminal_channel_test.exs` (join
  with a valid ticket succeeds; reused ticket refuses; a ticket from another
  project doesn't open the wrong topic; a second `:runner` on the same project is
  refused; a second runner manages to connect after the first
  drops); `request-runner-ticket.use-case.spec.ts`/
  `runner-tickets.controller.spec.ts` (refuses for a non-`local` project on the
  runner ticket; the terminal ticket works for any mode)
- **Origin:** see [ADR 0103](../adr/0103-runner-local-execucao-na-maquina-do-usuario.md)

---

### RN-420 — An agent command routed to the runner goes through the SAME approval pipeline; PTY is a user action, audited {#rn-420}

**REVISED by [RN-423](runner.md#rn-423) (ADR 0104)**: the condition to route
is no longer binary. `workspace_mode == "local"` became `execution_mode ==
"runner"` **AND** non-null `workspace_verified_at` **AND** runner connected —
missing any of the THREE, the command is explicitly REFUSED, never
falling into the `System.cmd`/bind-mount of `mounted` (which doesn't exist for a
`runner` project, with no bind-mount at all). The rest of this entry — the usual
approval pipeline, PTY as a user action — still holds as
is.

`Engine.Actions.TerminalExecutor` decides to route a command to the runner (instead
of the usual `System.cmd`, inside the container) **AFTER** the
normal pipeline (`decide()`/`proposed_action`) has already approved — routing
is only a choice of DESTINATION for the same already authorized command, never a
second execution path escaping the policy (which keeps the
absolute ceilings of RN-418 applying the same, sudo/git included). Condition
to route (history, see revision above): `workspace_mode == "local"` AND
runner connected (`Engine.Runners.Registry.connected?/1`) — without either
of the two, the usual behavior continues (`System.cmd` in the
container via bind-mount, ADR 0072 becomes the FALLBACK, never removed).

Interactive PTY is DIFFERENT: it's an action of the authenticated USER typing in the
terminal of their own machine, not the agent's — that's why it does NOT go through
`proposed_action`. But it needs to leave a trace: `pty_open`/`pty_close`
coming from the web emit `terminal.session.started`/`terminal.session.ended`
in the event log (addressed to the project's most recent session,
`ProjectSession.latest_id/1`, the same mechanism the Anamnese already uses to
narrate something project-scoped). A real finding during consolidation: with no runner
connected, the web needs an EXPLICIT `pty_error` back — discarding
the request with only a log on the server would leave the tab stuck in "loading"
forever, never reaching the "no runner" state the screen already knew how
to show.

- **Where:** `apps/engine/lib/engine/actions/terminal_executor.ex`,
  `apps/engine/lib/engine/runners/runner_router.ex`,
  `apps/engine/lib/engine_web/channels/terminal_channel.ex`
- **Test:** `terminal_executor_test.exs` (routes to the runner with
  `local` mode + runner connected; `cwd` is passed along; falls to the current path
  without a connected runner; never routes in `container` mode);
  `terminal_channel_test.exs` (`pty_open` without a connected runner returns
  `pty_error` to the web, never stays without an answer)
- **Origin:** see [ADR 0103](../adr/0103-runner-local-execucao-na-maquina-do-usuario.md)

## The Runner's folder explorer becomes three columns, and creating a `runner` project no longer waits for the final step (RN-436/436)

### RN-454 — The Insights tab knows the Psicólogo is paused BEFORE the user runs into the 503 {#rn-454}

Found by USE: the Insights tab, with zero hypotheses, showed "No hypotheses
yet — the Psicólogo analyzes each closed session" even with
`PSYCHOLOGIST_ENABLED=false` — the same sentence that appears when the Psicólogo
is ACTIVE and just hasn't run yet. The two situations are indistinguishable by the
text, which is the same class of defect RN-088/RN-107 already closed
for other screens: a state that exists and that the product knows, but doesn't show.

[RN-117](#rn-117) already covered discovering the pause, but only on the CLICK of
"Reanalyze" (503 → `PsychologistDisabledError`) — and that button only exists
in the analyses strip, which only appears when `runs.length > 0`. A session
with no hypothesis at all never gets near it, so the pause was invisible
precisely on the empty screen.

`GET /internal/psychologist/status` (engine, `PsychologistCommandController.status/2`)
is a pure read of `PsychologistWorker.enabled?/0` — WITH NO side effect,
unlike `/reanalyze`, which creates a job when enabled. The api exposes
`GET /projects/:projectId/psychologist/status` (`GetPsychologistStatusUseCase`,
`role:viewer`) on top of that — the project in the URL only for consistency with the
sibling routes (`hypotheses`, `psychologist/analyses`); the flag itself is GLOBAL,
as RN-117 already records. `ProjectInsightsTab.tsx` consumes that read
(`usePsychologistStatus`) and chooses the empty state's sentence by it: paused
shows "The Psicólogo is paused — no session is analyzed until it's
reactivated" (`insights.projectInsightsTab.emptyPaused`); otherwise, it keeps
the original sentence, which IS honest when the feature is indeed active. The
persistent warning (`pausedNotice`) and the "Reanalyze" buttons also
now reflect that proactive read, and not only the `useState` discovered
by the 503 — which still exists, as reinforcement, for the rare case of the
flag changing IN FLIGHT between the status read and the click.

- **Where:** `apps/engine/lib/engine_web/controllers/psychologist_command_controller.ex`
  (`status/2`), `apps/engine/lib/engine_web/router.ex`
  (`GET /internal/psychologist/status`),
  `apps/api/src/application/ports/api-to-engine-client.port.ts`
  (`getPsychologistStatus`),
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`,
  `apps/api/src/application/use-cases/execution/get-psychologist-status.use-case.ts`,
  `apps/api/src/interfaces/http/psychologist/psychologist.controller.ts`
  (`status`), `apps/web/src/lib/api-client.ts` (`getPsychologistStatus`),
  `apps/web/src/lib/hooks.ts` (`usePsychologistStatus`),
  `apps/web/src/routes/ProjectInsightsTab.tsx`
- **Test:**
  `apps/engine/test/engine_web/controllers/psychologist_command_controller_test.exs`
  (`status/2`, `enabled: true`/`false`),
  `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts`
  (`getPsychologistStatus`),
  `apps/api/test/application/use-cases/execution/get-psychologist-status.use-case.spec.ts`,
  `apps/web/src/routes/ProjectInsightsTab.test.tsx`
- **Edge case:** the flag remains GLOBAL (see RN-117) — the api route accepts
  `projectId` in the URL only to match the pattern of the controller's sibling
  routes, and not because the response varies per project.
- **Origin:** found by real USE navigating the Insights tab with
  `PSYCHOLOGIST_ENABLED=false`, not a script. No ADR — a one-off extension of the
  already existing read mechanism of RN-117, the same pattern as RN-088/
  RN-107 for the rest of the product.

---

## An attached local folder becomes the fourth scope of the RAG index, read by the BROWSER (RN-455..457, ADR 0113)

### RN-459 — The iteration ceiling no longer ends silently in four of the six conversational agents {#rn-459}

Found during the investigation of the turn activity strip (RN-460):
`arquiteto_server.ex`, `dev_lead_server.ex`, `ux_designer_server.ex`, and
`staff_server.ex` ended SILENTLY when the iteration ceiling overflowed
(`defp run_turn(state, remaining) when remaining <= 0, do: state`, with no
event at all) — contradicting the permanent rule that an agent loop
doesn't end silently. Only the PO already emitted `toolloop.limit_reached`
(RN-166); the Criativo deliberately diverges with `agent.error` (`reason:
"limite_de_iteracoes"`, a decision documented in the code itself — reusing the
`ToolLoop`'s name would lie about who produced the event) and wasn't
touched. The four fixed ones now emit `toolloop.limit_reached`
(the same event as the PO, the same `iteration`/`max_iterations` payload) before
returning — no change in the structure of each one's `dispatch_tool`.

- **Where:** `apps/engine/lib/engine/agents/arquiteto_server.ex:195`,
  `dev_lead_server.ex:244`, `ux_designer_server.ex:121`,
  `staff_server.ex:113`
- **Test:** `apps/engine/test/engine/agents/{arquiteto,dev_lead,
  ux_designer,staff}_server_test.exs` ("teto de iterações emite
  toolloop.limit_reached")
- **Origin:** found by a complete reading of the six servers, during the
  implementation of RN-460; scope extended by the product owner's
  decision

## RAG search leaves a trace, and the trace freezes the weights (RN-479..481)

### RN-492 — The dev agent's terminal command runs INSIDE the real container, when there is one {#rn-492}

`Engine.Actions.TerminalExecutor.decisao_de_execucao/1` gains the FIFTH output
(`:executar_no_container`): a project in `execution_mode: container` with a
REGISTERED `running` row in `project_containers`
(`Engine.Containers.ProjectContainerLifecycle.running?/1`, a direct read-only
read of the table, the same pattern as `Engine.Projects.Project`). Before this
rule, even with a container up (RN-491), EVERY terminal command
ran via `System.cmd` in the engine's process, against the shared folder
— the container sat idle.

The command crosses engine → api → broker
(`POST internal/projects/:projectId/container-exec`,
`ExecutarComandoNoContainerUseCase`, `ContainerBrokerPort.exec`) and runs via
`docker exec`. `cwd`, when present, is TRANSLATED from the HOST path (inside
`PROJECT_WORKSPACES_ROOT`) to inside `/work` — the only directory
the container sees — swapping the prefix `<project_workspaces_root>/
<workspace_dir_name>` for `/work` and preserving the suffix (a dev agent's
individual worktree, `.worktrees/<agent_id>`, included). The worktree
itself doesn't change place nor creation mechanism: `Workspace.ensure!/4`
keeps writing in the SAME physical directory the broker mounts at `/work`
(verified in code: the broker's `raizDoProjeto` and the engine's `PROJECT_WORKSPACES_ROOT`
resolve the same folder, via `workspace_dir_name`, RN-109) — the
container is just one more observer of it.

**REGISTERED `running` never confirms the container is REALLY up
now (RN-486).** If it died or was removed from outside between the record and
this call, `broker.exec` fails and becomes a NORMAL `failed_result` — exit_code
`nil`, a message naming the reason — never a crash, never a silent fallback
back to `System.cmd` outside the container (that would reopen the
isolation vector this rule exists to close). `mounted` never falls into this
output: the broker refuses to bring up a container for that mode
(`ModoDeExecucaoNaoSuportadoError`).

- **Where:** `apps/engine/lib/engine/actions/terminal_executor.ex`
  (`decisao_de_execucao/1`, `run_no_container/4`, `cwd_para_container/2`),
  `apps/engine/lib/engine/containers/project_container_lifecycle.ex`,
  `apps/engine/lib/engine/sessions/engine_api_client.ex`
  (`executar_comando_no_container/4`),
  `apps/api/src/interfaces/http/internal/internal-projects.controller.ts`
  (`POST :projectId/container-exec`),
  `apps/api/src/application/use-cases/containers/executar-comando-no-container.use-case.ts`,
  `apps/api/src/application/ports/container-broker.port.ts` (`exec`,
  `timeoutMs`)
- **Test:** `apps/engine/test/engine/actions/terminal_executor_test.exs`
  (the five outputs of `decisao_de_execucao/1`; `cwd` translation at the root and
  in a worktree; `sucesso: false` and a transport failure become `failed_result`;
  a container without a `running` row/in `stopped` falls to the usual path),
  `apps/api/test/application/use-cases/containers/executar-comando-no-container.use-case.spec.ts`
  (`BrokerRecusouError`/`BrokerIndisponivelError` never propagate; another error
  propagates),
  `apps/api/test/infrastructure/http-clients/container-broker.client.spec.ts`
- **ADR:** [0130](../adr/0130-broker-de-container.md), [0134](../adr/0134-dev-agents-executam-dentro-do-container.md)
- **Origin:** the product owner's plan, Part 1 / PR 1.6

### RN-502 — A dev agent only claims a task with a `running` container, and the terminal no longer falls outside it {#rn-502}

Two halves of the same rule: **without an execution environment, the dev agent doesn't
start**, and **without an execution environment, the command doesn't run anywhere**.

**The claim guard.** `Engine.Dev.AgentIo.try_claim/2` — the SINGLE claim
point — queries
`Engine.Containers.ProjectContainerLifecycle.running?/1` BEFORE calling
`claim_task/1`. Without a REGISTERED `running` row in `project_containers`
([RN-243](api.md#rn-243)/ADR 0081), the agent falls into `:idle`, persists, emits
`dev.blocked_by_container`, and **doesn't call the api**. The guard comes before the claim
on purpose: claiming only to give it back right after would leave the task
marked and with no live owner, which is the state `block_task/4` exists to never
produce.

**`:idle`, and not a new status.** It's the only state from which a wake still
rescues — the guards of `handle_info/2` all match it
(`{:wake, :became_claimable}` requires `:idle`, `:rearm` requires `:idle_tripped`,
`gate_resolved` requires a matching `task_id`,
[RN-047](#rn-047)). An invented
`:blocked_by_container` would be a state from which nothing rescues.

**In the ENGINE and not only in the api's `activate-execution`**, because the claim has a
path no route covers: REHYDRATION. `Engine.Dev.DevRehydrator` doesn't
cast `:work`; whoever claims after a restart is `DevAgentServer.init/1`
→ `finish_restart_recovery/1` → `try_claim/2`. A gate only at the HTTP boundary
would let every rehydrated agent go back to work without a container.

**The wake.** A read doesn't notify anyone: an already stopped agent would stay stopped
until an unrelated event passed nearby. So arriving at `running`
PUBLISHES — `RegistrarTransicaoDeContainerUseCase` writes the row and the event in the
SAME transaction, `aggregateType: 'container'` (the third aggregate that
`Engine.Outbox.Drain` now drains, alongside `session` and `task`),
`aggregateId` = the PROJECT. `Engine.Workers.DevAgentWakeWorker` delivers
`{:wake, :became_claimable}` to ALL agents of the project
(`DevAgentState.list_by_project/1` — the container belongs to the project, not to a
module). It's the SAME message that already existed, not a new one: its
semantics are already "there may be work now", and an own message would require a
new `handle_info/2` clause in both servers with a guard identical to the one that already exists.
Only `running` publishes; `provisioning`/`stopped`/`failed`/`removed` release
nobody.

**The second half: the terminal.** `Engine.Actions.TerminalExecutor`
degraded silently — `container` without a `running` container fell into
`:caminho_de_sempre`, that is, `System.cmd` INSIDE the engine's process, the
same one that talks to the database, the api, and all the other projects. ADR
0134 ([RN-492](#rn-492)) had closed isolation only on the happy path.
Now it refuses (`:recusar_container_ausente`), mirroring the
`:recusar_nao_verificado`/`:recusar_runner_desconectado` that `runner` mode
already had ([RN-423](runner.md#rn-423)), and as a normal `failed_result` — never a crash.
`mounted` enters the SAME branch: with a `running` container it goes through to the broker
like `container`; without it, it refuses. The `:caminho_de_sempre` catch-all
shrinks to what it should always have been on its own — **nonexistent project or
malformed `project_id`**. No execution mode falls into it.

**Declared consequence:** a project without a container up stops working, and
says why. It's deliberate — it's what the rule exists to do — and that's why
it can only come in AFTER the changes that give a container to
`mounted` mode.

- **Where:** `apps/engine/lib/engine/dev/agent_io.ex` (`try_claim/2`),
  `apps/engine/lib/engine/actions/terminal_executor.ex`
  (`decisao_de_execucao/1`),
  `apps/engine/lib/engine/outbox/drain.ex`,
  `apps/engine/lib/engine/workers/dev_agent_wake_worker.ex`,
  `apps/api/src/application/use-cases/containers/registrar-transicao-de-container.use-case.ts`
- **Test:** `apps/engine/test/engine/dev/claim_com_container_test.exs` —
  an initial `:work` without a container falls into `:idle`, persists, emits, and does **not**
  call the api; the Noop goes through the same guard; a REHYDRATED agent stops at
  `:idle` without claiming; `container.running` in the outbox goes through
  drain → worker → wake → agent and it re-claims; and the usual path
  stays intact with a `running` container.
  `apps/engine/test/engine/actions/terminal_executor_test.exs` — refusal for
  `container` (no row and with `stopped`) and for `mounted`; `mounted` with
  `running` goes through to the broker; only a nonexistent project falls into
  `:caminho_de_sempre`.
  `apps/api/test/application/use-cases/containers/ciclo-de-vida-do-container.use-case.spec.ts`
  — `running` publishes `container.running` on the `container` aggregate; the other
  destinations and the row's creation publish nothing
- **ADR:** [0143](../adr/0143-agentes-de-dev-so-depois-do-container.md)
- **Origin:** the plan "Name and location on the same screen, and container before the dev
  agents" (PR 7) — ten tasks of `exp001` locked up at once because nothing
  ordered the container before the dev agent

---

## The conversational agents' decision artifact (RN-505)

### RN-505 — `decision_record` reuses the GENERIC pattern of `emit_artifact`, not the dedicated one {#rn-505}

A conversational agent that makes a relevant decision in a conversation (why
it chose X and not Y, what it considered, what it accepted to lose) records it
with `emit_artifact` and `type: decision_record` — a payload with `context`,
`options` (list), `choice`, and `consequences`, the four mandatory keys
in `Engine.Harness.ArtifactSchemas` (`artifact_schemas.ex:82`), tool-emittable
since it entered `@tool_emittable` (`artifact_schemas.ex:98`). **No
cross validation on purpose:** `choice` doesn't need to match an item of
`options` — free text is more robust, and the generic schema only validates
key presence (the same ruler as `note`/`business_rule`).

**Why reuse the GENERIC pattern instead of the dedicated one.** `artifact.project_image`
and `artifact.c4_diagram` (neighboring RNs of this one) are VERSIONED artifacts — each
emission replaces the previous one as "current", with its own HTTP read route
and a dedicated TypeScript schema in the api. A decision isn't like that: it's an
append-only record by nature, not a "current" that gets replaced — the same
reasoning that already holds for `note`/`business_rule`. Paying the price of the
dedicated pattern (TS schema, versioning, new route) for a log that only needs to
exist and be searchable in the session's event log would cost structure the
decision doesn't ask for.

**Declared distinction from `open_adr_pr` (only the Arquiteto has it).** The two
COEXIST, with different purposes: `decision_record` is for EVERY relevant
decision of any of the six conversational agents, with no friction at all —
it never commits a file, never opens a PR, never waits for human approval.
`open_adr_pr` is for when the decision is big enough to become a real
DOCUMENT in `docs/adr/*.md`, with a real PR and mandatory human
approval. A project can have ten `decision_record` and zero ADR in one
session — the second isn't the "serious" version of the first, it's another tool
for another scale of decision.

**Wiring in the five conversational agents that didn't have `emit_artifact` yet** —
PO (`po_server.ex:115`), Arquiteto (`arquiteto_server.ex:103`), Dev Lead
(`dev_lead_server.ex:153`), UX Designer (`ux_designer_server.ex:94`), and Staff
(`staff_server.ex:94`); the Criativo already had the tool since Phase 3b, it only
gained the new type (it's the shared `known/0` that decides, with no change to
`CriativoServer`). In each one, the common `run_tool/3` gained the clause
`"emit_artifact" -> EmitArtifact.run/2` (e.g. `po_server.ex:279`) — **with no
special handling**: unlike `propose_execution_plan`/
`assess_implementability` in the Dev Lead (which suspend the turn waiting for
approval, ADR 0086), `emit_artifact` never returns `{:pending, _}`, so it
enters the common dispatch without needing the `reduce_while` those two
tools require. And the five gained the SAME sentence in `system_prompt/1`
(e.g. `po_server.ex:463`) explaining when to use `type: decision_record` —
outside the identity text (`Engine.Harness.Agents`) because it isn't about
WHO the agent is, it's an operational instruction about a tool.

**Out of scope, declared.** Execution agents (QA, SecOps, module Dev
Agent) run on `ToolLoop`, with no harness common to the six conversational ones —
they're left out of this slice, with their own per-module investigation before
extending. Tying it to Front 1 of the same plan (the Infra
Lead's dispatch emitting a server-emitted `decision_record` when it proposes bringing up a
container via runner) is also left out: it depends on a tool
(`propose_container_start_via_runner`) another PR is creating in
parallel — see the TODO in this change's PR.

- **Where:** `apps/engine/lib/engine/harness/artifact_schemas.ex` (schema +
  `@tool_emittable`); `apps/engine/lib/engine/agents/po_server.ex`,
  `arquiteto_server.ex`, `dev_lead_server.ex`, `ux_designer_server.ex`,
  `staff_server.ex` (alias + `tool_specs` + `run_tool/3` +
  `system_prompt/1`)
- **Test:** `apps/engine/test/engine/harness/artifact_schemas_test.exs`
  (`describe("decision_record …")`);
  `apps/engine/test/engine/agents/po_server_test.exs` and
  `arquiteto_server_test.exs`
  (`describe("Frente 3 do plano de decision_record — emit_artifact")`)
- **Origin:** the product owner's plan, Front 3 ("Decision artifact")

---

## The local agent's `join` stops being mute (RN-514)

### RN-514 — The runner DECLARES what it can do on `join`, the server GRANTS the intersection in `socket.assigns`, and a message without the capability is REFUSED instead of vanishing {#rn-514}

Until now the `join` of the `terminal:<projectId>` channel was **mute on both sides**:
the runner sent `socket.channel(\`terminal:${projectId}\`, {})` and the server
literally ignored them (`def join("terminal:" <> project_id, _params,
socket)`). The whole identity came from the ticket — the role (`:runner`/`:web`) comes
from the `kind` —, and the server **had no way of knowing** whether the binary on the other side
was from a version that understands a new message.

The defect this produces is the worst possible one, and it is what this rule closes: the
message arrives, the handler does not exist on the other side, and **nothing happens** — no
error, no log, nobody knowing that the function never ran.

**Three capabilities, and only what the runner can do is declared.** The
server's vocabulary is `exec` (approved command, ADR 0104), `pty`
(interactive terminal, ADR 0103) and `espelho` (copying the work to a folder
outside the mounted base). The runner declares **`exec` and `pty`**, and `espelho` is left
out **on purpose**: declaring what is not implemented is exactly the
defect the negotiation exists to prevent — the server would grant it,
deliver the message, and it would vanish just the same. `espelho` is born only as a
**name in the vocabulary**, with no behavior at all; whoever implements it is
session 6 of PHASE 28.

**Absence of params is the LEGACY, and that is a fact — not benevolence.** Every
binary prior to this change sends empty params, and every binary prior
to this change can do `exec` and `pty`: they are the two functions the
runner was born with. Granting `{exec, pty}` to whoever declares nothing is reading
correctly the only thing that binary could have said. The opposite
would make **every installed runner stop connecting**, which is a change requiring
operator action before deploy — `breaking/` and MAJOR, by the repository's
convention, and that is not what this delivery is. Absent params, absent `capacidades`,
an **empty** list and a value that is not a list all fall into the legacy: they are the
shapes that "this binary cannot declare anything" takes on the network path.

**Unknown is IGNORED, never a reason for refusal.** The granted set is the
intersection of what was declared with the vocabulary that **this** server knows —
a runner NEWER than the engine has to be able to connect. Declaring
**only** unknown names, however, is an empty declaration, not legacy: whoever can
declare said what it can do.

**What each mode REQUIRES.** `runner` requires `exec` — it is literally what makes the
mode work, and without it the `TerminalExecutor` would route an approved command to
a binary that does not execute it, with the failure showing up as a *timeout* instead of a
refusal. `container` and `mounted` require nothing (the runner is not even their
execution path). **Nothing requires `espelho` yet** — the refusal mechanism is born
implemented and tested, and does not fire in practice today. That is the design, not
a pending item. A mode that could not be read (nonexistent project, malformed id,
failed query) requires **nothing**: refusing on an unconfirmed precondition
would be collapsing "I don't know" with "it doesn't have" ([RN-088](web.md#rn-088)).

**The granted set lives in `socket.assigns`, never in a table.**
A capability is a property **of that connection** — a table could claim that
a runner knows something the process connected now does not. It is the same
reasoning that makes the `:global` entry of `Engine.Runners.Registry` die
together with the pid. Only the `:runner` role receives a set: the `:web` socket **does not
get `:capacidades`** and no capability check applies to it — the
tab executes nothing, it asks.

**A join refusal names the one missing.** `{:error, %{reason: ...}}` saying
which capability the project requires and that the binary needs to be updated. The
refusal is **fatal on the runner side**, with no retry (`JoinRecusadoError`,
behavior that already existed and did not change) — that is why it is the only chance to
explain, and "refused" without the name of what is missing would force guessing. The
check happens **before** `Registry.register/2`: registering and then refusing
would leave the `Registry` asserting a runner that did not get in.

**And the half that delivers value today: a message without the granted capability is
REFUSED with a named reply, never swallowed.** `exec` to a runner without
`exec` answers the caller in the **same `exec_result` format** that the
runner would send (`exitCode` 126 — "found, but not executable" —, the cause
in `output`), instead of leaving the `RunnerRouter` blocked until the `receive ...
after` and the user seeing a *timeout* in place of the cause. `pty_*` to a runner
without `pty` is not relayed, and the originating `:web` receives a named `pty_error`,
through the same filtered broadcast the runner would use to report a PTY error —
without it the tab would stay "loading" forever, the defect that the `whereis`
of `handle_in("pty_open", ...)` had already closed for the "no runner" case.
Since the legacy has both capabilities, **nothing changes for anyone today**.

**This is not a security boundary.** A capability is a **protocol**
negotiation; what authorizes is still the single-use ticket
([RN-108](web.md#rn-108)) and the
`proposed_action` pipeline. What the runner gains by declaring is that messages of that
type are **delivered** to it, never permission for anything.

- **Where:** `apps/engine/lib/engine/runners/capacidades.ex` (new — the
  vocabulary, the legacy, what each mode requires and the two messages);
  `apps/engine/lib/engine_web/channels/terminal_channel.ex:208`
  (`join/3` now receives `params`), `:215` (`autorizar_por_papel/3`),
  `:251` (`entrar_como_runner/3`, the grant before the `Registry`), `:305`
  (`exigencias_do_projeto/1`, which was `modo_de_execucao/1` until RN-516 made the same query also answer the mirror destination), `:595` (the `exec` gate in
  `handle_info({:dispatch_exec, ...})`) and `:762` (the `pty` one in
  `handle_info({:relay, "pty_" <> _, ...})`);
  `apps/runner/src/channel.ts` (`CAPACIDADES_DO_RUNNER` and the params of
  `socket.channel/2`)
- **Test:** `apps/engine/test/engine/runners/capacidades_test.exs` (new — the
  pure vocabulary: legacy, empty list, unknown ignored, what each
  mode requires, and that nothing requires `espelho`);
  `apps/engine/test/engine_web/channels/terminal_channel_test.exs`
  (`describe "capacidades declaradas no join (ADR 0147 ponto 1, RN-514)"` —
  grant in `assigns`, join without params, unknown ignored, `:web` without
  a set, the refusal naming `exec` in a `runner` project, and the two
  refused messages with a reply instead of silence);
  `apps/runner/src/channel.spec.ts` (the CONTENT of the join params, `espelho`
  out of the list, and the refusal becoming `JoinRecusadoError` with the server's
  message readable)
- **ADR:** [0147](../adr/0147-agente-local-com-capacidades.md), point 1
- **Origin:** PHASE 28, session 5

---

## The agents' artifacts become files, in `docs/` (RN-523)

### RN-523 — The `docs/` folder is a PROJECTION of the event log: derived, per agent, and never a source of truth {#rn-523}

Every artifact the agents produce lives **exclusively in the event log** —
`apps/engine/lib/engine/harness/tools/emit_artifact.ex:3-5` says literally
that *"there is no artifacts table"*. That stays right for the SOURCE, and this RN
does not touch it. What it closes is another hole: that memory did not reach
anywhere a person would open. Whoever opened the project folder in the editor
found nothing of the reasoning that produced the code. (The **postponed
provisioning** — creating a project no longer creating a repository, and git being born at the acceptance
of the handoff to the Dev Lead — opens an entire interval in which the project does not even have a
repository, and makes this folder even more necessary; it comes in its own PR, and
this RN does not depend on it.)

Each `artifact.*` event of an allowed type becomes a Markdown file in
`docs/<agente>/` inside the project's workspace. It is a **derived projection**, in the
same strict sense ADR 0101 gave the Neo4j graph: the source is the event, the
folder can be deleted entirely and rebuilt — since [RN-590](api.md#rn-590) via
`artefatos:reprojetar` —, and **nothing in the product reads from it** to decide anything
at all.

**The mechanism is that of `GraphProjector`, copied piece by piece** — its own
poller, public `drainOnce()`, a flag against overlapping cycles, batch of 50, and
`markProcessed` only after success. The outbox row is a THIRD one, written in the
same transaction as the event, under its OWN `aggregate_type`
(`artifact_projection`): `Engine.Outbox.Drain` only drains `session`, `task` and
`container`, and competing for the `'session'` row would mean losing the race against it
almost always. One deliberate difference from the graph: the `aggregateId` is the
**project**, not the session — the folder belongs to the project, and writing it there spares the
projector a query per artifact.

**The list is an ALLOWLIST.** A new artifact type is born outside the projection and
enters when someone decides it is a document, instead of showing up on its own
in a folder the user reads. Left out are `qa_verdict`, `secops_verdict`,
`task_blocked` and `infra_delegation_files`: they are OPERATIONAL outcomes, and a
per-task gate verdict would fill `docs/qa-lead/` with files nobody
opens, costing the folder the property that makes it useful — fitting in one glance.

**Versioned overwrites; append-only carries the `seq`.** The four types read by
reduction to the highest `version` (`module_map`, `module_routing`, `project_image`,
`c4_diagram`) always write the same file, and the folder shows the current one — the
history stays whole in the event log. The others become their own file with the
event's `seq` in the name, and **without it** two artifacts of the same type with the same
title would generate the same file, with the second erasing the first: the only
way for this projection to lose information the source has.

**Two barriers against the filesystem, and the second is not redundant.** The name
comes from the title the MODEL wrote. `slugDeArquivo` **derives** a name from a
closed alphabet (no return path lets a separator survive;
it returns `null` when nothing remains), and `FsArtifactFileStore` checks again
with `relative()` before opening. The two answer different questions — "what
name do I derive from this" and "what am I actually going to open" —, and trusting only the
first would make the safety of the write depend on no future change of
slug ever letting a separator through, which is the containment ADR 0130 refuses
on principle.

**The projection never takes down the source.** No throw escapes the cycle: each item
fails in isolation, is logged and stays `processed_at IS NULL` for the next
cycle. Unlike the graph, **there is no error here that stops the whole batch** —
a write failure tends to belong to the ITEM, and stopping the batch would block all those behind
it. An event that vanished from the event log is marked processed, not retried
forever.

**In `runner` mode the folder diverts to the managed root**, for the same physical
reason as `permissions.json` ([RN-478](api.md#rn-478)): what writes is the api, from
inside its container, and the runner's channel only carries commands, with no
primitive to write content. Declared cost: there `docs/` does not sit next to
the code.

**The write does NOT go through `proposed_action`**, and it is not an omission: that pipeline
is the origin of every external effect of an AGENT ASKING TO ACT, and here the
artifact has already been emitted and is already in the event log. Passing the projection through the queue
would fill approvals with routine decisions — one per artifact — and erode
the ceiling that gives the click its meaning on the actions that are real external effects.

- **Where:** `apps/api/src/domain/artifacts/artifact-projection-events.ts` (the
  vocabulary and the naming rules, pure);
  `apps/api/src/application/artifact-projection/artifact-projector.ts` (the
  poller); `apps/api/src/application/ports/artifact-file-store.port.ts` and
  `apps/api/src/infrastructure/filesystem/fs-artifact-file-store.ts` (the
  write, with the second barrier);
  `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`pastaDeArtefatosDoProjeto`, sibling of `permissionsFilePath`);
  `apps/api/src/application/use-cases/sessions/append-session-event.use-case.ts`
  (the third outbox row)
- **Test:** `apps/api/test/domain/artifacts/artifact-projection-events.spec.ts`
  (the naming rules, the traversal and the collision by `seq`) and
  `apps/api/test/application/artifact-projection/artifact-projector.spec.ts`
  (happy path, versioned overwriting, and the degradation: a failure leaves the
  row unprocessed, the next cycle retries, one failure does not block the
  batch, a vanished event is not retried forever, reprocessing is idempotent)
- **ADR:** [0148](../adr/0148-artefatos-projetados-em-arquivo.md)
- **Origin:** request of the product owner — *"criar apenas uma pasta por ora
  chamada docs, onde os artefatos estarão de cada um dos agentes"*

## Device key revocation stops being blind, and reaches the live connection (RN-519..520)

### RN-539 — `assess_implementability` triggers the DESIGN threat model in PARALLEL, and only once per story {#rn-539}

The appsec (`Engine.Gates.SecOpsAgentServer.run_design/2`, [RN-360](#rn-360))
was born implemented, tested and **with no production caller at all**: the only
mention outside tests was a comment in `artifact_schemas.ex`. [RN-360](#rn-360)
itself declared the gap, and `docs/fluxo.yml` (role `appsec`,
field `acionamento`) already NAMED the missing trigger — `assess_implementability`
of the Dev Lead, gate `implementavel`, the same [ADR 0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md).
That was it. `run_assessment/2` now calls it via
`Engine.Gates.Dispatcher.run_appsec_design/2` — the sixth callback of the behaviour,
a structural COPY of `run_qa_estrategia/3` and swappable in tests for the same
reason as its five neighbors (the caller is exercised by a light test, without an
Ecto sandbox, and should not start a real GenServer just to prove it
ASKED).

**In parallel, and the assessment does not wait.** The trigger happens on BOTH exits
of `run_assessment/2` — with a test plan and without — and the outcome of each one
stays byte for byte as it was. Making the assessment depend on the threat model would make the
`implementavel` gate depend on TWO asynchronous productions instead of one, and
would burn two Dev Lead turns where today one is burned: the `:sem_plano` branch
already returns `{:error, ...}` asking the model to call again
([RN-163](#rn-163)), and a second wait stacked on it would multiply the
window. The threat model reaches whoever needs it through the path that
[RN-361](#rn-361) already defined — handoff to `arquiteto`, `dev-lead` and
`infra` —, never through this return; the `:sem_plano` message does not even mention
the appsec, because promising the model something it will not receive there is the
defect that [RN-163](#rn-163) closes.

**Since [RN-674](#rn-674) there is no more `:sem_plano`**: the assessment comes out on the
first call, the appsec trigger accompanies the proposal, and the read of the
history serves only the guard below. The appsec stays in DESIGN — the owner's
decision that took the test plan out of pre-dev was about QA.

**And only once per story.** The model is INSTRUCTED to call
`assess_implementability` again while the test plan does not exist: without a
guard, each re-call would cost another appsec LLM round and three more
handoffs about the SAME story. `disparar_appsec_se_preciso/3` only triggers
when there is no `artifact.threat_model` of that `storyId` in the history. The
question here is DOES IT EXIST, not WHICH — the opposite of the test plan, where the most
recent wins because a story can be reassessed.

The event log read is **one** per call: the two questions ("is there already a test
plan?", "is there already a threat model?") are answered over the same list. Two
`list_events/2` in the same invocation would be the traffic amplifier that
[ADR 0060](../adr/0060-superficie-de-leitura-de-codigo.md) refuses, and this path is
hot precisely because of the retry. An UNREADABLE history triggers
nothing: absence of an answer is not proof of absence of the artifact, and triggering there
would reopen the re-call through another door. The invalid args clause also does not
trigger — it does not know which story it is.

- **Where:** `apps/engine/lib/engine/agents/dev_lead_tools.ex:457`
  (`run_assessment/2`, the single history read) and `:519`
  (`disparar_appsec_se_preciso/3`, the idempotency guard);
  `apps/engine/lib/engine/gates/dispatcher.ex:29` (the callback) and `:86`
  (`Engine.Gates.Dispatcher.Live.run_appsec_design/2`);
  `apps/engine/test/support/fake_gate_dispatcher.ex:23`
- **Test:** `apps/engine/test/engine/agents/dev_lead_tools_test.exs`,
  describe "assess_implementability dispara o appsec (RN-539)" — a story without a
  threat model triggers, a story with a threat model does NOT trigger (the idempotency),
  a threat model of another story does not count, the outcome of `:sem_plano` does not change,
  the assessment is proposed normally alongside the trigger, invalid args and
  an unreadable history do not trigger
- **ADR:** [0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md)
  (which declared the automatic trigger out of scope)
- **Origin:** `docs/fluxo.yml`, role `appsec`. Declared and NOT done:
  `artifact.threat_model` is emitted in the STORY's session
  (`emit_threat_model/3` reads `story["sessionId"]`), while the guard reads the
  history of the DEV LEAD's session. On the common path they are the same session — the
  Dev Lead assesses stories that the execution session itself created. When not,
  the guard does not see the threat model and the appsec runs again: the cost of one
  repeated LLM round, never wrong data (the artifact is append-only and what
  consumes it is the handoff). Closing this would require the api to accept an artifact
  search by story ACROSS sessions, which does not exist today

## The flag that turns an agent on has to REACH the process (RN-540)

### RN-540 — A boolean flag read by `runtime.exs` is mapped in the `environment:` of the `engine` service of both composes, with the code's default {#rn-540}

A pause is only reversible if the path to turn it on exists. The pause of the Anamnese and that of the
Psicólogo ([RN-115](#rn-115),
[RN-117](#rn-117)) were declared reversible
in THREE places — the docblock of `AnamneseSchedulerWorker.enabled?/0` ("Turning it back
on is `ANAMNESE_ENABLED=true` and restarting the engine"), that of
`PsychologistWorker.enabled?/0` and the
[configuration](../reference/configuration.md) table — and the path **did not exist in
any environment**.

**Measured, not a hypothesis.** With the dev compose up:

```
$ docker compose … exec -T engine sh -lc \
    'echo "[$START_ANAMNESE] [$ANAMNESE_ENABLED] [$PSYCHOLOGIST_ENABLED]"'
[true] [] []
```

The cause is the layer only Compose has: **it does not pass the host environment
through to the container**. A variable reaches the process if, and only if, it is written in the
`environment:` (or in an `env_file`) of that service. The `engine` mapped THIRTEEN
Anamnese/Psicólogo variables — all of them cost CEILINGS
(`ANAMNESE_INTERVAL_SECONDS`, `ANAMNESE_BUDGET_MICROS`,
`PSYCHOLOGIST_TRIAGE_THRESHOLD`, …) — and neither of the two that decide whether the
agents run. `ANAMNESE_ENABLED=true` in `.env` was inert:
`apps/engine/config/runtime.exs` fell back to the default `"false"` and both stayed
off **silently, with no error**.

Probable origin of the defect: when the code's default became `false`
(2026-08-10), nobody needed the variable to TURN OFF. Only whoever tries to TURN ON
finds out the wire does not exist — and that person, by construction, shows up months
later.

**The rule.** Every BOOLEAN flag that `runtime.exs` reads — the form
`System.get_env("X", "true"|"false") == "true"` — has to be mapped in the
`environment:` of the `engine` service of both composes. The cut is that of the
booleans and not that of the file's 58 variables because a flag exists
precisely to be flipped, and the flip happens through the environment: a flag without a line
in the compose is a switch without a wire. A numeric ceiling with a good default
(`READ_FILE_MAX_BYTES`) and a release variable (`SECRET_KEY_BASE`, `POOL_SIZE`)
are legitimately left out, and that is why the list is DERIVED from
`runtime.exs` instead of maintained by hand.

The default differs per file, and the difference is the decision:

- in `docker/docker-compose.yml` (dev) the line repeats the CODE's default. Dev
  is where the docblocks' promise is exercised, and a divergent default there would make
  the compose decide product underneath `runtime.exs`.
- in `docker/docker-compose.prod.yml` it is enough to be mapped. That file
  turns the background agents off on purpose (`START_ANAMNESE:-false` against the
  code's `true`), with the reason written alongside — demanding equality
  would reject a conscious decision.

**This does NOT change any product decision.** Both flags remain
`false` by default in both composes: the pause of 2026-08-10 still holds,
byte for byte. What came to exist is the switch.

**And `ANAMNESE_ENABLED=true` alone is not enough.** `START_ANAMNESE` (BOOT
key, `apps/engine/lib/engine/application.ex:82,106-108`) decides whether the `kickoff/0` that
SCHEDULES the periodic tick is called; `ANAMNESE_ENABLED` (PRODUCT flag) decides
whether a NEW round can happen. They are different questions, and the periodic Anamnese
requires both at `true`. The Psicólogo has only the second — its automatic
trigger is session closing, not a tick.

**`deploy/k8s/` is left out, and by decision.** The layer that
breaks does not exist there: a Deployment/ConfigMap intercepts nothing, and the variable is written
where every variable is written. `brabo-config` has FOUR literals (service
addresses and the web's log level), with none of the 13 ceilings nor
`START_ANAMNESE` — the engine runs with the code's defaults, coherently.
There is no wireless switch to fix there.

- **Where:** `docker/docker-compose.yml:406-425` (the four boot keys and the
  four product flags, in each agent's block);
  `docker/docker-compose.prod.yml:308-315`;
  `apps/engine/config/runtime.exs:157,158,162,168,185,229,238,264` (the eight
  flags); `.env.example` (the two questions, side by side)
- **Test:** `scripts/ci/flags-do-engine-no-compose.spec.ts` — derives the flags
  from `runtime.exs` and fails naming the one missing in either of the two
  composes, and the one diverging from the code's default in the dev one. No `warn`:
  it really fails, in the `test-packages` job
- **Origin:** found by direct measurement in the engine container, 2026-09-08.
  Declared: the exception list `FLAGS_FORA_DO_COMPOSE` is born EMPTY — it
  exists so that "out by decision" has somewhere to be said, and does not become
  indistinguishable from "out by forgetfulness"

---

## The device key gets a screen, and the screen states the reach of revoking (RN-561)

### RN-566 — The Infra Lead refuses `container_start` by MODE before proposing: the gap of RN-494 closes in the tool that declared it {#rn-566}

`propose_container_start` proposed blindly. `dispatch_container_start/2`
assembled the payload and called `EngineApiClient.propose_action(...)` directly — without
a project read between one thing and the other, and with **zero** occurrences of
`execution_mode` in the whole tool. In a `runner` project the proposal could only
end in failure: since [RN-507](runner.md#rn-507)/[ADR 0145](../adr/0145-docker-pre-requisito-do-runner.md)
`container_start` **does not serve** that mode, because its payload ELECTS a
candidate from the Arquiteto's routing ([ADR 0131](../adr/0131-roteamento-de-modulos-para-infra.md))
and in `runner` there is no routing to elect against — that mode's type is
[`container_start_via_runner`](api.md#rn-508).

**The rule is not new, and a second one was not born.** The sibling tool already refused
locally ([RN-508](api.md#rn-508)) and the `/containers` page already branched by
DESTINATION ([RN-521](api.md#rn-521), `acaoDeSubidaDoModo`): `container` and `mounted`
come up via the BROKER, `runner` comes up via the local agent ([ADR 0144](../adr/0144-a-segunda-raiz-do-broker.md)/[RN-503](api.md#rn-503)).
What this rule does is give the missing tool the SAME rule — one project
read (`recusa_local_de_subida/2`, which returns `nil` or a reason) and one
CLAUSE per tool (`recusa_por_modo/3`). Two parallel rules would diverge on the
first new mode of the enum.

**The refusal of `container_start` is an ALLOWLIST**, like the broker's own:
`container`/`mounted` pass, `runner` is refused NAMING the sibling
tool, and a new mode in the enum is born refused with a message instead of proposed by
omission. A nonexistent project also refuses — the same clause for both tools.

**The refusal is an INPUT to the loop** ([RN-163](#rn-163)): tool RESULT
text, which the model reads and uses to call the right tool. Never
`agent.error`, never end of turn, never `proposed_action` — the api is not
called. And **it is not silence**: the `emit` of `tool.call` now happens
BEFORE the refusal in BOTH tools (in the sibling it was inside the branch that proposes),
as in the generic `dispatch_tool/2` of the same module — a refusal without a trace in the
event log is the call vanishing from the human's timeline.

**The reads are LOCAL, and that is the decision.** `Project.get/1` and
`Engine.Runners.Registry.connected?/1` run in the SAME BEAM process as the Infra
Lead; an HTTP call to the api here would put a network call inside the agent's loop.
The cost declared in `CLAUDE.md` — *"fixing it would require touching the
Infra Lead's prompt/instruction"* — **was not confirmed**: no prompt line
changed, and the refusal text is what the model reads as a result.

**What this rule does NOT close, and it is half the gap:** the blind proposal due to
ABSENCE OF IMAGE remains possible in `container`/`mounted`. The refusal here is
about MODE, and requiring a decided image would invert the order — electing the image is
precisely what that proposal DOES ([RN-491](web.md#rn-491)). `/containers` checks
the THREE things (decided image, mode, confirmed folder) because it has a human
clicking; the agent comes to check ONE. `GetInfraContextUseCase` stays without
`executionMode` — enriching the Infra Lead's context is a separate front.
`container_stop`/`container_remove` do not come in: they are proposed by the screen, never
by an agent ([RN-495](api.md#rn-495)).

No ceiling changes: `container_start` remains a real `proposed_action`,
`maintainer`, never seeded into auto-approval (until [RN-671](api.md#rn-671), which
seeds it on accepting the Infra handoff), and `container_remove` stays at the
absolute ceiling of git push/privileged command ([RN-418](api.md#rn-418)).

- **Code:** `apps/engine/lib/engine/infra/infra_lead_server.ex:599` (the
  dispatch of `container_start` querying before proposing), `:902`
  (`recusa_local_de_subida/2` — the SINGLE project read), `:474` (the
  `container_start` clause: an allowlist), `:477` (the refusal
  naming `container_start_via_runner`), `:492` (the sibling's clause, with the
  second question — runner connected), `:409` (the `emit` of `tool.call`
  moved to before the refusal);
  `apps/engine/lib/engine/infra/tools/propose_container_start.ex`
  (moduledoc — the tool stopped proposing blindly)
- **Test:** `apps/engine/test/engine/infra/infra_lead_server_test.exs:422`
  (happy path in `mounted` — the broker serves both), `:448` (failure
  case: `runner` refuses NAMED, `propose_action` never called, the `tool.call`
  narrated anyway), `:538` (nonexistent project), `:380` (the happy path
  of `container`, which now requires the row in the database)
- **ADR:** [0144](../adr/0144-a-segunda-raiz-do-broker.md),
  [0145](../adr/0145-docker-pre-requisito-do-runner.md)
- **Origin:** AT-048 (EP-020/HS-032) — the gap declared in `CLAUDE.md` since
  [RN-494](broker.md#rn-494)

## The container broker in the installation, with consent (RN-575)

### RN-577 — `open_adr_pr` and `open_infra_pr` are refused by the agent, before proposing, when the project has no repository {#rn-577}

In a real installation (AT-088, 2026-09-14), a project without a repository —
`project_repositories`, `project_git_connections` and `repo_bootstraps` empty —
received three `open_adr_pr` from the Arquiteto and one `open_infra_pr` from the Infra Lead. The
human approved all four, and all four ended `failed` with *"Projeto sem
repositório provisionado"* (`ExecuteAdrPrUseCase`, `ExecuteInfraPrUseCase`).
The person approved four actions that could only fail.

**It is not an edge, it is the common case.** Since [RN-541](web.md#rn-541) creating a project
does not create a repository, and the repository's trigger is accepting the handoff from the
Arquiteto to the Dev Lead ([RN-522](api.md#rn-522)). The Arquiteto works BEFORE that
handoff — so in a new project **every** `open_adr_pr` failed by
construction.

**The rule:** both tools ask, BEFORE proposing, whether the project has a
repository, and without it they REFUSE with a NAMED reason — what is missing, and when it comes
to exist. The `proposed_action` is not born, and the approval queue does not receive
what cannot succeed.

**The mold is that of [RN-566](#rn-566), with no new rule and without touching the prompt.** The
refusal is a tool result ([RN-163](#rn-163)),
an input to the loop — never `agent.error`, never end of turn —, and the model continues
the turn reading the reason.

**The read is LOCAL, and the predicate is the SAME as the execution's.** The engine already read
`project_repositories` directly from Postgres (`Engine.Projects.ProjectRepository`,
the consumers of `default_branch/1` and `remoto_de_trabalho/1`), so there
was no HTTP in the agent's loop to measure or justify: the new question,
`recusa_de_pr_sem_repositorio/2`, is the SAME one
`ProvisionedRepositoryRepository.findByProjectId` asks in the two use cases —
there is a row for the project. If the two diverged, the tool would let through
what the execution refuses, or would refuse what it would accept. Both tools use the
SAME function, with the same text.

**In the Infra Lead the question comes before the HALT.** `propose_infra_pr` does not propose
on the spot: it interrupts the turn so `finalize/3` runs the `WorkflowsAgent` and
consolidates into a single PR. Refusing after that (in `abrir_pr/3`) would have spent a
whole LLM loop and recorded two `completed` delegations for a PR that
cannot exist. The refusal happens at the interception, and the turn CONTINUES.

**A durable trace in both.** AT-048 found that a local refusal left no trace
in the event log; RN-566 solved it by emitting the `tool.call` before the refusal, and here
the same holds — in the Arquiteto `dispatch_tool/2` already emitted it; in the Infra Lead the
interception of `propose_infra_pr` emitted nothing and now emits, in the refusal
branch, with the title and the PATHS (never the files' content). And the
WHY goes along: a `tool.result` with `ok: false` and `erro` with the reason — the
form the Criativo already uses —, because only the `tool.call` would say the call
existed, not why it did not become a proposal. On the path that proposes nothing changes:
its trace remains the `proposed_action` itself.

**The execution use cases keep refusing as before** — defense in
depth: the agent's refusal is a layer BEFORE, never in its place.

**What this rule does NOT decide:** WHERE the repository should be born. The refusal
text describes the current trigger, and it CHANGED: AT-092 was decided in
[RN-582](api.md#rn-582) (ADR 0165) — the repository is born on accepting the handoff TO the
Arquiteto, before its first turn, with the acceptance to the Dev Lead as a second
door. The text changed along with it, as this rule promised: it names the new
trigger and, since the Arquiteto only works after that acceptance, says the refusal
means a FAILED provisioning (the `repository.provision_failed`) or a project
prior to the rule, with the two ways out. It stopped being the common case; the refusal
remains, because those two situations exist. `open_infra_pr` is also affected in a new project by another
path (the Infra Lead is triggered by the Arquiteto's handoff, which can happen
before the handoff to the Dev Lead); this rule only makes the proposal not be born, it does not
reorder the handoffs.

- **Code:** `apps/engine/lib/engine/projects/project_repository.ex:74`
  (`recusa_de_pr_sem_repositorio/2` — the predicate and the text, single for both
  tools); `apps/engine/lib/engine/harness/tools/propose_adr.ex:54` (the
  refusal before proposing), `:61` (the `tool.result` with the reason);
  `apps/engine/lib/engine/infra/infra_lead_server.ex:251` (the interception of
  `propose_infra_pr` asking before the HALT), `:594`
  (`recusa_de_infra_pr/4`), `:309` (the `tool.call` with the paths), `:314` (the
  `tool.result`)
- **Test:** `apps/engine/test/engine/agents/arquiteto_server_test.exs:107`
  (failure case: without a repository, `open_adr_pr` never proposed, reason as a
  tool result, `tool.call` and `tool.result` in the event log), `:80`
  (happy path: with a repository, it proposes);
  `apps/engine/test/engine/infra/infra_lead_server_test.exs:491` (failure
  case: without a repository, neither `propose_action` nor the Workflows delegation, the
  turn continues, durable trace), `:89` (happy path: with a repository, the
  consolidated PR is proposed)
- **Origin:** AT-088 — real installation on 2026-09-14

### RN-578 — The click that triggers an agent turn answers on ACCEPTING, and the refusal stops being silent {#rn-578}

In a real installation of v6.1.0 (2026-09-14), answering the Criativo's
questions form took **97.3 s**, confirming readiness **97.3 s** and
confirming architecture ready **51.8 s** — each click held by the agent's WHOLE
turn, because the conversational's `handle_call` only answered the
engine controller's `GenServer.call` when the turn's Task ended. A turn
above the ceiling (120 s in the Criativo, 180 s in the others) became a 500 on a command that
had worked. And the refusal of a second message with a turn in progress
(`{:error, :turno_em_andamento}`) was discarded by the controller, which answered
202: a *"Continue"* typed during the Arquiteto's kickoff was accepted and never
read, with no trace at all.

**The rule ([ADR 0163](../adr/0163-o-clique-responde-ao-aceitar.md), which generalizes
[ADR 0086](../adr/0086-dev-lead-plano-suspende-para-aprovacao.md)):**

1. **The acceptance goes out right away.** `TurnoAssincrono.iniciar/3` answers `:ok` to the
   `from` as soon as the Task comes up — after persisting `agent.status: working`,
   never before. It holds for the six conversational agents and for the four user
   routes that trigger a turn (`…/agents/:agent/message` and, through it,
   `…/structured-question/:id/answer`; `…/readiness`;
   `…/agents/arquiteto/handoff-infra`) and for returning a story
   (`ReturnStoryUseCase`). The api's status and body do NOT change
   (`201 { ok: true }`): they always meant "accepted"; what changed is when
   they arrive.
2. **The refusal BEFORE the turn comes up is synchronous and named.** The engine answers
   409 (`turno_em_andamento`, `aguardando_aprovacao`) or 422
   (`sem_regra_de_negocio`) with `{error, motivo}`, and the api passes on the SAME
   status with the SAME sentence. `turno_em_andamento` gets a durable `agent.error`
   (origin `politica`); the other two already had one.
3. **The turn's outcome goes through the channel and the log, never through HTTP.** A failure
   stays a durable `agent.error`, with the same origin as before.
4. **The screen stops treating "the call resolved" as end of turn.** After the
   acceptance, it follows the end through the channel (`agent.done`) and, as a safety
   net, through the log's tail every 4 s: it closes when that agent's most recent persisted
   `agent.status` is not `working`. Without any
   `agent.status` of the agent in the window, it does not close — not knowing is not "it ended".
5. **The handoff to the Dev Lead keeps being born AFTER the Infra one.** The
   `:offer_dev_handoff` that arrives with the Arquiteto's closing turn in
   progress stays pending and runs when the turn closes — success, failure, crash or
   cancellation. *(Superseded by [RN-672](api.md#rn-672): the Arquiteto no longer offers
   to the Dev Lead, and the pending item ceased to exist.)*

**What this rule does NOT close:** the `chat.message` the api writes before
asking the engine stays in the log when the engine refuses (now explained by the
`agent.error`, before orphaned and mute); an engine restarted in the middle of the turn does not write
`idle`, and the strip stays until "Stop" or a reload; and a message to
`infra` via the composer fell to the Criativo through the final clause of
`AgentCommandController.message/2` — pre-existing, measured here and closed
later by [RN-584](#rn-584), which removed the default recipient.

**Revised for the MESSAGE by [RN-673](#rn-673)** (ADR 0191): the user's message
that arrives with a turn in progress no longer receives `turno_em_andamento` —
it enters the agent's queue and is read at the end of the turn. The refusal of item 2 still
holds for the commands that are not speech (review, readiness, handoff
offer).

- **Code:** `apps/engine/lib/engine/agents/turno_assincrono.ex:120` (the
  acceptance), `:130` and `:314` (the durable refusal);
  `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:241`
  (202), `:243`/`:253`/`:263` (409/409/422);
  `apps/engine/lib/engine/agents/dev_lead_server.ex:211`;
  `apps/engine/lib/engine/agents/arquiteto_server.ex:160` (defer), `:202`
  (drain); `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts:591`,
  `:612`; `apps/web/src/lib/session-turno.ts:33` (`turnoTerminouNoLog`),
  `:349` (`acompanharTurnoPeloLog`), `:316`;
  `apps/web/src/routes/SessionPage.tsx:491`, `:517`, `:578`;
  `apps/web/src/lib/session-promocao.ts:141`;
  `apps/web/src/lib/recusa-do-agente.ts:17`
- **Test:** `apps/engine/test/engine/agents/turno_assincrono_test.exs:66`
  (acceptance with the task alive), `:84` (`working` recorded before the acceptance), `:178`
  (durable refusal — failure case);
  `apps/engine/test/engine_web/controllers/agent_command_controller_test.exs:35`,
  `:66` (409), `:107` (422);
  `apps/engine/test/engine/agents/arquiteto_server_test.exs:209` (order of the
  handoffs), `:237` (cancellation);
  `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts:520`,
  `:538`, `:580` (500 stays generic);
  `apps/web/src/routes/SessionPage.turno-preso.test.tsx:181`, `:252` (409);
  `apps/web/src/routes/SessionPage.readiness-turno-preso.test.tsx:172`, `:210`
  (422); `apps/web/src/lib/fim-do-turno-pelo-log.test.ts:29`, `:76`
- **Origin:** AT-089 — real installation of v6.1.0 on 2026-09-14

### RN-579 — With the session channel alive, the Session screen swaps the short poll for invalidation and a long fallback; an empty-body response has an `ETag` {#rn-579}

The installation measured in AT-093 (v6.1.0, 09/14) showed ONE browser making
7,088 requests in 56 minutes — median of 118/min, peak of 263/min —
against the 300/min of `RATE_LIMIT_USER`. Two visible tabs at the peak exceed the
ceiling, and the 429 lands in the account owner's browser. Almost everything was a 3–5s poll
from the Session screen over data that rarely changes (actions, handoffs and backlog
came back 304 99% of the time), while the screen already kept the
`session:<id>` channel with the engine open. The ceiling does NOT change: what drops is the request.

**The rule:**

1. **The engine announces every confirmed write.** The facade
   `Engine.Sessions.EngineApiClient` emits `event.appended` (only `type` and
   `actorId`, never the `payload`) after the api CONFIRMS `append_event`,
   `append_event_returning`, `propose_action` (`proposed_action.created`),
   `create_handoff` (`handoff.offered`) and `create_epic/story/task`
   (`backlog.*_created`). A refused write does not announce. Before, only
   `ArtifactEmitter` and the Infra Lead announced, by hand — and they announced even when the
   api refused the append. **Since AT-157, the write the API does on its
   own also announces** — the decision of a human in another tab, a session
   transition, the chat answered by the api's own model. `AppendSessionEventUseCase`
   and `SendChatMessageUseCase` (the only two points that write to
   `session_events` without going through the engine) call
   `SessionChannelNotifier.eventAppended`, which asks the engine
   `POST /internal/sessions/:id/event-appended`; the engine does the SAME
   `event.appended` (only `type` and `actorId`). The announcement goes out AFTER the commit of the
   outermost transaction (`aposCommit` in `DrizzleUnitOfWork`): an undone transaction
   does not announce, and announcing from inside it would make the web fetch before the
   event exists. A write that came from the engine (an `/internal/*` route, marked by
   `OrigemEngineMiddleware`) is NOT announced again by the api — the facade already
   announced. It is best effort and is not awaited: a lost announcement never fails the
   write, and the 15s fallback covers it. It is only those two points: another use
   case that starts writing to `session_events` without `AppendSessionEventUseCase`
   needs to call the notifier too.
2. **"Channel alive" is a CONFIRMED join.** `connectSessionHeartbeat` marks the session
   alive on the join's `ok` and unmarks it on error/close of the channel or the socket and
   on cleanup. The state is per session and per tab, outside React, because the
   interval belongs to each OBSERVER and three observers (Shell, `SessionPage`,
   `ContextAside`) read the same events key.
3. **With the channel alive, the poll becomes a fallback.** Events, actions, handoffs,
   backlog and the session itself go from 3–5s to 15s; the budget, from 5s to
   30s. `intervaloDaSessao` is `Math.max`: whoever already polled slower does not
   speed up. A dropped channel brings back the short interval RIGHT AWAY — the screen never gets
   worse than it was.
4. **The announcement's TYPE decides what to invalidate, with a window.** Every announcement
   invalidates the events and the budget; `proposed_action.*`/`action.*` also the
   actions, `handoff.*` the handoffs, `backlog.*` the backlog. Each target has a
   minimum window between two fetches (events 3s, actions/handoffs/backlog 2s, budget
   10s): the first goes out right away, the following ones within the window become ONE at its
   end. Without that, a burst of `tool.result` would become one fetch per event. The
   rule of finding C remains, and only for the EVENTS: during a streaming turn
   they are not anticipated; the actions are.
5. **A hidden tab does not poll.** `refetchIntervalInBackground: false` (TanStack v5's
   default, now written in `OPCOES_PADRAO_DAS_QUERIES`) — measured by
   test, not assumed.
6. **An empty body has a validator.** A handler returning `null` went out with an empty body
   and WITHOUT an `ETag` (Express's `res.send` only generates an `ETag` with a body), so
   a 304 was impossible: `sessions/:id/budget` came back 304 in 0% of the 483
   measured calls and `execution/session` in 22% (the time with active execution).
   The api writes the empty body's `ETag` when `send` goes out without a body — decided
   on what goes over the wire, not on the handler's value, so that a handler
   with `@Res()` that writes later never inherits the empty one's validator. A 304 does NOT
   reduce the rate limit count (the guard counts before the handler); it reduces bandwidth.
7. **It composes with following the turn through the log's tail ([RN-578](#rn-578)).**
   The ACCEPTED turn keeps being followed by reading the tail every 4s
   (`acompanharTurnoPeloLog`) — it is the net against the lost `agent.done`, and the
   channel's announcement can be lost along with it, so the tick does NOT become a
   15s fallback. What changes: the `event.appended` of the FOLLOWED agent's `agent.status`
   runs the read RIGHT AWAY (`avisoPedeVerificacaoDoTurno`), and the
   turn closes as soon as the log says it closed, without waiting for the tick. An announcement from
   another agent, of another type, or without a followed turn reads nothing extra. And
   the 3s poll of events stays PAUSED during streaming (findings 2/7):
   `intervaloDaSessao` only holds when the pause does not, and invalidation through the
   channel respects the same rule of finding C.

**Numbers** (budget test, one tab on the Session screen, per minute):
**123** with the channel down (the behavior from before, intact as a fallback) and
**46** with it alive — of which 24 are from the Shell (projects summary and execution
session, which do not belong to the session and stay at 5s). Two tabs: 246 → 92.
Since [RN-632](web.md#rn-632) (AT-278) the PROJECT reads poll at the project
pace (15s) and the Executors and Overview tabs go through the SAME
`criarInvalidadorDoCanal` — the measurement with the real screens and two tabs lives
there.

**What this rule does NOT close:** the announcement of the write the api does on its
own (item 1, AT-157) is best effort — if the engine is out or the
announcement is lost, the screen gets there through the fallback, within 15s (it was 3s); the announcement goes
to the engine node that received the call, and the Phoenix PubSub broadcast
delivers it to subscribers on any node of the cluster (not measured in a cluster). The roster's
`working` status still depends on the `event.appended` of the `agent.status`,
which goes out after the api writes it. `projects-summary` and `execution/session`
(Shell) stay at 5s. During an accepted turn, RN-578's 4s tail read
adds up to 15 req/min, only while the turn lasts. It is not a consistency model change (no ADR): the
source remains the GET, the channel remains only a trigger — as it already was
since Phase 4a —, and what changes is the maximum latency of writes without an announcement.
- **Code:** `apps/engine/lib/engine/sessions/engine_api_client.ex:581`,
  `:607`, `:630`, `:1034` (`avisar_canal`);

  `:607`, `:630`, `:953` (`avisar_canal`);
  `apps/engine/lib/engine/sessions/live_broadcast.ex` (`event_appended/3`);
  `apps/engine/lib/engine_web/controllers/session_command_controller.ex:46`
  (`event_appended`, the route of the api's announcement);
  `apps/api/src/application/use-cases/sessions/append-session-event.use-case.ts:225`
  (`eventAppended`);
  `apps/api/src/infrastructure/persistence/drizzle/drizzle-context.ts:39`
  (`aposCommit`), `:53` (`veioDoEngine`);
  `apps/web/src/lib/canal-vivo.ts:35` (fallback), `:66` (state), `:108`
  (`intervaloDaSessao`), `:134` (`alvosDoEvento`), `:150` (windows), `:207`
  (`criarInvalidadorDoCanal`); `apps/web/src/lib/session-channel.ts:161`,
  `:165`, `:131`, `:229`; `apps/web/src/lib/session-turno.ts:414`
  (the announcement: invalidates and, for the followed one, anticipates the read), `:86`
  (`avisoPedeVerificacaoDoTurno`), `:344` (the immediate read);
  `apps/web/src/lib/hooks.ts` (`useSessionEvents`, `usePendingActions`,
  `useHandoffs`, `useBacklog`); `apps/web/src/lib/query-policy.ts:86`;
  `apps/api/src/interfaces/http/shared/etag-do-corpo-vazio.ts:40`;
  `apps/api/src/main.ts:80`
- **Test:** `apps/web/src/lib/canal-vivo.orcamento.test.tsx:138` (before, 123),
  `:155` (after, 46), `:176` (channel drops — failure case), `:186` (burst),
  `:214` (hidden tab); `apps/web/src/lib/session-channel.test.ts:237`, `:253`
  (drop — failure case), `:267`;
  `apps/engine/test/engine/sessions/engine_api_client_aviso_no_canal_test.exs:29`,
  `:57` (refused append does not announce — failure case), `:71`;
  `apps/api/test/application/use-cases/sessions/aviso-ao-canal-da-sessao.spec.ts`
  (AT-157: announces with type and actor; refused does not announce and an undone transaction does not
  announce — failure cases; engine down does not fail the write; a write coming
  from the engine is not announced twice),
  `apps/api/test/infrastructure/http-clients/origem-engine.middleware.spec.ts`,
  `apps/engine/test/engine_web/controllers/session_command_controller_event_appended_test.exs`;
  `apps/api/test/interfaces/http/shared/etag-do-corpo-vazio.spec.ts:56` (the
  cause), `:69`, `:98` (late `@Res()` — failure case);
  `apps/api/test/interfaces/rate-limit.guard.spec.ts:183` (2 × 263 blows,
  2 × 118 does not); `apps/web/src/routes/SessionPage.canal-e-acompanhamento.test.tsx:166`
  (the predicate), `:203` (the followed one's announcement closes the turn without waiting for the
  tick), `:221` (another agent's announcement does not read, and the 4s tick remains the
  net — failure case), `:244` (closed turn: neither announcement nor tick read)
- **Origin:** AT-093 — logs of the installed api (v6.1.0), 2026-09-14; AT-157 — the announcement of the api's own write

### RN-580 — The conversational agent that comes up over a conversation receives its END, with questions and tools, and the beginning that did not fit is summarized with the number written {#rn-580}

The six conversational agents (Criativo, PO, Arquiteto, Dev Lead, UX
Designer and Staff) rebuild the history from the event log in `init/1` — on
restart and also when they come up in a session that already has a conversation (the PO at the
Criativo's handoff). Measured on 09/13 (AT-073, against `b61bc49cd`), the six
had the SAME copy of `rehydrate/2`, with three defects:

1. **They read the beginning.** `EngineApiClient.list_events/2` asks for `limit=200` without
   `latest`, and the internal route — which did not even accept `latest` — returns the
   FIRST 200. In a conversation of 201 events the agent woke up without the
   message it was answering. The screen had already solved this with
   `latest: true` and a cut warning ([RN-180](web.md#rn-180));
   the engine had not inherited it.
2. **They rebuilt only `chat.message` and `agent.response`.** The question asked via
   a form (`chat.structured_question`) and the tools called
   (`tool.call`/`tool.result`) disappeared.
3. **They cut silently.** And the kickoff reads (PO, Arquiteto, Dev Lead,
   UX Designer) and those of the product_brief rules (Criativo) filtered in memory
   the same FIRST 200 events of all types: in a long conversation with the
   Criativo, the brief was born after event 200 and the PO received "(no product
   brief available)".

**The rule:**

1. **A single path.** `Engine.Agents.Reidratacao` replaces the six copies; the
   six servers call `historico/3` in `init/1`.
2. **The tail, with ADR 0060's ceiling.** The read is `latest=true&limit=200` — the
   route's `MAX_LIMIT`, neither more (the api would cut) nor less (it would leave out
   what it delivers for free). The ceiling did NOT become unlimited.
3. **What comes in.** `chat.message` and `agent.response` as always (from any
   agent of the session — it is what the PO inherits from the Criativo); `chat.structured_question`
   as the agent's speech, with labels and options; `tool.call`/`tool.result` of the
   agent ITSELF as a text note with the tool, the arguments (cut
   at 1,500 characters) and the outcome — never as a `role: "tool"` message, because
   the event does not keep the call's id and a `tool_result` without the matching `tool_use`
   is refused by the provider. `chat.structured_question_answered`
   is left OUT on purpose: the api writes the same answers in a `chat.message`
   right after (`AnswerStructuredQuestionUseCase` reuses
   `SendAgentMessageUseCase`), and rehydrating both would duplicate the answer.
4. **The beginning that did not fit is stated, with the number.** The `seq` is gapless and starts
   at 1, so the number of omitted events is the `seq` of the tail's first one minus
   one — SUBTRACTION, without an extra request. When it is greater than zero, the
   history opens with ONE system message that writes that number and brings the
   summary of the agent's most recent context compaction (when it was
   recorded) and the conversation's opening (the first six messages of the first
   40 events, cut at 500 characters). Those are two more reads with a ceiling —
   three in total, and only one when the conversation fits.
5. **`context.compacted` records the summary from now on** — `summary`, `agent`
   and `messagesSummarized`, next to the usual counts. A conversation compacted
   before this stays DECLARED ("compacted N time(s) before the summary started to
   be recorded; that summary was lost"), never rebuilt; the old
   events do not change.
6. **An unreadable history does not become an empty conversation.** If the read fails, the agent
   receives a system message saying it could not read the history.
7. **Kickoffs and brief refs read BY TYPE, from the tail.** The internal route gained
   `types` (up to 20, validated; malformed is 400) — a CONTRACT change,
   additive: without `latest`/`types` the response is the one from before. When the read by
   type hits the ceiling, the kickoff says there may be older items.

**Measured per agent:** all six changed in rehydration (`init/1`). In the kickoffs,
PO, Arquiteto, Dev Lead and UX Designer changed; the Criativo changed in the
product_brief refs and in the zero-rule guardrail; the Staff has no kickoff (ADR 0088).

**What this rule does NOT close:** the text the tool returned was not in the
log — closed by [RN-589](#rn-589), from then on (an old session stays without it).
`InfraLeadServer` (which rehydrates via `Reidratacao.historico/3` since AT-150,
without its own copy) and `DevLeadTools.run_assessment/2` (which reads the TAIL, `latest`
with the same 200 ceiling) also go through the common path; no reader of
`list_events/2` without `latest` remains in `apps/engine/lib`. Rehydration can bring MORE than the
live context had (the whole tail, even what had already been compacted); the
`ContextManager` compacts again on the next turn.

- **Code:** `apps/engine/lib/engine/agents/reidratacao.ex:71` (`historico/3`),
  `:46` (the ceiling), `:104` (`eventos_do_tipo/3`), `:152` (`mensagens/2`), `:167`
  (structured question), `:170` (tool), `:271` (omitted by
  subtraction), `:274` (the summary of the beginning), `:294` (the compaction), `:328` (the
  opening); `apps/engine/lib/engine/harness/context_manager.ex:138` (the summary
  recorded); `apps/engine/lib/engine/sessions/engine_api_client.ex:1066`

  recorded); `apps/engine/lib/engine/sessions/engine_api_client.ex:1146`
  (`list_events/3`); the six `init/1` —
  `apps/engine/lib/engine/agents/criativo_server.ex:89`, `po_server.ex:93`,
  `arquiteto_server.ex:87`, `dev_lead_server.ex:132`, `ux_designer_server.ex:85`,
  `staff_server.ex:86`; the reads by type — `criativo_server.ex:435`,
  `po_server.ex:352`, `arquiteto_server.ex:313`, `dev_lead_server.ex:431`,
  `ux_designer_server.ex:246`;
  `apps/api/src/interfaces/http/internal/leitura-interna-de-eventos.ts:24`,
  `apps/api/src/interfaces/http/internal/internal-sessions.controller.ts:306`,
  `apps/api/src/infrastructure/persistence/drizzle/session-event.repository.ts:56`
- **Test:** `apps/engine/test/engine/agents/reidratacao_test.exs:57` (structured
  question), `:92` (the answer comes in ONCE), `:108` (tool with
  outcome), `:128` (without `tool.result`), `:136` (another agent's tool
  is left out), `:157` (asks for the tail with ceiling 200), `:176` (the end comes in, the
  beginning becomes a summary with the number), `:194` (the compaction summary), `:233`
  (old compaction declared), `:248` (unreadable history — failure case),
  `:255` (failing opening does not erase the number), `:270` (read by type and the
  ceiling warning); `apps/engine/test/engine/agents/reidratacao_dos_seis_test.exs:59`
  (the six `init/1`), `:84` (the brief after event 200 reaches the PO), `:118`
  (the rule after event 200 enters the Criativo's brief), `:135` (Arquiteto,
  Dev Lead and UX read by type); `apps/engine/test/engine/harness/context_manager_test.exs:74`
  (the recorded summary), `:101` (summarizer fallback);
  `apps/api/test/interfaces/http/internal/leitura-interna-de-eventos.spec.ts:13`
  (without the parameters, the options from before), `:40` (malformed type is 400);
  `apps/api/test/infrastructure/persistence/session-event-latest.repository.spec.ts:129`
  (`types` filters and the `limit` counts only them), `:143` (`types` with `latest`)
- **Origin:** AT-073, raised on 2026-09-13

## The repository is born on accepting the handoff to the Arquiteto, and execution does not start without it (RN-582)

### RN-584 — The chat message has no default recipient: each conversing agent has its own clause, and the rest is a named refusal {#rn-584}

The last clause of `EngineWeb.AgentCommandController.message/2` did not look at the
agent: it matched ANY name the clauses above had not caught and
delivered the message to the **Criativo**. A message written to `infra` was
read by another agent, the click answered 202, and the Criativo answered in the thread —
nothing broke, and nobody saw. Found as an adjacency of
[RN-578](#rn-578) (AT-089) and fixed here (AT-098).

**The measurement, before the fix** (the three sides, on `dev` at `72ee8cdcf`):

| Destination | Does the screen offer it? | Does the api accept it? | Did the engine have a clause? |
|---|---|---|---|
| `criativo` | yes (composer: the creative session's fallback and `AGENTES_DE_CHAT`) | yes | NO — it was the final clause, without a guard |
| `po`, `arquiteto`, `dev-lead`, `ux-designer`, `staff` | yes (`AGENTES_DE_CHAT`, the most recent `agent.activated`) | yes | yes, one each |
| `infra` | not in the composer (out of `AGENTES_DE_CHAT` since the 9-fix finding and [RN-499](web.md#rn-499)) | yes | no — it fell to the Criativo |
| any other name in the roster (`qa`, subagents, `secops`, `psicologo`…) | only through the structured questions form, which answers the ACTOR who asked (`agent={event.actor.id}`); today only Criativo and PO ask | yes | no — it fell to the Criativo |
| unknown name, or none | no | yes (the api does not validate the `agent`; only the `sessionId` becomes a checked URL segment, RN-128) | no — it fell to the Criativo |

**The rule:**

1. **Each conversing agent has its OWN clause**, the Criativo included
   (`"agent" => "criativo"`). The final clause stopped existing as a
   delivery: it is a REFUSAL.
2. **A name without a clause is a NAMED 422**, `{error, motivo}` in the mold of
   [RN-578](#rn-578): `agente_sem_conversa`, with a sentence that names the agent
   and says the message was recorded and no agent read it. The api passes on the
   422 as `UnprocessableEntityException` with the SAME sentence (the
   `postComandoDeTurno` of RN-578, without new code), and the screen shows it through the
   `mensagemDaRecusaDoAgente` that already existed. Without `"agent"` in the body it is
   `agente_ausente`, and a conversing agent without text is `mensagem_sem_texto` —
   three reasons, because "does not converse" said to one who converses would be a lie.
3. **`infra` has its OWN refusal**, with a sentence that says what it does: it works
   by proposal (the infra PR, starting the container), and what asks for a decision
   shows up in Approvals. It is not missing code, it is the same reading as
   [RN-499](web.md#rn-499) — the Infra Lead is propositional. And the `user_message/2` that
   `InfraLeadServer` still exports **does not serve** for a clause: it runs the
   WHOLE turn inside `handle_call` (up to 180 s), without the acceptance of ADR 0163
   and without "Stop" (`via_for/2` does not know it). Wiring it would give back to the click the
   wait [RN-578](#rn-578) removed.
4. **"Stop" also does not guess.** `cancel/2` without `"agent"` stopped the
   Criativo's turn; it becomes 422 `agente_ausente`. The api always sends the agent
   on both routes, so those two refusals only reach a broken caller.
5. **The screen keeps not offering `infra` in the composer** — no UI
   change: `AGENTES_DE_CHAT` already excluded it, and what changed is that, if one day
   someone puts it there, the engine refuses with a name instead of delivering to another, and the
   CI guard fails it first.

> **Since [RN-617](#rn-617) (ADR 0175), items 3 and 5 no longer hold:** the
> Infra Lead's turn migrated to `TurnoAssincrono`, and only then did it gain its own
> `message/2` clause, the "Stop"'s `via_for/2` and the place in
> `AGENTES_DE_CHAT`. Its `agente_sem_conversa` refusal left; the underlying
> rule of this RN — no default recipient, every name without a clause refused
> with a name — is the same.

**The guard that closes the class** lives in
`scripts/ci/destinos-do-composer.spec.ts`, because the destination is born in
TypeScript and the clause lives in Elixir — neither of the two suites reads the other
language. It DERIVES the destinations from the source (`AGENTES_DE_CHAT`, the
`agentParaEnviar = '…'` literals of `SessionPage.tsx` and the roster's `AgentKey`) and requires:
its own conversing clause and the "Stop"'s `via_for/2` for each composer
destination; no clause without a fixed agent in the head that delivers to an agent;
the last clause of `message/2` being a refusal; `infra` out of the composer and
with its own refusal; and `@agentes_de_conversa` equal to the set of clauses
that converse. Five mutations measured, all killed (the old catch-all
back, `infra` in `AGENTES_DE_CHAT`, the Criativo's clause renamed, the
Staff's `via_for` removed, the `infra` clause renamed).

**What this rule does NOT close, declared:**

- **Whether the Infra Lead comes to converse through the composer was a product decision, without
  an owner** — taken in [RN-617](#rn-617) (AT-141): yes. Giving it a clause requires, first, migrating its turn to
  `TurnoAssincrono` (the acceptance and the `turno_em_andamento` refusal of
  [RN-578](#rn-578)) and registering it in "Stop"; and requires deciding what a
  conversation does with an agent whose contract is to propose. Its `user_message/2`
  stays exported and without a caller.
- **The `chat.message` written by the api before the refusal stays in the log** — and
  since [RN-587](#rn-587) the engine writes the refusal's `agent.error` next to it,
  so the thread explains itself.
- **The api does not validate the `agent`.** Refusing there, before writing, would require a
  second list of who converses on the TypeScript side — and diverging it from the
  clauses is the defect this rule closes. What decides is whoever has the
  clauses (decision kept in [RN-587](#rn-587)).

- **Code:**
  `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:42`
  (`@agentes_de_conversa`), `:177` (the Criativo's clause), `:192` (the `infra`
  refusal), `:283` (`mensagem_sem_texto`), `:249` (`agente_sem_conversa`),
  `:312` (`agente_ausente`), `:310` (the "Stop" without an agent);
  `apps/api/src/interfaces/http/agents/agents.controller.ts:115` and `:174`
  (the documented 422 response); `apps/web/src/lib/session-readiness.ts:37`
  (`AGENTES_DE_CHAT`, the source the guard reads)
- **Test:** `scripts/ci/destinos-do-composer.spec.ts` (the class guard);
  `apps/engine/test/engine_web/controllers/agent_command_controller_test.exs:124`
  (happy path: the Criativo through its own clause), `:231` (`infra`: 422 and
  neither of the two comes up — failure case), `:258` (every name from the areas catalog
  and the roster outside conversation), `:286`, `:302`, `:317`;
  `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts:575`
  (the destination travels as chosen, and the 422 arrives with the sentence)
- **Origin:** AT-098 — adjacency measured in PR #594 (AT-089)

### RN-585 — The end of the turn only becomes visible after the turn closes in the agent {#rn-585}

Since [ADR 0163](../adr/0163-o-clique-responde-ao-aceitar.md)
([RN-578](#rn-578)) the turn of the six conversational agents runs in a Task, and the
outcome the Task writes — `agent.response`, or `agent.error` when the api
narrates budget, credential or binding in the final frame — goes out BEFORE the
result reaches the agent's GenServer and zeroes `turno_assincrono`. A test
that read the state right after the `agent.error` failed in ~1 of 4 rounds
(AT-099: 8 of 30 measured). The question was whether the SAME window existed for
the user: did the screen see the turn end and the next message hear 409
`turno_em_andamento`?

It does not exist, and the rule is what makes it not exist:

1. **The two end-of-turn signals only come out of `finalizar/1`**, which runs in the
   GenServer's process, inside the `handle_info` that HAS ALREADY zeroed
   `turno_assincrono`: `agent.done` on the channel and a persisted `agent.status: idle`.
   They are the two, and only they, that the screen uses to close the turn
   (`onAgentDone` and `turnoTerminouNoLog`, [RN-578](#rn-578) item 4).
2. **The message from whoever saw one of those signals is served after that
   `handle_info`** — the GenServer serves one message at a time —, so it finds
   the agent free and is accepted.
3. **What the Task writes is not an end signal.** `agent.response` and `agent.error`
   show up in the thread with the turn still open in the agent. A screen or client that
   started closing the turn by them would reopen the window; emitting `agent.done`
   or `idle` from inside the Task too.

There was no behavior change: the order was already this since RN-578. What
this RN adds is the order WRITTEN and locked by a test in the six
conversational agents — the test stops the GenServer with the Task finished and proves that
neither of the two signals came out, without a timeout — and the fix of the PO's test, which
now waits for the persisted `idle` instead of the `agent.error`.

- **Code:** `apps/engine/lib/engine/agents/turno_assincrono.ex:158` (zeroes the
  turn in `handle_info`), `:442` (`finalizar/1`, the sole emitter of the two
  signals); `apps/web/src/lib/session-turno.ts:30` (`turnoTerminouNoLog`)
- **Test:** `apps/engine/test/engine/agents/turno_assincrono_test.exs:434`
  (the six conversational agents: with the GenServer suspended and the Task finished, the
  `agent.response` is already in the log and neither `agent.done` nor `idle` came out; after
  the `idle`, the next message is accepted — the failure case is the
  `turno_em_andamento` refusal, which the test denies);
  `apps/engine/test/engine/agents/po_server_test.exs:478` (waits for the `idle`
  before reading the state)
- **Origin:** AT-099 — intermittent `PoServerTest` test, measured on
  2026-09-19

### RN-586 — The turn the engine restart interrupted closes with a durable outcome, and is never redone {#rn-586}

Since [RN-578](#rn-578) `agent.status: working` is written BEFORE the acceptance, and
the end of the turn (`agent.status: idle` and `agent.done`) only comes out of `finalizar/1`,
inside the agent's process ([RN-585](#rn-585)). If the engine falls in the middle of the
turn, the process and the Task die together and nobody writes the end: the agent's last
`agent.status` stays `working` **forever** (AT-156, reproduced —
bringing up the server again over that log wrote nothing, in all six). The two
readers of that signal take it for a turn in progress: the screen (`turnoTerminouNoLog`,
[RN-578](#rn-578) item 4) keeps the activity strip, and
`GetSessionPendingWorkUseCase` counts pending work WITHOUT a ceiling (the third
signal of [RN-064](web.md#rn-064)), so the session does not close by heartbeat. Only the
user's next message unlocked it, and only because it brings up the agent.

1. **The `working` left without a live turn is closed by a NEW event**, never
   rewritten (an event is immutable): an `agent.error` with origin `infra` and
   `reason: turno_interrompido_por_reinicio` — the sentence says the engine was
   restarted, that the turn was not completed and that whoever decides to try again is
   the user ([RN-059](#rn-059): a failure never becomes an
   empty response) — followed by a persisted `agent.status: idle`. The channel receives
   `agent.error` and `agent.done`, so the strip of whoever has the screen open
   goes away without reloading. It holds for those sharing `TurnoAssincrono` — six
   originally, seven since [RN-617](#rn-617).
2. **The turn is NEVER re-executed.** Redoing it would spend tokens on behalf of a
   message the user may have already forgotten, over a rebuilt
   history; no call to the model happens in the closing.
3. **Only each agent's LAST `agent.status` counts**, and only `working`:
   `idle` is already closed, and `awaiting_approval` (suspended Dev Lead,
   [RN-284](#rn-284)) is a pending decision, not a dead turn.
4. **"Without a live turn" looks at the cluster, and when in doubt does not close.** The agents'
   registry is local; in a rollout the old pod may be running the turn, and
   closing it from there would kill a healthy turn. A node that does not answer counts as alive.
   The drain's session handoff ([RN-588](#rn-588), `Monitor.expect_handoff/1`)
   belongs to the `SessionServer`, not to the conversational agents: while the old pod is
   up its agent stays registered there, and the new pod's sweep sees it;
   the `Adopter` does not sweep — what reaches the orphan `working` after the old pod
   dies is the agent's `init/1`.
5. **Two entry points, one function** (`Engine.Agents.TurnoOrfao`): the
   boot sweep in each rehydrated session (`Rehydrator`, off the
   readiness path — the boot does not wait for the api), which closes the turn even if nobody
   sends a message, and each server's `init/1`, a safety net for when
   the boot could not write (api still down). A read or
   write failure is logged and the agent comes up.

Declared and not closed: ~~the Infra Lead (`infra`) runs the turn inside
`handle_call`, without `TurnoAssincrono`, and is left out~~ — closed in
[RN-617](#rn-617), which put it in `TurnoAssincrono` and in `TurnoOrfao`; the read window is that
of the session's 200 most recent `agent.status`; if the api is down at boot AND
nobody wakes the agent, the `working` stays until its next startup; and the
closing does not recover what the turn had already written before the fall.

- **Code:** `apps/engine/lib/engine/agents/turno_orfao.ex:71` (`varrer/2`),
  `:81` (`fechar_ao_subir/3`), `:134` (`encerrar/3`);
  `apps/engine/lib/engine/sessions/rehydrator.ex:75` (sweep at boot); the
  `init/1` of the six `*_server.ex` calls `TurnoOrfao.fechar_ao_subir/3`
- **Test:** `apps/engine/test/engine/agents/turno_orfao_test.exs:72` (in all six:
  the `working` without a live turn becomes `agent.error` `infra` + `idle`, and the LLM is not
  called), `:108` (`awaiting_approval` is not an orphan; `idle` and another
  agent's `working` are not closed), `:124` (`varrer/2` skips the agent with a live
  process on THIS node or on a real `:peer` node of the cluster; a read and a write
  that fail do not take down the startup);
  `apps/engine/test/engine/sessions/rehydration_test.exs:46` (the boot fires the
  sweep)
- **Origin:** AT-156, inherited from AT-089 (RN-578) — reproduced on 2026-09-19

### RN-587 — The message no agent read stays in the thread saying so: the engine writes the refusal's `agent.error` {#rn-587}

The api writes the `chat.message` BEFORE asking the engine (the engine rebuilds the
conversation reading the log, and the message needs to be durable even with it
down). When the engine refused, the message stayed in the user's thread looking
delivered and the reason lived only in the toast — the screen asserting what the source denied.
The two originating RNs left that declared ([RN-578](#rn-578), [RN-584](#rn-584));
this one closes it (AT-132).

**The measurement, before the fix**, per refusal:

| Refusal | Who produces it | Durable `agent.error` next to the `chat.message`? |
|---|---|---|
| 409 `turno_em_andamento` | `TurnoAssincrono` (RN-578) | ALREADY YES — `emitir_recusa_por_turno_em_andamento/1`, with a test |
| 409 `aguardando_aprovacao` | `DevLeadServer.handle_call` (RN-578) | ALREADY YES — `reason: "aguardando_aprovacao_de_plano"` |
| 422 `agente_sem_conversa`, `mensagem_sem_texto`, `agente_ausente` | the controller (RN-584), without a `*Server` | NO — the explanation lived only in the toast |

**The rule:**

1. **The engine is the source of the refusal AND of the record.** The three 422 refusals write
   `agent.error` (origin `politica`, `mensagem` equal to the 422's sentence,
   `reason` equal to the `motivo`) and broadcast it on the session's channel — the same
   durable/ephemeral pair as the two 409s. The thread already draws `agent.error`
   (`SessionPage.tsx`, `lerFalhaDeTurno`), so no screen changed.
2. **There is only something to write with a named session.** Without `projectId`/`sessionId` in the
   body (a broken caller) the refusal stays only as a response.
3. **The actor does not come from the route.** `infra` and the six that converse come in as
   `agent`; any other name (which the public route lets through) is the `system`
   `engine` — a typed name never becomes an actor in the log.
4. **The `chat.message` is neither erased nor postponed.** An event is immutable, and writing it
   only after the acceptance would reorder the log: the turn runs in a Task and the
   `agent.response` could precede the message it answers (and a failure between
   the acceptance and the append would run a turn over an unwritten message).

**The api still does not validate `agent`, and now that is a decision and not a gap.** The
validation AT-098 asked for is the engine's 422 refusal, and it is the
SINGLE mechanism: the api passes it on (`postComandoDeTurno`) and the engine records it. A list
on the TypeScript side would be the second copy that diverges on the first new agent, and
a list GENERATED from the clauses would require parsing Elixir — with no gain
for the user, who already sees the message and the explanation in the thread.

- **Code:** `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:547`
  (`recusar_mensagem/5`) and `:552` (`registrar_recusa_de_mensagem/3`)
- **Test:** `apps/engine/test/engine_web/controllers/agent_command_controller_test.exs:164`
  (`qa`, the roster agent that still has no conversation — until RN-617 the case was
  `infra`, which started conversing: the `agent.error` with the sentence and the reason), `:178` (an unknown name
  does not become an actor), `:194`, `:209`, `:224` (without a session: nothing written — failure
  case); mutation measured: with the record removed, 4 of the 5 fail;
  `scripts/ci/destinos-do-composer.spec.ts` (the refusal of `message/2` is
  `recusar_mensagem/5` and it writes the `agent.error`; six mutations killed)
- **Origin:** AT-132 — declared open in RN-578 (AT-089) and RN-584 (AT-098)

### RN-588 — Handing over a session does not let the old pod delete the peer's row {#rn-588}

In the rollout, the old pod's drain stops the `SessionServer` and asks a peer to
take over the session (`Engine.Shutdown`); the peer's `init` rewrites the row of
`engine.session_states`. The `:DOWN` of the stopped process, however, reaches the old pod's
`Engine.Sessions.Monitor` by message — and the Monitor is a single
GenServer, which serializes each session's `:DOWN` with one DELETE per trip
to the database, without waiting for the next handoff. When the `:DOWN` was processed
AFTER the peer's upsert, the `DELETE ... WHERE session_id` — which does not look at owner
nor generation — took the PEER's row: the session was left with an owner and without a row,
invisible to the `Adopter`, the `Rehydrator` and the peer's drain's `local_sessions/0`.
If the peer was ANOTHER old pod (`.33 → .28 → novo`), it did not see it when
draining, and its SIGTERM killed it: `active` in the api and without an owner (AT-078, the
`rollout-test` of `propriedades.yml`, ~3 orphans in 13 rounds).

The rule: the drain marks the stop with `Monitor.expect_handoff/1` (the usual
`expect_stop/1` PLUS "the row is not mine"), and the Monitor does NOT delete the
row of a handed-over session — it records in `Logger.info` that it kept it. Without
adoption, what deletes is the drain itself (`terminate_unadopted`), as it already was; the
Monitor keeps deleting the row of every session that dies from another cause and that
of the `SessionLifecycleWorker`'s `expect_stop/1` (the api has already closed the session).
No migration: the row did not gain an owner column, and the mark lives in the
Monitor's state, per session. Every deletion by the Monitor now leaves ONE log line
with session, node and rows removed — the drain's log never reaches the
pod's log (the `preStop` discards it), the Monitor's does.

**Inference that remains:** the instant the row disappeared was never measured in
k3d; the reading comes from the artifact of round `35452845830` (no row + a second old
pod) and from the code, and the race was proven in ExUnit, not observed. The
next k3d failure, if any, brings the Monitor's line.

- **Code:** `apps/engine/lib/engine/sessions/monitor.ex:45`
  (`expect_handoff/1`), `:119` (`apagar_linha/1`);
  `apps/engine/lib/engine/shutdown.ex:130` (`release/1`, the drain marks the handoff)
- **Test:** `apps/engine/test/engine/sessions/monitor_repasse_test.exs:52`
  (Monitor suspended: the late `:DOWN` does not delete the row rewritten by the peer),
  `:67` (chain old → old → new: the second drain still sees the session),
  `:87` (without adoption the row keeps going out through the drain), `:100`
  (`Shutdown.release/1` marks the handoff — swapping the call back to
  `expect_stop/1` fails ONLY this test)
- **Origin:** AT-078 — intermittent orphan session of the engine rollout

### RN-589 — The text the tool returned goes into `tool.result`, cut with the total stated {#rn-589}

RN-580 declared it open: only the Criativo wrote `tool.result`, and without the text —
in the other five the rehydration note said the log does not record the
outcome, and the rehydrated agent knew THAT it called `create_epic`, not the id of the
epic it answered.

**The rule:**

1. **All six write.** Criativo, PO, Arquiteto, Dev Lead, UX Designer and Staff
   emit `tool.result` after EVERY call that returns text. The payload comes
   from ONE place, `Engine.Agents.ResultadoDeFerramenta.payload/2`: `tool`, `ok`
   and — on success — `resultado`; on failure, `erro` (as the Criativo already did).
2. **With a ceiling, and the ceiling states the total.** The text is cut at 2,000 characters;
   when it cuts, `resultadoTotal` brings the REAL size (ADR 0060). The reason for the
   ceiling: the log is read by every project member and goes into the backup, and a
   listing (`listar_backlog`) can be large.
3. **Additive.** A new field in an existing type, without a migration; `tool`/`ok`/`erro`
   stay as they were. An event is immutable: an earlier session stays without the text, and
   the rehydration note keeps saying so for the call without `tool.result`.
4. **Rehydration uses the text.** `desfecho: ok, devolveu: <texto>` (with the warning
   `[cortado; o total real tinha N caracteres]` when there is `resultadoTotal`).
   It remains a text note, never `role: tool` — the event does not keep the
   call's id.
5. `propose_adr` stopped writing its own refusal `tool.result`: the Arquiteto's server
   writes it for every tool, and the two would duplicate the event.

**What stays open:** (a) and (b) closed in [RN-593](#rn-593) — (a) the Dev
Lead that SUSPENDS (`{:pending, _}`,
`propose_execution_plan`/`assess_implementability`) did not write `tool.result` on
suspension nor on `action_settled`; (b) `InfraLeadServer` had its own
`tool.result` and did not go through this module; (c) the 2,000 ceiling is a CHOICE, not measured over the
holdings — no real result was sampled; (d) **pending product
decision (human TODO of AT-151):** the six's tools return ids,
lists of rules/backlog/metrics and error messages — none reads a
repository file nor command output —, but if such a tool is born, it
would write its content to the log; the cut is the only containment.

- **Code:** `apps/engine/lib/engine/agents/resultado_de_ferramenta.ex:24`
  (`payload/2`), `criativo_server.ex:382`, `po_server.ex:259`,
  `arquiteto_server.ex:336`, `dev_lead_server.ex:407`,
  `ux_designer_server.ex:232`, `staff_server.ex:198`;
  `apps/engine/lib/engine/agents/reidratacao.ex:224` (`desfecho/1`)
- **Test:** `apps/engine/test/engine/agents/reidratacao_test.exs:128` (text and
  cut warning in the note; `:145` old session without `tool.result`),
  `apps/engine/test/engine/agents/po_server_test.exs:252` (the recorded event,
  cut, with `resultadoTotal`)
- **Origin:** AT-151 — declared open in RN-580 (AT-073)

### RN-593 — The suspended Dev Lead and the Infra Lead write `tool.result` through the common module {#rn-593}

[RN-589](#rn-589) declared two open: the Dev Lead that suspends on an
approval wrote `tool.result` at no moment, and `InfraLeadServer` only
wrote the refusal one of `propose_infra_pr`, with a hand-assembled payload. In both
cases the rehydrated agent ([RN-580](#rn-580)) read "the log does not record the
outcome of this call" about a plan the user had already decided, or about
every call of `validate_infra_file` and of container start.

**The rule:**

1. **Dev Lead: the `tool.result` is born on RESUMPTION, never on suspension.** When
   `propose_execution_plan`/`assess_implementability` suspends
   (`{:pending, _}`), the log stays with only the `tool.call`: there is no outcome, and
   writing "pending" there would be the same lie it would be for the model. When the
   `{:action_settled, …}` of the SAME action arrives, the server writes the `tool.result`
   with the SAME text that goes into the `role: "tool"` message. `ok` follows the
   partition of `texto_do_desfecho/1`: `executed`/`auto_approved`/`approved`
   are `true`; refusal, failure and a status the module does not know are `false` —
   `ok: true` on an outcome nobody classified would be asserting success without
   knowing. An outcome of ANOTHER action stays ignored and writes nothing.
2. **Infra Lead: every tool dispatched inline writes.**
   `validate_infra_file`, `propose_container_start` and
   `container_start_via_runner` write `tool.result` through
   `Engine.Agents.ResultadoDeFerramenta.payload/2` — a proposal accepted by the api is
   `ok: true`; a local refusal by mode ([RN-566](#rn-566)), the api's refusal
   ([RN-591](api.md#rn-591)) and an absent runner are `ok: false` with the reason. The refusal
   of `propose_infra_pr` without a repository ([RN-577](#rn-577)) goes through the same
   module, with the payload from before (`tool`, `ok: false`, `erro`) and the cut.
3. **An accepted `propose_infra_pr` stays WITHOUT `tool.result`**, on purpose: it does not
   emit `tool.call` (its trace is the `proposed_action`), and a result without a
   call would become an orphan note in rehydration.

**What remains open:** a suspension crossed by an engine restart
keeps losing the `Wake` subscription (ADR 0086) — there the `tool.result` is never
born, and rehydration says the log does not have the outcome, which is true; the
2,000-character ceiling remains a CHOICE, not measured: no real holdings were
sampled in this change (item (c) of [RN-589](#rn-589)); the output of
`validate_infra_file` (hadolint/actionlint) may quote excerpts of the file the
agent ITSELF wrote, and the cut is the only containment — it is item (d) of
[RN-589](#rn-589) with the first concrete case.

- **Code:** `apps/engine/lib/engine/agents/dev_lead_server.ex:313`
  (`handle_info/2` of `action_settled`, the `tool.result` at `:271`), `:719`
  (`sentido_do_desfecho/1`);
  `apps/engine/lib/engine/infra/infra_lead_server.ex:1042`
  (`registrar_resultado/4`), `:317` (the refusal of `propose_infra_pr`)
- **Test:** `apps/engine/test/engine/agents/dev_lead_server_test.exs:292` (the
  suspension does not write), `:364` (the resumption writes the text the model read),
  `:488` (refused is `ok: false` with the reason);
  `apps/engine/test/engine/infra/infra_lead_server_test.exs:253`
  (the outcome of `validate_infra_file`), `:409` (accepted proposal), `:485` (refusal by mode),
  `:863` and `:910` (`container_start_via_runner` with and without a runner)
- **Origin:** AT-190 — declared open in [RN-589](#rn-589) (AT-151)

### RN-601 — The engine and the broker apply the api's rule to both service tokens {#rn-601}

The three processes that compare the service token use the same rule as
[RN-598](api.md#rn-598), each in its own language. Surrounding whitespace is discarded, and
a value made only of whitespace counts as absent. In production, an absent
`BRABO_SERVICE_TOKEN`, the public development literal
(`dev-service-token-change-me`) or a value with fewer than 16 characters after
the trim BRING DOWN the boot, with a message naming the variable. The last two
refusals also apply to `BRABO_SERVICE_TOKEN_PREVIOUS` when it
is set. A previous equal to the current one does not count as rotation. Outside
production only the trim applies, and an empty current one falls back to the dev default.

Before, the engine read both raw in `config/runtime.exs`: no trim, no floor,
and in production it started with the public default when the variable was missing (and with the
empty string when the compose passed it empty). Only the api refusing to start
protected the installation. The broker already applied the rule to the current one, but to the previous
only the trim.

Two divergences of form, declared. In the engine, "production" is
`config_env() == :prod` (the release), and not `NODE_ENV`, which it does not read; the
production image is always a `:prod` release. And the rule stays inline in
`runtime.exs`, not in a `lib/` module, because in a release that file
runs in a config provider before the application code is loaded.

Consequence: every process that evaluates that `runtime.exs` in a `:prod` release
needs the token, including the migration (`bin/engine eval
Engine.Release.migrate()`). That is why the `migrate-engine` service of the production
and installation composes started receiving `BRABO_SERVICE_TOKEN` and
`BRABO_SERVICE_TOKEN_PREVIOUS`, without default. The CI smoke showed it: without
them, the migration died before migrating. The Kubernetes migration Job already
received them through the `envFrom` of `brabo-secrets`.

- **Where:** `apps/engine/config/runtime.exs:85`
  (`exigir_token_de_servico_de_producao`), `:105` (`service_token`), `:121`
  (`service_token_previous`); `apps/broker/src/config.ts:89` (`anterior`),
  `:125` (`exigirTokenDeProducao`)
- **Test:** `apps/engine/test/engine/runtime_service_token_test.exs` (evaluates the
  real `runtime.exs` via `Config.Reader.read!/2`, with `env: :prod` and
  `:dev`); `apps/broker/src/config.spec.ts` (describe "lerConfiguracao —
  produção, o token ANTERIOR (RN-601)")
- **Edge case:** the rule is copied in the three processes, not shared: they are three
  languages or runtimes, and no test checks that the three copies remain
  equal. The floor counts characters (`String.length` in Elixir, `.length` in TS),
  which only differs for a token outside ASCII.
- **Origin:** AT-216 (finding from AT-205)

### RN-610 — The Infra Lead refuses the start by STATE, in the order of `/containers`: already up, no image, folder never confirmed {#rn-610}

[RN-566](#rn-566) gave the Infra Lead's two start tools the refusal by
MODE and declared the rest: `/containers` checks three things before offering the
button (decided image, mode, confirmed folder) and the agent checked one. The
maintainer's decision (AT-142, 2026-09-27) was to close that distance through
**local refusals at dispatch**, in the mold of RN-566/[RN-577](#rn-577), and NOT through
enriched context — `GetInfraContextUseCase` does not change.

`recusa_local_de_subida/2` still reads the project ONCE. First the MODE
(`recusa_por_modo/2`, RN-566's rule with no text change) — it is what says
which tool to use, and answering "image missing" to whoever called the wrong tool
would point to the wrong door. Then the STATE (`recusa_por_estado/3`), one
clause per reason, in the SAME order as `decidirSubida`
(`apps/web/src/routes/containers-subida.ts`), evaluated only until the first
refusal:

| Clause | `propose_container_start` | `container_start_via_runner` | Local read |
|---|---|---|---|
| container already REGISTERED `running`/`provisioning` (`ja_esta_de_pe`) | refuses | refuses | `project_containers.status` |
| no image decided (`sem_imagem_decidida`) | does **not** refuse | refuses | an `artifact.project_image` exists in some session of the project |
| folder never confirmed (`runner_nunca_confirmou`) | — | refuses | null `projects.workspace_verified_at` |
| no runner connected now | — | refuses (already existed, RN-508) | `Engine.Runners.Registry` |

**Why `propose_container_start` does not refuse by image.** Electing the image is
what that proposal DOES ([RN-491](web.md#rn-491)): requiring a decision before would invert the
order. The screen checks image in both modes because its button elects nothing.
`container_start_via_runner` does not elect — it starts the ALREADY decided image, and
`ExecuteContainerStartViaRunnerUseCase` fails without it —, so there the clause
holds. The predicate is the SAME as the api's (`ObterContainerDoProjetoUseCase`):
the EXISTENCE of the event, never the validity of the payload, because the api degrades an
unreadable payload to the default instead of treating it as absence.

**Why "already up" refuses, if the execution would not fail.**
`SubirCicloDeVidaDoContainerUseCase` is idempotent over `provisioning`/
`running`, so the approved proposal would be a nothing that spent a human
decision — and in `container`/`mounted` worse than nothing: it would elect a new version of
`artifact.project_image` that the container that is up, with the version frozen on the
row ([RN-245](api.md#rn-245)), would not use. Registered is not observed
([RN-486](api.md#rn-486)): the text does not assert the container is alive, it says what to
do when it died from outside. `stopped`, `failed` and `removed` do not refuse.
A query error returns `nil` and falls into the usual path — "I could not
look" never becomes a refusal.

**The texts, which are the tool result the model reads**
([RN-163](#rn-163)) — never `agent.error`, never
end of turn, with `tool.call`/`tool.result` (`ok: false`) in the event log through the
same `registrar_resultado/4` of [RN-593](#rn-593):

- already up: *"o container deste projeto já está REGISTRADO como `<status>` —
  subir não é a próxima ação, e `<tool>` não foi proposta. O registro não é
  observação (RN-486): se o container morreu por fora, ou se a imagem precisa
  mudar, diga ao usuário que parar ou remover é pela página `/containers`; só
  depois disso uma nova subida faz sentido. Não repita a chamada agora."*
- no image: *"nenhuma imagem de container foi decidida para este projeto
  (`artifact.project_image`, RN-105) — `container_start_via_runner` sobe a
  imagem JÁ decidida e não elege nenhuma, então aprovada ela só poderia falhar,
  e não foi proposta. Quem decide a imagem é o Arquiteto
  (`choose_project_image`): diga isso ao usuário e não repita a chamada até
  haver decisão."*
- folder never confirmed: *"a pasta deste projeto nunca foi confirmada por um
  agente local (`workspace_verified_at` vazio, RN-423) — nenhum `brabo-runner`
  jamais conectou a ele, e `container_start_via_runner` não foi proposta. Peça
  ao usuário para rodar `brabo-runner --project <id> --dir <pasta>` na máquina
  dele: a confirmação acontece quando o runner conecta."*

No prompt line changed, and no measurement with a real model was done
in this rule: the premise that the model understands the refusal is that of RN-566.

**What NO clause checks, declared:** an installation without a broker (the engine
does not read `BROKER_URL`; what refuses is the api when proposing, with 409
`sem_broker_na_instalacao`, [RN-591](api.md#rn-591)) and role/session (the agent is not
the one who clicks). The folder clause uses the stamp, which is not a heartbeat
([RN-468](web.md#rn-468)) — that is why the connected runner one stays after it.

- **Code:** `apps/engine/lib/engine/infra/infra_lead_server.ex:902`
  (`recusa_local_de_subida`), `:955` (`recusa_por_estado`), `:956`
  (`recusa_ja_de_pe`), `:964` (`recusa_sem_imagem_decidida`), `:1014`
  (`recusa_pasta_nunca_confirmada`), `:1025` (`recusa_runner_desconectado`);
  `apps/engine/lib/engine/containers/project_container_lifecycle.ex:83`
  (`status_registrado`);
  `apps/engine/lib/engine/session_events/event.ex:120` (`imagem_decidida?`)
- **Test:** `apps/engine/test/engine/infra/infra_lead_server_test.exs:742`
  (via runner, `running` refuses), `:804` (`provisioning` refuses), `:814`
  (`stopped` does not refuse), `:779` (no image), `:790` (folder never
  confirmed), `:850` (`propose_container_start` with a `running` container),
  `:850` (`propose_container_start` without an image PROPOSES), `:863` (happy path
  of via runner), `:901` (without a connected runner)
- **Origin:** AT-142

---

### RN-617 — The Infra Lead converses through the composer, and its turn goes through `TurnoAssincrono`: immediate acceptance, "Stop", orphan turn closed {#rn-617}

The decision [RN-584](#rn-584) left open — *"whether the Infra Lead comes to
converse through the composer"* — was taken by the maintainer (AT-141, 2026-09-27):
**yes**, and it becomes the SEVENTH conversational agent
([ADR 0175](../adr/0175-infra-lead-conversa-pelo-composer.md)). The condition
RN-584 wrote came first: its turn stopped running INSIDE
`handle_call`/`handle_cast` and went through the SAME `Engine.Agents.TurnoAssincrono`
as the other six; only after that was the `message/2` clause born.

**Stage 1 — the turn.**

1. **The Infra Lead's three turns come up in a Task** — the kickoff (still a `cast`,
   only on the FRESH start of the accepted handoff), the gate correction (`{:correct, _}`)
   and the composer message. The message answers on ACCEPTANCE, with
   `agent.status: working` written BEFORE ([RN-578](#rn-578)); the outcome goes
   through the channel and, when it is a failure, through the durable `agent.error`. The
   `user_message/2` that ran the turn inline LEFT: the name stayed and it is the acceptance.
2. **A second message with a turn in progress is `409 turno_em_andamento`**, with the
   `agent.error` of origin `politica` in the thread — including during the kickoff,
   which before held the message in the process's queue for the whole turn.
3. **"Stop" reaches the Infra Lead** (`via_for("infra")` in `cancel/2`): it kills
   the Task — and with it the `WorkflowsAgent`, which runs inside the consolidation —,
   writes `agent.error` `cancelado_pelo_usuario` and returns `idle`.
4. **The consolidation with Workflows is part of the turn function** and returns the
   `state`; the end signals (`agent.done`, `agent.status: idle`) only come out of
   `TurnoAssincrono`, in the server's process ([RN-585](#rn-585)).
5. **A gate correction that arrives with a turn in progress goes into a QUEUE**
   (`correcoes_pendentes`) and comes up at the turn's closing, in order of arrival — the
   `TurnoAssincrono` without a `from` DISCARDS the request that finds a turn in
   progress, and the gate would be asking nobody for a change.
6. **The orphan turn of the restart closes** through [RN-586](#rn-586): `infra` entered
   `TurnoOrfao` (`@agentes`), at boot and in `init/1`.
7. **The history comes from `Engine.Agents.Reidratacao`** ([RN-580](#rn-580)),
   as it already did, and the `tool.result` from `ResultadoDeFerramenta`
   ([RN-593](#rn-593)).
8. **The iteration ceiling is its own, 14** (the same as Arquiteto, Dev Lead, UX
   Designer and Staff), and exhausting it now emits `toolloop.limit_reached`
   ([RN-166](#rn-166)) — before, the 14th step
   ended silently.

**Stage 2 — the composer.**

9. **`message/2` has its OWN clause for `infra`**, and its
   `agente_sem_conversa` refusal left — one name, one path.
   `@agentes_de_conversa` includes it; a message to an Infra Lead that is not
   up (engine restarted) brings it back up WITHOUT a kickoff, and it rehydrates in `init/1`.
10. **The screen offers it by the usual rule**: `infra` entered
    `AGENTES_DE_CHAT`, so it is the recipient when it is the most recent `agent.activated`
    — with no default recipient (RN-584). Accepting ITS handoff
    stays in the dedicated card of [RN-499](web.md#rn-499); the thread's card excludes it by
    NAME (`offeredHandoff`), otherwise the invitation would show up twice and, being the
    oldest, would go back to hiding the Dev Lead's one ([RN-136](web.md#rn-136)). The activity
    strip gained a sentence for its four tools.
11. **Conversing opens no external effect.** The tools are the same
    four; the infra PR and the two container starts keep being born as
    `proposed_action`, with the local refusals of [RN-566](#rn-566),
    [RN-577](#rn-577) and [RN-610](#rn-610) intact.

**The 180 s ceiling stopped mattering for the turn.** It was smaller than the
225 s of the container `propose_action` ([RN-605](contracts.md#rn-605)), and a message that
led the model to propose `container_start` could blow the `GenServer.call`
with the proposal up. With immediate acceptance, the `GenServer.call` only waits for the
acceptance; the `propose_action` runs inside the Task, with nobody waiting
synchronously. The 180 000 stayed, the same as the other six's, as the ACCEPTANCE ceiling.

**Does not change, declared:** `SOLO_CONVERSATIONAL_AGENTS` (generated by
`pnpm --filter api gerar:areas`) is the list of agents WITHOUT an area that manual
handoff addresses; the Infra Lead is an area lead and stays out of it, and
`AGENTES_DE_CHAT` is not generated. The Infra Lead did not gain structured questions
nor backlog reading — conversing with it is conversing with what the kickoff gave it
and with the four tools.

- **Code:** `apps/engine/lib/engine/infra/infra_lead_server.ex:187`
  (`user_message`), `:211` (`TurnoOrfao.fechar_ao_subir`), `:248`
  (`handle_cast(:kickoff`), `:270` (`handle_cast({:correct`, the queue), `:280`
  (`handle_cast(:cancel`), `:296` (`handle_call({:user_message`), `:355`
  (`handle_info`), `:373` (`drenar_correcao_pendente`), `:420`
  (`toolloop.limit_reached`), `:1085` (`concluir`);

  (`toolloop.limit_reached`), `:1057` (`concluir`);
  `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:44`
  (`@agentes_de_conversa`), `:192` (the `infra` clause), `:592`
  (`via_for`); `apps/engine/lib/engine/agents/turno_orfao.ex:57` (`@agentes`);
  `apps/web/src/lib/session-readiness.ts:37` (`AGENTES_DE_CHAT`);
  `apps/web/src/lib/session-handoffs.ts:120` (`ofertasAcionaveis`)
- **Test:** `apps/engine/test/engine/infra/infra_lead_server_test.exs:1033`
  (immediate acceptance, `working` before), `:1048` (409 with a turn in progress — failure
  case), `:1077` ("Stop"), `:1103` ("Stop" without a turn), `:1107` (the
  gate correction in the queue), `:1788` (`toolloop.limit_reached`);
  `apps/engine/test/engine/agents/turno_orfao_test.exs:76` (the orphan, now in the
  seven); `apps/engine/test/engine/agents/reidratacao_dos_seis_test.exs:62` (the
  rehydration, in the seven);
  `apps/engine/test/engine_web/controllers/agent_command_controller_test.exs:236`
  (202, 409 and "Stop" through the route), `:283` (brings back up without a kickoff);
  `apps/web/src/routes/SessionPage.cancelar-turno.test.tsx:256` (the composer
  sends to the Infra Lead and the "Stop" is its);
  `apps/web/src/lib/session-readiness.test.ts:123`;
  `scripts/ci/destinos-do-composer.spec.ts:174` (the guard: `infra` is a destination,
  with ONE clause that converses)
- **Origin:** AT-141 (the maintainer's decision), opened by AT-098

### RN-621 — The compaction summary keeps each turn's original language, and does not translate quotes nor code {#rn-621}

When an agent's context passes the threshold, the `ContextManager` swaps the
old turns for ONE summary, written by another LLM call (the actor
`context-manager`) and reinserted as a `system` message. That call's prompt
is pt-BR and said nothing about language: in a conversation in English, or with two
languages, the summary came out translated, and the next model read its own memory in the
summary prompt's language — the language drift the language epic pursues,
born outside the user's turn. The turn's language guidance does not protect
this: it is never in `messages`, so it is never summarized, but it is also never
seen by the summarizer.

The rule is one sentence in the summary prompt, on BOTH tracks (the inline text and the
versioned template `prompts/context-manager-summarize.md`, which goes up to
version `"2"`):

> Mantenha cada turno no idioma original; não traduza citações nem código.

1. **The language is PER TURN**, never a session language: in a session with two
   authors of different languages, both survive the summary.
2. **Quotes and code are literal text** and are not translated — an identifier
   or an error message translated in the summary stops being findable.
3. **The sentence comes BEFORE the turns**, so that the text of a turn at the end of the
   prompt is not read as its continuation.
4. **Cost:** the addition is 76 bytes — 19 tokens by the engine's heuristic
   (bytes/4), at most 38 by a pessimistic rule of 1 token every 2 bytes —,
   within the ceiling of 50 input tokens per call the maintainer decided
   for the language guidance (AT-169, answer 8). The test fails a sentence that
   exceeds it by both rules.
5. **It is not `agent_instructions`:** it is code text and versioned template text,
   outside the `instruction_patch` ceiling ([RN-007](api.md#rn-007)), because the summarizer
   is not a project agent and has no per-project instruction.

**Decided without a baseline, declared:** the maintainer decided to change the prompt
right away, without waiting for the paid validation to show that the pt-BR summary drifts (AT-169,
answer 4). The consequence is that AT-167's validation measures the WHOLE
(guidance + new summary), without measuring the old summary in isolation.

**What this rule does NOT close, declared:**

- **With `graph_templates_enabled?` on, the ACTIVE version in the graph holds.** A
  installation that seeded version `"1"` keeps sending the old prompt until it
  runs `scripts/dev/seed-prompts.ts` again — the body's hash changed, so the
  seeder creates the new version. With the flag off (the default) the inline one holds, which
  already has the sentence. Seeding again also removes from the body the documentation section
  that made the summarizer receive the turns twice (AT-244, see
  [RN-413](infra.md#rn-413)); the template is at version `"3"`.
- **The fallback for when the summarizer fails** (`"(N turnos anteriores
  omitidos)"`) is not a summary and does not get the sentence: there is no turn text in it.
- **The sentence is pt-BR.** It asks for each turn's language, not the prompt's; whether a
  model obeys it in a conversation in another language is what AT-167's validation
  measures.

- **Code:** `apps/engine/lib/engine/harness/context_manager.ex:214`
  (`@instrucao_de_idioma`), `:276` (`prompt_inline`), `:233` (`prompt`, the
  choice between template and inline); `prompts/context-manager-summarize.md`
- **Test:** `apps/engine/test/engine/harness/context_manager_test.exs:417`
  (happy path: the prompt sent to the summarizer has the sentence, before the
  turns), `:433` (the 50-token ceiling, by both rules), `:443` (the versioned
  template carries the SAME sentence), `:453` (summarizer failure: the fallback
  does not pretend to be a summary nor get the sentence)
- **Origin:** AT-166, specified in AT-081 and unlocked by AT-169
  (the maintainer's decisions of 2026-09-28)

## The language of the agents' answers (RN-618..620, RN-622..624, ADR 0177)

### RN-622 — The language reaches the model as the LAST message of every call in the turn, ephemeral: the AUTHOR's when there is one, the PROJECT's when there is none {#rn-622}

RN-618..620 decided IN WHICH language the agent replies and showed it on
screen; none of that reached the model. This rule is the transport (AT-164, on
the specification from AT-081 and the mechanism verified per provider in AT-161).

1. **One `role: "system"` message at the END of the list, on every LLM call of
   the turn** — tool iterations included —, and NEVER in the history:
   it does not enter `state.messages`, so it does not pile up turn after turn,
   is not summarized by compaction ([RN-621](#rn-621)) and vanishes with the turn. In
   OpenAI-compatible it goes at the end of the conversation; in Anthropic it is hoisted to the
   end of the top `system` (AT-161). It is not `agent_instructions`: it is code
   text, outside the `instruction_patch` ceiling ([RN-007](api.md#rn-007)).
2. **One place only.** The one that appends it is the `EngineApiClient` facade
   (`llm_turn/5` and `llm_turn_stream/6`), through which EVERY LLM call of the
   engine passes — the seven conversational agents, the `ToolLoop` (dev agents and gates) and the
   Infra Lead. No server assembles the guidance.
3. **Turn WITH a human author** (the message someone typed to an agent): the
   api resolves THAT person's language in that session
   (`ResolverIdiomaDaRespostaUseCase`, [RN-618](api.md#rn-618) — session override
   > account > confirmed detected > interface) and sends it in the
   `agent/message` command as `idiomaDaResposta`, an OPTIONAL field. The agent's
   server puts it in the TURN state during `handle_call`, and the turn's Task
   inherits it from the process dictionary (`TurnoAssincrono`); the GenServer does not
   keep it for the next turn. Two authors in the same session each get
   their own.
4. **Turn WITHOUT a human author** (kickoff, dev agents, gates, commit, PR
   body, the Dev Lead's resumption after approval): the PROJECT language
   ([RN-619](api.md#rn-619)), read from `projects.language` on every call (maintainer
   decision, AT-169 answer 1).
5. **The compaction summarizer (`context-manager`) stays out**: "reply
   in X" would translate the summary, and preserving each turn's language in it is
   [RN-621](#rn-621).
6. **Failure never brings the turn down.** A resolution that fails in the api becomes a log and the
   message goes on WITHOUT `idiomaDaResposta`; a turn with an author but no language goes on
   WITHOUT guidance — never the project's in place of the person's. A failing read of the
   project language in the engine becomes a `warning` and the call goes on without
   guidance. A value that does not have the shape of a BCP-47 code does not become
   guidance either: nothing that is not a code is interpolated into the prompt.
7. **The texts** are code constants, one per language: `pt-BR` ("Responda
   em português brasileiro (pt-BR), salvo pedido explícito do usuário por
   outro idioma nesta mensagem."), `en`, and a generic one in English that names the
   BCP-47 code for any other language of the open list (AT-168
   answer 2). The text does not depend on the model: switching models in the middle of the
   session changes nothing, and there is no per-model cascade nor a special case for
   DeepSeek.
8. **Cost** — decided ceiling of 50 INPUT tokens per call (AT-169
   answer 8). Measured with `gpt-tokenizer`, content only, cl100k / o200k:
   `pt-BR` 29 / 23, `en` 18 / 18, generic `es-MX` 26 / 26 and the WORST case (the
   generic one with the longest code the accepted shape allows) 42 / 42; the message
   frame adds ~4, so the worst case lands at ~46. The test locks the text
   at 160 characters as a watchdog of the ceiling.
9. **Measurement:** the `chat.message` recorded by the api carries `idiomaAlvo` and
   `origem` when resolution succeeded — the event is immutable and says, forever,
   what was asked of the model in that turn (AT-082).

**What this rule does NOT close, declared:**

- **Human chat without an agent** (`SendChatMessageUseCase`) stays out, by
  maintainer decision (AT-169 answer 3).
- **Only the MESSAGE to an agent carries an author** (and the answer to the structured
  question form, which reuses it). The other commands a person
  triggers — confirming readiness to the Criativo, accepting a handoff — start a turn
  without an author and fall back to the PROJECT language: the product brief from
  `confirmReadiness` comes out in the project language.
- **Artifact of a turn with an author**: this rule declared it following the language of
  whoever wrote; since [RN-623](#rn-623) the same message gains the artifact
  clause, in the project language.
- **Not measured:** the DeepSeek and Anthropic tokenizers; whether the guidance
  is enough against the pt-BR system prompt is what the paid validation of
  AT-167 measures. In Anthropic, guidance hoisted to the top changes the cache
  prefix on every change of author or language — cache is not observable today.

- **Code:** `apps/engine/lib/engine/harness/idioma_da_resposta.ex:294`
  (`anexar`), `:253` (`com_idioma_do_autor`), `:161` (`orientacao`), `:94`
  (`@sem_orientacao`), `:301` (`texto_do_turno`), `:326`
  (`idioma_do_projeto`);
  `apps/engine/lib/engine/sessions/engine_api_client.ex:685`
  (`IdiomaDaResposta`), `:783` (`IdiomaDaResposta`);

  `apps/engine/lib/engine/sessions/engine_api_client.ex:685`
  (`IdiomaDaResposta`), `:783` (`IdiomaDaResposta`);
  `apps/engine/lib/engine/projects/project.ex:64` (`idioma`);
  `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:515`
  (`idioma_da_resposta`);
  `apps/engine/lib/engine/agents/criativo_server.ex:136` (`handle_call`, and the
  SAME clause in the other six);
  `apps/engine/lib/engine/agents/turno_assincrono.ex:134`
  (`copiar_dicionario`);
  `apps/api/src/application/use-cases/agents/send-agent-message.use-case.ts:168`
  (`resolverIdioma`), `:74` (`idiomaAlvo`);
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts:203`
  (`idiomaDaResposta`)
- **Test:** `apps/engine/test/engine/harness/idioma_da_resposta_test.exs:78`
  (no author: the project language, at the end), `:123` (with author: the author's
  beats the project's), `:134` (author with no resolved language: no guidance),
  `:98` (the failing lookup — failure case: list intact and log), `:93` (the
  summarizer stays out), `:67` (the watchdog of the 50-token ceiling), `:340` (end
  to end: the author's language at the end of every call and out of the history),
  `:370` (the facade also appends in `llm_turn/5`);
  `apps/engine/test/engine_web/controllers/agent_command_controller_test.exs:402`
  (the command carries the language to the model), `:414` (invalid field: accepted, without
  guidance);
  `apps/api/test/application/use-cases/agents/send-agent-message.use-case.spec.ts:109`
  (resolves by author and by session — the session override wins), `:125` (a
  failing resolution does not bring the message down — failure case);
  `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts:528`
  (the field travels only when resolved)
- **Origin:** AT-164, specified in AT-081 and unblocked by the decisions of
  AT-168 and AT-169 (maintainer, 2026-09-28); mechanism verified in AT-161

### RN-623 — In a turn WITH an author, the reply is in the person's language and the shared ARTIFACT is in the PROJECT language {#rn-623}

[RN-619](api.md#rn-619) promised the project language for the shared
artifact, and [RN-622](#rn-622) put the AUTHOR's language in every turn with an
author — so what an agent recorded DURING the conversation with a person came out in
that person's language. Maintainer decision (AT-168 answer 8, AT-245): **the artifact
follows the PROJECT**; the chat reply stays in the author's language.

1. **The mechanism is the same message from RN-622, with a second clause.**
   In a turn with an author, when the call carries at least one tool that
   records a shared artifact and the project language (`projects.language`)
   DIFFERS from the author's, the guidance becomes "Responda em português brasileiro
   (pt-BR), salvo pedido… **Artefatos do projeto: em en.**" — in the language of the
   base text: the `pt-BR` clause is in Portuguese, the others' in English
   ("Write project artifacts in X."). It is still ONE ephemeral `system` message at the
   end, assembled by the facade; what decides is the set of tools that the
   SAME call carries to the model, which the facade already has.
2. **Why the guidance, and not the tool description.** The description
   travels on EVERY call, in every tool, whether the languages are equal or not; the
   clause exists only when they differ, and lives in the only place that already decides
   the language. Nothing is added when the languages are equal, when the
   call has no artifact tool, and in a turn WITHOUT an author (which already gets
   the project language).
3. **What a shared artifact is** — what the tool PERSISTS is read by
   other people and by the next agents:
   - `emit_artifact` (`business_rule`, `note`, `decision_record`) — Criativo,
     PO, Arquiteto, Dev Lead, UX Designer, Staff;
   - `create_epic`, `create_story`, `create_task` — PO;
   - `create_module_map`, `assign_story_modules`, `choose_project_image`,
     `create_c4_diagram`, `route_modules_to_infra`, `propose_adr` (the ADR of
     `open_adr_pr`), `emit_insight` — Arquiteto;
   - `propose_execution_plan`, `assess_implementability` — Dev Lead;
   - `propose_prototype` — UX Designer; `propose_rfc` — Staff;
   - `propose_infra_pr` — Infra Lead.
   The product brief does NOT pass through here: it is emitted by the SERVER in
   `confirmReadiness`, which is a turn without an author and already comes out in the project language
   (like the handoff and the revise, which this rule does not change).
4. **What is NOT:** `ask_structured_questions` (it is a question to the PERSON of the
   turn), `offer_handoff` (carries no text), the read ones (`listar_*`,
   `rag_*`, `read_file`, `search_workspace`), `validate_infra_file` (only
   validates) and the proposals to start a container (they ask for a decision, they do not record an
   artifact). Dev agents and gates have no turn with an author.
5. **Failure never brings the turn down.** A failing read of the project language becomes a
   `warning` and ONLY the author's guidance goes on — never without guidance, never the
   project's in place of the person's. An author with no resolved language goes on without
   guidance, as in RN-622.
6. **Cost** — the 50 input-token ceiling from AT-169 applies to the whole
   message. Measured with `gpt-tokenizer`, content only, cl100k / o200k, over
   all pairs of `pt-BR`, `en`, `es`, `es-MX` and `zh-Hant-TW`: worst case
   `pt-BR` → `zh-Hant-TW` 42 / 36; `en` → `pt-BR` 26 / 26; generic `es-MX` →
   `zh-Hant-TW` 36 / 36. The clause only enters with BOTH codes in the short
   canonical form (`idioma[-Escrita][-Região]`, e.g. `pt-BR`, `zh-Hant-TW`,
   `es-419`), because it is the FORM that holds the ceiling: its worst (`pt-BR` → a
   12-character code) measures 44 / 37, ~48 with the message frame. A code outside
   that form gets only the author's guidance, and the log says so. The test locks
   every pair at 165 characters as a watchdog.

**What this rule does NOT close, declared:** the list is by tool NAME —
a new tool that records an artifact enters it in the same PR (the test ties
each name to a spec that exists, but does not discover a new tool). Whether the
model FOLLOWS both clauses in the same message is what the paid validation of
AT-167 measures; the DeepSeek and Anthropic tokenizers remain unmeasured.

- **Code:** `apps/engine/lib/engine/harness/idioma_da_resposta.ex:174`
  (`orientacao`), `:127` (`@ferramentas_de_artefato`), `:118`
  (`@forma_curta`), `:301` (`texto_do_turno`), `:319` (`grava_artefato?`),
  `:320` (`idioma_do_projeto_para_o_artefato`);
  `apps/engine/lib/engine/sessions/engine_api_client.ex:685`
  (`IdiomaDaResposta`), `:783` (`IdiomaDaResposta`);

  `apps/engine/lib/engine/sessions/engine_api_client.ex:685`
  (`IdiomaDaResposta`), `:783` (`IdiomaDaResposta`);
  `apps/web/src/routes/settings/ProjectLanguageSection.tsx`
- **Test:** `apps/engine/test/engine/harness/idioma_da_resposta_test.exs:157`
  (different languages: the guidance says both), `:168` (equal: only one),
  `:175` (code outside the short form: only the author's, with log), `:190` (the
  ceiling watchdog), `:204` (each name in the list is a spec that exists), `:235` (author
  pt-BR, project en, in a single message), `:259` (no artifact tool:
  only the author), `:290` (unreadable project language — failure case: only the
  author's, with log), `:316` (no author: nothing changes), `:340` (end to end through the
  Criativo); `apps/web/src/routes/settings/idioma-do-projeto.test.tsx:84`
- **Origin:** AT-245, on the decision of AT-168 (answer 8) and the
  maintainer's of 2026-09-29

### RN-625 — The loop asks the Jev which tool, and the user's model sees only the menu that remains; the Jev restricts and never decides {#rn-625}

Maintainer decision (AT-236, 2026-09-28) and, on the criterion, of 2026-09-29:
before each chat call of an agent, the api asks the Jev
(`typesafe/jev-1.13`, OpenRouter's Decisions API) which tool fits the
step, and the chat provider receives only the **menu** that the P3 policy derives from that
answer. The mechanism is in [ADR 0179](../adr/0179-o-laco-pergunta-ao-jev-qual-ferramenta.md);
the adoption decision, with the numbers, too.

1. **When.** Only with the turn model's provider equal to `openrouter`, with
   two or more tools in the request, with an agent in the turn (except the Anamnese and the
   compaction summarizer), without `catalogoCompleto` requested by the engine and with
   the workspace switched on (`workspaces.tool_router_enabled`, on by default,
   `PUT workspaces/:workspaceId/tool-router`, `owner`). Any condition fails:
   no call, no event. With a provider ≠ `openrouter` the workspace is not even
   read. The key is the workspace holder's, the same as the chat's (RN-058).
2. **The policy is P3 and it only restricts.** Menu = {Jev's choice, previous
   tool of the SAME execution}. The Jev's `responder_sem_ferramenta`, or no
   previous tool in the step's catalog, leaves the WHOLE catalog. There is no
   `tool_choice` (the model can still reply in text) and there is no confidence
   threshold in v1: the confidence is recorded and it is up to AT-239 to propose one. Adoption
   criterion: **80%**, owner decision of 2026-09-29 — Jev top-1 73% (66–79),
   P3 menu coverage 91% (85.1–94), top-2 90%; coverage is the CEILING of
   end-to-end accuracy (62%–91% in replay), and the real validation is AT-239.
3. **The `state`** is what the product has before the step, cut from the `messages`
   the engine already sends, without a database read: `agente` = the `agentId`;
   `contexto` = the beginning (1,500 characters) of the `system` message that the
   `ToolLoop` puts in front (`apps/engine/lib/engine/harness/tool_loop.ex:98`,
   `system_msg`, assembled by `system_prompt/1` at `:316`); `pedido` = the last
   `user` message — in execution agents the initial message of the loop
   (`apps/engine/lib/engine/dev/dev_agent_server.ex:484`, `initial_message/2`,
   or the correction one at `:523`), in conversational ones the person's utterance; and
   `passos_recentes` = the last 6 tool calls after that
   message, one entry per call, argument and result cut at 500
   characters — the result comes from the `tool` message the loop appends
   (`tool_loop.ex:293`, `concluir_despacho/5`, with `toolCallId`). The current
   execution is "after the last `user`" because `ctx.messages` restarts at each
   `ToolLoop.run`. Ceiling of 8 thousand tokens; exceeded, fallback `estado_grande`.
4. **The turn never fails because of the Jev.** HTTP error, timeout (2,000 ms,
   `TOOL_ROUTER_TIMEOUT_MS`), network error, unexpected JSON, choice outside the
   options, large state and collision with the reserved name: the provider receives the
   whole catalog and the event carries `motivoDaQueda` and `origemDaQueda`
   (`infra`, `modelo` or `codigo` — RN-059), never silent.
5. **The policy does not change.** The Jev does not approve, does not deny and does not choose a model. A
   chosen tool that requires approval still requires it; a call to a
   tool outside the menu is dispatched as always and the event only records
   `foraDoCardapio`. The iteration ceiling is the same as before (the call to the Jev is not an
   iteration).
6. **Per-step record.** The engine writes `tool_router.decided`, in the
   `EngineApiClient` facade for all agents, with menu before and after, choice,
   confidence, second option, `aplicado`, fallback, latency, real cost and
   `foraDoCardapio`. The api writes ONE `token_usage` row for the Jev: actor = the
   agent itself (the spend goes into the area budget, ADR 0110), `modelName =
   typesafe/jev-1.13`, `modelId` null, `estimated = false`, `costMicros` = the
   `usage.cost` of the response, IMPLIED price per million (`cost ÷ tokens`) with
   `price_implicit = true` — keeps `tokens × price = cost` of RN-044 without
   inventing a catalog price. Without `usage.cost` in the response there is no row. The budget
   gate is not reconsulted between the Jev and the chat.
7. **Getting out of the dead end.** Restricted menu and the model replies without calling a tool
   (not even in recoverable text), with no provider error: the facade repeats the step ONCE
   with `catalogoCompleto: true`, which skips the Jev. In the stream, only if nothing was
   written to the person. It asks for more tools, never one the agent did not have.

**What this rule does NOT close, declared:** the screen (showing that the step was
routed, with the confidence, and the "choosing tool" strip through the
`tool_routing_started` frame) belongs to `apps/web`; the gain is AT-239's; a timeout that
OpenRouter billed without returning `usage.cost` does not enter `token_usage`; the
endpoint is ALPHA and the manual smoke
(`jev-tool-router.smoke.spec.ts`, ceiling US$ 0.05) is what flags the change.

- **Code:** `apps/api/src/domain/llm/tool-router.ts:27` (`MODELO_DO_JEV`),
  `:109` (`montarPedidoAoJev`), `:166` (`lerRespostaDoJev`), `:216`
  (`recortarEstado`), `:268` (`menuP3`);
  `apps/api/src/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.ts:118`
  (`preparar`), `:143` (`executar`), `:305` (`registrarGasto`);
  `apps/api/src/application/use-cases/llm/run-llm-turn.use-case.ts:152`
  (`decisaoDoJev`); `apps/api/src/application/use-cases/llm/stream-llm-turn.use-case.ts:167`
  (`preparar`); `apps/api/src/infrastructure/llm/jev-tool-router.ts:32`
  (`decidir`); `apps/api/src/db/schema/iam.ts:169` (`toolRouterEnabled`);
  `apps/api/src/db/schema/llm.ts:356` (`priceImplicit`);
  `apps/engine/lib/engine/harness/roteamento_de_ferramenta.ex:60` (`registrar`),
  `:112` (`custo_micros`), `:123` (`repetir_com_catalogo_inteiro?`), `:146`
  (`mesclar_repeticao`); `apps/engine/lib/engine/sessions/engine_api_client.ex:700`
  (`llm_turn`), `:773` (`llm_turn_stream`);

  (`mesclar_repeticao`); `apps/engine/lib/engine/sessions/engine_api_client.ex:700`
  (`llm_turn`), `:773` (`llm_turn_stream`);
  `apps/engine/lib/engine/harness/tool_loop.ex:132` (the Jev's cost in the local
  budget)
- **Test:** `apps/api/test/domain/llm/tool-router.spec.ts:25` (`questions` is an
  object), `:86` (unexpected shape becomes a fallback — failure case), `:138` (the
  `state`), `:210` (P3);
  `apps/api/test/infrastructure/llm/jev-tool-router.contract.spec.ts:60` (the
  recorded response), `:121` (HTTP error), `:130` (timeout), `:142` (network),
  `:149` and `:154` (unexpected JSON), `:163` (choice outside the options);
  `apps/api/test/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.spec.ts:186`
  (provider ≠ openrouter does not call), `:222` (workspace switched off), `:255`
  (large state), `:277` (P3), `:318` (no tool = whole catalog),
  `:331` (no previous = whole), `:352` (the policy does not change), `:369` (the
  fallbacks), `:456` (the metering, in the area budget);
  `apps/engine/test/engine/harness/roteamento_de_ferramenta_test.exs:67` (the
  event), `:103` (the fallback in the event), `:180` (getting out of the dead end), `:288` (the cost in the
  loop), `:299` (approval is still required), `:325` (the routing does not know
  the policy)
- **Origin:** AT-238, on the specification of AT-235, the sixteen decisions of
  AT-236, the measurement of AT-237/AT-280 and the owner decision of 2026-09-29 (80%
  criterion)

## Deciding in the chat, where the owner is (RN-626)

### RN-629 — The QA Lead treats the subagent that SUSPENDS again on resumption the same way as the first time, and a result it does not know becomes a named block {#rn-629}

`qa-automacao` runs several commands and each one may ask for human approval. The
`QaLeadServer` already stopped the area when `run/5` returned `{:awaiting, _}` (finding
AB, ADR 0052), but the RESUMPTION (`retomar/3`, when the decision arrives) returned the
result of a loop that could suspend ANOTHER time — and that second
`{:awaiting, _}` went into the list of collected results as if it were a verdict.
On consolidating, `registrar_resultado/5` had no clause for it and the
GenServer crashed (`FunctionClauseError`, measured on 29/09/2026: 06:55:01 and
07:00:10), leaving the three delivered tasks in `awaiting_qa` forever, with no
verdict and no named outcome.

1. **A single place decides what to do with a subagent's result**
   (`tratar_resultado/6`), whether it comes from `run/5` or from `retomar/3`.
   `{:awaiting, _}` keeps the in-flight state (keyed by the new action), keeps the
   `gate_states` row in `in_progress` with the subagent and STOPS the area: no
   verdict, without blocking the task, without recording the delegation. The resumer is the
   same `{:action_settled, _}` of `Engine.Dev.Wake` (ADR 0086), as many times as
   needed.
2. **A result the lead does not know never crashes nor vanishes** (RN-059): it becomes
   `{:blocked, …}` with origin `codigo` (a clause is missing here, it is not infra,
   model or policy), which `registrar_resultado/5` records as a `failed`
   delegation and `QaLead.consolidar/1` turns into a block of the task with the origin.

**Declared, not resolved:** an engine restart with the lead suspended loses the
Wake subscription (accepted gap of ADR 0086); the `GateRescuer` restarts the whole
area (ADR 0067), it does not resume the `ctx`. This rule does not change ADR 0090 (the
moment of QA-strategy) nor the subagent's iteration ceiling.

- **Code:** `apps/engine/lib/engine/gates/qa_lead_server.ex:127`
  (`handle_info`), `:233` (`tratar_resultado`), `:230` (unknown result)
- **Tests:** `apps/engine/test/engine/gates/qa_lead_server_test.exs:325`
  (second suspension on resumption: stays suspended, decides nothing, and the second
  decision concludes the area); `:278` (one suspension, the happy path)
- **Origin:** AT-248, on finding E2 of the real-use analysis of 2026-09-29

### RN-636 — The AppSec only offers the threat model to whoever has not received an offer yet nor is active {#rn-636}

The AppSec created three offers per story with `run_design`, to the same three
targets — N stories, 3N pending offers (AT-292, which merges the vault's AT-273
by owner decision; [ADR 0182](../adr/0182-ciclo-de-vida-do-handoff.md)).

1. **It asks in `seAusente` mode.** `criar_handoffs_appsec/3` calls
   `EngineApiClient.create_handoff_if_absent/5`, which sends `seAusente: true` to the
   SAME internal route. The api decides under the target's lock ([RN-635](api.md#rn-635)):
   with a pending offer in ANY session of the project, it returns the existing one
   (`desfecho: ja_oferecido`) and does not supersede it; with the target active, 409
   `agente_ja_ativo`. Asking beforehand, through the engine, would race with another
   offer.
2. **"Already handled" is not a failure.** The two responses above go on without
   `agent.error`. A real failure (5xx, network) is still narrated per target, with
   origin ([RN-116](#rn-116), [RN-361](#rn-361)).
3. **The artifact stays.** The `artifact.threat_model` is recorded BEFORE and
   regardless; what stops being born is the repeated offer.

- **Where:** `apps/engine/lib/engine/gates/secops_agent_server.ex:362`
  (`criar_handoffs_appsec/3`);
  `apps/engine/lib/engine/sessions/engine_api_client.ex:1131`

  `apps/engine/lib/engine/sessions/engine_api_client.ex:1211`
  (`create_handoff_if_absent`);
  `apps/api/src/domain/sessions/ciclo-de-vida-do-handoff.ts:71`
  (`decidirOferta`)
- **Test:** `apps/engine/test/engine/gates/secops_agent_server_test.exs`
  ("run_design (RN-636): destino com oferta pendente ou já ativo não recebe
  outra, e isso não é erro", "run_design (RN-636): falha de verdade ao
  oferecer segue narrada, só para aquele destino");
  `apps/api/test/application/use-cases/agents/ciclo-de-vida-do-handoff.spec.ts`
  ("`seAusente` (AppSec, RN-636)…")
- **Origin:** AT-292, AT-273

## The dev agent's PR targets `dev`, and the gate judges that PR's diff (RN-664)

### RN-664 — The agents' work is born from `dev`, their PR targets `dev`, and the gate judges the diff against `dev` — the three together {#rn-664}

The product's branch policy has work born from `dev` (the bootstrap
creates `dev` and `qa` from `main`, [RN-582](api.md#rn-582)), but until now nobody
pointed the agents at it: the dev agent's `pr_open` carried no
`targetBranch` and the api filled in `repo.defaultBranch` (`main`); the Arquiteto's
ADR PR was born from `main` and targeted `main`; the project's working tree
opened `default_branch`; the gate computed the diff against it; and the QA
context said "Repositório · branch main" (AT-250, item A4 of the real use of 09/29).
Every agent PR skipped the `dev → qa → main` pipeline.

Owner decision (09/30): the THREE now use `dev`, together — changing only one
would leave the gate judging a diff that is not the PR's. The WORKING branch is
`dev` and it is NOT the provider's `default_branch` (which remains the one promotion
reaches last and is still read where it is the question):

- the project's working tree opens `dev` (`ensure_remoto/2` ignores the
  remote's `default_branch` to choose the base), and each dev
  agent's worktree is born from `dev` EXPLICITLY, not from HEAD — a workspace initialized
  before this rule is stuck on `default_branch` (the ready mark prevents
  re-initializing) and gets the local `dev` from `origin/dev`, without a new
  `fetch`;
- the dev agent's `pr_open` carries `targetBranch: "dev"` in the payload, and the api, without
  the field (an action proposed before), fills in `dev` and no longer the
  `defaultBranch`; the ADR PR is born from `dev` and targets `dev`;
- the gate's diff is `dev...HEAD`, and the project context line says
  "Repositório · branch de trabalho dev".

**Repository WITHOUT `dev`** (adopted without bootstrap, or a bootstrap that did not reach
`create_dev_branch`): there is NO fallback to `default_branch` — it would be the agent
working and the gate judging over a base that is not the PR's. Each point
fails NAMED, through the behavior it already had for a missing branch, with one
new exception: the working tree refused nothing and created an EMPTY LOCAL `dev`
(the path of the bare that never received a push), marked ready and never
re-initialized again. Now that path only applies to a remote WITHOUT any branch;
with branches and without `origin/dev`, initialization raises with the named
message (`mensagem_sem_branch_de_trabalho/1`, "o repositório do projeto não
tem a branch `dev`… crie a branch… e tente de novo") and `.git` is undone
(AT-112), so the next attempt, with `dev` created, initializes normally. The
worktree refuses with the same message when there is neither `dev` nor `origin/dev`; the
diff fails with git's error naming the revision; the provider refuses the PR (and the
creation of the ADR branch) naming the ref. `infra` (`open_infra_pr`) did NOT
change: it still is born from and targets `defaultBranch`.

The value lives in TWO places, on purpose, one per language, and they change together:
`BRANCH_DE_TRABALHO` in the api and `branch_de_trabalho/0` in the engine.

- **Code:** `apps/engine/lib/engine/projects/project_repository.ex:165`
  (`branch_de_trabalho`), `:176` (`branch_de_trabalho`), `:190`
  (`mensagem_sem_branch_de_trabalho`);
  `apps/engine/lib/engine/actions/workspace.ex:70` (`ensure_remoto`), `:224`
  (`init_from_bare!`), `:272` (`remoto_vazio?`);
  `apps/engine/lib/engine/actions/workspace/runner_git.ex:158` (`add_worktree`),
  `:183` (`garantir_base`), `:308` (`remoto_vazio?`);
  `apps/engine/lib/engine/dev/worktree_manager.ex:36` (`create`), `:138`
  (`add_worktree`), `:201` (`garantir_base`);
  `apps/engine/lib/engine/dev/agent_io.ex:427` (`propose_pr`);
  `apps/engine/lib/engine/gates/diff.ex:29` (`compute`);
  `apps/engine/lib/engine/harness/project_context.ex:29` (`repo_line`);
  `apps/api/src/domain/actions/protected-branches.ts:26` (`BRANCH_DE_TRABALHO`);
  `apps/api/src/application/use-cases/actions/execute-git-action.use-case.ts:208`
  (`targetBranch`); `apps/api/src/application/use-cases/actions/execute-adr-pr.use-case.ts:86`
  (`fromRef`), `:99` (`targetBranch`)
- **Test:** `apps/engine/test/engine/gates/diff_test.exs:64` (the diff is only the
  agent's change, nothing from `main` — happy path), `:73` (without `dev` the diff
  fails naming the revision — failure case), `:91` (the context states the working
  branch); `apps/engine/test/engine/actions/workspace_test.exs:87`, `:98`,
  `:110` (repository adopted without `dev`: named refusal, `.git` undone, and
  passes after the branch is created — failure case), `:130`;
  `apps/engine/test/engine/dev/worktree_manager_test.exs:119`, `:127`
  (workspace from before the rule), `:147` (without `dev` nor `origin/dev`);
  `apps/engine/test/engine/dev/dev_agent_server_test.exs:114`;
  `apps/api/test/application/use-cases/actions/execute-git-action.use-case.spec.ts:184`,
  `:213`; `apps/api/test/application/use-cases/actions/execute-adr-pr.use-case.spec.ts:143`,
  `:151` (without `dev`, `failed` with the provider's reason)
- **Origin:** AT-250 (item A4 of the analysis of the real use of 09/29), owner decision
  of 09/30

## The language of the agents' answers (RN-618..620, RN-622..624, ADR 0177)

### RN-667 — The structured form follows the reply language: the tool description pins no language at all {#rn-667}

The paid validation of AT-167 found, for an author with `en` preference (C06/C12),
the `ask_structured_questions` call with **prose in English and the form
questions in Portuguese** — in treated DeepSeek, 8 of the 15 replies of
C06+C12. The cause is the product's, and lives in one place only: the tool description
said `label` was "the question text, **in pt-BR**". It was a SECOND
language guidance, fixed, outside the facade of [RN-622](#rn-622), competing
with it on every call of the Criativo and the PO (both use the SAME spec).

1. **The mechanism is removing the competing guidance, not adding another.** The
   description now says "the question text, **in the language of your
   reply** (also applies to `options`)", and the example, which stays in
   Portuguese, is marked "the texts follow the language of your reply". It does not
   name ANY language: WHICH language it is remains decided only by the
   ephemeral message of `Engine.Harness.IdiomaDaResposta`, and the `EngineApiClient` facade
   does not change.
2. **The RN-622/623 guidance stays byte for byte.** Zero extra tokens in the 50
   of the ceiling. `ask_structured_questions` stays OUTSIDE `@ferramentas_de_artefato`
   (it is a question to the person of the turn, [RN-623](#rn-623) item 4), so an `en` author
   in a `pt-BR` project gets the questions in English — which is what is wanted.
3. **Cost, where it falls.** The description travels on every call that carries the
   tool, with any author: measured with `gpt-tokenizer`, only the text that
   changed, +23 tokens in cl100k and +19 in o200k (the `label` line 18/17 → 29/27;
   the example's 8/6 → 20/15). It is not the guidance moving into the description — the
   sentence points to it without naming a language, and what went away was precisely the
   sentence that named one.
4. **Guard.** No harness tool description (the 22 of
   `Engine.Harness.Tools.*`) may cite `pt-BR`, `(en)`, "in English", "em
   português" or "em inglês" — that of `emit_artifact`, which requires the payload KEYS
   "in ENGLISH", is left out because it speaks of a contract, not of text for
   the person.

**What this rule does NOT close, declared:** the paid before/after measurement
**did not run** (no OpenRouter key on the machine of the change) — the "before" is
AT-167's (treated DeepSeek: 8 of 15 replies of C06+C12 with the form in
Portuguese), and the "after" is an **owner's pending item**:
`pnpm --filter @brabo/scripts idioma:validar --arquivo-de-chave ~/.config/brabo/openrouter-test.env --bracos tratamento --casos C06,C12 --rodadas 5 --teto-usd 0.5 --saida ~/.cache/brabo/validacao-idioma/at-282`,
followed by `idioma:validar --relatorio --saida` in the same folder and the review of the
form (`formulario` label of `idioma:revisar`). Suggested ceiling US$ 0.50:
the whole treated arm cost US$ 0.21 (DeepSeek) and US$ 0.94 (Haiku) over
17 cases, and these are 2. The script reads the description from the product file, so it
measures the new text without a copy. If the form stays in Portuguese with the
neutral description, the next step is a conditional clause in the guidance
(only when the call carries `ask_structured_questions`), and it has to fit in the
worst case of RN-623 (44 / 37), which is already at ~48 with the frame.

- **Code:** `apps/engine/lib/engine/harness/tools/ask_structured_questions.ex:193`
  (`descricao`), `:44` (`spec`)
- **Test:** `apps/engine/test/engine/harness/tools/ask_structured_questions_test.exs:199`
  (the description says to follow the reply language), `:207` (names no language
  — failure case: the old form "em pt-BR" is rejected by the same yardstick),
  `:214` (none of the harness tools pins a language);
  `scripts/idioma/validacao.spec.ts:60` (the measurement reads the new description)
- **Origin:** AT-282, from the human review of AT-167 (PR #750, 09/29); entered
  the round approved by the maintainer on 2026-09-30

## The Infra Lead does not announce a start it did not make (RN-668)

### RN-668 — What the Infra Lead's turn announces about starting the container is decided by the code, not by the model's text {#rn-668}

It is [RN-163](#rn-163) ("nothing is announced that the
code will not execute") applied to the Infra Lead. In the real use of 09/29 (session
`be70`, seq 282) he wrote that he would start the container "in parallel" to the infra
PR, and no start `tool.call` came afterwards (AT-264). There were two causes in the
code, and both close here:

1. **The response's whole batch is dispatched before the turn ends.**
   An accepted `propose_infra_pr` ends the turn without a new trip to the model — it is the only
   point where the CODE cuts the loop with the model wanting to continue —, but
   it stopped dispatching in the MIDDLE of the batch: a `propose_container_start` (or
   `container_start_via_runner`) requested in the SAME response, after the PR, vanished
   without `tool.call`, without `tool.result` and without notice. Now it is the Dev Lead's form
   (`propose_execution_plan`): all calls of the response run, and only afterwards
   does the accepted PR end the turn. A second `propose_infra_pr` in the same response
   is refused with a reason (`tool.call` + `tool.result` with `ok: false`) — only the
   first consolidates with Workflows.
2. **The turn's closing says, with a SERVER sentence, when the start was NOT
   proposed** — the form of the Criativo's consolidated outcome (`encerrar/2`). The
   decision is by what the loop executed (was any start proposal ACCEPTED by the api
   in this turn?), never by what the model wrote; its text is not read.
   It speaks in two cases: the turn ended through the PR and no start was
   proposed; or a start was attempted, refused, and no accepted proposal came
   afterwards. A turn that never touched the start (a question, a gate correction)
   gets no sentence at all, and neither does a container already REGISTERED `running`/`provisioning`
   (the same local read as `recusa_ja_de_pe/2`, without HTTP).

The kickoff and the description of `propose_infra_pr` now say what the code does:
the start comes BEFORE the PR or in the SAME response, because the PR ends the turn. That
is help for the model, not the guarantee — the guarantee is the closing of item 2.

Nothing here starts a container or proposes a start, with the refusals by mode and state
intact (RN-566/RN-610). Since [RN-671](api.md#rn-671) (AT-260) the first start
is a SERVER step in the kickoff, marked by the SAME `registrar_subida`: in the
common case it was proposed and the closing of item 2 has nothing to say; it still
speaks when the server's start was refused (or DENIED by the policy, which
since then counts as a refusal) and when it was not up to the server (no
routing, `runner`) and the model did not propose it.

- **Code:** `apps/engine/lib/engine/infra/infra_lead_server.ex:464`
  (`dispatch_calls`), `:560` (`recusa_pr_repetida_no_lote`), `:1173`
  (`registrar_subida`), `:1183` (`fechar_subida`), `:1155`

  (`dispatch_calls`), `:539` (`recusa_pr_repetida_no_lote`), `:1140`
  (`registrar_subida`), `:1150` (`fechar_subida`), `:1154`
  (`desfecho_da_subida`); `apps/engine/lib/engine/infra/tools/propose_infra_pr.ex`
  (the tool description)
- **Test:** `apps/engine/test/engine/infra/infra_lead_server_test.exs:1075`
  (the start requested after the PR in the same response is dispatched — happy path),
  `:1107` (the PR ends the turn without a start and the thread says so — failure case),
  `:1147` (start refused and promised, without a proposal: the closing says so), `:1132`
  (container already up: nothing to say), `:1169` (refusal corrected in the turn: no
  sentence), `:1190` (turn without a start: no sentence), `:1199` (a second
  `propose_infra_pr` in the batch is refused)
- **Origin:** AT-264 (real use of 2026-09-29, item A18 of the analysis)

## Credentialed git runs on the runner's host (RN-676)

### RN-673 — A message that arrives with a turn in progress enters a queue persisted in the log and is read at the end of the turn, N messages in a single turn {#rn-673}

Until now a message that reached a conversational agent in the middle of a turn
was 409 `turno_em_andamento` ([RN-578](#rn-578)): recorded as `chat.message`
(the api records before talking to the engine) and never read. The real use of 09/29
measured three in a single session — PO, Infra Lead and Dev Lead. Owner decision (10/01),
for the SEVEN conversational agents through the same path:

1. **Queue, not refusal.** With a turn in progress, the message enters the agent's queue
   (`TurnoAssincrono.receber_mensagem/4`), the agent records `chat.message_queued`
   (`mensagemId`, `texto`, `idioma`, `posicao`) and the click gets 202 with
   `{entrega: "enfileirada", posicao}`. Without a turn, the turn starts right away, as
   always (`entrega: "lida"`). The api route also returns the `mensagemId` — the
   id of the `chat.message`.
2. **N messages = 1 turn.** At the END of the turn (`finalizar/1`, never
   `suspender/1`) the pending ones become ONE turn, in order of arrival, in a single text
   (`FilaDeMensagens.texto_do_turno/1`: one is itself; several, numbered), and the
   agent records `chat.message_delivered` with the ids. Delivery is a message to
   itself, after the server's closing (the Infra Lead's gate correction and the
   Arquiteto's handoff come first). A message that arrives between the end of the turn
   and the delivery goes to the END of the queue, and the queue is delivered right away.
3. **Ceiling of 10** pending per agent and session. The 11th is 409
   `fila_de_mensagens_cheia`, with a durable `agent.error` of origin `politica` —
   it is recorded and will not be read.
4. **Cancel.** `POST …/agents/:agent/messages/:messageId/cancel`
   (`developer`, the message route's minimum): only the SENDER (403
   `mensagem_de_outra_pessoa`), only in a session that accepts conversation
   ([RN-581](api.md#rn-581)). Whether it is still in the queue is decided by the agent's
   process, which serializes the race with the delivery: 409 `mensagem_fora_da_fila`
   when it was already read or cancelled. The engine records `chat.message_cancelled` on
   behalf of whoever cancelled; with the agent down, it records directly (the queue is the log).
5. **Persisted in the log, never in a table.** Pending = queued and neither
   delivered nor cancelled — the same derivation in the engine and on the screen. The
   `init/1` of the seven rebuilds the queue and schedules delivery; [RN-580](#rn-580) removes from the
   history the cancelled one and the agent's own pending one; at boot, after
   closing the orphan turn ([RN-586](#rn-586)), the agent with a pending queue is
   woken up. The interrupted turn is still never redone.
6. **A turn suspended on approval** (Dev Lead, RN-284) keeps refusing with
   `aguardando_aprovacao` — with no foreseeable end, queuing would promise a reading with no
   date. A queue that already existed waits for the resumption to finish.
7. **The screen.** With a turn in progress the composer no longer locks for a message to an
   agent: the button becomes "Pôr na fila" and the message does not arm a new turn. In the thread,
   "na fila de <agente>" with Cancelar for the author, and "cancelada" struck through. The
   chat without an agent still locks.

The `turno_em_andamento` refusal remains for what is not speech: the PO's story
review, the Criativo's readiness, the Arquiteto's handoff offer.

- **Code:** `apps/engine/lib/engine/agents/turno_assincrono.ex:301`
  (`receber_mensagem`), `:245` (`tratar_resultado`), `:461` (`entregar_fila`),
  `:346` (`cancelar_mensagem`), `:392` (`fila_ao_subir`), `:497`
  (`emitir_recusa_por_fila_cheia`);
  `apps/engine/lib/engine/agents/fila_de_mensagens.ex:71` (`pendentes`), `:97`
  (`fora_do_historico`), `:143` (`texto_do_turno`), `:164`
  (`acordar_pendentes`);
  `apps/engine/lib/engine/agents/reidratacao.ex:160` (`fora_do_historico`);
  `apps/engine/lib/engine/agents/dev_lead_server.ex:245` (`_mensagem_id`);
  `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:393`
  (`cancel_queued_message`), `:461` (`responder_ao_aceite`);
  `apps/api/src/application/use-cases/agents/cancel-queued-agent-message.use-case.ts:35`
  (`CancelQueuedAgentMessageUseCase`);
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts:65`
  (`entregaDaResposta`);
  `apps/api/src/domain/sessions/conversa-em-sessao-encerrada.ts:72`;
  `apps/web/src/lib/fila-de-mensagens.ts:27` (`estadosNaFila`);
  `apps/web/src/lib/enfileirar-mensagem.ts:25` (`useEnfileirarMensagem`);
  `apps/web/src/routes/PainelDaFila.tsx:20` (`PainelDaFila`, que substituiu o selo — RN-978)
- **Test:** `apps/engine/test/engine/agents/fila_de_mensagens_test.exs:156`
  (enters the queue — happy path), `:181` (N messages = 1 turn), `:223` (the
  one arriving in the window goes to the end), `:246` (ceiling of 10 — failure case), `:276`
  and `:306` (cancel and cancel outside the queue), `:322` (restart), `:349` (suspended Dev
  Lead), `:78`/`:120` (derivation and rehydration);
  `apps/engine/test/engine_web/controllers/agent_command_controller_test.exs:70`;
  `apps/api/test/application/use-cases/agents/cancel-queued-agent-message.use-case.spec.ts:40`,
  `:61` (another person — failure case), `:95`, `:106`;
  `apps/api/test/application/use-cases/agents/send-agent-message.use-case.spec.ts:74`;
  `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts:531`;
  `apps/web/src/routes/SessionPage.fila-de-mensagens.test.tsx:163`, `:189`
  (full queue), `:207`, `:233`; `apps/web/src/lib/fila-de-mensagens.test.ts:17`
- **Origin:** AT-267 (item A21 of the analysis of the real use of 2026-09-29), owner
  decision of 10/01; [ADR 0191](../adr/0191-a-mensagem-com-turno-em-curso-entra-numa-fila.md)

## The test plan is born after the dev's delivery (RN-674, ADR 0192)

### RN-674 — The QA-strategy writes the plan over the DELIVERED code, at the start of the `qa-verificada` cycle, and `implementavel` is judged without it {#rn-674}

In the real use of 09/29 the PRE-DEV test plan ([RN-341](contracts.md#rn-341)) ended
twice in `toolloop.limit_reached` 8/8 without `emit_plano_de_teste`: the loop
read docs, empty RAG and folders until concluding that "the code does not exist yet". The
owner decided (10/01) for option (b): the plan is born AFTER delivery.
[ADR 0192](../adr/0192-plano-de-teste-depois-da-entrega.md) revises 0090 on that
point, and the rule has four parts:

1. **The plan is the first step of the review cycle.** The `QaLeadServer`'s `run_area/3`
   obtains the delivery's plan BEFORE the subspecialties
   (`plano_de_teste_da_entrega/5`): it finds again in the session tail (rehydration
   ceiling, [RN-580](#rn-580)) the `artifact.plano_de_teste` of the SAME
   `taskId` — the correction round does not pay for another loop —, and otherwise runs
   `QaEstrategiaAgent.run/6` with the dev's worktree as `workspace_root`, the
   task's business rules and the list of files the delivery touched
   (`git diff dev...HEAD`, up to 40 names). A diff that fails becomes text ("não
   consegui listar: motivo"), never an empty list.
2. **The plan is INPUT, never a verdict.** It reaches the Automação at the END of its
   message, for the step of finding which test covers each rule; the verdict
   yardstick does not change (one `coverageMatrix` row per story rule,
   `approved` only with a green suite and every rule covered) and the external contract
   remains ONE `qa_verdict` per cycle. A plan that FAILS does not hold the review:
   the QA-strategy records `agent.error` with origin ([RN-059](#rn-059))
   and the Automação receives the usual message, byte for byte.
3. **`implementavel` is judged over the story and the `module_map`.**
   `run_assessment/2` neither reads nor triggers a plan: it proposes the verdict on the FIRST
   call, over what the Dev Lead's kickoff already gives it, with payload
   `storyId`/`parecer`/`justificativa`. Gate, owner, severity `warn` and
   human approval do not change; only the `entrada` (`[story-ready, module_map]`).
   The appsec ([RN-539](#rn-539)) keeps triggering there, in design.
4. **The ceiling stays 8.** `"qa-estrategia"` gets no clause in
   `Iteracoes.tipo/1`; what changed was the input. The agent now runs under the
   `task_budget_micros` that the subspecialties share
   ([RN-036](#rn-036)).

`run_design/3`, `Dispatcher.run_qa_estrategia/3` and `QaEstrategiaContext`
were removed, and `artifact.plano_de_teste` now requires `taskId`. Declared and not
decided here: whether the plan's executable criteria should become MANDATORY rows
of the `coverageMatrix` (and therefore fail a delivery).

- **Where:** `apps/engine/lib/engine/gates/qa_lead_server.ex:190` (`plano_de_teste_da_entrega`),
  `:715` (`plano_de_teste_da_entrega`), `:716` (`plano_ja_emitido`),
  `:721` (`arquivos_alterados`);
  `apps/engine/lib/engine/gates/qa_estrategia_agent.ex:86` (`run`),
  `:104` (`token_budget_micros`), `:188` (`descrever_arquivos`);
  `apps/engine/lib/engine/gates/qa_automacao_agent.ex:207` (`com_o_plano`);
  `apps/engine/lib/engine/agents/dev_lead_tools.ex:457` (`run_assessment`),
  `:538` (`propor_parecer`);
  `apps/engine/lib/engine/harness/artifact_schemas.ex:59` (`taskId`);
  `docs/gates.yml` (`qa-verificada`, `implementavel`); `docs/fluxo.yml`
  (`qa-estrategia`, `area-qa`, `dev-lead`)
- **Test:** `apps/engine/test/engine/gates/qa_lead_server_test.exs`, describe
  "plano de teste da entrega (ADR 0192)" — the plan before the Automação and inside
  its message (happy path), reuse by `taskId`, another task's
  plan that does not count, and the plan that fails without holding the review (failure
  case); `apps/engine/test/engine/gates/qa_estrategia_agent_test.exs` (the
  delivery's files in the message, the diff that failed, `taskId` in the artifact);
  `apps/engine/test/engine/agents/dev_lead_tools_test.exs`, describe
  "assess_implementability (ADR 0090, insumo do ADR 0192)" (verdict on the
  first call, payload without a plan); `dev_lead_server_test.exs`
  ("assess_implementability pending TAMBÉM suspende"); `apps/engine/test/engine/harness/artifact_schemas_test.exs`
  ("sem taskId é rejeitado"). ExUnit: proven only in CI (`repo.hex.pm` gave
  403 in the round's environment).
- **Origin:** AT-269 (item A23 of the analysis of the real use of 09/29); owner
  decision on 10/01

## The Anamnese switched back on: eligible subject and profile fact (RN-680)

### RN-680 — The Anamnese does not run without an eligible subject, and the hypothesis the person themselves accepted becomes a fact of their profile in the graph and enters the context of the agents that talk with them {#rn-680}

Owner decision on 10/01 (AT-277): **switch the Anamnese back on with fixes**. In the
real use of 09/29 it ran six times and all six ended in
`anamnese.run_skipped` ("no eligible member"), written by the MODEL after
a paid call (8,933 micros), and the three accepted hypotheses stayed in the queue
with no destination. See [ADR 0196](../adr/0196-anamnese-religada-com-sujeito-e-fato-do-perfil.md).

1. **Without an eligible subject, the round does not run.** A subject is an EFFECTIVE member of the
   project (`projectRole ?? workspaceRole`, the yardstick of [RN-471](web.md#rn-471)),
   outside the opt-out, with OWN interaction in what the round shows the model —
   an event of theirs with `actor_kind: "user"` in the window, or a decision of theirs. The guard
   comes BEFORE triage and not even the queued hypothesis gets past it. Without a subject:
   no LLM call and no RAG search; the reason goes NAMED to the
   engine log (`sem_sujeito_elegivel`, with `nenhum_membro` or
   `nenhuma_interacao_propria` and the numbers) and, in a manually requested round,
   also to the event log (`anamnese.run_skipped` with
   `causa: "sem_sujeito_elegivel"`). Through the tick it is only a log — it would be a notice every
   15 minutes per project. The prompt now lists only the subjects.
2. **A project member is the EFFECTIVE one.** Creating a project does not write
   `project_members`, and the Anamnese read only that table — the workspace owner
   was never a member. The Anamnese's three use cases now read
   `listEffectiveMembers`; `listMembers` remains only `project_members`.
3. **A hypothesis ACCEPTED by the person THEMSELVES becomes a profile fact.** The
   `psychologist.hypothesis_accepted` carries `projectId`, `sujeito` (the author
   of the analyzed session), `hipotese`, `sugestao` and `fatoDoPerfil`, and the
   `GraphEventTranslator` — the same one as the projector and `grafo:reprojetar` —
   translates it into `(:FatoDoPerfil {hypothesisId})`, linked to the person (`SOBRE`) and to the
   project (`NO_PROJETO`). `fatoDoPerfil` is only `true` when the one who accepted is the
   subject: a fact about a person is never born from someone else's click, and the payload
   says why (`motivoSemFato`). A declined one is only recorded, as before.
   Acceptances recorded before this RN lack the fields and do not become facts.
4. **The fact enters the context of the agents that talk with the person.** The
   author's message to a conversational agent carries THEIR facts in this
   project — read by `QueryUserContextUseCase`, scoped to the project, the 5
   most recent, with the total beside them and the cut stated —, and the engine puts them in the
   turn as an EPHEMERAL `system` message, through the same path as the language
   ([RN-622](#rn-622)): never in the history, before the language guidance, with a
   ceiling of 2,000 characters. Graph down becomes a log, and the turn goes on without the
   facts. A turn without an author receives no facts.
5. **Switched back on.** `ANAMNESE_ENABLED` returns to default `true` in `runtime.exs` and
   in the three composes; `START_ANAMNESE` does not change (the production one stays `false`,
   an already declared divergence). The Psicólogo stays paused.

- **Code:** `apps/engine/lib/engine/anamnese/elegibilidade.ex:59` (`avaliar`);
  `apps/engine/lib/engine/workers/anamnese_worker.ex:63` (`maybe_analyze`),
  `:97` (`narrar_sem_sujeito`);
  `apps/api/src/domain/iam/membros-efetivos.ts:16` (`membrosEfetivos`);
  `apps/api/src/infrastructure/persistence/drizzle/project.repository.ts:209` (`listEffectiveMembers`);
  `apps/api/src/application/use-cases/execution/accept-hypothesis.use-case.ts:75` (`fatoDoPerfil`);
  `apps/api/src/application/graph-projection/graph-event-translator.ts:171` (`projectProfileFact`);
  `apps/api/src/application/use-cases/graph/query-user-context.use-case.ts:68` (`fatos`);
  `apps/api/src/domain/graph/perfil-do-autor.ts:30` (`textoDoPerfilDoAutor`);
  `apps/api/src/application/use-cases/agents/send-agent-message.use-case.ts:111` (`resolverPerfil`);
  `apps/engine/lib/engine/harness/perfil_do_autor.ex:68` (`anexar`);
  `apps/engine/lib/engine/harness/idioma_da_resposta.ex:253` (`com_idioma_do_autor`);
  `apps/engine/config/runtime.exs:315` (`anamnese_enabled?`)
- **Test:** `apps/engine/test/engine/anamnese/elegibilidade_test.exs:17`
  (happy path), `:35` and `:46` (no subject — failure cases);
  `apps/engine/test/engine/workers/anamnese_worker_test.exs:305` (no member,
  not even with a queue, does not call the LLM), `:324`, `:343` (manual round narrates), `:360`;
  `apps/engine/test/engine/anamnese/context_builder_test.exs:82`;
  `apps/api/test/infrastructure/persistence/drizzle/project-effective-members.repository.spec.ts:69`;
  `apps/api/test/application/use-cases/execution/accept-dismiss-hypothesis.use-case.spec.ts:136`,
  `:156` (a third party's acceptance does not become a fact);
  `apps/api/test/application/graph-projection/graph-projector.spec.ts:361`, `:386`;
  `apps/api/test/application/use-cases/agents/send-agent-message.use-case.spec.ts:181`,
  `:207` (graph down);
  `apps/engine/test/engine/harness/perfil_do_autor_test.exs:14`;
  `apps/engine/test/engine_web/controllers/agent_command_controller_test.exs:428`
- **Origin:** AT-277 (item A31 of the analysis of the real use of 09/29; owner decision
  on 10/01)

## The RN-418 ceiling also applies through the typed door (RN-689)

### RN-690 — The assistant keeps the response's `toolCalls`: the tool result does not reach the provider orphaned {#rn-690}

The conversational agents with their own loop (Criativo, PO, Arquiteto, Dev Lead,
UX Designer, Staff and Infra Lead) kept in the history the assistant's
message WITHOUT the response's `toolCalls` and, right after, the
`role: "tool"` message with the `toolCallId`. On the wire, the provider received a result that
answered no call and discarded it: the model never saw what the
tool returned and repeated the same call up to the loop ceiling (measured in
v7.0.0: the PO called `listar_regras_de_negocio` 12 of 12 times in two turns).

The assistant's message now carries the response's NATIVE `toolCalls`
when there are any — the same format the `ToolLoop` already kept and that the
`ContextManager` groups on compaction —, assembled in a single place. A response without
`toolCalls` does not get the key. A call recovered from text (`ToolCallRecovery`,
null id) stays out: there is no id to match. The api already passed the field on to the
providers (`toWireMessage` in OpenAI-compatible, `tool_use` in Anthropic); the
rehydration still brings tools as text.

- **Where:** `apps/engine/lib/engine/agents/mensagem_do_assistente.ex:17` (`de`);
  `apps/engine/lib/engine/agents/po_server.ex:280`, and the same point in the other six servers
- **Test:** `apps/engine/test/engine/agents/po_server_test.exs:93` (the second
  call carries the `assistant` with `toolCalls` right before the `tool` that
  answers it; the final answer, without a tool, does not get the key — failure case)
- **Origin:** AT-350

### RN-695 — The Anamnese's analysis does not enter the session thread {#rn-695}

Measured in the real use of v7.0.0: the text the Anamnese's model writes during
the round ("Analisando a janela do log… usuário (09824667-…)… Decisão de
proficiência") appeared as a BUBBLE in the ideation session's thread, between the
Criativo and the PO, with the user's raw UUID. The Anamnese does not converse with
anyone: it analyzes the PERSON, and what it produces is the profile
([RN-680](#rn-680)).

**The rule:** the round's text is recorded as `anamnese.analysis`, never as
`agent.response`. The `ToolLoop` accepts `response_event` in the context (default
`agent.response`, unchanged for every other consumer) and the Anamnese sets it.
The session thread draws NO event whose actor is the `anamnese` agent —
including the `agent.response` recorded before the fix. The session's log panel
keeps showing its events; the result lives in Configurações ›
Perfil de proficiência, without a raw id. No "profile updated" marker enters
the thread: it is left out until someone asks.

- **Where:** `apps/engine/lib/engine/harness/tool_loop.ex:124` (`loop`);
  `apps/engine/lib/engine/workers/anamnese_worker.ex:157` (`build_ctx`);
  `apps/web/src/routes/session-timeline-montagem.tsx:115` (`ehDaAnamnese`)
- **Test:** `apps/engine/test/engine/workers/anamnese_worker_test.exs:253`
  (the text comes out `anamnese.analysis`; `agent.response` is never recorded — failure
  case); `apps/web/src/routes/session-timeline-montagem.falha-de-turno.test.tsx:86`
  (the Anamnese's answer vanishes from the thread, the Criativo's stays)
- **Origin:** AT-355

### RN-697 — The Criativo's readiness turn only synthesizes: no tools {#rn-697}

The turn that `confirm_readiness` triggers consolidates the rules into a summary and records the
`product_brief`. In real use (v7.0.0, Haiku 4.5) it took 25 s and recorded four more
`artifact.business_rule` and a `chat.structured_question` that nobody
would answer: the PO had already joined through the implicit acceptance (RN-658). The turn now
goes to the model WITHOUT a tool catalog, and no call is served in it —
not even one the model copies from the history. The catalog comes back intact on the following
turn; the normal turn keeps `emit_artifact` and
`ask_structured_questions`.

- **Where:** `apps/engine/lib/engine/agents/criativo_server.ex:218` (`executar_confirm_readiness`);
  `:263` (`ferramentas_da_prontidao`)
- **Test:** `apps/engine/test/engine/agents/criativo_server_test.exs:172` (the turn
  goes with `tools: []` and records neither a rule nor a question) and `:192` (regression: the normal
  turn keeps both tools)
- **Origin:** AT-352

### RN-698 — The turn's text becomes ONE answer, and the iteration ceiling appears in the thread {#rn-698}

With tools, the model writes in pieces — a stretch before the call, another
on the next round, often continuing the same sentence. Each round became
its own `agent.response`, and the thread collapses the earlier ones into "Passos do turno": on
show stayed only the last piece (" histórias e tarefas que cubram tudo.",
starting with a space). The transport lost nothing — the api's `final` frame
carries the whole text of the ROUND —; what was split was the TURN. In the seven
conversational agents, the text of a round with a tool is accumulated in the turn's
process and recorded in a single `agent.response` only when the turn closes (no tool,
ceiling, failure, Dev Lead suspension, Infra PR). A piece that starts or ends
with a space goes in as it came; two pieces stuck together become paragraphs.

The conversational agents' `toolloop.limit_reached` (RN-166) now becomes a line
in the thread, in the failure bubble, origin `modelo`, stating the ceiling ("parou no teto de N
passos sem terminar o turno"); without the number in the payload the line says `?`.

The turn's `agent.response` carries `modelName` (RN-146) in EVERY outcome, not
only in the tool-less closing: when the turn closes without a final call that
brings it (it delivered an `ask_structured_questions` form, exhausted the ceiling,
failed), the model of the last accumulated round applies. With no LLM call having
returned a model, the field stays `nil` — never an invented model (AT-384; the
Infra Lead records `modelName` in no outcome and stays out).

**Revision (owner decision, 10/03, AT-395): only the turn's closing in the bubble.** In
real use (loja-teste-2, 10/02) the single answer joined the text of ALL the
rounds ("Vou registrar… Excelente! Registrei…", two summaries in a row in the PO).
The turn's `agent.response` is still ONE, but `content` now is only the
CLOSING — the text of the last round that wrote something (a turn that ends in a
form, with no text in the last round, keeps the previous one) — and the text of the
earlier rounds goes, in order, in the `passos` field, absent when there are none.
Nothing vanishes: the thread draws each step as narration of the same turn+author before
the closing, and the "Passos do turno" collapse that already existed folds them, closed
by default; the steps do not count in the thread's message cut (RN-644). The
rehydration (RN-580) returns `passos` BEFORE `content`, in the same
`assistant`, so the model does not lose what it said mid-turn. It applies to the
seven conversational agents (the Infra Lead too, without `modelName`). No ceiling of its own
for `passos`: the accumulation was already recorded whole before the revision.

- **Where:** `apps/engine/lib/engine/agents/texto_do_turno.ex:83` (`descarregar`);
  `:111` (`juntar`); `:51` (`descarregar_com_modelo`); `:65` (`payload_do_turno`);
  `apps/engine/lib/engine/agents/reidratacao.ex:177` (`acumular`);
  `apps/web/src/routes/session-timeline-montagem.tsx:809` (`passos`)
- **Test:** `apps/engine/test/engine/agents/texto_do_turno_test.exs:43` (three
  rounds: closing and two steps), `:56` (one round, without `passos`), `:60` (ends
  in a form); `apps/engine/test/engine/agents/reidratacao_test.exs`
  (steps before the closing); `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx:502`
  (only the closing on show, steps on expanding) and `:524` (no steps, nothing extra);
  `apps/engine/test/engine/agents/criativo_server_test.exs:209` (two
  rounds, one whole answer; no second one), `apps/engine/test/engine/agents/texto_do_turno_test.exs`
  and `apps/web/src/routes/session-timeline-montagem.falha-de-turno.test.tsx:85`
  (the ceiling line; without a number, it does not invent one); the model in the form in
  `apps/engine/test/engine/agents/criativo_server_test.exs:703` (with model) and
  `:724` (without model, `nil`)
- **Origin:** AT-354, AT-384, AT-395

### RN-699 — The Dev Lead reads the current module_map and the PROJECT backlog, and rereads both when the plan is refused {#rn-699}

Measured in real use (10/02): with the Dev Lead accepted, he replied that the
module_map was missing — and the map existed. The kickoff looked for the
`architecture.module_map_created` event, which NO code emits (the Arquiteto records the
map through the api), and always fell into "(sem module_map)". The map now comes from the SAME
project read the AppSec uses (`get_infra_context`, the api's current one),
never from a session event; without a map, the kickoff says there is none.

In the same use, the tasks were born AFTER the kickoff, the Dev Lead invented a
`task_id`, the api refused the plan and the turn ended without a new attempt. He gets
`read_backlog`: a CONTAINED read, without parameters, scoped to the project (the
pending tasks through the same route as the PO's `listar_backlog`, a ceiling of 200 lines stating
the real total, and the current module_map). The api's refusal goes back to the loop saying
to call `read_backlog` and fix it; and only a successful `propose_execution_plan`
ends the turn — before, any successful tool in the
last call (a read, an `emit_artifact`) ended it. The kickoff instruction
forbids inventing `task_id` and asks him to only say he assessed the
stories on which he called `assess_implementability`.

- **Where:** `apps/engine/lib/engine/agents/dev_lead_tools.ex:339` (`module_map_vigente`);
  `:324` (`spec_read_backlog`); `:340` (`tarefas_do_backlog`);
  `apps/engine/lib/engine/agents/dev_lead_server.ex:557` (`kickoff_instruction`);

- **Where:** `apps/engine/lib/engine/agents/dev_lead_tools.ex:339` (`module_map_vigente`);
  `:324` (`spec_read_backlog`); `:372` (`tarefas_do_backlog`);
  `apps/engine/lib/engine/agents/dev_lead_server.ex:557` (`kickoff_instruction`);
  `:393` (`run_turn`)
- **Test:** `apps/engine/test/engine/agents/dev_lead_server_test.exs:164` (the
  current map reaches the kickoff and the old type is not read), the following test
  (without a map, says there is none — failure case) and `:202` (plan refused by the api →
  `read_backlog` in the same turn, with the real tasks)
- **Origin:** AT-362, AT-363

### RN-700 — The PO does not announce the handoff to the Arquiteto without doing it, and a story without tasks is not delivered {#rn-700}

In real use the PO wrote "Handoff ao Arquiteto" and ended the turn without calling
`offer_handoff` (violating RN-163), and delivered five `ready` stories with zero
tasks — the Dev Lead had nothing to distribute. At the end of every PO turn,
if the server has not yet recorded an offer to the Arquiteto in that process, it reads
the project's rules (`uncoveredCount`, the same coverage as the automatic acceptance
of RN-660) and the backlog: with every rule covered and every story with ≥ 1 task,
the SERVER offers the handoff (the mold of the Infra that proposes on its own, ADR 0190,
RN-671/672), and RN-660 keeps deciding the acceptance. With rules covered and a story
without tasks, it does not offer and records `backlog.handoff_not_offered` (origin `modelo`)
naming the stories; a read or offer that fails records the same event with
origin `infra`. An uncovered rule, or a backlog without rules/stories, is not judged.
The PO's instruction now requires a task per story. The one who creates the tasks is the
PO (decision of the main agent in AT-364: he already has `create_task`).

- **Where:** `apps/engine/lib/engine/agents/po_server.ex:475` (`fechar_handoff`);
  `:502` (`oferecer_handoff`)
- **Test:** `apps/engine/test/engine/agents/po_server_test.exs:592` (offers and
  does not repeat), `:610` (story without tasks: does not offer, names)
- **Origin:** AT-364

## The installer offers the local models, and does not mistake dev for an installation (RN-691, RN-692)

### RN-702 — Context compaction respects the default 128k window and never swaps turns for an empty marker {#rn-702}

- **Rule:** without `context_window` in the context (the conversational agents do not
  declare it), the compaction window is `DEFAULT_CONTEXT_WINDOW`, whose default
  went from 8,192 to 128,000, the same value the gate and dev agents
  declare. When the summarizer (`context-manager`) fails or returns empty
  text, the summary is DETERMINISTIC (an excerpt of up to 300 characters of each
  replaced turn) and `context.compacted` records `summaryOrigin:
  "deterministico"` and `falha` with `origem` and `motivo` (RN-059). With the
  summarizer responding, `summaryOrigin: "modelo"` and `falha: null`.
- **Measurement (AT-366):** session 17d41c20, Arquiteto on
  `anthropic/claude-haiku-4.5` (200k window): 6,799 tokens exceeded
  `0.7 × 8,192 = 5,734` and compacted 35 turns; the summarizer failed and the
  recorded summary was the marker `"(35 turnos anteriores omitidos)"`. On the next
  turn the Arquiteto asked again for a confirmation it had already received.
- **Where:** `apps/engine/lib/engine/harness/context_manager.ex:157` (`summarize`),
  `apps/engine/lib/engine/harness/context_manager.ex:188` (`resumo_deterministico`),
  `apps/engine/config/runtime.exs` (`default_context_window`)
- **Test:** `apps/engine/test/engine/harness/context_manager_test.exs`
  ("sem context_window declarado: 6,8k tokens NÃO compactam"; "sumarizador
  respondendo: summaryOrigin modelo, sem falha"; failure case: "sumarizador
  falhando: falha NOMEADA com origem e resumo determinístico com o conteúdo")
- **Declared gap:** the window is still not read from the per-model catalog
  (the engine does not receive the binding's `context_window`); 128k is the
  installation default, adjustable through `DEFAULT_CONTEXT_WINDOW`.
- **Origin:** AT-366

### RN-706 — The execution agent knows where it is: folder, image, network, typed git and its own module {#rn-706}

- **Rule:** the dev agents (`dev-*`) and the QA subagents (`qa-*`) receive on
  every LLM call an EPHEMERAL environment `system` message, through the same
  path as the language (RN-622) and the author's profile (RN-680) — never in
  `state.messages`, never per server. It states the real folder in which the
  `terminal` runs (the loop's `workspace_root`, translated to `/work` by the
  same rule as `TerminalExecutor` when there is a REGISTERED `running` container),
  the image and network of the last `artifact.project_image`, that `git`
  is not run in the terminal (use `git_commit`/`git_push`/`pr_open`) and, for the dev
  agent, ITS MODULE: what it consumes from another module comes from the contract
  (`listar_contratos_de_modulos`) and is used through stub/mock, never reimplemented,
  and root files that already exist on `dev` (`package.json`, lockfile) are not
  recreated. Without a `running` container, the message SAYS so and does not assert `/work`.
  Ceiling of 1,200 characters; a read failure becomes an absent message, never a
  crashed turn.
- **Measurement (AT-379/AT-378, 10/02, loja-teste):** `dev-api` and `qa-automacao`
  ran `cd /workspace` (no prompt cites that folder); `git status` gave
  exit 127 in an image without git; `dev-api` (module `api`) created
  `src/catalog.js` and `package.json`, the same as `dev-catalog`'s, and the merge
  conflicted.
- **Where:** `apps/engine/lib/engine/harness/ambiente_do_agente.ex:102` (`montar`),
  `:48` (`com_ambiente`), `:65` (`anexar`),
  `apps/engine/lib/engine/harness/tool_loop.ex:87` (`com_ambiente`)
- **Test:** `apps/engine/test/engine/harness/ambiente_do_agente_test.exs`
  ("caminho feliz: com container running, a pasta é /work/.worktrees/<agente>";
  failure case: "sem container running, não afirma /work")
- **Declared gap:** no notice in the `git_commit` result for a file
  of another module (the `module_map` does not say which paths belong to each module,
  so the notice would not be deterministic) and no commit block, by
  owner decision.
- **Origin:** AT-379, AT-378

### RN-707 — The SecOps gate's semgrep has a writable `$HOME`, and the output-less failure is named {#rn-707}

- **Rule:** in the production and installation composes, the engine's tmpfs `/home/engine`
  is born owned by the image's user
  (`/home/engine:uid=1000,gid=1000,mode=0700`). `SemgrepDetector.Live`
  distinguishes exit `1` with JSON (findings) from exit `0`/`1` with empty stdout,
  which becomes `{:error, {:sem_saida, exit_code}}` instead of `:invalid_output`.
  The gate's verdict does NOT change: a scanner that did not run is still "skipped" in the
  verdict's summary.
- **Measurement (AT-380):** inside `brabo-engine-1` (production image,
  `read_only: true`), the tmpfs `/home/engine` was born `root` `2755`; the
  gate's `semgrep scan` exited `1` with empty stdout and
  `PermissionError: '/home/engine/.semgrep'` on stderr, and the parser called
  that `:invalid_output`. With the tmpfs `uid=1000` the same command returns the
  JSON (exit 0). Kubernetes did not have the defect (`fsGroup: 1000` on the
  `emptyDir`).
- **Where:** `apps/engine/lib/engine/actions/semgrep_detector.ex:73`
  (`interpretar`), `docker/docker-compose.prod.yml`,
  `docker/docker-compose.install.yml`
- **Test:** `apps/engine/test/engine/actions/semgrep_detector_test.exs`
  ("JSON com results vira findings, inclusive com exit 1 (achou algo)"; failure
  case: "exit 1 com stdout vazio é falha de execução nomeada, não
  :invalid_output")
- **Decision (revised by [RN-714](#rn-714)):** the sentence "the gate's verdict
  does NOT change" no longer applies: the owner decided (10/02) that SAST that did not run
  leaves the gate PENDING and blocking.
- **Origin:** AT-380

### RN-710 — Workflows is not delegated without a CI that runs, and asks no one {#rn-710}

On the Infra's acceptance, `infra-workflows` replied with a question ("what is the
project repository's provider?") that no human receives — a subagent does not
converse —, and the delegation ended `failed` with origin `modelo` and a
generic `dev.error` in the thread (measured in loja-teste, 10/02). The project was
`local`: a bare repository on the server, with no CI runner.

- Provider `local` or absent: delegation to Workflows is **dispensed**
  (`delegation` `dispensed`, with the named justification — "repositório local
  … não tem CI que rode"), and the infra PR goes out with only what the Lead produced.
  Only `github` and `gitlab` delegate.
- When it delegates, the prompt says that the received provider ALREADY is the project's and
  forbids asking.
- A subagent that stops with TEXT instead of calling the tool is still a named
  failure reported to the lead, but the diagnosis says what it asked for: "pediu
  informação que não recebeu, em vez de chamar emit_infra_delegation_result:
  <texto>" (up to 300 characters).
- The infra PR's title carries the `infra: ` prefix only when the model's summary
  does not already start with it (case-insensitively) — before, it came out
  "infra: infra: Dockerfile…" (AT-396).

- **Where:** `apps/engine/lib/engine/infra/workflows_agent.ex:61` (`dispensa`),
  `apps/engine/lib/engine/infra/infra_lead.ex:69` (`com_prefixo`),
  `apps/engine/lib/engine/infra/workflows_agent.ex:184` (`parada_sem_ferramenta`),
  `apps/engine/lib/engine/infra/infra_lead_server.ex:1217` (`finalize`)

  `apps/engine/lib/engine/infra/infra_lead_server.ex:1217` (`finalize`)
- **Test:** `apps/engine/test/engine/infra/workflows_agent_test.exs` ("RN-710: …")
  and `apps/engine/test/engine/infra/infra_lead_server_test.exs` ("RN-710:
  repositório local dispensa o Workflows …") and
  `apps/engine/test/engine/infra/infra_lead_test.exs` ("com_prefixo/1 (AT-396)")
- **Origin:** AT-368, AT-396

### RN-711 — The conversational agent knows where it is in the flow, and the user's technical restriction becomes a decision_record {#rn-711}

- **Rule:** the seven conversational agents (Criativo, PO, Arquiteto, Infra,
  Dev Lead, UX Designer, Staff) receive on every LLM call an EPHEMERAL
  `system` message with the delivery flow — the seven stages in order (Criativo →
  PO → Arquiteto → Infra → Dev Lead → dev agents → QA/SecOps → manual merge),
  WHERE the agent is, the real NEXT step and WHO triggers it (human ×
  system) —, through the `EngineApiClient` facade, after the environment (RN-706) and
  before the profile (RN-680) and the language (RN-622, always the last). The source is
  ONE, `Engine.Harness.FluxoDoTime`, checked by a test against
  `docs/fluxo.yml`: every role cited exists there as `active`, and the text does not
  cite a stage outside it (deploy, pipeline, Dockerfile, InfraAgent). The Criativo
  records the user's EXPLICIT technical restriction (language, "no
  dependency", "no network", "a single module") as a `decision_record`
  (`emit_artifact`, RN-505), without a lecture; the Arquiteto's kickoff reads the
  session's `artifact.decision_record` (the same read by type, RN-580) and
  says to respect them, stating WHICH and WHY when going against one. The
  Arquiteto's wrap-up does not ask again for a confirmation already given, and the Infra does not paste the
  files into the chat nor promise deploy.
- **Measurement (AT-369/AT-370, 10/02, loja-teste):** the Criativo announced the
  Arquiteto as next (it is the PO); the PO said the Arquiteto would "implement";
  the Arquiteto, that "dev agents start" after the ADRs, and asked "Confirme:
  Arquitetura pronta" after the confirmation; the Infra dumped ~80 lines of
  compose into the thread. The request "Node puro, nenhuma dependência, sem rede, um módulo
  só" did not become an artifact and the Arquiteto created three modules.
- **Where:** `apps/engine/lib/engine/harness/fluxo_do_time.ex:107` (`texto`),
  `:97` (`anexar`), `apps/engine/lib/engine/sessions/engine_api_client.ex:647`

  `:97` (`anexar`), `apps/engine/lib/engine/sessions/engine_api_client.ex:700`
  (`llm_turn`), `apps/engine/lib/engine/harness/agents.ex:23` (`identity`),
  `apps/engine/lib/engine/agents/arquiteto_server.ex:388` (`build_kickoff`)
- **Test:** `apps/engine/test/engine/harness/fluxo_do_time_test.exs`
  ("todo papel citado existe no fluxo.yml como ativo"; failure case: "nenhum
  texto cita etapa/agente fora do fluxo"),
  `apps/engine/test/engine/agents/arquiteto_server_test.exs` ("kickoff lê os
  decision_record e manda respeitar \"um módulo só\""),
  `apps/engine/test/engine/harness/agents_test.exs`
- **Declared gap:** the Arquiteto's `decision_record` read is the
  SESSION's (like the kickoff's rules and stories), not the whole project's; and
  nothing REFUSES a `create_module_map` that goes against the restriction — the instruction
  asks for the justification, it does not impose it.
- **Origin:** AT-369, AT-370

### RN-714 — SAST that did not run leaves the SecOps gate pending, never approved {#rn-714}

- **Rule:** when the SecOps gate's semgrep does not run — missing binary,
  invalid output (`:invalid_output`), `:sem_saida`, exception or time ceiling
  —, no verdict is recorded: the PR stays in `awaiting_secops`, the gate
  stays PENDING and blocking, and the PR does not reach the user as approved by
  SecOps. The reason goes to the thread as an `agent.error` of origin `infra`
  ("SAST não rodou: <motivo> — … reexecute o gate depois de corrigir"). The
  external contract does not change: the usual two verdicts remain
  (`approved`/`changes_requested`), one per gate. A missing gitleaks is still
  only "skipped" in the summary.
- **Re-run:** the cycle stays `in_progress` in `gate_states`, and the
  `GateRescuer` re-runs it at engine boot and after the staleness threshold
  (`gate_rescue_stale_after_seconds`, 15 min). There is no re-run gate
  button on screen.
- **No repetition (AT-386):** a rescue that finds the SAME reason again does not
  record another `agent.error`: if the SecOps's last event for that task
  (`agent.error` or `artifact.secops_verdict`, read by type, tail with a ceiling)
  is already this error with the same `reason`, only the server's Logger line remains.
  A different reason, a verdict in between or a failing read record again; the
  `agent.error` now carries `taskId`.
- **Where:** `apps/engine/lib/engine/gates/secops_agent_server.ex:116`
  (`run_secops`), `apps/engine/lib/engine/gates/secops_agent_server.ex:144`
  (`sast_nao_rodou`), `apps/engine/lib/engine/gates/secops_agent_server.ex:194`
  (`erro_ja_registrado?`)
- **Test:** `apps/engine/test/engine/gates/secops_agent_server_test.exs`
  ("sem achados (gitleaks e semgrep limpos): approved"; failure cases:
  "semgrep com saída inválida: gate pendente, sem veredito, motivo nomeado" and
  "semgrep com binário ausente: gate pendente, sem veredito, motivo nomeado";
  AT-386: "primeiro resgate grava; o segundo, com o mesmo motivo, não",
  "motivo diferente, ou veredito depois do erro, grava de novo", "o SAST que
  volta a rodar aprova como sempre")
- **Revises:** [RN-707](#rn-707) ("o veredito do gate NÃO muda")
- **Origin:** AT-380

### RN-717 — The agent deviation the Anamnese observes becomes a product signal, without personal data {#rn-717}

- **Rule:** an agent loop, a turn cancelled by the user and a user
  message that repairs an agent failure are recorded by the Anamnese as
  `anamnese.agent_deviation` (tool `report_agent_deviation`), never as the
  person's profile. The payload is assembled in the engine by an allowlist —
  `agente`, `tipo` (`laco` | `cancelamento_pelo_usuario` |
  `reparo_pelo_usuario`) and `evidenceEventIds` (deduplicated, ceiling of 20) —,
  without free text and without the user's id, name, e-mail or trait; an extra field is
  discarded. The type is not projected into the user's graph. A type outside the
  vocabulary or without evidence is refused, without recording.
- **Where:** `apps/engine/lib/engine/anamnese/tools/report_agent_deviation.ex:73`
  (`payload`), `apps/engine/lib/engine/anamnese/tools/report_agent_deviation.ex:52`
  (`run`), `apps/engine/lib/engine/anamnese/tools.ex`, rule in the kickoff
  (`prompts/anamnese-kickoff.md` v4)
- **Test:** `apps/engine/test/engine/anamnese/report_agent_deviation_test.exs`
  ("reparo do usuário vira anamnese.agent_deviation do AGENTE, só com agente,
  tipo e evidência"; failures: "tipo fora do vocabulário é recusado e nada é
  gravado", "sem evidência é recusado"),
  `apps/api/test/application/graph-projection/desvio-do-agente-fora-do-grafo.spec.ts`
- **Declared gap:** the api does not check that the evidence exists; reading is
  by querying the event log, without a screen ([ADR 0205](../adr/0205-desvio-do-agente-como-sinal-do-produto.md)).
- **Origin:** AT-356 (part 2), owner decision of 10/02

## One cache key, one question (RN-718)

### RN-719 — An agent tool accepts a list sent as JSON text, and an exception inside it goes back to the loop {#rn-719}

**Context:** measured live (10/02, Haiku 4.5 via OpenRouter), the model sends
lists and objects as a JSON STRING (`"business_rule_ids": "[\"01M…\"]"`). Three
outcomes: `create_story` silently discarded the ids (the story stayed `draft`),
other tools refused and cost rounds, and `create_c4_diagram` did
`Enum.map` on a string and brought down the Arquiteto's turn with `agent.error`.

**The rule:** every tool of the seven conversational agents and of the `ToolLoop` runs through
ONE point, `Engine.Harness.ArgumentosDeFerramenta.executar/4`. An argument whose
schema declares `array`/`object` and arrives as a valid JSON string of the type becomes the
value; a string that is not is a NAMED refusal ("o campo X precisa ser uma lista"),
before the tool runs. A field declared `string` is never touched. An exception
raised inside the tool becomes `tool.result` `ok: false` with
`origem: "codigo"`, and the error enters the loop like any other (RN-163): the
turn continues.

- **Where:** `apps/engine/lib/engine/harness/argumentos_de_ferramenta.ex:26`
  (`executar`), `:73` (`coagir`), `:52` (`falha_interna?`);
  `apps/engine/lib/engine/agents/resultado_de_ferramenta.ex:29` (`payload`);
  `apps/engine/lib/engine/harness/tool_loop.ex:348` (`run_direct`);
  `apps/engine/lib/engine/agents/arquiteto_server.ex:331`
  (`executar_ferramenta`, the same helper in the other six servers)
- **Test:** `apps/engine/test/engine/harness/argumentos_de_ferramenta_test.exs`
  (`create_story` with ids in a JSON string records the ids; `create_c4_diagram` with
  `actors` in a JSON string works; a non-JSON string in an array field is a named
  refusal; a tool that throws does not end the `ToolLoop` turn and records
  `tool.result` `ok: false`)
- **Origin:** AT-387

### RN-721 — A shortened story or task id is resolved within the project {#rn-721}

The Arquiteto passed to `assign_story_modules` the first 8 characters of the
story's id, the api responded 400 "storyId must be a UUID" and, after eight
attempts, no story got a module (loja-teste-2, 10/02). Every
agent tool that receives a story or task id —
`assign_story_modules` and `create_task` (`story_id`), `assess_implementability`
(`storyId`) and `propose_execution_plan` (`tarefas[].taskId`) — passes the id through
`Engine.Harness.IdDoBacklog` before calling the api:

- A full UUID goes on without a query.
- A prefix of at least 8 hexadecimal characters is resolved against the
  PROJECT backlog (`list_backlog`): a single id starting with it becomes the UUID;
  none is a named refusal ("nenhuma história do projeto tem id começando com
  …"); more than one is a named refusal ("o prefixo … é ambíguo"). The refusal goes back
  to the model as the tool result (RN-163).
- What is neither a UUID nor a prefix goes on as it came, and the api refuses it.

- **Where:** `apps/engine/lib/engine/harness/id_do_backlog.ex:21` (`resolver`),
  `:43` (`resolver_em`); `apps/engine/lib/engine/agents/dev_lead_tools.ex:176`
  (`resolver_tarefas`)
- **Test:** `apps/engine/test/engine/harness/id_do_backlog_test.exs` (a unique
  prefix resolves; ambiguous and nonexistent refuse by name)
- **Origin:** AT-390

## The Anamnese does not pay twice for the same window, and gate rescue does not restart a cycle that waits for someone (RN-722)

### RN-722 — The Anamnese closes the window it evaluated and only runs with new interaction; gate rescue asks about the task, respects the pending human decision and parks the old cycle {#rn-722}

- **Rule (Anamnese):** (1) a round that EVALUATED the window and ended without a
  profile (`skip_proficiency`) records `anamnese_runs` with zero profiles, and the
  next one starts at `window_to` — revising the clause of RN-680/the moduledoc
  "a round that does not conclude does not record": a round that FAILS (ceiling, budget,
  provider) still does not record, and one that never reaches the LLM (no subject,
  triage, daily ceiling) closes nothing; (2) the events the Anamnese itself
  writes (`anamnese.*` and every event of actor `agent`/`anamnese`) and those of
  actor `system` stay out of the window and of the triage count; (3) owner
  decision of 10/02: a subject is whoever has at least **5** NEW own interactions
  (events of `actor_kind: "user"` plus decisions, in the window that already starts at the
  end of the last attempt) — revising the "at least ONE" of RN-680 —, and the project
  has at most **4** paid rounds per UTC day (concluded, failed or
  `run_skipped` written by the model; the no-subject skip does not count). Below
  either of the two, no LLM or RAG call; the reason goes to the log and,
  only in a manually requested round, to `anamnese.run_skipped` (`causa:
  "teto_diario"` or `"sem_sujeito_elegivel"`).
- **Rule (gate rescue, revises RN-140):** the `GateRescuer` (a) considers
  alive the cycle whose TASK is in flight in the lead, by asking it
  (`{:em_voo?, task_id}`), and no longer the project's process — an idle lead does not
  hold the rescue; a lead too busy to answer counts as alive; (b)
  does not restart a cycle whose session has a PENDING `proposed_action` from a gate
  actor (`qa*`, `secops*`, `appsec`) — it only logs; (c) owner decision
  of 10/02: a cycle stalled for more than 2 h since its LAST ACTIVITY (`updated_at`)
  is PARKED (`parked_at`) with `gate.rescue_parked` in the session log
  (task, gate, age, reason), is resumed neither at boot nor on the tick, and resuming
  requires a human gesture (`GateRescuer.retomar_estacionado/3`).
- **Where:** `apps/engine/lib/engine/workers/anamnese_worker.ex:189`
  (`fechar_janela`), `apps/engine/lib/engine/workers/anamnese_worker.ex:104`
  (`dentro_do_teto_diario?`),
  `apps/engine/lib/engine/session_events/event.ex:194`
  (`project_window_query`), `apps/engine/lib/engine/session_events/event.ex:202`
  (`count_anamnese_rounds_since`),
  `apps/engine/lib/engine/anamnese/elegibilidade.ex:67`
  (`min_interacoes_proprias`),
  `apps/api/src/application/use-cases/anamnese/record-proficiency.use-case.ts:160`
  (`fecharJanelaSemPerfil`), `apps/engine/lib/engine/gates/gate_rescuer.ex:336`
  (`task_em_voo?`), `apps/engine/lib/engine/gates/gate_rescuer.ex:360`
  (`aguardando_humano?`), `apps/engine/lib/engine/gates/gate_rescuer.ex:283`
  (`estacionar`), `apps/engine/lib/engine/gates/gate_rescuer.ex:320`
  (`retomar_estacionado`), `apps/engine/lib/engine/gates/qa_lead_server.ex:95`
  (`handle_call`)
- **Test:** `apps/engine/test/engine/workers/anamnese_worker_test.exs`
  (describe "a janela avaliada fecha (RN-722)": "skip_proficiency grava a
  rodada vazia; a segunda começa em window_to e, sem interação nova, não chama
  o LLM"; failures: "falha ao fechar a janela não vira falha da rodada", "rodada
  que FALHA não fecha a janela"; describe "piso de interações e teto diário
  (RN-722)"), `apps/engine/test/engine/anamnese/elegibilidade_test.exs`,
  `apps/engine/test/engine/session_events/event_window_test.exs` ("dez
  eventos da Anamnese sozinhos não passam a triagem"),
  `apps/engine/test/engine/gates/gate_rescuer_test.exs` ("lead do projeto vivo
  e OCIOSO não segura o resgate de uma task perdida", "ciclo com ação PENDENTE
  de ator do gate espera o humano", "ação pendente de OUTRO ator não segura o
  resgate", "ciclo parado há mais de 2 h é ESTACIONADO", "ciclo parado há
  MENOS de 2 h segue sendo resgatado"),
  `apps/api/test/application/use-cases/anamnese/record-proficiency.use-case.spec.ts`
  (describe "fecharJanelaSemPerfil (RN-722)")
- **Declared gap:** resuming a parked cycle had no screen nor route
  — it was an operator call (`bin/engine rpc`); it closed in
  [RN-724](#rn-724) (route and button on the `gate.rescue_parked` event). The human pending item is read
  through the cycle's SESSION (the `proposed_action` has no `task_id`)
  ([ADR 0207](../adr/0207-ciclo-de-gate-velho-estaciona.md)).
- **Origin:** AT-391 (real use of 10/02: ~US$ 8.90 of Anamnese in a day without
  anyone asking; a gate cycle restarted with a pending action and another one 8 h without
  rescue), owner decisions of 10/02

## One cache key, one question (RN-718)

### RN-723 — The Infra inherits the network the Arquiteto declared for the project {#rn-723}

Owner decision on 10/02 ([ADR 0208](../adr/0208-a-infra-herda-a-rede-do-arquiteto.md)),
revising the literal `none` network of the start on acceptance of [RN-671](api.md#rn-671). The
Infra's election uses the `network` of the most recent `artifact.project_image`
emitted by the Arquiteto (`actor_id: "arquiteto"`, any session of the project),
read locally by the engine; without a decision of his, or with a value outside
`none`/`egress`, it stays `none`. It applies to the server's start on acceptance and to
the `propose_container_start` tool without `network`. The seeded autonomy does not change:
`egress` starts without a click, and the price (the `egress` network reaches the machine's
published ports, ADR 0189) is declared in the ADR.

- **Code:** `apps/engine/lib/engine/session_events/event.ex:139` (`rede_do_arquiteto`),
  `apps/engine/lib/engine/infra/infra_lead_server.ex:740` (`rede_herdada`)
- **Tests:** `apps/engine/test/engine/infra/infra_lead_server_test.exs` —
  "RN-723: a subida herda a rede `egress` que o Arquiteto declarou" and
  "RN-723: rede do Arquiteto fora do vocabulário — a subida segue `none`"
- **Origin:** AT-392

## The Anamnese does not pay twice for the same window, and gate rescue does not restart a cycle that waits for someone (RN-722)

### RN-724 — The parked gate cycle comes back through a button in the thread, not only through the operator's terminal {#rn-724}

- **Rule:** the gate cycle PARKED by the rescue
  ([RN-722](#rn-722), [ADR 0207](../adr/0207-ciclo-de-gate-velho-estaciona.md))
  is resumed through `POST /projects/:projectId/tasks/:taskId/gates/:gate/resume`,
  with the SAME minimum role as whoever decides the PR (`developer`). The api only
  authorizes and asks the engine (`POST /internal/projects/:id/tasks/:taskId/gates/:gate/resume`),
  which delegates to `GateRescuer.retomar_estacionado/3`: a cycle that does not exist, is not
  parked or a gate outside `qa`/`secops` is 409 `gate_nao_estacionado`
  and nothing is dispatched. In the session thread, the `gate.rescue_parked` event becomes a
  notice with the "Retomar gate" button, inert with the reason in text when the role
  does not reach `developer`; the refusal shows the api's sentence. No new poll:
  the resumed gate's progress arrives through the session log.
- **Where:** `apps/engine/lib/engine_web/controllers/gate_command_controller.ex:15`
  (`resume`),
  `apps/api/src/application/use-cases/gates/resume-parked-gate.use-case.ts:18`
  (`execute`),
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts:351`
  (`resumeParkedGate`),
  `apps/api/src/interfaces/http/gates/gate-resume.controller.ts:40`
  (`resume`), `apps/web/src/routes/RetomarGateEstacionado.tsx:59`
  (`RetomarGateEstacionado`)
- **Test:** `apps/engine/test/engine_web/controllers/gate_command_controller_test.exs`
  ("ciclo estacionado: 202 e despacha o gate de novo"; failure: "ciclo NÃO
  estacionado: 409 nomeado e nada despachado"),
  `apps/api/test/interfaces/http/gates/gate-resume.controller.spec.ts`
  (happy, 409 `gate_nao_estacionado`, role below `developer`),
  `apps/web/src/routes/RetomarGateEstacionado.test.tsx` (the click calls the
  route; the refusal becomes a toast with the api's sentence; an insufficient role leaves the
  button inert)
- **Origin:** AT-397, closing the gap declared in RN-722

### RN-725 — Text with a literal escape is decoded, and the argument refusal says what arrived {#rn-725}

**Context:** in TP-01 (10/03, Claude Haiku 4.5) the PO recorded story
titles with the LITERAL unicode escape (`código`): the normalization of
RN-719 only decoded `array`/`object` fields. Recreated with the right title,
the stories went through the duplicate refusal (RN-720/RN-081), which did not match
the escaped one with the normal one. And the "exige X" refusals did not say what had
arrived: the PO spent 28+ steps (48% of the test's cost) up to the ceiling, and
`complete_story` replied "ainda faltam RF, DoD, DoR ou business_rule_ids"
without saying which.

**The rule:**

1. At the same point as RN-719, a string with a LITERAL `\uXXXX` (surrogate pair
   included) is decoded, and with it `\n`, `\t`, `\"` and `\\` of the SAME
   string. A string without `\uXXXX` comes back byte for byte — code in a `content` with
   a literal `"\n"` does not change. This revises RN-719's "a `string` field is never touched"
   only in this case.
2. The EXACT duplicate of a story (api) and of a rule (engine) compares the title
   with the escape decoded, before the usual case folding and NFD.
3. A tool refusal that says "exige `X`" gains, at the same point, the KEYS
   that arrived (names, never values), or that a string/list arrived instead of an
   object. `emit_artifact` with a key missing in the `payload` states the missing
   keys and the received ones, instead of `{:missing_keys, …}`.
4. `complete_story` names exactly what is missing (`falta: business_rule_ids`),
   by the same yardstick as the api's `missingForReady`, read from the returned story.

- **Where:** `apps/engine/lib/engine/harness/argumentos_de_ferramenta.ex:88`
  (`decodificar_escapes`), `:135` (`chaves_recebidas`), `:152`
  (`com_chaves_recebidas`); `apps/engine/lib/engine/harness/tools/complete_story.ex:80`
  (`faltam`); `apps/api/src/domain/backlog/story-overlap.ts:39`
  (`decodificarEscapesLiterais`), `:25` (`normalizarTitulo`);
  `apps/engine/lib/engine/harness/artifact_dedupe.ex` (`normalizar`)
- **Test:** `apps/engine/test/engine/harness/argumentos_de_ferramenta_test.exs`
  (describe "RN-725": escape decoded, text without `\u` and list intact;
  refusal with the keys and without the values; `complete_story` names the field);
  `apps/api/test/domain/backlog/story-overlap.spec.ts` (escaped title matches
  the normal one; a different title stays different)
- **Origin:** AT-405, AT-408

### RN-726 — The provider's exhausted credit pauses the dev agent, with origin `infra`, without burning the following tasks {#rn-726}

- **Rule:** when the model's provider refuses for lack of CREDIT (HTTP 402,
  or OpenRouter's text "available credits"/"add credits"), the dev
  agent's turn is not "stopped without concluding": the task is blocked with the reason
  "crédito do provider esgotado" and origin `infra` (never `codigo`), the
  automatic stop counter (RN-047) does NOT advance, and the agent does NOT claim the
  next task — it stays in `idle_tripped` and emits `dev.credit_exhausted`
  (`motivo: credito_esgotado`), never `dev.idle_tripped`. Resumption is the
  Rearmar that already existed in the team panel, after topping up the credit; the
  blocked task comes back through the usual unblock. The Executores screen
  shows the agent `travado` with "crédito do provedor do modelo esgotado —
  recarregue e rearme para retomar", and the bell says the same. The same
  recognition makes `FalhaDeTurno.origem/1` return `infra` for the
  credit final frame (it applies to the gate agents, like QA). The session counts
  `dev.credit_exhausted` as pending work, like `dev.idle_tripped`.
  Since RN-730 the 402 arrives with its own `code` (`insufficient_credit`) and it is
  that which decides; recognition by text remained only as a safety net.
- **Where:** `apps/engine/lib/engine/agents/falha_de_turno.ex:134`
  (`credito_esgotado?`),
  `apps/engine/lib/engine/dev/dev_agent_server.ex:906` (`handle_outcome`),
  `apps/engine/lib/engine/dev/agent_io.ex:271` (`pausar_por_credito`),
  `apps/web/src/lib/agent-status.ts:198` (`breakerReasonFor`),
  `apps/api/src/application/use-cases/sessions/get-session-pending-work.use-case.ts`
- **Test:** `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  ("402 do provider: origem infra, pausa sem idle_tripped e sem queimar a
  próxima task"; failure: "erro que não é de crédito segue como antes: parou sem
  concluir, conta no disjuntor"),
  `apps/engine/test/engine/agents/falha_de_turno_test.exs` ("402 do provider
  é infra e é reconhecido"), `apps/web/src/lib/agent-status.test.ts`
  ("RN-726: dev.credit_exhausted é travado com motivo de crédito…")
- **Origin:** AT-407 (TP-01 of 10/03: OpenRouter's 402 became three tasks
  blocked with origin `codigo` and the automatic stop)

### RN-731 — The turn's closing states what was recorded with the server's number {#rn-731}

- **Rule:** the number of what a conversational agent recorded in a turn is a SERVER
  FACT, never model text (RN-163). The Criativo, the PO and the Arquiteto
  count, in the turn's process, each write tool that came back `ok`
  (`emit_artifact` by type — business rule, decision, note, other —,
  `create_epic`, `create_story`, `update_story`, `archive_story`,
  `create_task`), and the closing of `agent.response` gains, AFTER the model's
  text and without rewriting it, the line "Gravado neste turno: N …". A refused
  tool and a read do not count; a turn without writes gets no line; the count
  dies with the turn. The line comes out in the turn's language (RN-622): the author's,
  otherwise the project's; `pt*` in Portuguese ("Gravado neste turno: 1 regra de
  negócio"), any other language — or none resolved — in English
  ("Recorded this turn: 2 business rules"), with singular and plural in both.
- **Where:** `apps/engine/lib/engine/agents/gravado_no_turno.ex:62` (`anotar`),
  `:95` (`descarregar`),
  `apps/engine/lib/engine/harness/idioma_da_resposta.ex:272` (`idioma_do_turno`),
  `apps/engine/lib/engine/agents/texto_do_turno.ex:65` (`payload_do_turno`)
- **Test:** `apps/engine/test/engine/agents/gravado_no_turno_test.exs` (happy:
  six rules and one decision recorded, one refused — the model's "8 regras" closing
  stays and gains "6 regras de negócio, 1 decisão" next to it; no writes:
  nothing added; pt-BR and en, singular and plural; a language outside the two falls back to en),
  `apps/engine/test/engine/agents/criativo_server_test.exs`
- **Origin:** AT-414 (TP-01 of 10/03: the Criativo closed with "Registrei as 8
  regras de negócio" and the panel had 6)

### RN-732 — The turn's text goes through the same escape yardstick as the arguments {#rn-732}

- **Rule:** the text the model writes in a conversational agent's turn
  — the `content` (closing) and each `passos` of `agent.response` — goes through the SAME
  `decodificar_escapes/1` of RN-725 before being recorded: a literal `ã` becomes
  `ã`. One yardstick only, without a copy, and with the same limit: it only acts when there is a
  literal `\uXXXX`, so text without escapes — including code with a literal `"\n"`
  in a fenced block — comes back byte for byte. The streaming `agent.delta`
  is NOT decoded: an escape may arrive split between two deltas, and the
  recorded bubble replaces the in-progress text at the end of the turn. A rule of its own, and
  not a clause of RN-725, because the surface is different (model response, not a
  tool argument) and the decision about the delta is this one's.
- **Where:** `apps/engine/lib/engine/agents/texto_do_turno.ex:65` (`payload_do_turno`),
  `apps/engine/lib/engine/harness/argumentos_de_ferramenta.ex:88` (`decodificar_escapes`)
- **Test:** `apps/engine/test/engine/agents/texto_do_turno_test.exs` (happy:
  the five measured escapes, in the closing and in a step; intact: text without escapes and
  a code block with a literal `\n`)
- **Origin:** AT-417 (TP-01 of 10/03, 2nd round: the Criativo's final answer
  recorded with "colisão", "usuário" and three more escapes in the bubble)

### RN-733 — The credit failure says what to do, and the `reason` is never the tuple {#rn-733}

- **Rule:** the `reason` recorded in the `agent.error` of the conversational agents, the
  Infra Lead and the `ToolLoop` (dev agent) is the TEXT of the final frame when there is
  one — never the inspected `{:final, …}` tuple; other shapes keep
  `inspect/1`. With the provider's credit exhausted (`errorCode:
  insufficient_credit`, RN-730, or the text recognition of RN-726), the bubble's
  `mensagem` is short and actionable in the turn's language (RN-622): pt
  "Crédito do provedor do modelo esgotado — recarregue a chave e tente de
  novo.", any other language "The model provider's credit is exhausted —
  top up the key and try again."; with no resolved language, pt-BR. The
  provider's JSON stays only in the `reason` (diagnosis). The other errors keep the usual
  sentence.
- **Where:** `apps/engine/lib/engine/agents/falha_de_turno.ex:158` (`mensagem`),
  `:181` (`diagnostico`)
- **Test:** `apps/engine/test/engine/agents/dev_lead_server_test.exs` (402
  in pt-BR and en: short sentence, `reason` without `{:final`; `upstream` error: usual
  sentence), `apps/engine/test/engine/agents/falha_de_turno_test.exs`
- **Origin:** AT-421 (TP-01 of 10/03, 2nd round: the Dev Lead recorded
  `reason: "{:final, …"` and the bubble dumped the 402's JSON)

### RN-735 — The `none` network of the Arquiteto's image says it does not install dependencies {#rn-735}

- **Rule:** the description of `choose_project_image` and its RESULT say
  that, with network `none`, no package manager (npm, pnpm, pip, mix,
  cargo, go mod...) installs a dependency in the container, and that the Infra inherits that
  network (RN-723). With `none`, the result asks the model to call the tool
  again with `egress` if the stack installs dependencies. It is a NOTICE, never a refusal:
  the api does not guess the stack, and the broker's containment (ADR 0130) does not change.
- **Code:** `apps/engine/lib/engine/harness/tools/choose_project_image.ex:96`
  (`mensagem_de_fixada`), `apps/engine/lib/engine/harness/tools/choose_project_image.ex:23`
  (`spec`)
- **Test:** `apps/engine/test/engine/harness/tools/choose_project_image_test.exs`
- **Origin:** AT-420 (TP-01 of 10/03: `node:22-bookworm-slim` with network `none`,
  and the dev agent could not `npm install`)

### RN-742 — The dev agent does not die silently, and a late HTTP response does not stay in its mailbox {#rn-742}

- **Rule:** every non-streamed HTTP call from the engine to the api
  (`post_returning/3` and the GETs of `EngineApiClient.Live`) runs in a disposable
  `Task`; a response that arrives after the `receive_timeout` lands in a
  process that has already ended, never in the caller's mailbox, and an
  exception inside the request comes back as `{:error, _}`. And a dev agent that
  CRASHES (an exit that is neither `:normal` nor `:shutdown`) is not treated as finished:
  `Engine.Dev.Monitor` records a DURABLE `agent.error` with origin `infra`
  (`reason: processo_do_dev_caiu`, `religado`, `taskId`) and RESTARTS it
  from its own `dev_agent_states` row, up to 3 times per agent; the `resume`
  goes through the `handle_continue({:restart_recovery, _})` that already existed, which
  blocks the interrupted task with a diagnosis (origin `infra`) and tries the
  next claim. Without a row, or at the ceiling, the row is removed and the error says there was
  no restart. `llm_turn_stream/6` stays out of the isolation (the `into:`
  writes into the caller's dictionary); the conversational agents already call it from inside
  the turn's Task (`TurnoAssincrono`), so the "HTTP inside the
  GenServer" pattern does not reach them — declared. The web did not change: the Executores tab
  now sees the recovery's `agent.error` and `dev.blocked`.
- **Where:** `apps/engine/lib/engine/sessions/engine_api_client.ex:2073`
  (`isolado`), `apps/engine/lib/engine/dev/monitor.ex:69` (`ao_terminar`),
  `:107` (`registrar_e_religar`)
- **Test:** `apps/engine/test/engine/sessions/engine_api_client_isolado_test.exs`
  (a late message does not reach the caller; an exception becomes `{:error, _}`),
  `apps/engine/test/engine/dev/monitor_test.exs` (a crash records an infra `agent.error`
  and restarts; `:normal` deletes the row; without a row it does not restart)
- **Origin:** AT-428 (10/08: `CaseClauseError` in
  `Finch.HTTP1.Conn.receive_response/8` after the `npm install` timeout)

### RN-743 — Blocking the task preserves the worktree's work, and the next one starts from it {#rn-743}

- **Rule:** before blocking a task (any origin, including the
  `taskBudgetMicros` budget ceiling, whose VALUE does not change here), what the dev agent
  left in the worktree becomes a commit on the task's own branch, with the identity
  `<agente>[bot]` (`git add -A` + `commit --no-verify`). The `dev.blocked` carries
  `trabalhoPreservado` (`{branch, commit}` or `null`) and the diagnosis STATES where
  the work was left — or that it could not be preserved, with the reason; a failure
  to preserve never prevents the block. The SAME agent's next task (therefore,
  of the same module) is born from that branch (`create_from/4`) instead of `dev`, once
  only. A clean worktree produces no commit. Declared: the pointer lives only in
  memory (an engine restart loses the pointer, not the commit), and in
  `runner` mode the worktree is on the user's machine and the engine preserves nothing.
- **Where:** `apps/engine/lib/engine/dev/worktree_manager.ex:72`
  (`preservar_em`), `:55` (`create_from`),
  `apps/engine/lib/engine/dev/agent_io.ex:491` (`preservar_trabalho`),
  `apps/engine/lib/engine/dev/agent_io.ex:321` (`base_preservada`)
- **Test:** `apps/engine/test/engine/dev/worktree_manager_test.exs`
  (`preservar_em/3 e create_from/4`: commit with `dev-api[bot]` and the next
  task sees the file; clean is `:nada`; a folder without a repository is an error),
  `apps/engine/test/engine/dev/bloqueio_preserva_trabalho_test.exs` (the
  `dev.blocked` states the branch; a failure to preserve does not prevent the block)
- **Origin:** AT-429 (10/08: `feature/task-86dade03` without a commit, `package.json`
  and `src` lost after the budget block)

### RN-744 — The dev knows the shell is `sh` and starts by seeing its own worktree {#rn-744}

- **Rule:** the `terminal` tool's description says the container's shell
  is `sh` (dash), not bash — no brace expansion, no `[[ ]]`, no arrays, no
  `source` — and gives the form that works. Each dev agent task's kickoff
  gets a second pinned message with the worktree's SNAPSHOT: the branch and the
  files that already exist (tracked + untracked not ignored), with a ceiling
  of 80 lines and the real total when it cuts (ADR 0060); it is the server that assembles it,
  with no parameter from the model. A folder the engine cannot reach (`runner` mode) says
  that the snapshot is unavailable and says to list through `terminal`. Declared and
  NOT fixed: the dev's worktree may be born before the infra PR's merge,
  so what the Infra delivered through a PR may not be on the `dev` it
  starts from.
- **Where:** `apps/engine/lib/engine/harness/tools/terminal.ex:12` (`spec`),
  `apps/engine/lib/engine/dev/worktree_manager.ex:108` (`retrato`),
  `apps/engine/lib/engine/dev/dev_agent_server.ex:595` (`retrato_do_worktree`)
- **Test:** `apps/engine/test/engine/dev/worktree_manager_test.exs`
  (`retrato/2`: branch and files; an unreachable folder says unavailable; the
  terminal description says `sh`)
- **Origin:** AT-444 (TP-01 of 10/08: `mkdir -p src/{a,b}` in dash and the dev
  recreating what already existed)

### RN-745 — In a cut answer, only the incomplete call is refused {#rn-745}

- **Rule:** when the model's answer comes cut by the output ceiling
  (`truncated: true`, [RN-737](api.md#rn-737)), only the LAST tool call of the
  answer is treated as incomplete and refused with the named error (which now
  says "the last one of the answer", that the earlier ones were executed and asks for "one
  per call"). The earlier calls of the same answer execute
  normally — measured in the code: the OpenAI-compatible stream assembles the
  calls in order, the cut falls on the last one, and the api's `parseArgumentos`
  returns `{}` for the broken JSON. The call is identified by name and
  arguments. A cut answer without a known call still refuses every
  tool (RN-737's yardstick). The description of `propose_adr` steers one ADR per
  answer.
- **Where:** `apps/engine/lib/engine/harness/resposta_cortada.ex:44`
  (`registrar`), `:64` (`incompleta?`),
  `apps/engine/lib/engine/harness/argumentos_de_ferramenta.ex:26` (`executar`),
  `apps/engine/lib/engine/harness/tools/propose_adr.ex:27` (`spec`)
- **Test:** `apps/engine/test/engine/harness/resposta_cortada_test.exs` ("só
  a última chamada da resposta cortada é recusada; as completas executam";
  "ferramenta de resposta cortada NÃO executa", without a known call)
- **Origin:** AT-430 (10/08: the Arquiteto sent 5 `propose_adr` in a cut
  answer and all five were refused; 0 ADRs)

### RN-746 — The Arquiteto's closing states what it recorded, and refused writes are counted {#rn-746}

- **Rule:** the factual line "Gravado neste turno: …" of
  [RN-731](#rn-731) now counts the Arquiteto's writes (proposed ADR,
  module map, module assignment, decided image, C4 diagram,
  routing to infra, module contract, insight), the Staff's RFC and the
  UX Designer's prototype, and counts separately the refused WRITE calls
  (`{:error, _}`) of the turn: "…; N chamadas de escrita recusadas". A turn that
  tried to write and recorded nothing closes with "Gravado neste turno: nada; N
  chamadas de escrita recusadas." (en: "Recorded this turn: nothing; N write
  calls refused."). The Criativo now notes refusals too; Staff and UX
  Designer now note them. A read never counts. The model's text is not
  rewritten (RN-163: the agent does not announce as done what the server
  refused — the reader sees the fact next to it). Out, declared: Dev Lead (the plan
  suspends the turn, RN-284) and Infra Lead.
- **Where:** `apps/engine/lib/engine/agents/gravado_no_turno.ex:77` (`anotar`),
  `:96` (`descarregar`), `:141` (`classe`),
  `apps/engine/lib/engine/agents/arquiteto_server.ex:323` (`dispatch_tool`)
- **Test:** `apps/engine/test/engine/agents/gravado_no_turno_test.exs`
  ("Arquiteto com as cinco propose_adr recusadas fecha com nada gravado";
  "escritas do Arquiteto contadas, leitura e ferramenta desconhecida não")
- **Origin:** AT-431 (10/08: with the 5 `propose_adr` `ok: false`, the Arquiteto
  closed with "✅ ADRs Propostas (5 decisões críticas)" and no factual line)

### RN-756 — The Anamnese only runs with the subject's technical-content interaction; approving does not count {#rn-756}

- **Rule:** revises the "own interaction" count of RN-680/RN-722. Only
  these count toward making someone a subject of the round: (a) an `actor_kind: "user"` event
  of the member themselves whose type is in `tipos_de_evento_com_conteudo/0` —
  `chat.message` (a message written by them) and
  `chat.structured_question_answered` — and (b) an action decision with a written
  refusal reason (non-empty `rejectionReason`, a correction). Approval,
  handoff acceptance, a click and any other user event do NOT count:
  they are not evidence of competence. The floor of 5 (RN-722), the daily ceiling and the
  no-subject outcome (reason in the log; `anamnese.run_skipped` only in a manually
  requested round) do not change, and triage stays LOCAL, before the LLM and the RAG.
- **Code:** `apps/engine/lib/engine/anamnese/elegibilidade.ex:61`
  (`avaliar`), `:102` (`recusa_com_motivo?`), `:108`
  (`tipos_de_evento_com_conteudo`)
- **Test:** `apps/engine/test/engine/anamnese/elegibilidade_test.exs`
  (`só interação com conteúdo técnico conta (RN-756, AT-439)`: a message and a
  structured answer make a subject; only approvals, handoff and refusal without a
  reason do not)
- **Origin:** AT-439 (TP-01, 10/08, project `c1dc053d`: two rounds during
  execution, US$ 0.20, both `skip_proficiency` with "o usuário apenas
  aprovou propostas")

### RN-757 — The auto-approved `terminal` waits for the command, and the command ceiling is 2 min {#rn-757}

- **Rule:** the `terminal` action the api auto-approves is EXECUTED inside the
  same `propose_action` request (api → engine
  `/internal/actions/execute` → api `container-exec` → broker), and the engine
  waits for that request for `TERMINAL_ACTION_TIMEOUT_MS` + 120 s — not for the
  `Req` default of 15 s. The command ceiling (`TERMINAL_ACTION_TIMEOUT_MS`)
  goes from 15 s to 120 s in the three composes and in `runtime.exs`. The chain becomes
  broker (T) < api → broker (T + up to 45 s, [RN-604](api.md#rn-604)) < engine →
  `container-exec` (T + 90 s) < engine → `propose_action` (T + 120 s), and with
  T = 120 s the outer hop (240 s) stays below the 300 s of headers of
  Node's `fetch`. If the wait still overflows, the model receives NAMED text
  — the ceiling in seconds, that the process may keep running and the suggestion of
  `nohup … &` with a log —, never a raw `%Req.TransportError{reason: :timeout}`.
  Asynchronous/streaming exec was considered and not done: the smallest change that
  makes a common `npm install` fit is the ceiling.
- **Where:** `apps/engine/lib/engine/sessions/engine_api_client.ex:1919`
  (`opcoes_do_propose_action`) and
  `apps/engine/lib/engine/harness/hooks/action_pipeline.ex:80`
  (`resultado_de_teto_do_terminal`)
- **Test:** `apps/engine/test/engine/sessions/engine_api_client_propose_terminal_test.exs`
  (a fake api that takes 16 s is still waited for; order of the ceilings below
  300 s; the overflow text names the ceiling)
- **Origin:** AT-440 (TP-01 of 10/08: `npm install 2>&1 | tail -50` in a
  `node:22-bookworm-slim` container came back "falha no pipeline:
  %Req.TransportError{reason: :timeout}"; measured on this machine, the same
  `npm install` of `bcrypt`+`sqlite3`+`express` took 5.3 s with the image in
  cache and prebuilds available — the chain, not the command, cut at 15 s)

### RN-760 — The dev agent's next task starts from its last not-yet-merged branch {#rn-760}

- **Rule:** generalizes [RN-743](#rn-743). On finishing a task — approved
  in the gates (`nextAction: "done"`) or blocked for ANY reason, including
  the "ciclo de correção esgotado (gate)" that the api decides and reaches the engine only
  as `gate_resolved` —, the dev agent keeps its branch and the SAME agent's next task
  (therefore, of the same module) is born from that branch, and not from `dev`. What
  was left uncommitted in the worktree is preserved first, as in RN-743; the
  pointer recorded by `block_task/4` is not overwritten. When the previous
  branch is already an ancestor of the local `dev` (merged), the next one starts from `dev`,
  which already contains it. WHEN the queue moves does not change: the next task is still
  claimed at the end of the gates, before the user's merge (owner decision).
  Declared: a squash merge on a remote does not leave the branch an ancestor of `dev`,
  so the next one keeps starting from it; the pointer still lives only in memory, and in
  `runner` mode the merge check does not run.
- **Where:** `apps/engine/lib/engine/dev/agent_io.ex:296`
  (`levar_branch_para_a_proxima`), `:324` (`criar_worktree`),
  `apps/engine/lib/engine/dev/worktree_manager.ex:199`
  (`ja_mergeada_volta_ao_trabalho`)
- **Test:** `apps/engine/test/engine/dev/bloqueio_preserva_trabalho_test.exs`
  (`levar_branch_para_a_proxima/1 e criar_worktree/2`: approved carries the branch
  to the next one; the block's pointer is not overwritten),
  `apps/engine/test/engine/dev/worktree_manager_test.exs` (`add_worktree/4
  com a branch da task anterior`: not merged starts from it, merged starts from
  `dev`)
- **Origin:** AT-447 (TP-01 of 10/09: tasks `762833bd` and `5ebad64b` — the
  second was born from `dev` without the first's login route, and QA failed it)

### RN-763 — Closing the execution session stops the dev agents and the gates, and "Parar execução" in the Executores tab {#rn-763}

- **Rule:** closing the session (`session.closed`/`closed_abnormally`,
  through `SessionLifecycleWorker`, the point every closing goes through) STOPS
  its dev agents on all nodes and the project's gates (QA lead and SecOps)
  — the yardstick that already applied to the conversational agents ([RN-581](api.md#rn-581)). The
  process is brought down immediately, without recording the turn in progress, and
  `Engine.Dev.Monitor` is warned first (`esquecer/1`): the durable row is removed and
  the agent is NOT restarted ([RN-742](#rn-742)). For each dev with a task in progress
  (`working`, `awaiting_approval` or `awaiting_gate`), the worktree's work
  becomes a commit on the task's branch ([RN-743](#rn-743)) and the task is BLOCKED with
  reason "sessão de execução encerrada", origin `politica`, and the diagnosis
  saying where the work was left — it goes back to the queue when a human releases it,
  never lost. The session's `gate_states` rows are removed, so the
  `GateRescuer` does not reopen a cycle of the closed session. The Executores tab gets
  "Parar execução" (role `developer`, that of closing a session), whose mechanism is
  the SAME closing (`closing` → `closed`), without a new state; the confirmation
  says before the click what remains: the tasks in progress (with the count), the open
  PRs, the pending approvals and that the session does not reopen. Declared: a
  dev agent's pending action stays pending; an open PR stays open; a session
  with `execution.activated` does not reopen ([RN-650](api.md#rn-650)), so resuming means
  activating execution in a new session; the confirmation's task count comes
  from the tab's event window. The confirmation on the session bar's "Encerrar"
  belongs to another activity (AT-452).
- **Where:** `apps/engine/lib/engine/dev/encerramento_da_sessao.ex:40`
  (`parar_da_sessao`), `:74` (`parar_processos`), `:104` (`devolver_task`),
  `apps/engine/lib/engine/dev/monitor.ex:34` (`esquecer`),
  `apps/engine/lib/engine/workers/session_lifecycle_worker.ex:94`
  (`parar_execucao`), `apps/web/src/components/PararExecucao.tsx`
- **Test:** `apps/engine/test/engine/dev/encerramento_da_sessao_test.exs`
  (the dev dies without being restarted, the row is removed, the task is blocked with origin
  `politica`; a session without a dev is a no-op and a dev of another session stays up),
  `apps/web/src/components/PararExecucao.test.tsx` (the confirmation says what
  remains and closes `closing` → `closed`; the api's refusal stays in the confirmation; without
  the role the button is inert with the reason)
- **Origin:** AT-456 (TP-01 of 10/09: with the execution session closed, the
  `dev-encurtador-api` blocked task 3, took 4 and opened a PR; the only
  brake was stopping the container)

### RN-765 — The QA gate judges the TASK, and a sibling task's RF is an observation {#rn-765}

- **Rule:** QA-strategy (test plan, [RN-674](#rn-674)) and
  QA-automation receive, besides the story, the task's CUT: title and
  description, the story's business rules and the OTHER tasks of the same
  story with their status (`siblingTasks` in `GET .../dev-context`). The verdict
  is about what belongs to THIS task: a requirement that belongs to a sibling task
  (done or pending) does not fail it — it goes to `resumo` as an observation, outside
  `itens`, and does not prevent `approved`. The yardstick is PROMPT, not code:
  `emit_qa_verdict` still requires only a green suite to approve. Since
  AT-479, when the task description or a rule quantifies PER item ("por
  X", "cada", "de todos os" — "por exemplo"/"por padrão" do not count), the cut
  gains the section "Forma da resposta": check that the answer carries the value of
  EACH item, not only the total (the dashboard approved with only `{totalCliques}` over
  "a contagem… de todos os links"), and that the input refusal names the field —
  the latter is an OBSERVATION in `resumo`, outside `itens`, unless a rule
  requires it. It remains a prompt yardstick: no new failure in code.
- **Where:** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:18` (`texto`),
  `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:82` (`secao_da_forma`),
  `apps/api/src/application/use-cases/execution/get-dev-task-context.use-case.ts:195`
  (`tarefasIrmas`) and `apps/engine/lib/engine/gates/qa_automacao_agent.ex:170`

  `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:82` (`secao_da_forma`),
  `apps/api/src/application/use-cases/execution/get-dev-task-context.use-case.ts:195`
  (`tarefasIrmas`) and `apps/engine/lib/engine/gates/qa_automacao_agent.ex:204`
  (`com_o_recorte`)
- **Test:** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs` (since
  AT-479 also "regra que quantifica por item pede a conferência da forma da
  resposta" and the case without a quantifier) and
  `apps/api/test/application/use-cases/execution/get-dev-task-context.use-case.spec.ts`
  (the siblings without the task itself). The QA golden-set (ADR 0168) did NOT gain a
  case: it runs the real model, and proving the verdict without a paid call
  is not possible — declared.
- **Origin:** AT-448 (TP-01 of 10/09: the QA gate of the task "Modelar tabela
  de usuários e hash bcrypt" failed three times for "RF01: login HTTP com
  JWT não existe nesta entrega", which belongs to another task, and the task blocked;
  `artifact.qa_verdict` of tasks `42bea901` and `762833bd`)

### RN-772 — The Arquiteto reads the CURRENT status of the ADRs it proposed {#rn-772}

- **Rule:** the Arquiteto has the read `listar_adrs_propostas`: the PROJECT's
  `open_adr_pr` actions, read now from `proposed_actions` (same
  Postgres, no HTTP in the loop), with each one's status — pending, approved,
  auto-approved, executed (with the PR URL), denied (with the
  reason) or failed. Contained (ADR 0060, [RN-164](#rn-164)): no parameter,
  scope closed to the context's project, one count and one query per
  call, the 20 most recent, and the real total stated when it cuts. A read
  failure is `tool.result` `ok: false` with the reason, never empty text. Since
  [RN-784](api.md#rn-784) it IS in the Jev's floor.
- **Where:** `apps/engine/lib/engine/harness/tools/listar_adrs_propostas.ex:37`
  (`run`), `:40` (`ler`), `apps/engine/lib/engine/agents/arquiteto_server.ex:124`
  (`ListarAdrsPropostas`)
- **Test:** `apps/engine/test/engine/harness/tools/listar_adrs_propostas_test.exs`
  (approved appears approved, executed with the PR, denied with the reason, only those
  of the project; ceiling with the real total; no proposal; a failing read becomes a named
  error)
- **Origin:** AT-454 (TP-01 of 10/09, session `771131f4`: with the 3 ADRs
  approved, the next closing said "As 3 ADRs seguem pendentes de aprovação")

### RN-773 — The Arquiteto reads the backlog, and checks before asserting state {#rn-773}

- **Rule:** the Arquiteto gains the same `listar_backlog` as the PO
  ([RN-164](#rn-164)), with the task count per story. Its kickoff and
  the `propose_adr` result say that the ADRs' status and the tasks change
  outside the conversation and say to check both reads before asserting them,
  instead of the snapshot of an earlier result. No team flow is narrated
  here ([RN-711](#rn-711)).
- **Where:** `apps/engine/lib/engine/agents/arquiteto_server.ex:125`
  (`ListarBacklog`), `apps/engine/lib/engine/harness/tools/propose_adr.ex:94`
  (`propor`)
- **Test:** `apps/engine/test/engine/harness/tools/listar_backlog_test.exs`
  (the task count per story), `apps/engine/test/engine/agents/arquiteto_server_test.exs`
  (both reads are in the Arquiteto's catalog)
- **Origin:** AT-454 (TP-01 of 10/09: with 17 tasks in the backlog, the Arquiteto
  said "faltam as tarefas" and "não consigo verificá-las daqui")

### RN-774 — A primeira tarefa de cada módulo tem o dobro do teto por tarefa {#rn-774}

A primeira tarefa de um módulo monta o esqueleto inteiro (manifesto, app,
banco, testes) e custa mais que as seguintes: no TP-01 de 08/10 ela gastou
US$ 0,53 com o Haiku 4.5 e foi bloqueada pelo teto fixo de US$ 0,50
(`taskBudgetMicros: 500000`). Por decisão do dono (09/10), ela ganha
**2× o teto por tarefa** (US$ 1,00 com o padrão); as demais seguem o teto
configurado. O multiplicador é constante nomeada no engine, não configuração.

"Primeira" é medida pelo log, nunca pelo estado da tarefa: é a tarefa cujo
`backlog.task_claimed` é o MAIS ANTIGO do projeto para aquele módulo. Bloquear
zera `assigned_to` e reiniciar o engine perde a memória do processo; o log não
muda, então a mesma tarefa reivindicada de novo depois de liberada continua a
primeira, e uma correção pedida por gate também recebe o 2×. A api responde
`task.primeiraDoModulo` no contexto do dev (`false` sem `module`, e `false` sem
claim nenhum do módulo — o teto normal é o conservador), e o teto EFETIVO é
resolvido num ponto só do engine. O bloqueio por orçamento diz o teto que valeu
para aquela tarefa ("teto da primeira tarefa do módulo: 1000000 micro-USD,
US$ 1.00"). Os gates de QA seguem com o `task_budget_micros` base — fora do
recorte do card.

- **Onde:** `apps/engine/lib/engine/dev/teto_da_tarefa.ex:32` (`efetivo`);
  `apps/engine/lib/engine/dev/dev_agent_server.ex:669` (`diagnostico_de_orcamento`);
  `apps/api/src/application/use-cases/execution/get-dev-task-context.use-case.ts:182`
  (`ehPrimeiraTarefaDoModulo`)
- **Teste:** `apps/engine/test/engine/dev/dev_agent_server_test.exs` (describe
  "RN-774": a primeira com US$ 0,53 não bloqueia, a segunda do mesmo módulo
  bloqueia — caso de falha —, a primeira de outro módulo também ganha 2×);
  `apps/engine/test/engine/dev/teto_da_tarefa_test.exs`;
  `apps/api/test/application/use-cases/execution/get-dev-task-context.use-case.spec.ts`
  (describe "RN-774")
- **Origem:** AT-433

### RN-778 — The orphan dev agent closes through a new event at boot {#rn-778}

- **Rule:** at boot, for each non-terminal session, the dev agent whose last
  `dev.*` in the session is a waiting one (`dev.working`, `dev.blocked`, `dev.idle_tripped`
  and the others `GetSessionPendingWorkUseCase` counts) and that has NO row
  in `dev_agent_states` IN THIS session gets a `dev.error` with origin `infra`
  (`reason: dev_agent_sem_processo`) followed by `dev.idle`, which takes it out of the
  pending work yardstick ([RN-064](web.md#rn-064)). It is the mold
  of [RN-586](#rn-586) for the `dev.*` vocabulary: it never re-executes, never
  rewrites an event, and the durable row is the proof of ownership — with it the
  `DevRehydrator` restarts the agent, and closing it would be killing a healthy agent.
  It does not touch the task: a blocked task or one with a PR waiting for the merge keeps
  holding the current execution session through RN-776 (AT-457), which has a human
  owner.
- **Where:** `apps/engine/lib/engine/dev/dev_orfao.ex:49` (`varrer`),
  `apps/engine/lib/engine/sessions/rehydrator.ex:81` (`varrer`)
- **Test:** `apps/engine/test/engine/dev/dev_orfao_test.exs` (the orphan closes
  with infra `dev.error` + `dev.idle`; the one with a durable row and the one already
  `idle` do not; a failing read closes nothing)
- **Origin:** AT-465 (TP-01 of 10/09: session `63a4e1aa` rescheduled by the
  heartbeat every 30 s by a `dev.working` without a process)

### RN-779 — The worktree of the (re)claimed task starts from the CURRENT `dev` and integrates it {#rn-779}

- **Rule:** before creating a task's worktree (first time or resumed),
  the engine runs `git fetch origin` in the project's working tree (serialized per
  project) — it is on the remote that PRs are merged, and the local `dev` only moved at the
  checkout of initialization. The tip of `dev` is `origin/dev` when the local one
  fell behind. The task is born: (1) from the previous task's unmerged branch
  (RN-760), (2) from its OWN branch when it has work that `dev` does not
  contain — the task resumed in a new process, which lost the in-memory pointer
  (RN-743) —, or (3) from the current tip of `dev`. In cases (1) and (2) the worktree
  INTEGRATES the tip of `dev` (`merge --no-ff`, identity `<agente>[bot]`) before
  the first step. A conflict in that integration is a NAMED refusal ("conflito ao
  integrar a `dev` atual", with the files), the merge is aborted, the source
  branch stays intact and the task blocks with its own reason and origin `codigo`.
  A failing `fetch` blocks the task with git's reason, never falls back to the old
  `dev`. Readoption after a merge conflict (RN-715) does not integrate on its own.
  Measured in TP-01: AT-447 FIRED on the 1st claim (reflog: `Created from
  feature/task-b3cc92b8`); what lost the base was the reclaim, which reset the
  branch to the LOCAL `dev` stuck at the infra merge (`Reset to dev`).
  Declared: in `runner` mode none of this runs (the git is the user's machine's).
- **Where:** `apps/engine/lib/engine/dev/worktree_manager.ex:151`
  (`atualizar_remoto`), `:195` (`add_worktree`), `:227`
  (`ponta_do_trabalho`), `:225` (`retomada`), `:300` (`integrar_trabalho`)
- **Test:** `apps/engine/test/engine/dev/worktree_manager_test.exs`
  (`integração da dev atual (RN-779)`: resumed with an old branch starts from the remote's new
  dev; preserved work integrates the new dev; a previous one in
  `awaiting_user` is the base with dev integrated; a conflict is a named refusal)
- **Origin:** AT-458 (TP-01 of 10/09: `feature/task-c80daf6c` was born from
  `1fa2241` without the 12 tasks merged afterwards, and the merge conflicted)

### RN-780 — A reasoning-only answer cut by the ceiling is a cut, not giving up {#rn-780}

- **Rule:** in the `ToolLoop` (the path of every execution and gate agent),
  an answer without text and without a tool call that the api marks
  `truncated: true` (RN-737's `finish_reason: length`) is reasoning that
  ate the output ceiling. The round is retried ONCE, without the empty answer in the
  history and counting an iteration — the iteration ceiling and the task budget
  still apply. If it repeats, the loop stops marking `corte_pelo_teto`, and the
  dev agent blocks the task with the reason "resposta só de raciocínio, cortada
  pelo teto" and origin `modelo`, instead of "parou sem concluir nem reportar
  bloqueio". A tool call in between resets the retry. Declared:
  the engine receives from the api `truncated` and `usage.outputTokens`, but NOT the
  `reasoningTokens` (they stay only in `token_usage`), so an empty answer that
  hits the ceiling without `finish_reason: length` is not recognized.
- **Where:** `apps/engine/lib/engine/harness/tool_loop.ex:219`
  (`parada_sem_chamada`), `apps/engine/lib/engine/dev/dev_agent_server.ex:1116`
  (`motivo_da_parada`), `:1119` (`stop_diagnosis`)
- **Test:** `apps/engine/test/engine/harness/tool_loop_test.exs` (`corte só
  de raciocínio`: retried once and goes on; repeated stops with
  `corte_pelo_teto`), `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  (`resposta só de raciocínio cortada pelo teto bloqueia com motivo nomeado`)
- **Origin:** AT-459 (TP-01 of 10/09: task `c80daf6c` blocked in 40 s
  with 8,192 output tokens, all of them reasoning)

### RN-781 — The dev's commit message does not record a pending item that belongs to the system {#rn-781}

- **Rule:** the `report_done` summary is the dev agent's commit message, and
  commit, push and PR are done by the system after it. Before proposing the
  `git_commit`, the engine cuts from the pending marker ("Pendente",
  "Pendência", "Pending") to the end when the rest speaks of commit, push or PR, and
  removes the parenthesis "(ainda sem commit…)"; a pending item that does not speak of that stays.
  The description of the `summary` field says it becomes the commit message and that
  commit, push and PR are not narrated. A summary that ends up empty falls back to the default
  message `<agente>: <task>`.
- **Where:** `apps/engine/lib/engine/dev/agent_io.ex:374`
  (`mensagem_de_commit`), `:373` (`propose_commit`),
  `apps/engine/lib/engine/dev/tools/report_done.ex:27` (`summary`)
- **Test:** `apps/engine/test/engine/dev/mensagem_de_commit_test.exs`
  (cuts the narration; removes the parenthesis; a pending item unrelated to the system stays)
- **Origin:** AT-464 item 2 (TP-01 of 10/09: `git log feature/task-9d6dcd53`
  with "Pendente: commit… as ações git_commit, git_push e pr_open não estavam
  disponíveis neste passo")

### RN-787 — The gate counts the PR's diff against the origin's `dev`, and the QA verdict records a list {#rn-787}

- **Rule:** (1) the diff that QA and SecOps judge (`dev...HEAD`,
  [RN-664](#rn-664)) uses the NEWEST `dev` the working tree sees: with a
  local origin (a path on disk) the gate first runs `git fetch origin dev`,
  best effort, and between `origin/dev` and the local `dev` the one that contains the
  other wins. The clone's local `dev` does not move when the PR is merged at the origin, and the
  SecOps verdict counted the accumulation of the already merged tasks. With a remote
  origin there is no fetch in the gate (the credential belongs to `Workspace`) — declared. The
  semgrep and gitleaks keep scanning the whole worktree, not only the diff:
  narrowing what the scanner sees changes what the gate fails, and that is left to the
  owner. (2) `itens` and `coverageMatrix` of the QA verdict reach
  `artifact.qa_verdict` always as a LIST: a JSON string of a list is decoded
  (the mold of [RN-719](#rn-719)), and a string that is not a list becomes `[]`.
- **Where:** `apps/engine/lib/engine/gates/diff.ex:44` (`base_mais_nova`),
  `apps/engine/lib/engine/gates/hooks/termination.ex:46` (`lista`)
- **Test:** `apps/engine/test/engine/gates/diff_test.exs` (task B born
  from A, with A merged at the origin: the diff is only B) and
  `apps/engine/test/engine/gates/hooks/termination_test.exs` (a JSON string becomes a
  list; a list intact; an invalid string becomes `[]`)
- **Origin:** AT-464 items 1 and 3 (TP-01 of 10/09, session `80e3ce09`: "17
  arquivo(s) alterado(s) nesta PR" in a PR of 3 files against `dev`, and
  `coverageMatrix`/`itens` recorded as `"[]"` in the last verdicts)

### RN-790 — The README on how to start the deliverable is a DoD criterion the PO writes {#rn-790}

- **Rule:** the PO's kickoff instruction says to include, in the DoD of the story that
  creates the application's entry point (server, CLI, configuration or persistence) — or
  in a story of its own —, the criterion "README diz como instalar, configurar
  (variáveis de ambiente obrigatórias e opcionais, com o padrão) e subir a
  aplicação, e como criar o primeiro acesso, quando houver". The dev agent fulfills
  the story's DoD, and the gate judges by it. A PROMPT yardstick, like
  [RN-765](#rn-765): no tool refuses a story without that criterion. The
  other variant — the dev agent updating the README on every task that touches
  configuration/entry point — was NOT done: it would require classifying the task in
  `AmbienteDoAgente` or in `report_done`, a new code rule — declared.
- **Where:** `apps/engine/lib/engine/agents/po_server.ex:560` (`kickoff_instruction`)
- **Test:** `apps/engine/test/engine/agents/po_server_test.exs:438` (the
  kickoff instruction carries the README criterion)
- **Origin:** AT-466 (TP-01 of 10/09: `encurtador-api` came out with a README only
  with `npm test`, without the mandatory `JWT_SECRET`, `DB_PATH`/`PORT`, `npm start`
  nor how to create the first member)

### RN-792 — On declaring the contract, the Arquiteto receives the stories' routes that the contract does not declare {#rn-792}

- **Rule:** after `declare_module_contracts` records the version
  ([RN-684](api.md#rn-684)), the tool reads the project's backlog and extracts,
  deterministically and without an LLM, every `MÉTODO /caminho` (GET, POST, PUT, PATCH,
  DELETE) from the title, description, RF and DoD of the non-archived stories, and the
  same pattern from the contract's `assinatura`s. A route cited by a story and
  absent from the UNION of the contract's routes (the front story cites the back
  route) comes back in the result as a DIVERGENCE, with what the contract declares for the
  same method — loop input ([RN-163](#rn-163)), for the Arquiteto to
  fix the contract or record the decision. Parameter (`:id`, `{id}`), trailing
  slash and query string are normalized; a ceiling of 10 lines, with the total. A
  failing backlog read does NOT refuse the declaration (already recorded): the result
  says it did not check. Left out, declared: a route only the contract
  declares (not a divergence), a story edited AFTER the declaration (only
  checked on the next one), and the contract following a route the DEV renamed
  (QA names the divergence in the verdict, [RN-786](api.md#rn-786), but nothing takes it
  back to the Arquiteto).
- **Where:** `apps/engine/lib/engine/harness/rotas_do_contrato.ex:37`
  (`divergencias`), `apps/engine/lib/engine/harness/tools/declare_module_contracts.ex:119`
  (`conferencia_com_historias`)
- **Test:** `apps/engine/test/engine/harness/tools/declare_module_contracts_test.exs`
  (`GET /painel` in the story × `GET /panel` in the contract flags; an equal route with
  normalized parameter and slash does not flag; an unreadable backlog says it did not
  check)
- **Origin:** AT-468 (TP-01 of 10/09: the story asked for `GET /painel`, the
  contract declared `GET /panel`, and nobody flagged it in the architecture)

### RN-796 — The gitleaks item states the rule and the excerpt with the secret masked {#rn-796}

- **Rule:** the item `gitleaks` puts in the SecOps verdict carries, besides the
  path and the line, the rule that flagged it (`RuleID`) and the flagged excerpt
  (`Match`) with the secret (`Secret`) replaced by `***` — never the secret in
  clear. Without the `Secret` to mask, the excerpt does not go in. And the execution
  agent's environment ([RN-706](#rn-706)) says in one line that a test password, token or
  key is generated at runtime, never as a literal. No
  new allowlist.
- **Where:** `apps/engine/lib/engine/actions/gitleaks_detector.ex:121`
  (`mensagem`), `apps/engine/lib/engine/harness/ambiente_do_agente.ex:102`
  (`montar`)
- **Test:** `apps/engine/test/engine/actions/gitleaks_relatorio_test.exs`,
  `apps/engine/test/engine/harness/ambiente_do_agente_test.exs`
- **Origin:** AT-470

### RN-797 — A task whose branch has no diff against `dev` closes as "already in dev" {#rn-797}

- **Rule:** on `report_done`, before proposing commit, push and PR, the dev agent
  asks whether the worktree's branch carries something `dev` does not have: a clean tree
  and `git diff --quiet <ponta da dev>...HEAD` with no difference. It is the case of the
  reintegrated task ([RN-779](#rn-779)) whose code already came in through another PR. Without a
  diff, the task closes as `done` with the `dev.task_already_in_dev` event
  (agent, task, branch, reason) — no commit, no PR, no gates and no
  click. Any doubt (a folder the engine cannot reach, as in
  `runner` mode; git that fails; missing `dev` ref) is "has a diff": the task goes on
  to the gates, it never closes on its own. It measures DIFF and not ancestry, so it
  also covers the squash merge that [RN-760](#rn-760) declares it does not see.
  Declared: the branch's old PR, if it exists, is not closed on the provider.
- **Where:** `apps/engine/lib/engine/dev/worktree_manager.ex:246`
  (`sem_diff_contra_a_dev?`), `apps/engine/lib/engine/dev/dev_agent_server.ex:1048`
  (`ja_na_dev`)
- **Test:** `apps/engine/test/engine/dev/tarefa_ja_na_dev_test.exs`
- **Origin:** AT-474

### RN-798 — QA checks the commands of the README touched by the delivery against the scripts {#rn-798}

- **Rule:** when the delivery's diff against `dev` touches a README, QA
  checks, without an LLM, that every `npm run <s>`, `npm test`, `npm start`,
  `pnpm [run] <s>` and `yarn [run] <s>` cited in it exists in `scripts` of the
  `package.json` of the same folder (otherwise the one at the worktree root). The check
  enters consolidation as one more verdict ("Conferência do README"):
  a divergence is `changes_requested` with one item per command, naming the
  missing script; with no divergence, it approves. Without a README in the diff, a diff that
  failed or an unreachable `package.json`, nothing is asserted. OUT, declared:
  the manager's built-in subcommand (`pnpm install`, `pnpm dlx`…), a command
  with a flag before the script (`pnpm --filter x test`), the project's own CLI flags
  and a command that is not Node's.
- **Where:** `apps/engine/lib/engine/gates/conferencia_do_readme.ex:28`
  (`conferir`), `apps/engine/lib/engine/gates/qa_lead_server.ex:776`
  (`conferencia_do_readme`)
- **Test:** `apps/engine/test/engine/gates/conferencia_do_readme_test.exs`
- **Origin:** AT-475

### RN-805 — The recorded test plan is the one the tool accepted {#rn-805}

- **Rule:** `emit_plano_de_teste` validates the ALREADY normalized arguments
  ([RN-719](#rn-719): `criteriosExecutaveis` in a JSON string becomes a list), and the
  hook that ends the QA-strategy's loop reads `criteriosExecutaveis` through the SAME
  normalization (`Termination.lista/1`, that of [RN-787](#rn-787)). Before, the tool
  said "plano registrado: 9 critérios", the hook carried the raw string, the
  artifact was refused (`:criterios_vazios`), the agent returned `{:ok, plano}`
  anyway and the Automação fell into the string's `Enum` — the QA Lead died and the
  gate stayed stopped until the rescue (18 min in real use). A refused artifact
  is now a NAMED failure of the QA-strategy (`agent.error`, origin `codigo`) and the
  review goes on without a plan, as it already did when the plan fails; the Automação
  also normalizes the criteria it receives.
- **Where:** `apps/engine/lib/engine/gates/hooks/termination_plano_de_teste.ex:23`
  (`criterios_executaveis`), `apps/engine/lib/engine/gates/qa_estrategia_agent.ex:231`
  (`emit_returning`)
- **Test:** `apps/engine/test/engine/gates/qa_estrategia_agent_test.exs`
  ("critérios em string JSON viram lista: o plano é gravado e devolvido como lista")
- **Origin:** AT-478 (TP-01 of 10/10)

### RN-806 — One QA cycle per task: a request prior to the verdict is discarded {#rn-806}

- **Rule:** the QA Lead runs ONE cycle per task. A `{:run, task}` request for the
  task whose cycle is suspended waiting for a decision is ignored, and at the end of a
  cycle (verdict or block) every `{:run, task}` that was waiting in the
  process's mailbox is discarded — it was requested before the verdict existed, and the
  dev's legitimate correction is only born after it. In real use the rescue
  ([RN-722](#rn-722)) fired the cycle twice at the same instant, and the
  second, running after the approved one, recorded a contrary verdict about the
  already merged task. OUT, declared: two engine replicas (the mailbox is
  per process, the same caveat as the `GateRescuer`) and the cause of the double
  sweep of the rescue, which was not fixed here.
- **Where:** `apps/engine/lib/engine/gates/qa_lead_server.ex:106` (`handle_cast`),
  `apps/engine/lib/engine/gates/qa_lead_server.ex:157` (`descartar_pedidos_obsoletos`)
- **Test:** `apps/engine/test/engine/gates/qa_lead_server_test.exs` ("pedido
  repetido que esperava na caixa é descartado ao fim do ciclo"; "pedido para a
  task com ciclo suspenso não abre um segundo")
- **Origin:** AT-478 (TP-01 of 10/10)

### RN-810 — A transient provider network failure is retried, and its block is `infra` without counting in the breaker {#rn-810}

- **Rule:** when the call to the model comes back with a provider NETWORK error —
  the `connection`/`timeout` `code` the api normalizes (ADR 0041) or, without a
  code, the transport text (`EAI_AGAIN`, `ECONNRESET`, `ETIMEDOUT`,
  `ECONNREFUSED`, `ENOTFOUND`) —, the `ToolLoop` retries it up to twice, with
  waits of 1 s and 3 s, recording `toolloop.network_retry` each time. It applies to
  every consumer of the `ToolLoop` (dev agents and gate subagents). Once the
  ceiling is exhausted, the outcome's origin is `infra`, never `codigo`, and the task's block
  of the dev agent for that cause does NOT increment the consecutive blocks counter
  ([RN-047](#rn-047)): the agent keeps claiming. In real use a
  17 s `getaddrinfo EAI_AGAIN openrouter.ai` blocked two tasks as
  `codigo` and tripped the dev.
- **Where:** `apps/engine/lib/engine/harness/tool_loop.ex:246`
  (`llm_turn_com_retentativa`), `apps/engine/lib/engine/agents/falha_de_turno.ex:112`
  (`falha_de_rede?`), `apps/engine/lib/engine/dev/dev_agent_server.ex:952`
  (`bloquear_parada`), `apps/engine/lib/engine/dev/agent_io.ex:228`
  (`finish_task`)
- **Test:** `apps/engine/test/engine/harness/tool_loop_test.exs` ("falha de
  rede do provider: retenta e segue quando a rede volta"; "falha de rede que
  persiste esgota o teto"), `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  ("erro de rede do provider: origem infra e o disjuntor não conta"),
  `apps/engine/test/engine/agents/falha_de_turno_test.exs`
- **Origin:** AT-484 (TP-01 of 10/10)

### RN-811 — "Already in dev" compares against the remote's updated `dev` {#rn-811}

- **Rule:** before the "already in dev" check ([RN-797](#rn-797)) on
  `report_done`, the dev agent updates the remote's `dev` through the SAME `fetch`
  that [RN-779](#rn-779) does on claim, serialized per project. Without it the
  comparison used the `dev` of the day the worktree was born: the branch of a task
  whose commits had already entered the remote `dev` through another task's PR went
  through QA and SecOps with 0 files. A failing `fetch` decides nothing — it compares
  with what there is, and when in doubt the task goes on to the gates.
- **Where:** `apps/engine/lib/engine/dev/worktree_manager.ex:267`
  (`sem_diff_contra_a_dev?`), `apps/engine/lib/engine/dev/worktree_manager.ex:277`
  (`sem_diff_atualizado?`), `apps/engine/lib/engine/dev/dev_agent_server.ex:892`
  (`handle_outcome`)
- **Test:** `apps/engine/test/engine/dev/tarefa_ja_na_dev_test.exs` ("caminho
  feliz: com a dev atualizada, a branch não tem diff"; "falha: remoto
  inalcançável não fecha a task sozinha")
- **Origin:** AT-486 (TP-01 of 10/10)

### RN-813 — A task that touches the entry point requires evidence that it starts {#rn-813}

- **Rule:** extension of the cut of [RN-765](#rn-765). When the task's title or
  description touches the entry point, the wiring (routes, migration,
  registration) or the run README, the QA gate's cut gains the section
  "Ponto de entrada": require evidence that the REAL entrypoint starts (the
  project's `start`/`main` run, or a test that imports the real entrypoint,
  not an app assembled in the test itself) and responds on a route or command. Without
  that evidence, the gap goes to `itens`. It is a PROMPT yardstick: the gates'
  external contract (`docs/gates.yml`) and the `emit_qa_verdict` code do not
  change, and no new gate is born. A task that touches none of that does not get the
  section.
- **Where:** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:121`
  (`secao_do_ponto_de_entrada`)
- **Test:** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  ("tarefa que toca a fiação exige evidência do ponto de entrada real" and "tarefa
  que não toca entrypoint nem fiação não ganha a seção")
- **Origin:** AT-483 (TP-01 of 10/10: `server.ts` never called the migration of the
  `links` table and `/:code` shadowed `GET /links`; the 53 tests passed because
  each one assembled its own database and app)

### RN-814 — The QA verdict lists all the gaps in one round {#rn-814}

- **Rule:** extension of the cut of [RN-765](#rn-765): the QA gate lists in
  `itens` ALL the task's gaps it finds in the round, at once, never one
  per round — each round is a paid correction and a step of the cycle's ceiling. The
  previous prompt only said to list "which rules are missing", and a gap that was not
  an uncovered rule was left for the next round. Prompt yardstick.
- **Where:** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:20` (`texto`)
- **Test:** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs` ("o
  recorte pede todas as lacunas numa volta só")
- **Origin:** AT-487 (TP-01 of 10/10, task `c7ced5a2`: two failures for
  two gaps that already existed in the original delivery)

### RN-817 — QA runs the suite in a clean state, and a skipped test is not green {#rn-817}

- **Rule:** extension of the cut of [RN-765](#rn-765), for every task. Before
  running the suite, the QA gate shuts down what the project ITSELF left up
  (the `start`'s server listening on a project port), only processes from that
  folder, never outside ones. A test that starts a process must terminate the GROUP (or
  start `node` directly, not via `npm`); one that does not terminate hangs the suite in a
  clean clone and is a gap in `itens`. A test that SKIPPED itself due to environment (port
  in use, missing tool) does not count as green: it goes to `resumo` as an
  observation. It is an instruction of the cut, not a harness step: the one who runs the suite
  is QA itself through `terminal`, which already goes through the policy and the
  container routing of the three modes — a `pkill` in the harness would need
  a second execution path per mode. Prompt yardstick; the gates' contract
  does not change.
- **Where:** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:178`
  (`secao_do_ambiente_limpo`)
- **Test:** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  ("RN-817: pede ambiente limpo, encerrar o grupo e pulado como observação")
- **Origin:** AT-496 (TP-01 of 10/10: `npm test` hung in a clean clone — the
  test killed `npm` and the grandchild `node` stayed on 3000 —, and in the container QA
  saw exit 0 because the test skipped itself with the port taken by an orphan
  server)

### RN-818 — The entry point evidence is the one the dev's environment produces {#rn-818}

- **Rule:** extension of [RN-813](#rn-813). The "Ponto de entrada" section says
  what COUNTS as evidence in the dev's environment — starting the
  entrypoint's process in the project folder, running the script in the project container,
  hitting a route of the running process — and what does NOT fit there: building a Docker
  image, `docker compose`, external network. A requirement of that second kind never
  goes to `itens`; it goes to `resumo` as an observation. Prompt yardstick.
- **Where:** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:121`
  (`secao_do_ponto_de_entrada`)
- **Test:** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  ("RN-818: com ponto de entrada diz o que conta e o que não cabe" and "RN-818:
  sem ponto de entrada não traz a régua de evidência")
- **Origin:** AT-492 (TP-01 of 10/10, task `c708f8b2`: the 4th round required
  building the image from the Dockerfile, the project container has no
  Docker, and the cycle ran out in a `politica` block)

### RN-819 — QA sweeps rule by rule before emitting {#rn-819}

- **Rule:** extension of [RN-814](#rn-814). Besides listing all the gaps, the
  cut asks for a SWEEP BY RULE before emitting: go through each business
  rule and each criterion of the task, one by one, pointing out where the proof is
  or that it is missing, and only emit after going through all of them. "List all"
  alone did not prevent a pre-existing gap appearing in the next round.
  Prompt yardstick.
- **Where:** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:20` (`texto`)
- **Test:** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  ("RN-819: pede varredura por regra antes de emitir")
- **Origin:** AT-490 (TP-01 of 10/10: tasks 2 and 11 brought in the 2nd round
  a gap that was already in the delivery)

### RN-823 — The gate cycle the engine restart killed is resumed at boot, and the thread says so {#rn-823}

- **Rule:** at engine BOOT, a RECENT `in_progress` row of `gate_states`
  (below `gate_rescue_stale_after_seconds`, 15 min, and therefore
  invisible to the tick) with no live process ON THIS node nor on the OTHER nodes of the
  cluster is an orphan of the restart, not a slow cycle: the boot resumes it right away
  (`Dispatcher.run_qa`/`run_secops`), without waiting for the threshold. "Alive" is the yardstick of
  [RN-722](#rn-722) (the task in flight in the lead), also asked of the other nodes
  through `:erpc.multicall` — a node that does not answer counts as ALIVE, the yardstick of
  `TurnoOrfao` ([RN-586](#rn-586)). The usual guards apply: a pending action
  of a gate actor does not restart, and an absent dev owner only deletes the row. Before
  redispatching, the boot records `gate.interrupted` in the session log (`taskId`,
  `gate`, `ultimaAtividadeEm`, `retomadoEm`), and the thread shows it as a notice, in
  both languages. The periodic tick does NOT change: outside boot, a recent row is a cycle
  in flight. Declared residue: a node that has not yet joined the cluster at the moment of
  boot is not asked, and the worst outcome is the usual one (duplicated and
  cheap work; the second verdict is refused by the api).
- **Where:** `apps/engine/lib/engine/gates/gate_rescuer.ex:191` (`run_boot`),
  `:209` (`interrompido_no_boot`),
  `apps/web/src/routes/RetomarGateEstacionado.tsx:33` (`cicloInterrompido`)
- **Test:** `apps/engine/test/engine/gates/gate_rescuer_test.exs` ("boot com
  ciclo RECENTE órfão do reinício: grava gate.interrupted e retoma já
  (RN-823)"; failures: "boot com ciclo recente esperando ação PENDENTE do gate:
  não reinicia nem grava (RN-823)" and the live local process untouched),
  `apps/web/src/routes/RetomarGateEstacionado.test.tsx` ("cicloInterrompido
  (RN-823)")
- **Origin:** AT-495 (TP-01 of 10/10: the 18:51 restart killed the QA cycle
  of task 10, and the dev stayed `awaiting_gate` for 15 min without any screen saying so)

### RN-832 — The dev agent knows `report_done` does commit, push and PR, and that a new test goes into the `test` script {#rn-832}

- **Rule:** the dev agent neither has nor needs `git_commit`, `git_push` or
  `pr_open`: commit, push and PR happen when it calls `report_done`. The
  description of `report_done`, that of `report_blocked` ("missing git tool"
  is not a reason to block), the dev agent's kickoff and the environment message
  ([RN-706](#rn-706)) say so — the environment one said, until now, to use the
  typed git actions, which the dev does not have. The kickoff and the environment also say
  that, if the `package.json`'s `test` script lists files one by one, every
  new test file goes into it. Text only: no new code rule, and
  the Jev stays without a floor for dev agents ([RN-758](api.md#rn-758)) — until [RN-839](api.md#rn-839), which put `report_done`/`report_blocked` in their floor.
- **Where:** `apps/engine/lib/engine/dev/tools/report_done.ex:16` (`spec`),
  `apps/engine/lib/engine/dev/tools/report_blocked.ex:12` (`spec`),
  `apps/engine/lib/engine/dev/dev_agent_server.ex:604` (`initial_message`),
  `apps/engine/lib/engine/harness/ambiente_do_agente.ex:102` (`montar`)
- **Test:** `apps/engine/test/engine/dev/report_done_instrucao_test.exs`
  ("caminho feliz: report_done, kickoff e ambiente carregam as duas
  instruções"; failure: "o ambiente não manda mais usar as ações tipadas de git")
- **Origin:** AT-499 (TP-01, 11th: a task blocked with the suite green for
  "git_commit não existe"; four QA rounds for a test outside the `test` script)

### RN-845 — The proposed ADRs read says whether the PR has already been merged {#rn-845}

- **Rule:** on the row of an `executed` ADR, `listar_adrs_propostas`
  ([RN-772](#rn-772)) no longer asserts "PR aberta" from the ACTION's status: it crosses the
  result's `pullRequestId` with the EXECUTED `git_merge` of the same project
  (the action every merge goes through, [RN-418](api.md#rn-418)) and says "PR MERGEADA em
  <data da decisão>" or "PR aberta (nenhum merge dela registrado no Brabo)".
  A result without a PR id, or a merge query that fails, becomes "estado da PR:
  NÃO CONSEGUI LER" — never "aberta". Contained (ADR 0060): one extra query,
  only over the listed ids, in the same Postgres. Declared limit: a PR closed
  without a merge OUTSIDE the Brabo (on the remote provider) is not seen, and keeps being read as
  open — asking the provider would be HTTP in the agent's loop.
- **Where:** `apps/engine/lib/engine/harness/tools/listar_adrs_propostas.ex:88`
  (`cruzar_com_merges`), `:102` (`merges_por_pr`), `:155` (`estado_da_pr`).
- **Test:** `apps/engine/test/engine/harness/tools/listar_adrs_propostas_test.exs`
  ("PR mergeada aparece como mergeada…", "estado da PR ilegível diz que não
  leu, nunca aberta").
- **Origin:** AT-514 (TP-01, 10/11: the Arquiteto said "aberta como PR" 30 s
  after the merge).

### RN-846 — The HTTP route goes into the README and the input error is the project's {#rn-846}

- **Rule:** extension of [RN-819](#rn-819). The execution dev agent's kickoff
  asks that an HTTP route created or changed go into the README (method,
  path, body, responses and codes) and that an input error (malformed JSON,
  invalid field) respond with its own message in the project's format, never the
  library's raw message. The QA cut checks both things in the
  sweep by rule, and whatever is missing goes to `itens`. Prompt yardstick.
- **Where:** `apps/engine/lib/engine/dev/dev_agent_server.ex:604`
  (`initial_message`) and `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:20`
  (`texto`)
- **Test:** `apps/engine/test/engine/dev/report_done_instrucao_test.exs`
  ("RN-846: kickoff pede a rota no README e erro de entrada próprio") and
  `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs` ("RN-846: confere
  rota no README e erro de entrada próprio")
- **Origin:** AT-515 (TP-01, 12th: the README did not document the API, and malformed
  JSON responded 400 with the parser's "Expected property name…")

### RN-849 — The architecture readiness turn opens with the current state of the ADRs {#rn-849}

- **Rule:** extension of [RN-845](#rn-845). When the user confirms that the
  architecture is ready, the Arquiteto's server READS the ADRs' state through the
  same code as `listar_adrs_propostas` (local Postgres, no HTTP, same ceiling
  of 20 lines) and puts it in that turn's opening message, with the instruction
  not to assert a different ADR state. A failing read says "NÃO CONSEGUI LER"
  and says to state that it does not know — never "pendente".
- **Where:** `apps/engine/lib/engine/harness/tools/listar_adrs_propostas.ex:50`
  (`contexto_de_prontidao`), `apps/engine/lib/engine/agents/arquiteto_server.ex:225`
  (`contexto_de_prontidao`).
- **Test:** `apps/engine/test/engine/harness/tools/listar_adrs_propostas_test.exs`
  ("contexto_de_prontidao/2 (RN-849)").
- **Origin:** AT-519 (TP-01: in the readiness turn the Arquiteto said "pendente
  de aprovação" about an already merged ADR, repeating the previous turn's read).

### RN-850 — The route goes into the "Rotas HTTP" section and the README carries no process note {#rn-850}

- **Rule:** extension of [RN-846](#rn-846). The dev agent's kickoff asks that the
  route go INSIDE the README's "Rotas HTTP" section (created before "Testes"
  if missing), never at the end of the file, and that the README, which is the user's, not
  get a process note nor instructions for agents. The QA cut checks
  both things. Prompt yardstick.
- **Where:** `apps/engine/lib/engine/dev/dev_agent_server.ex:604`
  (`initial_message`) and `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:20`
  (`texto`)
- **Test:** `apps/engine/test/engine/dev/report_done_instrucao_test.exs`
  ("RN-850: a rota vai dentro de Rotas HTTP e o README não leva nota de
  processo") and `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  ("RN-850: confere a seção Rotas HTTP e a ausência de nota de processo")
- **Origin:** AT-520 (TP-01: each task added routes at the end of the README,
  after "Testes", and a process paragraph for agents was left over)

### RN-851 — The Infra's compose starts the APP on the user's machine, and the PR declares how to run it {#rn-851}

- **Rule:** the Infra Lead's kickoff asks for the compose that STARTS THE APP (not only a
  dev environment): `build` of each module's Dockerfile with `FROM` = the
  decided image (`projectImage` of the Infra's context; without it, the
  routing's candidate, stated in the README), port `${APP_PORT:-8080}:<porta interna>`, a volume
  for persistent data, a committed `.env.example` (never `.env`) and the section
  "Rodar na sua máquina" in the README. The agents' WORK container still
  starts through the broker, and there is no deploy. `propose_infra_pr` gets the
  MANDATORY field `run` (`command` up to 300 characters; `urls` from 1 to 5, `label` up to
  60, `kind` in `api_docs | web`, `url` starting with `http://localhost:` or
  `http://127.0.0.1:`; boolean `envExample`), validated in the engine BEFORE the HALT
  with a named refusal that enters the loop (RN-163) and passed on in the
  `open_infra_pr` payload. Decision in [ADR 0213](../adr/0213-o-entregavel-roda-na-maquina-pelo-compose-da-infra.md).
- **Where:** `apps/engine/lib/engine/infra/instrucoes_de_execucao.ex:20`
  (`validar`), `apps/engine/lib/engine/infra/infra_lead_server.ex:1398`
  (`build_kickoff`) and `:1256` (`abrir_pr`), and
  `apps/engine/lib/engine/infra/tools/propose_infra_pr.ex:24` (`spec`)
- **Test:** `apps/engine/test/engine/infra/infra_lead_server_test.exs`
  (describe "o compose sobe o app e a PR leva `run` (RN-851)")
- **Origin:** AT-517 (the deliverable had no way to be run by the user)

### RN-853 — The dev exposes OpenAPI and Swagger when the task touches routes {#rn-853}
- **Rule:** part of ADR 0213. When the
  task touches the entry point or routes (the SAME yardstick as the QA cut,
  `toca_ponto_de_entrada?`, never a copy), the dev's kickoff gets the
  clause: a module that exposes HTTP serves `/openapi.json` (OpenAPI 3) and `/docs`
  (Swagger UI); without network or without the package, `/docs` is an HTML page that loads
  swagger-ui from a CDN; a web module serves the home page; the URL goes into the
  "Rodar na sua máquina" section of the README. A task that does not touch routes does not pay the
  clause (the message is pinned and comes back on every iteration).
- **Where:** `apps/engine/lib/engine/dev/dev_agent_server.ex:636`
  (`clausula_de_openapi`),
  `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:113`
  (`toca_ponto_de_entrada?`)
- **Test:** `apps/engine/test/engine/dev/report_done_instrucao_test.exs`
  ("RN-853: tarefa que toca rotas pede /openapi.json e /docs"; failure: "RN-853
  falha: tarefa sem rota nem entrypoint não paga a cláusula")
- **Origin:** AT-517

### RN-854 — QA proves `/openapi.json` and `/docs` inside the container {#rn-854}

- **Rule:** part of ADR 0213. In the
  entry point section of the cut ([RN-813](#rn-813)), QA starts the app with the
  README's command in the background INSIDE the container, hits
  `localhost:<porta interna>/openapi.json` and `/docs` (`curl`, `wget` or
  `node -e fetch`) and terminates the process group ([RN-817](#rn-817)). A failure
  goes to `itens`; the real `docker compose up` stays in `resumo` as "proven only
  on the user's machine".
- **Where:** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:121`
  (`secao_do_ponto_de_entrada`)
- **Test:** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  ("tarefa que toca rotas pede /openapi.json e /docs, compose em resumo";
  failure: "falha: tarefa sem rota não recebe a seção")
- **Origin:** AT-517

### RN-862 — The open question on the engine side: tool, verdict and decision in the context {#rn-862}

- **Rule:** the Criativo, the PO, the Arquiteto and the Dev Lead declare every doubt
  left for the user with `declare_open_question` (`pergunta` up to 500,
  `sugestao` up to 300 optional, `afeta: {regras, historias, tarefas}`), which
  records `artifact.open_question` with `questionId` (uuid), `autor` and
  `sessionId`; an invalid payload is a named refusal and records nothing. The instruction is ONE
  central sentence, in the flow text of the four (RN-711), never per server. In the
  QA gate, a requirement "not confirmed by the user" (or contradicted by a current
  decision) is `needs_user_decision`, never `changes_requested`:
  `emit_qa_verdict` accepts it only with `pergunta` or `openQuestionId`, the QA Lead
  consolidates it above `approved`, the verdict goes to the api with the question and the cycle
  stays PARKED (ADR 0207, `gate.rescue_parked`, without automatic rescue)
  until the api asks for resumption through the RN-724 route. The dev-context `decisoes`
  enter the dev's kickoff and the QA cut as "Decisões do usuário —
  vencem RF/DoR quando conflitam" (`pergunta → decisao`); empty writes
  nothing. The recorded question counts in the turn's closing (RN-731), and the PO passes
  `question_id` in `update_story`/`complete_story` when it corrects the story from
  an answer ([ADR 0214](../adr/0214-pergunta-em-aberto-vira-pendencia.md)).
- **Where:** `apps/engine/lib/engine/harness/tools/declare_open_question.ex:54` (`run`),
  `apps/engine/lib/engine/harness/fluxo_do_time.ex:113` (`frase_da_pergunta`),
  `apps/engine/lib/engine/gates/tools/emit_qa_verdict.ex:77` (`run`),
  `apps/engine/lib/engine/gates/qa_lead.ex:89` (`consolidar_decisao`),
  `apps/engine/lib/engine/gates/qa_lead_server.ex:569` (`estacionar_por_decisao`),
  `apps/engine/lib/engine/dev/context_builder.ex:121` (`secao_de_decisoes`)
- **Test:** `apps/engine/test/engine/harness/perguntas_em_aberto_test.exs`
  ("válida grava artifact.open_question…"; "inválida é recusa nomeada…";
  "consolidação: needs_user_decision vence approved"; "o recorte diz a régua…";
  "ContextBuilder: a história leva as decisões…"),
  `apps/engine/test/engine/gates/qa_lead_server_test.exs` ("grava a pergunta
  na api, estaciona o ciclo e só o gesto humano o retoma")
- **Origin:** AT-521, [ADR 0214](../adr/0214-pergunta-em-aberto-vira-pendencia.md)

### RN-863 — `api_docs` is always `/docs`, every route enters the OpenAPI, and QA fails the missing one {#rn-863}

- **Rule:** an HTTP module ALWAYS declares `/docs` in `run.urls` (the Swagger UI,
  `kind: "api_docs"`) even before it exists, and a web module the home page —
  never a business route; the Infra's kickoff says so in the README step
  (extends RN-851). The `run` validation refuses, named and with the SAME yardstick
  on both sides, an `api_docs` whose URL does not end in `/docs` (extends
  RN-852). The dev's clause says that EVERY HTTP route created or changed in the task
  enters `/openapi.json` — path with method, body and responses (extends
  RN-853). In the QA cut, each route of the README's "Rotas HTTP" section must
  be in `paths` of the served `/openapi.json`; a missing route is an item that
  fails it, never an observation (extends RN-854).
- **Where:** `apps/engine/lib/engine/infra/instrucoes_de_execucao.ex:52` (`url`),
  `apps/api/src/domain/infra/run-instructions.ts:44` (`recusaDoRun`),
  `apps/engine/lib/engine/infra/infra_lead_server.ex:1398` (`build_kickoff`),
  `apps/engine/lib/engine/dev/dev_agent_server.ex:636` (`clausula_de_openapi`),
  `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:20` (`texto`)
- **Test:** `apps/engine/test/engine/infra/infra_lead_server_test.exs`
  ("run api_docs em rota de negócio é recusado com motivo, sem propor"),
  `apps/api/test/application/use-cases/execution/get-run-instructions.use-case.spec.ts`
  ("recusaDoRun (RN-852)"),
  `apps/engine/test/engine/dev/report_done_instrucao_test.exs` ("RN-853: …"),
  `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs` ("RN-854: …")
- **Origin:** AT-524, [ADR 0213](../adr/0213-o-entregavel-roda-na-maquina-pelo-compose-da-infra.md)

### RN-864 — A transient network failure comes back on its own in up to 3 attempts, and the dev pauses {#rn-864}

- **Rule:** a task blocked by the dev agent with origin `infra` for a
  TRANSIENT network/provider failure — an explicit allowlist: DNS
  (`EAI_AGAIN`, `ENOTFOUND`, `getaddrinfo`), `ECONNRESET`, `ETIMEDOUT`,
  `aborted`, the provider's HTTP 5xx/429 (codes `rate_limit`/`upstream`,
  `connection`/`timeout`) — is RESUMED on its own up to 3 times, after 1, 3 and
  10 min (owner decision), by an Oban job that calls the SAME unblock as the
  human (`UnblockTaskUseCase`, through the internal route `.../tasks/:taskId/unblock`,
  actor `system`, a no-op if the task is no longer blocked). The block's reason
  says which resumption was scheduled; after the 3rd resumption the next failure stays
  blocked as before, and the reason says the 3 have already been tried. And the agent
  PAUSES 1 min instead of taking the next task (the wake is ignored during the
  pause). Exhausted credit (402, RN-726/730) and code errors do NOT enter:
  they block right away. The resumption counter is only in memory: restarting the
  engine resets it.
- **Where:** `apps/engine/lib/engine/agents/falha_de_turno.ex:133`
  (`passageira?`), `apps/engine/lib/engine/dev/dev_agent_server.ex:982`
  (`bloquear_passageira`), `apps/engine/lib/engine/dev/agent_io.ex:293`
  (`pausar_por_rede`), `apps/engine/lib/engine/workers/retomada_de_tarefa_worker.ex:33`
  (`agendar`), `apps/api/src/application/use-cases/execution/unblock-task.use-case.ts:33`
  (`ator`)
- **Test:** `apps/engine/test/engine/dev/dev_agent_server_test.exs` ("falha
  passageira: agenda a retomada, pausa e não queima a fila", "fim da pausa
  volta a reivindicar"; failure: "falha passageira depois de 3 retomadas fica
  bloqueada pedindo o clique", "402 não agenda retomada"),
  `apps/engine/test/engine/workers/retomada_de_tarefa_worker_test.exs`
- **Origin:** AT-525

### RN-865 — Endpoint and HTTP verb with a path also switch on the OpenAPI check, and it covers the code's routes {#rn-865}

- **Rule:** the single yardstick of "the task touches the entry point/routes"
  (`toca_ponto_de_entrada?`, used by the QA cut and by the dev's clause of
  RN-853) also matches "endpoint" and an HTTP verb followed by a path
  (`POST /links`). Without it, a task described as "Endpoint protegido…" received
  neither the OpenAPI clause (dev) nor the `/openapi.json` check
  (QA) — that is how `POST /links` and `GET /panel` stayed out of the OpenAPI
  with both tasks approved in TP-01. The QA check now requires in
  `paths` of the served `/openapi.json`, besides the routes of the README's "Rotas HTTP" section,
  every route the CODE registers; a missing one is an item that fails it
  (extends RN-863).
- **Where:** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:103`
  (`@ponto_de_entrada`), `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:114`
  (`toca_ponto_de_entrada?`)
- **Test:** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  ("RN-865: tarefa que diz só endpoint ou verbo com caminho recebe a seção";
  failure: "falha: tarefa sem rota não recebe a seção")
- **Origin:** AT-527

### RN-868 — The gate rescue tick is a single chain {#rn-868}

- **Rule:** `GateRescueSchedulerWorker` reschedules its own successor with the
  SAME uniqueness as `kickoff/0` (states `available`/`scheduled`/`retryable`,
  without `executing`, a window of two intervals). Before, only `kickoff/0` was
  unique: the job in execution does not count, so the boot's kickoff with the
  previous tick in flight, or a retry that reruns `perform/1`, opened a SECOND
  chain, and they never merged. Measured in real use (10/14): 11 jobs
  scheduled at the same time and the RN-722 "espera decisão humana" line 11
  times per tick for ONE `gate_states` row. It was not a data defect. With
  uniqueness on rescheduling the duplicate chains collapse into one on the
  next tick.
- **Where:** `apps/engine/lib/engine/workers/gate_rescue_scheduler_worker.ex:42`
  (`unicidade`)
- **Test:** `apps/engine/test/engine/workers/gate_rescue_scheduler_worker_test.exs`
  ("o tick se reagenda e mantém a corrente viva"; failure: "com um sucessor já
  agendado, o tick não abre uma segunda corrente")
- **Origin:** AT-529

### RN-874 — The PO receives in the turn the user's decisions and the project's open questions {#rn-874}

- **Rule:** every PO turn carries, as an EPHEMERAL `system` message
  appended by the `EngineApiClient` facade right after the team flow
  (RN-711) — never in `state.messages` nor in the server's prompt —, the
  user's decisions (`artifact.decision_record`, `choice` and `context`) and the
  STILL open questions of the project (`artifact.open_question` without
  `open_question.answered` with the same `questionId`), from ALL sessions. The
  text says to write the decided ANSWER into the story, rule, DoR, DoD and
  task, never "pergunta em aberto N"; a still open question is cited by its
  `questionId`, without inventing an answer. The read is LOCAL (direct Postgres, without
  HTTP in the loop), of the 200 most recent events of those types, with a ceiling of 10
  decisions, 10 questions, 240 characters per item and 3,000 in the text. Without
  a decision or an open question, or with the read failing, the turn goes on without the
  message, never crashes. Only `po` receives it.
- **Where:** `apps/engine/lib/engine/harness/decisoes_do_projeto.ex:34`
  (`anexar`), `:49` (`texto`),
  `apps/engine/lib/engine/session_events/event.ex:224`
  (`list_types_for_project`),
  `apps/engine/lib/engine/sessions/engine_api_client.ex:707`
  (`DecisoesDoProjeto`)
- **Test:** `apps/engine/test/engine/harness/decisoes_do_projeto_test.exs`
  ("o turno do PO leva a decisão e só a pergunta AINDA aberta", "custo de
  entrada tem teto"; failure: "sem decisões nem perguntas não acrescenta nada",
  "leitura que falha deixa o turno sem a mensagem, sem queda")

### RN-876 — A `needs_user_decision` refused by the api goes back to QA, and only acceptance parks the gate {#rn-876}

- **Rule:** the QA gate only PARKS (`gate.rescue_parked`) when the api
  accepts the `needs_user_decision` verdict with `nextAction: "await_user"`. If the
  api REFUSES (400, 404, or the 409 `pergunta_ja_respondida`), the refusal goes back to the
  Automação QA's loop as a new message (RN-163: an error is loop input),
  resuming the SAME context in which it emitted — on the 409, with the decision already
  taken for QA to apply instead of asking again. The other delegations
  do not run again. The return counts toward its own loop's iteration ceiling;
  once exhausted, the task is blocked with the reason and origin `modelo` (RN-059),
  never silently parked. Before, the api's return was discarded and the
  gate parked without a question in the thread (measured: `openQuestionId: "1"`, a 400 from
  `@IsUUID`). The `emit_qa_verdict` tool refuses, INSIDE the loop and before the
  api, an `openQuestionId` that is not a uuid.
- **Where:** `apps/engine/lib/engine/gates/qa_lead_server.ex:575`
  (`devolver_ao_qa`), `apps/engine/lib/engine/gates/qa_lead_server.ex:308`
  (`devolver_ao_qa`), `apps/engine/lib/engine/gates/qa_lead_server.ex:671`
  (`texto_da_recusa`), `apps/engine/lib/engine/gates/qa_automacao_agent.ex:77`
  (`devolver`), `apps/engine/lib/engine/gates/tools/emit_qa_verdict.ex:75`
  (`uuid`)
- **Test:** `apps/engine/test/engine/gates/qa_lead_server_test.exs` ("400:
  nada estaciona, o QA recebe o motivo e uma nova volta acontece"; "409 no
  laço: a volta seguinte do QA lê a decisão"; failure: "teto esgotado depois da
  recusa: bloqueio narrado, nunca estacionamento"),
  `apps/engine/test/engine/harness/perguntas_em_aberto_test.exs` ("AT-526
  (RN-876): openQuestionId que não é uuid é recusa nomeada; uuid passa")
- **Origin:** AT-526

### RN-877 — The QA cut says to check the decisions before asking for a decision {#rn-877}

- **Rule:** the QA cut's instruction says that, before
  `needs_user_decision`, it checks the listed decisions; a requirement that one
  of them already answers is not a question and the decision applies. `openQuestionId` only
  with the uuid of an OPEN question; without it, the new question goes in
  `pergunta`/`sugestao`. It is a reading reminder: it does not change the verdict yardstick.
- **Where:** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:20` (`texto`)
- **Test:** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  ("AT-526 (RN-877): manda conferir as decisões antes de needs_user_decision";
  the instruction's failure is covered by the RN-876 test of the tool)
- **Origin:** AT-526

### RN-878 — The execution agent's language applies from the first sentence {#rn-878}

- **Rule:** in the execution agents' turns WITHOUT a human author (`dev-*`,
  `qa-*`), RN-622's language guidance says it applies from the FIRST
  sentence, including the narration before each tool, and loses the caveat
  "unless the user asks" (there is no user in the turn). Measured in session
  `6c68fbc0` (pt-BR project, `anthropic/claude-haiku-5.5`): the guidance
  arrived, and even so iteration 0 of `qa-automacao` and of
  `dev-encurtador-api` opened in English ("I'll start by running…"). The path
  is still ONE (the facade, RN-622): nothing in a server prompt,
  `agent_instructions` or tool description (RN-667). The 50-token ceiling
  (AT-169) holds: measured with `gpt-tokenizer`, `pt-BR` 32/26, `en` 19/19 and the
  generic one with a short-form code in the worst case 30/30 (cl100k/o200k); a code
  outside the short form falls back to the usual guidance, which already fit. A turn with an
  author and the conversational agents do not change. Without a resolved language, nothing is
  added. Effectiveness is measured in the next TP-01.
- **Where:** `apps/engine/lib/engine/harness/idioma_da_resposta.ex:164`
  (`orientacao_de_execucao`), `:154` (`agente_de_execucao?`)
- **Test:** `apps/engine/test/engine/harness/idioma_da_resposta_test.exs`
  ("agente de execução: vale desde a primeira frase, dentro do teto"; failure:
  "agente de execução sem idioma resolvido: nada é acrescentado")
- **Origin:** AT-530

### RN-879 — The deliverable's absolute URL with the port, and the same `code` for the same error {#rn-879}

- **Rule:** when the task touches the entry point or routes, the dev's clause
  says that an absolute URL returned by the deliverable's API (e.g. the short link)
  comes from `PUBLIC_BASE_URL` or from the request's `Host` WITH the port — never
  a fixed `http://localhost` nor the hostname without a port —, and that the same error case
  responds with the same `code` on all routes. The QA cut checks
  both things and treats the divergence (e.g. `not_found` × `link_not_found`)
  as an ITEM. Owner decision of 10/14: a general rule.
- **Where:** `apps/engine/lib/engine/dev/dev_agent_server.ex:644` (`clausula_de_openapi`);
  `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:122` (`secao_do_ponto_de_entrada`)
- **Test:** `apps/engine/test/engine/dev/report_done_instrucao_test.exs`
  ("RN-879/880: tarefa que toca rotas leva URL com porta, code único e CORS" and
  the failure "RN-879/880 falha: tarefa sem rota não recebe CORS nem PUBLIC_BASE_URL");
  `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs` ("RN-879/880: URL,
  code de erro e CORS")
- **Origin:** AT-531

### RN-880 — The deliverable answers configurable CORS, with relative `servers` and a pinned swagger-ui {#rn-880}

- **Rule:** in the same clause, the deliverable's API answers CORS with origins
  from `CORS_ORIGINS` (default `http://localhost:<porta>` and
  `http://127.0.0.1:<porta>`), `OPTIONS` 204 and `Access-Control-Allow-*` with
  `Authorization` and `Content-Type`; `/openapi.json` declares `servers` only
  relative (`/`) — an absolute URL would create the CORS error when the page is opened
  through another host —, and swagger-ui from a CDN goes with an exact version, never `@5`. The
  QA proves it with a preflight from another origin (`curl -X OPTIONS`) and fails it without
  the headers, with absolute `servers` or with the floating CDN.
- **Where:** `apps/engine/lib/engine/dev/dev_agent_server.ex:644` (`clausula_de_openapi`);
  `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:122` (`secao_do_ponto_de_entrada`)
- **Test:** the same as RN-879 (happy path and failure in both files)
- **Origin:** AT-532

### RN-881 — The engine prints the project's other decisions for the dev and QA {#rn-881}

- **Rule:** the `decisoesDoProjeto` the api returns in `dev-context`
  (RN-872, ADR 0215, already with a ceiling) becomes the section "Outras decisões do projeto",
  separate and AFTER the task's decisions, in the dev's story unit and in the
  QA cut. Empty or absent writes nothing; the engine applies no ceiling
  of its own.
- **Where:** `apps/engine/lib/engine/dev/context_builder.ex:133` (`secao_de_decisoes_do_projeto`);
  `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:20` (`texto`)
- **Test:** `apps/engine/test/engine/dev/context_builder_test.exs` ("RN-881:
  decisoesDoProjeto vira a seção..." and "RN-881 falha: sem decisoesDoProjeto a
  seção some"); `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  ("RN-881: outras decisões do projeto")
- **Origin:** AT-526 (slice F4, engine side)

### RN-885 — The deliverable's CORS uses the PUBLISHED port, and QA checks the header on both origins {#rn-885}

- **Rule:** revises RN-880 (which still holds for the rest). The default of the
  deliverable's `CORS_ORIGINS` uses the PUBLISHED port — `APP_PORT`, which the
  compose passes to the app —, never the internal `PORT`: in TP-01 (16th) the default came out
  with `PORT=3000` and, with the compose publishing 8080, no real origin received
  `Access-Control-Allow-Origin` (measured with curl: `:3000` receives, `:8080` does not;
  in Chrome, `Failed to fetch`). QA runs the preflight against the PUBLISHED port,
  once for `http://localhost:<APP_PORT>` and again for
  `http://127.0.0.1:<APP_PORT>`, and fails it without the
  `Access-Control-Allow-Origin` header — a 204 alone is not enough, and CORS only on the internal
  port is an ITEM.
- **Where:** `apps/engine/lib/engine/dev/dev_agent_server.ex:644` (`clausula_de_openapi`);
  `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:122` (`secao_do_ponto_de_entrada`)
- **Test:** `apps/engine/test/engine/dev/report_done_instrucao_test.exs`
  ("RN-885: o padrão do CORS usa a porta PUBLICADA, nunca a interna"; failure:
  "RN-879/880 falha: tarefa sem rota não recebe CORS nem PUBLIC_BASE_URL");
  `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs` ("RN-885: o
  preflight é na porta PUBLICADA, nas duas origens, e confere o header")
- **Origin:** AT-535

### RN-890 — QA demands the command-line exit code, on refusal too {#rn-890}

- **Rule:** the Automação QA's instruction says to check, in the test that
  proves a command-line command of the delivery (CLI, `package.json` script), the
  exit code 0 on the happy path and non-zero when the command refuses
  the input; a test without that check on refusal is a rule without coverage and goes
  to `itens`. The QA-strategy instruction asks, in `criteriosExecutaveis`,
  for these two criteria for every command that refuses input. It is an agent
  instruction: no new gate, no change of verdict or structure.
- **Where:** `apps/engine/lib/engine/gates/qa_automacao_agent.ex:142`
  (`instrucao_de_codigo_de_saida`),
  `apps/engine/lib/engine/gates/qa_estrategia_agent.ex:129`
  (`instrucao_de_codigo_de_saida`)
- **Test:** `apps/engine/test/engine/gates/qa_automacao_agent_test.exs` ("a
  instrução cobra código de saída 0 no feliz e diferente de 0 na recusa");
  `apps/engine/test/engine/gates/qa_estrategia_agent_test.exs` ("os arquivos
  da entrega entram na mensagem")
- **Origin:** AT-542 (TP-01, 17th: `npm run user:create` refused the password and
  exited with 0)

### RN-893 — The PO declares the edge of the provided value in the RF and the DoD {#rn-893}

- **Rule:** the PO's kickoff instruction (with or without an event log) carries a
  third obligation: every RF that receives a value provided by the user (date,
  number, text, list, limit) declares, in the RF and the DoD, whether the edge —
  past/future, zero, empty, negative, the limit itself — is ACCEPTED or
  REFUSED (with the HTTP status/error); the example is an expiration in the
  past. When unsure, the PO calls `declare_open_question` with
  `afeta.historias` and a suggestion, never inventing or omitting. A PROMPT
  rule, in the mold of [RN-790](#rn-790): no tool refuses a story without an
  edge. The PO does NOT start rewriting `business_rule`; Creative, QA, schema
  and gate do not change.
- **Where:** `apps/engine/lib/engine/agents/po_server.ex:649` (`obrigacoes`)
- **Test:** `apps/engine/test/engine/agents/po_server_test.exs:438` (the
  kickoff instruction carries the edge obligation) and `:460` (without an event
  log, the kickoff still carries it)
- **Origin:** AT-541 (TP-01 of 10/14: the deliverable accepted `expiresAt` in
  the past and the link was born expired, 410; the story's RF only said the
  expiration is optional), owner's decision of 10/15

### RN-895 — The argument refusal says what arrived and the expected format {#rn-895}

- **Rule:** revises [RN-719](#rn-719) and [RN-725](#rn-725). A field declared `array`/`object` that arrives as non-JSON text, or as a number/boolean/wrong type, is refused before the tool with "the field X arrived as <type>; send <format>", with an example (`["item 1","item 2"]`, `{"chave":"valor"}`), never with the value. The `emit_plano_de_teste` sentence now puts the keys in backticks, so the refusal carries the received keys.
- **Where:** `apps/engine/lib/engine/harness/argumentos_de_ferramenta.ex:80` (`coagir`); `apps/engine/lib/engine/gates/tools/emit_plano_de_teste.ex:73` (`run`)
- **Test:** `apps/engine/test/engine/harness/argumentos_de_ferramenta_test.exs:193` and `:201` (the format and the received type) and `:210` (the received keys)
- **Origin:** AT-583 (TP-01 18th and 19th: `dod` arrived as a markdown checklist and the test plan was refused 4 times without saying what came)

### RN-896 — The `epic_id` is validated before the api {#rn-896}

- **Rule:** `create_story` refuses an `epic_id` that is not a UUID ("epic_id inválido; …"). When the PO already created epics in this process (`epicos_conhecidos`) and the id is not among them, it rereads the backlog ONCE (`list_backlog`): if the id is there, it accepts; otherwise it refuses listing the backlog's `id=title` (cap of 20 lines, stating the total if truncated, ADR 0060). An empty map or a failing backlog read means "unknown" and does not refuse — the api decides.
- **Where:** `apps/engine/lib/engine/harness/tools/create_story.ex:57` (`epico_valido`)
- **Test:** `apps/engine/test/engine/harness/argumentos_de_ferramenta_test.exs:224` and `:233`
- **Origin:** AT-584 (qwen sent `EPIC_ID_PLACEHOLDER_NAO_USAR_AQUI` and the api answered with the DTO name)

### RN-897 — A provider cut by `max_tokens` in a gate is origin `modelo` {#rn-897}

- **Rule:** the `agent.error` of the `qa-estrategia`, `qa-automacao`, `qa-performance-seguranca` and `appsec` gates classifies "Tool calls cutoff by max_tokens" as `modelo` (the reasoning ate the cap, RN-059); any other LLM error stays `infra`.
- **Where:** `apps/engine/lib/engine/gates/origem_do_erro.ex:10` (`de_llm`)
- **Test:** `apps/engine/test/engine/gates/origem_do_erro_test.exs:7`
- **Origin:** AT-586 (BaseTen 502 recorded as `infra`)

### RN-898 — A response cut by the cap with no text closes the turn, stated {#rn-898}

- **Rule:** a conversational agent turn whose last LLM response was cut by the output cap ([RN-737](api.md#rn-737)) and wrote no text in any round does NOT close silently: the line "Response cut off by the length limit." becomes the closing `agent.response` with `modelName`, and the bubble shows "Continue where it left off" ([RN-749](web.md#rn-749)). It covers the seven conversational agents.
- **Where:** `apps/engine/lib/engine/agents/texto_do_turno.ex:65` (`payload_do_turno`)
- **Test:** `apps/engine/test/engine/harness/resposta_cortada_test.exs:104`
- **Origin:** AT-570 (TP-01 18th)

### RN-899 — An empty response without a cut becomes an agent.error of origin model {#rn-899}

- **Rule:** a conversational loop closing with no text, no tool and no cut records `agent.error` with origin `modelo` and "the model returned no response" (`FalhaDeTurno`), in the seven servers. It is an agent utterance for the heartbeat ([RN-581](api.md#rn-581)); per-tab project presence does NOT enter ([RN-064](web.md#rn-064)).
- **Where:** `apps/engine/lib/engine/agents/falha_de_turno.ex:63` (`origem`), `apps/engine/lib/engine/agents/po_server.ex:303` (`gravar_texto_do_turno`)
- **Test:** `apps/engine/test/engine/agents/po_server_test.exs:194` and `apps/engine/test/engine/agents/texto_do_turno_test.exs:96`
- **Origin:** AT-572 (TP-01 18th, finding 4)

### RN-900 — `write_file` refuses to rewrite the README and drop the Infra's usage section {#rn-900}

- **Rule:** `write_file` replaces the whole file. When the `path` is a README
  (`README*`), the current file has the `## Rodar na sua máquina` section and
  the new content does not, the tool refuses with a named error and writes
  nothing. Changing a fragment requires rewriting the full README, keeping the
  section. The title is one constant (`titulo_secao_de_uso/0`), also used by the
  Infra and dev prompts, so the refusal and the instruction do not diverge. It
  is not a gate: the refusal belongs to the tool itself and does not cover
  writes by `terminal` (`cat >`, `sed -i`).
- **Where:** `apps/engine/lib/engine/harness/tools/write_file.ex:62`
  (`recusa_de_secao_perdida`)
- **Test:** `apps/engine/test/engine/harness/tools/write_file_test.exs:41`
  (a rewrite without the section is refused and the file stays intact); the
  happy path is covered by the first two tests in the same file
- **Origin:** AT-571 (TP-01 18th run of 10/19: the dev agent rewrote the README
  while fixing a QA finding and the usage section the Infra had written was
  lost; no gate noticed)

### RN-903 — The provider's 429 is the model's usage limit, not a network failure {#rn-903}

- **Rule:** a task the dev agent blocks because the model answered 429 (code
  `rate_limit`, or text with `(429)` or "limite de uso") says in the reason
  "limite de uso do modelo atingido (429)", and the automatic retry says that,
  if it repeats, the dev agent's model should be changed. It never says "falha
  passageira de rede" (transient network failure). The origin stays `infra`
  and the RN-864 retry does not change (up to 3, after 1, 3 and 10 min; a 60 s
  pause, which `dev.idle` names as "depois de limite de uso do modelo"). A
  network failure keeps its usual text.
- **Where:** `apps/engine/lib/engine/dev/dev_agent_server.ex:1136`
  (`limite_de_uso?`), `apps/engine/lib/engine/dev/dev_agent_server.ex:1127`
  (`motivo_da_parada`), `apps/engine/lib/engine/dev/dev_agent_server.ex:997`
  (`bloquear_passageira`), `apps/engine/lib/engine/dev/agent_io.ex:293`
  (`pausar_por_rede`)
- **Test:** `apps/engine/test/engine/dev/dev_agent_server_test.exs` ("429 do
  provider: o motivo diz limite de uso do modelo, não rede"; failure: "falha de
  rede continua com o texto de rede, não de limite")
- **Origin:** AT-594 (TP-01 20th, 10/19: the 429 of `laguna-s-2.1:free` blocked
  the tasks as "falha passageira de rede", while the diagnosis said usage limit)

### RN-904 — The output-ceiling cut is not repeated with the full catalog {#rn-904}

- **Rule:** when Jev restricts the menu and the model answers WITHOUT a tool,
  the step is repeated ONCE with the full catalog (RN-625) — except when the
  response was CUT by the output ceiling (`truncated`). The cut is not a menu
  error: retrying with the full catalog would only enlarge the prompt and spend
  another output ceiling. It applies to both facades (`llm_turn` and
  `llm_turn_stream`, the latter only without text already delivered). The
  RN-780 retry in `ToolLoop` handles the cut and does not change.
- **Where:** `apps/engine/lib/engine/harness/roteamento_de_ferramenta.ex:126` (`repetir_com_catalogo_inteiro?`)
- **Test:** `apps/engine/test/engine/harness/roteamento_de_ferramenta_test.exs:274`
  (an empty cut response is not repeated, in both paths; without a cut it is)
- **Origin:** AT-578 (EP-026, survey of 10/21): the PO's first turn in the 18th
  round spent two 8192-token output rounds.

### RN-905 — The step ceiling says what was recorded and what is missing, and offers to continue {#rn-905}

- **Rule:** when a conversational agent stops at the step limit, the ceiling
  event (`toolloop.limit_reached`; for the Creative, the `agent.error` with
  `reason: "limite_de_iteracoes"`) carries `gravado`, the RN-731 line read
  BEFORE the turn text is written (it goes there and not in the
  `agent.response`, never in both). The PO also carries `regrasSemHistoria`, the
  `uncoveredCount` that `fechar_handoff` already reads; a failed read leaves the
  key absent, never an error. The thread shows the reason without jargon, the
  recorded line, the rules without a story and the "Continue where you left
  off" button (RN-749, a user message that the RN-673 queue absorbs while a turn
  runs) only for the seven conversational agents with the session active;
  `dev-*`/`qa-*` get the text, with no button. The button never continues on its
  own.
- **Where:** `apps/engine/lib/engine/agents/po_server.ex:257` (`run_turn`);
  `apps/web/src/routes/session-timeline-montagem.tsx:976` (`conversacional`)
- **Test:** `apps/engine/test/engine/agents/po_server_test.exs:548` (gravado and
  regrasSemHistoria; without the read, no key);
  `apps/web/src/routes/session-timeline-montagem.falha-de-turno.test.tsx:108`
  (bubble, button to the same agent; no button for `dev-*` and inactive session)
- **Origin:** AT-590 (EP-031).

### RN-908 — The PO kickoff asks for the backlog in batches, after reading, by layer {#rn-908}

- **Rule:** the PO kickoff tells the model, in this order: read `listar_regras_de_negocio` and `listar_backlog` in the same response, with no write alongside; then all epics in one response; then all stories, using the `epic_id` returned; then all tasks, using the `story_id` returned. Never recreate an epic that already exists, and at most about 10 tool calls per response. Measured reason: without the batch request, nemotron makes 1 tool per response and qwen makes 3; with it, 9 each (`parallel_tool_calls` changed nothing). Reading first is what stops qwen from creating epics without reading the backlog. It does not change the `@max_iterations` ceiling (RN-166).
- **Where:** `apps/engine/lib/engine/agents/po_server.ex:614` (`build_kickoff`)
- **Test:** `apps/engine/test/engine/agents/po_server_test.exs:518` (read before write; batch by layer: epics → stories → tasks)
- **Origin:** probe of AT-591 (21/10), implemented in AT-596 (EP-026).

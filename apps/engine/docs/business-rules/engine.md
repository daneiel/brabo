---
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

## Psicólogo e Anamnese

### RN-023 — A causa de término é classificação determinística {#rn-023}

Vem do **motivo** registrado, nunca de julgamento do LLM e nunca por
eliminação. Toda falha registra a origem: `infra | modelo | código | política`.

- **Onde:** `apps/engine/lib/engine/psychologist/termination_classifier.ex`
- **Origem:** [ADR 0022](../adr/0022-fechamento-4b-psicologo.md) §5 e
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

### RN-047 — Circuit breaker do dev agent: N bloqueios consecutivos o param, sem queimar orçamento em laço {#rn-047}

Cada dev agent mantém um contador (`dev_agent_states.consecutive_blocked`)
de quantas tarefas TERMINARAM `blocked` em sequência — localmente (no
ToolLoop) ou remotamente (o teto de correções do gate esgotado). Ao atingir o
teto por projeto (`max_consecutive_blocked`, default 3), o agente para em
`idle_tripped` **sem tentar pegar a próxima tarefa**. Um desfecho terminal
aprovado zera o contador; uma tarefa bloqueada isolada segue o fluxo normal
(devolvida com diagnóstico, disponível para um humano desbloquear) — o
breaker trata da SEQUÊNCIA, não da tarefa.

A única saída de `idle_tripped` é um rearme explícito
(`POST .../agents/:agentId/rearm`, papel `developer`): ele zera o contador e
o agente volta a tentar pegar tarefa. Não há destravamento automático — o
mesmo princípio do `MarkTaskBlockedUseCase`/`unblock`, aplicado à sequência
em vez da tarefa. Rearmar um agente que **não** está travado é **409**, não
sucesso silencioso: o evento `dev.rearmed` é imutável, e registrá-lo para um
rearme que não aconteceu seria uma mentira no event log.

Um bloqueio que vem de FORA do agente (o `QaLeadServer` falhando
internamente, por exemplo) também precisa acordá-lo — é por isso que a
emissão de `task.gate_resolved` mora no `MarkTaskBlockedUseCase`, o funil por
onde todo bloqueio passa, e não no `RecordGateVerdictUseCase`, que só vê
parte deles. Sem isso o agente ficaria em `awaiting_gate` para sempre, com a
tarefa morta e o contador do breaker nunca incrementando.

Reiniciar o engine com um agente em `working` **não** conta para o contador:
a tarefa retida é bloqueada com um diagnóstico de reinício, mas esse
bloqueio não é o agente "queimando o teto" — é a infraestrutura caindo. O
contador só sobe quando o próprio ciclo dev↔gate produz um `blocked` real.

- **Onde:** `apps/engine/lib/engine/dev/dev_agent_server.ex` (`finish_task/2`,
  `resume_state/2`), `apps/api/src/application/use-cases/execution/rearm-dev-agent.use-case.ts`,
  `apps/api/src/db/schema/iam.ts` (`projects.max_consecutive_blocked`)
- **Teste:** `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  (describe `circuit breaker`), `apps/engine/test/engine/dev/dev_rehydrator_test.exs`
  (describe `the four rehydrated states`), `test/application/use-cases/execution/rearm-dev-agent.use-case.spec.ts`
- **Origem:** [ADR 0045](../adr/0045-reagendamento-por-evento-do-dev-agent.md)

### RN-050 — Sem PR aberta, nenhum gate abre {#rn-050}

O dev agent propõe commit, push e PR e **lê o desfecho de cada um**. Ele só
abre o gate se os três executaram. Se um ficou `pending` — a autonomia do
agente em `require_approval` — ele entra em `awaiting_approval`, **segurando o
worktree**, e não abre gate nenhum.

Sem isso o gate abria de qualquer jeito, e o dano era silencioso: o QA varre
o **worktree**, não a PR; achou os arquivos, aprovou; o SecOps aprovou; a
tarefa fechou como concluída — **sem uma linha commitada e sem PR nenhuma**.
Só depois, ao aprovar o commit, o usuário veria a ação falhar (com
diagnóstico vazio, porque `System.cmd` num diretório apagado devolve
`{"", 2}`).

O que libera o agente é `task.pr_settled`, emitido pela api quando `pr_open`
chega a um desfecho terminal: `opened: true` abre o gate; `opened: false`
(negada ou falha) devolve a tarefa com diagnóstico, em vez de deixar o
agente esperando para sempre por um gate que ninguém vai abrir.

Uma PR negada **não conta para o circuit breaker** da [RN-047](#rn-047): a
decisão foi do usuário, não do agente queimando o teto — o mesmo princípio
da recuperação de reinício.

Essa regra também elimina o D5 (worktree reciclado sob aprovação pendente)
como consequência: o worktree só é liberado em `gate_resolved`, o gate só
abre depois da PR, e a PR só abre depois do commit e do push.

- **Onde:** `apps/engine/lib/engine/dev/agent_io.ex` (`propose/3`),
  `apps/engine/lib/engine/dev/dev_agent_server.ex` (`abrir_gate/1`,
  `aguardar_aprovacao/2`),
  `apps/api/src/application/use-cases/actions/execute-git-action.use-case.ts`
  (`settlePrOpen`)
- **Teste:** `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  (describe `pending approval doesn't open a gate`)
- **Origem:** [ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md)

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

### RN-061 — Uma falha de FERRAMENTA também é um evento, e volta para o modelo {#rn-061}

O resultado de uma chamada de ferramenta nunca é descartado. Ele vira
`tool.result` no event log (`ok` e, quando falha, `erro`), o agente **diz** o
que aconteceu no fio, e o motivo **volta para o modelo** no papel `tool` —
para ele corrigir e reemitir no turno seguinte. Um erro de ferramenta é
entrada do laço, não fim de linha.

O agente Criativo era o único que o descartava
(`_ = EmitArtifact.run(args, state)`) — o PO e o Arquiteto já o realimentavam.
Numa execução real o modelo emitiu `titulo`/`descricao` contra um schema que
exige `title`/`description`/`origin`: as **quatro regras de negócio da
conversa foram recusadas**, nenhum evento foi gravado, e ele continuava
dizendo "registrei as regras" com o painel vazio.

A descrição da ferramenta agora NOMEIA os campos obrigatórios de cada tipo,
em inglês e com um exemplo preenchido — inclusive que `business_rule.origin`
é uma **lista não vazia** de `seq` das mensagens que originaram a regra, não
texto livre. Sem isso o modelo adivinha, e adivinha no idioma da conversa.

É a mesma regra da [RN-059](#rn-059) aplicada ao outro caminho de falha: duas
políticas para o mesmo problema seriam duas chances de engolir o erro.

- **Onde:** `apps/engine/lib/engine/agents/criativo_server.ex` (`dispatch_tool`,
  `realimentar`), `apps/engine/lib/engine/harness/tools/emit_artifact.ex`
  (`descricao/0`), `apps/engine/lib/engine/harness/artifact_schemas.ex`
  (`required/1`)
- **Teste:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  (`a refused tool becomes a tool.result with an error, and the agent speaks`)
- **Origem:** execução real da FASE 13b

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

### RN-069 — Repetir uma tarefa recria a branch, não falha {#rn-069}

`WorktreeManager.add_worktree/3` usa `git worktree add -B` (cria **ou**
reseta), não `-b`. Ele já removia o diretório do worktree anterior, mas
deixava a branch para trás — e como o nome dela vem do slug da tarefa, a
segunda tentativa na MESMA tarefa sempre caía em `fatal: a branch named
'feature/<slug>' already exists`.

O efeito era permanente: desbloquear a tarefa não ajudava, reativar a
execução não ajudava, e o circuit breaker desarmava sem saída. Numa execução
real a única saída era um `git worktree prune` manual no workspace do
projeto.

Resetar é a escolha certa: o worktree anterior já foi removido, o trabalho
daquela tentativa não vale nada (a tarefa voltou para a fila), e a branch
renasce do ponto atual de `work_dir`.

- **Onde:** `apps/engine/lib/engine/dev/worktree_manager.ex`
- **Teste:** `apps/engine/test/engine/dev/worktree_manager_test.exs`
  (`retrying the SAME task recreates the worktree instead of failing`)
- **Origem:** execução real da FASE 13b

### RN-073 — Uma aprovação pendente SUSPENDE o laço, não o queima {#rn-073}

Quando uma ferramenta de pipeline devolve `pending`, o ToolLoop **para** e o
dev agent entra em `:awaiting_approval`, segurando a tarefa, o worktree e o
histórico do laço. A decisão do usuário emite `task.action_settled`, que o
acorda: o resultado real ocupa o lugar onde a palavra "pending" estaria, e o
laço retoma de onde parou.

Duas propriedades que o teste trava:

- **Nada é gravado durante a espera.** O espaço da mensagem da ferramenta
  fica vazio. Gravar "pending" ali diria ao modelo que foi isso que o comando
  respondeu — que era exatamente o defeito.
- **Uma recusa é uma resposta.** O motivo ocupa o lugar do resultado e o
  agente aprende que aquele caminho fechou, em vez de esperar para sempre por
  algo que ninguém vai aprovar. É o mesmo princípio de `pr_settled` com
  `opened: false` ([RN-047](#rn-047)), um nível abaixo.
- **O wake tem de CHEGAR.** `task.action_settled` nasce no agregado `task`,
  não na `proposed_action` que o nome da tabela sugere: o drain do engine lê
  uma lista fechada de agregados (`session` e `task`). Emitido fora dessa
  lista, o evento é gravado com sucesso, fica com `processed_at` nulo e nem
  chega a ser lido — sem job, sem erro, sem log, e o agente espera para
  sempre. O contrato atravessa duas linguagens, e é por isso que está fixado
  nos dois lados.

Se o engine **reiniciar** durante a espera, a regra deixa de valer para essa
tarefa: o laço suspenso só existe em memória, então ela volta para a fila
bloqueada com origem `infra`, e a decisão tomada depois não tem onde ser
aplicada. Bloquear com diagnóstico é deliberado — a alternativa era a espera
eterna e silenciosa, que é exatamente o que esta regra existe para acabar.

O que isto conserta: `pending` costumava voltar como o RESULTADO da
ferramenta e o laço seguia em frente. O modelo lia aquilo como a resposta do
comando, não aprendia nada, tentava outra coisa — e cada tentativa queimava
uma iteração até `toolloop.limit_reached {iteration: 8, max_iterations: 8}`,
com a tarefa bloqueada por "limite de iterações atingido" sem uma linha
escrita. As aprovações concedidas chegavam depois de o laço esgotado e não
serviam para nada.

A allowlist de terminal ([RN-068](api.md#rn-068)) continua valendo, mas deixa de ser
a única defesa: é uma lista de comandos previstos, e o modelo inventa
comandos.

- **Onde:** `apps/engine/lib/engine/harness/hooks/action_pipeline.ex`,
  `harness/tool_loop.ex`, `dev/dev_agent_server.ex`,
  `workers/dev_agent_wake_worker.ex`; emissão em
  `apps/api/src/application/use-cases/actions/{approve,deny}-action.use-case.ts`
- **Teste:** `apps/engine/test/engine/dev/dev_agent_awaiting_approval_test.exs`
  (`pending action STOPS the agent`; `approved: resumes the loop with
  the REAL output`; `restart during the wait BLOCKS the task`) e
  `apps/engine/test/engine/dev/wake_do_outbox_ao_agente_test.exs`, que
  percorre a cadeia inteira — outbox, drain, fila e processo — porque os
  testes por elo estavam todos verdes com a entrega quebrada; o agregado
  está fixado no lado da api em
  `apps/api/test/application/use-cases/actions/approve-deny-action.use-case.spec.ts`
- **Origem:** [ADR 0052](../adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md),
  fase A da triagem

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

### RN-115 — A Anamnese pode ser pausada globalmente; a pausa é do PRODUTO, nunca apaga dado {#rn-115}

`ANAMNESE_ENABLED` (env var do engine, boolean, default `false` a partir
desta regra) decide se uma rodada NOVA da Anamnese pode acontecer — periódica
(`AnamneseSchedulerWorker`) ou sob demanda (`AnamneseCommandController`).
Decisão de PRODUTO do usuário em 2026-08-10 ("hoje ele não está trazendo
dados de muito valor"), não bug — ver docs/explanation/backlog.md. Desativada,
NENHUM dado existente é tocado: hipóteses, perfis de proficiência e patches
de instrução já gravados continuam intactos e visíveis, e o opt-out POR
MEMBRO (RN-025) continua um conceito separado — a pausa é do SISTEMA, não do
perfilamento individual.

`AnamneseSchedulerWorker.kickoff/0` (chamado uma vez no boot) NÃO agenda o
job periódico quando desativado, em vez de agendar e deixar `perform/1`
no-opar a cada tick — mais barato (a fila do Oban não recebe um job a cada
`ANAMNESE_INTERVAL_SECONDS` só para não fazer nada) e mais claro para quem
inspeciona a fila. **Correção em 2026-08-10** (achado real em execução, não
hipótese): a versão original desta regra deixava `perform/1` incondicional
de propósito, para a corrente entre rodadas não carregar a decisão de
ligar/desligar consigo — mas isso significava que uma corrente já agendada
ANTES de a flag existir (ou de alguém desativá-la) continuava se
reagendando pra sempre, rodando Anamnese de verdade com a flag dizendo
`false`. Foi exatamente o que aconteceu num Postgres de dev mais antigo que
o PR original, remediado manualmente cancelando os jobs agendados.
`perform/1` agora confere `enabled?/0` a cada tick, igual `kickoff/0`: se
desativado, nem `enqueue_projects/0` nem o reagendamento acontecem, e a
corrente morre ali — o que também AUTO-CURA sozinho o cenário de job antigo
que ainda dispara uma vez, sem precisar de intervenção manual.

`AnamneseCommandController.run/2` (rota sob demanda, "reanalisar agora" nas
Configurações) responde **503** com corpo `{"error": "anamnese_desativada"}`
quando desativado — distinto de propósito do 409 vazio que já existia para
"projeto sem sessão" (os dois eram fáceis de confundir num 409 puro, e são
causas bem diferentes). `RunAnamneseUseCase`, do lado api, converte o 503 do
engine em `ServiceUnavailableException` com `reason: "anamnese_disabled"` no
corpo — nunca um 500 genérico nem um 409 reaproveitado. A web
(`ProjectSettingsTab.tsx`) descobre o estado no primeiro clique de "Rodar
agora" (não há hoje uma leitura prévia do estado global) e, a partir daí,
desabilita o botão e mantém a explicação VISÍVEL na tela — não só um toast
que some (RN-088: nunca falha silenciosa ou confusa).

- **Onde:** `apps/engine/lib/engine/workers/anamnese_scheduler_worker.ex`
  (`enabled?/0`, `kickoff/0`),
  `apps/engine/lib/engine_web/controllers/anamnese_command_controller.ex`,
  `apps/engine/config/runtime.exs`,
  `apps/api/src/domain/anamnese/anamnese-disabled.error.ts`,
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`
  (`runAnamnese`), `apps/api/src/application/use-cases/anamnese/run-anamnese.use-case.ts`,
  `apps/web/src/routes/settings/ProficiencySection.tsx`
- **Teste:**
  `apps/engine/test/engine/workers/anamnese_scheduler_worker_test.exs`
  (`kickoff/0` não agenda desativado, agenda ativado, default desligado;
  `perform/1` desativado no meio da corrente não faz fan-out nem reagenda),
  `apps/engine/test/engine_web/controllers/anamnese_command_controller_test.exs`
  (503 distinto de 409, com e sem sessão),
  `apps/api/test/application/use-cases/anamnese/run-anamnese.use-case.spec.ts`,
  `apps/web/src/routes/ProjectSettingsTab.test.tsx` (`ProficiencySection`)
- **Borda:** a flag é GLOBAL (todos os projetos/workspaces), não por projeto
  — ao contrário do teto de paralelismo (RN-083) ou do modelo herdável por
  área (RN-102), que são decisões por escopo. Ligar de volta é
  `ANAMNESE_ENABLED=true` e reiniciar o engine; não há botão na UI para isso
  (é operacional, não uma preferência de projeto).
- **Origem:** sem ADR — decisão de produto reversível, não mudança estrutural
  de arquitetura. Ver docs/explanation/backlog.md.

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

### RN-117 — O Psicólogo pode ser pausado globalmente; a pausa é do PRODUTO, nunca apaga dado {#rn-117}

`PSYCHOLOGIST_ENABLED` (env var do engine, boolean, default `false`) decide
se uma rodada NOVA do Psicólogo pode acontecer — automática (fechamento de
sessão, roteado pelo `Engine.Outbox.Drain`) ou sob demanda
(`PsychologistCommandController.reanalyze/2`). Mesma decisão de PRODUTO do
usuário em 2026-08-10 já aplicada à Anamnese (RN-115, "hoje ele não está
trazendo dados de muito valor") — não bug, ver docs/explanation/backlog.md.
Desativado, NENHUM dado existente é tocado: análises e hipóteses já
emitidas continuam intactas e visíveis.

Diferente da Anamnese (cujo gatilho automático é um TICK periódico que a
própria flag decide se reagenda), o gatilho automático do Psicólogo é o
fechamento de sessão — o `Engine.Outbox.Drain` roteia
`session.closed`/`session.closed_abnormally` pra `PsychologistWorker` só
quando `PsychologistWorker.enabled?/0` é true (`Drain.handlers_for/1`);
desativado, só `SessionLifecycleWorker` roda, e o job do Psicólogo nem
nasce. `PsychologistWorker.perform/1` continua incondicional de propósito —
mas NÃO é mais "o mesmo padrão" do `AnamneseSchedulerWorker` (ver a correção
de 2026-08-10 na RN-115 acima): lá `perform/1` passou a conferir a flag
porque ele PRÓPRIO reagenda a corrente a cada tick, e um job antigo
disparando incondicionalmente reabria a Anamnese com a flag desligada. O
Psicólogo não tem corrente nenhuma que se reagende sozinha — cada job nasce
de UM evento (`session.closed`), e quem decide é o `Drain` no momento em que
RECEBE o evento, não o worker no momento em que RODA; um job de Psicólogo
já enfileirado antes de desligar a flag é, no máximo, a última rodada
pendente, nunca uma corrente infinita. Por isso a suite pré-existente de
`PsychologistWorker` (que chama `perform/1` direto) não precisou mudar.

`PsychologistCommandController.reanalyze/2` (rota sob demanda,
"Reanalisar" na aba Insights) responde **503** com corpo
`{"error": "psicologo_desativado"}` quando desativado, sem sequer criar o
job. `ReanalyzeSessionUseCase`, do lado api, converte o 503 do engine em
`ServiceUnavailableException` com `reason: "psychologist_disabled"` no
corpo — nunca um 500 genérico. Isto descobre a pausa quando já existe uma
análise para reprocessar; a tela SEM hipótese nenhuma tem uma leitura
prévia própria, que não existia aqui — ver [RN-454](#rn-454).

- **Onde:** `apps/engine/lib/engine/workers/psychologist_worker.ex`
  (`enabled?/0`), `apps/engine/lib/engine/outbox/drain.ex`
  (`handlers_for/1`),
  `apps/engine/lib/engine_web/controllers/psychologist_command_controller.ex`,
  `apps/engine/config/runtime.exs`,
  `apps/api/src/domain/psychologist/psychologist-disabled.error.ts`,
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`
  (`reanalyzeSession`),
  `apps/api/src/application/use-cases/execution/reanalyze-session.use-case.ts`,
  `apps/web/src/routes/ProjectInsightsTab.tsx`
- **Teste:**
  `apps/engine/test/engine/outbox/drain_test.exs` (`session.closed` só
  enfileira o Psicólogo quando ativado),
  `apps/engine/test/engine_web/controllers/psychologist_command_controller_test.exs`
  (503 sem criar job, 202 com job enfileirado quando ativado),
  `apps/api/test/application/use-cases/execution/reanalyze-session.use-case.spec.ts`,
  `apps/web/src/routes/ProjectInsightsTab.test.tsx`
- **Borda:** a flag é GLOBAL (todos os projetos/workspaces), como a da
  Anamnese. Ligar de volta é `PSYCHOLOGIST_ENABLED=true` e reiniciar o
  engine; não há botão na UI para isso.
- **Origem:** sem ADR — decisão de produto reversível, não mudança estrutural
  de arquitetura. Ver docs/explanation/backlog.md.

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
  (the four turn `handle_call`/`handle_cast`), `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:373`
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

### RN-129 — O ToolLoop nunca grava `agent.response` vazio; falha de transporte vira `agent.error` durável {#rn-129}

A [RN-059](#rn-059) fechou o balão vazio para os quatro agentes
conversacionais, mas eles não passam pelo `Engine.Harness.ToolLoop` — cada um
chama `EngineApiClient.llm_turn_stream/6` no próprio módulo. O `ToolLoop`
(usado por dev agents, QA Automação/Performance-Segurança, Infra-Workflows,
Anamnese e Psicólogo) tinha o MESMO defeito num caminho diferente: emitia
`agent.response` a cada iteração, mesmo quando o modelo só chamou ferramenta
sem texto, ou terminou o turno sem produzir nada — e a falha de transporte
(provider fora do ar, timeout) virava `agent.response` com `content` ausente,
igualmente indistinguível de sucesso.

Achado ao vivo numa sessão de execução real (dev agents): duas bolhas com o
texto de compatibilidade da RN-059 ("resposta vazia — evento anterior...")
apareceram numa sessão criada minutos antes — não eram eventos antigos, eram
o mesmo defeito acontecendo de novo, só que na aba de execução.

Duas correções, no ponto ESTRUTURAL comum a todo consumidor do `ToolLoop`,
não módulo por módulo:

1. **Conteúdo vazio nunca vira `agent.response`.** Iteração que só chamou
   ferramenta já está narrada por `tool.call`/`tool.result`; iteração que não
   produziu nada (nem texto, nem tool call) deixa o desfecho para quem chamou
   o loop decidir — `ctx.last_error`/`{:ok, ctx}` carregam a informação, e
   quem consome (ex.: `DevAgentServer.handle_outcome/4`) já grava o evento
   durável do PRÓPRIO domínio (`dev.blocked`, com `origem`).
2. **Falha de transporte vira `agent.error` durável**, com `origem`
   (`Engine.Agents.FalhaDeTurno.origem/1` — o MESMO helper que os quatro
   agentes conversacionais usam, sem duplicar classificação) e `mensagem` em
   português — nunca mais `agent.response` sem `content`.

- **Onde:** `apps/engine/lib/engine/harness/tool_loop.ex` (`loop/1`,
  `emit_falha/2`)
- **Teste:** `apps/engine/test/engine/harness/tool_loop_test.exs`
  ("iteração só com tool call (sem texto) não grava agent.response vazio",
  "modelo termina o turno sem texto e sem tool call...", "falha de
  transporte... grava agent.error durável com origem")
- **Origem:** RN-059 (regra que esta estende) — achado ao vivo numa sessão de
  execução real com dev agents

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

### RN-141 — O conteúdo lido por `read_file` também tem teto de bytes {#rn-141}

A [RN-074](#rn-074) travou a saída do **terminal** contra
`{413, "request entity too large"}`, mas deixou aberta a mesma porta pelo
`read_file`: ele lia o arquivo INTEIRO, sem teto, e esse conteúdo entrava no
histórico do laço e viajava em todo turno seguinte. Um PR com arquivo grande
(lockfile, bundle, arquivo gerado) bastava pra travar dev agents E o QA de
Performance/Segurança — que só tem `ReadFile`/`SearchWorkspace` (sem
`Terminal`, de propósito) pra investigar uma PR, então não tinha rota de
escape nenhuma quando o arquivo era grande demais.

O conteúdo é cortado em `READ_FILE_MAX_BYTES` (default 32 KiB, mesmo valor da
RN-074 por coincidência de contexto, não por acoplamento — as duas variáveis
são independentes) antes de virar resultado da ferramenta, com marca dizendo
o arquivo e os dois tamanhos:

```
[arquivo package-lock.json truncado: mostrando 32768 de 1048576 bytes. Use
search_workspace para localizar um trecho específico em vez de reler o
arquivo inteiro.]
```

Mesmas três propriedades da RN-074 (teto é `>` não `>=`; corte não parte
caractere multibyte; a marca é endereçada ao modelo, dizendo o que fazer). A
truncagem mora na FERRAMENTA (`Engine.Harness.Tools.ReadFile`), não em
`Engine.Harness.WorkspaceFiles.read_file/2` — essa é a base genérica de
acesso a arquivo, compartilhada por `write_file`/`search_workspace`, e
truncar ali cortaria conteúdo de quem não precisa desse teto.

`search_workspace` não teve o mesmo tratamento: ele devolve só os PATHS que
bateram (`matched_content` é booleano), nunca o conteúdo do arquivo — o vetor
de estouro que motivou esta RN não se aplica a ele.

- **Onde:** `apps/engine/lib/engine/harness/tools/read_file.ex`
  (`truncate/2`), teto em `apps/engine/config/runtime.exs`
  (`read_file_max_bytes`)
- **Teste:** `apps/engine/test/engine/harness/tools/read_file_test.exs`
  (describe `teto de bytes do conteúdo`)
- **Origem:** achado ao vivo no event log de uma execução real — os 4 dev
  agents de um projeto e os QA de Automação/Performance-Segurança bloqueados
  com `{413, "request entity too large"}`, mesma causa raiz da RN-074, porta
  diferente

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

### RN-150 — `search_workspace` tem teto de QUANTIDADE de hits e de BYTES, cada um com sua marca {#rn-150}

Achado numa revisão de PR: `search_workspace` (dev agents e os dois agentes
de QA/gate, `qa_tools.ex` e `qa_performance_seguranca_agent.ex` — este
último só tem `read_file`/`search_workspace`, sem `Terminal`, de propósito)
devolvia TODOS os resultados da busca, sem teto nenhum — mesma classe do
achado S (`Engine.Actions.TerminalExecutor.truncate/2`) e da correção de
`read_file` (`Engine.Harness.Tools.ReadFile.truncate/2`): o resultado fica
no histórico do laço e viaja em todo turno seguinte, e uma árvore grande
basta pra estourar `{413, "request entity too large"}` do provider.

Dois tetos independentes, porque a busca estoura de duas formas diferentes:

1. **Quantidade de hits** — uma árvore com milhares de arquivos batendo o
   termo produz milhares de linhas `- caminho` mesmo que nenhum arquivo
   individual seja grande. Truncar só por BYTES no fim ainda pagaria o custo
   de escanear e ler o conteúdo de cada um desses arquivos antes de montar a
   string. Por isso o teto de quantidade (`SEARCH_WORKSPACE_MAX_HITS`,
   default 500) vive em `WorkspaceFiles.search/3`, que já PARA de consumir a
   busca assim que encontra hit suficiente — o pipeline roda sobre um
   `Stream`, e `Enum.take(stream, max_hits + 1)` só lê da fonte o que
   precisa pra produzir os `max_hits + 1` primeiros resultados. O "+1" é o
   que permite dizer que HAVIA mais sem continuar escaneando o resto pra
   contar o total exato — contar o total pagaria de novo o I/O que o teto
   existe pra evitar, então a marca diz "mostrando os N primeiros" e nunca
   inventa um total.
2. **Bytes do texto final** — mesmo com hits limitados, caminhos muito
   longos podem produzir uma string grande. Teto de bytes
   (`SEARCH_WORKSPACE_MAX_BYTES`, default 32.768), mesmo padrão de
   `terminal_output_max_bytes`/`read_file_max_bytes` — variável PRÓPRIA,
   não reaproveita as outras duas: mesma classe de estouro, divergir uma não
   deve exigir tocar as outras.

A marca de truncagem é dirigida ao MODELO, não ao humano: diz o que foi
cortado (hits e/ou bytes) e instrui a refinar o termo da busca — mesmo
espírito das marcas de `TerminalExecutor`/`ReadFile`.

- **Onde:** `apps/engine/lib/engine/harness/workspace_files.ex`
  (`search/3`, `take_capped/2`),
  `apps/engine/lib/engine/harness/tools/search_workspace.ex`
  (`truncate/3`, `marca_de_truncagem/5`),
  `apps/engine/config/runtime.exs` (`search_workspace_max_hits`,
  `search_workspace_max_bytes`)
- **Teste:** `apps/engine/test/engine/harness/workspace_files_test.exs`
  (`search/3` com `max_hits` corta a QUANTIDADE e marca truncagem só
  quando há mais que o teto),
  `apps/engine/test/engine/harness/search_workspace_test.exs` (busca com
  poucos resultados não é alterada; busca com mais hits que o teto é
  truncada com aviso claro; texto final maior que o teto de bytes também é
  cortado)
- **Origem:** achado de revisão de PR — segunda causa real do 413 em
  revisões, depois da correção de `read_file`

---

### RN-162 — Perguntas estruturadas do Criativo {#rn-162}

O Criativo pode, quando faz VÁRIAS perguntas na mesma resposta, emitir a
lista em formato ESTRUTURADO em vez de deixar o usuário responder item por
item em texto livre — ferramenta nova `ask_structured_questions`
(`apps/engine/lib/engine/harness/tools/ask_structured_questions.ex`,
`:direct`), registrada ao lado de `emit_artifact`. Schema:
`{ questions: [{ id, label, type?, options? }] }` — `id` único e não-vazio,
`label` não-vazio, `type` ∈ `text|textarea|select` (default `text`),
`options` obrigatório e não-vazio quando `type: select`. Grava
`chat.structured_question`.

O frontend (`StructuredQuestionCard`, `SessionPage.tsx`) renderiza um
formulário com um campo por pergunta — `Input`/`Textarea`/`Select` do
design system, conforme `type`. `POST .../agents/:agent/structured-
question/:questionSetId/answer` (`AnswerStructuredQuestionUseCase`) valida
que toda pergunta tem resposta não-vazia, grava
`chat.structured_question_answered` (referenciando `questionSetId` = id do
evento da pergunta) e REUSA `SendAgentMessageUseCase` — as respostas viram
uma mensagem concatenada ("1. {label}: {resposta}\n2. ..."), como se o
usuário tivesse digitado no fio; não há canal novo de "o agente lê a
resposta estruturada". Um conjunto de perguntas só pode ser respondido
UMA vez: reenvio é recusado com 409, e o formulário nem chega a
reaparecer — o card vira somente leitura assim que existe um
`chat.structured_question_answered` posterior com o mesmo `questionSetId`.

- **Onde:** `apps/engine/lib/engine/harness/tools/ask_structured_questions.ex`,
  `apps/engine/lib/engine/agents/criativo_server.ex`,
  `apps/api/src/application/use-cases/agents/answer-structured-question.use-case.ts`,
  `apps/api/src/interfaces/http/agents/agents.controller.ts`,
  `apps/web/src/routes/SessionPage.tsx` (`StructuredQuestionCard`)
- **Teste:** `apps/engine/test/engine/harness/tools/ask_structured_questions_test.exs`,
  `apps/engine/test/engine/agents/criativo_server_test.exs`,
  `apps/api/test/application/use-cases/agents/answer-structured-question.use-case.spec.ts`,
  `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx`
- **Origem:** pedido do usuário — sem precedente de input estruturado no chat

### RN-163 — O Criativo cumpre a promessa de tentar de novo {#rn-163}

Cada turno do Criativo roda um **laço bounded de tool use**, com teto de **12**
idas ao modelo — o mesmo desenho que o PO e o Arquiteto já tinham. Antes o
modelo era chamado UMA vez por turno: o resultado da ferramenta era anexado ao
histórico em memória e ninguém mais o lia, então a frase *"vou corrigir e
tentar de novo"* — literal no código — só se cumpria se o usuário mandasse
outra mensagem. Para quem usava, o Criativo simplesmente parava de responder
depois de dizer que ia corrigir.

Quatro consequências, e cada uma é uma regra:

1. **Erro de ferramenta é entrada, não fim de linha.** O motivo volta ao modelo
   como mensagem `tool` e o laço chama o modelo de novo, que reemite corrigido
   DENTRO do mesmo turno.
2. **Nada se anuncia que o código não vá executar.** A frase de retentativa é
   decidida depois de despachar as ferramentas e sabendo quantas voltas
   sobraram: com volta disponível, o agente diz que vai corrigir; sem volta, ele
   não promete.
3. **A falha de ferramenta virou `agent.error` durável, com origem**
   ([RN-059](#rn-059)) — era `agent.response`, indistinguível no event log de
   uma resposta normal. `origem: infra` quando a api recusou o `append_event`;
   `origem: modelo` para o payload que o modelo escreveu (chave errada,
   `origin` que não é lista, regra duplicada, tipo system-emitted). O payload
   carrega `tool` e `retentativa`.
4. **Teto esgotado não termina em silêncio.** Vira `agent.error` com
   `reason: "limite_de_iteracoes"` e `origem: modelo`, a mesma leitura do
   `toolloop.limit_reached` do `ToolLoop`. O nome do evento NÃO é reusado: este
   agente não roda dentro do `ToolLoop`, e o evento mentiria sobre quem o
   produziu.

Duas fronteiras do laço, ambas deliberadas: `ask_structured_questions`
bem-sucedida **encerra** o turno (a bola está com o usuário, e as respostas
voltam num turno futuro — [RN-162](#rn-162)); e um turno que teve falha em
alguma volta fecha com um desfecho CONSOLIDADO no fio, para a última palavra
não ser o erro de uma volta que já foi corrigida depois.

- **Onde:** `apps/engine/lib/engine/agents/criativo_server.ex`
  (`run_turn_capturing/3`, `continuar/4`, `emit_falha_de_ferramenta/4`,
  `emit_falha_limite/2`)
- **Teste:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  (laço que corrige de verdade, teto esgotado narrado, origem `infra` vs
  `modelo`, pergunta estruturada que encerra o turno)
- **Origem:** uso real no projeto `exp001` — "o Criativo não respondeu depois
  de dizer que iria corrigir e tentar de novo"

### RN-164 — O PO LÊ o que já existe, escopado ao projeto {#rn-164}

O PO ganhou duas ferramentas de LEITURA — `listar_regras_de_negocio` e
`listar_backlog` (`:direct`, sem parâmetro nenhum) — servidas por duas rotas
internas escopadas ao **projeto**: `GET /internal/projects/:projectId/business-rules`
e `GET /internal/projects/:projectId/backlog`.

A primeira devolve todo `artifact.business_rule` das sessões do projeto com a
`description` inteira, quais histórias já citam cada regra e o
`uncoveredCount`; a segunda devolve a MESMA árvore épico → história → tarefa
da aba Backlog, pelo mesmo `ListBacklogUseCase` (três leituras por projeto,
nunca N+1). O texto que volta ao modelo põe as regras DESCOBERTAS primeiro e
os épicos ÓRFÃOS antes da árvore — é o que gera trabalho.

O que a regra corrige: até aqui o PO tinha **quatro ferramentas e todas de
escrita**. O contexto dele era montado uma vez, no kickoff, a partir dos 200
últimos eventos da **sessão** — dali em diante ele não sabia quais regras
existiam, quais já tinha coberto, nem o que já havia criado. O escopo é o
projeto e não a sessão de propósito: regra capturada numa sessão anterior é
exatamente o que a leitura por sessão escondia.

Ler **não** vira `proposed_action` (não é efeito externo), mas é CONTIDA no
sentido do ADR 0060: nenhuma das duas rotas aceita parâmetro além do id do
projeto — sem busca, sem paginação, sem filtro —, o custo por chamada é
constante, e o texto entregue ao modelo tem teto de linhas dizendo o total
real quando trunca.

- **Onde:** `apps/engine/lib/engine/harness/tools/listar_regras_de_negocio.ex`,
  `apps/engine/lib/engine/harness/tools/listar_backlog.ex`,
  `apps/engine/lib/engine/agents/po_server.ex`,
  `apps/engine/lib/engine/sessions/engine_api_client.ex`,
  `apps/api/src/application/use-cases/backlog/list-business-rules.use-case.ts`,
  `apps/api/src/interfaces/http/internal/internal-projects.controller.ts`
- **Teste:** `apps/engine/test/engine/harness/tools/listar_regras_de_negocio_test.exs`,
  `apps/engine/test/engine/harness/tools/listar_backlog_test.exs`,
  `apps/engine/test/engine/agents/po_server_test.exs`,
  `apps/api/test/application/use-cases/backlog/list-business-rules.use-case.spec.ts`
- **Origem:** uso real no projeto `exp001` — "crie ferramenta para o PO
  conseguir listar as regras de negócio"

---

### RN-165 — Épico sem história é cobrado, e o PO pergunta quando não sabe {#rn-165}

Quando o PO encerra um turno tendo criado um épico e **nenhuma história para
ele**, isso vira desfecho EXPLÍCITO: evento durável
`backlog.epic_without_story` (com `origem: "modelo"`, os ids e títulos dos
épicos e a mensagem) mais o broadcast `agent.error` — o padrão da
[RN-059](#rn-059): o log é o que sobrevive, o broadcast é o agente dizendo no
fio. A cobrança é por OCORRÊNCIA: reportada uma vez, a lista de pendências é
esvaziada, e não vira alarme que repete a cada turno.

O que conta é a criação que **deu certo**: um `create_story` recusado pela api
(`business_rule_id` inexistente, por exemplo) não quita o épico. Tratá-lo como
se quitasse seria trocar um silêncio por outro. Os épicos pendentes vivem no
state do `PoServer` e NÃO são reidratados: a cobrança é sobre a obrigação
assumida no turno, e reconstruí-la do event log reabriria épico antigo que o
usuário já resolveu de outro jeito.

Junto vieram as duas peças que faltavam para o PO ter uma saída além de parar:
`ask_structured_questions` — a MESMA ferramenta do Criativo
([RN-162](#rn-162)), só passada a advertisar no `po_server` — e a instrução de
kickoff dizendo, com todas as letras, que épico sem história trava a execução
e que **faltando informação se PERGUNTA**, nunca se para nem se inventa. A
instrução anterior não dizia uma palavra sobre o que fazer diante de uma
lacuna, e diante de uma lacuna sem instrução um modelo escolhe entre inventar
e parar.

- **Onde:** `apps/engine/lib/engine/agents/po_server.ex`
  (`anotar_obrigacao/4`, `encerrar_turno/1`, `obrigacoes/0`),
  `apps/engine/lib/engine/harness/tools/create_epic.ex` (`id_no_resultado/1`),
  `apps/web/src/lib/activity.ts`
- **Teste:** `apps/engine/test/engine/agents/po_server_test.exs`
  (describe "RN-165"), `apps/web/src/lib/activity.test.ts`
- **Origem:** uso real no projeto `exp001` — backlog sem história, logo sem
  tarefa, logo execução travada sem erro visível

---

### RN-166 — O teto de iterações do PO deixa rastro {#rn-166}

Esgotado o teto de iterações do laço de ferramentas do `PoServer` (12), o
turno emite `toolloop.limit_reached` com `{iteration, max_iterations}` —
o MESMO tipo e o mesmo payload que o `Engine.Harness.ToolLoop` já emitia
desde a Fase 3. Antes, a cláusula devolvia o state e pronto: de fora, um laço
esgotado era indistinguível de um turno que simplesmente acabou.

Reusar o identificador em vez de criar um `po.*` é deliberado: é o mesmo fato
(o laço bateu no teto), e quem lê o event log não deve precisar aprender um
segundo nome por causa de o agente conversacional ter laço próprio em vez de
usar o `ToolLoop`.

- **Onde:** `apps/engine/lib/engine/agents/po_server.ex` (`run_turn/2`,
  cláusula `remaining <= 0`)
- **Teste:** `apps/engine/test/engine/agents/po_server_test.exs`
  ("teto de iterações emite toolloop.limit_reached")
- **Origem:** investigação do travamento do `exp001` — o laço terminava em
  silêncio

---

### RN-171 — A pergunta de lista tem saída por texto livre, por default {#rn-171}

Pergunta `type: "select"` de `ask_structured_questions` (RN-162) aceita
resposta **fora da lista**. O campo é `allowOther`, e o **default é `true`**:
quem não declara nada oferece a saída. Fechar a lista exige
`allowOther: false` explícito, e só faz sentido quando ela é genuinamente
fechada ("Sim"/"Não").

O default aberto não é preferência de estilo. Uma lista fechada por
ESQUECIMENTO do modelo trava a conversa inteira e o usuário não tem como
destravá-la de fora — foi exatamente o que o uso real encontrou: o modelo
ofereceu uma opção do tipo "Escreva você mesmo" e o formulário não tinha onde
escrever, porque o schema do tool não sabia expressar "além destas, o que
você quiser". Uma lista aberta por engano, no pior caso, oferece um campo a
mais. Os dois erros não custam a mesma coisa. Pelo mesmo motivo a descrição
do tool **proíbe** criar uma opção "Outro" dentro de `options`: o formulário
já a oferece sozinha, e duas escapatórias na mesma lista confundem.

`allowOther` só existe em `select` — em `text`/`textarea` o campo já é texto
livre, e o engine normaliza esses dois para `false` em vez de gravar estado
sem significado no event log. Na tela, escolher "Outra (escrever)" troca o
`Select` por um `Input`: o sentinela de interface (`__outra__`) **nunca**
viaja para o backend, e o que vai é o TEXTO digitado. O botão de envio
continua exigindo TODAS as perguntas preenchidas — `AnswerStructuredQuestion
UseCase` recusa com 400 listando o que falta, então habilitar com campo vazio
só produziria um erro do servidor —, e estar em "Outra" com o texto ainda em
branco NÃO conta como preenchido.

O card também deixou de ser o único item do fio alinhado a nada: ele passa a
ser centralizado com o mesmo teto de 560px do `ApprovalCard` na variante
`chat` ([RN-173](web.md#rn-173)) e ganha o avatar e a cor do agente, que é o que o
faz ler como FALA de alguém em vez de formulário órfão. Antes ele nascia
encostado à esquerda com teto de 480px, enquanto as bolhas começam 45px
adentro.

- **Onde:** `apps/engine/lib/engine/harness/tools/ask_structured_questions.ex`
  (schema, validação e `normalizar/1`), `apps/web/src/lib/api-types.ts`
  (`StructuredQuestion.allowOther`), `apps/web/src/routes/SessionPage.tsx`
  (`StructuredQuestionCard`, `OUTRA_RESPOSTA`, `permiteOutra`),
  `apps/web/src/routes/SessionPage.module.css` (`.structuredQuestionCard`,
  `.structuredQuestionCabecalho`)
- **Teste:** `apps/engine/test/engine/harness/tools/ask_structured_questions_test.exs`
  (default aberto, `false` explícito, `allowOther` não booleano recusado),
  `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx`
  (describe "saída por texto livre no select")
- **Origem:** uso real no `exp001` — "sempre dê a opção de input do usuário
  quando ele seleciona Escreva"

### RN-175 — Toda resposta de agente diz com qual modelo foi gerada {#rn-175}

`agent.response` carrega `modelName` nos **três** produtores do evento, e não
só nos quatro agentes conversacionais:

| produtor | quem passa por ali | antes |
|---|---|---|
| os quatro conversacionais (`criativo`/`po`/`arquiteto`/`dev_lead`) | chat | já gravava, desde a [RN-146](api.md#rn-146) |
| `Engine.Harness.ToolLoop` | TODO agente de execução e de gate — `dev-*`, QA, SecOps, Infra-Workflows, Psicólogo, Anamnese | **nunca gravou** |
| `SendChatMessageUseCase` (api) | chat sem agente ativo, em que quem responde é o modelo | **nunca gravou** |

Nenhuma chamada nova: `RunLlmTurnUseCase` já devolve `modelName` no corpo e
`StreamLlmTurnUseCase` já o põe no frame `final` — o valor é o nome do modelo
do **binding resolvido** (`model.name`), não o eco do provider. Ele é `null`
quando o turno falhou antes de resolver o binding, e ausente em evento gravado
antes desta regra.

Na tela, o modelo deixou de ser a palavra solta `modelo` em mono 10px
`--text-muted` ao lado do nome do agente — que se lê como se o modelo se
CHAMASSE "modelo", e que reprova o contraste de texto de leitura. Virou um
**chip** com o ícone de modelo, `--text-secondary` sobre `--surface-2`, e o
rótulo de desconhecido passou a ser "modelo não registrado". A tela **não**
adivinha o modelo pelo binding ATUAL do agente quando o dado falta: atribuir a
uma resposta antiga um modelo que talvez nem existisse quando ela foi gerada
seria inventar procedência, e procedência inventada é pior que ausente — o
mesmo argumento do preço congelado em `token_usage` ([RN-044](api.md#rn-044)).

Fora do escopo, declarado: `agent.error` continua sem o modelo nos quatro
servidores, mesmo quando a api o mandou no frame de erro (budget estourado, por
exemplo). É mudança de outro evento, com outra pergunta a responder.

- **Onde:** `apps/engine/lib/engine/harness/tool_loop.ex`,
  `apps/api/src/application/use-cases/llm/send-chat-message.use-case.ts`,
  `apps/web/src/routes/SessionPage.tsx` (o chip em `agent.response`),
  `apps/web/src/routes/SessionPage.module.css` (`.messageModelo`)
- **Teste:** `apps/engine/test/engine/harness/tool_loop_test.exs`,
  `apps/api/test/application/use-cases/llm/send-chat-message.use-case.spec.ts`,
  `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`,
  `apps/web/src/design-contraste.test.ts` (o par do chip)
- **Origem:** uso real no `exp001` — "PO não mostrou o modelo que estava
  utilizando; todos os agentes devem apresentar o seu modelo ao lado do nome"

## Auditoria fluxo.yml × código — o plano do Dev Lead vira aprovação de verdade (RN-284, ADR 0086)

Não é fase planejada: é a correção de uma divergência que a auditoria de
`packages/contracts/fluxo.yml` × código encontrou (`docs/explanation/auditoria-fluxo-vs-codigo.md`,
achado A2) — o fluxo já declarava a saída `plano-de-paralelismo` do `dev-lead`
como `via: proposed_action`, e o código nunca foi ajustado para bater.

### RN-284 — O turno do agente conversacional pode SUSPENDER esperando aprovação humana {#rn-284}

> **Revisada pela [RN-677](api.md#rn-677) (ADR 0194):** `propose_execution_plan`
> ganhou pipeline de execução — aprovar o plano grava o módulo das tarefas
> ([RN-678](api.md#rn-678)) e ATIVA a execução; a ação termina `executed` ou
> `failed`, e é esse desfecho que o Dev Lead lê ao retomar. O item 1 abaixo
> ("não tem execute-* pipeline") deixou de valer para este tipo.

> **Revisada pela [RN-578](#rn-578) (ADR 0163):** o turno de TODO
> conversacional deixou de segurar o `GenServer.call` — o `from` é respondido
> no aceite, e a suspensão aqui descrita mudou só o FECHO do turno
> (`awaiting_approval` em vez de `agent.done`), não mais o momento da resposta.
> A `user_message` recusada durante a suspensão passa a ser 409 no clique.

Primeira vez que um agente conversacional (Criativo, PO, Arquiteto, Dev Lead —
todos rodam turno síncrono via `GenServer.call` de até 180s, mediado por
`Engine.Agents.TurnoAssincrono`) suspende esperando uma decisão humana. O
padrão já existia para o dev agent ([RN-073](#rn-073), ADR 0052) e os gates de
QA/Infra (ADR 0057), mas os dois são disparados por `cast` e nunca esperavam
resposta síncrona — é exatamente esse ponto que este mecanismo resolve, e o
teto de paralelismo que fez o Dev Lead existir ([RN-083](api.md#rn-083)) é a razão
de a primeira aprovação suspensa ser a dele.

**O mecanismo, em quatro peças:**

1. `Engine.Agents.DevLeadTools.run/2`
   (`apps/engine/lib/engine/agents/dev_lead_tools.ex:81-107`) chama
   `EngineApiClient.propose_action/5` em vez de `append_event/3`, e devolve
   `{:ok, texto}` (status `executed`/`auto_approved`/`approved` — os três
   contam como sucesso, porque `propose_execution_plan` não tem execute-*
   pipeline própria e a aprovação manual fica em `"approved"` para sempre),
   `{:pending, action_id}` ou `{:error, texto}`.
2. `Engine.Agents.DevLeadServer.run_turn/2`
   (`apps/engine/lib/engine/agents/dev_lead_server.ex`, bloco de despacho de
   `tool_calls`) usa `Enum.reduce_while` para PARAR no primeiro `:pending`,
   sem processar as chamadas seguintes nem recursar — e devolve o `state` com
   a chave `:aguardando_aprovacao` setada
   (`%{action_id:, tool_call_id:, tool_name:, remaining:}`, o `remaining`
   já descontando a iteração suspensa contra o teto). A mensagem `role:
   "tool"` NÃO entra em `state.messages` nesse momento — gravar "pending" ali
   mentiria pro modelo que o comando já respondeu isso (mesmo raciocínio do
   dev agent, `Engine.Harness.Hooks.ActionPipeline`).
3. `Engine.Agents.TurnoAssincrono.tratar_resultado/2`
   (`apps/engine/lib/engine/agents/turno_assincrono.ex`) responde ao `from`
   do mesmo jeito e na mesma hora de sempre — é o que rompe o bloqueio
   síncrono no momento certo —, mas em vez de `finalizar/1` (que emite
   `agent.done` e `agent.status: idle`) chama `suspender/1`: só
   `agent.status: awaiting_approval`, sem `agent.done`, porque o turno não
   terminou. A checagem é pelo VALOR da chave (`Map.get/2`, truthy), nunca
   pela presença dela — o Dev Lead carrega `aguardando_aprovacao: nil` desde
   o `init/1`, então a chave em si está sempre presente.
4. `Engine.Sessions.LiveBroadcast.agent_status/4`
   (`apps/engine/lib/engine/sessions/live_broadcast.ex:38-39`) ampliou a
   guarda de `["working", "idle"]` para incluir `"awaiting_approval"` — sem
   isto o `agent.status` do passo 3 nem seria persistido.

**A retomada.** `Engine.Agents.DevLeadServer` assina
`Engine.Dev.Wake.subscribe(project_id, "dev-lead")` no `init/1` — o MESMO
módulo que `Engine.Gates.QaLeadServer` já reusa para os subagentes de QA,
apesar do nome ser "dev": a entrega de `{:action_settled, ...}` é por AGENTE,
roteada pelo `agentId` do payload (`apps/engine/lib/engine/workers/dev_agent_wake_worker.ex`),
não por tipo de agente. Quando a decisão chega, um `handle_info` monta a
mensagem `role: "tool"` com o resultado REAL (`texto_do_desfecho/1`, mesmo
vocabulário do dev agent e do `QaLeadServer`), zera `aguardando_aprovacao` e
retoma com `TurnoAssincrono.iniciar(state, nil, fn -> run_turn(state,
pendente.remaining) end)`.

**Enquanto suspenso, uma segunda `user_message` não inicia turno novo** — um
guard em `handle_call({:user_message, _text}, _from, %{aguardando_aprovacao:
%{}})`, testado ANTES da cláusula genérica, emite `agent.error` (origem
`politica`) explicando que há uma decisão pendente em Aprovações, sem subir
task nenhuma.

**Lacuna aceita, declarada — restart durante a espera.** Ao contrário do dev
agent (que reidrata `laco_pendente` via `handle_continue` no `init/1`, ADR
0052), o Dev Lead NÃO reidrata `aguardando_aprovacao` — é só em memória. Se o
engine reiniciar enquanto ele está suspenso, a decisão continua registrada e
visível em Aprovações (é durável na api), mas o Dev Lead não narra o desfecho
automaticamente: o processo que assinou o `Wake` morreu, e o próximo restart
sobe um Dev Lead novo, sem inscrição para aquela ação. Fechar isto exigiria o
mesmo mecanismo do ADR 0052 — fora do escopo desta mudança, que só faz o
comportamento bater com o que `packages/contracts/fluxo.yml` já declarava.

- **Onde:** `apps/engine/lib/engine/agents/dev_lead_tools.ex`,
  `dev_lead_server.ex`; `apps/engine/lib/engine/agents/turno_assincrono.ex`
  (compartilhado pelos quatro conversacionais); `apps/engine/lib/engine/sessions/live_broadcast.ex`;
  `apps/api/src/domain/actions/decide.ts` (`propose_execution_plan`)
- **Teste:** `apps/engine/test/engine/agents/dev_lead_tools_test.exs`,
  `dev_lead_server_test.exs` (describe "suspensão em aprovação"),
  `turno_assincrono_test.exs` (describe "resultado com :aguardando_aprovacao"),
  `live_broadcast_test.exs`, `wake_do_outbox_ao_dev_lead_test.exs` (a
  corrente INTEIRA — outbox → drain → worker → `Engine.Dev.Wake` → o
  processo do Dev Lead, mesmo padrão de `Engine.Dev.WakeDoOutboxAoAgenteTest`),
  `apps/api/test/domain/actions/decide.spec.ts` (describe "plano de
  execução do Dev Lead")
- **ADR:** [0086](../adr/0086-dev-lead-plano-suspende-para-aprovacao.md)
  (revisa parte do [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md);
  precedente direto: [ADR 0052](../adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md)
  e [ADR 0057](../adr/0057-o-gate-espera-a-aprovacao.md))

---

## UX Designer — o quinto agente conversacional (RN-285..287, ADR 0087)

Não é gatilho de separação disparado (`packages/contracts/fluxo.yml` sempre declarou "quando
o projeto GERENCIADO tiver interface própria a desenhar" como critério) — é
decisão consciente do dono do produto de antecipar o papel. `teste-de-
usabilidade` (exige usuário humano real) fica fora de alcance; `metricas-de-
uso` segue lacuna, porque depende do papel `analytics`, que continua
`proposto`.

### RN-285 — O UX Designer é conversacional SOLO, sem área {#rn-285}

`Engine.Agents.UxDesignerServer` (`apps/engine/lib/engine/agents/ux_designer_server.ex:40`)
espelha `Engine.Agents.ArquitetoServer`/`DevLeadServer`: GenServer por sessão,
laço bounded de tool use próprio com teto 14 (mesmo calibre de Arquiteto/Dev
Lead — agente de raciocínio, não conversação leve como Criativo/PO). Ativado
por handoff `accepted` endereçado a "ux-designer" — mecanismo GENÉRICO já
existente (`ActivateAgentUseCase`/`canActivateAgent` na api não ganharam
linha nenhuma: qualquer agente com handoff aceito já é ativável).

O kickoff (`build_kickoff/1`, `ux_designer_server.ex:222`) lê a
`artifact.product_brief` mais recente da sessão — a MESMA "necessidade de
negócio" que o Criativo produz, sem artefato novo. O sistema de design
(`design/tokens.css`, `design/COMPONENTS.md`) é DESCRITO na identidade
(`Engine.Harness.Agents`, entrada `"ux-designer"`), texto estático, porque os
agentes conversacionais não têm ferramenta de leitura de arquivo do repo — é
a única camada do prompt presente em TODO turno, não só no kickoff.

Sem área, sem subagentes: `packages/contracts/fluxo.yml` já classificava o papel como
`camada_produto`, ao lado de Criativo e PO, nenhum dos quais tem área.

### RN-286 — `propose_prototype` grava artefato sem tabela e sem caso de uso dedicado, e oferece DOIS handoffs sobre o MESMO artefato {#rn-286}

`artifact.prototipo_navegavel` segue o desenho sem tabela de
`artifact.project_image`/`artifact.c4_diagram` ([RN-149](api.md#rn-149)) — o event
log é o registro —, mas por um caminho DIFERENTE do que os dois usam.
`choose_project_image`/`create_c4_diagram` precisam de caso de uso NA API
(`DecidirImagemDoProjetoUseCase`/`CreateC4DiagramUseCase`) porque têm
conteúdo DERIVADO de outro artefato (o Container level vem do `module_map`
vigente) ou recusa de domínio compartilhada por mais de um consumidor (teto
de recursos da imagem). `propose_prototype`
(`Engine.Agents.UxDesignerTools.run/2`,
`apps/engine/lib/engine/agents/ux_designer_tools.ex:122`) não tem nenhum dos
dois motivos — é conteúdo AUTOCONTIDO que só o próprio UX Designer escreve e
só ele lê de volta —, então a validação de FORMA mora no engine
(`Engine.Harness.ArtifactSchemas`, tipo `"prototipo_navegavel"`,
`artifact_schemas.ex:49/135` — personas e jornadas não-vazias, ao menos uma
tela) e a gravação usa o caminho GENÉRICO que a api já expõe para qualquer
tipo de evento (`EngineApiClient.append_event_returning/3`), o mesmo
mecanismo do `artifact.product_brief` do Criativo. Nenhuma rota nova na api.

Depois de gravar, `gravar_e_ofertar_handoffs/2` (`ux_designer_tools.ex:149`)
oferece DOIS handoffs sobre o MESMO artefato — `create_handoff` para "po" e
para "dev-lead", os dois com o `artifactId` do protótipo. Nunca um segundo
artefato para "spec-visual" (`packages/contracts/fluxo.yml`): o PO lê `resumo`/`prototipo`
para desenhar o backlog, o Dev Lead lê as MESMAS `telas`/`anotacoes` como
referência visual de implementação — duplicar o conteúdo arriscaria as duas
cópias divergirem na revisão seguinte, o mesmo argumento por trás do C4 não
redigitar o `module_map`.

Falha ao ofertar UM dos dois handoffs não desfaz o artefato já gravado nem o
outro handoff (RN-116) — o motivo volta como texto do tool-result, entrada do
laço e não fim de linha (RN-163): o modelo lê e pode reportar ao usuário na
resposta seguinte.

Um `propose_prototype` BEM-SUCEDIDO encerra o turno
(`ux_designer_server.ex:120`, mesma guarda de `propose_execution_plan` no Dev
Lead) — sem isso o laço voltaria ao modelo, que poderia propor de novo e
produzir dois protótipos com o mesmo total. Só existe UMA ferramenta aqui
(não há um segundo tool call a encadear como no Arquiteto), então "para no
primeiro sucesso" não perde nada.

## Staff: código pronto, dormente para disparo automático (RN-305/RN-306, ADR 0088)

Não é fase planejada: `packages/contracts/fluxo.yml` declara o Staff/Principal Engineer como
`status: planned` desde o ADR 0085 ("contrato pronto, ativação decidida,
aguarda gatilho"). O dono do produto decidiu antecipar o CÓDIGO mesmo sabendo
que o gatilho automático (a Anamnese notando um problema sistêmico
RECORRENTE) não vai disparar — a Anamnese está pausada
(`ANAMNESE_ENABLED=false`, decisão de produto de 2026-08-10). Ver a
pendência já documentada em RN-086: o mesmo sinal que faria a Anamnese
propor subir o teto de paralelismo é o que faria ela propor um handoff ao
Staff, e nenhum dos dois dispara enquanto ela estiver pausada.

### RN-305 — O Staff ativa pelo caminho GENÉRICO de handoff, sem `USER_STARTED_AGENTS`, e sem `kickoff/1` {#rn-305}

`USER_STARTED_AGENTS` (`apps/api/src/domain/sessions/agent-activation.ts`) é
a exceção do Criativo (inicia SEM handoff, por comando do usuário) — o Staff
NÃO entra nela. Investigação confirmou que `canActivateAgent` já ativa
qualquer agente com handoff `accepted` endereçado a ele, o mesmo caminho que
já vale para `dev-lead`/`arquiteto`/`infra`; e `assertHandoffTargetAllowed`
(`apps/api/src/domain/agents/agent-areas.ts`) só recusa handoff endereçado a
SUBAGENTE de área — o Staff não tem área, então nenhuma mudança de domínio
na api foi necessária. "Acionável manualmente" significa que a MECÂNICA de
domínio permite (qualquer agente pode chamar
`EngineApiClient.create_handoff(..., "staff", ...)`, e um humano aceita pela
rota já existente), não que existe hoje uma tela dedicada para escolher
"endereçar handoff ao Staff" — a UI genérica de handoff a agente à escolha
segue no backlog (`docs/explanation/backlog.md`), como já estava antes desta
mudança.

`Engine.Agents.StaffServer` (`apps/engine/lib/engine/agents/staff_server.ex`)
é o quinto agente conversacional solo (junto de Criativo, PO, Arquiteto, Dev
Lead), espelhando o Arquiteto — `GenServer` por sessão, rehydration do event
log, laço bounded de tool use com teto 14 (`staff_server.ex:49`) — mas **sem
`kickoff/1`**: os outros leads sintetizam uma instrução de abertura a partir
de um artefato anterior no event log da sessão (product_brief, module_map,
backlog); o Staff não tem essa fonte, porque o problema sistêmico nasce de
fora da sessão. `StaffSupervisor.start_agent/2` sobe o processo (rehidrata o
histórico) e ele fica ocioso até a primeira `user_message`
(`staff_server.ex:60`) — que é como quem endereçou o handoff explica o
problema. `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:60`
(cláusula `start/2` de `"staff"`) nunca chama `kickoff` (a função nem
existe), ao contrário de po/arquiteto/dev-lead/infra.

- **Onde:** `apps/api/src/domain/sessions/agent-activation.ts`
  (`canActivateAgent`, `USER_STARTED_AGENTS` — intocado),
  `apps/api/src/domain/agents/agent-areas.ts`
  (`assertHandoffTargetAllowed` — intocado),
  `apps/engine/lib/engine/agents/staff_server.ex`,
  `staff_supervisor.ex`,
  `apps/engine/lib/engine_web/controllers/agent_command_controller.ex`
  (cláusulas `start/2`/`message/2`/`via_for/2` de `"staff"`),
  `apps/engine/lib/engine/application.ex` (`Engine.Agents.StaffSupervisor`
  na árvore de supervisão)
- **Teste:** `apps/engine/test/engine/agents/staff_server_test.exs`
  (rehydration, ausência de kickoff automático — o turno só roda por
  `user_message`)
- **ADR:** [0088](../adr/0088-staff-agente-dormente-para-disparo-automatico.md)

### RN-306 — `propose_rfc` grava o artefato DIRETO e devolve o handoff no MESMO tool call, sem `proposed_action` {#rn-306}

`Engine.Agents.StaffTools.propose_rfc`
(`apps/engine/lib/engine/agents/staff_tools.ex:41`) é a única ferramenta do
Staff: problema, opções com trade-offs, recomendação e o escopo de uma PoC
DESCARTÁVEL (`descartavel: true` é FIXO — nunca escrito pelo modelo). `run/2`
(`staff_tools.ex:89`) grava `artifact.rfc_staff` via
`EngineApiClient.append_event_returning/3` — mesmo padrão SEM tabela e SEM
caso de uso dedicado de `Engine.Harness.Tools.EmitInsight` (o `emit_insight`
do Arquiteto), e não o de `artifact.c4_diagram` (ADR 0068), que tem caso de
uso próprio na api porque DERIVA o nível Container do `module_map` vigente —
o RFC não deriva nada do lado de lá, todo o payload vem do tool call.

Depois de gravar, o MESMO `run/2` chama
`EngineApiClient.create_handoff(..., "staff", "arquiteto", artifact_id)` —
sem confirmação humana no meio, mesmo padrão de
`CriativoServer.executar_confirm_readiness/1` emitindo o product_brief e
oferecendo o handoff ao PO na mesma resposta. `propose_rfc` NÃO é
`proposed_action`: registrar um documento de arquitetura não é efeito
externo (não é git, terminal, nem gasto de agente) — a decisão real
(adotar, adaptar, recusar a recomendação) é do Arquiteto, no handoff que a
ferramenta já devolve. Falha ao criar o handoff NÃO derruba o processo nem
perde o RFC já gravado (RN-116) — o motivo entra no tool-result, e o modelo
sabe que precisa tentar de novo só o handoff, não reescrever o RFC.

- **Onde:** `apps/engine/lib/engine/agents/staff_tools.ex`
- **Teste:** `apps/engine/test/engine/agents/staff_server_test.exs`
  ("propõe o RFC, grava o artefato e devolve o handoff ao arquiteto";
  "propose_rfc com opções vazias vira tool-result de erro"; "falha ao
  devolver o handoff ao arquiteto NÃO derruba o processo")
- **ADR:** [0088](../adr/0088-staff-agente-dormente-para-disparo-automatico.md)

**Declarado, não escondido**: a roster do painel do time
(`apps/web/src/lib/agent-status.ts`, `staffActive`) e o card do dashboard
(`ProjectCardSummary.roster`, `apps/api/.../projects-summary.repository.ts`)
mostram o Staff quando ativo, mesmo critério de `infraActive` — evitando a
divergência que o comentário de `RosterFacts` já alertava. `SessionPage.tsx`
NÃO foi tocado: `staff` fica fora de `AGENTES_DE_CHAT`, o mesmo padrão já
aceito para `infra` (um lead REAL e ATIVO também fora dessa lista — o
handoff para ele "nunca é aceito por AQUI", conforme o comentário do próprio
arquivo). O caminho ponta a ponta de uso hoje é a rota interna
(`POST .../agent/message`, `agent: "staff"`), não a tela de Sessão.

---

## O appsec ganha o segundo momento do secops (RN-360/361, ADR 0090)

`packages/contracts/fluxo.yml` já declarava o `id: appsec` como `proposto`, com o critério
de separação escrito por antecipação: "mesmo padrão do QA: dois MOMENTOS, não
dois agentes por ora". Esta mudança constrói esse segundo momento — threat
model de DESIGN, ANTES de existir código/PR — decisão consciente do dono do
produto de antecipar a ativação, sem esperar o gate `implementavel` que o
próprio registro citava como gatilho.

### RN-360 — O threat model de DESIGN roda sobre story + module_map, sem worktree/task_id, no MESMO processo do secops {#rn-360}

Quem roda o appsec é o MESMO `Engine.Gates.SecOpsAgentServer` que já existe
para o veredito determinístico de PR — não um processo novo. `run_design/2`
(`apps/engine/lib/engine/gates/secops_agent_server.ex:76`) é um `GenServer.cast`
para a mesma chave de `Registry` (`{project_id, "secops"}`) que `run/2` já
usa; o `handle_cast({:run_design, story_id}, state)`
(`secops_agent_server.ex:93`) busca o contexto por
`Engine.Gates.AppSecContextBuilder.fetch/2`
(`apps/engine/lib/engine/gates/appsec_context_builder.ex:31`) — a story no
backlog do projeto (`EngineApiClient.list_backlog/1`, a MESMA leitura que a
RN-164 deu ao PO) e o `module_map` vigente da sessão que criou a story
(`EngineApiClient.get_infra_context/2`, a MESMA leitura sem task/story que a
área de Infra já faz) — e então chama `Engine.Gates.AppSecAgent.run/3`
(`apps/engine/lib/engine/gates/appsec_agent.ex:47`).

`AppSecAgent` é módulo SEM ESTADO (não é GenServer, mesma forma de
`QaPerformanceSegurancaAgent`), com registro de ferramentas SEM `Terminal` —
`[ReadFile, SearchWorkspace, EmitThreatModel]` — rodando um checklist
STRIDE-lite (Spoofing/Tampering/Repudiation/Information disclosure/Denial of
service/Elevation of privilege) via `Engine.Harness.ToolLoop.run/1`. A
diferença estrutural do "segundo momento sem Terminal, sem task_id" para o
padrão de gate anterior: nenhum `dev_state`/`worktree_path` entra no `ctx` —
`ReadFile`/`SearchWorkspace` degradam para o fallback de
`Engine.Actions.Workspace.workspace_dir/1` (o checkout COMPARTILHADO do
projeto, não um worktree de agente), e `session_id` vem de
`story["sessionId"]`, nunca de um `dev_state`. `EmitThreatModel`
(`apps/engine/lib/engine/gates/tools/emit_threat_model.ex`) não tem veredito
`approved`/`changes_requested` — o appsec sempre TERMINA registrando o
threat model, nunca aprovando/reprovando nada —, e por isso não reaproveita
`Engine.Gates.Hooks.Termination` (a forma extraída é outra): tem hook
PRÓPRIO, `Engine.Gates.Hooks.AppSecTermination`.

Terminado com sucesso, `run_appsec_design/3`
(`secops_agent_server.ex:234`) emite `artifact.threat_model`
(`storyId`/`threatModel`/`requisitosDeSeguranca`/`riscos`, schema em
`apps/engine/lib/engine/harness/artifact_schemas.ex:71` — `riscos` fica de
fora das chaves obrigatórias porque lista vazia é resposta válida). Falha
(teto de iterações, orçamento, ou o modelo parando sem chamar
`emit_threat_model`) vira `agent.error` durável com origem
(`modelo`/`politica`/`infra`), mesma régua da RN-059 — nunca resposta vazia
nem silêncio só em broadcast.

**O gatilho automático existe desde a [RN-539](#rn-539)**. Esta entrega foi
mantida autocontida de propósito (nenhum arquivo de outra frente tocado:
`decide.ts`, `apps/api/config/gates.yml` e `dev_lead_tools.ex` intocados), e declarava a
lacuna: `run_design/2` era ACIONÁVEL e nada acionava sozinho. O ponto de
disparo que ela nomeava — `assess_implementability` do Dev Lead, frente
`qa-estrategia`, gate `implementavel`, mesmo ADR 0090 — passou a ser o
chamador de verdade, em paralelo e uma vez só por story.

- **Onde:** `apps/engine/lib/engine/gates/secops_agent_server.ex` (`run_design/2`,
  `handle_cast/2`, `run_appsec_design/3`, `emit_threat_model/3`,
  `emit_bloqueio_appsec/3`); `apps/engine/lib/engine/gates/appsec_agent.ex`;
  `apps/engine/lib/engine/gates/appsec_context_builder.ex`;
  `apps/engine/lib/engine/gates/tools/emit_threat_model.ex`;
  `apps/engine/lib/engine/gates/hooks/appsec_termination.ex`;
  `apps/engine/lib/engine/harness/artifact_schemas.ex` (schema `threat_model`)
- **Teste:** `apps/engine/test/engine/gates/appsec_agent_test.exs`,
  `apps/engine/test/engine/gates/appsec_context_builder_test.exs`,
  `apps/engine/test/engine/gates/secops_agent_server_test.exs` (os três
  testes de `run_design`)
- **Origem:** [ADR 0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md)

### RN-361 — O threat model concluído cria TRÊS handoffs, sempre endereçando o LEAD {#rn-361}

`criar_handoffs_appsec/3` (`secops_agent_server.ex:326`) cria um handoff por
alvo declarado em `packages/contracts/fluxo.yml` (`saidas` do `appsec`): arquiteto,
dev-lead e infra — mesmo padrão de
`OfferInfraHandoffUseCase`/`ArquitetoServer.executar_offer_infra_handoff/1`
(chamadas SEPARADAS, uma por alvo, para uma falha de handoff não desfazer os
outros dois já criados). O id do fluxo é `area-infra`, mas o AGENTE
endereçável é `"infra"` (`apps/api/src/domain/agents/agent-areas.ts` —
`lead: 'infra'`), nunca `area-infra`: handoff externo endereça só o LEAD de
área (ADR 0038), e `CreateHandoffUseCase.assertHandoffTargetAllowed`
recusaria um `toAgent` que não resolve a um lead/agente-sem-área. Falha de UM
alvo vira `agent.error` narrado por alvo (RN-116) — os outros dois handoffs
já criados não são desfeitos.

**Desde a [RN-636](#rn-636) os três são PERGUNTADOS, não mais sempre
criados:** o destino que já tem oferta pendente ou já está ativo no projeto não
recebe outra, e isso não é falha.

- **Onde:** `apps/engine/lib/engine/gates/secops_agent_server.ex:55`
  (`@appsec_handoff_targets`), `:377` (`criar_handoffs_appsec/3`)
- **Teste:** `apps/engine/test/engine/gates/secops_agent_server_test.exs`
  ("run_design: threat model concluído emite artifact.threat_model e cria
  os TRÊS handoffs")
- **Origem:** [ADR 0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md)

---

## "N agentes online" no dashboard — status AO VIVO, nunca presença histórica (RN-409, ADR 0097)

### RN-414 — `rag_search`: agentes ganham a ferramenta que o produto nunca tinha exposto {#rn-414}

`grep -rn "rag" apps/engine/lib` dava ZERO ocorrências antes desta
entrega — o RAG completo (pgvector, busca híbrida) só era consumido pela
aba web "Chat RAG". A tool nova `rag_search`
(`apps/engine/lib/engine/harness/tools/rag_search.ex`, categoria
`:direct`, leitura não é efeito externo) chama `POST /internal/rag/search`
— rota nova que REUSA `HybridSearchUseCase` sem duplicar a lógica de
busca — e devolve hits formatados com citação (`path` + trecho), sempre
com `degraded: true` visível no INÍCIO do texto quando o embedding não
estava disponível (nunca escondido pelo corte de teto).

Tetos próprios, no espírito da RN-150: `top_k` clampado a 10 dentro da
própria tool (não confia no que a api aceitaria), teto de 16 KiB no texto
formatado (menor que os 32 KiB de `search_workspace`/`read_file` — cada
hit de RAG já é chunk+excerpt inteiro). Falha de rede vira erro legível
ao modelo, nunca crash do `ToolLoop` (RN-163).

Registrada em `Engine.Harness.Tools` (PO/Arquiteto/conversacionais) e
`Engine.Dev.Tools` (dev agent); estendida também aos gates de leitura que
já citam ADR/convenção indexada (QA-automação, QA-estratégia, AppSec,
QA-performance/segurança) — não a `Infra.WorkflowsAgent` nem
Psicólogo/Anamnese, que raciocinam sobre event log, não sobre docs/código
do projeto.

- **Onde:** `apps/engine/lib/engine/harness/tools/rag_search.ex`;
  `apps/engine/lib/engine/sessions/engine_api_client.ex` (`rag_search/4`);
  `apps/api/src/interfaces/http/internal/internal-rag.controller.ts`
- **Teste:** `rag_search_test.exs` (hits formatados com citação;
  degradação visível; falha de rede sem crash; teto de bytes truncando
  com marca clara; clamp de `top_k`); `engine_api_client_rag_test.exs`
- **Origem:** ver [ADR 0100](../adr/0100-rag-search-e-modelos-garantidos-no-boot.md)

---

### RN-417 — Psicólogo e Anamnese consultam por relevância, com degradação declarada para recência {#rn-417}

`Psychologist.ContextBuilder`/`Anamnese.ContextBuilder` continuam lendo o
que sempre leram (eventos recentes / janela temporal), e ganham uma
SEGUNDA fonte, `EngineApiClient.rag_search/4`, com uma query derivada do
GATILHO da análise — a causa de término já classificada, no Psicólogo;
competências do catálogo ainda sem `current_profile`, na Anamnese
(NUNCA texto livre de hipótese/racional, pela proibição já estabelecida
de a Anamnese jamais inferir saúde/personalidade/idade/gênero — a query
só contém nomes de competência/membro/projeto). Os hits entram no
orçamento EXISTENTE de `Triage` (`max_prompt_events`/`max_payload_chars`)
— descontam vagas da janela de recentes, nunca somam por fora dela.

A chamada ao RAG é estritamente ADITIVA: sem hit (RAG indisponível, erro,
ou simplesmente sem resultado), o comportamento é IDÊNTICO ao de antes
desta RN — nenhum teste pré-existente precisou mudar. `degraded: true`
(RAG caiu pra léxico-only por falta de embedding) aparece EXPLICITAMENTE
no contexto final, nos dois agentes — nunca escondido pelo corte de
teto.

Os kickoffs de Psicólogo (`psychologist-kickoff`) e Anamnese
(`anamnese-kickoff`) passam a resolver como TEMPLATE do grafo
(`EngineApiClient.get_prompt_template/2`) quando `graph_templates_enabled?`
está ligada (`GRAPH_TEMPLATES_ENABLED`, default `false`) — com fallback
obrigatório pro texto inline em qualquer falha (api fora, template não
semeado, flag desligada). `:pinned => true` continua igual nos dois
caminhos.

O TERCEIRO consumidor da mesma flag é o prompt de sumarização do
`ContextManager` (`context-manager-summarize`, o quarto e último template da
leva da [RN-413](infra.md#rn-413) — era o único ainda sem consumidor, lacuna que a
[ADR 0101](../adr/0101-memoria-relacional-como-projecao-do-event-log.md)
declarou aberta e que fecha aqui). Mesma régua, byte a byte: flag ligada
tenta o template e substitui `{{turnos}}` pelo MESMO corpo `<role>:
<content>` que a trilha inline já montava; qualquer desfecho que não seja
`{"body" => corpo}` com corpo binário não-vazio cai no inline — SEM erro e
SEM log de erro, porque flag desligada, template ainda não semeado e api do
grafo fora do ar são o MESMO caminho de degradação. Com a flag desligada (o
default) a api nem é chamada. O render é função privada PRÓPRIA, não um
helper compartilhado: o conjunto de placeholders é do template, não do
mecanismo — cada um dos três consumidores tem o seu. E o fallback
determinístico de quando o MODELO falha (`"(N turnos anteriores
omitidos)"`) é outra coisa e NÃO passa por template nenhum: é comportamento
de código, não texto de prompt, e o próprio `.md` do template declara isso.

> **Desde a [RN-621](#rn-621)** o prompt de resumo, nas duas trilhas, pede que
> cada turno mantenha o idioma original e que citação e código não se traduzam;
> o template versionado subiu para a versão `"2"`.

**Consumo do restante do grafo (`query_user_context` — hipóteses com
evidência e perfis lidos DIRETO do Neo4j) fica DECLARADO fora desta
entrega**: ainda sem rota HTTP exposta do lado api; Psicólogo/Anamnese
hoje só consultam o RAG (pgvector) via `rag_search`, não o grafo de
relações em si.

- **Onde:** `apps/engine/lib/engine/psychologist/context_builder.ex`,
  `apps/engine/lib/engine/workers/psychologist_worker.ex`;
  `apps/engine/lib/engine/anamnese/context_builder.ex`,
  `apps/engine/lib/engine/workers/anamnese_worker.ex`;
  `apps/engine/lib/engine/harness/context_manager.ex` (`prompt/1`,
  `render_template/2`, `prompt_inline/1`)
- **Teste:** `context_builder_test.exs` dos dois agentes (hits presentes;
  falha do RAG degrada sem erro; `degraded: true` visível; clamp de
  `top_k`; query derivada do gatilho); `psychologist_worker_test.exs`/
  `anamnese_worker_test.exs` (template com sucesso e com fallback;
  `:pinned` idêntico nos dois caminhos; flag desligada nunca chama a api);
  `context_manager_test.exs` (template com `{{turnos}}` substituído;
  `{:error, :not_found}` cai no inline e a compactação termina normal;
  flag desligada nunca chama `get_prompt_template`)
- **Origem:** ver [ADR 0101](../adr/0101-memoria-relacional-como-projecao-do-event-log.md)

---

### RN-419 — O runner local se autentica por ticket de uso único, escopado a projeto e papel {#rn-419}

**REVISADA pela [RN-421](api.md#rn-421) (ADR 0104)**: a condição de recusa do
ticket citada abaixo (`workspaceMode !== 'local'`) virou `executionMode
!== 'runner'` — mesma régua, nome novo. O resto desta entrada continua
valendo tal como está.

O canal `terminal:<projectId>` (socket Phoenix novo, `/runner`) recebe
dois papéis distintos — `:runner` (o CLI na máquina do usuário, no
máximo UM por projeto, exclusividade garantida por
`:global.register_name/3`) e `:web` (a aba Terminal, múltiplos
simultâneos) — e os dois entram autenticados por TICKET DE USO ÚNICO,
mesmo padrão de segurança da RN-108 (ticket de socket de sessão), com uma
inversão de propriedade: o ticket é EMITIDO PELO ENGINE
(`runner_socket_tickets`, schema `"engine"`, migration Ecto própria — não
uma extensão da tabela de ticket de sessão, que é da api), e a API o pede
via rota HTTP interna nova (`POST /internal/projects/:projectId/runner-tickets`)
— o inverso do fluxo de ticket de sessão, onde a api grava direto na
própria tabela.

`POST /projects/:projectId/runner-ticket` (role `developer`+, recusa se
`workspaceMode !== 'local'`) e `POST /projects/:projectId/terminal-ticket`
(role `viewer`+, qualquer modo) são as duas rotas públicas que emitem o
ticket pro cliente certo — o runner pede a primeira, a web pede a
segunda. Ticket consumido (validação + `UPDATE` condicional de uso
único) no `join` do canal; ticket de OUTRO projeto ou reusado nunca abre
o tópico.

- **Onde:** `apps/engine/lib/engine/runners/socket_ticket.ex`,
  `apps/engine/lib/engine/runners/registry.ex`,
  `apps/engine/lib/engine_web/channels/{runner_socket,terminal_channel}.ex`;
  `apps/api/src/interfaces/http/runner/runner-tickets.controller.ts`,
  `apps/api/src/application/use-cases/runner/request-runner-ticket.use-case.ts`
- **Teste:** `runner_socket_test.exs`/`terminal_channel_test.exs` (join
  com ticket válido sucede; ticket reusado recusa; ticket de outro
  projeto não abre o tópico errado; segundo `:runner` no mesmo projeto é
  recusado; um segundo runner consegue conectar depois que o primeiro
  cai); `request-runner-ticket.use-case.spec.ts`/
  `runner-tickets.controller.spec.ts` (recusa pra projeto não-`local` no
  ticket de runner; ticket de terminal funciona pra qualquer modo)
- **Origem:** ver [ADR 0103](../adr/0103-runner-local-execucao-na-maquina-do-usuario.md)

---

### RN-420 — Comando de agente roteado ao runner passa pelo MESMO pipeline de aprovação; PTY é ação do usuário, auditada {#rn-420}

**REVISADA pela [RN-423](runner.md#rn-423) (ADR 0104)**: a condição pra rotear deixou
de ser binária. `workspace_mode == "local"` virou `execution_mode ==
"runner"` **E** `workspace_verified_at` não-nulo **E** runner conectado —
faltando qualquer uma das TRÊS, o comando é RECUSADO explicitamente, nunca
cai no `System.cmd`/bind-mount de `mounted` (que não existe pra um projeto
`runner`, sem bind-mount nenhum). O resto desta entrada — o pipeline de
aprovação de sempre, PTY como ação do usuário — continua valendo tal como
está.

`Engine.Actions.TerminalExecutor` decide rotear um comando pro runner (em
vez do `System.cmd` de sempre, dentro do container) **DEPOIS** que o
pipeline normal (`decide()`/`proposed_action`) já aprovou — o roteamento
é só uma escolha de DESTINO pro mesmo comando já autorizado, nunca um
segundo caminho de execução que escapa da política (que continua com os
tetos absolutos da RN-418 valendo igual, sudo/git incluídos). Condição
pra rotear (histórico, ver revisão acima): `workspace_mode == "local"` E
runner conectado (`Engine.Runners.Registry.connected?/1`) — sem qualquer
uma das duas, o comportamento de sempre continua (`System.cmd` no
container via bind-mount, ADR 0072 vira FALLBACK, nunca removido).

PTY interativo é DIFERENTE: é ação do USUÁRIO autenticado digitando no
terminal da própria máquina, não do agente — por isso NÃO passa por
`proposed_action`. Mas precisa deixar rastro: `pty_open`/`pty_close`
vindos da web emitem `terminal.session.started`/`terminal.session.ended`
no event log (endereçados à sessão mais recente do projeto,
`ProjectSession.latest_id/1`, mesmo mecanismo que a Anamnese já usa pra
narrar algo project-scoped). Achado real na consolidação: sem runner
conectado, a web precisa de um `pty_error` EXPLÍCITO de volta — descartar
o pedido só com um log no servidor deixaria a aba presa em "carregando"
pra sempre, nunca alcançando o estado "sem runner" que a tela já sabia
mostrar.

- **Onde:** `apps/engine/lib/engine/actions/terminal_executor.ex`,
  `apps/engine/lib/engine/runners/runner_router.ex`,
  `apps/engine/lib/engine_web/channels/terminal_channel.ex`
- **Teste:** `terminal_executor_test.exs` (roteia pro runner com modo
  `local` + runner conectado; `cwd` passa adiante; cai no caminho atual
  sem runner conectado; nunca roteia em modo `container`);
  `terminal_channel_test.exs` (`pty_open` sem runner conectado devolve
  `pty_error` pra web, nunca fica sem resposta)
- **Origem:** ver [ADR 0103](../adr/0103-runner-local-execucao-na-maquina-do-usuario.md)

## O explorador de pasta do Runner vira três colunas, e a criação de um projeto `runner` deixa de esperar o passo final (RN-436/436)

### RN-454 — A aba Insights sabe que o Psicólogo está pausado ANTES de o usuário esbarrar no 503 {#rn-454}

Achado por USO: a aba Insights, com zero hipóteses, mostrava "Sem hipóteses
ainda — o Psicólogo analisa cada sessão encerrada" mesmo com
`PSYCHOLOGIST_ENABLED=false` — a mesma frase que aparece quando o Psicólogo
está ATIVO e só ainda não rodou. As duas situações são indistinguíveis pelo
texto, o que é a mesma classe de defeito que a RN-088/RN-107 já fecharam
para outras telas: um estado que existe e o produto sabe, mas não mostra.

A [RN-117](#rn-117) já cobria a descoberta da pausa, mas só no CLIQUE de
"Reanalisar" (503 → `PsychologistDisabledError`) — e esse botão só existe
na faixa de análises, que só aparece quando `runs.length > 0`. Uma sessão
sem hipótese nenhuma nunca chega perto dele, então a pausa era invisível
justamente na tela vazia.

`GET /internal/psychologist/status` (engine, `PsychologistCommandController.status/2`)
é leitura pura de `PsychologistWorker.enabled?/0` — SEM efeito colateral,
diferente de `/reanalyze`, que cria um job quando ativado. A api expõe
`GET /projects/:projectId/psychologist/status` (`GetPsychologistStatusUseCase`,
`role:viewer`) por cima disso — projeto na URL só por consistência com as
rotas irmãs (`hypotheses`, `psychologist/analyses`); a flag em si é GLOBAL,
como a RN-117 já registra. `ProjectInsightsTab.tsx` consome essa leitura
(`usePsychologistStatus`) e escolhe a frase do estado vazio por ela: pausado
mostra "O Psicólogo está pausado — nenhuma sessão é analisada até ser
reativado" (`insights.projectInsightsTab.emptyPaused`); do contrário, mantém
a frase original, que É honesta quando a feature está de fato ativa. O
aviso persistente (`pausedNotice`) e os botões de "Reanalisar" também
passaram a refletir essa leitura proativa, e não só o `useState` descoberto
pelo 503 — que continua existindo, como reforço, para o caso raro de a
flag mudar EM VOO entre a leitura de status e o clique.

- **Onde:** `apps/engine/lib/engine_web/controllers/psychologist_command_controller.ex`
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
- **Teste:**
  `apps/engine/test/engine_web/controllers/psychologist_command_controller_test.exs`
  (`status/2`, `enabled: true`/`false`),
  `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts`
  (`getPsychologistStatus`),
  `apps/api/test/application/use-cases/execution/get-psychologist-status.use-case.spec.ts`,
  `apps/web/src/routes/ProjectInsightsTab.test.tsx`
- **Borda:** a flag continua GLOBAL (ver RN-117) — a rota da api aceita
  `projectId` na URL só para bater com o padrão das rotas irmãs do
  controller, e não porque a resposta varia por projeto.
- **Origem:** achado por USO real navegando a aba Insights com
  `PSYCHOLOGIST_ENABLED=false`, não roteiro. Sem ADR — extensão pontual do
  mecanismo de leitura já existente da RN-117, mesmo padrão da RN-088/
  RN-107 para o resto do produto.

---

## Pasta local anexada vira o quarto escopo do índice RAG, lido pelo NAVEGADOR (RN-455..457, ADR 0113)

### RN-459 — Teto de iterações não termina mais calado em quatro dos seis agentes conversacionais {#rn-459}

Achado durante a investigação da faixa de atividade do turno (RN-460):
`arquiteto_server.ex`, `dev_lead_server.ex`, `ux_designer_server.ex` e
`staff_server.ex` terminavam CALADOS quando o teto de iterações estourava
(`defp run_turn(state, remaining) when remaining <= 0, do: state`, sem
evento nenhum) — contradizendo a regra permanente de que laço de agente
não termina calado. Só o PO já emitia `toolloop.limit_reached`
(RN-166); o Criativo diverge deliberadamente com `agent.error` (`reason:
"limite_de_iteracoes"`, decisão documentada no próprio código — reusar o
nome do `ToolLoop` mentiria sobre quem produziu o evento) e não foi
tocado. Os quatro corrigidos passam a emitir `toolloop.limit_reached`
(mesmo evento do PO, mesmo payload `iteration`/`max_iterations`) antes de
retornar — nenhuma mudança na estrutura de `dispatch_tool` de cada um.

- **Onde:** `apps/engine/lib/engine/agents/arquiteto_server.ex:195`,
  `dev_lead_server.ex:244`, `ux_designer_server.ex:121`,
  `staff_server.ex:113`
- **Teste:** `apps/engine/test/engine/agents/{arquiteto,dev_lead,
  ux_designer,staff}_server_test.exs` ("teto de iterações emite
  toolloop.limit_reached")
- **Origem:** achado por leitura completa dos seis servers, durante a
  implementação da RN-460; escopo estendido por decisão do dono do
  produto

## A busca do RAG deixa rastro, e o rastro congela os pesos (RN-479..481)

### RN-492 — O comando de terminal do dev agent roda DENTRO do container real, quando há um {#rn-492}

`Engine.Actions.TerminalExecutor.decisao_de_execucao/1` ganha a QUINTA saída
(`:executar_no_container`): projeto em `execution_mode: container` com uma
linha REGISTRADA `running` em `project_containers`
(`Engine.Containers.ProjectContainerLifecycle.running?/1`, leitura read-only
direta da tabela, mesmo padrão de `Engine.Projects.Project`). Antes desta
regra, mesmo com um container de pé (RN-491), TODO comando de terminal
rodava via `System.cmd` no processo do engine, contra a pasta compartilhada
— o container ficava ocioso.

O comando atravessa engine → api → broker
(`POST internal/projects/:projectId/container-exec`,
`ExecutarComandoNoContainerUseCase`, `ContainerBrokerPort.exec`) e roda via
`docker exec`. `cwd`, quando presente, é TRADUZIDO do caminho de HOST (dentro
de `PROJECT_WORKSPACES_ROOT`) para dentro de `/work` — o único diretório que
o container enxerga — trocando o prefixo `<project_workspaces_root>/
<workspace_dir_name>` por `/work` e preservando o sufixo (o worktree
individual de um dev agent, `.worktrees/<agent_id>`, incluso). O worktree em
si não muda de lugar nem de mecanismo de criação: `Workspace.ensure!/4`
continua escrevendo no MESMO diretório físico que o broker monta em `/work`
(verificado em código: `raizDoProjeto` do broker e `PROJECT_WORKSPACES_ROOT`
do engine resolvem a mesma pasta, via `workspace_dir_name`, RN-109) — o
container é só mais um observador dela.

**`running` REGISTRADO nunca confirma que o container está de pé DE VERDADE
agora (RN-486).** Se ele morreu ou foi removido por fora entre o registro e
esta chamada, `broker.exec` falha e vira `failed_result` NORMAL — exit_code
`nil`, mensagem nomeando o motivo — nunca crash, nunca fallback silencioso de
volta pro `System.cmd` fora do container (isso reabriria o vetor de
isolamento que esta regra existe para fechar). `mounted` nunca cai nesta
saída: o broker recusa subir container pra esse modo
(`ModoDeExecucaoNaoSuportadoError`).

- **Onde:** `apps/engine/lib/engine/actions/terminal_executor.ex`
  (`decisao_de_execucao/1`, `run_no_container/4`, `cwd_para_container/2`),
  `apps/engine/lib/engine/containers/project_container_lifecycle.ex`,
  `apps/engine/lib/engine/sessions/engine_api_client.ex`
  (`executar_comando_no_container/4`),
  `apps/api/src/interfaces/http/internal/internal-projects.controller.ts`
  (`POST :projectId/container-exec`),
  `apps/api/src/application/use-cases/containers/executar-comando-no-container.use-case.ts`,
  `apps/api/src/application/ports/container-broker.port.ts` (`exec`,
  `timeoutMs`)
- **Teste:** `apps/engine/test/engine/actions/terminal_executor_test.exs`
  (as cinco saídas de `decisao_de_execucao/1`; tradução de `cwd` na raiz e
  num worktree; `sucesso: false` e falha de transporte viram `failed_result`;
  container sem linha `running`/em `stopped` cai no caminho de sempre),
  `apps/api/test/application/use-cases/containers/executar-comando-no-container.use-case.spec.ts`
  (`BrokerRecusouError`/`BrokerIndisponivelError` nunca propagam; outro erro
  propaga),
  `apps/api/test/infrastructure/http-clients/container-broker.client.spec.ts`
- **ADR:** [0130](../adr/0130-broker-de-container.md), [0134](../adr/0134-dev-agents-executam-dentro-do-container.md)
- **Origem:** plano do dono do produto, Parte 1 / PR 1.6

### RN-502 — Dev agent só reivindica task com container `running`, e o terminal não cai mais fora dele {#rn-502}

Duas metades da mesma regra: **sem ambiente de execução, o dev agent não
começa**, e **sem ambiente de execução, o comando não roda em lugar nenhum**.

**A guarda do claim.** `Engine.Dev.AgentIo.try_claim/2` — o ponto ÚNICO de
claim — consulta
`Engine.Containers.ProjectContainerLifecycle.running?/1` ANTES de chamar
`claim_task/1`. Sem uma linha REGISTRADA `running` em `project_containers`
([RN-243](api.md#rn-243)/ADR 0081), o agente cai em `:idle`, persiste, emite
`dev.blocked_by_container` e **não chama a api**. A guarda vem antes do claim
de propósito: reivindicar para devolver logo em seguida deixaria a task
marcada e sem dono vivo, que é o estado que `block_task/4` existe para nunca
produzir.

**`:idle`, e não um status novo.** É o único estado do qual um wake ainda
resgata — os guards de `handle_info/2` são todos casados com ele
(`{:wake, :became_claimable}` exige `:idle`, `:rearm` exige `:idle_tripped`,
`gate_resolved` exige `task_id` batendo,
[RN-047](#rn-047)). Um
`:blocked_by_container` inventado seria um estado do qual nada resgata.

**No ENGINE e não só no `activate-execution` da api**, porque o claim tem um
caminho que nenhuma rota cobre: a REIDRATAÇÃO. `Engine.Dev.DevRehydrator` não
faz cast `:work`; quem claima depois de um restart é `DevAgentServer.init/1`
→ `finish_restart_recovery/1` → `try_claim/2`. Um gate só na fronteira HTTP
deixaria todo agente reidratado voltar a trabalhar sem container.

**O wake.** Leitura não avisa ninguém: um agente já parado continuaria parado
até um evento não relacionado passar por perto. Então a chegada em `running`
PUBLICA — `RegistrarTransicaoDeContainerUseCase` grava a linha e o evento na
MESMA transação, `aggregateType: 'container'` (o terceiro agregado que
`Engine.Outbox.Drain` passou a drenar, ao lado de `session` e `task`),
`aggregateId` = o PROJETO. `Engine.Workers.DevAgentWakeWorker` entrega
`{:wake, :became_claimable}` a TODOS os agentes do projeto
(`DevAgentState.list_by_project/1` — o container é do projeto, não de um
módulo). É a MESMA mensagem que já existia, e não uma nova: a semântica dela
já é "pode haver trabalho agora", e uma mensagem própria exigiria cláusula
nova de `handle_info/2` nos dois servers com guard idêntico ao que já existe.
Só `running` publica; `provisioning`/`stopped`/`failed`/`removed` não soltam
ninguém.

**A segunda metade: o terminal.** `Engine.Actions.TerminalExecutor`
degradava calado — `container` sem container `running` caía em
`:caminho_de_sempre`, isto é, `System.cmd` DENTRO do processo do engine, o
mesmo que fala com o banco, com a api e com todos os outros projetos. O ADR
0134 ([RN-492](#rn-492)) tinha fechado o isolamento só no caminho feliz.
Agora recusa (`:recusar_container_ausente`), espelhando o
`:recusar_nao_verificado`/`:recusar_runner_desconectado` que o modo `runner`
já tinha ([RN-423](runner.md#rn-423)), e como `failed_result` normal — nunca crash.
`mounted` entra no MESMO ramo: com container `running` atravessa pro broker
igual a `container`; sem ele, recusa. O catch-all `:caminho_de_sempre`
encolhe para o que sempre deveria ter sido sozinho — **projeto inexistente ou
`project_id` malformado**. Nenhum modo de execução cai nele.

**Consequência declarada:** projeto sem container de pé para de trabalhar, e
diz por quê. É deliberado — é o que a regra existe para fazer — e é por isso
que ela só pode entrar DEPOIS das mudanças que dão container ao modo
`mounted`.

- **Onde:** `apps/engine/lib/engine/dev/agent_io.ex` (`try_claim/2`),
  `apps/engine/lib/engine/actions/terminal_executor.ex`
  (`decisao_de_execucao/1`),
  `apps/engine/lib/engine/outbox/drain.ex`,
  `apps/engine/lib/engine/workers/dev_agent_wake_worker.ex`,
  `apps/api/src/application/use-cases/containers/registrar-transicao-de-container.use-case.ts`
- **Teste:** `apps/engine/test/engine/dev/claim_com_container_test.exs` —
  `:work` inicial sem container cai em `:idle`, persiste, emite e **não**
  chama a api; o Noop passa pela mesma guarda; agente REIDRATADO para em
  `:idle` sem claimar; `container.running` na outbox percorre
  drain → worker → wake → agente e ele re-claima; e o caminho de sempre
  segue intacto com container `running`.
  `apps/engine/test/engine/actions/terminal_executor_test.exs` — recusa para
  `container` (sem linha e com `stopped`) e para `mounted`; `mounted` com
  `running` atravessa pro broker; só projeto inexistente cai em
  `:caminho_de_sempre`.
  `apps/api/test/application/use-cases/containers/ciclo-de-vida-do-container.use-case.spec.ts`
  — `running` publica `container.running` no agregado `container`; os outros
  destinos e a criação da linha não publicam nada
- **ADR:** [0143](../adr/0143-agentes-de-dev-so-depois-do-container.md)
- **Origem:** plano "Nome e local na mesma tela, e container antes dos dev
  agents" (PR 7) — dez tasks do `exp001` travaram de uma vez porque nada
  ordenava container antes de dev agent

---

## O artefato de decisão dos conversacionais (RN-505)

### RN-505 — `decision_record` reusa o padrão GENÉRICO de `emit_artifact`, não o dedicado {#rn-505}

Um agente conversacional que toma uma decisão relevante numa conversa (por
que escolheu X e não Y, o que considerou, o que aceitou perder) registra isso
com `emit_artifact` e `type: decision_record` — payload com `context`,
`options` (lista), `choice` e `consequences`, as quatro chaves obrigatórias
em `Engine.Harness.ArtifactSchemas` (`artifact_schemas.ex:82`), tool-emittable
desde que entrou em `@tool_emittable` (`artifact_schemas.ex:98`). **Sem
validação cruzada de propósito:** `choice` não precisa bater com um item de
`options` — texto livre é mais robusto, e o schema genérico só valida
presença de chave (a mesma régua de `note`/`business_rule`).

**Por que reusar o padrão GENÉRICO em vez do dedicado.** `artifact.project_image`
e `artifact.c4_diagram` (RN vizinhas desta) são artefatos VERSIONADOS — cada
emissão substitui a anterior como "vigente", com rota HTTP própria de leitura
e schema TypeScript dedicado na api. Uma decisão não é assim: é um registro
append-only por natureza, não um "vigente" que se substitui — o mesmo
raciocínio que já vale para `note`/`business_rule`. Pagar o preço do padrão
dedicado (schema TS, versionamento, rota nova) para um log que só precisa
existir e ser pesquisável no event log da sessão custaria estrutura que a
decisão não pede.

**Distinção declarada com `open_adr_pr` (só o Arquiteto tem).** Os dois
COEXISTEM, com propósitos diferentes: `decision_record` é para TODA decisão
relevante de qualquer um dos seis conversacionais, sem fricção nenhuma —
nunca commita arquivo, nunca abre PR, nunca espera aprovação humana.
`open_adr_pr` é para quando a decisão é grande o bastante para virar
DOCUMENTO real em `docs/adr/*.md`, com PR de verdade e aprovação humana
obrigatória. Um projeto pode ter dez `decision_record` e zero ADR numa
sessão — o segundo não é a versão "séria" do primeiro, é outra ferramenta
para outra escala de decisão.

**Wiring nos cinco conversacionais que ainda não tinham `emit_artifact`** —
PO (`po_server.ex:115`), Arquiteto (`arquiteto_server.ex:103`), Dev Lead
(`dev_lead_server.ex:153`), UX Designer (`ux_designer_server.ex:94`) e Staff
(`staff_server.ex:94`); o Criativo já tinha a ferramenta desde a Fase 3b, só
ganhou o tipo novo (é o `known/0` compartilhado quem decide, sem mudança no
`CriativoServer`). Em cada um, o `run_tool/3` comum ganhou a cláusula
`"emit_artifact" -> EmitArtifact.run/2` (ex.: `po_server.ex:279`) — **sem
tratamento especial**: diferente de `propose_execution_plan`/
`assess_implementability` no Dev Lead (que suspendem o turno esperando
aprovação, ADR 0086), `emit_artifact` nunca devolve `{:pending, _}`, então
entra no dispatch comum sem precisar do `reduce_while` que aquelas duas
ferramentas exigem. E os cinco ganharam a MESMA frase no `system_prompt/1`
(ex.: `po_server.ex:463`) explicando quando usar `type: decision_record` —
fora do texto de identidade (`Engine.Harness.Agents`) porque não é sobre
QUEM o agente é, é uma instrução operacional sobre uma ferramenta.

**Fora de escopo, declarado.** Agentes de execução (QA, SecOps, Dev Agent de
módulo) rodam sobre `ToolLoop`, sem harness comum aos seis conversacionais —
ficam de fora desta fatia, investigação própria por módulo antes de
estender. A amarração com a Frente 1 do mesmo plano (o dispatch do Infra
Lead emitindo um `decision_record` server-emitted quando propõe subir
container via runner) também fica de fora: depende de uma tool
(`propose_container_start_via_runner`) que outro PR está criando em
paralelo — ver TODO no PR desta mudança.

- **Onde:** `apps/engine/lib/engine/harness/artifact_schemas.ex` (schema +
  `@tool_emittable`); `apps/engine/lib/engine/agents/po_server.ex`,
  `arquiteto_server.ex`, `dev_lead_server.ex`, `ux_designer_server.ex`,
  `staff_server.ex` (alias + `tool_specs` + `run_tool/3` +
  `system_prompt/1`)
- **Teste:** `apps/engine/test/engine/harness/artifact_schemas_test.exs`
  (`describe("decision_record …")`);
  `apps/engine/test/engine/agents/po_server_test.exs` e
  `arquiteto_server_test.exs`
  (`describe("Frente 3 do plano de decision_record — emit_artifact")`)
- **Origem:** plano do dono do produto, Frente 3 ("Artefato de decisão")

---

## O `join` do agente local deixa de ser mudo (RN-514)

### RN-514 — O runner DECLARA o que sabe fazer no `join`, o servidor CONCEDE a interseção em `socket.assigns`, e mensagem sem capacidade é RECUSADA em vez de sumir {#rn-514}

Até aqui o `join` do canal `terminal:<projectId>` era **mudo dos dois lados**:
o runner mandava `socket.channel(\`terminal:${projectId}\`, {})` e o servidor
os ignorava literalmente (`def join("terminal:" <> project_id, _params,
socket)`). Toda a identidade vinha do ticket — o papel (`:runner`/`:web`) sai
do `kind` —, e o servidor **não tinha como saber** se o binário do outro lado
era de uma versão que entende uma mensagem nova.

O defeito que isso produz é o pior possível, e é o que esta regra fecha: a
mensagem chega, o handler não existe do outro lado, e **nada acontece** — sem
erro, sem log, sem ninguém saber que a função nunca rodou.

**Três capacidades, e só o que o runner sabe fazer é declarado.** O
vocabulário do servidor é `exec` (comando aprovado, ADR 0104), `pty`
(terminal interativo, ADR 0103) e `espelho` (copiar o trabalho para uma pasta
fora da base montada). O runner declara **`exec` e `pty`**, e `espelho` fica
de fora **de propósito**: declarar o que não se implementa é exatamente o
defeito que a negociação existe para impedir — o servidor concederia,
entregaria a mensagem, e ela sumiria do mesmo jeito. `espelho` nasce só como
**nome do vocabulário**, sem comportamento nenhum; quem o implementa é a
sessão 6 da FASE 28.

**Ausência de params é o LEGADO, e isso é fato — não benevolência.** Todo
binário anterior a esta mudança manda params vazios, e todo binário anterior
a esta mudança sabe fazer `exec` e `pty`: são as duas funções com que o
runner nasceu. Conceder `{exec, pty}` a quem não declara nada é ler
corretamente a única coisa que aquele binário poderia ter dito. O contrário
faria **todo runner instalado parar de conectar**, que é mudança exigindo
ação do operador antes do deploy — `breaking/` e MAJOR, pela convenção do
repositório, e não é isto que esta entrega é. Params ausentes, `capacidades`
ausente, lista **vazia** e valor que não é lista caem todos no legado: são as
formas que "este binário não sabe declarar nada" assume no caminho de rede.

**Desconhecido é IGNORADO, nunca motivo de recusa.** O conjunto concedido é a
interseção do declarado com o vocabulário que **este** servidor conhece —
runner mais NOVO que o engine tem que conseguir conectar. Já declarar
**apenas** nomes desconhecidos é declaração vazia, não legado: quem sabe
declarar disse o que sabe fazer.

**O que cada modo EXIGE.** `runner` exige `exec` — é literalmente o que faz o
modo funcionar, e sem ele o `TerminalExecutor` rotearia comando aprovado para
um binário que não o executa, com a falha aparecendo como *timeout* em vez de
recusa. `container` e `mounted` não exigem nada (o runner nem é o caminho de
execução deles). **Nada exige `espelho` ainda** — o mecanismo de recusa nasce
implementado e testado, e não dispara na prática hoje. Isso é o desenho, não
pendência. Modo que não se conseguiu ler (projeto inexistente, id malformado,
consulta que falhou) exige **nada**: recusar por pré-condição não confirmada
seria colapsar "não sei" com "não tem" ([RN-088](web.md#rn-088)).

**O conjunto concedido vive em `socket.assigns`, nunca em tabela.**
Capacidade é propriedade **daquela conexão** — uma tabela poderia afirmar que
um runner sabe algo que o processo conectado agora não sabe. É o mesmo
raciocínio que faz a entrada `:global` do `Engine.Runners.Registry` morrer
junto com o pid. Só o papel `:runner` recebe conjunto: o socket `:web` **não
ganha `:capacidades`** e nenhuma checagem de capacidade se aplica a ele — a
aba não executa nada, ela pede.

**Recusa do join nomeia a que falta.** `{:error, %{reason: ...}}` dizendo
qual capacidade o projeto exige e que o binário precisa ser atualizado. A
recusa é **fatal do lado do runner**, sem retry (`JoinRecusadoError`,
comportamento que já existia e não mudou) — por isso ela é a única chance de
explicar, e "recusado" sem o nome do que falta obrigaria a adivinhar. A
checagem acontece **antes** de `Registry.register/2`: registrar e recusar em
seguida deixaria o `Registry` afirmando um runner que não entrou.

**E a metade que entrega valor hoje: mensagem sem a capacidade concedida é
RECUSADA com resposta nomeada, nunca engolida.** `exec` para um runner sem
`exec` responde ao chamador no **mesmo formato de `exec_result`** que o
runner mandaria (`exitCode` 126 — "encontrado, mas não executável" —, a causa
no `output`), em vez de deixar o `RunnerRouter` bloqueado até o `receive ...
after` e o usuário ver um *timeout* no lugar da causa. `pty_*` para um runner
sem `pty` não é relayado, e a `:web` que originou recebe `pty_error` nomeado,
pelo mesmo broadcast filtrado que o runner usaria para reportar erro de PTY —
sem isso a aba ficaria em "carregando" para sempre, o defeito que o `whereis`
de `handle_in("pty_open", ...)` já tinha fechado para o caso "sem runner".
Como o legado tem as duas capacidades, **nada muda para ninguém hoje**.

**Isto não é fronteira de segurança.** Capacidade é negociação de
**protocolo**; quem autoriza continua sendo o ticket de uso único
([RN-108](web.md#rn-108)) e o pipeline de
`proposed_action`. O que o runner ganha declarando é que mensagens daquele
tipo lhe sejam **entregues**, nunca permissão para nada.

- **Onde:** `apps/engine/lib/engine/runners/capacidades.ex` (novo — o
  vocabulário, o legado, o que cada modo exige e as duas mensagens);
  `apps/engine/lib/engine_web/channels/terminal_channel.ex:208`
  (`join/3` passa a receber `params`), `:215` (`autorizar_por_papel/3`),
  `:251` (`entrar_como_runner/3`, a concessão antes do `Registry`), `:305`
  (`exigencias_do_projeto/1`, que era `modo_de_execucao/1` até a RN-516 fazer a mesma consulta responder também o destino do espelho), `:595` (o gate de `exec` em
  `handle_info({:dispatch_exec, ...})`) e `:762` (o de `pty` em
  `handle_info({:relay, "pty_" <> _, ...})`);
  `apps/runner/src/channel.ts` (`CAPACIDADES_DO_RUNNER` e os params do
  `socket.channel/2`)
- **Teste:** `apps/engine/test/engine/runners/capacidades_test.exs` (novo — o
  vocabulário puro: legado, lista vazia, desconhecido ignorado, o que cada
  modo exige, e que nada exige `espelho`);
  `apps/engine/test/engine_web/channels/terminal_channel_test.exs`
  (`describe "capacidades declaradas no join (ADR 0147 ponto 1, RN-514)"` —
  concessão em `assigns`, join sem params, desconhecido ignorado, `:web` sem
  conjunto, a recusa nomeando `exec` num projeto `runner`, e as duas
  mensagens recusadas com resposta em vez de silêncio);
  `apps/runner/src/channel.spec.ts` (o CONTEÚDO dos params do join, `espelho`
  fora da lista, e a recusa virando `JoinRecusadoError` com a mensagem do
  servidor legível)
- **ADR:** [0147](../adr/0147-agente-local-com-capacidades.md), ponto 1
- **Origem:** FASE 28, sessão 5

---

## Os artefatos dos agentes viram arquivo, em `docs/` (RN-523)

### RN-523 — A pasta `docs/` é PROJEÇÃO do event log: derivada, por agente, e nunca fonte de verdade {#rn-523}

Todo artefato que os agentes produzem vive **exclusivamente no event log** —
`apps/engine/lib/engine/harness/tools/emit_artifact.ex:3-5` diz literalmente
que *"não há tabela de artefatos"*. Isso continua certo para a FONTE, e esta RN
não mexe nisso. O que ela fecha é outro buraco: essa memória não chegava a
lugar nenhum que uma pessoa abrisse. Quem abre a pasta do projeto no editor não
encontrava nada do raciocínio que produziu o código. (O **provisionamento
adiado** — criar projeto deixar de criar repositório, e o git nascer no aceite
do handoff ao Dev Lead — abre um intervalo inteiro em que o projeto não tem nem
repositório, e torna esta pasta ainda mais necessária; ele vem em PR próprio, e
esta RN não depende dele.)

Cada evento `artifact.*` de um tipo permitido vira um Markdown em
`docs/<agente>/` dentro do workspace do projeto. É **projeção derivada**, no
mesmo sentido estrito que o ADR 0101 deu ao grafo Neo4j: a fonte é o evento, a
pasta pode ser apagada inteira e reconstruída — desde a [RN-590](api.md#rn-590) por
`artefatos:reprojetar` —, e **nada no produto lê dela** para decidir coisa
alguma.

**O mecanismo é o do `GraphProjector`, copiado peça por peça** — poller
próprio, `drainOnce()` público, flag contra ciclos sobrepostos, lote de 50, e
`markProcessed` só após sucesso. A linha de outbox é uma TERCEIRA, gravada na
mesma transação do evento, sob um `aggregate_type` PRÓPRIO
(`artifact_projection`): `Engine.Outbox.Drain` só drena `session`, `task` e
`container`, e disputar a linha `'session'` seria perder a corrida contra ele
quase sempre. Uma diferença deliberada em relação ao grafo: o `aggregateId` é o
**projeto**, não a sessão — a pasta é do projeto, e gravá-lo ali poupa o
projetor de uma consulta por artefato.

**A lista é de PERMITIDOS.** Tipo de artefato novo nasce fora da projeção e
entra quando alguém decidir que ele é documento, em vez de aparecer sozinho
numa pasta que o usuário lê. Ficam de fora `qa_verdict`, `secops_verdict`,
`task_blocked` e `infra_delegation_files`: são desfechos OPERACIONAIS, e um
veredito de gate por task encheria `docs/qa-lead/` de arquivos que ninguém
abre, custando à pasta a propriedade que a torna útil — caber numa olhada.

**Versionado sobrescreve; append-only leva o `seq`.** Os quatro tipos lidos por
redução ao maior `version` (`module_map`, `module_routing`, `project_image`,
`c4_diagram`) escrevem sempre o mesmo arquivo, e a pasta mostra o vigente — o
histórico continua inteiro no event log. Os demais viram arquivo próprio com o
`seq` do evento no nome, e **sem ele** dois artefatos do mesmo tipo com o mesmo
título gerariam o mesmo arquivo, com o segundo apagando o primeiro: a única
forma de esta projeção perder informação que a fonte tem.

**Duas barreiras contra o filesystem, e a segunda não é redundante.** O nome
sai do título que o MODELO escreveu. `slugDeArquivo` **deriva** um nome de um
alfabeto fechado (nenhum caminho de retorno deixa separador sobreviver;
devolve `null` quando não sobra nada), e `FsArtifactFileStore` confere de novo
com `relative()` antes de abrir. As duas respondem perguntas diferentes — "que
nome eu derivo disto" e "o que eu vou de fato abrir" —, e confiar só na
primeira faria a segurança da escrita depender de nenhuma mudança futura de
slug jamais deixar passar um separador, que é a contenção que o ADR 0130 recusa
por princípio.

**A projeção nunca derruba a fonte.** Nenhum throw escapa do ciclo: cada item
falha isolado, fica logado e permanece `processed_at IS NULL` para o ciclo
seguinte. Diferente do grafo, **não há aqui um erro que pare o lote inteiro** —
falha de escrita costuma ser do ITEM, e parar o lote bloquearia todos atrás
dele. Evento que sumiu do event log é marcado processado, não retentado para
sempre.

**Em modo `runner` a pasta desvia para a raiz gerenciada**, pelo mesmo motivo
físico do `permissions.json` ([RN-478](api.md#rn-478)): quem escreve é a api, de
dentro do container dela, e o canal do runner só transporta comando, sem
primitiva de escrever conteúdo. Custo declarado: ali `docs/` não fica ao lado
do código.

**A escrita NÃO passa por `proposed_action`**, e não é omissão: aquele pipeline
é a origem de todo efeito externo de um AGENTE PEDINDO PARA AGIR, e aqui o
artefato já foi emitido e já está no event log. Passar a projeção pela fila
encheria as aprovações de decisões rotineiras — uma por artefato — e corroeria
o teto que dá sentido ao clique nas ações que são efeito externo de verdade.

- **Onde:** `apps/api/src/domain/artifacts/artifact-projection-events.ts` (o
  vocabulário e as regras de nome, puros);
  `apps/api/src/application/artifact-projection/artifact-projector.ts` (o
  poller); `apps/api/src/application/ports/artifact-file-store.port.ts` e
  `apps/api/src/infrastructure/filesystem/fs-artifact-file-store.ts` (a
  escrita, com a segunda barreira);
  `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`pastaDeArtefatosDoProjeto`, irmã de `permissionsFilePath`);
  `apps/api/src/application/use-cases/sessions/append-session-event.use-case.ts`
  (a terceira linha de outbox)
- **Teste:** `apps/api/test/domain/artifacts/artifact-projection-events.spec.ts`
  (as regras de nome, o traversal e a colisão por `seq`) e
  `apps/api/test/application/artifact-projection/artifact-projector.spec.ts`
  (caminho feliz, versionado sobrescrevendo, e a degradação: falha deixa a
  linha não processada, o ciclo seguinte retenta, uma falha não bloqueia o
  lote, evento sumido não é retentado para sempre, reprocessar é idempotente)
- **ADR:** [0148](../adr/0148-artefatos-projetados-em-arquivo.md)
- **Origem:** pedido do dono do produto — *"criar apenas uma pasta por ora
  chamada docs, onde os artefatos estarão de cada um dos agentes"*

## A revogação de chave de dispositivo deixa de ser cega, e alcança a conexão viva (RN-519..520)

### RN-539 — `assess_implementability` dispara o threat model de DESIGN em PARALELO, e uma vez só por story {#rn-539}

O appsec (`Engine.Gates.SecOpsAgentServer.run_design/2`, [RN-360](#rn-360))
nasceu implementado, testado e **sem chamador de produção nenhum**: a única
menção fora de teste era um comentário em `artifact_schemas.ex`. A própria
[RN-360](#rn-360) declarava a lacuna, e `packages/contracts/fluxo.yml` (papel `appsec`,
campo `acionamento`) já NOMEAVA o gatilho que faltava — `assess_implementability`
do Dev Lead, gate `implementavel`, o mesmo [ADR 0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md).
Era ele. `run_assessment/2` passa a chamá-lo por
`Engine.Gates.Dispatcher.run_appsec_design/2` — sexto callback do behaviour,
CÓPIA estrutural de `run_qa_estrategia/3` e trocável em teste pelo mesmo
motivo dos cinco vizinhos (o chamador é exercitado por um teste leve, sem
sandbox Ecto, e não deveria subir um GenServer real só para provar que
PEDIU).

**Em paralelo, e o parecer não espera.** O disparo acontece nas DUAS saídas
de `run_assessment/2` — com plano de teste e sem — e o desfecho de cada uma
fica byte a byte como era. Fazer o parecer depender do threat model faria o
gate `implementavel` depender de DUAS produções assíncronas em vez de uma, e
queimaria dois turnos do Dev Lead onde hoje se queima um: o ramo `:sem_plano`
já devolve `{:error, ...}` pedindo ao modelo que chame de novo
([RN-163](#rn-163)), e uma segunda espera empilhada nele multiplicaria a
janela. O threat model chega a quem precisa pelo caminho que a
[RN-361](#rn-361) já definiu — handoff para `arquiteto`, `dev-lead` e
`infra` —, nunca por este retorno; a mensagem do `:sem_plano` sequer menciona
o appsec, porque prometer ao modelo algo que ele não vai receber ali é o
defeito que a [RN-163](#rn-163) fecha.

**Desde a [RN-674](#rn-674) não há mais `:sem_plano`**: o parecer sai na
primeira chamada, o disparo do appsec acompanha a proposta, e a leitura do
histórico serve só à guarda abaixo. O appsec segue no DESIGN — a decisão do
dono que tirou o plano de teste do pre-dev foi sobre o QA.

**E uma vez só por story.** O modelo é INSTRUÍDO a chamar
`assess_implementability` de novo enquanto o plano de teste não existe: sem
guarda, cada rechamada custaria outra rodada de LLM do appsec e mais três
handoffs sobre a MESMA story. `disparar_appsec_se_preciso/3` só dispara
quando não há `artifact.threat_model` daquela `storyId` no histórico. A
pergunta aqui é EXISTE, não QUAL — o oposto do plano de teste, onde o mais
recente vence porque uma story pode ser reavaliada.

A leitura do event log é **uma** por chamada: as duas perguntas ("já há plano
de teste?", "já há threat model?") são respondidas sobre a mesma lista. Dois
`list_events/2` na mesma invocação seriam o amplificador de tráfego que o
[ADR 0060](../adr/0060-superficie-de-leitura-de-codigo.md) recusa, e este caminho é
quente justamente por causa da retentativa. Histórico ILEGÍVEL não dispara
nada: ausência de resposta não é prova de ausência de artefato, e disparar ali
reabriria a rechamada por outra porta. A cláusula de args inválidos também não
dispara — ela não sabe qual é a story.

- **Onde:** `apps/engine/lib/engine/agents/dev_lead_tools.ex:457`
  (`run_assessment/2`, a leitura única do histórico) e `:519`
  (`disparar_appsec_se_preciso/3`, a guarda de idempotência);
  `apps/engine/lib/engine/gates/dispatcher.ex:29` (o callback) e `:86`
  (`Engine.Gates.Dispatcher.Live.run_appsec_design/2`);
  `apps/engine/test/support/fake_gate_dispatcher.ex:23`
- **Teste:** `apps/engine/test/engine/agents/dev_lead_tools_test.exs`,
  describe "assess_implementability dispara o appsec (RN-539)" — story sem
  threat model dispara, story com threat model NÃO dispara (a idempotência),
  threat model de outra story não conta, o desfecho de `:sem_plano` não muda,
  o parecer é proposto normalmente ao lado do disparo, args inválidos e
  histórico ilegível não disparam
- **ADR:** [0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md)
  (que declarava o gatilho automático como fora de escopo)
- **Origem:** `packages/contracts/fluxo.yml`, papel `appsec`. Fica declarado e NÃO feito:
  `artifact.threat_model` é emitido na sessão da STORY
  (`emit_threat_model/3` lê `story["sessionId"]`), enquanto a guarda lê o
  histórico da sessão do DEV LEAD. No caminho comum são a mesma sessão — o
  Dev Lead avalia stories que a própria sessão de execução criou. Não sendo,
  a guarda não enxerga o threat model e o appsec roda outra vez: custo de uma
  rodada de LLM repetida, nunca dado errado (o artefato é append-only e quem
  o consome é o handoff). Fechar isso exigiria a api aceitar busca de
  artefato por story ATRAVÉS de sessões, que hoje não existe

## A flag que liga um agente tem de CHEGAR ao processo (RN-540)

### RN-540 — Flag booleana lida pelo `runtime.exs` é mapeada no `environment:` do serviço `engine` dos dois composes, com o default do código {#rn-540}

Uma pausa só é reversível se existir o caminho de ligar. A da Anamnese e a do
Psicólogo ([RN-115](#rn-115),
[RN-117](#rn-117)) foram declaradas reversíveis
em TRÊS lugares — o docblock de `AnamneseSchedulerWorker.enabled?/0` ("Ligar de
volta é `ANAMNESE_ENABLED=true` e reiniciar o engine"), o de
`PsychologistWorker.enabled?/0` e a tabela de
[configuração](../reference/configuration.md) — e o caminho **não existia em
ambiente nenhum**.

**Medido, não hipótese.** Com o compose de dev de pé:

```
$ docker compose … exec -T engine sh -lc \
    'echo "[$START_ANAMNESE] [$ANAMNESE_ENABLED] [$PSYCHOLOGIST_ENABLED]"'
[true] [] []
```

A causa é a camada que só o Compose tem: **ele não repassa o ambiente do host
ao container**. Uma variável chega ao processo se, e só se, estiver escrita no
`environment:` (ou num `env_file`) daquele serviço. O `engine` mapeava TREZE
variáveis de Anamnese/Psicólogo — todas TETOS de custo
(`ANAMNESE_INTERVAL_SECONDS`, `ANAMNESE_BUDGET_MICROS`,
`PSYCHOLOGIST_TRIAGE_THRESHOLD`, …) — e nenhuma das duas que decidem se os
agentes rodam. `ANAMNESE_ENABLED=true` no `.env` era inerte:
`apps/engine/config/runtime.exs` caía no default `"false"` e os dois seguiam
desligados **em silêncio, sem erro**.

Origem provável do defeito: quando o default do código virou `false`
(2026-08-10), ninguém precisou da variável para DESLIGAR. Só quem tenta LIGAR
descobre que o fio não existe — e essa pessoa, por construção, aparece meses
depois.

**A regra.** Toda flag BOOLEANA que o `runtime.exs` lê — a forma
`System.get_env("X", "true"|"false") == "true"` — tem de estar mapeada no
`environment:` do serviço `engine` dos dois composes. O recorte é o das
booleanas e não o das 58 variáveis do arquivo porque uma flag existe
exatamente para ser virada, e a virada acontece pelo ambiente: flag sem linha
no compose é interruptor sem fio. Teto numérico com default bom
(`READ_FILE_MAX_BYTES`) e variável de release (`SECRET_KEY_BASE`, `POOL_SIZE`)
ficam legitimamente de fora, e é por isso que a lista é DERIVADA do
`runtime.exs` em vez de mantida à mão.

O default difere por arquivo, e a diferença é a decisão:

- em `docker/docker-compose.yml` (dev) a linha repete o default do CÓDIGO. Dev
  é onde a promessa dos docblocks é exercida, e um default divergente ali faria
  o compose decidir produto por baixo do `runtime.exs`.
- em `docker/docker-compose.prod.yml` basta estar mapeada. Aquele arquivo
  desliga os agentes de fundo de propósito (`START_ANAMNESE:-false` contra o
  `true` do código), com o motivo escrito ao lado — cobrar igualdade
  reprovaria uma decisão consciente.

**Isto NÃO muda decisão de produto nenhuma.** As duas flags continuam
`false` por default nos dois composes: a pausa de 2026-08-10 segue valendo,
byte a byte. O que passou a existir é o interruptor.

**E `ANAMNESE_ENABLED=true` sozinho não basta.** `START_ANAMNESE` (chave de
BOOT, `apps/engine/lib/engine/application.ex:82,106-108`) decide se o `kickoff/0` que
AGENDA o tick periódico é chamado; `ANAMNESE_ENABLED` (flag de PRODUTO) decide
se uma rodada NOVA pode acontecer. São perguntas diferentes, e a Anamnese
periódica exige as duas em `true`. O Psicólogo tem só a segunda — o gatilho
automático dele é o fechamento de sessão, não um tick.

**`deploy/k8s/` fica de fora, e por decisão.** Lá não existe a camada que
quebra: um Deployment/ConfigMap não intercepta nada, e a variável é escrita
onde toda variável é escrita. O `brabo-config` tem QUATRO literais (endereços
de serviço e nível de log do web), sem nenhum dos 13 tetos nem
`START_ANAMNESE` — o engine roda com os defaults do código, coerentemente.
Não há interruptor sem fio a consertar ali.

- **Onde:** `docker/docker-compose.yml:406-425` (as quatro chaves de boot e as
  quatro flags de produto, no bloco de cada agente);
  `docker/docker-compose.prod.yml:308-315`;
  `apps/engine/config/runtime.exs:157,158,162,168,185,229,238,264` (as oito
  flags); `.env.example` (as duas perguntas, lado a lado)
- **Teste:** `scripts/ci/flags-do-engine-no-compose.spec.ts` — deriva as flags
  do `runtime.exs` e reprova nomeando a que faltar em qualquer dos dois
  composes, e a que divergir do default do código no de dev. `warn` nenhum:
  reprova mesmo, no job `test-packages`
- **Origem:** achado por medição direta no container do engine, 2026-09-08.
  Fica declarado: a lista de exceções `FLAGS_FORA_DO_COMPOSE` nasce VAZIA — ela
  existe para que "fora por decisão" tenha onde ser dito, e não vire
  indistinguível de "fora por esquecimento"

---

## A chave de dispositivo ganha tela, e a tela diz o alcance de revogar (RN-561)

### RN-566 — O Infra Lead recusa `container_start` por MODO antes de propor: a lacuna da RN-494 fecha na tool que a declarava {#rn-566}

`propose_container_start` propunha às cegas. `dispatch_container_start/2`
montava o payload e chamava `EngineApiClient.propose_action(...)` direto — sem
uma leitura de projeto entre uma coisa e outra, e com **zero** ocorrências de
`execution_mode` na tool inteira. Num projeto `runner` a proposta só podia
terminar em falha: desde a [RN-507](runner.md#rn-507)/[ADR 0145](../adr/0145-docker-pre-requisito-do-runner.md)
`container_start` **não atende** esse modo, porque o payload dela ELEGE uma
candidata do roteamento do Arquiteto ([ADR 0131](../adr/0131-roteamento-de-modulos-para-infra.md))
e em `runner` não há roteamento contra o qual eleger — o tipo daquele modo é
[`container_start_via_runner`](api.md#rn-508).

**A régua não é nova, e não nasceu uma segunda.** A tool irmã já recusava
localmente ([RN-508](api.md#rn-508)) e a página `/containers` já ramificava por
DESTINO ([RN-521](api.md#rn-521), `acaoDeSubidaDoModo`): `container` e `mounted`
sobem pelo BROKER, `runner` sobe pelo agente local ([ADR 0144](../adr/0144-a-segunda-raiz-do-broker.md)/[RN-503](api.md#rn-503)).
O que esta regra faz é dar à tool que faltava a MESMA régua — uma leitura de
projeto (`recusa_local_de_subida/2`, que devolve `nil` ou motivo) e uma
CLÁUSULA por tool (`recusa_por_modo/3`). Duas réguas paralelas divergiriam no
primeiro modo novo do enum.

**A recusa de `container_start` é lista de PERMITIDOS**, como a do próprio
broker: `container`/`mounted` passam, `runner` é recusado NOMEANDO a tool
irmã, e modo novo no enum nasce recusado com mensagem em vez de proposto por
omissão. Projeto inexistente também recusa — mesma cláusula das duas tools.

**A recusa é ENTRADA do laço** ([RN-163](#rn-163)): texto de RESULTADO de
ferramenta, que o modelo lê e usa para chamar a tool certa. Nunca
`agent.error`, nunca fim de turno, nunca `proposed_action` — a api não é
chamada. E **não é silêncio**: o `emit` do `tool.call` passou a acontecer
ANTES da recusa nas DUAS tools (na irmã ele estava dentro do ramo que propõe),
como no `dispatch_tool/2` genérico do mesmo módulo — recusa sem rastro no
event log é a chamada sumindo do timeline do humano.

**As leituras são LOCAIS, e isso é a decisão.** `Project.get/1` e
`Engine.Runners.Registry.connected?/1` rodam no MESMO processo BEAM do Infra
Lead; um HTTP à api aqui poria uma chamada de rede dentro do laço do agente.
O custo declarado no `CLAUDE.md` — *"corrigir exigiria tocar o
prompt/instrução do Infra Lead"* — **não se confirmou**: nenhuma linha de
prompt mudou, e o texto da recusa é o que o modelo lê como resultado.

**O que esta regra NÃO fecha, e é metade da lacuna:** a proposta cega por
AUSÊNCIA DE IMAGEM continua possível em `container`/`mounted`. A recusa aqui é
sobre MODO, e exigir imagem decidida inverteria a ordem — eleger a imagem é
justamente o que essa proposta FAZ ([RN-491](web.md#rn-491)). A `/containers` checa
as TRÊS coisas (imagem decidida, modo, pasta confirmada) porque tem um humano
clicando; o agente passa a checar UMA. `GetInfraContextUseCase` segue sem
`executionMode` — enriquecer o contexto do Infra Lead é frente à parte.
`container_stop`/`container_remove` não entram: são propostas pela tela, nunca
por agente ([RN-495](api.md#rn-495)).

Nenhum teto muda: `container_start` segue `proposed_action` de verdade,
`maintainer`, nunca semeada em auto-aprovação (até a [RN-671](api.md#rn-671), que a
semeia no aceite do handoff da Infra), e `container_remove` segue no
teto absoluto de git push/comando privilegiado ([RN-418](api.md#rn-418)).

- **Código:** `apps/engine/lib/engine/infra/infra_lead_server.ex:599` (o
  dispatch de `container_start` consultando antes de propor), `:889`
  (`recusa_local_de_subida/2` — a leitura ÚNICA do projeto), `:474` (a
  cláusula de `container_start`: lista de permitidos), `:477` (a recusa
  nomeando `container_start_via_runner`), `:492` (a cláusula da irmã, com a
  segunda pergunta — runner conectado), `:409` (o `emit` do `tool.call`
  movido para antes da recusa);
  `apps/engine/lib/engine/infra/tools/propose_container_start.ex`
  (moduledoc — a tool deixou de propor às cegas)
- **Teste:** `apps/engine/test/engine/infra/infra_lead_server_test.exs:422`
  (caminho feliz em `mounted` — o broker atende os dois), `:448` (caso de
  falha: `runner` recusa NOMEADO, `propose_action` nunca chamada, o `tool.call`
  narrado mesmo assim), `:538` (projeto inexistente), `:380` (o caminho feliz
  de `container`, que passou a exigir a linha no banco)
- **ADR:** [0144](../adr/0144-a-segunda-raiz-do-broker.md),
  [0145](../adr/0145-docker-pre-requisito-do-runner.md)
- **Origem:** AT-048 (EP-020/HS-032) — a lacuna declarada no `CLAUDE.md` desde
  a [RN-494](broker.md#rn-494)

## O broker de container na instalação, com consentimento (RN-575)

### RN-577 — `open_adr_pr` e `open_infra_pr` são recusadas pelo agente, antes de propor, quando o projeto não tem repositório {#rn-577}

Numa instalação real (AT-088, 2026-09-14), um projeto sem repositório —
`project_repositories`, `project_git_connections` e `repo_bootstraps` vazias —
recebeu três `open_adr_pr` do Arquiteto e uma `open_infra_pr` do Infra Lead. O
humano aprovou as quatro, e as quatro terminaram `failed` com *"Projeto sem
repositório provisionado"* (`ExecuteAdrPrUseCase`, `ExecuteInfraPrUseCase`).
A pessoa aprovou quatro ações que só podiam falhar.

**Não é borda, é o caso comum.** Desde a [RN-541](web.md#rn-541) criar um projeto
não cria repositório, e o gatilho do repositório é o aceite do handoff do
Arquiteto para o Dev Lead ([RN-522](api.md#rn-522)). O Arquiteto trabalha ANTES desse
handoff — então num projeto novo **todo** `open_adr_pr` falhava por
construção.

**A regra:** as duas tools perguntam, ANTES de propor, se o projeto tem
repositório, e sem ele RECUSAM com motivo NOMEADO — o que falta, e quando passa
a existir. A `proposed_action` não nasce, e a fila de aprovação não recebe o
que não pode dar certo.

**O molde é o da [RN-566](#rn-566), sem régua nova e sem tocar prompt.** A
recusa é resultado de ferramenta ([RN-163](#rn-163)),
entrada do laço — nunca `agent.error`, nunca fim de turno —, e o modelo segue
o turno lendo o motivo.

**A leitura é LOCAL, e o predicado é o MESMO da execução.** O engine já lia
`project_repositories` direto do Postgres (`Engine.Projects.ProjectRepository`,
os consumidores de `default_branch/1` e `remoto_de_trabalho/1`), então não
houve HTTP no laço do agente a medir nem a justificar: a pergunta nova,
`recusa_de_pr_sem_repositorio/2`, é a MESMA que
`ProvisionedRepositoryRepository.findByProjectId` faz nos dois casos de uso —
existe linha para o projeto. Se os dois divergissem, a tool deixaria passar o
que a execução recusa, ou recusaria o que ela aceitaria. As duas tools usam a
MESMA função, com o mesmo texto.

**No Infra Lead a pergunta vem antes do HALT.** `propose_infra_pr` não propõe
na hora: ela interrompe o turno para `finalize/3` rodar o `WorkflowsAgent` e
consolidar numa PR só. Recusar depois disso (em `abrir_pr/3`) teria gastado um
laço de LLM inteiro e registrado duas delegações `completed` para uma PR que
não pode existir. A recusa acontece na interceptação, e o turno CONTINUA.

**Rastro durável nas duas.** A AT-048 achou que recusa local não deixava rastro
no event log; a RN-566 resolveu emitindo o `tool.call` antes da recusa, e aqui
vale o mesmo — no Arquiteto o `dispatch_tool/2` já o emitia; no Infra Lead a
interceptação de `propose_infra_pr` não emitia nada e passa a emitir, no ramo
da recusa, com o título e os CAMINHOS (nunca o conteúdo dos arquivos). E o
PORQUÊ vai junto: um `tool.result` com `ok: false` e `erro` com o motivo — a
forma que o Criativo já usa —, porque só o `tool.call` diria que a chamada
existiu, não por que ela não virou proposta. No caminho que propõe nada muda:
o rastro dele continua sendo a própria `proposed_action`.

**Os casos de uso de execução continuam recusando como antes** — defesa em
profundidade: a recusa do agente é uma camada ANTES, nunca no lugar.

**O que esta regra NÃO decide:** ONDE o repositório deveria nascer. O texto da
recusa descreve o gatilho vigente, e ele MUDOU: a AT-092 foi decidida na
[RN-582](api.md#rn-582) (ADR 0165) — o repositório nasce no aceite do handoff AO
Arquiteto, antes do primeiro turno dele, com o aceite ao Dev Lead como segunda
porta. O texto mudou junto, como esta regra prometia: ele nomeia o gatilho
novo e, como o Arquiteto só trabalha depois desse aceite, diz que a recusa
significa provisionamento FALHADO (o `repository.provision_failed`) ou projeto
anterior à regra, com as duas saídas. Deixou de ser o caso comum; a recusa
continua, porque essas duas situações existem. A `open_infra_pr` também é afetada no projeto novo por outro
caminho (o Infra Lead é acionado pelo handoff do Arquiteto, que pode acontecer
antes do handoff ao Dev Lead); esta regra só faz a proposta não nascer, não
reordena os handoffs.

- **Código:** `apps/engine/lib/engine/projects/project_repository.ex:74`
  (`recusa_de_pr_sem_repositorio/2` — o predicado e o texto, únicos para as
  duas tools); `apps/engine/lib/engine/harness/tools/propose_adr.ex:54` (a
  recusa antes de propor), `:61` (o `tool.result` com o motivo);
  `apps/engine/lib/engine/infra/infra_lead_server.ex:251` (a interceptação de
  `propose_infra_pr` perguntando antes do HALT), `:632`
  (`recusa_de_infra_pr/4`), `:309` (o `tool.call` com os caminhos), `:314` (o
  `tool.result`)
- **Teste:** `apps/engine/test/engine/agents/arquiteto_server_test.exs:107`
  (caso de falha: sem repositório, `open_adr_pr` nunca proposta, motivo como
  resultado de ferramenta, `tool.call` e `tool.result` no event log), `:80`
  (caminho feliz: com repositório, propõe);
  `apps/engine/test/engine/infra/infra_lead_server_test.exs:491` (caso de
  falha: sem repositório, nem `propose_action` nem delegação do Workflows, o
  turno segue, rastro durável), `:89` (caminho feliz: com repositório, a PR
  consolidada é proposta)
- **Origem:** AT-088 — instalação real em 2026-09-14

### RN-578 — O clique que dispara turno de agente responde ao ACEITAR, e a recusa deixa de ser calada {#rn-578}

Numa instalação real da v6.1.0 (2026-09-14), responder o formulário de
perguntas do Criativo levou **97,3 s**, confirmar a prontidão **97,3 s** e
confirmar a arquitetura pronta **51,8 s** — cada clique segurado pelo turno
INTEIRO do agente, porque o `handle_call` do conversacional só respondia ao
`GenServer.call` do controller do engine quando a Task do turno terminava. Turno
acima do teto (120 s no Criativo, 180 s nos outros) virava 500 num comando que
tinha funcionado. E a recusa de uma segunda mensagem com turno em curso
(`{:error, :turno_em_andamento}`) era descartada pelo controller, que respondia
202: um *"Continue"* digitado durante o kickoff do Arquiteto foi aceito e nunca
lido, sem rastro nenhum.

**A regra ([ADR 0163](../adr/0163-o-clique-responde-ao-aceitar.md), que generaliza
o [ADR 0086](../adr/0086-dev-lead-plano-suspende-para-aprovacao.md)):**

1. **O aceite sai na hora.** `TurnoAssincrono.iniciar/3` responde `:ok` ao
   `from` assim que a Task sobe — depois de persistir `agent.status: working`,
   nunca antes. Vale para os seis conversacionais e para as quatro rotas de
   usuário que disparam turno (`…/agents/:agent/message` e, por ela,
   `…/structured-question/:id/answer`; `…/readiness`;
   `…/agents/arquiteto/handoff-infra`) e para a devolução de história
   (`ReturnStoryUseCase`). O status e o corpo da api NÃO mudam
   (`201 { ok: true }`): sempre significaram "aceito"; o que mudou foi quando
   chegam.
2. **A recusa ANTES de o turno subir é síncrona e nomeada.** O engine responde
   409 (`turno_em_andamento`, `aguardando_aprovacao`) ou 422
   (`sem_regra_de_negocio`) com `{error, motivo}`, e a api repassa o MESMO
   status com a MESMA frase. `turno_em_andamento` ganha `agent.error` durável
   (origem `politica`); os outros dois já tinham.
3. **O desfecho do turno segue pelo canal e pelo log, nunca pelo HTTP.** Falha
   continua `agent.error` durável, com a mesma origem de antes.
4. **A tela deixa de tratar "a chamada resolveu" como fim de turno.** Depois do
   aceite, ela acompanha o fim pelo canal (`agent.done`) e, como rede de
   segurança, pela cauda do log a cada 4 s: fecha quando o `agent.status`
   persistido mais recente daquele agente não é `working`. Sem nenhum
   `agent.status` do agente na janela, não fecha — não saber não é "acabou".
5. **O handoff ao Dev Lead continua nascendo DEPOIS do de Infra.** O
   `:offer_dev_handoff` que chega com o turno de fechamento do Arquiteto em
   curso fica pendente e roda quando o turno fecha — sucesso, falha, crash ou
   cancelamento. *(Superado pela [RN-672](api.md#rn-672): o Arquiteto não oferece
   mais ao Dev Lead, e a pendência deixou de existir.)*

**O que esta regra NÃO fecha:** o `chat.message` que a api grava antes de
perguntar ao engine continua no log quando o engine recusa (agora explicado pelo
`agent.error`, antes órfão e mudo); engine reiniciado no meio do turno não grava
`idle`, e a faixa fica até o "Parar" ou um recarregamento; e mensagem ao
`infra` pelo compositor caía no Criativo pela cláusula final de
`AgentCommandController.message/2` — pré-existente, medido aqui e fechado
depois pela [RN-584](#rn-584), que tirou o destinatário padrão.

**Revisada para a MENSAGEM pela [RN-673](#rn-673)** (ADR 0191): a mensagem do
usuário que chega com turno em curso não recebe mais `turno_em_andamento` —
entra na fila do agente e é lida no fim do turno. A recusa do item 2 segue
valendo para os comandos que não são fala (revisão, prontidão, oferta de
handoff).

- **Código:** `apps/engine/lib/engine/agents/turno_assincrono.ex:120` (o
  aceite), `:130` e `:314` (a recusa durável);
  `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:241`
  (202), `:243`/`:253`/`:263` (409/409/422);
  `apps/engine/lib/engine/agents/dev_lead_server.ex:211`;
  `apps/engine/lib/engine/agents/arquiteto_server.ex:160` (adiar), `:202`
  (drenar); `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts:591`,
  `:612`; `apps/web/src/lib/session-turno.ts:33` (`turnoTerminouNoLog`),
  `:349` (`acompanharTurnoPeloLog`), `:316`;
  `apps/web/src/routes/SessionPage.tsx:491`, `:517`, `:578`;
  `apps/web/src/lib/session-promocao.ts:141`;
  `apps/web/src/lib/recusa-do-agente.ts:17`
- **Teste:** `apps/engine/test/engine/agents/turno_assincrono_test.exs:66`
  (aceite com a task viva), `:84` (`working` gravado antes do aceite), `:178`
  (recusa durável — caso de falha);
  `apps/engine/test/engine_web/controllers/agent_command_controller_test.exs:35`,
  `:66` (409), `:107` (422);
  `apps/engine/test/engine/agents/arquiteto_server_test.exs:209` (ordem dos
  handoffs), `:237` (cancelamento);
  `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts:520`,
  `:538`, `:580` (500 continua genérico);
  `apps/web/src/routes/SessionPage.turno-preso.test.tsx:181`, `:252` (409);
  `apps/web/src/routes/SessionPage.readiness-turno-preso.test.tsx:172`, `:210`
  (422); `apps/web/src/lib/fim-do-turno-pelo-log.test.ts:29`, `:76`
- **Origem:** AT-089 — instalação real da v6.1.0 em 2026-09-14

### RN-579 — Com o canal da sessão vivo, a tela de Sessão troca o poll curto por invalidação e um fallback longo; resposta de corpo vazio tem `ETag` {#rn-579}

A instalação medida na AT-093 (v6.1.0, 14/09) mostrou UM navegador fazendo
7.088 requisições em 56 minutos — mediana de 118/min, pico de 263/min —
contra os 300/min do `RATE_LIMIT_USER`. Duas abas visíveis no pico passam do
teto, e o 429 cai no navegador do dono da conta. Quase tudo era poll de 3–5s
da tela de Sessão sobre dados que mudam raro (ações, handoffs e backlog
voltavam 304 em 99% das vezes), enquanto a tela já mantinha aberto o canal
`session:<id>` com o engine. O teto NÃO muda: o que cai é o pedido.

**A regra:**

1. **O engine avisa toda escrita confirmada.** A fachada
   `Engine.Sessions.EngineApiClient` emite `event.appended` (só `type` e
   `actorId`, nunca o `payload`) depois que a api CONFIRMA `append_event`,
   `append_event_returning`, `propose_action` (`proposed_action.created`),
   `create_handoff` (`handoff.offered`) e `create_epic/story/task`
   (`backlog.*_created`). Escrita recusada não avisa. Antes, só
   `ArtifactEmitter` e o Infra Lead avisavam, à mão — e avisavam mesmo quando a
   api recusava o append. **Desde a AT-157, a escrita que a API faz por conta
   própria também avisa** — a decisão de um humano noutra aba, uma transição de
   sessão, o chat respondido pelo modelo da própria api. `AppendSessionEventUseCase`
   e o `SendChatMessageUseCase` (os dois únicos pontos que gravam em
   `session_events` sem passar pelo engine) chamam
   `SessionChannelNotifier.eventAppended`, que pede ao engine
   `POST /internal/sessions/:id/event-appended`; o engine faz o MESMO
   `event.appended` (só `type` e `actorId`). O aviso sai DEPOIS do commit da
   transação mais externa (`aposCommit` no `DrizzleUnitOfWork`): transação
   desfeita não avisa, e avisar de dentro dela faria a web buscar antes de o
   evento existir. Escrita que veio do engine (rota `/internal/*`, marcada pelo
   `OrigemEngineMiddleware`) NÃO é avisada de novo pela api — a fachada já
   avisou. É melhor esforço e não é aguardado: o aviso perdido nunca falha a
   escrita, e o fallback de 15s o cobre. São só os dois pontos: outro caso de
   uso que passe a gravar em `session_events` sem `AppendSessionEventUseCase`
   precisa chamar o notifier também.
2. **"Canal vivo" é join CONFIRMADO.** `connectSessionHeartbeat` marca a sessão
   viva no `ok` do join e a desmarca em erro/fechamento do canal ou do socket e
   no cleanup. O estado é por sessão e por aba, fora do React, porque o
   intervalo é de cada OBSERVADOR e três observadores (Shell, `SessionPage`,
   `ContextAside`) leem a mesma chave de eventos.
3. **Com o canal vivo, o poll vira fallback.** Eventos, ações, handoffs,
   backlog e a própria sessão passam de 3–5s para 15s; o orçamento, de 5s para
   30s. `intervaloDaSessao` é `Math.max`: quem já pollava mais devagar não
   acelera. Canal caído devolve o intervalo curto NA HORA — a tela nunca fica
   pior do que era.
4. **O TIPO do aviso decide o que invalidar, com janela.** Todo aviso
   invalida os eventos e o orçamento; `proposed_action.*`/`action.*` também as
   ações, `handoff.*` os handoffs, `backlog.*` o backlog. Cada alvo tem janela
   mínima entre duas buscas (eventos 3s, ações/handoffs/backlog 2s, orçamento
   10s): a primeira sai na hora, as seguintes dentro da janela viram UMA no fim
   dela. Sem isso, uma rajada de `tool.result` viraria uma busca por evento. A
   regra do achado C segue, e só para os EVENTOS: durante um turno em
   streaming eles não são antecipados; as ações são.
5. **Aba oculta não polla.** `refetchIntervalInBackground: false` (o default do
   TanStack v5, agora escrito em `OPCOES_PADRAO_DAS_QUERIES`) — medido por
   teste, não suposto.
6. **Corpo vazio tem validador.** Handler que devolve `null` saía com corpo
   vazio e SEM `ETag` (o `res.send` do Express só gera `ETag` com corpo), então
   o 304 era impossível: `sessions/:id/budget` voltou 304 em 0% das 483
   chamadas medidas e `execution/session` em 22% (o tempo com execução ativa).
   A api grava o `ETag` do corpo vazio quando `send` sai sem corpo — decidido
   sobre o que vai ao fio, não sobre o valor do handler, para que um handler
   com `@Res()` que escreve depois nunca herde o validador do vazio. 304 NÃO
   reduz a contagem do rate limit (o guard conta antes do handler); reduz banda.
7. **Compõe com o acompanhamento do turno pela cauda do log ([RN-578](#rn-578)).**
   O turno ACEITO continua sendo acompanhado pela leitura da cauda a cada 4s
   (`acompanharTurnoPeloLog`) — é a rede contra o `agent.done` perdido, e o
   aviso do canal pode se perder junto com ele, então o tique NÃO vira
   fallback de 15s. O que muda: o `event.appended` do `agent.status` do agente
   ACOMPANHADO roda a leitura NA HORA (`avisoPedeVerificacaoDoTurno`), e o
   turno fecha assim que o log diz que fechou, sem esperar o tique. Aviso de
   outro agente, de outro tipo, ou sem turno acompanhado não lê nada a mais. E
   o poll de 3s dos eventos continua PAUSADO durante o streaming (achados 2/7):
   `intervaloDaSessao` só vale quando a pausa não vale, e a invalidação pelo
   canal respeita a mesma regra do achado C.

**Números** (teste de orçamento, uma aba na tela de Sessão, por minuto):
**123** com o canal caído (o comportamento de antes, intacto como fallback) e
**46** com ele vivo — dos quais 24 são do Shell (resumo dos projetos e sessão
de execução, que não são da sessão e seguem em 5s). Duas abas: 246 → 92.
Desde a [RN-632](web.md#rn-632) (AT-278) as leituras de PROJETO pollam no ritmo de
projeto (15s) e as abas Executores e Visão geral passam pelo MESMO
`criarInvalidadorDoCanal` — a medição com as telas de verdade e duas abas mora
lá.

**O que esta regra NÃO fecha:** o aviso da escrita que a api faz por conta
própria (item 1, AT-157) é melhor esforço — se o engine estiver fora ou o
aviso se perder, a tela chega pelo fallback, em até 15s (eram 3s); o aviso vai
ao nó do engine que recebeu a chamada, e o broadcast do Phoenix PubSub o
entrega aos inscritos de qualquer nó do cluster (não medido em cluster). O status
`working` do roster continua dependendo do `event.appended` do `agent.status`,
que sai depois de a api gravá-lo. `projects-summary` e `execution/session`
(Shell) seguem em 5s. Durante um turno aceito, a leitura da cauda de 4s da
RN-578 soma até 15 req/min, só enquanto o turno dura. Não é mudança de modelo de consistência (sem ADR): a
fonte continua sendo o GET, o canal continua sendo só gatilho — como já era
desde a Fase 4a —, e o que muda é a latência máxima das escritas sem aviso.

- **Código:** `apps/engine/lib/engine/sessions/engine_api_client.ex:581`,
  `:607`, `:630`, `:1101` (`avisar_canal`);

  `:607`, `:630`, `:953` (`avisar_canal`);
  `apps/engine/lib/engine/sessions/live_broadcast.ex` (`event_appended/3`);
  `apps/engine/lib/engine_web/controllers/session_command_controller.ex:46`
  (`event_appended`, a rota do aviso da api);
  `apps/api/src/application/use-cases/sessions/append-session-event.use-case.ts:225`
  (`eventAppended`);
  `apps/api/src/infrastructure/persistence/drizzle/drizzle-context.ts:39`
  (`aposCommit`), `:53` (`veioDoEngine`);
  `apps/web/src/lib/canal-vivo.ts:35` (fallback), `:66` (estado), `:108`
  (`intervaloDaSessao`), `:134` (`alvosDoEvento`), `:150` (janelas), `:207`
  (`criarInvalidadorDoCanal`); `apps/web/src/lib/session-channel.ts:161`,
  `:165`, `:131`, `:229`; `apps/web/src/lib/session-turno.ts:414`
  (o aviso: invalida e, do acompanhado, antecipa a leitura), `:86`
  (`avisoPedeVerificacaoDoTurno`), `:344` (a leitura imediata);
  `apps/web/src/lib/hooks.ts` (`useSessionEvents`, `usePendingActions`,
  `useHandoffs`, `useBacklog`); `apps/web/src/lib/query-policy.ts:86`;
  `apps/api/src/interfaces/http/shared/etag-do-corpo-vazio.ts:40`;
  `apps/api/src/main.ts:80`
- **Teste:** `apps/web/src/lib/canal-vivo.orcamento.test.tsx:138` (antes, 123),
  `:155` (depois, 46), `:176` (canal cai — caso de falha), `:186` (rajada),
  `:214` (aba oculta); `apps/web/src/lib/session-channel.test.ts:237`, `:253`
  (queda — caso de falha), `:267`;
  `apps/engine/test/engine/sessions/engine_api_client_aviso_no_canal_test.exs:29`,
  `:57` (append recusado não avisa — caso de falha), `:71`;
  `apps/api/test/application/use-cases/sessions/aviso-ao-canal-da-sessao.spec.ts`
  (AT-157: avisa com tipo e ator; recusada não avisa e transação desfeita não
  avisa — casos de falha; engine fora do ar não falha a escrita; escrita vinda
  do engine não é avisada em dobro),
  `apps/api/test/infrastructure/http-clients/origem-engine.middleware.spec.ts`,
  `apps/engine/test/engine_web/controllers/session_command_controller_event_appended_test.exs`;
  `apps/api/test/interfaces/http/shared/etag-do-corpo-vazio.spec.ts:56` (a
  causa), `:69`, `:98` (`@Res()` tardio — caso de falha);
  `apps/api/test/interfaces/rate-limit.guard.spec.ts:183` (2 × 263 estoura,
  2 × 118 não); `apps/web/src/routes/SessionPage.canal-e-acompanhamento.test.tsx:166`
  (o predicado), `:203` (o aviso do acompanhado fecha o turno sem esperar o
  tique), `:221` (aviso de outro agente não lê, e o tique de 4s segue sendo a
  rede — caso de falha), `:244` (turno fechado: nem aviso nem tique leem)
- **Origem:** AT-093 — logs da api instalada (v6.1.0), 2026-09-14; AT-157 — o aviso da escrita da própria api

### RN-580 — O agente conversacional que sobe sobre uma conversa recebe o FIM dela, com perguntas e ferramentas, e o começo que não coube é resumido com o número escrito {#rn-580}

Os seis agentes conversacionais (Criativo, PO, Arquiteto, Dev Lead, UX
Designer e Staff) reconstroem o histórico do event log no `init/1` — no
restart e, também, quando sobem numa sessão que já tem conversa (o PO no
handoff do Criativo). Medido em 13/09 (AT-073, contra a `b61bc49cd`), os seis
tinham a MESMA cópia de `rehydrate/2`, com três defeitos:

1. **Liam o começo.** `EngineApiClient.list_events/2` pede `limit=200` sem
   `latest`, e a rota interna — que nem aceitava `latest` — devolve os
   PRIMEIROS 200. Numa conversa de 201 eventos o agente acordava sem a
   mensagem que estava respondendo. A tela já tinha resolvido isso com
   `latest: true` e aviso de recorte ([RN-180](web.md#rn-180));
   o engine não tinha herdado.
2. **Reconstruíam só `chat.message` e `agent.response`.** A pergunta feita por
   formulário (`chat.structured_question`) e as ferramentas chamadas
   (`tool.call`/`tool.result`) sumiam.
3. **Cortavam calados.** E as leituras dos kickoffs (PO, Arquiteto, Dev Lead,
   UX Designer) e das regras do product_brief (Criativo) filtravam em memória
   os mesmos PRIMEIROS 200 eventos de todos os tipos: numa conversa longa com o
   Criativo, o brief nascia depois do evento 200 e o PO recebia "(sem product
   brief disponível)".

**A regra:**

1. **Um caminho só.** `Engine.Agents.Reidratacao` substitui as seis cópias; os
   seis servidores chamam `historico/3` no `init/1`.
2. **A cauda, com o teto do ADR 0060.** A leitura é `latest=true&limit=200` — o
   `MAX_LIMIT` da rota, nem mais (a api cortaria) nem menos (deixaria de fora o
   que ela entrega de graça). O teto NÃO ficou ilimitado.
3. **O que entra.** `chat.message` e `agent.response` como sempre (de qualquer
   agente da sessão — é o que o PO herda do Criativo); `chat.structured_question`
   como fala do agente, com rótulos e opções; `tool.call`/`tool.result` do
   PRÓPRIO agente como nota de texto com a ferramenta, os argumentos (cortados
   em 1.500 caracteres) e o desfecho — nunca como mensagem `role: "tool"`, porque
   o evento não guarda o id da chamada e um `tool_result` sem o `tool_use`
   correspondente é recusado pelo provider. `chat.structured_question_answered`
   fica DE FORA de propósito: a api grava as mesmas respostas num `chat.message`
   logo depois (`AnswerStructuredQuestionUseCase` reusa
   `SendAgentMessageUseCase`), e reidratar os dois duplicaria a resposta.
4. **O começo que não coube é dito, com o número.** O `seq` é gapless e começa
   em 1, então o número de eventos omitidos é o `seq` do primeiro da cauda menos
   um — SUBTRAÇÃO, sem requisição a mais. Quando ele é maior que zero, o
   histórico abre com UMA mensagem de sistema que escreve esse número e traz o
   resumo da compactação de contexto mais recente do agente (quando foi
   gravado) e a abertura da conversa (as seis primeiras mensagens dos primeiros
   40 eventos, cortadas em 500 caracteres). São mais duas leituras com teto —
   três no total, e uma só quando a conversa cabe.
5. **`context.compacted` grava o resumo daqui em diante** — `summary`, `agent`
   e `messagesSummarized`, ao lado das contagens de sempre. Conversa compactada
   antes disto fica DECLARADA ("compactada N vez(es) antes de o resumo passar a
   ser gravado; aquele resumo se perdeu"), nunca reconstruída; os eventos
   antigos não mudam.
6. **Histórico ilegível não vira conversa vazia.** Se a leitura falha, o agente
   recebe uma mensagem de sistema dizendo que não conseguiu ler o histórico.
7. **Kickoffs e refs do brief leem POR TIPO, pela cauda.** A rota interna ganhou
   `types` (até 20, validados; malformado é 400) — mudança de CONTRATO,
   aditiva: sem `latest`/`types` a resposta é a de antes. Quando a leitura por
   tipo bate no teto, o kickoff diz que pode haver itens mais antigos.

**Medido por agente:** os seis mudaram na reidratação (`init/1`). Nos kickoffs,
PO, Arquiteto, Dev Lead e UX Designer mudaram; o Criativo mudou nas refs do
product_brief e no guardrail de zero regra; o Staff não tem kickoff (ADR 0088).

**O que esta regra NÃO fecha:** o texto que a ferramenta devolveu não estava no
log — fechado pela [RN-589](#rn-589), daqui em diante (sessão antiga continua sem).
`InfraLeadServer` (que reidrata por `Reidratacao.historico/3` desde a AT-150,
sem cópia própria) e `DevLeadTools.run_assessment/2` (que lê a CAUDA, `latest`
com o mesmo teto de 200) também passam pelo caminho comum; nenhum leitor de
`list_events/2` sem `latest` sobra em `apps/engine/lib`. A reidratação pode trazer MAIS do que o
contexto vivo tinha (a cauda inteira, mesmo o que já tinha sido compactado); o
`ContextManager` compacta de novo no próximo turno.

- **Código:** `apps/engine/lib/engine/agents/reidratacao.ex:71` (`historico/3`),
  `:46` (o teto), `:104` (`eventos_do_tipo/3`), `:152` (`mensagens/2`), `:167`
  (pergunta estruturada), `:170` (ferramenta), `:271` (omitidos por
  subtração), `:274` (o resumo do começo), `:294` (a compactação), `:328` (a
  abertura); `apps/engine/lib/engine/harness/context_manager.ex:138` (o resumo
  gravado); `apps/engine/lib/engine/sessions/engine_api_client.ex:1066`

  gravado); `apps/engine/lib/engine/sessions/engine_api_client.ex:1213`
  (`list_events/3`); os seis `init/1` —
  `apps/engine/lib/engine/agents/criativo_server.ex:89`, `po_server.ex:93`,
  `arquiteto_server.ex:87`, `dev_lead_server.ex:132`, `ux_designer_server.ex:85`,
  `staff_server.ex:86`; as leituras por tipo — `criativo_server.ex:435`,
  `po_server.ex:352`, `arquiteto_server.ex:313`, `dev_lead_server.ex:431`,
  `ux_designer_server.ex:246`;
  `apps/api/src/interfaces/http/internal/leitura-interna-de-eventos.ts:24`,
  `apps/api/src/interfaces/http/internal/internal-sessions.controller.ts:306`,
  `apps/api/src/infrastructure/persistence/drizzle/session-event.repository.ts:56`
- **Teste:** `apps/engine/test/engine/agents/reidratacao_test.exs:57` (pergunta
  estruturada), `:92` (a resposta entra UMA vez), `:108` (ferramenta com
  desfecho), `:128` (sem `tool.result`), `:136` (ferramenta de outro agente
  fica de fora), `:157` (pede a cauda com teto 200), `:176` (o fim entra, o
  começo vira resumo com o número), `:194` (o resumo da compactação), `:233`
  (compactação antiga declarada), `:248` (histórico ilegível — caso de falha),
  `:255` (abertura falhando não apaga o número), `:270` (leitura por tipo e o
  aviso de teto); `apps/engine/test/engine/agents/reidratacao_dos_seis_test.exs:59`
  (os seis `init/1`), `:84` (o brief depois do evento 200 chega ao PO), `:118`
  (a regra depois do evento 200 entra no brief do Criativo), `:135` (Arquiteto,
  Dev Lead e UX leem por tipo); `apps/engine/test/engine/harness/context_manager_test.exs:74`
  (o resumo gravado), `:101` (fallback do sumarizador);
  `apps/api/test/interfaces/http/internal/leitura-interna-de-eventos.spec.ts:13`
  (sem os parâmetros, as opções de antes), `:40` (tipo malformado é 400);
  `apps/api/test/infrastructure/persistence/session-event-latest.repository.spec.ts:129`
  (`types` filtra e o `limit` conta só eles), `:143` (`types` com `latest`)
- **Origem:** AT-073, levantada em 2026-09-13

## O repositório nasce no aceite do handoff ao Arquiteto, e a execução não começa sem ele (RN-582)

### RN-584 — A mensagem de chat não tem destinatário padrão: cada agente que conversa tem cláusula própria, e o resto é recusa nomeada {#rn-584}

A última cláusula de `EngineWeb.AgentCommandController.message/2` não olhava o
agente: casava QUALQUER nome que as cláusulas de cima não tivessem pegado e
entregava a mensagem ao **Criativo**. Uma mensagem escrita para o `infra` era
lida por outro agente, o clique respondia 202, e o Criativo respondia no fio —
nada quebrava, e ninguém via. Achado como adjacência da
[RN-578](#rn-578) (AT-089) e corrigido aqui (AT-098).

**A medição, antes do conserto** (os três lados, na `dev` de `72ee8cdcf`):

| Destino | A tela oferece? | A api aceita? | O engine tinha cláusula? |
|---|---|---|---|
| `criativo` | sim (composer: fallback da sessão criativa e `AGENTES_DE_CHAT`) | sim | NÃO — era a cláusula final, sem guarda |
| `po`, `arquiteto`, `dev-lead`, `ux-designer`, `staff` | sim (`AGENTES_DE_CHAT`, o `agent.activated` mais recente) | sim | sim, uma cada |
| `infra` | não no composer (fora de `AGENTES_DE_CHAT` desde o achado 9-fix e a [RN-499](web.md#rn-499)) | sim | não — caía no Criativo |
| qualquer outro nome do roster (`qa`, subagentes, `secops`, `psicologo`…) | só pelo formulário de perguntas estruturadas, que responde ao ATOR que perguntou (`agent={event.actor.id}`); hoje só Criativo e PO perguntam | sim | não — caía no Criativo |
| nome desconhecido, ou nenhum | não | sim (a api não valida o `agent`; só o `sessionId` vira segmento de URL checado, RN-128) | não — caía no Criativo |

**A regra:**

1. **Cada agente que conversa tem cláusula PRÓPRIA**, o Criativo inclusive
   (`"agent" => "criativo"`). A cláusula final deixou de existir como
   entrega: ela é RECUSA.
2. **Nome sem cláusula é 422 NOMEADO**, `{error, motivo}` no molde da
   [RN-578](#rn-578): `agente_sem_conversa`, com uma frase que nomeia o agente
   e diz que a mensagem ficou registrada e nenhum agente a leu. A api repassa
   422 como `UnprocessableEntityException` com a MESMA frase (o
   `postComandoDeTurno` da RN-578, sem código novo), e a tela a mostra pelo
   `mensagemDaRecusaDoAgente` que já existia. Sem `"agent"` no corpo é
   `agente_ausente`, e agente que conversa sem texto é `mensagem_sem_texto` —
   três motivos, porque "não conversa" dito a quem conversa seria mentira.
3. **O `infra` tem recusa PRÓPRIA**, com frase que diz o que ele faz: trabalha
   por proposta (a PR de infra, a subida do container), e o que pede decisão
   aparece em Aprovações. Não é falta de código, é a mesma leitura da
   [RN-499](web.md#rn-499) — o Infra Lead é propositivo. E o `user_message/2` que o
   `InfraLeadServer` ainda exporta **não serve** para uma cláusula: ele roda o
   turno INTEIRO dentro do `handle_call` (até 180 s), sem o aceite do ADR 0163
   e sem "Parar" (`via_for/2` não o conhece). Ligá-lo devolveria ao clique a
   espera que a [RN-578](#rn-578) tirou.
4. **O "Parar" também não adivinha.** `cancel/2` sem `"agent"` parava o turno
   do Criativo; passa a ser 422 `agente_ausente`. A api sempre manda o agente
   nas duas rotas, então essas duas recusas só alcançam chamador quebrado.
5. **A tela continua não oferecendo o `infra` no composer** — nenhuma mudança
   de UI: `AGENTES_DE_CHAT` já o excluía, e o que mudou é que, se um dia
   alguém o puser lá, o engine recusa com nome em vez de entregar a outro, e a
   guarda do CI reprova antes.

> **Desde a [RN-617](#rn-617) (ADR 0175), os itens 3 e 5 não valem mais:** o
> turno do Infra Lead migrou para o `TurnoAssincrono`, e só então ele ganhou
> cláusula própria de `message/2`, o `via_for/2` do "Parar" e o lugar em
> `AGENTES_DE_CHAT`. A recusa `agente_sem_conversa` dele saiu; a regra de
> fundo desta RN — nenhum destinatário padrão, todo nome sem cláusula recusado
> com nome — é a mesma.

**A guarda que fecha a classe** mora em
`scripts/ci/destinos-do-composer.spec.ts`, porque o destino nasce em
TypeScript e a cláusula mora em Elixir — nenhuma das duas suítes lê a outra
linguagem. Ela DERIVA os destinos da fonte (`AGENTES_DE_CHAT`, os literais
`agentParaEnviar = '…'` do `SessionPage.tsx` e o `AgentKey` do roster) e exige:
cláusula própria que conversa e `via_for/2` do "Parar" para cada destino do
composer; nenhuma cláusula sem agente fixo na cabeça que entregue a um agente;
a última cláusula de `message/2` sendo recusa; o `infra` fora do composer e
com recusa própria; e `@agentes_de_conversa` igual ao conjunto das cláusulas
que conversam. Cinco mutações medidas, todas mortas (o catch-all antigo de
volta, `infra` em `AGENTES_DE_CHAT`, a cláusula do Criativo renomeada, o
`via_for` do Staff removido, a cláusula do `infra` renomeada).

**O que esta regra NÃO fecha, declarado:**

- **Se o Infra Lead passa a conversar pelo composer era decisão de produto, sem
  dono** — tomada na [RN-617](#rn-617) (AT-141): sim. Dar a ele uma cláusula exige, antes, migrar o turno dele para o
  `TurnoAssincrono` (o aceite e a recusa `turno_em_andamento` da
  [RN-578](#rn-578)) e registrá-lo no "Parar"; e exige decidir o que uma
  conversa faz com um agente cujo contrato é propor. O `user_message/2` dele
  segue exportado e sem chamador.
- **O `chat.message` gravado pela api antes da recusa continua no log** — e
  desde a [RN-587](#rn-587) o engine grava o `agent.error` da recusa ao lado,
  então o fio explica a si mesmo.
- **A api não valida o `agent`.** Recusar lá, antes de gravar, exigiria uma
  segunda lista de quem conversa do lado TypeScript — e divergir dela das
  cláusulas é o defeito que esta regra fecha. Quem decide é quem tem as
  cláusulas (decisão mantida na [RN-587](#rn-587)).

- **Código:**
  `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:42`
  (`@agentes_de_conversa`), `:177` (a cláusula do Criativo), `:192` (a recusa
  do `infra`), `:283` (`mensagem_sem_texto`), `:249` (`agente_sem_conversa`),
  `:312` (`agente_ausente`), `:310` (o "Parar" sem agente);
  `apps/api/src/interfaces/http/agents/agents.controller.ts:115` e `:174`
  (a resposta 422 documentada); `apps/web/src/lib/session-readiness.ts:37`
  (`AGENTES_DE_CHAT`, a fonte que a guarda lê)
- **Teste:** `scripts/ci/destinos-do-composer.spec.ts` (a guarda da classe);
  `apps/engine/test/engine_web/controllers/agent_command_controller_test.exs:124`
  (caminho feliz: o Criativo pela cláusula própria), `:231` (o `infra`: 422 e
  nenhum dos dois sobe — caso de falha), `:258` (todo nome do catálogo de
  áreas e do roster fora de conversa), `:286`, `:302`, `:317`;
  `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts:575`
  (o destino viaja como escolhido, e o 422 chega com a frase)
- **Origem:** AT-098 — adjacência medida no PR #594 (AT-089)

### RN-585 — O fim do turno só fica visível depois de o turno fechar no agente {#rn-585}

Desde o [ADR 0163](../adr/0163-o-clique-responde-ao-aceitar.md)
([RN-578](#rn-578)) o turno dos seis conversacionais roda numa Task, e o
desfecho que a Task grava — `agent.response`, ou `agent.error` quando a api
narra orçamento, credencial ou binding no frame final — sai ANTES de o
resultado chegar ao GenServer do agente e zerar `turno_assincrono`. Um teste
que lia o state logo depois do `agent.error` reprovava em ~1 de 4 rodadas
(AT-099: 8 de 30 medidas). A pergunta era se a MESMA janela existia para
o usuário: a tela via o turno acabar e a mensagem seguinte ouvia 409
`turno_em_andamento`?

Não existe, e a regra é o que faz ela não existir:

1. **Os dois sinais de fim de turno saem só de `finalizar/1`**, que roda no
   processo do GenServer, dentro do `handle_info` que JÁ zerou
   `turno_assincrono`: `agent.done` no canal e `agent.status: idle`
   persistido. São os dois, e só eles, que a tela usa para fechar o turno
   (`onAgentDone` e `turnoTerminouNoLog`, [RN-578](#rn-578) item 4).
2. **A mensagem de quem viu um desses sinais é atendida depois desse
   `handle_info`** — o GenServer atende uma mensagem por vez —, então encontra
   o agente livre e é aceita.
3. **O que a Task grava não é sinal de fim.** `agent.response` e `agent.error`
   aparecem no fio com o turno ainda aberto no agente. Tela ou cliente que
   passasse a fechar o turno por eles reabriria a janela; emitir `agent.done`
   ou `idle` de dentro da Task também.

Não houve mudança de comportamento: a ordem já era esta desde a RN-578. O que
esta RN acrescenta é a ordem ESCRITA e travada por teste nos seis
conversacionais — o teste para o GenServer com a Task terminada e prova que
nenhum dos dois sinais saiu, sem timeout — e a correção do teste do PO, que
passa a esperar o `idle` persistido em vez do `agent.error`.

- **Código:** `apps/engine/lib/engine/agents/turno_assincrono.ex:158` (zera o
  turno no `handle_info`), `:495` (`finalizar/1`, único emissor dos dois
  sinais); `apps/web/src/lib/session-turno.ts:30` (`turnoTerminouNoLog`)
- **Teste:** `apps/engine/test/engine/agents/turno_assincrono_test.exs:434`
  (os seis conversacionais: com o GenServer suspenso e a Task terminada, o
  `agent.response` já está no log e nem `agent.done` nem `idle` saíram; depois
  do `idle`, a mensagem seguinte é aceita — o caso de falha é a recusa
  `turno_em_andamento`, que o teste nega);
  `apps/engine/test/engine/agents/po_server_test.exs:478` (espera o `idle`
  antes de ler o state)
- **Origem:** AT-099 — teste intermitente do `PoServerTest`, medido em
  2026-09-19

### RN-586 — O turno que o reinício do engine interrompeu fecha com desfecho durável, e nunca é refeito {#rn-586}

Desde a [RN-578](#rn-578) o `agent.status: working` é gravado ANTES do aceite, e
o fim do turno (`agent.status: idle` e `agent.done`) só sai de `finalizar/1`,
dentro do processo do agente ([RN-585](#rn-585)). Se o engine cai no meio do
turno, o processo e a Task morrem juntos e ninguém grava o fim: o último
`agent.status` do agente fica `working` **para sempre** (AT-156, reproduzido —
subir o servidor de novo sobre esse log não gravava nada, nos seis). Os dois
leitores desse sinal o tomam por turno em curso: a tela (`turnoTerminouNoLog`,
[RN-578](#rn-578) item 4) mantém a faixa de atividade, e o
`GetSessionPendingWorkUseCase` conta trabalho pendente SEM teto (o terceiro
sinal da [RN-064](web.md#rn-064)), então a sessão não fecha por heartbeat. Só a
próxima mensagem do usuário destravava, e só porque ela sobe o agente.

1. **O `working` que ficou sem turno vivo é fechado por evento NOVO**, nunca
   reescrito (evento é imutável): um `agent.error` com origem `infra` e
   `reason: turno_interrompido_por_reinicio` — a frase diz que o engine foi
   reiniciado, que o turno não foi concluído e que quem decide tentar de novo é
   o usuário ([RN-059](#rn-059): falha nunca vira
   resposta vazia) — seguido de `agent.status: idle` persistido. O canal recebe
   `agent.error` e `agent.done`, para a faixa de quem está com a tela aberta
   sair sem recarregar. Vale para os que compartilham `TurnoAssincrono` — seis
   na origem, sete desde a [RN-617](#rn-617).
2. **O turno NUNCA é reexecutado.** Refazê-lo gastaria token em nome de uma
   mensagem que o usuário talvez já tenha esquecido, sobre um histórico
   reconstruído; nenhuma chamada ao modelo acontece no fechamento.
3. **Só o ÚLTIMO `agent.status` de cada agente conta**, e só `working`:
   `idle` já está fechado, e `awaiting_approval` (Dev Lead suspenso,
   [RN-284](#rn-284)) é decisão pendente, não turno morto.
4. **"Sem turno vivo" olha o cluster, e na dúvida não fecha.** O registro dos
   agentes é local; num rollout o pod antigo pode estar rodando o turno, e
   fechá-lo dali mataria um turno saudável. Nó que não responde conta como vivo.
   O repasse de sessão do drain ([RN-588](#rn-588), `Monitor.expect_handoff/1`)
   é do `SessionServer`, não dos conversacionais: enquanto o pod antigo está de
   pé o agente dele segue registrado lá, e a varredura do pod novo o enxerga;
   o `Adopter` não varre — quem chega ao `working` órfão depois que o pod antigo
   morre é o `init/1` do agente.
5. **Dois pontos de entrada, uma função** (`Engine.Agents.TurnoOrfao`): a
   varredura de boot em cada sessão reidratada (`Rehydrator`, fora do caminho do
   readiness — o boot não espera a api), que fecha o turno mesmo que ninguém
   mande mensagem, e o `init/1` de cada servidor, rede de segurança para quando
   o boot não conseguiu escrever (api ainda fora do ar). Falha de leitura ou de
   escrita é logada e o agente sobe.

Declarado e não fechado: ~~o Infra Lead (`infra`) roda o turno dentro do
`handle_call`, sem `TurnoAssincrono`, e fica de fora~~ — fechado na
[RN-617](#rn-617), que o pôs no `TurnoAssincrono` e em `TurnoOrfao`; a janela de leitura é a
das 200 mais recentes `agent.status` da sessão; se a api estiver fora no boot E
ninguém acordar o agente, o `working` fica até a próxima subida dele; e o
fechamento não recupera o que o turno já tinha gravado antes da queda.

- **Código:** `apps/engine/lib/engine/agents/turno_orfao.ex:89` (`varrer/2`),
  `:99` (`fechar_ao_subir/3`), `:122` (`encerrar/3`);
  `apps/engine/lib/engine/sessions/rehydrator.ex:75` (varredura no boot); o
  `init/1` dos seis `*_server.ex` chama `TurnoOrfao.fechar_ao_subir/3`
- **Teste:** `apps/engine/test/engine/agents/turno_orfao_test.exs:72` (nos seis:
  o `working` sem turno vivo vira `agent.error` `infra` + `idle`, e o LLM não é
  chamado), `:108` (`awaiting_approval` não é órfão; `idle` e o `working` de
  outro agente não são fechados), `:124` (`varrer/2` pula o agente com processo
  vivo em ESTE nó ou num nó `:peer` de verdade do cluster; leitura e escrita
  que falham não derrubam a subida);
  `apps/engine/test/engine/sessions/rehydration_test.exs:46` (o boot dispara a
  varredura)
- **Origem:** AT-156, herdada da AT-089 (RN-578) — reproduzida em 2026-09-19

**Revisada pela [RN-920](#rn-920) ([ADR 0226](../adr/0226-diario-vivo-e-retomada-dos-agentes.md)).** O item 2 ("o turno NUNCA é reexecutado") deixou de valer para o turno recente: a varredura de boot o retoma UMA vez, se a última atividade do agente tem até 900 s, com a mensagem efêmera do diário; o turno velho ou já retomado continua só fechado, e o botão "Retomar" ([RN-921](api.md#rn-921)) é o caminho humano. Os itens 1, 3, 4 e 5 seguem.

### RN-587 — A mensagem que nenhum agente leu fica no fio dizendo isso: o engine grava o `agent.error` da recusa {#rn-587}

A api grava o `chat.message` ANTES de perguntar ao engine (o engine reconstrói a
conversa lendo o log, e a mensagem precisa ser durável mesmo com ele fora do
ar). Quando o engine recusava, a mensagem ficava no fio do usuário com cara de
entregue e o motivo morava só no toast — a tela afirmando o que a fonte negou.
As duas RNs de origem deixaram isso declarado ([RN-578](#rn-578), [RN-584](#rn-584));
esta o fecha (AT-132).

**A medição, antes do conserto**, por recusa:

| Recusa | Quem a produz | `agent.error` durável ao lado do `chat.message`? |
|---|---|---|
| 409 `turno_em_andamento` | `TurnoAssincrono` (RN-578) | JÁ SIM — `emitir_recusa_por_turno_em_andamento/1`, com teste |
| 409 `aguardando_aprovacao` | `DevLeadServer.handle_call` (RN-578) | JÁ SIM — `reason: "aguardando_aprovacao_de_plano"` |
| 422 `agente_sem_conversa`, `mensagem_sem_texto`, `agente_ausente` | o controller (RN-584), sem `*Server` | NÃO — a explicação vivia só no toast |

**A regra:**

1. **O engine é a fonte da recusa E do registro.** As três recusas 422 gravam
   `agent.error` (origem `politica`, `mensagem` igual à frase do 422,
   `reason` igual ao `motivo`) e o transmitem no canal da sessão — o mesmo par
   durável/efêmero das duas 409. O fio já desenha `agent.error`
   (`SessionPage.tsx`, `lerFalhaDeTurno`), então nenhuma tela mudou.
2. **Só há o que gravar com sessão nomeada.** Sem `projectId`/`sessionId` no
   corpo (chamador quebrado) a recusa segue só como resposta.
3. **O ator não vem da rota.** `infra` e os seis que conversam entram como
   `agent`; qualquer outro nome (que a rota pública deixa passar) é o `system`
   `engine` — um nome digitado nunca vira ator no log.
4. **Não se apaga nem se adia o `chat.message`.** Evento é imutável, e gravá-lo
   só depois do aceite reordenaria o log: o turno roda numa Task e o
   `agent.response` poderia preceder a mensagem que responde (e uma falha entre
   o aceite e o append rodaria um turno sobre mensagem não gravada).

**A api continua sem validar `agent`, e agora isso é decisão e não lacuna.** A
validação que a AT-098 pedia é a recusa 422 do engine, e ela é o mecanismo
ÚNICO: a api a repassa (`postComandoDeTurno`) e o engine a registra. Uma lista
do lado TypeScript seria a segunda cópia que diverge no primeiro agente novo, e
uma lista GERADA a partir das cláusulas exigiria parsear Elixir — sem ganho
para o usuário, que já vê a mensagem e a explicação no fio.

- **Código:** `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:573`
  (`recusar_mensagem/5`) e `:574` (`registrar_recusa_de_mensagem/3`)
- **Teste:** `apps/engine/test/engine_web/controllers/agent_command_controller_test.exs:207`
  (`qa`, o agente do roster que segue sem conversa — até a RN-617 o caso era o
  `infra`, que passou a conversar: o `agent.error` com a frase e o motivo), `:178` (nome desconhecido
  não vira ator), `:194`, `:209`, `:224` (sem sessão: nada gravado — caso de
  falha); mutação medida: com o registro removido, 4 dos 5 falham;
  `scripts/ci/destinos-do-composer.spec.ts` (a recusa de `message/2` é
  `recusar_mensagem/5` e ela grava o `agent.error`; seis mutações mortas)
- **Origem:** AT-132 — declarado aberto nas RN-578 (AT-089) e RN-584 (AT-098)

### RN-588 — Repassar uma sessão não deixa o pod antigo apagar a linha do par {#rn-588}

No rollout, o drain do pod antigo para o `SessionServer` e pede a um par que
assuma a sessão (`Engine.Shutdown`); o `init` do par regrava a linha de
`engine.session_states`. O `:DOWN` do processo parado, porém, chega ao
`Engine.Sessions.Monitor` do pod antigo por mensagem — e o Monitor é um
GenServer único, que serializa o `:DOWN` de cada sessão com um DELETE por ida
ao banco, sem esperar pelo repasse seguinte. Quando o `:DOWN` era processado
DEPOIS do upsert do par, o `DELETE ... WHERE session_id` — que não olha dono
nem geração — levava a linha DO PAR: a sessão ficava com dono e sem linha,
invisível ao `Adopter`, ao `Rehydrator` e ao `local_sessions/0` do drain do
par. Se o par era OUTRO pod antigo (`.33 → .28 → novo`), ele não a via ao
drenar, e o SIGTERM dele a matava: `active` na api e sem dono (AT-078, o
`rollout-test` do `propriedades.yml`, ~3 órfãs em 13 rodadas).

A regra: o drain marca o stop com `Monitor.expect_handoff/1` (o
`expect_stop/1` de sempre MAIS "a linha não é minha"), e o Monitor NÃO apaga a
linha de uma sessão repassada — registra em `Logger.info` que a manteve. Sem
adoção, quem apaga é o próprio drain (`terminate_unadopted`), como já era; o
Monitor continua apagando a linha de toda sessão que morre por outra causa e a
do `expect_stop/1` do `SessionLifecycleWorker` (a api já encerrou a sessão).
Sem migration: a linha não ganhou coluna de dono, e a marca vive no estado do
Monitor, por sessão. Toda apagada do Monitor passou a deixar UMA linha de log
com sessão, nó e linhas removidas — o log da drenagem nunca chega ao log do
pod (o `preStop` o descarta), o do Monitor chega.

**Inferência que fica:** o instante em que a linha sumiu nunca foi medido no
k3d; a leitura vem do artefato da rodada `35452845830` (sem linha + segundo pod
antigo) e do código, e a corrida foi provada em ExUnit, não observada. A
próxima falha do k3d, se houver, traz a linha do Monitor.

- **Código:** `apps/engine/lib/engine/sessions/monitor.ex:45`
  (`expect_handoff/1`), `:119` (`apagar_linha/1`);
  `apps/engine/lib/engine/shutdown.ex:130` (`release/1`, o drain marca o repasse)
- **Teste:** `apps/engine/test/engine/sessions/monitor_repasse_test.exs:52`
  (Monitor suspenso: o `:DOWN` tardio não apaga a linha regravada pelo par),
  `:67` (cadeia antigo → antigo → novo: o segundo drain ainda vê a sessão),
  `:87` (sem adoção a linha continua saindo pelo drain), `:100`
  (`Shutdown.release/1` marca o repasse — trocar a chamada de volta por
  `expect_stop/1` reprova SÓ este teste)
- **Origem:** AT-078 — sessão órfã intermitente do rollout do engine

### RN-589 — O texto que a ferramenta devolveu entra no `tool.result`, cortado com o total dito {#rn-589}

A RN-580 declarou aberto: só o Criativo gravava `tool.result`, e sem o texto —
nos outros cinco a nota da reidratação dizia que o log não registra o
desfecho, e o agente reidratado sabia QUE chamou `create_epic`, não o id do
épico que ela respondeu.

**A regra:**

1. **Os seis gravam.** Criativo, PO, Arquiteto, Dev Lead, UX Designer e Staff
   emitem `tool.result` depois de TODA chamada que devolve texto. O payload sai
   de UM lugar, `Engine.Agents.ResultadoDeFerramenta.payload/2`: `tool`, `ok`
   e — no sucesso — `resultado`; na falha, `erro` (como o Criativo já fazia).
2. **Com teto, e o teto diz o total.** O texto é cortado em 2.000 caracteres;
   quando corta, `resultadoTotal` traz o tamanho REAL (ADR 0060). O motivo do
   teto: o log é lido por todo membro do projeto e entra no backup, e uma
   listagem (`listar_backlog`) pode ser grande.
3. **Aditivo.** Campo novo em tipo existente, sem migration; `tool`/`ok`/`erro`
   seguem como eram. Evento é imutável: sessão anterior continua sem o texto, e
   a nota da reidratação segue dizendo isso para a chamada sem `tool.result`.
4. **A reidratação usa o texto.** `desfecho: ok, devolveu: <texto>` (com aviso
   `[cortado; o total real tinha N caracteres]` quando houver `resultadoTotal`).
   Continua nota de texto, nunca `role: tool` — o evento não guarda o id da
   chamada.
5. `propose_adr` deixou de gravar o próprio `tool.result` de recusa: o servidor
   do Arquiteto o grava para toda ferramenta, e os dois duplicariam o evento.

**O que fica aberto:** (a) e (b) fecharam na [RN-593](#rn-593) — (a) o Dev
Lead que SUSPENDE (`{:pending, _}`,
`propose_execution_plan`/`assess_implementability`) não gravava `tool.result` na
suspensão nem no `action_settled`; (b) o `InfraLeadServer` tinha o próprio
`tool.result` e não passava por este módulo; (c) o teto de 2.000 é ESCOLHA, não medida sobre o
acervo — nenhum resultado real foi amostrado; (d) **decisão de produto
pendente (TODO humano da AT-151):** as ferramentas dos seis devolvem ids,
listas de regras/backlog/métricas e mensagens de erro — nenhuma lê arquivo do
repositório nem saída de comando —, mas se uma ferramenta assim nascer, ela
gravaria conteúdo dele no log; o corte é a única contenção.

- **Código:** `apps/engine/lib/engine/agents/resultado_de_ferramenta.ex:24`
  (`payload/2`), `criativo_server.ex:382`, `po_server.ex:259`,
  `arquiteto_server.ex:336`, `dev_lead_server.ex:407`,
  `ux_designer_server.ex:232`, `staff_server.ex:198`;
  `apps/engine/lib/engine/agents/reidratacao.ex:224` (`desfecho/1`)
- **Teste:** `apps/engine/test/engine/agents/reidratacao_test.exs:128` (texto e
  aviso de corte na nota; `:145` sessão antiga sem `tool.result`),
  `apps/engine/test/engine/agents/po_server_test.exs:252` (o evento gravado,
  cortado, com `resultadoTotal`)
- **Origem:** AT-151 — declarado aberto na RN-580 (AT-073)

### RN-593 — O Dev Lead suspenso e o Infra Lead gravam o `tool.result` pelo módulo comum {#rn-593}

A [RN-589](#rn-589) declarou dois abertos: o Dev Lead que suspende numa
aprovação não gravava `tool.result` em momento nenhum, e o `InfraLeadServer` só
gravava o de recusa de `propose_infra_pr`, com payload montado à mão. Nos dois
casos o agente reidratado ([RN-580](#rn-580)) lia "o log não registra o
desfecho desta chamada" sobre um plano que o usuário já tinha decidido, ou sobre
toda chamada de `validate_infra_file` e de subida de container.

**A regra:**

1. **Dev Lead: o `tool.result` nasce na RETOMADA, nunca na suspensão.** Quando
   `propose_execution_plan`/`assess_implementability` suspende
   (`{:pending, _}`), o log fica só com o `tool.call`: não há desfecho, e
   gravar "pending" ali seria a mesma mentira que seria para o modelo. Quando o
   `{:action_settled, …}` da MESMA ação chega, o servidor grava o `tool.result`
   com o MESMO texto que entra na mensagem `role: "tool"`. `ok` segue a
   partição de `texto_do_desfecho/1`: `executed`/`auto_approved`/`approved`
   são `true`; recusa, falha e status que o módulo não conhece são `false` —
   `ok: true` sobre desfecho que ninguém classificou seria afirmar sucesso sem
   saber. Desfecho de OUTRA ação continua ignorado e não grava nada.
2. **Infra Lead: toda ferramenta despachada inline grava.**
   `validate_infra_file`, `propose_container_start` e
   `container_start_via_runner` gravam `tool.result` por
   `Engine.Agents.ResultadoDeFerramenta.payload/2` — proposta aceita pela api é
   `ok: true`; recusa local por modo ([RN-566](#rn-566)), recusa da api
   ([RN-591](api.md#rn-591)) e runner ausente são `ok: false` com o motivo. A recusa
   de `propose_infra_pr` sem repositório ([RN-577](#rn-577)) passa pelo mesmo
   módulo, com o payload de antes (`tool`, `ok: false`, `erro`) e o corte.
3. **`propose_infra_pr` aceita segue SEM `tool.result`**, de propósito: ela não
   emite `tool.call` (o rastro dela é a `proposed_action`), e um resultado sem
   chamada viraria nota órfã na reidratação.

**O que segue aberto:** a suspensão atravessada por um restart do engine
continua perdendo a inscrição no `Wake` (ADR 0086) — ali o `tool.result` nunca
nasce, e a reidratação diz que o log não tem o desfecho, o que é verdade; o
teto de 2.000 caracteres continua ESCOLHA, não medida: nenhum acervo real foi
amostrado nesta mudança (o item (c) da [RN-589](#rn-589)); a saída do
`validate_infra_file` (hadolint/actionlint) pode citar trechos do arquivo que o
PRÓPRIO agente escreveu, e o corte é a única contenção — é o item (d) da
[RN-589](#rn-589) com o primeiro caso concreto.

- **Código:** `apps/engine/lib/engine/agents/dev_lead_server.ex:321`
  (`handle_info/2` do `action_settled`, o `tool.result` em `:271`), `:749`
  (`sentido_do_desfecho/1`);
  `apps/engine/lib/engine/infra/infra_lead_server.ex:1120`
  (`registrar_resultado/4`), `:317` (a recusa de `propose_infra_pr`)
- **Teste:** `apps/engine/test/engine/agents/dev_lead_server_test.exs:292` (a
  suspensão não grava), `:364` (a retomada grava o texto que o modelo leu),
  `:488` (recusado é `ok: false` com o motivo);
  `apps/engine/test/engine/infra/infra_lead_server_test.exs:253`
  (o desfecho de `validate_infra_file`), `:409` (proposta aceita), `:485` (recusa por modo),
  `:863` e `:914` (`container_start_via_runner` com e sem runner)
- **Origem:** AT-190 — declarado aberto na [RN-589](#rn-589) (AT-151)

### RN-601 — O engine e o broker aplicam aos dois tokens de serviço a régua da api {#rn-601}

Os três processos que comparam o token de serviço usam a mesma régua da
[RN-598](api.md#rn-598), cada um na sua linguagem. O espaço em volta é descartado, e
um valor feito só de espaço conta como ausente. Em produção,
`BRABO_SERVICE_TOKEN` ausente, o literal público de desenvolvimento
(`dev-service-token-change-me`) ou um valor com menos de 16 caracteres depois
do trim DERRUBAM o boot, com uma mensagem que nomeia a variável. As duas
últimas recusas valem também para `BRABO_SERVICE_TOKEN_PREVIOUS` quando ele
está definido. Um anterior igual ao atual não conta como rotação. Fora de
produção só o trim se aplica, e o atual vazio cai no default de dev.

Antes, o engine lia os dois crus em `config/runtime.exs`: sem trim, sem piso,
e em produção subia com o default público quando a variável faltava (e com a
string vazia quando o compose a passava vazia). Só a api recusar subir
protegia a instalação. O broker já aplicava a régua ao atual, mas ao anterior
só o trim.

Duas divergências de forma, declaradas. No engine, "produção" é
`config_env() == :prod` (a release), e não `NODE_ENV`, que ele não lê; a
imagem de produção é sempre uma release `:prod`. E a régua fica inline no
`runtime.exs`, e não num módulo de `lib/`, porque numa release esse arquivo
roda num config provider antes de o código da aplicação estar carregado.

Consequência: todo processo que avalia esse `runtime.exs` numa release
`:prod` precisa do token, inclusive a migração (`bin/engine eval
Engine.Release.migrate()`). Por isso o serviço `migrate-engine` dos composes de
produção e de instalação passou a receber `BRABO_SERVICE_TOKEN` e
`BRABO_SERVICE_TOKEN_PREVIOUS`, sem default. O smoke de CI mostrou isso: sem
eles, a migração morria antes de migrar. O Job de migração do Kubernetes já os
recebia pelo `envFrom` de `brabo-secrets`.

- **Onde:** `apps/engine/config/runtime.exs:85`
  (`exigir_token_de_servico_de_producao`), `:105` (`service_token`), `:121`
  (`service_token_previous`); `apps/broker/src/config.ts:89` (`anterior`),
  `:125` (`exigirTokenDeProducao`)
- **Teste:** `apps/engine/test/engine/runtime_service_token_test.exs` (avalia o
  `runtime.exs` de verdade por `Config.Reader.read!/2`, com `env: :prod` e
  `:dev`); `apps/broker/src/config.spec.ts` (describe "lerConfiguracao —
  produção, o token ANTERIOR (RN-601)")
- **Borda:** a régua é copiada nos três processos, não compartilhada: são três
  linguagens ou runtimes, e nenhum teste confere que as três cópias continuam
  iguais. O piso conta caracteres (`String.length` no Elixir, `.length` no TS),
  o que só difere para token fora do ASCII.
- **Origem:** AT-216 (achado da AT-205)

### RN-610 — O Infra Lead recusa a subida por ESTADO, na ordem da `/containers`: já de pé, sem imagem, pasta nunca confirmada {#rn-610}

A [RN-566](#rn-566) deu às duas tools de subida do Infra Lead a recusa por
MODO e declarou o resto: a `/containers` checa três coisas antes de oferecer o
botão (imagem decidida, modo, pasta confirmada) e o agente checava uma. A
decisão do mantenedor (AT-142, 2026-09-27) foi fechar essa distância por
**recusas locais no despacho**, no molde da RN-566/[RN-577](#rn-577), e NÃO por
contexto enriquecido — `GetInfraContextUseCase` não muda.

`recusa_local_de_subida/2` continua lendo o projeto UMA vez. Primeiro o MODO
(`recusa_por_modo/2`, a régua da RN-566 sem mudança de texto) — é ele que diz
qual tool usar, e responder "falta imagem" a quem chamou a tool errada
apontaria a porta errada. Depois o ESTADO (`recusa_por_estado/3`), uma
cláusula por motivo, na MESMA ordem de `decidirSubida`
(`apps/web/src/routes/containers-subida.ts`), avaliadas só até a primeira
recusa:

| Cláusula | `propose_container_start` | `container_start_via_runner` | Leitura local |
|---|---|---|---|
| container já REGISTRADO `running`/`provisioning` (`ja_esta_de_pe`) | recusa | recusa | `project_containers.status` |
| nenhuma imagem decidida (`sem_imagem_decidida`) | **não** recusa | recusa | existe `artifact.project_image` em alguma sessão do projeto |
| pasta nunca confirmada (`runner_nunca_confirmou`) | — | recusa | `projects.workspace_verified_at` nulo |
| nenhum runner conectado agora | — | recusa (já existia, RN-508) | `Engine.Runners.Registry` |

**Por que `propose_container_start` não recusa por imagem.** Eleger a imagem é
o que essa proposta FAZ ([RN-491](web.md#rn-491)): exigir decisão antes inverteria a
ordem. A tela checa imagem nos dois modos porque o botão dela não elege nada.
`container_start_via_runner` não elege — sobe a imagem JÁ decidida, e
`ExecuteContainerStartViaRunnerUseCase` falha sem ela —, então ali a cláusula
vale. O predicado é o MESMO da api (`ObterContainerDoProjetoUseCase`):
EXISTÊNCIA do evento, nunca validade do payload, porque a api degrada payload
ilegível para o default em vez de tratá-lo como ausência.

**Por que "já de pé" recusa, se a execução não falharia.**
`SubirCicloDeVidaDoContainerUseCase` é idempotente sobre `provisioning`/
`running`, então a proposta aprovada seria um nada que gastou uma decisão
humana — e em `container`/`mounted` pior que nada: elegeria uma versão nova de
`artifact.project_image` que o container de pé, com a versão congelada na
linha ([RN-245](api.md#rn-245)), não usaria. Registrado não é observado
([RN-486](api.md#rn-486)): o texto não afirma que o container está vivo, diz o que
fazer quando ele morreu por fora. `stopped`, `failed` e `removed` não recusam.
Erro de consulta devolve `nil` e cai no caminho de sempre — "não consegui
olhar" nunca vira recusa.

**Os textos, que são o resultado de ferramenta que o modelo lê**
([RN-163](#rn-163)) — nunca `agent.error`, nunca
fim de turno, com `tool.call`/`tool.result` (`ok: false`) no event log pelo
mesmo `registrar_resultado/4` da [RN-593](#rn-593):

- já de pé: *"o container deste projeto já está REGISTRADO como `<status>` —
  subir não é a próxima ação, e `<tool>` não foi proposta. O registro não é
  observação (RN-486): se o container morreu por fora, ou se a imagem precisa
  mudar, diga ao usuário que parar ou remover é pela página `/containers`; só
  depois disso uma nova subida faz sentido. Não repita a chamada agora."*
- sem imagem: *"nenhuma imagem de container foi decidida para este projeto
  (`artifact.project_image`, RN-105) — `container_start_via_runner` sobe a
  imagem JÁ decidida e não elege nenhuma, então aprovada ela só poderia falhar,
  e não foi proposta. Quem decide a imagem é o Arquiteto
  (`choose_project_image`): diga isso ao usuário e não repita a chamada até
  haver decisão."*
- pasta nunca confirmada: *"a pasta deste projeto nunca foi confirmada por um
  agente local (`workspace_verified_at` vazio, RN-423) — nenhum `brabo-runner`
  jamais conectou a ele, e `container_start_via_runner` não foi proposta. Peça
  ao usuário para rodar `brabo-runner --project <id> --dir <pasta>` na máquina
  dele: a confirmação acontece quando o runner conecta."*

Nenhuma linha de prompt mudou, e nenhuma medição com modelo real foi feita
nesta regra: a premissa de que o modelo entende a recusa é a da RN-566.

**O que NENHUMA cláusula checa, declarado:** instalação sem broker (o engine
não lê `BROKER_URL`; quem recusa é a api ao propor, com 409
`sem_broker_na_instalacao`, [RN-591](api.md#rn-591)) e papel/sessão (o agente não é
quem clica). A cláusula de pasta usa o carimbo, que não é batimento
([RN-468](web.md#rn-468)) — por isso a de runner conectado continua depois dela.

- **Código:** `apps/engine/lib/engine/infra/infra_lead_server.ex:889`
  (`recusa_local_de_subida`), `:945` (`recusa_por_estado`), `:1025`
  (`recusa_ja_de_pe`), `:1027` (`recusa_sem_imagem_decidida`), `:1028`
  (`recusa_pasta_nunca_confirmada`), `:1029` (`recusa_runner_desconectado`);
  `apps/engine/lib/engine/containers/project_container_lifecycle.ex:83`
  (`status_registrado`);
  `apps/engine/lib/engine/session_events/event.ex:120` (`imagem_decidida?`)
- **Teste:** `apps/engine/test/engine/infra/infra_lead_server_test.exs:742`
  (via runner, `running` recusa), `:808` (`provisioning` recusa), `:818`
  (`stopped` não recusa), `:779` (sem imagem), `:790` (pasta nunca
  confirmada), `:854` (`propose_container_start` com container `running`),
  `:854` (`propose_container_start` sem imagem PROPÕE), `:863` (caminho feliz
  do via runner), `:901` (sem runner conectado)
- **Origem:** AT-142

---

### RN-617 — O Infra Lead conversa pelo composer, e o turno dele passa pelo `TurnoAssincrono`: aceite imediato, "Parar", turno órfão fechado {#rn-617}

A decisão que a [RN-584](#rn-584) deixou aberta — *"se o Infra Lead passa a
conversar pelo composer"* — foi tomada pelo mantenedor (AT-141, 2026-09-27):
**sim**, e ele vira o SÉTIMO conversacional
([ADR 0175](../adr/0175-infra-lead-conversa-pelo-composer.md)). A condição que a
RN-584 escreveu veio primeiro: o turno dele deixou de rodar DENTRO do
`handle_call`/`handle_cast` e passou pelo MESMO `Engine.Agents.TurnoAssincrono`
dos outros seis; só depois a cláusula de `message/2` nasceu.

**Etapa 1 — o turno.**

1. **Os três turnos do Infra Lead sobem numa Task** — o kickoff (ainda `cast`,
   só no start FRESCO do handoff aceito), a correção de gate (`{:correct, _}`)
   e a mensagem do composer. A mensagem responde ao ACEITE, com o
   `agent.status: working` gravado ANTES ([RN-578](#rn-578)); o desfecho vai
   pelo canal e, quando é falha, pelo `agent.error` durável. O
   `user_message/2` que rodava o turno inline SAIU: o nome ficou e é o aceite.
2. **Segunda mensagem com turno em curso é `409 turno_em_andamento`**, com o
   `agent.error` de origem `politica` no fio — inclusive durante o kickoff,
   que antes prendia a mensagem na fila do processo pelo turno inteiro.
3. **"Parar" alcança o Infra Lead** (`via_for("infra")` no `cancel/2`): mata
   a Task — e com ela o `WorkflowsAgent`, que roda dentro da consolidação —,
   grava `agent.error` `cancelado_pelo_usuario` e devolve `idle`.
4. **A consolidação com o Workflows é parte da função de turno** e devolve o
   `state`; os sinais de fim (`agent.done`, `agent.status: idle`) saem só de
   `TurnoAssincrono`, no processo do servidor ([RN-585](#rn-585)).
5. **A correção de gate que chega com turno em curso entra numa FILA**
   (`correcoes_pendentes`) e sobe no fecho do turno, na ordem de chegada — o
   `TurnoAssincrono` sem `from` DESCARTA o pedido que encontra turno em
   curso, e o gate pediria mudança a ninguém.
6. **O turno órfão do reinício fecha** pela [RN-586](#rn-586): `infra` entrou
   em `TurnoOrfao` (`@agentes`), no boot e no `init/1`.
7. **O histórico vem de `Engine.Agents.Reidratacao`** ([RN-580](#rn-580)),
   como já vinha, e o `tool.result` de `ResultadoDeFerramenta`
   ([RN-593](#rn-593)).
8. **O teto de iterações é o dele, 14** (o mesmo de Arquiteto, Dev Lead, UX
   Designer e Staff), e esgotá-lo passa a emitir `toolloop.limit_reached`
   ([RN-166](#rn-166)) — antes o 14º passo
   terminava calado.

**Etapa 2 — o composer.**

9. **`message/2` tem cláusula PRÓPRIA para `infra`**, e a recusa
   `agente_sem_conversa` dele saiu — um nome, um caminho.
   `@agentes_de_conversa` o inclui; a mensagem a um Infra Lead que não está de
   pé (engine reiniciado) o reergue SEM kickoff, e ele reidrata no `init/1`.
10. **A tela o oferece pela regra de sempre**: `infra` entrou em
    `AGENTES_DE_CHAT`, então ele é o destinatário quando é o `agent.activated`
    mais recente — sem destinatário padrão (RN-584). O aceite do handoff DELE
    continua no card próprio da [RN-499](web.md#rn-499); o card do fio o exclui por
    NOME (`offeredHandoff`), senão o convite aparecia duas vezes e, sendo o
    mais antigo, voltava a esconder o do Dev Lead ([RN-136](web.md#rn-136)). A faixa
    de atividade ganhou frase para as quatro ferramentas dele.
11. **Conversar não abre efeito externo.** As ferramentas são as mesmas
    quatro; a PR de infra e as duas subidas de container continuam nascendo
    `proposed_action`, com as recusas locais das [RN-566](#rn-566),
    [RN-577](#rn-577) e [RN-610](#rn-610) intactas.

**O teto de 180 s deixou de importar para o turno.** Ele era menor que os
225 s do `propose_action` de container ([RN-605](contracts.md#rn-605)), e uma mensagem que
levasse o modelo a propor `container_start` podia estourar o `GenServer.call`
com a proposta de pé. Com o aceite imediato, o `GenServer.call` só espera o
aceite; o `propose_action` corre dentro da Task, sem ninguém esperando
síncrono. O 180 000 ficou, igual ao dos outros seis, como teto do ACEITE.

**Não muda, declarado:** `SOLO_CONVERSATIONAL_AGENTS` (gerada por
`pnpm --filter api gerar:areas`) é a lista dos agentes SEM área que o handoff
manual endereça; o Infra Lead é lead de área e continua fora dela, e
`AGENTES_DE_CHAT` não é gerada. O Infra Lead não ganhou perguntas estruturadas
nem leitura de backlog — conversar com ele é conversar com o que o kickoff lhe
deu e com as quatro ferramentas.

- **Código:** `apps/engine/lib/engine/infra/infra_lead_server.ex:187`
  (`user_message`), `:211` (`TurnoOrfao.fechar_ao_subir`), `:248`
  (`handle_cast(:kickoff`), `:270` (`handle_cast({:correct`, a fila), `:280`
  (`handle_cast(:cancel`), `:296` (`handle_call({:user_message`), `:368`
  (`handle_info`), `:373` (`drenar_correcao_pendente`), `:456`
  (`toolloop.limit_reached`), `:1164` (`concluir`);

  (`toolloop.limit_reached`), `:1057` (`concluir`);
  `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:44`
  (`@agentes_de_conversa`), `:192` (a cláusula do `infra`), `:618`
  (`via_for`); `apps/engine/lib/engine/agents/turno_orfao.ex:57` (`@agentes`);
  `apps/web/src/lib/session-readiness.ts:37` (`AGENTES_DE_CHAT`);
  `apps/web/src/lib/session-handoffs.ts:120` (`ofertasAcionaveis`)
- **Teste:** `apps/engine/test/engine/infra/infra_lead_server_test.exs:1033`
  (aceite imediato, `working` antes), `:1048` (409 com turno em curso — caso
  de falha), `:1077` ("Parar"), `:1103` ("Parar" sem turno), `:1107` (a
  correção de gate na fila), `:1792` (`toolloop.limit_reached`);
  `apps/engine/test/engine/agents/turno_orfao_test.exs:76` (o órfão, agora nos
  sete); `apps/engine/test/engine/agents/reidratacao_dos_seis_test.exs:62` (a
  reidratação, nos sete);
  `apps/engine/test/engine_web/controllers/agent_command_controller_test.exs:236`
  (202, 409 e "Parar" pela rota), `:283` (reergue sem kickoff);
  `apps/web/src/routes/SessionPage.cancelar-turno.test.tsx:256` (o composer
  envia ao Infra Lead e o "Parar" é dele);
  `apps/web/src/lib/session-readiness.test.ts:123`;
  `scripts/ci/destinos-do-composer.spec.ts:174` (a guarda: `infra` é destino,
  com UMA cláusula que conversa)
- **Origem:** AT-141 (decisão do mantenedor), aberta pela AT-098

**Revisada pela [RN-924](#rn-924) ([ADR 0226](../adr/0226-diario-vivo-e-retomada-dos-agentes.md)).** A fila `correcoes_pendentes`, só em memória, passou a ser durável (`infra.correction_queued`/`_delivered`), no molde da fila de mensagens; o turno órfão do Infra Lead segue a retomada da [RN-920](#rn-920).

### RN-621 — O resumo da compactação mantém o idioma original de cada turno, e não traduz citação nem código {#rn-621}

Quando o contexto de um agente passa do limiar, o `ContextManager` troca os
turnos antigos por UM resumo, escrito por outra chamada de LLM (o ator
`context-manager`) e reinserido como mensagem `system`. O prompt dessa chamada
é pt-BR e não dizia nada sobre idioma: numa conversa em inglês, ou com dois
idiomas, o resumo saía traduzido, e o modelo seguinte lia a própria memória na
língua do prompt de resumo — o desvio de idioma que o épico de idioma persegue,
nascido fora do turno do usuário. A orientação de idioma do turno não protege
isto: ela nunca está em `messages`, então nunca é resumida, mas também nunca é
vista pelo sumarizador.

A regra é uma frase no prompt de resumo, nas DUAS trilhas (o texto inline e o
template versionado `prompts/context-manager-summarize.md`, que sobe para a
versão `"2"`):

> Mantenha cada turno no idioma original; não traduza citações nem código.

1. **O idioma é POR TURNO**, nunca um idioma da sessão: numa sessão com dois
   autores de línguas diferentes, os dois sobrevivem ao resumo.
2. **Citação e código são texto literal** e não se traduzem — um identificador
   ou uma mensagem de erro traduzida no resumo deixa de ser encontrável.
3. **A frase vem ANTES dos turnos**, para que o texto de um turno no fim do
   prompt não seja lido como continuação dela.
4. **Custo:** o acréscimo é de 76 bytes — 19 tokens pela heurística do engine
   (bytes/4), no máximo 38 por uma régua pessimista de 1 token a cada 2 bytes —,
   dentro do teto de 50 tokens de entrada por chamada decidido pelo mantenedor
   para a orientação de idioma (AT-169, resposta 8). O teste reprova a frase que
   passar dele pelas duas réguas.
5. **Não é `agent_instructions`:** é texto de código e de template versionado,
   fora do teto de `instruction_patch` ([RN-007](api.md#rn-007)), porque o sumarizador
   não é agente de projeto e não tem instrução por projeto.

**Decidido sem linha de base, declarado:** o mantenedor decidiu mudar o prompt
já, sem esperar a validação paga mostrar que o resumo em pt-BR desvia (AT-169,
resposta 4). A consequência é que a validação da AT-167 mede o CONJUNTO
(orientação + resumo novo), sem medir o resumo antigo isolado.

**O que esta regra NÃO fecha, declarado:**

- **Com `graph_templates_enabled?` ligada, vale a versão ATIVA no grafo.** Uma
  instalação que semeou a versão `"1"` continua mandando o prompt antigo até
  rodar `scripts/dev/seed-prompts.ts` de novo — o hash do corpo mudou, então o
  seeder cria a versão nova. Com a flag desligada (o default) vale o inline, que
  já tem a frase. Semear de novo também tira do corpo a seção de documentação
  que fazia o sumarizador receber os turnos em dobro (AT-244, ver
  [RN-413](infra.md#rn-413)); o template está na versão `"3"`.
- **O fallback de quando o sumarizador falha** (`"(N turnos anteriores
  omitidos)"`) não é resumo e não ganha a frase: não há texto de turno nele.
- **A frase é pt-BR.** Ela pede o idioma de cada turno, não o do prompt; se um
  modelo a obedece em conversa de outra língua é o que a validação da AT-167
  mede.

- **Código:** `apps/engine/lib/engine/harness/context_manager.ex:214`
  (`@instrucao_de_idioma`), `:276` (`prompt_inline`), `:233` (`prompt`, a
  escolha entre template e inline); `prompts/context-manager-summarize.md`
- **Teste:** `apps/engine/test/engine/harness/context_manager_test.exs:417`
  (caminho feliz: o prompt enviado ao sumarizador tem a frase, antes dos
  turnos), `:433` (o teto de 50 tokens, pelas duas réguas), `:443` (o template
  versionado carrega a MESMA frase), `:453` (falha do sumarizador: o fallback
  não finge resumo nem ganha a frase)
- **Origem:** AT-166, especificada na AT-081 e destravada pela AT-169
  (decisões do mantenedor de 2026-09-28)

## O idioma das respostas dos agentes (RN-618..620, RN-622..624, ADR 0177)

### RN-622 — O idioma chega ao modelo como a ÚLTIMA mensagem de cada chamada do turno, efêmera: o do AUTOR quando há um, o do PROJETO quando não há {#rn-622}

As RN-618..620 decidiram EM QUE idioma o agente responde e mostraram isso na
tela; nada disso chegava ao modelo. Esta regra é o transporte (AT-164, sobre a
especificação da AT-081 e o mecanismo verificado por provider na AT-161).

1. **Uma mensagem `role: "system"` no FIM da lista, a cada chamada de LLM do
   turno** — inclusive as iterações de ferramenta —, e NUNCA no histórico:
   ela não entra em `state.messages`, então não se acumula de turno em turno,
   não é resumida pela compactação ([RN-621](#rn-621)) e some com o turno. No
   OpenAI-compatível ela vai no fim da conversa; no Anthropic é içada para o
   fim do `system` do topo (AT-161). Não é `agent_instructions`: é texto de
   código, fora do teto de `instruction_patch` ([RN-007](api.md#rn-007)).
2. **Um lugar só.** Quem acrescenta é a fachada `EngineApiClient`
   (`llm_turn/5` e `llm_turn_stream/6`), por onde passa TODA chamada de LLM do
   engine — os sete conversacionais, o `ToolLoop` (dev agents e gates) e o
   Infra Lead. Nenhum servidor monta a orientação.
3. **Turno COM autor humano** (a mensagem que alguém digitou a um agente): a
   api resolve o idioma DAQUELA pessoa naquela sessão
   (`ResolverIdiomaDaRespostaUseCase`, [RN-618](api.md#rn-618) — override da sessão
   > conta > detectado confirmado > interface) e o manda no comando
   `agent/message` como `idiomaDaResposta`, campo OPCIONAL. O servidor do
   agente o põe no estado do TURNO durante o `handle_call`, e a Task do turno
   o herda do dicionário de processo (`TurnoAssincrono`); o GenServer não o
   guarda para o turno seguinte. Dois autores na mesma sessão recebem cada um
   o seu.
4. **Turno SEM autor humano** (kickoff, dev agents, gates, commit, corpo de
   PR, a retomada do Dev Lead depois da aprovação): o idioma do PROJETO
   ([RN-619](api.md#rn-619)), lido de `projects.language` a cada chamada (decisão do
   mantenedor, AT-169 resposta 1).
5. **O sumarizador da compactação (`context-manager`) fica fora**: "responda
   em X" traduziria o resumo, e preservar o idioma de cada turno nele é a
   [RN-621](#rn-621).
6. **Falha nunca derruba o turno.** A resolução que falha na api vira log e a
   mensagem segue SEM `idiomaDaResposta`; turno com autor sem idioma segue
   SEM orientação — nunca o do projeto no lugar do da pessoa. A leitura do
   idioma do projeto que falha no engine vira `warning` e a chamada segue sem
   orientação. Valor que não tem forma de código BCP-47 também não vira
   orientação: nada que não seja um código é interpolado no prompt.
7. **Os textos** são constantes de código, um por idioma: `pt-BR` ("Responda
   em português brasileiro (pt-BR), salvo pedido explícito do usuário por
   outro idioma nesta mensagem."), `en`, e um genérico em inglês que nomeia o
   código BCP-47 para qualquer outro idioma da lista aberta (AT-168
   resposta 2). O texto não depende do modelo: trocar de modelo no meio da
   sessão não muda nada, e não há cascata por modelo nem caso especial de
   DeepSeek.
8. **Custo** — teto decidido de 50 tokens de ENTRADA por chamada (AT-169
   resposta 8). Medido com `gpt-tokenizer`, só o conteúdo, cl100k / o200k:
   `pt-BR` 29 / 23, `en` 18 / 18, genérico `es-MX` 26 / 26 e o PIOR caso (o
   genérico com o código mais longo que a forma aceita) 42 / 42; a moldura
   de mensagem soma ~4, então o pior caso fica em ~46. O teste trava o texto
   em 160 caracteres como vigia do teto.
9. **Medição:** o `chat.message` gravado pela api carrega `idiomaAlvo` e
   `origem` quando a resolução deu certo — o evento é imutável e diz, para
   sempre, o que foi pedido ao modelo naquele turno (AT-082).

**O que esta regra NÃO fecha, declarado:**

- **Chat humano sem agente** (`SendChatMessageUseCase`) fica fora, por
  decisão do mantenedor (AT-169 resposta 3).
- **Só a MENSAGEM a um agente carrega autor** (e a resposta ao formulário de
  pergunta estruturada, que a reusa). Os outros comandos que uma pessoa
  dispara — confirmar prontidão ao Criativo, aceitar handoff — sobem turno
  sem autor e caem no idioma do PROJETO: o product brief do
  `confirmReadiness` sai no idioma do projeto.
- **Artefato de turno com autor**: esta regra o declarava seguindo o idioma de
  quem escreveu; desde a [RN-623](#rn-623) a mesma mensagem ganha a cláusula
  do artefato, no idioma do projeto.
- **Não medido:** o tokenizador do DeepSeek e o da Anthropic; se a orientação
  basta contra o prompt de sistema em pt-BR é o que a validação paga da
  AT-167 mede. No Anthropic, a orientação içada ao topo muda o prefixo do
  cache a cada troca de autor ou de idioma — cache não é observável hoje.

- **Código:** `apps/engine/lib/engine/harness/idioma_da_resposta.ex:294`
  (`anexar`), `:253` (`com_idioma_do_autor`), `:161` (`orientacao`), `:94`
  (`@sem_orientacao`), `:301` (`texto_do_turno`), `:326`
  (`idioma_do_projeto`);
  `apps/engine/lib/engine/sessions/engine_api_client.ex:714`
  (`IdiomaDaResposta`), `:828` (`IdiomaDaResposta`);

  `apps/engine/lib/engine/sessions/engine_api_client.ex:714`
  (`IdiomaDaResposta`), `:828` (`IdiomaDaResposta`);
  `apps/engine/lib/engine/projects/project.ex:64` (`idioma`);
  `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:527`
  (`idioma_da_resposta`);
  `apps/engine/lib/engine/agents/criativo_server.ex:140` (`handle_call`, e a
  MESMA cláusula nos outros seis);
  `apps/engine/lib/engine/agents/turno_assincrono.ex:134`
  (`copiar_dicionario`);
  `apps/api/src/application/use-cases/agents/send-agent-message.use-case.ts:151`
  (`resolverIdioma`), `:155` (`idiomaAlvo`);
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts:215`
  (`idiomaDaResposta`)
- **Teste:** `apps/engine/test/engine/harness/idioma_da_resposta_test.exs:78`
  (sem autor: o idioma do projeto, no fim), `:123` (com autor: o do autor
  vence o do projeto), `:134` (autor sem idioma resolvido: sem orientação),
  `:98` (a consulta que falha — caso de falha: lista intacta e log), `:93` (o
  sumarizador fica fora), `:67` (o vigia do teto de 50 tokens), `:340` (ponta
  a ponta: o idioma do autor no fim de cada chamada e fora do histórico),
  `:370` (a fachada também anexa no `llm_turn/5`);
  `apps/engine/test/engine_web/controllers/agent_command_controller_test.exs:402`
  (o comando leva o idioma até o modelo), `:414` (campo inválido: aceito, sem
  orientação);
  `apps/api/test/application/use-cases/agents/send-agent-message.use-case.spec.ts:109`
  (resolve pelo autor e pela sessão — o override da sessão vence), `:125` (a
  resolução que falha não derruba a mensagem — caso de falha);
  `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts:528`
  (o campo viaja só quando resolvido)
- **Origem:** AT-164, especificada na AT-081 e destravada pelas decisões das
  AT-168 e AT-169 (mantenedor, 2026-09-28); mecanismo verificado na AT-161

### RN-623 — Num turno COM autor, a resposta é no idioma da pessoa e o ARTEFATO compartilhado é no idioma do PROJETO {#rn-623}

A [RN-619](api.md#rn-619) prometeu o idioma do projeto para o artefato
compartilhado, e a [RN-622](#rn-622) pôs o idioma do AUTOR em todo turno com
autor — então o que um agente gravava DURANTE a conversa com uma pessoa saía no
idioma dela. Decisão do mantenedor (AT-168 resposta 8, AT-245): **o artefato
segue o PROJETO**; a resposta de chat continua no idioma do autor.

1. **O mecanismo é a mesma mensagem da RN-622, com uma segunda cláusula.**
   Num turno com autor, quando a chamada leva ao menos uma ferramenta que
   grava artefato compartilhado e o idioma do projeto (`projects.language`)
   DIFERE do do autor, a orientação vira "Responda em português brasileiro
   (pt-BR), salvo pedido… **Artefatos do projeto: em en.**" — no idioma do
   texto base: a cláusula do `pt-BR` é em português, a dos outros em inglês
   ("Write project artifacts in X."). Continua UMA mensagem `system` efêmera
   no fim, montada pela fachada; quem decide é o conjunto de ferramentas que a
   MESMA chamada leva ao modelo, que a fachada já tem.
2. **Por que a orientação, e não a descrição da ferramenta.** A descrição
   viaja em TODA chamada, em cada ferramenta, com os idiomas iguais ou não; a
   cláusula existe só quando eles diferem, e mora no único lugar que já decide
   o idioma. Sem acréscimo nenhum quando os idiomas são iguais, quando a
   chamada não tem ferramenta de artefato, e em turno SEM autor (que já recebe
   o idioma do projeto).
3. **O que é artefato compartilhado** — o que a ferramenta PERSISTE é lido por
   outras pessoas e pelos próximos agentes:
   - `emit_artifact` (`business_rule`, `note`, `decision_record`) — Criativo,
     PO, Arquiteto, Dev Lead, UX Designer, Staff;
   - `create_epic`, `create_story`, `create_task` — PO;
   - `create_module_map`, `assign_story_modules`, `choose_project_image`,
     `create_c4_diagram`, `route_modules_to_infra`, `propose_adr` (o ADR de
     `open_adr_pr`), `emit_insight` — Arquiteto;
   - `propose_execution_plan`, `assess_implementability` — Dev Lead;
   - `propose_prototype` — UX Designer; `propose_rfc` — Staff;
   - `propose_infra_pr` — Infra Lead.
   O product brief NÃO passa por aqui: ele é emitido pelo SERVIDOR no
   `confirmReadiness`, que é turno sem autor e já sai no idioma do projeto
   (como o handoff e o revise, que esta regra não muda).
4. **O que NÃO é:** `ask_structured_questions` (é pergunta à PESSOA do
   turno), `offer_handoff` (não leva texto), as de leitura (`listar_*`,
   `rag_*`, `read_file`, `search_workspace`), `validate_infra_file` (só
   valida) e as propostas de subir container (pedem decisão, não gravam
   artefato). Os dev agents e os gates não têm turno com autor.
5. **Falha nunca derruba o turno.** Ler o idioma do projeto que falha vira
   `warning` e segue SÓ a orientação do autor — nunca sem orientação, nunca a
   do projeto no lugar da da pessoa. Autor sem idioma resolvido segue sem
   orientação, como na RN-622.
6. **Custo** — o teto de 50 tokens de entrada da AT-169 vale para a mensagem
   inteira. Medido com `gpt-tokenizer`, só o conteúdo, cl100k / o200k, sobre
   todos os pares de `pt-BR`, `en`, `es`, `es-MX` e `zh-Hant-TW`: pior caso
   `pt-BR` → `zh-Hant-TW` 42 / 36; `en` → `pt-BR` 26 / 26; genérico `es-MX` →
   `zh-Hant-TW` 36 / 36. A cláusula só entra com os DOIS códigos na forma
   canônica curta (`idioma[-Escrita][-Região]`, ex.: `pt-BR`, `zh-Hant-TW`,
   `es-419`), porque é a FORMA que segura o teto: o pior dela (`pt-BR` → código
   de 12 caracteres) mede 44 / 37, ~48 com a moldura da mensagem. Código fora
   dessa forma fica só com a orientação do autor, e o log diz. O teste trava
   todo par em 165 caracteres como vigia.

**O que esta regra NÃO fecha, declarado:** a lista é por NOME de ferramenta —
ferramenta nova que grave artefato entra nela no mesmo PR (o teste amarra
cada nome a uma spec que existe, mas não descobre ferramenta nova). Se o
modelo SEGUE as duas cláusulas na mesma mensagem é o que a validação paga da
AT-167 mede; os tokenizadores do DeepSeek e da Anthropic seguem não medidos.

- **Código:** `apps/engine/lib/engine/harness/idioma_da_resposta.ex:174`
  (`orientacao`), `:127` (`@ferramentas_de_artefato`), `:118`
  (`@forma_curta`), `:301` (`texto_do_turno`), `:319` (`grava_artefato?`),
  `:320` (`idioma_do_projeto_para_o_artefato`);
  `apps/engine/lib/engine/sessions/engine_api_client.ex:714`
  (`IdiomaDaResposta`), `:828` (`IdiomaDaResposta`);

  `apps/engine/lib/engine/sessions/engine_api_client.ex:714`
  (`IdiomaDaResposta`), `:828` (`IdiomaDaResposta`);
  `apps/web/src/routes/settings/ProjectLanguageSection.tsx`
- **Teste:** `apps/engine/test/engine/harness/idioma_da_resposta_test.exs:157`
  (idiomas diferentes: a orientação diz os dois), `:168` (iguais: só um),
  `:175` (código fora da forma curta: só o do autor, com log), `:190` (o vigia
  do teto), `:204` (cada nome da lista é uma spec que existe), `:235` (autor
  pt-BR, projeto en, numa mensagem só), `:259` (sem ferramenta de artefato:
  só o autor), `:290` (idioma do projeto ilegível — caso de falha: só o do
  autor, com log), `:316` (sem autor: nada muda), `:340` (ponta a ponta pelo
  Criativo); `apps/web/src/routes/settings/idioma-do-projeto.test.tsx:84`
- **Origem:** AT-245, sobre a decisão da AT-168 (resposta 8) e as do
  mantenedor de 2026-09-29

### RN-625 — O laço pergunta ao Jev qual ferramenta, e o modelo do usuário vê só o menu que sobra; o Jev restringe e nunca decide {#rn-625}

Decisão do mantenedor (AT-236, 2026-09-28) e, sobre o critério, de 2026-09-29:
antes de cada chamada de chat de um agente, a api pergunta ao Jev
(`typesafe/jev-1.13`, Decisions API do OpenRouter) qual ferramenta cabe no
passo, e o provider de chat recebe só o **menu** que a política P3 tira dessa
resposta. O mecanismo está no [ADR 0179](../adr/0179-o-laco-pergunta-ao-jev-qual-ferramenta.md);
a decisão de adoção, com os números, também.

1. **Quando.** Só com o provider do modelo do turno igual a `openrouter`, com
   duas ou mais ferramentas no pedido, com agente no turno (fora a Anamnese e o
   sumarizador da compactação), sem `catalogoCompleto` pedido pelo engine e com
   o workspace ligado (`workspaces.tool_router_enabled`, padrão ligado,
   `PUT workspaces/:workspaceId/tool-router`, `owner`). Qualquer condição falha:
   nenhuma chamada, nenhum evento. Com provider ≠ `openrouter` nem o workspace é
   lido. A chave é a do titular do workspace, a mesma do chat (RN-058).
2. **A política é a P3 e só restringe.** Menu = {escolha do Jev, ferramenta
   anterior da MESMA execução}. `responder_sem_ferramenta` do Jev, ou nenhuma
   ferramenta anterior no catálogo do passo, deixa o catálogo INTEIRO. Não há
   `tool_choice` (o modelo ainda pode responder em texto) e não há limiar de
   confiança na v1: a confiança é gravada e é da AT-239 propor um. Critério de
   adoção: **80%**, decisão do dono de 2026-09-29 — top-1 do Jev 73% (66–79),
   cobertura de menu da P3 91% (85,1–94), top-2 90%; cobertura é o TETO da
   acurácia ponta a ponta (62%–91% em replay), e a validação real é a AT-239.
3. **O `state`** é o que o produto tem antes do passo, recortado das `messages`
   que o engine já manda, sem leitura de banco: `agente` = o `agentId`;
   `contexto` = o começo (1.500 caracteres) da mensagem `system` que o
   `ToolLoop` põe na frente (`apps/engine/lib/engine/harness/tool_loop.ex:98`,
   `system_msg`, montada por `system_prompt/1` em `:316`); `pedido` = a última
   mensagem `user` — nos agentes de execução a mensagem inicial do laço
   (`apps/engine/lib/engine/dev/dev_agent_server.ex:484`, `initial_message/2`,
   ou a de correção em `:523`), nos conversacionais a fala da pessoa; e
   `passos_recentes` = as 6 últimas chamadas de ferramenta depois dessa
   mensagem, uma entrada por chamada, argumento e resultado cortados em 500
   caracteres — o resultado vem da mensagem `tool` que o laço anexa
   (`tool_loop.ex:293`, `concluir_despacho/5`, com `toolCallId`). A execução
   corrente é "depois da última `user`" porque `ctx.messages` recomeça a cada
   `ToolLoop.run`. Teto de 8 mil tokens; estourou, queda `estado_grande`.
4. **O turno nunca falha por causa do Jev.** Erro HTTP, timeout (2.000 ms,
   `TOOL_ROUTER_TIMEOUT_MS`), erro de rede, JSON inesperado, escolha fora das
   opções, estado grande e colisão com o nome reservado: o provider recebe o
   catálogo inteiro e o evento leva `motivoDaQueda` e `origemDaQueda`
   (`infra`, `modelo` ou `codigo` — RN-059), nunca calado.
5. **A política não muda.** O Jev não aprova, não nega e não escolhe modelo. A
   ferramenta escolhida que exige aprovação continua exigindo; a chamada a uma
   ferramenta fora do cardápio é despachada como sempre e o evento só registra
   `foraDoCardapio`. O teto de iteração é o de antes (a chamada ao Jev não é uma
   iteração).
6. **Registro por passo.** O engine grava `tool_router.decided`, na fachada
   `EngineApiClient` para todos os agentes, com menu antes e depois, escolha,
   confiança, segunda opção, `aplicado`, queda, latência, custo real e
   `foraDoCardapio`. A api grava UMA linha de `token_usage` do Jev: ator = o
   próprio agente (o gasto entra no orçamento de área, ADR 0110), `modelName =
   typesafe/jev-1.13`, `modelId` nulo, `estimated = false`, `costMicros` = o
   `usage.cost` da resposta, preço por milhão IMPLÍCITO (`custo ÷ tokens`) com
   `price_implicit = true` — mantém `tokens × preço = custo` da RN-044 sem
   inventar preço de catálogo. Sem `usage.cost` na resposta não há linha. O gate
   de orçamento não é reconsultado entre o Jev e o chat.
7. **Sair do beco.** Menu restringido e o modelo responde sem chamar ferramenta
   (nem em texto recuperável), sem erro do provider: a fachada repete o passo UMA
   vez com `catalogoCompleto: true`, que pula o Jev. No stream, só se nada foi
   escrito para a pessoa. Pede mais ferramentas, nunca uma que o agente não tinha.

**O que esta regra NÃO fecha, declarado:** a tela (mostrar que o passo foi
roteado, com a confiança, e a faixa "escolhendo ferramenta" pelo frame
`tool_routing_started`) é de `apps/web`; o ganho é da AT-239; um timeout que o
OpenRouter cobrou sem devolver `usage.cost` não entra em `token_usage`; o
endpoint é ALPHA e o smoke manual
(`jev-tool-router.smoke.spec.ts`, teto US$ 0,05) é quem acusa a mudança.

- **Código:** `apps/api/src/domain/llm/tool-router.ts:27` (`MODELO_DO_JEV`),
  `:109` (`montarPedidoAoJev`), `:166` (`lerRespostaDoJev`), `:216`
  (`recortarEstado`), `:272` (`menuP3`);
  `apps/api/src/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.ts:118`
  (`preparar`), `:143` (`executar`), `:305` (`registrarGasto`);
  `apps/api/src/application/use-cases/llm/run-llm-turn.use-case.ts:190`
  (`decisaoDoJev`); `apps/api/src/application/use-cases/llm/stream-llm-turn.use-case.ts:212`
  (`preparar`); `apps/api/src/infrastructure/llm/jev-tool-router.ts:32`
  (`decidir`); `apps/api/src/db/schema/iam.ts:169` (`toolRouterEnabled`);
  `apps/api/src/db/schema/llm.ts:375` (`priceImplicit`);
  `apps/engine/lib/engine/harness/roteamento_de_ferramenta.ex:60` (`registrar`),
  `:112` (`custo_micros`), `:123` (`repetir_com_catalogo_inteiro?`), `:146`
  (`mesclar_repeticao`); `apps/engine/lib/engine/sessions/engine_api_client.ex:730`
  (`llm_turn`), `:819` (`llm_turn_stream`);

  (`mesclar_repeticao`); `apps/engine/lib/engine/sessions/engine_api_client.ex:730`
  (`llm_turn`), `:819` (`llm_turn_stream`);
  `apps/engine/lib/engine/harness/tool_loop.ex:132` (o custo do Jev no orçamento
  local)
- **Teste:** `apps/api/test/domain/llm/tool-router.spec.ts:25` (`questions` é
  objeto), `:86` (forma inesperada vira queda — caso de falha), `:138` (o
  `state`), `:210` (a P3);
  `apps/api/test/infrastructure/llm/jev-tool-router.contract.spec.ts:60` (a
  resposta gravada), `:121` (erro HTTP), `:130` (timeout), `:142` (rede),
  `:149` e `:154` (JSON inesperado), `:163` (escolha fora das opções);
  `apps/api/test/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.spec.ts:186`
  (provider ≠ openrouter não chama), `:222` (workspace desligado), `:255`
  (estado grande), `:277` (a P3), `:318` (sem ferramenta = catálogo inteiro),
  `:331` (sem anterior = inteiro), `:352` (a política não muda), `:369` (as
  quedas), `:456` (o metering, no orçamento de área);
  `apps/engine/test/engine/harness/roteamento_de_ferramenta_test.exs:67` (o
  evento), `:103` (a queda no evento), `:180` (sair do beco), `:288` (o custo no
  laço), `:299` (a aprovação continua exigida), `:325` (o roteamento não conhece
  a política)
- **Origem:** AT-238, sobre a especificação da AT-235, as dezesseis decisões da
  AT-236, a medição da AT-237/AT-280 e a decisão do dono de 2026-09-29 (critério
  de 80%)

## Decidir no chat, onde o dono está (RN-626)

### RN-629 — O QA Lead trata o subagente que SUSPENDE de novo na retomada do mesmo jeito que na primeira vez, e resultado que não conhece vira bloqueio nomeado {#rn-629}

O `qa-automacao` roda vários comandos e cada um pode pedir aprovação humana. O
`QaLeadServer` já parava a área quando `run/5` devolvia `{:awaiting, _}` (achado
AB, ADR 0052), mas a RETOMADA (`retomar/3`, quando a decisão chega) devolvia o
resultado de um laço que podia suspender OUTRA vez — e esse segundo
`{:awaiting, _}` entrava na lista de resultados colhidos como se fosse parecer.
Ao consolidar, `registrar_resultado/5` não tinha cláusula para ele e o
GenServer caía (`FunctionClauseError`, medido em 29/09/2026: 06:55:01 e
07:00:10), deixando as três tasks entregues em `awaiting_qa` para sempre, sem
veredito e sem desfecho nomeado.

1. **Um só lugar decide o que fazer com o resultado de um subagente**
   (`tratar_resultado/6`), venha ele de `run/5` ou de `retomar/3`.
   `{:awaiting, _}` guarda o estado em voo (chaveado pela nova ação), mantém a
   linha de `gate_states` em `in_progress` com o subagente e PARA a área: sem
   veredito, sem bloquear a task, sem registrar a delegação. Quem retoma é o
   mesmo `{:action_settled, _}` do `Engine.Dev.Wake` (ADR 0086), quantas vezes
   forem necessárias.
2. **Resultado que o lead não conhece nunca derruba nem some** (RN-059): vira
   `{:blocked, …}` com origem `codigo` (falta uma cláusula aqui, não é infra,
   modelo nem política), que `registrar_resultado/5` grava como delegação
   `failed` e `QaLead.consolidar/1` transforma em bloqueio da task com a origem.

**Declarado, não resolvido:** o restart do engine com o lead suspenso perde a
inscrição no Wake (lacuna aceita do ADR 0086); o `GateRescuer` reinicia a área
inteira (ADR 0067), não retoma o `ctx`. Esta regra não muda o ADR 0090 (o
momento do QA-estratégia) nem o teto de iterações do subagente.

- **Código:** `apps/engine/lib/engine/gates/qa_lead_server.ex:127`
  (`handle_info`), `:237` (`tratar_resultado`), `:230` (resultado desconhecido)
- **Testes:** `apps/engine/test/engine/gates/qa_lead_server_test.exs:325`
  (segunda suspensão na retomada: fica suspenso, não decide nada, e a segunda
  decisão conclui a área); `:278` (uma suspensão, o caminho feliz)
- **Origem:** AT-248, sobre o achado E2 da análise de uso real de 2026-09-29

### RN-636 — O AppSec só oferece o threat model a quem ainda não recebeu oferta nem está ativo {#rn-636}

O AppSec criava três ofertas por história com `run_design`, aos mesmos três
destinos — N histórias, 3N ofertas pendentes (AT-292, que funde a AT-273 do
vault por decisão do dono; [ADR 0182](../adr/0182-ciclo-de-vida-do-handoff.md)).

1. **Pergunta no modo `seAusente`.** `criar_handoffs_appsec/3` chama
   `EngineApiClient.create_handoff_if_absent/5`, que manda `seAusente: true` à
   MESMA rota interna. A api decide sob o lock do destino ([RN-635](api.md#rn-635)):
   com oferta pendente em QUALQUER sessão do projeto, devolve a existente
   (`desfecho: ja_oferecido`) e não a substitui; com o destino ativo, 409
   `agente_ja_ativo`. Perguntar antes, pelo engine, seria corrida com outra
   oferta.
2. **"Já atendido" não é falha.** As duas respostas acima seguem sem
   `agent.error`. Falha de verdade (5xx, rede) continua narrada por alvo, com
   origem ([RN-116](#rn-116), [RN-361](#rn-361)).
3. **O artefato fica.** O `artifact.threat_model` é gravado ANTES e de qualquer
   jeito; o que deixa de nascer é a oferta repetida.

- **Onde:** `apps/engine/lib/engine/gates/secops_agent_server.ex:377`
  (`criar_handoffs_appsec/3`);
  `apps/engine/lib/engine/sessions/engine_api_client.ex:1131`

  `apps/engine/lib/engine/sessions/engine_api_client.ex:1278`
  (`create_handoff_if_absent`);
  `apps/api/src/domain/sessions/ciclo-de-vida-do-handoff.ts:71`
  (`decidirOferta`)
- **Teste:** `apps/engine/test/engine/gates/secops_agent_server_test.exs`
  ("run_design (RN-636): destino com oferta pendente ou já ativo não recebe
  outra, e isso não é erro", "run_design (RN-636): falha de verdade ao
  oferecer segue narrada, só para aquele destino");
  `apps/api/test/application/use-cases/agents/ciclo-de-vida-do-handoff.spec.ts`
  ("`seAusente` (AppSec, RN-636)…")
- **Origem:** AT-292, AT-273

## A PR do dev agent mira `dev`, e o gate julga o diff dessa PR (RN-664)

### RN-664 — O trabalho dos agentes nasce de `dev`, a PR deles mira `dev`, e o gate julga o diff contra `dev` — os três juntos {#rn-664}

A política de branches do produto manda o trabalho nascer de `dev` (o bootstrap
cria `dev` e `qa` a partir de `main`, [RN-582](api.md#rn-582)), mas até aqui ninguém
apontava os agentes para ela: o `pr_open` do dev agent não levava
`targetBranch` e a api completava com `repo.defaultBranch` (`main`); a PR de
ADR do Arquiteto nascia de `main` e mirava `main`; o working tree do projeto
abria a `default_branch`; o gate calculava o diff contra ela; e o contexto do
QA dizia "Repositório · branch main" (AT-250, item A4 do uso real de 29/09).
Toda PR de agente pulava a esteira `dev → qa → main`.

Decisão do dono (30/09): os TRÊS passam a usar `dev`, juntos — mudar só um
deixaria o gate julgando um diff que não é o da PR. A branch de TRABALHO é
`dev` e NÃO é a `default_branch` do provider (que segue sendo a que a promoção
alcança por último e continua lida onde ela é a pergunta):

- o working tree do projeto abre `dev` (`ensure_remoto/2` ignora o
  `default_branch` do remoto para escolher a base), e o worktree de cada dev
  agent nasce de `dev` EXPLICITAMENTE, não do HEAD — workspace inicializado
  antes desta regra está parado na `default_branch` (a marca de pronto impede
  re-inicializar) e ganha a `dev` local a partir de `origin/dev`, sem `fetch`
  novo;
- o `pr_open` do dev agent leva `targetBranch: "dev"` no payload, e a api, sem
  o campo (ação proposta antes), completa com `dev` e não mais com a
  `defaultBranch`; a PR de ADR nasce de `dev` e mira `dev`;
- o diff do gate é `dev...HEAD`, e a linha de contexto do projeto diz
  "Repositório · branch de trabalho dev".

**Repositório SEM `dev`** (adotado sem bootstrap, ou bootstrap que não chegou a
`create_dev_branch`): NÃO há queda para a `default_branch` — seria o agente
trabalhando e o gate julgando sobre uma base que não é a da PR. Cada ponto
falha NOMEADO, pelo comportamento que já tinha para branch ausente, com uma
exceção nova: o working tree recusava nada e criava uma `dev` LOCAL VAZIA
(o caminho do bare que nunca recebeu push), marcava pronto e nunca mais
re-inicializava. Agora esse caminho só vale para o remoto SEM branch nenhuma;
com branches e sem `origin/dev`, a inicialização levanta com a mensagem
nomeada (`mensagem_sem_branch_de_trabalho/1`, "o repositório do projeto não
tem a branch `dev`… crie a branch… e tente de novo") e o `.git` é desfeito
(AT-112), então a próxima tentativa, com a `dev` criada, inicializa normal. O
worktree recusa com a mesma mensagem quando não há `dev` nem `origin/dev`; o
diff falha com o erro do git nomeando a revisão; o provider recusa a PR (e a
criação da branch do ADR) nomeando a ref. O `infra` (`open_infra_pr`) NÃO
mudou: segue nascendo e mirando a `defaultBranch`.

O valor mora em DOIS lugares, de propósito, um por linguagem, e mudam juntos:
`BRANCH_DE_TRABALHO` na api e `branch_de_trabalho/0` no engine.

- **Código:** `apps/engine/lib/engine/projects/project_repository.ex:165`
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
- **Teste:** `apps/engine/test/engine/gates/diff_test.exs:64` (o diff é só a
  mudança do agente, nada da `main` — caminho feliz), `:73` (sem `dev` o diff
  falha nomeando a revisão — caso de falha), `:91` (o contexto diz a branch de
  trabalho); `apps/engine/test/engine/actions/workspace_test.exs:87`, `:98`,
  `:110` (repositório adotado sem `dev`: recusa nomeada, `.git` desfeito, e
  passa depois de criada a branch — caso de falha), `:130`;
  `apps/engine/test/engine/dev/worktree_manager_test.exs:119`, `:127`
  (workspace de antes da regra), `:147` (sem `dev` nem `origin/dev`);
  `apps/engine/test/engine/dev/dev_agent_server_test.exs:114`;
  `apps/api/test/application/use-cases/actions/execute-git-action.use-case.spec.ts:184`,
  `:213`; `apps/api/test/application/use-cases/actions/execute-adr-pr.use-case.spec.ts:143`,
  `:151` (sem `dev`, `failed` com o motivo do provider)
- **Origem:** AT-250 (item A4 da análise do uso real de 29/09), decisão do dono
  de 30/09

## O idioma das respostas dos agentes (RN-618..620, RN-622..624, ADR 0177)

### RN-667 — O formulário estruturado segue o idioma da resposta: a descrição da ferramenta não fixa idioma nenhum {#rn-667}

A validação paga da AT-167 achou, para autor com preferência `en` (C06/C12),
a chamada `ask_structured_questions` com a **prosa em inglês e as perguntas do
formulário em português** — no DeepSeek tratado, 8 das 15 respostas de
C06+C12. A causa é do produto, e mora num lugar só: a descrição da ferramenta
dizia que `label` era "o texto da pergunta, **em pt-BR**". Era uma SEGUNDA
orientação de idioma, fixa, fora da fachada da [RN-622](#rn-622), competindo
com ela em toda chamada do Criativo e do PO (as duas usam a MESMA spec).

1. **O mecanismo é tirar a orientação concorrente, não acrescentar outra.** A
   descrição passou a dizer "o texto da pergunta, **no idioma da sua
   resposta** (vale também para `options`)", e o exemplo, que segue em
   português, é marcado "os textos seguem o idioma da sua resposta". Ela não
   nomeia idioma NENHUM: QUAL é o idioma continua decidido só pela mensagem
   efêmera de `Engine.Harness.IdiomaDaResposta`, e a fachada `EngineApiClient`
   não muda.
2. **A orientação da RN-622/623 fica byte a byte.** Zero token a mais nos 50
   de teto. `ask_structured_questions` segue FORA de `@ferramentas_de_artefato`
   (é pergunta à pessoa do turno, [RN-623](#rn-623) item 4), então autor `en`
   num projeto `pt-BR` recebe as perguntas em inglês — e é o que se quer.
3. **Custo, onde ele cai.** A descrição viaja em toda chamada que leva a
   ferramenta, com qualquer autor: medido com `gpt-tokenizer`, só o texto que
   mudou, +23 tokens em cl100k e +19 em o200k (a linha de `label` 18/17 → 29/27;
   a do exemplo 8/6 → 20/15). Não é a orientação indo para a descrição — a
   frase aponta para ela sem dizer idioma, e o que foi embora era justamente a
   frase que dizia um.
4. **Guarda.** Nenhuma descrição de ferramenta do harness (as 22 de
   `Engine.Harness.Tools.*`) pode citar `pt-BR`, `(en)`, "in English", "em
   português" ou "em inglês" — a do `emit_artifact`, que exige as CHAVES do
   payload "em INGLÊS", fica de fora porque fala de contrato, não de texto para
   a pessoa.

**O que esta regra NÃO fecha, declarado:** a medição paga antes/depois
**não rodou** (sem chave do OpenRouter na máquina da mudança) — o "antes" é o
da AT-167 (DeepSeek tratado: 8 de 15 respostas de C06+C12 com o formulário em
português), e o "depois" é **pendência do dono**:
`pnpm --filter @brabo/scripts idioma:validar --arquivo-de-chave ~/.config/brabo/openrouter-test.env --bracos tratamento --casos C06,C12 --rodadas 5 --teto-usd 0.5 --saida ~/.cache/brabo/validacao-idioma/at-282`,
seguido de `idioma:validar --relatorio --saida` na mesma pasta e da revisão do
formulário (rótulo `formulario` do `idioma:revisar`). Teto sugerido US$ 0,50:
o braço tratado inteiro custou US$ 0,21 (DeepSeek) e US$ 0,94 (Haiku) em
17 casos, e estes são 2. O script lê a descrição do arquivo do produto, então
mede o texto novo sem cópia. Se o formulário continuar em português com a
descrição neutra, o passo seguinte é uma cláusula condicional na orientação
(só quando a chamada leva `ask_structured_questions`), e ela tem de caber no
pior caso da RN-623 (44 / 37), que já está a ~48 com a moldura.

- **Código:** `apps/engine/lib/engine/harness/tools/ask_structured_questions.ex:193`
  (`descricao`), `:44` (`spec`)
- **Teste:** `apps/engine/test/engine/harness/tools/ask_structured_questions_test.exs:199`
  (a descrição manda seguir o idioma da resposta), `:207` (não nomeia idioma
  — caso de falha: a forma antiga "em pt-BR" é reprovada pela mesma régua),
  `:214` (nenhuma das ferramentas do harness fixa idioma);
  `scripts/idioma/validacao.spec.ts:60` (a medição lê a descrição nova)
- **Origem:** AT-282, da revisão humana da AT-167 (PR #750, 29/09); entrada
  na rodada aprovada pelo mantenedor em 2026-09-30

## O Infra Lead não anuncia subida que não fez (RN-668)

### RN-668 — O que o turno do Infra Lead anuncia sobre a subida do container é decidido pelo código, não pelo texto do modelo {#rn-668}

É a [RN-163](#rn-163) ("nada se anuncia que o
código não vá executar") aplicada ao Infra Lead. No uso real de 29/09 (sessão
`be70`, seq 282) ele escreveu que subiria o container "em paralelo" à PR de
infra, e nenhum `tool.call` de subida veio depois (AT-264). Havia duas causas no
código, e as duas fecham aqui:

1. **O lote inteiro da resposta é despachado antes do encerramento.**
   `propose_infra_pr` aceita encerra o turno sem nova ida ao modelo — é o único
   ponto em que o CÓDIGO corta o laço com o modelo querendo continuar —, mas
   ela parava o despacho no MEIO do lote: uma `propose_container_start` (ou
   `container_start_via_runner`) pedida na MESMA resposta, depois da PR, sumia
   sem `tool.call`, sem `tool.result` e sem aviso. Agora é a forma do Dev Lead
   (`propose_execution_plan`): todas as chamadas da resposta rodam, e só depois
   a PR aceita encerra o turno. Uma segunda `propose_infra_pr` na mesma resposta
   é recusada com motivo (`tool.call` + `tool.result` com `ok: false`) — só a
   primeira consolida com o Workflows.
2. **O fecho do turno diz, com frase do SERVIDOR, quando a subida NÃO foi
   proposta** — a forma do desfecho consolidado do Criativo (`encerrar/2`). A
   decisão é pelo que o laço executou (alguma proposta de subida ACEITA pela api
   neste turno?), nunca pelo que o modelo escreveu; não há leitura do texto
   dele. Fala-se em dois casos: o turno terminou pela PR e nenhuma subida foi
   proposta; ou uma subida foi tentada, recusada, e nenhuma proposta aceita veio
   depois. Turno que nunca tocou na subida (uma pergunta, uma correção de gate)
   não ganha frase nenhuma, e container já REGISTRADO `running`/`provisioning`
   também não (a mesma leitura local de `recusa_ja_de_pe/2`, sem HTTP).

O kickoff e a descrição de `propose_infra_pr` passam a dizer o que o código faz:
a subida vem ANTES da PR ou na MESMA resposta, porque a PR encerra o turno. Isso
é ajuda ao modelo, não a garantia — a garantia é o fecho do item 2.

Nada aqui sobe container nem propõe subida, com as recusas por modo e estado
intactas (RN-566/RN-610). Desde a [RN-671](api.md#rn-671) (AT-260) a primeira subida
é passo do SERVIDOR no kickoff, marcada pelo MESMO `registrar_subida`: no caso
comum ela foi proposta e o fecho do item 2 não tem o que dizer; ele segue
falando quando a subida do servidor foi recusada (ou NEGADA pela política, que
desde então conta como recusa) e quando ela não cabia ao servidor (sem
roteamento, `runner`) e o modelo não a propôs.

- **Código:** `apps/engine/lib/engine/infra/infra_lead_server.ex:505`
  (`dispatch_calls`), `:541` (`recusa_pr_repetida_no_lote`), `:1252`
  (`registrar_subida`), `:1254` (`fechar_subida`), `:1155`

  (`dispatch_calls`), `:539` (`recusa_pr_repetida_no_lote`), `:1140`
  (`registrar_subida`), `:1150` (`fechar_subida`), `:1154`
  (`desfecho_da_subida`); `apps/engine/lib/engine/infra/tools/propose_infra_pr.ex`
  (a descrição da tool)
- **Teste:** `apps/engine/test/engine/infra/infra_lead_server_test.exs:1075`
  (a subida pedida depois da PR na mesma resposta é despachada — caminho feliz),
  `:1107` (a PR encerra o turno sem subida e o fio diz — caso de falha),
  `:1147` (subida recusada e prometida, sem proposta: o fecho diz), `:1132`
  (container já de pé: nada a dizer), `:1169` (recusa corrigida no turno: sem
  frase), `:1190` (turno sem subida: sem frase), `:1199` (segunda
  `propose_infra_pr` no lote é recusada)
- **Origem:** AT-264 (uso real de 2026-09-29, item A18 da análise)

## O git credenciado roda no host do runner (RN-676)

### RN-673 — A mensagem que chega com turno em curso entra numa fila persistida no log e é lida no fim do turno, N mensagens num turno só {#rn-673}

Até aqui a mensagem que chegava a um agente conversacional no meio de um turno
era 409 `turno_em_andamento` ([RN-578](#rn-578)): gravada como `chat.message`
(a api grava antes de falar com o engine) e nunca lida. O uso real de 29/09
mediu três numa sessão só — PO, Infra Lead e Dev Lead. Decisão do dono (01/10),
para os SETE conversacionais pelo mesmo caminho:

1. **Fila, não recusa.** Com turno em curso, a mensagem entra na fila do agente
   (`TurnoAssincrono.receber_mensagem/4`), o agente grava `chat.message_queued`
   (`mensagemId`, `texto`, `idioma`, `posicao`) e o clique recebe 202 com
   `{entrega: "enfileirada", posicao}`. Sem turno, o turno sobe na hora, como
   sempre (`entrega: "lida"`). A rota da api devolve também o `mensagemId` — o
   id do `chat.message`.
2. **N mensagens = 1 turno.** No FIM do turno (`finalizar/1`, nunca
   `suspender/1`) as pendentes viram UM turno, na ordem de chegada, num texto só
   (`FilaDeMensagens.texto_do_turno/1`: uma é ela mesma; várias, numeradas), e o
   agente grava `chat.message_delivered` com os ids. A entrega é uma mensagem a
   si mesmo, depois do fecho do servidor (a correção de gate do Infra Lead e o
   handoff do Arquiteto vêm primeiro). A mensagem que chega entre o fim do turno
   e a entrega entra no FIM da fila, e a fila é entregue na hora.
3. **Teto de 10** pendentes por agente e sessão. A 11ª é 409
   `fila_de_mensagens_cheia`, com `agent.error` durável de origem `politica` —
   ela está gravada e não será lida.
4. **Cancelar.** `POST …/agents/:agent/messages/:messageId/cancel`
   (`developer`, o mínimo da rota de mensagem): só quem ENVIOU (403
   `mensagem_de_outra_pessoa`), só em sessão que aceita conversa
   ([RN-581](api.md#rn-581)). Quem decide se ela ainda está na fila é o processo do
   agente, que serializa a corrida com a entrega: 409 `mensagem_fora_da_fila`
   quando já foi lida ou cancelada. O engine grava `chat.message_cancelled` em
   nome de quem cancelou; com o agente fora do ar, grava direto (a fila é o log).
5. **Persistida no log, nunca em tabela.** Pendente = enfileirada e nem
   entregue nem cancelada — a mesma derivação no engine e na tela. O `init/1`
   dos sete reconstrói a fila e agenda a entrega; a [RN-580](#rn-580) tira do
   histórico a cancelada e a pendente do próprio agente; no boot, depois de
   fechar o turno órfão ([RN-586](#rn-586)), o agente com fila pendente é
   acordado. O turno interrompido continua nunca refeito.
6. **Turno suspenso em aprovação** (Dev Lead, RN-284) segue recusando com
   `aguardando_aprovacao` — sem fim previsto, enfileirar prometeria leitura sem
   data. A fila que já existia espera a retomada terminar.
7. **A tela.** Com turno em curso o composer não trava mais para mensagem a
   agente: o botão vira "Pôr na fila" e a mensagem não arma turno novo. No fio,
   "na fila de <agente>" com Cancelar para o autor, e "cancelada" riscada. O
   chat sem agente segue travando.

A recusa `turno_em_andamento` continua para o que não é fala: revisão de
história do PO, prontidão do Criativo, oferta de handoff do Arquiteto.

- **Código:** `apps/engine/lib/engine/agents/turno_assincrono.ex:322`
  (`receber_mensagem`), `:245` (`tratar_resultado`), `:519` (`entregar_fila`),
  `:380` (`cancelar_mensagem`), `:425` (`fila_ao_subir`), `:559`
  (`emitir_recusa_por_fila_cheia`);
  `apps/engine/lib/engine/agents/fila_de_mensagens.ex:71` (`pendentes`), `:111`
  (`fora_do_historico`), `:158` (`texto_do_turno`), `:182`
  (`acordar_pendentes`);
  `apps/engine/lib/engine/agents/reidratacao.ex:160` (`fora_do_historico`);
  `apps/engine/lib/engine/agents/dev_lead_server.ex:245` (`_mensagem_id`);
  `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:405`
  (`cancel_queued_message`), `:468` (`responder_ao_aceite`);
  `apps/api/src/application/use-cases/agents/cancel-queued-agent-message.use-case.ts:35`
  (`CancelQueuedAgentMessageUseCase`);
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts:69`
  (`entregaDaResposta`);
  `apps/api/src/domain/sessions/conversa-em-sessao-encerrada.ts:72`;
  `apps/web/src/lib/fila-de-mensagens.ts:27` (`estadosNaFila`);
  `apps/web/src/lib/enfileirar-mensagem.ts:25` (`useEnfileirarMensagem`);
  `apps/web/src/routes/PainelDaFila.tsx:20` (`PainelDaFila`, que substituiu o selo — RN-978)
- **Teste:** `apps/engine/test/engine/agents/fila_de_mensagens_test.exs:156`
  (entra na fila — caminho feliz), `:181` (N mensagens = 1 turno), `:223` (a
  que chega na janela vai ao fim), `:246` (teto de 10 — caso de falha), `:276`
  e `:306` (cancelar e cancelar fora da fila), `:322` (restart), `:349` (Dev
  Lead suspenso), `:78`/`:120` (derivação e reidratação);
  `apps/engine/test/engine_web/controllers/agent_command_controller_test.exs:70`;
  `apps/api/test/application/use-cases/agents/cancel-queued-agent-message.use-case.spec.ts:40`,
  `:61` (outra pessoa — caso de falha), `:95`, `:106`;
  `apps/api/test/application/use-cases/agents/send-agent-message.use-case.spec.ts:74`;
  `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts:531`;
  `apps/web/src/routes/SessionPage.fila-de-mensagens.test.tsx:163`, `:189`
  (fila cheia), `:207`, `:233`; `apps/web/src/lib/fila-de-mensagens.test.ts:17`
- **Origem:** AT-267 (item A21 da análise do uso real de 2026-09-29), decisão do
  dono de 01/10; [ADR 0191](../adr/0191-a-mensagem-com-turno-em-curso-entra-numa-fila.md)

**Complementada pela [RN-924](#rn-924).** A mesma ideia (estado da fila no log, reconstruído no `init/1`) vale para a correção de gate do Infra Lead, e a fila de mensagens espera o fim do turno retomado ([RN-920](#rn-920)).

## O plano de teste nasce depois da entrega do dev (RN-674, ADR 0192)

### RN-674 — A QA-estratégia escreve o plano sobre o código ENTREGUE, no começo do ciclo do `qa-verificada`, e o `implementavel` se julga sem ele {#rn-674}

No uso real de 29/09 o plano de teste PRE-DEV ([RN-341](contracts.md#rn-341)) terminou
duas vezes em `toolloop.limit_reached` 8/8 sem `emit_plano_de_teste`: o laço
leu docs, RAG vazio e pastas até concluir que "o código ainda não existe". O
dono decidiu (01/10) pela saída (b): o plano nasce DEPOIS da entrega. O
[ADR 0192](../adr/0192-plano-de-teste-depois-da-entrega.md) revisa o 0090 nesse
ponto, e a regra tem quatro partes:

1. **O plano é o primeiro passo do ciclo de revisão.** `run_area/3` do
   `QaLeadServer` obtém o plano da entrega ANTES das subespecialidades
   (`plano_de_teste_da_entrega/5`): reencontra na cauda da sessão (teto da
   reidratação, [RN-580](#rn-580)) o `artifact.plano_de_teste` da MESMA
   `taskId` — a rodada de correção não paga outro laço —, e senão roda
   `QaEstrategiaAgent.run/6` com o worktree do dev como `workspace_root`, as
   regras de negócio da task e a lista de arquivos que a entrega tocou
   (`git diff dev...HEAD`, até 40 nomes). Diff que falha vira texto ("não
   consegui listar: motivo"), nunca lista vazia.
2. **O plano é INSUMO, nunca veredito.** Ele chega à Automação no FIM da
   mensagem dela, para o passo de achar qual teste cobre cada regra; a régua do
   veredito não muda (uma linha de `coverageMatrix` por regra da story,
   `approved` só com suite verde e toda regra coberta) e o contrato externo
   segue sendo UM `qa_verdict` por ciclo. Plano que FALHA não segura a revisão:
   a QA-estratégia grava `agent.error` com origem ([RN-059](#rn-059))
   e a Automação recebe a mensagem de sempre, byte a byte.
3. **O `implementavel` se julga sobre a história e o `module_map`.**
   `run_assessment/2` não lê nem dispara plano: propõe o parecer na PRIMEIRA
   chamada, sobre o que o kickoff do Dev Lead já lhe dá, com payload
   `storyId`/`parecer`/`justificativa`. Gate, dono, severidade `warn` e
   aprovação humana não mudam; só a `entrada` (`[story-ready, module_map]`).
   O appsec ([RN-539](#rn-539)) segue disparando ali, no design.
4. **O teto continua 8.** `"qa-estrategia"` não ganha cláusula em
   `Iteracoes.tipo/1`; o que mudou foi o insumo. O agente passa a rodar sob o
   `task_budget_micros` que as subespecialidades compartilham
   ([RN-036](#rn-036)).

`run_design/3`, `Dispatcher.run_qa_estrategia/3` e `QaEstrategiaContext`
saíram, e `artifact.plano_de_teste` passa a exigir `taskId`. Declarado e não
decidido aqui: se os critérios executáveis do plano devem virar linhas
OBRIGATÓRIAS da `coverageMatrix` (e portanto reprovar entrega).

- **Onde:** `apps/engine/lib/engine/gates/qa_lead_server.ex:190` (`plano_de_teste_da_entrega`),
  `:741` (`plano_de_teste_da_entrega`), `:742` (`plano_ja_emitido`),
  `:747` (`arquivos_alterados`);
  `apps/engine/lib/engine/gates/qa_estrategia_agent.ex:86` (`run`),
  `:104` (`token_budget_micros`), `:188` (`descrever_arquivos`);
  `apps/engine/lib/engine/gates/qa_automacao_agent.ex:226` (`com_o_plano`);
  `apps/engine/lib/engine/agents/dev_lead_tools.ex:457` (`run_assessment`),
  `:538` (`propor_parecer`);
  `apps/engine/lib/engine/harness/artifact_schemas.ex:59` (`taskId`);
  `apps/api/config/gates.yml` (`qa-verificada`, `implementavel`); `packages/contracts/fluxo.yml`
  (`qa-estrategia`, `area-qa`, `dev-lead`)
- **Teste:** `apps/engine/test/engine/gates/qa_lead_server_test.exs`, describe
  "plano de teste da entrega (ADR 0192)" — o plano antes da Automação e dentro
  da mensagem dela (caminho feliz), o reuso por `taskId`, o plano de outra
  task que não conta, e o plano que falha sem segurar a revisão (caso de
  falha); `apps/engine/test/engine/gates/qa_estrategia_agent_test.exs` (os
  arquivos da entrega na mensagem, o diff que falhou, `taskId` no artefato);
  `apps/engine/test/engine/agents/dev_lead_tools_test.exs`, describe
  "assess_implementability (ADR 0090, insumo do ADR 0192)" (parecer na
  primeira chamada, payload sem plano); `dev_lead_server_test.exs`
  ("assess_implementability pending TAMBÉM suspende"); `apps/engine/test/engine/harness/artifact_schemas_test.exs`
  ("sem taskId é rejeitado"). ExUnit: provado só no CI (o `repo.hex.pm` deu
  403 no ambiente da rodada).
- **Origem:** AT-269 (item A23 da análise do uso real de 29/09); decisão do
  dono em 01/10

## A Anamnese religada: sujeito elegível e fato do perfil (RN-680)

### RN-680 — A Anamnese não roda sem sujeito elegível, e a hipótese que a própria pessoa aceitou vira fato do perfil dela no grafo e entra no contexto dos agentes que conversam com ela {#rn-680}

Decisão do dono em 01/10 (AT-277): **religar a Anamnese com correções**. No
uso real de 29/09 ela rodou seis vezes e as seis terminaram em
`anamnese.run_skipped` ("nenhum membro elegível"), escritos pelo MODELO depois
de uma chamada paga (8 933 micros), e as três hipóteses aceitas ficaram na fila
sem destino. Ver o [ADR 0196](../adr/0196-anamnese-religada-com-sujeito-e-fato-do-perfil.md).

1. **Sem sujeito elegível, a rodada não roda.** Sujeito é o membro EFETIVO do
   projeto (`projectRole ?? workspaceRole`, a régua da [RN-471](web.md#rn-471)),
   fora do opt-out, com interação PRÓPRIA no que a rodada mostra ao modelo —
   evento dele com `actor_kind: "user"` na janela, ou decisão dele. A guarda
   vem ANTES da triagem e nem a hipótese na fila a atravessa. Sem sujeito:
   nenhuma chamada ao LLM e nenhuma busca no RAG; o motivo vai NOMEADO para o
   log do engine (`sem_sujeito_elegivel`, com `nenhum_membro` ou
   `nenhuma_interacao_propria` e os números) e, na rodada pedida à mão,
   também para o event log (`anamnese.run_skipped` com
   `causa: "sem_sujeito_elegivel"`). Pelo tick é só log — seria um aviso a cada
   15 minutos por projeto. O prompt passa a listar só os sujeitos.
2. **Membro do projeto é o EFETIVO.** Criar projeto não grava
   `project_members`, e a Anamnese lia só essa tabela — o dono do workspace
   nunca era membro. Os três casos de uso da Anamnese passam a ler
   `listEffectiveMembers`; `listMembers` continua só `project_members`.
3. **A hipótese ACEITA pela PRÓPRIA pessoa vira fato do perfil.** O
   `psychologist.hypothesis_accepted` carrega `projectId`, `sujeito` (o autor
   da sessão analisada), `hipotese`, `sugestao` e `fatoDoPerfil`, e o
   `GraphEventTranslator` — o mesmo do projetor e de `grafo:reprojetar` — o
   traduz para `(:FatoDoPerfil {hypothesisId})`, ligado à pessoa (`SOBRE`) e ao
   projeto (`NO_PROJETO`). `fatoDoPerfil` só é `true` quando quem aceitou é o
   sujeito: um fato sobre a pessoa nunca nasce do clique de outra, e o payload
   diz por quê (`motivoSemFato`). A recusada fica só registrada, como antes.
   Os aceites gravados antes desta RN não têm os campos e não viram fato.
4. **O fato entra no contexto dos agentes que conversam com a pessoa.** A
   mensagem do autor a um agente conversacional leva os fatos DELE neste
   projeto — lidos por `QueryUserContextUseCase`, escopados ao projeto, os 5
   mais recentes, com o total ao lado e o recorte dito —, e o engine os põe no
   turno como mensagem `system` EFÊMERA, pelo mesmo caminho do idioma
   ([RN-622](#rn-622)): nunca no histórico, antes da orientação de idioma, com
   teto de 2 000 caracteres. Grafo fora do ar vira log, e o turno segue sem os
   fatos. Turno sem autor não recebe fatos.
5. **Religada.** `ANAMNESE_ENABLED` volta ao default `true` no `runtime.exs` e
   nos três composes; `START_ANAMNESE` não muda (o de produção segue `false`,
   divergência já declarada). O Psicólogo segue pausado.

- **Código:** `apps/engine/lib/engine/anamnese/elegibilidade.ex:59` (`avaliar`);
  `apps/engine/lib/engine/workers/anamnese_worker.ex:63` (`maybe_analyze`),
  `:97` (`narrar_sem_sujeito`);
  `apps/api/src/domain/iam/membros-efetivos.ts:16` (`membrosEfetivos`);
  `apps/api/src/infrastructure/persistence/drizzle/project.repository.ts:209` (`listEffectiveMembers`);
  `apps/api/src/application/use-cases/execution/accept-hypothesis.use-case.ts:75` (`fatoDoPerfil`);
  `apps/api/src/application/graph-projection/graph-event-translator.ts:171` (`projectProfileFact`);
  `apps/api/src/application/use-cases/graph/query-user-context.use-case.ts:68` (`fatos`);
  `apps/api/src/domain/graph/perfil-do-autor.ts:30` (`textoDoPerfilDoAutor`);
  `apps/api/src/application/use-cases/agents/send-agent-message.use-case.ts:152` (`resolverPerfil`);
  `apps/engine/lib/engine/harness/perfil_do_autor.ex:68` (`anexar`);
  `apps/engine/lib/engine/harness/idioma_da_resposta.ex:253` (`com_idioma_do_autor`);
  `apps/engine/config/runtime.exs:315` (`anamnese_enabled?`)
- **Teste:** `apps/engine/test/engine/anamnese/elegibilidade_test.exs:17`
  (caminho feliz), `:35` e `:46` (sem sujeito — casos de falha);
  `apps/engine/test/engine/workers/anamnese_worker_test.exs:305` (sem membro,
  nem com fila, não chama o LLM), `:324`, `:343` (rodada à mão narra), `:360`;
  `apps/engine/test/engine/anamnese/context_builder_test.exs:82`;
  `apps/api/test/infrastructure/persistence/drizzle/project-effective-members.repository.spec.ts:69`;
  `apps/api/test/application/use-cases/execution/accept-dismiss-hypothesis.use-case.spec.ts:136`,
  `:156` (aceite de terceiro não vira fato);
  `apps/api/test/application/graph-projection/graph-projector.spec.ts:361`, `:386`;
  `apps/api/test/application/use-cases/agents/send-agent-message.use-case.spec.ts:181`,
  `:207` (grafo fora do ar);
  `apps/engine/test/engine/harness/perfil_do_autor_test.exs:14`;
  `apps/engine/test/engine_web/controllers/agent_command_controller_test.exs:428`
- **Origem:** AT-277 (item A31 da análise do uso real de 29/09; decisão do dono
  em 01/10)

## O teto da RN-418 vale também pela porta tipada (RN-689)

### RN-690 — O assistente guarda os `toolCalls` da resposta: o resultado da ferramenta não chega órfão ao provider {#rn-690}

Os agentes conversacionais com laço próprio (Criativo, PO, Arquiteto, Dev Lead,
UX Designer, Staff e Infra Lead) guardavam no histórico a mensagem do
assistente SEM os `toolCalls` da resposta e, em seguida, a mensagem
`role: "tool"` com o `toolCallId`. No fio, o provider recebia um resultado que
respondia a chamada nenhuma e o descartava: o modelo nunca via o que a
ferramenta devolveu e repetia a mesma chamada até o teto do laço (medido na
v7.0.0: o PO chamou `listar_regras_de_negocio` 12 de 12 vezes em dois turnos).

A mensagem do assistente passa a levar os `toolCalls` NATIVOS da resposta
quando há algum — o mesmo formato que o `ToolLoop` já guardava e que o
`ContextManager` agrupa na compactação —, montada num lugar só. Resposta sem
`toolCalls` não ganha a chave. Chamada recuperada do texto (`ToolCallRecovery`,
id nulo) fica de fora: não há id para casar. A api já repassava o campo aos
providers (`toWireMessage` no OpenAI-compatível, `tool_use` no Anthropic); a
reidratação continua trazendo ferramentas como texto.

- **Onde:** `apps/engine/lib/engine/agents/mensagem_do_assistente.ex:17` (`de`);
  `apps/engine/lib/engine/agents/po_server.ex:280`, e o mesmo ponto nos outros seis servidores
- **Teste:** `apps/engine/test/engine/agents/po_server_test.exs:93` (a segunda
  chamada leva o `assistant` com `toolCalls` logo antes do `tool` que o
  responde; a resposta final, sem ferramenta, não ganha a chave — caso de falha)
- **Origem:** AT-350

### RN-695 — A análise da Anamnese não entra no fio da sessão {#rn-695}

Medido no uso real da v7.0.0: o texto que o modelo da Anamnese escreve durante
a rodada ("Analisando a janela do log… usuário (09824667-…)… Decisão de
proficiência") aparecia como BOLHA no fio da sessão de ideação, entre o
Criativo e o PO, com o UUID cru do usuário. A Anamnese não conversa com
ninguém: ela analisa a PESSOA, e o que ela produz é o perfil
([RN-680](#rn-680)).

**A regra:** o texto da rodada é gravado como `anamnese.analysis`, nunca como
`agent.response`. O `ToolLoop` aceita `response_event` no contexto (padrão
`agent.response`, inalterado para todo outro consumidor) e a Anamnese o põe.
O fio da sessão não desenha NENHUM evento cujo ator é o agente `anamnese` —
inclusive o `agent.response` gravado antes da correção. O painel de log da
sessão continua mostrando os eventos dela; o resultado mora em Configurações ›
Perfil de proficiência, sem id cru. Nenhum marcador "perfil atualizado" entra
no fio: fica de fora até alguém pedir.

- **Onde:** `apps/engine/lib/engine/harness/tool_loop.ex:128` (`loop`);
  `apps/engine/lib/engine/workers/anamnese_worker.ex:157` (`build_ctx`);
  `apps/web/src/routes/session-timeline-montagem.tsx:147` (`ehDaAnamnese`)
- **Teste:** `apps/engine/test/engine/workers/anamnese_worker_test.exs:253`
  (o texto sai `anamnese.analysis`; `agent.response` nunca é gravado — caso de
  falha); `apps/web/src/routes/session-timeline-montagem.falha-de-turno.test.tsx:86`
  (a resposta da Anamnese some do fio, a do Criativo fica)
- **Origem:** AT-355

### RN-697 — O turno da prontidão do Criativo só sintetiza: sem ferramentas {#rn-697}

O turno que `confirm_readiness` dispara consolida as regras num resumo e grava o
`product_brief`. No uso real (v7.0.0, Haiku 4.5) ele levou 25 s e gravou mais
quatro `artifact.business_rule` e um `chat.structured_question` que ninguém
responderia: o PO já tinha entrado pelo aceite implícito (RN-658). O turno passa
a ir ao modelo SEM catálogo de ferramentas, e nenhuma chamada é atendida nele —
nem a que o modelo copie do histórico. O catálogo volta intacto no turno
seguinte; o turno normal continua com `emit_artifact` e
`ask_structured_questions`.

- **Onde:** `apps/engine/lib/engine/agents/criativo_server.ex:223` (`executar_confirm_readiness`);
  `:268` (`ferramentas_da_prontidao`)
- **Teste:** `apps/engine/test/engine/agents/criativo_server_test.exs:172` (o turno
  vai com `tools: []` e não grava regra nem pergunta) e `:192` (regressão: o turno
  normal mantém as duas ferramentas)
- **Origem:** AT-352

### RN-698 — O texto do turno vira UMA resposta, e o teto de iterações aparece no fio {#rn-698}

Com ferramentas, o modelo escreve em pedaços — um trecho antes da chamada, outro
na volta seguinte, muitas vezes continuando a mesma frase. Cada volta virava a
sua `agent.response`, e o fio recolhe as anteriores em "Passos do turno": à
mostra ficava só o último pedaço (" histórias e tarefas que cubram tudo.",
começando com espaço). O transporte não perdia nada — o frame `final` da api
leva o texto inteiro da VOLTA —; o que se partia era o TURNO. Nos sete
conversacionais, o texto de uma volta com ferramenta é acumulado no processo do
turno e gravado numa `agent.response` só quando o turno fecha (sem ferramenta,
teto, falha, suspensão do Dev Lead, PR da Infra). Pedaço que começa ou termina
com espaço entra como veio; dois pedaços colados viram parágrafos.

O `toolloop.limit_reached` dos conversacionais (RN-166) passa a ser uma linha
no fio, na bolha de falha, origem `modelo`, dizendo o teto ("parou no teto de N
passos sem terminar o turno"); sem o número no payload a linha diz `?`.

A `agent.response` do turno leva o `modelName` (RN-146) em TODO desfecho, não
só no fecho sem ferramenta: quando o turno fecha sem uma chamada final que o
traga (entregou um formulário `ask_structured_questions`, esgotou o teto,
falhou), vale o modelo da última volta acumulada. Sem chamada de LLM que tenha
devolvido modelo, o campo fica `nil` — nunca um modelo inventado (AT-384; o
Infra Lead não grava `modelName` em desfecho nenhum e segue fora).

**Revisão (decisão do dono, 03/10, AT-395): só o fecho do turno na bolha.** No
uso real (loja-teste-2, 02/10) a resposta única juntava o texto de TODAS as
voltas ("Vou registrar… Excelente! Registrei…", dois resumos seguidos no PO).
A `agent.response` do turno continua UMA, mas o `content` passa a ser só o
FECHO — o texto da última volta que escreveu algo (o turno que termina num
formulário, sem texto na última volta, fica com a anterior) — e o texto das
voltas anteriores vai, na ordem, no campo `passos`, ausente quando não há.
Nada some: o fio desenha cada passo como narração do mesmo turno+autor antes
do fecho, e o colapso de "Passos do turno" que já existia os recolhe, fechado
por padrão; os passos não contam no corte de mensagens do fio (RN-644). A
reidratação (RN-580) devolve `passos` ANTES do `content`, no mesmo
`assistant`, para o modelo não perder o que disse no meio do turno. Vale nos
sete conversacionais (o Infra Lead também, sem `modelName`). Sem teto próprio
para `passos`: o acúmulo já era gravado inteiro antes da revisão.

- **Onde:** `apps/engine/lib/engine/agents/texto_do_turno.ex:88` (`descarregar`);
  `:123` (`juntar`); `:51` (`descarregar_com_modelo`); `:65` (`payload_do_turno`);
  `apps/engine/lib/engine/agents/reidratacao.ex:187` (`acumular`);
  `apps/web/src/routes/session-timeline-montagem.tsx:880` (`passos`)
- **Teste:** `apps/engine/test/engine/agents/texto_do_turno_test.exs:43` (três
  voltas: fecho e dois passos), `:56` (uma volta, sem `passos`), `:60` (termina
  em formulário); `apps/engine/test/engine/agents/reidratacao_test.exs`
  (passos antes do fecho); `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx:502`
  (só o fecho à mostra, passos ao expandir) e `:524` (sem passos, nada extra);
  `apps/engine/test/engine/agents/criativo_server_test.exs:209` (duas
  voltas, uma resposta inteira; nenhuma segunda), `apps/engine/test/engine/agents/texto_do_turno_test.exs`
  e `apps/web/src/routes/session-timeline-montagem.falha-de-turno.test.tsx:85`
  (a linha do teto; sem número, não inventa um); o modelo no formulário em
  `apps/engine/test/engine/agents/criativo_server_test.exs:703` (com modelo) e
  `:724` (sem modelo, `nil`)
- **Origem:** AT-354, AT-384, AT-395

### RN-699 — O Dev Lead lê o module_map vigente e o backlog do PROJETO, e relê os dois quando o plano é recusado {#rn-699}

Medido no uso real (02/10): aceito o Dev Lead, ele respondeu que faltava o
module_map — e o mapa existia. O kickoff procurava o evento
`architecture.module_map_created`, que NENHUM código emite (o Arquiteto grava o
mapa pela api), e caía sempre em "(sem module_map)". O mapa agora vem da MESMA
leitura de projeto que o AppSec usa (`get_infra_context`, o vigente da api),
nunca de evento da sessão; sem mapa, o kickoff diz que não há.

No mesmo uso, as tarefas nasceram DEPOIS do kickoff, o Dev Lead inventou um
`task_id`, a api recusou o plano e o turno acabou sem nova tentativa. Ele ganha
`read_backlog`: leitura CONTIDA, sem parâmetro, escopada ao projeto (as tarefas
pendentes pela mesma rota da `listar_backlog` do PO, teto de 200 linhas dizendo
o total real, e o module_map vigente). A recusa da api volta ao laço dizendo
para chamar `read_backlog` e corrigir; e só o `propose_execution_plan`
bem-sucedido encerra o turno — antes, qualquer ferramenta bem-sucedida na
última chamada (uma leitura, um `emit_artifact`) encerrava. A instrução do
kickoff proíbe inventar `task_id` e pede que ele só diga ter avaliado as
histórias em que chamou `assess_implementability`.

- **Onde:** `apps/engine/lib/engine/agents/dev_lead_tools.ex:339` (`module_map_vigente`);
  `:324` (`spec_read_backlog`); `:340` (`tarefas_do_backlog`);
  `apps/engine/lib/engine/agents/dev_lead_server.ex:578` (`kickoff_instruction`);

- **Onde:** `apps/engine/lib/engine/agents/dev_lead_tools.ex:339` (`module_map_vigente`);
  `:324` (`spec_read_backlog`); `:372` (`tarefas_do_backlog`);
  `apps/engine/lib/engine/agents/dev_lead_server.ex:578` (`kickoff_instruction`);
  `:388` (`run_turn`)
- **Teste:** `apps/engine/test/engine/agents/dev_lead_server_test.exs:164` (o
  mapa vigente chega ao kickoff e o tipo antigo não é lido), o teste seguinte
  (sem mapa, diz que não há — caso de falha) e `:202` (plano recusado pela api →
  `read_backlog` no mesmo turno, com as tarefas reais)
- **Origem:** AT-362, AT-363

### RN-700 — O PO não anuncia o handoff ao Arquiteto sem fazê-lo, e história sem tarefa não é entregue {#rn-700}

No uso real o PO escreveu "Handoff ao Arquiteto" e encerrou o turno sem chamar
`offer_handoff` (fere a RN-163), e entregou cinco histórias `ready` com zero
tarefas — o Dev Lead não tinha o que distribuir. No fim de todo turno do PO,
se o servidor ainda não registrou oferta ao Arquiteto naquele processo, ele lê
as regras do projeto (`uncoveredCount`, a mesma cobertura do aceite automático
da RN-660) e o backlog: com toda regra coberta e toda história com ≥ 1 tarefa,
o SERVIDOR oferece o handoff (molde da Infra que propõe sozinha, ADR 0190,
RN-671/672), e a RN-660 segue decidindo o aceite. Com regra coberta e história
sem tarefa, não oferece e grava `backlog.handoff_not_offered` (origem `modelo`)
nomeando as histórias; leitura ou oferta que falha grava o mesmo evento com
origem `infra`. Regra descoberta, ou backlog sem regra/história, não é julgado.
A instrução do PO passa a exigir tarefa por história. Quem cria as tarefas é o
PO (decisão do agente principal na AT-364: ele já tem `create_task`).

- **Onde:** `apps/engine/lib/engine/agents/po_server.ex:510` (`fechar_handoff`);
  `:551` (`oferecer_handoff`)
- **Teste:** `apps/engine/test/engine/agents/po_server_test.exs:592` (oferece e
  não repete), `:610` (história sem tarefa: não oferece, nomeia)
- **Origem:** AT-364

## O instalador oferece os modelos locais, e não confunde o dev com uma instalação (RN-691, RN-692)

### RN-702 — A compactação de contexto respeita a janela padrão de 128k e nunca troca turnos por um marcador vazio {#rn-702}

- **Regra:** sem `context_window` no contexto (os agentes conversacionais não o
  declaram), a janela de compactação é `DEFAULT_CONTEXT_WINDOW`, cujo padrão
  passou de 8 192 para 128 000, o mesmo valor que os agentes de gate e de dev
  declaram. Quando o sumarizador (`context-manager`) falha ou devolve texto
  vazio, o resumo é DETERMINÍSTICO (um trecho de até 300 caracteres de cada
  turno substituído) e o `context.compacted` grava `summaryOrigin:
  "deterministico"` e `falha` com `origem` e `motivo` (RN-059). Com o
  sumarizador respondendo, `summaryOrigin: "modelo"` e `falha: null`.
- **Medição (AT-366):** sessão 17d41c20, Arquiteto em
  `anthropic/claude-haiku-4.5` (janela de 200k): 6 799 tokens passavam de
  `0,7 × 8 192 = 5 734` e compactavam 35 turnos; o sumarizador falhou e o
  resumo gravado foi o marcador `"(35 turnos anteriores omitidos)"`. No turno
  seguinte o Arquiteto pediu de novo uma confirmação que já tinha recebido.
- **Onde:** `apps/engine/lib/engine/harness/context_manager.ex:157` (`summarize`),
  `apps/engine/lib/engine/harness/context_manager.ex:188` (`resumo_deterministico`),
  `apps/engine/config/runtime.exs` (`default_context_window`)
- **Teste:** `apps/engine/test/engine/harness/context_manager_test.exs`
  ("sem context_window declarado: 6,8k tokens NÃO compactam"; "sumarizador
  respondendo: summaryOrigin modelo, sem falha"; caso de falha: "sumarizador
  falhando: falha NOMEADA com origem e resumo determinístico com o conteúdo")
- **Lacuna declarada:** a janela continua não sendo lida do catálogo por
  modelo (o engine não recebe o `context_window` do binding); 128k é o padrão
  da instalação, ajustável por `DEFAULT_CONTEXT_WINDOW`.
- **Origem:** AT-366

### RN-706 — O agente de execução sabe onde está: pasta, imagem, rede, git tipado e o próprio módulo {#rn-706}

- **Regra:** os dev agents (`dev-*`) e os subagentes de QA (`qa-*`) recebem em
  toda chamada de LLM uma mensagem `system` EFÊMERA de ambiente, pelo mesmo
  caminho do idioma (RN-622) e do perfil do autor (RN-680) — nunca em
  `state.messages`, nunca por servidor. Ela diz a pasta real em que o
  `terminal` roda (o `workspace_root` do laço, traduzido para `/work` pela
  mesma regra do `TerminalExecutor` quando há container `running`
  REGISTRADO), a imagem e a rede do último `artifact.project_image`, que `git`
  não se roda no terminal (use `git_commit`/`git_push`/`pr_open`) e, para o dev
  agent, o MÓDULO dele: o que consome de outro módulo vem do contrato
  (`listar_contratos_de_modulos`) e se usa por stub/mock, nunca reimplementado,
  e arquivos de raiz que já existem na `dev` (`package.json`, lockfile) não se
  recriam. Sem container `running`, a mensagem DIZ isso e não afirma `/work`.
  Teto de 1 200 caracteres; falha de leitura vira mensagem ausente, nunca turno
  derrubado.
- **Medição (AT-379/AT-378, 02/10, loja-teste):** `dev-api` e `qa-automacao`
  rodaram `cd /workspace` (nenhum prompt cita essa pasta); `git status` deu
  exit 127 numa imagem sem git; o `dev-api` (módulo `api`) criou
  `src/catalog.js` e `package.json`, os mesmos do `dev-catalog`, e o merge
  conflitou.
- **Onde:** `apps/engine/lib/engine/harness/ambiente_do_agente.ex:102` (`montar`),
  `:48` (`com_ambiente`), `:65` (`anexar`),
  `apps/engine/lib/engine/harness/tool_loop.ex:87` (`com_ambiente`)
- **Teste:** `apps/engine/test/engine/harness/ambiente_do_agente_test.exs`
  ("caminho feliz: com container running, a pasta é /work/.worktrees/<agente>";
  caso de falha: "sem container running, não afirma /work")
- **Lacuna declarada:** nenhum aviso no resultado do `git_commit` para arquivo
  de outro módulo (o `module_map` não diz quais caminhos são de cada módulo,
  então o aviso não seria determinístico) e nenhum bloqueio de commit, por
  decisão do dono.
- **Origem:** AT-379, AT-378

### RN-707 — O semgrep do gate de SecOps tem `$HOME` gravável, e a falha sem saída é nomeada {#rn-707}

- **Regra:** nos composes de produção e de instalação, o tmpfs `/home/engine`
  do engine nasce com o dono do usuário da imagem
  (`/home/engine:uid=1000,gid=1000,mode=0700`). O `SemgrepDetector.Live`
  distingue o exit `1` com JSON (achados) do exit `0`/`1` com stdout vazio,
  que vira `{:error, {:sem_saida, exit_code}}` em vez de `:invalid_output`.
  O veredito do gate NÃO muda: scanner que não rodou continua "pulado" no
  resumo do parecer.
- **Medição (AT-380):** dentro de `brabo-engine-1` (imagem de produção,
  `read_only: true`), o tmpfs `/home/engine` nascia `root` `2755`; o
  `semgrep scan` do gate saía `1` com stdout vazio e
  `PermissionError: '/home/engine/.semgrep'` no stderr, e o parser chamava
  isso de `:invalid_output`. Com o tmpfs `uid=1000` o mesmo comando devolve o
  JSON (exit 0). O Kubernetes não tinha o defeito (`fsGroup: 1000` no
  `emptyDir`).
- **Onde:** `apps/engine/lib/engine/actions/semgrep_detector.ex:73`
  (`interpretar`), `docker/docker-compose.prod.yml`,
  `docker/docker-compose.install.yml`
- **Teste:** `apps/engine/test/engine/actions/semgrep_detector_test.exs`
  ("JSON com results vira findings, inclusive com exit 1 (achou algo)"; caso
  de falha: "exit 1 com stdout vazio é falha de execução nomeada, não
  :invalid_output")
- **Decisão (revista pela [RN-714](#rn-714)):** a frase "o veredito do gate
  NÃO muda" deixou de valer: o dono decidiu (02/10) que SAST que não rodou
  deixa o gate PENDENTE e bloqueando.
- **Origem:** AT-380

### RN-710 — O Workflows não é delegado sem CI que rode, e não pergunta a ninguém {#rn-710}

No aceite da Infra, o `infra-workflows` respondia com uma pergunta ("qual é o
provider do repositório do projeto?") que nenhum humano recebe — subagente não
conversa —, e a delegação terminava `failed` com origem `modelo` e um
`dev.error` genérico no fio (medido no loja-teste, 02/10). O projeto era
`local`: repositório bare no servidor, sem runner de CI.

- Provider `local` ou ausente: a delegação ao Workflows é **dispensada**
  (`delegation` `dispensed`, com a justificativa nomeada — "repositório local
  … não tem CI que rode"), e a PR de infra sai só com o que o Lead produziu.
  Só `github` e `gitlab` delegam.
- Quando delega, o prompt diz que o provider recebido JÁ é o do projeto e
  proíbe perguntar.
- O subagente que para com TEXTO em vez de chamar a ferramenta continua falha
  nomeada reportada ao lead, mas o diagnóstico diz o que ele pediu: "pediu
  informação que não recebeu, em vez de chamar emit_infra_delegation_result:
  <texto>" (até 300 caracteres).
- O título da PR de infra leva o prefixo `infra: ` só quando o resumo do
  modelo ainda não começa com ele (sem diferenciar maiúsculas) — antes saía
  "infra: infra: Dockerfile…" (AT-396).

- **Onde:** `apps/engine/lib/engine/infra/workflows_agent.ex:61` (`dispensa`),
  `apps/engine/lib/engine/infra/infra_lead.ex:69` (`com_prefixo`),
  `apps/engine/lib/engine/infra/workflows_agent.ex:184` (`parada_sem_ferramenta`),
  `apps/engine/lib/engine/infra/infra_lead_server.ex:1288` (`finalize`)

  `apps/engine/lib/engine/infra/infra_lead_server.ex:1288` (`finalize`)
- **Teste:** `apps/engine/test/engine/infra/workflows_agent_test.exs` ("RN-710: …")
  e `apps/engine/test/engine/infra/infra_lead_server_test.exs` ("RN-710:
  repositório local dispensa o Workflows …") e
  `apps/engine/test/engine/infra/infra_lead_test.exs` ("com_prefixo/1 (AT-396)")
- **Origem:** AT-368, AT-396

### RN-711 — O conversacional sabe onde está no fluxo, e a restrição técnica do usuário vira decision_record {#rn-711}

- **Regra:** os sete agentes conversacionais (Criativo, PO, Arquiteto, Infra,
  Dev Lead, UX Designer, Staff) recebem em toda chamada de LLM uma mensagem
  `system` EFÊMERA com o fluxo de entrega — as sete etapas na ordem (Criativo →
  PO → Arquiteto → Infra → Dev Lead → dev agents → QA/SecOps → merge manual),
  ONDE o agente está, o PRÓXIMO passo real e QUEM o dispara (humano ×
  sistema) —, pela fachada `EngineApiClient`, depois do ambiente (RN-706) e
  antes do perfil (RN-680) e do idioma (RN-622, sempre o último). A fonte é
  UMA, `Engine.Harness.FluxoDoTime`, conferida por teste contra
  `packages/contracts/fluxo.yml`: todo papel citado existe ali como `active`, e o texto não
  cita etapa fora dele (deploy, pipeline, Dockerfile, InfraAgent). O Criativo
  registra restrição técnica EXPLÍCITA do usuário (linguagem, "nenhuma
  dependência", "sem rede", "um módulo só") como `decision_record`
  (`emit_artifact`, RN-505), sem sermão; o kickoff do Arquiteto lê os
  `artifact.decision_record` da sessão (a mesma leitura por tipo, RN-580) e
  manda respeitá-los, dizendo QUAL e POR QUÊ quando contrariar. O fechamento do
  Arquiteto não pede de novo a confirmação já dada, e a Infra não cola os
  arquivos no chat nem promete deploy.
- **Medição (AT-369/AT-370, 02/10, loja-teste):** o Criativo anunciou o
  Arquiteto como próximo (é o PO); o PO disse que o Arquiteto ia "implementar";
  o Arquiteto, que "dev agents começam" após os ADRs, e pediu "Confirme:
  Arquitetura pronta" depois da confirmação; a Infra despejou ~80 linhas de
  compose no fio. O pedido "Node puro, nenhuma dependência, sem rede, um módulo
  só" não virou artefato e o Arquiteto criou três módulos.
- **Onde:** `apps/engine/lib/engine/harness/fluxo_do_time.ex:107` (`texto`),
  `:97` (`anexar`), `apps/engine/lib/engine/sessions/engine_api_client.ex:647`

  `:97` (`anexar`), `apps/engine/lib/engine/sessions/engine_api_client.ex:730`
  (`llm_turn`), `apps/engine/lib/engine/harness/agents.ex:23` (`identity`),
  `apps/engine/lib/engine/agents/arquiteto_server.ex:404` (`build_kickoff`)
- **Teste:** `apps/engine/test/engine/harness/fluxo_do_time_test.exs`
  ("todo papel citado existe no fluxo.yml como ativo"; caso de falha: "nenhum
  texto cita etapa/agente fora do fluxo"),
  `apps/engine/test/engine/agents/arquiteto_server_test.exs` ("kickoff lê os
  decision_record e manda respeitar \"um módulo só\""),
  `apps/engine/test/engine/harness/agents_test.exs`
- **Lacuna declarada:** a leitura de `decision_record` do Arquiteto é da
  SESSÃO (como as regras e as histórias do kickoff), não do projeto inteiro; e
  nada RECUSA um `create_module_map` que contrarie a restrição — a instrução
  pede a justificativa, não a impõe.
- **Origem:** AT-369, AT-370

### RN-714 — SAST que não rodou deixa o gate de SecOps pendente, nunca aprovado {#rn-714}

- **Regra:** quando o semgrep do gate de SecOps não roda — binário ausente,
  saída inválida (`:invalid_output`), `:sem_saida`, exceção ou teto de tempo
  —, nenhum veredito é gravado: a PR continua em `awaiting_secops`, o gate
  fica PENDENTE e bloqueia, e a PR não chega ao usuário como aprovada pela
  SecOps. O motivo vai ao fio como `agent.error` de origem `infra`
  ("SAST não rodou: <motivo> — … reexecute o gate depois de corrigir"). O
  contrato externo não muda: continuam os dois vereditos de sempre
  (`approved`/`changes_requested`), um por gate. O gitleaks ausente continua
  só "pulado" no resumo.
- **Reexecução:** o ciclo fica `in_progress` em `gate_states`, e o
  `GateRescuer` o reexecuta no boot do engine e depois do limiar de staleness
  (`gate_rescue_stale_after_seconds`, 15 min). Não há botão de reexecutar
  gate na tela.
- **Sem repetição (AT-386):** o resgate que reencontra o MESMO motivo não
  grava outro `agent.error`: se o último evento do SecOps daquela task
  (`agent.error` ou `artifact.secops_verdict`, lidos por tipo, cauda com teto)
  já é este erro com o mesmo `reason`, fica só a linha de Logger do servidor.
  Motivo diferente, um veredito no meio ou leitura que falha gravam de novo; o
  `agent.error` passa a levar `taskId`.
- **Onde:** `apps/engine/lib/engine/gates/secops_agent_server.ex:116`
  (`run_secops`), `apps/engine/lib/engine/gates/secops_agent_server.ex:144`
  (`sast_nao_rodou`), `apps/engine/lib/engine/gates/secops_agent_server.ex:209`
  (`erro_ja_registrado?`)
- **Teste:** `apps/engine/test/engine/gates/secops_agent_server_test.exs`
  ("sem achados (gitleaks e semgrep limpos): approved"; casos de falha:
  "semgrep com saída inválida: gate pendente, sem veredito, motivo nomeado" e
  "semgrep com binário ausente: gate pendente, sem veredito, motivo nomeado";
  AT-386: "primeiro resgate grava; o segundo, com o mesmo motivo, não",
  "motivo diferente, ou veredito depois do erro, grava de novo", "o SAST que
  volta a rodar aprova como sempre")
- **Revisa:** [RN-707](#rn-707) ("o veredito do gate NÃO muda")
- **Origem:** AT-380

### RN-717 — O desvio do agente que a Anamnese observa vira sinal do produto, sem dado pessoal {#rn-717}

- **Regra:** laço de agente, turno cancelado pelo usuário e mensagem do
  usuário que repara falha de agente são registrados pela Anamnese como
  `anamnese.agent_deviation` (ferramenta `report_agent_deviation`), nunca como
  perfil da pessoa. O payload é montado no engine por lista de permitidos —
  `agente`, `tipo` (`laco` | `cancelamento_pelo_usuario` |
  `reparo_pelo_usuario`) e `evidenceEventIds` (deduplicados, teto de 20) —,
  sem texto livre e sem id, nome, e-mail ou traço do usuário; campo extra é
  descartado. O tipo não é projetado no grafo do usuário. Tipo fora do
  vocabulário ou sem evidência é recusado, sem gravar.
- **Onde:** `apps/engine/lib/engine/anamnese/tools/report_agent_deviation.ex:73`
  (`payload`), `apps/engine/lib/engine/anamnese/tools/report_agent_deviation.ex:52`
  (`run`), `apps/engine/lib/engine/anamnese/tools.ex`, regra no kickoff
  (`prompts/anamnese-kickoff.md` v4)
- **Teste:** `apps/engine/test/engine/anamnese/report_agent_deviation_test.exs`
  ("reparo do usuário vira anamnese.agent_deviation do AGENTE, só com agente,
  tipo e evidência"; falhas: "tipo fora do vocabulário é recusado e nada é
  gravado", "sem evidência é recusado"),
  `apps/api/test/application/graph-projection/desvio-do-agente-fora-do-grafo.spec.ts`
- **Lacuna declarada:** a api não confere que a evidência existe; a leitura é
  por consulta ao event log, sem tela ([ADR 0205](../adr/0205-desvio-do-agente-como-sinal-do-produto.md)).
- **Origem:** AT-356 (parte 2), decisão do dono de 02/10

## Uma chave de cache, uma pergunta (RN-718)

### RN-719 — Ferramenta de agente aceita lista enviada como texto JSON, e exceção dentro dela volta ao laço {#rn-719}

**Contexto:** medido ao vivo (02/10, Haiku 4.5 via OpenRouter), o modelo manda
lista e objeto como STRING JSON (`"business_rule_ids": "[\"01M…\"]"`). Três
desfechos: `create_story` descartava os ids calado (história ficava `draft`),
outras ferramentas recusavam e custavam voltas, e `create_c4_diagram` fazia
`Enum.map` numa string e derrubava o turno do Arquiteto com `agent.error`.

**A regra:** toda ferramenta dos sete conversacionais e do `ToolLoop` roda por
UM ponto, `Engine.Harness.ArgumentosDeFerramenta.executar/4`. Argumento cujo
schema declara `array`/`object` e chega como string JSON válida do tipo vira o
valor; string que não é recusa NOMEADA ("o campo X precisa ser uma lista"),
antes de a ferramenta rodar. Campo declarado `string` nunca é tocado. Exceção
levantada dentro da ferramenta vira `tool.result` `ok: false` com
`origem: "codigo"`, e o erro entra no laço como qualquer outro (RN-163): o
turno continua.

- **Onde:** `apps/engine/lib/engine/harness/argumentos_de_ferramenta.ex:26`
  (`executar`), `:73` (`coagir`), `:56` (`falha_interna?`);
  `apps/engine/lib/engine/agents/resultado_de_ferramenta.ex:29` (`payload`);
  `apps/engine/lib/engine/harness/tool_loop.ex:381` (`run_direct`);
  `apps/engine/lib/engine/agents/arquiteto_server.ex:357`
  (`executar_ferramenta`, o mesmo helper nos outros seis servidores)
- **Teste:** `apps/engine/test/engine/harness/argumentos_de_ferramenta_test.exs`
  (`create_story` com ids em string JSON grava os ids; `create_c4_diagram` com
  `actors` em string JSON funciona; string não-JSON num campo array é recusa
  nomeada; ferramenta que lança não encerra o turno do `ToolLoop` e grava
  `tool.result` `ok: false`)
- **Origem:** AT-387

### RN-721 — O id encurtado de história ou tarefa é resolvido dentro do projeto {#rn-721}

O Arquiteto passava a `assign_story_modules` os 8 primeiros caracteres do id da
história, a api respondia 400 "storyId must be a UUID" e, depois de oito
tentativas, nenhuma história ganhava módulo (loja-teste-2, 02/10). Toda
ferramenta de agente que recebe id de história ou tarefa —
`assign_story_modules` e `create_task` (`story_id`), `assess_implementability`
(`storyId`) e `propose_execution_plan` (`tarefas[].taskId`) — passa o id por
`Engine.Harness.IdDoBacklog` antes de chamar a api:

- UUID completo segue sem consulta.
- Prefixo de no mínimo 8 caracteres hexadecimais é resolvido contra o backlog
  do PROJETO (`list_backlog`): um só id que começa com ele vira o UUID;
  nenhum é recusa nomeada ("nenhuma história do projeto tem id começando com
  …"); mais de um é recusa nomeada ("o prefixo … é ambíguo"). A recusa volta
  ao modelo como resultado da ferramenta (RN-163).
- O que não é nem UUID nem prefixo segue como veio, e quem recusa é a api.

- **Onde:** `apps/engine/lib/engine/harness/id_do_backlog.ex:21` (`resolver`),
  `:43` (`resolver_em`); `apps/engine/lib/engine/agents/dev_lead_tools.ex:176`
  (`resolver_tarefas`)
- **Teste:** `apps/engine/test/engine/harness/id_do_backlog_test.exs` (prefixo
  único resolve; ambíguo e inexistente recusam nomeados)
- **Origem:** AT-390

## A Anamnese não paga duas vezes pela mesma janela, e o resgate de gate não reinicia ciclo que espera alguém (RN-722)

### RN-722 — A Anamnese fecha a janela que avaliou e só roda com interação nova; o resgate de gate pergunta pela task, respeita a decisão humana pendente e estaciona o ciclo velho {#rn-722}

- **Regra (Anamnese):** (1) a rodada que AVALIOU a janela e encerrou sem
  perfil (`skip_proficiency`) grava `anamnese_runs` com zero perfis, e a
  próxima começa em `window_to` — revisa a cláusula da RN-680/do moduledoc
  "rodada que não conclui não grava": rodada que FALHA (teto, orçamento,
  provider) continua sem gravar, e a que nem chega ao LLM (sem sujeito,
  triagem, teto diário) não fecha nada; (2) os eventos que a própria Anamnese
  escreve (`anamnese.*` e todo evento de ator `agent`/`anamnese`) e os de
  ator `system` ficam fora da janela e da contagem da triagem; (3) decisão do
  dono de 02/10: sujeito é quem tem ao menos **5** interações próprias NOVAS
  (eventos de `actor_kind: "user"` mais decisões, na janela que já começa no
  fim da última tentativa) — revisa o "ao menos UMA" da RN-680 —, e o projeto
  tem no máximo **4** rodadas pagas por dia UTC (concluída, falha ou
  `run_skipped` escrito pelo modelo; o pulo sem sujeito não conta). Abaixo de
  qualquer dos dois, nenhuma chamada ao LLM nem ao RAG; o motivo vai ao log e,
  só na rodada pedida à mão, a `anamnese.run_skipped` (`causa:
  "teto_diario"` ou `"sem_sujeito_elegivel"`).
- **Regra (resgate de gate, revisa a RN-140):** o `GateRescuer` (a) considera
  vivo o ciclo cuja TASK está em voo no lead, perguntando a ele
  (`{:em_voo?, task_id}`), e não mais o processo do projeto — lead ocioso não
  segura o resgate; lead ocupado demais para responder conta como vivo; (b)
  não reinicia ciclo cuja sessão tem `proposed_action` PENDENTE de ator do
  gate (`qa*`, `secops*`, `appsec`) — só registra no log; (c) decisão do dono
  de 02/10: ciclo parado há mais de 2 h desde a ÚLTIMA ATIVIDADE (`updated_at`)
  é ESTACIONADO (`parked_at`) com `gate.rescue_parked` no log da sessão
  (task, gate, idade, motivo), nem no boot nem no tick é retomado, e retomar
  exige gesto humano (`GateRescuer.retomar_estacionado/3`).
- **Onde:** `apps/engine/lib/engine/workers/anamnese_worker.ex:189`
  (`fechar_janela`), `apps/engine/lib/engine/workers/anamnese_worker.ex:104`
  (`dentro_do_teto_diario?`),
  `apps/engine/lib/engine/session_events/event.ex:194`
  (`project_window_query`), `apps/engine/lib/engine/session_events/event.ex:202`
  (`count_anamnese_rounds_since`),
  `apps/engine/lib/engine/anamnese/elegibilidade.ex:67`
  (`min_interacoes_proprias`),
  `apps/api/src/application/use-cases/anamnese/record-proficiency.use-case.ts:160`
  (`fecharJanelaSemPerfil`), `apps/engine/lib/engine/gates/gate_rescuer.ex:379`
  (`task_em_voo?`), `apps/engine/lib/engine/gates/gate_rescuer.ex:403`
  (`aguardando_humano?`), `apps/engine/lib/engine/gates/gate_rescuer.ex:321`
  (`estacionar`), `apps/engine/lib/engine/gates/gate_rescuer.ex:359`
  (`retomar_estacionado`), `apps/engine/lib/engine/gates/qa_lead_server.ex:95`
  (`handle_call`)
- **Teste:** `apps/engine/test/engine/workers/anamnese_worker_test.exs`
  (describe "a janela avaliada fecha (RN-722)": "skip_proficiency grava a
  rodada vazia; a segunda começa em window_to e, sem interação nova, não chama
  o LLM"; falhas: "falha ao fechar a janela não vira falha da rodada", "rodada
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
- **Lacuna declarada:** retomar um ciclo estacionado não tinha tela nem rota
  — era chamada de operador (`bin/engine rpc`); fechou na
  [RN-724](#rn-724) (rota e botão no evento `gate.rescue_parked`). A pendência humana é lida
  pela SESSÃO do ciclo (a `proposed_action` não tem `task_id`)
  ([ADR 0207](../adr/0207-ciclo-de-gate-velho-estaciona.md)).
- **Origem:** AT-391 (uso real de 02/10: ~US$ 8,90 de Anamnese num dia sem
  ninguém pedir; ciclo de gate reiniciado com ação pendente e outro 8 h sem
  resgate), decisões do dono de 02/10

**Revisada pela [RN-923](#rn-923) ([ADR 0226](../adr/0226-diario-vivo-e-retomada-dos-agentes.md)).** O resgate AUTOMÁTICO (tick) de um ciclo vale uma vez: o segundo estaciona com `motivo: "retomada_automatica_ja_usada"` e espera o "Retomar gate", que zera o contador. O estacionamento de 2 h segue como está.

## Uma chave de cache, uma pergunta (RN-718)

### RN-723 — A Infra herda a rede que o Arquiteto declarou para o projeto {#rn-723}

Decisão do dono em 02/10 ([ADR 0208](../adr/0208-a-infra-herda-a-rede-do-arquiteto.md)),
revisando a rede literal `none` da subida no aceite da [RN-671](api.md#rn-671). A
eleição da Infra usa o `network` da `artifact.project_image` mais recente
emitida pelo Arquiteto (`actor_id: "arquiteto"`, qualquer sessão do projeto),
lido localmente pelo engine; sem decisão dele, ou com valor fora de
`none`/`egress`, segue `none`. Vale para a subida do servidor no aceite e para
a tool `propose_container_start` sem `network`. A autonomia semeada não muda:
`egress` sobe sem clique, e o preço (a rede `egress` alcança as portas
publicadas da máquina, ADR 0189) está declarado no ADR.

- **Código:** `apps/engine/lib/engine/session_events/event.ex:139` (`rede_do_arquiteto`),
  `apps/engine/lib/engine/infra/infra_lead_server.ex:803` (`rede_herdada`)
- **Testes:** `apps/engine/test/engine/infra/infra_lead_server_test.exs` —
  "RN-723: a subida herda a rede `egress` que o Arquiteto declarou" e
  "RN-723: rede do Arquiteto fora do vocabulário — a subida segue `none`"
- **Origem:** AT-392

## A Anamnese não paga duas vezes pela mesma janela, e o resgate de gate não reinicia ciclo que espera alguém (RN-722)

### RN-724 — O ciclo de gate estacionado volta por um botão no fio, não só pelo terminal do operador {#rn-724}

- **Regra:** o ciclo de gate ESTACIONADO pelo resgate
  ([RN-722](#rn-722), [ADR 0207](../adr/0207-ciclo-de-gate-velho-estaciona.md))
  é retomado por `POST /projects/:projectId/tasks/:taskId/gates/:gate/resume`,
  com o MESMO papel mínimo de quem decide a PR (`developer`). A api só
  autoriza e pede ao engine (`POST /internal/projects/:id/tasks/:taskId/gates/:gate/resume`),
  que delega a `GateRescuer.retomar_estacionado/3`: ciclo que não existe, não
  está estacionado ou gate fora de `qa`/`secops` é 409 `gate_nao_estacionado`
  e nada é despachado. No fio da sessão, o evento `gate.rescue_parked` vira um
  aviso com o botão "Retomar gate", inerte com o motivo em texto quando o papel
  não alcança `developer`; a recusa mostra a frase da api. Nenhum poll novo:
  o andamento do gate retomado chega pelo log da sessão.
- **Onde:** `apps/engine/lib/engine_web/controllers/gate_command_controller.ex:15`
  (`resume`),
  `apps/api/src/application/use-cases/gates/resume-parked-gate.use-case.ts:18`
  (`execute`),
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts:379`
  (`resumeParkedGate`),
  `apps/api/src/interfaces/http/gates/gate-resume.controller.ts:40`
  (`resume`), `apps/web/src/routes/RetomarGateEstacionado.tsx:59`
  (`RetomarGateEstacionado`)
- **Teste:** `apps/engine/test/engine_web/controllers/gate_command_controller_test.exs`
  ("ciclo estacionado: 202 e despacha o gate de novo"; falha: "ciclo NÃO
  estacionado: 409 nomeado e nada despachado"),
  `apps/api/test/interfaces/http/gates/gate-resume.controller.spec.ts`
  (feliz, 409 `gate_nao_estacionado`, papel abaixo de `developer`),
  `apps/web/src/routes/RetomarGateEstacionado.test.tsx` (o clique chama a
  rota; a recusa vira toast com a frase da api; papel insuficiente deixa o
  botão inerte)
- **Origem:** AT-397, fechando a lacuna declarada na RN-722

### RN-725 — Texto com escape literal é decodificado, e a recusa de argumento diz o que chegou {#rn-725}

**Contexto:** no TP-01 (03/10, Claude Haiku 4.5) o PO gravou títulos de
história com o escape unicode LITERAL (`código`): a normalização da
RN-719 só decodificava campo `array`/`object`. Recriadas com o título certo,
as histórias passaram pela recusa de duplicata (RN-720/RN-081), que não casou
o escapado com o normal. E as recusas "exige X" não diziam o que tinha
chegado: o PO gastou 28+ passos (48% do custo do teste) até o teto, e
`complete_story` respondia "ainda faltam RF, DoD, DoR ou business_rule_ids"
sem dizer qual.

**A regra:**

1. No mesmo ponto da RN-719, string com `\uXXXX` LITERAL (par surrogate
   incluído) é decodificada, e com ela `\n`, `\t`, `\"` e `\\` da MESMA
   string. String sem `\uXXXX` volta byte a byte — código num `content` com
   `"\n"` literal não muda. Isso revisa o "campo `string` nunca é tocado" da
   RN-719 só nesse caso.
2. A duplicata EXATA de história (api) e de regra (engine) compara o título
   com o escape decodificado, antes da caixa e do NFD de sempre.
3. Recusa de ferramenta que diz "exige `X`" ganha, no mesmo ponto, as CHAVES
   que chegaram (nomes, nunca valores), ou que chegou string/lista em vez de
   objeto. `emit_artifact` com chave faltando no `payload` diz as chaves
   faltantes e as recebidas, em vez de `{:missing_keys, …}`.
4. `complete_story` nomeia exatamente o que falta (`falta: business_rule_ids`),
   pela mesma régua de `missingForReady` da api, lida da história devolvida.

- **Onde:** `apps/engine/lib/engine/harness/argumentos_de_ferramenta.ex:102`
  (`decodificar_escapes`), `:152` (`chaves_recebidas`), `:166`
  (`com_chaves_recebidas`); `apps/engine/lib/engine/harness/tools/complete_story.ex:80`
  (`faltam`); `apps/api/src/domain/backlog/story-overlap.ts:39`
  (`decodificarEscapesLiterais`), `:25` (`normalizarTitulo`);
  `apps/engine/lib/engine/harness/artifact_dedupe.ex` (`normalizar`)
- **Teste:** `apps/engine/test/engine/harness/argumentos_de_ferramenta_test.exs`
  (describe "RN-725": escape decodificado, texto sem `\u` e lista intactos;
  recusa com as chaves e sem os valores; `complete_story` nomeia o campo);
  `apps/api/test/domain/backlog/story-overlap.spec.ts` (título escapado casa
  com o normal; título diferente segue diferente)
- **Origem:** AT-405, AT-408

### RN-726 — Crédito do provedor esgotado pausa o dev agent, com origem `infra`, sem queimar as tarefas seguintes {#rn-726}

- **Regra:** quando o provedor do modelo recusa por falta de CRÉDITO (HTTP 402,
  ou o texto "available credits"/"add credits" do OpenRouter), o turno do dev
  agent não é "parou sem concluir": a tarefa é bloqueada com o motivo
  "crédito do provider esgotado" e origem `infra` (nunca `codigo`), o contador
  da parada automática (RN-047) NÃO avança, e o agente NÃO reivindica a
  próxima tarefa — fica em `idle_tripped` e emite `dev.credit_exhausted`
  (`motivo: credito_esgotado`), nunca `dev.idle_tripped`. A retomada é o
  Rearmar que já existia no painel do time, depois de recarregar o crédito; a
  tarefa bloqueada volta pelo desbloqueio de sempre. A tela de Executores
  mostra o agente `travado` com "crédito do provedor do modelo esgotado —
  recarregue e rearme para retomar", e o sino diz o mesmo. O mesmo
  reconhecimento faz `FalhaDeTurno.origem/1` devolver `infra` para o frame
  final de crédito (vale para os agentes de gate, como o QA). A sessão conta
  `dev.credit_exhausted` como trabalho pendente, como `dev.idle_tripped`.
  Desde a RN-730 o 402 chega com `code` próprio (`insufficient_credit`) e é
  ele que decide; o reconhecimento pelo texto ficou só como rede.
- **Onde:** `apps/engine/lib/engine/agents/falha_de_turno.ex:142`
  (`credito_esgotado?`),
  `apps/engine/lib/engine/dev/dev_agent_server.ex:902` (`handle_outcome`),
  `apps/engine/lib/engine/dev/agent_io.ex:271` (`pausar_por_credito`),
  `apps/web/src/lib/agent-status.ts:198` (`breakerReasonFor`),
  `apps/api/src/application/use-cases/sessions/get-session-pending-work.use-case.ts`
- **Teste:** `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  ("402 do provider: origem infra, pausa sem idle_tripped e sem queimar a
  próxima task"; falha: "erro que não é de crédito segue como antes: parou sem
  concluir, conta no disjuntor"),
  `apps/engine/test/engine/agents/falha_de_turno_test.exs` ("402 do provider
  é infra e é reconhecido"), `apps/web/src/lib/agent-status.test.ts`
  ("RN-726: dev.credit_exhausted é travado com motivo de crédito…")
- **Origem:** AT-407 (TP-01 de 03/10: 402 do OpenRouter virou três tarefas
  bloqueadas com origem `codigo` e a parada automática)

### RN-731 — O fecho do turno diz o que foi gravado com o número do servidor {#rn-731}

- **Regra:** o número do que um agente conversacional gravou num turno é FATO
  do servidor, nunca texto do modelo (RN-163). O Criativo, o PO e o Arquiteto
  contam, no processo do turno, cada ferramenta de escrita que voltou `ok`
  (`emit_artifact` por tipo — regra de negócio, decisão, nota, outro —,
  `create_epic`, `create_story`, `update_story`, `archive_story`,
  `create_task`), e o fecho da `agent.response` ganha, DEPOIS do texto do
  modelo e sem reescrevê-lo, a linha "Gravado neste turno: N …". Ferramenta
  recusada e leitura não contam; turno sem escrita não ganha linha; a contagem
  morre com o turno. A linha sai no idioma do turno (RN-622): o do autor,
  senão o do projeto; `pt*` em português ("Gravado neste turno: 1 regra de
  negócio"), qualquer outro idioma — ou nenhum resolvido — em inglês
  ("Recorded this turn: 2 business rules"), com singular e plural nos dois.
- **Onde:** `apps/engine/lib/engine/agents/gravado_no_turno.ex:62` (`anotar`),
  `:95` (`descarregar`),
  `apps/engine/lib/engine/harness/idioma_da_resposta.ex:272` (`idioma_do_turno`),
  `apps/engine/lib/engine/agents/texto_do_turno.ex:65` (`payload_do_turno`)
- **Teste:** `apps/engine/test/engine/agents/gravado_no_turno_test.exs` (feliz:
  seis regras e uma decisão gravadas, uma recusada — o fecho "8 regras" do
  modelo fica e ganha "6 regras de negócio, 1 decisão" ao lado; sem escrita:
  nada acrescentado; pt-BR e en, singular e plural; idioma fora dos dois cai em en),
  `apps/engine/test/engine/agents/criativo_server_test.exs`
- **Origem:** AT-414 (TP-01 de 03/10: o Criativo fechou com "Registrei as 8
  regras de negócio" e o painel tinha 6)

### RN-732 — O texto do turno passa pela mesma régua de escape dos argumentos {#rn-732}

- **Regra:** o texto que o modelo escreve no turno de um agente conversacional
  — o `content` (fecho) e cada `passos` da `agent.response` — passa pela MESMA
  `decodificar_escapes/1` da RN-725 antes de ser gravado: `\u00e3` literal vira
  `ã`. Uma régua só, sem cópia, e com o mesmo limite: só age quando há
  `\uXXXX` literal, então texto sem escape — inclusive código com `"\n"`
  literal num bloco cercado — volta byte a byte. O `agent.delta` do streaming
  NÃO é decodificado: um escape pode chegar partido entre dois deltas, e a
  bolha gravada substitui o texto em curso no fim do turno. Regra própria, e
  não cláusula da RN-725, porque a superfície é outra (resposta do modelo, não
  argumento de ferramenta) e a decisão sobre o delta é desta.
- **Onde:** `apps/engine/lib/engine/agents/texto_do_turno.ex:65` (`payload_do_turno`),
  `apps/engine/lib/engine/harness/argumentos_de_ferramenta.ex:102` (`decodificar_escapes`)
- **Teste:** `apps/engine/test/engine/agents/texto_do_turno_test.exs` (feliz:
  os cinco escapes medidos, no fecho e num passo; intacto: texto sem escape e
  bloco de código com `\n` literal)
- **Origem:** AT-417 (TP-01 de 03/10, 2ª rodada: a resposta final do Criativo
  gravada com "colis\u00e3o", "usu\u00e1rio" e mais três escapes na bolha)

### RN-733 — A falha de crédito diz o que fazer, e o `reason` nunca é a tupla {#rn-733}

- **Regra:** o `reason` gravado no `agent.error` dos conversacionais, do
  Infra Lead e do `ToolLoop` (dev agent) é o TEXTO do frame final quando há
  um — nunca a tupla `{:final, …}` inspecionada; outras formas seguem com
  `inspect/1`. Com crédito do provider esgotado (`errorCode:
  insufficient_credit`, RN-730, ou o reconhecimento por texto da RN-726), a
  `mensagem` da bolha é curta e acionável no idioma do turno (RN-622): pt
  "Crédito do provedor do modelo esgotado — recarregue a chave e tente de
  novo.", qualquer outro idioma "The model provider's credit is exhausted —
  top up the key and try again."; sem idioma resolvido, pt-BR. O JSON do
  provider fica só no `reason` (diagnóstico). Os demais erros mantêm a frase
  de sempre.
- **Onde:** `apps/engine/lib/engine/agents/falha_de_turno.ex:166` (`mensagem`),
  `:189` (`diagnostico`)
- **Teste:** `apps/engine/test/engine/agents/dev_lead_server_test.exs` (402
  em pt-BR e en: frase curta, `reason` sem `{:final`; erro `upstream`: frase
  de sempre), `apps/engine/test/engine/agents/falha_de_turno_test.exs`
- **Origem:** AT-421 (TP-01 de 03/10, 2ª rodada: o Dev Lead gravou
  `reason: "{:final, …"` e a bolha despejou o JSON do 402)

### RN-735 — A rede `none` da imagem do Arquiteto diz que não instala dependências {#rn-735}

- **Regra:** a descrição de `choose_project_image` e o RESULTADO dela dizem
  que, com rede `none`, nenhum gerenciador de pacotes (npm, pnpm, pip, mix,
  cargo, go mod...) instala dependência no container, e que a Infra herda essa
  rede (RN-723). Com `none`, o resultado pede ao modelo que chame a ferramenta
  de novo com `egress` se a stack instala dependências. É AVISO: a api não
  adivinha a stack, e a contenção do broker (ADR 0130) não muda. (Desde a
  RN-906 a api RECUSA `none` quando a stack declarada de um módulo baixa
  dependências; fora desse caso, segue só o aviso.)
- **Código:** `apps/engine/lib/engine/harness/tools/choose_project_image.ex:96`
  (`mensagem_de_fixada`), `apps/engine/lib/engine/harness/tools/choose_project_image.ex:23`
  (`spec`)
- **Teste:** `apps/engine/test/engine/harness/tools/choose_project_image_test.exs`
- **Origem:** AT-420 (TP-01 de 03/10: `node:22-bookworm-slim` com rede `none`,
  e o dev agent não conseguiu `npm install`)

### RN-742 — O dev agent não morre calado, e a resposta HTTP tardia não fica na caixa dele {#rn-742}

- **Regra:** toda chamada HTTP não-streamada do engine à api
  (`post_returning/3` e os GETs de `EngineApiClient.Live`) roda numa `Task`
  descartável; a resposta que chega depois do `receive_timeout` cai num
  processo que já acabou, nunca na caixa de mensagens de quem chamou, e
  exceção dentro do pedido volta como `{:error, _}`. E o dev agent que CAI
  (saída que não é `:normal` nem `:shutdown`) não é tratado como terminado: o
  `Engine.Dev.Monitor` grava `agent.error` DURÁVEL com origem `infra`
  (`reason: processo_do_dev_caiu`, `religado`, `taskId`) e o RELIGA a partir
  da própria linha de `dev_agent_states`, até 3 vezes por agente; o `resume`
  passa pelo `handle_continue({:restart_recovery, _})` que já existia, que
  bloqueia a task interrompida com diagnóstico (origem `infra`) e tenta o
  próximo claim. Sem linha, ou no teto, a linha sai e o erro diz que não
  houve religamento. O `llm_turn_stream/6` fica fora do isolamento (o `into:`
  grava no dicionário do chamador); os conversacionais já o chamam de dentro
  da Task do turno (`TurnoAssincrono`), então o padrão "HTTP dentro do
  GenServer" não os alcança — declarado. A web não mudou: a aba Executores
  passa a ver o `agent.error` e o `dev.blocked` da recuperação.
- **Onde:** `apps/engine/lib/engine/sessions/engine_api_client.ex:2171`
  (`isolado`), `apps/engine/lib/engine/dev/monitor.ex:69` (`ao_terminar`),
  `:107` (`registrar_e_religar`)
- **Teste:** `apps/engine/test/engine/sessions/engine_api_client_isolado_test.exs`
  (mensagem tardia não chega ao chamador; exceção vira `{:error, _}`),
  `apps/engine/test/engine/dev/monitor_test.exs` (crash grava `agent.error`
  infra e religa; `:normal` apaga a linha; sem linha não religa)
- **Origem:** AT-428 (08/10: `CaseClauseError` em
  `Finch.HTTP1.Conn.receive_response/8` depois do timeout do `npm install`)

**Revisada pela [RN-922](#rn-922) ([ADR 0226](../adr/0226-diario-vivo-e-retomada-dos-agentes.md)).** O dev que cai com `working` recente e sem retomada anterior na tarefa deixa de ser bloqueado: preserva o worktree como commit e retoma a mesma tarefa uma vez. Fora disso o bloqueio descrito acima segue.

### RN-743 — Bloquear a task preserva o trabalho do worktree, e a próxima parte dele {#rn-743}

- **Regra:** antes de bloquear uma task (qualquer origem, inclusive o teto de
  orçamento `taskBudgetMicros`, cujo VALOR não muda aqui), o que o dev agent
  deixou no worktree vira commit na branch da própria task, com a identidade
  `<agente>[bot]` (`git add -A` + `commit --no-verify`). O `dev.blocked` leva
  `trabalhoPreservado` (`{branch, commit}` ou `null`) e o diagnóstico DIZ onde
  o trabalho ficou — ou que não foi possível preservá-lo, com o motivo; a falha
  ao preservar nunca impede o bloqueio. A próxima task do MESMO agente (logo,
  do mesmo módulo) nasce dessa branch (`create_from/4`) em vez de `dev`, uma
  vez só. Worktree limpo não gera commit. Declarado: o ponteiro mora só em
  memória (restart do engine perde o ponteiro, não o commit), e no modo
  `runner` o worktree está na máquina do usuário e o engine não preserva nada.
- **Onde:** `apps/engine/lib/engine/dev/worktree_manager.ex:72`
  (`preservar_em`), `:55` (`create_from`),
  `apps/engine/lib/engine/dev/agent_io.ex:491` (`preservar_trabalho`),
  `apps/engine/lib/engine/dev/agent_io.ex:321` (`base_preservada`)
- **Teste:** `apps/engine/test/engine/dev/worktree_manager_test.exs`
  (`preservar_em/3 e create_from/4`: commit com `dev-api[bot]` e a próxima
  task enxerga o arquivo; limpo é `:nada`; pasta sem repositório é erro),
  `apps/engine/test/engine/dev/bloqueio_preserva_trabalho_test.exs` (o
  `dev.blocked` diz a branch; falha ao preservar não impede o bloqueio)
- **Origem:** AT-429 (08/10: `feature/task-86dade03` sem commit, `package.json`
  e `src` perdidos depois do bloqueio por orçamento)

### RN-744 — O dev sabe que o shell é `sh` e começa vendo o próprio worktree {#rn-744}

- **Regra:** a descrição da ferramenta `terminal` diz que o shell do container
  é `sh` (dash), não bash — sem brace expansion, sem `[[ ]]`, sem arrays, sem
  `source` — e dá a forma que funciona. O kickoff de cada task do dev agent
  ganha uma segunda mensagem fixada com o RETRATO do worktree: a branch e os
  arquivos que já existem (rastreados + não rastreados não ignorados), com teto
  de 80 linhas e o total real quando corta (ADR 0060); é o servidor que monta,
  sem parâmetro do modelo. Pasta que o engine não alcança (modo `runner`) diz
  que o retrato está indisponível e manda listar pelo `terminal`. Declarado e
  NÃO corrigido: o worktree do dev pode nascer antes do merge da PR de infra,
  então o que a Infra entregou por PR pode não estar na `dev` de onde ele
  parte.
- **Onde:** `apps/engine/lib/engine/harness/tools/terminal.ex:12` (`spec`),
  `apps/engine/lib/engine/dev/worktree_manager.ex:108` (`retrato`),
  `apps/engine/lib/engine/dev/dev_agent_server.ex:595` (`retrato_do_worktree`)
- **Teste:** `apps/engine/test/engine/dev/worktree_manager_test.exs`
  (`retrato/2`: branch e arquivos; pasta inalcançável diz indisponível; a
  descrição do terminal diz `sh`)
- **Origem:** AT-444 (TP-01 de 08/10: `mkdir -p src/{a,b}` no dash e o dev
  recriando o que já existia)

### RN-745 — Na resposta cortada, só a chamada incompleta é recusada {#rn-745}

- **Regra:** quando a resposta do modelo vem cortada pelo teto de saída
  (`truncated: true`, [RN-737](api.md#rn-737)), só a ÚLTIMA chamada de ferramenta da
  resposta é tratada como incompleta e recusada com o erro nomeado (que agora
  diz "a última da resposta", que as anteriores foram executadas e pede "uma
  por chamada"). As chamadas anteriores da mesma resposta executam
  normalmente — medido no código: o stream OpenAI-compatível monta as
  chamadas em ordem, o corte cai na última, e o `parseArgumentos` da api
  devolve `{}` para o JSON partido. A chamada é identificada por nome e
  argumentos. Resposta cortada sem chamada conhecida continua recusando toda
  ferramenta (régua da RN-737). A descrição de `propose_adr` orienta um ADR por
  resposta.
- **Onde:** `apps/engine/lib/engine/harness/resposta_cortada.ex:44`
  (`registrar`), `:64` (`incompleta?`),
  `apps/engine/lib/engine/harness/argumentos_de_ferramenta.ex:26` (`executar`),
  `apps/engine/lib/engine/harness/tools/propose_adr.ex:27` (`spec`)
- **Teste:** `apps/engine/test/engine/harness/resposta_cortada_test.exs` ("só
  a última chamada da resposta cortada é recusada; as completas executam";
  "ferramenta de resposta cortada NÃO executa", sem chamada conhecida)
- **Origem:** AT-430 (08/10: o Arquiteto mandou 5 `propose_adr` numa resposta
  cortada e as cinco foram recusadas; 0 ADRs)

### RN-746 — O fecho do Arquiteto diz o que gravou, e as escritas recusadas são contadas {#rn-746}

- **Regra:** a linha factual "Gravado neste turno: …" da
  [RN-731](#rn-731) passa a contar as escritas do Arquiteto (ADR proposto,
  mapa de módulos, atribuição de módulos, imagem decidida, diagrama C4,
  roteamento para a infra, contrato de módulos, insight), a RFC do Staff e o
  protótipo do UX Designer, e conta à parte as chamadas de ESCRITA recusadas
  (`{:error, _}`) do turno: "…; N chamadas de escrita recusadas". Turno que
  tentou escrever e não gravou nada fecha com "Gravado neste turno: nada; N
  chamadas de escrita recusadas." (en: "Recorded this turn: nothing; N write
  calls refused."). O Criativo passa a anotar a recusa também; Staff e UX
  Designer passam a anotar. Leitura nunca conta. O texto do modelo não é
  reescrito (RN-163: o agente não anuncia como feito o que o servidor
  recusou — quem lê vê o fato ao lado). Fora, declarado: Dev Lead (o plano
  suspende o turno, RN-284) e Infra Lead.
- **Onde:** `apps/engine/lib/engine/agents/gravado_no_turno.ex:77` (`anotar`),
  `:96` (`descarregar`), `:141` (`classe`),
  `apps/engine/lib/engine/agents/arquiteto_server.ex:330` (`dispatch_tool`)
- **Teste:** `apps/engine/test/engine/agents/gravado_no_turno_test.exs`
  ("Arquiteto com as cinco propose_adr recusadas fecha com nada gravado";
  "escritas do Arquiteto contadas, leitura e ferramenta desconhecida não")
- **Origem:** AT-431 (08/10: com os 5 `propose_adr` `ok: false`, o Arquiteto
  fechou com "✅ ADRs Propostas (5 decisões críticas)" e nenhuma linha factual)

### RN-756 — A Anamnese só roda com interação de conteúdo técnico do sujeito; aprovar não conta {#rn-756}

- **Regra:** revisa a contagem de "interação própria" da RN-680/RN-722. Só
  contam para fazer alguém sujeito da rodada (a) evento `actor_kind: "user"`
  do próprio membro cujo tipo está em `tipos_de_evento_com_conteudo/0` —
  `chat.message` (mensagem escrita por ele) e
  `chat.structured_question_answered` — e (b) decisão de ação com motivo de
  recusa escrito (`rejectionReason` não vazio, uma correção). Aprovação,
  aceite de handoff, clique e qualquer outro evento de usuário NÃO contam:
  não são evidência de competência. O piso de 5 (RN-722), o teto diário e o
  desfecho sem sujeito (motivo no log; `anamnese.run_skipped` só na rodada
  pedida à mão) não mudam, e a triagem segue LOCAL, antes do LLM e do RAG.
- **Código:** `apps/engine/lib/engine/anamnese/elegibilidade.ex:61`
  (`avaliar`), `:102` (`recusa_com_motivo?`), `:108`
  (`tipos_de_evento_com_conteudo`)
- **Teste:** `apps/engine/test/engine/anamnese/elegibilidade_test.exs`
  (`só interação com conteúdo técnico conta (RN-756, AT-439)`: mensagem e
  resposta estruturada fazem sujeito; só aprovações, handoff e recusa sem
  motivo não fazem)
- **Origem:** AT-439 (TP-01, 08/10, projeto `c1dc053d`: duas rodadas durante
  a execução, US$ 0,20, ambas `skip_proficiency` com "o usuário apenas
  aprovou propostas")

### RN-757 — O `terminal` auto-aprovado espera o comando, e o teto do comando é 2 min {#rn-757}

- **Regra:** a ação `terminal` que a api auto-aprova é EXECUTADA dentro da
  mesma requisição do `propose_action` (api → engine
  `/internal/actions/execute` → api `container-exec` → broker), e o engine
  espera essa requisição por `TERMINAL_ACTION_TIMEOUT_MS` + 120 s — não pelo
  default de 15 s do `Req`. O teto do comando (`TERMINAL_ACTION_TIMEOUT_MS`)
  passa de 15 s para 120 s nos três composes e no `runtime.exs`. A cadeia fica
  broker (T) < api → broker (T + até 45 s, [RN-604](api.md#rn-604)) < engine →
  `container-exec` (T + 90 s) < engine → `propose_action` (T + 120 s), e com
  T = 120 s o salto de fora (240 s) segue abaixo dos 300 s de cabeçalhos do
  `fetch` do Node. Se a espera ainda estourar, o modelo recebe texto NOMEADO
  — o teto em segundos, que o processo pode seguir rodando e a sugestão de
  `nohup … &` com log —, nunca `%Req.TransportError{reason: :timeout}` cru.
  Exec assíncrono/streaming foi considerado e não feito: a menor mudança que
  faz `npm install` comum caber é o teto.
- **Onde:** `apps/engine/lib/engine/sessions/engine_api_client.ex:1945`
  (`opcoes_do_propose_action`) e
  `apps/engine/lib/engine/harness/hooks/action_pipeline.ex:85`
  (`resultado_de_teto_do_terminal`)
- **Teste:** `apps/engine/test/engine/sessions/engine_api_client_propose_terminal_test.exs`
  (api falsa que demora 16 s ainda é esperada; ordem dos tetos abaixo de
  300 s; o texto de estouro nomeia o teto)
- **Origem:** AT-440 (TP-01 de 08/10: `npm install 2>&1 | tail -50` num
  container `node:22-bookworm-slim` voltou "falha no pipeline:
  %Req.TransportError{reason: :timeout}"; medido nesta máquina, o mesmo
  `npm install` de `bcrypt`+`sqlite3`+`express` levou 5,3 s com a imagem em
  cache e prebuilds disponíveis — a cadeia, não o comando, cortava em 15 s)

### RN-760 — A próxima task do dev agent parte da última branch dele ainda não mergeada {#rn-760}

- **Regra:** generaliza a [RN-743](#rn-743). Ao terminar uma task — aprovada
  nos gates (`nextAction: "done"`) ou bloqueada por QUALQUER motivo, inclusive
  o "ciclo de correção esgotado (gate)" que a api decide e chega ao engine só
  como `gate_resolved` —, o dev agent guarda a branch dela e a próxima task do
  MESMO agente (logo, do mesmo módulo) nasce dessa branch, e não de `dev`. O
  que sobrou sem commit no worktree é preservado antes, como na RN-743; o
  ponteiro gravado pelo `block_task/4` não é sobrescrito. Quando a branch
  anterior já é ancestral da `dev` local (mergeada), a próxima parte da `dev`,
  que já a contém. QUANDO a fila anda não muda: a próxima task continua sendo
  reivindicada ao fim dos gates, antes do merge do usuário (decisão do dono).
  Declarado: merge por squash num remoto não deixa a branch ancestral da `dev`,
  então a próxima segue partindo dela; o ponteiro continua só em memória, e no
  modo `runner` a checagem de merge não roda.
- **Onde:** `apps/engine/lib/engine/dev/agent_io.ex:296`
  (`levar_branch_para_a_proxima`), `:324` (`criar_worktree`),
  `apps/engine/lib/engine/dev/worktree_manager.ex:199`
  (`ja_mergeada_volta_ao_trabalho`)
- **Teste:** `apps/engine/test/engine/dev/bloqueio_preserva_trabalho_test.exs`
  (`levar_branch_para_a_proxima/1 e criar_worktree/2`: aprovada leva a branch
  para a próxima; o ponteiro do bloqueio não é sobrescrito),
  `apps/engine/test/engine/dev/worktree_manager_test.exs` (`add_worktree/4
  com a branch da task anterior`: não mergeada parte dela, mergeada parte da
  `dev`)
- **Origem:** AT-447 (TP-01 de 09/10: tasks `762833bd` e `5ebad64b` — a
  segunda nasceu de `dev` sem a rota de login da primeira, e o QA reprovou)

### RN-763 — Encerrar a sessão de execução para os dev agents e os gates, e "Parar execução" na aba Executores {#rn-763}

- **Regra:** o fechamento da sessão (`session.closed`/`closed_abnormally`,
  pelo `SessionLifecycleWorker`, o ponto por onde todo fechamento passa) PARA
  os dev agents dela em todos os nós e os gates (QA lead e SecOps) do projeto
  — a régua que já valia para os conversacionais ([RN-581](api.md#rn-581)). O
  processo é derrubado na hora, sem gravar o turno em curso, e o
  `Engine.Dev.Monitor` é avisado antes (`esquecer/1`): a linha durável sai e
  o agente NÃO é religado ([RN-742](#rn-742)). Para cada dev com task em curso
  (`working`, `awaiting_approval` ou `awaiting_gate`), o trabalho do worktree
  vira commit na branch da task ([RN-743](#rn-743)) e a task é BLOQUEADA com
  motivo "sessão de execução encerrada", origem `politica`, e o diagnóstico
  dizendo onde ficou o trabalho — volta à fila quando um humano a libera,
  nunca perdida. As linhas de `gate_states` da sessão saem, para o
  `GateRescuer` não reabrir ciclo da sessão encerrada. A aba Executores ganha
  "Parar execução" (papel `developer`, o de encerrar sessão), cujo mecanismo é
  o MESMO fechamento (`closing` → `closed`), sem estado novo; a confirmação
  diz antes do clique o que fica: as tarefas em curso (com a contagem), as PRs
  abertas, as aprovações pendentes e que a sessão não reabre. Declarado: ação
  pendente de dev agent continua pendente; PR aberta continua aberta; sessão
  com `execution.activated` não reabre ([RN-650](api.md#rn-650)), então retomar é
  ativar a execução numa sessão nova; a contagem de tarefas da confirmação vem
  da janela de eventos da aba. A confirmação no "Encerrar" da barra da sessão
  é de outra atividade (AT-452).
- **Onde:** `apps/engine/lib/engine/dev/encerramento_da_sessao.ex:40`
  (`parar_da_sessao`), `:74` (`parar_processos`), `:104` (`devolver_task`),
  `apps/engine/lib/engine/dev/monitor.ex:34` (`esquecer`),
  `apps/engine/lib/engine/workers/session_lifecycle_worker.ex:94`
  (`parar_execucao`), `apps/web/src/components/PararExecucao.tsx`
- **Teste:** `apps/engine/test/engine/dev/encerramento_da_sessao_test.exs`
  (o dev morre sem ser religado, a linha sai, a task é bloqueada com origem
  `politica`; sessão sem dev é no-op e o dev de outra sessão fica de pé),
  `apps/web/src/components/PararExecucao.test.tsx` (a confirmação diz o que
  fica e fecha `closing` → `closed`; a recusa da api fica na confirmação; sem
  papel o botão fica inerte com o motivo)
- **Origem:** AT-456 (TP-01 de 09/10: com a sessão de execução encerrada, o
  `dev-encurtador-api` bloqueou a tarefa 3, pegou a 4 e abriu PR; o único
  freio foi parar o container)

### RN-765 — O gate de QA julga a TAREFA, e RF de tarefa irmã é observação {#rn-765}

- **Regra:** a QA-estratégia (plano de teste, [RN-674](#rn-674)) e a
  QA-automação recebem, além da história, o RECORTE da tarefa: título e
  descrição, as regras de negócio da história e as OUTRAS tarefas da mesma
  história com o status (`siblingTasks` em `GET .../dev-context`). O veredito
  é sobre o que é DESTA tarefa: requisito que pertence a uma tarefa irmã
  (feita ou pendente) não reprova — vai ao `resumo` como observação, fora de
  `itens`, e não impede `approved`. A régua é de PROMPT, não de código: o
  `emit_qa_verdict` continua exigindo só a suite verde para aprovar. Desde a
  AT-479, quando a descrição da tarefa ou uma regra quantifica POR item ("por
  X", "cada", "de todos os" — "por exemplo"/"por padrão" não contam), o recorte
  ganha a seção "Forma da resposta": conferir que a resposta traz o valor de
  CADA item, não só o total (o painel aprovado com só `{totalCliques}` sobre
  "a contagem… de todos os links"), e que a recusa de entrada nomeia o campo —
  esta última é OBSERVAÇÃO no `resumo`, fora de `itens`, salvo regra que a
  exija. Continua régua de prompt: nenhuma reprovação nova no código.
- **Onde:** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:18` (`texto`),
  `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:82` (`secao_da_forma`),
  `apps/api/src/application/use-cases/execution/get-dev-task-context.use-case.ts:195`
  (`tarefasIrmas`) e `apps/engine/lib/engine/gates/qa_automacao_agent.ex:170`

  `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:82` (`secao_da_forma`),
  `apps/api/src/application/use-cases/execution/get-dev-task-context.use-case.ts:195`
  (`tarefasIrmas`) e `apps/engine/lib/engine/gates/qa_automacao_agent.ex:225`
  (`com_o_recorte`)
- **Teste:** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs` (desde
  a AT-479 também "regra que quantifica por item pede a conferência da forma da
  resposta" e o caso sem quantificador) e
  `apps/api/test/application/use-cases/execution/get-dev-task-context.use-case.spec.ts`
  (as irmãs sem a própria tarefa). O golden-set do QA (ADR 0168) NÃO ganhou
  caso: ele roda o modelo de verdade, e provar o veredito sem chamada paga
  não é possível — declarado.
- **Origem:** AT-448 (TP-01 de 09/10: o gate de QA da tarefa "Modelar tabela
  de usuários e hash bcrypt" reprovou três vezes por "RF01: login HTTP com
  JWT não existe nesta entrega", que é de outra tarefa, e a tarefa bloqueou;
  `artifact.qa_verdict` das tasks `42bea901` e `762833bd`)

### RN-772 — O Arquiteto lê o status ATUAL das ADRs que propôs {#rn-772}

- **Regra:** o Arquiteto tem a leitura `listar_adrs_propostas`: as ações
  `open_adr_pr` do PROJETO, lidas agora de `proposed_actions` (mesmo
  Postgres, sem HTTP no laço), com o status de cada uma — pendente, aprovada,
  aprovada automaticamente, executada (com a URL da PR), recusada (com o
  motivo) ou falhada. Contida (ADR 0060, [RN-164](#rn-164)): sem parâmetro,
  escopo fechado no projeto do contexto, uma contagem e uma consulta por
  chamada, as 20 mais recentes, e o total real dito quando corta. Falha de
  leitura é `tool.result` `ok: false` com o motivo, nunca texto vazio. Desde a
  [RN-784](api.md#rn-784) ela ESTÁ no piso do Jev.
- **Onde:** `apps/engine/lib/engine/harness/tools/listar_adrs_propostas.ex:37`
  (`run`), `:40` (`ler`), `apps/engine/lib/engine/agents/arquiteto_server.ex:615`
  (`ListarAdrsPropostas`)
- **Teste:** `apps/engine/test/engine/harness/tools/listar_adrs_propostas_test.exs`
  (aprovada aparece aprovada, executada com a PR, recusada com o motivo, só as
  do projeto; teto com o total real; sem proposta; leitura que falha vira erro
  nomeado)
- **Origem:** AT-454 (TP-01 de 09/10, sessão `771131f4`: com as 3 ADRs
  aprovadas, o fecho seguinte disse "As 3 ADRs seguem pendentes de aprovação")

### RN-773 — O Arquiteto lê o backlog, e consulta antes de afirmar estado {#rn-773}

- **Regra:** o Arquiteto ganha a mesma `listar_backlog` do PO
  ([RN-164](#rn-164)), com a contagem de tarefas por história. O kickoff dele e
  o resultado do `propose_adr` dizem que o status das ADRs e as tarefas mudam
  fora da conversa e mandam consultar as duas leituras antes de afirmá-los, em
  vez do retrato de um resultado anterior. Nada de fluxo do time é narrado
  aqui ([RN-711](#rn-711)).
- **Onde:** `apps/engine/lib/engine/agents/arquiteto_server.ex:616`
  (`ListarBacklog`), `apps/engine/lib/engine/harness/tools/propose_adr.ex:94`
  (`propor`)
- **Teste:** `apps/engine/test/engine/harness/tools/listar_backlog_test.exs`
  (a contagem de tarefas por história), `apps/engine/test/engine/agents/arquiteto_server_test.exs`
  (as duas leituras estão no catálogo do Arquiteto)
- **Origem:** AT-454 (TP-01 de 09/10: com 17 tarefas no backlog, o Arquiteto
  disse "faltam as tarefas" e "não consigo verificá-las daqui")

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

### RN-778 — O dev agent órfão fecha por evento novo no boot {#rn-778}

- **Regra:** no boot, para cada sessão não terminal, o dev agent cujo último
  `dev.*` na sessão é de espera (`dev.working`, `dev.blocked`, `dev.idle_tripped`
  e os demais que o `GetSessionPendingWorkUseCase` conta) e que NÃO tem linha
  em `dev_agent_states` NESTA sessão ganha `dev.error` com origem `infra`
  (`reason: dev_agent_sem_processo`) seguido de `dev.idle`, que o tira da régua
  do trabalho pendente ([RN-064](web.md#rn-064)). É o molde
  da [RN-586](#rn-586) para o vocabulário `dev.*`: nunca reexecuta, nunca
  reescreve evento, e a linha durável é a prova de dono — com ela o
  `DevRehydrator` religa o agente, e fechá-lo seria matar um agente saudável.
  Não toca a tarefa: tarefa bloqueada ou com PR esperando o merge continua
  segurando a sessão de execução vigente pela RN-776 (AT-457), que tem dono
  humano.
- **Onde:** `apps/engine/lib/engine/dev/dev_orfao.ex:49` (`varrer`),
  `apps/engine/lib/engine/sessions/rehydrator.ex:81` (`varrer`)
- **Teste:** `apps/engine/test/engine/dev/dev_orfao_test.exs` (o órfão fecha
  com `dev.error` infra + `dev.idle`; o que tem linha durável e o que já está
  `idle` não; leitura que falha não fecha nada)
- **Origem:** AT-465 (TP-01 de 09/10: a sessão `63a4e1aa` reagendada pelo
  heartbeat a cada 30 s por um `dev.working` sem processo)

**Citada pela [RN-922](#rn-922) ([ADR 0226](../adr/0226-diario-vivo-e-retomada-dos-agentes.md)), sem mudar:** o dev sem linha durável em `dev_agent_states` continua só fechado, porque não há tarefa a retomar.

### RN-779 — O worktree da task (re)pegada parte da `dev` ATUAL e a integra {#rn-779}

- **Regra:** antes de criar o worktree de uma task (primeira vez ou retomada),
  o engine faz `git fetch origin` no working tree do projeto (serializado por
  projeto) — é no remoto que as PRs são mergeadas, e a `dev` local só andava no
  checkout da inicialização. A ponta da `dev` é `origin/dev` quando a local
  ficou para trás. A task nasce: (1) da branch da task anterior não mergeada
  (RN-760), (2) da PRÓPRIA branch quando ela tem trabalho que a `dev` não
  contém — a task retomada num processo novo, que perdeu o ponteiro em memória
  (RN-743) —, ou (3) da ponta atual da `dev`. Nos casos (1) e (2) o worktree
  INTEGRA a ponta da `dev` (`merge --no-ff`, identidade `<agente>[bot]`) antes
  do primeiro passo. Conflito nessa integração é recusa NOMEADA ("conflito ao
  integrar a `dev` atual", com os arquivos), o merge é abortado, a branch de
  origem fica intacta e a task bloqueia com motivo próprio e origem `codigo`.
  `fetch` que falha bloqueia a task com o motivo do git, nunca cai na `dev`
  velha. A readoção depois de conflito de merge (RN-715) não integra sozinha.
  Medido no TP-01: a AT-447 DISPAROU no 1º claim (reflog: `Created from
  feature/task-b3cc92b8`); quem perdeu a base foi o reclaim, que redefiniu a
  branch para a `dev` LOCAL parada no merge da infra (`Reset to dev`).
  Declarado: no modo `runner` nada disso roda (o git é da máquina do usuário).
- **Onde:** `apps/engine/lib/engine/dev/worktree_manager.ex:151`
  (`atualizar_remoto`), `:195` (`add_worktree`), `:227`
  (`ponta_do_trabalho`), `:225` (`retomada`), `:300` (`integrar_trabalho`)
- **Teste:** `apps/engine/test/engine/dev/worktree_manager_test.exs`
  (`integração da dev atual (RN-779)`: retomada com branch antiga parte da dev
  nova do remoto; trabalho preservado integra a dev nova; anterior em
  `awaiting_user` é a base com a dev integrada; conflito é recusa nomeada)
- **Origem:** AT-458 (TP-01 de 09/10: `feature/task-c80daf6c` nasceu de
  `1fa2241` sem as 12 tarefas mergeadas depois, e o merge conflitou)

### RN-780 — Resposta só de raciocínio cortada pelo teto é corte, não desistência {#rn-780}

- **Regra:** no `ToolLoop` (caminho de todo agente de execução e de gate),
  a resposta sem texto e sem chamada de ferramenta que a api marca
  `truncated: true` (o `finish_reason: length` da RN-737) é o raciocínio que
  comeu o teto de saída. A volta é retentada UMA vez, sem a resposta vazia no
  histórico e contando iteração — o teto de iterações e o orçamento da tarefa
  continuam valendo. Se repetir, o laço para marcando `corte_pelo_teto`, e o
  dev agent bloqueia a task com o motivo "resposta só de raciocínio, cortada
  pelo teto" e origem `modelo`, em vez de "parou sem concluir nem reportar
  bloqueio". Uma chamada de ferramenta no meio zera a retentativa. Declarado:
  o engine recebe da api `truncated` e `usage.outputTokens`, mas NÃO os
  `reasoningTokens` (ficam só em `token_usage`), então a resposta vazia que
  bate no teto sem `finish_reason: length` não é reconhecida.
- **Onde:** `apps/engine/lib/engine/harness/tool_loop.ex:250`
  (`parada_sem_chamada`), `apps/engine/lib/engine/dev/dev_agent_server.ex:1124`
  (`motivo_da_parada`), `:1143` (`stop_diagnosis`)
- **Teste:** `apps/engine/test/engine/harness/tool_loop_test.exs` (`corte só
  de raciocínio`: retentada uma vez e segue; repetido para com
  `corte_pelo_teto`), `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  (`resposta só de raciocínio cortada pelo teto bloqueia com motivo nomeado`)
- **Origem:** AT-459 (TP-01 de 09/10: a tarefa `c80daf6c` bloqueou em 40 s
  com 8.192 tokens de saída, todos de raciocínio)

### RN-781 — A mensagem de commit do dev não grava pendência que é do sistema {#rn-781}

- **Regra:** o resumo do `report_done` é a mensagem de commit do dev agent, e
  commit, push e PR são feitos pelo sistema depois dele. Antes de propor o
  `git_commit`, o engine corta do marcador de pendência ("Pendente",
  "Pendência", "Pending") ao fim quando o resto fala de commit, push ou PR, e
  tira o parêntese "(ainda sem commit…)"; pendência que não fala disso fica.
  A descrição do campo `summary` diz que ele vira a mensagem de commit e que
  não se narra commit, push nem PR. Resumo que fica vazio cai na mensagem
  padrão `<agente>: <task>`.
- **Onde:** `apps/engine/lib/engine/dev/agent_io.ex:374`
  (`mensagem_de_commit`), `:373` (`propose_commit`),
  `apps/engine/lib/engine/dev/tools/report_done.ex:27` (`summary`)
- **Teste:** `apps/engine/test/engine/dev/mensagem_de_commit_test.exs`
  (corta a narração; tira o parêntese; pendência alheia ao sistema fica)
- **Origem:** AT-464 item 2 (TP-01 de 09/10: `git log feature/task-9d6dcd53`
  com "Pendente: commit… as ações git_commit, git_push e pr_open não estavam
  disponíveis neste passo")

### RN-787 — O gate conta o diff da PR contra a `dev` da origem, e o parecer de QA grava lista {#rn-787}

- **Regra:** (1) o diff que o QA e o SecOps julgam (`dev...HEAD`,
  [RN-664](#rn-664)) usa a `dev` MAIS NOVA que o working tree enxerga: com
  origem local (caminho no disco) o gate faz antes `git fetch origin dev`,
  melhor esforço, e entre `origin/dev` e a `dev` local vale a que contém a
  outra. A `dev` local do clone não anda quando a PR é mergeada na origem, e o
  parecer do SecOps contava o acumulado das tarefas já mergeadas. Com origem
  remota não há fetch no gate (a credencial é do `Workspace`) — declarado. O
  semgrep e o gitleaks seguem varrendo o worktree inteiro, não só o diff:
  estreitar o que o scanner vê muda o que o gate reprova, e isso fica para o
  dono. (2) `itens` e `coverageMatrix` do parecer de QA chegam ao
  `artifact.qa_verdict` sempre como LISTA: string JSON de lista é decodificada
  (o molde da [RN-719](#rn-719)), e string que não é lista vira `[]`.
- **Onde:** `apps/engine/lib/engine/gates/diff.ex:44` (`base_mais_nova`),
  `apps/engine/lib/engine/gates/hooks/termination.ex:54` (`lista`)
- **Teste:** `apps/engine/test/engine/gates/diff_test.exs` (a tarefa B nascida
  da A, com a A mergeada na origem: o diff é só B) e
  `apps/engine/test/engine/gates/hooks/termination_test.exs` (string JSON vira
  lista; lista intacta; string inválida vira `[]`)
- **Origem:** AT-464 itens 1 e 3 (TP-01 de 09/10, sessão `80e3ce09`: "17
  arquivo(s) alterado(s) nesta PR" numa PR de 3 arquivos contra a `dev`, e
  `coverageMatrix`/`itens` gravados como `"[]"` nos últimos pareceres)

### RN-790 — O README de como subir o entregável é critério do DoD que o PO escreve {#rn-790}

- **Regra:** a instrução de kickoff do PO manda incluir, no DoD da história que
  cria a entrada da aplicação (servidor, CLI, configuração ou persistência) — ou
  numa história própria —, o critério "README diz como instalar, configurar
  (variáveis de ambiente obrigatórias e opcionais, com o padrão) e subir a
  aplicação, e como criar o primeiro acesso, quando houver". O dev agent cumpre
  o DoD da história, e o gate o julga por ele. Régua de PROMPT, como a
  [RN-765](#rn-765): nenhuma ferramenta recusa história sem esse critério. A
  outra variante — o dev agent atualizar o README em toda tarefa que mexe em
  configuração/entrada — NÃO foi feita: exigiria classificar a tarefa no
  `AmbienteDoAgente` ou no `report_done`, regra nova de código — declarado.
- **Onde:** `apps/engine/lib/engine/agents/po_server.ex:593` (`kickoff_instruction`)
- **Teste:** `apps/engine/test/engine/agents/po_server_test.exs:438` (a
  instrução de kickoff traz o critério do README)
- **Origem:** AT-466 (TP-01 de 09/10: o `encurtador-api` saiu com um README só
  com `npm test`, sem `JWT_SECRET` obrigatório, `DB_PATH`/`PORT`, `npm start`
  nem como criar o primeiro membro)

### RN-792 — Ao declarar o contrato, o Arquiteto recebe as rotas das histórias que o contrato não declara {#rn-792}

- **Regra:** depois de `declare_module_contracts` gravar a versão
  ([RN-684](api.md#rn-684)), a ferramenta lê o backlog do projeto e extrai, de forma
  determinística e sem LLM, todo `MÉTODO /caminho` (GET, POST, PUT, PATCH,
  DELETE) do título, descrição, RF e DoD das histórias não arquivadas, e o
  mesmo padrão das `assinatura`s do contrato. Rota citada por história e
  ausente da UNIÃO das rotas do contrato (a história do front cita a rota do
  back) volta no resultado como DIVERGÊNCIA, com o que o contrato declara no
  mesmo método — entrada do laço ([RN-163](#rn-163)), para o Arquiteto
  corrigir o contrato ou registrar a decisão. Parâmetro (`:id`, `{id}`), barra
  final e query string são normalizados; teto de 10 linhas, com o total. A
  leitura do backlog falhar NÃO recusa a declaração (já gravada): o resultado
  diz que não conferiu. Fica de fora, declarado: rota que só o contrato
  declara (não é divergência), história editada DEPOIS da declaração (só é
  conferida na próxima), e o contrato acompanhar a rota que o DEV renomeou
  (o QA nomeia a divergência no parecer, [RN-786](api.md#rn-786), mas nada a leva
  de volta ao Arquiteto).
- **Onde:** `apps/engine/lib/engine/harness/rotas_do_contrato.ex:37`
  (`divergencias`), `apps/engine/lib/engine/harness/tools/declare_module_contracts.ex:119`
  (`conferencia_com_historias`)
- **Teste:** `apps/engine/test/engine/harness/tools/declare_module_contracts_test.exs`
  (`GET /painel` na história × `GET /panel` no contrato acusa; rota igual com
  parâmetro e barra normalizados não acusa; backlog ilegível diz que não
  conferiu)
- **Origem:** AT-468 (TP-01 de 09/10: a história pedia `GET /painel`, o
  contrato declarou `GET /panel`, e ninguém acusou na arquitetura)

### RN-796 — O item do gitleaks diz a regra e o trecho com o segredo mascarado {#rn-796}

- **Regra:** o item que o `gitleaks` põe no parecer do SecOps leva, além do
  caminho e da linha, a regra que acusou (`RuleID`) e o trecho acusado
  (`Match`) com o segredo (`Secret`) trocado por `***` — nunca o segredo em
  claro. Sem o `Secret` para mascarar, o trecho não entra. E o ambiente do
  agente de execução ([RN-706](#rn-706)) diz em uma linha que senha, token ou
  chave de teste são gerados em tempo de execução, nunca literais. Sem
  allowlist nova.
- **Onde:** `apps/engine/lib/engine/actions/gitleaks_detector.ex:121`
  (`mensagem`), `apps/engine/lib/engine/harness/ambiente_do_agente.ex:102`
  (`montar`)
- **Teste:** `apps/engine/test/engine/actions/gitleaks_relatorio_test.exs`,
  `apps/engine/test/engine/harness/ambiente_do_agente_test.exs`
- **Origem:** AT-470

### RN-797 — A task cuja branch não tem diff contra a `dev` fecha como "já na dev" {#rn-797}

- **Regra:** no `report_done`, antes de propor commit, push e PR, o dev agent
  pergunta se a branch do worktree traz algo que a `dev` não tem: árvore limpa
  e `git diff --quiet <ponta da dev>...HEAD` sem diferença. É o caso da task
  reintegrada ([RN-779](#rn-779)) cujo código já entrou por outra PR. Sem
  diff, a task fecha como `done` com o evento `dev.task_already_in_dev`
  (agente, task, branch, motivo) — sem commit, sem PR, sem gates e sem
  clique. Qualquer dúvida (pasta que o engine não alcança, como no modo
  `runner`; git que falha; ref da `dev` ausente) é "tem diff": a task segue
  para os gates, nunca fecha sozinha. Mede DIFF e não ancestralidade, então
  cobre também o merge por squash que a [RN-760](#rn-760) declara não ver.
  Declarado: a PR antiga da branch, se existir, não é fechada no provider.
- **Onde:** `apps/engine/lib/engine/dev/worktree_manager.ex:246`
  (`sem_diff_contra_a_dev?`), `apps/engine/lib/engine/dev/dev_agent_server.ex:1056`
  (`ja_na_dev`)
- **Teste:** `apps/engine/test/engine/dev/tarefa_ja_na_dev_test.exs`
- **Origem:** AT-474

### RN-798 — O QA confere os comandos do README tocado pela entrega contra os scripts {#rn-798}

- **Regra:** quando o diff da entrega contra a `dev` toca um README, o QA
  confere, sem LLM, que todo `npm run <s>`, `npm test`, `npm start`,
  `pnpm [run] <s>` e `yarn [run] <s>` citado nele existe em `scripts` do
  `package.json` da mesma pasta (senão o da raiz do worktree). A conferência
  entra na consolidação como mais um parecer ("Conferência do README"):
  divergência é `changes_requested` com um item por comando, nomeando o
  script que falta; sem divergência, aprova. Sem README no diff, diff que
  falhou ou `package.json` inalcançável, nada é afirmado. De FORA, declarado:
  subcomando embutido do gerenciador (`pnpm install`, `pnpm dlx`…), comando
  com flag antes do script (`pnpm --filter x test`), flags de CLI do próprio
  projeto e comando que não é de Node.
- **Onde:** `apps/engine/lib/engine/gates/conferencia_do_readme.ex:28`
  (`conferir`), `apps/engine/lib/engine/gates/qa_lead_server.ex:818`
  (`conferencia_do_readme`)
- **Teste:** `apps/engine/test/engine/gates/conferencia_do_readme_test.exs`
- **Origem:** AT-475

### RN-805 — O plano de teste gravado é o que a ferramenta aceitou {#rn-805}

- **Regra:** `emit_plano_de_teste` valida os argumentos JÁ normalizados
  ([RN-719](#rn-719): `criteriosExecutaveis` em string JSON vira lista), e o
  hook que encerra o laço da QA-estratégia lê `criteriosExecutaveis` pela MESMA
  normalização (`Termination.lista/1`, a da [RN-787](#rn-787)). Antes, a tool
  dizia "plano registrado: 9 critérios", o hook levava a string crua, o
  artefato era recusado (`:criterios_vazios`), o agente devolvia `{:ok, plano}`
  mesmo assim e a Automação caía no `Enum` da string — o QA Lead morria e o
  gate ficava parado até o resgate (18 min no uso real). Artefato recusado
  agora é falha NOMEADA da QA-estratégia (`agent.error`, origem `codigo`) e a
  revisão segue sem plano, como já seguia quando o plano falha; a Automação
  também normaliza os critérios que recebe.
- **Onde:** `apps/engine/lib/engine/gates/hooks/termination_plano_de_teste.ex:23`
  (`criterios_executaveis`), `apps/engine/lib/engine/gates/qa_estrategia_agent.ex:231`
  (`emit_returning`)
- **Teste:** `apps/engine/test/engine/gates/qa_estrategia_agent_test.exs`
  ("critérios em string JSON viram lista: o plano é gravado e devolvido como lista")
- **Origem:** AT-478 (TP-01 de 10/10)

### RN-806 — Um ciclo de QA por tarefa: pedido anterior ao veredito é descartado {#rn-806}

- **Regra:** o QA Lead roda UM ciclo por task. Pedido `{:run, task}` para a
  task cujo ciclo está suspenso esperando decisão é ignorado, e ao fim de um
  ciclo (veredito ou bloqueio) todo `{:run, task}` que esperava na caixa do
  processo é descartado — foi pedido antes de o veredito existir, e a
  correção legítima do dev só nasce depois dele. No uso real o resgate
  ([RN-722](#rn-722)) disparou o ciclo duas vezes no mesmo instante, e o
  segundo, rodando depois do aprovado, gravou um parecer contrário sobre a
  tarefa já mergeada. De FORA, declarado: duas réplicas do engine (a caixa é
  por processo, a mesma ressalva do `GateRescuer`) e a causa da dupla
  varredura do resgate, que não foi corrigida aqui.
- **Onde:** `apps/engine/lib/engine/gates/qa_lead_server.ex:106` (`handle_cast`),
  `apps/engine/lib/engine/gates/qa_lead_server.ex:157` (`descartar_pedidos_obsoletos`)
- **Teste:** `apps/engine/test/engine/gates/qa_lead_server_test.exs` ("pedido
  repetido que esperava na caixa é descartado ao fim do ciclo"; "pedido para a
  task com ciclo suspenso não abre um segundo")
- **Origem:** AT-478 (TP-01 de 10/10)

### RN-810 — Falha de rede passageira do provider é retentada, e o bloqueio dela é `infra` sem contar no disjuntor {#rn-810}

- **Regra:** quando a chamada ao modelo volta com erro de REDE do provider —
  o `code` `connection`/`timeout` que a api normaliza (ADR 0041) ou, sem
  código, o texto do transporte (`EAI_AGAIN`, `ECONNRESET`, `ETIMEDOUT`,
  `ECONNREFUSED`, `ENOTFOUND`) —, o `ToolLoop` a retenta até duas vezes, com
  espera de 1 s e 3 s, gravando `toolloop.network_retry` a cada uma. Vale para
  todo consumidor do `ToolLoop` (dev agents e subagentes de gate). Esgotado o
  teto, a origem do desfecho é `infra`, nunca `codigo`, e o bloqueio da task
  do dev agent por essa causa NÃO incrementa o contador de bloqueios seguidos
  ([RN-047](#rn-047)): o agente segue reivindicando. No uso real um
  `getaddrinfo EAI_AGAIN openrouter.ai` de 17 s bloqueou duas tarefas como
  `codigo` e desarmou o dev. A correção pós-gate segue a mesma régua
  (AT-621, [RN-864](#rn-864)).
- **Onde:** `apps/engine/lib/engine/harness/tool_loop.ex:279`
  (`llm_turn_com_retentativa`), `apps/engine/lib/engine/agents/falha_de_turno.ex:119`
  (`falha_de_rede?`), `apps/engine/lib/engine/dev/dev_agent_server.ex:952`
  (`bloquear_parada`), `apps/engine/lib/engine/dev/agent_io.ex:228`
  (`finish_task`)
- **Teste:** `apps/engine/test/engine/harness/tool_loop_test.exs` ("falha de
  rede do provider: retenta e segue quando a rede volta"; "falha de rede que
  persiste esgota o teto"), `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  ("erro de rede do provider: origem infra e o disjuntor não conta"),
  `apps/engine/test/engine/agents/falha_de_turno_test.exs`
- **Origem:** AT-484 (TP-01 de 10/10)

### RN-811 — O "já na dev" compara com a `dev` do remoto atualizada {#rn-811}

- **Regra:** antes da checagem "já na dev" ([RN-797](#rn-797)) no
  `report_done`, o dev agent atualiza a `dev` do remoto pelo MESMO `fetch`
  que a [RN-779](#rn-779) faz no claim, serializado por projeto. Sem ele a
  comparação usava a `dev` do dia em que o worktree nasceu: a branch da task
  cujos commits já tinham entrado na `dev` remota pela PR de outra task passou
  por QA e SecOps com 0 arquivos. `fetch` que falha não decide nada — compara
  com o que há, e na dúvida a task segue para os gates.
- **Onde:** `apps/engine/lib/engine/dev/worktree_manager.ex:267`
  (`sem_diff_contra_a_dev?`), `apps/engine/lib/engine/dev/worktree_manager.ex:277`
  (`sem_diff_atualizado?`), `apps/engine/lib/engine/dev/dev_agent_server.ex:892`
  (`handle_outcome`)
- **Teste:** `apps/engine/test/engine/dev/tarefa_ja_na_dev_test.exs` ("caminho
  feliz: com a dev atualizada, a branch não tem diff"; "falha: remoto
  inalcançável não fecha a task sozinha")
- **Origem:** AT-486 (TP-01 de 10/10)

### RN-813 — Tarefa que toca o ponto de entrada exige evidência de que ele sobe {#rn-813}

- **Regra:** extensão do recorte da [RN-765](#rn-765). Quando o título ou a
  descrição da tarefa toca o ponto de entrada, a fiação (rotas, migração,
  registro) ou o README de execução, o recorte do gate de QA ganha a seção
  "Ponto de entrada": exigir evidência de que o entrypoint REAL sobe (o
  `start`/`main` do projeto rodado, ou um teste que importe o entrypoint real,
  não um app montado no próprio teste) e responde numa rota ou comando. Sem
  essa evidência, a lacuna vai para `itens`. É régua de PROMPT: o contrato
  externo dos gates (`apps/api/config/gates.yml`) e o código do `emit_qa_verdict` não
  mudam, e nenhum gate novo nasce. Tarefa que não toca nada disso não ganha a
  seção.
- **Onde:** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:121`
  (`secao_do_ponto_de_entrada`)
- **Teste:** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  ("tarefa que toca a fiação exige evidência do ponto de entrada real" e "tarefa
  que não toca entrypoint nem fiação não ganha a seção")
- **Origem:** AT-483 (TP-01 de 10/10: o `server.ts` nunca chamava a migração da
  tabela `links` e `/:code` sombreava `GET /links`; os 53 testes passavam porque
  cada um montava o próprio banco e app)

### RN-814 — O parecer do QA lista todas as lacunas numa volta {#rn-814}

- **Regra:** extensão do recorte da [RN-765](#rn-765): o gate de QA lista em
  `itens` TODAS as lacunas da tarefa que achar na volta, de uma vez, nunca uma
  por volta — cada volta é uma correção paga e um passo do teto do ciclo. O
  prompt anterior só mandava listar "quais regras faltam", e lacuna que não era
  regra descoberta ficava para a volta seguinte. Régua de prompt.
- **Onde:** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:20` (`texto`)
- **Teste:** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs` ("o
  recorte pede todas as lacunas numa volta só")
- **Origem:** AT-487 (TP-01 de 10/10, tarefa `c7ced5a2`: duas reprovações por
  duas lacunas que já existiam na entrega original)

### RN-817 — O QA roda a suíte em estado limpo, e teste pulado não é verde {#rn-817}

- **Regra:** extensão do recorte da [RN-765](#rn-765), para toda tarefa. Antes
  de rodar a suíte, o gate de QA encerra o que o PRÓPRIO projeto deixou de pé
  (servidor do `start` escutando numa porta do projeto), só processos daquela
  pasta, nunca de fora. Teste que sobe processo deve encerrar o GRUPO (ou
  subir `node` direto, não via `npm`); o que não encerra trava a suíte num
  clone limpo e é lacuna em `itens`. Teste que se PULOU por ambiente (porta
  ocupada, ferramenta ausente) não conta como verde: vai ao `resumo` como
  observação. É instrução do recorte, não passo do harness: quem roda a suíte
  é o próprio QA pelo `terminal`, que já passa pela política e pelo
  roteamento de container dos três modos — um `pkill` no harness precisaria
  de um segundo caminho de execução por modo. Régua de prompt; o contrato dos
  gates não muda.
- **Onde:** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:178`
  (`secao_do_ambiente_limpo`)
- **Teste:** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  ("RN-817: pede ambiente limpo, encerrar o grupo e pulado como observação")
- **Origem:** AT-496 (TP-01 de 10/10: `npm test` travava num clone limpo — o
  teste matava o `npm` e o `node` neto ficava na 3000 —, e no container o QA
  viu exit 0 porque o teste se pulava com a porta ocupada por um servidor
  órfão)

### RN-818 — A evidência do ponto de entrada é a que o ambiente do dev produz {#rn-818}

- **Regra:** extensão da [RN-813](#rn-813). A seção "Ponto de entrada" diz o
  que CONTA como evidência no ambiente do dev — subir o processo do
  entrypoint na pasta do projeto, rodar o script no container do projeto,
  bater numa rota do processo de pé — e o que NÃO cabe ali: construir imagem
  Docker, `docker compose`, rede externa. Exigência desse segundo tipo nunca
  vai para `itens`; vai ao `resumo` como observação. Régua de prompt.
- **Onde:** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:121`
  (`secao_do_ponto_de_entrada`)
- **Teste:** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  ("RN-818: com ponto de entrada diz o que conta e o que não cabe" e "RN-818:
  sem ponto de entrada não traz a régua de evidência")
- **Origem:** AT-492 (TP-01 de 10/10, task `c708f8b2`: a 4ª volta exigiu
  construir a imagem a partir do Dockerfile, o container do projeto não tem
  Docker, e o ciclo esgotou em bloqueio `politica`)

### RN-819 — O QA varre regra por regra antes de emitir {#rn-819}

- **Regra:** extensão da [RN-814](#rn-814). Além de listar todas as lacunas, o
  recorte pede uma VARREDURA POR REGRA antes de emitir: percorrer cada regra
  de negócio e cada critério da tarefa, um por um, apontando onde está a prova
  ou que ela falta, e só emitir depois de passar por todas. "Liste todas"
  sozinho não segurou lacuna pré-existente aparecendo na volta seguinte.
  Régua de prompt.
- **Onde:** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:20` (`texto`)
- **Teste:** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  ("RN-819: pede varredura por regra antes de emitir")
- **Origem:** AT-490 (TP-01 de 10/10: tarefas 2 e 11 trouxeram na 2ª volta
  lacuna que já estava na entrega)

### RN-823 — O ciclo de gate que o reinício do engine matou é retomado no boot, e o fio diz isso {#rn-823}

- **Regra:** no BOOT do engine, a linha `in_progress` de `gate_states`
  RECENTE (abaixo de `gate_rescue_stale_after_seconds`, 15 min, e por isso
  invisível para o tick) sem processo vivo NESTE nó nem nos OUTROS nós do
  cluster é órfã do reinício, não um ciclo lento: o boot a retoma na hora
  (`Dispatcher.run_qa`/`run_secops`), sem esperar o limiar. "Vivo" é a régua da
  [RN-722](#rn-722) (a task em voo no lead), perguntada também aos outros nós
  por `:erpc.multicall` — nó que não responde conta como VIVO, a régua do
  `TurnoOrfao` ([RN-586](#rn-586)). Valem as guardas de sempre: ação pendente
  de ator do gate não reinicia, e dev dono ausente só apaga a linha. Antes de
  redespachar, o boot grava `gate.interrupted` no log da sessão (`taskId`,
  `gate`, `ultimaAtividadeEm`, `retomadoEm`), e o fio o mostra como aviso, nos
  dois idiomas. O tick periódico NÃO muda: fora do boot, linha recente é ciclo
  em voo. Resíduo declarado: nó que ainda não entrou no cluster no instante do
  boot não é perguntado, e o pior desfecho é o de sempre (trabalho duplicado e
  barato; o segundo veredito é recusado pela api).
- **Onde:** `apps/engine/lib/engine/gates/gate_rescuer.ex:231` (`run_boot`),
  `:240` (`interrompido_no_boot`),
  `apps/web/src/routes/RetomarGateEstacionado.tsx:33` (`cicloInterrompido`)
- **Teste:** `apps/engine/test/engine/gates/gate_rescuer_test.exs` ("boot com
  ciclo RECENTE órfão do reinício: grava gate.interrupted e retoma já
  (RN-823)"; falhas: "boot com ciclo recente esperando ação PENDENTE do gate:
  não reinicia nem grava (RN-823)" e o processo local vivo intocado),
  `apps/web/src/routes/RetomarGateEstacionado.test.tsx` ("cicloInterrompido
  (RN-823)")
- **Origem:** AT-495 (TP-01 de 10/10: o reinício das 18:51 matou o ciclo de QA
  da tarefa 10, e o dev ficou `awaiting_gate` 15 min sem tela nenhuma dizer)

**Revisada pela [RN-923](#rn-923) ([ADR 0226](../adr/0226-diario-vivo-e-retomada-dos-agentes.md)).** A retomada do boot conta como a automática do ciclo (`auto_resumes`): se o ciclo já usou a sua, o boot o estaciona em vez de redespachá-lo, e o subagente retomado leva o plano do último `agent.turn_resumed`.

### RN-832 — O dev agent sabe que `report_done` faz commit, push e PR, e que teste novo entra no script `test` {#rn-832}

- **Regra:** o dev agent não tem nem precisa de `git_commit`, `git_push` ou
  `pr_open`: commit, push e PR acontecem quando ele chama `report_done`. A
  descrição de `report_done`, a de `report_blocked` ("falta ferramenta de git"
  não é motivo de bloqueio), o kickoff do dev agent e a mensagem de ambiente
  ([RN-706](#rn-706)) dizem isso — a de ambiente mandava, até aqui, usar as
  ações tipadas de git, que o dev não tem. O kickoff e o ambiente dizem também
  que, se o script `test` do `package.json` lista arquivos um a um, todo
  arquivo de teste novo entra nele. Só texto: nenhuma regra nova de código, e
  o Jev segue sem piso para dev agents ([RN-758](api.md#rn-758)) — até a [RN-839](api.md#rn-839), que pôs `report_done`/`report_blocked` no piso deles.
- **Onde:** `apps/engine/lib/engine/dev/tools/report_done.ex:16` (`spec`),
  `apps/engine/lib/engine/dev/tools/report_blocked.ex:12` (`spec`),
  `apps/engine/lib/engine/dev/dev_agent_server.ex:604` (`initial_message`),
  `apps/engine/lib/engine/harness/ambiente_do_agente.ex:102` (`montar`)
- **Teste:** `apps/engine/test/engine/dev/report_done_instrucao_test.exs`
  ("caminho feliz: report_done, kickoff e ambiente carregam as duas
  instruções"; falha: "o ambiente não manda mais usar as ações tipadas de git")
- **Origem:** AT-499 (TP-01, 11ª: tarefa bloqueada com a suíte verde por
  "git_commit não existe"; quatro voltas de QA por teste fora do script `test`)

### RN-845 — A leitura das ADRs propostas diz se a PR já foi mergeada {#rn-845}

- **Regra:** na linha de uma ADR `executed`, `listar_adrs_propostas`
  ([RN-772](#rn-772)) não afirma mais "PR aberta" pelo status da AÇÃO: cruza o
  `pullRequestId` do resultado com o `git_merge` EXECUTADO do mesmo projeto
  (a ação pela qual todo merge passa, [RN-418](api.md#rn-418)) e diz "PR MERGEADA em
  <data da decisão>" ou "PR aberta (nenhum merge dela registrado no Brabo)".
  Resultado sem id de PR, ou consulta de merge que falha, vira "estado da PR:
  NÃO CONSEGUI LER" — nunca "aberta". Contida (ADR 0060): uma consulta a mais,
  só sobre os ids listados, no mesmo Postgres. Limite declarado: PR fechada
  sem merge FORA do Brabo (no provider remoto) não é vista, e segue lida como
  aberta — perguntar ao provider seria HTTP no laço do agente.
- **Onde:** `apps/engine/lib/engine/harness/tools/listar_adrs_propostas.ex:88`
  (`cruzar_com_merges`), `:102` (`merges_por_pr`), `:155` (`estado_da_pr`).
- **Teste:** `apps/engine/test/engine/harness/tools/listar_adrs_propostas_test.exs`
  ("PR mergeada aparece como mergeada…", "estado da PR ilegível diz que não
  leu, nunca aberta").
- **Origem:** AT-514 (TP-01, 11/10: o Arquiteto disse "aberta como PR" 30 s
  depois do merge).

### RN-846 — A rota HTTP vai ao README e o erro de entrada é do projeto {#rn-846}

- **Regra:** extensão da [RN-819](#rn-819). O kickoff do dev agent de
  execução pede que rota HTTP criada ou mudada entre no README (método,
  caminho, corpo, respostas e códigos) e que erro de entrada (JSON malformado,
  campo inválido) responda com mensagem própria no formato do projeto, nunca a
  mensagem crua da biblioteca. O recorte do QA confere as duas coisas na
  varredura por regra, e o que faltar vai a `itens`. Régua de prompt.
- **Onde:** `apps/engine/lib/engine/dev/dev_agent_server.ex:604`
  (`initial_message`) e `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:20`
  (`texto`)
- **Teste:** `apps/engine/test/engine/dev/report_done_instrucao_test.exs`
  ("RN-846: kickoff pede a rota no README e erro de entrada próprio") e
  `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs` ("RN-846: confere
  rota no README e erro de entrada próprio")
- **Origem:** AT-515 (TP-01, 12ª: o README não documentava a API, e JSON
  malformado respondia 400 com "Expected property name…" do parser)

### RN-849 — O turno de prontidão da arquitetura abre com o estado atual das ADRs {#rn-849}

- **Regra:** extensão da [RN-845](#rn-845). Quando o usuário confirma que a
  arquitetura está pronta, o servidor do Arquiteto LÊ o estado das ADRs pelo
  mesmo código de `listar_adrs_propostas` (Postgres local, sem HTTP, mesmo teto
  de 20 linhas) e o põe na mensagem de abertura desse turno, com a instrução de
  não afirmar estado de ADR diferente. Leitura que falha diz "NÃO CONSEGUI LER"
  e manda dizer que não sabe — nunca "pendente".
- **Onde:** `apps/engine/lib/engine/harness/tools/listar_adrs_propostas.ex:50`
  (`contexto_de_prontidao`), `apps/engine/lib/engine/agents/arquiteto_server.ex:223`
  (`contexto_de_prontidao`).
- **Teste:** `apps/engine/test/engine/harness/tools/listar_adrs_propostas_test.exs`
  ("contexto_de_prontidao/2 (RN-849)").
- **Origem:** AT-519 (TP-01: no turno de prontidão o Arquiteto disse "pendente
  de aprovação" sobre ADR já mergeada, repetindo a leitura do turno anterior).

### RN-850 — A rota entra na seção "Rotas HTTP" e o README não leva nota de processo {#rn-850}

- **Regra:** extensão da [RN-846](#rn-846). O kickoff do dev agent pede que a
  rota entre DENTRO da seção "Rotas HTTP" do README (criada antes de "Testes"
  se faltar), nunca no fim do arquivo, e que o README, que é do usuário, não
  ganhe nota de processo nem instrução para agentes. O recorte do QA confere
  as duas coisas. Régua de prompt.
- **Onde:** `apps/engine/lib/engine/dev/dev_agent_server.ex:604`
  (`initial_message`) e `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:20`
  (`texto`)
- **Teste:** `apps/engine/test/engine/dev/report_done_instrucao_test.exs`
  ("RN-850: a rota vai dentro de Rotas HTTP e o README não leva nota de
  processo") e `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  ("RN-850: confere a seção Rotas HTTP e a ausência de nota de processo")
- **Origem:** AT-520 (TP-01: cada tarefa acrescentou rotas no fim do README,
  depois de "Testes", e sobrou um parágrafo de processo para agentes)

### RN-851 — O compose da Infra sobe o APP na máquina do usuário, e a PR declara como rodá-lo {#rn-851}

- **Regra:** o kickoff do Infra Lead pede o compose que SOBE O APP (não só
  ambiente de dev): `build` do Dockerfile de cada módulo com `FROM` = a imagem
  decidida (`projectImage` do contexto da Infra; sem ela, a candidata do
  roteamento, dito no README), porta `${APP_PORT:-8080}:<porta interna>`, volume
  para dados persistentes, `.env.example` commitado (nunca `.env`) e a seção
  "Rodar na sua máquina" no README. O container de TRABALHO dos agentes segue
  subindo pelo broker, e não há deploy. `propose_infra_pr` ganha o campo
  OBRIGATÓRIO `run` (`command` até 300 caracteres; `urls` de 1 a 5, `label` até
  60, `kind` em `api_docs | web`, `url` começando com `http://localhost:` ou
  `http://127.0.0.1:`; `envExample` booleano), validado no engine ANTES do HALT
  com recusa nomeada que entra no laço (RN-163) e repassado no
  payload de `open_infra_pr`. Decisão no [ADR 0213](../adr/0213-o-entregavel-roda-na-maquina-pelo-compose-da-infra.md).
- **Onde:** `apps/engine/lib/engine/infra/instrucoes_de_execucao.ex:27`
  (`validar`), `apps/engine/lib/engine/infra/infra_lead_server.ex:1414`
  (`build_kickoff`) e `:1327` (`abrir_pr`), e
  `apps/engine/lib/engine/infra/tools/propose_infra_pr.ex:24` (`spec`)
- **Teste:** `apps/engine/test/engine/infra/infra_lead_server_test.exs`
  (describe "o compose sobe o app e a PR leva `run` (RN-851)")
- **Origem:** AT-517 (o entregável não tinha como ser rodado pelo usuário)

### RN-853 — O dev expõe OpenAPI e Swagger quando a tarefa toca rotas {#rn-853}

- **Regra:** parte do ADR 0213. Quando a
  tarefa toca ponto de entrada ou rotas (a MESMA régua do recorte do QA,
  `toca_ponto_de_entrada?`, nunca uma cópia), o kickoff do dev ganha a
  cláusula: módulo que expõe HTTP serve `/openapi.json` (OpenAPI 3) e `/docs`
  (UI Swagger); sem rede ou sem pacote, `/docs` é página HTML que carrega o
  swagger-ui de CDN; módulo web serve a página inicial; a URL entra na seção
  "Rodar na sua máquina" do README. Tarefa que não toca rotas não paga a
  cláusula (a mensagem é fixada e volta a cada iteração).
- **Onde:** `apps/engine/lib/engine/dev/dev_agent_server.ex:636`
  (`clausula_de_openapi`),
  `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:113`
  (`toca_ponto_de_entrada?`)
- **Teste:** `apps/engine/test/engine/dev/report_done_instrucao_test.exs`
  ("RN-853: tarefa que toca rotas pede /openapi.json e /docs"; falha: "RN-853
  falha: tarefa sem rota nem entrypoint não paga a cláusula")
- **Origem:** AT-517

### RN-854 — O QA prova `/openapi.json` e `/docs` dentro do container {#rn-854}

- **Regra:** parte do ADR 0213. Na seção
  de ponto de entrada do recorte ([RN-813](#rn-813)), o QA sobe o app pelo
  comando do README em background DENTRO do container, bate em
  `localhost:<porta interna>/openapi.json` e `/docs` (`curl`, `wget` ou
  `node -e fetch`) e encerra o grupo de processos ([RN-817](#rn-817)). Falha
  vai a `itens`; o `docker compose up` real fica no `resumo` como "provado só
  na máquina do usuário".
- **Onde:** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:121`
  (`secao_do_ponto_de_entrada`)
- **Teste:** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  ("tarefa que toca rotas pede /openapi.json e /docs, compose em resumo";
  falha: "falha: tarefa sem rota não recebe a seção")
- **Origem:** AT-517

### RN-862 — A pergunta em aberto do lado do engine: ferramenta, veredito e decisão no contexto {#rn-862}

- **Regra:** o Criativo, o PO, o Arquiteto e o Dev Lead declaram toda dúvida
  deixada para o usuário com `declare_open_question` (`pergunta` até 500,
  `sugestao` até 300 opcional, `afeta: {regras, historias, tarefas}`), que
  grava `artifact.open_question` com `questionId` (uuid), `autor` e
  `sessionId`; payload inválido é recusa nomeada e não grava. A instrução é UMA
  frase central, no texto do fluxo dos quatro (RN-711), nunca por servidor. No
  gate de QA, requisito "não confirmado pelo usuário" (ou contradito por decisão
  vigente) é `needs_user_decision`, nunca `changes_requested`:
  `emit_qa_verdict` o aceita só com `pergunta` ou `openQuestionId`, o QA Lead o
  consolida acima de `approved`, o veredito vai à api com a pergunta e o ciclo
  fica ESTACIONADO (ADR 0207, `gate.rescue_parked`, sem resgate automático)
  até a api pedir a retomada pela rota da RN-724. As `decisoes` do dev-context
  entram no kickoff do dev e no recorte do QA como "Decisões do usuário —
  vencem RF/DoR quando conflitam" (`pergunta → decisao`); vazio não escreve
  nada. A pergunta gravada conta no fecho do turno (RN-731), e o PO passa
  `question_id` em `update_story`/`complete_story` quando corrige a história a
  partir de uma resposta ([ADR 0214](../adr/0214-pergunta-em-aberto-vira-pendencia.md)).
- **Onde:** `apps/engine/lib/engine/harness/tools/declare_open_question.ex:54` (`run`),
  `apps/engine/lib/engine/harness/fluxo_do_time.ex:113` (`frase_da_pergunta`),
  `apps/engine/lib/engine/gates/tools/emit_qa_verdict.ex:81` (`run`),
  `apps/engine/lib/engine/gates/qa_lead.ex:89` (`consolidar_decisao`),
  `apps/engine/lib/engine/gates/qa_lead_server.ex:595` (`estacionar_por_decisao`),
  `apps/engine/lib/engine/dev/context_builder.ex:121` (`secao_de_decisoes`)
- **Teste:** `apps/engine/test/engine/harness/perguntas_em_aberto_test.exs`
  ("válida grava artifact.open_question…"; "inválida é recusa nomeada…";
  "consolidação: needs_user_decision vence approved"; "o recorte diz a régua…";
  "ContextBuilder: a história leva as decisões…"),
  `apps/engine/test/engine/gates/qa_lead_server_test.exs` ("grava a pergunta
  na api, estaciona o ciclo e só o gesto humano o retoma")
- **Origem:** AT-521, [ADR 0214](../adr/0214-pergunta-em-aberto-vira-pendencia.md)

### RN-863 — `api_docs` é sempre `/docs`, toda rota entra no OpenAPI, e o QA reprova a que falta {#rn-863}

- **Regra:** módulo HTTP declara em `run.urls` SEMPRE `/docs` (a UI Swagger,
  `kind: "api_docs"`) mesmo antes de existir, e módulo web a página inicial —
  nunca uma rota de negócio; o kickoff da Infra diz isso no passo do README
  (estende a RN-851). A validação do `run` recusa, nomeada e com a MESMA régua
  nos dois lados, `api_docs` cuja URL não termina em `/docs` (estende a
  RN-852). A cláusula do dev diz que TODA rota HTTP criada ou mudada na tarefa
  entra no `/openapi.json` — path com método, corpo e respostas (estende a
  RN-853). No recorte do QA, cada rota da seção "Rotas HTTP" do README precisa
  estar em `paths` do `/openapi.json` servido; rota faltando é item que
  reprova, nunca observação (estende a RN-854).
- **Onde:** `apps/engine/lib/engine/infra/instrucoes_de_execucao.ex:60` (`url`),
  `apps/api/src/domain/infra/run-instructions.ts:77` (`recusaDoRun`),
  `apps/engine/lib/engine/infra/infra_lead_server.ex:1414` (`build_kickoff`),
  `apps/engine/lib/engine/dev/dev_agent_server.ex:636` (`clausula_de_openapi`),
  `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:20` (`texto`)
- **Teste:** `apps/engine/test/engine/infra/infra_lead_server_test.exs`
  ("run api_docs em rota de negócio é recusado com motivo, sem propor"),
  `apps/api/test/application/use-cases/execution/get-run-instructions.use-case.spec.ts`
  ("recusaDoRun (RN-852)"),
  `apps/engine/test/engine/dev/report_done_instrucao_test.exs` ("RN-853: …"),
  `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs` ("RN-854: …")
- **Origem:** AT-524, [ADR 0213](../adr/0213-o-entregavel-roda-na-maquina-pelo-compose-da-infra.md)

### RN-864 — Falha passageira de rede volta sozinha em até 3 tentativas, e o dev pausa {#rn-864}

- **Regra:** a task bloqueada pelo dev agent com origem `infra` por falha
  PASSAGEIRA de rede/provedor — lista de permitidos explícita: DNS
  (`EAI_AGAIN`, `ENOTFOUND`, `getaddrinfo`), `ECONNRESET`, `ETIMEDOUT`,
  `aborted`, HTTP 5xx/429 do provedor (códigos `rate_limit`/`upstream`,
  `connection`/`timeout`) — é RETOMADA sozinha até 3 vezes, depois de 1, 3 e
  10 min (decisão do dono), por um job Oban que chama o MESMO desbloqueio do
  humano (`UnblockTaskUseCase`, pela rota interna `.../tasks/:taskId/unblock`,
  ator `system`, no-op se a task já não está bloqueada). O motivo do bloqueio
  diz qual retomada foi agendada; depois da 3ª retomada a falha seguinte fica
  bloqueada como antes, e o motivo diz que as 3 já foram tentadas. E o agente
  PAUSA 1 min em vez de pegar a próxima task (o wake é ignorado durante a
  pausa). Crédito esgotado (402, RN-726/730) e erro de código NÃO entram:
  bloqueiam na hora. O contador de retomadas é só em memória: reiniciar o
  engine o zera. Vale também para a correção pós-gate (AT-621): o 503 do
  provider numa correção segue o mesmo caminho do laço principal (crédito
  RN-726 + retomada), com o motivo marcado "(correção)".
- **Onde:** `apps/engine/lib/engine/dev/dev_agent_server.ex:822`
  (`handle_correction_outcome`), `apps/engine/lib/engine/agents/falha_de_turno.ex:140`
  (`passageira?`), `apps/engine/lib/engine/dev/dev_agent_server.ex:978`
  (`bloquear_passageira`), `apps/engine/lib/engine/dev/agent_io.ex:293`
  (`pausar_por_rede`), `apps/engine/lib/engine/workers/retomada_de_tarefa_worker.ex:33`
  (`agendar`), `apps/api/src/application/use-cases/execution/unblock-task.use-case.ts:33`
  (`ator`)
- **Teste:** `apps/engine/test/engine/dev/dev_agent_server_test.exs` ("falha
  passageira: agenda a retomada, pausa e não queima a fila", "fim da pausa
  volta a reivindicar"; falha: "falha passageira depois de 3 retomadas fica
  bloqueada pedindo o clique", "402 não agenda retomada"; correção: "correção
  com 503: infra, retomada agendada, pausa e disjuntor intacto", "correção sem
  crédito: pausa por crédito, sem retomada", "correção com erro não
  passageiro: bloqueia na hora, sem retomada"),
  `apps/engine/test/engine/workers/retomada_de_tarefa_worker_test.exs`
- **Origem:** AT-525

### RN-865 — Endpoint e verbo HTTP com caminho também ligam a conferência do OpenAPI, e ela cobre as rotas do código {#rn-865}

- **Regra:** a régua única de "a tarefa toca ponto de entrada/rotas"
  (`toca_ponto_de_entrada?`, usada pelo recorte do QA e pela cláusula do dev da
  RN-853) casa também "endpoint" e verbo HTTP seguido de caminho
  (`POST /links`). Sem isso, tarefa descrita como "Endpoint protegido…" não
  recebia nem a cláusula do OpenAPI (dev) nem a conferência do `/openapi.json`
  (QA) — foi assim que `POST /links` e `GET /panel` ficaram fora do OpenAPI
  com as duas tarefas aprovadas no TP-01. A conferência do QA passa a exigir em
  `paths` do `/openapi.json` servido, além das rotas da seção "Rotas HTTP" do
  README, cada rota que o CÓDIGO registra; a que falta é item que reprova
  (estende a RN-863).
- **Onde:** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:103`
  (`@ponto_de_entrada`), `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:114`
  (`toca_ponto_de_entrada?`)
- **Teste:** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  ("RN-865: tarefa que diz só endpoint ou verbo com caminho recebe a seção";
  falha: "falha: tarefa sem rota não recebe a seção")
- **Origem:** AT-527

### RN-868 — O tick do resgate de gates é uma corrente só {#rn-868}

- **Regra:** o `GateRescueSchedulerWorker` reagenda o próprio sucessor com a
  MESMA unicidade do `kickoff/0` (estados `available`/`scheduled`/`retryable`,
  sem `executing`, janela de dois intervalos). Antes só o `kickoff/0` era
  único: o job em execução não conta, então o kickoff do boot com o tick
  anterior em voo, ou um retry que re-roda o `perform/1`, abria uma SEGUNDA
  corrente, e elas nunca se fundiam. Medido no uso real (14/10): 11 jobs
  agendados ao mesmo tempo e a linha "espera decisão humana" da RN-722 11
  vezes por tick para UMA linha de `gate_states`. Não era defeito de dado. Com
  a unicidade no reagendamento as correntes duplicadas colapsam numa só no
  tick seguinte.
- **Onde:** `apps/engine/lib/engine/workers/gate_rescue_scheduler_worker.ex:42`
  (`unicidade`)
- **Teste:** `apps/engine/test/engine/workers/gate_rescue_scheduler_worker_test.exs`
  ("o tick se reagenda e mantém a corrente viva"; falha: "com um sucessor já
  agendado, o tick não abre uma segunda corrente")
- **Origem:** AT-529

### RN-874 — O PO recebe no turno as decisões do usuário e as perguntas abertas do projeto {#rn-874}

- **Regra:** todo turno do PO leva, como mensagem `system` EFÊMERA
  acrescentada pela fachada `EngineApiClient` logo depois do fluxo do time
  (RN-711) — nunca em `state.messages` nem no prompt do servidor —, as
  decisões do usuário (`artifact.decision_record`, `choice` e `context`) e as
  perguntas AINDA abertas do projeto (`artifact.open_question` sem
  `open_question.answered` com o mesmo `questionId`), de TODAS as sessões. O
  texto manda escrever a RESPOSTA decidida na história, regra, DoR, DoD e
  tarefa, nunca "pergunta em aberto N"; pergunta ainda aberta é citada pelo
  `questionId`, sem inventar resposta. A leitura é LOCAL (Postgres direto, sem
  HTTP no laço), dos 200 eventos mais recentes desses tipos, com teto de 10
  decisões, 10 perguntas, 240 caracteres por item e 3 000 no texto. Sem
  decisão nem pergunta aberta, ou com a leitura falhando, o turno segue sem a
  mensagem, nunca cai. Só o `po` recebe.
- **Onde:** `apps/engine/lib/engine/harness/decisoes_do_projeto.ex:34`
  (`anexar`), `:49` (`texto`),
  `apps/engine/lib/engine/session_events/event.ex:224`
  (`list_types_for_project`),
  `apps/engine/lib/engine/sessions/engine_api_client.ex:729`
  (`DecisoesDoProjeto`)
- **Teste:** `apps/engine/test/engine/harness/decisoes_do_projeto_test.exs`
  ("o turno do PO leva a decisão e só a pergunta AINDA aberta", "custo de
  entrada tem teto"; falha: "sem decisões nem perguntas não acrescenta nada",
  "leitura que falha deixa o turno sem a mensagem, sem queda")

### RN-876 — O `needs_user_decision` recusado pela api volta ao QA, e só o aceite estaciona o gate {#rn-876}

- **Regra:** o gate de QA só ESTACIONA (`gate.rescue_parked`) quando a api
  aceita o veredito `needs_user_decision` com `nextAction: "await_user"`. Se a
  api RECUSA (400, 404, ou o 409 `pergunta_ja_respondida`), a recusa volta ao
  laço da QA de Automação como mensagem nova (RN-163: erro é entrada do laço),
  retomando o MESMO contexto em que ela emitiu — no 409, com a decisão já
  tomada para o QA aplicar em vez de perguntar de novo. As outras delegações
  não rodam de novo. A volta conta no teto de iterações do próprio laço;
  esgotado, a tarefa é bloqueada com o motivo e a origem `modelo` (RN-059),
  nunca estacionada em silêncio. Antes, o retorno da api era descartado e o
  gate estacionava sem pergunta no fio (medido: `openQuestionId: "1"`, 400 do
  `@IsUUID`). A ferramenta `emit_qa_verdict` recusa, DENTRO do laço e antes da
  api, `openQuestionId` que não é uuid.
- **Onde:** `apps/engine/lib/engine/gates/qa_lead_server.ex:601`
  (`devolver_ao_qa`), `apps/engine/lib/engine/gates/qa_lead_server.ex:312`
  (`devolver_ao_qa`), `apps/engine/lib/engine/gates/qa_lead_server.ex:697`
  (`texto_da_recusa`), `apps/engine/lib/engine/gates/qa_automacao_agent.ex:186`
  (`devolver`), `apps/engine/lib/engine/gates/tools/emit_qa_verdict.ex:75`
  (`uuid`)
- **Teste:** `apps/engine/test/engine/gates/qa_lead_server_test.exs` ("400:
  nada estaciona, o QA recebe o motivo e uma nova volta acontece"; "409 no
  laço: a volta seguinte do QA lê a decisão"; falha: "teto esgotado depois da
  recusa: bloqueio narrado, nunca estacionamento"),
  `apps/engine/test/engine/harness/perguntas_em_aberto_test.exs` ("AT-526
  (RN-876): openQuestionId que não é uuid é recusa nomeada; uuid passa")
- **Origem:** AT-526

### RN-877 — O recorte do QA manda conferir as decisões antes de pedir decisão {#rn-877}

- **Regra:** a instrução do recorte do QA diz que, antes de
  `needs_user_decision`, ele confere as decisões listadas; requisito que uma
  delas já responde não é pergunta e a decisão se aplica. `openQuestionId` só
  com o uuid de uma pergunta ABERTA; sem ele, a pergunta nova vai em
  `pergunta`/`sugestao`. É lembrete de leitura: não muda a régua do veredito.
- **Onde:** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:20` (`texto`)
- **Teste:** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  ("AT-526 (RN-877): manda conferir as decisões antes de needs_user_decision";
  a falha da instrução é coberta pelo teste da RN-876 da ferramenta)
- **Origem:** AT-526

### RN-878 — O idioma do agente de execução vale desde a primeira frase {#rn-878}

- **Regra:** nos turnos SEM autor humano dos agentes de execução (`dev-*`,
  `qa-*`), a orientação de idioma da RN-622 diz que vale desde a PRIMEIRA
  frase, inclusive a narração antes de cada ferramenta, e perde a ressalva
  "salvo pedido do usuário" (não há usuário no turno). Medido na sessão
  `6c68fbc0` (projeto pt-BR, `anthropic/claude-haiku-5.5`): a orientação
  chegava, e mesmo assim a iteração 0 do `qa-automacao` e do
  `dev-encurtador-api` abria em inglês ("I'll start by running…"). O caminho
  continua UM (a fachada, RN-622): nada em prompt de servidor,
  `agent_instructions` ou descrição de ferramenta (RN-667). O teto de 50 tokens
  (AT-169) segue: medido com `gpt-tokenizer`, `pt-BR` 32/26, `en` 19/19 e o
  genérico com código na forma curta no pior caso 30/30 (cl100k/o200k); código
  fora da forma curta cai na orientação de sempre, que já cabia. Turno com
  autor e os conversacionais não mudam. Sem idioma resolvido, nada é
  acrescentado. A eficácia se mede no próximo TP-01.
- **Onde:** `apps/engine/lib/engine/harness/idioma_da_resposta.ex:164`
  (`orientacao_de_execucao`), `:154` (`agente_de_execucao?`)
- **Teste:** `apps/engine/test/engine/harness/idioma_da_resposta_test.exs`
  ("agente de execução: vale desde a primeira frase, dentro do teto"; falha:
  "agente de execução sem idioma resolvido: nada é acrescentado")
- **Origem:** AT-530

### RN-879 — URL absoluta do entregável com a porta, e o mesmo `code` para o mesmo erro {#rn-879}

- **Regra:** quando a tarefa toca ponto de entrada ou rotas, a cláusula do dev
  manda que URL absoluta devolvida pela API do entregável (ex.: o link curto)
  venha de `PUBLIC_BASE_URL` ou do `Host` da requisição COM a porta — nunca
  `http://localhost` fixo nem o hostname sem porta —, e que o mesmo caso de
  erro responda o mesmo `code` em todas as rotas. O recorte do QA confere as
  duas coisas e trata a divergência (ex.: `not_found` × `link_not_found`)
  como ITEM. Decisão do dono de 14/10: regra geral.
- **Onde:** `apps/engine/lib/engine/dev/dev_agent_server.ex:644` (`clausula_de_openapi`);
  `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:122` (`secao_do_ponto_de_entrada`)
- **Teste:** `apps/engine/test/engine/dev/report_done_instrucao_test.exs`
  ("RN-879/880: tarefa que toca rotas leva URL com porta, code único e CORS" e
  a falha "RN-879/880 falha: tarefa sem rota não recebe CORS nem PUBLIC_BASE_URL");
  `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs` ("RN-879/880: URL,
  code de erro e CORS")
- **Origem:** AT-531

### RN-880 — O entregável responde CORS configurável, com `servers` relativo e swagger-ui pinado {#rn-880}

- **Regra:** na mesma cláusula, a API do entregável responde CORS com origens
  de `CORS_ORIGINS` (padrão `http://localhost:<porta>` e
  `http://127.0.0.1:<porta>`), `OPTIONS` 204 e `Access-Control-Allow-*` com
  `Authorization` e `Content-Type`; o `/openapi.json` declara `servers` só
  relativo (`/`) — URL absoluta criaria o erro de CORS quando a página é aberta
  por outro host —, e o swagger-ui de CDN vai com versão exata, nunca `@5`. O
  QA prova com um preflight de outra origem (`curl -X OPTIONS`) e reprova sem
  os cabeçalhos, com `servers` absoluto ou com o CDN flutuante.
- **Onde:** `apps/engine/lib/engine/dev/dev_agent_server.ex:644` (`clausula_de_openapi`);
  `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:122` (`secao_do_ponto_de_entrada`)
- **Teste:** os mesmos da RN-879 (caminho feliz e falha nos dois arquivos)
- **Origem:** AT-532

### RN-881 — O engine imprime as outras decisões do projeto para o dev e o QA {#rn-881}

- **Regra:** o `decisoesDoProjeto` que a api devolve no `dev-context`
  (RN-872, ADR 0215, já com teto) vira a seção "Outras decisões do projeto",
  separada e DEPOIS das decisões da tarefa, na unidade da story do dev e no
  recorte do QA. Vazio ou ausente não escreve nada; o engine não aplica teto
  próprio.
- **Onde:** `apps/engine/lib/engine/dev/context_builder.ex:133` (`secao_de_decisoes_do_projeto`);
  `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:20` (`texto`)
- **Teste:** `apps/engine/test/engine/dev/context_builder_test.exs` ("RN-881:
  decisoesDoProjeto vira a seção..." e "RN-881 falha: sem decisoesDoProjeto a
  seção some"); `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  ("RN-881: outras decisões do projeto")
- **Origem:** AT-526 (fatia F4, lado do engine)

### RN-885 — O CORS do entregável usa a porta PUBLICADA, e o QA confere o header nas duas origens {#rn-885}

- **Regra:** revisa a RN-880 (que continua valendo no resto). O padrão de
  `CORS_ORIGINS` do entregável usa a porta PUBLICADA — `APP_PORT`, que o
  compose passa ao app —, nunca a interna `PORT`: no TP-01 (16ª) o padrão saiu
  com `PORT=3000` e, com o compose publicando 8080, nenhuma origem real recebia
  `Access-Control-Allow-Origin` (medido com curl: `:3000` recebe, `:8080` não;
  no Chrome, `Failed to fetch`). O QA faz o preflight contra a porta PUBLICADA,
  uma vez para `http://localhost:<APP_PORT>` e outra para
  `http://127.0.0.1:<APP_PORT>`, e reprova sem o header
  `Access-Control-Allow-Origin` — 204 sozinho não basta, e CORS só na porta
  interna é ITEM.
- **Onde:** `apps/engine/lib/engine/dev/dev_agent_server.ex:644` (`clausula_de_openapi`);
  `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:122` (`secao_do_ponto_de_entrada`)
- **Teste:** `apps/engine/test/engine/dev/report_done_instrucao_test.exs`
  ("RN-885: o padrão do CORS usa a porta PUBLICADA, nunca a interna"; falha:
  "RN-879/880 falha: tarefa sem rota não recebe CORS nem PUBLIC_BASE_URL");
  `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs` ("RN-885: o
  preflight é na porta PUBLICADA, nas duas origens, e confere o header")
- **Origem:** AT-535

### RN-890 — O QA cobra o código de saída do comando de linha, na recusa também {#rn-890}

- **Regra:** a instrução do QA de Automação manda conferir, no teste que
  prova um comando de linha da entrega (CLI, script do `package.json`), o
  código de saída 0 no caminho feliz e diferente de 0 quando o comando recusa
  a entrada; teste sem essa conferência na recusa é regra sem cobertura e vai
  para `itens`. A instrução da QA-estratégia pede, em `criteriosExecutaveis`,
  esses dois critérios para todo comando que recusa entrada. É instrução de
  agente: nenhum gate novo, nenhuma mudança de veredito ou de estrutura.
- **Onde:** `apps/engine/lib/engine/gates/qa_automacao_agent.ex:250`
  (`instrucao_de_codigo_de_saida`),
  `apps/engine/lib/engine/gates/qa_estrategia_agent.ex:129`
  (`instrucao_de_codigo_de_saida`)
- **Teste:** `apps/engine/test/engine/gates/qa_automacao_agent_test.exs` ("a
  instrução cobra código de saída 0 no feliz e diferente de 0 na recusa");
  `apps/engine/test/engine/gates/qa_estrategia_agent_test.exs` ("os arquivos
  da entrega entram na mensagem")
- **Origem:** AT-542 (TP-01, 17ª: `npm run user:create` recusava a senha e
  saía com 0)

### RN-893 — O PO declara a borda do valor informado no RF e no DoD {#rn-893}

- **Regra:** a instrução de kickoff do PO (com ou sem event log) traz uma
  terceira obrigação: todo RF que recebe um valor informado pelo usuário
  (data, número, texto, lista, limite) declara, no RF e no DoD, se a borda —
  passado/futuro, zero, vazio, negativo, o próprio limite — é ACEITA ou
  RECUSADA (com o status HTTP/erro); o exemplo é a expiração no passado. Sem
  saber, o PO chama `declare_open_question` com `afeta.historias` e uma
  sugestão, nunca inventa nem omite. Régua de PROMPT, no molde da
  [RN-790](#rn-790): nenhuma ferramenta recusa história sem borda. O PO NÃO
  passa a reescrever `business_rule`; Criativo, QA, schema e gate não mudam.
- **Onde:** `apps/engine/lib/engine/agents/po_server.ex:686` (`obrigacoes`)
- **Teste:** `apps/engine/test/engine/agents/po_server_test.exs:438` (a
  instrução de kickoff traz a obrigação da borda) e `:460` (sem event log, o
  kickoff ainda a carrega)
- **Origem:** AT-541 (TP-01 de 14/10: o entregável aceitou `expiresAt` no
  passado e o link nasceu expirado, 410; o RF da história só dizia que a
  expiração é opcional), decisão do dono de 15/10

### RN-895 — A recusa de argumento diz o que chegou e o formato esperado {#rn-895}

- **Regra:** revisa a [RN-719](#rn-719) e a [RN-725](#rn-725). Campo declarado `array`/`object` que chega como texto fora de JSON, ou como número/booleano/tipo trocado, é recusado antes da ferramenta com "o campo X chegou como <tipo>; envie <formato>", com exemplo (`["item 1","item 2"]`, `{"chave":"valor"}`), nunca com o valor. A frase do `emit_plano_de_teste` passou a pôr as chaves entre crases, e por isso a recusa leva as chaves recebidas.
- **Onde:** `apps/engine/lib/engine/harness/argumentos_de_ferramenta.ex:84` (`coagir`); `apps/engine/lib/engine/gates/tools/emit_plano_de_teste.ex:73` (`run`)
- **Teste:** `apps/engine/test/engine/harness/argumentos_de_ferramenta_test.exs:193` e `:201` (o formato e o tipo recebido) e `:210` (as chaves recebidas)
- **Origem:** AT-583 (TP-01 18ª e 19ª: o `dod` chegou como checklist markdown e o plano de teste foi recusado 4 vezes sem dizer o que veio)

### RN-896 — O `epic_id` é validado antes da api {#rn-896}

- **Regra:** `create_story` recusa `epic_id` que não é UUID ("epic_id inválido; …"). Quando o PO já criou épicos neste processo (`epicos_conhecidos`) e o id não é um deles, relê o backlog UMA vez (`list_backlog`): se o id está lá, aceita; senão recusa listando `id=título` do backlog (teto de 20 linhas, dizendo o total se truncar, ADR 0060). Mapa vazio ou leitura do backlog que falha é "não sei" e não recusa — a api decide.
- **Onde:** `apps/engine/lib/engine/harness/tools/create_story.ex:57` (`epico_valido`)
- **Teste:** `apps/engine/test/engine/harness/argumentos_de_ferramenta_test.exs:224` e `:233`
- **Origem:** AT-584 (o qwen mandou `EPIC_ID_PLACEHOLDER_NAO_USAR_AQUI` e a api respondeu com o nome do DTO)

### RN-897 — O corte do provider por `max_tokens` num gate é origem `modelo` {#rn-897}

- **Regra:** o `agent.error` dos gates `qa-estrategia`, `qa-automacao`, `qa-performance-seguranca` e `appsec` classifica "Tool calls cutoff by max_tokens" como `modelo` (o raciocínio comeu o teto, RN-059); qualquer outro erro de LLM segue `infra`.
- **Onde:** `apps/engine/lib/engine/gates/origem_do_erro.ex:10` (`de_llm`)
- **Teste:** `apps/engine/test/engine/gates/origem_do_erro_test.exs:7`
- **Origem:** AT-586 (BaseTen 502 gravado como `infra`)

### RN-898 — Resposta cortada pelo teto, sem texto algum, fecha o turno dita {#rn-898}

- **Regra:** o turno de agente conversacional cuja última resposta de LLM foi
  cortada pelo teto de saída ([RN-737](api.md#rn-737)) e que não escreveu texto em
  volta nenhuma NÃO fecha calado: a linha "Resposta cortada pelo limite de
  tamanho." (en: "Response cut off by the length limit.") vira o fecho de uma
  `agent.response` com `modelName`, e a bolha mostra "Continuar de onde
  parou" ([RN-749](web.md#rn-749)). Vale para os sete conversacionais, que gravam o
  fecho por `payload_do_turno/2`. Fere a [RN-059](#rn-059) e a
  [RN-163](#rn-163) quando falta.
- **Onde:** `apps/engine/lib/engine/agents/texto_do_turno.ex:65`
  (`payload_do_turno`)
- **Teste:** `apps/engine/test/engine/harness/resposta_cortada_test.exs:104`
- **Origem:** AT-570 (TP-01 18ª: a 3ª chamada do PO saiu 8192/8192 e o turno
  fechou em `idle` sem `agent.response`)

### RN-899 — Resposta vazia sem corte vira agent.error de origem modelo {#rn-899}

- **Regra:** o fecho do laço conversacional sem texto, sem ferramenta e sem
  corte grava `agent.error` com origem `modelo` e a frase "o modelo não
  devolveu resposta" (`FalhaDeTurno`), nos sete servidores. É fala do agente
  para o heartbeat ([RN-581](api.md#rn-581)): a sessão com turno calado fechava por
  `heartbeat_timeout` 26 s depois de o usuário sair da tela. Presença por aba
  do projeto NÃO entra ([RN-064](web.md#rn-064)).
- **Onde:** `apps/engine/lib/engine/agents/falha_de_turno.ex:63` (`origem`),
  `apps/engine/lib/engine/agents/po_server.ex:327` (`gravar_texto_do_turno`)
- **Teste:** `apps/engine/test/engine/agents/po_server_test.exs:194` e
  `apps/engine/test/engine/agents/texto_do_turno_test.exs:96`
- **Origem:** AT-572 (TP-01 18ª, achado 4)

### RN-900 — `write_file` recusa reescrever o README e apagar a seção de uso da Infra {#rn-900}

- **Regra:** `write_file` substitui o arquivo inteiro. Quando o `path` é um
  README (`README*`), o arquivo atual tem a seção `## Rodar na sua máquina` e o
  conteúdo novo não a traz, a ferramenta recusa com erro nomeado e não escreve
  nada. Trocar um trecho exige reescrever o README completo, com a seção. O
  título é uma constante só (`titulo_secao_de_uso/0`), usada também pelos
  prompts da Infra e do dev, para que a recusa e a instrução não divirjam. Não
  é gate: a recusa é da própria ferramenta, e não cobre escrita pelo `terminal`
  (`cat >`, `sed -i`).
- **Onde:** `apps/engine/lib/engine/harness/tools/write_file.ex:62`
  (`recusa_de_secao_perdida`)
- **Teste:** `apps/engine/test/engine/harness/tools/write_file_test.exs:41`
  (a reescrita sem a seção é recusada e o arquivo fica intacto); o caminho
  feliz (README com a seção reescrito com a seção, e arquivo que não é README)
  está nas primeiras duas provas do mesmo arquivo
- **Origem:** AT-571 (TP-01 18ª de 19/10: o dev agent reescreveu o README ao
  corrigir um parecer do QA e a seção de uso que a Infra escrevera sumiu; nenhum
  gate notou)

### RN-903 — O 429 do provider é limite de uso do modelo, não falha de rede {#rn-903}

- **Regra:** a task que o dev agent bloqueia porque o modelo respondeu 429
  (código `rate_limit`, ou texto com `(429)` ou "limite de uso") diz no motivo
  "limite de uso do modelo atingido (429)", e a retomada automática diz que,
  se repetir, é para trocar o modelo do dev agent. Nunca diz "falha
  passageira de rede". A origem segue `infra` e a retomada da RN-864 não muda
  (até 3, depois de 1, 3 e 10 min; pausa de 60 s, que o `dev.idle` nomeia como
  "depois de limite de uso do modelo"). A falha de rede segue com o texto de
  sempre.
- **Onde:** `apps/engine/lib/engine/dev/dev_agent_server.ex:1136`
  (`limite_de_uso?`), `apps/engine/lib/engine/dev/dev_agent_server.ex:1127`
  (`motivo_da_parada`), `apps/engine/lib/engine/dev/dev_agent_server.ex:993`
  (`bloquear_passageira`), `apps/engine/lib/engine/dev/agent_io.ex:293`
  (`pausar_por_rede`)
- **Teste:** `apps/engine/test/engine/dev/dev_agent_server_test.exs` ("429 do
  provider: o motivo diz limite de uso do modelo, não rede"; falha: "falha de
  rede continua com o texto de rede, não de limite")
- **Origem:** AT-594 (TP-01 20ª, 19/10: o 429 do `laguna-s-2.1:free` bloqueou
  as tarefas com "falha passageira de rede", e o diagnóstico dizia limite de
  uso)

### RN-904 — O corte do teto de saída não repete a chamada com o catálogo inteiro {#rn-904}

- **Regra:** quando o Jev restringe o menu e o modelo responde SEM ferramenta,
  o passo é repetido UMA vez com o catálogo inteiro (RN-625) — exceto quando a
  resposta veio CORTADA pelo teto de saída (`truncated`). O corte não é erro de
  menu: a volta com o catálogo inteiro só aumentaria o prompt e gastaria outro
  teto de saída. Vale nas duas fachadas (`llm_turn` e `llm_turn_stream`, esta
  só sem texto já entregue). Quem trata o corte é a retentativa da RN-780 no
  `ToolLoop`, que não muda.
- **Onde:** `apps/engine/lib/engine/harness/roteamento_de_ferramenta.ex:126` (`repetir_com_catalogo_inteiro?`)
- **Teste:** `apps/engine/test/engine/harness/roteamento_de_ferramenta_test.exs:274`
  (resposta vazia cortada não repete, nos dois caminhos; sem corte, repete)
- **Origem:** AT-578 (EP-026, levantamento de 21/10): o 1º turno do PO na 18ª
  rodada gastou duas voltas de 8192 tokens de saída.

### RN-905 — O teto de passos diz o que foi gravado e o que falta, e oferece continuar {#rn-905}

- **Regra:** quando um agente conversacional para no limite de passos, o evento
  do teto (`toolloop.limit_reached`; no Criativo, o `agent.error` com
  `reason: "limite_de_iteracoes"`) leva `gravado`, a linha da RN-731 lida ANTES
  de o texto do turno ser gravado (ela sai ali e não na `agent.response`, nunca
  nas duas). O PO leva também `regrasSemHistoria`, o `uncoveredCount` que
  `fechar_handoff` já lê; a leitura que falha deixa a chave ausente, nunca erro.
  O fio mostra o motivo sem jargão, a linha gravada, as regras sem história e o
  botão "Continuar de onde parou" (RN-749, mensagem do usuário, que a fila da
  RN-673 absorve com turno em curso) só para os sete conversacionais com a
  sessão ativa; `dev-*`/`qa-*` ganham o texto, sem botão. O botão nunca continua
  sozinho.
- **Onde:** `apps/engine/lib/engine/agents/po_server.ex:254` (`run_turn`);
  `apps/web/src/routes/session-timeline-montagem.tsx:1098` (`conversacional`)
- **Teste:** `apps/engine/test/engine/agents/po_server_test.exs:548` (gravado e
  regrasSemHistoria; sem a leitura, sem a chave);
  `apps/web/src/routes/session-timeline-montagem.falha-de-turno.test.tsx:108`
  (bolha, botão para o mesmo agente; sem botão em `dev-*` e sessão inativa)
- **Origem:** AT-590 (EP-031).

### RN-908 — O kickoff do PO pede o backlog em lote, depois de ler, em camadas {#rn-908}

- **Regra:** o kickoff do PO manda, nesta ordem: ler `listar_regras_de_negocio` e `listar_backlog` na mesma resposta, sem escrita junto; depois todos os épicos numa resposta só; depois todas as histórias, com o `epic_id` devolvido; depois todas as tarefas, com o `story_id` devolvido. Nunca recria épico que já existe, e no máximo cerca de 10 chamadas de ferramenta por resposta. Motivo medido: sem o pedido de lote, o nemotron faz 1 ferramenta por resposta e o qwen faz 3; com ele, 9 em cada (`parallel_tool_calls` não mudou nada). Ler primeiro é o que impede o qwen de criar épicos sem ler o backlog. Não altera o teto `@max_iterations` (RN-166).
- **Onde:** `apps/engine/lib/engine/agents/po_server.ex:617` (`build_kickoff`)
- **Teste:** `apps/engine/test/engine/agents/po_server_test.exs:518` (leitura antes da escrita; lote em camadas épicos → histórias → tarefas)
- **Origem:** sonda da AT-591 (21/10), implementada na AT-596 (EP-026).

### RN-913 — Falha igual repetida de ferramenta no turno corrige na 2ª e para na 3ª {#rn-913}

- **Regra:** em cada turno, o harness conta as falhas IGUAIS de ferramenta (mesma ferramenta e mesmos argumentos, `tool.result` `ok: false`). Na 2ª, o resultado devolvido ao modelo ganha a correção "esta chamada já falhou igual… mude os argumentos ou use outra abordagem". Na 3ª, o laço PARA e grava `agent.error` com origem `modelo` (`reason: falha_repetida_de_ferramenta`), nunca em silêncio (RN-059, RN-163). Falhas diferentes não somam, e o contador zera a cada turno. Vale para os sete conversacionais e para o `ToolLoop`, pelo despacho único da RN-719; cada laço para pelo desfecho que já tinha (os conversacionais pelo caminho do teto de iterações, com o `agent.error` no lugar do `toolloop.limit_reached`; o `ToolLoop` devolvendo `{:ok, ctx}` com `last_error`).
- **Onde:** `apps/engine/lib/engine/harness/argumentos_de_ferramenta.ex:26` (`executar`), `apps/engine/lib/engine/harness/falha_repetida.ex:30` (`registrar`), `:51` (`parou?`), `:56` (`narrar`), `apps/engine/lib/engine/harness/tool_loop.ex:123` (`parou_ou_loop`)
- **Teste:** `apps/engine/test/engine/harness/falha_repetida_test.exs` (2ª corrige, 3ª para no `ToolLoop`, falhas diferentes não somam, zera entre turnos)
- **Origem:** AT-588 (EP-026), decisão do dono de 22/10 (K=2 corrige, K=3 para).

### RN-918 — O agente escreve o próprio plano com `registrar_plano`, e o último `agent.plan` é o vigente {#rn-918}

- **Regra:** `registrar_plano` grava `agent.plan` com o objetivo (até 200 caracteres) e de 1 a 12 passos de até 160 caracteres, cada um `pendente`, `em_curso`, `feito` ou `descartado`. Cada chamada manda o plano INTEIRO e substitui o anterior (o vigente é o último `agent.plan` do ator). Acima do teto a ferramenta RECUSA nomeando o limite, nunca corta. Não é `proposed_action` (escrever o plano não é efeito externo) nem artefato (fora de `ferramentas_de_artefato/0`) e a descrição não nomeia idioma (RN-667). Têm a ferramenta os seis conversacionais com o Infra Lead, o dev e os subagentes de QA e AppSec; ficam fora o subagente de validação de arquivo da Infra e o `context-manager`. A `Reidratacao` mostra só o último plano de cada ator, como uma nota, e pula o `tool.call`/`tool.result` da ferramenta.
- **Onde:** `apps/engine/lib/engine/harness/tools/registrar_plano.ex:84` (`run`), `apps/engine/lib/engine/agents/reidratacao.ex:172` (`so_o_ultimo_plano_de_cada_ator`)
- **Teste:** `apps/engine/test/engine/agents/diario_vivo_test.exs` (`registrar_plano`: grava, substitui, recusa acima do teto; `Reidratacao`: só o último plano)
- **Origem:** AT-582 (EP-031), decisão do dono de 27/10; [ADR 0226](../adr/0226-diario-vivo-e-retomada-dos-agentes.md).

### RN-919 — O diário é a projeção do log mais o plano, sem tabela, e diz o que está confirmado e o que ficou sem desfecho {#rn-919}

- **Regra:** `Engine.Agents.Diario` lê a cauda do log do agente, a partir do marco do turno (`agent.status: working`, o `dev.working` da tarefa ou o `agent.turn_resumed` do subagente de gate), e devolve o plano vigente, os efeitos confirmados (`tool.result` ok, `proposed_action.executed`, artefatos, commit preservado), as chamadas sem desfecho, as ações pendentes (`proposed_action.created` sem decisão), a última atividade e se a retomada automática já foi usada. A fonte de verdade continua o event log. `RetomadaDoTurno` transforma o diário numa mensagem `system` EFÊMERA (teto de 2 000 caracteres, depois de `DecisoesDoProjeto` e antes de `PerfilDoAutor`; no `ToolLoop`, por `ctx[:retomada]`): onde parou, o plano, o que não repetir, o que conferir antes e as ações pendentes que não se propõem de novo. Nunca é mensagem falsa do usuário. Push e PR são repetíveis (a PR aberta é reaproveitada, RN-812); merge NUNCA na retomada (RN-418); o engine não reexecuta chamada sem desfecho, quem decide é o modelo, depois de conferir o estado.
- **Onde:** `apps/engine/lib/engine/agents/diario.ex:85` (`de_eventos`), `:255` (`retomada_usada?`), `apps/engine/lib/engine/harness/retomada_do_turno.ex:69` (`texto`)
- **Teste:** `apps/engine/test/engine/agents/diario_vivo_test.exs` (`Diario.de_eventos/2`, `RetomadaDoTurno`, marco por opção e retomada usada)
- **Origem:** AT-582 (EP-031); [ADR 0226](../adr/0226-diario-vivo-e-retomada-dos-agentes.md).

### RN-920 — O turno conversacional que o reinício matou é retomado UMA vez no boot, se recente {#rn-920}

- **Regra:** revisa a [RN-586](#rn-586). A varredura de boot (`TurnoOrfao.varrer/2`) retoma o turno órfão cujo agente teve atividade há no máximo 900 s (`:retomada_automatica_janela_segundos`, a mesma régua da [RN-823](#rn-823), medida pela última atividade do agente e não pelo `working`) e que ainda não foi retomado: grava `agent.error` (`turno_interrompido_por_reinicio`, `retomada: "automatica"`), `agent.status: idle` e `agent.turn_resumed` (`automatica: true`) e acorda o agente, cujo `init/1` agenda `:retomar_turno_interrompido` ANTES da entrega da fila (RN-673). O teto é durável no log: um `agent.turn_resumed` do agente entre o último status não-`working` e o `working` órfão. Turno velho ou já retomado é só fechado, com a frase apontando o botão (RN-921). O `fechar_ao_subir/3` do `init/1` continua só fechando, e nó mudo conta como vivo (na dúvida nem fecha nem retoma). Resíduo declarado: dois nós subindo juntos, sem se enxergarem, podem retomar o mesmo turno duas vezes.
- **Onde:** `apps/engine/lib/engine/agents/turno_orfao.ex:90` (`varrer`), `:181` (`retomar`), `apps/engine/lib/engine/agents/turno_assincrono.ex:430` (`retomada_ao_subir`), `:253` (`tratar_resultado`)
- **Teste:** `apps/engine/test/engine/agents/diario_vivo_test.exs` (`TurnoOrfao.varrer/2: retomada automática 1× no boot`, `TurnoAssincrono: retomada no init`); `apps/engine/test/engine/agents/reidratacao_dos_seis_test.exs`
- **Origem:** AT-582 (EP-031), decisão do dono de 27/10; [ADR 0226](../adr/0226-diario-vivo-e-retomada-dos-agentes.md).

### RN-922 — O dev agent que cai dentro da janela retoma do commit da MESMA tarefa, uma vez {#rn-922}

- **Regra:** revisa a [RN-742](#rn-742) (e cita a [RN-778](#rn-778), que continua só fechando o dev sem linha durável). O dev `working` reidratado, com a última atividade há no máximo 900 s e sem `dev.working` `cause: "retomada"` nesta tarefa, preserva o worktree como commit (RN-743), readota a MESMA tarefa (a branch dela, RN-779), grava `dev.working` com `cause: "retomada"` e o commit, e roda o laço com a mensagem do diário. A tarefa nunca sai de `in_progress`. A 2ª queda, a queda fora da janela, o `awaiting_approval` e qualquer falha da retomada bloqueiam como antes, e o "desbloquear" manual vira o "retomar do commit". Merge nunca ocorre aqui (RN-418). O contador de falha passageira da RN-864 é outra régua e não muda.
- **Onde:** `apps/engine/lib/engine/dev/dev_agent_server.ex:1224` (`retomada_do_commit`), `:1250` (`retomar_do_commit`)
- **Teste:** `apps/engine/test/engine/dev/retomada_do_commit_test.exs` (queda recente retoma; 2ª queda, fora da janela e `awaiting_approval` bloqueiam)
- **Origem:** AT-582 (EP-031), decisão do dono de 27/10; [ADR 0226](../adr/0226-diario-vivo-e-retomada-dos-agentes.md).

### RN-923 — O resgate automático de gate vale uma vez por ciclo, no boot e no tick, e o "Retomar gate" zera o contador {#rn-923}

- **Regra:** revisa a [RN-823](#rn-823) e a [RN-722](#rn-722). `engine.gate_states.auto_resumes` conta os redespachos automáticos do ciclo (no boot e no tick); com 1 já usada, o segundo resgate ESTACIONA (`gate.rescue_parked`, `motivo: "retomada_automatica_ja_usada"`) e espera o "Retomar gate" ([RN-724](#rn-724)), que não tem teto e ZERA o contador. O contador fica fora do `on_conflict` do upsert (sobrevive aos passos do ciclo) e some com a linha quando o ciclo termina. O estacionamento de 2 h não muda. Os subagentes de gate ganham `registrar_plano`; no redespacho o `ToolLoop` recebe `ctx[:retomada]` com o plano do último `agent.turn_resumed` do subagente, e a área continua sendo redespachada inteira. Resíduo declarado: um ciclo novo pode pegar um marco pendente com menos de 15 min, e o subagente de gate não abre `working`, então a retomada dele leva só o plano.
- **Onde:** `apps/engine/lib/engine/gates/gate_rescuer.ex:212` (`retomar_ou_estacionar`), `:359` (`retomar_estacionado`), `apps/engine/lib/engine/gates/gate_state.ex:37` (`auto_resumes`)
- **Teste:** `apps/engine/test/engine/gates/gate_rescuer_test.exs:501` (`teto de 1 retomada automática` no tick e no boot, e o manual zerando)
- **Origem:** AT-582 (EP-031), decisões do dono de 27 e 28/10; [ADR 0226](../adr/0226-diario-vivo-e-retomada-dos-agentes.md).

### RN-924 — A correção de gate que chega ao Infra Lead com turno em curso é durável {#rn-924}

- **Regra:** revisa a [RN-617](#rn-617), no molde da fila da [RN-673](#rn-673). `InfraLeadServer.correct/3` grava `infra.correction_queued` (`id`, `gate`, `reason`, diagnóstico até 2 000 caracteres) ANTES do cast e, sem processo, acorda o agente; `iniciar_correcao/2` grava `infra.correction_delivered` (`id`). O `init/1` reconstrói as pendentes (queued menos delivered) e as entrega depois do turno retomado e da fila de mensagens, e o `Rehydrator` acorda o Infra Lead que tem correção pendente no boot. Entregue não é reentregue. O Infra Lead também tem `registrar_plano` e a retomada da RN-920.
- **Onde:** `apps/engine/lib/engine/infra/infra_lead_server.ex:1649` (`correct`), `:408` (`iniciar_correcao`), `:200` (`init`)
- **Teste:** `apps/engine/test/engine/infra/infra_lead_server_test.exs:1980` (`correct/3 grava infra.correction_queued antes do cast`; a pendente sobrevive ao reinício e a entregue não é reentregue)
- **Origem:** AT-582 (EP-031); [ADR 0226](../adr/0226-diario-vivo-e-retomada-dos-agentes.md).

### RN-940 — O gate de QA-automação sobe uma instância de QA efêmera, testa nela e a remove {#rn-940}

- **Regra:** em `container`/`mounted`, antes do laço o `QaAutomacaoAgent` propõe `qa_environment_start` (semeada `auto_approve`); a subida que falha termina o gate com desfecho nomeado de origem `infra` (RN-059). O `terminal` do QA leva `alvo: {qa: true, taskId}` vindo do ctx do agente, nunca do modelo, e roda na instância; os demais agentes não mudam. A instância é removida em sucesso, falha, exceção e teto esgotado, salvo laço parado esperando decisão. `runner` segue sem instância. O boot e o tick do `GateRescuer` chamam o `sweep` com as tarefas de `gate_states` `qa` não estacionadas; falha só loga. `run.qa` é validado no engine com a mesma régua da api (RN-935).
- **Onde:** `apps/engine/lib/engine/gates/qa_automacao_agent.ex:78` (`subir_instancia`), `apps/engine/lib/engine/gates/qa_automacao_agent.ex:120` (`com_remocao`), `apps/engine/lib/engine/harness/hooks/action_pipeline.ex:46` (`maybe_put_alvo`), `apps/engine/lib/engine/gates/gate_rescuer.ex:102` (`varrer_instancias_de_qa`), `apps/engine/lib/engine/infra/instrucoes_de_execucao.ex:133` (`qa`).
- **Teste:** `apps/engine/test/engine/gates/qa_automacao_agent_instancia_test.exs`, `apps/engine/test/engine/infra/instrucoes_de_execucao_qa_test.exs`.
- **Origem:** AT-612 (EP-030), ADR 0229; depende da api (#1146).

### RN-944 — O QA de automação recebe o pedido da volta anterior, o plano é lido por tipo e o dev sabe onde o `write_file` escreve {#rn-944}

- **Regra:** (a) o `changes_requested` mais recente do ator `qa` para a MESMA task entra no `dev_context` como `:pedido_anterior`, e o `QaAutomacaoAgent` acrescenta à mensagem a lista de itens e a instrução de dizer no `resumo` se cada um foi atendido; sem pedido anterior (primeira volta, `approved`, outra task, lista vazia) a mensagem é a de sempre. É insumo, nunca régua nova de veredito (molde do ADR 0192): o teto de correções (RN-015) e o `qa_verdict` único por ciclo não mudam. (b) `plano_ja_emitido/3` lê por tipo (`Reidratacao.eventos_do_tipo/3`), não a janela dos 200 mais recentes: o plano da task não sai da janela nem é pago de novo (cumpre a RN-674). (c) O ambiente de `dev-*`/`qa-*` diz que `write_file`/`read_file` usam caminho relativo à raiz do repositório e que `cd` no `terminal` não persiste (cada chamada é `sh -c` novo em `System.cmd ... cd: dir`, `terminal_executor.ex`).
- **Onde:** `apps/engine/lib/engine/gates/qa_lead_server.ex:784` (`pedido_anterior`), `apps/engine/lib/engine/gates/qa_lead_server.ex:743` (`plano_ja_emitido`), `apps/engine/lib/engine/gates/qa_automacao_agent.ex:323` (`com_o_pedido_anterior`), `apps/engine/lib/engine/harness/ambiente_do_agente.ex:102` (`montar`).
- **Teste:** `apps/engine/test/engine/gates/qa_automacao_agent_test.exs`, `apps/engine/test/engine/gates/qa_lead_server_test.exs`, `apps/engine/test/engine/harness/ambiente_do_agente_test.exs`.
- **Origem:** AT-616 (EP-030), TP-01 (21ª) de 30/10/2026.

### RN-945 — Os agentes de QA nomeiam o corte pelo teto de saída em vez de "o modelo parou" {#rn-945}

- **Regra:** estende a RN-780 aos dois agentes de QA: quando o `ToolLoop` devolve `corte_pelo_teto: true`, `QaEstrategiaAgent` e `QaAutomacaoAgent` narram, com origem `modelo`, que a resposta foi só raciocínio e o teto de saída a cortou duas vezes (texto único em `Engine.Gates.MotivoDoCorte`). Sem o marcador, o diagnóstico antigo ("parou sem chamar ...") continua. A falha do plano segue sem segurar a revisão (RN-674) e o teto de iterações não muda.
- **Onde:** `apps/engine/lib/engine/gates/qa_estrategia_agent.ex:265` (`diagnostico_de_parada`), `apps/engine/lib/engine/gates/qa_automacao_agent.ex:427` (`diagnostico_de_parada`), `apps/engine/lib/engine/gates/motivo_do_corte.ex:8` (`texto`).
- **Teste:** `apps/engine/test/engine/gates/qa_estrategia_agent_test.exs`, `apps/engine/test/engine/gates/qa_automacao_agent_test.exs`.
- **Origem:** AT-618 parte 1 (EP-030), TP-01 (21ª) de 30/10/2026.

### RN-946 — O corte pelo teto no meio do texto também é nomeado pelos agentes de QA {#rn-946}

- **Regra:** estende a RN-945/RN-780: resposta `truncated` COM texto e sem chamada (o raciocínio comeu o teto e o texto saiu cortado) não é "o modelo parou": o `ToolLoop` devolve `corte_com_texto: true`, chave PRÓPRIA (não `corte_pelo_teto`, que o dev agent e a RN-780 casam), e `QaEstrategiaAgent` e `QaAutomacaoAgent` narram, com origem `modelo`, que o teto cortou a resposta no meio do texto antes da ferramenta de término (`MotivoDoCorte.texto_com_texto`). Não há retentativa nova (mudaria laço e custo); resposta não cortada com texto segue "parou sem chamar ...". A mesma lacuna no dev agent fica fora.
- **Onde:** `apps/engine/lib/engine/harness/tool_loop.ex:250` (`parada_sem_chamada`), `apps/engine/lib/engine/gates/qa_estrategia_agent.ex:265` (`diagnostico_de_parada`), `apps/engine/lib/engine/gates/qa_automacao_agent.ex:427` (`diagnostico_de_parada`), `apps/engine/lib/engine/gates/motivo_do_corte.ex:9` (`texto_com_texto`).
- **Teste:** `apps/engine/test/engine/harness/tool_loop_test.exs`, `apps/engine/test/engine/gates/qa_estrategia_agent_test.exs`, `apps/engine/test/engine/gates/qa_automacao_agent_test.exs`.
- **Origem:** AT-620 (EP-030), TP-01 (22ª) de 31/10/2026.

### RN-955 — GET interno com conexão envenenada do pool é repetido UMA vez {#rn-955}

- **Regra:** complementa a [RN-742](#rn-742) (AT-428). A resposta atrasada de um pedido que estourou o `receive_timeout` fica no socket de uma conexão do pool do Finch; o GET seguinte que a pega lê a resposta ANTIGA e lança `CaseClauseError {:status, ref, _}`, que a checagem de trabalho pendente da [RN-064](web.md#rn-064) lia como "api fora do ar" e encerrava a sessão ativa. O `req_get` repete o MESMO GET uma vez quando o erro é esse (o Finch já descartou a conexão); só GET, porque POST pode ter tido efeito. Erro de transporte verdadeiro NÃO é repetido, e a RN-064 não muda.
- **Onde:** `apps/engine/lib/engine/sessions/engine_api_client.ex:2186` (`get_repetindo`).
- **Teste:** `apps/engine/test/engine/sessions/engine_api_client_isolado_test.exs` (repete e devolve; falha na segunda não tem terceira; timeout verdadeiro não repete).
- **Origem:** AT-642 (EP-030).

### RN-956 — `readiness` e `offer-infra-handoff` sobem o agente antes de chamar, como `message` {#rn-956}

- **Regra:** depois do fechamento e da reabertura ([RN-649](api.md#rn-649)) os conversacionais não estão de pé, e as duas rotas chamavam o servidor sem `start_agent`: o `:noproc` virava 500 mascarado por "Stale conn". Agora recebem `projectId` e sobem o Criativo/Arquiteto antes (idempotente); sem `projectId`, 400 nomeado.
- **Onde:** `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:348` (`readiness`), `:355` (`offer_infra_handoff`).
- **Teste:** `apps/engine/test/engine_web/controllers/agent_command_controller_test.exs` (agente parado sobe; sem `projectId` é 400).
- **Origem:** AT-642 (EP-030).

### RN-957 — "aborted" é falha de origem `infra` {#rn-957}

- **Regra:** complementa a [RN-059](#rn-059) e a [RN-810](#rn-810). "aborted" é o socket da resposta do provider morrendo no meio do stream; o frame final sem `errorCode` caía em `codigo`. `FalhaDeTurno.origem/1` o classifica `infra` (sem tocar `falha_de_rede?`; a retentativa segue pela [RN-864](#rn-864)).
- **Onde:** `apps/engine/lib/engine/agents/falha_de_turno.ex:87` (`origem`), `:110`.
- **Teste:** `apps/engine/test/engine/agents/falha_de_turno_test.exs` ("RN-957").
- **Origem:** AT-642 (EP-030).

### RN-962 — O compose do entregável usa volume nomeado, nunca bind-mount relativo {#rn-962}

- **Regra:** o Infra Lead pede VOLUME NOMEADO para dados persistentes e `.env.example` só com as variáveis obrigatórias, sem valor. `propose_infra_pr` recusa, ANTES de abrir a PR, arquivo de compose com bind-mount relativo (`- ./pasta:/destino` ou `source: ./pasta`): a pasta nasce `root` na primeira subida e o app non-root não grava nela. A recusa é resultado de ferramenta (entra no laço, RN-163) e registra `tool.result` com `ok: false`.
- **Onde:** `apps/engine/lib/engine/infra/infra_lead_server.ex:669` (`recusa_de_bind_mount_relativo`).
- **Teste:** `apps/engine/test/engine/infra/infra_lead_server_test.exs` (volume nomeado passa; formas curta, com aspas e longa são recusadas).
- **Origem:** AT-644 (EP-031).

### RN-982 — As fontes de uma resposta são as leituras ok do próprio turno, registradas pelo servidor, nunca pelo texto do modelo {#rn-982}

- **Regra:** irmã da [RN-731](#rn-731). O servidor anota cada leitura `ok` do turno (listagens de regras, backlog, métricas, ADRs e contratos, `read_file` e os trechos do `rag_search`) e o `agent.response` leva `fontes` FORA do `content`: `{tipo, rotulo, ref?, searchId?, chunkId?}`, teto de 10, com `fontesTotal` quando corta (ADR 0060). Sem leitura, o campo não existe. Leitura com falha não é fonte. A tela diz "consultado", nunca "usado": é o que o agente leu, não o que ele aproveitou. Não muda o `content`, a reidratação (RN-580), o `tool.result` (RN-589) nem o voto do RAG (RN-479..481).
- **Onde:** `apps/engine/lib/engine/agents/fontes_do_turno.ex:37` (`anotar`), `apps/engine/lib/engine/agents/texto_do_turno.ex:65` (`payload_do_turno`), `apps/engine/lib/engine/harness/tool_loop.ex:391` (`anotar`).
- **Teste:** `apps/engine/test/engine/agents/fontes_do_turno_test.exs`, `apps/engine/test/engine/harness/tool_loop_test.exs` ("RN-982"), `apps/engine/test/engine/agents/retomada_dos_seis_test.exs` e `apps/engine/test/engine/infra/infra_lead_server_test.exs` (a ferramenta nos sete).
- **Conversacionais (fatia 2):** os SETE agentes conversacionais oferecem o MESMO `rag_search` dos dev agents (`Engine.Harness.Tools.RagSearch`, escopo do projeto, sem parâmetro de escopo, teto de `top_k` da ferramenta, ADR 0060), despachado por `ArgumentosDeFerramenta.executar/4` (RN-719) e com o resultado no `tool.result` (RN-589). Entra na spec e no despacho de cada servidor: `criativo_server.ex:121`/`:469`, `po_server.ex:153`/`:437`, `arquiteto_server.ex:125`/`:402`, `dev_lead_server.ex:187`/`:580`, `ux_designer_server.ex:121`/`:350`, `staff_server.ex:121`/`:304`, `infra/infra_lead_server.ex:239`/`:1149`.
- **Origem:** AT-716 fatias 1 e 2 (EP-031).

### RN-985 — A citação inline é marcada pelo modelo e validada contra as fontes do próprio turno; índice inventado não é mostrado {#rn-985}

- **Regra:** quando o turno já tem fonte (RN-982), uma mensagem `system` EFÊMERA no fim da chamada (mesmo caminho da RN-622, nunca em `state.messages`, sem nomear idioma, RN-667) lista as fontes como `[n] rótulo` (até 10, na ordem de `fontes`) e pede "cite com [n]; não cite o que não está na lista" (teto de 250 tokens; 10 fontes medem ~55). No fecho, o servidor extrai os `[n]` do texto e grava `citacoes` no `agent.response` só com os que existem em `fontes` (`1 <= n <= fontes.length`), sem repetição e em ordem. O `content` NÃO é reescrito (RN-731): o marcador inválido fica no texto e a tela o descarta. Sem fontes, ou sem marcador válido, o campo não existe.
- **Onde:** `apps/engine/lib/engine/harness/citacao_das_fontes.ex:22` (`anexar`) e `:43` (`marcar`), `apps/engine/lib/engine/sessions/engine_api_client.ex:744` (`llm_turn`), `apps/engine/lib/engine/agents/texto_do_turno.ex:65` (`payload_do_turno`), `apps/engine/lib/engine/harness/tool_loop.ex:206` (`marcar`).
- **Teste:** `apps/engine/test/engine/harness/citacao_das_fontes_test.exs`, `apps/engine/test/engine/harness/tool_loop_test.exs` ("RN-985").
- **Origem:** AT-716 fatia 3 (EP-031).

### RN-990 — A imagem anexada vai ao LLM só no turno em que a mensagem chegou {#rn-990}

- **Regra:** o `anexos` do `agent/message` (`[{id, nome, mime, tamanho}]`, até 4 por mensagem) entra no turno e na fila de mensagens (RN-673) JUNTO com o texto: o `chat.message_queued` guarda os anexos, e as pendentes que viram UM turno juntam os anexos na ordem. Na PRIMEIRA chamada de LLM do turno, o `content` da última mensagem `user` vira a lista de partes (`text` + uma `{type:'anexo',id}` por anexo); a chamada CONSOME os anexos, então as iterações seguintes do laço de ferramentas e os turnos seguintes mandam só o texto com o rótulo `[anexos: a.png, b.txt]` (teto de 300 caracteres), que é também o que a reidratação devolve a partir do `payload.anexos` do `chat.message`. A imagem nunca é reenviada (custo × iterações × turnos; decisão do dono, 02/11). O caminho é UM só para os sete conversacionais (`TurnoAssincrono` + `Reidratacao`), sem código por servidor; mensagem sem anexos continua `string`.
- **Onde:** `apps/engine/lib/engine/harness/anexos_do_turno.ex:56` (`anexar`), `apps/engine/lib/engine/agents/turno_assincrono.ex:324` (`receber_mensagem`), `apps/engine/lib/engine/agents/reidratacao.ex:443` (`usuario`), `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:545` (`autor_do_turno`).
- **Teste:** `apps/engine/test/engine/agents/anexos_do_turno_test.exs`.
- **Origem:** AT-715 fatia 1, lane L3 (EP-031), ADR 0246.

### RN-996 — O parecer de QA leva o resultado por teste lido do relatório JUnit pelo engine; sem relatório, diz por quê {#rn-996}

- **Regra:** `emit_qa_verdict` aceita `relatorioDeTestes` (caminho relativo, em geral `.brabo-qa/junit.xml`). O ENGINE lê o arquivo (nunca o modelo declara), o apaga e põe `execucaoDeTestes` no `qa_verdict` do subagente e no consolidado: `{fonte: "junit", total, passaram, falharam, pulados, duracaoMs, suites, casosOmitidos}`, ou `{indisponivel: "sem_relatorio" | "relatorio_invalido" | "modo_runner", origem, detalhe?}`. Sem relatório NUNCA vira "0 testes" (RN-470), e falha ao ler nunca muda o veredito (ADR 0054; só registra, a régua de aprovação segue `exit 0` mais a matriz). Teto (ADR 0060): 200 casos gravados, falhas primeiro; 20 mensagens de 500 caracteres; nomes de 200; contadores do relatório inteiro, `casosOmitidos` por subtração. O parser (SAX do `:xmerl`) recusa DOCTYPE/ENTITY (XXE), lê no máximo 2 MiB e 20 000 casos. Em `runner` o arquivo vem pelo canal do runner (o `exec` já existente, sem operação nova). Quem instala o reporter é o dev agent, como TAREFA que o Dev Lead inclui no módulo; o QA só lê.
- **Onde:** `apps/engine/lib/engine/gates/relatorio_junit.ex:34` (`ler`), `apps/engine/lib/engine/gates/relatorio_junit.ex:111` (`parse`), `apps/engine/lib/engine/gates/hooks/termination.ex:49` (`com_execucao_de_testes`).
- **Teste:** `apps/engine/test/engine/gates/relatorio_junit_test.exs` (vitest, pytest, XXE recusado, teto de tamanho/casos/gravação, arquivo ausente/inválido/apagado), `apps/engine/test/engine/gates/hooks/termination_test.exs`, `apps/engine/test/engine/gates/qa_lead_test.exs`.
- **Origem:** AT-687 (EP-031), lane engine.

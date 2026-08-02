# 0045 — Reagendamento por evento do dev agent, e o circuit breaker

## Contexto

O achado P1 #10 do dogfooding, verbatim de
`docs/missions/dogfooding-mission.md:659`:

> **Um dev agent processa UMA task e para.** `:work` só é disparado na
> ativação e no aceite de paralelização; o `report_done` abre o gate e
> não se reagenda; nenhum worker do Oban redispara. Teto por módulo: 1
> task, ou 2 com paralelização.

A consequência prática está em `:396-398` da mesma colheita: a Fase 10
rodou em **tandas** — um humano reativando a execução (ou reiniciando o
engine) entre cada task, porque nada no sistema levava o agente da PR
aberta de volta a "livre pra reivindicar". O achado #11 (`:660`, P2)
descreve o sintoma de tentar contornar isso por fora: reativar não
redispara `:work` (o supervisor devolve `:existing`) e ainda cria uma
sessão órfã.

Dois fatos verificados no código, ANTES de desenhar, moldaram a decisão
inteira:

1. **O worktree é por AGENTE, não por task.** `WorktreeManager.add_worktree/3`
   apaga o worktree anterior do agente antes de criar o próximo, e
   `QaLeadServer`/`SecOpsAgentServer` o encontram via
   `DevAgentState.find_by_task_id/2` enquanto o gate roda. Reivindicar a
   próxima task assim que a PR abre destruiria fisicamente o worktree
   que o gate ainda está varrendo. Isso decidiu que PR aberta não pode
   liberar o agente — precisa de um estado que RETÉM o worktree até o
   gate terminar.
2. **`prod/patches.yaml` roda 2 réplicas do engine**, e
   `Engine.Dev.Registry` é local ao nó. Um job assíncrono (Oban) pode
   rodar em qualquer réplica; resolver "onde está o processo desse
   agente" por Registry erraria a entrega em metade dos casos em
   produção.

## Decisão

### O sinal é outbox, não uma chamada em processo

`task.gate_resolved` (só em desfechos TERMINAIS — `done`/`blocked`) e
`task.became_claimable` (story promovida, task criada sob story já
pronta, task desbloqueada) são linhas de outbox que a api emite,
lidas pelo `Engine.Outbox.Drain` já existente (`aggregate_type` ganhou
`"task"` ao lado de `"session"`) e roteadas pro
`Engine.Workers.DevAgentWakeWorker` novo — mesmo mecanismo de sempre,
handler novo.

A escolha de outbox em vez de, por exemplo, o gate chamar
`DevAgentServer.correct/3` como já faz pra `changes_requested` (essa
chamada em processo CONTINUA existindo, inalterada) é sobre
**sobrevivência**: uma linha de outbox persiste um restart do engine
entre o veredito e o wake. Uma chamada em processo não — e é exatamente
essa propriedade que a Fase 12b-6 (reidratação) precisa pra fechar o
`awaiting_gate` reidratado reagindo a um gate resolvido depois do
restart.

### `awaiting_gate` é o interlock, não um rótulo

PR aberta → o agente entra em `awaiting_gate` e MANTÉM
`task_id`/`worktree`/`branch` — nada reivindica enquanto o gate não
resolver. Só o desfecho terminal (via `task.gate_resolved`) libera,
através de `finish_task/2`. O worktree do fato #1 acima é a razão
inteira desse estado existir.

### Entrega por PubSub, não Registry

`Engine.Dev.Wake` usa `Phoenix.PubSub` (já supervisionado como
`Engine.PubSub`, sem uso em `lib/` até aqui) — cluster-wide de graça,
ao contrário do Registry local ao nó (fato #2). `DevAgentServer`
assina o próprio tópico no `init/1`; `DevAgentWakeWorker` nunca chama o
GenServer direto, sempre via `Wake.deliver/3`.

**Limite aceito conscientemente: entrega é AT-MOST-ONCE.** Se o
processo do agente estiver momentaneamente fora do ar quando o
broadcast acontece, o wake se perde e o agente só acorda no PRÓXIMO
evento. Fechar isso de vez pediria registro `:global` pros dev agents
— o mesmo que `Engine.Sessions.SessionServer` já faz, pelo mesmo motivo
— reescrevendo `AgentIo.via/2`, `DevAgentSupervisor.start_agent` e
`Monitor`. Fora do escopo desta fase; ver "o que fica para depois".

### O circuit breaker mora no engine, não na api

`backlog.task_blocked`'s `actor.id` é QUEM BLOQUEOU (`qa-agent`,
`secops-agent`, `qa-lead`, ou o próprio dev) — a api não tem como
distinguir "a sequência DESTE agente" a partir dele.
`consecutive_blocked` fica em `dev_agent_states`, incrementado só num
lugar (`finish_task/2`), porque é o único ponto por onde o agente
aprende TODO desfecho da própria task — local (ToolLoop) ou remoto
(`task.gate_resolved` com `nextAction: "blocked"`, teto de correções do
gate estourado). RN-047 detalha o mecanismo e as invariantes.

O teto (`max_consecutive_blocked`) segue o padrão de
`task_budget_micros` — coluna em `projects`, resolvida na ativação
(parâmetro → setting do projeto → default) — mas ganhou o que aquele
nunca teve: PATCH + campo em Configurações. Decisão do usuário: mesmo
custando mais superfície, o teto do breaker é do tipo que se quer
ajustar sem reativar a execução às cegas.

### Rearm é a única saída de `idle_tripped`

Um clique (`POST .../agents/:agentId/rearm`) — sem destrave automático,
mesmo princípio de `unblock` pra tasks individuais. A api registra
`dev.rearmed` com `actor: user` ANTES de qualquer coisa acontecer no
engine ser garantida (mesma ordem — engine primeiro, evento depois —
que `AcceptParallelizationUseCase` já usa, pelo mesmo motivo: o event
log é imutável, e registrar antes da recusa deixaria uma mentira nele).
O engine NÃO emite um segundo `dev.rearmed` próprio: seria o mesmo
evento contado duas vezes por atores diferentes na mesma sessão. O que
acontece depois (reivindicou ou voltou a idle) já narra via
`dev.working`/`dev.idle`, que o `try_claim/1` do rearm dispara.

## Consequências

- **Aceite do requisito central**: um projeto com N tasks prontas num
  módulo processa todas em sequência com UM agente, sem restart do
  engine e sem reativação manual — a cadeia claim → PR → gate aprovado
  → claim da próxima → fila vazia → idle → task nova → acorda é
  determinística e testada de ponta a ponta
  (`dev_agent_chain_test.exs`), com a infraestrutura REAL de
  outbox/drain/worker/PubSub no meio, não simulada.
- **O caminho dev↔gate de correção (`changes_requested`) fica
  exatamente como estava** — em processo, sem outbox. É a prova
  mecânica de que reagendar não duplica esse caminho: `task.gate_resolved`
  só é emitido para desfechos terminais, então não existe uma segunda
  linha pra ele acionar.
- **Reidratação deixou de ser "volta em branco"**: `awaiting_gate` e
  `working` retêm ou recuperam o que fazia sentido reter; `working`
  interrompido bloqueia com diagnóstico honesto do restart em vez de
  reclamar em silêncio ou tentar retomar um ToolLoop que não existe
  mais.
- **O claim atômico não mudou** (`FOR UPDATE OF t SKIP LOCKED`,
  `backlog.repository.ts`) — reagendamento aumenta QUEM tenta claim
  (o mesmo agente, mais vezes; dois agentes do módulo acordando juntos),
  não muda a garantia que já existia. A prova de concorrência da api
  (8 claims paralelos reais) continua intocada; a nova é do lado do
  engine, sobre a lógica de reação.
- **`NoopDevAgentServer` fica fora do mecanismo inteiro**: nunca abre
  gate, nunca é acordado, `status` fixo em `"working"`. É smoke test de
  infraestrutura, não um segundo produto a manter em dia com a máquina
  de estados.

## O que fica para depois

- **`:global` pros dev agents** — fecharia a lacuna at-most-once da
  entrega por PubSub. Não é urgente: o próximo evento (outro gate,
  outra task pegável) ainda alcança um agente que perdeu um wake, só
  não imediatamente.
- **"3 gates reais em sequência, sem restart" como aceite manual, não
  CI.** QA Lead e SecOps são julgamento de LLM — não determinístico por
  natureza, mesma razão que o [ADR 0020](0020-destravar-gates-qa-secops.md)
  já registrou pro critério de aceite da Fase 4a ("FECHADO, mas não
  determinístico"). O que a suite prova é tudo A JUSANTE do veredito;
  o dogfooding com gates de verdade continua sendo demonstração humana,
  registrada no CHANGELOG.
- **Kill no meio do ToolLoop não tem retomada automática, por
  decisão.** Turno, mensagens e edições do worktree só existem em
  memória — não há o que retomar. Bloquear com diagnóstico e deixar um
  humano decidir é a mesma doutrina que já rege bloqueios locais; uma
  retomada automática completa (re-despachar um ToolLoop novo na MESMA
  task já reivindicada) seria autonomia nova, e o CLAUDE.md marca
  isso como não-objetivo explícito da Fase 12.
- **12b não mexeu nos achados #12 a #16** da mesma colheita (handoff
  manual livre, promoção de story — essa é a Fase 12c —, devolução ao
  PO, aba compartilhada do painel, contador de aprovações). Fora de
  escopo.

Referencia [ADR 0005](0005-repo-bootstrap-idempotent-steps.md) (o
molde de estado durável + reidratação que este ADR estende pra dev
agents) e [ADR 0020](0020-destravar-gates-qa-secops.md) (a origem da
doutrina "nunca reclaim silencioso" e do precedente de aceite manual
pra critério não-determinístico).

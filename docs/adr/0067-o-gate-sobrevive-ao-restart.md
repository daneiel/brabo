# ADR 0067 — O gate sobrevive ao restart

- **Status:** aceito
- **Data:** 2026-08-12
- **Contexto:** achado recorrente em revisão — "PR em revisão de Dev nunca conclui"
- **Estende:** [ADR 0057](0057-o-gate-espera-a-aprovacao.md), na mesma relação
  que aquele tem com o [ADR 0052](0052-dev-agent-espera-aprovacao-no-meio-do-laco.md)

## Contexto

O [ADR 0057](0057-o-gate-espera-a-aprovacao.md) resolveu, para os agentes de
gate, o problema que o 0052 já tinha resolvido para o dev agent: suspender no
meio do laço em vez de morrer com `origin: infra` mentiroso. Ele mesmo já
declarava, na seção "O que isto NÃO resolve": **"restart no meio da espera
perde o laço"** — o `pendente`/`em_voo` do `QaLeadServer` vive só na memória
do processo, que é `restart: :temporary` (mesmo do `SecOpsAgentServer`), e
criar a tabela durável equivalente a `dev_agent_states` (Fase 12b) tinha sido
declarado escopo próprio.

Esse escopo próprio é este ADR — mas ele cobre MAIS do que a frase original
sugere. Investigar de novo o código (`qa_lead_server.ex`, `secops_agent_server.ex`,
`dispatcher.ex`) achou uma SEGUNDA janela de perda, distinta da suspensão em
`{:awaiting, ...}`: as transições intermediárias do gate —
`DevAgentServer.correct/3` (devolve ao dev) e `Dispatcher.run_secops/2`
(QA aprovou, chama SecOps) — são chamada DIRETA em memória, feitas DEPOIS de
`record_gate_verdict` já ter avançado o `gate_status` da task, de forma
DURÁVEL, na api. Se o processo cai exatamente entre as duas (veredito já
gravado, chamada em processo ainda não feita), a api acha que o próximo gate
está rodando e o engine nunca chama ninguém — a PR fica presa em
`awaiting_secops` (ou `awaiting_qa` esperando uma correção que nunca chega)
para sempre, e nenhum restart do engine conserta, porque nada nunca sabia que
aquele passo estava pendente.

Duas janelas, então, não uma:

1. **`in_progress`** — o processo caiu ANTES de qualquer veredito ser
   gravado (no início do ciclo, ou no meio de um subagente suspenso
   esperando aprovação, o caso que o 0057 já cobria).
2. **`dispatch_pending`** — o veredito JÁ foi gravado (durável, na api), e
   só a chamada em processo que aplica o próximo passo (`correct` ou
   `run_secops`) se perdeu.

A primeira o 0057 documentou; a segunda não tinha sido percebida — e é, na
prática, a mais fácil de acontecer: é exatamente o intervalo entre uma
resposta HTTP voltar e a linha seguinte de código rodar.

## Decisão

**O gate ganha estado durável, no mesmo idioma de `dev_agent_states`
(ADR 0045), e um resgatador que retoma o que ficou pendente — sem
intervenção manual.**

### A tabela: `gate_states` (schema `engine`)

Chave composta `{project_id, task_id, gate}`. Cada linha representa um ciclo
de gate EM VOO, com um `step`:

- `"in_progress"` — nenhum veredito gravado nesta tentativa. `subagent`
  (opcional) é só diagnóstico de qual subespecialidade estava suspensa —
  o `ctx` do ToolLoop NÃO é persistido (mesma escolha do `laço_pendente` do
  dev agent: não sobrevive a um restart, e fingir que sobrevive seria pior
  que não tentar).
- `"dispatch_pending"` — o veredito já foi gravado; `next_action`
  (`"correct"` | `"run_secops"`) e, quando é `"correct"`,
  `correction_reason`/`correction_diagnosis` guardam o que
  `DevAgentServer.correct/3` precisa pra ser rechamado sem reler a api.

Escrita e apagada nos MESMOS pontos onde `qa_lead_server.ex`/
`secops_agent_server.ex` já fazem as transições — não existe caminho
paralelo. `run_area`/`run_secops` gravam `in_progress` antes de qualquer
subagente/scanner rodar; `apply_gate_result`/`apply_verdict` gravam
`dispatch_pending` IMEDIATAMENTE depois de `record_gate_verdict` voltar
`correct`/`run_secops` e ANTES de fazer a chamada em processo; a linha é
apagada logo depois da chamada (ou em qualquer outro desfecho terminal —
`done`, bloqueio, ou erro).

### O resgatador: `Engine.Gates.GateRescuer`

Varre `gate_states` por linhas paradas há mais de
`gate_rescue_stale_after_seconds` (default 900s — **generoso de propósito**:
o ToolLoop de um subagente de QA pode rodar legitimamente até
`TOOL_LOOP_MAX_ITERATIONS_GATE` (60) iterações, e um limiar curto resgataria
— e duplicaria — um ciclo que só está lento). Pra cada linha:

- `in_progress` → reinicia a ÁREA inteira (`Dispatcher.run_qa`/`run_secops`
  de novo). Não há retomada CIRÚRGICA possível (o `ctx` não sobreviveu), mas
  é SEGURO: a api só aceita `record_gate_verdict` pro gate que ainda é DONO
  do `gate_status` atual (`nextGateStatus`, `pr-gate-state-machine.ts:67-69`)
  — se este ciclo já tinha terminado por outra via, a segunda tentativa
  recebe erro (hoje um 500 não mapeado — ver "Consequências") e não
  corrompe nada.
- `dispatch_pending` → reenvia exatamente a chamada que faltou
  (`Dispatcher.run_secops`/`DevAgentServer.correct`).

Chamado de dois lugares, mesmo par que `Engine.Dev.DevRehydrator` usa: uma
vez no boot (`Engine.Application`, depois dos dois supervisors de gate) e
periodicamente via `Engine.Workers.GateRescueSchedulerWorker` — um tick
Oban auto-reagendado (5 min de default), mesmo idioma do
`ModelSyncSchedulerWorker`/`AnamneseSchedulerWorker`. Reusar o Oban em vez
de inventar outro mecanismo de agendamento é decisão deliberada: o engine já
usa filas do Postgres pra isso, e um segundo mecanismo só pra gates seria
duplicar o que já existe pelo motivo errado.

### Duas guardas contra duplicar trabalho

Ciclo de gate rodando de novo é caro (LLM) e, no limite, pode gerar dois
vereditos concorrentes pro mesmo passo. Duas guardas, nenhuma perfeita
sozinha, juntas suficientes:

1. **`Registry.lookup` antes de qualquer resgate.** Um processo vivo NESTE
   nó nunca é perturbado — se ele ainda está rodando (mesmo que devagar), o
   resgate não age. Isso NÃO cobre outra réplica: `Engine.Gates.Registry` é
   local ao nó, mesma ressalva que `Engine.Dev.Wake` já assume desde o
   ADR 0045 (entrega PubSub at-most-once por causa disso).
2. **O limiar de staleness** é a segunda linha de defesa justamente pro caso
   que a guarda 1 não cobre — generoso o bastante pra dar tempo de uma
   réplica remota terminar um ciclo real antes de outra tentar de novo.

O pior desfecho de uma corrida residual (as duas guardas falharem ao mesmo
tempo) é trabalho DUPLICADO e BARATO — SecOps re-varre (determinístico, sem
LLM); QA re-roda e o segundo `record_gate_verdict` é rejeitado pela api sem
gravar nada — nunca dado inconsistente. `DevAgentServer.correct/3` já era
idempotente-por-guarda de estado desde o ADR 0052
(`handle_cast({:correct, _}, state)` só age se `status == :awaiting_gate`);
um segundo `correct` chegando depois do primeiro já ter avançado o agente é
NO-OP, de graça.

## Consequências

**O achado do ADR 0057 fecha, e vai além do que ele declarava.** As duas
janelas (`in_progress` e `dispatch_pending`) estão cobertas; a segunda nem
tinha sido nomeada até esta investigação.

**`InvalidGateActionError` continua sem filtro mapeado.** Investigar a api
pra este ADR achou que uma segunda chamada de `record_gate_verdict` pro gate
que já não é mais o dono do `gate_status` vaza como 500 genérico do Nest,
não um 4xx semântico — `DomainTransitionErrorFilter` só captura
`InvalidSessionTransitionError`/`InvalidActionTransitionError`. O resgate
de `in_progress` depende dessa rejeição para não corromper nada numa corrida
residual, e ela FUNCIONA (a exceção interrompe antes de qualquer
`UPDATE`/`INSERT` — `record-gate-verdict.use-case.ts:82-88`, antes da
transação), mas o log fica mais feio do que precisava. Mapear o filtro é
melhoria de observabilidade, não correção de bug, e fica de fora deste ADR —
registrado no backlog.

**A janela residual entre `record_gate_verdict` voltar e o `upsert!` local
de `dispatch_pending` COMMITAR não é fechada — é aceita, pelo mesmo raciocínio
que o ADR 0045 já aceitou pro `Engine.Dev.Wake`.** As duas escritas (o
`UPDATE` na api, remoto; o `INSERT` local, no engine) não podem ser
transacionais entre si sem 2PC — fora de escopo. A chamada em processo entre
elas é local e instantânea (sem I/O de rede), então a janela é da ordem de
microssegundos, não segundos; o limiar de staleness generoso faz o sweeper
nunca realisticamente colidir com ela.

**Multi-réplica continua sendo o limite já conhecido.** `Registry` local ao
nó, `Engine.Dev.Wake` at-most-once — este ADR não muda nenhum dos dois, só
usa o mesmo padrão que já existia (a guarda 1 acima). Fechar isso de vez
(registro `:global`) segue sendo o follow-up do ADR 0045, não deste.

**O achado X/Z/AD (allowlist de verbo não converge) continua fora de
escopo** — nenhuma mudança na política do ToolLoop, nenhuma mudança no
allowlist. Este ADR é só sobre o gate SOBREVIVER a um restart no meio do
ciclo, não sobre o que ele faz dentro dele.

## Alternativas consideradas

**Retomar CIRURGICAMENTE o `ctx` suspenso, persistindo-o.** Recusada, pelo
mesmo motivo que o dev agent já não faz isso pro `working` reidratado: o
histórico de mensagens de um ToolLoop é grande, muda de formato com o
harness, e persistir um formato que só é lido uma vez no resgate é dívida
que nasce pronta pra apodrecer. Reiniciar a área do zero é mais barato de
manter e, pelo argumento da checagem de estado da api, igualmente seguro.

**Um segundo mecanismo de agendamento só pra gates**, em vez de Oban.
Recusada: o engine já usa filas do Postgres pra tudo (outbox drain, wake do
dev agent, Anamnese, sync de catálogo) — inventar outro mecanismo só pra
isto duplicaria infraestrutura pelo motivo errado.

**Rebaixar o limiar de staleness pra segundos, pra resgate mais rápido.**
Recusada: um subagente de QA legitimamente rodando 40 das 60 iterações
permitidas seria resgatado NO MEIO, duplicando o trabalho que estava prestes
a terminar sozinho. O custo de esperar até 15 minutos por um resgate
genuíno é menor que o custo de resgatar cedo demais um ciclo que só estava
ocupado.

# 0163 — O clique responde ao ACEITAR o comando, e o turno segue pelo canal

## Status

**Accepted.** 2026-09-18 (AT-089). Generaliza o rompimento do bloqueio
síncrono que o [ADR 0086](0086-dev-lead-plano-suspende-para-aprovacao.md)
fez só para o Dev Lead suspenso. O ADR 0086 não é editado: o que ele decidiu
(o turno que SUSPENDE responde ao `from` na hora e emite
`agent.status: awaiting_approval` em vez de `agent.done`) continua valendo —
este documento só antecipa o momento da resposta para TODO turno, e com isso o
caso dele deixa de ser o único. Regra: [RN-578](../business-rules.md#rn-578).

## Context

Numa instalação real da v6.1.0 (14/09), três cliques ficaram pendurados pelo
turno INTEIRO do agente que dispararam:

| Rota da api | Tempo da requisição |
|---|---|
| `POST …/agents/criativo/structured-question/:id/answer` | 97,3 s |
| `POST …/sessions/:id/readiness` | 97,3 s |
| `POST …/agents/arquiteto/handoff-infra` | 51,8 s |

O event log da mesma sessão bate com os três ao décimo de segundo (do evento do
usuário ao `agent.status: idle` persistido do agente): 97,2 s, 97,3 s e 51,7 s.
O motivo é um só: toda rota de usuário que fala com um agente conversacional
atravessa `EngineWeb.AgentCommandController`, que faz um `GenServer.call`
síncrono (120 s no Criativo, 180 s nos outros) — e o `handle_call` do agente,
desde a RN-122, adia a resposta até a Task do turno terminar
(`TurnoAssincrono.iniciar/3` guardava o `from` e respondia em
`tratar_resultado/2`). O controller já devolvia **202** e já descartava o
retorno (*"esta resposta é só o aceite"*), e a OpenAPI de `…/message` já dizia
*"the response is just the acknowledgment"*. O aceite só chegava no fim do
turno.

Três consequências, todas medidas:

1. **O botão "não responde".** Para a pessoa, um clique que leva 97 s é um
   clique que falhou.
2. **Um turno acima do teto vira erro num comando que funcionou.** O
   `GenServer.call` sai por `:timeout` no processo do controller, o Phoenix
   devolve 500, a api vira 500, e a tela mostra erro — enquanto o turno segue
   rodando e termina com sucesso. Os kickoffs da mesma sessão (que são `cast`,
   e por isso não sofrem) duraram 7,5 min (PO), 6,6 min (Arquiteto) e 8,4 min
   (Infra): turno acima de 120 s não é hipótese.
3. **Recusa calada.** Mensagem que chega com um turno já em curso recebe
   `{:error, :turno_em_andamento}`, que o controller descartava e respondia
   202. Na mesma sessão, um *"Continue"* digitado 2,5 min dentro do kickoff do
   Arquiteto foi aceito com sucesso e **nunca lido** — nenhum `agent.status:
   working` depois dele, nenhum `agent.error`. Pior: a tela deixava o
   compositor livre durante esse kickoff (o handoff aceito arma a faixa sem
   `streaming`), então era o caminho natural.

## Decision

1. **`TurnoAssincrono.iniciar/3` responde ao `from` AO ACEITAR.** Com a Task
   de pé e o `agent.status: working` já persistido, o `handle_call` devolve
   `{:reply, :ok, state}`. O `from` deixa de viajar no `state.turno_assincrono`;
   `tratar_resultado/2` e `cancelar/1` não respondem mais a ninguém. É o MESMO
   mecanismo para os seis conversacionais — nenhum segundo caminho —, e o ADR
   0086 vira um caso particular: o Dev Lead suspenso continua sem `agent.done`,
   só não é mais o único a responder cedo.
2. **Só a espera sai do request; a recusa fica nele.** O que o agente recusa
   ANTES de subir a Task continua síncrono, e passa a ter status próprio em
   vez do 202 calado:
   - turno já em curso → **409** (`turno_em_andamento`), e agora com
     `agent.error` durável (origem `politica`) dizendo que a mensagem ficou
     registrada e não foi lida;
   - Dev Lead com plano pendente em Aprovações → **409**
     (`aguardando_aprovacao`, o `agent.error` que já existia);
   - Criativo sem regra de negócio capturada → **422**
     (`sem_regra_de_negocio`, idem).
   A api repassa esses dois status como `ConflictException` /
   `UnprocessableEntityException` com a frase do engine. Validação que já era
   síncrona na api (409 do formulário já respondido, 400 de resposta
   faltando, 400 da RN-160) não muda de lugar.
3. **O status HTTP da api NÃO muda.** As rotas seguem `201 { ok: true }`. O
   corpo e o status sempre significaram "aceito" — o que mudou é QUANDO ele
   chega. Trocar para 202 mudaria o contrato gerado sem mudar significado
   nenhum, e o evento do usuário (`chat.message`, `readiness.confirmed`,
   `architecture.readiness_confirmed`) é gravado antes da resposta, então o
   201 continua verdadeiro.
4. **A falha do turno continua durável, e só por lá.** Tudo que já era
   `agent.error` (crash, formato inválido, cancelamento, falha narrada pela api)
   continua sendo, com a mesma origem. O que some é o espelho disso no HTTP —
   que nunca foi lido: o controller descartava.
5. **A tela acompanha o fim pelo canal, e a rede de segurança muda de
   sinal.** Os quatro chamadores do web tratavam "a chamada resolveu" como
   "o turno acabou" (a rede de segurança da RN-131 contra o `agent.done`
   perdido). Esse sinal deixou de existir. No lugar, `acompanharTurnoPeloLog`
   (em `lib/session-turno.ts`): enquanto a faixa está ligada, a cada 4 s lê a
   cauda do event log e fecha o turno quando o `agent.status` persistido MAIS
   RECENTE do agente em questão não é `working`. Ele é confiável pelo
   ordenamento do item 1: o `working` do turno novo é persistido ANTES do
   aceite, então um `idle` antigo nunca é o mais recente depois dele.
6. **Oferecer o Dev Lead continua DEPOIS do turno de fechamento do
   Arquiteto.** `OfferInfraHandoffUseCase` chama `offerInfraHandoff` e depois
   `offerDevHandoff`, e a ordem dos dois handoffs no event log vinha da espera.
   Sem ela, o de Dev nasceria antes do de Infra. `ArquitetoServer` passa a
   ADIAR o `:offer_dev_handoff` que chega com turno em curso e o executa quando
   o turno fecha — por sucesso, falha, crash ou cancelamento, o mesmo conjunto
   de desfechos em que ele era oferecido antes.

## Consequences

- O tempo do clique passa a ser o do aceite (gravar o evento do usuário +
  subir a Task + persistir `working`), e turno longo deixa de virar 500. O teto
  do `GenServer.call` continua existindo, mas passa a medir o `handle_call`,
  não o turno.
- **Recusa que era calada vira erro visível.** Quem digita durante um turno
  (inclusive um kickoff) passa a ver 409 com o motivo, e o fio ganha o
  `agent.error`. O `chat.message` que a api gravou ANTES de perguntar ao
  engine continua no log — órfão como antes, mas agora explicado. Recusar
  antes de gravar exigiria a api perguntar ao engine se há turno, e a
  resposta envelheceria antes do `POST`; não foi feito.
- A devolução de história (`ReturnStoryUseCase`) segue best-effort: um 409 ali
  é logado e engolido como qualquer outra falha de notificar o PO — a recusa
  já está gravada. A diferença é que o `agent.error` agora existe.
- A rede de segurança da tela custa uma leitura da cauda do log a cada 4 s
  DURANTE o turno — período em que o poll de 3 s da tela está pausado (achados
  2/7). Se o engine reiniciar no meio do turno, nenhum `idle` chega e a faixa
  fica ligada até o "Parar" (que fecha localmente) ou um recarregamento: antes,
  o mesmo cenário virava 500 no clique. Declarado, não resolvido.
- Mensagem ao `infra` pelo compositor cai na cláusula final de
  `AgentCommandController.message/2`, que roteia ao Criativo. Pré-existente,
  medido aqui e NÃO corrigido — é outra frente.

# ADR 0226 — Diário vivo e retomada dos agentes: o turno interrompido volta uma vez, do plano

## Status

**Accepted.** 2026-10-28 (AT-582, EP-031, decisões do dono de 27 e 28/10). Tema: `agentes`.
Revisa, na RN-586 e na RN-778, o "nunca é refeito" do turno que o reinício do engine
matou. Complementa, sem editá-los, o [0163](0163-o-clique-responde-ao-aceitar.md), o
[0191](0191-a-mensagem-com-turno-em-curso-entra-numa-fila.md), o
[0207](0207-ciclo-de-gate-velho-estaciona.md) e o
[0221](0221-upstream-preso-por-sessao.md).

## Contexto

Quando o engine reinicia no meio de um turno, o processo e a `Task` morrem juntos. Até
aqui o desfecho era sempre o mesmo: o `TurnoOrfao` fechava o turno com `agent.error`
(origem `infra`) e `idle`, dizia "mande de novo" e nunca o refazia (RN-586); o dev agent
bloqueava a tarefa e pedia um clique; o gate era redespachado inteiro, sem limite; a
correção pendente do Infra Lead, só em memória, sumia. O pedido do dono (19/10) foi um
registro vivo do que o agente executa, de onde parou e do que falta, para voltar do ponto
exato em vez de recomeçar ou só fechar. O ganho medido é tirar o clique e o silêncio, não
dinheiro (≈ US$ 0,04 por dev interrompido na 18ª execução).

## Decisão

1. **Plano explícito.** O modelo escreve o próprio plano com a ferramenta
   `registrar_plano`, que grava `agent.plan` (objetivo e até 12 passos com estado). Não é
   `proposed_action` nem artefato do projeto: escrever o plano não é efeito externo.
2. **O diário é plano mais projeção do log**, sem tabela nova (`Engine.Agents.Diario`):
   plano vigente, efeitos confirmados, chamadas sem desfecho, ações pendentes e última
   atividade. A fonte de verdade continua o event log.
3. **Retomada automática, 1× por turno, tarefa ou ciclo, só no boot e só se recente.**
   "Recente" é 900 s desde a última atividade do agente (a mesma régua da RN-823). O
   agente recebe uma mensagem `system` EFÊMERA (`RetomadaDoTurno`), nunca uma mensagem
   falsa do usuário. Depois do teto, ou fora da janela, só o botão "Retomar" do fio, que
   é gesto humano e não tem teto. Isto REVISA o "nunca reexecuta" da RN-586 e da RN-778.
4. **Dev:** a queda recente de um dev `working` preserva o worktree como commit, readota
   a MESMA tarefa e roda o laço com o diário; a 2ª queda, a queda fora da janela e o
   `awaiting_approval` seguem bloqueando.
5. **Gates:** o resgate automático de um ciclo vale UMA vez, no boot e no tick; o 2º
   estaciona (`gate.rescue_parked`, motivo `retomada_automatica_ja_usada`) e espera o
   "Retomar gate", que zera o contador. O estacionamento de 2 h do ADR 0207 não muda.
6. **Infra Lead:** a correção que chega com turno em curso passa a ser durável
   (`infra.correction_queued`/`_delivered`), no molde da fila do ADR 0191.
7. **Idempotência:** push e PR são repetíveis (a PR aberta é reaproveitada); merge NUNCA
   na retomada (teto RN-418); chamada sem desfecho nunca é reexecutada pelo engine, e o
   diário manda o modelo conferir o estado antes de repetir.

## Consequências

- Eventos novos: `agent.plan`, `agent.turn_resumed`, `infra.correction_queued` e
  `infra.correction_delivered`; coluna `engine.gate_states.auto_resumes`; rota
  `POST /projects/:projectId/sessions/:sessionId/agents/:agent/resume`.
- Resíduos declarados, não corrigidos:
  - **Corrida de dois nós.** Dois nós subindo juntos, sem se enxergarem, podem retomar o
    mesmo turno duas vezes (nó mudo conta como vivo, o que reduz a janela, mas não a
    fecha). Os efeitos externos continuam idempotentes; o pior desfecho é um turno a mais.
  - **Marco pendente no ciclo novo de gate.** Um ciclo de gate novo pode pegar um marco
    `agent.turn_resumed` pendente com menos de 15 min e herdar o plano do ciclo anterior.
  - **"Sem desfecho" fora da tela.** O cartão do fio mostra objetivo, passos e onde
    parou, mas não as chamadas sem desfecho: o evento de erro não as traz.
  - **Retentativa de rede nos conversacionais.** Ficou fora desta entrega; o botão
    poderia valer para o turno fechado por falha passageira, em AT própria.
- O subagente de gate não abre `agent.status: working`, então a retomada dele leva só o
  plano; o `infra/workflows_agent` e o `context-manager` não têm `registrar_plano`.

## Referências

- [0163](0163-o-clique-responde-ao-aceitar.md), [0191](0191-a-mensagem-com-turno-em-curso-entra-numa-fila.md),
  [0207](0207-ciclo-de-gate-velho-estaciona.md), [0221](0221-upstream-preso-por-sessao.md).
- [RN-918](../business-rules.md#rn-918) a [RN-924](../business-rules.md#rn-924);
  revisadas: [RN-586](../business-rules.md#rn-586), [RN-742](../business-rules.md#rn-742),
  [RN-722](../business-rules.md#rn-722), [RN-823](../business-rules.md#rn-823),
  [RN-617](../business-rules.md#rn-617).

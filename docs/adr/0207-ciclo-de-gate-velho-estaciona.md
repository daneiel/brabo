# 0207 — Ciclo de gate parado há mais de 2 h estaciona, e só gesto humano o retoma

## Status

**Accepted.** 2026-10-02 (AT-391, decisão do dono em 02/10). Revisa o
[ADR 0067](0067-o-gate-sobrevive-ao-restart.md) sem editá-lo: o resgate
automático continua, com um teto de idade.

## Context

O ADR 0067 fez o `GateRescuer` retomar sozinho todo ciclo `in_progress`
parado há mais de 15 min, no boot e a cada tick. O uso real de 02/10 mostrou
três problemas: (1) ele reiniciou um ciclo cuja sessão tinha `proposed_action`
pendente de um ator `qa-*` — o ciclo esperava uma pessoa, a área foi paga de
novo e a ação ficaria órfã; (2) o teste de "processo vivo" era por PROJETO e a
linha é por TASK, então um ciclo perdido ficou 8 h sem resgate porque o QA
Lead do projeto estava vivo e ocioso; (3) não há teto: um ciclo que ninguém
olhou por horas é reiniciado inteiro sobre um contexto que pode ter mudado.

## Decision

1. **Vivo é por task.** O resgate pergunta ao lead (`{:em_voo?, task_id}`);
   lead ocupado demais para responder conta como vivo.
2. **Decisão humana pendente segura o resgate.** Ação `pending` de ator do
   gate (`qa*`, `secops*`, `appsec`) na sessão do ciclo: só log.
3. **Teto de 2 h, pela última atividade.** A idade conta de `updated_at`, a
   mesma coluna do limiar de staleness, e não de `inserted_at`: o `upsert!`
   toca `updated_at` a cada subagente, então um ciclo que avança não é velho;
   contar da criação estacionaria ciclos longos e vivos. Acima do teto, a
   linha ganha `parked_at`, o log da sessão ganha `gate.rescue_parked` (task,
   gate, idade, motivo) e a varredura deixa de vê-la — boot e tick.
4. **Retomar exige gesto humano**, por `GateRescuer.retomar_estacionado/3`.
   Nova entrada em voo do mesmo ciclo limpa a marca.

## Consequences

- Não havia caminho humano para retomar um ciclo de gate; o mínimo entregue é
  a função do engine, chamada pelo operador. Rota interna e botão no evento
  ficam propostos, não feitos.
- A pendência é lida pela SESSÃO, não pela task: `proposed_actions` não tem
  `task_id`. Duas tasks na mesma sessão com ação pendente de QA seguram uma à
  outra — preço aceito, o pior caso é não resgatar, nunca pagar duas vezes.
- Regra: [RN-722](../business-rules.md#rn-722), que revisa a RN-140.

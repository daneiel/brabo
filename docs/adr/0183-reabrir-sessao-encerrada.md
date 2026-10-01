# 0183 — A sessão encerrada pode ser reaberta: uma saída própria dos terminais, para `active`, com evento novo

## Status

**Accepted.** 2026-09-30 (AT-071, história HS-048, épico EP-027, rodada 30).
Revê parte da [RN-001](../business-rules.md#rn-001) — *"terminal states have
no exit"* — e convive com o [ADR 0061](0061-tipo-da-sessao-na-criacao.md) (a sessão
tem `kind`, imutável, e o estado de execução é o evento `execution.activated`).
Não edita nenhum dos dois: **acrescenta uma transição** à máquina de estados e
declara o que ela não muda.

Três decisões deste ADR são **PADRÃO PROVISÓRIO, CONSERVADOR, À ESPERA DO
DONO** — o papel mínimo, a ausência de prazo e a recusa em sessão com execução.
Estão marcadas assim abaixo, e mudar qualquer uma delas não exige ADR novo: é
trocar a linha indicada e a RN que a cita.

## Context

Medido em `origin/dev` (`79e6b1209f`), a partir do levantamento da AT-071
(2026-09-13, `b61bc49cd`):

- `session-state-machine.ts` declarava `closed: []` e `closed_abnormally: []`,
  com o comentário *"Estados terminais: nenhuma transição sai deles"*, e o
  teste fixava isso. Não havia `reopen`/`reabrir`/`retomar` de sessão em api,
  engine, web, ADRs nem RNs.
- O caso real (`exp001`, sessão `fe57b393…`): `closed` por
  `heartbeat_timeout`, 92 eventos, onze `artifact.business_rule`, cinco pares de
  pergunta estruturada. A conversa inteira sobrevive no event log (RN-002) e os
  artefatos são eventos, mas a sessão não tinha como voltar a aceitar conversa
  — desde a [RN-581](../business-rules.md#rn-581) a api recusa, com 409
  `sessao_encerrada`, todo evento de conversa numa sessão terminal.
- "Abrir uma sessão nova" não substitui: a ativação de um agente exige handoff
  `accepted` **na própria sessão** (`agent-activation.ts`) e o kickoff do PO lê
  brief e regras **da sessão**. Copiar para uma sessão nova duplicaria artefato
  e quebraria a cadeia Criativo → PO.
- As duas dependências estão fechadas: a AT-072 (RN-581 — o heartbeat
  reconhece conversa em curso, com teto de 8h) e a AT-073 (RN-580 — a
  reidratação lê a conversa inteira). Um agente conversacional parado no
  fechamento volta pelo `start_agent` idempotente na primeira mensagem e
  reconstrói o histórico do log.
- `session.closed` não é linha de `session_events`: é outbox. O único registro
  durável de QUANDO e POR QUE a sessão fechou são as colunas `closed_at` e
  `termination_reason` da linha de `sessions`.

## Decision

1. **Uma transição nova, só a partir dos terminais, só para `active`.**
   `canReopen`/`assertReopen` em `session-state-machine.ts`, SEPARADAS de
   `canTransition`: `ALLOWED_TRANSITIONS` continua com `closed: []` e
   `closed_abnormally: []`, então a rota genérica
   `POST .../sessions/:id/transition` continua respondendo 409 a
   `closed → active`. **`closing → active` segue proibido por qualquer
   caminho** — a adoção no drain de shutdown depende disso (`shutdown.ex`). E
   sessão `created`/`active` não "reabre".

2. **Rota própria, `POST projects/:projectId/sessions/:sessionId/reopen`**, 200,
   caso de uso `ReopenSessionUseCase`. Mesmo desenho de
   `TransitionSessionUseCase.activate`: o engine é chamado (`startSession`)
   ANTES da transação, e falha dele deixa a sessão encerrada como estava; sob
   lock tudo é revalidado.

3. **O que muda é estado, e o fechamento anterior vira evento NOVO.** A linha
   de `sessions` passa a `active` com `closed_at` e `termination_reason`
   limpos. No MESMO contador `seq` (RN-002), pelo funil de sempre
   (`AppendSessionEventUseCase`), entra `session.reopened`, ator `user` (quem
   reabriu), payload `{from, to, closedAt, terminationReason}` — a cópia do que
   a coluna perde. Nada é editado, apagado nem renumerado; o `kind` não é
   tocado (RN-097).

4. **PADRÃO PROVISÓRIO — papel mínimo `maintainer`.** Um degrau acima da
   transição genérica (`developer`): reabrir religa gasto de token numa sessão
   que alguém deu por terminada. Baixar para `developer` é trocar o
   `@RequireRole` da rota e o `roleAtLeast` da tela.

5. **PADRÃO PROVISÓRIO — sem prazo.** Toda sessão encerrada é reabrível para
   sempre. Um prazo (ex.: 30 dias) é uma comparação com o `closed_at` no caso
   de uso.

6. **PADRÃO PROVISÓRIO — sessão com `execution.activated` NÃO reabre.** 409
   `sessao_com_execucao`. `findActiveExecutionSession` escolhe a `active` mais
   recente que carrega `execution.activated` (RN-139): reabrir uma sessão de
   execução antiga a devolveria a essa busca, e a próxima reativação poderia
   desviar os dev agents para ela. O caminho declarado para "voltar a
   executar" continua sendo abrir sessão nova e ativar a execução nela (o card
   de "nova execução").

7. **Engine: o fechamento que a reabertura já desfez não para nada.**
   `SessionLifecycleWorker` lê o `status` da sessão
   (`ProjectSession.status/1`, leitura direta da tabela da api, como a
   Anamnese já fazia) e, se ele não é mais terminal, ignora o job com log — um
   job atrasado ou em retentativa derrubaria o processo e os conversacionais da
   sessão reaberta. Sem linha, o fechamento segue como sempre.

8. **Web.** Na faixa da sessão encerrada, "Reabrir sessão" com uma frase do
   que volta; inerte abaixo de `maintainer` (`roleAtLeast` sobre o papel de
   WORKSPACE, a lacuna da RN-471 já declarada na tela), com o motivo em TEXTO.
   A recusa da api (execução, 403) vira toast com a frase dela.

## Consequences

- **A RN-001 deixa de ser verdade na letra** ("terminal states have no exit"):
  há UMA saída, por rota própria. A RN-649 é o endereço da regra nova; a RN-001
  não é editada, e fica apontada por ela.
- **Segunda análise do Psicólogo: BLOQUEADA até o dono decidir**, sem código
  novo. Um segundo fechamento publica `session.closed` de novo, e o
  `PsychologistWorker` curto-circuita no caminho automático quando já existe
  análise `current` da sessão (`alreadyAnalyzed`). A conversa pós-reabertura
  fica SEM análise automática; o reprocessamento manual (`triggeredBy:
  "manual"`) continua disponível e supersede a anterior. Se o dono decidir que
  a segunda análise é legítima (a conversa cresceu), a mudança é no worker. Hoje
  o Psicólogo está pausado (`PSYCHOLOGIST_ENABLED=false`).
- **Segunda consolidação do grafo é legítima e idempotente**: a `Interacao` é
  chaveada por `sessionId` e a janela de `seq` se estende de forma monótona
  (`RecordInteractionUseCase`).
- **Orçamento e medição por sessão passam a ter mais de um intervalo ativo.**
  Métrica de duração que faça `closed_at - created_at` mente para sessão
  reaberta; o intervalo anterior está no payload de `session.reopened`. Não
  medido aqui; nenhum script atual foi mudado.
- **Heartbeat depois de reabrir**: a tela que reabre está aberta e conecta o
  heartbeat; sem aba, o heartbeat fecharia de novo (RN-064/RN-581, conversa em
  curso segura até 8h). É o comportamento de sempre de uma sessão `active`.
- **Janela de corrida conhecida**: se a transação falhar DEPOIS de o engine
  subir o `SessionServer` (reabertura concorrente, que a revalidação sob lock
  recusa), fica um processo para uma sessão ainda encerrada — o mesmo preço que
  `TransitionSessionUseCase.activate` já paga. O heartbeat sem cliente o
  encerra, e o report cai numa sessão terminal.
- **Handoffs `offered` presos na sessão encerrada voltam a ser aceitáveis** ao
  reabrir (RN-581 recusava o aceite só pelo estado). O ciclo de vida do
  [ADR 0182](0182-ciclo-de-vida-do-handoff.md) continua valendo: se o destino
  foi ativado noutra sessão enquanto esta estava fechada, a oferta já está
  `superseded`.
- **Não tocado, de propósito**: o botão "Encerrar" em `closed_abnormally` (AT-155).

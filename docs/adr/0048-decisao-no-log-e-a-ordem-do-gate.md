# 0048 — A decisão no event log, e a ordem do gate

## Contexto

Dois achados do dogfooding que a Fase 12 tinha deixado registrados e não
corrigidos. Revisitados juntos porque são a mesma classe de defeito: **um fato
importante acontecia e não ficava escrito em lugar nenhum que servisse de
memória.**

### Achado #17 — a decisão de uma ação não existia no log

`proposed_action.created`, `.approved` e `.denied` iam **só para o outbox**.
O outbox é transporte: é drenado, marcado com `processed_at` e podado. A
decisão sobrevivia apenas em `proposed_actions.decided_at`, uma coluna que diz
QUANDO mas não aparece na linha do tempo que a UI, o Psicólogo e a Anamnese
leem.

Duas consequências, e a segunda só ficou visível ao escrever este ADR:

1. **A métrica principal da Fase 10 não pôde ser colhida.** "Cliques de
   aprovação" era a coluna central da tabela de observação do dogfooding, e não
   havia consulta que a produzisse.
2. **`docs/reference/events.md` documentava os três como eventos de domínio
   desde sempre.** A doc prometia o que o código não fazia — o pior tipo de
   erro de documentação, porque quem lê não tem como desconfiar.

### O D5, e o defeito que estava embaixo dele

O [ADR 0045](0045-reagendamento-por-evento-do-dev-agent.md) registrou o D5 como
limite conhecido: com a autonomia do dev em `require_approval`, o agente
reciclava o worktree e a aprovação pendente executava contra um caminho que não
existia mais. Previu que a correção certa seria "worktree por task".

Ao investigar para corrigir, o quadro era outro e pior:

**`AgentIo.propose/3` descartava o status da ação** (`{:ok, _action} -> :ok`).
O agente propunha commit, push e PR e chamava `open_gate` + `run_qa`
**incondicionalmente**, sem saber se alguma coisa tinha executado. Com
autonomia manual:

1. as três ações nascem `pending`;
2. o gate abre assim mesmo, e o QA varre o **worktree** — onde os arquivos
   estão — e aprova;
3. o SecOps aprova, a task vira `done`;
4. `task.gate_resolved` libera o agente, que reivindica a próxima e apaga o
   worktree;
5. o usuário aprova o commit, e `git add -A` roda num diretório que sumiu.

O passo 5 devolve `{"", 2}` — `System.cmd` com `cd` inexistente não levanta
exceção —, e `git/2` transforma isso em `{:error, ""}`: a ação falha com
**diagnóstico vazio**.

O dano real não é a aprovação falhar. É a **task fechar como concluída sem uma
linha commitada e sem PR nenhuma**. E isso não exigia configuração exótica: o
toggle do painel expõe `require_approval` para `dev-*`.

## Decisão

### A decisão de ação vira evento de domínio, com o ator real

`proposed_action.created` (ator = o agente que propôs), `.approved` e `.denied`
(ator = o **usuário** que decidiu) passam a ser gravados em `session_events`,
ao lado das linhas de outbox que já existiam. O outbox continua sendo
transporte; o log passa a ser memória.

O payload de `.created` carrega o `status` resultante, e é isso que torna a
auto-aprovação **auditável**: contar eventos `.approved` conta decisão HUMANA;
a política decidindo sozinha aparece em `.created` com `status: auto_approved`
e ator agente, e nunca é confundida com um clique. Era exatamente essa
distinção que faltava para a métrica da Fase 10.

`approve_always` entra de graça: ele delega ao `ApproveActionUseCase`.

Ficou de fora, deliberadamente, o `proposed_action.created` que
`provision-repository` e `bootstrap-runner` emitem direto no outbox: aquelas
ações são mutações do bootstrap, já narradas por `bootstrap.step_*` na mesma
sessão, e duplicá-las contaria o mesmo fato duas vezes numa métrica de
aprovação.

### O gate só abre depois que a PR abre

`AgentIo.propose/3` passa a devolver `:executed | :pending | :refused`. O
agente lê os três desfechos e:

- **todos executados** (autonomia `auto_approve`, o default que a ativação
  semeia) — abre o gate, como sempre;
- **algum pendente** — entra em `:awaiting_approval`, **retendo o worktree**, e
  não abre gate nenhum. Sem PR não há o que julgar.

Quem solta o agente é `task.pr_settled`, emitido pela api quando o `pr_open`
tem desfecho — executado, negado ou falho. `opened: true` abre o gate, tarde e
correto; `opened: false` devolve a task com diagnóstico em vez de deixar o
agente esperando para sempre por um gate que ninguém vai abrir.

Três coisas tornaram isso barato:

- **`propose_pr` já carregava `storyTaskId` no payload**, então a api sabe
  exatamente qual task a PR abriu, sem tabela nova nem join.
- **`aggregateType: 'task'` já é drenado** pelo `Engine.Outbox.Drain` desde a
  Fase 12b — nenhum tipo novo de agregado, nenhum worker novo, só uma cláusula
  no `DevAgentWakeWorker`.
- **`dev_agent_states.status` é `:string`**, não enum — o estado novo não pediu
  migração.

Uma PR negada **não conta para o circuit breaker**. A decisão foi do usuário; o
agente não queimou teto nenhum. É o mesmo princípio que já valia para a
recuperação de restart (RN-047).

### Por que NÃO worktree por task

O ADR 0045 previu worktree-por-task como a correção do D5. A previsão **não foi
cumprida, e o motivo é que ela consertava o sintoma errado**: worktree por task
impede o diretório de sumir, mas o gate continuaria julgando uma PR que não
existe, e a task continuaria fechando sem commit. O defeito não era o
apagamento — era o gate abrir cedo demais.

Com a ordem corrigida, o D5 morre por consequência: o worktree só é reciclado
em `gate_resolved`, o gate só abre depois que a PR abriu, e a PR só abre depois
que commit e push executaram. **Nenhuma ação pendente sobrevive ao próprio
worktree**, sem mexer na estrutura de diretórios, sem crescimento de disco e
sem política de limpeza nova.

## Consequências

`docs/reference/events.md` deixa de mentir sobre três tipos de evento — e o
gerador, que compara a prosa com os pontos de emissão, agora encontra os três
de verdade.

A métrica que a Fase 10 perdeu passa a existir. Um próximo dogfooding consegue
responder "quantas vezes o humano decidiu" com uma consulta, e não com
anotação ao vivo — que foi exatamente o que se perdeu por não ter sido feita
(ver [a colheita](../explanation/primeiro-dogfooding.md)).

O volume de `session_events` cresce: toda ação proposta gera um evento a mais.
São ações que já eram narradas em execução (`action.executed`/`action.failed`);
o que faltava era o começo e a decisão.

O default do fake de teste do engine mudou de `pending` para `auto_approved`.
Não fazia diferença enquanto o status era descartado; a partir daqui faz, e
`auto_approved` é o que a realidade produz — `ActivateExecutionUseCase` semeia
`auto_approve` para as ações git de todo dev agent. Um default diferente do de
produção mandaria a suite inteira pelo caminho da aprovação manual.

Fica para depois, como backlog:

- **Worktree por task**, se um dia aparecer um caso em que a aprovação demora o
  bastante para o worktree incomodar por outro motivo. Deixou de ser correção
  de defeito e passou a ser escolha de arquitetura.
- **`git/2` com diagnóstico vazio.** `System.cmd` com `cd` inexistente devolve
  `{"", 2}`, e isso vira `{:error, ""}` em qualquer falha de diretório, não só
  nesta. A causa raiz desta ficou fechada, então a mensagem vazia deixou de ter
  gatilho conhecido — mas o buraco de diagnóstico continua lá.
- **Ações pendentes de tipos que não são `pr_open`.** O interlock cobre o
  caminho do dev agent, que é onde o dano era concreto. Um `terminal` pendente
  ainda não bloqueia nada, e não precisava.

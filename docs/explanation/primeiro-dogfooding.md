---
id: primeiro-dogfooding
title: O que o primeiro dogfooding ensinou
sidebar_label: Primeiro dogfooding
sidebar_position: 4
description: A colheita da Fase 10 — os dezessete achados da primeira vez em que o Brabo construiu o próprio Brabo, o que ficou medido e o que se perdeu por não ter sido anotado.
keywords: [dogfooding, colheita, Fase 10, achados, operabilidade]
---

# O que o primeiro dogfooding ensinou

Na Fase 10 o Brabo construiu uma parte do próprio Brabo: o suporte a Bitbucket e
o `GenericGitProvider` foram entregues pelos agentes do produto, num fork, com
um humano no papel de usuário. Foi a primeira execução real fora de demo.

Este documento é a **colheita** dessa corrida. Ele existe porque o
`CLAUDE.md` a referenciava desde a Fase 10 e ela nunca tinha sido escrita —
uma ausência que vale registrar, e que é ela mesma um dos achados.

:::warning O que se perdeu

A tabela de observação da missão (`docs/missions/dogfooding-mission.md:488-490`)
tem **uma única linha preenchida**: a #1, o seed manual, anotada antes de a
primeira sessão começar. Nenhuma corrida foi contada.

Não existe no repositório o número de restarts do engine, de intervenções
manuais, de cliques de aprovação nem de custo por sessão. A própria missão
avisava (`colheita-esqueleto.md:63-68`) que `restarts do engine` **não tem
registro nenhum no sistema** — é só anotação humana, e se não for anotada ao
vivo, some.

Por isso tudo o que é quantitativo aqui aparece como **`não medido`**, nunca
como estimativa. É a regra da própria colheita: nenhum número entra sem uma
consulta que o produza (`colheita-esqueleto.md:22-24`).

:::

## O que ficou registrado, e é real

O que sobreviveu é a parte **qualitativa**, e ela é densa: dezessete achados com
arquivo e linha, verificados no código durante a corrida. É dela que a Fase 12
inteira saiu.

### Antes da primeira sessão: o seed manual

A corrida começou com uma intervenção que não estava no plano. O experimento
rodou contra um fork, e as linhas de `project_repositories` e `repo_bootstraps`
foram **inseridas à mão**, marcadas como convergidas, para o produto não tentar
retomar um bootstrap (`dogfooding-mission.md:104-134`).

O motivo é o achado #1: o produto só sabia **criar** repositório. `createRepo`
era incondicional e `getRepo` existia sem nenhum chamador desde a Fase 2.

> Foi a primeira intervenção manual do experimento, e ela aconteceu **antes de o
> experimento começar** (`:130-133`).

### Durante: as tandas

O segundo fato estrutural da corrida foi o achado #10: **um dev agent processava
uma task e parava**. `:work` só era disparado na ativação e no aceite de
paralelização; nada levava o agente da PR aberta de volta a "livre para
reivindicar".

A consequência operacional está descrita em `:393-416`: a fase rodou em
**tandas**. Para cada task seguinte era preciso reiniciar o engine — os dev
agents são `restart: :temporary`, morrem e não voltam — e reativar a execução.
Reativar sem reiniciar não resolvia: o supervisor devolvia o agente existente
sem disparar `:work`, e ainda criava uma sessão órfã (achado #11).

O número de restarts é **não medido**. O que se sabe com certeza é a
propriedade: pelo desenho de então, **um restart por task entregue** era o piso,
não uma média observada.

### O terceiro: a promoção sem passo humano

O achado #13 era P2 na classificação original e foi promovido a P1 depois. A
transição `draft → ready` acontecia **automaticamente na criação**;
`TransitionStoryUseCase` validava e emitia o evento, mas não estava ligado a
rota nenhuma — código morto. A aba Backlog era somente leitura.

Ou seja: o PO, um agente de LLM, decidia sozinho o que entrava na fila de
trabalho dos dev agents, num produto cujo princípio declarado é a autoridade
final do usuário.

## Os dezessete achados

Conservados verbatim da missão, com a prioridade que receberam então. Os que a
Fase 12 fechou estão marcados.

### Do levantamento anterior à primeira sessão

| # | achado | onde | prio | estado |
|---|---|---|---|---|
| 1 | O produto não sabe apontar um projeto para repositório existente. `createRepo` é incondicional; `getRepo` existe e não é chamado por nenhum caso de uso; o DTO não tem campo para `externalId` | `provision-repository.use-case.ts:144` | **P1** | **fechado** — [ADR 0044](../adr/0044-adocao-de-repositorio-existente.md) |
| 2 | `protectBranch` no GitHub aplica `enforce_admins: true` + 1 revisor sobre proteção existente, sem ler o estado atual — pode travar o merge manual do dono | `github-provider.ts:170-175` | **P1** | **fechado** — virou regra de produto ([RN-045](../business-rules/custo.md#rn-045)) |
| 3 | O bootstrap cria e protege uma branch `rc` que a política de branches do Brabo (Fase 6) não usa | `bootstrap-steps.ts:94,195` | P2 | **fechado** — [RN-029](../business-rules.md#rn-029) |
| 4 | `agent_areas`/`agent_area_members` não existem; áreas, leads e membros são hardcoded em dois lugares que podem divergir | `schema.ts:781-786` | P2 | corte registrado da Fase 8 |
| 5 | Os seis providers de LLM da Fase 9b não entraram, e o CLAUDE.md descrevia a Fase 9 como se tivessem entrado | ADR 0042:147-156 | P2 | fechado na Fase 11 |
| 6 | `git-providers.md` afirma que Bitbucket e Generic são "fora de escopo"; o CLAUDE.md marcava os dois como fase ativa | `docs/reference/git-providers.md:170-174` | P2 | fechado na própria Fase 10 |
| 7 | O comentário de `git-errors.ts` diz "8 operações"; o contrato tem 10 | `git-errors.ts:3` | P3 | **fechado** — e a contagem virou teste |
| 8 | O cabeçalho da suite de contrato diz que só o Local a exercita; GitHub e GitLab já a rodam desde a Fase 2 | `git-provider.contract.ts:12-18` | P3 | **fechado** — e a lista de chamadores virou teste |

### Do levantamento da condução

| # | achado | onde | prio | estado |
|---|---|---|---|---|
| 9 | **O Criativo não pode ser dispensado.** O claim exige story `ready`; `ready` exige ≥1 regra de negócio; o id é validado contra evento real; e só o Criativo tem `emit_artifact` | `story-readiness.ts:46`, `po_server.ex:18` | **P1** | aberto |
| 10 | **Um dev agent processa UMA task e para.** `:work` só é disparado na ativação e no aceite de paralelização | `dev_agent_server.ex:76-91,306-327` | **P1** | **fechado** — [ADR 0045](../adr/0045-reagendamento-por-evento-do-dev-agent.md) |
| 11 | Reativar a execução não redispara `:work` e ainda cria uma sessão a mais sem agentes vinculados | `dev_agent_supervisor.ex:33-52` | P2 | **fechado** — [RN-053](../business-rules/custo.md#rn-053) |
| 12 | Não existe handoff manual para um agente à escolha, e a validação de alvo do ADR 0038 nunca foi implementada | `SessionPage.tsx:403-407` | P2 | **metade fechada** — validação de alvo em [RN-054](../business-rules.md#rn-054); handoff manual segue aberto |
| 13 | Não existe "promover a ready": a promoção é automática na criação. `TransitionStoryUseCase` não está ligado a rota nenhuma — é código morto | `create-story.use-case.ts:75-78` | P2 → **P1** | **fechado** — [ADR 0046](../adr/0046-promocao-de-story-com-autoridade-do-usuario.md) |
| 14 | Não existe devolução ao PO — nenhum estado, evento ou botão | — | P2 | **fechado** junto com o #13 |
| 15 | O painel do time e as hipóteses do Psicólogo dividem a mesma aba, que é a default do projeto | `ProjectOverviewTab.tsx:227-263` | P2 | **fechado** — aba Insights própria, com contador |
| 16 | Nenhuma tela soma aprovações por sessão; a Anamnese sob demanda não tem botão | `hooks.ts:153-160` | P3 | **fechado em parte** — ver nota abaixo |
| 17 | **A métrica principal da fase não está no event log.** `proposed_action.approved`/`.denied` vão só para o outbox | `approve-action.use-case.ts:98` | **P1** | **fechado** — [ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md) |

:::note O achado #16 tinha uma metade errada

Ao fechá-lo, a verificação mostrou que a segunda afirmação — "a Anamnese sob
demanda não tem botão" — **já era falsa quando o achado foi escrito**: a rota
`POST /projects/:projectId/anamnese/run` existe (`anamnese.controller.ts:71`) e
o botão "Rodar agora" está em Configurações › Proficiência
(`ProjectSettingsTab.tsx:777`), coberto por
`ProficiencySection.test.tsx`.

A primeira metade era real e foi fechada: a aba Sessões passa a somar as ações
propostas **de cada sessão**, separando o que foi clique seu (`decidedBy`) do
que a política auto-aprovou (`resolvedPolicy`). Antes tudo saía de
`usePendingActions`, que exige um `sessionId`, e os três chamadores passavam o
da sessão mais recente — uma decisão esquecida numa sessão anterior ficava
invisível para sempre.

O registro fica porque **a colheita não se corrige apagando**: um achado
parcialmente errado é informação sobre como a corrida foi conduzida.

:::

Dois itens entraram como **registro, não defeito**, para a colheita não os
confundir com lacuna: o **merge fora do produto** (`awaiting_user` é terminal de
propósito, [RN-014](../business-rules.md#rn-014) — o engine sequer conhece
`git_merge`) e a **dispensa do QA por palavra-chave** no RNF
(`qa_lead.ex:20-28`), que é heurística declarada, não NLP.

## O que não foi medido

Listado explicitamente, para não parecer esquecimento:

| o quê | por quê |
|---|---|
| restarts do engine por task | não tem registro no sistema; dependia de anotação humana ao vivo |
| intervenções manuais e seus motivos | idem — a tabela de observação ficou em branco a partir da linha 2 |
| cliques de aprovação por sessão | o achado #17 explica: `proposed_action.approved` não ia para `session_events`; a fonte durável era `proposed_actions.decided_at`, que a corrida não consolidou. Fechado depois pelo [ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md) — a métrica existe daqui em diante, mas não retroage a esta corrida |
| custo em tokens por agente e por provider | `token_usage` tem os dados, mas nenhuma consulta foi rodada e o banco daquela execução não foi preservado |
| voltas de correção nos gates | idem |

O achado #17 é o mais custoso deste conjunto, e a lição é de instrumentação: **a
métrica principal de um experimento precisa estar no log durável antes de o
experimento começar.** Não estava, e por isso a metade quantitativa da colheita
não existe. Ele foi fechado depois, pelo
[ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md), e isso vale para o
**próximo** experimento: nenhuma correção reconstrói dado que não foi gravado.

## O que a Fase 12 fez com isto

Os três achados P1 de **operabilidade** — #1, #10 e #13 — foram fechados na Fase
12, e a prova de que morreram numa execução única está em
[Validação da Fase 12](./validacao-fase-12.md).

O quarto P1, o #17, foi fechado depois pelo
[ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md), junto com o D5 que
o ADR 0045 tinha deixado registrado.

Os demais continuam abertos, listados acima, e nenhum foi corrigido de passagem:
corrigir um achado fora da fase que o endereça é exatamente o que a missão
proibia (princípio 3).

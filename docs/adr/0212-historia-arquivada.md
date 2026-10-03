# 0212 — A história arquivada: uma coluna, não um estado da máquina

## Status

**Accepted.** 2026-10-03 (AT-406; decisão do dono em 03/10: "PO e usuário" —
o PO e a aba Backlog editam e arquivam história `draft` sem tarefa em
execução). Regra em [RN-727](../business-rules.md#rn-727).

## Context

No TP-01 de 03/10 o PO criou duas histórias duplicadas e não tinha como
removê-las: as ferramentas dele eram `create_epic`, `create_story`,
`create_task` e `complete_story`, e a aba Backlog era só leitura. As
duplicatas ganharam tarefa, entraram no plano do Dev Lead e confundiram o
Arquiteto. A decisão foi permitir ARQUIVAR (e corrigir o título), sem apagar
nada do log.

Três formas de representar "arquivada" foram pesadas:

1. **Valor novo em `story_status`.** Rejeitado: `status = 'ready'` é o portão
   de claimabilidade (`claimNext`), e a máquina de estados
   (`story-state-machine.ts`) é sobre o andamento da história. Arquivar só
   acontece a partir de `draft`, não tem volta nesta entrega e não é passo de
   andamento — pô-lo no enum obrigaria toda transição a conhecê-lo.
2. **Apagar a linha.** Rejeitado pela decisão do dono e pela convenção do
   produto: o que foi feito fica, e as tarefas e os eventos que citam a
   história continuariam apontando para algo que sumiu.
3. **Coluna `archived_at` (e `archived_reason`) em `stories`.** Escolhido.

## Decision

- `stories` ganha `archived_at timestamptz NULL` e `archived_reason text NULL`
  (migration `0069`), no arquivo do agregado de backlog (ADR 0121). `NULL` é a
  história no jogo.
- Toda leitura que DECIDE filtra `archived_at IS NULL`: o backlog e a cobertura
  (`findByProject`), a fila de promoção (`listProposedReady`), o plano do Dev
  Lead (`findInProjectByIds`) e o claim e a contagem de pegáveis (`claimNext`,
  `countClaimableByModule`). As TAREFAS saem do jogo pela história — nenhuma
  coluna nova em `tasks`. `findById` continua achando a arquivada, para a
  recusa nomeada e a auditoria.
- Arquivar desliga `proposed_ready` na MESMA escrita (a história nunca sobra
  "aguardando você" depois de arquivada).
- O fato vai para o log em eventos NOVOS e imutáveis:
  `backlog.story_archived` (`storyId`, `title`, `reason`, `taskIds`) e
  `backlog.story_updated` (`storyId`, `previousTitle`, `title`,
  `descriptionChanged`). O prefixo `backlog.` segue os eventos do agregado que
  já existem (`backlog.story_created`, `backlog.story_promotion_returned`).
- Uma régua só (`recusaDeCorrecaoDeHistoria`) para as duas portas — a
  ferramenta do PO e a rota do usuário —, com 409 nomeado.

## Consequences

- Desarquivar não existe nesta entrega: a coluna o permite, mas é decisão de
  produto à parte, não tomada aqui.
- A história arquivada some de `listar_backlog` (o PO não a vê para não
  completá-la de novo); quem precisa saber dela lê o evento no log da sessão.
- O papel mínimo do usuário é `developer`, o mesmo de promover e devolver
  (RN-048) — nenhum papel novo.

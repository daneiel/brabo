# 0184 — Reabrir sessão: as três decisões do dono, e `developer` reabre

## Status

**Accepted.** 2026-09-30 (AT-337, rodada 32). Sobre o
[ADR 0183](0183-reabrir-sessao-encerrada.md), que NÃO é editado: ele marcou três
decisões como **padrão provisório, conservador, à espera do dono**, e este ADR
registra a resposta do dono para as três.

## Context

O ADR 0183 abriu uma saída dos estados terminais da sessão — a reabertura, por
rota própria (`POST projects/:projectId/sessions/:sessionId/reopen`) — e deixou
três escolhas em aberto, declaradas como provisórias:

1. o papel mínimo, fixado em `maintainer`, um degrau acima da transição genérica
   (`developer`) que encerra a sessão;
2. a ausência de prazo — toda sessão encerrada reabrível para sempre;
3. a recusa, com 409 `sessao_com_execucao`, de sessão que carrega
   `execution.activated`, para que `findActiveExecutionSession` (RN-139) não
   seja desviada para uma sessão de execução antiga.

O dono decidiu as três em 2026-09-30.

## Decision

1. **Papel mínimo `developer`.** O mesmo papel de encerrar pela transição
   genérica: quem pode dar a sessão por terminada pode trazê-la de volta. O
   argumento do 0183 para subir um degrau (religar gasto de token) não se
   sustenta diante de o mesmo `developer` já poder abrir sessão nova e
   conversar nela, gastando o mesmo token. `viewer` continua recusado (403).
   A mudança é a que o 0183 previu: o `@RequireRole` da rota e o
   `roleAtLeast` da tela de Sessão.
2. **Sem prazo — CONFIRMADO.** Nenhuma comparação com `closed_at`.
3. **Sessão com `execution.activated` continua recusada — CONFIRMADO.** 409
   `sessao_com_execucao`; o caminho para voltar a executar segue sendo abrir
   sessão nova e ativar a execução nela.

Nada mais do 0183 muda: a transição própria (`canReopen`), o evento
`session.reopened`, o engine chamado antes da transação e o
`SessionLifecycleWorker` que ignora o fechamento já desfeito.

## Consequences

- As três decisões deixam de ser provisórias. A [RN-650](../business-rules.md#rn-650)
  passa a dizer `developer`, e a [RN-649](../business-rules.md#rn-649) cita este
  ADR nas duas decisões confirmadas.
- `docs/security-surface.md` lista a rota como `role:developer`; o teste
  `route-surface.spec.ts` compara a tabela com a anotação real.
- A tela troca o motivo em texto de "exige maintainer" para "exige developer"
  (chave `ativacao.reabrirExigeDeveloper`, nos dois idiomas).
- Segue aberto, e não é decidido aqui: a segunda análise automática do
  Psicólogo depois de reabrir (Consequences do 0183).

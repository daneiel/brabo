# 0204 — O modo automático libera push e PR

## Status

**Accepted.** 2026-10-02 (AT-385; decisão do dono em 02/10: *"permitir sim o
auto promove de todo e qualquer agente se o agente estiver no modo auto"*,
confirmada como valendo inclusive para `git push` e abertura de PR dos dev
agents). Revisa, sem editá-los, o
[ADR 0102](0102-revisao-do-adr-0065-teto-absoluto-substitui-deny.md) (o teto
absoluto de efeito externo, RN-418) e a RN-689 (o mesmo teto pela porta
tipada), só na metade de push e PR. Preserva o
[ADR 0167](0167-modo-automatico-libera-o-escopo-de-caminho.md) e o
[ADR 0189](0189-o-piloto-automatico.md).

## Context

Desde a RN-418 o `git push`, a abertura de PR, o deploy e `sudo`/`doas` eram
`require_approval` incondicional em `decide()`, mesmo com o modo automático
ligado; a RN-689 estendeu o teto às ações tipadas `git_push` e `pr_open`. Com o
piloto automático (ADR 0189) o dev agent já roda livre dentro do container, e
o único ponto em que o fluxo de execução ainda parava por decisão humana em
modo automático era o push e a PR de cada tarefa.

## Decision

1. Com o MODO AUTOMÁTICO do agente — a curinga `agent_autonomy`
   `actionType: "*"` resolvida em `auto_approve` (origem `curinga`) —,
   `git_push` e `pr_open` tipados, e o mesmo efeito pelo comando de terminal
   (`git push`, `git remote add/set-url`, `gh pr create`, `glab mr create`),
   saem `auto_approve`, com o motivo `modo automático (RN-713)` no
   `proposed_action.created` (RN-567).
2. SÓ a curinga libera. Regra específica `auto_approve` sem a curinga, "Sempre
   permitir" (continua recusado na fonte para push/PR) e `allow` no
   `permissions.json` continuam caindo no teto. A ativação continua semeando só
   `git_commit` (RN-689).
3. Seguem teto absoluto, mesmo em modo automático: merge (em branch protegida,
   pela ação tipada; e `git merge`/`gh pr merge` pelo terminal), deploy,
   `sudo`/`doas`, `container_remove`, `instruction_patch` e paralelismo.
4. `open_adr_pr`/`open_infra_pr` já seguiam o modo automático e continuam.
5. Voltar o toggle para manual restaura a aprovação de push e PR.

## Consequences

- O dev agent em modo automático empurra e abre PR sem parar; o merge para a
  `dev` continua manual, então o código só chega a uma branch permanente pelo
  clique humano.
- A garantia passa a ser o consentimento explícito do modo automático, por
  agente, e não mais o teto. O preço é declarado: uma PR aberta por engano não
  pede confirmação antes de existir no provider.

# 0217 — Promoção automática `dev` → `qa` enquanto a QA está em fase de teste

## Status

**Accepted.** 2026-10-15 (AT-555, decisão do dono de 15/10): *"Para ganharmos
agilidade, uma regra de auto merge em qa quando houver merge em dev, e um aviso
de que, enquanto estiver em fase de teste, a qa ainda não será considerada."*

Tema: `git`. Revisa, sem editar, o fluxo de promoção do ADR 0030 (o merge de
promoção como ato manual) e a escada de aprovação dele, só no par `dev` → `qa`
e só com a variável ligada. O ADR 0073 (o caminho publicado nomeia o ambiente)
não muda: muda o quanto `/brabo/qa/` publica.

## Contexto

A promoção `dev` → `qa` era sempre manual: `promote.yml` (`workflow_dispatch`)
calcula a versão e abre o PR pelo `BRABO_BOT_TOKEN`, e o owner aprova e mergeia.
Com a `qa` ainda sem uso como ambiente validado, esse passo custava um gesto
humano por ciclo sem proteger nada que alguém consumisse.

O repositório não tem checks obrigatórios: `gh pr merge --auto` mergearia na
hora, sem esperar o CI. Automatizar o merge exige que a ESPERA seja da
automação.

## Decisão

1. **Workflow `promote-auto-qa.yml`**, em `push` na `dev`, só com a variável de
   repositório `QA_FASE_DE_TESTE == 'true'`. Ele roda o MESMO cálculo de versão
   (`scripts/ci/promote.ts`) e o MESMO passo de abertura
   (`scripts/ci/abrir-pr-de-promocao.sh`, extraído do `promote.yml`) para
   abrir ou atualizar o PR `dev` → `qa` pelo `BRABO_BOT_TOKEN`.
2. **Espera e merge** por `scripts/ci/promocao-automatica.ts`: lê os check runs
   do head até TODOS terminarem; mergeia com merge commit (e
   `--match-head-commit`) só se nenhum terminou `failure`, `cancelled`,
   `timed_out`, `action_required`, `startup_failure` ou `stale`. Zero checks é
   esperar, nunca mergear. Qualquer falha para a promoção e escreve no resumo
   do job qual check e o link. Teto de 50 minutos de espera. Concurrency
   `promote-auto-qa`, sem cancelamento.
3. **Sem `BRABO_BOT_TOKEN`, falha visível**: o job sai vermelho dizendo isso.
   O token padrão abriria o PR com checks em `action_required` e o merge dele
   não dispararia `tag-release` nem `docs-deploy`.
4. **A escada** (`scripts/ci/approval-ladder.ts`,
   `ehPromocaoAutomaticaDaFaseDeTeste`) dispensa a aprovação SÓ quando o par é
   `dev` → `qa`, a variável está ligada e o autor do PR é o usuário do
   `BRABO_BOT_TOKEN` — resolvido no workflow por `gh api user` com o próprio
   segredo, nunca por nome fixo. A razão sai no resumo do check. `qa` → `main`
   e qualquer outro par seguem exigindo aprovação, nos dois modos.
5. **O aviso**: o site publicado em `/brabo/qa/` ganha `announcementBar` fixo,
   e o corpo do PR automático abre com o mesmo texto — *"Fase de teste: a QA é
   promovida automaticamente a cada merge na dev e ainda não é considerada
   ambiente validado."*

## Consequências

- Cada merge na `dev` com CI verde vira uma tag `-qa.N` (o `tag-release` roda
  no push da `qa`), e o `N` passa a contar merges, não voltas de validação.
- `/brabo/qa/` é republicado a cada merge na `dev`.
- A variável liga e desliga sem tocar código: apagá-la ou mudar o valor volta
  ao `promote.yml` manual, e a escada volta a exigir o owner.
- `qa` → `main` fica intacto: manual, com aprovação, e a tag final só nasce no
  commit da última `-qa.N`.
- Se o usuário do `BRABO_BOT_TOKEN` for o próprio owner, a escada já passava
  por autoria (modo `solo`); a dispensa nova só muda o motivo escrito.
- Preço declarado: a `qa` deixa de ser candidata validada enquanto a variável
  estiver ligada — é exatamente o que o aviso diz.

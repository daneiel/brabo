#!/usr/bin/env bash
# Abre ou atualiza o PR de promoção DE → PARA com o corpo que `promote.ts`
# escreveu em `corpo-da-promocao.md`. Compartilhado por `promote.yml` (manual)
# e `promote-auto-qa.yml` (fase de teste, ADR 0217) — um caminho só.
#
# Entrada: GH_TOKEN, DE, PARA, VERSAO. Saída: `numero=<n>` em $GITHUB_OUTPUT.
set -euo pipefail

# PR de promoção já aberto: atualizar em vez de duplicar. Dois PRs para o
# mesmo par disputariam o mesmo merge.
existente="$(gh pr list --base "$PARA" --head "$DE" --state open --json number --jq '.[0].number // empty')"

if [ -n "$existente" ]; then
  gh pr edit "$existente" --title "promoção: $DE → $PARA ($VERSAO)" --body-file corpo-da-promocao.md
  numero="$existente"
  echo "PR #$numero atualizado: $(gh pr view "$numero" --json url --jq .url)"
else
  gh pr create \
    --base "$PARA" --head "$DE" \
    --title "promoção: $DE → $PARA ($VERSAO)" \
    --body-file corpo-da-promocao.md
  numero="$(gh pr list --base "$PARA" --head "$DE" --state open --json number --jq '.[0].number')"
  echo "PR aberto: $(gh pr view "$numero" --json url --jq .url)"
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "numero=$numero" >> "$GITHUB_OUTPUT"
fi

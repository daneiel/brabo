#!/usr/bin/env bash
# O desfecho do `carimbar` decide o que acontece com a issue da branch (AT-664),
# no molde de `alarmar-prova.sh` (AT-212): `failure` abre a issue ou comenta na
# aberta; `success` FECHA a aberta, com run e SHA; o resto não toca nada.
# Ambiente: GH_TOKEN, TITULO (a chave), CORPO (arquivo do alarme), FECHAMENTO
# (arquivo do comentário de fechamento).
alarmar_tag() {
  local desfecho="$1" existente url
  case "${desfecho}" in failure|success) ;; *) return 0 ;; esac
  existente="$(gh issue list --state open --limit 100 --json number,title \
    --jq '.[] | select(.title == $ENV.TITULO) | .number' | head -1)"
  if [ "${desfecho}" = "success" ]; then
    [ -n "${existente}" ] || return 0
    gh issue close "${existente}" --comment "$(cat "${FECHAMENTO}")"
    echo "::notice::fechei a issue #${existente} (o carimbo voltou a passar)"
  elif [ -n "${existente}" ]; then
    gh issue comment "${existente}" --body-file "${CORPO}"
    echo "::notice::comentei na issue #${existente}"
  else
    url="$(gh issue create --title "${TITULO}" --body-file "${CORPO}")"
    echo "::notice::issue aberta: ${url}"
  fi
}

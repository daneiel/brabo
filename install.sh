#!/usr/bin/env bash
# Instalador do Brabo.
#
# USO — e a forma importa:
#
#   sh -c "$(curl -fsSL https://github.com/daneiel/brabo/releases/latest/download/install.sh)"
#
# E **nunca** `curl … | sh`. O motivo é mecânico, não estético: com o script
# chegando pelo pipe, o `stdin` do processo É o download, e qualquer `read`
# para perguntar alguma coisa lê bytes do próprio script ou encontra EOF. Um
# instalador que não pode perguntar teria de escolher sozinho onde criar pastas
# no computador de alguém — e a régua deste produto é a oposta (RN-511, o passo
# de consentimento do `pnpm bootstrap`, que sem TTY relata em vez de consentir).
#
# ESTA VERSÃO NÃO INSTALA NADA. Ela verifica a própria origem, detecta o que já
# existe na máquina, pergunta, e grava o marcador — e para aí. Subir o compose,
# gerar segredos e instalar o runner são as sessões seguintes da FASE 29
# (ADR 0150). O script diz isso na saída, em vez de terminar em silêncio e
# deixar a pessoa procurando o que não aconteceu.
#
# MODOS DE IMPRESSÃO (não executam nada, não perguntam nada):
#
#   install.sh --print-state   estado detectado, em TSV
#   install.sh --print-plan    o que ele faria, em TSV
#
# Eles existem pelo mesmo motivo do `--print-commands` do `bootstrap.sh`: a
# parte que erra na prática é a DECISÃO (o que foi detectado, o que seria
# apagado), e ela se testa sem TTY e sem efeito — ver `install.spec.ts`.
set -euo pipefail

# --------------------------------------------------------------------------
# Constantes
# --------------------------------------------------------------------------

REPO='daneiel/brabo'

# O `cosign` que verifica a assinatura precisa ele mesmo de procedência, senão
# a cadeia só sobe um degrau. Versão PINADA e conferida por `sha256sum` contra
# os valores abaixo — que são os do `cosign_checksums.txt` oficial da release
# v3.1.3, copiados aqui de propósito: quem confia neste script o bastante para
# executá-lo confia no hash que ele carrega, e a cadeia não fica mais frágil do
# que o elo que a inicia. É o mesmo padrão que o `ci.yml` já aplica a todo
# binário de terceiro.
COSIGN_VERSAO='v3.1.3'

# `case` e não quatro variáveis lidas por indireção (`${!var}`), por dois
# motivos: o shellcheck não consegue seguir a indireção e acusa as quatro como
# não usadas — um falso positivo que se silencia com `disable`, e `disable`
# esconde o próximo achado de verdade —; e um array associativo, a outra saída
# óbvia, exige bash 4, enquanto o macOS ainda traz o **3.2** por padrão. Este
# script roda na máquina dos outros: ele não escolhe o bash que vai encontrar.
sha_do_cosign() {
  case "$1" in
    linux-amd64)  echo '4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71' ;;
    linux-arm64)  echo 'c5d324e091826b0d7a78eb16fef316450b4eb9aaec045611c08ba06f5e73220a' ;;
    darwin-amd64) echo '2347488e5d5b25336644024dfeca5601b190e91197a71a917bda44744aff106c' ;;
    darwin-arm64) echo '5cf948c2f4dfe59687bdd0b8523709067383e03982cc543475c8a7dc70e92a76' ;;
    *) return 1 ;;
  esac
}

# A identidade que assinou. Sem estas duas, `cosign verify-blob` aceitaria uma
# assinatura válida DE QUALQUER UM — que é exatamente o defeito que assinar
# existe para fechar.
IDENTIDADE_REGEX="^https://github.com/${REPO}/\.github/workflows/build-runner-binaries\.yml@"
EMISSOR_OIDC='https://token.actions.githubusercontent.com'

MARCADOR_SCHEMA=2
COMPOSE_DE_INSTALACAO='docker/docker-compose.install.yml'

# Fonte das imagens. `ghcr` é o default: as quatro publicadas, por DIGEST,
# com a assinatura verificada (ADR 0149). `local` constrói do checkout, e
# exige árvore limpa em tag — imagem construída de árvore suja não é a versão
# que ela diz ser.
FONTE='ghcr'

# --------------------------------------------------------------------------
# Saída
# --------------------------------------------------------------------------

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_MUTED=$'\033[2m'
  C_ERRO=$'\033[31m'; C_OK=$'\033[32m'
else
  C_RESET=''; C_BOLD=''; C_MUTED=''; C_ERRO=''; C_OK=''
fi

dizer()   { printf '%s\n' "$*"; }
detalhe() { printf '%s%s%s\n' "$C_MUTED" "$*" "$C_RESET"; }
ok()      { printf '%s✓%s %s\n' "$C_OK" "$C_RESET" "$*"; }
recusar() {
  printf '%s✗ %s%s\n' "$C_ERRO" "$*" "$C_RESET" >&2
  exit 1
}

# --------------------------------------------------------------------------
# Plataforma — Windows é recusa NOMEADA
# --------------------------------------------------------------------------

# Recusa pelo mesmo desenho da RN-518 (`brabo-runner service`): nomear a
# plataforma e apontar o caminho que existe é diferente de falhar genericamente
# num comando que não existe. Serviço e instalação em Windows são um TERCEIRO
# mecanismo, não uma variação dos dois — e prometê-lo aqui seria pior que
# recusá-lo.
detectar_plataforma() {
  local so arq
  so="$(uname -s 2>/dev/null || echo desconhecido)"
  arq="$(uname -m 2>/dev/null || echo desconhecido)"

  case "$so" in
    Linux)  so='linux' ;;
    Darwin) so='darwin' ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT)
      echo 'windows'
      return 0
      ;;
    *) echo "nao-suportado:${so}"; return 0 ;;
  esac

  case "$arq" in
    x86_64|amd64) arq='amd64' ;;
    arm64|aarch64) arq='arm64' ;;
    *) echo "nao-suportado:${so}-${arq}"; return 0 ;;
  esac

  echo "${so}-${arq}"
}

# --------------------------------------------------------------------------
# Marcador — o que torna a segunda execução um DIFF, e não uma adivinhação
# --------------------------------------------------------------------------

# `$XDG_STATE_HOME/brabo/`, com o fallback que a especificação define. É o
# mesmo idioma que `apps/runner/src/servico.ts` já usa para `XDG_CONFIG_HOME`.
# E NÃO `~/.brabo/`, que é onde o runner guarda coisa POR PROJETO: estado de
# instalação e configuração de projeto são vidas diferentes, e juntá-los faria
# a remoção de um apagar o outro.
caminho_do_marcador() {
  printf '%s/brabo/install-state.json\n' "${XDG_STATE_HOME:-${HOME}/.local/state}"
}

ler_marcador() {
  local arquivo
  arquivo="$(caminho_do_marcador)"
  [ -f "$arquivo" ] && cat "$arquivo" || true
}

# Um campo de topo do marcador, sem `jq` — que não se pode assumir na máquina
# de quem instala (o mesmo motivo pelo qual `resolver_imagens_do_ghcr` compacta
# o JSON com `tr` em vez de parseá-lo).
#
# Só campos de TOPO, e é o bastante: `versao`, `commit` e `schemaVersion` são
# todos de topo. Um marcador de schema 1 não tem `versao`, e a ausência devolve
# vazio — que é o que faz "instalação anterior a esta versão" ser um estado
# NOMEADO em vez de um erro de parse.
campo_do_marcador() {
  local chave="$1" json="$2"
  printf '%s' "$json" | tr -d '\n' | tr -s ' ' \
    | grep -o "\"${chave}\": *\"[^\"]*\"" | head -n1 | cut -d\" -f4 || true
}

# Compara duas versões semver. Ecoa `maior`, `menor` ou `igual` — nunca um
# código de saída, porque sob `set -e` um `return 1` legítimo mataria o script.
#
# Implementado à mão e NÃO com `sort -V`: o BSD `sort` do macOS ganhou `-V`
# tarde e este script roda na máquina dos outros — é a mesma disciplina que já
# fez o `case` de `sha_do_cosign` recusar array associativo por causa do bash
# 3.2. Sufixo de pré-lançamento (`-rc.1`) é CORTADO antes de comparar: o
# produto não publica pré-lançamento hoje, e tratá-lo pela metade seria pior
# que declarar que não se trata.
comparar_versoes() {
  # `.0.0` no fim NORMALIZA o número de campos, e não é zelo: `cut -d.` sobre
  # uma string SEM ponto devolve a linha inteira, não vazio — então "5" fazia o
  # segundo campo valer "5" em vez de "0", e `5.0.0` vs `5` respondia `menor`.
  # Achado por teste, não por leitura.
  local a="${1%%-*}.0.0" b="${2%%-*}.0.0" i ai bi
  i=1
  while [ "$i" -le 3 ]; do
    ai="$(printf '%s' "$a" | cut -d. -f"$i")"; ai="${ai:-0}"
    bi="$(printf '%s' "$b" | cut -d. -f"$i")"; bi="${bi:-0}"
    # Não-numérico vira 0 em vez de quebrar a aritmética do shell.
    case "$ai" in (*[!0-9]*|'') ai=0 ;; esac
    case "$bi" in (*[!0-9]*|'') bi=0 ;; esac
    if [ "$ai" -gt "$bi" ]; then printf 'maior\n'; return 0; fi
    if [ "$ai" -lt "$bi" ]; then printf 'menor\n'; return 0; fi
    i=$(( i + 1 ))
  done
  printf 'igual\n'
}

# --------------------------------------------------------------------------
# Detecção — NOMEIA o que achou antes de qualquer pergunta
# --------------------------------------------------------------------------

# Sem marcador não existe o caminho "achei algo e decido sozinho". O script
# procura SINAIS, lista o que encontrou, e é sobre essa lista que a pessoa
# responde. Uma instalação anterior a esta versão não tem marcador nenhum — e é
# justamente ela o caso perigoso, porque é a que tem dados.
# Nota de bash, e ela custou um exit 2 para aparecer: sob `set -e`, um
# `[ condição ] && atribuição` que dá FALSO é um comando que retornou 1, e o
# script morre ali. Numa função cujo propósito é dizer "não achei nada", o
# caminho de sucesso é justamente o que não casa — então aqui é `if`, sempre.
detectar_por_sinais() {
  local achados=''

  if command -v docker >/dev/null 2>&1; then
    local projetos
    # TETO de 5s, e não uma espera aberta: `docker compose ls` fala com o
    # daemon, e um daemon lento (ou parado, atrás de um socket que existe)
    # deixaria a DETECÇÃO pendurada antes de a primeira pergunta aparecer —
    # a pessoa vê um instalador que não faz nada. Medido: ~0,2s numa máquina
    # com Docker de pé, 7s num runner de CI na primeira chamada.
    #
    # Estourar o teto NÃO é erro: é o mesmo desfecho de não haver Docker
    # nenhum, e o passo de detecção segue com o resto dos sinais. `timeout`
    # devolve 124, que o `|| true` do pipeline já absorve.
    projetos="$(timeout 5 docker compose ls --all --format json 2>/dev/null \
      | grep -oE '"Name":"brabo[^"]*"' | cut -d'"' -f4 | sort -u | tr '\n' ' ' || true)"
    if [ -n "${projetos// /}" ]; then
      achados="${achados}compose:${projetos% }\n"
    fi
  fi

  local units
  # O `|| true` é do PIPELINE, não do `ls`: com `pipefail`, um `ls` que não
  # casa derruba a substituição inteira, e a atribuição vira o comando que
  # `set -e` mata. "Não há unit nenhuma" é o caso NORMAL desta função.
  units="$(ls "${XDG_CONFIG_HOME:-${HOME}/.config}"/systemd/user/brabo-runner-*.service 2>/dev/null | wc -l | tr -d ' ' || true)"
  if [ "${units:-0}" -gt 0 ]; then
    achados="${achados}units-systemd:${units}\n"
  fi

  local agents
  agents="$(ls "${HOME}"/Library/LaunchAgents/dev.brabo.runner.*.plist 2>/dev/null | wc -l | tr -d ' ' || true)"
  if [ "${agents:-0}" -gt 0 ]; then
    achados="${achados}agents-launchd:${agents}\n"
  fi

  if command -v brabo-runner >/dev/null 2>&1; then
    achados="${achados}runner-no-path:$(command -v brabo-runner)\n"
  fi

  printf '%b' "$achados"
}

# --------------------------------------------------------------------------
# Modos de impressão — sem TTY, sem efeito, sem rede
# --------------------------------------------------------------------------

imprimir_estado() {
  local marcador plataforma
  plataforma="$(detectar_plataforma)"
  marcador="$(caminho_do_marcador)"

  printf 'plataforma\t%s\n' "$plataforma"
  printf 'marcador\t%s\n' "$marcador"
  if [ -f "$marcador" ]; then
    printf 'marcador-existe\tsim\n'
    local conteudo versao_inst schema
    conteudo="$(ler_marcador)"
    versao_inst="$(campo_do_marcador versao "$conteudo")"
    schema="$(printf '%s' "$conteudo" | tr -d '\n' | grep -o '"schemaVersion": *[0-9]*' | grep -o '[0-9]*$' || true)"
    printf 'marcador-schema\t%s\n' "${schema:-desconhecido}"
    if [ -n "$versao_inst" ]; then
      printf 'versao-instalada\t%s\n' "$versao_inst"
    else
      printf 'versao-instalada\tnao-registrada\n'
    fi
  else
    printf 'marcador-existe\tnao\n'
  fi
  detectar_por_sinais | while IFS= read -r linha; do
    [ -n "$linha" ] && printf 'sinal\t%s\n' "$linha"
  done
  return 0
}

# O plano é a parte que precisa ser auditável ANTES de existir: é ele que diz o
# que seria apagado. A coluna do meio é o veredito, e as duas linhas `nunca`
# são o ponto — pasta de usuário é acúmulo, não estado do produto (RN-516: o
# espelho nunca apaga; o instalador tampouco).
imprimir_plano() {
  printf 'verificar-origem\tfaz\to checksums.txt assinado da Release, e o hash deste próprio arquivo nele\n'
  printf 'detectar\tfaz\tmarcador quando existe; sinais quando não, nomeando o que achou\n'
  printf 'comparar-versao\tfaz\ta do marcador contra a do manifesto, ANTES de perguntar o que quer que seja\n'
  printf 'atualizar\tpergunta\tversão maior: default SIM, e a instalação atual é recriada do zero\n'
  printf 'reinstalar-mesma-versao\tpergunta\tversão igual: default NÃO — não há ganho a oferecer\n'
  printf 'rebaixar\tpergunta\tversão menor: default NÃO, avisando que migração de banco não anda para trás\n'
  printf 'instalar-por-cima\tnunca\tou se migra (com backup provado), ou se para\n'
  printf 'perguntar\tfaz\texige TTY; sem TTY relata e sai 0\n'
  printf 'gravar-marcador\tfaz\t%s\n' "$(caminho_do_marcador)"
  printf 'escolher-fonte\tfaz\t--source=ghcr (digest verificado) ou --source=local (bake, árvore limpa em tag)\n'
  printf 'gerar-segredos\tfaz\tos cinco de RN-114 mais NEO4J_PASSWORD, no .env com modo 600\n'
  printf 'subir-compose\tfaz\t%s, com --wait; as migrações vêm no encadeamento\n' "$COMPOSE_DE_INSTALACAO"
  printf 'conferir-saude\tfaz\t/health da api e do engine, antes de dizer que instalou\n'
  printf 'consentir-base\tfaz\tUMA base para os dois lados: .env do servidor e runner.json do agente\n'
  printf 'instalar-runner\tfaz\tbinário verificado contra o manifesto assinado, instalado com bit de execução\n'
  printf 'migrar-instalacao-anterior\tfaz\tbackup, PROVA que restaura, pergunta, e só então apaga\n'
  printf 'apagar-sem-backup-provado\tnunca\tbackup que não restaurou não autoriza deleção nenhuma\n'
  printf 'apagar-volumes\tso-com-confirmacao\tlistados um a um antes de perguntar\n'
  printf 'apagar-base-de-projetos\tnunca\ta pasta é do usuário, não do produto\n'
  printf 'apagar-pasta-de-espelho\tnunca\tRN-516 — o espelho nunca apaga, o instalador tampouco\n'
}

# --------------------------------------------------------------------------
# Verificação da própria origem
# --------------------------------------------------------------------------

baixar_cosign() {
  local plataforma="$1" destino="$2" esperado
  esperado="$(sha_do_cosign "$plataforma" || true)"
  if [ -z "$esperado" ]; then
    recusar "sem hash pinado do cosign para '${plataforma}' — este script não baixa binário que não sabe conferir."
  fi

  curl -fsSL -o "$destino" \
    "https://github.com/sigstore/cosign/releases/download/${COSIGN_VERSAO}/cosign-${plataforma}" \
    || recusar "não consegui baixar o cosign ${COSIGN_VERSAO}."

  printf '%s  %s\n' "$esperado" "$destino" | sha256sum -c --status \
    || recusar "o cosign baixado NÃO bate com o hash pinado neste script. Isso não é um aviso: pare e investigue."
  chmod +x "$destino"
}

# A cadeia inteira, e cada elo com um motivo:
#   1. o `checksums.txt` da Release é assinado — verifica-se o BUNDLE;
#   2. o hash DESTE arquivo tem de estar dentro do manifesto verificado.
# O passo 2 é o que fecha o ciclo: um `install.sh` trocado no caminho não
# aparece no manifesto que a esteira assinou.
# O diretório temporário SOBREVIVE a esta função, em `TMP_VERIFICACAO`: o
# `checksums.txt` que ela baixou e verificou é o mesmo contra o qual o binário
# do runner é conferido depois (`instalar_o_runner`). Baixá-lo duas vezes seria
# duas chances de pegar manifestos diferentes — e a segunda não seria
# verificada.
verificar_a_si_mesmo() {
  local plataforma="$1" tmp meu_hash
  tmp="$(mktemp -d)"
  TMP_VERIFICACAO="$tmp"
  # shellcheck disable=SC2064
  trap "rm -rf '${tmp}'" EXIT

  dizer "Verificando a origem deste instalador…"

  curl -fsSL -o "${tmp}/checksums.txt" \
    "https://github.com/${REPO}/releases/latest/download/checksums.txt" \
    || recusar "a Release não tem checksums.txt — não há contra o que verificar. Isto é recusa, não aviso."
  curl -fsSL -o "${tmp}/checksums.txt.bundle" \
    "https://github.com/${REPO}/releases/latest/download/checksums.txt.bundle" \
    || recusar "a Release não tem a assinatura do checksums.txt (checksums.txt.bundle)."

  baixar_cosign "$plataforma" "${tmp}/cosign"

  "${tmp}/cosign" verify-blob \
    --bundle "${tmp}/checksums.txt.bundle" \
    --certificate-identity-regexp "$IDENTIDADE_REGEX" \
    --certificate-oidc-issuer "$EMISSOR_OIDC" \
    "${tmp}/checksums.txt" >/dev/null 2>&1 \
    || recusar "a assinatura do checksums.txt NÃO confere. O manifesto não foi publicado por esta esteira."
  ok 'assinatura do manifesto confere'

  meu_hash="$(sha256sum "$0" | cut -d' ' -f1)"
  if ! grep -qi "^${meu_hash}  install.sh$" "${tmp}/checksums.txt"; then
    recusar "o hash deste arquivo não está no manifesto assinado. Ou ele foi alterado, ou não é o instalador desta Release."
  fi
  ok 'este arquivo é o que a Release publicou'
}

# --------------------------------------------------------------------------
# Segredos
# --------------------------------------------------------------------------

# Os cinco de RN-114/ADR 0059, mais o NEO4J_PASSWORD. A geração é a MESMA de
# `docker/smoke.sh:31-57` — inclusive o detalhe que só aparece usando: o
# NEO4J_PASSWORD é `-hex` e não `-base64`, porque uma `/` no valor quebra o
# parse de `NEO4J_AUTH`.
#
# `${VAR:-$(gerar)}` respeita valor já exportado: quem já tem um segredo não o
# vê ser trocado por uma reinstalação.
gerar_segredos() {
  GIT_OAUTH_STATE_SECRET="${GIT_OAUTH_STATE_SECRET:-$(openssl rand -base64 32)}"
  AUTH_JWT_SECRET="${AUTH_JWT_SECRET:-$(openssl rand -base64 32)}"
  BRABO_SERVICE_TOKEN="${BRABO_SERVICE_TOKEN:-$(openssl rand -base64 32)}"
  CREDENTIALS_MASTER_KEY="${CREDENTIALS_MASTER_KEY:-$(openssl rand -base64 32)}"
  SECRET_KEY_BASE="${SECRET_KEY_BASE:-$(openssl rand -base64 64)}"
  NEO4J_PASSWORD="${NEO4J_PASSWORD:-$(openssl rand -hex 24)}"
}

# --------------------------------------------------------------------------
# Fonte das imagens
# --------------------------------------------------------------------------

# GHCR: os digests saem de `.release/images.json`, o mesmo manifesto que o
# `release.yml` gera e anexa à Release (ADR 0119) — e por DIGEST, nunca por
# tag, que é ponteiro móvel.
resolver_imagens_do_ghcr() {
  local tmp="$1" json="$1/images.json"

  curl -fsSL -o "$json" \
    "https://github.com/${REPO}/releases/latest/download/images.json" \
    || recusar "a Release não publica images.json — sem ele não há digest para instalar. Use --source=local para construir do checkout."

  # O manifesto é JSON INDENTADO, e `grep` trabalha linha a linha: `"alvo"` e
  # `"digest"` moram em linhas diferentes, então um padrão `[^}]*` sobre o
  # arquivo cru nunca alcança o segundo. Isto não é teoria — a primeira versão
  # deste bloco devolvia vazio para os três, e só apareceu ao rodar contra o
  # `images.json` real da Release. Compactar em UMA linha resolve sem exigir
  # `jq`, que não se pode assumir na máquina de quem instala.
  local compacto
  compacto="$(tr -d '\n' < "$json" | tr -s ' ')"

  # A versão SEMPRE esteve no manifesto (`"versao": "5.0.0"`, ao lado de
  # `commit` e `publicadoEm`) e este script a ignorava — lia só `repositorio` e
  # `digest`. É ela que torna a segunda execução uma DECISÃO ("a instalada é a
  # 5.0.0, esta é a 5.1.0") em vez da pergunta cega que era antes.
  VERSAO_A_INSTALAR="$(printf '%s' "$compacto" | grep -o '"versao": *"[^"]*"' | head -n1 | cut -d'"' -f4)"
  COMMIT_A_INSTALAR="$(printf '%s' "$compacto" | grep -o '"commit": *"[^"]*"' | head -n1 | cut -d'"' -f4)"
  [ -n "$VERSAO_A_INSTALAR" ] || recusar 'o manifesto não traz a versão — sem ela não há como comparar com o que já está instalado.'

  local alvo var repo digest entrada
  for alvo in api engine web backup; do
    entrada="$(printf '%s' "$compacto" | grep -o "{[^{}]*\"alvo\": *\"${alvo}\"[^{}]*}" || true)"
    repo="$(printf '%s' "$entrada" | grep -o '"repositorio": *"[^"]*"' | cut -d'"' -f4)"
    digest="$(printf '%s' "$entrada" | grep -o '"digest": *"[^"]*"' | cut -d'"' -f4)"
    if [ -z "$repo" ] || [ -z "$digest" ]; then
      recusar "o manifesto não traz repositório e digest para '${alvo}'."
    fi
    var="BRABO_$(printf '%s' "$alvo" | tr '[:lower:]' '[:upper:]')_IMAGE"
    eval "${var}='${repo}@${digest}'"
    ok "${alvo}: ${digest}"
  done
}

# Local: exige árvore LIMPA e em TAG. Uma imagem construída de árvore suja não
# é a versão que ela diz ser, e o marcador registraria uma mentira.
resolver_imagens_locais() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || recusar "--source=local exige rodar de dentro do checkout do Brabo."
  [ -z "$(git status --porcelain)" ] \
    || recusar "--source=local exige árvore LIMPA: uma imagem construída de árvore suja não é a versão que ela diz ser."
  git describe --exact-match --tags >/dev/null 2>&1 \
    || recusar "--source=local exige estar numa TAG (git describe --exact-match)."

  # A versão vem da TAG, e é confiável justamente porque as duas recusas acima
  # já passaram: árvore limpa e em tag. É o mesmo par (versão, commit) que o
  # GHCR traz no manifesto, pela outra ponta.
  VERSAO_A_INSTALAR="$(git describe --exact-match --tags | sed 's/^v//')"
  COMMIT_A_INSTALAR="$(git rev-parse --short=12 HEAD)"

  dizer 'Construindo as quatro imagens (docker buildx bake)…'
  docker buildx bake -f docker-bake.hcl || recusar 'o build local falhou.'

  BRABO_API_IMAGE='brabo-api:prod'
  BRABO_ENGINE_IMAGE='brabo-engine:prod'
  BRABO_WEB_IMAGE='brabo-web:prod'
  BRABO_BACKUP_IMAGE='brabo-backup:prod'
}

# --------------------------------------------------------------------------
# A base consentida, e o agente local
# --------------------------------------------------------------------------

# UMA base, consentida uma vez, servindo aos DOIS lados: `BRABO_PROJECTS_BASE`
# no `.env` (o servidor, ADR 0141) e o campo `base` do `runner.json` (o agente
# local, RN-529). O que difere entre os modos `mounted` e `runner` é QUEM
# executa, não onde o código mora — e duas bases diferentes para a mesma pasta
# seria a colisão de namespace que o ADR 0141 recusou por escrito.
consentir_base() {
  local sugerida="${HOME}/projetos-brabo" escolhida
  dizer ''
  dizer "${C_BOLD}Onde os projetos vão morar${C_RESET}"
  dizer 'Uma pasta sua. É ela que você abre no editor, e é dentro dela que cada'
  dizer 'projeto vira uma subpasta.'
  printf 'Base [%s]: ' "$sugerida"
  read -r escolhida || escolhida=''
  [ -n "$escolhida" ] || escolhida="$sugerida"

  case "$escolhida" in
    /*) ;;
    *) recusar "a base precisa ser um caminho ABSOLUTO — '${escolhida}' não é. (`~` não é expandido aqui de propósito: o valor vai para um arquivo de configuração, e um `~` gravado ali é lido literalmente.)" ;;
  esac

  # A mesma recusa que o `preflight.mjs` faz do lado do servidor: base
  # sobreposta ao checkout, nos DOIS sentidos, faria `git init` na pasta errada.
  local checkout; checkout="$(pwd)"
  case "$escolhida/" in
    "$checkout"/*) recusar "a base não pode ficar dentro do checkout do Brabo (${checkout})." ;;
  esac
  case "$checkout/" in
    "$escolhida"/*) recusar "a base não pode CONTER o checkout do Brabo (${checkout})." ;;
  esac

  mkdir -p "$escolhida" || recusar "não consegui criar ${escolhida}."
  BASE_DE_PROJETOS="$escolhida"
  ok "base: ${BASE_DE_PROJETOS}"
}

# Instala o binário do agente local — e é isto que mata o `chmod +x` manual do
# ADR 0118 (BRB-031): o navegador não preserva o bit de execução, um script
# preserva. O binário passa pela MESMA verificação do resto (RN-524): hash
# contra o `checksums.txt` assinado, que este script já baixou e verificou para
# conferir a si mesmo.
instalar_o_runner() {
  local plataforma="$1" tmp="$2" alvo destino esperado obtido
  case "$plataforma" in
    linux-amd64)  alvo='linux-x64' ;;
    linux-arm64)  alvo='linux-arm64' ;;
    darwin-amd64) alvo='darwin-x64' ;;
    darwin-arm64) alvo='darwin-arm64' ;;
    *) recusar "sem binário de runner para '${plataforma}'." ;;
  esac

  dizer ''
  dizer "${C_BOLD}Agente local${C_RESET}"
  local nome="brabo-runner-${alvo}"
  if ! curl -fsSL -o "${tmp}/${nome}" \
      "https://github.com/${REPO}/releases/latest/download/${nome}"; then
    dizer "A Release não publica ${nome}." >&2
    dizer 'O agente local NÃO foi instalado; o resto da instalação está de pé.' >&2
    dizer "Alternativa: npm install -g @brabo/runner" >&2
    return 0
  fi

  # O manifesto já foi baixado e teve a assinatura verificada em
  # `verificar_a_si_mesmo`; aqui só se confere a linha deste binário.
  esperado="$(grep -i "  ${nome}\$" "${tmp}/checksums.txt" | cut -d' ' -f1 || true)"
  [ -n "$esperado" ] || recusar "o manifesto assinado não cobre ${nome} — recusa, não aviso."
  obtido="$(sha256sum "${tmp}/${nome}" | cut -d' ' -f1)"
  [ "$esperado" = "$obtido" ] || recusar "o binário do runner NÃO bate com o manifesto assinado."
  ok 'binário do runner verificado'

  destino="${HOME}/.local/bin"
  mkdir -p "$destino"
  install -m 0755 "${tmp}/${nome}" "${destino}/brabo-runner"
  ok "instalado em ${destino}/brabo-runner (executável — sem chmod manual)"

  local cfg="${XDG_CONFIG_HOME:-${HOME}/.config}/brabo"
  mkdir -p "$cfg"
  printf '{\n  "base": "%s"\n}\n' "$BASE_DE_PROJETOS" > "${cfg}/runner.json"
  ok "base gravada em ${cfg}/runner.json"

  case ":${PATH}:" in
    *":${destino}:"*) ;;
    *) dizer "  Acrescente ${destino} ao seu PATH para chamar \`brabo-runner\` direto." ;;
  esac
}

# --------------------------------------------------------------------------
# Migração de uma instalação anterior
# --------------------------------------------------------------------------

# A ordem do ADR 0150 é: backup -> PROVAR -> confirmar -> deleção -> instalação
# -> restore. O "provar" no meio não é zelo: é o que dá ao instalador o direito
# de apagar. Um backup que ninguém tentou restaurar é um arquivo, não um
# backup — e a hora de descobrir isso não é depois do `down -v`.
#
# O destino é uma pasta do HOST, e isso importa: o default do compose é o
# volume nomeado `backup_local`, que o `down -v` apagaria JUNTO com o que se
# quer preservar (ADR 0152).
migrar_instalacao_anterior() {
  local destino="$1"

  dizer ''
  dizer "${C_BOLD}Migrando a instalação existente${C_RESET}"
  mkdir -p "$destino" || recusar "não consegui criar a pasta de backup: ${destino}"

  # 1. backup
  dizer 'Backup do Postgres e dos repositórios git locais…'
  BACKUP_DIR=/backups docker compose -f "$COMPOSE_DE_INSTALACAO" --env-file "$PWD/.env" \
    run --rm -v "${destino}:/backups" backup brabo-backup \
    || recusar "o backup falhou. NADA foi apagado — a migração para aqui, de propósito."

  # 2. provar que restaura, ANTES de apagar
  dizer 'Provando que o backup restaura…'
  BRABO_COMPOSE_FILE="${PWD}/${COMPOSE_DE_INSTALACAO}" BACKUP_DIR=/backups \
    bash docker/backup/test-restore-compose.sh \
    || recusar "o backup NÃO restaurou. Nada foi apagado. Um backup que não restaura não autoriza deleção nenhuma."
  ok 'backup provado'

  # 3. dizer o que some, e o que não
  dizer ''
  dizer "${C_BOLD}O que a migração APAGA${C_RESET}"
  dizer '  - os volumes nomeados desta instalação, `pgdata` inclusive'
  dizer '  - os containers e a rede do projeto compose'
  dizer ''
  dizer "${C_BOLD}O que ela NUNCA apaga${C_RESET}"
  dizer '  - a base de projetos: quando BRABO_PROJECTS_BASE aponta para uma pasta'
  dizer '    do host, a linha do compose é bind-mount, e `down -v` não toca bind'
  dizer '  - a pasta de espelho (RN-516: o espelho nunca apaga, e este tampouco)'
  dizer "  - o backup que acabou de ser provado, em ${destino}"
  dizer ''
  printf 'Apagar os volumes e reinstalar? [s/N] '
  local resposta; read -r resposta || resposta=''
  case "$resposta" in
    s|S|sim|SIM) ;;
    *) dizer "Nada foi apagado. O backup provado continua em ${destino}."; exit 0 ;;
  esac

  docker compose -f "$COMPOSE_DE_INSTALACAO" --env-file "$PWD/.env" down -v \
    || recusar "a deleção falhou pela metade. O backup provado está em ${destino} — não prossiga sem olhar."
  ok 'volumes removidos'

  MIGRAR_DE="$destino"
}

# Chamado DEPOIS da subida, com o banco novo de pé.
restaurar_apos_migrar() {
  local destino="$1"
  dizer ''
  dizer "${C_BOLD}Restaurando${C_RESET}"
  BACKUP_DIR=/backups docker compose -f "$COMPOSE_DE_INSTALACAO" --env-file "$PWD/.env" \
    run --rm -v "${destino}:/backups" backup brabo-restore-git --restaurar \
    || recusar "a restauração dos repositórios git falhou. O backup continua em ${destino}."
  ok 'repositórios git restaurados'
  dizer ''
  dizer "O dump do Postgres está em ${destino}. Restaurá-lo sobre um banco JÁ"
  dizer 'populado é operação destrutiva, e por isso não acontece sozinha aqui:'
  dizer '`brabo-restore` valida contra uma database de teste, nunca sobrescreve'
  dizer 'a origem (ADR 0152). Ver docs/runbook.md#restore.'
}

# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

main() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --print-state) imprimir_estado; exit 0 ;;
      --print-plan)  imprimir_plano;  exit 0 ;;
      --help|-h)     sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
      --source=ghcr)  FONTE='ghcr';  shift ;;
      --source=local) FONTE='local'; shift ;;
      --source=*) recusar "fonte desconhecida: '${1#--source=}'. Use ghcr (o default) ou local." ;;
      *) recusar "argumento desconhecido: '$1'." ;;
    esac
  done

  local plataforma
  plataforma="$(detectar_plataforma)"

  case "$plataforma" in
    windows)
      recusar "Windows está fora de escopo por decisão declarada (ADR 0150), como já é para o serviço do runner (RN-518). Não é uma falha genérica: o mecanismo de instalação ali é outro, e prometê-lo aqui seria pior que recusá-lo."
      ;;
    nao-suportado:*)
      recusar "plataforma não suportada: ${plataforma#nao-suportado:}. Suportados: linux e macOS, em amd64 e arm64."
      ;;
  esac

  verificar_a_si_mesmo "$plataforma"

  # As imagens são resolvidas ANTES da detecção, e a ordem é a decisão: saber
  # O QUE se vai instalar é pré-requisito para perguntar se apaga o que existe.
  # Antes, a pergunta de migração vinha primeiro e era cega — ela não tinha como
  # dizer "a instalada é a 5.0.0 e esta é a 5.1.0", que é a única informação com
  # que alguém decide. Resolver é barato e sem efeito: baixa um manifesto (ghcr)
  # ou confere que a árvore está limpa e em tag (local).
  dizer ''
  dizer "${C_BOLD}Imagens (--source=${FONTE})${C_RESET}"
  local tmp_imagens
  tmp_imagens="$(mktemp -d)"
  if [ "$FONTE" = 'ghcr' ]; then
    resolver_imagens_do_ghcr "$tmp_imagens"
  else
    resolver_imagens_locais
  fi
  rm -rf "$tmp_imagens"
  ok "versão a instalar: ${VERSAO_A_INSTALAR} (${COMMIT_A_INSTALAR})"

  dizer ''
  dizer "${C_BOLD}O que já existe nesta máquina${C_RESET}"
  local marcador sinais
  marcador="$(ler_marcador)"
  sinais="$(detectar_por_sinais)"

  VERSAO_INSTALADA=''
  RELACAO='desconhecida'
  if [ -n "$marcador" ]; then
    ok "marcador de instalação: $(caminho_do_marcador)"
    VERSAO_INSTALADA="$(campo_do_marcador versao "$marcador")"
    if [ -n "$VERSAO_INSTALADA" ]; then
      RELACAO="$(comparar_versoes "$VERSAO_A_INSTALAR" "$VERSAO_INSTALADA")"
      case "$RELACAO" in
        maior) ok "instalada ${VERSAO_INSTALADA} → esta é ${VERSAO_A_INSTALAR}: é ATUALIZAÇÃO." ;;
        igual) ok "instalada ${VERSAO_INSTALADA}: é a MESMA versão que esta." ;;
        menor) dizer "  Instalada ${VERSAO_INSTALADA}, esta é ${VERSAO_A_INSTALAR}: seria REBAIXAMENTO." ;;
      esac
    else
      # Marcador de schema 1 — gravado antes de a versão existir nele. É um
      # estado NOMEADO, e não um erro: a instalação é real, só não se sabe qual.
      dizer '  O marcador é de um schema anterior e não registra versão.'
      dizer '  Não dá para dizer se esta instalação sobe, desce ou repete —'
      dizer '  e o instalador não adivinha.'
    fi
    detalhe "$marcador"
  elif [ -n "$sinais" ]; then
    dizer 'Não há marcador, mas há sinais de uma instalação anterior a esta versão:'
    printf '%s' "$sinais" | while IFS= read -r linha; do
      [ -n "$linha" ] && detalhe "  - ${linha}"
    done
    dizer ''
    dizer 'Migrar exige backup antes de qualquer remoção, e é o que vem a'
    dizer 'seguir: nada é apagado antes de o backup PROVAR que restaura.'
  else
    ok 'nenhuma instalação anterior encontrada'
  fi

  # A migração é oferecida antes de qualquer EFEITO: ela é o único caminho que
  # apaga, e apagar depois de já ter subido metade da coisa nova seria a pior
  # ordem possível. Só a resolução das imagens a precede, e de propósito — ela
  # não tem efeito nenhum, e é o que dá à pergunta as duas versões.
  # A oferta é ESPECÍFICA por relação de versão, e não mais uma pergunta cega.
  # O que NÃO muda em nenhum dos ramos: o caminho é sempre backup -> PROVAR ->
  # perguntar -> apagar -> instalar -> restaurar (ADR 0150), e é a PROVA no meio
  # que dá ao instalador o direito de apagar. Reinstalar do zero em vez de subir
  # por cima é a decisão do usuário desta entrega — `up` sobre volumes de outra
  # versão é o tipo de estrago que não avisa, e meia migração é pior que
  # nenhuma.
  MIGRAR_DE=''
  if [ -n "$marcador" ] || [ -n "$sinais" ]; then
    if [ -t 0 ]; then
      local pergunta resposta_migrar
      case "$RELACAO" in
        maior)
          pergunta="Atualizar ${VERSAO_INSTALADA} → ${VERSAO_A_INSTALAR}? A instalação atual é apagada e recriada do zero, depois do backup ser PROVADO. [S/n] "
          ;;
        igual)
          pergunta="Já é a ${VERSAO_INSTALADA}. Reinstalar do zero mesmo assim (backup, prova, apaga e recria)? [s/N] "
          ;;
        menor)
          pergunta="ATENÇÃO: rebaixar ${VERSAO_INSTALADA} → ${VERSAO_A_INSTALAR}. O dump restaurado vem de uma versão MAIS NOVA, e migração de banco não anda para trás — o restore pode falhar ou deixar o schema à frente do código. Continuar? [s/N] "
          ;;
        *)
          pergunta='Migrar esta instalação (backup, prova de restauração, e só então apagar)? [s/N] '
          ;;
      esac

      dizer ''
      printf '%s' "$pergunta"
      read -r resposta_migrar || resposta_migrar=''

      # Só o ramo `maior` tem default SIM, e é o único que pode: atualizar é o
      # que a pessoa veio fazer, e o passo é reversível pelo backup que acabou
      # de ser provado. Reinstalar a mesma versão e rebaixar exigem um "s"
      # digitado — o primeiro porque não tem ganho nenhum a oferecer, o segundo
      # porque pode não ter volta.
      if [ "$RELACAO" = 'maior' ]; then
        case "$resposta_migrar" in
          n|N|nao|NAO|não|NÃO) recusar 'instalar por cima de uma instalação existente não é oferecido: ou se migra, ou se para.' ;;
        esac
      else
        case "$resposta_migrar" in
          s|S|sim|SIM) ;;
          *) recusar 'instalar por cima de uma instalação existente não é oferecido: ou se migra, ou se para.' ;;
        esac
      fi

      migrar_instalacao_anterior "${BRABO_BACKUP_HOST_DIR:-${PWD}/brabo-backup-$(date -u +%Y%m%d%H%M%S)}"
    fi
  fi

  # Sem TTY: RELATA e sai bem. Mesmo desenho de `consentir-base.mjs` — o menu
  # do bootstrap roda os itens com stdin em /dev/null e por construção não
  # consegue perguntar, então relatar é a única coisa honesta a fazer.
  if [ ! -t 0 ]; then
    dizer ''
    dizer 'Sem terminal interativo: nada foi decidido nem gravado.'
    dizer 'Para instalar, rode num terminal:'
    dizer '  sh -c "$(curl -fsSL https://github.com/'"${REPO}"'/releases/latest/download/install.sh)"'
    exit 0
  fi

  dizer ''
  printf 'Gravar o marcador de instalação em %s? [s/N] ' "$(caminho_do_marcador)"
  local resposta
  read -r resposta || resposta=''
  case "$resposta" in
    s|S|sim|SIM) ;;
    *) dizer 'Nada foi gravado.'; exit 0 ;;
  esac

  consentir_base
  gerar_segredos

  # O `.env` nasce com modo 600 ANTES de receber conteúdo: criar com o umask
  # do usuário e apertar depois deixaria os segredos legíveis por uma janela,
  # e é justamente o arquivo que não pode ter essa janela.
  local env_arquivo="${PWD}/.env"
  : > "$env_arquivo"
  chmod 600 "$env_arquivo"
  cat > "$env_arquivo" <<ENV
# Gerado por install.sh em $(date -u +%Y-%m-%dT%H:%M:%SZ). Modo 600.
# Os cinco segredos de RN-114 e o NEO4J_PASSWORD foram gerados com
# \`openssl rand\`; guarde uma cópia antes de apagar este arquivo.
BRABO_API_IMAGE=${BRABO_API_IMAGE}
BRABO_ENGINE_IMAGE=${BRABO_ENGINE_IMAGE}
BRABO_WEB_IMAGE=${BRABO_WEB_IMAGE}
BRABO_BACKUP_IMAGE=${BRABO_BACKUP_IMAGE}
BRABO_PROJECTS_BASE=${BASE_DE_PROJETOS}
GIT_OAUTH_STATE_SECRET=${GIT_OAUTH_STATE_SECRET}
AUTH_JWT_SECRET=${AUTH_JWT_SECRET}
BRABO_SERVICE_TOKEN=${BRABO_SERVICE_TOKEN}
CREDENTIALS_MASTER_KEY=${CREDENTIALS_MASTER_KEY}
SECRET_KEY_BASE=${SECRET_KEY_BASE}
NEO4J_PASSWORD=${NEO4J_PASSWORD}
ENV
  ok ".env gravado com modo 600"

  dizer ''
  dizer "${C_BOLD}Subindo${C_RESET}"
  # `--wait` só prova o que tem healthcheck, e é por isso que ele basta aqui:
  # os serviços deste compose têm, e `api` depende de `migrate-api` com
  # `service_completed_successfully` — as migrações rodam na ordem, e a subida
  # espera por elas. Não há passo de migrate separado, e não deve haver: dois
  # lugares mandando migrar é a segunda fonte da mesma verdade.
  docker compose -f "$COMPOSE_DE_INSTALACAO" --env-file "$env_arquivo" up -d --wait \
    || recusar 'a subida falhou. Nada foi desfeito: `docker compose -f '"$COMPOSE_DE_INSTALACAO"' logs` mostra o quê.'

  # Perguntar antes de afirmar. `up --wait` já espera o healthcheck, mas quem
  # anuncia "instalado" tem de ter perguntado — é a régua que o
  # `reset-total.sh` aprendeu na marra (BRB-033).
  local api_port="${API_PORT:-3000}" engine_port="${ENGINE_PORT:-4000}"
  curl -fsS "http://localhost:${api_port}/health" >/dev/null \
    || recusar "a api subiu mas não respondeu em /health (porta ${api_port})."
  curl -fsS "http://localhost:${engine_port}/health" >/dev/null \
    || recusar "o engine subiu mas não respondeu em /health (porta ${engine_port})."
  ok 'api e engine respondendo'

  if [ -n "$MIGRAR_DE" ]; then
    restaurar_apos_migrar "$MIGRAR_DE"
  fi

  instalar_o_runner "$plataforma" "$TMP_VERIFICACAO"

  mkdir -p "$(dirname "$(caminho_do_marcador)")"
  cat > "$(caminho_do_marcador)" <<JSON
{
  "schemaVersion": ${MARCADOR_SCHEMA},
  "versao": "${VERSAO_A_INSTALAR}",
  "commit": "${COMMIT_A_INSTALAR}",
  "instaladoEm": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "plataforma": "${plataforma}",
  "fonte": "${FONTE}",
  "imagens": {
    "api": "${BRABO_API_IMAGE}",
    "engine": "${BRABO_ENGINE_IMAGE}",
    "web": "${BRABO_WEB_IMAGE}",
    "backup": "${BRABO_BACKUP_IMAGE}"
  },
  "caminhos": {
    "env": "${env_arquivo}",
    "baseDeProjetos": "${BASE_DE_PROJETOS}",
    "compose": "${PWD}/${COMPOSE_DE_INSTALACAO}"
  }
}
JSON
  ok "marcador gravado"

  dizer ''
  dizer "${C_BOLD}Pronto${C_RESET}"
  dizer "  Web:    http://localhost:${WEB_PORT:-8088}"
  dizer "  API:    http://localhost:${api_port}/health"
  dizer ''
  dizer "${C_BOLD}O que este instalador NÃO faz${C_RESET}"
  dizer 'Não sobe o broker de container: o serviço não existe no compose de'
  dizer 'instalação, porque a imagem dele não é publicada. Sem broker, projeto'
  dizer 'em modo Pasta montada não sobe container (ADR 0144); o modo Runner usa'
  dizer 'o Docker desta máquina e não depende dele.'
  dizer 'Não pareia o agente local com um projeto: o binário e a base ficam'
  dizer 'prontos aqui, mas a chave de dispositivo e o brabo-runner.config.json'
  dizer 'continuam vindo da tela do projeto (ADR 0118).'
}

main "$@"

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

MARCADOR_SCHEMA=1
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
    projetos="$(docker compose ls --all --format json 2>/dev/null \
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
  printf 'perguntar\tfaz\texige TTY; sem TTY relata e sai 0\n'
  printf 'gravar-marcador\tfaz\t%s\n' "$(caminho_do_marcador)"
  printf 'escolher-fonte\tfaz\t--source=ghcr (digest verificado) ou --source=local (bake, árvore limpa em tag)\n'
  printf 'gerar-segredos\tfaz\tos cinco de RN-114 mais NEO4J_PASSWORD, no .env com modo 600\n'
  printf 'subir-compose\tfaz\t%s, com --wait; as migrações vêm no encadeamento\n' "$COMPOSE_DE_INSTALACAO"
  printf 'conferir-saude\tfaz\t/health da api e do engine, antes de dizer que instalou\n'
  printf 'instalar-runner\tnao-nesta-versao\tsessão 7 da FASE 29 (ADR 0151)\n'
  printf 'migrar-instalacao-anterior\tnao-nesta-versao\tsessão 6 da FASE 29 (ADR 0152)\n'
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
verificar_a_si_mesmo() {
  local plataforma="$1" tmp meu_hash
  tmp="$(mktemp -d)"
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

  rm -rf "$tmp"
  trap - EXIT
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

  dizer 'Construindo as quatro imagens (docker buildx bake)…'
  docker buildx bake -f docker-bake.hcl || recusar 'o build local falhou.'

  BRABO_API_IMAGE='brabo-api:prod'
  BRABO_ENGINE_IMAGE='brabo-engine:prod'
  BRABO_WEB_IMAGE='brabo-web:prod'
  BRABO_BACKUP_IMAGE='brabo-backup:prod'
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

  dizer ''
  dizer "${C_BOLD}O que já existe nesta máquina${C_RESET}"
  local marcador sinais
  marcador="$(ler_marcador)"
  sinais="$(detectar_por_sinais)"

  if [ -n "$marcador" ]; then
    ok "marcador de instalação: $(caminho_do_marcador)"
    detalhe "$marcador"
  elif [ -n "$sinais" ]; then
    dizer 'Não há marcador, mas há sinais de uma instalação anterior a esta versão:'
    printf '%s' "$sinais" | while IFS= read -r linha; do
      [ -n "$linha" ] && detalhe "  - ${linha}"
    done
    dizer ''
    dizer 'Migrar uma instalação assim exige backup antes de qualquer remoção — é'
    dizer 'a sessão 6 da FASE 29, e este instalador ainda não a faz.'
  else
    ok 'nenhuma instalação anterior encontrada'
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

  mkdir -p "$(dirname "$(caminho_do_marcador)")"
  cat > "$(caminho_do_marcador)" <<JSON
{
  "schemaVersion": ${MARCADOR_SCHEMA},
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
  dizer "${C_BOLD}O que este instalador ainda NÃO faz${C_RESET}"
  dizer 'Instalar o runner (sessão 7) e migrar uma instalação anterior (sessão 6)'
  dizer 'ainda não acontecem. Ele para aqui de propósito — e diz isso, em vez de'
  dizer 'terminar em silêncio e deixar você procurando o que não aconteceu.'
}

main "$@"

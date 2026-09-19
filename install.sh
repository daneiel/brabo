#!/usr/bin/env bash
# Instalador do Brabo.
#
# USO — e a forma importa:
#
#   curl -fsSLO https://github.com/daneiel/brabo/releases/latest/download/install.sh && bash install.sh
#
# BAIXAR e rodar um ARQUIVO, com `bash`. As duas formas que parecem equivalentes
# não são, e as duas são RECUSADAS com nome:
#
#   - `curl … | sh`: com o script chegando pelo pipe, o `stdin` do processo É o
#     download, e qualquer `read` para perguntar alguma coisa lê bytes do
#     próprio script ou encontra EOF. Um instalador que não pode perguntar teria
#     de escolher sozinho onde criar pastas no computador de alguém — e a régua
#     deste produto é a oposta (RN-511, o passo de consentimento do
#     `pnpm bootstrap`, que sem TTY relata em vez de consentir).
#   - `sh -c "$(curl …)"`, que era a forma DOCUMENTADA até a AT-083: ali o `$0`
#     é o nome do shell, não um arquivo, e a autoverificação (o hash DESTE
#     arquivo contra o manifesto assinado, RN-526) não tem o que medir. Não há
#     porta para pular essa verificação, e não vai haver (ADR 0150) — a saída é
#     existir um arquivo. Com `dash` como `sh` (Debian/Ubuntu) ela morria antes
#     ainda, no `set -o pipefail`.
#
# O QUE ELE FAZ, em ordem: verifica a própria origem contra o manifesto
# assinado da Release, baixa e verifica contra o MESMO manifesto os arquivos que
# sobem a instalação (o compose e o que ele monta), resolve as imagens, detecta
# o que já existe na máquina,
# migra (com backup PROVADO) se houver instalação anterior, sobe o compose,
# instala o agente local e FECHA a instalação — cria a primeira conta, registra
# a chave de dispositivo desta máquina e sobe o agente como serviço. Cada passo
# diz o que fez; o que não deu certo aparece nomeado no fim, nunca em silêncio.
#
# O QUE ELE NUNCA FAZ: gravar a senha que você digitar (ela é lida sem eco,
# usada e descartada), apagar sua base de projetos ou sua pasta de espelho,
# apagar qualquer coisa sem um backup que ele mesmo provou restaurar, ligar
# SMTP por conta própria, pedir credencial de LLM, ou ligar o broker de
# container sem perguntar (ele recebe o socket do Docker desta máquina).
#
# MODOS DE IMPRESSÃO (não executam nada, não perguntam nada):
#
#   install.sh --print-state   estado detectado, em TSV
#   install.sh --print-plan    o que ele faria, em TSV
#
# Eles existem pelo mesmo motivo do `--print-commands` do `bootstrap.sh`: a
# parte que erra na prática é a DECISÃO (o que foi detectado, o que seria
# apagado), e ela se testa sem TTY e sem efeito — ver `install.spec.ts`.

# Este bloco é POSIX e vem ANTES de tudo, porque é o único que roda sob
# qualquer `sh`: o `dash` do Debian/Ubuntu morria na linha seguinte, no
# `set -o pipefail`, com um "Illegal option" que não diz o que fazer.
if [ -z "${BASH_VERSION:-}" ]; then
  printf '%s\n' '✗ este instalador é um script de bash, e está rodando sob outro shell. Baixe o arquivo e rode com bash:' >&2
  printf '%s\n' '    curl -fsSLO https://github.com/daneiel/brabo/releases/latest/download/install.sh && bash install.sh' >&2
  exit 1
fi

set -euo pipefail

# O arquivo que o bash está lendo, capturado no NÍVEL DE CIMA — dentro de uma
# função, `BASH_SOURCE[0]` é outra coisa. Vazio quando não há arquivo nenhum
# (`bash -c "$(curl …)"`, `curl … | bash`): é o que `exigir_o_proprio_arquivo`
# usa para não confundir um `$0` que por acaso é um arquivo (`/bin/bash -c`
# deixa `$0=/bin/bash`, que existe e é legível) com o próprio instalador.
ORIGEM_DO_SCRIPT="${BASH_SOURCE[0]:-}"

# --------------------------------------------------------------------------
# Constantes
# --------------------------------------------------------------------------

REPO='daneiel/brabo'

# O `cosign` que verifica a assinatura precisa ele mesmo de procedência, senão
# a cadeia só sobe um degrau. Versão PINADA e conferida por `conferir_hash`
# contra os valores abaixo — que são os do `cosign_checksums.txt` oficial da
# release v3.1.3, copiados aqui de propósito: quem confia neste script o
# bastante para executá-lo confia no hash que ele carrega, e a cadeia não fica
# mais frágil do que o elo que a inicia. É o mesmo padrão que o `ci.yml` já
# aplica a todo binário de terceiro.
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

# Subiu para 3 quando o marcador ganhou o `ownerEmail` (RN-547) — pelo mesmo
# motivo que subiu para 2 ao ganhar a `versao`: um sobe sem o outro e um
# marcador novo passa por antigo. A AUSÊNCIA de `ownerEmail` num marcador de
# schema 3 é estado normal (migração, ou o passo de conta recusado), e nada
# deriva comportamento dela.
MARCADOR_SCHEMA=3

# Onde a Release desta instalação publica o que ele baixa. As descargas que já
# existiam escrevem a URL inteira; os arquivos da instalação (ADR 0160) passam
# por esta, porque são quatro no mesmo laço.
URL_DA_RELEASE="https://github.com/${REPO}/releases/latest/download"

# A forma de rodar que este script ENSINA — nas recusas e no relato sem TTY. Uma
# constante, para que a frase que manda a pessoa rodar de novo não possa
# divergir da que o cabeçalho e o runbook documentam (AT-083: ela ensinava a
# forma quebrada).
COMO_RODAR="curl -fsSLO ${URL_DA_RELEASE}/install.sh && bash install.sh"

# Os caminhos ABSOLUTOS das cópias verificadas, preenchidos por
# `materializar_os_arquivos_da_instalacao` — e VAZIOS até lá, de propósito. Até
# o ADR 0160 este era a constante 'docker/docker-compose.install.yml', relativa
# ao diretório de onde o script rodava e apontando para um arquivo que nada
# trazia: numa pasta vazia a subida morria DEPOIS de o `.env` já estar gravado.
# Vazio, um uso antes da hora falha no `docker compose -f ''` em vez de ler em
# silêncio um arquivo que ninguém verificou.
COMPOSE_DE_INSTALACAO=''
PROVA_DE_RESTAURACAO=''

# O cabeçalho das rotas internas da api — o mesmo `CABECALHO_SERVICE_TOKEN` de
# `apps/api/src/interfaces/http/auth/engine-service.guard.ts`. É por ele, e só
# por ele, que este script prova controle da MÁQUINA às duas rotas que usa.
CABECALHO_SERVICE_TOKEN='x-brabo-service-token'

# Fonte das imagens. `ghcr` é o default: as cinco publicadas, por DIGEST,
# com a assinatura verificada (ADR 0149). `local` constrói do checkout, e
# exige árvore limpa em tag — imagem construída de árvore suja não é a versão
# que ela diz ser.
FONTE='ghcr'

# Preenchidas por `instalar_o_runner`, e VAZIAS quando a Release não publica o
# binário desta plataforma. Declaradas aqui porque `set -u` não perdoa: o
# fechamento da instalação as lê para decidir se há binário com que trabalhar.
RUNNER_BIN=''
PASTA_DE_CONFIG=''

# O broker de container (ADR 0162), preenchidas por `consentir_broker`.
# `BROKER_LIGADO` é `sim` só com um "s" digitado E o gid medido — nunca por
# default, nunca sem terminal. As outras duas são o que ele mediu, e vazias
# enquanto ele não mediu: é por elas que `escrever_env` sabe o que gravar.
BROKER_LIGADO='nao'
DOCKER_GID_MEDIDO=''
RAIZ_GERENCIADA_NO_HOST=''

# O volume da pasta GERENCIADA (modo `container`), com o prefixo do projeto
# compose (`name: brabo` no compose de instalação). É o único nome que este
# script precisa saber do layout do Docker: dele sai a raiz que o broker monta.
VOLUME_DA_PASTA_GERENCIADA='brabo_project_workspaces'

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
# Hash — UMA ferramenta, resolvida ANTES de baixar qualquer coisa
# --------------------------------------------------------------------------

# O defeito que isto fecha, medido no E2E da v6.1.0 (job `install.sh
# (macos-14)`): o script chamava `sha256sum` nos cinco pontos de verificação e
# não tinha alternativa nenhuma. O macOS não traz `sha256sum` — traz
# `shasum -a 256` —, então `command not found` fazia a comparação falhar e a
# pessoa lia *"o cosign baixado NÃO bate com o hash pinado neste script. Isso
# não é um aviso: pare e investigue."* Dois defeitos num: a instalação era
# impossível na plataforma que este mesmo script promete suportar (há hash de
# cosign `darwin-*` logo acima), e a mensagem mandava caçar uma adulteração que
# não houve — o que ensina a ignorar a frase no dia em que ela for verdade.
#
# Preenchida por `exigir_ferramenta_de_hash`, e VAZIA até lá. Um uso antes da
# hora cai na cláusula `*` de `hash_sha256`, que recusa nomeando o defeito como
# sendo DESTE script — nunca da máquina de quem instala.
FERRAMENTA_DE_HASH=''

# Roda ANTES do primeiro download, nunca no meio de uma verificação: a máquina
# que não tem com que conferir não deve chegar a ter o que conferir.
exigir_ferramenta_de_hash() {
  if command -v sha256sum >/dev/null 2>&1; then
    FERRAMENTA_DE_HASH='sha256sum'
  elif command -v shasum >/dev/null 2>&1; then
    FERRAMENTA_DE_HASH='shasum'
  else
    recusar 'não achei sha256sum nem shasum nesta máquina, e sem um dos dois este instalador não tem como conferir o que baixa. Isto é FERRAMENTA faltando, não sinal de adulteração — nada foi baixado. No macOS o shasum vem com o sistema (verifique o PATH); no Linux, sha256sum vem no coreutils.'
  fi
}

# Ecoa só o hash, em uma linha. As duas ferramentas imprimem
# `<hash>  <arquivo>`, então o corte é o mesmo — e é feito com expansão de
# parâmetro, não com `cut`, para não somar uma terceira dependência ao caminho
# que existe justamente porque uma faltou.
# O `|| falha_ao_calcular_hash` em `hash_sha256` é o que impede o `set -e` de
# derrubar a substituição de comando CALADO (AT-083): sem ele, uma ferramenta
# que não consegue ler o arquivo matava o script com o erro cru dela, antes de
# qualquer recusa. E a recusa é a TERCEIRA, diferente das duas de
# `conferir_hash`: não faltou ferramenta, e não há hash divergente — não houve
# o que comparar.
falha_ao_calcular_hash() {
  recusar "não consegui calcular o sha256 de '${1}' — ${FERRAMENTA_DE_HASH} falhou ao ler o arquivo. Isto não é sinal de adulteração: não houve o que comparar."
}

hash_sha256() {
  local saida
  case "$FERRAMENTA_DE_HASH" in
    sha256sum) saida="$(sha256sum "$1")" || falha_ao_calcular_hash "$1" ;;
    shasum)    saida="$(shasum -a 256 "$1")" || falha_ao_calcular_hash "$1" ;;
    *) recusar 'hash pedido antes de a ferramenta ter sido resolvida — isto é defeito deste script, não da sua máquina.' ;;
  esac
  printf '%s\n' "${saida%% *}"
}

# As DUAS recusas são diferentes, e a diferença É o ponto: ferramenta que falta
# é dependência do sistema operacional e se resolve instalando; hash que não
# bate é incidente e se resolve PARANDO. Cada chamador passa o próprio motivo
# porque cada um nomeia um arquivo diferente — o texto nunca é genérico.
#
# Comparação de STRING, e não `sha256sum -c`, para os dois lados: `shasum`
# aceita `-c`, mas provar o caminho do manifesto em duas ferramentas custaria
# mais que provar uma igualdade. A normalização para minúsculas fica aqui, num
# lugar só, porque um manifesto válido pode trazer o hash em maiúsculas.
conferir_hash() {
  local arquivo="$1" esperado="$2" motivo="$3" obtido
  obtido="$(hash_sha256 "$arquivo" | tr '[:upper:]' '[:lower:]')"
  esperado="$(printf '%s' "$esperado" | tr '[:upper:]' '[:lower:]')"
  [ "$esperado" = "$obtido" ] || recusar "$motivo"
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
  printf 'conferir-hash\tfaz\tsha256sum ou shasum -a 256, resolvido ANTES de baixar; faltando os dois, recusa NOMEANDO a ferramenta e nunca acusa adulteração\n'
  printf 'verificar-origem\tfaz\to checksums.txt assinado da Release, e o hash deste próprio arquivo nele\n'
  printf 'verificar-arquivos-da-instalacao\tfaz\to compose e o que ele monta, baixados da Release e conferidos no mesmo manifesto ANTES de qualquer pergunta\n'
  printf 'usar-arquivo-nao-verificado\tnunca\tum docker/ que já esteja na pasta é substituído pela cópia verificada, nunca lido no lugar dela\n'
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
  printf 'subir-compose\tfaz\tdocker/docker-compose.install.yml (a cópia verificada, sob a pasta de onde o script roda), com --wait; as migrações vêm no encadeamento\n'
  printf 'conferir-saude\tfaz\t/health da api e do engine, antes de dizer que instalou\n'
  printf 'consentir-base\tfaz\tUMA base para os dois lados: .env do servidor e runner.json do agente\n'
  printf 'ligar-broker\tpergunta\tdefault NÃO; sim mede o gid do socket DE DENTRO de um container e grava COMPOSE_PROFILES, BROKER_URL e DOCKER_GID no .env; sem TTY fica desligado\n'
  printf 'ligar-broker-sem-perguntar\tnunca\to broker recebe o socket do Docker desta máquina (ADR 0162)\n'
  printf 'instalar-runner\tfaz\tbinário verificado contra o manifesto assinado, instalado com bit de execução\n'
  printf 'criar-primeira-conta\tpergunta\te-mail e senha no TTY, sem eco; a conta nasce verificada e o passo se cala se já houver gente\n'
  printf 'gravar-senha\tnunca\tnem no .env, nem no marcador, nem em log — lida, usada e descartada\n'
  printf 'registrar-chave-de-maquina\tfaz\ta PÚBLICA viaja; o par é gerado nesta máquina e a privada fica aqui\n'
  printf 'instalar-servico-do-agente\tfaz\tservice install --machine; unit por projeto instalada é RECUSA relatada, nunca engolida\n'
  printf 'ligar-smtp\tnunca\tMAIL_TRANSPORT=log continua o default; a instalação deixa de DEPENDER de e-mail para fechar\n'
  printf 'pedir-credencial-de-llm\tnunca\té decisão de quem vai gastar\n'
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

  conferir_hash "$destino" "$esperado" \
    "o cosign baixado NÃO bate com o hash pinado neste script. Isso não é um aviso: pare e investigue."
  chmod +x "$destino"
}

# O defeito que isto fecha (AT-083, instalando a v6.1.0 numa máquina limpa):
# a forma que o runbook documentava, `sh -c "$(curl …)"`, roda o script sem
# ARQUIVO — o `$0` é o nome do shell —, e a autoverificação logo abaixo fazia
# `sha256sum bash`. O `set -euo pipefail` derrubava a substituição de comando
# antes de qualquer recusa, e a pessoa via só o erro cru da ferramenta de hash.
# A verificação NÃO muda e NÃO ganha porta de pular (ADR 0150): o que muda é
# que a falta do arquivo é dita pelo nome, com a forma certa, e ANTES de baixar
# qualquer coisa.
exigir_o_proprio_arquivo() {
  if [ -z "$ORIGEM_DO_SCRIPT" ] || [ ! -f "$0" ] || [ ! -r "$0" ]; then
    recusar "este instalador precisa rodar de um ARQUIVO, e está rodando sem um (por sh -c/bash -c, ou por pipe). Ele confere o próprio hash contra o manifesto assinado da Release antes de fazer qualquer coisa, e sem arquivo não há o que conferir — nada foi baixado nem gravado. Baixe e rode:
    ${COMO_RODAR}"
  fi
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

  # Nunca chega aqui sem arquivo: `exigir_o_proprio_arquivo` recusou antes do
  # primeiro download. Se chegar, `hash_sha256` recusa NOMEADO em vez de o
  # `set -e` derrubar a substituição calado (AT-083).
  meu_hash="$(hash_sha256 "$0")"
  if ! grep -qi "^${meu_hash}  install.sh$" "${tmp}/checksums.txt"; then
    recusar "o hash deste arquivo não está no manifesto assinado. Ou ele foi alterado, ou não é o instalador desta Release."
  fi
  ok 'este arquivo é o que a Release publicou'
}

# --------------------------------------------------------------------------
# Os arquivos que sobem a instalação — assets da Release, verificados (RN-570)
# --------------------------------------------------------------------------

# O defeito que isto fecha, medido pela AT-008 (RN-549): o script subia a pilha
# com um compose que NÃO trazia. O caminho era relativo ao diretório de onde ele
# rodava, o arquivo não era asset da Release, não entrava no manifesto e não era
# baixado em lugar nenhum — e o compose ainda bind-montava mais dois. Numa pasta
# vazia, a subida morria em "no such file or directory" DEPOIS de o `.env` com
# os segredos estar gravado.
#
# A saída decidida (ADR 0160) foi publicá-los como assets e pô-los no MESMO
# `checksums.txt` assinado que já cobre este script e o binário do runner. A
# alternativa — clonar o repositório na tag — foi recusada: trocaria a cadeia
# de assinatura por confiança no transporte do `git`, e acrescentaria uma
# dependência que a máquina limpa pode não ter.
#
# asset da Release -> caminho sob a pasta da instalação. A MESMA tabela de
# `scripts/ci/assets-do-instalador.ts`, que é quem os publica; o spec daquele
# arquivo lê este `case` e reprova se as duas divergirem. `case` e não array
# associativo pelo motivo de `sha_do_cosign`: o bash 3.2 do macOS.
ASSETS_DO_INSTALADOR='brabo-install-compose.yml brabo-install-postgres-init.sql brabo-install-ollama-pull-models.sh brabo-install-backup-test-restore.sh'

destino_do_asset_do_instalador() {
  case "$1" in
    brabo-install-compose.yml)            echo 'docker/docker-compose.install.yml' ;;
    brabo-install-postgres-init.sql)      echo 'docker/postgres/init.sql' ;;
    brabo-install-ollama-pull-models.sh)  echo 'docker/ollama/pull-models.sh' ;;
    brabo-install-backup-test-restore.sh) echo 'docker/backup/test-restore-compose.sh' ;;
    *) return 1 ;;
  esac
}

# A pasta TEMPORÁRIA onde as cópias verificadas esperam para ser usadas.
# Preenchida só quando os quatro passaram.
ARQUIVOS_VERIFICADOS=''

# Baixa cada asset e confere o sha256 contra o `checksums.txt` que
# `verificar_a_si_mesmo` JÁ verificou — o mesmo arquivo, nunca um segundo
# download, pelo motivo que aquela função escreve. Roda ANTES de qualquer
# pergunta e de qualquer gravação: a falha que isto substitui aparecia depois do
# `.env`, e uma recusa aqui deixa a máquina exatamente como estava.
#
# As três recusas são NOMEADAS e distintas, porque pedem ações diferentes: o
# asset não publicado (a Release é anterior ao ADR 0160, ou saiu pela metade), o
# manifesto que não o cobre, e o hash que não bate (que é incidente). Nenhuma
# delas cai num arquivo do diretório atual: não há caminho de volta para o
# relativo, e é isso que o spec do E2E cobra.
baixar_e_verificar_os_arquivos_da_instalacao() {
  local url="$1" tmp="$2" pasta asset esperado
  pasta="${tmp}/arquivos-da-instalacao"
  mkdir -p "$pasta"

  for asset in $ASSETS_DO_INSTALADOR; do
    if ! curl -fsSL -o "${pasta}/${asset}" "${url}/${asset}"; then
      recusar "a Release não publica ${asset}, e sem ele a instalação não sobe. Nada foi gravado — e este script não usa, no lugar dele, um arquivo que já esteja nesta pasta."
    fi

    # `awk` com igualdade EXATA de campo, e não `grep`: o nome tem pontos, que
    # num padrão casam qualquer caractere. O `*` é o modo binário do
    # `sha256sum`, que a esteira não usa mas um manifesto válido pode ter.
    esperado="$(awk -v nome="$asset" '$2 == nome || $2 == "*" nome { print tolower($1); exit }' "${tmp}/checksums.txt")"
    [ -n "$esperado" ] \
      || recusar "o manifesto assinado não cobre ${asset} — recusa, não aviso. Nada foi gravado."
    conferir_hash "${pasta}/${asset}" "$esperado" \
      "${asset} NÃO bate com o manifesto assinado. Nada foi gravado. Isso não é um aviso: pare e investigue."
  done

  ARQUIVOS_VERIFICADOS="$pasta"
  ok 'arquivos da instalação verificados contra o manifesto assinado'
}

# Põe as cópias verificadas sob a pasta da instalação — a mesma do `.env` — e
# preenche os dois caminhos ABSOLUTOS que o resto do script usa. Chamada no
# primeiro instante em que um deles é preciso (a migração, ou a subida), nunca
# antes: o caminho sem TTY promete que nada foi gravado.
#
# O que já estiver no destino é SUBSTITUÍDO, nunca lido: numa atualização é o
# compose da versão anterior, e subir a nova com ele seria o `up` sobre outra
# versão que a migração existe para evitar. `rm` antes de copiar, para que um
# symlink no destino não leve a escrita para outro lugar.
ARQUIVOS_MATERIALIZADOS_EM=''
materializar_os_arquivos_da_instalacao() {
  local raiz="$1" asset relativo destino
  if [ "$ARQUIVOS_MATERIALIZADOS_EM" = "$raiz" ]; then return 0; fi
  [ -n "$ARQUIVOS_VERIFICADOS" ] \
    || recusar 'os arquivos da instalação não foram verificados — este script não sobe compose que não conferiu.'

  for asset in $ASSETS_DO_INSTALADOR; do
    relativo="$(destino_do_asset_do_instalador "$asset")" \
      || recusar "sem destino conhecido para ${asset}."
    destino="${raiz}/${relativo}"
    mkdir -p "$(dirname "$destino")" || recusar "não consegui criar $(dirname "$destino")."
    if [ -f "$destino" ] && [ ! -L "$destino" ] \
      && [ "$(hash_sha256 "$destino")" != "$(hash_sha256 "${ARQUIVOS_VERIFICADOS}/${asset}")" ]; then
      detalhe "  ${relativo}: o que estava aqui é substituído pela cópia verificada"
    fi
    rm -f "$destino"
    cp "${ARQUIVOS_VERIFICADOS}/${asset}" "$destino" || recusar "não consegui gravar ${destino}."
    chmod 0644 "$destino"
  done

  COMPOSE_DE_INSTALACAO="${raiz}/$(destino_do_asset_do_instalador brabo-install-compose.yml)"
  PROVA_DE_RESTAURACAO="${raiz}/$(destino_do_asset_do_instalador brabo-install-backup-test-restore.sh)"
  ARQUIVOS_MATERIALIZADOS_EM="$raiz"
  ok "arquivos da instalação gravados em ${raiz}/docker (as cópias verificadas)"
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
#
# E todo base64 passa por `segredo_base64`, que tira as quebras de linha. O
# `openssl rand -base64` QUEBRA a saída a cada 64 caracteres: 32 bytes dão 44 e
# cabem numa linha, mas os 64 bytes do SECRET_KEY_BASE dão 88, em DUAS — e o
# `.env` saía com uma segunda linha solta (AT-083). Medido em 100 gerações: o
# Compose recusou 49 com "unexpected character in variable name", e as outras
# 51 ele ACEITOU — com o segredo cortado em 64 caracteres e uma variável de
# lixo a mais. Por isso o spec (`install-env.spec.ts`) não pergunta só se o
# arquivo parseia: pergunta se cada valor chega INTEIRO ao outro lado.
segredo_base64() {
  openssl rand -base64 "$1" | tr -d '\n'
}

gerar_segredos() {
  GIT_OAUTH_STATE_SECRET="${GIT_OAUTH_STATE_SECRET:-$(segredo_base64 32)}"
  AUTH_JWT_SECRET="${AUTH_JWT_SECRET:-$(segredo_base64 32)}"
  BRABO_SERVICE_TOKEN="${BRABO_SERVICE_TOKEN:-$(segredo_base64 32)}"
  CREDENTIALS_MASTER_KEY="${CREDENTIALS_MASTER_KEY:-$(segredo_base64 32)}"
  SECRET_KEY_BASE="${SECRET_KEY_BASE:-$(segredo_base64 64)}"
  NEO4J_PASSWORD="${NEO4J_PASSWORD:-$(openssl rand -hex 24)}"
}

# O `.env` da instalação, numa função e não no corpo de `main`, para que o
# spec (`install-env.spec.ts`) grave o MESMO arquivo que a instalação grava e o
# passe pelo parser do Compose — a classe de defeito da AT-083 (um valor que o
# `.env` não comporta) só se prova contra quem vai ler o arquivo.
#
# O arquivo nasce com modo 600 ANTES de receber conteúdo: criar com o umask
# do usuário e apertar depois deixaria os segredos legíveis por uma janela,
# e é justamente o arquivo que não pode ter essa janela.
escrever_env() {
  local env_arquivo="$1"
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
BRABO_BROKER_IMAGE=${BRABO_BROKER_IMAGE}
BRABO_PROJECTS_BASE=${BASE_DE_PROJETOS}
GIT_OAUTH_STATE_SECRET=${GIT_OAUTH_STATE_SECRET}
AUTH_JWT_SECRET=${AUTH_JWT_SECRET}
BRABO_SERVICE_TOKEN=${BRABO_SERVICE_TOKEN}
CREDENTIALS_MASTER_KEY=${CREDENTIALS_MASTER_KEY}
SECRET_KEY_BASE=${SECRET_KEY_BASE}
NEO4J_PASSWORD=${NEO4J_PASSWORD}
ENV
  escrever_env_do_broker "$env_arquivo"
}

# O bloco do broker, SEMPRE junto — as linhas não existem uma sem a outra:
# `COMPOSE_PROFILES` sem `BROKER_URL` sobe um broker que ninguém chama, e
# `BROKER_URL` sem o profile aponta a api para um serviço que não sobe. E sem o
# gid MEDIDO não há bloco nenhum: o default 999 do compose é palpite, e este
# script não grava palpite (ADR 0162). A recusa aqui é defeito DESTE script —
# `consentir_broker` só liga depois de medir.
escrever_env_do_broker() {
  local env_arquivo="$1"
  if [ "$BROKER_LIGADO" != 'sim' ]; then
    cat >> "$env_arquivo" <<'ENV'
# Broker de container: DESLIGADO (a pergunta do instalador). Para ligar depois,
# ver docs/runbook.md, "Broker de container na instalação".
ENV
    return 0
  fi
  case "$DOCKER_GID_MEDIDO" in
    ''|*[!0-9]*) recusar 'o broker foi ligado sem o gid do socket medido — isto é defeito deste script, não da sua máquina.' ;;
  esac
  cat >> "$env_arquivo" <<ENV
# Broker de container: LIGADO com consentimento no instalador (ADR 0162).
COMPOSE_PROFILES=container-broker
BROKER_URL=http://broker:8090
DOCKER_GID=${DOCKER_GID_MEDIDO}
PROJECT_WORKSPACES_HOST_ROOT=${RAIZ_GERENCIADA_NO_HOST}
ENV
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
  for alvo in api engine web backup broker; do
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

  dizer 'Construindo as cinco imagens (docker buildx bake)…'
  docker buildx bake -f docker-bake.hcl || recusar 'o build local falhou.'

  BRABO_API_IMAGE='brabo-api:prod'
  BRABO_ENGINE_IMAGE='brabo-engine:prod'
  BRABO_WEB_IMAGE='brabo-web:prod'
  BRABO_BACKUP_IMAGE='brabo-backup:prod'
  BRABO_BROKER_IMAGE='brabo-broker:prod'
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

# --------------------------------------------------------------------------
# O broker de container — perguntado, nunca ligado por conta própria (ADR 0162)
# --------------------------------------------------------------------------

# O gid do socket VISTO DE DENTRO de um container, que é o que o `group_add` do
# compose precisa. Medido com a PRÓPRIA imagem do broker (a mesma que vai subir;
# nenhuma imagem de terceiro entra nisto), sem rede e com rootfs read-only.
#
# Duas escolhas que parecem detalhe e não são:
#   - `--mount type=bind` e não `-v`: com `-v`, uma origem que não existe é
#     CRIADA como pasta vazia no host, pelo root do daemon — e o `stat` diria
#     "directory" sobre uma pasta que este script acabou de pôr ali. `--mount`
#     recusa, e a recusa é a resposta certa (Docker rootless ou remoto: o
#     socket não está onde o compose o monta).
#   - de DENTRO, e não `stat` no host: no Docker Desktop o socket do host é do
#     usuário e o que o container vê é outro arquivo, dentro da VM. O número do
#     host seria plausível e errado.
#
# O resultado vai para globais (`DOCKER_GID_MEDIDO`, `MOTIVO_DA_MEDICAO`) pelo
# motivo de `RESPOSTA_VEREDITO`: `$( )` perderia uma das duas.
MOTIVO_DA_MEDICAO=''
medir_gid_do_socket() {
  local saida tipo gid
  DOCKER_GID_MEDIDO=''
  MOTIVO_DA_MEDICAO=''
  if ! saida="$(docker run --rm --network none --read-only --entrypoint stat \
      --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
      "$BRABO_BROKER_IMAGE" -c '%F %g' /var/run/docker.sock 2>&1)"; then
    MOTIVO_DA_MEDICAO="$saida"
    return 1
  fi
  # A última linha: um `docker run` que precisou puxar a imagem escreve o
  # progresso do pull antes, na mesma saída.
  saida="$(printf '%s\n' "$saida" | tail -n1)"
  tipo="${saida% *}"
  gid="${saida##* }"
  if [ "$tipo" != 'socket' ]; then
    MOTIVO_DA_MEDICAO="/var/run/docker.sock, visto de dentro de um container, não é um socket (é: ${tipo:-nada})"
    return 1
  fi
  case "$gid" in
    ''|*[!0-9]*)
      MOTIVO_DA_MEDICAO="o gid lido não é um número: '${gid}'"
      return 1
      ;;
  esac
  DOCKER_GID_MEDIDO="$gid"
  return 0
}

# A raiz da pasta GERENCIADA no HOST. No compose de instalação ela é o volume
# nomeado, e o layout do driver `local` põe o conteúdo em
# `<DockerRootDir>/volumes/<nome>/_data` — é um CÁLCULO, e por isso
# `conferir_o_broker` o compara com o `Mountpoint` que o daemon devolve depois
# da subida. Não conseguir calcular não recusa nada: só o modo `container` fica
# sem raiz, e o broker recusa `start` dele nomeando a variável.
calcular_raiz_gerenciada() {
  local raiz_do_docker
  raiz_do_docker="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
  case "$raiz_do_docker" in
    /*) RAIZ_GERENCIADA_NO_HOST="${raiz_do_docker%/}/volumes/${VOLUME_DA_PASTA_GERENCIADA}/_data" ;;
    *)  RAIZ_GERENCIADA_NO_HOST='' ;;
  esac
}

# A pergunta. Default NÃO, e só `s`/`sim` liga: o que está em jogo é um serviço
# desta instalação falar com o Docker desta máquina, e isso não se liga por um
# Enter distraído. Sem terminal não há pergunta, e o script DIZ que ficou
# desligado em vez de decidir em silêncio (a régua do `consentir-base.mjs`).
consentir_broker() {
  dizer ''
  dizer "${C_BOLD}O broker de container${C_RESET}"
  dizer 'Projeto em modo Container ou Pasta montada executa dentro de um container,'
  dizer 'e quem sobe esse container é o broker — um serviço desta instalação que'
  dizer 'recebe o socket do Docker DESTA máquina. Quem comanda o broker comanda o'
  dizer 'seu Docker, e o Docker desta máquina é equivalente a root nela.'
  dizer 'O que o contém: não publica porta, só a api o alcança (numa rede sem'
  dizer 'internet), exige o token de serviço, e só sabe cinco operações sobre o'
  dizer 'container de UM projeto, compostas a partir do que o Arquiteto decidiu —'
  dizer 'não existe pedido que ligue privileged, rede do host ou uma pasta livre.'
  dizer 'Sem ele, projeto Container e Pasta montada não executam; o modo Runner usa'
  dizer 'o Docker desta máquina pelo agente local e não depende dele.'
  dizer ''

  if [ ! -t 0 ]; then
    dizer 'Não há terminal para perguntar: o broker fica DESLIGADO.'
    BROKER_LIGADO='nao'
    return 0
  fi

  printf 'Ligar o broker de container? [s/N] '
  local resposta; read -r resposta || resposta=''
  case "$resposta" in
    s|S|sim|SIM) ;;
    *)
      BROKER_LIGADO='nao'
      ok 'broker de container: desligado (dá para ligar depois — docs/runbook.md)'
      return 0
      ;;
  esac

  dizer 'Medindo o grupo do socket do Docker, de dentro de um container…'
  if ! medir_gid_do_socket; then
    recusar "não consegui medir o grupo do socket do Docker, e sem ele o broker não abre o socket — este script não grava um palpite no lugar. O que o Docker disse: ${MOTIVO_DA_MEDICAO}
  Nada foi gravado. Rode o instalador de novo e responda NÃO para instalar sem o broker, ou resolva o que está acima."
  fi
  ok "grupo do socket, visto de dentro de um container: ${DOCKER_GID_MEDIDO}"

  calcular_raiz_gerenciada
  if [ -n "$RAIZ_GERENCIADA_NO_HOST" ]; then
    ok "raiz da pasta gerenciada no host: ${RAIZ_GERENCIADA_NO_HOST} (conferida depois da subida)"
  else
    pendencia 'a raiz da pasta gerenciada: `docker info` não disse onde o Docker guarda os volumes. O broker está ligado para Pasta montada; para o modo Container, preencha PROJECT_WORKSPACES_HOST_ROOT no .env (ver docs/runbook.md).'
  fi

  BROKER_LIGADO='sim'
  ok 'broker de container: ligado'
}

# Depois da subida, com a pilha de pé: o broker respondeu ao healthcheck (o
# `up --wait` esperou por ele), mas quem anuncia que ele serve tem de perguntar
# as duas coisas que o healthcheck não pergunta — se a API o alcança pela rede
# interna, e se a raiz calculada é mesmo onde o daemon guardou o volume. Nenhuma
# das duas recusa: a pilha está de pé, e o que não confere vira pendência
# NOMEADA, com o valor certo quando ele é conhecido.
conferir_o_broker() {
  local env_arquivo="$1" montado
  [ "$BROKER_LIGADO" = 'sim' ] || return 0

  if docker compose -f "$COMPOSE_DE_INSTALACAO" --env-file "$env_arquivo" exec -T api \
      node -e "fetch('http://broker:8090/health').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))" \
      >/dev/null 2>&1; then
    ok 'a api alcança o broker pela rede interna'
  else
    pendencia "o broker de container: a api NÃO o alcançou em http://broker:8090. \`docker compose -f ${COMPOSE_DE_INSTALACAO} logs broker\` diz o quê."
  fi

  [ -n "$RAIZ_GERENCIADA_NO_HOST" ] || return 0
  montado="$(docker volume inspect --format '{{.Mountpoint}}' "$VOLUME_DA_PASTA_GERENCIADA" 2>/dev/null || true)"
  if [ "$montado" = "$RAIZ_GERENCIADA_NO_HOST" ]; then
    ok 'a raiz da pasta gerenciada confere com o volume'
  else
    pendencia "a raiz da pasta gerenciada: calculei ${RAIZ_GERENCIADA_NO_HOST}, e o daemon diz que o volume ${VOLUME_DA_PASTA_GERENCIADA} está em '${montado:-lugar nenhum}'. Corrija PROJECT_WORKSPACES_HOST_ROOT no .env e rode \`docker compose -f ${COMPOSE_DE_INSTALACAO} --env-file ${env_arquivo} up -d --wait broker\` — até lá, projeto em modo Container não sobe."
  fi
}

# Instala o binário do agente local — e é isto que mata o `chmod +x` manual do
# ADR 0118 (BRB-031): o navegador não preserva o bit de execução, um script
# preserva. O binário passa pela MESMA verificação do resto (RN-524): hash
# contra o `checksums.txt` assinado, que este script já baixou e verificou para
# conferir a si mesmo.
instalar_o_runner() {
  local plataforma="$1" tmp="$2" alvo destino esperado
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
    # `RUNNER_BIN` fica vazio de propósito: é por ele que o fechamento sabe que
    # não há binário para criar chave nem instalar serviço, e diz isso em vez
    # de falhar chamando um comando que não existe.
    return 0
  fi

  # O manifesto já foi baixado e teve a assinatura verificada em
  # `verificar_a_si_mesmo`; aqui só se confere a linha deste binário.
  esperado="$(grep -i "  ${nome}\$" "${tmp}/checksums.txt" | cut -d' ' -f1 || true)"
  [ -n "$esperado" ] || recusar "o manifesto assinado não cobre ${nome} — recusa, não aviso."
  conferir_hash "${tmp}/${nome}" "$esperado" \
    "o binário do runner NÃO bate com o manifesto assinado."
  ok 'binário do runner verificado'

  destino="${HOME}/.local/bin"
  mkdir -p "$destino"
  install -m 0755 "${tmp}/${nome}" "${destino}/brabo-runner"
  RUNNER_BIN="${destino}/brabo-runner"
  ok "instalado em ${destino}/brabo-runner (executável — sem chmod manual)"

  local cfg="${XDG_CONFIG_HOME:-${HOME}/.config}/brabo"
  mkdir -p "$cfg"
  printf '{\n  "base": "%s"\n}\n' "$BASE_DE_PROJETOS" > "${cfg}/runner.json"
  # A MESMA pasta onde `device-key create` grava por padrão (RN-551) e para
  # onde o `--dir` da unit de máquina aponta (RN-545). Ela guarda `runner.json`
  # e a chave, e nunca um `brabo-runner.config.json` — que é por PROJETO e faria
  # `service install --machine` recusar, com razão.
  PASTA_DE_CONFIG="$cfg"
  ok "base gravada em ${cfg}/runner.json"

  case ":${PATH}:" in
    *":${destino}:"*) ;;
    *) dizer "  Acrescente ${destino} ao seu PATH para chamar \`brabo-runner\` direto." ;;
  esac
}

# --------------------------------------------------------------------------
# O fechamento da instalação — a primeira conta, a chave desta máquina e o
# serviço do agente local (RN-547, ADR 0155)
# --------------------------------------------------------------------------
#
# Até aqui a instalação terminava com o compose de pé e um login que NINGUÉM
# atravessava: o `.env` não tem variável de e-mail nenhuma, `MAIL_TRANSPORT`
# cai em `log`, e o registro normal exige verificar e-mail — a única saída era
# pescar o link em `docker compose logs api`. Este bloco é o encadeamento das
# quatro peças que fecham esse buraco, e ele é ORQUESTRADOR: cada peça já
# existe, testada, do outro lado.
#
#   1. POST /internal/first-account          (RN-546) — conta já verificada
#   2. brabo-runner device-key create        (RN-551) — o par nasce AQUI
#   3. POST /internal/machine-device-keys    (RN-552) — só a pública viaja
#   4. brabo-runner device-key finish --id   (RN-551) — o `kid` é carimbado
#   5. brabo-runner service install --machine (RN-545) — a unit por máquina
#
# ## O que acontece quando um elo do meio falha
#
# NADA é desfeito, tudo é RELATADO, e o script continua — sempre saindo 0. O
# motivo é que os elos já cumpridos são úteis por si: com a conta criada a
# pessoa entra, com a chave registrada a máquina está pareada, e o serviço é o
# único passo que ela pode repetir à mão com um comando que este script imprime.
# Desfazer exigiria apagar conta e revogar chave — e não há rota para isso,
# nem deveria haver uma que o instalador chame sozinho. O preço é que uma
# instalação pode terminar pela metade; o que ela nunca faz é terminar pela
# metade em SILÊNCIO, e é para isso que serve `PENDENCIAS`.
#
# ## Idempotência: "já instalado" e "quebrou" são o CÓDIGO HTTP
#
# `409` das duas rotas é o desfecho ESPERADO numa instalação que já tem gente
# (uma segunda execução, ou uma migração cujo restore trouxe os usuários): o
# passo se cala, dizendo por quê, e não conta como pendência. Qualquer outro
# código — e o `000` de um curl que nem falou com a api — é FALHA, e aparece
# com o código e a resposta da api ao lado. O script nunca deduz um do outro.
#
# ## A senha
#
# Lida no TTY sem eco, confirmada, e passada à api pelo STDIN do `curl` — nunca
# por argv (que `ps` mostra a qualquer usuário da máquina) e nunca por arquivo.
# Ela não vai para o `.env`, não vai para o marcador e não vai para log nenhum.
# O marcador ganha só o E-MAIL, que identifica e não é segredo.

PENDENCIAS=''

pendencia() {
  PENDENCIAS="${PENDENCIAS}${1}
"
}

# Escapa o que uma string JSON não aceita cru. Só `\` e `"` — a barra PRIMEIRO,
# senão ela escaparia as aspas que a própria substituição acabou de pôr. Os
# caracteres de controle são RECUSADOS antes (ver `sem_controle`), em vez de
# escapados: um instalador que reescreve a senha em silêncio produz uma conta
# cuja senha não é a que a pessoa digitou.
escapar_json() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

# `0` quando o valor não tem tabulação nem barra invertida de controle. Escrito
# com `case` e não com `grep` porque o argumento pode ser a SENHA, e um `grep`
# a poria num processo externo.
sem_controle() {
  local tab; tab="$(printf '\t')"
  case "$1" in
    *"$tab"*) return 1 ;;
    *) return 0 ;;
  esac
}

# O nome com que esta máquina aparece na lista de chaves de dispositivo. É
# campo do REGISTRO, e quem nomeia é quem registra (RN-551 declara isso por
# escrito: o CLI não escolhe) — então a escolha é deste script, e é o
# `hostname`: quem abrir a lista precisa saber a QUAL máquina ir, e o hostname
# é o nome que a pessoa já usa para falar das máquinas dela (é o que o prompt
# do shell mostra). Não é segredo, não é único, e a api não deriva nada dele.
nome_da_maquina() {
  local nome=''
  nome="$(hostname 2>/dev/null || true)"
  [ -n "$nome" ] || nome="$(uname -n 2>/dev/null || true)"
  # Aspas, barras e quebras sairiam do lugar dentro do JSON; o corte em 80 é o
  # `@MaxLength(80)` do DTO, aplicado aqui para a recusa não vir da api.
  nome="$(printf '%s' "$nome" | sed -e 's/[\\"]//g' | tr '\n\r\t' '   ' | cut -c1-80)"
  nome="$(printf '%s' "$nome" | sed -e 's/^ *//' -e 's/ *$//')"
  [ -n "$nome" ] || nome='maquina-desta-instalacao'
  printf '%s\n' "$nome"
}

# `POST` numa rota interna. O CORPO vem do STDIN e o cabeçalho vai num arquivo
# de configuração do `curl`, e as duas escolhas são a mesma decisão: nada que
# seja segredo entra em `argv`, porque `/proc/<pid>/cmdline` é legível por
# qualquer usuário da máquina. A senha não toca disco em instante nenhum; o
# service token toca, num arquivo 600 que é apagado em seguida — e ele já mora
# em disco, no `.env`, com o mesmo modo.
#
# Ecoa o código HTTP, ou `000` quando o curl não chegou a falar com a api —
# distinguir os dois é o que faz "quebrou" não virar "já instalado".
post_interno() {
  local url="$1" saida="$2" cfg codigo
  cfg="$(mktemp)"
  chmod 600 "$cfg"
  {
    printf 'url = "%s"\n' "$url"
    printf 'request = "POST"\n'
    printf 'header = "Content-Type: application/json"\n'
    printf 'header = "%s: %s"\n' "$CABECALHO_SERVICE_TOKEN" "${BRABO_SERVICE_TOKEN:-}"
    printf 'data-binary = "@-"\n'
    printf 'silent\n'
    printf 'max-time = 30\n'
  } > "$cfg"
  codigo="$(curl -K "$cfg" -o "$saida" -w '%{http_code}' 2>/dev/null || true)"
  rm -f "$cfg"
  printf '%s\n' "${codigo:-000}"
}

# O resultado de uma chamada às rotas internas. São TRÊS saídas, e é por isso
# que elas são GLOBAIS em vez de ecoadas: `veredito="$(criar_primeira_conta …)"`
# roda a função num SUBSHELL, e as outras duas atribuições morreriam com ele —
# o script seguiria com `RESPOSTA_CORPO` não associada e `set -u` o mataria no
# primeiro `dizer` que a imprimisse. Achado rodando, não lendo.
#
# O veredito é PALAVRA e não código de saída pelo motivo de `comparar_versoes`:
# sob `set -e`, um `return 1` legítimo mataria o script.
RESPOSTA_VEREDITO=''
RESPOSTA_CODIGO=''
RESPOSTA_CORPO=''

classificar_resposta() {
  local codigo="$1" nome_do_409="$2"
  case "$codigo" in
    201) RESPOSTA_VEREDITO='ok' ;;
    409) RESPOSTA_VEREDITO="$nome_do_409" ;;
    400) RESPOSTA_VEREDITO='recusada' ;;
    *)   RESPOSTA_VEREDITO='falhou' ;;
  esac
}

# `ja-tem-conta` é o `409` desta rota: a instalação já tem gente.
criar_primeira_conta() {
  local base="$1" email="$2" senha="$3" nome="$4" corpo resp
  resp="$(mktemp)"
  corpo="{\"email\":\"$(escapar_json "$email")\",\"senha\":\"$(escapar_json "$senha")\""
  if [ -n "$nome" ]; then
    corpo="${corpo},\"nome\":\"$(escapar_json "$nome")\""
  fi
  corpo="${corpo}}"
  RESPOSTA_CODIGO="$(printf '%s' "$corpo" | post_interno "${base}/internal/first-account" "$resp")"
  RESPOSTA_CORPO="$(cat "$resp" 2>/dev/null || true)"
  rm -f "$resp"
  classificar_resposta "$RESPOSTA_CODIGO" 'ja-tem-conta'
}

# O mesmo molde. `publicKeyJwk` é uma STRING no corpo — o JSON da JWK, dentro de
# uma string JSON —, e é por isso que ele passa pelo mesmo `escapar_json` do
# e-mail. `409` aqui NÃO quer dizer o mesmo que na rota da conta: é "a
# instalação não tem exatamente um usuário" (RN-552), e por isso tem nome
# próprio.
registrar_chave_de_maquina() {
  local base="$1" nome="$2" jwk="$3" corpo resp
  resp="$(mktemp)"
  corpo="{\"name\":\"$(escapar_json "$nome")\",\"publicKeyJwk\":\"$(escapar_json "$jwk")\"}"
  RESPOSTA_CODIGO="$(printf '%s' "$corpo" | post_interno "${base}/internal/machine-device-keys" "$resp")"
  RESPOSTA_CORPO="$(cat "$resp" 2>/dev/null || true)"
  rm -f "$resp"
  classificar_resposta "$RESPOSTA_CODIGO" 'sem-usuario-unico'
}

# Lê sem eco e põe em `SENHA_LIDA`. Global e não `$(...)` de propósito: uma
# substituição de comando forkaria um subshell só para carregar a senha de
# volta. `stty` ausente é RECUSA do passo, nunca "pergunta com eco" — prometer
# sem eco e entregar com eco é pior que não perguntar.
SENHA_LIDA=''
ler_sem_eco() {
  local antigo=''
  SENHA_LIDA=''
  if ! command -v stty >/dev/null 2>&1; then
    return 1
  fi
  printf '%s' "$1"
  antigo="$(stty -g 2>/dev/null || true)"
  stty -echo 2>/dev/null || true
  read -r SENHA_LIDA || SENHA_LIDA=''
  if [ -n "$antigo" ]; then stty "$antigo" 2>/dev/null || true; fi
  printf '\n'
  return 0
}

# Pergunta e-mail, senha (duas vezes) e nome, e tenta criar a conta. O laço é
# do PAR pergunta+resposta, porque a recusa que mais acontece é a política de
# senha (a mesma do registro normal, RN-546) e ela só é conhecida depois do
# POST — abortar a instalação inteira nesse ponto deixaria alguém com o compose
# de pé e a segunda execução caindo no caminho de migração.
TENTATIVAS_DE_CONTA=3
CONTA_EMAIL=''
perguntar_e_criar_a_conta() {
  local base="$1" tentativa=1 email senha confirmacao nome veredito

  dizer ''
  dizer "${C_BOLD}A primeira conta${C_RESET}"
  dizer 'Esta instalação não tem ninguém, e o e-mail de verificação não sai daqui:'
  dizer 'MAIL_TRANSPORT é `log`, e nenhum servidor de SMTP foi configurado (nem vai'
  dizer 'ser por este script). Então a conta que nasce aqui já nasce VERIFICADA —'
  dizer 'quem está no terminal desta máquina provou mais do que um e-mail provaria.'
  dizer 'A senha é lida sem eco, usada e descartada: ela não vai para o .env, nem'
  dizer 'para o marcador, nem para log nenhum.'
  dizer ''
  printf 'Criar a primeira conta agora? [S/n] '
  local resposta; read -r resposta || resposta=''
  case "$resposta" in
    n|N|nao|NAO|não|NÃO)
      dizer 'Nenhuma conta foi criada.'
      pendencia 'a primeira conta (recusada aqui): crie-a depois com POST /internal/first-account, ou rode o instalador de novo numa instalação sem usuários.'
      return 1
      ;;
  esac

  while [ "$tentativa" -le "$TENTATIVAS_DE_CONTA" ]; do
    printf 'E-mail: '
    read -r email || email=''
    if [ -z "$email" ]; then
      dizer '  E-mail vazio.' >&2
      tentativa=$(( tentativa + 1 )); continue
    fi

    if ! ler_sem_eco 'Senha (não aparece na tela): '; then
      dizer '  Não há `stty` nesta máquina, e sem ele a senha apareceria na tela.' >&2
      pendencia 'a primeira conta: sem `stty` não dá para ler senha sem eco, e este script não pergunta senha com eco.'
      return 1
    fi
    senha="$SENHA_LIDA"
    if ! ler_sem_eco 'Repita a senha: '; then
      pendencia 'a primeira conta: sem `stty` não dá para ler senha sem eco.'
      return 1
    fi
    confirmacao="$SENHA_LIDA"
    SENHA_LIDA=''

    if [ "$senha" != "$confirmacao" ]; then
      dizer '  As duas senhas não são iguais.' >&2
      tentativa=$(( tentativa + 1 )); continue
    fi
    if ! sem_controle "$senha" || ! sem_controle "$email"; then
      dizer '  Há uma tabulação no que foi digitado. Ela não pode ir para o corpo JSON, e' >&2
      dizer '  este script não a remove por conta própria: a senha gravada não seria a sua.' >&2
      tentativa=$(( tentativa + 1 )); continue
    fi

    printf 'Nome (opcional, Enter para pular): '
    read -r nome || nome=''
    if ! sem_controle "$nome"; then nome=''; fi

    # Chamada DIRETA, nunca em `$( )`: ela devolve três coisas em globais, e
    # um subshell perderia duas delas.
    criar_primeira_conta "$base" "$email" "$senha" "$nome"
    veredito="$RESPOSTA_VEREDITO"
    senha=''; confirmacao=''

    case "$veredito" in
      ok)
        CONTA_EMAIL="$email"
        ok "conta criada e já verificada: ${email}"
        return 0
        ;;
      ja-tem-conta)
        # Não é falha, e não vira pendência. É a segunda execução, ou uma
        # migração cujo restore trouxe os usuários — e o ADR 0155 diz que o
        # passo se cala pelo mesmo critério nos dois casos.
        dizer ''
        dizer 'Esta instalação JÁ tem usuário, então a primeira conta não se aplica —'
        dizer 'entre com a conta que já existe. Nada foi criado nem alterado.'
        return 1
        ;;
      recusada)
        dizer "  A api recusou: ${RESPOSTA_CORPO}" >&2
        tentativa=$(( tentativa + 1 ))
        ;;
      *)
        dizer "  A api respondeu ${RESPOSTA_CODIGO}: ${RESPOSTA_CORPO}" >&2
        pendencia "a primeira conta: a api respondeu ${RESPOSTA_CODIGO}. A instalação está de pé; \`docker compose -f ${COMPOSE_DE_INSTALACAO} logs api\` diz o quê."
        return 1
        ;;
    esac
  done

  dizer "  ${TENTATIVAS_DE_CONTA} tentativas e nenhuma conta criada." >&2
  pendencia "a primeira conta: ${TENTATIVAS_DE_CONTA} tentativas recusadas. A instalação está de pé; rode o instalador de novo, ou use POST /internal/first-account com o BRABO_SERVICE_TOKEN do .env."
  return 1
}

# A chave desta máquina, em dois passos, e o `kid` no meio. Ver RN-551: o par é
# gerado aqui, o `create` grava um `.parcial` que o runner IGNORA, e só o
# `finish` escreve o nome que ele lê — o arquivo que o runner lê nunca existe
# sem `kid`, que é o defeito que a RN-475 custou uma caçada para achar.
CAMINHO_DA_CHAVE=''
parear_esta_maquina() {
  local base="$1" publica id veredito caminho

  dizer ''
  dizer "${C_BOLD}A chave desta máquina${C_RESET}"

  # O stdout do `create` é UMA linha, a JWK pública — tudo que é para humano
  # sai no stderr, e é esse contrato que faz `$( )` funcionar aqui.
  if ! publica="$("$RUNNER_BIN" device-key create)"; then
    dizer 'Não consegui gerar o par de chaves nesta máquina (acima está o motivo).' >&2
    pendencia 'a chave desta máquina: `brabo-runner device-key create` recusou. Nada foi registrado na api.'
    return 1
  fi
  ok 'par Ed25519 gerado nesta máquina — a privada não viajou'

  registrar_chave_de_maquina "$base" "$(nome_da_maquina)" "$publica"
  veredito="$RESPOSTA_VEREDITO"
  case "$veredito" in
    ok) ;;
    sem-usuario-unico)
      dizer 'A api recusou: esta instalação não tem exatamente UM usuário, e a chave de' >&2
      dizer 'máquina é do dono único de uma instalação nova.' >&2
      pendencia 'a chave desta máquina: a api respondeu 409 (instalação sem usuário único). O agente local não foi pareado.'
      avisar_chave_parcial
      return 1
      ;;
    *)
      dizer "A api respondeu ${RESPOSTA_CODIGO} ao registrar a chave: ${RESPOSTA_CORPO}" >&2
      pendencia "a chave desta máquina: a api respondeu ${RESPOSTA_CODIGO} ao registrar. O agente local não foi pareado."
      avisar_chave_parcial
      return 1
      ;;
  esac

  # O `id` do registro, e é dele — de nada mais — que o `kid` sai (RN-475). O
  # mesmo leitor de campo de topo do marcador: `jq` não se assume na máquina de
  # quem instala.
  id="$(campo_do_marcador id "$RESPOSTA_CORPO")"
  if [ -z "$id" ]; then
    dizer "A api respondeu 201 mas sem um campo \`id\`: ${RESPOSTA_CORPO}" >&2
    pendencia 'a chave desta máquina: a api registrou e não devolveu `id`, e sem ele a privada não pode ser carimbada.'
    avisar_chave_parcial
    return 1
  fi
  ok "chave registrada na api (id ${id})"

  # O stdout do `finish` é o CAMINHO do arquivo completo — é dele que sai o
  # `--dir` do serviço, em vez de este script recalcular a pasta por conta.
  if ! caminho="$("$RUNNER_BIN" device-key finish --id "$id")"; then
    dizer 'Não consegui carimbar o `kid` na chave privada (acima está o motivo).' >&2
    pendencia "a chave desta máquina: \`brabo-runner device-key finish --id ${id}\` recusou. A pública JÁ está registrada — rode esse mesmo comando para terminar."
    return 1
  fi
  CAMINHO_DA_CHAVE="$caminho"
  ok "chave completa em ${caminho}"
  return 0
}

# O `.parcial` que sobra quando o registro não fecha. Ele FICA onde está, e a
# decisão é escrita: este script não sabe se o POST chegou a ser processado
# (um timeout depois de a api gravar é indistinguível de um timeout antes), e
# apagá-lo destruiria a única metade privada de uma chave que pode já estar
# pareada. Ele é inerte por construção — o runner não lê esse nome (RN-551) —
# e o próximo `device-key create` o nomeia e o substitui.
avisar_chave_parcial() {
  dizer '' >&2
  dizer "A privada ficou em ${PASTA_DE_CONFIG}/brabo-runner-device-key.jwk.json.parcial, e ela" >&2
  dizer 'NÃO foi apagada: o runner ignora esse nome, e se o registro tiver chegado à api' >&2
  dizer 'ela é a única cópia da metade privada. `device-key create` a substitui na próxima' >&2
  dizer 'vez, avisando.' >&2
}

# O serviço, e a recusa que numa máquina de desenvolvedor é o caso COMUM:
# `install --machine` RECUSA quando há unit por PROJETO instalada (RN-545), e
# não há `--force`. A recusa vem com as palavras dela — este script repassa a
# saída do CLI inteira em vez de resumi-la, porque ela nomeia o `uninstall` de
# cada unit encontrada, que é o gesto.
subir_o_agente_como_servico() {
  local api_url="$1" pasta saida

  dizer ''
  dizer "${C_BOLD}O agente local como serviço${C_RESET}"
  pasta="$(dirname "$CAMINHO_DA_CHAVE")"

  if saida="$("$RUNNER_BIN" service install --machine --dir "$pasta" --api-url "$api_url" 2>&1)"; then
    printf '%s\n' "$saida"
    ok 'agente local instalado como serviço desta máquina'
    dizer 'Ele sobe sem projeto nenhum, e isso é o estado NORMAL de uma instalação nova:'
    dizer 'fica de pé esperando, e pega o primeiro projeto em modo Runner que você criar'
    dizer 'na web — sem ninguém voltar a este terminal.'
    return 0
  fi

  printf '%s\n' "$saida" >&2
  pendencia "o serviço do agente local: \`brabo-runner service install --machine\` recusou (acima, com as palavras dele). A chave desta máquina JÁ está registrada — resolva o que ele nomeia e rode: ${RUNNER_BIN} service install --machine --dir ${pasta} --api-url ${api_url}"
  return 1
}

# O encadeamento. Ele NUNCA recusa (nunca sai 1): tudo aqui é relatado e vira
# pendência nomeada, porque o compose já está de pé e derrubar a instalação por
# causa do último passo seria trocar uma instalação pela metade por nenhuma.
fechar_a_instalacao() {
  local base="$1"

  if ! perguntar_e_criar_a_conta "$base"; then return 0; fi

  if [ -z "$RUNNER_BIN" ]; then
    dizer ''
    dizer 'O binário do agente local não foi instalado, então a chave desta máquina e o' >&2
    dizer 'serviço ficam para depois.' >&2
    pendencia 'a chave desta máquina e o serviço do agente: o binário do agente local não foi instalado.'
    return 0
  fi

  if ! parear_esta_maquina "$base"; then return 0; fi
  subir_o_agente_como_servico "$base" || true
  return 0
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

  # O backup e a prova sobem pelo compose DESTA versão, verificado — nunca pelo
  # que a instalação anterior deixou na pasta.
  materializar_os_arquivos_da_instalacao "$PWD"

  # 1. backup
  dizer 'Backup do Postgres e dos repositórios git locais…'
  BACKUP_DIR=/backups docker compose -f "$COMPOSE_DE_INSTALACAO" --env-file "$PWD/.env" \
    run --rm -v "${destino}:/backups" backup brabo-backup \
    || recusar "o backup falhou. NADA foi apagado — a migração para aqui, de propósito."

  # 2. provar que restaura, ANTES de apagar
  dizer 'Provando que o backup restaura…'
  BRABO_COMPOSE_FILE="$COMPOSE_DE_INSTALACAO" BRABO_ENV_FILE="$PWD/.env" BACKUP_DIR=/backups \
    bash "$PROVA_DE_RESTAURACAO" \
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
      # O cabeçalho INTEIRO, até a primeira linha que não é comentário — e não
      # um intervalo fixo de linhas. O `2,30p` de antes cortava a ajuda no meio
      # assim que o cabeçalho crescia, e ninguém percebia: `--help` é a única
      # saída deste script que nenhum teste lia.
      --help|-h)     sed -n '2,${/^[^#]/q;p;}' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
      --source=ghcr)  FONTE='ghcr';  shift ;;
      --source=local) FONTE='local'; shift ;;
      --source=*) recusar "fonte desconhecida: '${1#--source=}'. Use ghcr (o default) ou local." ;;
      *) recusar "argumento desconhecido: '$1'." ;;
    esac
  done

  # ANTES da plataforma e de qualquer download: rodar sem arquivo é defeito de
  # INVOCAÇÃO, e a pessoa precisa ler a forma certa, não o que viria depois.
  exigir_o_proprio_arquivo

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

  # ANTES do primeiro download, e não no meio da primeira verificação: a
  # máquina sem com que conferir não deve chegar a ter o que conferir, e o
  # `command not found` ali chegava como acusação de adulteração (AT-091).
  exigir_ferramenta_de_hash

  verificar_a_si_mesmo "$plataforma"

  # Logo depois da própria origem, e ANTES de tudo o que pergunta ou grava
  # (RN-570): é o que faz a falta de um arquivo da instalação ser uma recusa
  # numa máquina intocada, e não a morte da subida com o `.env` já gravado.
  baixar_e_verificar_os_arquivos_da_instalacao "$URL_DA_RELEASE" "$TMP_VERIFICACAO"

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
    dizer "  ${COMO_RODAR}"
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
  # Depois da base (a segunda raiz do broker DERIVA dela) e antes do `.env`
  # (é ele que carrega a decisão): uma recusa aqui não deixa nada gravado.
  consentir_broker
  gerar_segredos

  local env_arquivo="${PWD}/.env"
  escrever_env "$env_arquivo"
  ok ".env gravado com modo 600"

  dizer ''
  dizer "${C_BOLD}Subindo${C_RESET}"
  # `--wait` só prova o que tem healthcheck, e é por isso que ele basta aqui:
  # os serviços deste compose têm, e `api` depende de `migrate-api` com
  # `service_completed_successfully` — as migrações rodam na ordem, e a subida
  # espera por elas. Não há passo de migrate separado, e não deve haver: dois
  # lugares mandando migrar é a segunda fonte da mesma verdade.
  materializar_os_arquivos_da_instalacao "$PWD"
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

  conferir_o_broker "$env_arquivo"

  if [ -n "$MIGRAR_DE" ]; then
    restaurar_apos_migrar "$MIGRAR_DE"
  fi

  instalar_o_runner "$plataforma" "$TMP_VERIFICACAO"

  # O fechamento vem DEPOIS do runner e ANTES do marcador, e a ordem é a
  # decisão: a chave de máquina precisa do binário instalado e da base já
  # gravada em `runner.json` (sem ela `service install --machine` recusa, com
  # razão), e o marcador registra o e-mail do dono que este passo cria.
  fechar_a_instalacao "http://localhost:${api_port}"

  mkdir -p "$(dirname "$(caminho_do_marcador)")"
  cat > "$(caminho_do_marcador)" <<JSON
{
  "schemaVersion": ${MARCADOR_SCHEMA},
  "versao": "${VERSAO_A_INSTALAR}",
  "commit": "${COMMIT_A_INSTALAR}",
  "instaladoEm": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "plataforma": "${plataforma}",
  "fonte": "${FONTE}",
  "ownerEmail": "$(escapar_json "$CONTA_EMAIL")",
  "imagens": {
    "api": "${BRABO_API_IMAGE}",
    "engine": "${BRABO_ENGINE_IMAGE}",
    "web": "${BRABO_WEB_IMAGE}",
    "backup": "${BRABO_BACKUP_IMAGE}",
    "broker": "${BRABO_BROKER_IMAGE}"
  },
  "caminhos": {
    "env": "${env_arquivo}",
    "baseDeProjetos": "${BASE_DE_PROJETOS}",
    "compose": "${COMPOSE_DE_INSTALACAO}"
  }
}
JSON
  ok "marcador gravado"

  dizer ''
  dizer "${C_BOLD}Pronto${C_RESET}"
  dizer "  Web:    http://localhost:${WEB_PORT:-8088}"
  dizer "  API:    http://localhost:${api_port}/health"
  if [ -n "$CONTA_EMAIL" ]; then
    dizer "  Entre com ${CONTA_EMAIL} e a senha que você acabou de digitar."
  fi
  if [ "$BROKER_LIGADO" = 'sim' ]; then
    dizer '  Broker de container: LIGADO — projetos Container e Pasta montada executam.'
  else
    dizer '  Broker de container: DESLIGADO — projetos Container e Pasta montada não'
    dizer '  executam; o modo Runner não depende dele (docs/runbook.md explica como ligar).'
  fi

  # O que ficou pela metade sai NOMEADO, e no fim — onde quem instalou ainda
  # está olhando. Um passo que falha no meio de trinta linhas de saída some.
  if [ -n "$PENDENCIAS" ]; then
    dizer ''
    dizer "${C_BOLD}O que ficou pendente${C_RESET}"
    printf '%s' "$PENDENCIAS" | while IFS= read -r linha; do
      [ -n "$linha" ] && dizer "  - ${linha}"
    done
    dizer 'O resto da instalação está de pé.'
  fi

  dizer ''
  dizer "${C_BOLD}O que este instalador NÃO faz${C_RESET}"
  dizer 'Não liga o broker de container sem perguntar: ele recebe o socket do'
  dizer 'Docker desta máquina. Sem broker, projeto em modo Container ou Pasta'
  dizer 'montada não sobe container (ADR 0144, ADR 0162); o modo Runner usa o'
  dizer 'Docker desta máquina pelo agente local e não depende dele.'
  dizer 'Não liga SMTP e não pergunta servidor de e-mail: MAIL_TRANSPORT segue'
  dizer '`log`, aqui como em produção. A conta criada acima nasceu verificada'
  dizer 'justamente por isso; o registro de quem vier depois continua exigindo'
  dizer 'verificar e-mail, e ligar SMTP é decisão de quem opera.'
  dizer 'Não pede credencial de LLM: a chave de provider é de quem vai gastar,'
  dizer 'e entra pela tela, na conta do dono do workspace.'
  dizer 'Não pareia o agente local com um PROJETO: a chave desta máquina atende'
  dizer 'todos os seus projetos em modo Runner, e a pasta de cada um nasce'
  dizer 'sozinha sob a base. Parear uma pasta específica pela tela do projeto'
  dizer 'continua existindo (ADR 0118), para quem quiser.'
}

main "$@"

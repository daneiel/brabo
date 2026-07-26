FROM hexpm/elixir:1.17.3-erlang-27.1.2-alpine-3.20.3

# git: Engine.Actions.Workspace precisa dele pra derivar o working tree
# do bare repo local provisionado (Fase 2) antes de rodar ações de terminal.
RUN apk add --no-cache build-base inotify-tools git

# gitleaks (SecOpsAgent, Fase 4a) — binário estático direto do release do
# GitHub (mais confiável em Alpine/musl do que empacotamento via gerenciador
# de pacote). BEST-EFFORT: se a versão/plataforma não bater ou a rede falhar
# no build, segue sem o binário — Engine.Actions.GitleaksDetector detecta a
# ausência (System.find_executable/1) e o SecOpsAgent pula o scanner (registra
# no resumo do parecer), nunca quebra o gate (ver docs/adr/0013).
#
# A versão é LOAD-BEARING: o detector usa o subcomando `gitleaks dir` (varre a
# árvore de trabalho), que só existe a partir do 8.19 — abaixo disso o scan
# falha e o gate roda sem verificação de segredo. Ver docs/adr/0020.
#
# hadolint (gate de QA de infra, Fase 4a) vem no MESMO bloco por ser o mesmo
# padrão de binário estático do GitHub, e pra aproveitar o `curl` do grupo
# virtual antes dele ser removido. SEM HADOLINT O GATE DE QA DE INFRA APROVA
# QUALQUER DOCKERFILE: `InfraGateRunner.lint_dockerfiles/1` trata a ausência
# como "pulado", não acha nada, e o veredito sai `approved` (ver ADR 0021).
ARG GITLEAKS_VERSION=8.21.2
ARG HADOLINT_VERSION=2.12.0
RUN apk add --no-cache --virtual .binaries-build curl tar \
  && (curl -fsSL -o /tmp/gitleaks.tar.gz \
        "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
      && tar -xzf /tmp/gitleaks.tar.gz -C /usr/local/bin gitleaks \
      && chmod +x /usr/local/bin/gitleaks \
      || echo "[build] gitleaks nao instalado -- SecOpsAgent detecta a ausencia em runtime") \
  && (curl -fsSL -o /usr/local/bin/hadolint \
        "https://github.com/hadolint/hadolint/releases/download/v${HADOLINT_VERSION}/hadolint-Linux-x86_64" \
      && chmod +x /usr/local/bin/hadolint \
      || echo "[build] hadolint nao instalado -- o gate de QA de infra pula o lint de Dockerfile") \
  && rm -f /tmp/gitleaks.tar.gz \
  && apk del .binaries-build

# semgrep (SecOpsAgent, Fase 4a) — via pip. python3/pip ficam instalados de
# verdade (não num grupo --virtual): o semgrep precisa deles em RUNTIME, não
# só pra instalar. Historicamente mais estável em glibc/Debian do que
# Alpine/musl — mesmo tratamento best-effort do gitleaks acima
# (Engine.Actions.SemgrepDetector degrada graciosamente se ausente).
RUN apk add --no-cache python3 py3-pip \
  && (pip install --no-cache-dir --break-system-packages semgrep \
      || echo "[build] semgrep nao instalado -- SecOpsAgent detecta a ausencia em runtime")

# yamllint (gate de QA de infra, Fase 4a) — valida a sintaxe do compose e do
# pipeline de CI que o InfraAgent propõe. Aproveita o python3/pip do semgrep
# acima; nao ha parser de YAML nas deps do Elixir, e o padrao da casa pra
# validacao e ferramenta externa com deteccao opcional. Best-effort igual aos
# demais (Engine.Actions.YamlLintDetector degrada se ausente).
RUN pip install --no-cache-dir --break-system-packages yamllint \
  || echo "[build] yamllint nao instalado -- o gate de QA de infra pula a validacao de YAML"

# Node (dev): a suite de testes do PROJETO GERIDO roda aqui dentro — o
# `terminal` do DevAgent executa via Engine.Actions.TerminalExecutor, no
# worktree, dentro deste container. Sem o toolchain do projeto, `npm test`
# nunca dá exit 0 e o ReportDone jamais deixa abrir PR.
#
# LIMITAÇÃO CONHECIDA: isto não escala pra stacks arbitrárias — hoje o engine
# precisa ter instalado o toolchain de todo projeto que ele gerencia. A saída
# real é um sandbox por projeto (container/imagem própria por module_map),
# fora do escopo da Fase 4a.
RUN apk add --no-cache nodejs npm

WORKDIR /workspace/apps/engine

CMD ["sh", "-c", "mix local.hex --force && mix local.rebar --force && mix deps.get && mix ecto.create && mix ecto.migrate && mix phx.server"]

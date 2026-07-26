# Imagem de PRODUÇÃO do engine (Fase 5). O Dockerfile de dev ao lado continua
# existindo: ele bind-monta o repo e roda `mix phx.server` com code reload.
#
# Diferença de fundo em relação ao dev: aqui roda um `mix release` — sem Mix,
# sem código-fonte, sem compilar no boot. Por isso `Engine.Release.migrate/0`
# existe (`bin/engine eval`), já que `mix ecto.migrate` não está disponível.

# ---------------------------------------------------------------------------
# Estágio 1: builder. Mesma base pinada do dev (Elixir 1.17.3 / OTP 27.1.2 /
# Alpine 3.20.3) — a versão do Alpine tem que casar com a do runtime, porque o
# ERTS embarcado no release é linkado contra a musl desta imagem.
# ---------------------------------------------------------------------------
FROM hexpm/elixir:1.17.3-erlang-27.1.2-alpine-3.20.3 AS builder

# build-base: compilar as NIFs das deps nativas.
# hadolint ignore=DL3018
RUN apk add --no-cache build-base git

ENV MIX_ENV=prod

WORKDIR /build

RUN mix local.hex --force && mix local.rebar --force

# Manifests primeiro: a camada de deps só invalida quando o lockfile muda.
COPY apps/engine/mix.exs apps/engine/mix.lock ./
RUN mix deps.get --only prod && mix deps.compile

COPY apps/engine/config config
COPY apps/engine/priv priv
COPY apps/engine/lib lib

# `--warnings-as-errors` de propósito: warning que passa em dev vira problema
# silencioso em produção, e o release é o último ponto onde dá pra barrar.
RUN mix compile --warnings-as-errors && mix release

# ---------------------------------------------------------------------------
# Estágio 2: runtime. Alpine puro — o ERTS vem no release, não precisa de
# Erlang/Elixir instalados.
# ---------------------------------------------------------------------------
FROM alpine:3.20.3 AS runtime

# Versões PINADAS de todo binário externo. Os valores são os que já rodam no
# container de dev hoje — não são escolhas novas.
# gitleaks 8.30.1, não o 8.21.2 do container de dev: o binário do 8.21.2 é
# compilado com Go 1.23.2 e o trivy acusa 15 CVEs de stdlib nele (1 CRITICAL).
# Como não compilamos o gitleaks, subir o release É a correção. Verificado que
# as regressões dos gates (`mix test --only gitleaks`) seguem passando.
ARG GITLEAKS_VERSION=8.30.1
ARG GITLEAKS_SHA256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
ARG HADOLINT_VERSION=2.12.0
ARG HADOLINT_SHA256=56de6d5e5ec427e17b74fa48d51271c7fc0d61244bf5c90e828aab8362d55010
ARG SEMGREP_VERSION=1.171.0
ARG YAMLLINT_VERSION=1.38.0

# libstdc++/ncurses/openssl: exigidas pelo ERTS embarcado.
# git: Engine.Actions.Workspace deriva o working tree do bare repo.
# nodejs: o DevAgent roda a suite do PROJETO GERIDO aqui dentro
#   (TerminalExecutor). LIMITAÇÃO CONHECIDA herdada do dev: isto não escala pra
#   stacks arbitrárias — a saída real é um sandbox por projeto (fora do escopo
#   da Fase 5). Sem `npm` avulso: o nodejs do Alpine já traz o necessário.
# python3/py3-pip: runtime do semgrep e do yamllint, não só build.
# curl/tar: removidos no fim, junto do grupo virtual.
#
# `apk upgrade` antes do install: a tag da base é pinada (bom pra
# reprodutibilidade) mas congela junto os patches de segurança do Alpine.
# hadolint ignore=DL3018
RUN apk upgrade --no-cache \
 && apk add --no-cache \
      libstdc++ ncurses-libs openssl ca-certificates \
      git nodejs python3 py3-pip

# DIFERENÇA CENTRAL EM RELAÇÃO AO DEV: aqui NÃO existe `|| echo`.
#
# Em dev os scanners são best-effort de propósito (o detector some e o gate
# pula). Em produção isso é inaceitável: o ADR 0021 registra que SEM HADOLINT O
# GATE DE QA DE INFRA APROVA QUALQUER DOCKERFILE, e o ADR 0020 que sem gitleaks
# o gate de SecOps roda sem verificação de segredo. Uma falha de rede no build
# produziria uma imagem verde cujo gate de segurança é no-op — então o build
# QUEBRA, e o checksum garante que o binário é o esperado, não só que baixou.
# `pipefail` no shell do RUN abaixo: sem ele, uma falha no meio de um pipe é
# engolida e o `&&` seguinte roda como se tivesse dado certo — exatamente o
# modo de falha silenciosa que este bloco existe pra impedir.
SHELL ["/bin/ash", "-o", "pipefail", "-c"]

# hadolint ignore=DL3018
RUN apk add --no-cache --virtual .fetch curl tar \
 && curl -fsSL -o /tmp/gitleaks.tar.gz \
      "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
 && echo "${GITLEAKS_SHA256}  /tmp/gitleaks.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/gitleaks.tar.gz -C /usr/local/bin gitleaks \
 && chmod 0755 /usr/local/bin/gitleaks \
 && curl -fsSL -o /usr/local/bin/hadolint \
      "https://github.com/hadolint/hadolint/releases/download/v${HADOLINT_VERSION}/hadolint-Linux-x86_64" \
 && echo "${HADOLINT_SHA256}  /usr/local/bin/hadolint" | sha256sum -c - \
 && chmod 0755 /usr/local/bin/hadolint \
 && rm -f /tmp/gitleaks.tar.gz \
 && apk del .fetch

# semgrep e yamllint com versão FIXA (em dev são `pip install` sem versão, o que
# significa que dois builds do mesmo commit podem trazer scanners diferentes).
#
# O semgrep arrasta `mcp==1.23.3` (fixo, não é range), versão com 3 CVEs HIGH,
# e o semgrep já está no último release publicado — não há para onde subir.
# Tentamos remover o `mcp`, já que os gates só rodam `semgrep scan` e nunca o
# subcomando `semgrep mcp`: NÃO FUNCIONA. O `semgrep/cli.py` importa
# `semgrep.commands.mcp` no topo, incondicionalmente, e sem o módulo o binário
# inteiro morre em ModuleNotFoundError. Os 3 CVEs estão aceitos e datados em
# .trivyignore, com o critério de reavaliação escrito lá.
# hadolint ignore=DL3013
RUN pip install --no-cache-dir --break-system-packages \
      "semgrep==${SEMGREP_VERSION}" "yamllint==${YAMLLINT_VERSION}"

# Prova, no build, que todo binário de que os gates dependem está presente e
# executável. Se algum passo acima degradar silenciosamente, o build para aqui.
RUN set -eux; \
    gitleaks version; \
    hadolint --version; \
    semgrep --version; \
    yamllint --version; \
    git --version; \
    node --version; \
    # Um `semgrep scan` de verdade, não só `--version`: é o que prova que
    # remover o `mcp` acima não quebrou o caminho que os gates usam.
    mkdir -p /tmp/semgrep-probe; \
    printf 'const senha = "abc";\n' > /tmp/semgrep-probe/probe.js; \
    semgrep scan --config=p/javascript --quiet --metrics=off /tmp/semgrep-probe; \
    rm -rf /tmp/semgrep-probe

# Usuário non-root dedicado. HOME gravável porque o semgrep baixa e cacheia
# regras do registry sob $HOME na primeira execução.
RUN addgroup -g 1000 engine \
 && adduser -u 1000 -G engine -h /home/engine -s /bin/sh -D engine

# ITEM 2 DO ENUNCIADO — volumes graváveis dedicados dos workspaces/worktrees.
#
# /data/project-workspaces: working tree por projeto (PROJECT_WORKSPACES_ROOT) e
#   os worktrees por agente em <workspace>/.worktrees/<agent_id>.
# /data/git-repos: bare repos locais, escritos pelo `git push` do dev agent.
#
# OS DOIS CAMINHOS PRECISAM SER IDÊNTICOS NA API E NO ENGINE: a api persiste o
# path absoluto do bare repo no banco e o engine o usa literalmente — montar em
# lugares diferentes quebra o push com "remote unpack failed".
RUN mkdir -p /data/project-workspaces /data/git-repos \
 && chown -R engine:engine /data
VOLUME ["/data/project-workspaces", "/data/git-repos"]

WORKDIR /app

COPY --from=builder --chown=engine:engine /build/_build/prod/rel/engine ./

USER engine

ENV HOME=/home/engine \
    MIX_ENV=prod \
    PHX_SERVER=true

EXPOSE 4000

# `/health` faz `SELECT 1` no Repo — valida processo E banco.
HEALTHCHECK --interval=15s --timeout=5s --start-period=25s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4000/health >/dev/null || exit 1

# `start` (não `daemon`): o release fica em foreground como PID 1 e recebe
# SIGTERM direto, sem shell no meio engolindo o sinal.
CMD ["/app/bin/engine", "start"]

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
ARG GITLEAKS_VERSION=8.21.2
RUN apk add --no-cache --virtual .gitleaks-build curl tar \
  && (curl -fsSL -o /tmp/gitleaks.tar.gz \
        "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
      && tar -xzf /tmp/gitleaks.tar.gz -C /usr/local/bin gitleaks \
      && chmod +x /usr/local/bin/gitleaks \
      || echo "[build] gitleaks nao instalado -- SecOpsAgent detecta a ausencia em runtime") \
  && rm -f /tmp/gitleaks.tar.gz \
  && apk del .gitleaks-build

# semgrep (SecOpsAgent, Fase 4a) — via pip. python3/pip ficam instalados de
# verdade (não num grupo --virtual): o semgrep precisa deles em RUNTIME, não
# só pra instalar. Historicamente mais estável em glibc/Debian do que
# Alpine/musl — mesmo tratamento best-effort do gitleaks acima
# (Engine.Actions.SemgrepDetector degrada graciosamente se ausente).
RUN apk add --no-cache python3 py3-pip \
  && (pip install --no-cache-dir --break-system-packages semgrep \
      || echo "[build] semgrep nao instalado -- SecOpsAgent detecta a ausencia em runtime")

WORKDIR /workspace/apps/engine

CMD ["sh", "-c", "mix local.hex --force && mix local.rebar --force && mix deps.get && mix ecto.create && mix ecto.migrate && mix phx.server"]

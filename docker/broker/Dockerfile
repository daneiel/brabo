FROM node:24-alpine

# UID/GID do usuário que roda o container — mesmo desenho de
# `docker/api/Dockerfile`, e pela mesma razão: o que este processo escrever no
# bind mount do repositório nasce com o SEU dono, nunca root.
ARG DEV_UID=1000
ARG DEV_GID=1000

# O binário `docker` — e é ele, não o socket, que este serviço precisa ter
# instalado. É o preço da decisão do ADR 0128 (CLI dos dois lados, um mecanismo
# só), e ele está pago aqui de propósito: `docker-cli` é só o CLIENTE, sem
# daemon, sem containerd, sem nada que suba. O socket vem por volume, do
# compose, e SÓ para este serviço.
#
# Sem esta linha o serviço sobe e falha com `DockerCliAusenteError` na primeira
# operação — erro NOMEADO, separado de "daemon fora do ar", porque instalar e
# subir são consertos diferentes.
# hadolint ignore=DL3018
RUN apk add --no-cache docker-cli

RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

# Só cria grupo/usuário quando o UID/GID pedido diverge do que a imagem já tem
# — `node:24-alpine` já vem com o usuário "node" em 1000:1000.
RUN (getent group "$DEV_GID" >/dev/null 2>&1 || addgroup -g "$DEV_GID" devuser) \
  && (getent passwd "$DEV_UID" >/dev/null 2>&1 || adduser -D -u "$DEV_UID" -G "$(getent group "$DEV_GID" | cut -d: -f1)" devuser)

WORKDIR /workspace

# Os TRÊS volumes nomeados de `node_modules` do compose (`broker_root_...`,
# `broker_app_...`, `broker_port_...`) precisam existir aqui, com o dono
# certo, ANTES do USER — mesma convenção do CLAUDE.md que `/data/git-repos`/
# `/data/project-workspaces` já seguem nos outros Dockerfiles (RN-477): um
# volume nomeado NOVO nasce com o dono do caminho que existir NA IMAGEM, e
# quando o caminho não existe ele nasce root, deixando o processo non-root de
# fora. Testado empiricamente com um volume novo aninhado dentro do bind mount
# de `/workspace` — nasce `root:root`, e `pnpm install` como uid 1000 morreria
# com EACCES na primeira subida (`docker compose --profile container-broker
# up broker`). Diferente do broker não escrever em DISCO DE PROJETO (isso é
# verdade — ele fala com o socket e com HTTP), mas `node_modules` é disco dele
# mesmo, e o comentário anterior confundia as duas coisas.
RUN mkdir -p /workspace/node_modules /workspace/apps/broker/node_modules \
      /workspace/packages/docker-port/node_modules \
  && chown -R "${DEV_UID}:${DEV_GID}" /workspace/node_modules \
      /workspace/apps/broker/node_modules /workspace/packages/docker-port/node_modules

USER ${DEV_UID}:${DEV_GID}

# `--filter @brabo/broker...`: instala o broker e as dependências dele
# (incluindo `packages/docker-port`), nunca o workspace inteiro — `apps/runner`
# tem binding nativo (`node-pty`) que não compila aqui e não faz falta nenhuma.
#
# Roda por type stripping do Node (`node src/index.ts`), sem passo de build, o
# mesmo que `pnpm --filter runner start` faz em desenvolvimento. A imagem de
# PRODUÇÃO não faz assim, e o porquê está no `Dockerfile.prod` ao lado.
CMD ["sh", "-c", "pnpm install --frozen-lockfile=false --filter @brabo/broker... && pnpm --filter @brabo/broker start"]

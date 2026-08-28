FROM node:24-alpine

# UID/GID do usuário que roda o container — ver docker/api/Dockerfile, mesmo
# mecanismo (docker-compose.yml `build.args` + .env.example).
ARG DEV_UID=1000
ARG DEV_GID=1000

RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

RUN (getent group "$DEV_GID" >/dev/null 2>&1 || addgroup -g "$DEV_GID" devuser) \
  && (getent passwd "$DEV_UID" >/dev/null 2>&1 || adduser -D -u "$DEV_UID" -G "$(getent group "$DEV_GID" | cut -d: -f1)" devuser)

WORKDIR /workspace

USER ${DEV_UID}:${DEV_GID}

# `--filter web...`: instala só o web e as dependências dele (incluindo
# packages/shared e as deps da raiz), nunca o workspace inteiro — apps/runner
# (node-pty, binding nativo) roda na máquina do usuário e não existe aqui;
# instalá-lo no container faria o postinstall compilar com node-gyp e quebrar
# o boot (Alpine não tem Python/toolchain). Mesmo padrão do Dockerfile.prod.
CMD ["sh", "-c", "pnpm install --frozen-lockfile=false --filter web... && pnpm --filter web dev"]

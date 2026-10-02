FROM node:24-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81

# UID/GID do usuário que roda o container — ver docker/api/Dockerfile, mesmo
# mecanismo (docker-compose.yml `build.args` + .env.example).
ARG DEV_UID=1000
ARG DEV_GID=1000

# pnpm sem corepack (AT-360): o Node 25+ não traz corepack. Tarball do registry
# conferido contra o sha512 GRAVADO aqui (`npm view pnpm@<v> dist.integrity`, em
# hex), instalado em /usr/local/bin. A versão bate com o `packageManager` do
# package.json, então o pnpm nunca tenta baixar outra em runtime.
ARG PNPM_VERSION=11.3.0
ARG PNPM_SHA512=2c403d6594527287672b1f7056343a1f7c3634036a67ffabfcc2b3d7595d843768f8787148d1b57cf7956c90606bbd192857c363af19e96d2d0ec9ec5741d215
RUN npm pack "pnpm@${PNPM_VERSION}" --silent \
  && echo "${PNPM_SHA512}  pnpm-${PNPM_VERSION}.tgz" | sha512sum -c - \
  && npm i -g "./pnpm-${PNPM_VERSION}.tgz" \
  && rm "pnpm-${PNPM_VERSION}.tgz"

RUN (getent group "$DEV_GID" >/dev/null 2>&1 || addgroup -g "$DEV_GID" devuser) \
  && (getent passwd "$DEV_UID" >/dev/null 2>&1 || adduser -D -u "$DEV_UID" -G "$(getent group "$DEV_GID" | cut -d: -f1)" devuser)

WORKDIR /workspace

# Os TRÊS volumes de `node_modules` do serviço `web` (docker-compose.yml) nascem
# `root:root` quando o caminho não existe NA IMAGEM, e o `pnpm install` do CMD
# morre com EACCES (AT-172). Mesmo remédio das linhas de `/data` em
# docker/api/Dockerfile: criar e dar dono aos pontos de montagem antes do USER.
RUN mkdir -p /workspace/node_modules /workspace/apps/web/node_modules /workspace/packages/shared/node_modules \
  && chown "${DEV_UID}:${DEV_GID}" /workspace/node_modules /workspace/apps/web/node_modules /workspace/packages/shared/node_modules

USER ${DEV_UID}:${DEV_GID}

# `--filter web...`: instala só o web e as dependências dele (incluindo
# packages/shared e as deps da raiz), nunca o workspace inteiro — apps/runner
# (node-pty, binding nativo) roda na máquina do usuário e não existe aqui;
# instalá-lo no container faria o postinstall compilar com node-gyp e quebrar
# o boot (Alpine não tem Python/toolchain). Mesmo padrão do Dockerfile.prod.
CMD ["sh", "-c", "pnpm install --frozen-lockfile=false --filter web... && pnpm --filter web dev"]

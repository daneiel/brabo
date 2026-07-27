# Imagem de PRODUÇÃO do web (Fase 5): build do Vite servido por nginx. O
# Dockerfile de dev ao lado continua existindo e roda `vite dev` com bind mount.

# ---------------------------------------------------------------------------
# Estágio 1: build do bundle.
#
# ATENÇÃO — as VITE_* são COMPILE-TIME. O Vite substitui `import.meta.env.VITE_*`
# imagem: é uma imagem por ambiente, não a mesma imagem promovida entre eles.
# Registrado como limitação no ADR 0024 (a saída é injeção em runtime, fora do
# escopo desta sessão).
# ---------------------------------------------------------------------------
FROM node:24.11.1-alpine3.21 AS build

ARG VITE_API_URL=http://localhost:3000
ARG VITE_ENGINE_URL=http://localhost:4000

ENV VITE_API_URL=$VITE_API_URL \
    VITE_ENGINE_URL=$VITE_ENGINE_URL

RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

WORKDIR /repo

# Manifests primeiro: a camada de deps só invalida quando o lockfile muda.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile --filter web...

COPY apps/web apps/web
COPY packages/shared packages/shared
# design/tokens.css é input de build, não documentação: index.css faz
# `@import '../../../design/tokens.css'` e o vite resolve no filesystem.
COPY design design

# `build` = `tsc -b && vite build`: o typecheck faz parte do build, então erro de
# tipo quebra a imagem em vez de chegar em produção.
RUN pnpm --filter web build

# ---------------------------------------------------------------------------
# Estágio 2: nginx servindo o estático. Base pinada.
# ---------------------------------------------------------------------------
FROM nginx:1.27.5-alpine AS runtime

# Hosts liberados no `connect-src` do CSP — mudam por ambiente, então são
# substituídos em RUNTIME pelo entrypoint (diferente das VITE_*, que não podem).
ENV CSP_CONNECT_SRC="http://localhost:3000 http://localhost:4000 ws://localhost:4000 http://localhost:8080"

# Configuração de runtime da SPA: o entrypoint gera /config.js a partir destas,
# e é isto que permite promover a MESMA imagem entre ambientes em vez de
# rebuildar por ambiente (as VITE_* são compile-time — ADR 0024, limitação 1).
# Os defaults reproduzem o comportamento anterior, então a imagem continua
# subindo sem nenhuma variável definida.
ENV API_URL="http://localhost:3000" \
    ENGINE_URL="http://localhost:4000" \
    LOG_LEVEL="info"

# Fora de /etc/nginx de propósito: com rootfs read-only o entrypoint não pode
# escrever lá, então o template mora aqui e o resultado vai pra /tmp.
# `apk upgrade` antes de tudo: a tag da base é pinada (bom pra
# reprodutibilidade) mas congela junto os patches de segurança do Alpine — sem
# isto o trivy acusa CVEs de musl/zlib/libxml2 que já têm correção publicada.
# Roda ANTES do `USER nginx`, quando ainda há privilégio pra instalar.
# hadolint ignore=DL3018
RUN apk upgrade --no-cache

COPY docker/web/nginx.conf /templates/nginx.conf.template
COPY docker/web/entrypoint.sh /usr/local/bin/brabo-entrypoint.sh
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

# Prova, no build, que o bundle veio e que o envsubst existe nesta base (o
# entrypoint depende dele) — em vez de descobrir no boot do container.
RUN chmod 0755 /usr/local/bin/brabo-entrypoint.sh \
 && test -f /usr/share/nginx/html/index.html \
 && test -d /usr/share/nginx/html/assets \
 && command -v envsubst >/dev/null

# `nginx` (uid 101) já existe na imagem oficial — não criamos usuário novo.
USER nginx

# 8080, não 80: porta acima de 1024 é o que permite bind sem privilégio.
EXPOSE 8080

# Bate no /healthz estático do próprio nginx: não passa pelo fallback de SPA,
# então responde 200 mesmo se o docroot estiver vazio.
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/brabo-entrypoint.sh"]

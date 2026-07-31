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

# A versão é compile-time DE PROPÓSITO, e é a única VITE_* que quer ser (ADR
# 0036). Para as URLs, compile-time é a limitação que o `/config.js` resolve:
# elas são propriedade do AMBIENTE, e a mesma imagem precisa poder falar com api
# diferente em staging e produção. Versão é propriedade do ARTEFATO — assar
# `brabo-web:1.1.2` com a string "1.1.2" é o que impede a imagem de reportar
# outra coisa. O default "dev" é honesto: build fora do `release.yml` não nasceu
# de tag nenhuma.
ARG VITE_BRABO_VERSION=dev

ENV VITE_API_URL=$VITE_API_URL \
    VITE_ENGINE_URL=$VITE_ENGINE_URL \
    VITE_BRABO_VERSION=$VITE_BRABO_VERSION

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
#
# As fontes entram na conferência a partir do ADR 0036. Elas são auto-hospedadas
# porque a CSP desta imagem (`font-src 'self'`) bloqueia CDN, e o modo de falha é
# silencioso: sem os arquivos, as três famílias caem em fonte de sistema e só
# quem abre a página publicada percebe. Contar os .woff2 é o que impede uma
# imagem sem tipografia de subir — `test -d` sozinho passaria com a pasta vazia.
#
# O `find | wc -l` faz o hadolint pedir `-o pipefail` (DL4006), e aqui ele não
# acrescenta nada: se o `find` falhar, o `wc -l` imprime 0 e o `[ 0 -eq 8 ]`
# reprova o build de qualquer forma. Suprimido com o motivo, não por hábito.
# hadolint ignore=DL4006
RUN chmod 0755 /usr/local/bin/brabo-entrypoint.sh \
 && test -f /usr/share/nginx/html/index.html \
 && test -d /usr/share/nginx/html/assets \
 && test -d /usr/share/nginx/html/fonts \
 && [ "$(find /usr/share/nginx/html/fonts -name '*.woff2' | wc -l)" -eq 8 ] \
 && ! grep -rq 'fonts.googleapis.com' /usr/share/nginx/html/index.html \
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

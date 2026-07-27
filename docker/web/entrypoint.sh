#!/bin/sh
# Entrypoint do web de produção (Fase 5).
#
# Por que não usamos o entrypoint oficial da imagem nginx: ele (a) só roda os
# scripts de /docker-entrypoint.d quando o processo é root — rodando como
# `nginx` ele imprime "not running as root, skipping auto-configuration" e a
# substituição de variáveis NUNCA acontece; e (b) escreve o conf renderizado em
# /etc/nginx, que é read-only aqui. Então renderizamos nós mesmos para /tmp.
set -eu

TEMPLATE=/templates/nginx.conf.template
RENDERED=/tmp/nginx/nginx.conf

mkdir -p /tmp/nginx

# Lista explícita de variáveis: sem ela o envsubst comeria os `$uri`,
# `$host` etc. da própria config do nginx.
envsubst '${CSP_CONNECT_SRC}' < "$TEMPLATE" > "$RENDERED"

# ---------------------------------------------------------------------------
# Configuração de runtime da SPA.
#
# O Vite inlina `import.meta.env.VITE_*` no bundle em tempo de BUILD, o que
# promoção do mesmo artefato entre eles (dívida registrada no ADR 0024). Este
# arquivo é lido por src/lib/runtime-config.ts, que mantém as VITE_* como
# fallback para `pnpm dev:web`, onde não há nginx.
#
# Gerado por printf com escape, não por envsubst num template: o valor entra
# dentro de uma string JS, e uma aspa ou barra invertida numa URL quebraria o
# arquivo inteiro — e um /config.js com erro de sintaxe deixa a app carregar
# com a config errada em vez de falhar visivelmente.
js_escape() {
  printf '%s' "${1:-}" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

cat > /tmp/nginx/config.js <<EOF
window.__BRABO_CONFIG__ = {
  apiUrl: "$(js_escape "${API_URL:-}")",
  engineUrl: "$(js_escape "${ENGINE_URL:-}")",
  logLevel: "$(js_escape "${LOG_LEVEL:-}")"
};
EOF

# Falha cedo e com mensagem clara se a config renderizada for inválida, em vez
# de o container morrer no boot sem contexto.
nginx -t -c "$RENDERED"

exec nginx -c "$RENDERED" -g 'daemon off;'

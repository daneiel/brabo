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

# Falha cedo e com mensagem clara se a config renderizada for inválida, em vez
# de o container morrer no boot sem contexto.
nginx -t -c "$RENDERED"

exec nginx -c "$RENDERED" -g 'daemon off;'

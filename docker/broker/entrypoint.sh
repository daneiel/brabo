#!/bin/sh
# Entrypoint do broker em DESENVOLVIMENTO.
#
# POR QUE EXISTE: o `CMD` deste serviço rodava `pnpm install` no start, e isso
# deixou de ser possível quando o ADR 0146 (RN-512) o tirou do profile e ele
# passou a subir com `pnpm dev` — a única rede do broker é `internal: true`
# (primeira das cinco camadas de contenção do ADR 0130), então não há registry
# alcançável. O install migrou para o BUILD; o que sobra para o runtime é
# RECONCILIAR: os três `node_modules` são volumes nomeados montados por cima do
# que a imagem instalou, e o Docker só semeia um volume a partir da imagem
# quando ele está VAZIO. Volume que já existe fica velho em silêncio.
#
# O carimbo é o sha256 do `pnpm-lock.yaml` gravado no build. Ele responde as
# DUAS perguntas com um valor só: o volume tem o que esta imagem instalou? e
# esta imagem ainda descreve o lockfile da árvore de trabalho?
set -e

BAKED=/opt/broker-deps
CARIMBO_DA_IMAGEM=$(cat "${BAKED}/carimbo")
CARIMBO_DO_VOLUME=$(cat /workspace/node_modules/.brabo-broker-deps 2>/dev/null || true)

sincronizar() {
  # `rm` do CONTEÚDO, nunca do diretório: ele é o mountpoint do volume.
  find "$2" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  cp -a "$1/." "$2/"
}

if [ "${CARIMBO_DA_IMAGEM}" != "${CARIMBO_DO_VOLUME}" ]; then
  echo "broker: node_modules dos volumes (${CARIMBO_DO_VOLUME:-vazio}) diverge do que a imagem instalou (${CARIMBO_DA_IMAGEM}); sincronizando…"
  sincronizar "${BAKED}/root" /workspace/node_modules
  sincronizar "${BAKED}/app" /workspace/apps/broker/node_modules
  sincronizar "${BAKED}/port" /workspace/packages/docker-port/node_modules
  printf '%s\n' "${CARIMBO_DA_IMAGEM}" > /workspace/node_modules/.brabo-broker-deps
fi

# O aviso que a subida silenciosa não dava: a imagem foi construída contra um
# lockfile e a árvore de trabalho tem outro. Ele NÃO derruba o serviço — o
# broker não tem dependência de runtime além do link de workspace para
# `@brabo/docker-port`, e recusar subir por causa disso trocaria um aviso por
# uma indisponibilidade.
CARIMBO_DA_ARVORE=$(sha256sum /workspace/pnpm-lock.yaml | cut -d' ' -f1)
if [ "${CARIMBO_DA_ARVORE}" != "${CARIMBO_DA_IMAGEM}" ]; then
  echo "broker: AVISO — pnpm-lock.yaml mudou desde o build desta imagem. Rode: docker compose -f docker/docker-compose.yml --env-file .env up -d --build broker"
fi

exec pnpm --filter @brabo/broker start

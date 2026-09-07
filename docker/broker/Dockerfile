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

# COREPACK_HOME fora do `$HOME`, e isto é load-bearing NESTE serviço — não
# estética. O `corepack prepare` abaixo roda como ROOT, no build, e sem esta
# variável o pnpm preparado fica em `/root/.cache/node/corepack`, ilegível para
# o uid de runtime; o corepack então trata o pnpm como AUSENTE e tenta BAIXÁ-LO
# no start. A única rede deste serviço é `broker`, `internal: true`, então a
# tentativa morre com `getaddrinfo EAI_AGAIN registry.npmjs.org` e o container
# sai com 1 — que foi exatamente o que aconteceu quando o ADR 0146 (RN-512) o
# tirou do profile e ele passou a subir com `pnpm dev`.
#
# `docker/api/Dockerfile` tem o MESMO padrão de corepack e não sofre disso:
# a api tem egress e o download em runtime funciona. A diferença nunca foi o
# Dockerfile, foi a rede — e a rede é a primeira das cinco camadas de contenção
# do ADR 0130, então quem cede é o caminho do pnpm, nunca ela.
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

# Só cria grupo/usuário quando o UID/GID pedido diverge do que a imagem já tem
# — `node:24-alpine` já vem com o usuário "node" em 1000:1000.
RUN (getent group "$DEV_GID" >/dev/null 2>&1 || addgroup -g "$DEV_GID" devuser) \
  && (getent passwd "$DEV_UID" >/dev/null 2>&1 || adduser -D -u "$DEV_UID" -G "$(getent group "$DEV_GID" | cut -d: -f1)" devuser)

# O cache preparado acima passa a ser do usuário de runtime. `chown` e não
# `chmod a+rX`: o corepack ESCREVE nesse diretório (lock e last-known-good), e
# um cache só-leitura reproduziria o mesmo erro por outro caminho.
#
# `/opt/broker-deps` no mesmo passo, e ANTES do `USER`: `/opt` é root, e é lá
# que o install do build vai ser guardado para o entrypoint reconciliar.
RUN mkdir -p /opt/broker-deps \
  && chown -R "${DEV_UID}:${DEV_GID}" /opt/corepack /opt/broker-deps

WORKDIR /workspace

# Os TRÊS volumes nomeados de `node_modules` do compose (`broker_root_...`,
# `broker_app_...`, `broker_port_...`) precisam existir aqui, com o dono
# certo, ANTES do USER — mesma convenção do CLAUDE.md que `/data/git-repos`/
# `/data/project-workspaces` já seguem nos outros Dockerfiles (RN-477): um
# volume nomeado NOVO nasce com o dono do caminho que existir NA IMAGEM, e
# quando o caminho não existe ele nasce root, deixando o processo non-root de
# fora. Testado empiricamente com um volume novo aninhado dentro do bind mount
# de `/workspace` — nasce `root:root`, e `pnpm install` como uid 1000 morreria
# com EACCES na primeira subida. Diferente do broker não escrever em DISCO DE
# PROJETO (isso é verdade — ele fala com o socket e com HTTP), mas
# `node_modules` é disco dele mesmo.
RUN mkdir -p /workspace/node_modules /workspace/apps/broker/node_modules \
      /workspace/packages/docker-port/node_modules \
  && chown -R "${DEV_UID}:${DEV_GID}" /workspace

# Os manifestos, e SÓ eles — mesmo recorte de `Dockerfile.prod`. O código vem
# pelo bind mount em runtime; o que precisa existir na IMAGEM é o resultado do
# `pnpm install`, porque é ele que não pode acontecer em runtime.
COPY --chown=${DEV_UID}:${DEV_GID} package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=${DEV_UID}:${DEV_GID} apps/broker/package.json apps/broker/
COPY --chown=${DEV_UID}:${DEV_GID} packages/docker-port/package.json packages/docker-port/

USER ${DEV_UID}:${DEV_GID}

# O install MUDA DE MOMENTO: era o começo do `CMD`, passa a ser passo de BUILD.
# É a mesma razão do bloco do corepack — em runtime não há registry alcançável,
# e a resposta certa não é abrir a rede, é tirar o registry do caminho quente.
#
# `--filter @brabo/broker...`: o broker e as dependências dele (incluindo
# `packages/docker-port`), nunca o workspace inteiro — `apps/runner` tem
# binding nativo (`node-pty`) que não compila aqui e não faz falta nenhuma.
#
# `--frozen-lockfile=false` e não o `--frozen-lockfile` da imagem de produção:
# aqui o build acompanha uma árvore de trabalho, e reprovar o build de dev por
# lockfile fora de dia move o problema para longe de quem pode resolvê-lo.
RUN pnpm install --frozen-lockfile=false --filter @brabo/broker...

# A CÓPIA BAKED, e é aqui que mora a interação com os três volumes nomeados.
# Em runtime o compose monta um volume por cima de cada um dos três
# `node_modules` acima: o Docker semeia um volume a partir da imagem SÓ quando
# ele está vazio, então o que acabou de ser instalado chegaria na primeira
# subida e NUNCA mais — um volume que já existe (e todo desenvolvedor que
# subiu o broker quebrado tem os três) fica com o conteúdo velho, em silêncio.
#
# Guardar a árvore instalada FORA de `/workspace` (que o bind mount cobre
# inteiro) dá ao entrypoint uma fonte estável para reconciliar, e transforma
# "depende de o volume estar vazio" em "depende de o carimbo bater".
#
# O carimbo é o sha256 do `pnpm-lock.yaml` DA IMAGEM: ele identifica o que foi
# instalado e, comparado com o lockfile do bind mount, também responde se a
# imagem está velha — duas perguntas, um valor só.
RUN cp -a /workspace/node_modules /opt/broker-deps/root \
  && cp -a /workspace/apps/broker/node_modules /opt/broker-deps/app \
  && cp -a /workspace/packages/docker-port/node_modules /opt/broker-deps/port \
  && sha256sum /workspace/pnpm-lock.yaml | cut -d' ' -f1 > /opt/broker-deps/carimbo

COPY --chown=${DEV_UID}:${DEV_GID} docker/broker/entrypoint.sh /opt/broker-deps/entrypoint.sh

# Roda por type stripping do Node (`node src/index.ts`), sem passo de build, o
# mesmo que `pnpm --filter runner start` faz em desenvolvimento. A imagem de
# PRODUÇÃO não faz assim, e o porquê está no `Dockerfile.prod` ao lado.
CMD ["sh", "/opt/broker-deps/entrypoint.sh"]

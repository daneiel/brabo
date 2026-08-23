FROM node:24-alpine

RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

WORKDIR /workspace

# `--filter web...`: instala só o web e as dependências dele (incluindo
# packages/shared e as deps da raiz), nunca o workspace inteiro — apps/runner
# (node-pty, binding nativo) roda na máquina do usuário e não existe aqui;
# instalá-lo no container faria o postinstall compilar com node-gyp e quebrar
# o boot (Alpine não tem Python/toolchain). Mesmo padrão do Dockerfile.prod.
CMD ["sh", "-c", "pnpm install --frozen-lockfile=false --filter web... && pnpm --filter web dev"]

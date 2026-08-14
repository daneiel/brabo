---
id: scripts
title: Scripts e comandos
sidebar_label: Scripts
sidebar_position: 7
description: Todos os scripts pnpm e alvos do Makefile do repositório, extraídos da fonte.
keywords: [scripts, pnpm, make, comandos]
---

# Scripts e comandos

> ⚠️ Arquivo gerado por `pnpm docs:generate`. Não edite à mão — o próximo build sobrescreve.

Fonte: os `package.json` de cada pacote e o `Makefile` da raiz.

## Raiz — `package.json`

| comando | executa |
|---|---|
| `pnpm bootstrap` | `bash scripts/dev/bootstrap.sh` |
| `pnpm dev` | `node scripts/dev/preflight.mjs && docker compose -f docker/docker-compose.yml --env-file .env up` |
| `pnpm dev:build` | `node scripts/dev/preflight.mjs && docker compose -f docker/docker-compose.yml --env-file .env up --build` |
| `pnpm dev:down` | `docker compose -f docker/docker-compose.yml --env-file .env down` |
| `pnpm dev:gpu` | `node scripts/dev/preflight.mjs && docker compose -f docker/docker-compose.yml -f docker/docker-compose.gpu.yml --env-file .env up` |
| `pnpm dev:preflight` | `node scripts/dev/preflight.mjs` |
| `pnpm dev:api` | `pnpm --filter api start:dev` |
| `pnpm dev:web` | `pnpm --filter web dev` |
| `pnpm build` | `pnpm --filter api build && pnpm --filter web build` |
| `pnpm test` | `pnpm --filter api test && pnpm --filter web test` |
| `pnpm db:generate` | `pnpm --filter api db:generate` |
| `pnpm db:migrate` | `pnpm --filter api db:migrate` |
| `pnpm engine:setup` | `cd apps/engine && mix deps.get && mix ecto.create && mix ecto.migrate` |
| `pnpm engine:dev` | `cd apps/engine && mix phx.server` |
| `pnpm engine:test` | `cd apps/engine && mix test` |
| `pnpm engine:migrate` | `cd apps/engine && mix ecto.migrate` |
| `pnpm docs:start` | `pnpm --filter website start` |
| `pnpm docs:build` | `pnpm --filter website build` |
| `pnpm docs:serve` | `pnpm --filter website serve` |
| `pnpm docs:clear` | `pnpm --filter website clear` |
| `pnpm docs:generate` | `node scripts/docs/generate.mjs` |
| `pnpm docs:landing` | `node scripts/docs/landing.mjs` |
| `pnpm docs:check` | `node scripts/docs/docmap.mjs && node scripts/docs/generate.mjs --check` |
| `pnpm docs:drift` | `node scripts/docs/drift.mjs` |
| `pnpm docs:audit` | `node scripts/docs/audit.mjs` |

## api — `apps/api/package.json`

| comando | executa |
|---|---|
| `pnpm --filter api build` | `nest build` |
| `pnpm --filter api format` | `prettier --write "src/**/*.ts" "test/**/*.ts"` |
| `pnpm --filter api start` | `nest start` |
| `pnpm --filter api start:dev` | `nest start --watch` |
| `pnpm --filter api start:debug` | `nest start --debug --watch` |
| `pnpm --filter api start:prod` | `node dist/main` |
| `pnpm --filter api lint` | `eslint "{src,apps,libs,test}/**/*.ts" --fix` |
| `pnpm --filter api test` | `vitest run` |
| `pnpm --filter api typecheck` | `tsc -p tsconfig.build.json --noEmit` |
| `pnpm --filter api test:watch` | `vitest` |
| `pnpm --filter api test:cov` | `vitest run --coverage` |
| `pnpm --filter api seed` | `ts-node src/db/seed.ts` |
| `pnpm --filter api migrate:keycloak-users` | `ts-node src/scripts/migrate-keycloak-users.ts` |
| `pnpm --filter api openapi:export` | `ts-node src/scripts/export-openapi.ts` |
| `pnpm --filter api demo:repo-bootstrap` | `ts-node scripts/demo-repo-bootstrap.ts` |
| `pnpm --filter api demo:noop-execution` | `ts-node scripts/demo-noop-execution.ts` |
| `pnpm --filter api demo:dev-agent-real` | `ts-node scripts/demo-dev-agent-real.ts` |
| `pnpm --filter api demo:pr-gates` | `ts-node scripts/demo-pr-gates.ts` |
| `pnpm --filter api demo:pr-gates-area-qa` | `ts-node scripts/demo-pr-gates-area-qa.ts` |
| `pnpm --filter api demo:infra-agent` | `ts-node scripts/demo-infra-agent.ts` |
| `pnpm --filter api demo:infra-workflows-github` | `ts-node scripts/demo-infra-workflows-github.ts` |
| `pnpm --filter api demo:psicologo` | `ts-node scripts/demo-psicologo.ts` |
| `pnpm --filter api demo:anamnese` | `ts-node scripts/demo-anamnese.ts` |
| `pnpm --filter api validacao:fase-12` | `ts-node scripts/validacao-fase-12.ts` |
| `pnpm --filter api validacao:real` | `ts-node scripts/validacao-real.ts` |
| `pnpm --filter api validacao:gates` | `ts-node scripts/validacao-gates.ts` |
| `pnpm --filter api medir:execucao` | `ts-node scripts/medir-execucao.ts` |
| `pnpm --filter api gerar:areas` | `ts-node scripts/gerar-areas.ts` |
| `pnpm --filter api db:generate` | `drizzle-kit generate` |
| `pnpm --filter api db:migrate` | `drizzle-kit migrate` |

## web — `apps/web/package.json`

| comando | executa |
|---|---|
| `pnpm --filter web dev` | `vite` |
| `pnpm --filter web build` | `tsc -b && vite build` |
| `pnpm --filter web typecheck` | `tsc -b --force` |
| `pnpm --filter web lint` | `oxlint` |
| `pnpm --filter web preview` | `vite preview` |
| `pnpm --filter web test` | `vitest run` |

## website — `website/package.json`

| comando | executa |
|---|---|
| `pnpm --filter website docusaurus` | `docusaurus` |
| `pnpm --filter website start` | `docusaurus start` |
| `pnpm --filter website build` | `docusaurus build` |
| `pnpm --filter website swizzle` | `docusaurus swizzle` |
| `pnpm --filter website deploy` | `docusaurus deploy` |
| `pnpm --filter website clear` | `docusaurus clear` |
| `pnpm --filter website serve` | `docusaurus serve` |
| `pnpm --filter website write-translations` | `docusaurus write-translations` |
| `pnpm --filter website write-heading-ids` | `docusaurus write-heading-ids` |
| `pnpm --filter website typecheck` | `tsc` |

## scripts — `scripts/package.json`

| comando | executa |
|---|---|
| `pnpm --filter scripts test` | `vitest run` |
| `pnpm --filter scripts typecheck` | `tsc --noEmit` |

## Makefile

| alvo | faz |
|---|---|
| `make help` | Lista os alvos disponíveis |
| `make deploy-local` | Sobe o cluster local, instala tudo e roda o smoke test (TAG=vX.Y.Z-qa.N opcional) |
| `make deploy-local-clean` | Igual ao deploy-local, mas sem reconstruir as imagens |
| `make smoke-k8s` | Roda só o smoke contra o cluster já de pé |
| `make hpa-test` | Enche a fila do Oban e prova que o HPA do engine escala |
| `make rollout-test` | Abre sessões ativas, faz rollout restart e prova que nenhuma fica órfã |
| `make test-restore` | Dispara um backup real, restaura numa database nova e valida |
| `make k8s-validate` | Monta os overlays e valida contra o schema do Kubernetes |
| `make k8s-logs` | Últimas linhas de cada workload |
| `make k8s-down` | Remove o cluster local |

---

83 comandos no total. Alvo do Makefile sem anotação `## descrição` não aparece aqui — anote na fonte.

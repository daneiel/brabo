# Brabo

Plataforma de engenharia orquestrada por agentes. Ver `CLAUDE.md` para
escopo da Fase 1 e convenções.

## Setup (3 comandos)

```bash
cp .env.example .env
pnpm install
pnpm dev
```

`pnpm dev` sobe o `docker compose` (Postgres 16 + pgvector, Keycloak,
api, engine, web) com hot reload via bind mounts. Na primeira subida, a
api e o engine também aplicam suas migrações automaticamente contra o
mesmo Postgres (schemas separados — ver "Banco de dados" abaixo).

Depois de subir:

- Web (página de status): http://localhost:5173
- API: http://localhost:3000 (`GET /health`)
- Engine: http://localhost:4000 (`GET /health`)
- Keycloak: http://localhost:8080 (admin/admin, realm `brabo-dev`)

`pnpm dev:down` derruba tudo. `pnpm dev:build` força rebuild das imagens.

> Os containers de `api` e `web` rodam como root e escrevem `node_modules`
> e `apps/api/dist` direto no bind mount — se depois quiser buildar/testar
> `api` ou `web` localmente fora do Docker, use
> `docker compose exec api sh` (ou `web`) em vez de rodar `pnpm` no host,
> ou rode `sudo chown -R $USER apps/api/dist apps/*/node_modules` uma vez.

## Estrutura

```
apps/
  api/      NestJS 11 + Drizzle ORM (Postgres, schema "public")
  engine/   Elixir/OTP + Phoenix + Oban (Postgres, schema "engine")
  web/      React 19 + Vite + TanStack Query/Router
packages/
  shared/   Tipos TS compartilhados entre api e web (import type only)
design/     Placeholder do design system (fidelidade de UI — ver CLAUDE.md)
docker/     docker-compose.yml, Dockerfiles de dev, realm do Keycloak
spike/      Spikes técnicos descartáveis (fora do monorepo pnpm/mix)
```

`apps/engine` fica fora do workspace pnpm (é um projeto Mix, não Node),
mas tem scripts na raiz que delegam para `mix`:

```bash
pnpm engine:setup    # mix deps.get + ecto.create + ecto.migrate
pnpm engine:dev      # mix phx.server (fora do Docker)
pnpm engine:test     # mix test
pnpm engine:migrate  # mix ecto.migrate
```

## Banco de dados

Um único Postgres, uma única database (`brabo`), compartilhado pela api
e pelo engine — as tabelas de domínio de cada um isoladas no seu próprio
schema, para nunca colidir:

- **api (Drizzle)**: tabelas de domínio em `public`. Migrações em
  `apps/api/drizzle/`, aplicadas com `pnpm db:migrate` (ou
  `pnpm db:generate` após mudar `apps/api/src/db/schema.ts`). A migração
  inicial é intencionalmente vazia — ainda não há tabelas de domínio.
  O próprio drizzle-kit rastreia suas migrações em
  `drizzle.__drizzle_migrations` (schema à parte, criado por ele).
- **engine (Ecto/Oban)**: tabelas de domínio (e as do Oban) em `engine`
  — via `migration_default_prefix: "engine"` em
  `apps/engine/config/config.exs`. Migrações em
  `apps/engine/priv/repo/migrations/`. A tabela `schema_migrations` do
  próprio Ecto fica em `public` (comportamento padrão do Ecto) — não
  colide com nada da api, já que só existe essa tabela com esse nome.

pgvector é habilitado via `docker/postgres/init.sql`
(`CREATE EXTENSION IF NOT EXISTS vector`), que roda uma vez na criação
do volume de dados.

## Healthchecks

- `GET /health` na api: valida a conexão com o Postgres (`select 1`).
- `GET /health` no engine: idem, via `Ecto.Adapters.SQL.query/3`.
- A web renderiza `/` como uma página de status que consulta os dois
  endpoints acima (TanStack Query, poll a cada 5s) e mostra o resultado
  numa tabela.

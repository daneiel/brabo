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

- Web: http://localhost:5173 (login via Keycloak — client público
  `brabo-web`, PKCE; página de status em `/status`). Usuário de demo:
  **`admin` / `admin123`** (realm `brabo-dev`) — já dono do workspace
  "Demo", pronto pra criar projetos pela UI.
- API: http://localhost:3000 (`GET /health`)
- Engine: http://localhost:4000 (`GET /health`)
- Keycloak: http://localhost:8080 (admin/admin — console de administração
  do Keycloak em si, não confundir com o usuário de demo acima; realm
  `brabo-dev`)

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
  web/      React 19 + Vite + TanStack Query/Router — shell, dashboard,
            projeto (Visão geral/Sessões/Aprovações/Configurações) e
            sessão de chat com streaming SSE
packages/
  shared/   Tipos TS compartilhados entre api e web (import type only)
design/     Design system (tokens.css, COMPONENTS.md, SCREENS.md — fonte
            de verdade de UI, ver CLAUDE.md)
docker/     docker-compose.yml (dev) e docker-compose.prod.yml, Dockerfiles
            de dev e Dockerfile.prod de cada app, nginx.conf do web,
            smoke.sh, realm do Keycloak
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

> **Elixir 1.17.3 / OTP 27.1.2** é a versão do projeto — a mesma nos
> Dockerfiles e no CI. O `mix format` de versões mais novas produz saída
> diferente, então rodar o formatador de um host com Elixir mais recente
> deixa o `mix format --check-formatted` do CI vermelho. Se o seu host
> tiver outra versão, formate pelo container:
>
> ```bash
> docker run --rm -v "$PWD/apps/engine:/app" -w /app \
>   hexpm/elixir:1.17.3-erlang-27.1.2-alpine-3.20.3 mix format
> ```

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
- A web renderiza `/status` como uma página que consulta os dois
  endpoints acima (TanStack Query, poll a cada 5s) e mostra o resultado
  numa tabela.
- Nas imagens de produção esses mesmos endpoints são o `HEALTHCHECK` do
  container; o web serve um `/healthz` estático do próprio nginx.

## Imagens de produção

Separadas das de desenvolvimento: `docker/<app>/Dockerfile.prod`. São
multi-stage, rodam **non-root** com rootfs read-only, e não dependem de
bind mount — a api roda `node main.js` sobre o `dist`, o engine roda um
`mix release` (sem Mix, sem código-fonte) e o web é servido por nginx.

```bash
# sobe o sistema com as imagens de produção e valida
docker compose -f docker/docker-compose.prod.yml up -d --build --wait
bash docker/smoke.sh
docker compose -f docker/docker-compose.prod.yml down -v
```

O `smoke.sh` sobe o stack, confere que as três imagens rodam non-root,
faz login (password grant), cria workspace → projeto → sessão e checa o
health do engine e do web. É o mesmo script que o CI roda.

Para rodar ao lado do stack de desenvolvimento (que ocupa 3000/4000/8080),
sobrescreva as portas: `API_PORT`, `ENGINE_PORT`, `KEYCLOAK_PORT`,
`WEB_PORT`, e as `VITE_*`/`KEYCLOAK_ISSUER_URL` correspondentes.

### Volumes graváveis (api e engine compartilham)

| caminho | conteúdo |
|---|---|
| `/data/project-workspaces` | working tree por projeto, worktrees por agente em `.worktrees/<agent_id>`, `permissions.json` |
| `/data/git-repos` | bare repos locais (destino do `git push` do dev agent) |

**Os dois caminhos precisam ser idênticos nos dois containers.** A api
persiste o path absoluto do bare repo no banco e o engine o usa
literalmente; montar em lugares diferentes quebra o push com
`remote unpack failed`.

### Variáveis obrigatórias em produção

O engine **levanta no boot** sem `DATABASE_URL` ou `SECRET_KEY_BASE`, e
não escuta HTTP sem `PHX_SERVER=true`. `WEB_ORIGIN` precisa listar a
origem do web, senão o websocket dos canais (painel do time ao vivo) é
recusado. Na api, `CREDENTIALS_MASTER_KEY`, `GIT_OAUTH_STATE_SECRET` e
`API_KEYCLOAK_CLIENT_SECRET` têm default de desenvolvimento **só** no
compose.prod — em produção real vêm de um cofre.

> As `VITE_*` são **compile-time**: o Vite as inlina no bundle, então a
> imagem do web é específica do ambiente e mudar a URL da api exige
> rebuild, não restart. Ver ADR 0024.

## CI

`.github/workflows/ci.yml` roda em push para `feature/**` e em PR para
`dev`: lint em modo verificação, testes de api/web/engine, build das três
imagens com cache, trivy nas imagens, gitleaks no repositório e o teste de
fumaça. A configuração alvo da proteção da branch `dev` está no ADR 0024
(aplicá-la é manual, e hoje o plano do repositório não permite).

## Frontend (`apps/web`)

Autenticação via Keycloak (redireciona pro login se não houver sessão
válida). Depois do login, o app opera sobre o primeiro workspace do
usuário (sem troca de workspace ainda) e cobre:

- **Dashboard** (`/`): grid de projetos + wizard "Novo projeto".
- **Projeto** (`/projects/:projectId`): tabs Visão geral (time de
  agentes + feed de atividade), Sessões, Aprovações (fila + tabela de
  `permissions.json`) e Configurações (modelos por agente, membros,
  credenciais de provider).
- **Sessão** (`/projects/:projectId/sessions/:sessionId`): chat com
  streaming SSE, seletor de modelo, `TokenMeter` ao vivo e aprovação de
  ações inline.

Realtime é via polling (o canal Phoenix `session:<id>` existente é só
heartbeat). Testes de componente: `pnpm --filter web test`.

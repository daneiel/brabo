---
id: configuration
title: Configuration
sidebar_label: Configuration
sidebar_position: 1
description: All environment variables for the api, engine and web, with defaults and what breaks when they're wrong.
keywords: [configuration, environment variables, env, deploy]
---

# Configuration

All configuration is via **environment variable**. There is no application
config file — what exists is `permissions.json`, which is project policy, not
process configuration.

Two versioned files are read at runtime and are not configuration, although
they're easy to confuse with it: `permissions.json` above, and
`docs/gates.yml` ([ADR 0054](../adr/0054-gates-como-registro-declarativo.md)),
the declarative gate registry. Neither has an environment variable to point to
a path — the registry is found by walking up from `__dirname` — and neither
changes behavior by being edited in production: the registry DESCRIBES the
gates, it doesn't apply them. It travels inside the api image; see the
[runbook](../runbook.md#registro-de-gates).

The defaults below were extracted from the code, not from prior
documentation. The **when it fails** column is the part that saves time:
almost every variable has a default that works in development and a specific
failure mode in production.

> **Development defaults are insecure on purpose.** Values like
> `dev-master-key-change-me` exist so `pnpm dev` comes up without ceremony. In
> production they need to be changed — and for six of them the process
> **refuses** to boot without changing them (api or engine, marked with 🔒).
> Five follow the pattern of
> [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md)/[RN-093](../business-rules/custo.md#rn-093):
> missing, set to the public example literal, or too short brings the boot
> down. See [RN-114](../business-rules/custo.md#rn-114) for the four that joined the
> original `GIT_OAUTH_STATE_SECRET`.

## api

### Essentials

| variable | default | when it fails |
|---|---|---|
| `DATABASE_URL` | `postgres://brabo:brabo@localhost:5432/brabo` | without it, nothing comes up |
| `PORT` | `3000` | — |
| `NODE_ENV` | — | `production` turns on strict CORS and key validation |
| `API_PUBLIC_URL` | `http://localhost:3000` | used in git OAuth callbacks; wrong = broken callback |
| `ENGINE_URL` | `http://localhost:4000` in code, `http://engine:4000` in Compose | synchronous api→engine commands fail. **Leave it empty in `.env`**: set there, it wins over the Compose default and the api tries to talk to `localhost:4000` from inside its own container — every session activation dies with `ECONNREFUSED` and the frontend never moves. Each environment already has the right default without the line |
| `ENGINE_PUBLIC_URL` | same as `ENGINE_URL` | used only to build the `engineWsUrl` (WebSocket) returned in `POST .../runner-ticket`/`.../terminal-ticket` — the runner and the web can be OUTSIDE the cluster, so the internal address (`http://engine:4000`) doesn't work; `ENGINE_URL` remains the one used for the usual synchronous api→engine calls (RN-419) |
| `BRABO_VERSION` | `dev` | becomes `service.version` in the OpenTelemetry resource — it's how you know which build generated a trace. The release image injects the tag via a `docker-bake.hcl` `ARG`; outside of a release it stays `dev`. It does **not** appear in `/health`, which deliberately doesn't return the version (see the route's `description`) |
| `MIGRATIONS_FOLDER` | `./src/db/migrations` | — |

### Security 🔒

| variable | default | when it fails |
|---|---|---|
| `CREDENTIALS_MASTER_KEY` 🔒 | `dev-master-key-change-me` **only outside production** | wraps the DEKs. **In production the api refuses to boot** if it's missing, set to the default above (public — it's in `.env.example`), or shorter than 16 characters (RN-114). This is only the BOOT check: swapping it for a **valid but different** key without re-wrapping still makes every credential unreadable with no error at all — the failure shows up on first use. See [rotation](../runbook.md#rotacao-da-chave-mestra) |
| `CREDENTIALS_MASTER_KEY_PREVIOUS` | — | only during rotation. Present = the api tries the previous key when the current one fails |
| `GIT_OAUTH_STATE_SECRET` 🔒 | `dev-oauth-state-secret-change-me` **only outside production** | signs the OAuth `state`; weak = CSRF in the git connection flow. **In production the api refuses to boot** without it, with the default above (which is public — it's in `.env.example`), or with fewer than 16 characters. Generate with `openssl rand -base64 32`. See [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md) and [RN-093](../business-rules/custo.md#rn-093) |
| `WEB_ORIGIN` 🔒 | `http://localhost:${WEB_PORT}` | **in production the api refuses to boot** if it's missing or is `*`. CORS is strict per environment. **The port is part of the value**: the web on `:5174` is a different origin and gets blocked — see [ADR 0037](../adr/0037-cors-do-engine-e-a-porta-como-contrato.md). In the composes, the default **derives from `WEB_PORT`**, so changing the port carries CORS with it; setting `WEB_ORIGIN` by hand overrides the derivation and it becomes your responsibility to keep it consistent again |
| `WEB_PORT` | `5173` (dev) · `8088` (prod) | published port of the web on the host. Not read by any service — it **feeds the default of `WEB_ORIGIN`** in the composes, and that's what keeps port and CORS from diverging |

### First-party auth

Auth lives in the api's domain, and since the cutover it's also the sole
issuer. Decisions in
[ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md) and
[ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md).

| variable | default | what it does |
|---|---|---|
| `AUTH_JWT_SECRET` 🔒 | `dev-auth-jwt-secret-change-me` **only outside production** | passphrase the access token's Ed25519 pair is **derived** from via scrypt — no private key is committed. **In production the api refuses to boot** if it's missing, set to the default above (public — it's in `.env.example`), or shorter than 16 characters (RN-114) |
| `AUTH_JWT_SECRET_PREVIOUS` | — | accepted **only for verification**, during rotation; enters the JWKS and never signs |
| `AUTH_TOKEN_PEPPER` | `AUTH_JWT_SECRET` | HMAC key for hashing opaque tokens and the lockout bucket key |
| `AUTH_ACCESS_TOKEN_TTL_MS` | `900000` | 15 min |
| `AUTH_REFRESH_TOKEN_TTL_MS` | `1209600000` | 14 days |
| `AUTH_REFRESH_ABSOLUTE_TTL_MS` | `2592000000` | absolute ceiling of the family, counted from login — without it rotation grants an eternal session |
| `AUTH_REGISTRATION_ENABLED` | `true` | any value other than `"false"` keeps registration open |
| `AUTH_LOCKOUT_ENABLED` | `true` | same convention |
| `AUTH_LOCKOUT_WINDOW_MS` | `900000` | sliding window of the count |
| `AUTH_LOCKOUT_THRESHOLDS` | `5:30,8:300,12:900` | email bucket ladder, `failures:seconds` |
| `AUTH_LOCKOUT_IP_THRESHOLDS` | `20:30,30:120` | IP bucket ladder, more permissive and with a short ceiling |
| `AUTH_EMAIL_TOKEN_TTL_MS` | `172800000` | email verification, 48 h |
| `AUTH_RESET_TOKEN_TTL_MS` | `3600000` | password reset, 1 h |
| `AUTH_SET_PASSWORD_TTL_MS` | `604800000` | setting the first password (migrated user), 7 days — longer than the reset because the recipient didn't ask for it |
| `AUTH_IP_ATTEMPT_THRESHOLD` | `60` | ceiling of attempts per IP on the auth routes |
| `AUTH_MAIL_LOG_TOKENS` | `false` | **dev only**: prints the verification/reset token to the log |

> **The email ladder's ceiling equals the window on purpose.** With a sliding
> window, whoever keeps insisting pushes the window along and stays blocked
> for as long as they keep it up; whoever stopped comes back with a clean
> window. A ceiling **larger** than the window would create a lockout the
> window can't represent, and would require a persistent `locked_until`
> column with an unlock queue. Don't touch one without the other.

> **Rotating `AUTH_TOKEN_PEPPER` logs everyone out** and invalidates
> outstanding verification and reset tokens. Unlike the keys, the pepper does
> **not** have a `_PREVIOUS`. See the [runbook](../runbook.md).

### Real SMTP (MailSender)

`MailSender` sends real email only when `MAIL_TRANSPORT=smtp` — the default
is `log` (link/token go to the api's log, `AUTH_MAIL_LOG_TOKENS` above),
including in production: sending email is the operator's opt-in. Decision in
[ADR 0096](../adr/0096-smtp-real-no-mailsender.md).

| variable | default | what it does |
|---|---|---|
| `MAIL_TRANSPORT` | `log` | `log` (default) or `smtp`. Any other value falls back to `log` |
| `SMTP_HOST` 🔒 | — | SMTP provider host. **Only when `MAIL_TRANSPORT=smtp`**: in production the api refuses to boot if it's missing, whitespace-only, or set to the example value published in `.env.example` (RN-114) |
| `SMTP_PORT` | `587` | provider port — `587` is STARTTLS, `465` is implicit TLS (`SMTP_SECURE=true`) |
| `SMTP_SECURE` | `false` | `true` turns on implicit TLS on the connection (typically port 465) |
| `SMTP_USER` 🔒 | — | SMTP auth username. Same requirement as `SMTP_HOST` in production |
| `SMTP_PASSWORD` 🔒 | — | SMTP auth password/token. Same requirement as `SMTP_HOST` in production — **never appears in logs** |
| `SMTP_FROM` | — | sender, format `"Name <email@domain>"` (or just the email). Same requirement as `SMTP_HOST` in production, plus format validation |

> The email body is **plain text**, no HTML — the `MailSender` port doesn't
> carry structure for rich bodies, and a template engine would be an
> injection surface with no upside. The link uses `WEB_ORIGIN` (above).

### Development seed

Consumed by `pnpm --filter api seed`, not by the running api. Without an
external IdP, this is where the credential to log into the local web and the
smoke test comes from.

| variable | default | what it does |
|---|---|---|
| `BRABO_SEED_PASSWORD` | `brabo12345678` | password of the seeded users (`owner@brabo.dev`, `dev@brabo.dev`), created with email **already verified** |
| `BRABO_FORCE_SEED` | — | unlocks the seed with `NODE_ENV=production`, where it **refuses to run** by default. Do not set it in a real environment: the account is born with a known, verified password |

> The seed is idempotent and **doesn't touch the password** of anyone who
> already exists. Running it again after someone has changed their own
> password doesn't revert it.

### Rate limit

Sliding window in Postgres — there's no Redis
([ADR 0027](../adr/0027-fase5-backup-hardening-release.md)).

| variable | default | what it does |
|---|---|---|
| `RATE_LIMIT_ENABLED` | `true` | any value other than `"false"` keeps it on |
| `RATE_LIMIT_WINDOW_MS` | `60000` | window size |
| `RATE_LIMIT_USER` | `300` | requests per user per window |
| `RATE_LIMIT_IP` | `600` | requests per IP per window |

> If the rate limit table is unavailable, the request **goes through**. The
> guard protects against abuse, not unauthorized access — that's the job of
> the authentication guard, which runs first.

### Internal traffic 🔒

The shared secret that authenticates api ↔ engine. **The same variable on both
sides** — each one sends the current value and accepts both, and that's what
makes rotation possible without downtime ([RN-035](../business-rules/autenticacao.md#rn-035)).

| variable | default | what it does |
|---|---|---|
| `BRABO_SERVICE_TOKEN` 🔒 | `dev-service-token-change-me` **only outside production** | goes in the `X-Brabo-Service-Token` header and is what `EngineServiceGuard` compares in constant time. **In production the api refuses to boot** if it's missing, set to the default above (public — it's in `.env.example`), or shorter than 16 characters (RN-114) |
| `BRABO_SERVICE_TOKEN_PREVIOUS` | — | accepted **only for verification**, during rotation |

> Setting only the NEW value on one side (without going through the
> `_PREVIOUS` dance) doesn't break anyone's boot: the symptom is `403` on
> `/internal/*` and `401` on api-to-engine calls. Procedure in the
> [runbook](../runbook.md#rotacao-das-chaves-do-auth). The BOOT check above
> (RN-114) is a different thing: it only fails on the public default or a
> missing/short variable, not on a mismatch between the two sides.

### Git

| variable | default | note |
|---|---|---|
| `GIT_LOCAL_REPOS_ROOT` | `/tmp/brabo-git-repos` | Local provider. In `/tmp`, repos disappear on reboot |
| `PROJECT_WORKSPACES_ROOT` | `/tmp/brabo-project-workspaces` | project agent worktrees in **Container** mode. **Needs to be the same path on the engine**, and the same volume |
| `BRABO_PROJECTS_BASE` | empty | the single host folder under which **Mounted**-mode projects live, mounted by identity into `api` and `engine`. Empty is a NORMAL state: the api reports `projectsBase: null` and the project wizard doesn't offer Mounted mode at all |
| `GITHUB_OAUTH_CLIENT_ID` / `_SECRET` | empty | empty = GitHub OAuth connection unavailable (PAT still works) |
| `GITLAB_OAUTH_CLIENT_ID` / `_SECRET` | empty | same |

#### Project in Mounted mode: one base, mounted by identity

Since [ADR 0072](../adr/0072-projeto-local-ou-container.md), a project can be
born in **Mounted** mode (the old `local`, renamed by
[ADR 0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md))
— the code lives in a user folder and `PROJECT_WORKSPACES_ROOT` **doesn't
participate** in its root.

The path of a given project is a project-level datum
(`projects.workspace_path`), chosen at creation and never an environment
variable. What the ENVIRONMENT provides is the **base** those folders live
under — `BRABO_PROJECTS_BASE`, one per installation
([ADR 0141](../adr/0141-base-unica-dos-projetos-montados.md),
[RN-500](../business-rules.md#rn-500)):

```bash
# .env — ABSOLUTE. `~` is not expanded by Compose.
BRABO_PROJECTS_BASE=/home/voce/brabo
```

```yaml
# docker/docker-compose.yml — on BOTH `api` and `engine`, already written
    volumes:
      - ${BRABO_PROJECTS_BASE:-brabo_projects_base}:${BRABO_PROJECTS_BASE:-/data/brabo-projects-base}
```

The operator sets this **once** and restarts `api` + `engine`; nothing is
edited per project, ever. Before this, every mounted project needed a
hand-written bind-mount line in both services plus a restart — which kills
every in-flight agent turn, terminal socket and LLM call in the installation.

The mount is by **identity** (`$X:$X`): the same absolute path on the host and
inside both containers. That is what keeps honest the string the user types and
the screen shows back, and it is why `projectScopeRoot` (api) and
`Engine.Actions.Workspace.workspace_dir/2` (engine) need no translation layer.

**It is not `PROJECT_WORKSPACES_HOST_DIR`, and must never point at the same
folder.** A managed workspace is named by `workspace_dir_name` (UNIQUE) and a
mounted project is named by the user, so `<base>/loja` and a container project
whose folder name is `loja` would collide, with the repo bootstrap running
`git init` inside someone else's project. The ADR has the other two reasons.

With the variable **unset**, Mounted mode isn't offered — never offer a mode
the installation can't honor. And `pnpm dev` **refuses to start** when the base
overlaps the Brabo checkout in either direction; that check lives in the
preflight because it runs on the host, and the api can only compare against
`process.cwd()` (`/workspace` inside its own container). See the
[runbook](../runbook.md#projeto-no-modo-local).

### LLM

| variable | default | note |
|---|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` | — |
| `OLLAMA_REQUEST_TIMEOUT_MS` | `300000` | **inactivity** ceiling of the Ollama socket, not total duration. A local model has a different order of magnitude of latency to the first token, hence its own env var; see [inference environment](../runbook.md#ambiente-de-inferencia) |
| `LLM_REQUEST_TIMEOUT_MS` | `300000` | the same inactivity ceiling for the API providers (OpenAI and compatible, Anthropic). Applies to "didn't even send the headers" and to "stopped sending chunks mid-stream" — see [LLM providers](llm-providers.md#inactivity-ceiling) |

### Knowledge graph (ADR 0099)

| variable | default | note |
|---|---|---|
| `NEO4J_URI` | — | e.g. `bolt://neo4j:7687`. **This one is the switch**: empty = graph OFF, dependent routes degrade (`GraphUnavailableError`/503) — nobody needs a local Neo4j just to run the suite. In production, the absence of any of the three brings the boot down. Turning the graph on in development is this one line in `.env` and a restart of the api; until 2026-09-04 that did nothing, because the dev compose did not pass the three variables to the `api` service at all and the service has no `env_file` — `docker-compose.prod.yml` had supplied them since day one, which is why only development was affected |
| `NEO4J_USER` | `neo4j` (dev) | reaches the container with the same default the `neo4j` service uses for `NEO4J_AUTH`, so set it only to CHANGE the user — changing it there changes both sides at once. Two independent defaults would leave the api authenticating with credentials the server no longer has |
| `NEO4J_PASSWORD` 🔒 | `dev-neo4j-password-change-me` (dev only) | same pairing rule as `NEO4J_USER`. **No public default in production** on purpose — there's no plausible "example value" for a database password, and `docker-compose.prod.yml` keeps `NEO4J_AUTH` empty so the official image's own entrypoint refuses to start rather than booting with a guessable one |
| `GRAPH_PROJECTOR_INTERVAL_MS` | `2000` | period of the poller that drains the outbox's `graph_projection` queue and writes handoffs/hypotheses/profiles/interactions to the graph (RN-416) |

### Observability

| variable | default | note |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | **missing turns off EXPORT, not instrumentation** (ADR 0035). The span is still created and `trace_id` still shows up in the log — that's what gives correlation in development, without a collector. Without it, the span is discarded at the end instead of leaving the process |
| `OTEL_SERVICE_NAME` | `brabo-api` | — |
| `OTEL_DIAG_LOG` | — | `1` turns on OTel's own diagnostic log |
| `LOG_LEVEL` | `info` in production, `debug` outside | also decides the FORMAT together with `NODE_ENV`: outside production the log comes out readable (pino-pretty in-process, with the layer tree); in production, one JSON line per event |
| `METRICS_GAUGE_INTERVAL_MS` | `15000` | collection period of the domain gauges |

---

## engine

### Essentials

| variable | default | when it fails |
|---|---|---|
| `DATABASE_URL` | `ecto://brabo:brabo@localhost:5432/brabo` | note the `ecto://` scheme, not `postgres://` |
| `POSTGRES_HOST` / `_USER` / `_PASSWORD` | `localhost` / `brabo` / `brabo` | used when `DATABASE_URL` isn't assembled |
| `POOL_SIZE` | — | an exhausted pool jams Oban and the queue stops being consumed |
| `PORT` | `4000` | — |
| `PHX_HOST` / `PHX_SERVER` | — | `PHX_SERVER=true` is what makes the release serve HTTP |
| `SECRET_KEY_BASE` 🔒 | — | required in the release (`runtime.exs`, `:prod` block, Phoenix's default `raise`). Until RN-114, `docker-compose.prod.yml` supplied a public literal as a fallback and masked that `raise` — the variable always arrived SET. The `raise` itself didn't change |
| `API_URL` | `http://localhost:3000` | the engine calls the api back through here |
| `ECTO_IPV6` | — | — |
| `SKIP_MIGRATIONS` | — | used by the migration Job |

### Cluster and shutdown

| variable | default | note |
|---|---|---|
| `DNS_CLUSTER_QUERY` | — | the headless Service that forms the Erlang cluster. **Without it each replica is an island** and every rollout drains everything |
| `SHUTDOWN_DRAIN_TIMEOUT_MS` | `45000` | `preStop` window. Goes up **together** with `terminationGracePeriodSeconds`, never alone |
| `SESSION_HEARTBEAT_TIMEOUT_MS` | `30000` | — |
| `RELEASE_NAME` / `RELEASE_NODE` | — | node identity in the distribution |

### Harness

| variable | default | note |
|---|---|---|
| `TOOL_LOOP_MAX_ITERATIONS` | `8` | ceiling of loop turns for the **conversational** agent. Once exhausted, the agent ends with a blocking artifact |
| `TOOL_LOOP_MAX_ITERATIONS_EXECUCAO` | `60` | ceiling for **dev agents**. Higher because they explore the repository before writing — and because `task_budget_micros` keeps spend in check underneath |
| `TOOL_LOOP_MAX_ITERATIONS_GATE` | `60` | ceiling for **QA** subagents, for the same reason |
| `DEFAULT_CONTEXT_WINDOW` | `8192` | used when the model doesn't declare its window |
| `CONTEXT_COMPACTION_THRESHOLD` | `0.7` | fraction of the window that triggers compaction |
| `LLM_TURN_TIMEOUT_MS` | `300000` | 5 min per turn |
| `TERMINAL_ACTION_TIMEOUT_MS` | `15000` | ceiling for a terminal command |
| `TERMINAL_OUTPUT_MAX_BYTES` | `32768` | BYTE ceiling of a command's output ([RN-074](../business-rules/custo.md#rn-074)). The output stays in the loop's history and travels on every following turn; without a ceiling, a `find` over a large tree brings down the entire execution with a `413` from the provider |
| `READ_FILE_MAX_BYTES` | `32768` | BYTE ceiling of the content read by `read_file` ([RN-141](../business-rules/autenticacao.md#rn-141)) — same class of overflow as RN-074, through the `read_file` door instead of the terminal; independent variable, same value by coincidence of context |
| `SEARCH_WORKSPACE_MAX_BYTES` | `32768` | BYTE ceiling of `search_workspace`'s final text ([RN-150](../business-rules/autenticacao.md#rn-150)) — same class of overflow as RN-074/RN-141, through the search door; independent variable |
| `SEARCH_WORKSPACE_MAX_HITS` | `500` | ceiling on the NUMBER of hits `search_workspace` collects before assembling the response ([RN-150](../business-rules/autenticacao.md#rn-150)) — stops scanning/reading content as soon as it hits the ceiling, avoiding paying I/O for a tree with too many hits only to truncate by bytes afterward |
| `SECOPS_SCAN_TIMEOUT_MS` | `180000` | 3 min for the SecOps scanner |
| `TRANSPORT_MAX_BODY_BYTES` | `8388608` (8 MiB) | TRANSPORT ceiling that context compaction respects on top of the model's window ([RN-412](../business-rules.md#rn-412)) — the effective window is `min(context_window, this ceiling converted to tokens)`, so compaction fires BEFORE the body overflows the api's HTTP limit, not only when the model would "forget" |
| `GRAPH_INSTRUCTION_TEMPLATES_ENABLED` | `false` | turns on the `:graph` source of `InstructionFiles` — today only the ux-designer identity resolves a template from the graph before the inline text (RN-413). Its OWN name, not `GRAPH_TEMPLATES_ENABLED` below — the two would collide with opposite defaults if they shared the key |

### Psychologist

| variable | default | note |
|---|---|---|
| `PSYCHOLOGIST_ENABLED` | `false` | GLOBAL pause of NEW rounds (automatic and on-demand) — the user's product decision on 2026-08-10, not a bug, same pattern as `ANAMNESE_ENABLED` below. Doesn't erase anything that already exists. Turning it on requires restarting the engine ([RN-117](../business-rules/autenticacao.md#rn-117)) |
| `PSYCHOLOGIST_TRIAGE_THRESHOLD` | `20` | events in the session that separate a **light** analysis from a **heavy** one |
| `PSYCHOLOGIST_MAX_ITERATIONS_LEVE` / `_PESADA` | `4` / `8` | — |
| `PSYCHOLOGIST_BUDGET_MICROS_LEVE` / `_PESADA` | `50000` / `300000` | USD 0.05 and USD 0.30 per analysis |
| `PSYCHOLOGIST_MAX_PROMPT_EVENTS_LEVE` / `_PESADA` | `50` / `400` | how many events go into the prompt |
| `PSYCHOLOGIST_MAX_PAYLOAD_CHARS` | `600` | truncation of each event's payload |
| `PSYCHOLOGIST_RAG_TOP_K` | `3` | how many relevant `rag_search` snippets go into the context, deducted from the recent-events ceiling above ([RN-417](../business-rules.md#rn-417)) |
| `GRAPH_TEMPLATES_ENABLED` | `false` | turns on resolving `psychologist-kickoff`/`anamnese-kickoff` as a graph template — key SHARED between Psychologist and Anamnese (RN-417), not to be confused with `GRAPH_INSTRUCTION_TEMPLATES_ENABLED` above |

### Anamnese

| variable | default | note |
|---|---|---|
| `ANAMNESE_ENABLED` | `false` | GLOBAL pause of NEW rounds (periodic and on-demand) — the user's product decision on 2026-08-10, not a bug. Doesn't erase anything that already exists. Turning it on requires restarting the engine ([RN-115](../business-rules/autenticacao.md#rn-115)) |
| `ANAMNESE_INTERVAL_SECONDS` | `900` | 15 min between runs |
| `ANAMNESE_MIN_EVENTS` | `10` | below this it doesn't run — avoids profiling on noise |
| `ANAMNESE_INITIAL_WINDOW_DAYS` | `30` | window of the first run |
| `ANAMNESE_MAX_ITERATIONS` | `6` | — |
| `ANAMNESE_BUDGET_MICROS` | `200000` | USD 0.20 per run |
| `ANAMNESE_MAX_PROMPT_EVENTS` | `500` | — |
| `ANAMNESE_MAX_PAYLOAD_CHARS` | `600` | — |

### Load guards

| variable | default | note |
|---|---|---|
| `START_OUTBOX_DRAIN` | `true` | — |
| `START_ANAMNESE` | `true` | test/dev LOAD guard: prevents `kickoff/0` from even being called on boot, but doesn't decide anything about product — not to be confused with `ANAMNESE_ENABLED` (product: GLOBAL pause, survives any value of this one). Turning it off prevents **new** enqueues, **it doesn't clear the queue**. Accumulated jobs run on the next boot — the queue needs to be purged. See [inference environment](../runbook.md#ambiente-de-inferencia) |
| `START_MODEL_SYNC` | `true` | periodic tick of the model catalog sync. Turning it off doesn't freeze anything: the "Update catalog" button on the settings screen calls the same use case ([RN-043](../business-rules/custo.md#rn-043)) |
| `MODEL_SYNC_INTERVAL_SECONDS` | `21600` (6h) | a provider's catalog changes on a scale of days, and each round spends one API call per provider — hence the generous default |
| `START_GATE_RESCUE` | `true` | periodic tick of the gate-cycle rescue (`Engine.Gates.GateRescuer`, [RN-140](../business-rules.md#rn-140)). Turning it off doesn't change the boot: the rescue runs once there regardless |
| `GATE_RESCUE_INTERVAL_SECONDS` | `300` (5 min) | a stuck gate blocks the user's entire PR — a much shorter interval than Anamnese/model sync, and each tick costs only a query that's almost always empty |
| `GATE_RESCUE_STALE_AFTER_SECONDS` | `900` (15 min) | generous on purpose: a QA subagent's ToolLoop can legitimately run up to `TOOL_LOOP_MAX_ITERATIONS_GATE` (60) iterations, and a short threshold would rescue — and duplicate — a merely slow cycle |

### Internal traffic and observability

| variable | default |
|---|---|
| `BRABO_SERVICE_TOKEN` 🔒 | `dev-service-token-change-me` — **the same value as the api**. The BOOT check (RN-114) runs on the api side; the engine itself boots with any value (including empty), but in that scenario the api has already refused to boot first |
| `BRABO_SERVICE_TOKEN_PREVIOUS` 🔒 | — accepted only for verification, during rotation |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — the Elixir exporter speaks **HTTP/protobuf on 4318**, not gRPC on 4317. Missing turns off only the export (`traces_exporter: :none`), not instrumentation — see ADR 0035 |
| `WEB_ORIGIN` | — **the same variable as the api**, and it feeds TWO things here: the Phoenix socket's `check_origin` (the live team panel) and the HTTP CORS of the health routes, which the browser needs to read `/health` ([ADR 0037](../adr/0037-cors-do-engine-e-a-porta-como-contrato.md)). Missing in production closes CORS and keeps `check_origin` at Phoenix's strict default — the engine **still boots** regardless, unlike the api |
| `PROJECT_WORKSPACES_ROOT` | `/tmp/brabo-project-workspaces` — **same as the api's, on the same volume** |

> `SOME_APP_SSL_CERT_PATH`, `SOME_APP_SSL_KEY_PATH` and `MIX_TEST_PARTITION`
> are leftovers from the Phoenix scaffold and test configuration. Do not
> configure them.

---

## web

The web is static, served by nginx. It reads its configuration from **two**
sources, and the distinction matters:

| source | when | how |
|---|---|---|
| `import.meta.env.VITE_*` | **build** | baked into the bundle. Changing it requires a rebuild |
| `window.__BRABO_CONFIG__` | **runtime** | served at `/config.js`, generated by the container's entrypoint |

That's why the same image serves every environment: `/config.js` is rewritten
at boot. The `VITE_*` vars are the development fallback.

| variable | serves for |
|---|---|
| `VITE_API_URL` | api address |
| `VITE_ENGINE_URL` | engine address (Phoenix channel) |
| `VITE_LOG_LEVEL` | level of the browser's JSON logger (default `info`). In a cluster the `WEB_LOG_LEVEL` key of `brabo-config` is in charge, which the entrypoint writes to `/config.js` — `VITE_*` only counts in a local build |
| `VITE_BRABO_VERSION` | version shown in the footer of the auth screens (default `dev`). **The only one that's build-time by choice, not by limitation** — see below |

A blank page after deploy is almost always `/config.js` pointing to
`localhost` — the deploy smoke test checks exactly that.

### Why the version doesn't go through `/config.js`

URLs belong to the **environment**: the same image needs to talk to the
staging api and to the production api, and that's what `/config.js` exists
for (ADR 0024). The version belongs to the **artifact** — the image
`brabo-web:1.1.2` shouldn't be able to report anything else. If it came from
`/config.js`, the footer would become an editable field instead of an
identity, and a wrong ConfigMap would make the screen lie about which build
is running.

The full path, from commit to screen: `release.yml` computes
`versao=${TAG#v}` → passes it as `VERSION` to `docker buildx bake` → the
`web` target of `docker-bake.hcl` converts it into `VITE_BRABO_VERSION` → the
`ARG`/`ENV` of `docker/web/Dockerfile.prod` exposes it to `pnpm build` → Vite
inlines it into `import.meta.env` → `runtime-config.ts` reads it →
`AuthLayout` shows it. The same `VERSION` feeds the api image's
`BRABO_VERSION` (ADR 0036).

---

## Backup

Consumed by the CronJob, not by the apps. Details in
[Restore](../runbook.md#restore).

| variable | default | note |
|---|---|---|
| `BACKUP_S3_ENDPOINT` / `BACKUP_S3_BUCKET` | — | S3-compatible destination |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | — | bucket credential |
| `BACKUP_KEEP_DAILY` | `7` | retention by **count**, not by age |
| `BACKUP_KEEP_WEEKLY` | `4` | — |
| `RESTORE_DB` | — | name of the restore's destination database |
| `RESTORE_PREFIX` | `daily/` | `weekly/` to restore from a weekly copy |
| `RESTORE_ADMIN_URL` | — | connection with `CREATEDB` permission; in production it's separate from `DATABASE_URL` |

## Local inference (containers)

These are not read by our code — they belong to the `ollama` container, and
they're here because they're the most frequent cause of an agent behaving
strangely. The symptom table is in
[inference environment](../runbook.md#ambiente-de-inferencia).

| variable | why |
|---|---|
| `OLLAMA_CONTEXT_LENGTH` | the default of 4096 **silently** truncates a prompt built for 128k |
| `OLLAMA_MAX_LOADED_MODELS` | with a high `OLLAMA_KEEP_ALIVE`, models pile up until memory overflows |
| `OLLAMA_KEEP_ALIVE` | how long the model stays resident |
| `DEMO_QA_MODEL` | points the QA gate to an API model — the per-agent binding wins over the project's |

---

## Local observability (containers)

Also not read by our code: these are the ports of the
`docker/docker-compose.observability.yml` overlay, which brings up
Prometheus, Loki and Grafana alongside the development stack (`pnpm dev:obs`).
The mechanism is in [local observability](../runbook.md#observabilidade-local).

| variable | default | why |
|---|---|---|
| `GRAFANA_PORT` | `3001` | same port the cluster's Grafana uses; the two **don't coexist**, for the same reason `pnpm dev` and `make deploy-local` don't coexist |
| `PROMETHEUS_PORT` | `9090` | the port the runbook already uses in the cluster's `kubectl port-forward` |
| `LOKI_PORT` | `3100` | only for querying directly; the normal path is through Grafana |

The overlay does **not** define `OTEL_EXPORTER_OTLP_ENDPOINT`: without a
Collector in between, pointing the apps at an address that doesn't exist just
produces an export error on every turn
([ADR 0035](../adr/0035-observabilidade-legivel-e-trace-sem-coletor.md)
separated instrumenting from exporting exactly for this reason). Metrics and
logs work without it; traces still require the cluster.

---

## Container broker

The broker ([ADR 0130](../adr/0130-broker-de-container.md)) is the only process
in the product that talks to a Docker daemon on the server, and the only service
with `/var/run/docker.sock` mounted. It ships under
`profiles: ["container-broker"]` in both compose files, so **it does not come up
by default** — giving every development machine access to the host's Docker in
exchange for nothing would be a posture change with no counterpart. Bring it up
with:

```bash
docker compose -f docker/docker-compose.yml --env-file .env \
  --profile container-broker up -d broker
```

| variable | default | when it fails |
|---|---|---|
| `BROKER_URL` | empty (read by the **api**) | Empty is a NORMAL state: whoever reads a container's observed state then says "not observed" instead of inheriting the recorded one ([RN-486](../business-rules.md#rn-486)). Point it at `http://broker:8090` when the profile is on |
| `BROKER_PORT` | `8090` | Port the broker listens on. It publishes NOTHING to the host — only the api reaches it, through the `internal: true` compose network |
| `BRABO_SERVICE_TOKEN` 🔒 | `dev-service-token-change-me` in development | The SAME secret as api ↔ engine, in the same header. With `NODE_ENV=production` the broker refuses to boot when it is empty, when it is the repository's public literal, or under 16 characters — the RN-114 rule, which here guards a process that talks to the host's Docker |
| `API_URL` | `http://api:3000` | Where the broker READS the Architect's decision. It does not receive a container spec; it comes and gets one ([RN-485](../business-rules.md#rn-485)) |
| `PROJECT_WORKSPACES_HOST_ROOT` | — | The project folders' root **on the HOST**, not inside any container. Without it, `start` refuses naming this variable and the other four operations keep working. Do not confuse it with `PROJECT_WORKSPACES_ROOT`, which is the path inside the containers: `-v` is resolved by the DAEMON against the host filesystem, and a path from inside the api would make it create and mount an EMPTY folder |
| `DOCKER_GID` | `999` (compose) | The gid of the host's `docker` group (`getent group docker \| cut -d: -f3`). The socket is `root:docker` and the broker runs non-root, so compose uses `group_add`. The default is the most common one and is wrong on several distributions — getting it wrong produces "permission denied" on the socket, which `DockerIndisponivelError` names with the group hint |

`PROJECT_WORKSPACES_HOST_ROOT` has no default and cannot be derived from a
managed Docker volume — pair it with `PROJECT_WORKSPACES_HOST_DIR` (above) and
repeat the same path here, ALREADY EXPANDED (`~` is not expanded by Compose).

`BRABO_PROJECTS_HOST_BASE` is the broker's SECOND root — the base of **Mounted**
projects, also on the host
([ADR 0141](../adr/0141-base-unica-dos-projetos-montados.md),
[ADR 0142](../adr/0142-a-segunda-raiz-do-broker.md)). Unlike the one above it
does not need to be filled in: the compose derives it from
`BRABO_PROJECTS_BASE`, which is already a host path by definition (it is what
`api` and `engine` mount by identity). Set it explicitly only if the Docker
daemon reaches that folder by a different path.

It is what makes a **Mounted** project able to have a container at all
([RN-501](../business-rules.md#rn-501)): the api sends a discriminated locator
(`localizacao.tipo` — `gerenciada` or `montada`) plus the relative segment, and
the broker resolves it against the matching root. The two roots never stand in
for each other. Missing this one makes `start` of a `mounted` project refuse
with **503**, NAMING the variable, without touching a container — falling back
to `PROJECT_WORKSPACES_HOST_ROOT` would mount another project's folder, because
the managed root is named by `workspace_dir_name` and the base is named by the
user.


---

## Dev container user (build-time)

Not read by our code either, and not even a *runtime* environment variable:
these are Docker `build.args` for the three dev images (`docker/api/Dockerfile`,
`docker/web/Dockerfile`, `docker/engine/Dockerfile`), consulted once at
`docker compose build` and baked into the `USER` each container runs as. They
exist so the containers run with the **same UID/GID as your host user**
instead of root — everything written to a bind mount (`apps/api/dist`, a
project workspace in `mounted` execution mode) is then already yours, no
`sudo chown` needed afterward.

| variable | default | why |
|---|---|---|
| `DEV_UID` | `1000` | your `id -u`. NOT read from the shell's `${UID}` — it's read-only in bash and isn't exported to the environment by default, so the compose file would always see it empty |
| `DEV_GID` | `1000` | your `id -g`, same reasoning |

`1000`/`1000` matches both the most common single-developer Linux setup and
the `node` user that `node:24-alpine` (the `api`/`web` base image) already
ships — when your pair matches, the Dockerfiles reuse that built-in user
instead of creating a new one. An environment that already has containers
running as root from before this change needs a one-time `chown` of the
`node_modules`/`_build`/`deps`/`.mix`/`.hex` named volumes (or
`docker compose down -v` to let them be recreated) — see the note in
[Getting started](../getting-started.md).

---

## Full inventory

The tables above explain **what each variable does**. This section is the
**inventory**: extracted from the code on every `pnpm docs:generate`, it
exists so that a new variable doesn't go undocumented anywhere without
anyone noticing.

<!-- BEGIN:GENERATED:env-inventario -->

> ⚠️ Block generated by `pnpm docs:generate`. Do not edit by hand — the next build overwrites it.

Inventory extracted from the code: **131 variables** read at runtime. **2** still have no description in the tables above.

**api** — 58 variables

- `API_PUBLIC_URL` <sub>(apps/api/src/application/use-cases/auth/start-social-login.use-case.ts)</sub>
- `AUTH_ACCESS_TOKEN_TTL_MS` <sub>(apps/api/src/infrastructure/security/ed25519-access-token-issuer.ts)</sub>
- `AUTH_EMAIL_TOKEN_TTL_MS` <sub>(apps/api/src/application/use-cases/auth/auth-config.ts)</sub>
- `AUTH_IP_ATTEMPT_THRESHOLD` <sub>(apps/api/src/application/use-cases/auth/auth-config.ts)</sub>
- `AUTH_JWT_SECRET` <sub>(apps/api/src/infrastructure/security/auth-key-material.ts)</sub>
- `AUTH_JWT_SECRET_PREVIOUS` <sub>(apps/api/src/infrastructure/security/auth-key-material.ts)</sub>
- `AUTH_LOCKOUT_ENABLED` <sub>(apps/api/src/infrastructure/persistence/drizzle/drizzle-login-throttle.ts)</sub>
- `AUTH_LOCKOUT_IP_THRESHOLDS` <sub>(apps/api/src/infrastructure/persistence/drizzle/drizzle-login-throttle.ts)</sub>
- `AUTH_LOCKOUT_THRESHOLDS` <sub>(apps/api/src/infrastructure/persistence/drizzle/drizzle-login-throttle.ts)</sub>
- `AUTH_LOCKOUT_WINDOW_MS` <sub>(apps/api/src/infrastructure/persistence/drizzle/drizzle-login-throttle.ts)</sub>
- `AUTH_MAIL_LOG_TOKENS` <sub>(apps/api/src/infrastructure/mail/log-mail-sender.ts)</sub>
- `AUTH_REFRESH_ABSOLUTE_TTL_MS` <sub>(apps/api/src/application/use-cases/auth/auth-config.ts)</sub>
- `AUTH_REFRESH_TOKEN_TTL_MS` <sub>(apps/api/src/application/use-cases/auth/auth-config.ts)</sub>
- `AUTH_REGISTRATION_ENABLED` <sub>(apps/api/src/application/use-cases/auth/auth-config.ts)</sub>
- `AUTH_RESET_TOKEN_TTL_MS` <sub>(apps/api/src/application/use-cases/auth/auth-config.ts)</sub>
- `AUTH_SET_PASSWORD_TTL_MS` <sub>(apps/api/src/application/use-cases/auth/auth-config.ts)</sub>
- `AUTH_TOKEN_PEPPER` <sub>(apps/api/src/infrastructure/security/auth-key-material.ts)</sub>
- `BRABO_FORCE_SEED` <sub>(apps/api/src/scripts/provisionar-usuario.ts)</sub>
- `BRABO_PROJECTS_BASE` <sub>(apps/api/src/infrastructure/filesystem/project-workspaces-root.ts)</sub>
- `BRABO_SEED_PASSWORD` <sub>(apps/api/src/db/seed.ts)</sub>
- `BRABO_SERVICE_TOKEN` <sub>(apps/api/src/infrastructure/security/service-token.ts)</sub>
- `BRABO_SERVICE_TOKEN_PREVIOUS` <sub>(apps/api/src/infrastructure/security/service-token.ts)</sub>
- `BROKER_URL` <sub>(apps/api/src/infrastructure/http-clients/container-broker.client.ts)</sub>
- `CREDENTIALS_MASTER_KEY` <sub>(apps/api/src/infrastructure/security/envelope-encryption.service.ts)</sub>
- `CREDENTIALS_MASTER_KEY_PREVIOUS` <sub>(apps/api/src/infrastructure/security/envelope-encryption.service.ts)</sub>
- `DATABASE_URL` <sub>(apps/api/src/db/migrate.ts)</sub>
- `ENGINE_PUBLIC_URL` <sub>(apps/api/src/application/use-cases/runner/request-runner-ticket.use-case.ts)</sub>
- `ENGINE_URL` <sub>(apps/api/src/application/use-cases/runner/request-runner-ticket.use-case.ts)</sub>
- `GIT_LOCAL_REPOS_ROOT` <sub>(apps/api/src/infrastructure/git/local-git-provider.ts)</sub>
- `GIT_OAUTH_STATE_SECRET` <sub>(apps/api/src/infrastructure/security/oauth-state-secret.ts)</sub>
- `GITHUB_OAUTH_CLIENT_ID` <sub>(apps/api/src/infrastructure/git/github-oauth-client.ts)</sub>
- `GITHUB_OAUTH_CLIENT_SECRET` <sub>(apps/api/src/infrastructure/git/github-oauth-client.ts)</sub>
- `GITLAB_OAUTH_CLIENT_ID` <sub>(apps/api/src/infrastructure/git/gitlab-oauth-client.ts)</sub>
- `GITLAB_OAUTH_CLIENT_SECRET` <sub>(apps/api/src/infrastructure/git/gitlab-oauth-client.ts)</sub>
- `GRAPH_PROJECTOR_INTERVAL_MS` <sub>(apps/api/src/application/graph-projection/graph-projector.ts)</sub>
- `HUGGINGFACE_API_TOKEN` — ⚠️ **no description above** <sub>(apps/api/src/infrastructure/huggingface/huggingface-client.ts)</sub>
- `HUGGINGFACE_HUB_URL` — ⚠️ **no description above** <sub>(apps/api/src/infrastructure/huggingface/huggingface-client.ts)</sub>
- `LOG_LEVEL` <sub>(apps/api/src/infrastructure/observability/logger.config.ts)</sub>
- `MAIL_TRANSPORT` <sub>(apps/api/src/infrastructure/mail/smtp-config.ts)</sub>
- `METRICS_GAUGE_INTERVAL_MS` <sub>(apps/api/src/infrastructure/observability/domain-gauges.collector.ts)</sub>
- `MIGRATIONS_FOLDER` <sub>(apps/api/src/db/migrate.ts)</sub>
- `NEO4J_PASSWORD` <sub>(apps/api/src/infrastructure/graph/neo4j-config.ts)</sub>
- `NEO4J_URI` <sub>(apps/api/src/infrastructure/graph/neo4j-config.ts)</sub>
- `NEO4J_USER` <sub>(apps/api/src/infrastructure/graph/neo4j-config.ts)</sub>
- `NODE_ENV` <sub>(apps/api/src/infrastructure/graph/neo4j-config.ts)</sub>
- `OLLAMA_HOST` <sub>(apps/api/src/infrastructure/llm/ollama-provider.ts)</sub>
- `PROJECT_WORKSPACES_ROOT` <sub>(apps/api/src/infrastructure/filesystem/project-workspaces-root.ts)</sub>
- `RATE_LIMIT_ENABLED` <sub>(apps/api/src/interfaces/http/shared/rate-limit.guard.ts)</sub>
- `RATE_LIMIT_IP` <sub>(apps/api/src/interfaces/http/shared/rate-limit.guard.ts)</sub>
- `RATE_LIMIT_USER` <sub>(apps/api/src/interfaces/http/shared/rate-limit.guard.ts)</sub>
- `RATE_LIMIT_WINDOW_MS` <sub>(apps/api/src/infrastructure/observability/domain-gauges.collector.ts)</sub>
- `SMTP_FROM` <sub>(apps/api/src/infrastructure/mail/smtp-config.ts)</sub>
- `SMTP_HOST` <sub>(apps/api/src/infrastructure/mail/smtp-config.ts)</sub>
- `SMTP_PASSWORD` <sub>(apps/api/src/infrastructure/mail/smtp-config.ts)</sub>
- `SMTP_PORT` <sub>(apps/api/src/infrastructure/mail/smtp-config.ts)</sub>
- `SMTP_SECURE` <sub>(apps/api/src/infrastructure/mail/smtp-config.ts)</sub>
- `SMTP_USER` <sub>(apps/api/src/infrastructure/mail/smtp-config.ts)</sub>
- `WEB_ORIGIN` <sub>(apps/api/src/infrastructure/mail/smtp-mail-sender.ts)</sub>

**engine** — 62 variables

- `ANAMNESE_BUDGET_MICROS` <sub>(apps/engine/config/runtime.exs)</sub>
- `ANAMNESE_ENABLED` <sub>(apps/engine/config/runtime.exs)</sub>
- `ANAMNESE_INITIAL_WINDOW_DAYS` <sub>(apps/engine/config/runtime.exs)</sub>
- `ANAMNESE_INTERVAL_SECONDS` <sub>(apps/engine/config/runtime.exs)</sub>
- `ANAMNESE_MAX_ITERATIONS` <sub>(apps/engine/config/runtime.exs)</sub>
- `ANAMNESE_MAX_PAYLOAD_CHARS` <sub>(apps/engine/config/runtime.exs)</sub>
- `ANAMNESE_MAX_PROMPT_EVENTS` <sub>(apps/engine/config/runtime.exs)</sub>
- `ANAMNESE_MIN_EVENTS` <sub>(apps/engine/config/runtime.exs)</sub>
- `API_URL` <sub>(apps/engine/config/runtime.exs)</sub>
- `BRABO_SERVICE_TOKEN` <sub>(apps/engine/config/runtime.exs)</sub>
- `BRABO_SERVICE_TOKEN_PREVIOUS` <sub>(apps/engine/config/runtime.exs)</sub>
- `CONTEXT_COMPACTION_THRESHOLD` <sub>(apps/engine/config/runtime.exs)</sub>
- `DATABASE_URL` <sub>(apps/engine/config/dev.exs)</sub>
- `DEFAULT_CONTEXT_WINDOW` <sub>(apps/engine/config/runtime.exs)</sub>
- `DNS_CLUSTER_QUERY` <sub>(apps/engine/config/runtime.exs)</sub>
- `ECTO_IPV6` <sub>(apps/engine/config/runtime.exs)</sub>
- `GATE_RESCUE_INTERVAL_SECONDS` <sub>(apps/engine/config/runtime.exs)</sub>
- `GATE_RESCUE_STALE_AFTER_SECONDS` <sub>(apps/engine/config/runtime.exs)</sub>
- `GRAPH_INSTRUCTION_TEMPLATES_ENABLED` <sub>(apps/engine/config/runtime.exs)</sub>
- `GRAPH_TEMPLATES_ENABLED` <sub>(apps/engine/config/runtime.exs)</sub>
- `LLM_TURN_TIMEOUT_MS` <sub>(apps/engine/config/runtime.exs)</sub>
- `MIX_TEST_PARTITION` <sub>(apps/engine/config/test.exs)</sub>
- `MODEL_SYNC_INTERVAL_SECONDS` <sub>(apps/engine/config/runtime.exs)</sub>
- `OTEL_EXPORTER_OTLP_ENDPOINT` <sub>(apps/engine/config/runtime.exs)</sub>
- `PHX_HOST` <sub>(apps/engine/config/runtime.exs)</sub>
- `PHX_SERVER` <sub>(apps/engine/config/runtime.exs)</sub>
- `POOL_SIZE` <sub>(apps/engine/config/runtime.exs)</sub>
- `PORT` <sub>(apps/engine/config/runtime.exs)</sub>
- `POSTGRES_HOST` <sub>(apps/engine/config/test.exs)</sub>
- `POSTGRES_PASSWORD` <sub>(apps/engine/config/test.exs)</sub>
- `POSTGRES_USER` <sub>(apps/engine/config/test.exs)</sub>
- `PROJECT_WORKSPACES_ROOT` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_BUDGET_MICROS_LEVE` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_BUDGET_MICROS_PESADA` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_ENABLED` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_MAX_ITERATIONS_LEVE` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_MAX_ITERATIONS_PESADA` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_MAX_PAYLOAD_CHARS` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_MAX_PROMPT_EVENTS_LEVE` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_MAX_PROMPT_EVENTS_PESADA` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_RAG_TOP_K` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_TRIAGE_THRESHOLD` <sub>(apps/engine/config/runtime.exs)</sub>
- `READ_FILE_MAX_BYTES` <sub>(apps/engine/config/runtime.exs)</sub>
- `SEARCH_WORKSPACE_MAX_BYTES` <sub>(apps/engine/config/runtime.exs)</sub>
- `SEARCH_WORKSPACE_MAX_HITS` <sub>(apps/engine/config/runtime.exs)</sub>
- `SECOPS_SCAN_TIMEOUT_MS` <sub>(apps/engine/config/runtime.exs)</sub>
- `SECRET_KEY_BASE` <sub>(apps/engine/config/runtime.exs)</sub>
- `SESSION_HEARTBEAT_TIMEOUT_MS` <sub>(apps/engine/config/runtime.exs)</sub>
- `SHUTDOWN_DRAIN_TIMEOUT_MS` <sub>(apps/engine/config/runtime.exs)</sub>
- `SOME_APP_SSL_CERT_PATH` <sub>(apps/engine/config/runtime.exs)</sub>
- `SOME_APP_SSL_KEY_PATH` <sub>(apps/engine/config/runtime.exs)</sub>
- `START_ANAMNESE` <sub>(apps/engine/config/runtime.exs)</sub>
- `START_GATE_RESCUE` <sub>(apps/engine/config/runtime.exs)</sub>
- `START_MODEL_SYNC` <sub>(apps/engine/config/runtime.exs)</sub>
- `START_OUTBOX_DRAIN` <sub>(apps/engine/config/runtime.exs)</sub>
- `TERMINAL_ACTION_TIMEOUT_MS` <sub>(apps/engine/config/runtime.exs)</sub>
- `TERMINAL_OUTPUT_MAX_BYTES` <sub>(apps/engine/config/runtime.exs)</sub>
- `TOOL_LOOP_MAX_ITERATIONS` <sub>(apps/engine/config/runtime.exs)</sub>
- `TOOL_LOOP_MAX_ITERATIONS_EXECUCAO` <sub>(apps/engine/config/runtime.exs)</sub>
- `TOOL_LOOP_MAX_ITERATIONS_GATE` <sub>(apps/engine/config/runtime.exs)</sub>
- `TRANSPORT_MAX_BODY_BYTES` <sub>(apps/engine/config/runtime.exs)</sub>
- `WEB_ORIGIN` <sub>(apps/engine/config/runtime.exs)</sub>

**web** — 4 variables

- `VITE_API_URL` <sub>(apps/web/src/lib/runtime-config.ts)</sub>
- `VITE_BRABO_VERSION` <sub>(apps/web/src/lib/runtime-config.ts)</sub>
- `VITE_ENGINE_URL` <sub>(apps/web/src/lib/runtime-config.ts)</sub>
- `VITE_LOG_LEVEL` <sub>(apps/web/src/lib/runtime-config.ts)</sub>

**broker** — 7 variables

- `API_URL` <sub>(apps/broker/src/config.ts)</sub>
- `BRABO_PROJECTS_HOST_BASE` <sub>(apps/broker/src/config.ts)</sub>
- `BRABO_SERVICE_TOKEN` <sub>(apps/broker/src/config.ts)</sub>
- `BRABO_SERVICE_TOKEN_PREVIOUS` <sub>(apps/broker/src/config.ts)</sub>
- `BROKER_PORT` <sub>(apps/broker/src/config.ts)</sub>
- `NODE_ENV` <sub>(apps/broker/src/config.ts)</sub>
- `PROJECT_WORKSPACES_HOST_ROOT` <sub>(apps/broker/src/config.ts)</sub>
<!-- END:GENERATED:env-inventario -->

---

> **TODO(humano):** there is no schema validation of the variables at boot
> (something like `zod`/`envalid` in the api or `NimbleOptions` in the
> engine). Today an invalid numeric value silently becomes `NaN` and a typo
> in a variable name falls back to the default without warning. The only
> exceptions are the ones marked 🔒, which fail explicitly in production.

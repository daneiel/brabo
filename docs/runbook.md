---
id: runbook
title: Operational Runbook
sidebar_label: Runbook
sidebar_position: 4
description: Brabo operational procedures — deploy, rollout, restore, key rotation, cost incident, and observability.
keywords: [runbook, operations, incident, restore, rollout, kubernetes]
---

# Operational Runbook

One single document, because at 3am nobody opens a directory to pick a file.
Start with triage.

## Triage — from symptom to procedure

| what you're seeing | go to |
|---|---|
| I want to bring everything up from scratch | [Local deploy](#deploy-local) |
| pods stuck, `ExternalSecret` never Ready, HPA at `<unknown>` | [Deploy diagnosis](#diagnostico-do-deploy) |
| I'm about to roll out the engine | [Engine rollout](#rollout-do-engine) |
| session `active` with no process, or stuck in `closing` | [When a session escapes](#quando-a-sessao-escapa) |
| I lost data / want to verify the backup | [Restore](#restore) |
| LLM or git credential stopped decrypting | [Master key rotation](#rotacao-da-chave-mestra) |
| everyone logged out at once, or account locked at login | [Auth key rotation](#rotacao-das-chaves-do-auth) |
| cost per hour spiked | [Cost incident](#incidente-de-custo) |
| empty panel, no trace, no log | [Observability](#observabilidade) |
| I don't know what version is running | [What version is live](#que-versao-esta-no-ar) |
| `blocked by CORS policy` in the browser console | [CORS error](#erro-de-cors) |
| activating a session does nothing, or `transition` returns `500` with `ECONNREFUSED` | [The session doesn't leave `created`](#sessao-nao-ativa) |
| the api exits on boot complaining about `GIT_OAUTH_STATE_SECRET` | [The api refuses to boot over an OAuth secret](#segredo-de-oauth-no-boot) |
| "Sign in with GitHub/GitLab" comes back from the provider with a `redirect_uri` error | [The provider rejects the social-login callback](#callback-login-social-nao-registrado) |
| the api or the engine exit on boot complaining about `AUTH_JWT_SECRET`, `BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY`, `SECRET_KEY_BASE`, or `NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD` | [The four sibling secrets also refuse the default](#segredos-irmaos-no-boot) |
| I want to turn on real SMTP, or the api exits on boot complaining about `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` | [Real SMTP in `MailSender`](#smtp-real) |
| agent responding empty, truncated, or very slow | [Inference environment](#ambiente-de-inferencia) |
| agent stopping with `iteration limit reached` without delivering | [Inference environment](#ambiente-de-inferencia) |
| I want to add an OpenAI-compatible LLM provider | [Adding a compatible provider](#adicionando-um-provider-compativel) |
| I want to migrate my workspaces from the Docker volume to a real folder | [Migrating workspaces to a local folder](#migrar-workspaces-pasta-local) |
| creating a **Local** project refuses, saying the folder doesn't exist | [Project in Local mode](#projeto-no-modo-local) |

Two things worth knowing before any procedure:

- **Silence isn't health.** Alert rules live in Grafana, not Prometheus
  ([ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md)):
  Grafana being down means no warning, not no problem.
- **Killing the pod doesn't close a session.** `kubectl delete pod` without
  draining creates an orphan. The path is always the normal transition.

### Migrating workspaces to a local folder {#migrar-workspaces-pasta-local}

Setting `PROJECT_WORKSPACES_HOST_DIR`/`GIT_LOCAL_REPOS_HOST_DIR`
([Getting started](getting-started.md#local-folder-for-workspaces)) swaps the
Docker volume for the given folder — but it does **not copy** what already
existed in the old volume. Anyone with projects already created who doesn't
want to lose the work needs to copy the content before switching:

```bash
pnpm dev:down
docker run --rm \
  -v brabo_project_workspaces:/de \
  -v "$(realpath ~/brabo-projetos)":/para \
  alpine sh -c 'cp -a /de/. /para/'
docker run --rm \
  -v brabo_git_local_repos:/de \
  -v "$(realpath ~/brabo-projetos-bare)":/para \
  alpine sh -c 'cp -a /de/. /para/'
# set the two variables in .env, then:
pnpm dev
```

The volume name (`brabo_project_workspaces`) carries the Compose project's
prefix (`name: brabo` in `docker/docker-compose.yml`) — check with `docker
volume ls` if you renamed the project. The old volume keeps existing
afterward (Compose doesn't delete a volume that fell out of use); remove it
with `docker volume rm` once you're sure the copy worked.

### Project in Local mode {#projeto-no-modo-local}

**Symptom:** when creating the project and picking **Local**, the api
responds `400` saying the folder *doesn't exist from inside the api*.

That's the guard working ([RN-170](business-rules.md#rn-170)), not a bug:
the path you typed exists on your computer and **not** inside the
container. A project created like that would get stuck later, on the first
tool of the first agent, far from the screen where the decision was made —
that's why it isn't allowed to be born.

**What to do.** Mount the folder in **both** services, at the **same
absolute path** on both sides:

```yaml
# docker/docker-compose.yml
services:
  api:
    volumes:
      # ... the lines that already exist
      - /home/voce/projetos/loja:/home/voce/projetos/loja

  engine:
    volumes:
      # ... the lines that already exist
      - /home/voce/projetos/loja:/home/voce/projetos/loja
```

```bash
docker compose -f docker/docker-compose.yml up -d api engine
```

Check before trying again — the api validates what **it** sees, and has no
way to know what's mounted in the other container:

```bash
docker compose -f docker/docker-compose.yml exec api  ls -la /home/voce/projetos/loja
docker compose -f docker/docker-compose.yml exec engine ls -la /home/voce/projetos/loja
```

**Why the same path on both sides.** The path is written ONCE to
`projects.workspace_path` and read by both processes
([RN-169](business-rules.md#rn-169)). Mounting it in different places would
make the engine write where the api doesn't read — the divergence that the
single derivation exists to prevent.

**Other refusal modes, and what each one means:**

| the message says | what to do |
|---|---|
| *doesn't exist from inside the api* | mount it, as above |
| *exists but isn't a folder* | the path points to a file; use a folder |
| *the process can't write to it* | owner/permission of the folder on the host. Images run non-root ([ADR 0024](adr/0024-fase5-imagens-producao-ci.md)); adjust the folder's owner or mode |
| *Invalid path for a Local project* | it's a filesystem root, a system folder, relative, has `..`, or overlaps Brabo's own checkout — pick your own folder, outside those ([ADR 0072](adr/0072-projeto-local-ou-container.md)) |

**Don't confuse this with Container mode.** A project in Container mode
(the default) keeps using `PROJECT_WORKSPACES_ROOT` and the migration
procedure above; Local mode never touches that root.

---

## Local deploy {#deploy-local}

Brings up the whole of Brabo in a local cluster and validates it with a
smoke test. Decisions in
[ADR 0025](adr/0025-fase5-deploy-kubernetes-kustomize.md).

### Prerequisites

Required on the PATH: `docker`, `kubectl`, `kustomize`, `jq`, `openssl`.

`k3d` and `helm` **don't** need to be installed — bootstrap installs them
into `~/.local/bin`, at a pinned version with a checked checksum. Make sure
that directory is on the PATH.

Resources: the full stack (Postgres, Prometheus, two operators, and the
three apps) asks for around **4 GiB** free.

### Bringing it up

```bash
make deploy-local           # builds the images, brings up the cluster, installs, validates
make deploy-local-clean     # the same, without rebuilding the images
```

At the end: web at <http://localhost:8088>, api at `:3000`, engine at
`:4000` — **the same ports as `docker-compose.prod.yml`**, on purpose (ADR
0025, decision 10). The bootstrap runs the seed, which creates
`owner@brabo.dev` already verified with the password from
`BRABO_SMOKE_PASSWORD` (default `brabo12345678`) — that's what you sign in
with in the web's own login.

The seed runs **after** the rollouts (its last step activates a session,
which makes the api call the engine), and the bootstrap only proceeds after
**verifying that login returns 200**. That check is result-based, not
process-based, and exists because the previous one wasn't:
`wait --for=condition=Ready=false` is satisfied by a pod that never got to
run, and because of that the bootstrap used to announce "smoke user ready"
while login was returning 401.

> **The seed isn't idempotent.** `createWorkspace` doesn't upsert, so on a
> second run (`BRABO_KEEP_CLUSTER=1`) the pod ends in an error on
> `workspaces_slug_unique` — and that's correct: the user already exists
> since the first run, login is verified the same way, and the pod is
> removed at the end so it doesn't fail step 1 of `smoke.sh`, which
> requires every pod healthy.

> **This uses up `pnpm dev`'s ports.** Keeping the ports the same is what
> makes `smoke.sh` hold for both modes, and the price is that they don't
> coexist: with the cluster up, `pnpm dev` can't publish the `api` port and
> **5173 never opens**. Notice that the web changes port between modes —
> 8088 here, 5173 there. To go back to development:
>
> ```bash
> make k8s-down && pnpm dev
> ```
>
> `pnpm dev:preflight` tells you which mode you're in, no guessing. Both
> are covered in
> [Getting started](getting-started.md#the-two-local-modes-dont-coexist).

Other targets:

```bash
make smoke-k8s        # just the smoke test, against the running cluster
make hpa-test         # proves the engine's HPA scales by queue
make k8s-validate     # renders the overlays and validates against the schema (no cluster needed)
make k8s-logs         # last lines from api, engine, and web
make k8s-down         # removes the cluster
```

Variables: `BRABO_SKIP_BUILD=1` (uses the daemon's images),
`BRABO_KEEP_CLUSTER=1` (reuses the cluster), `BRABO_CLUSTER_TOOL=kind`.

### Validating a pipeline tag

```bash
make deploy-local TAG=v0.2.0-qa.1
```

Phase 6's pipeline **doesn't deploy** — it ends at the tag. `TAG=` is how
you see, in the local cluster, what that tag stamped: bootstrap does a
detached checkout of the tag and builds the images from that commit.

It **refuses** to run with a dirty tree, instead of guessing what to do
with your work in progress. When it finishes you're left in a detached
HEAD; the command to go back appears in the log.

### What version is live {#que-versao-esta-no-ar}

Three places say the same thing, and the answer is the version **baked
into the artifact** — not a configuration someone could have changed by
accident
([ADR 0036](adr/0036-telas-de-auth-fieis-ao-design-e-fontes-auto-hospedadas.md)):

1. **The login screen**, in the footer. The fastest path, and it needs no
   cluster access: open `/login` and read the footer's first item.
2. **The image tag**, if you have `kubectl`:

   ```bash
   kubectl -n brabo get deploy -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.template.spec.containers[0].image}{"\n"}{end}'
   ```

3. **`service.version` on the spans**, from the api, in Tempo. The only one
   of the three that ties a specific request to a build.

`dev` in all three isn't a failure: it's what an image built outside
`release.yml` reports, because it wasn't born from any tag. `docker
compose`, `make deploy-local` without `TAG=`, and a local build all land
there.

**Divergence between the three is the finding.** The footer showing one
version and the image tag another means bundle caching in the browser or
in nginx, not a wrong deploy — the bundle and the image come from the same
build. Reload ignoring cache before suspecting the cluster.

### CORS error {#erro-de-cors}

The browser's message names the **destination** of the call, never the
cause. Read the **origin** it cites first — that's the useful information
([ADR 0037](adr/0037-cors-do-engine-e-a-porta-como-contrato.md)):

```
Access to fetch at 'http://localhost:3000/health' from origin
'http://localhost:5174' has been blocked by CORS policy
                     ^^^^ this part is the diagnosis
```

**If the origin isn't the one you expect** (`:5174` instead of `:5173`, a
different host, `https` instead of `http`), the problem is the origin, not
CORS.

In the composes, `WEB_ORIGIN` is **derived** from `WEB_PORT` — changing
`WEB_PORT` in `.env` (the guidance in [getting started](getting-started.md)
for a busy port) already moves the accepted origin along with it, so that
specific divergence no longer happens. What still causes this: someone
passed `--port` straight to Vite outside of compose (ADR 0037 made Vite
refuse to start in that case, via `strictPort`, instead of silently
starting on another port), the web is served through a different path, or
`WEB_ORIGIN` was set by hand and overrode the derivation. Fix the origin,
or add it to `WEB_ORIGIN` — **on both services**, which read the same
variable.

**If the origin is right**, confirm what each service actually answers.
`curl` doesn't do CORS, so it shows the raw header — exactly what the
browser looks at:

```bash
# api — expect access-control-allow-origin + allow-credentials
curl -sI http://localhost:3000/health -H "Origin: http://localhost:5173" \
  | grep -i access-control

# engine — expect access-control-allow-origin + vary: origin
curl -sI http://localhost:4000/health -H "Origin: http://localhost:5173" \
  | grep -i access-control

# preflight, which is where missing allow-headers shows up
curl -sI -X OPTIONS http://localhost:3000/auth/login \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,x-csrf-token" \
  | grep -i access-control
```

**Empty output is the finding**: the service didn't recognize the origin.
Wrong or missing `WEB_ORIGIN`, or the wrong port.

**A preflight missing the header the web sends** is the other failure
mode, and the most deceptive: the api's `allowedHeaders` list is explicit
and **no test does a preflight**, so a new client header passes CI and
breaks only in the browser. Today's list is `Content-Type`,
`Authorization`, `X-CSRF-Token`, `traceparent`.

Three things that **aren't** a CORS problem, no matter how much they look
like one:

- **api ↔ engine.** CORS is a browser mechanism; there the caller is a
  server-side HTTP client, which ignores those headers. A failure on that
  path is the service token (`401`/`403` — see
  [rotation](#rotacao-das-chaves-do-auth)) or the wrong address
  (`ECONNREFUSED` — see [the session doesn't leave `created`](#sessao-nao-ativa)).
- **The Phoenix channel going silent.** WebSocket doesn't go through CORS.
  Whoever refuses is the endpoint's `check_origin`, also fed by
  `WEB_ORIGIN`, and the refusal shows up in the engine's log — not in the
  browser console as a CORS error.
- **The engine's `/metrics` blocked in the browser.** That's deliberate: an
  internal metric isn't meant to be readable by page JavaScript. Use
  `curl`.

### The session doesn't leave `created` {#sessao-nao-ativa}

Symptom: activating a session does nothing. "Open creative session" creates
the session and the screen doesn't move; "Activate session" doesn't either.
In the api's log, `POST /projects/:id/sessions/:id/transition` returns
`500`:

```
TransitionSessionUseCase.activate ✗ TypeError
  ↳ HttpApiToEngineClient.startSession ✗ TypeError: fetch failed
      caused by: AggregateError [ECONNREFUSED]
```

Activating a session is the first step that **crosses over** to the engine
(the api asks for the supervised session over internal HTTP), so this is
where a wrong `ENGINE_URL` shows up — and not before, because nothing else
on the creation path leaves the api.

Confirm from **inside** the container, which is where the address matters:

```bash
docker exec brabo-api-1 node -e '
for (const u of ["http://engine:4000/health", "http://localhost:4000/health"]) {
  fetch(u, { signal: AbortSignal.timeout(5000) })
    .then((r) => console.log(u, "->", r.status))
    .catch((e) => console.log(u, "-> FAILED:", e.cause?.code ?? e.message));
}'
docker exec brabo-api-1 sh -c 'echo $ENGINE_URL'
```

`engine:4000` responding `200` while `localhost:4000` gives
`ECONNREFUSED`, with `ENGINE_URL=http://localhost:4000`, is the closed
diagnosis: **inside the container, `localhost` is the api itself**.

The cause is usually the `.env`, not the compose. `pnpm dev` passes `.env`
as `--env-file`, and a value there **wins over** the compose's
`${ENGINE_URL:-http://engine:4000}`. Fix: remove (or comment out) the
`ENGINE_URL` line from your `.env` and recreate the api —

```bash
docker compose -f docker/docker-compose.yml --env-file .env up -d api
```

— because each environment already brings the right default without it:
compose points at the `engine` service, and the api running on the host
falls back to `http://localhost:4000` from its own code. Setting the
variable only makes sense to point at an engine that's neither of the two.
It also applies to the **production** compose, which uses the same
interpolation; in Kubernetes the value comes from the ConfigMap and has
always been `http://engine:4000`.

Two checks before blaming the address, if `ENGINE_URL` is correct:

- **Is the engine up?** `docker compose ps engine` and
  `curl -sI http://localhost:4000/health`. `ECONNREFUSED` with the right
  address means the service is down, not misconfigured.
- **A session that activates and closes itself ~30s later** isn't this
  problem. Look at `termination_reason`: `heartbeat_timeout` means
  activation worked and nobody joined the Phoenix channel — expected
  behavior when activating from outside the interface
  (`SESSION_HEARTBEAT_TIMEOUT_MS`).

### The Terminal tab is stuck on "Opening terminal..." forever {#terminal-preso-abrindo}

Symptom: a project in `runner` mode (ADR 0103/0104), Code → Dev → Terminal
tab never leaves the loading skeleton. The browser console shows, in a
tight loop with growing backoff:

```
socket do terminal com erro {"erro":"[object Event]"}
socket do terminal fechado
```

This is the browser's WebSocket never reaching the engine, not a runner
problem — it happens even before any `brabo-runner` connects. Three
stacked causes, all closed by [RN-433](business-rules.md#rn-433):

1. **`ENGINE_PUBLIC_URL` resolving to a Docker-internal hostname.** The
   ticket the api hands the browser (`POST .../terminal-ticket`) carries
   `engineWsUrl`, built from `ENGINE_PUBLIC_URL` — distinct from
   `ENGINE_URL` (RN-419), which is for api→engine calls **inside** the
   compose network. `docker/docker-compose.yml` now sets
   `ENGINE_PUBLIC_URL: ${ENGINE_PUBLIC_URL:-http://localhost:4000}` on the
   `api` service (same default `VITE_ENGINE_URL` already uses for `web`).
   Confirm from inside the container:

   ```bash
   docker exec brabo-api-1 sh -c 'echo $ENGINE_PUBLIC_URL'
   # expected: http://localhost:4000 (or your real public engine address)
   ```

   An empty value here on an environment built before this fix means the
   code fell back to `ENGINE_URL` (`http://engine:4000`) — a hostname that
   only resolves inside the Docker network, never from the browser. Fix:
   rebuild/recreate the `api` container so the new compose default takes
   effect, or set `ENGINE_PUBLIC_URL` explicitly in `.env` if the engine's
   real public address is something else (a tunnel, a different host).
2. **A socket that never opens used to retry forever, silently.**
   Independent of the address above — even a genuinely unreachable engine
   (down, firewalled) should surface as an error, never spin forever.
   `apps/web/src/lib/terminal-channel.ts` now gives up after 8s if the
   socket hasn't opened, and shows `RunnerOnboardingPanel` with an
   actionable message instead of looping on the browser's default
   WebSocket reconnect behavior.
3. **The socket URL duplicated its path.** The actual blocker once the
   first two were fixed: `terminal-channel.ts` used to concatenate
   `/runner/websocket` onto an `engineWsUrl` the api already returns
   complete (`ws://host:port/runner`) — and `phoenix.js`'s own `Socket`
   constructor appends `/websocket` again on top of whatever endpoint it's
   given. The engine received `GET /runner/runner/websocket/websocket` and
   rejected it (`Phoenix.Router.NoRouteError`), visible in
   `docker logs brabo-engine-1` as a connection that never gets past
   `REFUSED CONNECTION`. Fixed by passing `engineWsUrl` straight to
   `Socket` — `apps/runner/src/channel.ts` (the CLI side of the same
   contract) already did this correctly.

### The api refuses to boot over an OAuth secret {#segredo-de-oauth-no-boot}

Symptom: with `NODE_ENV=production`, the api dies at start with a message
about `GIT_OAUTH_STATE_SECRET` — missing, set to the repository's example
value, or too short.

**It's not a regression, and don't work around it.** This key signs git
OAuth's `state`, and `state` is what stops the public callback from being
forged. Before [ADR 0059](adr/0059-segredo-do-state-de-oauth-sem-default.md)
the api would boot with a default published right in this repository —
whoever sees this error had, until now, the git-connection flow open to
anyone. The boot failing is the warning arriving, late.

```bash
export GIT_OAUTH_STATE_SECRET="$(openssl rand -base64 32)"
```

In Kubernetes the value comes from `brabo-secrets`, under the same-named
key already declared in
`deploy/k8s/base/common/externalsecrets.yaml` — if the error showed up
there, the problem is the vault not delivering the key, and the path is
[Deploy diagnosis](#diagnostico-do-deploy).

Changing the key **invalidates in-flight `state`s**: whoever is mid
"connect GitHub" at that instant gets refused and redoes the flow. Since
the `state`'s TTL is 10 minutes, that's the window — there's no migration
to do, and no **already-established** connection is affected (the stored
token doesn't depend on this key).

### The provider rejects the social-login callback {#callback-login-social-nao-registrado}

Symptom: clicking "Sign in with GitHub"/"Sign in with GitLab" on the login
screen goes to the provider and comes back with an error OF ITS OWN KIND
(`redirect_uri_mismatch` on GitHub, "The redirect URI included is not
valid" on GitLab) — it never even reaches
`/auth/oauth/:provider/callback`.

**It's not a product bug — it's a missing registration on the provider's
side.** Social login ([ADR 0084](adr/0084-login-social-github-e-gitlab.md))
reuses the SAME OAuth App the git connection already uses
(`GITHUB_OAUTH_CLIENT_ID`/`GITLAB_OAUTH_CLIENT_ID`, no new variable), but
each FLOW has its own `redirect_uri`, and the provider requires that ALL
the ones the api can ask for be registered beforehand:

- Git connection (already existed): `${API_PUBLIC_URL}/git/oauth/<provider>/callback`
- Social login (new): `${API_PUBLIC_URL}/auth/oauth/<provider>/callback`

Register the second one in the OAuth App's configuration (GitHub: Settings
→ Developer settings → OAuth Apps; GitLab: Settings → Applications) — GitHub
accepts several callback URLs on the same App, so does GitLab. No separate
App or new client id/secret needed.

### The four sibling secrets also refuse the default {#segredos-irmaos-no-boot}

Symptom: with `NODE_ENV=production`, the api (or, for `SECRET_KEY_BASE`,
the engine) dies at start with a message about `AUTH_JWT_SECRET`,
`BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY`, or `SECRET_KEY_BASE` —
missing, set to the repository's example value, or too short.

**Same cause as the OAuth secret above, and the same guidance: it's not a
regression, and don't work around it.**
[ADR 0059](adr/0059-segredo-do-state-de-oauth-sem-default.md) already
declared these four as pending — the same pattern, just not replicated
yet — and [RN-114](business-rules.md#rn-114) closed it. Each protects
something different:

- `AUTH_JWT_SECRET` public = anyone can derive the pair that signs the
  access token and forge a valid one.
- `BRABO_SERVICE_TOKEN` public = anyone can call `/internal/*` bypassing
  `EngineServiceGuard`.
- `CREDENTIALS_MASTER_KEY` public = anyone can decrypt the user's
  credential store (LLM keys, git tokens).
- `SECRET_KEY_BASE` (engine) already had `raise` in `runtime.exs` — the
  defect was only the compose masking that `raise` with a public
  fallback.

```bash
export AUTH_JWT_SECRET="$(openssl rand -base64 32)"
export BRABO_SERVICE_TOKEN="$(openssl rand -base64 32)"
export CREDENTIALS_MASTER_KEY="$(openssl rand -base64 32)"
export SECRET_KEY_BASE="$(openssl rand -base64 64)"
```

Nothing changes in Kubernetes, for the same reason as
`GIT_OAUTH_STATE_SECRET`: all four already came from `brabo-secrets`,
under the same-named key, in
`deploy/k8s/base/common/externalsecrets.yaml`.

**The knowledge graph (`NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD`,
[ADR 0099](adr/0099-neo4j-grafo-de-conhecimento-e-templates.md)) follows
the same rule, with one difference**: `NEO4J_URI` and `NEO4J_USER` have a
safe development default (`bolt://neo4j:7687`, `neo4j` — they're not
secrets, and `docker-compose.prod.yml` already supplies them); only
`NEO4J_PASSWORD` has no public default, for the same reason as the four
above — and without it the api's boot fails in
`GraphStore.onModuleInit` (`neo4j-config.ts`) BEFORE Neo4j itself even
refuses to start (the official image's entrypoint requires an 8+ character
password; an empty `NEO4J_AUTH` brings down the `neo4j` container first).

```bash
export NEO4J_PASSWORD="$(openssl rand -hex 24)"
```

**HEX, not base64.** Neo4j's entrypoint reads `NEO4J_AUTH` as
`user/password` and splits on the FIRST slash — a base64 password can
contain `/` (the alphabet has `/` and `+`), and that breaks the parse with
`Invalid value for NEO4J_AUTH`, taking down the `neo4j` container in a
restart loop. This actually happened: CI's smoke test failed this way after
a merge that reintroduced `-base64` by mistake. Hex has no `/`, `+` or `=`.

`docker/smoke.sh` already generates the five ephemeral variables above (the
four siblings plus `NEO4J_PASSWORD`, this one in hex) on every run — that's
how the CI job
"Build, scan e smoke das imagens de produção" brings up
`docker-compose.prod.yml` with
no secret committed.

Changing `AUTH_JWT_SECRET` or `BRABO_SERVICE_TOKEN` without the
`_PREVIOUS` dance has the same effect already documented in
[Auth key rotation](#rotacao-das-chaves-do-auth); changing
`CREDENTIALS_MASTER_KEY` without re-wrapping has the same effect already
documented in
[Master key rotation](#rotacao-da-chave-mestra). This BOOT check doesn't
change either procedure — it just stops the key from reaching production
as this repository's public literal.

### Real SMTP in `MailSender` {#smtp-real}

`MailSender` sends a real email only when `MAIL_TRANSPORT=smtp` — the
default is `log` (the usual behavior), **including in production**:
sending real email is opt-in for the operator
([ADR 0096](adr/0096-smtp-real-no-mailsender.md)). See
[Configuration](reference/configuration.md#api) for the full `SMTP_*`
table.

Symptom of incomplete configuration: with `NODE_ENV=production` and
`MAIL_TRANSPORT=smtp`, the api dies at start complaining about
`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, or `SMTP_FROM` — same message
pattern as the
[four sibling secrets](#segredos-irmaos-no-boot) ([RN-408](business-rules.md#rn-408)),
but WITHOUT the public default they have: here the rule only kicks in
once the operator opted into `smtp`.

```bash
export MAIL_TRANSPORT=smtp
export SMTP_HOST=smtp.seu-provedor.com
export SMTP_PORT=587
export SMTP_USER=usuario-do-provedor
export SMTP_PASSWORD="$(sua-credencial-do-provedor)"
export SMTP_FROM="Brabo <nao-responda@seu-dominio.com>"
```

`SMTP_PASSWORD` is a service INFRASTRUCTURE secret (a plain env var, like
`AUTH_JWT_SECRET`), not a USER secret — it doesn't go through envelope
encryption, and has no rotation procedure of its own beyond changing the
variable and restarting (the SMTP provider decides that credential's
rotation policy). In Kubernetes, the key goes into `brabo-secrets` like
any other, referenced in
`deploy/k8s/base/common/externalsecrets.yaml`.

If email doesn't arrive even with no boot error: check the api's log for
`falha ao enviar e-mail via SMTP` (`type`/recipient show up, the body and
the token NEVER show up — same rule as `LogMailSender`), and test the
credential with the provider's own SMTP client before suspecting Brabo.

### k3d is the default even with kind installed

It's not a preference. k3s ships with a built-in NetworkPolicy
controller; **kind's kindnet doesn't implement NetworkPolicy** and
silently ignores the manifests. On a kind cluster, this phase's policies
exist in etcd with no effect at all, and the deploy would look validated
without having validated half of scope item 4. The smoke test warns when
the cluster isn't enforcing.

### What the smoke test covers

1. Every pod **Ready** — not just `Running`. A pod whose readiness check
   fails stays `Running` forever without receiving traffic.
2. No container with `runAsUser: 0`.
3. Login at `POST /auth/login` with the seed user — exercises argon2id,
   access-token issuance, and the session cookies.
4. `workspace → project → session`. This step crosses the whole
   NetworkPolicy set: creating a session makes the api call the engine
   over internal HTTP, with the service token. The session is created with
   `kind: consultiva` — mandatory since PHASE 20
   ([RN-097](business-rules.md#rn-097)) — and it's `consultiva` on
   purpose: the smoke test exercises create → activate → close and never
   activates execution, which on a consultative session returns `409`.

   **This is the step that proves the route has a consumer outside the
   web.** When `kind` was made mandatory, the api's suite passed with 1562
   tests, and it was the smoke test that failed, because it's the only
   one that calls the route as an external client, with no mock, against
   the production image.
5. Distinct probes (`/live` and `/ready` for the engine, `/live` for the
   api) and the web's `/config.js` pointing at the cluster's URLs.
6. `oban_queue_depth` with the `queue` and `state` labels at `/metrics`.
7. `external.metrics.k8s.io` serving the metric — the prometheus-adapter's
   failure mode is silent, so we ask the aggregated API directly.

### Deploy diagnosis {#diagnostico-do-deploy}

#### `403` on `/internal/*`, or `401` on the api's calls to the engine

Both symptoms have the same cause: the service token doesn't match
between the two sides (the api refuses with `403`, the engine's plug with
`401`). Check that both loads read the **same** value:

```bash
kubectl -n brabo get secret brabo-secrets -o jsonpath='{.data.BRABO_SERVICE_TOKEN}' | base64 -d | sha256sum
kubectl -n brabo exec deploy/engine -- sh -c 'printf %s "$BRABO_SERVICE_TOKEN" | sha256sum'
```

Comparing the hash instead of the value avoids printing the secret to the
terminal. If they diverge, the engine pod has an old version of the
Secret: `kubectl -n brabo rollout restart deploy/engine`. If they match,
the header isn't getting through: check that `BRABO_SERVICE_TOKEN` is set
on **both** loads — the engine has a development default
(`dev-service-token-change-me`), so forgetting the variable only there
produces exactly this symptom, with no boot error — and that no proxy in
the path is stripping unknown headers.

#### Login returning `401` for everyone after a deploy

Almost always a new `AUTH_JWT_SECRET` skipping the coexistence step: the
access token disappears along with it, but the symptom shows up on
refresh. The correct procedure is in
[Auth key rotation](#rotacao-das-chaves-do-auth).

#### `ExternalSecret` never becomes Ready

The `SecretStore` reads the source Secret `brabo`, created imperatively by
the bootstrap. Confirm it exists and that RBAC is in place:

```bash
kubectl -n brabo get secret brabo
kubectl -n brabo describe secretstore brabo-secret-store
```

#### Engine HPA at `<unknown>`

In order, most to least likely:

```bash
# 1. is the engine exposing the metric?
kubectl -n brabo exec deploy/engine -- wget -qO- http://127.0.0.1:4000/metrics | grep oban_queue_depth

# 2. is Prometheus scraping it?
kubectl -n monitoring port-forward svc/prometheus-server 9090:80
# then: http://localhost:9090 -> Status -> Targets

# 3. is the adapter serving it?
kubectl get --raw "/apis/external.metrics.k8s.io/v1beta1/namespaces/brabo/oban_queue_depth?labelSelector=state%3Davailable"
```

If (1) responds and (3) doesn't, the problem is the rule in
`deploy/k8s/helm/prometheus-adapter-values.yaml`.

#### Migration Job doesn't reapply

A `Job`'s spec is immutable: with the previous Job still in the cluster,
reapplying with a new image fails. The bootstrap already deletes both
before applying; manually:

```bash
kubectl -n brabo delete job migrate-api migrate-engine --ignore-not-found
kubectl apply -k deploy/k8s/overlays/local
```

#### `bin/engine rpc` responds `eaddrinuse`

The Erlang distribution's port range (`ERL_AFLAGS`) needs more than one
port: the running node occupies the first, and `rpc` brings up a hidden
node that needs another. The configured range is 9100–9110, opened in
the NetworkPolicy.

#### Checking that the engine's replicas are clustered

Without an Erlang cluster, `Workspace.ensure!`'s `:global.trans` doesn't
serialize anything and two replicas run a concurrent `git init` on the
same shared directory:

```bash
kubectl -n brabo exec deploy/engine -- /app/bin/engine rpc 'IO.inspect(Node.list())'
```

Should list the other pods. An empty list with more than one replica is a
defect.

### Secrets: fallback to sealed-secrets

The default is the External Secrets Operator. Where it isn't viable,
replace the `ExternalSecret` in
`deploy/k8s/base/common/externalsecrets.yaml` with a `SealedSecret`,
**keeping the same Secret name (`brabo-secrets`) and the same keys** —
nothing else in the deploy needs to change, because everything consumes
it via `secretRef`.

```bash
kubectl create secret generic brabo-secrets \
  --dry-run=client -o yaml \
  --from-literal=DATABASE_URL=... \
  --from-literal=SECRET_KEY_BASE=... \
  | kubeseal --format yaml > deploy/k8s/overlays/<env>/sealed-brabo-secrets.yaml
```

The `SealedSecret` is encrypted for that cluster's public key and can be
versioned. A plain Secret **never** can.

### Known limits of this environment

- **RWO instead of RWX.** Works because the cluster has a single node,
  and RWO means "one NODE", not "one pod". On a real cluster this
  configuration would put api and engine on different nodes and the dev
  agent's `git push` would fail with `remote unpack failed`.
- **No pgvector** on CloudNativePG's Postgres. Today no migration creates
  the extension and no `vector` column exists.
- **`.gitlab-ci.yml` has no local static validation** (Phase 8c, ADR
  0039). The Infra area's Workflows subagent validates GitHub Actions
  workflows with `actionlint` (pinned in `docker/engine/Dockerfile(.prod)`,
  same pattern as `hadolint`/`gitleaks`); there's no equivalent offline
  binary for GitLab CI — the official linter needs a live instance.
  Documented gap, not an invented half-solution.

---

## Engine rollout {#rollout-do-engine}

Decisions in
[ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md).

The engine hosts the session processes. Bringing down a replica carelessly
used to leave, before Phase 5, **every** session on that pod hanging in
`active` with no process at all — never advancing, never closing.

### What happens during a rollout, in order

| phase | how long | what happens |
|---|---|---|
| `preStop` | up to 45s (`SHUTDOWN_DRAIN_TIMEOUT_MS`) | `Engine.Shutdown.drain/1`: `/ready` flips to 503, `/internal/sessions` refuses new sessions, and every session on this node is offered to a live peer |
| per-session handoff | 5s (`@handoff_timeout_ms`) | `:erpc.call` to another node to take over the process |
| not adopted | — | become `closing` with cause `node_shutdown`, then `closed_abnormally` |
| SIGTERM | rest of the 90s (`terminationGracePeriodSeconds`) | the supervision tree comes down |

The 90s are deliberate: 45s of drain plus slack for the BEAM's teardown.
Lowering `terminationGracePeriodSeconds` without lowering the drain
timeout makes kubelet kill the pod **mid-handoff** — which is exactly how
you recreate the bug the drain exists to prevent.

### Doing the rollout

```bash
kubectl -n brabo rollout restart deployment/engine
kubectl -n brabo rollout status  deployment/engine --timeout=300s
```

With a single replica, there's no peer to adopt: **every** active session
will end up `closed_abnormally / node_shutdown`. That's correct, not a
failure — but if the goal was to not interrupt anyone, scale to 2 first:

```bash
kubectl -n brabo scale deployment/engine --replicas=2
```

### Proving nothing was left orphaned

```bash
make rollout-test
```

Opens 5 active sessions, does the rollout, and requires that **each one**
be in one of two states: `active` with a live `:global` owner (adopted),
or `closed_abnormally` with `node_shutdown` (drained). Any other
combination fails — especially `active` with no owner, which is the
operational definition of an orphan.

Manually, the same question:

```sql
-- active sessions according to the api
select id, status, updated_at from sessions where status = 'active';
```

```bash
# live owners according to the engine
kubectl -n brabo exec deploy/engine -- \
  /app/bin/engine rpc ':global.registered_names() |> Enum.filter(&match?({:brabo_session, _}, &1)) |> length()'
```

Active in the api with no owner in the engine = orphan.

### When a session escapes {#quando-a-sessao-escapa}

**Session stuck in `closing`.** `closing` is a transitional state; stuck
there means the drain started and didn't finish. The *Session stuck in
closing* alert fires after 15 minutes. Investigate the log of the pod
that was leaving — if it's already gone, the `Adopter` (a sweep every
30s) should have taken over; if it didn't, check whether the row still
exists in `engine.session_states`.

**Orphan after `kill -9` / an OOMKill.** `preStop` doesn't run in those
cases, by definition. What covers it is the `SessionAdoptionWorker`,
which every 30s looks for a row in `session_states` with no `:global`
owner and takes it over. If it's not running, the Oban queue is stalled —
and then the problem is something else (see the alert for a queue not
being consumed, under [Observability](#observabilidade)).

**A rollout stuck in `preStop`.** Symptom: a pod `Terminating` for exactly
90s, every time. Almost certainly an `:erpc.call` waiting for a node that
already died but is still in `Node.list()`. The 5s-per-session timeout
caps the damage; a full 90s means ~18 sessions in sequence or a handoff
that never returns.

**Nothing gets adopted, even with 2 replicas.** The nodes can't see each
other. Check the Erlang cluster:

```bash
kubectl -n brabo exec deploy/engine -- /app/bin/engine rpc 'Node.list()'
```

Empty list = the DNSCluster didn't resolve the headless Service, or the
NetworkPolicy is blocking the distribution range (9100–9110). Without a
cluster, each replica is an island and every rollout drains everything.

### Increasing the drain window

If sessions run long and the 45s drain isn't enough, both values go up
**together** — and in this order of reasoning: pick the drain, then add
slack:

```yaml
# deploy/k8s/base/engine/deployment.yaml
terminationGracePeriodSeconds: 150   # drain + ~30s teardown
# env SHUTDOWN_DRAIN_TIMEOUT_MS: "120000"
```

Touching only `terminationGracePeriodSeconds` doesn't lengthen the drain;
touching only the drain makes kubelet kill mid-way.

---

## Restore {#restore}

Decisions in [ADR 0027](adr/0027-fase5-backup-hardening-release.md).

> **Tested.** The procedure below is exactly what `make test-restore`
> runs, and it's run against the local cluster. There's no step here that
> nobody has ever exercised. The record of the last run is at the end.

### Where the backup lives

| what | where |
|---|---|
| schedule | `brabo-backup` CronJob, 03:17 UTC, daily |
| destination | an S3-compatible bucket — `BACKUP_S3_ENDPOINT` / `BACKUP_S3_BUCKET` in the `brabo-secrets` Secret |
| layout | `daily/brabo-<ISO>.dump` and `weekly/brabo-<ISO>.dump` |
| retention | 7 daily + 4 weekly, by COUNT (`BACKUP_KEEP_DAILY` / `BACKUP_KEEP_WEEKLY`) |
| format | `pg_dump --format=custom --compress=9` |
| history | `backup_runs` table |

In the local cluster the destination is a MinIO inside the `brabo`
namespace; in staging/prod it's the real bucket. The procedure doesn't
change — only the endpoint.

### Before restoring: does the backup exist, and is it any good?

```sql
select finished_at, kind, status, object_key,
       pg_size_pretty(size_bytes) as tamanho, error_message
  from backup_runs
 order by finished_at desc
 limit 10;
```

Three things in that output matter more than the last row:

- **A recent `status = 'failed'` with an old success** is the dangerous
  case: a backup exists, it's just old. The *Last backup run failed*
  alert covers exactly this.
- **A sharp drop in `size_bytes`** between runs suggests a truncated
  dump, and the size alone doesn't give it away — the script's
  `pg_restore --list` is what catches it.
- **No rows at all** means the CronJob has never run successfully. Then
  the problem isn't the restore.

### The automated path (the same one the test runs)

```bash
make test-restore
```

Triggers a real backup, restores into `brabo_restore_test`, validates,
and drops the database. Use it when the goal is to **verify** the backup,
not recover data.

### Restoring for real, during an incident

The `brabo-restore` script restores into a NEW database and never touches
the source one — on purpose. Restoring over the live database is
irreversible and almost always the wrong call in the first minutes of an
incident.

**1. Bring up a restore Job pointing at the database name you want:**

```bash
kubectl -n brabo create job restore-manual --from=cronjob/brabo-backup \
  --dry-run=client -o yaml \
| sed -e 's|\["brabo-backup"\]|["brabo-restore"]|' \
| kubectl -n brabo apply -f -

kubectl -n brabo set env job/restore-manual RESTORE_DB=brabo_recuperado
kubectl -n brabo logs -f job/restore-manual
```

To restore from a weekly copy instead of the latest daily:
`RESTORE_PREFIX=weekly/`.

**2. Check what came back** — the same questions the script asks, now with
your own eyes:

```sql
-- how many tables came back (compare against the source, not a fixed
-- number: every new migration changes this count)
select count(*) from information_schema.tables
 where table_schema = 'public' and table_type = 'BASE TABLE';

-- the event log is dense per session: this query has to come back EMPTY
select session_id, count(*), min(seq), max(seq)
  from session_events
 group by session_id
having count(*) <> max(seq) - min(seq) + 1 or min(seq) <> 1;
```

**3. Promote the recovered database** by pointing `DATABASE_URL` at it and
restarting api and engine. This is the last step, and the only
destructive one:

```bash
kubectl -n brabo patch secret brabo-secrets --type merge \
  -p "{\"data\":{\"DATABASE_URL\":\"$(printf '%s' "$NOVA_URL" | base64 -w0)\"}}"
kubectl -n brabo rollout restart deployment/api deployment/engine
```

> The Secret is materialized by External Secrets from the provider. A
> direct `patch` gets overwritten on the next `refreshInterval` (1h):
> change **also** the value in the provider, or the system quietly goes
> back to the old database within an hour — mid-recovery.

### What the restore does NOT cover

- **User credentials become unreadable if `CREDENTIALS_MASTER_KEY` is
  different.** The dump carries the wrapped DEKs, not the keys. Restoring
  into an environment with a different master key gives you back an
  intact database with useless LLM and git credentials. See
  [Master key rotation](#rotacao-da-chave-mestra).
- **Nothing about users is left out.** Since the Keycloak cut
  ([ADR 0032](adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)) there's
  no separate IdP database: identities, argon2id credentials, refresh
  tokens, and the auth event log all live in the same Postgres and go
  into this dump. What does **not** survive is reading them if
  `AUTH_TOKEN_PEPPER` is different — same reasoning as the master key
  above.
- **PVCs** (`/data/git-repos`, agent worktrees) aren't copied. The real
  repositories live in GitHub/GitLab; what's lost is work-in-progress
  cache.
- **It's not PITR.** The granularity is the last dump; anything written
  after it is lost. If that's not acceptable, the path is WAL archiving
  on CloudNativePG, which is out of scope for this phase.

### When the restore fails

| symptom | probable cause |
|---|---|
| `no backup under .../daily/` | wrong bucket, wrong credential, or the CronJob never ran |
| `not an intact custom dump` | interrupted upload; use the previous object or `weekly/` |
| `pg_restore failed` with an extension error | the destination database needs the same extensions (`pgvector`); on CNPG they come from the cluster, not the dump |
| `missing tables in the restored copy` | a dump from a different schema version — the script says WHICH ones are missing; check the object's date against the most recent migration |
| `out of window` on a critical table | count doesn't match the dump's timestamp: investigate before promoting |
| `server version mismatch` | the Job's `pg_dump` is 16; a cluster on a different major refuses the connection |
| Job timeout | database too large for `activeDeadlineSeconds`; raise the value on the Job, not the CronJob |

### Last verified run

<!-- Update this section whenever you run the test on a new environment. -->

| field | value |
|---|---|
| date | 2026-07-27 |
| environment | local k3d cluster, PostgreSQL 16.10 (CloudNativePG), MinIO |
| command | `make test-restore` |
| observed RTO | ~40s from triggering the backup to the verdict (a ~108 KB database) |

Output:

```
[restore]   ok    intact dump (108127 bytes)
[restore] restoring into brabo_restore_test
[restore]   ok    pg_restore completed
[restore]   ok    35 tables restored, identical to the source
[restore]   ok    users: 2 rows (window 2–2)
[restore]   ok    projects: 2 rows (window 2–2)
[restore]   ok    sessions: 2 rows (window 2–2)
[restore]   ok    session_events: 7 rows (window 7–7)
[restore]   ok    proposed_actions: 0 rows (window 0–0)
[restore]   ok    intact event log: 7 events across 2 sessions, dense seq starting at 1
[restore] RESTORE VALIDATED — all checks passed
```

The RTO above is for an empty production database — it's useful to prove
the PROCEDURE, not to size a real recovery. Measure again with a
representative dump before promising anyone an RTO.

#### What this run found (and that the test now prevents)

1. **Postgres major-version mismatch.** The local CloudNativePG was
   running 17.4 while the compose says 16; `pg_dump` refused the
   connection with "server version mismatch". The cluster's `imageName`
   was pinned to 16.10.
2. **False green from an empty database.** With zero rows, every count
   comparison becomes `0 == 0` and the `seq` check looks at nothing.
   Today the script explicitly fails in both cases.
3. **A fixed table count ages.** The validation compared against a number
   written in the script, which was already stale in that same session.
   It now compares the LIST of tables against the source and says which
   one is missing.
4. **The backup image carried 48 HIGH/CRITICAL CVEs** coming from `mc`
   (Go frozen since September 2025) and from `gosu` in the
   `postgres:16-alpine` base. Swapped for `alpine` + `postgresql16-client`
   + `aws-cli`, all from apk and therefore patchable: 48 → 0. See
   decision 1b of ADR 0027.

---

## Auth key rotation {#rotacao-das-chaves-do-auth}

Decisions in
[ADR 0031](adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md) and
[ADR 0032](adr/0032-corte-do-keycloak-e-sessao-em-cookie.md).

First-party auth has **three** secrets, with very different consequences
when swapped. Confusing the first two is the expensive mistake here.

### `AUTH_JWT_SECRET` — zero-downtime rotation

The Ed25519 pair that signs the access token is derived from it. Rotation
is the same three-step dance as the master key (below):

1. `AUTH_JWT_SECRET_PREVIOUS` gets the old value; `AUTH_JWT_SECRET` gets
   the new one. Restart the api.
2. Both keys appear at `/.well-known/jwks.json` and both verify; only the
   new one **signs**. The api emits a `WARN` on boot for as long as that
   lasts.
3. After 15 minutes (the access token's TTL), no token from the old key
   survives. **Remove `AUTH_JWT_SECRET_PREVIOUS`** and restart.

Nobody gets logged out: refresh tokens don't depend on this key.

### `AUTH_TOKEN_PEPPER` — global logout, no middle ground

This is the HMAC key for hashing refresh tokens and account tokens.
Changing it invalidates, all at once:

- **every** refresh token in circulation — everyone gets logged out;
- **every** open email-verification and password-reset link.

There's no `AUTH_TOKEN_PEPPER_PREVIOUS`, and that's a conscious decision:
accepting double verification on every refresh, forever, for a scenario
that runs once in a blue moon, isn't worth it. If you need to change it —
suspected database leak, for instance — warn people first: the symptom
for the user is being logged out for no apparent reason and seeing the
reset link say "expired".

> The api does **not** fail to boot with a new pepper. It simply stops
> recognizing any old token. If support reports "everyone got logged out
> at the same time", this variable is the first place to look.

### `BRABO_SERVICE_TOKEN` — zero-downtime rotation, on both sides

This is the shared secret that authenticates api ↔ engine traffic
([RN-035](business-rules.md#rn-035)). It has nothing to do with a user
session: getting it wrong doesn't log anyone out, it breaks internal
communication.

The dance is the same as `AUTH_JWT_SECRET`, with the difference that it
runs on **both** loads — and order matters, because each side sends its
current one and accepts both:

1. `BRABO_SERVICE_TOKEN_PREVIOUS` gets the old value on **both api and
   engine**; `BRABO_SERVICE_TOKEN` gets the new one on both. Restart
   both.
2. While both are up with the new variable, traffic works in any
   combination of old and new pods — that's what makes the rollout safe
   mid-way through.
3. Once both Deployments' rollout is done, **remove
   `BRABO_SERVICE_TOKEN_PREVIOUS`** and restart.

Skipping step 1 and just swapping the current value produces `403`/`401`
for the entire window where an old pod remains on either side — the
symptom in the
[diagnosis above](#diagnostico-do-deploy).

```bash
# generate a value with enough entropy; it never needs to be typed
openssl rand -base64 48
```

### Account locked by lockout

The lockout is short (30s to 15 minutes) and resolves itself: the
sliding window drains. **There's no unlock endpoint**, on purpose — see
[RN-031](business-rules.md#rn-031). If you need to unlock someone right
now:

```sql
-- The key is an HMAC of the email, not the email. Find it from the recent event:
select subject_key, count(*), max(occurred_at)
  from auth_events
 where kind in ('login_failure', 'login_blocked_user')
   and occurred_at > now() - interval '30 minutes'
 group by subject_key order by 3 desc;

delete from auth_lockout_hits where bucket_key = '<subject_key>';
```

A successful password reset also unlocks the account.

> **The trail is never erased.** `auth_lockout_hits` is an ephemeral
> counter; `auth_events` is append-only and survives everything, including
> the user being removed (no foreign key, on purpose).

## Master key rotation {#rotacao-da-chave-mestra}

Decisions in [ADR 0027](adr/0027-fase5-backup-hardening-release.md).

`CREDENTIALS_MASTER_KEY` wraps the DEKs that encrypt the user's secrets:
LLM API keys and git tokens. It's rotated periodically and, mandatorily,
after any suspected leak.

### What's at stake

The `wrapped_dek` stored in the database **doesn't identify which key
wrapped it**. Direct consequence: changing the variable and restarting the
api makes every existing credential unreadable, all at once, with no boot
error — the failure only shows up on first use, as "unable to decrypt",
and there's no way back short of restoring the old key.

That's why rotation has three steps, not one. During the middle one, both
keys coexist:

| variable | role |
|---|---|
| `CREDENTIALS_MASTER_KEY` | CURRENT key — always used to encrypt |
| `CREDENTIALS_MASTER_KEY_PREVIOUS` | previous key — tried only when the current one fails |

Two tables hold envelopes: `user_credentials` and
`project_git_connections`.

### Before: size it up

```sql
select 'user_credentials' as tabela, count(*) from user_credentials
union all
select 'project_git_connections', count(*) from project_git_connections;
```

The re-wrap is an UPDATE per row. Thousands of rows take seconds; it's
good to know the order of magnitude before starting.

### 1. Publish both keys

Generate the new one and publish **both** to the secrets provider, keeping
the old one in `CREDENTIALS_MASTER_KEY_PREVIOUS`:

```bash
openssl rand -hex 32   # the new key
```

In the local cluster the source Secret is created by the bootstrap; in
staging/prod the value goes into the provider that External Secrets reads
from. Then restart the api so it loads both:

```bash
kubectl -n brabo rollout restart deployment/api
kubectl -n brabo rollout status  deployment/api
```

Confirm the api is in rotation mode — it warns in the log, on purpose:

```bash
kubectl -n brabo logs -l app.kubernetes.io/name=api --tail=50 \
  | grep CREDENTIALS_MASTER_KEY_PREVIOUS
```

> From here on **nothing breaks**: a new secret is already born on the new
> key, an old secret is still readable via the previous one. You can
> pause in this state for hours if you need to — but not for weeks:
> accepting two keys doubles the surface of a leaked key, which is
> exactly why you're rotating.

### 2. Re-wrap the store

```bash
kubectl -n brabo exec deploy/api -- node scripts/rewrap-deks.js
```

Expected output:

```
[rewrap] result

  user_credentials         total=12  re-wrapped=12  already on current key=0  failures=0
  project_git_connections  total=3   re-wrapped=3   already on current key=0  failures=0

[rewrap] done. Now remove CREDENTIALS_MASTER_KEY_PREVIOUS and restart the api.
```

Properties that matter if something interrupts the script:

- **Idempotent.** Running it again counts already-converted rows as
  `already on current key` and rewrites nothing. Interrupted? Run it
  again.
- **Only the envelope changes.** The secret's ciphertext stays byte for
  byte the same, so stopping halfway leaves the store consistent: part on
  the new key, part on the old, and both readable as long as PREVIOUS
  exists.
- **`failures > 0` blocks step 3.** These are rows that don't open with
  either key — usually coming from a different environment, or from an
  earlier rotation that was interrupted with the key already discarded.
  The script identifies each one by id. Don't remove PREVIOUS: without
  it you also lose what still opened.

### 3. Discard the old key

Only once `failures=0`:

```bash
# remove CREDENTIALS_MASTER_KEY_PREVIOUS from the provider, then
kubectl -n brabo rollout restart deployment/api
```

Verify that the rotation warning is gone from the log and that an
existing credential still works (the most direct path is the project's
credentials screen, or any agent turn that uses an LLM key).

### Verifying without waiting for an incident

`rewrap` runs in any environment. In a test one, the full cycle fits in a
few minutes and validates the procedure — the same logic is covered by
`test/infrastructure/security/envelope-encryption.service.spec.ts`,
including the case where neither key works.

### Interaction with restore

**Restoring a dump into an environment with a different master key gives
you back an intact database with useless credentials.** The dump carries
the wrapped DEKs, not the key. If you restored a production backup into a
test environment and the credentials don't open, it's not corruption:
it's the wrong key. See
[Restore](#restore).

That's why the master key is part of the recovery plan: a database backup
without the matching key doesn't recover the user's secrets.

### When something goes wrong

| symptom | cause |
|---|---|
| the api boots with no rotation warning, but the script requires PREVIOUS | the variable never reached the pod; ESO only resyncs every `refreshInterval` (1h) |
| `failures` equal to the total | the published PREVIOUS isn't the key that wrapped the store |
| `already on current key` equal to the total, without having run before | both variables have the same value — the service ignores PREVIOUS in that case |
| a credential stops working AFTER step 3 | some row was left behind; republish PREVIOUS immediately and run the script again |

---

## Cost incident {#incidente-de-custo}

Agents spend tokens on every turn, and an agent stuck in a loop spends
fast. This section is for the moment cost per hour spikes and someone
needs to decide what to cut.

### Signal

The *Cost per hour above the limit* alert fires when projected spend goes
above USD 5/hour on any project:

```promql
max(sum by (project) (rate(brabo_llm_cost_micros_total[10m])) * 3600 / 1000000)
```

The alert is a **warning**, not a brake. The real brake is the domain's
`budgets`, and it acts per project/session, never globally
([RN-019](business-rules.md#rn-019)).

### 1. Which project, which agent

Grafana → **Brabo · executive view** dashboard → cost-per-project panel.
Or straight from the database, which also gives you the agent and the
model:

```sql
select s.project_id,
       tu.actor_id                             as agente,
       tu.model_name,
       count(*)                                as chamadas,
       sum(tu.cost_micros) / 1e6               as usd,
       round(avg(tu.latency_ms))               as latencia_media_ms
  from token_usage tu
  join sessions s on s.id = tu.session_id
 where tu.created_at > now() - interval '1 hour'
 group by 1, 2, 3
 order by usd desc
 limit 20;
```

Two readings change the action:

- **One agent dominating the list** with many short calls means a loop:
  the ToolLoop repeating the same tool without converging.
- **Few calls and high cost** means an expensive model on cheap work —
  wrong binding, not a loop.

### 2. Check the budget

```sql
select b.project_id, b.session_id,
       b.limit_micros / 1e6  as limite_usd,
       b.spent_micros / 1e6  as gasto_usd,
       round(100.0 * b.spent_micros / nullif(b.limit_micros, 0)) as pct,
       b.policy
  from budgets b
 order by pct desc nulls last;
```

`policy` decides the behavior at the ceiling:

- **`block`** — the call is refused. This is the default and what you
  want in production.
- **`allow`** — the ceiling becomes a mere record; spending continues. A
  project on `allow` spending heavily **won't stop on its own**. Check
  this before anything else: it's the most common cause of "the budget
  didn't hold".

### 3. Cut the spend

In order of reversibility, from mildest to most drastic.

**a) Take the agents out of automatic autonomy.** They stop acting on
their own and go back to requiring per-action approval, without losing
context:

```sql
update agent_autonomy set mode = 'manual' where project_id = '<projeto>';
```

**b) Switch the model binding to a local one.** Ollama costs zero; quality
drops, spending stops on the spot:

```sql
-- see the binding in effect and the scope that resolves it
select scope, scope_id, model_id from model_bindings where scope_id = '<projeto>';
```

Then point the project's binding at a `local` model through the settings
screen (the most specific scope wins: session > agent > project >
workspace — [RN-020](business-rules.md#rn-020)).

**c) Lower the ceiling and make sure it's `block`.** Makes the domain
itself refuse the next calls:

```sql
update budgets
   set policy = 'block',
       limit_micros = least(limit_micros, spent_micros + 1000000)  -- +1 USD
 where project_id = '<projeto>';
```

**d) Close the project's sessions.** Last resort: interrupts work in
progress. Use the normal transition (`closing`), never `kill` on the pod
— killing the pod doesn't close a session, it just creates an orphan
(see [Engine rollout](#rollout-do-engine)).

### 4. Afterward

- **The Psychologist already has the evidence.** If the cause was an
  agent loop, its analysis points at the target agent and Anamnesis can
  propose an instruction patch. Fixing the instruction is what prevents
  it happening again; touching the budget only buys time.
- **Check that the alert arrived.** The rules live in Grafana, not
  Prometheus: if Grafana was down, there was no warning, and the silence
  didn't mean health.

### What this section doesn't fix

Cost already incurred. Metering is a record, not a refund: `token_usage`
counts what was spent, and nothing here gives money back from the
provider. The only real prevention is `policy = 'block'` with a sensible
ceiling **before** the incident.

---

## Observability {#observabilidade}

How to follow a session, find cost, and diagnose when there's no data.
Decisions in
[ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md).

### Local observability, no cluster {#observabilidade-local}

Everything below this subsection assumes the cluster is up. For metrics
and logs without bringing up Kubernetes, there's a Compose overlay
([ADR 0070](adr/0070-observabilidade-no-compose-local.md)):

```bash
pnpm dev:obs     # brings up the dev stack + Prometheus, Loki, Alloy, and Grafana
pnpm obs:down    # tears down just the four, leaving the apps up
```

The command finishes by checking what came up — if it says `ok` on every
line, the panel has data; if it complains, it says which piece was
missing.

| tool | address | serves for |
|---|---|---|
| Grafana | <http://localhost:3001> | dashboards and logs, no login |
| Logs | <http://localhost:3001/d/brabo-logs> | one service at a time, or all three together |
| Prometheus | <http://localhost:9090> | checking a target and raw series |
| Loki | <http://localhost:3100> | direct query (the normal path is Grafana) |

**The dashboards are the SAME as the cluster's** — Compose mounts
`deploy/k8s/observability/dashboards/` directly, and the datasource UIDs
(`brabo-prometheus`, `brabo-loki`) are the same. A new dashboard is valid
in both environments with no copying.

**What this overlay doesn't do:** tracing. Without an OpenTelemetry
Collector in the middle there's no Tempo, and that's a decision, not an
oversight ([ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md),
decision 9). The `trace_id` still goes into the log and is enough to
cross-reference api and engine by hand.

Three things that confuse people, and are worth knowing before opening an
issue:

1. **An empty cost/tokens panel is expected on a fresh database.** Those
   metrics have labels (`project`, `provider`), and in `prom-client` a
   labeled metric doesn't exist before its first observation. One LLM
   call and the series appears.
2. **Only `api`, `engine`, and `web` go to Loki.** Postgres and Ollama are
   left out for noise; the observability stack itself is left out because,
   in the same Compose project, it would ingest its own log in a loop.
3. **The `OUTRO` (OTHER) level** is `pino-pretty`'s tree continuation
   line, which has no level of its own. It's not a lost log.

### Where things are

| tool | local address | serves for |
|---|---|---|
| Grafana | <http://localhost:3001> | dashboards, traces, logs, alerts |
| Prometheus | `kubectl -n monitoring port-forward svc/prometheus-server 9090:80` | checking a target and raw series |
| Tempo | Grafana datasource | traces |
| Loki | Grafana datasource | logs |

Two dashboards in the **Brabo** folder: *executive view* (cost/hour and
tokens/min per project, active sessions, action decisions) and
*operational view* (Oban queue by state, LLM p50/p95 latency by provider,
blocked tasks, sessions per replica).

### Following a session from the root to a tool call

1. Grab the session's `trace_id`. It's the middle field of the
   `traceparent` stored in `sessions.trace_parent`:

   ```bash
   # 00-<trace_id>-<span_id>-01
   curl -sS -H "Authorization: Bearer $TOKEN" \
     http://localhost:3000/projects/$PROJ/sessions/$SESS | jq -r .traceParent
   ```

2. In Grafana → **Explore** → **Tempo** datasource → **TraceQL** tab,
   paste the `trace_id`. The tree comes back with `session.create` (api)
   at the root and, below it, `agent.turn` → `tool.call` / `llm.turn` /
   `gate.scanner` (engine).

3. From a span, the **Logs for this span** button jumps to the Loki lines
   with that `trace_id`. The reverse path — from a log line to the trace
   — is the **TraceID** link that shows up in the line's detail.

4. Cost for that session: the *executive view* dashboard filters by
   project. For an exact per-session value, the source is the database
   (`token_usage.cost_micros`), not the metric — the metric is aggregated
   by project and provider on purpose, to avoid creating one series per
   session.

### When there's no trace in Tempo {#quando-nao-ha-trace-no-tempo}

This section's name changed along with its behavior (ADR 0035), and the
distinction is the first diagnostic step: **a span is always created, in
any environment.** What `OTEL_EXPORTER_OTLP_ENDPOINT` controls is
EXPORTING. So "I don't see a trace in Grafana" and "there's no trace" are
different problems.

Before anything else, see which side the failure is on — the log answers
on its own:

```bash
kubectl -n brabo logs -l app.kubernetes.io/name=api --tail=20 | grep -o '"trace_id":"[^"]*"' | head
```

- **There's a `trace_id` in the log, no trace in Tempo** → the problem is
  exporting: follow 1 through 4 below.
- **No `trace_id` in the log** → the problem is context, and it's rarer:
  either the api's `startTracing()` didn't run (see
  `apps/api/src/tracing-boot.ts` — it has to be `main.ts`'s first import),
  or `Engine.Telemetry.Otel.setup/0` wasn't called before the supervision
  tree.

In order, most to least likely:

**1. The variable isn't set.** Without `OTEL_EXPORTER_OTLP_ENDPOINT` the
span is created and discarded at the end, so there's a `trace_id` in the
log and nothing in Tempo. In development that's expected (no collector);
in a cluster, it's a defect.

```bash
kubectl -n brabo exec deploy/api -- printenv OTEL_EXPORTER_OTLP_ENDPOINT
kubectl -n brabo exec deploy/engine -- printenv OTEL_EXPORTER_OTLP_ENDPOINT
```

**2. The NetworkPolicy is blocking it.** This is the most silent failure
of all: the spans are created, the send fails, and everything else stays
green.

```bash
kubectl -n brabo get networkpolicy allow-otlp-egress
kubectl -n brabo logs -l app.kubernetes.io/name=engine --tail=50 | grep -i "error exporting"
```

**3. Wrong protocol.** Elixir's exporter speaks **HTTP/protobuf (4318)**,
not gRPC. Pointing it at 4317 gives `socket_closed_remotely` on every
batch.

**4. The Collector isn't receiving anything.**

```bash
kubectl -n monitoring logs deploy/otel-collector-opentelemetry-collector --tail=30
```

### When a panel is empty

Almost always a **metric name**. Names are referenced by string in three
places that don't see each other: the dashboards, the alert rules, and
this runbook. Check against what the service actually exposes:

```bash
curl -sS http://localhost:3000/metrics | grep '^brabo_' | cut -d'{' -f1 | sort -u
kubectl -n brabo exec deploy/engine -- wget -qO- http://127.0.0.1:4000/metrics | grep -E '^(brabo|oban)_'
```

And if the service exposes it but Prometheus doesn't have it, the
problem is the scrape:

```bash
kubectl -n monitoring port-forward svc/prometheus-server 9090:80
# then: http://localhost:9090/targets — the jobs are `brabo-api` and `brabo-engine`
```

### When there's no log in Loki

Alloy is a DaemonSet and reads `/var/log/pods` from the node, filtering
by the `brabo` namespace.

```bash
kubectl -n monitoring logs -l app.kubernetes.io/name=alloy --tail=30 | grep -i error
```

Warnings about `tailer stopped ... pods not found` are normal after a
rollout — Alloy keeps chasing pods that have already been removed.

The apps **can't** talk to Loki directly, and that's intentional:
`allow-otlp-egress` only opens 4317/4318. To query from outside:

```bash
kubectl -n monitoring port-forward svc/loki 3100:3100
curl -sS -G http://localhost:3100/loki/api/v1/query_range \
  --data-urlencode '{app="api"} | json | trace_id != ""' --data 'limit=5'
```

### Alerts

Provisioned and visible under **Alerting → Alert rules** (Brabo folder):

| alert | what to investigate |
|---|---|
| Oban queue growing with no consumption | no engine replica Ready; Postgres pool exhausted; a worker stuck on a job |
| Session stuck in `closing` | [the drain didn't complete](#quando-a-sessao-escapa), or the transition to `closed` failed |
| Cost per hour above the limit | [which project and which agent](#incidente-de-custo); the domain's budget remains the hard control |
| Last backup run failed | [the backup exists but is old](#restore) — the dangerous case |

These are **Grafana** rules, not Prometheus (deviation recorded in ADR
0026): they stop being evaluated if Grafana goes down. There's no
Alertmanager or notification destination configured.

### Known limits

- No **real** agent trace has been observed end to end: verifying that
  requires a configured LLM (Ollama or an API key). The mechanism was
  validated by emitting spans directly into the session's trace.
- The web doesn't export its own spans — it **generates** the
  `traceparent` and sends it in the header, and the api adopts it as
  parent. Browser logs go to the console, not to Loki.
- Short retention: Tempo 24h, Loki 24h, Prometheus 2h. It's a local
  environment.

---

## Gate registry {#registro-de-gates}

The flow's gates are declared in `docs/gates.yml`
([ADR 0054](adr/0054-gates-como-registro-declarativo.md)). Two operational
things are worth knowing.

**The file travels inside the image.** `docker/api/Dockerfile.prod` copies
it in both stages, the same way it does with migrations, and
`.dockerignore` re-includes it explicitly — all of `docs/` is ignored, and
this is the only file from there that's production data, not
documentation. At runtime it sits at `/app/docs/gates.yml`; the loader
climbs up from `__dirname` until it finds it, with no environment
variable.

**An unreadable file doesn't bring down the api.** Loading is lazy:
whoever calls `GET /internal/gates` gets the error, and the rest of the
process keeps going. If the route returns an error, check that the file
made it in:

```bash
kubectl -n brabo exec deploy/api -- cat /app/docs/gates.yml | head -5
```

Empty or missing means the image was built without it — likely a tweaked
`.dockerignore`, or a build from a context that has no `docs/`.

To see the registry the way the api sees it, already validated:

```bash
kubectl -n brabo exec deploy/api -- \
  curl -sH "x-brabo-service-token: $BRABO_SERVICE_TOKEN" localhost:3000/internal/gates
```

Passage measurement does NOT run in production: it's
`pnpm --filter api validacao:gates`, from the repository, against the
database. See
[docs/explanation/gates.md](explanation/gates.md).

---

## Inference environment {#ambiente-de-inferencia}

When the agent responds empty, truncated, extremely slowly, or "forgets"
its own instructions, the problem is almost never in the domain code —
it's here. The first five causes were found across nine straight runs of
the gates demo and are recorded in
[ADR 0020](adr/0020-destravar-gates-qa-secops.md); all the variables are
exposed in `docker-compose.yml`.

| variable | symptom when wrong |
|---|---|
| **GPU** | the `ollama` service with no device reserved leaves the GPU idle and runs 100% on CPU: a ~7,000-token prompt takes ~50s just for ingestion. The override is opt-in (`docker-compose.gpu.yml`, `pnpm dev:gpu`), kept out of the main compose because without `nvidia-container-toolkit` on the host the reservation **makes the service fail to start** |
| `OLLAMA_CONTEXT_LENGTH` | the default of 4096 **silently** truncates a prompt built for 128k. The agent loses its own instructions and starts imitating the tools' schema, which is what's left at the end of the context |
| `OLLAMA_MAX_LOADED_MODELS` | with `OLLAMA_KEEP_ALIVE` set high, models pile up: 15.2 GB of resident weights on a 15 GB machine, and the agent responds empty for lack of memory |
| `OLLAMA_REQUEST_TIMEOUT_MS` | too short a timeout for a large model on a long prompt |
| `OLLAMA_MODE` (dev bootstrap, [RN-461](business-rules.md#rn-461), ADR 0114) | stuck at `host` after the native Ollama on the developer's machine was uninstalled or stopped — every local-LLM turn fails with `ECONNREFUSED` against `http://host.docker.internal:<port>`, and the compose `ollama` service never starts to cover for it (it's gated behind `profiles: ["local-llm"]`, and this variable is what keeps that profile off). Fix: `Docker › Reconfigurar Ollama` in `pnpm bootstrap`, which clears `OLLAMA_MODE`/`OLLAMA_HOST` from `.env` and forces the detection to ask again on the next `Create`/`Reset total` |
| `START_OUTBOX_DRAIN` / `START_ANAMNESE` | the Psychologist and Anamnesis consume LLM turns in parallel with the execution agents and drop the dev's connection mid-cycle |
| `TOOL_LOOP_MAX_ITERATIONS*` | a ceiling that's too LOW and the agent stops without delivering, with `iteration limit reached` and origin `model` — which is misleading, because the model made no wrong judgment at all, it never got to judge. The ceiling is per TYPE ([RN-085](business-rules.md#rn-085)): `8` for conversational agents, `60` for the dev agent and QA. Before raising it, check whether the agent HAS `token_budget_micros`; without it the ceiling is the only cost guard that exists |
| `TERMINAL_OUTPUT_MAX_BYTES` | raising it too much brings back the failure mode the ceiling exists to prevent: each command's output stays in the loop's history and travels on EVERY following turn. It's not a context-window issue: the largest successful call from the execution that first revealed this had only 28,993 input tokens ([RN-074](business-rules.md#rn-074)) |
| `API_JSON_BODY_LIMIT` (api) / `TRANSPORT_MAX_BODY_BYTES` (engine) | the `413 request entity too large` on the QA/SecOps gate had its cause in Brabo's own api, never in the provider — Express never had a body limit configured and the default of 100 KB was in effect, against the 8 MB Phoenix accepts on the heaviest engine→api leg (`POST .../llm-turn`, which resends the entire history on every iteration). `API_JSON_BODY_LIMIT` (default 10 MB) closes that end; `TRANSPORT_MAX_BODY_BYTES` (default 8 MiB) is the ceiling the engine's context compaction respects ON TOP OF the model's window, so it fires before the body blows the HTTP limit ([RN-412](business-rules.md#rn-412), [ADR 0098](adr/0098-limites-de-transporte-e-janela-efetiva-de-compactacao.md)) |

> **Careful — the guard doesn't clear the queue.** `START_ANAMNESE=false`
> blocks **new** enqueues, not the old ones. There have been 20
> `AnamneseWorker`s piled up in `executing` from previous runs, which run
> on the next boot regardless of the guard. The queue needs to be
> **purged**, not just have the guard turned off.

### A semantic gate on a small model

QA is the role that fits worst in a local 7B: the judgment varies between
runs, which makes the demo an executable acceptance criterion and **not**
a regression test. To make it reliable, point `DEMO_QA_MODEL` at an API
model — the per-agent binding (`agent` scope, which beats `project`)
exists exactly for this.

The gate machine itself doesn't vary: immutable order, return on the same
branch, a ceiling on corrections, verdicts as an artifact, and a terminal
`awaiting_user` are all verified by ExUnit
([RN-014](business-rules.md#rn-014), [RN-015](business-rules.md#rn-015)).

---

## Adding a compatible provider {#adicionando-um-provider-compativel}

Applies to any provider that speaks OpenAI's `/chat/completions` dialect —
which is the case for practically every hub and every managed inference
service. The base already exists
([ADR 0041](adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md));
what you write is **configuration**, not parsing.

### 1. Read the official doc before writing the first line

Four things need to come from the provider's documentation, not guessing:
`baseUrl`, the auth header, the `usage` format in the stream, and the
streaming quirks. Record the consulted URL and the date at the top of the
config file — it's the only way to know, months later, whether the config
is stale.

Whatever diverges from the OpenAI standard becomes a **flag in the base**,
never an `if` scattered around. If the divergence doesn't fit an existing
flag, add one — and only because this real provider needs it.

### 2. Write the config

```ts
// apps/api/src/infrastructure/llm/<provider>-provider.ts
export function meuProviderConfig(baseUrl = BASE_URL): OpenAICompatibleConfig {
  return {
    name: 'meu-provider',
    baseUrl,
    capabilities: { streaming: true, toolCalling: true, listModels: true },
    authHeaders: (apiKey) => ({ Authorization: `Bearer ${apiKey ?? ''}` }),
    flags: { streamOptionsIncludeUsage: true, maxTokensField: 'max_tokens' },
    // Only if its catalog returns more than `{ data: [{ id }] }`:
    // parseCatalogo: (corpo) => ...,
    // Only if it's a HUB (reports who actually served the request):
    // extrairUpstreamProvider: (frame) => ...,
  };
}
```

Export the config function, not just the class: that's what the contract
suite points at the fake server. A copy of the config written inside the
test would pass green even if production's diverged.

### 3. Run the contract suite against it

```ts
runLLMProviderContract('meu-provider', () => ({
  dialeto: dialetoOpenAI, // reuse the base's if the format is the same
  criar: (baseUrl) =>
    new OpenAICompatibleProvider(meuProviderConfig(baseUrl), new GptTokenizerEstimator()),
  usageFallback: 'estimated',
  timeoutEnv: 'LLM_REQUEST_TIMEOUT_MS',
  temFerramentasNoPedido: (body) => Array.isArray(body.tools),
  modelo: 'algum-modelo',
}));
```

Inherited for free: streaming with a split frame, usage present and
absent, tool calling, the four normalized errors, the catalog, and a mute
server.

### 4. Register the provider and the credential kind

1. **two places, on purpose**: the `LLMProviderName` type in
   `packages/shared/src/index.ts` (the web uses it too) and the runtime
   list `LLM_PROVIDER_NAMES` in
   `apps/api/src/domain/llm/llm-provider-names.ts`. They can't live
   together: `packages/shared` is 100% types — a value exported from
   there breaks the api's production image at boot with
   `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, and
   `apps/api/test/packages-shared-so-tipos.spec.ts` fails before it gets
   there. Forgetting the list doesn't pass silently: the exhaustiveness
   check in both directions breaks the typecheck, just like the web's
   exhaustive `ROTULO_DO_PROVIDER` `Record` breaks until the provider
   gets a label;
2. if it's a hub, add the name to `HUBS` in `apps/web/src/lib/models.ts`
   so it falls into the right group in the selector;
3. the api's provider registry (`llm-infrastructure.module.ts`);
4. the provider's `pgEnum` in the schema plus a migration, if the name is
   new.

### 5. Seed the models with the price from the docs

A typed-in price comes with `manual_pricing: true`. That protects the row
from the price sync: for a provider that doesn't expose price in its
catalog, the manual number is the only one that exists.

If the provider exposes `GET /models`, **don't seed the whole catalog** —
let the sync discover it. It writes the models in a disabled state, and
the owner enables what matters through the curation screen
([RN-043](business-rules.md#rn-043)).

If the provider's catalog publishes **modality** (accepts image, generates
image) or `reasoning`, emit them in its `parseCatalogo` — and only when
the official doc says so. A field the provider doesn't declare stays
**omitted**, never `false`: `undefined` preserves what was already
recorded, and `false` would wipe out hand-curated data
([RN-056](business-rules.md#rn-056)).

### 6. Verify with a real credential

```bash
# on the project's settings screen: register the credential, then
# "Update catalog" and check the per-provider report.
```

The report shows **every** provider, including the skipped ones, with the
reason and the origin of the failure. `sem_credencial` means the key
never arrived; `falha · origem infra` means it couldn't even reach the
provider; `falha · origem modelo` means it answered with a refusal.

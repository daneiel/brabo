---
traducao_de: 35a0dc07ccbd159e749036b48dc8d249d4e3b8f8
id: autenticacao
title: 'Business rules — Authentication'
sidebar_label: Authentication
description: 'The first-party auth RNs: refresh with rotation, cookie session, PAT, OAuth and device key.'
keywords: [business rules, authentication, refresh, cookie, PAT, OAuth]
---

# Authentication

> These RNs came out of [`business-rules.md`](../business-rules.md) without
> changing a comma of the content: the single page was over 640 KB and
> these two sections alone were half of it. The `#rn-NNN` anchors
> remain identical — only the file that hosts them changed.

First-party auth rules. All of them hold in the api domain, which since 7.2 is
also the **issuer** of access tokens — Keycloak left in an atomic cut,
with no coexistence period.
Decisions in [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)
and [ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md).

### RN-030 — Presenting an already-used refresh revokes the whole family {#rn-030}

Each refresh consumes the presented token and issues a child with the **same**
`family_id` and the same `family_started_at`. Presenting a token that was already
consumed is the signature of a theft — someone is using a copy — and the
response is to revoke every live token of that family, with a security
event.

The legitimate user is logged out along with it. That is the correct behavior, not a
defect: on the server side, a client double-submit and a thief's replay
are identical.

- **Where:** `apps/api/src/domain/auth/refresh-token.ts:50` +
  `application/use-cases/auth/refresh.use-case.ts:98`
- **Test:** `test/application/use-cases/auth/rotacao-e-reuso.spec.ts`
- **Edge case:** whoever presents a token from an **already revoked** family is a
  downstream victim, not a new theft: it records `refresh_revoked` and does **not** fire a second
  cascade. Without that distinction, each tab of the legitimate user would raise a false
  alarm during the incident.
- **Origin:** [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)

### RN-031 — Login failure is counted per e-mail and per IP, and the lockout escalates {#rn-031}

A 15-minute sliding window in Postgres, without Redis. Two buckets per
attempt and the most restrictive wins: e-mail (5 failures → 30s, 8 → 5min, 12 →
15min) and IP (20 → 30s, 30 → 2min). A successful login clears the
e-mail bucket; the IP one drains only over time.

The bucket key is the **normalized e-mail**, never the user id. With the id, the
bucket would only exist after finding the account, and the lockout itself would become
an existence oracle.

- **Where:** `apps/api/src/domain/auth/lockout-policy.ts:97` +
  `infrastructure/persistence/drizzle/drizzle-login-throttle.ts:74`
- **Test:** `test/application/use-cases/auth/lockout.spec.ts`
- **Edge case:** while locked, the attempt is **not** recorded. If it were, an
  attacker would keep the victim's account locked forever just by continuing to
  try — the lockout would become a denial of service against the one it protects.
- **Why:** the IP bucket cannot be cleared on success; whoever has a valid
  account would reset the window at will and spray guesses without limit.
- **Origin:** [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)

### RN-032 — No response distinguishes an existing account from a nonexistent one {#rn-032}

Any response other than the uniform failure is only reachable **after** a
successful password check. On login, nonexistent e-mail, wrong password and
locked account return the same 401 and spend the same time — the no-account branch
verifies against a dummy hash generated with **the same parameters** as the real one. On
registration and on the reset request, known and unknown addresses return 202.

- **Where:** `apps/api/src/application/use-cases/auth/login.use-case.ts:79` +
  `register.use-case.ts:74`
- **Test:** `test/application/use-cases/auth/enumeracao.spec.ts`
- **Edge case:** the per-e-mail lockout check runs **after** argon2, not
  before. Exiting earlier is the optimization any reviewer would suggest, and it is
  exactly the leak — the test turns red if someone introduces it.
- **Edge case:** the user MIGRATED from Keycloak (exists in `users`, with no row in
  `auth_credentials`) also gets the uniform 401 — and the "set
  password" link is sent silently. Answering `password_pending` would confirm that
  the address exists **and** that it is a legacy account. That is why `findByEmail` is a LEFT
  JOIN in a single query: two chained queries would make this branch pay one
  extra round trip to the database, and the clock would reveal what the body hides.
- **Why:** what is claimed is "no branch skips the expensive work and none
  produces a distinguishable response", **not** constant time. See the consequences
  in the ADR.
- **Origin:** [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md),
  migrated-user edge case in
  [ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)

### RN-033 — Verification and reset tokens are valid only once {#rn-033}

Consumption by conditional UPDATE with `returning`: the UPDATE itself is the guard.
Zero rows covers nonexistent, of another purpose, already consumed, invalidated and
expired — all with the same response. Requesting a new link invalidates the previous one.
Completing a reset revokes **all** of the user's sessions and issues no tokens.

- **Where:** `apps/api/src/infrastructure/persistence/drizzle/account-token.repository.ts:76`
- **Test:** `test/application/use-cases/auth/tokens-de-conta.spec.ts`
- **Edge case:** two simultaneous submissions do not both pass. The race is the
  **normal** case, not the exception: corporate e-mail scanners open every link of
  every message, so the robot usually consumes the token before the human clicks.
- **Why:** the reset issues no session on purpose — logging in directly from
  a link received by e-mail would make compromising the e-mail equal to taking over the
  account, with no second step.
- **Origin:** [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)

### RN-034 — The web session lives in an httpOnly cookie, with CSRF {#rn-034}

The refresh token goes in a `brabo_refresh` cookie (`httpOnly`, `SameSite=Strict`,
`Path=/auth`, `Secure` in production) and does **not** appear in the body of any
response. The access token, of 15 minutes, stays in memory on the client and travels in
`Authorization: Bearer`.

`/auth/refresh` and `/auth/logout` require `X-CSRF-Token` equal to the
`brabo_csrf` cookie, compared in constant time.

- **Where:** `apps/api/src/interfaces/http/auth/session-cookies.ts:53` +
  `interfaces/http/auth/auth.controller.ts`
- **Test:** `test/interfaces/session-cookies.spec.ts`
- **Edge case:** a CSRF failure is **403**, not 401. With 401 the client would try
  to renew the session and enter a loop — the credential is fine, what is wrong
  is the request.
- **Why:** also returning the refresh in the body would cancel out `httpOnly` —
  an XSS reading the login response would be enough, and it would take the long session instead of
  the 15 minutes of the access token.
- **Origin:** [ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)

### RN-035 — Internal engine ↔ api traffic requires the service secret {#rn-035}

The 32 `/internal/*` routes are `@ServiceRoute()`: they stay outside the user JWT and
outside the rate limit. What authenticates is the `EngineServiceGuard`, comparing
`X-Brabo-Service-Token` with `BRABO_SERVICE_TOKEN` in constant time. The same
secret holds in both directions, and `BRABO_SERVICE_TOKEN_PREVIOUS` is accepted only on
verification, so that rotation has no unavailability window.

- **Where:** `apps/api/src/interfaces/http/auth/engine-service.guard.ts:44` +
  `infrastructure/security/service-token.ts` +
  `apps/engine/lib/engine_web/plugs/verify_service_token.ex`
- **Test:** `apps/engine/test/engine_web/plugs/verify_service_token_test.exs`,
  `test/interfaces/route-surface.spec.ts` and, for rotation on the api side
  (previous accepted only on verification, the caller sends the current one, once the
  previous is removed the old one fails), `test/infrastructure/security/service-token.spec.ts`
  (describe "rotação do BRABO_SERVICE_TOKEN") and
  `test/interfaces/engine-service.guard.spec.ts` ([RN-597](#rn-597))
- **Edge case:** the rate limit exemption comes from the route METADATA, not from the guard. The
  `RateLimitGuard` is an `APP_GUARD` and runs before any controller guard —
  when it decides, the `EngineServiceGuard` has not run yet.
- **Origin:** [ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)

### RN-597 — Changing the pepper is a global logout {#rn-597}

The pepper that keys the HMAC of opaque tokens has no `_PREVIOUS`, and changing it
has a consequence, not a procedure: every refresh token in circulation, every open
e-mail verification and password reset link, and every personal
access token (PAT) can no longer be found, because the hash recomputed with the
new pepper does not match the stored one. The refused refresh records
`refresh_unknown` (and not `refresh_reuse_detected`), the link says "Link inválido
ou expirado", and the lockout buckets change key — a locked account unlocks. The
PASSWORD survives (argon2id with per-record salt, no pepper): changing the pepper
costs a login, never an account, and the api starts normally with the new value.

Until [RN-613](#rn-613), a pepper without its own value fell back to
`AUTH_JWT_SECRET`, and rotating the JWT was also rotating the pepper, with all the
consequences above. Since then the pepper is mandatory in production and never
borrowed from the JWT.

- **Where:** `apps/api/src/infrastructure/security/auth-key-material.ts:212`
  (`pepper`), `:228` (`hashDeToken`), `:247` (`baldeDeEmail`);
  `apps/api/src/interfaces/http/auth/pat-auth.guard.ts:142`
- **Test:** `test/application/use-cases/auth/rotacao-dos-segredos.spec.ts`,
  against the test Postgres
- **Edge case:** the TARGET of "changing" includes the mistake of whoever separates the pepper from the JWT
  by generating a new value instead of copying the current one — it is the same change, and logs out
  the same way (pinned in the same spec, "a ordem errada").
- **Origin:** [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md),
  AT-196

### RN-613 — `AUTH_TOKEN_PEPPER` is mandatory and its own; whoever migrates sets it with the current `AUTH_JWT_SECRET` {#rn-613}

The HMAC pepper of opaque tokens (refresh, account links, PATs, lockout
bucket) no longer falls back to `AUTH_JWT_SECRET`. The silent fallback
(`AUTH_TOKEN_PEPPER ?? passphraseAtual()`) turned every "zero-downtime"
JWT rotation into a pepper change, and it was the COMMON path: the production
and installation composes did not even pass the variable through. In production the api REFUSES
to start without it, and the refusal states the fix — *"defina com o valor ATUAL de
AUTH_JWT_SECRET para não deslogar ninguém"* —, because the obvious fix (generating
a random one) is the one that logs everyone out. With the pepper equal to the old JWT the
hash is byte for byte the previous one, refresh tokens and PATs remain valid, and
from then on the JWT rotates on its own. A pepper equal to the JWT is NOT refused: it is the
legitimate state of every migrated installation. The JWT rules (RN-114) apply:
blank, the two example literals from the repository and fewer than 16 characters
bring down the boot. Outside production a development default of its OWN applies
(`dev-auth-token-pepper-change-me`), never the JWT's.

The `install.sh` does the migration: a NEW installation generates a random pepper;
if there is a previous `.env` in the folder, it is READ (never executed) before being
overwritten, and its pepper is kept — or, without a pepper, it is born with its
`AUTH_JWT_SECRET`. The terminal says where the value came from, never the value.

- **Where:** `apps/api/src/infrastructure/security/auth-key-material.ts:168`
  (`pepperAtual`), `:212` (`pepper`); `apps/api/src/main.ts:46` (the boot
  check); `install.sh:702` (`valor_no_env_anterior`), `:734` (`gerar_segredos`),
  `:831` (`dizer_a_origem_do_pepper`); the variable in the three composes
  (`docker/docker-compose.yml`, `docker-compose.prod.yml`,
  `docker-compose.install.yml`), in `docker/smoke.sh` and in `.env.example`
- **Test:** `test/infrastructure/security/auth-key-material.spec.ts`
  (describe "pepperAtual (RN-613)": refusal without pepper even with JWT, the
  message, the examples, the floor, equal to the JWT accepted, the dev default);
  `test/application/use-cases/auth/rotacao-dos-segredos.spec.ts` (describe "a
  migração do RN-613": the refresh stored with the OLD formula remains valid with the
  pepper equal to the old JWT and survives the JWT change; the
  `AUTH_JWT_SECRET` describe: without pepper outside production, changing the JWT does not log out);
  `scripts/dev/install-env.spec.ts` (describe "o AUTH_TOKEN_PEPPER do
  instalador (RN-613)", against `docker compose config`, whole value)
- **Edge case:** the installer only sees the `.env` of the folder it runs in. An installation
  whose `.env` lives elsewhere, a custom compose and Kubernetes with
  `ExternalSecret` do the migration by hand, through the runbook — in Kubernetes the
  `AUTH_TOKEN_PEPPER` property already existed in the `ExternalSecret` and in
  `bootstrap.sh`, and a provider that lacks it already failed the sync.
  And the installer migration wipes the volumes (ADR 0150): the refresh only
  survives for whoever restores the Postgres dump, which is the case that matters.
- **Origin:** AT-210 (finding from AT-196), maintainer decision: migration with the
  current value

### RN-595 — Every `_PREVIOUS` a service reads reaches it through the three composes, empty by default {#rn-595}

The three zero-downtime rotations (`AUTH_JWT_SECRET`, `BRABO_SERVICE_TOKEN`,
`CREDENTIALS_MASTER_KEY`) depend on the process seeing the old value in a
`_PREVIOUS` variable during the window. Compose does not pass the host
environment through, and none of the three was in the `environment:` of any compose: setting the
`_PREVIOUS` in `.env` had no effect, and whoever followed the runbook performed, without
knowing, the dry swap that rotation exists to avoid. Now the api receives the
three, and the engine and the broker receive `BRABO_SERVICE_TOKEN_PREVIOUS`, in the dev,
production and installation composes, always with an EMPTY default — set means
rotation in progress, and a filled default would leave the installation
forever in the middle of one. Empty is the same as absent in the three readers.

- **Where:** `docker/docker-compose.yml`, `docker/docker-compose.prod.yml` and
  `docker/docker-compose.install.yml` (services `api`, `engine` and `broker`);
  the readers are `apps/api/src/infrastructure/security/auth-key-material.ts:136`
  (`passphraseAnterior`), `apps/api/src/infrastructure/security/service-token.ts:92`
  (`tokenDeServicoAnterior`), `apps/api/src/infrastructure/security/envelope-encryption.service.ts:93`,
  `apps/engine/config/runtime.exs:70` and `apps/broker/src/config.ts:85`
- **Test:** `scripts/ci/previous-nos-composes.spec.ts` — DERIVES from the code of the
  three services the list of `_PREVIOUS` read and fails the one that is missing, or comes
  with a non-empty default, in any of the three composes; the "ExternalSecret
  do k8s" block fails the `ExternalSecret` without `dataFrom.extract`, a `_PREVIOUS` in
  `data:` and the api/engine Deployment without `envFrom: brabo-secrets`
- **Kubernetes (AT-220, maintainer decision):** the Pods read
  `envFrom: brabo-secrets`, and the `ExternalSecret`
  (`deploy/k8s/base/common/externalsecrets.yaml`) pulls the WHOLE `brabo` object
  from the store via `dataFrom.extract` — the `_PREVIOUS` comes in when it exists
  and leaves when it is removed, on the next sync. It cannot be listed in
  `data:`: ESO has no optional key, and an absent property (the normal
  state) fails the sync of the whole Secret. Declared cost: EVERY
  key of the object becomes an api, engine, migrations and backup variable, and a
  MANDATORY key that is absent no longer fails the sync — the
  consumer is what flags it. Sync through a real ESO was exercised by hand on a disposable
  k3d, not in CI
- **Origin:** AT-201 (finding from AT-196), same class as RN-540; Kubernetes half
  in AT-220

### RN-598 — The PREVIOUS service token goes through the same rule as the current one {#rn-598}

During rotation, `BRABO_SERVICE_TOKEN_PREVIOUS` opens `/internal/*` just as much
as the current one. It goes through ONE rule, the same as the current one (`exigirTokenDeProducao`),
and no copy of it. Surrounding whitespace is discarded, and a value made only of
whitespace counts as absent. In production, the public development literal
(`dev-service-token-change-me`) and a value with fewer than 16 characters after
the trim BRING DOWN the api boot, with a message naming
`BRABO_SERVICE_TOKEN_PREVIOUS`. Before this, the variable was compared raw: a
previous with the example value opened the internal door to anyone who
had read this repository, without any error. Mandatoriness is the
only part of the current one's rule that is NOT copied, because outside rotation the
absent previous is the normal state. A previous equal to the current one (after
the trim) still does not count as rotation.

- **Where:** `apps/api/src/infrastructure/security/service-token.ts:63`
  (`exigirTokenDeProducao`), `:92` (`tokenDeServicoAnterior`);
  `apps/api/src/main.ts:50` (`tokenDeServicoAnterior`), which runs at boot next to the current one
- **Test:** `test/infrastructure/security/service-token.spec.ts` (describe
  "tokenDeServicoAnterior (RN-598)")
- **Edge case:** this RN is the api side. The engine and the broker apply the same
  rule since [RN-601](#rn-601).
- **Origin:** AT-205 (finding from AT-196)

### RN-601 — The engine and the broker apply the api's rule to both service tokens {#rn-601}

The three processes that compare the service token use the same rule as
[RN-598](#rn-598), each in its own language. Surrounding whitespace is discarded, and
a value made only of whitespace counts as absent. In production, an absent
`BRABO_SERVICE_TOKEN`, the public development literal
(`dev-service-token-change-me`) or a value with fewer than 16 characters after
the trim BRING DOWN the boot, with a message naming the variable. The last two
refusals also apply to `BRABO_SERVICE_TOKEN_PREVIOUS` when it
is set. A previous equal to the current one does not count as rotation. Outside
production only the trim applies, and an empty current one falls back to the dev default.

Before, the engine read both raw in `config/runtime.exs`: no trim, no floor,
and in production it started with the public default when the variable was missing (and with the
empty string when the compose passed it empty). Only the api refusing to start
protected the installation. The broker already applied the rule to the current one, but to the previous
only the trim.

Two divergences of form, declared. In the engine, "production" is
`config_env() == :prod` (the release), and not `NODE_ENV`, which it does not read; the
production image is always a `:prod` release. And the rule stays inline in
`runtime.exs`, not in a `lib/` module, because in a release that file
runs in a config provider before the application code is loaded.

Consequence: every process that evaluates that `runtime.exs` in a `:prod` release
needs the token, including the migration (`bin/engine eval
Engine.Release.migrate()`). That is why the `migrate-engine` service of the production
and installation composes started receiving `BRABO_SERVICE_TOKEN` and
`BRABO_SERVICE_TOKEN_PREVIOUS`, without default. The CI smoke showed it: without
them, the migration died before migrating. The Kubernetes migration Job already
received them through the `envFrom` of `brabo-secrets`.

- **Where:** `apps/engine/config/runtime.exs:85`
  (`exigir_token_de_servico_de_producao`), `:105` (`service_token`), `:121`
  (`service_token_previous`); `apps/broker/src/config.ts:89` (`anterior`),
  `:125` (`exigirTokenDeProducao`)
- **Test:** `apps/engine/test/engine/runtime_service_token_test.exs` (evaluates the
  real `runtime.exs` via `Config.Reader.read!/2`, with `env: :prod` and
  `:dev`); `apps/broker/src/config.spec.ts` (describe "lerConfiguracao —
  produção, o token ANTERIOR (RN-601)")
- **Edge case:** the rule is copied in the three processes, not shared: they are three
  languages or runtimes, and no test checks that the three copies remain
  equal. The floor counts characters (`String.length` in Elixir, `.length` in TS),
  which only differs for a token outside ASCII.
- **Origin:** AT-216 (finding from AT-205)

### RN-128 — `sessionId`/`projectId`/`agent`/`agentId` are validated BEFORE becoming a URL segment of the internal request to the engine {#rn-128}

`HttpApiToEngineClient` interpolates these values in a template string to
build the `/internal/*` URL — with no DTO/`class-validator` in between, just like
[RN-127](../business-rules/custo.md#rn-127): they come from `@Param`/session lookup without a validation
pipe at some point of the chain, and nothing guarantees their shape before
interpolation. A malicious value could inject an extra path segment
or characters that break the built URL — the `EngineServiceGuard` authenticates
the CALLER (RN-035), it does not CHECK what the caller sends in the URL.

`garantirSegmentoDeUrlInterna` reuses the same width as
`NOME_DE_PASTA_VALIDO` (RN-092/109) — hex, hyphen and underscore, 1 to 64
chars — and is called in TWO places, covering ALL the methods that
interpolate an id in a URL, not only the ones CodeQL reported:

- inside `postCommand`, which most methods already use
  (`startAgent`, `sendAgentMessage`, `confirmReadiness`, `cancelAgentTurn`,
  `offerInfraHandoff`, `invalidateInstructions`,
  `startExecution`, `acceptParallelization`, `rearmDevAgent`,
  `reviseStory`) — the caller lists the `(nome, valor)` tuples it already
  interpolated into the `path`, and `postCommand` validates ALL of them before building the
  request;
- directly in `reanalyzeSession`/`runAnamnese`, which do not go through
  `postCommand` (they need to distinguish 503 from a transport failure) and
  that is why they were the only two points CodeQL reached.

The happy path does not change: `sessionId`/`projectId` are always a UUID from the
database, and `agent`/`agentId` are always a short slug.

- **Where:** `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`
  (`garantirSegmentoDeUrlInterna`, `postCommand`)
- **Test:** `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts`
  (a malformed id is refused BEFORE touching the network — proven by pointing
  `ENGINE_URL` to a port nothing listens on — and the happy path does
  make the request)
- **Origin:** CRITICAL CodeQL alert (internal request URL built
  with an unvalidated value) blocking the qa→main promotion, found during
  PR #256; same pattern as [RN-092](../business-rules/custo.md#rn-092)

### RN-105 — Without an image decided by the Arquiteto, the container does not start and Code does not open {#rn-105}

The Code tab (`GET /projects/:id/code/*`, [ADR 0060](../adr/0060-superficie-de-leitura-de-codigo.md))
answers **409** while the project is in `sem_decisao` — the initial state
of every project. `sem_decisao` becomes `decidido` only when the Arquiteto emits
`artifact.project_image` through the `choose_project_image` tool, with an OCI image
with an explicit tag (`latest` refused), `rationale` and network posture.

The check lives in the SAME funnel as the path containment of
[RN-095](../business-rules/custo.md#rn-095) (`ReadProjectCodeUseCase.alvo`), and not in each of the seven
routes (tree, file, search, PR diff, [blame](#rn-110), [PR
list](#rn-111) and [detailed branches](#rn-112), FASE 26b) — a check
duplicated in seven callers is a check that one day diverges in one of them
([ADR 0058](../adr/0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md)).
Count corrected here: this record said "four routes" since FASE 26,
and became outdated when FASE 26b added the last three to the same
funnel without anyone revising this number.

The artifact has no table: it is the event itself in the event log, versioned
(`version` grows with each emission, the current one is the one with the highest `version`), the same
way as `artifact.module_map`. Revising the image is emitting a new version,
never overwriting the previous one.

- **Where:** `apps/api/src/domain/containers/project-container.ts`,
  `apps/api/src/application/use-cases/containers/decidir-imagem-do-projeto.use-case.ts`,
  `apps/api/src/application/use-cases/containers/obter-container-do-projeto.use-case.ts`,
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts` (method
  `portaoDoContainer`), `apps/engine/lib/engine/harness/tools/choose_project_image.ex`
- **Test:**
  `apps/api/test/domain/containers/project-container.spec.ts`,
  `apps/api/test/application/use-cases/containers/container-do-projeto.use-case.spec.ts`,
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  ("o portão do container" block)
- **Edge case:** 409 and not 403 — nothing is wrong with the requester or with their
  permission; the resource does not exist yet IN THIS STATE. And it is not 404: the tab
  exists, it is just not unlocked. The message says what is missing, so the screen shows
  the reason instead of a mute error (RN-088).
- **Origin:** [ADR 0065](../adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

### RN-106 — `git push`, PR and deploy do not go out through the terminal — even within the project scope {#rn-106}

**REVISED by [RN-418](../business-rules.md#rn-418) (ADR 0102, GLOBAL decision of the product
owner)**: the `deny` this record describes became an ABSOLUTE CEILING
(unconditional `require_approval`) — the rest of this entry is history,
faithful to what held until the revision.

Inside the project container the agent is free (ADR 0065): the verb allowlist
of [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) does not
converge (findings Z and AD — verb, form and invocation are distinct spaces), and the
way out is the wall, not a longer list. But three effects cross the
wall and reach the world, and the user's decision was verbatim: *"agente livre
para o que quiser desde que não seja comandos de git ligado ao deploy e ao PR —
estas ações ainda devem ser humanas"*.

`decide()` recognizes `git push`, `git remote add/set-url`, `git merge`, the provider
CLIs (`gh pr create`, `gh pr merge`, `glab mr create/merge`, releases and
workflow dispatch) and the common deploy commands (`kubectl apply`, `helm
upgrade`, `terraform apply`, `docker push`, `npm publish`, ...) by token
PREFIX, ignoring global flags in between (`git -C /tmp push` matches). Any
segment of the compound command that matches is **`deny`** — not `require_approval`:
"always allow" writes the pattern into `allow`, and one click would be enough for the
second door to stay open forever. `deny` beats `allow` at any
stage, and it is applied BEFORE any permissive stage in `decide()`.

Denying does not take power away from the agent: the message redirects to the TYPED action
(`git_push`, `git_merge`, `pr_open`) — which is born a `proposed_action`, has its own
minimum role and records in the event log what was pushed and where. It is the
path the dev agent already uses (`agent_io.ex` proposes `git_push`); what changes is
that it is now guaranteed by `deny`, not just agreed by convention.

- **Where:** `apps/api/src/domain/actions/external-effect.ts`,
  `apps/api/src/domain/actions/decide.ts` ("FRONTEIRA DO CONTAINER" block)
- **Test:** `apps/api/test/domain/actions/external-effect.spec.ts`,
  `apps/api/test/domain/actions/decide.spec.ts` (describe "a fronteira do
  container")
- **Edge case:** the boundary does NOT override the merge lock on a protected branch
  (RN-014, always manual) nor the path scope (RN-095/ADR 0055) — the three
  rules coexist, each one vetoing for a different reason.
- **Origin:** [ADR 0065](../adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

### RN-107 — The Code tab has a FOURTH state: blocked by a pending decision {#rn-107}

The three states of [RN-088](../business-rules.md#rn-088) (loading/error/empty) do not describe
`sem_decisao` ([RN-105](#rn-105)): it is not loading (the api already answered), it is not
error (it answered CORRECTLY) and it is not empty (no data is missing — a DECISION is missing,
which is something else). Treating `sem_decisao` as "empty" would show an editor without
files, inviting one to think the repository is empty; treating it as "error"
would make the screen suggest "try again" for something only the Arquiteto resolves.

The tab asks for the container state BEFORE trying to read code
(`GET /projects/:id/container`), instead of waiting for the first tree or
file to return 409 — the same check the api already does in the
`ReadProjectCodeUseCase` funnel (RN-105), only asked first, so the fourth
state is born as its own message and not as the footer of a generic error.
While blocked, the screen re-queries on its own every 15s — once decided,
the image does not change without new human action, and re-querying a stable
state would be the same family of unnecessary traffic as PÓS-FASE 15.

The presentation of the fourth state was EXTRACTED to `ContainerImageGateNotice`
(`apps/web/src/components/ContainerImageGate.tsx`) — a usage finding: the PRs tab
(`apps/web/src/routes/code/PrListAndDiff.tsx`, consumed by
`ProjectPrsTab.tsx` and by `CodeDiffPanel.tsx`) calls `getCodePullRequests`/
`getCodeDiff`, which go through the SAME funnel (RN-105) and can return the SAME
409 — but, unlike this tab, without asking first. It showed that 409
in the generic error banner with "Tentar de novo", the wrong affordance for a
state only the Arquiteto resolves. `isContainerImageGateError`
(`apps/web/src/lib/api-client.ts`) identifies the cause by `status === 409`
— the only cause of `ConflictException` in `ReadProjectCodeUseCase.alvo` — and
`PrListAndDiff` swaps the banner for `ContainerImageGateNotice` when it matches,
without a pre-check of its own (it reacts to the 409 of the query that was going to run anyway).

- **Where:** `apps/web/src/routes/ProjectCodeTab.tsx`,
  `apps/web/src/routes/ProjectCodeTab.module.css`,
  `apps/web/src/components/ContainerImageGate.tsx` (shared
  presentation), `apps/web/src/routes/code/PrListAndDiff.tsx` (consumer
  reactive to the 409), `apps/web/src/lib/api-client.ts`
  (`isContainerImageGateError`)
- **Test:** `apps/web/src/routes/ProjectCodeTab.test.tsx` ("o gate"),
  `apps/web/src/routes/code/CodeDiffPanel.test.tsx`,
  `apps/web/src/routes/ProjectPrsTab.test.tsx` ("o gate do container não é
  erro genérico")
- **Edge case:** the front-end check does NOT replace the api's — it is a UX
  convenience. If the api changes state between the gate query and the actual
  read, the read route still refuses with 409 (RN-105); the front only avoids
  the common case of showing the empty editor for an instant. The PRs tab does no
  pre-check: it discovers the block when the query has already failed, because there
  is no tree/file there for the "empty" instant that the Code tab's
  pre-check avoids.
- **Origin:** [ADR 0065](../adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

### RN-110 — `blame` is the 13th operation of the `GitProviderContract`, with the same absence vocabulary as the other reads {#rn-110}

Foundation of the blame gap declared in FASE 26 (no screen consumes it
yet — it comes in the next wave). `blame(ref, path)` returns `GitBlame | null`,
`null` meaning exactly what it already means in `getFileContent`/
`listTree`: file absent at that ref, or nonexistent ref. Two vocabularies
of "does not exist" for the same tab would make the screen treat the same case in two
ways — the same reason that already held for the two previous operations.

Each provider computes by its OWN means, because there is no common endpoint:
GitHub has no blame in REST (only GraphQL — the only provider operation that
speaks GraphQL), GitLab has `repository/files/:path/blame`, and the local one comes from
`git blame --porcelain`, the only one of the three tested against a real
repository in this session (the other two only against the fake backends of the contract
test — without `GITHUB_TEST_TOKEN`/`GITLAB_TEST_TOKEN` in the environment, what proves
against the real API is the manual smoke). `GIT_BLAME_LINE_LIMIT` (2000) cuts
a genuinely huge file — already cut by bytes on the content route, but
`blame` reads the whole file from the provider before deciding.

- **Where:** `packages/shared/src/index.ts` (`BlameInput`, `GitBlame`,
  `GitBlameLine`, capability `blame`),
  `apps/api/src/infrastructure/git/{github,gitlab,local}-provider.ts`,
  `apps/api/src/domain/git/git-read-limits.ts` (`GIT_BLAME_LINE_LIMIT`),
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (method `blame`), `apps/api/src/interfaces/http/git/code.controller.ts`
  (`GET /projects/:id/code/blame`)
- **Test:** `apps/api/test/contract/git-provider.contract.ts` ("blame" block),
  exercised by the three provider specs — the `local` one against real
  git — and `read-project-code.use-case.spec.ts` ("blame" block)
- **Origin:** FASE 26b (foundation of the declared gaps of FASE 26/
  [ADR 0060](../adr/0060-superficie-de-leitura-de-codigo.md))

### RN-111 — `listPullRequests` is the 14th operation of the `GitProviderContract`; the navigable list opens the same diff by id {#rn-111}

`CodeDiffPanel.tsx` consumes `listPullRequests(state?)` in a clickable list
(id/number/title/author/state/branches, with a filter by state); clicking an
item reuses the SAME diff-by-id flow that already existed — there is no new read
path, only how to REACH the id without knowing it by heart. Whoever already knows the id
(e.g.: came from Approvals) can still paste it directly.

`listPullRequests(state?)` returns a SUMMARY per PR
(`GitPullRequestSummary`: id, number, title, author, state, branches,
`updatedAt`) — not `GitPullRequest`, which is the WRITE type (open/merge) and
never had title or author because neither of the two operations needed them. A
type of its own keeps the write from gaining fields only the read uses.

`local` HAS PRs — the sidecar store of Fase 4a is already the source, and the assumption of the
brief ("PR does not exist in the concept of a pure local repository") did not
hold: the self-contained dev agents have created local PRs since then. The three
capabilities are `true`. `GIT_PR_LIST_LIMIT` (100) is a single page, with no
follow-up pagination — human navigation, not history synchronization.

- **Where:** `packages/shared/src/index.ts` (`ListPullRequestsInput`,
  `GitPullRequestSummary`, `GitPullRequestList`, capability
  `pullRequestsList`), `apps/api/src/infrastructure/git/{github,gitlab,
  local}-provider.ts`, `apps/api/src/domain/git/git-read-limits.ts`
  (`GIT_PR_LIST_LIMIT`), `read-project-code.use-case.ts` (method
  `pullRequests`), `code.controller.ts` (`GET /projects/:id/code/pull-requests`),
  `apps/web/src/routes/code/CodeDiffPanel.tsx` (clickable list, filter by
  state, reuse of the diff-by-id flow)
- **Test:** `git-provider.contract.ts` ("listPullRequests" block),
  `read-project-code.use-case.spec.ts` ("lista de PRs" block),
  `apps/web/src/routes/code/CodeDiffPanel.test.tsx`
- **Origin:** FASE 26b

### RN-112 — `listBranchesDetailed` is an operation of its OWN, separate from `listBranches` {#rn-112}

Foundation of the rich dropdown, now consumed by `CodeBranchPicker.tsx`
(`ahead`/`behind`, PR badge — the wave after FASE 26b closed the
gap that `CodeShell.tsx` declared). The decision was NOT to extend `listBranches` — the
original 13th operation, which the Gitflow bootstrap calls without needing any of
this: enriching costs an extra call to the provider PER BRANCH (two on
GitLab, which has no endpoint returning both sides of a comparison in a
single call, unlike GitHub's `compareCommitsWithBasehead` and `git
rev-list --left-right --count` locally). Attaching that cost to every
branch adoption/creation would turn the bootstrap into an expensive sweep. The
two operations coexist in the contract: `listBranches` for the bootstrap,
`listBranchesDetailed` (the 15th) for the Code tab — `GitBranchDetail` extends
`GitBranch` only in SHAPE, never in the CONTRACT of the caller.

`ahead`/`behind` are always relative to the repository's DEFAULT branch
(`ListBranchesDetailedInput.defaultBranch`, which the caller already knows — asking for it
again from the provider would be one more call just to rediscover what it already
had). `null` in both when the provider cannot compute (orphan branch,
unrelated history) is honest degradation, never an invented number.
`GIT_BRANCH_DETAIL_LIMIT` (30) cuts for the same traffic reasons as item 34
of FASE 26 — without it, a repository with hundreds of branches would become hundreds
of calls per dropdown opening.

- **Where:** `packages/shared/src/index.ts` (`ListBranchesDetailedInput`,
  `GitBranchDetail`, `GitBranchDetailList`, `GitBranchPullRequestRef`,
  capability `branchesDetailed`), `apps/api/src/infrastructure/git/{github,
  gitlab,local}-provider.ts`, `git-read-limits.ts`
  (`GIT_BRANCH_DETAIL_LIMIT`), `read-project-code.use-case.ts` (method
  `branches`), `code.controller.ts` (`GET /projects/:id/code/branches`);
  on the web, `apps/web/src/lib/api-client.ts` (`getCodeBranches`) and
  `apps/web/src/routes/code/CodeBranchPicker.tsx` — the dropdown itself, opened
  from `CodeShell.tsx`
- **Test:** `git-provider.contract.ts` ("listBranchesDetailed" block),
  `read-project-code.use-case.spec.ts` ("branches detalhadas" block),
  `apps/web/src/routes/code/CodeBranchPicker.test.tsx`
- **Edge case:** the `branches()` method lives in the SAME use case as the other six
  reads (`ReadProjectCodeUseCase`), not near the bootstrap — it is a READ
  of the Code tab, with the same credential resolution and the same container
  gate (RN-105) as the others; treating it as a bootstrap operation
  would duplicate both. A ref outside the branch list (tag or sha) remains
  reachable — the dropdown footer has a manual field, because
  `listBranchesDetailed` does not enumerate those two things.
- **Origin:** FASE 26b (foundation); the next wave closed the UI

### RN-113 — Blame in the editor is an ON-DEMAND annotation — a toggle, never embedded in the file read {#rn-113}

The UI that consumes the foundation of [RN-110](#rn-110) comes in here: the Code tab
editor (`CodeEditor.tsx`) only calls `getCodeBlame` when the user turns on the
"Blame" toggle — never together with the file read, which already fires by itself when opening
a tab. The reason is the same as the composite-read budgets (ADR 0060):
blame is a SECOND call to the provider per open file, and a file near
the ceiling (`GIT_BLAME_LINE_LIMIT`, 2000 lines) is already expensive enough not to
pay for it for free on every navigation. `truncated` (which RN-110 already exposes) becomes
a visible warning, in the same pattern as the `fileQuery.data.truncated` warning.

Consecutive lines of the SAME commit show author and short sha only on the FIRST
line of the block — repeating the same text on each line of a block of dozens
of lines would be noise, not annotation; the line only disappears from the text, never from the
annotation (the element's `title` keeps the full date and the commit
summary on any line of the block).

- **Where:** `apps/web/src/routes/code/CodeEditor.tsx`,
  `apps/web/src/routes/code/CodeEditor.module.css`
- **Test:** `apps/web/src/routes/code/CodeEditor.test.tsx`
- **Origin:** UI wave of FASE 26b (blame — rich branch dropdown and
  PR list are UI from two other agents, with no collision risk)

### RN-115 — The Anamnese can be paused globally; the pause belongs to the PRODUCT, it never deletes data {#rn-115}

`ANAMNESE_ENABLED` (engine env var, boolean, default `false` as of
this rule) decides whether a NEW Anamnese round can happen — periodic
(`AnamneseSchedulerWorker`) or on demand (`AnamneseCommandController`).
A PRODUCT decision by the user on 2026-08-10 ("hoje ele não está trazendo
dados de muito valor"), not a bug — see docs/explanation/backlog.md. Disabled,
NO existing data is touched: hypotheses, proficiency profiles and instruction
patches already stored remain intact and visible, and the PER-MEMBER
opt-out (RN-025) remains a separate concept — the pause belongs to the SYSTEM, not to
individual profiling.

`AnamneseSchedulerWorker.kickoff/0` (called once at boot) does NOT schedule the
periodic job when disabled, instead of scheduling it and letting `perform/1`
no-op on every tick — cheaper (the Oban queue does not receive a job every
`ANAMNESE_INTERVAL_SECONDS` just to do nothing) and clearer for whoever
inspects the queue. **Correction on 2026-08-10** (a real finding in execution, not a
hypothesis): the original version of this rule left `perform/1` unconditional
on purpose, so the chain between rounds would not carry the decision to
turn on/off with it — but that meant a chain already scheduled
BEFORE the flag existed (or before someone disabled it) kept
rescheduling itself forever, running the Anamnese for real with the flag saying
`false`. That is exactly what happened on a dev Postgres older than
the original PR, remedied by hand by cancelling the scheduled jobs.
`perform/1` now checks `enabled?/0` on every tick, like `kickoff/0`: if
disabled, neither `enqueue_projects/0` nor the rescheduling happens, and the
chain dies there — which also SELF-HEALS the scenario of an old job
that still fires once, without needing manual intervention.

`AnamneseCommandController.run/2` (on-demand route, "reanalisar agora" in
Settings) answers **503** with body `{"error": "anamnese_desativada"}`
when disabled — deliberately distinct from the empty 409 that already existed for
"project without session" (the two were easy to confuse in a bare 409, and they are
quite different causes). `RunAnamneseUseCase`, on the api side, converts the engine's
503 into `ServiceUnavailableException` with `reason: "anamnese_disabled"` in the
body — never a generic 500 nor a reused 409. The web
(`ProjectSettingsTab.tsx`) discovers the state on the first click of "Rodar
agora" (there is currently no prior read of the global state) and, from then on,
disables the button and keeps the explanation VISIBLE on screen — not just a toast
that disappears (RN-088: never a silent or confusing failure).

- **Where:** `apps/engine/lib/engine/workers/anamnese_scheduler_worker.ex`
  (`enabled?/0`, `kickoff/0`),
  `apps/engine/lib/engine_web/controllers/anamnese_command_controller.ex`,
  `apps/engine/config/runtime.exs`,
  `apps/api/src/domain/anamnese/anamnese-disabled.error.ts`,
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`
  (`runAnamnese`), `apps/api/src/application/use-cases/anamnese/run-anamnese.use-case.ts`,
  `apps/web/src/routes/settings/ProficiencySection.tsx`
- **Test:**
  `apps/engine/test/engine/workers/anamnese_scheduler_worker_test.exs`
  (`kickoff/0` does not schedule when disabled, schedules when enabled, default off;
  `perform/1` disabled in the middle of the chain does no fan-out nor reschedules),
  `apps/engine/test/engine_web/controllers/anamnese_command_controller_test.exs`
  (503 distinct from 409, with and without session),
  `apps/api/test/application/use-cases/anamnese/run-anamnese.use-case.spec.ts`,
  `apps/web/src/routes/ProjectSettingsTab.test.tsx` (`ProficiencySection`)
- **Edge case:** the flag is GLOBAL (all projects/workspaces), not per project
  — unlike the parallelism ceiling (RN-083) or the model inheritable per
  area (RN-102), which are per-scope decisions. Turning it back on is
  `ANAMNESE_ENABLED=true` and restarting the engine; there is no UI button for it
  (it is operational, not a project preference).
- **Origin:** no ADR — a reversible product decision, not a structural
  architecture change. See docs/explanation/backlog.md.

### RN-117 — The Psicólogo can be paused globally; the pause belongs to the PRODUCT, it never deletes data {#rn-117}

`PSYCHOLOGIST_ENABLED` (engine env var, boolean, default `false`) decides
whether a NEW Psicólogo round can happen — automatic (session
closing, routed by `Engine.Outbox.Drain`) or on demand
(`PsychologistCommandController.reanalyze/2`). The same PRODUCT decision by the
user on 2026-08-10 already applied to the Anamnese (RN-115, "hoje ele não está
trazendo dados de muito valor") — not a bug, see docs/explanation/backlog.md.
Disabled, NO existing data is touched: analyses and hypotheses already
emitted remain intact and visible.

Unlike the Anamnese (whose automatic trigger is a periodic TICK that the
flag itself decides whether to reschedule), the Psicólogo's automatic trigger is
session closing — `Engine.Outbox.Drain` routes
`session.closed`/`session.closed_abnormally` to `PsychologistWorker` only
when `PsychologistWorker.enabled?/0` is true (`Drain.handlers_for/1`);
disabled, only `SessionLifecycleWorker` runs, and the Psicólogo job is not even
born. `PsychologistWorker.perform/1` remains unconditional on purpose —
but it is NO longer "the same pattern" as `AnamneseSchedulerWorker` (see the
2026-08-10 correction in RN-115 above): there `perform/1` started checking the flag
because it ITSELF reschedules the chain on every tick, and an old job
firing unconditionally reopened the Anamnese with the flag off. The
Psicólogo has no chain that reschedules itself — each job is born
from ONE event (`session.closed`), and what decides is the `Drain` at the moment it
RECEIVES the event, not the worker at the moment it RUNS; a Psicólogo job
already enqueued before turning the flag off is, at most, the last pending
round, never an infinite chain. That is why the pre-existing suite of
`PsychologistWorker` (which calls `perform/1` directly) did not need to change.

`PsychologistCommandController.reanalyze/2` (on-demand route,
"Reanalisar" in the Insights tab) answers **503** with body
`{"error": "psicologo_desativado"}` when disabled, without even creating the
job. `ReanalyzeSessionUseCase`, on the api side, converts the engine's 503 into
`ServiceUnavailableException` with `reason: "psychologist_disabled"` in the
body — never a generic 500. This discovers the pause when there is already an
analysis to reprocess; the screen with NO hypothesis at all has its own prior
read, which did not exist here — see [RN-454](../business-rules.md#rn-454).

- **Where:** `apps/engine/lib/engine/workers/psychologist_worker.ex`
  (`enabled?/0`), `apps/engine/lib/engine/outbox/drain.ex`
  (`handlers_for/1`),
  `apps/engine/lib/engine_web/controllers/psychologist_command_controller.ex`,
  `apps/engine/config/runtime.exs`,
  `apps/api/src/domain/psychologist/psychologist-disabled.error.ts`,
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`
  (`reanalyzeSession`),
  `apps/api/src/application/use-cases/execution/reanalyze-session.use-case.ts`,
  `apps/web/src/routes/ProjectInsightsTab.tsx`
- **Test:**
  `apps/engine/test/engine/outbox/drain_test.exs` (`session.closed` only
  enqueues the Psicólogo when enabled),
  `apps/engine/test/engine_web/controllers/psychologist_command_controller_test.exs`
  (503 without creating a job, 202 with the job enqueued when enabled),
  `apps/api/test/application/use-cases/execution/reanalyze-session.use-case.spec.ts`,
  `apps/web/src/routes/ProjectInsightsTab.test.tsx`
- **Edge case:** the flag is GLOBAL (all projects/workspaces), like the
  Anamnese's. Turning it back on is `PSYCHOLOGIST_ENABLED=true` and restarting the
  engine; there is no UI button for it.
- **Origin:** no ADR — a reversible product decision, not a structural
  architecture change. See docs/explanation/backlog.md.

### RN-108 — The session socket requires a single-use opaque ticket, not the reused JWT {#rn-108}

`EngineWeb.SessionSocket.connect/3` refused the whole connection with only the
`session_id` (UUID) needing to exist in the Registry — whoever discovered the UUID
entered the `session:<id>` channel and received all the live broadcasts of the
session. Closing this was a deliberate limitation documented in the module itself
since Fase 3.

`POST /projects/:projectId/sessions/:sessionId/socket-ticket` (`scope:
"heartbeat"|"terminal"`) issues an opaque ticket (32 bytes of CSPRNG,
`TokenFactory`), TTL of **30 seconds**, single use. `scope: "heartbeat"` requires
the `viewer` role; `scope: "terminal"` requires `developer` — the same minimum role
as `MIN_ROLE_FOR_ACTION_TYPE.terminal` in `domain/actions/decide.ts` (today
no path really asks for `terminal`; the value is born right for FASE 25,
the interactive terminal). The api persists only the HASH (**plain** SHA-256, not
`hashDeToken`/HMAC — the engine does not have the api's pepper, and a 256-bit
CSPRNG token does not need a pepper against a dictionary, the same reasoning that
`hashDeToken` itself already records), never the raw token.

Consumption belongs to the ENGINE, which reads `session_socket_tickets` directly (same pattern as
`Engine.Outbox.Event` over `outbox_events` — never changeset/insert, only the
narrow write that single use requires) in TWO steps:
`SocketTicket.validar/1` (peek, marking nothing — called by `connect/3`,
which does not yet know which `session_id` will be requested) and
`SocketTicket.consumir/2` (conditional `UPDATE` requiring the topic's `session_id`
to match the row's — called by `SessionChannel.join/3`, which
also checks the ticket's `project_id` against the session's, defense in
depth against a ticket of one project opening a channel of another). Without a ticket,
or with an invalid one: the whole connection is refused (`{:error, %{reason:
"unauthorized"}}`), not only the channel join.

The web (`session-channel.ts`) fetches a NEW ticket before EVERY
`socket.connect()` — including on automatic reconnection, which exists. The
native reconnect of `Phoenix.Socket` would reuse the same `params` from construction
(the old ticket, already expired or consumed), so it is neutralized
(`reconnectAfterMs` that practically never fires) and reconnection becomes
entirely manual, fetching a fresh ticket on each attempt.

That neutralization holds for EVERY client of the socket, and not only for the web's —
including the `/runner` socket, whose ticket (`POST .../runner-ticket`) is of the
same caliber. It failed in TWO of the four `Socket` constructors in the
repository, and the cost was measured in real execution: `apps/runner/src/
channel.ts` built the socket without the option — while the module's docblock
CLAIMED the reconnect was "por isso neutralizado" — and the auto-reconnect
repeated the same already-consumed ticket every **~5.13s** (the ceiling of the
phoenix.js internal backoff), yielding **61 `REFUSED CONNECTION TO
EngineWeb.RunnerSocket`** in a few hours. Added to the runner's OWN policy
(`index.ts`, that one correct), the result was **530 requests in one
minute** against the ceiling of 300 of `RATE_LIMIT_USER` — and since the limit is per
USER, the 429 showed up in the account owner's BROWSER. Two consequences, and
the second is worse than the 429: while it is in that loop the runner is NOT
connected, so `RunnerReadiness` (RN-507) refuses and the project looks like it has "no
local agent". `apps/web/src/lib/fs-browser-channel.ts` had the SAME defect
line (same single-use ticket, and no reconnection policy of its own —
its `onClose` says "close and reopen") and was fixed along with it.

What prevents the third instance is MECHANISM, not a comment: in the runner the
`Socket` options became a type with a MANDATORY `reconnectAfterMs`
(`OpcoesDoSocket` in `channel.ts`), and both sides gained a test asserting
the OPTION PASSED to the constructor — a test that only checks "connects" would pass
with the defect standing, and it did. Along with it, `conectarERodar` (`index.ts`) started to
explicitly DISCARD the dropped connection (`conexao.desconectar()`): without it
the `Socket` of the previous round survived the creation of the next one, and each drop
left one more live object trying with the dead ticket.

- **Where:** `apps/api/src/db/schema/sessions.ts` (`sessionSocketTickets`),
  `apps/api/src/domain/sessions/socket-ticket-scope.ts`,
  `apps/api/src/application/use-cases/sessions/create-socket-ticket.use-case.ts`,
  `apps/api/src/interfaces/http/sessions/sessions.controller.ts` (route
  `socket-ticket`), `apps/engine/lib/engine/sessions/socket_ticket.ex`,
  `apps/engine/lib/engine_web/channels/session_socket.ex`,
  `apps/engine/lib/engine_web/channels/session_channel.ex`,
  `apps/web/src/lib/session-channel.ts`,
  `apps/web/src/lib/fs-browser-channel.ts`,
  `apps/runner/src/channel.ts` (`OpcoesDoSocket`,
  `NUNCA_RECONECTAR_SOZINHO_MS`), `apps/runner/src/index.ts`
  (`conectarERodar`, the discarding of the dropped connection)
- **Test:**
  `apps/api/test/application/use-cases/sessions/create-socket-ticket.use-case.spec.ts`,
  `apps/api/test/domain/sessions/socket-ticket-scope.spec.ts`,
  `apps/api/test/infrastructure/persistence/session-socket-ticket.repository.spec.ts`,
  `apps/engine/test/engine/sessions/socket_ticket_test.exs` (reuse fails,
  wrong session_id fails, concurrent race only one wins),
  `apps/engine/test/engine_web/channels/session_socket_test.exs` (without a ticket
  the connection is refused),
  `apps/engine/test/engine_web/channels/session_channel_test.exs` (ticket from
  another project: join fails), `apps/web/src/lib/session-channel.test.ts`,
  `apps/runner/src/channel.spec.ts` ("neutraliza o auto-reconnect do
  Phoenix.Socket — ticket de uso único nunca é repetido"; asserts the OPTION
  passed to the constructor, and fails without it),
  `apps/web/src/lib/fs-browser-channel.test.ts` (the same, in the folder browser's
  transport via runner)
- **Edge case:** the ticket is NOT the reused JWT — short TTL, single use, closed
  scope, and it is born from a route of its own that already checks the effective role, not from
  decoding the existing access token.
- **Origin:** no ADR — a one-off extraction/hardening, not a structural change.

### RN-109 — The workspace folder name is frozen at creation, and an old project keeps the UUID {#rn-109}

A project's physical folder in `PROJECT_WORKSPACES_ROOT` was the bare UUID —
unreadable when opened on disk. `projects.workspace_dir_name` (NOT NULL, UNIQUE)
started storing the real name: `<slug>-<8 chars do id>` for a
NEW project (`workspaceDirNameFor` in
`apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`), generated
in code — the id is born from `crypto.randomUUID()` in
`CreateProjectUseCase`, not from Postgres's `defaultRandom()`, because the folder
name needs the id BEFORE the insert. The 8 characters follow the same
convention as the session label (`apps/web/src/lib/session-label.ts`).

The name is FROZEN at creation time and never recomputed: `UpdateProjectUseCase`
allows editing the `slug` later, and that does NOT touch `workspace_dir_name` — renaming the
physical folder, with a working tree and agent worktrees possibly open, is
a real risk the decision avoids by construction, not by the caller's
discipline.

A project created BEFORE this migration (0042) kept the physical folder it already
had: the backfill writes `workspace_dir_name = id` for every existing row —
the same value that was already true on disk — and NEVER renames any
directory. A `BEFORE INSERT` trigger (`projects_workspace_dir_name_default_trg`)
applies the SAME fallback (`id::text`) to any insert that arrives without the
field — a safety net for whoever forgets to write it (never the main
path, which always writes it explicitly), and what keeps the dozens of
existing test fixtures, which do not know this concept, working
without needing to rewrite each one.

Path derivation from the name (`projectScopeRoot`, RN-092/RN-075)
started receiving `workspace_dir_name` instead of the raw `projectId` — same
charset validation, same purity. The engine reads the SAME column
(`Engine.Projects.Project.workspace_dir_name/1`) to resolve
`Engine.Actions.Workspace.workspace_dir/1`, never recomputing the name from
the id: the two derivations (api and engine) are, in practice, the same
read against the same database — that is what guarantees RN-075 (terminal
scope) and RN-092 (code reading) keep pointing to the SAME
folder the engine really uses.

- **Where:** `apps/api/src/db/schema/iam.ts` (`projects.workspaceDirName`),
  `apps/api/src/db/migrations/0042_tough_captain_midlands.sql`,
  `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`workspaceDirNameFor`, `projectScopeRoot`),
  `apps/api/src/application/use-cases/iam/create-project.use-case.ts`,
  `apps/engine/lib/engine/projects/project.ex`
  (`workspace_dir_name/1`, `all_workspace_dirs/0`),
  `apps/engine/lib/engine/actions/workspace.ex` (`workspace_dir/1,2`),
  `apps/engine/lib/engine/dev/worktree_cleanup.ex`
- **Test:**
  `apps/api/test/db/workspace-dir-name-migration.spec.ts` (trigger, equivalent
  backfill, uniqueness),
  `apps/api/test/application/use-cases/iam/create-project-semeia-areas.spec.ts`
  (`workspaceDirName` is born `<slug>-<8 chars>`, two projects with the same
  slug in different workspaces do not collide on folder),
  `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
- **Edge case:** the parallelism ceiling and the merge gate do not change — RN-109 is only
  the folder NAME, never policy. Renaming the slug after creation does not
  rename the folder; the folder is only read through the stored `workspace_dir_name`.
- **Origin:** ADR 0066 (revises ADR 0055).

### RN-129 — The ToolLoop never writes an empty `agent.response`; a transport failure becomes a durable `agent.error` {#rn-129}

[RN-059](../business-rules/custo.md#rn-059) closed the empty bubble for the four conversational
agents, but they do not go through `Engine.Harness.ToolLoop` — each one
calls `EngineApiClient.llm_turn_stream/6` in its own module. The `ToolLoop`
(used by dev agents, QA Automação/Performance-Segurança, Infra-Workflows,
Anamnese and Psicólogo) had the SAME defect on a different path: it emitted
`agent.response` on every iteration, even when the model only called a tool
without text, or ended the turn without producing anything — and the transport failure
(provider down, timeout) became an `agent.response` with absent `content`,
equally indistinguishable from success.

Found live in a real execution session (dev agents): two bubbles with the
RN-059 compatibility text ("resposta vazia — evento anterior...")
appeared in a session created minutes earlier — they were not old events, they were
the same defect happening again, only in the execution tab.

Two fixes, at the STRUCTURAL point common to every `ToolLoop` consumer,
not module by module:

1. **Empty content never becomes `agent.response`.** An iteration that only called a
   tool is already narrated by `tool.call`/`tool.result`; an iteration that
   produced nothing (neither text nor tool call) leaves the outcome for the loop's caller
   to decide — `ctx.last_error`/`{:ok, ctx}` carry the information, and
   the consumer (e.g.: `DevAgentServer.handle_outcome/4`) already writes the durable event
   of its OWN domain (`dev.blocked`, with `origem`).
2. **A transport failure becomes a durable `agent.error`**, with `origem`
   (`Engine.Agents.FalhaDeTurno.origem/1` — the SAME helper the four
   conversational agents use, without duplicating classification) and `mensagem` in
   Portuguese — never again an `agent.response` without `content`.

- **Where:** `apps/engine/lib/engine/harness/tool_loop.ex` (`loop/1`,
  `emit_falha/2`)
- **Test:** `apps/engine/test/engine/harness/tool_loop_test.exs`
  ("iteração só com tool call (sem texto) não grava agent.response vazio",
  "modelo termina o turno sem texto e sem tool call...", "falha de
  transporte... grava agent.error durável com origem")
- **Origin:** RN-059 (the rule this one extends) — found live in a real
  execution session with dev agents

### RN-139 — The Executors tab reads the CURRENT execution session, never the project's most recent one {#rn-139}

`ProjectExecutorsTab` fetched the dev agent/QA events by the session that
`useLatestSession` returned — the project's one with the most recent `createdAt`, without
filtering by `kind` nor requiring `execution.activated`. It worked only by
**coincidence**: the execution session tends to be the newest. As soon as
any session is born after it — a new ideation, a consultative chat — the
tab starts looking at that new session, empty of execution events,
silently: no hint on screen said which session was being displayed.

The correct read already existed in the backend: `findActiveExecutionSession`
(`SessionRepository`) — the most recent `active` session that carries
`execution.activated` — but it was only used internally by
`ActivateExecutionUseCase` to decide whether to reactivate or create. The fix exposes
the SAME criterion over HTTP, instead of duplicating it in the front:

- **`GET /projects/:projectId/execution/session`** (`role:viewer`) returns the
  current session or `null` — it never infers from the most recent;
- `ProjectExecutorsTab` swaps `useLatestSession` for `useActiveExecutionSession`
  (a new hook over the route above) as the source of the session the whole tab reads;
- the tab header always shows WHICH session is being displayed — its
  label (hashtag + name) linking to `SessionPage`, or "Nenhuma execução
  ativa" when `null` — never implicit again. The three states of
  [RN-088](../business-rules.md#rn-088) apply to the session fetch itself: loading, error
  (with `trace_id`) and empty (`null`) are three distinct renders, never an
  `if (!sessão) return null` that collapses them.

- **Where:**
  `apps/api/src/application/use-cases/execution/get-active-execution-session.use-case.ts`,
  `apps/api/src/interfaces/http/execution/execution.controller.ts` (`getSession`),
  `apps/web/src/lib/hooks.ts` (`useActiveExecutionSession`),
  `apps/web/src/routes/ProjectExecutorsTab.tsx`
- **Test:**
  `apps/web/src/routes/ProjectExecutorsTab.test.tsx` — shows the execution
  session even with a more recent session existing in the project, an explicit
  "nenhuma execução ativa" state, and a network error handled (not blank)
- **Origin:** finding from code investigation + live test — the same
  class of defect RN-088 closed for 429, now for "which session the
  screen is looking at"

### RN-141 — The content read by `read_file` also has a byte ceiling {#rn-141}

[RN-074](../business-rules/custo.md#rn-074) locked the **terminal** output against
`{413, "request entity too large"}`, but left the same door open through
`read_file`: it read the WHOLE file, with no ceiling, and that content entered the
loop history and traveled in every following turn. A PR with a large file
(lockfile, bundle, generated file) was enough to lock up dev agents AND the
Performance/Security QA — which only has `ReadFile`/`SearchWorkspace` (no
`Terminal`, on purpose) to investigate a PR, so it had no escape
route at all when the file was too large.

The content is cut at `READ_FILE_MAX_BYTES` (default 32 KiB, the same value as
RN-074 by coincidence of context, not by coupling — the two variables
are independent) before becoming the tool result, with a marker stating
the file and the two sizes:

```
[arquivo package-lock.json truncado: mostrando 32768 de 1048576 bytes. Use
search_workspace para localizar um trecho específico em vez de reler o
arquivo inteiro.]
```

The same three properties as RN-074 (the ceiling is `>` not `>=`; the cut does not split
a multibyte character; the marker is addressed to the model, saying what to do). The
truncation lives in the TOOL (`Engine.Harness.Tools.ReadFile`), not in
`Engine.Harness.WorkspaceFiles.read_file/2` — that is the generic file access
base, shared by `write_file`/`search_workspace`, and
truncating there would cut content of those who do not need that ceiling.

`search_workspace` did not get the same treatment: it returns only the PATHS that
matched (`matched_content` is a boolean), never the file content — the
overflow vector that motivated this RN does not apply to it.

- **Where:** `apps/engine/lib/engine/harness/tools/read_file.ex`
  (`truncate/2`), ceiling in `apps/engine/config/runtime.exs`
  (`read_file_max_bytes`)
- **Test:** `apps/engine/test/engine/harness/tools/read_file_test.exs`
  (describe `teto de bytes do conteúdo`)
- **Origin:** found live in the event log of a real execution — the 4 dev
  agents of a project and the Automação/Performance-Segurança QAs blocked
  with `{413, "request entity too large"}`, the same root cause as RN-074, a different
  door

### RN-144 — The Criativo tab does not list the current execution session {#rn-144}

The session that receives `execution.activated` and the dev agents' tool-call events
must be born with `kind: 'criativa'` — a structural rule (RN-097,
`garantirQuePodeAtivarExecucao`), without which the event is refused. Since
`ProjectSessionsTab` (the Criativo tab, RN-104) lists sessions filtering only by
`session.kind === 'criativa'`, the execution session appeared MIXED in the
list next to real ideations — opening it in `SessionPage.tsx` shows
a whole timeline of dev agent tool-calls, looking (to the user) like "the
dev writing in the Criativo's chat". Confirmed live: a real session with
35+ dev agent events appeared normally in the list, next to real
ideation sessions.

The fix reuses the signal that [RN-139](#rn-139) already exposes —
`useActiveExecutionSession`/`GET /projects/:projectId/execution/session` — instead
of the backend computing a new field per session (`hasExecutionActivated`
or equivalent). The Criativo tab fetches the current session and excludes it from the rendered
list:

- the fetch only runs on the Criativo tab (`enabled` off when `kind !==
  'criativa'`) — the Chat tab never made that call and still does not;
- the filter is by `id`, after the existing filter by `kind` — it does not change
  what the list IS, only what it EXCLUDES.

**Deliberate scope decision:** this covers only the CURRENT execution, not
OLD executions already closed (`execution.activated` written in a session
that is now `closed`). Computing that would require the backend to annotate, per session,
whether it has the event written — a change in the repository and in the listing
endpoint, for a residual case: an OLD execution session appears with the
`closed` badge, which already signals "this is not an active ideation" in a much
less ambiguous way than the current one (which appeared `active`, indistinguishable from an
ideation in progress). If this becomes confusing again in practice, the way out is the
listing endpoint returning the signal per session — not one more `filter` in the
front per old session.

- **Where:** `apps/web/src/routes/ProjectSessionsTab.tsx`
  (`ProjectSessionsTab`)
- **Test:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — the current one
  disappears from the Criativo list with normal sessions next to it, the Chat tab does not call the
  current-execution fetch, and without a current execution (`null`) the list appears
  whole
- **Origin:** finding from code investigation + live test — a real session
  with active execution appearing mixed in the Criativo tab

### RN-145 — The Arquiteto also has a readiness button, and the SAME confirmation offers Infra and Dev Lead {#rn-145}

`OfferInfraHandoffUseCase` (`POST .../agents/arquiteto/handoff-infra`) already
existed since Fase 4a — it writes `architecture.readiness_confirmed` and calls the
engine, which offers the handoff to Infra and, in the SAME confirmation, to the Dev Lead
(FASE 14d/ADR 0053). What was missing was the way to reach it: no
place in the frontend called the endpoint. The "Confirmar arquitetura pronta" button
exists for the Criativo since always ("Estou pronto para produzir",
[RN-131](../business-rules.md#rn-131)/[RN-142](../business-rules.md#rn-142)) — the Arquiteto had no
equivalent at all, and without the click the handoff was never born: the priority fix of the
card in the thread ([RN-125](../business-rules.md#rn-125)) had no practical effect, because there was nothing
to show.

`arquitetoActive` mirrors `criativoActive` (there is an `agent.activated` for the
Arquiteto in this session) and `arquiteturaJaDeclarada` mirrors
`prontidaoJaDeclarada` (there is ANY handoff leaving the Arquiteto — the proof
that the confirmation already happened, since `OfferInfraHandoffUseCase` creates
at least the Infra one in the same call). The button appears in the composer only
when the first is true and the second is not — it disappears after the click
for the same reason the Criativo's disappears after readiness.

Unlike the Criativo, the Arquiteto has NO server guardrail
blocking the confirmation without a `module_map` — `ArquitetoServer.offer_infra_handoff`
refuses nothing, unlike `CriativoServer.confirm_readiness`
([RN-142](../business-rules.md#rn-142)). The button is only disabled during `streaming`; not replicating
here the Overview's `disabled={!hasModuleMap}` is a deliberate decision, by the
same reasoning that already holds for "Ativar execução" on the Dev Lead card
([RN-137](../business-rules.md#rn-137)) — when this card exists, the Arquiteto has already decided the
architecture.

- **Where:** `apps/api/src/interfaces/http/agents/agents.controller.ts`
  (`handoffInfra`, pre-existing route), `apps/web/src/lib/api-client.ts`
  (`confirmArchitectureReadiness`), `apps/web/src/routes/SessionPage.tsx`
  (`arquitetoActive`, `arquiteturaJaDeclarada`, `handleArchitectureReadiness`,
  "Confirmar arquitetura pronta" button)
- **Test:**
  `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`, describe
  "problema 1" — button absent without the Arquiteto active, the happy path calls the
  dedicated endpoint, failure shows an error toast, and the button disappears with the
  architecture already declared
- **Origin:** code investigation — the endpoint and the engine logic
  existed since Fase 4a/14d with NO UI path to them

### RN-146 — `agent.response` carries the name of the model that generated the response {#rn-146}

The model name only existed in `token_usage`, with no link to the specific
`agent.response` event it produced — `SessionPage.tsx` showed the
FIXED string `"modelo"` next to the agent's name, never the real name.

The change crosses the three layers, all with the SAME field name
(`modelName`), so no translation between them is needed:

1. **api** — `StreamLlmTurnUseCase`/`RunLlmTurnUseCase` already resolved the
   model (`resolveModelBinding` → `models.findById`) to call the
   provider; the `final` frame/`RunLlmTurnResult` gain `modelName: string |
   null`. `null` only when the turn failed BEFORE resolving a model (no
   binding, or binding to a nonexistent model) — in the other cases,
   including budget exceeded, the binding had already resolved and the name
   travels even in the error frame.
2. **engine** — the four conversational agents (`criativo_server.ex`,
   `po_server.ex`, `arquiteto_server.ex`, `dev_lead_server.ex`) extract
   `Map.get(frame, "modelName")` from the `final` frame and include it in the payload of
   `emit_response`/`agent.response` (`%{content: content, modelName:
   model_name}`).
3. **web** — `SessionPage.tsx` reads `event.payload.modelName`. An event
   WRITTEN before this change does not have the key (`undefined`), and a turn
   whose api resolved no model writes `null` — both degrade to
   the generic label `"modelo"`, never to `undefined`/`null` on screen; the
   same pattern that `text === ''` already uses for a response prior to RN-059.

- **Where:** `apps/api/src/application/use-cases/llm/stream-llm-turn.use-case.ts`
  (`LlmTurnStreamEvent`), `apps/api/src/application/use-cases/llm/run-llm-turn.use-case.ts`
  (`RunLlmTurnResult`), `apps/api/src/interfaces/http/internal/dto/internal.response.dto.ts`
  (`LlmTurnResponseDto`/`LlmTurnStreamEventResponseDto`),
  `apps/engine/lib/engine/agents/{criativo,po,arquiteto,dev_lead}_server.ex`
  (`emit_response/3`), `apps/web/src/routes/SessionPage.tsx` (the timeline's
  `agent.response` block)
- **Test:** `apps/api/test/application/use-cases/llm/run-llm-turn.use-case.spec.ts`,
  `apps/api/test/application/use-cases/llm/stream-llm-turn.use-case.spec.ts`
  (`modelName` on the happy path, on the provider error and without binding),
  `apps/engine/test/engine/agents/{criativo,po,arquiteto,dev_lead}_server_test.exs`
  (`agent.response` carries the model name; edge case of the frame without the key),
  `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`, describe
  "problema 2" — real name, old event without the key, `modelName: null`
- **Origin:** code investigation — confirmed that the data already existed in
  `token_usage`, but never reached the event payload

### RN-147 — The collapsed group header shows the agent's icon, not just the name {#rn-147}

The `Disclosure` of `timelineAgrupada` ([RN-138](../business-rules.md#rn-138)) received only the STRING
of the name in `titulo` — each expanded message already has an avatar (`.avatar` +
icon), and the collapsed header lost that visual cue precisely where it
helps most to scan the thread.

`AvatarDoAgente` reuses the SAME `.avatar` box as the expanded messages, but
the chosen icon is the ROSTER's (`AGENTS[id].icon`) — the same source that already
identifies "who is talking" in the streaming indicator (`agenteExibido.icon`,
[RN-131](../business-rules.md#rn-131)) — and not the per-event-TYPE icon each expanded
entry uses (`ModelIcon` in `agent.response`, `StackIcon` in
`backlog.*_created`, `AlertCircleIcon` in `agent.error`). A collapsed group
can mix those entry types from the same agent; the header
represents the AGENT, not its last entry, and only the roster icon is
stable for that. Without `id`, or an agent outside the roster, it degrades to
`ModelIcon` — never to an empty box.

- **Where:** `apps/web/src/routes/SessionPage.tsx` (`AvatarDoAgente`,
  `timelineAgrupada`), `apps/web/src/routes/SessionPage.module.css`
  (`.agentGroupTitulo`)
- **Test:** `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`,
  describe "problema 3" — the collapsed header has the PATH of the PO's icon
  (`UserIcon`), not just a generic decorative SVG
- **Origin:** code investigation — `Disclosure` already accepted `ReactNode`
  in `titulo`; passing the avatar together with the name was what was missing

### RN-148 — Stories with promotion pending at the same time become a carousel, not N cards {#rn-148}

The PO creates stories one by one, and each `backlog.story_promotion_proposed`
([RN-126](../business-rules.md#rn-126)) became a standalone card in the timeline — in a batch of several
stories, that stacked N identical cards competing for the same space,
mixed with the rest of the narration.

A **batch** is the set of promotion proposals STILL PENDING in the
session, evaluated on each render — not "created in sequence without
interruption". The criterion is the SAME one each standalone card already used on its own
to decide whether it became an actionable card or a divider (no later
`backlog.story_transitioned`/`backlog.story_promotion_returned`
with the same `storyId`), only looked at at once for the whole session:

- **0 or 1 pending:** nothing changes — the usual standalone card (the degradation is
  deliberate: a one-slide carousel gains nothing by becoming a carousel).
- **2+ pending at the same time:** they become ONE `Carousel` (new in the design
  system, `apps/web/src/components/ui/Carousel.tsx`), inserted at the position
  of the FIRST proposal still pending; the others disappear as individual
  cards — each one becomes a SLIDE of it. Each slide shows the same
  sentence as the standalone card ("história … pronta, aguardando sua promoção"), a
  summary/RF if the payload carries one (today it does not — see below), and the
  Promover/Devolver buttons of that specific story, calling the SAME
  `promoteStories`/`returnStory` as always.
- **"Aprovar todas"** in the carousel header calls `promoteStories` with
  the ids of ALL pending ones in a single call — the endpoint was already a batch
  (`promoteStories(projectId, storyIds[])`, RN-048), so there was no contract
  change at all, only in who builds the list.
- A story resolved (promoted or returned) while the carousel is
  open leaves the batch on the next render (the events query is invalidated in
  both actions) — if only 1 pending is left, the carousel dissolves on its own and the
  card becomes standalone again.

`resumo`/RF in the slide is a READY field, not used: `CreateStoryUseCase` today only
writes `storyId`/`epicId`/`title` in the payload of `backlog.story_promotion_proposed`
— no description nor functional requirements. The slide already knows how to display
`description`/`rf` if the payload ever carries them (it degrades to the title alone
until then); extending the payload was left out of this delivery, since it was not
asked for.

- **Where:** `apps/web/src/components/ui/Carousel.tsx` (new component,
  generic navigation), `apps/web/src/routes/SessionPage.tsx`
  (`promocoesPendentes`, `ehLevaDeHistorias`, `StorySlide`,
  `handlePromoteAll`), `apps/web/src/routes/SessionPage.module.css`
  (`.storySlide`)
- **Test:** `apps/web/src/components/ui/Carousel.test.tsx` (navigation,
  ARIA, only the current slide mounted, index clamped when the list shrinks),
  `apps/web/src/routes/SessionPage.carrossel-historias.test.tsx` (3+
  pending become a carousel; "Aprovar todas" sends the whole batch; single promotion
  and return keep working from a navigated
  slide; 1 pending degrades to the simple card; a resolved story leaves the
  batch and the carousel recomputes the count)
- **Origin:** user request — stories produced in batch by the PO
  were hard to decide one by one in the thread

### RN-149 — The Container level of the C4 diagram is derived from the module_map, never retyped by the model {#rn-149}

`create_c4_diagram` (a new Arquiteto tool) generates the two Mermaid
syntaxes of the C4 diagram (Context + Container, Simon Brown's model). The tool
call carries only `system_name`/`system_description`/`actors` — the modules and
the Container-level dependencies are NOT part of the input: the use case
fetches the project's CURRENT `module_map` (`ModuleMapRepository.findCurrent`,
the same read as `GetArchitectureUseCase`) and derives the Container level from it,
with the SAME names and dependencies that `create_module_map` already validated without
cycles.

The obvious alternative — letting the model describe the modules again in the diagram's tool
call, as it already does for `create_module_map` — was discarded
on purpose: a second place where the model writes "the modules are X, Y,
Z" is a second place where that list can diverge from the first, and the
divergence would be SILENT — nothing would refuse a diagram with a module that
no longer exists in the real map. Deriving from the repository closes that divergence
by construction: the diagram can become OUTDATED if the `module_map` changes
later (re-emitting is generating again, without a lock — see ADR 0068), but it never
LIES about what existed at the moment it was generated.

Without a current `module_map`, `create_c4_diagram` is refused with 400 — there is no
Container level without modules to draw, and the error message instructs the
Arquiteto to call `create_module_map` first (RN-061: the refusal comes back
through the tool-result, with the whole reason).

The `artifact.c4_diagram` artifact is versioned in the event log without a table
of its own — the same design as `artifact.project_image` (ADR 0065): the current one is
the one with the highest `version`, and revising is generating again, never overwriting.

- **Where:** `apps/api/src/domain/architecture/c4-diagram.ts`
  (`gerarDiagramaContexto`/`gerarDiagramaContainer`, pure),
  `apps/api/src/application/use-cases/architecture/create-c4-diagram.use-case.ts`,
  `apps/api/src/application/use-cases/architecture/get-c4-diagram.use-case.ts`,
  `apps/engine/lib/engine/harness/tools/create_c4_diagram.ex`,
  `apps/web/src/components/C4DiagramView.tsx` (rendering, three states —
  RN-088), `apps/web/src/lib/mermaid-render.ts` (`mermaid` stays isolated
  here, dynamic `import()`)
- **Test:** `apps/api/test/domain/architecture/c4-diagram.spec.ts` (valid Mermaid
  syntax from a sample `module_map`, dangling edge
  ignored, deduplicated ids),
  `apps/api/test/application/use-cases/architecture/create-c4-diagram.use-case.spec.ts`
  (without module_map it refuses with 400 and writes nothing; Container reflects the real
  modules/dependencies; versions on re-emitting),
  `apps/engine/test/engine/harness/tools/create_c4_diagram_test.exs`,
  `apps/web/src/components/C4DiagramView.test.tsx` (success becomes SVG, a syntax
  error becomes a readable Alert without breaking the screen, an empty diagram does not try
  to render)
- **Origin:** user request — the Arquiteto's C4 diagram in the project
  Overview (ADR 0068)

### RN-150 — `search_workspace` has a ceiling on hit COUNT and on BYTES, each with its own marker {#rn-150}

Found in a PR review: `search_workspace` (dev agents and the two
QA/gate agents, `qa_tools.ex` and `qa_performance_seguranca_agent.ex` — the latter
only has `read_file`/`search_workspace`, without `Terminal`, on purpose)
returned ALL search results, with no ceiling at all — the same class as
finding S (`Engine.Actions.TerminalExecutor.truncate/2`) and as the
`read_file` fix (`Engine.Harness.Tools.ReadFile.truncate/2`): the result stays
in the loop history and travels in every following turn, and a large tree
is enough to blow the provider's `{413, "request entity too large"}`.

Two independent ceilings, because the search overflows in two different ways:

1. **Hit count** — a tree with thousands of files matching the
   term produces thousands of `- caminho` lines even if no individual
   file is large. Truncating only by BYTES at the end would still pay the cost
   of scanning and reading the content of each of those files before building the
   string. That is why the count ceiling (`SEARCH_WORKSPACE_MAX_HITS`,
   default 500) lives in `WorkspaceFiles.search/3`, which already STOPS consuming the
   search as soon as it finds enough hits — the pipeline runs over a
   `Stream`, and `Enum.take(stream, max_hits + 1)` only reads from the source what it
   needs to produce the first `max_hits + 1` results. The "+1" is what
   allows saying there WERE more without continuing to scan the rest to
   count the exact total — counting the total would pay again the I/O the ceiling
   exists to avoid, so the marker says "showing the first N" and never
   invents a total.
2. **Bytes of the final text** — even with limited hits, very
   long paths can produce a large string. Byte ceiling
   (`SEARCH_WORKSPACE_MAX_BYTES`, default 32,768), same pattern as
   `terminal_output_max_bytes`/`read_file_max_bytes` — its OWN variable,
   it does not reuse the other two: same class of overflow, diverging one should not
   require touching the others.

The truncation marker is addressed to the MODEL, not to the human: it says what was
cut (hits and/or bytes) and instructs to refine the search term — the same
spirit as the `TerminalExecutor`/`ReadFile` markers.

- **Where:** `apps/engine/lib/engine/harness/workspace_files.ex`
  (`search/3`, `take_capped/2`),
  `apps/engine/lib/engine/harness/tools/search_workspace.ex`
  (`truncate/3`, `marca_de_truncagem/5`),
  `apps/engine/config/runtime.exs` (`search_workspace_max_hits`,
  `search_workspace_max_bytes`)
- **Test:** `apps/engine/test/engine/harness/workspace_files_test.exs`
  (`search/3` with `max_hits` cuts the COUNT and marks truncation only
  when there are more than the ceiling),
  `apps/engine/test/engine/harness/search_workspace_test.exs` (a search with
  few results is not altered; a search with more hits than the ceiling is
  truncated with a clear warning; a final text larger than the byte ceiling is also
  cut)
- **Origin:** PR review finding — the second real cause of the 413 in
  reviews, after the `read_file` fix

---

### RN-151 — The project badge in the sidebar is pending approvals, not unread activity {#rn-151}

The number next to each project's name in `Shell.tsx` came from
`useProjectsUnread` — `latestSeq` (the most recent `seq` already written in the session)
minus the "last seen" cursor the browser keeps in
`read-state.ts`. That counts ANY new event — `tool.call`,
`agent.response`, chat — not only a pending decision. A test project
showed "392" in the sidebar (accumulated activity from a real execution) while
the Approvals tab of the SAME project showed "8" (the real count). A
number that does not correspond to anything actionable when clicked is worse than none.

The dashboard read model (`ProjectsSummaryRepository.summarizeForWorkspace`,
RN-090) gained `pendingApprovalsCount`: `COUNT(*)` of `proposed_actions` with
`status = 'pending'`, aggregated by `project_id` in one more query in the
existing `Promise.all` — same format as `storiesAwaitingPromotion`
(RN-048), without growing the number of database round trips per project. The sum is over the
WHOLE project, all sessions — deliberately different from the Approvals tab
(`ProjectApprovalsTab.tsx`), which shows only the pending items of the MOST
RECENT session: the badge is per PROJECT, not per session, and a pending item in an
old session is still a pending item.

`Shell.tsx` stopped importing `useProjectsUnread` — its only consumer
there was this badge. `Dashboard.tsx`/`ProjectCard.tsx` gained the same wiring:
the `unreadCount` prop of `ProjectCard` never had a caller (`ProjectCardContainer`
did not pass it), and became `pendingApprovalsCount` with the same value as the sidebar
— two screens, one number, one source.

- **Where:** `apps/api/src/application/ports/projects-summary-repository.port.ts`
  (`ProjectCardSummary.pendingApprovalsCount`),
  `apps/api/src/infrastructure/persistence/drizzle/projects-summary.repository.ts`
  (`summarizeForWorkspace`, aggregate query over `proposed_actions`),
  `apps/web/src/routes/Shell.tsx`, `apps/web/src/routes/Dashboard.tsx`,
  `apps/web/src/components/ProjectCard.tsx`
- **Test:**
  `apps/api/test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  (`pendingApprovalsCount soma o projeto INTEIRO...`, only `pending` counts, does not
  leak between projects, the number of queries stays constant),
  `apps/web/src/routes/Shell.test.tsx` (pending approvals badge)
- **Origin:** user finding while navigating the app — sidebar badge showing
  "392" against a real "8" in the Approvals tab of the same project

---

### RN-152 — A task's branch says which dev agent and module it belongs to, in the Code tab dropdown {#rn-152}

`CodeBranchPicker` already listed every branch of the repository, including those of the
dev agents (`feature/task-XXXXXXXX`, `Engine.Dev.AgentIo`), but with no hint
at all of who created it — only the raw name. `ReadProjectCodeUseCase.branches`
solves this without an extra call to the git provider: the 8 chars after
`feature/task-` are exactly the first hyphenated group of the task's uuid
(`"feature/task-" <> String.slice(to_string(row.task_id), 0, 8)`, not an
arbitrary substring), so they match against `TaskRepository
.findByProjectAndIdPrefix` (join by PROJECT, so an 8-char prefix never
leaks a task from another project). The task's `assignedTo` is the agent_id
(`dev-<modulo>`/`dev-<modulo>-2`, RN-087); the module is resolved by comparing
against the project's CURRENT `module_map` with the SAME functions that generated them
(`devAgentId`/`extraDevAgentId` in `activate-execution.use-case.ts`) — never
by reverse regex, which would degenerate into ambiguity for a module name with
a special character.

`producedBy: { agentId, moduleId } | null` is honest degradation, the same
way `ahead`/`behind` already are: `null` for a branch without the pattern (the user's manual
one, or `main`/`dev`/`qa`), and also when the pattern matches but the
task/module are no longer resolvable (task deleted, module removed from the current
map) — never an invented value. In the dropdown, each branch produced by
a dev gets the agent's icon and color (`AGENTS`/`agents.ts`, RN-087),
reusing the SAME degradation that `apps/web/src/lib/agent-status.ts` already
uses for the live roster: a module without a fixed key in `AGENTS` inherits the icon/color of
`dev-backend`.

- **Where:** `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (`branches`/`producedBy`/`moduloDoAgente`),
  `apps/api/src/application/ports/backlog-repository.port.ts`
  (`TaskRepository.findByProjectAndIdPrefix`),
  `apps/api/src/infrastructure/persistence/drizzle/backlog.repository.ts`,
  `apps/api/src/interfaces/http/git/dto/code.response.dto.ts`
  (`CodeBranchProducedByResponseDto`), `apps/web/src/lib/api-types.ts`
  (`CodeBranchProducedBy`), `apps/web/src/routes/code/CodeBranchPicker.tsx`
  (`IconeDoAgenteProdutor`/`defDoAgenteProdutor`)
- **Test:**
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (describe "producedBy da branch de task" — task resolved with module and with
  the extra agent `-2`, a branch outside the pattern never gets `producedBy` even
  with a task of matchable prefix, prefix without a task in the project, module removed
  from the current map and task without an owner yet degrade to `null`),
  `apps/web/src/routes/code/CodeBranchPicker.test.tsx` (a task branch shows
  the owning dev agent's badge; a branch without the pattern gets no badge at all)
- **Origin:** user request — no visual hint of who created the
  branch in the rich dropdown of FASE 26b

### RN-153 — "Auto mode": the `ApprovalCard` turns on autonomy for ANY future action of an agent {#rn-153}

> **Revised by [RN-603](#rn-603)** (ADR 0167): `decide()` started receiving
> also the ORIGIN of the autonomy, and auto mode (the wildcard in
> `auto_approve`) no longer goes through the path scope ceiling. What follows
> below about `decide()` "not changing" describes the original design.

Before this RN, `agent_autonomy` only knew how to grant autonomy per
`(projeto, agente, TIPO de ação)` — one row per type, upsert of ONE rule
at a time (`SetAgentAutonomyUseCase`,
`apps/api/src/application/use-cases/actions/set-agent-autonomy.use-case.ts`).
Trusting an agent broadly required one row per type — `terminal`,
`write_file`, `pr_open`… — and a new type was born without a rule, back to
`require_approval`.

"Auto mode" is the special value `actionType: "*"` in the SAME table and the SAME
endpoint (`PUT /projects/:projectId/agent-autonomy`) — it is not a new mechanism,
it is the existing column (`agent_autonomy.action_type`, free `text`, no enum
nor FK — `apps/api/src/db/schema/agents.ts`) accepting one more value. The wildcard
means "autonomy for any action type of THIS agent" and is resolved
in `DrizzleAgentAutonomyRepository.findMode`
(`apps/api/src/infrastructure/persistence/drizzle/agent-autonomy.repository.ts`):
it fetches the SPECIFIC rule and the wildcard in the same query, and the specific one
always wins — writing `terminal: deny` with `"*": auto_approve` already on
keeps denying `terminal` for that agent, and releasing the rest. `decide()`
(`apps/api/src/domain/actions/decide.ts`) does not change: it receives the
`PermissionPolicy` already resolved in `ctx.autonomyMode`, exactly as before
the wildcard existed — that is why the absolute ceilings hold without needing to
know that "auto mode" exists (see [RN-154](#rn-154)).

The `ApprovalCard` (`apps/web/src/components/ApprovalCard.tsx`) gains the
"Modo automático" button next to "Sempre permitir", visible only when: (a) the
action is `pending`, (b) whoever proposed it is an AGENT (`actor.kind === 'agent'` —
there is no agent autonomy to grant to a user) and (c) the caller
(`ProjectApprovalsTab.tsx`/`SessionPage.tsx`) has already confirmed the
`maintainer`/`owner` role in the workspace — the same requirement as the endpoint
(`@RequireRole('maintainer')`, unchanged). The `onActivateAutoMode` prop is
`undefined` for whoever lacks the role — the card HIDES the button instead of
showing it disabled, and the check lives in the caller, not in the card
(a presentational component, with no query of its own).

**Turning it off** reuses the manual/auto toggle the agent card already had (Fase
8d) — no new screen. `AgentTeamGrid.tsx` starts looking for the agent's wildcard
rule BEFORE the representative one (`autonomyActionTypeFor`): if it
exists, the card's toggle reflects and edits the WILDCARD, no longer the
representative type — turning off is writing the same wildcard as
`require_approval`, and the toggle on the agent card is exactly that
"turn off".

- **Where:** `apps/api/src/domain/actions/decide.ts`
  (`AGENT_AUTONOMY_ALL_ACTIONS`, `AgentAutonomyActionType`),
  `apps/api/src/infrastructure/persistence/drizzle/agent-autonomy.repository.ts`
  (`findMode` with precedence specific > wildcard),
  `apps/api/src/interfaces/http/actions/dto/set-agent-autonomy.dto.ts`
  (accepts `"*"`), `apps/web/src/components/ApprovalCard.tsx` ("Modo
  automático" button), `apps/web/src/components/AgentTeamGrid.tsx` (the toggle
  starts prioritizing the wildcard), `apps/web/src/routes/ProjectApprovalsTab.tsx`
  and `apps/web/src/routes/SessionPage.tsx` (`handleActivateAutoMode`, role
  gate via `useCurrentWorkspaceWithRole`)
- **Test:**
  `apps/api/test/infrastructure/persistence/drizzle/agent-autonomy.repository.spec.ts`
  (precedence specific > wildcard; the wildcard is per agent; turning off is
  rewriting the wildcard as `require_approval`),
  `apps/api/test/application/use-cases/actions/propose-action.use-case.spec.ts`
  (auto mode auto-approves a common action WITHOUT hitting `permissions.json`; a specific
  rule in `deny` beats the wildcard),
  `apps/api/test/interfaces/http/actions/agent-autonomy.controller.spec.ts`
  (`PUT`/`GET` still require `maintainer`; the DTO accepts `"*"` and refuses a
  string outside the list), `apps/web/src/components/ApprovalCard.test.tsx`
  (button disappears without `onActivateAutoMode`; click calls the callback; the note
  explains the ceilings that keep asking for a decision)
- **Origin:** user request — "Sempre permitir" only writes a specific command
  pattern, and `agent_autonomy` only covered one action type at a time;
  what was missing was trusting an agent broadly with a single click

### RN-154 — The three absolute ceilings keep blocking EVEN with "auto mode" on {#rn-154}

> **Revised by [RN-603](#rn-603)** (ADR 0167): the ceilings listed here
> remain in force in auto mode; what stopped holding for it was the
> PATH SCOPE ceiling (ADR 0055), which was never on this list.

The design of "auto mode" ([RN-153](#rn-153)) is deliberately incapable of
piercing the three ceilings that already existed in `decide()` — they are applied
LAST, over `current.policy`, without looking at where the permissiveness came from
(`agent_autonomy` with a specific type, wildcard, or `permissions.json` — the
function never knew how to distinguish the origins, and still does not):

1. **Merge into a protected branch** (`git_merge` with target in
   `dev`/`qa`/`rc`/`main`, [RN-006](../business-rules.md#rn-006)) — the merge lock
   (`isProtectedBranch`) downgrades `auto_approve` to `require_approval`
   always, even with `"*": auto_approve` on for the agent.
2. **`instruction_patch`** ([RN-007](../business-rules.md#rn-007)) — changing another
   agent's instruction requires the human to see the diff; auto mode does not change that.
3. **`parallelize`/`raise_max_parallel`** ([RN-086](../business-rules/custo.md#rn-086)) — raising the
   parallelism ceiling, or asking for more agents above it, remains the user's
   decision; an agent with auto mode on cannot self-grant
   more spending power.

The proof is by CONSTRUCTION, not case by case: since the three ceilings check
only `current.policy === 'auto_approve'` — never the origin —, and "auto mode" can only
reach `current.policy === 'auto_approve'` through the SAME path
that a specific `agent_autonomy` rule already used
(`ctx.autonomyMode`), the ceilings that already contained `agent_autonomy` keep
containing the wildcard without needing new code. The real risk was not the
ceiling — it was someone, when generalizing `agent_autonomy` to accept `"*"`,
inserting the wildcard check BEFORE the ceilings and reopening the door; that is why
`AGENT_AUTONOMY_ALL_ACTIONS` was resolved entirely in the REPOSITORY
(before `decide()` runs), and `decide()` itself gained no new
line — only enough to have no place where the wildcard could pierce.

- **Where:** `apps/api/src/domain/actions/decide.ts` (the three ceiling blocks,
  lines ~207–258, unchanged by this feature)
- **Test:**
  `apps/api/test/application/use-cases/actions/propose-action.use-case.spec.ts`
  ("auto mode NÃO auto-aprova merge em branch protegida", "... instruction_patch",
  "... parallelize/raise_max_parallel" — all three with `agent_autonomy` "*"
  written as `auto_approve` and the verdict remaining `require_approval`)
- **Origin:** design constraint confirmed by the user when asking for "auto
  mode" — the three ceilings are the guarantee that cannot regress

### RN-603 — Auto mode releases the path scope, and only it {#rn-603}

Product owner decision on 2026-09-26 (AT-226,
[ADR 0167](../adr/0167-modo-automatico-libera-o-escopo-de-caminho.md)): with
"Modo automático" on for an agent — the `"*"` wildcard of
[RN-153](#rn-153) resolved as `auto_approve` —, the agent runs ANY
terminal command without asking for approval, INCLUDING outside the project folder.
The path scope ceiling of ADR 0055 stops holding for that agent.
Measured on `exp001` (`mounted` mode, container up): 51 commands asked for
approval with the mode on, 47 only for citing `/work` or `/tmp` — the dev agent
runs in the container and the scope compares against the HOST root.

`decide()` starts receiving the ORIGIN of the autonomy (`ctx.autonomyOrigin`:
`'especifica'` or `'curinga'`), resolved by the SAME repository that already
resolved the precedence — `findMode` became a read of `resolve`, not a
second rule. Only the wildcard in `auto_approve` is auto mode
(`modoAutomaticoDoAgente`); an absent origin counts as specific. In auto
mode, two prompts cease to exist: the SCOPE ceiling and the
`require_approval` that the COMPOUND command synthesizes when a segment has no
rule at all in `permissions.json` (the file with no opinion, which never downgrades
an earlier stage) — without the second, `cd /work && npm test` would keep asking.

Everything remains as it was, in auto mode too: `deny` (from the file, from the
built-in patterns or from specific autonomy) wins; an `ask` WRITTEN in the
file asks; the external-effect/privileged-command ceiling (push, PR,
deploy, `sudo`/`doas`, [RN-418](../business-rules.md#rn-418)) runs first and does not
look at the origin; merge into a protected branch, `instruction_patch`,
`parallelize`/`raise_max_parallel` and `container_remove` are never
auto-approvable ([RN-154](#rn-154)). A specific rule for the type beats the wildcard
in the repository and arrives as `'especifica'`: `terminal: require_approval` with the
wildcard on keeps asking. Turning off (the agent card's toggle writes the
wildcard as `require_approval`) restores the ceiling. Since
[RN-670](../business-rules.md#rn-670) (ADR 0189) the specific `auto_approve`
under the `auto_approve` wildcard — what a dev agent's "Sempre permitir" writes —
resolves as the WILDCARD, and no longer turns off auto mode; and, outside it, the
scope compares against the REAL execution folder ([RN-669](../business-rules.md#rn-669)).

The screen says, before the click, what the mode releases and what keeps asking: the
`ApprovalCard` note appears in BOTH variants (chat and Approvals queue),
and the agent card shows a sentence under the toggle — only when the WILDCARD is
on, because the toggle over the representative type writes a specific rule,
which does not release the scope.

- **Where:** `apps/api/src/domain/actions/decide.ts:295` (`modoAutomaticoDoAgente`),
  `apps/api/src/domain/actions/decide.ts:370` (the synthesized verdict of the
  compound ignored), `apps/api/src/domain/actions/decide.ts:455` (the scope
  ceiling skipped),
  `apps/api/src/infrastructure/persistence/drizzle/agent-autonomy.repository.ts:25`
  (`resolve`, with the origin),
  `apps/api/src/application/use-cases/actions/propose-action.use-case.ts:216`
  (`autonomyOrigin`), `apps/web/src/components/AgentTeamGrid.tsx:108`
  (`autonomyHint`), `apps/web/src/components/ApprovalCard.tsx:313` (the note
  in both variants)
- **Test:** `apps/api/test/domain/actions/decide.spec.ts` ("modo automático
  libera o escopo de caminho (RN-603)": out of scope and compound auto-approve;
  push/`sudo`/`deny`/written `ask` remain; a specific rule and a wildcard
  turned off do not release; the other ceilings do not change),
  `apps/api/test/application/use-cases/actions/propose-action.use-case.spec.ts`
  (end to end with the real repository),
  `apps/api/test/infrastructure/persistence/drizzle/agent-autonomy.repository.spec.ts`
  (`resolve` returns the origin), `apps/web/src/components/AgentTeamGrid.test.tsx`,
  `apps/web/src/components/AgentCard.test.tsx`,
  `apps/web/src/components/ApprovalCard.test.tsx`
- **Origin:** product owner decision (AT-226) after the test on `exp001`

### RN-155 — timeline ordering uses the `proposed_action.created` link, never the raw `action.seq` {#rn-155}

The `timeline` of `SessionPage.tsx` orders events and proposed actions by a
single comparable numeric axis. For events, it is `event.seq` (gapless, per
session). For actions, it is the `seq` of the correlated `proposed_action.created` event
(found by `payload.actionId === action.id`, written by
`ProposeActionUseCase` in the SAME transaction that creates the action) — never
`action.seq`, which is a unique and global `bigserial` of the whole
`proposed_actions` table, shared by all sessions and projects of the
system, and therefore incomparable with `event.seq` (a deliberate contrast, see
`apps/api/src/db/schema/actions.ts`). Comparing the two directly produced an
unpredictable order every time an `ApprovalCard` entered the mix with normal
events. Actions without that link (only the Gitflow bootstrap —
`git_repo_create`/`git_branch_create`, which only write outbox) degrade
to a position interpolated by `createdAt`, anchored on the last previous
event.

- **Where:** `apps/web/src/routes/SessionPage.tsx` (`ordemDaAcaoNaTimeline`)
- **Test:** `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
- **Origin:** finding from PR #286 — approval cards appeared out of order
  in the timeline, mixed with normal events

### RN-156 — the 5s wait indicator has fixed text, without interpolating the agent {#rn-156}

The indicator that appears after 5s without a response (`pensandoVisivel`) shows
the fixed sentence "Reunindo informações...", without the agent's name interpolated —
it replaces the previous text "{Agente} está escrevendo…". The agent's name is already
visible in the header as soon as the real text streaming starts; repeating it
in the wait indicator did not help reading.

- **Where:** `apps/web/src/routes/SessionPage.tsx`
- **Test:** `apps/web/src/routes/SessionPage.pista-e-status.test.tsx`,
  `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
- **Origin:** finding from PR #286 — the previous text named an agent that was already
  visible in the header

### RN-157 — epic/story creation by the PO becomes a compact notice, not a full bubble {#rn-157}

The `backlog.epic_created`/`backlog.story_created` events no longer
render as a full message bubble (`.message`/`.bubble`, 32px avatar
— the same visual weight as a real agent response) and start
using the same compact notice format that `.handoffDivider`/`.handoffPill`
already uses for the baton pass: a centered line with a horizontal rule and a
compact pill, keeping the "Ver no Backlog" link. `agentId` remains
populated in the `TimelineEntry` — unlike the handoff divider, this does not
mark a transition between agents, it is an action by the PO within their own turn,
and it remains eligible for per-agent collapsing ([RN-138](../business-rules.md#rn-138)).

- **Where:** `apps/web/src/routes/SessionPage.tsx`
- **Test:** `apps/web/src/routes/SessionPage.handoff-inline-e-links.test.tsx`,
  `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
- **Origin:** finding from PR #286 — the full bubble had visual weight equal to
  a real agent response, for a metadata action by the PO

### RN-158 — Light Markdown with highlighting in the chat {#rn-158}

`agent.response` in the Session thread renders a subset of Markdown
(bold `**texto**`, italic `*texto*`/`_texto_`, inline code
`` `texto` ``, heading `#`/`##`/`###`, list `-`/`1.`, link
`[texto](url)` and code fence ```` ```linguagem ````), via its own
regex parser (`apps/web/src/lib/markdown.ts`), with no new dependency.
`chat.message` (text typed by the user) stays literal — Markdown
only applies to the OUTPUT of an agent/LLM, never to human input.

Security: the parser never produces HTML — it returns a data tree that
`MarkdownMessage.tsx` converts into React elements directly (never
`dangerouslySetInnerHTML`). A link only becomes a clickable `<a href>` when the
URL scheme is `http`, `https` or relative (`/...`, `#...`); any
other scheme (`javascript:`, `data:`, etc.) degrades to the link text,
never to an executable `href`.

Code inside a fence gets per-token highlighting, reusing
`highlightLine`/`highlightFile` from `apps/web/src/routes/code/highlight.ts`
— the same function that already colors the Code tab. `sh`/`bash` gained
their own shell keyword vocabulary (before, they only had the
`#` line comment mapped and fell into the JS fallback). Fences
```` ```sh ````/```` ```bash ```` get the visual aesthetics of a terminal
(`$` prompt per command line), consistent with the `$ comando` that
`ApprovalCard` already uses for the `terminal` action.

- **Where:** `apps/web/src/lib/markdown.ts`,
  `apps/web/src/components/ui/MarkdownMessage.tsx`,
  `apps/web/src/routes/code/highlight.ts`
- **Test:** `apps/web/src/lib/markdown.test.ts`,
  `apps/web/src/components/ui/MarkdownMessage.test.tsx`,
  `apps/web/src/routes/code/highlight.test.ts`,
  `apps/web/src/routes/SessionPage.markdown-resposta.test.tsx`
- **Origin:** PR #288 — agent responses with lists, code and links
  arrived as raw text in the thread, with no structure at all

### RN-159 — Generated Artifacts grouped by agent {#rn-159}

The Session's "Artefatos gerados" panel (`ContextAside` in
`SessionPage.tsx`) lists dev PRs (`pr_open`), the Arquiteto's ADR PRs
(`open_adr_pr`) and epics/stories created by the PO
(`backlog.epic_created`/`backlog.story_created`), grouped by
`agentId` — who generated each artifact — with the same collapsible
`Disclosure` pattern of [RN-138](../business-rules.md#rn-138) (agent name + count,
expandable to the title of each artifact).

Each artifact navigates to the place where it lives: a PR (dev or ADR) opens the real
URL (`executionResult.pullRequestUrl`, the same field that
`ProjectOverviewTab.tsx` already reads for an ADR PR); epic/story navigates
to `/projects/:projectId?tab=backlog` (the same `Link` pattern already used in the
PO's compact notices in the main thread, [RN-124](../business-rules.md#rn-124)/
[RN-157](#rn-157)). A PR still without `pullRequestUrl` (pending execution)
appears in the panel without becoming a clickable link.

Out of scope, by a decision recorded in a code comment
(`ContextAside` in `SessionPage.tsx`): module_map/C4 — they are the project's
CURRENT state (one current version, overwritten on each generation), not
an artifact dated per SESSION like PR/epic/story; the Overview tab
(`ProjectOverviewTab.tsx`) is already their place today, without an anchor of their own —
addressing that is out of the scope of this delivery.

- **Where:** `apps/web/src/routes/SessionPage.tsx` (`ContextAside`)
- **Test:** `apps/web/src/routes/SessionPage.artefatos-gerados.test.tsx`
- **Origin:** PR #288 — the panel did not distinguish who generated each artifact
  nor covered ADR PRs and epics/stories, only dev PRs

### RN-160 — "Confirmar arquitetura pronta" requires at least 1 promoted story {#rn-160}

The "Confirmar arquitetura pronta" button (Arquiteto→Dev Lead handoff, via
`confirmArchitectureReadiness`) is born `disabled` until the project's backlog has
at least 1 story with a status other than `draft` — that is, already
promoted by `PromoteStoriesUseCase`/`TransitionStoryUseCase` ([RN-048](../business-rules/custo.md#rn-048)),
having a captured business rule not being enough. `in_progress`/`done` also
count, because one only gets there having gone through `ready`. The source is the SAME
the Backlog tab already uses (`useBacklog`, `ProjectBacklogTab.tsx`, the same
queryKey `['backlog', projectId]`) — no new round trip. While there is no
promoted story, the button shows the hint in `title` explaining the reason.

- **Where:** `apps/web/src/routes/SessionPage.tsx` (`hasPromotedStory`,
  button render)
- **Test:** `apps/web/src/routes/SessionPage.readiness-arquitetura-exige-historia.test.tsx`
- **Origin:** user request — the Arquiteto→Dev Lead handoff button
  had no gate at all

It only held on the CLIENT: a direct HTTP call ignored the rule. Closed by
[RN-404](../business-rules.md#rn-404) (ADR 0094), which revalidates on the backend.

### RN-161 — Accepting the handoff to the Dev Lead chains execution activation when the effective role already authorizes it {#rn-161}

> **Revised by [RN-677](../business-rules.md#rn-677) (ADR 0194, owner's decision
> on 10/01):** accepting the handoff to the Dev Lead stopped chaining the activation
> of execution, for EVERY role — the acceptance only brings it to PLAN, and what activates
> is the APPROVAL of its plan (`propose_execution_plan`). The text below
> describes the fusion as it was.

`handleAcceptHandoff` (`SessionPage.tsx`) chains `activateExecution`
automatically when `toAgent === 'dev-lead'` AND the EFFECTIVE role of whoever
accepts — read from the same `useCurrentWorkspaceWithRole()` that already authorizes
"Auto mode" ([RN-153](#rn-153)) and the Approvals/Settings screens — is
`owner` or `maintainer`. For `developer` (or a role not yet resolved), the
current flow remains untouched: accepting activates nothing, and "Ativar execução"
remains as a second button. The check is client-only —
`POST .../execution/activate` still requires `maintainer` on the backend
([RN-137](../business-rules.md#rn-137)); the fusion only avoids a redundant click for whoever already
had both roles. It reuses the SAME `handleActivateExecution` that the
"Ativar execução" button already calls, which handles its own error (toast +
`mensagemDaApi`) and never rethrows — it avoids a late activation error
being reported as "não foi possível aceitar o handoff".

- **Where:** `apps/web/src/routes/SessionPage.tsx`
  (`podeFundirHandoffComExecucao`, `handleAcceptHandoff`)
- **Test:** `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`,
  describe "problema 4"
- **Architectural decision:** [ADR 0069](../adr/0069-fusao-condicional-do-handoff-com-a-ativacao-de-execucao.md)
- **Origin:** user request (approved design)

### RN-162 — The Criativo's structured questions {#rn-162}

The Criativo can, when it asks SEVERAL questions in the same response, emit the
list in a STRUCTURED format instead of letting the user answer item by
item in free text — a new tool `ask_structured_questions`
(`apps/engine/lib/engine/harness/tools/ask_structured_questions.ex`,
`:direct`), registered next to `emit_artifact`. Schema:
`{ questions: [{ id, label, type?, options? }] }` — `id` unique and non-empty,
`label` non-empty, `type` ∈ `text|textarea|select` (default `text`),
`options` mandatory and non-empty when `type: select`. It writes
`chat.structured_question`.

The frontend (`StructuredQuestionCard`, `SessionPage.tsx`) renders a
form with one field per question — `Input`/`Textarea`/`Select` from the
design system, according to `type`. `POST .../agents/:agent/structured-
question/:questionSetId/answer` (`AnswerStructuredQuestionUseCase`) validates
that every question has a non-empty answer, writes
`chat.structured_question_answered` (referencing `questionSetId` = the id of the
question event) and REUSES `SendAgentMessageUseCase` — the answers become
a concatenated message ("1. {label}: {resposta}\n2. ..."), as if the
user had typed in the thread; there is no new "the agent reads the
structured answer" channel. A set of questions can only be answered
ONCE: resubmission is refused with 409, and the form does not even
reappear — the card becomes read-only as soon as there is a later
`chat.structured_question_answered` with the same `questionSetId`.

- **Where:** `apps/engine/lib/engine/harness/tools/ask_structured_questions.ex`,
  `apps/engine/lib/engine/agents/criativo_server.ex`,
  `apps/api/src/application/use-cases/agents/answer-structured-question.use-case.ts`,
  `apps/api/src/interfaces/http/agents/agents.controller.ts`,
  `apps/web/src/routes/SessionPage.tsx` (`StructuredQuestionCard`)
- **Test:** `apps/engine/test/engine/harness/tools/ask_structured_questions_test.exs`,
  `apps/engine/test/engine/agents/criativo_server_test.exs`,
  `apps/api/test/application/use-cases/agents/answer-structured-question.use-case.spec.ts`,
  `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx`
- **Origin:** user request — no precedent of structured input in the chat

### RN-163 — The Criativo keeps the promise to try again {#rn-163}

Each Criativo turn runs a **bounded tool-use loop**, with a ceiling of **12**
trips to the model — the same design the PO and the Arquiteto already had. Before, the
model was called ONCE per turn: the tool result was appended to the
in-memory history and nobody read it again, so the sentence *"vou corrigir e
tentar de novo"* — literal in the code — was only fulfilled if the user sent
another message. For whoever used it, the Criativo simply stopped answering
after saying it was going to fix it.

Four consequences, and each one is a rule:

1. **A tool error is input, not the end of the line.** The reason goes back to the model
   as a `tool` message and the loop calls the model again, which re-emits it corrected
   WITHIN the same turn.
2. **Nothing is announced that the code will not execute.** The retry sentence is
   decided after dispatching the tools and knowing how many rounds
   are left: with a round available, the agent says it will fix it; without a round, it
   does not promise.
3. **The tool failure became a durable `agent.error`, with origin**
   ([RN-059](../business-rules/custo.md#rn-059)) — it was an `agent.response`, indistinguishable in the event log from
   a normal response. `origem: infra` when the api refused the `append_event`;
   `origem: modelo` for the payload the model wrote (wrong key,
   `origin` that is not a list, duplicated rule, system-emitted type). The payload
   carries `tool` and `retentativa`.
4. **An exhausted ceiling does not end in silence.** It becomes an `agent.error` with
   `reason: "limite_de_iteracoes"` and `origem: modelo`, the same reading as
   the `ToolLoop`'s `toolloop.limit_reached`. The event name is NOT reused: this
   agent does not run inside the `ToolLoop`, and the event would lie about who
   produced it.

Two boundaries of the loop, both deliberate: a successful `ask_structured_questions`
**ends** the turn (the ball is with the user, and the answers
come back in a future turn — [RN-162](#rn-162)); and a turn that had a failure in
some round closes with a CONSOLIDATED outcome in the thread, so the last word
is not the error of a round that was already corrected later.

- **Where:** `apps/engine/lib/engine/agents/criativo_server.ex`
  (`run_turn_capturing/3`, `continuar/4`, `emit_falha_de_ferramenta/4`,
  `emit_falha_limite/2`)
- **Test:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  (a loop that really corrects, an exhausted ceiling narrated, origin `infra` vs
  `modelo`, a structured question that ends the turn)
- **Origin:** real use in the `exp001` project — "o Criativo não respondeu depois
  de dizer que iria corrigir e tentar de novo"

### RN-169 — The project chooses where the code lives: Local or Container {#rn-169}

**REVISED by [RN-421](../business-rules.md#rn-421) (ADR 0104)**: `workspace_mode`/`local`
became an `execution_mode` of THREE values (`container`/`mounted`/`runner`,
migration `0048`) — the rest of this entry is history, faithful to what held until
the revision.

A project is born with a **workspace mode** (`projects.workspace_mode`,
migration `0043`), and it is what decides where the scope root is derived from:

- **`container`** (DEFAULT, and the behavior that always existed): the folder
  MANAGED by the product, `join(PROJECT_WORKSPACES_ROOT, workspace_dir_name)`
  ([RN-109](#rn-109));
- **`local`**: a folder OF THE USER, at the absolute path of
  `projects.workspace_path`.

The pair is tied by a CHECK in the database
(`(workspace_mode = 'local') = (workspace_path IS NOT NULL)`), and not only by the
use case: the column is read by TWO processes (api and engine) and written by
seed/backfill scripts that do not go through it. `local` without a path would be a
terminal scope pointing nowhere; `container` with a path would be
a second source of truth waiting to diverge from the first.

The derivation remains **unique** — `projectScopeRoot` started receiving the
location (`{workspaceDirName, workspaceMode, workspacePath}`) and picks the
branch; none of the four consumers ([RN-092](../business-rules/custo.md#rn-092)) gained validation
of its own. The engine resolves the same locator in the QUERY (folder name in
`container`, absolute path in `local`) and distinguishes the two by the leading
slash, which is unambiguous because the folder name is validated against
`^[A-Za-z0-9_-]{1,64}$`.

Two explicit consequences of the `local` mode:

1. **The Arquiteto's image gate ([RN-105](#rn-105)) does NOT apply.**
   **REVOKED by [RN-494](../business-rules.md#rn-494) (ADR 0135)**: the
   exemption ended — the three modes now require the image decision
   before opening the Code tab. The rest of this item is history. A Local
   project does not start a container, so the Code tab unlocked without waiting for a decision
   that was never going to happen. The exemption lived in the same funnel as the gate in the
   api, and the screen agreed: `ProjectCodeTab` did not even ask for the
   container state ([RN-107](#rn-107)) when the project was Local — if
   only the api exempted it, the tab would remain blocked on screen by a
   nonexistent decision.
2. **The `permissions.json` lives in the user's folder**, together with the code —
   because the policy has to be read from the SAME root that the terminal scope
   authorizes.

`workspace_mode` is not to be confused with the `GitProviderName` `'local'`: one says where the
CODE lives on disk, the other where the git REPOSITORY lives, and the two choices
are orthogonal.

- **Where:** `apps/api/src/db/schema/iam.ts` (`projects`),
  `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`projectScopeRoot`), `apps/api/src/domain/iam/project.entity.ts`,
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (`portaoDoContainer`), `apps/web/src/routes/ProjectCodeTab.tsx`,
  `apps/engine/lib/engine/projects/project.ex`,
  `apps/engine/lib/engine/actions/workspace.ex` (`workspace_dir/2`),
  `apps/engine/lib/engine/dev/worktree_cleanup.ex` (which was the second
  hand-written derivation, and started using the single one),
  `apps/web/src/routes/NewProjectWizard.tsx`
- **Test:** `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (describe "projectScopeRoot no modo local"),
  `apps/api/test/infrastructure/filesystem/fs-permissions-file-store.spec.ts`
  (the permissions.json in the user's folder),
  `apps/api/test/application/use-cases/iam/create-project-modo-de-workspace.spec.ts`,
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (a Local project does not go through the gate),
  `apps/api/test/interfaces/http/iam/project-dto-modo-de-workspace.spec.ts`
  (the mode is frozen: PATCH does not change it),
  `apps/web/src/routes/ProjectCodeTab.test.tsx` (the screen also exempts the gate),
  `apps/engine/test/engine/actions/workspace_test.exs`
  (describe "workspace_dir/2 com o localizador já resolvido"),
  `apps/web/src/routes/NewProjectWizard.test.tsx`
- **Architectural decision:** [ADR 0072](../adr/0072-projeto-local-ou-container.md)
- **Origin:** user request (their decision, with the free-path variant
  explicitly chosen)

### RN-170 — A Local path is validated at CREATION, and the refusal teaches {#rn-170}

**REVISED by [RN-422](../business-rules.md#rn-422) (ADR 0104)**: creation validation started
to DIVERGE by mode — `mounted` (the renamed `local`) keeps touching the disk
as described here, `runner` validates only the LEXICON, without I/O — the rest of this
entry is history, faithful to what held until the revision.

Creating a project in `local` mode with a path the api cannot reach produces a
project that **hangs later** — on the first tool of the first agent, far
from the screen where the decision was made. That is why creation **refuses with 400**, and the
message says what needs to be done.

The path must be:

1. **absolute**, with no `..` or `.` in any segment (the stored path is the
   path that is read; `/srv/app/../../etc` is `/etc` and does not look like it);
2. **existing and a folder** inside the api container;
3. **writable by the process** (`access(W_OK|X_OK)`) — the images run non-root
   ([ADR 0024](../adr/0024-fase5-imagens-producao-ci.md)), and a host folder with
   another owner arrives mounted as read-only in practice;
4. **outside the root and the system folders** (`/`, `/etc`, `/usr`, `/var`,
   `/data`… and everything below them): the project root is the scope that AUTHORIZES the
   agent's terminal ([ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md)),
   and a project rooted at `/etc` turns "the agent writes in its project"
   into "the agent rewrites the container";
5. **with no overlap with the Brabo checkout, in BOTH directions** — the folder that
   CONTAINS the monorepo and the folder INSIDE it. The second case is the problem that
   ADR 0055 reports actually happening.

The stored path is the **normalized** one, not the raw string: validating one string and
storing another is how validation stops holding the next day. A `workspacePath`
sent together with `workspace_mode: container` is REFUSED, not ignored — a field
silently discarded becomes "but I configured it".

The LEXICAL part (items 1, 4 and 5) runs **also on read**, on each derivation of
`projectScopeRoot`: the only way to bypass creation is to write directly into the
database, and what is gained there is a terminal scope at `/`. The DISK part
(items 2 and 3) runs only at creation, where the user can still fix it.

The refusal for a missing folder brings the mount instruction — the file, the two
services and the line (`- <caminho>:<caminho>`), with the pointer to
[the runbook](../runbook.md). Mounting only in the api produces a project the api accepts and the
engine does not see: it validates what it sees, and has no way of knowing what is
mounted in the other container.

- **Where:** `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`validarCaminhoDeWorkspaceLocal`, `CaminhoLocalInvalidoError`),
  `apps/api/src/application/use-cases/iam/create-project.use-case.ts`
  (`caminhoValidado`), `apps/api/src/interfaces/http/iam/dto/create-project.dto.ts`,
  `apps/web/src/lib/wizard.ts` (`caminhoLocalParecePlausivel`)
- **Test:** `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (describe "validarCaminhoDeWorkspaceLocal"),
  `apps/api/test/application/use-cases/iam/create-project-modo-de-workspace.spec.ts`
  (describe "a criação RECUSA o caminho que travaria depois"),
  `apps/web/src/lib/wizard.test.ts`, `apps/web/src/routes/NewProjectWizard.test.tsx`
- **Architectural decision:** [ADR 0072](../adr/0072-projeto-local-ou-container.md)
- **Origin:** a guard required by the free-path variant (ADR 0072)

---

### RN-164 — The PO READS what already exists, scoped to the project {#rn-164}

The PO gained two READ tools — `listar_regras_de_negocio` and
`listar_backlog` (`:direct`, with no parameter at all) — served by two internal
routes scoped to the **project**: `GET /internal/projects/:projectId/business-rules`
and `GET /internal/projects/:projectId/backlog`.

The first returns every `artifact.business_rule` of the project's sessions with the
whole `description`, which stories already cite each rule and the
`uncoveredCount`; the second returns the SAME epic → story → task tree
as the Backlog tab, through the same `ListBacklogUseCase` (three reads per project,
never N+1). The text returned to the model puts the UNCOVERED rules first and
the ORPHAN epics before the tree — that is what generates work.

What the rule fixes: until now the PO had **four tools, all of them
write tools**. Its context was built once, at kickoff, from the 200
last events of the **session** — from then on it did not know which rules
existed, which it had already covered, nor what it had already created. The scope is the
project and not the session on purpose: a rule captured in a previous session is
exactly what the per-session read hid.

Reading does **not** become a `proposed_action` (it is not an external effect), but it is CONTAINED in the
sense of ADR 0060: neither of the two routes accepts a parameter beyond the project
id — no search, no pagination, no filter —, the cost per call is
constant, and the text delivered to the model has a line ceiling stating the real
total when it truncates.

- **Where:** `apps/engine/lib/engine/harness/tools/listar_regras_de_negocio.ex`,
  `apps/engine/lib/engine/harness/tools/listar_backlog.ex`,
  `apps/engine/lib/engine/agents/po_server.ex`,
  `apps/engine/lib/engine/sessions/engine_api_client.ex`,
  `apps/api/src/application/use-cases/backlog/list-business-rules.use-case.ts`,
  `apps/api/src/interfaces/http/internal/internal-projects.controller.ts`
- **Test:** `apps/engine/test/engine/harness/tools/listar_regras_de_negocio_test.exs`,
  `apps/engine/test/engine/harness/tools/listar_backlog_test.exs`,
  `apps/engine/test/engine/agents/po_server_test.exs`,
  `apps/api/test/application/use-cases/backlog/list-business-rules.use-case.spec.ts`
- **Origin:** real use in the `exp001` project — "crie ferramenta para o PO
  conseguir listar as regras de negócio"

---

### RN-165 — An epic without a story is called out, and the PO asks when it does not know {#rn-165}

When the PO ends a turn having created an epic and **no story for
it**, that becomes an EXPLICIT outcome: a durable event
`backlog.epic_without_story` (with `origem: "modelo"`, the ids and titles of the
epics and the message) plus the `agent.error` broadcast — the pattern of
[RN-059](../business-rules/custo.md#rn-059): the log is what survives, the broadcast is the agent saying it in the
thread. The call-out is per OCCURRENCE: once reported, the pending list is
emptied, and it does not become an alarm that repeats on every turn.

What counts is the creation that **succeeded**: a `create_story` refused by the api
(nonexistent `business_rule_id`, for example) does not settle the epic. Treating it as
if it did would be trading one silence for another. The pending epics live in the
`PoServer` state and are NOT rehydrated: the call-out is about the obligation
assumed in the turn, and rebuilding it from the event log would reopen an old epic the
user has already resolved some other way.

Along with it came the two pieces that were missing for the PO to have a way out other than stopping:
`ask_structured_questions` — the SAME tool as the Criativo's
([RN-162](#rn-162)), just advertised in `po_server` — and the kickoff
instruction saying, in so many words, that an epic without a story blocks execution
and that **when information is missing, one ASKS**, never stops nor invents. The
previous instruction did not say a word about what to do in the face of a
gap, and in the face of a gap without instruction a model chooses between inventing
and stopping.

- **Where:** `apps/engine/lib/engine/agents/po_server.ex`
  (`anotar_obrigacao/4`, `encerrar_turno/1`, `obrigacoes/0`),
  `apps/engine/lib/engine/harness/tools/create_epic.ex` (`id_no_resultado/1`),
  `apps/web/src/lib/activity.ts`
- **Test:** `apps/engine/test/engine/agents/po_server_test.exs`
  (describe "RN-165"), `apps/web/src/lib/activity.test.ts`
- **Origin:** real use in the `exp001` project — a backlog without stories, hence without
  tasks, hence execution stuck without a visible error

---

### RN-166 — The PO's iteration ceiling leaves a trace {#rn-166}

Once the iteration ceiling of the `PoServer` tool loop (12) is exhausted, the
turn emits `toolloop.limit_reached` with `{iteration, max_iterations}` —
the SAME type and the same payload that `Engine.Harness.ToolLoop` already emitted
since Fase 3. Before, the clause returned the state and that was it: from outside, an exhausted
loop was indistinguishable from a turn that simply ended.

Reusing the identifier instead of creating a `po.*` is deliberate: it is the same fact
(the loop hit the ceiling), and whoever reads the event log should not need to learn a
second name because the conversational agent has its own loop instead of
using the `ToolLoop`.

- **Where:** `apps/engine/lib/engine/agents/po_server.ex` (`run_turn/2`,
  clause `remaining <= 0`)
- **Test:** `apps/engine/test/engine/agents/po_server_test.exs`
  ("teto de iterações emite toolloop.limit_reached")
- **Origin:** investigation of the `exp001` hang — the loop ended
  silently

---

### RN-172 — Handoff and approval are the OUTCOME of the turn {#rn-172}

In the session thread, the **offered handoff** and the **approval card** appear
AFTER the last utterance of the turn in which they were born — never in the middle of it.

This **does not fix ordering**: RN-155 remains fully in force, and the
timeline stays ordered by the event log's `seq`. What the log records is the
truth: `po_server.ex` (`run_turn/2`) emits, in the SAME iteration, the turn's
`agent.response`, THEN the `tool.call` of `offer_handoff` (which writes
`handoff.offered`) and ONLY THEN recurses to the closing `agent.response`.
The handoff's `seq` is honestly lower than the last utterance's. The same holds
for `proposed_action.created`, which is born in the middle of the turn while the agent
still has something to say. Showing "passed the baton" or "approve this" in the middle of the
conversation is a wrong reading of correct data — so the rule is about
PRESENTATION, applied in a separate and explicit pass
(`afundarDesfechos`), after the `sort` by `seq`, and not hidden in a
three-term comparator.

Different turns **never mix**. An outcome sinks to the end of the
stretch right below it and stops at the first entry that fails any of the
three conditions:

1. **same turn** — the turn is the `seq` of the last OPENING before the entry, and
   an opening is an event with actor `user` (`chat.message`, `agent.activated`,
   story promotion/return). It protects the case in which the boundary between
   two turns has no VISIBLE entry at all: `agent.activated` opens a turn and
   does not become a thread item.
2. **same author** — in an EXECUTION session several agents write without the
   user speaking a single time, and all of them stay in the same turn; one's outcome
   cannot cross another's utterance.
3. **is not an outcome** — two consecutive outcomes preserve the order between them (the
   Infra's `handoff.offered` before the Dev Lead's, in the same confirmation).

The `system` actor does NOT open a turn: it is infrastructure noise in the middle of the thread, not
a decision of whoever is conversing.

- **Where:** `apps/web/src/routes/SessionPage.tsx`
  (`aberturasDeTurno`, `turnoDoSeq`, `afundarDesfechos`, and the
  `autor`/`turno`/`desfecho` fields of `TimelineEntry`)
- **Test:** `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
  (describes "RN-172 — turno e desfecho (unidade)" and "RN-172 — a sequência
  REAL do engine, renderizada")
- **Origin:** real use on `exp001` — "a passagem de bastão do PO para o
  arquiteto está aparecendo acima da última mensagem do PO" and "a mensagem de
  aprovação apareceu acima do chat do arquiteto até ele finalizar a resposta"

---

### RN-173 — The thread follows everything that grows, and only for whoever was already at the end {#rn-173}

The chat scrolls to the end when the content grows — **and not only when a new
event arrives**. The two timeline sources are SEPARATE queries (`events` and
`actions`), and the height still changes without either of them: opening/closing a
`Disclosure` (per-agent collapse of RN-138, the approval card's "Detalhes"),
Markdown reflowing, a diagram rendering later. That is why there are two
mechanisms: the effect's dependencies cover what React knows
(`events.length`, `actions.length`, `streamingText`), and a `ResizeObserver`
over the thread's CONTENT covers what only the layout knows.

The guard remains **unchanged and deliberate**: it only scrolls whoever is already less than
120px from the end. Whoever scrolled up to reread the history is not dragged — the thread follows
the conversation, it does not hijack the reading.

In the same thread, the approval card no longer takes up the whole 780px of the
column: it gets a ceiling of 560px and is centered, as
`.handoffCard`/`.handoffDivider` already are. Indenting 45px like the bubbles would be
wrong — the card is nobody's utterance, it is a decision asked of the user. The
Approvals tab queue does not change: there the card MUST fill the grid column.
Since AT-322 the card is ONE single card on every surface and fills the container —
what applies the ceiling and the centering in the thread is its container
(`.acaoNoFio`), no longer a variant of the card.

- **Where:** `apps/web/src/routes/SessionPage.tsx` (`acompanharOFim` and the two
  effects that call it); `apps/web/src/components/ApprovalCard.module.css`
  (`.card`) and `apps/web/src/routes/SessionPage.module.css` (`.acaoNoFio`)
- **Test:** `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
  (describe "RN-173 — o fio acompanha o que cresce", with the case of the user
  having scrolled up)
- **Origin:** real use on `exp001` — "o scroll do chat deve ficar sempre no
  final seguindo o chat" and "aprovação mal diagramado deve ficar ao centro"

### RN-171 — The list question has a free-text way out, by default {#rn-171}

A `type: "select"` question of `ask_structured_questions` (RN-162) accepts
an answer **outside the list**. The field is `allowOther`, and the **default is `true`**:
whoever declares nothing offers the way out. Closing the list requires an explicit
`allowOther: false`, and only makes sense when it is genuinely
closed ("Sim"/"Não").

The open default is not a style preference. A list closed by the model's
OVERSIGHT locks the whole conversation and the user has no way to
unlock it from outside — that is exactly what real use found: the model
offered an option of the kind "Escreva você mesmo" and the form had nowhere to
write, because the tool schema did not know how to express "besides these, whatever
you want". A list opened by mistake, in the worst case, offers one field
too many. The two errors do not cost the same. For the same reason the tool
description **forbids** creating an "Outro" option inside `options`: the form
already offers it by itself, and two escape hatches in the same list confuse.

`allowOther` only exists in `select` — in `text`/`textarea` the field is already free
text, and the engine normalizes these two to `false` instead of writing a meaningless
state in the event log. On screen, choosing "Outra (escrever)" swaps the
`Select` for an `Input`: the interface sentinel (`__outra__`) **never**
travels to the backend, and what goes is the typed TEXT. The submit button
keeps requiring ALL questions filled — `AnswerStructuredQuestion
UseCase` refuses with 400 listing what is missing, so enabling it with an empty field
would only produce a server error —, and being on "Outra" with the text still
blank does NOT count as filled.

The card also stopped being the only item in the thread aligned to nothing: it is now
centered with the same 560px ceiling as the `ApprovalCard` in the
`chat` variant ([RN-173](#rn-173)) and gets the agent's avatar and color, which is what
makes it read as SOMEONE's utterance instead of an orphan form. Before, it was born
pushed to the left with a 480px ceiling, while the bubbles start 45px
inward.

- **Where:** `apps/engine/lib/engine/harness/tools/ask_structured_questions.ex`
  (schema, validation and `normalizar/1`), `apps/web/src/lib/api-types.ts`
  (`StructuredQuestion.allowOther`), `apps/web/src/routes/SessionPage.tsx`
  (`StructuredQuestionCard`, `OUTRA_RESPOSTA`, `permiteOutra`),
  `apps/web/src/routes/SessionPage.module.css` (`.structuredQuestionCard`,
  `.structuredQuestionCabecalho`)
- **Test:** `apps/engine/test/engine/harness/tools/ask_structured_questions_test.exs`
  (open default, explicit `false`, non-boolean `allowOther` refused),
  `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx`
  (describe "saída por texto livre no select")
- **Origin:** real use on `exp001` — "sempre dê a opção de input do usuário
  quando ele seleciona Escreva"

### RN-174 — An action that triggers an agent turn arms the thread indicator {#rn-174}

The "the agent is working" indicator (the three dots after 5s,
[RN-131](../business-rules.md#rn-131)/[RN-156](#rn-156)) only appears while `streaming` or
`statusAgent` hold, and they were turned on in three places: the composer
(`handleSend`), the readiness confirmations and the Phoenix channel. **Every screen
action that triggers a synchronous turn in the engine now arms it too.**

There are two, and neither of them is the composer:

1. **Answering the structured questions form** —
   `AnswerStructuredQuestionUseCase` reuses `SendAgentMessageUseCase`
   ([RN-162](#rn-162)), and the call only resolves after the whole turn.
2. **Returning a story to the PO** — `ReturnStoryUseCase` calls `reviseStory`,
   which is `handle_call({:revise, …})` in `po_server`: the HTTP response waits for the
   PO to rewrite the story.

The Phoenix channel does not cover the gap, and that is what makes the fix necessary
rather than redundant: when it has not finished connecting yet (ticket +
join, [RN-108](#rn-108)) the `agent.status` "working" broadcast has no
listener and is lost — the screen stays in absolute silence for dozens of seconds,
which is indistinguishable from "nothing is going to happen".

The pair is `iniciarTurnoDoAgente(agente)` **before** the `await` (the channel's
`agent.status` may arrive first, and without the agent pinned the indicator would be born without
knowing who is speaking) and `finalizarTurnoDoAgente()` in the `finally` — on BOTH
paths, because an error that left `streaming` on would lock the composer
until the next turn. Resolving the call is a signal of the end of the turn as reliable
as the channel's `agent.done`, and `finalizarTurnoDoAgente` is idempotent. The
5s deadline does not change: a turn that answers quickly still shows nothing.

- **Where:** `apps/web/src/routes/SessionPage.tsx` (`iniciarTurnoDoAgente`,
  `handleReturnStory`, `StructuredQuestionCard`)
- **Test:** `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx`
  and `apps/web/src/routes/SessionPage.promocao-inline-e-volta.test.tsx`
  (RN-174 describes, with the failure case proving the indicator does not get
  stuck)
- **Origin:** real use on `exp001` — "caso a web, api e engine demore mais de
  5s para ter uma resposta, a web deve apresentar uma animação no chat
  mostrando que o agente está pensando"

### RN-175 — Every agent response says which model it was generated with {#rn-175}

`agent.response` carries `modelName` in the **three** producers of the event, and not
only in the four conversational agents:

| producer | who goes through there | before |
|---|---|---|
| the four conversational ones (`criativo`/`po`/`arquiteto`/`dev_lead`) | chat | already wrote it, since [RN-146](#rn-146) |
| `Engine.Harness.ToolLoop` | EVERY execution and gate agent — `dev-*`, QA, SecOps, Infra-Workflows, Psicólogo, Anamnese | **never wrote it** |
| `SendChatMessageUseCase` (api) | chat without an active agent, in which the one answering is the model | **never wrote it** |

No new call: `RunLlmTurnUseCase` already returns `modelName` in the body and
`StreamLlmTurnUseCase` already puts it in the `final` frame — the value is the name of the model
of the **resolved binding** (`model.name`), not the provider's echo. It is `null`
when the turn failed before resolving the binding, and absent in an event written
before this rule.

On screen, the model stopped being the loose word `modelo` in mono 10px
`--text-muted` next to the agent's name — which reads as if the model were
CALLED "modelo", and which fails the reading-text contrast. It became a
**chip** with the model icon, `--text-secondary` over `--surface-2`, and the
unknown label became "modelo não registrado". The screen does **not**
guess the model from the agent's CURRENT binding when the data is missing: attributing to
an old response a model that perhaps did not even exist when it was generated
would be inventing provenance, and invented provenance is worse than absent — the
same argument as the frozen price in `token_usage` ([RN-044](../business-rules/custo.md#rn-044)).

Out of scope, declared: `agent.error` still lacks the model in the four
servers, even when the api sent it in the error frame (budget exceeded, for
example). It is a change to another event, with another question to answer.

- **Where:** `apps/engine/lib/engine/harness/tool_loop.ex`,
  `apps/api/src/application/use-cases/llm/send-chat-message.use-case.ts`,
  `apps/web/src/routes/SessionPage.tsx` (the chip in `agent.response`),
  `apps/web/src/routes/SessionPage.module.css` (`.messageModelo`)
- **Test:** `apps/engine/test/engine/harness/tool_loop_test.exs`,
  `apps/api/test/application/use-cases/llm/send-chat-message.use-case.spec.ts`,
  `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`,
  `apps/web/src/design-contraste.test.ts` (the chip's pair)
- **Origin:** real use on `exp001` — "PO não mostrou o modelo que estava
  utilizando; todos os agentes devem apresentar o seu modelo ao lado do nome"

### RN-176 — A Markdown table in the thread becomes a real table {#rn-176}

The chat's light Markdown ([RN-158](#rn-158)) now recognizes a **GFM table** and
renders it with the design system's `Table` — the same component as
Settings, Spending and Executors, not a `<table>` of its own: "how Brabo
draws a table" is a single decision. Before, the Module Map table that the
Arquiteto writes in the response came out as a paragraph with literal pipes.

What distinguishes a table from prose with `|` is the **separator line**, and it is
mandatory as in GFM: without it the block remains a paragraph, so
"escolha entre a | b | c" does not become a table by mistake. The header rules the
number of columns — a short line gets an empty cell, a long line loses the
excess —, an escaped `\|` stays inside the cell, and the alignment comes from the
separator's colons. Zero new dependency: the parser remains its own,
regex-based, and the data tree keeps becoming React elements
directly (no `dangerouslySetInnerHTML`).

**The `artifact.module_map` artifact remains OUTSIDE the thread**, and the choice is
deliberate: it is the project's CURRENT state, not an artifact dated per session —
the same decision already recorded in [RN-159](#rn-159) —, and it lives in the Overview.
What the user asked for was the table **inside the message**, and that is what is now
drawn; the fix serves ANY agent that writes a table, and
not only the Module Map.

In the bubble, the table **scrolls horizontally** instead of squeezing columns: the thread is
~700px and a `module_map` has 4 columns.

- **Where:** `apps/web/src/lib/markdown.ts` (`table` block, `celulasDaLinha`),
  `apps/web/src/components/ui/MarkdownMessage.tsx` (`TabelaMarkdown`),
  `apps/web/src/components/ui/MarkdownMessage.module.css`
- **Test:** `apps/web/src/lib/markdown.test.ts` (describe "tabela (RN-176)"),
  `apps/web/src/components/ui/MarkdownMessage.test.tsx`
- **Origin:** real use on `exp001` — "a tabela dentro da mensagem do Mapa de
  Módulos do arquiteto tem que ficar bem estruturada em formato tabela,
  utilizar design system do próprio Brabo"

### RN-177 — The log shows everything, and the history collapses by ORIGIN {#rn-177}

The activity feed hid six event types (`tool.call`, `tool.result`,
`agent.response`, `agent.delta`, `agent.status`, `context.compacted`) **without
offering any alternative**: whoever wanted to see what the agent and the harness
exchange had to open the database. The filter remains, and remains
**off by default** — its reason has not changed (116 of 193 real events
were of these types, see `isMachineEvent`) —, but it became a **choice**: a
"Eventos de máquina" button on the same rail as the type chips.

Showing everything only solves half: a long session becomes a list nobody
goes through. That is why the **5 most recent stay open** and the rest goes into
collapses by **ORIGIN** — a NEW classification, which does not replace the
`ActivityKind`: `kind` says which SUBJECT the event talks about (commit, PR, permission)
and decides icon and color; `origem` says which LAYER it came from, and it is what makes the
history readable in handfuls. The six come from the data that exists — `actor.kind` and
the `type` prefix —, never from assumption:

| origin | what falls into it |
|---|---|
| `harness` | `tool.*`, `toolloop.*`, `agent.status`, `context.compacted` |
| `llm` | `agent.response`, `agent.delta`, `llm.*` |
| `usuario` | any event with `actor.kind === 'user'` |
| `sistema` | any event with `actor.kind === 'system'` |
| `agente` | remaining `agent.*`, `handoff.*`, `delegation.*`, an agent's `chat.*` |
| `eventos` | the domain event log (backlog, git, PR, artifact, bootstrap…) |

The **precedence** is what makes the classification predictable, and it is in the order of the
`if`s: mechanism (`harness`, `llm`) beats actor, because a `tool.call` belongs to the
harness whatever the actor; and actor beats agent prefix, because
`chat.message` exists on both sides and what distinguishes them is who spoke. A type that
nobody foresaw falls into `eventos` — it never disappears, never invents a category.

**The same rule holds in the session THREAD**, with the axis inverted: the thread is
ascending (the newest next to the composer), so the last 5 entries stay
open at the bottom and the collapsed history stays at the TOP. The cut is over the list
already grouped by agent ([RN-138](../business-rules.md#rn-138)) — what counts is what the user sees, and
a collapse of twelve messages is ONE entry on screen. **Revised in the thread by
[RN-644](../business-rules.md#rn-644):** there the cut counts only MESSAGES, goes back
to the opening of the turn and the history is ONE chronological block, not groups by
origin (which put the answer above the question). The log panel remains as
described here.

- **Where:** `apps/web/src/lib/activity.ts:94` (`OrigemDeEvento`), `:125`
  (`origemDoEvento`), `:152` (`agruparPorOrigem`);
  `apps/web/src/components/ActivityFeed.tsx:34` (the cut of 5), `:66` (the
  toggle); `apps/web/src/routes/session-fio.tsx:119` (the thread cut), `:291`
  (`dividirFio`); `apps/web/src/routes/SessionPage.tsx:516` (`fio`)
  toggle); `apps/web/src/routes/session-fio.tsx:119` (the thread cut), `:291`
  (`dividirFio`); `apps/web/src/routes/SessionPage.tsx:516` (`fio`)
- **Test:** `apps/web/src/lib/activity-origem.test.ts`,
  `apps/web/src/components/ActivityFeed.test.tsx` (describe "ordem,
  agrupamento e o toggle de máquina"),
  `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx` (describe
  "RN-177")
- **Origin:** real use on `exp001` — "em log de eventos mostrar também log do
  sistema, concentrar a mensagem em grupo, ou seja mantém as últimas 5
  mensagens mas abaixo vira o grupo de log de eventos, sistema, llm, harness,
  agente, usuário"

### RN-178 — The session panel reads from last to first, and the rules list paginates {#rn-178}

The four sections of the context panel (business rules, generated artifacts,
touched files and event log) were **ascending**: they opened at the start of the
session. In a session of thousands of events that delivers the wrong screen — whoever
opens the panel wants what just happened. All four became
**descending**, including inside the backlog tree ([RN-179](#rn-179)).

A consequence that came along: the feed's "Carregar mais antigos" button
([RN-099](../business-rules.md#rn-099)) **switched sides**. It was ABOVE the list because the list
was ascending and the past was at the top; with the order inverted the past is
at the end, and a button at the top would ask to scroll in the direction opposite to what it
loads — the same argument as before, with the sign flipped.

And **above 5 rules the list paginates**, instead of growing endlessly: the panel has
the width of one column and an ideation session goes past twenty rules
effortlessly. The current page is resolved by *clamp* (`min(pagina, total - 1)`) and
not by a synchronization effect: a new rule arriving through the poll lengthens the
list, and a `useEffect` would render once with the invalid page before
correcting it. With 5 or fewer, the paginator **does not exist** — a control that paginates
nothing is noise taking up height.

- **Where:** `apps/web/src/routes/ContextAside.tsx:109` (`REGRAS_POR_PAGINA`) and
  the ordering of the four sections in the same file;
  `apps/web/src/components/ActivityFeed.tsx:98` (the descending `sort`)
- **Test:** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  (describe "RN-178"), `apps/web/src/components/ActivityFeed.test.tsx`
- **Origin:** real use on `exp001` — "mostrar log de eventos, arquivos tocados
  e regras de negócio sempre em ordem do último para o primeiro de acordo com
  a data" and "caso as regras de negócio ficar acima de 5, deve-se paginar"

### RN-179 — The PO's artifact is a TREE: epic → story → task {#rn-179}

The "Artefatos gerados" panel ([RN-159](#rn-159)) listed epic and story side
by side, flat, and **ignored `backlog.task_created`** — precisely what a dev
agent picks up to work on. The three now form a tree, with the child
inside a collapse of the parent, and tasks are born CLOSED: an epic with thirty
tasks would take over the whole panel without anyone having asked.

The parentage comes from the **link the event already carries** —
`backlog.story_created` writes `epicId`, `backlog.task_created` writes `storyId`
—, never from proximity in the log. A node whose parent is not among the loaded events
**rises to the root** instead of being hung on the nearest epic: inventing
parentage is worse than showing the loose node, and a task whose story fell outside
the window is a normal case, not an error.

Each level remains a **link** to the Backlog, and the children's collapse
comes BELOW the line instead of inside the header — a `Disclosure` header is a
`<button>`, and an `<a>` inside a `<button>` is invalid HTML and an ambiguous
click target. The section header's counter counts the WHOLE tree, not only the
roots: saying "3" with eighteen tasks inside would be the same kind of number that
corresponds to nothing that [RN-151](#rn-151) removed from the sidebar.

- **Where:** `apps/web/src/lib/session-backlog-tree.ts:68`
  (`montarArvoreDeBacklog`), `apps/web/src/routes/ContextAside.tsx:210` (the
  roots become items), `:225` (the tree count)
- **Test:** `apps/web/src/routes/SessionPage.artefatos-gerados.test.tsx`
  (cases "épico/história/tarefa do PO viram árvore" and "nó sem pai carregado
  aparece na raiz")
- **Origin:** real use on `exp001` — "mostrar também as tarefas criadas no
  artefato do PO, mas abaixo do épico e ter opção de colapsar"

### RN-180 — The panel says what it is NOT showing {#rn-180}

`useSessionEvents` fetches `{ limit: 200, latest: true }`, and the context panel
read that slice through a prop. Consequence: in a session of thousands of events the
four sections showed the tail **as if it were the whole session** — a business
rule captured at the beginning of the ideation simply did not exist, without any
warning.

The panel started reading the same paginated history that the Overview's Activity
tab already used ([RN-099](../business-rules.md#rn-099)), with the tail's `queryKey`
shared with the thread — **zero extra requests** in the poll cycle
([RN-090](../business-rules.md#rn-090)/[RN-091](../business-rules.md#rn-091)). Two things changed with that:

1. **The feed gained the pager the component always had.** The props
   `onLoadOlder`/`hasOlder`/`loadingOlder` are optional since RN-099 and this
   call site never passed them — that was why the session lost its beginning
   silently.
2. **A note counts how many events are missing.** The number comes from SUBTRACTION over the
   `seq` (gapless and per session): `menor seq baixado − 1`. Never from one more
   request — the same mechanism as the bell's "+ N mais antigos"
   ([RN-100](../business-rules.md#rn-100)). Reaching the start of the session, the note **disappears**, instead
   of asserting a zero.

The derived sections read `baixados` (everything that has already come) and not `events` (the feed's
window of 100): they do not paginate item by item, and cutting them at the window would make them
show LESS than they showed before this change. It is the same button that
feeds both.

`pausarPoll` goes down through `useSessionEventHistory` to `useSessionEvents`, and it is not
a detail: the refetch interval belongs to each OBSERVER, not to the query. A
second observer of the same key with the timer on would resurrect the poll that the
screen pauses during the turn — and with it the visual duplicate of the bubble in
streaming.

- **Where:** `apps/web/src/lib/hooks.ts:262` (the history's `pausarPoll`),
  `:388` (`baixados`); `apps/web/src/routes/ContextAside.tsx:154`
  (`eventosAnteriores`) and the `ActivityFeed` with the pager, at the end of the same
  file
- **Test:** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  (describe "RN-180")
- **Origin:** review of the round itself — the ceiling of 200 existed silently in the
  four sections

### RN-181 — Area delegation appears in the thread {#rn-181}

When an area (QA, Infra) delegates to subagents and consolidates the verdict, the three
outcomes the lead records — `delegation.completed`, `delegation.failed` and
`delegation.dispensed` — only existed in the log panel. Whoever followed the
session saw the gate open and close **without any sign** that there was a second
attempt underneath.

The three are now narrated in the thread as a **compact notice**, in the format of
[RN-157](#rn-157) — not a bubble: it is a notification of what happened inside the area,
not an utterance. The SENTENCE comes from `classifyEvent`, the same as the panel's, because two
wordings of the same event diverge on the first payload change; and it already
names the subagent and the area, so the lead is **not** prefixed (it would produce "QA
Lead QA Automação concluiu a delegação (qa)").

The area's external contract **does not change** (ADR 0038): the thread does not start addressing
subagents, it only narrates what the lead has already recorded. The failure origin travels along
in `delegation.failed`, for the same reason as [RN-059](../business-rules/custo.md#rn-059) — it is what says
whether the next step is changing the key, waiting for the provider or opening a bug.

- **Where:** `apps/web/src/routes/session-timeline-montagem.tsx:754`
- **Test:** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  (describe "RN-181")
- **Origin:** real use on `exp001` — "quando houver uma nova tentativa e
  consolidação de algum agente deve apresentar no chat"

### RN-182 — The theme is chosen, persisted and applied before the first paint {#rn-182}

The light theme exists in `design/tokens.css` since the beginning, under
`[data-theme='light']`, and **nothing in `apps/web` wrote that attribute**: the
only way to see the light theme was to type the attribute in DevTools. It now becomes
reachable.

The preference lives in `localStorage['brabo.theme']`, accepts **only** `'dark'` or
`'light'`, and the default is `dark` — the design system's primary theme. What applies it
is `apps/web/public/theme-boot.js`, **synchronous in the `<head>` and before the bundle**:
`data-theme` decides the colors of the whole `tokens.css`, and applying it after
hydration would make the light-theme user see a dark flash on every load.

It is a **file, not an inline script**, and the reason is the same that made the fonts
self-hosted (ADR 0036): the production image serves under `script-src 'self'`
(`docker/web/nginx.conf`), without `'unsafe-inline'` and without a nonce. Inline
would work in `pnpm dev:web` and would be **blocked in the published image** — the
worst failure mode possible, because it only shows up after the deploy.

The whole path degrades instead of breaking: `localStorage` can throw (private
mode, storage blocked in an iframe) and theme is a preference, not a function; an unknown
value falls to the default instead of becoming a `data-theme` that the CSS does not
know and that would render with no theme at all.

- **Where:** `apps/web/public/theme-boot.js:41`,
  `apps/web/index.html:53`
- **Test:** `apps/web/src/lib/tema.test.ts` (describe "contrato com o script
  de boot")
- **ADR:** [0074](../adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-183 — The theme preference has one source, and the `<html>` attribute is the truth {#rn-183}

Reading, writing, toggling and observing the theme is `apps/web/src/lib/tema.ts` — the button
lives in the shell and consumes that API, it never writes `data-theme` on its own.

Three decisions inside it:

1. **`temaAtual()` reads the ATTRIBUTE first**, and only then `localStorage` and the
   default. The attribute is what the screen is showing; falling back to the stored preference
   before it would make the UI assert a theme different from what is seen, in the exact case
   where the boot failed.
2. **`lerTemaSalvo()` returns `null`, not the default**, when there is no stored
   preference. Whoever never chose may one day follow the operating system
   (`prefers-color-scheme`), and erasing that distinction here would take the information away
   from whoever decides that later.
3. **`observarTema()` covers the `storage` event**, which the browser fires in the
   OTHER tabs of the same origin. Without it two open tabs would stay in
   different themes until the next reload.

The key and the default are repeated in `public/theme-boot.js` because it runs
before the bundle and cannot import anything. It is the only duplication able to
diverge silently, and that is why the test reads the boot file and fails if the
two stop matching.

- **Where:** `apps/web/src/lib/tema.ts:73`
- **Test:** `apps/web/src/lib/tema.test.ts`
- **ADR:** [0074](../adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-184 — Contrast is measured in BOTH themes {#rn-184}

While the light theme was unreachable ([RN-182](#rn-182)), measuring only the dark one
was honest: measuring a screen nobody can open is measuring an intention. With the
theme button, no longer measuring the light one would hide half of the product's visible
surface — so the pairs are now enforced in both themes, with the
same floor (4.5:1 for text, 3:1 for interface elements).

For that, **six light-theme tokens changed value**. The most
demanding background of the light theme is `--code-bg` (paper, `#efe4d2`, one step away from the
surfaces), and whatever passes against it passes against the rest: `--accent`
3.56 → 4.81, `--warning` 3.15 → 4.98, `--success` 3.89 → 5.12, `--violet`
4.16 → 4.95, `--text-muted` 2.76 → 5.17, and `--accent-hover` followed the accent one
step below. The dark theme **did not change a single value**, and its known debt
remained locked by the same five numbers (3.89 / 3.10 / 3.88 / 3.88 / 4.41)
until [RN-640](../business-rules.md#rn-640) (ADR 0181), which closed it with the
neutral palette and turned it into a floor.

The light theme's `--text-muted` was not debt: at 2.40:1 over `--surface-2` it
failed even the **interface element** floor, which is the lowest that
exists. It was a defect, and the light theme has no reason to be worse than the primary one.

- **Where:** `design/tokens.css:208`
- **Test:** `apps/web/src/lib/contraste.test.ts`,
  `apps/web/src/design-contraste.test.ts`,
  `apps/web/test/design-contraste.test.ts`
- **ADR:** [0074](../adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-185 — The eight syntax roles, and the handoff's value only comes in measured {#rn-185}

The highlighting palette was three tokens of its own (`--syntax-function`,
`--syntax-comment`, `--syntax-operator`) and five reuses of semantic ones
(`--accent`, `--warning`, `--violet`, `--success`, `--text-primary`). It is this
reuse that made the palette measured only in the dark theme: in the light one the semantic tokens
failed against the paper `--code-bg`.

It now has the handoff's **eight roles**, with the `--syntax-*` prefix the
repository already uses, and each with its own value per theme. Naming the eight is
what lets highlighting diverge from the semantic tokens on the day it needs to.

**The handoff's value only comes in when the measurement approves.** Against the handoff's own
`--code-bg`, five of the eight fail the 4.5:1 that code text
requires — `--syn-cm` 4.09:1 in dark and 2.32:1 in light, `--syn-kw` 4.34:1,
`--syn-str` 4.20:1, `--syn-fn` 4.14:1, `--syn-op` 4.00:1. Where the handoff
fails, the measured number holds: it is the same rule as ADR 0036 — the handoff's intention
holds, the mechanism (or the number) that breaks the product does not.

The five semantic tokens are still what paints (`SyntaxTokens.module.css` did not
change in this delivery) and that is why they are **measured alongside** the eight: as long as they
are the real pixel, the floor is enforced on them. In the light theme each
role today has the SAME number as the semantic token that paints it, on purpose — two
sources with different numbers for the same pixel would diverge on the first
fix made on one side only.

- **Where:** `design/tokens.css:111`
- **Test:** `apps/web/src/lib/contraste.test.ts` (describe "contraste — paleta
  de sintaxe sobre --code-bg")
- **ADR:** [0074](../adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-195 — The sidebar collapses into an icon rail, with the preference persisted {#rn-195}

`Shell.tsx` had a fixed width (248px) and no way to shrink. It now
toggles between `--sidebar-w` (264px) and `--sidebar-w-collapsed` (62px) — the
two tokens that Onda 1/frente A had already created in `design/tokens.css` —
with `transition: width .18s ease`. Collapsed, it becomes a vertical rail: a
square of initials per project (border in the identity color,
[RN-197](#rn-197)) plus an Activities icon; clicking a project in the
rail re-expands the bar, opens that project and navigates to it.

The preference belongs to the user and survives a reload: `brabo.sidebar.collapsed`
(`'1'`/`'0'`) in `apps/web/src/lib/sidebar-state.ts`. It is **manual only**
(`colapsadoManual`): there was a second, **automatic** state
(`autoColapsado`), ORed in by the Code tab, and it was removed by
[ADR 0126](../adr/0126-trilho-vertical-de-navegacao-do-projeto.md) — see
[RN-201](#rn-201). No screen collapses the sidebar on its own; what is
seen collapsed was requested by the user, and is stored.

- **Where:** `apps/web/src/routes/Shell.tsx:340-351` (state and toggle),
  `apps/web/src/routes/Shell.module.css` (`.sidebar`, `.colapsado .sidebar`,
  `.trilha*`), `apps/web/src/lib/sidebar-state.ts`
  (`lerColapsado`/`gravarColapsado`)
- **Test:** `apps/web/src/lib/sidebar-state.test.ts` (describe "colapso"),
  `apps/web/src/routes/Shell.test.tsx`
- **Origin:** PROGRAMA 28, Onda 2, frente B —
  `design_handoff_brabo/README.md` section "Navigation shell"

### RN-196 — Expandable projects reveal the project's tabs, N at the same time {#rn-196}

Each project in the sidebar gets a chevron: clicking it expands the row and
reveals that project's tab list (Visão geral, Executores, Criativo,
Chat, Code, Backlog, Aprovações, Insights, Gastos, Configurações), each one
a link to `/projects/$projectId?tab=<chave>`. Several projects can stay
open at the same time — the state is a `Set<string>` of ids, persisted in
`brabo.sidebar.open`.

The tab list and the labels come from `ABAS_DO_PROJETO`
(`apps/web/src/routes/project-tabs.ts`, owned by frente C, running in
parallel in this same wave) — the sidebar only **reads** the exported array, it never
rewrites tab names. **Shape assumption**, to be checked against what
frente C delivered: `AbaDoProjeto` has `key: string`, `label: string` and
`count?: (contagens: ContagensDeAba) => number | undefined`, with
`ContagensDeAba = { promocoesPendentes, aprovacoesPendentes,
hipotesesPendentes }`. The sidebar can only fill
`aprovacoesPendentes` for free (`pendingApprovalsCount` already comes in the
dashboard summary, [RN-151](#rn-151)); `promocoesPendentes`/`hipotesesPendentes`
come in as `0` — computing them would require a new query PER PROJECT
OPEN in the sidebar, the same class of N+1 that RN-090/091 closed in the
dashboard. The two badges remain correct within the rule of
`ProjectPage` itself; only the preview in the sidebar is partial, and it is a deliberate
omission, not a bug.

The project of the CURRENT route always appears expanded (`projetosAbertosEfetivo`),
even without being in the persisted `Set` — opening "for free" through the route writes
nothing; only the explicit click on the chevron goes into `brabo.sidebar.open`.

**Since [ADR 0211](../adr/0211-uma-navegacao-so-a-sidebar-absorve-o-trilho.md)
(AT-404) this list is the project's ONLY navigation:** the vertical rail left and
it received everything only the rail had — the three groups with headers, the active
tab marked, the vertical `tablist` named by the project, the keyboard
(`ArrowDown`/`ArrowUp`/`Home`/`End` with wraparound, crossing groups) and the FIVE
counters, each on its own tab and never summed. The deliberate omission above
still holds for a CLOSED project and for the project open outside the frame
(in the Session, for example): only Approvals, from the summary. With the project frame
mounted, the five numbers come from the SAME hook it uses
(`useContagensDoProjeto`), without a new request. Collapsed, the square of the
open project opens a flyout with the same tabs.

- **Where:** `apps/web/src/routes/Shell.tsx:557` (`projetosAbertosEfetivo`),
  `:505` (`useContagensDoProjeto`), `:512` (`irParaAba`), `:527`
  (`flyoutAberto`), `:215` (`contagensDoResumo`);
  `apps/web/src/routes/AbasDoProjeto.tsx:78` (`AbasDoProjeto`), `:34`
  (`itensDasAbas`), `:95` (`aoTeclar`);
  `apps/web/src/lib/contagens-do-projeto.ts:22` (`useContagensDoProjeto`),
  `:70` (`publicarAbaAtiva`), `:86` (`pedirAba`);
  `apps/web/src/lib/sidebar-state.ts` (`lerProjetosAbertos`/`gravarProjetosAbertos`)
- **Test:** `apps/web/src/lib/sidebar-state.test.ts` (describe "conjuntos"),
  `apps/web/src/routes/Shell.test.tsx` (describe "Shell — abas do projeto
  aberto (ADR 0211)": the 12 tabs, the five separate counters, the active one, the
  click and the arrow navigating, the collapsed flyout, the drawer on the phone and the failure
  case — without the frame mounted, only the summary's number),
  `apps/web/src/routes/AbasDoProjeto.test.tsx` (groups, active, counters,
  keyboard, roving tabindex, link per project), `apps/web/src/routes/project-tabs.test.tsx`
- **Origin:** PROGRAMA 28, Onda 2, frente B; ADR 0211 (AT-404)

### RN-197 — Two project colors, two purposes: identity is not status {#rn-197}

The handoff asks for a "project color dot" on the expanded row and the same
color principle on the collapsed rail. The product already had a dot there —
`NavStatusDot` — but it is **status** (budget/recent activity,
derived without its own query from `useProjectsSummary`/`useProjectsStatus`,
RN-039), not identity: its color CHANGES over time.

Decision, documented instead of resolved: the expanded row keeps
showing only `NavStatusDot` (it is actionable information; duplicating a second
dot next to it would be noise). The IDENTITY color — stable per project, a
deterministic hash of the id over a fixed palette of tokens (`corDoProjeto`,
no new table, the same idea as `AGENTS[key].color`) — appears only on the
collapsed rail, as the border of the initials square, which is where there is no
room for the two dots and where identity (not status) is what helps to
find the right project among several similar squares.

In the same way, the handoff asks for a "badge with the total of last iterations" on the
project; the product uses `pendingApprovalsCount` since RN-151, which is
later than the handoff and fixes a real defect (a number that did not
correspond to anything actionable when clicked). This badge **does not change** — RN-151
remains in force, and it is the handoff that diverges here.

- **Where:** `apps/web/src/lib/sidebar-state.ts` (`corDoProjeto`),
  `apps/web/src/routes/Shell.tsx` (`NavStatusDot`, comment on the divergence)
- **Test:** `apps/web/src/lib/sidebar-state.test.ts` (describe "corDoProjeto")
- **Origin:** PROGRAMA 28, Onda 2, frente B — divergence between
  `design_handoff_brabo/CHECKLIST-CONFRONTO.md` and RN-151

### RN-198 — Activities groups by REAL base agent/instance, never by an invented counter {#rn-198}

The sidebar's Activities section is the same grouping logic as
`AgentTimelineTree.tsx`/`timeline-tree.ts` (already used in the project's
Overview), moved to a new place — not rewritten. `montarArvore` already
groups by `evento.actor.id`; the novelty is `agruparPorInstancia`
(`apps/web/src/lib/timeline-tree.ts`), which decides which branches form a
two-level visual group.

The "instance" is not a renumbered counter (`-01`/`-02`) — it is the REAL
`agent_id` the product already writes: `devAgentId`/`extraDevAgentId`
(`apps/api/src/application/use-cases/execution/activate-execution.use-case.ts:27-38`)
produce `dev-<modulo>` and `dev-<modulo>-2` (suffix always exactly `-2`,
because the ceiling is TWO per module, [RN-154](#rn-154)). A branch only becomes an
"extra instance" of another if the base agent (without the suffix) ALSO has a
branch in the same list — otherwise it is the agent itself. An agent with one instance
opens directly on the events; with two, it reveals a second level, one row per
instance, each with its own count — reusing
`getAgentLastSeenSeq`/`setAgentLastSeenSeq` (`read-state.ts`) which already existed
for the tree's novelty counter.

Scope: only the project of the CURRENT ROUTE (`pathname`), not all projects of the
workspace — aggregating all would require an events query PER project, the
same class of N+1 that RN-090/091 closed in the dashboard. It reuses the SAME pair
of hooks that `AgentTimelineTree`/`SessionPage` already use
(`useActiveExecutionSession` + `useSessionEvents`, same `queryKey`) — zero
new requests when the two screens are mounted together.

What opens/closes is persisted in `brabo.sidebar.agents`, with the handoff's
format adapted to the real ids: `agenteBase` (open group, e.g.:
`dev-backend`) or `${agenteBase}/${instancia}` (a specific instance
open, e.g.: `dev-backend/dev-backend-2`).

- **Where:** `apps/web/src/lib/timeline-tree.ts` (`agruparPorInstancia`,
  `GrupoDeAgente`), `apps/web/src/routes/Shell.tsx:237-311`
  (`GrupoDeAtividade`, `InstanciaDeAgente`), `apps/web/src/routes/Shell.tsx:376-399`
  (scope and persistence)
- **Test:** `apps/web/src/lib/timeline-tree.test.ts` (describe
  "agruparPorInstancia"), `apps/web/src/lib/sidebar-state.test.ts`
- **Origin:** PROGRAMA 28, Onda 1/frente B0 (finding, no code) and Onda
  2/frente B (implementation)

### RN-199 — Theme button in the footer, functional when collapsed {#rn-199}

The sidebar footer gets a sun/moon button that consumes the API of
`apps/web/src/lib/tema.ts` from Onda 1/frente A (`temaAtual`,
`alternarTema`, `observarTema`) without reimplementing anything — only the BUTTON is new.
It works collapsed (62px): the text label disappears, but `aria-label`/`title`
keep describing the current theme and the click keeps toggling.

- **Where:** `apps/web/src/routes/Shell.tsx:130-148` (`BotaoDeTema`)
- **Test:** `apps/web/src/lib/tema.test.ts` (the API, unchanged by this RN)
  — `Shell.test.tsx` does not duplicate the theme suite, it only mounts the Shell
- **Origin:** PROGRAMA 28, Onda 2, frente B

### RN-200 — Only Projects and Activities as global items {#rn-200}

The two route-less items of the nav footer ("Chat global"/"Configurações",
`title="em breve"`) are removed. The handoff is explicit: only Projects and Activities
are GLOBAL items — everything else is scoped to a project. "Configurações"
still exists, as a project TAB ([RN-196](#rn-196)) inside the expanded
row — what goes away is the loose item with no destination.

- **Where:** `apps/web/src/routes/Shell.tsx` (the `.globalNav`/
  `.inertNavItem` block from FASE 17a was removed, with no global replacement)
- **Test:** `apps/web/src/routes/Shell.test.tsx` (describe "sem itens
  globais inertes")
- **Origin:** PROGRAMA 28, Onda 2, frente B —
  `design_handoff_brabo/README.md` section "Navigation shell"

### RN-201 — Active project/tab persist across pages; the sidebar collapse is ONLY the user's {#rn-201}

Two final handoff keys: `brabo.project` (the active project) and
`brabo.tab` (the active tab) — written when the user clicks a tab link
IN THE SIDEBAR (`LinhaDeAba`/the project name link). `?tab=` in the URL only counts
as an INITIAL deep link (`project-tabs.ts`, FASE 24) — switching tabs inside
`ProjectPage.tsx` is local state and does not write to the URL after the
first load, so these keys are the only way for the preference to
survive from one navigation to another. **This half never changed.**

**The Code tab's auto-collapse LEFT (ADR 0126).** Until then the Code
tab collapsed the sidebar by itself to give width to the editor, without writing a
preference: `AutoCollapseContext`/`useAutoCollapseSidebar` in
`sidebar-state.ts`, registered by `ProjectCodeTab.tsx` (the only
caller) and ORed with the manual collapse inside the `Shell`. The context,
the hook, the `autoColapsado` state, the `Provider` around `<Outlet />` and the
`disabled` of the collapse button — which existed only to protect that path
— were all removed.

The reason is structural: with the project's vertical rail
(`routes/ProjectRail.tsx`, removed in ADR 0211) always present, keeping the auto-collapse would put the
Shell's icon rail right against the project rail — TWO adjacent, permanent
vertical rails, on the heaviest tab of the product.

What now holds: **the sidebar collapse is a decision of the USER, and only
theirs.** It stays manual, stays persisted in `brabo.sidebar.collapsed`
([RN-195](#rn-195)), and no screen collapses the sidebar on its own.

**The cost, accepted and declared:** the Code tab now opens with the sidebar
EXPANDED (264px) + the project rail (180px) + the rail of the
`CodeShell` itself (48px) — 492px of frame before the first character of code,
MEASURED in the browser, against ~110px before (62px of collapsed sidebar + 48px
of the Code rail). Collapsing manually remains possible and
still produces the Shell rail next to the project rail — the difference is
that now it was the user who chose, not the system.

**Revised by [ADR 0211](../adr/0211-uma-navegacao-so-a-sidebar-absorve-o-trilho.md)
(AT-404):** the project rail left, and the Code tab frame became
**312px** with the sidebar expanded (264 + 48 of the `CodeShell`) and **110px**
collapsed (62 + 48) — with no double rail in either case. The collapse
remains the user's only. The active tab the sidebar marks comes from the project
frame (`publicarAbaAtiva`), not only from `brabo.tab`.

- **Where:** `apps/web/src/lib/sidebar-state.ts:80-105`
  (`lerProjetoAtivo`/`gravarProjetoAtivo`, `lerAbaAtiva`/`gravarAbaAtiva`, and
  the comment recording the removal), `apps/web/src/routes/Shell.tsx:366-369`
  (only `colapsadoManual` is left), `apps/web/src/routes/ProjectCodeTab.tsx`
  (no collapse call)
- **Test:** `apps/web/src/lib/sidebar-state.test.ts` (describe "projeto e
  aba ativos"), `apps/web/src/routes/Shell.test.tsx` (describe "Shell —
  colapso da sidebar": the preference is only born from a click on the button and is always
  written). The "useAutoCollapseSidebar" describe was removed together with the
  hook.
- **Origin:** PROGRAMA 28, Onda 2, frente B —
  `design_handoff_brabo/CHECKLIST-CONFRONTO.md` section 1; the auto-collapse
  half was revised by
  [ADR 0126](../adr/0126-trilho-vertical-de-navegacao-do-projeto.md)
### RN-202 — The `sessions` tab stays "Chat", never "Chat RAG" {#rn-202}

The most recent design handoff of PROGRAMA 28 calls the consultative tab
"Chat RAG" (`designs/Brabo Chat.dc.html`), but the product does not have that
functionality: there is no per-project indexing pipeline, no vector
index, no source citation UI. ADR 0075 put `embed` in the
`LLMProvider` contract — the operation exists and is PROVEN on Ollama —, but nothing
CONSUMES it yet. Today's `sessions` tab is the ordinary consultative Chat of
[RN-104](../business-rules.md#rn-104): an agent answering with the session context, without
producing backlog, with no RAG at all behind it.

Labeling the tab "Chat RAG" today would announce a capability that does not exist — the
same mistake that [ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
already refuses for a catalog model ("não ativar modelo descoberto
automaticamente"). The label changes on the day the functionality arrives, together
with the data behind it — never before.

- **Where:** `apps/web/src/routes/project-tabs.ts:144` (entry `key:
  'sessions'`)
- **Test:** `apps/web/src/routes/project-tabs.test.tsx` (describe "abas do
  projeto derivam de um registro só", `'RN-202 — a aba \`sessions\` continua
  "Chat", nunca "Chat RAG"'`)
- **ADR:** [0078](../adr/0078-moldura-de-tela-e-o-registro-de-abas-diverge-do-handoff.md)

### RN-203 — The handoff is a visual reference, not a ceiling on how many tabs the product has {#rn-203}

The design handoff lists 7 project tabs (Visão geral, Criativo, Código,
Chat RAG, Gastos, Aprovações, Configurações); the registry
(`apps/web/src/routes/project-tabs.ts`) has 10. The three extra ones —
`executores` ([RN-121](../business-rules.md#rn-121)), `backlog` ([RN-048](../business-rules/custo.md#rn-048)) and
`insights` (the Psicólogo's hypotheses awaiting a decision) — were born AFTER the
handoff was designed, all with real data, a counter derived from a query and
at least one RN of their own with a test.

The handoff fixes how each screen should LOOK — colors, typography,
spacing, the design of the frame —, and that part was followed to the letter in this
same change (header, ruler, scrolling, content width). It does not freeze the
tab inventory on the day it was written. Deleting the three to "match"
the handoff would destroy information the product already knew how to show, for the
wrong reason.

- **Where:** `apps/web/src/routes/project-tabs.ts:91` (the `REGISTRO`)
- **Test:** `apps/web/src/routes/project-tabs.test.tsx` (describe "abas do
  projeto derivam de um registro só", `'RN-203 — as 3 abas que o handoff não
  previu continuam no registro'`)
- **ADR:** [0078](../adr/0078-moldura-de-tela-e-o-registro-de-abas-diverge-do-handoff.md)
### RN-210 — "Recommended" is real usage and cost, never a computed score {#rn-210}

The "Melhores modelos por capacidade" block (Settings) has no score
column. The handoff shows a score per capability (code 9.4, image 9.1…), but
it is FICTITIOUS mock data — no provider publishes "code quality" and the
product does not measure that anywhere. Computing a number here would be the same
"guess dressed up as data" that [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)
forbids for MODEL capability, now about quality.

Instead, "recomendado"/"alternativa" come from two real signals, among the
models THIS workspace's curation marked for that capability (`uses`,
[RN-057](../business-rules/custo.md#rn-057)): first the ones most used by agents of THIS project — the
same cascade that resolves the current binding of each agent —, cost (from the
catalog, ascending) as tiebreaker. "What the team has already chosen" is the most
honest signal available without inventing a score. A capability with no curated model
shows "sem cobertura curada" — it never hides the row, the same pattern that the
Origin column of `ModelsSection` already uses for the skipped binding.

- **Where:** `apps/web/src/routes/settings/MelhoresModelosPorCapacidadeSection.tsx`
- **Test:** `apps/web/src/routes/ProjectSettingsTab.test.tsx`
  (describe "MelhoresModelosPorCapacidadeSection")
- **ADR:** [0077](../adr/0077-ranking-de-modelos-por-capacidade-sem-nota-inventada.md)

### RN-211 — Spending per provider on screen is a Ranking, not an invented categorical palette {#rn-211}

The handoff asks for daily bars stacked by provider and a breakdown by
provider. The repository's dataviz skill requires validating a categorical
palette by script before using it, never by eye: `validate_palette.js`
fails every combination of 3+ tokens from `design/tokens.css` against at
least one of the two themes — `--accent`+`--violet` is the only pair that passes
in both (several `--syntax-*` are literally the same hex as
`--warning`/`--violet`/`--success`, measured). With 9 providers (ADR 0043) and
2 validated colors, cycling the palette is the anti-pattern the skill itself
names ("a 9th series is never a generated hue"), and inventing a new hex
would violate this frente's instruction. The breakdown by provider becomes a `Ranking` —
the same piece as "Por modelo"/"Por projeto"/"Por agente e pessoa", without
identity by color. The DAILY series per provider is not delivered:
`sumGroupedBy` (ADR 0076) groups by one dimension at a time, and there is no
cross aggregation day×provider in this wave's backend.

- **Where:** `apps/web/src/lib/spend.ts` ("Gasto por PROVIDER na
  tela" block), `apps/web/src/routes/ProjectSpendTab.tsx` (`GastoDoWorkspace`)
- **Test:** `apps/web/src/routes/ProjectSpendTab.test.tsx` (describe "a
  audiência do owner" — `'mostra os cinco recortes do workspace,
  incluindo provider'`)
- **ADR:** [0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-212 — The "per project" block is the TokenMeter plugged into the real budget {#rn-212}

The Spending tab gains a block per PROJECT (not per audience):
`OrcamentoDoProjeto` reads `GET /projects/:id/budget` and plants the result
directly into the existing `TokenMeter`, which already implements the 70/90 thresholds
(`tokenThreshold`) — no new component. Three readings: loading
(silent, avoids flashing before the role resolves the audience below),
no budget defined (a text note, no CTA) and error (silent — in
practice almost always a 403 from someone who has a WORKSPACE role but is not
`maintainer` on the PROJECT, and showing a banner on purpose would be a false alarm
for most members, the same pattern already used by the compact `TokenMeter`
of `ProjectPage.tsx`).

- **Where:** `apps/web/src/routes/ProjectSpendTab.tsx`
  (`OrcamentoDoProjeto`)
- **Test:** `apps/web/src/routes/ProjectSpendTab.test.tsx` (describe "o
  orçamento do projeto")

### RN-213 — The cost alert is a read of `lastThresholdNotified`, never a recomputation {#rn-213}

`alertaDeOrcamento` does not reimplement `crossedThresholds`
(`apps/api/src/domain/llm/budget-threshold.ts`): it reads the field the backend
already writes at the moment a real call crosses 70/90/100%, and only decides
the color (`warning` below 90, `danger` from 90 on) and whether the text should
warn of an active block (`policy === 'block' && spentMicros >=
limitMicros`). No new business rule — purely presentation of
data that already exists.

- **Where:** `apps/web/src/lib/spend.ts` (`alertaDeOrcamento`)
- **Test:** `apps/web/src/lib/spend.test.ts` (describe "alertaDeOrcamento
  (RN-213)"); `apps/web/src/routes/ProjectSpendTab.test.tsx` (describe "o
  orçamento do projeto")

### RN-214 — The local-model savings KPI is left out for lack of a counterfactual price {#rn-214}

`TokenMeter` already has `savingsBRL`/`savingsPct` ready to receive the
number, and they remain unfed on purpose. The card would require a
COUNTERFACTUAL price — how much the same call would have cost on a paid
model — that does not exist anywhere in the product: the catalog (ADR 0042)
only freezes the price of the model ACTUALLY used (RN-044), and there is no
declared mapping "local model X ~ paid model Y". Inventing it here
would be the same class of "score dressed up as data" that RN-210 already refused
for the capability ranking. Gap recorded in the backlog for when
a defensible and versioned counterfactual price exists.

- **Where:** `apps/web/src/routes/ProjectSpendTab.tsx` (comment "KPI de
  economia com modelos locais — CORTE DECLARADO", end of the file)

### RN-215 — The Problems tab is born with an honest empty state {#rn-215}

There is no integrated lint or test over the managed project's code; the bottom panel's
Problems tab (handoff `design_handoff_brabo`) says so
explicitly instead of showing an invented count (the handoff mock has a
"3" badge). The same pattern already used by the Terminal (FASE 25b) and by the disabled
"Testes" item of the rail.

- **Where:** `apps/web/src/routes/code/CodeBottomPanel.tsx`
- **Test:** `apps/web/src/routes/code/CodeBottomPanel.test.tsx` —
  "Problemas diz honestamente que não há lint/teste integrado, sem
  contagem inventada"

### RN-216 — The Output tab is born with an honest empty state {#rn-216}

There is no build/deploy command stream in this tab — it would depend on the
interactive terminal (FASE 25b), which does not exist. The tab explains this and reminds
that `git push`/PR/deploy do not go out through the terminal in any case (RN-106).

- **Where:** `apps/web/src/routes/code/CodeBottomPanel.tsx`
- **Test:** `apps/web/src/routes/code/CodeBottomPanel.test.tsx` — "Saída
  diz honestamente que não há stream de comando, sem simular execução"

### RN-217 — The Code tab status bar only shows real data {#rn-217}

The 24px status bar (`CodeShell.tsx`) shows `↑N ↓M` commits of the current
branch (via `getCodeBranches`, the same `queryKey` as `CodeBranchPicker` —
dedup, zero extra requests, RN-090/091) and the language of the active file
(`linguagemPorCaminho`). Cursor position and the error/test count of the
handoff mock were left out: `CodeEditor` does not expose a trackable selection/caret
and there is no integrated lint/test (the same decision as RN-215).

- **Where:** `apps/web/src/routes/code/CodeShell.tsx`
- **Test:** `apps/web/src/routes/code/CodeShell.test.tsx` — "a status bar
  mostra ↑/↓ real da branch atual" and "sem ahead/behind (branch em dia), a
  status bar não mostra o par vazio"

### RN-218 — Visible focus on the bottom panel's own tabs {#rn-218}

The tabs of `CodeBottomPanel.tsx` are a custom implementation (not the design
system's `Tabs`) and did not inherit the calibrated `:focus-visible` that
`Tabs.module.css` gained in Onda 2/frente C. Fixed with the same pattern as
`Input.module.css` (ADR 0036), including `forced-colors`.

- **Where:** `apps/web/src/routes/code/CodeBottomPanel.module.css`

### RN-219 — The three scopes of the chunk index are honest, and mutually exclusive by CHECK {#rn-219}

The Chat RAG index covers only three text sources whose origin the product already
knows: `docs`, `adr` and `session`. Source code and Pull Requests are left
out on purpose — indexing them without a reindexing watcher on every
`push` would make the index lie about coverage, the same class of error that
ADR 0042 already refuses for model capability. `session_id`/`source_path`
are mutually exclusive by CHECK, not by application convention, the same
pattern as `projects.workspace_mode`/`workspace_path` (ADR 0072): `scope =
'session'` requires `session_id` and refuses `source_path`; `docs`/`adr` require
`source_path` and refuse `session_id`. The lock stays in the database because whoever will
write this table is a pipeline (Onda 4) that does not necessarily go through
the same use case every time.

- **Where:** `apps/api/src/db/schema/rag.ts` (`chunkScopeEnum` and the two CHECKs
  of the `chunks` table)
- **Test:** `apps/api/test/infrastructure/persistence/chunk.repository.spec.ts`
  ("recusa chunk de docs sem source_path — o CHECK da migração 0045, não
  validação de aplicação")
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-220 — Vector and lexical search live on the same row, never in separate tables {#rn-220}

`chunks.embedding` (pgvector) and `chunks.search_vector` (tsvector) are
sibling columns of the SAME table, not two tables linked by `chunk_id`.
Separating them would require a JOIN on every hybrid search (Onda 4) and would open room
for the two to diverge — a passage with a vector but no lexical entry, or
vice versa — with no database mechanism preventing it. One row, one source
of truth for both halves of the search.

- **Where:** `apps/api/src/db/schema/rag.ts` (`chunks` table)
- **Test:** `apps/api/test/infrastructure/persistence/chunk.repository.spec.ts`
  (the three specs write and read both columns on the same row)
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-221 — `search_vector` is never written by the application — it is a GENERATED column {#rn-221}

`search_vector` is `GENERATED ALWAYS AS (to_tsvector('portuguese', content))
STORED`. No use case, repository or script writes to it —
Postgres keeps it consistent with `content` by construction, ready in the same
transaction as the `INSERT`, without depending on any LLM provider answering
(unlike `embedding`, which only arrives when an indexing pipeline
exists).

- **Where:** `apps/api/src/db/schema/rag.ts` (`search_vector` column)
- **Test:** `apps/api/test/infrastructure/persistence/chunk.repository.spec.ts`
  ("grava um chunk de docs com vetor e devolve o search_vector gerado pela
  GENERATED ALWAYS AS")
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-222 — The vector dimension is documented, not guessed, and `embedding` arrives after the chunk {#rn-222}

`chunks.embedding` is `vector(768)` — the real dimension of Ollama's
`nomic-embed-text`, the only provider that today declares `capabilities.embeddings:
true` (RN-191, ADR 0075). A vector index has a FIXED dimension: changing the
embedding model in the future is a new migration, never a runtime parameter.
The column is NULLABLE: this table stores the CHUNK (cut text), and the
VECTOR may arrive later via an asynchronous indexing pipeline that does not
exist yet (Onda 4) — without that, chunking would have to wait for embedding,
mixing two failures of different nature (document parsing versus a
network call to a provider) in a single atomic write.

- **Where:** `apps/api/src/db/schema/rag.ts` (`embedding` column)
- **Test:** `apps/api/test/infrastructure/persistence/chunk.repository.spec.ts`
  ("grava um chunk de docs com vetor..." writes with `embedding` filled;
  the other two specs write without it, confirming nullability)
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md); [RN-191](../business-rules/custo.md#rn-191)

### RN-223 — The vector index is HNSW, not IVFFlat, because the table is born empty {#rn-223}

IVFFlat needs rows already loaded to train the lists (`lists`) and
performs poorly if built over an empty table — which is exactly the state
of this table at birth, with no indexing pipeline yet (Onda 4). HNSW
builds the graph incrementally, insertion by insertion, with no training
step — good from the first row. `vector_cosine_ops` because it is the
metric text embeddings generally expect (the similarity
ranking should not change with the vector's magnitude).

- **Where:** `apps/api/src/db/migrations/0045_shallow_randall.sql`
  (`chunks_embedding_idx`)
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-224 — The migration creates the pgvector extension by itself, idempotently {#rn-224}

The `0045` migration runs `CREATE EXTENSION IF NOT EXISTS vector` before
creating the table, instead of assuming `docker/postgres/init.sql` has already run —
that file only executes on the FIRST initialization of the Postgres volume, and an
environment with an old volume may not have the extension. `IF NOT EXISTS` is
idempotent: local (where the extension was already installed) and a new
environment go through the same line with no difference in behavior.

- **Where:** `apps/api/src/db/migrations/0045_shallow_randall.sql`
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-225 — A migration that may require operator privilege is born in `breaking/` {#rn-225}

Creating an extension requires the application role to have `CREATEDB` (or the
extension to be marked "trusted" by the DBA). Locally the role is a
superuser, but nothing guarantees that in production — managed Postgres
providers often do not give superuser to the application. If
the migration fails there, it is an OPERATOR action before the deploy (running `CREATE
EXTENSION vector;` once, as superuser), not a product bug — the
CLAUDE.md criterion for being born in `breaking/` instead of
`feature/`/`bugfix/`.

- **Where:** branch `breaking/tabela-de-chunks`,
  `apps/api/src/db/migrations/0045_shallow_randall.sql` (a comment that
  documents the decision inside the migration itself)
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-226 — `ChunkRepository` covers only basic write/read; `createMany` is a batch operation {#rn-226}

The port only has `create`, `createMany`, `findById` and `listByProject` — hybrid
search (vector + lexical, weights, threshold) belongs to Onda 4 (G2) and deliberately
does NOT come in here: the port stores data, the use case decides what to do with
it. `createMany` exists because an indexing cuts N passages of a
document/session at once, avoiding N round trips per indexed
document.

- **Where:** `apps/api/src/application/ports/chunk-repository.port.ts`,
  `apps/api/src/infrastructure/persistence/drizzle/chunk.repository.ts`
- **Test:** `apps/api/test/infrastructure/persistence/chunk.repository.spec.ts`
  ("createMany grava um lote e listByProject filtra por escopo, sem
  misturar docs e session")
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-227 — The session status badge covers the 5 real states, not the handoff's 4 {#rn-227}

The handoff asks for 4 badges (ativa/aguardando/fechada/abortada) for the 5
real states of the machine (`created/active/closing/closed/closed_abnormally`).
`closed_abnormally`→abortada and `created`→aguardando are direct. `closing`
is NOT merged with "fechada": it gets its own badge ("encerrando", tone
`accent`, pulsing), because in `closing` the outcome (`closed` or
`closed_abnormally`) is not yet known — calling it "fechada" would
lie about that.

- **Where:** `apps/web/src/routes/ProjectSessionsTab.tsx` (`SELO_DO_STATUS`)
- **Test:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — describe
  "ProjectSessionsTab — selo de status (RN-227)"

### RN-228 — The pill filter groups the 2 states without their own pill by TRAJECTORY {#rn-228}

The handoff's pill filters (todas/ativas/fechadas/abortadas) only cover 4
of the 5 states. `created` (aguardando) goes into the "Ativas" pill — it has not
reached anywhere yet, it is a "session in play". `closing` goes into the
"Fechadas" pill — it is already on its way to closing without error. Each row's BADGE
(RN-227) is never rewritten by the filter; the pill only groups.

- **Where:** `apps/web/src/routes/ProjectSessionsTab.tsx`
  (`correspondeAoFiltro`)
- **Test:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — describe
  "filtro pill agrupa os 2 estados sem pill própria (RN-228)"

### RN-229 — The Criativo tab's "cost of the month" KPI is the ACTOR's consumption, not the project total {#rn-229}

It reuses `getMySpend(projectId, 30)` — the SAME queryKey that
`ProjectSpendTab.tsx#MeuConsumo` uses for the member's view (RN-101, ADR
0063), with no new aggregation. It NEVER shows the project total summing everyone
(`porProjeto` in `getWorkspaceSpendReport`), because that data is
owner-only and the Criativo tab is seen by any member of the project —
showing the overall total would leak other people's spending to whoever RN-060/101 does not
authorize to see it.

- **Where:** `apps/web/src/routes/ProjectSessionsTab.tsx` (`CriativoKpis`)
- **Test:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — describe
  "KPIs da aba Criativo", cases "caminho feliz" and "CASO DE FALHA"

### RN-230 — The "ideation → commit rate" KPI is declared absent, never computed {#rn-230}

There is, nowhere in the product, a link between a creative session and
the commit it produced. The Criativo tab shows "—" with the sentence "não
medido: sessão não é vinculada a commit hoje" instead of inventing a
calculation — the same class of error that ADR 0042 already refuses for a model
score.

- **Where:** `apps/web/src/routes/ProjectSessionsTab.tsx` (`CriativoKpis`)
- **Test:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — "'Taxa
  ideação → commit' é DECLARADA ausente — nunca um número calculado"

# Api's Exposed Surface

Every registered route, with its authentication classification and the
justification for the ones left open. Decisions in
[ADR 0027](adr/0027-fase5-backup-hardening-release.md).

> **This document is the source of truth for a test**, not a copy of one.
> `apps/api/test/interfaces/route-surface.spec.ts` boots the application,
> enumerates the routes **registered at runtime**, and compares them
> against the table below. A new route with no row here **fails the
> test**; a row whose classification differs from the real annotation
> **fails the test**; an orphan row (matching no route at all) **fails
> the test**. The documentation can't go stale in silence.

## Classifications

| value | what it means |
|---|---|
| `public` | `@Public()` — no token. Each one justified below |
| `engine-service` | `EngineServiceGuard`: `X-Brabo-Service-Token` matching the shared secret. This is the internal api↔engine surface, outside the JWT |
| `role:<role>` | authenticated and restricted by the domain's RBAC (`@RequireRole`) |
| `jwt` | authenticated, no role required on the route — the scope comes from the resource itself |

## The fifteen public routes

There were four until Phase 6. Phase 7a added eight at once — first-party
auth — ADR 0084 added two more, social login, and the runner device-key
onda added the binary proxy. Each one is justified below. Opening any more
still requires touching the assertion in `route-surface.spec.ts`, which
lists the public ones literally to force the conversation.

### Infrastructure

**`GET /live`** — liveness. Doesn't touch the database on purpose:
responds as long as the process is alive. Requiring a token here would
make kubelet restart the pod at the first hiccup in the auth path,
turning a degradation into a full outage.

**`GET /health`** — readiness, with `select 1`. Same reasoning: kubelet
is the caller, and it carries no token. Reveals only whether the
database responds.

**`GET /metrics`** — Prometheus scrape, which also carries no token at
all. Exposure controlled by NETWORK, not by auth: the NetworkPolicy only
opens it to the `monitoring` namespace, and the production Ingress
blocks the path. Without `@Public()` the target would show as `down`
while everything else stays green.

**`GET /git/oauth/:provider/callback`** — the GitHub/GitLab OAuth
return. The user's browser lands here coming from the provider, with no
api session. It isn't unrestricted, though: the `state` parameter is
validated by HMAC (`GIT_OAUTH_STATE_SECRET`), and without a valid
`state` the call is refused.

That guarantee is worth exactly as much as the key, which is why it
stopped having a default: in production the api **refuses to boot** with
the repository's example key, which is public (ADR 0059,
[RN-093](business-rules/custo.md#rn-093)). With a known key, this route goes
back to being unrestricted in practice — anyone can sign a `state` for
whichever project they want.

**`GET /runner-releases/binary`** — proxies the runner's standalone
binary from GitHub Releases so the browser never talks to GitHub
directly. Public for the same reason as `/metrics`/JWKS: the binary
itself is not a secret, and requiring a session to download the very
tool that lets someone authenticate would be backwards. `platform` is a
closed allowlist (`linux-x64`/`linux-arm64`/`darwin-x64`/`darwin-arm64`/
`win32-x64`), never interpolated raw into the GitHub URL — closing the
SSRF/path-injection vector an open parameter would leave. The resolved
asset URL (never the bytes) is cached in memory for a few minutes,
purely to stay under GitHub's unauthenticated rate limit under
concurrent downloads.

### First-party auth

The seven `/auth/*` routes plus JWKS. **All of them need to be public for
the same structural reason:** they're the path through which an access
token is OBTAINED, and the global `JwtAuthGuard` requires one. An auth
route behind the guard would ask for the credential it itself issues.
`logout` is the only one that could be authenticated, and isn't, on
purpose: it already carries the credential it cares about — the refresh
in the cookie, with its CSRF pair — and logging out needs to work even
with an expired access token.

> **What protects these routes isn't the rate limit.** `RateLimitGuard`
> exempts `@Public()` routes — on purpose, so as not to strangle
> `/health` until kubelet restarts the pod. What holds this surface is
> **progressive lockout** by email and by IP, inside the use cases. It's
> not an optional reinforcement: it's the only defense that exists here.
> See
> [RN-030](business-rules/autenticacao.md#rn-030) and [RN-031](business-rules/autenticacao.md#rn-031).

**`POST /auth/register`** — sign-up. Responds `202` for both a new
address and one already registered; in the second case nothing is
created and the address's owner gets a notice. A `409 Conflict`, which is
what good REST sense would ask for, would hand the user list to anyone
with a wordlist.

**`POST /auth/login`** — authentication. A nonexistent email, a wrong
password, and a locked account all return the **same** 401 response, and
take the **same** time (the no-account branch checks against a dummy
hash with identical parameters).

**`POST /auth/refresh`** — rotation. The refresh token itself is the
credential, so the route can't require another one.

**`POST /auth/logout`** — revokes the presented token's family. Always
`204`, even for an unknown token: answering 401 here would be a
token-validity oracle.

**`POST /auth/verify-email`**, **`POST /auth/request-password-reset`**,
**`POST /auth/reset-password`** — account flows. Whoever reaches them has
no session yet, by definition. The credential is the single-use token
that came by email; an invalid, expired, or already-used link all get an
identical response.

**`GET /.well-known/jwks.json`** — the **public** half of the Ed25519
pair that signs access tokens. Same reasoning as `/metrics`: the
consumer has no token, and requiring one would mean asking for a
credential in order to validate a credential. Publishing the public key
is the format's whole purpose — what can never leave here is the JWK's
`d` component, locked down by a test.

### Social login (ADR 0084)

**`GET /auth/oauth/:provider/start`** — redirects straight to the
provider (GitHub/GitLab). Public for the same structural reason as the
other seven: it's the entry point itself, before any session exists. The
`state` it generates is HMAC-signed with its OWN purpose
(`signSocialOauthState`/[RN-273](business-rules.md#rn-273)) — never the
same `state` as `GET /git/oauth/:provider/callback` above, even though
both routes sign with the SAME `GIT_OAUTH_STATE_SECRET` key. The
`purpose` field in the payload is what keeps a `state` from one flow
being accepted by the other's verifier.

**`GET /auth/oauth/:provider/callback`** — receives the provider's
return. Same reasoning as the git-connection callback: the browser
arrives with no session, `state` is HMAC-verified, and the route never
returns JSON — it always redirects, to `WEB_ORIGIN/` on success (with
the session cookies already written) and to
`WEB_ORIGIN/login?oauth_error=1` on failure, without detailing the
reason in the URL.

## Notes

- **`POST /workspaces/:workspaceId/projects` decides where the agent will
  write, and that's why it's a security-surface route, not just a
  registration one**
  ([ADR 0072](adr/0072-projeto-local-ou-container.md)/
  [ADR 0104](adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md),
  [RN-169](business-rules/autenticacao.md#rn-169)/[RN-421](business-rules.md#rn-421)/
  [RN-422](business-rules.md#rn-422)). The body gained `executionMode`
  (`container` — the default and the always-been behavior —, `mounted`, the
  old `local`, renamed, or `runner`) and `workspacePath`. In `mounted`/
  `runner` the absolute path supplied becomes the **terminal scope root**
  of ADR 0055: what's typed here is what the agent can read and write. No
  new route, and no role change (`RequireRole('maintainer')`, as it already
  was) — what changed is the reach of what the route grants.

  Validation diverges across the TWO modes that aren't `container`
  (RN-422): `mounted` still touches disk at creation time (absolute, no
  `..`, existing, writable from inside the container, never root or a
  system folder, never overlapping the Brabo checkout in either direction),
  with a `400` refusal and the compose line that resolves it; `runner`
  validates only the LEXICAL form — the same list of prohibitions, without
  touching disk — because only the runner, running on the real host, has
  the authority to confirm the folder exists (RN-423, see
  `POST /internal/projects/:projectId/workspace-verification` below). The
  mode is **frozen** afterward: `UpdateProjectDto` deliberately omits both
  fields, otherwise `PartialType(CreateProjectDto)` would expose them on a
  `PATCH` with no guard at all. The lexical predicate still runs on every
  derivation of the root — on READS too, not just on creation — because the
  only way to bypass creation is to write straight to the database.
- **`GET /`** is the NestJS scaffold's "Hello World!"
  (`src/app.controller.ts`). It's behind the guard and leaks nothing, but
  serves no purpose — a removal candidate. It stayed recorded here instead
  of being removed, since that's a product decision, out of scope for this
  session.
- **`GET /internal/projects/:projectId/git-remote` is the only route in the
  product that returns a DECRYPTED secret** — the workspace owner's git
  token ([ADR 0056](adr/0056-o-engine-trabalha-em-repositorio-remoto.md)).
  It exists because the engine works on the filesystem and doesn't hold the
  master key; replicating it in the engine would double the blast radius of
  the product's most sensitive secret. Two properties keep it defensible:
  the `origin` it returns is **clean** (the credential comes in a separate
  field, never embedded in the URL), and the consumer is obligated to
  inject it per invocation, never to a file — see `Engine.Actions.GitAuth`
  and the reasoning for that in [RN-076](business-rules/custo.md#rn-076). If this
  route ever starts returning the already-authenticated URL, the token
  would end up in `.git/config`, inside the folder where the dev agent has
  auto-approved reads.
- **The PO's three read routes** — `GET /internal/projects/:projectId/business-rules`,
  `GET /internal/projects/:projectId/backlog` ([RN-164](business-rules/autenticacao.md#rn-164))
  and `GET /internal/projects/:projectId/product-metrics` ([RN-407](business-rules.md#rn-407)) —
  return no secret at all and **accept nothing beyond the project id**: no
  search term, no pagination, no filter. That's on purpose. A read route for
  an agent is a surface the model chooses to call, and a parameter is where
  the model writes whatever it wants; here there's nowhere to write. The
  scope is closed to the project by the path, and the cost per call is
  constant (three reads in the backlog, two in the rules, one query against
  `proposed_actions` filtered by index in the product metrics).
- **`POST /internal/projects/:projectId/workspace-verification`** (RN-423,
  ADR 0104) is called only by the engine, after a runner connects and sends
  `workspace_confirm` over the channel — never directly by the runner,
  which doesn't hold the service token. The runner is the SOURCE OF TRUTH
  for the path (it OVERWRITES `workspacePath`, without requiring it to
  match what was typed at creation), but the reported path still goes
  through the SAME lexical check as creation
  (`caminhoDeWorkspaceLocalValido`) — system root and overlap with the
  Brabo checkout remain forbidden even coming from the runner. `400` if the
  project isn't in `runner` mode.
- **`GET /internal/projects/:projectId/container-spec`** ([ADR 0130](adr/0130-broker-de-container.md),
  [RN-485](business-rules.md#rn-485)) is the only `engine-service` route whose
  caller is NOT the engine — it is the container **broker**, the single process
  in the product with access to a Docker daemon. The classification names the
  MECHANISM (`BRABO_SERVICE_TOKEN` in its own header, compared in constant
  time), not the sender, and the secret is deliberately the same one: the three
  services run in the same cluster and read the same Secret, so a second secret
  would give the impression of compartmentalising without compartmentalising
  anything (the full reasoning is in `service-token.ts`). What makes the route
  worth its existence is the direction of the call: the broker does not RECEIVE
  a container spec, it comes here to READ project identity, execution mode and
  the Architect's current image decision, and composes the spec itself. A spec
  travelling in a request body would make the containment of a root-equivalent
  process depend on its caller being correct. It returns **no path at all** —
  the bind source is resolved by the daemon against the HOST filesystem, so a
  path from inside the api container would silently mount an empty folder; the
  broker joins `workspaceDirName` with its own `PROJECT_WORKSPACES_HOST_ROOT`,
  and refuses `start` when that is not configured. It also drops `rationale`,
  which exists so a human can review the decision and has no consumer in a
  `docker run`.
- **`POST /projects/:projectId/runner-ticket` is classified `role:developer`
  like any other route, but does NOT accept a session JWT** (ADR 0105,
  RN-424) — only a Personal Access Token (`brb_…`) OR a runner device key
  (Ed25519, see below). The automatic classification
  (`route-surface.spec.ts`) doesn't distinguish the mechanisms, because
  the role REQUIREMENT is the same; what changes is only how
  `request.user` gets established. `PatAuthGuard` runs in place of
  `JwtAuthGuard` on this route (`@RequirePatAuth()`, the same structural
  pattern as `@ServiceRoute()`/`EngineServiceGuard` — bypass by metadata,
  never an `if` a new route could forget), and it's the ONLY place in the
  api that accepts either of these credential formats: on any other route
  a `brb_...` fails JWT verification normally, and a device-key JWT fails
  it too (its `kid` never resolves against the session-token issuer's own
  keys). The five routes under `/projects/:projectId/personal-access-tokens`
  (issue/list/revoke the PAT itself, plus the two `maintainer` ones —
  RN-427, list/revoke of ANY user in the project) remain regular session
  JWT — only the route the TOKEN ITSELF authenticates changes mechanism.
- **The two `/projects/:projectId/runner-device-keys` routes ARE regular
  session JWT**, unlike `runner-ticket` above — the browser, already
  logged in, registers the Ed25519 public key it just generated (the
  private half never leaves it) before offering the runner binary for
  download. `POST` persists the public key only — there's no "raw secret"
  to hand back the way `IssuePersonalAccessTokenUseCase` does, because
  the client already holds the only secret involved (the private key) and
  the api never sees it. `DELETE` revokes the caller's own key,
  idempotently, same shape as the PAT's self-service revoke. `PatAuthGuard`
  is what LATER accepts a JWT signed by that key's private half on
  `runner-ticket`, looked up by the `kid` header matching this table's
  `id`; the guard checks the key hasn't been revoked but never an
  expiry — the key itself doesn't expire, only the short-TTL (≤60s,
  `exp - iat`) JWT the runner signs with it each time.
- **The `engine-service` routes aren't "internal" by naming convention.**
  What protects them is `EngineServiceGuard` comparing
  `X-Brabo-Service-Token` against the shared secret in constant time, plus
  the NetworkPolicy. The `/internal` prefix is signaling for humans. They
  sit **outside the JWT** via `@ServiceRoute()`: the user token doesn't
  work here and the service token doesn't work on any other route — the
  two mechanisms never overlap ([RN-035](business-rules/autenticacao.md#rn-035)).
- **`/docs` and `/docs-json` are NOT in the table, and that's a known
  gap.** The Swagger UI is mounted by `SwaggerModule.setup()` at the
  Express level, not as a controller, and the test enumerates via
  `DiscoveryService` — it structurally can't see them. Both only exist
  with `NODE_ENV !== 'production'` (`main.ts`), are public, and serve
  the same document the
  [generated reference](reference/api/brabo-api) publishes. Recorded
  here instead of left out: what the test can't reach needs to be in
  the prose.
- **`GET /projects/:projectId/agent-areas` started returning real data,
  and the classification didn't change** — it's still `role:developer`,
  while the ceiling's `PATCH` remains `role:maintainer`. Until PHASE 18
  the `agent_areas` table was never written and the route answered `[]`
  to everyone, which made the classification look lenient by accident,
  not by decision. With the area now born together with the project
  ([RN-094](business-rules/custo.md#rn-094)), the split goes back to what
  PHASE 14d intended: **reading** the ceiling is work for whoever
  executes; **changing it** is deciding how much the product spends
  without asking, and that's why it requires the same role that
  activates execution.
- **The five `/projects/:projectId/rag/*` routes split the role by the
  same criterion as the area parallelism ceiling (RN-083)** (PROGRAM 28,
  Wave 4 — RN-231..234, ADR 0080): `search` and `coverage` are
  `role:viewer` (pure reading over what's already indexed), and
  `reindex` is `role:maintainer` — it triggers N calls to the project's
  repository and to the embedding provider, the same "changes what the
  product spends without asking" that already justifies the higher role
  on other expensive-trigger routes. `local` (RN-455, ADR 0113) is
  `role:maintainer` too, same reasoning: it calls the embedding provider
  and replaces what the project has indexed for that scope. Its body is
  browser-read TEXT, never a host path.
  `feedback` (RN-480) is `role:viewer`, the **same** role as `search`,
  and the criterion above is why: voting spends nothing and configures
  nothing — it is observation, and it is the only signal of truth the
  RAG measurement has (`medir:rag`). Raising it to `maintainer` would
  empty that signal to protect nothing. The vote is still bounded on the
  server: a `searchId` from another project, or a `chunkId` that was not
  among that search's hits, is a 400 — a vote without a rank measures
  nothing.
- **The four `/projects/:projectId/code/*` routes are `role:viewer` and
  READ-ONLY** (PHASE 26b). Seeing a project's code is the same
  permission as seeing the project — the same cut as
  `GET /projects/:id/git/repository`. Three things make this apparent
  looseness a decision rather than an oversight:
  - **there's no write verb on the controller**, and there can't be: the
    Code tab is for reading, and writing is an external effect, which
    is born a `proposed_action` and belongs to a later phase. A `@Post`
    in this file is a phase change, not a route change;
  - **the path is contained in ONE place** ([RN-095](business-rules/custo.md#rn-095)),
    via the same central check as [RN-092](business-rules/custo.md#rn-092) —
    and containment matters here more than the role, because on remote
    providers the path becomes a URL segment of the provider's API and a
    `../` swaps the **endpoint**, not the file;
  - **the credential spent is the workspace owner's**
    ([RN-058](business-rules/custo.md#rn-058)/[RN-082](business-rules/custo.md#rn-082)),
    same as with writing. Reading costs the provider's rate limit, which
    is why search has a budget: without a ceiling, a `viewer` could run
    up the owner's bill at will.
- **`GET /workspaces/:workspaceId/spend-report` started returning the
  breakdown by provider, which is a breakdown by CREDENTIAL**
  ([ADR 0076](adr/0076-provider-volta-a-ser-dimensao-de-gasto.md),
  [RN-186](business-rules/custo.md#rn-186)/[RN-187](business-rules/custo.md#rn-187)).
  No new route and no role change — still `role:owner`, as it already
  was — but what it GRANTS changed, which is why this note exists. ADR
  [0063](adr/0063-duas-audiencias-para-o-mesmo-gasto.md) had refused
  that axis for exactly this reason; 0076 revises it by the product
  owner's decision. What now holds the boundary is TWO independent
  barriers: `GET /projects/:projectId/spend/me` (`role:viewer`) has no
  dimension parameter at all, and the TYPE refuses the combination — a
  scope with `actor` only accepts
  `Exclude<SpendDimension, 'provider'>`, so asking for provider in the
  member's view doesn't compile. The second is weaker than the previous
  guarantee ("the dimension didn't exist"), which is why there are two.
- **`POST /projects/:projectId/sessions/:sessionId/socket-ticket` is
  `role:viewer` in the table, but that's the FLOOR, not the ceiling**
  (RN-108). The `@RequireRole('viewer')` covers `scope: "heartbeat"` —
  the existing heartbeat/live-events socket; `scope: "terminal"`
  requires `developer`, checked INSIDE `CreateSocketTicketUseCase`
  against `request.effectiveRole` (the same one `RolesGuard` already
  resolved), because the minimum role depends on the request's BODY, not
  just the route — the same pattern as
  `MIN_ROLE_FOR_ACTION_TYPE.terminal` in `domain/actions/decide.ts`.
  Today no real path asks for `scope: "terminal"` (the interactive
  terminal socket is PHASE 25); the value is already born correct for
  when it exists.
- **`POST /projects/:projectId/members` is `role:maintainer` in the table,
  and that role is NECESSARY but not SUFFICIENT**
  ([ADR 0127](adr/0127-tetos-de-rebaixamento-em-project-members.md),
  [RN-472](business-rules.md#rn-472)). The mirror image of the
  `socket-ticket` note above: there the table's role is the floor and the
  body can raise it; here the table's role is the whole gate the
  `RolesGuard` applies, and the use case then refuses **two movements with
  403 even for a caller who has it** — downgrading someone who is `owner` of
  the WORKSPACE, and downgrading YOURSELF. No new route and no role change
  (`RequireRole('maintainer')`, as it already was); what changed is that the
  classification stopped being the complete answer to "who can do what
  here". The reason it can't live in `RolesGuard` is the same one the
  `socket-ticket` note gives — the decision depends on the request's BODY
  (`dto.role`) and on its TARGET (`dto.userId`), which the guard doesn't
  see — so the rule is a pure function in
  `domain/iam/tetos-de-rebaixamento.ts` applied by
  `AddProjectMemberUseCase`, in the FORM of the absolute caps in
  `domain/actions/decide.ts` ([RN-418](business-rules.md#rn-418)): no
  configuration key, nothing that can enable them. The `owner` being
  protected is `workspace_members.role`, never `workspaces.created_by`.
  What the caps do NOT cover is written down in the ADR and in the RN, and
  the shortest one to know here is that `DELETE
  /projects/:projectId/members/:userId` gained NO cap: removing your own row
  drops you to your workspace role, which is benign when that role catches
  the fall and an irreversible self-downgrade when it doesn't.
- **`jwt` with no role doesn't mean without authorization.** On
  `/users/me/*` the scope is the user themselves; on `GET /workspaces`
  the listing is already filtered by the caller's membership.
- **`X-Brabo-Service-Token` started getting redacted in the log**
  ([ADR 0035](adr/0035-observabilidade-legivel-e-trace-sem-coletor.md)).
  It's the bearer for all api↔engine traffic and was **not** on pino's
  `redact` list: if it landed in a logged error body, it would go to
  Loki in plain text and with retention. `serviceToken`, `privateKey`,
  `encryptedDek`, and `dek` were added at the same time. The full list is
  in `apps/api/src/infrastructure/observability/logger.config.ts`, and
  there's a test asserting each path — the list is a contract, not a
  convenience.
- **CORS's `allowedHeaders` is explicit**, and the list needs to contain
  every header the web sends: `Content-Type`, `Authorization`,
  `X-CSRF-Token`, and `traceparent`. Missing one breaks no test at all
  (no test does a preflight) and breaks the browser.
- **The engine has CORS only on its health routes**
  ([ADR 0037](adr/0037-cors-do-engine-e-a-porta-como-contrato.md)).
  `/health`, `/live`, and `/ready` return
  `Access-Control-Allow-Origin` for `WEB_ORIGIN`'s origins;
  **`/internal/*` and `/metrics` don't**, and the exclusion is the
  point. The 13 internal routes are server-to-server with a shared
  secret ([RN-035](business-rules/autenticacao.md#rn-035)); CORS there wouldn't
  enable anything — the api's HTTP client ignores those headers — but it
  **would announce to a browser that it's an expected client of that
  channel**. There's a test asserting the absence, and one asserting the
  path list has exactly three entries, so moving the boundary shows up
  in the diff.
- **An unknown origin gets a response, not a `403`.** On both services,
  the request is served and goes out without the header; what blocks the
  read is the browser, which is whose decision it is. Answering `403`
  would break every client that doesn't send `Origin` — kubelet's probe,
  `curl`, `docker/smoke.sh`.
- **`POST .../delegations` is engine-service like the other internal
  routes** (Phase 8b QA, Phase 8c Infra — ADR 0038) — each area's lead
  records each delegate's outcome (`completed`/`failed`/`dispensed`)
  SEPARATELY from the call the area uses to report its consolidated
  result to the outside (`gates/verdict` for QA, `open_infra_pr` for
  Infra). Session-scoped, not task-scoped — `taskId` is optional in the
  body. Delegation is never visible as a handoff.
- **`POST /projects/:projectId/execution/activate` gained an optional
  `originSessionId` in the body, and the classification didn't change**
  — still `role:maintainer` (RN-135). The field lets whoever already has
  that role close the CHAT session that originated the request, but with
  two containments that prevent using it to close someone else's
  session: `findInProject(projectId, originSessionId)` silently refuses
  an id that doesn't belong to the path's OWN project, and the closing
  only happens if `GetSessionPendingWorkUseCase` (the same guard as the
  inactivity heartbeat, [RN-073](business-rules/custo.md#rn-073)) confirms
  there's no handoff, action, or turn hanging there. It never closes the
  execution session the call itself just activated.
- **`GET /projects/:projectId/execution/session` is `role:viewer`, the
  same role as `GET /sessions/:sessionId`**
  ([RN-139](business-rules/autenticacao.md#rn-139)). Returns the project's CURRENT
  execution session — `active` with `execution.activated` recorded — or
  `null`; never the project's most recent session, which is what the
  Executors tab used to read and which silently switched sessions the
  moment another session was born after it.
- **`POST .../llm-turn` and `POST .../llm-turn-stream` gained
  `modelName` in the response body/final frame, and the classification
  didn't change** — still `engine-service` as always
  ([RN-146](business-rules/autenticacao.md#rn-146)). The model's name was already
  being resolved to call the provider; it just started traveling back to
  the engine, which includes it in the `agent.response` payload. No new
  data is read, no new credential is exposed — it's the same name that
  already shows up in `token_usage`.
- **`PUT /projects/:projectId/agent-autonomy` started accepting
  `actionType: "*"` — "auto mode" ([RN-153](business-rules/autenticacao.md#rn-153))
  — and the classification didn't change:** still `role:maintainer`,
  the same as the `GET` next to it. The difference is what the body now
  AUTHORIZES, not who can call it: the wildcard grants autonomy for ANY
  agent action type at once, instead of one type at a time like before.
  The resolution (a SPECIFIC rule always beats the wildcard) lives
  entirely in the repository
  (`DrizzleAgentAutonomyRepository.findMode`), never in `decide()` —
  which keeps receiving only the already-resolved `PermissionPolicy`,
  exactly as before the wildcard existed. That's why the three absolute
  ceilings — merging into a protected branch, `instruction_patch`,
  `parallelize`/`raise_max_parallel` — keep blocking even with the
  wildcard set to `auto_approve` ([RN-154](business-rules/autenticacao.md#rn-154)):
  they react to `current.policy === 'auto_approve'`, never to where it
  came from, and no exception had to enter `decide()` for that to keep
  holding. `ApprovalCard.tsx` only offers the button that writes the
  wildcard to a client that already knows it has `maintainer`/`owner` —
  but what actually guarantees the role is this same
  `@RequireRole('maintainer')`, unchanged.

## Table

<!-- START OF TABLE — the test parses from here to the end of the document. -->

| method | path | classification |
|---|---|---|
| GET | `/.well-known/jwks.json` | public |
| POST | `/auth/login` | public |
| POST | `/auth/logout` | public |
| GET | `/auth/oauth/:provider/callback` | public |
| GET | `/auth/oauth/:provider/start` | public |
| POST | `/auth/refresh` | public |
| POST | `/auth/register` | public |
| POST | `/auth/request-password-reset` | public |
| POST | `/auth/reset-password` | public |
| POST | `/auth/verify-email` | public |
| GET | `/gates` | jwt |
| GET | `/git/oauth/:provider/callback` | public |
| GET | `/health` | public |
| GET | `/live` | public |
| GET | `/metrics` | public |
| GET | `/runner-releases/binary` | public |
| POST | `/internal/sessions/:sessionId/actions` | engine-service |
| GET | `/internal/sessions/:sessionId/anamnese-context` | engine-service |
| POST | `/internal/sessions/:sessionId/delegations` | engine-service |
| GET | `/internal/sessions/:sessionId/dev-context` | engine-service |
| POST | `/internal/sessions/:sessionId/epics` | engine-service |
| GET | `/internal/sessions/:sessionId/events` | engine-service |
| GET | `/internal/sessions/:sessionId/pending-work` | engine-service |
| POST | `/internal/sessions/:sessionId/events` | engine-service |
| POST | `/internal/sessions/:sessionId/gates/verdict` | engine-service |
| POST | `/internal/sessions/:sessionId/handoffs` | engine-service |
| POST | `/internal/sessions/:sessionId/hypotheses` | engine-service |
| GET | `/internal/sessions/:sessionId/infra-artifacts/:prActionId/files` | engine-service |
| GET | `/internal/sessions/:sessionId/infra-context` | engine-service |
| POST | `/internal/sessions/:sessionId/infra-gates/verdict` | engine-service |
| POST | `/internal/sessions/:sessionId/instruction-patches` | engine-service |
| POST | `/internal/sessions/:sessionId/max-parallel-proposals` | engine-service |
| POST | `/internal/sessions/:sessionId/llm-turn` | engine-service |
| POST | `/internal/sessions/:sessionId/llm-turn-stream` | engine-service |
| POST | `/internal/sessions/:sessionId/c4-diagram` | engine-service |
| POST | `/internal/sessions/:sessionId/module-map` | engine-service |
| POST | `/internal/sessions/:sessionId/module-routing` | engine-service |
| POST | `/internal/sessions/:sessionId/project-image` | engine-service |
| POST | `/internal/sessions/:sessionId/proficiency` | engine-service |
| POST | `/internal/models/sync` | engine-service |
| GET | `/internal/graph/prompt-templates/:name` | engine-service |
| POST | `/internal/graph/prompt-templates` | engine-service |
| POST | `/internal/rag/search` | engine-service |
| POST | `/internal/rag/feedback` | engine-service |
| GET | `/internal/gates` | engine-service |
| GET | `/internal/projects/:projectId/git-remote` | engine-service |
| GET | `/internal/projects/:projectId/business-rules` | engine-service |
| GET | `/internal/projects/:projectId/backlog` | engine-service |
| GET | `/internal/projects/:projectId/product-metrics` | engine-service |
| POST | `/internal/projects/:projectId/workspace-verification` | engine-service |
| GET | `/internal/projects/:projectId/container-spec` | engine-service |
| GET | `/internal/sessions/:sessionId/psychologist-context` | engine-service |
| POST | `/internal/sessions/:sessionId/stories` | engine-service |
| POST | `/internal/sessions/:sessionId/story-modules` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/:taskId/block` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/:taskId/gate/open` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/:taskId/status` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/claim` | engine-service |
| POST | `/internal/sessions/:sessionId/termination` | engine-service |
| GET | `/` | jwt |
| GET | `/users/me/credentials` | jwt |
| POST | `/users/me/credentials` | jwt |
| POST | `/users/me/credentials/:provider/test` | jwt |
| DELETE | `/users/me/credentials/:provider` | jwt |
| POST | `/users/me/git-credentials` | jwt |
| GET | `/users/me/preferences` | jwt |
| PATCH | `/users/me/preferences` | jwt |
| GET | `/workspaces` | jwt |
| POST | `/workspaces` | jwt |
| DELETE | `/projects/:projectId` | role:maintainer |
| GET | `/projects/:projectId` | role:viewer |
| PATCH | `/projects/:projectId` | role:maintainer |
| PUT | `/projects/:projectId/execution-mode` | role:maintainer |
| GET | `/projects/:projectId/models` | role:viewer |
| GET | `/projects/:projectId/actions` | role:developer |
| GET | `/projects/:projectId/agent-autonomy` | role:maintainer |
| PUT | `/projects/:projectId/agent-autonomy` | role:maintainer |
| DELETE | `/projects/:projectId/agent-bindings/:agentSlug` | role:developer |
| GET | `/projects/:projectId/agent-bindings/:agentSlug` | role:viewer |
| PUT | `/projects/:projectId/agent-bindings/:agentSlug` | role:developer |
| DELETE | `/projects/:projectId/area-bindings/:areaKey` | role:maintainer |
| GET | `/projects/:projectId/area-bindings/:areaKey` | role:viewer |
| PUT | `/projects/:projectId/area-bindings/:areaKey` | role:maintainer |
| GET | `/projects/:projectId/agent-costs` | role:developer |
| GET | `/projects/:projectId/agents/:agent/instruction-versions` | role:viewer |
| POST | `/projects/:projectId/agents/:agent/instruction-versions/:version/rollback` | role:maintainer |
| POST | `/projects/:projectId/anamnese/run` | role:maintainer |
| GET | `/projects/:projectId/architecture` | role:viewer |
| GET | `/projects/:projectId/backlog` | role:viewer |
| GET | `/projects/:projectId/budget` | role:maintainer |
| PUT | `/projects/:projectId/budget` | role:maintainer |
| GET | `/projects/:projectId/agent-areas` | role:developer |
| PATCH | `/projects/:projectId/agent-areas/:key/max-parallel` | role:maintainer |
| PUT | `/projects/:projectId/agent-areas/:key/budget` | role:maintainer |
| GET | `/projects/:projectId/code/blame` | role:viewer |
| GET | `/projects/:projectId/code/branches` | role:viewer |
| GET | `/projects/:projectId/code/file` | role:viewer |
| GET | `/projects/:projectId/code/pull-requests` | role:viewer |
| GET | `/projects/:projectId/code/pull-requests/:pullRequestId/diff` | role:viewer |
| GET | `/projects/:projectId/code/search` | role:viewer |
| GET | `/projects/:projectId/code/tree` | role:viewer |
| POST | `/projects/:projectId/rag/search` | role:viewer |
| POST | `/projects/:projectId/rag/reindex` | role:maintainer |
| POST | `/projects/:projectId/rag/local` | role:maintainer |
| POST | `/projects/:projectId/rag/feedback` | role:viewer |
| GET | `/projects/:projectId/rag/coverage` | role:viewer |
| GET | `/projects/:projectId/container` | role:viewer |
| GET | `/projects/:projectId/container/lifecycle` | role:viewer |
| GET | `/projects/:projectId/coverage` | role:viewer |
| GET | `/projects/:projectId/events/:eventId` | role:viewer |
| POST | `/projects/:projectId/execution/activate` | role:maintainer |
| GET | `/projects/:projectId/execution/session` | role:viewer |
| GET | `/projects/:projectId/git/:provider/connect` | role:maintainer |
| POST | `/projects/:projectId/git/:provider/repository` | role:maintainer |
| POST | `/projects/:projectId/git/:provider/repository/adopt` | role:maintainer |
| GET | `/projects/:projectId/git/bootstrap` | role:viewer |
| GET | `/projects/:projectId/git/bootstrap/plan` | role:viewer |
| POST | `/projects/:projectId/git/bootstrap/plan/approve` | role:maintainer |
| POST | `/projects/:projectId/git/bootstrap/plan/skip` | role:maintainer |
| POST | `/projects/:projectId/git/bootstrap/acknowledge-protection-failure` | role:maintainer |
| GET | `/projects/:projectId/git/repository` | role:viewer |
| GET | `/projects/:projectId/hypotheses` | role:viewer |
| POST | `/projects/:projectId/hypotheses/:hypothesisId/accept` | role:developer |
| POST | `/projects/:projectId/hypotheses/:hypothesisId/dismiss` | role:developer |
| GET | `/projects/:projectId/infra-artifacts` | role:viewer |
| GET | `/projects/:projectId/instruction-versions` | role:viewer |
| GET | `/projects/:projectId/members` | role:viewer |
| POST | `/projects/:projectId/members` | role:maintainer |
| DELETE | `/projects/:projectId/members/:userId` | role:maintainer |
| GET | `/projects/:projectId/model-binding` | role:viewer |
| PUT | `/projects/:projectId/model-binding` | role:maintainer |
| GET | `/projects/:projectId/permissions` | role:maintainer |
| PUT | `/projects/:projectId/permissions` | role:maintainer |
| POST | `/projects/:projectId/personal-access-tokens` | role:developer |
| GET | `/projects/:projectId/personal-access-tokens` | role:developer |
| GET | `/projects/:projectId/personal-access-tokens/all` | role:maintainer |
| DELETE | `/projects/:projectId/personal-access-tokens/:tokenId` | role:developer |
| DELETE | `/projects/:projectId/personal-access-tokens/:tokenId/admin` | role:maintainer |
| POST | `/projects/:projectId/runner-device-keys` | role:developer |
| DELETE | `/projects/:projectId/runner-device-keys/:deviceKeyId` | role:developer |
| GET | `/projects/:projectId/proficiency` | role:viewer |
| DELETE | `/projects/:projectId/proficiency/me` | role:viewer |
| POST | `/projects/:projectId/proficiency/me/opt-in` | role:viewer |
| GET | `/projects/:projectId/psychologist/analyses` | role:viewer |
| GET | `/projects/:projectId/psychologist/status` | role:viewer |
| POST | `/projects/:projectId/runner-ticket` | role:developer |
| POST | `/projects/:projectId/terminal-ticket` | role:viewer |
| GET | `/projects/:projectId/sessions` | role:viewer |
| POST | `/projects/:projectId/sessions` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId` | role:viewer |
| PATCH | `/projects/:projectId/sessions/:sessionId` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/actions` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/actions` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/actions/:actionId/approve` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/actions/:actionId/approve_always` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/actions/:actionId/deny` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/cancel` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/message` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/start` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/structured-question/:questionSetId/answer` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agentId/rearm` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/arquiteto/handoff-infra` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/criativo/validate-necessity` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/budget` | role:developer |
| PUT | `/projects/:projectId/sessions/:sessionId/budget` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/chat` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/events` | role:viewer |
| POST | `/projects/:projectId/sessions/:sessionId/events` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/events/:eventId` | role:viewer |
| POST | `/projects/:projectId/sessions/:sessionId/execution/parallelize` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/handoffs` | role:viewer |
| POST | `/projects/:projectId/sessions/:sessionId/handoffs` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/handoffs/:handoffId/accept` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/model-binding` | role:viewer |
| PUT | `/projects/:projectId/sessions/:sessionId/model-binding` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/psychologist/reanalyze` | role:maintainer |
| POST | `/projects/:projectId/sessions/:sessionId/readiness` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/socket-ticket` | role:viewer |
| POST | `/projects/:projectId/sessions/:sessionId/tasks/:taskId/unblock` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/token-usage` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/transition` | role:developer |
| GET | `/projects/:projectId/spend/me` | role:viewer |
| POST | `/projects/:projectId/stories/:storyId/return` | role:developer |
| POST | `/projects/:projectId/stories/promote` | role:developer |
| DELETE | `/workspaces/:workspaceId` | role:owner |
| GET | `/workspaces/:workspaceId` | role:viewer |
| PATCH | `/workspaces/:workspaceId` | role:maintainer |
| POST | `/workspaces/:workspaceId/members` | role:owner |
| GET | `/workspaces/:workspaceId/model-binding` | role:viewer |
| PUT | `/workspaces/:workspaceId/model-binding` | role:maintainer |
| GET | `/workspaces/:workspaceId/credential-spend` | role:owner |
| GET | `/workspaces/:workspaceId/spend-report` | role:owner |
| GET | `/workspaces/:workspaceId/huggingface/models` | role:maintainer |
| POST | `/workspaces/:workspaceId/huggingface/pull-requests` | role:maintainer |
| POST | `/workspaces/:workspaceId/huggingface/pull-requests/:id/confirm` | role:maintainer |
| GET | `/workspaces/:workspaceId/huggingface/pull-requests/:id` | role:maintainer |
| POST | `/workspaces/:workspaceId/models/activate` | role:owner |
| GET | `/workspaces/:workspaceId/models/catalog` | role:maintainer |
| POST | `/workspaces/:workspaceId/models/sync` | role:owner |
| POST | `/workspaces/:workspaceId/models/uses` | role:owner |
| GET | `/workspaces/:workspaceId/models/:modelId/price-changes` | role:maintainer |
| PATCH | `/workspaces/:workspaceId/models/:modelId/pricing` | role:owner |
| GET | `/workspaces/:workspaceId/projects` | role:viewer |
| POST | `/workspaces/:workspaceId/projects` | role:maintainer |
| GET | `/workspaces/:workspaceId/projects-status` | role:viewer |
| GET | `/workspaces/:workspaceId/projects-summary` | role:viewer |
| GET | `/workspaces/:workspaceId/summary` | role:viewer |
| POST | `/workspaces/:workspaceId/unread-events` | role:viewer |

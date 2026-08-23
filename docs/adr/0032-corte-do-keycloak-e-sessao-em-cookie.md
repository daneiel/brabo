# 0032 — Cutting Keycloak: our own issuer, service token and cookie-based session

## Context

[ADR 0031](0031-auth-first-party-argon2id-e-rotacao-de-refresh.md) built
first-party auth **in parallel** with Keycloak: argon2id, an EdDSA access
token, refresh rotation with reuse detection, lockout, account tokens. It
was finished, tested, and had no consumer at all — the global `JwtAuthGuard`
was still validating Keycloak tokens, and the `/auth/*` routes existed
without anyone using them.

This ADR records the cut: swapping the issuer, replacing client-credentials
in internal traffic, first-party login on the web app, and removing
Keycloak from compose, manifests, scripts and docs.

Three discoveries from the exploration reshaped the design, and they're
worth recording because each one invalidated a reasonable plan:

1. **No RBAC decision reads a token claim.** `RolesGuard`,
   `ResolveEffectiveRoleUseCase` and `decide()` depend on `request.user.id`
   and rows in the database; `realm_access` and `resource_access` were never
   consumed. The permission matrix is structurally immune to swapping the
   issuer — which turned the "identical matrix" criterion from an audit job
   into a cheap check.
2. **`request.clientId` was the only claim that survived through to
   authorization.** It came from Keycloak's `azp` and governed two things:
   the `EngineServiceGuard` on the 26 `/internal/*` routes, and the engine's
   rate-limit exemption. The first-party token has no `azp`, and leaving
   this unhandled would close all 26 routes at once.
3. **Reusing `SyncUserUseCase` would produce a 500, not a 401.** The new
   token's `sub` is the `users.id` itself, but `upsertFromKeycloak` conflicts
   on `keycloak_sub` — the insert would violate `users_email_lower_idx`, and
   the throw happens OUTSIDE the `try/catch` that wraps only token
   verification.

## Decision

### The cut is atomic: there's no coexistence period

In a single release the issuer swaps and Keycloak is gone. Everyone is
logged out; anyone who already had an account sets a password for the first
time.

The alternative — the guard accepting both issuers for a few weeks — would
cost two session paths on the web app, two network configurations and two
test suites, all needing to work every single day until someone decides to
end it. The cost of the cut is one announced, one-time collective logout;
the cost of coexistence is a debt with no deadline. It goes into the
CHANGELOG as a **breaking change**.

### The guard reads, it doesn't sync

`FirstPartyTokenVerifier` delegates to `Ed25519AccessTokenIssuer` and
returns `{ sub: userId, email }`. `JwtAuthGuard` now calls
`UserRepository.findById`, with a **401** when it finds nothing — a valid
token whose `sub` disappeared is an orphaned session (account deleted
within the 15-minute window), and 401 sends the client to login instead of
turning into an infrastructure alert.

`SyncUserUseCase`, `upsertFromKeycloak` and `KeycloakTokenVerifier` were
**removed**. One database write per authenticated request goes away.

`users.keycloak_sub` **stays** in this delivery. It's the only remaining
evidence of provenance, and it's what the migration script uses to tell
"migrated account waiting for a password" apart from "abandoned record."
The migration that removes it comes after the cut has settled.

### `/internal/*` moves off the JWT

New `@ServiceRoute()` decorator, honored by `JwtAuthGuard` (no Bearer
required) and by `RateLimitGuard` (exempted). The exemption has to come from
the **metadata**, not from a guard: `RateLimitGuard` is `APP_GUARD` and runs
before any controller guard, so by the time it decides, `EngineServiceGuard`
hasn't run yet.

`EngineServiceGuard` **kept the class name** and swapped the body: it now
validates `X-Brabo-Service-Token` in constant time. Keeping the name isn't
sentimentality — it's what keeps `route-surface.spec.ts` classifying the 26
routes as `engine-service`, and what avoids 26 lines of churn in
`docs/security-surface.md` hiding, in the middle of the diff, any real
change in exposure.

`request.clientId` was **removed** from `AuthenticatedRequest`. Without
`azp` and without a consumer, an identity field that's never worth anything
is an invitation for someone to reintroduce it into an authorization check.

**One secret, `BRABO_SERVICE_TOKEN`, in both directions.** Two separate
secrets would limit the blast radius of a leak to one direction — but both
ends run in the same cluster, are deployed together, and read the same
Secret: whoever reads one reads the other. A second secret would give the
impression of compartmentalizing without actually compartmentalizing
anything, while doubling what needs to be rotated in sync.
`BRABO_SERVICE_TOKEN_PREVIOUS` is accepted only during verification, so both
ends can be updated in any order.

A dedicated header instead of `Authorization: Bearer` because in the rest of
the api that header's established meaning is "user JWT," and the ambiguity
would lead someone to send the service token to a user route.

On the Elixir side: `VerifyServiceToken` replaces `VerifyApiToken`
**preserving the 401 + JSON + `halt()` contract** (three assertions in
`route_surface_test.exs` depend on it), the eight header-building call sites
collapse into one, and `joken`, `joken_jwks`, `jose` and `tesla` are
dropped.

### The web session lives in an httpOnly cookie

`POST /auth/login` no longer returns `refreshToken` in the body. The
refresh token travels in an `httpOnly` cookie, `SameSite=Strict`,
`Path=/auth`, `Secure` in production; the access token stays in JS memory
and in the `Authorization: Bearer` header.

Returning the refresh token in the body **too** would void the whole
protection: a single XSS reading the login response would be enough. And
that's exactly what would happen with the obvious alternative —
`localStorage` — with the aggravating factor that the XSS would grab the
long session (30-day family), not the access token's 15 minutes.

Keeping the access token OUT of the cookie is what avoids requiring CSRF
protection on every authenticated route — only the `/auth/*` ones need it.

**CSRF via double-submit, even with `SameSite=Strict`.** The attribute
alone already stops the browser from attaching the cookie to a request
originating from another site, which closes CSRF on these routes. The
second layer pays for three things it doesn't cover: a browser that ignores
the attribute, a compromised subdomain (which counts as "same site" for
cookie purposes), and the day someone needs to relax it to `Lax` because of
a redirect flow. The pair is a JS-readable cookie (`brabo_csrf`) echoed
back in `X-CSRF-Token`: anyone on a different origin can't READ the cookie,
so they can't build the header.

A CSRF failure is **403, not 401**: 401 would say "your credential is no
good" and the client would try to refresh the session, entering a loop.

### Single-flight refresh is a requirement, not an optimization

ADR 0031 had already flagged this, and here it was implemented: a single
in-flight promise shared by every caller.

Without it the system logs the user out through normal use. Two calls
hitting 401 at the same time would trigger two refreshes; the second one
would present a token the first one had already consumed — which, on the
server side, is the EXACT signature of theft. The family gets revoked and
the user is sent back to login for having opened two requests in parallel.

### The migrated user isn't distinguishable

Logging in with an account imported from Keycloak (exists in `users`, no
row in `auth_credentials`) responds with the **uniform 401**, identical to
a non-existent email, and silently fires off the "set your password" link.

Responding with an explicit `password_pending` would be the obvious UX
choice, and it's rejected: it would confirm both that the address exists
**and** that it's a legacy account — the most valuable enumeration signal
in the system, and exactly what [RN-032](../business-rules.md#rn-032)
closes.

For the cost to be the same across all three outcomes, `findByEmail` became
a LEFT JOIN from `users` to `auth_credentials`: a single query. Two
chained queries would make the pending branch pay for one extra database
round trip, and the clock would tell a migrated account apart from an email
that doesn't exist.

"Pending" is a **derived** state, not a column: there's no
`password_pending` to fall out of sync, and the migration script's
idempotency comes for free.

### The migration doesn't connect to Keycloak

Because there's nothing to import. `JwtAuthGuard` had been upserting every
user into `users` on every single request since Phase 1 — id, email, and
RBAC bindings had always lived in the api's database. Keycloak was never
the source of truth for RBAC; it was the token issuer. What these accounts
are missing is a password, which Keycloak wouldn't provide either (password
hashes don't migrate, per CLAUDE.md).

## Consequences

**Everyone gets logged out on release.** It's the declared price of the
atomic cut, and it's in the CHANGELOG as a breaking change.

**"Set your password" links go out to the api's log, not to an inbox.**
`MailSender` stays log-only, and real SMTP remains future configuration.
For a single-owner install this is enough; the runbook explains how to
extract them with `AUTH_MAIL_LOG_TOKENS=true`. It's the most visible
limitation of this delivery.

**Rotating `AUTH_TOKEN_PEPPER` or `BRABO_SERVICE_TOKEN` has opposite and
equally abrupt effects.** The first logs everyone out and invalidates any
open links; the second, if done on only one side, cuts internal traffic.
Both are in the runbook, with `_PREVIOUS` documented as the way to do it
without downtime.

**The web app can't say "that email is already in use."** A consequence
inherited from ADR 0031, now with a screen behind it: the form says "if the
address is available."

**The smoke test depends on a provisioned user.** Without an external IdP
there's no longer a ready-made credential, and registering through the API
runs into email verification. `bootstrap.sh` runs the seed, which creates
an account with a known password and an already-verified email — and
`provisionarUsuario` **refuses to run with `NODE_ENV=production`** without
an explicit override. It's a development tool, and is marked as such in the
code.

**`users.keycloak_sub` stays in the schema** with no issuer behind it
anymore. It's conscious debt, with a purpose (§ decision) and a deadline:
the migration that removes it lands after the cut has settled.

**The public surface hasn't changed.** Still 12 routes, and the 26
`engine-service` ones are still 26 — `route-surface.spec.ts` closed with an
empty diff, which was the expected result and the proof that the
controllers' contract wasn't touched.

### What was verified, and what wasn't

The RBAC matrix is proven by three locks: `decide.spec.ts` (24 cases) and
`resolve-effective-role.use-case.spec.ts` stayed **unchanged and green**;
`route-surface.spec.ts` closed with an empty diff; and two new specs —
`roles.guard.spec.ts`, with the 4×4 matrix written out by extension, and
`jwt-auth.guard.spec.ts`, which asserts no new row appears in `users` —
cover the identity → `user.id` jump, which had no test at all before and is
the only point the cut touches.

**The engine's test suite wasn't run in this delivery.** The development
environment used can't reach `hex.pm` (network policy block), and without
`mix deps.get` there's no `mix compile` or `mix test`. The Elixir code was
written and verified by syntactic analysis of every changed file; the real
run happens in CI, which has network access. It's recorded here instead of
omitted because it's exactly the kind of gap ADR 0020 said never to
diagnose by elimination.

### Conscious backlog (reaffirmed)

Still out of scope, now with the cut done: **MFA** (TOTP, WebAuthn),
**social login**, **OIDC federation** and the **api as an OIDC provider**.
Added to that: real SMTP, a breached-password dictionary, opportunistic
argon2 re-hashing, pruning the auth tables, and the migration that removes
`users.keycloak_sub`.

The credential-version claim — which would make the access token revocable
— stays noted with a new detail: `JwtAuthGuard` **stopped** writing on
every request as part of this cut, so the argument "it already hits the
database anyway," which would have made it cheap, no longer holds. If it
comes back to the table, it comes back on its own merits.

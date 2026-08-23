# 0031 — First-party auth: argon2id, EdDSA and refresh rotation

## Context

Brabo has authenticated via Keycloak since Phase 1: one more container in the
compose file, one more StatefulSet in Kubernetes, one realm in JSON to
maintain, and a network dependency on the path of every request. In exchange,
only a small subset of what it offers is used — password login, a public
client for the web app and two service accounts for internal traffic. No MFA,
no federation, no social login.

The math doesn't close. What Keycloak actually solves in this system fits
into one module of the api's domain; what it charges is permanent operation.
PHASE 7a swaps both sides: auth moves into the domain, Keycloak is removed.

This delivery (7.1) builds the module **in parallel**, without touching the
guard. `JwtAuthGuard` still globally verifies Keycloak tokens, and the RBAC
from Phase 1 is untouched. The reason is that the guard is `APP_GUARD` and the
rest of the api depends on the `request.user` it populates: building the new
auth AND swapping the issuer in the same delivery would leave no intermediate
state that's testable. With the new routes under `@Public()`, the module is
exercisable end to end while the current system stays standing.

## Decision

### Password: argon2id with parameters fixed in code

`m = 19456 KiB (19 MiB)`, `t = 2`, `p = 1`, 32-byte output — OWASP's second
recommended profile. Runs in ~50 ms and fits within the container's memory
limit even under concurrent verifications.

The parameters are a **constant**, not an environment variable. Changing hash
cost isn't a tuning knob: it requires a re-hash plan for the existing
records. Exposed as env, it would become the lever someone pulls in
production to "improve login latency" without anyone noticing the protection
just dropped.

Library: `@node-rs/argon2`, chosen over `argon2` because it ships a
pre-compiled binary — `Dockerfile.prod` is a multi-stage build on Alpine
(ADR 0024), and the alternative would require a compilation toolchain in the
builder.

### Access token: EdDSA (Ed25519), 15 minutes, derived key

The alternative was HS256 with a secret in env. EdDSA was chosen because the
public key can be published at `/.well-known/jwks.json` and verified by any
service without ever receiving the secret that **signs** — with HMAC, whoever
verifies can also forge.

The key **isn't generated, it's derived**: the 32-byte seed comes from
`scryptSync(AUTH_JWT_SECRET, 'brabo-auth-jwt-seed', 32)`, the same format the
`EnvelopeEncryptionService` already uses for the credentials master key
(Phase 1). That solves three problems at once — no private key is ever
committed, the pair is identical across replicas and across restarts (a
`generateKeyPairSync` at boot would give each process its own key, and the
symptom would be intermittent login behind the load balancer), and rotation
reuses the pattern that already exists instead of inventing a second one.

`kid` is the RFC 7638 thumbprint of the JWK itself: it's derived from the
key, so there's no variable that can drift from what it names.

Rotation via `AUTH_JWT_SECRET_PREVIOUS`, accepted **only for verification**
and published in the JWKS, never used to sign — same design as
`CREDENTIALS_MASTER_KEY_PREVIOUS`, with the same noisy boot warning reminding
that the rotation needs to finish.

### Refresh: 256-bit opaque token, HMAC-SHA256 hash, mandatory rotation

The token is 32 bytes of `randomBytes` in base64url. The database stores
`hmac-sha256(pepper, token)`.

**It's not argon2, and the choice being opposite to the password's is
deliberate.** Argon2 exists to make dictionary attacks against a low-entropy
secret expensive; against 256 bits of CSPRNG there is no dictionary, so the
cost would buy zero bits. Worse: argon2 uses a per-record salt, which would
make the hash stop being a pure function of the token — and
`where token_hash = $1` would become impossible, turning every refresh into a
full table scan. The pepper (instead of plain SHA-256) is free and makes a
database dump, without the process environment, worthless.

Each refresh consumes the presented token (`rotated_at`) and issues a child
with the **same `family_id`** and the **same `family_started_at`**.
Presenting a token that's already been rotated is the signature of theft: the
whole family is revoked and a security event is recorded.

`family_started_at` is the session's absolute ceiling. Without it, rotation
every 15 minutes would produce an eternal session — and no one would notice
until an audit asked how long a session can live.

`rotated_at` and `revoked_at` are **orthogonal** columns. Collapsing the two
would destroy the distinction between "you presented a token that was already
spent" (signal of theft → cascade) and "you presented a token that the
cascade from something else already killed" (downstream victim → no new
alarm). Without it, every tab of the legitimate user would trigger a theft
detection during the incident, filling the security log with noise exactly
when it needs to be readable.

### Lockout: sliding window in its own table, keyed by email

`auth_lockout_hits`, structurally identical to `rate_limit_hits` (ADR 0027):
INSERT and COUNT in a single statement via CTE, no Redis.

**A table separate from `auth_events`**, not one more column on it. The trail
is append-only by CLAUDE.md rule, and clearing the counter on a successful
login requires a DELETE. In a single table, one would have to invent a
watermark ("failures since the last success"), which couples the throttle's
query plan to the audit trail's index set forever. Kept separate, each one
gets the rule that fits it — and the retention policies are opposite too: the
counter becomes a PII liability within an hour, the trail needs to survive.

**The bucket key is the normalized email (HMAC'd), not the user id.** With an
id, the bucket would only exist after the account is found: an attempt
against a non-existent email wouldn't be counted or blocked, and the lockout
itself would become an existence oracle. With the email, a real account and
an imaginary one behave identically by construction.

The block reads the state **prior** to the attempt. Reading the state after
would make the threshold count one attempt short: with a threshold of 5, the
fifth attempt would be refused even with the correct password.

Email and IP buckets have **distinct** ladders (5:30, 8:300, 12:900 and
20:30, 30:120). A single threshold would miss at both ends: 5 per IP would
take down any office behind NAT, 20 per account would be too generous for a
password attack. The IP ceiling is short because collateral damage there
lands on people who did nothing.

The email ladder's ceiling is **equal to the window**, by construction. A
longer ceiling would require a persistent `locked_until`, with an unlock
queue and an admin endpoint — the sliding window can't represent a lockout
longer than itself.

### Email enumeration: one invariant, not a list of cases

> Any response that differs from the uniform failure can only be reached
> **after** a successful password verification.

The rule solves every case on its own, including the ones that usually slip
through: non-existent email, wrong password, locked account, disabled
account, and — the sneakiest one — a user imported from Keycloak who doesn't
have a password yet. Responding "set your password" to that last case would
confirm both that the address exists **and** that it's a legacy account, the
single most valuable enumeration signal in the system.

Concrete consequences: the credential lookup and the argon2 `verify` run
**always**, even without an account (against a dummy hash with identical
parameters) and even when the bucket is already locked. The email lockout
check happens **after** the verify. Bailing out early is any reviewer's
instinct, and it's exactly the leak — the cheap branch responds in ~1 ms
against ~50 ms for the expensive one.

The only early exit is for the IP bucket, for the opposite reason: nothing is
being hidden there (the history belongs to the requester itself), and running
argon2 anyway would hand over the very CPU exhaustion the bucket exists to
prevent.

Registration returns `202` even for an email that's already registered, at
the same argon2 cost, and notifies the owner of the address. A `409
Conflict` — what plain REST good sense would suggest — would hand a user
list to anyone with a wordlist, and would render all the care put into login
useless.

### Account tokens: one table, consumption via conditional UPDATE

`account_tokens` with a purpose enum (`email_verification`,
`password_reset`, `set_initial_password`), not three tables: the mechanics
are identical and what changes is data. Three tables would mean three copies
of the atomic consumption UPDATE, the one thing here that must not be gotten
wrong twice. The risk of mixing up purpose is closed at the door, with one
method per purpose — no caller passes the value directly.

Consumption is a single conditional UPDATE with `returning`; the UPDATE
**is** the guard. Read-then-write would let two simultaneous submissions both
go through, and that's not a hypothetical: corporate email security scanners
open every link in every message, so the bot routinely consumes the token
before the human clicks. The race is the normal case.

Reset revokes **all** of the user's families — the inverse of the reuse
cascade, and the difference is the threat model: there the evidence points
to one family; here the user is saying "I think someone got into my
account." And it doesn't issue a session: logging in directly from a link
received by email would make compromising the email equivalent to taking
over the account, with no second step.

## Consequences

**Refresh reuse also logs out the legitimate user.** On the server side, a
double-submit and a thief's replay are byte-for-byte identical — same token,
same route, often the same IP. With no signal to tell them apart, the safe
policy is to assume theft. The fix lives on the client: refresh in
**single-flight**, a single in-flight promise shared by every caller. That's
a requirement of 7.2, not an implementation detail — without it, two calls
hitting 401 at the same time log the user out.

**The web app can't say "that email is already in use."** The form now says
"if the address is available, we sent a confirmation email." It's a product
cost, accepted in exchange for closing the enumeration hole.

**A locked-out user doesn't know they're locked out.** The response is
identical to a wrong password, because a 429 or a "locked account" would
tell the attacker both that the account exists and that they hit the right
target. The mitigation lives on the client — after N consecutive 401
responses, the login screen suggests waiting — and it's derived from no
server signal, so nothing leaks.

**The access token isn't revocable.** It's a 15-minute stateless JWT, so
there's a window of up to 15 minutes where a stolen token keeps working even
after a password reset. That's the price of not hitting the database on
every request, and it's precisely why the TTL is short. A credential-version
claim would fix it, and is noted as backlog — worth revisiting in 7.2,
because the current `JwtAuthGuard` already makes one database round trip per
request (the `syncUser`), which makes the marginal cost much lower than
usual.

**No claim of constant time.** What the tests prove, deterministically, is
that no branch skips the expensive work and none produces a distinguishable
response: a spy on `PasswordHasher` verifies that all three login failure
branches call `verify` exactly once, with identically-parameterized hashes.
A clock-based test on shared CI is fragile, and a test that goes red once in
twenty runs is worse than no test at all — the team learns to hit "re-run."
Remaining differences (one extra log line, the INSERT on the known-account
branch of a reset request) are orders of magnitude smaller than network
jitter, and are recorded here as accepted.

**Rotating `AUTH_TOKEN_PEPPER` logs everyone out** and invalidates any
pending account tokens. Peppers have no `_PREVIOUS`: accepting dual
verification on every refresh, forever, for a scenario that happens once in
a blue moon, doesn't pay off. It's recorded in the runbook.

**The public surface jumped from four routes to twelve.** Each one is
justified in [`docs/security-surface.md`](../security-surface.md), and
`route-surface.spec.ts` lists all twelve literally — opening one more still
requires touching the test. Worth noting what this exposes: `RateLimitGuard`
lets `@Public()` routes through, so **none** of the auth routes are covered
by it. What holds that surface is progressive lockout, and only that.

### Conscious backlog

Out of scope by decision, not by oversight:

- **MFA** (TOTP, WebAuthn), **social login** and **OIDC federation**.
  Keycloak offered them and they weren't used; reimplementing them now would
  mean paying the cost without the demand.
- **The api as an OIDC provider.** It authenticates its own users; it's not
  an issuer for third parties.
- **A breached-password dictionary** (HIBP, rockyou). The short in-domain
  list catches the obvious cases and doesn't pretend to be more than that.
- **Opportunistic re-hash** when the argon2 parameters change.
- **Tolerant refresh replay** within a grace window, to smooth out the
  double-submit case. It has real security cost — a thief replaying within
  the window gets a valid pair with no alarm — so it only comes in after the
  client-side single-flight, if it's still needed at all.
- **Pruning the auth tables** (`auth_lockout_hits`, `refresh_tokens`,
  `account_tokens`). Rate limiting already has pruning; these need to join
  the same mechanism.

### What's still missing in PHASE 7a

This ADR covers 7.1. Still open: swapping the issuer in `JwtAuthGuard`
(7.2), harvesting the OpenAPI spec for `docs/reference/api/` (7.3), the
service token between engine and api, importing Keycloak users, and removing
Keycloak from compose, manifests, and the web app. ADR 0027 classified the
HTTP surface, and ADRs 0024 and 0025 designed the image and the deployment —
all three will need to be referenced, not edited, once Keycloak is gone.

# ADR 0096 — Real SMTP in `MailSender`, behind an explicit toggle

- **Status:** accepted
- **Date:** 2026-08-18
- **Prior context:** [ADR 0031](0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)
  (the log-only `MailSender` was born here), [ADR 0032](0032-corte-do-keycloak-e-sessao-em-cookie.md)
  (recorded "real SMTP remains future config" as an accepted consequence),
  [ADR 0059](0059-segredo-do-state-de-oauth-sem-default.md) (the pattern
  for validating a secret in production that this ADR reuses)

## Context

Since Phase 7a, `MailSender` (`apps/api/src/application/ports/mail-sender.port.ts`)
has had a single implementation, `LogMailSender`: email verification,
password reset, initial password setup (accounts migrated from Keycloak)
and duplicate-registration notices never leave the api — they only go to
the log. That was enough to prove the auth flow end to end, but it left an
open item since then in `docs/explanation/backlog.md`: "real SMTP in
MailSender".

The item isn't a new feature — it's closing a gap already recorded, with
the port already ready since the Keycloak cut: `MailSender.enviar(email)`
carries no opinion about transport, only about payload
(`para`/`tipo`/`token?`/`expiraEm?`). The real work is the SMTP
implementation and the decision of HOW to wire one in without breaking
whoever already runs the product today.

## Decision

### `nodemailer`, over plain SMTP transport

`createTransport({ host, port, secure, auth })`. Unlike the JSON APIs over
HTTP that the rest of the product integrates with (LLM providers, over
plain `node:http` — ADR 0041), SMTP is a LINE protocol, with state, MIME,
STARTTLS and multiple AUTH mechanisms. Reimplementing that by hand would
mean reinventing a security-sensitive wheel for no gain. `nodemailer` is
the de facto standard of the Node ecosystem, with no provider SDK
(SES/SendGrid/Mailgun) and no heavy dependency tree — zero dependencies of
its own.

### `MAIL_TRANSPORT`: explicit toggle, never inference

`log` (default, **including in production**) or `smtp`. Sending real email
is an opt-in by the operator — without an explicit `MAIL_TRANSPORT=smtp`,
behavior stays exactly as it is today, even in production, and whoever
already runs the product doesn't break on upgrade.
`docker-compose.prod.yml`/`docker-compose.yml` have no public fallback for
the five `SMTP_*` variables: each one resolves to an empty string when
absent (`${SMTP_HOST:-}`), the same pattern
`AUTH_JWT_SECRET`/`BRABO_SERVICE_TOKEN` already use there.

### Validation follows the RN-114 pattern, with one difference

The original RN-114 rules (`AUTH_JWT_SECRET`, `BRABO_SERVICE_TOKEN`,
`CREDENTIALS_MASTER_KEY`, `SECRET_KEY_BASE`) crash the boot in production
because the variable HAS a public development default, and "not empty"
wouldn't catch the defect. Here there's no such default: `SMTP_HOST`
stays blank if nobody sets it. The rule (missing/whitespace-only/example
value from the repository/invalid format) is only applied when
`NODE_ENV=production` — outside of production, `MAIL_TRANSPORT=smtp`
without the variables doesn't crash the boot, because it's an opt-in path
a developer may be testing against a local SMTP server (MailHog, for
example) without values defined yet.

`apps/api/src/infrastructure/mail/smtp-config.ts` (`resolverConfigSmtp`)
follows the same format as `apps/api/src/infrastructure/security/
auth-key-material.ts`/`service-token.ts`: `SMTP_HOST`/`SMTP_USER`/
`SMTP_PASSWORD`/`SMTP_FROM` are required in production when the mode is
`smtp`; `SMTP_HOST` is additionally refused if it equals the literal
published (commented) in `.env.example`; `SMTP_FROM` must match
`"Name <email@domain>"` or `email@domain`. `SMTP_PORT` (default `587`) and
`SMTP_SECURE` (default `false`) are not secrets — they have a PRODUCT
default, not a development one, and don't go through the "required in
production" rule.

Validation runs inside `SmtpMailSender`'s constructor, exercised by
`AuthUseCasesModule`'s `useFactory` — not an eager call in `main.ts` like
the four RN-114 secrets. The difference is deliberate:
`AuthUseCasesModule` is imported unconditionally (via `AuthHttpModule`)
and the `useFactory` resolves `MailSender` during `NestFactory.create()`,
so validation still happens at BOOT — just not before it, because it only
matters when the operator opted into `smtp`. It's the same design
`CREDENTIALS_MASTER_KEY` already uses (validated in
`EnvelopeEncryptionService`'s constructor, exercised by the assembly of the
provider graph).

### Selection via `useFactory`

`AuthUseCasesModule` swaps `{ provide: MailSender, useClass:
LogMailSender }` for a `useFactory` that reads `resolverModoDeTransporte()`
and instantiates either `SmtpMailSender` or `LogMailSender`. No use case
(`RegisterUseCase`, `RequestPasswordResetUseCase`, `LoginUseCase`, the
`migrate-keycloak-users.ts` script) changes — all of them keep injecting
`MailSender` and calling `.enviar()`.

### Plain-text body, never HTML

The port carries no structure for rich content, and a template engine
would be injection/XSS surface for a gain nobody asked for. Each `tipo`
has a fixed pt-BR text, with the link when it makes sense, built from
`WEB_ORIGIN` (the same raw read `auth.controller.ts`/`git.controller.ts`
already do for redirects) + the right web route + `?token=`.

### The raw token and the body never go to the log

Same rule as `LogMailSender`: success and failure of sending cite `tipo`
and recipient, never the token nor the email's text.

### The verification-link gap, closed along the way

Investigating call sites before implementing: the `/definir-senha` web
route already exists and handles `password_reset`/`set_initial_password`
(`SetPasswordPage.tsx`), but there was **no route or screen for
`email_verification`** — the api already exposed `POST /auth/verify-email`
and the web client (`apps/web/src/lib/auth.ts`, `verificarEmail`) already
existed, but with no caller. With `LogMailSender`, that gap was invisible:
the link never left the log and nobody clicked it. With real SMTP, the
email would arrive with a dead link.

`/verificar-email?token=...` (`VerifyEmailPage.tsx`) closes this,
mirroring `SetPasswordPage.tsx`/`setPasswordRoute`: same `validateSearch`
pattern in `router.tsx`, same single response for a
nonexistent/expired/already-used link, and the same outcome of never
logging anyone in — except here there's no form: confirmation fires on
its own when the page mounts (there's no input for the user to fill in),
and that's why the screen needs all three RN-088 states
(loading/error/success), not just two.

## Consequences

**Deliberately breaks nothing.** With `MAIL_TRANSPORT` unset — in any
environment, including production — behavior stays as it is today
(log-only). Whoever wants real email makes an explicit opt-in and then has
the five variables validated at boot when running in production.

**New production dependency:** `nodemailer` (+ `@types/nodemailer` as a
dev dependency). Zero transitive dependencies of its own.

**New infrastructure secret:** `SMTP_PASSWORD` — same family as
`AUTH_JWT_SECRET`/`GIT_OAUTH_STATE_SECRET` (a plain environment variable,
validated at boot), not a user secret (it doesn't go through
`EncryptionService`/envelope encryption, which is only for LLM/git
credentials stored in the database).

**New external network path** in a sensitive authentication flow —
RN-030 through RN-033 (anti-enumeration) remain untouched: the SMTP
implementation doesn't change ANY call site nor the payload the use cases
decide to send, only the delivery.

**Recorded but not closed here:** there's no retry mechanism for an
email that fails to send via SMTP (timeout, credential rejected by the
provider). `LoginUseCase.enviarDefinicaoDeSenha` already swallowed the
failure on purpose (doesn't change the HTTP response);
`RegisterUseCase`/`RequestPasswordResetUseCase` propagate the exception,
and an SMTP provider that's down becomes a 500 on the auth route. This was
already true with any synchronous `MailSender` implementation and doesn't
get worse with this one — a send outbox/queue, if ever needed, is a
separate product decision, out of this ADR's scope.

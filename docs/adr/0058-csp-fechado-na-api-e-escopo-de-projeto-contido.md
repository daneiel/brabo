# ADR 0058 — Closed CSP on the api, and project scope contained at the root

- **Status:** accepted
- **Date:** 2026-08-08
- **Context:** open CodeQL alerts (2026-08-04 scan)
- **Revises:** [ADR 0027](0027-fase5-backup-hardening-release.md), item 7
- **Touches:** [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md)

## Context

The CodeQL code scan left ten HIGH alerts open. Seven of them are false
positives and were dismissed with a written reason directly in GitHub (the
list is at the end of this document, because the reason for dismissing is
also a decision). The other three are real and change the design, which is
what this ADR records.

### 1. `contentSecurityPolicy: false` (`js/insecure-helmet-configuration`)

[ADR 0027](0027-fase5-backup-hardening-release.md), item 7, decided "helmet
on the api, CSP only on the web", with `contentSecurityPolicy: false`. The
argument was: the api serves JSON, whoever runs script is the web, and the
web's CSP already exists and is more specific
(`docker/web/nginx.conf`, with `connect-src` assembled per environment).
Turning on a **generic** CSP on the api would give the impression of
coverage without adding any real defense.

That argument remains correct in what it claims, and that is why it survived
a whole phase. What it did not consider is that the alternative to a generic
CSP is not no header at all — it is a **specific** one. And for an api that
only serves JSON, the specific one is the most closed possible:
`default-src 'none'`. It never loads script, stylesheet, image, font, or
frame, so denying everything costs zero behavior.

And there are two concrete paths where an api response becomes an execution
surface, in which the web's CSP is not present because the web is not in the
path:

- **direct navigation** to an api route — a pasted link, a redirect, a tab
  the user opened. The browser renders the response at the API's ORIGIN,
  where the web nginx's CSP does not apply;
- **`frame-ancestors`**, which only has an effect on the framed document. No
  CSP from the web stops a third party from framing an api route.

### 2. `join(root, projectId)` without validating `projectId` (`js/path-injection`)

`projectId` arrives in `@Param('projectId')` with no validation pipe, and
Express **decodes the segment's percent-encoding before delivering it**: a
`..%2F..%2Fetc` arrives as `../../etc`, and `join` resolves outside the root
without complaint.

The reach is bigger than "reads the wrong file". `projectScopeRoot` has two
consumers, and the second one hurts:

- `permissions.json` would be read **and written** at an arbitrary path
  (`fs-permissions-file-store.ts`);
- the path scope from
  [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md) authorizes
  terminal commands under that folder
  (`propose-action.use-case.ts` → `decide.ts`). A scope that escapes the
  root is the approval policy pointing at the wrong place — a SECURITY
  failure, not a file-not-found one.

### 3. Incomplete table cell escaping (`js/incomplete-sanitization`)

In the promotion PR body (`scripts/ci/promote.ts`), the PR title was escaped
with `.replace(/\|/g, '\\|')`. Escaping only the pipe lets through a title
ending in a backslash: `a\` followed by `|` becomes `a\\|`, which the GFM
table parser reads as an escaped backslash followed by a column DELIMITER.

## Decision

**1. The api sends a CSP, and it is closed.** The helmet options move out of
the literal in `main.ts` into
`infrastructure/security/security-headers.ts` — the same move `cors-origins.ts`
had already made, and for the same reason: in the boot literal they weren't
testable, and no test saw which header the api actually sent.

In production:

```
default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
```

Outside production, `main.ts` mounts the Swagger UI at `/docs`, which is
real HTML and needs its own script, style, and image — under
`default-src 'none'` the page would open blank. The development profile
loosens exactly what's needed for Swagger and nothing beyond that. The
condition is EXACTLY the same one that mounts Swagger
(`NODE_ENV !== 'production'`), and that is deliberate: if Swagger ever
starts being mounted in production, the CSP follows suit instead of silently
blocking it.

`'unsafe-inline'` only appears in the development profile, and it is a
Swagger UI limitation (it injects an inline initializer), not our choice.

`crossOriginResourcePolicy` stops being `false` and becomes
`{ policy: 'cross-origin' }`. The effect on the browser is the same — the
web is a different origin and needs to consume these responses — but the
intent is now STATED in the header instead of implied by its absence.

**2. `projectId` is validated where the root is derived**, not at each
caller. `projectScopeRoot` rejects anything that is not a simple path
segment (`^[A-Za-z0-9_-]{1,64}$`), throwing. The check is deliberately wider
than a UUID so as not to lock down the id format, and narrow enough that the
result can never escape the root.

Validating in a single place is the same reason this function exists in the
first place: the two derivations have to agree, and a duplicated check is a
check that one day diverges.

**3. Cell escaping escapes the backslash before the pipe**, in
`celulaDeTabela`. This applies to a TEXT cell; in a cell that is a code span
the backslash is literal and escaping it would render a visible `\\` — which
is why the function is not used in columns between backticks.

## Consequences

- The api now sends `Content-Security-Policy` on every response. Anyone
  relying on opening an api route directly in the browser and seeing
  something more than raw JSON no longer can — and there was no such case.
- A malformed `projectId` now FAILS instead of resolving outside the root.
  The happy path does not change: every real id is a UUID coming from the
  database.
- The headers stopped being invisible to testing. The proof is a real
  request against the middleware, not an assertion about the config object —
  `false` and a directives object are both "valid configuration", and the
  difference between them only shows up in the HTTP response.

## What was dismissed, and why

Dismissing with a written reason is a response; leaving it open silently is
not. The seven:

| alert | rule | reason |
|---|---|---|
| #5 | `js/insufficient-password-hash` | There is no password. The `secret` is `GIT_OAUTH_STATE_SECRET`, a server-side HMAC key, and HMAC-SHA256 is the RIGHT primitive for signing an OAuth `state`. A slow hash here would be a mistake. User passwords in the product use argon2id, in `argon2-password-hasher.ts`. |
| #4 | `js/loop-bound-injection` | The loop terminates. `b` is the result of `String.prototype.split` — a real array, `.length` cannot be forged, and `j` increments every round. The rule's premise (a controlled object with a fake `.length`) does not hold here. |
| #7, #8 | `js/incomplete-sanitization` | In `scripts/docs/generate.mjs` both cells are **code spans** (between backticks), where the backslash is literal: escaping it would render a visible `\\` — the "fix" would break the output. Inputs are content from this very repository (scripts from `package.json`, doc section labels), in a build generator. |
| #9 | `js/incomplete-multi-character-sanitization` | It is a TEST file. The `replace` strips comments from an `index.html` versioned IN THIS repository to assert it doesn't reference a font CDN. It is not an untrusted-input sanitization boundary. |
| #1, #2, #3 | `js/path-injection` | Closed by decision 2 above; the dismissal doesn't apply to them — they're listed here only so the ten close out. |

Left open, in Dependabot: `image-size` (two HIGH alerts). There is no fixed
version published — 2.0.2 is the latest on the registry and it is the
vulnerable one. It comes in through `@docusaurus/mdx-loader`, the doc build,
reading images versioned in this repository; there is no untrusted input in
the path.

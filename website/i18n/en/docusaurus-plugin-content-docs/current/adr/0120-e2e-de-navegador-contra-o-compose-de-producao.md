# ADR 0120 — Browser E2E against the production compose, in a package outside the workspace

- **Status:** accepted
- **Date:** 2026-08-29
- **References (without editing):** [ADR 0032](0032-corte-do-keycloak-e-sessao-em-cookie.md)
  (the cookie session this layer exists to prove),
  [ADR 0117](0117-lockfile-proprio-para-o-website.md) (the precedent for a
  dev-only subtree with its own lockfile),
  [ADR 0027](0027-fase5-backup-hardening-release.md) (the production smoke
  this reuses instead of duplicating).

## Context

The test pyramid was strong at the bottom and had a hole at the top. The
api has 142 specs, the engine 126, the web tests component by component
under jsdom, and `docker/smoke.sh` proves over HTTP that the four
production images boot and talk to each other.

None of those exercises a **browser**. And the mechanisms that carry the
session are browser mechanisms:

- the access token lives in memory and the refresh in an `httpOnly`
  cookie, paired with a readable `brabo_csrf` sent as `X-CSRF-Token`;
- the web is served from `:8088` and the api answers on `:3000`, so every
  authenticated call is **cross-origin** — preflight, `SameSite`,
  `credentials: 'include'`;
- the session channel needs a single-use ticket ([RN-108](../business-rules/autenticacao.md#rn-108))
  and a real WebSocket handshake against the engine, on a **third** origin.

jsdom has none of that. It has no real origin, does no preflight, and
`httpOnly` is not a thing it can enforce — a test asserting the refresh
is unreadable would pass there while proving nothing. `apps/api/src/main.ts`
already carries the comment that says it plainly: "teste não faz preflight."

This is not a hypothetical gap. It's where the last cookie, CORS and
socket bugs actually appeared, and each was found by hand.

## Decision

**A browser E2E layer, in `e2e/`, running against the production compose
that CI already brings up.**

Three parts to the decision, each with its own reason.

### It runs against `docker-compose.prod.yml`, not `vite dev`

The cross-origin split (`:8088` → `:3000` → `:4000`) exists only in the
production compose. Running against the dev server would exercise a
topology nobody deploys and would silently stop proving the one thing
this layer is for. So the job reuses `docker/smoke.sh` with
`SMOKE_KEEP_UP=1`: same images, same compose, one build.

It also runs in the **same CI job** as the images. The four images are
most of that job's wall clock; a separate job would rebuild them to
exercise the identical stack.

### `e2e/` is not a member of the pnpm workspace

Same shape as `website/` ([ADR 0117](0117-lockfile-proprio-para-o-website.md)):
its own `pnpm-workspace.yaml` and `pnpm-lock.yaml`, installed with
`pnpm install` from **inside** the folder, driven from the root by
`pnpm --dir e2e`.

The reason is the same one: Playwright's tree never reaches any product
image, and leaving it in the root lockfile would make the product's
`pnpm audit` report test tooling as if it were shipped surface. The
difference from the website — that this package *tests* the product —
doesn't change the argument, because what decides is where the dependency
**goes**, not what it talks about.

### It proves mechanisms, not screens

The specs assert on observable mechanism: the `httpOnly` flag as the
browser reports it, `document.cookie` as the page sees it, survival
across a reload, the WebSocket URL carrying `ticket=`. Selectors are
structural (`input[type="email"]`), never text — the interface language
is decided by the server, and a test pinned to "Sign in" would break on a
language change, a failure that says nothing about the product.

Seeding (workspace → project → session) goes over HTTP, mirroring
`smoke.sh`. The browser is expensive and the project wizard is not what
this layer exists to prove; slow setup is setup that gets switched off.

## Consequences

- The gap closes for the paths that only a browser reaches. Both specs
  were **proven by mutation**: a wrong password turns the auth specs red,
  and pointing the socket assertion at a path that doesn't exist fails
  with "nenhum WebSocket foi aberto contra o engine."
- The `images` job grows: pnpm/Node setup, a chromium download, and the
  run itself. In exchange it stays one job and one image build.
- Chromium only. One browser proves the mechanism; the other two would
  cost download and time to prove the same thing again. Cross-browser
  differences are a real risk this decision **declares it is not
  covering**.
- The browser binary is downloaded at CI time from Playwright's CDN. Its
  version is pinned by the exact `@playwright/test` version in the
  lockfile, which is how this download fits the repository's pinning
  discipline — see
  [cadeia-de-suprimentos-do-ci.md](../explanation/cadeia-de-suprimentos-do-ci.md).
- **One retry in CI, none locally.** E2E against a live stack has flake
  with external causes (a container still coming up, a slow socket). Zero
  retries would turn that into noise that teaches people to ignore red.
- Two specs is a floor, not a suite. Inline approval and streaming — named
  in the original finding — are **not** covered yet.
- **The suite has a login budget, and it came from running it for real.**
  The api defends `/auth/login` with a progressive per-IP lockout that
  answers with the *same uniform 401* as a wrong password — distinguishing
  them would tell an attacker when they guessed the email right. Running
  the suite repeatedly inside the 15-minute window trips it, and the
  failure then accuses the login, which is not where the defect is. Two
  consequences were taken: the browser logs in **once** per run (a `setup`
  project saves the state; only `autenticacao.spec.ts` opts out, because
  proving login needs a clean origin), and `suporte/api.ts` recognizes that
  401 and says what it probably is. The alternative — asking the compose
  for a laxer threshold so the suite could log in freely — was rejected:
  it would weaken the thing being tested to make testing convenient.

## Alternatives considered

**`e2e/` inside the pnpm workspace.** One install, no second lockfile.
Rejected for the reason ADR 0117 had just finished paying for: the
product's audit would carry Playwright's tree.

**Run against `vite dev`.** Faster, no images to build. Rejected because
it would test a topology that is not deployed, and the same-origin dev
server makes every assertion in `autenticacao.spec.ts` vacuous.

**A dedicated E2E job.** Cleaner separation, and a failure there wouldn't
be reported under "images". Rejected on cost: it would rebuild the four
images to reach the same compose.

**Drive project creation through the wizard instead of seeding by HTTP.**
More realistic, and it would cover the wizard. Rejected for now — it
would make the run several times longer and couple this layer to a git
provider, for coverage that belongs to a wizard-specific spec if one is
ever wanted.

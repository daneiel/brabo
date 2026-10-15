# 0036 — Auth screens faithful to the design, and the three fonts that weren't loading

## Context

The four auth screens — `/login`, `/registrar`, `/esqueci-senha`,
`/definir-senha` — were born in [ADR 0032](0032-corte-do-keycloak-e-sessao-em-cookie.md),
alongside the Keycloak cut. They were born **functional**: they
authenticate, handle errors, navigate, and all of the anti-enumeration
properties from [ADR 0031](0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)
are there. What never existed was design.

The reason is written into the very code they replaced: Keycloak served
that surface, so it was never designed. `design/SCREENS.md`, the design
system's screen catalog, **has no login section** — the gap predates the
screens. They were assembled from the base specs in
`design/COMPONENTS.md` and from the semantic tokens, which is the best
that could be done without a mock, and the result was a gray card with no
branding, the migration notice as loose prose in the footer, and no page
footer at all.

Two discoveries reshaped this session.

### 1. The mock exists, but not in the repository

A login mock was created in the external design project **after** the
2026-07-23 curation that produced `design/tokens.css` and
`design/COMPONENTS.md`:

- project `1c960ca8-5e00-4558-8ced-80dfbdf01027`, file `Brabo Login.dc.html`.

It's the authoritative spec for this work, and it lives outside version
control. Whoever reviews this later has no way to double-check it without
access to the design project — hence the obligation, recorded in decision
9, that the screen enter `design/SCREENS.md`.

### 2. The design system's three fonts weren't loading in production

`apps/web/index.html` pulled Space Grotesk, Archivo and IBM Plex Mono from
Google Fonts via `<link>`. The production image's CSP, in
`docker/web/nginx.conf`, is:

```
style-src 'self' 'unsafe-inline'; font-src 'self' data:
```

It **blocks both the stylesheet and the font files**. No `.woff2` was
checked in. So, in the nginx container, all three families fell back to
the system font — and since `--font-heading` and `--font-body` share the
`sans-serif` fallback, **the typographic distinction between heading and
body simply disappeared**. `index.css` has `font-synthesis: none`, so the
browser wasn't even synthesizing weight 700.

This was invisible in `pnpm dev`, where there's no nginx and no CSP. And
the comment at the top of `design/tokens.css` claimed loading happened
"via `<link>` in the `<head>` of the HTML that consumes this file" —
accurately describing a mechanism that the production image itself
forbade.

This isn't a hypothesis or future debt: it was a production defect, in
typography, which is the very first thing the design system specifies.

## Decision

### 1. Self-host all three families

Eight `.woff2` files in `apps/web/public/fonts/`, with `@font-face` in
`apps/web/src/index.css` and `font-display: swap`. Google's `<link>` goes
away. This satisfies the current CSP **without loosening it** — the
alternative was adding `fonts.googleapis.com` and `fonts.gstatic.com` to
`style-src` and `font-src`, which trades one defect for two third-party
dependencies on the critical render path.

`@font-face` lives in `index.css` and **not** in `design/tokens.css`:
loading is the responsibility of whoever consumes the tokens, and that
file's comment now says exactly that instead of what it used to say.

Space Grotesk and Archivo are **variable** fonts and go in with a weight
range (`font-weight: 500 700` and `400 600`); IBM Plex Mono is static and
goes in with one `@font-face` per weight. The distinction was verified by
decoding each `.woff2`'s table directory and looking for the `fvar` table
— declaring a range on a static font makes the browser synthesize the
missing weight, which is exactly what `font-synthesis: none` exists to
prevent.

**Licensing obligation.** All three are OFL 1.1, which requires
distributing the copyright notice alongside the binary.
`apps/web/public/fonts/LICENSE.txt` carries the license and the three
notices, and `THIRD_PARTY_NOTICES.md` no longer says "loaded via CDN, not
bundled" — because now they're bundled, and the obligation now applies.

### 2. Two-layer verification, because one layer isn't enough

- **Test** (`apps/web/test/fontes.test.ts`): every `@font-face` `url()` in
  `index.css` resolves to an existing file with a `wOF2` signature; every
  block has `font-display: swap` and `unicode-range`; the weight range
  matches variable-vs-static; and `index.html` does **not** mention
  `fonts.googleapis.com`.
- **Gate in `docker/web/Dockerfile.prod`**: the directory exists, has the
  eight files, and the published `index.html` doesn't reference the CDN.

Neither one proves the font is actually **rendered**. jsdom doesn't apply
CSS Modules or resolve `var()` from `@import`, and `getComputedStyle`
returns what was written, not what was resolved. Proof of rendering is
manual verification in the container, and it's recorded as such.

### 3. `AuthLayout` becomes the whole frame

It used to be just the card and nothing else. The mock adds two pieces
that apply equally to all four screens — a brand header above the card
and a page footer below — and they live in the frame, not the screen.
Each screen fills four slots: `titulo`, `subtitulo`, `rodapeDoCartao` and
`abaixoDoCartao`.

The card's title is the only `<h1>`; "Brabo" is a `<span>`. Promoting the
brand to a heading would produce two `<h1>`s and would make a screen
reader's heading list start with the brand on every screen, instead of
saying what that screen is for.

### 4. Four design-system components, and the criterion for where each thing lives

| piece | where it landed | why |
|---|---|---|
| `Alert` | new component in `components/ui/` | needed in four tones across all four screens; before, each screen had its own `.aviso`/`.banner` class, copied with slightly different spacing |
| `loading` on `Button` | prop on the DS | each screen was swapping the label by hand; for a screen reader user the button just went disabled, with no indication that work was in progress |
| filled field | `preenchido` prop on `Input`, opt-in | `Input` is used by five screens outside auth; changing the default would silently restyle all five |
| reveal password | `revelavel` prop on `Input` | it's field anatomy, not screen anatomy: the button sits inside the box and toggles `type`. Both password screens inherit it |
| brand header | local, inside `AuthLayout` | it's screen framing, not a library component |
| `LogoMark` | new icon | the existing `BrandIcon` is a different drawing (isometric cube); the mock's is a bar plus two chevrons |

**The `Alert`'s `role` is a prop, and it's not derived from the tone.**
`role="alert"` is an assertive live region: the screen reader interrupts
whatever it's saying. That's right for the result of an action the user
just triggered, and wrong for text that was already on screen when it
opened. If tone decided the role, the migration notice (`warning` tone)
would land in the same live region as the credential error — and the
"email or password incorrect" announcement would end up including "the
old password wasn't migrated," precisely the hint about the account that
ADR 0031's uniform 401 exists to prevent.

**`Button`'s `fullWidth` was broken.** The rule was `flex: 1`, which only
has an effect if the parent is flex or grid — and none of the containers
using the prop are. It was passed in seven places, all in the auth
screens, and stretched nothing: "full-width button" showed up as a design
requirement while the button had the width of its text. It became
`width: 100%`.

### 5. Where each error shows up

The credential error moves off the Password field and becomes an alert at
the top of the card. Form error and field error become distinct things
across the four screens:

- **field-level** (short password, mismatched confirmation): under the
  field, with `aria-invalid`, because that's where it gets fixed;
- **form-level** (rejected credential, invalid link, network failure): in
  the top alert, because it doesn't point at any particular field.

A rejected credential gets no `aria-invalid` on either field: neither the
email nor the password is individually malformed, and the api doesn't say
which one was wrong. Marking both would claim more than is actually
known.

The copy changes from `E-mail ou senha inválidos.` to `E-mail ou senha
incorretos.`. The 403 case (`Confirme seu e-mail…`) stays distinct, as ADR
0032 and [RN-032](../business-rules/autenticacao.md#rn-032) require: the uniformity is
between "doesn't exist," "wrong password" and "account locked" — not with
"email not verified," which is only reachable **after** the password has
been proven correct.

### 6. The real version in the footer, and the chain that didn't exist

The footer shows the artifact's version. While wiring it up, it turned
out that `BRABO_VERSION` was **never defined anywhere in the
repository**: the api read it for the OpenTelemetry resource's
`service.version` and always got the `dev` fallback, so every span in
every environment said `dev` and the attribute was useless for exactly
the purpose it serves. And `docs/reference/configuration.md` claimed that
"the release image injects the tag" and that it "shows up in `/health`" —
both false.

The chain now exists, and it's a single one for both services:
`release.yml` computes `versao=${TAG#v}` → passes `VERSION` to `docker
buildx bake` → the bakefile converts it into `BRABO_VERSION` (`api`
target) and `VITE_BRABO_VERSION` (`web` target) → each `Dockerfile.prod`
declares it as an `ARG` with default `dev` → Vite inlines it →
`runtime-config.ts` reads it → `AuthLayout` shows it.

**Build-time, even though [ADR 0024](0024-fase5-imagens-producao-ci.md)
chose runtime for URLs.** The reason there was to promote the SAME image
across environments, and a URL is a property of the environment. Version
is a property of the **artifact**: `brabo-web:1.1.2` shouldn't be able to
report anything else, or the footer becomes an editable field instead of
an identity.

`VERSION` is kept separate from `TAG` in the bakefile because `ci.yml`
uses `TAG=prod`, and "prod" isn't a version of anything.

### 7. `/status` no longer requires a session

The footer links to `/status`, and it sat behind the session guard:
clicking "Status" on the login screen redirected back to the login screen
— the one destination it can never have. It moved to a new
`publicLayout`, sibling to the auth one. It's safe: the page only queries
the api's and engine's `/health` endpoints, which were already public
because it's the kubelet that calls them, before any token exists.

### 8. Contrast computed from the tokens, not measured by axe

axe runs on all four screens, in the empty, error and success states —
but with the `color-contrast` rule **explicitly turned off**. It needs
layout and resolved color, and jsdom has neither: running it there would
produce a "pass" without having looked at anything, which is worse than
no test at all because it looks like coverage.

Contrast is verified by direct computation over `design/tokens.css`, using
WCAG 2.1's luminance formula, for the pairs the screens actually use.
Four failed 4.5:1. Three were fixed with tokens that already existed:

| pair | was | became | reason |
|---|---|---|---|
| `Input`'s `.hint` | `--text-muted` (3.89) | `--text-secondary` (8.00) | applied to the five non-auth screens too |
| auth's `.link` | `--accent` (3.88) | `--accent-hover` (4.90) | same hue, one shade lighter |
| filled field's placeholder | `--text-muted` (3.10) | `--text-secondary` (6.37) | placeholder is text |

The fourth was **not** fixed, and it's the most visible one: `--on-accent`
over `--accent` yields **3.20:1** on the primary button, which requires
4.5 (14px/600 text). It's the design system's terracotta pair, used on
every primary button in the app; fixing it requires darkening `--accent`
down to `--terracota-500` (5.27:1), which changes the brand color across
the whole UI. That's a design decision, not an implementation one, and it
stays recorded as a pending item with the number locked in a test, so it
can't get worse without anyone noticing.

### 9. The screen enters `design/`

`design/` is the source of truth for the UI and had no spec for alert,
button loading, or filled field — the three things this work creates. All
three anatomies go into `design/COMPONENTS.md`, and `design/SCREENS.md`
gains the login section that never existed. That's what closes the gap
that caused the problem in the first place, and it's the only way
fidelity can be re-checked by someone without access to the mock.

## Consequences

### Deliberate divergences from the mock

| # | divergence | reason |
|---|---|---|
| 1 | no "Continue with GitHub" | social login is conscious Phase 7 backlog, already recorded in ADR 0031 and reaffirmed in 0032. Nothing new here — just the observation that the mock designed something the phase decided not to have |
| 2 | no "N agents online" | dynamic pre-authentication data widens the surface unnecessarily: it would require a public route counting agents. It's a candidate for an internal panel, not the login screen |
| 3 | field in `--surface-2`, not `--code-bg` | explicit choice: raised field instead of a recessed one. Over a `--surface-1` card, the field's default background is the SAME as the card |
| 4 | `.link` in `--accent-hover` | contrast — see decision 8 |
| 5 | `--shadow` from the tokens, not the mock's redefinition | the mock is a standalone file that overrode the token on its own `:root`. The token's source of truth is the design system |
| 6 | "Forgot my password" is a sibling of the `<label>`, not a child | clicking anywhere inside a `<label>` activates its associated field; inside the label, clicking the link would also focus the password field |

**Consequence derived from #1**: the mock's "or" divider exists **only**
to separate the two buttons. Without the second one, it goes too —
keeping an "or" pointing at nothing would be worse than the asymmetry.

**Consequence of #2**: the card's footer is left with one item, so the
mock's `justify-content: space-between` becomes explicit left alignment.

### What remains pending, and why

- **The primary button's contrast** (3.20:1). Needs a decision about the
  brand color. It's the only AA failure left across the screens.
- **The same field problem on the other five screens**: `Input`'s default
  is `--surface-1` over a `--surface-1` card, separated by a 1px border.
  The variant is opt-in, so nothing changed there — and nothing was
  fixed.
- **`data-theme="light"` remains unexercised.** It exists in the tokens
  and nothing sets it. The screens use only semantic tokens, so they
  inherit the light theme if someone turns it on, but three of its pairs
  fail AA — stated as a record in the contrast test, not as a guarantee.
- **Fidelity is checked against an unversioned file.** Mitigated by
  decision 9, not eliminated.
- **No test proves the font actually renders.** See decision 2.

### Two new dependencies, both dev-only

`@testing-library/user-event` (focus order) and `axe-core` (structural
a11y). Neither is a runtime one — the bundle doesn't change.

`axe-core` directly, and not the `vitest-axe` wrapper that would be the
obvious path: the wrapper adds a matcher and a dependency to save six
lines, and with the direct call the list of disabled rules stays visible
in the test file, where whoever disables the next one will have to write
down why.

The harness was checked against a real violation — an input with no
`<label>` and a button with no accessible name — before trusting the
green run. An a11y test that passes by not actually looking is this
tool's default failure mode in jsdom.

# 0074 — Reachable theme, and the boot under CSP

**Status:** accepted · 2026-08-14

## Context

`design/tokens.css` has had two themes since day one. Dark is the primary
one and lives on `:root`; light lives on `[data-theme='light']`, is measured
by a parity test (every semantic color token must be redeclared there), and
is cited in `design/README.md` as if it were a screen in the product.

It never was one. **Nothing in `apps/web` wrote `data-theme` anywhere** —
not `index.html`, not `main.tsx`, no component at all. The selector existed,
the values existed, and the only way to see the light theme was to type the
attribute into DevTools by hand. The test
`apps/web/test/design-contraste.test.ts` knew this and said so in plain
words: *"`[data-theme='light']` exists in the tokens and **nothing defines
it** anywhere in the app"* — and went further, asserting by `expect` that
**three pairs failed** AA in light mode, deliberately, "as a record of what
is inherited, not a guarantee of what is rendered".

On the other side, `apps/web/src/lib/contraste.test.ts` measured the syntax
palette only in the dark theme, and the comment said why: `--accent`,
`--warning` and `--success` against light `--code-bg` already fell below
4.5:1. As long as light stayed unreachable, both files were right — measuring
a screen nobody can open is measuring an intention.

What changes that account is programa 28 asking for the theme toggle button.
Once the button is wired up, half the product's visible surface becomes a
screen that was never measured, and the three recorded failures stop being
documented debt and become a defect being served.

There is one more delivery detail that is not cosmetic. The handoff
(`design_handoff_brabo/tokens.css`) instructs: *"apply the attribute as early
as possible (inline script in the `<head>`)"*. The web production image
serves under `script-src 'self'` (`docker/web/nginx.conf`), without
`'unsafe-inline'` and without a nonce. An inline `<script>` in the head would
work in `pnpm dev:web` and would be **blocked in the published image** — the
ADR 0036 failure again, with a different subject: there the handoff asked
for the Google Fonts `<link>`, the CSP blocked it, and the symptom (the
entire typeface falling back to a system font) only showed up in production.

## Decision

**1. The theme becomes reachable, and the boot is a FILE.**

`apps/web/public/theme-boot.js` reads `localStorage['brabo.theme']`, accepts
only `'dark'` or `'light'`, and writes `data-theme` on `<html>`. Default
`dark`. It goes into `index.html` as `<script src="/theme-boot.js"></script>`,
synchronous and before the bundle, next to the `/config.js` that already
exists for the same reason.

A file, not inline, because the CSP is `script-src 'self'`. Synchronous and
before the bundle because `data-theme` decides the colors of the entire
`tokens.css`: applied after hydration, a light-theme user would see a dark
flash on every load. It's plain ES5 with no `import` — Vite's `public/` is
copied as-is, without going through the build — and a test reads the file
and fails if it stops being that.

`apps/web/src/lib/tema.ts` is the "product" half: `temaAtual`,
`aplicarTema`, `alternarTema`, `observarTema`, plus the exported key and
default. The BUTTON does not live there — it belongs to the shell. The two
files repeat the key and the default because the boot one cannot import
anything, and a test in `tema.test.ts` reads the boot file and fails if the
two diverge: it's the only way to keep the product from writing to one key
and reading from another.

Nothing on this path throws. `localStorage` can throw (private mode, storage
blocked inside an iframe), and theme is a preference, not a function: failing
there must not bring down the boot. An unknown value — a key edited by hand,
a leftover from an old version — falls back to the default instead of
becoming a `data-theme` the CSS doesn't recognize.

**2. The light theme becomes MEASURED, and the values were corrected until
they passed.**

The pairs are now measured in both themes, in the three files that measure
contrast. Six light-theme tokens changed value. The numbers are
`razaoDeContraste` over the resolved tokens, and the most demanding
background in the light theme is `--code-bg` (paper, `#efe4d2`, one step away
from the surfaces) — whatever closes against it closes against everything
else:

| token (light theme) | before | after | the pair that forced it | before → after |
|---|---|---|---|---|
| `--accent` | `#c4552d` | `#a5451f` (`--terracota-500`) | keyword over `--code-bg` | 3.56 → **4.81** |
| `--accent-hover` | `#a5451f` | `#7e3316` (`--terracota-600`) | followed the accent, one step below | 4.81 → **7.04** |
| `--warning` | `#b5701c` | `#8a5410` | string over `--code-bg` | 3.15 → **4.98** |
| `--success` | `#217e73` | `#136a60` | type over `--code-bg` | 3.89 → **5.12** |
| `--violet` | `#7b56c9` | `#6b4fb0` (handoff value) | number over `--code-bg` | 4.16 → **4.95** |
| `--text-muted` | `#80939a` | `#526670` | metadata over `--surface-0` | 2.76 → **5.17** |

Two side effects are worth recording. The first: the five pairs that in the
dark theme are **known debt** clear 4.5:1 in light after this —
`--text-muted`/`--surface-1` 3.02 → 5.68, `--text-muted`/`--surface-2` 2.40 →
4.50, `--accent`/`--surface-1` 4.23 → 5.72, `--danger`/`--surface-1` already at
5.59, `--success`/`--surface-2` 3.66 → 4.83. Light stopped carrying debt, and
that is asserted by test so it doesn't come back unnoticed. The second: the
"known design-system exception" — `--on-accent` over `--accent` at 3.20:1 on
the primary button — disappears in the light theme, because the fix the
test's comment described ("darken the accent to `--terracota-500`, 5.27:1") is
exactly what light now does. In dark the exception still stands: there,
touching the accent means touching the brand color for no forcing reason.

Light's `--text-muted` deserves its own mention. At 2.40:1 against
`--surface-2` it wasn't debt, it was a **defect**: it failed even the lowest
floor that exists, the UI-element floor (3:1). Metadata and labels are text,
and the light theme has no reason to be worse than the primary one — the new
value sits at 5.17 over `--surface-0`, above the 4.81 dark already delivered.

**3. The eight syntax roles get their own token, and the handoff value only
lands when measurement approves it.**

The highlight palette used to be three tokens (`--syntax-function`,
`--syntax-comment`, `--syntax-operator`) and five reuses of semantic ones. It
becomes the eight roles from the handoff, with the `--syntax-*` prefix the
repo already uses and its own value per theme. Naming all eight is what lets
the highlight diverge from the semantic tokens the day it needs to — which is
exactly what the handoff does.

**Five of the eight handoff values were rejected by measurement**, and this
is the item that matters most in this ADR. Against the handoff's own
`--code-bg`: `--syn-cm` gives 4.09:1 in dark and 2.32:1 in light; `--syn-kw`
4.34:1 in light; `--syn-str` 4.20:1; `--syn-fn` 4.14:1; `--syn-op` 4.00:1. All
below the 4.5:1 that code text requires. Where the handoff fails, the
measured value wins — the same rule as ADR 0036: the handoff's intent
stands, the number that fails does not. The eight close 4.5:1 against
`--code-bg` in BOTH themes, and the five semantic tokens that still actually
paint (`SyntaxTokens.module.css` was not touched by this change) get
measured alongside them — as long as they're the pixel, the floor is charged
to them.

**4. The missing names come in as ALIASES, never as a rename.**

`--font-display` and `--shadow-modal` are the handoff's names for
`--font-heading` and `--shadow-lg`. They come in pointing to those. Renaming
would be a blind synonym rename across dozens of files, and the `--r-*`
family gets the same treatment: `--r-xs` (5px) and `--r-sm` (7px) are new,
`--r-md`/`--r-lg`/`--r-pill` are aliases of the `--radius-*` tokens that
already exist, and the `--radius-*` ones stay. Note one step that does not
line up: `--r-sm` is 7px and `--radius-sm` is 4px — they are not synonyms,
and no call site was migrated here.

The `--fs-*` scale (eight steps) and the shell metrics (`--sidebar-w`,
`--sidebar-w-collapsed`, `--header-h`, `--tabs-h`) come in alongside, having
been loose in every CSS module that draws the sidebar and the tab strip.

## Consequences

**A theme flash is no longer possible, and the cost is one extra request.**
`theme-boot.js` is a file served from the same origin, cacheable, a few
hundred bytes. Over HTTP/2 it travels alongside the `/config.js` that was
already there. It's the price of not having `'unsafe-inline'` in the CSP, and
it's a price ADR 0058 already decided to pay in general.

**The dark theme did not change a single value.** No `:root` token was
altered — the five known-debt pairs remain at 3.89 / 3.10 / 3.88 / 3.88 /
4.41, locked at the same numbers as before. Anyone using the product today
sees no difference; whoever flips the toggle sees a theme that passes AA.

**The light theme ended up darker than the handoff drew it.** Light's accents
are one step below the hex values the handoff specifies, and someone
comparing the screen to the `.dc.html` will notice. The divergence is
deliberate and has the same shape as the fonts one: the handoff establishes
the intent (the family, the role, the step), measurement establishes the
number. A pretty light accent that leaves `const` illegible on a code screen
is not fidelity, it's fidelity to a prototype that never opened the Code tab.

**Five new `--syntax-*` tokens have no consumer yet.**
`SyntaxTokens.module.css` still points keyword/string/number/type/text at the
semantic tokens. This is a choice: rewiring it touches the highlighting of
the Code tab and the chat's Markdown, which belong to other fronts, and the
test covers both sets today. The day the wiring changes, the values will
already be measured — and, in light, each syntax role today carries the SAME
number as the semantic token that paints it, on purpose: two sources with
different numbers for the same pixel would diverge the first time one side
gets fixed alone.

**Three agent colors remain loose hex.** `#B9A5E8` (Psychologist light),
`#5EBEB1` (Frontend Dev) and `#8AA6AE` (SecOps), in
`apps/web/src/lib/agents.ts`, have no semantic counterpart in `tokens.css`.
The `--violet` duplicate (`#9C7BE0`, on two agents) was swapped for the
token; the remaining three stayed, declared right in the file, because
creating three new design-system colors in passing is a product decision,
not a path correction. The consequence is known: those three don't shift
with the theme — they were chosen against the dark background and look
washed out compared to the others in light.

**The preference is per browser, not per account.** It lives in
`localStorage`, so it doesn't follow the user to another machine and doesn't
appear in Settings. Following the operating system
(`prefers-color-scheme`) was also left out: `lerTemaSalvo()` returns `null`
— not the default — precisely so whoever decides this later has the
information that the person never chose. Today `null` falls to `dark`.

**One test assertion was inverted, and it's the kind of change worth
reading.** `apps/web/test/design-contraste.test.ts` asserted by `expect`
that three light-theme pairs FAIL. It wasn't a loose test: it was debt
written in the only language CI reads. With the theme now reachable, the
assertion flipped — the same auth pairs are now held to the same floor in
both themes. Anyone reading this file's history will see a `toHaveLength(3)`
turn into a battery of `toBeGreaterThanOrEqual`, and the reason is here.

## References

- [0036](0036-telas-de-auth-fieis-ao-design-e-fontes-auto-hospedadas.md) — the self-hosted fonts:
  the same failure (handoff asks for a resource the CSP blocks), the same
  outcome (intent yes, mechanism no).
- [0058](0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md) — the CSP policy that makes the
  inline script unviable.
- [RN-182](../business-rules.md#rn-182), [RN-183](../business-rules.md#rn-183),
  [RN-184](../business-rules.md#rn-184), [RN-185](../business-rules.md#rn-185).

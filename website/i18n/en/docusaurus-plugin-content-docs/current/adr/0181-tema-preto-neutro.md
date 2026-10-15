---
traducao_de: 7bfeee6425479907d175deb72a8730fc2fdc22c5
---

# ADR 0181 — The dark theme becomes neutral black, and the contrast debt ends

## Status

**Accepted.** 2026-09-30 (AT-283 and AT-284, story HS-073, epic EP-031, round
29). On top of [ADR 0074](0074-tema-alcancavel-e-o-boot-sob-csp.md) (the
reachable theme, measurement in both themes, the eight syntax roles) and
[ADR 0036](0036-telas-de-auth-fieis-ao-design-e-fontes-auto-hospedadas.md) (the
rule "the handoff establishes the intent, measurement establishes the number").
It does not edit them: 0074's MECHANISM stays whole — boot by file, both themes
measured, derived parity, the eight `--syntax-*` —; what changes is the NUMBER
of almost every color token, and with it three things 0074 asserted about the
dark theme.

## Context

The dark theme was saturated petrol blue (`--surface-0` `#061b24`, hue 198°,
saturation ~71%) with cream text and a vivid terracotta accent (`#d6633a`).
Owner decision on 2026-09-30: the product gets the market's **neutral black**
dark, calm, with a **soft** terracotta accent (identity lives in the accent, not
in the surface), and the light becomes the neutral of the same family in place
of the sand paper.

Three measured facts weighed before the switch:

1. **The dark theme carried contrast debt since PHASE 16.** Five pairs in use
   were below 4.5:1 — `--text-muted` on `--surface-1` (3.89) and `--surface-2`
   (3.10), `--accent` and `--danger` on `--surface-1` (3.88), and `--success`
   on `--surface-2` (4.41). 0074 locked them by number, and four screens changed
   token to work around them (`.hint`, `.link`, the environment state block, the
   Shell's error navigation).
2. **The primary button had a "known exception".** `--on-accent` (cream) on
   `--accent` gave 3.20:1 in dark; ADR 0036 refused to fix it because it
   "changes the brand across the whole UI". The same cream on `--success` in
   `Button` gave 2.07:1.
3. **Color outside the tokens.** Three spots that paint with a runtime library
   (Mermaid, xterm, the minimap canvas) had 27 hand-written fallback hexes, in
   the former petrol, and the C4 "person" used the RAW palette
   `--teal-400/600`. Three agent colors were loose hexes in `lib/agents.ts`,
   calibrated only against dark. The `Modal` overlay was petrol in `rgba`. And
   two tokens in use did not exist: `--surface-3` and `--radius-pill`.

## Decision

**1. The semantic values change; the names do not.** No module needs to change
references: `--surface-*`, `--text-*`, `--accent*`, `--on-accent`, states,
`--violet`, borders, `--code-bg`, `--diff-*` and the eight `--syntax-*` keep the
same names. A raw scale **`--neutro-*`** enters (`000`…`950`, hueless zinc) that
both themes' surfaces, secondary text and borders reference; the four old raw
matrices stay (nobody uses them in the UI, and removing them would buy nothing).

**2. The number comes from measurement, not from the draft.** The owner's draft
was the starting point; where it failed, the number was adjusted until the floor
passed:

| token (dark) | draft | final | why |
|---|---|---|---|
| `--text-muted` | `#71717a` | `#86868f` | the draft repeated the debt (3.80 / 3.51 on card and header); the final measures 5.38 / 5.10 / 4.70 and stays below `--text-secondary` |
| `--on-accent` | (light) | `--neutro-900` | white on `#c8744f` would give 3.46 and 2.68 on hover; neutral black measures 5.61 / 7.25, and 7.65 on `--success`, 5.24 on `--danger` |

| token (light) | draft | final | why |
|---|---|---|---|
| `--text-muted` | `#71717a` | `#696972` | the draft gave 4.40 on `--surface-2`, and light closes text at 4.5 since 0074 |

The rest of the draft passed as it came: surfaces `#0d0d0f/#141417/#1c1c21`,
borders `#2a2a30/#3a3a42`, text `#ececef/#a1a1aa`, accent `#c8744f`, states
`#3fb68b/#d4a13a/#e5534b`, `--code-bg` `#0a0a0c`; in light `#ffffff/#fafafa/
#f4f4f5`, text `#18181b/#52525b` and the darkened terracotta `#a4502c` (5.08
against `--code-bg`, 5.58 with the button's white). The eight `--syntax-*` were
recomputed against the two new `--code-bg` and pass 4.5:1 in both themes (the
lowest is light's `--syntax-type`, 4.85). The accent stays terracotta: the hue
stays at ~18° in both themes, and that is enforced by a test.

**3. The dark debt ends, and what was a locked number becomes a FLOOR.** The
five debt pairs pass 4.5:1 in both themes, and the test now enforces the floor
instead of "still at 3.89". The two INVERTED assertions of
`design-contraste.test.ts` ("muted fails on card", "accent fails on card") were
rewritten as floors, and the consumers revised: `.link` (AuthLayout) goes back
to the `--accent` the mock always asked for; `.hint` (Input) stays on
`--text-secondary`, now for hierarchy and not for contrast. The primary button
exception ceases to exist, and the fix did not change the brand — it changed the
TEXT on it.

**4. Color outside the tokens enters the tokens (AT-284).**

- `apps/web/src/lib/tokens-padrao.ts` keeps ONE copy of the primary theme's
  values for Mermaid, xterm and minimap, and `tokens-padrao.test.ts` fails when
  it diverges from `:root`. The C4 "person" moves to `--accent` on
  `--surface-1`.
- `--agent-leve`, `--agent-frontend` and `--agent-secops` are born with a value
  per theme and are measured at 3:1 on the three surfaces; `lib/agents.ts` now
  has only `var(--token)`, and a test fails hexes.
- `--overlay` is the `Modal` veil, per theme.
- `--surface-3` and `--radius-pill` are NOT born: the two uses fall to what they
  already rendered (`--surface-1`/`--surface-2` and `--r-pill`), and
  `design-tokens-existentes.test.ts` fails the next `var(--x)` without a
  declaration in CSS nor a runtime write.

## Consequences

- The `CLAUDE.md` gap "dark theme contrast debt locked by number (ADR 0074)"
  closes. The rule of never loosening a floor stays, now with no recorded
  exception.
- The modules' 111 `color-mix()` (AT-285) were NOT revised here: they mix tokens
  and remain valid, but each one's visual result changes with the new base, and
  the review belongs to its own lane.
- Several CSS module comments cite the old debt numbers (`Shell.module.css`,
  `SinaisDoAmbiente.module.css`, `ProjectCard.module.css`,
  `ProjectRail.module.css`, `TurnActivityStrip.module.css`, `Input.module.css`
  on the placeholder). The choices they justify remain valid; the cited number
  is historical. Updating them belongs to the modules review.
- The documentation site (`website/src/css/custom.css`) has its own palette and
  was not touched.
- The `.design-sync` previews that depend on contrast are invalid until the next
  visual validation (its own NOTES.md says so).

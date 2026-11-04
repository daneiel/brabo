---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0218 — Every ADR is titled "ADR NNNN — title"

## Status

**Accepted.** 2026-10-15 (AT-559, owner decision of 15/10): standardize ADR
naming in the title only.

Theme: `docs`. Complements, without editing, the index convention
([0202](0202-o-indice-de-adr-por-tema.md)).

## Context

Of the 213 ADRs in `docs/adr/`, 82 opened with `# ADR NNNN — …` and 131 with
`# NNNN — …`. Both forms coexisted without a rule, and whoever wrote a new ADR
copied the neighbor's. The title is what shows in the browser tab, the site's
local search and the sidebar; the number alone does not say the page is an ADR.

## Decision

1. The title (H1) of every ADR is `ADR NNNN — <title>`: the `ADR` prefix, the
   4-digit number and the em dash `—`.
2. The file name stays `NNNN-<slug>.md`, and existing slugs stay as they are,
   in any language: the file name is the published URL, and renaming it would
   break outside links.
3. Replacing `# NNNN —` with `# ADR NNNN —` in accepted ADRs is a mechanical
   normalization of the LABEL, not an edit of the decision. The rule "an
   accepted ADR is never edited" still holds for the content: Context,
   Decision, Consequences and the title text stay intact.
4. Translations under `website/i18n/<locale>/` get the same prefix; the
   translated title text stays.
5. `docs:check` (`scripts/docs/temas-de-adr.mjs`) fails an ADR whose H1 does
   not start with `# ADR NNNN — `, with the number equal to the file's.

## Consequences

- One form only, checked: the next ADR no longer picks between two.
- The change touches 131 source files and the translated copies in the same
  commit; the `traducao_de:` of the copies that were up to date is bumped in
  the next commit, so parity does not report staleness that does not exist.
- Slugs keep mixing languages (`short-title` in English in the old ones,
  pt-BR in the new ones). That is accepted: the URL is worth more than
  uniformity.

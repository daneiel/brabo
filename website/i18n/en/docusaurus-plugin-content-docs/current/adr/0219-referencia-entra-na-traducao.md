---
traducao_de: 74ac4990672a22f97b68fac9cece5c509a34fe89
---

# ADR 0219 — The reference enters translation

## Status

**Accepted.** 2026-10-15 (AT-564, owner's decisions of 10/15).

Theme: `docs`. Revises, without editing it, the point of
[0216](0216-quatro-idiomas-com-pt-br-como-fonte.md) that kept
`docs/reference/**` out of translation.

## Context

ADR 0216 made pt-BR the source of the documentation, with `en`, `ru` and
`zh-Hans` as measured translations, but left `docs/reference/**` out on the
grounds that "it is generated". That holds only in part: of the ten
`reference/` pages, six are hand-written (artifacts, brb, git-providers,
internal-api, permissions, rulesets) and were in English, and the four
generated ones (configuration, events, llm-providers, scripts) carry
hand-written prose around the generated block. Readers of the pt-BR site landed
on whole pages in English, and parity did not count them.

## Decision

1. `docs/reference/**` ENTERS translation and parity, except
   `reference/paridade-de-traducao.md` (the report itself) and
   `reference/openapi.json`.
2. The source of the six hand-written pages becomes pt-BR in `docs/`, and the
   current English becomes the `en` copy.
3. In the generated pages, the generated BLOCK is translated too: the generator
   writes the pt-BR source and writes the block into each locale's copy, from a
   table of fixed texts.
4. The lag that appears with every new variable or event is accepted as a
   warning of the parity report and of the page banner, not as a failure.
5. A heading that is a link target gets an explicit `{#current-slug}` anchor
   before being translated, so outside links do not break.
6. The translation banner declares the page's real language through
   `idioma_original` in the frontmatter.
7. The API page (Redoc) will also be translated; that is AT-565, and this ADR
   only records the decision.
8. The docmap `traducao` rule starts watching the `docs/reference/` pages,
   except the parity one.

## Consequences

- Parity starts counting `reference/`, and the numbers drop in the first
  report: untranslated pages show as missing or outdated until translation
  rounds reach them.
- The docmap has no glob negation, so the `traducao` rule lists the
  `reference/` pages one by one; a new reference page enters it in the same PR.
- The generator gains one output per locale (item 3), work for its own round;
  until then the generated block of the copies stays in the source language.

## References

- [0216](0216-quatro-idiomas-com-pt-br-como-fonte.md) — four languages, pt-BR
  as source.
- [0206](0206-referencia-da-api-numa-pagina-redoc.md) — the Redoc API page.

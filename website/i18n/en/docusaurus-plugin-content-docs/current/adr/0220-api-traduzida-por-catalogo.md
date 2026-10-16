---
traducao_de: PENDENTE
---

# ADR 0220 — The API page is translated by catalog

## Status

**Accepted.** 2026-10-16 (AT-565, owner's decisions of 10/16).

Theme: `docs`. Fulfills item 7 of
[0219](0219-referencia-entra-na-traducao.md) and opens a declared exception to
the pt-BR source of [0216](0216-quatro-idiomas-com-pt-br-como-fonte.md).

## Context

The API reference is a Redoc page generated from `openapi.json`
([0206](0206-referencia-da-api-numa-pagina-redoc.md)), and its text comes from
the api decorators: almost all in English, with a few dozen texts in pt-BR.
The site has four locales, but the page came out the same in all of them. The
plugin only accepts a file path as spec, and Docusaurus loads the config once
per locale with `DOCUSAURUS_CURRENT_LOCALE` set.

## Decision

1. The source of the descriptions remains the decorator text; the api is not
   touched. This is an EXCEPTION to the pt-BR source of ADR 0216: `pt-BR`,
   `ru` and `zh-Hans` translate every text, and `en` only those in pt-BR
   (heuristic: a Portuguese diacritic or a function word such as "não",
   "para", "que").
2. The translation lives in a CATALOG per locale,
   `website/i18n/<locale>/openapi-textos.json`, keyed by the sha1 (12 hex) of
   the source text, with `fonte` and `traducao`. It covers `summary`/
   `description` at any level of the spec and the tag label (`x-displayName`);
   the tag NAME does not change, so the `#tag/<name>` anchor stays.
3. The locale spec is DERIVED at build time by `docusaurus.config.ts`
   (`scripts/docs/openapi-por-locale.mjs`) and written to `website/.openapi/`,
   ignored by git. Nothing derived is committed.
4. An ORPHAN key (a hash the spec no longer has) and an INVALID entry (source
   that does not match the hash, or a different number of `` `…` `` spans
   between source and translation) fail `docs:check`; a missing entry only
   warns and falls back to the source text, as in D3 of 0219.
5. The 18 labels of Redoc 2.4.0's `LabelsConfig` are translated via
   `theme.options.labels`. The texts it hard-codes with no option ("Request
   Body schema", "Response Schema", "Authorizations", "Search...", "Expand
   all", "Copy", "required", "API docs by Redocly" and the like) stay in
   English.
6. Translation parity gains its own "API (Redoc)" section, in distinct texts
   per locale, not added to the page characters.

## Consequences

- New text in the api shows up as missing in every catalog until the next
  translation round; changed text leaves the old entry orphaned, and
  `docs:check` requires removing it in the same PR (`pnpm docs:openapi-textos
  <locale>` adds the new keys with `traducao: ""`).
- The catalogs start empty; translating the texts is a round of its own.
- The pt-BR page mixes Redoc labels in English with the translated rest, a
  Redoc limitation, not a content choice.

## References

- [0206](0206-referencia-da-api-numa-pagina-redoc.md) — the API Redoc page.
- [0216](0216-quatro-idiomas-com-pt-br-como-fonte.md) — four languages, pt-BR
  as source.
- [0219](0219-referencia-entra-na-traducao.md) — the reference enters
  translation.

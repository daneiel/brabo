---
traducao_de: 7451c1f845145a031c32644067c4583dd08b694a
---

# ADR 0206 — The API reference becomes a Redoc page

## Status

**Accepted.** 2026-10-02 (AT-359; owner decision on 02/10). Revises, without
editing it, [ADR 0033](0033-referencia-de-api-gerada-do-openapi.md) in its
PUBLISHING half: the spec still comes from the code
(`docs/reference/openapi.json`, DTOs by type, table test) and web's
`openapi:types:check` does not change.

## Context

ADR 0033 published the reference with `docusaurus-plugin-openapi-docs` and
`docusaurus-theme-openapi-docs` (5.1.2): 235 generated `.mdx` in
`docs/reference/api/`, locked by a hash manifest. Both drag in
`postman-collection@5.3.1`, which pins `@faker-js/faker@5.5.3` EXACTLY — High
alert #43, GHSA-qxc2-j82w-r537. Measured on 02/10: no parent in the chain has a
version that leaves faker 5.5.3, and the override to 10.x fails `docs:build`
(v5 API removed). There was no way to close the alert while keeping the plugin.

## Decision

Swap the pair of packages for **Redocusaurus** (`redocusaurus` 2.5.x): ONE Redoc
page, with SSR, at `/reference/api/`, read from the same
`docs/reference/openapi.json`. Why it: it is a Docusaurus 3 preset, renders on
the server (the page comes out in the build's HTML, checkable without a
browser), follows the site's theme and does not pull `postman-collection` nor
faker.

- `pnpm docs:generate` stops generating `.mdx` and the `.openapi-manifest.json`
  manifest; `docs/reference/api/` leaves the repository.
- The sidebar gains a LINK to `/reference/api/` in place of the per-tag category.
- `scripts/docs/api-render-check.mjs` remains the post-build guard (0033's
  lesson: a green build is not a page that renders), now asserting in the HTML of
  both languages the spec's title and one section per operation.

## Consequences

- Closes alert #43: `@faker-js/faker` and `postman-collection` leave the
  `website/` tree. Two overrides were left without a consumer and went
  (`js-yaml@>=5.0.0 <5.2.2` and `undici@>=6.0.0 <6.28.1`, which only arrived
  through the plugin), along with the `allowBuilds` of
  `postman-code-generators`.
- LOSSES accepted by the owner: the 235 per-operation pages, the per-tag
  sidebar, the per-operation URLs (external links to them break), the playground
  and the cURL snippets.
- The guard does not open a browser: a Redoc hydration failure is not caught; a
  missing, empty or operation-less page is.

# ADR 0116 — `website/` gets its own lockfile, out of the product's `pnpm audit`

- **Status:** accepted
- **Date:** 2026-08-28

## Context

`website/` (the Docusaurus site that publishes `docs/`) has been a member of
the root `pnpm-workspace.yaml` since it was created, sharing the single
`pnpm-lock.yaml` with `apps/api`, `apps/web`, `apps/runner`, `packages/*`
and `scripts`. Nothing in `website/` ever reaches a production image — the
site is built and published by its own workflow
(`docs-deploy.yml`/`docs-check.yml`), never bundled into the api, web or
runner artifacts.

Sharing the lockfile charged two prices that had nothing to do with the
product:

1. **`pnpm audit` stopped answering "is the product safe?"** and started
   answering "is the product **and** a documentation generator safe?".
   Docusaurus, `docusaurus-theme-openapi-docs` and their transitive tree
   (webpack, postman-collection, oas-validator, `@redocly/*`…) are a
   large, fast-moving surface that never ships, and every advisory in it
   showed up in the same `pnpm audit` gate the product depends on
   (`ci.yml`, job "Auditoria de dependências").
2. **Most of the security overrides in `pnpm-workspace.yaml` existed only
   to patch a transitive dependency of the site.** Of the 13 entries
   audited for this decision, `serialize-javascript` and the `yaml@1.x`
   range were used **exclusively** by `website/`'s dependency tree
   (confirmed with `pnpm why <pkg> -r` against the shared lockfile, not by
   re-reading the comments — see "What the audit found" below). Maintaining
   them at the root meant carrying `website/`'s vulnerability surface as
   if it were the product's.

## What the audit found

The backlog entry that proposed this assumed the split would be a clean
"website's overrides move out, the product's stay." Running `pnpm why
<pkg> -r` against the pre-split lockfile for all 13 overrides showed a
messier reality: several packages the comments attributed to
`website/` alone are **also** pulled in by `apps/api` or `apps/web`,
through a different chain than the one the comment described:

| package | website's own chain | also required by |
|---|---|---|
| `js-yaml` (`<4.3.1`) | `openapi-to-postmanv2` / `@11ty/gray-matter` | `apps/api`, via `eslint` → `@eslint/eslintrc` |
| `js-yaml` (`<5.2.2`) | `@redocly/openapi-core` | `apps/api`, via `@nestjs/swagger` (already known) |
| `mermaid` | `@docusaurus/theme-mermaid` | `apps/web`, direct runtime dependency (ADR 0068) |
| `dompurify` | via `mermaid` | `apps/web`, via the same `mermaid` |
| `uuid` | `postman-collection`, `sockjs` | `apps/web`, via `mermaid` |
| `postcss` | `postcss-preset-env` (transitive of `docusaurus-theme-openapi-docs`) | `apps/web`, via `vite`'s own `postcss: ^8.5.17` dependency |
| `nanoid` | via its own `postcss` chain | `apps/web`, via the same `postcss` chain under `vite` |
| `fast-uri` | `@redocly/ajv` | `apps/api`, via `ajv` → `@angular-devkit/core` → `@nestjs/schematics` |
| `lodash` | `@docusaurus/core`, direct | `apps/api`, via `@nestjs/swagger` (already known) |
| `undici` | `cheerio` (local search) | `apps/web`, `jsdom` devDependency (already known — the one case the backlog entry had flagged as mixed) |

Only two overrides turned out to be truly website-exclusive
(`serialize-javascript`, `yaml@1.x`), and one turned out to be
product-exclusive with no presence anywhere in `website/`'s tree
(`esbuild`, via `drizzle-kit`).

This matters for the decision below: splitting the lockfile does **not**
mean most overrides simply "move." A once-shared override that patches a
package present on both sides has to keep protecting **both** trees once
they stop sharing a resolution — dropping it from one side because the
comment named the other side would silently reopen the CVE on the side
that got dropped.

## Decision

### 1. `website` leaves `pnpm-workspace.yaml`'s `packages:` list

It's no longer a workspace member. `pnpm install` at the repository root
stops touching anything under `website/`, and `apps/api`/`apps/web`/
`apps/runner`/`packages/*`/`scripts` keep installing exactly as before.

### 2. `website/` gets its own `pnpm-lock.yaml`, installed independently

`pnpm install` run **inside** `website/` (not `pnpm --filter website` from
the root — that verb requires workspace membership) resolves and locks
`website/`'s dependencies on their own, against `website/package.json`
alone.

### 3. Overrides split by where the vulnerable package actually resolves, not by which comment named it

- **Website-exclusive** (`serialize-javascript`, `yaml@1.x`): removed from
  the root `pnpm-workspace.yaml`, added to a new `pnpm.overrides` block in
  `website/package.json` (the standalone-project syntax — no
  `pnpm-workspace.yaml` inside `website/`, so the workspace-level
  `overrides:` key doesn't apply there).
- **Mixed** (`js-yaml` both ranges, `mermaid`, `dompurify`, `uuid`,
  `postcss`, `nanoid`, `fast-uri`, `lodash`, `undici`): kept at the root
  **and** duplicated into `website/package.json`. Two lockfiles now
  resolve these packages independently, so each needs its own floor.
- **Product-exclusive** (`esbuild`): stays at the root only. `website/`
  never resolves it, so an entry there would be dead weight.

The comments in both files say which category each entry falls into and
point at this ADR, so the next person who touches one of the mixed
entries doesn't have to re-run `pnpm why` from scratch to know the other
side needs the same fix.

### 4. Scripts and workflows move from `--filter website` to `--dir website`

`pnpm --filter <name>` selects a package **by workspace membership** —
with `website` out of the workspace, every `docs:*` script in the root
`package.json` (`start`, `build`, `serve`, `clear`) switches to
`pnpm --dir website <script>`, which runs pnpm as if it had been started
inside that directory, membership or not. The script names people already
type (`pnpm docs:build`, `pnpm docs:start`) don't change.

`docs-deploy.yml` and `docs-check.yml` each gain a second, separate
`pnpm install --frozen-lockfile` step scoped to `website/`
(`working-directory: website`), right after the existing root install.
The root install no longer reaches `website/`'s dependencies at all, and
without this second step the build step would fail on a missing
`node_modules`.

## Consequences

- **`pnpm audit` at the root now reports only the product's dependency
  tree.** Docusaurus, its theme, its OpenAPI plugin and their transitive
  packages disappear from the gate `ci.yml`'s "Auditoria de dependências"
  job runs — the CVE surface it reports shrinks to what actually ships.
- **The single-install convenience is gone.** A change that touches both
  a product package and `website/` (rare, but `docs:generate` output does
  touch both) now needs two `pnpm install` runs, one at the root and one
  inside `website/`, instead of one. `docs-deploy.yml`/`docs-check.yml`
  pay this same price with a second CI step.
- **A mixed override has two homes to keep in sync.** If `apps/web` drops
  `mermaid` (or `vite` bumps `postcss` past the vulnerable range on its
  own), the root entry becomes removable the normal way (`pnpm audit`
  stops complaining) but the `website/package.json` copy won't notice
  until someone runs `pnpm audit` **inside** `website/` too — there is no
  single command that audits both trees in one pass yet.
- `docs/.docmap.yml`'s `site-e-publicacao` rule already watches
  `website/**` and `.github/workflows/docs-deploy.yml` at `warn`, so a
  future change to either keeps prompting a look at
  `docs/explanation/documentation-workflow.md`, which now also notes the
  two-lockfile setup.

## Discarded alternatives

- **Leave `website/` in the workspace and just tolerate its CVEs in
  `pnpm audit`**: the status quo. Rejected because the whole point of the
  audit gate is telling the team when a package that ships has a known
  vulnerability, and a Docusaurus theme package drowns that signal in
  noise nobody can act on except by bumping a doc-tooling dependency.
- **Move `website/` to a separate repository**: solves the same problem
  and more, but loses the doc source (`docs/` stays in this repository)
  living next to the site that renders it, and the `docs:generate`
  pipeline that reads `apps/api` source directly to build the OpenAPI
  reference would need a cross-repository step. Out of scope for what the
  backlog entry asked.
- **Keep every override at the root "just in case"**: simpler to write,
  and wrong the same way the original mixed-attribution comments were —
  it hides which package actually needs protecting on which side, and the
  next split (or the next audit of these entries) starts from zero again.

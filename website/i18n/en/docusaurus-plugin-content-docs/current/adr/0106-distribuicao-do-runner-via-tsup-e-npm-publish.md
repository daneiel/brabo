# ADR 0106 — Distribution of `@brabo/runner` via `tsup` and `npm publish`, version injected only in CI

- **Status:** Accepted
- **Date:** 2026-08-22
- **Context:** backlog of [ADR 0104](0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
  ("runner distribution via `tsup` → single package + `npm publish
  @brabo/runner`"), unblocked by [ADR 0105](0105-personal-access-token-do-runner-escopado-por-construcao.md)
  (PAT — "no remaining dependency")

## Context

`apps/runner/package.json` was `"private": true`, with `bin` pointing to a
raw `.ts` (`./src/index.ts`) — only reachable by cloning the whole monorepo
and trusting Node 24's native type-stripping used in dev. The backlog
already named the output literally: `tsup` producing a single
`dist/index.cjs`, published as `@brabo/runner`.

This is the FIRST time this repository publishes anything to an external
registry — confirmed by an exhaustive grep before starting: zero mention of
`NPM_TOKEN`, `NODE_AUTH_TOKEN`, `registry.npmjs.org`, or `provenance`
anywhere in the code.

## Decision

**`tsup` bundles `src/index.ts` into a single `dist/index.cjs`**
(`apps/runner/tsup.config.ts`), `format: cjs`, `target: node18` (the
runtime `engines.node` in `package.json` promises — a different axis from
the `tsconfig.json`'s `ES2023`, which only serves dev's `tsc --noEmit`).
`node-pty` is the only `external`: it's a NATIVE binding (compiles via
node-gyp on postinstall, the same binding VS Code uses —
`pnpm-workspace.yaml` already explicitly allowlists it in `allowBuilds`)
and can't be embedded in a JS file — it stays `require('node-pty')` at
runtime, resolved from the `node_modules` of whoever installed the package.
`phoenix` (pure JS) is embedded automatically by not being in `external`,
and because of that it moved from `dependencies` to `devDependencies` — the
consumer no longer needs to install it separately. The `dist/index.cjs`
name comes for free from `format: ['cjs']` + `"type": "module"` (already
present in `package.json`) — that's how tsup decides the extension, with no
need for `outExtension`. The shebang (`#!/usr/bin/env node`) and the
artifact's execute bit (755) are handled automatically by tsup, which
detects the shebang in the entry point and replicates it in the output.

### The real finding: the auto-run guard was broken for the very case this wave exists to enable

`apps/runner/src/index.ts` decided whether to run `main()` by comparing
`process.argv[1]?.endsWith('index.ts') || .endsWith('brabo-runner')` — a
test by FILE-NAME SUFFIX, fragile to any rename from bundling. The obvious
fix (`import.meta.url === pathToFileURL(process.argv[1]).href`, the
standard ESM idiom for "am I the entry module?") was TESTED empirically
with a real Node process and a symlink before going into the code — and it
too is broken, for the opposite reason than expected:

`process.argv[1]` is **never** resolved via realpath by Node — it's the
literal path the OS used to invoke it, only made absolute. `import.meta.url`
(and the shim tsup generates for `import.meta.url` in a cjs build, based on
`__filename`) is **always** resolved via realpath by the module loader.
`npm install -g` creates exactly that asymmetry: a symlink at
`node_modules/.bin/brabo-runner` pointing to the real `dist/index.cjs`
inside `node_modules/@brabo/runner/`. Running the CLI via the installed
`bin` — the MAIN PATH this entire wave exists to enable — would make the
comparison always come out `false`, and `main()` would never be called. A
silent bug: no smoke test that only runs `node dist/index.cjs` directly
(without going through the symlink) would catch it.

The final fix applies `realpathSync` to `process.argv[1]` before comparing:

```ts
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const invocadoDiretamente =
  !!process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
```

Verified (with a real Node process) across all four cases: dev
(`node src/index.ts`), `node dist/index.cjs` directly, via symlink (the
case that was broken), and it never fires when `import`ed by a test. On
Windows, npm's `.cmd`/`.ps1` shim already invokes `node <real path>` with
no symlink at all — `realpathSync` becomes a no-op there, with no
regression.

### Version: injected only in CI, never committed

The whole repo's version is calculated and lives only in the git tag
(`vX.Y.Z`, Phase 6) — never in `package.json`. `npm publish`, however,
REQUIRES `package.json` to carry the version being published. The way out:
`npm pkg set version=<tag-version>` runs inside the publish workflow's
DISPOSABLE checkout, never committed back to the repository — the same
philosophy of "the tag is the only source of truth," just satisfying a
mechanical requirement of `npm publish` itself.

### npm's `latest` can go backward — mitigated before it happens

This repository already has **six orphaned final tags** (`v0.2.0`,
`v0.3.0`, `v0.3.1`, `v1.0.0`, `v1.0.1`, `v1.1.0` — never published,
documented in `docs/reference/rulesets.md`), and the manual republish
`workflow_dispatch` exists precisely to repair that kind of hole (same
pattern as `release.yml`). `npm publish` moves the `latest` dist-tag to
whatever was just published by default, WITHOUT checking semver order —
republishing an old orphaned tag after a newer version is already published
would silently move `latest` backward, and `npm install -g @brabo/runner`
would start installing old code. `publish-runner.yml` compares the target
version against `npm view @brabo/runner version` before publishing: if it's
`>=` the current `latest`, it publishes normally; otherwise, it publishes
under its own dist-tag (`--tag antiga-<version>`), never touching `latest`.

### A workflow of its own, not one more step in `release.yml`

`publish-runner.yml` is triggered by the SAME event as `release.yml`
(`push: tags: 'v[0-9]+.[0-9]+.[0-9]+'`) but is a separate file — the same
discipline already recorded in ADR 0030 for `tag-release.yml`: "a workflow
OF ITS OWN triggered by the tag... nothing to rewire here." Publishing a
Docker image and publishing an npm package are two independent products of
the same event, each with its own way of failing; folding this into
`release.yml` would let an npm failure bring down (or mask) the GitHub
Release, or vice versa. The two run in PARALLEL, with no `needs:` — there's
no real dependency between them.

**No `NODE_AUTH_TOKEN` on its own.** `actions/setup-node` only writes the
`~/.npmrc` that makes `NODE_AUTH_TOKEN` actually authenticate when the step
receives `registry-url` (and `scope`) — no workflow in this repo had ever
needed that, so none already did it. Without the `NPM_TOKEN` secret
configured, the workflow WARNS (`::warning::`) and SKIPS — never fails —
the same `TEM_PAT` pattern already used in `tag-release.yml`/`release.yml`
(`secrets.*` can't go directly into an `if:`).

## Closing the coverage gap in `ci.yml`

`apps/runner` had never run any test in the `Testes TS (api + web)` job
(confirmed by reading the whole file) — a pre-existing gap, now more
serious since this code is distributed to third parties. Four new steps
there (`test`, `typecheck`, `build`, `smoke`), without renaming the job —
the job's name **is** the identity of the required check on GitHub
(`docs/reference/rulesets.md` documents this explicitly), and renaming it
would erase a required check that would never run again.

`apps/runner/scripts/smoke-dist.mjs` is the only test that exercises the
BUNDLED ARTIFACT end to end — the unit tests only call functions exported
from `src/`, never the published `dist/index.cjs`. It checks for existence
+ the execute bit, and runs the binary in TWO ways: direct exec (exercises
the real shebang — `node dist/index.cjs` alone would NEVER test that) and
via explicit `node dist/index.cjs`. A side effect worth recording: since
`pty.ts` imports `node-pty` at the top of the module (hoisted before any
argument parsing), this smoke also proves the native binding resolves and
loads in the CI environment — it's not just a bundling test, it's a real
smoke test of the native addon. Reused by `ci.yml` (every PR, to catch a
bundling regression BEFORE merge) and by `publish-runner.yml` (right before
publishing, belt and suspenders — never trust an old PR's build).

## Consequences

- Unblocks `npm install -g @brabo/runner` as a real distribution path — the
  item that closes the last pending item in ADR 0104's backlog.
- **Operational pending item, out of this PR's reach**: the product owner
  needs to create/confirm the `@brabo` scope on npmjs.com, generate an npm
  Automation Token, and configure the `NPM_TOKEN` secret in the repository.
  Until then, `publish-runner.yml` runs and warns, without actually
  publishing and without failing the workflow — the same pattern as the
  missing `BRABO_BOT_TOKEN` in `release.yml`.
- Delivery branch is `breaking/` — not `feature/` — because real
  publication requires that operator action before it works end to end, the
  same pattern as social login (ADR 0084) and the lesson already recorded
  in CLAUDE.md about a mandatory OAuth secret that was born (wrongly) in
  `bugfix/`. This bumps the whole repository's version MAJOR (the policy is
  repo-wide, not per workspace) — a consciously accepted consequence.
- No new RN in `docs/business-rules.md` — this is distribution
  infrastructure, not a product business rule. No new entry in
  `docs/gates.yml` — it's not a product decision gate, it's a CI mechanism.
  Both absences are a declared decision.
- `docs/reference/rulesets.md` doesn't change — the "Required checks" table
  is scoped to checks from a workflow triggered by `pull_request`, and
  `publish-runner.yml` only triggers on a final tag push /
  `workflow_dispatch`.
- Out of scope, by declared decision: a standalone binary
  (`pkg`/`bun build --compile`, a separate backlog item, higher cost, no
  defined trigger); runner exclusivity by `{project_id, machine_id}`
  (deferred); PAT revocation for another user by a `maintainer` (out of
  scope since ADR 0105); `guard.ts` best-effort (a reaffirmed invariant,
  not a gap).

# ADR 0073 — The published path names the environment, not the branch

- **Status:** accepted
- **Date:** 2026-08-13
- **Revises:** [ADR 0071](0071-publicacao-simetrica-por-degrau.md)

## Context

[ADR 0071](0071-publicacao-simetrica-por-degrau.md) put the three stages at
`/brabo/<branch>/` and resolved the asymmetry that had existed since
[ADR 0034](0034-documentacao-publicada-por-degrau.md). What it didn't
question was the identity between the two things: the URL segment **was**
the branch name, by interpolation of `$GITHUB_REF_NAME`.

That left the stable documentation at `https://daneiel.github.io/brabo/main/`,
and `main` is a word for whoever commits. Whoever reads the documentation
isn't choosing a branch — they're choosing **how mature** the text they're
about to read is. `qa` and `dev` work as an address by coincidence: they are,
at the same time, a branch name and an environment name. `main` isn't an
environment name anywhere.

The request came from the product owner, in one sentence: *"`main` can't
have the path `/main`, change it to `/prd`"*.

## Decision

### 1. `main` publishes at `/brabo/prd/`

The other two remain at `/brabo/qa/` and `/brabo/dev/`. Publishing remains
symmetric in mechanism — what changes is that the branch→path map now
**exists**, instead of being the identity function written as string
interpolation.

| branch | published path |
|---|---|
| `main` | `/brabo/prd/` |
| `qa` | `/brabo/qa/` |
| `dev` | `/brabo/dev/` |

### 2. The map lives in one place per process, and each one derives the rest from it

These are three independent processes, and each has its single source point:

- **`.github/workflows/docs-deploy.yml`** — the step "which stage, and where
  does it publish" emits `branch`, `caminho` (path), and `base`. `baseUrl`
  and the subdirectory come out of it **together**; separating them is how
  they end up diverging, and a `baseUrl` that doesn't match the directory
  serves HTML and nothing else.
- **`website/docusaurus.config.ts`** — the `DEGRAUS` (stages) table carries
  `branch`, `caminho`, and a label. The navbar selector and the default
  `baseUrl` read from it.
- **`scripts/docs/landing.mjs`** — the same table, with `caminho` (the
  directory in the tree) kept separate from `branch` (where the **tag** that
  stamps the stage's version comes from). This is the pair that's most
  deceptive: `/prd/`'s version comes from `main`'s tags, and swapping one
  for the other would make `/prd/` look like it was never published.

What is **not** derived from the path: `E_PRODUCAO` remains
`DOCS_BRANCH === 'main'`. Item 4 of ADR 0071 records why deriving the
environment from a path string is coupling that only shows up when the path
changes — and this ADR is the path changing. Confirming this was the most
important test of the change: `DOCS_BRANCH=main` still has **no**
`noIndex`; `dev` still does.

### 3. `/brabo/main/` is rewritten by `404.html`, not preserved

The `main/` directory **exists published today**. Since the tree is
assembled and pushed with `keep_files: false`, it becomes orphaned and
disappears on the first push — and every saved link to
`/brabo/main/architecture` would break.

The fix is the same one ADR 0071 used for the old root's links, and for the
same reason (keeping a copy of the site at two addresses duplicates the
publish on every push): the root's `404.html` rewrites the prefix.
`/brabo/main/<something>` → `/brabo/prd/<something>`.

The detail that isn't a detail: this is its **own** case, not the generic
forwarding. ADR 0071's anti-loop guard ignored any path starting with
`main|qa|dev`, and with `main` out of the tree it would do exactly the wrong
thing — return 404 for the one path that needs handling. The guard now
covers only paths that **exist** (`prd|qa|dev`), and `main` is handled before
it. Without this special case, the generic one would produce
`/brabo/prd/main/<something>`.

### 4. The transition seeds `/prd/` from `gh-pages:main`

Same reasoning as item 6 of ADR 0071. `gh-pages:prd` is only born once `main`
goes through the pipeline after this change, and the first push from `dev`
or `qa` arrives before that happens: without a seed, `/brabo/prd/` would
respond 404 for days, with `404.html` sending everyone right there.

`gh-pages:main`'s content is, literally, `main`'s build. It seeds `/prd/` —
**rewritten**, and that part was discovered by simulating the assembly
against the real `gh-pages`: the `baseUrl` embedded in that build points to
`/brabo/main/`, and item 3's `404.html` **doesn't save sub-resources**. Its
script runs on navigation; a `<script src>` or `<link rel=stylesheet>` that
hits the 404 gets back 404-status HTML and fails silently. Without
rewriting, `/prd/` would serve text with no CSS, no search, and no
hydration — the "loads HTML and nothing else" that `docusaurus.config.ts`
describes as this publication's most treacherous failure mode.

The rewrite is a `sed` from `/brabo/main/` to `/brabo/prd/` across the seed's
TEXT files that contain the string (542 of 634, in the simulation). Binary
files are excluded via `grep -I`: `sed -i` on one of them could add the
missing trailing newline and corrupt it.

On the first `main` publication, the normal path takes over and this block
stops running.

The analogous block from ADR 0071 (seeding `/main/` from the old root) was
**removed** in the same commit. It had already served its purpose — today's
`gh-pages` has `main/`, `qa/`, and `dev/` — and its condition
(`FETCH_HEAD:index.html` existing) had come to match the index generated by
the landing page itself: left in place, it would turn the root page into a
stage.

## Consequences

- **A link to `/brabo/main/…` now costs a redirect**, forever. That's the
  declared price of moving a public address, and it's smaller than
  duplicating the site or breaking saved links.
- **`qa` and `dev` become a coincidence, not a rule.** Whoever renames one of
  them tomorrow touches the table and nothing else — that was the structural
  change, not the `prd` value itself.
- **The root doesn't change role.** It's still the generated index listing
  all three, now canonicalizing to `/prd/`; the repository's About, the
  README, and `AuthLayout.tsx` point to it and remain correct.
- **`noIndex` remains tied to the branch.** No new environment is created,
  and no GitHub Pages configuration changes: the source is still the
  `gh-pages` branch at the `/ (root)` folder.
- **One more stage is one more line** in three tables — not a sweep for an
  interpolated `$GITHUB_REF_NAME`.

## Discarded alternatives

- **Publish at `/prd/` and keep `/main/` as a copy.** Preserves links
  without a redirect, at the cost of duplicating the entire site on every
  publish and having two indexable addresses with the same content — the
  same alternative ADR 0071 had already discarded for the root.
- **Rename the `main` branch to `prd`.** Would solve the identity issue
  while keeping the interpolation, and would trade a public address for a
  break in rulesets, the release pipeline, backmerge, and every reference to
  `main` in the repository. The vocabulary of whoever commits isn't the
  problem; the vocabulary of whoever reads is.
- **Redirect `/brabo/main/` on the server.** GitHub Pages has no redirect
  rule; the root's `404.html` is the mechanism that exists.
- **Leave it as is.** It's the alternative the request rules out, and it has
  a weak argument in its favor (`main` was already published) against a
  strong one: the address speaks to the reader, not to the committer.

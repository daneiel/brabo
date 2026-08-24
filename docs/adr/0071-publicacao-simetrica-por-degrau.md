# ADR 0071 — Symmetric publishing per stage, and a root that chooses

- **Status:** accepted
- **Date:** 2026-08-14
- **Extends:** [ADR 0034](0034-documentacao-publicada-por-degrau.md)

## Context

[ADR 0034](0034-documentacao-publicada-por-degrau.md) established that each
permanent branch publishes its own documentation. What it left asymmetric was
the address: `main` published at the **root** (`/brabo/`) while only `qa` and
`dev` had a suffix (`/brabo/qa/`, `/brabo/dev/`).

The asymmetry charged three prices, all paid by the reader:

1. **The root didn't say the other stages existed.** The three sites
   couldn't see each other: whoever landed on `/brabo/` had no way to reach
   `/qa/`, and whoever landed on `/dev/` via Google — before `noIndex` — had
   no way to know they were reading the unvalidated version.
2. **The special case contaminated the mechanism.** Publishing at the root
   by overwriting what was there would also wipe out `/dev/` and `/qa/`, so
   the workflow had a step that ran **only on `main`** to bring the other two
   back into the tree. A path different from the other two is a path that
   gets exercised only a third of the time.
3. **There was nowhere to declare maturity.** "Stable", "candidate", and
   "in development" were knowledge only insiders had.

## Decision

### 1. The three stages at `/brabo/<branch>/`

`main`, `qa`, and `dev` publish symmetrically. `main`'s special case
disappears, and with it the workflow's conditional step.

### 2. The root is a generated index, not a redirect

Redirecting `/brabo/` to `/brabo/main/` would be simpler and would answer
less: the question that leads someone to look at more than one stage is
"does `qa` already have what I need?", and a redirect swallows that
question.

`scripts/docs/landing.mjs` generates the page with all three, each one's
maturity badge, and the **stamped version**, read from the repository's own
tags (`vX.Y.Z` for `main`, `vX.Y.Z-<stage>.N` for the other two — the format
from `scripts/ci/tag-release.ts`).

It offers **what exists in the tree**, not a fixed list: a missing stage
doesn't become a link, because a link that 404s is worse than absence. And it
stays out of the search index with a canonical pointing to `/main/` — the
root is an index, not content, and indexing it would compete with the real
documentation.

### 3. A `404.html` at the root protects old links

Moving `main` would break **every deep link already saved**:
`/brabo/architecture` would stop existing. GitHub Pages serves the root's
`404.html` for an unknown path, so it forwards `/brabo/<something>` to
`/brabo/main/<something>`.

There's a guard that isn't a mere detail: a 404 **inside** a stage (a page
that really doesn't exist) can't be forwarded again, or the browser would
loop. That's why the guard's test exists.

### 4. The stage is declared, not derived from the path

This is the change that matters most, and it's invisible.

The site knew it was production by comparing `BASE_URL === '/brabo/'`. With
all three under a subdirectory, that comparison becomes false **for `main`
too** — and the effect would be `noIndex: true` on the real documentation:
it would silently drop out of Google, with CI green, because nothing in the
build fails for indexing too little.

`DOCS_BRANCH` now travels alongside `DOCS_BASE_URL`, and `E_PRODUCAO`
becomes `DOCS_BRANCH === 'main'`. Deriving the environment from a path
string is exactly the kind of coupling that only shows up when the path
changes.

### 5. The tree is assembled, for all three

The step that used to exist only on `main` becomes the single path: the
other two stages come from the current `gh-pages`, the pushed stage comes
from the new build, the root is generated, and the whole set is published
with `keep_files: false`.

It's not `keep_files: true`: that never removes anything, and a page removed
from the repository would stay published forever. Assembling preserves what
should stay and removes what shouldn't — including, for free, **the
migration**: the files `main` left at the root under the old layout aren't
in the assembled tree, so the first push carries them away. There's no
manual `gh-pages` cleanup to do.

### 6. The transition seeds `/main/` from the old root

Under the old layout, `gh-pages:main` doesn't exist. Without handling, the
first push from `dev` or `qa` would leave `/brabo/main/` nonexistent — and
since `404.html` forwards exactly there, **every old link would point to a
404** until the next promotion to `main`, which can take days.

The root published today is, literally, `main`'s build. So it seeds `/main/`
on the first assembly, and the site never goes without the stable
documentation. On the next `main` publication the normal path takes over and
this block stops running.

### 7. The selector uses an absolute `href`

The link crosses sites with different `baseUrl`s. A relative one would
resolve inside the current stage — `/brabo/dev/main/`, which doesn't exist.

## Consequences

- **The repository's About still points to the root**, which is now the
  index. No configuration change was needed — and it's good that none was:
  no CI token has scope to administer the repository (`BRABO_BOT_TOKEN` is
  `repo` + `workflow`), so automating that would require a new credential.
- **`/brabo/` stops being the documentation** and becomes one extra click for
  whoever just wants the stable version. That's the price of the choice
  recorded here: showing all three.
- `README.md` and `apps/web/src/routes/AuthLayout.tsx` continue pointing to
  the root, which is the entry point.
- Publishing continues to be a direct push to `gh-pages` — the third
  exception to the single-PR-door rule, already documented in the branching
  policy. This ADR **depends more** on that than 0034 did: assembling the
  entire tree is exactly what `actions/deploy-pages` doesn't know how to do.

## Discarded alternatives

- **Redirect the root to `/main/`**: simpler, and it answers less (item 2).
- **Keep `main` at the root and only `qa`/`dev` with a suffix**: that's the
  current state, and it keeps the special case that gets exercised a third
  of the time.
- **Docusaurus versioning (`docs:version`)**: a different axis. A pipeline
  stage is maturity of the SAME content; a documentation version is frozen
  content. `CONTRIBUTING.md` already records that versioning at `0.x` adds
  maintenance without giving anything in return.
- **Publish `main` both at the root AND at `/main/`**: would keep old links
  without `404.html`, at the cost of duplicating the entire site on every
  publish and having two indexable addresses with the same content.

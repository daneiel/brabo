# 0034 — Documentation published per stage, in a Pages subdirectory

## Context

Documentation only ever got published from `main`. `docs-deploy.yml` fired
on `push` to `main`, built the site, and handed an artifact to
`actions/deploy-pages`.

That left a gap across the whole pipeline: **between a merge into `dev` and
the final promotion, no one can read the documentation for that state**
without cloning the repository and running `pnpm docs:start`. And that's
exactly where it's most needed — in staging, to check what changed; in
`dev`, to review a new document with the site rendering it, not the raw
Markdown diff.

`docs-check.yml` already builds the site on every PR, but it **throws the
build away**: its verdict is "builds with no broken link," never "is
published somewhere I can open."

A second fact weighed into the decision. The **117 API reference pages
shipped broken** in releases `v1.0.0` and `v1.0.1`, and no one noticed for
two months of work — because the only way to see them was to open the
published site, which only existed once the change had crossed all three
stages. Publishing every stage isn't comfort: it's shortening the distance
between writing and looking.

## Decision

Each permanent branch publishes to its own location, on the same GitHub
Pages:

| stage | URL | indexed by search engines |
|---|---|---|
| `main` | `https://daneiel.github.io/brabo/` | ✅ |
| `qa` | `https://daneiel.github.io/brabo/qa/` | ❌ |
| `dev` | `https://daneiel.github.io/brabo/dev/` | ❌ |

`main` **doesn't change URL** — existing links keep working. That was a
requirement, not a consequence: breaking the documentation's URL to gain
preview would be trading correctness for convenience.

### Consequences that need to be written down

#### 1. Publishing becomes a direct push, and this is the third exception

`actions/deploy-pages` publishes **one artifact as the whole site** and
doesn't know how to update part of a tree. With it, publishing `dev` to a
subdirectory would mean rebuilding all three stages on every push from any
one of them. So publishing moves to `peaceiris/actions-gh-pages`, which
**commits to the `gh-pages` branch**.

That opens the **third exception** to the single-door-through-PR rule,
alongside tags and `.release/gate.json` — and it's recorded in the
[branching policy](../explanation/branching-policy.md#direct-push-is-blocked),
because an exception that isn't documented becomes precedent.

What makes this exception different from the other two, and easier to
accept: `gh-pages` **isn't a code branch**. Nothing in it is source,
everything is generated from `docs/` and `website/`, and deleting it
entirely loses no information — the next push rebuilds it. Its `git log`
is the record of every publication, with date and source sha.

#### 2. `main` assembles the tree instead of preserving by default

`main` publishes to the root. Publishing to the root while erasing what was
there would take `/dev/` and `/qa/` down with it: every production deploy
would knock out the other two stages until their next push.

The answer is **not** `keep_files: true`. That never removes anything, and
a page deleted from the repository would stay published forever — the
orphan problem the API reference generator already solves with
`clean-api-docs`. Swapping "what shouldn't be there disappears" for "what
shouldn't be there stays" isn't a fix.

So the tree gets **assembled**: before publishing, the `main` job pulls
`/dev/` and `/qa/` from `gh-pages` into the build and publishes the
complete set with `keep_files: false`. That makes the semantics exact —
**whatever isn't in the new tree shouldn't be published.**

#### 3. `baseUrl` stops being constant

`baseUrl` goes into every asset URL Docusaurus emits. A site served from
`/brabo/dev/` with `baseUrl: '/brabo/'` loads the HTML and nothing else:
CSS, JS and search all 404, and the page looks *broken with no error*. So
`baseUrl` now comes from `DOCS_BASE_URL`, with the production value as the
default — `pnpm docs:build` with no variable set at all still produces
exactly what it always produced.

#### 4. `noIndex` and local search were canceling each other out, and that had to be discovered

`dev` and `qa` are the same content as production, at an earlier maturity
stage. Indexed by Google, they'd compete with the real documentation, and
anyone arriving via search would read the unvalidated version without
realizing it. Hence `noIndex: true` outside of `main`.

**Except `@easyops-cn/docusaurus-search-local` drops every page that has
`<meta name="robots" content="noindex">`** (`parse.js`, comment *"Unlisted
content"*) — exactly what `noIndex` emits. The effect, measured: a
**666-byte index with `documents: []`**, and the search box answering "No
results" for any term. The stages would have published with search dead,
and the symptom would show up in no build at all.

The plugin's `forceIgnoreNoIndex: true` option fixes it, and the fix is
worth explaining because it looks like a contradiction: **`noIndex` speaks
to EXTERNAL search engines; `forceIgnoreNoIndex` speaks to the LOCAL
index.** Wanting the stages out of Google isn't the same as wanting the
stages without search.

Measured across all three modes after the fix: **2318 documents indexed**
in production, `dev` and `qa`, with `meta robots` present only in the last
two.

#### 5. "Only for a branch that passed" needed no mechanism

`push` on a permanent branch only ever happens via PR merge, and the
ruleset requires the required checks before merging. **The push trigger
already IS "it passed"** — there's no path where this workflow publishes
code that didn't cross the pipeline. Recording this here stops anyone from
later adding an "did the checks pass?" verification that would be
redundant and would give the impression there was a hole without it.

#### 6. The render gate runs before publishing

`api-render-check.mjs` (see
[documentation-workflow](../explanation/documentation-workflow.md)) runs
in `docs-deploy` in addition to `docs-check`. It's the step that
**publishes**: if a page doesn't render, it's better not to publish than to
publish it broken. It was the absence of exactly this that let two
releases ship with a dead API reference.

## Alternatives considered

**Artifact per run, no URL.** Each stage would upload the site as an
Actions artifact, downloadable as a zip. Zero push exception, zero Settings
change — and zero usefulness for the real use case, which is *open a link
and look*. Downloading and unzipping to review a page is enough friction
that no one would do it.

**Preview per PR.** More useful during review than a site per branch, and
the same mechanism cost. It wasn't dropped on its merits: it stays as a
possible complement, and this ADR's mechanism (subdirectory + `DOCS_BASE_URL`)
is exactly what it would need. What tipped the decision is that the gap
described in Context is *between stages*, not inside the PR — the PR
already has `docs-check` building the site.

**Keep `actions/deploy-pages` and rebuild all three stages on every push.**
No push exception, no `gh-pages`. But every push to `dev` would rebuild
`qa` and `main` from other branches — three checkouts and three builds per
publication, and a `dev` deploy able to republish `main` with content
nobody asked for. Coupling between stages is the exact opposite of what
the whole pipeline exists to avoid.

## Consequences

- **Manual user action:** switch the Pages source in Settings from "GitHub
  Actions" to branch `gh-pages` / `root`. It's in
  [Rulesets](../reference/rulesets.md), alongside the rest of what's manual
  application.
- `gh-pages` **is not included** in the rulesets for permanent branches: it
  isn't permanent, and the bot needs to push directly to it.
- The `github-pages` environment stops being used by the flow. It exists
  because Pages creates it, not because the project declared it —
  `CLAUDE.md` keeps the rule of not creating Environments.
- The Rspack cache is now keyed by stage: `baseUrl` goes into the bundle,
  so `dev`'s cache doesn't serve `main`. Without this the three would
  invalidate each other in rotation and the cache would become decoration.
- Three stages writing to the same `gh-pages` need serialization: the
  workflow's `concurrency` now spans the whole repository, not per branch.

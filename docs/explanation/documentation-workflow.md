---
id: documentation-workflow
title: How documentation stays alive
sidebar_label: Docs sync
sidebar_position: 1
description: The mechanism that keeps documentation from rotting — what each piece does, why it exists, and what to do when the check complains unfairly.
keywords: [documentation, drift, docmap, CI, generation]
---

# How documentation stays alive

Documentation doesn't die from a lack of initial writing. It dies from
**drift**: the code changes, the doc stays, and one day someone
notices it describes a system that no longer exists. From that point
on nobody trusts any page, including the ones that are right.

This page explains the mechanism that exists to prevent that. Read it
if CI complained about you — and read it before turning off any part
of it.

## The principle: generate > verify > remember

Three levels, in decreasing order of reliability:

| level | how it works | when to use it |
|---|---|---|
| **Generate** | the doc comes out of the code; drift is impossible | the list IS the content |
| **Verify** | the doc is hand-written, CI checks that it's complete | the prose matters more than the list |
| **Remember** | CI warns whoever opened the PR | when human judgment is required |

The last level is the weakest, and that's why it's the last resort. A
warning nobody reads protects nothing.

### A number in prose is a *verify* case

A number in the middle of a sentence — "the 30 ADRs," "next is
`0031`" — isn't generatable: it lives inside the text, and replacing
it with a placeholder would make the source prose unreadable. But it's
**verifiable**, and that's where it should live.

Without that, it ages silently. That's what happened: the published
site said "28 of them" and "the 29 decisions" when there were already
30, and "next is 0030" with 0030 already done. Nothing broke, no check
complained — it just went wrong.

**The list of verified numbers grew after a third case proved the same
point.** An external review found the README announcing "the 158 RNs"
when 331 were written — wrong by more than double, in the table that
introduces the repository. It was corrected by hand (PR #412), which
only resets the clock: the next RN would put it back out of date. So the
check stopped covering ADR counts alone and now covers **three**
families, each read from the ARTIFACT and never from other prose:

| number in prose | source of truth |
|---|---|
| ADR count, next ADR number | the files in `docs/adr/` |
| RN count | the `### RN-NNN` headings in `business-rules.md` |
| LLM provider count | the `capabilities` literals `descobrirProviders()` finds — the same source as the generated table in `llm-providers.md` |

The provider one is written **in words** ("nove providers"), and the
check compares against the word rather than forcing the prose to become
a digit: the check exists to protect the text, not to reshape it.

The most expensive case was the **version announced in prose**: the
README announced `v0.1.0` from Phase 5 all the way to v2.1.0 — seven
releases behind reality, in the first thing a newcomer reads. The
check compares the prose against the first `## vX.Y.Z` in the
CHANGELOG, which is written by the release workflow and comes back via
PR; a tag read from git wouldn't work, because the CI's shallow
checkout might not have any tag at all. The **badge**, on the other
hand, left the check and became generation: it reads the GitHub
release directly (`shields.io/github/v/release`) and updates itself —
you only verify what can't be generated.

And it happened **once per entry point**. `docs/intro.md` — the
published site's first page, which not everyone reaches through the
README — kept saying "Phases 1 to 5 complete, v0.1.0" while the
product was at Phase 26. Checking only the README never protected the
second door, so `verificarVersaoAnunciada` received both files in a
list, and `scripts/ci/readme-version.ts` started writing to both in
the same commit as the CHANGELOG. The two halves move together on
purpose: a check that demands what the generator doesn't write would
make every release be born red on a PR the bot opens and nobody can
fix.

The `intro.md` pattern requires the **whole** sentence — "Phases 1
through NN complete, version vX.Y.Z" — not just the version: the two
halves age together, and matching only half would leave the phase
count lying next to a correct version. The phase count isn't
generatable from here: the release knows the version, not the phase.

`generate.mjs` now checks these claims against the directory's
reality. And **a pattern that stops matching also fails**: a check
whose regex stopped finding the sentence is worse than no check at
all, because it stays green forever claiming to have checked something
it never looked at. When the sentence changes, CI says `CEGO` and
asks for the pattern to be adjusted.

Adding a new claim to the check is an entry in one of the `afericoes`
lists — `verificarContagensDeAdr` (file, pattern, expected value) when
the source of truth is the ADR directory, `verificarVersaoAnunciada`
when it's the CHANGELOG's latest release — or a function of its own
next to them, when it's neither.

**Counts derived from code (AT-123).** A sweep on 2026-09-25 of
`docs/`, `README.md`, `CONTRIBUTING.md`, `THIRD_PARTY_NOTICES.md` and
`CLAUDE.md` found five numbers already wrong — "nove schemas" (eleven),
"doze operações" of the git contract (fifteen), "dez abas" (twelve),
"três imagens" built by CI (five), "Thirteen types" of
`proposed_action` (twenty-one) — none with a check behind it. The
counts whose source is a place in the code now live in
`scripts/docs/contagens-do-codigo.mjs`, called by
`verificarContagensDerivadasDoCodigo`: one table row per SENTENCE
(the same count said in two files is two sentences that age apart),
each pointing at an extractor that counts the artifact — the
`overrides` blocks of the two `pnpm-workspace.yaml`, the golden-set's
`CASOS` and `ARQUIVOS_CURADOS` and its `floor.json`, the total that
`scripts/ci/imagens-pinadas.ts` prints, `ALVOS`, the smoke's non-root
loop, the methods of `GitProviderContract` and of `DockerPort`, the
tab `REGISTRO`, the dev compose services without `profiles:` (which
must ALL have a healthcheck, or the expected value becomes a sentence
the prose doesn't have), `ACTION_TYPES`, the `action_status` enum and
the `pgTable(` calls. Comparison ignores case and follows the
sentence's form (Portuguese masculine/feminine words, English words,
or digits). Because the extractors are many, each is proven by
MUTATION in `contagens-do-codigo.spec.ts`: change the artifact and not
the prose, and it must fail `DESATUAL`; remove the sentence or the
source, and it must fail `CEGO`.

What was **dated instead of derived**, and why: the per-app file counts
in `architecture.md` and the broker's "six routes" change with almost
every PR or are read off a `switch`, so a check would only add noise —
they carry "measured 2026-09-25". Numbers that describe a design
invariant ("two layers", "three states") or a past measurement already
dated in place (`THIRD_PARTY_NOTICES.md`, the runbook's restore
transcripts) were left as they are.

### Line references with a symbol

An RN cites code by `path:line`, and a line number goes stale every
time someone edits the file. RN-547 cited `fechar_a_instalacao` at
`install.sh:966` and `post_interno` at `:682`. By 2026-09-17 they were
at `:1107` and `:809`, and by 2026-09-18 at `:1463` and `:1165`. A line
number can't be generated, and in general it can't be verified either,
because `apps/api/src/foo.ts:40` alone doesn't say what should be
there. When the RN also **names the symbol** next to the line, though,
the line *can* be verified. That's the only case `generate.mjs` checks
(`verificarRefsComSimbolo`, with its logic in
`scripts/docs/refs-com-simbolo.mjs`, tested).

**The pattern is narrow on purpose.** A noisy check gets switched off in
its first month. It reads the three RN files (`business-rules.md`,
`business-rules/custo.md`, `business-rules/autenticacao.md`) and takes
only these two forms:

```
`<path>:<N>` (`<symbol>`     explicit reference
`:<N>` (`<symbol>`           continuation — inherits the path
```

- The symbol has to come **right after** the reference, opening a
  parenthesis and in backticks. Only whitespace may sit between them,
  including a line break.
- The symbol has to be an **identifier**: `fechar_a_instalacao`,
  `join/3`, `git_dir?`, `Engine.Runners.RunnerReadiness`, `decide()`.
  `MARCADOR_SCHEMA=3`, a phrase or a path is not a symbol, and gets
  skipped.
- **Ambiguous pairs are skipped**: `:640`/`:647` (`a`/`b`), or two
  references before one symbol. The check can't know which symbol goes
  with which line.
- A continuation inherits the last explicit path **in the same list
  item**. A blank line or a new `- ` ends the item.
- The path resolves from the repo root. If it isn't there, the check
  uses the **single** tracked file whose path ends with it. If no file
  matches, or more than one does, the reference is counted apart as
  unresolved.

A reference **matches** when the symbol, or its last `.` segment, shows
up as a whole word within **±3 lines** of `N`. The window allows for a
citation that points at the docblock rather than the signature. It stays
small because drift moves by dozens or hundreds of lines. When a
reference doesn't match, the output names the nearest line where the
symbol does appear. That line is a hint, not a fix, because the nearest
occurrence may be a call rather than the definition.

**Measured on 2026-09-18**, over every `path:N` in the three files:

| | count |
|---|---|
| `…:N` references in total | 592 |
| match the pattern | 187 |
| correct (within ±3) | 116 |
| wrong | 71 |
| unresolved path | 0 |

A spot check of the 71 found no false positives: each reference it
covered was real drift, a rename, or a symbol that moved to another
file. Widening the window to ±5 would clear only three of them. Nine are
between 4 and 10 lines off, and the other 62 are further. The RN-547 code bullet was
re-read by symbol and fixed in the same PR, which leaves **63**. They
are too many to fix one by one inside this change, and the nearest
occurrence is not always the definition. The list is what `pnpm
docs:check` prints.

**Severity: `warn`.** It reports and doesn't fail, because a `block`
would stop every PR that touches an RN file over debt someone else left.
There is one exception, the house rule: if the check extracts **zero**
references, that is `CEGO` and **fails**. Zero means the RN syntax
changed or the extractor broke, and a blind check stays green forever.

**When to promote it to `block`:** once the list is **empty**, and
after **four consecutive weeks** of `docs:check` on `dev` with no new
wrong references in RNs touched during those weeks. At that point every
new wrong reference is the current PR's fault, and the PR can fix it.
Promote it earlier and it charges each PR for someone else's debt. If
the pattern shows a real false positive before then, narrow the
pattern. Don't widen the window.

## The pieces

```mermaid
flowchart TD
  A[docs/.docmap.yml<br/>code → doc map] --> B[docmap.mjs<br/>validates the map]
  A --> C[drift.mjs<br/>enforces in the PR]
  D[code] --> E[generate.mjs<br/>generates and verifies]
  E --> F[docs/]
  C --> G[docs-check.yml<br/>PR guardian]
  B --> G
  E --> G
  F --> H[docs-build<br/>broken link fails]
  H --> G
  A --> I[audit.mjs<br/>monthly: stale docs]
```

### `docs/.docmap.yml` — the map

Links code paths to the documents that depend on them. It's the only
source that says "whoever touches this needs to review that."

Two severities: `block` fails the PR, `warn` only comments. And a
`generated: true` attribute, which marks the documents that come out
of the generator.

### `docmap.mjs` — validates the map

Runs before everything else, because a broken map makes the rest lie.
It fails if:

- **a glob matches no file** — a dead rule. It never fires, and gives
  the impression of coverage that doesn't exist. This is the most
  silent defect a docmap can have, and it was found in 8 globs when
  the validator was introduced.
- a document the map points to doesn't exist
- there's a duplicate id or an invalid `severity`

### `generate.mjs` — generates and verifies

Two output modes:

**Whole file** — `docs/reference/scripts.md`. There's no prose to
preserve: the list of commands is the content. It comes from each
package's `package.json` and the `Makefile`'s annotated targets.

**Marked block** — the stretch between `<!-- BEGIN:GENERATED:<id> -->`
and `<!-- END:GENERATED:<id> -->` inside a hand-written file. That's
the case for `configuration.md` and `events.md`: there, the prose
("what breaks when this variable is wrong") is worth much more than
the list, but the **list** needs to be complete. The block is the
inventory; the surrounding text is the explanation.

The inventory marks with ⚠️ whatever shows up in the code and has
**no** description in the prose. That's how `tool.result` and
`agent.response` — two real event types — showed up after being left
out of the first draft.

**What the environment inventory catches, measured (AT-124,
2026-09-25).** The sources and their globs live in
`scripts/docs/fontes-de-env.mjs`, proven against the real tree by
`fontes-de-env.spec.ts`. A mutation per source — a new
`process.env.X` in a file straight under `e2e/`, nested in
`e2e/suporte/`, straight under `apps/api/scripts/` and nested one level
below it, each `git add`ed — made `--check` fail with `DESATUAL` on
`configuration.md` in all four. One hole was found and closed: the
`.spec.` filter, right for sources where a spec is a unit test sitting
next to the code, was also dropping `e2e/testes/*.spec.ts` — the
Playwright tests themselves, where a new `e2e/` variable is most likely
to be born — and that mutation passed green. Two limits stay declared:
the inventory reads only **versioned** files (`git ls-files`), so an
untracked file is invisible until `git add`; and what fails is the
**stale block**, not the gap itself — once `docs:generate` rewrites the
block, the variable sits there with ⚠️ and `--check` passes (two
product variables are in that state today). The ⚠️ is a visible gap to
fill in the prose, never a gate.

`--check` writes nothing and fails if anything would be different.
That's CI's mode.

### `drift.mjs` — enforces it in the PR

Cross-references `git diff --name-only <base>...HEAD` with the map.
For every triggered rule whose document wasn't touched: `block` fails
it, `warn` comments.

For a Dependabot PR whose diff is only action-pin bumps, a step just before the
drift (`scripts/ci/dependabot-justifica-pin.ts`) writes the `docs-not-needed:`
line into the body, in the same job so it writes and reads in one execution.
The workflow listens to `edited`, and `@dependabot rebase` emits `synchronize`
and `edited` together; `concurrency` cancels one, so the surviving run may be
the `edited` one. Hence the step also evaluates on `edited` **when the editor is
the bot** (AT-100), and never when it is a human (their deletion of the line
wins). It can't loop: body edits made with the workflow token don't fire
`edited`. Failure stays closed: if the write fails, the drift reads the event
body and the PR stays blocked.

### `audit.mjs` — the monthly audit

The drift check catches a doc that went **wrong** in a PR. The audit
catches a doc that went **stale** with nobody touching it — which is
harder to notice. It reports:

- pages untouched for months whose corresponding code changed since
- pending `TODO(human)` items
- `file:line` references that no longer resolve
- ADRs in `proposed` status for more than 60 days

Always in the **same** issue, updated in place. A new issue every
month becomes spam, and spam gets turned off.

### The site build

`onBrokenLinks`, `onBrokenAnchors` and `onBrokenMarkdownLinks` are set
to `throw`. Moving a file without fixing whoever points to it breaks
CI instead of turning into a 404 in production. It's the cheapest
mechanism in the whole set.

### A new page needs to be added to `sidebars.ts` by hand

The Markdown content lives in `docs/`, but the **routing** lives in
`website/sidebars.ts` — and its sections enumerate items one by one,
instead of scanning the directory. Creating a file in `docs/` without
adding it there produces a page that exists, is served by direct URL,
and **doesn't show up in navigation**.

The build **doesn't** fail on this: an orphan page isn't a broken
link. It's a visual check, and it's the only step in the mechanism
with no safety net — after `pnpm docs:build`, open the sidebar and
confirm the page is there.

### `api-render-check.mjs` — a green build isn't a page that renders

This piece exists because of an expensive lesson: **the API
reference's 117 operation pages went live dead in releases `v1.0.0`
and `v1.0.1`**, and no check caught it.

The Docusaurus config didn't declare `docItemComponent:
'@theme/ApiItem'`, so Docusaurus used the default `@theme/DocItem`.
`ApiItem` is the only place in `docusaurus-theme-openapi-docs` that
mounts redux's `<Provider>`, and the `@theme/ApiExplorer/MethodEndpoint`
each `.api.mdx` imports reads that store with `useSelector`. Without
the wrapper, the context is null — and the error boundary swapped the
whole page for *"This page crashed."*

The failure mode is what matters here, because it defeats every other
piece of this mechanism:

| stage | result |
|---|---|
| MDX compiles | ✅ theme components exist and resolve |
| SSR renders | ✅ the served HTML has the route's content |
| `pnpm docs:build` | ✅ **green** |
| hydration in the browser | ❌ the page gets wiped |

In other words: **"the build passed" was never proof the page
works.** `api-render-check.mjs` runs after `docs:build` and asserts,
on every operation page, the structural marker only `ApiItem`
produces (`openapi-left-panel__container` /
`openapi-right-panel__container`, confirmed against the theme's
source, not guessed at).

It catches **this class** of regression, not every hydration failure —
catching all of them would require a headless browser, and that
dependency isn't worth the residual risk. If another one slips through,
that's where this conversation starts.

The same episode produced the map's `site-e-publicacao` rule:
`website/**` wasn't covered by any rule, and changing the site config
didn't demand documentation.

### Publishing, one site per rung

Each permanent branch publishes to its own spot on the same GitHub
Pages:

| branch | URL | indexed by search engines |
|---|---|---|
| — (index) | `https://daneiel.github.io/brabo/` | ❌ |
| `main` | `https://daneiel.github.io/brabo/prd/` | ✅ |
| `qa` | `https://daneiel.github.io/brabo/qa/` | ❌ |
| `dev` | `https://daneiel.github.io/brabo/dev/` | ❌ |

All three have been **symmetric** since
[ADR 0071](../adr/0071-publicacao-simetrica-por-degrau.md); the root
is a generated page listing all three with each one's stamped version,
and every site has a selector at the top for switching rungs. Before
that, `main` published at the root, and that special case forced the
workflow to preserve `/dev/` and `/qa/` on a path that only ran a
third of the time.

**The path isn't the branch name.**
[ADR 0073](../adr/0073-o-caminho-publicado-nomeia-o-ambiente.md)
separated the two: the address names the **environment** for readers,
and `main` is vocabulary for whoever commits. That's why `main`
publishes at `/prd/`; `qa` and `dev` match by coincidence, not by
rule. The branch→path map exists at one point per process — the
workflow's "which rung, and where it publishes" step, the `DEGRAUS`
table in `docusaurus.config.ts`, and the one in `landing.mjs` — and
everything else derives from it.

Two consequences worth remembering before touching this:

- **`/brabo/main/` used to be published, and no longer is.** Since the
  tree is assembled and pushed with `keep_files: false`, the directory
  disappears. What preserves saved links is the root's `404.html`,
  which **rewrites** the prefix (`/brabo/main/<something>` →
  `/brabo/prd/<something>`) as its own case, separate from the generic
  redirect — which would produce `/brabo/prd/main/<something>`. The
  loop guard only covers paths that exist (`prd|qa|dev`).
- **`/prd/` was seeded from `gh-pages:main`** during the transition,
  for the same reason ADR 0071 seeded `/main/` from the old root:
  without it, `/brabo/prd/` would respond 404 between `dev`'s first
  push and the next promotion to `main`. The seed is **rewritten** from
  `/brabo/main/` to `/brabo/prd/`, because `404.html` doesn't save
  sub-resources — CSS and JS requested at the old address would get
  HTML back with a 404 status, and the site would serve bare text.

This closes a gap in the pipeline: between a merge into `dev` and the
final promotion, reading the documentation for that state required
cloning the repository. `docs-check` builds the site on every PR but
**discards the build** — its verdict is "builds with no broken links,"
never "lives somewhere I can open." And it was exactly that gap
between writing and looking that let the API reference go live broken
for two releases.

Three details that aren't obvious and have each already cost a bug:

- **`baseUrl` comes from `DOCS_BASE_URL`**, defaulting to the
  production value. It goes into every asset URL: a site at
  `/brabo/dev/` with `baseUrl: '/brabo/'` loads the HTML and nothing
  else, and the page is *broken with no error*.
- **The rung is declared in `DOCS_BRANCH`, not deduced from
  `baseUrl`.** This used to be `BASE_URL === '/brabo/'`, and it worked
  while `main` was the only one at the root. With all three under a
  subdirectory, that comparison turns false for `main` too, and the
  effect would be `noIndex` on the REAL documentation — outside
  Google, silently, with CI green, because nothing in the build fails
  for under-indexing. ADR 0073 is exactly the scenario this separation
  was built for: the path changed to `/prd/` and `E_PRODUCAO` didn't
  need to know about it.
- **`noIndex` outside `main` requires `forceIgnoreNoIndex` in
  search.** `@easyops-cn/docusaurus-search-local` discards every page
  with `<meta name="robots" content="noindex">`, so the two safeguards
  would cancel each other: the rungs would publish with search dead, a
  666-byte index, *"No results"* for everything. `noIndex` talks to
  **external** search engines; `forceIgnoreNoIndex` talks to the
  **local** index.
- **`main` assembles the tree before publishing**, bringing `/dev/`
  and `/qa/` back. `keep_files: true` would be simpler and would be
  wrong: it would never remove anything, and a page deleted from the
  repository would stay published forever.

### Publishing is TWO workflows, and only one is ours

This trips up anyone looking for the deploy in the Actions tab:

| order | workflow | where it lives | what it does |
|---|---|---|---|
| 1 | **`Documentação`** (`docs-deploy.yml`) | `.github/workflows/` | builds the site and **commits to `gh-pages`** |
| 2 | **`pages build and deployment`** | `dynamic/pages/` — **generated by GitHub** | reads `gh-pages` and **serves it** |

The second one isn't in the repository and doesn't show up in the list
of versioned workflows; GitHub creates it on its own when the Pages
source is a branch. Our workflow ends at the commit — it does **not**
publish to Pages, even though its job is still called "Publish to
GitHub Pages."

> **Practical consequence:** the site can be stale even with
> `Documentação` green. If Pages' `build_type` isn't `legacy`/`gh-pages`,
> the commit happens and nobody serves it — and nothing in CI turns
> red. The check is `gh api repos/daneiel/brabo/pages`, recorded in
> [Rulesets](../reference/rulesets.md).

The whole design, with the discarded alternatives, is in
[ADR 0034](../adr/0034-documentacao-publicada-por-degrau.md).

## Running it on your machine

`website/` has its own `pnpm-lock.yaml` since [ADR 0117](../adr/0117-lockfile-proprio-para-o-website.md) —
the root `pnpm install` no longer reaches it, so the first time (or after its
lockfile changes) needs one extra step:

```bash
cd website && pnpm install && cd ..  # only the first time, or when website/pnpm-lock.yaml changes

pnpm docs:check      # validates the map + checks generated content is up to date
pnpm docs:generate   # regenerates
pnpm docs:drift      # simulates the PR check (origin/dev...HEAD)
pnpm docs:build      # the build CI runs — pnpm --dir website build under the hood
pnpm docs:start      # local server, with hot reload

# does the API reference render? needs the build above, and isn't part
# of docs:check because that one doesn't build the site
node scripts/docs/api-render-check.mjs
```

Or, if you're in Claude Code, `/sync-docs` runs the whole cycle and
delivers a report of what changed, what became a `TODO(human)`, and
what was deliberately **left** unchanged.

### Conjunction by default, disjunction when the doc was split

A rule's `docs:` list is a **conjunction**: every document listed has to
change, or the rule fires. That's the right default — it's what makes
"changed the gate, update the gate doc AND the rules" enforceable.

It became wrong exactly once, and the fix is `docs_alternativos:`, a
**disjunction**: any one of the listed documents satisfies the rule. It
exists because `business-rules.md` was split by size (Cost and
Authentication alone were half of a 640 KB page), so a business rule now
lives in one of three files. Under conjunction, changing an auth rule
would demand the index too — a file that no longer contains that rule —
and the way out for whoever got asked would be the `docs-not-needed`
escape hatch. **A rule that teaches people to use the escape hatch is
worse than no rule**: it trains them to ignore the check.

`docmap.mjs` validates both lists the same way: a path that doesn't
exist is the same silent error as a dead glob — an alternative with a
typo could never satisfy the rule, and nobody would see it.

## When the check complains unfairly

It will complain unfairly sometimes. A refactor that renames internal
variables triggers `dominio-e-regras` without changing any business
rule. That's expected: the map works by file path, not by semantics.

There are **two** ways out, and both require someone explaining why:

```
PR label:      docs-not-needed
or in the body: docs-not-needed: internal refactor, no RN changed
```

Use it without guilt when it applies. The escape hatch exists **on
purpose**: without a legitimate way out, the habit that forms is to
cheat — a cosmetic commit to the doc just to make the check pass. Then
the mechanism starts lying, which is worse than not existing.

**One class of PR gets the body line from a bot**, and only one: a Dependabot
PR whose diff is nothing but action pin changes (the `uses:` SHA and its
version comment). A step right before the drift writes the line, marked as the
bot's, and the drift still reads only the line — see
[A pin bump justifies itself](./branching-policy.md#a-pin-bump-justifies-itself).
Because editing the body with `GITHUB_TOKEN` fires no `edited` event, and a
re-run reuses the original payload, the drift reads the body from
`PR_BODY_FILE` when that step rewrote it, and from the event otherwise.

What's **not** okay is using the escape hatch out of haste. If you
used it three times in the same week for the same rule, the rule is
the problem: adjust the glob in `docs/.docmap.yml`, or lower the
severity from `block` to `warn`.

## When the mechanism itself is wrong

| symptom | fix |
|---|---|
| rule fires on an irrelevant change | glob too broad — narrow the `watch` |
| rule never fires | dead glob — `pnpm docs:check` flags it |
| generated content is always stale in CI | someone hand-edited it; fix the generator or the source |
| build breaks on `{` or loose HTML | `.md` is CommonMark; if it needs a React component, rename to `.mdx` |
| the audit reports itself | add the file to the `META` list in `audit.mjs` |

## What this mechanism doesn't do

**It doesn't check whether the text is correct.** It checks whether
the text was *reviewed* when the code changed, and whether the lists
are complete. A factually wrong sentence nobody touched passes every
check — that's what human reading, and `/sync-docs`, are for.

**It doesn't write documentation.** It generates an inventory and
demands review. What a variable does when it's wrong, why a cap
exists, what to investigate during an incident — that's still work
that has to be written.

**It doesn't enforce `README.md`, nor anything no rule watches.** The
docmap is a floor, not a ceiling: as of 2026-07-29 no rule was watching
the heart of observability (`tracing.ts`,
`infrastructure/observability/**`, `telemetry/**`, `lib/logger.ts`),
and `README.md` is barely required by any rule at all. Delivering only
what CI demands is how the two sentences about
`OTEL_EXPORTER_OTLP_ENDPOINT` stayed wrong for months. When you change
code, sweep `docs/` looking for what the change made false — including
what nobody asked you to look at.

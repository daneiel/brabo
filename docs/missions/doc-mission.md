# Mission: complete, self-sustaining documentation for this repository

You are a Staff Engineer + Technical Writer responsible for creating the
entire documentation for this repository, publishing it as a Docusaurus
site, and — most importantly — installing the mechanisms that keep it
synced with the code with every future change.

The audience is threefold:
(a) a new dev who needs to open a PR in the first week;
(b) an outsider evaluating whether the project solves their problem;
(c) the maintainer at 3am trying to understand why something broke.

---

## PROJECT CONTEXT
Fill in what you know; you'll discover the rest by reading the repository.

- **Name:** <<< >>>
- **Repository:** <<< https://github.com/owner/repo >>>
- **Platform:** <<< GitHub | GitLab >>>
- **Default branch:** <<< main >>>
- **Business domain in one sentence:** <<< >>>
- **Documentation language:** <<< pt-BR | en | both (Docusaurus i18n) >>>
- **Model:** **collaborative open source** project. Anyone can open an
  issue and a PR, but **every merge goes through my approval** (BDFL
  model).
- **License:** **MIT** — holder <<<Name/Org>>>, year <<<2026>>>
- **My handle:** <<< @username >>>
- **Contact e-mail (security / code of conduct):** <<< >>>
- **Financial support:** Buy Me a Coffee — <<< https://buymeacoffee.com/username >>>
- **Discussion channel:** <<< GitHub Discussions | Discord | none yet >>>
- **Docs site URL:** <<< https://username.github.io/repo >>>

---

## NON-NEGOTIABLE PRINCIPLES

1. **Never invent.** Every claim must be traceable to code, config, commit,
   PR, issue, or existing doc. When you can't determine something, write
   literally `> **TODO(human):** <specific question>`. I'd rather have a
   short, true doc than a long, invented one.
2. **Never expose a secret.** Document only variable NAMES and where
   they're read. If you find a credential in the history, stop and tell me
   as an incident.
3. **Single source of truth.** The Markdown lives in `docs/` at the root.
   Docusaurus **reads** from there, never duplicates. If you create
   `website/docs/`, you got it wrong.
4. **README is a showcase, not a manual.** Any section above ~20 lines
   migrates to `docs/`, leaving only the link.
5. **Stable documentation.** Write so that normal code changes don't
   invalidate the document (especially ARCHITECTURE.md).
6. **Ask permission before writing.** The phases have stopping points.

---

# PHASE 1 — RECONNAISSANCE
Read-only. Don't create or edit any file in this phase.

## 1.1 Structure and stack
- `git ls-files | head -300` and directory tree up to 3 levels
- Manifests: `package.json`, `pom.xml`, `build.gradle`, `requirements.txt`,
  `pyproject.toml`, `go.mod`, `Gemfile`, `*.csproj`, `Cargo.toml`, `composer.json`
- Infra: `Dockerfile`, `docker-compose.yml`, `k8s/`, `helm/`, `terraform/`,
  `.github/workflows/`, `.gitlab-ci.yml`, `Makefile`, `Procfile`
- Config: `.env.example`, `application.yml`, `appsettings.json`, `config/`.
  List EVERY environment variable and where it's read in the code.
- Entrypoints (`main`, `index`, `app`, `cmd/`, `server`) and the hot path of
  a typical request end to end.
- Scripts (npm scripts, Makefile targets, `bin/`, `scripts/`): name, what it
  does, when to use it, prerequisites.
- Auto-generatable reference sources: OpenAPI/Swagger, GraphQL schema, JSON
  Schema, Protobuf, exported TS types, docstrings. **Flag each one** — they
  go to automatic generation in Phase 5, not manual writing.
- Tests: framework, how to run, current coverage if any.

## 1.2 Git history
```bash
git log --oneline -n 500
git log --pretty=format:'%h|%ad|%an|%s' --date=short -n 800
git shortlog -sne --all                                          # code owners
git log --format='%ad' --date=format:'%Y-%m' | sort | uniq -c    # project pace
git tag --sort=-creatordate | head -30                           # releases
git log --diff-filter=A --name-only --pretty=format:'%ad' --date=short | head -100
git log --numstat --pretty=format:'' | awk '{print $3}' \
  | sort | uniq -c | sort -rn | head -40                         # hotspots
git log --format='%s' | grep -iE 'BREAKING|revert|migrat|refactor|rename'
```
Extract: architectural turns, unstable modules (hotspot = document more
carefully and watch it in `.docmap.yml`), the commit convention actually in
use, owners by area.

## 1.3 PRs, issues, and discussions
GitHub (if `gh` is authenticated):
```bash
gh repo view --json name,description,topics,homepageUrl,licenseInfo,defaultBranchRef
gh pr list --state merged --limit 150 --json number,title,body,labels,mergedAt,author,files
gh issue list --state all --limit 100 --json number,title,body,labels,state
gh release list --limit 30
gh api repos/{owner}/{repo}/labels
```
GitLab: `glab mr list --merged`, `glab issue list`, `glab release list`.
If no CLI is available, say so explicitly, proceed with plain Git, and ask
me for an export.

Look for: descriptions that explain the **why** of a decision (raw material
for an ADR), trade-offs discussed, a bug fix that reveals an implicit
business rule, breaking changes, patterns in rejected PRs.

## 1.4 Business rules
Scan the code for **domain** logic, not plumbing:
- validations, guard clauses, `if` statements with business constants,
  state machines, status enums, calculations (interest, taxes, discounts,
  SLA, limits)
- entity names and the team's ubiquitous language
- **tests are the best source of already-written rules** — read `*_test`,
  `*.spec`, `features/`, and extract rules from the case names
- migrations and schema: constraints, unique, not null, defaults are rules
  Build a domain glossary with the inferred definition of each term.

## 1.5 License audit
- Node: `npx license-checker --summary` · Python: `pip-licenses`
- Go: `go-licenses report ./...` · Java/.NET: read the POM/csproj
  Flag strong copyleft (GPL-2.0/3.0, AGPL-3.0) or ambiguous licenses, since
  they conflict with MIT's permissive promise. **Don't draw any legal
  conclusion** — record
  `> **ATTENTION(human):** dependency X under AGPL-3.0, verify`. If
  everything is permissive (MIT/BSD/Apache/ISC), state that. Also look for
  vendored third-party code, assets, fonts, and icons that require
  attribution.

## ⛔ PHASE 1 DELIVERABLE — STOP HERE
Present and wait for my OK:
1. ~15-line summary of what the project is and does
2. Textual diagram of the main flow
3. History findings (turns, hotspots, conventions, risks)
4. License audit result
5. List of auto-generatable reference sources found
6. Open questions only I can answer
7. Plan of the files you'll create

---

# PHASE 2 — CORE DOCUMENTATION
After my OK. One file at a time, showing the diff. Don't commit without me
asking.

Every file in `docs/` is born with YAML frontmatter compatible with
Docusaurus:
```yaml
---
id: architecture
title: Architecture
sidebar_label: Architecture
sidebar_position: 1
description: <one sentence, used in SEO and index cards>
keywords: [architecture, code map]
---
```
Use the `.md` extension for plain content and `.mdx` **only** when a React
component is needed — strict MDX syntax breaks loose HTML and literal `{`.

### `README.md` — the showcase
1. **Banner** at the top. If it doesn't exist, generate
   `docs/assets/banner.svg` (1200×300, bold typography, 2 colors coherent
   with the product) and `logo.svg` (512×512). Center with
   `<p align="center">`.
2. **Badges** that are real and verifiable: build, docs site deploy,
   `License: MIT`, version (latest tag), language, PRs welcome, last
   commit, contributors. No fake decorative badges.
3. One-line tagline + "the problem this solves" paragraph.
4. **Prominent link to the documentation site**, right below the badges.
5. Table of contents with anchors.
6. **✨ Features** — short bullets, each with the benefit, not the
   implementation.
7. **🏗️ Architecture in 30 seconds** — a Mermaid diagram + link to the
   full doc.
8. **🚀 Quickstart** — the SHORTEST path to "running on my machine".
   Copy-paste, prerequisites with exact version, and the **expected
   output** of each command so the person knows it worked.
9. **⚙️ Configuration** — summary table + link to the full reference.
10. **📜 Scripts** — a `Command | What it does | When to use` table.
11. **🗺️ Roadmap** — derive from open issues and labels.
12. **🤝 Contributing** — a direct invitation + links to
    `/labels/good%20first%20issue` and `/labels/help%20wanted`.
13. **👥 Contributors** — a contrib.rocks or all-contributors widget.
14. **☕ Support the project** — near the end. An honest sentence about it
    being free and maintained in spare time, the Buy Me a Coffee badge,
    and what the support enables. No guilt, no promise of reward, no
    suggestion of priority for paying users.
15. **📄 License** — "Distributed under the MIT license. See
    [LICENSE](LICENSE)."

### `docs/architecture.md` — in the matklad style
- **Bird's eye view**: one paragraph, the system as a black box, inputs
  and outputs
- **Container diagram** in Mermaid (C4 level 2 style)
- **Code map**: each top-level directory — what it is, which file to start
  reading from, and what it **doesn't** serve. Point to searchable entry
  points (entrypoints, greppable symbols)
- **Request/job flow** end to end in a `sequenceDiagram`
- **Layer boundaries and invariants** — what can never be violated
  (e.g., "domain doesn't import anything from infra"). The most valuable
  part of the document
- **Cross-cutting**: auth, logging, error handling, transactions, cache,
  feature flags
- **Data**: model, `erDiagram`, migration strategy
- **Known technical debt** — from hotspots and issues with a debt label

### `docs/business-rules.md`
- Purpose and business context, actors/personas
- Ubiquitous language glossary
- Numbered rules `RN-001`, each with: statement, where it lives
  (`file:line`), the test that covers it, origin (PR/issue) when found
- State machines in `stateDiagram`
- Edge cases and what happens when something goes wrong

### `docs/adr/`
One ADR per structural decision reconstructed from the history. Nygard
format: **Title / Status / Context / Decision / Consequences**, with date
and a link to the originating PR or commit. Only significant decisions
(database, monolith vs. service, session state, consistency model) — not
"we swapped one data library for another".
Create `0001-registrar-decisoes-com-adr.md` first.

### Diátaxis organization within `docs/`
```
docs/
  intro.md                 # site landing page
  getting-started.md       # TUTORIAL: from zero to first result
  how-to/                  # HOW-TO: one real task per file
  reference/               # REFERENCE: API, env vars, CLI, schema
  explanation/              # EXPLANATION: trade-offs, historical context
  architecture.md · business-rules.md · runbook.md
  adr/ · assets/
```
Never mix the four types in the same file. A tutorial that over-explains
becomes a bad tutorial and a bad explanation.

### The rest
- `docs/runbook.md` — if there's a deploy: healthcheck, logs, rollback,
  alerts
- `CHANGELOG.md` — reconstructed from tags and PRs, Keep a Changelog format
- `SECURITY.md` — supported versions and private reporting channel

---

# PHASE 3 — COMMUNITY LAYER

### `.github/FUNDING.yml`
```yaml
buy_me_a_coffee: <<<handle>>>
```
Don't invent other platforms I didn't mention.

### `CONTRIBUTING.md`
- **Before coding**: open an issue and wait for alignment. Spell it out —
  a large PR without a prior issue will probably be rejected.
- **Dev setup in 5 minutes.** If the real setup takes longer, flag
  `TODO(human)` — it's the biggest killer of outside contribution.
- **How to run the docs site locally** (`npm run docs:start`) and the rule
  that **a PR that changes behavior needs to update the corresponding
  doc**, pointing to `.docmap.yml`.
- **Flow**: fork → branch (`feat/`, `fix/`, `docs/`) → commit in the
  convention the history uses → PR against `<<<branch>>>` → my review →
  squash merge.
- **What I gladly accept** vs. **what I probably don't** (stack swaps,
  broad refactors without discussion, heavy new dependencies, scope
  changes). Be concrete — this section saves time on both sides.
- **Definition of Done**: tests passing, clean lint, **doc updated**,
  CHANGELOG touched, docs site build with no broken links, no secrets.
- **Honest SLA**: "I generally review within X days; it's a spare-time
  project — if I disappear for a week, a polite ping on the PR is fine."
  No promising 24h.
- **Recognition**: how the contributor gets credited.
- **Inbound = outbound licensing**: by submitting a PR, the contributor
  agrees to license under the same MIT. No CLA. Present DCO
  (`git commit -s`) as **optional**, explaining the friction it causes for
  a casual contributor.

### `GOVERNANCE.md`
BDFL model, without arrogance: who has merge rights, how a decision is
made, how to disagree (open a Discussion, don't fight in review), how a
decision becomes an ADR, and the criteria for someone becoming a
maintainer with merge rights.

### `CODE_OF_CONDUCT.md`
Contributor Covenant 2.1, official text in full, with my e-mail filled in.
Don't rewrite the CoC text.

### `SUPPORT.md`
Routes: usage question → Discussions/Discord; reproducible bug → bug
issue; idea → feature issue; security vulnerability → SECURITY.md,
**never** a public issue.

### `.github/ISSUE_TEMPLATE/` (`.yml` format, required fields)
- `bug_report.yml` — version, environment, steps, expected vs. actual,
  logs, "I searched for duplicate issues" checkbox
- `feature_request.yml` — problem it solves, alternatives considered, and
  **willingness to implement it (yes/no)**: separates idea from
  contribution
- `doc_issue.yml` — page, what's wrong or missing, site link
- `config.yml` — `blank_issues_enabled: false` + contact_links to
  Discussions, the docs site, and Buy Me a Coffee

### `.github/pull_request_template.md`
Description, `Closes #`, change type, how to test, screenshots if UI, DoD
checklist **including "I updated the affected documentation (see
`.docmap.yml`)"**, and a checkbox "I agree to license this contribution
under the project's MIT license".

### `CODEOWNERS`
`* @<<<handle>>>` — makes me a required reviewer on everything.

### Labels
A lean set with a ready `gh label create` command: `good first issue`,
`help wanted`, `bug`, `enhancement`, `docs`, `docs-needed`, `question`,
`wontfix`, `needs-triage`, `blocked`, `breaking`.

---

# PHASE 4 — DOCUSAURUS SITE

## 4.1 Scaffold
Install into `website/`, **without** duplicating content:
```bash
npx create-docusaurus@latest website classic --typescript
```
Pin the dependencies to `3.x` — v4 is in development with breaking
changes.

Add to the root `package.json` (or create one if there isn't one):
```json
"scripts": {
  "docs:start": "npm --prefix website start",
  "docs:build": "npm --prefix website build",
  "docs:serve": "npm --prefix website serve"
}
```

## 4.2 `website/docusaurus.config.ts`
Must configure:
- `title`, `tagline`, `favicon`, `url`, `baseUrl` (`/<repo>/` for GitHub
  Pages), `organizationName`, `projectName`, `trailingSlash: false`
- **`path: '../docs'`** in the `docs` preset — reads the single source of
  truth
- **`routeBasePath: '/'`** — docs at the site root, no separate landing
  page
- **`onBrokenLinks: 'throw'` and `onBrokenMarkdownLinks: 'throw'`** — this
  turns a broken link into a CI failure, the cheapest mechanism against
  doc rot
- **`editUrl`** pointing to `blob/<branch>/docs/` — an "edit this page"
  button on every page, the smallest possible friction for a doc
  contribution
- **`showLastUpdateTime: true` and `showLastUpdateAuthor: true`** —
  publicly exposes when a page was last touched. Stale pages become
  visible.
- **Mermaid**: `markdown: { mermaid: true }` +
  `themes: ['@docusaurus/theme-mermaid']`
- **Docusaurus Faster** (3–4× faster build, already stable):
```ts
  future: { experimental_faster: true }
```
- **Search**: if I don't have Algolia DocSearch, use
  `@easyops-cn/docusaurus-search-local` with `hashed: true`. Never ship the
  site without search.
- **Blog**: enable it as a release-notes channel; otherwise `blog: false`
- **i18n**: only if I asked for docs in two languages (`defaultLocale`,
  `locales`)
- **Dark mode** with `respectPrefersColorScheme: true`
- Navbar with: Docs, API Reference, Blog, GitHub link, and a
  **☕ Support** item pointing to Buy Me a Coffee
- Footer with the MIT license, community links, and copyright

## 4.3 `website/sidebars.ts`
Hand-written and organized by **Diátaxis**, not a messy auto-generation:
```
🚀 Start here    → intro, getting-started
📘 Guides        → how-to/*
🏗️ Architecture  → architecture, adr/*
📐 Rules         → business-rules
📖 Reference     → reference/*  (partially auto-generated — Phase 5)
💡 Explanation   → explanation/*
🛠️ Operations    → runbook
🤝 Contribute    → contributing
```

## 4.4 Versioning
If the project has published releases, configure `versions` and document
the command `npm run docusaurus docs:version X.Y` in CONTRIBUTING, along
with the rule of **when** to version (only on major/minor, never on patch —
versioning too much multiplies the doc-maintenance cost by N).

## 4.5 Deploy — `.github/workflows/docs-deploy.yml`
- Trigger: push to `<<<branch>>>` with `paths: ['docs/**', 'website/**']`
- A **build-on-every-PR** job (no deploy) to catch broken links and MDX
  errors before merge
- Deploy to GitHub Pages via `actions/deploy-pages`, with controlled
  concurrency
- Caching for `node_modules` and the Rspack persistent cache

## 4.6 Content adjustments
- `docs/intro.md` as landing page: what it is, for whom, and three paths
  ("I want to use it", "I want to understand it", "I want to contribute")
- Convert the env-var and script tables to `reference/`
- Replace absolute GitHub links with relative links between docs
- A `<Tabs>` for commands that vary by OS or package manager
- Verify that the Mermaid diagrams render in both light **and** dark theme

---

# PHASE 5 — CONTINUOUS SYNCHRONIZATION
This is the most important phase. Documentation doesn't die from lack of
initial writing, it dies from drift. Install mechanisms, not good
intentions. Preference order: **generate > verify > remind**.

## 5.1 `.docmap.yml` — the responsibility map
Create at the root, derived from what you learned in Phases 1 and 2:
```yaml
# Map: code change → documentation that needs to be reviewed.
# Used by Claude Code (/sync-docs) and by CI (docs-drift).
version: 1

rules:
  - id: api-surface
    watch: ["src/routes/**", "src/controllers/**", "openapi.yaml"]
    docs:  ["docs/reference/api.md"]
    generated: true          # generated from OpenAPI, don't hand-edit
    severity: block          # blocks the PR

  - id: domain-rules
    watch: ["src/domain/**", "src/**/*.rules.*", "migrations/**"]
    docs:  ["docs/business-rules.md"]
    severity: block
    note: "Every changed RN needs its file:line reference updated."

  - id: config
    watch: [".env.example", "src/config/**"]
    docs:  ["docs/reference/configuration.md"]
    generated: true
    severity: block

  - id: architecture
    watch: ["src/**/index.*", "docker-compose.yml", "package.json"]
    docs:  ["docs/architecture.md"]
    severity: warn           # only comments on the PR
    note: "Only update if a layer boundary or structural dependency changed."

  - id: scripts
    watch: ["package.json", "Makefile", "scripts/**"]
    docs:  ["docs/reference/scripts.md", "README.md"]
    severity: warn

  - id: adr-trigger
    watch: ["src/infra/**", "docker-compose.yml", "terraform/**"]
    requires_adr: true
    severity: warn
    note: "Structural change? Probably deserves an ADR."
```
Adjust the paths to the real repository. Don't copy the example blindly.

## 5.2 `CLAUDE.md` at the root — permanent instructions
This makes every future Claude Code session update the docs by default,
without me having to ask. Write it concise and imperative:
```markdown
# Project instructions

## Documentation is part of the definition of done
When changing code, consult `.docmap.yml` and update the mapped
documents **in the same change**. Don't leave it for later, and don't
ask me if you should — do it, and show the doc diff along with the
code diff.

## Rules
- Single source of truth for Markdown: `docs/`. Never create
  `website/docs/`.
- Files marked `generated: true` in `.docmap.yml` are generated: run
  the generation script, don't hand-edit. If you edit it, the next
  build overwrites it.
- Changed observable behavior? Add an entry to `CHANGELOG.md`
  (Unreleased).
- Changed an architectural boundary, the database, the consistency
  model, or a structural dependency? Create an ADR in `docs/adr/`
  with the next number.
- New business rule? Add `RN-XXX` to `docs/business-rules.md` with
  `file:line` and the test that covers it.
- Before finishing, run `npm run docs:build` — a broken link fails
  the build.
- Never invent doc content. Without enough information, use
  `> **TODO(human):** <question>`.

## Conventions
- Commits: <<<Conventional Commits>>>. Doc-only uses `docs:`.
- Diagrams in Mermaid, inside the Markdown itself. Never a diagram
  image.
```

## 5.3 Generated reference — eliminate drift at the source
Whatever can be generated should never be hand-written. Create the scripts
that apply to the real stack and wire them to `npm run docs:generate`:
- **API**: OpenAPI → `docusaurus-plugin-openapi-docs`, or GraphQL schema →
  `docusaurus-graphql-plugin`
- **Env vars**: a script that scans the code for env reads and regenerates
  `docs/reference/configuration.md` with
  `<!-- BEGIN:GENERATED --> ... <!-- END:GENERATED -->` markers
- **CLI**: capture the `--help` output of each command
- **Types/SDK**: TypeDoc, pdoc, godoc, javadoc → embedded in `reference/`
- **Scripts**: extract from `package.json` / `Makefile`
- **ADR index**: generate `docs/adr/index.md` from the files and their
  statuses
- **Contributors**: all-contributors or an action that updates the section
  Every generated file starts with:
  `> ⚠️ File generated by \`npm run docs:generate\`. Don't hand-edit.`
  And it becomes a CI check: if the generated output differs from what's
  committed, the PR fails.

## 5.4 `.github/workflows/docs-check.yml` — the guardian
Run on every PR:
1. **Site build** with `onBrokenLinks: throw` → catches broken links and
   invalid MDX
2. **Drift check**: a script that reads `.docmap.yml`, cross-references it
   with `git diff --name-only origin/<branch>...HEAD`, and for each rule
   triggered without the corresponding doc changed:
    - `severity: block` → fails the check
    - `severity: warn` → comments on the PR listing the files to review
    - Mandatory escape hatch: `docs-not-needed` label or a
      `docs-not-needed: <reason>` line in the PR body clears the check.
      Without an escape hatch, the team learns to game the rule instead of
      following it.
3. **Generated files up to date**: run `docs:generate` and fail on any diff
4. **Prose lint**: Vale or textlint (optional, propose and ask)
5. **External links**: `lychee`, only on a weekly schedule — not on every
   PR, so a third-party site being down doesn't break the build

## 5.5 `.claude/commands/sync-docs.md` — manual command
Slash command for when I want to run the sync on demand:
```markdown
Compare the current code with the documentation and fix the drift.

1. `git diff --name-only <<<branch>>>...HEAD` (or the range I pass as $ARGUMENTS)
2. Read `.docmap.yml` and determine which docs were affected
3. For each affected doc: read it, compare it against the reality of the
   code, and fix **only what's factually wrong or missing**. Don't rewrite
   the style.
4. Run `npm run docs:generate` and include the result
5. Update `CHANGELOG.md` if there's an observable change
6. Check whether any ADR is needed; if so, propose the text
7. Run `npm run docs:build` and fix whatever breaks
8. Final report: what changed, what remained as TODO(human), and what you
   deliberately did NOT change and why
```

## 5.6 `.github/workflows/docs-audit.yml` — periodic audit
Monthly (`schedule: cron`), opens or updates a single issue with the
`docs` label:
- Pages whose `last_update` is older than N months and whose corresponding
  code changed afterward
- Documents with pending `TODO(human)`
- `file:line` references that no longer resolve (file moved or removed)
- ADRs in `proposed` status for more than 60 days
- Dead external links (from the weekly check)
  Never open a new issue each round — update the existing one.

## 5.7 Local hooks (optional — propose and ask)
`pre-push` via husky/lefthook that runs the drift check locally, so the
contributor finds out before opening the PR rather than after. Only
install if I approve: a slow hook is the fastest way to make someone use
`--no-verify` forever.

## 5.8 Document the mechanism itself
Create `docs/explanation/documentation-workflow.md` explaining how this
system works, why it exists, and what to do when the drift check
complains unfairly. A mechanism nobody understands is a mechanism someone
turns off.

---

# PHASE 6 — MIT LICENSING

### `LICENSE`
**Official, unmodified** MIT text, at the root, no extension, year and
holder filled in. If a LICENSE exists with a different license or a
placeholder (`[year]`, `[fullname]`), fix it and tell me. Never add
clauses — modified MIT stops being recognized by tools and by corporate
legal.

### Declared coherence
Check whether `package.json` (root **and** `website/`), `pyproject.toml`,
`Cargo.toml`, `pom.xml` declare `"license": "MIT"` and fix divergences.
A license declared in three places with different values is a real and
common problem.

### `THIRD_PARTY_NOTICES.md`
If Phase 1.5 found vendored code, assets, fonts, or icons that require
attribution, create the file with the attribution for each. Include the
Docusaurus footer with the license note.

### SPDX (optional — propose and ask first)
`// SPDX-License-Identifier: MIT` header in the main source files.

---

# WRITING RULES
- Active voice, present tense, second person in steps. Short sentences.
- Every command in a block with the right language tag and the **expected
  output**.
- Diagrams always in **Mermaid**, inside the Markdown itself — renders on
  GitHub and in Docusaurus, versions well, and survives diffs. Never a
  diagram image. Max ~12 nodes; if it exceeds that, split it into two.
- Emojis only in README section titles and sidebar labels, sparingly.
- **Relative** links between docs, so they work in a fork, a mirror, and
  on the site.
- Inviting and specific tone, never bureaucratic. "Open an issue first" >
  "Contributors are forbidden from submitting changes without prior
  consent."
- Say "no" early and with a reason. Rejecting a PR after 300 lines have
  been written is what burns out maintainers and contributors alike.
- No language that turns financial support into a support contract.
- Zero lorem ipsum. Zero generic TODO — only `TODO(human)` with a specific
  question.

---

# CLOSING
At the end, deliver:
1. Tree of files created and changed
2. Consolidated list of `TODO(human)` and `ATTENTION(human)`, ordered by
   impact
3. Confirmation that `npm run docs:build` passes with no broken links
4. Drift-check simulation: run it against the last 5 commits and show what
   it would have flagged — proof that the mechanism works
5. GitHub Community Standards checklist with what's still pending
6. Commit messages in Conventional Commits, logically grouped
7. Three things you noticed about the project from reading the history
   that I probably didn't know

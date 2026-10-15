# 0029 — Continuous documentation synchronization

## Context

The repository reached v0.1.0 with 28 ADRs, an extensive `CLAUDE.md` and
six runbooks — and no document at all explaining the system as a whole.
This isn't a lack of writing: whole-system documentation doesn't come from
a one-off decision, and an ADR doesn't substitute for a map.

The documentation mission produced that set. The next problem is harder
than the first: **documentation doesn't die from a lack of initial
writing, it dies from drift**. The code changes, the doc stays, and the
day comes when it describes a system that no longer exists. From then on
nobody trusts any page, including the correct ones.

The initial survey measured the size of the risk in this repository:

- 96 commits in a single month, with `apps/api/src/db/schema.ts` changed
  23 times — the most volatile file in the project;
- 89 environment variables, 64 event identifiers, 110 HTTP routes and 13
  action types, all as free strings in the code, with no type union
  forcing anyone to update a list;
- an already-existing `.docmap.yml` whose globs pointed at nonexistent
  paths in **eight** cases (`apps/api/drizzle/**`, `k8s/**`, `helm/**`),
  inherited from an earlier directory structure.

The last item is the most instructive. A glob that matches nothing doesn't
fail — it simply never fires. The rule exists in the file, gives the
impression of coverage, and protects nothing. A responsibility map with no
validation degrades silently in exactly the same way as the documentation
it's supposed to protect.

## Decision

Install mechanism, not good intentions, across three levels of decreasing
reliability: **generate > verify > remind**.

### 1. Generate, where the list is the content

`docs/reference/scripts.md` comes entirely out of `pnpm docs:generate`,
extracted from the `package.json` files and the annotated `Makefile`
targets. There's no prose to preserve, so there's no reason for anyone to
maintain the list by hand.

### 2. Verify, where the prose is worth more than the list

`configuration.md` and `events.md` are hand-written — the "what goes
wrong" column and the "when this event happens" text are the real value,
and no script writes that. But the **list** needs to be complete.

The solution is a block between `<!-- BEGIN:GENERATED:<id> -->` and
`<!-- END:GENERATED:<id> -->` inside the hand-written file. The block is
the mechanical inventory; the text around it is the explanation. The
inventory flags what exists in the code and has no description in the
prose.

This found two real event types on the first run —
`agent.response` and `tool.result`, the latter emitted by the
`Engine.Harness.Hooks.EventLog` hook — that the manual extraction had
missed.

### 3. Remind, where human judgment is required

`docs/.docmap.yml` links code paths to the documents that depend on them,
with severity `block` or `warn`. A script cross-references the PR's diff
against the map and flags what wasn't updated.

Four decisions within this one:

**The map is validated in CI.** A dead glob fails, before any other check.
A broken map makes everything else a lie.

**The escape hatch is mandatory.** A `docs-not-needed` label or a
`docs-not-needed: <reason>` line in the PR body release the check. Without
a legitimate way out, the habit that forms is to cheat it — a cosmetic doc
commit just to get the gate to pass — and then the mechanism itself starts
lying, which is worse than not existing.

**A false positive is a defect, not acceptable noise.** The first version
of the environment-variable checker flagged seven items that were actually
documented under the abbreviation `POSTGRES_HOST` / `_USER` / `_PASSWORD`.
The checker was taught to expand the abbreviation. A check that gets it
wrong trains people to ignore it.

**The site build is the cheapest gate.** `onBrokenLinks`,
`onBrokenAnchors` and `onBrokenMarkdownLinks` set to `throw`: moving a file
without fixing whatever points to it breaks CI instead of turning into a
404 in production.

### 4. Periodic audit, for what the PR doesn't catch

The drift check catches docs that became **wrong** in a PR. Docs that went
**stale** without anyone touching them trigger nothing. A monthly audit
reports pages that stood still while their corresponding code moved on,
pending `TODO(humano)` markers, `file:line` references that don't resolve,
and ADRs stuck in `proposed` for more than 60 days — always in the same
issue, updated in place. A new issue every month becomes spam, and spam
gets turned off.

### 5. Single source, site that only reads

The Markdown lives in `docs/` at the root. The Docusaurus site in
`website/` reads from there via `path: '../docs'`, and `website/docs/`
**never** exists. Duplicated content is content that diverges.

## Consequences

**The PR gets more expensive.** Touching `apps/api/src/domain/**` without
updating `business-rules.md` fails. That's the intended cost: the
alternative is the docs rotting, and that cost shows up months later,
scattered and larger.

**The map needs maintenance.** A renamed directory leaves a dead glob —
now CI flags it, but someone still has to fix it. It's new work, small and
visible, in exchange for old work, large and invisible.

**The warnings will sometimes be wrong.** The map works by file path, not
by semantics: a refactor that renames internal variables triggers
`dominio-e-regras` without changing any rule. The escape hatch exists for
that. If the same rule gets waived three times in the same week, the
problem is the rule: narrow the glob or lower the severity.

**The mechanism doesn't verify that the text is correct.** It verifies
that the text was *reviewed* when the code changed, and that the lists are
complete. A factually wrong sentence that nobody touched passes every
check. That's what human reading and the `/sync-docs` slash command are
for.

**GitHub Pages requires a public repository or an Enterprise plan.** The
site's deploy will fail while the repository is private. The build job on
PR — which is what carries the gate's value — works either way.

**Two new dependencies at the root**, `yaml` and `picomatch`, both
dev-only and covered by the pre-approved exception for documentation
tooling.

The whole mechanism is explained in
[`docs/explanation/documentation-workflow.md`](../explanation/documentation-workflow.md),
including what to do when it complains unfairly. A mechanism nobody
understands is a mechanism someone turns off.

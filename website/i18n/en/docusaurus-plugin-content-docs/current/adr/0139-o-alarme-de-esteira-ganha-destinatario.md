---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0139 — The pipeline merge alarm gains a recipient, and the rule covers `dev`

## Context

The policy has always said that promotion is `--no-ff`
([branching-policy.md](../explanation/branching-policy.md)): *"a squash would
flatten the lower step's commits, and the stage's tag would end up pointing to a
commit that no longer exists"*. The rule was broken **three times** — #367
(2026-08-24), #394 (2026-08-25) and #464 (2026-09-04) — and the third was the
most expensive of all, because it was precisely the PR that fixed the first
two.

What was discovered while investigating was not a detection hole. It was the
opposite:

**The check existed and worked.** `tag-release` has failed a merge into `qa`
without a second parent since 2026-07-27, and the log of the 2026-08-25 run says,
in so many words:

```
[tag-release] o merge em `qa` não é merge commit (1 pai)
##[error]o merge em `qa` não é merge commit (1 pai)
```

It fired on both squashed promotions. And the history stayed broken all the
same, for 293 commits, until the following promotion opened with 11 files in
"conflict" that were not conflicts — only lost ancestry.

**What was missing was WHOM to alert.** A `push` workflow that fails on a
permanent branch has no PR where it can turn red: the merge already happened.
What remains is a run in the Actions tab, which nobody opens because nothing
says it exists. The repository had **zero issues** in its entire history — the
channel did not exist. Detection without an address is an alarm ringing in an
empty room.

### Why not simply turn off squash

It was the first way out considered, and it is the only one with an absolute
guarantee: `allow_squash_merge: false` makes the button cease to exist. It was
**measured and rejected**, with the number in hand: the six most recent merges
into `dev` are single-parent squashes — squash *is* the work-PR convention here
—, and `scripts/changelog.mjs` generates the CHANGELOG with
`git log --no-merges`, counting on that: today a squash is one line; with a
merge commit, every intermediate WIP commit would become an entry. Turning off
squash fixes promotion by taxing every work PR and touching changelog
generation. The problem is the pipeline's; the bill would be paid by the work.

It is recorded what also does not work, so nobody looks again: **merge queue**
would solve it with a fixed method per queue, and CLAUDE.md explicitly forbids
it; and GitHub's native per-branch control in this space is
`required_linear_history`, which does the **inverse** — it forbids merge
commits. There is no "require merge commit" per branch.

## Decision

**1. The alarm gains a job with a recipient.** `tag-release.yml` gains
`avisar`, `if: failure()`, which opens an issue naming branch, commit, run and
the fix — and **comments on the already open issue** instead of opening a second
one for the same branch, because a flood of identical issues is the fastest way
to teach someone to ignore them. The title is a deduplication key, pinned by a
test (`tituloDoAlarme`).

It authenticates with `github.token`, **never with the PAT**: an invalid
`BRABO_BOT_TOKEN` is one of the failures it needs to report (the `checkout` dies
with `could not read Username`), and an alarm that depends on what may be broken
is an alarm that goes silent exactly when it needs to ring. The body goes via
`--body-file`, never interpolated into a `run:` — the text has backticks and
`$`, and interpolating content inside `bash -e` is injection.

**2. The rule now covers `dev`, and the coverage is NARROW.** `dev` receives
work all the time and by squash on purpose, so "one parent is a defect" does not
hold there — it would fail every PR. What is a defect in `dev` is the PR that
**brought a new edge**: its head was a merge whose second parent was not yet in
the base. That was #464, whose entire delivery was that edge.

The distinction matters because there is an almost identical and **benign**
neighbor: the work PR that pulled `dev` into itself before merging also has a
merge as head — but the second parent is already in the base, and the squash
loses nothing.

**3. The query that identifies the PR is by `merge_commit_sha`, and that is not
style.** `gh api repos/{repo}/commits/{sha}/pulls` returns **every** PR
associated with the commit — and since `dev` is the head of the promotion PR
that stays open the whole cycle, every `dev` commit comes associated with it.
Reading `.[0].head.ref` would return `dev` (a permanent branch) for any work-PR
squash, and the rule would fail the entire repository. The mistake was made and
caught by checking against real data before shipping; it is written down so it
does not come back.

**4. `null` is an answer, and in `dev` it does not become a defect.** Not being
able to know whether there was an edge (API down, PR deleted, object missing in
the clone) is different from knowing there was not. In `dev` it passes, because
the base rate is legitimate work. In `qa`/`main` nothing changes: only the
pipeline enters there, and one parent is a defect with or without a known
origin. It is deliberately the **inverse** of the `promotion-check` doctrine
("an impossible check counts as failed") — there the universe is only
promotion, here it is not.

## Consequences

**This does not prevent, and the distinction is the point.** The method is
chosen at the click; truly preventing it would require one of the two exits
rejected above, or taking the merge out of the human's hand — which runs into
the CLAUDE.md rule that a merge into a protected branch is always manual. What
changes is the discovery time: from "in the next promotion cycle" to "one minute
later, in an issue with an owner", when reverting is still trivial.

**Prevention remains open, and it is a product decision.** The exit that solves
it without taxing the work is `promote.yml` — which already exists, is already
`workflow_dispatch` and already has the pipeline pair as input — performing the
`git merge --no-ff` itself. That preserves authority (nothing merges without a
human triggering it) and mechanizes only the method, but it requires deciding
whether a human dispatch counts as a "manual merge" in the CLAUDE.md sense, and
it would open a third exception to "never push directly to a permanent branch".
It was not taken here.

**Verified against real data, not by reasoning.** The rule was run against the
three commits that motivated it: it fails `bf6db00c9` (the squash of #464) and
passes `1eb71c322` and `108d81cc7` (normal work PRs) — no false positive.

**A finding along the way, and outside this ADR's reach:** `BRABO_BOT_TOKEN` has
been invalid or expired since the night of 2026-09-03, and so **no tag is being
stamped on any branch** — the `tag-release` `checkout` fails before any logic.
Only rotating the secret solves it, and that is `TODO(humano)`. Recorded in
CLAUDE.md.

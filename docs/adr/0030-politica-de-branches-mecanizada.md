# 0030 — Mechanized branch policy

## Context

Brabo's branch policy existed as a presentation and as a convention in
`CLAUDE.md`: the `dev → qa → main` pipeline, branch taxonomy, promotion
only between neighboring rungs, calculated version, hotfix flowing back via
backmerge.

A written convention isn't a mechanism. As long as the rule lives only in
the document, it depends on everyone remembering it at the wrong moment —
and the wrong moment is always the incident, at 3am, when remembering is
precisely what doesn't happen. Worse: a rule nobody checks has no way of
being violated *visibly*. It gets violated silently, and the symptom
appears months later, far from the cause.

PHASE 6 mechanized the entire policy in Brabo's own repository. This ADR
closes the phase: it maps **rule → mechanism**, records what was cut along
with the cost of reintroducing each cut, and separates what of this becomes
a template for the product's Gitflow bootstrap — which is a future phase,
not code now.

Two constraints shaped everything. The first: **this is a user repository,
not an organization's.** GitHub Teams don't exist here, and the
`GITHUB_TOKEN` doesn't read team membership, not even within an
organization. The second: **the product cannot be touched in this phase.**
PHASE 6 is the Brabo repository's own CI/CD; whatever it teaches the
product becomes this ADR, not code.

## Decision

### Rule → mechanism

| policy rule | mechanism | where the logic lives |
|---|---|---|
| name `function/description`, regex `^.{0,15}/\S{0,32}$` | `pr-police` check | `scripts/ci/pr-police.ts` |
| prefix from the closed list of 9 functions | `pr-police` | same |
| work is born from `dev`, `hotfix` from `main` | `pr-police`, by **contamination** | same |
| destination coherent with the function | `pr-police` | same |
| promotion only between neighboring rungs | `pr-police` + `promote` | `pr-police.ts`, `version.ts` |
| family label on every PR | `pr-police` | same |
| approval required by destination | `approval-ladder` check | `scripts/ci/approval-ladder.ts` |
| two approval modes by variable | `approval-ladder` | same |
| distinct people on `main` | pairing by backtracking | same |
| version by the cycle's biggest impact | `promote` + `tag-release` | `scripts/ci/version.ts` |
| `N` increments on rejection | count of existing tags | same |
| final anchored to the last `-qa.N` | `tag-release`, by **tree + parent** | same |
| hotfix produces a PATCH with no anchor | `tag-release`, via the **second parent** | same |
| direct push blocked | rulesets | `docs/reference/rulesets.md` |
| backmerge mandatory and ordered | `backmerge-gate` check | `scripts/ci/gate.ts` |
| merge into a permanent branch is always manual | absence of mechanism, by decision | — |

All the logic is a **testable script**; the workflow is a thin shell that
reads the environment and calls the script. There are 149 tests covering
happy paths and failure cases.

### The seven lessons that mattered more than the code

They're recorded here because each one cost an empirical discovery, and
none of them is obvious from third-party documentation.

**1. Each trigger family reads the workflow from a different place.**
`pull_request` and `push` read from the event's branch; `pull_request_target`
and `workflow_dispatch`, from the **default** branch. With
`pull_request_target`, `pr-police` had **zero executions** — `main` was 65
commits behind. It's a chicken-and-egg problem: the check that makes the
pipeline move needs to already be on `main` to be able to run.

**2. A tag or PR created with the `GITHUB_TOKEN` doesn't trigger a
workflow.** A rule against recursion. The `v0.2.0` release never published
because of this, and a backmerge PR with no check would never go green —
the chain would be stuck forever. Hence `BRABO_BOT_TOKEN`.

**3. "Couldn't verify" can never become "everything's fine".** The
`promotion-check` read the merge configuration with `gh api --jq` and
compared it against `'true'`. When the token lacks permission, the command
**succeeds and returns empty** — and empty isn't `'true'`, so the check
started failing for the wrong reason, or worse, approving. Today there are
three states, and the impossibility becomes a warning while the real
guarantee looks at the fact on the ground: the commit has two parents.

**4. Tree equality is stronger than commit equality.** The anchor used to
compare shas — impossible to satisfy, because `--no-ff` creates a new
commit. Comparing the **tree** and requiring `-qa.N` to be a **parent** is
stronger: if the other side of the merge had brought in a file, the tree
would have changed.

**5. Contamination, not origin.** Figuring out where a branch was born from
is undecidable after the fact: with `P ⊆ Q ⊆ head`, the distance argmin
picks the most advanced permanent branch contained in it, not the one it
originated from. The right question is different — "does this branch carry
the tip of a more advanced permanent branch than the one it claims?" — and
that one has an answer.

**6. Exemption by author, never by prefix.** Exempting branches that start
with `dependabot/` would be an open door: anyone can name a branch that
way.

**7. Declared state has to be checkable.** `.release/gate.json` travels
along in the backmerge PRs to `qa` and `dev`; a promotion could push that
stale copy back up and resurrect a lock with no hotfix behind it — locking
the repository forever, because there'd be no pending backmerge to resolve
it. The check asks git whether the hotfix has already come down and lets
satisfied locks fall away. `locked` is the record of intent; containment is
the truth.

### What was cut, and the cost of bringing it back

| cut | why | what reintroducing it costs |
|---|---|---|
| `rc` / UAT rung | no environment and no people to exercise it, it would be a ceremonial rung | creating the branch, one line in `ESCADA`, one in `ESTAGIO_POR_BRANCH`, one in the approval ladder, and the gate's ordering gains a rung — the hotfix chain becomes four PRs |
| `rcfix` taxonomy | died with the `rc` rung | an entry in `FUNCOES_DE_CORRECAO_ALTA` plus the origin and destination tests |
| GitHub Teams for roles | a user repo has no teams, and the `GITHUB_TOKEN` doesn't read membership even within an org | roles are lists of handles in variables; migrating to teams would require the org and a token with `read:org` |
| deploy | a step that never runs rots: nobody tests it, and on the day it's turned on it'll be wrong | its OWN workflow triggered by the tag, plus the Environments — nothing here to reconnect |
| GitHub Environments | same | create them when there's an environment |
| `GOVERNANCE.md` | cut in the DOC PHASE; the criterion lives in `branching-policy.md` | write the file and move the roles section there |

The `community` mode approval ladder was **not** cut: it's implemented,
tested and turned off by configuration. The difference is deliberate: code
disabled by a variable, with tests for both sides, is demonstrable today; a
pipeline step disabled by a variable is not.

### What becomes a template for the product's bootstrap

The product provisions repositories with Gitflow (PHASE 2). What PHASE 6
learned that should go into that template, in a future phase:

| goes into the template | doesn't |
|---|---|
| the pipeline and taxonomy as **data**, not code — the product has projects with different ladders | Brabo's workflows copied literally |
| the backmerge gate: it's the rule that costs the most when missing | `BRABO_BOT_TOKEN` — each repo needs its own credential |
| version calculated from the tag, with no bump PR | this repo's lists of approvers |
| "couldn't verify" as an explicit third state in the gates | — |
| bot exemption by author | — |

`GitProvider` already exposes `capabilities`, and ADR 0028 records that
branch protection **diverges between providers**. The template will have
to degrade gracefully: where there's no ruleset, the rule becomes a check
and the message says what couldn't be guaranteed — instead of faking a
guarantee.

## Consequences

**The policy stopped depending on memory.** A wrong branch name, a
promotion skipping a rung, a hotfix with no backmerge and an unanchored
final tag are now check failures with a message that teaches, not
late-discovered surprises.

**The pipeline was exercised end to end, not just unit tested.**
`v0.1.0 → v0.2.0-dev.1..4 → -qa.1..3 → v0.2.0`, with one staged rejection
between `qa` stamps to prove `N` counts on its own. The final tag anchored
on `-qa.3` with an identical tree.

**A required check that never runs locks the PR forever.** This is the
most uncomfortable consequence: the list of required checks is now a
coupling between the ruleset (applied by hand) and the workflows
(versioned). A new CI job either goes into `rulesets.md`'s list, or stays
out on purpose and someone writes down why. That's why `backmerge-gate` has
no `if:` on its job: an old verdict attached to a sha that never ran would
release a merge during a lock.

**The gate's bypass belongs to the actor, not the path.** GitHub rulesets
don't restrict bypass by path. Whoever can write `.release/gate.json` can,
technically, write anything to `main`. What actually limits this is the
workflow and the history. Recorded as a tool limitation.

**Applying the ruleset remains manual.** The repository versions the
source (`docs/reference/rulesets.md`); applying it is the owner's act.
Automating it would require a token with the power to change its own
protections — which would defeat their purpose.

**The concentration of roles in the owner is written down, not implied.**
Release owner and hotfix on-call are the owner while `APPROVAL_MODE=solo`.
Both assignments reopen with the migration to `community`, where the
on-call fallback will have to be a documented exception, never a
workaround.

**Nothing in the product changed.** Not a single line under `apps/` was
touched. What the phase taught the product is in the template table above,
and became a plan, not code.

References: ADR [0028](0028-protecao-de-branch-divergencia-entre-providers.md)
(protection divergence between providers),
[0029](0029-sincronizacao-continua-da-documentacao.md) (the documentation
mechanism this phase uses), and the full policy in
[branching-policy](../explanation/branching-policy.md).

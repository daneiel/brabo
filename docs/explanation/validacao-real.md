---
id: validacao-real
title: The real validation — remote GitHub and a real model
sidebar_label: Real validation (13b)
sidebar_position: 6
description: The execution against a real remote repository, with a real dev agent and an API model — what it proved, what it disproved, and why failing here is worth more than passing.
keywords: [validation, dogfooding, GitHub, dev agent, measurement, PHASE 13b]
---

# The real validation — remote GitHub and a real model

The [Phase 12 validation](./validacao-fase-12.md) states its own limits in
full: `LocalGitProvider`, `NoopDevAgent`, a gate verdict written by the
script itself. It exists to prove the **chain** without depending on network
or model judgment, and it does that well.

This one swaps out exactly the three things that one left out — remote
GitHub, a real dev agent, an API model — and the result is what you'd expect
from an honest dogfooding run: **the cheap half passed entirely, and the
expensive half failed in a way no test had shown.**

The script is `pnpm --filter api validacao:real -- --repo <owner/repo>`.

## What passed, and is more than it looks

Everything below ran against `daneiel/test` on real GitHub, and **without
spending a cent** — it's the `--ate backlog` phase.

| what | result |
|---|---|
| remote adoption (real `getRepo`) | `origin: adopted`, default branch `main` |
| dry-run plan | 6 mutations, 6 diagnostics, **null decision** |
| repository untouched until the decision | verified via the API: **zero branches, zero content** |
| re-adoption converges | 6 mutations on the 1st pass, **3 on the 2nd** ([RN-046](../business-rules.md#rn-046)) |
| single story becomes `draft` + proposed | yes, no automatic promotion |
| `claimNext` before promotion | `null` — nothing claimable |
| promotion | recorded with the **user** as the actor |

RN-045 stops being proven only against a local bare repo: the remote
repository was checked **after** adoption and was literally empty.

### Finding D actually happened

The bootstrap stopped at `protect_branches` with
`Upgrade to GitHub Pro or make this repository public` — a private
repository on the free plan. It's exactly the scenario Finding D
documented, now observed outside a test.

And [RN-078](../business-rules.md#rn-078)'s premise was confirmed: checking
the repository right after, `dev`, `main`, and `qa` existed and the files
were committed. It's the **last** step, and the only one whose failure
leaves a usable repository. The script recognizes the failure and moves on,
which is the intended outcome.

## What the expensive execution showed

Model `openai/gpt-5-mini` via OpenRouter, real dev agent, one story with one
task: *"Expose GET /greeting"*.

**The task was blocked by `iteration limit reached`, with origin
`modelo`.** No PR was opened, and so no gate ever got to judge.

The recorded diagnosis is uncomfortably clear: `(no terminal run)`.

### The measurement

Extracted by `pnpm --filter api medir:execucao`, never recorded by hand:

| | |
|---|---|
| window | 1m36s |
| sessions · events | 3 · 59 |
| **engine restart in between** | **no** |
| gate round-trips | none (no PR happened) |
| silent turns | none |
| user interventions | none |

| agent | calls | in | out | cost | model |
|---|---|---|---|---|---|
| dev-api | 8 | 5,671 | 205 | < US$ 0.01 | `openai/gpt-5-mini` |
| anamnese | 1 | 6,779 | 967 | < US$ 0.01 | deepseek-v4-flash |
| psicologo | 1 | 3,212 | 1,981 | < US$ 0.01 | deepseek-v4-flash |

The **zero restarts** criterion passed. And the cost is the least
interesting part: 205 output tokens across eight calls is an agent that
wrote nothing.

### What the product discovered on its own

The Psychologist ran on the heavy tier and produced three hypotheses. The
first and second are the correct diagnosis, with no one pointing it out:

> The dev-api didn't have (or didn't use) a working terminal environment
> […] throughout the whole session there isn't a single command-execution
> tool.call […] only `search_workspace`/`read_file`.

> The `search_workspace` tool is under-indexed or misconfigured for this
> repository: it found no code or manifest file whatsoever […] That
> misled the agent, which kept trying to figure out "where the project
> is".

This deserves its own record: the product's introspection **worked**. The
Psychologist read the event log of a failed execution and named the cause
more precisely than any assertion in the script.

## The findings, for 13c triage

The phase's discipline holds here as everywhere: **a new finding becomes an
item, never a fix**.

### X. The dev agent burns the iteration cap exploring an empty repository

Given a task in a freshly provisioned repository — which only has the
Gitflow template, no code — the agent spent all eight iterations on
`search_workspace`/`read_file` looking for "where the project is", and
never ran a single command or wrote a single file.

The symptom is `iteration limit reached` with origin `modelo`, which is
technically true and practically useless: the model didn't misjudge
anything, it never got to judge anything at all. The cause is the absence
of a signal that **there's nothing to find** — an empty repository is,
given the available tools, indistinguishable from a repository where the
search failed.

Worth noting this is the **first** scenario in the product where the dev
agent starts from absolute zero. Every test and every demo so far started
from a workspace with code.

### Y. `search_workspace` doesn't distinguish "empty" from "found nothing"

Direct consequence of the previous one, and probably the actionable piece:
the first five calls returned `no results`, which the agent read as "search
harder" instead of "there's nothing here". The Psychologist reached the
same conclusion on its own.

## The second execution: fixing Y did NOT close X

After closing finding Y, the same execution ran again — same story, same
repository, same model. **Only the tool's message changed between the
two.**

| | 1st execution | 2nd execution |
|---|---|---|
| dev-api calls | 8 | 8 |
| output tokens | 205 | 248 |
| outcome | `iteration limit reached` | `iteration limit reached` |
| PR | none | none |

The behavior changed observably — **one** search instead of five, followed
by `read_file` — and the outcome didn't. The new message reached the agent
and was the correct one for the case (`the workspace has 2 file(s), so the
search worked`), because the repository had the Gitflow template and wasn't
empty.

**The hypothesis recorded here was wrong.** The earlier text said *"the fix
is the message, not the cap"*. The evidence says otherwise: of the eight
iterations, seven were exploration. That leaves ONE to write the file,
commit, push, and open the PR — not even a perfect agent would close that
out.

`TOOL_LOOP_MAX_ITERATIONS` defaults to `8`
(`apps/engine/config/runtime.exs:100`). The number was born for a
conversational agent, and was never reassessed for a dev agent that needs
to explore a repository before acting.

The Psychologist, again, was more precise than the script's assertion:

> the workspace doesn't contain the project's code: no package.json, no
> src, no README

> it stayed in read-only/exploration mode only

### What this teaches about measuring

Recording the negative result is the point. If the second execution hadn't
been run, finding Y — which is real and covered by a test — would have been
easy to mistake for the solution to X. It was a correct fix that did
**not** produce the expected effect, and only the execution showed that.

## The third execution: the cap WAS the cause

With `TOOL_LOOP_MAX_ITERATIONS=25` instead of `8`, and nothing else
changed, the dev agent moved up a level:

| tool | 2nd execution (cap 8) | 3rd execution (cap 25) |
|---|---|---|
| `search_workspace` | 2 | 4 |
| `read_file` | 5 | 6 |
| **`write_file`** | **0** | **3** |
| **`terminal`** | **0** | **1** |
| outcome | iteration limit | `dev.awaiting_approval` |

It explored, **wrote three files**, and called `npm test --silent`. The
hypothesis recorded above was right: the cap of 8 — inherited from the
conversational agent — doesn't fit a dev agent that needs to understand a
repository before acting.

**And the reason it stopped changed completely.** There was no block: the
terminal action became a `proposed_action` with `require_approval` and the
agent entered `dev.awaiting_approval` — suspended, holding onto its worktree
and history, as [ADR 0052](../adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md)
designed. It stopped and waited, instead of burning iterations knocking on
the door.

## The fourth execution, and what it revealed about Phase F

Allowing `npm`, `pnpm`, `node`, and `npx` in the project's `allow` list
didn't unblock it: the agent ran **`ls -la`**, a verb not on the list, and
went back to pending.

This exposes a gap between what Phase F delivered and what was asked for.
The request was *"always allow commands as long as they're inside the
project folder"*. [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md)
delivered a **ceiling**: a command that touches a path outside the folder
is never auto-approvable, no matter how much the verb is in `allow`. The
ceiling protects the **path** — the **verb** is still governed by the
allowlist, which is a closed list by design.

Practical consequence: every new command the agent invents falls into
`require_approval`. The ladder still exists, it's just safer now.

**I don't treat this as a defect**, but as scope: ADR 0055 never promised to
promote verbs. But the gap between the request and the delivery is real,
and it becomes a triage item.

### A trap in the instrument itself

The first attempt to configure the policy had no effect at all, and the
cause is worth recording because it's recurring: the script ran **on the
host**, so `PROJECT_WORKSPACES_ROOT` fell back to the default
`/tmp/brabo-project-workspaces` and `permissions.json` was born on a
filesystem the engine can't see.

It's the same trap as the test-fixture repository in `/tmp` that the
[Phase 12 validation](./validacao-fase-12.md) already documents —
resurfacing via a different path, on the same day. The script's header now
requires, explicitly, execution from inside the container.

## The fifth execution: the chain reaches GitHub

Running **from inside the container** (the missing condition) and with the
terminal verbs allowed, the chain went all the way:

| action | policy | outcome |
|---|---|---|
| `terminal` ×2 | `auto_approve` | ✅ executed |
| `git_commit` | `auto_approve` | ✅ executed |
| `git_push` | `auto_approve` | ✅ executed |
| `pr_open` | `auto_approve` | ❌ **failed** |

**The agent's branch exists on GitHub**: `feature/task-d4b36a5b`, alongside
`dev`, `main`, and `qa`. Code written by a model, committed under the
`dev-api[bot]` identity, and pushed to a real remote repository.

`pr_open` failed with `Requires authentication`, and the cause is
**finding AA**: the api resolves the git token via `action.decidedBy`,
which is NULL when policy auto-approves. The push worked because the engine
does the pushing, and it injects the owner's credential (RN-076).

## The sixth execution: the PR opened on GitHub

With [RN-082](../business-rules.md#rn-082) in place, the chain closed all
the way to the PR:

> **PR #1 — "Public greeting route — Expose GET /greeting"**,
> from `feature/task-636ef1aa`, opened on `daneiel/test`.

Code written by a model, committed as `dev-api[bot]`, pushed and published
as a pull request on a real remote repository. **The gate opened**
(`pr.gate_changed`, `gateStatus: awaiting_qa`) and the QA area ran.

`qa-performance-seguranca` was **correctly skipped**
(`delegation.dispensed`, justification *"story has no NFR"*) — a skip with
justification, never silence, as ADR 0038 intended.

`qa-automacao` failed, and became **finding AB**: it called a compound
command whose last segment (`head`) wasn't in `allow`, the ToolLoop
suspended in `awaiting_approval`, and the QA Lead classified the suspension
as an *"unexpected outcome"* with origin `infra`. It's the defect ADR 0052
fixed for the dev agent and that never reached the gate agents.

## The seventh execution: widening the allowlist wasn't enough, and it was predictable

With 25 verbs allowed — explicit criterion: whatever READS or BUILDS, never
whatever reaches the network or destroys — the gate stalled again. And not
for lack of a verb:

```
ls -la && echo "---" && cat package.json 2>/dev/null; …
```

`ls`, `echo`, and `cat` were all in `allow`. What blocks it is
`2>/dev/null`, and it becomes **finding AC**: the parser treats `>` as a
separator, the redirect becomes a segment whose "verb" is `/dev/null`, and
that same token is also an absolute path outside the project.

**The prediction recorded before the execution was confirmed.** The
allowlist is a closed list and the model invents commands; widening the
list is a patch. The 7th execution proves this in a way that's hard to
dispute: 25 verbs, and it stalled on the SHAPE of the command, not the
verb.

## The eighth execution, and the argument it closes

With Y, AA, AB, and AC fixed, the dev agent made a single call:
`bash -lc npm test --silent`. Verb `bash`, off the list, `require_approval`.

**The refusal is correct** — allowing `bash` would nullify the entire
allowlist, including the built-in `deny` entries. But the last three
executions, together, say something none of them said alone:

| execution | stalled on | category |
|---|---|---|
| 6th | `head` | **verb** |
| 7th | `2>/dev/null` | **shape** |
| 8th | `bash -lc` | **invocation** |

Three distinct categories across three rounds. Widening the list solves the
first and touches neither of the other two. **The verb allowlist doesn't
converge** against an agent that freely chooses how to invoke what it wants
to run.

This isn't a defect in the allowlist: it does what it promises, and
refusing `bash` is proof the boundary holds. It's a limit of SCOPE — it
wasn't designed to enable autonomy, and it doesn't.

The 13b's practical conclusion is that, and it's worth more than the PR:
**the path to an LLM-judged gate doesn't run through loosening policy.** It
runs through making the agent wait for the decision instead of dying
(finding AB), which is what ADR 0052 already did for the dev agent.

## The ninth execution: the cheap fix that would have destroyed the guarantee

The ninth stalled on the same `bash` as the eighth, and the obvious fix was
one line away: put `bash` in `allow` and watch the pipeline turn green.

**It wasn't done, and that's this execution's contribution.** Allowing
`bash` doesn't widen the allowlist — it *nullifies* it, because every
blocked command now has a permitted way to be invoked, including the
built-in `deny` entries. The round would have passed and the guarantee
would have been gone, with nothing in the result indicating the trade-off.

What the ninth run fixed, then, was the diagnosis: the problem was never
*which* verb is on the list, it was that **the gate agent was dying**
when policy needed to ask. That's what led to
[ADR 0057](../adr/0057-o-gate-espera-a-aprovacao.md), extending to the gate
what [ADR 0052](../adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md)
had already done for the dev agent: faced with an action that requires a
decision, **suspend and wait** instead of classifying the suspension itself
as an infra failure (finding AB).

## The tenth execution: the whole chain, end to end

With ADR 0057 in place, the tenth closed everything the previous nine had
left open, **without a single engine restart**:

| step | outcome |
|---|---|
| remote adoption | `origin: adopted` against `daneiel/test` |
| repository plan | executed only after **your** decision |
| story promotion | manual, with the user as the actor |
| real dev agent | wrote code, committed as `<agent>[bot]` |
| push and **remote PR** | published on GitHub |
| gate | opened (`pr.gate_changed`) |
| QA area | delegated and **skipped with justification** |
| subagent | **suspended** for approval, and didn't die |
| your refusal | **resumed** the loop instead of ending it |
| verdict | `changes_requested`, judged by an LLM |

The last two rows are the ones that matter. The subagent stopping and
staying alive is ADR 0057 working; the **user's refusal resuming the
loop** is the point no previous execution had reached — the human decision
enters mid-way through the agent's work and it carries on from there,
instead of starting over or giving up.

And the verdict wasn't written by the script: it came from the model's own
judgment of a real PR. It's the exact difference this validation exists to
cover, relative to its
[deterministic sibling](./validacao-fase-12.md).

> **TODO(humano):** the dollar cost and call count for these two executions
> weren't extracted with `medir:execucao` at the time. If `token_usage` for
> those sessions still exists, it's worth filling in — every other
> measurement in this document comes from a script, and these two are the
> exception.

## The two-module executions: parallelism put to the test

The first ten runs used **one module**. That's enough to prove the chain,
and not enough to prove parallelism: with a single story, the Dev Lead
**refuses** to parallelize — "they'd collide on the same files" — and it's
right. The cap from [RN-083](../business-rules.md#rn-083) was never
actually consulted by real work.

Then came three rounds with `--modulos 2` (one story in `api`, one in
`web`). The first two are covered in
[finding AF](./achados-execucao-real.md) — the one that broke and the one
that proved the fix. What follows is the **third**, which exists purely to
measure.

The Dev Lead planned on its own:

> **2 agents across 2 modules** — *"each module has exactly one story, so
> one agent per module is the minimum that's justifiable without waste."*

And the round closed clean, measured by `medir:execucao`, not by hand:

| | |
|---|---|
| duration | **3m56s**, 182 events across 3 sessions |
| calls | **33** (dev-api 10, dev-web 9, arquiteto 7, qa-automacao 6, dev-lead 1) |
| cost | **< US$ 0.01** |
| engine restart | **no** |
| silent turns | **none** |
| gates | `qa` **approved**, `secops` **approved** |

**The cap enforced the decision.** With both agents already up, the next
request stalled in `aguardando_autorizacao` with the `parallelize` action
**pending in the database** — 2 active, cap 2. Nothing came up: if it had,
the authorization would have been theater.

### What the two modules broke, before this round

This round came out clean, but it's the **third** with two modules, and the
first two are the ones that paid the price. In the first, `dev-web`
claimed the task and died on `fatal: not a git repository` **before the
first turn** — zero tokens spent, task blocked. It's
[finding AF](./achados-execucao-real.md): the fast-path guard in
`Workspace.ensure!/4` checked whether `.git` existed, and `git init`
creates `.git` before the `fetch`; the second agent read that as "ready"
and skipped the lock.

The lock had existed since Phase 4 and was correct. What was wrong was the
criterion that decided whether it was worth acquiring — and **none of the
previous ten executions could have shown this**, because none had a second
agent. Once fixed, `dev-web` went from 0 to 16 calls in the following
round, and that's how this third one inherits the right to be a pure
measurement.

The instrument also learned something: the cap's assertion stated the
**number** (the 3rd request asks for authorization), which held for one
module and failed a run where the product did the right thing — with two
modules, activation alone fills the cap. It now states the **rule**
instead: while there's room, it goes up without asking; when there isn't,
it stops.

## What this validation still does NOT prove

Honesty about scope, as with its sibling:

- **Merge.** Still out by design ([RN-014](../business-rules.md#rn-014)),
  and will remain so: whoever presses the button on a protected branch is
  you.
- **The other five providers.** Only OpenRouter ran with a real credential;
  the rest remain without a smoke test for lack of a key, and what holds
  for one provider doesn't transfer to the others by argument.
- **Isolation.** The agent runs in the same container as this monorepo.
  [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md)
  states of itself that it's *policy*, not isolation — `..` fails, but a
  symlink pointing from inside to outside isn't detected.
- **Autonomy with no policy in the way.** The verb allowlist **doesn't
  converge** (findings Z and AD), and that's a scope limit, not a bug to
  fix.
- **The parallelism cap requested by the Dev Lead ITSELF.** With two
  modules it planned 2 agents and the cap is 2 — it fit. What overflowed
  the cap was the script, calling the use case directly. Seeing the
  *lead* ask for more than it can have would take 3+ modules, and that
  hasn't run yet.

The chain itself — from adoption to an LLM-judged gate verdict — **is
proven against a real network**. What remains open above isn't the chain:
it's the environment it runs in and the surface it covers.

## References

- [validacao-fase-12.md](./validacao-fase-12.md) — its deterministic sibling
- [achados-execucao-real.md](./achados-execucao-real.md) — the harvest
- [backlog.md](./backlog.md) — where X and Y go

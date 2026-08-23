# Input 0 — the session 0 (Creative) input text

Operational material for Phase 10b. This file has the **literal text** to
paste into the chat of the first session, and the refinement prompts for
the following session.

## Why the Creative agent, and not the PO

The original plan called for a direct handoff to the PO with the inputs.
That's not possible, and the reason matters because it also explains the
format of the text below.

The only path to the PO is the "I'm ready to produce" button, which only
appears with the Creative agent active — there's no manual handoff to an
agent of your choice. And even if there were, the PO alone wouldn't solve
it: a story only reaches `ready` with **at least one linked business
rule**, each `business_rule_id` is validated against a real
`artifact.business_rule` event, and the PO **doesn't have the tool** that
emits that artifact — only the Creative agent does.

Without a business rule in the log, no story becomes `ready`; without a
`ready` story, no dev picks up a task. That's why the text below insists so
much on rules: **they're what unblocks the whole execution**, not
documentation decoration.

Mechanical detail: there's no upload or attachment in the product. The
only way for the input content to reach the agent is for you to **paste
text** into the message box.

---

## The text to paste

Paste this in the first message of session 0. It's long on purpose — the
Creative agent has no access to the repository, so the context needs to
come along with it.

---

> Let's define the scope of a platform delivery. The product is **Brabo**,
> and this time the client is the team itself: we're going to add two
> **git providers** to the system.
>
> **What already exists.** Brabo has a single git provider contract with
> ten operations (`createRepo`, `getRepo`, `createBranch`, `protectBranch`,
> `commitFiles`, `listBranches`, `openPullRequest`, `mergePullRequest`,
> `getFileContent`, `commentOnPullRequest`), two capabilities declared per
> provider (`protectBranch` and `pullRequests`), seven normalized error
> classes, and a single contract suite with 19 scenarios that runs the
> same against any implementation. Today there are three providers: Local,
> GitHub, and GitLab.
>
> **What's missing.** Two new providers:
>
> 1. **Bitbucket Cloud** — a full platform, like GitHub and GitLab. The
>    challenge is translating its API into the contract: authentication,
>    repository identity, branch restriction, merge strategies, and the
>    error map by status. None of this should be guessed: every semantic
>    needs to be checked against the official documentation before
>    becoming code.
> 2. **Generic** — a plain git server, no platform API (Gitea, a bare repo
>    behind SSH, a Forgejo). Here the challenge is the opposite: declare
>    **honestly** what can't be done, and make sure the system degrades
>    instead of breaking. The Local provider is already the precedent for
>    this.
>
> **What I need from you in this session.** Emit a **business rule** for
> each statement below that should hold in the product. They're the
> contract the whole backlog will reference, so prefer several specific
> rules over one generic one:
>
> - a declared capability has to match the actual behavior: an
>   unsupported operation is explicitly rejected, never fails silently;
> - the new provider passes the existing contract suite without writing
>   its own scenario;
> - a platform semantic not verified against the official documentation
>   never becomes code — it becomes a declared limitation;
> - a vendor error is translated into the normalized taxonomy by status
>   and marker, never by free-text message matching;
> - the Gitflow bootstrap degrades (doesn't fail) when the provider
>   doesn't support a capability;
> - the interface needs to let the user choose the new providers, or else
>   they exist and nobody can reach them.
>
> Add whatever else you think is missing — you know the product.
>
> **One mandatory non-functional requirement:** at least part of this
> scope has a **performance** requirement. The contract suite runs against
> the five providers on every PR, and its runtime is on CI's critical
> path. Record this with that exact word, "performance", explicitly.
>
> **Granularity.** When this becomes backlog, the work will be sliced into
> **many modules with few tasks each**, not a few modules with a long
> queue. Keep that in mind when separating the subjects.
>
> **What NOT to decide now.** Don't choose Bitbucket's endpoint, payload
> format, or authentication strategy. That's an architecture decision,
> made later, against the official documentation. Here we define **what**
> and **why**, not **how**.

---

## Before clicking "I'm ready to produce"

Check, in the session thread, that the business rules were **emitted** —
not just mentioned in conversation. They appear as artifacts.

If you move on without them, the PO generates the whole backlog and every
story ends up in `draft`. You'll only find out during the execution
sessions, when no dev manages to pick up a task, having spent two sessions
just to get back to the start.

Expected count: **one rule per statement in the list**, plus whatever the
Creative agent adds. Less than that, keep talking.

---

## Refinement prompts for session 1 (PO)

The PO generates the whole backlog on its own as soon as you accept the
handoff — it doesn't wait for instruction. These prompts are for
**afterward**, looking at what it produced in the Backlog tab.

**If the backlog comes back with few modules and many tasks:**

> Rework the backlog to have more modules with fewer tasks each.
> Execution processes one task per module at a time, so a long queue
> inside one module doesn't speed anything up — separating subjects into
> distinct modules does.

**If no story has a performance NFR:**

> No story has a non-functional performance requirement. Add one
> explicitly, using the word "performance", to the story about the
> contract suite — its runtime is on CI's critical path.

**If any story ended up with no linked rule:**

> Story "X" doesn't reference any business rule. Link the rules that
> originated it — without that it can't be ready for execution.

**To review coverage:**

> List which business rules aren't yet covered by any story.

---

## What to note for this session's table row

- How many messages you needed to exchange with the Creative agent before
  the rules came out.
- Whether it emitted too many rules, too few, or out of scope.
- Whether the PO needed refinement, how many rounds — and what it got
  wrong. **Returning something to the PO has no record in the domain**: if
  you don't note it, it's gone.

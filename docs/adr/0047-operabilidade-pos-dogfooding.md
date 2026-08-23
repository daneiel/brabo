# 0047 — Post-dogfooding operability: closing Phase 12

## Context

Phase 10 was Brabo's first real execution building Brabo itself. It
produced seventeen findings, preserved in
[What the first dogfooding taught us](../explanation/primeiro-dogfooding.md).
Three of them were about **operability** — what separates an
experiment run by hand from a system you can live with:

| # | what it was | closed by |
|---|---|---|
| 1 | the product only knew how to CREATE a repository; pointing a project at an existing repo required inserting rows by hand into two tables | [ADR 0044](0044-adocao-de-repositorio-existente.md) |
| 10 | a dev agent processed ONE task and stopped; the phase ran in batches, with an engine restart between each | [ADR 0045](0045-reagendamento-por-evento-do-dev-agent.md) |
| 13 | `draft → ready` promotion was automatic on creation — the PO decided alone what entered the devs' queue | [ADR 0046](0046-promocao-de-story-com-autoridade-do-usuario.md) |

The three already had their own test when this ADR was written. What
was missing was something else: **proof that they died together.** A
system can have all three fixes and still not be operable, if they
only work in isolation — that's exactly what Phase 10 revealed about
features that passed their own phase's tests and didn't survive first
contact with real use.

## Decision

**The validation is an executable script, not a prose checklist.**
`apps/api/scripts/validacao-fase-12.ts`, in the mold of
`demo-noop-execution.ts`: it brings up the Nest context, calls the real
use cases and **exits with a non-zero code when a criterion doesn't
close.** The alternative — a checklist for someone to follow by
clicking — would produce a validation that silently rots, the same way
Phase 10's observation table stayed blank.

**The evidence is extracted from the database, not transcribed.** The
script ends up printing a Markdown table of `session_events.id` (ULID)
from the run itself, ready to paste into the document. And it refuses
to succeed if some step it claimed to have exercised left no evidence
in the event log — without that check, a wrong query would produce a
short table and the validation would pass anyway, which is the classic
failure mode of a generated report.

**The validation runs locally and without an LLM, and that's stated in
the document's first paragraph.** Not in a footnote. Two concrete
reasons, both verified:

- the **Phase 10 fork was never named** — `dogfooding-mission.md:135`
  is still a `TODO(humano)`, so there's no target to readopt. The
  adoption path is the same across both providers; what changes is the
  network, covered by the `adopt-repository.smoke.spec.ts` smoke, gated
  by a real credential;
- **judging gates with a local model isn't deterministic**, and
  [ADR 0020](0020-destravar-gates-qa-secops.md) already said so. The
  verdict comes in through `RecordGateVerdictUseCase`, which is the
  REAL funnel where `task.gate_resolved` is born. What 12b needs to
  prove is the chain verdict → outbox → wake → claim, not whether a 7B
  model can read a suite.

A validation that pretended to cover more than it does would be worse
than none at all: it would declare closed what was never exercised.

**`NoopDevAgentServer` entered 12b's state machine — and that was a
finding from preparing the validation itself.** Phase 12b only changed
the real `DevAgentServer`. The Noop kept fixing `status: :working`,
without subscribing to `Engine.Dev.Wake`, processing one task and
stopping: **finding #10 was still alive inside the only vehicle able
to validate the phase without spending tokens.** An end-to-end run with
it would have failed the "zero restarts" criterion due to the
instrument's defect, not the product's.

The fix wasn't to copy the state machine into the Noop, but to move it
into `Engine.Dev.AgentIo` — the module that already existed precisely
because "a Noop that reimplemented these parts would validate a copy,
not the infrastructure." The argument held for worktree and commit
identity since Phase 4a; it started holding for rescheduling too. What
differs between the two agents is `run_task`, and only that, so it
enters as a function rather than a behaviour.

**Phase 10's harvest was written now, with the gaps declared.**
`CLAUDE.md:77` referenced `docs/explanation/primeiro-dogfooding.md`
since that phase ended, and the file never existed. It was written from
what's reconstructible — the seventeen findings with file and line, the
narrative of the batches, the manual seed — and **everything that would
depend on a live count went in as `not measured`**, never as an
estimate. It's the harvest's own rule
(`colheita-esqueleto.md:22-24`): no number goes in without a query that
produces it.

In the contrast table, "1 restart per task delivered" appears as a
**property derived from the code at that time**, not as an observed
average — the distinction is written right in the cell.

## Consequences

Phase 12 closes with the three P1 operability findings resolved and
proven in a single run. The other fourteen remain listed and open in
the harvest; none were fixed along the way, by the same principle the
Phase 10 mission established: fixing a finding outside the phase that
addresses it hides the evidence of why it existed.

Three things this phase revealed that go in as **backlog, not a fix**:

1. **Instrumenting the main metric precedes the experiment.** Finding
   #17 (P1, open) says `proposed_action.approved`/`.denied` only go to
   the outbox, never to `session_events`. Much of Phase 10's harvest is
   missing its quantitative half because of this. A next dogfooding
   that doesn't resolve #17 first will lose the same numbers again.
2. **There's no story-editing tool.** 12c's refusal loop closes by
   recreation (`create_story`), and the refused story stays in `draft`
   with the reason recorded. It's auditable, but leaves residue in the
   backlog. It's recorded in
   [ADR 0046](0046-promocao-de-story-com-autoridade-do-usuario.md).
3. **The docmap's coverage had a gap exactly where this phase touched
   the most.** No rule watched `apps/engine/lib/engine/dev/**` or
   `apps/engine/lib/engine/agents/**`: the dev agents' state machine
   and the conversational agents could change with no doc being
   demanded. This ADR fixes the gap along the way, because leaving it
   open would make the documentation mechanism itself lie about the
   phase that exercised it.

What Phase 12 did **not** change, and it's worth stating explicitly
because it's the product's axis: the approval pipeline is exactly as
it was, and merging into a protected branch is still the user's manual
decision. Step 6 of the validation proposes a merge with `auto_approve`
autonomy and `permissions.json` allowing it, and requires `pending` as
the result. Rescheduling the agent isn't granting autonomy — it's just
the agent not dying between tasks.

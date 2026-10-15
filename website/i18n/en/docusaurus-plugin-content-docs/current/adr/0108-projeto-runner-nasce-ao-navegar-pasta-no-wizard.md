# ADR 0108 — In `runner` mode, the project is born when clicking "Browse folder...", not only at confirmation

- **Status:** Accepted
- **Date:** 2026-08-22
- **Context:** closes the gap that [ADR 0107](0107-navegacao-de-pasta-local-via-o-runner.md) had already declared, in its own Consequences section
- **Extends (without editing):** [ADR 0104](0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md), [ADR 0107](0107-navegacao-de-pasta-local-via-o-runner.md)

## Context

ADR 0107 delivered local folder navigation via the Runner, but it
explicitly declared, in its Consequences section, an accepted architectural
gap: the Phoenix channel ticket (`terminal:<projectId>`) is issued PER
PROJECT, and on the creation screen (`NewProjectWizard.tsx`) the project is
only born at the confirmation step (`handleConfirm`) — so the "Browse
folder..." button on the "Where the code will live" step had nothing to
anchor the ticket to, and always fell into the declared state ("available
after the project exists"). ADR 0107 itself listed the two possible ways
out: "(a) a ticket/channel mode for the Runner that isn't anchored to a
project, or (b) the project being created earlier in the wizard flow
(before confirmation)" — and deferred the choice to "a future delivery the
product owner prioritizes."

This is that delivery, tested live by the product owner while creating a
real project: unable to navigate folders on the creation screen, he was
forced to type the path from memory — exactly the friction ADR 0107 existed
to eliminate, except the gap was left right where navigation would make the
biggest difference.

Option (b) was the one chosen, not (a): a ticket mode without a project
would change the channel's contract (`Engine.Runners.Registry`, today keyed
by `projectId`) for the entire Runner surface — exec, PTY, and
navigation — just to solve a use case that already has a cheaper way out:
ADR 0104 itself already establishes that `createProject` in `runner` mode
is a LIGHT operation (just the project row — no remote repository, no
Gitflow bootstrap) and that `workspacePath` in that mode is **provisional
by design**: the real runner, on connecting, OVERWRITES the path with what
it reports from the host (RN-423). Creating the project earlier doesn't
introduce a second source of truth about the path — the runner remains the
only one.

## Decision

**Scope: only `execution_mode = 'runner'`.** The `mounted` mode continues
with `projectId: null` at the workspace step, untouched — there the disk
validation runs INSIDE the api container, at creation time
(RN-422/RN-170), and creating early with a path not yet typed would return
the refusal message (which teaches how to mount the folder) at a moment
when the user hasn't even started thinking about the path yet. `runner`
doesn't have this problem: creation in that mode only validates the
LEXICAL part of the path (ADR 0104, item 2), never touches disk.

1. **`NewProjectWizard.tsx` creates the project when "Browse folder..." is
   clicked**, no longer only at confirmation — but only when the mode is
   `runner`. If the path field is still empty, it uses a lexically valid
   and clearly provisional placeholder (`/workspace-a-confirmar`) instead of
   blocking the click — the real runner overwrites this value when it
   connects (RN-423), so the placeholder never ends up being the truth
   about the path, it only unblocks navigation.
2. **Reuse by identity SNAPSHOT, not by "I already created some project
   before."** The snapshot stores only `name`/`externalId`/`adotando` — the
   fields that decide WHICH project is being created — never
   `caminhoLocal`, because the whole purpose of navigating is precisely to
   REFINE the path after a project already exists: including it in the
   snapshot would invalidate the reuse on every click. As long as the
   identity doesn't change, a second click on "Browse folder..." and the
   final confirmation REUSE the same project; changing the name (or going
   back and switching the repository being adopted) invalidates the
   snapshot and the next navigation creates another one.
3. **`handleConfirm` reuses the project created while browsing, when the
   snapshot still matches** — it never calls `createProject` again for the
   same "Provision"/"View the plan" click. Two rows for the same project
   would be a bug, not a feature.

## Consequences

- **An orphaned "not provisioned" project, if the wizard is closed without
  finishing.** Clicking "Browse folder..." and closing the wizard without
  reaching "Provision" leaves a row created, with no repository and no
  bootstrap. This is the accepted side effect, and the reason for accepting
  it is that **it isn't a NEW state**: any interrupted creation today — the
  tab closed between confirmation and the provisioning screen loading, for
  example — already produces the same result. The product doesn't have a
  mechanism today for cleaning up orphaned projects (not even for this
  pre-existing case), and this ADR doesn't create one — it just stops being
  a rarer case, because creation now happens at an earlier step in the
  flow. If a cleanup mechanism comes to exist, it resolves both cases with
  the same rule.
- **`UpdateProjectDto` remains without `executionMode`/`workspacePath`.**
  ADR 0104's finding (that converting between modes for an EXISTING project
  isn't a trivial PATCH) doesn't change here — this delivery doesn't
  introduce any editing, it only moves up the moment of the FIRST write.
- **`FolderBrowserModal` gains a second reason to receive a non-null
  `projectId` before confirmation**, but the component's contract doesn't
  change: it still doesn't know WHETHER the project it received is final or
  provisional — the wizard decides that, in the snapshot.
- **This ADR does NOT reopen ADR 0107's decision (a)** (ticket without a
  project): it continues not to exist, and continues not being necessary —
  the Runner's exec and PTY surface keeps requiring a real project, as it
  always did.

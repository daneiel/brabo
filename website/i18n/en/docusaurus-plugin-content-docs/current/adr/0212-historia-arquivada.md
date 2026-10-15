---
traducao_de: 122ec00d6ff5390cc968dd5404c70d8661e896e4
---

# ADR 0212 — The archived story: a column, not a state of the machine

## Status

**Accepted.** 2026-10-03 (AT-406; owner decision on 03/10: "PO and user" — the
PO and the Backlog tab edit and archive a `draft` story with no task in
execution). Rule in [RN-727](../business-rules.md#rn-727).

## Context

In the 03/10 TP-01 the PO created two duplicate stories and had no way to remove
them: its tools were `create_epic`, `create_story`, `create_task` and
`complete_story`, and the Backlog tab was read-only. The duplicates got tasks,
entered the Dev Lead's plan and confused the Arquiteto. The decision was to allow
ARCHIVING (and fixing the title), without deleting anything from the log.

Three ways of representing "archived" were weighed:

1. **A new `story_status` value.** Rejected: `status = 'ready'` is the
   claimability gate (`claimNext`), and the state machine
   (`story-state-machine.ts`) is about the story's progress. Archiving only
   happens from `draft`, has no way back in this delivery and is not a progress
   step — putting it in the enum would force every transition to know about it.
2. **Deleting the row.** Rejected by the owner's decision and by the product's
   convention: what was done stays, and the tasks and events citing the story
   would keep pointing to something that vanished.
3. **An `archived_at` (and `archived_reason`) column in `stories`.** Chosen.

## Decision

- `stories` gains `archived_at timestamptz NULL` and `archived_reason text NULL`
  (migration `0069`), in the backlog aggregate's file (ADR 0121). `NULL` is the
  story in play.
- Every read that DECIDES filters `archived_at IS NULL`: the backlog and coverage
  (`findByProject`), the promotion queue (`listProposedReady`), the Dev Lead's
  plan (`findInProjectByIds`) and the claim and claimable count (`claimNext`,
  `countClaimableByModule`). TASKS leave play through the story — no new column
  in `tasks`. `findById` still finds the archived one, for the named refusal and
  auditing.
- Archiving turns off `proposed_ready` in the SAME write (the story never stays
  "awaiting you" after being archived).
- The fact goes to the log in NEW, immutable events: `backlog.story_archived`
  (`storyId`, `title`, `reason`, `taskIds`) and `backlog.story_updated`
  (`storyId`, `previousTitle`, `title`, `descriptionChanged`). The `backlog.`
  prefix follows the aggregate's existing events (`backlog.story_created`,
  `backlog.story_promotion_returned`).
- A single rule (`recusaDeCorrecaoDeHistoria`) for both doors — the PO's tool and
  the user's route —, with a named 409.

## Consequences

- Unarchiving does not exist in this delivery: the column allows it, but it is a
  separate product decision, not taken here.
- The archived story disappears from `listar_backlog` (the PO does not see it so
  as not to complete it again); whoever needs to know about it reads the event in
  the session log.
- The user's minimum role is `developer`, the same as promoting and returning
  (RN-048) — no new role.

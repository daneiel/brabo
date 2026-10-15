---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0184 — Reopening a session: the owner's three decisions, and `developer` reopens

## Status

**Accepted.** 2026-09-30 (AT-337, round 32). On top of
[ADR 0183](0183-reabrir-sessao-encerrada.md), which is NOT edited: it marked
three decisions as a **provisional, conservative default, awaiting the owner**,
and this ADR records the owner's answer to all three.

## Context

ADR 0183 opened an exit from the session's terminal states — reopening, through
its own route (`POST projects/:projectId/sessions/:sessionId/reopen`) — and left
three choices open, declared as provisional:

1. the minimum role, set at `maintainer`, one step above the generic transition
   (`developer`) that closes the session;
2. the absence of a deadline — every closed session reopenable forever;
3. the refusal, with 409 `sessao_com_execucao`, of a session carrying
   `execution.activated`, so that `findActiveExecutionSession` (RN-139) is not
   diverted to an old execution session.

The owner decided all three on 2026-09-30.

## Decision

1. **Minimum role `developer`.** The same role that closes via the generic
   transition: whoever can deem the session finished can bring it back. 0183's
   argument for going one step up (turning token spending back on) does not hold
   given that the same `developer` can already open a new session and converse
   in it, spending the same tokens. `viewer` stays refused (403). The change is
   the one 0183 foresaw: the route's `@RequireRole` and the Session screen's
   `roleAtLeast`.
2. **No deadline — CONFIRMED.** No comparison with `closed_at`.
3. **A session with `execution.activated` stays refused — CONFIRMED.** 409
   `sessao_com_execucao`; the path to execute again remains opening a new
   session and activating execution in it.

Nothing else in 0183 changes: the dedicated transition (`canReopen`), the
`session.reopened` event, the engine called before the transaction and the
`SessionLifecycleWorker` that ignores the already-undone closing.

## Consequences

- The three decisions stop being provisional.
  [RN-650](../business-rules.md#rn-650) now says `developer`, and
  [RN-649](../business-rules.md#rn-649) cites this ADR in the two confirmed
  decisions.
- `docs/security-surface.md` lists the route as `role:developer`; the
  `route-surface.spec.ts` test compares the table with the real annotation.
- The screen changes the text reason from "requires maintainer" to "requires
  developer" (key `ativacao.reabrirExigeDeveloper`, in both languages).
- Still open, and not decided here: the Psicólogo's second automatic analysis
  after reopening (Consequences of 0183).

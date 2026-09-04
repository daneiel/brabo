# ADR 0124 — Turn-channel state cluster extracted into `useTurnoDoAgente`

- **Status:** accepted
- **Date:** 2026-08-30
- **References (without editing):** [ADR 0122](0122-sessionpage-dividido-em-cinco-prs.md)
  (this ADR is the "own, later, separately-numbered ADR" that 0122's
  Consequences section named and deferred); the mechanical dedup PR that
  this extraction builds on (`refactor(web): termina a deduplicação do
  arme de turno no SessionPage.tsx`, merged before this ADR, not itself
  ADR'd — referenced here as the prerequisite, the same pattern 0122 used
  referencing [ADR 0121](0121-schema-dividido-por-agregado-de-dominio.md)
  without editing it).

## Context

ADR 0122 left the turn-channel state cluster out of its five-PR mechanical
decomposition of `SessionPage.tsx`, on purpose, calling it "interleaved
control flow, [...] a design decision about where turn-lifecycle state
should live, not a mechanical relocation" and naming `turnoViaCanal`,
`statusAgent`, `pensandoVisivel`, `atividadeDoTurno` as "read AND written
by four different turn-entry handlers (`handleSend`, `handleReadiness`,
`handleArchitectureReadiness`, `handleAcceptHandoff`)". This is that
deferred work.

Re-reading the file line by line to scope it found ADR 0122's own count
undercounted: it names four turn-entry handlers, but there are **seven**
real write-entry-points into this cluster. The three it named plus
`handleAcceptHandoff` are four; the other three are the channel effect
itself (`connectSessionHeartbeat`'s `onAgentDelta`/`onToolCall`/
`onAgentDone`/`onAgentStatus`/`onEvent` handlers — a single `useEffect`,
but a write surface as real as any handler), the `StructuredQuestionCard`
callback (`onTurnoIniciado`/`onTurnoTerminado`, wired to
`AnswerStructuredQuestionUseCase`), and `handleReturnStory` (RN-174,
`ReturnStoryUseCase` → `reviseStory` in `po_server`) — which ADR 0122
never mentioned at all, even though it already called
`iniciarTurnoDoAgente`/`finalizarTurnoDoAgente` correctly at the time.

The mechanical dedup PR that precedes this one (already merged) closed a
second gap found in the same pass: `iniciarTurnoDoAgente`/
`finalizarTurnoDoAgente` already existed as a complete `useCallback` pair,
but only two of the seven entry points called them — `handleSend`,
`handleReadiness`, and `handleArchitectureReadiness` each duplicated the
same five-line arm inline instead of calling the existing function. That
PR replaced the three duplicates with calls to `iniciarTurnoDoAgente`
(which gained the `{ comStatus }` parameter there — see Decision below)
and introduced `cancelarTurnoOtimista`. This ADR's PR is the second half:
moving the now-deduplicated state, the channel effect, and the three
lifecycle functions out of `SessionPage.tsx` into a hook.

## Decision

New module `apps/web/src/lib/session-turno.ts`, exporting one hook:

```ts
function useTurnoDoAgente(
  projectId: string,
  sessionId: string,
  sessionStatus: string | undefined,
  queryClient: QueryClient,
) {
  return {
    // reads
    streaming, streamingText, streamingAgent, turnoViaCanal, statusAgent,
    pensandoVisivel, atividadeDoTurno, optimisticUser,
    // imperative API
    iniciarTurnoDoAgente, finalizarTurnoDoAgente, cancelarTurnoOtimista,
    // raw setters/ref — two call sites, and only two
    setStreaming, setStreamingText, setOptimisticUser,
    setTurnoViaCanal, turnoAgentRef,
  };
}
```

An object, not a tuple — 13 fields, positional destructuring would be
unreadable and fragile to reordering. `SessionPage.tsx` calls it once,
right after the `session` query it depends on for `sessionStatus`, and
destructures every field under the same name it already had — every JSX
read site, every handler body, and `useSessionEvents`'s `refetchInterval`
gate (which reads `streaming`) keep working unchanged.

There is no precedent in this codebase for a hook that owns both state
and an imperative API before this one: `useAutoCollapseSidebar`
(`lib/sidebar-state.ts`) returns `void` — it is only a registered effect.
`useSessionReadiness` (`lib/session-readiness.ts`, ADR 0122 PR 5) is a
pure function of two parameters with no `useState`/effect of its own.
Neither is a template this hook follows; said explicitly here rather than
implied as "the existing pattern."

**Why the channel effect moves wholesale.** The `useEffect` that calls
`connectSessionHeartbeat` is the seventh write-entry-point named above,
and it was verified line by line to be 100% turn-lifecycle machinery —
even `onEvent`'s refetch-anticipation reads `streamingRef` (a piece of
this same cluster) to decide whether to fire. Nothing in the effect
reaches outside the cluster, so it moves with its full dependency array,
unchanged.

**Why `cancelarTurnoOtimista` covers only two of the five ways this file
undoes an arm.** Five different reset-on-failure blocks exist across the
handlers, in three different shapes, not one shape repeated five times:

1. `handleSend`'s pre-check (`startAgent('criativo')` failing before an
   agent is even known): 2 fields (`streaming`, `optimisticUser`) — never
   armed the rest. Stays as two raw `setState` calls in `SessionPage.tsx`,
   using the `setStreaming`/`setOptimisticUser` the hook exposes for
   exactly this.
2. `handleSend`'s agent branch: the 4 fields of the full arm plus
   `optimisticUser`, which the arm itself never touches (it is set
   unconditionally at the top of `handleSend`, before the agent is even
   resolved). Becomes `cancelarTurnoOtimista(); setOptimisticUser(null);`
   — two calls, not one bigger function, because `optimisticUser`'s
   lifecycle belongs to `handleSend`, not to the arm/disarm pair.
3. `handleReadiness`: 4 fields (`streaming`, `turnoAgentRef`,
   `statusAgent`, `turnoViaCanal`) — exactly what `cancelarTurnoOtimista`
   covers.
4. `handleArchitectureReadiness`: a block IDENTICAL to `handleReadiness`'s
   — same coverage.
5. `handleAcceptHandoff`: 2 fields (`turnoAgentRef`, `turnoViaCanal`) —
   it never arms `streaming`/`statusAgent` in the first place, because its
   kickoff is an asynchronous `GenServer.cast` in the engine (achado B):
   the handler doesn't yet know, at click time, that a real turn is about
   to start, only who will answer. Calling `cancelarTurnoOtimista` here
   would silently couple a handler that never touched `streaming`/
   `statusAgent` to a function whose name promises to undo both — the
   same trap ADR 0122 already flagged for the cluster as a whole. This
   block stays inline in `handleAcceptHandoff`, exactly as it always was,
   using the `setTurnoViaCanal`/`turnoAgentRef` the hook exposes for this
   one call site.

`cancelarTurnoOtimista` is built to cover exactly #3 and #4 — the two
identical blocks — and nothing else. A sixth function to also cover #5
was considered and rejected: it would exist for one caller, duplicating
what two raw operations already say directly.

**Why two PRs, not one.** The mechanical dedup (three duplicated arms
replaced by calls to the pre-existing `iniciarTurnoDoAgente`, the two
identical failure blocks replaced by the new `cancelarTurnoOtimista`) and
the module extraction (state, channel effect, and the three functions
relocated to `lib/session-turno.ts`) are different kinds of risk. The
first is "is this call-for-call the same as the five lines it replaces,"
reviewable in the diff in minutes. The second is "do closures over
`queryClient`/`projectId`/`sessionId` and effect dependency arrays survive
a change of module scope," which needed to be checked on its own, without
competing for attention with "is this version of the arm subtly
different from that one." The first PR merged before the second started.

## Consequences

- `SessionPage.tsx` goes from 2 681 to 2 479 lines (`wc -l`) — the state
  declarations, the JSDoc-documented `iniciarTurnoDoAgente`/
  `finalizarTurnoDoAgente`/`cancelarTurnoOtimista`, the channel effect,
  and the `pensandoVisivel` arm/disarm effect all move to
  `lib/session-turno.ts` (341 lines, comments included — the same density
  as what it replaces, since the reasoning that justified each field and
  each branch moved with the code, not just the code).
- **This closes the turn-channel cluster item that ADR 0122's "Explicitly
  out of scope" section deferred**, specifically. `ProjectSettingsTab.tsx`
  — the other file named in the same technical-debt row as
  `SessionPage.tsx` — is unaffected by this ADR and remains a fully
  separate, still-open scope decision with no date; nothing here changes
  its status.
- The nine tests named as regression coverage for this cluster
  (`SessionPage.pista-e-status`, `.cancelar-turno`, `.turno-preso`,
  `.readiness-turno-preso`, `.handoff-devlead-e-colapso`,
  `.ideacao-automatica`, `.arquiteto-modelo-icone`,
  `.agente-mais-recente`, `.promocao-inline-e-volta` — the last one is the
  only file covering `handleReturnStory`/RN-174, which ADR 0122 never
  named) all pass unedited, alongside the full `SessionPage.*.test.tsx`
  suite, proving the move changed no observable behavior.
- The five-shapes finding above (Decision, "why `cancelarTurnoOtimista`
  covers only two of five") is now written down once, here, instead of
  living only in code comments — a future change to any of the five reset
  blocks has this ADR as the reference for why they are not the same
  function today.

## Discarded alternatives

- **A sixth function covering `handleAcceptHandoff`'s 2-field reset
  (block #5 above)**, so every handler would call a named function
  instead of two raw operations. Rejected: it would have exactly one
  caller, and the two lines it would wrap (`turnoAgentRef.current = null;
  setTurnoViaCanal(false);`) already say what they do without an
  intermediary name to look up.
- **Widening `cancelarTurnoOtimista` to also reset `atividadeDoTurno`**,
  on the theory that a failed turn should always clear the activity strip.
  Rejected: none of the three `await`-dependent failure paths
  (`handleReadiness`, `handleArchitectureReadiness`, `handleSend`'s agent
  branch) reset `atividadeDoTurno` today, even though the call can take up
  to 120s and channel deltas/tool-calls may have already fed the reducer
  in the meantime. That is an accepted gap in the code as it stood before
  this ADR, not something this extraction was asked to fix — adding a new
  `dispatchAtividade({ tipo: 'reset' })` here would be a silent behavior
  change riding along on a move that is supposed to have none.
- **One PR instead of two.** Rejected for the reason under Decision above:
  the dedup and the module move are different kinds of risk, and
  conflating them would have made a regression in either harder to
  isolate in review.

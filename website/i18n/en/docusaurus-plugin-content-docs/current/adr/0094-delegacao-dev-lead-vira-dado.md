# ADR 0094 — The Dev Lead → dev delegation becomes data, with `parecerArtifactId` redefined

- **Status:** Accepted
- **Date:** 2026-08-17
- **Context:** fluxo.yml × code audit (Wave 2, item B1,
  `docs/explanation/auditoria-fluxo-vs-codigo.md`, section D)
- **Revokes cut from:** [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)
  (item 5, "Internal delegation", declared as a direct consequence of the
  Dev Lead existing but explicitly **not implemented** at the time — see
  also CLAUDE.md, "What NOT to do" / Phase 14d)
- **Extends:** [ADR 0038](0038-hierarquia-de-agentes.md) (owner of the
  original design of `delegations`/`RecordDelegationUseCase` — table,
  `area` as TEXT, and the `completed`/`failed`/`dispensed` pattern that QA
  and Infra already use)

## Context

ADR 0053 (Phase 14d) created the Dev Lead and, in the same document,
already anticipated that activating a `dev-<modulo>` would be an "area
delegation, private, in the `delegations` table with `area = "dev"` — the
same path as QA and Infra". But it declared that **out of scope for that
delivery**, along with the "Activate execution" button changing owner —
both listed in CLAUDE.md as reversible cuts, "execution continues on the
current path".

The read-only fluxo.yml × code audit (finding B1) confirmed the gap was
still open: `dev_lead_server.ex` only has two tools
(`propose_execution_plan`, `assess_implementability`) and NEVER writes to
`delegations` — only QA (`qa_lead_server.ex`) and Infra
(`infra_lead_server.ex`) write to it, and both do so from the ENGINE side,
via `EngineApiClient.record_delegation/1` →
`POST /internal/sessions/:sessionId/delegations` →
`RecordDelegationUseCase`.

### Why the Dev Lead can't simply mirror QA/Infra

QA and Infra record the delegation from the ENGINE side because that's
where the subagent runs and produces a **verdict** — a single-round verdict
(`record_gate_verdict`, `open_infra_pr`) that justifies
`parecerArtifactId` pointing to the artifact that verdict produced.

The Dev Lead has no such pattern. Activating a `dev-<modulo>` happens on
the **API** side, in `AcceptParallelizationUseCase.execute`
(`apps/api/src/application/use-cases/execution/accept-parallelization.use-case.ts`),
called both by the direct path (below the cap,
`RequestParallelizationUseCase`) and by the approved path (above the cap,
`ExecuteParallelizationUseCase` after the user approves the `parallelize`
type `proposed_action`). There is no "verdict" at all: the dev agent
doesn't produce a judgment when it comes up, it just starts working.

## Decision

**The write happens inside `AcceptParallelizationUseCase.execute`, on the
API side — without touching Elixir/engine.** It covers both paths (direct
and approved) for free, because both already converge on that method.

### `status: 'completed'` is redefined for this area

For QA and Infra, `completed` means "the subagent finished and issued a
verdict". For dev, `completed` comes to mean **"the delegation was
FULFILLED"** — the `dev-<modulo>` agent actually came up. It's a CONSCIOUS
redefinition of the same field for a third area, without changing the
schema: the type (`DelegationStatus`) and the database constraint
(`delegations_completed_tem_parecer`) still require a non-null
`parecerArtifactId` for `completed`, but what that id JUSTIFIES changes
per area.

`parecerArtifactId` points to the `id` of the most recent, current
`artifact.module_map` event for the project — the same artifact that
`QaEstrategiaContext.fetch/3` and `AppSecContextBuilder` already fetch on
the engine side, obtained here via
`SessionEventRepository.listByTypeForProject(projectId,
'artifact.module_map')` (a generic method that already existed, used by
`computeCoverage` for `artifact.business_rule` — no new query was
written, just one more call to it), taking the LAST item (the function
sorts by `createdAt` ASC). It's the artifact that **justified the decision
to delegate**: the Dev Lead decides how many agents per module by looking
at the `module_map`, and that read — not a subagent's verdict — is what
gives the delegation its meaning.

### Without a module_map: never a fake id

If there is no `artifact.module_map` at all for the project — this
shouldn't happen, since the Architect always delivers a module_map before
the Dev Lead operates (a mandatory input of his in `docs/fluxo.yml`) —,
the delegation is NOT recorded with a made-up id.
`AcceptParallelizationUseCase` logs the unexpected state with
`Logger.error` and returns, by the same lesson as
[RN-059](../business-rules/custo.md#rn-059): never fail silently, but also never
fake a justification that doesn't exist.

### A failure to record doesn't roll back the activation

The dev agent's activation is already a success by the time the attempt to
write the delegation happens — it comes AFTER
`engineClient.acceptParallelization` and the
`execution.parallelization_accepted` event. If
`RecordDelegationUseCase.execute` throws (e.g., constraint violation,
database down), the error is caught and logged, never propagated:
`AcceptParallelizationUseCase.execute` always resolves `{ ok: true }` once
it reaches that point. Only the delegation's WRITE can fail/skip — not the
activation itself.

### `area`/`lead_agent`/`subagent`

`area: 'dev'`, `lead_agent: 'dev-lead'` (string literal, same pattern as
`'qa-lead'`/`'infra-lead'`), `subagent`: the exact id of the freshly
activated `dev-<modulo>` agent — `extraDevAgentId(module)`, the SAME
function `AcceptParallelizationUseCase` already uses to name the agent
(includes the `-2` extra-instance suffix, the same pattern that
RN-195..201 documents in another context). No new format was invented.

`taskId` stays `null` (default of `RecordDelegationUseCase`) — the same
choice as Infra: the delegation is about the SESSION/module, not about a
specific backlog task.

## Consequences

**For**

- Closes the divergence between `docs/fluxo.yml` (which already declared
  `delegacao`/`dev` as a real deliverable since ADR 0053) and the code —
  the same class of correction as ADR 0086.
- `delegations` now has all THREE areas (`qa`, `infra`, `dev`) writing
  through the same mechanism, with the team panel and any future "who did
  the lead delegate to" reading covering dev without a special case.
- Zero new schema, zero migration: the table and constraint already
  supported the case, only the dev-side caller was missing.

**Against**

- `parecerArtifactId` stops meaning just one thing across `delegations`:
  whoever reads the table without area context might assume "it's always a
  subagent's verdict", which is false for `area = 'dev'`. Mitigated by
  this ADR and the new RN standing as the single reference for the
  redefinition — no screen today interprets `parecerArtifactId` in a way
  that depends on that distinction (it's an opaque field, shown as an id).
- The delegation write can SILENTLY fail to happen (missing module_map, or
  `RecordDelegationUseCase` failing) without the user seeing it on
  screen — only in the process log. Accepted for the same reason as the
  original ADR 0053 item 5: the agent's activation is what matters for
  execution to continue, and blocking an already-consumed success because
  of an auxiliary write would be worse.

## Alternatives considered

**Write the delegation from the ENGINE side, in `dev_lead_server.ex`,
mirroring QA/Infra to the letter.** Rejected: it would require a new
engine→api HTTP call just for this, when activation already happens
entirely on the API side. It would also force inventing a "verdict" the
Dev Lead doesn't produce — the parallelism plan (ADR 0086) is already a
separate `proposed_action`, and reusing that event as the delegation's
verdict would mix two distinct outcomes (parallelism authorization vs.
activation fulfillment).

**`status: 'completed'` only after the dev agent produces something (e.g.,
opening the first PR).** Rejected: there's no natural trigger or single
event that marks this, and delaying the write until then would leave
delegations "pending" indefinitely — the schema has no `status: 'pending'`
on purpose (note in `record-delegation.use-case.ts`: "the lead resolves
each delegation synchronously, in a single round").

**Block the activation if the delegation can't be written.** Rejected: it
would invert the wrong priority — activating the dev agent is the real
value delivered to the user; the delegation is an audit trail over a fact
that already happened. Failing the activation because of an audit write
would be worse than the gap this ADR closes.

## References

- `apps/api/src/application/use-cases/execution/accept-parallelization.use-case.ts`
  (`recordDevDelegation`)
- `apps/api/src/application/use-cases/execution/record-delegation.use-case.ts`
- `apps/api/test/application/use-cases/execution/accept-parallelization.use-case.spec.ts`
- [RN-404](../business-rules.md#rn-404) (Dev Lead → dev delegation)
- [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) — item 5, cut
  revoked here
- [ADR 0038](0038-hierarquia-de-agentes.md) — original design of
  `delegations`/`RecordDelegationUseCase`
- [ADR 0086](0086-dev-lead-plano-suspende-para-aprovacao.md) — another
  closing of a divergence between declared `docs/fluxo.yml` and the Dev
  Lead's code
- `docs/fluxo.yml` — `delegacao`/`dev` entry (no longer cites `status:
  lacuna`)

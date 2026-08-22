# Team model and deliverable flow

> Context consolidated from the team-model design session
> (Aug/2026), audited against the product's real state. The formal
> specification lives in [`docs/fluxo.yml`](../fluxo.yml); this document
> explains the decisions. Structural decision: ADR 0085. Sibling
> pieces: `docs/gates.yml` (ADR 0054) and `agent-areas.ts` (catalog,
> PHASE 18).

## Origin

The model translates the profession map of a high-performance delivery
team (Architect, Tech Lead, PO/PM, Staff, SRE/Platform, DevOps/Infra,
QA/SDET, AppSec, Data/Analytics Engineer, UX, Delivery, DBA) into Brabo
agents, under two criteria:

1. A separate role only exists when there's a distinct deliverable AND
   a distinct gate. Splitting by org chart produces handoff with no
   gain.
2. Every transition between roles is a declared gate, verified by
   script — never manual annotation (lesson from Phase 10/13).

The principle that emerged from the segregation: **almost every split
is first about DELIVERABLE and MOMENT, and only afterward (maybe)
about agent** — QA and AppSec gain a design moment while keeping a
single agent; analytics was born as a new output of `medicao` before
becoming a role. A role materializes once its artifact is already
circulating, never before — except when the product owner decides to
ANTICIPATE the build without waiting for the organic trigger, as was
done for `analytics`/`delivery-metricas` (ADR 0089): both became
`status: active` as a report SCRIPT (`analise:funil`), never an agent —
the shape the separation criterion already prescribed.

## Product owner's decisions

- **Engineering Manager: removed.** There's no people management
  between agents.
- **The Creative is the entry point** — turns free-form conversation
  into a business need. Absorbs UX discovery.
- **Psychologist and Anamnese: under refinement.** Code active, outside
  the formal flow until the deliverables are redefined. Pending
  consequences: the proposal to raise `max_parallel` (RN-086) is left
  without an author, and the Staff's activation trigger is left
  orphaned.
- **Delivery absorbed** by the Harness (orchestration) + measurement
  (PARTIAL DORA delivered as a report — real funnel, real lead time,
  real deployment frequency; MTTR and change failure rate remain
  `status: lacuna`, dependent on a real incident signal — ADR 0089);
  **DBA absorbed** by Dev Lead (migration) and Platform (tuning).

## Flow invariants

1. No artifact without a declared recipient.
2. No role starts without complete inputs — a gap produces a return
   with a reason, never silent assumption.
3. Every transition is a gate from the declarative registry (ADR 0054).
4. The feedback loop is mandatory: telemetry → Architect and product
   metrics → PO are artifacts with a recipient.
5. Architect × Dev Lead boundary: a decision that fits within a
   revertible PR belongs to the Dev Lead; an irreversible decision
   belongs to the Architect.

## Activation trigger table

| Trigger in the product | Roles it activates/separates |
|---|---|
| Gate `implementavel` created | `qa-estrategia` + `appsec` (second moment of existing agents) |
| Anticipated by product owner decision (ADR 0089/0091) | `analytics`/`delivery-metricas` and the `secops-runtime` report over `rate_limit_hits` become `active` as a script, ahead of the organic trigger |
| COMPLETE product metrics become PO input | the rest of `analytics` (what ADR 0089 didn't close) |
| `DEPLOY_ENABLED` flips | `platform` activates → then the rest of `secops-runtime` (automatic detection, incident response, postmortem) |
| Anamnese leaves refinement | the `staff` trigger has an owner again |
| Managed project with its own UI | `ux-designer` splits off from the Creative |
| Real data volume | `dbre` splits off from Dev Lead/Platform |
| — (never) | `delivery-metricas` becomes a report, not an agent (ADR 0089, already delivered) |

## Mesh state (audited)

**The downstream flow is nearly complete; what's missing is the
upstream one.** Gaps:

| Gap | Where | Reference |
|---|---|---|
| `deployavel`/`operavel` | Infra/Platform | planned, DEPLOY_ENABLED |

The "product metrics → PO" loop closed: `listar_metricas_de_produto`
(RN-407) let the PO read the same `analise:funil` report (ADR 0089)
within its turn — it was the last line of this table (item B4 of the
fluxo.yml × code audit).

## Proposals pending decision

- [ ] Who inherits the Staff's trigger and the cap-raise proposal while
      the Anamnese is under refinement — or both wait, declared as such.

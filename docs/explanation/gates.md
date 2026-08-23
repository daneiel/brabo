---
sidebar_position: 7
---

# The gates, and how they're measured

A **gate** is a point in the flow where work stops until someone —
person, agent, or script — says it can proceed. The product has
thirteen, and until PHASE 15a none of them existed as a list: they were
scattered across pure rules, use cases, tests and CI workflows.
Answering "which gates exist" required reading six files.

`docs/gates.yml` is that list. This document explains what it is, and —
more importantly — what it is **not**.

## The registry describes; it doesn't execute

No gate becomes enforced because of the file. Changing `severidade` in
it doesn't change any behavior: who blocks a merge is still
`decide.ts`, who judges a PR is still the QA agent, who fails a
backmerge is still the CI workflow.

It's the easiest assumption to get wrong, so it's worth repeating:
**the registry is an index, not policy.** The branching policy still
lives in [branching-policy.md](branching-policy.md); the `entrada` and
`entregavel` fields are a sentence in Portuguese, and `onde` points to
the code that really governs.

What the registry buys is something else: making gates
**enumerable**. The lesson from Phases 10 and 13 — metric extracted by
script, never annotated by hand — can't be applied to what can't be
listed.

## The two fields that age if left undefined

**`verificacao`** answers *how you prove this gate passed*, not who
judges it. `script` means there's a mechanical artifact — an event, a
test, a job — that serves as proof. That's why `qa-verificada` is
`script` even though it's an LLM issuing the verdict: the artifact is
the `pr.gate_changed` with `veredito`. Who judges lives in `dono`.

**`aprovacao_humana: true`** means the decision belongs to the user —
directly by a click, **or** delegated by a policy the user wrote
themselves. That's what lets `acao-aprovada` coexist with `status:
auto_approved`: the policy deciding on its own is the user having
decided beforehand. `merge-protegida` is the case where not even
delegation exists, because the ceiling downgrades `auto_approve` to
`require_approval` even with autonomy on.

In the four gates the constitution declares manual, this field is
invariant and locked by a test
([RN-071](../business-rules.md#rn-071)).

## Three forms of evidence, because not every proof lives in the log

| type | when | what the locator brings |
|---|---|---|
| `event_log` | the outcome becomes a domain event | event types + payload filter |
| `teste` | the guarantee is an assertion | spec path |
| `ci` | the gate lives in the repository | workflow + spec |

The two cases that forced the field to exist:

- **`merge-protegida`** doesn't emit its own event. It's a ceiling
  applied last on top of the already-computed verdict, which downgrades
  `auto_approve` to `require_approval`; the outcome shows up as a
  pending `proposed_action.created`, indistinguishable from any other
  pending item. What guarantees the block is the test.
- **`backmerge`** lives outside the application: it's a required check,
  with state versioned in `.release/gate.json` on `main`.

Without `evidencia`, the rule "a `block` gate without proof fails"
would turn the product's two hardest locks permanently red.

## The shared-type trap

`qa-verificada` and `secops-segura` **are not two event types**: both
record `pr.gate_changed`, discriminated by `payload.gate`. Worse — the
same type is recorded when the gate **opens**, without a `veredito`.

A registry that stored only the type name would count opening as
passing and measure double what actually happened. Hence the filter,
and hence the `veredito: presente` sentinel. The same applies to the
two infra PR gates, which share `infra.gate_changed`.

The test asserts that **no pair** (`event_types` + `filtro`) repeats in
the registry. That uniqueness is what makes the measurement mean
anything.

The filter only reaches the **payload**, on purpose: accepting an
arbitrary column in the YAML would open up the entire query. Who
promoted a story — a person or the PO — lives in the `actor_kind`
column and stays outside the declarative vocabulary.

## Measuring

```bash
pnpm --filter api validacao:gates                    # full report
pnpm --filter api validacao:gates -- --sem-banco     # registry and locators only
pnpm --filter api validacao:gates -- --projeto <uuid>
```

Three phases, in this order: **registry** (loads and validates),
**locators** (does the `teste`/`ci` target exist?) and **event log**
(latest passage, with event id). The first two never touch the
database — that's what makes the script useful in CI without Postgres.

| exit code | when |
|---|---|
| `0` | valid registry and locators in place |
| `1` | invariant violated, target missing, or gate with no passage **when `--projeto` was given** |
| `2` | invalid usage |

The asymmetry is deliberate. Registry and locators are claims about the
**repository**: they always hold. Event-log evidence is a claim about
an **execution**, and only exists if one happened — without
`--projeto`, phase 3 is just a report. Requiring a passage on a
freshly created database would make the script exit `1` always, and a
script that always fails becomes noise nobody reads.

## What enumerating already paid off

Before measuring anything, writing the list found two things nobody
was seeing:

- QA and SecOps's judgment on **infra** PRs, which has its own path
  (`infra.gate_changed`, with no backlog task behind it) and wasn't in
  the spec;
- `promotion-check` was a required check **with no spec of its own**,
  unlike `pr-police` and `approval-ladder`. The evidence pointed to the
  script, with the gap written right there, and the item went to
  triage — the phase declares and measures, it doesn't fix. **Triage
  closed it:** `scripts/ci/promotion-check.spec.ts` exists, and the
  gate's evidence now points to it. It's the cycle working as
  designed — enumerating found it, triage prioritized it, another
  phase fixed it.

The third finding came from the measurer's first run: the
`story-promovida` filter pointed at `actor_kind`, which is a **column**
and not payload, and the gate showed up as "never passed" on a database
where it had passed hours before. A registry nobody runs is a registry
that lies.

## Activating a `planned` gate is the same work as any other

`implementavel` (owner `dev-lead`) was born `planned` in PHASE 14d,
alongside the rest of the target org chart that `docs/gates.yml`/
`docs/fluxo.yml` already described with no code behind it. The
[ADR 0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md)
activated it — and the exercise is worth using as an example because
**nothing about the registry's shape changed**: `status: planned →
active` plus the `evidencia` block (pointing to
`proposed_action.created` filtered by `actionType:
assess_implementability`) are the ONLY two lines a `warn` gate needs to
gain to stop being an aspiration. `severidade` stays `warn` — the
comment in the file already said "born warn even when activated," and
activating isn't the same decision as promoting to `block` (that would
require measuring real passages first, same discipline as PHASE 15a).

The real work sits outside the file: the Dev Lead needed a new tool
(`assess_implementability`) that proposes the assessment as a
`proposed_action`, and QA-strategy — until then a `proposto` role in
`docs/fluxo.yml`, with the separation criterion already written there
("can be the qa-lead itself in a second moment") — had to exist to
feed the assessment with a real test plan. The registry only started
describing what the code now does.

## A registry can age in the wrong direction — stale, not inactive

`implementavel` is the example of a gate that needed new code to leave
`planned`. `paralelismo-autorizado` is the opposite: the mechanism
(`RequestParallelizationUseCase`,
[RN-083](../business-rules.md#rn-083)) has been in production since
PHASE 14d — it was the registry that fell behind, declaring `planned`
over something that was already `active` in the sibling `docs/fluxo.yml`
and in the code. The fluxo.yml × code audit (finding A1/B5,
[auditoria-fluxo-vs-codigo.md](auditoria-fluxo-vs-codigo.md)) found the
divergence; the fix was just the same two lines `implementavel` also
gained — `status: active` plus `evidencia` pointing to
`proposed_action.created` filtered by `actionType: parallelize`.

Worth noting why this changed nothing on the team panel's PR track:
`paralelismo-autorizado` is `fluxo: execucao`, and the screen only
derives steps from `fluxo: pr` gates (see "Consumption" below) — a
gate can become `active` in the registry without appearing anywhere in
the UI, if its flow is a different one.

## A gate can be born `active` directly — when the mechanism and the registry arrive together

`implementavel` and `paralelismo-autorizado` are the two examples of a
gate that already existed (declared `planned` or stale) and gained its
registry entry AFTERWARD. `necessidade-validada`
([RN-406](../business-rules.md#rn-406),
[ADR 0095](../adr/0095-gate-necessidade-validada.md)) is the third
pattern: mechanism and registry were born in the SAME change, because
the gate itself didn't exist anywhere — not `planned` in the file, nor
code behind it.

The choice of `severidade: warn` follows the same reasoning as
`implementavel`, but for a different reason. `implementavel` is `warn`
because promoting to `block` would require measuring real passages
first (PHASE 15a). `necessidade-validada` is `warn` because NOTHING in
the product today checks its passage before letting the PO continue —
the Creative→PO handoff already happens inside `confirm_readiness`,
before this gate even exists. `block` would promise a lock that doesn't
exist; `warn` describes exactly what the gate is: a measurement that a
human validated the need's merit, not a gate that blocks the next
step.

`workspace-verificado` ([RN-423](../business-rules.md#rn-423),
[ADR 0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md))
is the fourth example, and the clearest of the four about why `warn` isn't
a "weak lock": what really locks things down HERE isn't the gate, it's the
explicit refusal in
`Engine.Actions.TerminalExecutor.decisao_de_execucao/1` — without a
verified workspace or a connected runner, the command is refused
unconditionally, deep inside the code, without going through the registry.
The gate exists only to give EVIDENCE of when the confirmation happened
(`project.workspace_verified` in the event log); promoting it to `block`
would describe a lock that already exists somewhere else, the same way
`necessidade-validada` would have lied about one that doesn't exist
anywhere.

## Consumption: the screen derives, it doesn't repeat

The PR track on the panel — Dev → QA → SecOps → You — used to be a
list written into the component. Since PHASE 15b it comes from the
registry, via `GET /gates`.

What changes in practice is one property, not the appearance: **a gate
that leaves the registry leaves the screen on its own.** Before,
deactivating SecOps left a dead step on the track until someone
remembered to edit the code — exactly the kind of aging that motivated
the registry to exist.

Three decisions worth explaining:

**The route is separate from the internal one.** `/internal/gates` is
service-to-service, with a service token, and serves the measurement
script; `/gates` belongs to the logged-in user and serves the screen.
Same registry, different audiences.

**No `projectId`.** The registry is a fact about the PRODUCT: the same
gates apply to every project. Attaching it to a project would suggest
it's possible to have different gates per project, which is exactly
what ADR 0054 deliberately left undecided.

**Only `active` gates.** A `planned` gate describes a future role
(dev-lead, platform). On a screen that says what's happening now, it
would appear as if it were happening.

### What the screen still decides on its own

Each step's **label** (`QA`, `You`) and **which step each gate
represents** stay in the component. It's not an inconsistency: the
registry describes policy, and what to call things for the user is a
screen decision. What left it was the LIST — which steps exist.

A PR gate the registry brings that the screen doesn't yet know how to
draw is **ignored**, with a test asserting it: an `undefined` step in
the middle of the track would be worse than its absence.

## References

- [ADR 0054](../adr/0054-gates-como-registro-declarativo.md) — the
  decision
- [ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md) — the
  decision in the event log, without which there'd be nothing to
  measure
- [RN-070](../business-rules.md#rn-070), [RN-071](../business-rules.md#rn-071)

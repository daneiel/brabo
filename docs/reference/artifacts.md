---
id: artifacts
title: Artifacts
sidebar_label: Artifacts
sidebar_position: 4
description: The ten artifact schemas validated in the engine, who can emit each one, and why most are not emittable by the model.
keywords: [artifact, schema, emit_artifact, qa_verdict, business_rule]
---

# Artifacts

An artifact is the **structured and validated** output of an agent. Concretely:
an `artifact.<type>` event in the log, with the payload validated against a
closed schema before being written.

There is no artifact table. Validation happens in one place only —
`Engine.Harness.ArtifactSchemas` — and a missing required field **fails the
emission**, instead of writing a half-formed artifact.

## Who can emit what

This is the most important distinction on this page, and it's easy to miss:

| origin | meaning |
|---|---|
| **tool** | the model decides to emit, calling `emit_artifact` |
| **server** | the code emits when the outcome happens; the model doesn't choose |

**Only two types are emittable by tool:** `note` and `business_rule`. Everything
else is emitted by the server.

The reason is the same in every case: when the artifact is the **record of an
outcome**, letting the model choose whether to emit it means letting it omit it. A
DevAgent that gives up shouldn't be able to decide not to record that it gave up.

**The session type filters no artifact.** [RN-097](../business-rules.md#rn-097)
gave the session a `kind` (`consultiva` | `criativa`) and put a guard on event
append, but it reaches **one** type — `execution.activated` — and no artifact is
it. A consultative session records `artifact.business_rule` all the same: what it
doesn't do is enter execution. Whoever arrives at the type rule tends to assume the
opposite, and the wrong assumption here would erase the record of an entire
conversation.

## The schemas

### `note` — tool

| field | required |
|---|---|
| `title` | ✅ |
| `body` | ✅ |

### `business_rule` — tool

| field | required |
|---|---|
| `title` | ✅ |
| `description` | ✅ |
| `origin` | ✅ — **non-empty list** |

`origin` references the conversation events that originated the rule. An empty
list fails: it is the traceability of the rule back to where it was stated, and
without it the rule becomes an assertion with no provenance.

:::caution The model needs to KNOW the field names
The description of the `emit_artifact` tool is generated from these schemas
(`ArtifactSchemas.required/1`) and names each required field, in English, with
a filled-in example.

This isn't fussiness: the previous description simply said "emits a typed
artifact" and listed the types. In a real execution the model — conversing in
Portuguese — guessed `titulo`/`descricao`/`comportamento`, and the **four
business rules from that conversation were silently rejected**. `origin` as
free text also fails: it has to be a list, and the description says so in plain
terms ([RN-061](../business-rules/custo.md#rn-061)).
:::

### `product_brief` — server

| field | required |
|---|---|
| `title` | ✅ |
| `summary` | ✅ |
| `rules` | ✅ |

Validatable, but **not** emittable by tool. The Creative server emits it only
after you confirm readiness — never through a model tool call.

### `task_blocked` — server

| field | required |
|---|---|
| `taskId` | ✅ |
| `agentId` | ✅ |
| `reason` | ✅ |
| `diagnosis` | ✅ |

Emitted when the DevAgent gives up on the task: a suite that doesn't close, an
iteration ceiling, a blown budget, or a stall without signaling. It is the record
of the outcome.

### `qa_verdict` and `secops_verdict` — server

| field | required |
|---|---|
| `veredito` | ✅ — `approved` or `changes_requested`, nothing else |
| `resumo` | ✅ |
| `itens` | ✅ |
| `taskId` **or** `prActionId` | ✅ — exactly one |
| `coverageMatrix` | optional, QA only |

Three extra validations live here:

**The verdict is closed** to the same two values as the api's gate state
machine. A value outside that would make the use case blow up further down the
line — rejecting the artifact at emission is the right place to fail.

**The subject is exclusive.** A verdict is about **one** dev task (`taskId`) or
about **one** infra PR (`prActionId`) — never both, never neither. Same artifact
type, different consumers.

**`coverageMatrix` is optional on purpose.** A QA verdict without a coverage
matrix is still a valid verdict; losing it entirely because of one missing field
would be worse than recording it incomplete.

SecOps is deterministic — it has no LLM. The QA verdict is born from the
`emit_qa_verdict` tool, which is enforced separately. In neither case does the
model choose to emit.

### `infra_delegation_files` — server

| field | required |
|---|---|
| `files` | ✅ — **non-empty** list |
| `summary` | ✅ |

Result of ONE delegate from the Infra area (Phase 8c, ADR 0038) — the lead
itself (Dockerfiles/compose) or the Workflows subagent (CI pipeline). The
`InfraLeadServer` emits this after each delegate finishes, just to have a
`parecer_artifact_id` to reference in the `delegations` table — never seen from
outside the area. What the api sees is the consolidated PR, via `open_infra_pr`
(the same mechanism as always, untouched by Phase 8c).

An empty `files` fails for the same reason as `nada_a_validar/1` in
`InfraGateRunner` (ADR 0021): a delegate with no files at all didn't finish
anything, and "empty" should never pass as "done".

### `prototipo_navegavel` — tool (`propose_prototype`, not `emit_artifact`)

| field | required |
|---|---|
| `personas` | ✅ — **non-empty** list |
| `jornadas` | ✅ — **non-empty** list |
| `prototipo` | ✅ — `telas` non-empty |
| `resumo` | ✅ |

The prototype the UX Designer produces (ADR 0087), from the Creative's
`necessidade-de-negocio`. It is not `note`/`business_rule` — the UX Designer
emits via `propose_prototype`, a DEDICATED tool
(`Engine.Agents.UxDesignerTools`), and this module only validates the SHAPE,
the same mechanism as `product_brief`: validatable here without being on the
list of types emittable via `emit_artifact`.

Empty `personas`/`jornadas`, or a `prototipo` with no screen at all, fail by
the same rule as `business_rule.origin` (line 59): an artifact with no content
isn't worth recording. A successful `propose_prototype` ends the turn (the same
reasoning as `propose_execution_plan`/`propose_infra_pr`) — no
`proposed_action`, no suspension: proposing a prototype has no external effect.

### `plano_de_teste` — server

| field | required |
|---|---|
| `storyId` | ✅ |
| `planoDeTeste` | ✅ |
| `criteriosExecutaveis` | ✅ — **non-empty** list |
| `estrategiaDeAutomacao` | ✅ |

The deliverable of QA-strategy (ADR 0090; `docs/fluxo.yml`, role
`qa-estrategia`, the `qa-lead`'s second moment): the test plan for ONE story,
emitted BEFORE the dev agent writes any code — the `implementavel` gate
(`docs/gates.yml`) consumes it. It is born from `emit_plano_de_teste`, but the
model doesn't emit the artifact directly — `Engine.Gates.QaEstrategiaAgent`
extracts the result from the tool call and calls `ArtifactEmitter.emit/5`, the
same pattern as `qa_verdict`/`task_blocked`.

An empty `criteriosExecutaveis` fails for the same reason as
`infra_delegation_files`: a plan with no criteria at all isn't a plan.

### `threat_model` — server

| field | required |
|---|---|
| `storyId` | ✅ |
| `threatModel` | ✅ |
| `requisitosDeSeguranca` | ✅ |

SecOps's "second moment" (RN-360, ADR 0090) — a STRIDE-lite checklist over the
DESIGN of a story, before any code exists, the same second-moment pattern as
`qa-estrategia`. `Engine.Gates.SecOpsAgentServer.run_design/2` emits after
`Engine.Gates.AppSecAgent.run/3` (no `Terminal`, no `Diff`/`Scanner`/
`DevAgentState`) finishes the loop with `emit_threat_model` — the model doesn't
choose to emit, the server emits when the loop ends.

`riscos` is left out of the required fields: an empty list is a valid answer
(not every story carries residual risk) and the tool already guarantees the KEY
exists — there's no "forgotten" to distinguish from "none".

## Artifacts that don't go through here

Two `artifact.*` event types exist in the log without being in this registry,
because they are emitted by the **api**, not by the engine:

| event | origin |
|---|---|
| `artifact.module_map` | the Architect, via a use case in the api |
| `artifact.insight` | analysis, via a use case in the api |
| `artifact.project_image` | the Architect, via a use case in the api ([ADR 0065](../adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md), [RN-105](../business-rules/autenticacao.md#rn-105)) |
| `artifact.module_routing` | the Architect, via a use case in the api — one candidate image per module of the current `module_map`; the Architect CANDIDATES, Infra ELECTS in a later step ([ADR 0131](../adr/0131-roteamento-de-modulos-para-infra.md), [RN-487](../business-rules.md#rn-487)) |

They have their own validations in the api's domain. The asymmetry is
historical, and is noted as
[technical debt](../architecture.md#divida-tecnica): ideally every
`artifact.*` would go through a single registry.

## When validation fails

| error | cause |
|---|---|
| `{:unknown_type, tipo}` | type outside the ten |
| `{:missing_keys, [...]}` | required fields missing, all named |
| `:origem_invalida` | `business_rule.origin` empty or not a list |
| `{:sujeito_invalido, chaves}` | verdict with both subjects, or with neither |
| `{:veredito_invalido, valor}` | verdict outside `approved` / `changes_requested` |
| `:invalid_payload` | payload is not a map |

The failure goes back to the agent as the tool result. A model that emits a
malformed artifact receives the error and can correct it — within the
ToolLoop's iteration ceiling.

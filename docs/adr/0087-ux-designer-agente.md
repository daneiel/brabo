# ADR 0087 — The UX Designer enters as a conversational agent

- **Status:** Accepted
- **Date:** 2026-08-17
- **Context:** explicit decision of the product owner, anticipating the
  separation trigger that `docs/fluxo.yml` already declared for the role

## Context

`docs/fluxo.yml` (ADR 0085) already registered `ux-designer` as a
target-model role for the team, with `status: proposto`,
`hoje_absorvido_por: criativo (discovery) + design/ (design system as
data)`, and a written objective separation criterion:

> When the MANAGED project has its own interface to design — today the
> design system is a static input. Separates when the prototype becomes
> a recurring artifact.

That trigger **did not fire**. Brabo doesn't yet build projects with
real UI of their own in production; the design system
(`design/tokens.css`, `design/COMPONENTS.md`) remains a static input
that the Arquiteto and dev agents consult, never a live project needing
recurring UX decisions.

The product owner decided to build the agent now anyway — a CONSCIOUS
decision to get ahead, recorded here so it isn't mistaken for a
misreading of the criterion. The history of what the role absorbed
remains in `docs/fluxo.yml`, as a comment: the previous text isn't
erased, it just stops being the current state.

## Decision

**The UX Designer enters as the fifth conversational agent — Criativo,
PO, Arquiteto, Dev Lead, and now UX Designer —, SOLO (no area, no
subagents), mirroring the design of `Engine.Agents.DevLeadServer`.**

### The pieces

1. **`Engine.Agents.UxDesignerServer`**
   (`apps/engine/lib/engine/agents/ux_designer_server.ex`) — GenServer
   per session, event-log rehydration, streaming, bounded tool-use loop
   with a cap of 14 (same tier as Arquiteto/Dev Lead: a REASONING agent,
   not light conversation like Criativo/PO, which have a cap of 12).
   Activated by a handoff `accepted` addressed to "ux-designer" — the
   mechanism is GENERIC (`ActivateAgentUseCase`/`canActivateAgent` in the
   api already accept any agent with an accepted handoff; not a line
   changed there) — and the kickoff only runs on a FRESH start (a restart
   doesn't regenerate the prototype).
2. **The kickoff reads `artifact.product_brief`**, the SAME "business
   need" that Criativo produces — no new artifact, the same reading
   pattern `ArquitetoServer.build_kickoff/1` already uses.
3. **The design system is DESCRIBED in the identity**
   (`Engine.Harness.Agents`, entry `"ux-designer"`), static text with the
   `design/tokens.css` tokens (semantic colors, typography, spacing,
   radius) and `design/COMPONENTS.md` conventions (button variants, icon
   style). Conversational agents do NOT have a repository file-reading
   tool — there was no tool to reuse —, and the identity is the only
   prompt layer present in EVERY turn, not just the kickoff.
4. **`propose_prototype`** (`Engine.Agents.UxDesignerTools`,
   `apps/engine/lib/engine/agents/ux_designer_tools.ex`) — the ONLY
   tool: `personas`, `jornadas`, `prototipo` (`telas` + `anotacoes`), and
   `resumo`. Writes `artifact.prototipo_navegavel` and offers a handoff to
   "po" and to "dev-lead" over the SAME artifact.
5. **`Engine.Agents.UxDesignerSupervisor`** — an exact copy of the
   `DevLeadSupervisor` pattern; registered in `Engine.Application`
   alongside it. `EngineWeb.AgentCommandController` gained the three
   clauses (`start`, `message`, `via_for`) the other four conversational
   agents already have.
6. **`apps/web/src/lib/agents.ts`**: `'ux-designer'` in `AgentKey`, entry
   with `color: 'var(--accent)'`. None of the five semantic tokens of
   `design/tokens.css` was free of another agent — `--accent` is the
   least reused (only the Arquiteto), and the design-system rule
   prohibits new hex codes. `icon: PencilIcon`, the only icon in the
   catalog semantically tied to design/editing that was still unowned.

### `artifact.prototipo_navegavel`: no table, and no dedicated api use case

This is the decision that needed investigation before coding, because the
two precedents of "artifact without table" (`artifact.project_image`, ADR
0065; `artifact.c4_diagram`, RN-149) use a DIFFERENT path than the one
`artifact.business_rule`/`artifact.product_brief` use, and the two paths
look interchangeable until you look at WHY.

`choose_project_image`/`create_c4_diagram` have their OWN use case in the
api (`DecidirImagemDoProjetoUseCase`, `CreateC4DiagramUseCase`) because
each has a structural reason for that:

- the C4 Container level is DERIVED from the current `module_map` —
  content the model can't retype without risking divergence from the real
  source;
- the image decision has a domain rejection (explicit tag, resource cap)
  that more than one consumer needs to respect the same way.

`propose_prototype` has neither. Personas, journeys, screens, and
annotations are SELF-CONTAINED content — only the UX Designer itself
writes it, only it reads it back, nothing is derived from another
artifact, and there's no second shared domain rule waiting to be reused.
So it follows the `business_rule`/`product_brief` path: FORM validation
in the ENGINE (`Engine.Harness.ArtifactSchemas`, type
`"prototipo_navegavel"`) and writing through the GENERIC path the api
already exposes for any `session_event`
(`EngineApiClient.append_event_returning/3`, no new route). Opening a
`CreatePrototipoUseCase` would replicate `CreateC4DiagramUseCase`'s form
without either of the two reasons that justify it there —
complexity without an argument.

### One artifact, two handoffs — never two artifacts

`docs/fluxo.yml` lists two outputs of the role: `prototipo` (to the PO)
and `spec-visual` (to the Dev Lead). The obvious temptation was a second
tool call or a second artifact for "spec-visual." The decision was NOT
to duplicate: the prototype (screens + behavior annotations) IS the
visual spec — the PO reads `resumo`/`prototipo` to design the backlog,
the Dev Lead reads the SAME `telas`/`anotacoes` as implementation
reference. Two copies of the same content would diverge the first time
only one side gets revised — the same argument that already applies to
the C4 not retyping the `module_map`.

### The turn stops at the first success — the Dev Lead's lesson, without its suspension

`UxDesignerServer` reuses the half of `DevLeadServer`'s design that
survives without ADR 0086: a SUCCESSFUL `propose_prototype` ends the
turn, so the model doesn't propose again and produce two prototypes for
the same total (the real defect that motivated that guard in the Dev
Lead). The OTHER half of ADR 0086 — suspending to wait for a
`proposed_action` — does NOT apply here: `propose_prototype` has no
external effect at all (it's content, not action; there's no parallel to
the "spend the RN-083 cap charges for"), so it's born as a simple event,
the way `execution.plan_proposed` was born before 0086.

## Consequences

**For**

- The role enters active with the SAME rigor as the other four
  conversational agents — iteration cap, rehydration, failure narrated
  with origin (RN-059/163) —, instead of growing as an ad-hoc feature
  inside Criativo.
- Zero new api route: the handoff-based activation mechanism, the
  generic `append_event_returning`, and the generic `create_handoff`
  already sufficed. The only new api surface is the `uxDesignerActive`
  field on the roster (RN-287), symmetric to what `infraActive` already
  did.
- `docs/fluxo.yml` stops describing a role the code didn't have —
  `status: active`, real inputs/outputs, no `_alvo` suffix.

**Against**

- **Anticipated trigger, by explicit decision.** The original separation
  criterion (own interface in a managed project) doesn't hold up on its
  own as a justification — it's accepted because the product owner asked
  for it, aware of that.
- **`teste-de-usabilidade` remains out of reach.** It requires a real
  human user testing the interface; no agent replaces that. Not
  simulated.
- **`metricas-de-uso` remains a declared gap.** It depends on the
  `analytics` role (PRODUCT metric), which `docs/fluxo.yml` keeps as
  `proposto` — without it, the UX Designer's corresponding input has no
  real source.
- **The dashboard card and the team panel calculate `uxDesignerActive`
  separately** (RN-090) — the same duplication `infraActive` already
  had, accepted for the same reason: the api answers FACTS, the
  presentation is the web's job.

## Alternatives considered

**Wait for the separation trigger to fire.** This was the literal
reading of `docs/fluxo.yml` before this change. Rejected by explicit
decision of the product owner — see Context.

**`artifact.prototipo_navegavel` with a dedicated api use case, in the
`CreateC4DiagramUseCase` pattern.** Rejected: neither of the two reasons
that justify that pattern (derived content, shared domain rejection)
applies here. Copying the form without the reason is complexity the next
person reading the code would have to justify on their own.

**A second tool call/artifact for "spec-visual."** Rejected: the
prototype already IS the visual spec. Two copies of the same content
(one for the PO, another for the Dev Lead) would risk diverging the
first time only one side gets revised.

**UX Designer as a subagent of a new area.** Rejected: nothing in the
role calls for internal delegation or multiple parallel executors — it's
ONE person's reasoning per session, as Criativo/PO/Arquiteto/Dev Lead
already are.

## References

- `docs/fluxo.yml` — `id: ux-designer` block, the original separation
  trigger
- [ADR 0085](0085-fluxo-como-registro-declarativo.md) — `docs/fluxo.yml`
  as the declarative record of roles
- [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) — creates the Dev
  Lead, the mold this ADR replicates
- [ADR 0086](0086-dev-lead-plano-suspende-para-aprovacao.md) — why
  `propose_prototype` does NOT suspend (no external effect)
- [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md),
  [RN-149](../business-rules/autenticacao.md#rn-149) — the artifact-without-table
  pattern `artifact.prototipo_navegavel` follows, and why it does NOT
  need the dedicated use case the other two have
- `apps/engine/lib/engine/agents/ux_designer_server.ex`,
  `ux_designer_tools.ex`, `ux_designer_supervisor.ex`
- `apps/engine/lib/engine/harness/agents.ex`, `artifact_schemas.ex`
- `apps/web/src/lib/agents.ts`, `agent-status.ts`

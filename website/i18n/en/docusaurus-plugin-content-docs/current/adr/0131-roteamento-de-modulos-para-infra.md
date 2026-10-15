---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0131 — The Arquiteto routes modules to infra: it NOMINATES, Infra ELECTS

## Context

The Arquiteto (Architect) already has six tools (`create_module_map`,
`assign_story_modules`, `choose_project_image`, `create_c4_diagram`,
`propose_adr`, `emit_insight`) and an image decision — `choose_project_image`
(ADR 0065) — that is **per project**: a single image, for the container of the
whole project. The real-container execution plan (ADR 0128/0130) asks for more
granularity: a project with modules of different stacks (a Node service, a
Python worker) does not fit in a single image when each module needs to come up
separately.

The design question is not "which image", it is "who decides what". The
Arquiteto already sees the architecture (it is the one who wrote the
`module_map`), but it does not see the fleet of images already in use, the cost
of maintaining one more variant, or the operational conventions Infra follows —
those are Infra's competences, not Architecture's. Giving the Arquiteto the
power to FIX each module's image (as `choose_project_image` fixes the
project's) would push an operational decision onto whoever only has the design
side.

## Decision

**The Arquiteto nominates; Infra elects.** This delivery is only the
Arquiteto's half: a new tool, `route_modules_to_infra`, that produces a LIST —
one item `{modulo, imagemCandidata, porque}` per module of the current
`module_map` — and records it as `artifact.module_routing`, next to
`artifact.module_map`/`artifact.project_image`/`artifact.c4_diagram` (same
tableless design as ADR 0065, extended here: the event IS the artifact). The
half that ELECTS (the Infra Lead reading this list and deciding, with its own
`proposed_action`) is a separate PR — the routing exists and is auditable
before Infra has a tool to consume it, the same kind of sequencing that already
held for `module_map` arriving before `create_c4_diagram` needed it.

**`:direct`, outside the global `@registry` — not a `proposed_action`.**
Routing has no external effect: it does not bring up a container, it changes
nothing outside the event log. It is an INTERNAL architecture decision, of the
same caliber as `choose_project_image` and `create_c4_diagram`, which are also
`:direct`. Turning this into a `proposed_action` would put a draft decision
(which Infra will still review) in the same queue that approves `git push`.

**The candidate image goes through the SAME validation as
`choose_project_image`, per item.** `validarDecisaoDeImagem`
(`domain/containers/project-container.ts`) already knows how to refuse an image
without tag/digest, `latest`, and a short `rationale` — reimplementing that rule
per module would create two versions of it to diverge. The new domain
(`domain/architecture/module-routing.ts`) only adds what is SPECIFIC to the
list: it cannot be empty (it is not a decision), it cannot repeat a module
(ambiguous — which of the two images holds?), and each cited `modulo` must
exist in the project's current `module_map` (same check as
`assign_story_modules`/`missingModules`, and for the same reason: the refusal
lists the VALID names, so as not to force the model to guess).

**Without a module_map, there is nothing to route — refused, not invented.**
The tool only makes sense after `create_module_map`; the `build_kickoff/1` of
`ArquitetoServer` (the only place from which the model learns the ORDER of the
tools) now lists `route_modules_to_infra` as step 4, right after the
module_map. Calling without a current module_map is refused with the same text
as `create_c4_diagram` — "defina o module_map antes" — instead of routing
against an empty or invented map.

## Consequences

**Nothing brings up a container yet.** This delivery does not change the
RN-105 gate, does not touch `RegistrarTransicaoDeContainerUseCase`, does not
introduce a new `proposed_action`. What exists after it: an auditable list of
nominations, read by a human in the event log — Infra does not yet have a tool
to act on it (next PR).

**The candidate image may diverge from the project image
(`choose_project_image`).** On purpose: a module can justify an image different
from the one the Arquiteto fixed for the project as a whole — it is exactly the
granularity this delivery exists to open. Reconciling the two (or retiring
`choose_project_image` in favor of per-module routing) is a separate product
decision, not taken here.

**`EstadoDoRoteamento`/`GetModuleRoutingUseCase` follow the same mold as
`GetC4DiagramUseCase`** — tableless read, current by highest `version` with a
tie-break by `seq`. Existing as a separate use case (instead of inline in the
write one) is what gives correct versioning without duplicating the logic of
"which is the current one" — the same reason `DecidirImagemDoProjetoUseCase`
uses `ObterContainerDoProjetoUseCase`.

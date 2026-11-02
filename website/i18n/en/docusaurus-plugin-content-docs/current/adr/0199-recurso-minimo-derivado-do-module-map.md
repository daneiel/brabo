---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0199 — The container's minimum resource is derived from the `module_map`: each module declares its own, and Infra starts with the sum

## Status

**Accepted.** 2026-10-01 (AT-261, story HS-065, epic EP-030, round 36; owner
decision on 01/10: *"the minimum resource is derived from the `module_map` —
what the Arquiteto declares per module —, not a fixed preset per stack"*).
Changes the schema of the `artifact.module_map` artifact (Phase 3b) and what the
`container_start` execution does with an omitted `resources`, referencing
without editing them [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)
(resources with a ceiling in the image artifact),
[ADR 0130](0130-broker-de-container.md) (`pidsLimit` in the broker's spec),
[ADR 0131](0131-roteamento-de-modulos-para-infra.md) (the Arquiteto's routing),
[ADR 0133](0133-infra-elege-imagem-do-roteamento.md) (Infra elects) and
[ADR 0190](0190-a-infra-sobe-o-container-no-aceite.md) (the server's start-up on
acceptance, which used "default resources").

## Context

Measured on `dev` on 2026-10-01, before changing:

- `RECURSOS_PADRAO = {cpus 2, memoryMb 4096, pidsLimit 512}` and the ceiling
  `RECURSOS_MAXIMOS = {8, 16384, 4096}` in
  `apps/api/src/domain/containers/project-container.ts`. An omitted `resources`
  field became the default in `validarDecisaoDeImagem`; above the ceiling,
  refusal. There was no notion of a MINIMUM.
- The server's start-up on acceptance (`subir_no_aceite/2`, ADR 0190) always
  sends `resources: %{}`, so every container started by it got the default. The
  real container of the 29/09 use had `Mem=4 GiB`, `NanoCpus=2e9`, `Pids=512` —
  the default.
- The `module_map` had `{name, stack, responsibility, dependsOn}` per module
  (`ModuleNode` in `domain/architecture/module-graph.ts`, the JSONB column
  `module_maps.modules`, the engine's `create_module_map` tool) and no resource
  field. The routing (`artifact.module_routing`) and the image neither.
  "Compatible minimum" was not derivable from the existing data.
- A project has ONE container: `project_id UNIQUE` in `project_containers`.

## Decision

1. **The `module_map` gains `resources` per module.** Optional in the artifact
   (old maps do not have it; no migration — it is a JSON field), with the THREE
   numbers of the broker's spec: `cpus`, `memoryMb`, `pidsLimit`. It means what
   THAT module needs on its own inside the container. The `create_module_map`
   tool now asks for it (`required` in the item schema, with the three fields
   mandatory inside). The api validates on map creation: all three or none (a
   half declaration is 400 — completing the missing field with the default would
   be inventing the number), each positive and within the container's ceiling.
2. **The minimum is the SUM across modules, not the maximum.** All modules live
   in the same container at the same time: each one's dev agent works there, in
   parallel when the area parallelizes, and one's dev server does not shut down
   for the other's to run. The maximum would only be true if there were never two
   up, and its failure mode is an OOM-kill mid-command, not a readable refusal. A
   sum exceeding the ceiling is refused ALREADY at map creation (400 to the
   Arquiteto, who is the one who can fix it), and again, as a defence, at
   start-up.
3. **A module without a declaration counts with today's default as a FLOOR.** A
   number is never invented for it: the only one that exists is what it gets
   today, the container default. So, with a module lacking a declaration, the
   minimum is the GREATER of the sum of the declared ones and `RECURSOS_PADRAO`,
   field by field; only with all declared does the minimum go below the default.
   A map with no declaration at all — every map predating this ADR — gives
   exactly the default, and its behaviour does not change. The floor per
   CONTAINER, and not "default per module summed", is on purpose: adding 2 cpus
   per undeclared module would make an old five-module map exceed the ceiling and
   stop starting.
4. **The api is who derives, in the `container_start` execution.**
   `ExecuteContainerStartUseCase` reads the current `module_map` (the same the
   routing nominated), derives the minimum and resolves resources field by field:
   OMITTED becomes the minimum; BELOW the minimum is a named `failed` (without
   recording a decision nor starting); above holds up to the ceiling, checked as
   always by `validarDecisaoDeImagem`. Without a current `module_map`, the
   minimum is the default. The engine does NOT derive: the server's start-up keeps
   sending empty `resources`, and its rationale says the resources are the
   derived minimum — a single rule, in TypeScript, never a second copy of the sum
   in Elixir.
5. **The artifact's `rationale` says where each number came from.** The decision
   `DecidirImagemDoProjetoUseCase` records (`artifact.project_image`,
   `decidedBy: 'infra-lead'`) gains the sentence "Recursos mínimos (RN-683): …",
   with the summed modules, those that did NOT declare (named) and the map
   version. Whoever audits the container reads why it has those numbers.

## Consequences

- The server's start-up (ADR 0190) now starts with the SMALLEST eligible
  resource: a fully declared project may stay below the default of 2 cpus/4
  GiB/512 pids, which was the waste AT-261 measured.
- The Arquiteto now declares resources per module, and a model can get the number
  wrong. Erring HIGH costs machine and is auditable in the `rationale`; erring
  above the ceiling is a 400 with a reason; erring LOW is the remaining risk, and
  it is of the same calibre as what the Arquiteto already decided when choosing
  the image. The number is DECLARED, not measured — measuring the container's
  real consumption is another front, not taken here.
- The Infra Lead asks ABOVE the minimum when it wants (up to the ceiling), never
  below. The below-minimum refusal happens at EXECUTION: a `pending` proposal with
  resources below the minimum only fails when approved, with the reason in
  `executionResult`. Refusing already at proposal would require reading the map
  in `ProposeActionUseCase`, and was not done here.
- `choose_project_image` (the Arquiteto deciding the image from scratch, RN-105)
  does NOT change: there the Arquiteto chooses its own resources, and the owner's
  request was about Infra's choice. The start-up through the runner
  (`container_start_via_runner`) does not either: it starts the already decided
  image, with the resources recorded in it.
- The ceiling stays the same, and no other moves.
- The sum of CPU fractions is rounded to three decimals, so the artifact does not
  record `0.30000000000000004`.

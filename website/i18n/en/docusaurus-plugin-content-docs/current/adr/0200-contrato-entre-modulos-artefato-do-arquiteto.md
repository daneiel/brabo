---
traducao_de: f97894b6489d2e6970b87610f36b64414277b26d
---

# ADR 0200 — The contract between modules becomes a versioned Arquiteto artifact, and the dev agent reads it instead of someone else's worktree

## Status

**Accepted.** 2026-10-01 (AT-276, story HS-071, epic EP-030, round 36; owner
decision on 01/10: *"the contract between modules becomes a versioned Arquiteto
artifact (in the mould of `module_map`/`c4_diagram`), read by the devs through
the read tool; changing a contract is a new Arquiteto version"*). Extends the
table-less artifact design of
[ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md),
[ADR 0068](0068-diagrama-c4-do-arquiteto.md) and
[ADR 0131](0131-roteamento-de-modulos-para-infra.md); applies the rule "an agent
that writes must be able to read" (RN-164/165) to the dev agents, under the
contained reading of [ADR 0060](0060-superficie-de-leitura-de-codigo.md).

## Context

### The symptom

Real use of 2026-09-29 (analysis `analise-uso-real.md`, item A30, 6(e)):
`dev-board-engine`, seq 1157/1230/1268/1344/1486 — five turns reading interfaces
in other modules' worktrees. Against the AT-237 measurement
([medicao-do-jev.md](../explanation/medicao-do-jev.md)), this agent had 24 steps
with a tool in the whole round: **5 of 24, ~21% of its steps**, went into
discovering someone else's interface. The project had seven dev modules
(`piece-catalog`, `retro-renderer`, `input-keyboard`, `game-session`,
`scoring`, `persistence`, `board-engine`).

**What could NOT be measured here:** the token cost of those five steps. The
29/09 event log lives in the maintainer's local instance (compose `brabo-dev`)
and is not in this environment; the number above comes from the analysis and from
the agents table of the Jev measurement, not from a redone query. The cost gain is
measurable later, by the same rule as AT-239 (`token_usage` per actor).

### What the product gave the dev (measured on `dev`, 2026-10-01)

- **The `module_map`** (`domain/architecture/module-graph.ts`) is
  `{name, stack, responsibility, dependsOn[]}`. It says WHO depends on whom and
  nothing about WHAT a module offers. None of the Arquiteto's artifacts
  (`module_map`, `project_image`, `module_routing`, `c4_diagram`) carries an
  interface.
- **The dev's context** (`Engine.Dev.ContextBuilder`) brings story, task,
  business rules and ADRs filtered by module — no neighbour interface.
- **The dev's tools** (`Engine.Dev.Tools`) were `read_file`,
  `search_workspace`, `write_file`, `terminal`, `rag_search`/`rag_feedback` and
  the termination ones: no project artifact reading. The only way to see the
  neighbour's interface was the `terminal` reading the other dev's worktree —
  code IN PROGRESS on a branch that has not yet reached `dev`, and that may
  change after the read.

## Decision

1. **The contract is the `artifact.module_contracts` artifact, the
   Arquiteto's.** No table: the event is the record, versioned by `version` in
   the payload, and the current one is the highest `version` with a tie broken by
   `seq` — the same reduction as `GetC4DiagramUseCase`/`GetModuleRoutingUseCase`.
   Each declaration carries the WHOLE list and REPLACES the previous one;
   changing a contract is a new version emitted by the Arquiteto, and the
   previous ones remain in the log.
2. **The format is the smallest that solves it: per module, only what it
   EXPOSES.** `{modulo, expoe: [{tipo, assinatura, descricao}]}`, with `tipo` in
   `funcao | rota | evento | dado`, mandatory `assinatura` (up to 300
   characters), optional `descricao`, and from 1 to 40 items per module.
   - **What it CONSUMES is not written in the contract.** It is derived, at read
     time, from the current `module_map`'s `dependsOn` — the same argument as the
     C4 Container level (ADR 0068): the map already validated those edges as
     acyclic, and a second hand-written list would diverge from it at the first
     revised map. The granularity "which items of X module Y uses" was left out:
     the Arquiteto does not know it before implementation, and whoever consumes X
     reads the whole list of what X exposes.
   - **`tipo` is an enum and `assinatura` is free text.** The type is what
     changes how the item is USED; the signature does not fit a single schema
     because each module's stack is free (an Elixir function and a Go route).
   - **The ceilings exist because the contract goes into every dev's context.**
     A contract that becomes the whole API documentation would cost on every step
     what the worktree read cost on one.
3. **An artifact SEPARATE from the `module_map`, never one more field in it.**
   The map is a table, is read by the whole execution (task claim, routing, C4)
   and revising it reopens cycle validation. The contract changes at another pace
   — the interface is discovered while the devs work —, and revising one cannot
   re-emit the other nor fight over its schema with another front (the round-36
   resources lane adds a field to the `module_map`).
4. **The Arquiteto gains `declare_module_contracts`** (`:direct`, like
   `route_modules_to_infra`: an architecture declaration, with no external
   effect, never a `proposed_action`). The api validates and refuses with the
   whole reason, which goes back to the model (RN-061): a module outside the
   current map (listing the valid ones), no `module_map`, a repeated module,
   empty `expoe` or above the ceiling, unknown `tipo`, empty or too long
   `assinatura`. Its kickoff gains step 5; the tool enters
   `Engine.Harness.IdiomaDaResposta.ferramentas_de_artefato/0` (RN-623).
5. **The dev agent gains `listar_contratos_de_modulos`** (`:direct`, in the
   `Engine.Dev.Tools` registry, outside the global one). CONTAINED reading: scope
   closed to the project by the route's path
   (`GET internal/projects/:projectId/module-contracts`), NO parameter, and the
   dev's module comes from the loop context (`ctx.module`, set by
   `DevAgentServer`), never from the model. With the module known, it shows in
   full only its own and those it consumes; those that consume it and the rest
   appear by name. A ceiling of 120 items in the text, with what was left out
   stated. A contract of a module that left the map is STATED, never attributed.
6. **The dev's kickoff says the contract exists and where to read it**, and that
   another module's interface is not read in its worktree. Without a contract for
   the module it needs, the tool says what to do: implement from what the story
   and task say and, if the task depends on an interface that does not exist,
   `report_blocked` naming the module and what is missing — for the Arquiteto to
   declare. It does not tell it to reread the worktree.

## Consequences

- **The step the dev spent discovering interfaces becomes a constant-cost
  read**, and what it reads is the version the Arquiteto fixed, not another dev's
  in-progress code.
- **The interface now has an owner and a version.** Whoever changes it is the
  Arquiteto, in a new version; the dev that needs a change does not make it in the
  neighbour's code, it blocks naming what is missing.
- **It is not a lock.** Nothing prevents the `terminal` from reading another
  worktree: the tool and the kickoff change the path the dev knows, they do not
  forbid the other. Closing the reading of someone else's worktree would be path
  containment (ADR 0055), another front.
- **The Arquiteto gains a step** in the kickoff, under the SAME ceiling of 14
  iterations. Not measured whether it fits together with the other seven in a
  large architecture; exhausting the ceiling is still narrated
  (`toolloop.limit_reached`, RN-166).
- **Projects without a contract keep working**: the read returns the map with
  `expoe: null` on each module and the notice. No migration, no table.
- **The artifacts' `docs/` folder (ADR 0148) gains the type** as versioned: the
  current one overwrites the same file, like the other four.
- **Out of here, declared:** its own screen (the contract appears on the
  timeline and in the `docs/` folder, not on the Architecture tab); the effect on
  Jev's gain (AT-239 measures tool per step; this one changes the dev's menu, and
  `scripts/jev/catalogo.json` is the 29/09 snapshot, not regenerated here); the
  ExUnit tests ran outside `mix` (`repo.hex.pm` gives 403 in this environment) —
  CI proves them.

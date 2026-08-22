# 0081 — Container lifecycle: state table, no orchestrator

## Status

Accepted, **with the same kind of cut the [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)
already declared for this slice**: the table and the state machine exist;
what commands a real Docker container doesn't exist, and this document
doesn't decide how it will exist.

This ADR **revises [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)**,
closing the half its "What this ADR does NOT do" section declared —
"container state needs a table… this wave's single migration slot belongs
to another phase" — and touches the ground of
[ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md), which
remains accepted and is not edited by either of the two.

## Context

ADR 0065 delivered the half that didn't need a database: the Architect's
image decision (`artifact.project_image`, in the event log) and the gate it
opens for the Code tab (RN-105). It was explicit about what was missing:

> **Container lifecycle (25b).** Provisioning, stopping, recycling,
> cleanup; what happens when the image changes; what survives a restart;
> the agent's worktree moving to live inside the container.
>
> The reason is concrete and not a lack of design: **container state needs
> a table**. Container id, status, image in use, when it came up, which
> version of the artifact it corresponds to — none of that is an event,
> it's mutable state, and forcing it into the event log would be using the
> wrong tool because the right one was busy. This wave's single migration
> slot belongs to another phase.
>
> Delivering half a provisioning system would be worse than not delivering
> at all: **a container that comes up and never recycles is worse than
> none**.
> — ADR 0065

PROGRAM 28 reached the wave with the migration slot free for this table.
Before writing a line of code, one question had to be answered by
investigation, not assumption: **can any product service already command a
Docker container?**

The answer, verified line by line in `docker/docker-compose.yml`: no. No
service (`api`, `engine`, nor the dev-only ones) mounts
`/var/run/docker.sock`, and none runs `privileged: true`. This is not an
oversight to fix in passing — it's the absence of a real security decision,
and a real security decision doesn't get born as the side effect of a
table. Mounting the Docker socket into a container is a known escalation
vector to root on the host; granting that without the user explicitly
authorizing it, with the consequences on the table, would be the same
mistake ADR 0065 already recorded not making with network and resources:
"decided ONCE, not command by command" — and "decided once" presupposes
someone deciding, not an infrastructure ADR choosing out of convenience.

## Decision

### The table is the CONTRACT of an orchestrator that doesn't exist yet

`project_containers` (migration `0046`) records the mutable STATE of a
project's container: `status` (explicit state machine, below),
`image_version` (the version of `artifact.project_image` this row
corresponds to — never a copy of `image`/`rationale`/`network`, which
continue to live only in the event log), `container_id` (the real id in
the Docker daemon, always `NULL` until an orchestrator exists), the
DECLARED resource cap (`cpus`/`memory_mb`/`pids_limit`, mirroring
`RecursosDoContainer` from the artifact in effect at the moment the row
was born) and `failure_reason`.

One row per PROJECT (`project_id` unique) — the same design as
`dev_agent_states` in the engine (ADR 0045): only one container is current
at a time, and reprovisioning after removal reuses the same row instead of
accumulating history in it. Immutable history already has a place — the
event log — and this table doesn't try to be both things.

### The state machine

`provisioning → running ⇄ stopped`, with `failed` reachable from
`provisioning`/`running`/`stopped` and `removed` as the only state you can
only leave by reprovisioning (`removed → provisioning`). No state is truly
terminal: even `removed` allows coming up again, because a project may
reprovision with an image revised by the Architect. Validated in
`apps/api/src/domain/containers/container-lifecycle.ts`, in the SAME
format as `session-state-machine.ts` and `pr-gate-state-machine.ts` —
allowed-transition table, pure function, typed error
(`InvalidContainerTransitionError`) that the use case translates into 409.

The FIRST transition is special: no row exists until the first call with
`to: 'provisioning'`, and it's only accepted if the Architect has already
decided the image (RN-105) — the same gate that already protects the Code
tab, applied here at the source instead of duplicated. The version and
resources of the decision in effect at that instant are FROZEN into the
new row; a later revision of the artifact doesn't retroactively change what
an already-provisioned instance promises — reprovisioning is what reads the
artifact again.

### No Docker call — in either of the two use cases

`RegistrarTransicaoDeContainerUseCase` and
`ObterCicloDeVidaDoContainerUseCase` do exactly what their names say: they
write and read. Neither invokes `docker run`, `docker stop`, the Docker
Engine API, or any Docker client — there is no Docker client in the
product's code. A real orchestrator, when it exists, is what CONSUMES this
table: it acts against the daemon first, and only then calls
`RegistrarTransicaoDeContainerUseCase` to record what happened — never the
other way around, for the same reason `TransitionSessionUseCase.activate`
calls the engine BEFORE writing `active`: the table must not say something
is running when it isn't.

### Coherence with workspace mode (ADR 0072)

A project with `workspace_mode: 'local'` does not spin up a container — it
runs in the AGENT's usual container, only the folder changed (RN-169).
Requesting a transition for a `local` project is rejected with 400 before
touching the table: coherence isn't "the table allows any state for any
project and the UI filters afterward," it's the use case refusing at the
source.

### No new HTTP route

Nothing in Wave 4 consumes this table over HTTP yet — the interactive
terminal (25b/Wave 5) is the obvious candidate, and deciding the route's
shape before knowing exactly what it needs to read would be guessing a
contract. Both use cases are exposed to the containers module, ready for a
route when there's a real consumer.

## Consequences

**What comes to exist.** A single, tested place to answer "what state is
this project's container in" and to record a validated transition —
a prerequisite for ANY future orchestrator, without which it would have to
invent its own state storage or reopen this decision.

**What stays exactly as it was — without softening.** The "inside, the
agent is free" half of terminal policy, which ADR 0065 already said hadn't
changed, CONTINUES not having changed. ADR 0055 (path scope, narrow
allowlist) remains valid word for word. A `running` container in this table
doesn't change what the terminal allows to execute, because no terminal
command today is routed into a container managed by it — the table and
command execution are two systems that still don't touch. Findings Z and
AD (verb allowlist doesn't converge) remain open for the usual reason:
closing them requires the physical wall (a real orchestrator isolating
execution), not a table describing the intent of a wall.

**What stays declared, not hidden.** No process today transitions this
table on its own — every transition is, for now, external (a test, or a
manual call). This is expected: the table is born before its consumer, not
after. The day a real orchestrator is designed — restricted-privilege
sidecar, separate daemon, or another shape — is its own security decision,
with the user informed of what's being granted, exactly as ADR 0065 already
requires for network and resources. This document does not anticipate or
shortcut it.

## Alternatives considered

**Mounting `/var/run/docker.sock` in the api or the engine to "actually
make it work" already in this slice.** Rejected with the most direct
argument there is: it's a security decision (a known escalation vector to
root on the host) nobody asked for in this slice, and making it in passing
to make a table "look complete" is exactly the mistake PHASE 13 already
named — it's not loosening a verb allowlist, but it's the same class of
shortcut: gaining functionality by trading a guarantee for convenience.

**Not creating the table now, waiting for the orchestrator to be
designed.** Rejected for the reason ADR 0065 itself already gave: the
migration slot is scarce (one per wave) and the table is a prerequisite,
not an accessory, for any orchestrator design — designing it without
somewhere to write state would produce the same table later, under
pressure from a real consumer waiting.

**Storing state as a second event type in the event log
(`container.status_changed`), instead of a table.** Rejected by the same
argument that distinguishes it from `artifact.project_image`: this is
STATE (one value at a time), not historical FACT. Projecting "the current
state" from events on every read would reimplement a table on top of the
event log, paying the indirection cost without gaining anything — the same
conclusion ADR 0065's "Alternatives considered" already recorded when it
deferred this table.

## References

- [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md) —
  the image decision and the gate this document doesn't repeat, only references.
- [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md) — the terminal
  policy that CONTINUES to hold exactly as it is; no line changes here.
- [ADR 0072](0072-projeto-local-ou-container.md) — `workspace_mode`, which
  decides whether a project has a container lifecycle or not.
- [ADR 0045](0045-reagendamento-por-evento-do-dev-agent.md) — the persisted
  state machine (`dev_agent_states`) whose design (one row per agent,
  `status` validated outside the column) this table mirrors for containers.
- [RN-105](../business-rules.md#rn-105), [RN-169](../business-rules.md#rn-169),
  [RN-243](../business-rules.md#rn-243)–[RN-248](../business-rules.md#rn-248).
- `docs/explanation/achados-execucao-real.md` — findings Z and AD, which
  this document explicitly does NOT close.
- `apps/api/src/domain/containers/container-lifecycle.ts`,
  `apps/api/src/application/use-cases/containers/registrar-transicao-de-container.use-case.ts`,
  `apps/api/src/application/use-cases/containers/obter-ciclo-de-vida-do-container.use-case.ts`,
  `apps/api/src/db/migrations/0046_chilly_forgotten_one.sql`.

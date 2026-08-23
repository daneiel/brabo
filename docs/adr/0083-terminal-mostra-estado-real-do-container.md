# 0083 — The Terminal tab gets the real consumer of the lifecycle, not the terminal

## Status

Accepted. Revises the "No new HTTP route" section of
[ADR 0081](0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md), which
deliberately deferred that route until a real consumer existed. It does not
revise — and cannot revise — [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)
nor PHASE 25b (CLAUDE.md), which continue to declare the interactive
terminal cut: this document does not raise the container's physical wall,
it only reads the state recorded from outside it.

## Context

This front's original plan (PROGRAM 28, Wave 5, front F2) was "interactive
terminal," assuming that by this point the per-project container would
already have a real lifecycle — real provisioning, with the agent's
worktree living inside the container. That didn't happen. Wave 4/front F1
(ADR 0081) delivered `project_containers` — a state TABLE
(`provisioning/running/stopped/failed/removed`) and two use cases that
write and read that table — but no real Docker calls: no service mounts
`/var/run/docker.sock`, none runs `privileged`, and
`RegistrarTransicaoDeContainerUseCase` has no caller outside its own
tests. There is no real container running to open a terminal INSIDE it.

Implementing a terminal that fakes executing commands, or that executes in
the SAME container as Brabo's monorepo — the debt ADR 0055 already
describes as policy, not isolation —, would invent a capability that
doesn't exist. It's the same mistake ADRs 0041/0042 already refuse for an
unproven LLM provider and an uncurated catalog model: a capability is only
declared once it's proven.

ADR 0081 had already named this front as the missing consumer:

> Nothing in Wave 4 consumes this table over HTTP yet — the interactive
> terminal (25b/Wave 5) is the obvious candidate, and deciding the route's
> shape before knowing exactly what it needs to read would be guessing a
> contract.
> — ADR 0081

## Decision

**The Terminal tab does not get a terminal.** It gets the real consumer
ADR 0081 was waiting for: `GET /projects/:projectId/container/lifecycle`
(RN-267), a read-only route, `role:viewer`, that mirrors
`ObterCicloDeVidaDoContainerUseCase` without adding logic — `null` when the
project was never provisioned (the common case today, since nothing in
production transitions the table) or the recorded state
(`status`/`imageVersion`/`resources`/`failureReason`/`statusChangedAt`).

Beneath the explanatory text that already existed in `CodeBottomPanel.tsx`
since PHASE 26b ("the interactive terminal doesn't exist yet — PHASE 25b"),
the tab now shows this state with a `Badge` translated to pt-BR and the
failure reason when there is one. The fetch only happens while the Terminal
tab is open (`enabled: aba === 'terminal'`), with no background polling —
the same traffic discipline RN-107 already applies to the image gate.

PHASE 25b's explanatory text is **neither removed nor weakened**: the
lifecycle state is additional information, not a replacement for the
explanation of why the terminal itself doesn't exist. A project able to
show `running` doesn't mean anything is executable there — it only means
someone (today, a test or a manual call) recorded that transition in the
table.

## Consequences

**What comes to exist.** The first HTTP exposure of the container
lifecycle, and the first product screen that reads `project_containers` —
before this, the table was only visible to whoever queried the database or
the tests directly.

**What stays exactly as it was.** The interactive terminal. PHASE 25b
remains cut and declared — no line of this ADR raises an orchestrator,
mounts a Docker socket, or routes a terminal command into a container.
Findings Z and AD (verb allowlist doesn't converge) remain open for the
same reason as ADR 0081: closing them requires the physical wall, not a
screen that reads a state table.

**What stays honest by construction.** Since nothing in production today
transitions `project_containers`, the route's most common response is
`null`, and the tab shows this literally ("not yet provisioned") instead
of inventing a status. The day a real orchestrator exists and starts
genuinely transitioning the table, this same screen starts reflecting that
state without needing to change — it already reads what the table says,
never what we'd wish it said.

## References

- [ADR 0081](0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md) —
  the table and the two use cases this document finally exposes over HTTP.
- [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md) —
  PHASE 25b, which remains cut; this document does not reopen it.
- [RN-105](../business-rules.md#rn-105), [RN-107](../business-rules.md#rn-107),
  [RN-243](../business-rules.md#rn-243), [RN-267](../business-rules.md#rn-267),
  [RN-268](../business-rules.md#rn-268).
- `apps/api/src/interfaces/http/containers/containers.controller.ts`,
  `apps/web/src/routes/code/CodeBottomPanel.tsx`.

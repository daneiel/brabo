---
traducao_de: 11b49cb725b01688a29cfae832f7256c9b1b7da5
---

# ADR 0136 — Global containers page: a per-load ceiling on the broker, and `container_remove` under the absolute ceiling

## Context

ADR 0130 (container broker) declared the five operations of the `DockerPort` —
`start`/`stop`/`remove`/`inspect`/`exec` — and an explicit comment in
`ContainerBrokerPort`: *"`stop`/`remove` still have no caller: they are
EXTERNAL EFFECTS and do not happen without their own `proposed_action`, which
does not exist yet."* ADR 0133/0134 (PRs 1.5/1.6) wired `start`/`exec`; this PR
(1.8, the last of Part 1 of the "Execution in a real container" plan) closes the
remaining gap, and delivers the screen that the comment on the
`ContainersController` controller (per-project `lifecycle` route) already
pointed to: *"the global page that consumes it is another PR."*

Two concrete architectural decisions came up while designing that screen, and
neither had a ready answer in the previous ADRs:

1. The screen is CROSS-PROJECT — one row per workspace project that already has
   `project_containers`. The RECORDED state aggregates at no cost (it is a
   database read, same mold as `ProjectsSummaryRepository`), but the OBSERVED
   one — asking the broker for the current state, ADR 0130 — is a NETWORK call
   per project. Asking ALL of them without a ceiling would violate the
   CLAUDE.md rule: *"a composite read that calls the provider N times has a
   budget and a cache, otherwise it becomes a traffic amplifier"* (ADR 0060).
2. `container_remove` is qualitatively different from `container_start`/
   `container_stop`: it discards the container and forces reprovisioning from
   scratch. The original plan did not specify the exact caliber — only that the
   three actions are born as `proposed_action`.

## Decision

### The ceiling on broker calls is by TWO rules, not one

`ObterVisaoGeralDeContainersUseCase` only asks the broker (via
`ObterEstadoObservadoDoContainerUseCase`, already existing) for rows whose
RECORDED state is `provisioning`/`running` — a `stopped`/`failed`/`removed`
container needs no confirmation from the daemon for the screen to make sense,
and excluding them from the question is free (it is not the ceiling that
protects them, it is eligibility). Among the eligible ones, at most
`TETO_DE_VERIFICACOES_POR_CARGA` (20, a revisable NUMBER, not "all") are asked
per load, in PARALLEL (`Promise.all`, never serially — chaining would multiply
latency by the ceiling for nothing).

Whatever falls outside either rule carries its OWN field, `naoVerificado`
(`fora_do_escopo_da_verificacao` | `teto_de_verificacoes_atingido`) — never
confused with `naoObservado`
(`broker-nao-configurado`/`broker-sem-resposta`/`broker-recusou`, which already
existed and means "the broker WAS asked and refused/did not answer"). A row
outside the ceiling has all three observation fields (`observado`/
`naoObservado`/`detalheDaObservacao`) `null` — the screen never invents an
answer the broker did not give.

Why 20: today (PHASE 25b) no automatic provisioning exists — a container only
comes up through a manually approved `container_start` — so the number of
simultaneous `provisioning`/`running` containers tends to be small. 20 is a
generous margin for the present, not a tight cut measured against real volume;
revising the number is one line, not a migration.

### The RECORDED state aggregates in THREE constant queries, never one per project

`ContainersOverviewRepository`/`DrizzleContainersOverviewRepository` follows the
SAME mold as `ProjectsSummaryRepository` (RN-090): the first query joins
`projects` with `project_containers` (INNER JOIN — only those that already HAVE
a row enter, which is the screen's rule), the second fetches in batch the
`artifact.project_image` events of the projects found (to resolve the image text
of each FROZEN `imageVersion` — not the current one, which may have been revised
after the container was born; `decisaoNaVersao`,
`domain/containers/project-container.ts`, extracted from
`ObterContainerDoProjetoUseCase` so as not to duplicate the validation/degrade
logic), and the third fetches in batch the pending container `proposed_actions`
of the same projects — which lets the screen swap the three action buttons for
the inline `ApprovalCard` without a fourth query per project. A test
(`containers-overview.repository.spec.ts`, same design as the
`ProjectsSummaryRepository` one) proves the number of queries is EQUAL with 2
and with 20 projects.

### `container_remove` enters the absolute ceiling of `decide.ts`; `container_stop` follows the caliber of `container_start`

`container_start` (RN-491) and `container_stop` (RN-495) are `maintainer`,
`require_approval` by default, and CAN be configured `auto_approve` — no
decision is irreversible without reprovisioning: stopping a registered
`running` container is a state one comes back from (`stopped -> running`).
`container_remove` is different: it discards the container, and the state
machine (`container-lifecycle.ts`) only leaves `removed` by PROVISIONING AGAIN
— never "coming back to life". That is why `container_remove` enters the SAME
absolute ceiling of `decide.ts` that already covers git push/privileged command
(RN-418/ADR 0102): unconditional `require_approval`, even with "automatic mode"
on, even with `permissions.json` configured — `ApproveAlwaysActionUseCase`
refuses (400) to write the "always allow" pattern for it, closing the gap at
the SOURCE, same mechanism as RN-418.

`ContainerBrokerPort.remove` already was (since ADR 0128/0130, implemented in
`packages/docker-port`) `docker rm --force` — it removes even a `running`
container, in a single call. The state machine did NOT gain a
`running -> removed` shortcut: `ExecuteContainerRemoveUseCase` records BOTH hops
(`stopped`, then `removed`) when the recorded state still said `running`,
reflecting what actually happened on the Docker side without widening the state
machine by a route that would only exist for this use case.

### "Bring it up again" REUSES `container_start` — it is not a fourth type

Investigated and confirmed: `ExecuteContainerStartUseCase` already handles the
complete dance from ANY state — `provisioning`/`running` (idempotent),
`stopped` (jumps straight to `running`, without reprovisioning) and
`failed`/`removed`/no row (reprovisions from scratch) — because it already
exists to serve Infra's election (RN-491), which can also happen after the
container has fallen. The screen (`ContainersPage.tsx`) builds the
`container_start` payload from the project's CURRENT DECISION
(`GET .../container`, the same route the Code tab reads) — image, network,
resources — instead of inventing a new form; if the Arquiteto/Infra has not yet
decided (it should not happen for a row that already exists, but the read
degrades instead of assuming), the click fails with a named message, never
proposes an empty payload. No backend change was necessary for this third
button.

## Consequences

**The `/containers` page is the first cross-project read that combines the
database (without N+1) with an external provider under budget (with an explicit
ceiling).** The pattern — eligibility first, ceiling after, an OWN absence
reason never confused with the provider's reason — becomes available for the
next composite read that needs the same discipline.

**`stop`/`remove` of the five operations of ADR 0128/0130 now have a real
caller.** Of the five, only `inspect` (read, without `proposed_action`) remains
as it was; `start`/`stop`/`exec` already had a caller before this PR.
`container-lifecycle.ts` had a docblock stating "no product service mounts
`/var/run/docker.sock`" — false since ADR 0130 and even more false now; fixed
in this PR, the same file it was already editing for another reason.

**The ceiling of 20 is a NUMBER, not a measurement.** There is no production
data about how many containers stay `provisioning`/`running` simultaneously —
PHASE 25b never had automatic provisioning. If the volume grows, the number is
revised; it needs no other architectural decision to change, only measurement
that does not exist today (same rule declared for the RAG hybrid search
weights, ADR 0080).

**`container_remove` is never auto-approvable, anywhere, forever — while this
decision holds.** This is deliberate: the only way to revert it would be another
explicit architectural decision, not a configuration.

**Alternative considered and discarded: widening `container-lifecycle.ts` with
a direct `running -> removed` transition.** It would model what the broker DOES
(remove forces), but would confuse what the state machine MODELS (the product's
observable state) with what Docker allows as a mechanical shortcut — the machine
would remain right about "what the api knows happened", and
`ExecuteContainerRemoveUseCase` already solves this by recording both hops
without touching the domain shared by the whole rest of the system (including
`container_start`, which depends on the same machine).

**Alternative considered and discarded: a ceiling on broker calls based on
cache/TTL instead of per-load counting.** A cache would reduce calls on quick
successive loads, but would introduce a window in which the observed state can
be stale WITHOUT the screen knowing — which RN-468 forbids (an environment
signal says what it KNOWS, never fakes freshness it does not have). The per-load
ceiling is simpler and more honest: each load says exactly what it asked.

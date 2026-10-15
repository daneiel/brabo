---
traducao_de: d86b3b6a2e74a54732e147d1e0c053ca5feedc39
---

# ADR 0133 — Infra elects among the routing's candidates, and the election becomes a new version of `artifact.project_image`

## Context

ADR 0131 opened the missing half of module routing: the Arquiteto (Architect)
NOMINATES one image per module (`route_modules_to_infra`, recorded in
`artifact.module_routing`) and declared, in so many words, that "the half that
ELECTS (the Infra Lead reading this list and deciding, with its own
`proposed_action`) is a separate PR". This is that PR.

ADR 0130 (container broker) also left a dangling sentence, in the
`ContainerBrokerPort`'s own comment: "Bringing up, stopping and removing are
EXTERNAL EFFECTS and do not happen without a `proposed_action`; whoever will
propose is the Infra Lead, with the user's final authority, and that is another
PR." This one too.

The question both ADRs left open, and which only appears when one tries to
CONNECT the two wires, is: the broker does not accept a specification — it
reads `GET /internal/projects/:projectId/container-spec`
(`ObterSpecDeContainerUseCase`), which in turn reads the Arquiteto's current
decision in **`artifact.project_image`** (RN-105,
`DecidirImagemDoProjetoUseCase`, ADR 0065). It does NOT read
`artifact.module_routing`. So: if Infra elects a routing candidate and that
does not become a new version of `artifact.project_image`, the election is
auditable in the event log and **inert** — the container that comes up remains
the one `choose_project_image` decided, which may not even exist yet, or may be
a completely different image from the elected one.

## Decision

**Infra's election emits a NEW VERSION of `artifact.project_image`, reusing
`DecidirImagemDoProjetoUseCase` whole — not a parallel path.**

This means: `artifact.project_image` stops being emitted only by the Arquiteto
(`choose_project_image`). It now has TWO possible emitters — the Arquiteto,
deciding from scratch, and Infra, ELECTING among the routing candidates the
Arquiteto itself produced — and each event's `decidedBy` says which one it was
(`'arquiteto'` vs. `'infra-lead'`, since `DecidirImagemDoProjetoUseCase.execute`
already accepted that parameter, just never used with another value). The
comment in the code of `project-container.ts` that calls the image an
"ARTEFATO DO ARQUITETO" remains true in the sense that matters — it is an
architecture decision, versioned, auditable, never hidden configuration — but
stops being true in the sense of "only the Arquiteto writes to it". CLAUDE.md
(Conventions section) is updated to declare this.

**Why reuse `DecidirImagemDoProjetoUseCase` instead of a parallel path that
writes `artifact.project_image` directly:**

1. **Same validation, only once.** `validarDecisaoDeImagem` (explicit
   tag/digest, `latest` refused, minimum `rationale`, `RECURSOS_MAXIMOS`
   ceiling) is already the single source of that rule — reimplementing it on
   Infra's path would create the SAME divergence the comment in
   `module-routing.ts` already recorded when it decided to reuse that function
   instead of rewriting it per module. Same reasoning, one layer up.
2. **One current, not two.** `ObterContainerDoProjetoUseCase` reads "the
   highest-numbered version" of `artifact.project_image` — if Infra's election
   wrote another event type, or its own table, the product would have TWO
   possible answers to "which image does this project run", and every existing
   consumer (`RegistrarTransicaoDeContainerUseCase`, the RN-105 gate of the
   Code tab, the broker via `ObterSpecDeContainerUseCase`) would need to learn
   to choose between them. Reusing the same artifact is what preserves "one
   current" without requiring anyone to change.
3. **The trail already exists.** `rationale` is a free field — the election
   writes in it that the image was ELECTED among the routing candidates (citing
   the `porque` Infra gave), so whoever reads the history of
   `artifact.project_image` months later does not see an image appearing out of
   nowhere: they see the chain — the Arquiteto nominated, Infra elected, with
   each side's reason.

**The elected image MUST be one of the `imagemCandidata` of the current
`artifact.module_routing` — never invented.** `ExecuteContainerStartUseCase`
validates this BEFORE calling `DecidirImagemDoProjetoUseCase`: if Infra
proposes an image outside the list, the action fails with a message naming the
refused image and the valid candidates — the same explanatory-refusal mechanism
`validarRoteamento`/`validarDecisaoDeImagem` already use (RN-061: the whole
reason goes back to whoever decides to correct). Without a current routing
(`status: 'sem_roteamento'`), there is no candidate at all and every election
is refused — the Arquiteto needs to run `route_modules_to_infra` first.

**The tension made explicit, not hidden:** the Arquiteto remains the one who
PROPOSES (via `choose_project_image` OR via `route_modules_to_infra`); Infra
can now emit a new version of the SAME artifact when it ELECTS. It is not
"Infra decides the image from scratch" — it is "Infra chooses which of the
Arquiteto's proposals becomes reality", and the write reflects that:
`decidedBy: 'infra-lead'` and a `rationale` that cites the originating
nomination, never a `rationale` invented from scratch as if it were a new
decision.

**`container_start` is a new `proposed_action`, with the user's final
authority — never auto-approvable by default.** Unlike `open_infra_pr` (which
the Infra Lead can auto-approve for itself, because it only opens a PR a human
still merges), bringing up the container is a real external effect — it calls
the broker, which talks to the server's Docker daemon (ADR 0130). It stays
`require_approval` by default (`MIN_ROLE_FOR_ACTION_TYPE: maintainer`, same
caliber as `open_infra_pr`/`parallelize`), and does NOT enter the autonomy list
seeded by the Infra Lead's `accept-handoff` — a deliberate decision, not
forgetfulness.

**`container_start` stays OUT of the absolute-ceilings block of `decide.ts`**
(merge into a protected branch, `instruction_patch`, `parallelize`/
`raise_max_parallel`) — same reasoning already recorded there for
`propose_execution_plan`/`assess_implementability`: it is the FIRST time this
project's container actually comes up for this election, not an overrun of an
already authorized ceiling. A `maintainer` CAN configure `permissions.json` to
auto-approve `container_start`, if they decide they want that level of
automation — the product does not force that door shut, just as it does not
for `open_infra_pr`.

## Consequences

**The RN-105 gate does not change.** The Code tab stays closed until
`artifact.project_image` has a decision — only now that decision may have come
from two places. No existing consumer of `ObterContainerDoProjetoUseCase`
needed to change.

**`container_start` is the FIRST real caller of `ContainerBrokerPort.start`.**
Of the five operations of ADR 0128/0130, `inspect` already had a caller (read,
the lifecycle route); `start` gets its own here. `stop`, `remove` and `exec`
still have no `proposed_action` at all — it is not a gap fixed entirely, it is
one slice of the PHASE 25b cut closing.

**Dev agents do NOT YET work inside the container that comes up.** Bringing up
the container and moving the dev agent's worktree into it are different things
— the second is a separate PR (1.6). This PR proves that the path
proposed_action → approval → broker → `project_containers` works end to end;
what runs inside the container, for now, is only what the broker brings up (the
elected image, mounting the project folder) — with no consumer yet.

**`RegistrarTransicaoDeContainerUseCase` gets its first real caller outside
tests.** The state machine already existed (ADR 0081); the novelty is that now
something other than a test actually triggers `provisioning`/`running`, after
the broker confirms. The transition to `provisioning` is only possible when
there is no row yet, or the row is in `failed`/`removed` — from `stopped`, the
correct transition is directly to `running` (the ADR 0081 state machine does
not allow `stopped -> provisioning`, and recreating the row from scratch for a
container that was only stopped would destroy the `imageVersion` history
needlessly).

**Alternative considered and discarded: a new event
(`artifact.container_election`, or similar) separate from
`artifact.project_image`.** It would preserve a cleaner separation between "the
Arquiteto proposes" and "Infra decides", but would create exactly the problem
the Decision avoids: two artifacts competing to be "this project's current
image", and every consumer (broker via `ObterSpecDeContainerUseCase`,
`RegistrarTransicaoDeContainerUseCase`, the RN-105 gate) needing to know how to
choose between them. Discarded because the cost of keeping two currents in sync
outweighs the value of a "purer" separation between the two roles — BOTH roles
still exist (Arquiteto proposes, Infra elects), only the output artifact is a
single one.

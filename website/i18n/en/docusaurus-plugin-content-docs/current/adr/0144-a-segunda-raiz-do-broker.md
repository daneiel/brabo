---
traducao_de: 2245f20165791640b2229d908c179ea2f0925828
---

# 0144 — The broker's second root, and the discriminated locator that chooses it

## Context

The broker (ADR 0130) is the only product process that talks to a Docker daemon
on the server, and the thing that makes it contained is a single one: **it does
not accept a container specification**. It receives a `projectId` and one of the
five operations, goes to the api to READ the Arquiteto's (Architect's) decision
and COMPOSES the image, network, resources and the single mount itself. No path
crosses the network — the api sent `workspaceDirName` and the broker
concatenated it with ITS root (`PROJECT_WORKSPACES_HOST_ROOT`).

That shape had one root because there was only one place where a project folder
could be from the server's point of view: `/data/project-workspaces`, the folder
MANAGED by the product, of the `container` mode. `mounted` and `runner` projects
were left out, and the broker refused both at the source with
`ModoDeExecucaoNaoSuportadoError`.

ADR 0141 changed the fact of the world that sustained half of that refusal.
Every project in the Mounted folder mode now lives under **one** base
(`BRABO_PROJECTS_BASE`), mounted by identity in `api` and `engine`, and
therefore reachable by the server's daemon. The broker's refusal was about
GEOMETRY — "its code is on a machine I do not see" —, and the geometry of
`mounted` stopped being that. That of `runner` did not change at all.

This opens a question the single-root shape cannot answer: given a segment,
**against which root does it apply?**

The obvious temptation is for the api to send the absolute path and the broker
to mount it. That would undo ADR 0130 entirely: the containment of a
root-equivalent process on the host would again depend on the CALLER being
correct, which is the definition of there being no containment. The second
temptation is for the broker to guess — use the base when the mode is
`mounted`. That works until the day there is a third place, and until then it
hides the decision in an `if` over an enum the broker does not own.

## Decision

**The broker gains a SECOND root, `BRABO_PROJECTS_HOST_BASE`, and the api now
sends a DISCRIMINATED locator that says against which of the two the segment
applies.**

```ts
localizacao:
  | { tipo: 'gerenciada';   segmento: string }  // PROJECT_WORKSPACES_HOST_ROOT
  | { tipo: 'montada';      segmento: string }  // BRABO_PROJECTS_HOST_BASE
  | { tipo: 'indisponivel'; motivo: string }    // nenhuma raiz alcança
```

The invariant stays exactly where it was. What crosses the network is still only
the half the broker's root does not cover; the api does NOT know where those
roots are on the host, and the broker knows nothing about the project. Neither
side alone can write an arbitrary path — what changed is that the api now says
WHICH root, instead of there being only one and the answer being implicit.

**Two variables and not one, and no inheritance between them.** The managed
root is named by `workspace_dir_name` (UNIQUE) and the base is named by the
user. The same name points to different folders in the two, and nothing in the
schema prevents the collision — it is the first reason ADR 0141 refused to
conflate `BRABO_PROJECTS_BASE` with `PROJECT_WORKSPACES_HOST_DIR`, and it holds
identically here. That is why `BaseDeProjetosNaoConfiguradaError` is its OWN
class, in the same mold as `RaizDeWorkspacesNaoConfiguradaError`: origin
`infra`, message naming the variable, no container touched. Falling back to the
other root by omission would mount ANOTHER project's folder, and the container
would come up — with the wrong code inside, with nothing indicating why.

**Three variants and not two.** `indisponivel` is not a disguised `null`: it is
the state in which no root of THIS server reaches the folder, and it has two
different fixes. A `runner` project (the folder is on the user's machine — the
fix is the `brabo-runner`, on that side) and a LEGACY `mounted` project created
before the base (the fix is to move the folder). A `null` would send whoever
operates to the wrong place half the time. A folder that IS the base itself
falls here too, instead of becoming an empty segment: `<raiz>/` would mount the
whole base — the folder of all mounted projects — inside a single one's
container.

**The list of modes the broker serves is an ALLOW list**, not a deny list
(`container`, `mounted`). A new mode in the api's enum is born refused, with a
message, instead of being born silently accepted and falling into a composition
with no root that resolves it.

**Three barriers over the concatenation, not one.** The api refuses what is not
under the base (`segmentoSobABaseDeProjetos`); `packages/docker-port` refuses
the segment that is not relative (`segmentoDeProjetoValidado`: `..`, absolute,
empty, double slash, NUL); and the result of `raiz + segmento` still goes
through `raizDeProjetoValidada` before becoming `-v`, as it always did.
Validating the segment and not validating the concatenation would be trusting
string arithmetic — and the validation on the broker side exists precisely
because it cannot presuppose that the api is correct.

**Consequence on the api side: the branching of `container_start` becomes by
DESTINATION.** `container` and `mounted` go to the broker; only `runner` goes to
the runner. And `container_stop`/`container_remove` change together,
necessarily: bringing up on the server and asking to stop on the user's machine
would leave standing, with no way to stop it, what is standing.

**`mounted` ELECTS the image, like `container`.** It is not symmetry: it is the
only design that works on this side. The broker composes from
`artifact.project_image`, going to FETCH it from the api — an Infra election
that was not recorded in that artifact would be inert, and the container would
come up with the Arquiteto's image while the payload approved by the human would
say something else. It is literally the argument of ADR 0133, applied to a
second mode. The runner path can read the current one because there the api
SENDS the spec fields through the channel; the artifact is not the source the
other side queries.

## Consequences

The Mounted folder mode no longer requires a connected `brabo-runner` to have a
container. It was that requirement that made incoherent the sequence the product
owner's plan asks for — choosing `mounted` at creation, and the container coming
up before the dev agents.

**`runner` is left alone on the runner path**, and that is the design, not a
leftover: the broker (and the server) still do not see its folder. `container`
remains the only mode that brings up a container on the server **without**
depending on a base configured by the operator; `mounted` brings it up on the
server when the base is there.

**Declared cost 1: an installation can have one root and not the other.** That
is a legitimate state, and each operation says which one is missing instead of
both falling into a generic refusal. The price is two error classes where there
could be one with a parameter — accepted, because whoever reads the error is
whoever needs to know WHICH variable to set.

**Declared cost 2: the broker now knows a second segment format.**
`gerenciada` is a name without `/`; `montada` is a relative path, which may have
levels. `nomeDeWorkspaceValidado` (which serves the container's NAME and refuses
`/` on purpose) stops serving to validate a path, and
`segmentoDeProjetoValidado` is born next to it. They are two questions that came
to have different answers — "what is the container called" and "where is the
folder" — and having them with a single function was what worked while they
coincided.

**What this ADR does NOT decide.** It materializes no folder at all (that is the
deferred validation, neighboring PR). It does not change the image gate — RN-105
already applies to all three modes since RN-494/ADR 0135. It does not change who
PROPOSES `container_start`: the Infra Lead can still propose it for a project
without a connected runner and without a decided image, the gap declared since
RN-494. It does not change the count of broker operations: they remain **five**,
and a sixth remains a product decision with an ADR. And it does not publish the
broker image on GHCR — the four of ADR 0119 remain four.

References [0130](0130-broker-de-container.md) (the broker composes the spec),
[0133](0133-infra-elege-imagem-do-roteamento.md) (the election must be recorded
to have effect), [0137](0137-o-runner-sobe-o-container-do-projeto.md) (the other
execution path) and [0141](0141-base-unica-dos-projetos-montados.md) (the base
that made this possible). None of them is edited.

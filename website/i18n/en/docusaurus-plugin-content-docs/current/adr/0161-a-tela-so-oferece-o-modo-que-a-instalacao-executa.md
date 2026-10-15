---
traducao_de: 9624de8abe26503310142e39c49058bc36338c6d
---

# ADR 0161 — The screen only offers the mode the installation executes, and the Release installation has no broker

## Status

**Accepted.** Decided by the maintainer on 2026-09-18 (AT-085), with the answer
"both" to the question "does the installer turn on the broker, or does the
screen stop offering what does not run?". It revises the preselection of
[RN-513](../business-rules.md#rn-513)
([ADR 0146](0146-base-consentida-no-bootstrap.md), point 4) and adds a local
refusal reason to [RN-521](../business-rules.md#rn-521). Neither is edited; this
document references them. **Only the SCREEN half was delivered** — the installer
half was measured and stopped, for the reason in the section "The half that
stopped".

## Context

A real installation of v6.1.0, done through the one-liner on 2026-09-14, created
a project in `mounted` through the web. It was the **preselected** mode:
`install.sh` always writes `BRABO_PROJECTS_BASE` (the consented base,
[RN-531](../business-rules.md#rn-531)), and with a known base
[RN-513](../business-rules.md#rn-513) preselects `mounted`. What followed in the
event log:

- 6× `dev.started` → 6× `dev.blocked_by_container`;
- 2× `container.start_failed` with *"BROKER_URL não está definida — o broker de
  container não faz parte desta instalação…"*.

Nobody works on that project, ever. `container` and `mounted` only bring up a
container through the BROKER ([ADR 0144](0144-a-segunda-raiz-do-broker.md)), and
without a `running` container no dev agent command runs
([ADR 0143](0143-agentes-de-dev-so-depois-do-container.md)). Only `runner` does
not depend on it: whoever brings up the container is the local agent, on the
user's machine ([ADR 0137](0137-o-runner-sobe-o-container-do-projeto.md)). And
the `/containers` page let two `container_start` that could only fail be
approved.

**Measured, and different from the activity's description:** the installation
compose did not "inherit the broker under a disabled profile". The `broker`
service **does not exist** in `docker/docker-compose.install.yml` — its header
says so at point 3 —, and the absence was decided in writing in decision 7 of
[ADR 0150](0150-instalador-de-uma-linha.md), which also declared it "in the
installer's output". The defect is not the installer hiding the absence: it is
the SCREEN not knowing about it, and offering — even preselecting — the mode the
absence makes useless.

## The half that stopped: the installer cannot obtain the broker image

The maintainer's decision had a part (a): `install.sh` asking whether to turn on
the broker, with the risk stated in text (the Docker socket mounted in a service
is root-equivalent on the host). Before writing the question, it was measured
whether the installation can have the image the "yes" answer would bring up.
**It cannot:**

- `docker-bake.hcl` has four targets (`api`, `engine`, `web`, `backup`);
  `scripts/ci/images-manifest.ts` does not know `broker`; and the `images.json`
  of the v6.1.0 Release lists exactly those four;
- `docker manifest inspect ghcr.io/daneiel/brabo-broker:6.1.0` answers `denied`
  (the repository does not exist), while the SAME anonymous command for
  `ghcr.io/daneiel/brabo-api:6.1.0` resolves — it is not a lack of credentials;
- the v6.1.0 Release assets do not bring `docker/broker/Dockerfile.prod` nor the
  code of `apps/broker`/`packages/docker-port`, so a one-liner installation,
  which runs in a folder without a checkout
  ([ADR 0160](0160-o-compose-do-instalador-viaja-assinado.md)), does not even
  have anything to build.

A question whose "yes" has no image to bring up is worse than none: the person
consents to the socket risk and receives a `pull access denied`. Only
`--source=local` (clean checkout, on a tag) could build the broker — and even
there the installation compose does not have the service. The fix is the one ADR
0150 already named as small and outside its scope: publish the broker as a fifth
image (a target in the bake, an id in the manifest, one more signature), and ONLY
THEN the installer's question. It is left for its own front, and it is that front
that reopens this half. `install.sh` was not touched by this ADR.

## Decision

### 1. The api says whether the installation has a broker, in the two routes the screen already reads

`brokerConfigurado: boolean` enters **two existing responses** and no new route:

- `GET workspaces/:workspaceId/projects-base` — the creation wizard's question
  was already *"which mode can this INSTALLATION execute?"*, and the base was only
  half of it. Same minimum (`maintainer`), same caller, same instant;
- `GET workspaces/:workspaceId/containers` — per ROW, with the same value in all.
  The response is a list, and swapping it for an envelope would break the
  contract for a field that belongs to the installation.

The source is `ContainerBrokerPort.configurado()`, the SAME one that decides
whether the observed-state read asks the broker or declares absence — reading
`BROKER_URL` a second time would be the second source that one day diverges. The
field says the variable EXISTS, never that the broker ANSWERS: whoever knows that
remains `naoObservado` ([RN-486](../business-rules.md#rn-486)).

### 2. The wizard does not preselect `mounted` without a broker, and offers `runner`

Three states, which do not collapse:

- **confirmed broker** (`true`): RN-513 behavior intact — with a base, `mounted`
  preselected;
- **confirmed absence** (`false`): `container` and `mounted` stay ON THE SCREEN
  (removing the card would hide the information — the rule "remove the control,
  never the information" of [RN-102](../business-rules/custo.md#rn-102)) but
  **inert**, the reason is stated ONCE in text below them, and `runner` is the
  preselected one. A human choice made before the answer arrives, in a mode it
  makes unexecutable, falls back to `runner` — the same rule that already dropped
  `mounted` when the base disappears;
- **don't know** (loading, failing query, absent field): neither "has" nor "does
  not have". It does not preselect `mounted` — the revision of RN-513 —, and it
  also does not lock cards nor assert in text an absence nobody confirmed:
  `container` stays selected, as before.

### 3. `/containers` refuses the startup before the click, with its own reason

`decidirSubida` gains the reason `sem_broker_na_instalacao`, for `container` and
`mounted` when `brokerConfigurado !== true` — "don't know" does not become
"has". It comes right after `ja_esta_de_pe` and BEFORE `sem_imagem_decidida`: in
an installation with nobody to bring up the container, sending someone to decide
the image would be pointing to the wrong door. `runner` never falls into it. The
branching is the same by DESTINATION as `acaoDeSubidaDoModo` (whoever depends on
the broker is whoever proposes `container_start`), read on the other side by
`usaBroker`, and not a second rule.

## Consequences

- In a Release installation, the mode that works end to end becomes the
  suggested one, and the one that does not work starts saying why before anyone
  chooses it. The price: `runner` requires the local agent up and Docker on the
  user's machine — which the one-liner installation already delivers
  ([ADR 0155](0155-a-primeira-conta-nasce-no-terminal.md)).
- In the DEVELOPMENT compose the broker comes up by default
  ([RN-512](../business-rules.md#rn-512)), but `BROKER_URL` stays empty until
  someone puts it in the `.env` (`docker/docker-compose.yml`, `.env.example`).
  Without it, the developer's wizard now shows the warning — and it is RIGHT:
  without `BROKER_URL`, the api never calls the broker that is up, and
  `container_start` would fail the same way.
- RN-512 does NOT change: the broker remains under
  `profiles: ["container-broker"]` in the production compose, outside the
  installation compose, and none of the five containment layers is touched. What
  changes is the SCREEN stopping assuming the opposite.

**Out of scope, declared:**

- the installer half (section above) — it depends on publishing the image;
- mode conversion (`ExecutionModeSection`,
  [ADR 0111](0111-conversao-de-execution-mode-de-projeto-existente.md)) can still
  convert to `container`/`mounted` in an installation without a broker; it reads
  the same route and the field is at hand, but it is another screen, with
  another offering rule ([RN-559](../business-rules.md#rn-559));
- stopping and removing (`container_stop`/`container_remove`) did not gain the
  refusal: without a broker there is no `container`/`mounted` container
  registered as up to stop, and the case was not measured;
- the Infra Lead does not know about an absent broker — it refuses by MODE
  ([RN-566](../business-rules.md#rn-566)), and enriching its context with the
  installation is the more expensive front RN-566 already declares;
- the parallelization suggestion that ignores an agent blocked by a container;
- the closing sentence of `install.sh` says that without a broker "a project in
  Mounted folder mode does not bring up a container" and omits the `container`
  mode, which does not either — an adjacency measured and not fixed here,
  because the installer belongs to another parallel front.

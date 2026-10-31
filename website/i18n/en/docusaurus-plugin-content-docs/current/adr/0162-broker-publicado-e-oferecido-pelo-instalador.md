---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0162 — The broker becomes the fifth published image, and the installer ASKS whether to turn it on

## Status

**Accepted.** Decided by the maintainer on 2026-09-18 (AT-097). It closes
decision 7 of [ADR 0150](0150-instalador-de-uma-linha.md) (*"the broker does not
come up in this phase, and the consequence is stated"*), extends
[ADR 0119](0119-imagens-publicadas-no-ghcr-por-digest.md) from four to five
images and applies to the installation the argument that
[ADR 0146](0146-base-consentida-no-bootstrap.md) (RN-512) applied to the
development compose. The broker itself — the five layers, the five operations,
the computed spec — is that of [ADR 0130](0130-broker-de-container.md), and
nothing in it changes. None of these is edited; this document references them.

**Sibling:** [ADR 0161](0161-a-tela-so-oferece-o-modo-que-a-instalacao-executa.md)
delivered the WEB half of the same maintainer decision ("both") — project
creation only offers the mode the installation executes — and declared in writing
that the INSTALLER half stopped because the image was not published. This ADR is
that half. The two complete each other without depending on each other: that one
prevents the screen from offering what the installation does not execute; this
one gives the installation a way to execute, with consent. With the broker on,
the installation gets `BROKER_URL`, and it is through it that 0161's screen
offers both modes again.

## Context

In a real installation, a `container` or `mounted` project **never executes**.
Whoever brings up the container of those two modes is the broker
([ADR 0144](0144-a-segunda-raiz-do-broker.md) branches by DESTINATION:
`container` and `mounted` → broker), and the installation compose does not have
the service. `BROKER_URL` stays undefined, `container_start` ends in
`container.start_failed` with `BrokerIndisponivelError`, and the dev agents stay
in `dev.blocked_by_container` forever — RN-502 refuses, rightly, to execute
outside a `running` container.

Decision 7 of ADR 0150 declared this and called the fix **small**. Measured on
2026-09-18, when opening this front:

- `docker manifest inspect ghcr.io/daneiel/brabo-broker:6.1.0` → `denied`; the
  same question for `brabo-api:6.1.0` resolves. The image does not exist in the
  registry.
- `docker-bake.hcl` had four targets (`api`, `engine`, `web`, `backup`), and
  `scripts/ci/images-manifest.ts` accepted exactly the four.
- `docker/broker/Dockerfile.prod` **already existed**, and already went through
  `ci.yml`'s `hadolint` together with the other four — `FROM` by digest with the
  tag on the line above, `USER node`, `HEALTHCHECK` against `/health`,
  npm/corepack removed. What was missing was not the image: it was someone
  building, scanning and publishing it. `ci.yml` never built it;
  `docker-compose.prod.yml` referenced it as `brabo-broker:prod`, which only
  existed on the machine of whoever ran `docker compose build` with the profile.
- The Release does not bring the code, so `--source=local` — the path ADR 0150
  pointed to as the way out — requires a checkout on a tag, which is not the
  one-line installation.

## Decision

### 1. The broker is the FIFTH published image, with the same gates as the others

A `broker` target in `docker-bake.hcl`, inside the `default` group: `ci.yml` now
builds it on every PR, checks that it does not run as root, scans it in Trivy
with the same rules (`HIGH,CRITICAL`, `--ignore-unfixed`) and proves it COMES UP
healthy with a read-only rootfs. `release.yml` publishes it by DIGEST,
`images-manifest.ts` requires it (a missing target still fails — five of five or
none), and keyless `cosign` signing and the verification in the same run
([RN-524](../business-rules.md#rn-524)) cover it without a new line, because both
loops read the manifest.

**Kubernetes does not know it**, and that is a decision, not forgetfulness: there
is no broker Deployment in `deploy/k8s/`, and mounting a node's socket into a pod
is another privilege conversation. `argumentosDeSetImage` now emits only the
images the kustomize base declares — `make imagens-do-release` keeps writing four
lines into the overlay.

### 2. The installation compose gains the service, OFF by default

The service enters under `profiles: ["container-broker"]`, the SAME profile as
the validation compose, and with the five layers of ADR 0130 intact: no
`ports:`, only on the `broker` network (`internal: true`, which only the api
reaches and which has no egress), `BRABO_SERVICE_TOKEN` mandatory in production,
five operations, a spec computed from what the api says. The socket is mounted in
it and in no other. `api` now always participates in the `broker` network — as it
already does in the validation compose —, and `BROKER_URL` in the api stays empty
unless the `.env` says otherwise.

The image comes from `BRABO_BROKER_IMAGE`, **mandatory** like the other four, and
that was measured and not chosen: Compose interpolates the WHOLE file before
filtering by profile, so a `${VAR:?…}` in a disabled service refuses the file all
the same. The installer always writes it (it comes from the same manifest),
whether it turns on the broker or not.

The two roots go as in the validation compose: `BRABO_PROJECTS_HOST_BASE` derives
from `BRABO_PROJECTS_BASE`, which is already a host path. The other,
`PROJECT_WORKSPACES_HOST_ROOT`, has no way to derive in the compose — the
installation's managed folder is the NAMED volume `project_workspaces`, and the
path the daemon resolves is the HOST's. The installer COMPUTES it
(`<DockerRootDir>/volumes/brabo_project_workspaces/_data`, the `local` driver's
layout) and, after startup, CHECKS it against the `Mountpoint` the daemon returns
for the volume; diverging becomes a named pending item with the right value,
never a silently guessed value.

### 3. The installer ASKS, with the risk stated in text, and the default is NO

A new question, after the base and before the `.env`. It says what turning it on
grants — a service of this installation starts talking to this machine's Docker,
and whoever commands that service commands Docker —, what the layers contain, and
what changes without it (`container` and `mounted` projects do not execute; the
Runner mode does not depend on it). Only `s`/`sim` turns it on. Enter, anything
else or the lack of a terminal leave it off, and the script SAYS it stayed off.

Yes writes into the `.env` `COMPOSE_PROFILES=container-broker`,
`BROKER_URL=http://broker:8090`, the `DOCKER_GID` and the computed root. The
`DOCKER_GID` is measured **from inside a container**, with the broker image
itself and the socket mounted through `--mount type=bind` (which refuses instead
of creating the folder when the source does not exist), because it is the gid the
process sees there that `group_add` needs — and on Docker Desktop the socket's gid
on the host says nothing about the one inside the VM. Not being able to measure,
or the path not being a socket, is a NAMED refusal that teaches to run again and
answer no; never a guessed 999.

The decision appears in the final summary, and the sentence *"what this installer
does NOT do"* stops saying that only "Mounted folder" stays without a container:
`container` does too.

### 4. Why RN-512's argument holds here

ADR 0146 separated the two composes by what the socket MEANS: in development
whoever brings up the stack already has the socket, so the broker receiving it
grants nothing the operator does not have; in production the socket is a
privilege boundary and the operator is not the developer.

The one-line installation is the first case, not the second. It runs **on the
person's own machine**, who just ran `docker compose up` — the installer does not
work without them having the socket. Operator and user are the same person. What
the installation CANNOT assume, and that is why it asks instead of turning it on
like the development compose, is that whoever installs knows what the socket is:
the dev compose is read by whoever develops the product; the installer is run by
whoever never opened this repository. Explicit consent is the difference that
remains, and it is the one this ADR buys.

`docker-compose.prod.yml` does not change: it remains under a profile, and for it
ADR 0146's reading still holds without caveat.

## Consequences

**The price, declared.**

- **A root-equivalent image becomes public.** Anyone can pull
  `ghcr.io/daneiel/brabo-broker`. The image itself grants nothing — it is the
  mounted socket that grants —, but it becomes a studiable target, and a
  vulnerability in it becomes, in every installation that turned it on, a path to
  the host's Docker. That is why it enters each PR's Trivy and each tag's
  signature, and not a separate list.
- **The Docker socket is now mounted in a service of a user installation**, when
  it consents. Whoever commands the broker commands the machine's Docker. What
  separates it from the rest: it publishes no port, only the api reaches it, the
  token is compared in constant time, and there is no field where one could write
  `privileged`, `cap_add`, `network: host` or a free `-v`. That contains the
  caller; it does not contain a bug in the broker itself.
- **`BRABO_BROKER_IMAGE` becomes mandatory** in the installation's `.env`, on or
  not. A `.env` written by a previous installer does not have it — but the
  installer rewrites the `.env` on every execution, and the update goes through
  it.
- **The installer requires `broker` in `images.json`.** A Release prior to this
  one does not have it, and this version's installer refuses naming the target.
  It is the same rule as ADR 0160: a tag's installer installs that tag.
- **The managed root depends on the `local` driver's layout.** Computed before
  startup, checked after; what does not check out becomes a pending item with the
  value read from the daemon.
- **Not measured:** the `DOCKER_GID` and the computed root on macOS Docker
  Desktop. The tag's E2E runs the interactive half only on Linux.

**What does NOT change.** The validation compose, `smoke.sh` (which comes up
without the profile and keeps proving the same three app images), the
development compose, Kubernetes, and the broker itself.

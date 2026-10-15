---
traducao_de: cafd5034a6fac22a916b448ad445e4358b957651
---

# ADR 0130 — The container broker: who talks to the server's Docker, and why it does not accept a specification

## Context

ADR 0065 decided that a project's image is an ARTIFACT of the Arquiteto
(Architect), and ADR 0081 created the lifecycle table (`project_containers`).
Neither of them brought up a container: to this day CLAUDE.md records "FASE 25b
segue cortada: NENHUM serviço chama Docker". ADR 0128 built the foundation — a
`DockerPort` of FIVE operations (`start`/`stop`/`remove`/`inspect`/`exec`) and
an adapter over `execFile('docker', …)` — inside `apps/runner`, and wrote, in
anticipation, that that file would MOVE when the second consumer was born:
*"a second file with the same five operations and a sixth 'only in the broker'
is the beginning of the end of the containment"*.

This ADR is that second consumer. It decides three things that do not separate:
where the port comes to live, what the broker is, and what prevents a
root-equivalent service on the host from becoming arbitrary access to Docker.

The previous decision it does NOT reopen: the api never receives the socket.
Neither does the engine. The socket is mounted in a single service, which
exists for that.

## Decision

### 1. The port MOVES to `packages/docker-port`

`apps/runner/src/docker-port.ts` and `docker-cli.ts` (plus the two `.spec.ts`)
become `packages/docker-port/src/`, in a new workspace package
(`@brabo/docker-port`) consumed by `apps/runner` and `apps/broker`. None of the
files was copied.

**`packages/shared` was rejected, and the reason is verified, not aesthetic.**
That package is 100% TYPE, and the invariant is kept honest by
`apps/api/test/packages-shared-so-tipos.spec.ts` — its `main` points to raw
`.ts`, and the api's production image dies on boot with
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` if any value survives `tsc`. A
port with error classes, constants and validation functions is runtime code.

**The new package has no build step, and that is what makes it consumable.**
Both consumers BUNDLE it: the runner through `tsup` and through
`bun build --compile`, the broker through `tsup`. Neither of them resolves it
from `node_modules` at runtime inside an image. In development, the `.ts` is
executed directly by Node's type stripping — the pnpm link is a symlink and the
`realpath` falls outside `node_modules`, so Node's refusal does not apply
(measured, not assumed).

**Declared consequence: the api CANNOT consume this package.** Its image's
`pnpm deploy --prod` copies the actual package, without a symlink, and then the
`realpath` falls inside `node_modules` — exactly the error the
`packages/shared` test exists to prevent. That is why `validarDecisaoDeImagem`
(the api's domain) **does not move here**, and why the broker does not import
it. What the broker has is its OWN parse (`especificacaoValidada`), and the
next section explains why it is not a second version of the same rule.

**Bundling, measured after the move.** `pnpm --filter runner build`,
`build:bin`, `smoke` and `smoke:bin` stay green; the standalone binary
(`linux-x64`) loads the port and queries the daemon from inside it, which is
what ADR 0128 already proved. The Bun bundle went from 79 to 83 modules. The
package enters as a `devDependency` of the runner — same shelf as `phoenix` —
because `tsup` leaves `dependencies` as EXTERNAL `require` and embeds a
devDependency, and because the package published on npm cannot carry a
`workspace:*` that nobody outside this repository resolves.
`npm pack --dry-run` in `apps/runner` still produces the same four files.

### 2. The broker does not accept a container specification

`apps/broker` is a Node/TS service, of the same family as the runner: no web
framework (there are six routes), plain `node:http`, its own image in
`docker/broker/`.

What makes it non-arbitrary is not an allowlist of anything. It is the SHAPE of
the input:

> It receives a `projectId` and one of the five operations. It goes to the api
> to READ the Arquiteto's decision and the project context (`GET
> /internal/projects/:projectId/container-spec`). It COMPOSES the specification
> itself. There is no parameter in which to write `privileged`, `cap_add`,
> `network: host` or a free `-v` — because there is no parameter.

If the spec traveled in the body, the containment of a root-equivalent process
on the host would depend on the CALLER being correct. One more HTTP call is the
price of containment depending on nobody, and it is a low price: the api is on
the other side of the same internal network.

**Why the broker revalidates what the api itself returned.** Because it cannot
presuppose the correctness of whoever answers it — and because the two
validations answer different questions. `validarDecisaoDeImagem`, in the api,
asks "is this architecture decision reviewable?" (requires `rationale`, refuses
`latest`, applies `RECURSOS_MAXIMOS`, returns the refusal to the MODEL through
the tool-result). `especificacaoValidada`, here, asks "can I hand this to the
daemon?" — it is the parse of an untrusted JSON into the closed type. The
overlap is small and declared (tag/digest, a numeric ceiling), and it is not a
mirror to maintain: the ceilings here are the BROKER's, the last resort it never
exceeds wherever the request comes from. Today the numbers coincide with the
api's on purpose; if they ever diverge, the smaller wins and nothing breaks,
because neither claims to be the other.

**One check exists only on this side, and it is new:** an image reference that
starts with `-`. `image` becomes a POSITIONAL argument of `docker run`, and
`--privileged` as an "image name" would be read by the CLI as a flag.
`execFile` without a shell solves COMMAND injection; ARGUMENT injection is
another thing, and it is solved here.

### 3. `pidsLimit` enters the port

ADR 0128's `EspecificacaoDeContainer` had `cpus` and `memoriaMb`, and the
Arquiteto's artifact always had three numbers — `RecursosDoContainer.pidsLimit`
is what contains a fork bomb without depending on recognizing the command.
Without the field, the broker would read the artifact and discard the third:
the artifact would promise a ceiling the container does not receive, which is
the "an artifact that promises more than the container receives lies to whoever
audits it" that the api's own domain names.

Adding a field to the port is a move that deserves a note, because the rule of
this design is not to add parameters. The rule applies to what LOOSENS. This
tightens, and becomes `--pids-limit` next to `--cap-drop ALL`.

### 4. Network, port and socket

- Its OWN network in Compose (`broker`, `internal: true`), in both files. The
  api participates in two networks; the engine and the web do not participate
  in this one, so they do not reach the broker. `internal: true` also removes
  the broker's outbound route to the internet, which it does not use.
- **No published port.** Nothing on the host needs to reach it.
- `/var/run/docker.sock` mounted **only here**. `:ro` on the socket would be
  cosmetic — Docker's protocol is HTTP over that socket and every operation
  writes — and so it was not used as if it were containment.
- Authentication by `BRABO_SERVICE_TOKEN`, the same secret and the same header
  already used api↔engine in both directions, compared in constant time. In
  production the broker REFUSES to start with the variable empty, with the
  repository's public literal, or with fewer than 16 characters — the rule of
  ADR 0059/RN-114, which weighs more here than in any other service.
- The broker starts under `profiles: ["container-broker"]` in both composes,
  and therefore **does not start by default**. Nothing calls it to write yet;
  giving access to the host's Docker to every development machine in exchange
  for nothing would be a change of posture with no counterpart.
  `docker/smoke.sh` runs without a profile and keeps proving the same three
  images.

### 5. No path crosses the boundary

The api sends no path at all — neither `workspace_path`, nor the managed root.
The `-v` of a `docker run` is resolved by the DAEMON, against the HOST's
filesystem; `/data/project-workspaces/<x>` is a path from inside the api's
container, and sending it would make the daemon create and mount an EMPTY
folder, with the dev agent working in a directory without code and nothing
indicating why.

The broker composes the path with `PROJECT_WORKSPACES_HOST_ROOT`, ITS
configuration, plus the `workspaceDirName` frozen at the project's creation
(RN-109). Without that variable, `start` refuses naming it; the other four
operations keep working. Refusing is the decision: guessing would produce the
empty mount silently.

### 6. What the api gains, and what it deliberately does not gain

It gains a PORT (`ContainerBrokerPort`) and an HTTP client. Of the five
declared operations, **one has a caller**: `inspect`, through the container
lifecycle route, which now returns the OBSERVED state next to the RECORDED one.
The other four are external effects and do not happen without a
`proposed_action` — whoever will propose is the Infra Lead, with the user's
final authority, and that is another PR. Declaring the five now and wiring four
later is the opposite of hiding a trigger: the method exists and nothing calls
it, which any search for a caller shows in a second.

It gains no new write. `RegistrarTransicaoDeContainerUseCase` remains byte for
byte as it was, mode guard included — it falls together with the RN-105 gate in
the three modes, in a PR that decides both things at once. As a consequence,
**the broker declares the same policy on its side**: a `mounted`/`runner`
project is refused with 409, because their code lives in a user folder the
broker's host does not see. Changing only one of the two sides now would leave
the api and the broker disagreeing about what exists.

## Consequences

**The broker is root-equivalent on the host, and that is the price.** It is
written, not hidden. Contained by five independent layers: no published port;
an internal network only the api reaches; a service token in constant time;
five operations with a closed surface; and the specification computed, never
accepted. None of them trusts the others.

**One mechanism, not two.** ADR 0128 left `dockerode` technically possible in
the broker (it never becomes a standalone binary). The product owner's decision
was CLI on both sides, and the reason is not technical: two mechanisms for the
same operation mean two ways of failing, two error surfaces to classify and two
versions of the spec → daemon translation. The price is the broker's image
needing the `docker` binary inside it — `docker-cli`, only the client — and it
is paid in the Dockerfile, with `DockerCliAusenteError` naming the day someone
mounts the socket without installing the client.

**The `project_containers` table can now LIE, and the read says so.** Before it
could not: `container_id` was always NULL. Reconciliation is ON READ, not a
background daemon — a container killed from outside appears as recorded
`running` and observed `exited`. The two columns never merge, and "I could not
look" has its own reason (`broker-nao-configurado`, `broker-sem-resposta`,
`broker-recusou`) instead of inheriting the recorded one. It is RN-468 applied,
and no broker refusal brings down the read of the recorded state, which is
legitimate information on its own.

**Declared gap:** an orphan container of a project that never had a lifecycle
row does not appear in that route — it reads the recorded state first and only
then asks the daemon. Whoever finds orphans is the sweep by
`brabo.managed=true`, and the global page that consumes it is another PR.

**The broker image is NOT published on GHCR.** `docker-bake.hcl`,
`scripts/ci/images-manifest.ts` (`ALVOS`) and `release.yml` keep the FOUR
images of ADR 0119. The broker starts under a profile, is not part of the
default deploy and nothing calls it to write; publishing it now would put in
the public registry an image nobody installs. When the Infra Lead PR makes it
necessary, it enters through the same path as the other four — it is one line
in each of the three places, and `ALVOS` has a test.

**PHASE 25b is no longer entirely cut, and only that.** There is a service
capable of calling Docker, and a READ path that calls it. No container comes
up: there is no loop, no queue, no `container_start` `proposed_action`. The
CLAUDE.md sentence changes to say exactly that, and nothing more.

**An operational novelty that did not exist:** `DOCKER_GID`. The socket is
`root:docker` on the host and the broker process runs non-root, so the compose
uses `group_add`. The default (999) is the most common and is wrong in several
distributions; getting it wrong produces "permission denied" on the socket,
which `DockerIndisponivelError` already names with the group hint. It is in
`.env.example` and in the runbook.

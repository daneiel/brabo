---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0146 — The base consented at bootstrap, and `mounted` as the local default

## Context

ADR 0141 created `BRABO_PROJECTS_BASE`: **one** base on the host, mounted by
identity (`$X:$X`) in `api` and `engine`, where the folders of every project in
the Mounted folder mode live. It solved the problem it set out to solve — the
per-project bind-mount line in the compose is gone, and with it the restart that
killed every in-flight agent turn to onboard ONE project.

But it left the variable **absent by default**, and the consequence of that is
the reason this phase exists. Without the variable the api reports
`projectsBase: null` and the creation wizard **does not offer** the mode
(`docs/adr/0141-base-unica-dos-projetos-montados.md:68-72`). The normal state of
a freshly cloned installation is therefore: the only mode that puts the code in
a folder the user opens in their editor **does not appear on screen**.
`container` has no folder they see; `runner` requires a binary, `chmod`, pairing
and — since ADR 0145 — Docker up on their machine. The product has three
execution modes and none of them delivers, without configuration work nobody
asked the user to do, the simplest thing they expect: to see the files.

A **gesture of consent** is missing. Choosing where projects will live is a
decision of the machine's owner, happens **once**, and happens **on the host** —
not inside a container, not through the api, not through the web interface. The
product already has exactly one place with those three properties:
`pnpm bootstrap` (`scripts/dev/bootstrap.sh`), the menu that already creates the
`.env`, fixes folder owners and reconfigures Ollama.

There is a second fact of the world that changed since ADR 0130 and that this
phase cannot ignore. The broker starts under `profiles: ["container-broker"]`
and **does not start by default**, and the recorded justification is literal
(`docs/adr/0130-broker-de-container.md:131-135`):

> Nada o chama para escrever ainda; dar acesso ao Docker do host a toda máquina
> de desenvolvimento **em troca de nada** seria uma mudança de postura sem
> contrapartida.

The premise of that sentence — "nothing calls it" — stopped being true. ADR 0133
gave `container_start` a real caller; ADR 0136 added `stop` and `remove`; ADR
0134 added `exec`. And ADR 0144 made `mounted` bring up a container **through
the broker**. A `mounted` project in a local compose without the profile on does
not end in a configuration error: it ends in `BrokerIndisponivelError`, after the
user has chosen the mode, created the project and talked to the Arquiteto
(Architect).

## Decision

### 1. The default base is `$HOME/projetos-brabo`, and Node writes it, not bash

The proposed path is **`$HOME/projetos-brabo`**, always expanded to absolute
before being written. `~` remains forbidden, and not by taste: Compose does not
expand it on the side that matters, and writing it creates a folder called `~`
(`.env.example:225-229`).

Under `$HOME` because that is what Docker Desktop shares **by default** —
`/Users` on macOS, the user profile on Windows. A default that requires the user
to open Docker's settings before it works is not a default; it is a disguised
question. Not `$HOME/brabo`, because the base cannot be (nor contain) Brabo's
own checkout — `scripts/dev/preflight.mjs:316` already refuses to start in that
case — and whoever clones the product there would fall exactly into the refusal.

And **not `$HOME/brabo-projetos`**, despite being the most natural name, because
`.env.example:202` already uses that path as a commented example of
`PROJECT_WORKSPACES_HOST_DIR` — the root of the workspaces the PRODUCT manages.
They are different variables with opposite owners, and ADR 0141 refused to
conflate them precisely because the collision "breaks in a way that is hard to
see": `<base>/loja` would collide with a `container` project whose
`workspace_dir_name` was also `loja`, and the bootstrap would `git init` inside
the other's project (`.env.example:231-237`). Proposing as default the path the
documentation already suggests for the other variable would be walking into
that trap through the front door.

The name, however, is only the dodge. The protection is **mechanism**: the
script **refuses** any base that is equal to, contains or is contained in
`PROJECT_WORKSPACES_HOST_DIR`, reusing `dentroDe` from
`scripts/dev/base-de-projetos.mjs` — the same function that already sustains
`baseSobrepoeOCheckout`. The check applies to the typed path, not only to the
default; a well-chosen default only prevents the refusal from being the first
thing the user sees.

**Whoever writes it is `scripts/dev/consentir-base.mjs`**, new, sibling of
`scripts/dev/base-de-projetos.mjs` (which already hosts the pure normalization
and overlap logic), called by a menu item of `bootstrap.sh`.

It is not bash, and the two reasons are measured, not aesthetic. The first:
`bootstrap.sh` **does not have** a helper to write a variable in the `.env` —
`garantir_env` (`scripts/dev/bootstrap.sh:91`) only copies `.env.example` when
the file does not exist. The only helper that updates a key in place,
preserving comments and appending at the end when it does not exist, is
`escreverEnv` (`scripts/dev/preflight.mjs:128`). The second, and the decisive
one: **a menu item cannot ask**. Every menu command runs in the background with
stdin coming from `/dev/null` (`scripts/dev/bootstrap.sh:770`), and the comment
above the line explains why — without it, anything that reads stdin steals the
user's arrow keys, and a command that waits for an answer hangs without ever
showing the question. A consent step written in bash inside the menu would be,
by construction, a step that cannot consent.

**An already present value is never overwritten without confirmation.** And
**without a TTY, the script reports and does nothing** — the literal precedent
of `perguntarUsoDoOllama` (`scripts/dev/preflight.mjs:208`), which without a
terminal applies the default and warns instead of hanging. A consent script that
"consents" on its own in a CI pipe is the negation of the word.

The folder is created with `mkdir -p` **after** the user accepts the default or
types another path, never before.

### 2. Docker Desktop sharing is proven by MOUNTING

On macOS and Windows, a folder outside Docker Desktop's sharing list mounts
**empty** or makes `docker run` fail — and the whole Mounted folder mode
depends on that mount. Validation is mandatory, and its form is the verdict:

**It is proven by mounting, never by reading Docker Desktop's configuration.**
The test is a `docker run --rm -v <base>:/sonda <imagem já presente> ls /sonda`.
Reading `settings.json` would be reading the declared *intent* in an
undocumented structure, which changes between versions and between macOS and
Windows, and which describes what the user configured — not what the daemon will
do. Mounting measures the **property**. It is the same rule the product already
applies to providers: a capability is only declared when proven by execution,
never read from official documentation (ADR 0041/0042).

Only on macOS and Windows, by `process.platform`. On Linux there is no sharing
list: the check is existence and write permission, and nothing more. This makes
the validation the **second** platform guard of the product — the first is
`validarDirDentroDoHomeNoLinux` (`apps/runner/src/guard.ts:240`), which
restricts `--dir` to `$HOME` **only** on Linux. The two are symmetric in
principle: each restricts only where the restriction means something. It is
worth recording that today **no dev script detects the platform** — neither
`bootstrap.sh` nor `preflight.mjs` call `uname` or read `process.platform` —, so
this ADR introduces the pattern, and that is why it is written here instead of
becoming an ownerless `if`.

Base outside the list: **refusal with an actionable message**, naming the
tested path and where to add it (Docker Desktop → Settings → Resources → File
sharing). It never writes the variable, never mounts silently. A base accepted
and not shared produces a project the api accepts, creates and shows — and whose
container comes up with the folder empty, far from the screen where the choice
was made. It is the same lesson as RN-170, and the reason the refusal comes
before the write.

### 3. The broker leaves `profiles` in the LOCAL compose, and only there

**Verdict: it leaves in `docker/docker-compose.yml`; it remains under
`profiles: ["container-broker"]` in `docker/docker-compose.prod.yml`.**

The original justification (`docs/adr/0130-broker-de-container.md:131-135`,
quoted in the Context) has two halves, and only the second survives. "Nothing
calls it to write yet" is **false** since ADRs 0133/0134/0136 — the broker has
four real callers. And "in exchange for nothing" stopped describing the trade:
with this ADR making `mounted` the local default (point 4) and ADR 0144 making
`mounted` come up through the broker, the disabled profile becomes what
separates the **default mode** from ending in `BrokerIndisponivelError`. The
counterpart exists, and it is the common path.

What sustains the local↔production asymmetry is what the socket means on each
side. **Whoever runs `pnpm dev` already has the Docker socket** — they are
running `docker compose`, with the host's own daemon. The broker receiving it
grants nothing the operator does not already have; the marginal surface is the
broker's own HTTP, which publishes no port (`docker/docker-compose.yml:486-487`),
lives on an `internal: true` network only the api reaches, and compares
`BRABO_SERVICE_TOKEN` in constant time. In production the calculation is the
opposite: the socket is a real privilege boundary, the operator is not the
developer, and nothing in this phase changes the default mode of a production
installation. That is why the profile stays there.

**The five containment layers are not touched**
(`docs/adr/0130-broker-de-container.md:171-176`). This ADR changes **when** the
broker runs, never **what** it accepts: it still receives a `projectId` and one
of the five operations, still goes to the api to read the Arquiteto's decision,
and still has no parameter at all where one could write `privileged`,
`cap_add`, `network: host` or a free `-v`. Containment was never the profile.

`DOCKER_GID`/`group_add` remains the fragile environmental point, and it now
applies to every development machine instead of only to whoever turned on the
profile — see Consequences.

### 4. With a configured base, `mounted` is the wizard's default

Base present: **`mounted` preselected**, with the path **suggested** as
`<base>/<slug>` and editable. Base absent (`projectsBase: null`): `mounted` **is
not offered** and `container` remains the default.

Neither half is a new rule. "Do not offer without a base" is RN-500 and
`docs/adr/0141-base-unica-dos-projetos-montados.md:68-72`; "suggest
`<base>/<slug>`" is RN-501 and ADR 0142, which deferred disk validation
precisely so the wizard could propose a path that **does not exist yet**. What
this ADR records is that **neither was ever implemented on the client**:
`GET /workspaces/:workspaceId/projects-base` has no caller at all in the web, and
the mode's card is offered unconditionally. The phase makes them true; it does
not invent them.

What is new is the **preselection**. It **revises the default of ADR 0072**,
where `container` is "the normal one" and the local mode is an escape hatch —
and revises it **only for the local installation**, where the base was consented
by a human on the host. The `projectExecutionModeEnum` enum does not change, no
new mode is born, and conversion between modes (ADR 0111) stays identical.

### 5. The consent script is versioned in the repository

`scripts/dev/consentir-base.mjs` lives in the repository, enters the diff, goes
through review and is the same file for everyone. **Never generated dynamically
by the api, never downloaded at runtime.**

It is the same supply chain that already pins every third-party action by commit
SHA and verifies every downloaded binary with `sha256sum -c`: a script that
configures the user's host, creates a folder and writes to the `.env` is
precisely the artifact whose provenance needs to be auditable. A script
generated by the api would be code that runs on the user's machine and that
**nobody reviewed**, delivered through a channel whose integrity the product
does not verify.

Explicit corollary: **the api gains no route that emits a host script.** The
`GET /runner-releases/binary` proxy that already exists is not a precedent for
that — it serves an **already published** artifact from GitHub Releases, it does
not generate one; and the absence of a signature on that path is exactly
**BRB-005**, an open backlog item, not a pattern to imitate.

## Consequences

The user who clones Brabo and runs `pnpm bootstrap` ends up with a consented
base, validated against the Docker they really have, and with the wizard
offering by default the mode that puts the code in a folder they open in the
editor. Sessions 2, 3 and 4 of this phase build, in that order, the bootstrap
step, the wizard behavior and the profile change.

**What this ADR does NOT touch.** `decide.ts` and the absolute ceilings remain
identical — nothing here is an agent action. `proposed_action` remains the
origin of every external effect. The immutability of the event log is not
touched. The image gate applies to all three modes as ADR 0135 left it, and a
`mounted` project without a decided `artifact.project_image` still answers 409
in the Code tab. The broker still has **five** operations and the specification
computed, never accepted (ADR 0128/0130) — a sixth operation remains a product
decision with its own ADR.

**Declared cost 1: `DOCKER_GID` now matters for everyone.** While the broker only
started under a profile, a wrong `group_add` affected whoever had turned on the
profile on purpose. Now it starts by default in the local compose, and a wrong
GID becomes a socket permission error for any developer. The default
`${DOCKER_GID:-999}` is right in many Linux distributions and wrong in others;
session 4 should report this in `preflight.mjs`, together with the base state,
instead of letting the failure appear only when someone proposes
`container_start`.

**Declared cost 2: a single base, and it is browsable.** ADR 0141 already
declared both, and this ADR inherits them without improving them: a symlink
under the base pointing outside resolves differently on the two sides, and code
outside the base requires moving the folder. `.env.example:239-241` already
instructs choosing a **dedicated** folder — everything under the base becomes
reachable from inside the product's containers —, and the consent step's message
repeats that instruction instead of presuming it was read.

**Declared cost 3: the sharing probe costs one `docker run`.** It runs once, at
the consent gesture, and reuses an image already present so as not to pull from
the network. If there is no local image at all, the step says so and asks the
user to run `pnpm dev` once first — it never downloads an image on its own in
order to test.

**Assumed gaps, with origin.** The git credential is still discarded on the
`docker exec` path in `runner` mode (`apps/runner/src/index.ts:318-320`; the
Docker port has no `env` field, by the design of ADR 0130) — this phase does not
close it. A symlink from inside the project pointing outside is still not
detected by `decide()`, which is pure and does no I/O
(`docs/adr/0055-escopo-de-caminho-na-politica-de-terminal.md:9-15`);
`apps/runner/src/guard.ts:9-31` remains best-effort by declared invariant.
**BRB-005** (signature of published artifacts) and **BRB-031** (manual
`chmod +x`) remain open: this phase touches them and does not solve them.

**Windows stays off the tested path.** The sharing probe runs on Windows because
`process.platform` includes it, but the product is still exercised only on Linux
and macOS (`.env.example:198-201`), and nothing in this phase changes that.

References [0130](0130-broker-de-container.md) (the profile and the five layers),
[0141](0141-base-unica-dos-projetos-montados.md) (the base this ADR now
consents), [0142](0142-validacao-de-workspace-montado-adiada.md) (the deferred
validation that makes the suggestion possible),
[0144](0144-a-segunda-raiz-do-broker.md) (`mounted` comes up through the broker)
and [0072](0072-projeto-local-ou-container.md) (the default point 4 revises for
the local installation). None of them is edited.
[0147](0147-agente-local-com-capacidades.md) is this phase's sibling and decides
the other half: the local agent and its capabilities.

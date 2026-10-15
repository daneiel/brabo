---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0141 — The single base for mounted projects, mounted by identity

## Context

The `mounted` mode (the old `local`, ADR 0072/RN-169, renamed by ADR
0104/RN-421) keeps the project's code in a USER folder, and that folder needs to
be reachable from inside TWO containers: the api, which reads and writes the
`permissions.json` and serves the Code tab, and the engine, which builds the
worktree and writes the code. The mechanism, since the beginning, is a
bind-mount.

What was never decided is **who creates that bind-mount, and when**. What
existed was an INSTRUCTION: `docker/docker-compose.yml` carried, in the `api`
and `engine` services, a large comment teaching how to add by hand one line per
project —

```yaml
- /home/voce/projetos/loja:/home/voce/projetos/loja
```

— and project creation refused with 400 (RN-170/RN-422) when the folder was not
there, with the message repeating that line. The refusal is good and still
exists; the problem is the price of the remedy it teaches.

**One compose edit and one restart of `api` + `engine` PER PROJECT CREATED.**
Restarting those two services kills every agent turn in progress, every open
terminal socket and every in-flight LLM call, across the whole installation — to
onboard one project. That was tolerable while `mounted` was an escape hatch for
those who already knew what they were doing. It stops being so the moment it
becomes a first-class choice, offered on the creation screen with a suggested
path.

And there is a second problem, which the path suggestion makes concrete. The
rule "the project folder cannot overlap the Brabo checkout", which is the heart
of [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md), is enforced by
`caminhoDeWorkspaceLocalValido` comparing against `raizDoBrabo()` — which is
`process.cwd()`, and inside the api's container is `/workspace`. The REAL
checkout, on the developer's disk, the api has no way of knowing. Whoever clones
Brabo into `$HOME/brabo` and points the project folder there passes **every**
existing validation, and the dev agents start running commands inside the
product's own tree — exactly the failure ADR 0055 exists to prevent, coming in
through a door it does not guard.

## Decision

**A SINGLE base, configured by the operator, mounted by IDENTITY in the `api`
and `engine` services.**

```
# .env
BRABO_PROJECTS_BASE=/home/voce/brabo
```

```yaml
# docker/docker-compose.yml — serviços api E engine
- ${BRABO_PROJECTS_BASE:-brabo_projects_base}:${BRABO_PROJECTS_BASE:-/data/brabo-projects-base}
```

The operator configures it **once**, runs `docker compose up -d api engine`, and
nothing else is ever edited per project. Every `mounted` project lives inside
the base.

The `${VAR:-nome_de_volume}` trick on the left, with an absolute and inert
default on the right, is the SAME already used by `PROJECT_WORKSPACES_HOST_DIR`/
`GIT_LOCAL_REPOS_HOST_DIR` on the neighboring lines: without the variable, the
left side is the name of a named volume declared at the end of the file, the
line remains valid Compose, and nothing is mounted from the host.

Without the variable, the api reports `projectsBase: null` (`GET
/workspaces/:workspaceId/projects-base`, `maintainer` — the same minimum as
`POST .../projects`, because this value exists to decide what that route
offers) and the creation wizard **does not offer** the Mounted folder mode.
Never offer a mode the installation does not honor.

### Why a NEW variable, and not `PROJECT_WORKSPACES_HOST_DIR`

There is a variable that already swaps a managed volume for a real host folder,
and the temptation to reuse it is great. There are three reasons not to, and the
first has a data consequence.

**1. Namespace collision, with `git init` in someone else's folder.** A managed
workspace is named by `workspace_dir_name` (RN-109), a UNIQUE column; a mounted
project is named by the USER, who types the path. With both roots pointing to
the same place, `<base>/loja` and a `container` project whose
`workspace_dir_name` is `loja` land in the SAME physical folder — and
`Workspace.init_from_bare!` would `git init` inside another person's project.
Nothing in the schema prevents it: uniqueness is among `workspace_dir_name`
values, never against the basename of `workspace_path`, and there is no way it
could be, because one side is chosen by the product and the other by whoever
types.

**2. Opposite ownership semantics.** `/data/project-workspaces` belongs to the
PRODUCT: disposable, opaque, and that is what makes it acceptable for a
`container` project to be deleted with the volume. The base belongs to the USER
— it is where their code lives, open in their editor, versioned by them. Merging
the two would make the documentation have to say "this folder is disposable and
also is not".

**3. The base is browsable; the managed root must not be.** The folder browser
served by the api (next PR) is scoped to the base, so the user can choose where
the project will live. Conflating the two would expose the interior of every
`container` project of the installation to anyone creating some project.

### Why IDENTITY (`$X:$X`), and not a fixed mount point

A fixed mount — `${BRABO_PROJECTS_BASE}:/data/mounted` — would be shorter to
write, and it is wrong for two reasons that add up.

The `projects.workspace_path` string is **typed by the user and shown back to
them** (`AmbienteDoProjeto`). With host ≠ container, the product would have to
choose which of the two to store, and any choice makes the screen lie to
someone: storing the inside path would show a folder that does not exist on
their machine; storing the outside one would require translating at every point
of use.

And it is precisely that translation that identity makes unnecessary.
`projectScopeRoot` (api) and `Engine.Actions.Workspace.workspace_dir/2`
(engine) discriminate the mode by the path's leading slash and use the column's
value as is. With host == container, both **remain correct without a single new
line of code** — and the terminal scope of ADR 0055, which is derived from that
same root, keeps authorizing exactly the folder the user sees.

### The broker gains a SECOND root

`BRABO_PROJECTS_HOST_BASE` enters the `broker` service derived from
`BRABO_PROJECTS_BASE` (which is already a host path by definition — it is what
`api`/`engine` mount by identity), next to `PROJECT_WORKSPACES_HOST_ROOT` and
for the same reason as [ADR 0130](0130-broker-de-container.md): the `-v` of a
`docker run` is resolved by the DAEMON, against the host filesystem, and a path
coming from inside the api would mount an empty folder. Containment remains
**configured in the broker**, never asserted by the caller — which is that
ADR's real invariant.

Nothing consumes this variable yet: whoever resolves a `mounted` project against
that root is the PR that gives a container to the Mounted folder mode. It is
born here because the base is born here, and a host variable that appears half a
release later is a variable nobody connects to the file that explains it.

### The `/workspace` guard, in the place where it is possible

`scripts/dev/preflight.mjs` now **refuses to start** when `BRABO_PROJECTS_BASE`
overlaps the Brabo checkout, in both directions (the base contains the checkout;
the checkout contains the base), using `git rev-parse --show-toplevel`.

The preflight runs on the HOST. It can answer what the api cannot, and that is
why the guard lives there and not in the domain: the api compares against
`process.cwd()`, which is `/workspace` inside its container, and will never see
the real path. The pure logic lives in `scripts/dev/base-de-projetos.mjs`, its
own tested module — `preflight.mjs` runs `await main()` at the top, and
importing it from a test would start the whole preflight.

## Consequences

**What gets better.** Creating a `mounted` project no longer requires a compose
edit and a restart of `api` + `engine` — it no longer costs every agent turn,
terminal socket and in-flight LLM call of the installation. Configuration
becomes an act of the OPERATOR, once, and not an act of the user, per project.
And the ADR 0055 vector that no api validation reached now has a guard, with a
message that explains why nothing else would catch it.

**Operator action required BEFORE the deploy**, and that is why the branch is
born `breaking/` and the version goes up MAJOR: whoever already uses the
`mounted` mode has the per-project bind-mount lines written by hand in the
compose. They keep working — nothing removes them, and nothing in this PR starts
refusing a `mounted` project outside the base (the base rule is a CREATION and
CONVERSION rule, and enters in the next PR; the lexical predicate, which runs on
every read, does not change). But from here on the supported path is the base,
and continuing line by line per project is debt nobody maintains anymore.

**Declared cost 1: a symlink under the base resolves differently on both
sides.** A symbolic link inside the base pointing outside it is followed by the
kernel INSIDE the container only if the target is also mounted — and it is not.
The folder browser refuses to descend into a symlink (and counts how many it
skipped, so as not to lie "empty folder"); whoever catches the divergence for
real is the disk check at materialization time, as a NAMED `failed`. It is
lexical containment with a known hole, the same one ADR 0055 already declares
and for the same reason: resolving `realpath` would require I/O where the
decision needs to be pure.

**Declared cost 2: code outside the base requires moving the folder.** This v1
supports ONE base. Whoever has repositories scattered across several places on
disk needs to move the project inside it — and the refusal message says exactly
that, instead of suggesting there is a hidden configuration. A second base (or a
list) is a product decision not taken before someone asks: each extra root is
one more root the folder browser exposes and the broker needs to distinguish.

**What this ADR does NOT decide.** It does not touch
`caminhoDeWorkspaceLocalValido` nor `projectScopeRoot` — the requirement that a
`mounted` project be inside the base belongs to the next PR, and deliberately
goes to creation/conversion, not to the predicate that runs on every read
(otherwise a legacy mounted project, outside the base, would start exploding
when READ). It does not change the schema, has no migration, and the CHECK of
the `(modo, caminho)` pair stays intact. And it does not give a container to a
`mounted` project: that is another PR, and it is there that
`BRABO_PROJECTS_HOST_BASE` gains a consumer.

---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0142 — Validation of the mounted workspace is deferred until materialization

## Context

[ADR 0141](0141-base-unica-dos-projetos-montados.md) decided WHERE a `mounted`
project lives — inside `BRABO_PROJECTS_BASE`, a single base mounted by identity
in `api` and `engine` — and explicitly left the other half for the next PR:
**when** that folder comes to exist, and who verifies that it works.

The requirement that forces the question is the product owner's, and it is
literal:

> se for `Pasta montada`, o bind-mount deve ser criado **APÓS a decisão do
> arquiteto**.

Today's code makes that impossible. `validarCaminhoDeWorkspaceLocal`
(`project-workspaces-root.ts`) runs at project CREATION and asks three disk
questions — does the folder exist? is it a directory? can the process write to
it? — and refuses with 400 when any of them fails (RN-170/RN-422). Project
creation is the FIRST screen of the flow; the Arquiteto's (Architect's) decision
(`project_image`, `module_map`, `module_routing`) happens many sessions later.
Requiring the folder ready at creation is requiring it before any decision
exists.

And the problem is neither hypothetical nor aesthetic. It is what separates
`mounted` from being a first-class choice: the creation wizard suggests
`<base>/<slug do nome>`, and a folder suggested by us is, by construction, a
folder that does not exist yet.

The `runner` mode already solved exactly this tension, and solved it well
(RN-423, ADR 0104): it validates only the LEXICON at creation — absolute, no
`..`, outside system folders, not overlapping the Brabo checkout — and leaves
the disk to whoever has authority over it, the CLI connecting on the user's
machine. The difference between the two modes was never *what counts as a valid
path*; it was **when and who** confirms the disk part.

## Decision

**`mounted` now validates only the LEXICON plus the base at creation, and the
folder is MATERIALIZED when someone with authority over the disk needs it.**

### At creation and conversion: lexicon + base, zero I/O

`validarExecutionModeEWorkspacePath` stops touching the disk in the `mounted`
branch. What it now requires is two things:

1. the same lexical predicate as `runner` (`caminhoDeWorkspaceLocalValido`),
   which holds forever and therefore also runs on every read;
2. being inside `BRABO_PROJECTS_BASE` (`dentroDaBaseDeProjetos`, ADR 0141).

The second is not extra rigor: the base is the only folder on the computer that
the api and engine containers see, so a path outside it produces exactly the
project that hangs later — which is the defect the creation validation exists to
prevent. Without a configured base, the mode **is not available in this
installation**, and the refusal says so instead of pretending the path was what
was wrong.

The project is born, like `runner`, with `workspaceVerifiedAt: null`.

### `materializarWorkspaceMontado`, and the two places that call it

The deferred verification happens again in a single function, `mkdir -p` plus
the usual three disk questions, with the refusal for being outside the base
BEFORE the `mkdir` — otherwise a path written outside the product would make the
api create a folder anywhere it reaches.

**1. `ExecuteContainerStartUseCase`** — the normal place. When Infra brings up
the container of a `mounted` project, the folder is created, proven writable,
and `workspace_verified_at` is stamped through the same path
`ConfirmProjectWorkspaceUseCase` uses. It is here that the requirement "after
the Arquiteto's decision" is fulfilled literally: `container_start` only exists
after there is a decided image.

Failing at this is a **NAMED** `failed`, never a throw, never a 500 — the same
discipline `BrokerIndisponivelError`/`RunnerNaoConectadoError` already follow in
the same file —, and the lifecycle does **not** get marked `provisioning`.
Marking `provisioning` and only then discovering it cannot be written would
leave the `project_containers` row asserting a state that never existed.

**2. `ConvertProjectExecutionModeUseCase`** — the exception, and it is declared.
Converting a project to `mounted` has no container step on which to hang the
work: it is an isolated act, and right after it MOVES the `permissions.json` to
`permissionsFilePath(localNova)`, which in `mounted` is `projectScopeRoot`,
which is the user's folder. Moving a file into a folder that does not exist
fails. So the conversion materializes at decision time — before the
transaction, so a refusal does not leave a transaction open — and becomes a 400
with the message that teaches.

### What does NOT change, and it is the easiest regression to cause here

The base rule does **not** enter `caminhoDeWorkspaceLocalValido`. That predicate
runs on EVERY READ, through `projectScopeRoot`, on a hot path: terminal scope
(ADR 0055), `permissions.json`, Code tab. A LEGACY `mounted` project — created
when the bind-mount was a compose line per project, therefore outside the base —
would start exploding with `LocalizacaoDeProjetoInvalidaError` just by being
READ, without anyone having touched it.

The base is a **creation and conversion** rule, where there is someone in front
of the screen who can still choose another path. The **lexicon is forever**.
There is a non-regression test for this, and a comment in the function itself
saying why.

### No migration, and the database CHECK stays intact

`mounted` keeps writing a NON-null `workspace_path` — the composed suggestion,
`<base>/<slug>` —, so
`(execution_mode <> 'container') = (workspace_path IS NOT NULL)` remains
satisfied byte for byte. **Deferring the VERIFICATION never touches the PAIRING
invariant**: they are different questions, and confusing them would be the
shortest path to a migration this ADR does not need.

## Consequences

**What gets better.** The product owner's requirement becomes executable: the
folder of a `mounted` project is created when the container comes up, and not
before. The creation wizard can suggest a path — which is the point of
`mounted` becoming a first-class choice — without the suggestion being refused
for not existing. And the two modes with a user folder now have the SAME
discipline at creation, which makes the difference between them (who confirms
the disk) easier to explain than it was when one touched the disk and the other
did not.

**The window between creating and materializing is real, and it is accepted.**
Between project creation and the container coming up, `workspace_path` points to
a folder that may not exist. Nothing breaks because of it — `projectScopeRoot`
is lexical, `permissions.json` degrades to `EMPTY_PERMISSIONS_FILE` (which is
`require_approval` on everything, the safe side) —, but the screen needs to SAY
it, and that is what the caveat "the folder is created when the container comes
up" does, in the container readiness PR. A screen that shows a path without
saying it does not exist yet is a screen asserting what it does not know.

**The error arrives later, and so it needs to be more explicit.** Validation at
creation had a virtue: the refusal happened on the screen where the decision was
made. Now it can happen in a `container_start` approved hours later, and so the
`failed` NAMES the variable (`BRABO_PROJECTS_BASE=<valor>`), the path, the
probable cause (owner of the folder on the host — the images run non-root, ADR
0024) and what to do next ("approve `container_start` again"). A generic
`failed` here would be worse than the old validation.

**The old message DIED, on purpose.** `comoMontar` taught how to add
`- <caminho>:<caminho>` to the `api` and `engine` services of
`docker-compose.yml`. That remedy cost a restart of both services per project —
every agent turn, terminal socket and in-flight LLM call of the installation —
and ADR 0141 replaced it with a base configured once. Continuing to teach the old
remedy would send the user to bring down the installation to solve a problem the
base already solves. There is a test assertion about the ABSENCE of that text.

**`workspaceVerifiedAt` now has two emitters.** It was only `runner`'s (RN-423).
Now `mounted` also stamps it, at materialization. The field keeps meaning
exactly the same thing — *someone with authority confirmed this path on disk,
once* —, and still is NOT a heartbeat: reconnecting does not rewrite it, and the
screen keeps saying "folder confirmed on `<data>`", never "up" (RN-468). What
changes is the OpenAPI description, which said "`container`/`mounted` never
fill this field in" and now describes the code.

**What this ADR does NOT decide.** It does not change the branching of
`ExecuteContainerStartUseCase` between broker and runner — giving a container to
the `mounted` mode through the BROKER is another PR, and this one touches the
file only to add the materialization above the existing branching. It does not
touch `caminhoDeWorkspaceLocalValido`, does not touch the `CHECK`, has no
migration, and does not touch `Engine.Actions.Workspace.ensure!/4` — the
engine's gap in `runner` mode remains declared and open in `CLAUDE.md`.

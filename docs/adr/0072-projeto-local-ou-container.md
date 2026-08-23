# 0072 — The project chooses where the code lives: user folder or managed folder

## Status

Accepted.

This ADR **revises part of [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)**,
which remains accepted and is not edited, and touches the ground that
[ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md) describes. Both
of them decided the OPPOSITE direction from this document — moving toward the
container wall — and that's why the consequences section is the most
important part here: it declares, without softening it, what is lost.

## Context

### The request

> "Cross the boundary of only writing code inside the container and be able
> to write code starting from a folder of the user's. When creating the
> project, separate **Local** to serve this purpose of being some folder of
> the user's, and **Container** with the option that already exists today."

And, regarding the shape of the path, the variant explicitly chosen by the
product owner, aware of the warning that it only works if the folder is
mounted inside the container: **a free path, typed by the user**.

### The ground: the only boundary that exists today

Before this ADR, a project's root was, literally, one line:

```ts
join(PROJECT_WORKSPACES_ROOT, workspaceDirName)
```

with `workspaceDirName` validated against `^[A-Za-z0-9_-]{1,64}$`
(`apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`). The
strength of that shape isn't in the validation: it's in the `join`. With a
segment that has no `/` and no `..`, the result **has no way to leave** the
managed root, whatever happens to the column. It's STRUCTURAL containment,
and it underpins four consumers that need to agree with each other:

| consumer | where | what breaks if the roots diverge |
|---|---|---|
| `permissions.json` | `fs-permissions-file-store.ts` | policy read from one place, applied to another |
| terminal scope (ADR 0055) | `propose-action.use-case.ts` → `decide.ts` | the scope that AUTHORIZES a command points to the wrong folder |
| Code tab reading (RN-095) | `caminhoDeRepositorioContido` | read containment over the wrong tree |
| engine working tree | `apps/engine/lib/engine/actions/workspace.ex` | the agent writes where the api doesn't read |

### What changes

`projects` gains the pair (`workspace_mode`, `workspace_path`). In `container`
mode — the default, and the behavior of every project that already exists —
nothing changes. In `local` mode, the root becomes the absolute path the user
typed, and the `join` exits the scene.

## Decision

1. **The mode belongs to the PROJECT, chosen at creation, and the default is
   `container`.** Migration `0043`. `container` as the column's default is
   what keeps existing projects from moving — and the decision is NOT NULL,
   like `story_promotion` (ADR 0046), because the value IS the decision, and
   an authority decision doesn't stay implicit.

2. **Mode and path are ONE decision, locked in the database by a CHECK**
   (`(workspace_mode = 'local') = (workspace_path IS NOT NULL)`). The lock
   doesn't stay only in the use case because the column is read by TWO
   processes (api and engine) and written by seed and backfill scripts that
   don't go through it. `local` without a path would be a terminal scope
   pointing nowhere; `container` with a path would be a second source of
   truth waiting to diverge from the first.

3. **The derivation stays SINGLE-SOURCED.** `projectScopeRoot` now receives
   the LOCATION (`{workspaceDirName, workspaceMode, workspacePath}`) instead
   of just the folder name, and it's the one that picks the branch. No
   caller gained its own validation: the reason the function exists — the
   two derivations have to agree — matters even more now that there are two
   branches. The POST-PHASE 15 rule still holds: *duplicating it in each
   caller would be a check that eventually diverges*.

4. **The creation guard refuses upfront instead of letting things break
   later (RN-170).** A path that isn't mounted inside the container produces
   a project that gets stuck on the first agent's first tool call, far from
   the screen where the decision was made. Creation validates, and refuses
   with 400 **along with instructions on how to mount it**: absolute path, no
   `..`, exists, is a folder, and is writable by the process
   (`access(W_OK|X_OK)` — the images run non-root, ADR 0024, and a host
   folder owned by someone else arrives read-only in practice).

5. **The refusal covers the system root and the Brabo checkout, in both
   directions.** `/`, the system folders, and everything below them are
   excluded because the project root is the scope that authorizes the
   agent's terminal: a project rooted at `/etc` turns "the agent can write to
   its own project" into "the agent can rewrite the container." Overlap with
   the Brabo checkout is refused in both directions — the folder that
   CONTAINS the monorepo (the literal case in the request) and the folder
   INSIDE it, which is the problem ADR 0055 reports actually happening.
   Refusing one and allowing the other would be closing the door and leaving
   the window open.

6. **The lexical part of the guard also runs on READ.** Creation's
   validation is the gate, but the only way around it is writing straight to
   the database — and when that happens, what's gained is a terminal scope
   at `/`. So `projectScopeRoot` reapplies the lexical predicate on every
   derivation and fails hard. What is NOT revalidated there is the disk part
   (exists, is writable): that's I/O, and the function sits on a hot path.

7. **The Architect's image gate (RN-105) doesn't apply to a Local project.**
   It exists because the container is what gives meaning to reading the
   code; a Local project doesn't spin up any container. Without this
   decision, the Code tab would respond 409 forever on a project where the
   Architect's decision will never happen — the tab closed by side effect,
   not by choice. The exemption lives in the same funnel as the gate, never
   scattered across routes.

8. **The engine reads both columns and resolves the locator at QUERY
   time.** `Engine.Projects.Project` returns the folder NAME in `container`
   mode and the ABSOLUTE PATH in `local` mode, and `Workspace.workspace_dir/2`
   tells the two apart by the leading slash — which is unambiguous, because
   the folder name is validated against a regex that doesn't allow `/`.
   Resolving at query time, rather than in each caller, is the same argument
   as item 3.

## What this ADR does NOT do

- **It doesn't spin up a container per project.** PHASE 25b is still cut,
  and ADR 0065 still stands as is. A `local` project runs in the SAME
  container as today; only the folder changed.
- **It doesn't change the external-effect boundary (RN-106).** `git push`,
  opening a PR, and deploy remain `deny` in the terminal, inside or outside
  the scope, in Local mode as in Container mode.
- **It doesn't change the terminal policy (ADR 0055).** Path scope and the
  narrow allowlist remain the boundary; what changes is where the scope
  starts.
- **It doesn't offer a folder picker.** The path is typed, by the product
  owner's declared decision. A picker would require the api to enumerate the
  container's filesystem for the browser, which is new surface just for
  ergonomics.

## Consequences

### The one that hurts, and is the declared price of this delivery

**The structural containment of the `join` stops existing for Local
projects.** Where before no corrupted column could ever produce a root
outside `PROJECT_WORKSPACES_ROOT`, now the root is whatever the column says.
What's left in its place is a list of refusals (item 5) and revalidation on
read (item 6) — and a list of refusals is the kind of barrier that findings
**Z and AD** already proved doesn't converge for command verbs. The
difference that supports this decision is one of space: an absolute path is
a closed, ordered space, where "is this under this root" is decidable by
prefix, while verb/form/invocation are three open spaces. It's not the same
problem, but it isn't a wall either.

**The symlink vector declared in ADR 0055 remains open, and now points at the
user's machine.** Normalization is lexical, by contract (`decide()` is pure,
zero IO), so a symlink INSIDE the project folder pointing outward isn't
detected — and, in Local mode, "outward" can be the operator's own `$HOME`.
Closing this is isolation, not policy, and still depends on PHASE 25b.

**The user's folder becomes writable by an agent.** That's the request, not
a side effect: the agent writes code into the user's folder. Worth saying out
loud that that project's `permissions.json` now also lives inside it, and
deleting the folder deletes the policy along with it.

### The ones that help

- **Nothing changes for whoever doesn't opt in.** The default is the usual
  behavior, and the existing suite passed with no behavior change — only a
  signature change.
- **The refusal is dated and instructive.** The most likely failure mode
  (unmounted folder) becomes a 400 with the compose line to add, on the
  screen where the decision is being made, instead of turning into a stuck
  agent later.
- **The gates' external contract, RBAC, and the merge lock (RN-014) are not
  touched.**

### What it requires from the operator

Mounting the folder on BOTH services, at the SAME absolute path — see
`docs/runbook.md`, section "Local-mode project", and
`docs/reference/configuration.md`. Mounting only on the api produces a
project the api accepts and the engine can't see: the api validates what it
can see, and it has no way to know what's mounted in the other container.

## Alternatives considered

- **A root of user folders, with the project choosing a SUBDIRECTORY of
  it** (`LOCAL_WORKSPACES_ROOT` + name). Would preserve the `join` and the
  entire structural containment, and was the strongest alternative — but
  it's not the request: the product owner chose a free path, aware of the
  warning.
- **Accept the path without validating and let it fail on use.** Discarded:
  it's exactly the failure mode RN-170 exists to prevent, and it shows up
  far from the screen where the decision was made.
- **Mark the Local project as "no Code tab" instead of exempting it from the
  RN-105 gate.** Would be punishing the new mode for a rule that isn't about
  it.

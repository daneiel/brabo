# 0066 — Readable workspace folder name

## Status

Accepted.

This ADR **revises [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md)**,
which stays accepted and is not edited. 0055 introduced `projectScopeRoot`
as the SINGLE function that derives
`<PROJECT_WORKSPACES_ROOT>/<projectId>` — shared because `permissions.json`
and the terminal scope (RN-075) need to agree on where the project's folder
is. This document changes WHAT goes in place of `<projectId>`, preserving
the guarantee that the two derivations (api and engine) keep agreeing.

## Context

Each project's physical folder on disk was named by the raw UUID
(`<root>/3f2b1c8e-0a5d-4f6b-9c1e-2d7a8b3c4d5e/`) — the same `projectId`
that identifies the row in the database. Browsing the folder through
Finder/Explorer (which `docs/getting-started.md` had come to allow, by
pointing `PROJECT_WORKSPACES_HOST_DIR` at a real path on disk), the user
saw a list of UUIDs with no way to tell which folder was which project
without opening each one.

The request: a READABLE folder name, based on the project's slug, while
keeping a unique id. Two mechanisms were considered (see "Alternatives
considered"); the user explicitly chose to **rename the physical folder**
rather than a symlink pointing at the untouched UUID folder.

`PROJECT_WORKSPACES_ROOT` is ONE root for the whole instance, SHARED
across all workspaces — two workspaces can each have a project with the
slug `api`. A slug alone isn't globally unique, and that's what makes "a
unique id alongside the readable name" a real requirement, not a whim.

## Decision

### 1. `projects.workspace_dir_name` is the folder name, stored in the database

A new `workspace_dir_name` column (`text`, `NOT NULL`, `UNIQUE`) on
`projects`. `projectScopeRoot` (ADR 0055) now receives this value, and
NEVER AGAIN the raw `projectId` — the two consumers the function protects
(`permissions.json` and the terminal scope) keep deriving the SAME root
because they keep calling the same function, just with the right argument.

### 2. A new project is born with `<slug>-<8 chars of the id>`; an old project keeps its UUID

`workspaceDirNameFor(id, slug)` (pure, in
`project-workspaces-root.ts`) builds the name — the same 8-character
convention `apps/web/src/lib/session-label.ts` already uses for session
labels. `CreateProjectUseCase` started generating the id in CODE
(`crypto.randomUUID()`, no longer Postgres's `defaultRandom()`): the
folder name needs the id BEFORE the `INSERT`, and there are only two ways
to have that — generate the id outside the database, or make two trips
(insert, read the generated id, `UPDATE`). The first is simpler and has
precedent in the codebase itself (`token-factory.ts`,
`emitir-sessao.use-case.ts`).

A project created BEFORE this migration keeps the physical folder it
already had: the migration sets `workspace_dir_name = id` for every
existing row — the same value that was already true on disk — and **never
renames any directory.** Renaming a working tree possibly open by an
active agent is real risk with no need for it: the old project keeps
working exactly as it worked before.

### 3. The name is FROZEN at creation, never recomputed

`UpdateProjectUseCase` allows editing the `slug` later — and that doesn't
touch `workspace_dir_name`. The alternative (recomputing the name when the
slug changes) would require moving a directory with a working tree and
possibly in-use agent worktrees, and the value of "frozen" is precisely
not having to handle that case: the physical folder is decided once and
for good.

### 4. A `BEFORE INSERT` trigger is a safety net, not the main path

`CreateProjectUseCase` always writes `workspace_dir_name` explicitly,
BEFORE the `INSERT` — that's the real path. A trigger
(`projects_workspace_dir_name_default_trg`) applies the SAME fallback
(`id::text`) to any `INSERT` that arrives without the field. The decision
to add the trigger — the first one in the product's entire migration
history — wasn't in the original request, and it's worth recording why:
more than fifty api test specs insert `projects` directly against the
database, without knowing (or needing to know) the concept of a folder
name. Without the trigger, making the column `NOT NULL` would break all of
them, and the alternative — editing fifty files to invent a plausible
`workspace_dir_name` in each, while taking care of GLOBAL uniqueness
across them — would trade one debt for a bigger one, without proving
anything more about the feature itself. The trigger never overwrites a
non-null value: whoever writes explicitly stays in control.

### 5. The engine reads the SAME column, never recomputes the name

`Engine.Projects.Project.workspace_dir_name/1` queries the column
directly. `Engine.Actions.Workspace.workspace_dir/1` (which used to be
`Path.join(root, project_id)`, a pure function) now resolves the name
through this query, with a fallback to the raw `project_id` when the query
finds no row, when `project_id` isn't shaped like a UUID, or when the
query fails for any reason (broad `rescue`/`catch` — degrading is always
preferable to propagating a PATH-resolution failure to a caller that just
wanted a directory).

This is the point that guarantees ADR 0055's invariant survives the
change: api and engine don't implement two formulas that need to agree by
coincidence — both read the SAME row from the SAME database. If they ever
diverged, it would be because one of them stopped querying, not because
the formula changed on one side only.

`workspace_dir/1` is **not a hot path**: the dev agent's tool loop
(`search_workspace`, `write_file`, `read_file`) already receives
`ctx[:workspace_root]` PRE-RESOLVED — resolved once, when
`Engine.Dev.WorktreeManager.create/3` sets up the agent's worktree — and
only falls back to `workspace_dir/1` for the callers that don't go through
that `ctx` today (`worktree_manager` internally, `instruction_files`,
`TerminalExecutor` via `ensure_remoto`). None of those runs on every tool
call.

`Engine.Dev.WorktreeCleanup` (the periodic sweep of orphaned worktrees)
was the exception that required its own design: before RN-109, the folder
name WAS the `project_id`, and sweeping the disk (`File.ls(root)`) and
treating each entry as an id was a valid reading. With readable folder
names, the folder stopped being the id, and there's no way to go from one
to the other without querying. The fix changes the iteration source:
instead of sweeping the disk, it queries `Project.all_workspace_dirs/0`
(all `{id, workspace_dir_name}` pairs in a single query) and uses the
resolved `work_dir` directly — neither this function nor `WorktreeManager`
makes a second per-project query to look up the name again.

## Consequences

**Accepted.** One new column, one new trigger (the product's first — see
item 4), two pure functions (`workspaceDirNameFor` in the api,
`workspace_dir_name/1` in the engine), and extending
`Workspace.workspace_dir` from pure to DB-aware-with-fallback.
`WorktreeCleanup` switched its iteration source from disk to database —
the same cost of ONE query, never per project.

**Out of scope.** Renaming an existing project's folder to the readable
format isn't implemented, nor was it requested: it would require moving a
working tree possibly open by an active agent, and the value of the
readable name is cosmetic, not worth the risk. Whoever wants the readable
folder creates a new project.

**What does NOT change.** RN-075 (terminal scope) and RN-092 (code
reading, Code tab) keep pointing at the SAME folder the engine actually
uses — it's that agreement, not the shape of the name, that the two ADRs
protect.

## Alternatives considered

- **A symlink pointing at the untouched UUID folder** — lower risk (the
  physical working tree never moves, it just gets a readable shortcut
  next to it). This was the initial recommendation. The user explicitly
  decided on the other option: actually renaming the folder, with no two
  entries per project on disk.
- **Recomputing the name on every slug change** — rejected: it would move
  a directory potentially in use, for a cosmetic gain. "Frozen at
  creation" avoids the whole category of bug.
- **`NOT NULL` column with no trigger, editing fifty test specs by hand** —
  rejected on cost/risk: fifty files edited by hand to invent plausible
  names, with the extra care of GLOBAL uniqueness among them, proves
  nothing more about the feature than the trigger already proves with
  three tests.

## References

- [RN-109](../business-rules.md#rn-109) — the folder name is frozen at
  creation, and an old project keeps its UUID.
- [RN-075](../business-rules.md#rn-075) — path scope in terminal policy
  (what this ADR preserves).
- [RN-092](../business-rules.md#rn-092) — path containment in code reading
  (ditto).
- [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md) — the
  document revised here.

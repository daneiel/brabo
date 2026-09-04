# ADR 0111 — Converting `execution_mode` on an existing project: refuse with an active dev agent, relocate `permissions.json`, retire the container row

- **Status:** Accepted
- **Date:** 2026-08-23
- **Context:** closes the "converting `execution_mode` on an EXISTING project" backlog item (Wave 2 of the runner/execution_mode batch, `docs/explanation/backlog.md`), corrects ADR 0104 item 4
- **Revises (without editing):** [ADR 0104](0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md) (item 4's claim), [ADR 0072](0072-projeto-local-ou-container.md), [ADR 0081](0081-ciclo-de-vida-do-container-vira-tabela-sem-orquestrador.md)

## Context

ADR 0104 (Wave 1 of the same batch) introduced the three-value
`execution_mode` (`container`/`mounted`/`runner`) at project CREATION and,
in item 4, claimed as a *consequence* — not something it designed — that
converting between the three modes on an existing project "stops requiring
recreating the project." That sentence was written before anyone had
traced what actually points at the old scope. Wave 1's own implementation
found it was wrong and recorded the correction in `backlog.md` instead of
editing the accepted ADR: `UpdateProjectDto` still deliberately excludes
`executionMode`/`workspacePath` (`apps/api/src/interfaces/http/iam/dto/update-project.dto.ts`)
because three things point at the old (mode, path) pair and none of them
follow a bare column `UPDATE`:

- `permissions.json`, physically written at `projectScopeRoot(project)` —
  a different filesystem location for every mode (`fs-permissions-file-store.ts`);
- `project_containers` (ADR 0081), whose only valid state machine assumes
  `execution_mode = 'container'` — `RegistrarTransicaoDeContainerUseCase`
  refuses (400) to touch the row otherwise;
- a running `Engine.Dev.DevAgentServer`, which captures `workspace_root`
  ONCE, in its GenServer state, at worktree-creation time
  (`Engine.Actions.Workspace.ensure_remoto/2` →
  `workspace_dir/1,2` → `Engine.Projects.Project.workspace_dir_name/1`) —
  the engine-side twin of `projectScopeRoot`. Flipping the DB column
  underneath a live agent does not move it; only the NEXT worktree
  resolves against the new location.

This ADR designs the conversion Wave 1 deferred, and closes the correction
recorded in `backlog.md` — the claim in ADR 0104 item 4 becomes TRUE again,
via the mechanism below, not by editing the accepted text.

## Decision

### 1. A dedicated route, not a loosened `UpdateProjectDto`

`PUT /projects/:projectId/execution-mode` (role `maintainer` — the same
gravity CLAUDE.md already assigns to changing `max_parallel`/area budget:
"changing the ceiling is deciding how much the product spends without
asking"), backed by `ConvertProjectExecutionModeUseCase`. `UpdateProjectDto`
keeps excluding the two fields, and its comment now points here instead of
just describing the gap. The generic `PATCH` is a column write; conversion
is an ORCHESTRATION — validate the new (mode, path), refuse on an active
dev agent, relocate `permissions.json`, retire the container lifecycle row
when leaving `container`, and only then write the column — mixing that
into the generic DTO would make the simple case (renaming a project) carry
the complexity of the rare one.

### 2. RN-447 — refuse (409) while any dev agent of the project is non-idle; never drain/migrate

The concurrency hazard is real, not theoretical: `DevAgentServer` doesn't
re-resolve its worktree location, so converting under a live agent would
leave it writing to a scope that `permissions.json` and the terminal's
path policy (ADR 0055) have already abandoned. The check reads
`engine.dev_agent_states` directly — cross-schema, same physical database,
same precedent as RN-409's `onlineAgentCount` — for `status <> 'idle'`
across ALL sessions of the project (not one session's event log, unlike
`GetSessionPendingWorkUseCase`, which is scoped per session and would need
querying every session the project ever had). `idle_tripped` counts as
active on purpose, unlike RN-409's online count: a circuit-broken agent
still holds a captured `workspace_root` and needs a human to unblock it,
even though it isn't "online" by RN-409's definition — the two questions
("is anyone watching this agent work" vs. "does anyone have a scope
pointer that would go stale") are different, and RN-409's exclusion of
`idle_tripped` doesn't transfer here.

The decision is to REFUSE and explain, never to drain or force-migrate a
live agent — same "refuse and teach" pattern as RN-088/RN-422's
disk-validation messages. Building a migration path for an in-flight agent
would mean either killing its process mid-task (losing whatever it hasn't
committed) or teaching it to re-resolve its scope live, which no other
part of the product does either.

### 3. RN-448 — `permissions.json` is RELOCATED, its content never changes

`PermissionsFileStore` gained `move(from, to)`: reads the file at the OLD
`projectScopeRoot`, writes the SAME content at the NEW one, then
best-effort deletes the old file. The content (`allow`/`deny`/`ask`
patterns) carries no path or execution_mode inside it — it's pure policy
history ("this exact command was always-approved"), so there's nothing to
rewrite, only where the physical file lives. Verified by tracing
`projectScopeRoot` end to end (`project-workspaces-root.ts`): for
`mounted`/`runner` it returns `workspacePath` itself, treated as a path
inside the API CONTAINER's own filesystem — for `runner` this is already
true today, even without conversion, since there's no bind-mount; the
file physically lives at a path that only coincides in STRING with the
user's real folder, disconnected from it. Conversion doesn't change this
existing property, it just relocates the file consistently with it — no
special-casing needed for `runner` beyond using `move()` like any other
pair.

### 4. RN-449 — leaving `container` retires the `project_containers` row before the column flips

If `execution_mode` is `container` today and the target isn't,
`RegistrarTransicaoDeContainerUseCase` drives the container lifecycle row
(when one exists) to `removed` — through `stopped` first when it's
`running`, since `container-lifecycle.ts`'s state machine has no direct
`running -> removed` edge — BEFORE the project's `execution_mode` column
changes. Ordering matters: `RegistrarTransicaoDeContainerUseCase` itself
refuses (400) any transition on a project that isn't currently
`execution_mode = 'container'`, so calling it after the flip would always
fail. Entering `container` FROM `mounted`/`runner` does the opposite of
nothing: no auto-provisioning — the Architect's image gate (RN-105) and
the normal container lifecycle apply from that point on, exactly as for
any `container` project, never a fast path that skips the gate because the
project "used to have code somewhere."

### 5. RN-450 — `workspaceVerifiedAt` resets to `null` on every real conversion

It only means something for `runner` (RN-423): a timestamp proving a
connected runner confirmed the path on the real host. Any conversion —
including one that lands back on `runner` with what looks like the same
path — forces a NEW confirmation, because the old timestamp attests to a
path check that happened under a DIFFERENT (mode, path) pair; carrying it
forward would assert a confirmation that never happened for the new state.

### 6. Same (mode, path) as today is a no-op — by design, not by accident

If the requested pair resolves to exactly what the project already has,
the use case returns the project untouched: no dev-agent check, no
`permissions.json` move, no `workspaceVerifiedAt` reset. Re-submitting the
same form shouldn't cost a live-agent scan, and shouldn't silently
un-verify an already-confirmed `runner` project.

## Consequences

**What this ADR does NOT move: the code already on disk.** Conversion
never copies files between the old and new scope roots. This is
deliberately not a gap the implementation tries to paper over — it's a
consequence of how the engine already derives a workspace
(`Engine.Actions.Workspace.ensure!/4`, `apps/engine/lib/engine/actions/workspace.ex`):
a workspace directory that isn't already marked ready gets `git init` +
`fetch` from the project's BARE repo (the actual source of truth) on the
next worktree creation, regardless of which (mode, path) the column now
points at. Committed work is safe — it lives in the bare repo and gets
checked out fresh at the new location. **Uncommitted changes in the
abandoned old worktree are not migrated and not deleted — they're
orphaned in place**, physically still on disk at the old scope root
(recoverable by hand, never automatically) but invisible to the product
from the moment of conversion on. RN-447's guard reduces this risk (no
conversion while an agent is actively `working`) but does not eliminate
it: an `idle` dev agent between tasks could still be sitting on an
uncommitted diff, and nothing here inspects working-tree cleanliness
before allowing the conversion.

**What this ADR does not build:** a way to convert the SAME project to a
mode it's already fully equivalent to without a "changed" flag tripping —
not needed, see Decision 6. It doesn't touch `UpdateProjectDto`, doesn't
add a migration (`ProjectRepository.update` already accepted these three
columns since ADR 0104/RN-423's `ConfirmProjectWorkspaceUseCase`), and
doesn't change the terminal path-scope policy (ADR 0055) or the image gate
(RN-105) beyond what Decision 4 already states.

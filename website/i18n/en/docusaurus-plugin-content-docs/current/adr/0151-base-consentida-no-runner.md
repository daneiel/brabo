---
traducao_de: 213fbcc7470e8f4bae01648d030a1e3437751cf6
---

# ADR 0151 — The base consented in the runner, and folder creation through the channel

## Status

**Proposed.** A deliberately narrow cut: the **per-machine** runner was left out
of [PHASE 29](../explanation/fase-29-instalacao-de-uma-linha.md) and is declared
as the scope of the next phase, with the measurement already done (see
Consequences).

## Context

The product direction is for the user to choose a project on the web and **see
the folder appear** on their machine. Today that does not happen, and the reason
is not a lack of an agent — `brabo-runner` already lives there. It is that it is
born with no notion of where things live.

**The runner has no base.** The only root is `--dir`, resolved by `resolverDir`
(`apps/runner/src/guard.ts:221-227`) against `INIT_CWD ?? process.cwd()`;
without `--dir`, the root **is the cwd** (`apps/runner/src/index.ts:242-250`).
`estado.dir` (`index.ts:366-368`) is *one* path, singular, and it is what goes
to `validarCwdDentroDaRaiz`, to the `GerenciadorDePty`, to `cwdParaContainer`
and to the `workspace_confirm` (`index.ts:725`). There is no constant,
environment variable nor base field in `apps/runner/src/` — the word only
appears in comments.

**The base exists, but in the api, and it is forbidden to go down.**
`apps/api/src/infrastructure/filesystem/project-workspaces-root.ts` has
`baseDeProjetos()` (`:68`), `dentroDaBaseDeProjetos` (`:93`) and
`segmentoSobABaseDeProjetos` (`:116`) — and the same file **forbids in writing**
(`:421-438`) the base rule from entering `caminhoDeWorkspaceLocalValido`,
because that predicate runs on **every read** and a legacy mounted project
outside the base would explode when read. The base is a **creation and
conversion** rule.

**There is an exact precedent of a sibling guard.**
`apps/runner/src/espelho-guard.ts` was born reusing the three helpers of
`guard.ts` (`:51`) and implements the loop refusal by **segment** —
`dentroDoEscopo(destino, workspace)` and `dentroDoEscopo(workspace, destino)`
(`:214`, `:223`) —, never raw `startsWith`, with the reason written at
`:152-154`: *"`/base-outra` NÃO está dentro de `/base`"*.

**And there is an invariant this ADR cannot break.** Since
[ADR 0130](0130-broker-de-container.md), no absolute path crosses the network:
whoever has the root is whoever executes, and what travels is the **relative
segment** plus a discriminator of which root it applies against
([ADR 0144](0144-a-segunda-raiz-do-broker.md)).

## Decision

### 1. The runner is born with a base, consented in the installer

`install.sh` ([ADR 0150](0150-instalador-de-uma-linha.md)) consents **one** base
and writes it to the runner's local configuration. Each project is a
**subfolder** of it. `--dir` still exists and still means what it always meant —
it is the legacy binary of RN-514, and breaking it would be `breaking/` with no
gain.

The base is **local**, never received over the network. It is the same design
as the broker (ADR 0144): the root belongs to whoever executes; the server sends
the **segment**.

### 2. The guard reuses the rule, it does not copy it

Validation of the base and the subfolder reuses `semBarraFinal`,
`dentroDoEscopo` and `realpathMaisProximo` from `guard.ts` — which are already
exported precisely for that (`guard.ts:33-43`, when `espelho-guard.ts` was
born) — and the per-segment loop refusal of `espelho-guard.ts:208-233`. **No
fourth copy of the rule is born**: RN-515 already established that on the api
side, when `validarDestinoDeEspelho` reused `caminhoDeWorkspaceLocalValido`
(`apps/api/src/application/services/workspace-location.ts:132-136`) instead of
rewriting it.

It inherits in writing the same TOCTOU caveat of `guard.ts:9-31` and
`espelho-guard.ts:30-39`: this is best-effort and is not the security boundary,
which remains authentication plus the approval pipeline.

### 3. The new message asks for creation, and the confirmation reuses what already exists

A new pair on the channel, in the **request with response** mold
(`exec`/`exec_result`, `terminal_channel.ex:563-567` and `:737-749`), because
whoever asks needs to know whether it worked:

- `workspace_create` — engine → runner: `projectId` and the **segment relative
  to the base**. Never an absolute path.
- `workspace_create_result` — runner → engine: success with the final path, or
  a **named** error.

The runner does `mkdir -p` and then `git init` or clone. Having succeeded, it
sends the **`workspace_confirm` that already exists** (`channel.ts:577-582`),
and it is that which writes — through the path already built and tested:
channel → engine → internal HTTP → `ConfirmProjectWorkspaceUseCase`, which
revalidates the lexicon (`confirm-project-workspace.use-case.ts:83`), is
idempotent (`:93-95`) and writes `workspaceVerifiedAt`.

This is deliberate and saves a whole front: **no new write route is born**, the
engine still **does not write the table**, and the only path that stamps
`workspace_verified_at` remains a single one.

A precision record, because the name circulated: **`workspace.verified` does not
exist** in the repository — neither event, nor message, nor route. What exists
is the `project.workspace_verified` event
(`confirm-project-workspace.use-case.ts:107`) and the `workspace_verified_at`
column. And `workspace_confirm` is **unidirectional**:
`terminal_channel.ex:356-373` answers `{:noreply, socket}` and pushes nothing
back — which is why the new pair cannot be modeled on it.

### 4. A capability declared only when implemented

`workspace` enters the vocabulary of `Engine.Runners.Capacidades`
(`capacidades.ex:72`) **in the session in which the code enters**, never before
— the lesson of RN-514, where declaring `espelho` without implementing it would
be exactly the silent defect the negotiation exists to prevent. An unknown name
is still ignored; a required and undeclared capability still refuses the join
with the name of what is missing.

### 5. Its own predicate, and `RunnerReadiness` stays byte for byte

Two preconditions — runner connected, base consented — in its **own** module, in
the mold of `Engine.Runners.Espelho` (`espelho.ex:82-99`). It does **not**
require a container: creating a folder is a filesystem operation on the user's
machine, with no container to fall from.

The temptation and the refusal are written down, and this ADR adopts them
literally (`espelho.ex:19-24`):

> A tentação óbvia seria `RunnerReadiness.verificar(project_id, pular_container:
> true)`. O ADR 0147 recusa isso por escrito, e a razão é mecânica: uma função
> compartilhada com flag "pula container" é precisamente o caminho pelo qual a
> terceira pré-condição cai POR ACIDENTE para o `exec` numa refatoração futura
> — e o ADR 0145 existe para ela não cair.

### 6. It is not `proposed_action`

Creating the folder of the project the user just asked for is **consented
configuration**, not an agent asking to act. None of this becomes a
`proposed_action`, and no policy ceiling gains an exception — the same line the
mirror already established (RN-516).

### 7. The web reads the base through the runner

The creation picker in `runner` mode uses `fs_list_dir`, which exists on both
sides (`apps/runner/src/fs-browser.ts:53`, `terminal_channel.ex:489`) and whose
transport in the web (`apps/web/src/lib/fs-browser-channel.ts:66`) has had **no
effective caller** since RN-504 — kept by a decision declared in
`apps/web/src/routes/NewProjectWizard.tsx:880-882`. It gets its caller back. The
`mounted` mode's path, which goes through the api
(`GET /workspaces/:workspaceId/project-folders`), stays **intact**.

## What this ADR explicitly rejects

- **A per-machine runner in this phase.** See Consequences: there are five
  independent couplings, and tackling them together with the installer would
  concentrate two big risks in the same phase.
- **`RunnerReadiness` with a flag.** By the quotation in decision 5.
- **A fourth copy of the path rule.**
- **An absolute path crossing the network.** Invariant of ADR 0130.
- **Merging this with the mirror.** They are different messages, with different
  directions and triggers; the mirror copies outside the base, this creates
  inside it.

## Consequences

- The user chooses the project on the web and the folder appears — no terminal,
  no manual `git init`.
- **The runner remains paired per project.** The five measured couplings, which
  PHASE 30 will have to cross: the `terminal:<projectId>` topic
  (`channel.ts:422`, `terminal_channel.ex:172`), the socket id
  `runner_socket:<kind>:<project_id>:<user_id>` (`runner_socket.ex:71-73`), the
  project-scoped ticket (`socket_ticket.ex:10-13`), the
  `runner_device_keys.project_id NOT NULL` column
  (`apps/api/src/db/schema/auth.ts:325`) and the unit name
  (`servico.ts:263-265`, `:392-394`). One of them is a migration; another is
  `breaking/`.
- **Revocation still reaches `{projeto, usuário}`** (RN-520), which in this
  phase keeps the current cost. When PHASE 30 unifies the runner per machine,
  revoking will bring down **all** the projects of that machine — declared here
  so it is not discovered there.
- The git credential discarded in `docker exec` in `runner` mode (ADR
  0130/0145) is **not affected**: this message's initial clone runs on the
  **HOST**, through the path that carries the credential. The gap remains where
  it was.

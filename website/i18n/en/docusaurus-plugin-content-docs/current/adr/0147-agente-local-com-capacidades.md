---
traducao_de: 285d458e5d984ace5ddf0fb39263b3b1ae7e8ff0
---

# 0147 — One local agent, capabilities declared on connection

## Context

`brabo-runner` (ADR 0104/0105) was born for a single thing: executing, on the
user's machine, a command already approved by the `proposed_action` pipeline.
Since then it has accumulated functions without the protocol saying anything
about it — interactive PTY (`apps/runner/src/pty.ts`), folder browsing
(`apps/runner/src/fs-browser.ts`), and since ADR 0137 the lifecycle of a Docker
container ON THE USER'S MACHINE. PHASE 28 wants to add one more: a **mirror**,
which copies the agents' work to a folder the user chose, outside the mounted
base.

The temptation is a second binary. It pays off badly: it would be two
installations, two authentication models, two revocations, and two things for
the user to stop when they wanted to stop. And the product already has the live
process on the user's machine — the problem is not a lack of an agent, it is
that the current agent cannot say what it knows how to do.

**Today the `join` is mute on both sides.** The runner sends empty params —
`socket.channel(\`terminal:${projectId}\`, {})` (`apps/runner/src/channel.ts:304`)
— and the server literally ignores them: `def join("terminal:" <> project_id,
_params, socket)` (`apps/engine/lib/engine_web/channels/terminal_channel.ex:99`).
All identity comes from the ticket: the role (`:runner` or `:web`) comes from the
`kind` (`terminal_channel.ex:110`, `papel_do_kind/1`), and the server has no way
of knowing whether the binary on the other side is a version that understands
`mirror_sync` or one that will silently ignore the message. The only data the
runner declares about itself is the `workspace_confirm` pushed after the join
(`apps/runner/src/index.ts:530`).

An agent that gains capabilities without negotiating them degrades in the worst
possible way: the message arrives, the handler does not exist, and nothing
happens — no error, no log, nobody knowing the mirror never ran.

## Decision

**One local agent, with capabilities declared in the `join` and granted by the
server.** Three capabilities to start: `exec`, `pty`, `espelho`.

### 1. Where it is declared and where it is granted

The runner **declares** in the place that is empty today: the `join` params
(`channel.ts:304`). The server **grants** in `autorizar_por_papel/2`
(`terminal_channel.ex:110-138`) — the same point that already builds
`socket.assigns` with `:role`, `:pending_execs` and `:open_pty_refs` —,
computing the **intersection** between what the runner declared and what the
project's `execution_mode` requires.

The granted set lives in `socket.assigns`, **never in a table**. It is the same
reasoning that keeps `containerAtivo` on the client side
(`apps/runner/src/index.ts:270-277`: *"a decisão é INTERNA ao runner, o engine
não sabe disso e não precisa saber"*) and that makes the `:global` entry of
`Engine.Runners.Registry` die together with the pid: a capability is a property
**of that connection**, not of the project nor of the user. A table would create
the possibility of the database asserting that a runner knows how to do
something the process connected now does not.

**A required and undeclared capability refuses the `join`.** The runner already
treats `JoinRecusadoError` as fatal without retry (`index.ts:725-732`, with the
comment that explains why: *"Recusa não é transitória… encerra com mensagem
clara, SEM laço automático"*), and it is exactly the right shape — a runner too
old for the project should not stay in backoff retrying with the same binary. It
is also where the `Registry` already refuses the second runner of the same
project (`terminal_channel.ex:126-135`), so the capability refusal is born next
to a refusal the user already knows.

**Why in the `join` and not in a push afterwards, like `workspace_confirm`.**
That one talks about the *workspace*, which changes between executions and is
confirmed by the runner that has authority over the disk (RN-423). Capability
talks about the *binary*, which is fixed at the instant of the connection.
Declaring after the join would mean a window in which the server has already
accepted the connection and does not yet know what it knows how to do — and it
is in that window that the first message arrives.

### 2. Mirror: one direction, never deletes, its own scope

`apps/runner/src/espelho-guard.ts` (new), **sibling of `guard.ts`, not an
extension of it**. It reuses `realpathMaisProximo` and the
lexical-then-realpath double pass of `validarCwdDentroDaRaiz`
(`guard.ts:134-170`) — the second pass is what today catches a symlink in a
middle segment, with the TOCTOU caveat already written there.

It refuses three things:

1. a symlink that escapes the destination;
2. a destination that **contains** the workspace;
3. a destination **inside** the workspace.

The last two are the same loop, in opposite directions: with the identity bind
of ADR 0141, writing the mirror inside the origin makes the mirror copy the
mirror itself.

**One direction only** — workspace → destination. **Never `--delete`, never
`unlink`.** A file deleted in the workspace remains in the destination. That is a
decision, not carelessness: the user's folder is not a replica, it is an
accumulation — and an agent that deletes a file in someone's personal folder
because of a `git clean` on the other side is exactly the kind of surprise the
whole product exists not to produce.

### 3. The mirror does not require Docker

`Engine.Runners.RunnerReadiness` stays **byte for byte as it is**
(`apps/engine/lib/engine/runners/runner_readiness.ex:44-61`), with its two usual
consumers (`TerminalExecutor` and `Engine.Actions.Workspace.RunnerGit`).

The mirror gains its **own predicate**, with the two preconditions it actually
needs — workspace confirmed and runner connected — and **never** a
`RunnerReadiness` with a parameter. A shared function with a "skip container"
flag is precisely the mechanism by which the third precondition falls by
accident for `exec` in a future refactor, and ADR 0145 exists so that third
precondition does not fall.

Why the mirror legitimately does not need it: the third exists because a
command without a container **fell onto the HOST silently** (ADR 0145) — there
were two possible executions and the wrong one was invisible. The mirror has no
such ambiguity: it is a file copy on the user's machine by definition, with no
container to fall from. Requiring Docker there would be importing a precondition
without the defect that justifies it, and the cost would be real — the mirror is
precisely the capability that must work for whoever does not want Docker.

### 4. Consent per project and per destination

The destination is **per project**, declared by the user, and travels to the
runner **inside the capability granted in the join**. The runner refuses
`mirror_sync` for a destination not granted to it in that connection.

Never a global configuration in the runner, never an environment variable: a
global destination would make project B's artifact land in project A's folder,
and the user would find out from the content, not from an error.

### 5. User service

**User level, always**: `systemd --user` on Linux, `LaunchAgent` on macOS.
**Never a system service, never root.** The runner runs with the user's
privileges *by design* — `guard.ts:9-31` declares that as the premise of the
whole guard (*"O runner roda NA máquina do usuário, com os privilégios DELE"*) —
and a root service would break the invariant on which the three real boundaries
of that docblock rest.

Subcommands `brabo-runner service install | uninstall | status`. Removal is
complete: unit file, `brabo-runner.config.json` and
`brabo-runner-device-key.jwk.json`.

**The precedent is zero**: there is no mention of `systemd`, `launchd` or
`LaunchAgent` in `apps/runner/`; the model today is foreground, terminated by
SIGINT/SIGTERM (`index.ts:709-717`). Windows stays **out of scope, declared** —
the build matrix already produces the binary (ADR 0112), but a user service on
Windows is a third mechanism, not a variation of the two.

Desired side effect: **BRB-031** (the manual `chmod +x` left over from ADR 0118)
dies if installation comes from the versioned bootstrap of ADR 0146.

### 6. Revocation stops being blind, and starts reaching the live connection

Revocation exists: `DELETE /projects/:projectId/runner-device-keys/:deviceKeyId`
(`apps/api/src/interfaces/http/runner/runner-device-keys.controller.ts:82-83`,
`developer`, 204, idempotent). **But there is no way to see what is being
revoked.**

The controller's docblock (`:39-40`) declares the cut as *"sem a visão de
`maintainer` (listar/revogar de qualquer usuário) que o PAT tem"* — and the real
cut is bigger than it says. `PersonalAccessTokensController` has **five**
routes: `@Post()`, `@Get()` and `@Delete(':tokenId')` for the user themselves
(`developer`), plus `@Get('all')` and `@Delete(':tokenId/admin')` for
`maintainer` (`personal-access-tokens.controller.ts:63,86,97,113,127`). The
device key controller has **two**: `@Post()` and `@Delete(':deviceKeyId')`. It
is not only the `maintainer` view that is missing — the **owner's own** listing
is missing. Nobody revokes what they cannot see, and an orphan key (tab closed
in the middle of the ADR 0118 flow) is today invisible and permanent.

The ADR closes it with `@Get()` in the same shape the PAT already has, role
`developer`. The `maintainer` view remains out of scope, now by decision and not
by omission.

Second hole, of the same size: **revoking today only prevents a new ticket.** An
already connected runner keeps the channel until it drops on its own, with the
key revoked. Revocation now **brings down the live connection** —
`Engine.Runners.Registry.whereis/1`
(`apps/engine/lib/engine/runners/registry.ex:45`) already delivers the pid, and
no new mechanism is needed to reach it.

### 7. Visible state

The runner pushes the state on the channel, in the same shape as
`workspace_confirm` (`index.ts:530`) — the only precedent of the runner telling
something about itself.

Stored together with the project's other runner facts, **not in the event log**:
it is connection telemetry, not a session domain event, and
`session_events.session_id` is `NOT NULL`. It is the same reasoning that made
`rag_searches` become a table instead of an event (RN-479): when what one wants
to measure has no session, the event log is the wrong place.

Three fields — last sync, count, last error — and **"never looked" never
collapses into "looked and found nothing"**, the three states of RN-088. A mirror
that never ran and a mirror that ran and copied nothing are different
situations, and the screen needs to be able to say which of the two.

### 8. Trigger by event, never a watcher

The engine pushes `mirror_sync` at **named moments** — end of an agent turn,
commit. **Never `fs.watch`.**

A watcher is unbounded work triggered by anything: by a dependency install, by a
build, and — worse — by the mirror's own writes, which is a loop. Besides, it
would run continuously on the user's machine without anyone having asked, which
is the opposite of what "local agent" should mean.

## Consequences

- **Configuration consent is not action approval, and the mirror stays on the
  configuration side.** The mirror's write does **not** go through
  `proposed_action`: it is not an agent asking to act, it is the system writing
  to a path the user declared when configuring the project. The opposite —
  syncing via a terminal command — would fall into ADR 0055's path scope, would
  become a queue of routine approvals and would erode precisely the ceiling that
  gives meaning to the click: a queue in which almost everything is routine
  trains the person to approve without reading.
- **Invariants this ADR does not touch**, and declares it does not touch:
  `decide.ts` and the absolute ceilings; `proposed_action` as the origin of every
  external agent effect; the immutability of the event log; the image gate in
  the three modes (ADR 0135); the five operations and the computed spec of the
  broker (ADR 0128/0130).
- **An old runner connected to a project that requires `espelho` stops
  connecting.** It is an explicit refusal in the `join`, with a message — not
  silent degradation. The cost is real: updating the binary becomes a
  prerequisite for using the new capability, and whoever installed through the
  ADR 0118 flow has no automatic update (BRB-005/BRB-031 touch the same point).
- **The mirror destination accumulates.** Without `--delete`, a file removed in
  the workspace remains there forever, and no automatic mechanism cleans it. It
  is the direct price of "never deletes in the user's folder", and the
  alternative is worse.
- **Assumed gaps, not closed here:**
  - git credential discarded when the `exec` routes through `docker exec` —
    `apps/runner/src/index.ts:311-320`; `packages/docker-port` has no `env`
    field, on purpose (ADR 0130), and ADR 0145 already declared the cost;
  - a symlink from inside the project pointing outside is not detected by the
    policy decision (ADR 0055), and `guard.ts:9-31` is best-effort by invariant
    — `espelho-guard.ts` inherits the same TOCTOU caveat;
  - exclusivity by `{project_id, machine_id}` remains deferred (ADR 0137), so
    the same project on two machines remains one runner at a time through the
    `Registry`, not one identity per machine;
  - **BRB-005**: neither the images nor the runner binaries are signed. A local
    agent that gains the ability to write outside the base makes the binary's
    provenance more important, not less.
- **Sibling of this phase**: [ADR 0146](0146-base-consentida-no-bootstrap.md)
  decides the base consented at bootstrap and `mounted` as the local default.
  The two split like this: 0146 covers the folder the bind reaches, this one
  covers the destination it does not reach.

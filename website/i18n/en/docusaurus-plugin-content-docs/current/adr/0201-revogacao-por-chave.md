---
traducao_de: 59101794d7e56c79f23e05e8947478bbd89694fb
---

# ADR 0201 — Revocation targets the KEY, not the `{project, user}` pair

## Status

**Accepted.** 2026-10-01 (AT-013, story HS-008, epic EP-003, round 36; owner
decision on 01/10: *"yes, revocation by KEY, with an ADR — key column in the
socket ticket and a new auth contract; revoking drops only the connections opened
with that key. It touches the engine, on purpose."*). Revises
[RN-520](../business-rules.md#rn-520) — born in
[ADR 0147](0147-agente-local-com-capacidades.md) point 6 — and references,
without editing them, [ADR 0154](0154-chave-de-dispositivo-de-maquina.md) (the
MACHINE key, which put *"Revocation by key"* among what it did NOT do) and
[ADR 0155](0155-a-primeira-conta-nasce-no-terminal.md) (the machine key born in
the terminal and registered by the installation). New rule:
[RN-685](../business-rules.md#rn-685).

## Context

Since RN-520, revoking a device key drops the runner's LIVE connection, and not
only the next ticket. The target of that drop was `{project, user}`, and RN-520
said why: the identity of the credential that requested the ticket — the key's
`kid` (which is the record id, RN-475) or the PAT — died in the `PatAuthGuard`.
`runner_socket_tickets` stored `project_id`, `user_id` and `kind`, and nothing
else; the channel only knew how to compare the user.

Measured in the code before changing (`origin/dev`, `ec0fbea52d`):

- **How the ticket is born.** `POST /projects/:projectId/runner-ticket` goes
  through `PatAuthGuard`, which authenticates by PAT (`validarEUsar` returns
  `{id, userId, projectId}`) or by device key (the JWT header's `kid` finds the
  public key in `runner_device_keys`; `chave.id` is that `kid`). The guard set
  only `request.user`. `RequestRunnerTicketUseCase` asked the engine
  `POST /internal/projects/:projectId/runner-tickets` with `{userId, kind}`, and
  `Engine.Runners.SocketTicket.emitir/3` recorded the row.
- **How the engine consumes.** `EngineWeb.RunnerSocket.connect/3` validates the
  ticket and puts `project_id`/`user_id`/`kind` in `assigns`; the socket's
  `id/1` was `runner_socket:<kind>:<projectId>:<userId>`; the channel's `join/3`
  consumes and registers the presence in `Engine.Runners.Registry` (`:global`,
  at most ONE runner per project in the cluster).
- **Where revocation dropped.** `RevokeRunnerDeviceKeyUseCase` records the
  revocation and calls `disconnectRunnerOfUser(projectId, userId)` —
  `POST /internal/projects/:projectId/runner/disconnect` —, the engine finds the
  pid through the `Registry`, the channel compares `user_id` and broadcasts
  `disconnect` to its OWN id. For the MACHINE key (null project) PR #534 made the
  target PLURAL: the same pair, once per `runner`-mode project the owner reaches
  (`listRunnerModeReachableBy`).
- **What drops today that should not.** The same user's runner connected with a
  PAT, or with another key, in that project. With the machine key, the cost
  multiplies: revoking the laptop's key drops the desktop's agent in every
  project where both cross.
- **What does NOT drop today and should.** (1) The machine key's connection in a
  project the api's list does not have — an owner's role that dropped, a project
  converted in mode with the runner up. (2) The ticket requested seconds BEFORE
  the revocation and used AFTER: `connect/3` and `join/3` do not ask about the
  credential. (3) Revoking a PAT dropped nothing — it only prevented a new
  ticket.

AT-013 was blocked for two stacked reasons: it was outside the PHASE 30 cut, and
changing the target is changing what "revoke" means. The owner decided.

## Decision

1. **The ticket records WHICH credential requested it.** Two NULLABLE columns in
   `engine.runner_socket_tickets` — `credential_kind` (`"device_key"` |
   `"pat"`) and `credential_id` (the `kid`, or the PAT id) —, Ecto migration
   `20261001120000_add_credential_to_runner_socket_tickets.exs`, additive, no
   backfill (tickets live 30 s). The table is the ENGINE's (schema `engine`), so
   the migration is its own; the Drizzle journal does not change (stays at
   `0068`). Null is a legitimate state: the `terminal` ticket is the web tab's,
   authenticated by session, and a `runner` one issued by an api predating this
   ADR arrives without it during the rollout.

2. **The auth contract now carries the credential up to the engine.**
   `PatAuthGuard` fills `request.credencialDeDispositivo` (`{tipo: 'pat', id}`
   or `{tipo: 'device_key', id: chave.id}`) after authorizing; the controller
   passes it on; `RequestRunnerTicketUseCase` sends it only with
   `kind: "runner"` (the `terminal` one never carries it, even if someone passes
   one); the internal request gains `credentialKind`/`credentialId`, which only
   travel together. The engine normalizes the pair (`SocketTicket.credencial/2`):
   an unknown kind or empty id become `nil`, never an invented credential — and
   the ticket still works.

3. **The engine keeps the credential in the socket.** `connect/3` sets
   `assigns.credencial`, and `id/1` gains two segments when it exists —
   `runner_socket:<kind>:<projectId>:<userId>:<espécie>:<id>` —, so the
   `disconnect` the channel broadcasts to its OWN id reaches only that
   credential's connections. Without a credential, the id is the previous one.

4. **Revoking ONE credential has its own route and its own target.**
   `POST /internal/runner/disconnect-credential` (no `:projectId`: the machine
   key does not have one), `Engine.Runners.Revogacao.derrubar_credencial/4`:
   1. **voids the credential's PENDING tickets** (`consumed_at` filled — the same
      "already used" state that `validar/1` and `consumir/2` refuse, no new
      state), closing the window between issuing and using;
   2. **asks EVERY runner registered in the cluster** (`Registry.todos/0`)
      whether it was born from this credential — only the channel knows, because
      the credential lives in `assigns`. Whoever was born from it drops
      (transport + `{:stop, …}` releasing the presence); whoever was not answers
      `:intocado` and stays up;
   3. answers 200 with a TALLY (`derrubados`, `legados`, `intocados`,
      `semResposta`, `ticketsAnulados`), with a 5 s ceiling for the WHOLE set.
      400 only for a malformed credential — so "I targeted nothing" never passes
      for "there was nothing".

   The MACHINE key stops being the pair applied N times: it is ONE request, and
   it drops in every project where it opened a connection, including one the api
   would not list.

5. **Key and PAT revocation use that target.** `RevokeRunnerDeviceKeyUseCase`
   (and, by delegation, the Account door, RN-611) asks for the drop by
   `{tipo: 'device_key', id}`; both PAT revocations (the owner's, RN-426, and the
   `maintainer`'s, RN-427) now drop by `{tipo: 'pat', id}` — before they dropped
   nothing. The order does not change: revoke FIRST, drop afterwards, and
   dropping is a side effect that only LOGS.

6. **Not failing to drop what already dropped (AT-013's prohibition).** Two
   TRANSITION pieces, and neither is the target:
   - **The LEGACY connection** (ticket without a credential) of the same owner,
     in one of the projects the api sends as reach (the row's, or the machine's
     candidates), drops by the pair as before (`:derrubado_legado`). Only for a
     device key: the PAT dropped nothing before, so it gains no legacy reach — it
     would gain a drop it never had, on someone who has nothing to do with it.
   - **PLAN B**: if the engine does not serve the by-key request (an engine
     predating this route answers 404), key revocation falls back to the old
     target, `disconnectRunnerOfUser` per project. Dropping too much is
     reversible; failing to drop would reopen RN-519.

7. **`{project, user}` still exists, with ANOTHER owner.**
   `POST /internal/projects/:projectId/runner/disconnect` and
   `Revogacao.derrubar/3` stay byte for byte (with the finer socket id): it is the
   target of MEMBER REMOVAL (RN-615), which removes the PERSON from the project
   and needs to drop any connection of theirs, with whatever credential —
   besides plan B above.

8. **The screen changes the text, not the behaviour.** The revoke confirmation —
   in the device keys section of Settings and in the machine keys section of
   Account — swaps the "collateral" (*"another runner of yours in the same
   project also drops"*) for PRECISION (*"only what connected with THIS key
   drops"*), because RN-561 requires the screen to state the right reach and the
   old sentence would assert a drop that does not happen. It is the answer to
   AT-013's `TODO(humano)` (*"does the screen change behaviour or only
   label?"*): only label — the click, the route and the invalidation are the
   same.

9. **The runner does not change.** It already sent the `kid` in the JWT header,
   and that is all the path needs. Not one line of `apps/runner/`.

## What this ADR does NOT do

- **It does not change what AUTHORIZES.** No new ceiling, none loosened:
  `PatAuthGuard` decides as always, and the credential is only ANNOTATED after
  authorizing. This ADR moves the drop's target, never the authority.
- **It does not drop the web's Terminal tab.** The `kind: "terminal"` socket has
  no device credential, does not occupy the `Registry` and is never asked — as
  before.
- **It does not close a ticket issued and not yet CONNECTED with an old api's
  credential.** A ticket without a credential (issued by an earlier api) is not
  voided on revocation: there is nothing to compare. The window is 30 s and only
  exists during the rollout.
- **It does not give the `maintainer` view revocation of another user's key.**
  It stays out by RN-519's decision.

## Consequences

- **The same user's other runner stays up.** The cost RN-520 declared goes away:
  revoking the laptop's key does not drop the desktop connected with another key,
  nor the runner connected with a PAT.
- **Revoking the machine key is ONE request, and more complete than the
  plural.** It reaches projects the api's list does not have. The price is asking
  EVERY runner in the cluster — linear in connected runners, only when someone
  revokes, and with a 5 s ceiling for the set.
- **Revoking a PAT now drops.** It is an observable behaviour change: the runner
  connected with a revoked token drops immediately, instead of going on until it
  reconnects. For the `maintainer`'s revocation (incident response, RN-427) it is
  what was missing for it to contain anything.
- **The tally replaces the single outcome** in the key revocation log. The four
  outcomes of `derrubar/3` still exist for member removal.
- **Rollout without operator action.** The migration is additive and runs in the
  usual migration job (`Engine.Release.migrate/0`). New api with old engine: the
  ticket request's new fields are ignored and revocation falls into plan B. Old
  api with new engine: tickets without a credential, which drop by the pair
  (legacy), and the old revocation keeps calling the pair route, which did not
  change. That is why the branch is `feature/` and not `breaking/`.
- **The runner socket's id changes shape.** Nothing outside reads it — it is
  Phoenix's internal `disconnect` topic —, and a socket opened before the deploy
  dies with the old pod.
- **Engine proof only in CI.** The ExUnit (real channel with a credential, a PAT
  that stays up, a machine in two projects without a list, legacy by the pair, a
  pending ticket voided, controller 200/400) was written without running locally
  (`repo.hex.pm` gives 403 in this environment); syntax and formatting checked.

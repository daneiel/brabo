# ADR 0103 — Local runner: execution on the user's machine over a Phoenix channel with a single-use ticket

- **Status:** Accepted
- **Date:** 2026-08-20
- **Context:** product owner's request, RN-419/420 — companion to
  [ADR 0102](0102-revisao-do-adr-0065-teto-absoluto-substitui-deny.md)
- **Revises (without softening) the ground of:** [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md),
  [ADR 0072](0072-projeto-local-ou-container.md)

## Context

Until this delivery, NOTHING in the product executed outside the
container: every terminal command is `System.cmd("sh", ["-c", cmd])`
inside the engine's own process (`terminal_executor.ex`), and `local`
mode (ADR 0072) only changes the FOLDER via bind-mount — the command
still runs in the SAME container as the engine. The product owner's
request was to truly cross that boundary: an agent executing on the
user's OWN MACHINE, in the local folder, through the user's standard
terminal — plus a genuinely interactive terminal in the Code tab,
which until now only showed explanatory text + the state of
`project_containers` (never a real terminal).

## Decision

**New component, `apps/runner`** (Node/TS): a CLI (`brabo-runner`)
that the user runs on their OWN machine. It is NOT orchestrated by the
product — it comes up by the user's explicit choice and consent, with
the user's own PRIVILEGES.

**Channel**: a NEW Phoenix socket at `/runner` (alongside the existing
session `/socket`), topic `terminal:<projectId>`, authenticated by a
SINGLE-USE ticket — the same security pattern as RN-108 (session
socket ticket), but with one INVERTED ownership detail: the ticket is
issued by the ENGINE itself (table `runner_socket_tickets`, schema
`"engine"`, its own Ecto migration), and the API REQUESTS it from the
engine via an internal HTTP route — the reverse of the session ticket
flow, where the api writes the ticket to its own table. The swap is
justified: the runner ticket has no associated chat session (it's per
PROJECT), and the state that needs to validate exclusivity (only one
runner per project) already lives in the engine
(`Engine.Runners.Registry`, `:global`).

**Two roles on the same topic**: `:runner` (the CLI, exclusivity
guaranteed by `:global.register_name/3` — only ONE per project, a
second `join` refused) and `:web` (the Terminal tab, multiple
simultaneous). The engine does a PURE RELAY of the PTY bytes between
the two — it never interprets the content.

**Routing ALWAYS happens after approval.** `TerminalExecutor` only
decides to route to the runner (instead of the usual `System.cmd`)
AFTER the normal pipeline (`decide()`/`proposed_action`) has already
approved the command — the runner is never a second execution path
that escapes policy, it's just a different DESTINATION for the same
already-authorized command. With no runner connected, even in `local`
mode, the usual behavior continues (`System.cmd` in the container via
bind-mount) — the runner is additive, never a required dependency.

**The runner's security boundary is NOT sandboxing.** It's the
composition of three things: authentication (the CLI identifies itself
with the user's ACCOUNT token), the usual approval pipeline (every
agent command is still born a `proposed_action`, with ADR 0102's
absolute ceilings applying equally), and the user's CONSENT to run the
binary on their own machine. `apps/runner/src/guard.ts` validates that
the received `cwd` stays inside the project root by lexical
resolution — but this is DECLARED in the code as best-effort, not the
real guarantee; the real guarantee is the composition above. This
revises, without softening, the ground of ADRs 0055/0072: for
execution via the runner, the structural containment of
`join(root, column)` that protects container mode does not exist — the
command runs with the user's OWN privileges, on their own machine.

**Interactive PTY is a user action, with a trail.** `pty_open`/
`pty_close` coming from the web emit `terminal.session.started`/`ended`
into the event log (audit trail) — including when the tab drops without
closing explicitly (the channel's `terminate/2` closes the trail).
It doesn't go through `proposed_action` because it isn't the agent
acting — it's the authenticated user typing into their own machine's
terminal.

## Real finding during implementation

The product does NOT have, today, a LONG-LIVED account token mechanism
for automation — `account_tokens` exists only for single-use email
links (verification, password reset, post-migration initial
password). The runner needed something that would survive across CLI
runs. Adopted solution until a real automation mechanism exists: the
runner replicates the browser's LOGIN flow (username/password on the
first run, httpOnly cookie + CSRF extracted and persisted to
`~/.brabo/runner-credentials.json` with `0600` permissions, rotated via
`/auth/refresh`). This is flagged in the code as the module to swap
out once a real automation token (a personal access token, or
equivalent) enters the product — it isn't the final form, it's the
form possible with what exists today.

## Consequences

- Four new dependencies, all isolated: `@xterm/xterm` +
  `@xterm/addon-fit` on the web (the same rule as `mermaid`/ADR 0068 —
  dynamic `import()`; absence of `eval`/`new Function` confirmed by
  grep on the installed package, declared as strong evidence, NOT a
  formal guarantee against obfuscation); `phoenix` + `node-pty` on the
  runner.
- The CONTAINER's interactive terminal still doesn't exist — Phase 25b
  remains cut. The runner is NOT that piece: it's a parallel path, on
  the user's machine, not inside the project's container.
- `TERMINAL_ACTION_TIMEOUT_MS`/`TERMINAL_OUTPUT_MAX_BYTES` (caps that
  already existed for the container executor) are replicated as
  defaults in the runner — same values, so there aren't two different
  ceiling behaviors depending on where the command runs.
- The scope guard (`guard.ts`) is best-effort, declared as such — it
  doesn't overstate the argument around it beyond what's written: it
  helps catch a gross error, it isn't a wall.

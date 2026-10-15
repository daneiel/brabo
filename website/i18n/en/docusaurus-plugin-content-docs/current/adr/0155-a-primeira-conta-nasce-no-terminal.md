---
traducao_de: 7bb8172e06f04a3473660371149177023de99b0a
---

# ADR 0155 — The first account is born in the terminal, and the local agent comes up paired

## Status

**Accepted** on 2026-09-27 (AT-108), after being implemented — the same path as
[ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md). It was born
`Proposed` in session 1 of PHASE 30 (2026-09-11) and was exercised by
RN-543..552 in sessions 2 to 8 (the E2E on a clean machine, RN-549, is the end to
end proof), with the closing narrated in
[historico-de-fases.md](../explanation/historico-de-fases.md) and in
[fase-30-runner-por-maquina.md](../explanation/fase-30-runner-por-maquina.md).
Where the text below diverges from the code, the decision was NOT rewritten: the
divergence is named in "Acceptance notes", at the end.

Second of the two decisions of
[PHASE 30](../explanation/fase-30-runner-por-maquina.md). It depends on
[ADR 0154](0154-chave-de-dispositivo-de-maquina.md): without a machine identity,
there is nothing to register here.

## Context

`install.sh` ends with the compose up and the runner binary on disk. The person
opens the browser and finds a login screen in an installation where **nobody
exists**.

And the way out of there is broken in a new installation. Measured:

- the `.env` the installer generates has **no** email variable at all
  (`install.sh`, the heredoc that writes the eleven keys);
- `MAIL_TRANSPORT` falls to the default `log`
  (`docker/docker-compose.install.yml:200`), and the compose says in the comment
  next to it that *"o comportamento continua log-only mesmo aqui"*;
- registration requires verifying email, and the docblock of
  `apps/api/src/scripts/provisionar-usuario.ts` already records the consequence
  in so many words: *"o fluxo normal de registro exige verificar e-mail — que
  com o `MailSender` log-only não fecha sozinho"*.

That is: whoever installs through the single line signs up, receives nothing,
and the only way out is to go fish the link out of `docker compose logs api`. An
installation that ends saying "Done" and lets nobody in.

`provisionarUsuario` exists precisely for that hole — it creates a user with a
password **already verified** — and today has two callers, the demo seed and
the smoke. Neither of them is the real installation.

## Decision

**The installer creates the first account, with explicit consent in the
terminal, and brings up the local agent already paired.**

### 1. Only the FIRST account, and only when there is none

The step runs when the installation has no user at all. With any user present,
the installer **does not offer it** — it is not an account creator, it is the
closing of a new installation. In a migration (RN-530) the users come in the
restore, and the step goes silent by the same criterion.

The route is internal and authenticated by `BRABO_SERVICE_TOKEN` — the same
secret the installer just generated and wrote to the `.env`, with mode 600 —,
and refuses if a user already exists. No public "create the first owner" route
is born: a public route that creates an owner is a race between whoever
installed and whoever scanned the port.

### 2. No email verification, and the reason is what authorizes it

The account is born verified, through `provisionarUsuario`. That does not loosen
normal registration, which stays byte for byte: what email verification proves
is *"this person controls this mailbox"*, and whoever is running the installer
has already proven something stronger — **they control the machine**, the
`.env` with the five secrets and the Docker daemon. Requiring the weaker proof
from them, through a channel the installation knows is off, is theater.

The installer **says** so in the output, instead of letting the person discover
that their account is different from the others.

### 3. Consent is explicit, and without a TTY the step does not happen

Same rule as RN-511 and `consentir-base.mjs`: the step **asks** for email and
password, and without an interactive terminal it **reports** instead of
deciding. There is no path in which an account is born with a password chosen by
the script — neither generated nor default.

The password is read without echo and confirmed. The minimum refusal (length) is
the same as the domain's, called by the same code; the installer does not carry
a second password rule, which would diverge.

### 4. The machine key is registered there, and the service comes up with it

With the account created, the installer registers a machine device key (ADR
0154), writes the private key with the `kid` inside (RN-475, the defect that made
automatic mode never authenticate) and installs the service — the **per
machine** unit of ADR 0154 point 4.

The pair is generated **on the machine**; the private key never travels. It is
the same design as the browser (ADR 0118), for the same reason, and keeps true
the sentence RN-519 uses to refuse the `maintainer` view: *"the private key of a
device key never leaves the browser"* — it becomes "never leaves the machine".

> **Detailed in the implementation (RN-552).** This point did not say with which
> credential the installer registers the key, and both candidates were real. The
> route — `POST /internal/machine-device-keys` — was born with the **service
> token**, the same as the first account: it is the same installer, in the same
> minute, and the token proves control of the MACHINE, which is what this step
> wants to prove. The alternative, the freshly created user's credential, would
> contradict point 5 of this ADR (*"the installer logs in for nobody"*) and would
> give the password read on the TTY a second use, where the Consequences promise
> it is *used and discarded*. The cost — a leaked service token can now
> MANUFACTURE a durable access credential — is declared in
> `docs/security-surface.md`, and three containments live in the route: there is
> no `userId` in the body (the owner is the installation's SINGLE user, `409`
> with zero or more than one), registering REPLACES the owner's active machine
> keys (a reinstalled machine passes; a thousand keys do not exist), and a JWK
> with `d` is refused by name instead of written. Detailed instead of
> contradicted, and in writing because this ADR is still `Proposed`: an
> **accepted** ADR is never edited, the new one references the old.

### 5. The service comes up without a project, and that is the normal state

The installed agent queries `GET runner/projects` (ADR 0154 point 3) and finds
nothing, because there is no project yet. It **waits**, and that is not an
error: it emits no failure, does not exit with a non-zero code, and
`service status` says "up, no project in runner mode" — one of the four states
RN-518 already distinguishes, and not a fifth.

When the person creates the first project in `runner` mode on the web, the agent
is already there. That is the "link the folder later" the phase pursues, and it
happens through `workspace_create` (RN-532), without anyone going back to the
terminal.

## What this ADR explicitly rejects

- **Creating an account when one already exists.** See point 1.
- **A public first-owner route.** See point 1.
- **A password generated by the script, or a default.** See point 3. An
  installer that chooses a password produces installations with the same
  password.
- **Loosening normal registration's email verification.** Point 2 creates a
  path for a named case; it does not touch the other.
- **Turning on SMTP on its own.** The installer does not ask for a mail server
  and does not write `MAIL_*`: `MAIL_TRANSPORT=log` remains the declared default,
  here as in production. What it does is stop **depending** on it for the
  installation to close.
- **Asking for an LLM credential.** It is out: the installation ends usable, and
  the provider key is the decision of whoever will spend (RN-058).

## Consequences

- **The one-line installation now really closes**: it ends with an account,
  login possible and the local agent up. Today it ends with a login nobody can
  get through without reading a container log.
- **The installer now handles a password.** It is read without echo, used and
  discarded — never written to the `.env`, never to the marker, never to the
  log. The marker (`$XDG_STATE_HOME/brabo/`) gains the created owner's
  **email**, which is identification and not a secret, and nothing more.
- **A second user creation path now exists in production.** It is narrow (first
  account, internal route, service token) and disappears as soon as the
  installation has people — but it is a new surface, and it is declared.
- **`provisionarUsuario` gains a third caller**, and the first that is not test
  automation. Its docblock says today that it exists for seed and smoke; it now
  also says for the installation.
- **PHASE 29 becomes coherent with itself.** It refused the one-line installer
  *"while the artifacts are not signed"* and signed before installing; this
  phase closes the other end — installing is not delivering bytes, it is leaving
  it usable.

## Acceptance notes (2026-09-27)

Checked against the code at acceptance. The decision stays as it is; these are
the points where the text and the code diverge, and where the code resolved it:

- **Point 2 and Consequences — "the account is born verified, through
  `provisionarUsuario`", which "gains a third caller".** The text did not face
  that the `provisionarUsuario` script REFUSES to run with
  `NODE_ENV=production` (`apps/api/src/scripts/provisionar-usuario.ts:37`), and
  the installer runs exactly in production. The resolution was to extract the
  core — the trio of writes that makes the account be born verified — into
  `ProvisionarUsuarioUseCase`
  (`apps/api/src/application/use-cases/auth/provisionar-usuario.use-case.ts:43`)
  and leave the refusal in the SCRIPT, which is what it protects (a known
  password created without human interaction). Whoever gained the new caller was
  the use case, through the first account route
  (`apps/api/src/application/use-cases/auth/criar-primeira-conta.use-case.ts:85`);
  the script keeps the previous two, seed and smoke, and `BRABO_FORCE_SEED` is
  NOT the installer's path (RN-546).
- **Point 4 — with which credential the machine key is registered.** Already
  detailed in the text itself, while `Proposed`: the service token, through
  `POST /internal/machine-device-keys` (RN-552). The pair is born in the
  terminal through two commands, `brabo-runner device-key create` and
  `finish --id`, because the `kid` is the record's id on the server and only
  exists after it (RN-551).
- **Point 5 — "does not exit with a non-zero code".** Waiting with zero projects
  exists (RN-550, which fixed RN-544's exit with 0 precisely for contradicting
  this point), but it has a ceiling of TEN consecutive queries without a useful
  answer, and then the agent exits with 1 naming the number
  (`apps/runner/src/espera-de-projetos.ts:75`, the exit at
  `apps/runner/src/index.ts:1547`). An empty list does not count as a failure —
  only an api that does not answer.
- **Point 5 — "`service status` says 'up, no project in runner mode'".**
  `status` does not know about projects: it answers from the disk and the
  manager, with the four states of RN-518 (`apps/runner/src/servico.ts:246`),
  and the waiting machine unit appears as `rodando`. Whoever says "no project in
  runner mode" is the agent's own LOG (`apps/runner/src/index.ts:1529`). The
  point about there being no fifth state is fulfilled; the text attributed to
  `status`, not.

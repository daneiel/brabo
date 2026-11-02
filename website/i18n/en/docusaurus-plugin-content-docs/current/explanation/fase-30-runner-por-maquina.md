---
id: fase-30-runner-por-maquina
title: FASE 30 — the machine's local agent
sidebar_label: FASE 30 — machine's local agent
sidebar_position: 17
description: The scope of FASE 30 — the local agent's identity stops being per project and becomes the machine's, and the installer closes the installation by creating the first account and bringing up the paired agent. The decisions are in ADRs 0154 and 0155.
keywords: [fase 30, runner, local agent, device key, installer, service]
traducao_de: 11f3dbb485e7626c292e2f894b0d8ece64429d47
---

# FASE 30 — the machine's local agent

> This document is the phase's **scope**: what it pursues, what it refuses,
> and in what order. The **decisions** live in
> [ADR 0154](../adr/0154-chave-de-dispositivo-de-maquina.md) and in
> [ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) — where this
> and they disagree, the ADR wins.

## What the phase pursues {#o-que-a-fase-persegue}

Install Brabo in one line and **use it**. Today
[FASE 29](fase-29-instalacao-de-uma-linha.md) delivers almost that: the
`install.sh` verifies its own origin, brings up compose, installs the runner
binary with `install -m 0755` and writes the base. And then it stops, at two points that
the product itself already declared in writing.

**The first is the local agent.** The installer's last line says it doesn't
pair the agent with a project, and that the device key still comes from the
screen. Whoever wants to use the installed binary goes back to the browser and ends up pasting
into the terminal the command that `apps/web/src/lib/runner-bootstrap.ts:398` builds. The
comment next to it explains why the screen can't avoid it — *"a web
page doesn't run a binary on anybody's machine"* — and it's right. What
it doesn't cover is that **the installer is not a web page**: it runs in the
terminal, with a TTY, and [ADR 0150](../adr/0150-instalador-de-uma-linha.md)
refused `curl | sh` precisely so it could ask.

**The second is that nobody can get in.** Measured in this phase: the generated `.env`
has no email variable at all, `MAIL_TRANSPORT` falls to `log`
(`docker/docker-compose.install.yml:200`), and registration requires verifying
the email — which, as the docblock of `apps/api/src/scripts/provisionar-usuario.ts`
already recorded, *"with the log-only `MailSender` doesn't close on its own"*. The one-line
installation ends by saying "Done" and leaving the person to fish a
verification link out of `docker compose logs api`.

Both are solved in the same place, and that is what makes a single phase.

## What the measurement changed in the scope {#o-que-a-medição-mudou-no-recorte}

FASE 29 took the per-machine runner out of scope with a measurement: *"one runner
per project is enforced in five independent places"*. Re-measuring with
`file:line`, **three of the five don't need to change** — and that shrinks the phase
by half.

| # | where | what it enforces | this phase |
|---|---|---|---|
| 1 | `terminal_channel.ex:204` | topic `terminal:<projectId>` | **doesn't touch** |
| 2 | `runner_socket.ex:73` | socket id with `project_id` | **doesn't touch** |
| 3 | `Engine.Runners.SocketTicket` | ticket carries `project_id` | **doesn't touch** |
| 4 | `apps/api/src/db/schema/auth.ts:325-326` | `project_id` `NOT NULL` | becomes nullable |
| 5 | `apps/runner/src/servico.ts:264,391` | unit `brabo-runner-<projectId>` | becomes one per machine |

The reason is in ADR 0154: items 1, 2 and 3 describe a **connection**, not a
process. A process that opens **N connections** — one per project — satisfies them
byte for byte, and preserves the refusal of a second runner on the same project, which is a
real guarantee and not an accident. What remains is what belongs to the process: the
credential (4) and the unit (5).

**Nothing in the engine changes in this phase.** That was the measurement's most useful finding, and it is
what keeps `RunnerReadiness` (RN-507), the mirror (RN-516) and `workspace_create`
(RN-532) byte for byte.

## The sessions {#as-sessões}

One deliverable each. The "depends on" column is what orders.

| # | deliverable | depends on | its own prohibitions |
|---|---|---|---|
| 1 | this document, ADRs 0154/0155 and the RN range | — | doesn't touch `apps/`, `docker/`, `scripts/`, `install.sh`; doesn't edit an accepted ADR |
| 2 | **CLOSED** — api: nullable `project_id`, machine key accepted in `runner-ticket`, `GET runner/projects` ([RN-543](../business-rules.md#rn-543)) | 1 | doesn't touch the engine; doesn't loosen any route's role |
| 3 | **CLOSED** — runner: N connections, one per project, discovered through the route ([RN-544](../business-rules.md#rn-544)) | 2 | doesn't touch `RunnerReadiness`, the mirror or `workspace_create` |
| 4 | **CLOSED** — runner: per-machine unit in `service install`, coexisting with the per-project ones ([RN-545](../business-rules.md#rn-545)) | 3 | doesn't remove the per-project unit; doesn't change `Restart=on-abnormal` |
| 5 | **CLOSED** — api: `POST /internal/first-account`, verified account + personal workspace, `409` with any user ([RN-546](../business-rules.md#rn-546)) | 1 | doesn't create a public route; doesn't touch normal registration |
| 6 | **CLOSED** — `install.sh`: consent, account, machine key and `service install` ([RN-547](../business-rules.md#rn-547)) | 4, 5 | doesn't write the password anywhere; without a TTY it reports and exits 0 |
| 7 | **CLOSED** — web: the project screen recognizes an already paired machine agent ([RN-548](../business-rules.md#rn-548)) | 3 | doesn't remove the ADR 0118 flow |
| 8 | **CLOSED** — E2E on a clean machine, docmap, `docs:check` ([RN-549](../business-rules.md#rn-549)) | 6, 7 | doesn't loosen a gate for the E2E to pass |

### What session 2 closed, and what it left declared {#o-que-a-sessão-2-fechou-e-o-que-ela-deixou-declarado}

The api half is standing: `runner_device_keys.project_id` is nullable, the
`PatAuthGuard` resolves the role against the **requested** project when the credential
names none, and `GET runner/projects` exists. Two things the scope's measurement
didn't anticipate and the implementation forced a decision on, both recorded
in [RN-543](../business-rules.md#rn-543):

- **The RN-519 listing started returning both kinds, marked.** A
  machine key that appeared in no listing would be invisible and
  permanent — the defect RN-519 closed, reborn in the new kind.
- **Revocation got a PLURAL target.** `revogar` of a machine key has no
  `projectId` to pass to the engine; no longer bringing it down would reopen RN-520 across
  N connections. One `{project, user}` per project in the owner's `runner` mode,
  **without touching the engine**.

And what remains **declared, not done**: no api route CREATES a machine
key yet — whoever registers it is `install.sh` ([ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md)
point 4), in session 6. The route is born in the PR that has the first real caller.

### What session 3 closed, and the three decisions it had to make {#o-que-a-sessão-3-fechou-e-as-três-decisões-que-ela-teve-de-tomar}

The local agent opens N real connections, and the scope's measurement was
confirmed: **nothing in the engine changed**, and the runner's handlers (`tratarExec`,
`tratarMirrorSync`, `tratarWorkspaceCreate`) didn't change a line — what
forced the design were the four PER-PROJECT fields of `EstadoDoRunner`, which
became N states with `docker` and `base` shared by value. The old mode
stayed byte for byte, and the new gate is narrow: machine credential **and** consented
base.

Three things the scope didn't anticipate, and [RN-544](../business-rules.md#rn-544)
records them:

- **One refused project doesn't bring down the others.** The attempt ceiling and the
  join refusal stopped belonging to the PROCESS and started belonging to the PROJECT; only
  when none remain does the process exit with 1, with each one's outcome. In
  single-project mode the old behavior stays identical, by the inverted
  reasoning: with ONE connection, nothing remains to serve.
- **The list is queried only at start.** Re-querying would let a list that comes back
  SMALLER — deleted? converted? transient 500? — bring down a live connection through
  ambiguity. The process says so when it starts, and the gesture is to reconnect.
- **An empty list is a NORMAL state, with exit 0.** It is the state of every new
  installation, and `Restart=on-abnormal` doesn't bring it back up on purpose. *(Revised when
  splitting session 6, [RN-550](../business-rules.md#rn-550): with ZERO connections the agent
  now STAYS UP and re-queries — the "only at start" half stays intact for
  whoever has a live connection.)*

And what remains **declared, not done**: the `apiUrl` in machine mode comes from
`--api-url`/`BRABO_API_URL`/default, and never from `brabo-runner.config.json`, which
is per PROJECT — whoever writes the flag is the per-machine unit, from session 4. The unit
remains per project: this session changed the PROCESS, not the service.

### What session 4 closed, and the three decisions it had to make {#o-que-a-sessão-4-fechou-e-as-três-decisões-que-ela-teve-de-tomar}

The fifth and last coupling of the table above closed: `service install
--machine` installs `brabo-runner.service` / `dev.brabo.runner`, without a suffix, and
brings up the process session 3 created. The per-project unit **was neither
removed nor renamed**, `Restart=on-abnormal` stayed byte for byte (changing it
would also undo session 3's decision to make an empty list exit with 0), and nothing
in the api, the engine or the web was touched.

One measurement changed the mechanism, and it contradicts the letter of ADR 0154 point 5.
The ADR wrote *"`service install` without `--project` installs the machine unit"*;
`resolverProjeto` has **two** sources, and today's normal path is to run
`install` with no flag at all from inside the folder the browser configured — it is
`brabo-runner.config.json` that answers. Taken literally, the ADR would silently convert
the installation of whoever already uses the product, which is the opposite of what the same
point 5 promises. So the discriminator became the **`--machine`** flag, explicit
opt-in, with both project sources intact.

The three decisions the scope left open, recorded in
[RN-545](../business-rules.md#rn-545):

- **`status` answers about the kind asked, and the code doesn't add up.** The
  four states and the four codes (RN-088) don't become eight; the other kind
  appears in TEXT, as presence read from **disk**, saying its state
  was not asked of the manager. Without `--machine` and without a resolvable project, the
  answer is about the **machine** — the only unit whose name needs no
  argument.
- **`install` REFUSES when the other kind is already installed.** It removes
  nothing, writes nothing, and names the `uninstall` of each unit found. No
  `--force`: the two together would be two processes competing for the same project, and
  the server would deny one of them. Point 5's guarantee (an already installed unit keeps
  working) stays intact — what is refused is creating the overlap now.
- **`uninstall` without a named kind removes nothing**, and lists what exists.
  It doesn't inherit `status`'s default on purpose: reading the wrong kind costs
  a wrong line, removing the wrong one costs a service and a key.

Two refusals of `install --machine`'s own weren't in the scope and are
measured: the folder cannot have `brabo-runner.config.json` (the service would start in
PROJECT mode, silently, serving only one) and the base must be consented to
(without it the agent exits in `uso()` on first boot). The unit freezes
`XDG_CONFIG_HOME` — it is what decides where the base file lives, and neither of the
two managers passes on the shell's environment — but **never** the base's value.

And what remains **declared, not done**: `install --machine` doesn't know whether the
key in that folder really is a machine one (on disk both kinds are the same
file, and whoever knows is the server), so a folder with a project key installs
the unit without error and the refusal shows up on first boot. And nobody CREATES a machine
key yet — that is session 6.

### What session 5 closed, and the decision ADR 0155 didn't have {#o-que-a-sessão-5-fechou-e-a-decisão-que-o-adr-0155-não-tinha}

Session 5 closed with a decision ADR 0155 hadn't faced, and it
applies to whoever picks up session 6: `provisionarUsuario` **refuses to run with
`NODE_ENV=production`**, and the installer runs exactly there. Instead of
`BRABO_FORCE_SEED`, the core became `ProvisionarUsuarioUseCase` and **the refusal
stayed in the script** — what it protects is a KNOWN password created WITHOUT human
interaction, and the route is another category. Session 5 also added what the ADR
didn't say and [RN-410](../business-rules.md#rn-410) requires: the **personal
workspace** is born in the same transaction, otherwise the installation would close with a login
that gets through and a dashboard where "New project" has nowhere to create.

### What session 7 closed, and the three decisions it had to make {#o-que-a-sessão-7-fechou-e-as-três-decisões-que-ela-teve-de-tomar}

The kind marker session 2 added to the listing — *"without them in the list,
a machine key would be invisible on every screen"* — got a consumer. The
runner onboarding panel now recognizes an active MACHINE key and, with
it, stops telling you to pair: what is missing isn't pairing, it's the agent
running. Nothing in the api, the engine or the runner was touched.

The three decisions the scope left open, and what each became
([RN-548](../business-rules.md#rn-548) has the whole why):

- **Where it appears: in the PANEL, and therefore in the three mounters at once — but
  not with the same result.** Recognition is per PROJECT, because the route is
  `GET /projects/:projectId/runner-device-keys`: `TerminalPanel` and
  `FolderBrowserModal` always have a project, and `NewProjectWizard` only after
  early creation ([RN-437](../business-rules.md#rn-437)). Without `projectId`
  there is nobody to ask. `AmbienteDoProjeto` was CONSIDERED and refused: its
  docblock already declares that runner presence is first-hand
  knowledge of the channel, and a line about a registered key there would be a third proxy
  competing with a stronger signal — and about the MACHINE, not the project.
- **With a key and no live connection — the most common case — the screen says the two
  things it knows and names the two it doesn't.** It announces the pairing (with the
  key names and the date of last use), and next to it: *a registered key is not an
  agent running* and *the list belongs to your ACCOUNT, not this browser*. It is the
  `workspaceVerifiedAt` rule applied one step earlier, `accent` tone and never `success`
  included. The gesture it offers is to check the SERVICE on the paired machine, and
  whoever answers for the now is still `EsperaDoRunner`, reused.
- **The kind appears through its COST, not as a label.** The panel doesn't list
  keys nor revoke — it says a machine key serves every project of the
  owner, and that revoking it brings down the local agent in all of them.

And what remains **declared, not done**: nobody CREATES a machine key yet (that's
`install.sh`, session 6), so today the screen can only be exercised with a key
registered by hand. The command offered is
`brabo-runner service status --project <id>`, the form that exists today — the per-machine
one arrives with the session 4 unit (**closed later, AT-106**: with a recognized
machine key the panel offers `brabo-runner service status --machine`;
with a project key, it keeps `--project <id>`). An active PROJECT key doesn't change the
panel: that's the sibling defect, one scope below. And the screen to list/revoke keys
still doesn't exist.

### What the split of session 6 closed — and why it isn't session 8 {#o-que-a-divisão-da-sessão-6-fechou--e-por-que-ela-não-é-sessão-8}

**Session 6** would touch `apps/api`, `apps/runner` and `install.sh` at once, and
a delivery across three workspaces is where a session gets lost. It was **split into
three**: the two pieces below, disjoint and in parallel, and `install.sh` after
them, as **orchestrator and nothing more** — session 6 remains open, with that
smaller scope. **Neither of these two is a numbered session of the phase**, and in particular
neither is session 8, which is the E2E and remains open in the table above.

The two pieces that were missing **on the agent side**, and both come from ADR 0155.

The first is a REVISION of session 3, and the decision is ASYMMETRY
([RN-550](../business-rules.md#rn-550)): with **zero** connections the agent stops
exiting and starts WAITING, re-querying `GET runner/projects` at 15s/30s/60s
until the first project appears; with a **live** connection, the list keeps being
read only at start, byte for byte. Session 3's argument stays whole where
it holds — a list that comes back SMALLER is ambiguous, and bringing down a live connection through
ambiguity trades a certain state for a guess —, and with zero connections there is nothing
to bring down. What fell was the `exit 0` argument ("an active service that does
nothing"), because the process started doing something and saying it does. Measured
in this session: `Restart=on-abnormal` **doesn't look at the exit code** — it restarts
on signal, watchdog or timeout —, so nothing in the two units changes, and the effect is
that the machine unit is genuinely `active (running)`. Waiting has no ceiling;
failing does (ten queries in a row, exit 1 naming the number).

The second closes the gap sessions 2, 3 and 4 declared — *"nobody CREATES a
machine key yet"* — through the half that belongs to the agent
([RN-551](../business-rules.md#rn-551)): `brabo-runner device-key
create|finish` generates the Ed25519 pair **on this machine**. The decision here is the CUT:
the CLI does **not** talk to the api, because whoever registers is the installer with the
`BRABO_SERVICE_TOKEN`, and giving that secret to the agent would widen what it can do
far beyond what it needs — each side keeps a secret and neither sees the
other's. From that follows the two-step design: the `kid` is the id of the REGISTRATION and only
exists after it, so `create` writes a `.parcial` that the reader ignores and
`finish` writes the real name. **The file the runner reads never exists
without a `kid`** — the defect of RN-475, impossible by construction.

What remains **declared, not done**: the ROUTE that registers the machine public key
and the `install.sh` that chains the three commands are still session 6.

And the API half of the same split ([RN-552](../business-rules.md#rn-552)):
`POST /internal/machine-device-keys`, `engine-service`, body
`{ name, publicKeyJwk }` and a response with the `id` that becomes the private key's `kid`
(RN-475). **The credential was decided and the cost is declared**: the service
token, because requiring a credential from the freshly created user would force the installer
to open on the machine exactly the live session that [ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md)
point 5 refused to open — and would give a second use to the password RN-546 discards on
purpose. The price: a leaked `BRABO_SERVICE_TOKEN` can now **manufacture**
a lasting access credential, not just talk to internal routes.

Three containments live **in the route**, not in the text: there is no `userId` in the body (the
owner is the installation's SINGLE user, and zero or more than one is 409 without writing
anything — RN-546's condition in another form, about the INSTALLATION and never about the
argument); registering **REPLACES** the owner's active machine keys in the same
transaction, so a reinstalled machine passes and a thousand keys are impossible **by
clause, with no number that ages**; and a JWK with `d` is refused by name, with
the shape rule becoming ONE, in the domain, called by both registrars.

What remains **declared, not done**: in an installation without a PROJECT, no screen
reaches a machine key — listing and revoking are both through
`/projects/:projectId/...` —, and that is why registering replaces instead of
leaving an orphan: an orphan there would be **alive and unreachable**.

### What session 6 closed, and the four decisions it had to make {#o-que-a-sessão-6-fechou-e-as-quatro-decisões-que-ela-teve-de-tomar}

With the smaller scope, session 6 was **orchestration and nothing more**: no line
of `apps/` changed, no route was born, and the four pieces `install.sh`
chains already existed, tested. The hole the phase opened at the start — *"in a
new installation nobody can get in"* — closes here, and the promise of point 5
of [ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) starts
happening for real: the agent starts without a project, waits, and picks up the first one
the person creates on the web.

The four decisions, recorded in full in
[RN-547](../business-rules.md#rn-547):

- **When a middle link fails, nothing is undone and everything is reported — and the script
  always exits 0.** The links already done are useful on their own (with the account the person
  gets in, with the key the machine is paired), undoing would require deleting an account and
  revoking a key, and there is no route for that nor should there be one the installer
  calls on its own. The price is an installation that may end halfway; what
  it never does is end halfway SILENTLY — each failure is a
  named line in a final block, with the command to repeat.
- **Idempotency is the HTTP CODE, and `409` is not a failure.** A second run, or a
  migration whose restore brought the users back: the step goes quiet saying why and
  doesn't enter the pending items. `000` — the curl that didn't talk to the api — has
  its own handling, otherwise "the api didn't come up" would be read as "the api refused".
  And the agent step only runs when THIS run created the account: with a
  pre-existing user, registering a machine key would mint a lasting credential for
  someone who asked for nothing in this round.
- **The key's `name` is the `hostname`.** [RN-551](../business-rules.md#rn-551)
  declared that the CLI doesn't name — it is a registration field, and whoever names is whoever
  registers. Whoever opens the key list needs to know WHICH machine to go to, and the
  hostname is the name the person already uses to talk about their machines.
- **The `.parcial` left over when the registration doesn't close STAYS, and is named.**
  Deleting it would be the installer deciding it knows something it doesn't: a timeout
  after the api writes is indistinguishable from one before, and the file may be the
  only copy of the private half of an already registered key.

Two things changed that weren't in the scope. The password is sent through `curl`'s **STDIN**,
with the service token in a 600 `--config` — `/proc/<pid>/cmdline` is
readable by any user on the machine, and a password in `argv` would be exposed
during the request. And `--help` **lied**: it prints the header, which is a
comment, and the rule forbidding talk of "phase sessions" to installers only
read code lines — so *"THIS VERSION INSTALLS NOTHING"* survived for months
after the script started bringing up compose and installing the runner. Fixed, with a test
on the OUTPUT of `--help`, and the fixed range of lines that silently cut it
became "up to the first line that isn't a comment".

And what remains **declared, not done**: the end-to-end installation on a
clean machine — real compose, real api, real runner binary,
unit written and agent waiting — is **session 8's E2E**, and only it
can prove it. In this session's tests `brabo-runner` is a shell stand-in and the
api is a test server: what is proven is the CHAINING, never the
integration. And `install --machine` still doesn't know whether the key in that folder
really is a machine one (the gap of [RN-545](../business-rules.md#rn-545)) — the
difference is that now there is a path that CREATES a machine one there, so the
refusal on first boot stopped being the probable outcome.

### What session 8 closed — and the three decisions it had to make {#o-que-a-sessão-8-fechou--e-as-três-decisões-que-ela-teve-de-tomar}

The last of the phase, and the only one that could answer the question the whole phase
pursues. Session 6 declared in writing that its tests prove the
CHAINING and never the integration — `brabo-runner` a shell stand-in, a fake
api —, and that is the gap that closes here.

The harness **wasn't born in this session**: `.github/workflows/install-e2e.yml`
has existed since FASE 29 ([RN-534](../business-rules.md#rn-534)) and already ran the
published installer on an ephemeral Actions runner, which is literally a
clean machine. What it proved stopped at the `.env`. The session **extended** it, and
what it proves now are the five links of [RN-547](../business-rules.md#rn-547)
against a real api and binary, the agent **standing and waiting**, and the first
project in Runner mode being picked up without anyone going back to the terminal.

The three decisions, recorded in full in
[RN-549](../business-rules.md#rn-549):

- **The signal that "the agent is up" is the LINE it writes, never the manager's
  state.** `perguntarEstado` maps `activating` to `rodando` — with
  reason ([RN-088](../business-rules.md#rn-088): "starting" is not "stopped") —,
  so `systemctl is-active` and `service status --machine` answer *up*
  for a process that is going to die two seconds later. The
  [RN-550](../business-rules.md#rn-550) line only exists after the agent has read the
  key from disk, taken a ticket, talked to the api and received an EMPTY list: it
  proves pairing and waiting at once, and it is a RECORDED FACT, not a sampling
  of state — that is why waiting for it with a ceiling isn't a race. `status` comes in
  after it, as confirmation, never in its place.
- **The outcome is proven through the API, not the browser.** The subject is the AGENT, and
  what it observes is `GET /runner/projects`. A browser would create the project
  through the same route with one more layer that fails for unrelated reasons — and wouldn't
  make the assertion stronger, because it would still be the journal line.
  The browser layer exists (`e2e/`,
  [ADR 0120](../adr/0120-e2e-de-navegador-contra-o-compose-de-producao.md)),
  answers another question and assumes the production compose is up: bringing it in would make the
  installer's E2E depend on a second harness on a machine that should
  be clean.
- **The half that runs on PRs is a TEST, not the workflow.** The E2E stays out of
  `pull_request` — opening that door would give the installer a way to skip the
  origin verification, which is what
  [ADR 0150](../adr/0150-instalador-de-uma-linha.md) refuses. But a workflow that
  runs on a tag is a workflow whose error shows up on the tag: `scripts/dev/install-e2e.spec.ts`
  guards the two ways it can rot silently — the loosened gate, and the `install.sh`
  sentence rewritten, which makes the assertions not fail but VANISH.

**Two defects showed up, both invisible because the workflow had never run.**
The first was in the harness and was fixed: the TTY answers file started
with `nao-migrar`, which on a clean machine falls into the MARKER question — it doesn't
match `s|S|sim|SIM`, the script said *"Nothing was written"* and exited 0, and the
marker assertion would have failed. The second is a FINDING and stayed a finding: the published
`install.sh` **brings up nothing on its own on a clean machine** — it uses
`docker/docker-compose.install.yml`, which isn't a Release asset, doesn't enter the
signed `checksums.txt` and **it doesn't download anywhere** (with
`./postgres/init.sql` included, that's three files). Whoever follows the runbook's `curl … install.sh`
dies at "no such file or directory" after having already verified the
signature and written the `.env`. The workflow brings them by hand, from the tag, in a step that
says it's a finding; fixing it means deciding between a signed asset and a clone, and it's a
delivery of its own.

And what remains **declared, not done**: this E2E **doesn't run on the PR that
wrote it** — the first real run is the next final tag, and no PR check
proves a line of it. Left out, by decision: the second run through the
MIGRATION path ([RN-530](../business-rules.md#rn-530)), macOS (the full step is
Linux — `launchd`, and the Docker the hosted runner doesn't have) and the browser.

Reserved range: **RN-543..555**. ADRs **0154** and **0155**. RN-541 is already
allocated in an unmerged branch — the jump is deliberate, by the criterion
FASE 29 recorded when it resolved three collisions by date.

## What the phase delivered, as a whole {#o-que-a-fase-entregou-no-conjunto}

Eight sessions, plus the two pieces that came out of splitting session 6 and are not
numbered sessions. What the phase promised at the start — *install Brabo in one
line and **use it*** — started happening:

- **The local agent's identity stopped being per PROJECT and became the
  MACHINE's.** The two couplings the scope's measurement said needed to
  change did change: `runner_device_keys.project_id` is nullable
  ([RN-543](../business-rules.md#rn-543)) and the unit is one per machine
  ([RN-545](../business-rules.md#rn-545)). The other three **didn't change**, and the
  measurement that saved them is the phase's most useful finding: topic, socket id and ticket
  describe a CONNECTION, and N connections satisfy them byte for byte.
- **Nothing in the engine changed.** `RunnerReadiness` ([RN-507](../business-rules.md#rn-507)),
  the mirror ([RN-516](../business-rules.md#rn-516)) and `workspace_create`
  ([RN-532](../business-rules.md#rn-532)) stayed byte for byte, and so did the
  runner's handlers.
- **A new installation stopped being born with nobody inside.** `MAIL_TRANSPORT`
  is still `log` and the installer still doesn't turn on SMTP — what changed is that the
  first account is born in the TERMINAL, already verified
  ([RN-546](../business-rules.md#rn-546)/[RN-547](../business-rules.md#rn-547)),
  with the personal workspace in the same transaction. Fishing for a verification link in
  `docker compose logs api` stopped being the path.
- **The agent comes up paired and WAITS.** The Ed25519 pair is born on the machine
  ([RN-551](../business-rules.md#rn-551)), only the public key travels
  ([RN-552](../business-rules.md#rn-552)), the registration `id` becomes the `kid`
  (the invariant of [RN-475](../business-rules.md#rn-475), now impossible to
  violate by construction), and with zero projects the process stays up
  re-querying ([RN-550](../business-rules.md#rn-550)) instead of exiting.
- **The screen recognizes who is already paired** ([RN-548](../business-rules.md#rn-548)),
  without ever claiming the agent is running — a registered key proves
  pairing, not a live process.
- **And the whole is measured end to end** ([RN-549](../business-rules.md#rn-549)),
  against a real api and binary, on a clean machine.

What the phase did **not** close is right below, in "Gaps the phase touches and
doesn't solve", and none of them changed size along the way — except the key
list/revoke SCREEN one, which became **larger** on purpose: the phase added a
kind of key to list and didn't build the screen. Add to that the compose
finding session 8 measured, and the `install --machine` gap, which still
doesn't know whether the key in that folder really is a machine one — on disk both
kinds are the same file, and whoever knows is the server.

## What this phase does NOT touch {#o-que-esta-fase-não-toca}

Declared in both ADRs, and repeated here because it is what gives meaning to the rest:

- `decide.ts` and the absolute ceilings — none gets an exception, not even a configurable one
- `proposed_action` as the origin of every external effect of an agent; creating a folder and
  pairing an agent remain **consented configuration**, not agent action
  (the RN-516 line)
- the immutability of the event log
- `RunnerReadiness` (RN-507) and its three preconditions — and **never** a
  "skip container" flag, for the reason in ADR 0147 point 4
- the mirror (RN-515/516/517) and `workspace_create` (RN-532): both are per
  project and travel in the `join` grant of that connection
- normal registration with email verification, and the `MAIL_TRANSPORT=log` default
- the browser configuration flow ([ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md))

## Gaps the phase touches and doesn't solve {#lacunas-que-a-fase-encosta-e-não-resolve}

- **Revocation still reaches `{project, user}`, never `{key}`**
  (RN-520) — and it now costs more: revoking brings down the agent in **all**
  the projects of that machine. FASE 29 declared this cost in advance;
  here it arrives. Closing it requires changing the revocation's target, which is its own front.
- **There is no screen where device keys are listed and revoked.** RN-519 opened the
  `GET` in the api; the web never got the screen. The phase adds a kind of
  key to list and doesn't build the screen — the gap gets larger, and declared.
  [RN-548](../business-rules.md#rn-548) starts CONSUMING that listing in the
  onboarding panel, which doesn't close it: reading to recognize is something else
  than listing to revoke.
- **Single point of failure.** One process per machine instead of N: the service
  going down takes the agent out of every project. It's the price of the design, not
  carelessness.
- **The git credential remains discarded in `docker exec` in `runner` mode**
  ([ADR 0145](../adr/0145-docker-pre-requisito-do-runner.md)) — this phase doesn't
  touch it, and nothing here makes it worse.
- **BRB-031** closes by maintainer decision, not as a consequence: the phase
  creates the path without `chmod` and **keeps** the browser one. Choosing to retire the
  second is a separate decision.
- **BRB-017** (GPL obligation of the engine image, P1) stays where it was, and this
  phase makes it more concrete for the same reason as FASE 29: more installations
  on third-party machines.

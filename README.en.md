<div align="center">

[Português](README.md) · **English** · [Русский](README.ru.md) · [简体中文](README.zh-Hans.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="website/static/img/logo.svg" />
  <source media="(prefers-color-scheme: light)" srcset="website/static/img/logo.svg" />
  <img src="website/static/img/logo.svg" alt="Brabo logo" width="96" />
</picture>

<h1>Brabo</h1>

**A team of AI agents takes your application from brief to deploy.
Final authority stays yours — by construction, not by convention.**

[![CI](https://img.shields.io/github/actions/workflow/status/daneiel/brabo/ci.yml?branch=dev&label=CI&style=flat-square)](https://github.com/daneiel/brabo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/github/v/release/daneiel/brabo?label=version&color=informational&style=flat-square)](CHANGELOG.md)
[![Documentation](https://img.shields.io/badge/docs-daneiel.github.io/brabo-8A2BE2.svg?style=flat-square)](https://daneiel.github.io/brabo/)

[Documentation](https://daneiel.github.io/brabo/) · [From zero to a deliverable](https://daneiel.github.io/brabo/prd/en/tutorials/from-zero-to-deliverable) · [CHANGELOG](CHANGELOG.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

<img src="docs/assets/readme/perguntas-no-chat.png" alt="Brabo session screen: the Creative records the business rules and hands the open questions back in the chat, each with a suggestion and the rules it affects" />

<sub>The idea becomes rules, and what is missing becomes a question — the Creative hands the doubts back in the chat.</sub>

[Highlights](#highlights) · [Features](#features) · [What it is](#what-it-is) · [Get started](#get-started-in-three-commands) · [Documentation](#documentation) · [License](#license)

</div>

> The Portuguese [README.md](README.md) is the source and the one that is
> checked: it carries the current version and the counts (rules, decisions,
> providers). This translation leaves the numbers out on purpose.

---

## Highlights

<table>
  <tr>
    <td width="25%" valign="top">🛑 <b>Nothing leaves without approval</b><br />Every external effect is born as a <code>proposed_action</code> and goes through the project's policy; merging into a protected branch is always yours.</td>
    <td width="25%" valign="top">🧱 <b>The agent is untrusted by construction</b><br />Ceilings on iterations, corrections and budget, in code. A prompt is not a guarantee; code is.</td>
    <td width="25%" valign="top">📜 <b>Everything recorded and immutable</b><br />An append-only event log with dense numbering per session: auditable cost and verifiable backup.</td>
    <td width="25%" valign="top">👥 <b>One team from brief to deliverable</b><br />Creative, PO, Architect, Dev Lead, devs per module, Infra, QA and SecOps over a real git repository.</td>
  </tr>
</table>

## Features

### The idea becomes rules, and what is missing becomes a question

<img src="docs/assets/readme/perguntas-no-chat.png" alt="The Creative records the rules and hands the open questions back in the chat, each with a suggestion" />

The Creative hands the doubts back in the chat, with a suggestion and the
rules each one affects. You answer right there, and the answers become
business rules.

### The Architect decides in writing

<img src="docs/assets/readme/arquitetura-e-adr.png" alt="The Architect proposes the architecture decision as a pull request and asks you to confirm the architecture" />

The architecture decision is born as a pull request, and the architecture only moves on with
your confirmation.

### The devs work inside the container

<img src="docs/assets/readme/dev-agent-trabalhando.png" alt="The dev agent narrates what it is fixing while working inside the container" />

Every command goes through the project's policy, and what the dev agent does
stays in the session thread.

### The merge is always yours

<img src="docs/assets/readme/merges-pelo-chat.png" alt="The queue of pull requests ready to merge in the Creative's chat, with Approve and Deny" />

Pull requests that pass the gates arrive in the chat, and one click on Approve
confirms.

**From zero to a deliverable, in a real run:** [the walkthrough with the recordings](https://daneiel.github.io/brabo/prd/en/tutorials/from-zero-to-deliverable) — 8 of 8 tasks, 102/102 tests, US$ 1.07.

---

## What it is

Brabo orchestrates specialized agents — Creative, PO, Architect, Dev Lead and
devs per module, Infra, QA, SecOps, Psychologist and Anamnesis — working over a
real git repository, with Gitflow provisioned automatically.

Areas (dev, QA, Infra) have a **lead** as their only external address: whoever
sends a handoff talks to the lead, and delegation to the subagents is the
area's internal business.

What sets it apart from a coding assistant:

**Nothing with an external effect happens on its own.** Terminal command,
commit, push, PR, merge, token spend — everything is born as a
`proposed_action`, goes through the project's policy (`deny` always beats
`allow`) and only then executes. Two cases not even the policy can release:
**merging into a protected branch** and **changing an agent's instruction**.
They are ceilings applied after the whole policy, not defaults.

**The agent is untrusted by construction, and the system assumes it.** An
iteration ceiling, a ceiling on corrections per task, a budget that refuses the
call, a closed catalog of what Anamnesis may profile. A prompt is not a
guarantee; code is.

**Everything is recorded and immutable.** The event log is append-only with
dense numbering per session. That is what makes the Psychologist's evidence
traceable, the cost auditable and the backup verifiable.

**The team improves, with you in the loop.** The Psychologist proposes
hypotheses anchored in real events; Anamnesis derives your proficiency profile
and proposes versioned instruction patches. Every patch needs your sign-off,
and reverting creates a new version instead of erasing history.

## Get started in three commands

```bash
cp .env.example .env
pnpm install
pnpm dev
```

`pnpm dev` brings up Docker Compose (Postgres 16 + pgvector, api, engine, web)
with hot reload. On the first start the api and the engine apply their own
migrations. `pnpm --filter api seed` creates the demo users.

| service | address | note |
|---|---|---|
| Web | <http://localhost:5173> | login `owner@brabo.dev` / `brabo12345678` (from the seed) |
| API | <http://localhost:3000> | `GET /health` |
| Engine | <http://localhost:4000> | `GET /health` |

`pnpm dev:down` tears everything down. `pnpm dev:build` forces a rebuild.

### The menu, if you'd rather not memorize commands

```bash
pnpm bootstrap
```

Day-to-day commands live in three places that don't talk to each other:
`package.json` (the pnpm scripts), the `Makefile` (the Kubernetes targets) and
loose scripts in `deploy/k8s/` and `docker/`. The menu is the single door. It
**reimplements nothing** — each item calls exactly the `pnpm`, `make` or script
that already exists.

| key | what it does |
|---|---|
| `1`–`6` | picks the item, **no Enter** |
| `v` | goes back one level |
| `q` | quits |
| `↓` | while running, shows the live output |
| `↑` | goes back to the "running" screen |
| mouse wheel · `j`/`k` · `PgUp`/`PgDn` | with the output shown, scrolls the whole log |
| `G` | goes back to the end of the log (live) |
| `Ctrl+C` | aborts the running command |

The valid shortcuts show in the footer of the screen you're on — no need to
remember them. The banner stays pinned at the top while you navigate, scroll
or resize the window.

**Scrolling the log.** The expanded output used to show only the end of the
file; now it is a window that moves backwards, and the command's whole log is
reachable without waiting for it to finish. Two consequences the footer
announces right away:

- **Scrolling back FREEZES the window** (like `less +F`), otherwise redrawing
  five times a second would undo the scroll before you read the line. `G`
  follows the end again.
- **While the command runs, the menu turns on mouse tracking** to receive the
  wheel — and with it on, dragging no longer selects text. **Hold `Shift`** for
  the terminal's native selection. Outside that screen tracking stays off, and
  it is also turned off on exit, including by `Ctrl+C`.

**The four areas.** `Create` provisions the environment from scratch, `Deploy`
publishes code to an environment that already exists (that's why it's the only
one with a per-service choice) and `Destroy` tears down:

| area | items |
|---|---|
| **1. Docker** | `Deploy` → All · Api · Engine · Web — `Create` — `Destroy` — `Reset total` — `Reconfigurar Ollama` — `Base de projetos` |
| **2. K8s** | `Deploy` → All — `Create` — `Destroy` |
| **3. Database** | `Generate` — `Migrate` — `Seed` — `Delete` |
| **4. Test** | All · Api · Engine · Web · Smoke · Docs |

Four things the menu does that are worth knowing:

- **`Docker › Destroy` keeps the volumes** (`down`, never `down -v`):
  destroying containers is not destroying data.
- **In K8s only `All` works.** The cluster bootstrap installs api, engine and
  web together; Api/Engine/Web show in the menu **disabled**, with the reason.
  Hiding them would hide the limit; running them would invent a path that
  doesn't exist.
- **`Database › Delete` is the only screen that asks for Enter**, and it
  requires typing the database name. It wipes the schema and **recreates the
  pgvector extension** — `init.sql` only runs on the volume's first
  initialization, so a bare `DROP SCHEMA` would make the next migration fail.
  Since the engine shares the same database, the script warns that recovering
  takes `pnpm db:migrate` **and** `pnpm engine:migrate`.
- **`Docker › Reset total` stops the api and the engine before erasing** —
  those two, and no other: they are the ones holding a live connection to the
  database, and a `DROP SCHEMA` under them kills the processes with nothing to
  bring them back (the engine dies inside the drop itself, because the
  `Rehydrator` queries a table that just vanished). After migrating it brings
  everything up again, waits for it to be healthy and seeds; at the end it
  **asks** the `/health` of the api and the engine and the web's `/` before
  saying anything — if one doesn't answer, it names it and exits with code 1,
  instead of announcing success. It is the second screen that asks for
  confirmation (typing `RESET`), and it doesn't remove volumes — and says so
  when it runs, because the flip side is that a reset never reproduces a first
  clone (a defect that only shows with a new volume goes unnoticed). Details in
  [`docs/runbook.md`](docs/runbook.md#reset-total).

**Command-line options:**

```bash
pnpm bootstrap                                # opens the menu (needs a terminal)
pnpm bootstrap --print-commands               # prints the whole tree and exits
pnpm bootstrap --print-commands --path 1.1    # just one subtree
pnpm bootstrap --help                         # the usage header
```

`--print-commands` resolves each leaf of the menu to the real command **without
running anything** — that's how you audit what the menu does, and it's what the
test runs on (`scripts/dev/bootstrap.spec.ts`). Without an interactive terminal
the menu refuses to open and points at that option, instead of hanging on a key
that never comes. For the same reason there is
`--print-window <log> <lines> <offset>`: the slice the scroll takes from the log
is pure arithmetic, and this way it's testable without a TTY.

`NO_COLOR=1` turns color off; otherwise it uses the design system's tokens in
24-bit ANSI and degrades to 256 colors where the terminal doesn't support it.

> **`pnpm dev` and `make deploy-local` don't coexist.** Both publish api and
> engine on the same ports — on purpose, so the smoke test holds for
> both. With the local cluster up, **5173 doesn't open**, and the web is at
> <http://localhost:8088>. `pnpm dev:preflight` tells you which mode you're in;
> `make k8s-down` brings you back to this one. Details in
> [Getting started](docs/getting-started.md#os-dois-modos-locais-não-coexistem).

> The `api`, `web` and `engine` containers run with the SAME UID/GID as your
> host user — never as root — so that `apps/api/dist` and whatever else the
> agent writes in the bind mount is born with YOUR ownership. Find your pair
> with `id -u` and `id -g`; if it doesn't match the default (1000/1000, the most
> common on a single-developer Linux machine), set `DEV_UID`/`DEV_GID` in `.env`
> (see `.env.example`) before the first `docker compose up`.
> An environment that existed before this change: the named volumes of
> `node_modules`/`_build`/`deps`/`.mix`/`.hex` still have content written by
> root in the old containers — run once
> `sudo chown -R $USER apps/api/dist apps/*/node_modules` (or delete the
> volumes with `docker compose down -v` and let the next `up` recreate them) to
> clear what got stuck.

## Documentation

**📖 [daneiel.github.io/brabo](https://daneiel.github.io/brabo/)** — the same
documentation below, browsable and searchable. The site reads from `docs/`,
publishes on merge to `main`, and so it sits one promotion cycle behind what is
in `dev`: for the latest state, read the files here.

| document | for |
|---|---|
| [Introduction](docs/intro.md) | the overview |
| [Getting started](docs/getting-started.md) | from the clone to the first agent turn |
| [Architecture](docs/architecture.md) | code map, boundaries, invariants, technical debt |
| [Business rules](docs/business-rules.md) | the RNs, each with `file:line` and the test that covers it (count in the [Portuguese README](README.md)) |
| [Runbook](docs/runbook.md) | deploy, rollout, restore, key rotation, cost incident |
| [Glossary](docs/glossary.md) | harness, gate, handoff, DEK, outbox, cycle K |
| [Observability](docs/explanation/observability.md) | how to follow an action across the three processes: trace, log and the path across layers |
| [Configuration](docs/reference/configuration.md) | every environment variable |
| [Scripts](docs/reference/scripts.md) | every `pnpm` command and `Makefile` target, extracted from the source |
| [Events](docs/reference/events.md) | the event log types, broadcasts and spans |
| [Permissions](docs/reference/permissions.md) | the `permissions.json` format and the decision order |
| [Artifacts](docs/reference/artifacts.md) | the schemas and who may emit each one |
| [Git providers](docs/reference/git-providers.md) | the operation contract and the capabilities |
| [Internal API](docs/reference/internal-api.md) | the api ↔ engine contract |
| [Security](SECURITY.md) | how to report a vulnerability |
| [Contributing](CONTRIBUTING.md) | flow, Definition of Done, what is accepted |
| [Governance](GOVERNANCE.md) | today's model (single maintainer), the three roles of the `community` mode and who gets into each |
| [Where to get help](SUPPORT.md) | which channel for each kind of subject |
| [Code of conduct](CODE_OF_CONDUCT.md) | Contributor Covenant 2.1 |

## Stack

| layer | technology |
|---|---|
| `apps/api` | NestJS 11 + Drizzle ORM + PostgreSQL 16 + pgvector |
| `apps/engine` | Elixir/OTP + Phoenix (channels) + Oban (queues in Postgres) |
| `apps/web` | React 19 + Vite + TanStack Query/Router; `mermaid` at runtime (only the Architect's C4 diagram, behind a dynamic `import()`) |
| auth | first-party in the api (argon2id + Ed25519 access JWT + opaque refresh with rotation); RBAC in the api's domain |
| deploy | Kubernetes via Kustomize; Docker Compose for development |

No Redis: queues live in Postgres via Oban, and the rate limit is a sliding
window in SQL.

## License

[MIT](LICENSE) © 2026 Daniel Souza — the official text, with no additional
clauses.

The engine image bundles third-party tools the gates depend on (gitleaks,
hadolint, semgrep, yamllint), **some under the GPL**. Running them as a
separate process contaminates nothing, but **publishing the image** to a
registry creates an obligation to make the source available. It's all listed,
with each one's version and license, in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) — read it before the first
push to a registry.

The web image bundles the design system's three fonts, all **OFL 1.1** — a
permissive license, but one that requires distributing the copyright notice
with the binary. It's in `apps/web/public/fonts/LICENSE.txt`, served with the
rest of the static files, and the obligation is recorded in the same notices
file.

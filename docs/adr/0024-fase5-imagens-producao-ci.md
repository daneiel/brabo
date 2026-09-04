# ADR 0024 — Phase 5 (session 1): production images, compose.prod, CI, and smoke test

- Status: accepted
- Date: 2026-07-26
- Phase: 5 (session 1 — items 1 through 5 of the spec)

## Context

Up to this point, everything Docker-related in the repository was
**development-only**. The three images were single-stage, ran as **root**,
with no `USER`, `EXPOSE`, or `HEALTHCHECK`, and none of them copied code:
all depended on a bind mount of the repository and installed dependencies
on container start. The `web` one was a `vite dev` — there was no nginx or
static build anywhere. The engine had no `mix release` configuration.

And **there was no CI**: the two workflows under `.github/workflows/` are
Claude Code helpers, none of them run tests, lint, or build.

This session delivers items 1–5 of Phase 5. Out of scope (items 6+):
Kubernetes/Helm, graceful shutdown with preStop, OpenTelemetry/Prometheus,
backup/restore, rate limiting.

## Decisions

### 1. `.dockerignore` before any image: 742 MB → 5.2 MB of context

There was no `.dockerignore` at all, and both build contexts were the
repository root. Every build sent `node_modules` (543 MB), `.pnpm-store`
(220 MB), `.git`, and the `.env` files to the daemon.

Measured with a probe image (`FROM alpine` + `COPY . /ctx`), because an
estimation script gets it wrong: my first two measurements were wrong due
to my own prefix bugs, not a `.dockerignore` bug. With the file:
**5.2 MB**.

Two exceptions the build broke on before being discovered, worth recording
because they contradict what the names suggest:

- **`design/tokens.css` is a build input, not documentation.**
  `apps/web/src/index.css` does `@import '../../../design/tokens.css'` and
  Vite resolves it on the filesystem. Excluding the whole `design/`
  directory breaks `vite build`. Only the `.md` files in there are
  documentation.
- **`docker/web/` needs to be in the context.** The web image copies the
  `nginx.conf` and the entrypoint from there, unlike the other two.

### 2. A latent bug in the api build that had never been exercised

`apps/api/tsconfig.build.json` had no `include`. Without it, `tsc` also
compiled `drizzle.config.ts`, `vitest.config.ts`, and `scripts/`, inferred
the package root as `rootDir`, and emitted **`dist/src/main.js`** — while
`start:prod` is `node dist/main`. The production command was broken from
the very start and nobody noticed, because development uses `start:dev`.
The first production image is what exposed it.

### 3. Migration is a one-shot service, not a boot step

If every replica migrated on startup, two coming up together would compete
for the same migration. In `docker-compose.prod.yml` there are two
services that run once and terminate, with the apps depending on them via
`service_completed_successfully`.

There are two because there are two schema owners in different images:

- **api**: `drizzle-kit` is a `devDependency` and the production image
  carries none. We created `src/db/migrate.ts`, which uses
  `drizzle-orm`'s programmatic migrator (a runtime dependency) — the same
  mechanism vitest's `globalSetup` already used.
- **engine**: a release has no Mix; `mix ecto.migrate` doesn't exist in
  the image. `Engine.Release` (the canonical Ecto pattern) is called via
  `bin/engine eval "Engine.Release.migrate()"`.

Verified that there's no cross-reference between the two's migrations, so
they run in parallel.

### 4. In the production image, installing a scanner is FAIL-HARD

In development, installing gitleaks/hadolint/semgrep is best-effort
(`|| echo`) on purpose: the detector notices the absence and the gate
skips. In production this is unacceptable, and the reason is written in
the earlier ADRs themselves: **without hadolint the infra QA gate approves
any Dockerfile** (ADR 0021) and **without gitleaks the SecOps gate runs
with no secret check** (ADR 0020). A network failure during the build
would produce a green image whose security gate is a no-op.

So: no `|| echo`, with a **verified SHA256 checksum** (the checksum
guarantees the binary is the expected one, not just that it downloaded),
pinned versions in `ARG`, and a final verification step that executes each
binary — including a real `semgrep scan`, not just `--version`. That step
paid for itself: see decision 8.

### 5. Writable engine volumes (item 2 of the spec)

Two mount points declared with `VOLUME` and with ownership adjusted at
build time:

| path | what writes to it |
|---|---|
| `/data/project-workspaces` | per-project working tree and the per-agent worktrees at `<workspace>/.worktrees/<agent_id>`; also `permissions.json` |
| `/data/git-repos` | local bare repos, written by the dev agent's `git push` |

Plus `/tmp` (4 detectors and `InfraGateRunner`'s temp tree) and `$HOME`
(semgrep downloads and caches rules from the registry on first run) —
these two as `tmpfs`, since the rootfs is read-only.

**The two paths need to be IDENTICAL in the api and the engine.** The api
persists the bare repo's absolute path in the database and the engine uses
it literally; mounting them at different locations breaks the push with
`remote unpack failed`.

A corollary that only shows up while running things: the directories need
to **exist in both images, with the right owner**. When a named volume is
born empty, Docker copies content and ownership from the path in the
image — if the path doesn't exist, the volume is born root-owned and the
non-root process can't write to it. That's why the api's image also
creates `/data` and does `chown node:node`; `node` and `engine` are both
uid 1000, so the two containers share the volumes with no conflict
(verified both ways).

### 6. Phoenix's `check_origin` was breaking the team panel in production

In `:prod` Phoenix's default is to compare the websocket's origin against
`url: [host: ...]`, which is `PHX_HOST`. The live team panel (Phase 4a item
7) talks over a Phoenix channel from the web, served from **a different**
origin — the handshake would be rejected and the panel would go silent,
with no error visible on the server.

`runtime.exs` now accepts `WEB_ORIGIN` (a comma-separated list, the same
variable the api already uses for CORS). Without it, it keeps the strict
default.

### 7. nginx: the security headers disappeared on the route serving the app

nginx's `add_header` **discards all inherited headers** when the child
block declares any `add_header`. Since the cache policy required an
`add_header Cache-Control` inside `location = /index.html`, the `server`
block's security headers disappeared exactly on `/` — the CSP existed in
the file and never reached the browser. Found with `curl -D-`, not by
reading.

Fix: the cache policy became a `map $uri`, the headers are declared
**once** in `server`, and no child block uses `add_header`. `/healthz`
uses `default_type` instead of `add_header Content-Type` for the same
reason.

Verified per route: `/`, a router route (fallback), `/assets/<hash>.js`,
`/healthz`, and a 404 for a nonexistent asset (which needs to be a 404 and
not `index.html`, otherwise a missing asset reaches the browser as HTML
and the error shows up as invalid syntax).

Beyond that, the official nginx image's entrypoint **doesn't work here**:
it only runs the scripts in `/docker-entrypoint.d` when the process is
root (running as `nginx` it prints "skipping auto-configuration" and
variable substitution never happens) and writes the rendered conf into
`/etc/nginx`, which is read-only. Hence `docker/web/entrypoint.sh`, which
renders into `/tmp` and validates with `nginx -t` before starting.

### 8. Image security: what was fixed and what was accepted

`trivy` with `--severity HIGH,CRITICAL --ignore-unfixed` started out
reporting findings on all three images. An `exit-code: 1` in CI would have
been born red; the response was **not** to loosen the gate, it was to
fix things:

| fix | effect |
|---|---|
| `apk upgrade --no-cache` on all three (the pinned tag also freezes Alpine's patches) | zeroed the system-package CVEs; the **web ended up with 0 findings** |
| removing the npm/npx/corepack bundled in the Node base image | zeroed the api's **24 findings** — all of them came from `/usr/local/lib/node_modules/npm`, **none from our own dependencies**. The runtime runs `node main.js`; a package manager in there is just attack surface |
| pinning gitleaks 8.21.2 → **8.30.1** | the 8.21.2 binary was compiled with Go 1.23.2 and carried 15 stdlib CVEs, 1 CRITICAL. Verified that `mix test --only gitleaks` still passes |

What's left is what **we can't fix ourselves**, accepted in
`.trivyignore.yaml` with three mandatory conditions per entry — a
third-party binary we don't compile, already in the latest published
release, and an **`expired_at`** (2026-10-31), so the debt goes back to
breaking CI instead of rotting silently:

- Go stdlib and `golang.org/x/crypto` inside gitleaks's official binary;
- `mcp` 1.23.3, a **fixed** dependency (`mcp==1.23.3`, not a range) of
  semgrep 1.171.0, which is already the latest release. We tried removing
  the package, since the gates only call `semgrep scan` and never
  `semgrep mcp`: **it doesn't work** — `semgrep/cli.py` unconditionally
  imports `semgrep.commands.mcp`, and the binary dies with
  `ModuleNotFoundError`. What caught this was the real `semgrep scan` in
  the Dockerfile's verification step (decision 4), not the suite.

### 9. Lint in check mode exposed 31 accumulated errors

The repository's lint scripts run with `--fix`/`--write`, so nobody had
ever seen check mode. In check mode: 31 errors. Thirty were formatting
(auto-fixed) and one was `no-unnecessary-type-assertion`. Two
`no-unused-vars` remained: one dead import (removed) and one `_modules`
from a rest-destructure where **the variable existing unused is the whole
point** — resolved by configuring `argsIgnorePattern: '^_'` in eslint,
which is the convention already used in the repository. The api suite was
rerun afterward: 508 passing.

### 10. The host's formatter wasn't the project's formatter

`mix format --check-formatted` under the pinned Elixir **1.17.3**
(Dockerfiles and CI) rejected **11 already-committed files**. It wasn't
drift from carelessness: the formatter's rules changed between versions,
and the code had been formatted by a newer Elixir — the one on the
development host (1.20.2 on this machine). Running `mix format` on the
host would "fix" the files for one version and break them for the other,
in a loop.

Since the pinned version is the one declared throughout the
infrastructure, it's the source of truth: the 11 files were formatted
**inside the 1.17.3 container**, and the README now instructs formatting
there when the host diverges. It was the first finding CI produced before
it even existed remotely.

Method note: my first reading of this check looked green, because the
wrapper masked the exit code and `grep | head` truncated the file list.
Only an explicit `echo $?` showed what was really happening.

### 11. The false-green guard in CI

`test_helper.exs` excludes the `:gitleaks`/`:hadolint`/`:yamllint` tags
when the binary is missing on the machine — and these three modules are
exactly the regressions that prove the gates don't approve empty
findings (ADR 0020/0021). On a bare runner they silently disappear and CI
goes green without ever having tested the security gates.

The `test-engine` job installs all three at the **same pinned versions as
Dockerfile.prod** and, after `mix test`, fails explicitly if the output
contains any excluded test. Locally, before: `254 passed, 9 excluded`.
With the binaries present: **`263 passed`, 0 excluded**.

For the same reason, the repository's `gitleaks` run scans full history
(`fetch-depth: 0`): a secret removed in the last commit is still
recoverable. The 3 findings were two synthetic PATs that exist **to be
found** (the regression fixtures) and a NestJS boilerplate placeholder —
allowlisted in `.gitleaks.toml` scoped by **rule and exact path**, never
by a broad pattern, because a broad allowlist is the same no-op the
earlier ADRs describe.

### 12. Build, scan, and smoke in the same job

The three images add up to ~1.3 GB; passing them between jobs via artifact
would cost more upload/download time than the entire build. They stay on
the runner's local daemon. Layer caching via `type=gha`, scoped per image.

## Known limitations (recorded, not resolved)

1. **`VITE_*` is compile-time.** Vite inlines `import.meta.env.VITE_*`
   into the bundle, so the api/engine/Keycloak URLs get baked into the web
   image: it's **one image per environment**, not the same image promoted
   between them. Solving this (runtime injection) is a prerequisite for
   the following session's Kubernetes work. nginx's `CSP_CONNECT_SRC`,
   on the other hand, IS runtime.
2. **Node stays in the engine image**, because the DevAgent runs the
   managed project's suite inside it (`TerminalExecutor`). It doesn't
   scale to arbitrary stacks; the real solution is a per-project sandbox,
   out of scope for Phase 5.
3. **`rtk` was left out** of the image — no verifiable origin to pin by
   checksum. The detector already degrades and the metric stays `nil`.
4. **`docker-compose.prod.yml` doesn't harden third parties.** Keycloak
   stays on `start-dev` with a development realm (hardcoded secret,
   `admin123`) and Postgres runs in a container with the default
   password. That file's target is **our three images**; hardening
   Keycloak and Postgres is work for another session, and it's stated at
   the top of the file.
5. **Branch protection isn't applicable on this repository today.** The
   GitHub API responds 403: *"Upgrade to GitHub Pro or make this
   repository public to enable this feature"*. The target configuration
   is documented below; applying it is a manual step for the user once
   the plan allows it.

## Target configuration for `dev` branch protection

Apply under *Settings → Branches → Add branch protection rule*, `dev`:

- **Require a pull request before merging** — no direct push.
- **Require status checks to pass before merging**, with *Require
  branches to be up to date*: `Lint`, `Testes TS (api + web)`, `Testes do
  engine (ExUnit)`, `Gitleaks no repositório`, `Build, scan e smoke das
  imagens de produção`.
- **Require conversation resolution before merging**.
- **Do not allow bypassing the above settings** (including
  administrators).
- **Do NOT** enable auto-merge or a merge queue: CLAUDE.md mandates that
  merging into a protected branch is always manual by the user, with no
  option to automate.

## Consequences

- A real production path now exists for the three apps, verifiable
  locally with a single command, and the gap between "the suite passes"
  and "the image comes up" is no longer invisible.
- CI covers lint, tests, build, image and secret scanning, and a smoke
  test — and **it actually tests the security gates**, which was the
  biggest hole.
- The images run non-root with a read-only rootfs, which also eliminates
  a class of friction that had already shown up in development (the
  root-owned `dist/` that needed a container to remove).
- Explicit, dated debt remains: `.trivyignore.yaml` expires on
  2026-10-31, and the five limitations above are input for the next
  session.

## Numbers

| | before (dev) | after (prod) |
|---|---|---|
| build context | 742 MB | **5.2 MB** |
| api image | 274 MB | 457 MB¹ |
| engine image | 1.17 GB | **796 MB** |
| web image | 255 MB | **93.5 MB** |
| engine suite | 254 passed, **9 excluded** | **263 passed, 0 excluded** |
| trivy HIGH/CRITICAL fixable | — | **0** across all three |

¹ The api's production image is larger because the development one
**carries no code or dependencies at all**: it uses a bind mount and
volumes. They aren't comparable as "before and after" of the same thing.
Of the 457 MB, 165 MB is production `node_modules` (of which 51.7 MB is
`gpt-tokenizer`).

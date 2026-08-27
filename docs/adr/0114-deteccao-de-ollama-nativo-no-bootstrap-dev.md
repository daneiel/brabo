# ADR 0114 — Native Ollama detection in dev bootstrap: ask once, persist to `.env`, gate the compose services behind a profile

- **Status:** Accepted
- **Date:** 2026-08-26
- **Context:** closes a real port collision found during local dev bootstrap between the compose's `ollama` service and a native Ollama install already running on the developer's machine
- **References (without editing):** [ADR 0025](0025-fase5-deploy-kubernetes-kustomize.md) (decision 10 — `pnpm dev` and `make deploy-local` share ports on purpose), [ADR 0100](0100-rag-search-e-modelos-garantidos-no-boot.md) (introduced the `ollama`/`ollama-model-loader` pair this ADR gates)

## Context

`scripts/dev/preflight.mjs` already existed to catch a known port clash
before `docker compose up`: `pnpm dev` and `make deploy-local` share ports
3000/4000/8080 on purpose (ADR 0025, decision 10), and an opaque `port is
already allocated` from Docker doesn't say who's holding the port or what to
do about it. Preflight reads `docker compose config`, cross-references
`docker ps` and `ss -tlnp`, and reports every collision by name.

`OLLAMA_PORT` (default `11434`) sits in that same set — and it is also the
default port of a *native* Ollama install, the kind a developer might
already run for unrelated reasons on their own machine. Unlike the k3d
clash, this collision has a legitimate resolution the generic conflict
report doesn't know about: reuse the native daemon instead of running a
second one in a container. Reported as "port 11434 ← ollama (unknown
process)" like any other conflict, the fix looks like a problem to route
around, when the actual answer is "let it be reused."

## Decision

### 1. Confirm it's really Ollama before treating it specially

`detectarOllamaNativo` (`scripts/dev/preflight.mjs:234`) only special-cases
the port when a live GET to `http://localhost:<porta>/api/tags` answers with
the shape Ollama always returns, even with no model pulled yet
(`{"models":[]}`, checked via `ehOllama`, `preflight.mjs:159`). A short
timeout (1.5s) matters here: this runs before any container comes up, so a
hang here would hang the entire `docker compose up`. Anything on the port
that doesn't answer like Ollama falls through to the existing generic
conflict report — this decision only touches the one case where the
occupant is provably the thing this ADR is about.

### 2. Ask once, apply the default without a TTY, and record the decision so it isn't asked again

`perguntarUsoDoOllama` (`preflight.mjs:198`) prompts "Detectamos Ollama já
rodando na porta N. Usar essa instância? [S/n]" — but only when
`process.stdin.isTTY`. `bootstrap.sh`'s menu items run their command in the
background with stdin redirected from `/dev/null`, on purpose, so a running
command never steals the arrow keys the menu itself is reading; a prompt
that tried to read a line from a stream that's already closed would hang
forever. Without a TTY the function logs why and returns the default (yes)
directly — the same shape of guard the rest of the product already uses
whenever a decision needs a human but one might not be watching.

The answer is written to `.env` and never asked again for as long as
`OLLAMA_MODE` is present there: `detectarOllamaNativo` short-circuits at the
top the moment the key exists (`preflight.mjs:236`). Nothing in the normal
`pnpm dev` loop re-asks — the one way to reopen the question is the new menu
item in Decision 5.

### 3. `escreverEnv` — the first thing in this repo that *writes* `.env`, not just reads it

Every existing script that touches `.env` (`reset-total.sh`'s `*_TEST_KEY`
lookups, this same file's own `lerEnv`) only ever greps a value out. Nothing
before this needed to *update* one, so there was no existing bash pattern to
reuse for that direction. `escreverEnv` (`preflight.mjs:118`) is Node
because the update needs one property bash's line-oriented tools don't give
for free without extra care: read the file, rewrite a line in place when its
key already exists, append the key at the end when it doesn't, and leave
every comment and every other key untouched. On the "yes, use it" path it
writes `OLLAMA_MODE=host` and `OLLAMA_HOST=http://host.docker.internal:<porta>`;
on "no" it writes `OLLAMA_MODE=container` plus a fresh `OLLAMA_PORT` found by
scanning upward from `11500` (`proximaPortaLivre`, `preflight.mjs:178`) so
the container gets a free port instead of colliding with the native one it
was just told to leave alone.

### 4. Gate `ollama`/`ollama-model-loader` behind a compose profile

Both services (introduced by ADR 0100) move under `profiles: ["local-llm"]`
(`docker/docker-compose.yml:82,119`) — the same pattern
`docker-compose.prod.yml` already uses for the equivalent pair under the
literal name `llm` (different file, so the literal doesn't need to match).
A profiled service doesn't start with a bare `docker compose up`, which is
exactly what `OLLAMA_MODE=host` needs: not "started but unreachable," but
never started at all, so it never competes for the port and never burns RAM
loading a model nothing will query.

### 5. `scripts/dev/perfil-ollama.sh` decides `--profile local-llm` at the moment each command runs

One small script, not a duplicated `grep` in three places: it prints
`--profile local-llm` unless `.env` already says `OLLAMA_MODE=host`, and
nothing otherwise. It is consumed by the only two `docker compose` callers
that bring up the **whole** stack rather than one named service — "Docker ›
Deploy › All" and "Docker › Create" (`bootstrap.sh`, items `1.1.1`/`1.2`) —
via `$(bash scripts/dev/perfil-ollama.sh)`, written **escaped** as
`\$(...)` in the command-tree source so it evaluates when the menu item is
*executed*, not when the tree is built (the same escaping already used for
`\${POSTGRES_USER}` in Database › Delete's command). Api/Engine/Web
(`1.1.2`–`1.1.4`) target one service each and never touch `ollama`, so they
were left unchanged.

### 6. "Docker › Reconfigurar Ollama" (`1.5`) reopens the question

`scripts/dev/reconfigurar-ollama.sh` removes `OLLAMA_MODE` and `OLLAMA_HOST`
from `.env` unconditionally, and `OLLAMA_PORT` *only* when the mode being
forgotten was `container` — in `host` mode that port was written by whoever
installed Ollama natively, not by this mechanism, and deleting it would make
the next boot silently forget a value that was never this feature's to own.
The item needs no confirmation screen: it changes at most three lines of
`.env` and nothing destructive to data, the same bar the rest of the
non-trivial-but-non-destructive menu items already clear (Generate,
Migrate, Seed).

## Consequences

**A profile that hides the port also hides a real conflict, so the
detection path had to grow its own.** With `ollama` under an inactive
profile, `docker compose config` no longer lists port `11434` at all by
default — the generic per-port loop that used to catch "something else is
squatting on 11434" would simply stop seeing it, a silent regression versus
the behavior that existed *before* this ADR. `detectarOllamaNativo` closes
that gap itself: when the port is occupied by something that answers
anything other than Ollama's shape, it returns a conflict entry in the exact
format the generic loop already produces, so it lands in the same report.

**Removing `api`'s `depends_on: ollama` was a forced, not incidental,
change.** Compose refuses the whole file with "depends on undefined
service" when a service outside an inactive profile depends on one inside
it — confirmed by testing in an isolated sandbox before touching the real
file, and it broke every `docker compose` invocation (`up`, `down`, `ps`,
even `config`, which `preflight.mjs` itself calls). The dependency was
already vestigial for compose's purposes: `api` calls Ollama at agent-turn
runtime, never at its own boot, so nothing about startup ordering was lost.

**Declared, not fixed here: "Docker › Destroy" can orphan the profiled
containers.** `docker compose down` without `--profile` ignores containers
that belong to an inactive profile — if `ollama`/`ollama-model-loader` are
up under `local-llm`, plain Destroy leaves them running and can leave the
network in a "still in use" state. The request that produced this ADR only
asked for the `up` path; Destroy was left alone deliberately, and is a real
gap for a human to decide on (apply the same conditional `--profile`, or
accept it as-is).

**Declared, not fixed here: a project's own idle `ollama` container can be
mistaken for a native install.** If a developer switches to
`OLLAMA_MODE=container` but doesn't bring the containers down first,
`detectarOllamaNativo` has no way to tell "a native install is on this
port" from "the project's own `ollama` container, from a previous run, is
still on this port" — it would ask again in that case. Not implemented: the
sequence is uncommon (reconfiguring without stopping the stack first) and
was out of the scope of the request that produced this feature.

**Append order in `.env` is not curated.** When none of the three keys
exist yet, `escreverEnv` appends them at the end of the file, not next to
the `OLLAMA_PORT`/`OLLAMA_HOST` block `.env.example` already documents them
around. Cosmetic, not a correctness problem — the values are exactly as
valid wherever they land in the file.

## Alternatives considered

- **Keep reporting the occupied port as a generic conflict and let the
  developer resolve it by hand through `.env`.** Rejected: this is a common,
  benign situation, not an error — labeling it identically to "the k3d
  cluster is up" or "an unrelated process is on this port" teaches the
  developer to work around something that has a one-line fix, every single
  time they start the stack.
- **Detect and silently reuse the native instance, no question asked.**
  Rejected on the same principle the rest of the product already holds for
  configuration it doesn't own (CLAUDE.md: the product never overwrites a
  user's configuration without an explicit decision) — even a low-stakes
  dev convenience gets one explicit question, asked once, not a silent
  default a developer only discovers later by reading `.env`.
- **Leave `ollama`/`ollama-model-loader` outside any profile and just stop
  publishing the port in `host` mode.** Rejected: the containers would still
  start, still load a model into memory, and still spend CPU/RAM that
  nothing would ever query — a profile keeps them from starting at all,
  which is what "use the native one instead" actually means.

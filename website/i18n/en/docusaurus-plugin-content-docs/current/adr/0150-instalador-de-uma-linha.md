---
traducao_de: b4ee01ec5b0fa2bb837b94747022ab4b10cdc213
---

# 0150 — The one-line installer, with a chosen source and a marker

## Status

**Proposed.** Depends on [ADR 0149](0149-assinatura-dos-artefatos-publicados.md):
without a signature, this document proposes exactly what PHASE 28 refused.

## Context

Installing Brabo today requires a checkout, five secrets exported by hand and
knowledge that is nowhere — the three gestures that
[the phase document](../explanation/fase-29-instalacao-de-uma-linha.md)
describes. Three facts on disk constrain any installer design:

**The production compose is not an installation manifest.** All the services of
`docker/docker-compose.prod.yml` point to `brabo-*:prod` **with a local
`build:` block** (`:102-105`, `:144-147`, `:253-256`, `:381-384`); there is not
a single reference to `ghcr.io` in `docker/`. The file's header says of itself,
at `:1` and `:8`, that it is the *"compose de VALIDAÇÃO das imagens de
produção"* and that *"o que este arquivo NÃO é: um manifesto de produção
endurecido"*. The only consumer of `.release/images.json` in the repository is
`scripts/ci/aplicar-imagens.ts`, which writes to a **kustomize overlay**
(`Makefile:35-36`).

**There is already a consent mold, and it is rigid in the right place.**
`scripts/dev/consentir-base.mjs:195-208`: without a TTY, the script **reports
and returns 0** — it does not consent, does not write, does not create a
folder. And its order is law: `validarBase` runs **before** any `mkdir`
(`:228-242`), writing to the `.env` is the **last** step (`:272`), and a proof
that fails refuses without writing (`:246-258`).

**The five secrets are already generated somewhere.** `docker/smoke.sh:31-57`
generates the five with `openssl rand`, respecting an already exported value
(`${VAR:-$(gerar)}`), including the detail that `NEO4J_PASSWORD` must be `-hex`
because `/` breaks the parse of `NEO4J_AUTH` (`:53-56`). There is no need to
invent that part, only to make it persistent.

## Decision

### 1. The invocation preserves stdin

```sh
sh -c "$(curl -fsSL https://github.com/daneiel/brabo/releases/latest/download/install.sh)"
```

And **not** `curl … | sh`. The reason is mechanical, not aesthetic: with the
script arriving through the pipe, the process's `stdin` **is the download**,
and a `read` to ask anything reads bytes of the script itself or hits EOF. An
installer that cannot ask would have to choose on its own where to create
folders on someone's computer — and the repository's rule is the opposite
(`consentir-base.mjs:195-208`).

Without a TTY the installer **reports and exits**, in the same format as the
mold: it prints what it would do, what it found, and the command to run in a
terminal.

### 2. The script verifies its own origin before acting

`install.sh` is **versioned in the repository** and published as a Release
asset. It carries its own version and, as its first act, downloads the signed
`checksums.txt` of that Release, verifies the signature (ADR 0149) and checks
**its own hash** against it. If it diverges, it stops.

This extends — it does not cite as already said — point 5 of
[ADR 0146](0146-base-consentida-no-bootstrap.md):195-212, which versions
`consentir-base.mjs` with the argument that *"a script that configures the
user's host, creates a folder and writes to the `.env` is precisely the artifact
whose provenance needs to be auditable"*, and whose corollary is that **the api
gains no route that emits a host script**. `install.sh` is the same kind of
artifact, with more reach; the corollary holds the same.

### 3. Detection names what it found, and only then asks

The **marker** lives in `$XDG_STATE_HOME/brabo/install-state.json`, with fallback
`~/.local/state/brabo/` — the same idiom `servico.ts:250-261` already uses for
`XDG_CONFIG_HOME`. Not in `~/.brabo/`, which is where the runner keeps things
**per project**: installation state and project configuration are different
lives, and putting them together would make deleting one erase the other.

The marker is **versioned** (`schemaVersion`) and stores: installed version,
source (`ghcr` or `local`), applied digests, paths (`.env`, projects base,
compose directory) and the date. It is what makes the second execution a
**diff** and not a guess.

Without a marker — every installation prior to this version — the script looks
for **signals**: a compose project with `brabo-*` services,
`brabo-runner-*.service` units, a `.env` with the five keys. And it **names
what it found** before any question. There is no "found something, decide on
my own" path.

### 4. Deletion says what it deletes, and what it never deletes

| deletes (with confirmation, listed beforehand) | **never** deletes |
|---|---|
| the compose's named volumes, `pgdata` included | the user's **projects base** |
| the generated `.env` | the **mirror folder** (RN-516: the mirror never deletes, and neither does the installer) |
| the runner's service units | any folder outside the marker's paths |
| the device key on disk | what the key protects on the server — revoking is another action |

The second column is the point. A user folder is accumulation, not product
state; deleting it would be the installer taking a decision nobody delegated to
it.

### 5. Two image sources, and "official" is the result of verification

- **`--source=ghcr`** (default): reads the Release's `.release/images.json`,
  resolves each image **by digest** and verifies the signature (ADR 0149).
- **`--source=local`**: `docker buildx bake` with `docker-bake.hcl:81-83`,
  which produces exactly the four names the compose expects. It requires a
  **clean working tree on a tag**; otherwise it **refuses**, because an image
  built from a dirty tree is not the version it claims to be.

The word "official" only appears in the output when the verification
**passed**. Switching source afterwards is an image swap over the same volumes
— the data does not move.

### 6. An installation compose of its own

`docker/docker-compose.install.yml` is born, which consumes the **digests** of
`.release/images.json` and has no `build:` block. `docker-compose.prod.yml`
stays **intact**: it is the validation compose, it is what `docker/smoke.sh`
uses (`:19-20`, building locally on purpose), and promoting it to installation
manifest would break the use it already has and contradict its own header.

The cost is declared: two files with the same service topology. What separates
them is what each one answers — *"does this tag build?"* versus *"does this
machine run what was published?"*.

### 7. The broker does not come up in this phase, and the consequence is stated

`docker-bake.hcl:81-83` has **four** targets and
`scripts/ci/images-manifest.ts:54` accepts four; `brabo-broker:prod`
(`docker-compose.prod.yml:333`) only exists built locally, and that is why the
`container-broker` profile is **unreachable from Release artifacts**.

The installer does **not** offer the profile, and **says** what that means: with
`--source=ghcr`, a project in `mounted` mode — which
[ADR 0146](0146-base-consentida-no-bootstrap.md) made the local default — does
not bring up a container, because whoever brings it up is the broker
([ADR 0144](0144-a-segunda-raiz-do-broker.md)). Conversation and backlog work;
dev agent execution in that mode does not.

Publishing the broker as a fifth image is the fix, and it is **small** (one
target in the bake, one id in `images-manifest.ts`, one more signature). It
stays out of this ADR by scope, not by doubt: it enters as its own item, and
while it does not, `--source=local` is the path that gives complete `mounted`.

### 8. Windows is a named refusal

As it already is in RN-518 (`servico.ts:517-532`): the installer names the
platform, says it is out of scope by declared decision and points to the
foreground path. It is neither a generic failure nor a silence.

### 9. Pure bash, with the decision testable

`install.sh` is **bash**, because it needs to run before any dependency exists
on the machine. The decision logic (detect, compare marker, choose source, build
the deletion plan) stays in pure functions, and the script exposes
`--print-plan` / `--print-state` so a vitest spec can exercise them without
executing anything — the precedent is real and from the same repository:
`scripts/dev/bootstrap.sh` has `--print-commands` and is tested by
`scripts/dev/bootstrap.spec.ts`.

### 10. The post-startup check is its own, and `smoke.sh` is not reused

`docker/smoke.sh` generates the five secrets (`:31-57`) and is the precedent of
decision 5 — but **calling it does not work**: it starts with `--build` (it
builds what this installation just downloaded by digest) and tears the stack
down at the end, unless `SMOKE_KEEP_UP=1`. It is a CI test, and an installation
is not a test.

The installer does the honest minimum instead: after `up --wait`, it hits the
`/health` of the api and the engine, and **only then** says it installed.
`--wait` already waits for the healthcheck — but whoever announces a state has
to have asked about it, which is exactly the lesson `reset-total.sh` cost (it
announced "reset completo" with the api in `Exited (1)`).

By the same reasoning **there is no migrate step**: the compose chains `api` →
`migrate-api` with `service_completed_successfully`, and a second place ordering
migration would be a second source of the same truth.

## What this ADR explicitly rejects

- **`curl | sh`.** By decision 1: it closes stdin and with it consent.
- **Promoting `docker-compose.prod.yml` to installation manifest.** It breaks
  `smoke.sh`, which builds locally on purpose, and contradicts the file's
  header.
- **An api route that generates the script.** An explicit corollary of ADR 0146
  point 5, and it holds with even more force here.
- **Guessed migration.** A previous installation without a marker is not
  "probably the same": it is named, and the path is that of
  [ADR 0152](0152-backup-de-volumes-contra-compose.md).
- **Deleting anything outside the marker's paths.**

## Consequences

- Installing no longer requires a checkout, and the five secrets are generated
  once and persisted with mode `600` — today `smoke.sh` generates them and
  discards them with the stack.
- **Two composes** with the same topology, and divergence between them becomes
  something to watch. The ceiling: the installation one gains no service the
  validation one does not have.
- With `--source=ghcr`, `mounted` has no container until the broker is published
  (decision 7). Declared in the installer's output, not discovered later.
- The installer's second execution becomes a readable diff. The first execution
  **on a machine that already had Brabo** remains the hard case, and is the only
  one that depends on another ADR.

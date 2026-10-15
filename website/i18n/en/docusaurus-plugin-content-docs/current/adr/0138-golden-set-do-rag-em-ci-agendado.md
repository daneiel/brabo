---
traducao_de: 1eb71c3229b3ec8770369028759fe2f4281495a4
---

# ADR 0138 — The RAG golden-set now runs in CI, scheduled — and remains `warn`

## Context

[ADR 0132](0132-golden-set-de-acerto-do-rag.md) (Stage 2 of the measurable RAG
program) closed with a declared Consequence:

> **CI wiring is `TODO(humano)`, same as QA.** Without an API LLM secret or new
> infra (real Ollama in CI), the golden-set runs MANUALLY —
> `mix golden_set.rag` — and never in a normal `mix test`.

And the `rag-acertivo` gate (`docs/gates.yml`) was born `severidade: warn`, with
the comment saying exactly why: "there is no CI with an LLM... `block` would
promise an automatic lock that does not exist".

This is Stage 3, decided by the product owner in this session: **wire the RAG
golden-set into CI**. The question that was still open — every PR or scheduled
— was also decided in this session: **scheduled**, given the cost of pulling
`nomic-embed-text` (~274MB) and running the real search against the curated
corpus (a few minutes) in every CI window. The QA golden-set
([ADR 0123](0123-golden-set-regressao-qa-automacao.md)) **does not change at
all here** — it remains exactly `TODO(humano)`, for the reason the next section
makes precise.

### Why the RAG one is tractable and the QA one still is not

The `TODO(humano)` of ADR 0123 lists the missing alternative: "a runner with a
GPU, an Ollama pull step". That sentence hides a difference that matters: the QA
golden-set calls a **chat** model doing **judgment** — expensive, it measures
something inherently non-deterministic (ADR 0123 itself records real runs with
`qwen2.5-coder:latest` varying from 1 to 5 hits out of 6, between executions).
The RAG golden-set only calls the **embedding** model (`nomic-embed-text`,
~137M parameters) — CPU is enough, no GPU, and embedding does not sample: the
same input always produces the same vector. `ubuntu-latest`, with no GPU at all,
is enough infrastructure for this golden-set — it would not be for the QA one.

### The obstacle that did not exist: no secret needs to be generated

`apps/api/scripts/seed-golden-set-rag.ts` opens its own
`NestFactory.createApplicationContext(AppModule)` — it never talks to an api
already running as a server. The four secrets the api would refuse with an
example literal in production (`AUTH_JWT_SECRET`, `BRABO_SERVICE_TOKEN`,
`CREDENTIALS_MASTER_KEY`, `GIT_OAUTH_STATE_SECRET` — RN-114,
[ADR 0059](0059-segredo-do-state-de-oauth-sem-default.md)) are only checked when
`NODE_ENV === 'production'`
(`apps/api/src/infrastructure/security/{oauth-state-secret,auth-key-material,service-token}.ts`,
`envelope-encryption.service.ts`). The script never sets `NODE_ENV` — neither it
nor `mix golden_set.rag`, which invokes it via `System.cmd` — so the four fall
into the development branch and use the dev literal without complaint. Unlike
`docker/smoke.sh`, which brings up `docker-compose.prod.yml` with
`NODE_ENV=production` ON PURPOSE and therefore needs to generate the four with
`openssl rand` — this workflow needs no generated secret at all.

## Decision

**A new workflow, separate from `ci.yml`.** `.github/workflows/ci.yml` is
deliberately `pull_request` only (comment at the top of the file itself):
mixing `schedule` there would affect every existing job, with no per-job filter.
`.github/workflows/golden-set-rag.yml` is born with `schedule` (daily cron) +
`workflow_dispatch` (runs on demand — useful to validate this very change and
after calibrating the search's weight/threshold, ADR 0080, or the curated
corpus).

**`services: postgres` + `services: ollama`, the same pinned versions as the
rest of the product.** `pgvector/pgvector:pg16` (same as the `test-engine` of
`ci.yml`) and `ollama/ollama:0.33.1` — the SAME version pinned in
`docker/docker-compose.yml`. Ollama version parity is what keeps
`test/fixtures/golden_set_rag/floor.json` (keyed by MODEL, not by environment)
valid when running in CI: an Ollama different from the one that generated the
local floor could produce subtly different embeddings and change the rank of a
borderline case, without that being a real regression.

**The Ollama health-check uses `ollama list`, not `curl`.** `--health-cmd` runs
INSIDE the service container, and the official image does not guarantee having
`curl` — it only guarantees having the `ollama` binary itself.
`docker/ollama/pull-models.sh` (the reference logic, already validated with a
real model download) uses exactly that waiting pattern
(`until ollama list >/dev/null 2>&1`); this workflow reuses the same command as
the health-cmd instead of inventing a new waiting mechanism.

**The model is pulled by a direct HTTP call, `POST /api/pull`, from the
RUNNER side (not from inside the container).** `curl` on the `ubuntu-latest`
runner is guaranteed (already used in several `ci.yml` steps to download a gate
binary). `stream:false` makes the call block until complete and return the final
JSON — no polling loop. It is the SAME endpoint the `ollama pull` binary calls
underneath (`docker/ollama/pull-models.sh` documents this: "a CLI `ollama` usa
HTTP contra `${OLLAMA_HOST}/api/*`"), just without going through the CLI
wrapper, which is not installed on the runner.

**Explicit migration before the seed.** `main.ts`/`app.module.ts` migrate
nothing on their own at boot — confirmed by reading
`apps/api/src/db/migrate.ts`, a separate script. The job runs
`pnpm --filter api db:migrate` before `mix golden_set.rag`.

**`docs/gates.yml`: `rag-acertivo` remains `severidade: warn`.** Deliberate,
not forgotten — see Consequences. `evidencia.tipo` changes from `teste` to `ci`
(same format as the `backmerge` gate), with `workflow` pointing to the new file.

## Consequences

**`warn` remains `warn` — by a cadence decision, not a technical limitation,
and that difference is what this ADR changes relative to 0132.** The gate
actually RUNS in CI now; what does not exist is a PR blocked by it. A search
accuracy regression shows up up to 24h after being merged (or right away, via a
manual `workflow_dispatch`), never at PR time — a trade-off explicitly accepted
by the product owner, given the cost of ~3-6min per execution (model pull +
indexing + 17 searches) that running on every PR would impose.

**The QA golden-set (ADR 0123) does not change at all here.** It remains
entirely manual, `TODO(humano)` — the asymmetry (deterministic CPU embedding vs.
expensive, non-deterministic chat judgment) is deliberate and explained above,
not an inconsistency to fix later.

**The curated corpus gap remains open.** The 17 questions keep measuring
retrieval over the same 22 curated files of ADR 0132, not the 130+ real ADRs —
this stage wires the MECHANISM into CI, it does not widen what it measures.
Widening the corpus remains an embedding-cost decision in a manual run, declared
separately.

**New risk, and where it lives.** The business logic (seed script, accuracy
criterion, ExUnit test) was already proven — 17/17, twice, according to ADR
0132. What is genuinely new here is the workflow ORCHESTRATION (two services,
step order, model pull by direct HTTP), which cannot be tested end to end
outside real GitHub Actions. Recommended to the user: trigger a manual
`workflow_dispatch` as soon as this PR merges, to confirm the job is green
before waiting for the first scheduled window.

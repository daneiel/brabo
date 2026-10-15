---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0197 — The workflows' image comes from the compose, and image Dependabot is turned on

## Status

**Accepted.** 2026-10-01 (AT-246, story HS-024, epic EP-016, round 36; owner
decision on 01/10: *"remove the literal from the workflows"* — the `image:` of
the `services:` now comes from a previous job that reads the compose, a single
source of digests, and Dependabot `docker`/`docker-compose` is turned on). On
top of [ADR 0159](0159-imagem-de-terceiro-por-digest.md) (third-party image by
index digest) and [ADR 0178](0178-tag-inline-na-imagem-de-terceiro.md) (the tag
inside the reference), without editing them: both remain valid in everything;
this one closes the half 0178 declared NOT done in *"What this ADR does NOT
do"*.

## Context

ADR 0178 put the tag inside the reference — the form Dependabot reads — and left
image Dependabot off because of ONE blocker: `pgvector` and `ollama` lived
twice, in the compose and as a literal in the workflows' `services:`. No
ecosystem reads workflow `services:`, so every bot PR bumping one of the two in
the compose would be born red by the "same tag, two digests" rule of
`scripts/ci/imagens-pinadas.ts`; and the step that would align the workflow in
the bot's PR would have to push a commit into `.github/workflows/`, which
`GITHUB_TOKEN` cannot, not even through `permissions:`. The ADR listed four
exits; the owner chose the second.

Measured on `origin/dev` (d89f77714e) before changing — every third-party
`image:` in `.github/workflows/`, and where each should read from:

| workflow | job → service | image | reads from |
|---|---|---|---|
| `ci.yml` | `test-api-shard` → `postgres` | `pgvector/pgvector:pg16@sha256:ccc6e83d…` | `postgres` service of `docker/docker-compose.yml` |
| `ci.yml` | `test-engine` → `postgres` | same | same |
| `golden-set-rag.yml` | `golden-set-rag` → `postgres` | same | same |
| `golden-set-rag.yml` | `golden-set-rag` → `ollama` | `ollama/ollama:0.33.1@sha256:075246f7…` | `ollama` service of `docker/docker-compose.yml` |
| `golden-set-qa.yml` | `golden-set-qa` → `postgres` | pgvector, same | `postgres` service |
| `golden-set-qa.yml` | `golden-set-qa` → `ollama` | ollama, same | `ollama` service |

Six literals, two images, all with the same digest as the DEV compose. No job
`container:` and no other `image:` in the workflows. The dev compose, and not the
production or installation one, is the right source for the two reasons that
already existed: it is against it that the api and engine suites run in dev, and
it is it that `golden-set-rag.yml` promised to follow (the golden-set floor is
keyed by MODEL, not by environment). The three composes carry the same digest
today, and the lint guarantees they keep doing so.

And the lint had a blind spot the new form would open if nobody looked: the
`image:` pattern was `(\S+)`, and a line with an expression (`${{ … }}`, which
has a space) did NOT match — it vanished from the check instead of being judged.
Worse: what matched with `$` was treated as interpolation and skipped.
`image: ${{ 'postgres:16' }}` would pass green.

## Decision

**1. The workflows' `services:` read the image from the compose.** A new
reusable workflow, `.github/workflows/imagens-do-compose.yml` (only
`workflow_call`), runs `scripts/ci/imagens-do-compose.ts`, which reads the
direct child `image:` of each service listed in `IMAGENS_DOS_WORKFLOWS` and
returns it as an `output`. The caller does:

```yaml
jobs:
  imagens:
    uses: ./.github/workflows/imagens-do-compose.yml
  test-engine:
    needs: imagens
    if: ${{ !cancelled() }}
    services:
      postgres:
        image: ${{ needs.imagens.outputs.pgvector }}
```

The script REFUSES a nonexistent service or one without `image:` (renaming in the
compose breaks CI on the spot, instead of delivering an empty string) and a
reference outside the `imagem:tag@sha256:<índice>` form — a second door, because
the reading job cannot depend on `lint` having run before. No `pnpm install`:
the script only uses `node:fs`, with a sparse checkout of `docker/` and
`scripts/ci/`.

Reusable and not a job copied into each file: there are three callers, and three
copies of the same checkout + setup would be the duplicate this ADR exists to
remove, one level up.

**2. The lint understands the new form and closes the door it opens.** In a
`.github/workflows/` file, `imagens-pinadas.ts` now reads `image:` and the short
form `container: <imagem>` with a pattern that accepts spaces, and fails:

- **`literal no workflow`** — any literal third-party reference, EVEN pinned by
  digest: it is the duplicate no ecosystem reads;
- **`expressão de imagem fora da forma`** — anything that is not EXACTLY
  `${{ needs.<job>.outputs.<imagem> }}`: a literal inside the expression, `||`
  with a default value (before or after the output), `env.`, `vars.`,
  `format()`, a suffix after `}}`, an unclosed expression;
- **`imagem do workflow fora do compose`** — `needs.<job>` whose job does not
  call `./.github/workflows/imagens-do-compose.yml`, or an output it does not
  declare.

The product's own image (`brabo-*`) stays out, as in the other trees. Each rule
is proven by MUTATION in `imagens-pinadas.spec.ts`: turning off the literal,
loosening the expression form, not checking the job, not checking the output,
ignoring the rest after `}}` or reverting the pattern to `\S+` — each mutation
breaks at least one test (measured: 4, 1, 2, 1, 1 and 12). And
`imagens-do-compose.spec.ts` ties the reusable to the table: the declared outputs
are EXACTLY the keys of `IMAGENS_DOS_WORKFLOWS`, each bound to the step that runs
the script — an output in between with a literal fails.

**3. Image Dependabot is turned on** in `.github/dependabot.yml`, with
`target-branch: dev` like the others:

- `docker-compose` in `/docker` — the five composes live there, so a bump
  updates dev, production and installation in the SAME PR;
- `docker` in `/docker/*` (the `FROM`s, one folder per image) and
  `/deploy/k8s/**` (the manifests). NEVER `/docker` without the `/*`: the
  `docker` ecosystem also reads YAML with `image:` (that is how it covers
  Kubernetes — the `YAML_REGEXP` of dependabot-core's
  `shared_file_fetcher.rb`, read on 01/10), and would read the composes, opening
  a second PR for the same image;
- each ecosystem with ONE group (`patterns: ['*']`): `node:24-alpine` lives in
  three dev Dockerfiles and `node:24.21.0-alpine3.23` in three production ones,
  each in a folder, and without a group they would be three PRs with the same tag
  and different digests — red by the rule;
- `ignore` for `brabo-*` (and `ghcr.io/*/brabo-*`): the images this repository
  builds have no third-party registry to look in.

**4. The `golden-set-rag.yml` promise becomes construction.** It said, in a
comment, that it ran "a MESMA versão pinada de docker/docker-compose.yml". Since
ADR 0159 the lint VERIFIED that through the "same tag, two digests" rule; now
there is nothing to verify, because there is no second copy: the golden-set's
Ollama is, by construction, the reference of the dev compose's `ollama` service.
The same holds for `golden-set-qa.yml` and for the Postgres of the `ci.yml`
suites.

## Consequences

**The bot's PR only touches the compose, and that PR's CI already runs against
the new image** — the `services:` reads the compose from the PR itself. There is
no alignment step, no credential with `workflows`, no `GITHUB_TOKEN` push
without checks.

**Two required jobs gain a dependency, and cannot become `skipped`.**
`Testes do engine (ExUnit)` (required check) and the api shards wait for the
`imagens` job. GitHub's default would SKIP the job if `imagens` failed, and
`skipped` counts as green for a required check — the same trap the api aggregator
already avoids with `if: always()`. That is why both carry
`if: ${{ !cancelled() }}`: with `imagens` red, the job runs, receives an empty
image and fails. The new job (`imagens / Ler as imagens do compose`) does NOT
enter a ruleset. Cost measured in time: none measured yet — it is a sparse
checkout and a `setup-node` without cache, running in parallel with `lint`;
`TODO(humano)` on the first run.

**A new workflow service has a single path**: image in the compose, a line in
`IMAGENS_DOS_WORKFLOWS`, an output in the reusable (the spec fails if they
diverge), `needs: imagens` in the workflow. The runbook (*Bumping a third-party
image*) says so.

**The lint's count drops from 39 to 33** literal references: the six in the
workflows ceased to exist, and the sentence in `cadeia-de-suprimentos-do-ci.md`
that `contagens-do-codigo.mjs` checks follows.

## What this ADR does NOT do

**It does not resolve the duplicate BETWEEN ecosystems.**
`neo4j:5.26-community` and `ollama/ollama:0.33.1` also live in
`deploy/k8s/base/` (`neo4j/statefulset.yaml`, `ollama/job-model-loader.yaml`),
which belongs to the `docker` ecosystem, while the composes belong to
`docker-compose` — and Dependabot does not group across ecosystems. Two
consequences, declared:

- when the bot bumps the TAG (the common case), two green PRs come out, each in
  one place; until both go in, compose and cluster run different versions — and
  the lint does not fail different tags, only the same tag with different
  digests;
- when the registry RE-PUBLISHES the same tag with another digest
  (`5.26-community` is a moving tag), both PRs are born red by the "same tag, two
  digests" rule, and the reviewer merges the two bumps into a single PR (the
  runbook procedure). The same fate awaits a re-published digest of
  `node:24-alpine` if it one day lives in a compose AND a Dockerfile.

It was not resolved here because every exit is a product decision, not this
ADR's: deriving the manifest from the compose (a kustomize transformer still
holds a literal), taking the compose from `docker-compose` and giving it to
`docker` (which also reads YAML, not measured for compose) or relaxing the rule
between trees (what the rule protects — dev and cluster running the same bytes
under the same tag — is real).

**It does not measure Dependabot running.** No image bot PR exists yet. Not
measured by execution: `docker-compose` accepting the five file names
(`docker-compose.<sufixo>.yml`) and ignoring interpolated references
(`${BRABO_API_IMAGE:?…}`); grouping by `directories` producing ONE PR across
folders. The bot's first PR is the proof, and what it contradicts comes back
here in a new ADR.

**It does not extend `dependabot-justifica-pin.ts` to image pins.** The bot's PR
touches `docker/**`, and the drift (`config-e-inferencia`, `block`) will ask a
human for `docs-not-needed:` — AT-094's decision limited the bot-written line to
ACTION pin swaps, and ADR 0178 already declared that.

**It does not cover what was already out.** They stay in the runbook's MANUAL
procedure, with Dependabot or without: CloudNativePG's `imageName` (a key no
ecosystem reads) and `IMAGEM_DO_GOLDEN_SET_QA` (a TypeScript constant read by
`golden-set-qa.yml` via `sed`). The product's images, interpolated references and
multi-stage stages stay out of the lint (ADR 0159).

**It does not create an RN.** The image rule has no RN, for the same reason as
the actions: it lives in `CLAUDE.md` and in
`docs/explanation/cadeia-de-suprimentos-do-ci.md`.

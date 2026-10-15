---
traducao_de: cf708bdefd987dda6e1cb40b3aa9e520113eb6b8
---

# 0159 — A third-party image comes in by digest, and the lint fails whoever forgets

## Status

**Accepted.** It REVISES a decision declared in writing in
`docs/explanation/cadeia-de-suprimentos-do-ci.md` — *"pinning by tag is a
deliberate stop, not an oversight"* — and revokes it with measurement. It does
not touch [ADR 0119](0119-imagens-publicadas-no-ghcr-por-digest.md), which
remains the owner of the four images the product publishes. It corresponds to
`BRB-004`, a P2 of the maintainer's register.

## Context

[ADR 0119](0119-imagens-publicadas-no-ghcr-por-digest.md) made the four OWN
images go by digest, and `#419` gave the repository a mechanism for the other
side of the same family: `scripts/ci/actions-pinadas.ts`, which fails a `uses:`
pinned to a tag. Its docblock states the argument:

> Tag é um ponteiro que o dono da action pode remover e recriar apontando para
> outro commit (…). Quem move a tag executa código no runner que tem o checkout
> e, nos workflows de release, as credenciais do GHCR e do npm.

That argument **was never applied to `image:`**, and the supply chain page said
why:

> Third-party images are pinned by tag, not by digest (…) so this is weaker
> than the action pins — a deliberate stop, not an oversight. It buys the
> reproducibility that matters day to day (…) without the maintenance cost of
> digests on images we don't publish.

The sentence has two premises, and measurement knocks down both.

**"Images we don't publish".** Measured on 2026-09-12: there are **37**
third-party references, and three of the places where they run are not "day to
day".

- Thirteen are Dockerfile `FROM`s — `node:24.11.1-alpine3.21`,
  `hexpm/elixir:1.17.3-…`, `nginx:1.27.5-alpine`, `alpine:3.20`/`3.20.3`,
  `node:24-alpine`. Those are the **base of the images we publish**: third-party
  bytes we sign with `cosign` ([RN-524](../business-rules.md#rn-524)) and deliver
  to other people. The `alpine:3.20` of `docker/backup/Dockerfile.prod` is, by
  the way, the only `FROM` that `BRB-004` itself already named.
- Four are in `docker/docker-compose.install.yml`, which is what comes up **on
  the machine of whoever installed the product**, next to that person's Postgres
  ([RN-527](../business-rules.md#rn-527)). In the **same file**, the four own
  images arrive through a variable already resolved by digest, and the
  third-party ones arrived by tag.
- Four are in `.github/workflows/ci.yml` and `golden-set-rag.yml`, as job
  `services:`. That is **literally the runner** the actions rule exists to
  protect, reached through the other door — and neither of the two files had been
  looked at in that light. `BRB-004` did not enumerate them either.

**"Maintenance cost".** It is real and does not go away, but it is the SAME cost
the repository already accepted for actions, whose pin is also moved by hand.
What it buys is the same thing: referring to content, and not to a name someone
else controls.

There is also a trap recorded in writing in `docs/reference/brb.md`, and it
explains why the item stayed open so long: read by its id, `BRB-004` looks like
the pinning of `ollama:latest` that PRs `#401`/`#419` closed. *"An id is not a
description"* — those PRs swapped `latest` for a version; this one asks for a
**digest**.

## Decision

**1. Every third-party image is pinned by digest, with the tag in a comment next
to it** — the same shape actions use:

```yaml
image: neo4j@sha256:22ec5cd0…  # 5.26-community
```

In a **Dockerfile** the comment goes on the line ABOVE:

```dockerfile
# 3.20
FROM alpine@sha256:d9e853e8… AS runtime
```

The digest is the **index** one (manifest list), never that of a platform:
pinning the `linux/amd64` manifest would break `linux-arm64` without warning. The
comment is **mandatory**, for the same reason as with actions —
`sha256:22ec5cd0…` tells nobody that it is Neo4j 5.26 —, and it is **one token**,
with no space: it is what separates the tag from the PROSE that already lives
above almost every `FROM` of this repository.

**The position in a Dockerfile is not taste, and it was learned by getting it
wrong.** The first version of this change wrote `FROM alpine@sha256:… # 3.20`,
by symmetry with the compose. Docker's parser only recognizes `#` at the START of
a line: that is not a commented `FROM`, it is a `FROM` with three arguments, and
the build dies with `FROM requires either one or three arguments`. The finding
has a second half worth more than the first — **`hadolint` had passed on all five
Dockerfiles**. It has its own parser, and a linter agreeing is not the build
agreeing; whoever failed it was the `bake` of the `images` job, in 27 seconds.

The check inherited the lesson in TWO forms. It recognizes the comment at the end
of the `FROM` **only to be able to fail it** — a pattern that simply did not
match the wrong line would make the reference VANISH from the scan instead of
turning red, trading an error for silence, which is the defect this check exists
not to have. And, for the same reason, the YAML comment is captured whole and
judged afterwards, instead of validated inside the pattern.

**2. A SIBLING check, not an extension.** `scripts/ci/imagens-pinadas.ts` runs
in the `lint` job, next to `actions-pinadas.ts`, and fails three things: a
mutable reference, a digest without the tag in a comment, and the **same tag with
two different digests** in different files. They are two scripts and not one
because they are two questions: `uses:` lives in workflow YAML with one syntax;
an image lives in compose, in kustomize manifests and in Dockerfiles, with three
others. A function that answers both answers both badly — it is the same
reasoning `docs/.docmap.yml` already uses to separate `politica-de-branches` from
`checks-e-rulesets`.

The third reason exists because of a concrete promise: `golden-set-rag.yml`
says in a comment that it runs the *"MESMA versão pinada de
docker/docker-compose.yml"*, because the golden-set floor is keyed by model and
not by environment ([ADR 0138](0138-golden-set-do-rag-em-ci-agendado.md)). With a
tag that was a promise; with a digest it becomes verifiable.

**3. The check does NOT cover the images the product publishes**, and the
decision is deliberate, with three independent reasons:

- **They are not third-party.** There is no owner outside this repository who
  could move any pointer.
- **It is impossible.** `brabo-api:prod` is a LOCAL tag produced by
  `docker compose build`: the digest does not exist before the build and changes
  on every build. A literal there would be requiring the nonexistent.
- **It would fight the mechanism that already resolves them.** Where they cross
  a registry, [ADR 0119](0119-imagens-publicadas-no-ghcr-por-digest.md) already
  puts them by digest — `.release/images.json` written by `release.yml`, applied
  by `make imagens-do-release`. The overlay keeps the MARKER
  (`REPLACE_WITH_DIGEST`) and not a frozen release, on purpose: the repository
  does not declare that production runs v3.2.0. A check requiring a literal
  digest in the overlay would fail precisely the correct state.

For the same reasons, **interpolated** references (`${BRABO_API_IMAGE:?…}`) stay
out — `install.sh` writes the four into the `.env` already by digest — as do
**multi-stage stages** (`FROM deps AS build`, `FROM scratch`), which are not
registry images.

The exception list is by **name** and fails closed: a new third-party image never
matches `brabo-`, so it is born checked.

**4. The observability compose enters**, and that was an open question in the
activity (`TODO(humano)`: does it enter the check's scope, or stay out for not
coming up in a user installation?). The answer is the cost of each side.
Including it costs four digests. Excluding it costs a **named exception inside
`docker/`**, which is exactly the shape of hole the docblock of
`actions-pinadas.ts` diagnoses: *"a new workflow is born copying its neighbor,
and the neighbor was on a tag"*. An exempt file in the middle of the folder is
the wrong neighbor.

## Consequences

**The digest freezes, and the price is declared.** An image pinned by digest
does not receive a security fix until someone swaps the digest by hand — the same
debt the actions' SHAs carry (`BRB-006`). This ADR does **not** solve that: it
declares it. `.github/dependabot.yml` turns on the `github-actions` ecosystem for
that reason; the `docker` ecosystem is **not** turned on here, and turning it on
is a separate decision, because it changes the PR cadence of a monorepo that
already turned off npm *version updates* due to flooding.

**Dev images freeze more than production ones.** `node:24-alpine` was a rolling
tag on purpose, and the digest pins it to a specific 24.x. It is the least
comfortable consequence of this decision, and it is accepted by the same
argument: the broker's dev image runs `pnpm install` in the build, and a base
that changes underneath is one more variable when something breaks only on
someone's machine.

**37 lines changed and none changed content.** Each digest was resolved against
the registry from the tag that was already written, and it is the index digest —
builds remain multi-arch. What the repository lost was the ability to receive
different content without anyone seeing.

**`BRB-004` stops reproducing**, and formally closing it remains the job of
whoever raised it, in the vault — the rule `docs/reference/brb.md` already
states.

**What this ADR does NOT do:**

- **It does not extend to signatures.** A digest is the integrity of what was
  pulled; provenance is `BRB-005`, whose open half (the proxy verifying the
  manifest's signature) was measured and rejected with a number
  ([RN-525](../business-rules.md#rn-525)).
- **It does not cover `deploy/k8s/helm/otel-collector-values.yaml`**, where
  `image:` opens a map with `repository:` and no tag: whoever chooses the tag
  there is the chart, and pinning would require deciding the chart's version too.
  It stays DECLARED, not covered.
- **It does not create an RN.** The rule is a sibling of the one that forbids
  `uses:` by tag, and that one has no RN either: both live in `CLAUDE.md` (CI/CD
  release section) and in `docs/explanation/cadeia-de-suprimentos-do-ci.md`,
  which `docs/.docmap.yml` watches in `block`. Putting one of the two in
  `docs/business-rules.md` would give two addresses to the same policy.

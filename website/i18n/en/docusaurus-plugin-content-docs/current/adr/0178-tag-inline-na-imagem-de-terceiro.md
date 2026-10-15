---
traducao_de: cc6cd4e5f762017286b36c6232f5d75f5a0739e3
---

# 0178 — The third-party image tag lives INSIDE the reference, before the digest

## Status

**Accepted.** 2026-09-29 (AT-139, story HS-024, epic EP-016). On top of
[ADR 0159](0159-imagem-de-terceiro-por-digest.md), which remains valid in
everything that is not the reference's FORM: index digest, the three trees, what
the check does not cover and why. Maintainer decision of 2026-09-27, written in
the AT-139 note, which called it "ADR 0171" — a number that was reserved and
never written; **this ADR is that one**, and 0171 remains vacant.

The decision had two halves. This ADR records the one that went in — the form
and the lint — and declares why the other, enabling Dependabot for images, did
**not** go in (see *What this ADR does NOT do*).

## Context

ADR 0159 pinned the 39 third-party image references by digest, with the tag in
a comment beside it (`neo4j@sha256:…  # 5.26-community`; in a Dockerfile, on the
line above), mirroring the form of actions (`uses: x@<sha>  # v4`). And it
declared the price: a digest freezes, and *"enabling Dependabot's `docker`
ecosystem is a separate decision"*.

The decision came on 2026-09-27 — Dependabot `docker` — with a condition: first
measure whether its PRs pass the pin lint. The measurement (round 15 lane, which
stopped at the gate, with no PR) knocked down ADR 0159's form:

- **Dependabot does not read the tag in a comment, in any format.** The comment
  its `github-actions` reads is a convention of THAT ecosystem; `docker` has no
  equivalent.
- **A digest-only pin is updated to the `latest` digest**
  (`update_checker.rb`). pgvector, neo4j and node would go to another major,
  with the comment still asserting the old tag and the lint GREEN — the check
  verified the comment's presence, not its truth.
- **The compose × workflow duplicates** (pgvector and ollama in the `services:`
  of `ci.yml`/`golden-set-*.yml`) would make every bot PR be born red by
  ADR 0159's own "same tag, two digests" rule: no ecosystem reads workflow
  `services:`.
- CloudNativePG's `imageName` also stays outside any ecosystem.

And there was a reference in the repository that already had the other form,
for another reason: CNPG's `imageName` is `postgresql:16.10@sha256:…` because
the operator's webhook REFUSES a digest-only reference — it reads the Postgres
version from the tag. That is, the `imagem:tag@sha256:` form was already proven
in the repository by Kubernetes, by `kubeconform` and by the k3d bootstrap.

## Decision

**1. The third-party image reference becomes `imagem:tag@sha256:<índice>`.**

```yaml
image: neo4j:5.26-community@sha256:22ec5cd0…
```

```dockerfile
FROM node:24.11.1-alpine3.21@sha256:b8f7c905… AS deps
```

With both present, Docker pulls by the digest: the tag is information for the
reader, and the digest decides the bytes — ADR 0159's immutability stays intact.
What changes is that the tag is now read through the SAME syntax by whoever
executes (Docker), whoever updates (Dependabot) and whoever reviews. The digest
is still the INDEX one, never a platform's.

The 39 references of the three trees migrated without changing any digest — 29
in `docker/` (16 in compose, 13 `FROM`), 4 in `deploy/k8s/` and 6 in
`.github/workflows/`. The tag comments went away: the reference is the source,
and an equal comment would be a second copy to go stale.

**2. The lint derives the tag from the reference and fails what contradicts
it.** `scripts/ci/imagens-pinadas.ts` fails, besides the mutable reference:

- **digest without an inline tag** — including ADR 0159's form, with the tag
  only in the comment, because it is the one the bot would update to `latest`;
- **a comment asserting another tag** — a comment that is ONE token with a
  digit (`# 5.26-community`, `# pg16`) and diverges from the inline tag. A
  comment is still allowed (the decision says "comment out or equal"); what
  fails is the leftover of a version bump. Prose and a loose word without a
  digit do not assert a version and are not judged;
- **a comment at the end of the `FROM` line** — still failed, now with its own
  reason: Docker's parser does not accept it (ADR 0159);
- **the same tag with two digests** — the key becomes `nome:tag` read from the
  reference.

Each rule is proven by mutation in `imagens-pinadas.spec.ts`: turning off any of
the five breaks at least one test.

## Consequences

**ADR 0159's form now fails.** Whoever copies an old example (from ADR 0159,
from an old PR) gets the message telling them to put the tag inline, with the
reason. The runbook (*Bumping a third-party image*), the supply chain page and
`CLAUDE.md` now show only the new form.

**The comment stops being mandatory**, and that is the inversion of ADR 0159's
argument, not a loosening: there it was mandatory because it was the ONLY place
for the tag; here the tag is in the reference, and what the check requires is
that it exists and that nothing beside it contradicts it.

**No version changes.** Every digest is the same as before;
`docker build --check` passes on the nine Dockerfiles, a real build
(`docker/backup/Dockerfile.prod`) completes, `docker compose config` passes on
the touched composes and `kubectl kustomize` + `kubeconform` on the overlays.

## What this ADR does NOT do

**It does not enable Dependabot for images**, and the reason is a blocker the
27/09 decision did not cover. The decision called for *"a step that aligns the
workflows' `services:` in the bot's PR"*, in the mould of
`dependabot-justifica-pin.ts`. That step would have to PUSH a commit changing
`.github/workflows/*.yml` to the bot's branch, and `GITHUB_TOKEN` cannot do
that: it does not have, nor can it receive through `permissions:`, the
`workflows` permission, and GitHub refuses the push (*"refusing to allow a
GitHub App to create or update workflow … without `workflows` permission"*).
Documented by the GitHub community and not measured here by execution. There is
a second cost, already known in the repository: a push made by `GITHUB_TOKEN`
does not trigger workflows, so the alignment commit would stay without checks
until a human re-triggered it.

Enabling `docker`/`docker-compose` without the step would make every bot PR
touching pgvector or ollama be born red. The existing paths — which are the
maintainer's decision, not this ADR's — are in the AT-139 report: a credential
with `workflows` (GitHub App or token) only for that step; removing the literal
from the workflows (the `image:` of a `services:` accepts the `needs` context,
and a previous job would read it from the compose — a duplicate that does not
exist does not diverge); the step only DIAGNOSING and a human applying it; or a
bot `ignore` for the two duplicated images. Until then, bumping a digest is the
runbook procedure.

**It does not extend `dependabot-justifica-pin.ts` to image pins.** A bot PR
touching `docker/**` would hit the drift (`config-e-inferencia`, `block`), and
AT-094's decision limited the bot-written line to ACTION pin swaps. Widening that
class is a separate decision.

**It does not cover what was already out**: the product's own images,
interpolated references, multi-stage stages and Helm's
`otel-collector-values.yaml` (ADR 0159). And two images stay in the MANUAL
procedure, with or without Dependabot, because they live outside the three trees
or in a key no ecosystem reads: CNPG's `imageName` and the image of the QA
golden-set cases (`IMAGEM_DO_GOLDEN_SET_QA`, a TypeScript constant — already in
inline form).

**It does not create an RN.** The rule is a sibling of the actions one and
lives, like it, in `CLAUDE.md` and in
`docs/explanation/cadeia-de-suprimentos-do-ci.md`.

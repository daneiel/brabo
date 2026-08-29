---
id: cadeia-de-suprimentos-do-ci
title: The CI supply chain
sidebar_label: CI supply chain
description: What runs inside our CI runners that we didn't write, how it's pinned, and what's still trusted on faith.
---

# The CI supply chain

Every job in this repository runs third-party code on a machine that has
a checkout of the source and, in the release workflows, credentials for
the GHCR registry, the npm registry and the repository's own git refs.
That code arrives two ways: **GitHub Actions** (`uses:`) and **binaries
downloaded with `curl`** (the scanners). Neither is written here, and
neither is reviewed by a PR.

This page is about the part of that we control. It exists because the
mechanism lived only in workflow comments — a place where a rule can be
read but not audited, and where the two halves drifted for exactly that
reason.

## The threat, stated plainly

A tag is a pointer. `actions/checkout@v4` is not a version, it's a name
that the action's owner can delete and recreate pointing at a different
commit, at any moment, with no signal in this repository. Whoever moves
that tag runs their code in our runner, on our checkout, with whatever
secrets that workflow was granted.

The same holds for a `curl` of a GitHub Release asset: a compromised
release, or a MITM between the runner and the CDN, hands us a different
binary and nothing notices — until the scanner fails to start, or worse,
until it "works."

Neither is a hypothesis about our repository specifically. They're the
two documented ways CI gets compromised in the wild, and the defense for
both is the same idea: **refer to content, not to a name**.

## The two mechanisms

### Binaries: checksum after every download

Every `curl` of a release asset in `ci.yml` and in both engine
Dockerfiles is followed by `sha256sum -c` against a hash written in the
workflow itself:

```yaml
GITLEAKS_SHA256: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'
```

The hashes come from the `checksums.txt` published with each release, on
an independent download. A mismatch fails the job before the binary is
ever executed.

The scanner versions have a second constraint: they must match
`docker/engine/Dockerfile.prod`, because testing against a different
scanner from the one that runs in production is a false green. The
comment promising that was there since Phase 5; the step that *enforces*
it (`Versões dos scanners batem com o Dockerfile.prod do engine`, in the
`lint` job) arrived only with [#408](https://github.com/daneiel/brabo/pull/408).

### Actions: commit SHA, with the version alongside

Every `uses:` is pinned to a 40-character commit SHA, with the tag it
came from preserved in a trailing comment:

```yaml
- uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262  # v4
```

The comment is **required**, and not as decoration. It's the only thing
that tells a human — and Dependabot, which reads exactly that comment —
which version a hash is. A SHA with no version beside it is a pin nobody
can audit and nobody can update.

To resolve a tag into the SHA to write down:

```bash
gh api repos/actions/checkout/commits/v4 --jq .sha
```

## Why there's a check and not just a rule

#408 pinned the actions in `ci.yml` and only there. The other fifteen
workflows stayed on mutable tags for months — including `release.yml`
(pushes images to GHCR), `publish-runner.yml` (publishes to npm),
`tag-release.yml` (creates tags) and `docs-deploy.yml` (pushes to
`gh-pages`). The half that was left unpinned was, precisely, the half
that holds credentials.

That isn't carelessness, it's the predictable shape of a rule with no
mechanism: a new workflow is written by copying a neighbour, and the
neighbour had a tag. So the rule now has a mechanism —
`scripts/ci/actions-pinadas.ts`, run in the `lint` job, which fails on
any `uses:` that isn't a commit SHA, and on any SHA without its version
comment. It's the same reasoning as
[the RN and ADR counts](documentation-workflow.md): a number kept correct
by hand goes stale the moment someone forgets, so the artifact is read
instead of trusted.

A reference to an action **inside this repository** (`./.github/...`)
passes: it's our own code, reviewed by the PR that changes it, with no
third party able to move anything.

## Container images

Third-party images are pinned by tag, not by digest: `neo4j:5.26-community`,
`pgvector/pgvector:pg16`, `ollama/ollama:0.33.1`. Tags on a registry are
mutable too, so this is weaker than the action pins — a deliberate stop,
not an oversight. It buys the reproducibility that matters day to day
(`latest` changing the local LLM provider's behaviour between two
identical `docker compose pull`s) without the maintenance cost of
digests on images we don't publish.

The images we **do** publish are the opposite: the four production images
go to GHCR and the overlay pins them **by digest**, recorded per tag in
`.release/images.json` ([ADR 0119](../adr/0119-imagens-publicadas-no-ghcr-por-digest.md)).

## What is still trusted on faith

Declared, not fixed:

- **No Dependabot.** The SHAs are updated by hand. The version comments
  are already in the shape Dependabot expects, so enabling it is a
  config file — but it doesn't exist today, and a pin nobody updates is
  a pin that ages into a known-vulnerable version.
- **npm/pnpm dependencies aren't attested.** The lockfile pins versions
  and integrity hashes, which is real, but there's no provenance check
  (`npm audit signatures` or equivalent) in any job.
- **No signing or attestation of our own artifacts.** Neither the
  published images nor the runner binaries are signed — this sits with
  the runner code-signing item in
  [the backlog](backlog.md), unchanged by this page.
- **Third-party images are tag-pinned, not digest-pinned** (above).
- **The workflows' own permissions** aren't covered here; that's the
  `permissions:` block per workflow, and it's a separate audit.

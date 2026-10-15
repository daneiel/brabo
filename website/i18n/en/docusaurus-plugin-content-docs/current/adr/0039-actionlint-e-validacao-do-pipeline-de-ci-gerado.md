# 0039 — actionlint and validation of the generated CI pipeline

## Context

CLAUDE.md 8c calls for the second instance of the ADR 0038 model: the
InfraAgent becomes an Infra Lead, and gains the Workflows subagent, which
generates the user's project's CI pipeline (GitHub Actions or GitLab CI,
depending on the provider — RN-037). This ADR doesn't reopen the generic
area/lead/delegation model (that's ADR 0038); it fixes only the new,
instance-specific decision: how Workflows validates locally what it
generates, before proposing it, and what's left without validation for lack
of a tool.

The precedent is hadolint for the original InfraAgent (Phase 4a, ADR 0021):
without the binary, the infra QA gate approved any Dockerfile — including
one that didn't even parse — because the absence was treated as "skipped"
instead of "rejected for lack of proof". The same trap applies here: with no
validation at all, Workflows would propose a syntactically broken CI
pipeline with no signal of that in the PR.

## Decision

### 1. `actionlint` pinned in the engine's Dockerfile, same pattern as gitleaks/hadolint

`docker/engine/Dockerfile` (best-effort, `|| echo`) and
`docker/engine/Dockerfile.prod` (hard-fail, `ARG ACTIONLINT_SHA256` verified
with `sha256sum -c -`, entering the probe block that proves every gate
binary is present and executable). Version `1.7.12`, checksum verified
against the `actionlint_1.7.12_checksums.txt` published in the
`rhysd/actionlint` release and by an independent download+`sha256sum` of the
tarball. Mirrored in `.github/workflows/ci.yml` (`env.ACTIONLINT_VERSION`,
installed in the `test-engine` job — the same dev/prod/CI parity
gitleaks/hadolint already require).

It was born pinned at `1.7.7` (Go 1.23.4) and moved up to `1.7.12` (Go
1.26.1) within this same delivery — the image CI (`trivy`) rejected `1.7.7`
for 15 Go-stdlib CVEs inherited from the official binary (1 CRITICAL). The
new version doesn't zero out the list (the latest `rhysd/actionlint` doesn't
yet package the newer Go patch for every CVE), but it knocks out the
CRITICAL and 3 of the HIGHs — the remaining 12 HIGHs go into
`.trivyignore.yaml` with `expired_at`, the same pattern as gitleaks: a
third-party binary that's only downloaded (not compiled), already at the
latest published release, with an expiration date.

`Engine.Actions.ActionlintDetector` (Live + Fake) is an exact mirror of
`Engine.Actions.HadolintDetector`: `System.find_executable/1`, degrades to
`:unavailable` without breaking the turn, exit codes `0`/`1` normalized
(`1` = findings, not a process failure).

### 2. Validation happens at GENERATION time, not in a new post-PR gate

`Engine.Infra.Tools.ValidateInfraFile` (generalized in this phase — before
it only knew hadolint) dispatches by path extension: `Dockerfile*` →
hadolint, `.github/workflows/*.{yml,yaml}` → actionlint, `.gitlab-ci.yml` →
no validation (item 3). `WorkflowsAgent` calls this tool before
`emit_infra_delegation_result` — the same discipline the Lead already
followed for Dockerfiles.

We did **not** create a third post-PR gate: `Engine.Infra.InfraGateRunner`
keeps validating generic YAML (compose + any CI pipeline) with `yamllint`,
syntactic and surface-level — it checks whether it PARSES, not whether the
referenced `actions` exist or are valid versions. `actionlint` does a
deeper semantic analysis (action names, expression types, valid contexts),
and does it BEFORE the PR exists — at generation time, where Workflows can
still fix things without spending a gate correction cycle. Running both
validations (yamllint post-PR + actionlint pre-proposal) isn't redundant:
they're two different depths, in the same spirit as hadolint (syntactic,
pre-proposal) coexisting with SecOps's secret scanner (semantic, post-PR).

### 3. `.gitlab-ci.yml` is left without local static validation — a documented gap

There's no offline binary equivalent to `actionlint` for GitLab CI — the
official linter (`POST /api/v4/projects/:id/ci/lint`) needs a live GitLab
instance, and Workflows doesn't have (and shouldn't have) a GitLab
credential just to call that API to validate syntax. `ValidateInfraFile`
degrades with an explicit message ("no local static linter") instead of
inventing a partial validation (e.g., a generic YAML parser that wouldn't
understand `.gitlab-ci.yml`'s schema) that would give false confidence.
Recorded as a known environment limitation (`docs/runbook.md`), not hidden.

## Consequences

- Every Dockerfile OR GitHub Actions workflow that Workflows/Lead proposes
  has already gone through syntactic/semantic validation before the PR
  exists — without the binary, the "unavailable" message stays recorded in
  the event's `tool.result`, and that's what the `demo:infra-workflows-github`
  demo verifies (RN-037).
- `.gitlab-ci.yml` generated for a project with `GithubProvider` never
  happens (Workflows decides the format from the context's `gitProvider` —
  RN-037); `.gitlab-ci.yml` only ever gets born for a GitLab project, and it
  gets born without local validation.
- If GitLab CI ever gains an offline validator in the future, the extension
  point is `Engine.Infra.Tools.ValidateInfraFile.gitlab_ci?/1` — swap the
  "no linter" branch for a call to a new
  `Engine.Actions.GitlabCiLintDetector`, the same pattern as the other
  three.

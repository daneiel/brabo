---
traducao_de: 13603dddc11848b2458bb703718cbc1709f9c47d
---

# 0140 — A repeated `pnpm audit` timeout is an accepted risk; a finding still fails

## Context

On 2026-09-04 the npm advisories endpoint
(`POST registry.npmjs.org/-/npm/v1/security/advisories/bulk`) was intermittent
for hours. The `Auditoria de dependências` job failed on **four distinct PRs**
(#464, #466, #396, #468), always with the same signature:

```
[WARN] POST .../security/advisories/bulk error (23). Will retry in 10 seconds. 2 retries left.
[WARN] POST .../security/advisories/bulk error (503). Will retry in 1 minute. 1 retries left.
TimeoutError: The operation was aborted due to timeout
```

It was not the dependency tree, it was not the runner and it was none of the
PRs. It was **reproduced outside CI**, hitting the endpoint directly from
another machine: the same lack of response within 20s, while an ordinary `GET`
on the same registry answered in 130ms. `pnpm audit` already retries three times
internally (the two `retry` lines above); the service simply did not answer.

The cost was not only time. It was the behavior the situation teaches: each such
failure is resolved by re-running the job until it passes, and **whoever learns
to re-run until it passes also re-runs when the red is real**. A gate that
shouts without reason does not stay neutral — it erodes trust in the gates that
shout with reason.

## Decision

**Product owner's decision: three attempts without a registry response are an
ACCEPTED RISK.** The job stays green, with a loud warning in the summary.

What the decision does **not** loosen, and is what makes it defensible:

| situation | verdict | retry |
|---|---|---|
| `pnpm audit` exits 0 | passes | — |
| vulnerability report | **fails** | none — the answer already came, and it is no |
| request did not complete (timeout/5xx/DNS/socket) | infra | up to 3 |
| 3 infras in a row | passes, **declared** | — |
| unrecognized output | **fails** | none |

**Precedence is the heart of this.** `scripts/ci/auditoria-de-dependencias.ts`
classifies the output, and the FINDING markers are tested **before** the
network ones: a report that happens to mention `timeout` — a package with that
name, a timeout CVE — cannot be forgiven as unavailability. There is a test for
exactly that case.

**An unknown failure fails (fail closed).** If the output matches neither
signature, the verdict is `achado`. The only thing worse than a gate that fails
too much is one that approves what it did not understand.

**The warning says what the execution does NOT assert.** When the risk is
accepted, the job summary records that the tree *was not audited* — never that
it is clean. Green due to unavailability and green due to a clean audit are
different states, and the job does not confuse them in the text.

**The logic lives in a testable script**, not in `bash` inside the YAML: the
classification is a pure function with 11 cases, including the REAL outputs of
run 33838507158 (the one that motivated everything) instead of paraphrases.

## Consequences

**There is a real risk window, and it is declared.** During a long npm outage,
PRs get in without a dependency audit. This is recorded in
[cadeia-de-suprimentos-do-ci.md](../explanation/cadeia-de-suprimentos-do-ci.md),
in the section "What is still trusted on faith", next to the other assumed
trusts — not hidden in a workflow comment.

**The alternative was measured before being rejected.** Staying red due to a
third-party outage cost, on the day, four blocked PRs and several re-runs of
~5min each, without any of them discovering anything about the code. What this
rigidity buys is the appearance of rigor; what it costs is the habit of ignoring
red.

**Only the pnpm side changes.** `mix hex.audit` and `mix deps.audit` (Elixir)
remain as they were — the incident was the npm endpoint's, and widening the
exception to those who did not ask for it would turn a one-off decision into a
general policy.

**What remains unanswered:** there is no alert when the risk is accepted
frequently. Three timeouts in an isolated PR is third-party noise; three
timeouts in every PR for a week is the gate turned off in practice, and today
nothing distinguishes the two cases beyond someone noticing. It remains a
declared gap, not solved here.

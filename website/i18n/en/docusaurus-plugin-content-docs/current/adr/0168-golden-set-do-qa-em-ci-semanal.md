---
traducao_de: efa7cf0930491b8af046a8f8972a5856c69f5aca
---

# ADR 0168 — The QA golden-set now runs in CI, scheduled and weekly

## Status

**Accepted.** The cadence was decided by the maintainer on 2026-09-27 (AT-149):
**weekly**. It references [ADR 0123](0123-golden-set-regressao-qa-automacao.md)
(the golden-set of the QA's semantic judgment, born manual) and
[ADR 0138](0138-golden-set-do-rag-em-ci-agendado.md) (the RAG mold, which
declared the QA one "entirely manual"). It edits neither.

## Context

ADR 0123 left the QA golden-set as `TODO(humano)` for CI, saying that wiring it
required "an API LLM secret or new infra (GPU)". ADR 0138 repeated the sentence
when separating RAG (embedding, deterministic) from QA (chat, judgment). Two
measurements changed the picture, and both are in
[`docs/explanation/gates.md`](../explanation/gates.md):

- **AT-067 (2026-09-13):** on an `ubuntu-latest` without a GPU, with
  `qwen2.5-coder` pulled into the job's own Ollama, the clock fits (19–23 min of
  `mix golden_set.qa`). The "new infra" half fell. But the score was 0/6 by
  construction: since [RN-502](../business-rules.md#rn-502) the `npm test` of a
  `container` project without a `running` container is refused, and the seed
  never brought one up.
- **AT-076 (2026-09-27):** the seed started bringing up the container through
  the production path (`container_start` proposed and approved, broker, state
  machine), without touching RN-502. Two runs in CI: 3/6 and 3/6 against the
  floor of 1/6, 52 and 86 min of job.

With the instrument measuring, what was missing was the cadence.

This workflow's proof run (run 36327281774, a temporary `push` trigger, removed
before the PR) gave 3/6 again, through another set of cases, with zero RN-502
refusals, in 13 min 41 s of job — no case repeated a command up to the ceiling
this time. The time goes from 14 to 86 min between runs.

## Decision

**`.github/workflows/golden-set-qa.yml`, separate from `ci.yml` and from the
RAG one, weekly `schedule` + `workflow_dispatch`, never `pull_request`.** The
same argument as ADR 0138: `ci.yml` is `pull_request` only, and a golden-set that
judges with a chat model does not stay on the merge path. Saturday, 01:17 UTC:
outside the RAG's daily window (06:00), the Sunday of the property proofs
(04:00) and the Monday of the link check (06:00); Saturday so the red waits for
the week to start; minute 17 because Actions' `schedule` is delayed and can drop
triggers at the top of the hour.

**Weekly and not nightly.** The RAG one costs ~20 min and is deterministic: a
regression from yesterday is a regression. This one costs 52–86 min measured and
VARIES — the two AT-076 runs gave the same total with different cases. One run
per day would spend hours of runner per week to read the same trend signal with
more noise; one per week is what the floor (ratchet) needs to flag a drop, and
`workflow_dispatch` covers whoever touched the QA prompt and wants the answer
right away.

**`timeout-minutes: 150`.** The largest measured job took 86 min; the variance is
the model's (one case repeated `npm test` 30 times before ending
`blocked(modelo)`). 150 covers a run in which more than one case hits the
iterations ceiling without turning red by clock, which is not what the job
measures.

**The verdict is the test's.** The ExUnit fails when the hits fall below the
`passRate` of `floor.json` for the model, and when the api answers but the seed
fails. The workflow adds two instrument guards, none of judgment: the score line
must exist (the test SKIPS when the api does not answer, and skipping in a
scheduled run is a green that did not measure), and the event log cannot have an
RN-502 refusal (the known signature of AT-067). On failure, it does what the RAG
one does: it prints the logs. It does not open an issue.

**Api, engine and broker native on the runner, and the Docker socket only in the
broker.** It is the design measured in AT-076. The same managed folder on all
three sides, because api and engine run on the host (`PROJECT_WORKSPACES_ROOT` =
`PROJECT_WORKSPACES_HOST_ROOT`). The cases' image is pulled before the seed, and
the reference comes from the seed itself (`IMAGEM_DO_GOLDEN_SET_QA`, pinned by
the index digest), not from a second literal in the workflow: the broker's
`docker run` runs under the 30 s control ceiling of the Docker port
([RN-604](../business-rules.md#rn-604)), and a divergence between what the job
pulls and what the seed asks for would put the pull inside that ceiling.

## Consequences

**ADR 0123's `TODO(humano)` for CI closes.** What remains with a human owner is
what ADR 0123 itself already said: the floor (`floor.json`) is only written by a
human, after measuring. This ADR does not touch it, nor the model.

**No gate changes.** The QA golden-set has no gate of its own in the registry
(`docs/gates.yml`); it is a trend signal of the semantic step of
`qa-verificada`, and a scheduled job blocks no merge.

**The CI broker does not have the compose's five layers.** On an ephemeral
runner there is neither an `internal` network nor a closed port: what remains of
containment is what the broker ACCEPTS (five operations, a spec computed by the
api from the artifact). The runner is discarded at the end of the job and keeps
no secret of this workflow (`permissions: contents: read`, a literal CI service
token).

**Declared, not fixed here:** the engine's heartbeat closes the seed's sessions
(`heartbeat_timeout`) ~30 s after they are created, while the QA keeps proposing
commands in them (it runs in the `mix` process, outside a session), with no
visible effect on the AT-076 score. And a `pull_request` that touches this
workflow does not execute it — green on the PR is not proof; the proof is the
`workflow_dispatch` or the first Saturday.

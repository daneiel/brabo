---
id: medicao-do-jev
title: Measuring the Jev tool router
description: The replay that asks the Jev, for every agent step already recorded in the local event log, which tool it would have offered — and the agreement, confidence curve, latency and cost it produced on 2026-09-29, with the sample size and what the replay cannot see.
---

# Measuring the Jev tool router

> AT-237 (EP-029, HS-063). A **measurement outside the product**: nothing in
> `apps/` imports this code, nothing is written to the database, and no gain of
> product is claimed here — that belongs to AT-239, which compares turns with
> and without the router. The router being measured is the one AT-235
> specifies; the decisions it depends on are AT-236's.
>
> Measured on 2026-09-29 against the local dev instance (compose project
> `brabo-dev`), repository at `d48f99f8ec`.

## What exists

Everything lives in `scripts/jev/` and runs with the repository's Node (type
stripping, no build step, **no new dependency**).

| file | role |
|---|---|
| `catalogo.exs` | dumps, from the engine's own code, each agent's tool catalog (`spec/0` of every tool: name and description) and identity (`Engine.Harness.Agents.identity/1`) |
| `catalogo.json` | the dump, versioned — regenerate it when a catalog changes (command in the `.exs` header) |
| `passos.ts` | pure: event log → **steps**, and the `state` of each step |
| `jev.ts` | pure: the request to the Decisions API and the reading of its answer |
| `medicao.ts` | pure: agreement, Wilson intervals, the confidence curve, latency, cost, the Markdown report |
| `replay.ts` | the CLI: three `SELECT`s, one request per step, a JSONL outside the checkout |

### Step, not tool call

The router is consulted **once per call to the chat model**, before
`provider.chat` (AT-235). A step can carry several tool calls — ten
`emit_artifact` in one Criativo answer, `terminal` + `read_file` in one dev
answer — so asking the Jev once per `tool.call` would ask questions the product
never asks, with a `state` that already contains the sibling calls of the same
step.

The event log has no step marker (AT-235, gap 1), so the boundary comes from
`token_usage`: the api writes one row per LLM call **before** the engine writes
the `tool.call`s of that answer. Every `tool.call` of the same session and actor
between two consecutive rows is the same step. Three labels follow:

- a step with **one** tool (one or more calls of it): label = that tool;
- a **heterogeneous** step (two different tools): hit = the Jev's choice is one
  of them — but restricting the menu to one tool would cut the rest;
- a step with **no** `tool.call` after its row: the model answered in text (or
  failed). This is the only label `responder_sem_ferramenta` can get by this
  method — the brief expected none; the step boundary gives seven.

Timestamps are compared as fixed-width UTC **text** with microseconds: the usage
row and the first `tool.call` of a step sometimes fall in the same millisecond.

### The `state` sent

The AT-235 shape, cut from what existed **before** the step: `agente`;
`pedido` — for conversational agents the last `chat.message` written by the
**user**, for dev agents and task gates the title of the task from
`dev.working`; `contexto` — the agent's identity plus the project's
`agent_instructions` row, when there is one (two layers of the system prompt,
not the whole assembled prompt); `passos_recentes` — the last 6 calls of that
actor in that session, arguments and result cut to 500 characters. The
question is a `choice` whose `criteria` are the catalog's `{name: description}`
plus the reserved `responder_sem_ferramenta`.

The request goes to `POST https://openrouter.ai/api/alpha/decisions` with model
`typesafe/jev-1.13`. One correction to AT-235, measured: **`questions` is an
object keyed by question id**, not a list — the list form gets
`400 expected record, received array`. The answer is
`answers.<id>.{choice, probabilities, confidence}`, `usage.{input_tokens,
output_tokens, cost}`, an `id` (`gen-dec-…`) and a dated snapshot in `model`
(`typesafe/jev-1.13-20260917` on every answer of this run).

## The sample

| | |
|---|---|
| instance | local dev (`brabo-dev`), project `test`, 4 sessions with steps (a fifth session, `core-api`, has none) |
| period | 2026-09-29 06:19:11 → 07:57:22 UTC |
| read | 879 events (502 `tool.call`), 307 `token_usage` rows of agents |
| steps | 305 of agents in the catalog; **302 asked** (the Psicólogo's 3 have a one-tool catalog and would never be routed — AT-235, condition c) |
| labels | 295 steps with a tool (36 heterogeneous), 7 without |
| suspicious labels | 157 of the 295 steps have a call whose result shows failure (`ok: false`, text starting with `falhou`/`erro`, `exit` ≠ 0) or that never got a result — the called tool may have been the wrong one |

Two full runs were made (the second is the one reported; the database got one
Anamnese step between them). Between the runs, on the 301 steps common to
both, the Jev gave **the same choice on 283 (94%)**; mean |Δ confidence| 0.029,
largest 0.16. The sample is one small project, one day, one chat model
(`~deepseek/deepseek-flash-latest`); every rate below carries its 95% Wilson
interval, and most per-agent intervals are too wide to rank agents.

## Agreement by agent

"Agreement" = the Jev's choice is a tool the model called in that step.
"Repeat previous" is a free baseline: offer the last tool the same actor used in
its previous step.

| agent | options | steps with a tool | heterogeneous | agreement (95% CI) | without suspicion | when the Jev chose a tool | baseline "repeat previous" | steps without a tool |
|---|---|---|---|---|---|---|---|---|
| anamnese | 5 | 8 | 0 | 3/8 = 38% (14–69%) | 3/8 | 3/3 | 4/4 | — |
| appsec | 6 | 6 | 2 | 0/6 = 0% (0–39%) | 0/6 | 0/1 | 0/5 | — |
| arquiteto | 9 | 5 | 2 | 1/5 = 20% (4–62%) | 1/5 | 1/2 | 1/4 | 3/3 |
| criativo | 3 | 5 | 0 | 3/5 = 60% (23–88%) | 3/5 | 3/4 | 1/4 | 2/2 |
| dev-board-engine | 9 | 24 | 3 | 12/24 = 50% (31–69%) | 1/3 | 12/24 | 20/23 | — |
| dev-game-session | 9 | 38 | 2 | 20/38 = 53% (37–68%) | 5/14 | 20/38 | 25/37 | — |
| dev-input-keyboard | 9 | 25 | 3 | 12/25 = 48% (30–67%) | 5/10 | 12/25 | 18/24 | — |
| dev-lead | 4 | 1 | 1 | 0/1 | — | — | — | — |
| dev-persistence | 9 | 34 | 3 | 24/34 = 71% (54–83%) | 4/12 | 24/34 | 26/33 | — |
| dev-piece-catalog | 9 | 37 | 5 | 21/37 = 57% (41–71%) | 4/11 | 21/37 | 31/36 | — |
| dev-retro-renderer | 9 | 26 | 0 | 13/26 = 50% (32–68%) | 5/14 | 13/26 | 19/25 | — |
| dev-scoring | 9 | 38 | 1 | 19/38 = 50% (35–65%) | 4/15 | 19/38 | 29/37 | — |
| infra | 5 | 2 | 1 | 0/2 | 0/1 | — | 1/1 | 0/1 |
| infra-workflows | 3 | 2 | 0 | 0/2 | 0/2 | — | 0/1 | — |
| po | 10 | 8 | 2 | 6/8 = 75% (41–93%) | 6/8 | 6/6 | 0/7 | 1/1 |
| qa-automacao | 7 | 20 | 5 | 4/20 = 20% (8–42%) | 2/9 | 4/20 | 14/19 | — |
| qa-estrategia | 6 | 16 | 6 | 0/16 = 0% (0–19%) | 0/15 | — | 7/15 | — |
| **all** | | **295** | **36** | **138/295 = 47% (41–52%)** | 43/138 = 31% (24–39%) | 138/258 = 53% (47–59%) | **196/275 = 71% (66–76%)** | 6/7 = 86% (49–97%) |

## The confidence curve, under the decided rule

AT-236 decided (answers 7 and 12) that the router **only restricts** the menu,
and that `responder_sem_ferramenta` — at any confidence — sends the **whole**
catalog in v1. So a step is *restricted* only when the confidence is at or above
the threshold **and** the choice is a tool; everything else behaves as today.
The error that costs is the restriction to the **wrong** tool.

| threshold | menu restricted to 1 | fall to the whole catalog | right among the restricted (95% CI) | restricted to the wrong tool | heterogeneous steps cut |
|---|---|---|---|---|---|
| 0.00 | 258 | 37 | 138/258 = 53% (47–59%) | 120 | 18 |
| 0.30 | 191 | 104 | 110/191 = 58% (51–64%) | 81 | 13 |
| 0.40 | 126 | 169 | 76/126 = 60% (52–68%) | 50 | 10 |
| 0.50 | 73 | 222 | 50/73 = 68% (57–78%) | 23 | 5 |
| 0.60 | 43 | 252 | 29/43 = 67% (53–80%) | 14 | 4 |
| 0.70 | 17 | 278 | 14/17 = 82% (59–94%) | 3 | 2 |
| 0.80 | 7 | 288 | 7/7 = 100% (65–100%) | 0 | 0 |
| 0.90 | 2 | 293 | 2/2 = 100% (34–100%) | 0 | 0 |

The report prints the same curve per group (dev agents, conversational agents,
gates and the other `ToolLoop` agents). Dev agents follow the table above
(0.70: 11/14; 0.80: 6/6). Conversational agents, when the Jev chose a tool at
any confidence, were right on 10/12 steps; it chose `responder_sem_ferramenta`
on 9 of their 21 steps with a tool, which under answer 12 is harmless.

**Threshold.** No threshold in the grid has the lower bound of its interval at
or above 90%, overall or in any group. The only point without a wrong
restriction is **0.80**, and there the router acts on 7 of 295 steps (2%) — with
a lower bound of 65%. This sample does not support a threshold; if one is set
from it, 0.80 is the value it points to, with that coverage. AT-236 answer 4
asks for the cost of each kind of error, which this replay cannot price.

## Latency and cost

| | |
|---|---|
| latency (302 requests, sequential, from the maintainer's machine) | p50 306 ms, p95 410 ms, max 550 ms; **0 above 2 000 ms** (first run: 286 / 409 / 512) |
| input tokens per request | 538 to 3 220, median 1 710 |
| cost by `usage.cost` | US$ 0.021964 for 302 steps — **US$ 0.0000727 per step** |
| cost billed | `GET /api/v1/generation` for each of the 302 ids: `total_cost` sums to the same US$ 0.021964 (ratio 1.000) |

The delta of `GET /api/v1/key` around each run did **not** match: +US$ 0.0349
against 0.0219 declared in the first run, +0.0185 against 0.0220 in the second.
The key is shared and its counter lags: across the whole AT-237 session its
`usage` rose from US$ 1.830 to US$ 2.052 (+0.222) while the generations of this
replay were billed US$ 0.044, so other work was spending on the same key at the
same time. The delta is not a measure of one run; the per-generation record is. Total spent by AT-237, both runs and the
format probes: about US$ 0.044, against a ceiling of US$ 2.00.

## What the replay cannot see

- **The loop's first message.** A `ToolLoop` agent (dev agents, gates,
  Anamnese, Infra-Workflows) starts from a user message built in code — the
  task, the story, the module map — that never reaches the event log. The
  replay has only the task title for dev agents and task gates, and nothing
  for `qa-estrategia`, `appsec`, `anamnese` and `infra-workflows`. The product's
  `state` would carry that message. `qa-estrategia`'s 0/16 (the Jev answered
  `responder_sem_ferramenta` every time) measures the replay's blindness as
  much as the Jev; those rows are a lower bound and should not decide anything.
- **The rest of the system prompt.** `contexto` is the identity and the
  project instruction row, not the assembled prompt (business rules, task
  state, files).
- **Whether the label is right.** The model that chose the tool is not ground
  truth; 157 steps are marked suspicious and reported apart ("without
  suspicion"). Agreement is lower on the clean steps (31%) than overall
  (47%): the suspicious steps are mostly failing `terminal` calls of dev
  agents, which the Jev tends to pick too — so mislabelled steps do not explain
  the disagreement.
- **The effect.** A restricted menu changes what the model does next; the
  replay only compares a choice with a recorded one. Whether turns get shorter,
  faster or cheaper is AT-239.

## Two findings outside the numbers

- **Heterogeneous steps are common:** 36 of 295 (12%). Restricting the menu to
  one tool turns each of them into at least two steps — the gap 1 of AT-235,
  now counted.
- **The catalog sync risk of AT-235 (gap 3) is real, with another name:**
  `GET /api/v1/models` does not list `typesafe/jev-1.13`, but lists
  `typesafe/jev-router` — a chat router, priced `-1`. The model sync would
  import it as an (inactive) chat model. Recorded here, not changed.

## Reproducing

```bash
# the catalog, when a tool or an identity changed (inside the dev engine container)
docker cp scripts/jev/catalogo.exs brabo-dev-engine-1:/tmp/catalogo.exs
docker exec brabo-dev-engine-1 mix run --no-start --no-compile --no-deps-check /tmp/catalogo.exs \
  > scripts/jev/catalogo.json

# count the steps and estimate the cost, without calling the network
pnpm --filter @brabo/scripts jev:replay -- --container brabo-dev-postgres-1 --estimar

# the run (resumes: a step already answered in the output is not asked again)
pnpm --filter @brabo/scripts jev:replay -- --container brabo-dev-postgres-1 \
  --arquivo-de-chave ~/.config/brabo/openrouter-test.env --teto-usd 2

# the report again, and the billed cost per generation
pnpm --filter @brabo/scripts jev:replay -- --so-relatorio
pnpm --filter @brabo/scripts jev:replay -- --conferir-custo --arquivo-de-chave ~/.config/brabo/openrouter-test.env
```

The output (`$XDG_CACHE_HOME/brabo/replay-jev/respostas.jsonl`, else
`~/.cache/…`, mode 600) carries session ids and stays out of the checkout — the
script refuses a destination inside it. The printed report has only counts and
agent ids. The key is read from the environment (`OPENROUTER_TEST_KEY`) or from
the file given, and is never printed or written.

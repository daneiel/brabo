---
id: medicao-do-jev
title: Measuring the Jev tool router
description: The replay that asks the Jev, for every agent step already recorded in the local event log, which tool it would have offered — the agreement, confidence curve, latency and cost it produced on 2026-09-29, and a second round that separates the ruler, the input and the agent's own rhythm in the gap to 90%, with sample sizes and what the replay cannot see; and the live with-and-without comparison of AT-239 — instrument, protocol, decision rule and cost estimate written before any run, the run itself blocked on 2026-10-01.
---

# Measuring the Jev tool router

> AT-237 (EP-029, HS-063). A **measurement outside the product**: nothing in
> `apps/` imports this code, nothing is written to the database, and no gain of
> product is claimed here — that belongs to AT-239, which compares turns with
> and without the router. The router being measured is the one AT-235
> specifies; the decisions it depends on are AT-236's.
>
> Measured on 2026-09-29 against the local dev instance (compose project
> `brabo-dev`), repository at `d48f99f8ec`. The **second round** — variants of
> the `state`, equivalence classes, a tuning/validation split, top-2 and the gap
> by cause — is [further down](#second-round-2026-09-29-where-the-gap-is).

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
| `replay.ts` | the CLI of the first round: three `SELECT`s, one request per step, a JSONL outside the checkout |
| `dados.ts` | second round: the raw data (events, usage rows, tasks, stories, module maps, action outcomes) and the snapshot cache |
| `equivalencia.ts` | second round: the equivalence classes E1–E3, fixed before running, and the classifier of terminal commands |
| `kickoff.ts` | second round: the loop's first message of dev agents and gates, ported from the engine's Elixir (a spec checks the fixed text against the `.ex` files) |
| `variantes.ts` | second round: the `state` variants and the run boundary; each field names its source in the engine |
| `divisao.ts` | second round: the tuning/validation split, by run |
| `cliente.ts`, `medicao2.ts`, `analise.ts` | second round: the call (keeps the probabilities), the top-k / cascade / per-cause tables, and the CLI `jev:analise` |

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

## Second round (2026-09-29): where the gap is

> Asked by the owner after the first round: repeat the measurement, try to reach
> **at least 90%**, and say exactly where the gap is. **Not reached.** On
> validation steps the Jev's top-1 is **73% by equivalence (95% CI 66–79%,
> n = 160) and 66% strict (58–73%)**; its top-2 reaches 90% (84–94%). The rest
> of this section is the protocol, the numbers, and a hand-read of the 43 top-1
> errors that are left. Same instance, same caveat as the first round: one small
> project, one day, one chat model; no gain of product is claimed (that is
> AT-239). Repository at `bc7f4c0738`, branch `test/replay-do-jev-v2`.

### Protocol (written before any run)

- **Only what the product can produce at runtime, before the step.** Nothing
  of the target step enters the `state`: not the tool it called, its arguments,
  its result, nor the text the model wrote in that very step (`Passo.texto` is
  read only from *earlier* steps; `variantes.spec.ts` asserts, for every
  variant, that the target step's call, argument, result and text are absent).
  Each new field has its source in the engine, quoted in the header of
  `scripts/jev/variantes.ts`.
- **Equivalence classes fixed in `scripts/jev/equivalencia.ts` before running**,
  from the semantics of the tools, and reported next to the strict rule (the
  one of the first round, so the 47% stays comparable). Three cumulative layers:
  **E1** `terminal` whose command only reads/lists/searches (`ls`, `find`,
  `cat`, `pwd`, `grep`, `head`, `git status/log/diff`… — a compound command
  counts by its strongest segment, execution > writing > reading) ≡
  `read_file`/`search_workspace`; **E2** `read_file` ≡ `search_workspace`;
  **E3** `terminal` that writes a file (redirect, heredoc, `tee`, `sed -i`,
  `cp`, `mv`, `touch`) ≡ `write_file`. Deliberately asymmetric: the Jev choosing
  `terminal` only serves a `terminal` call, and a command that *executes*
  (`npm`, `node`, `rm`, `mkdir`, `git commit`…) is equivalent to nothing but
  `terminal`. **The headline is the full rule (E1+E2+E3), with the strict rule
  beside it.** Nothing was reclassified after seeing a result; the 3 errors the
  classes still get wrong are counted as such below.
- **Tuning × validation by execution, not by step.** A group is one `ToolLoop`
  run (a dev agent's task, one gate round) or, for conversational agents, the
  agent's whole session. Groups are ordered by a hash of their name and each
  goes to the half that has fewer steps so far — deterministic and blind to any
  result. 328 eligible steps: **167 tuning, 161 validation** (n below counts
  steps with a tool: 161 and 160). Variants were iterated on tuning only;
  validation was asked afterwards, once per variant. **One incident, declared:**
  after the first tuning runs I found that the Anamnese's `skip_proficiency` /
  `emit_proficiency` also end the loop, and added them to the list of run
  boundaries used to *build the state*. Using the corrected list for the split
  too would have moved 154 of the 167 tuning steps to validation, so the split
  keeps the list it had before the first request (`FERRAMENTAS_DE_FIM_DA_DIVISAO`)
  and only the state uses the corrected one. The four state variants that depend
  on the boundary were asked again on tuning (US$ 0.075, kept as `.descartado`
  in the spend ledger).
- **Frozen snapshot.** The dev database kept receiving steps from other work
  during the session (335 usage rows at the end against 333 at the start); the
  analysis runs on the snapshot of 333 rows and the events up to the same
  sequence numbers (`--dados-cache`). The 26 steps new since the first round
  (302 answered → 328 eligible) are all **Anamnese** steps of the tuning half.
- **Spend ceiling** US$ 1.00 on the sum of `usage.cost`, checked before every
  request against the accumulated total of the output directory (`.jsonl` and
  `.descartado`). Spent: **US$ 0.414** in 4 604 requests (see "Latency and cost").

### The sample

| | tuning | validation |
|---|---|---|
| steps (with a tool / without) | 167 (161 / 6) | 161 (160 / 1) |
| dev agents (`ToolLoop`) | `dev-piece-catalog` 37, `dev-retro-renderer` 26, `dev-input-keyboard` 25 | `dev-game-session` 38, `dev-scoring` 38, `dev-persistence` 34, `dev-board-engine` 24 |
| gates and other `ToolLoop` | `anamnese` 32, `qa-automacao` 20, `appsec` 3 | `qa-estrategia` 16, `appsec` 3, `infra-workflows` 2, `anamnese` 2 |
| conversational | `po` 8, `criativo` 5, `arquiteto` 5 | `infra` 2, `dev-lead` 1 |

Validation is dominated by dev agents (134 of 160 steps with a tool) and by one
gate (`qa-estrategia`, 16). The tuning half carries 32 Anamnese steps, which the
Jev answers with `responder_sem_ferramenta` when the agent used
`skip_proficiency` (30 of 32): without them tuning is 94/129 = 73% by
equivalence, the same as validation.

### Variants tried (all of them)

`tokens` is the median input size; latency in ms (p50 / max), sequential
requests from the maintainer's machine. Steps with a tool only.

| variant | what it adds to the previous one | tuning strict → equivalence (top-2) | validation strict → equivalence (top-2) | tokens | latency |
|---|---|---|---|---|---|
| `original` | nothing — the first round's `state` | 39% → 48% (83%) | 49% → 58% (82%) | 1 687 | 322 / 780 |
| `kickoff` | `pedido` = the loop's first message, rebuilt from the engine's code | 55% → 58% (89%) | 65% → 73% (91%) | 1 867 | 318 / 612 |
| **`escopo`** | recent steps only from the current run (`ctx.messages` restarts at each `ToolLoop.run`) | **57% → 59% (89%)** | **66% → 73% (90%)** | 1 867 | 312 / 814 |
| `resultados` | results/arguments up to 2 000 characters | 53% → 55% (91%) | 62% → 69% (88%) | 2 011 | 314 / 699 |
| `texto` | the model's text from earlier steps | 53% → 55% (91%) | 64% → 73% (93%) | 2 090 | 315 / 685 |
| `progresso` | derived counts (steps so far, calls per tool, last tool, tests run…) | 55% → 57% (91%) | 65% → 70% (93%) | 2 224 | 309 / 817 |
| `trilha` | `escopo` + the run's whole tool sequence (names only) | 53% → 57% (91%) | 64% → 71% (89%) | 1 936 | 310 / 614 |
| `fluxo` | `trilha` + a question that says agents work in bursts | 49% → 55% (92%) | 64% → 75% (93%) | 2 014 | 309 / 586 |
| `enxuto` | `trilha` with only the last 2 calls | 50% → 54% (89%) | 63% → 74% (91%) | 1 429 | 307 / 920 |
| `so_trilha` | `trilha` with no recent calls at all | 39% → 44% (80%) | 33% → 56% (83%) | 1 168 | 307 / 480 |
| `acoes` | `escopo` + the result of commands that waited for approval (rebuilt from the action's outcome) | 50% → 53% (91%) | 53% → 61% (89%) | 2 333 | 348 / 1 352 |
| `acoes_completo` | `acoes` + 2 000 characters + text + progress | 47% → 51% (92%) | 51% → 58% (92%) | 3 360 | 326 / 845 |

The six rows from `original` to `progresso` (the cascade below) were written
before the first request. The other six were written afterwards, in response to
what tuning showed, and are an ordinary search on the tuning half: `trilha`,
`fluxo`, `enxuto` and `so_trilha` try to give the Jev the pattern of the run in a
form easier to read; `acoes` and `acoes_completo` came from seeing that many
recent steps read `(sem resultado gravado)` (commands that waited for approval).

The **winner is `escopo`**, chosen on tuning (best top-1, strict and by
equivalence); validation was not used to choose. Two things to
read in the table: the differences among `kickoff` … `progresso` are inside the
confidence intervals (±7 points), so "more input" is not shown to hurt or help
beyond the first step; and `fluxo` has the best validation number (75%) but sits
below the winner on tuning (55% against 59%), which is why it was not the winner
— picking it now would be picking on validation.

Where each new field comes from in the engine (`apps/engine/lib/engine/…`):

| field | source |
|---|---|
| `pedido` (dev) | `initial_message/2`, `dev/dev_agent_server.ex:484`; task and story titles from `tasks`/`stories` |
| `pedido` (`qa-automacao`) | `initial_message/2`, `gates/qa_automacao_agent.ex:108`; task from the last `dev.awaiting_gate`, requirements from the story |
| `pedido` (`qa-estrategia`, `appsec`) | `gates/qa_estrategia_agent.ex:93`, `gates/appsec_agent.ex:79`; **the story is not recoverable from the log**, so the message says so and carries the module map |
| recent steps by run | `ToolLoop.Default.init/1` and `loop/1` (`harness/tool_loop.ex`): `messages` is built per `run` |
| complete results, `texto` | the `tool` and `assistant` messages `loop/1` appends (`concluir_despacho/5`, `append(ctx, message)`); the log cuts results at 2 000 |
| approved-command results (`acoes`) | `texto_do_desfecho/1`, `dev/dev_agent_server.ex:460`; the log has no `tool.result` for them, only `proposed_actions.execution_result` |
| `progresso`, `trilha` | counts over the run's earlier calls in the same `messages` |

Not ported, and said so in `kickoff.ts`: the Anamnese (its message is built
from a log window and the member list, which the log does not keep),
`infra-workflows` (context map), and the conversational agents (their `pedido` is
still the last user message).

### The cascade (validation, steps with a tool)

Each row is the previous one plus one piece, on the same 160 steps.

| step | n | top-1 (95% CI) | top-2 (95% CI) |
|---|---|---|---|
| input of the first round, strict rule | 160 | 78/160 = 49% (41–56%) | 118/160 = 74% (66–80%) |
| + E1 terminal-read ≡ read | 160 | 92/160 = 57% (50–65%) | 125/160 = 78% (71–84%) |
| + E2 `read_file` ≡ `search_workspace` | 160 | 93/160 = 58% (50–65%) | 131/160 = 82% (75–87%) |
| + E3 writing terminal ≡ `write_file` | 160 | 93/160 = 58% (50–65%) | 131/160 = 82% (75–87%) |
| + `pedido` = the loop's first message | 160 | 116/160 = 73% (65–79%) | 145/160 = 91% (85–94%) |
| + recent steps of the current run only | 160 | 117/160 = 73% (66–79%) | 144/160 = 90% (84–94%) |
| + results up to 2 000 characters | 160 | 110/160 = 69% (61–75%) | 141/160 = 88% (82–92%) |
| + the model's text from earlier steps | 160 | 116/160 = 73% (65–79%) | 149/160 = 93% (88–96%) |
| + derived counts | 160 | 112/160 = 70% (62–77%) | 148/160 = 93% (87–96%) |

Two rows carry all the movement: the equivalences (+9 points) and the loop's
first message (+15). After `escopo` nothing moves top-1 outside the interval,
and the results rebuilt for approved commands (`acoes`) lower it. The 47% of the
first round, on the same input, is 58% under the declared equivalences.

### The headline

Variant `escopo`, validation, 160 steps with a tool (plus 1 without, which the
Jev got wrong):

| | |
|---|---|
| **top-1, equivalence rule** | **117/160 = 73% (66–79%)** |
| top-1, strict rule (comparable to the 47%) | 105/160 = 66% (58–73%) |
| top-2 (menu restricted to 2), equivalence / strict | 144/160 = 90% (84–94%) / 134/160 = 84% (77–89%) |
| top-3, equivalence | 148/160 = 93% (87–96%) |
| baseline "repeat the previous tool" (free), equivalence / strict | 122/149 = 82% (75–87%) / 108/149 = 72% (65–79%) |
| menu of 2 with no second call, {Jev's pick, previous tool}, equivalence / strict | 140/160 = 88% (81–92%) / 125/160 = 78% (71–84%) |
| without the Anamnese (kickoff not rebuilt; paused in the product) | 115/158 = 73% (65–79%) |

**The Jev does not beat the free baseline.** On the same validation steps
"repeat the previous tool" gets 82% (72% strict), above the Jev's 73% (66%). Its
one advantage shows in the union: offering the Jev's pick *and* the previous tool
reaches 88% (78% strict), 15 points over the Jev alone, at no extra call. No
configuration reaches 90% at top-1, and none has a lower bound at 90%.

By agent (validation, equivalence): `dev-board-engine` 23/24 = 96% (80–99%),
`dev-persistence` 28/34 = 82% (66–92%), `dev-scoring` 31/38 = 82% (67–91%),
`dev-game-session` 28/38 = 74% (58–85%), **`qa-estrategia` 4/16 = 25% (10–49%)**,
`appsec` 1/3, `infra` 0/2, `infra-workflows` 0/2, `dev-lead` 0/1 (`qa-estrategia`
and `appsec` have their first message rebuilt but without the story; the other
three do not have it rebuilt at all).

The confidence still does not separate right from wrong:

| threshold | menu restricted to 1 | right among the restricted (95% CI) |
|---|---|---|
| 0.00 | 155/160 | 117/155 = 75% (68–82%) |
| 0.40 | 123/160 | 95/123 = 77% (69–84%) |
| 0.60 | 55/160 | 44/55 = 80% (68–88%) |
| 0.70 | 32/160 | 23/32 = 72% (55–84%) |
| 0.80 | 16/160 | 8/16 = 50% (28–72%) |
| 0.90 | 10/160 | 4/10 = 40% (17–69%) |

Above 0.7 the accuracy *falls*: the confident errors are the ones described below
(the Jev is sure that after writing the tests comes running them).

### The gap, by cause

The 82 validation errors of the first round's rule, and what each piece of the
cascade did with them (steps with a tool, n = 160):

| cause | steps | points | share of the gap |
|---|---|---|---|
| **ruler** — the Jev's choice was equivalent (E1–E3, declared in advance) | 15 | 9.4 | |
| **ruler** — left over: the classes still miss a case (3 steps, below) | 3 | 1.9 | 22% (18 steps) |
| **input** — the loop's first message (`kickoff`) | 23 | 14.4 | |
| **input** — `escopo` | 1 | 0.6 | |
| **input** — left over: first messages not rebuilt, or a result not in the log (7) | 7 | 4.4 | 38% (31 steps) |
| **the agent's rhythm**, not a field of the state (below) | 29 | 18.1 | |
| **the Jev diverges without the state justifying it** (4) | 4 | 2.5 | 40% (33 steps) |
| total | 82 | 51.3 | |

The 43 errors left after the last recovered piece were read one by one (not a
sample): the state sent, the tools called, the model's own text of that step
(which the Jev never sees) and the Jev's choice and confidence. Result:

- **Ruler, 3.** `dev-board-engine` `terminal`→`search_workspace`: the agent's
  command was a `find … | sort; ls; for f in docs/*; do …cat` — read-only, but
  a `for` loop is not in the read-only list, so it is scored as execution. Two
  more `read_file`→`terminal` where the agent had been reading through
  `terminal` all along: equivalent under any reading, but the classes are
  asymmetric on purpose and this was not re-scored.
- **Input, 7.** Every error of `infra` (2 steps), `infra-workflows` (2) and
  `dev-lead` (1) — five steps whose first message the port does not rebuild —
  plus the two `report_done`→`terminal` where the last command's result
  ("exit 0, the suite passed") is not in the log. The `acoes` variant rebuilds
  those results and, overall, made the Jev *worse* (61%): shown a failing
  sandbox, it says `report_blocked` where the agent kept trying.
- **The agent's rhythm, 29.** The Jev names the *next stage* of the flow and the
  agent stays one more step in the current one:
  14 × `write_file`→`terminal` (the Jev: "the tests are written, run them", 8 of
  them at confidence ≥ 0.6, up to 0.98; the agent wrote two or three more files
  first), 12 × `qa-estrategia` `read/search`→`emit_plano_de_teste` (the Jev
  jumps to the final tool of the kickoff at confidence 0.25–0.56; the agent
  explored ~15 steps before emitting), 2 × `appsec` the same, 1 ×
  `terminal`→`report_blocked` after a denied action. In every one of these the
  Jev's choice is what a reader of the log would call the natural next step.
  What decides "how many more files, how many more reads" is the model's plan,
  which is in no field the product could hand the router — it exists, once, in
  the very text of the step being predicted.
- **The Jev diverges, 4.** `write_file`→`search_workspace` twice at confidence
  0.25–0.26, `rag_search`→`terminal` twice (0.24, 0.59). These are the only steps
  where the state does not explain the choice: 2.5% of the steps.

So: of a 51-point distance from the first round's 49% to 100%, about **a fifth
was the ruler, about two fifths was input the replay lacked** (and the
recoverable part of it is recovered), **and two fifths is the agent's rhythm**,
with **5% of the steps a plain Jev mistake**. What remains of the input is at
most 4 points, and it is not what stands between 73% and 90%.

### What would be needed for 90%, and what each piece is worth

Steps of validation, 43 errors; 90% is 144/160, that is 27 more right answers.

| piece | steps at most | note |
|---|---|---|
| finish the input port (Anamnese, `infra-workflows`, conversational first messages; the `qa-estrategia` story) | up to +7 → 79% | an upper bound: with the complete input the Jev has not been better here, and rebuilding results made it worse |
| tighten the classes (`for` loops, terminal-as-read the other way) | +3 → 75% | it is ruler, not accuracy; deciding it after seeing the errors is what the protocol forbids, so it is not in the headline |
| the agent's rhythm | up to +29 | not a state field; the only ways in are a **menu of 2 that includes the previous tool** (measured: 88%, 81–92%) or top-2 (90%, 84–94%) |

Reading it as a product decision, which is AT-239's: a router that must *pick
one* tool sits at about three quarters and below the free baseline; a router
that *restricts the menu to two* reaches nine in ten, and the previous tool is as
good a second name as the Jev's own second. This section does not claim either
gain.

### Latency and cost (variant `escopo`)

| | |
|---|---|
| input tokens per request | p50 1 866, p95 2 557, max 3 220 (the first round: median 1 710, max 3 220) |
| latency (328 requests, sequential) | p50 317 ms, p95 449 ms, max 814 ms; **0 above 2 000 ms** |
| cost | US$ 0.0000769 per step (US$ 0.025233 for 328), and `GET /api/v1/generation` for each of the 328 ids sums to the same US$ 0.025233 (ratio 1.000) |
| this whole round | US$ 0.414 by `usage.cost` — 12 variants, 3 of them twice on part of the tuning half — against a ceiling of US$ 1.00 |

The richest variants cost more input (`acoes_completo`: median 3 360 tokens, about
US$ 0.00014 per step against 0.00008) and buy nothing; the state that wins is also the
cheap one. The 2 000 ms ceiling of AT-236 has room by a factor of two.

### What this round still cannot see

- The **story** of the two gates that run before any code (`qa-estrategia`,
  `appsec`): the request that starts them is internal and not logged.
- The first message of the **Anamnese**, `infra-workflows`, and the
  conversational agents; and the system prompt behind `contexto`.
- **Ground truth.** The label is still the tool the chat model called, and most
  of the 29 rhythm errors are choices a human reader would call reasonable, which
  is why top-2 and the union say more than top-1.
- **Effect.** A restricted menu changes what the model does next; AT-239.

## Menu of 2 options (2026-09-29): restrict instead of pick

> Asked by the owner after the second round, where the Jev's top-1 (73%) missed
> 90% but a menu of two ({the Jev's pick, the previous tool}) and the Jev's top-2
> looked good: **test the menu of 2 options**. Only a result whose **lower bound
> of the 95% interval is at least 90%** is a clear "yes". **It is not: no policy
> reaches it.** The best 2-option policy, P3, covers **91% (85–94%)** of the
> validation steps, that is, the right tool is inside the menu; the lower bound
> is 85%, five points under the line. And this is *coverage*, a ceiling on the
> end-to-end accuracy (see "The ceiling"), not the accuracy itself. Same
> instance, same caveats as the earlier rounds; nothing here changes the product
> (that is AT-239). Reproduce with `pnpm --filter @brabo/scripts jev:menu`.

### Policies (written before running, in `scripts/jev/menu.ts`)

A policy turns the Jev's answer into a restricted menu. The owner's decisions
hold everywhere: the Jev only **restricts** the menu, and when it answers
`responder_sem_ferramenta` the **whole** catalog stays (AT-236); ceiling of
2 000 ms (0 of 328 requests went over it in the second round). Nothing was
reclassified after seeing a result; `menu.spec.ts` fixes what each policy returns.

| policy | menu |
|---|---|
| P0 | the whole catalog (anchor: 100% coverage, restricts nothing) |
| P1 | the Jev's two most probable tools |
| P2 | {the Jev's pick, the previous tool of the same run} |
| P3 | P2, but if the Jev says `responder_sem_ferramenta` (or there is no previous tool) the menu is the whole catalog |
| P4 | {the pick, the previous tool, the Jev's second} (up to 3; reference only) |

Rules shared by all: an answer that failed (timeout, error, pick outside the
options) leaves the whole catalog; a previous tool that is not in the agent's
catalog is ignored; a menu that would come out empty is the whole catalog.

**Coverage** = the fraction of steps with a tool in which the tool the agent
really called is *inside* the menu — strict (same name) and by equivalence (the
E1–E3 classes of the second round, so a menu with `read_file` covers a `terminal`
that only reads). **Restriction rate** = the fraction of steps in which the menu
is smaller than the agent's catalog: a policy that almost never restricts is
trivially "100%" and useless, so coverage is also given *among the restricted
steps*. Variant `escopo` (the winner of round two), validation half, 160 steps
with a tool (1 more without).

### The numbers (validation)

| policy | coverage, equivalence (95% CI) | strict | restricts | coverage among the restricted | tools exposed, before → after | definition tokens per call, before → after |
|---|---|---|---|---|---|---|
| P0 | 160/160 = 100% (98–100%) | 100% | 0/160 = 0% | — | 7.4 → 7.4 | 746 → 746 |
| P1 | 144/160 = 90% (84–94%) | 134/160 = 84% (77–89%) | 158/160 = 99% | 142/158 = 90% (84–94%) | 7.4 → 2.0 | 746 → 150 |
| P2 | 143/160 = 89% (84–93%) | 128/160 = 80% (73–85%) | 157/160 = 98% | 140/157 = 89% (83–93%) | 7.4 → 1.3 | 746 → 102 |
| **P3** | **145/160 = 91% (85–94%)** | 132/160 = 83% (76–88%) | 147/160 = 92% (87–95%) | 132/147 = 90% (84–94%) | 7.4 → 1.6 | 746 → 138 |
| P4 | 149/160 = 93% (88–96%) | 142/160 = 89% (83–93%) | 158/160 = 99% | 147/158 = 93% (88–96%) | 7.4 → 2.2 | 746 → 166 |

**Which is best.** P3 is the one to look at: the highest coverage of the
2-option policies, it honours the owner's rule, and it restricts 92% of the
steps. **Its lower bound is 85.1%; P1's is 84.4%, P2's 83.6%, P4's 88.1%.**
P4 is closest to the line, but a menu of up to 3 is not the question that was
asked. Every policy misses the "clear yes"; P1 and P3 land *on* 90% at the
point estimate, the same "90% (84–94%)" the second round already had for top-2 —
the previous tool adds nothing to coverage over the Jev's own second guess, it
only makes the menu smaller (1.6 tools against 2.0).

**Two things the table hides.**

- **P3 offers a single tool in 98 of the 160 steps.** When the Jev's pick *is*
  the previous tool, the menu has one name (P2: 108 of 160). Those menus cover
  89 of 98 (91%). The other 49 restricted steps have a menu of two and cover 43
  (88%). A "menu of 2" is, most of the time, a menu of 1 with no choice left to
  the agent: it is forced.
- **The interval is optimistic.** Wilson treats the 160 steps as independent,
  and they are not: validation is **10 executions** (four dev agents' tasks, the
  gates `qa-estrategia`, `appsec` and `infra-workflows`, and the Anamnese, Infra
  and Dev Lead), and consecutive steps of a run share request, files and results.
  With so few clusters the honest interval is wider than the ones printed. It does
  not change the answer (a "no" gets no better), but a "yes" would not have been
  earned by 160 steps either.

### Tuning and the new steps

| policy | tuning (161 steps) coverage, equivalence | restricts | new steps (36) coverage |
|---|---|---|---|
| P1 | 144/161 = 89% (84–93%) | 156/161 = 97% | 36/36 |
| P2 | 143/161 = 89% (83–93%) | 127/161 = 79% | 36/36 (restricts 0) |
| P3 | 147/161 = 91% (86–95%) | 115/161 = 71% | 36/36 (restricts 0) |
| P4 | 148/161 = 92% (87–95%) | 156/161 = 97% | 36/36 |

Tuning says the same as validation (P3 91%, lower bound 86%), as expected since
none of the policies was tuned. It carries the 32 Anamnese steps, for which the
Jev says `responder_sem_ferramenta` and P3 therefore leaves the whole catalog:
71% restriction instead of 92%. **The 36 new steps** (the dev database went from
333 to 369 usage rows after the snapshot) are **all Anamnese**, an agent that is
paused in the product: the Jev answers "no tool" and P2/P3 open the whole
catalog, so "36/36" is trivially true and says nothing about the menu. All steps
together and without the Anamnese (287 with a tool; the tuning half already chose
the variant, so this is *not* a clean validation): P1 89% (84–92%), P2 88%
(84–91%), **P3 90% (86–93%)**, P4 92% (88–94%). More steps narrow the interval but
the lower bound stays at 86%; with a true coverage near 91% it takes about three
thousand steps for the lower bound to pass 90%, and what would help is a better
router, not a larger sample.

Sensitivity, not a choice: with any of the twelve `state` variants P2 covers
88–91% and P3 89–92% of the validation steps, so the result does not hinge on
`escopo` (P1 does: 82% with the original input, 93% with `texto` or `fluxo`).
No variant has a lower bound at 90% either — the highest are P1 with `texto`
(88%) and P3 with `enxuto` (87%) — and picking one after seeing this is exactly
what the protocol forbids.

### Where coverage fails

P3, validation, the 15 steps outside the menu: `write_file` used while the menu
was `terminal` (4), `read_file` while `terminal` (2), `report_done` while
`terminal` (2), `write_file` while {`search_workspace`, `terminal`} (2), and five
singles among the gates and the conversational agents (`emit_plano_de_teste`
offered instead of `rag_search` or `search_workspace`, and the reverse). It is the
rhythm gap of round two seen from the other side: the Jev names the next stage,
the agent takes one more step in the current one — and an agent whose menu is
`terminal` cannot write the file with the tool made for it. By agent (P3,
equivalence): `dev-board-engine` 23/24 = 96% (80–99%), `dev-scoring` 35/38 = 92%
(79–97%), `dev-persistence` 31/34 = 91% (77–97%), `qa-estrategia` 14/16 = 88%
(64–97%), `dev-game-session` 32/38 = 84% (70–93%); the rest have fewer than four
steps.

### The ceiling: what coverage does not say

**Coverage is a ceiling on the end-to-end accuracy, not the accuracy.** The menu
contains the right tool; the agent's model still has to pick it among the
options. The label ("the tool the chat model called") is the choice the agent
made *from the whole catalog*, so a full menu is 100% by construction and a
restricted one can only lose. What can be said without the product, for P3 on
validation, splitting the 160 steps:

- **99 (62%, 54–69%)**: every tool in the menu is right, so any pick of the agent
  is right — the floor.
- **46 are "disputed"**: exactly one of the options is right and the agent decides
  alone — 28 only the previous tool, 18 only the Jev's pick. An agent that always
  takes the previous tool ends at 127/160 = 79%; one that always takes the Jev's
  pick, 117/160 = 73% (the round-two baselines again); one that flips a coin, 76%.
  An agent that picks better than both, which is the whole bet, lands between 79%
  and the 91% ceiling.
- The other 15 are outside the menu: lost whatever the agent does.

So the end-to-end range is 62% to 91%, and where it falls depends on how well the
agent's model reads the *situation*, which the replay cannot see. **Only the live
test (AT-239) answers it.**

### Savings in tool definitions

The catalog had the *description* of each tool (`catalogo.json`) and now also
`definicoes`: the size in bytes of each tool's complete `spec/0` (name,
description and parameter schema), serialized by the engine (`catalogo.exs`,
rerun; the rest of the file did not change). Tokens are bytes divided by 4, the
approximation the whole replay uses. On validation P3 goes from **746 to 138
definition tokens per call — 608 tokens, 81% less**: a dev agent's eight tools
weigh 3 068 bytes and a menu of two weighs about 500. P1 saves 596, P2 644
(averages over the steps of the half; the tuning half saves less because the
Anamnese keeps its whole catalog).

What that is worth is another question. The Jev call itself reads ~1 870 tokens
(US$ 0.0000769) on a much cheaper model than the agent's; the definition saving
is 608 tokens of the agent's model per call. The break-even is an input price of
US$ 0.126 per million tokens (0.0000769 / 608): above it the saving pays for the
Jev call, ignoring cache. **The cache is the catch**: providers cache the request
prefix, tool definitions come first, and a menu that changes from step to step
changes the prefix — the saving may be paid back in cache misses. That is a live
measurement, and the reason the test below records the cached-token ratio.

### The live test (not run): design

- **Question.** With P3 in front of the agent, does the agent's work get worse,
  and by how much does it get cheaper? Not "is the tool in the menu" (that is this
  section).
- **Stage 1, shadow (cheap, before any user sees a menu).** For each step of a
  held-out sample, ask the *agent's own model* twice on the same state, with the
  whole catalog and with the P3 menu, and compare the tool it picks by the
  equivalence rule. Metric: agreement between the two, with the lower bound of the
  95% interval. To show a true agreement of 94% with the lower bound at 90% (80%
  power): about **390 steps**, drawn from **at least 40 different executions** and
  **more than one project** (this sample has 21 executions in one project),
  interval by cluster (execution), not by step.
- **Stage 2, live A/B, only if stage 1 passes.** Arms: control (whole catalog) and
  P3, randomized **by execution**, never by step (a step's menu shapes the next
  one). Primary metric: the execution reaches its gate without rework,
  non-inferiority margin of 5 points; at 80% completion, one-sided 5% and 80%
  power, about **790 executions per arm** (a margin of 10 points needs about 200).
  At this project's volume (7 dev executions in the whole sample) it takes many
  projects or weeks. Secondary: steps per execution, input tokens *including the
  cached-token ratio*, cost per execution, latency added by the Jev (p50/p95,
  ceiling of 2 000 ms), and the share of steps in which the Jev leaves the whole
  catalog.
- **Guards.** A kill-switch flag per project; fall back to the whole catalog on any
  Jev failure or above the latency ceiling (already in every policy); a way for the
  agent to ask for the full catalog when the menu does not hold what it needs
  (a menu of one forces the tool, 61% of the steps here); an interim look at each
  100 executions with a stop if the primary metric falls by more than the margin;
  the Anamnese out of the sample (paused); the menu and the pick logged on every
  step, so the analysis is a query, not a memory.

### What this section still cannot see

- The **agent's choice inside the menu**: the reason this is a ceiling.
- **Dependence between steps**: 10 clusters in validation; the intervals are
  step-level.
- **Prompt cache** and **latency in the agent's loop**: not measured (the Jev call
  is, p50 317 ms; its effect on the loop is not).
- The **label**: still the tool the chat model called, and a restricted menu
  changes what it does next.

### Cost of this test

One call, for the 36 new steps: **US$ 0.001275** by `usage.cost` (task ceiling
US$ 0.30). The policies are offline over the answers already on disk. The
accumulated spend of the output directory went from US$ 0.4136 to US$ 0.4149.

## Live comparison (AT-239, 2026-10-01): the instrument is ready, the run did not happen

> AT-239 (EP-029, HS-063) asks the question every earlier section left open:
> **with the router on, do turns get shorter, faster or cheaper, and does the
> work still come out?** The same tasks, on the same OpenRouter model, with the
> routing of [ADR 0179](../adr/0179-o-laco-pergunta-ao-jev-qual-ferramenta.md)
> on and off, on two chat models of different speeds.
>
> **Status on 2026-10-01: not measured.** The session that built the instrument
> (branch `test/jev-com-e-sem`, from `dev` at `d070b000d7`) had a paid key and a
> US$ 5.00 ceiling, but its egress proxy denied the `CONNECT` to
> `openrouter.ai:443` by organization policy, and also to `repo.hex.pm` and
> `builds.hex.pm`, so the engine could not be compiled either. No chat call and
> no Jev call left the machine: **spend US$ 0.00**, and every cell of the live
> table below is empty on purpose. What follows is the instrument, the protocol
> and the decision rule, all written **before** any run, and the numbers that
> could be measured without the network.
>
> **Second attempt, same day: still not measured, for a different reason.** The
> owner allowed `openrouter.ai` on the session's egress (a `GET` answered 200),
> and both protocol models were listed with tool support
> (`deepseek/deepseek-v4.1-flash` at US$ 0.03/0.50 per million input/output,
> `anthropic/claude-haiku-4.5` at US$ 1.00/5.00). The first chat call came back
> `HTTP 403 Key limit exceeded (total limit)`: the test key has a US$ 10.00
> limit, US$ 10.05 already used and no reset (`GET /api/v1/key`). A one-task
> smoke, outside the protocol and in its own folder, spent **US$ 0.00**; no
> protocol execution was recorded. Running it needs the owner to raise the
> key's limit (or hand over another key) — about US$ 1.28 by the estimate below,
> less at DeepSeek's current price. The smoke also found two things the fake
> network never could, both fixed or documented in the instrument:
>
> - **An account or network failure was recorded as a measured execution.**
>   Both smoke executions ended `erro` at step 0 with `HTTP 403`, were written
>   to the output as "the task did not come out", and the resume would never
>   have repeated them: with a dead key, all 40 executions would have entered
>   the table. `falhaDeInfra` (`resumo.ts`) now classifies a chat error of HTTP
>   401/402/403/407/429 or transport as the measurement not happening; `vivo.ts`
>   does not record that execution, stops the run with the reason, and the
>   resume repeats it. A provider error in a 200 body, a 5xx, and a Jev
>   fallback stay outcomes of the arm, as in the engine.
> - **Node's `fetch` ignores `HTTPS_PROXY`.** Behind a proxy, run with
>   `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21); without it the calls went direct and
>   the egress answered 403 with a non-JSON body.

### What the instrument runs, and what is a port

`pnpm --filter @brabo/scripts jev:vivo` (files in `scripts/jev/vivo/`) runs a
dev agent's loop on five small tasks, once with the router on and once off, and
calls OpenRouter directly — the api, the engine and the database are not
involved, like the paid language validation of AT-167.

| file | role | product or port |
|---|---|---|
| `roteador.ts` | `recortarEstado`, `montarPedidoAoJev`, `lerRespostaDoJev`, `menuP3`, the `state` ceiling | **the product's code**, re-exported from `apps/api/src/domain/llm/tool-router.ts` |
| `laco.ts` | the loop: iteration ceiling, recovery of tool calls written as text, stop on an accepted `report_done`/`report_blocked`, the single retry with the whole catalog when a restricted menu got an answer with no tool | port of `ToolLoop`, `EngineApiClient.llm_turn/5` and `DecidirFerramentaDoPassoUseCase` |
| `recuperacao.ts` | which steps went through `tool_call_recovery.ex` | port; its spec runs the cases of `tool_call_recovery_test.exs` and pins anchor lines of the `.ex` |
| `rede.ts` | the chat call (messages on the wire as the api writes them) and the Jev call (2 000 ms ceiling, the same named fallbacks) | port of `toWireMessage`/`toWireTool` and of `JevToolRouter`; anchor lines pinned |
| `ferramentas-dev.exs` → `ferramentas-dev.json` | the **complete** `spec/0` of the nine tools of `Engine.Dev.Tools.registry/0` (name, description, parameter schema) | read from the engine source with plain `elixir`, no compiled engine; a spec fails when the registry or a description drifts |
| `tarefas.ts` | five tasks on a dependency-free Node project, each with a check run **after** the loop (original tests restored, hidden tests added): "the task came out" | the instrument's own |
| `executor.ts` | the tools in a temporary sandbox, returning the engine's texts where they are fixed in code | the instrument's own |
| `resumo.ts`, `vivo.ts` | the table, the decision rule, the cost estimate, the CLI | the instrument's own |

Out of the instrument, the same in both arms and declared: the approval
pipeline (`terminal` and `write_file` run directly, as in auto mode), context
compaction, the language orientation and the author profile appended at the
end of each call, the RAG (empty index), the module contracts (none declared),
and the rest of the real system prompt (instruction files, business rules, task
state). The system prompt is the engine's dev identity plus two lines of project
context; the first user message is the engine's own kickoff
(`scripts/jev/kickoff.ts`). The cost of each call is the `usage.cost` of the
response, the number RN-665 ([ADR 0188](../adr/0188-o-custo-real-do-provider-vira-o-numero-do-metering.md))
puts in the metering; the product's `token_usage` is not involved.

### Protocol (written before any run)

- **Models**: `deepseek/deepseek-v4.1-flash` (slower, reasoning) and
  `anthropic/claude-haiku-4.5` (faster), the two the AT-167 validation already
  reached with tool definitions on this key.
- **Tasks**: `T1-media` (implement a function), `T2-moeda` (fix a formatting
  bug), `T3-limite` (the cause is in another file: `config/`), `T4-slug`
  (create a module and its tests; hidden tests check it), `T5-renomear` (rename
  across two files; no rest of the old name may stay in `src/`). Each task's
  starting state fails its check and a reference solution passes it (spec).
- **Sample**: 2 rounds → 10 executions per arm per model, 40 in all. Arm order
  alternates by task and round, so neither arm always gets the provider's
  slower minute. Iteration ceiling 30 (the product's dev ceiling is 60; here it
  bounds spend).
- **Per execution**: steps; steps whose calls came as **text** and went through
  the recovery; steps where the router was consulted, applied a smaller menu,
  left the catalog whole without a fallback (no previous tool, or the Jev said
  `responder_sem_ferramenta`), or **fell back** (with the reason and the RN-059
  origin); retries with the whole catalog; calls outside the step's menu;
  wall-clock latency of the whole execution (Jev + chat + tools) and of the LLM
  part; cost of chat and of Jev; how it ended; whether the task came out.
- **Decision rule** (`comparar` in `resumo.ts`), per model, on with off:
  quality — the "task came out" rate of *on* no more than **10 points** below
  *off*; cost — the mean cost per task that came out (chat + Jev) of *on* not
  above *off*; latency — the median execution of *on* not above **1.2×** *off*.
  **Keep on by default** if all three hold on every model; **turn off** if
  quality fails on every model or no model passes the three; **restrict** to the
  models that pass otherwise. Fewer than 10 executions per arm is
  `amostra_insuficiente`, never a verdict.

### Cost estimate (no network)

`--estimar` with the prices that were measurable from earlier records: DeepSeek
input US$ 0.30 per million and Haiku US$ 1.00 (both derived from the paired
input cost reported in
[Measuring the language heuristic](medicao-do-idioma.md#incremental-cost-of-the-orientation));
output US$ 1.20 for DeepSeek is an **assumption** (not recorded anywhere) and
US$ 5.00 for Haiku the list price. Assumed 12 steps per execution, 400 tokens of
history added per step, 150 output tokens, no cache:

| model | per execution | both arms, 2 rounds |
|---|---|---|
| `deepseek/deepseek-v4.1-flash` | ~US$ 0.015 | ~US$ 0.29 |
| `anthropic/claude-haiku-4.5` | ~US$ 0.049 | ~US$ 0.99 |
| **total** | | **~US$ 1.28** |

The run stops before any call once the accumulated `usage.cost` of the output
folder reaches `--teto-usd` (default 4.50) and does not start an execution with
less than `--reserva-usd` (0.10) left.

### What could be measured offline (2026-10-01)

The dev catalog grew since the replay: `listar_contratos_de_modulos`
(RN-684) is the ninth tool, and `catalogo.json` (eight) is stale for it — the
replay's 746 → 138 tokens no longer describes the current catalog. On the wire
(`toWireTool` form, `ferramentas-dev.json`):

| | characters | ≈ tokens (÷ 4) |
|---|---|---|
| whole dev catalog, 9 tools | 3 816 | 954 |
| a 2-tool menu, median over all pairs (min 501, max 1 464) | 850 | 213 |
| saving per call where P3 restricts the menu | | **≈ 741** |

The Jev costs US$ 0.0000727 per step (AT-237), so the definition saving pays for
it on a chat model whose input costs more than **US$ 0.098 per million tokens**
(0.0000727 ÷ 741) — both models of the protocol, at list price. The catch is
the same one written in "Savings in tool definitions": tool definitions are the
start of the cached prefix, a menu that changes from step to step breaks the
cache, and DeepSeek served most of its input from cache in AT-167. Whether the
saving survives that, and what the extra call in series costs in latency inside
the loop (p50 306 ms per step, measured outside it), is exactly what the live
table would answer.

### The live table (empty)

Generated by `jev:vivo --relatorio`; dated by the run, with the commit in each
record.

| model | Jev | executions | task came out | steps (median · mean) | steps via `tool_call_recovery` | execution p50 · p95 | LLM (chat + Jev) p50 | cost/execution (chat + Jev) | of which Jev | cost per task out | Jev: applied · unrestricted · fallback | retries with whole catalog | outside the menu |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `deepseek/deepseek-v4.1-flash` | on | **not measured** | | | | | | | | | | | |
| `deepseek/deepseek-v4.1-flash` | off | **not measured** | | | | | | | | | | | |
| `anthropic/claude-haiku-4.5` | on | **not measured** | | | | | | | | | | | |
| `anthropic/claude-haiku-4.5` | off | **not measured** | | | | | | | | | | | |

### Recommendation (provisional — the owner decides)

**Restrict**: keep the router on for the dev agents (`dev-*`, the `ToolLoop`)
and off for the conversational agents, until the live table exists. The numbers
behind it, all from earlier rounds, none from AT-239:

- **Where there is evidence, it is for dev agents.** P3 coverage per dev agent
  was 84% to 96% on validation (`dev-board-engine` 23/24, `dev-scoring` 35/38,
  `dev-persistence` 31/34, `dev-game-session` 32/38); every conversational agent
  had **fewer than four** validation steps (the one gate with data,
  `qa-estrategia`, was 14/16). "On by default" today extends to the seven
  conversational agents a menu that was never measured on them.
- **The quality bound is wide.** Coverage is a ceiling; the replay's end-to-end
  range is 62% to 91%, and the loss is cushioned by the retry with the whole
  catalog only when the model answers with no tool at all — not when it picks
  the wrong tool from a menu of one (61% of the steps).
- **The cost case is plausible, not shown.** ≈ 741 definition tokens saved per
  restricted call against US$ 0.0000727 per Jev call is a gain on any model
  above US$ 0.098 per million input tokens — ignoring the prompt cache, which is
  the thing most likely to reverse it.

Turning it **off** everywhere is not what these numbers say: nothing measured
shows a loss, and the fallback paths (2 000 ms ceiling, whole catalog on every
failure, the retry) bound the damage. **The live run with the rule above
supersedes this paragraph**, whatever it says; it costs about US$ 1.28 and one
command where `openrouter.ai` is reachable. Nothing in the code was changed:
the switch is per workspace (`PUT workspaces/:workspaceId/tool-router`), and a
per-agent restriction would be a new decision and a new change.

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

The second round has its own command, reading a frozen snapshot of the database
(`--dados-cache`, outside the checkout) and writing one file per variant:

```bash
# the snapshot, once (the dev database keeps moving; every later run reads this file)
pnpm --filter @brabo/scripts jev:analise -- --container brabo-dev-postgres-1 \
  --dados-cache ~/.cache/brabo/replay-jev/dados.json --variante original --estimar

# one variant, tuning half first; validation only when the choice is made
pnpm --filter @brabo/scripts jev:analise -- --dados-cache ~/.cache/brabo/replay-jev/dados.json \
  --variante escopo --metade tuning --arquivo-de-chave ~/.config/brabo/openrouter-test.env
pnpm --filter @brabo/scripts jev:analise -- --dados-cache ~/.cache/brabo/replay-jev/dados.json \
  --variante escopo --metade validacao --arquivo-de-chave ~/.config/brabo/openrouter-test.env

# the tables of this section, and the wrong steps for reading by hand
pnpm --filter @brabo/scripts jev:analise -- --dados-cache ~/.cache/brabo/replay-jev/dados.json --relatorio --final escopo
pnpm --filter @brabo/scripts jev:analise -- --dados-cache ~/.cache/brabo/replay-jev/dados.json \
  --variante escopo --metade validacao --dump-erros ~/.cache/brabo/replay-jev/v2/erros.txt
```

The snapshot of this round was taken from the database as it stood at
2026-09-29 14:27 UTC, plus the `proposed_action.created` events and the
`proposed_actions` outcomes of the same sessions; a fresh snapshot has more
steps and a different split. The ceiling is on the **accumulated** spend of the
output directory (`--teto-usd`, default US$ 1.00), not of one call.

The menu test is offline over those answers; only the 36 steps born after the
snapshot call the network:

```bash
pnpm --filter @brabo/scripts jev:analise -- --dados-cache ~/.cache/brabo/replay-jev/dados-d.json \
  --variante escopo --metade ambas --arquivo-de-chave ~/.config/brabo/openrouter-test.env

# --dados-base is the snapshot that fixed the split; what it did not know is "new"
pnpm --filter @brabo/scripts jev:menu -- --dados-cache ~/.cache/brabo/replay-jev/dados-d.json \
  --dados-base ~/.cache/brabo/replay-jev/dados-c.json --sensibilidade
```

The live comparison of AT-239 (needs `openrouter.ai` reachable; the output
folder, `$XDG_CACHE_HOME/brabo/jev-vivo/` by default, stays out of the checkout
and the script refuses one inside it):

```bash
# the dev tool definitions, when a dev tool changed (plain elixir, no compiled engine)
elixir scripts/jev/vivo/ferramentas-dev.exs > scripts/jev/vivo/ferramentas-dev.json

# the estimate, without the network
pnpm --filter @brabo/scripts jev:vivo -- --estimar \
  --preco deepseek/deepseek-v4.1-flash=0.3/1.2 --preco anthropic/claude-haiku-4.5=1/5

# the run (resumes; stops before any call at the ceiling, and on an account or
# network failure without recording it), then the table and the verdict;
# behind a proxy, prefix NODE_USE_ENV_PROXY=1 (Node's fetch ignores HTTPS_PROXY)
pnpm --filter @brabo/scripts jev:vivo -- --rodadas 2 --teto-usd 4.5 \
  --arquivo-de-chave ~/.config/brabo/openrouter-test.env
pnpm --filter @brabo/scripts jev:vivo -- --relatorio
```

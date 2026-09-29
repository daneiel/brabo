---
id: medicao-do-idioma
title: Measuring the language heuristic
description: The instrument that measures the AT-080 language-detection heuristic against a labeled corpus, the numbers it produced on the synthetic corpus, and the paid validation of the language orientation and its cost (AT-167, 2026-09-29).
---

# Measuring the language heuristic

> AT-160 (EP-028, HS-053). The heuristic being measured is the one the AT-080
> specification proposed ("A — own heuristic, no dependency"). Since AT-163
> ([RN-624](../business-rules.md#rn-624)) the product runs it: the api detects
> the author's language with it and ASKS before anything changes. The
> product's thresholds are **provisional** — see
> [The product's provisional thresholds](#the-products-provisional-thresholds).

## What exists

The instrument lives in `scripts/idioma/` and runs with the repository's Node
(type stripping, no build step). **No new dependency**: the heuristic is marker
lists and regular expressions, and the extraction talks to Postgres through
`psql` inside the database container.

The heuristic itself lives in the **api** —
`apps/api/src/domain/iam/heuristica-de-idioma.ts` — and `scripts/idioma/heuristica.ts`
only re-exports it, so the instrument measures exactly the code the product
runs. That direction is forced: the api reaches neither `scripts/` nor any
runtime package without a build step, and `packages/shared` is types only. The
file has no imports, so Node runs it from `scripts/` by type stripping (the
`idioma:*` commands silence the "typeless package" warning that comes with it),
and `scripts/idioma/` has its own `tsconfig.json` — the only difference is
turning `verbatimModuleSyntax` off, which rejects every `export` of a CommonJS
module such as the api's. A `.mts` file was tried first: it passed both
typechecks and the build, and broke every `ts-node` script of the api. The rule
of *what is evidence* (`evidenciasDoAutor`) moved with the heuristic, and the
real-corpus extraction uses the same one.

| file | role |
|---|---|
| `heuristica.ts` | re-exports the api's heuristic: cleaning, contrastive scoring, the candidate and the provisional parameters, the 10-message sample, the hysteresis and the evidence rule |
| `corpus-sintetico.jsonl` | the **versioned** synthetic corpus — every line hand-written for the instrument, `origem: "sintetico"` |
| `sequencias-sinteticas.json` | synthetic conversations for the sample-and-hysteresis path |
| `medicao.ts` / `medir.ts` | the instrument and its CLI |
| `extrair.ts` | extracts the **real** corpus from the local event log, to a file outside git |
| `rotular.ts` | assisted labeling of the real corpus, in the terminal |

## The two corpora, and where each one lives

The maintainer's decision (AT-168, answer 5) is **real + synthetic**. They have
opposite storage rules:

- **Synthetic** — versioned, reviewed like code. It covers the nine mandatory
  cases of AT-080 (typos, legitimate Spanish, English, mixed text, "ok", code,
  logs, quotations in another language) plus Portuguese full of English jargon,
  inline identifiers, and languages outside the three (French, Italian, German,
  Galician, Catalan, Dutch) — the language list is open (AT-168, answer 2).
- **Real** — the user's own messages from the **local** event log. It never
  enters git, a fixture, a CI log or a PR body. `extrair.ts` and `corpus.ts`
  refuse any destination inside the checkout, and the file is written with mode
  600 under `$XDG_CACHE_HOME/brabo/corpus-idioma/` (else `~/.cache/…`). The
  report never prints an item's text — only ids, labels and counts — so its
  output can be pasted into a PR.

What the extraction takes as evidence follows the AT-080 cleaning: only events
whose actor is the **user** (the agent's reply is never evidence, so a Spanish
answer from the model cannot feed the detection back), and, for the structured
form, only the **answers** — the concatenated `chat.message` the api writes right
after it, whose labels are the agent's text, is skipped.

The labeling assistant does **not** pre-fill the heuristic's guess: accepting it
with ENTER would anchor the label on the thing the label exists to measure. ENTER
accepts the language the owner declares with `--padrao`.

Labels: a BCP-47 code (`pt-BR`, `es`, `fr`…), `und` (nothing to decide: "ok",
only code, only a log) or `mul` (mixed, no dominant language). Scoring:
`pt`/`es`/`en` must get their own language; `und`, `mul` and any other language
must get `indeterminado` — the only correct answer a three-language heuristic can
give them. An `indeterminado` on a decidable item is **lost coverage** (the known
preference stays); a wrong language is an **error**, and `falso es` is counted
apart because it is the defect the epic exists to remove.

## Running it

```bash
# synthetic corpus (the default)
pnpm --filter @brabo/scripts idioma:medir

# the owner's real corpus, on the owner's machine
pnpm --filter @brabo/scripts idioma:extrair --container brabo-dev-postgres-1
pnpm --filter @brabo/scripts idioma:rotular --padrao pt-BR
pnpm --filter @brabo/scripts idioma:medir --real
```

`--container` runs `psql` inside that container with one read-only `SELECT` on
`session_events` (`--usuario`/`--banco` default to the compose's `brabo`/`brabo`);
`--database-url <url>` uses a host `psql` instead. Re-running the extraction keeps
existing labels and appends new messages unlabeled.

## Numbers on the synthetic corpus (2026-09-28)

123 labeled items, 7 sequences, candidate parameters of AT-080 (20-word minimum,
threshold 0.8, margin 0.3, 10 messages / 2,000 characters, hysteresis 2). Two
marker lists: `at080` is the specification's list verbatim; `ampliada` is a
larger list written by this instrument **before** it was run against the corpus
(frequent function words absent from the other two languages). Same corpus, so
`ampliada` is not validated by these numbers — the real corpus is what can tell.

Per message, candidate parameters:

| label | n | `at080` correct | `at080` indeterminate | `ampliada` correct | `ampliada` indeterminate |
|---|---|---|---|---|---|
| pt | 56 | 26 (46.4%) | 30 | 30 (53.6%) | 26 |
| es | 20 | 6 (30.0%) | 14 | 7 (35.0%) | 13 |
| en | 14 | 6 (42.9%) | 8 | 6 (42.9%) | 8 |
| und | 15 | 15 (100%) | 0 | 15 (100%) | 0 |
| mul | 5 | 5 (100%) | 0 | 5 (100%) | 0 |
| other languages | 13 | 10 | 0 | 9 | 0 |

Wrong-language verdicts: **none on a `pt`/`es`/`en` item**, in either list. All of
them are on languages outside the three — `at080`: French → pt (the `ê` of
*arrêté*), **Galician → es** (the one `falso es`), Dutch → en; `ampliada`: French →
es, German → pt and → en, Dutch → en.

The cleaning removed more than half of the words of **zero** decidable items.

All seven synthetic sequences end where expected with at most the allowed number
of switches, in both lists — including Portuguese with a long Spanish quotation,
one whole Spanish message in the middle of Portuguese, and Portuguese dense with
English jargon.

CPU on this machine: `at080` 11.7 µs per message and 49 µs per evaluation of the
10-message sample; `ampliada` 16.8 µs and 60 µs. It varies with the machine; the
order of magnitude is the point.

## What the numbers say

- **With the `at080` list, the threshold and the margin never bind.** 66 of the
  67 items that score at all score for one language only (confidence = 1.0), so
  sweeping the threshold from 0.5 to 1.0 changes nothing. The word minimum is the
  only knob that acts: per message, decidable items reach their language 42.2%
  of the time at 20 words, 58.9% at 10 and 66.7% with no minimum — at 20 it
  throws away every short and typo message and most of the technical ones.
- **Dropping the minimum lets mixed text decide.** With no minimum, `at080` turns
  three of the five mixed messages into `en` or `pt`, and `ampliada` also decides
  two `und` items as `en` — unfenced code (`const total = itens.reduce(…)`) and
  pnpm output (`ELIFECYCLE  Test failed. See above for more details.`) pass the
  cleaning, which only knows fenced code and the log shapes AT-080 listed.
- **The margin of 0.3 is redundant with the threshold of 0.8** in any list: with
  three languages, a winner at ≥ 0.8 is at least 0.6 above the second.
- **The unit that matters is the sample, not the message** — in the sequences
  the 10-message window reaches the language with messages that alone would be
  `indeterminado`. A single Spanish message in a Portuguese window turns the
  sample `indeterminado` for as long as it stays in the window (sequence `q03`):
  no switch, but no confirmation either.
- **The open language list is where the errors are.** With three languages, a
  Galician or French user can be told they write Spanish or Portuguese. Under the
  AT-168 rule the detection only *asks*, and the user confirms, so the cost is a
  wrong question — but it is still the heuristic's only failure mode here.

These are synthetic numbers: the corpus was written by the same hand that wrote
the heuristic. The thresholds of AT-163 should come from the real corpus.

## The product's provisional thresholds

AT-163 had to ship with *some* numbers before the real corpus exists, so the
api reads `PARAMETROS_PROVISORIOS` — **provisional, not calibrated**, and
declared so in [RN-624](../business-rules.md#rn-624):

| parameter | provisional | AT-080 candidate | why |
|---|---|---|---|
| marker list | `at080` | — | `ampliada` gains 4 points in pt and gets German wrong twice; neither is validated by real data |
| word minimum (over the sample) | **10** | 20 | coverage of decidable items 42.2% → 58.9% with the **same** three wrong verdicts (French, Galician, Dutch — languages outside the three); below 10, mixed text starts to decide |
| threshold / margin | 0.8 / 0.3 | 0.8 / 0.3 | they never bind on the synthetic corpus, so there is no better number to pick yet |
| sample | 10 messages / 2,000 characters | same | — |
| hysteresis | 2 | 2 | — |

The hysteresis is **recomputed, never stored**: the api reads the last 11
pieces of evidence and asks whether the last two evaluations of the sample
agree. CPU on this machine, synthetic corpus: 11.6 µs to clean and classify
one message, 110 µs per detection (11 messages, two evaluations). The read is
served by a partial index on `session_events`: 0.056 ms against 13.5 ms for a
sequential scan, measured over 200,000 events.

To recalibrate: run the real corpus (`idioma:medir --real`), then change
`PARAMETROS_PROVISORIOS` in the api — it is the only place the product reads
them from, and the instrument imports the same file (its report still sweeps the AT-080 candidates).

## Paid validation of the language orientation (AT-167, 2026-09-29)

> The protocol is AT-082's, with the decisions of AT-169: budget US$ 5,
> 5 rounds per case and arm, acceptance threshold "in the treated arm, **zero**
> Spanish answers where pt-BR is expected, and correct language **≥ 95%** in
> C01–C04 and C06–C15", model under test `deepseek/deepseek-v4.1-flash`,
> comparison model `anthropic/claude-haiku-4.5`, incremental cost ceiling
> 50 input tokens per call. Code at `d48f99f8e` (the `dev` of 2026-09-29).

### Where it runs, and what is (and is not) the product

A script outside the product, `scripts/idioma/validar.ts` (the pure part —
matrix, judging, report — in `validacao.ts`, tested by `validacao.spec.ts`). It
calls OpenRouter **directly** and writes nothing to the database. What the
product sends to the model is **read from the product's files at every run**,
never copied — the read throws, naming what it missed, if a file changes shape:

- the orientation (RN-622/623): `@textos`, the generic sentence, the artifact
  clause, `@forma_curta` and `@ferramentas_de_artefato` of
  `apps/engine/lib/engine/harness/idioma_da_resposta.ex`, sent as the LAST
  message, `role: "system"`, in every call of a treated turn (tool iterations
  included) and never kept in the history;
- the summary prompt and its language sentence (RN-621) of
  `apps/engine/lib/engine/harness/context_manager.ex`;
- the Criativo persona (`CRIATIVO_INSTRUCTIONS`), its two tools with the real
  descriptions, and the tool results the product returns.

Declared differences from the product: the system prompt is only the persona
(no `ContextBuilder` layers); compaction is **forced** before the fifth turn
of C04 (keeping the last two messages, the product's `keep_recent`), with the
model under test as summarizer; resumption (C15) is the history rebuilt as
text, the shape of `Engine.Agents.Reidratacao`; at most 4 model calls per
turn (the Criativo allows 12); and `max_tokens` is capped at 4000 (the product
sends none). The upstream provider was **not** fixed — recorded per call as a
confounder. Baseline = the code before RN-621/622: no orientation **and** the
old summary prompt (AT-169 answer 4: the validation measures the set, there is
no isolated baseline of the old summary).

The resolved language of each message's author is part of the case: `pt-BR`
for Ana (C01–C05, C07–C11, C13–C15), `en` for Bob (C06 as a confirmed detected
`en`, C12 as an explicit `en` preference writing Portuguese); project language
`pt-BR`. C05 expects **pt-BR**: under AT-168 answer 4 detection only *asks*, so
the author's resolved language stays pt-BR until confirmed.

A first passo-zero run with `max_tokens` 1000 was **discarded**: DeepSeek's
reasoning used the whole cap in 7 calls and the answer came back empty (two
summaries became the product's fallback text). Its records are kept apart in
the output folder; an empty answer now counts as `falha`, never
`indeterminado`.

### Step zero: not reproduced

Baseline only, `deepseek/deepseek-v4.1-flash`, C01–C04, 5 rounds: **0 Spanish
answers in 35 judged answers** (35 pt, 0 indeterminate). The 13/09 report
(Spanish from Portuguese input) is **not reproduced**, so no improvement on
*that* defect can be claimed from the treatment. The run continued because the
AT-169 threshold is absolute on the treated arm and the other cases (C05, C06,
C12, C16, C17) do show the baseline answering in the wrong language.

### Results by case × arm × model

First judge: the local classifier (`ampliada` list, candidate parameters) on
the prose. "ok" = expected language; "wrong (es)" = another language (of which
Spanish); "ind." = indeterminate. n is judged answers (5 rounds × judged turns).

| case | DeepSeek baseline | DeepSeek treatment | Haiku baseline | Haiku treatment |
|---|---|---|---|---|
| C01 (n=5) | 5 ok | 5 ok | 5 ok | 5 ok |
| C02 (n=5) | 5 ok | 5 ok | 5 ok | 5 ok |
| C03 (n=15) | 15 ok | 15 ok | 15 ok | 15 ok |
| C04 (n=10) | 10 ok | 10 ok | 10 ok | 10 ok |
| C05 (n=5, out of the 95% list) | 1 ok, 4 wrong (4 es) | 5 ok | 0 ok, 5 wrong (5 es) | 2 ok, 3 wrong (3 es) |
| C06 (n=5) | 2 ok, 2 wrong, 1 ind. | 3 ok, 2 ind. | 4 ok, 1 wrong | 5 ok |
| C07–C10 (n=5 each) | all ok | all ok | all ok | all ok |
| C11 (n=10) | 6 ok, 4 wrong | 5 ok, 5 wrong | 5 ok, 1 wrong, 4 ind. | 6 ok, 4 wrong |
| C12 (n=10) | 0 ok, 10 wrong | 4 ok, 6 ind. | 0 ok, 10 wrong | **0 ok, 10 wrong** |
| C13 (n=5) | 5 ok | 5 ok | 5 ok | 5 ok |
| C14, C15 (n=5 each) | all ok | all ok | all ok | all ok |
| C16 (n=20, out of the list) | 10 ok, 10 wrong | 19 ok, 1 ind. | 10 ok, 10 wrong | 18 ok, 2 wrong |
| C17 (n=20, out of the list) | 12 ok, 8 wrong | 20 ok | 16 ok, 4 wrong | 20 ok |

C13 called `emit_artifact` in 20 of 20 conversations. No call failed.

### Against the threshold

| model | Spanish where pt-BR expected (treated) | correct in C01–C04, C06–C15 (strict, classifier) | verdict by the classifier |
|---|---|---|---|
| `deepseek/deepseek-v4.1-flash` | 0 | 82/95 (86.3%), 8 indeterminate | **does not pass** |
| `anthropic/claude-haiku-4.5` | 3 (all C05) | 81/95 (85.3%), 0 indeterminate | **does not pass** |

The 13 DeepSeek misses are two groups. The reading below was the agent's,
made BEFORE the review; the review ([next section](#human-review-and-the-haiku-diagnosis-at-167-follow-up))
corrected it — the 8 indeterminates are not all English prose:

- the 8 indeterminates (C06 ×2, C12 ×6) read as English prose — the `ampliada`
  list scores English poorly ("Great starting point — …");
- the 5 C11 misses answer the translation request with the **English
  translation inside a Portuguese frame**, which the orientation allows ("unless
  the user explicitly asks … in this message" covers the translation, not the
  frame). The protocol's "translation in en" does not say which of the two is
  right.

If the review accepts both groups, DeepSeek reaches 95/95 and **passes**; if it
rejects C11, 90/95 (94.7%) and fails by one answer. Haiku **fails either way**:
with the explicit `en` preference and Portuguese messages (C12) it answered in
Portuguese in 10 of 10 treated answers, and it answered 3 of 5 Spanish messages
in Spanish (C05). A hypothesis, not measured: for Anthropic models OpenRouter
lifts the trailing `system` message into the top system prompt, where it loses
the recency it has at the end of the list. (Measured afterwards, and **not
confirmed**: see the diagnosis below.)

The answers to review (every indeterminate or divergent one, every C11
translation, and a deterministic 1-in-10 sample of the concordant) are 146 of
560, listed in `revisao.md` in the output folder.

### Incremental cost of the orientation

Paired `prompt_tokens` of the **first** call of each conversation (identical
input in both arms but the orientation), from OpenRouter's `usage`, never an
estimate:

| model | orientation | pairs | Δ input tokens |
|---|---|---|---|
| DeepSeek | pt-BR (108 characters) | 75 | 32 (every pair) |
| DeepSeek | en + artifact clause (128 characters) | 15 | 27 |
| Haiku | pt-BR | 75 | 30 |
| Haiku | en + artifact clause | 15 | 27 |

All under the 50-token ceiling. At catalog input price that is about
US$ 0.0000096 per call on DeepSeek and US$ 0.00003 on Haiku — an upper bound,
since DeepSeek served most of the input from cache (cached tokens are
returned; the per-call cost with cache is inside `usage.cost`, not separated
per message). The orientation goes in every call of a turn, so a turn with
tool iterations pays it once per iteration.

### Spend

The cost of the validation is the sum of `usage.cost` of each response, kept
per call in `chamadas.jsonl`: **US$ 2.3071** in total — US$ 2.2629 in the
counted runs (DeepSeek 0.1526 baseline + 0.2133 treatment; Haiku 0.9526 +
0.9443; 865 calls), US$ 0.0281 in the discarded step zero and US$ 0.0162 in a
one-case smoke. The `GET /api/v1/key` counter moved from 1.8301 to 4.1578
(Δ 2.3277) over the same period, but the key is shared with other paid lanes
running at the same time and the counter lags, so that delta is context, not
this validation's spend. Generation ids were not recorded, so the per-call cost
was not cross-checked against `GET /api/v1/generation`. The product's own
metering (`token_usage`) was not involved: the script bypasses the api.

### Reproducing

```bash
# the key file holds OPENROUTER_TEST_KEY=…; the key is never printed
pnpm --filter @brabo/scripts idioma:validar --arquivo-de-chave ~/.config/brabo/openrouter-test.env \
  --modelos deepseek/deepseek-v4.1-flash --bracos baseline --casos C01,C02,C03,C04   # step zero
pnpm --filter @brabo/scripts idioma:validar --arquivo-de-chave ~/.config/brabo/openrouter-test.env \
  --pular-existentes --teto-usd 2.5                                                 # everything else
pnpm --filter @brabo/scripts idioma:validar --relatorio                             # report only
```

Output goes to `$XDG_CACHE_HOME/brabo/validacao-idioma/<date>/` (else
`~/.cache/…`), mode 600, and the script refuses a folder inside the checkout.
`--teto-usd` stops before the call that would pass it, by the running sum of
`usage.cost`.

Not measured: cache savings as such, the product's full system prompt, real
(threshold-triggered) compaction, a restart of the real engine, the tokenizer
count of the artifact clause in Portuguese, and any fixed upstream.

The 146 answers were reviewed by hand; the result, and the one decision that
is still the owner's, are in the next section.

## Human review and the Haiku diagnosis (AT-167 follow-up)

Two offline-or-cheap follow-ups to the paid validation, both on the same run
(`respostas.jsonl`, 560 judged answers): the human review of the 146 answers the
classifier flagged (Part A, no spend), and the test of the "OpenRouter hoists the
trailing `system` message" hypothesis for Haiku (Part B, US$ 0.1485). Neither
changes the product.

### Part A — the review of the 146

Every one of the 146 answers in `revisao.md` was read, one by one, by the agent
that wrote this section (not by a second human; the label file is kept for
anyone who wants to contradict it). For each: the **real** language of the text
the user reads, whether it is correct for the case, and a one-line reason. The
files live outside git with the answers —
`~/.cache/brabo/validacao-idioma/2026-09-29/revisao-feita.md` (the 146) and
`amostra-lida.md` (the sample below). `pnpm --filter @brabo/scripts
idioma:revisar` reads them and prints every table of this section; the labels
are data, the arithmetic is code (`scripts/idioma/revisao.ts`, tested).

The labels are four, because the reading found a fact the classifier cannot see:

- `sim` / `nao`: the answer is / is not in the expected language;
- `formulario`: the **prose** is in the expected language, but the questions of
  the structured form (`ask_structured_questions`, the substance of a first
  answer) came out in Portuguese for an author whose language is `en`;
- `c11`: a translation into English inside a Portuguese frame — the owner's
  decision, see below.

| of the 146 | correct | incorrect | prose right, form in Portuguese | C11 (owner's decision) |
|---|---|---|---|---|
| all | 42 | 81 | 8 | 15 |
| baseline arm (89) | 18 | 64 | 1 | 6 |
| treated arm (57) | 24 | 17 | 7 | 9 |

The 14 answers the classifier called **indeterminate** were, once read: 3
English answers (Haiku's plain English translations of C11), 2 incorrect
(DeepSeek C12, Portuguese and English sentences interleaved in the prose), 8
English prose with the form in Portuguese, and 1 C11. So the agent's earlier
sentence — "the 8 indeterminates read as English prose" — was half right: the
prose was English, and so was **not** the form in 6 of the 8.

**The classifier's error, measured.** On the 118 definitive verdicts
(`pt`/`es`/`en`) among the 146 read answers, the reading contradicted **0**. The
classifier never called an answer right that was wrong, nor wrong that was right;
its only failures are the 3 "indeterminate" that were plain English. For the 414
answers that were **not** flagged (all concordant with the expectation), a sample
was read: 60 drawn with `random.Random(20260929).sample(range(414), 60)` over the
answers in `respostas.jsonl` order, plus the 14 unflagged C06/C12 answers with
expected `en` that the draw missed (they decide the threshold, so they were read
whole) — 74 read, **0 divergent** (Wilson 95% upper bound 4.9%). Together with
the 39 concordant answers that the 1-in-10 hash had already flagged and were
read too, the random part is 0 in 99 (upper bound 3.7%): at most ~15 of the 414
could be wrong, and the sample suggests none. Two slips seen in the sample are
one-word insertions (`"What falta for us…"`, `"reminders automáticos"`) that
do not change the language of the answer.

What the classifier **cannot** see is the form: `clf=en` on an English answer
did not tell that its questions were in Portuguese (it flagged those answers as
indeterminate only when the mix was heavy). That is why the sample read the
C06/C12 answers whole, and why the two readings below exist.

### The threshold, recomputed with the reviewed labels

Treated arm, C01–C04 and C06–C15 (n = 95), Spanish counted on the **real** language
of every treated answer where pt-BR is expected (C05 included). Wilson 95%
interval. Two independent readings: **C11** (the owner's, open) and **form**
(prose right, form in Portuguese — the agent resolved it as a fact about what
the user reads, and shows the other side so it can be contradicted).

| model | C11 counts | form counts | hits | rate | 95% interval | Spanish (pt expected) | verdict |
|---|---|---|---|---|---|---|---|
| DeepSeek | yes | yes | 93/95 | 97.9% | 92.6–99.4% | 0 | passes |
| DeepSeek | **yes** | **no** | 87/95 | 91.6% | 84.3–95.7% | 0 | does not pass |
| DeepSeek | no | yes | 88/95 | 92.6% | 85.6–96.4% | 0 | does not pass |
| DeepSeek | no | no | 82/95 | 86.3% | 78.0–91.8% | 0 | does not pass |
| Haiku | yes | (any) | 85/95 | 89.5% | 81.7–94.2% | 3 (C05) | does not pass |
| Haiku | no | (any) | 81/95 | 85.3% | 76.8–91.0% | 3 (C05) | does not pass |

The pass threshold is 91 hits of 95 (94.7% fails). Reading the table:

- **Haiku fails in every reading**: 3 Spanish answers in C05 (the zero-Spanish
  clause alone) and, with everything accepted, 85/95.
- **DeepSeek passes in exactly one cell**: C11 accepted **and** English prose
  with a Portuguese form accepted. Reject either one and it fails — by 4
  answers if the form is rejected (87 of the 91 needed), by 3 if C11 is (88). Reject both and it
  is the classifier's number, 82.
- The C11 decision therefore only matters if the form is accepted. With the form
  counted as a miss, DeepSeek fails whatever C11 is, and the finding to act on
  is not C11 but the form: in the treated arm, 8 of DeepSeek's 15 C06+C12
  answers carry Portuguese text inside an English answer (6 form-only, 2
  interleaved), while 7 are clean English, forms included. The model can
  write the form in English — it does so about half of the time.

What C11 is, in the data. DeepSeek's 5 treated misses: 3 have the English
translation quoted in a Portuguese frame ("Registrei a regra… A tradução que
você pediu: > …"), and 2 have **no translation in the recorded text** — the run
keeps only the last message of a turn, and these turns called `emit_artifact`
first, so the translation was in an earlier message of the same turn (10 calls
for 5 conversations, two per conversation), so the translation was presumably
in an earlier message of the same turn, and was not kept. Both are counted as
frame-only, i.e. as hits under "C11 counts". Haiku's 4 treated misses are an
English translation with a Portuguese note or Portuguese alternatives around it.

> **TODO(humano):** Does a translation into English inside a Portuguese frame
> count as correct in C11? It decides the C11 axis of the table above:
> **accepted** → DeepSeek 93/95 and passes (if English prose with a Portuguese
> form is also accepted; 87/95 if not); **rejected** → DeepSeek 88/95 (or 82/95)
> and fails. Haiku fails either way. Recommendation, in one sentence: accept it
> — the orientation's exception covers only the requested translation and the
> frame stays in the author's language, so rejecting it would penalise exactly
> the behaviour the orientation is meant to produce. (The second question, the
> form in Portuguese, is a product-scope question and is stated as a finding
> above; it was not put to the owner because the agent resolved it as a fact —
> what the user reads.)

### Part B — is it the position of the orientation? (AT-279)

The hypothesis: for Anthropic models OpenRouter lifts the trailing `system`
message into the top system prompt, losing its recency. Test: C12 (author
preference `en`, messages in pt-BR), `anthropic/claude-haiku-4.5`, first turn,
5 rounds per position, the orientation text **read from the product** (it was
`Respond in English (en), unless the user explicitly asks for another language
in this message. Write project artifacts in pt-BR.`), only its position varied:

1. `ultima-system` — as today (`idioma_da_resposta.ex:231`, a trailing
   `role: "system"`);
2. `system-fundido` — appended to the first `system` (persona + orientation);
3. `sufixo-user` — suffix of the last `user` message, **no** `system` added;
4. `ultima-system-e-sufixo-user` — the trailing `system` **plus** the same
   sentence as a suffix.

| position | classifier hits | read |
|---|---|---|
| 1 `ultima-system` (as today) | 0/5 | 5 Portuguese, forms included |
| 2 `system-fundido` | 0/5 | 5 Portuguese |
| 3 `sufixo-user` | 0/5 | 5 Portuguese |
| 4 `ultima-system-e-sufixo-user` | 0/5 | 5 Portuguese |
| control: 1, without the artifact clause | 0/5 | 5 Portuguese |
| control: 3, without the artifact clause | 0/5 | 5 Portuguese |

The four positions were read in full and the two controls read in part, and all
30 answers were also checked for English function words (none in any): all 30
are Portuguese, prose and form. The
position-1 defect is **reproduced** (0/5, as the 0/10 of the paid run), and
**no position corrects it** — not even the one where the orientation is inside
the user's own last message and there is no trailing `system` at all. The
hypothesis is **not confirmed**. The prompt-token counts show the text reached
the model in every position (2 426, 2 427, 2 427 and 2 454 input tokens: +1 for
the two single placements and +28 for the double), so this is not a dropped
message. The control also excludes the suspect second sentence: the artifact
clause ("Write project artifacts in pt-BR.", RN-623) is not the cause either
(0/10 without it).

What this does not exclude, and was not measured: the second turn (only the
first was run, for budget — the paid run had the second turn wrong 5/5 as well);
a stronger wording (the sentence says "unless the user explicitly asks", and
Portuguese input may be read as that); the language of the persona itself
(`CRIATIVO_INSTRUCTIONS` is Portuguese); and the upstream (all 30 calls were
served by Amazon Bedrock, so an upstream effect cannot be separated). DeepSeek
follows the same orientation in the same case — its treated C12 answers were
English prose in 8 of 10 — which points at the model, not at the placement.

**Proposed change: none about position.** The one place a position would be
changed, if it had helped, is `Engine.Harness.IdiomaDaResposta.anexar/4`
(`apps/engine/lib/engine/harness/idioma_da_resposta.ex:231`, the `messages ++
[%{"role" => "system", …}]`), called from the two `llm_turn` paths of
`apps/engine/lib/engine/sessions/engine_api_client.ex:591` and `:643`. It stays
as it is. The next activity, if the owner wants Haiku to obey `en` over
Portuguese input, is to test wording and persona language (the list above),
with this same script.

**Spend** (sum of each response's `usage.cost`, never the `/key` counter): US$
0.0980 for the four positions (20 calls) and US$ 0.0505 for the two controls
(10 calls) — **US$ 0.1485** of the US$ 0.20 ceiling, 30 calls, none failed.

To reproduce Part B (the key file holds `OPENROUTER_TEST_KEY=…`; it is never
printed; the output goes outside the checkout):

```bash
pnpm --filter @brabo/scripts idioma:diagnosticar \
  --arquivo-de-chave ~/.config/brabo/openrouter-test.env \
  --turnos 1 --rodadas 5 --teto-usd 0.13 --concorrencia 4          # the four positions
pnpm --filter @brabo/scripts idioma:diagnosticar \
  --arquivo-de-chave ~/.config/brabo/openrouter-test.env \
  --turnos 1 --rodadas 5 --posicoes ultima-system,sufixo-user --sem-clausula \
  --saida ~/.cache/brabo/validacao-idioma/<date>-diagnostico-haiku-sem-clausula \
  --teto-usd 0.06 --concorrencia 4                                  # the controls
pnpm --filter @brabo/scripts idioma:revisar                          # Part A tables
```

`--turnos N` and `--sem-clausula` exist only for this diagnosis; the product
never places the orientation anywhere but last, and `posicionar` in
`validacao.ts` is not used by it.

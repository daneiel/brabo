---
id: medicao-do-idioma
title: Measuring the language heuristic
description: The instrument that measures the AT-080 language-detection heuristic against a labeled corpus — synthetic in the repository, real only on the owner's machine — and the numbers it produced on the synthetic corpus.
---

# Measuring the language heuristic

> AT-160 (EP-028, HS-053). The heuristic being measured is the one the AT-080
> specification proposed ("A — own heuristic, no dependency"). The numbers here
> are what the AT-163 thresholds should come from; nothing in the product
> imports this code yet.

## What exists

Everything lives in `scripts/idioma/` and runs with the repository's Node (type
stripping, no build step). **No new dependency**: the heuristic is marker lists
and regular expressions, and the extraction talks to Postgres through `psql`
inside the database container.

| file | role |
|---|---|
| `heuristica.ts` | the AT-080 heuristic: cleaning, contrastive scoring, the candidate parameters, the 10-message sample and the hysteresis |
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

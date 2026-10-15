---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0132 — RAG accuracy golden-set, and the `rag-acertivo` gate

## Context

[ADR 0129](0129-telemetria-de-busca-do-rag-como-tabela.md) (Part 2, Stage 1)
gave the hybrid search a trace — `rag_searches`/`rag_feedback`, with the weights
FROZEN in the row — but deliberately **measured nothing**: it only
instrumented. `pnpm --filter api medir:rag` reads that trace per project, when
it exists. What was still missing is what `rag-search-limits.ts` itself keeps
declaring:

> NENHUM dos quatro números abaixo vem de calibração com dado real: não há,
> ainda, um corpo de perguntas reais rodado contra este índice.

This is Stage 2 of the same program — the second of five, in the order the
product owner set. It calibrates nothing (that is a separate product decision,
Stage 5, with its own give-up criterion); it provides the **body of questions**
that Stage 1 left as a gap.

### The mold already exists, and it is ADR 0123

The regression golden-set of the QA Automation's SEMANTIC judgment
([ADR 0123](0123-golden-set-regressao-qa-automacao.md)) solved an adjacent
problem — "how to measure the reliability of something non-deterministic,
without CI, with a ratchet floor" — and the decision here is to **reuse the
whole structure**, not invent the same reasoning a second time:

| piece | ADR 0123 (QA) | this ADR (RAG) |
|---|---|---|
| alias | `mix.exs` `"golden_set.qa"` | `"golden_set.rag"` |
| permanent exclusion | `test_helper.exs` `:golden_set_qa` | `:golden_set_rag` |
| ExUnit test | `test/engine/gates/qa_automacao_agent_golden_test.exs` | `test/engine/rag/rag_golden_test.exs` |
| ratchet floor | `test/fixtures/golden_set_qa/floor.json` | `test/fixtures/golden_set_rag/floor.json` |
| seed | `apps/api/scripts/seed-golden-set-qa.ts` | `apps/api/scripts/seed-golden-set-rag.ts` |

Permanent exclusion by TAG (never detection of "Ollama reachable") holds for
the SAME reason as on the QA side: this development machine already has Ollama
up all the time, and automatic inclusion would make the module fire inside ANY
`mix test`, spending tokens without warning.

### Where the mold does NOT fit — and why that is not a deviation

The QA golden-set tests the judgment of a **chat LLM**, called through
`Engine.Gates.QaAutomacaoAgent.run/5`. RAG has no LLM judgment at all on the
measured path — the whole hybrid search (embedding + `ts_rank` + weighted
fusion + threshold cut) runs inside the **api** (`HybridSearchUseCase`), not
the engine. Reimplementing the search in Elixir just for this test would test a
SECOND implementation, never the real one — the same error ADR 0123 avoided by
using the real LLM client instead of simulating the judgment.

The solution: `seed-golden-set-rag.ts` does BOTH things — provisions **and**
searches —, returning the result ready; `rag_golden_test.exs` only invokes the
script (via `System.cmd`, same mechanism as the QA side) and applies the floor
over the JSON that comes back. The role of the Elixir side is not "to run the
search", it is "to be the single point of `mix test --only`/permanent
exclusion/ratchet floor" — the same golden-set discipline the rest of the
product already uses, applied to a mechanism that happens to live entirely on
the other side of the api↔engine boundary.

### The questions: composed, not extracted — and that is said, not hidden

The original request asked for REAL questions from dogfooding. Checked before
writing this ADR: `gh issue list --repo daneiel/brabo --state all` returns
"No Issues" — it is a solo project, with no history of a question formulated by
someone using the product, in an issue or PR (PR titles are all
`tipo(escopo): o que mudou`, never a question).

The 17 questions in `seed-golden-set-rag.ts` are therefore **composed** from
REAL RNs and ADRs of this repository — never invented without grounding. Each
one has an `expectedPath` that is the real file where the answer lives, and the
composition was verified by directly reading the target file before writing the
question (not by title/grep). It is the route the request itself foresaw for
the case of there being no genuine corpus, and pretending they are "real" would
be worse than declaring the composition.

### The indexed corpus is real, curated, not synthetic

Unlike QA (whose code skeleton is synthetic, purposely designed for each case),
the RAG golden-set corpus is a REAL SUBSET of `docs/` from this very monorepo —
22 files (`ARQUIVOS_CURADOS` in the seed), copied verbatim into the seeded
project's repository, indexed by the SAME `IndexProjectDocsUseCase` any real
project uses. Curated, not the whole tree (the real tree has more than 130
ADRs) — because of embedding cost in a manual run: searching among a few
hundred chunks already exercises vector+lexical fusion just like searching
among thousands, and reindexing more than a hundred ADRs on every manual run
would multiply the time without improving what the golden-set measures.

### A single project, not one per case

The QA golden-set provisions one repository per CASE, because each case tests
a different business rule over DIFFERENT code — isolation is essential. The 17
RAG cases are 17 questions over the SAME documentation corpus: splitting into
17 projects would index the same content 17 times (17x the embedding cost) to
isolate searches that are already, by nature, read-only and free of side effects
among themselves.

### `execution_mode: 'runner'`, not the default `container`

`ReadProjectCodeUseCase.portaoDoContainer` (RN-105) refuses with 409 any read
of a `container` project until the Arquiteto decides an image —
`IndexProjectDocsUseCase` calls that path to sweep `docs/`. The golden-set
never triggers the Arquiteto (there is no execution at all to justify it, only
documentation indexing), so the seed inserts the project with
`execution_mode: 'runner'` — RN-169/RN-421 exempt `mounted`/`runner` from the
whole gate, and it is exactly for this kind of case: a project without its own
container has no reason to wait for an image decision to have its code read.
The CHECK `projects_workspace_path_casa_com_modo` requires a non-null
`workspace_path` for `execution_mode <> 'container'` — the seed writes a
synthetic path (never used: no real runner connects to this project).

### The accuracy criterion: file path, top-K, never rank 1

The expected hit is the **file path**, never the exact chunk — the same loose
rule as ADR 0123 adapted to RAG: pinning the chunk would break the golden-set
at every chunking adjustment, which is precisely the parameter this program
exists to be able to revise without rewriting the cases.

`GOLDEN_SET_RAG_TOP_K = 5`, and not rank 1: that is how the product actually
uses the result — the RAG Chat cites SEVERAL chunks next to an answer
(`RagCitationCard`, plural), not just the first. Measuring against rank 1 would
measure a question the UI does not ask. `5` is also not the same
`RAG_SEARCH_RESULT_LIMIT` (10) the real route uses by default — asking for 10
and measuring against 10 would test a looser k than most real searches use (the
RAG Chat panel does not scroll to see the 10). The criterion lives in
`apps/api/src/domain/rag/golden-set-criterio.ts`, pure and tested
(`golden-set-criterio.spec.ts`), for the same reason as `gate-registry.ts`: the
decision "this matched" should not depend on how the result arrived.

### Telemetry: ON, on purpose

`HybridSearchUseCase` writes a row in `rag_searches` on every call, always —
there is no parameter to turn that off, and there should not be. The right
question is not "turn it off?", it is "does this pollute the real
measurement?": no. `medir:rag` requires `--projeto <uuid>` (it never aggregates
globally, see the script's own header), and the golden-set always creates a NEW
project with a timestamp suffix — the rows it writes never appear in
`medir:rag` of a real project, for the same reason the QA golden-set pollutes no
metric of a real project. And actually writing is what makes this golden-set
exercise the SAME code path the real RAG Chat uses.

### The `rag-acertivo` gate

```yaml
- id: rag-acertivo
  fluxo: transversal # o RAG serve todos os fluxos, como acao-aprovada
  dono: usuario
  entrada: [golden-set-rag]
  entregavel: taxa-de-acerto-acima-do-piso
  verificacao: script
  severidade: warn
  aprovacao_humana: false
  status: active
  evidencia:
    tipo: teste
    arquivo: apps/engine/test/engine/rag/rag_golden_test.exs
```

`fluxo: transversal` and `dono: usuario` are reused from the `acao-aprovada`
gate, on purpose — neither field is validated against an enum
(`apps/api/src/domain/gates/gate-registry.ts`), and inventing a new
single-member category (`instrumentos`/`medicao`) would pass the validator
without meaning anything. If a `medicao` owner is ever desired, it already
exists as a ROLE in `docs/fluxo.yml` (`camada_instrumentos`), and introducing it
is a separate decision, not a side effect of this gate.

`evidencia.tipo: teste`, and not `event_log` — what proves this gate is the
golden-set itself, not an event in the log (there is no `proposed_action` nor
domain event associated with a golden-set pass). Precedent: `merge-protegida`
already uses `tipo: teste` for the same reason — the guarantee does not come
from the event log.

`severidade: warn` is MANDATORY, not stylistic: RN-070 requires
`verificacao: script` for `block` (which this gate HAS), but the warn decision
comes from elsewhere — there is no CI with an LLM (same decision already
recorded for the QA golden-set), so the gate runs MANUALLY, and promising
`block` would describe an automatic lock that does not exist.
`docs/explanation/gates.md` gains the fifth worked example of "why warn",
following the same argumentative structure as the previous four
(`necessidade-validada`, `workspace-verificado`, `implementavel`,
`paralelismo-autorizado`).

`entrada: [golden-set-rag]` is not a reference to another gate — the
validator's heuristic (`entrada` ending in `-verificada`/`-segura`) does not
match that name, so it does not trigger the orphan check. Confirmed by reading
`apps/api/src/domain/gates/gate-registry.ts` (`pareceGate`), not assumed.

## Decision

1. Copy the structure of ADR 0123 (alias, permanent exclusion, ExUnit test,
   ratchet floor per MODEL — here, EMBEDDING model —, external seed via
   `System.cmd`) to the RAG domain, with the two adaptations the domain
   requires: the seed runs the search (not just provisions, because the
   judgment lives entirely on the api side) and the corpus is real and curated
   (not synthetic).
2. `apps/api/src/domain/rag/golden-set-criterio.ts` — pure, tested — defines
   the accuracy criterion (file path, top-5, never exact chunk/rank 1) and is
   consumed both by the seed and by any future debugging call.
3. `docs/gates.yml` gains `rag-acertivo`, `warn`, `status: active`,
   `evidencia.tipo: teste` pointing to the ExUnit test.
4. `floor.json` keyed by the EMBEDDING model (`RAG_EMBEDDING_MODEL`, today
   `nomic-embed-text` — the only one the product supports, RN-222), count and
   `of`, never a percentage, written only by a human.

## Consequences

**CI wiring is `TODO(humano)`, same as QA.** Without an API LLM secret or new
infra (real Ollama in CI), the golden-set runs MANUALLY — `mix golden_set.rag`
— and never in a normal `mix test`.

**The 17 questions measure retrieval over a 22-file corpus, not the 130+ real
ADRs.** A golden-set against the full corpus would measure a more realistic
difficulty distribution (more plausible distractors, more chance of two files
covering the same question) — an embedding-cost decision in a manual run,
revisable if the real run shows an artificially easy ceiling.

**The golden-set measures RETRIEVAL, not ANSWER.** It never calls a chat LLM to
synthesize an answer from the hits — it only measures whether the right path
appeared among the candidates. It is the metric Stage 1 (`medir:rag`) also uses
(`precision@k`, rank distribution), so the two instruments speak the same
language.

**About the real run and what the floor records:** see
`test/fixtures/golden_set_rag/floor.json` for the `_comment` with the measured
result (or the statement that the measurement was left pending a human run, if
this session's environment did not allow running against real Ollama).

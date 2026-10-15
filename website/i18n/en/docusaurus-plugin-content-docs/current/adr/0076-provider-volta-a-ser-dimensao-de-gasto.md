# ADR 0076 — `provider` becomes a spend dimension again, and containment moves to the type

- **Status:** accepted
- **Date:** 2026-08-14
- **Revises:** [ADR 0063](0063-duas-audiencias-para-o-mesmo-gasto.md) (the two
  audiences for the same spend), which excluded `provider` from the
  dimensions on principle
- **Prior context:** [RN-058](../business-rules/custo.md#rn-058) (the key an agent
  spends is the workspace owner's), [RN-060](../business-rules/custo.md#rn-060)
  (the key spend report belongs to the owner, and only them) and
  [RN-101](../business-rules/custo.md#rn-101) (the two audiences)

## Context

[ADR 0063](0063-duas-audiencias-para-o-mesmo-gasto.md) left `provider` out
of `sumGroupedBy`'s dimensions with an unqualified sentence: *"the absence is
structural, not an oversight: breaking spend down by provider means breaking
it down by CREDENTIAL, and that's what keeps the member's view from gaining
that axis by carelessness — there is no argument to pass"*. The type carried
the same warning in a comment: *"The five slices of the spend report. None
of them is provider."*

The product owner decided to **reopen the dimension**, aware of the
consequence. This ADR does not exist to say the 0063 was wrong — its
argument still holds, and it's precisely because of it that reopening needs
to come with the containment spelled out.

What the 2026-08-09 decision didn't separate, and usage asked for:

- **the owner can't see, over the sliding window, where the money went.**
  `credential-spend` answers by provider, but in CALENDAR MONTHS and tied to
  the credential that exists today. Asking "in these last 30 days, how much
  was OpenRouter and how much was Anthropic" meant reading two reports with
  different windows and adding them up by hand;
- **person and agent showed up in the same ranking.** The `porAtor` list
  mixes the two, distinguished only by one field, and the design handoff
  calls for two separate blocks.

## Decision

**`provider` becomes a `SpendDimension` again, and the owner's report gains
`porProvider`** ([RN-186](../business-rules/custo.md#rn-186)). The axis lives on a
route that already required `owner` — the same rule as RN-060 — and the
member gains no field at all. `credential-spend` stays **untouched**: it
answers the invoice by month, tied to the key that exists today
(`temCredencial`), and the new axis answers spend by provider WITHIN the
window, alongside model, project and actor. It isn't a slice of the other,
by the same criterion the 0063 used to separate the two audiences.

**The privacy containment changes shape, not strength: the TYPE now does the
containing** ([RN-187](../business-rules/custo.md#rn-187)). `sumGroupedBy` has two
overloads, and what separates them is the scope:

```ts
abstract sumGroupedBy(d: SpendDimensionDoAtor, e: SpendScopeDeAtor): Promise<SpendBucket[]>;
abstract sumGroupedBy(d: SpendDimension,       e: SpendScopeAmplo): Promise<SpendBucket[]>;

export type SpendDimensionDoAtor = Exclude<SpendDimension, 'provider'>;
```

A scope that carries `actor` — the member's view, and the only scope it has
— accepts only `SpendDimensionDoAtor`. `sumGroupedBy('provider',
escopoComAtor)` **does not compile**. The two scopes are mutually exclusive
by construction (`SpendScopeAmplo` declares `actor?: undefined`), so the
right overload gets picked without anyone having to say which.

**No `if` over this combination**, neither in the repository nor in the use
case, and the absence is deliberate: a runtime check would give the
impression the guarantee is dynamic, when what actually sustains it is the
compiler — and an `if` is exactly what the next refactor removes without
leaving a single red test. It's the same reasoning as RN-153/154, where
resolving the "auto mode" lives in the repository and `decide.ts` didn't
gain a single line: a guarantee by construction beats a guarantee by
vigilance.

**`Exclude` instead of a second hand-written list.** A new dimension is born
reachable by both audiences, and removing it from the member's reach becomes
an explicit act **at that one point** — never an oversight in another file.
The alternative (two independent lists) has a known failure mode: the
restricted list ages quietly.

**Person and agent become two blocks, derived and not separately queried**
([RN-188](../business-rules/custo.md#rn-188)). `porOwner` and `porAgente` are a
partition of `porAtor` by `actor_kind`, done in the use case; `porAtor`
remains whole for whoever already consumed it. The 0063 measured that the
cost of these queries scales with the size of `token_usage`, not with the
size of the request — scanning the window twice more to separate what's
already separate in memory would be expensive for the wrong reason.

**The index on `token_usage(created_at)` lands now** (migration `0044`). The
0063 measured it and left it on record: at 525 thousand rows, 55 ms and 38
ms per *seq scan*, 32 ms and 19 ms with the index. All that was missing was
the migration slot.

**The `model` dimension does not change.** Two providers serving the same
model name still land on a single line. Now there's a per-provider list
alongside it; crossing the two dimensions would multiply the ranking's rows
without answering a question the two separate lists don't already answer.

## Consequences

**The 0063's strongest sentence no longer holds, and it's honest to say
which one.** "There is no argument to pass" was a surface-of-API guarantee:
no signature accepted the word `provider`. Today one does, and the guarantee
depends on the caller on the member's side being typed as
`SpendScopeDeAtor`. It is — `GetMySpendUseCase` declares the type
explicitly, rather than inferring it, for that exact reason — but the
difference is real: we went from "impossible to express" to "impossible to
compile". The second is weaker than the first, and it's the price accepted
by the product owner's decision.

**What holds that price down are two independent barriers.** The member's
route **has no dimension parameter** (`projectId` and `dias`, and nothing
else), so `?dimensao=provider` gets dropped by Nest before the handler even
exists. The first barrier already sufficed; the second exists so it keeps
sufficing after the next change. Both have tests, and the type one is a
`@ts-expect-error` — if the barrier falls, `tsc` fails the line for an
UNUSED directive, instead of the test passing while testing nothing.

**Who can see credentials hasn't changed.** `owner` on the two routes that
talk about provider; `viewer` on the member's, which doesn't. The
classification in `docs/security-surface.md` is the same — no route was
born, none changed roles — which is why the new axis doesn't loosen the
exposed surface.

**"By owner" is the handoff's label, and the block is about PEOPLE.**
`porOwner` brings every line with `actor_kind = 'user'`, not only the
workspace owner's; the label holds because, per RN-058, it's the owner's key
that all of them spend. Who the owner is remains the `ownerId` field. If a
per-person credential ever exists, this block needs a new name — and the
same goes for RN-101 as a whole, as the 0063 already anticipated.

**An `actor_kind` that is neither person nor agent stays out of both
blocks.** Today that's only `system`, which stays in `porAtor` and in the
total. Opening a third block would claim an audience the product doesn't
have; hiding it from the total would misstate the spend.

**Left out, declared:** the SCREEN. This change is backend-only —
`porProvider`, `porOwner` and `porAgente` reach the client through the types
in `apps/web/src/lib`, and no component renders them yet. Still out, from
0063: currency and exchange rate, spend by area, and any export.

# 0040 — Dashboard currency: USD for now, manual per-workspace exchange rate deferred

## Context

Making the projects dashboard faithful to the approved mock
(`design/SCREENS.md`, `design/COMPONENTS.md`) required the summary line and
the card's compact `TokenMeter` to show spend and balance — something the
`compact` `TokenMeter` variant didn't even have until now (the variant
existed only with the bar/percentage, with no cost footer at all).

The base mock shows the `"R$ X · US$ Y"` pair everywhere cost appears — it's
the pattern of the `default`/`live` `TokenMeter`, used today in
`ProjectPage.tsx` (project header) and `SessionPage.tsx` (chat topbar). But
there's no exchange-rate source anywhere in the system: `costBRL` always
arrived as `0` on the dashboard side (`ProjectCardContainer` in
`Dashboard.tsx` never computed a real value for it), and there's no
per-workspace currency preference or configurable conversion rate anywhere
in the domain. The "R$" that showed up was, in practice, always zero — a
ghost value.

## Decision

1. **The dashboard's summary line and the new `compact` `TokenMeter`
   footer show USD only.** It's the source currency: model prices in
   `apps/api/src/domain/llm/` (the seed's `MODEL_SEEDS`, the `models`
   table) are natively micro-USD — there's no conversion involved at all,
   just formatting (`apps/web/src/lib/currency.ts`, `usdFmt`).
2. **The divergence is ISOLATED to this surface.** The `default`
   `TokenMeter` (project header) and `live` (session topbar) keep showing
   `"R$ X · US$ Y"` exactly as they do today — untouched. The currency
   change is scoped to the dashboard card and the summary line, not the
   whole component.
3. **Per-workspace currency preference, with an editable manual exchange
   rate, is RECORDED and DEFERRED.** Not implemented in this delivery.
   When it exists, the natural design is a field on `workspaces` (or its
   own table) with `currency` + `manualExchangeRate`, resolved during
   formatting on either the backend or the client side — but committing to
   that shape now, without a second use case putting pressure on the
   design, would be guessing.

## Consequences

- The ghost `"R$ 0,00"` that used to show up on the dashboard card is gone
  — the value left (USD) is the only one the system actually knows how to
  compute today.
- Whoever wants to see cost in R$ can still do so in the project header and
  the chat (`default`/`live`), just not on the listing card or the summary.
- Manual per-workspace exchange rate is real work, not closed by this ADR:
  whoever needs it, this document is the starting point, not a decision
  made from scratch.

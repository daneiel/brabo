# ADR 0063 — Two audiences for the same spend: the owner's bill and the member's consumption

- **Status:** accepted
- **Date:** 2026-08-09
- **Prior context:** [ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
  (the price frozen into `token_usage`, which is what makes any report
  reproducible), [RN-058](../business-rules.md#rn-058) (the key an agent
  spends is the owner's) and [RN-060](../business-rules.md#rn-060) (spend on
  those keys belongs to the owner, and only they see it)

## Context

The request was a spend-summary tab, in the spirit of OpenRouter's *activity*
screen, but talking about this product's providers, owner and agents. The
decision of who sees what came along with it and is the user's: **the owner
sees the whole workspace; the member sees only their own consumption.**

The data was never the problem. `token_usage` has had everything in columns
since Phase 9 — provider, model, actor, tokens, cost, binding origin,
latency, and the price that produced the cost, frozen at call time by
[ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md).
What was missing were the **aggregations**: five existed, all by agent or by
provider×month, and none by model, by project within the workspace, by
session, or by person.

The difficulty lies elsewhere, and it's a collision between two rules the
product already had:

- by **RN-058**, the LLM key any agent spends is the **workspace owner's**.
  A member running an agent spends someone else's credential;
- by **RN-060**, the report of that spend belongs to the owner **and only
  them**, with `@RequireRole('owner')` on the route. Not `maintainer`: the
  owner's bill isn't the business of whoever operates a project.

Together, they make "how much did I spend" literally a request for a slice of
someone else's bill. Two easy paths existed, and both are wrong:

1. **opening the credential report to the member**, filtering their rows.
   That revokes RN-060 through the back door — the response would still talk
   about provider and key, which is exactly what the rule reserves for the
   owner, and the member would just need to sum the rows to reconstruct the
   bill;
2. **showing the member nothing**. Also wrong, and for a practical reason:
   their consumption exists, it's recorded under their name in
   `token_usage`, and the one person who couldn't see it would be precisely
   them.

## Decision

**The two audiences get different reports because they ask different
questions. Neither one is a slice of the other.**

**RN-060 continues to govern the report BY CREDENTIAL.** `GET
/workspaces/:id/credential-spend`, `GetCredentialSpendUseCase` and
`CredentialSpendSection` stay as they are: grouped by **provider**, the
unit the key belongs to, requiring `owner`, and answering the **bill**
question — "how much came out of my OpenRouter key this month". The new tab
**reuses it whole** instead of rewriting it.

**The member's view is by ACTOR**, in tokens and **estimated** cost, and it
**never breaks down by provider or credential**. `GET
/projects/:id/spend/me` returns the caller's own consumption, by session and
by day, within a project. The actor comes from the **authenticated token**,
and the use case exposes no way to ask for another one: there's no
parameter where you can write someone else's id. "A member doesn't see
another actor's row" is a property of the signature, not a check someone
could forget to call.

**Agents don't enter the member's account.** `token_usage` records **who
spent**, not who told it to spend; attributing an agent to whoever started
it would be inventing data the table doesn't have. What the agents spend
shows up in the owner's report, since the key belongs to them.

**The provider axis doesn't exist in the new aggregation.** The five new
dimensions (`model`, `project`, `actor`, `session`, `day`) live in a single
repository method, `sumGroupedBy(dimension, scope)`, and `provider` is
**not one of them**. The absence is structural, not an oversight: breaking
down spend by provider is breaking it down by credential, and this is what
keeps the member's view from gaining that axis by accident — there's no
argument to pass. For the same reason, two providers serving the **same
model name** collapse into a single row in the `model` dimension: telling
them apart would reintroduce the credential axis under another name.

**The owner sees both things** — the workspace breakdown by model, project,
actor and day, and the credential bill right below it — because they're the
only person who can see both. The screen never fires the owner route
without the role: triggering a 403 on purpose is noise in the security log.

**No charting library.** There are two shapes, one series each: bars per day
(discrete magnitude — a line would suggest continuous spend between two
days, which doesn't exist) and horizontal ranking bars. `<rect>` and
`<span>` in inline SVG and CSS cover it, and a charting dependency here would
be runtime weight for a geometry that fits in ten lines. The daily series
comes **dense** from the api: a day with no spend enters as zero, otherwise
three calls across three weeks turn into three adjacent bars,
indistinguishable from three consecutive days of use.

## Consequences

**The member's question stays declaredly incomplete, and that's the right
price.** They see their own chat and don't see the agents they ran. As long
as the key belongs to the owner (RN-058), any "agent" number shown to the
member would be someone else's spend with their name on top. If the product
ever gets per-person credentials, this decision needs revisiting — and it
will be through a new ADR, not by editing this one.

**These are two routes, not one branching by role.** A single endpoint that
changed shape depending on who calls it would be two contracts under one
name, and the surface test (`docs/security-surface.md`) would classify a
single route with the most permissive role — losing exactly the distinction
this ADR exists to maintain.

**The `model` dimension mixes providers.** Whoever wants to know which
provider served a model doesn't find out here, on purpose.
`upstream_provider` stays in the table for anyone who needs to investigate
case by case.

**No migration, and no index — yet.** `token_usage` only has the PK, and
both queries do a *seq scan*. Measured with 525,000 rows in the isolated
test database: the workspace report comes back in **55 ms** and the
member's in **38 ms**. With an index on `token_usage(created_at)` the same
plans turn into a *bitmap heap scan* and drop to **32 ms** and **19 ms**.
The gain is real and the index is cheap, but this wave's migration slot
belongs to another phase; it goes in later, with the measurement already
done and recorded here. What changes the cost is volume: both queries read
the entire window, and the cost grows with the size of `token_usage`, not
with the size of the request.

**The window is sliding and capped (180 days, default 30).** A report
without a cap would be an invitation to scan the whole table via query
string, and the lesson of the `429` that turned into a blank screen
(RN-088/RN-090) is too recent to ignore.

**The cost shown to the member is estimated, and the screen says so.** It
comes from the price frozen at call time (ADR 0042), which is the best
number available — but the bill that reaches the owner comes from the
provider, and we never promise the two match to the cent.

**Left out, declared:** currency and exchange rate (backlog, and converting
with a made-up rate would be worse than an honest dollar amount), spend by
area (cut since ADR 0038 — real caps stay at project, session and task) and
any export. The tab **reads**: there's no write verb in it, and it's the
absence of a verb that makes that boundary verifiable.

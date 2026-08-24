# ADR 0078 — Screen frame, and the tab registry diverges from the handoff on purpose

- **Status:** accepted
- **Date:** 2026-08-15
- **Prior context:** [RN-048](../business-rules.md#rn-048)
  (pending story promotion), [RN-104](../business-rules.md#rn-104) (Chat and
  Creative as places, with the `sessions` key), [RN-121](../business-rules.md#rn-121)
  (Executors tab, dev agent and QA kept out of the mixed "agent team"),
  [ADR 0075](0075-embeddings-no-contrato-de-llm-provider.md) (embeddings in
  the `LLMProvider` contract — foundation with no consumer yet)

## Context

The "screen frame" checklist from the design handoff
(`design_handoff_brabo/CHECKLIST-CONFRONTO.md`, section 2) describes the band
that wraps every project screen: 60px header, tab strip right below it, the
active tab with `box-shadow: inset 0 -2px 0 var(--accent)`, horizontal
scrolling on narrow screens, and a content container capped at 960–1040px.
`ProjectPage.tsx`'s code had all four defects: a header with variable padding
instead of a fixed height, an active tab using `border-bottom` (not
`box-shadow`), no declared horizontal scroll, and no width cap on the content
container.

Fixing the four is the essential part of this ADR, but the piece that needs
a decision — not just CSS — is another one: **the handoff lists 7 tabs**
(Overview, Creative, Code, Chat RAG, Spend, Approvals, Settings) and **the
registry (`apps/web/src/routes/project-tabs.ts`) has 10**. The three extra
ones are `executores`, `backlog` and `insights`.

The handoff is from an earlier wave of PROGRAM 16–26. Between the wave that
designed it and today, three things happened it couldn't have anticipated:

1. **Executors** was born in PHASE 27 (RN-121) when the agent grid moved out
   of the Overview into its own tab — real data (live status, bound model,
   autonomy toggle), not a mockup.
2. **Backlog** has had its own counter for stories awaiting user promotion
   since Phase 12c (RN-048) — another decision queue, with a business rule
   and a test covering exactly what it chimes and when.
3. **Insights** shows the Psychologist's hypotheses waiting to be
   accepted/discarded — the project's third decision queue, existing since
   before the handoff was written.

None of the three is redundant with the handoff's 7, and none is decoration:
all of them have real data, a counter derived from a query, and at least one
business rule with a test of its own. Deleting them to "match" the handoff
would destroy information the product already knew how to show.

## Decision

**The 10 tabs stay. The handoff is a reference for VISUAL fidelity —
colors, typography, spacing, the frame's design — not a ceiling on how many
tabs the product can have** (RN-203). It fixes how each screen should LOOK;
it doesn't freeze the feature inventory on the day it was written. The rule
already held implicitly (PHASE 26 registered the Code tab without the
handoff ever picturing "Executors" or "Insights" as separate tabs, and no
one considered removing them for that) — this ADR just makes it explicit,
with a test that fails if someone "tidies up" the registry against the
handoff without reading this decision.

**The `sessions` key stays labeled "Chat", never "Chat RAG"** (RN-202). The
handoff calls this tab "Chat RAG" in its more recent screens
(`designs/Brabo Chat.dc.html`), and the obvious temptation would be to just
swap the label string. The rejection is literal: "Chat RAG" describes a
FEATURE — embedding-based lookup over an indexed repository, with source
citation — that the product doesn't have. ADR 0075 put `embed` in the
`LLMProvider` contract (capability proven only on Ollama), but nothing yet
CONSUMES that operation: no indexing pipeline, no per-project vector index,
no citation UI. Today's `sessions` tab is plain CONSULTATIVE Chat (RN-104) —
an agent answering with the session's context, same as the Creative agent,
just without producing a backlog. Labeling it "Chat RAG" today would be the
same lie ADR 0042 rejects for the model catalog: announcing a capability
before it exists, just because the name is already reserved in the design.

**The four literal moldura fixes, with no declared exception:**

1. **Header as a floor, not a ceiling.** `.headerTop` (the project identity
   header — provider icon, name, repo chip, branch/adopted — and the compact
   `TokenMeter`) got `min-height: var(--header-h)` (60px), not `height`.
   This band's content is richer than the generic header the handoff draws
   for its 6 internal screens (18/600 title + mono subtitle + chip +
   indicator): the `TokenMeter` card alone, with its own internal padding,
   already adds up to about 70px. Forcing 60px would cut off the budget
   alert — and RN-088 already established that failure/state states never
   go invisible; cutting the budget for the sake of aesthetics would be the
   same class of error under a different name. `min-height` honors the
   token as a FLOOR — when the content is simpler (no `TokenMeter`, say,
   while loading), the band sits near 60px; when it isn't, it grows,
   visibly.
2. **Active tab with `box-shadow: inset 0 -2px 0 var(--accent)`**, not
   `border-bottom`, in `Tabs.module.css`. The visual difference between the
   two is small, but `border-bottom` shifts the layout by 2px on state
   change (the border takes up space even transparent-vs-solid when poorly
   implemented) and the handoff is explicit about the attribute. The
   spacing values (`gap: 2px`, `padding: 11px 13px`) that lived as a
   descendant CSS override in `ProjectPage.module.css` — a declared pending
   item since PHASE 16 ("when it can move, this is where it belongs") —
   migrated to the primitive, because this wave gave the same owner to both
   files.
3. **Horizontal scrolling** (`overflow-x: auto` on `.list`, `flex-shrink: 0`
   and `white-space: nowrap` on `.tab`) — didn't exist; the strip would wrap
   or squeeze labels on narrow screens.
4. **Content container max width** — `.body` got `max-width: 1040px; margin:
   0 auto`, for the document-shaped tabs (Backlog, Approvals, Insights,
   Spend, Settings, Creative, Chat). Still uncapped on the `semRespiro` tabs
   (Overview, Code): the first has its own side rail, and the second is "the
   most expensive tab in the program" in the handoff's own words — both use
   the full screen on purpose.

**The "Code" label became "Código".** No other point in the code compares by
the label STRING (confirmed by grep); the registry KEY and the deep-link key
remain `code`, untouched.

## Consequences

**The tab registry ends up, deliberately, bigger than the handoff's original
intent — and each extra item has its own RN and test cited in this ADR.**
Anyone reading only the handoff and comparing it to the code will see a
divergence; anyone reading this ADR understands it's chosen, not forgotten.

**No export SHAPE changed.** `AbaDoProjeto` still has the same fields
(`key`, `label`, `component`, `count?`, `ordem`, `semRespiro?`), and
`ABAS_DO_PROJETO` remains the ordered array other consumers (the navigation
shell's front B, running in parallel in this same wave) read to list a
project's tabs in the sidebar — only `code`'s label VALUE changed, and the
key list neither lost nor gained anything.

**"Chat RAG" stays reserved, not cancelled.** When the indexing pipeline and
the citation UI exist, this registry's `sessions` tab is where the feature
lands — the name changes that day, with the data behind it. Renaming it
sooner would be the same class of error ADR 0042 already named for the
model: "activating" the appearance of a capability without the capability.

**Left out, declared:** the Code tab's rich branch dropdown, the blame UI,
and the PR list (PHASE 26b) are untouched by this ADR — moldura is about the
CONTOUR of screens, not the internal content of each one.

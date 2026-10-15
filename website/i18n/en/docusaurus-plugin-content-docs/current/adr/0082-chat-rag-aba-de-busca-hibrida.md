# 0082 — Chat RAG: its own hybrid-search tab, without renaming "Chat"

## Status

Accepted.

## Context

[ADR 0080](0080-busca-hibrida-pesos-limiar-e-citacao.md) (PROGRAM 28,
Wave 4, front G2) left the indexing pipeline and the three Chat RAG HTTP
routes ready — `POST .../rag/search`, `POST .../rag/reindex`,
`GET .../rag/coverage` — but explicitly declared the SCREEN as Wave 5
work. Meanwhile, [ADR 0078](0078-moldura-de-tela-e-o-registro-de-abas-diverge-do-handoff.md)
(RN-202) had decided the `sessions` tab would keep the label "Chat," never
"Chat RAG" as the more recent handoff asks — because, at that moment,
"Chat RAG" described a capability the product didn't have (no pipeline, no
citation UI). This front (Wave 5, G3) is the moment that capability starts
to genuinely exist, and the question it needs to answer is: now that RAG
exists, where does the "Chat RAG" label go?

Two options: rename `sessions` to "Chat RAG" (what the handoff literally
suggests), or give "Chat RAG" its OWN tab. The two screens answer
structurally different questions — `sessions` is conversation with an
ACTIVATED agent, which spends the owner's key per turn (RN-058) and can
write to the backlog, to the code, to any tool the agent has; RAG is
search over an already-built INDEX, with no agent in the middle, and
read-only by nature (the three ADR 0080 routes are `viewer`/`viewer`/
`maintainer`, none of them invokes a conversational LLM). Merging the two
into the same tab would force the UI to express "this is a citation from
an indexed chunk" and "this is an agent speaking" in the same thread, when
the user never asked for both at once.

## Decision

**"Chat RAG" becomes its own tab, `key: 'rag'`, without touching the
`sessions` label.** RN-202 remains valid as it was — `sessions` was never
"Chat RAG," and continues not being it — but its reasoning shifts from
"the capability doesn't exist" to "the capability exists somewhere ELSE."
The tab enters `apps/web/src/routes/project-tabs.ts` (`ordem: 28`, right
after `code` and before `backlog`) — the same neighborhood of "look at what
has already been produced/indexed" that the Code tab occupies, and before
Backlog, which is where new production is born.

**The screen consumes the three ADR 0080 contracts without guessing their
shape** (`apps/web/src/lib/api-client.ts`/`api-types.ts` gain `searchRag`/
`getRagCoverage`/`reindexRag` and the types mirrored 1:1 from the DTO —
`RagSearchHit`, `RagChunkOrigin` as a union discriminated by `kind`,
`RagCoverage`). The UI has three pieces:

1. `RagCoveragePanel` — REAL count of indexed `docs`/`adr`/sessions
   against the real total, and `chunksTotal`/`chunksWithoutVector`. No
   "reindexed Xmin ago": the backend response has not carried that data
   since ADR 0080, and this screen isn't the one to invent it (RN-252).
2. Search with a scope filter (`docs`/`adr`/`session` pills, absence =
   all) and a warning when `vectorAvailable: false` — "keyword-only
   search — embedding unavailable," with the reason when the backend
   provides it (RN-252, the same honest degradation as RN-233 reaching
   the UI).
3. `RagCitationCard` — the citation with combined score and the two
   separate signals (`null` when the signal didn't find the chunk, never
   0%, preserving ADR 0080's distinction). `file` origin shows path/
   `headingPath` as text; `session` origin navigates to the exact EVENT
   via `useNavigate` + `search: { highlightEvent }` — the SAME route and
   parameter the Psychologist's evidence chips already use
   (`HypothesisCard.tsx`, Phase 4b) — reuse, not a second navigation path
   (RN-253).

**The "Reindex now" button only appears for `owner`/`maintainer`**,
mirroring on the client the rule the route already enforces (RN-238) —
same pattern as `useCurrentWorkspaceWithRole` that `ProjectSettingsTab`/
`ProjectApprovalsTab` already use for other `maintainer` gates (RN-254).
Whoever doesn't have the role simply doesn't see the button, rather than
seeing it disabled: reindexing triggers N calls to the project's repository
and to the embedding provider, the same "changes what the product spends
without asking" rule as the area parallelism cap (RN-083).

## Consequences

**The promise RN-202 had deferred arrives, but not the way the handoff
designed it.** The handoff renames an existing tab; the product opens a
new one. It's the more defensible decision given the two screens never
answered the same question — and the cost of being wrong (one extra tab in
the registry) is lower than the cost of mixing conversation-with-agent and
search-over-index in the same surface.

**No deep-link by path to the Code tab.** A `file`-origin citation shows
`sourcePath`/`headingPath` as plain text, without navigating — the Code
tab (PHASE 26/26b) has no mechanism today to open a specific file via
route/`search`, and building that mechanism is out of scope for this
front. It stays declared, not half-implemented: the text shows the real
path, it just isn't clickable.

**The `maintainer` gate on the client is UX only.** What guarantees
`reindex` doesn't run without the role remains the api (`RequireRole`,
RN-238) — the screen only avoids the click the api would refuse anyway.
This follows the same pattern as every other UI gate in the product (auto
mode, parallelism cap, area model): none of them replaces the server-side
check.

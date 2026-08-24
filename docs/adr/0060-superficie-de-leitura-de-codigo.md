# ADR 0060 — The code-reading surface, contained and budgeted

- **Status:** accepted
- **Date:** 2026-08-08
- **Prior context:** [ADR 0001](0001-git-provider-contract-shape.md) (the
  normalized git contract and what enters it), [ADR 0058](0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md)
  (the central path containment, RN-092), [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md)
  (the scope primitives this containment reuses)

## Context

PHASE 26a added `listTree` and `getPullRequestDiff` to the
`GitProviderContract`, proven across the three providers by the single
suite. What was missing was the consumer — and the guard 26a itself
installed (`NO_CONSUMER_YET`) would fail CI as long as it didn't exist.

The consumer is the Code tab, and writing it forced three decisions that no
prior code had made, because no route in the product up to this point had
received a **file path from the client**.

**The first is where search lives.** The tab needs four reads: tree,
content, search, and PR diff. Three are contract operations. Search is not
one of the three providers': GitHub and GitLab have platform-level code
search, with their own semantics and limits; `LocalGitProvider` is a bare
repo and has none of that. Declaring `search` in the contract would mean
either a 13th operation with capability `false` on local — a tab that works
on two providers and disappears on the third — or importing a platform's
code-search vocabulary into the normalized contract, which exists precisely
to keep the Octokit shape from leaking through.

**The second is cost.** Reading is cheap per call and expensive on
repetition. The tree and the diff already have a ceiling in the contract
(26a), but they limit ONE response; composite search makes N calls, and N
grows with repository size, not with request size. Who pays is the
workspace owner's credential
([RN-058](../business-rules.md#rn-058)/[RN-082](../business-rules.md#rn-082)),
and the rate limit is the provider's. The product has already seen this
family of defect up close: the dashboard was making 3,824 requests per
minute because every project requested its own (RN-090), and the resulting
`429` turned into a blank screen.

**The third is the path.** `../../etc/passwd` in a query string arrives at
the handler already decoded by Express. On `github`/`gitlab` that path
becomes a segment of the provider's API URL, so a `..` doesn't read the
wrong file: it **switches endpoints**, with the owner's token in hand. On
`local` it becomes the right-hand side of `git show <ref>:<path>`. It is the
same class of problem ADR 0058 closed for `projectId`, now applied to the
file path — and PHASE 14d already taught the failure mode worth avoiding:
testing the piece is not testing the path to it.

## Decision

**Search stays OUTSIDE the git contract, composed in the application layer,
with a budget.** `ReadProjectCodeUseCase` walks the tree breadth-first by
calling `listTree` and opens files with `getFileContent`. Three budgets stop
it — directories walked, files opened, matches returned — and `truncated`
says it stopped early. Breadth rather than depth because, cut off midway, it
delivers the shallowest files, which is where searchers usually look. A
short-TTL cache (30s), limited in entry count, keeps navigating and
searching from repeating the same calls; short because the tab reads a live
branch, and a long TTL would show code that has already changed.

**Path containment is ONE function, in the RN-092 file.**
`caminhoDeRepositorioContido()` anchors the client's path to the project
folder via `projectScopeRoot()` and reuses `normalizarCaminho`/`dentroDoEscopo`
from ADR 0055. It returns the **normalized** path, and the caller uses what
came back — returning the original would allow checking one string and
sending another to the provider. An absolute path is rejected even when the
name would exist inside the repository: reinterpreting the leading slash
would be a silent conversion. The `ref` is checked in the same place, and
`..` in it is rejected because for git `dev..main` is a commit range, not a
revision. No route validates a path on its own.

**The four routes are `GET`, `role:viewer`, and the controller has no write
verb.** Seeing a project's code is the same permission as seeing the
project. Reading does **not** become a `proposed_action`: it is not an
external effect, and turning it into an approval action would fill the
queue with noise until nobody reads the real ones anymore. The credential
used is the owner's, via the same resolver as writing.

## Consequences

**CodeQL will keep flagging, and that is the accepted price.** A barrier
that lives in another function it does not see — that's what made the three
`js/path-injection` alerts survive the POST-PHASE 15 fix, and the decision
back then was to keep the check central and pay for it in the dashboard. It
does not change here: duplicating the containment in each route would
silence the alert and create four copies that one day diverge. A new alert
from this path is dismissed with a written justification, never silently.

**Search is not GitHub's search, and it shouldn't pretend to be.** It does
not index, does not understand syntax, does not sort by relevance, and on a
large repository it CUTS OFF. The contract with the consumer is `truncated`
+ `filesScanned`: the screen says a cutoff happened and suggests narrowing
the `path`. Swapping this for platform code search is a future decision, and
it would have to resolve the `local` provider's asymmetry first.

**The cache is shared among everyone with access to the same project.** The
key carries no user, because whoever gets there already passed the route's
`role:viewer`, and the repository is the same for all of them. If reading
ever comes to depend on WHO reads, the key needs to gain that dimension —
it's written in the code because it's the kind of assumption that
disappears.

**The 30s window is visible lag.** A push made outside the product may take
up to half a minute to show up in the tab. Real invalidation would require
knowing when the repository changed, and the product has no such signal for
an external push; the short TTL is the honest choice until it exists.

**Declaredly left out:** syntax highlighting (a new dependency, item 35 of
the phase, a 26c decision), an interactive terminal (depends on the
per-project container from PHASE 25), and any write through the tab. When
writing comes, it is born a `proposed_action` — and the fact that this
controller has not a single write verb is what makes that boundary
verifiable, rather than merely an intention.

# ADR 0113 — Locally attached folder becomes `chunks.scope = 'local'`, read by the BROWSER, never a host path

## Status

Accepted.

References (without editing): [ADR 0072](0072-projeto-local-ou-container.md),
[ADR 0079](0079-tabela-de-chunks-vetor-e-tsvector-juntos.md),
[ADR 0080](0080-busca-hibrida-pesos-limiar-e-citacao.md),
[ADR 0107](0107-navegacao-de-pasta-local-via-o-runner.md),
[ADR 0108](0108-projeto-runner-nasce-ao-navegar-pasta-no-wizard.md).

## Context

### The request

Let a user attach a local folder from their own machine to a project as
READ-ONLY REFERENCE material for agents — explicitly WITHOUT running the
`brabo-runner` CLI (ADR 0103). This is NOT project execution or workspace:
`execution_mode: runner` (ADR 0104) exists precisely because execution needs
a real HOST path the container/engine can route commands to, confirmed by a
runner connecting and verifying it (RN-423). This feature is closer to
"attach files to a conversation" than to "mount a workspace."

### What ADR 0072 and ADR 0107 actually rejected, and why this is different

Both of those decisions are about resolving an absolute HOST PATH from the
browser. ADR 0072 rejected a folder *picker* at project creation because "a
picker would require the api to enumerate the CONTAINER's filesystem to the
browser" — new surface just for ergonomics, and a wrong-context filesystem
besides. ADR 0107 solved folder *navigation* by routing the read through the
Runner (a process with the user's own privileges on their own machine, not
the api) precisely because the api can never see the user's real filesystem.

Both are about WHERE A PATH ON THE USER'S DISK COMES FROM, and both matter
because a path feeds either project creation (`workspace_path`) or command
execution (`TerminalExecutor`'s `cwd`) — contexts where a WRONG path is a
security and correctness problem: it decides what an agent can execute
against.

This feature never resolves a host path. The browser's `<input
webkitdirectory>` returns `File` objects; the code reads their *content*
(`File.text()`) and their *relative* path within the chosen folder
(`File.webkitRelativePath`) — never an absolute path, because the browser
File API doesn't expose one, by design, for any website. What crosses the
network is TEXT the browser already had a legitimate right to read, exactly
the same trust model as any ordinary `<input type="file">` upload on any
site. There is no path to validate, sandbox, or route to a runner, because
there is no path at all. Building a runner-style relay for this would be
solving a problem this feature doesn't have.

### Why reuse the RAG pipeline instead of a parallel mechanism

The product already has a working chunking/embedding/hybrid-search pipeline
(ADR 0079/0080): the `chunks` table, `RagEmbeddingService`,
`chunkText`/`chunkMarkdownDocument`, `ChunkRepository.searchByVector`/
`searchByLexicalQuery`, and the Chat RAG tab's citation rendering
(`RagCitationCard`, `origemDoChunk`). A locally attached file is,
structurally, the same shape as an indexed doc/ADR file: a path plus
content that should be searchable and citable. Building a second,
parallel "attached files" store and a second citation UI would duplicate a
pipeline that already does exactly this job, for no reason other than the
source of the bytes being a browser upload instead of a git blob.

## Decision

**`chunks.scope` gains a fourth value, `'local'`**, added via `ALTER TYPE
... ADD VALUE` (migration `0052`) — additive, no data migration, no new
CHECK: the existing `chunks_session_id_casa_com_escopo`/
`chunks_source_path_casa_com_escopo` constraints (migration `0045`) are
already written as "is it `session` or not," so `local` falls on the same
side as `docs`/`adr` (has `source_path`, no `session_id`) with zero schema
change beyond the enum value.

**`IndexLocalFolderUseCase`** mirrors `IndexProjectDocsUseCase` closely:
chunk each file (Markdown-aware via `chunkMarkdownDocument` for `.md`/
`.mdx`, `chunkText` otherwise), call the same `RagEmbeddingService`, write
chunks with `embedding: null` on embedding failure (the same honesty
pattern `docs`/`adr` already use — RN-233), full `deleteByScope(projectId,
'local')` + recreate on every call. `origemDoChunk` needed ZERO changes:
`local` chunks carry `sourcePath` exactly like `docs`/`adr`, so they fall
into the existing `kind: 'file'` branch — the citation UI already handles
them.

**One-shot rejection, never silent truncation.** Unlike `docs`/`adr`
(a background scan with no user watching), attaching a folder is a single
user gesture with a folder picker in front of it. `IndexLocalFolderUseCase`
REJECTS (400) the whole upload when the aggregate caps are exceeded (file
count, summed bytes) — the person who clicked "Attach" is looking at the
screen and can pick a smaller folder. An individual oversized file or
unrecognized extension is only SKIPPED (`filesSkipped`), never fails the
batch — the same distinction `IndexProjectDocsUseCase` already makes
implicitly by filtering to `.md` only.

**Never wired into the generic "Reindex now."** `ReindexProjectUseCase`
re-reads from a source the SERVER can revisit — the project's repository
(`docs`/`adr`) and the event log (`session`). The `local` scope has no such
source: the text lives only in the browser of whoever attached it, and the
server never persisted a host path (there isn't one). Calling
`deleteByScope(projectId, 'local')` from the generic reindex button would
delete the user's attached reference material with no way to recreate it —
re-uploading the folder is the ONLY resync mechanism, and it is a
deliberately separate button (`POST .../rag/local`, `maintainer`, same role
as `reindex` because it also triggers the embedding provider and replaces
what's indexed). Both use cases carry an explicit code comment pointing at
each other and at this ADR, so a future "fix" doesn't wire them together and
silently delete users' reference material on an unrelated click.

**Coverage tells the truth about what `local` actually is.**
`RagCoverage.local` is a NEW shape (`RagLocalCoverage`), not a reuse of
`RagFileCoverage`: there is no "total files in repo" to compare against — a
browser upload has no repository to re-scan. It reports what's indexed NOW
(`filesIndexed`, `folderName`, `lastAttachedAt`). `lastAttachedAt` is the
ONE declared exception to the product's "never show a guessed timestamp"
rule (RN-237/ADR 0080): it's a real `MAX(chunks.created_at)` over the scope,
not a computed or estimated value — the same honesty discipline, applied to
a scope where a real timestamp happens to be answerable.

## What this ADR does NOT do

- **It doesn't touch `execution_mode`/`workspace_path`/the runner.** Those
  remain exactly what ADR 0072/0104/0107 describe: how a project's code
  EXECUTES. This feature adds reference material to the RAG index; it has
  no opinion about where a project's code lives or runs.
- **It doesn't add a fifth "attached files" concept.** No new table, no
  parallel citation format — `local` is a value of the same `ChunkScope`
  the rest of the pipeline already speaks.
- **It doesn't index the project's own repository a second time.** `docs`/
  `adr` continue being read from the project's git repository via
  `ReadProjectCodeUseCase`; `local` is deliberately a SEPARATE source, for
  material that has nothing to do with the project's own repo (a spec, a
  reference implementation, a competitor's docs, anything the user wants an
  agent to be able to search).

## Consequences

- **A second upload replaces the first, entirely.** There is no
  "append to what's attached" — `IndexLocalFolderUseCase` deletes the whole
  `local` scope before writing the new one. This is the SAME idempotent
  full-rebuild discipline `docs`/`adr`/`session` already follow (RN-231),
  applied consistently rather than invented specially for this scope.
- **Binary and oversized files are silently absent from search, declared
  via `filesSkipped`.** The extension allowlist (`RAG_LOCAL_ALLOWED_EXTENSIONS`)
  is a real content restriction, not just UX polish — the server enforces
  it independently of whatever the browser pre-filtered, because the
  client-side pre-filter is convenience, not the guarantee.
- **The trust boundary is exactly an ordinary file upload's.** No
  sandboxing, no path allowlist, no runner ticket — because there is no
  path in this feature at all, only bytes the browser already had.
  Anyone who can call `POST .../rag/local` (role `maintainer`) can put
  arbitrary text into the project's search index; that's the same
  authority the route already requires for `reindex`.

## Alternatives considered

- **Route the read through the Runner (ADR 0103/0107), like folder
  navigation.** Rejected: the Runner exists to give the ENGINE a real host
  path to execute commands against, on a machine the user has explicitly
  set up with the CLI. This feature is explicitly meant to work WITHOUT the
  CLI, for read-only reference material — routing it through the Runner
  would make the CLI a requirement this feature was designed not to have.
- **A new `attachments` table, independent of `chunks`.** Rejected: it
  would duplicate chunking, embedding, hybrid search and citation
  rendering for no benefit — the shape of "path + content, searchable,
  citable" is exactly what `chunks` already models.
- **Wire `local` into `ReindexProjectUseCase`.** Rejected: there is nothing
  server-side to re-read for this scope; wiring it in would make the
  generic reindex button silently delete users' attached reference
  material with no way to bring it back.

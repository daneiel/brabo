---
traducao_de: 1b6809016dba7f83632a49a7ee233407f72932c0
---

# 0148 — The agents' artifacts projected to files, in a `docs/` folder

## Context

Every artifact the agents produce — the Criativo's (Creative's) brief, the PO's
business rules, the Arquiteto's (Architect's) C4 diagram and module routing, the
decisions of the six conversational agents — lives **exclusively in the event
log**. `Engine.Harness.Tools.EmitArtifact`
(`apps/engine/lib/engine/harness/tools/emit_artifact.ex:3-5`) is explicit:
*"não há tabela de artefatos"*. The artifact IS the `artifact.<tipo>` event,
immutable, with an author and a `seq`.

That is the right decision for the SOURCE, and it is not touched here. The
problem is another: **that memory never reaches any place a person opens.** It
is readable through the session timeline, one line at a time, inside the
product. Whoever opens the project folder in the editor — which is where the
code will be — finds nothing of the reasoning that produced that code.

The hole got bigger with the decision to **defer git** (deferred provisioning,
in its own PR): between the project's creation and the Arquiteto's handoff to
the Dev Lead, the project exists without any repository. In that interval,
everything the product has accumulated about the project is in database rows,
and the user's folder is empty.

There is an exact precedent in the product to solve this, and it has already
been discussed and accepted: the **Neo4j graph**
([ADR 0099](0099-neo4j-grafo-de-conhecimento-e-templates.md)/[ADR 0101](0101-memoria-relacional-como-projecao-do-event-log.md)),
which is declaredly memory **derived** from the event log — never a source,
able to be discarded and rebuilt. `GraphProjector`
(`apps/api/src/application/graph-projection/graph-projector.ts`) drains
`outbox_events` under its own `aggregate_type` and writes to an external
destination, degrading without ever bringing down whoever feeds it.

The question of this decision is not *whether* the folder should exist — the
product owner asked, literally, *"criar apenas uma pasta por ora chamada docs,
onde os artefatos estarão de cada um dos agentes"*. It is **with what
mechanism**, and what that requires guaranteeing.

## Decision

**The `docs/` folder is a PROJECTION of the event log, in the same strict sense
ADR 0101 gave the graph.** The source remains the event; the folder can be
deleted entirely and rebuilt; and **nothing in the product reads from it** to
decide anything. It exists to be opened by a person.

Everything else follows from that.

### 1. The mechanism is that of `GraphProjector`, piece by piece

`ArtifactProjector`
(`apps/api/src/application/artifact-projection/artifact-projector.ts`) copies
the shape that already solved this problem: its own poller (`setInterval` with
`.unref()`, cleaned in `onModuleDestroy`), a public `drainOnce()` independent of
the timer (it is the tests' entry point), a `draining` flag against overlapping
cycles, a batch of 50, and `markProcessed` **only after success**.

It is not code reuse, it is **design** reuse — the two projectors write to
destinations with nothing in common. Copying the shape is what makes a reader
who knows one understand the other without rereading.

### 2. Its own `aggregate_type`, `artifact_projection`

`AppendSessionEventUseCase` writes a **third** outbox row, in the SAME
transaction, for the types in `ARTIFACT_PROJECTABLE_EVENT_TYPES`. The
`aggregate_type` is new for the same reason as the graph's (documented in
`domain/graph/graph-projection-events.ts:7-26`): `Engine.Outbox.Drain.run_once/0`
only drains `session`, `task` and `container`, and the `'session'` row every
event already has is marked `processed_at` by it every ~2s. Reading the same
`aggregate_type` would be racing the engine's drain and losing almost always.

One deliberate difference relative to the graph: the `aggregateId` is the
**project**, not the session. The folder belongs to the project, and the source
event only carries `sessionId` — recording the `projectId` here spares the
projector a query per artifact to discover something the use case already had
in hand.

### 3. An ALLOW list, and four types deliberately out

`ARTIFACT_PROJECTABLE_EVENT_TYPES`
(`apps/api/src/domain/artifacts/artifact-projection-events.ts`) is an allow
list, not a deny list: a new artifact type is born **outside** the projection
and enters when someone decides it is a document — instead of appearing on its
own in a folder the user reads.

Left out are `qa_verdict`, `secops_verdict`, `task_blocked` and
`infra_delegation_files`. They are **operational outcomes**, not product
documents: a gate verdict per task, in a project with dozens of tasks, would
fill `docs/qa-lead/` with files nobody opens, and the folder would lose the
property that makes it useful — fitting in one glance. They remain in the event
log, which is the source, and remain in the timeline.

### 4. Per agent, and the versioned one overwrites

The layout is `docs/<agente>/<arquivo>.md`. Browsing the folder answers *"what
did the Arquiteto produce?"* without opening anything.

The four **versioned** types (`module_map`, `module_routing`, `project_image`,
`c4_diagram` — the ones read by reduction to the highest `version`, see
`obter-container-do-projeto.use-case.ts:22-25`) always write the **same file**,
overwriting: the folder shows the CURRENT one, and the history remains whole in
the event log. Projecting them as a file per version would produce
`c4-diagram-v1.md`, `c4-diagram-v2.md` and would make whoever opens it have to
figure out which one holds — exactly the work the reduction by `version` exists
to spare.

The others are append-only by nature (a decision does not replace the previous
one: both happened) and each becomes its own file, with the event's `seq` in
the name. The `seq` is gapless per session and already orders the event log, so
it is the tie-break that requires no new state — and **without it** two
artifacts of the same type with the same title would generate the same file,
and the second would erase the first: the only way this projection could lose
information the source has.

### 5. Two barriers against the filesystem, and the second is not redundant

The file name is derived from the **title the model wrote** — untrusted input in
every sense of the term. The defense is not escaping what came, it is
**deriving a new name from a closed alphabet**: `slugDeArquivo` has no way back
in which a separator survives, and returns `null` when nothing is left (an empty
name would collide with all other empty names).

`FsArtifactFileStore` checks **again**, with `relative()`, before opening the
file. It is not paranoia: the two answer different questions — the first is
*"what name do I derive from this"*, the second is *"what am I actually going to
open"*. Trusting only the first would make the security of this write depend on
no future slug change ever letting a separator through, which is precisely the
form of containment [ADR 0130](0130-broker-de-container.md) rejects on
principle: the one that depends on the caller being correct.

### 6. In `runner` mode, the folder detours to the managed root

`pastaDeArtefatosDoProjeto`
(`apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`) is a
sibling of `permissionsFilePath` and makes the **same detour**, for the same
physical reason: whoever writes is the api, from inside its container, and a
`runner` project is deliberately without a bind-mount. The runner's channel
(`exec`/`exec_result`) only carries COMMANDS — there is no primitive to write
content to a file —, so not even delegating the write would solve it without
inventing a new mechanism.

### 7. The write does NOT go through `proposed_action`

And it is not an omission. `proposed_action` is the origin of every external
effect **of an agent asking to act**. Here there is no agent asking for
anything: the artifact has already been emitted and is already in the event log
when this class runs. What happens afterwards is the **system** materializing,
in a derived path, a readable copy of something that is already fact.

Making the projection go through the approval queue would have the opposite
effect of the one intended: it would fill the queue with routine decisions — one
per artifact — and would erode precisely the ceiling that gives meaning to the
click on the actions that **are** external effects.

## Consequences

The user now has, in the project folder, a `docs/` folder organized by agent
with the reasoning that produced the code. It appears before git exists (the
deferred provisioning), which is precisely the interval in which today there is
nothing on disk.

**The projection never brings down the source.** No throw escapes `drainOnce`:
each item fails in isolation, is logged and stays `processed_at IS NULL` for the
next cycle. A full disk, denied permission or unreachable folder cannot prevent
an artifact from being EMITTED. `outbox_events` has neither `attempts` nor a
dead-letter — the retry is implicit and infinite, exactly like the graph's.

**A deliberate difference relative to `GraphProjector`:** there is no
equivalent here to `GraphUnavailableError` that stops the whole batch. A write
failure is usually the ITEM's (a strange name, a project whose folder
disappeared), and not the destination's; stopping the batch because of one item
would block all those behind it.

**An event that vanished from the event log is marked processed, not retried
forever** — retrying what no longer exists would have no effect at all, and the
row would stay in the queue indefinitely.

**Declared cost 1: in `runner` mode, `docs/` does not sit next to the code.**
Whoever opens the project folder on their own machine will not find it; it is in
`<PROJECT_WORKSPACES_ROOT>/<workspace_dir_name>/docs/`. It is a REAL loss in
this mode, because the folder exists precisely to be opened together with the
code. What it avoids is the worse alternative: the projection simply not
happening, or failing silently on every artifact.

**Declared cost 2: the Markdown is generic.** The file has a header (type,
agent, when, `seq`) and the payload as a JSON block. There is no per-type
renderer — it would be thirteen places to age when a schema changed, and what
this folder needs to deliver is readable and traceable content, not layout. A
richer per-type format is its own decision, when there is a real reading asking
for it.

**Declared cost 3: the folder can diverge from the event log between one cycle
and another**, and after a persistent failure it can remain incomplete
indefinitely without anything warning. It is the same cost the graph already
accepts, and it is tolerable for the same reason: the source is intact and the
projection is rebuildable. **There is no reprojection command today** — deleting
`docs/` does not rebuild it, because the outbox rows are already marked. It is
the same gap **BRB-018** already records for the graph, now with a second
consumer.

**What this ADR does NOT touch.** `decide.ts` and the absolute ceilings;
`proposed_action` as the origin of every external agent effect (see point 7 —
the projection is not one of them); the immutability of the event log; the
engine's artifact schemas, which do not change at all; and the image gate
([ADR 0135](0135-portao-de-imagem-nos-tres-modos.md)).

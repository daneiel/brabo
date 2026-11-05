---
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
id: rn-web
title: 'Regras de negócio — Web'
sidebar_label: Web
description: 'As RNs hospedadas na raiz web.'
keywords: [regras de negócio, web]
---

# Web

## Projects panel

The budget, metering, and cost-ceiling RNs live in
**[Business rules — Cost](custo.md)**.

Same reason as the Authentication section below: size, not subject.
`#rn-NNN` anchors unchanged.

## Cost

### RN-039 — Project status dot: risk always beats inactivity {#rn-039}

The dashboard sidebar shows a health dot per project, derived from three
independent signals: budget (the same 70%/90% thresholds as RN-018), blocked
task (`tasks.blocked`), and recent activity (7 days). Colors: green =
healthy and active; amber = budget ≥70%; red = budget ≥90% **or**
blocked task; gray = no activity in the last 7 days. When a risk signal
(amber/red) and the inactivity signal (gray) apply at the same
time, the risk one wins — an overrun, stalled project is still something to
look at, not something to hide behind "no activity".

- **Where:** `apps/web/src/lib/project-status.ts` (`deriveProjectStatus`)
- **Test:** `apps/web/src/lib/project-status.test.ts`
- **Origin:** fidelity of the projects dashboard to the approved design

### RN-064 — Heartbeat não encerra sessão com trabalho pendente {#rn-064}

> **Estendida pela [RN-581](api.md#rn-581) (AT-072):** um agente
> conversacional esperando o usuário passou a ser o QUINTO sinal, e o único com
> teto (8h, causa `conversation_idle_timeout`); a resposta ganhou
> `aguardandoUsuarioDesde`. O resto desta regra vale como está.

O timeout de heartbeat mede inatividade da **aba**, não do **trabalho**. Antes
de encerrar, o `SessionServer` pergunta à api se sobrou trabalho
(`GET /internal/sessions/:id/pending-work`); havendo, reagenda o timeout e
registra o motivo no log em vez de matar a sessão.

O default são **30 segundos**. Sair da sessão para a aba de Backlog já bastava
para matá-la — e numa execução real isso prendeu um handoff `offered` para o
Arquiteto dentro de uma sessão fechada: épico e quatro histórias prontos, e a
cadeia sem como seguir, porque não existe onde aceitar handoff de sessão morta.

Fechar sessão é sobre o trabalho ter acabado, não sobre quem está olhando.

**A api fora do ar NÃO impede o encerramento**: `{:error, _}` encerra assim
mesmo, com aviso no log. Trocar sessão órfã por sessão imortal seria trocar um
defeito por outro.

"Trabalho pendente" são **três** sinais — o segundo entrou pelo achado V, o
terceiro pelo bug real do Criativo→PO→Arquiteto:

1. **handoff `offered`** — o caso original acima;
2. **`proposed_action` com status `pending`** — alguém está esperando a SUA
   decisão, e um agente pode estar suspenso esperando o desfecho
   ([RN-073](engine.md#rn-073));
3. **agente ATIVADO ainda em turno** — o último `agent.status` de cada ator
   que já falou na sessão é `working` sem um `idle` posterior.

O segundo é o mesmo defeito do primeiro um nível abaixo, e a execução do
`hello-limpo` mostrou o custo: a sessão nasceu 23:34:12, uma ação ficou
`pending` às 23:34:13, e o heartbeat a fechou às **23:34:42 — exatamente os 30s
do timeout**. O dev agent seguiu trabalhando por mais de uma hora numa sessão
que o banco dava por encerrada, e isso envenena toda métrica por sessão:
duração, custo e "quantas terminaram bem" passam a ler um estado que não
descreve o que houve.

O terceiro é a mesma janela, um passo antes de qualquer um dos dois primeiros
existir: `AcceptHandoffUseCase` marca o handoff antigo como `accepted` e ativa
o próximo agente na hora, mas a ativação no engine é `GenServer.cast`
fire-and-forget — responde 201 antes de o agente sequer começar. O PO ativado
pelo handoff do Criativo roda um kickoff de até 12 iterações de LLM usando só
ferramentas `category: :direct` (`create_epic`/`create_story`/`create_task`),
que nunca geram `proposed_action`, e só oferece o handoff seguinte (o sinal 1)
no FIM do turno inteiro. Entre a ativação e esse fim, nem o sinal 1 nem o sinal
2 existiam — só o ping do canal Phoenix a cada 10s segurava a sessão, e
qualquer atraso maior que os 30s do timeout fechava a sessão com o PO ainda
gerando o backlog, quebrando a cadeia de handoff pela raiz: o handoff seguinte
acabava sendo oferecido numa sessão já `closed`, que não aceita mais nada.

`agent.status` (`working`/`idle`) é o que todo agente conversacional
(Criativo/PO/Arquiteto/Dev Lead/Infra) já narra nos limites de turno, e é
PERSISTIDO no event log, não só broadcastado no canal
(`Engine.Sessions.LiveBroadcast.agent_status/4`, [ADR 0021](../adr/0021-fechamento-4a-infra-e-painel.md))
— o mesmo sinal que o painel do time já lê para derivar o roster
(`conversationalStatus` em `apps/web/src/lib/agent-status.ts`). Reaproveitá-lo
aqui não exigiu evento novo nenhum: o terceiro sinal é o último `agent.status`
de CADA ator que já falou na sessão, e é genérico por tipo de evento — cobre
qualquer agente ativado por handoff, não só o PO.

A versão anterior desta regra dizia, por escrito, que incluir trabalho de agente
"sem um teste que prove a interação seria adivinhar". A execução produziu a
prova, e o teste agora existe.

**O que continua fora:** task `in_progress` sem ação pendente nem handoff nem
turno em aberto. O dev agent tem máquina de estados própria e retém o worktree
por conta dele; o sinal que a api possui e que a execução comprovou é a ação
pendente. Incluir a task exigiria a api ler `dev_agent_states`, que é do
engine — decisão de fronteira, não conserto de passagem. Os dev agents também
não emitem `agent.status` (rodam com máquina de estados própria, não com o
loop conversacional de turno) — o terceiro sinal não os cobre, e não precisa:
a ação pendente já cobre o caminho deles.

- **Onde:** `apps/api/src/application/use-cases/sessions/get-session-pending-work.use-case.ts`,
  `apps/api/src/application/ports/session-event-repository.port.ts`
  (`listByTypeInSession`), `apps/engine/lib/engine/sessions/session_server.ex`
  (`handle_info(:heartbeat_timeout, …)`)
- **Teste:** `apps/engine/test/engine/sessions/session_lifecycle_test.exs`
  (`heartbeat NÃO encerra sessão com trabalho pendente` e o caso oposto) e
  `apps/api/test/application/use-cases/sessions/get-session-pending-work.use-case.spec.ts`
  (os três sinais, a ação já decidida que NÃO segura, o `idle` que libera, o
  isolamento por ator, a genericidade por tipo de agente e o escopo por
  sessão)
- **Origem:** execução real da FASE 13b; achado V, Fase H do
  [backlog](../explanation/backlog.md); bug real do encadeamento
  Criativo→PO→Arquiteto

### RN-088 — Load failure is said on screen; 429 is not retried {#rn-088}

Every screen that loads data from the api distinguishes three states, never two:
**loading** (skeleton), **error** (the message the api sent, with the
`trace_id` and a try-again button), and **empty** (the empty-list text).
`if (!dado) return null` collapses the three, and the observed outcome was the worst
possible: with the api rate-limiting with `429`, the main area of `/projects/:id`
was **completely blank** — no message, no error, no skeleton — and
the reason existed only in the console. On the dashboard it was worse than blank: `!projects`
was also true on error, so the screen invited you to create the **first**
project of a workspace that could have twenty.

It's [RN-059](engine.md#rn-059) on the other end of the wire: failure never becomes an empty response.
Whoever fails, says so.

The sentence is **the api's**, extracted by `mensagemDaApi` — the same function the
mutation path already used in toasts. A generic text of ours doesn't know the
difference between "rate limit exceeded, try again shortly" (wait) and
"access denied" (waiting won't help).

The other side of the same rule is not answering the limit with more traffic. **4xx
is not retried**: `429` is literally the server telling you to stop, and `401` has already
been renewed once inside `request()`. And **polling stops when the query errors**
— it comes back on window focus, on remount, or on the button. Before, there were three
retries per failure added to ~25 polls of 3 to 5 seconds that didn't know how to
stop: a real session accumulated **1128 429 errors** against a limit of 300
requests per minute per user (`RateLimitGuard`), and the loop kept the
sliding window from recovering. 5xx and network failure keep the three
attempts, where repeating is the right reaction.

- **Where:** `apps/web/src/lib/query-policy.ts` (`deveRetentar`,
  `pollQueParaNoErro`), `apps/web/src/components/ErroDeCarregamento.tsx`,
  `apps/web/src/routes/ProjectPage.tsx`, `apps/web/src/routes/Dashboard.tsx`,
  `apps/web/src/routes/Shell.tsx`, `apps/web/src/main.tsx`
- **Test:** `apps/web/src/lib/query-policy.test.ts`;
  `apps/web/src/routes/ProjectPage.test.tsx` (429 becomes a message with the api's
  sentence; 403 shows the 403's reason; loading is not an error);
  `apps/web/src/routes/Dashboard.test.tsx` (error on the list doesn't become "no
  project yet"); `apps/web/src/routes/Shell.test.tsx` (the sidebar says so instead
  of staying empty)
- **Origin:** real navigation on `/projects/:id` with 1128 429 errors in the console

### RN-089 — A repeated project name is disambiguated in the sidebar {#rn-089}

Project name **is not unique** — nothing in the domain prevents it. When two or more
projects in the list have the same name, each of them shows in the sidebar the
abbreviated id and the creation date (`#a1b2c3d4 · 07/08 14:32`), both already present
in the project payload. Projects with a unique name show nothing: the caption on every
row would be noise in the place with the least space on screen.

Concrete origin: a validation run created twenty projects called
`validacao-real`, and the twenty sidebar rows were visually identical.

- **Where:** `apps/web/src/lib/project-label.ts` (`nomesRepetidos`,
  `desempateDoProjeto`), `apps/web/src/routes/Shell.tsx`
- **Test:** `apps/web/src/routes/Shell.test.tsx` (repeated name gets a
  tiebreaker, unique name doesn't)
- **Origin:** real navigation with the sidebar full of validation projects

## Session

### RN-098 — The session name adds to the hashtag, never replaces it {#rn-098}

The session can receive a friendly name (`sessions.name`, optional), at
creation or later, via `PATCH /projects/:projectId/sessions/:sessionId`. The
label shown on screen is **composite**: `<name> · #<first 8 characters of the
id>`. With no name, it degrades to the **hashtag alone**.

The hashtag never disappears, and the reason is operational: it's what gets
pasted into a URL, a command, or a conversation, and a name chosen by a
person **isn't unique** — two sessions named "Checkout" are normal. A blank
name (or whitespace only) counts as **absence**, both on creation and on
renaming: writing `''` would turn the label into `" · #a1b2c3d4"`, worse than
the hashtag alone. `null` in the `PATCH` body is the way to **undo**.

Renaming is **not** a session event. The event log is what the session lived
through, and the name is a navigation label, changed as many times as
desired — N renaming events would push exactly what matters out of the
200-event tail.

- **Where:** `apps/web/src/lib/session-label.ts:61` (`rotuloDaSessao`),
  `apps/api/src/application/ports/session-repository.port.ts:52` (`rename`).
  Reachable both from inside the session
  (`apps/web/src/routes/SessionPage.tsx:439`, `handleRename`) and from the
  project's list, without needing to open the session first
  (`apps/web/src/routes/ProjectSessionsTab.tsx:101`, `handleRenomear`) — both
  screens call the same `renameSession` and the same `rotuloDaSessao`.
- **Test:** `apps/web/src/lib/session-label.test.ts`,
  `apps/api/test/application/use-cases/sessions/session-kind-e-nome.spec.ts`,
  `apps/web/src/routes/ProjectSessionsTab.test.tsx`
- **Origin:** [ADR 0061](../adr/0061-tipo-da-sessao-na-criacao.md)

## Projects panel

### RN-099 — Activity paginates the past without repolling what doesn't change {#rn-099}

The Overview's **Activity** column shows a **window** of 100 events
anchored at the session's **tail**, and goes down into the past page by page. Each
page uses the `afterSeq`/`nextCursor` that
`GET /projects/:p/sessions/:s/events` **already** returns: no new route,
no new parameter.

**Two questions, two queries.** `useSessionEvents` answers "how is it
now" — the last 200 under polling — and feeds the team panel, the tree
timeline, the execution section, and the Approvals tab. None of them
paginates. Activity's answers "what happened", and it was the only one asking
that question with the other one's answer: 200 items at once, with no beginning or
end, and still not reaching the start of a long session.

**The anchor is the tail, not the start of the session.** The endpoint paginates
FORWARD, and there's no `beforeSeq` — inventing one would be a new contract. But opening
the feed at event #1 of a session with thousands delivers the wrong screen: whoever
opens Activity wants what just happened. So the first page is the
same `latest` read the screen already does, with the **same `queryKey`** (React
Query serves both with ONE fetch), and each click goes down a fixed window with
`afterSeq`.

**What pagination can't cost.** One request per poll cycle — the
same as before, and the savings of [RN-090](api.md#rn-090)/[RN-091](api.md#rn-091) don't
regress. Three pieces guarantee that:

- the tail is the query the screen already had, shared by `queryKey`;
- the first click does **not** become a request: the `latest` read brings 200 and the
  window shows 100, so revealing what was already paid for comes before asking
  again;
- an old page is a **closed** `seq` window over **immutable** events
  (there's never an UPDATE on an event table): `staleTime: Infinity` and
  **no** `refetchInterval`. A poll there would be paying N requests to
  receive N identical responses.

**The count is honest about what it knows.** The filters by agent and by
type run over the **loaded page**, not over the session — so the UI says
`N of M loaded`, not "N results". Taking the filter to the server would give the
true total and touch the event repository; it's not for this phase, and
saying the wrong total would be worse than saying less.

The three states of [RN-088](#rn-088) apply here: **error before empty** — the
column said "no activity" when the api had refused.

- **Where:** `apps/web/src/lib/hooks.ts` (`useSessionEventHistory`,
  `EVENTOS_POR_PAGINA`), `apps/web/src/components/ActivityFeed.tsx`,
  `apps/web/src/routes/ProjectOverviewTab.tsx`,
  `apps/api/src/infrastructure/persistence/drizzle/session-event.repository.ts`
  (`listPaginated`, already existing)
- **Test:** `apps/web/src/lib/session-history.test.tsx` (opens at the tail; the
  first click costs no request; the next paginates with contiguous `afterSeq`;
  the loop ends at the start of the session; mounted together with the current
  state, the tail is ONE fetch; an old page doesn't repoll);
  `apps/web/src/components/ActivityFeed.test.tsx` (the "N of M loaded"
  follows the filter; without the pagination props nothing changes)
- **Origin:** user request on the first real navigation — "Activity in
  the Overview tab must be paginated, so it isn't infinite"

## Session

### RN-104 — The tab derives from the recorded kind, and creates in that kind {#rn-104}

The project has **two** session tabs — **Creative** and **Chat** — and each
one is a `kind`: it lists the sessions whose `sessions.kind` is its own, and
its CTA creates in that `kind`, **without asking again**. There's no third
tab listing both together.

The kind was already immutable ([RN-097](api.md#rn-097)), and that's what makes it
a legitimate navigation coordinate instead of a saved filter: a session never
switches tabs. The tab reads the **recorded** field — it doesn't derive the
kind from any event, for the same reason as RN-097: `execution.activated`
classifies execution STATE, and a tab that looked at it would move on its
own.

Two consequences the rule fixes, and which aren't screen detail:

- **The kind choice leaves the form.** It used to live in a radio-button
  `fieldset`, and now it happens the moment the person clicks the tab.
  Keeping both would offer the chance to create a session that contradicts
  the place you're standing in. What's left in the form is the **name**,
  which stays optional ([RN-098](#rn-098)).
- **One action, one place at a time.** "Start ideation" still exists — it's
  what brings the Creative agent into the session, and from there on the
  owner's key starts being spent ([RN-058](api.md#rn-058)); no one steps in alone.
  What changed is where it lives: **inside the invite** while the invite is
  on screen, and in the topbar when it isn't. The invite used to POINT to the
  topbar ("use Start ideation, at the top of the screen"), which is the
  literal version of the problem that originated [RN-097](api.md#rn-097) — the
  action in one place and the explanation in another. The topbar can't
  simply lose the button: it's possible to type into a creative session
  without ever having called the Creative agent, and then the invite leaves
  the scene.

The three screens honor the three states of [RN-088](#rn-088), with **error
before empty**: the filtered list is empty in both cases, and saying "no
ideation yet" after a 429 would be lying about what happened.

The Chat's deep-link key stays `sessions`, not `chat`. That's what makes an
old bookmarked `?tab=sessions` link open the Chat **with the tab marked in
the tab bar** — resolving the old key as an alias only in the panel would
leave the tab bar with no selection at all, because `Tabs` compares `active`
to `key`, and whoever writes `active` receives the raw key from
`validateSearch`.

- **Where:** `apps/web/src/routes/project-tabs.ts:95` (both entries),
  `apps/web/src/routes/ProjectSessionsTab.tsx:114` (the filter by recorded
  `kind`) and `:98` (the CTA creating in the tab's `kind`),
  `apps/web/src/routes/SessionPage.tsx:716` (`conviteVisivel`, the one
  question the topbar and the invite share)
- **Test:** `apps/web/src/routes/ProjectSessionsTab.test.tsx`,
  `apps/web/src/routes/project-tabs.test.tsx`,
  `apps/web/src/routes/SessionPage.sessao.test.tsx`
- **Edge case:** a project with no session of that kind shows the empty
  state OF THAT KIND, even when it has sessions of the other kind — that's
  information, not an error.
- **Origin:** [ADR 0061](../adr/0061-tipo-da-sessao-na-criacao.md)

### RN-107 — The Code tab has a FOURTH state: blocked by a pending decision {#rn-107}

The three states of [RN-088](#rn-088) (loading/error/empty) do not describe
`sem_decisao` ([RN-105](api.md#rn-105)): it is not loading (the api already answered), it is not
error (it answered CORRECTLY) and it is not empty (no data is missing — a DECISION is missing,
which is something else). Treating `sem_decisao` as "empty" would show an editor without
files, inviting one to think the repository is empty; treating it as "error"
would make the screen suggest "try again" for something only the Arquiteto resolves.

The tab asks for the container state BEFORE trying to read code
(`GET /projects/:id/container`), instead of waiting for the first tree or
file to return 409 — the same check the api already does in the
`ReadProjectCodeUseCase` funnel (RN-105), only asked first, so the fourth
state is born as its own message and not as the footer of a generic error.
While blocked, the screen re-queries on its own every 15s — once decided,
the image does not change without new human action, and re-querying a stable
state would be the same family of unnecessary traffic as PÓS-FASE 15.

The presentation of the fourth state was EXTRACTED to `ContainerImageGateNotice`
(`apps/web/src/components/ContainerImageGate.tsx`) — a usage finding: the PRs tab
(`apps/web/src/routes/code/PrListAndDiff.tsx`, consumed by
`ProjectPrsTab.tsx` and by `CodeDiffPanel.tsx`) calls `getCodePullRequests`/
`getCodeDiff`, which go through the SAME funnel (RN-105) and can return the SAME
409 — but, unlike this tab, without asking first. It showed that 409
in the generic error banner with "Tentar de novo", the wrong affordance for a
state only the Arquiteto resolves. `isContainerImageGateError`
(`apps/web/src/lib/api-client.ts`) identifies the cause by `status === 409`
— the only cause of `ConflictException` in `ReadProjectCodeUseCase.alvo` — and
`PrListAndDiff` swaps the banner for `ContainerImageGateNotice` when it matches,
without a pre-check of its own (it reacts to the 409 of the query that was going to run anyway).

- **Where:** `apps/web/src/routes/ProjectCodeTab.tsx`,
  `apps/web/src/routes/ProjectCodeTab.module.css`,
  `apps/web/src/components/ContainerImageGate.tsx` (shared
  presentation), `apps/web/src/routes/code/PrListAndDiff.tsx` (consumer
  reactive to the 409), `apps/web/src/lib/api-client.ts`
  (`isContainerImageGateError`)
- **Test:** `apps/web/src/routes/ProjectCodeTab.test.tsx` ("o gate"),
  `apps/web/src/routes/code/CodeDiffPanel.test.tsx`,
  `apps/web/src/routes/ProjectPrsTab.test.tsx` ("o gate do container não é
  erro genérico")
- **Edge case:** the front-end check does NOT replace the api's — it is a UX
  convenience. If the api changes state between the gate query and the actual
  read, the read route still refuses with 409 (RN-105); the front only avoids
  the common case of showing the empty editor for an instant. The PRs tab does no
  pre-check: it discovers the block when the query has already failed, because there
  is no tree/file there for the "empty" instant that the Code tab's
  pre-check avoids.
- **Origin:** [ADR 0065](../adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

### RN-108 — The session socket requires a single-use opaque ticket, not the reused JWT {#rn-108}

`EngineWeb.SessionSocket.connect/3` refused the whole connection with only the
`session_id` (UUID) needing to exist in the Registry — whoever discovered the UUID
entered the `session:<id>` channel and received all the live broadcasts of the
session. Closing this was a deliberate limitation documented in the module itself
since Fase 3.

`POST /projects/:projectId/sessions/:sessionId/socket-ticket` (`scope:
"heartbeat"|"terminal"`) issues an opaque ticket (32 bytes of CSPRNG,
`TokenFactory`), TTL of **30 seconds**, single use. `scope: "heartbeat"` requires
the `viewer` role; `scope: "terminal"` requires `developer` — the same minimum role
as `MIN_ROLE_FOR_ACTION_TYPE.terminal` in `domain/actions/decide.ts` (today
no path really asks for `terminal`; the value is born right for FASE 25,
the interactive terminal). The api persists only the HASH (**plain** SHA-256, not
`hashDeToken`/HMAC — the engine does not have the api's pepper, and a 256-bit
CSPRNG token does not need a pepper against a dictionary, the same reasoning that
`hashDeToken` itself already records), never the raw token.

Consumption belongs to the ENGINE, which reads `session_socket_tickets` directly (same pattern as
`Engine.Outbox.Event` over `outbox_events` — never changeset/insert, only the
narrow write that single use requires) in TWO steps:
`SocketTicket.validar/1` (peek, marking nothing — called by `connect/3`,
which does not yet know which `session_id` will be requested) and
`SocketTicket.consumir/2` (conditional `UPDATE` requiring the topic's `session_id`
to match the row's — called by `SessionChannel.join/3`, which
also checks the ticket's `project_id` against the session's, defense in
depth against a ticket of one project opening a channel of another). Without a ticket,
or with an invalid one: the whole connection is refused (`{:error, %{reason:
"unauthorized"}}`), not only the channel join.

The web (`session-channel.ts`) fetches a NEW ticket before EVERY
`socket.connect()` — including on automatic reconnection, which exists. The
native reconnect of `Phoenix.Socket` would reuse the same `params` from construction
(the old ticket, already expired or consumed), so it is neutralized
(`reconnectAfterMs` that practically never fires) and reconnection becomes
entirely manual, fetching a fresh ticket on each attempt.

That neutralization holds for EVERY client of the socket, and not only for the web's —
including the `/runner` socket, whose ticket (`POST .../runner-ticket`) is of the
same caliber. It failed in TWO of the four `Socket` constructors in the
repository, and the cost was measured in real execution: `apps/runner/src/
channel.ts` built the socket without the option — while the module's docblock
CLAIMED the reconnect was "por isso neutralizado" — and the auto-reconnect
repeated the same already-consumed ticket every **~5.13s** (the ceiling of the
phoenix.js internal backoff), yielding **61 `REFUSED CONNECTION TO
EngineWeb.RunnerSocket`** in a few hours. Added to the runner's OWN policy
(`index.ts`, that one correct), the result was **530 requests in one
minute** against the ceiling of 300 of `RATE_LIMIT_USER` — and since the limit is per
USER, the 429 showed up in the account owner's BROWSER. Two consequences, and
the second is worse than the 429: while it is in that loop the runner is NOT
connected, so `RunnerReadiness` (RN-507) refuses and the project looks like it has "no
local agent". `apps/web/src/lib/fs-browser-channel.ts` had the SAME defect
line (same single-use ticket, and no reconnection policy of its own —
its `onClose` says "close and reopen") and was fixed along with it.

What prevents the third instance is MECHANISM, not a comment: in the runner the
`Socket` options became a type with a MANDATORY `reconnectAfterMs`
(`OpcoesDoSocket` in `channel.ts`), and both sides gained a test asserting
the OPTION PASSED to the constructor — a test that only checks "connects" would pass
with the defect standing, and it did. Along with it, `conectarERodar` (`index.ts`) started to
explicitly DISCARD the dropped connection (`conexao.desconectar()`): without it
the `Socket` of the previous round survived the creation of the next one, and each drop
left one more live object trying with the dead ticket.

- **Where:** `apps/api/src/db/schema/sessions.ts` (`sessionSocketTickets`),
  `apps/api/src/domain/sessions/socket-ticket-scope.ts`,
  `apps/api/src/application/use-cases/sessions/create-socket-ticket.use-case.ts`,
  `apps/api/src/interfaces/http/sessions/sessions.controller.ts` (route
  `socket-ticket`), `apps/engine/lib/engine/sessions/socket_ticket.ex`,
  `apps/engine/lib/engine_web/channels/session_socket.ex`,
  `apps/engine/lib/engine_web/channels/session_channel.ex`,
  `apps/web/src/lib/session-channel.ts`,
  `apps/web/src/lib/fs-browser-channel.ts`,
  `apps/runner/src/channel.ts` (`OpcoesDoSocket`,
  `NUNCA_RECONECTAR_SOZINHO_MS`), `apps/runner/src/index.ts`
  (`conectarERodar`, the discarding of the dropped connection)
- **Test:**
  `apps/api/test/application/use-cases/sessions/create-socket-ticket.use-case.spec.ts`,
  `apps/api/test/domain/sessions/socket-ticket-scope.spec.ts`,
  `apps/api/test/infrastructure/persistence/session-socket-ticket.repository.spec.ts`,
  `apps/engine/test/engine/sessions/socket_ticket_test.exs` (reuse fails,
  wrong session_id fails, concurrent race only one wins),
  `apps/engine/test/engine_web/channels/session_socket_test.exs` (without a ticket
  the connection is refused),
  `apps/engine/test/engine_web/channels/session_channel_test.exs` (ticket from
  another project: join fails), `apps/web/src/lib/session-channel.test.ts`,
  `apps/runner/src/channel.spec.ts` ("neutraliza o auto-reconnect do
  Phoenix.Socket — ticket de uso único nunca é repetido"; asserts the OPTION
  passed to the constructor, and fails without it),
  `apps/web/src/lib/fs-browser-channel.test.ts` (the same, in the folder browser's
  transport via runner)
- **Edge case:** the ticket is NOT the reused JWT — short TTL, single use, closed
  scope, and it is born from a route of its own that already checks the effective role, not from
  decoding the existing access token.
- **Origin:** no ADR — a one-off extraction/hardening, not a structural change.

### RN-113 — Blame in the editor is an ON-DEMAND annotation — a toggle, never embedded in the file read {#rn-113}

The UI that consumes the foundation of [RN-110](contracts.md#rn-110) comes in here: the Code tab
editor (`CodeEditor.tsx`) only calls `getCodeBlame` when the user turns on the
"Blame" toggle — never together with the file read, which already fires by itself when opening
a tab. The reason is the same as the composite-read budgets (ADR 0060):
blame is a SECOND call to the provider per open file, and a file near
the ceiling (`GIT_BLAME_LINE_LIMIT`, 2000 lines) is already expensive enough not to
pay for it for free on every navigation. `truncated` (which RN-110 already exposes) becomes
a visible warning, in the same pattern as the `fileQuery.data.truncated` warning.

Consecutive lines of the SAME commit show author and short sha only on the FIRST
line of the block — repeating the same text on each line of a block of dozens
of lines would be noise, not annotation; the line only disappears from the text, never from the
annotation (the element's `title` keeps the full date and the commit
summary on any line of the block).

- **Where:** `apps/web/src/routes/code/CodeEditor.tsx`,
  `apps/web/src/routes/code/CodeEditor.module.css`
- **Test:** `apps/web/src/routes/code/CodeEditor.test.tsx`
- **Origin:** UI wave of FASE 26b (blame — rich branch dropdown and
  PR list are UI from two other agents, with no collision risk)

## Projects panel

### RN-118 — The team tree exposes execution detail per milestone, and opens the "last 5" {#rn-118}

`AgentTimelineTree`/`timeline-tree.ts` (PHASE 14b) already grouped the event log by
agent, but with three gaps: the criterion for opening a branch was only
active/stopped (unrelated to how many agents existed), the header
counter was the TOTAL of milestones (never "what's new"), and `tool.call`/
`tool.result`/`agent.response` became a milestone showing only the
tool name — `args`, `result`, and `iteration`, which the event log already records,
never reached the screen.

**Default opening** becomes "the 5 agents with the most recent activity
(highest `seq` of the last milestone)", with active keeping priority over
recency — they don't add up: since `montarArvore` already sorts actives first and,
within each group, from most recent to oldest, the two criteria
collapse into a single slice (`ramosAbertosPorPadrao`, the first
`max(number of actives, 5)` branches). More than 5 actives: all open, with no cutoff.

**The novelty counter** per agent uses the SAME mechanism as the bell
(`read-state.ts`, `localStorage`), granular by `projectId:agentId` instead
of only `projectId` — there was no "last seen" at that granularity before.
A collapsed branch with a milestone `seq` greater than that agent's last seen
shows the NOVELTY count in place of the total; opening the branch (automatically
or manually) marks as seen up to the most recent `seq`.

**Expandable detail** is per MILESTONE, not per branch — only `tool.call`,
`tool.result`, and `agent.response` (`EVENTOS_EXPANSIVEIS`) become an individual
button, because only they carry a payload worth expanding. The
visual grouping by ITERATION uses `iteration` from the
`agent.response` payload when it exists (ToolLoop — `tool.call`/`tool.result`
inherit the iteration of the response that dispatched them, because in the ToolLoop they
are emitted AFTER it); agents outside the ToolLoop (PO, Criativo, with no
`iteration` in the payload) get their OWN counter per agent, incremented
on each response — inference by `seq` proximity, not a new field in the
event log.

- **Where:** `apps/web/src/lib/timeline-tree.ts` (`Marco.iteracao`,
  `Marco.eventType`, `Marco.payload`, `ramosAbertosPorPadrao`,
  `marcoExpansivel`), `apps/web/src/components/AgentTimelineTree.tsx`,
  `apps/web/src/lib/read-state.ts` (`getAgentLastSeenSeq`/
  `setAgentLastSeenSeq`)
- **Test:** `apps/web/src/lib/timeline-tree.test.ts` (grouping by
  real and inferred iteration, `ramosAbertosPorPadrao` with active/recency/no
  cutoff), `apps/web/src/components/AgentTimelineTree.test.tsx` (default
  opening, novelty counter appearing/disappearing, milestone expanding with
  args/result/iteration)
- **Origin:** user request — gaps confirmed by investigation of the existing
  PHASE 14b component; no ADR, same "unseen" semantics
  as the bell, only a new granularity

---

## Session

### RN-119 — The session's ACTIVE agent is the one with the most recent `agent.activated` — never a fixed chain {#rn-119}

`SessionPage` decides two things from the SAME agent: who the composer's
message goes to, and which agent the topbar resolves the displayed model
from (the full cascade session→agent→area→project→workspace, the same one
`RunLlmTurnUseCase` uses to actually run the turn). The two questions used
to have DIFFERENT answers before this rule: routing used a fixed precedence
chain (architect > po > creative, based on historical EXISTENCE — "has
already activated once", which never "turned off"), and the displayed model
didn't even know who was active — the model-binding route received no agent
at all and always fell back to the Creative agent's fixed fallback
(`herdarModeloDeStart`), even after a handoff to the PO, Architect, or Dev
Lead.

The single definition: the ACTIVE agent is the one with the most RECENT
`agent.activated` (by `seq`), among the conversational agents of the chat
flow (Creative, PO, Architect, Dev Lead). **Infra Lead is left out**:
`agent_command_controller.ex` (engine) only has a `message` route for
po/dev-lead/arquiteto (plus Creative, as the last clause's implicit
fallback) — Infra never had `message` wired, only `start`. Sending a message
to "infra" today would silently fall through to the Creative agent; treating
it as the composer's active agent would reopen that trap instead of closing
one.

> **Superseded in part by [RN-631](#rn-631) (AT-251):** "most recent
> `agent.activated` wins" was itself an implicit default recipient, and an
> invisible one. The composer's recipient is now CHOSEN by the person (a "To"
> selector listing the agents already in the session) and the topbar model
> follows that recipient. What survives from this rule is the half about the
> model: the binding route receives the agent, never falls back silently.

- **Where:** `apps/web/src/lib/session-destinatario.ts:272`
  (`useDestinatarioDoChat`, since RN-631),
  `apps/web/src/lib/api-client.ts:1124` (`getSessionModelBinding`, the
  `agentId`), `apps/api/src/interfaces/http/llm/model-bindings.controller.ts:166`
  (`getSessionBinding`, `@Query('agentId')`)
- **Test:** `apps/web/src/routes/SessionPage.destinatario-do-chat.test.tsx`
  (formerly `SessionPage.agente-mais-recente.test.tsx`),
  `apps/web/src/routes/SessionPage.modelo-do-agente-ativo.test.tsx`,
  `apps/api/test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`
- **Edge case:** Infra Lead doesn't participate in composer routing nor in
  the "active agent" definition — it's proactive (Phase 4), not
  conversational through the composer.

### RN-120 — The session's event poll pauses during an in-progress turn {#rn-120}

`useSessionEvents` fetched events every few seconds with NO awareness of an
in-progress turn. If the poll landed DURING a turn (common — turns usually
last longer than the interval), it brought already-persisted
`chat.message`/`agent.response`, which rendered ALONGSIDE the
optimistic/streaming state still on screen: the same message, twice.

The fix pauses only the TIMER (`refetchInterval`) while `streaming` is
`true` — the query stays `enabled`, so the explicit invalidation that
already fires at the end of the turn (`finalizarTurnoDoAgente`) keeps
fetching fresh data at the right time. `pausarPoll` is an OPTIONAL
parameter, default `false`: the hook's other consumers (Overview, Code,
Provisioning, AdoptionPlan) have no conversational turn in progress and
stay as they were.

- **Where:** `apps/web/src/lib/hooks.ts:221` (`useSessionEvents`),
  `apps/web/src/routes/SessionPage.tsx:277` (`eventsQuery`)
- **Test:** `apps/web/src/lib/hooks.pausar-poll.test.tsx`
- **Edge case:** pausing the timer isn't disabling the query — explicit
  invalidation keeps working, and the fix depends on it to never miss data.

## Projects panel

### RN-121 — Dev agent and QA are "executors": their own tab, outside the "Agent team" {#rn-121}

The Overview's "Agent team" grid and "Team timeline"
mixed Criativo/PO/Arquiteto/Infra with dev-`<module>` and QA (lead +
`qa-automacao`/`qa-performance-seguranca`) — seven, eight agents in the same
grid, without distinguishing who CREATES/DECIDES from who IMPLEMENTS/VERIFIES. The
**Executors** tab isolates the last two, with the SAME rendering as the
Overview (`AgentCard`, the area grid — extracted to `AgentTeamGrid.tsx` — and
`AgentTimelineTree`), never a reinvented card.

**The separation rule is a single function**, `isExecutorGroup`/
`isExecutorAgentId` (`lib/agent-status.ts`): `dev-lead`/`dev-<any
module>` and the entire `qa` area (lead + sub-specialties) are executors;
the rest isn't. BOTH screens filter the SAME `groupRosterByArea` with that
function — the Overview with `!isExecutorGroup`, Executors with
`isExecutorGroup` — so an agent can't appear in both nor vanish
from both: it's always exactly one side.

**The tree doesn't duplicate**: each tab filters the EVENTS before passing them to
`AgentTimelineTree` (by whether `actor.id` belongs to the set of
executors), so a dev agent's branch appears only in Executors, never
also in the Overview. The Activity column (`ActivityFeed`, RN-099/100)
was NOT filtered — it answers "what happened" in the whole session,
dev/QA included, and the component's own per-agent filter already lists
everyone who spoke; only the grid and the "who is doing what" tree
change place.

- **Where:** `apps/web/src/lib/agent-status.ts` (`isExecutorGroup`,
  `isExecutorAgentId`, `autonomyActionTypeFor` — moved from
  `ProjectOverviewTab.tsx`), `apps/web/src/components/AgentTeamGrid.tsx`
  (extracted from the grid that already existed), `apps/web/src/routes/
  ProjectExecutorsTab.tsx`, `apps/web/src/routes/ProjectOverviewTab.tsx`,
  `apps/web/src/routes/project-tabs.ts` (`key: 'executores'`, `ordem: 12`
  — right after the Overview, before Criativo/Chat/Code)
- **Test:** `apps/web/src/lib/agent-status.test.ts` (`isExecutorAgentId`/
  `isExecutorGroup` — dev-`<module>`, `dev-lead`, the entire `qa` area are
  executors; criativo/po/arquiteto/infra/secops are not);
  `apps/web/src/routes/ProjectExecutorsTab.test.tsx` (shows only dev/QA,
  empty state without both, header count);
  `apps/web/src/routes/ProjectOverviewTab.test.tsx` (dev-backend/QA disappear
  from the grid, the rest of the team remains); `apps/web/src/routes/
  project-tabs.test.tsx` (the new tab enters the registry's generic
  sweep — ruler, panel, deep-link, unique order)
- **Edge case:** SecOps is NOT an executor — it enters the roster through the SAME
  `pr.gate_changed` that brings QA (Phase 4a, `rosterFactsFromEvents`), but
  stays in the Overview. `dev-lead` is in the executor list for
  completeness (RN-087 describes it as conversational), although today no
  path instantiates it in the session roster (the Dev Lead →
  `dev-<module>` delegation remains out of scope, ADR 0053 item 5).
- **Origin:** user request — its own "Executors" for dev agent and QA,
  outside the Overview's mixed grid.

---

## Session

### RN-123 — Creative session with no active Creative agent: the first message ALSO activates it {#rn-123}

In a `kind: 'criativa'` session ([RN-097](api.md#rn-097)) with no `agent.activated`
yet, sending the first message through the composer activates the Creative
agent first (waiting for activation to finish) and only then delivers that
message to it through the real path (`sendAgentMessage` — history, system
prompt, `emit_artifact` tool). Before this rule, whoever typed without
clicking "Start ideation" fell into a generic SSE chat with no history and no
business rules: it was NOT the real Creative agent, and the conversation
recorded nothing in the domain.

The "Start ideation" click still exists ([RN-104](#rn-104)) — it's still
what triggers activation when the person prefers the explicit gesture, and
it's from it that the owner's key ([RN-058](api.md#rn-058)) starts being spent on
either of the two paths. What changed is that the FIRST MESSAGE now also
counts as that gesture: no one should need a separate click before talking
to whoever the screen already invited them to talk to.

- **Where:** `apps/web/src/routes/SessionPage.tsx:678` (`handleSend`)
- **Test:** `apps/web/src/routes/SessionPage.ideacao-automatica.test.tsx`
- **Edge case:** a `consultiva` session has no Creative agent — the rule
  doesn't apply, and the generic SSE path stays the right one for it.

## Projects panel

### RN-124 — The PO narrates epic/story created in the thread, with a direct link to the Backlog {#rn-124}

`backlog.epic_created`/`backlog.story_created` — which the PO already recorded in the
event log (`CreateEpicUseCase`/`CreateStoryUseCase`) — had no
handling at all in the session timeline: creating a story left NO trace
in the thread, only in the Backlog tab, for those who already knew to go look there. The two
types get an entry in the timeline, in the SAME visual body as the agent's other
messages (`.message`/`.bubble`) — no new class for the chip
itself, only the link.

The link ("See in Backlog") reuses the tab's generic deep-link (`?tab=backlog`,
the same mechanism as the dashboard card's "Set budget" CTA) — it doesn't
try to highlight the newly created story inside the tab, which is out of scope.

- **Where:** `apps/web/src/routes/SessionPage.tsx` (`timeline` — the
  `backlog.epic_created`/`backlog.story_created` block)
- **Test:** `apps/web/src/routes/SessionPage.handoff-inline-e-links.test.tsx`
  (`item 2`)
- **Verified by real execution:** epic and story inserted into the event log
  of a real session appear as "Epic created"/"Story created" with the
  title, and the link navigates to `?tab=backlog` for real.
- **Origin:** user request — link from the PO to the created stories, straight
  to the Backlog.

### RN-125 — Handoff acceptance is INLINE in the thread, with a CTA for the Dev Lead pointing to Executors {#rn-125}

The "X passed the baton to Y" divider that already existed in the timeline (`handoff.offered`)
becomes an **actionable card** — with the accept button embedded — whenever it
represents the **current** pending offer (the same one `offeredHandoff` already
resolved for the topbar button). The topbar button **was removed**: with acceptance
living inside the thread, at the exact place where the handover happened, keeping
both would pull two buttons with IDENTICAL text visible at the same time — the
same problem `ApprovalCard` already avoids by never duplicating the action outside the
thread (RN-096).

**Which event becomes the card is decided by PAIR, not by id.** The
`handoff.offered` payload carries only `toAgent`; the `fromAgent` is the event's `actor`
(RN-054 already used that reading for the divider text). Without the handoff id
in the event, "this is the current offer" is answered by finding the most RECENT
`handoff.offered` (highest `seq`) with the SAME `fromAgent`/`toAgent` pair as
`offeredHandoff` — which prevents reopening an accept invite that an older
offer for the same pair has already resolved (accepted, declined, or superseded
by a new offer).

**The card for the Dev Lead gets a second link**, "Follow the execution in
Executors", to the tab that already exists (RN-121) — it's the start of EXECUTION, and whoever
accepts needs to know where to look afterwards. The other offers (PO, Arquiteto…)
don't get the link: their session remains the place to follow along itself,
there's no "elsewhere to look".

- **Where:** `apps/web/src/routes/SessionPage.tsx` (`timeline` — the
  `handoff.offered` block, `offeredHandoffEventSeq`; `isActive` moved to before the
  `useMemo`), `apps/web/src/routes/SessionPage.module.css` (`.handoffCard`,
  `.timelineLink`)
- **Test:** `apps/web/src/routes/SessionPage.handoff-inline-e-links.test.tsx`
  (actionable card only on the current offer, an old offer of the same pair stays silent,
  an already-accepted handoff shows no button, Executors link only on
  `dev-lead`); `apps/web/src/routes/SessionPage.pista-e-status.test.tsx`
  updated for the inline button (no longer in the topbar)
- **Verified by real execution:** accepting a handoff to the PO in a creative
  session against an isolated build (its own Docker stack, real project/session)
  — the card becomes a silent divider and the event log advances as soon as the
  click returns from the api; the CTA for the Dev Lead navigates to `?tab=executores` for
  real.
- **Origin:** user request — handoff acceptance also inline in the thread,
  not only in the topbar.

### RN-126 — Story promotion is decidable INLINE in the thread, with the same mechanism as the Backlog tab {#rn-126}

`backlog.story_promotion_proposed` (RN-048) gets the same treatment that
RN-125 gave to the handoff: the event becomes an **actionable card** in the session
timeline, with the "Promote" and "Return" buttons calling the SAME
`promoteStories`/`returnStory` that `PromotionQueue`
(`ProjectBacklogTab.tsx`) already uses — no new endpoint, no second
source of truth. The decision still happens in ONE place (the backend), only
the trigger gained a second path.

**Resolution by later event, not by separately derived status.** The card
disappears on its own (becomes a silent divider, without buttons) as soon as an event with a
GREATER seq decides the fate of the SAME story —
`backlog.story_transitioned{storyId}` (promoted, emitted by
`PromoteStoriesUseCase` via `TransitionStoryUseCase`) or
`backlog.story_promotion_returned{storyId}` (returned). Without that check,
promoting or returning would leave the same two buttons planted in the thread,
offering again a decision already made.

`backlog.story_promotion_returned` gets symmetric narration in the thread (reason
included), reusing the same sentence that `apps/web/src/lib/activity.ts` already
used only in the sidebar's collapsed log.

- **Where:** `apps/web/src/routes/SessionPage.tsx` (`timeline` — the
  `backlog.story_promotion_proposed`/`backlog.story_promotion_returned` blocks,
  `handlePromoteStory`/`handleReturnStory`, reason modal reusing
  `Modal`/`Textarea`)
- **Test:** `apps/web/src/routes/SessionPage.promocao-inline-e-volta.test.tsx`
  (card with the buttons, promoting calls `promoteStories` with the payload's
  `storyId`, returning requires a reason and calls `returnStory`, a story resolved
  by a later `story_transitioned` becomes a silent divider, `story_promotion_returned`
  narrates with the reason)
- **Origin:** user request — inline story promotion in the thread, a cheap
  option reusing RN-048 instead of gating story creation.

### RN-131 — Three races confirmed LIVE in the session thread: invite over the history, anxious indicator, and a turn stuck in `handleReadiness` {#rn-131}

Three defects found by actually navigating `SessionPage.tsx` in Chrome, not
by test — and all three were race conditions or an incomplete criterion
disguised as a product decision.

**1. `conversaComecou` became "ANY event exists", not "a
`chat.message`/`agent.response` exists".** The previous criterion (finding G) was born
so as not to confuse the git bootstrap cards with conversation, but had the
opposite effect: a session created by `git-bootstrap` (commit/branch
actions already approved, zero `chat.message`) showed the invite on
top of them, and the same happened — much more seriously — in the session that
execution activation uses, with dozens of real events (`tool.call`,
`tool.result`, task events) and no `chat.message`/`agent.response`: the
invite covered the **entire** execution history. A new session is the only one
with no event at all — that's the right question.

**2. `conviteVisivel` waits for `useSessionEvents` to finish loading.** With a
cold cache (page reload), `session` could arrive while `events`
was still `[]` — the default of `data?.items`, indistinguishable from "truly empty
session" until the first fetch resolved. Without the
`!eventsQuery.isPending` gate, the invite flickered over sessions with a
large history.

**3. The "thinking" indicator (bubble with the 3 dots) only turns on after
5s with no text arriving.** Before, it turned on the instant
`streaming`/`statusAgent` became truthy — visual noise on most
turns, which answer in under a second. A `useEffect` arms a
`setTimeout(…, 5000)` when the turn starts with no text yet, and disarms it (via
cleanup) as soon as the first delta arrives or the turn ends before the deadline.
Real text (`streamingText`) still appears **immediately**, never
waits for the timer — only the empty indicator gained patience.

**4. `handleReadiness` got the same safety net that `handleSend` already
had.** `confirmReadiness` is, like `sendAgentMessage`, a synchronous
`GenServer.call` in the engine (up to 120s) — and the Phoenix channel may not have finished
connecting (ticket + join, RN-108) when the turn ends, losing the
`agent.done` broadcast forever. `handleSend` already called
`finalizarTurnoDoAgente()` as soon as the synchronous call resolved,
regardless of whether the channel had delivered the event; `handleReadiness` had been
left out of that fix, and without it the agent's bubble stayed stuck empty
(`streaming: true`, no text) until the page reloaded.

- **Where:** `apps/web/src/routes/SessionPage.tsx` (`conversaComecou`,
  `conviteVisivel`, the `pensandoVisivel` `useEffect` right below
  `agenteExibido`, and the success block of `handleReadiness`)
- **Test:**
  `apps/web/src/routes/SessionPage.convite-so-em-sessao-vazia.test.tsx`
  (an empty session shows the invite; a session with git-bootstrap events or with
  dozens of `tool.call`/`tool.result` hides it; `eventsQuery.isPending`
  holds the invite until the first fetch resolves),
  `apps/web/src/routes/SessionPage.pista-e-status.test.tsx` (finding B —
  the indicator doesn't appear before 5s, appears after, disappears on the first delta,
  and never appears when the turn ends before the deadline), and
  `apps/web/src/routes/SessionPage.readiness-turno-preso.test.tsx`
  (`confirmReadiness` resolving without `onAgentDone` reconciles the state
  the same way `SessionPage.turno-preso.test.tsx` already proves for
  `handleSend`)
- **Origin:** LIVE investigation of the product in Chrome — all three reproduced
  manually before the fix.

### RN-136 — The actionable handoff card in the chat only considers those who CONVERSE on this screen {#rn-136}

> **Since [ADR 0185](../adr/0185-estou-pronto-fecha-os-dois-gates.md)
> ([RN-658](api.md#rn-658))** the Criativo→PO handoff that "I'm ready" requested
> is born and accepted in the same call, on behalf of whoever clicked — its
> accept card only appears when that acceptance doesn't fit (a session predating the ADR,
> a brief that didn't come from the click) or failed. The filter below doesn't change.

`OfferInfraHandoffUseCase` offers the handoff to Infra and, in the SAME
confirmation, offers it to the Dev Lead right after (PHASE 14d) — two separate
calls, the Infra one first. `handoffs` (what `SessionPage.tsx` reads from
`useHandoffs`) comes sorted by `createdAt` ASC
(`DrizzleHandoffRepository#findBySession`), and the `offeredHandoff` that decides
which card becomes "actionable" resolved with a plain `.find()` — always the
**oldest** `offered`. Since the Infra Lead isn't conversational (it isn't
in `AGENTES_DE_CHAT`, and is never accepted by this screen), the Dev Lead's card would only
become actionable after someone accepted the Infra one in a place this
screen doesn't show — in practice, never: the user only saw "accept handoff from
Infra" and the invite for the Dev Lead stayed invisible behind it.

The filter restricts `offeredHandoff` to handoffs addressed to an agent of
`AGENTES_DE_CHAT`. The handoff to Infra is still **narrated** in the thread — its
`handoff.offered` becomes a silent divider, like any offer that isn't "the
current one" — only the card with a button now ignores it: Infra never had (nor
needs to have) a way to be accepted from here.

- **Where:** `apps/web/src/routes/SessionPage.tsx` (`offeredHandoff`)
- **Test:**
  `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`,
  describe "problema 1" — older Infra + newer Dev Lead resolves to the
  Dev Lead's card, never to Infra's; only Infra `offered` shows no card
  at all
- **Origin:** code investigation + live test in Chrome — the handoff
  to the Dev Lead never became actionable after PHASE 14d

### RN-137 — "Activate execution" has an inline shortcut on the Dev Lead card, without lowering the role requirement {#rn-137}

The accept card of the handoff to the Dev Lead gained an "Activate execution" button
next to the "Follow the execution in Executors" link — a shortcut for those who already
know what they want, without going through the conversation. It calls the SAME
`activateExecution` that the Overview uses, now with `sessionId` (the open
chat session) as `originSessionId` — without this the session that brought the
Dev Lead stayed `active` forever, even with execution (in a
SEPARATE session) having already taken off through this shortcut ([RN-135](api.md#rn-135)).

**The route still requires `maintainer`** — DELIBERATELY not aligned with the
`developer` that already suffices to accept the handoff on the same card. Whoever activates
becomes the `session.createdBy` of the execution session, and that's the role that
`ProposeActionUseCase` resolves (`ResolveEffectiveRoleUseCase.forProject`)
as the EFFECTIVE one of every `git_commit`/`git_push`/`pr_open` the dev agents
propose from then on — it's the same reason that already justified the
`maintainer` of the Overview button
(`ExecutionController#activate`). Lowering the requirement here would silently invert that
resolution: every PR the execution opened would go from
`auto_approve` to `require_approval` whenever whoever clicked was
`developer`, without anyone having decided that. Whoever isn't `maintainer` receives
the api's real sentence ("Papel insuficiente para esta ação", via
`mensagemDaApi`) instead of a generic error.

No client-side `module_map` gate: when this card exists, the Arquiteto
has already defined it — it's the artifact that precedes the handoff offer to the Dev Lead —,
so replicating the Overview's `disabled={!hasModuleMap}` would lock the button
for nothing. The rare case (inconsistent session) falls into the same catch that handles
403/other errors.

- **Where:** `apps/web/src/routes/SessionPage.tsx`
  (`handleActivateExecution`), `apps/web/src/lib/api-client.ts`
  (`activateExecution` gained `originSessionId`)
- **Test:**
  `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`,
  describe "problema 2" — the click calls `activateExecution` with
  `sessionId`; 403 shows the api's real sentence; the button coexists with the
  accept-handoff one and with the Executors link
- **Origin:** code investigation + live test in Chrome — shortcut request,
  with the role divergence confirmed and kept by decision
  (not fixed by automatic alignment)

### RN-138 — An agent's messages collapse after it passes the baton {#rn-138}

The chat timeline showed everything always expanded, without grouping by author —
in a long session with Criativo, PO, and Arquiteto taking turns, the history of
those who already left the scene competed for space with whoever is speaking now. Each
timeline entry gained an `agentId` (the `actor.id` of whoever generated it,
when it's an agent — `agent.response`, `agent.error`, epic/story
created by the PO, approval card); user entries and those that mark
a TRANSITION (handoff, story promotion) are left without `agentId` on
purpose, because they're cut points by nature.

A CONSECUTIVE sequence of the same `agentId` becomes a collapsible header
(the design system's `Disclosure`, closed by default — agent name +
count, reopens with one click) when both conditions hold:

1. **the agent has already passed the baton** — there's a handoff from it (`fromAgent`)
   with `status: 'accepted'` (the same truth the event log's `handoff.accepted`
   records, without needing to rebuild by joining events); and
2. **none of its actions is `pending`** — the check is by `actor.id` across
   ALL the session's `actions`, not only those in the current sequence: an
   open approval race can't stay hidden behind a click at ANY point of the thread.

A sequence of 1 entry never collapses — "So-and-so · 1 message" in place
of the message itself gains nothing. Any entry without `agentId`, or from
a different agent, breaks the current sequence exactly as a change
of agent does — it only groups what is really consecutive.

- **Where:** `apps/web/src/routes/SessionPage.tsx` (`TimelineEntry.agentId`,
  `timelineAgrupada`), `apps/web/src/routes/SessionPage.module.css`
  (`.agentGroup*`)
- **Test:**
  `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`,
  describe "problema 3" — collapses with the baton passed and no pending action;
  doesn't collapse without an accepted handoff; doesn't collapse with a pending action from the same
  agent; a message from another author in the middle breaks the grouping
- **Origin:** code investigation + live test in Chrome — collapse
  request, with `AgentTimelineTree`/`timeline-tree.ts` as the reference of
  FORM (group by agent, name + count, open/closed), adapted to the
  chat's heterogeneous interleaved timeline

---

### RN-144 — The Criativo tab does not list the current execution session {#rn-144}

The session that receives `execution.activated` and the dev agents' tool-call events
must be born with `kind: 'criativa'` — a structural rule (RN-097,
`garantirQuePodeAtivarExecucao`), without which the event is refused. Since
`ProjectSessionsTab` (the Criativo tab, RN-104) lists sessions filtering only by
`session.kind === 'criativa'`, the execution session appeared MIXED in the
list next to real ideations — opening it in `SessionPage.tsx` shows
a whole timeline of dev agent tool-calls, looking (to the user) like "the
dev writing in the Criativo's chat". Confirmed live: a real session with
35+ dev agent events appeared normally in the list, next to real
ideation sessions.

The fix reuses the signal that [RN-139](api.md#rn-139) already exposes —
`useActiveExecutionSession`/`GET /projects/:projectId/execution/session` — instead
of the backend computing a new field per session (`hasExecutionActivated`
or equivalent). The Criativo tab fetches the current session and excludes it from the rendered
list:

- the fetch only runs on the Criativo tab (`enabled` off when `kind !==
  'criativa'`) — the Chat tab never made that call and still does not;
- the filter is by `id`, after the existing filter by `kind` — it does not change
  what the list IS, only what it EXCLUDES.

**Deliberate scope decision:** this covers only the CURRENT execution, not
OLD executions already closed (`execution.activated` written in a session
that is now `closed`). Computing that would require the backend to annotate, per session,
whether it has the event written — a change in the repository and in the listing
endpoint, for a residual case: an OLD execution session appears with the
`closed` badge, which already signals "this is not an active ideation" in a much
less ambiguous way than the current one (which appeared `active`, indistinguishable from an
ideation in progress). If this becomes confusing again in practice, the way out is the
listing endpoint returning the signal per session — not one more `filter` in the
front per old session.

- **Where:** `apps/web/src/routes/ProjectSessionsTab.tsx`
  (`ProjectSessionsTab`)
- **Test:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — the current one
  disappears from the Criativo list with normal sessions next to it, the Chat tab does not call the
  current-execution fetch, and without a current execution (`null`) the list appears
  whole
- **Origin:** finding from code investigation + live test — a real session
  with active execution appearing mixed in the Criativo tab

### RN-147 — The collapsed group header shows the agent's icon, not just the name {#rn-147}

The `Disclosure` of `timelineAgrupada` ([RN-138](#rn-138)) received only the STRING
of the name in `titulo` — each expanded message already has an avatar (`.avatar` +
icon), and the collapsed header lost that visual cue precisely where it
helps most to scan the thread.

`AvatarDoAgente` reuses the SAME `.avatar` box as the expanded messages, but
the chosen icon is the ROSTER's (`AGENTS[id].icon`) — the same source that already
identifies "who is talking" in the streaming indicator (`agenteExibido.icon`,
[RN-131](#rn-131)) — and not the per-event-TYPE icon each expanded
entry uses (`ModelIcon` in `agent.response`, `StackIcon` in
`backlog.*_created`, `AlertCircleIcon` in `agent.error`). A collapsed group
can mix those entry types from the same agent; the header
represents the AGENT, not its last entry, and only the roster icon is
stable for that. Without `id`, or an agent outside the roster, it degrades to
`ModelIcon` — never to an empty box.

- **Where:** `apps/web/src/routes/SessionPage.tsx` (`AvatarDoAgente`,
  `timelineAgrupada`), `apps/web/src/routes/SessionPage.module.css`
  (`.agentGroupTitulo`)
- **Test:** `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`,
  describe "problema 3" — the collapsed header has the PATH of the PO's icon
  (`UserIcon`), not just a generic decorative SVG
- **Origin:** code investigation — `Disclosure` already accepted `ReactNode`
  in `titulo`; passing the avatar together with the name was what was missing

### RN-148 — Stories with promotion pending at the same time become a carousel, not N cards {#rn-148}

The PO creates stories one by one, and each `backlog.story_promotion_proposed`
([RN-126](#rn-126)) became a standalone card in the timeline — in a batch of several
stories, that stacked N identical cards competing for the same space,
mixed with the rest of the narration.

A **batch** is the set of promotion proposals STILL PENDING in the
session, evaluated on each render — not "created in sequence without
interruption". The criterion is the SAME one each standalone card already used on its own
to decide whether it became an actionable card or a divider (no later
`backlog.story_transitioned`/`backlog.story_promotion_returned`
with the same `storyId`), only looked at at once for the whole session:

- **0 or 1 pending:** nothing changes — the usual standalone card (the degradation is
  deliberate: a one-slide carousel gains nothing by becoming a carousel).
- **2+ pending at the same time:** they become ONE `Carousel` (new in the design
  system, `apps/web/src/components/ui/Carousel.tsx`), inserted at the position
  of the FIRST proposal still pending; the others disappear as individual
  cards — each one becomes a SLIDE of it. Each slide shows the same
  sentence as the standalone card ("história … pronta, aguardando sua promoção"), a
  summary/RF if the payload carries one (today it does not — see below), and the
  Promover/Devolver buttons of that specific story, calling the SAME
  `promoteStories`/`returnStory` as always.
- **"Aprovar todas"** in the carousel header calls `promoteStories` with
  the ids of ALL pending ones in a single call — the endpoint was already a batch
  (`promoteStories(projectId, storyIds[])`, RN-048), so there was no contract
  change at all, only in who builds the list.
- A story resolved (promoted or returned) while the carousel is
  open leaves the batch on the next render (the events query is invalidated in
  both actions) — if only 1 pending is left, the carousel dissolves on its own and the
  card becomes standalone again.

`resumo`/RF in the slide is a READY field, not used: `CreateStoryUseCase` today only
writes `storyId`/`epicId`/`title` in the payload of `backlog.story_promotion_proposed`
— no description nor functional requirements. The slide already knows how to display
`description`/`rf` if the payload ever carries them (it degrades to the title alone
until then); extending the payload was left out of this delivery, since it was not
asked for.

- **Where:** `apps/web/src/components/ui/Carousel.tsx` (new component,
  generic navigation), `apps/web/src/routes/SessionPage.tsx`
  (`promocoesPendentes`, `ehLevaDeHistorias`, `StorySlide`,
  `handlePromoteAll`), `apps/web/src/routes/SessionPage.module.css`
  (`.storySlide`)
- **Test:** `apps/web/src/components/ui/Carousel.test.tsx` (navigation,
  ARIA, only the current slide mounted, index clamped when the list shrinks),
  `apps/web/src/routes/SessionPage.carrossel-historias.test.tsx` (3+
  pending become a carousel; "Aprovar todas" sends the whole batch; single promotion
  and return keep working from a navigated
  slide; 1 pending degrades to the simple card; a resolved story leaves the
  batch and the carousel recomputes the count)
- **Origin:** user request — stories produced in batch by the PO
  were hard to decide one by one in the thread

### RN-152 — A task's branch says which dev agent and module it belongs to, in the Code tab dropdown {#rn-152}

`CodeBranchPicker` already listed every branch of the repository, including those of the
dev agents (`feature/task-XXXXXXXX`, `Engine.Dev.AgentIo`), but with no hint
at all of who created it — only the raw name. `ReadProjectCodeUseCase.branches`
solves this without an extra call to the git provider: the 8 chars after
`feature/task-` are exactly the first hyphenated group of the task's uuid
(`"feature/task-" <> String.slice(to_string(row.task_id), 0, 8)`, not an
arbitrary substring), so they match against `TaskRepository
.findByProjectAndIdPrefix` (join by PROJECT, so an 8-char prefix never
leaks a task from another project). The task's `assignedTo` is the agent_id
(`dev-<modulo>`/`dev-<modulo>-2`, RN-087); the module is resolved by comparing
against the project's CURRENT `module_map` with the SAME functions that generated them
(`devAgentId`/`extraDevAgentId` in `activate-execution.use-case.ts`) — never
by reverse regex, which would degenerate into ambiguity for a module name with
a special character.

`producedBy: { agentId, moduleId } | null` is honest degradation, the same
way `ahead`/`behind` already are: `null` for a branch without the pattern (the user's manual
one, or `main`/`dev`/`qa`), and also when the pattern matches but the
task/module are no longer resolvable (task deleted, module removed from the current
map) — never an invented value. In the dropdown, each branch produced by
a dev gets the agent's icon and color (`AGENTS`/`agents.ts`, RN-087),
reusing the SAME degradation that `apps/web/src/lib/agent-status.ts` already
uses for the live roster: a module without a fixed key in `AGENTS` inherits the icon/color of
`dev-backend`.

- **Where:** `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (`branches`/`producedBy`/`moduloDoAgente`),
  `apps/api/src/application/ports/backlog-repository.port.ts`
  (`TaskRepository.findByProjectAndIdPrefix`),
  `apps/api/src/infrastructure/persistence/drizzle/backlog.repository.ts`,
  `apps/api/src/interfaces/http/git/dto/code.response.dto.ts`
  (`CodeBranchProducedByResponseDto`), `apps/web/src/lib/api-types.ts`
  (`CodeBranchProducedBy`), `apps/web/src/routes/code/CodeBranchPicker.tsx`
  (`IconeDoAgenteProdutor`/`defDoAgenteProdutor`)
- **Test:**
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (describe "producedBy da branch de task" — task resolved with module and with
  the extra agent `-2`, a branch outside the pattern never gets `producedBy` even
  with a task of matchable prefix, prefix without a task in the project, module removed
  from the current map and task without an owner yet degrade to `null`),
  `apps/web/src/routes/code/CodeBranchPicker.test.tsx` (a task branch shows
  the owning dev agent's badge; a branch without the pattern gets no badge at all)
- **Origin:** user request — no visual hint of who created the
  branch in the rich dropdown of FASE 26b

### RN-156 — the 5s wait indicator has fixed text, without interpolating the agent {#rn-156}

The indicator that appears after 5s without a response (`pensandoVisivel`) shows
the fixed sentence "Reunindo informações...", without the agent's name interpolated —
it replaces the previous text "{Agente} está escrevendo…". The agent's name is already
visible in the header as soon as the real text streaming starts; repeating it
in the wait indicator did not help reading.

- **Where:** `apps/web/src/routes/SessionPage.tsx`
- **Test:** `apps/web/src/routes/SessionPage.pista-e-status.test.tsx`,
  `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
- **Origin:** finding from PR #286 — the previous text named an agent that was already
  visible in the header

### RN-157 — epic/story creation by the PO becomes a compact notice, not a full bubble {#rn-157}

The `backlog.epic_created`/`backlog.story_created` events no longer
render as a full message bubble (`.message`/`.bubble`, 32px avatar
— the same visual weight as a real agent response) and start
using the same compact notice format that `.handoffDivider`/`.handoffPill`
already uses for the baton pass: a centered line with a horizontal rule and a
compact pill, keeping the "Ver no Backlog" link. `agentId` remains
populated in the `TimelineEntry` — unlike the handoff divider, this does not
mark a transition between agents, it is an action by the PO within their own turn,
and it remains eligible for per-agent collapsing ([RN-138](#rn-138)).

- **Where:** `apps/web/src/routes/SessionPage.tsx`
- **Test:** `apps/web/src/routes/SessionPage.handoff-inline-e-links.test.tsx`,
  `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
- **Origin:** finding from PR #286 — the full bubble had visual weight equal to
  a real agent response, for a metadata action by the PO

### RN-158 — Light Markdown with highlighting in the chat {#rn-158}

`agent.response` in the Session thread renders a subset of Markdown
(bold `**texto**`, italic `*texto*`/`_texto_`, inline code
`` `texto` ``, heading `#`/`##`/`###`, list `-`/`1.`, link
`[texto](url)` and code fence ```` ```linguagem ````), via its own
regex parser (`apps/web/src/lib/markdown.ts`), with no new dependency.
`chat.message` (text typed by the user) stays literal — Markdown
only applies to the OUTPUT of an agent/LLM, never to human input.

Security: the parser never produces HTML — it returns a data tree that
`MarkdownMessage.tsx` converts into React elements directly (never
`dangerouslySetInnerHTML`). A link only becomes a clickable `<a href>` when the
URL scheme is `http`, `https` or relative (`/...`, `#...`); any
other scheme (`javascript:`, `data:`, etc.) degrades to the link text,
never to an executable `href`.

Code inside a fence gets per-token highlighting, reusing
`highlightLine`/`highlightFile` from `apps/web/src/routes/code/highlight.ts`
— the same function that already colors the Code tab. `sh`/`bash` gained
their own shell keyword vocabulary (before, they only had the
`#` line comment mapped and fell into the JS fallback). Fences
```` ```sh ````/```` ```bash ```` get the visual aesthetics of a terminal
(`$` prompt per command line), consistent with the `$ comando` that
`ApprovalCard` already uses for the `terminal` action.

- **Where:** `apps/web/src/lib/markdown.ts`,
  `apps/web/src/components/ui/MarkdownMessage.tsx`,
  `apps/web/src/routes/code/highlight.ts`
- **Test:** `apps/web/src/lib/markdown.test.ts`,
  `apps/web/src/components/ui/MarkdownMessage.test.tsx`,
  `apps/web/src/routes/code/highlight.test.ts`,
  `apps/web/src/routes/SessionPage.markdown-resposta.test.tsx`
- **Origin:** PR #288 — agent responses with lists, code and links
  arrived as raw text in the thread, with no structure at all

### RN-159 — Generated Artifacts grouped by agent {#rn-159}

The Session's "Artefatos gerados" panel (`ContextAside` in
`SessionPage.tsx`) lists dev PRs (`pr_open`), the Arquiteto's ADR PRs
(`open_adr_pr`) and epics/stories created by the PO
(`backlog.epic_created`/`backlog.story_created`), grouped by
`agentId` — who generated each artifact — with the same collapsible
`Disclosure` pattern of [RN-138](#rn-138) (agent name + count,
expandable to the title of each artifact).

Each artifact navigates to the place where it lives: a PR (dev or ADR) opens the real
URL (`executionResult.pullRequestUrl`, the same field that
`ProjectOverviewTab.tsx` already reads for an ADR PR); epic/story navigates
to `/projects/:projectId?tab=backlog` (the same `Link` pattern already used in the
PO's compact notices in the main thread, [RN-124](#rn-124)/
[RN-157](#rn-157)). A PR still without `pullRequestUrl` (pending execution)
appears in the panel without becoming a clickable link.

Out of scope, by a decision recorded in a code comment
(`ContextAside` in `SessionPage.tsx`): module_map/C4 — they are the project's
CURRENT state (one current version, overwritten on each generation), not
an artifact dated per SESSION like PR/epic/story; the Overview tab
(`ProjectOverviewTab.tsx`) is already their place today, without an anchor of their own —
addressing that is out of the scope of this delivery.

- **Where:** `apps/web/src/routes/SessionPage.tsx` (`ContextAside`)
- **Test:** `apps/web/src/routes/SessionPage.artefatos-gerados.test.tsx`
- **Origin:** PR #288 — the panel did not distinguish who generated each artifact
  nor covered ADR PRs and epics/stories, only dev PRs

### RN-160 — "Confirmar arquitetura pronta" requires at least 1 promoted story {#rn-160}

The "Confirmar arquitetura pronta" button (Arquiteto→Dev Lead handoff, via
`confirmArchitectureReadiness`) is born `disabled` until the project's backlog has
at least 1 story with a status other than `draft` — that is, already
promoted by `PromoteStoriesUseCase`/`TransitionStoryUseCase` ([RN-048](api.md#rn-048)),
having a captured business rule not being enough. `in_progress`/`done` also
count, because one only gets there having gone through `ready`. The source is the SAME
the Backlog tab already uses (`useBacklog`, `ProjectBacklogTab.tsx`, the same
queryKey `['backlog', projectId]`) — no new round trip. While there is no
promoted story, the button shows the hint in `title` explaining the reason.

- **Where:** `apps/web/src/routes/SessionPage.tsx` (`hasPromotedStory`,
  button render)
- **Test:** `apps/web/src/routes/SessionPage.readiness-arquitetura-exige-historia.test.tsx`
- **Origin:** user request — the Arquiteto→Dev Lead handoff button
  had no gate at all

It only held on the CLIENT: a direct HTTP call ignored the rule. Closed by
[RN-404](api.md#rn-404) (ADR 0094), which revalidates on the backend.

### RN-161 — Accepting the handoff to the Dev Lead chains execution activation when the effective role already authorizes it {#rn-161}

> **Revised by [RN-677](api.md#rn-677) (ADR 0194, owner's decision
> on 10/01):** accepting the handoff to the Dev Lead stopped chaining the activation
> of execution, for EVERY role — the acceptance only brings it to PLAN, and what activates
> is the APPROVAL of its plan (`propose_execution_plan`). The text below
> describes the fusion as it was.

`handleAcceptHandoff` (`SessionPage.tsx`) chains `activateExecution`
automatically when `toAgent === 'dev-lead'` AND the EFFECTIVE role of whoever
accepts — read from the same `useCurrentWorkspaceWithRole()` that already authorizes
"Auto mode" ([RN-153](api.md#rn-153)) and the Approvals/Settings screens — is
`owner` or `maintainer`. For `developer` (or a role not yet resolved), the
current flow remains untouched: accepting activates nothing, and "Ativar execução"
remains as a second button. The check is client-only —
`POST .../execution/activate` still requires `maintainer` on the backend
([RN-137](#rn-137)); the fusion only avoids a redundant click for whoever already
had both roles. It reuses the SAME `handleActivateExecution` that the
"Ativar execução" button already calls, which handles its own error (toast +
`mensagemDaApi`) and never rethrows — it avoids a late activation error
being reported as "não foi possível aceitar o handoff".

- **Where:** `apps/web/src/routes/SessionPage.tsx`
  (`podeFundirHandoffComExecucao`, `handleAcceptHandoff`)
- **Test:** `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`,
  describe "problema 4"
- **Architectural decision:** [ADR 0069](../adr/0069-fusao-condicional-do-handoff-com-a-ativacao-de-execucao.md)
- **Origin:** user request (approved design)

### RN-172 — Handoff and approval are the OUTCOME of the turn {#rn-172}

In the session thread, the **offered handoff** and the **approval card** appear
AFTER the last utterance of the turn in which they were born — never in the middle of it.

This **does not fix ordering**: RN-155 remains fully in force, and the
timeline stays ordered by the event log's `seq`. What the log records is the
truth: `po_server.ex` (`run_turn/2`) emits, in the SAME iteration, the turn's
`agent.response`, THEN the `tool.call` of `offer_handoff` (which writes
`handoff.offered`) and ONLY THEN recurses to the closing `agent.response`.
The handoff's `seq` is honestly lower than the last utterance's. The same holds
for `proposed_action.created`, which is born in the middle of the turn while the agent
still has something to say. Showing "passed the baton" or "approve this" in the middle of the
conversation is a wrong reading of correct data — so the rule is about
PRESENTATION, applied in a separate and explicit pass
(`afundarDesfechos`), after the `sort` by `seq`, and not hidden in a
three-term comparator.

Different turns **never mix**. An outcome sinks to the end of the
stretch right below it and stops at the first entry that fails any of the
three conditions:

1. **same turn** — the turn is the `seq` of the last OPENING before the entry, and
   an opening is an event with actor `user` (`chat.message`, `agent.activated`,
   story promotion/return). It protects the case in which the boundary between
   two turns has no VISIBLE entry at all: `agent.activated` opens a turn and
   does not become a thread item.
2. **same author** — in an EXECUTION session several agents write without the
   user speaking a single time, and all of them stay in the same turn; one's outcome
   cannot cross another's utterance.
3. **is not an outcome** — two consecutive outcomes preserve the order between them (the
   Infra's `handoff.offered` before the Dev Lead's, in the same confirmation).

The `system` actor does NOT open a turn: it is infrastructure noise in the middle of the thread, not
a decision of whoever is conversing.

- **Where:** `apps/web/src/routes/SessionPage.tsx`
  (`aberturasDeTurno`, `turnoDoSeq`, `afundarDesfechos`, and the
  `autor`/`turno`/`desfecho` fields of `TimelineEntry`)
- **Test:** `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
  (describes "RN-172 — turno e desfecho (unidade)" and "RN-172 — a sequência
  REAL do engine, renderizada")
- **Origin:** real use on `exp001` — "a passagem de bastão do PO para o
  arquiteto está aparecendo acima da última mensagem do PO" and "a mensagem de
  aprovação apareceu acima do chat do arquiteto até ele finalizar a resposta"

---

### RN-173 — The thread follows everything that grows, and only for whoever was already at the end {#rn-173}

The chat scrolls to the end when the content grows — **and not only when a new
event arrives**. The two timeline sources are SEPARATE queries (`events` and
`actions`), and the height still changes without either of them: opening/closing a
`Disclosure` (per-agent collapse of RN-138, the approval card's "Detalhes"),
Markdown reflowing, a diagram rendering later. That is why there are two
mechanisms: the effect's dependencies cover what React knows
(`events.length`, `actions.length`, `streamingText`), and a `ResizeObserver`
over the thread's CONTENT covers what only the layout knows.

The guard remains **unchanged and deliberate**: it only scrolls whoever is already less than
120px from the end. Whoever scrolled up to reread the history is not dragged — the thread follows
the conversation, it does not hijack the reading.

In the same thread, the approval card no longer takes up the whole 780px of the
column: it gets a ceiling of 560px and is centered, as
`.handoffCard`/`.handoffDivider` already are. Indenting 45px like the bubbles would be
wrong — the card is nobody's utterance, it is a decision asked of the user. The
Approvals tab queue does not change: there the card MUST fill the grid column.
Since AT-322 the card is ONE single card on every surface and fills the container —
what applies the ceiling and the centering in the thread is its container
(`.acaoNoFio`), no longer a variant of the card.

- **Where:** `apps/web/src/routes/SessionPage.tsx` (`acompanharOFim` and the two
  effects that call it); `apps/web/src/components/ApprovalCard.module.css`
  (`.card`) and `apps/web/src/routes/SessionPage.module.css` (`.acaoNoFio`)
- **Test:** `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
  (describe "RN-173 — o fio acompanha o que cresce", with the case of the user
  having scrolled up)
- **Origin:** real use on `exp001` — "o scroll do chat deve ficar sempre no
  final seguindo o chat" and "aprovação mal diagramado deve ficar ao centro"

### RN-174 — An action that triggers an agent turn arms the thread indicator {#rn-174}

The "the agent is working" indicator (the three dots after 5s,
[RN-131](#rn-131)/[RN-156](#rn-156)) only appears while `streaming` or
`statusAgent` hold, and they were turned on in three places: the composer
(`handleSend`), the readiness confirmations and the Phoenix channel. **Every screen
action that triggers a synchronous turn in the engine now arms it too.**

There are two, and neither of them is the composer:

1. **Answering the structured questions form** —
   `AnswerStructuredQuestionUseCase` reuses `SendAgentMessageUseCase`
   ([RN-162](engine.md#rn-162)), and the call only resolves after the whole turn.
2. **Returning a story to the PO** — `ReturnStoryUseCase` calls `reviseStory`,
   which is `handle_call({:revise, …})` in `po_server`: the HTTP response waits for the
   PO to rewrite the story.

The Phoenix channel does not cover the gap, and that is what makes the fix necessary
rather than redundant: when it has not finished connecting yet (ticket +
join, [RN-108](#rn-108)) the `agent.status` "working" broadcast has no
listener and is lost — the screen stays in absolute silence for dozens of seconds,
which is indistinguishable from "nothing is going to happen".

The pair is `iniciarTurnoDoAgente(agente)` **before** the `await` (the channel's
`agent.status` may arrive first, and without the agent pinned the indicator would be born without
knowing who is speaking) and `finalizarTurnoDoAgente()` in the `finally` — on BOTH
paths, because an error that left `streaming` on would lock the composer
until the next turn. Resolving the call is a signal of the end of the turn as reliable
as the channel's `agent.done`, and `finalizarTurnoDoAgente` is idempotent. The
5s deadline does not change: a turn that answers quickly still shows nothing.

- **Where:** `apps/web/src/routes/SessionPage.tsx` (`iniciarTurnoDoAgente`,
  `handleReturnStory`, `StructuredQuestionCard`)
- **Test:** `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx`
  and `apps/web/src/routes/SessionPage.promocao-inline-e-volta.test.tsx`
  (RN-174 describes, with the failure case proving the indicator does not get
  stuck)
- **Origin:** real use on `exp001` — "caso a web, api e engine demore mais de
  5s para ter uma resposta, a web deve apresentar uma animação no chat
  mostrando que o agente está pensando"

### RN-176 — A Markdown table in the thread becomes a real table {#rn-176}

The chat's light Markdown ([RN-158](#rn-158)) now recognizes a **GFM table** and
renders it with the design system's `Table` — the same component as
Settings, Spending and Executors, not a `<table>` of its own: "how Brabo
draws a table" is a single decision. Before, the Module Map table that the
Arquiteto writes in the response came out as a paragraph with literal pipes.

What distinguishes a table from prose with `|` is the **separator line**, and it is
mandatory as in GFM: without it the block remains a paragraph, so
"escolha entre a | b | c" does not become a table by mistake. The header rules the
number of columns — a short line gets an empty cell, a long line loses the
excess —, an escaped `\|` stays inside the cell, and the alignment comes from the
separator's colons. Zero new dependency: the parser remains its own,
regex-based, and the data tree keeps becoming React elements
directly (no `dangerouslySetInnerHTML`).

**The `artifact.module_map` artifact remains OUTSIDE the thread**, and the choice is
deliberate: it is the project's CURRENT state, not an artifact dated per session —
the same decision already recorded in [RN-159](#rn-159) —, and it lives in the Overview.
What the user asked for was the table **inside the message**, and that is what is now
drawn; the fix serves ANY agent that writes a table, and
not only the Module Map.

In the bubble, the table **scrolls horizontally** instead of squeezing columns: the thread is
~700px and a `module_map` has 4 columns.

- **Where:** `apps/web/src/lib/markdown.ts` (`table` block, `celulasDaLinha`),
  `apps/web/src/components/ui/MarkdownMessage.tsx` (`TabelaMarkdown`),
  `apps/web/src/components/ui/MarkdownMessage.module.css`
- **Test:** `apps/web/src/lib/markdown.test.ts` (describe "tabela (RN-176)"),
  `apps/web/src/components/ui/MarkdownMessage.test.tsx`
- **Origin:** real use on `exp001` — "a tabela dentro da mensagem do Mapa de
  Módulos do arquiteto tem que ficar bem estruturada em formato tabela,
  utilizar design system do próprio Brabo"

### RN-177 — The log shows everything, and the history collapses by ORIGIN {#rn-177}

The activity feed hid six event types (`tool.call`, `tool.result`,
`agent.response`, `agent.delta`, `agent.status`, `context.compacted`) **without
offering any alternative**: whoever wanted to see what the agent and the harness
exchange had to open the database. The filter remains, and remains
**off by default** — its reason has not changed (116 of 193 real events
were of these types, see `isMachineEvent`) —, but it became a **choice**: a
"Eventos de máquina" button on the same rail as the type chips.

Showing everything only solves half: a long session becomes a list nobody
goes through. That is why the **5 most recent stay open** and the rest goes into
collapses by **ORIGIN** — a NEW classification, which does not replace the
`ActivityKind`: `kind` says which SUBJECT the event talks about (commit, PR, permission)
and decides icon and color; `origem` says which LAYER it came from, and it is what makes the
history readable in handfuls. The six come from the data that exists — `actor.kind` and
the `type` prefix —, never from assumption:

| origin | what falls into it |
|---|---|
| `harness` | `tool.*`, `toolloop.*`, `agent.status`, `context.compacted` |
| `llm` | `agent.response`, `agent.delta`, `llm.*` |
| `usuario` | any event with `actor.kind === 'user'` |
| `sistema` | any event with `actor.kind === 'system'` |
| `agente` | remaining `agent.*`, `handoff.*`, `delegation.*`, an agent's `chat.*` |
| `eventos` | the domain event log (backlog, git, PR, artifact, bootstrap…) |

The **precedence** is what makes the classification predictable, and it is in the order of the
`if`s: mechanism (`harness`, `llm`) beats actor, because a `tool.call` belongs to the
harness whatever the actor; and actor beats agent prefix, because
`chat.message` exists on both sides and what distinguishes them is who spoke. A type that
nobody foresaw falls into `eventos` — it never disappears, never invents a category.

**The same rule holds in the session THREAD**, with the axis inverted: the thread is
ascending (the newest next to the composer), so the last 5 entries stay
open at the bottom and the collapsed history stays at the TOP. The cut is over the list
already grouped by agent ([RN-138](#rn-138)) — what counts is what the user sees, and
a collapse of twelve messages is ONE entry on screen. **Revised in the thread by
[RN-644](#rn-644):** there the cut counts only MESSAGES, goes back
to the opening of the turn and the history is ONE chronological block, not groups by
origin (which put the answer above the question). The log panel remains as
described here.

- **Where:** `apps/web/src/lib/activity.ts:94` (`OrigemDeEvento`), `:125`
  (`origemDoEvento`), `:152` (`agruparPorOrigem`);
  `apps/web/src/components/ActivityFeed.tsx:34` (the cut of 5), `:66` (the
  toggle); `apps/web/src/routes/session-fio.tsx:119` (the thread cut), `:291`
  (`dividirFio`); `apps/web/src/routes/SessionPage.tsx:516` (`fio`)
  toggle); `apps/web/src/routes/session-fio.tsx:119` (the thread cut), `:291`
  (`dividirFio`); `apps/web/src/routes/SessionPage.tsx:516` (`fio`)
- **Test:** `apps/web/src/lib/activity-origem.test.ts`,
  `apps/web/src/components/ActivityFeed.test.tsx` (describe "ordem,
  agrupamento e o toggle de máquina"),
  `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx` (describe
  "RN-177")
- **Origin:** real use on `exp001` — "em log de eventos mostrar também log do
  sistema, concentrar a mensagem em grupo, ou seja mantém as últimas 5
  mensagens mas abaixo vira o grupo de log de eventos, sistema, llm, harness,
  agente, usuário"

### RN-178 — The session panel reads from last to first, and the rules list paginates {#rn-178}

The four sections of the context panel (business rules, generated artifacts,
touched files and event log) were **ascending**: they opened at the start of the
session. In a session of thousands of events that delivers the wrong screen — whoever
opens the panel wants what just happened. All four became
**descending**, including inside the backlog tree ([RN-179](#rn-179)).

A consequence that came along: the feed's "Carregar mais antigos" button
([RN-099](#rn-099)) **switched sides**. It was ABOVE the list because the list
was ascending and the past was at the top; with the order inverted the past is
at the end, and a button at the top would ask to scroll in the direction opposite to what it
loads — the same argument as before, with the sign flipped.

And **above 5 rules the list paginates**, instead of growing endlessly: the panel has
the width of one column and an ideation session goes past twenty rules
effortlessly. The current page is resolved by *clamp* (`min(pagina, total - 1)`) and
not by a synchronization effect: a new rule arriving through the poll lengthens the
list, and a `useEffect` would render once with the invalid page before
correcting it. With 5 or fewer, the paginator **does not exist** — a control that paginates
nothing is noise taking up height.

- **Where:** `apps/web/src/routes/ContextAside.tsx:109` (`REGRAS_POR_PAGINA`) and
  the ordering of the four sections in the same file;
  `apps/web/src/components/ActivityFeed.tsx:98` (the descending `sort`)
- **Test:** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  (describe "RN-178"), `apps/web/src/components/ActivityFeed.test.tsx`
- **Origin:** real use on `exp001` — "mostrar log de eventos, arquivos tocados
  e regras de negócio sempre em ordem do último para o primeiro de acordo com
  a data" and "caso as regras de negócio ficar acima de 5, deve-se paginar"

### RN-179 — The PO's artifact is a TREE: epic → story → task {#rn-179}

The "Artefatos gerados" panel ([RN-159](#rn-159)) listed epic and story side
by side, flat, and **ignored `backlog.task_created`** — precisely what a dev
agent picks up to work on. The three now form a tree, with the child
inside a collapse of the parent, and tasks are born CLOSED: an epic with thirty
tasks would take over the whole panel without anyone having asked.

The parentage comes from the **link the event already carries** —
`backlog.story_created` writes `epicId`, `backlog.task_created` writes `storyId`
—, never from proximity in the log. A node whose parent is not among the loaded events
**rises to the root** instead of being hung on the nearest epic: inventing
parentage is worse than showing the loose node, and a task whose story fell outside
the window is a normal case, not an error.

Each level remains a **link** to the Backlog, and the children's collapse
comes BELOW the line instead of inside the header — a `Disclosure` header is a
`<button>`, and an `<a>` inside a `<button>` is invalid HTML and an ambiguous
click target. The section header's counter counts the WHOLE tree, not only the
roots: saying "3" with eighteen tasks inside would be the same kind of number that
corresponds to nothing that [RN-151](api.md#rn-151) removed from the sidebar.

- **Where:** `apps/web/src/lib/session-backlog-tree.ts:68`
  (`montarArvoreDeBacklog`), `apps/web/src/routes/ContextAside.tsx:210` (the
  roots become items), `:225` (the tree count)
- **Test:** `apps/web/src/routes/SessionPage.artefatos-gerados.test.tsx`
  (cases "épico/história/tarefa do PO viram árvore" and "nó sem pai carregado
  aparece na raiz")
- **Origin:** real use on `exp001` — "mostrar também as tarefas criadas no
  artefato do PO, mas abaixo do épico e ter opção de colapsar"

### RN-180 — The panel says what it is NOT showing {#rn-180}

`useSessionEvents` fetches `{ limit: 200, latest: true }`, and the context panel
read that slice through a prop. Consequence: in a session of thousands of events the
four sections showed the tail **as if it were the whole session** — a business
rule captured at the beginning of the ideation simply did not exist, without any
warning.

The panel started reading the same paginated history that the Overview's Activity
tab already used ([RN-099](#rn-099)), with the tail's `queryKey`
shared with the thread — **zero extra requests** in the poll cycle
([RN-090](api.md#rn-090)/[RN-091](api.md#rn-091)). Two things changed with that:

1. **The feed gained the pager the component always had.** The props
   `onLoadOlder`/`hasOlder`/`loadingOlder` are optional since RN-099 and this
   call site never passed them — that was why the session lost its beginning
   silently.
2. **A note counts how many events are missing.** The number comes from SUBTRACTION over the
   `seq` (gapless and per session): `menor seq baixado − 1`. Never from one more
   request — the same mechanism as the bell's "+ N mais antigos"
   ([RN-100](api.md#rn-100)). Reaching the start of the session, the note **disappears**, instead
   of asserting a zero.

The derived sections read `baixados` (everything that has already come) and not `events` (the feed's
window of 100): they do not paginate item by item, and cutting them at the window would make them
show LESS than they showed before this change. It is the same button that
feeds both.

`pausarPoll` goes down through `useSessionEventHistory` to `useSessionEvents`, and it is not
a detail: the refetch interval belongs to each OBSERVER, not to the query. A
second observer of the same key with the timer on would resurrect the poll that the
screen pauses during the turn — and with it the visual duplicate of the bubble in
streaming.

- **Where:** `apps/web/src/lib/hooks.ts:262` (the history's `pausarPoll`),
  `:388` (`baixados`); `apps/web/src/routes/ContextAside.tsx:154`
  (`eventosAnteriores`) and the `ActivityFeed` with the pager, at the end of the same
  file
- **Test:** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  (describe "RN-180")
- **Origin:** review of the round itself — the ceiling of 200 existed silently in the
  four sections

### RN-181 — Area delegation appears in the thread {#rn-181}

When an area (QA, Infra) delegates to subagents and consolidates the verdict, the three
outcomes the lead records — `delegation.completed`, `delegation.failed` and
`delegation.dispensed` — only existed in the log panel. Whoever followed the
session saw the gate open and close **without any sign** that there was a second
attempt underneath.

The three are now narrated in the thread as a **compact notice**, in the format of
[RN-157](#rn-157) — not a bubble: it is a notification of what happened inside the area,
not an utterance. The SENTENCE comes from `classifyEvent`, the same as the panel's, because two
wordings of the same event diverge on the first payload change; and it already
names the subagent and the area, so the lead is **not** prefixed (it would produce "QA
Lead QA Automação concluiu a delegação (qa)").

The area's external contract **does not change** (ADR 0038): the thread does not start addressing
subagents, it only narrates what the lead has already recorded. The failure origin travels along
in `delegation.failed`, for the same reason as [RN-059](engine.md#rn-059) — it is what says
whether the next step is changing the key, waiting for the provider or opening a bug.

- **Where:** `apps/web/src/routes/session-timeline-montagem.tsx:754`
- **Test:** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  (describe "RN-181")
- **Origin:** real use on `exp001` — "quando houver uma nova tentativa e
  consolidação de algum agente deve apresentar no chat"

### RN-182 — The theme is chosen, persisted and applied before the first paint {#rn-182}

The light theme exists in `design/tokens.css` since the beginning, under
`[data-theme='light']`, and **nothing in `apps/web` wrote that attribute**: the
only way to see the light theme was to type the attribute in DevTools. It now becomes
reachable.

The preference lives in `localStorage['brabo.theme']`, accepts **only** `'dark'` or
`'light'`, and the default is `dark` — the design system's primary theme. What applies it
is `apps/web/public/theme-boot.js`, **synchronous in the `<head>` and before the bundle**:
`data-theme` decides the colors of the whole `tokens.css`, and applying it after
hydration would make the light-theme user see a dark flash on every load.

It is a **file, not an inline script**, and the reason is the same that made the fonts
self-hosted (ADR 0036): the production image serves under `script-src 'self'`
(`docker/web/nginx.conf`), without `'unsafe-inline'` and without a nonce. Inline
would work in `pnpm dev:web` and would be **blocked in the published image** — the
worst failure mode possible, because it only shows up after the deploy.

The whole path degrades instead of breaking: `localStorage` can throw (private
mode, storage blocked in an iframe) and theme is a preference, not a function; an unknown
value falls to the default instead of becoming a `data-theme` that the CSS does not
know and that would render with no theme at all.

- **Where:** `apps/web/public/theme-boot.js:41`,
  `apps/web/index.html:53`
- **Test:** `apps/web/src/lib/tema.test.ts` (describe "contrato com o script
  de boot")
- **ADR:** [0074](../adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-183 — The theme preference has one source, and the `<html>` attribute is the truth {#rn-183}

Reading, writing, toggling and observing the theme is `apps/web/src/lib/tema.ts` — the button
lives in the shell and consumes that API, it never writes `data-theme` on its own.

Three decisions inside it:

1. **`temaAtual()` reads the ATTRIBUTE first**, and only then `localStorage` and the
   default. The attribute is what the screen is showing; falling back to the stored preference
   before it would make the UI assert a theme different from what is seen, in the exact case
   where the boot failed.
2. **`lerTemaSalvo()` returns `null`, not the default**, when there is no stored
   preference. Whoever never chose may one day follow the operating system
   (`prefers-color-scheme`), and erasing that distinction here would take the information away
   from whoever decides that later.
3. **`observarTema()` covers the `storage` event**, which the browser fires in the
   OTHER tabs of the same origin. Without it two open tabs would stay in
   different themes until the next reload.

The key and the default are repeated in `public/theme-boot.js` because it runs
before the bundle and cannot import anything. It is the only duplication able to
diverge silently, and that is why the test reads the boot file and fails if the
two stop matching.

- **Where:** `apps/web/src/lib/tema.ts:73`
- **Test:** `apps/web/src/lib/tema.test.ts`
- **ADR:** [0074](../adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-184 — Contrast is measured in BOTH themes {#rn-184}

While the light theme was unreachable ([RN-182](#rn-182)), measuring only the dark one
was honest: measuring a screen nobody can open is measuring an intention. With the
theme button, no longer measuring the light one would hide half of the product's visible
surface — so the pairs are now enforced in both themes, with the
same floor (4.5:1 for text, 3:1 for interface elements).

For that, **six light-theme tokens changed value**. The most
demanding background of the light theme is `--code-bg` (paper, `#efe4d2`, one step away from the
surfaces), and whatever passes against it passes against the rest: `--accent`
3.56 → 4.81, `--warning` 3.15 → 4.98, `--success` 3.89 → 5.12, `--violet`
4.16 → 4.95, `--text-muted` 2.76 → 5.17, and `--accent-hover` followed the accent one
step below. The dark theme **did not change a single value**, and its known debt
remained locked by the same five numbers (3.89 / 3.10 / 3.88 / 3.88 / 4.41)
until [RN-640](#rn-640) (ADR 0181), which closed it with the
neutral palette and turned it into a floor.

The light theme's `--text-muted` was not debt: at 2.40:1 over `--surface-2` it
failed even the **interface element** floor, which is the lowest that
exists. It was a defect, and the light theme has no reason to be worse than the primary one.

- **Where:** `design/tokens.css:208`
- **Test:** `apps/web/src/lib/contraste.test.ts`,
  `apps/web/src/design-contraste.test.ts`,
  `apps/web/test/design-contraste.test.ts`
- **ADR:** [0074](../adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-185 — The eight syntax roles, and the handoff's value only comes in measured {#rn-185}

The highlighting palette was three tokens of its own (`--syntax-function`,
`--syntax-comment`, `--syntax-operator`) and five reuses of semantic ones
(`--accent`, `--warning`, `--violet`, `--success`, `--text-primary`). It is this
reuse that made the palette measured only in the dark theme: in the light one the semantic tokens
failed against the paper `--code-bg`.

It now has the handoff's **eight roles**, with the `--syntax-*` prefix the
repository already uses, and each with its own value per theme. Naming the eight is
what lets highlighting diverge from the semantic tokens on the day it needs to.

**The handoff's value only comes in when the measurement approves.** Against the handoff's own
`--code-bg`, five of the eight fail the 4.5:1 that code text
requires — `--syn-cm` 4.09:1 in dark and 2.32:1 in light, `--syn-kw` 4.34:1,
`--syn-str` 4.20:1, `--syn-fn` 4.14:1, `--syn-op` 4.00:1. Where the handoff
fails, the measured number holds: it is the same rule as ADR 0036 — the handoff's intention
holds, the mechanism (or the number) that breaks the product does not.

The five semantic tokens are still what paints (`SyntaxTokens.module.css` did not
change in this delivery) and that is why they are **measured alongside** the eight: as long as they
are the real pixel, the floor is enforced on them. In the light theme each
role today has the SAME number as the semantic token that paints it, on purpose — two
sources with different numbers for the same pixel would diverge on the first
fix made on one side only.

- **Where:** `design/tokens.css:111`
- **Test:** `apps/web/src/lib/contraste.test.ts` (describe "contraste — paleta
  de sintaxe sobre --code-bg")
- **ADR:** [0074](../adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-195 — The sidebar collapses into an icon rail, with the preference persisted {#rn-195}

`Shell.tsx` had a fixed width (248px) and no way to shrink. It now
toggles between `--sidebar-w` (264px) and `--sidebar-w-collapsed` (62px) — the
two tokens that Onda 1/frente A had already created in `design/tokens.css` —
with `transition: width .18s ease`. Collapsed, it becomes a vertical rail: a
square of initials per project (border in the identity color,
[RN-197](#rn-197)) plus an Activities icon; clicking a project in the
rail re-expands the bar, opens that project and navigates to it.

The preference belongs to the user and survives a reload: `brabo.sidebar.collapsed`
(`'1'`/`'0'`) in `apps/web/src/lib/sidebar-state.ts`. It is **manual only**
(`colapsadoManual`): there was a second, **automatic** state
(`autoColapsado`), ORed in by the Code tab, and it was removed by
[ADR 0126](../adr/0126-trilho-vertical-de-navegacao-do-projeto.md) — see
[RN-201](#rn-201). No screen collapses the sidebar on its own; what is
seen collapsed was requested by the user, and is stored.

- **Where:** `apps/web/src/routes/Shell.tsx:340-351` (state and toggle),
  `apps/web/src/routes/Shell.module.css` (`.sidebar`, `.colapsado .sidebar`,
  `.trilha*`), `apps/web/src/lib/sidebar-state.ts`
  (`lerColapsado`/`gravarColapsado`)
- **Test:** `apps/web/src/lib/sidebar-state.test.ts` (describe "colapso"),
  `apps/web/src/routes/Shell.test.tsx`
- **Origin:** PROGRAMA 28, Onda 2, frente B —
  `design_handoff_brabo/README.md` section "Navigation shell"

### RN-196 — Expandable projects reveal the project's tabs, N at the same time {#rn-196}

Each project in the sidebar gets a chevron: clicking it expands the row and
reveals that project's tab list (Visão geral, Executores, Criativo,
Chat, Code, Backlog, Aprovações, Insights, Gastos, Configurações), each one
a link to `/projects/$projectId?tab=<chave>`. Several projects can stay
open at the same time — the state is a `Set<string>` of ids, persisted in
`brabo.sidebar.open`.

The tab list and the labels come from `ABAS_DO_PROJETO`
(`apps/web/src/routes/project-tabs.ts`, owned by frente C, running in
parallel in this same wave) — the sidebar only **reads** the exported array, it never
rewrites tab names. **Shape assumption**, to be checked against what
frente C delivered: `AbaDoProjeto` has `key: string`, `label: string` and
`count?: (contagens: ContagensDeAba) => number | undefined`, with
`ContagensDeAba = { promocoesPendentes, aprovacoesPendentes,
hipotesesPendentes }`. The sidebar can only fill
`aprovacoesPendentes` for free (`pendingApprovalsCount` already comes in the
dashboard summary, [RN-151](api.md#rn-151)); `promocoesPendentes`/`hipotesesPendentes`
come in as `0` — computing them would require a new query PER PROJECT
OPEN in the sidebar, the same class of N+1 that RN-090/091 closed in the
dashboard. The two badges remain correct within the rule of
`ProjectPage` itself; only the preview in the sidebar is partial, and it is a deliberate
omission, not a bug.

The project of the CURRENT route always appears expanded (`projetosAbertosEfetivo`),
even without being in the persisted `Set` — opening "for free" through the route writes
nothing; only the explicit click on the chevron goes into `brabo.sidebar.open`.

**Since [ADR 0211](../adr/0211-uma-navegacao-so-a-sidebar-absorve-o-trilho.md)
(AT-404) this list is the project's ONLY navigation:** the vertical rail left and
it received everything only the rail had — the three groups with headers, the active
tab marked, the vertical `tablist` named by the project, the keyboard
(`ArrowDown`/`ArrowUp`/`Home`/`End` with wraparound, crossing groups) and the FIVE
counters, each on its own tab and never summed. The deliberate omission above
still holds for a CLOSED project and for the project open outside the frame
(in the Session, for example): only Approvals, from the summary. With the project frame
mounted, the five numbers come from the SAME hook it uses
(`useContagensDoProjeto`), without a new request. Collapsed, the square of the
open project opens a flyout with the same tabs.

- **Where:** `apps/web/src/routes/Shell.tsx:557` (`projetosAbertosEfetivo`),
  `:505` (`useContagensDoProjeto`), `:512` (`irParaAba`), `:527`
  (`flyoutAberto`), `:215` (`contagensDoResumo`);
  `apps/web/src/routes/AbasDoProjeto.tsx:78` (`AbasDoProjeto`), `:34`
  (`itensDasAbas`), `:95` (`aoTeclar`);
  `apps/web/src/lib/contagens-do-projeto.ts:22` (`useContagensDoProjeto`),
  `:70` (`publicarAbaAtiva`), `:86` (`pedirAba`);
  `apps/web/src/lib/sidebar-state.ts` (`lerProjetosAbertos`/`gravarProjetosAbertos`)
- **Test:** `apps/web/src/lib/sidebar-state.test.ts` (describe "conjuntos"),
  `apps/web/src/routes/Shell.test.tsx` (describe "Shell — abas do projeto
  aberto (ADR 0211)": the 12 tabs, the five separate counters, the active one, the
  click and the arrow navigating, the collapsed flyout, the drawer on the phone and the failure
  case — without the frame mounted, only the summary's number),
  `apps/web/src/routes/AbasDoProjeto.test.tsx` (groups, active, counters,
  keyboard, roving tabindex, link per project), `apps/web/src/routes/project-tabs.test.tsx`
- **Origin:** PROGRAMA 28, Onda 2, frente B; ADR 0211 (AT-404)

### RN-197 — Two project colors, two purposes: identity is not status {#rn-197}

The handoff asks for a "project color dot" on the expanded row and the same
color principle on the collapsed rail. The product already had a dot there —
`NavStatusDot` — but it is **status** (budget/recent activity,
derived without its own query from `useProjectsSummary`/`useProjectsStatus`,
RN-039), not identity: its color CHANGES over time.

Decision, documented instead of resolved: the expanded row keeps
showing only `NavStatusDot` (it is actionable information; duplicating a second
dot next to it would be noise). The IDENTITY color — stable per project, a
deterministic hash of the id over a fixed palette of tokens (`corDoProjeto`,
no new table, the same idea as `AGENTS[key].color`) — appears only on the
collapsed rail, as the border of the initials square, which is where there is no
room for the two dots and where identity (not status) is what helps to
find the right project among several similar squares.

In the same way, the handoff asks for a "badge with the total of last iterations" on the
project; the product uses `pendingApprovalsCount` since RN-151, which is
later than the handoff and fixes a real defect (a number that did not
correspond to anything actionable when clicked). This badge **does not change** — RN-151
remains in force, and it is the handoff that diverges here.

- **Where:** `apps/web/src/lib/sidebar-state.ts` (`corDoProjeto`),
  `apps/web/src/routes/Shell.tsx` (`NavStatusDot`, comment on the divergence)
- **Test:** `apps/web/src/lib/sidebar-state.test.ts` (describe "corDoProjeto")
- **Origin:** PROGRAMA 28, Onda 2, frente B — divergence between
  `design_handoff_brabo/CHECKLIST-CONFRONTO.md` and RN-151

### RN-199 — Theme button in the footer, functional when collapsed {#rn-199}

The sidebar footer gets a sun/moon button that consumes the API of
`apps/web/src/lib/tema.ts` from Onda 1/frente A (`temaAtual`,
`alternarTema`, `observarTema`) without reimplementing anything — only the BUTTON is new.
It works collapsed (62px): the text label disappears, but `aria-label`/`title`
keep describing the current theme and the click keeps toggling.

- **Where:** `apps/web/src/routes/Shell.tsx:130-148` (`BotaoDeTema`)
- **Test:** `apps/web/src/lib/tema.test.ts` (the API, unchanged by this RN)
  — `Shell.test.tsx` does not duplicate the theme suite, it only mounts the Shell
- **Origin:** PROGRAMA 28, Onda 2, frente B

### RN-200 — Only Projects and Activities as global items {#rn-200}

The two route-less items of the nav footer ("Chat global"/"Configurações",
`title="em breve"`) are removed. The handoff is explicit: only Projects and Activities
are GLOBAL items — everything else is scoped to a project. "Configurações"
still exists, as a project TAB ([RN-196](#rn-196)) inside the expanded
row — what goes away is the loose item with no destination.

- **Where:** `apps/web/src/routes/Shell.tsx` (the `.globalNav`/
  `.inertNavItem` block from FASE 17a was removed, with no global replacement)
- **Test:** `apps/web/src/routes/Shell.test.tsx` (describe "sem itens
  globais inertes")
- **Origin:** PROGRAMA 28, Onda 2, frente B —
  `design_handoff_brabo/README.md` section "Navigation shell"

### RN-201 — Active project/tab persist across pages; the sidebar collapse is ONLY the user's {#rn-201}

Two final handoff keys: `brabo.project` (the active project) and
`brabo.tab` (the active tab) — written when the user clicks a tab link
IN THE SIDEBAR (`LinhaDeAba`/the project name link). `?tab=` in the URL only counts
as an INITIAL deep link (`project-tabs.ts`, FASE 24) — switching tabs inside
`ProjectPage.tsx` is local state and does not write to the URL after the
first load, so these keys are the only way for the preference to
survive from one navigation to another. **This half never changed.**

**The Code tab's auto-collapse LEFT (ADR 0126).** Until then the Code
tab collapsed the sidebar by itself to give width to the editor, without writing a
preference: `AutoCollapseContext`/`useAutoCollapseSidebar` in
`sidebar-state.ts`, registered by `ProjectCodeTab.tsx` (the only
caller) and ORed with the manual collapse inside the `Shell`. The context,
the hook, the `autoColapsado` state, the `Provider` around `<Outlet />` and the
`disabled` of the collapse button — which existed only to protect that path
— were all removed.

The reason is structural: with the project's vertical rail
(`routes/ProjectRail.tsx`, removed in ADR 0211) always present, keeping the auto-collapse would put the
Shell's icon rail right against the project rail — TWO adjacent, permanent
vertical rails, on the heaviest tab of the product.

What now holds: **the sidebar collapse is a decision of the USER, and only
theirs.** It stays manual, stays persisted in `brabo.sidebar.collapsed`
([RN-195](#rn-195)), and no screen collapses the sidebar on its own.

**The cost, accepted and declared:** the Code tab now opens with the sidebar
EXPANDED (264px) + the project rail (180px) + the rail of the
`CodeShell` itself (48px) — 492px of frame before the first character of code,
MEASURED in the browser, against ~110px before (62px of collapsed sidebar + 48px
of the Code rail). Collapsing manually remains possible and
still produces the Shell rail next to the project rail — the difference is
that now it was the user who chose, not the system.

**Revised by [ADR 0211](../adr/0211-uma-navegacao-so-a-sidebar-absorve-o-trilho.md)
(AT-404):** the project rail left, and the Code tab frame became
**312px** with the sidebar expanded (264 + 48 of the `CodeShell`) and **110px**
collapsed (62 + 48) — with no double rail in either case. The collapse
remains the user's only. The active tab the sidebar marks comes from the project
frame (`publicarAbaAtiva`), not only from `brabo.tab`.

- **Where:** `apps/web/src/lib/sidebar-state.ts:80-105`
  (`lerProjetoAtivo`/`gravarProjetoAtivo`, `lerAbaAtiva`/`gravarAbaAtiva`, and
  the comment recording the removal), `apps/web/src/routes/Shell.tsx:366-369`
  (only `colapsadoManual` is left), `apps/web/src/routes/ProjectCodeTab.tsx`
  (no collapse call)
- **Test:** `apps/web/src/lib/sidebar-state.test.ts` (describe "projeto e
  aba ativos"), `apps/web/src/routes/Shell.test.tsx` (describe "Shell —
  colapso da sidebar": the preference is only born from a click on the button and is always
  written). The "useAutoCollapseSidebar" describe was removed together with the
  hook.
- **Origin:** PROGRAMA 28, Onda 2, frente B —
  `design_handoff_brabo/CHECKLIST-CONFRONTO.md` section 1; the auto-collapse
  half was revised by
  [ADR 0126](../adr/0126-trilho-vertical-de-navegacao-do-projeto.md)

### RN-202 — The `sessions` tab stays "Chat", never "Chat RAG" {#rn-202}

The most recent design handoff of PROGRAMA 28 calls the consultative tab
"Chat RAG" (`designs/Brabo Chat.dc.html`), but the product does not have that
functionality: there is no per-project indexing pipeline, no vector
index, no source citation UI. ADR 0075 put `embed` in the
`LLMProvider` contract — the operation exists and is PROVEN on Ollama —, but nothing
CONSUMES it yet. Today's `sessions` tab is the ordinary consultative Chat of
[RN-104](#rn-104): an agent answering with the session context, without
producing backlog, with no RAG at all behind it.

Labeling the tab "Chat RAG" today would announce a capability that does not exist — the
same mistake that [ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
already refuses for a catalog model ("não ativar modelo descoberto
automaticamente"). The label changes on the day the functionality arrives, together
with the data behind it — never before.

- **Where:** `apps/web/src/routes/project-tabs.ts:144` (entry `key:
  'sessions'`)
- **Test:** `apps/web/src/routes/project-tabs.test.tsx` (describe "abas do
  projeto derivam de um registro só", `'RN-202 — a aba \`sessions\` continua
  "Chat", nunca "Chat RAG"'`)
- **ADR:** [0078](../adr/0078-moldura-de-tela-e-o-registro-de-abas-diverge-do-handoff.md)

### RN-203 — The handoff is a visual reference, not a ceiling on how many tabs the product has {#rn-203}

The design handoff lists 7 project tabs (Visão geral, Criativo, Código,
Chat RAG, Gastos, Aprovações, Configurações); the registry
(`apps/web/src/routes/project-tabs.ts`) has 10. The three extra ones —
`executores` ([RN-121](#rn-121)), `backlog` ([RN-048](api.md#rn-048)) and
`insights` (the Psicólogo's hypotheses awaiting a decision) — were born AFTER the
handoff was designed, all with real data, a counter derived from a query and
at least one RN of their own with a test.

The handoff fixes how each screen should LOOK — colors, typography,
spacing, the design of the frame —, and that part was followed to the letter in this
same change (header, ruler, scrolling, content width). It does not freeze the
tab inventory on the day it was written. Deleting the three to "match"
the handoff would destroy information the product already knew how to show, for the
wrong reason.

- **Where:** `apps/web/src/routes/project-tabs.ts:91` (the `REGISTRO`)
- **Test:** `apps/web/src/routes/project-tabs.test.tsx` (describe "abas do
  projeto derivam de um registro só", `'RN-203 — as 3 abas que o handoff não
  previu continuam no registro'`)
- **ADR:** [0078](../adr/0078-moldura-de-tela-e-o-registro-de-abas-diverge-do-handoff.md)

### RN-210 — "Recommended" is real usage and cost, never a computed score {#rn-210}

The "Melhores modelos por capacidade" block (Settings) has no score
column. The handoff shows a score per capability (code 9.4, image 9.1…), but
it is FICTITIOUS mock data — no provider publishes "code quality" and the
product does not measure that anywhere. Computing a number here would be the same
"guess dressed up as data" that [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)
forbids for MODEL capability, now about quality.

Instead, "recomendado"/"alternativa" come from two real signals, among the
models THIS workspace's curation marked for that capability (`uses`,
[RN-057](api.md#rn-057)): first the ones most used by agents of THIS project — the
same cascade that resolves the current binding of each agent —, cost (from the
catalog, ascending) as tiebreaker. "What the team has already chosen" is the most
honest signal available without inventing a score. A capability with no curated model
shows "sem cobertura curada" — it never hides the row, the same pattern that the
Origin column of `ModelsSection` already uses for the skipped binding.

- **Where:** `apps/web/src/routes/settings/MelhoresModelosPorCapacidadeSection.tsx`
- **Test:** `apps/web/src/routes/ProjectSettingsTab.test.tsx`
  (describe "MelhoresModelosPorCapacidadeSection")
- **ADR:** [0077](../adr/0077-ranking-de-modelos-por-capacidade-sem-nota-inventada.md)

### RN-211 — Spending per provider on screen is a Ranking, not an invented categorical palette {#rn-211}

The handoff asks for daily bars stacked by provider and a breakdown by
provider. The repository's dataviz skill requires validating a categorical
palette by script before using it, never by eye: `validate_palette.js`
fails every combination of 3+ tokens from `design/tokens.css` against at
least one of the two themes — `--accent`+`--violet` is the only pair that passes
in both (several `--syntax-*` are literally the same hex as
`--warning`/`--violet`/`--success`, measured). With 9 providers (ADR 0043) and
2 validated colors, cycling the palette is the anti-pattern the skill itself
names ("a 9th series is never a generated hue"), and inventing a new hex
would violate this frente's instruction. The breakdown by provider becomes a `Ranking` —
the same piece as "Por modelo"/"Por projeto"/"Por agente e pessoa", without
identity by color. The DAILY series per provider is not delivered:
`sumGroupedBy` (ADR 0076) groups by one dimension at a time, and there is no
cross aggregation day×provider in this wave's backend.

- **Where:** `apps/web/src/lib/spend.ts` ("Gasto por PROVIDER na
  tela" block), `apps/web/src/routes/ProjectSpendTab.tsx` (`GastoDoWorkspace`)
- **Test:** `apps/web/src/routes/ProjectSpendTab.test.tsx` (describe "a
  audiência do owner" — `'mostra os cinco recortes do workspace,
  incluindo provider'`)
- **ADR:** [0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-212 — The "per project" block is the TokenMeter plugged into the real budget {#rn-212}

The Spending tab gains a block per PROJECT (not per audience):
`OrcamentoDoProjeto` reads `GET /projects/:id/budget` and plants the result
directly into the existing `TokenMeter`, which already implements the 70/90 thresholds
(`tokenThreshold`) — no new component. Three readings: loading
(silent, avoids flashing before the role resolves the audience below),
no budget defined (a text note, no CTA) and error (silent — in
practice almost always a 403 from someone who has a WORKSPACE role but is not
`maintainer` on the PROJECT, and showing a banner on purpose would be a false alarm
for most members, the same pattern already used by the compact `TokenMeter`
of `ProjectPage.tsx`).

- **Where:** `apps/web/src/routes/ProjectSpendTab.tsx`
  (`OrcamentoDoProjeto`)
- **Test:** `apps/web/src/routes/ProjectSpendTab.test.tsx` (describe "o
  orçamento do projeto")

### RN-214 — The local-model savings KPI is left out for lack of a counterfactual price {#rn-214}

`TokenMeter` already has `savingsBRL`/`savingsPct` ready to receive the
number, and they remain unfed on purpose. The card would require a
COUNTERFACTUAL price — how much the same call would have cost on a paid
model — that does not exist anywhere in the product: the catalog (ADR 0042)
only freezes the price of the model ACTUALLY used (RN-044), and there is no
declared mapping "local model X ~ paid model Y". Inventing it here
would be the same class of "score dressed up as data" that RN-210 already refused
for the capability ranking. Gap recorded in the backlog for when
a defensible and versioned counterfactual price exists.

- **Where:** `apps/web/src/routes/ProjectSpendTab.tsx` (comment "KPI de
  economia com modelos locais — CORTE DECLARADO", end of the file)

### RN-215 — The Problems tab is born with an honest empty state {#rn-215}

There is no integrated lint or test over the managed project's code; the bottom panel's
Problems tab (handoff `design_handoff_brabo`) says so
explicitly instead of showing an invented count (the handoff mock has a
"3" badge). The same pattern already used by the Terminal (FASE 25b) and by the disabled
"Testes" item of the rail.

- **Where:** `apps/web/src/routes/code/CodeBottomPanel.tsx`
- **Test:** `apps/web/src/routes/code/CodeBottomPanel.test.tsx` —
  "Problemas diz honestamente que não há lint/teste integrado, sem
  contagem inventada"

### RN-216 — The Output tab is born with an honest empty state {#rn-216}

There is no build/deploy command stream in this tab — it would depend on the
interactive terminal (FASE 25b), which does not exist. The tab explains this and reminds
that `git push`/PR/deploy do not go out through the terminal in any case (RN-106).

- **Where:** `apps/web/src/routes/code/CodeBottomPanel.tsx`
- **Test:** `apps/web/src/routes/code/CodeBottomPanel.test.tsx` — "Saída
  diz honestamente que não há stream de comando, sem simular execução"

### RN-217 — The Code tab status bar only shows real data {#rn-217}

The 24px status bar (`CodeShell.tsx`) shows `↑N ↓M` commits of the current
branch (via `getCodeBranches`, the same `queryKey` as `CodeBranchPicker` —
dedup, zero extra requests, RN-090/091) and the language of the active file
(`linguagemPorCaminho`). Cursor position and the error/test count of the
handoff mock were left out: `CodeEditor` does not expose a trackable selection/caret
and there is no integrated lint/test (the same decision as RN-215).

- **Where:** `apps/web/src/routes/code/CodeShell.tsx`
- **Test:** `apps/web/src/routes/code/CodeShell.test.tsx` — "a status bar
  mostra ↑/↓ real da branch atual" and "sem ahead/behind (branch em dia), a
  status bar não mostra o par vazio"

### RN-218 — Visible focus on the bottom panel's own tabs {#rn-218}

The tabs of `CodeBottomPanel.tsx` are a custom implementation (not the design
system's `Tabs`) and did not inherit the calibrated `:focus-visible` that
`Tabs.module.css` gained in Onda 2/frente C. Fixed with the same pattern as
`Input.module.css` (ADR 0036), including `forced-colors`.

- **Where:** `apps/web/src/routes/code/CodeBottomPanel.module.css`

### RN-227 — The session status badge covers the 5 real states, not the handoff's 4 {#rn-227}

The handoff asks for 4 badges (ativa/aguardando/fechada/abortada) for the 5
real states of the machine (`created/active/closing/closed/closed_abnormally`).
`closed_abnormally`→abortada and `created`→aguardando are direct. `closing`
is NOT merged with "fechada": it gets its own badge ("encerrando", tone
`accent`, pulsing), because in `closing` the outcome (`closed` or
`closed_abnormally`) is not yet known — calling it "fechada" would
lie about that.

- **Where:** `apps/web/src/routes/ProjectSessionsTab.tsx` (`SELO_DO_STATUS`)
- **Test:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — describe
  "ProjectSessionsTab — selo de status (RN-227)"

### RN-228 — The pill filter groups the 2 states without their own pill by TRAJECTORY {#rn-228}

The handoff's pill filters (todas/ativas/fechadas/abortadas) only cover 4
of the 5 states. `created` (aguardando) goes into the "Ativas" pill — it has not
reached anywhere yet, it is a "session in play". `closing` goes into the
"Fechadas" pill — it is already on its way to closing without error. Each row's BADGE
(RN-227) is never rewritten by the filter; the pill only groups.

- **Where:** `apps/web/src/routes/ProjectSessionsTab.tsx`
  (`correspondeAoFiltro`)
- **Test:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — describe
  "filtro pill agrupa os 2 estados sem pill própria (RN-228)"

### RN-229 — The Criativo tab's "cost of the month" KPI is the ACTOR's consumption, not the project total {#rn-229}

It reuses `getMySpend(projectId, 30)` — the SAME queryKey that
`ProjectSpendTab.tsx#MeuConsumo` uses for the member's view (RN-101, ADR
0063), with no new aggregation. It NEVER shows the project total summing everyone
(`porProjeto` in `getWorkspaceSpendReport`), because that data is
owner-only and the Criativo tab is seen by any member of the project —
showing the overall total would leak other people's spending to whoever RN-060/101 does not
authorize to see it.

- **Where:** `apps/web/src/routes/ProjectSessionsTab.tsx` (`CriativoKpis`)
- **Test:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — describe
  "KPIs da aba Criativo", cases "caminho feliz" and "CASO DE FALHA"

### RN-230 — The "ideation → commit rate" KPI is declared absent, never computed {#rn-230}

There is, nowhere in the product, a link between a creative session and
the commit it produced. The Criativo tab shows "—" with the sentence "não
medido: sessão não é vinculada a commit hoje" instead of inventing a
calculation — the same class of error that ADR 0042 already refuses for a model
score.

- **Where:** `apps/web/src/routes/ProjectSessionsTab.tsx` (`CriativoKpis`)
- **Test:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — "'Taxa
  ideação → commit' é DECLARADA ausente — nunca um número calculado"

## PROGRAM 28 — Wave 4, front E2: line virtualization and minimap in the Code tab (RN-239..242)

### RN-239 — Line virtualization: only the visible window becomes a DOM node {#rn-239}

`CodeEditor.tsx` renders only the lines within the visible window (plus
`OVERSCAN = 20` of margin) as `[data-line-row]`; the rest becomes two
spacers that reserve the height without existing as a node. The decision NOT to
use `react-window`/`react-virtual`: line height is FIXED
(`ALTURA_LINHA = 21`, monospace), which reduces "which line is visible"
to an integer division over `scrollTop` — the problem those libs really
solve is VARIABLE height per item, which isn't the case for the Code
tab.

- **Where:** `apps/web/src/routes/code/CodeEditor.tsx` (lines 38-96, 45,
  48)
- **Test:** `apps/web/src/routes/code/CodeEditor.test.tsx` — describe
  "CodeEditor — virtualização", "caminho feliz: arquivo de 5.000 linhas
  renderiza uma janela pequena de nós, não o arquivo inteiro" (`< 150`
  `[data-line-row]` nodes) and "rolar para o meio do arquivo troca a janela —
  linha 1 some, linhas do meio aparecem"

### RN-240 — Without a height measurement, it degrades to a generous default window, never renders everything {#rn-240}

When `containerHeight` hasn't been measured yet (1st render, or jsdom without
`ResizeObserver` in tests), the window falls to `LINHAS_SEM_MEDICAO = 40` —
generous enough not to truncate the small files the tests
use, small enough never to become "render everything" on a truly
large file.

- **Where:** `apps/web/src/routes/code/CodeEditor.tsx` (line 57)
- **Test:** `apps/web/src/routes/code/CodeEditor.test.tsx` — "falha/borda:
  sem medição de altura (jsdom sem ResizeObserver, clientHeight 0),
  degrada para uma janela padrão em vez de não renderizar nada"

### RN-241 — The minimap reuses the SAME tokenization as virtualization — zero second pass over the file {#rn-241}

`minimap.ts` tokenizes nothing: it summarizes the output `highlight.ts` already
produced (`HighlightToken[][]` from `highlightFile`, called only once) —
the SAME one virtualization uses to color the visible lines.
Tokenizing again just for the minimap would pay the cost of reading the
file a second time, and that's why the minimap only comes in after
virtualization is in place, never before.

- **Where:** `apps/web/src/routes/code/minimap.ts` (lines 1-18, 39)
- **Test:** `apps/web/src/routes/code/minimap.test.ts`

### RN-242 — The minimap is a CANVAS, a single DOM node, never one `<div>` per line {#rn-242}

The drawing is on `<canvas>` (`desenharMinimapa`), not one element per
line: a minimap with one node per line would double again the count that
virtualization (RN-239) just cut. With no 2D canvas context
available (jsdom without the `canvas` package), the clickable overlay keeps
working — only the drawing is skipped, never the interaction.

- **Where:** `apps/web/src/routes/code/minimap.ts` (lines 14-16, 91)
- **Test:** `apps/web/src/routes/code/CodeEditor.test.tsx` — describe
  "CodeEditor — minimapa", "caminho feliz: clicar no minimapa rola o
  editor e troca a janela renderizada" and "falha: sem contexto de canvas
  2D (jsdom sem o pacote `canvas`), o overlay continua clicável e nada
  quebra"

## PROGRAM 28 — Wave 4, front H4: the remaining ad-hoc collapses migrate to `Disclosure` (RN-249..251)

### RN-249 — The click target of a milestone with detail goes from 20px up to `Disclosure`'s 24px floor {#rn-249}

The milestone WITH detail in `AgentTimelineTree` had `min-height: 20px` on the
clickable header — below WCAG 2.2 AA 2.5.8 (Target Size, minimum
24px), which a previous comment already promised without delivering. The migration
to the shared `Disclosure` fixes that for free: the generic
component is already born at 24px, and there's no need to remember to set the ruler in
each new consumer.

- **Where:** `apps/web/src/components/AgentTimelineTree.module.css`
  (lines 135-155, `.marcoLinha`)
- **Test:** `apps/web/src/components/AgentTimelineTree.test.tsx`
- **ADR:** none — a one-off a11y fix, same pattern as ADR 0036

### RN-250 — The diff file strip in `ApprovalCard` does NOT migrate to `Disclosure` — its own animation is the reason {#rn-250}

The diff file strip in `ApprovalCard` rotates the chevron via
`transform: rotate(90deg)` with its own transition
(`.chevron.open`/`ApprovalCard.module.css`); the generic `Disclosure`
SWAPS the icon (right arrow → down arrow) with no animation at all. Forcing the
migration would erase the micro-interaction with no gain — exclusivity (only one
file open at a time) already comes from outside (`expandedFile`), the same thing the
controlled `Disclosure` would do. What was missing, and wasn't a peculiarity —
it's the same defect `Disclosure` exists to close —, was
`aria-controls` pointing to a named region: fixed directly,
without changing component.

- **Where:** `apps/web/src/components/ApprovalCard.tsx` (lines 511-539)
- **Test:** `apps/web/src/components/ApprovalCard.test.tsx`

### RN-251 — Five call sites migrate to the shared `Disclosure`; the component gains `testId` as its only new hook {#rn-251}

`ModelCatalogSection` (the original reference that generated the component in
PHASE 16), `AgentTimelineTree` (branch + milestone), `code/CodeExplorer.tsx`
(tree folder), and `code/CodeShell.tsx` (bottom panel) now use
the shared `Disclosure` — none of the six ad-hoc implementations that
survived PHASE 16 is left out, except the declared exception of
RN-250. `testId` is the only new prop a consumer needed (`data-
testid` on the header, so existing tests keep
selecting the right button without rewriting the whole suite). The controlled
region exists in the DOM even when closed — only `hidden` and without the children
mounted —, because `aria-controls` pointing to an id that doesn't resolve
is worse than not having the attribute (a screen reader would announce control of
something nonexistent); it's that same property that allows collapsing expensive
lists (the OpenRouter catalog has 338 models) without mounting what
nobody is looking at.

- **Where:** `apps/web/src/components/ui/Disclosure.tsx` (lines 33-71),
  `apps/web/src/components/ModelCatalogSection.tsx`,
  `apps/web/src/components/AgentTimelineTree.tsx`,
  `apps/web/src/routes/code/CodeExplorer.tsx`,
  `apps/web/src/routes/code/CodeShell.tsx`
- **Test:** `apps/web/src/components/ui/Disclosure.test.tsx`,
  `apps/web/src/routes/code/CodeExplorer.test.tsx`,
  `apps/web/src/routes/code/CodeShell.test.tsx`

## PROGRAM 28 — Wave 5, front G3: the Chat RAG screen (RN-252..254, ADR 0082)

### RN-252 — The Chat RAG screen shows the two honest degradations the backend already declares, never hides them {#rn-252}

`HybridSearchUseCase` already returns `vectorAvailable: false` when the embedding
provider didn't respond (RN-233) and `GetRagCoverageUseCase` already never
includes an indexing timestamp (RN-237) — but an honest contract in the
backend doesn't guarantee an honest screen if it decides not to read both
fields. `ProjectRagTab` shows a warning above the results when
`vectorAvailable` is `false` (with `vectorUnavailableReason`, when
it exists), and `RagCoveragePanel` only renders a REAL count (`filesIndexed`/
`filesInRepo`, `sessionsIndexed`/`sessionsInProject`) — no text of the
kind "reindexed Xmin ago" is born on this screen, because the response doesn't carry
that data and inventing it would lie (same ruler as ADR 0042 for a model's
grade).

- **Where:** `apps/web/src/routes/ProjectRagTab.tsx` (lines 27-31, 176-182),
  `apps/web/src/components/rag/RagCoveragePanel.tsx` (lines 27-34)
- **Test:** `apps/web/src/routes/ProjectRagTab.test.tsx` — "CASO DE FALHA
  (degradação honesta): vectorAvailable false avisa..."; `apps/web/src/components/rag/RagCoveragePanel.test.tsx`
  — "CASO DE FALHA (degradação honesta): nunca escreve..."
- **ADR:** [0082](../adr/0082-chat-rag-aba-de-busca-hibrida.md)

### RN-253 — A citation with `session` origin navigates to the exact EVENT, reusing the Psicólogo's mechanism {#rn-253}

`RagCitationCard` doesn't invent a second navigation path: origin
`{ kind: 'session', sessionId, eventId }` calls `useNavigate` to
`/projects/:projectId/sessions/:sessionId` with `search: { highlightEvent:
eventId }` — the SAME route and the SAME parameter that the Psicólogo's evidence
chips already use (`HypothesisCard.tsx`, Phase 4b) to scroll the thread to
the event and highlight it. Origin `{ kind: 'file' }` shows path and
`headingPath` as text, without a link: the Code tab today has no deep-link
by path, and building that navigation is outside the scope of this
front.

- **Where:** `apps/web/src/components/rag/RagCitationCard.tsx` (lines
  32-38, 49-56)
- **Test:** `apps/web/src/components/rag/RagCitationCard.test.tsx` —
  "caminho feliz: origem de sessão navega até o evento exato ao clicar"
- **ADR:** [0082](../adr/0082-chat-rag-aba-de-busca-hibrida.md)

### RN-254 — The reindex button is maintainer/owner on the SCREEN, mirroring the route's ruler {#rn-254}

`POST .../rag/reindex` already requires `role:maintainer` (RN-238) — the
api guarantees it. `ProjectRagTab` mirrors the ruler on the CLIENT with the same
pattern that `ProjectSettingsTab`/`ProjectApprovalsTab` already use for other
`maintainer` gates (`useCurrentWorkspaceWithRole`, since there's
no PROJECT role on the client today, only the workspace one the listing
returns): the "Reindex now" button doesn't even appear for whoever isn't
`owner`/`maintainer`, instead of appearing disabled — reindexing triggers
N calls to the project's repository and to the embedding provider (same
"changes what the product spends without asking" ruler as the parallelism ceiling,
RN-083), and a visible but always-refused button would only teach people to
ignore the 403.

- **Where:** `apps/web/src/routes/ProjectRagTab.tsx` (lines 43-44, 109)
- **Test:** `apps/web/src/routes/ProjectRagTab.test.tsx` — "botão de
  reindexar só aparece para maintainer/owner..."; "maintainer vê e pode
  disparar a reindexação"
- **ADR:** [0082](../adr/0082-chat-rag-aba-de-busca-hibrida.md)

### RN-268 — The Terminal tab shows the REAL state of the container, never pretends a terminal that doesn't exist {#rn-268}

The original plan for this front was the full interactive terminal, but the
investigation confirmed that PHASE 25b remains cut: no service mounts
`/var/run/docker.sock`, and even after ADR 0081 (Wave 4) nothing transitions
`project_containers` in production. Implementing a terminal that pretends to execute
commands — or that runs in the same container as Brabo's monorepo, the debt
ADR 0055 already describes as policy and not isolation — would be inventing
capability, the same mistake ADRs 0041/0042 already refuse for LLM
provider and catalog model.

What the tab GAINS is honest: under the explanatory text that already existed (PHASE
26b), `CodeBottomPanel` fetches `GET .../container/lifecycle` (RN-267) only
while the Terminal tab is open (`enabled: aba === 'terminal'` — no
background polling, the same traffic discipline as RN-107) and shows
the status with a `Badge` (`provisioning`/`running`/`stopped`/`failed`/
`removed`, in pt-BR), how long ago, and the `failureReason` when the state is
`failed`. A project never provisioned — the common case today — shows the sentence
"not provisioned yet", never an invented badge.

- **Where:** `apps/web/src/routes/code/CodeBottomPanel.tsx`,
  `apps/web/src/routes/code/CodeBottomPanel.module.css`,
  `apps/web/src/lib/api-client.ts` (`getContainerLifecycle`),
  `apps/web/src/lib/api-types.ts` (`CicloDeVidaDoContainer`)
- **Test:** `apps/web/src/routes/code/CodeBottomPanel.test.tsx`
  (describe "Terminal — o estado REAL do ciclo de vida do container")
- **Edge case:** the interactive terminal itself is NOT born here — it's PHASE 25b, which
  remains cut and depends on the container's physical wall (the agent's
  worktree living inside it), not on this read route.
- **ADR:** [0083](../adr/0083-terminal-mostra-estado-real-do-container.md)

## UX Designer — the fifth conversational agent (RN-285..287, ADR 0087)

### RN-287 — `uxDesignerActive` in the roster, in BOTH sources (RN-090) {#rn-287}

Same criterion as `infraActive`: an `accepted` handoff addressed to
"ux-designer" in the session. `apps/web/src/lib/agent-status.ts`
(`rosterFactsFromEvents`/`rosterFromFacts`) gained the fact and pushes it
conditionally into the roster as a SOLO agent — with no corresponding `pushAreaMembers`,
because it isn't an area.

RN-090 requires BOTH sources in sync (team panel via event log; the
dashboard card via `ProjectCardSummary.roster`, computed in the api) so that
a new agent doesn't appear in one place and go missing in the other. The fact went into
both: `apps/api/src/infrastructure/persistence/drizzle/projects-summary.repository.ts`
widens the SAME `infraActive` query (an `inArray(handoffs.toAgent,
['infra', 'ux-designer'])` in place of the single `eq`, split into two `Set`s by
`toAgent`) — no new query, the count of twelve constant queries
that `projects-summary.repository.spec.ts` proves doesn't grow.

- **Where:** `apps/engine/lib/engine/agents/ux_designer_server.ex`,
  `ux_designer_tools.ex`, `ux_designer_supervisor.ex`;
  `apps/engine/lib/engine/harness/agents.ex` (identity),
  `artifact_schemas.ex` (type `prototipo_navegavel`);
  `apps/engine/lib/engine/application.ex`;
  `apps/engine/lib/engine_web/controllers/agent_command_controller.ex`;
  `apps/web/src/lib/agents.ts`, `agent-status.ts`;
  `apps/api/src/application/ports/projects-summary-repository.port.ts`,
  `apps/api/src/infrastructure/persistence/drizzle/projects-summary.repository.ts`
- **Test:** `apps/engine/test/engine/agents/ux_designer_server_test.exs`,
  `ux_designer_tools_test.exs`; `apps/web/src/lib/agent-status.test.ts`;
  `apps/api/test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  (describe with both `toAgent`s in the same session)
- **ADR:** [0087](../adr/0087-ux-designer-agente.md)

---

## Wave 1 of ADR 0104 — `execution_mode` in three values, workspace verified by the runner

### RN-428 — The story promotion carousel survives the event window {#rn-428}

`promocoesPendentes`/the PO's promotion carousel (RN-148) no longer depends
on a scan over the window of the last 200 events of `useSessionEvents`. The source
of content/count is `useBacklog` (`Story.proposedReady`, per session,
complete and without a window) — in a long session, `backlog.story_promotion_proposed`
leaves the window while the story is still really pending, and before this
the carousel shrank (or vanished) silently. The same class of bug that
RN-180 already fixed for `ContextAside`.

When the story isn't in the loaded backlog (query hasn't answered yet),
it degrades story by story to the usual window scan. The anchoring in the
timeline still comes from the event within the window when it exists; if the
event that opened the batch has already left the window, the carousel anchors at the
TOP of the visible stretch instead of vanishing — never hiding a real state because of
a read cutoff.

- **Where:** `apps/web/src/routes/SessionPage.tsx` (`useMemo` `timeline`)
- **Test:** `apps/web/src/routes/SessionPage.carrossel-janela-estourada.test.tsx`
- **ADR:** none — a bug fix, the same class already fixed by RN-180
- **Origin:** found by real use ("the chat failed to show the PO's carousel")

---

### RN-431 — The Architecture tab badge counts pending validation items, never "diagram not generated" {#rn-431}

`contagens.arquiteturaPendente` (tab ruler) comes from
`architecture.pendencies.length` (story↔module cross-validation
divergence), not from `c4Diagram.status === 'sem_diagrama'`. The other
three counts of the ruler (`promocoesPendentes`, `aprovacoesPendentes`,
`hipotesesPendentes`) all mean "something is waiting for YOUR decision" — generating the
diagram is the Arquiteto's work, not the user's decision queue, and
badging for it would be noise.

- **Where:** `apps/web/src/routes/ProjectPage.tsx`
- **Test:** `ProjectPage.test.tsx`
- **ADR:** none
- **Origin:** design decision made when extracting the Architecture tab from the
  Overview

---

### RN-432 — The language preference comes in the login/refresh payload, never in an extra call {#rn-432}

> Revised by [RN-891](api.md#rn-891): the column also accepts `ru` and `zh-Hans`,
> and the web's default went from `en` to `pt-BR` (ADR 0216).

Foundation of the interface's i18n (Wave 6a of a larger program — the mass
extraction of the rest of the app's strings is a separate stage, in parallel). A
`locale` column in `users` (`'pt-BR' | 'en'`, default `'pt-BR'` — never silently
flips whoever already has an account). `EmitirSessaoUseCase` is the ONLY point
that issues a session (login, refresh, social login) — `locale` embedded in the
body of `/auth/login`/`/auth/refresh` from it, with no additional
round-trip. `GET/PATCH /users/me/preferences` exists as a REDUNDANT path,
for `AccountPage` to reassert the value without waiting for the next refresh.

`en` is the app's DEFAULT language from now on (`react-i18next`, a new
dependency — the same "a new dependency needs a justification" ruler
that `mermaid`/`@xterm/xterm` already followed); `pt-BR` remains available.
`apps/web/src/lib/idioma.ts` (same design as `tema.ts`): the SERVER is the
source of truth, `localStorage['brabo.locale']` is only a cache to avoid
a flash of the wrong language on the first paint. A user without an account yet uses
`navigator.language` only as a DISPLAY suggestion, never persisting anything
before an account exists.

- **Where:** `apps/api/src/application/use-cases/auth/emitir-sessao.use-case.ts`,
  `apps/api/src/interfaces/http/iam/user-preferences.controller.ts`,
  `apps/web/src/lib/idioma.ts`, `apps/web/src/lib/i18n.ts`,
  `apps/web/src/routes/AccountPage.tsx`
- **Test:** `apps/web/src/lib/idioma.test.ts`,
  `apps/web/src/routes/AccountPage.test.tsx`,
  `apps/api/test/application/use-cases/auth/*.spec.ts`,
  `apps/api/test/interfaces/route-surface.spec.ts`
- **ADR:** none — an additive extension of an already existing choke point, without
  changing the session format for anyone who doesn't use the new field
- **Origin:** product owner's request — interface and docs in English by
  default, with Portuguese preserved

---

## The Runner's folder explorer becomes three columns, and creating a `runner` project no longer waits for the final step (RN-436/436)

Two changes requested by the product owner after testing the creation of a
real project: (1) the existing folder browser
(`FolderBrowserModal`) was a simple list with a breadcrumb, when the
visual reference he sent (a GNOME Files/GTK-style picker, with three
columns) already existed as a ready design handoff to adapt; (2) "Browse
folder..." didn't work on the project's CREATION SCREEN — only after
it was created — because the Runner channel's ticket (ADR 0107) is anchored to a
`projectId` that, until this fix, was only born on confirmation.

### RN-436 — `FolderBrowserModal` becomes a three-column explorer: shortcuts, a list where one click selects/double click enters, and a details panel {#rn-436}

The single-list layout became three columns inside the `Modal size="full"`:
shortcuts (Home folder, which calls `diretorioInicial()`; Root, `/`), the
central list with breadcrumb, and a details panel on the right. The protocol
(`FsEntrada`, in `apps/web/src/lib/fs-browser-channel.ts`) only has
`{ nome, isDir }` — no size nor modification date — and wasn't
extended (it would touch `apps/engine`/`apps/runner`, outside the scope of this
delivery); the details panel only shows what can be derived client-side:
name, type, and the item count when the displayed item is the ALREADY OPEN
folder (never of a merely selected folder, which would require an extra call to the
runner).

The TWO gestures that were previously fused into a single click (which already navigated
into the folder) were separated: one click now only SELECTS (highlights
the item and updates the details panel) and a double click ENTERS. The
final button ("Use this folder", renamed from "Select this folder" — the
`folderBrowserModal.select` key of `pt-BR`/`en` changed along with it) uses the
selected item when there is one (`selected.kind === 'dir' ? join(path,
selected.name) : path`) or the currently open folder when there's
none. The list stopped filtering files — the whole listing appears
now, with files rendered as `<div aria-disabled>` instead of
`<button>`: visually dimmed and with no gesture at all, because only folders
remain navigable/selectable.

- **Where:** `apps/web/src/components/FolderBrowserModal.tsx`,
  `FolderBrowserModal.module.css`,
  `apps/web/src/locales/{pt-BR,en}/terminal.json`
- **Test:** `apps/web/src/components/FolderBrowserModal.test.tsx` — a single
  click selects without calling `listarDiretorio` again; a double click navigates;
  a file appears in the list but isn't reachable by `getByRole('button')`;
  "Home folder"/"Root" shortcuts; and "Use this folder" uses the selected one
  when there is one, otherwise the open folder
- **ADR:** none — a UI redesign over a component that already existed, with no
  protocol change nor data boundary change (ADR 0107 still
  describes the mechanism behind it)
- **Origin:** product owner's request, after testing the creation of a
  real project and finding the folder browser not much like a real
  file explorer — a visual reference sent by him
  (three-column picker, GNOME Files/GTK style)

### RN-437 — In `runner` mode, "Browse folder..." creates the project IN ADVANCE, and the final confirmation reuses it by identity SNAPSHOT {#rn-437}

ADR 0107 had already declared this gap in its own Consequences section:
with no project yet, the channel's ticket (RN-429) has nothing to anchor to, and
"Browse folder..." always fell into the "available after the project
exists" state — even in `runner` mode, where creation does NOT depend on validating
disk (ADR 0104, item 2). Closed by [ADR 0108](../adr/0108-projeto-runner-nasce-ao-navegar-pasta-no-wizard.md):
`NewProjectWizard.tsx` (`handleProcurarPasta`) calls `createProject` when
clicking "Browse folder..." when `modoDeWorkspace === 'runner'` — using the
already typed path, or a lexically valid and clearly
provisional placeholder (`/workspace-a-confirmar`) when the field is still empty, never
blocking the click. `mounted` mode **doesn't change**: it keeps
`projectId={null}` until confirmation, because there disk validation runs
on creation and creating early with an empty path would return RN-422's refusal at a
moment when the user hasn't even thought about a path yet.

An identity SNAPSHOT (`{ name, externalId, adotando }` — never
`caminhoLocal`, whose refinement is the PURPOSE of browsing) decides when to reuse:
clicking "Browse folder..." again with the identity intact reopens the modal
with the SAME project, without creating another; changing the name (or going back and swapping the
repository to adopt) invalidates the snapshot, and the next browse creates a
new project. `handleConfirm` applies the same ruler — it reuses the project
already created when browsing when the snapshot still matches, and only calls `createProject`
when there's nothing to reuse. `montarPayloadDeCriacao`, a pure function extracted
from what used to live only inside `handleConfirm`, is reused by both
paths.

The button's prerequisite is stated BEFORE the click (AT-214): in this mode the list
comes from the local agent, so without a `brabo-runner` running and connected to the
newly created project the modal can only show the wait and the onboarding. The
screen now says so in TEXT below the field (`aviso-procurar-runner`,
ADR 0064 — never a tooltip), with the command
`brabo-runner --project <id> --dir <pasta>` and the alternative that depends on
nothing: typing the path in the field, which the runner confirms on connecting. The
mechanism (the early creation, the transport through the local agent) didn't change.

- **Where:** `apps/web/src/routes/NewProjectWizard.tsx`
  (`handleProcurarPasta`, `handleConfirm`, `montarPayloadDeCriacao`,
  `snapshotDeIdentidade`/`mesmaIdentidade`)
- **Test:** `apps/web/src/routes/NewProjectWizard.test.tsx`, describe
  `navegação de pasta antecipada no modo Runner` — creates the project and opens the
  modal with the real id; uses the placeholder when the field is empty; clicking
  again without changing anything doesn't create another; changing the name invalidates the snapshot and
  creates a different project; `handleConfirm` reuses instead of duplicating. The
  preexisting test "'Procurar pasta...' mostra o estado declarado" (`mounted`
  mode) stays green, unchanged — it proves the scope didn't leak
- **ADR:** [0108](../adr/0108-projeto-runner-nasce-ao-navegar-pasta-no-wizard.md)
  — a structural change (WHEN a project comes to exist in the creation
  flow), with the accepted side effect of an orphan "not provisioned" project
  when the wizard is closed without finishing (the SAME state that any
  interrupted creation already produces today, not a new regression)
- **Origin:** product owner's request, after testing the creation of a
  real project in Runner mode and not being able to browse folders before
  confirming — the gap ADR 0107 had already declared and postponed

### RN-438 — `fs-browser-channel.ts` had the SAME duplicated-path bug that RN-433 had already fixed in its sibling `terminal-channel.ts` {#rn-438}

Found while verifying RN-437 end to end in Chrome, against the real engine:
the modal opened with the right `projectId`, but the connection dropped immediately with "The
connection to the runner dropped — close and reopen to try again." instead of
showing `RunnerOnboardingPanel`. `apps/web/src/lib/fs-browser-channel.ts`
concatenated `'/runner/websocket'` to an `engineWsUrl` the api already returns
READY (`ws://host:porta/runner`, from `engineWsUrlPublico()`) — the same
`phoenix.js` `Socket` also appends `/websocket` on its own in the
constructor, and the result hit the engine as `GET
/runner/runner/websocket/websocket`, which `Phoenix.Router.NoRouteError`
refuses. It's EXACTLY item 3 of RN-433, only in the SIBLING module — the
fix there had never been replicated here, and no suite caught it
because this module had no test at all until now (its own docblock
said, incorrectly, that `terminal-channel.test.ts` covered it "indirectly").
Fix: the same line as RN-433 — `engineWsUrl.replace(/^http/, 'ws')`, without
concatenating any path.

Verified END TO END against a real `runner` project (owner logged in,
`teste-navegacao`, created by RN-437): before the fix, the modal fell
straight into the connection error; after, it shows `RunnerOnboardingPanel` with the
command `brabo-runner --project <id-real> --dir <pasta>` in under 2s —
the expected result without a real runner connected.

- **Where:** `apps/web/src/lib/fs-browser-channel.ts`
- **Test:** `apps/web/src/lib/fs-browser-channel.test.ts` (new — the
  module had no test of its own at all until this fix). The happy path
  confirms `socket.url === engineWsUrl` without concatenation; plus
  `diretorioInicial`/`listarDiretorio` roundtrip, failure fetching the ticket, and
  idempotent `fechar()`
- **ADR:** none — it restores the behavior that ADR 0103/0107 and RN-433
  already declared as intent, only in a module the previous fix didn't
  reach
- **Origin:** found manually testing RN-437 (early creation of a
  `runner` project) against Chrome and the real engine — the first time
  `FolderBrowserModal` was exercised end to end against a real
  connection, because before this delivery "Browse folder..." never reached
  a real project before confirmation

## An attached local folder becomes the fourth scope of the RAG index, read by the BROWSER (RN-455..457, ADR 0113)

### RN-456 — The aggregate ceiling REJECTS (400) the whole upload; a large/binary individual file is only SKIPPED {#rn-456}

Unlike `docs`/`adr` (a background sweep, with nobody watching),
attaching a folder is a SINGLE gesture with a folder picker on the
screen. `IndexLocalFolderUseCase` refuses (400) the whole batch when the
number of files (`RAG_LOCAL_FILE_COUNT_LIMIT`, 500) or the summed bytes
(`RAG_LOCAL_TOTAL_BYTES_LIMIT`, 8 MiB) overflow — it never truncates
silently, because whoever clicked "Attach" can choose a smaller folder. An
individual file that's too large (`RAG_LOCAL_FILE_BYTES_LIMIT`, 512 KiB) or
with an unrecognized extension (`RAG_LOCAL_ALLOWED_EXTENSIONS`, allowlist) is
only SKIPPED (`filesSkipped`), it never takes down the batch — the same distinction that
`IndexProjectDocsUseCase` already makes implicitly by filtering only `.md`.
A path with `..` or a leading slash is REFUSED (400), never accepted
silently, the same discipline of never trusting a path coming from the
client (RN-092/095) even when it "shouldn't" contain that.
`apps/web/src/lib/rag-local-limits.ts` mirrors the same numbers on the
client, only as a UX convenience (summary before sending) — what really
guarantees it is the server.

- **Where:** `apps/api/src/domain/rag/rag-search-limits.ts` (`RAG_LOCAL_*`),
  `apps/api/src/application/use-cases/rag/index-local-folder.use-case.ts`
- **Test:** `apps/api/test/application/use-cases/rag/index-local-folder.use-case.spec.ts`
  (count and summed-bytes ceilings reject; a large/binary file is
  skipped; a path with `..`/leading slash is refused)
- **ADR:** [0113](../adr/0113-pasta-local-anexada-via-navegador-vira-chunks-scope-local.md)
- **Origin:** product owner's request

### RN-460 — The turn activity strip narrates in real time, and the thread only receives the response at the end {#rn-460}

The Session screen shows, ABOVE the composer, a strip that narrates in
human language what a conversational agent (Criativo, PO, Arquiteto,
Dev Lead, UX Designer, Staff) is doing DURING the turn — visual
reference: Claude Code's status line. The thread only receives the
response bubble AFTER the turn ends; the rule belongs to the CHAT (Phoenix channel) and
applies only to the six conversational agents — the consultative chat without an
active agent (SSE, `streamChatMessage`) keeps the usual streaming
bubble, untouched. (Since [RN-682](api.md#rn-682) the screen no longer calls that
SSE: a consultative session with no agent asks for an agent before sending.)

**Mechanism (engine)**: the six servers already emit a DURABLE `tool.call` in the
event log; they now also do `broadcast(state, "tool.call", %{tool:
name, agent: @agent})` — EPHEMERAL, without `args` (never a raw payload, the same
ruler as RN-096/RN-412) — right after, for the `session:<id>` channel to deliver
in real time. There's no shared behaviour/macro among the six
`dispatch_tool`s (four distinct structural shapes confirmed by a
complete reading): the change is six edits adapted to each one's local
shape.

**Mechanism (web)**: a PURE reducer
(`reduzirAtividadeDoTurno`/`lib/atividade-do-turno.ts`) accumulates the
`agent.delta` text as "current"; when a `tool.call` arrives from the channel, it archives
the non-empty current as a NARRATION line, resets, and ALWAYS adds a
TOOL line with `fraseDaFerramenta(tool)` (a dictionary of the 19
tools of the six agents, `lib/narracao-de-ferramentas.ts`, with no RN of
its own — it only exists to serve this rule) — two consecutive calls
with no delta between them become two separate lines, never one. End of turn
resets (`finalizarTurnoDoAgente`, the ONLY reset point). `turnoViaCanal`
is an OWN flag (never derived from `statusAgent`/`streamingAgent`, which
go through legitimately `null` windows in the middle of a turn) that decides
whether the strip appears OR the old bubble — never both.

**Presentation rule (history)**: `agruparNarracoesDoTurno`, a new
pure pass that runs AFTER `afundarDesfechos` (RN-172) in the same
`useMemo` — within the same `turno`+`autor`, consecutive `agent.response`s
become a compact `Disclosure` ("Turn steps · N"),
leaving only the last one intact and outside it. `turno === 0` (the sentinel
prologue of `turnoDoSeq`) is left OUT of the grouping, on purpose —
it isn't a real turn, and old fixtures stack `agent.response`
without a turn boundary to test another mechanism (RN-138/RN-177).
An agent-agnostic function (it only reads `turno`/`autor`), `afundarDesfechos` itself
doesn't change.

- **Where:** `apps/engine/lib/engine/agents/{po,criativo,arquiteto,
  dev_lead,ux_designer,staff}_server.ex` (`tool.call` broadcast);
  `apps/web/src/lib/atividade-do-turno.ts` (reducer);
  `apps/web/src/components/TurnActivityStrip.tsx` (component);
  `apps/web/src/lib/session-channel.ts:54` (`onToolCall`);
  `apps/web/src/routes/session-fio.tsx:48` (`agruparNarracoesDoTurno`),
  `apps/web/src/routes/SessionPage.tsx:197` (`turnoViaCanal`)
- **Test:** `apps/web/src/lib/atividade-do-turno.test.ts`,
  `apps/web/src/components/TurnActivityStrip.test.tsx`,
  `apps/web/src/lib/session-channel.test.ts`,
  `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
  (`agruparNarracoesDoTurno`), suite of `apps/engine/test/engine/agents/
  *_server_test.exs` (`tool.call` broadcast without raw args)
- **Origin:** product owner's request

## "Needs you" panel (RN-467)

### RN-467 — The panel of the five decision queues NEVER sums and NEVER executes: it separates by queue and forwards to the decision {#rn-467}

The "Needs you" chip, at the top of the project, opens a panel with the project's FIVE
decision queues — action approvals, PR merges, story
promotions, architecture pending items, and Psicólogo hypotheses. Two guarantees
define it, and neither of them is aesthetic:

**It never sums.** Each queue has its OWN header and count, and there's no
project total anywhere: neither in the panel, nor in the chip that opens it — the
chip announces PRESENCE (a dot, `temAlgoEsperando`, boolean by signature)
and never quantity. It's the same product decision that already keeps the five
rail counters separate (ADR 0126): summing erases WHICH queue is asking for
attention, which is precisely the question of whoever opens the panel. `montarFilas`
returns the five in the declared order of urgency (`ORDEM_DAS_FILAS`) and doesn't
export a total function — the absence is the mechanism, not an oversight.

The only dedupe that exists is by IDENTITY, never between queues: the SAME
`git_merge` `proposed_action` arrives through both hooks (`usePendingActions` is
the session's and doesn't filter by type; `useProjectPendingActions` is project-wide) and
would appear twice in the same list, under two titles. It stays in the most
specific group (`prs`).

**It never executes.** The two actionable queues in the panel (`aprovacoes`, `prs`)
render the SAME `ApprovalCard` as the Approvals tab (a single variant since
AT-322, with the detail collapsed),
and the buttons call the same decision endpoints — the panel is a SHORTCUT to
the decision, never a substitute for it. That matters especially for
`git_merge`: a merge into a protected branch is downgraded to `require_approval`
UNCONDITIONALLY (`apps/api/src/domain/actions/decide.ts`), a ceiling that neither
`agent_autonomy` nor `permissions.json` lift, and nothing in the panel touches that
path. `onActivateAutoMode` is OMITTED on both cards on purpose: turning on
"auto mode" (RN-153) is changing the agent's POLICY, not deciding the action that's
in front of you — whoever wants that decides in the Approvals tab, where the workspace
role is already checked. The other three queues have no decision card outside
their context and therefore LEAD to the tab where the decision lives.

**The architecture pending item has no date of its own** — none, in any
field (`ArchitecturePendency`): it's a view DERIVED from crossing
story and `module_map`, recomputed on every read and never recorded. The panel
BORROWS the related story's date and SAYS it borrowed it ("story
updated 18 min ago", `dataEmprestada`); without the story in the loaded backlog,
it shows "no date" and sorts the item at the END of the queue. In no case an
invented instant: rendering "now" would make the most urgent line of the screen the one
least known about, with nothing exposing the lie. Adding a column and a migration
in the api would solve it for real and is a separate decision, outside this one's scope.

- **Where:** `apps/web/src/lib/precisa-de-voce.ts:108` (`ORDEM_DAS_FILAS`),
  `:117` (`FILAS_ACIONAVEIS`), `:139` (`montarFilas` — the dedupe by
  identity and the date borrowing), `:245` (`temAlgoEsperando`);
  `apps/web/src/components/PainelPrecisaDeVoce.tsx:246-248` (`role="dialog"`,
  `aria-modal`, label) and `:279-284` (group per queue, with its count);
  `apps/web/src/routes/ProjectPage.tsx:120` (builds the queues from the
  five hooks the rail counters already use)
- **Test:** `apps/web/src/lib/precisa-de-voce.test.ts` (the five queues
  separated with each one's items; nothing summed and no total function;
  the duplicated `git_merge` appears once, in the PRs queue; order by longest
  wait; borrowed date marked, absent becomes `null` and goes to the end),
  `apps/web/src/components/PainelPrecisaDeVoce.test.tsx` (five headers with
  each queue's count; the total appears nowhere; the empty state's own
  sentence; `ApprovalCard` decides by the action's OWN session; "Automatic
  mode" isn't offered; an architecture line without a date renders without
  breaking; `Esc`, click-outside, focus, and `aria-expanded`)
- **Origin:** design review by the product owner (item #3 of the UI
  improvements canvas)

## Environment state on screen (RN-468)

### RN-468 — An environment signal says what it KNOWS: `workspaceVerifiedAt` is a record of confirmation, never a guarantee that the runner is alive {#rn-468}

The product shows environment state in two places, and the slice of each is
the rule: the **login** screen shows only what's true WITHOUT identity, and the
**project Overview** shows what's only true WITH it.

**Pre-login, the slice is imposed by the data's scope, not by aesthetic
choice.** What remains are the two `/health` endpoints — public in both services on purpose
(`@Public()` in the api; "Sem auth de propósito" in `router.ex`), the same ones
`StatusPage` already consumes without a session. Runner presence is keyed by
`{user_id, project_id}` (`runner_device_keys`) and the model list is
`projects/:projectId/models` with role `viewer`: before login neither
subject exists, so the screen **declares the absence** ("Runner and
local models depend on your account and a project") instead of omitting it —
omitting it would make the platform look like it doesn't have what it has. The two `/health`
keep the THREE states separate (RN-088 applied to an environment signal):
`checking…` is not `no response`, and neither of them is `responding`. The
probe has a CEILING (6s): an api that accepts the connection and never answers would leave the
line at "checking…" forever, which is honest for half a second and
a lie by omission after ten.

**And the form never waits for the probe.** The state is local to the block, which is a
SIBLING of the card — an api that's down changes a text and doesn't delay or hide a pixel
of the login. That matters exactly at the moment the api goes down, which is when
someone most needs the screen to at least OPEN.

**Post-login, the rule is about what the data does NOT assert.** The runner signal comes
from `projects.workspace_verified_at` — the stamp `ConfirmProjectWorkspaceUseCase`
writes when a runner connects and confirms the folder (RN-423), and the SAME field
the engine uses as a gate (`TerminalExecutor` refuses a command in a
`runner` project with the field null). It **is not a heartbeat**, for two
independent reasons: there's no process being observed, and **reconnecting reporting the
same path doesn't rewrite the stamp** (an explicit decision of the use case), so
that not even the date is "the last time the runner showed up". The screen says "folder
confirmed on `<date>`" with the caveat of what that isn't, and **never** "up",
"online", nor a green dot — the tone is `neutro`, and green there would read as a
liveness guarantee the data doesn't support. What knows about NOW is the terminal's
socket, in the Code tab (`TerminalPanel`/`RunnerOnboardingPanel`), and the
caveat points there. The same discipline RN-467 used when borrowing
the story's `updatedAt`.

The runner line only exists in a project in `runner` mode: in the other two the
field is null by definition (the mode conversion resets it, RN-450) and a
"never confirmed" line there would be an invented absence.

- **Where:** `apps/web/src/components/SinaisDoAmbiente.tsx:72` (`useSaude` — the
  probe with a ceiling and the `.catch` of the connection rejection), `:133`
  (`SinaisDoAmbiente`, the pre-login block);
  `apps/web/src/components/AmbienteDoProjeto.tsx:92` (`AmbienteDoProjeto`),
  `:102` (runner line, only in `runner` mode, with `neutro` tone and caveat);
  `apps/web/src/routes/AuthLayout.tsx:46` (`colunaDeIdentidade` — nothing focusable
  there, or the first `Tab` stop stops being the e-mail field);
  `apps/api/src/application/use-cases/iam/confirm-project-workspace.use-case.ts:93`
  (the stamp is NOT rewritten when the path doesn't change — the reason the date isn't
  recency)
- **Test:** `apps/web/src/components/SinaisDoAmbiente.test.tsx` (the three
  distinct states; a connection rejection becomes "no response" and not silence;
  a non-OK response likewise; ceiling of a hanging probe; no focusable element; the
  absence of runner/models is declared),
  `apps/web/src/components/AmbienteDoProjeto.test.tsx` (no runner line
  outside `runner` mode; confirmed requires the caveat and the block doesn't contain
  `de pé|online|conectado agora`; never confirmed teaches the path; count
  of local models in singular, plural, and zero; query keys
  reused), `apps/web/src/routes/LoginPage.ambiente.test.tsx` (the form
  renders and submits with the probe rejecting AND with the probe hanging; a single
  `<h1>`; the version still has one source)
- **Origin:** design review by the product owner (item #6 of the UI
  improvements canvas)

### RN-469 — Saving a section is N calls, and the screen never asserts an outcome it didn't get {#rn-469}

In the Settings sections whose rows are a SCALAR setting per key
(`Parallelism per area` and `Spend ceiling per area`, both per `agent_areas`),
the save button is ONE, the section's, and not one per row. Saving triggers **one
call per dirty row** — `PUT .../areas/:key/max-parallel` and
`.../budget` are per-AREA endpoints, there's no transactional endpoint for "write
these N ceilings", and this product **didn't invent one**. The consequence is that the
outcome of a click can be partial, and the rule is about what the screen can
say then.

**The calls are in SERIES, in the screen's order, and one failure doesn't interrupt the
following ones.** In series because the failure report names rows and needs to come out
in the order the person sees them. Without interrupting because whoever clicked asked for the N:
aborting on the first refusal would leave rows with no attempt at all, and the screen wouldn't
be able to distinguish "the api refused" from "it didn't even try".

**The outcome is per ROW, and that's what the UI shows.** Only the draft the api
CONFIRMED is discarded; what failed stays in the field, with what the person
typed, and the section stays marked as unsaved by exactly those rows
— clicking Save again tries only them. The three outcomes are distinct and none
disguises itself as another: all passed → success; **none** passed → the message
the API gave, never a count; **some** passed → a warning saying how many
out of how many and **naming** the ones left. "Saved" and "not saved" would both be
a lie in the third case, and it's the one this RN exists to protect.

**The section declares HOW MANY rows are pending before the click.** One button
per section says "Save" the same with one dirty row and with five; the count
("2 unsaved changes in this section") is the counterpart of having swapped N
buttons for one. Dirty is a comparison by **interpreted value**, not by text:
`20` and `20.0` are the same ceiling, and comparing strings would send a call the
api treats as a no-op. An invalid draft counts as dirty and **replaces** the
count with the message explaining the block — two numbers about the same
set would be noise, and whoever has an invalid value needs what locks the button.

**Where the rule does NOT apply, and why.** A section whose control is a choice of a
NAMED value (`Story promotion`, `Models per agent`, `Model per area`,
role in `Members`) saves on `onChange`, with no button, and stays that way: the
confirmation exists for a TYPED field, where saving on each key press would send `1` on the
way to `12`. What that sentence measures is whose value it is: it applies to the
control that writes its OWN value, and doesn't reach a selector whose value is the
ARGUMENT of an action over other rows — see
[RN-476](#rn-476), which is the exception and says why. And `Credentials` keeps a button per row despite also having
`drafts` per key: the credential is write-only (ADR 0050) and never comes back from the
server, so there's no value to compare against to decide "dirty"; the row's
button alternates between "Save" and "Replace" depending on whether that provider already has a
key; and it shares the card with "Test" and "Remove", which are irreducibly
the row's.

- **Where:** `apps/web/src/routes/settings/secao-salvavel.tsx:105`
  (`useSecaoSalvavel` — the serial loop, the per-row outcome, and the three toasts),
  `:130` (dirty by interpreted value), `:241` (`MarcaDeNaoSalvo` — the count,
  and the invalid one replacing it),
  `apps/web/src/routes/settings/ParallelismSection.tsx:31`,
  `apps/web/src/routes/settings/BudgetSection.tsx:37` (the two consumers),
  `apps/web/src/routes/settings/CredentialsSection.tsx:57` (why this section
  was left out)
- **Test:** `apps/web/src/routes/settings/secao-salvavel.test.tsx` (the count
  of dirty rows; going back to the server's value clears the mark; invalid
  replaces the count and locks the button; one click persists all the dirty
  rows; a number and `null` in the same batch; a partial failure says how many out of how many and
  names the one left; the section stays marked by those that failed; the second
  click tries only them; one failure doesn't interrupt the following ones; none passing
  shows the API's message and not the count)
- **Origin:** design review by the product owner (item #7 of the UI
  improvements canvas — "save per section instead of per row")

### RN-470 — A origem do modelo distingue binding próprio de herança do Criativo, e nenhum vazio da cascata usa o mesmo símbolo de outro {#rn-470}

`origin: 'agent'` na resposta da api significa **duas coisas diferentes**, e a
api está certa em não separá-las: o agente tem uma linha de escopo `agent` em
`model_bindings`, **ou** a cascata pousou em `workspace` e
[`herdarModeloDeStart`](api.md#rn-102) trocou o valor pelo modelo do Criativo — quem
lê "de onde veio" precisa ver que veio de um AGENTE, não de um escopo que não
existe no banco. Quem tem de separá-las é a **tela**, e até aqui ela não
separava: a coluna Origem imprimia o enum cru, e num projeto com 3 linhas de
`agent` no banco os 12 agentes mostravam a mesma palavra `agent`.

**A origem é uma CADEIA, não uma palavra.** `workspace › projeto › área ›
agente` com quatro estados por nó, e os quatro existem porque dizem coisas
diferentes: **vigente** (é daqui que sai o modelo em uso — o único nó em
`Badge`), **definido** (este nível tem valor próprio, mas um mais específico
venceu), **vazio** (nenhum valor aqui) e **pulado** (tinha valor e a cascata o
descartou por `unavailable`/`sem_tool_calling`, [RN-043](api.md#rn-043)). Colapsar
`definido` em `vazio` devolveria o problema do enum cru um nível abaixo.

**Na herança, o nó `agente` fica VAZIO e um nó extra nomeia o Criativo.** O
nível que a cascata alcançou (`workspace`) aparece como `definido` e **não**
como vigente: o modelo do workspace não é o que vale, e marcá-lo vigente
afirmaria o modelo errado. O nó do Criativo é o único que não é escopo do
banco, de propósito — ele nomeia o passo pós-cascata. A mesma cadeia vale para
a seção de ÁREA, onde `origin: 'agent'` **só** pode ser esse passo: a consulta
de área não põe escopo de agente na cascata.

**A derivação é do CLIENTE, e o que ela não consegue provar continua
acionável.** Nenhum endpoint novo: a tela já busca os quatro níveis. `agent` é
herança quando nenhum nível acima do workspace tinha valor UTILIZÁVEL (o que
foi pulado não segura a descida) e o modelo é o mesmo do Criativo resolvido.
Sobra um caso indistinguível: agente com linha própria apontando para o mesmo
modelo do Criativo, sem padrão de área nem de projeto. Por isso "voltar a
herdar" continua aparecendo em toda origem `agent` — a ação segue disponível
justamente no caso que a cadeia não prova, e nele ela ainda muda o futuro
(sem a linha, o agente passa a acompanhar o Criativo).

**A outra metade dessa escolha: o 404 tem desfecho próprio.** Manter o botão em
toda origem `agent` significa oferecê-lo TAMBÉM onde não há linha para apagar —
e ali `ClearModelBindingUseCase` responde **404**, corretamente ("apaguei o que
não existia" e "apaguei" não são a mesma resposta; colapsá-las esconderia um
`agentSlug` errado). Para quem clicou, porém, esse 404 não é falha: o estado
pedido — o agente herda — **já é verdade**, e chamá-lo de erro seria a tela
contradizendo o que ela sabe. Então ele não passa por `mensagemDaApi` como as
demais recusas, por dois motivos: a frase da api é pt-BR cravada no código e o
idioma default do web é `en`, e este endpoint tem **uma** causa de 404 (papel
insuficiente é 403 no `RolesGuard`, `scope_id` malformado não é 404) — o cliente
SABE o que este 404 significa e pode dizer na língua de quem lê. Qualquer outro
status continua sendo falha de verdade, com a frase da api e tom `danger`. Nos
**dois** desfechos a linha é relida: se a api diz que não havia binding, quem
está velha é a tela.

**E o desfecho próprio é do ENDPOINT, não da tela.** A outra ação da mesma
linha — trocar o modelo pelo `ModelPicker` da coluna MODELO VIGENTE — recusa
por sete caminhos, e **nenhum status identifica um deles sozinho**
(`SetModelBindingUseCase`): 400 para `scope_id` malformado ou `modelId`
reprovado no DTO, 403 para papel abaixo de `developer`, **404 para duas causas
indistinguíveis** ("Modelo não encontrado" e "Projeto não encontrado") e 422
para três ([RN-040](api.md#rn-040) sem tool calling; [RN-043](api.md#rn-043) desativado no
workspace ou sumido do provider). Ali o cliente NÃO pode nomear o 404 —
escolher uma das duas frases seria a tela afirmando o que não sabe —, então
toda recusa segue a gramática normal, com a frase da api e tom `danger`. As
duas funções são vizinhas e tratam o mesmo status de formas opostas de
propósito: o que autoriza o desfecho próprio é a causa ÚNICA, não a tela.

**Na recusa, a coluna MODELO VIGENTE continua exibindo o binding confirmado.**
O `ModelPicker` não guarda a escolha em estado local (`selected` sai do prop
`selectedModelId`, que vem da query), então uma recusa não deixa na tela um
modelo que a api se recusou a gravar — e a linha só é relida no sucesso, já que
na recusa nada mudou no banco. É a mesma disciplina desta RN aplicada ao
tempo: a tela não afirma um estado que não existe, nem por traço, nem por enum,
nem por otimismo.

**Vazio tem texto próprio, e vazios diferentes têm textos diferentes.** Os três
`—` da tela diziam três coisas com o mesmo símbolo e agora dizem cada uma a
sua: `sem modelo em nenhum nível` (nenhum nível tem binding para o agente),
`sem gasto ainda` (o agente não registrou consumo — diferente de `US$ 0,00`,
que é ter rodado de graça) e `sem padrão em nenhum nível` (a área e os dois
níveis acima dela estão vazios). Mesma disciplina da
[RN-180](#rn-180): a tela não afirma com um traço o que não
consegue nomear.

- **Onde:** `apps/web/src/routes/settings/cascata.tsx:119` (`montarCadeia` — os
  quatro estados e o nó do Criativo), `:178` (`herdouDoCriativo` — a dedução e
  seu limite), `:287` (`CadeiaDeCascata`),
  `apps/web/src/routes/settings/ModelsSection.tsx:149` (`cadeiaDoAgente`),
  `:329` (`handleModelChange` — por que aqui o 404 NÃO tem desfecho próprio, e
  por que a linha só relê no sucesso), `:385` (`handleClearAgentBinding` — os
  três desfechos, e por que o 404 tem o dele), `:359` (coluna Origem), `:429`
  (`não há nível abaixo`), `:448` (`sem gasto ainda`),
  `apps/web/src/components/ModelPicker.tsx:95` (`selected` sai do prop — o
  picker não guarda a escolha, e é por isso que a recusa não deixa valor
  fantasma na tela),
  `apps/api/src/application/use-cases/llm/set-model-binding.use-case.ts:38`
  (as duas causas de 404 deste endpoint — este arquivo NÃO mudou),
  `apps/api/src/interfaces/http/shared/llm-binding-error.filter.ts:39`
  (400/422 das recusas de curadoria — este arquivo NÃO mudou),
  `apps/web/src/routes/settings/ModelsSection.tsx` (a cadeia da área),
  `apps/api/src/application/use-cases/llm/clear-model-binding.use-case.ts:25`
  (o 404 que a api levanta — este arquivo NÃO mudou),
  `apps/api/src/domain/llm/binding-resolver.ts:140` (o `origin: 'agent'` que a
  api devolve, e o comentário que explica por que ele está certo — este
  arquivo NÃO mudou)
- **Teste:** `apps/web/src/routes/settings/cascata.test.tsx` (binding próprio
  termina no nó `agente`; herança deixa `agente` vazio e nomeia o Criativo;
  o workspace nunca aparece vigente na herança; a seção de área idem; a
  distinção sobrevive ao `en`; nível descartado vira nó riscado e o badge
  concorrente sumiu; os três vazios com três textos; `montarCadeia` e
  `herdouDoCriativo` como funções puras, incluindo o caso do padrão de área
  DESCARTADO, que não segura a descida),
  `apps/web/src/routes/settings/voltar-a-herdar.test.tsx` (os três desfechos do
  clique: apagou e relê; 404 não é erro, não repassa a frase pt-BR da api nem
  em `en`, e relê porque a tela é que estava velha; outro status vai por
  `mensagemDaApi` e não relê),
  `apps/web/src/routes/settings/troca-de-modelo.test.tsx` (a outra ação da
  mesma linha: grava e relê; 422 do modelo `unavailable` — o alcançável, já
  que o picker mostra o indisponível marcado — vai por `mensagemDaApi` e não
  relê; a coluna MODELO VIGENTE segue no modelo antigo, nunca no recusado; e o
  404 NÃO ganha desfecho próprio, que é o contraste com a função irmã)
- **Origem:** revisão de design do dono do produto (item #9 do canvas de
  melhorias de UI — "cascata de modelo como cadeia visível")

## The Members section respects the role, and the role is the project's EFFECTIVE one (RN-471)

### RN-471 — Role in the Members section: `maintainer`, and derived from the project's row over the workspace's {#rn-471}

`MembersSection` checked no role at all. The section's THREE actions — invite,
change someone's role, and remove — appeared active for everyone, `viewer`
included, and the api refused with 403. Two of them didn't even get to say so:
`handleRoleChange` and `handleRemove` had no `try/catch` and were called from an
`onChange`/`onClick`, so every refusal became an `unhandled promise rejection` —
silence on screen and noise in the console, the same class of defect that
[RN-102](api.md#rn-102) closed in the models table. Removing a
member silently is the worst of the three: it's a consequential action with no way back through the screen,
because restoring requires the UUID the removed row took with it.

**The minimum is `maintainer`, and it's the ENDPOINT's.** The three paths require the same
(`projects.controller.ts`), and `GET` requires `viewer` — that's why whoever doesn't edit
still sees the whole table:

| action | endpoint | role |
|---|---|---|
| invite | `POST :projectId/members` | `maintainer` |
| change role | `POST :projectId/members` (upsert) | `maintainer` |
| remove | `DELETE :projectId/members/:userId` | `maintainer` |
| see the table | `GET :projectId/members` | `viewer` |

Copying the models section's gate (`developer`, and correct there) would offer the
three controls here to those the api refuses. It's the SECOND section in a row whose minimum differs
from its neighbor: the ruler is still the endpoint, never the screen next door.

**The role is the PROJECT's EFFECTIVE one — and this CLOSES the gap RN-102 declared,
it doesn't repeat it.** There the screen reads the WORKSPACE role while what authorizes is
`ResolveEffectiveRoleUseCase.forProject`, and closing that would require a per-project role
query the web doesn't have. It's the SAME gap here, seen from the other side:
this section ALREADY makes that query. `listProjectMembers` is `findMemberRole` for
everyone at once, and `userIdDaSessao()` (the access token's `sub`) says which
row belongs to whoever is looking. The composition is literally the use case's —
`projectRole ?? workspaceRole` —, not a second source of role invented only on
this screen. While the list hasn't arrived the role is ABSENT, not the workspace's:
without it there's no way to know whether an own row exists, and erring on the side of
disabling is fixed by reloading.

**The override applies in BOTH directions, and FOUR places said otherwise.**
`forProject` returns the `project_members` row when it exists, without comparing
with the workspace. So setting `viewer` here really downgrades — even a workspace
`owner`, who afterwards can only be restored by someone with `maintainer`. The code never
did the opposite, and `resolve-effective-role.use-case.spec.ts` itself fixes this
("papel de projeto sobrepõe o de workspace"). Where the false promise was:

| place | what it said | status |
|---|---|---|
| description of `POST :projectId/members` | "the EFFECTIVE role is the higher of this one and what the person already has in the workspace"; "associating someone as `viewer` here doesn't downgrade a workspace `owner`" | **not fixed** — it's an api change |
| description of `AddMemberDto.role` | the same "higher of" sentence | **not fixed** — it's an api change |
| summary of `GET :projectId/members` | "with their effective role"; "includes whoever inherits access from the workspace" | **not fixed** — it's an api change |
| `apps/web/src/lib/roles.ts:3` | "Papel efetivo nunca é rebaixado" | **fixed here** |

The three in the api stay declared and aren't touched in passing: the descriptions
propagate to `api-types.generated.ts`. The web one is WORSE than the other three and was
therefore fixed along with it — the api ones at least live in an OpenAPI
description, while that one was in the module that `roleAtLeast` and `ROLE_ORDER` export, that
is, in the code the next person of this family of fixes will open and
edit, reading the wrong rule before anything else. The linear hierarchy
declared on the same line remains valid — it's the order `roleAtLeast` compares, and
it didn't change. The screen, in turn, SAYS what holds, instead of letting the `Select` be
read as a harmless suggestion.

**The CONTROL disappears, never the INFORMATION** (ADR 0064). Whoever doesn't have `maintainer`
keeps reading each member's role in the dimmed `Select` itself — it's the
table's central information, and swapping it for text would hide the state along with
the action. The reason is said ONCE, in text, in the caption: `title` on a
`disabled` element doesn't open in Chromium, and one line per member would repeat a fact about
WHO IS LOOKING on top of each person on the list.

**The table is a SLICE, and declares it
([RN-180](#rn-180)).** `listMembers` is an
`innerJoin` on `project_members`: whoever reaches the project only through the workspace doesn't
appear in any row, although the `GET` summary promises "includes whoever
inherits access from the workspace". That data is NOT within the client's reach —
no web query lists workspace members with role —, so the caption
says the list omits, instead of letting it be read as "everyone who has
access". It's the remaining gap, and it's declared, not handled.

**None of this is a security boundary:** what refuses is still
`RolesGuard`.

**Invite keeps the fixed hint, and it's a decision.** The other two actions use
`mensagemDaApi` because their `userId` came from the list and exists — what remains is
403 and network, and the api's sentence is the most useful information there is. In the invite the
`userId` is TYPED, and the reachable error is pointing to a nonexistent user:
a well-formed UUID passes `@IsUUID()`, blows the FK
`project_members.user_id → users.id`, none of the global filters handles it, and
Nest answers the default 500. `mensagemDaApi` would return "Internal server error",
worse than the hint — its `padrao` only applies to an error that isn't an `ApiError`.
Uniformizing the form would worsen the content on the box's most likely path.

- **Where:** `apps/api/src/interfaces/http/iam/projects.controller.ts:121`,
  `:135`, `:147` (the three roles — these lines did NOT change),
  `apps/api/src/application/use-cases/iam/resolve-effective-role.use-case.ts:14`
  (`projectRole ?? workspaceRole`, the override in both directions),
  `apps/api/src/infrastructure/persistence/drizzle/project.repository.ts:194`
  (`listMembers` — the `innerJoin` that makes the table a slice),
  `apps/web/src/routes/settings/MembersSection.tsx:62` (the effective role and
  why `maintainer`), `:109` (why invite doesn't use `mensagemDaApi`), `:142` and
  `:162` (the two missing `try/catch`),
  `apps/web/src/lib/roles.ts:49` (`roleAtLeast`), `:3` (the `ROLE_ORDER` comment,
  which asserted "papel efetivo nunca é rebaixado" — the fourth place
  in the table above, and the only one fixed)
- **Test:** `apps/web/src/routes/settings/papel-na-secao-de-membros.test.tsx`
  (`viewer` and `developer` don't edit and the click doesn't reach the api; `maintainer` and
  `owner` edit and the POST/DELETE arrive; an absent role is inert; the row's
  role survives the dimmed control; the PAIR that proves the override in both
  directions — a workspace `viewer` with a `maintainer` row EDITS, a workspace
  `owner` with a `viewer` row does NOT edit; the two refusals become a toast with the
  api's sentence; the screen doesn't start displaying the role the api denied; and invite
  keeping the fixed hint against a 500)
- **Origin:** review of #443 — the gap it declared, seen from the section that
  has the data to close it
- **Addendum (additive, the text above didn't change):** the three OpenAPI descriptions
  the table marks as "not fixed" WERE fixed later, by
  [RN-472](api.md#rn-472) / [ADR 0127](../adr/0127-tetos-de-rebaixamento-em-project-members.md),
  in the same change that put the two downgrade ceilings in the api. Don't reopen
  that row of the table.

---

## The folder comes first, and the binary isn't a blocker (RN-473/474)

### RN-473 — Runner configuration through the browser starts with the FOLDER, and the binary's failure never discards what has already been configured {#rn-473}

> **Revised by [RN-687](#rn-687) ([ADR 0203](../adr/0203-aposenta-o-fluxo-do-runner-pelo-navegador.md), 10/01):**
> the flow this RN orders was REMOVED — `runner-bootstrap.ts` and its test were
> removed with the browser flow. What survives of it is the ruler of the human
> step stated BEFORE, which the panel applies to the installer's command.

The flow of [RN-464](api.md#rn-464)..[466](runner.md#rn-466) ran in the order `key → registration
→ binary → folder` (`configurarPastaAutomaticamente`,
`apps/web/src/lib/runner-bootstrap.ts`). The four steps don't carry the same risk:
the binary download is the ONLY one that depends on a release published on GitHub
(`RunnerReleasesController`, a proxy of `releases/latest`), and with the
current release having no asset for any platform it returns **502**. The exception went up
before `showDirectoryPicker`, so **the folder picker never got to
open** — the button looked inert and the folder was unreachable, with the
whole configuration lost because of the most fragile step.

The order becomes `folder → config → key → registration → private key →
binary`, and the last step is **best-effort**:

| step | does failure take down the flow? | why |
|---|---|---|
| 1. `showDirectoryPicker` | **yes** | without a folder there's nowhere to write anything. Cancelling (`AbortError`/`NotAllowedError`) is NOT a failure — it goes back to the initial state, with no alert |
| 2. `brabo-runner.config.json` | **yes** | it's half of the pair [RN-466](runner.md#rn-466) reads |
| 3. Ed25519 pair + `registerRunnerDeviceKey` + `…device-key.jwk.json` | **yes** | a private key on disk with no counterpart on the server doesn't authenticate; that's why registration comes BEFORE writing, and the two are adjacent |
| 4. binary | **no** | returns `falhaDoBinario` filled in; the final instruction becomes `npm install -g @brabo/runner && brabo-runner` |

The alternative path works **with no flag at all** precisely because steps
2 and 3 have already run: the CLI reads both files from the `cwd` (RN-466). It's one of the THREE
distribution paths the `CLAUDE.md` declares, and the only one that depends on
neither the release nor a monorepo checkout. `baixarKitManual` (outside
Chromium) follows the same ruler by inverting the order of the two downloads: the **kit**
comes out first, the binary last.

**The terminal step is human, and the screen never pretends otherwise.** A web
page doesn't execute a binary on anyone's machine, and the File System Access API doesn't
preserve the execute bit — hence the `chmod +x` remaining in the command. What the
product does is shrink that step to ONE line copyable with one click; no
UI text says "automatic installation".

**And it's announced BEFORE the click, not only after.** The sentence explaining the
step existed from the start, but was rendered only in the SUCCESS state —
after the person chose the folder, waited for the key registration and the binary
download. Whoever clicks a button called "Configure folder automatically" and
only then finds out they still need to open a terminal was surprised, even
without any sentence having lied: announcing at the end is the latest possible moment to
still not be pretense. Now there's a warning in the initial state, next to the
button, and the one at the end STAYS — the two say different things (one warns that the
step will come, the other explains why it exists). The button's label did **not**
change: it speaks of the FOLDER, which is indeed configured automatically, and changing it
would describe worse what it does.

**The final command says which folder to run in, when it can assert which one it is.** The
instruction said "inside the chosen folder, run: …" without ever saying where that
folder is — the File System Access API exposes only the basename (`dirHandle.name`),
never the absolute path. The path exists on the other side: it's the
`projects.workspace_path` the person typed when creating the project. When its
basename matches the chosen folder, the instruction gets a
`cd <caminho> && ` prefix; when it does NOT match, it comes out without a prefix — nothing forces the person to
choose in the picker the same folder they typed, and a `cd` to the wrong place
would be the screen asserting what it doesn't know. The basename is the most that can be proven
from here, and the rare case where it coincides for different folders fails LOUD
(`cd` doesn't find the path, or `./brabo-runner` isn't there), never silently —
which is the ruler that decides whether a heuristic may come in. The manual kit (fallback
outside Chromium) does **not** get the prefix, and it isn't forgetfulness: there the
files land in the downloads folder, and `cd` would send you where they aren't yet.

**Declared gap:** closing the tab between step 3 and the end leaves an **orphan** device
key in the project. It's inert — the corresponding private key only
existed in that tab's memory, and without it the key authenticates nothing — but today
it's invisible: `RunnerDeviceKeysController` has `POST` and `DELETE`, and no
LISTING route, so there's no screen where to revoke it. Redoing the flow registers a
new key, which works. A listing is direct work on the `DELETE` that already
exists, when requested.

- **Where:** `apps/web/src/lib/runner-bootstrap.ts`
  (`configurarPastaAutomaticamente`, `baixarKitManual`, `COMANDO_VIA_NPM`),
  `apps/web/src/components/RunnerOnboardingPanel.tsx`
  (`ehCancelamentoDoSeletor`, the outcome block)
- **Test:** `apps/web/src/lib/runner-bootstrap.test.ts` (the order of the four
  steps asserted as a list; binary 502 and a binary WRITE failure
  writing the other two files and returning the alternative command;
  picker cancellation without registering a key nor downloading anything; the kit coming out
  even with the binary at 502),
  `apps/web/src/components/RunnerOnboardingPanel.test.tsx` (the folder is announced
  with the failure's reason beside it; cancelling doesn't become an alert)
- **ADR:** [0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)
  — this RN revises the ORDER of the flow it established, not the mechanism
- **Origin:** product owner's request

### RN-474 — After the instruction, the screen WAITS for the runner: three states, a ceiling, and the path that holds is the one the runner reported {#rn-474}

Configuring the folder and showing the command left the person not knowing whether it had
worked. The fourth step is a wait that resolves on its own
(`apps/web/src/components/EsperaDoRunner.tsx`), mounted by
`RunnerOnboardingPanel` as soon as the configuration ends — on both paths
(folder written and kit downloaded).

**The mechanism is what already existed.** The signal is `project.workspaceVerifiedAt`, the
stamp `ConfirmProjectWorkspaceUseCase` writes when the runner connects
([RN-423](runner.md#rn-423)) and which the engine uses as a GATE (`terminal_executor.ex`
refuses to execute in a `runner` project with null `workspace_verified_at`) — the
product's own definition of "this project has a runner". It's the same data that
`AmbienteDoProjeto` already reads ([RN-468](#rn-468)), under the same cache key
`['project', id]` the whole page maintains. The alternative considered was
probing `connectFsBrowserChannel` (whose error `'Nenhum runner conectado'`
`FolderBrowserModal` detects): it knows about NOW, which is stronger, but the channel
writes `erroDeConexao` permanently per instance, so each probe
would cost a NEW ticket + socket — dozens over the wait — and it still wouldn't
answer the second half of what the screen must say: WHICH path the runner
reported.

**Confirmed is the stamp CHANGING, never "existing".** The wait takes a
baseline on the first `GET` and compares against it. Without that, a project already confirmed
before would be announced as freshly connected the instant the screen opened.

**The three states don't collapse, and none is eternal** ([RN-088](#rn-088),
[RN-468](#rn-468)):

| state | what the screen says |
|---|---|
| `esperando` | "looking for the runner", with the ceiling DECLARED ("we stop after 3 minutes") |
| `confirmado` | the stamp's date AND the `workspacePath` the runner reported, saying it replaces what was typed — the screen doesn't compete with whoever runs on the real host |
| `semResposta` | the ceiling overflowed, and the screen declares what it does NOT know: reconnecting with an already confirmed folder doesn't rewrite the stamp, so absence here isn't proof of absence, and what knows about now is the Code tab. A button restarts the search without redoing the configuration |

- **Where:** `apps/web/src/components/EsperaDoRunner.tsx` (`INTERVALO_MS`,
  `TETO_MS`, the baseline in `base`),
  `apps/web/src/components/RunnerOnboardingPanel.tsx` (who mounts it)
- **Test:** `apps/web/src/components/EsperaDoRunner.test.tsx` (the three
  states, one by one, each asserting that the other two are NOT on screen; the
  preexisting stamp that doesn't count as a new connection; the ceiling overflowing with
  a fake timer and the button that restarts)
- **ADR:** [0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)
- **Origin:** product owner's request

## The `kid` is the link, and the refusal has a name (RN-475)

### RN-475 — The private JWK written by the browser carries the registration's `kid`; and the CLI distinguishes "there's no key" from "there's a key and it doesn't work" {#rn-475}

> **Revised by [RN-687](#rn-687) ([ADR 0203](../adr/0203-aposenta-o-fluxo-do-runner-pelo-navegador.md), 10/01):**
> the BROWSER half left with the flow (and the e2e that proved it in a Chromium);
> the stamped `kid` still applies to the key created in the terminal
> (`device-key finish --id`, RN-551), and the CLI half — absent × refused —
> remains intact.

The automatic mode of [ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)
([RN-464](api.md#rn-464)..[466](runner.md#rn-466)) **never authenticated a single time** since it
was born. The two halves of this RN are the defect and what hid it.

**The `kid` isn't decoration — it's the only link between the two sides.** The `id` that
`POST projects/:projectId/runner-device-keys` returns identifies the
`runner_device_keys` record that keeps the PUBLIC key. It needs to reach disk
INSIDE the private JWK, in the `kid` field (RFC 7517), because that's how the whole
chain carries it: `lerChaveDeDispositivo` only PASSES ON `jwk.kid` (it never invents
nor derives an id),
`assinarTicketComChaveDeDispositivo` puts it in the protected header of the ticket
JWT, and `PatAuthGuard` uses exactly that `kid` to find the public key and
verify the signature ([RN-465](api.md#rn-465)).

The browser **discarded the return** of `registerRunnerDeviceKey` on BOTH
paths (`configurarPastaAutomaticamente` and `baixarKitManual`), and
`crypto.subtle.exportKey` exports the RAW JWK, with no `kid` at all. The producer
wrote a file the consumer **always** refuses — and the defect was
invisible from both sides: each function was correct on its own. The proof is in the
database: the keys registered by the flow had null `last_used_at`, all of them.

The fix is structural, not one line: step 3 of [RN-473](#rn-473) (export
the public key, register, export the private key) becomes ONE function
(`registrarChaveEExportarPrivada`), with the `id` flowing inside it. Discarding it
again now requires deleting code, not forgetting an assignment. The `kid` goes
only in the PRIVATE key: the public one doesn't carry it, because it's its registration that produces it.

**The refusal has a name.** `lerChaveDeDispositivo` returns `null` without throwing — on
purpose, and that doesn't change: the absence of the files is the NORMAL path of whoever
runs with `--project`/`--dir`/`--token`. But `null` answered two
different questions, and the CLI printed the SAME `uso()` block — which talks about flags and doesn't
mention the file — both for "you configured nothing" and for "your
folder is configured and the key doesn't work". A person with a perfect
`brabo-runner.config.json` was sent to investigate precisely the side
that was right.

| state | who answers | CLI output |
|---|---|---|
| `ausente` | normal path | the `uso()` block, unchanged |
| `json-invalido` | refusal | `explicacaoDaChaveRecusada` — names the file, the reason, and the two ways out (rewrite the folder through the browser, or `--token` meanwhile) |
| `sem-kid` | refusal | likewise, naming the missing field and what it's for |
| `valida` | follows the flow | — |

`estadoDaChaveDeDispositivo` and `explicacaoDaChaveRecusada` live in
`device-key.ts` because they talk about the FILE; what to DO with the refusal (exit, with
which code, with or without the usage block) remains `index.ts`'s, as the
module's docblock already said. The type of `explicacaoDaChaveRecusada` excludes
`ausente` and `valida`: there's no explanation for the normal case nor for
success, and a vague text covering the four states would be the same defect
again.

**What let it through:** the web test asserted that the file had been
OPENED (`getFileHandle` called with the right name), never what was
INSIDE it. A test that proves the creation of a file without proving its content lets
anything be written. The double now ties name → content, and the two
old assertions gained the missing half.

- **Where:** `apps/web/src/lib/runner-bootstrap.ts`
  (`registrarChaveEExportarPrivada`, `exportarJwkPrivada`),
  `apps/runner/src/device-key.ts` (`estadoDaChaveDeDispositivo`,
  `explicacaoDaChaveRecusada`, `EstadoDaChaveLocal`),
  `apps/runner/src/index.ts` (the credential branch in `lerArgumentos`)
- **Test:** `apps/web/src/lib/runner-bootstrap.test.ts` (the written `kid` IS the
  returned `id`, proven with an id different from the default; both paths —
  folder and manual kit; the public key WITHOUT `kid`; the useful key surviving the binary
  at 502), `apps/runner/src/device-key.spec.ts` (the four states, one by one;
  absent ≠ sem-kid while `lerChaveDeDispositivo` collapses both into `null`;
  the two refusal sentences different from each other),
  `apps/runner/src/index.spec.ts` (the REAL CLI, in a separate process: the
  folder without a key falls to the usage block, the folder with a key without `kid` falls to the
  named refusal, and the two outputs aren't equal — the defect was that they were)
- **ADR:** [0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)
  — this RN doesn't revise its mechanism, it closes the contract it left
  implicit between the two ends
- **Origin:** real use of the flow against the local environment by the product owner

## Environment state on screen (RN-468)

### RN-476 — Applying a model to ALL agents: one value, N calls, and a button even though the value is named {#rn-476}

The `Models per agent` table has one row per agent and a selector in each
one. Choosing the same model for the 17 meant going through the 17 rows, and the cost
of that isn't time: it's that nobody checks 17 dropdowns and the screen has no way to
say whether one was left behind. The section gains a bar ABOVE the table — a
selector and a button — that applies ONE model to all agents at once.

**The action writes at the AGENT level, on the 17 rows — not on the project.** The two
readings of "one model for all" exist and produce different states:
writing on the project and deleting the agent and area bindings would make the 17
INHERIT, and that's the cascade's own idiom. It wasn't the one chosen, for two
concrete prices: `PUT projects/:id/model-binding` and the area endpoints require
`maintainer`, while the agent binding requires `developer` — the same person
who can change row by row would no longer be able to do it all at once —, and the
project binding is also the SESSION's default, which
[RN-040](api.md#rn-040) leaves free on purpose. The choice
has a declared price: the 17 rows now diverge, with origin `agent` in the
Origin column, and going back to inheriting remains row by row.

**There's a button, even though the value is NAMED.** The ruler of
[RN-469](#rn-469) says a choice of a named value saves on `onChange`, and it
still applies to EACH ROW's selector, which writes its own value. The
bar's selector isn't configuration of anything: it's the argument of the action next to it.
Applying on `onChange` would make an exploratory click on a dropdown rewrite 17
rows the person wasn't editing, and undoing that is 17 clicks. The
button NAMES how many rows it will reach, because that number is the consequence.

**The outcome follows RN-469 entirely, and that's the reason the bar invents
nothing.** One call per agent, in SERIES, in the screen's order, without aborting on the
first refusal — aborting would leave 16 rows with no attempt and the screen wouldn't
distinguish "refused" from "didn't even try". The three outcomes don't disguise themselves:
all passed → success naming the model; **none** passed → the api's
message, never a count; **some** passed → a warning with how many out of how many,
naming the ones left by the agent's NAME, which is what the person reads in the
first column. Only the rows the api CONFIRMED are reread: invalidating the 17
would erase from the screen the difference the partial report just counted.

**The gate is the ENDPOINT's, and the endpoint is the same as the row controls'.**
`developer`, through `PUT projects/:projectId/agent-bindings/:agentSlug` — not the
neighboring area section's `maintainer` ([RN-102](api.md#rn-102)).
The button is inert for whoever doesn't reach it, and the reason is said ONCE, in TEXT,
in the section's caption, together with the other two actions that are inert: `title`
on a `disabled` element doesn't open in Chromium (ADR 0064). The selector's "fit for
agents" filter opens CHECKED, as in the row picker and for the same reason
([RN-040](api.md#rn-040)) — with more force here, because a
chat-only model chosen in the bar wouldn't produce one 422, but 17, and the
partial report would count the same refusal seventeen times.

- **Where:** `apps/web/src/routes/settings/aplicar-a-todos.tsx:66`
  (`useAplicacaoEmLote` — the serial loop and the three outcomes),
  `apps/web/src/routes/settings/ModelsSection.tsx` (the bar, the local state of the
  chosen model, and invalidating only the confirmed rows)
- **Test:** `apps/web/src/routes/settings/aplicar-a-todos.test.tsx` (writes the
  same model on all agents, in the screen's order; none passing shows the
  api's message and NOT the count, and still tries all of them; a partial failure says
  how many out of how many and names the one left; a role below `developer` leaves the
  button inert and the reason stays in text)
- **Origin:** the product owner's request while configuring a blank environment with a single
  provider — all agents needed the same model

---

## RAG search leaves a trace, and the trace freezes the weights (RN-479..481)

### RN-491 — The Infra elects among the Arquiteto's candidates, and the election becomes a NEW version of `artifact.project_image` {#rn-491}

`propose_container_start` closes the half RN-487 left declared
open: the Infra elects ONE of the `imagemCandidata` of the Arquiteto's current routing
(`artifact.module_routing`) and proposes bringing up the project's REAL container.
The election only has effect because `ExecuteContainerStartUseCase` REUSES
`DecidirImagemDoProjetoUseCase` to emit a new version of
`artifact.project_image` with `decidedBy: 'infra-lead'` — without that the election
would be auditable and INERT: the broker composes the container by reading `GET
.../container-spec`, which reads `artifact.project_image` (RN-105), never
`artifact.module_routing`.

**The elected image must be in the candidates list, always — validated
BEFORE touching the artifact.** Outside the list, the action fails naming the refused
image and listing the valid candidates, and neither `DecidirImagemDoProjetoUseCase`
nor the broker gets called: the Infra elects, never invents.

**A new `container_start` (`maintainer`, the same caliber as `open_infra_pr`/
`parallelize`), deliberately OUTSIDE the block of absolute ceilings of
`decide.ts`** — the same reasoning already recorded there for
`propose_execution_plan`/`assess_implementability`: it's the FIRST time this
container really comes up for this election, not exceeding an already
authorized ceiling. Unlike `open_infra_pr`, this action is NOT seeded in
`INFRA_AUTONOMY_SEEDS` — the Infra Lead never applies anything with `open_infra_pr`
(it only proposes a PR a human still merges), but bringing up a container is a
real external effect, so it stays `require_approval` by default, decided case
by case through the `ApprovalCard`. A `maintainer` CAN configure auto-approval
later, and that's why `ProposeActionUseCase` also executes on the
`auto_approved` path, the same lesson as the comment about `parallelize` in that file
("without this the action was born, was approved — and nothing came up").

**Revised by [RN-671](api.md#rn-671) (ADR 0190, 10/01):** `container_start` becomes
SEEDED `auto_approve` on the acceptance of the Infra's handoff, and the Infra
Lead's server proposes the first startup on its own when there's routing. The rest of this
rule — the candidates list, `maintainer`, outside the absolute ceilings — remains.

**After the broker confirms, the lifecycle transition follows ADR 0081's state
machine, never reprovisions needlessly.** No row yet, or a row in
`failed`/`removed`: `provisioning` (the one that reads the newly decided image and
freezes `imageVersion`) and only then `running`. A row in `stopped`: straight to
`running` — the state machine doesn't even allow `stopped -> provisioning`, and
reprovisioning would reemit an image already written in the row. A row already
`provisioning`/`running`: completes the pending transition or does nothing,
relying on the broker's idempotent `start` (`jaEstavaDePe`).

**Revises RN-485.** "Nothing triggers a startup... the only caller that exists today
does a READ" stops being true: `container_start` is the first real caller
of `ContainerBrokerPort.start`, of the five operations ADR 0128/0130
declared. `RegistrarTransicaoDeContainerUseCase` gains its first caller
outside tests too. It still holds that NOTHING fires on its own — it's always a
`proposed_action`, decided by a human or by explicit policy.

**Dev agents do NOT start working inside the container that comes up here.** That
stage is a later PR, declared open in CLAUDE.md — the sentence the
approval screen shows (`apps/web/src/lib/aprovacoes.ts`) stops on purpose
before promising that.

- **Where:** `apps/api/src/application/use-cases/actions/execute-container-start.use-case.ts`,
  `apps/api/src/domain/actions/decide.ts` (`ACTION_TYPES`,
  `MIN_ROLE_FOR_ACTION_TYPE`), `apps/api/src/domain/containers/container-start-execution-result.ts`,
  `apps/api/src/application/use-cases/actions/approve-action.use-case.ts`,
  `apps/api/src/application/use-cases/actions/propose-action.use-case.ts`,
  `apps/api/src/application/use-cases/execution/get-infra-context.use-case.ts`
  (`moduleRouting`, the first HTTP consumer of `GetModuleRoutingUseCase`),
  `apps/web/src/lib/aprovacoes.ts`,
  `apps/engine/lib/engine/infra/tools/propose_container_start.ex`,
  `apps/engine/lib/engine/infra/infra_lead_server.ex`
- **Test:**
  `apps/api/test/application/use-cases/actions/execute-container-start.use-case.spec.ts`
  (happy path electing a candidate; an image outside the candidates refuses without
  calling `DecidirImagemDoProjetoUseCase` nor the broker; `BrokerRecusouError`/
  `BrokerIndisponivelError` become `failed`, never propagate; `stopped` jumps
  straight to `running`),
  `apps/api/test/domain/actions/decide.spec.ts` (`container_start` requires
  `maintainer`; it CAN reach `auto_approve` when configured — unlike
  `parallelize`/protected merge/`instruction_patch`),
  `apps/api/test/application/use-cases/execution/get-infra-context.use-case.spec.ts`
  (`moduleRouting` present and absent),
  `apps/web/src/lib/aprovacoes.test.ts` (the sentence doesn't promise a dev agent inside
  the container),
  `apps/engine/test/engine/infra/infra_lead_server_test.exs`
- **ADR:** [0130](../adr/0130-broker-de-container.md), [0133](../adr/0133-infra-elege-imagem-do-roteamento.md)
- **Origin:** the product owner's plan, Part 1 / PR 1.5

### RN-499 — The Infra's handoff has its OWN actionable card, outside the thread — without widening `AGENTES_DE_CHAT` {#rn-499}

`OfferInfraHandoffUseCase` offers the handoff to the Infra Lead
(`offer-infra-handoff.use-case.ts:43`), and until now **no screen could
accept it**. `offeredHandoff` (`SessionPage.tsx`) restricts the thread's card to
`AGENTES_DE_CHAT` ([RN-136](#rn-136)), which doesn't include `infra`, and
`acceptHandoff` (`api-client.ts`) had **a single consumer** — that card,
behind that filter. The code's own comment recorded the consequence
as accepted: *"since Infra is never accepted HERE … in practice, never"*.

The effect wasn't cosmetic: the handoff stayed `offered` forever, the Infra
Lead was never activated, `propose_container_start` was never called
([RN-491](#rn-491)) and **no project of any mode ever got to have a container
up**. The chain "Infra accepts → proposes `container_start` → approved →
`running`" was unreachable through any screen path.

**The filter was NOT widened, and that's the rule.** `AGENTES_DE_CHAT` is right
to exclude `infra`: the engine's `agent_command_controller.ex` has no
`message` clause for the Infra Lead, and the last clause (unguarded) would treat
`"infra"` as if it were the Criativo — putting `infra` on the list would make the screen
offer a conversation thread that doesn't exist and the composer send a message to the
wrong agent. (Since [RN-584](engine.md#rn-584) the engine refuses by name instead of
delivering to the Criativo; the filter remains right for the same reason.) Accepting the Infra is a **propositional** action, not a conversational one.

The actionable card lives, then, **outside the thread**: in the fixed strip between the
scrolling area and the composer, the same one that hosts the manual handoff
([RN-440](api.md#rn-440)) and already declares itself the place of handoff actions that "aren't
conversation, they're redirection". Three consequences the choice buys:
the Infra's `handoff.offered` **stays narrated** in the thread as a silent divider
(nothing changes in the timeline); no conversational handoff changes shape; and the
button doesn't disappear when the offer leaves the 200-event window in a long session
— the thread's card would depend on the event being visible, this one doesn't.

The card **states the click's consequence**, because it isn't obvious: accepting activates
the Infra Lead, which takes over provisioning and will **propose** bringing up the
container; the proposal still goes through the usual approval pipeline
(`container_start`, `maintainer`, never auto-approvable by seed —
[RN-491](#rn-491)). Accepting brings up no container at all.

Closing: the same `activeFor(h.toAgent)` as the thread's card — a handoff already accepted,
or Infra already active in this session by any other path, doesn't reopen the invite.
And the click calls the **same** `handleAcceptHandoff`, with no second accept
path.

- **Where:** `apps/web/src/routes/SessionPage.tsx`
  (`handoffDaInfraOferecido`, and the `styles.infraHandoffRow` block above the
  `manualHandoffRow`)
- **Test:** `apps/web/src/routes/SessionPage.handoff-da-infra.test.tsx` —
  the card appears and accepts with the right ids; disappears with Infra already active; disappears in a
  non-active session; the thread's silent divider stays there with no thread button; and the
  **non-regression** of [RN-136](#rn-136): Infra (older) + Dev Lead (newer)
  pending show BOTH cards, each accepting its own handoff
- **Origin:** exploration of the plan "Name and location on the same screen, and container
  before the dev agents" (D0) — the blocker that made the requirement "dev agent
  only after the container is up" equivalent to "dev agent never starts"

## The folder browser served by the api (RN-504)

### RN-504 — The folder browser is scoped to the projects base and NEVER leaves it {#rn-504}

`GET /workspaces/:workspaceId/project-folders` lists the **subfolders** of a
path, and exists because the project creation wizard loses, at once,
BOTH "browse folder" mechanisms it had: `FolderBrowserModal` navigated
through the **runner's websocket** (`fs_list_dir`/`fs_home_dir`) and
`RunnerOnboardingPanel` used `showDirectoryPicker`, which returns a browser
handle and never an absolute path. Without a runner, the browser has no way to
list any filesystem — and it's an absolute path that `projects.workspace_path`
keeps.

**The containment is ONE, and it's hard.** `path` is optional and omitted means the base
(`baseDeProjetos()`); every provided `path` has to satisfy
`dentroDaBaseDeProjetos` (RN-500), which reuses `dentroDoEscopo` — the same function
as ADR 0055's terminal scope — and that's why it catches the prefix trap:
`/home/voce/brabo2` is **not** inside `/home/voce/brabo`, although the string
starts the same. `..` and `.` are **refused** instead of resolved, for the same
reason as `caminhoDeWorkspaceLocalValido`: resolving would accept that the path read
isn't the path requested.

**Leaving the base is 400, and not 403.** 403 would say "you don't have permission to see
this" and would suggest another role would see it — that's not the case. There's no role
that navigates outside the base, because outside the base isn't a more privileged area,
it's an area this route simply doesn't address. The request is MALFORMED.

**The ceilings are a contract, not an implementation detail:** only directories in
`entries`; at most **500**, sorted **before** the cut (otherwise "the first 500"
would be the order the filesystem returned, which changes between machines);
no recursion; entries starting with `.` left out; and symlinks **reported, never
descended** — `readdirSync(withFileTypes)` has `lstat` semantics, so a
link pointing outside the base isn't an exit door. **What's left out is
COUNTED** (`arquivos`, `simbolicos`, `truncado`): without that a folder full of
code would come back as an empty list and the screen would say "empty folder", asserting about
what it didn't read (RN-180).

**There's no POST.** Creating a folder belongs to the mounted workspace's materialization, at the
moment the container comes up — never to the picker.

**The minimum is `maintainer`**, the same as `POST .../projects` and
`.../projects-base`, and by the same reasoning one step further: `projects-base`
reveals ONE path of the operator's machine, this route reveals the TOPOLOGY below
it. Inheriting the `viewer` of the neighboring routes because they're neighbors is the defect
RN-102 names — the minimum is the ENDPOINT's, never the section's. `workspaceId`
doesn't enter the calculation: the base belongs to the INSTALLATION, and it's in the route because it's what gives
scope to `RolesGuard`.

**On the client**, the transport becomes one of the TWO implementations of the
`FsBrowser` interface (`apps/web/src/lib/fs-browser.ts`): `criarFsBrowserViaApi` (new) and
`connectFsBrowserChannel` (the runner's channel, retyped). `FolderBrowserModal`
chooses by `origem: { tipo: 'api'; workspaceId } | { tipo: 'runner'; projectId }`
— a discriminated union, and not two optional props, because "neither of the two" and
"both" would be representable states the component would have to handle at
runtime. The transport via runner is left **with no caller in the web** from here on, and
stays in the repository by the product owner's declared decision (the runner leaves
the interface, the binary keeps being refined); the protocol in
`apps/runner/src/channel.ts` isn't touched in any way.

- **Where:** `apps/api/src/infrastructure/filesystem/project-folders-browser.ts`
  (`listarPastasDeProjeto`, `TETO_DE_ENTRADAS`, `PastaForaDaBaseError`,
  `PastaNaoLegivelError`);
  `apps/api/src/interfaces/http/iam/workspaces.controller.ts`
  (`listProjectFolders`); `apps/web/src/lib/fs-browser.ts`;
  `apps/web/src/components/FolderBrowserModal.tsx`
- **Test:**
  `apps/api/test/infrastructure/filesystem/project-folders-browser.spec.ts`,
  `apps/api/test/interfaces/http/iam/workspaces-project-folders.controller.spec.ts`,
  `apps/web/src/lib/fs-browser.test.ts`,
  `apps/web/src/components/FolderBrowserModal.test.tsx`
- **ADR:** [0141](../adr/0141-base-unica-dos-projetos-montados.md) (the base
  this route scopes)
- **Origin:** the product owner's plan, PR 4

## The base decides what project creation offers (RN-513)

### RN-513 — With a consented base, `mounted` is preselected with `<base>/<slug>` suggested; without a base, or without knowing, it isn't offered {#rn-513}

> **Revised by [RN-573](api.md#rn-573) (ADR 0161):** the preselection of `mounted`
> now ALSO requires the container broker confirmed. With a base and no
> broker (the installation from a Release), `runner` is preselected and
> `container`/`mounted` stay inert with the reason in text; with the broker
> unknown, `container` stays selected. The rest of this rule holds as
> is.

Two halves of this rule **were already rules** and had never reached the client.
"Don't offer the mode without a base" is [RN-500](api.md#rn-500); "suggest `<base>/<slug>`"
is [RN-501](api.md#rn-501), and ADR 0142 postponed disk validation precisely so
that the wizard could propose a folder that **doesn't exist yet**. Until now,
`GET /workspaces/:workspaceId/projects-base` had **no caller at all** in the
web, and the "Mounted folder" card was offered unconditionally — in an
installation without `BRABO_PROJECTS_BASE`, choosing the mode ended in a 400
refusal from the api after the person had chosen, typed the path, and reached the
end of the wizard.

What's **new** is the **preselection**: with a configured base, `mounted` is born
selected. It revises the default of ADR 0072 (where `container` is "the normal one" and
the local mode is an escape hatch) and revises it **only for the local installation**, where the
base was consented by a human on the host ([RN-511](infra.md#rn-511)). The
`project_execution_mode` enum doesn't change, no new mode is born, and mode
conversion (ADR 0111) isn't touched.

**The query is born with the wizard, not with the step.** The "Where the code
will live" step is the fifth; a `useQuery` mounted only there would make the card appear
flickering after the person was already looking at the screen.

**Unknown doesn't become an offer.** While the answer hasn't arrived, and also
when the query **fails** (403, network, api down), the card doesn't appear and
`container` stays selected. A failure isn't permission to offer a mode
whose precondition couldn't be confirmed: it's the same ruler as
[RN-088](#rn-088)/[RN-468](#rn-468) — the product doesn't collapse "don't know" with "doesn't
have" — and that of ADRs 0041/0042, where a capability is only declared when
**proven**.

**The preselection never overrides a human choice.** The base arrives over the network,
always AFTER the first render. The screen keeps the user's choice separate
from the current mode (`modoDeWorkspaceEscolhido` × `modoDeWorkspace`), and the
preselection only holds while nobody has touched the cards — swapping the mode under
the hand of whoever already clicked is a defect, not a convenience.

**The suggestion never clobbers what was typed.** `<base>/<slug>` comes in in two
cases and only in them: an empty field with nothing suggested yet, or a field containing
exactly this screen's previous suggestion (the name changed in the details step, and
the suggestion follows). Anything else — including the empty field **after**
the user deleted the suggestion — stays as it is. An empty slug (adoption, where
the name comes from the provider) doesn't become an invented segment: the field stays empty, and
`canAdvanceFromWorkspace` holds the step. The field is **editable** the whole time; the
preselection didn't relax any advance ruler.

**And the mode's warning stopped lying.** The previous text predated ADR
0141: it said the path was free and that it would only work if the user
mounted it. Today there are **two states, and they're the two the backend has** — under the
base, a neutral note (creation passes, and the folder doesn't even need to exist: the Infra
creates it when bringing up the container, [RN-501](api.md#rn-501)); outside the base, a warning saying that
the api **refuses creation** (400, in `resolverWorkspacePath`) and **naming** the
base, instead of telling you to go look for the variable. An empty field isn't "outside the base":
there's no path for the api to refuse yet, and alarming before the person types
would be the screen asserting about what it doesn't have. The comparison is by **segment**,
never a raw `startsWith` — `/base-outra` isn't inside `/base` —, mirroring
the api's `dentroDoEscopo`.

- **Where:** `apps/web/src/routes/NewProjectWizard.tsx:220` (the query),
  `:238` (`podeOferecerMounted`/`baseDeProjetos`), `:283` (the current mode),
  `:333` (`caminhoForaDaBase`), `:360` (the suggestion);
  `apps/web/src/lib/wizard.ts:143` (`caminhoSugeridoNaBase`) and `:171`
  (`caminhoDentroDaBase`) — the pure functions;
  `apps/web/src/lib/api-client.ts:296` (`getProjectsBase`)
- **Test:** `apps/web/src/routes/NewProjectWizard.test.tsx`
  (`describe('NewProjectWizard — a base de projetos decide o que é
  oferecido')` — base present, `null` base, query refused with 403, the
  human choice before the base arrives, and the two states of the warning);
  `apps/web/src/lib/wizard.test.ts` (`describe('caminhoSugeridoNaBase')` and
  `describe('caminhoDentroDaBase')`)
- **ADR:** [0146](../adr/0146-base-consentida-no-bootstrap.md), point 4
- **Origin:** PHASE 28, session 3

---

## The Runner mode picker reads the disk of WHOEVER CHOOSES again (RN-533)

### RN-533 — In `runner` mode the folder browser asks the local agent, and the screen says whose disk it is {#rn-533}

The creation wizard had **one** folder browser for **two** modes that
read **different** disks. [RN-504](#rn-504) pointed both to the api —
right for `mounted`, whose folder lives under `BRABO_PROJECTS_BASE`, on the SERVER — and
declared the price in writing: *"for `runner` the list stops being the disk of the
user's machine and becomes the base"*. That was accepted because *"the `runner`
mode leaves project creation in the next PR"*, which **did not happen**: the
mode is still offered, and the direction of
[ADR 0151](../adr/0151-base-consentida-no-runner.md) (point 7) is the opposite. While it
lasted, choosing `runner` and clicking "Browse folder…" browsed a disk that is not
that project's — and **nothing on the screen said so**, so the error would only show up
through the list's CONTENT.

**The MODE decides the transport, and they are two different questions.** `mounted`
stays byte for byte through the api (`GET workspaces/:workspaceId/project-folders`,
hard-scoped to the base — RN-504 intact); `runner` goes back to `fs_list_dir`, which
always existed on both sides and whose transport in the web never left the
repository. It is not a leftover transport that gained a use: it is the question "what is
on YOUR machine?", which the api has no way to answer, being asked again of whoever
has a way.

**The anchor of the `runner` mode is the EARLY creation of [RN-437](#rn-437).** The
channel ticket is scoped to a real `projectId`, so the click creates the project
before opening the modal — the original purpose of that rule, which RN-504 had
left without a consumer. And failing that creation **does not open the modal in any
transport**: falling back to the api would show the SERVER's base under the label of "your
machine", exactly the defect this rule closes.

**Without a connected local agent, the mode is still offered — and what declares it is the
PICKER, not the mode step.** [RN-513](#rn-513) hides `mounted` when the
base is unknown or absent, and it is right: there the api HAS a signal
(`GET .../projects-base`), and without a base creation ends in a 400 at the end of the
wizard, with no fix on the screen. Here neither of the two things holds. There is no
runner presence signal in the api — [RN-521](api.md#rn-521) already declares that in
writing —, so hiding the mode or graying out the button would be deciding "it doesn't have" from
"I don't know", the collapse that [RN-088](#rn-088)/[RN-468](#rn-468)
forbid; and the mode **is not broken** without a runner, because the path is
confirmed later, by the CLI ([RN-423](runner.md#rn-423)) — what is missing is only the
NAVIGATION. So the declaration goes to the only place that actually asks: the
picker, at the moment it asks.

**The reason is DISCRIMINATED, and the two outcomes do not collapse.**
`MotivoDeFalhaDoAgente` is `sem-agente` (the engine ASSERTS there is no runner
connected — a server fact) or `sem-resposta` (request ceiling, dropped socket,
refused ticket — ignorance, and stated as ignorance on the screen). Before
this rule what decided was `erro?.includes('Nenhum runner conectado')` in the
COMPONENT — a screen matching a substring of a pt-BR sentence that lives in an
`.ex` of the engine, exactly what [RN-532](runner.md#rn-532) refuses in writing on the
other side (*"the text is for a human to read, the reason is for the other side to
DECIDE"*). The matching remained in **one** place, the module that owns the
channel protocol, and the degradation is named: a sentence rewritten in the engine falls into
`sem-resposta` — the "I don't know" state —, never into "there is an agent". The api
transport **never** fills in `motivo`, and that is a decision: an api refusal is an api
refusal, it has its own message that TEACHES and there is no local agent to install to
fix it.

**The wait is that of [RN-474](#rn-474), REUSED and not rewritten.** Both reasons
lead to `EsperaDoRunner` — same three states (`esperando`/`confirmado`/
`semResposta`, which never collapse), same 3-minute CEILING, same wording,
same signal (`workspaceVerifiedAt` CHANGING, never "existing"). It gained an
optional callback because here the confirmation has a CONSEQUENCE: the listing that
failed is redone on its own, instead of the person having to discover they need to
click something. The callback fires ONCE per instance — without the `ref`, each
round of the probe would re-fire it and the caller would enter a loop — and it **does not
assert "it is up now"** (`workspaceVerifiedAt` never said that, RN-468):
that is why whoever receives it REPEATS the request, and if the agent has already dropped again the screen
goes back to the same state, honest both times. The wait is ONE per screen:
`RunnerOnboardingPanel` gained `mostrarEspera`, `false` only where whoever mounts it already
shows its own — two would be two probes, two ceilings and, in the worst case, two sentences
disagreeing about the same stamp.

**And the picker says WHOSE disk it is, in BOTH origins.** The only signal before
that was the label of a shortcut ("Projects base" × "Personal folder"), which
names a place and not a machine. The api's sentence is not symmetry decoration:
without it the runner's would read as an exceptional warning, when it is information both
owe.

- **Where:** `apps/web/src/lib/fs-browser.ts:60`
  (`MotivoDeFalhaDoAgente`, and why only the runner transport fills it in);
  `apps/web/src/lib/fs-browser-channel.ts:66`
  (`FRASE_DO_ENGINE_SEM_RUNNER`, the only substring match that remained) and
  `:68` (`motivoDaMensagem`); `apps/web/src/components/FolderBrowserModal.tsx:227`
  (`agenteNaoRespondeu`, the decision by reason) and the origin line in both
  origins; `apps/web/src/components/EsperaDoRunner.tsx:91` (`onConfirmado`) and
  `:136` (the `ref` that fires it once);
  `apps/web/src/components/RunnerOnboardingPanel.tsx:131` (`mostrarEspera`);
  `apps/web/src/routes/NewProjectWizard.tsx:304` (`origemDoNavegador`, the
  transport chosen by mode, `undefined` when there is no project to anchor)
- **Test:** `apps/web/src/components/FolderBrowserModal.test.tsx` (the list
  declaring the disk of the user's machine; `sem-agente` falling into the
  onboarding panel; the decision by REASON and not by text, with a wording that
  nobody promised to keep; `sem-resposta` with the caveat that this does not prove
  absence, ONLY ONE wait and the ceiling announced; the listing redone on its own when
  the stamp changes); `apps/web/src/routes/NewProjectWizard.test.tsx` (the mode
  deciding the transport in both directions; the early creation anchoring the
  channel; the creation that FAILS opening no browser at all)
- **ADR:** [0151](../adr/0151-base-consentida-no-runner.md) point 7
- **Origin:** PHASE 29, session 9. Declared and NOT done: the picker does **not**
  trigger `workspace_create` — choosing a folder is choosing, and creating is something
  else. `Engine.Runners.PastaDoProjeto.criar/3` (RN-532) still has no caller, and
  wiring it would require a new HTTP route in the api, outside the scope of this session. The
  definitive fix of the substring match — the engine sending a code
  alongside the text, as the runner already does with the five `motivo` of RN-532 — also
  belongs to the engine side, and is declared in the code

---

## Creating a project does not provision a repository (RN-541)

### RN-541 — Creating a project does NOT create a git repository; the bootstrap is postponed until the Arquiteto's handoff {#rn-541}

Creating a project and provisioning git were, in practice, the same gesture — and what
joined them was a SCREEN. `ProvisioningPage` fires `provisionRepository` in the
mount effect and is its **only** caller in the web; the wizard navigated there
on confirm, so every project was born with a full repository and Gitflow, without
anyone having asked.

The product owner wants the opposite: what is generated for now goes **without git**, and the
repository is only born when development really starts — the moment
when the **Arquiteto passes the handoff to the Dev Lead**.

**The postponement mechanism is not navigating to that screen.** On create, the
wizard goes straight to the PROJECT page. Nothing else needed to be turned off:
since the trigger lives in the `useEffect` of a route that is no longer visited, ceasing
to visit it IS the postponement. The route still exists and is still reachable — the
Dashboard leads to it when provisioning **failed** and needs to be resumed.

**Provider and credential leave creation, and stay in adoption.** With no repository
to create now, asking "where to host" would be collecting a decision the screen
does not use, and the credential step would demand a PAT for a repository nobody
will create. Adopting is the opposite by construction — it points to a repository that already
exists, and without a provider there is nothing to point to. The wizard now has **three**
steps when creating and four or five when adopting.

**The Confirm screen stops promising Gitflow.** It announced "N Gitflow
steps" when creating, counting `BOOTSTRAP_STEPS`; that would become a lie the
moment the bootstrap stopped running there. It now says WHEN the
repository is born, instead of asserting it is already being born.

**Declared consequence:** between creation and the handoff, the project exists without a
repository. Nothing breaks — `GET .../repository` answers `null` and not 404, the
project page already has the "repository not provisioned" state and the
Repository section in Settings simply does not appear —, but every path that
needs a working tree fails NAMED until then (`remoto_de_trabalho` returns
`:not_found`, and `open_adr_pr` refuses with "Projeto sem repositório provisionado").
That stops being an edge and becomes the normal state of the beginning of a project.

**The trigger is the next delivery**, and without it a project created today would stay without a
repository forever: accepting the Arquiteto → Dev Lead handoff now
provisions `local`, the only provider that does not ask for a credential.
Since [RN-582](api.md#rn-582), that trigger is accepting the handoff **to the Arquiteto**
(the Dev Lead one stayed as a second door), and activating execution without a repository is
refused.

The warning "on GitHub's free plan, a private repository does not accept branch
protection" left the screen along with it — not because it stopped being true, but because it
became **unreachable**: the condition was `provider === 'github'`, and when creating there
is no longer a chosen provider.

- **Where:** `apps/web/src/routes/NewProjectWizard.tsx:379` (`stepKeys`, now
  dependent on `adotando`), `:540` (the `provider` guard restricted to adoption) and
  `:590` (the navigation to `/projects/$projectId`)
- **Test:** `apps/web/src/routes/NewProjectWizard.test.tsx`, `describe('NewProjectWizard — o git é adiado')`
  — "criar não passa mais pela página de provisionamento — vai direto ao
  projeto", "criar tem TRÊS passos: provider e credencial saíram", "adotar
  mantém provider e credencial" e "a tela de Confirmar não promete mais o
  Gitflow agora"
- **Origin:** request of the product owner — *"o que for gerado por hora segue sem
  git; git mesmo só será iniciado após iniciar desenvolvimento em projetos
  novos, neste momento que deve rodar o bootstrap"*

---

## The screen recognizes an already paired MACHINE local agent (RN-548, PHASE 30)

### RN-548 — With an active MACHINE key, the runner panel stops telling to pair and starts saying what is missing — without ever asserting that the agent is up {#rn-548}

Session 7 of [PHASE 30](../explanation/fase-30-runner-por-maquina.md), decided by
[ADR 0154](../adr/0154-chave-de-dispositivo-de-maquina.md). It is the WEB half of the
machine identity: [RN-543](produto.md#rn-543) made the key listing mark the
KIND (`projeto` | `maquina`) *"so that a machine key would not stay
invisible on every screen"*, and it was left without a consumer. This RN is the consumer.

**The defect, measured.** `RunnerOnboardingPanel` is the panel the THREE
onboarding points mount (`TerminalPanel`, `FolderBrowserModal` and the `workspace` step
of `NewProjectWizard`), and it had a single question: *"configure the folder"*.
With ADR 0154's machine key, that question becomes wrong in the
most common case — the machine has already been paired, what is missing is the agent running.
Telling the person to repeat the pairing the machine already has is the panel
answering the wrong question, with a flow that ends in their terminal.

**Seven states, and none becomes the other
([RN-088](#rn-088)/[RN-470](#rn-470)).** `semPapel`
(we did not ask),
`verificando` (we asked and it did not come back), `naoSei` (the question failed),
`semChaveDeMaquina` (it came back and there is none), `revogada` (there was and it was revoked),
`pareadaNuncaUsada` (there is an active key that no agent used — the ORPHAN of
[RN-519](api.md#rn-519) reborn in the new kind) and `pareada`. **"I don't know" never
becomes "it doesn't have"**, and the two empties have different texts because the gesture is
different: one asks to pair, the other explains why the agent stopped connecting.
The failure is derived from `isError` and not from there being a `status` — a network error has no
status, and deriving it from the status would leave a refused `fetch` spinning in
"verifying…" forever, which is a lie by omission after ten seconds.
`semChaveDeMaquina` is the only one that renders NOTHING, and on purpose: the whole panel
already IS the answer to "no machine paired".

**Recognizing is NOT saying the agent is up, and the rule is the usual one.**
`workspaceVerifiedAt` is the record of a confirmation and not a heartbeat
([RN-468](#rn-468)); a registered key is the same thing one step earlier — it
proves the machine was paired one day, never that there is a live process now. A
screen that confused the two would be WORSE than today's, because today's at
least does not lie. That is why the alert's tone is `accent` and never `success` (green
would read as "it's up" — the same arithmetic `AmbienteDoProjeto` does on the
runner row), the caveat is stated in text alongside, and what answers for the
NOW remains `EsperaDoRunner` ([RN-474](#rn-474)), REUSED and not
rewritten: once the machine is recognized, what is missing is the agent CONNECTING, which is
exactly its question.

**And there is a second limit, which the data imposes and no wording erases: the list belongs to
the ACCOUNT, not to this browser.** `runner_device_keys` does not know which machine the
browser is talking about, so the strongest the screen can assert is *"your
account has a paired machine"* — never *"this machine is paired"*. That is
why the browser flow
([ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)) **is not
removed**: it changes PLACE, into a `<details>` whose label names the only
case in which it is still the answer ("I am on another machine"). Retiring it is
`BRB-031`, the maintainer's decision, and not a consequence of this delivery.

**The KIND shows up, and what shows up is its COST.** The panel does not list
keys nor offer revocation — that is the screen the web never got, the
open half of RN-519, and it is its own front. What
it says is what the kind means to whoever reads: a machine key serves
ALL the owner's projects in `runner` mode, and revoking it takes down the local agent
in all of them ([RN-520](api.md#rn-520), whose `{projeto, usuário}` reach does not change
here). Without that sentence, RN-543's mark would be decoration.

**The role is the ENDPOINT's, and the api is the authority.** The minimum comes from
`roleAtLeast` ([RN-102](api.md#rn-102)) against `developer`, which
`RunnerDeviceKeysController` requires on the three routes — the screen stops
asking what the api would deny, and says why ONCE in TEXT (`title` on a
`disabled` element does not open in Chromium). This **is not a security
boundary**: what refuses is the `RolesGuard`. The real 403 falls into the SAME
state, and it is not redundancy — the role read is the WORKSPACE one and what authorizes is
the project's EFFECTIVE one ([RN-471](#rn-471)), an OVERLAY in both directions:
the proxy avoids the obviously lost question, the api corrects the proxy.

**Where it shows up, and why it is not the same in the three mounters.** Recognition is
per PROJECT, because the route is `GET /projects/:projectId/runner-device-keys` —
it exists in `TerminalPanel` and `FolderBrowserModal`, which always have a project, and in
`NewProjectWizard` only AFTER the early creation ([RN-437](#rn-437)). Without
a `projectId` there is no one to ask and the panel stays byte for byte as it was. The
difference is not a design choice: it is the shape of the endpoint.

- **Code:** `apps/web/src/lib/agente-de-maquina.ts` (the whole derivation —
  `reconhecerAgenteDeMaquina`, `podeLerChavesDeDispositivo`,
  `maquinaJaPareada`), `apps/web/src/components/RunnerOnboardingPanel.tsx:173`
  (the two queries and `ReconhecimentoDeMaquina`),
  `apps/web/src/components/RunnerOnboardingPanel.module.css`
  (`.reconhecimento`, `.gesto`), `apps/web/src/lib/api-client.ts:434`
  (`listRunnerDeviceKeys`), `apps/web/src/lib/api-types.ts:773`
  (`RunnerDeviceKeyListItem`, `RunnerDeviceKeyEspecie`),
  `apps/web/src/locales/{en,pt-BR}/terminal.json` (`agenteDeMaquina.*`)
- **Test:** `apps/web/src/lib/agente-de-maquina.test.ts` — the happy path
  (active and used, with the MOST RECENT use among N) and the seven states without
  collapse, including the failure WITHOUT a status and the PROJECT key that does NOT count;
  `apps/web/src/components/RunnerOnboardingPanel.test.tsx` — the panel
  announcing the pairing with the service gesture and the ADR 0118 flow
  collapsed and still reachable, the two caveats ("it is not a running agent",
  "it belongs to your ACCOUNT") plus the reach one, the REVOKED key going back to telling to
  pair, the failed query saying it does not know, the role below
  `developer` without calling the route, and the wizard without a `projectId` with no one to
  ask
- **Gap DECLARED, CLOSED later by [RN-552](api.md#rn-552):** when this RN
  closed, nobody CREATED a machine key (it was `install.sh`, ADR 0155 point
  4, session 6), so this screen was only exercisable with a key registered by
  hand — the same half RN-543 and RN-544 already declared. The command the panel offers is
  `brabo-runner service status --project <id>`, the form that exists TODAY; the
  per-machine form arrives with session 4's unit — **CLOSED later
  (AT-106)**: once the MACHINE key is recognized, the panel offers
  `brabo-runner service status --machine` (the machine unit of
  [RN-545](runner.md#rn-545)), and the PROJECT key block keeps offering
  `--project <id>`; both active kinds each show their own. The command
  is still for the person to ASK — the screen does not assert the answer
  (keys `agenteDeMaquina.comandoDeServico` and
  `chaveDeProjeto.comandoDeServico`, tests in `RunnerOnboardingPanel.test.tsx`
  in both branches and in the pair). An active PROJECT key
  does NOT change the panel: it is the sibling defect, one scope below, and closing it is a separate
  decision — **CLOSED later (AT-107)**: the panel recognizes an active PROJECT key
  of THIS project (`reconhecerChaveDeProjeto`, `lib/agente-de-maquina.ts`,
  same listing and same `queryKey`, no new route), with the same
  vocabulary — `accent` tone, a registered key is not an agent up, the trigger is
  checking the service — and the cost of the KIND stated: revoking takes down the agent
  IN THIS project, not in all of them. Another project's key and a revoked one do not count, and
  the ADR 0118 `<details>` stays reachable. And the web still has no SCREEN on which to list or revoke a
  device key (the open half of [RN-519](api.md#rn-519)) — this delivery consumes the
  listing and does not build it. **CLOSED later by [RN-561](#rn-561)**, which
  builds it: the Settings section reuses `podeLerChavesDeDispositivo` from here
  and the SAME `queryKey`, and that is why revoking from there invalidates the recognition of
  this panel
- **ADR:** [0154](../adr/0154-chave-de-dispositivo-de-maquina.md)
- **Origin:** PHASE 30, session 7 —
  [the phase's scope](../explanation/fase-30-runner-por-maquina.md)

---

## Mode conversion stops being a leap in the dark (RN-559, RN-560)

### RN-559 — Converting to `mounted` opens the SAME folder browser as the wizard; the `runner` branch stays typed, and the screen says why {#rn-559}

`ExecutionModeSection` was the **only one of the five places** in the product where one
chooses a folder and the path was typed **in the dark** — the other four already
opened `FolderBrowserModal` since [RN-473](#rn-473)/[RN-504](#rn-504). The
gap was declared in `CLAUDE.md` and the declared reason belonged to the **other
branch**: onboarding a runner BEFORE the conversion saves registers a key in a
project that is not yet `runner`, and `ConfirmProjectWorkspaceUseCase` refuses with
400. None of that holds for `mounted`, and that is what this rule closes.

**Same component, same transport, no new rule.** The `mounted` branch
mounts `FolderBrowserModal` with `origem: { tipo: 'api', workspaceId }` — the
same discriminated union `NewProjectWizard` uses for that mode
([RN-533](#rn-533)), because the folder lives inside the SERVER's base
([ADR 0141](../adr/0141-base-unica-dos-projetos-montados.md)) and it is the server that
sees it. No new browser nor new endpoint is born, and the browser **does not
guarantee** a valid path: what validates is still
`validarExecutionModeEWorkspacePath` and the database CHECK.

**The `runner` branch does NOT get a browser, and that is a decision, not forgetfulness.** Its
transport (`{ tipo: 'runner', projectId }`) requires a runner connected to
THIS project, and a project that is not yet `runner` has none — the wait
would end in an error that looks like a bug. The order *"convert, then onboard"* remains
a separate product decision. What changes is the screen now **saying** so in
text instead of only not offering any button, which is the rule of
[ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md): the
control is removed, never the information.

**The base is a FOUR-valued state, and they do not collapse.** The route
`GET workspaces/:workspaceId/projects-base` ([RN-500](api.md#rn-500)) may be in
flight, have failed, have answered `null` or have answered a path — and each
of those has its OWN text, by the rule of [RN-088](#rn-088)/[RN-468](#rn-468):
*"I don't know"* never becomes *"it doesn't have"*. The button stays on the screen grayed out in the
first three, with the reason stated in TEXT right below, and not by `title` (which on a
`disabled` element does not open in Chromium).

| base state | the button | what the screen says |
|---|---|---|
| in flight | grayed out | "querying this installation's projects base" |
| the query failed | grayed out | it was not possible to KNOW whether it exists; reload |
| answered `null` | grayed out | this installation did not declare a base |
| answered a path | live | the base, NAMED, and that it is in it that the browser opens |

The `mounted` mode **does not leave the selector** when the base is missing, and that is the
deliberate difference from the wizard ([RN-513](#rn-513)): a project that
IS ALREADY `mounted` cannot see its own mode disappear from the control because of a
query in flight. What disappears is the BROWSER, not the conversion.

**The minimum is the ENDPOINT's.** `PUT projects/:projectId/execution-mode` and
`GET workspaces/:workspaceId/projects-base` both require `maintainer`, read via
`roleAtLeast` over `ROLE_ORDER` and never via a hand-written list of roles
([RN-102](api.md#rn-102)) — the section did
`role === 'owner' || role === 'maintainer'`, which is right by accident while the
minimum is high. Whoever does not reach the minimum does not fire the base query: it
would end in a certain 403, and the *"I don't know"* it would produce would be about
authorization, not about the base.

The value chosen in the browser is treated as a TYPED value: it fills in the
field and only goes to the api when someone confirms with the section's button. This section **does not
become autosave** ([RN-469](#rn-469)).

- **Code:** `apps/web/src/routes/settings/ExecutionModeSection.tsx:68` (the
  four states of the base, as a union), `:211` (the minimum via `roleAtLeast`),
  `:220` (the query that does not go out for whoever does not reach `maintainer`), `:260` (the
  derivation of the four), `:280` (what the browser requires to exist), `:414`
  (the button, grayed out and not hidden), `:423` (the text of the `runner` branch), `:475`
  (the `FolderBrowserModal` with `origem: { tipo: 'api', workspaceId }`);
  `apps/web/src/locales/pt-BR/settings.json:231` and
  `apps/web/src/locales/en/settings.json:231` (`executionMode.path.*`, the five
  texts in both languages)
- **Test:** `apps/web/src/routes/settings/conversao-de-modo.test.tsx` — the
  happy path (open the browser, choose `loja`, the field fills in and the
  conversion sends what was CHOSEN, only after the button), the base query
  FAILING (inert button, own text, the modal not mounting even by force, and the
  field remaining editable), the ABSENT base with text DIFFERENT from the failure one
  and the loading one, the `runner` branch without a button and with the reason in text, and the
  role below `maintainer` (controls grayed out, current value still
  visible, base query not fired)
- **Gap DECLARED:** the `runner` branch of this section **remains typed in the
  dark** — the `CLAUDE.md` gap shrank to it and did not close. Closing it
  requires deciding the order "convert, then onboard", which is a separate product
  decision and remains without an owner. *Update:* the order was decided and measured in
  [RN-612](#rn-612) — the `runner` branch gets onboarding AFTER saving, and the
  browser stays out for another reason, stated there
- **ADR:** [0111](../adr/0111-conversao-de-execution-mode-de-projeto-existente.md),
  [0141](../adr/0141-base-unica-dos-projetos-montados.md)
- **Origin:** AT-049 (EP-021/HS-033)

### RN-560 — The conversion warning says what it refuses, what it carries and what it does NOT carry — naming the old path {#rn-560}

The section's fixed warning asserted *"this migrates the agent's working folder"*, in
both languages. `ConvertProjectExecutionModeUseCase` **does not have a single line that copies
or moves folder content**: it moves `permissions.json` (the POLICY, with
allow/deny/ask intact — [RN-448](api.md#rn-448)), zeroes `workspaceVerifiedAt`
([RN-450](api.md#rn-450)) and `mirrorPath` ([RN-515](api.md#rn-515)), deprovisions the
container when LEAVING `container` ([RN-449](api.md#rn-449)) and writes the new
`workspacePath`. `materializarWorkspaceMontado` only CREATES the new folder
([RN-501](api.md#rn-501)). Whatever is in the old folder — **uncommitted work
included** — stays there, orphaned.

The orphan was already a declared gap in `CLAUDE.md` since
[RN-447](api.md#rn-447)..[450](api.md#rn-450). What this rule closes is not the orphan: it is the
screen asserting the OPPOSITE of what the server does. This is an assertion fix,
not a feature — migrating content between modes stays out, without an owner.

**Three facts, and not a paragraph**, because they answer different questions:

1. **what the conversion REFUSES** — a dev agent working or stuck right now becomes a
   409, and the api's sentence is the one that shows up in the toast (the text that already existed and
   still holds);
2. **what it CARRIES** — the project's policy changes scope with its content
   intact;
3. **what it does NOT carry** — the folder's content, uncommitted work
   included, **naming the old path**.

**The warning NAMES the path** because *"stays on the old disk"* without saying WHICH
disk tells the person to go searching. The value is one line away
(`project.workspacePath`) and **disappears from the screen** the instant the conversion
saves. When there is no path to name — the project is `container`, and the old folder
is a SERVER volume — the sentence is a DIFFERENT one, pointing to the managed folder:
a variant with an empty `{{caminho}}` would say *"whatever is in "*, which is the screen
refusing to name what it knows. It is the case in which the person has the LEAST means to guess.

**It does not promise detection.** Asking the disk *"is there uncommitted work?"*
is per-mode I/O and impossible to answer for `runner` from the api side: the folder
lives on a machine the server does not see. It is not measured, it is not asserted
(ADRs [0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)/[0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)).
And it blocks nothing: the conversion remains the same call, with the
same refusals.

The `Alert`'s tone went from `accent` to `warning`, because the third fact is a
LOSS of reach and not neutral information. It stays without `role="alert"`: it is text
that was already on the screen when it opened, and an assertive live region there would become
an interruption without cause.

- **Code:** `apps/web/src/routes/settings/ExecutionModeSection.tsx:333` (the
  three facts, one per line), `:337` (the variant that names the old path × the
  managed folder one);
  `apps/web/src/locales/pt-BR/settings.json:220` and
  `apps/web/src/locales/en/settings.json:220` (`executionMode.warning.*`, the
  four texts in both languages — `en` is the app's default language
  ([RN-425](api.md#rn-425)), and an honest warning only in Portuguese is the same lie with
  an accent)
- **Test:** `apps/web/src/routes/settings/conversao-de-modo.test.tsx` — the
  happy path (the warning containing the old path AND the words "uncommitted
  work"), the variant without an old path (a `container` project pointing to the
  managed folder, and the variant with a path NOT rendered), and the negative
  proof in BOTH language bundles: the migration promise survives in
  neither, and the four keys exist in both
- **The CONDITIONAL consequences (AT-144).** The question this rule left
  open — list ALL consequences or only the one that misled — was decided
  by the maintainer: **only those that hold for THIS project**. The warning adds,
  after the three facts, one line per consequence that applies, and NONE
  for what does not apply:

  | line | when it shows up | the same condition as the use case |
  |---|---|---|
  | the mirror destination is zeroed, NAMED | `mirrorPath` filled in | every conversion zeroes it ([RN-515](api.md#rn-515)) |
  | the registered container is stopped and removed | the project is `container` TODAY and the lifecycle exists outside `removed` | `removerContainerSeExistir` only runs when LEAVING `container` ([RN-449](api.md#rn-449)) |
  | "I could not read whether there is a container" | the project is `container` and the lifecycle read FAILED | — ("I don't know" never becomes "it doesn't have", [RN-468](#rn-468)) |
  | the folder confirmed on `<data>` stops being valid | `workspaceVerifiedAt` filled in | every conversion zeroes it ([RN-450](api.md#rn-450)) |

  The container line does **not** show up in `mounted`/`runner` even with a
  registered container, because the use case does not remove it there — the warning would say the opposite
  of the server, which is the defect this rule exists to close. The data are
  those the section already has (`Project`: `mirrorPath`, `workspaceVerifiedAt`,
  `executionMode`) plus the container lifecycle, which the section did NOT load:
  it comes from the route that ALREADY exists, `GET projects/:projectId/container/lifecycle`
  (`viewer`), queried only when the project is `container` — no new
  endpoint. While the read is in flight, the line simply does not show up.
  - **Code:** `apps/web/src/routes/settings/ExecutionModeSection.tsx:102`
    (`consequenciasCondicionais`), `:118` (`containerParaOAviso`, the three
    states), `:236` (`cicloQuery`, only in `container`), `:344` (the four
    lines in the `Alert`)
  - **Test:** the `AT-144` describe in
    `apps/web/src/routes/settings/conversao-de-modo.test.tsx` — no
    condition (no extra line), registered container, a `removed` row that
    does not count, read FAILING with its own text, `mounted` with a mirror (the
    mirror line yes, the container one no, and the query does not even go out), `runner`
    with a confirmed folder (with the date), and the three conditionals in `en`
- **ADR:** [0111](../adr/0111-conversao-de-execution-mode-de-projeto-existente.md)
- **Origin:** AT-050 (EP-021/HS-034); the conditionals, AT-144 (EP-021/HS-034)

## The device key gets a screen, and the screen states the reach of revoking (RN-561)

### RN-561 — The Settings tab lists and revokes device keys, marking the KIND — because revoking the MACHINE one takes down the local agent in ALL the owner's projects {#rn-561}

The missing half of [RN-519](api.md#rn-519), declared in writing ever since in
`CLAUDE.md`: *"what remains open is only the SCREEN: `apps/web` has nowhere to list
nor revoke, so whoever wants to revoke calls the route"*. Both routes exist —
the `DELETE` since
[ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md) and the
`GET` since RN-519 —, and **no screen used them**. This RN is the screen, and it
**opens no new route**: what the listing already returns is enough to draw everything
that follows.

**Where it lives, and why PROJECT.** It takes the Settings tab from 17 to
**18** sections and is the **13th in render order** (`device-keys`, group `pessoas`,
right after `access-tokens` — the neighbor that does the same with PATs); the
registry's order is the SAME as the barrel's, because it is what the scroll-spy uses. Project
because the endpoint is
`/projects/:projectId/runner-device-keys`: an ACCOUNT screen would require a new route,
and the scope is about the one that exists.

**The KIND shows up, and it is not decoration — it is the reach of the screen's only
irreversible action.** Since [RN-543](produto.md#rn-543) the listing marks `projeto` | `maquina`, and
a MACHINE key (null `project_id`) **serves all the owner's projects** and
that is why it shows up in the list of ALL of them. Showing it without the mark would make the screen
assert it is "this project's key", and whoever clicked revoke would think it
takes down the local agent here when it takes it down **in all of them** — the screen would lie
precisely about what can least be wrong. The mark is `warning` for the machine one
and `muted` for the project one, and **never `success`**: green would read as "it's
up", which is the arithmetic [RN-548](#rn-548) already refused.

**The confirmation DEPENDS on the kind, and also states the collateral cost.** Revoking
opens a dialog with THREE sentences, and the middle one is the one that changes: the machine one names
*all your projects in runner mode* (the loop of
`RevokeRunnerDeviceKeyUseCase` over `listRunnerModeReachableBy`), the project one
names *its project*. A single text for both would lie in one of the halves. The
third sentence is the cost [RN-520](api.md#rn-520) declared and this delivery
**does not change**: the disconnection target is `{projeto, usuário}` and never `{chave}`, so
another runner of the same user on the same project also drops — even authenticated
by a PAT or another key — and reconnects on its own if its credential is still
valid.

**Recorded use is NOT an agent up, and the vocabulary is the SAME as RN-548.**
`lastUsedAt` is the data class of `workspaceVerifiedAt` ([RN-468](#rn-468)):
the record of a confirmation, never a heartbeat. The caveat is stated in TEXT in the
caption, and the status column talks about REVOCATION ("active"/"revoked", a fact
about the row), never about connection — what knows about NOW is still the
terminal's channel. Inventing a second vocabulary for the same distinction would be the screen
saying the same thing in two ways, and one of the two would age.

**Five states, and none becomes the other
([RN-088](#rn-088)/[RN-470](#rn-470)).** No key
("No device key of yours serves this project"), a REVOKED key (which
**stays in the list** by RN-519's decision — making the row disappear would make the screen
assert it never existed, and it gets no button because revoking again, even
if idempotent in the api, would suggest an effect that did not remain), NULL `lastUsedAt` (the
ORPHAN key of [RN-473](#rn-473): registered by a tab that closed in the middle of the
flow and never used by any runner — its own text, and an explanation below
the table that only shows up when there is one, because explaining what does not occur is
noise), "not loaded yet" and "I could not read". **"I don't know" never becomes "it doesn't
have".**

**The role is the ENDPOINT's, and it is the project's EFFECTIVE one.** The minimum is `developer`
— what `RunnerDeviceKeysController` requires on the THREE routes
([RN-102](api.md#rn-102)) — and the comparison comes from the SAME function
RN-548 created (`podeLerChavesDeDispositivo`, over `roleAtLeast`), never
a second rule and never a hand-written `role === 'x' || role === 'y'`. What changes in
relation to RN-548 is the INPUT: there the panel read the WORKSPACE role and **declared**
the gap, because it mounts in places that do not fetch `project_members`; here the
data is at hand — the section lives in the same tab as `MembersSection`, with the SAME
`queryKey`, and react-query deduplicates —, so the role is composed as in the use
case (`projectRole ?? workspaceRole`, an OVERLAY in both directions,
[RN-471](#rn-471)) and the gap **closes** instead of repeating itself. An ABSENT role is not
an INSUFFICIENT role: while the member list is in flight the screen says it
is verifying, and does not accuse the reader of not reaching `developer`. Whoever does not
reach it **still sees** the whole section, what a device key is and
what revoking the machine one costs — the CONTROL disappears, never the INFORMATION
([ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md)) —, and the reason is stated ONCE
in TEXT (`title` on a `disabled` element does not open in Chromium). Since the three
routes require the SAME role, whoever does not reach it also does not see the LIST: the screen stops
asking what the api would deny, instead of turning a predictable 403 into
"I could not read". This **is not a security boundary** — what refuses is the
`RolesGuard`.

**One at a time, and that is why there is no batch outcome.** The screen does not offer
"revoke all", so the rule of [RN-469](#rn-469) — a UI action that becomes N
calls is not a transaction, and the screen says so — does not apply: offering the batch
would create a partial outcome to narrate for an action nobody asked for. A failure in
revocation shows the api's OWN sentence and the row **stays** in the list.

- **Code:** `apps/web/src/routes/settings/RunnerDeviceKeysSection.tsx:76`
  (the whole section; the effective role at `:107`, the query at `:130`, the
  confirmation by kind at `:326`);
  `apps/web/src/routes/settings/sumario.ts:62` (the new entry, 13th in render
  order, of the 18);
  `apps/web/src/routes/ProjectSettingsTab.tsx:86` (the composition, in the SAME
  order); `apps/web/src/locales/{en,pt-BR}/settings.json`
  (`runnerDeviceKeys.*`). It consumes `listRunnerDeviceKeys`/
  `revokeRunnerDeviceKey` (`apps/web/src/lib/api-client.ts:431`) and
  `podeLerChavesDeDispositivo` (`apps/web/src/lib/agente-de-maquina.ts:68`) without
  changing either of them
- **Test:** `apps/web/src/routes/settings/chaves-de-dispositivo.test.tsx` — the
  two kinds marked in the same list; the revoked one that stays, marked and without a
  button; the orphan with its own text and the explanation that does NOT show up without it; empty
  and failure with different texts; the caveat that recorded use is not an agent
  up; the reach warning in BOTH kinds, with the call going out only after
  confirming; cancel without revoking; the failure bringing the api's sentence with the
  key still in the list; `viewer` without calling the route and with the reason in text; the
  project role overlay in BOTH directions; and the absent role that
  says "verifying" instead of accusing
- **Declared and NOT closed:** (1) the **revocation target** remains
  `{projeto, usuário}` and never `{chave}` — the screen SAYS so and does not change it, because
  changing it requires a new column in `runner_socket_tickets` and a new auth contract
  (RN-520), its own front with an ADR; (2) in an installation **without a PROJECT**, the
  machine key freshly created by [RN-552](api.md#rn-552) remains **unreachable**:
  both routes are project ones, and without a project there is no one to ask — CLOSED
  in [RN-611](api.md#rn-611), with a route and section per ACCOUNT; (3) the
  `maintainer` view (list/revoke any user's) stays OUT by
  RN-519's decision, not by this screen's omission; (4) no browser E2E — what
  is proven here is what the screen ASSERTS, and that the component suite proves
- **Origin:** AT-012 (EP-003/HS-007)

---

### RN-568 — The presence of QA, SecOps and the area members in the team panel is decided by the WHOLE session, not by the 200-event window {#rn-568}

The Overview and the Executors tab build the roster with `deriveAgentRoster` over
the session's LAST 200 events (`useSessionEvents`, `latest: true`). Two of the
presence facts came from that window: `gatesEverOpened` (qa and secops come in
when some `pr.gate_changed`/`infra.gate_changed` has already happened) and
`delegatedSubagents` (an area member comes in with a recorded delegation). Both
events are among the first of an execution — in a long session they leave the
window, and QA, SecOps and `qa-automacao` **vanished from the panel** of an execution that
kept running. It is the same class of defect that had already been closed for
`executionActivated`, and the workspace summary ([RN-090](api.md#rn-090)) already aggregated
both facts over the whole session (`bool_or` and `selectDistinct` in
`projects-summary.repository.ts`) — both screens loaded it and ignored
those two fields.

**The rule:** `deriveAgentRoster`/`rosterFactsFromEvents` accept an
OPTIONAL `agregado` (`AgregadoDaSessao`), and both screens fill it with the
summary. Four decisions, each with a reason:

1. **Absent is "I did not read", never "there was none".** Without a loaded summary (first
   paint, error), the fact comes only from the window, exactly as before. An absent
   read never becomes "QA is not here".
2. **The aggregate ADDS to the window, it does not replace it** (logical OR on the gate, union on the
   delegations). Both facts are MONOTONIC within a session — a gate that
   opened does not un-open, a recorded delegation does not disappear —, so the window only
   produces false NEGATIVES, never false positives. An aggregated `false` that
   disagrees with a gate SEEN in the window is a late summary (the two reads
   have their own poll cadences), and cannot hide QA.
3. **It only holds when the summary is of the SAME session the screen reads**
   (`latestSessionId === sessionId`). The summary aggregates the project's most RECENT
   session; the Overview reads that same session, but the Executors tab reads the
   current EXECUTION session ([RN-139](api.md#rn-139)). An ideation opened afterwards
   makes the two diverge, and then the aggregate would be of ANOTHER session — the screen
   goes back to deciding only by the window.
4. **Only PRESENCE changes.** `rosterFromFacts` (the single rule, shared with
   the dashboard card) stays intact, and each agent's STATUS (`gateStatus`,
   `subagentStatus`) is still read from the window. No new request and the
   200 ceiling does not change.

`delegatedSubagents` came in through the SAME mold because it fits without changing a rule: the
`delegations` table the summary reads and the `delegation.*` events the window
reads are born together in `RecordDelegationUseCase` (one row, one event, the three
outcomes), so the two sets describe the same thing.

**`executionActivated` (AT-130).** It is the third fact of the same mold: the
Executors tab read it from the summary WITHOUT the guard of item 3, so with a session
newer than the execution one the summary (of it) said `false` and the dev agents vanished —
or `true`, and they appeared without proof. Now it goes in `agregado.executionActivated`
only when `latestSessionId === sessionId`, and `deriveAgentRoster` ADDS it (logical
OR, monotonic) to the window and to the parameter, which also starts looking at
`execution.activated` in the events. No new field in the API. Tests:
`ProjectExecutorsTab.test.tsx` (summary of ANOTHER session, in both directions).
**Still open:** with a long execution session AND the summary of another session, the
event may have left the window and the tab goes back to deciding only by it — it is the cost
of the guard, the same as for the other two facts.

- **Code:** `apps/web/src/lib/agent-status.ts:324` (`AgregadoDaSessao`),

- **Code:** `apps/web/src/lib/agent-status.ts:324` (`AgregadoDaSessao`),
  `:296` (the optional parameter of `rosterFactsFromEvents`), `:304` (the union of the
  delegations), `:312` (the gate's OR), `:410` (the parameter passed on by
  `deriveAgentRoster`); `apps/web/src/routes/ProjectOverviewTab.tsx:97` and
  `apps/web/src/routes/ProjectExecutorsTab.tsx:111` (the aggregate with the session
  guard)
- **Test:** `apps/web/src/lib/agent-status.test.ts:628` (the whole block:
  `:633` a gate outside the window brings QA/SecOps with status from the window, `:658` without
  an aggregate the window decides alone, `:676` an aggregated `false` does not hide a gate
  seen in the window); `apps/web/src/routes/ProjectExecutorsTab.test.tsx:385`
  (QA and area member come back through the summary), `:397` (summary of another session does not
  decide); `apps/web/src/routes/ProjectOverviewTab.test.tsx:301` (SecOps comes back
  through the summary)
- **Origin:** AT-047 — the gap declared in `CLAUDE.md` and in the comments of the
  two screens

### RN-572 — The team tree translates every `dev.*` type the engine emits, and only states work in progress where the panel says `trabalhando` {#rn-572}

In a real installation (09/14) the dev agents "did not get past *started the task*".
The event log had `dev.started` followed by `dev.blocked_by_container`, with the
`reason` spelled out ([RN-502](engine.md#rn-502)). The team tree
(`timeline-tree.ts`) had no translation for the block — what is not in
`TRADUCAO` is discarded —, so the branch stopped at the previous milestone and the present
sentence asserted work about a stopped agent. The team panel, on the same
execution screen, already said `aguardando` for the same event
(`DEV_STATUS_EVENTS`, [RN-411](ci.md#rn-411)): two screens, two tables, and only one
of them was covered by the comparison with the engine's vocabulary.

**The rule**, in three parts:

1. **Every `dev.*` type the engine emits has a decision in the tree** — translated
   in `TRADUCAO` or declared in `TRADUCAO_FORA` with the reason (empty today).
   Omitting stopped being possible: `scripts/ci/vocabulario-de-eventos-dev.spec.ts`
   derives the engine's vocabulary through the same extractor as the event inventory
   and fails, naming the type, whatever is missing; and it also fails a translated `dev.*`
   type the engine does not emit. On the first round it found TWO
   missing (`dev.blocked_by_container` and `dev.error`) and ONE extra
   (`dev.rearmed`, which the api writes with actor `user` and which is why it never reached
   any branch — the tree only hangs milestones of actor `agent`).
2. **Whether a dev agent's last milestone is work in progress is not decided in the
   tree.** For a `dev.*` milestone, the branch only stays ACTIVE when the panel gives
   `trabalhando` to the same event (`statusDoEventoDev`, read from
   `DEV_STATUS_EVENTS`). `aguardando`, `ocioso`, `falhou` and `travado` leave the
   branch stopped — and with them `dev.idle`, `dev.blocked`, `dev.awaiting_gate`,
   `dev.awaiting_approval` and `dev.idle_tripped`, which before also counted
   as active. A `dev.*` type the panel did not decide does NOT become active: when in
   doubt the screen does not assert work.
3. **The container block is its own milestone** (`espera`, color
   `warning`, the same as the gate), with the engine's `reason` as detail — it is what
   says what to do. And `dev.started` stops saying "started the task":
   measured in the engine, it goes out on RECEIVING the order to work, before
   `try_claim` (`DevAgentServer.handle_cast(:work)`); it now says
   "looking for a task", and what asserts the task is `dev.working`, which now shows its
   title.

**What this rule does NOT do, and why:**

- **`container.start_failed` does not enter the tree.** It is the reason for the block,
  but the actor is `system` (`action-executor`): hanging it on a dev
  agent's branch would be inventing authorship, and the only other place in the structure, the
  `tronco`, IS NOT RENDERED by any consumer (measured:
  `AgentTimelineTree` and the Activities section of the `Shell` only read `ramos`). The
  event stays in the chronological log, one click away, and the blocked branch already says,
  through the `reason`, that the container needs to be started.
- **The tree's labels stayed in fixed pt-BR in this fix** — migrating them
  was a change to the whole screen. AT-134 did that migration later, and it did NOT
  touch the rule above: the DECISION per type (whether it becomes a node, which `MarcoTipo`, which
  detail) stays in `TRADUCAO`, in the code, and it is what the spec compares with the
  engine; only the TEXT left, as a KEY (`ChaveDeRotulo`) resolved in
  `executors:timelineTree.label.*`, with the present sentence in
  `timelineTree.now.*` and the origin detail in `timelineTree.detail.origin`,
  in both languages (`en` is the default, [RN-425](api.md#rn-425)). `montarArvore`
  receives the language as an argument (`getFixedT`), and the two consumers
  (`AgentTimelineTree` and the Activities section of the `Shell`) pass it from
  `useTranslation` — switching language rebuilds the tree. A key the table
  uses without text in one of the two locales fails in `timeline-tree.test.ts`.

- **Code:** `apps/web/src/lib/timeline-tree.ts:161` (`TRADUCAO`), `:205`
  (`dev.started`), `:206` (`dev.working` with the title), `:222`
  (`dev.blocked_by_container`), `:227` (`dev.error`), `:246`
  (`TRADUCAO_FORA`), `:307` (the `ativo` read from the panel), `:96`
  (`ChaveDeRotulo`, AT-134), `:135` (`tradutorDaArvore`);
  `apps/web/src/locales/{en,pt-BR}/executors.json` (`timelineTree.label`,
  `timelineTree.now`, `timelineTree.detail`);
  `apps/web/src/lib/agent-status.ts:134` (`statusDoEventoDev`);
  `apps/web/src/components/AgentTimelineTree.module.css` (`.espera`)
- **Test:** `scripts/ci/vocabulario-de-eventos-dev.spec.ts:300` (the tree
  block: `:308` every engine type decided, `:324` nothing translated that the
  engine does not emit, `:342` nothing on both sides);
  `apps/web/src/lib/timeline-tree.test.ts:130` (the measured sequence:
  `dev.started` + `dev.blocked_by_container` leaves the branch stopped with the
  reason — failure case), `:149` (`dev.started` does not assert a task), `:156`
  (states the panel does not call work leave the branch stopped; `dev.working`
  stays active with the title), `:168` (`dev.error` ends with the reason), `:367`
  (AT-134: every key used has text in both locales, the subtrees have the
  same keys, and the language passed beats the active one)
- **Origin:** AT-087 — real installation of 09/14; the labels' i18n, AT-134

## The repository is born on accepting the handoff to the Arquiteto, and execution does not start without it (RN-582)

### RN-600 — Project creation through the screen does not send the body the api is already known to refuse, one creation at a time, and the refusal shows up on the screen {#rn-600}

In the owner's test on 09/26 the api logged 11 `POST /workspaces/:id/projects →
400` in ~4 s, and the same `runner` project, created via the api with a path, came out 201.
Measured by reading and reproduced in the wizard's vitest: there is no automatic
retry (`createProject` is called directly, without `useMutation`), so each
POST was a CLICK. The probable cause is the `runner` mode's "Browse folder...",
which creates the project EARLY ([RN-437](#rn-437)): in the details step the
path field is ABOVE the name, and clicking before typing the name sent
`{ name: '', slug: '', executionMode: 'runner', workspacePath:
'/workspace-a-confirmar' }` — `CreateProjectDto` refuses a `name` with fewer than 2
characters and a `slug` outside kebab-case —, and the failure became only the toast "Could not
prepare folder browsing right now", with no reason; clicking again was the
only answer the screen suggested. A ONE-letter name passed `Continue`
and came back 400 at "Provision" for the same `MinLength(2)`.

Three halves, all on the screen (the api is right to refuse):

1. **Do not send what is already known to be refused.** `nomeAceitoPelaApi` mirrors the DTO
   (2+ characters, trimmed, and a non-empty slug) and becomes the name gate of the
   details step. In `runner` mode, "Browse folder..." stays INERT while
   the name does not pass, or while a TYPED path is not plausible
   (`caminhoLocalParecePlausivel`), and the reason is stated in text below the field
   (`procurar-bloqueado`, ADR 0064). An EMPTY path still does not block — the
   provisional placeholder of [RN-437](#rn-437) covers it. It is the revision of RN-437's
   sentence "never blocking the click", which talked about the PATH and did not foresee the
   empty name. The name goes trimmed in the body.
2. **One creation at a time.** `criacaoEmVoo` (a `useRef`) locks BOTH paths
   that create — "Browse folder..." and "Provision" —, because the `disabled` only
   reaches the button on the next render. In jsdom the `disabled` already holds the second
   click; the ref is what holds two events in the same browser frame.
3. **The refusal on the screen.** The 400 failure of the early creation now puts the api's
   sentence (`mensagemDaApi`, the `class-validator` list joined) in the SAME
   step `Alert` that "Provision" already used ([RN-170](api.md#rn-170)); other
   errors stay with only the toast.

**What was not measured:** the api log of the owner's test did not survive the
container restart, so the BODY of each of the 11 POSTs was not seen — the
cause above is the only one that reading the code and vitest reproduce, and it does not
prove it was it. The adjacency ([RN-437](#rn-437)) stays as it was: the project
created early with the provisional path does not receive the refined path
later at "Provision" (it is REUSED, not updated) — what fixes it is the
runner when connecting (RN-423).

- **Code:** `apps/web/src/lib/wizard.ts:108` (`nomeAceitoPelaApi`);
  `apps/web/src/routes/NewProjectWizard.tsx:112` (`montarPayloadDeCriacao`),
  `:202` (`criacaoEmVoo`), `:321` (`bloqueioDoProcurarNoRunner`), `:486`
  (`handleProcurarPasta`), `:536` (`handleConfirm`)
- **Test:** `apps/web/src/routes/NewProjectWizard.test.tsx:850` (describe
  `criar projeto sem rajada de 400` — without a name, 11 clicks and no POST;
  relative path; one-letter name; trimmed name; three clicks in the same
  frame create one; the api's refusal on the screen); `apps/web/src/lib/wizard.test.ts:210`
  (`nomeAceitoPelaApi`)
- **Origin:** AT-215 (the owner's test, 09/26), sibling of AT-214

## Mode conversion stops being a leap in the dark (RN-559, RN-560)

### RN-612 — Converting to `runner` is convert, THEN onboard: saving mounts the onboarding panel of the now `runner` project, and the folder browser stays out by construction {#rn-612}

The `runner` branch of the conversion was typed in the dark ([RN-559](#rn-559)) because the
order was undecided: onboarding BEFORE saving registers a key in a project
that is not yet `runner`, and `ConfirmProjectWorkspaceUseCase` refuses the
confirmation with 400. The maintainer's decision was to **measure** the other order with the
MACHINE key ([RN-543](produto.md#rn-543)/[RN-548](#rn-548)) and implement it if the
friction were acceptable. The measurement was done in the CODE (without bringing up the environment) and
gave this:

| who will serve the project | what happens after saving | gestures |
|---|---|---|
| MACHINE agent waiting (zero `runner` projects, [RN-550](runner.md#rn-550)) | the next query of `GET /runner/projects` lists it and the agent connects on its own — 15/30/60 s cadence of `espera-de-projetos.ts` | **zero**, within 60 s |
| MACHINE agent already serving ANOTHER project | the list is read ONCE, at start, with a live connection (RN-550) — the new project does **not** come in | **one**: restart the service |
| no machine key | the same pairing as project creation ([RN-473](#rn-473)) | pair + one command |

In all three cases the friction is that of project creation or less, so the conversion
becomes **two steps in the same section**: saving to `runner` mounts, right
below, the SAME `RunnerOnboardingPanel` as the Code tab and the wizard, with the
`projectId` of a project that now IS `runner` — recognition of the paired
machine, `EsperaDoRunner` and the ADR 0118 pairing come along, with no new
rule. Above the panel the section SAYS the machine agent's asymmetry (waits
on its own × restart), with the restart command for both platforms
(`systemctl --user restart brabo-runner.service`,
`launchctl kickstart -k gui/$(id -u)/dev.brabo.runner`): the screen does not know whether the
agent has another live connection, so it names both cases instead of asserting one.

The panel shows up when the SAVED project is `runner`, with no pending mode change
in the selector, and with the folder not yet confirmed — or until the end of the visit in which
the conversion saved, so `EsperaDoRunner` shows the confirmation instead of
disappearing the instant it arrives. An already confirmed `runner` project does not
get it.

**The typed path is PROVISIONAL, and the screen says so.** What decides the folder of
a `runner` project is the runner: the confirmation OVERWRITES `workspacePath`
([RN-423](runner.md#rn-423)), and the machine agent does not even look at the typed value — it uses
`<base>/<workspaceDirName>` ([RN-544](runner.md#rn-544)). The field stays mandatory
because the database CHECK requires a non-null path outside `container`; the section does not
invent a placeholder.

**The folder browser stays OUT of the `runner` branch, and now for the right
reason.** It is no longer the order: it is that the transport `{ tipo: 'runner', projectId }`
requires a runner connected to THIS project, and a connected runner has already confirmed its
OWN folder (`--dir`, or the one derived from the base). Choosing another there would be a
second `runner → runner` conversion the next reconnection would undo. Offering the
button would be a control that controls nothing; the section says so in text
([ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md)).

- **Code:** `apps/web/src/routes/settings/ExecutionModeSection.tsx:300`
  (`mostrarProximoPasso`), `:313` (`setConvertidoParaRunner`, the visit in which the
  conversion saved), `:452` (the next-step block), `:483`
  (`RunnerOnboardingPanel`, the same as the Code tab);
  `apps/web/src/locales/pt-BR/settings.json:249` and
  `apps/web/src/locales/en/settings.json:249` (`executionMode.nextStep.*`) and
  `:241` (`executionMode.path.runnerTyped`, rewritten); the cadence measured in
  `apps/runner/src/espera-de-projetos.ts:60` (`CADENCIA_DA_ESPERA_MS`) and the
  list read once in `apps/runner/src/index.ts` (`rodarComoAgenteDeMaquina`)
- **Test:** the `RN-612` describe in
  `apps/web/src/routes/settings/conversao-de-modo.test.tsx` — the happy path
  (before saving there is no panel; saving mounts the next step, with the
  restart command, and the panel asks for THIS project's keys), the machine key
  recognized, the failure case (an already confirmed `runner` project does not get the
  step), a draft of another mode hiding the step, and the text in `en`
- **Gap DECLARED:** restarting the machine agent that already serves another
  project remains a gesture in the terminal — re-querying the list with a live
  connection was refused by RN-550, and this rule does not reopen that. And the measurement is of
  CODE, not of screen: the environment was not brought up
- **ADR:** [0111](../adr/0111-conversao-de-execution-mode-de-projeto-existente.md),
  [0154](../adr/0154-chave-de-dispositivo-de-maquina.md)
- **Origin:** AT-143 (EP-021/HS-033)

---

## The repository is born on accepting the handoff to the Arquiteto, and execution does not start without it (RN-582)

### RN-614 — The screen shows the policy's reason and the scope's root, in a single sentence, in both places {#rn-614}

[RN-567](api.md#rn-567) put in `proposed_action.created` the rule that decided
(`reason`) and [RN-609](api.md#rn-609) put the scope's root (`scopeRoot`, only in
`terminal`) — and both declared the screen did not change. Whoever audited through the
screen an action that PASSED still did not know which rule let it through.

**The rule:** the data shows up in TWO places (the maintainer's decision), and both
say the SAME sentence, assembled by ONE function, `fraseDaDecisaoDaPolitica`:

- the **event's line in the log panel** — `classifyEvent` gains the branch for
  `proposed_action.created` (type `permission`, `bad` when denied), with the
  policy's outcome and, after the dash, the sentence;
- the **`ApprovalCard`**, on its own line right below the sentence of what
  happens ([RN-096](produto.md#rn-096)) — never inside the collapsed payload.

The action (`proposed_actions`) keeps neither of the two fields: the screen reads them from the
EVENT, which it already loads (`decisaoDaPoliticaDaAcao`, by `actionId`). That is
why the card has THREE states, which do not collapse: a screen that does not read the event log
(the "needs you" panel, PRs, containers) does not pass the data and the card goes SILENT;
a screen that reads (the session chat and the Approvals tab's queue, both over the most
recent session) and did not find the event in the loaded window says *"outside the events
loaded on this screen"*; and the found event gives the sentence. The Insights tab has no
`ApprovalCard` — a Psicólogo hypothesis is not a `proposed_action`.

**Since AT-336 ([RN-656](api.md#rn-656)), each card of the Approvals tab has its
OWN reason**, read through the action when the loaded log does not cover it; the
next paragraph is the state of AT-333, which it replaced — the single note remains only for the
read that FAILS. Since AT-340 the same holds for the cards
of pending items from OTHER sessions in the chat ([RN-626](#rn-626)), which before
went silent: the thread's log never covers another session's action.

**In AT-333, the Approvals tab's queue started saying the gap ONCE.** The queue is the
PROJECT's ([RN-638](#rn-638)) and the events are those of ONE session, so there
*"outside the loaded events"* came out on almost every card — a truth repeated per
card, the tool explaining itself. The api does not expose the reason per action (the action
does not keep it, and the events read does not filter by `actionId`: measured), and
fetching without a window would require a new endpoint. The tab then starts COUNTING the
pending ones without the event and saying, in a note above the queue, how many there are and
why (*"of these N actions"*, or *"of N of the M actions below"*), in the mold of
[RN-180](#rn-180); those cards go silent (the "screen that does not read" state), and the card
whose event is loaded keeps showing the sentence. The note only counts with the
log in hand: before the events arrive it asserts nothing. The session
chat keeps the three states per card — there the cut is the thread's own.

**Absent is not "no reason", and the absolute never shows up.** An event prior to
RN-567 says *"policy reason not recorded"*; a `terminal` prior to RN-609
says *"scope root not recorded"*; another type, without `scopeRoot`, does not talk about
a root (the scope is only consulted in `terminal`). The four anchors have their own
text — managed folder, segment inside the projects base, folder name
on the runner's machine, and `indisponivel` (*"no relative form"*, without a segment).
An anchor the screen does not know says it does not know, and does not print the segment: the
screen rebuilds no path at all. The sentences are in `en` and `pt-BR`
(`approvals.json`, key `politica`).

- **Code:** `apps/web/src/lib/decisao-da-politica.ts:111`
  (`fraseDaDecisaoDaPolitica`), `:65` (`lerDecisaoDaPolitica`), `:124`
  (`decisaoDaPoliticaDaAcao`), `:145` (`linhaDoEventoDePolitica`);
  `apps/web/src/lib/activity.ts:721` (the branch for `proposed_action.created`);
  `apps/web/src/components/ApprovalCard.tsx:272` (the card's line);
  `apps/web/src/routes/session-timeline-montagem.tsx:825` and
  `apps/web/src/routes/ProjectApprovalsTab.tsx:307` (`decisoesDaPolitica`, since
  AT-336 through `useDecisoesDaPolitica`) and `:499` (who passes the data)
- **Test:** `apps/web/src/lib/decisao-da-politica.test.ts:43` (the anchors,
  `:43`/`:54`/`:65`/`:76`), `:87` (old event), `:102` (unknown anchor
  without leaking a path), `:114` (the two languages), `:144` (the log line IS the
  card's sentence); `apps/web/src/components/ApprovalCard.test.tsx:733` (the card
  uses the same function, and the three states);
  `apps/web/src/routes/ProjectApprovalsTab.test.tsx:304` (since AT-336, the note
  counts only the read that fails)
- **Origin:** AT-148 (EP-025/HS-043); the queue's note, AT-333; the reason per card, AT-336

---

## The language of the agents' answers (RN-618..620, RN-622..624, ADR 0177)

### RN-620 — The session bar shows the answers language of WHOEVER IS VIEWING, with the origin, and changing it there is the override only for that person in that session {#rn-620}

1. **Next to the model selector, in another scope.** The bar's model belongs to the
   SESSION and holds for everyone; the language belongs to the PERSON (`GET
   .../sessions/:sessionId/response-language`, resolved for the caller,
   [RN-618](api.md#rn-618)). Changing it there is the session override — the
   maintainer's decision, AT-169 answer 2 — and never touches another participant's nor
   the Account.
2. **Never the value without the origin** (the rule of [RN-470](#rn-470)): "set
   by you in this session", "chosen by you in the Account", "detected from
   your messages and confirmed by you" and "the interface language" are
   four texts, and none collapses into another. Loading and failed also have
   their own text — the failure does not pretend a language. The detected one never becomes an
   assertion about the person ("you are Brazilian"), only about the messages
   (AT-080).
3. **"Follow the Account" releases the override** (`language: null`) and says in WHICH
   language that results — the same chain without the session step, derived on the
   client from the chain the route already returns, without a new endpoint. "Another
   code…" opens a field that only sets on the button (RN-469), and the api's refusal
   arrives in the toast with its sentence. A link leads to the Account, where the
   choice that holds in every session lives.
4. **Who changes it**: the `PUT`'s minimum (`developer`), via `roleAtLeast` over the
   WORKSPACE role (the declared gap of the screens that do not fetch
   `project_members`). Below it the value and the origin stay on the bar, the
   selector stays inert and the reason comes in text.
5. **What the bar does NOT assert**: never "the agents answer in X" as a fact
   about the person — only the effective one and the origin. Since [RN-622](engine.md#rn-622) that
   effective one reaches the model in the messages of whoever is viewing, and the warning "does not
   reach the agents yet" left the origin line. The line truncates at the bar's 60px
   and carries the whole text in the `title` — the text is on the screen, the `title`
   only returns what the ellipsis cut.
6. **On the narrow bar, the language CHANGES place and does not disappear** (AT-317). The bar
   arranges itself by its OWN width (`modoDaBarra`, measured by
   `ResizeObserver`; an unknown width is the full bar): from
   1720px everything stays inline; below that model, language and budget become ONE
   control whose trigger summarizes the model and the language code (below 920px
   only the icon, with an accessible name), and its panel brings the whole indicator
   with the origin WRAPPING instead of cutting. The detection question
   ([RN-624](api.md#rn-624)) lives in the panel, and while it exists the trigger gains a
   mark and the accessible name announces it. The session title is the only item that
   shrinks (with a floor and the whole name in the `title`), and the buttons do not wrap
   — "Close" becomes an icon with an accessible name only on the minimal bar.

- **Code:** `apps/web/src/routes/SessionLanguageIndicator.tsx:79`
  (`SessionLanguageIndicator`), `:35` (`idiomaSemOverride`), `:170`
  (`origemPorExtenso`), `:219` (`podeTrocar`);
  `apps/web/src/routes/SessionTopbar.tsx:247` (`SessionLanguageIndicator`),
  `:120` (`modoDaBarra`), `:364` (`AjustesAgrupados`);
  `apps/web/src/lib/modo-da-barra-da-sessao.ts:35` (`modoDaBarra`)
- **Test:** `apps/web/src/routes/SessionTopbar.test.tsx:174` (the
  1440px bar is not full), `:191` (groups, and the panel brings language with origin),
  `:236` (minimal bar with an accessible name), `:256` (a pending question marks the
  control), `:273` (failed language read — failure case);
  `apps/web/src/routes/SessionLanguageIndicator.test.tsx:99`
  (effective with origin and the link, without the old warning), `:112` (the detected one does not become
  "chosen"), `:126` (changing sets only in this session), `:151` ("Follow the
  Account" sends `null`), `:180` (the api's refusal — failure case), `:202`
  (below `developer`), `:213` (failed read), `:225` (the chain without the
  session)
- **Origin:** AT-165, on the decisions of AT-169 (answer 2) and AT-168
  (answer 7)

## Deciding in the chat, where the owner is (RN-626)

### RN-626 — The session chat decides what the agents proposed in another session, shows the turn that was in progress and proposes the merge — without changing any ceiling {#rn-626}

The real use of 2026-09-29 measured the cost of the owner talking in one session and the dev
agents proposing in another: their approvals never appeared where he was, 45
of 173 clicks on "Sempre permitir" came back 409 (the card was still clickable
after the action had already left `pending`), and reopening the session with a turn in
progress gave back a free composer and the 409. The four fixes are SCREEN fixes — the
api, the engine and every ceiling stay as they are.

1. **The card goes inert and says the api's sentence (AT-256).** `ApprovalCard` holds
   the buttons while the decision is in flight (the double click was a certain 409) and,
   when the call returns a promise that rejects, shows the sentence the api
   sent ON the card — never a generic toast. A 409 (the action is no longer
   `pending`) leaves the buttons inert with the reason in text until the list swaps the
   card for the outcome line. The caller returns the promise and refetches the list
   EVEN on refusal (`finally`): it is ONE invalidation per click, no new poll, and the
   invalidation uses the channel and budget of [RN-579](engine.md#rn-579).
2. **Reopening the session resumes the turn from the log (AT-268).** The screen's turn state
   is local `useState` and was lost on leaving. On the first read of the events of
   an `active` session, `turnoEmCursoNoLog` looks at the most recent persisted `agent.status`
   of each agent (the same read as `turnoTerminouNoLog`, from
   [RN-578](engine.md#rn-578)); whatever is `working` reopens the strip and locks the composer
   through the same entry points as an accepted turn (`iniciarTurnoDoAgente` +
   `acompanharTurnoPeloLog`), and the read of the log tail closes it. It runs ONCE
   per mounted session (a recurring effect would rearm the strip with the old `working`
   still in the cache). The `working` left by an engine restart is closed
   by a new event at boot ([RN-586](engine.md#rn-586)), so what remains is a live turn.
   **It does not queue messages:** a message with a turn in progress is still refused with a
   named 409 — the queue is a pending decision of the owner (AT-267).
3. **Pending items of OTHER sessions of the project appear in the chat (AT-265).**
   `PendenciasDeOutrasSessoes` reads `GET /projects/:id/actions?status=pending`
   (the same endpoint as the PRs tab and the "needs you" panel) and draws the ones that
   were NOT born in this session — this session's are already decided by the thread. It is a SHORTCUT and never a
   substitute ([RN-467](#rn-467)): the SAME `ApprovalCard`, the same endpoints,
   with the `sessionId` the action itself carries; `onActivateAutoMode` stays
   out (it is policy, not decision). The two queues — approvals and PR merges —
   have their OWN title and count and are never summed, and each row states the
   originating session. The drawing has a ceiling of 20 cards, and the excess is stated ("Mostrando N
   de M"): a declared cut, as in [RN-180](#rn-180). The poll is the session's
   (5 s with the channel down, the 15 s fallback with it live — `intervaloDaSessao`),
   because the session channel does not announce another session's writes.
4. **"Mergear" on the card of the open PR (AT-266).** Under the card of an executed
   `pr_open`, and only when the `action.pr_open` event carries the PR id and there is no
   live `git_merge` (pending, approved or auto-approved) for it, the button
   PROPOSES the `git_merge` through the same endpoint as the PRs tab (actor `user`, in this
   session). The proposal appears in the thread as the usual card, with Aprovar/Negar:
   **the confirmation is the same and belongs to the human** — merge into a protected branch
   remains unconditional `require_approval` ([RN-418](api.md#rn-418)), without auto-approval,
   without "sempre permitir", without auto mode. The dedupe and the api's refusals
   (PR already merged, merge already proposed — [RN-663](api.md#rn-663)) reach the owner as
   the api's sentence; a pending gate is not a refusal, it is a text notice next to the button.
5. **The role is the ENDPOINT's, and the gap is declared.** Deciding an action and proposing
   an action require `developer` (`actions.controller.ts`); the screen uses `roleAtLeast`
   over the WORKSPACE role, because the Session does not fetch `project_members` — the
   same single gap of [RN-471](#rn-471), declared here and not closed. Whoever does not
   reach it SEES the pending item and the button, with the controls inert and the reason in
   text (`bloqueio` of `ApprovalCard`): what is taken away is the control, never the
   information.

**What this rule does NOT close, declared:** (a) "Mergear" does not propose AND approve
in a single click — it is two clicks, the proposal and the confirmation, on purpose;
(b) resuming the turn reads the window of events already loaded, and an `agent.status`
outside it is not seen (not knowing is not "is working"); (c) the list of
pending items from other sessions has the ceiling of 20 cards, and the rest stays in the
Aprovações tab; (d) architecture pending items and the Psicólogo's hypotheses
still have NO inline decision (there is no `ApprovalCard` for them).

- **Code:** `apps/web/src/components/ApprovalCard.tsx:228` (`decidir`, the
  decision in flight and the refusal on the card); `apps/web/src/lib/session-turno.ts:59`
  (`turnoEmCursoNoLog`), `:532` (`useRetomarTurnoDoLog`);
  `apps/web/src/lib/pendencias-do-projeto.ts:24` (`usePendenciasDoProjeto`),
  `:56` (`separarPendenciasDeOutrasSessoes`);
  `apps/web/src/components/PendenciasDeOutrasSessoes.tsx:65`
  (`PendenciasDeOutrasSessoes`); `apps/web/src/routes/MergearNoChat.tsx:28`
  (`prAbertaDaAcao`), `:56` (`jaHaMergeDaPr`), `:89` (`MergearNoChat`);
  `apps/web/src/routes/SessionPage.tsx:150` (`podeDecidir`), `:272`
  (`useRetomarTurnoDoLog`), `:767` (`PendenciasDeOutrasSessoes`)
- **Test:** `apps/web/src/components/ApprovalCard.decisao-em-voo.test.tsx:37`
  (double click), `:52` (409 on the card and inert buttons — failure case), `:67`
  (an error that is not 409 gives back the buttons); `apps/web/src/lib/turno-em-curso-no-log.test.ts:18`
  (working), `:22` (idle and awaiting_approval close), `:38` (no status in the
  window — failure case); `apps/web/src/routes/SessionPage.retomar-turno.test.tsx:159`
  (the screen resumes and the log unlocks), `:182` (idle does not invent a turn — failure
  case); `apps/web/src/components/PendenciasDeOutrasSessoes.test.tsx:71`
  (separate queues, the action's sessionId), `:99` (role below developer — failure
  case), `:109` (409 on the card), `:126` (cut);
  `apps/web/src/routes/MergearNoChat.test.tsx:62` (PR from the event), `:75`
  (dedupe), `:100` (proposes as user, without approving), `:121` (api refusal —
  failure case), `:134` (role — failure case)
- **Origin:** AT-256, AT-268, AT-265 and AT-266, from the analysis of the real use of
  2026-09-29 (items 4, 5 and 10a), round 27, lane web-sessao

### RN-631 — The chat recipient is chosen and visible, and the handoff offer is matched by `handoffId` {#rn-631}

The composer message's recipient was DERIVED: "the most recent `agent.activated`
within the 200-event window" (finding 9-fix). It was a default recipient
on the SCREEN side — the defect class that [RN-584](engine.md#rn-584) closed in the
engine — and it was INVISIBLE: the composer did not say who the message went to, and accepting
a handoff on this screen changed nothing beyond the log. In the real use of 09/29 the
session had `handoff.accepted` to the Infra and then to the Arquiteto, and the user's "hi"
was answered by the Arquiteto without the screen saying so. And the acceptance card
matched the offer to the event by the ACTOR/`toAgent` pair (`e.actor.id ===
offeredHandoff.fromAgent`), although `handoff.offered` has carried `handoffId`
from the start (AT-251).

**The rule:**

1. **The OPTIONS** are the agents that converse (`AGENTES_DE_CHAT`) and that are already
   in the session: `agent.activated` in the window, `roster.activatedAgents` from the
   project summary ([RN-630](api.md#rn-630), the WHOLE session, only with the summary of the
   SAME session, in the mold of [RN-568](#rn-568)) or an ACCEPTED handoff (the list of
   handoffs has no window). The last two terms are [RN-180](#rn-180): the
   agent does not vanish from the selector because the activation left the 200 events. In the creative
   session the Criativo is an option before being activated, because the first message
   activates it (finding 3).
2. **The recipient is what the person CHOSE** — in the composer's "Para" selector,
   or by accepting a handoff ON THIS screen (the gesture of calling that
   agent; a failed acceptance changes nothing). Nothing in the log chooses for them: an
   acceptance made in another tab or through another path only adds an option.
3. **A SINGLE option is the recipient, and the composer names it before sending.** It
   is not a default in the sense of [RN-584](engine.md#rn-584) — there is no other agent the
   message could go to.
4. **Two or more options and no valid choice: no recipient.** The
   "Enviar" (and Enter) is locked and the screen says in TEXT that a choice is
   needed — never "the most recent". Zero options is the session chat without an agent
   (SSE), and the screen says so too. **Revised by [RN-682](api.md#rn-682):** zero
   options also locks sending — the consultative session without an agent asks for an agent, and
   SSE to the raw model is no longer called by the screen.
5. **The choice is remembered per session in `localStorage`** — a convenience for the viewer
   (without storage the screen just asks for the choice again), never product
   state.
6. **"Parar" stops the agent OF THE TURN** (`turnoAgentRef`, `streamingAgent`,
   `statusAgent`), and only in its absence the recipient: changing the selector in the middle
   of another agent's turn must not stop the wrong one. The model shown in the topbar
   follows the recipient.
7. **The offer is matched by the payload's `handoffId`**, never by the actor: each
   `handoff.offered` is the card of its own offer, with no pair to confuse nor a "most
   recent" to choose. Offers to an already activated agent (window OR
   `roster.activatedAgents`) do not become acceptable again.

8. **Every pending offer is actionable, and none hides another** (AT-253). The
   card picked ONE offer (`handoffs.find`, the oldest pending), and the
   MANUAL handoff ([ADR 0109](../adr/0109-handoff-manual-a-agente-a-escolha.md),
   [RN-441](api.md#rn-441)) — recorded with the PERSON as actor, and therefore never
   matched by the actor — had no "Aceitar" and hid the following offers.
   Now every pending offer to an agent that converses (except the Infra's, which
   has its own card, [RN-499](#rn-499)) has the button on its event; two
   pending ones to the SAME agent give a single button, the most recent one's, and accepting it
   removes the other through `activeFor`. The manual handoff pill says "Handoff
   manual" instead of the person's id.
9. **"Already in the session" is read from window-LESS sources scoped to the REQUESTED session**
   (review of PR #759). The summary's `roster.activatedAgents` belongs to the project's MOST
   RECENT session, and activating execution CREATES a new session that becomes
   that one: the chat session lost the whole source and went back to depending on the
   200 window. The sum now has THREE sources — the summary, only when it is this session's; the
   handoffs of THIS session (whoever received an accepted one and whoever OFFERED one, who was
   in it); and the per-agent spend of THIS session (`GET .../token-usage`, aggregated without
   a window: an agent with a row there ran a turn, and only an activated agent runs a turn).
   Each source only fixes false negatives, and spend is proof of PRESENCE, never of
   absence. **Declared gap:** an agent activated by a direct `start`, without a
   handoff, that never ran a turn, in a session that is no longer the most recent,
   still depends on the window — and whoever has a role below `developer` (the
   minimum of the spend route) lacks the third source. Closing it requires the
   activation aggregate PER SESSION in the api; it was not done here.
10. **A pending offer whose event left the window gets a button in the fixed strip
    above the composer** (review of PR #759). The actionable card belongs to the
    `handoff.offered`, and the list of handoffs has no window: in a long session the
    offer stayed `offered` and without a button anywhere. The criterion is the CUT,
    not absence — the offer is older than the oldest event in the window
    (a just-created offer whose event has not arrived yet does not flash in the strip), and
    an empty window does not assert a cut. The strip has only the acceptance; the "Ativar
    execução" shortcut of the Dev Lead card stays in the thread.

The guard of [RN-584](engine.md#rn-584) (`scripts/ci/destinos-do-composer.spec.ts`)
now reads `DESTINATARIO_DA_SESSAO_CRIATIVA` instead of the literal from
`SessionPage.tsx`: every destination the composer can give still has
its own clause in the engine. No api or engine change.

- **Where:** `apps/web/src/lib/session-destinatario.ts:210` (`agentesEmConversa`),
  `:237` (`resolverDestinatario`), `:272` (`useDestinatarioDoChat`), `:116`
  (`useAtivadosNaSessaoInteira`), `:141` (`ativadosSemJanela`);
  `apps/web/src/routes/SessionComposer.tsx:287` (`destinatarioRow`), `:193`
  (`ofertasForaDaJanela`); `apps/web/src/routes/SessionPage.tsx:350`
  (`aceitarHandoff`); `apps/web/src/routes/session-timeline-montagem.tsx:547`
  (`handoffIdDoEvento`), `:555` (`origem`); `apps/web/src/lib/session-handoffs.ts:68`
  (`activeFor`), `:120` (`ofertasAcionaveis`), `:142` (`ofertasForaDaJanela`)
- **Test:** `apps/web/src/routes/SessionPage.destinatario-do-chat.test.tsx`
  (choice → sent to the chosen one; two agents without a choice do not send and say
  why; single option; accepted handoff outside the window; summary of the same session
  and of another; acceptance that switches and acceptance that fails; remembered choice; session without
  agent; most recent execution session with the activation read from the handoffs and
  from this session's spend, and the refused spend; offer outside the window in the strip, and
  an offer in the window or newer than it outside it),
  `apps/web/src/lib/session-destinatario.test.ts` (`ativadosSemJanela`),
  `apps/web/src/routes/SessionPage.handoff-inline-e-links.test.tsx` (an old
  offer of ANOTHER `handoffId` stays mute),
  `apps/web/src/routes/SessionPage.handoff-manual.test.tsx` (the manual one gets
  "Aceitar"; the pending manual one does not hide the following offer; two to the same
  agent become one button)
- **Origin:** AT-251, AT-253

### RN-632 — A PROJECT read polls at the project pace, and every screen that listens to the session channel invalidates through the SAME window {#rn-632}

The real use of 09/29 hit the user's 300 req/min ceiling ([RN-579](engine.md#rn-579))
with two tabs open: 192 × 429 at 07:14, 106 of them on
`GET /projects/:id/sessions` and 20 on `GET /projects/:id`, and three
`approve_always` clicks refused in the middle (AT-278). RN-579 had put the
SESSION screen reads under the channel; the PROJECT ones and the other screens that listen to the
channel were left out. The ceiling does NOT change: what drops is the request.

**The rule:**

1. **A project read that no channel announces polls at 15s**
   (`INTERVALO_DO_PROJETO_MS`), UNCONDITIONALLY. The `session:<id>` channel only announces
   writes of its own session; the project's session list and the rail
   counters (approvals of the most recent session, pending merges of the project,
   stories to promote, architecture pending items, hypotheses) change by writes
   of ANY session — there is no notice to wait for, so the mechanism is a long
   poll, in the same fallback that RN-579 already accepts for the session. It applies to
   `useProjectSessions`/`useLatestSession` (they were 5s), to the five counters
   of the `ProjectPage` frame and to the architecture of the Executores tab. The tab that
   shows the data as its SUBJECT (Backlog, Arquitetura, PRs) keeps its own poll, and
   the fastest observer dictates the key's pace. Whoever writes in this tab
   still invalidates the key immediately.
2. **Whoever only needs the data on click does not poll.** Each row of
   `/containers` reads its project's most recent session to PROPOSE
   stop/remove/start; at a 5s poll it was 12 req/min PER PROJECT — nine
   projects, 108/min from that page alone, the number that matches the 106 in the log.
   `useLatestSession(projectId, false)`: mount and window focus are enough.
3. **Every screen that listens to the channel goes through `criarInvalidadorDoCanal`.** The
   Executores and Visão geral tabs invalidated the events on EVERY `event.appended`,
   with no window: a dev agent in a burst (10 notices/s) made 630 event GETs
   per minute in the Executores tab alone. Now both use the SAME invalidator as the
   Session screen (window per target, the TYPE decides the target), and get as a bonus
   what was missing: the dev agent's action proposal invalidates the actions immediately,
   instead of waiting for the 15s fallback. The Visão geral requests the backlog on every notice
   (the blocked tasks come from it) through the `extras` parameter, with the same window.
4. **Waiting for the runner stops when it is over.** `EsperaDoRunner` only stopped the
   `GET /projects/:id` probe (3s) at the CEILING; once the connection was confirmed, the
   ceiling's effect exited early and the probe kept going forever — 20 req/min while the panel
   was on screen, and, being the fastest observer of `['project', id]`,
   dragging the page's whole key. Now it stops at the ceiling OR on confirmation.

**Numbers** (`duas-abas.orcamento.test.tsx`, the real screens — `Shell`,
`SessionPage`, `ProjectPage` on the Executores tab, `ContainersPage` — over a
`fetch` that counts per route; each tab measured alone, because two tabs are two
JS contexts, and summed; req/min, `dev` → this rule):

| Scenario | Before | After |
|---|---|---|
| session chat + Executores, live channel | 70 + 138 = 208 | 70 + 72 = 142 |
| same, dev agent in a burst (10 notices/s) | 70 + 764 = 834 | 70 + 97 = 167 |
| same, channel that never connects | 155 + 186 = 341 | 155 + 120 = 275 |
| `/containers` with 9 projects | 132 (108 from `/sessions`) | 24 |

**What this rule does NOT close:** with the channel DOWN in both tabs, 275/min is still
close to the ceiling — the Session screen goes back to the usual 3s (RN-579: never worse
than it was), and 25 req/min of slack vanish with a burst of clicks. The `Shell`
keeps polling `projects-summary` and `execution/session` at 5s and, in the chat tab,
the events of the EXECUTION session at 3s (the tab does not have its channel) — 44 of the 70
req/min of the chat tab. A session list created in another tab shows up here within
15s (it was 5s). The incident's number was MATCHED, not reproduced: the log
did not say which tabs were open, and the reading that `/containers` was
in one of them is inference from 106 ≈ 9 × 12.

- **Code:** `apps/web/src/lib/canal-vivo.ts:54` (`INTERVALO_DO_PROJETO_MS`),
  `:255` (`aoEvento`, the `extras`); `apps/web/src/lib/hooks.ts:127`
  (`useProjectSessions`), `:158` (`useLatestSession`);
  `apps/web/src/routes/ProjectPage.tsx:77` (the rail counters);
  `apps/web/src/routes/ContainersPage.tsx:62` (`useLatestSession`, without poll);
  `apps/web/src/routes/ProjectExecutorsTab.tsx:203` (`invalidador`),
  `apps/web/src/routes/ProjectOverviewTab.tsx:191` (`invalidador`);
  `apps/web/src/components/EsperaDoRunner.tsx:73` (`confirmadoPor`)
- **Test:** `apps/web/src/routes/duas-abas.orcamento.test.tsx` (the two tabs
  with a live channel, with a burst, with the channel that never connects, and `/containers`;
  all four fail on `dev`); `apps/web/src/components/EsperaDoRunner.test.tsx`
  ("confirmada a espera, a sonda PARA" and the failure case: without confirmation it
  keeps going); `apps/web/src/routes/ContainersPage.test.tsx` ("a linha lê a sessão
  mais recente SEM poll")
- **Origin:** AT-278 (extension of [RN-579](engine.md#rn-579); does not change RN-108 — the
  single-use ticket and manual reconnection stay as they are)

### RN-633 — The manual handoff does not declare readiness, and "already active" for the offer is the project's {#rn-633}

Two reads of the Session screen left the handoff stale (AT-293, AT-294):

1. **The MANUAL handoff does not hide "Estou pronto para produzir" nor "Confirmar
   arquitetura pronta"** (AT-293). `prontidaoJaDeclarada` and
   `arquiteturaJaDeclarada` only asked "is there a handoff leaving the
   Criativo/Arquiteto?", and the manual handoff
   ([ADR 0109](../adr/0109-handoff-manual-a-agente-a-escolha.md),
   [RN-441](api.md#rn-441)) records as `fromAgent` the LAST activated agent
   (`request-manual-handoff.use-case.ts`): requesting a manual handoff to the Staff with
   the Criativo active hid the readiness button with no readiness at all
   declared. The manual one is recognized by the human ACTOR of `handoff.offered`
   (matched by `handoffId`, [RN-631](#rn-631)) — the api's `Handoff` does not
   carry the actor. Outside the 200 window the actor is unknown, and then: for the
   Criativo the `artifactId` counts (the readiness handoff carries the
   `product_brief`, `criativo_server.ex`; the manual one never carries an artifact); for the
   Arquiteto the two automatic ones carry no artifact, so the one of unknown
   origin keeps counting, as before. **Declared gap:** the durable mark
   would be the actor (or a manual mark) on the api's `Handoff` itself;
   it was not done here (the api belongs to the lifecycle lane, ADR 0182).
2. **An offer to an agent already ACTIVE in another session of the project is not actionable**
   (AT-294). "Active" was the SESSION's: after "Ativar execução", the Dev Lead
   runs in the execution session, and the offer to him in the chat session still had
   "Aceitar". Now the offer (the thread card, the out-of-window strip and the
   Infra card) adds to "already joined this session" the summary's `roster.activatedAgents`,
   which is the project's MOST RECENT session — the execution one, once
   activated. `activeFor` is still THIS session's, because it is what the
   manual handoff selector uses. **Declared gap:** sessions that are
   neither this one nor the most recent are not seen; closing it requires a
   PER-PROJECT activation aggregate in the api, which does not exist.

No api or engine change.

- **Where:** `apps/web/src/lib/session-handoffs.ts:41` (`origemDoHandoff`),
  `:108` (`jaAtivo`), `:180` (`prontidaoJaDeclarada`), `:192`
  (`arquiteturaJaDeclarada`); `apps/web/src/lib/session-destinatario.ts:156`
  (`useAtivosNoProjeto`)
- **Test:** `apps/web/src/routes/SessionPage.handoff-obsoleto.test.tsx`
  (manual with the Criativo active does not hide "Estou pronto"; manual with the
  Arquiteto active does not hide "Confirmar arquitetura pronta"; the agent's handoff
  still hides — failure case; outside the window the Criativo's
  with a brief counts; Dev Lead active in the execution session leaves the offer mute;
  without him, the offer stays actionable — failure case)
- **Origin:** AT-293, AT-294

### RN-634 — After "Ativar execução", the screen goes to the execution session {#rn-634}

Execution runs in a NEW session (RN-135, RN-139), and the chat session the
click came from may even close. The "Ativar execução" shortcut of the handoff card
to the Dev Lead (RN-137) — and the merge with the acceptance (RN-161) — left the person in the
chat session, looking at the place the work left from (AT-295). Now
`handleActivateExecution` reads the `sessionId` that `POST .../execution/activate`
returns and takes the screen to it, with the notice "Levando você à sessão de
execução.". Without `sessionId` in the response, with the same id as the current session, or
without anyone to navigate (the screen mounted outside the route), only the usual notice, and the screen
stays. A refused activation does not navigate and shows the api's sentence. The one that navigates is the
ROUTE (`irParaSessao`, the router's `navigate`): the screen does not depend on the router.

- **Where:** `apps/web/src/lib/session-acoes-de-handoff.ts:147`
  (`handleActivateExecution`); `apps/web/src/router.tsx:339` (`irParaSessao`)
- **Test:** `apps/web/src/routes/SessionPage.handoff-obsoleto.test.tsx`
  (navigates to the returned `sessionId`, with notice; refusal does not navigate — failure
  case; without anyone to navigate, it only notifies)
- **Origin:** AT-295

### RN-638 — Whoever asks "what awaits a decision" reads the PROJECT's queue, never the most recent session {#rn-638}

The rail's Aprovações counter, the "needs you" panel ([RN-467](#rn-467)),
the Aprovações tab, the Visão geral roster and the Código tab read the pending ones from
`useLatestSession` — the session CREATED last —, which is only the execution one by
coincidence. An ideation or a chat opened after the execution zeroed the
counter and hid from the roster the dev agents waiting for a decision (AT-297). And the
block of pending items from other sessions in the chat ([RN-626](#rn-626)) only existed in an
active session, while the `container_start` that the Infra Lead proposes in the CHAT
unblocks the `dev.blocked_by_container` that appears in the EXECUTION (AT-298).

**The rule:**

1. **The queue is the project's.** Those screens read `useProjectPendingActions`
   (`GET /projects/:projectId/actions?status=pending`, in any session),
   all through the SAME key `['project-pending-actions', projectId, undefined]`
   — at the project pace of [RN-632](#rn-632), and at 3s only in the Aprovações tab, which
   has it as its subject. The `ProjectPage` frame takes the PR counter
   (`git_merge`) from the SAME read, instead of a second query. The queues
   stay separate, each with its own badge — nothing is summed (RN-467).
2. **Each card decides through the session the action ITSELF carries.** In the
   Aprovações tab, approve, deny, "sempre permitir" and the batch call the endpoint with
   `action.sessionId`, and invalidate the project queue by prefix and the actions of the
   action's session. The tab's PR and gate blocks read events and actions of the current EXECUTION
   session (RN-139), and only without it of the most recent one.
3. **Pending items from other sessions appear in any state.** The chat
   block also shows in closed and technical sessions — deciding is about the action of the
   OTHER session, not conversation in this one (RN-581 keeps refusing conversation) —, and the
   Executores tab gets the SAME block for the execution session: the chat's
   `container_start` becomes visible where the block appears.
4. **The proposal arrives through the channel, without waiting for the poll.** Every
   `proposed_action.*`/`action.*` notice from any session channel a screen listens to
   also invalidates the project queue (`pendenciasDoProjeto` in
   `criarInvalidadorDoCanal`, 2s window), and `dev.blocked_by_container`
   too — the proposal that unblocks it is born in another session, whose channel nobody
   there listens to (AT-299). No poll went up.
5. **The block fits in the column and shows all of them (AT-318).** At the width of the thread and the
   composer (780px), collapsible, with the PRESENCE of each queue in the header —
   "Aprovações 3 · Merges de PR 1", each with its own number, never the
   sum (RN-467) — visible even when collapsed. Cards are born with the detail
   CLOSED (`detalheRecolhido` in `ApprovalCard`): open, they covered ~60% of the thread
   and left one card in view out of three. The origin label shows ONCE per
   session, with the time of the oldest — per card, it repeated between one card
   and the next. The ceiling of 20 cards and the declared cut (RN-180) remain.

**What this rule does NOT close:** the notice only arrives where there is a screen listening to a
session channel (Sessão; Visão geral, the most recent session; Executores, the
execution one). In a tab without a channel (Aprovações, PRs, Backlog…) or for a proposal
made in a session whose channel no open screen listens to, the counter arrives through the
project poll, within 15s; opening a session channel in the frame would change the
session lifecycle (the channel is RN-064's heartbeat) and was left out. The
Aprovações counter still counts the pending `git_merge`, as before —
the panel dedupes it into the PR queue. The gap of the WORKSPACE role in
place of the effective one (RN-471) applies to the new Executores block as it does to
the chat's.

- **Code:** `apps/web/src/routes/ProjectPage.tsx:82` (the counter),
  `:121` (the merges from the same read);
  `apps/web/src/routes/ProjectApprovalsTab.tsx:111` (`pendentesQuery`), `:115`
  (`sessaoDeTrabalho`), `:322` (`handleApprove`);
  `apps/web/src/routes/ProjectOverviewTab.tsx:114` (`pendentesDoProjeto`);
  `apps/web/src/routes/ProjectExecutorsTab.tsx:107` (`pendentesQuery`), `:290`
  (the block); `apps/web/src/routes/code/CodeShell.tsx:101` (`pendentesQuery`);
  `apps/web/src/routes/SessionPage.tsx:782` (the block without `isActive`);
  `apps/web/src/lib/canal-vivo.ts:134` (`alvosDoEvento`), `:180`
  (the key by prefix); `apps/web/src/components/PendenciasDeOutrasSessoes.tsx`
  (`porSessao`, `presenca`); `apps/web/src/components/ApprovalCard.tsx`
  (`detalheRecolhido`); `apps/web/src/lib/hooks.ts:455`
  (`useProjectPendingActions`); `apps/web/src/lib/precisa-de-voce.ts`
  (`acoesPendentes`)
- **Test:** `apps/web/src/routes/ProjectApprovalsTab.test.tsx` (the execution's
  pending one with a newer ideation, decided through its own session; a decided one does not
  enter — contrast); `apps/web/src/routes/project-tabs.test.tsx` (the badges
  from the project queue); `apps/web/src/routes/ProjectExecutorsTab.test.tsx`
  (the chat's `container_start` in the execution tab; the execution's own
  pending one does not become a block — contrast);
  `apps/web/src/routes/SessionPage.sessao-encerrada.test.tsx` (the block in
  `closed` and `closed_abnormally`; the session's own one does not enter);
  `apps/web/src/lib/acoes-da-sessao.test.ts` (the channel invalidates the project
  queue by prefix and with a window; `tool.call` does not);
  `apps/web/src/components/PendenciasDeOutrasSessoes.test.tsx` (three cards in
  view with the detail closed and per-queue presence without a sum; collapsed, the
  presence stays in the header; one origin label per session);
  `apps/web/src/routes/duas-abas.orcamento.test.tsx` (the burst invalidates the project
  queue in the Executores tab, within RN-632's budget)
- **Origin:** AT-297, AT-298, AT-299 (HS-076), AT-318 (visual audit of 09/30)

## Following live without hammering (RN-639)

### RN-639 — What changes per token does not re-render the screen, and what follows the bootstrap polls at 3 s and stops at the end {#rn-639}

Three screens did work nobody saw (AT-301/AT-302). The Session screen
re-rendered ENTIRELY on every token of a turn — the in-progress text lived in
the state of the hook it called. The provisioning and adoption screens polled
the bootstrap status and the technical session's events at 1 s, and the events never
stopped, even with the repository ready. And `/status` hit forever a
service that did not respond.

1. **The in-progress text lives in an external store.** The consultative chat text and the
   turn's activity strip stay in a per-session store
   (`criarStoreDoStreaming`), subscribed via `useSyncExternalStore` only by the two
   components that draw them — the thread bubble and the strip. The page subscribes to ONE
   boolean question (has the turn shown content yet?), which is what the
   "thinking" timer ([RN-131](#rn-131)) needs and which changes once per turn. The
   strip's reducer is the same; what changed is who holds the state.
2. **The bootstrap is followed at 3 s.** Status and events, on both screens.
3. **And it stops at the end.** Status and events stop when the bootstrap converges
   (`provisioned`) and when the query errors (`pollQueParaNoErro`). FAILURE
   (`provision_failed`) is terminal in adoption and NOT in provisioning: there
   "Tentar novamente" triggers a new bootstrap and the screen needs to see its
   progress ([RN-477](api.md#rn-477)).
4. **`/status` stops on error.** A service that responds — including with 5xx, which
   becomes `status: 'error'` in a resolved body — continues every 5 s. A service that
   does not respond stops being asked by timer; window focus and
   remount ask again, and the first success resumes the pace.

- **Where:** `apps/web/src/lib/streaming-do-turno.ts:48` (`criarStoreDoStreaming`),
  `apps/web/src/lib/streaming-do-turno.ts:98` (`useSemConteudoNoTurno`),
  `apps/web/src/lib/poll-do-bootstrap.ts:33` (`pollDoBootstrap`),
  `apps/web/src/lib/poll-do-bootstrap.ts:47` (`bootstrapTerminou`),
  `apps/web/src/routes/ProvisioningPage.tsx:41` (`acompanharBootstrap`),
  `apps/web/src/routes/StatusPage.tsx:78` (`pollQueParaNoErro`)
- **Test:** `apps/web/src/routes/SessionPage.streaming-isolado.test.tsx` (twenty
  tokens after the first do not re-render the page; the end of the turn
  re-renders), `apps/web/src/lib/streaming-do-turno.test.ts`,
  `apps/web/src/lib/poll-do-bootstrap.test.ts`,
  `apps/web/src/routes/StatusPage.test.tsx`
- **Origin:** AT-301, AT-302

## Deciding in the chat, where the owner is (RN-626)

### RN-640 — The neutral palette closes the contrast debt, and UI color only comes from a token {#rn-640}

The dark theme stops being petrol blue and becomes neutral black with a soft
terracotta accent; the light one becomes the neutral of the same family (ADR 0181). The mechanism
of [RN-184](#rn-184) does not change — the pairs are
measured in both themes, with the same floor —; what changes is what is demanded:

1. **The dark theme's debt became a floor.** The five pairs that RN-184 left
   locked by number (3.89 / 3.10 / 3.88 / 3.88 / 4.41) pass 4.5:1 in both
   themes, and the test rejects whoever brings them back down — it no longer "records".
   The final value came from MEASUREMENT: the draft's `--text-muted` (`#71717a`)
   repeated the debt and was refused (`#86868f` in dark, `#696972` in light), and
   muted stays BELOW `--text-secondary` on the three surfaces, which the
   test also demands.
2. **Text over a solid brand/state background passes AA.** The dark theme's `--on-accent`
   is the neutral black (5.61:1 over the accent, 7.25:1 on hover, 7.65:1
   over `--success`, 5.24:1 over `--danger`); the "known exception" of the primary
   button ceases to exist, and the accent's hue stays terracotta (10°–30°)
   in both themes.
3. **UI color only comes from a token.** Whatever paints through a runtime library (Mermaid,
   xterm, minimap) reads the active theme's token and, without it, falls back to the default of
   `TOKENS_PADRAO` — a copy of `:root` that the test checks against
   `design/tokens.css`. Agent color is always `var(--token)`; the three agents
   without a semantic one have `--agent-*` per theme, measured at 3:1. And no CSS module
   uses a `var(--x)` that nobody declares.

- **Where:** `design/tokens.css:118`, `design/tokens.css:126`,
  `apps/web/src/lib/tokens-padrao.ts:50` (`lerTokenDoTema`),
  `apps/web/src/lib/agents.ts:90`
- **Test:** `apps/web/src/lib/contraste.test.ts` ("a antiga dívida de
  contraste agora é piso"), `apps/web/src/design-contraste.test.ts`,
  `apps/web/test/design-contraste.test.ts` ("o botão primário — a exceção que
  deixou de existir"), `apps/web/src/lib/tokens-padrao.test.ts`,
  `apps/web/src/lib/agents.test.ts` ("cor de agente vem do design system"),
  `apps/web/src/design-tokens-existentes.test.ts`
- **ADR:** [0181](../adr/0181-tema-preto-neutro.md)
- **Origin:** AT-283, AT-284

## Following live without hammering (RN-639)

### RN-643 — Below 768px the sidebar becomes a drawer and the project rail becomes a horizontal bar; the page never scrolls sideways {#rn-643}

The visual audit of Round 29 (AT-290, finding S1) measured that the product had
no mobile layout after login: at 390px the sidebar (264px) and the project
rail (180px) remained FIXED, adding up to 444px of frame, and the content was left
with 0 to 126px or overflowed to the right. Configurações reached 114 truncated
texts (`validacao-visual.js`).

**The rule:**

1. **One cut, one source.** The breakpoint is `CONSULTA_MOVEL`
   (`(max-width: 767px)`), read by `useLayoutMovel`. Whoever switches layout reads
   that hook and applies the mobile design through a CLASS; the CSS modules have no
   `@media` of their own for it. That way what the JS decides and what the CSS draws
   do not diverge at a boundary pixel, and the component test (jsdom, without
   CSS) proves the same cut the browser applies. Without `matchMedia` the
   layout is the DESKTOP one: mobile only applies when the query asserts it.
2. **The sidebar becomes a drawer.** A bar at the top carries the menu button
   (`aria-expanded`, `aria-controls`) and the brand. The drawer is a modal dialog
   (`role="dialog"`, `aria-modal`): on opening, focus enters it; Tab does not
   leave; Esc, the X and the backdrop close it and return focus to the menu button.
   It also closes on following any link inside it (the project tabs
   only change `?tab=`) and when the route changes from outside. In the drawer the sidebar
   always appears EXPANDED, and the "Recolher menu" button disappears: manual collapse
   ([RN-195](#rn-195)) is a desktop preference, it stays recorded and applies again
   when the window crosses the cut back.
3. **The project rail becomes a horizontal bar.** They are the same 12 leaves, in the
   same order, with the group headers inline and
   `aria-orientation="horizontal"`. The arrows that move are left and
   right, and the active tab is scrolled into the visible strip. The bar scrolls
   INSIDE; the page does not scroll sideways. The project body becomes a column (the
   bar above the panel), and the Visão geral stacks the team and the activity instead
   of keeping the 360px rail beside them.

**Measured** (390×844, dark theme, api seed, `validacao-visual.js` injected):
the document's `scrollWidth` = 390 on all authenticated screens (dashboard, the
12 tabs, `/containers`, `/account`), and `<main>` with the whole 390px. In
Configurações, `texto-cortado` dropped from 114 to 33. The rest is component
text (tables and section labels), a matter of typography and space, not
of frame. The `fora-da-viewport` left over in Visão geral and Aprovações are
tabs of the horizontal bar beyond the edge, where internal scrolling reaches them.

**Revised by [ADR 0211](../adr/0211-uma-navegacao-so-a-sidebar-absorve-o-trilho.md)
(AT-404):** item 3 no longer applies — the project rail left, and with it the
horizontal bar. On the phone the project tabs live in the DRAWER (item 2), with
the groups, the active one and the counters; choosing one closes the drawer. The project
body no longer becomes a column: only the paddings shrink.

**What this rule does NOT close:** the Código tab keeps the 48px rail of
`CodeShell` and the editor in columns; it was not designed for the phone. The
Session screen inherits the new frame, but the top bar and the thread still have
findings X1–X3 of the audit. The duplication of tab navigation (drawer and
bar) closed in ADR 0211.

- **Code:** `apps/web/src/lib/layout-movel.ts:18` (`CONSULTA_MOVEL`),
  `:39` (`useLayoutMovel`); `apps/web/src/routes/Shell.tsx:422`
  (`movel`), `:443` (`prenderFoco`), `:462` (`fecharAoSeguirLink`);
  `apps/web/src/routes/ProjectPage.tsx:49` (`movel`);
  `apps/web/src/routes/ProjectOverviewTab.tsx:68` (`movel`)
- **Test:** `apps/web/src/routes/Shell.test.tsx` ("Shell — layout móvel
  (RN-643)": the drawer opens with focus inside and Esc closes it returning focus;
  closes through the link, the X, the backdrop and the route change; ignores the recorded
  collapse; crossing the cut goes back to the fixed sidebar; and the failure case, without
  `matchMedia` there is no menu nor dialog);
  `apps/web/src/routes/Shell.test.tsx` ("no telefone as abas estão na gaveta,
  e escolher uma fecha a gaveta (RN-643)") and
  `apps/web/src/routes/AbasDoProjeto.test.tsx` ("no telefone continua
  VERTICAL"), since ADR 0211, over the mock
  `apps/web/src/test/match-media.ts`
- **Origin:** AT-316 (finding S1 of AT-290); does not change ADR 0126, only gives the
  rail a form for narrow screens

## Deciding in the chat, where the owner is (RN-626)

### RN-644 — The thread cuts by MESSAGE, never splits an exchange and collapses the history in the order it happened {#rn-644}

The visual survey of Round 29 (finding X3, AT-319) measured three defects in the
thread cut of [RN-177](#rn-177), all in the same
function: (1) the "last 5" counted **entries**, and the handoff, approval
and story cards counted as one message each — in a short conversation,
the first question and the first answer went to the collapsed history; (2) the
cut fell where the count said, possibly leaving the question collapsed and the
answer open; (3) the history was grouped **by origin**, in the order of the
origins, and the "LLM" group came before "Usuário" — expanded, the Criativo's
answer appeared ABOVE the question that generated it.

**The rule, in the thread (the log panel does NOT change — there the axis is the layer):**

1. **The cut counts MESSAGES**: `chat.message`, `agent.response` and
   `chat.structured_question` (`TimelineEntry.mensagem`). Cards and dividers do not
   count; those that come after the cut stay open with the messages around them.
   A per-agent collapse ([RN-138](#rn-138)) and a "Passos do turno" are still
   ONE entry, and count as one message.
2. **The cut never splits a turn** ([RN-172](#rn-172)): it backs up to the
   opening of the turn of the message that marked it, so the question always stays
   together with the answer. That is why the open ones may exceed five — never an
   exchange in half. The prologue (turn `0`) has no opening and does not back up; if
   backing up reaches the start, there is no history.
3. **The history is ONE block, in chronological order**, and DECLARES the cut
   ([RN-180](#rn-180)): the title says what the cut counts ("Antes das últimas 5
   mensagens") and the `trailing` separates what stayed inside ("2 mensagens · 2
   outras entradas"). The "LLM" label leaves the thread along with the per-origin groups.

**What was lost, declared:** reopening only what the user said, without reopening the
rest, was the reason for the per-origin groups in the thread. It does not survive chronological
order — the log panel keeps offering that cut.

- **Code:** `apps/web/src/routes/session-fio.tsx:119` (`FIO_RECENTES_ABERTAS`),
  `:291` (`dividirFio`), `:141` (`entradaSimples`);
  `apps/web/src/lib/session-timeline.ts:67` (`mensagem`);
  `apps/web/src/routes/session-timeline-montagem.tsx:389`, `:426`, `:673` (the
  three messages); `apps/web/src/routes/SessionFio.tsx:139` (the single block)
- **Test:** `apps/web/src/routes/session-fio.test.ts` (cards do not count, the
  cut backs up to the opening, thread order, and the failure case of a turn larger
  than the cut); `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  (describe "RN-177/RN-644": the measured case with interleaved cards, and the
  expanded history in order)
- **Origin:** AT-319, finding X3 of the "before" visual survey of Round 29

## Following live without hammering (RN-639)

### RN-645 — Configuration is not fetched again on every mount, does not poll, and the Configurações tab has three frame strips, not four {#rn-645}

The visual survey of Round 29 (finding G1, AT-321) went through the Configurações
sections in ~40s and the project's whole page turned into "Limite de
requisições excedido" — the 300 req/min ceiling is the USER's
([RN-579](engine.md#rn-579)). The script RELOADED the page per section, and one load of the
tab cost 55 requests. Measured with the real screens, the defect had
three parts, and none of them calls for raising the ceiling:

**The rule:**

1. **CONFIGURATION data is valid for one minute** (`FRESCOR_DA_CONFIGURACAO_MS`). With
   TanStack's `staleTime: 0`, every observer that MOUNTS after the first one
   refetches. The sections only mount after the project arrives, so
   `GET /projects/:id`, `GET /projects/:id/git/repository` and `GET /workspaces`
   went out TWICE on every load; and switching tabs and coming back remounted the 19
   sections and redid 31 fetches. Configuration only changes by MUTATION, and every
   mutation of the tab invalidates its own key — invalidating ignores `staleTime`,
   so whoever saves sees the new value immediately. What the minute delays is a change
   made by ANOTHER person, which still arrives on window focus and on the next
   mount after the minute. **Operational state stays out** (container
   lifecycle, spend per agent and per key, device keys with
   `lastUsedAt`, bootstrap plan): there the question is "what is up
   now".
2. **Configuration does not poll.** The proficiency profile and the instruction
   version history polled at 15s — 8 req/min against the ceiling for two
   lists that only change through their own section (which invalidates) or through an approved
   patch.
3. **The summary LIES DOWN above the sections, at any width.** As a
   `sticky` column next to them it was the fourth vertical strip (sidebar 264 +
   rail 180 + summary 208): at 1440px ~740px of content remained and the models
   table cut the agent name at 79px and the model's at 91px (finding
   G2). The column had no way to pay its own price even on a wide monitor,
   because `.body` has a ceiling of 1040px (ADR 0078). Laid down, it gives the 208px
   back to the sections; the price is what the narrow window already paid — one loses the
   "where am I" STUCK to the screen, not the navigation. No token changed.

**Numbers** (`configuracoes.orcamento.test.tsx`, `Shell` + `ProjectPage` on the
Configurações tab over a `fetch` that counts per route; `dev` → this rule):

| Scenario | Before | After |
|---|---|---|
| tab load (2.5s) | 53 | 50 |
| one minute idle on the tab | 76 | 68 |
| Configurações → Visão geral → back (configuration fetches) | 31 | 0 |
| tab load, with the resolved bindings in a BATCH ([RN-654](api.md#rn-654), AT-334) | 49 | 30 |

The "After" of the first three rows were measured on the same base as the
"Before"; integrated into `dev` with [RN-638](#rn-638) (the frame reads the project
queue only once), the load stood at 49 and the minute at 64. The fourth row is
[RN-654](api.md#rn-654), measured on `dev` at 94e5dc721d: the 20 bindings
resolved per key became ONE read, and the test holds the load at 30 and the
minute at 64.

**What this rule does NOT close:** until [RN-654](api.md#rn-654), 20 of the load's
requests were the RESOLVED binding of each agent (17) and of each area (3), one route
per key (`GET projects/:projectId/agent-bindings/:agentSlug`) — that part
closed with the BATCH route. RELOADING the page per section, as the survey
script did, still costs 30 per load (~10 loads per minute before the
ceiling); navigating through the summary INSIDE the tab remounts nothing and costs zero. The 68 of the
minute all come from the FRAME (the `Shell` polls `projects-summary` and
`execution/session` at 5s and the execution session's events at 3s), common to
every tab — the same gap that [RN-632](#rn-632) declares.

- **Code:** `apps/web/src/lib/query-policy.ts:111`
  (`FRESCOR_DA_CONFIGURACAO_MS`); `apps/web/src/lib/hooks.ts:29`
  (`useCurrentWorkspaceWithRole`), `:535` (`useProficiency`);
  `apps/web/src/routes/settings/InstructionVersionsSection.tsx:31`
  (`instruction-versions`, without poll); the sections of `apps/web/src/routes/settings/`
  and `apps/web/src/components/ModelCatalogSection.tsx`;
  `apps/web/src/routes/settings/sumario.module.css:36` (`.layout`, the strip)
- **Test:** `apps/web/src/routes/configuracoes.orcamento.test.tsx` (the load
  fetches each resource once; one minute without a configuration poll; switching
  tabs and coming back without configuration fetches — all three fail on `dev` — and the
  failure case: invalidating fetches immediately, and once the minute has passed coming back fetches
  again)
- **Origin:** AT-321 (findings G1 and G2 of the visual survey of Round 29;
  extension of [RN-579](engine.md#rn-579) and [RN-632](#rn-632))

## Deciding in the chat, where the owner is (RN-626)

### RN-646 — A block and an inert control state the reason of WHOEVER is on screen: the PRs tab speaks of the PR list, and Parar/Remover without a container say there is no container {#rn-646}

Two screens showed a correct state with the text of another place (AT-323,
AT-324 — findings P1 and K1/K2 of the visual survey of Round 29).

**The PRs tab and the image gate.** The block is REAL and stays: the PR list and
the diff go through the SAME funnel as the Código tab (`ReadProjectCodeUseCase.alvo` →
`portaoDoContainer`), so without a decided image (RN-105, in all three modes by
[RN-494](broker.md#rn-494)) the api responds 409 there too — measured, not assumed. What
was wrong was the text: the PRs tab showed "A aba Code ainda não está
liberada", speaking of ANOTHER tab and with a name ("Code") that is not the rail's
("Código"). Now `ContainerImageGateNotice` receives the blocked SURFACE
(`'code' | 'prs'`), the PRs tab says "A lista de PRs ainda não está liberada" and
explains that it reads the repository through the same path as the Código tab; and the tab
names in the text come from `nav:tabs.*.label`, the SAME source as the rail — never a
literal, which is how "Code" and "Código" diverged. The PRs tab note does NOT
promise to unlock on its own: the Código tab asks for the state and revalidates, the PR
list only discovers the 409 when the query fails.

**`/containers` without a container.** Parar and Remover were already `disabled` with
`registrado: null` ([RN-521](api.md#rn-521), "never provisioned") and with `removed`,
but nothing said why, and the `danger` variant of `Button` had no disabled
state — "Remover" came out in solid red, the same as the active one. Now the row
states the reason ONCE in text (`Nunca provisionado: não há container para
parar nem remover.` / `Container removido: …`), and `.danger:disabled` gets the
same opacity as the other variants. A row with a running container gets no
text at all.

**The long reason for the missing broker.** The text that names `BROKER_URL` was
nine lines long and tripled the height of the table row. The cell now shows ONE
short sentence in a `<summary>`, and the long text (which still names the variable,
for the operator) opens on demand in the `<details>` — native and keyboard
accessible, never a `title` on a disabled button (ADR 0064). When the SAME missing
broker blocks start AND stop/remove, it is ONE line only ("subir, parar e remover
só terminariam em falha"), with both details behind the same `<details>`.

- **Code:** `apps/web/src/components/ContainerImageGate.tsx:33`
  (`ContainerImageGateNotice`), `:42` (`bloco`);
  `apps/web/src/routes/ProjectPrsTab.tsx:157` (`superficie="prs"`);
  `apps/web/src/routes/ContainersPage.tsx:261` (`semContainer`), `:276`
  (`chaveCurtaDoBroker`); `apps/web/src/components/ui/Button.module.css:101`
  (`.danger:disabled`)
- **Test:** `apps/web/src/routes/ProjectPrsTab.test.tsx` ("409 do portão vira
  o estado dedicado, com o texto da aba PRs e não o da aba Código", "409 no
  diff aberto por id também usa o texto da aba PRs", and the failure case: 500
  stays a banner with "Tentar de novo"); `apps/web/src/routes/ProjectCodeTab.test.tsx`
  and `apps/web/src/routes/code/CodeDiffPanel.test.tsx` (the Código tab says
  "Código"); `apps/web/src/routes/ContainersPage.test.tsx`, block "Parar/Remover
  sem container e o motivo curto (AT-324)" (never provisioned, removed, the
  failure case "container de pé: nenhum motivo", the closed `<details>` with
  `BROKER_URL` only inside it, and the single line when the broker blocks all three)
- **Origin:** AT-323, AT-324. Does not change the gate of RN-105/RN-494 (the PR
  list stays blocked without a decided image — whether it SHOULD escape the gate is
  the owner's decision), nor the start yardstick of RN-521/RN-574.

### RN-648 — The sidebar, the Dashboard card and the artifacts panel do not contradict each other: each empty state says WHICH session it read, and counter and list count in the same unit {#rn-648}

Three screens asserted "nothing" next to a screen that showed something (AT-325 —
findings S2/D2/X6 of the visual survey of AT-290). Reproduction with the real
engine was not possible in this environment (egress blocks `repo.hex.pm` and
Alpine, and no image compiles); the three contradictions were MEASURED in the
code and proven by tests that fail before the fix. The Dashboard one
was born, in the survey, from a 500 of the engine stub in the workspace summary —
but the text that turned it into "no activity" is the web's, and with the real engine
any summary failure would produce the same.

**The sidebar read the EXECUTION session, and only it.** The Atividades block
(RN-198) requested the events of the current execution session
(`useActiveExecutionSession`). In a project with only conversation sessions it is
`null`, the list came back empty, and the sidebar said "Nenhum agente entrou em ação
ainda" next to a Visão geral with the Criativo waiting. Now: with a current
execution, the sidebar keeps reading IT (the dev agents and the `-2`
instances are what the grouping of RN-198 exists to show, and the `queryKey` is
the Executores tab's); WITHOUT execution, it reads the SAME session as the Visão geral and the
Dashboard card — the most recent working one (`useLatestSession`, the rule of
`sessaoMaisRecente`). The states that collapsed into the same text separate
([RN-470](#rn-470)): loading (nothing is asserted), error (its own text),
project without a session ("Este projeto ainda não tem sessão."), and the session read without
an agent, with the text NAMING which one ("…na sessão de execução…" /
"…na sessão mais recente…"). The session list is only requested without execution, and with
the freshness of a project cycle (`frescorMs` in `useProjectSessions`): when
the sidebar enables it the project frame has already brought it, and the request
budget of [RN-632](#rn-632)/[RN-645](#rn-645) does not grow.

**The Dashboard card had one text for four states.** "Sem atividade
ainda" came out with the workspace summary LOADING, with it FAILED (the survey's
case: the summary responded 500 and the card of a project with sixteen
events said there were none), with the project WITHOUT a session and with the most
recent session empty. Now there are four texts: "carregando atividade…",
"atividade indisponível", "Nenhuma sessão ainda" and "Sem atividade na sessão
mais recente ainda". The row still reads the most recent working session
(`latestSessionId`), the same as the Visão geral and the sidebar without execution — the api
did not change.

**"Artefatos gerados 3" over a single group "PO 1".** The section header
counted the backlog TREE (epic, story and task: 3) and the per-agent group
counted only the ROOTS (1). Both now count in the same unit — each item
carries `quantos` (1, plus the descendants when it is a backlog root), the
header is the sum of the items and each group is the sum of its own, so the sum of the
groups IS the header, by construction. And the section's empty state says what it counts
("Nenhuma PR nem item de backlog nesta sessão ainda.") instead of the generic "Nada ainda.",
which next to a brief or a rule of the same session seemed to deny
they existed — the section's scope (PR and backlog, [RN-159](#rn-159)) does not
change.

- **Code:** `apps/web/src/routes/Shell.tsx:579` (`execucao`), `:587`
  (`origemDaAtividade`), `:594` (`estadoDaAtividade`);
  `apps/web/src/lib/hooks.ts:127` (`useProjectSessions`, `frescorMs`);
  `apps/web/src/routes/Dashboard.tsx:75` (`lastActivityText`);
  `apps/web/src/routes/ContextAside.tsx:46` (`quantos`), `:340`
  (`totalDeArtefatos`)
- **Test:** `apps/web/src/routes/Shell.test.tsx` ("Shell — Atividades": without
  execution it reads the Visão geral's session and the Criativo appears; with execution it reads the
  execution one and the empty state says which; project without a session; and the failure case, the
  session list that fails becomes a named error and never "nenhum agente");
  `apps/web/src/routes/Dashboard.test.tsx` ("Dashboard — linha de atividade do
  card (RN-648)": the failed summary says "indisponível", loading does not assert,
  no session × empty session have different texts, and with an event no empty state
  appears); `apps/web/src/routes/SessionPage.artefatos-gerados.test.tsx` (the
  sum of the groups is the header; the empty state says what it counts);
  `apps/web/src/routes/configuracoes.orcamento.test.tsx` and
  `apps/web/src/routes/duas-abas.orcamento.test.tsx` stay within the ceilings
- **Origin:** AT-325 (findings S2/D2/X6 of AT-290). Does not change the scope of
  [RN-159](#rn-159) nor the workspace summary ([RN-090](api.md#rn-090)); extends
  [RN-198](api.md#rn-198) (which session the sidebar reads) and applies [RN-470](#rn-470)

## Following live without hammering (RN-639)

### RN-651 — On the phone, the Session panel is a drawer, the bar wraps, and the table becomes cards {#rn-651}

The "after" visual audit of Round 29
(`docs/explanation/auditoria-visual-rodada-29.md`, findings N1 and N3 to N8) measured,
at 390px, what [RN-643](#rn-643) had not reached: in the Session the
"Contexto da sessão" panel kept ~320px and left ~70px to the thread (one word per
line), and the bar pushed "Iniciar ideação" and "Encerrar" past the edge; in
`/containers` seven fractional columns overlapped the headers and cut the
actions; in "Modelos por agente" the agent name had 6px and the selector 0px;
`/status` scrolled sideways (413px); the Dashboard search became "Bus"; the
session name in the Criativo's list had 0px; and the mobile rail left the active tab
cut off, with no sign that it scrolled.

**The rule** (the cut is the same `useLayoutMovel` of [RN-643](#rn-643), and the
design comes through a CLASS or attribute that the component sets, never through `@media`):

1. **The Session context panel is born CLOSED on the phone** and opens as a
   DRAWER over the thread, from the right: a modal dialog with the panel's name, focus
   on the X on opening, Esc, X and backdrop close it and return focus to whoever opened it. On
   desktop it is born open next to the thread, as always. Crossing the cut goes back
   to the new side's default — a panel open on desktop does not reappear
   squeezing the thread on the phone. The exception is navigation that COMES to the panel
   (`highlightEvent`, the Psicólogo's evidence chip): then it is born open
   on the phone too.
2. **The Session bar wraps, never cuts.** Exit, state, title and the
   panel toggle stay on the first line; type, settings, "Iniciar
   ideação" and "Encerrar" go down, and go down again if needed. What the bar
   shows is still decided by its width ([RN-620](#rn-620) item 6).
3. **Every `Table` becomes a stack of cards on the phone.** Each row is a card
   and each cell carries the column label next to the value; the header disappears.
   A column without a label, or marked `largaNoMovel` (a selector, a block of
   actions), takes the card's width with the label on top.
4. **The page does not scroll sideways, and what identifies the row does not vanish.**
   `/status` scrolls the table inside its own wrapper; the Dashboard search
   gets a full line; the session list row wraps with the name
   on top, whole.
5. **The mobile rail follows the active tab and says it scrolls.** The active one is brought
   into the strip on mount, on switch, when the rail's CONTENT changes (the
   counters arrive later and widen the earlier tabs) and when the fonts
   finish loading — never on every render, otherwise whoever scrolled the strip by hand
   would be pulled back. The edge that hides tabs fades
   (`data-rola-inicio`/`data-rola-fim`).

**Measured** (390×844, both themes, native api with the seed, `validacao-visual.js`
injected): `scrollWidth` 390 on all seven screens; zero `texto-cortado` on the
Dashboard, the Criativo's list, the Session (with and without the drawer),
`/containers` and `/status`; in Configurações the 33 dropped to zero, and the
rail's active tab stayed whole within the strip on the three tabs measured.

**What this rule does NOT close:** in the minimal bar "Encerrar" still has only the
icon and the accessible name ([RN-620](#rn-620) decides that by the bar's
width). The panel toggle moves up to the title line only in PAINTING
(`order`): the Tab order follows the DOM's. The `fora-da-viewport` that the
checker still reports in Configurações and Aprovações are decorative icons with
`position: absolute` inside controls below the fold, not something cut off.

- **Code:** `apps/web/src/lib/painel-de-contexto.ts:16`
  (`usePainelDeContexto`); `apps/web/src/routes/GavetaDoContexto.tsx:14`
  (`GavetaDoContexto`); `apps/web/src/routes/SessionTopbar.tsx:126`
  (`movel`); `apps/web/src/components/ui/Table.tsx:13` (`largaNoMovel`),
  `:28` (`movel`); `apps/web/src/routes/Dashboard.tsx:165` (`movel`);
  `apps/web/src/routes/ProjectSessionsTab.tsx:149` (`movel`)
- **Test:** `apps/web/src/routes/SessionPage.layout-movel.test.tsx` (the drawer
  is born closed, opens with focus on the X and Esc closes it returning focus; X and
  backdrop close; the bar wraps before the actions; and the failure case, on desktop the
  panel stays beside the thread without drawer or wrap; crossing the cut closes the
  panel); `apps/web/src/components/ui/Table.test.tsx` ("layout estreito");
  `apps/web/src/routes/ContainersPage.test.tsx`,
  `apps/web/src/routes/settings/modelos-por-agente-no-movel.test.tsx`,
  `apps/web/src/routes/StatusPage.test.tsx`,
  `apps/web/src/routes/Dashboard.test.tsx`,
  `apps/web/src/routes/ProjectSessionsTab.test.tsx` (each with mobile and the
  failure case of the desktop or of the strip that fits). The project tab strip
  (`ProjectRail`, finding N8) left in
  [ADR 0211](../adr/0211-uma-navegacao-so-a-sidebar-absorve-o-trilho.md): the tabs
  live in the drawer
- **Origin:** AT-328 (finding N1) and AT-330 (findings N3 to N8) of the visual
  audit of Round 29; completes [RN-643](#rn-643)

## The author of each utterance in the thread is the event's actor (RN-652)

### RN-652 — `chat.message` is drawn under the event's ACTOR — person, agent or unknown —, never under whoever is viewing the screen {#rn-652}

Until now every `chat.message` came out with the name and avatar of whoever was logged in:
in a shared session, another person's utterance appeared with YOUR name, and
an agent's with your e-mail (finding N2 of the visual audit of Round 29,
hidden while the thread grouped the history by origin). The author now comes from the
event's `actor`, which the api records with the sender's id
(`SendAgentMessageUseCase`, `SendChatMessageUseCase`) and which the generic
append-event route accepts of any kind. The outcomes do not collapse:

1. **The viewer** (`actor.id` equal to the token's `sub`; without it, by the e-mail of the
   member row) — the name or e-mail of the member row, otherwise the session's
   e-mail, and only in the absence of both "Você".
2. **Another person the screen can name** — their name, otherwise the e-mail, from
   TWO reads composed into a single list (`comporMembros`), the PROJECT one before
   the WORKSPACE one: `GET projects/:id/members` (minimum `viewer`), under the SAME
   `queryKey` as the Configurações tab, and since AT-335
   `GET workspaces/:id/members` ([RN-655](api.md#rn-655)), of the PROJECT's workspace.
   Whoever has both rows appears once, through the project one — the same order as the
   role overlay ([RN-471](#rn-471)).
3. **Another person the screen CANNOT name** — "Outro membro": without a
   project or workspace row (someone who left the workspace and still has utterances in the log),
   or both reads failed or have not arrived yet. The read that fails does not
   erase the other, and neither of them breaks the thread. Until AT-335 this was the declared
   GAP of whoever joins only through the workspace role, which had no read
   route; the route was born by owner decision.
4. **Agent** — `nomeDoAgente` and the agent's avatar/color, like `agent.response`.
5. **Unknown actor** (absent, without id, `system` or a kind outside
   person/agent) — "Autor desconhecido", never "Você".

The `backlog.story_promotion_returned` narration, which had the same defect
(the viewer's name over whoever returned the story), goes through the same function.
The composer's OPTIMISTIC message keeps the viewer's e-mail — it is
always theirs.

- **Code:** `apps/web/src/lib/autor-da-mensagem.ts:52` (`autorDaMensagem`);
  `apps/web/src/lib/autoria-da-sessao.ts:45` (`useAutoriaDaSessao`), `:18`
  (`comporMembros`);
  `apps/web/src/routes/session-timeline-montagem.tsx:154` (`rotuloDoAutor`),
  `:405` (the `chat.message`), `:687` (the story return);
  `apps/web/src/routes/SessionPage.tsx:133` (`autoria`)
- **Test:** `apps/web/src/routes/SessionPage.autor-da-mensagem.test.tsx:147`
  (two people and one agent, each message under its own author — happy
  path), `:168` (unknown actor and person outside the members with its own
  text — failure case), `:186` (whoever joins only through the workspace role is
  named — AT-335), `:205` (the refused workspace read does not erase the
  project's), `:219` (refused member read);
  `apps/web/src/lib/autoria-da-sessao.test.ts:15` (the project row before the
  workspace one), `:22` (failure of one read does not erase the other);
  `apps/web/src/lib/autor-da-mensagem.test.ts:58` (absent actor, without id or of an
  unknown kind never becomes "você")
- **Origin:** AT-329 (finding N2 of `docs/explanation/auditoria-visual-rodada-29.md`);
  the workspace list, AT-335

## The policy reason on each Aprovações card (RN-656)

### RN-661 — Auto mode is OFFERED in batch to the team at the start of execution, and the offer says what it does not unlock {#rn-661}

In the Executores tab, with execution active and the execution team on screen, a card
offers to switch on auto mode (RN-153) for the team's agents at once
(AT-315). It is ONE control, and it is an offer: the agents not yet in
auto come checked, the person unchecks whoever they do not want, and nothing is recorded without
the click on "Ligar". The click records the SAME wildcard (`agent_autonomy`,
`actionType: "*"`, `auto_approve`) through the SAME endpoint as the per-agent toggle
(`PUT .../agent-autonomy`, `maintainer`) — one PUT per agent, in series, without
aborting on the first refusal, with a PER-agent outcome in the three cases of RN-469
(all, none with the api's sentence, some with who stayed in manual). Switching off
remains in the manual/auto toggle of each agent's card; there is no "switch off in
batch". When all are already in auto, the card disappears.

The card STATES, before the click, what auto mode does NOT unlock — the absolute
ceilings still ask for approval (RN-154, RN-418): merge into a protected branch;
`git push`, opening a PR and deploy; `sudo`/`doas`; `container_remove`;
`instruction_patch`; parallelizing or raising the parallelism ceiling. Without
`maintainer` the control stays inert and the reason is stated in text; the role read is
the WORKSPACE one, with the same declared gap as the other auto mode
screens (RN-471).

- **Code:** `apps/web/src/components/ModoAutomaticoDoTime.tsx:73`
  (`ModoAutomaticoDoTime`), `:109` (`ligar`), `:44`
  (`agentesEmModoAutomatico`); `apps/web/src/routes/ProjectExecutorsTab.tsx:89`
  (`podeLigarModoAutomatico`), `:308` (where the offer mounts)
- **Test:** `apps/web/src/components/ModoAutomaticoDoTime.test.tsx:54` (nothing
  recorded on mount; the click records the wildcard for each chosen one — happy
  path), `:85` (the api refuses one agent and the outcome names who stayed in
  manual — failure case), `:74` (what it does not unlock), `:102` (without
  `maintainer`), `:108` (all in auto, nothing to offer)
- **Origin:** AT-315 (AT-309 survey, "Modo automático" line)

## The runner flow through the browser is retired (RN-687, ADR 0203)

### RN-687 — The runner panel sends to the installer; the browser does not generate a key, does not download a binary and does not write a folder {#rn-687}

The flow of [ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)
([RN-464](api.md#rn-464)..[466](runner.md#rn-466)) was RETIRED by owner decision
(10/01, `BRB-031`): it was the only installation path that ended in a
manual `chmod +x`, and `install.sh` already does its three things on the right side —
it downloads the binary checked against the signed `checksums.txt` and installs it with
`install -m 0755` ([RN-531](produto.md#rn-531)), and creates the key ON THE MACHINE and registers it
([RN-547](produto.md#rn-547), [RN-551](runner.md#rn-551), [RN-552](api.md#rn-552)).

**The rule:**

1. **The `RunnerOnboardingPanel` shows the installer command**
   (`curl -fsSLO …/install.sh && bash install.sh`, the SAME sentence as the runbook and
   `install.sh`, [RN-526](produto.md#rn-526)), copyable, with what it does stated in
   text, the caveat that it serves the installation's machine, and the
   `EsperaDoRunner` ([RN-474](#rn-474)) below. The command in the web is a COPY,
   and the copy is checked against the installer's constant.
2. **Once an active key that serves the project is recognized** — machine
   ([RN-548](#rn-548)) or project (AT-107) —, the installer block LEAVES and the
   gesture is checking the service. The manual command with a PAT (`--token`) always stays
   in the `<details>`, named as the path for ANOTHER machine.
3. **There is no button to configure a folder, to download files, nor a platform
   selector**, and the web no longer calls Web Crypto, File System Access nor the
   binary proxy. `runner-bootstrap.ts` was removed entirely.
4. **The api no longer has `POST /projects/:projectId/runner-device-keys`.** It
   was left without a caller. `GET` and `DELETE` stay (list and revoke); the internal
   machine route (`POST /internal/machine-device-keys`) stays.
5. **An ALREADY registered project key remains valid and revocable**: nothing in the
   database changes, `PatAuthGuard` keeps accepting it ([RN-465](api.md#rn-465)) and the CLI
   keeps reading the configured folder ([RN-466](runner.md#rn-466)). A runner configured
   through the browser before ADR 0203 does not break.

Left out, declared: an installation with a TEAM loses the PAT-less path to
pair a second machine (the machine key route is 409 with two or more
people), and now uses the manual command; `GET /runner-releases/binary` is left
without a production consumer and was NOT removed — that is a separate decision.

- **Where:** `apps/web/src/components/RunnerOnboardingPanel.tsx:68`
  (`COMANDO_DO_INSTALADOR`), `:124` (`RunnerOnboardingPanel`);
  `apps/api/src/interfaces/http/runner/runner-device-keys.controller.ts:75`
  (`RunnerDeviceKeysController`), `:96` (`listDeviceKeys`), `:119`
  (`revokeDeviceKey`); `apps/api/src/interfaces/http/auth/pat-auth.guard.ts:152`
  (`autenticarChaveDeDispositivo`)
- **Test:** `apps/web/src/components/RunnerOnboardingPanel.test.tsx:91`
  (happy path: the installer command, copied, and the wait), `:119` (the
  browser flow is gone: none of its buttons, no `chmod`), `:134` (failure
  case: a refused clipboard does not break the screen), `:211` (active machine key:
  the installer leaves); `apps/api/test/interfaces/http/runner/runner-device-keys.controller.spec.ts:43`
  (there is no `POST` handler); `apps/api/test/interfaces/pat-auth.guard.spec.ts:345`
  (project key still accepted); `scripts/dev/install-invocacao.spec.ts:162`
  (the panel's command is the installer's sentence);
  `scripts/ci/alvos-do-runner.spec.ts:70` (the browser's target list does not
  come back)
- **Architectural decision:** [ADR 0203](../adr/0203-aposenta-o-fluxo-do-runner-pelo-navegador.md)
- **Origin:** AT-014 (`BRB-031`), owner decision on 10/01

## The RN-418 ceiling also applies through the typed door (RN-689)

### RN-693 — Activating the agent is not conversation: the opening hint stays in the thread until the first message, and the session's text fields do not invite autofill {#rn-693}

Measured in the real use of v7.0.0: "Iniciar ideação" records `agent.activated` (and
`agent.status`), the Criativo only speaks after the first message, and the invitation
— with the hint "Comece contando o que você quer construir…" — vanished on the click,
because the question "has the conversation started?" was `events.length > 0`. The thread stayed
empty for ~25 s.

**The rule:** agent LIFECYCLE events (`agent.activated`,
`agent.status`) do not count as conversation. Any other event still
counts, so the invitation does not cover the git-bootstrap session nor the execution
one ([RN-131](#rn-131)). With the Criativo active and no message, the invitation
stays without the "Iniciar ideação" button and with the hint; the first message removes it.

And the composer and the text fields of the structured questions carry
`autocomplete="off"` and the attributes password managers respect
(`data-1p-ignore`, `data-lpignore="true"`, `data-bwignore`,
`data-form-type="other"`): each focus opened the browser's autofill popup.

- **Where:** `apps/web/src/lib/conversa-comecou.ts:15` (`conversaComecou`),
  `:29` (`SEM_AUTOFILL`); `apps/web/src/routes/SessionPage.tsx:436`
  (`conversaComecou`); `apps/web/src/routes/SessionComposer.tsx:389`
  (`SEM_AUTOFILL`); `apps/web/src/routes/StructuredQuestionCard.tsx:206`
  (`SEM_AUTOFILL`)
- **Test:** `apps/web/src/routes/SessionPage.sessao.test.tsx:316` (Criativo
  activated without a message keeps the hint; with a message it vanishes — failure case;
  composer attributes); `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx:201`
  (attributes of the question fields)
- **Origin:** AT-353

### RN-694 — The model catalog has search, the credential offers the sync, and the first model goes to the team in one click {#rn-694}

Three shortcuts over actions that already existed, no new endpoint (AT-357):

1. **Search.** The catalog has a search field that matches the display name, the
   `name` or the `id` of the model, case-insensitively. With a term, every
   hub group and subgroup with a result opens by itself; a search with no result STATES
   that nothing matched, with the term — never a mute empty list.
2. **Sync next to the credential.** The credential card whose provider has a key
   and NO model in the catalog says so and offers "Atualizar catálogo" — the
   SAME action as the catalog (`POST .../models/sync`). The button only appears for
   `owner` (the endpoint's minimum, RN-102); reading the catalog requires `maintainer`.
   The predicate is ONE, `providersSemCatalogo`, also used by the catalog's
   notice.
3. **Activate and apply to the team.** When NO model is active and ONE is
   checked, the batch bar offers "Ativar e aplicar aos N agentes": it activates
   (`POST .../models/activate`) and, if activation passed, applies it to each agent
   through the same path as RN-476, with its overwrite notice and the partial
   report of RN-469. A refused activation applies nothing. Only with the click, never
   on its own, and only for `owner` (the higher of the two minimums); below that the
   control stays inert and the reason is stated in text. Curation stays manual
   (ADR 0042).

- **Where:** `apps/web/src/lib/models.ts:244` (`casaComBusca`),
  `apps/web/src/lib/models.ts:425` (`providersSemCatalogo`),
  `apps/web/src/lib/models.ts:441` (`algumModeloAtivo`),
  `apps/web/src/components/ModelCatalogSection.tsx:333` (`ativarEAplicarAoTime`),
  `apps/web/src/routes/settings/CredentialsSection.tsx:128` (`handleSync`)
- **Test:** `apps/web/src/components/catalogo-com-busca.test.tsx`
  (search by id and with no result; activate and apply, partial, refused activation,
  below owner, with a model already active; sync on the card, with and without a catalog, and the
  failure)
- **Origin:** AT-357

## The installer offers the local models, and does not mistake dev for an installation (RN-691, RN-692)

### RN-701 — The context panel does not assert "0" about rules that left the window {#rn-701}

The "Contexto da sessão" panel reads the events already downloaded (RN-180). In a session
with more events than the window, the business rules emitted at the start fall
BEFORE it, and the counter said **0** with "Nada ainda." — asserting about what
it did not read (measured in the 268-event session of 10/02: 5 rules became 0). With
events prior to the window, the counter now says "N na janela · há mais
antes" and the empty section says there are none IN THE LOADED EVENTS. No
new read: the number of earlier ones still comes from subtraction over the
`seq`.

The other half of AT-365 — the already executed approval card asking for a
decision again — was NOT fixed here: the thread card already decides by the ACTION's
`status` (`ApprovalCard`, `isPending`), and the actions read is the tail plus the
pending ones (RN-637); the defect does not reproduce through the web code.

Measurement (10/02, in the AT-015 environment): `GET .../actions?latest=true` of
session 17d41c20 returns both `open_adr_pr` as `executed`, and reloading the
session (with the collapsed blocks opened) shows no "Aprovar". The
pending card only appeared DURING the live session — a transient state of the
screen, not of the api nor of the window. The next AT-015 round captures the network at the
moment it appears, before any fix.

- **Where:** `apps/web/src/routes/ContextAside.tsx:393` (`trailing`), `:415`
  (`nadaNaJanela`)
- **Test:** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  ("RN-701 (AT-365): com as regras fora da janela, o contador não afirma 0";
  the avoided failure case is the "alcançando o começo da sessão" next to it)
- **Origin:** AT-365

### RN-708 — A new project states the next step, derived from what is already read {#rn-708}

The Visão geral of a freshly created project did not say what to do: with no
provider key, no model and no session, nothing on screen pointed the way, and the
credential and the catalog lived at the end of Configurações (measured in the real test
of 10/02, fresh installation). Since AT-372 the Visão geral opens with the
"Primeiros passos" card, with THREE steps, each with the link to the exact place:

- **credential** — the account has at least one LLM credential (the same
  `['credentials']` read as the Credenciais section, with configuration
  freshness and no poll, RN-645). The Visão geral did not make that read, and its
  load has a budget: it only runs when the team still has no model;
  with a resolved model, the step counts as covered;
- **model** — the Criativo's resolved binding is not null (the batch of RN-654,
  the same `queryKey` as Configurações);
- **ideation** — the project has at least one session (the list the page already
  polls).

No new route. An input not read yet (or with an error) is "I don't know" (RN-470), and
the card does NOT appear while there is one — asserting "credential missing" without having
read it would be the screen lying. With all three done, it disappears. Along with it, the
Configurações tab now opens on the models group, with the credential in front,
and the summary follows the order.

- **Where:** `apps/web/src/lib/primeiros-passos.ts:37` (`derivarPrimeirosPassos`),
  `apps/web/src/components/PrimeirosPassos.tsx:22` (`PrimeirosPassos`)
- **Test:** `apps/web/src/lib/primeiros-passos.test.ts` (happy path and "insumo
  não lido não vira pendente") and `apps/web/src/routes/ProjectOverviewTab.test.tsx`
  ("primeiros passos (RN-708, AT-372)")
- **Origin:** AT-372

### RN-709 — The card uses the right verb tense, the ceiling does not offer "sempre permitir", and the plan states how much it costs and only starts agents with tasks {#rn-709}

Measured in the test project of 10/02. Four defects of the same decision
card, closed together:

- **The verb follows the action's state (AT-371).** The pending PR card said
  "abriu pull request (de ADR)" before opening. `VERBO_DA_ACAO` speaks of the
  PROPOSAL ("quer abrir pull request…") and `VERBO_DA_ACAO_EXECUTADA` gives the verb
  of what already happened, only for the types whose tense changes; `verboDaAcao` receives the
  `status` and is the single source.
- **ADR and infra PRs are an RN-418 ceiling (AT-371).** `open_adr_pr` and
  `open_infra_pr` enter `TIPOS_SEM_SEMPRE_PERMITIR` (api and the web copy,
  checked by test), like `pr_open` — "sempre permitir" refuses to record the
  pattern and the card offers neither the button nor "Modo automático". Outside the
  terminal, the notes no longer speak of a command ("npm test", "roda qualquer
  comando"): the typed type has its own note.
- **The plan shows the estimate (AT-381).** On proposing `propose_execution_plan`
  the api adds to the payload `orcamentoPorTarefaMicros` — the CURRENT per-task
  budget, the same one activation uses (project setting or the default
  of US$ 0.50) —, and the card's sentence says "até US$ X (N tarefas × US$ Y) — é o
  teto por tarefa, não o preço". No new route.
- **A module without tasks gets no agent (AT-381).** Applying the plan passes to
  the activation the modules with ≥ 1 task (`modulosDoPlano`); those of the `module_map`
  without tasks stay out and are stated in the result (`modulosSemTarefa`), next to
  `tarefasPorModulo`. The "Ativar execução" button (without a plan) and a plan
  without `tarefas` still start the whole map. The computed summary reaches the
  Dev Lead in the tool result text (`resumo_do_plano/1`), so he can
  cite the numbers instead of recounting.

- **Where:** `apps/web/src/lib/aprovacoes.ts:428` (`verboDaAcao`),
  `apps/api/src/domain/actions/sempre-permitir.ts:33` (`TIPOS_SEM_SEMPRE_PERMITIR`),
  `apps/api/src/application/use-cases/actions/propose-action.use-case.ts:84` (`execute`),
  `apps/api/src/application/use-cases/execution/execute-execution-plan.use-case.ts:89` (`execute`),
  `apps/api/src/application/use-cases/execution/activate-execution.use-case.ts:123` (`execute`),
  `apps/engine/lib/engine/agents/dev_lead_tools.ex:587` (`resumo_do_plano`)
- **Test:** `apps/web/src/lib/aprovacoes.test.ts` ("AT-371 — o verbo segue o
  estado da ação", "AT-381 — o plano mostra a estimativa de gasto"),
  `apps/web/src/components/ApprovalCard.test.tsx` ("open_adr_pr pendente"),
  `apps/api/test/domain/actions/sempre-permitir.spec.ts`,
  `apps/api/test/application/use-cases/execution/activate-execution.use-case.spec.ts`
  ("módulos do plano"), `apps/api/test/application/use-cases/execution/execute-execution-plan.use-case.spec.ts`,
  `apps/engine/test/engine/agents/dev_lead_tools_test.exs` (`resumo_do_plano/1`)
- **Origin:** AT-371, AT-381

### RN-712 — The session thread shows what just happened, once and legibly {#rn-712}

Measured in the real test of 10/02 (`loja-teste`): the turn strip showed
raw Markdown, the structured form's answer appeared twice, the
manual handoff selector offered Dev Lead, QA and Infra from the first
minute of ideation, the "Para" stayed on the PO with the Arquiteto already working, the
"Iniciar ideação" button reappeared mid-session and an 80-line docker-compose
pushed the conversation off screen. Since AT-375:

- **turn strip** — the preview and the expanded lines go through
  `textoPlanoDoMarkdown`: `**`, `##`, rules, tables and backticks become running
  text. The strip is a preview; the rendered answer is still the bubble at the
  end of the turn (RN-460), and the streaming store does not change (RN-639);
- **answered form** — the api resends the answers to the agent as the user's
  `chat.message`; the bubble whose text is EXACTLY what the api assembles
  (`"<n>. <rótulo>: <resposta>"`), the first user message after the
  answer, leaves the thread, because the answered card already shows them. A typed
  message that merely looks like a list stays;
- **recipient** — the choice made in the composer's SELECTOR is manual and is never
  overwritten. One that came from a gesture (accepting a handoff on this screen, "Estou
  pronto") follows the target of the last ACCEPTED handoff, including one accepted by the
  system (RN-660). It revises the RN-631 clause that an acceptance through another
  path "only adds the option" — only for a choice that was not manual. With no
  choice at all and two options, sending stays locked;
- **manual handoff** — the selector is born collapsed behind a button; the list of
  agents did not change;
- **"Iniciar ideação"** — disappears from the header as soon as some agent has joined the
  session (agent event or handoff);
- **header** — the time becomes "iniciada às HH:MM:SS", and the language origin
  wraps into up to two lines before ellipsizing, with the full text in `title`;
- **code block** — above 20 lines it is born collapsed to the first 8,
  with "Mostrar as N linhas".

Left out, measured: the Criativo's first "modelo não registrado" bubble comes
from the ENGINE — `criativo_server.ex` records the accumulated text with a null `modelName`
when the turn ends by delivering a form (`gravar_texto_do_turno(state,
"", nil)`), not from the screen.

- **Where:** `apps/web/src/lib/texto-plano.ts:7` (`textoPlanoDoMarkdown`),
  `apps/web/src/lib/eco-de-formulario.ts:17` (`ecosDeRespostaEstruturada`),
  `apps/web/src/lib/session-destinatario.ts:237` (`resolverDestinatario`),
  `apps/web/src/components/ui/MarkdownMessage.tsx:74` (`CodeFence`)
- **Test:** `apps/web/src/lib/texto-plano.test.ts`,
  `apps/web/src/lib/eco-de-formulario.test.ts`,
  `apps/web/src/lib/session-destinatario.test.ts` ("RN-712"),
  `apps/web/src/components/ui/MarkdownMessage.test.tsx` ("RN-712")
- **Origin:** AT-375

## One cache key, one question (RN-718)

### RN-718 — Whoever writes a session's actions into the cache makes the SAME read as the thread {#rn-718}

`['session-actions', projectId, sessionId]` is ONE TanStack Query cache entry,
and the Sessões tab wrote into it the result of another question: the FIRST
ascending page (`listActions({ limit: 200 })`, without `latest`), while the
Session thread reads the tail of the 200 newest plus the pending ones it pushed out
([RN-637](api.md#rn-637)). The two screens swapped each other's cut — after
opening the tab, the thread could draw the session's 200 OLDEST actions, the
defect RN-637 closed, reopened through the cache door (AT-365).

**The rule:** key and function go together, in `consultaDasAcoesDaSessao`
(`apps/web/src/lib/acoes-da-sessao.ts`). Whoever READS a session's actions to
put them in the cache uses that pair — `usePendingActions` and the per-session summary of the
Sessões tab. A key of its own for the tab was considered and discarded: it would stop the cache
swap, but keep the tab summarizing the wrong cut. With the same read, the
summary gains — a long session's new pending one now counts in
"aguardando". Whoever only INVALIDATES the key (decision on the approval screens, the live
channel) still writes the list by hand: invalidating writes no data.

- **Where:** `apps/web/src/lib/acoes-da-sessao.ts:76` (`chaveDasAcoesDaSessao`),
  `:80` (`consultaDasAcoesDaSessao`); `apps/web/src/lib/hooks.ts:432`
  (`usePendingActions`); `apps/web/src/routes/ProjectSessionsTab.tsx:270`
  (`acoesPorSessao`)
- **Test:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` (describe "a
  leitura de ações é a mesma do fio": with the thread having written the tail, mounting the
  tab leaves tail + pending in the cache and no call without `latest` — fails
  on the old code, which wrote the 200 oldest; and the pending one pushed
  out of the tail counts in "aguardando")
- **Declared gap:** the card of an action whose `proposed_action.created`
  left the 200-event window still JUMPS to the top of the thread
  (`ordemDaAcaoNaTimeline` degrades to `createdAt` and anchors at 0.5) — locked
  as current behavior in
  `apps/web/src/routes/SessionPage.acao-fora-da-janela.test.tsx`, whose
  fix is a separate decision. The same test proves that the decided card does not
  ask for a decision again: what seemed to "come back" in AT-365 was ANOTHER action.
- **Origin:** AT-365

## The Anamnese does not pay twice for the same window, and gate rescue does not restart a cycle that waits for someone (RN-722)

### RN-728 — The user's message has a single bubble, and the Dev Lead card has a single primary {#rn-728}

- **Rule:** (1) the OPTIMISTIC bubble of the message sent to an agent leaves the thread
  as soon as the `chat.message` with the `mensagemId` the api returned on acceptance
  is in the log — matching by id, never by text, and without waiting for the end of the
  turn; its name comes from the SAME `autorDaMensagem` as the log bubble
  ([RN-652](#rn-652)), with the token's e-mail only as a fallback. Before, the two
  coexisted during the turn, one with the name and the other with the e-mail. (2) On the card
  "passou o bastão ao Dev Lead", accepting the handoff is the primary gesture and
  "Ativar execução" is SECONDARY, with the notice of what it skips: without a plan, the devs
  pick up the tasks as they are ([RN-677](api.md#rn-677)).
- **Where:** `apps/web/src/lib/mensagem-otimista.ts:14` (`otimistaJaNoLog`),
  `apps/web/src/lib/mensagem-otimista.ts:22` (`nomeDaMensagemOtimista`),
  `apps/web/src/routes/SessionPage.tsx:790` (`otimistaJaNoLog`),
  `apps/web/src/routes/session-timeline-montagem.tsx:609`
  (`handleActivateExecution`)
- **Test:** `apps/web/src/lib/mensagem-otimista.test.ts` (happy: the id in the log
  removes the optimistic one; failure: an absent id or one of another type keeps it; the name is the
  member row's), `apps/web/src/routes/SessionPage.cancelar-turno.test.tsx`
  ("com o turno em curso, a otimista sai quando o chat.message do aceite chega
  ao log"),
  `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`
  ("o aceite é o primário; "Ativar execução" é secundário e diz o que pula")
- **Origin:** AT-409 and AT-410 (TP-01 of 10/03); the card's shape is the
  owner's decision ("Secundário com aviso")

### RN-736 — The "Nome do projeto" field does not get focus on its own nor is it called "name" {#rn-736}

- **Rule:** in the details step of the project wizard, the "Nome do
  projeto" field does NOT receive `autoFocus` and uses `id`/`name` `project-title` (since RN-834, `projeto-slug`), never
  plain "name"; the attributes that switch off password managers
  (`data-1p-ignore`, `data-lpignore`, `data-bwignore`, `data-form-type="other"`)
  still come from the single source `SEM_AUTOFILL` (RN-729). Decision: no
  automatic focus in any case (not even by keyboard) — those extensions' "Contact Info" menu
  opens on FOCUS, ignores `autocomplete="off"` and covered the page; one more
  click or Tab is the price. The attribute names are those publicly documented
  by 1Password, LastPass, Bitwarden and Dashlane, not measured
  against each extension here.
- **Where:** `apps/web/src/routes/NewProjectWizard.tsx:746` (`projeto-slug`),
  `apps/web/src/lib/conversa-comecou.ts:29` (`SEM_AUTOFILL`)
- **Test:** `apps/web/src/routes/NewProjectWizard.test.tsx` ("RN-736: o campo
  de nome não ganha foco sozinho nem se chama \"name\"" and the RN-729 one, which
  checks the four attributes)
- **Origin:** AT-418 (TP-01, 2nd round of 10/03)

### RN-740 — The "Nome do projeto" field declares that it suggests nothing, and the rest of the gap is the extension's {#rn-740}

- **Rule:** `SEM_AUTOFILL` adds `aria-autocomplete="none"` (the accessibility
  tree says the field offers no suggestion) and `data-protonpass-ignore`
  (the attribute Proton Pass documents). The visible label and the accessible
  name stay "Nome do projeto": changing only the `aria-label` would break
  "label in name" (WCAG 2.5.3), and changing the visible label is a product
  decision, not taken. Measured in TP-01 of 10/03: the "Contact Info" menu opens on
  focus/typing even with the RN-736 attributes — the extension probably
  classifies by the label TEXT. If the next TP-01 reproduces it with these
  attributes, the gap is the EXTENSION's and stays declared here.
- **Where:** `apps/web/src/lib/conversa-comecou.ts:29` (`SEM_AUTOFILL`)
- **Test:** `apps/web/src/routes/NewProjectWizard.test.tsx` ("RN-740: …")
- **Origin:** AT-425 (TP-01, 3rd round of 10/03)

### RN-747 — The Dev Lead's plan says how many dev agents start, not how many it asks for {#rn-747}

- **Rule:** approving `propose_execution_plan` activates execution (RN-677), and the
  activation starts ONE dev agent per module; the plan's per-module `agentes` is a
  recommendation. The approval card says "sobe N dev agent(s), um por
  módulo" and, when the plan asks for more than that, that the extra agents only start
  if the user accepts parallelizing later — parallelizing is an RN-154 ceiling and
  is never auto-approved nor bundled into the plan approval. The tool result
  that goes back to the Dev Lead says the same, and the description of `agentes`
  asks not to promise a parallelism gain. The model's quote marks at the ends of the
  summary are removed before the sentence cites it, so no `coberto."` is left over.
- **Where:** `apps/web/src/lib/aprovacoes.ts:317` (`propose_execution_plan`),
  `apps/engine/lib/engine/agents/dev_lead_tools.ex:254` (`sobem`), `:245`
  (`classificar`), `:97` (`spec`)
- **Test:** `apps/web/src/lib/aprovacoes.test.ts` ("plano com 2 agentes num
  módulo único diz que sobe 1…"; "plano sem agente a mais não fala de
  paralelizar"), `apps/engine/test/engine/agents/dev_lead_tools_test.exs`
  ("agente a mais no plano é dito como NÃO subindo")
- **Origin:** AT-437 (10/08: the approved plan promised "2 agentes no módulo
  único… ~40% de ganho" and execution started 1 dev)

### RN-748 — Waiting for approval closes the turn strip and brings the card into view {#rn-748}

- **Rule:** when the agent suspends the turn waiting for human approval
  (`agent.status: awaiting_approval`, today the Dev Lead in
  `propose_execution_plan`, RN-284), the Session screen treats that as END of
  turn also through the CHANNEL — not only through the log read (`turnoTerminouNoLog`,
  which already did): the activity strip leaves, and with it "Pôr na fila" and
  "Parar". And, when a NEW wait appears in the log (the `seq` of the most recent wait
  changes after opening), the thread scrolls to the end WITHOUT the
  120px guard of RN-173, because the approval card is what the person needs to see.
  Reopening the session with an old wait scrolls nothing beyond the usual
  opening.
- **Where:** `apps/web/src/lib/session-channel.ts:232` (`awaiting_approval`),
  `apps/web/src/lib/session-turno.ts:418` (`awaiting_approval`),
  `apps/web/src/lib/session-rolagem.ts:30` (`seqDaEsperaPorAprovacao`),
  `:141` (`esperaPorAprovacao`)
- **Test:** `apps/web/src/lib/session-channel.test.ts` (`onAgentStatus repassa
  awaiting_approval (RN-748)`), `apps/web/src/lib/session-rolagem.test.ts`
  (`seqDaEsperaPorAprovacao (RN-748)`: most recent wait; without a wait, `null`)
- **Origin:** AT-432 (TP-01: the Dev Lead in `awaiting_approval` with the
  "Montando o plano de execução" strip active and the card out of view)

### RN-749 — An answer cut by the ceiling offers continuation in one click {#rn-749}

- **Rule:** the agent bubble whose closing ends with the line the engine
  appends to an answer cut by the output ceiling (RN-737, in both languages)
  shows, with the session active, the "Continuar de onde parou" button. The click sends
  to the SAME agent the text "Continue de onde parou." (in the interface language)
  through the same send as the composer — with a turn in progress, it enters its queue
  (RN-673) —, and the draft the person is writing is not touched. Only the
  closing has the button; the turn steps do not. The screen recognizes the line by the
  text, and the two sentences are the contract with `Engine.Harness.RespostaCortada`.
- **Where:** `apps/web/src/lib/resposta-cortada.ts:14` (`respostaCortada`),
  `apps/web/src/routes/session-timeline-montagem.tsx:889` (`respostaCortada`),
  `apps/web/src/routes/SessionPage.tsx:447` (`continuarRespostaCortada`),
  `:686` (`enviarMensagem`)
- **Test:** `apps/web/src/lib/resposta-cortada.test.ts` (`respostaCortada
  (RN-749)`: both lines recognized; a whole answer and the sentence in the middle of the
  text are not)
- **Origin:** AT-434 (TP-01: the cut answer offered no action, and the user
  had to guess "continue")

### RN-750 — The per-agent collapse leaves each agent's closing open {#rn-750}

- **Rule:** the per-agent message collapse after it passes the baton
  (RN-138) never folds that agent's LAST message in the thread — the closing,
  which in the handoff is the summary the person just read. What came
  before it in the same sequence is folded, and only with two or more entries (a single one
  does not become a header, RN-138's usual yardstick). Earlier sequences of the
  same agent, separated by another utterance, collapse as before. The thread's cut
  (RN-644) does not change: it runs over the already grouped list.
- **Where:** `apps/web/src/routes/session-fio.tsx:155` (`fechoDeCadaAgente`),
  `:181` (`fechoPorAgente`), `:190` (`indiceDoFecho`)
- **Test:** `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`
  (`duas mensagens consecutivas do PO colapsam...`: two folded and the closing
  open; `RN-750: com duas mensagens, o fecho fica aberto e a outra, sozinha,
  não vira grupo`)
- **Origin:** AT-435 (TP-01: at handoff the thread folded the Criativo's whole
  answer, "Criativo · 2 mensagens", hiding the summary)

### RN-751 — The Session and the catalog do not jump: composer, active tab, batch bar and scrolling {#rn-751}

- **Rule:** four layout fixes, each a screen rule.
  (1) The composer does not squeeze the field during the turn: the buttons do not shrink
  nor wrap text, and move down a line when they do not fit. (2) Without the project
  frame mounted, the tab the sidebar marks is the one the ROUTE implies — on the Session
  screen, Chat —, and only outside that the default. (3) The model catalog's batch
  action bar OVERLAYS the list, pinned to the bottom of the window, and the section
  gets breathing room at the end while it is open; inserted in the flow, it
  pushed the list and the checkbox ran away from the cursor. (4) The thread "follows the end"
  (RN-173) also when the person WAS at the end before the height changed — the
  intent is measured on the scroll gesture, and a clamped scroll with content
  smaller than the window does not change it. The 120px guard remains: whoever scrolled
  up is not dragged. The cause of the top on accepting the Infra's handoff was not
  reproduced in the browser; the fix covers the class (content that shrinks and
  comes back).
- **Where:** `apps/web/src/routes/project-tabs.ts:383` (`abaDaRota`),
  `apps/web/src/routes/Shell.tsx:510` (`abaDaRota`),
  `apps/web/src/lib/session-rolagem.ts:16` (`estaPertoDoFim`), `:82`
  (`estavaNoFimRef`), `:120` (`aoRolarOFio`),
  `apps/web/src/components/ModelCatalogSection.module.css` (`.barraDeLote`),
  `apps/web/src/routes/SessionPage.module.css` (`.composer`)
- **Test:** `apps/web/src/lib/session-rolagem-fim.test.ts` (`estaPertoDoFim`
  and `abaDaRota`: happy path and failure), `apps/web/src/routes/Shell.test.tsx`
  (`sem a moldura montada (ex.: tela de Sessão)`: Chat marked),
  `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx` (`não arrasta
  quem rolou pra cima`)
- **Origin:** AT-442 (TP-01, visual survey)

### RN-755 — Switching on auto mode does not approve the card where it was switched on {#rn-755}

- **Rule:** in the `ApprovalCard` (the same on the four surfaces), the
  "Modo automático" button records the agent's wildcard (RN-153) and does NOT decide the
  card's own action: it stays pending, with "Aprovar" as the main action.
  Wherever the button appears, a note appears with it saying so before the click ("Ligar o
  modo automático não aprova esta ação: ela continua esperando o seu
  Aprovar."). Approving the card along with switching on the mode would be the
  owner's decision and was NOT done.
- **Where:** `apps/web/src/components/ApprovalCard.tsx:203` (`ApprovalCard`)
- **Test:** `apps/web/src/components/ApprovalCard.test.tsx` (`ligar o
  "Modo automático" não aprova o card, e o card diz isso`; without the button, the note
  does not appear)
- **Origin:** AT-443 (TP-01: the mode switched on in a pending card did not
  approve it, and nothing on screen said why)

### RN-766 — The gate stopped waiting for a click is stated, and the batch offer covers the QA subagents {#rn-766}

- **Rule:** in the "needs you" panel ([RN-467](#rn-467)), the pending action
  proposed by a GATE agent (QA area — `qa`, `qa-*` — or SecOps) gets,
  above the SAME `ApprovalCard`, the sentence that that gate is STOPPED until the
  decision; it is one sentence per card, never a sum of queues. And the auto mode
  batch offer in the Executores tab ([RN-661](#rn-661)) lists the agents of the
  QA area (`AREAS.qa`) from activation, without waiting for them to appear in the
  roster — before, `qa-automacao` only entered the offer after its first
  event, when the first action was already waiting for a click. The default `allow` of
  `permissions.json` does NOT change (owner decision).
- **Where:** `apps/web/src/lib/precisa-de-voce.ts:256` (`gateEsperandoClique`)
  and `apps/web/src/components/ModoAutomaticoDoTime.tsx:63`
  (`agentesDaOfertaEmLote`)
- **Test:** `apps/web/src/lib/precisa-de-voce.test.ts` (QA and SecOps gates
  named; dev agent and human not) and
  `apps/web/src/components/ModoAutomaticoDoTime.test.tsx` (the offer covers the
  QA subagents before the roster, without repeating)
- **Origin:** AT-449 (TP-01 of 10/09: `qa-automacao` proposed
  `ls; cat; for f in test/*.js…`, a segment outside the `allow`, without auto
  mode, and stayed pending for 25 min with only the Aprovações counter as a
  signal)

### RN-768 — In the PRs tab, the text next to Merge tells the truth about the button {#rn-768}

- **Rule:** a pending gate remains a NOTICE and does not lock the merge
  ([RN-663](api.md#rn-663)). A BLOCKED task (`task.blocked`) is something else and
  disables the button; in that case the PR row does NOT show "o merge segue
  disponível": it says, in text, that the merge is unavailable because the task
  is blocked (naming the pending gate, if any, or the block's
  reason). Without a session in the project, the same: the reason goes in text, never only
  in the `title` of the `disabled` button, which does not open in Chromium. Whether a blocked
  task should or should not lock the merge is the owner's question, not decided here.
- **Where:** `apps/web/src/routes/ProjectPrsTab.tsx:276` (`avisoDaLinha`)
- **Test:** `apps/web/src/routes/ProjectPrsTab.test.tsx` ("AT-451: tarefa
  bloqueada com gate pendente NÃO diz que o merge segue disponível")
- **Origin:** AT-451 (TP-01 of 10/09: "O merge segue disponível — a decisão é
  sua" next to a disabled "Merge")

### RN-769 — Closing a session with active execution asks first, and the state appears translated {#rn-769}

- **Rule:** "Encerrar" in a session with active execution (an
  `execution.activated` event in the window, or a `dev-<modulo>` among the activated ones of the
  whole session — the Dev Lead does not count, he plans before execution) opens
  a confirmation that says what stops: the session's agents stop immediately, the
  running command is cut, the turn in progress is not recorded, and a session with
  execution does not reopen ([RN-650](api.md#rn-650)). Without execution, the click closes
  directly, as before. The closed-session sentence in the composer interpolates the
  TRANSLATED state (`pontoDaSessao(...).rotuloKey`), never the raw enum
  (`closed`). And that is guarded in CODE, not only in the locale: the
  vocabulary yardstick reads the JSONs, and the enum came in through interpolation at runtime;
  `i18n-enum-cru.test.ts` rejects `t(…, { status: x.status })`.
- **Where:** `apps/web/src/routes/ConfirmarEncerramento.tsx:13`
  (`useEncerrarComConfirmacao`) and `apps/web/src/routes/SessionComposer.tsx:473`
  (`statusGenerico`)
- **Test:** `apps/web/src/routes/ConfirmarEncerramento.test.tsx` (without
  execution it closes directly; with execution it only closes on confirming; cancelling does not
  close) and `apps/web/src/lib/i18n-enum-cru.test.ts` (it failed
  `SessionComposer.tsx` before the fix)
- **Origin:** AT-452 (TP-01 of 10/09: "Encerrar" closed the execution session
  in 3 s with the dev agent in the middle of an `npm install`, and the bar said "Sessão
  closed")

### RN-788 — Decisions and the team timeline do not assert about what they did not read {#rn-788}
- **Rule:** in the "Contexto da sessão" panel, "Decisões registradas" follows the
  same declared cut as the rules ([RN-701](#rn-701)): with events before the
  window, the counter says "N na janela · há mais antes" and the empty state says there may
  be decisions in the earlier ones, never "Nenhuma decisão registrada nesta
  sessão". In the Visão geral, the "Linha do tempo do time" reads the EXECUTION session
  when it exists (the same as the sidebar's) and says so in the subtitle when it
  is not the most recent. No extra request: the keys are the ones the
  sidebar already subscribes to, and `useActiveExecutionSession` gets a `staleTime` equal to the
  interval, so the second subscriber does not redo the fetch ([RN-632](#rn-632)).
- **Where:** `apps/web/src/routes/ContextAside.tsx:393` (`trailing`),
  `apps/web/src/routes/ProjectOverviewTab.tsx:86` (`linhaDoTempoNaExecucao`)
- **Test:** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  (a decision outside the window does not become 0; a whole session in the window says empty),
  `apps/web/src/routes/ProjectOverviewTab.test.tsx` (reads the execution session and
  says so; without execution, reads the most recent), `apps/web/src/routes/duas-abas.orcamento.test.tsx`
  (the Visão geral's load stays within the ceiling)
- **Origin:** AT-463 (TP-01 of 10/09)

### RN-789 — On the Session screen, the sidebar marks the tab where the session is listed {#rn-789}

- **Rule:** the Session screen publishes the tab that the session's TYPE implies —
  creative in "Criativo" (the list of ideations), consultative in "Chat" —, and the
  sidebar marks it instead of always "Chat" ([RN-751](#rn-751)); the click leads to the
  list where the session appears, which is the way back to it. A session still
  loading, or a tab published from another project, falls back to "Chat". No new
  read: the type already came with the session.
- **Where:** `apps/web/src/routes/project-tabs.ts:383` (`abaDaRota`),
  `apps/web/src/lib/session-kind.ts:94` (`usePublicarAbaDaSessao`)
- **Test:** `apps/web/src/lib/session-rolagem-fim.test.ts` (creative marks
  "Criativo"; a tab from another project or an invalid one does not count)
- **Origin:** AT-463 (TP-01 of 10/09)

### RN-794 — Without a current execution, the screen says what was left pending and restarts through the same path {#rn-794}

- **Rule:** when the read of the current execution session ([RN-139](api.md#rn-139))
  CONFIRMS there is none and the backlog has a task that is not `done`
  (`todo` — including one returned by the gate —, `in_progress`, `in_review`,
  blocked), the Executores tab and the Execução section of the Visão geral state
  how many there are and offer "Religar execução", which calls the SAME
  `POST .../execution/activate` (`ActivateExecutionUseCase`) as the
  "Ativar execução" button, without `originSessionId` (as the Visão geral always
  called it: there is no chat session for the api to close, [RN-135](api.md#rn-135)). The
  refusal (409 without a repository, consultative session, role) appears with the api's
  sentence. "Desbloquear" without a current execution warns that the task only runs
  when execution is restarted — the button is in the same section. In the
  Executores tab the backlog is only read with the absence confirmed (query switched off
  with execution up, project pace when switched on, [RN-632](#rn-632)).
- **Where:** `apps/web/src/components/ReligarExecucao.tsx:23` (`ReligarExecucao`),
  `apps/web/src/lib/execution.ts:21` (`contarTarefasPendentes`),
  `apps/web/src/routes/ProjectExecutorsTab.tsx:99` (`semExecucaoVigente`),
  `apps/web/src/routes/ProjectOverviewTab.tsx:506` (`semExecucaoVigente`)
- **Test:** `apps/web/src/routes/ProjectExecutorsTab.test.tsx` (restart the
  execution), `apps/web/src/routes/ProjectOverviewTab.test.tsx` (restart the
  closed execution)
- **Origin:** AT-469

### RN-800 — The team timeline filters by family, not by the most recent session's roster {#rn-800}

- **Rule:** the Visão geral's "Linha do tempo do time" tree reads the
  EXECUTION session when there is a current one (AT-463), and takes from it the dev agent
  and QA events by the actor's FAMILY (`isExecutorAgentId`, the same yardstick as the
  Executores tab, RN-121) — never by the roster, which is derived from the most
  recent session. Filtering by the roster erased every agent that only acted in the execution (the
  Infra Lead whose handoff was accepted there), and with an ideation opened afterwards the
  tree said "Nenhum agente entrou em ação nesta sessão ainda" about a team
  working. No new read.
- **Where:** `apps/web/src/routes/ProjectOverviewTab.tsx:267` (`overviewEvents`)
- **Test:** `apps/web/src/routes/ProjectOverviewTab.test.tsx` ("AT-471: agente
  que só agiu na execução aparece na árvore…"; the case without execution keeps reading
  the most recent)
- **Origin:** AT-471 (TP-01 of 10/10)

### RN-801 — The new session's name does not invite the password manager {#rn-801}

- **Rule:** the "Nome (opcional)" field of the new session form (Criativo
  tab and Chat tab) receives the SAME `SEM_AUTOFILL` as the composer and the
  wizard ([RN-736](#rn-736)/[RN-740](#rn-740)): `autocomplete="off"`,
  `aria-autocomplete="none"` and the ignores of 1Password, LastPass, Bitwarden and
  Proton Pass. The Session composer already had it. The constant has NO NordPass
  ignore attribute, and none was invented: if NordPass keeps attaching itself,
  the rest of the gap is the extension's, as in RN-740.
- **Where:** `apps/web/src/routes/ProjectSessionsTab.tsx:319` (`SEM_AUTOFILL`),
  `apps/web/src/lib/conversa-comecou.ts:29` (`SEM_AUTOFILL`)
- **Test:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` ("AT-472: o nome
  da nova ideação não convida o gerenciador de senhas")
- **Origin:** AT-472 (TP-01 of 10/10)

### RN-803 — The auto mode batch offer stays inert until it knows who is already switched on {#rn-803}

- **Rule:** while the project's `agent_autonomy` read has not arrived, the
  "Ligar para N agentes" of the Executores tab ([RN-661](#rn-661)) and the agents'
  checkboxes stay `disabled`, with the reason in text ("Lendo quais agentes já
  estão em modo automático…"); a click in that interval records nothing. Before,
  the list was born with ALL agents as a guess and shrank when the read
  arrived, and the first click after navigating fell on another element without
  recording or saying anything. The batch outcome (all, none with the api's sentence,
  some) is stated even if the reread after the writes fails. Declared:
  the same symptom on the PRs tab's "Merge", on "Nova ideação" and on "Aplicar a
  todos os agentes" was NOT reproduced nor fixed here.
- **Where:** `apps/web/src/components/ModoAutomaticoDoTime.tsx:98` (`carregando`)
- **Test:** `apps/web/src/components/ModoAutomaticoDoTime.test.tsx` ("AT-477
  (RN-803): antes de a leitura de agent_autonomy chegar, o botão fica inerte e
  diz por quê")
- **Origin:** AT-477 (TP-01 of 10/10)

### RN-804 — The Dev Lead's plan card offers auto mode in batch before approving {#rn-804}

- **Rule:** the `ApprovalCard` of a pending `propose_execution_plan` shows,
  above "Aprovar", the SAME batch offer control as the Executores tab
  ([RN-661](#rn-661)): the `dev-<modulo>` the plan starts (same derivation of
  `devAgentId` as the api) plus the gate subagents, all checked, and nothing
  recorded without the click on "Ligar". Same endpoint (`PUT .../agent-autonomy`,
  wildcard `*`), one PUT per agent, per-agent outcome and the same list of what
  auto mode does not unlock. Approving activates execution ([RN-677](api.md#rn-677)) and the
  dev asks for the first command right after; switching on later does not approve the pending one
  ([RN-755](#rn-755)). It only appears where the caller passed the auto mode
  callback (role `maintainer`) and there is a `QueryClient`. The card stays single
  (AT-322): it is one more block of the type, not an appearance variant.
- **Where:** `apps/web/src/components/ApprovalCard.tsx:386`
  (`ModoAutomaticoDoPlano`), `apps/web/src/components/ModoAutomaticoDoPlano.tsx:17`
  (`agentesDoPlano`)
- **Test:** `apps/web/src/components/ApprovalCard.modo-automatico-do-plano.test.tsx`
- **Origin:** AT-476 (TP-01 of 10/10)

### RN-815 — "Parar execução" counts the tasks in progress AND in review, read from the backlog {#rn-815}

- **Rule:** the "Parar execução" confirmation ([RN-763](engine.md#rn-763)) counts the
  tasks from the BACKLOG, read only with the confirmation open, and not from the event
  window: `in_progress` and `in_review` (QA gate running) in separate
  sentences, each saying what happens to it on stopping — the one in progress is
  blocked with the work preserved; the one in review has its gate stopped and is
  blocked with the PR open; both go back to the queue when released. Before, the
  count came from the dev agents with a task in the window, and the task in review (with no
  dev working on it) made the screen assert "Nenhuma tarefa está em curso".
  A backlog loading or with an error is stated in its own text, never as "none".
  Along with it, the Dev Lead's plan card ([RN-804](#rn-804)) opens the batch
  offer with its own text ("Ao aprovar o plano, a execução começa"), because there
  execution has not started yet ([RN-677](api.md#rn-677)).
- **Where:** `apps/web/src/lib/execution.ts:37` (`contarTarefasAfetadasAoParar`),
  `apps/web/src/components/PararExecucao.tsx:26` (`PararExecucao`),
  `apps/web/src/components/ModoAutomaticoDoTime.tsx:73` (`ModoAutomaticoDoTime`)
- **Test:** `apps/web/src/components/PararExecucao.test.tsx` ("RN-815 (AT-488):
  a tarefa em revisão de QA conta…"; "RN-815: sem backlog lido não afirma…"),
  `apps/web/src/components/ModoAutomaticoDoTime.test.tsx` ("RN-816 (AT-488): no
  cartão do plano não afirma que a execução começou")
- **Origin:** AT-488 (TP-01 of 10/10)

### RN-816 — The button does not change place when a late block arrives {#rn-816}

- **Rule:** a block that arrives AFTER the first paint does not stay above the button
  the person is about to click, and what needs to stay above has its space reserved
  while it loads. In the Session the pending items from other sessions
  ([RN-626](#rn-626)) live ABOVE the thread — between the thread and the composer they
  squeezed it from below and, with "follows the end" ([RN-751](#rn-751)), the
  final card ("Aceitar handoff e iniciar…") moved up under the cursor. In the Executores tab
  they come AFTER "Parar execução" and the batch offer. In the PRs tab the Merge
  comes first in the row's column, and the gate pipeline, which depends on the backlog,
  has a reserved height (skeleton) while it loads. Declared: the pipeline's reservation
  is the height of a single-line pipeline of stages, not measured in the
  browser, and jsdom does no layout — the test proves the ORDER and the reservation, not the
  pixel shift.
- **Where:** `apps/web/src/routes/SessionPage.tsx` (`PendenciasDeOutrasSessoes`
  before `styles.messages`), `apps/web/src/routes/ProjectExecutorsTab.tsx`,
  `apps/web/src/routes/ProjectPrsTab.tsx:103` (`ProjectPrsTab`),
  `apps/web/src/routes/ProjectPrsTab.module.css` (`.reservaDaEsteira`)
- **Test:** `apps/web/src/routes/salto-de-layout.test.ts`,
  `apps/web/src/routes/ProjectPrsTab.test.tsx` ("RN-816 (AT-480): o Merge não
  muda de lugar quando o backlog chega")
- **Origin:** AT-480 (TP-01 of 10/10)

### RN-821 — Registered running and observed stopped offers "Subir de novo" {#rn-821}

- **Rule:** on `/containers`, the row with a `running` record and an OBSERVED
  `exited` state stops being "already up" and offers the mode's start
  action (`acaoDeSubidaDoModo`), without requiring Parar first, with the caveat
  `registrado_rodando_observado_parado` in text. Only the observed state unlocks: without an
  observation, or observed `running`, the record still holds. The api already
  accepted it: `ExecuteContainerStartUseCase` with a `running` row transitions
  nothing (ADR 0081's state machine does not change) and the broker does `docker
  start` on the stopped container.
- **Where:** `apps/web/src/routes/containers-subida.ts:125` (`caiuPorFora`)
- **Test:** `apps/web/src/routes/containers-subida.test.ts` ("AT-494:
  registrado running e observado exited oferece subir de novo, com a ressalva"
  and "AT-494: registrado running e observado running (ou não observado) continua
  já de pé")
- **Origin:** AT-494

### RN-822 — The first click on Merge opens the card without waiting for the queue {#rn-822}

- **Rule:** extension of [RN-816](#rn-816). In the PRs tab, the click on "Merge"
  that creates the `git_merge` `proposed_action` shows the decision card with the
  action the api RETURNED, right away, instead of waiting for the project queue
  (`useProjectPendingActions`) to come back. Before, between the proposal's response and the
  queue's refetch, the button came back with no card at all and the person read "the click
  did not register". The local action counts by PR id only while the queue has no
  read NEWER than the proposal (`dataUpdatedAt`); with a newer read,
  the queue says whether it is still pending. Deciding (approve, deny, always
  allow) forgets it. Declared: the cause was measured in the CODE (the card
  depended on the refetch), not in the browser; that the refetch takes long enough for
  the click to seem lost is an inference from TP-01.
- **Where:** `apps/web/src/routes/ProjectPrsTab.tsx:125` (`acaoDaPr`)
- **Test:** `apps/web/src/routes/ProjectPrsTab.test.tsx` ("RN-822 (AT-493):
  o 1º clique em Merge abre o cartão sem esperar a fila do projeto voltar" and
  "RN-822: a fila lida DEPOIS da proposta, sem ela, vence o cartão local")
- **Origin:** AT-493 (TP-01 of 10/10)

### RN-824 — After the module map, the composer says the next step is confirming the architecture {#rn-824}

- **Rule:** the Infra offer is still a HUMAN click ("Confirmar
  arquitetura pronta"); what changes is that the screen NOTIFIES. With the Arquiteto active,
  no turn in progress, his handoff not yet offered and an
  `artifact.module_map` recorded in the session, the composer shows in visible text
  that the architecture can be confirmed for the system to offer the Infra. Without a
  promoted story, the same place states the reason the button is inert, once,
  in text (the `title` of a disabled button does not open in Chromium,
  [RN-102](api.md#rn-102)); the enabled button gets the explanation in its `title`. The
  derivation reads the `events` the screen already has — no new query
  ([RN-579](engine.md#rn-579)).
- **Where:** `apps/web/src/lib/session-readiness.ts:149` (`temMapaDeModulos`),
  `apps/web/src/routes/SessionComposer.tsx:365` (`hasModuleMap`)
- **Test:** `apps/web/src/routes/SessionPage.proximo-passo-arquitetura.test.tsx`
  ("mapa gravado + história promovida + Arquiteto parado: o texto aparece";
  failures: "com o handoff do Arquiteto já oferecido, o texto some", "com turno
  em curso (streaming), o texto não aparece", "sem história promovida, o
  motivo vem em texto visível")
- **Origin:** AT-491 (option a: the human gesture is by design, the defect was the screen
  not notifying)

### RN-825 — The chat shows the PRs ready for merge and proposes the merge there {#rn-825}

- **Rule:** above the session thread, next to the pending items from other sessions
  ([RN-626](#rn-626)), the "PRs prontas para merge" queue lists the project's OPEN PRs
  whose task had its gates approved (`gateStatus: awaiting_user`) or
  that have no task (ADR, infra), and that have no `git_merge` pending from ANOTHER
  session (that one is already in "Merges de PR"). "Mergear" PROPOSES the merge in this
  session, through the same endpoint as the PRs tab, and the approval card appears in the
  PR's row with the action returned by the api ([RN-822](#rn-822)); the merge stays
  manual ([RN-418](api.md#rn-418)). Each queue has its own title and count, never
  summed ([RN-467](#rn-467)), and the reads are the ones the PRs tab and the backlog
  already make (same `queryKey`s, backlog at 15 s), with no new tight poll
  ([RN-579](engine.md#rn-579)).
- **Where:** `apps/web/src/lib/prontas-e-bloqueadas.ts:30` (`prsProntasParaMerge`),
  `apps/web/src/components/PendenciasDeOutrasSessoes.tsx:112` (`prontas`)
- **Test:** `apps/web/src/components/PendenciasDeOutrasSessoes.test.tsx`
  ("a PR com os gates aprovados aparece, a com gate pendente não, e Mergear
  mostra o cartão ali")
- **Origin:** AT-497 (TP-01 conducted through the Criativo's chat)

### RN-826 — The chat lists the blocked tasks and unblocks there {#rn-826}

- **Rule:** in the same area, the "Tarefas bloqueadas" queue lists the backlog's
  `blocked` tasks with title and reason (`blockedReason`, or "sem motivo
  registrado"), and "Desbloquear" calls the same `unblock` as the Visão geral
  ([RN-794](#rn-794)) with the open session. The result is stated on the task's
  row: success in text, and the refusal with the api's sentence. A role below
  `developer` sees the queue with the button inert and the reason in text.
- **Where:** `apps/web/src/lib/prontas-e-bloqueadas.ts:53` (`tarefasBloqueadas`),
  `apps/web/src/components/PendenciasDeOutrasSessoes.tsx:180` (`desbloquear`)
- **Test:** `apps/web/src/components/PendenciasDeOutrasSessoes.test.tsx`
  ("CASO DE FALHA: desbloquear com erro diz o erro da api na linha da tarefa")
- **Origin:** AT-497

### RN-829 — The avatar of whoever speaks in the thread is the agent's, during streaming and after it {#rn-829}

- **Rule:** the agent's streaming bubble and the persisted response bubble
  (`agent.response`) draw the SAME avatar, `AvatarDoAgente`, by the
  agent's id. Before, the in-progress bubble showed the agent's icon and the persisted one the
  model icon, and the avatar switched in front of the person when the turn closed.
  The model that generated the answer stays only in the chip next to the name.
  An agent outside the roster (or without an id) degrades to the generic
  icon, never to an empty box.
- **Where:** `apps/web/src/components/ui/AvatarDoAgente.tsx:22` (`AvatarDoAgente`),
  `apps/web/src/routes/SessionFio.tsx:284` (`BolhaDoStreaming`),
  `apps/web/src/routes/session-timeline-montagem.tsx:120` (`montarTimeline`)
- **Test:** `apps/web/src/routes/SessionFio.at503.test.tsx` ("a bolha
  persistida usa o avatar do agente, não o do modelo; o modelo segue no chip",
  "a bolha em streaming usa o MESMO avatar"; degradation: "sem agente
  identificado, degrada para o avatar genérico")
- **Origin:** AT-503 (TP-01 11th, chat UX note §2.1)

### RN-830 — The composer respects accent composition, and the thread talks to the screen reader {#rn-830}

- **Rule:** Enter only sends when there is no composition in progress
  (`nativeEvent.isComposing`) — in the middle of an accent via IME or dead key,
  it confirms the character. The thread container is `role="log"` (with a name), and the
  turn activity strip ([RN-460](#rn-460)) is `role="status"` with
  `aria-live="polite"`: the screen reader announces the new answer and what the
  agent is doing without interrupting whoever is reading. The check lives in the
  composer, not in the page, which is at its line ceiling ([ADR 0176](../adr/0176-sessionpage-abaixo-de-mil-linhas.md)).
- **Where:** `apps/web/src/routes/SessionComposer.tsx:81` (`ignorarComposicaoIme`),
  `apps/web/src/components/TurnActivityStrip.tsx:41` (`TurnActivityStrip`)
- **Test:** `apps/web/src/routes/SessionFio.at503.test.tsx` ("Enter sem
  composição chega ao handler de envio", "a faixa do turno é uma região de
  status educada"; failure: "Enter no meio da composição de acento NÃO envia")
- **Origin:** AT-503 (chat UX note §3)

### RN-831 — A message that was not sent stays in the thread, with "try again" {#rn-831}

- **Rule:** when sending the message to the agent fails (except the refusal for a
  closed session, which returns the text to the field — AT-154), the optimistic bubble
  does not vanish: the text stays in the thread with the "não enviada" badge and the "Tentar de
  novo" button, which resends the SAME text to the SAME recipient through the usual
  path. There is only one at a time; a new send (or the resend itself) replaces it.
  The toast with the reason remains.
- **Where:** `apps/web/src/lib/mensagem-nao-enviada.ts:29`
  (`marcarMensagemNaoEnviada`), `apps/web/src/routes/SessionFio.tsx:52`
  (`SessionFio`)
- **Test:** `apps/web/src/routes/SessionFio.at503.test.tsx` ("mostra o texto
  com \"não enviada\" e reenvia ao clicar em tentar de novo", "um envio novo
  (otimista acesa) substitui a não enviada");
  `apps/web/src/routes/SessionPage.turno-preso.test.tsx` (failure: "CASO DE
  FALHA: erro no envio desarma o turno e a mensagem fica \"não enviada\"
  (RN-831)")
- **Origin:** AT-503 (chat UX note §3)

### RN-833 — Every web Phoenix socket gets disposed of, and the replaced one does not act {#rn-833}

- **Rule:** every web Phoenix socket is born through `criarSocket` and dies through
  `descartar()`, which does `disconnect()` and removes the three listeners that the
  `phoenix@1.8.9` constructor registers on `window` (`pagehide`, `pageshow`,
  `visibilitychange`) — `disconnect()` alone left them, and the
  `visibilitychange` reopened the old socket. In the session channel each
  `conectar()` is a GENERATION: the previous one is disposed of (leave, `descartar()` and
  ITS ping) before the new one is born, and every callback of an old generation is a
  no-op — the `onClose` of a replaced socket does not schedule a reconnection, does not
  clear the current one's ping and does not mark the live channel dead. The live channel
  ([RN-579](engine.md#rn-579)) is a COUNT of connections per session, not a boolean. The
  neutralization of auto-reconnect ([RN-108](#rn-108))
  stays mandatory in the type of `criarSocket`.
- **Where:** `apps/web/src/lib/socket-phoenix.ts:31` (`criarSocket`),
  `apps/web/src/lib/session-channel.ts:92` (`descartarGeracao`),
  `apps/web/src/lib/session-channel.ts:136` (`ehAtual`),
  `apps/web/src/lib/canal-vivo.ts:70` (`marcarCanalDaSessao`)
- **Test:** `apps/web/src/lib/socket-phoenix.test.ts` (real Phoenix: "50×
  criar + descartar deixa saldo líquido 0 nos três ouvintes de window";
  failure: "socket só desconectado (sem descartar) deixa os três ouvintes"),
  `apps/web/src/lib/session-channel.test.ts` ("gerações (AT-500, RN-833)"),
  `apps/web/src/lib/canal-vivo.test.ts`
- **Origin:** AT-500

### RN-834 — The project name in the wizard is not called "title" {#rn-834}

- **Rule:** the creation wizard's "Nome do projeto" field uses `id`/`name`
  `projeto-slug`, which match no contact data token (`name`,
  `nome`, `title`, `first`, `last`, `company`, `contact`). The `project-title` of
  [RN-736](#rn-736) removed the "name", but "title" is an honorific
  (Mr./Mrs.) in contact autofill, and NordPass kept opening the contact list
  over the field. The visible label "Nome do projeto" (linked by
  `htmlFor`) and the `SEM_AUTOFILL` of [RN-740](#rn-740) stay. It is a HEURISTIC, not
  measured: NordPass documents no ignore attribute, and none was
  added to `SEM_AUTOFILL`; the proof is TP-01.
- **Where:** `apps/web/src/routes/NewProjectWizard.tsx:746` (`projeto-slug`)
- **Test:** `apps/web/src/routes/NewProjectWizard.test.tsx` ("RN-834: id e
  name do nome do projeto não parecem dado de contato…")
- **Origin:** AT-501 (TP-01 of 10/10)

### RN-835 — The Visão geral's "Desbloquear" does not move and says what happened {#rn-835}

- **Rule:** extension of [RN-816](#rn-816) and [RN-794](#rn-794). In the
  Visão geral's execution section, the list of blocked tasks comes FIRST, before
  "Religar execução" (which depends on reading the current execution) and the
  dev agents grid (which depends on the events) — blocks that arrived after the first
  paint and pushed the button under the cursor. Unblocking has feedback PER
  TASK: in flight the button stays inert and says "Desbloqueando…" (one click, one
  call), success says "Tarefa desbloqueada" until the reread backlog removes the
  row, and the refusal shows the api's sentence on the row itself. Without a session read, the
  button stays inert with the reason in text — before, the click returned silently.
  Declared: what stays ABOVE the section (the team and the activity tree) has no
  reserved height, and jsdom does no layout — the test proves the ORDER, not the
  pixel shift; which of the two causes (jump or unread session) made the
  1st click of TP-01 get lost was not measured in the browser.
- **Where:** `apps/web/src/routes/ProjectOverviewTab.tsx:485` (`desbloqueio`),
  `apps/web/src/routes/ProjectOverviewTab.tsx:611` (`blockedTasks`)
- **Test:** `apps/web/src/routes/ProjectOverviewTab.test.tsx` ("RN-835
  (AT-502): o desbloqueio chama uma vez, fica em voo e diz quando terminou";
  failure: "RN-835: a recusa do desbloqueio mostra a frase da api na linha"),
  `apps/web/src/routes/salto-de-layout.test.ts` ("RN-835 (AT-502): Visão
  geral — as tarefas bloqueadas vêm antes…")
- **Origin:** AT-502 (TP-01 of 10/10)

### RN-836 — The thread offers "go to the end" when content arrives for someone who scrolled up {#rn-836}

- **Rule:** with the person far from the end of the thread (the 120px guard of
  [RN-173](#rn-173)) and the thread having gained a message or approval card
  since they left the end, a floating button at the bottom of the scrolling area
  offers the jump to the end, counting the new messages ("3 mensagens novas",
  i18next plural with `_zero`/`_one`/`_other`). A new approval card
  does not add to the number: it HIGHLIGHTS the button and swaps the label for "Há uma aprovação
  esperando". The button has its own accessible label, disappears on reaching the end and
  never appears for someone at the end — there RN-173's automatic scrolling
  still rules, and the button only observes.
- **Where:** `apps/web/src/lib/session-rolagem.ts:206` (`estadoDoIrAoFim`),
  `apps/web/src/lib/session-rolagem.ts:227` (`useIrAoFimDoFio`),
  `apps/web/src/routes/IrAoFimDoFio.tsx:10` (`IrAoFimDoFio`)
- **Test:** `apps/web/src/routes/IrAoFimDoFio.test.tsx` ("caminho feliz: fora
  do fim e com mensagens novas, mostra o contador…", "aprovação nova realça o
  botão"; failure: "no fim, conteúdo novo não mostra botão")
- **Origin:** AT-506 (Chat UX improvements, item 1.3)

### RN-837 — Thread Markdown: new blocks and a stream prefix without raw markers {#rn-837}

- **Rule:** the chat's light Markdown (its own parser, no dependency) also
  recognizes horizontal rules (`---`, `***`, `___`; right after paragraph text it
  stays text), blockquotes (consecutive `>` lines, the inside reprocessed by the
  same parser), the `####` heading, a nested list of ONE level (an item indented by
  2+ spaces goes into the previous item; deeper is flattened) and checklists
  (`- [ ]`/`- [x]`, a visual-only, disabled box). In stream mode
  (`MarkdownMessage` with `emCurso`), the text first goes through
  `fecharMarcadoresAbertos`, which closes pending fences, backticks and `**` and removes a
  loose marker at the tip — no prefix throws nor shows a raw marker. The
  final text never goes through it. Still without `dangerouslySetInnerHTML`.
- **Where:** `apps/web/src/lib/markdown.ts:122` (`HR_RE`),
  `apps/web/src/lib/markdown.ts:123` (`CITACAO_RE`),
  `apps/web/src/lib/markdown.ts:124` (`TAREFA_RE`),
  `apps/web/src/lib/markdown.ts:374` (`fecharMarcadoresAbertos`),
  `apps/web/src/components/ui/MarkdownMessage.tsx:298` (`MarkdownMessage`)
- **Test:** `apps/web/src/lib/markdown.blocos-e-stream.test.ts` ("checklist
  marca cada item…"; failure: "`---` logo depois de texto continua texto"),
  `apps/web/src/components/ui/MarkdownMessage.stream.test.tsx` ("nenhum
  prefixo lança nem mostra marcador cru"; failure: "o texto final (sem
  emCurso) não é alterado")
- **Origin:** AT-507 (Chat UX improvements, 10/10, item 1.2-a)

### RN-841 — The "PRs prontas" queue rereads itself without reloading the page {#rn-841}

- **Rule:** extension of [RN-825](#rn-825). The list of open PRs still has
  no poll of its own, and is reread at two moments: (1) when the backlog read
  the chat already does at 15 s brings some task with a `status` or
  `gateStatus` different from the previous read (the dev's PR is born in the
  EXECUTION session, whose channel the chat does not listen to, and the gates approving show up there); and
  (2) when this session's channel announces `adr.pr_opened`, `infra.pr_opened`,
  `action.pr_open`, `action.git_merge` or `action.failed`, through the
  invalidator with a 2 s window ([RN-579](engine.md#rn-579), [RN-632](#rn-632)). The
  first read and an equal read reread nothing: the cost is zero new
  polls. Left out, declared: an infra PR opened in another session without changing a
  task nor going through this channel only shows up on the next read triggered by
  another reason.
- **Where:** `apps/web/src/lib/prontas-e-bloqueadas.ts:66` (`assinaturaDoBacklog`),
  `apps/web/src/components/PendenciasDeOutrasSessoes.tsx:91` (`assinaturaAnterior`),
  `apps/web/src/lib/canal-vivo.ts:134` (`alvosDoEvento`)
- **Test:** `apps/web/src/components/PendenciasDeOutrasSessoes.test.tsx`
  ("RN-841: a tarefa que entra em awaiting_user relê as PRs…" and "CASO DE FALHA
  RN-841…"), `apps/web/src/lib/acoes-da-sessao.test.ts`
- **Origin:** AT-510

### RN-842 — The project name label does not say "Nome" {#rn-842}

- **Rule:** the visible label of the creation wizard's name field is
  "Projeto" (en: "Project"), not "Nome do projeto"/"Project name": with the
  `id`/`name` `projeto-slug` of [RN-834](#rn-834) NordPass kept opening
  "Contact info" over the field (TP-01, 12th), and the `<label>` text was the signal
  that remained. The label stays visible and linked by `htmlFor`, the field stays
  outside a `<form>` and with the `SEM_AUTOFILL` of [RN-740](#rn-740). It is a HEURISTIC:
  the search (NordPass's help center, the extension store, forums) found no
  ignore attribute documented by NordPass (nothing like `data-np-ignore`),
  so none was added to `SEM_AUTOFILL`. Already tried before: removing
  `autoFocus` (RN-736), `aria-autocomplete`/`data-protonpass-ignore` (RN-740),
  `id`/`name` without a contact token (RN-834). The proof is TP-01.
- **Where:** `apps/web/src/routes/NewProjectWizard.tsx:749` (`projeto-slug`),
  `apps/web/src/locales/pt-BR/newProject.json` (`nameLabel`)
- **Test:** `apps/web/src/routes/NewProjectWizard.test.tsx` ("RN-842: o
  rótulo visível do campo não traz \"nome\"…")
- **Origin:** AT-511 (TP-01 of 10/11)

### RN-843 — One decision card per action in the chat {#rn-843}

- **Rule:** extension of [RN-822](#rn-822). The PENDING `git_merge` that the
  pending block draws on the PR's row ("PRs prontas para merge") is its ONLY
  `ApprovalCard` on screen: the block registers the ids it draws in a light
  client registry, and the session thread, while the action is pending and
  registered, shows only a line pointing to the queue. Once decided, the thread goes back
  to the card (history); without the block mounted (another screen, PR outside the queue), the
  thread shows the full card. The registration only holds while the card is
  MOUNTED: with the block collapsed (the `Disclosure` unmounts the content), the thread
  shows the card. No endpoint or ceiling changes.
- **Where:** `apps/web/src/lib/acoes-no-bloco.ts:48` (`useAcaoEstaNoBloco`),
  `apps/web/src/components/PendenciasDeOutrasSessoes.tsx:460` (`useRegistrarAcoesNoBloco`),
  `apps/web/src/components/CartaoOuReferenciaNoFio.tsx:11` (`CartaoOuReferenciaNoFio`),
  `apps/web/src/routes/session-timeline-montagem.tsx:1137` (`CartaoOuReferenciaNoFio`)
- **Test:** `apps/web/src/components/CartaoOuReferenciaNoFio.test.tsx`,
  `apps/web/src/components/PendenciasDeOutrasSessoes.test.tsx` ("a PR com os
  gates aprovados aparece…")
- **Origin:** AT-512

### RN-855 — The Visão geral shows how to run the deliverable, declared and not verified {#rn-855}

- **Rule:** the Visão geral gets the "Rodar na sua máquina" card, right below
  the first steps one, with what the Infra declared in its PR
  (`artifact.run_instructions`, RN-852): the command in a code block with a
  "Copiar" button, the URLs as links that open in a new tab
  (`target="_blank"`, `rel="noopener noreferrer"`) — only `http://localhost:<porta>`
  and `http://127.0.0.1:<porta>`; another URL does not become a link, even though the api already
  refuses it —, the reminder of `cp .env.example .env` when `envExample` and the
  note "Declarado pela Infra na PR, não verificado na sua máquina" (RN-468:
  never green, never "running"). Without a declaration (`null`) the card does not
  appear, as the first steps one disappears when there is nothing to say. The
  read is a configuration one (`FRESCOR_DA_CONFIGURACAO_MS`, no poll) and the
  session channel's `infra.pr_opened` notice rereads it.
- **Where:** `apps/web/src/components/RodarNaSuaMaquina.tsx:32` (`RodarNaSuaMaquina`), `:20` (`urlLocalSegura`),
  `:13` (`releSeInfraAbriuPr`),
  `apps/web/src/routes/ProjectOverviewTab.tsx:202` (`releSeInfraAbriuPr`),
  `apps/web/src/lib/api-client.ts:832` (`getRunInstructions`)
- **Test:** `apps/web/src/components/RodarNaSuaMaquina.test.tsx` ("mostra
  comando, copiar, link local e a nota de não verificado"; "sem declaração
  (null) o cartão não aparece"; "só localhost/127.0.0.1 com porta vira link";
  "infra.pr_opened relê o cartão; outro evento não")
- **Origin:** AT-517 (ADR 0213)

### RN-861 — Open questions are their own queue in the chat, and the readiness notice does not block {#rn-861}

- **Rule:** the chat's pending block gains the "Perguntas em
  aberto" queue, with its OWN title and count (the api's `total`, never summed with the
  other queues — RN-467) and a declared cut when the list comes with a ceiling
  (RN-180). Each card states the question, the agent that asked, what it
  affects, the suggestion with "Aceitar sugestão" and a short field with "Responder";
  the task the QA gate parked because of the question (RN-860) appears on the
  card itself as "esperando sua resposta". Only the author of the originating
  session (`autorDaSessao`) has the controls; the others see the card with the
  control inert and the reason in text (ADR 0064). The refusal shows the
  api's sentence; success rereads the queue and the question leaves. The read does NOT poll: the channel
  rereads the queue on `artifact.open_question`, `open_question.answered` and
  `pr.gate_changed` (target `perguntas`, 2 s window). Next to "Estou pronto"
  and "Confirmar arquitetura pronta", the composer notifies "N perguntas em
  aberto" with a shortcut to the queue, reading the SAME query — it only notifies, the buttons
  stay enabled (ADR 0214).
- **Where:** `apps/web/src/components/PerguntasEmAberto.tsx:47`
  (`PerguntasEmAberto`), `:117` (`eAutor`), `:282`
  (`AvisoDePerguntasEmAberto`), `apps/web/src/lib/canal-vivo.ts:135`
  (`alvosDoEvento`)
- **Test:** `apps/web/src/components/PerguntasEmAberto.test.tsx` ("fila
  própria com contagem própria; o autor responde e aceita a sugestão", "o
  aviso do composer diz N e não bloqueia nada; some sem perguntas"; failure: "a
  recusa 409 mostra a frase da api", "quem não é o autor da sessão vê o
  cartão com o controle inerte e o motivo em texto")
- **Origin:** AT-521

### RN-867 — The parked gate notice states the recorded reason, and the open question points to its card {#rn-867}

- **Rule:** `gate.rescue_parked` has two emitters: the rescue by time
  (`GateRescuer`, RN-722), which records `idadeSegundos`, and QA parked
  waiting for the answer to an open question, which does not record it. The thread
  tells the two apart by the PRESENCE of `idadeSegundos` (the `motivo` is fixed pt-BR
  text and is not read as a key): "parado mais de 2 h" only in the rescue by
  time; in the other, the notice says the gate is waiting for the answer and points to the
  "Perguntas em aberto" card (RN-861). The "Retomar gate" button (RN-724) stays in
  both.
- **Where:** `apps/web/src/routes/RetomarGateEstacionado.tsx:18`
  (`cicloEstacionado`), `apps/web/src/routes/session-timeline-montagem.tsx`
  (`gateEstacionado.avisoPergunta`)
- **Test:** `apps/web/src/routes/RetomarGateEstacionado.test.tsx` ("o
  resgate por tempo grava idadeSegundos e lê como tempo"; failure: "a pergunta
  em aberto não tem idadeSegundos e não fala em 2 h")
- **Origin:** AT-528

### RN-882 — The Session composer does not lose keystrokes during fast typing {#rn-882}

- **Rule:** the composer field owns ITS OWN value while typing:
  the drawn value is the local state, updated in `onChange`, and the page's `draft`
  receives each value (send, queue and buttons keep reading from it). A
  late `draft` that comes back as a prop NEVER rewrites the field — only a
  value the field did not emit is adopted (clearing after sending, the text returned
  on failure, the invitation's example). Before, the `<textarea>` was controlled directly
  by the `SessionPage`'s `draft`, and the page's late re-render
  rewrote the field with an older value: 991 of 1,010 characters in
  TP-01, with an ordinary textarea on the same page receiving 249/249. Enter,
  Shift+Enter and accent composition (RN-830) do not change.
- **Where:** `apps/web/src/components/CampoDoComposer.tsx:21` (`CampoDoComposer`);
  `apps/web/src/routes/SessionComposer.tsx`
- **Test:** `apps/web/src/components/CampoDoComposer.test.tsx` ("digitação
  rápida com a página atrasada não perde tecla nenhuma"; failure/edge case: "a
  escrita de fora (esvaziar depois do envio) é adotada pelo campo")
- **Origin:** AT-533

### RN-883 — The auto mode batch offer also in the Session chat {#rn-883}

- **Rule:** with the session active and with execution (`sessaoTemExecucao`), the chat
  shows the SAME batch offer as the Executores tab (RN-661) — the same
  component, the same endpoint (one PUT per agent), the same text about what
  auto mode does not unlock, and nothing is recorded without the click. The agents are the
  `dev-<modulo>` that joined the whole session plus the gate subagents
  (`agentesDaOfertaEmLote`); role `maintainer` (the endpoint's). Without execution,
  nothing appears and `agent_autonomy` is not even read. It disappears when all are already in
  auto.
- **Where:** `apps/web/src/components/ModoAutomaticoNoChat.tsx:41`
  (`ModoAutomaticoNoChat`), `:18` (`agentesDoChat`)
- **Test:** `apps/web/src/components/ModoAutomaticoNoChat.test.tsx` ("caminho
  feliz: com execução, a oferta aparece e só o clique grava"; failure: "sem
  execução, nada aparece e nem a leitura acontece")
- **Origin:** AT-537

### RN-884 — The answered question offers "Corrigir a história" {#rn-884}

- **Rule:** a question answered through the chat's "Perguntas em aberto" panel
  (RN-861) stays as an answered card until dismissed, and each story of
  `afeta.historias` that the backlog brings gets "Corrigir a história" when it is still
  correctable by RN-727's yardstick (`draft`, no
  `in_progress`/`in_review` task, role `developer`) — the link leads to the Histórias tab
  with it open (`?historia=`). It does not trigger the PO (owner decision, 10/14). Not
  correctable: the link does not exist and the reason is stated in text (RN-102). The yardstick is
  the SAME function as the Histórias tab's, moved to `lib/`.
- **Where:** `apps/web/src/components/PerguntasEmAberto.tsx:222`
  (`CartaoRespondido`); `apps/web/src/lib/correcao-de-historia.ts`
  (`motivoDeCorrecaoInerte`); `apps/web/src/routes/ProjectBacklogTab.tsx:398`
  (`useHistoriaInicial`)
- **Test:** `apps/web/src/components/PerguntasRespondidas.test.tsx` ("caminho
  feliz: história draft sem tarefa em execução ganha o link para a aba
  Histórias"; failure: "com tarefa em execução o botão não existe e o motivo é
  dito em texto")
- **Origin:** AT-538

### RN-887 — The task block is orthogonal to the status, and whoever shows it reads both {#rn-887}

- **Rule:** a blocked task stays `todo`/`in_progress` with
  `tasks.blocked = true` (and `blocked_reason`/`blocked_origin`) — there is no
  `blocked` status in the enum, by owner decision (10/14). Whoever COUNTS or SHOWS a task
  reads both fields, and `blocked` wins over `status`: the Histórias tab shows the
  "Bloqueada" badge (danger tone) with the reason in text, and the others by status
  (to do, in progress, in review, done); the backlog task list that
  the Dev Lead reads marks the row with `| BLOQUEADA: <motivo, até 120 caracteres>`,
  and the task stays in the list. Claim, unblock and resumption do not change.
- **Where:** `apps/web/src/lib/execution.ts:10` (`estadoDaTarefa`);
  `apps/web/src/routes/ProjectBacklogTab.tsx` (the task list badge);
  `apps/engine/lib/engine/agents/dev_lead_tools.ex:410` (`bloqueio`)
- **Test:** `apps/web/src/lib/execution.test.ts` ("blocked vence o status";
  failure: "sem bloqueio, o status"); `apps/web/src/routes/ProjectBacklogTab.test.tsx`
  ("a bloqueada mostra \"Bloqueada\" e o motivo, sem o selo \"a fazer\"");
  `apps/engine/test/engine/agents/dev_lead_tools_test.exs` ("a tarefa
  bloqueada diz BLOQUEADA e o motivo; a todo normal não")
- **Origin:** AT-536

### RN-889 — The auto mode batch offer appears in the chat of any active session of a project in execution {#rn-889}

- **Rule:** extends RN-883. Approving the Dev Lead's plan creates the
  EXECUTION session, separate from the Criativo's, and it is in the Criativo's chat that the user
  drives. The batch offer (RN-661) appears in the chat of every ACTIVE session
  when the PROJECT has execution — `roster.executionActivated` of the projects
  summary (the most recent session, the execution one), the SAME read and `queryKey`
  the chat already made (`useAtivosNoProjeto`, RN-633), with no new query nor new
  poll. The dev agents from there (`roster.activatedAgents`) add to this session's.
  Same component, same endpoint, same text, nothing recorded without the click,
  it waits to know who is already switched on (RN-803) and disappears with the whole team in
  auto. Without execution in the project, nothing appears and `agent_autonomy` is not even
  read. Declared gap: the signal is the most recent session's `roster.executionActivated`,
  which says it HAD `execution.activated`, not that it is still open;
  with the execution session already closed, the offer still appears in the
  Criativo's chat — declared, not fixed, because telling them apart would require a new
  read (the request budget).
- **Where:** `apps/web/src/components/ModoAutomaticoNoChat.tsx:29`
  (`ofertaDoChat`); `apps/web/src/lib/session-destinatario.ts:174`
  (`useExecucaoNoProjeto`)
- **Test:** `apps/web/src/components/ModoAutomaticoNoChat.test.tsx` ("caminho
  feliz: execução ativa noutra sessão do projeto, time em manual — a oferta
  aparece no chat do Criativo"; failures: "time todo já em automático: nada
  aparece", "sem execução no projeto: nada aparece e nem a leitura acontece")
- **Origin:** AT-540

### RN-901 — The auto mode batch offer in the chat includes the dev agents of the approved plan {#rn-901}

- **Rule:** extends RN-889. `roster.activatedAgents` of the project summary
  NEVER carries a dev agent: the dev does not record `agent.activated`, only
  `dev.started`. The chat's batch offer (RN-883/889) read only that list and
  did not list the `dev-<module>` of the active execution, which the user had
  to turn on from the Executors tab. The project execution (`execucaoDoRoster`)
  now adds, only with `roster.executionActivated`, the `dev-<module>` of
  `roster.moduleNames` (the current `module_map`), through the SAME `devAgentId`
  the Executors tab uses (RN-661, `rosterFromFacts`), with no new derivation.
  Without an active execution no dev enters. Declared gap: the list comes from
  the CURRENT `module_map`; if the approved plan used a subset of the modules,
  the offer inherits that divergence. No ceiling moves and nothing is written
  without the click.
- **Where:** `apps/web/src/lib/session-destinatario.ts:194` (`execucaoDoRoster`),
  called by `useExecucaoNoProjeto` (`apps/web/src/lib/session-destinatario.ts:175`)
- **Test:** `apps/web/src/lib/session-destinatario.test.ts` ("CAMINHO FELIZ:
  execução ativa soma o dev-<modulo> do module_map aos ativados"; failure: "sem
  execução ativa, o módulo do plano NÃO vira dev agent"), and
  `apps/web/src/components/ModoAutomaticoNoChat.test.tsx` (fixture derived from
  the real roster, "caminho feliz")
- **Origin:** AT-573 (TP-01 18th, 19/10: the 1st task stopped at `dev.awaiting_approval`
  because the dev was not in auto mode)

### RN-911 — The provider is global; project Settings only choose a model; the matrix lives in the Account {#rn-911}

- **Rule:** LLM credentials, the model catalog (curation, prices, sync and the Hugging Face browser) and the spend report per key have left the project Settings. They live in `/providers` (the three pieces), and the spend per key also in the Spend tab, only for `owner` (RN-060). The project keeps only the CHOICE: model per agent and per area, the "apply to all" (RN-476), the routing criterion and "best models". The "Who can approve what" matrix has left Settings and is a section of the Account (`/account`), for anyone logged in. The "Enable and apply to the N agents" shortcut (RN-694 item 3) no longer exists. An old link `?section=credentials`, `model-catalog`, `key-spend` or `approval-matrix` opens the tab at the top, without error. The empty state of "Models per agent", the subtitle of "best models" and the First steps (RN-708) point to `/providers`. Revises RN-694 (item 3) and RN-708 (destinations). No ADR: it is a screen boundary.
- **Where:** `apps/web/src/routes/settings/sumario.ts:48` (`SECOES_DE_CONFIGURACOES`), `apps/web/src/routes/ProjectSettingsTab.tsx:62` (`ProjectSettingsTab`), `apps/web/src/routes/AccountPage.tsx:36` (`AccountPage`)
- **Test:** `apps/web/src/routes/settings/sumario.test.ts` (the four keys do not exist); `apps/web/src/routes/settings/SumarioDeConfiguracoes.test.tsx` (the tab does not mount the four sections, not even for `owner`); `apps/web/src/routes/AccountPage.test.tsx` (the matrix, and the failure case in the language); `apps/web/src/routes/configuracoes.orcamento.test.tsx` (returning to the tab does not fetch the credential); `apps/web/src/components/catalogo-com-busca.test.tsx` (no shortcut)
- **Origin:** AT-597 and AT-598 (EP-031), owner's requests of 22/10.

### RN-912 — The area model is a box on the lead's line, under "Models per agent" {#rn-912}

- **Rule:** the "Area model" section no longer exists. The area default (RN-102, the `area` scope of RN-470) is linked by a box **only on the lead's line** of each area (`dev-lead`, `qa`, `infra`): "Apply to the whole X area (lead + subagents)". The area binding is one value per area and does not store the source agent, so a box on every line would have two competing for the value. Checked ⇔ the lead's effective value comes from the area (`origin: 'area'`), read from the batch of RN-654, with no new query. **Checking** writes the area with the lead's effective value and the lead's routing criterion (`PUT .../area-bindings/:area`) and THEN deletes the lead's own binding (`DELETE .../agent-bindings/:lead`; copying it would leave it behind, RN-102). These are two calls and the outcome is per step (RN-469): if the area refuses (including the 422 of RN-040) nothing changed and the toast carries the API's phrase; if the area was written and the DELETE fails, the screen says the area default was written and the lead's own model was not removed (a 404 on the DELETE counts as already removed). **Unchecking** deletes the area (`DELETE .../area-bindings/:area`) and writes nothing to the lead; a 404 becomes "already inherited". With the box checked, the lead's selector and routing criterion write the AREA. An agent with its own binding overrides the area (RN-470) and does NOT follow: the screen lists, in plural, the known subagents in that situation (declared scope, RN-180; the dynamic `dev-<modulo>` ones are not included and the screen says so) and does not delete their decision. The "apply to all" (RN-476) writes its own binding to the 17 and, for that reason, takes the subagents off the area default; its notice says so. **Role:** the box and, while checked, the lead's selector require `maintainer` (the minimum of the area endpoint, RN-102), compared by `roleAtLeast`; below that they stay inert and the reason is said ONCE in text in the section legend (ADR 0064). The other lines remain at `developer`. The box is born disabled if the lead has no effective value to copy, and it says the reason in text on the box itself (AT-601, key `modelsSection.areaBox.needsModel`). Revises the UI of RN-040, RN-102 and RN-470; the cascade, the scope and the endpoints do not change (no ADR).
- **Where:** `apps/web/src/routes/settings/ModelsSection.tsx:94` (`podeEditarArea`), `:428` (`areaDoLead`), `:446` (`handleMarcarArea`), `:486` (`handleDesmarcarArea`)
- **Test:** `apps/web/src/routes/settings/ModelsSection.caixa-da-area.test.tsx` (AT-601: reason when the lead has no effective value); `apps/web/src/routes/ProjectSettingsTab.test.tsx` (checking, the area refusing, PARTIAL FAILURE, unchecking with and without a 404, the lead's selector on the area, non-followers, `developer` inert); `apps/web/src/routes/settings/papel-na-tabela-de-agentes.test.tsx` (the two minimums); `bindings-em-lote.test.tsx` (single batch); `cascata.test.tsx`; `heranca.test.tsx`; `filtro-de-aptos.test.tsx` (RN-040); `preferencia-de-roteamento.test.tsx` (ADR 0166)
- **Origin:** AT-600 (EP-031), owner's request of 22/10.

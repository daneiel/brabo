---
title: From zero to a deliverable
description: A real project walked end to end on Brabo — create, pick a model, answer the agents' open questions in the chat, confirm the architecture, approve the plan, and merge every pull request without leaving the Creative's chat.
---

# From zero to a deliverable

This page follows one real project, recorded live on 2026-10-14, from an empty
workspace to a running deliverable. The project, `viralabs-app-2026-10-14b`,
is a link shortener (Node 22 + SQLite). The whole team ran on **Claude Haiku
5.5**, and the run cost **US$ 1.07**. From the idea to execution took
**13 minutes**, and to the last merge about **57 minutes** of interaction.

What came out at the end: **8 of 8 tasks**, plus the ADR and the
infrastructure pull request, merged into the project's `dev` branch, and a
deliverable whose test suite passes **102/102** in a clean clone and that
starts with `docker compose up`.

The whole run was driven from **one place, the Creative's session chat**:
open questions, the architecture confirmation and every merge were decided
there, without reloading the page or opening another tab. Each step below
says what you do and what the agents hand back. The recordings are the real
screen of Brabo; the path of the mounted folder is blurred in step 1.

## 1. Create the project

You create the project in the wizard and choose where the code lives. Here it
is a **mounted folder**: the wizard suggests a path inside the installation's
projects base, and the folder only needs to exist when the Infra brings the
container up. Nothing is provisioned yet — the repository is born later, when
the Architect is brought in.

![Creating the project](../../../../../../docs/assets/fluxo-do-zero/passo-01-criar-projeto.gif)

## 2. Give the team a model

In Settings you apply one model to every agent in one action. This run applied
Claude Haiku 5.5 to the whole team.

![Applying the model to the team](../../../../../../docs/assets/fluxo-do-zero/passo-02-modelo-ao-time.gif)

## 3. The idea, and the questions the agents ask back

You describe the product in the Creative's chat. In its first turn the
**Creative** records **7 business rules and 1 decision**, and turns what it
could not decide on its own into **open questions**, each with a suggested
answer and the rules it affects ("when a link is deleted, is its click history
deleted too?"). The questions sit in the "Open questions" queue at the top of
the chat: you accept the suggestion or type your own answer, and the answer is
recorded as a decision. The closing line of the turn says what was written
("Recorded this turn: 7 business rules, 1 decision, 2 open questions").
When you are done, **"I'm ready — the need is validated"** hands the work to
the PO.

![The idea and the open questions](../../../../../../docs/assets/fluxo-do-zero/passo-03-ideacao-e-perguntas.gif)

## 4. PO, Architect and the ADR

The **PO** breaks the rules into a backlog — **4 epics, 8 stories and 8
tasks**, in about a minute and a half — and asks back too when a rule is
missing a value ("what is the minimum password length?"). With every rule
covered by a story, the handoff to the **Architect** is accepted
automatically. The Architect proposes the ADR as a pull request
(`arquiteto[bot]`, PR #1, "Single module with SQLite on a persistent volume")
and, once the architecture is defined, asks you to confirm it:
**"Confirm architecture ready"** is what brings the Infra in.

![PO, Architect and the ADR](../../../../../../docs/assets/fluxo-do-zero/passo-04-po-arquiteto-adr.gif)

## 5. Infra, the plan and automatic mode

The **Infra Lead** brings the project's container up on its own and opens the
infrastructure pull request (`infra[bot]`, PR #2). The **Dev Lead** reads the
backlog and the module map and proposes the execution plan; approving the
plan is what activates execution. The screen offers **automatic mode** for the
whole team in one click, saying what it does not release: merges into a
protected branch stay yours. From then on the dev agent works inside the
container (`/work`), and you can read each command it ran and its output in
the chat.

![Infra, the plan and automatic mode](../../../../../../docs/assets/fluxo-do-zero/passo-05-infra-plano-modo-automatico.gif)

## 6. Merges from the chat

Each task runs in the dev agent (90 s on average from picking the task to the
pull request, between 36 s and 144 s) and goes through the pipeline **Dev →
QA → SecOps → You**. A pull request that passes the gates lands in the
**"PRs ready to merge"** queue at the top of the Creative's chat: **Merge**
proposes the merge and **Approve**, in the same block, confirms it. In this
run the last seven pull requests (#4 to #10) were merged in about two minutes,
with no page reload.

![Merges from the chat](../../../../../../docs/assets/fluxo-do-zero/passo-06-merges-pelo-chat.gif)

## The deliverable

The `dev` branch of the project repository, cloned clean and run in
`node:22` with `npm test`, passed **102/102** tests. `docker compose up`
brought the API up on port 8080, and every rule was checked over HTTP: a wrong
login and a request without a token get 401; an `ftp` URL or one longer than
2048 characters gets 400 `INVALID_URL`; the short code has 7 characters; the
public redirect is a 302 that records the click; an unknown code gets 404
`LINK_NOT_FOUND` and an expired link 410 `LINK_EXPIRED` without counting the
click; deleting a link returns 204 and removes its clicks; the panel shows the
count and the click history; `npm run user:create` refuses a password shorter
than 12 characters; and `/docs` serves the API reference. The CORS preflight
from `127.0.0.1:8080` and from `localhost:8080` gets each its own
`Access-Control-Allow-Origin`, and a foreign origin gets none.

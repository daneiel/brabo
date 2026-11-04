---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0177 — The response language lives in three places — account, session and project —, as an open BCP-47 list and never in `users.locale`

## Status

**Accepted.** 2026-09-28 (AT-162, epic EP-028). Maintainer decisions of
2026-09-28, written in the notes of AT-168 and AT-169: preference per ACCOUNT
with an override per SESSION; an OPEN list of languages (any BCP-47); new
accounts in `automatico`; the detected one only counts when CONFIRMED; shared
artifacts and turns without an author in the PROJECT's language.

References, without editing, [ADR 0121](0121-schema-dividido-por-agregado-de-dominio.md)
(a new table goes into its aggregate's file) and
[ADR 0006](0006-prompt-assembler-context-harness.md) (the system prompt belongs
to the AGENT, not to the turn's author — that is why the language does not go
into it, but into a per-turn guidance, which is AT-164's).

## Context

An agent's response language, until now, was decided only by the model, from a
system prompt written in pt-BR and from the messages. The report that opened
the epic was a conversation in Portuguese answered in Spanish, with DeepSeek via
OpenRouter. `users.locale` (RN-432) exists, but it is the INTERFACE language:
closed to `pt-BR`/`en` because each value needs a translation file, and the
engine does not read it anywhere.

The maintainer's decisions call for four sources that did not exist and one
that did, with a precedence among them, and three different scopes:

- the explicit choice belongs to the PERSON and applies in every project and
  session;
- the person can pin ANOTHER language in one session, only for themselves — two
  users in the same session do not affect each other;
- the one detected from messages belongs to the PERSON, global, and only counts
  after they confirm;
- what belongs to everyone (shared artifact, turn without an author) follows the
  PROJECT.

## Decision

1. **No enum.** The three places store `text` with a CANONICAL BCP-47 code,
   validated in the api by `normalizarIdiomaBcp47`
   (`apps/api/src/domain/iam/idioma-de-resposta.ts`): form via
   `Intl.getCanonicalLocales`, a language subtag known to the process's ICU
   (`Intl.DisplayNames` with `fallback: 'none'`), never `und` nor private use,
   at most 35 characters. Opening the RESPONSE language does not depend on any
   resource file; an enum would require a migration per language, which is the
   cost the "open list" decision refused.
2. **Account: two columns in `users`, and `locale` untouched.**
   `users.response_language` — `NULL` is AUTOMATIC, and that is how every
   account is born (no sentinel value inside a language column). And the pair
   `users.detected_language` + `users.detected_language_confirmed_at`, with a
   CHECK requiring both together: the detected one only exists CONFIRMED. Who
   writes the pair is AT-163 (detection and the confirmation question); the
   column is born here because it is a step of the precedence.
3. **Session: table `session_language_overrides`**, in the sessions aggregate,
   keyed by `{session_id, user_id}`. Configuration and not an event: pinning
   again is an upsert, releasing is a `DELETE`, and a deleted session takes its
   rows with it. The key is the PAIR because the override is the person's;
   there is no "whole session" read.
4. **Project: column `projects.language`** (implemented in AT-243, with the
   default and minimum role decided there, in RN-619). It is the language of
   whatever has no human author.
5. **The precedence for those with an author** (RN-618), resolved per PERSON and
   never per session: session override > account choice > confirmed detected >
   `users.locale`. Since `users.locale` is `NOT NULL`, the chain always ends in
   a language. The "one-off request" inside a message is not a step: the model
   honours it, through the wording of the guidance.
6. **One resolution point.** `ResolverIdiomaDaRespostaUseCase` returns the
   winner, the ORIGIN and the whole chain; it is what the screen shows (the
   Account, the session bar) and what AT-164 calls to send the language to the
   engine.

## Consequences

- `users.locale` stays closed and stays interface-only: neither the response
  choice nor detection write to it. The Account page shows both side by side,
  and the `PATCH /users/me/preferences` route accepts both fields as OPTIONAL
  and independent.
- The list of accepted languages is that of the ICU of the Node running the api.
  A rare ISO 639-3 code that ICU does not name is refused, declared — no
  plausible response language is in that case.
- There is no consumer in the engine yet: no turn changes behaviour with this
  ADR. The transport (the ephemeral per-turn guidance) is AT-164; detection and
  confirmation, AT-163. Until then, choosing a language in the Account is
  stored and shown, and does not yet reach the model — the screen does not
  claim otherwise.
- The per-session override is allowed in a closed session: it does not trigger
  a turn nor write to the event log.

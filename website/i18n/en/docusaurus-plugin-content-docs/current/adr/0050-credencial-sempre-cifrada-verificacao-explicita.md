# 0050 — Credential always encrypted; verification becomes an explicit action

## Context

[ADR 0004](0004-git-credential-registration.md) established, for git
tokens, that registration **tests the credential against the provider
before encrypting and persisting it** — an invalid token responds with an
error instead of being stored to fail later. Phase 11a copied the same
ordering for LLM keys.

The ordering seemed prudent. In real use it produced the worst possible
outcome.

An owner tried to register their OpenRouter key in the settings screen.
Six clicks, six `POST /users/me/credentials`, six `422`s. On their end,
the Save button **did nothing** — and that part was a second defect, in
the web app (`handleSave` with no `try/catch`, the `ApiError` escaping to
`window.onunhandledrejection`, which only logs). But even with the message
showing on screen, the design was already wrong, for three reasons that
only show up together:

1. **Nothing is saved, and the key isn't recoverable.** The field is
   write-only and the screen never redisplays what was typed. A rejection
   leaves the user with no credential **and** no text to fix — they reopen
   the screen in the same state as before, having lost what they pasted.
2. **Registration judges with incomplete information.** The test fails for
   an invalid key, a key with no balance, network issues, timeouts, DNS.
   All of these come back as the same `422` at the wrong moment: the
   moment of saving. "Is this key good?" is not the same question as "do
   I want to save this key?", and tying them together makes the second
   depend on the first having an answer right now.
3. **The screen's promise becomes impossible to keep.** "Write-only, never
   redisplayed" means nobody — not even the owner — can check what's
   stored. If saving can fail silently, there's no way left to know what
   state the credential is in.

There was also an unjustified asymmetry: the only documented reason
`POST /users/me/git-credentials` existed separately from
`POST /users/me/credentials` was precisely the mandatory test.

## Decision

**Saving and verifying are two different matters. Registration only
saves; verification is its own action on the credential already stored.**

This holds for both families — LLM key and git token. They're the same
table (`user_credentials`), the same envelope encryption mechanism, and
the same promise to the user; treating them differently would produce two
screens with different rules for the same object.

1. **`UpsertUserCredentialUseCase` and `RegisterGitCredentialUseCase` lose
   the tester.** What's left is two steps: encrypt and save. A key the
   provider would reject is saved just the same — registration doesn't
   judge.

2. **`TestStoredCredentialUseCase`** (new,
   `application/use-cases/credentials/`) reads the envelope via
   `findSecretByUserAndProvider`, decrypts it, calls the right tester (git
   or LLM, dispatched by `isGitCredentialProvider`) and returns **only the
   verdict**. The plaintext exists inside the method and never crosses any
   boundary.

3. **The result has THREE states, not two:**

   | | when | why |
   |---|---|---|
   | `ok` | the provider accepted it | — |
   | `rejected` | the provider rejected it | carries the provider's **own reason** (`401`, timeout, no balance) — the useful diagnostic |
   | `unsupported` | there's no verified test endpoint | `ollama`, `anthropic`, `openai` |

   The third state isn't decoration. The LLM tester is a no-op for
   providers with no verified endpoint, and in a binary result they'd come
   back as `ok`: the screen would claim the key was checked when nobody
   checked it. It's the same capability rule from
   [ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)
   — only what's been proven is declared. That's why the port gained
   `supports()`: without it, `test()`'s silence is ambiguous.

4. **`POST /users/me/credentials/:provider/test`** — 200 on all three
   results, because the request was processed; `rejected` is a result,
   not a protocol error. 404 when there's no credential: there's nothing
   to test.

5. **A bad key stopped being an HTTP exception.**
   `LLMCredentialConnectionTestFailedError` and
   `GitCredentialConnectionTestFailedError` still exist and are still
   thrown by the testers, but now they're caught by the use case. They
   left the two `@Catch` filters (`LlmBindingErrorFilter`,
   `GitProviderErrorFilter`): a filter that can no longer fire is dead
   rule, the same criterion the docmap applies to a glob that matches no
   file.

6. **A length cap, and it's protection — not format validation.**
   `CREDENCIAL_COMPRIMENTO_MAXIMO = 512` on both DTOs, the same nature as
   the `@MaxLength` on the password (`domain/auth/password-policy.ts`):
   the route encrypts, and encrypting copies the input. The value is
   generous on purpose. The temptation, after a truncated key got saved
   silently, is to tighten the cap until it "validates" the key — and
   that would recreate the same gate through another door. Real
   credentials across the nine providers range from ~26 characters
   (`glpat-`) to ~164 (OpenAI project key); a cap close to the real size
   would reject the registration of a good key, and would age badly the
   moment a provider lengthened its format. A half-pasted key is still
   accepted, and it's the test route that unmasks it.

7. **The screen offers what's possible to offer.** There's no way to
   check what's stored, so what's offered is to **swap it** (the field is
   now visible even with a credential already saved — before, you had to
   remove it first) and to **test it**. And every path gained a
   `try/catch` with a toast: it was their absence that turned an explained
   422 into a silent screen.

## Consequences

**What improves.** The credential always exists after registration, so
there's always something to fix, swap, or test. The diagnostic is better
than it was: before, `422` said "didn't work"; now `rejected` carries the
provider's own message. The git route no longer has a special reason to
exist separately — it stays separate only because of the body format,
which is written in the controller.

**What gets worse, and is accepted.** An invalid key can sit stored until
someone tests it or the first real use fails. This is intentional: the
error on first use is normalized by `code` since ADR 0041, and the
alternative — refusing to save — is what this ADR undoes. Each provider's
smoke test still proves the real key against the real API, now through the
new path.

**What doesn't change.** Envelope encryption, `user_credentials`, the
secret-free projection, the routes' RBAC, and the rule that plaintext
never comes back in any response.

## What's left for later

- **Test at time of use, and show it.** Today a rejection in
  `chat`/`sync` shows up as a turn error; it could flag the credential as
  suspect on screen. That needs per-credential persisted state — not this
  ADR.
- **`openai`/`anthropic` with no verified test endpoint** remain
  `unsupported`. Closed by reading each one's official docs and adding
  the base URL to the tester's map, with a smoke test to prove it.

References [ADR 0004](0004-git-credential-registration.md), whose
ordering this one reverses, and
[ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md),
from which it inherits the rule of only declaring what's been proven.
Neither is edited.

---
traducao_de: cacbded6233a83c548068768eaea16dd24d84bb5
---

# ADR 0158 — The master key's id recorded in the envelope, as observability and never as authority

## Status

**Accepted.** It corresponds to `BRB-016` of the maintainer's register, which
declares a dependency on `BRB-010` — and the dependency is literal: this decision
changes the envelope format, and the proof that the current format survives a
whole rotation was born in the same delivery, in
[RN-562](../business-rules.md#rn-562), **before** this line of code. It does not
revoke [ADR 0027](0027-fase5-backup-hardening-release.md): the envelope scheme,
`CREDENTIALS_MASTER_KEY_PREVIOUS` and `rewrap-deks.ts` remain as they are.

## Context

`CREDENTIALS_MASTER_KEY` wraps the DEKs that encrypt the user's secrets — LLM
keys in `user_credentials` and git tokens in `project_git_connections`. Its
rotation is the procedure with the worst outcome in the runbook, and the runbook
itself writes why (`docs/runbook.md`, section "What's at stake"):

> *"The `wrapped_dek` stored in the database **doesn't identify which key
> wrapped it**."*

Measured on 2026-09-12, in the checkout:

| file:line | what is there |
|---|---|
| `apps/api/src/db/schema/llm.ts:255` | `wrappedDek: text('wrapped_dek').notNull()` — six envelope columns, none saying which key |
| `apps/api/src/db/schema/git.ts:72` | idem, the SAME six columns |
| `envelope-encryption.service.ts:128-138` | `decrypt` tries the current one and falls back to the previous one, inside a `catch` that does not distinguish the reason |
| `envelope-encryption.service.ts:148-160` | `rewrap` does the same, and the `catch` **without a reason** is what decides whether the record is already on the current key |
| `docs/runbook.md`, "Before: size it up" | the only possible query counts **total rows** per table — never how many are left |

Two concrete defects come out of this:

1. **Step 2 of the rotation has no progress.** Whoever interrupts the script
   midway does not know where it stopped; the only way to find out is to run it
   again and read the count it prints. And the question that decides step 3 —
   *"is there still a credential on the old key?"* — has no answer in SQL.
2. **Wrong key and corrupted blob are the same `catch`.** Both produce the same
   generic failure, and they are diagnoses with opposite actions: one asks to
   republish the previous key, the other asks to investigate the record.

The lesson that governs this area is [RN-475](../business-rules.md#rn-475): an
id that should have been recorded inside the material and was not made automatic
mode never authenticate, and cost a hunt for a one-line defect.

## Decision

### 1. The envelope now carries `key_id`, in a COLUMN

`user_credentials` and `project_git_connections` gain a **nullable**
`key_id text`, and `EncryptedSecret` gains `keyId?: string | null`. Both tables
change TOGETHER: they share the same envelope and the same script, and touching
only one would produce a body of data in which the query answers half.

A column, and not a prefix inside the blob, because the main consumer **is an
SQL query** — step 2 of the runbook. A prefix would require reading and decoding
each row to answer "how many are left", which is the question that motivated
everything.

### 2. The value is the FINGERPRINT of the derived key, and nothing more

```
key_id = HMAC-SHA256(chave_derivada, 'brabo-master-key-id')  → 16 primeiros hex
```

This answers the `TODO(humano)` the activity left open — *"where does the value
of `key_id` come from? It cannot be a hash of the key (it gives an offline
verification oracle to whoever reads the database), and a manual counter in the
`.env` is one more variable the operator can get wrong."* Both halves of the
objection were addressed, and the first was **measured, not assumed**:

**There is no new oracle.** Whoever reads the database already has a PERFECT
offline verification oracle, and it is the envelope itself: `wrapped_dek` +
`dek_iv` + `dek_auth_tag` are AES-256-GCM, which AUTHENTICATES. Testing a
candidate passphrase is already today `scryptSync(candidata, SALT, 32)` followed
by a decipher whose tag verifies or not — a right answer, per candidate. With
`key_id`, testing the same candidate is `scryptSync(candidata, SALT, 32)`
followed by an HMAC. **The cost per attempt is the same in both cases, and it is
dominated by `scrypt`, which both need to pay.** An attacker with read access to
the database gains nothing; what they would gain is something they already had.

**And there is no new variable.** The operator does not type the `key_id`
anywhere: it is a pure function of the key the operator already published. There
is no second value to keep in sync, which was the argument the service's
docblock used for not recording any id (`envelope-encryption.service.ts:36-38`,
*"um identificador de chave no registro é mais um metadado a manter em
sincronia"*) — true for an ARBITRARY id, false for a fingerprint.

What is recorded is an HMAC, not the key nor material from it, and it is 8
bytes.

### 3. `key_id` is OBSERVABILITY, never AUTHORITY — and this is where this decision departs from the obvious

The read does NOT start choosing the key by the label. `decrypt` stays **byte for
byte** as it is: try the current one, fall back to the previous one, GCM decides.
`rewrap` also keeps the attempt as the criterion of "already on the current
key".

The obvious path — using `key_id` to skip the attempt — was considered and
**rejected for a failure mode of its own**: a row whose label says "current" but
whose envelope is on the old key would be skipped by `rewrap` silently, would be
left out of the count of rewrapped ones, and step 3 of the runbook would make it
illegible forever. The label is one more piece of data in a column; the envelope
is the truth. **Swapping cryptography's authority for a label turns a metadata
inconsistency into secret loss.**

So the label serves three things, all outside the cryptographic decision path:

- **the query** of step 2 (`WHERE key_id IS DISTINCT FROM '<atual>'`);
- **the diagnosis** when NEITHER of the two keys opens — the message now names
  which key wrapped that record, distinguishing "came from another environment"
  from "record without `key_id`, written before this change" and from "the label
  says it is on the current one and it still does not open", which is the
  inconsistency above and deserves to be said out loud;
- **the origin**, which `rewrap` records together with the new envelope.

### 4. No migration of the existing data

`key_id` is born **on the next write**: `encrypt` records it, `rewrap` records
it. Today's rows stay `NULL`, and `NULL` means exactly *"written before this
change, unknown key"* — never *"on the current key"*. Forcing a rewrap of the
whole body of data only to fill the column would turn an observability
improvement into a risky operation over every credential.

Accepted and declared consequence: **in an existing installation, the step 2
query only becomes valid after the first rotation.** Before it, everything is
`NULL`, and the honest answer of the query is "I know of none", which is
different from zero — that is why the runbook's query counts the three bands
separately (current / previous / unlabeled) instead of a single number.

### 5. The operator needs to know the CURRENT fingerprint, so the api says it

A column nobody can compare against anything is useless. The service now logs at
boot, in ONE line, the fingerprint of the current key, and the rotation warning
that already existed (`:75-78`) now names BOTH. It is the same place the runbook
already tells the operator to look (*"Confirm the api is in rotation mode — it
warns in the log"*).

Coming out in the log is safe by the same argument as point 2: it is an 8-byte
HMAC, and it cheapens no attempt against the database.

## Consequences

**What becomes possible**

- Answering *"how many credentials are still on the previous key?"* in SQL, and
  that is what closes the criterion of `BRB-016`. The runbook uses the query in
  steps 2 and 3.
- Distinguishing, in the output of `rewrap-deks.ts`, a record from another
  environment from a tampered record — before they were the same error line.
- Interrupting step 2 and resuming knowing what is left, without depending on
  the count printed by an execution that has already ended.

**The price, declared**

- A migration on two tables (`ALTER TABLE ... ADD COLUMN key_id text`). Nullable
  and with no default, so it is new metadata in a new column: it does not rewrite
  rows, it does not lock a large table.
- The existing data stays unlabeled until the first rotation (point 4).
- An installation that restores a dump from ANOTHER environment gains a new and
  better symptom: the rows' `key_id` does not match the log's, and
  [Restore](../runbook.md#restore) no longer needs the diagnosis by elimination
  the runbook describes today.

**What does NOT change, and it is the half that matters**

- The algorithm, the DEK size, the `SALT` and `scrypt`. No byte of
  `encryptedApiKey` is rewritten by any of this.
- `decrypt`. The two-key fallback remains the mechanism, and cryptography remains
  what decides.
- The script's name and invocation (`node scripts/rewrap-deks.js`), which the
  runbook already points to.
- The number of rotation steps: still **three**. This decision makes it
  OBSERVABLE, never shorter.

**What stays out, by name**

- KMS, HSM and a per-tenant key remain another design, and ADR 0027 stays as it
  is.
- An index on `key_id`. The two tables are small by nature (one row per
  user/provider, one per project), and the query runs once every many months, in
  a rotation: an index would cost writes every day to save a seq scan twice a
  year.
- The decrypt half of the diagnosis. Whoever reads the diagnosis is the operator
  running the script, and that is where they are; putting the same message on
  the hot read path would change `decrypt`, which this ADR decided not to touch.

# 0056 — The engine works on a remote repository

## Status

Accepted — implemented and proven by test in Phase B of the backlog
([RN-076](../business-rules/custo.md#rn-076)).

An implementation discovery, recorded because it changes the size of the
problem: **two of the four consumers never needed a credential**.
`Engine.Gates.Diff` and `Engine.Harness.ProjectContext` only use the default
branch's NAME — they were stalling on a remote provider as collateral damage
from a function that returned more than they asked for. Splitting
`default_branch/1` from `remoto_de_trabalho/1` unblocked both without a
single token.

## Context

`Engine.Projects.ProjectRepository.get_local_repo_path/1` returns
`{:error, {:unsupported_provider, "github"}}` for anything that isn't
`local`. Four consumers depend on it, and they all stall together:

| consumer | what stops working |
|---|---|
| `Engine.Dev.WorktreeManager` | the dev agent has no worktree — it does not write code |
| `Engine.Actions.TerminalExecutor` | with no workspace, every command fails |
| `Engine.Gates.Diff` | QA and SecOps have no diff to judge |
| `Engine.Harness.ProjectContext` | the agent builds context without the repository |

The asymmetry is the root cause: the **api** talks to GitHub over **HTTP** —
it created the repository, committed the bootstrap files, created the
branches — while the **engine** works on the **filesystem** and only knows a
local bare repo. A project on GitHub does the conversational half and the
bootstrap, and stops halfway through construction.

This is what currently prevents PHASE 13b from being written as-is: it calls
for a measured execution on a project ADOPTED from the fork via the remote
GithubProvider, and that execution has no way to reach the first command.

### What is already ready and doesn't need to change

`Engine.Actions.Workspace.init_from_bare!/3` does `git init` + `remote add
origin <origin>` + `fetch` + `checkout`. **This is already generic**: the
`<origin>` being a local path is an accident of the `local` provider, not of
the design. Swapping the origin for a URL resolves the whole path without
rewriting it.

So what is missing is not git plumbing — it is a **credential**.

## Decision

### 1. The engine asks the api for a working remote, and never stores a credential

The token lives encrypted in `user_credentials`, with envelope encryption,
and the master key belongs to the api. The engine does **not** receive the
master key and does **not** persist a token: it asks the api, over the
`/internal/*` channel that already exists with a service token, for a
project's **working remote**, at the moment it needs to fetch or push.

Giving the master key to the engine would widen the blast radius of the
product's most sensitive secret to save one HTTP call.

### 2. The token NEVER enters `.git/config`

This is the decision that matters most, and it is a direct consequence of
[ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md).

The obvious path — `remote add origin
https://x-access-token:TOKEN@github.com/…` — writes the credential **in
plain text inside the project folder**. And
[RN-075](../business-rules/custo.md#rn-075) just gave the dev agent
**auto-approved** reading inside that folder: a `cat .git/config` would
return the token with no approval whatsoever, and it would travel to the LLM
provider on the very next turn, inside the loop's history.

Path scope protects against the agent reading **outward** from the project.
It does not — and cannot — protect against a secret that the product itself
placed **inside**.

So: `origin` holds the **clean** URL, and authentication is injected per
invocation, alive only for the duration of the git process that uses it.
No credential in a file, not in `.git/config`, not in a persisted helper.

### 3. The credential is the workspace OWNER's

Same rule that [RN-058](../business-rules/custo.md#rn-058) already established for
the LLM key, for the same reason: who pays and who authorizes is the
workspace owner, not the agent nor whoever opened the session.

### 4. `provider: local` stays the same

It is not backward compatibility out of courtesy: the local provider is what
the contract test suite uses and what makes `pnpm dev` work with no
credential at all. A local project's working remote is the bare repo's path,
and the rest of the path does not know the difference.

### 5. Credential failure is `infra`, and it is said

Missing, expired, or under-permissioned token on the repository fails with
origin `infra` — not `model`, not `code`. It is the CLAUDE.md rule about
failure origin, and this round's finding T shows it is violated precisely in
the error paths that nobody exercises.

## Consequences

**What it unblocks.** A project on a remote provider gains a worktree,
terminal, gate diff, and context — that is, the construction half. It is the
precondition for PHASE 13b: without this there is no measured execution on a
remote repository.

**What gets more expensive.** The engine starts depending on the api to work
on the filesystem. A `fetch` can now fail because of the network, an expired
token, or the api being down — three failure modes the local bare repo did
not have. Hence point 5 being a decision and not a detail.

**What this ADR does NOT resolve.** Isolation remains the open problem from
[ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md): the token is
no longer on disk, but the agent still runs in the same container as the
Brabo monorepo. An `env` var on the git process during the window it runs is
a smaller surface than a permanent file, and it is not zero.

## Alternatives considered

**Give the master key to the engine.** Removes the HTTP call and doubles the
places from which every secret in the product could leak. Rejected.

**Token in the `origin` URL.** It is what almost every tutorial does, and is
exactly what ADR 0055 made dangerous: writing the secret in the place where
the agent has auto-approved reading. Rejected — and recorded here because
the temptation to "simplify" back to this will come up again.

**Mirror the remote into a local bare repo and sync.** Would keep the engine
unchanged, but creates a second source of truth for the repository, with
silent divergence whenever someone pushes directly to the provider.
Rejected.

**Keep only `local` and defer.** This is the current state, and it is what
blocks PHASE 13b.

## References

- Finding N from
  [achados-execucao-real.md](../explanation/achados-execucao-real.md), Phase B
  of the [backlog](../explanation/backlog.md).
- [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md) — the scope
  that makes decision 2 mandatory.
- [RN-058](../business-rules/custo.md#rn-058) — whose credential the agent spends.
- `apps/engine/lib/engine/projects/project_repository.ex`,
  `apps/engine/lib/engine/actions/workspace.ex`,
  `apps/engine/lib/engine/actions/git_executor.ex`.

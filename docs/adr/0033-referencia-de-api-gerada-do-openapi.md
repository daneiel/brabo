# 0033 — The API reference comes out of code, and the table test enforces the metadata

## Context

The api exposes **118 routes across 23 controllers**, and until now the only
contract documentation was `docs/security-surface.md`. It answers *who can
call* each route — and nothing about what the route does, what it accepts,
or what it returns. Anyone integrating had to read the controller.

7.1 opened the exception: the two auth controllers were born with
`@ApiTags`/`@ApiOperation`/`@ApiProperty`, and the header of
`auth/dto/auth.dto.ts` recorded the intent — *"the decorators go in NOW,
along with the routes, not in a retroactive sweep."* This delivery is the
retroactive sweep that comment promised wouldn't be needed again, and the
mechanism that makes it the last one.

`@nestjs/swagger` had already been a dependency since 7.1, but
`SwaggerModule` wasn't wired up anywhere: the document didn't exist.

Three findings from the exploration reshaped the delivery before a single
line was written:

1. **`@nestjs/swagger` SYNTHESIZES a response when there's no decorator at
   all.** `api-response.explorer.js` returns `{ '<status>': { description:
   '' } }` for every handler without `@ApiResponse`. Before this phase,
   **111 of the 118 routes** were exactly in that state. The obvious
   assertion — *"every route has a 2xx response"* — would pass green
   without checking anything at all.
2. **`@HttpCode` gets ignored as soon as any `@ApiResponse` exists.** The
   documented status then comes only from the decorator. The bug already
   existed in the repository: `POST /auth/register` and `POST
   /auth/request-password-reset` had `@HttpCode(202)` with
   `@ApiOkResponse`, and the document claimed 200.
3. **Outside auth, no handler declares a return type.** The pattern is
   `return this.useCase.execute(...)`, which resolves to *interfaces* and
   *type aliases* from `src/domain/**` — from which `@nestjs/swagger`
   derives no schema, and about which it emits `{}` **with no warning**.

## Decision

**The reference is generated from OpenAPI and never hand-written**, and the
table test from Phase 5 now enforces the metadata that feeds it.

### Response DTOs mirror the entity by TYPE

There are ~55 distinct response shapes (not 118: `ProposedAction` serves 6
routes, `Session` serves 5). Each one became a class in
`interfaces/http/<domain>/dto/*.response.dto.ts`. Nothing in
`src/domain/**` was touched — putting `@ApiProperty` on an entity would
break the domain's purity.

Writing the DTOs is the easy part. The risk is the day an entity gains a
field and the DTO doesn't: the reference starts lying **silently**. Against
that, two type-level locks, and both are necessary:

```ts
export class SessionResponseDto implements Wire<Session> { … }
export const _chavesSession: MesmasChaves<SessionResponseDto, Session> = true;
```

`implements Session` directly doesn't work — the entity says
`createdAt: Date` and the JSON body says `string`. `Wire<T>` is the entity
**as it goes over the wire**, and there `implements` is honest. But
`implements` is one-directional — it's **blind to extra fields**, and a DTO
that describes a field that's already been removed would compile forever.
`MesmasChaves` ("SameKeys") closes that side.

The four failure modes were verified by execution before a single DTO was
written on top of this:

| error | caught by |
|---|---|
| entity gained a field | `implements` — TS2420 |
| DTO typed `Date` where the wire has `string` | `implements` — TS2416 |
| DTO has a field the entity no longer has | `MesmasChaves` — TS2322, and **only** that one |
| DTO correct | compiles clean |

What runs these locks is `tsc`, not vitest — which transpiles via SWC and
checks no types at all. Hence the new `pnpm --filter api typecheck` in CI:
without it the proof would only run in the image job, twenty minutes later.

### The table test enforces the DOCUMENT, not the decorators

`route-surface.spec.ts` gained seven assertions, all against the document
assembled by `SwaggerModule.createDocument` — the same one that goes to the
site. Reflecting `DECORATORS.API_RESPONSE` handler by handler would test an
intermediate step: a `type:` pointing at an interface would pass the
decorator check and still produce `{}` in the document.

The response assertion requires **resolved content or a non-empty
description**, not merely the presence of a 2xx key — that's finding 1
above forcing the point. The status assertion recomputes the real value
from `HTTP_CODE_METADATA`, which closes finding 2. And the last one ties
the document to the **actual guards**: a `@Public()` route can't declare
`security`, an authenticated route has to declare it. Without it, the
reference could claim a route is open when the guard closes it — getting
it wrong exactly where getting it wrong is expensive.

Excluding a route from the reference requires an entry in
`EXCLUIDAS_DA_REFERENCIA`, and a route with no JSON body requires one in
`SEM_CORPO_JSON` **with its own obligation** (SSE declares
`text/event-stream`, redirect declares the `Location` header, 204 declares
204). Without this, `@ApiExcludeEndpoint()` would be the easy way out of
everything, and "it's a stream" would become a license to document
nothing.

### `--check` uses a manifest, it doesn't regenerate

`pnpm docs:check` promises not to write. Running `gen-api-docs` to compare
would break that promise. The lock is a manifest with the sha256 of each
generated file plus the sha256 of the `openapi.json` that produced them,
written by the same `escrever()` used for every other generated file — and
therefore with the same behavior under check.

It catches the four drifts that matter: hand-edited MDX, stale MDX against
a new spec, missing generated file, and orphan file. Three were verified
by execution.

The ordering of `openapi.json` is fixed (paths, verbs, schemas, tags,
status) because the order Nest delivers comes from module registration
order: without normalizing it, moving one `import` line in `AppModule`
would produce thousands of lines of diff, and the predictable next step
would be someone turning the check off.

### Swagger UI outside production

`/docs` and `/docs-json` only exist with `NODE_ENV !== 'production'`. The
production reference is the docs site, generated from the same document;
serving the entire surface in a real environment adds nothing and hands a
map for free to anyone probing.

## Consequences

The reference has 118 pages, one per route, grouped by tag. The overview —
authentication, error convention, rate limiting — comes from
`info.description`, so it's generated from a single source instead of
written into a `.md` file that would drift.

**A new route with no metadata doesn't get in.** It's the anti-drift
mechanism the docmap doesn't have: the docmap triggers when a file
changes, but it can't see a new route that was born without documentation.

### What the sweep fixed along the way

It wasn't just documentation:

- `PUT /projects/:id/agent-autonomy` and `DELETE
  /projects/:id/members/:userId` returned **200 with an empty body.**
  `api-client.ts` on the web app only treats 204 as "no body" and fell
  through to `res.json()`, throwing a `SyntaxError`. Both became
  `@HttpCode(204)`.
- `UpdateWorkspaceDto` and `UpdateProjectDto` used `PartialType` from
  `@nestjs/mapped-types`, which copies only validation. Both would have
  come out **with no properties at all** in the document.
- The class-level `@ApiBearerAuth` on `GitController` leaked into the
  OAuth callback, which is `@Public()` — the reference claimed the browser
  needs a token to come back from the provider. No `@nestjs/swagger`
  decorator clears an inherited requirement, so the declaration moved to
  per-route.
- Both `@HttpCode(202)`s in auth were documented as 200.

### Accepted costs

- **2.7 MB of versioned generated output** (117 MDX plus 352 JSON files
  they `require()`). Without it the docmap would have a dead rule and `git
  ls-files` would see nothing.
- **No per-language snippets.** `postman-code-generators` runs a nested
  `npm install` in its postinstall — network access in the middle of our
  install, which is exactly what Phase 5's discipline refuses. It went
  into `allowBuilds` as `false`.
- **The entire `outputDir` gets wiped** by `clean-api-docs`, so the spec
  lives one level up. A generator that deletes its own input works on the
  first run and fails on the second.
- **The generated sidebar ids come out one level too deep**, because the
  plugin assumes `outputDir` sits inside the site. The fix lives in the
  hand-written `sidebars.ts`, not in a rewrite of the generated file —
  mutating it would make `docs:check` flag drift on every run.

### What's still open

`engine_api_client.ex` still has **no automatic check** that it matches
the api's routes. The reference gives both ends the same source to compare
against, and the `TODO(humano)` in `internal-api.md` remains valid: what
would truly close this is generating the Elixir client from
`openapi.json`, or a contract test between the two ends.

Also out of scope: a generated TS client for the web app (`api-client.ts`
stays hand-written), api versioning, and removing the scaffold's `GET /` —
which got `@ApiExcludeEndpoint()` with a justification instead of being
deleted, because removing it is a product decision.

References [ADR 0027](0027-fase5-backup-hardening-release.md), which
created the table test, and [ADR
0031](0031-auth-first-party-argon2id-e-rotacao-de-refresh.md), where the
first decorators went in.

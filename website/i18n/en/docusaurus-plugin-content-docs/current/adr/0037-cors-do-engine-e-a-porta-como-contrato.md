# 0037 — The CORS the engine didn't have, and the port as part of the contract

## Context

A report of "CORS problem between web and api" led to a check of the
system's **three communication pairs**. The result was one broken pair, one
pair that was never at risk, and a root cause that wasn't CORS at all.

Everything below was measured, with `curl -H "Origin: …"` and with headless
Chrome reading the console — not deduced from reading the code.

### What's correct

| pair | mechanism | verdict |
|---|---|---|
| web → api (HTTP) | Nest's CORS, `WEB_ORIGIN` | **ok** — preflight returns `allow-origin`, `allow-headers` with the four headers, `allow-credentials` |
| web → engine (WebSocket) | Phoenix's `check_origin` | **ok** — handshake responds `101`; WebSocket doesn't go through CORS, and `check_origin` had already read `WEB_ORIGIN` since Phase 4a |
| api → engine (`/internal/*`) | service token (RN-035) | **ok, and CORS doesn't apply** — `401` without token, `400` for validation with token, and IDENTICAL response with and without `Origin` |
| engine → api (`/internal/*`) | service token | **ok, and CORS doesn't apply** — `403` without token, `400` with token, same for `Origin` |

The last two deserve to be spelled out, because the question is natural and
the answer is structural: **CORS is a browser mechanism.** Whoever calls in
those two directions is a server-side HTTP client (Node's `fetch` in the api,
Finch in the engine), which doesn't implement the same-origin policy and
ignores those headers entirely. There's nothing to configure, and configuring
it would be worse — see decision 2.

### What's broken: web → engine over HTTP

The engine's endpoint **had no CORS at all**. `GET /health` responded `200`
with the correct body and without a single `Access-Control-*` header, so the
browser discarded the response:

```
Access to fetch at 'http://localhost:4000/health' from origin
'http://localhost:5173' has been blocked by CORS policy: No
'Access-Control-Allow-Origin' header is present on the requested resource.
```

The visible effect: `StatusPage` showed **`engine: error`** while the engine
was perfectly healthy. No test caught this, and not out of carelessness — on
the server side the response was correct. What was missing was a header, and
a controller test doesn't assert a CORS header.

The defect predates this session, but became more visible now:
[ADR 0036](0036-telas-de-auth-fieis-ao-design-e-fontes-auto-hospedadas.md) made
`/status` public and linked it in the footer of the auth screens, so the
broken line became reachable before login.

### The root cause of the original report, which wasn't CORS

`vite.config.ts` fixed `port: 5173` **without `strictPort`**. With 5173 taken
— a forgotten `pnpm dev` in another terminal, the dev compose on the same
host — Vite comes up on **5174** and warns in a single line of the boot log.
The api accepts exactly `http://localhost:5173`, so the app opens normally
and **everything** gets blocked:

```
blocked by CORS policy: … 'http://localhost:3000/health'      (origin 5174)
blocked by CORS policy: … 'http://localhost:3000/auth/refresh' (origin 5174)
blocked by CORS policy: … 'http://localhost:4000/health'      (origin 5174)
```

The blocked `/auth/refresh` is what makes the screen look logged out. And the
message talks about CORS, not port — so all the time goes to the wrong place.
Worse: the natural "fix" is to loosen the api's CORS, which fixes 5174 and
breaks 5173.

## Decision

### 1. A CORS plug of our own in the engine, instead of Corsica

`EngineWeb.Plugs.Cors`, ~40 lines of logic. `Corsica` is the obvious choice
and solves much more than is needed here: this plug serves `GET`/`HEAD`, with
no credential, on three fixed paths, with two headers in the list.
`CLAUDE.md` requires justification for a new lib, and "40 lines" is the
justification.

If one day the engine exposes a real browser-facing API — `POST`, cookie, a
custom header — switching to Corsica pays for itself. The moduledoc records
this, so the next person knows the alternative was considered.

### 2. The plug lives at the ENDPOINT, and filters by path

Not in a router pipeline, and the reason is measurable: a router pipeline
only runs after a route matches. There's no `OPTIONS` route, so a preflight
dies with `404` before any pipeline plug — verified before the fix
(`OPTIONS /health` → `404`). A CORS plug that never sees a preflight is half a
plug, and the missing half is the one that breaks the day the web adds a
header.

At the endpoint it sees everything, and the price is stating explicitly where
it applies. It's the same design as `EngineWeb.Plugs.AccessLog`, which also
filters by path prefix because it can't depend on the router.

**The allowlist is `/health`, `/live` and `/ready`.** Two deliberate
exclusions, and both are about security:

- **`/internal/*`** — the 13 routes through which the api commands the
  engine. As established in the context, CORS wouldn't enable anything
  there; what it WOULD do is **announce to a browser that it's an expected
  client of that channel**. That's information we don't want to give, about
  a surface we don't want anyone trying to reach from the browser.
- **`/metrics`** — Prometheus scrape. An internal metric has no reason to be
  readable by JavaScript from any page.

### 3. An unknown origin gets a response, not `403`

The request is served normally and goes out **without** the header; the one
who blocks reading it is the browser, and that's whose decision it is.
Responding `403` would turn every legitimate request without `Origin` —
kubelet probes, `curl`, `docker/smoke.sh` — into a new failure mode, created
by accident while fixing something else.

`vary: origin` accompanies `allow-origin`. It's not decoration: without it, a
proxy that caches the response from one origin could serve it to another with
the wrong header inside.

### 4. `WEB_ORIGIN` is read ONCE, feeding both consumers

The socket's `check_origin` already read the variable; the new plug needed
the same list. The duplicated reading is **how the gap appeared**: the socket
had its origin configured two phases ago, and HTTP had nothing, because
nothing forced the two to stay in sync.

Now `runtime.exs` computes `:web_origins` once, at the top, and `check_origin`
now derives from it.

**In production there's no development default.** The api raises an
exception at boot when `WEB_ORIGIN` is missing (`cors-origins.ts`); the
engine leaves the list **empty**, which closes browser access without
bringing the process down. The asymmetry is deliberate: CORS is the whole
reason that part of the api exists, but in the engine it's peripheral — Oban
queues and Phoenix channels keep working. An engine that refuses to boot
because of a status panel trades a small problem for a big one.

An empty list also does **not** become `check_origin: []`, which Phoenix
would read as "no origin matches" and would bring down the team's live
panel. In that case, Phoenix's strict default applies (`true`, comparing
against `PHX_HOST`).

### 5. `strictPort: true` in Vite

The port is part of the CORS contract, so it can't be chosen silently. With
`strictPort`, Vite refuses to start and says `Port 5173 is already in use` —
which is the true information, instead of three CORS errors pointing to the
wrong place.

The cost is real and accepted: whoever wants two dev servers running at once
now needs an explicit `--port`. Choosing explicitly is exactly what's wanted,
because the other port needs to go into `WEB_ORIGIN` anyway.

### 6. `maxAge` on the api's and the engine's CORS

**Every** call from the web to the api is preflighted: `api-client` sends
`Authorization` and `traceparent`, which aren't safelisted. Without preflight
caching, each request is two round trips. The browser's cache is keyed by
URL+method, and with TanStack Query's `refetchInterval` hitting the same URL
over and over, that's exactly where it pays off.

10 minutes on both. Short enough that a change to `allowedHeaders` doesn't
get stuck in the cache of someone with the tab already open.

## Consequences

- **`StatusPage` now tells the truth.** Before: `api: ok`, `engine: error`
  with the engine up and running. After: both `ok`, and zero CORS errors in
  the console.
- **Port collision stops disguising itself as a CORS problem.** It's trading
  a silent, misleading failure mode for a loud, correct one.
- **`/internal/*` still has no CORS, and now there's a test asserting that.**
  The boundary became an assertion — including one about the path list
  having exactly three entries, so that moving the boundary shows up in the
  diff.
- **One fewer dependency than the obvious solution**, and a moduledoc
  explaining when to reverse the decision.
- **The engine got its first HTTP header test.** The 15 cases cover what a
  controller test structurally can't: the response was correct and the
  header was missing.

### What remains pending

- **`exposedHeaders` wasn't configured on either side.** Today the web
  doesn't read any response header — the `trace_id` in `ApiError` comes from
  the trace the client itself generated, not from the server. Configuring it
  now would enable a capability with no use.
- **The engine has no CORS for `POST`**, on purpose: nothing in the browser
  makes a `POST` to it. When it does, the method list and header list need
  to grow together — the preflight test is where that will be noticed.
- **`EngineWeb.RouteSurfaceTest` is failing on `origin/dev`** since before
  this change (`ActionClauseError` in `SessionCommandController.create/2`,
  due to an empty body in the test that asserts the internal routes accept a
  valid token). Verified to fail the same way with no change from this
  delivery, and no commit here touches `apps/engine` beyond what's described
  above. Recorded here, not fixed: it's a different matter.

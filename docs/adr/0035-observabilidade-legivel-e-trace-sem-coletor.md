# 0035 — Trace without a collector, and the path between layers in the log

## Context

[ADR 0026](0026-fase5-observabilidade-e-graceful-shutdown.md) designed
end-to-end correlation: a session is a root trace, `traceparent` travels
through the three injection points, and all three services log JSON with
the same `trace_id`. None of that was wrong. The problem is that, **in
development, none of it existed** — and development is where a log gets
read with human eyes.

Decision 9 of that ADR made instrumentation conditional on
`OTEL_EXPORTER_OTLP_ENDPOINT`, on the grounds that an exporter delivering
to nowhere floods the log with connection failures. That reasoning is
true. The implementation conflated two different things: **creating**
telemetry and **delivering** telemetry.

In the api, without the variable, `NodeSDK` wasn't even constructed.
Without `start()` there's no context manager or propagator registered, so:

- `currentTraceId()` returned `undefined` and pino's `mixin` never stamped
  `trace_id` on any line;
- the `traceparent` the web app sends on **every** request was silently
  dropped;
- `injectTraceHeaders` injected nothing into calls to the engine.

The engine's gate was worse: **inverted**. There is (and was) no
`:opentelemetry` config in the project, so the SDK came up with
`otel_configuration`'s default, which is `{opentelemetry_exporter, %{}}`
pointing at `localhost:4318`. The engine paid for a doomed batch in
development **and in `mix test`** — exactly the cost the gate claimed to
avoid. And what the gate was actually turning off was
`OpentelemetryBandit.setup()`, i.e. the **extraction** of the incoming
`traceparent` — the one piece that makes the engine's span a child of the
api's span. `Engine.Telemetry.Span`'s moduledoc claimed everything became
a no-op without a collector; that was false, and the test alongside it now
proves the opposite.

Three correlation gaps turned up while investigating, all of them silent:

1. `Engine.Outbox.Event` didn't declare the `metadata` column. The struct
   had no such key, `Drain.traceparent/1`'s first clause was
   **unreachable**, and every Oban job was born with `traceparent: nil`.
   The api had been writing the column correctly since Phase 5. No worker
   read the argument, so fixing only the schema would leave the data
   inert.
2. The engine→api `traceparent` was injected inside `post_returning/3`, a
   funnel only for POSTs. The six `Req.get` calls and `llm_turn_stream`
   went out with no trace — the entire read half of the conversation
   between the services showed up as an orphan trace.
3. `chat-stream.ts` bypasses `api-client.ts` and wasn't sending
   `traceparent`. It was the only path on the web app with no trace, and
   the worst possible one: the LLM turn.

On top of that, the original request that started this work: the log was
hard for people to read, didn't say where a line came from, and didn't
show the path a user's action took across layers.

## Decision

**1. Instrumenting and exporting are separate decisions.** The SDK comes
up always, in both services. `OTEL_EXPORTER_OTLP_ENDPOINT` now controls
only the destination:

| | with endpoint | without endpoint |
|---|---|---|
| api | OTLP `traceExporter` | `spanProcessors: [NoopSpanProcessor]` |
| engine | `opentelemetry_exporter` default | `traces_exporter: :none` |
| context and propagation | registered | **registered** |

The explicit `spanProcessors` in the api isn't decoration: without it the
SDK falls back to `getSpanProcessorsFromEnv()`, which with
`OTEL_TRACES_EXPORTER` empty builds an exporter pointing at
`localhost:4318` — the same defect the gate was trying to avoid. And the
list needs at least one element, because `sdk.start()` only registers the
global tracer provider when `spanProcessors.length > 0`; with no provider
the span is born invalid and the propagator injects nothing.

Both choices are memory-safe, by construction: `NoopSpanProcessor` retains
nothing in `onEnd`, and Erlang's `otel_batch_processor` calls `disable/1`
when the exporter is `none` and starts returning `dropped` without ever
touching ETS. The alternatives wouldn't be — `BatchSpanProcessor` with a
dead exporter holds onto 2048 spans and keeps retrying, and
`InMemorySpanExporter` grows without bound.

**2. `tracing.ts` exports a function, and the side effect lives in
`tracing-boot.ts`.** Having `startTracing()` as a function lets a spec
import the module without registering global state — which would break
`trace-context.spec.ts`, which asserts the opposite on purpose. But the
call can't sit in the body of `main.ts`: TypeScript and SWC hoist all
`require`s to the top, so a line placed among imports would run **after**
`pg` and `express` load, and the monkey-patch doesn't take on an
already-loaded module. A separate module solves it because `require` is
synchronous.

**3. The path between layers comes from `AsyncLocalStorage`, not from
spans.** A `@Traced('<layer>')` decorator at the boundaries records class,
method, layer and duration in a per-request context; a global interceptor
emits **one** line at the end. A span is also opened, but the path doesn't
depend on it — that's what makes the feature work without a collector.

The pattern is the same one `drizzle-context.ts` already used to carry the
active transaction through the call stack. The context has a **cap of 64
steps**: without it, a use case calling a repository in a loop would grow
the array for the request's whole lifetime and then serialize all of it
into one log line.

Steps are recorded on method **entry**, not on exit. Recording on exit
would give termination order — the innermost call finishes first, and the
path would come out inside-out.

**4. `@Traced` is forbidden under `apps/api/src/interfaces/http/**`.** A
hard rule, and the reason is security. Nest's decorators (`SetMetadata`
and derivatives) write metadata **onto the method's function object**;
legacy decorators apply bottom-up, so replacing `descriptor.value` discards
metadata written below it. On a controller that means a `@RequireRole`
disappearing — it compiles, it passes the suite, and it's an authorization
hole.

There's nothing to gain by decorating a controller anyway: the interceptor
covers the HTTP boundary for free, reading `ExecutionContext.getClass()`
and `getHandler()`. The option with no diff across 30 files is also the
safe one. (The decorator forwards the metadata regardless, as belt and
suspenders.)

Two exclusions for the same technical reason: **nothing that returns an
`Observable` or is a generator.** The "is it thenable?" heuristic would
classify both as synchronous and close the span before the stream
produces. `traced-llm-provider.chat` is an async generator and was left
out; the `@Sse` handler is covered by the interceptor, which uses
`finalize`.

**5. `ownSpan: true` for whoever already manages their own span.**
`CreateSessionUseCase.execute` opens `session.create`, which ADR 0026
designates as the root of the session's trace and which
`docs/reference/events.md` documents as the root. Wrapping it would make
the decorator's span the root instead: `trace_id` would still be correct,
and the docs would become false without anything breaking. With
`ownSpan`, the path step is recorded and no new span is opened.

**6. Pretty in development, one JSON line in production.** In production,
`transport` stays absent and pino writes one `JSON.stringify` per event —
that's a requirement, not aesthetics: Alloy reads the pod's stdout line by
line.

In development `pino-pretty` runs **in-process**, as a stream, not via
`transport`. The reason is concrete: `transport` runs on a worker thread
and its options pass through structured clone, so `messageFormat` and
`customPrettifiers` **as functions** can't be passed — and those are what
draw the layer tree. The `require` is wrapped in try/catch, because
`pino-pretty` is a devDependency and doesn't exist in the production
image; the fallback is JSON, which is the right failure mode for a logger.

In the engine, `Engine.Telemetry.LogFields` became the single source for
the fields, `JsonLogFormatter` only serializes, and a new
`PrettyLogFormatter` covers dev — where `dev.exs` had been discarding the
timestamp and all metadata, leaving `trace_id`, `session_id` and `mfa`
invisible.

**7. `trace_id` stays a contract, and nothing about it changed.** New
fields (`path`, `duration_ms`, `layer_count`, `layer`, `class`, `fn`) go in
as flat siblings. Alloy's `stage.json` selects by expression rather than
enumerating, so a new sibling key is ignored and Loki's `derivedFields`
keeps working. The `layers` array stays **out** of production: as a string,
`path` is ~150 bytes; as an array, 5-10× that, and Loki charges by the
byte.

**8. The three gaps, closed together.** `field :metadata` on the outbox
schema plus `Span.with_session(args["traceparent"], …)` and
`Logger.metadata(session_id:)` in both workers —
`Logger.metadata/1` wasn't being called anywhere in the engine, and that's
why the formatter's `session_id` field always came out missing. A single
`headers/0` funnel in `EngineApiClient`, covering all 8 call sites. And
`traceparent` in `chat-stream.ts`.

## Consequences

- With **zero collector**, `pnpm dev` produces three log streams sharing
  the same `trace_id`, generated in the browser. That's the difference
  between being able to follow a user action across processes and not
  being able to.
- One line per request shows the path across layers with each step's
  duration. As an indented tree in dev; as the `path` field in production.
- Agents' asynchronous work became genuinely correlatable: the job the
  Psychologist agent fires on a session closing now carries the
  `trace_id` of the session that triggered it. Before, every job had
  `traceparent: nil`.
- The read half of the engine→api conversation left orphanhood, including
  `llm_turn_stream`.
- The engine stopped paying for a doomed export batch in dev and in the
  test suite.
- The api's log gained a shape test that didn't exist before: one line in
  production, `trace_id` at the top, and the `redact` list as a contract.
  The list grew to include the api↔engine service token, which had
  **not** been redacted.
- CORS's `allowedHeaders` became explicit. Before, all correlation
  depended on the `cors` package's default, which reflects back whatever
  header was requested in the preflight — implicit library behavior, with
  no test covering it.
- The engine gained an access log (there was none before), and refusing a
  service token stopped being silent.
- `WEB_LOG_LEVEL` turned on in k8s: `logger.debug` was dead code in every
  published environment.
- Two pieces of text that claimed the opposite of the actual behavior
  were corrected: `Engine.Telemetry.Span`'s moduledoc and cause 1 of "when
  there's no trace" in the runbook — the latter was already false for the
  engine even before this change.

## Known limitations

1. **The guard runs before the interceptor.** `JwtAuthGuard`,
   `RateLimitGuard` and `RolesGuard` sit outside the path (~1-3ms, already
   visible as `pg` spans in Tempo). The upgrade path is additive: move
   just `runWithRequestContext` into a middleware and keep the
   interceptor seeding and emitting.
2. **`depth` under concurrency is approximate.** A `Promise.all` of
   decorated calls interleaves the depths and the tree comes out skewed.
   Critical paths are sequential.
3. **The SSE line arrives when the stream closes**, via `finalize` —
   possibly minutes after the request began. It's consistent with
   pino-http's `res` line, which also waits for the response to finish.
4. **`genReqId` wasn't touched.** It would be a second correlation key
   that nothing consumes, alongside the field ADR 0026 calls a contract.
   Correlation happens via `trace_id`.
5. **The web app's log doesn't reach Loki.** Alloy only reads pod stdout.
   The browser's `trace_id` lets a human match the console line to the
   server-side span — what ADR 0026 recorded still holds.
6. **`@Traced` is applied only on the critical paths** (sessions, actions,
   auth, and the api↔engine bridge). The rest of the repositories remain
   outside it, by scope choice, not by obstacle.
7. **No RN was created.** Business rules live in `apps/api/src/domain/`,
   which is pure; observability isn't a business rule. Recorded here so
   it doesn't look like an oversight.
8. **The web app didn't gain an error boundary**, and ~20 silent
   `catch {}`s remain silent outside the auth and chat paths. A boundary
   is a UI decision, and converting the rest is mechanical — both deserve
   their own change.

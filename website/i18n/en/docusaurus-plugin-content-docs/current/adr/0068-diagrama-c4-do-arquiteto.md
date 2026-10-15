# ADR 0068 — Architect's C4 diagram

- **Status:** accepted
- **Date:** 2026-08-12
- **Context:** user request — the Architect gains a new deliverable,
  rendered on the project's Overview page
- **Extends:** the same artifact-without-table pattern from
  [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)
  (`artifact.project_image`)

## Context

The Architect's deliverables today are text and structured data — `module_map`
(a grid of cards), ADRs (a list with a PR link), insights. None of them is an
image of the architecture. The request is a C4 diagram (Simon Brown's model —
at least Context and Container) actually rendered on screen, not an outbound
link.

Two architecture questions, before coding:

**Who writes the Container level — the model or the repository?** The
`module_map` already exists, validated cycle-free (`create_module_map`).
Letting the model RE-TYPE the modules and dependencies in the diagram's tool
call risks silent divergence: the diagram would say one thing, the current
`module_map` another, and there would be no way to know which one lied. The
alternative — deriving the Container level from the current `module_map`, in
the use case, and never from what the model writes anew — closes that
divergence by construction. The Context level has no such source: who the
external actors are (the user, a Git provider) is the Architect's judgment,
with no `module_map` of actors to derive from. So only Context comes from the
tool call.

**What to render with?** `apps/web` had no diagramming library at all (zero
occurrences of "mermaid" in `package.json` before this change); the docs site
uses Mermaid, but at BUILD-TIME (Docusaurus). Mermaid is the de facto standard
engine for diagrams-as-text, including native support for
`C4Context`/`C4Container` — we don't write a layout engine. User decision,
confirmed before this change: `mermaid` enters as a new RUNTIME dependency of
the React app, the first of its kind.

## Decision

**The C4 diagram is a versioned artifact in the event log, with no table —
the same design as `artifact.project_image` (ADR 0065) — with the Container
level DERIVED from the current `module_map`, never re-typed by the model.**

- `artifact.c4_diagram`: `CreateC4DiagramUseCase` fetches the current
  `module_map` (`ModuleMapRepository.findCurrent`); without it, it refuses
  with 400 — there is no Container level without modules. It generates the
  two Mermaid syntaxes (`gerarDiagramaContexto`/`gerarDiagramaContainer`,
  pure functions, in `domain/architecture/c4-diagram.ts`) and writes the
  event with `version` = `GetC4DiagramUseCase.execute(projectId).version + 1`
  — the same "current is the highest `version`" reading used by
  `ObterContainerDoProjetoUseCase`. Re-emitting means generating again; the
  history is never rewritten.
- No regex in syntax generation: module/actor names come from the model (or
  from what the model already wrote in `create_module_map`), and a
  `js/polynomial-redos` here would be the same HIGH severity that
  `project-container.ts` already avoids. Label escaping and Mermaid id
  generation are character-by-character, the same style as
  `referenciaDeImagemValida`.
- `create_c4_diagram` tool on the Architect: `system_name` (required),
  `system_description`, and `actors` (name + `person`/`external_system` +
  description). Thin — it only normalizes and passes through; validation and
  derivation happen in the api, the same pattern as
  `create_module_map`/`choose_project_image`.
- `mermaid` isolated behind `apps/web/src/lib/mermaid-render.ts`
  (`renderMermaid(id, sintaxe)`), with a DYNAMIC `import()` — whoever never
  opens the Overview page with a generated diagram doesn't pay for the
  bundle. `vite build` confirms it: only `index-*.js` (the entrypoint) loads
  eagerly; Mermaid's chunks (`mermaid.core`, `c4Diagram-*`, and its heavy
  dependencies — `cytoscape.esm` 435 KB, `katex` 258 KB — used only by OTHER
  diagram types this product doesn't generate) stay on-demand.
- `C4DiagramView.tsx` (apps/web) — three states per diagram (RN-088):
  `rendering` (Skeleton), `error` (Alert with Mermaid's message + the raw
  syntax collapsed in `<details>`, NEVER a broken screen), and `ready` (the
  SVG, via `dangerouslySetInnerHTML` — content WE generate with
  `mermaid.render`, not third-party HTML passed through, with
  `securityLevel: 'strict'` in Mermaid). The fourth state, "no diagram at
  all", belongs to the section that calls the component
  (`ArchitectureSection`), same as already exists for `moduleMap`/ADRs.
- Mermaid theme read from the design system tokens at runtime
  (`getComputedStyle` over `--surface-*`/`--text-*`/`--border*`), never a
  fixed color — not because the app has a theme toggle today (it doesn't:
  dark is primary), but to avoid hardcoding a palette that already exists in
  `tokens.css`.

### CSP — confirmed, no change

The web image's nginx has a locked-down CSP since ADR 0058
(`script-src 'self'`, no `unsafe-eval`/`unsafe-inline`;
`style-src 'self' 'unsafe-inline'`). Checked against the production assets
(`grep -rl "new Function(\|eval(" dist/assets/*.js`): NO Mermaid chunk uses
`eval`/`new Function`. `style-src` already had `unsafe-inline` before this
change (for another reason — the app's own inline CSS), and it's what
covers the `<style>` the Mermaid SVG may embed. No line of `nginx.conf`
changed.

## Consequences

- **Bigger bundle, but on demand.** `pnpm build` confirmed correct
  code-splitting: the entrypoint (`index-*.js`) didn't grow with the full
  weight of Mermaid — only whoever actually renders a diagram downloads its
  chunks. The real cost (not measured in network bytes, only confirmed as
  lazy) falls on the first time the Overview page shows a generated
  diagram.
- **Only Context and Container.** Component and Code (C4 levels 3 and 4) are
  left out — the `module_map` has no component/code granularity, and
  inventing that granularity wasn't requested.
- **A dense diagram gets no special treatment.** A `module_map` with dozens
  of modules produces a large Container diagram; there's no virtualization
  or collapsing — the same cut PHASE 26 already made for the Code tab ("the
  most expensive one in the program"), accepted for now.
- **Divergence between the diagram and the module_map is only temporal, never
  a data mismatch.** Since the Container is DERIVED at generation time, an
  old diagram can become stale if the `module_map` changes afterward — but it
  will never LIE about what existed at the moment it was generated, because
  it wasn't the model who described the modules.

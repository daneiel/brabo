# design/

Design system do Brabo — fidelidade estrita exigida na UI (ver `CLAUDE.md`).

- **`tokens.css`** — cores (paleta + tokens semânticos dark/light),
  tipografia (Space Grotesk/Archivo/IBM Plex Mono), espaçamento e
  radius. Extraído do projeto claude.ai/design ["Brabo Design
  System"](https://claude.ai/design/p/1c960ca8-5e00-4558-8ced-80dfbdf01027?file=Brabo+Design+System.dc.html)
  em 2026-07-23. É consumido diretamente por `apps/web/src/index.css`.
  Dark é o tema primário; `[data-theme="light"]` no `<html>` troca para
  o tema claro.
- **`COMPONENTS.md`** — catálogo dos componentes (base: botões, inputs,
  tabs, toasts, modal, tabela densa, cards; de produto: AgentCard,
  TokenMeter, EventItem, ApprovalCard, ModelPicker, NotificationBell),
  extraído do mesmo projeto (arquivo `Brabo Design System.dc.html` +
  os 5 arquivos de tela) em 2026-07-23.
- **`SCREENS.md`** — composição de cada tela (shell+dashboard, projeto
  com tabs, sessão/chat, aprovações, configurações), mesma fonte.

Os `.dc.html` originais usam a sintaxe de template do canvas do
claude.ai/design (`sc-for`/`sc-if`/`{{ }}`) — não são código executável,
por isso não foram copiados verbatim pro repo; `COMPONENTS.md`/`SCREENS.md`
são a tradução curada usada como base pra implementação real em
React/TSX em `apps/web`. Pra reconferir algum detalhe visual não coberto
por esses dois arquivos, o projeto original permanece acessível via
`DesignSync(get_file)`.

Toda implementação de UI deve referenciar sempre os tokens semânticos
(`var(--surface-*)`, `var(--text-*)`, `var(--accent)` etc.) — nunca a
paleta bruta nem valores de cor/espaçamento inventados.

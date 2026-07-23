# design/

Design system do Brabo — fidelidade estrita exigida na UI (ver `CLAUDE.md`).

- **`tokens.css`** — cores (paleta + tokens semânticos dark/light),
  tipografia (Space Grotesk/Archivo/IBM Plex Mono), espaçamento e
  radius. Extraído do projeto claude.ai/design ["Brabo Design
  System"](https://claude.ai/design/p/1c960ca8-5e00-4558-8ced-80dfbdf01027?file=Brabo+Design+System.dc.html)
  em 2026-07-23. É consumido diretamente por `apps/web/src/index.css`.
  Dark é o tema primário; `[data-theme="light"]` no `<html>` troca para
  o tema claro.

## O que falta

Esse mesmo projeto de design também documenta componentes (botões,
badges, forms, tabelas, ícones...) que ainda não foram traduzidos para
componentes React reais em `apps/web` — só os tokens fundamentais
(cores/tipografia/espaçamento/radius) foram extraídos até agora. Quando
for a hora de implementar os componentes, volte a esse projeto de
design como fonte da verdade.

# ADR 0244 — Coluna das abas do projeto alinhada à esquerda

- **Status:** aceito
- **Data:** 2026-11-03
- **Revisa:** o [ADR 0078](0078-moldura-de-tela-e-o-registro-de-abas-diverge-do-handoff.md) no ponto da coluna de conteúdo centralizada em 1040px.

## Contexto

As abas do projeto desenhavam o conteúdo numa coluna de 1040px centralizada
(`margin: 0 auto`), enquanto o cabeçalho ficava à esquerda. O dono (AT-720,
03/11) pediu o conteúdo alinhado ao cabeçalho.

## Decisão

1. `.body` de `ProjectPage.module.css` mantém `max-width: 1040px` (largura de
   leitura) e perde a centralização: a coluna começa na esquerda.
2. A aba Código e as abas `semRespiro` não usam a coluna (ADR 0211/0241) e não mudam.

## Consequências

- Em telas largas sobra espaço à direita, de propósito.

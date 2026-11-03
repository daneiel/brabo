# ADR 0238 — O grafo de módulos da Arquitetura vira Canvas (`@xyflow/react`)

- **Status:** aceito
- **Data:** 2026-11-02

## Contexto

A AT-683 (decisão do dono, 02/11/2026) aprovou trocar a lista de cartões de
módulos da aba Arquitetura por um grafo. A prévia v5 do vault mostrou o Canvas
funcionando; os ⚠️ dela (título do nó com a stack inteira, controles de zoom
brancos no tema escuro) foram corrigidos aqui.

## Decisão

1. Dependência nova no `apps/web`: `@xyflow/react` (~1,2 MB descompactado).
2. Peso medido: chunk próprio de ~42 KB gzip. O `GrafoDeModulos` o carrega por
   `import()` dinâmico (`React.lazy`), no mesmo molde do ADR 0234 e da AT-300,
   então nada dele entra na carga inicial.
3. O grafo é DERIVADO do `module_map` vigente (RN-149): nós = módulos, arestas
   = `dependsOn` (dependência inexistente é ignorada). Nunca é redigitado.
4. Título do nó = nome do módulo; a stack vai em texto menor e truncado. Cores
   e controles de zoom saem de tokens `var(--…)`, nunca de hex, nos dois temas.
5. Os cartões de módulo continuam abaixo do grafo.

## Consequências

- Uma dependência a mais para acompanhar no `pnpm audit`.
- Módulo sem módulos continua mostrando o texto de estado vazio.

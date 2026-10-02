# 0206 — A referência da API vira uma página Redoc

## Status

**Accepted.** 2026-10-02 (AT-359; decisão do dono em 02/10). Revisa, sem
editá-lo, o [ADR 0033](0033-referencia-de-api-gerada-do-openapi.md) na metade
de PUBLICAÇÃO: a spec continua saindo do código (`docs/reference/openapi.json`,
DTOs por tipo, teste de tabela) e o `openapi:types:check` do web não muda.

## Context

O ADR 0033 publicava a referência com `docusaurus-plugin-openapi-docs` e
`docusaurus-theme-openapi-docs` (5.1.2): 235 `.mdx` gerados em
`docs/reference/api/`, travados por um manifesto de hashes. Os dois arrastam
`postman-collection@5.3.1`, que pina `@faker-js/faker@5.5.3` EXATO — alerta
High #43, GHSA-qxc2-j82w-r537. Medido em 02/10: nenhum pai da cadeia tem versão
que saia do faker 5.5.3, e o override para a 10.x reprova o `docs:build`
(API da v5 removida). Não havia como fechar o alerta mantendo o plugin.

## Decision

Trocar o par de pacotes pelo **Redocusaurus** (`redocusaurus` 2.5.x): UMA
página Redoc, com SSR, em `/reference/api/`, lida da mesma
`docs/reference/openapi.json`. Por que ele: é preset do Docusaurus 3, renderiza
no servidor (a página sai no HTML do build, conferível sem navegador), segue o
tema do site e não puxa `postman-collection` nem faker.

- `pnpm docs:generate` deixa de gerar `.mdx` e o manifesto
  `.openapi-manifest.json`; `docs/reference/api/` sai do repositório.
- A sidebar ganha um LINK para `/reference/api/` no lugar da categoria por tag.
- `scripts/docs/api-render-check.mjs` continua sendo a guarda pós-build (a
  lição do 0033: build verde não é página que renderiza), agora afirmando no
  HTML dos dois idiomas o título da spec e uma seção por operação.

## Consequences

- Fecha o alerta #43: `@faker-js/faker` e `postman-collection` saem da árvore
  do `website/`. Dois overrides ficaram sem consumidor e saíram
  (`js-yaml@>=5.0.0 <5.2.2` e `undici@>=6.0.0 <6.28.1`, que só chegavam pelo
  plugin), além do `allowBuilds` de `postman-code-generators`.
- PERDAS aceitas pelo dono: as 235 páginas por operação, a sidebar por tag, as
  URLs por operação (links externos para elas quebram), o playground e os
  snippets de cURL.
- A guarda não abre navegador: falha de hidratação do Redoc não é pega; a
  página ausente, vazia ou sem operações é.

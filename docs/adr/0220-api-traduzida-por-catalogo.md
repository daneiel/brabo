# ADR 0220 — A página da API sai traduzida por catálogo

## Status

**Accepted.** 2026-10-16 (AT-565, decisões do dono de 16/10).

Tema: `docs`. Cumpre o item 7 do
[0219](0219-referencia-entra-na-traducao.md) e abre uma exceção declarada à
fonte pt-BR do [0216](0216-quatro-idiomas-com-pt-br-como-fonte.md).

## Contexto

A referência da API é uma página Redoc gerada do `openapi.json`
([0206](0206-referencia-da-api-numa-pagina-redoc.md)), e o texto dela vem dos
decorators da api: quase todo em inglês, com algumas dezenas de textos em
pt-BR. O site tem quatro locales, mas a página saía igual em todos. O plugin
só aceita um caminho de arquivo como spec, e o Docusaurus carrega o config uma
vez por locale com `DOCUSAURUS_CURRENT_LOCALE` definido.

## Decisão

1. A fonte das descrições continua sendo o texto dos decorators; a api não é
   tocada. Isso é uma EXCEÇÃO à fonte pt-BR do ADR 0216: `pt-BR`, `ru` e
   `zh-Hans` traduzem todos os textos, e `en` só os que estão em pt-BR
   (heurística: diacrítico do português ou palavra funcional como "não",
   "para", "que").
2. A tradução mora num CATÁLOGO por locale,
   `website/i18n/<locale>/openapi-textos.json`, chaveado pelo sha1 (12 hex) do
   texto da fonte, com `fonte` e `traducao`. Cobre `summary`/`description` em
   qualquer nível da spec e o rótulo das tags (`x-displayName`); o NOME da tag
   não muda, para a âncora `#tag/<nome>` ficar.
3. A spec do locale é DERIVADA no build pelo `docusaurus.config.ts`
   (`scripts/docs/openapi-por-locale.mjs`) e gravada em `website/.openapi/`,
   ignorada pelo git. Nada derivado é commitado.
4. Chave ÓRFÃ (hash que a spec não tem mais) e entrada INVÁLIDA (fonte que não
   bate com o hash, ou número de trechos `` `…` `` diferente entre fonte e
   tradução) reprovam o `docs:check`; entrada faltando só avisa e cai no texto
   da fonte, como no D3 do 0219.
5. Os 18 rótulos de `LabelsConfig` do Redoc 2.4.0 são traduzidos via
   `theme.options.labels`. Os textos que ele tem fixos no código, sem opção
   ("Request Body schema", "Response Schema", "Authorizations", "Search...",
   "Expand all", "Copy", "required", "API docs by Redocly" e afins), ficam em
   inglês.
6. A paridade de tradução ganha uma seção própria "API (Redoc)", em textos
   distintos por locale, sem somar aos caracteres das páginas.

## Consequências

- Texto novo na api aparece como faltando em todo catálogo até a próxima
  rodada de tradução; texto mudado deixa a entrada antiga órfã, e o
  `docs:check` exige removê-la no mesmo PR (`pnpm docs:openapi-textos
  <locale>` acrescenta as chaves novas com `traducao: ""`).
- Os catálogos nascem vazios; a tradução dos textos é uma rodada própria.
- A página em pt-BR mistura rótulos do Redoc em inglês com o resto traduzido,
  por limitação do Redoc, não por escolha de conteúdo.

## Referências

- [0206](0206-referencia-da-api-numa-pagina-redoc.md) — a página Redoc da API.
- [0216](0216-quatro-idiomas-com-pt-br-como-fonte.md) — quatro idiomas, pt-BR
  como fonte.
- [0219](0219-referencia-entra-na-traducao.md) — a referência entra na
  tradução.

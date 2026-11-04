# ADR 0253 — O site de docs deixa o Docusaurus

- **Status:** aceito
- **Data:** 2026-11-04
- **Tema:** `docs`
- **Referencia:** os ADRs [0117](0117-lockfile-proprio-para-o-website.md), [0206](0206-referencia-da-api-numa-pagina-redoc.md), [0216](0216-quatro-idiomas-com-pt-br-como-fonte.md) e [0220](0220-api-traduzida-por-catalogo.md). Nenhum deles é editado.

## Contexto

O site de documentação é Docusaurus 3 lendo `docs/` (AT-662, EP-031, decisão do dono de 02/11/2026). O framework traz uma árvore de dependências que nunca chega a imagem nenhuma e já exigiu lockfile isolado (0117) e dezenove overrides, o índice de busca pesa cerca de 25 MB por idioma, e o tema segue o Infima, não o design system do produto. O molde de um gerador próprio já existe no `site/` do projeto Smartsky (cerca de 1,3 mil linhas, `markdown-it`, sem framework).

## Decisão

1. **Gerador próprio** em `scripts/docs/site/` (ESM, `markdown-it` e `shiki` em `scripts/package.json`), com saída em `build/docs-site/`, caminhos relativos e as MESMAS URLs e âncoras `{#id}` do site de hoje (`x.md` vira `x.html`, `pasta/index.md` vira `pasta.html`, `intro` vira `index.html`, outros idiomas sob `/<locale>/`). Cada idioma é montado com o conjunto INTEIRO de páginas (tradução ou fonte pt-BR no mesmo endereço), então o link nunca sai do idioma.
2. **A referência da API fica no Redoc 3**, com texto do spec traduzido pelo catálogo por hash do 0220 (que não muda) e a **telemetria desligada** de forma explícita. O Redoc 3 removeu a opção `labels`: os rótulos da INTERFACE do Redoc (Request samples, Responses…) voltam a ser em inglês nos quatro idiomas, preço aceito pelo dono. O 0206 muda de renderizador (sem redocusaurus) e o 0220 mantém o catálogo.
3. **As traduções vão para `docs/i18n/<locale>/`**, deixando de morar em `website/i18n/…/docusaurus-plugin-content-docs/current/` (a paridade, o `openapi-textos.json` e os guias seguem o caminho novo). O caminho é uma constante do gerador.
4. **Busca por substring** normalizada, sem stemming, com índice por idioma carregado só quando a pessoa busca; a página da API mantém a busca do Redoc.
5. **O 0117 perde o objeto** onde o `website/` deixa de ter Docusaurus; o isolamento do lockfile só continua para a árvore do Redoc.
6. **Mantidos:** a publicação por degrau do 0073, os quatro idiomas e a fonte pt-BR do 0216, o `noindex` fora da `main`, o aviso de fase de teste, "editar esta página" e "última atualização".

## Consequências

- Perde-se o ranking da busca do lunr, o realce do termo na página destino e `search.html`.
- A migração é por etapas: o gerador roda ao lado (`pnpm docs:site`) até a troca do CI e do deploy, que é um único PR.
- O CLAUDE.md e as partes de contexto que citam o Docusaurus mudam na troca, não antes.

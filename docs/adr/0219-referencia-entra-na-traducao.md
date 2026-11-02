# ADR 0219 — A referência entra na tradução

## Status

**Accepted.** 2026-10-15 (AT-564, decisões do dono de 15/10).

Tema: `docs`. Revisa, sem editar, o ponto do
[0216](0216-quatro-idiomas-com-pt-br-como-fonte.md) que deixava
`docs/reference/**` fora da tradução.

## Contexto

O ADR 0216 fez do pt-BR a fonte da documentação, com `en`, `ru` e `zh-Hans`
como traduções medidas, mas deixou `docs/reference/**` de fora com o argumento
de que "é gerado". O argumento só vale em parte: das dez páginas de
`reference/`, seis são escritas à mão (artifacts, brb, git-providers,
internal-api, permissions, rulesets) e estavam em inglês, e as quatro geradas
(configuration, events, llm-providers, scripts) têm prosa à mão em volta do
bloco gerado. Quem lê o site em pt-BR caía em páginas inteiras em inglês, e a
paridade não as contava.

## Decisão

1. `docs/reference/**` ENTRA na tradução e na paridade, exceto
   `reference/paridade-de-traducao.md` (o próprio relatório) e
   `reference/openapi.json`.
2. A fonte das seis páginas escritas à mão passa a ser pt-BR em `docs/`, e o
   inglês atual vira a cópia `en`.
3. Nas páginas geradas, o BLOCO gerado também sai traduzido: o gerador escreve
   na fonte em pt-BR e escreve o bloco nas cópias de cada locale, a partir de
   uma tabela de textos fixos.
4. A defasagem que nasce a cada variável ou evento novo é aceita como aviso
   da paridade e da faixa da página, não como reprovação.
5. Título que é alvo de link ganha âncora explícita `{#slug-atual}` antes de
   ser traduzido, para os links de fora não quebrarem.
6. A faixa de tradução declara a língua real da página pelo `idioma_original`
   no frontmatter.
7. A página da API (Redoc) também será traduzida; isso é a AT-565, e este ADR
   só registra a decisão.
8. A regra `traducao` do docmap passa a vigiar as páginas de
   `docs/reference/`, menos a de paridade.

## Consequências

- A paridade passa a contar `reference/`, e os números caem no primeiro
  relatório: as páginas ainda não traduzidas aparecem como ausentes ou
  defasadas até as rodadas de tradução chegarem a elas.
- O docmap não tem negação de glob, então a regra `traducao` lista as páginas
  de `reference/` uma a uma; página nova de referência entra nela no mesmo PR.
- O gerador ganha uma saída por locale (item 3), trabalho de uma rodada
  própria; até lá o bloco gerado das cópias fica na língua da fonte.

## Referências

- [0216](0216-quatro-idiomas-com-pt-br-como-fonte.md) — quatro idiomas, pt-BR
  como fonte.
- [0206](0206-referencia-da-api-numa-pagina-redoc.md) — a página Redoc da API.

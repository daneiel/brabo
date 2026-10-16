---
id: paridade-de-traducao
title: Paridade de tradução
---

> ⚠️ Arquivo gerado por `pnpm docs:generate`. Não edite à mão — o próximo build o sobrescreve.

# Paridade de tradução

A fonte é o pt-BR em `docs/` (ADR 0216), inclusive `docs/reference/**` (ADR 0219); só esta página fica fora. Uma tradução está **em dia** quando o `traducao_de:` do frontmatter é um commit tão ou mais novo que o último commit da fonte, e **defasada** quando a fonte mudou depois. Sem o campo, ela conta como **sem procedência**. As regras estão em [Localização](../explanation/localizacao.md).

## Documentação

| locale | páginas traduzidas | caracteres traduzidos | em dia | defasadas | sem procedência | ausentes | órfãs |
|---|---|---|---|---|---|---|---|
| `en` | 266 de 269 (98.9%) | 96.9% de 5.750.150 | 265 | 0 | 1 | 3 | 0 |
| `ru` | 266 de 269 (98.9%) | 96.9% de 5.750.150 | 265 | 0 | 1 | 3 | 0 |
| `zh-Hans` | 269 de 269 (100.0%) | 100.0% de 5.750.150 | 268 | 0 | 1 | 0 | 0 |

> **TODO(humano):** revisão nativa por idioma — quem revisou e quando. Ainda não há revisão nativa registrada.

## Interface

Chaves de `apps/web/src/locales/<locale>/` contra o pt-BR. Chave plural conta uma vez por forma de `Intl.PluralRules` do locale.

| locale | formas de plural | chaves presentes | plurais incompletos |
|---|---|---|---|
| `en` | one, other | 2316 de 2316 (100.0%) | 0 |
| `ru` | one, few, many, other | 2520 de 2520 (100.0%) | 0 |
| `zh-Hans` | other | 2214 de 2214 (100.0%) | 0 |


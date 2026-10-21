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
| `en` | 270 de 270 (100.0%) | 100.0% de 5.756.326 | 268 | 1 | 1 | 0 | 0 |
| `ru` | 270 de 270 (100.0%) | 100.0% de 5.756.326 | 268 | 1 | 1 | 0 | 0 |
| `zh-Hans` | 270 de 270 (100.0%) | 100.0% de 5.756.326 | 268 | 1 | 1 | 0 | 0 |

> **TODO(humano):** revisão nativa por idioma — quem revisou e quando. Ainda não há revisão nativa registrada.

### Defasadas em `en`

- `business-rules.md` (tradução de 2026-10-15)

### Defasadas em `ru`

- `business-rules.md` (tradução de 2026-10-15)

### Defasadas em `zh-Hans`

- `business-rules.md` (tradução de 2026-10-15)

## Interface

Chaves de `apps/web/src/locales/<locale>/` contra o pt-BR. Chave plural conta uma vez por forma de `Intl.PluralRules` do locale.

| locale | formas de plural | chaves presentes | plurais incompletos |
|---|---|---|---|
| `en` | one, other | 2316 de 2316 (100.0%) | 0 |
| `ru` | one, few, many, other | 2520 de 2520 (100.0%) | 0 |
| `zh-Hans` | other | 2214 de 2214 (100.0%) | 0 |

## API (Redoc)

Textos distintos da referência da API (`/reference/api/`) contra o catálogo `website/i18n/<locale>/openapi-textos.json` (ADR 0220). A fonte é o texto dos decorators da api, quase todo em inglês: `pt-BR`, `ru` e `zh-Hans` traduzem todos, e `en` só os que estão em pt-BR (diacrítico do português ou palavra funcional como "não", "para", "que"). Não soma aos caracteres das páginas.

| locale | textos traduzidos |
|---|---|
| `pt-BR` | 1325 de 1325 (100.0%) |
| `en` | 1 de 1 (100.0%) |
| `ru` | 1325 de 1325 (100.0%) |
| `zh-Hans` | 1325 de 1325 (100.0%) |


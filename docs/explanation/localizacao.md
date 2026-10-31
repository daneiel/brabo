---
id: localizacao
title: Localização
description: Os quatro idiomas do Brabo (pt-BR como fonte, en, ru e zh-Hans), os códigos, as formas de plural, como o idioma é resolvido, o que acontece com o texto que falta e o que nunca se traduz.
---

# Localização

O Brabo fala quatro idiomas na documentação e na interface, e o **português do
Brasil é a fonte e o padrão** dos dois produtos ([ADR 0216](../adr/0216-quatro-idiomas-com-pt-br-como-fonte.md)).
Todo texto novo nasce em pt-BR; os outros idiomas são traduções dele.

## Idiomas e códigos

| idioma | código | formas de plural (`Intl.PluralRules`) | nota |
|---|---|---|---|
| Português (Brasil) | `pt-BR` | one, many, other (+ `_zero` obrigatório na interface) | fonte |
| English | `en` | one, other | [Notas do inglês](localizacao-en.md) |
| Русский | `ru` | one, few, many, other | [Notas do russo](localizacao-ru.md) |
| 简体中文 | `zh-Hans` | other | [Notas do chinês](localizacao-zh-hans.md) |

Os códigos são os mesmos no Docusaurus, no i18next, no `<html lang>` e em
`users.locale`. A busca local do site usa os dela (`pt`, `en`, `ru`, `zh`).

No site, o seletor de idioma fica na barra de cima (`localeDropdown` em
`website/docusaurus.config.ts`), com os rótulos acima, e leva à mesma página no
idioma escolhido; cada idioma mora no próprio caminho (`/en/`, `/ru/`,
`/zh-Hans/`; o pt-BR na raiz do degrau).

## Resolução do idioma na interface

A escolha gravada na conta **vence sempre** e nunca é sobrescrita por detecção.
Sem escolha, o idioma do navegador sugere
(`resolverIdiomaDoNavegador`, `apps/web/src/lib/idioma.ts`):

- `pt*` → `pt-BR`;
- `zh`, `zh-CN`, `zh-SG` e `zh-Hans*` → `zh-Hans`;
- `ru*` → `ru`;
- `en*` → `en`;
- qualquer outro — alemão, chinês tradicional (`zh-TW`, `zh-Hant`) — → `pt-BR`.

O idioma das RESPOSTAS dos agentes é outra preferência, com mecanismo próprio
(ADR 0177), e não depende do idioma da interface.

## O texto que falta

- **No site**, a página sem tradução num locale é servida da fonte pt-BR, no
  mesmo endereço, e uma faixa no topo DIZ isso no idioma de quem lê. A página
  traduzida cuja fonte mudou depois da tradução diz a data da tradução e que o
  original mudou.
- **Na interface**, o texto não falta: a paridade de chaves e de plurais é
  medida, e o `fallbackLng` é o pt-BR.

Toda página traduzida leva no frontmatter `traducao_de: <SHA>` — o último
commit da fonte que ela traduz. É ele que separa "em dia" de "defasada". A
medição de hoje está em [Paridade de tradução](../reference/paridade-de-traducao.md),
gerada por `pnpm docs:generate`.

Os rótulos da lateral de Referência e da barra de cima vêm de `website/sidebars.ts` e dos `navbar.json`/`current.json` de cada idioma; desde o ADR 0219 o conteúdo das páginas de `reference/` também é traduzido, inclusive o bloco gerado, e só a página de paridade fica fora.

## O que nunca se traduz

- **Brabo**, e os nomes de agente e de papel do [glossário](../glossary.md)
  (Criativo, PO, Arquiteto, Dev Lead, Infra Lead, `owner`, `maintainer`…);
- dados do usuário (nomes de projeto, mensagens, artefatos);
- comandos, caminhos, nomes de variável, de branch e de evento;
- números de RN e de ADR e as âncoras `{#rn-NNN}`.

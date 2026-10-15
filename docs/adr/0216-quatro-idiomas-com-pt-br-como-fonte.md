# 0216 — Quatro idiomas, com pt-BR como FONTE e padrão: a documentação e a interface em português, inglês, russo e chinês simplificado

## Status

**Accepted.** 2026-10-15 (AT-545, épico EP-032; decisões do dono de 15/10).
O dono pediu a documentação (site e README) e a interface em quatro idiomas —
português do Brasil (PADRÃO), inglês, russo e mandarim (chinês simplificado) —,
em FASES, e respondeu as quatro perguntas abertas deste ADR (ver a Decisão,
itens 4, 9 e 10). Modelo de README e de localização medida: o repositório
`storytold/photocraft` (`README.md`, `docs/localization.md`,
`docs/localization-parity.md`).

Tema: `docs`. Reverte o inglês como padrão da interface, que veio da fundação
de i18n (RN-432) sem ADR, e o `defaultLocale: 'en'` do site. Nenhum ADR aceito
é editado: a RN-432 ganha revisão por RN nova no PR da interface.

## Context

Medido em `origin/dev` (`f0a355fe5a`):

- O site declara `defaultLocale: 'en'` e `locales: ['en', 'pt-BR']`
  (`website/docusaurus.config.ts:109-116`), e `docs/` é a árvore do locale
  padrão. Mas, dos 261 arquivos de `docs/` (5,7 M caracteres), **92 estão em
  pt-BR no corpo** — as RNs (`business-rules.md`, 1,58 M, e
  `business-rules/autenticacao.md`), os ADRs desde a 0127 e o histórico de
  fases —, cerca de 2,7 M caracteres. O site "en" serve esse texto em
  português. A casca do site (barra lateral, navbar, rodapé) também está em
  pt-BR, sem arquivo de tradução nenhum.
- As traduções em `website/i18n/pt-BR/` cobrem 135 das 261 páginas, e **97
  delas** têm a fonte alterada depois do último commit da tradução. Nada diz
  isso ao leitor nem ao autor do PR: a regra `traducao-pt-br` do docmap é `warn`
  e não mede nada.
- Dos 100 ADRs com cópia pt-BR, **66 são, byte a byte, o texto do commit que
  criou o ADR**: os ADRs 0001–~0103 foram escritos em português, e o que está
  em `docs/adr/` é a tradução para o inglês.
- A interface tem `en` como padrão só no web (`apps/web/src/lib/idioma.ts:38`,
  `i18n.ts:52`); a api já grava `pt-BR` como padrão de `users.locale`
  (`apps/api/src/db/schema/iam.ts:87`). São 2.310 textos em 27 namespaces,
  cerca de 90 mil caracteres por idioma.
- O idioma das RESPOSTAS dos agentes já é lista aberta de BCP-47 (ADR 0177,
  RN-618/622) e não depende do idioma da interface.
- O tema do Docusaurus traz traduções de `pt-BR`, `ru` e `zh-Hans`
  (`@docusaurus/theme-translations@3.10.2`); `zh-CN` não existe lá. A busca
  local (`@easyops-cn/docusaurus-search-local`) segmenta chinês com jieba e
  indexa russo por `lunr-languages`.

## Decision

1. **pt-BR é a FONTE e o padrão, nos dois produtos.** No site, `docs/` passa a
   ser a árvore pt-BR (`defaultLocale: 'pt-BR'`), e `en`, `ru` e `zh-Hans` moram
   em `website/i18n/<locale>/`. A alternativa — manter o inglês como fonte e só
   abrir o site em pt-BR por `localeConfigs.<locale>.baseUrl` — é possível no
   Docusaurus 3.10 e foi recusada: todo texto novo nasceria em inglês, e os
   2,7 M caracteres em português continuariam servidos sob o rótulo de inglês.
   Na interface, `pt-BR` é o padrão do web e o `fallbackLng`, e é a referência
   dos testes de paridade.
2. **Os códigos são `pt-BR`, `en`, `ru` e `zh-Hans`**, os mesmos no Docusaurus,
   no i18next, no `<html lang>` e em `users.locale`. A busca local usa os
   códigos dela (`pt`, `en`, `ru`, `zh`).
3. **Resolução de locale na interface:** a escolha gravada na conta vence sempre
   e nunca é sobrescrita por detecção. Sem escolha, o navegador sugere: `pt*` →
   `pt-BR`; `zh`, `zh-CN`, `zh-SG` e `zh-Hans*` → `zh-Hans`; `ru*` → `ru`; `en*`
   → `en`.
4. **Idioma sem catálogo cai no pt-BR** (decisão do dono): alemão, chinês
   tradicional e qualquer outro abrem no padrão, não no inglês. Texto que falta
   num locale cai na fonte pt-BR — e não falta na interface, porque a paridade
   reprova.
5. **A virada do site é um PR só, por `git mv`:** o inglês atual vai para
   `website/i18n/en/`; as traduções pt-BR EM DIA substituem a fonte; as
   defasadas e as inexistentes deixam a página no idioma em que está até o
   lote dela, com aviso; e `website/i18n/pt-BR/docusaurus-plugin-content-docs`
   sai no MESMO PR, senão a pasta do locale padrão sobreporia `docs/` e as 97
   cópias defasadas iriam ao ar.
6. **Página não traduzida, ou cuja fonte mudou depois da tradução, DIZ isso**,
   no idioma de quem lê: um wrapper de `DocItem/Content` distingue fonte de
   tradução pelo `metadata.source`, e cada página traduzida leva no
   frontmatter `traducao_de: <commit da fonte>`.
7. **A paridade é MEDIDA e o relatório é GERADO** pelo `pnpm docs:generate`
   (`docs/reference/paridade-de-traducao.md`, `generated: true`; o `--check`
   reprova o arquivo fora de dia): por locale, páginas e caracteres traduzidos
   sobre a fonte, páginas defasadas, data de revisão, revisão nativa e o que
   fica sem tradução por decisão; na interface, chaves por namespace contra o
   pt-BR e as formas de plural de `Intl.PluralRules` (`pt-BR`: one/many/other;
   `en`: one/other; `ru`: one/few/many/other; `zh-Hans`: other). As regras
   escritas moram em `docs/explanation/localizacao.md`, com uma nota de
   terminologia por idioma — o que nunca se traduz: Brabo, os nomes de agente e
   papel do glossário, dados do usuário, comandos e números de RN/ADR.
8. **O README é vitrine, no modelo do photocraft**, com o pt-BR como fonte e
   `README.en.md`, `README.ru.md` e `README.zh-Hans.md`. As traduções não
   carregam versão nem contagens derivadas: linkam o pt-BR, que é o aferido.
9. **Os ADRs 0001–~0103 voltam ao texto original em pt-BR em `docs/adr/`**
   (decisão do dono), e o inglês vai para `website/i18n/en/`. Não é editar uma
   decisão aceita: é restaurar o texto que foi aceito, que hoje está na cópia
   pt-BR. Vale só para a cópia que for byte a byte o texto do commit de
   criação; a que divergir fica como está e é dita no relatório de paridade.
10. **Até os lotes de inglês chegarem, o site em inglês mostra em português as
    RNs e os ADRs recentes, com a faixa avisando** (decisão do dono). E os
    links antigos `/brabo/<ambiente>/pt-BR/…` são reescritos pelo 404 da raiz
    para `/brabo/<ambiente>/…`, como o `/main/` → `/prd/` do ADR 0073; o inglês
    sai da raiz para `/brabo/<ambiente>/en/…` (decisão do dono).
11. **Fases.** Fase 1: a virada do site, as páginas de entrada (`intro`,
    `getting-started`, `glossary` e o tutorial do zero ao entregável) nos quatro
    idiomas, os quatro READMEs, a interface completa em `ru` e `zh-Hans`, e a
    paridade medida. Fase 2 em diante: lotes por categoria da barra lateral ×
    locale, um PR cada — primeiro o pt-BR das 97 páginas defasadas e das 26 só
    em inglês, depois o inglês das páginas pt-BR, depois `ru` e `zh-Hans`.

## Consequences

- O docmap troca a regra `traducao-pt-br` por `traducao`, `warn` e NUNCA
  `block`: exigir tradução em todo PR de doc custaria quatro traduções por
  mudança. Quem segura a defasagem é o relatório gerado e a faixa na página.
- Frase ancorada no código (`verificarFrasesAncoradasNoCodigo`, contagens) em
  página que vira pt-BR reprova como `CEGO` até o padrão acompanhar, no PR do
  lote — de propósito. São 19 frases hoje. O mesmo vale para o cabeçalho que
  `procedimentos-do-runbook.mjs` procura e para os títulos de
  `docs/adr/temas.yml` quando o índice virar.
- `ancoras-de-rn.mjs` passa a conferir as RNs dos três locales traduzidos, e
  `links-do-locale.mjs` passa a conhecer `en`, `ru` e `zh-Hans` como locales
  com prefixo.
- `users.locale` ganha `ru` e `zh-Hans` (enum do Postgres, DTOs, tipos
  gerados). O idioma das respostas não muda de mecanismo — uma conta em `ru` já
  recebe a orientação genérica por BCP-47 —, e textos nativos de orientação e a
  detecção de cirílico e Han ficam como melhoria medida, não pré-requisito.
- Custos declarados: o build do site compila quatro locales (cerca do dobro de
  hoje, não medido); o índice de busca cresce (não medido); traduzir tudo é
  cerca de 2,9 M caracteres para o inglês e 5,3 M para cada um de russo e
  chinês; todo PR que muda uma fonte traduzida precisa rodar
  `pnpm docs:generate`; o inglês sai da raiz do ambiente para `/en/`.
- Sem revisão nativa, russo e chinês saem como tradução de máquina revisada por
  agente, e o relatório diz "revisão nativa: não" até um humano revisar.

## Fora do escopo

- `docs/reference/**` (gerado) continua fora da tradução, e o gerador continua
  escrevendo em inglês.
- Idiomas além dos quatro, chinês tradicional e escrita da direita para a
  esquerda.
- Traduzir o conteúdo que o usuário e os agentes produzem (artefatos,
  mensagens): isso é o idioma do PROJETO e das respostas (ADR 0177), não da
  interface.

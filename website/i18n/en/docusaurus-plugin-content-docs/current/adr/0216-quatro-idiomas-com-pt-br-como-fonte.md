---
traducao_de: 1f7d3231649a224f5c952aa6fcf49df753af3680
---

# 0216 — Four languages, with pt-BR as SOURCE and default: documentation and interface in Portuguese, English, Russian and Simplified Chinese

## Status

**Accepted.** 2026-10-15 (AT-545, epic EP-032; owner decisions of 15/10). The
owner asked for the documentation (site and README) and the interface in four
languages — Brazilian Portuguese (DEFAULT), English, Russian and Mandarin
(Simplified Chinese) —, in PHASES, and answered this ADR's four open questions
(see the Decision, items 4, 9 and 10). Model for the README and for measured
localization: the `storytold/photocraft` repository (`README.md`,
`docs/localization.md`, `docs/localization-parity.md`).

Theme: `docs`. Reverts English as the interface default, which came from the
i18n foundation (RN-432) without an ADR, and the site's `defaultLocale: 'en'`. No
accepted ADR is edited: RN-432 gets a revision through a new RN in the interface
PR.

## Context

Measured on `origin/dev` (`f0a355fe5a`):

- The site declares `defaultLocale: 'en'` and `locales: ['en', 'pt-BR']`
  (`website/docusaurus.config.ts:109-116`), and `docs/` is the default locale's
  tree. But, of the 261 files in `docs/` (5.7 M characters), **92 are in pt-BR
  in the body** — the RNs (`business-rules.md`, 1.58 M, and
  `business-rules/autenticacao.md`), the ADRs since 0127 and the phase history
  —, about 2.7 M characters. The "en" site serves that text in Portuguese. The
  site's shell (sidebar, navbar, footer) is also in pt-BR, with no translation
  file at all.
- The translations in `website/i18n/pt-BR/` cover 135 of the 261 pages, and
  **97 of them** have the source changed after the translation's last commit.
  Nothing tells the reader nor the PR author: the docmap's `traducao-pt-br` rule
  is `warn` and measures nothing.
- Of the 100 ADRs with a pt-BR copy, **66 are, byte for byte, the text of the
  commit that created the ADR**: ADRs 0001–~0103 were written in Portuguese, and
  what is in `docs/adr/` is the English translation.
- The interface has `en` as default only in web
  (`apps/web/src/lib/idioma.ts:38`, `i18n.ts:52`); the api already records
  `pt-BR` as the `users.locale` default (`apps/api/src/db/schema/iam.ts:87`).
  There are 2,310 strings in 27 namespaces, about 90 thousand characters per
  language.
- The language of the agents' RESPONSES is already an open BCP-47 list (ADR 0177,
  RN-618/622) and does not depend on the interface language.
- The Docusaurus theme ships translations for `pt-BR`, `ru` and `zh-Hans`
  (`@docusaurus/theme-translations@3.10.2`); `zh-CN` does not exist there. The
  local search (`@easyops-cn/docusaurus-search-local`) segments Chinese with
  jieba and indexes Russian through `lunr-languages`.

## Decision

1. **pt-BR is the SOURCE and the default, in both products.** On the site,
   `docs/` becomes the pt-BR tree (`defaultLocale: 'pt-BR'`), and `en`, `ru` and
   `zh-Hans` live in `website/i18n/<locale>/`. The alternative — keeping English
   as the source and only opening the site in pt-BR through
   `localeConfigs.<locale>.baseUrl` — is possible in Docusaurus 3.10 and was
   refused: every new text would be born in English, and the 2.7 M characters in
   Portuguese would keep being served under the English label. In the interface,
   `pt-BR` is web's default and the `fallbackLng`, and it is the reference of
   the parity tests.
2. **The codes are `pt-BR`, `en`, `ru` and `zh-Hans`**, the same in Docusaurus,
   in i18next, in `<html lang>` and in `users.locale`. The local search uses its
   own codes (`pt`, `en`, `ru`, `zh`).
3. **Locale resolution in the interface:** the choice recorded in the account
   always wins and is never overwritten by detection. Without a choice, the
   browser suggests: `pt*` → `pt-BR`; `zh`, `zh-CN`, `zh-SG` and `zh-Hans*` →
   `zh-Hans`; `ru*` → `ru`; `en*` → `en`.
4. **A language without a catalog falls back to pt-BR** (owner decision): German,
   Traditional Chinese and any other open in the default, not in English. Text
   missing in a locale falls back to the pt-BR source — and is not missing in the
   interface, because parity fails it.
5. **The site's switch is a single PR, through `git mv`:** the current English
   goes to `website/i18n/en/`; the UP-TO-DATE pt-BR translations replace the
   source; the outdated and nonexistent ones leave the page in the language it is
   in until its batch, with a notice; and
   `website/i18n/pt-BR/docusaurus-plugin-content-docs` leaves in the SAME PR,
   otherwise the default locale's folder would override `docs/` and the 97
   outdated copies would go live.
6. **A page not translated, or whose source changed after the translation, SAYS
   so**, in the reader's language: a `DocItem/Content` wrapper tells source from
   translation through `metadata.source`, and each translated page carries in its
   frontmatter `traducao_de: <commit da fonte>`.
7. **Parity is MEASURED and the report is GENERATED** by `pnpm docs:generate`
   (`docs/reference/paridade-de-traducao.md`, `generated: true`; `--check` fails
   an out-of-date file): per locale, pages and characters translated over the
   source, outdated pages, review date, native review and what stays
   untranslated by decision; in the interface, keys per namespace against pt-BR
   and the plural forms of `Intl.PluralRules` (`pt-BR`: one/many/other; `en`:
   one/other; `ru`: one/few/many/other; `zh-Hans`: other). The written rules live
   in `docs/explanation/localizacao.md`, with a terminology note per language —
   what is never translated: Brabo, the glossary's agent and role names, user
   data, commands and RN/ADR numbers.
8. **The README is a showcase, in the photocraft model**, with pt-BR as the
   source and `README.en.md`, `README.ru.md` and `README.zh-Hans.md`. The
   translations carry neither version nor derived counts: they link the pt-BR,
   which is the checked one.
9. **ADRs 0001–~0103 go back to the original pt-BR text in `docs/adr/`** (owner
   decision), and the English goes to `website/i18n/en/`. It is not editing an
   accepted decision: it is restoring the text that was accepted, which today is
   in the pt-BR copy. It only applies to a copy that is byte for byte the text of
   the creation commit; one that diverges stays as it is and is stated in the
   parity report.
10. **Until the English batches arrive, the English site shows the RNs and recent
    ADRs in Portuguese, with the banner warning** (owner decision). And old links
    `/brabo/<ambiente>/pt-BR/…` are rewritten by the root 404 to
    `/brabo/<ambiente>/…`, like ADR 0073's `/main/` → `/prd/`; English leaves the
    root for `/brabo/<ambiente>/en/…` (owner decision).
11. **Phases.** Phase 1: the site switch, the entry pages (`intro`,
    `getting-started`, `glossary` and the zero-to-deliverable tutorial) in the
    four languages, the four READMEs, the full interface in `ru` and `zh-Hans`,
    and measured parity. Phase 2 onwards: batches per sidebar category × locale,
    one PR each — first the pt-BR of the 97 outdated pages and of the 26
    English-only ones, then the English of the pt-BR pages, then `ru` and
    `zh-Hans`.

## Consequences

- The docmap swaps the `traducao-pt-br` rule for `traducao`, `warn` and NEVER
  `block`: requiring translation in every doc PR would cost four translations per
  change. What holds the lag is the generated report and the page banner.
- A sentence anchored in code (`verificarFrasesAncoradasNoCodigo`, counts) on a
  page that becomes pt-BR fails as `CEGO` until the pattern follows, in the
  batch's PR — on purpose. There are 19 sentences today. The same holds for the
  heading `procedimentos-do-runbook.mjs` looks for and for the titles of
  `docs/adr/temas.yml` when the index switches.
- `ancoras-de-rn.mjs` now checks the RNs of the three translated locales, and
  `links-do-locale.mjs` now knows `en`, `ru` and `zh-Hans` as prefixed locales.
- `users.locale` gains `ru` and `zh-Hans` (Postgres enum, DTOs, generated
  types). The response language does not change mechanism — an account in `ru`
  already gets the generic BCP-47 guidance —, and native guidance texts and the
  detection of Cyrillic and Han remain a measured improvement, not a
  prerequisite.
- Declared costs: the site build compiles four locales (about double today, not
  measured); the search index grows (not measured); translating everything is
  about 2.9 M characters to English and 5.3 M for each of Russian and Chinese;
  every PR changing a translated source needs to run `pnpm docs:generate`;
  English leaves the environment root for `/en/`.
- Without native review, Russian and Chinese come out as machine translation
  reviewed by an agent, and the report says "native review: no" until a human
  reviews.

## Out of scope

- `docs/reference/**` (generated) stays out of translation, and the generator
  keeps writing in English.
- Languages beyond the four, Traditional Chinese and right-to-left scripts.
- Translating the content users and agents produce (artifacts, messages): that is
  the PROJECT's and the responses' language (ADR 0177), not the interface's.

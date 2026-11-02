---
id: localizacao-zh-hans
title: Localization — Simplified Chinese (zh-Hans)
description: Terminology, plural and what is not translated in Brabo's Simplified Chinese translation.
traducao_de: 28623069eba685a830004c4b447b705ae2e81989
---

# Localization — Simplified Chinese (`zh-Hans`)

General rules in [Localization](localizacao.md).

- **Code:** `zh-Hans`, never `zh-CN` (the Docusaurus theme only ships
  `zh-Hans`). Browser `zh`, `zh-CN` and `zh-SG` resolve to it; traditional
  Chinese (`zh-TW`, `zh-Hant`) falls back to pt-BR.
- **Plural:** only `other` — a pt-BR plural key becomes one form.
- **Terminology:** glossary terms that stay in English in pt-BR
  (*handoff*, *gate*, *runner*) stay in English here too. Full-width
  punctuation in running text, never inside code.
- **Not translated:** Brabo, agent and role names, commands, paths,
  RN/ADR numbers.

> **TODO(humano):** who does the native Simplified Chinese review?

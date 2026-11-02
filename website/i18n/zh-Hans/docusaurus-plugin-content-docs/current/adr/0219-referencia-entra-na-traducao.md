---
traducao_de: 74ac4990672a22f97b68fac9cece5c509a34fe89
---

# ADR 0219 — 参考文档纳入翻译

## 状态

**已接受。** 2026-10-15（AT-564，所有者 10/15 的决定）。

主题：`docs`。修订（但不编辑）[0216](0216-quatro-idiomas-com-pt-br-como-fonte.md)
中将 `docs/reference/**` 排除在翻译之外的那一点。

## 背景

ADR 0216 将 pt-BR 设为文档的源语言，`en`、`ru` 和 `zh-Hans` 作为可度量的翻译，
但以“它是生成的”为由将 `docs/reference/**` 排除在外。这只部分成立：`reference/`
的十个页面中，六个是手写的（artifacts、brb、git-providers、internal-api、
permissions、rulesets），且原为英文；四个生成页面（configuration、events、
llm-providers、scripts）在生成块周围也有手写文字。阅读 pt-BR 站点的人会落到整页
英文上，而平价统计并不计入它们。

## 决定

1. `docs/reference/**` 纳入翻译和平价统计，但 `reference/paridade-de-traducao.md`
   （报告本身）和 `reference/openapi.json` 除外。
2. 六个手写页面的源改为 `docs/` 中的 pt-BR，当前的英文变为 `en` 副本。
3. 在生成页面中，生成块也要翻译：生成器写入 pt-BR 源，并依据固定文本表将该块写入
   各语言的副本。
4. 每新增一个变量或事件带来的滞后被接受为平价报告和页面横幅的警告，而不是失败。
5. 作为链接目标的标题在翻译前获得显式锚点 `{#current-slug}`，以免外部链接失效。
6. 翻译横幅通过 frontmatter 中的 `idioma_original` 声明页面的真实语言。
7. API 页面（Redoc）也将被翻译；这是 AT-565，本 ADR 只记录该决定。
8. docmap 的 `traducao` 规则开始监视 `docs/reference/` 的页面，平价页面除外。

## 后果

- 平价统计开始计入 `reference/`，第一份报告中的数字会下降：未翻译的页面在翻译轮次
  到达之前显示为缺失或过时。
- docmap 不支持 glob 取反，因此 `traducao` 规则逐一列出 `reference/` 的页面；新的
  参考页面在同一个 PR 中加入其中。
- 生成器为每种语言增加一个输出（第 3 点），这是单独一轮的工作；在此之前，副本中的
  生成块保持源语言。

## 参考

- [0216](0216-quatro-idiomas-com-pt-br-como-fonte.md) — 四种语言，pt-BR 为源。
- [0206](0206-referencia-da-api-numa-pagina-redoc.md) — Redoc API 页面。

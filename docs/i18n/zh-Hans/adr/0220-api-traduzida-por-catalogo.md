---
traducao_de: b9d61abd7060c5a35f8eba1155204e01a065ab40
---

# ADR 0220 — API 页面按目录翻译

## 状态

**已接受。** 2026-10-16（AT-565，所有者 10/16 的决定）。

主题：`docs`。完成 [0219](0219-referencia-entra-na-traducao.md) 的第 7 项，并对
[0216](0216-quatro-idiomas-com-pt-br-como-fonte.md) 的 pt-BR 源开一个声明的例外。

## 背景

API 参考是由 `openapi.json` 生成的 Redoc 页面
（[0206](0206-referencia-da-api-numa-pagina-redoc.md)），其文本来自 api 的装饰器：几乎全是
英文，有几十条 pt-BR 文本。站点有四个语言环境，但该页面在所有语言环境中都一样。插件只接受
文件路径作为 spec，而 Docusaurus 会在设置 `DOCUSAURUS_CURRENT_LOCALE` 后为每个语言环境
加载一次配置。

## 决定

1. 描述的源仍是装饰器文本；不改动 api。这是对 ADR 0216 pt-BR 源的例外：`pt-BR`、`ru`
   和 `zh-Hans` 翻译所有文本，`en` 只翻译 pt-BR 文本（启发式：葡萄牙语变音符号或
   "não"、"para"、"que" 等功能词）。
2. 翻译存放在每个语言环境的目录 `website/i18n/<locale>/openapi-textos.json` 中，以源文本
   的 sha1（12 位十六进制）为键，包含 `fonte` 和 `traducao`。覆盖 spec 任意层级的
   `summary`/`description` 和标签的显示名（`x-displayName`）；标签名不变，`#tag/<名称>`
   锚点保持不变。
3. 语言环境的 spec 在构建时由 `docusaurus.config.ts`（`scripts/docs/openapi-por-locale.mjs`）
   派生，写入被 git 忽略的 `website/.openapi/`。派生物不提交。
4. 孤立键（spec 中已不存在的哈希）和无效条目（源与哈希不符，或源与译文的 `` `…` `` 片段
   数量不同）使 `docs:check` 失败；缺失条目只警告并回退到源文本，同 0219 的 D3。
5. Redoc 2.4.0 `LabelsConfig` 的 18 个标签通过 `theme.options.labels` 翻译。其在代码中
   写死且无选项的文本（"Request Body schema"、"Response Schema"、"Authorizations"、
   "Search..."、"Expand all"、"Copy"、"required"、"API docs by Redocly" 等）保持英文。
6. 翻译一致性报告新增独立的 "API (Redoc)" 一节，按语言环境统计不同文本，不计入页面字符。

## 后果

- api 中的新文本在下一轮翻译前在所有目录中显示为缺失；修改过的文本会使旧条目成为孤立键，
  `docs:check` 要求在同一个 PR 中删除它（`pnpm docs:openapi-textos <locale>` 以
  `traducao: ""` 添加新键）。
- 目录初始为空；文本翻译是单独的一轮。
- pt-BR 页面混合了英文的 Redoc 标签和已翻译的其余部分，这是 Redoc 的限制，而非内容选择。

## 参考

- [0206](0206-referencia-da-api-numa-pagina-redoc.md) — API 的 Redoc 页面。
- [0216](0216-quatro-idiomas-com-pt-br-como-fonte.md) — 四种语言，pt-BR 为源。
- [0219](0219-referencia-entra-na-traducao.md) — 参考进入翻译。

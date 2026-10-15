---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0206 — API 参考变成一个 Redoc 页面

## 状态 {#status}

**已接受。** 2026-10-02（AT-359；所有者于 10月2日的决定）。修订（不编辑）[ADR 0033](0033-referencia-de-api-gerada-do-openapi.md) 中关于**发布**的那一半：spec 仍然从代码生成（`docs/reference/openapi.json`、按类型的 DTO、表格测试），web 的 `openapi:types:check` 不变。

## 背景 {#context}

ADR 0033 用 `docusaurus-plugin-openapi-docs` 和 `docusaurus-theme-openapi-docs`（5.1.2）发布参考：在 `docs/reference/api/` 中生成 235 个 `.mdx`，由一份哈希清单锁定。这两个包会拖入 `postman-collection@5.3.1`，它把 `@faker-js/faker@5.5.3` **精确**固定——High 告警 #43，GHSA-qxc2-j82w-r537。10月2日实测：该依赖链上没有任何父包有摆脱 faker 5.5.3 的版本，而把 override 指向 10.x 会让 `docs:build` 失败（v5 的 API 已被移除）。保留该插件就没有办法关闭这条告警。

## 决策 {#decision}

把这对包换成 **Redocusaurus**（`redocusaurus` 2.5.x）：**一个** Redoc 页面，带 SSR，位于 `/reference/api/`，读取同一份 `docs/reference/openapi.json`。选择它的原因：它是 Docusaurus 3 的 preset，在服务器端渲染（页面出现在构建的 HTML 中，无需浏览器即可检查），跟随站点主题，且不拉入 `postman-collection` 和 faker。

- `pnpm docs:generate` 不再生成 `.mdx` 和清单 `.openapi-manifest.json`；`docs/reference/api/` 从仓库中移除。
- 侧边栏用一个指向 `/reference/api/` 的**链接**取代按 tag 的分类。
- `scripts/docs/api-render-check.mjs` 仍然是构建后的守卫（0033 的教训：构建通过不等于页面能渲染），现在在两种语言的 HTML 中断言 spec 的标题以及每个操作各有一节。

## 后果 {#consequences}

- 关闭告警 #43：`@faker-js/faker` 和 `postman-collection` 从 `website/` 的依赖树中消失。两个 override 失去了使用者而被移除（`js-yaml@>=5.0.0 <5.2.2` 和 `undici@>=6.0.0 <6.28.1`，它们只经由该插件到达），另外还有 `postman-code-generators` 的 `allowBuilds`。
- 所有者接受的**损失**：每个操作一页的 235 个页面、按 tag 的侧边栏、每个操作的 URL（指向它们的外部链接会失效）、playground 和 cURL 片段。
- 守卫不打开浏览器：Redoc 的 hydration 失败抓不到；页面缺失、为空或没有操作则能抓到。

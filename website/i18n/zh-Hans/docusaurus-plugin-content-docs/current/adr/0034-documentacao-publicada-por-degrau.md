---
traducao_de: 5393558baeec7d7521831b2be845200534784d83
---

# ADR 0034 — 按阶梯发布的文档，位于 Pages 的子目录中

## 背景 {#contexto}

文档只从 `main` 发布。`docs-deploy.yml` 在对 `main` 的 `push` 时触发，构建站点，并把制品交给
`actions/deploy-pages`。

这在整条流水线上留下了一个空档：**在合并到 `dev` 与最终晋升之间，没有人能阅读那个状态下的文档**，除非克隆仓库并运行 `pnpm docs:start`。而恰恰在这时它最被需要——在预发布中，用来核对改了什么；在 `dev` 中，用来在站点渲染后审阅一份新文档，而不是看 diff 中的原始 Markdown。

`docs-check.yml` 已经在每个 PR 中构建站点，但它**丢弃构建结果**：它的裁定是“能构建且没有坏链接”，从不是“已发布在某个我能打开的地方”。

第二个事实影响了这一决定。API 参考中 **117 个操作页面在发布时就是坏的**，在 `v1.0.0` 和 `v1.0.1` 版本中，两个月的工作中没人看到——因为唯一能看到的方式是打开发布的站点，而它只有在改动穿过三个阶梯之后才存在。发布每一个阶梯不是为了舒适：而是缩短写与看之间的距离。

## 决策 {#decisão}

每个永久分支在同一个 GitHub Pages 中发布到自己的位置：

| 阶梯 | URL | 被搜索引擎索引 |
|---|---|---|
| `main` | `https://daneiel.github.io/brabo/` | ✅ |
| `qa` | `https://daneiel.github.io/brabo/qa/` | ❌ |
| `dev` | `https://daneiel.github.io/brabo/dev/` | ❌ |

`main` **不改变 URL**——现有链接继续有效。这是一个要求，而不是一个后果：为了获得预览而破坏文档的 URL，就是用方便换掉正确。

### 必须写下来的后果 {#consequências-que-precisam-estar-escritas}

#### 1. 发布改为直接 push，这是第三个例外 {#1-a-publicação-passa-a-ser-push-direto-e-essa-é-a-terceira-exceção}

`actions/deploy-pages` 把**一个制品作为整个站点**发布，不知道如何更新树的一部分。用它的话，在子目录中发布 `dev` 就意味着任何一个阶梯的每次 push 都要重建三个阶梯。因此发布改用 `peaceiris/actions-gh-pages`，它**提交到 `gh-pages` 分支**。

这打开了 PR 单一入口的**第三个例外**，与 tag 和
`.release/gate.json` 并列——它已登记在
[分支策略](../explanation/branching-policy.md#push-direto-é-bloqueado) 中，因为没有文档化的例外会变成先例。

让这个例外不同于另外两个、也更容易被接受的是：`gh-pages` **不是代码分支**。其中没有任何东西是源，一切都由 `docs/` 和 `website/` 生成，整个删掉也不会丢失信息——下一次 push 会重建它。它的 `git log` 是每次发布的记录，带有日期和来源 sha。

#### 2. `main` 组装树，而不是默认保留 {#2-a-main-monta-a-árvore-em-vez-de-preservar-por-omissão}

`main` 发布到根目录。在根目录发布时删除原有内容，会把 `/dev/` 和 `/qa/` 一并带走：每次生产部署都会让另外两个阶梯下线，直到它们下一次 push。

出路**不是** `keep_files: true`。它从不删除任何东西，一个从仓库中删掉的页面会永远保持发布——这是 API 参考的生成器已经用 `clean-api-docs` 解决的孤儿问题。把“不该消失的消失了”换成“不该留下的留下了”不是修复。

因此树是**组装**出来的：发布之前，`main` 的 job 把 `/dev/` 和 `/qa/` 从 `gh-pages` 带进构建中，然后以 `keep_files: false` 发布完整的集合。这样语义就是精确的——**不在新树中的东西不应该被发布**。

#### 3. `baseUrl` 不再是常量 {#3-baseurl-deixa-de-ser-constante}

`baseUrl` 进入 Docusaurus 发出的每一个资源 URL。一个从 `/brabo/dev/` 提供、却带有 `baseUrl: '/brabo/'` 的站点只会加载 HTML：CSS、JS 和搜索都返回 404，页面看起来*坏了却没有错误*。因此 `baseUrl` 改为来自 `DOCS_BASE_URL`，以生产值作为默认——不带任何变量的 `pnpm docs:build` 继续产出它一直产出的东西。

#### 4. `noIndex` 与本地搜索相互抵消，而这必须被发现 {#4-noindex-e-a-busca-local-se-anulavam-e-isso-teve-que-ser-descoberto}

`dev` 和 `qa` 是处于另一成熟阶段的与生产相同的内容。被 Google 索引的话，它们会与真正的文档竞争，从搜索进来的人会在不知不觉中读到未经验证的版本。因此在 `main` 之外使用 `noIndex: true`。

**但 `@easyops-cn/docusaurus-search-local` 会丢弃所有带有
`<meta name="robots" content="noindex">` 的页面**（`parse.js`，注释 *"Unlisted
content"*）——这正是 `noIndex` 所发出的。测得的效果：索引为 **666 字节，`documents: []`**，搜索框对任何词都回答 *"No results"*。各阶梯会带着死掉的搜索发布，而这一症状不会在任何构建中出现。

插件的选项 `forceIgnoreNoIndex: true` 解决了这个问题，而这个解决办法值得解释，因为它看起来像矛盾：**`noIndex` 面向的是外部搜索引擎；`forceIgnoreNoIndex` 面向的是本地索引。** 想让各阶梯不出现在 Google 中，并不是想让各阶梯没有搜索。

修正后在三种模式下测量：生产、`dev` 和 `qa` 中均索引了 **2318 个文档**，`meta robots` 只出现在后两者中。

#### 5. “按通过的分支”不需要机制 {#5-por-branch-que-passar-não-precisou-de-mecanismo}

对永久分支的 `push` 只能通过 PR 合并发生，而 ruleset 在合并前要求必需的检查。**push 触发器本身就是“已通过”**——不存在本 workflow 发布未穿过流水线的代码的路径。在此记录可以避免有人以后添加一个“检查通过了吗？”的验证，那会是冗余的，并给人一种没有它就会有漏洞的印象。

#### 6. 渲染 gate 在发布之前运行 {#6-o-gate-de-renderização-roda-antes-de-publicar}

`api-render-check.mjs`（见
[documentation-workflow](../explanation/documentation-workflow.md)）除了在 `docs-check` 中，也在 `docs-deploy` 中运行。它是负责**发布**的步骤：如果页面无法渲染，不发布好过发布坏的。正是缺了它，才让两个版本带着死掉的 API 参考发布出去。

## 考虑过的备选方案 {#alternativas-consideradas}

**每次执行一个制品，没有 URL。** 每个阶梯把站点作为 Actions 的 artifact 上传，可以 zip 下载。零 push 例外，零 Settings 改动——对真实用例零用处，真实用例是*打开一个链接看一看*。为了审阅一个页面去下载和解压，摩擦足以让没人去做。

**每个 PR 的预览。** 在审阅中比按分支的站点更有用，机制成本相同。不是因为价值被放弃：它作为可能的补充保留，而本 ADR 的机制（子目录 + `DOCS_BASE_URL`）正是它所需要的。起决定作用的是，背景中描述的空档在*阶梯之间*，而不在 PR 之内——PR 已经有 `docs-check` 在构建站点。

**保留 `actions/deploy-pages`，每次 push 重建三个阶梯。** 没有 push 例外，没有 `gh-pages`。但 `dev` 的每次 push 都会从其他分支重建 `qa` 和 `main`——每次发布三次 checkout 和三次构建，而 `dev` 的一次部署能以没人要求的内容重新发布 `main`。阶梯之间的耦合正是整条流水线存在所要避免的。

## 后果 {#consequências}

- **用户的手动操作：** 在 Settings 中把 Pages 的来源从“GitHub Actions”改为分支 `gh-pages` / `root`。见
  [Rulesets](../reference/rulesets.md)，以及其他需要手动应用的内容。
- `gh-pages` **不进入**永久分支的 ruleset：它不是永久分支，而 bot 需要向它 push。
- `github-pages` environment 不再被该流程使用。它的存在是因为 Pages 创建了它，而不是因为项目声明了它——`CLAUDE.md` 保留不创建 Environments 的规则。
- Rspack 的缓存改为按阶梯作键：`baseUrl` 进入 bundle，因此 `dev` 的缓存对 `main` 无用。否则三者会轮流使彼此失效，缓存就成了摆设。
- 三个阶梯写入同一个 `gh-pages` 需要串行化：workflow 的 `concurrency` 改为整个仓库级别，而不是按分支。

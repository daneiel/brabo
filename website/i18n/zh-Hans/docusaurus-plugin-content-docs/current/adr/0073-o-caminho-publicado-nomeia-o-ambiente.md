---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0073 — 发布路径命名的是环境，而不是分支

- **状态：** 已接受
- **日期：** 2026-08-13
- **修订：** [ADR 0071](0071-publicacao-simetrica-por-degrau.md)

## 背景 {#contexto}

[ADR 0071](0071-publicacao-simetrica-por-degrau.md) 把三个阶梯放在 `/brabo/<branch>/` 下，解决了自 [ADR 0034](0034-documentacao-publicada-por-degrau.md) 起就存在的不对称。它没有质疑的是两者之间的同一性：URL 的段**就是**分支名，通过插值 `$GITHUB_REF_NAME` 得到。

这让稳定版文档位于 `https://daneiel.github.io/brabo/main/`，而 `main` 是提交者的词汇。阅读文档的人并不是在选择一个分支——而是在选择要读的文本**有多成熟**。`qa` 和 `dev` 作为地址能用只是巧合：它们同时是分支名和环境名。`main` 在任何地方都不是环境名。

请求来自产品负责人，一句话：*"a `main` não pode ter o path
`/main`, modificar para `/prd`"*。

## 决策 {#decisão}

### 1. `main` 发布到 `/brabo/prd/` {#1-main-publica-em-braboprd}

另外两个仍在 `/brabo/qa/` 和 `/brabo/dev/`。发布在机制上仍然是对称的——改变的是分支→路径的映射开始**存在**，而不是写成字符串插值的恒等函数。

| 分支 | 发布路径 |
|---|---|
| `main` | `/brabo/prd/` |
| `qa` | `/brabo/qa/` |
| `dev` | `/brabo/dev/` |

### 2. 映射在每个进程中只住在一个地方，各自由它推导其余部分 {#2-o-mapa-mora-num-lugar-por-processo-e-cada-um-deriva-o-resto-dele}

有三个独立的进程，各自有唯一的位置：

- **`.github/workflows/docs-deploy.yml`**——步骤“Qual degrau, e para onde ele
  publica”发出 `branch`、`caminho` 和 `base`。`baseUrl` 和子目录**一起**从这里产生；把它们分开就是它们开始分歧的方式，而与目录不匹配的 `baseUrl` 只会提供 HTML，别无其他。
- **`website/docusaurus.config.ts`**——表 `DEGRAUS` 带有 `branch`、`caminho` 和标签。导航栏的选择器和默认 `baseUrl` 从它读取。
- **`scripts/docs/landing.mjs`**——同一张表，`caminho`（树中的目录）与 `branch`（为阶梯盖上版本戳的 **tag** 来自哪里）分开。这是最容易混淆的一对：`/prd/` 的版本来自 `main` 的 tag，把两者互换会让 `/prd/` 看起来从未发布过。

**不**从路径推导的：`E_PRODUCAO` 仍然是 `DOCS_BRANCH === 'main'`。ADR 0071 第 4 项记录了为什么从路径字符串推导环境是只有在路径改变时才会显现的耦合——而本 ADR 正是路径在改变。确认这一点是这次改动最重要的测试：`DOCS_BRANCH=main` 仍然**没有** `noIndex`；`dev` 仍然有。

### 3. `/brabo/main/` 由 `404.html` 重写，而不是保留 {#3-brabomain-é-reescrito-pelo-404html-não-preservado}

目录 `main/` **今天已经被发布**。由于树是以 `keep_files: false` 组装并推送的，它会成为孤儿并在第一次推送时消失——每个保存的指向 `/brabo/main/architecture` 的链接都会失效。

出路与 ADR 0071 用于旧根目录链接的相同，理由也相同（在两个地址维护站点的一份副本，就是在每次推送时重复发布）：根目录的 `404.html` 重写前缀。`/brabo/main/<algo>` →
`/brabo/prd/<algo>`。

那个并非细节的细节：这是一个**专属**情况，而不是通用的重定向。ADR 0071 的防循环守卫会忽略任何以 `main|qa|dev` 开头的路径，而当 `main` 不在树中时，它会做恰恰错误的事——对唯一需要处理的路径返回 404。守卫改为只覆盖**存在**的路径（`prd|qa|dev`），而 `main` 在它之前处理。没有这个专属情况，通用逻辑会产生 `/brabo/prd/main/<algo>`。

### 4. 过渡期从 `gh-pages:main` 播种 `/prd/` {#4-a-transição-semeia-prd-a-partir-do-gh-pagesmain}

与 ADR 0071 第 6 项同样的推理。`gh-pages:prd` 只有在本次改动之后 `main` 走完流水线时才会诞生，而 `dev` 或 `qa` 的第一次推送会更早到来：没有种子，`/brabo/prd/` 会在数天内返回 404，而 `404.html` 恰恰把所有人都送到那里。

`gh-pages:main` 的内容字面上就是 `main` 的构建。它播种 `/prd/`——**经过重写**，而这一点是通过针对真实 `gh-pages` 模拟组装才发现的：嵌在那个构建中的 `baseUrl` 指向 `/brabo/main/`，而第 3 项的 `404.html` **救不了子资源**。它的脚本在导航时运行；落入 404 的 `<script src>` 或 `<link rel=stylesheet>` 会收到状态码 404 的 HTML 并静默失败。不重写的话，`/prd/` 会提供没有 CSS、没有搜索、没有 hydration 的文本——即 `docusaurus.config.ts` 所描述的本发布中最阴险的失败模式“只加载 HTML”。

重写是对种子中包含该字符串的**文本**文件执行从 `/brabo/main/` 到 `/brabo/prd/` 的 `sed`（模拟中 634 个里有 542 个）。二进制文件通过 `grep -I` 被排除：对其中之一执行 `sed -i` 可能会补上缺失的末尾换行而损坏它。

在 `main` 第一次发布时，常规路径接管，该块不再运行。

ADR 0071 中类似的块（从旧根目录播种 `/main/`）在同一提交中被**移除**。它已完成使命——今天的 `gh-pages` 有 `main/`、`qa/` 和 `dev/`——而它的条件（`FETCH_HEAD:index.html` 存在）开始与 landing 自己生成的索引匹配：保留它会把根页面变成一个阶梯。

## 后果 {#consequências}

- **指向 `/brabo/main/…` 的链接开始需要一次重定向**，永远如此。这是移动公开地址的声明代价，比复制站点或打破保存的链接都小。
- **`qa` 和 `dev` 成为巧合，而不是规则。** 明天要重命名其中之一的人只需修改表格，别无其他——这才是结构性的改变，而不是 `prd` 这个值本身。
- **根目录的角色不变。** 它仍然是列出三者的生成索引，现在规范化指向 `/prd/`；仓库的 About、README 和 `AuthLayout.tsx` 指向它，依然正确。
- **`noIndex` 仍然绑定到分支。** 没有创建新环境，GitHub Pages 的配置也没有任何变化：来源仍然是 `/ (root)` 文件夹中的 `gh-pages` 分支。
- **多一个阶梯就是在三张表中各多一行**——而不是去搜寻插值的 `$GITHUB_REF_NAME`。

## 放弃的备选方案 {#alternativas-descartadas}

- **发布到 `/prd/` 并保留 `/main/` 作为副本。** 无需重定向就能保留链接，代价是每次发布都复制整个站点，并有两个内容相同的可索引地址——ADR 0071 已为根目录放弃的同一备选方案。
- **把 `main` 分支重命名为 `prd`。** 它会在保留插值的同时解决同一性问题，却用一个公开地址换来 ruleset、发布流水线、backmerge 以及仓库中每个 `main` 引用的破坏。提交者的词汇不是问题；读者的词汇才是。
- **在服务器上重定向 `/brabo/main/`。** GitHub Pages 没有重定向规则；根目录的 `404.html` 就是现有的机制。
- **保持原样。** 这是请求所拒绝的备选方案，它有一个支持的弱论据（`main` 已经被发布）和一个反对的强论据：地址是对读者说话的，不是对提交者。

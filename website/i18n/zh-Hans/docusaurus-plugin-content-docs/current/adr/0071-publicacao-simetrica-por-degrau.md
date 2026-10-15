---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0071 — 按阶梯对称发布，以及一个供选择的根

- **状态：** 已接受
- **日期：** 2026-08-14
- **扩展：** [ADR 0034](0034-documentacao-publicada-por-degrau.md)

## 背景 {#contexto}

[ADR 0034](0034-documentacao-publicada-por-degrau.md) 确立了每个永久分支发布自己的文档。它留下的不对称在于地址：`main` 发布在**根**（`/brabo/`），只有 `qa` 和 `dev` 有后缀（`/brabo/qa/`、`/brabo/dev/`）。

这种不对称收取了三种代价，都由读者支付：

1. **根没有说明存在其他阶梯。** 三个站点彼此看不见：落到 `/brabo/` 的人无法到达 `/qa/`，而通过 Google 落到 `/dev/` 的人——在 `noIndex` 之前——不知道自己读的是未经验证的版本。
2. **特殊情况污染了机制。** 在根上发布并删除原有内容会把 `/dev/` 和 `/qa/` 一起带走，所以工作流有一个**只在 `main` 上**运行的步骤，把另外两个带回树中。与另外两个不同的路径，是只有三分之一的时候被演练的路径。
3. **没有地方声明成熟度。** “稳定”、“候选”和“开发中”是已经知道的人才知道的知识。

## 决策 {#decisão}

### 1. 三个阶梯位于 `/brabo/<branch>/` {#1-os-três-degraus-em-brabobranch}

`main`、`qa` 和 `dev` 对称发布。`main` 的特殊情况消失，工作流中的条件步骤也随之消失。

### 2. 根是生成的索引，而不是重定向 {#2-a-raiz-é-um-índice-gerado-não-um-redirecionamento}

把 `/brabo/` 重定向到 `/brabo/main/` 会更简单，回答的却更少：让人查看不止一个阶梯的问题是“`qa` 是否已经有我需要的？”，而重定向吞掉了这个问题。

`scripts/docs/landing.mjs` 生成一个包含三者的页面，每个都有成熟度徽章以及**盖上的版本**，从仓库自身的 tag 读取（`main` 为 `vX.Y.Z`，其他为 `vX.Y.Z-<estagio>.N`——`scripts/ci/tag-release.ts` 的格式）。

它提供**树中存在的东西**，而不是固定列表：缺失的阶梯不会变成链接，因为会 404 的链接比缺失更糟。并且它退出搜索索引，canonical 指向 `/main/`——根是索引，不是内容，被索引的话会与真正的文档竞争。

### 3. 根上的 `404.html` 承接旧链接 {#3-um-404html-na-raiz-segura-os-links-antigos}

移动 `main` 会破坏**每一个已保存的深层链接**：`/brabo/architecture` 将不复存在。GitHub Pages 对未知路径提供根上的 `404.html`，所以它把 `/brabo/<algo>` 转到 `/brabo/main/<algo>`。

有一个守卫，它不是细节：阶梯**内部**的 404（确实不存在的页面）不能再次被转发，否则浏览器会循环。这就是为什么有这个守卫的测试。

### 4. 阶梯是声明的，而不是从路径推导的 {#4-o-degrau-é-declarado-não-deduzido-do-caminho}

这是最重要的改变，而它是不可见的。

站点通过比较 `BASE_URL === '/brabo/'` 来知道自己是否是生产。三者都在子目录中时，这个比较**对 `main` 也**变成假的——其效果会是真正的文档上的 `noIndex: true`：它会静默地从 Google 消失，CI 为绿，因为构建中没有任何东西会因为索引得太少而失败。

`DOCS_BRANCH` 随 `DOCS_BASE_URL` 一起出现，`E_PRODUCAO` 改为 `DOCS_BRANCH === 'main'`。从路径字符串推导环境，正是那种只在路径改变时才显现的耦合。

### 5. 树是组装出来的，三者都是 {#5-a-árvore-é-montada-para-os-três}

原先只存在于 `main` 的步骤变成唯一的路径：另外两个阶梯来自当前的 `gh-pages`，推送的阶梯来自新的构建，根是生成的，整体以 `keep_files: false` 发布。

不是 `keep_files: true`：那样永远不会删除任何东西，从仓库中删除的页面会永远保持发布状态。组装会保留应保留的，删除不应保留的——包括免费完成的**迁移**：`main` 以旧布局留在根上的文件不在组装出的树中，所以第一次推送就会把它们带走。不需要手动清理 `gh-pages`。

### 6. 过渡期从旧的根播种 `/main/` {#6-a-transição-semeia-main-da-raiz-antiga}

在旧布局中不存在 `gh-pages:main`。不加处理的话，`dev` 或 `qa` 的第一次推送会让 `/brabo/main/` 不存在——而由于 `404.html` 恰恰转发到那里，**每个旧链接都会指向 404**，直到下一次晋升到 `main`，这可能需要几天。

今天发布的根，字面上就是 `main` 的构建。所以它在第一次组装时播种 `/main/`，站点永远不会没有稳定版文档。在下一次发布 `main` 时，正常路径接管，这个块不再运行。

### 7. 选择器使用绝对 `href` {#7-o-seletor-usa-href-absoluto}

链接跨越 `baseUrl` 不同的站点。相对链接会在本阶梯内解析——`/brabo/dev/main/`，它不存在。

## 后果 {#consequências}

- **仓库的 About 继续指向根**，而根现在是索引。不需要任何配置改动——而且这是好事：CI 的任何 token 都没有管理仓库的权限范围（`BRABO_BOT_TOKEN` 是 `repo` + `workflow`），所以把这件事自动化需要新的凭据。
- **`/brabo/` 不再是文档**，对只想要稳定版的人而言多了一次点击。这是这里记录的选择的代价：展示三者。
- `README.md` 和 `apps/web/src/routes/AuthLayout.tsx` 继续指向根，它是入口点。
- 发布仍然是直接推送到 `gh-pages`——PR 单一入口的第三个例外，已在分支政策中记录。本 ADR 比 0034 **更**依赖这一点：组装整棵树恰恰是 `actions/deploy-pages` 做不到的。

## 舍弃的替代方案 {#alternativas-descartadas}

- **把根重定向到 `/main/`**：更简单，回答得更少（第 2 项）。
- **保持 `main` 在根上，只有 `qa`/`dev` 带后缀**：这是当前状态，保留了只有三分之一的时候被演练的特殊情况。
- **Docusaurus 的版本化（`docs:version`）**：不同的轴。流水线的阶梯是**同一**内容的成熟度；文档版本是冻结的内容。`CONTRIBUTING.md` 已经记录，在 `0.x` 中版本化会增加维护而不带来任何回报。
- **把 `main` 同时发布在根和 `/main/`**：不用 `404.html` 也能保留旧链接，代价是每次发布都复制整个站点，并有两个内容相同的可索引地址。

---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0068 — Arquiteto 的 C4 图

- **状态：** 已接受
- **日期：** 2026-08-12
- **背景：** 用户的要求——Arquiteto 获得一个新的交付物，在项目概览中渲染
- **扩展：** 与 [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)（`artifact.project_image`）相同的无表构件模式

## 背景 {#contexto}

Arquiteto 今天的交付物是文本和结构化数据——`module_map`（卡片网格）、ADR（带 PR 链接的列表）、insights。没有一个是架构的图像。要求的是一张 C4 图（Simon Brown 的模型——至少 Context 和 Container），真正在界面上渲染，而不是一个指向外部的链接。

编码之前的两个架构问题：

**谁写 Container 层——模型还是仓库？** `module_map` 已经存在，经过无环验证（`create_module_map`）。让模型在图的工具调用中**重新输入**模块和依赖，有静默分歧的风险：图说一回事，当前的 `module_map` 说另一回事，而没有办法知道是哪个说了谎。替代方案——在用例中从当前的 `module_map` 派生 Container 层，绝不从模型重新写的内容派生——按构造关闭了这种分歧。Context 层没有这样的来源：外部参与者是谁（用户、某个 Git provider）是 Arquiteto 的判断，没有一个参与者的 `module_map` 可以派生。因此只有 Context 来自工具调用。

**用什么渲染？** `apps/web` 没有任何图表库（此次变更前 `package.json` 中“mermaid”出现次数为零）；文档站点使用 Mermaid，但是在**构建时**（Docusaurus）。Mermaid 是图表即文本事实上的标准引擎，包括对 `C4Context`/`C4Container` 的原生支持——我们不写布局引擎。用户的决定，在此次变更之前确认：`mermaid` 作为 React 应用新的**运行时**依赖进入，这是同类中的第一个。

## 决策 {#decisão}

**C4 图是事件日志中的版本化构件，没有表——与 `artifact.project_image`（ADR 0065）相同的设计——其 Container 层从当前的 `module_map` **派生**，绝不由模型重新输入。**

- `artifact.c4_diagram`：`CreateC4DiagramUseCase` 获取当前的 `module_map`（`ModuleMapRepository.findCurrent`）；没有它时以 400 拒绝——没有模块就没有 Container 层。它生成两种 Mermaid 语法（`gerarDiagramaContexto`/`gerarDiagramaContainer`，纯函数，位于 `domain/architecture/c4-diagram.ts`），并以 `version` = `GetC4DiagramUseCase.execute(projectId).version + 1` 写入事件——与 `ObterContainerDoProjetoUseCase` 的“当前的是 `version` 最大的那个”读取相同。重新发出就是重新生成；历史不被重写。
- 语法生成中没有正则：模块/参与者的名称来自模型（或模型已经在 `create_module_map` 中写的内容），而这里的 `js/polynomial-redos` 会是 `project-container.ts` 已经避免的同一个 HIGH。标签的转义和 Mermaid id 的生成是逐字符的，与 `referenciaDeImagemValida` 风格相同。
- Arquiteto 中的工具 `create_c4_diagram`：`system_name`（必需）、`system_description` 和 `actors`（名称 + `person`/`external_system` + 描述）。很薄——只规范化并转交；验证和派生的是 api，与 `create_module_map`/`choose_project_image` 的模式相同。
- `mermaid` 隔离在 `apps/web/src/lib/mermaid-render.ts`（`renderMermaid(id, sintaxe)`）之后，带**动态** `import()`——从不打开带已生成图的概览的人不付出 bundle 的代价。`vite build` 确认：只有 `index-*.js`（入口）是急切加载的；Mermaid 的 chunk（`mermaid.core`、`c4Diagram-*`，以及它的重型依赖——`cytoscape.esm` 435 KB、`katex` 258 KB——只被本产品不生成的**其他**图类型使用）按需加载。
- `C4DiagramView.tsx`（apps/web）——每张图三种状态（RN-088）：`rendering`（Skeleton）、`erro`（带 Mermaid 消息的 Alert + 折叠在 `<details>` 中的原始语法，**绝不**让界面崩溃）和 `pronto`（SVG，通过 `dangerouslySetInnerHTML`——是**我们**用 `mermaid.render` 生成的内容，而不是转交的第三方 HTML，Mermaid 中设有 `securityLevel: 'strict'`）。第四种状态，“完全没有图”，属于调用该组件的区块（`ArchitectureSection`），与 `moduleMap`/ADR 已有的一样。
- Mermaid 的主题在运行时从设计系统的 token 读取（对 `--surface-*`/`--text-*`/`--border*` 使用 `getComputedStyle`），绝不是固定颜色——不是因为应用今天有主题开关（没有：dark 是主要的），而是为了不硬编码 `tokens.css` 中已经存在的调色板。

### CSP——已确认，没有变化 {#csp--confirmado-sem-mudança}

web 镜像的 nginx 自 ADR 0058 起就有封闭的 CSP（`script-src 'self'`，没有 `unsafe-eval`/`unsafe-inline`；`style-src 'self' 'unsafe-inline'`）。在生产资产中检查过（`grep -rl "new Function(\|eval(" dist/assets/*.js`）：Mermaid 的**任何** chunk 都不使用 `eval`/`new Function`。`style-src` 在此次变更之前就有 `unsafe-inline`（出于另一个原因——应用自身的内联 CSS），正是它覆盖了 Mermaid 的 SVG 可能嵌入的 `<style>`。`nginx.conf` 没有任何一行改变。

## 后果 {#consequências}

- **bundle 更大，但按需。** `pnpm build` 确认代码分割正确：入口（`index-*.js`）没有因整个 Mermoid 的重量而增长——只有实际渲染图的人才下载它的 chunk。真实成本（没有以网络字节测量，只确认了是懒加载）留到概览第一次显示已生成的图时。
- **只有 Context 和 Container。** Component 和 Code（C4 的第 3 和第 4 层）不在其中——`module_map` 没有组件/代码的粒度，而编造这种粒度并没有被要求。
- **密集的图没有特殊处理。** 一个有几十个模块的 `module_map` 会产生一张很大的 Container 图；没有虚拟化也没有折叠——与 FASE 26 对 Code 标签页（“a mais custosa do programa”）已经做的同样的切分，暂时接受。
- **图与 module_map 之间的分歧只是时间上的，不是数据上的。** 由于 Container 是在生成时**派生**的，如果 `module_map` 之后改变，旧图可能会过时——但它绝不会对生成时存在的东西**说谎**，因为描述模块的不是模型。

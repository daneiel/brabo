---
traducao_de: 2f301391630d5be632e27036026760d416d43da1
---

# ADR 0113 — 附加的本地目录成为 `chunks.scope = 'local'`，由**浏览器**读取，绝不是主机路径

## 状态 {#status}

已接受。

引用（不编辑）：[ADR 0072](0072-projeto-local-ou-container.md)、[ADR 0079](0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)、[ADR 0080](0080-busca-hibrida-pesos-limiar-e-citacao.md)、[ADR 0107](0107-navegacao-de-pasta-local-via-o-runner.md)、[ADR 0108](0108-projeto-runner-nasce-ao-navegar-pasta-no-wizard.md)。

## 背景 {#contexto}

### 需求 {#o-pedido}

让用户把自己机器上的一个本地目录附加到项目，作为 agent 的**只读参考**材料——明确地**不**运行 `brabo-runner` CLI（ADR 0103）。这**不是**项目执行，也不是 workspace：`execution_mode: runner`（ADR 0104）之所以存在，正是因为执行需要一个真实的**主机**路径，供容器/engine 路由命令，并由一个连接上来并核实它的 runner 确认（RN-423）。这个功能更接近"给对话附加文件"，而不是"挂载一个 workspace"。

### ADR 0072 和 ADR 0107 实际拒绝了什么，以及为什么这里不同 {#o-que-o-adr-0072-e-o-adr-0107-de-fato-recusaram-e-por-que-isto-é-diferente}

这两个决定处理的都是从浏览器解析一个**主机**的绝对路径。ADR 0072 拒绝在项目创建时提供目录*选择器*，因为"选择器会要求 api 向浏览器枚举**容器**的文件系统"——只为人体工学而新增暴露面，而且还是错误上下文的文件系统。ADR 0107 通过 Runner（一个以用户自身权限运行在用户自己机器上的进程，而不是 api）来路由读取，从而解决了目录*浏览*，正是因为 api 永远看不到用户真实的文件系统。

两者处理的都是**用户磁盘上的路径从何而来**，两者都重要，因为路径要么供给项目创建（`workspace_path`），要么供给命令执行（`TerminalExecutor` 的 `cwd`）——在这些上下文中，**错误**的路径是安全和正确性问题：它决定了 agent 能针对什么执行。

本功能从不解析主机路径。浏览器的 `<input webkitdirectory>` 返回 `File` 对象；代码读取它们的*内容*（`File.text()`）以及所选目录中的*相对*路径（`File.webkitRelativePath`）——从不读取绝对路径，因为浏览器的 File API 按设计不向任何网站暴露它。穿过网络的是浏览器早已有正当权利读取的**文本**，与任何网站上任何普通 `<input type="file">` 上传的信任模型完全相同。没有需要校验、隔离或路由给 runner 的路径，因为根本没有路径。为此构建 runner 风格的转发，就是在解决一个本功能并不存在的问题。

### 为什么复用 RAG 流水线而不是平行机制 {#por-que-reusar-o-pipeline-do-rag-em-vez-de-um-mecanismo-paralelo}

产品已经有一个能工作的分块/嵌入/混合搜索流水线（ADR 0079/0080）：`chunks` 表、`RagEmbeddingService`、`chunkText`/`chunkMarkdownDocument`、`ChunkRepository.searchByVector`/`searchByLexicalQuery`，以及 Chat RAG 标签页的引用渲染（`RagCitationCard`、`origemDoChunk`）。一个本地附加的文件在结构上与一个被索引的文档/ADR 文件形态相同：一个路径加上应当可搜索、可引用的内容。构建第二个平行的"附加文件"存储和第二套引用 UI，会复制一个早已在做这件事的流水线，唯一的理由只是字节来自浏览器上传而不是 git blob。

## 决策 {#decisão}

**`chunks.scope` 增加第四个值 `'local'`**，通过 `ALTER
TYPE ... ADD VALUE` 添加（迁移 `0052`）——追加式，无数据迁移，无新 CHECK：现有约束 `chunks_session_id_casa_com_escopo`/`chunks_source_path_casa_com_escopo`（迁移 `0045`）本来就写成"是不是 `session`"，所以 `local` 落在与 `docs`/`adr` 相同的一侧（有 `source_path`，没有 `session_id`），除了枚举值之外 schema 零改动。

**`IndexLocalFolderUseCase`** 紧密镜像 `IndexProjectDocsUseCase`：把每个文件切成 chunk（对 `.md`/`.mdx` 通过 `chunkMarkdownDocument` 感知 Markdown，其余用 `chunkText`），调用同一个 `RagEmbeddingService`，嵌入失败时以 `embedding: null` 写入 chunk（`docs`/`adr` 已使用的同一诚实模式——RN-233），并在每次调用时完整地 `deleteByScope(projectId, 'local')` + 重建。`origemDoChunk` **零**改动：`local` 的 chunk 与 `docs`/`adr` 一样携带 `sourcePath`，所以落入既有的 `kind: 'file'` 分支——引用 UI 早已能处理它们。

**一次性拒绝，绝不静默截断。** 与 `docs`/`adr`（无人观看的后台扫描）不同，附加目录是用户的一次性动作，面前就有目录选择器。当超过总量上限（文件数、字节总和）时，`IndexLocalFolderUseCase` **拒绝**（400）整个上传——点击"附加"的人正看着屏幕，可以选一个更小的目录。单个文件过大或扩展名不被识别只会被**跳过**（`filesSkipped`），绝不会拖垮整批——与 `IndexProjectDocsUseCase` 只过滤 `.md` 时隐含的区分相同。

**绝不连接到通用的"立即重新索引"。** `ReindexProjectUseCase` 从**服务器**能重新访问的来源重新读取——项目仓库（`docs`/`adr`）和 event log（`session`）。`local` 作用域没有这样的来源：文本只存在于附加者的浏览器中，服务器从未持久化主机路径（根本没有）。通过通用的重新索引按钮调用 `deleteByScope(projectId,
'local')`，会删除用户附加的参考材料而无法重建——重新上传目录是**唯一**的重新同步机制，而且它是一个有意分开的按钮（`POST .../rag/local`，`maintainer`，与 `reindex` 相同的角色，因为它同样会触发嵌入 provider 并替换已索引的内容）。两个用例在代码中都带有明确的注释，互相指向并指向本 ADR，以免将来的某个"修正"把它们连接起来，在一次无关的点击中悄悄删除用户的参考材料。

**覆盖率如实说明 `local` 实际是什么。** `RagCoverage.local` 是一种**新**形态（`RagLocalCoverage`），而不是复用 `RagFileCoverage`：没有可比较的"仓库中的文件总数"——浏览器上传没有可重新扫描的仓库。它报告**当前**已索引的内容（`filesIndexed`、`folderName`、`lastAttachedAt`）。`lastAttachedAt` 是产品"绝不显示猜测的时间戳"规则（RN-237/ADR 0080）**唯一**声明的例外：它是对该作用域真实的 `MAX(chunks.created_at)`，不是计算或估计的值——同样的诚实纪律，应用于一个碰巧有真实时间戳可答的作用域。

## 本 ADR 不做什么 {#o-que-este-adr-não-faz}

- **不触碰 `execution_mode`/`workspace_path`/runner。** 它们仍然完全如 ADR 0072/0104/0107 所描述：项目代码如何**执行**。本功能向 RAG 索引添加参考材料；对项目代码存放或运行在哪里不持任何意见。
- **不增加第五个"附加文件"概念。** 没有新表，没有平行的引用格式——`local` 是流水线其余部分早已在说的同一个 `ChunkScope` 的一个值。
- **不第二次索引项目自身的仓库。** `docs`/`adr` 继续通过 `ReadProjectCodeUseCase` 从项目的 git 仓库读取；`local` 有意是一个**独立**的来源，用于与项目自身仓库毫无关系的材料（一份规格、一个参考实现、竞争对手的文档，以及用户希望 agent 能搜索到的任何东西）。

## 后果 {#consequências}

- **第二次上传整体替换第一次。** 没有"追加到已附加内容"——`IndexLocalFolderUseCase` 在写入新内容之前删除整个 `local` 作用域。这与 `docs`/`adr`/`session` 早已遵循的完整、幂等重建纪律相同（RN-231），一致地应用，而不是为这个作用域专门发明。
- **二进制文件和过大的文件静默地不出现在搜索中，并通过 `filesSkipped` 声明。** 扩展名白名单（`RAG_LOCAL_ALLOWED_EXTENSIONS`）是真实的内容限制，不只是 UX 修饰——无论浏览器预先过滤了什么，服务器都会强制执行，因为客户端的预过滤是便利，不是保证。
- **信任边界恰好就是普通文件上传的边界。** 没有隔离，没有路径白名单，没有 runner ticket——因为本功能中根本没有路径，只有浏览器早已拥有的字节。能调用 `POST .../rag/local` 的人（`maintainer` 角色）可以把任意文本放进项目的搜索索引；这与该路由对 `reindex` 早已要求的权限相同。

## 考虑过的替代方案 {#alternativas-consideradas}

- **像目录浏览那样通过 Runner 路由读取（ADR 0103/0107）。** 被拒绝：Runner 的存在是为了在用户已明确用 CLI 配置过的机器上，给 **ENGINE** 一个可以针对其执行命令的真实主机路径。本功能明确设计为**不**需要 CLI、用于只读参考材料——通过 Runner 路由会让 CLI 成为本功能设计上所不需要的前提。
- **一张独立于 `chunks` 的新 `attachments` 表。** 被拒绝：它会复制分块、嵌入、混合搜索和引用渲染，却没有任何好处——"路径 + 内容，可搜索、可引用"正是 `chunks` 早已建模的东西。
- **把 `local` 连接到 `ReindexProjectUseCase`。** 被拒绝：对这个作用域而言，服务器一侧没有任何可重新读取的东西；连接它会让通用的重新索引按钮静默删除用户附加的参考材料，而无法找回。

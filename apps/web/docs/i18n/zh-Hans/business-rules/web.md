---
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
id: rn-web
title: 'Regras de negócio — Web'
sidebar_label: Web
description: 'As RNs hospedadas na raiz web.'
keywords: [regras de negócio, web]
---

# Web

## 项目面板

预算、计量和成本上限的 RN 位于
**[业务规则——成本](custo.md)**。

与下面“认证”一节的原因相同：是篇幅，而不是主题。
`#rn-NNN` 锚点保持不变。

## 成本

### RN-039 — 项目状态点：风险总是胜过不活跃 {#rn-039}

仪表盘侧边栏为每个项目显示一个健康状态点，由三个独立信号推导：预算（与 RN-018 相同的 70%/90% 阈值）、阻塞的任务（`tasks.blocked`）和近期活动（7 天）。颜色：绿色 = 健康且活跃；琥珀色 = 预算 ≥70%；红色 = 预算 ≥90% **或**有阻塞任务；灰色 = 最近 7 天没有活动。当风险信号（琥珀色/红色）和不活跃信号（灰色）同时适用时，风险信号胜出——一个超支又停滞的项目仍然是需要查看的，而不是应该藏在“没有活动”后面的。

- **位置：** `apps/web/src/lib/project-status.ts`（`deriveProjectStatus`）
- **测试：** `apps/web/src/lib/project-status.test.ts`
- **来源：** 项目仪表盘忠实于已批准的设计

### RN-064 — 心跳不会结束有待定工作的会话 {#rn-064}

> **由 [RN-581](api.md#rn-581)（AT-072）扩展：** 等待用户的对话型 agent 成为*第五个*信号，也是唯一有上限的（8h，原因 `conversation_idle_timeout`）；响应新增了
> `aguardandoUsuarioDesde`。这条规则的其余部分照旧有效。

心跳超时衡量的是**标签页**的不活动，而不是**工作**的不活动。在结束之前，`SessionServer` 询问 api 是否还有剩余工作（`GET /internal/sessions/:id/pending-work`）；如果有，它重新安排超时并在日志中记录原因，而不是杀死会话。

默认值是 **30 秒**。离开会话切换到 Backlog 标签页就足以杀死它——在一次真实执行中，这把一个给 Arquiteto 的 `offered` handoff 困在了一个已关闭的会话中：史诗和四个故事都已就绪，而链条无法继续，因为没有地方可以接受已死会话的 handoff。

关闭会话关乎工作是否结束，而不是谁在看。

**api 宕机*不*会阻止结束**：`{:error, _}` 照样结束，在日志中给出警告。用永生的会话换掉孤儿会话，就是用一个缺陷换另一个。

"待定工作"是**三个**信号——第二个来自发现 V，第三个来自 Criativo→PO→Arquiteto 的真实 bug：

1. **`offered` 的 handoff**——上面的原始情形；
2. **状态为 `pending` 的 `proposed_action`**——有人在等*你的*决定，某个 agent 可能已暂停等待结果（[RN-073](engine.md#rn-073)）；
3. **已*激活*且仍在回合中的 agent**——在会话中发过言的每个执行者的最后一个 `agent.status` 是 `working`，之后没有 `idle`。

第二个是第一个的同一缺陷低一个层级，而 `hello-limpo` 的执行显示了代价：会话诞生于 23:34:12，一个动作在 23:34:13 变为 `pending`，心跳在 **23:34:42——恰好是超时的 30s**——关闭了它。dev agent 在一个数据库认为已结束的会话中又工作了一个多小时，这毒害了每一项按会话的指标：时长、成本以及"多少个好好结束了"都开始读取一个不描述实际发生之事的状态。

第三个是同一个窗口，在前两个任何一个存在之前一步：`AcceptHandoffUseCase` 把旧 handoff 标记为 `accepted` 并立即激活下一个 agent，但 engine 中的激活是 `GenServer.cast`，发出即不管——在 agent 甚至开始之前就响应 201。由 Criativo 的 handoff 激活的 PO 运行一个最多 12 次 LLM 迭代的 kickoff，只使用 `category: :direct` 的工具（`create_epic`/`create_story`/`create_task`），它们从不产生 `proposed_action`，并且只在整个回合*结束*时才提供下一个 handoff（信号 1）。在激活与那个结束之间，信号 1 和信号 2 都不存在——只有每 10s 一次的 Phoenix 通道 ping 撑着会话，任何超过 30s 超时的延迟都会在 PO 仍在生成 backlog 时关闭会话，从根上打断 handoff 链：下一个 handoff 最终被提供在一个已经 `closed`、不再接受任何东西的会话中。

`agent.status`（`working`/`idle`）是每个对话型 agent（Criativo/PO/Arquiteto/Dev Lead/Infra）已经在回合边界叙述的东西，并且被*持久化*在事件日志中，而不只是在通道中广播
（`Engine.Sessions.LiveBroadcast.agent_status/4`，[ADR 0021](../adr/0021-fechamento-4a-infra-e-painel.md)）
——团队面板已经读取同一个信号来推导名册（`apps/web/src/lib/agent-status.ts` 中的 `conversationalStatus`）。在这里复用它不需要任何新事件：第三个信号是在会话中发过言的*每个*执行者的最后一个 `agent.status`，并且按事件类型是通用的——它覆盖任何由 handoff 激活的 agent，而不只是 PO。

这条规则的上一个版本白纸黑字地写着，把 agent 的工作包括进来"而没有证明这种交互的测试，就是在猜"。执行产生了证明，测试现在存在了。

**仍然排除在外的：**没有待定动作、没有 handoff、也没有未完回合的 `in_progress` 任务。dev agent 有自己的状态机，自行持有 worktree；api 拥有且执行已证实的信号是待定动作。把任务包括进来需要 api 读取属于 engine 的 `dev_agent_states`——这是边界决定，不是顺手修复。dev agent 也不发出 `agent.status`（它们用自己的状态机运行，而不是对话型的回合循环）——第三个信号不覆盖它们，也不需要：待定动作已经覆盖了它们的路径。

- **位置：** `apps/api/src/application/use-cases/sessions/get-session-pending-work.use-case.ts`,
  `apps/api/src/application/ports/session-event-repository.port.ts`
  （`listByTypeInSession`），`apps/engine/lib/engine/sessions/session_server.ex`
  （`handle_info(:heartbeat_timeout, …)`）
- **测试：** `apps/engine/test/engine/sessions/session_lifecycle_test.exs`
  （`heartbeat NÃO encerra sessão com trabalho pendente` 以及相反的情形）和
  `apps/api/test/application/use-cases/sessions/get-session-pending-work.use-case.spec.ts`
  （三个信号、已经决定因而*不*撑住会话的动作、释放会话的 `idle`、按执行者的隔离、按 agent 类型的通用性以及按会话的范围）
- **来源：** FASE 13b 的真实执行；发现 V，[backlog](../explanation/backlog.md) 的 Fase H；Criativo→PO→Arquiteto 链式衔接的真实 bug

### RN-088 — 加载失败要在屏幕上说出来；429 不重试 {#rn-088}

每个从 api 加载数据的屏幕都区分三种状态，永远不是两种：
**加载中**（骨架）、**错误**（api 发来的消息，带
`trace_id` 和一个重试按钮）和**空**（空列表文本）。
`if (!dado) return null` 把三者折叠在一起，而观察到的结果是最糟的：在 api 以 `429` 限流时，`/projects/:id` 的主区域**完全空白**——没有消息、没有错误、没有骨架——原因只存在于控制台。在仪表盘上比空白还糟：`!projects`
在出错时也为真，于是屏幕邀请人在一个可能已有二十个项目的工作区里创建**第一个**项目。

这是 [RN-059](engine.md#rn-059) 在线程另一端的体现：失败永远不会变成空响应。
失败的一方要说出来。

这句话是 **api 的**，由 `mensagemDaApi` 提取——与变更路径在 toast 中已在使用的是同一个函数。我们自己的通用文本不知道“请求次数超限，请稍后再试”（等待）和“访问被拒绝”（等也没用）之间的区别。

同一条规则的另一面是不要用更多流量回应限流。**4xx
不重试**：`429` 字面意思就是服务器让你停下，而 `401` 已经在 `request()` 内部续期过一次。并且**查询出错时轮询停止**——在窗口获得焦点、重新挂载或点击按钮时恢复。以前每次失败有三次重试，再加上约 25 个每 3 到 5 秒一次、不知道停下的轮询：一个真实会话针对每用户每分钟 300 次请求的限制（`RateLimitGuard`）累积了 **1128 个 429 错误**，而这个循环让滑动窗口无法恢复。5xx 和网络故障仍保留三次尝试，在那里重复才是正确的反应。

- **位置：** `apps/web/src/lib/query-policy.ts`（`deveRetentar`、
  `pollQueParaNoErro`）、`apps/web/src/components/ErroDeCarregamento.tsx`、
  `apps/web/src/routes/ProjectPage.tsx`、`apps/web/src/routes/Dashboard.tsx`、
  `apps/web/src/routes/Shell.tsx`、`apps/web/src/main.tsx`
- **测试：** `apps/web/src/lib/query-policy.test.ts`；
  `apps/web/src/routes/ProjectPage.test.tsx`（429 变成带 api 原话的消息；403 显示 403 的原因；加载中不是错误）；
  `apps/web/src/routes/Dashboard.test.tsx`（列表出错不会变成“还没有项目”）；`apps/web/src/routes/Shell.test.tsx`（侧边栏说出来而不是留空）
- **来源：** 在 `/projects/:id` 上的真实浏览，控制台中有 1128 个 429 错误

### RN-089 — 同名项目在侧边栏中区分 {#rn-089}

项目名称**不唯一**——领域中没有任何东西阻止这一点。当列表中两个或更多项目同名时，它们每一个都在侧边栏显示缩写 id 和创建日期（`#a1b2c3d4 · 07/08 14:32`），两者都已在项目的 payload 中。名称唯一的项目不显示任何东西：在屏幕上空间最小的地方每行都加图例只会是噪音。

具体来源：一次验证运行创建了二十个名为
`validacao-real` 的项目，侧边栏的二十行在视觉上完全相同。

- **位置：** `apps/web/src/lib/project-label.ts`（`nomesRepetidos`、
  `desempateDoProjeto`）、`apps/web/src/routes/Shell.tsx`
- **测试：** `apps/web/src/routes/Shell.test.tsx`（重名获得区分，唯一名称不获得）
- **来源：** 侧边栏塞满验证项目的真实浏览

## 会话

### RN-098 — 会话名称附加在 hashtag 上，永不取代它 {#rn-098}

会话可以获得一个友好名称（`sessions.name`，可选），在创建时或之后通过 `PATCH /projects/:projectId/sessions/:sessionId` 设置。屏幕上显示的标签是**组合的**：`<name> · #<first 8 characters of the
id>`。没有名称时，它降级为**只有 hashtag**。

hashtag 永不消失，原因是操作层面的：它是被粘贴进 URL、命令或对话里的东西，而人选择的名称**不唯一**——两个名为“Checkout”的会话很正常。空白名称（或仅有空白字符）在创建和重命名时都算作**缺失**：写入 `''` 会让标签变成 `" · #a1b2c3d4"`，比只有 hashtag 还糟。`PATCH` 请求体中的 `null` 是**撤销**的方式。

重命名**不是**会话事件。事件日志记录的是会话经历过的事，而名称是导航标签，想改多少次都行——N 个重命名事件会把真正重要的内容挤出 200 个事件的尾部。

- **位置：** `apps/web/src/lib/session-label.ts:61`（`rotuloDaSessao`）、
  `apps/api/src/application/ports/session-repository.port.ts:52`（`rename`）。
  既可从会话内部到达
  （`apps/web/src/routes/SessionPage.tsx:439`，`handleRename`），也可从项目列表到达，无需先打开会话
  （`apps/web/src/routes/ProjectSessionsTab.tsx:101`，`handleRenomear`）——两个屏幕调用同一个 `renameSession` 和同一个 `rotuloDaSessao`。
- **测试：** `apps/web/src/lib/session-label.test.ts`、
  `apps/api/test/application/use-cases/sessions/session-kind-e-nome.spec.ts`、
  `apps/web/src/routes/ProjectSessionsTab.test.tsx`
- **来源：** [ADR 0061](../adr/0061-tipo-da-sessao-na-criacao.md)

## 项目面板

### RN-099 — 活动分页浏览过去，而不重新轮询不会变化的内容 {#rn-099}

概览中的**活动**列显示一个锚定在会话**尾部**的 100 个事件的**窗口**，并一页一页地向过去下翻。每一页使用
`GET /projects/:p/sessions/:s/events` **本来就**返回的 `afterSeq`/`nextCursor`：没有新路由，没有新参数。

**两个问题，两个查询。** `useSessionEvents` 回答“现在是什么样”——轮询最近的 200 个——并为团队面板、树形时间线、执行区块和审批标签页供数。它们都不分页。活动回答的是“发生了什么”，而它曾是唯一一个用另一个问题的答案来回答这个问题的：一次 200 条，没有开头也没有结尾，而且仍然够不到长会话的起点。

**锚点是尾部，而不是会话的开头。** 该端点向**前**分页，并不存在 `beforeSeq`——发明一个就是新契约。但在一个有数千事件的会话中从第 1 号事件打开信息流会给出错误的屏幕：打开活动的人想看的是刚刚发生的事。所以第一页就是屏幕本来就做的那次 `latest` 读取，使用**相同的 `queryKey`**（React
Query 用**一次**获取服务两者），每次点击用 `afterSeq` 向下翻一个固定窗口。

**分页不能付出的代价。** 每个轮询周期一次请求——与之前相同，[RN-090](api.md#rn-090)/[RN-091](api.md#rn-091) 的节省不会倒退。三个部件保证了这一点：

- 尾部就是屏幕本来就有的查询，通过 `queryKey` 共享；
- 第一次点击**不会**变成请求：`latest` 读取带来 200 条而窗口显示 100 条，所以先展示已经付过费的内容，再去请求新的；
- 旧页面是覆盖**不可变**事件（事件表上从不 UPDATE）的一个**封闭** `seq` 窗口：`staleTime: Infinity` 且
  **没有** `refetchInterval`。在那里轮询就是付出 N 次请求去接收 N 个相同的响应。

**计数对它所知道的东西是诚实的。** 按智能体和按类型的筛选运行在**已加载的页面**上，而不是整个会话上——所以 UI 说
`N de M carregados`，而不是“N 条结果”。把筛选放到服务器上会得到真实的总数，但要动事件仓库；那不属于这个阶段，而说出错误的总数比说得少更糟。

[RN-088](#rn-088) 的三种状态在这里适用：**错误先于空**——在 api 拒绝时，该列过去会说“没有活动”。

- **位置：** `apps/web/src/lib/hooks.ts`（`useSessionEventHistory`、
  `EVENTOS_POR_PAGINA`）、`apps/web/src/components/ActivityFeed.tsx`、
  `apps/web/src/routes/ProjectOverviewTab.tsx`、
  `apps/api/src/infrastructure/persistence/drizzle/session-event.repository.ts`
  （`listPaginated`，已存在）
- **测试：** `apps/web/src/lib/session-history.test.tsx`（在尾部打开；第一次点击不花请求；下一次以连续的 `afterSeq` 分页；循环在会话开头终止；与当前状态一起挂载时尾部只是**一次**获取；旧页面不重新轮询）；
  `apps/web/src/components/ActivityFeed.test.tsx`（“N de M carregados”跟随筛选；没有分页 props 时什么都不变）
- **来源：** 用户在第一次真实浏览中的请求——“Atividades na
  aba Visão Geral deve ser paginada, para não ficar infinita”

## 会话

### RN-104 — 标签页由记录的类型推导，并以该类型创建 {#rn-104}

项目有**两个**会话标签页——**Criativo** 和**聊天**——每一个都是一种 `kind`：它列出 `sessions.kind` 为其自身的会话，其 CTA 以该 `kind` 创建，**不再询问**。没有同时列出两者的第三个标签页。

类型本来就是不可变的（[RN-097](api.md#rn-097)），正是这一点使它成为合法的导航坐标，而不是一个保存的筛选器：会话永远不会换标签页。标签页读取的是**记录的**字段——它不从任何事件推导类型，理由与 RN-097 相同：`execution.activated` 分类的是执行状态，看它的标签页会自己移动。

这条规则确定了两个后果，而且它们不是屏幕细节：

- **类型选择离开了表单。** 它曾经位于单选按钮的 `fieldset` 中，现在在人点击标签页的那一刻发生。两者都保留会提供创建一个与你所处位置相矛盾的会话的机会。表单中留下的是**名称**，它仍然是可选的（[RN-098](#rn-098)）。
- **一个操作，一次一个位置。** “开始构思”仍然存在——它是把 Criativo 智能体带进会话的东西，从那时起开始花费 owner 的密钥（[RN-058](api.md#rn-058)）；没有人会自己进来。改变的是它所在的位置：邀请在屏幕上时位于**邀请内部**，不在时位于顶栏。邀请过去会**指向**顶栏（“使用屏幕顶部的开始构思”），这正是引发 [RN-097](api.md#rn-097) 的问题的字面版本——操作在一处，解释在另一处。顶栏不能简单地去掉按钮：可以在从未召唤 Criativo 智能体的情况下在创作型会话中输入，这时邀请就退场了。

三个屏幕都遵守 [RN-088](#rn-088) 的三种状态，**错误先于空**：两种情况下筛选后的列表都是空的，而在 429 之后说“还没有构思”就是在对发生的事撒谎。

聊天的深链接键仍然是 `sessions`，而不是 `chat`。正是这一点让旧的书签链接 `?tab=sessions` 打开聊天时**标签栏中该标签被标记**——只在面板中把旧键解析为别名，会让标签栏完全没有选中项，因为 `Tabs` 将 `active` 与 `key` 比较，而写入 `active` 的一方从 `validateSearch` 收到的是原始键。

- **位置：** `apps/web/src/routes/project-tabs.ts:95`（两个条目）、
  `apps/web/src/routes/ProjectSessionsTab.tsx:114`（按记录的
  `kind` 筛选）和 `:98`（以标签页的 `kind` 创建的 CTA）、
  `apps/web/src/routes/SessionPage.tsx:716`（`conviteVisivel`，顶栏和邀请共享的唯一问题）
- **测试：** `apps/web/src/routes/ProjectSessionsTab.test.tsx`、
  `apps/web/src/routes/project-tabs.test.tsx`、
  `apps/web/src/routes/SessionPage.sessao.test.tsx`
- **边界情况：** 没有该类型会话的项目显示**该类型的**空状态，即使它有另一类型的会话——这是信息，不是错误。
- **来源：** [ADR 0061](../adr/0061-tipo-da-sessao-na-criacao.md)

### RN-107 — 代码标签页有*第四*种状态：因待定决定而被阻塞 {#rn-107}

[RN-088](#rn-088) 的三种状态（加载中/错误/空）无法描述
`sem_decisao`（[RN-105](api.md#rn-105)）：它不是加载中（api 已经响应了），不是错误（它*正确地*响应了），也不是空（缺的不是数据——缺的是一个*决定*，那是另一回事）。把 `sem_decisao` 当作"空"会显示一个没有文件的编辑器，引人认为仓库是空的；当作"错误"会让界面建议"重试"一件只有 Arquiteto 能解决的事。

标签页在尝试读取代码*之前*询问容器的状态（`GET /projects/:id/container`），而不是等第一个目录树或文件返回 409——这与 api 已经在 `ReadProjectCodeUseCase` 的漏斗中做的检查（RN-105）相同，只是先问，让第四种状态以自己的消息诞生，而不是作为通用错误的页脚。被阻塞期间，界面每 15s 自行重新查询——镜像一旦决定，没有新的人工操作就不会改变，持续重新查询一个稳定状态，就是 PÓS-FASE 15 那一族的不必要流量。

第四种状态的呈现被*提取*到 `ContainerImageGateNotice`
（`apps/web/src/components/ContainerImageGate.tsx`）——使用中的发现：PR 标签页（`apps/web/src/routes/code/PrListAndDiff.tsx`，由
`ProjectPrsTab.tsx` 和 `CodeDiffPanel.tsx` 使用）调用 `getCodePullRequests`/
`getCodeDiff`，它们经过*同一个*漏斗（RN-105），可能返回*同一个* 409——但与这个标签页不同，它不事先询问。它把这个 409 显示在带"重试"的通用错误横幅中，对一个只有 Arquiteto 能解决的状态来说，这是错误的可供性。`isContainerImageGateError`
（`apps/web/src/lib/api-client.ts`）通过 `status === 409` 识别原因——这是 `ReadProjectCodeUseCase.alvo` 中 `ConflictException` 的唯一原因——，`PrListAndDiff` 在匹配时用 `ContainerImageGateNotice` 替换横幅，没有自己的预检（它对本来就要运行的查询的 409 作出反应）。

- **位置：** `apps/web/src/routes/ProjectCodeTab.tsx`,
  `apps/web/src/routes/ProjectCodeTab.module.css`,
  `apps/web/src/components/ContainerImageGate.tsx`（共享的呈现），`apps/web/src/routes/code/PrListAndDiff.tsx`（对 409 作出反应的消费者），`apps/web/src/lib/api-client.ts`
  （`isContainerImageGateError`）
- **测试：** `apps/web/src/routes/ProjectCodeTab.test.tsx`（"o gate"），
  `apps/web/src/routes/code/CodeDiffPanel.test.tsx`,
  `apps/web/src/routes/ProjectPrsTab.test.tsx`（"o gate do container não é
  erro genérico"）
- **边界情况：** 前端的检查*不*取代 api 的检查——它是 UX 上的便利。如果 api 在 gate 查询与真正读取之间改变了状态，读取路由仍以 409 拒绝（RN-105）；前端只是避免了短暂显示空编辑器的常见情形。PR 标签页不做预检：它在查询已经失败时才发现阻塞，因为那里没有任何目录树/文件会出现代码标签页的预检所避免的那个"空"的瞬间。
- **来源：** [ADR 0065](../adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

### RN-108 — 会话 socket 要求一次性的不透明 ticket，而不是复用 JWT {#rn-108}

`EngineWeb.SessionSocket.connect/3` 原来只要求 `session_id`（UUID）存在于 Registry 中就允许连接——发现了 UUID 的人就能进入 `session:<id>` 通道，接收该会话的所有实时广播。关闭这一点是自 Fase 3 起就记录在模块本身中的刻意限制。

`POST /projects/:projectId/sessions/:sessionId/socket-ticket`（`scope:
"heartbeat"|"terminal"`）签发一个不透明 ticket（32 字节 CSPRNG，
`TokenFactory`），TTL **30 秒**，一次性。`scope: "heartbeat"` 要求角色 `viewer`；`scope: "terminal"` 要求 `developer`——与 `domain/actions/decide.ts` 中 `MIN_ROLE_FOR_ACTION_TYPE.terminal` 相同的最低角色（目前没有任何路径真正请求 `terminal`；这个值为 FASE 25 的交互式终端正确地诞生）。api 只持久化*哈希*（**纯** SHA-256，而不是 `hashDeToken`/HMAC——engine 没有 api 的 pepper，而一个 256 位的 CSPRNG token 不需要 pepper 来防御字典攻击，与 `hashDeToken` 自己记录的推理相同），从不持久化原始 token。

消耗属于 *ENGINE*，它直接读取 `session_socket_tickets`（与 `Engine.Outbox.Event` 对 `outbox_events` 的模式相同——绝不是 changeset/insert，只有一次性所需的窄写入），分*两*步：
`SocketTicket.validar/1`（窥视，不标记任何东西——由 `connect/3` 调用，它还不知道将请求哪个 `session_id`）和
`SocketTicket.consumir/2`（条件 `UPDATE`，要求主题的 `session_id` 与该行一致——由 `SessionChannel.join/3` 调用，它还会对照会话的 `project_id` 检查 ticket 的 `project_id`，纵深防御，防止一个项目的 ticket 打开另一个项目的通道）。没有 ticket，或 ticket 无效：整个连接被拒绝（`{:error, %{reason:
"unauthorized"}}`），而不只是通道的 join。

web（`session-channel.ts`）在*每次* `socket.connect()` 之前都获取一个*新* ticket——包括自动重连，它确实存在。`Phoenix.Socket` 的原生重连会复用构造时的同一个 `params`（旧 ticket，已经过期或被消耗），因此它被中和（`reconnectAfterMs` 几乎永不触发），重连完全变为手动，每次尝试都获取新的 ticket。

这种中和适用于 socket 的*每个*客户端，而不只是 web 的——包括 `/runner` socket，它的 ticket（`POST .../runner-ticket`）是同一口径。它在仓库四个 `Socket` 构造器中的*两个*里失败了，代价在真实执行中被测量：`apps/runner/src/
channel.ts` 构造 socket 时没有这个选项——而模块的 docblock 却*声称*重连"因此被中和"——自动重连每 **~5.13s**（phoenix.js 内部退避的上限）重复同一个已被消耗的 ticket，几个小时内产生 **61 次 `REFUSED CONNECTION TO
EngineWeb.RunnerSocket`**。再加上 runner *自己*的策略（`index.ts`，这个是正确的），结果是**一分钟 530 个请求**，而 `RATE_LIMIT_USER` 的上限是 300——由于限制是按*用户*的，429 出现在账户所有者的*浏览器*中。两个后果，第二个比 429 更糟：处于这个循环中时 runner *没有*连接，因此 `RunnerReadiness`（RN-507）会拒绝，项目看起来"没有本地 agent"。`apps/web/src/lib/fs-browser-channel.ts` 有*同样*的缺陷行（同样的一次性 ticket，且没有自己的重连策略——它的 `onClose` 说"关闭再重新打开"），一并修正。

阻止第三个实例的是*机制*，而不是注释：在 runner 中，`Socket` 的选项变成了一个 `reconnectAfterMs` *必填*的类型（`channel.ts` 中的 `OpcoesDoSocket`），两侧都增加了断言*传给*构造函数的*选项*的测试——一个只检查"能连上"的测试在缺陷存在时也会通过，而且确实通过了。同时，`conectarERodar`（`index.ts`）开始显式*丢弃*掉线的连接（`conexao.desconectar()`）：没有这一点，上一轮的 `Socket` 会在下一轮创建后继续存活，每次掉线都会多留下一个用失效 ticket 尝试的存活对象。

- **位置：** `apps/api/src/db/schema/sessions.ts`（`sessionSocketTickets`），
  `apps/api/src/domain/sessions/socket-ticket-scope.ts`,
  `apps/api/src/application/use-cases/sessions/create-socket-ticket.use-case.ts`,
  `apps/api/src/interfaces/http/sessions/sessions.controller.ts`（路由
  `socket-ticket`），`apps/engine/lib/engine/sessions/socket_ticket.ex`,
  `apps/engine/lib/engine_web/channels/session_socket.ex`,
  `apps/engine/lib/engine_web/channels/session_channel.ex`,
  `apps/web/src/lib/session-channel.ts`,
  `apps/web/src/lib/fs-browser-channel.ts`,
  `apps/runner/src/channel.ts`（`OpcoesDoSocket`、
  `NUNCA_RECONECTAR_SOZINHO_MS`），`apps/runner/src/index.ts`
  （`conectarERodar`，掉线连接的丢弃）
- **测试：**
  `apps/api/test/application/use-cases/sessions/create-socket-ticket.use-case.spec.ts`,
  `apps/api/test/domain/sessions/socket-ticket-scope.spec.ts`,
  `apps/api/test/infrastructure/persistence/session-socket-ticket.repository.spec.ts`,
  `apps/engine/test/engine/sessions/socket_ticket_test.exs`（复用失败、session_id 错误失败、并发竞争只有一个胜出），
  `apps/engine/test/engine_web/channels/session_socket_test.exs`（没有 ticket 时连接被拒绝），
  `apps/engine/test/engine_web/channels/session_channel_test.exs`（另一个项目的 ticket：join 失败），`apps/web/src/lib/session-channel.test.ts`,
  `apps/runner/src/channel.spec.ts`（"neutraliza o auto-reconnect do
  Phoenix.Socket — ticket de uso único nunca é repetido"；断言传给构造函数的*选项*，没有它则失败），
  `apps/web/src/lib/fs-browser-channel.test.ts`（同样的断言，用于文件夹浏览器经由 runner 的传输）
- **边界情况：** ticket *不是*复用的 JWT——短 TTL、一次性、封闭的范围，并且诞生于一条已经检查有效角色的专门路由，而不是解码现有的 access token。
- **来源：** 没有 ADR——单点的提取/加固，不是结构性变更。

### RN-113 — 编辑器中的 blame 是*按需*的注释——一个开关，绝不嵌入文件读取 {#rn-113}

使用 [RN-110](contracts.md#rn-110) 基础的 UI 在这里登场：代码标签页的编辑器（`CodeEditor.tsx`）只有在用户打开 "Blame" 开关时才调用 `getCodeBlame`——绝不与文件读取一起调用，后者在打开标签时就会自行触发。原因与组合读取的预算相同（ADR 0060）：blame 是每个打开的文件对提供方的*第二次*调用，接近上限（`GIT_BLAME_LINE_LIMIT`，2000 行）的文件已经昂贵到不应该在每次浏览时免费支付。`truncated`（RN-110 已经暴露）成为可见的提示，与 `fileQuery.data.truncated` 的提示同一模式。

*同一*提交的连续行只在块的*第一*行显示作者和短 sha——在数十行的块中的每一行重复相同的文本是噪音，而不是注释；该行只是从文本中消失，从不从注释中消失（元素的 `title` 在块的任何一行中都保留完整日期和提交摘要）。

- **位置：** `apps/web/src/routes/code/CodeEditor.tsx`,
  `apps/web/src/routes/code/CodeEditor.module.css`
- **测试：** `apps/web/src/routes/code/CodeEditor.test.tsx`
- **来源：** FASE 26b 的 UI 波（blame——丰富的分支下拉菜单和 PR 列表是另外两个 agent 的 UI，没有冲突风险）

## 项目面板

### RN-118 — 团队树按里程碑展示执行细节，并展开“最近 5 个” {#rn-118}

`AgentTimelineTree`/`timeline-tree.ts`（FASE 14b）早已按智能体对事件日志分组，但有三个缺口：展开一个分支的标准只是活动/停止（与存在多少个智能体无关），标题的计数是里程碑的**总数**（从不是“新的内容”），而 `tool.call`/
`tool.result`/`agent.response` 变成的里程碑只显示工具名称——事件日志早已记录的 `args`、`result` 和 `iteration` 从未到达屏幕。

**默认展开**变为“最近活动的 5 个智能体（最后一个里程碑的 `seq` 最大）”，活动的智能体保持对新近度的优先——两者不相加：由于 `montarArvore` 已经先排活动的，并在每组内从最新到最旧排序，两个标准折叠为一个切片（`ramosAbertosPorPadrao`，即前
`max(nº de ativos, 5)` 个分支）。活动的超过 5 个：全部展开，不截断。

每个智能体的**新内容计数**使用与铃铛**相同**的机制
（`read-state.ts`、`localStorage`），粒度是 `projectId:agentId` 而不只是 `projectId`——此前不存在这种粒度的“最后查看”。折叠的分支若有 `seq` 大于该智能体最后查看值的里程碑，就显示**新内容**计数而不是总数；展开分支（自动或手动）会将其标记为已查看，直到最新的 `seq`。

**可展开的细节**是按**里程碑**，而不是按分支——只有 `tool.call`、
`tool.result` 和 `agent.response`（`EVENTOS_EXPANSIVEIS`）变成单独的按钮，因为只有它们携带值得展开的 payload。按**迭代**的视觉分组在存在时使用
`agent.response` payload 中的 `iteration`（ToolLoop——`tool.call`/`tool.result`
继承分派它们的那次响应的迭代，因为在 ToolLoop 中它们是在响应**之后**发出的）；ToolLoop 之外的智能体（PO、Criativo，payload 中没有
`iteration`）获得每个智能体**自己**的计数器，每次响应递增——按 `seq` 邻近性推断，而不是事件日志中的新字段。

- **位置：** `apps/web/src/lib/timeline-tree.ts`（`Marco.iteracao`、
  `Marco.eventType`、`Marco.payload`、`ramosAbertosPorPadrao`、
  `marcoExpansivel`）、`apps/web/src/components/AgentTimelineTree.tsx`、
  `apps/web/src/lib/read-state.ts`（`getAgentLastSeenSeq`/
  `setAgentLastSeenSeq`）
- **测试：** `apps/web/src/lib/timeline-tree.test.ts`（按真实迭代和推断迭代分组，`ramosAbertosPorPadrao` 的活动/新近度/不截断）、`apps/web/src/components/AgentTimelineTree.test.tsx`（默认展开、新内容计数出现/消失、里程碑展开显示参数/结果/迭代）
- **来源：** 用户请求——缺口经调查 FASE 14b 现有组件确认；没有 ADR，与铃铛相同的“未查看”语义，只是新的粒度

---

## 会话

### RN-119 — 会话的活动智能体是拥有最近一次 `agent.activated` 的那个——永远不是固定链 {#rn-119}

`SessionPage` 从**同一个**智能体决定两件事：输入框的消息发给谁，以及顶栏从哪个智能体解析所显示的模型（完整级联 会话→智能体→领域→项目→工作区，与 `RunLlmTurnUseCase` 实际运行该轮时使用的相同）。在这条规则之前，这两个问题有**不同**的答案：路由使用固定的优先链（architect > po > creative，基于历史上的**存在**——“已经激活过一次”，它永远不会“关闭”），而显示的模型甚至不知道谁是活动的——模型绑定路由根本收不到智能体，总是回退到 Criativo 智能体的固定后备（`herdarModeloDeStart`），即使在 handoff 给 PO、Arquiteto 或 Dev Lead 之后也是如此。

唯一的定义：活动智能体是在聊天流程的对话型智能体（Criativo、PO、Arquiteto、Dev Lead）中，拥有**最近**一次 `agent.activated`（按 `seq`）的那个。**Infra Lead 被排除在外**：`agent_command_controller.ex`（engine）只为 po/dev-lead/arquiteto（加上 Criativo，作为最后一个子句的隐式后备）提供 `message` 路由——Infra 从未接通 `message`，只有 `start`。今天向“infra”发送消息会静默落到 Criativo 智能体；把它当作输入框的活动智能体，会重新打开那个陷阱而不是关闭一个。

> **部分被 [RN-631](#rn-631)（AT-251）取代：**“最近的
> `agent.activated` 胜出”本身就是一个隐式的默认接收者，而且是不可见的。输入框的接收者现在由人**选择**（一个列出会话中已有智能体的“收件人”选择器），顶栏的模型跟随该接收者。这条规则留存下来的是关于模型的那一半：绑定路由接收智能体，永不静默回退。

- **位置：** `apps/web/src/lib/session-destinatario.ts:272`
  （`useDestinatarioDoChat`，自 RN-631 起）、
  `apps/web/src/lib/api-client.ts:1124`（`getSessionModelBinding`，即
  `agentId`）、`apps/api/src/interfaces/http/llm/model-bindings.controller.ts:166`
  （`getSessionBinding`，`@Query('agentId')`）
- **测试：** `apps/web/src/routes/SessionPage.destinatario-do-chat.test.tsx`
  （原 `SessionPage.agente-mais-recente.test.tsx`）、
  `apps/web/src/routes/SessionPage.modelo-do-agente-ativo.test.tsx`、
  `apps/api/test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`
- **边界情况：** Infra Lead 既不参与输入框路由，也不参与“活动智能体”的定义——它是主动型的（第 4 阶段），不是通过输入框对话的。

### RN-120 — 进行中的轮次期间，会话的事件轮询暂停 {#rn-120}

`useSessionEvents` 每隔几秒获取事件，却**完全不知道**有轮次正在进行。如果轮询落在轮次**期间**（很常见——轮次通常比间隔更长），它会带回已持久化的
`chat.message`/`agent.response`，而这些会与屏幕上仍然存在的乐观/流式状态**并排**渲染：同一条消息出现两次。

修复只在 `streaming` 为 `true` 时暂停**定时器**（`refetchInterval`）——查询保持 `enabled`，因此在轮次结束时已经触发的显式失效（`finalizarTurnoDoAgente`）会在正确的时机继续获取新数据。`pausarPoll` 是**可选**参数，默认 `false`：该 hook 的其他消费者（Overview、Code、Provisioning、AdoptionPlan）没有进行中的对话轮次，保持原样。

- **位置：** `apps/web/src/lib/hooks.ts:221`（`useSessionEvents`）、
  `apps/web/src/routes/SessionPage.tsx:277`（`eventsQuery`）
- **测试：** `apps/web/src/lib/hooks.pausar-poll.test.tsx`
- **边界情况：** 暂停定时器不等于禁用查询——显式失效继续工作，而修复依赖它来确保永不丢失数据。

## 项目面板

### RN-121 — Dev agent 和 QA 是“执行者”：有自己的标签页，不在“智能体团队”中 {#rn-121}

概览中的“智能体团队”网格和“团队时间线”把 Criativo/PO/Arquiteto/Infra 与 dev-`<módulo>` 和 QA（lead +
`qa-automacao`/`qa-performance-seguranca`）混在一起——七八个智能体在同一个网格里，不区分谁**创造/决定**、谁**实现/验证**。**执行者**标签页把后两者隔离出来，使用与概览**相同**的渲染（`AgentCard`、领域网格——提取到 `AgentTeamGrid.tsx`——以及
`AgentTimelineTree`），从不重新发明卡片。

**分离规则只有一个函数**，`isExecutorGroup`/
`isExecutorAgentId`（`lib/agent-status.ts`）：`dev-lead`/`dev-<qualquer
módulo>` 和整个 `qa` 领域（lead + 子专业）是执行者；其余不是。**两个**屏幕用这个函数筛选**同一个** `groupRosterByArea`——概览用 `!isExecutorGroup`，执行者用
`isExecutorGroup`——所以一个智能体不可能出现在两边，也不可能两边都消失：它总是恰好在一边。

**树不会重复**：每个标签页在传给
`AgentTimelineTree` 之前先筛选**事件**（按 `actor.id` 是否属于执行者集合），所以 dev agent 的分支只出现在执行者中，绝不同时出现在概览中。活动列（`ActivityFeed`，RN-099/100）**没有**被筛选——它回答的是整个会话中“发生了什么”，包括 dev/QA，而组件自身的按智能体筛选已经列出了每个发言者；只有“谁在做什么”的网格和树换了位置。

- **位置：** `apps/web/src/lib/agent-status.ts`（`isExecutorGroup`、
  `isExecutorAgentId`、`autonomyActionTypeFor`——从
  `ProjectOverviewTab.tsx` 移来）、`apps/web/src/components/AgentTeamGrid.tsx`
  （从已有的网格中提取）、`apps/web/src/routes/
  ProjectExecutorsTab.tsx`、`apps/web/src/routes/ProjectOverviewTab.tsx`、
  `apps/web/src/routes/project-tabs.ts`（`key: 'executores'`、`ordem: 12`
  ——紧跟概览之后，在 Criativo/聊天/Code 之前）
- **测试：** `apps/web/src/lib/agent-status.test.ts`（`isExecutorAgentId`/
  `isExecutorGroup`——dev-`<módulo>`、`dev-lead`、整个 `qa` 领域是执行者；criativo/po/arquiteto/infra/secops 不是）；
  `apps/web/src/routes/ProjectExecutorsTab.test.tsx`（只显示 dev/QA，两者都没有时的空状态，标题计数）；
  `apps/web/src/routes/ProjectOverviewTab.test.tsx`（dev-backend/QA 从网格消失，团队其余部分保留）；`apps/web/src/routes/
  project-tabs.test.tsx`（新标签页进入注册表的通用扫描——标签栏、面板、深链接、唯一顺序）
- **边界情况：** SecOps **不是**执行者——它通过带来 QA 的**同一个**
  `pr.gate_changed` 进入名册（第 4a 阶段，`rosterFactsFromEvents`），但留在概览中。`dev-lead` 出于完整性在执行者列表中（RN-087 把它描述为对话型），尽管如今没有任何路径在会话名册中实例化它（Dev Lead →
  `dev-<módulo>` 的委派仍在范围之外，ADR 0053 第 5 项）。
- **来源：** 用户请求——为 dev agent 和 QA 设立自己的“执行者”，脱离概览的混合网格。

---

## 会话

### RN-123 — 没有活动 Criativo 智能体的创作型会话：第一条消息同时也激活它 {#rn-123}

在尚无 `agent.activated` 的 `kind: 'criativa'` 会话（[RN-097](api.md#rn-097)）中，通过输入框发送第一条消息会先激活 Criativo 智能体（等待激活完成），然后才通过真实路径（`sendAgentMessage`——历史、系统提示词、`emit_artifact` 工具）把该消息交给它。在这条规则之前，没有点击“开始构思”就输入的人会落入一个没有历史、没有业务规则的通用 SSE 聊天：那**不是**真正的 Criativo 智能体，对话也没有在领域中记录任何东西。

“开始构思”的点击仍然存在（[RN-104](#rn-104)）——当人更喜欢显式手势时，它仍然是触发激活的东西，并且在两条路径中的任何一条上，owner 的密钥（[RN-058](api.md#rn-058)）都是从它开始被花费的。改变的是，**第一条消息**现在也算作该手势：没有人应该在和屏幕已经邀请他交谈的对象说话之前还需要单独点一下。

- **位置：** `apps/web/src/routes/SessionPage.tsx:678`（`handleSend`）
- **测试：** `apps/web/src/routes/SessionPage.ideacao-automatica.test.tsx`
- **边界情况：** `consultiva` 会话没有 Criativo 智能体——规则不适用，通用 SSE 路径对它仍然是正确的。

## 项目面板

### RN-124 — PO 在线程中叙述创建的史诗/用户故事，并直接链接到 Backlog {#rn-124}

`backlog.epic_created`/`backlog.story_created`——PO 早已在事件日志中记录（`CreateEpicUseCase`/`CreateStoryUseCase`）——在会话时间线中没有任何处理：创建用户故事在线程中**不留任何**痕迹，只在 Backlog 标签页中，给那些已经知道去那里看的人。两种类型在时间线中获得条目，使用与智能体其他消息**相同**的视觉主体（`.message`/`.bubble`）——标签本身没有新类，只有链接。

链接（“在 Backlog 中查看”）复用该标签页的通用深链接（`?tab=backlog`，与仪表盘卡片上“设置预算”CTA 相同的机制）——它不尝试在标签页中高亮刚创建的用户故事，那超出范围。

- **位置：** `apps/web/src/routes/SessionPage.tsx`（`timeline`——
  `backlog.epic_created`/`backlog.story_created` 块）
- **测试：** `apps/web/src/routes/SessionPage.handoff-inline-e-links.test.tsx`
  （`item 2`）
- **经真实运行验证：** 插入到真实会话事件日志中的史诗和用户故事显示为“Épico criado”/“História criada”并带标题，链接确实导航到 `?tab=backlog`。
- **来源：** 用户请求——PO 链接到创建的用户故事，直达 Backlog。

### RN-125 — handoff 的接受在线程中**内联**进行，给 Dev Lead 的 CTA 指向执行者 {#rn-125}

时间线中已有的分隔线“X 把接力棒交给了 Y”（`handoff.offered`）在代表**当前**待处理提议时（与 `offeredHandoff` 早已为顶栏按钮解析的相同），变成一张带内嵌接受按钮的**可操作卡片**。顶栏的按钮**被移除**：接受就在线程内部、在交接发生的确切位置，保留两者会同时显示两个文本**完全相同**的按钮——与 `ApprovalCard` 通过从不在线程外重复操作而避免的问题相同（RN-096）。

**哪个事件变成卡片是按配对决定的，而不是按 id。** `handoff.offered` 的 payload 只携带 `toAgent`；`fromAgent` 是事件的 `actor`（RN-054 已经用这种读取来生成分隔线的文本）。事件中没有 handoff 的 id，“这是当前提议”的判断方式是找到与 `offeredHandoff` 具有**相同** `fromAgent`/`toAgent` 配对的**最近**（`seq` 最大）的 `handoff.offered`——这可以防止重新打开一个已被同一配对的更早提议解决（接受、拒绝或被新提议取代）的接受邀请。

**给 Dev Lead 的卡片获得第二个链接**，“在执行者中跟进执行”，指向已存在的标签页（RN-121）——这是**执行**的开始，接受的人需要知道之后去哪里看。其他提议（PO、Arquiteto……）没有这个链接：它们的会话本身仍然是跟进的地方，没有“别处可看”。

- **位置：** `apps/web/src/routes/SessionPage.tsx`（`timeline`——
  `handoff.offered` 块、`offeredHandoffEventSeq`；`isActive` 被提到
  `useMemo` 之前）、`apps/web/src/routes/SessionPage.module.css`（`.handoffCard`、
  `.timelineLink`）
- **测试：** `apps/web/src/routes/SessionPage.handoff-inline-e-links.test.tsx`
  （只有当前提议是可操作卡片，同一配对的旧提议保持静默，已接受的 handoff 不显示任何按钮，执行者链接只在
  `dev-lead` 上）；`apps/web/src/routes/SessionPage.pista-e-status.test.tsx`
  已针对内联按钮更新（不再在顶栏）
- **经真实运行验证：** 在一个隔离构建（独立的 Docker 栈、真实的项目/会话）上，在创作型会话中接受给 PO 的 handoff——点击从 api 返回后，卡片立即变成静默分隔线，事件日志前进；给 Dev Lead 的 CTA 确实导航到 `?tab=executores`。
- **来源：** 用户请求——handoff 的接受也在线程中内联，而不只在顶栏。

### RN-126 — 用户故事的晋升可在线程中**内联**决定，使用与 Backlog 标签页相同的机制 {#rn-126}

`backlog.story_promotion_proposed`（RN-048）获得与 RN-125 给 handoff 相同的处理：该事件在会话时间线中变成**可操作卡片**，“晋升”和“退回”按钮调用 `PromotionQueue`
（`ProjectBacklogTab.tsx`）已在使用的**相同**的 `promoteStories`/`returnStory`——没有新端点，没有第二个事实来源。决定仍在**一个**地方发生（后端），只是触发多了一条路径。

**通过后续事件解决，而不是另外推导的状态。** 一旦一个 seq **更大**的事件决定了**同一个**用户故事的去向——
`backlog.story_transitioned{storyId}`（已晋升，由
`PromoteStoriesUseCase` 经 `TransitionStoryUseCase` 发出）或
`backlog.story_promotion_returned{storyId}`（已退回）——卡片就会自行消失（变成没有按钮的静默分隔线）。没有这项检查，晋升或退回后同样的两个按钮会留在线程里，再次提供一个已经做出的决定。

`backlog.story_promotion_returned` 在线程中获得对称的叙述（包含原因），复用 `apps/web/src/lib/activity.ts` 过去只在侧边栏折叠日志中使用的同一句话。

- **位置：** `apps/web/src/routes/SessionPage.tsx`（`timeline`——
  `backlog.story_promotion_proposed`/`backlog.story_promotion_returned` 块、
  `handlePromoteStory`/`handleReturnStory`、复用
  `Modal`/`Textarea` 的原因弹窗）
- **测试：** `apps/web/src/routes/SessionPage.promocao-inline-e-volta.test.tsx`
  （带按钮的卡片，晋升以 payload 中的 `storyId` 调用 `promoteStories`，退回需要原因并调用 `returnStory`，被后续 `story_transitioned` 解决的用户故事变成静默分隔线，`story_promotion_returned`
  带原因叙述）
- **来源：** 用户请求——在线程中内联晋升用户故事，这是复用 RN-048 的廉价选项，而不是对用户故事的创建加 gate。

### RN-131 — 在会话线程中**现场**确认的三个竞争：邀请盖在历史之上、焦躁的指示器，以及卡在 `handleReadiness` 的轮次 {#rn-131}

三个缺陷是在 Chrome 中真实浏览 `SessionPage.tsx` 时发现的，而不是通过测试——三者都是伪装成产品决定的竞态条件或不完整的标准。

**1. `conversaComecou` 变成“存在**任何**事件”，而不是“存在
`chat.message`/`agent.response`”。** 先前的标准（发现 G）是为了不把 git 引导的卡片误认为对话而产生的，却有相反的效果：由 `git-bootstrap` 创建的会话（已批准的 commit/branch 操作，零条 `chat.message`）会把邀请盖在它们上面，而同样的事——严重得多地——发生在执行激活所使用的会话中，那里有几十个真实事件（`tool.call`、
`tool.result`、任务事件）却没有 `chat.message`/`agent.response`：邀请盖住了**整个**执行历史。新会话是唯一没有任何事件的——这才是正确的问题。

**2. `conviteVisivel` 等待 `useSessionEvents` 加载完成。** 在冷缓存下（页面重载），`session` 可能在 `events`
仍然是 `[]` 时到达——这是 `data?.items` 的默认值，在第一次获取完成之前与“真正空的会话”无法区分。没有
`!eventsQuery.isPending` 这个 gate，邀请会在有大量历史的会话上闪现。

**3. “思考中”指示器（带 3 个小点的气泡）只在 5 秒内没有任何文本到达后才开启。** 以前它在
`streaming`/`statusAgent` 变为真值的瞬间开启——在大多数不到一秒就响应的轮次中是视觉噪音。一个 `useEffect` 在轮次开始且尚无文本时设置一个
`setTimeout(…, 5000)`，并在第一个增量到达或轮次在期限前结束时（通过清理）解除它。真实文本（`streamingText`）仍然**立即**出现，从不等待定时器——只有空指示器变得有耐心了。

**4. `handleReadiness` 获得了 `handleSend` 早已拥有的同一张安全网。** `confirmReadiness` 和 `sendAgentMessage` 一样，是 engine 上的同步 `GenServer.call`（最长 120 秒）——而 Phoenix 频道在轮次结束时可能还没完成连接（ticket + join，RN-108），从而永远丢失
`agent.done` 的广播。`handleSend` 早已在同步调用返回后立即调用
`finalizarTurnoDoAgente()`，不管频道是否投递了该事件；`handleReadiness` 被遗漏在这一修正之外，没有它，智能体的气泡会一直空着卡住
（`streaming: true`，没有文本），直到页面重新加载。

- **位置：** `apps/web/src/routes/SessionPage.tsx`（`conversaComecou`、
  `conviteVisivel`、紧挨在 `agenteExibido` 下方的 `pensandoVisivel` 的 `useEffect`，以及 `handleReadiness` 的成功块）
- **测试：**
  `apps/web/src/routes/SessionPage.convite-so-em-sessao-vazia.test.tsx`
  （空会话显示邀请；带 git-bootstrap 事件或带几十个 `tool.call`/`tool.result` 的会话隐藏邀请；`eventsQuery.isPending`
  在第一次获取完成前压住邀请）、
  `apps/web/src/routes/SessionPage.pista-e-status.test.tsx`（发现 B——指示器在 5 秒前不出现，之后出现，在第一个增量时消失，轮次在期限前结束时从不出现），以及
  `apps/web/src/routes/SessionPage.readiness-turno-preso.test.tsx`
  （`confirmReadiness` 在没有 `onAgentDone` 的情况下返回时，以与 `SessionPage.turno-preso.test.tsx` 为
  `handleSend` 证明的相同方式协调状态）
- **来源：** 在 Chrome 中对产品的**现场**调查——三者都在修正前手动复现。

### RN-136 — 聊天中可操作的 handoff 卡片只考虑在此屏幕中**对话**的智能体 {#rn-136}

> **自 [ADR 0185](../adr/0185-estou-pronto-fecha-os-dois-gates.md)
> （[RN-658](api.md#rn-658)）起**，“我准备好了”所请求的 Criativo→PO handoff 在同一次调用中诞生并被接受，以点击者的名义——它的接受卡片只在这种接受不适用（早于该 ADR 的会话、不是来自点击的 brief）或失败时才出现。下面的筛选不变。

`OfferInfraHandoffUseCase` 向 Infra 提供 handoff，并在**同一次**确认中紧接着向 Dev Lead 提供（FASE 14d）——两次独立的调用，Infra 的在前。`handoffs`（`SessionPage.tsx` 从
`useHandoffs` 读取的）按 `createdAt` 升序排列
（`DrizzleHandoffRepository#findBySession`），而决定哪张卡片变为“可操作”的 `offeredHandoff` 过去用一个纯 `.find()` 解析——总是**最旧**的
`offered`。由于 Infra Lead 不是对话型的（不在 `AGENTES_DE_CHAT` 中，也从不由此屏幕接受），Dev Lead 的卡片只有在有人于此屏幕不显示的地方接受 Infra 的之后才会变为可操作——实际上永远不会：用户只看到“接受 Infra 的 handoff”，而给 Dev Lead 的邀请藏在它后面不可见。

筛选把 `offeredHandoff` 限制为指向 `AGENTES_DE_CHAT` 中智能体的 handoff。给 Infra 的 handoff 仍然在线程中被**叙述**——它的
`handoff.offered` 变成静默分隔线，就像任何不是“当前”的提议一样——只有带按钮的卡片开始忽略它：Infra 从来没有（也不需要有）在这里被接受的方式。

- **位置：** `apps/web/src/routes/SessionPage.tsx`（`offeredHandoff`）
- **测试：**
  `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`，
  describe "problema 1"——较旧的 Infra + 较新的 Dev Lead 解析为 Dev Lead 的卡片，永远不是 Infra 的；只有 Infra `offered` 时不显示任何卡片
- **来源：** 代码调查 + 在 Chrome 中的现场测试——FASE 14d 之后给 Dev Lead 的 handoff 从未变为可操作

### RN-137 — “激活执行”在 Dev Lead 卡片上有内联快捷方式，但不降低角色要求 {#rn-137}

给 Dev Lead 的 handoff 接受卡片在“在执行者中跟进执行”链接旁边获得了一个“激活执行”按钮——给已经知道自己要什么的人的快捷方式，无需经过对话。它调用概览使用的**同一个**
`activateExecution`，现在以 `sessionId`（打开的聊天会话）作为 `originSessionId`——没有这一点，带来 Dev Lead 的会话会永远保持 `active`，即使执行（在一个**单独**的会话中）已经通过这个快捷方式启动（[RN-135](api.md#rn-135)）。

**该路由仍然要求 `maintainer`**——**有意地**不与同一卡片上接受 handoff 就已足够的 `developer` 对齐。激活的人成为执行会话的 `session.createdBy`，而正是这个角色被
`ProposeActionUseCase` 解析（`ResolveEffectiveRoleUseCase.forProject`）为此后 dev agent 提出的每个 `git_commit`/`git_push`/`pr_open` 的**有效**角色——这与本已为概览按钮的
`maintainer` 辩护的理由相同
（`ExecutionController#activate`）。在这里降低要求会悄悄地反转这种解析：每当点击者是
`developer` 时，执行打开的每个 PR 都会从 `auto_approve` 变为 `require_approval`，而没有人决定过这一点。不是 `maintainer` 的人会收到 api 的真实句子（"Papel insuficiente para esta ação"，经由
`mensagemDaApi`），而不是通用错误。

客户端没有 `module_map` gate：当这张卡片存在时，Arquiteto 已经定义了它——它是先于向 Dev Lead 提供 handoff 的制品——所以复制概览的 `disabled={!hasModuleMap}` 会白白锁住按钮。罕见情况（不一致的会话）落入处理 403/其他错误的同一个 catch。

- **位置：** `apps/web/src/routes/SessionPage.tsx`
  （`handleActivateExecution`）、`apps/web/src/lib/api-client.ts`
  （`activateExecution` 获得了 `originSessionId`）
- **测试：**
  `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`，
  describe "problema 2"——点击以
  `sessionId` 调用 `activateExecution`；403 显示 api 的真实句子；该按钮与接受 handoff 的按钮和执行者链接共存
- **来源：** 代码调查 + 在 Chrome 中的现场测试——快捷方式的请求，角色差异经确认并按决定保留（未通过自动对齐来修正）

### RN-138 — 智能体交出接力棒后，其消息折叠 {#rn-138}

聊天时间线过去总是全部展开，不按作者分组——在 Criativo、PO 和 Arquiteto 轮流发言的长会话中，已经退场者的历史与正在发言者争夺空间。时间线的每个条目都获得了一个 `agentId`（生成它的 `actor.id`，当它是智能体时——`agent.response`、`agent.error`、PO 创建的史诗/用户故事、审批卡片）；用户的条目和标记**转换**的条目（handoff、用户故事晋升）有意没有 `agentId`，因为它们本质上就是切分点。

同一 `agentId` 的**连续**序列在两个条件都成立时变成可折叠的标题（设计系统的 `Disclosure`，默认关闭——智能体名称 + 计数，一键重新打开）：

1. **智能体已经交出接力棒**——存在一个来自它（`fromAgent`）且
   `status: 'accepted'` 的 handoff（与事件日志的 `handoff.accepted` 记录的事实相同，无需通过事件连接重建）；以及
2. **它没有 `pending` 的操作**——检查是按 `actor.id` 针对会话**所有**的 `actions`，而不只是当前序列中的：一个未决的审批竞争不能在线程的**任何**位置藏在一次点击之后。

只有 1 个条目的序列从不折叠——用“某某 · 1 条消息”代替消息本身没有任何好处。任何没有 `agentId` 的条目，或来自不同智能体的条目，都会像换智能体一样打断当前序列——只对真正连续的内容分组。

- **位置：** `apps/web/src/routes/SessionPage.tsx`（`TimelineEntry.agentId`、
  `timelineAgrupada`）、`apps/web/src/routes/SessionPage.module.css`
  （`.agentGroup*`）
- **测试：**
  `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`，
  describe "problema 3"——已交出接力棒且没有待处理操作时折叠；没有已接受的 handoff 时不折叠；同一智能体有待处理操作时不折叠；中间夹着其他作者的消息会打断分组
- **来源：** 代码调查 + 在 Chrome 中的现场测试——折叠的请求，以 `AgentTimelineTree`/`timeline-tree.ts` 作为**形式**参考（按智能体分组、名称 + 计数、打开/关闭），适配聊天中交错的异构时间线

---

### RN-144 — Criativo 标签页不列出现行的执行会话 {#rn-144}

接收 `execution.activated` 和 dev agent 工具调用事件的会话必须以 `kind: 'criativa'` 诞生——这是结构性规则（RN-097，
`garantirQuePodeAtivarExecucao`），否则事件会被拒绝。由于 `ProjectSessionsTab`（Criativo 标签页，RN-104）列出会话时只按 `session.kind === 'criativa'` 过滤，执行会话会*混在*列表中，与真正的构思并列——在 `SessionPage.tsx` 中打开它会显示一整条 dev agent 工具调用的时间线，在用户看来就像"dev 在 Criativo 的聊天里写东西"。已实时确认：一个带有 35 个以上 dev agent 事件的真实会话正常出现在列表中，与真实的构思会话并列。

修正复用 [RN-139](api.md#rn-139) 已经暴露的信号——
`useActiveExecutionSession`/`GET /projects/:projectId/execution/session`——而不是让后端为每个会话计算一个新字段（`hasExecutionActivated` 或类似的）。Criativo 标签页获取现行会话，并将其从渲染的列表中排除：

- 获取只在 Criativo 标签页运行（在 `kind !==
  'criativa'` 时 `enabled` 关闭）——聊天标签页从未做过这个调用，现在也不做；
- 过滤按 `id` 进行，位于已有的按 `kind` 过滤之后——它不改变列表*是*什么，只改变它*排除*什么。

**刻意的范围决定：** 这只覆盖*现行*的执行，而不覆盖已经结束的*旧*执行（在今天处于 `closed` 的会话中写入的 `execution.activated`）。计算这一点需要后端为每个会话标注是否写入了该事件——仓储和列表端点的变更，针对一个残余情形：*旧*执行会话带着 `closed` 徽章出现，这已经以比现行会话（原来显示为 `active`，与进行中的构思无法区分）少得多的歧义表明"这不是活跃的构思"。如果这在实践中再次造成困惑，出路是列表端点为每个会话返回该信号——而不是在前端为旧会话再加一个 `filter`。

- **位置：** `apps/web/src/routes/ProjectSessionsTab.tsx`
  （`ProjectSessionsTab`）
- **测试：** `apps/web/src/routes/ProjectSessionsTab.test.tsx`——现行会话从 Criativo 列表中消失而正常会话仍在旁边，聊天标签页不调用现行执行的获取，没有现行执行（`null`）时列表完整显示
- **来源：** 代码调查中的发现 + 实时测试——带有活跃执行的真实会话混在 Criativo 标签页中

### RN-147 — 折叠分组的头部显示 agent 的图标，而不只是名称 {#rn-147}

`timelineAgrupada`（[RN-138](#rn-138)）的 `Disclosure` 在 `titulo` 中只接收名称*字符串*——每条展开的消息都已经有头像（`.avatar` + 图标），而折叠的头部恰恰在最有助于扫视消息流的地方丢失了这个视觉线索。

`AvatarDoAgente` 复用与展开消息*相同*的 `.avatar` 框，但选择的图标是*名册*中的（`AGENTS[id].icon`）——与已经在流式指示器中识别"谁在说话"的同一来源（`agenteExibido.icon`，
[RN-131](#rn-131)）——而不是每个展开条目使用的按事件*类型*的图标（`agent.response` 中的 `ModelIcon`、`backlog.*_created` 中的 `StackIcon`、`agent.error` 中的 `AlertCircleIcon`）。一个折叠分组可能混合同一 agent 的这些类型的条目；头部代表的是 *AGENT*，而不是它的最后一个条目，只有名册图标对此是稳定的。没有 `id`，或者 agent 不在名册中时，降级为 `ModelIcon`——绝不是空框。

- **位置：** `apps/web/src/routes/SessionPage.tsx`（`AvatarDoAgente`、
  `timelineAgrupada`），`apps/web/src/routes/SessionPage.module.css`
  （`.agentGroupTitulo`）
- **测试：** `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`，
  describe "problema 3"——折叠的头部带有 PO 图标（`UserIcon`）的 PATH，而不只是一个通用的装饰性 SVG
- **来源：** 代码调查——`Disclosure` 本来就在 `titulo` 中接受 `ReactNode`；缺的是把头像与名称一起传入

### RN-148 — 同时待晋升的故事变成轮播，而不是 N 张卡片 {#rn-148}

PO 一个接一个地创建故事，每个 `backlog.story_promotion_proposed`
（[RN-126](#rn-126)）都会在时间线上变成一张单独的卡片——在一批多个故事中，这会堆叠 N 张相同的卡片争夺同一空间，与其余叙述混在一起。

一**批**是会话中*仍然待定*的晋升提议的集合，在每次渲染时评估——而不是"连续不间断地创建的"。标准与每张单独卡片本来就独自用来决定自己是变成可操作卡片还是分隔线的*相同*（之后没有相同 `storyId` 的 `backlog.story_transitioned`/`backlog.story_promotion_returned`），只是对整个会话一次性地查看：

- **0 或 1 个待定：** 什么都不变——一如既往的单独卡片（降级是刻意的：只有一张幻灯片的轮播变成轮播毫无收益）。
- **同时 2 个以上待定：** 变成*一个* `Carousel`（设计系统中的新组件，`apps/web/src/components/ui/Carousel.tsx`），插在*第一个*仍待定提议的位置；其余的作为单独卡片消失——每一个都成为它的一张*幻灯片*。每张幻灯片显示与单独卡片相同的句子（"故事……已就绪，等待你的晋升"），payload 带有时显示摘要/RF（目前没有——见下文），以及该特定故事的晋升/退回按钮，调用一如既往的*同一个*
  `promoteStories`/`returnStory`。
- 轮播头部的**"全部批准"**在一次调用中用*所有*待定项的 id 调用 `promoteStories`——端点本来就是批量的
  （`promoteStories(projectId, storyIds[])`，RN-048），因此契约没有任何变化，只是改变了由谁组装列表。
- 在轮播打开时被解决（晋升或退回）的故事会在下一次渲染时离开这一批（两个动作都会使事件查询失效）——如果只剩 1 个待定，轮播会自行解散，卡片恢复为单独卡片。

幻灯片中的 `resumo`/RF 是*已就绪*但未被使用的字段：`CreateStoryUseCase` 目前只在 `backlog.story_promotion_proposed` 的 payload 中写入 `storyId`/`epicId`/`title`——没有描述，也没有功能需求。幻灯片已经知道在 payload 有一天携带 `description`/`rf` 时显示它们（在那之前降级为只显示标题）；扩展 payload 不在本次交付之内，因为没有人要求。

- **位置：** `apps/web/src/components/ui/Carousel.tsx`（新组件，通用导航），`apps/web/src/routes/SessionPage.tsx`
  （`promocoesPendentes`、`ehLevaDeHistorias`、`StorySlide`、
  `handlePromoteAll`），`apps/web/src/routes/SessionPage.module.css`
  （`.storySlide`）
- **测试：** `apps/web/src/components/ui/Carousel.test.tsx`（导航、ARIA、只挂载当前幻灯片、列表缩短时索引被钳制），
  `apps/web/src/routes/SessionPage.carrossel-historias.test.tsx`（3 个以上待定变成轮播；"全部批准"发送整批；从导航到的幻灯片进行单个晋升和退回仍然有效；1 个待定降级为简单卡片；被解决的故事离开这一批，轮播重新计算数量）
- **来源：** 用户的请求——PO 批量产出的故事在消息流中很难一个一个地决定

### RN-152 — 任务的分支在代码标签页的下拉菜单中说明它属于哪个 dev agent 和模块 {#rn-152}

`CodeBranchPicker` 本来就列出仓库的每个分支，包括 dev agent 的分支（`feature/task-XXXXXXXX`，`Engine.Dev.AgentIo`），但没有任何关于谁创建了它的线索——只有原始名称。`ReadProjectCodeUseCase.branches` 无需对 git 提供方多做调用就解决了这个问题：`feature/task-` 之后的 8 个字符正好是任务 uuid 的第一个连字符分组（`"feature/task-" <> String.slice(to_string(row.task_id), 0, 8)`，而不是任意的子串），因此可以与 `TaskRepository
.findByProjectAndIdPrefix` 匹配（按*项目*连接，使 8 字符前缀永远不会泄漏另一个项目的任务）。任务的 `assignedTo` 是 agent_id（`dev-<modulo>`/`dev-<modulo>-2`，RN-087）；模块通过与项目*现行* `module_map` 比较来解析，使用生成它的*同一*函数（`activate-execution.use-case.ts` 中的 `devAgentId`/`extraDevAgentId`）——绝不用反向正则，那会对带特殊字符的模块名退化为歧义。

`producedBy: { agentId, moduleId } | null` 是诚实的降级，与 `ahead`/`behind` 本来的方式相同：对不符合模式的分支（用户手动创建的，或 `main`/`dev`/`qa`）为 `null`，当模式匹配但任务/模块不再可解析（任务已删除、模块从现行映射中移除）时也是如此——绝不是编造的值。在下拉菜单中，每个由 dev 产生的分支获得该 agent 的图标和颜色（`AGENTS`/`agents.ts`，RN-087），复用 `apps/web/src/lib/agent-status.ts` 已经为实时名册使用的*同一*降级：在 `AGENTS` 中没有固定键的模块继承 `dev-backend` 的图标/颜色。

- **位置：** `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  （`branches`/`producedBy`/`moduloDoAgente`），
  `apps/api/src/application/ports/backlog-repository.port.ts`
  （`TaskRepository.findByProjectAndIdPrefix`），
  `apps/api/src/infrastructure/persistence/drizzle/backlog.repository.ts`,
  `apps/api/src/interfaces/http/git/dto/code.response.dto.ts`
  （`CodeBranchProducedByResponseDto`），`apps/web/src/lib/api-types.ts`
  （`CodeBranchProducedBy`），`apps/web/src/routes/code/CodeBranchPicker.tsx`
  （`IconeDoAgenteProdutor`/`defDoAgenteProdutor`）
- **测试：**
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  （describe "producedBy da branch de task"——带模块和带额外 agent `-2` 的已解析任务；不符合模式的分支即使有可匹配前缀的任务也绝不获得 `producedBy`；项目中没有任务的前缀、从现行映射中移除的模块以及还没有所有者的任务都降级为 `null`），
  `apps/web/src/routes/code/CodeBranchPicker.test.tsx`（任务分支显示所属 dev agent 的标记；不符合模式的分支没有任何标记）
- **来源：** 用户的请求——在 FASE 26b 的丰富下拉菜单中没有关于谁创建了分支的视觉线索

### RN-156 — 5s 等待指示器使用固定文本，不插入 agent 名称 {#rn-156}

5s 无响应后出现的指示器（`pensandoVisivel`）显示固定句子"Reunindo informações..."，不插入 agent 的名称——取代了之前的文本"{Agente} está escrevendo…"。真实文本流一开始，agent 的名称就在头部可见；在等待指示器中重复它对阅读没有帮助。

- **位置：** `apps/web/src/routes/SessionPage.tsx`
- **测试：** `apps/web/src/routes/SessionPage.pista-e-status.test.tsx`,
  `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
- **来源：** PR #286 的发现——之前的文本点名的是一个已经在头部可见的 agent

### RN-157 — PO 创建史诗/故事成为紧凑提示，而不是完整气泡 {#rn-157}

`backlog.epic_created`/`backlog.story_created` 事件不再渲染为完整的消息气泡（`.message`/`.bubble`，32px 头像——与真正的 agent 回复相同的视觉分量），而是使用 `.handoffDivider`/`.handoffPill` 已经用于交接棒的相同紧凑提示格式：带水平细线和紧凑药丸的居中行，保留"在 Backlog 中查看"链接。`agentId` 在 `TimelineEntry` 中继续填充——与 handoff 分隔线不同，这不标志 agent 之间的过渡，而是 PO 在自己回合内的一个动作，仍然适用按 agent 的折叠（[RN-138](#rn-138)）。

- **位置：** `apps/web/src/routes/SessionPage.tsx`
- **测试：** `apps/web/src/routes/SessionPage.handoff-inline-e-links.test.tsx`,
  `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
- **来源：** PR #286 的发现——对于 PO 的一个元数据动作，完整气泡的视觉分量与真正的 agent 回复相同

### RN-158 — 聊天中带高亮的轻量 Markdown {#rn-158}

会话消息流中的 `agent.response` 渲染 Markdown 的一个子集（粗体 `**texto**`、斜体 `*texto*`/`_texto_`、行内代码
`` `texto` ``、标题 `#`/`##`/`###`、列表 `-`/`1.`、链接
`[texto](url)` 以及代码围栏 ```` ```linguagem ````），通过基于正则的自有解析器（`apps/web/src/lib/markdown.ts`），没有新依赖。`chat.message`（用户输入的文本）保持原样——Markdown 只应用于 agent/LLM 的*输出*，绝不应用于人的输入。

安全：解析器从不产生 HTML——它返回一棵数据树，由 `MarkdownMessage.tsx` 直接转换为 React 元素（绝不用 `dangerouslySetInnerHTML`）。只有当 URL 的协议为 `http`、`https` 或相对路径（`/...`、`#...`）时，链接才变成可点击的 `<a href>`；任何其他协议（`javascript:`、`data:` 等）降级为链接文本，绝不是可执行的 `href`。

围栏中的代码获得按 token 的高亮，复用
`apps/web/src/routes/code/highlight.ts` 中的 `highlightLine`/`highlightFile`——与已经为代码标签页着色的同一函数。`sh`/`bash` 获得了自己的 shell 关键字词汇（之前只映射了行注释 `#`，并落入 JS 的回退）。围栏
```` ```sh ````/```` ```bash ```` 获得终端的视觉风格（每个命令行的 `$` 提示符），与 `ApprovalCard` 已经用于 `terminal` 动作的 `$ comando` 一致。

- **位置：** `apps/web/src/lib/markdown.ts`,
  `apps/web/src/components/ui/MarkdownMessage.tsx`,
  `apps/web/src/routes/code/highlight.ts`
- **测试：** `apps/web/src/lib/markdown.test.ts`,
  `apps/web/src/components/ui/MarkdownMessage.test.tsx`,
  `apps/web/src/routes/code/highlight.test.ts`,
  `apps/web/src/routes/SessionPage.markdown-resposta.test.tsx`
- **来源：** PR #288——带列表、代码和链接的 agent 回复以原始文本到达消息流，没有任何结构

### RN-159 — 生成的工件按 agent 分组 {#rn-159}

会话的"生成的工件"面板（`SessionPage.tsx` 中的 `ContextAside`）列出 dev 的 PR（`pr_open`）、Arquiteto 的 ADR PR（`open_adr_pr`）以及 PO 创建的史诗/故事（`backlog.epic_created`/`backlog.story_created`），按 `agentId`——生成每个工件的人——分组，使用与 [RN-138](#rn-138) 相同的可折叠 `Disclosure` 模式（agent 名称 + 数量，可展开为每个工件的标题）。

每个工件都导航到它所在的地方：PR（dev 或 ADR）打开真实 URL（`executionResult.pullRequestUrl`，与 `ProjectOverviewTab.tsx` 已经为 ADR PR 读取的字段相同）；史诗/故事导航到 `/projects/:projectId?tab=backlog`（与主消息流中 PO 的紧凑提示已经使用的 `Link` 模式相同，[RN-124](#rn-124)/
[RN-157](#rn-157)）。还没有 `pullRequestUrl` 的 PR（执行待定）出现在面板中，但不成为可点击的链接。

出于记录在代码注释中（`SessionPage.tsx` 中的 `ContextAside`）的决定而不在范围内的：module_map/C4——它们是项目的*现行*状态（一个当前版本，每次生成时被覆盖），而不是像 PR/史诗/故事那样按*会话*标注日期的工件；概览标签页（`ProjectOverviewTab.tsx`）如今已经是它们的位置，没有自己的锚点——处理这一点不在本次交付范围之内。

- **位置：** `apps/web/src/routes/SessionPage.tsx`（`ContextAside`）
- **测试：** `apps/web/src/routes/SessionPage.artefatos-gerados.test.tsx`
- **来源：** PR #288——面板不区分谁生成了每个工件，也不覆盖 ADR PR 和史诗/故事，只覆盖 dev 的 PR

### RN-160 — "确认架构就绪"要求至少 1 个已晋升的故事 {#rn-160}

"确认架构就绪"按钮（Arquiteto→Dev Lead 的 handoff，通过 `confirmArchitectureReadiness`）在项目 backlog 中存在至少 1 个状态不是 `draft` 的故事之前一直处于 `disabled`——也就是说，已经通过 `PromoteStoriesUseCase`/`TransitionStoryUseCase` 晋升（[RN-048](api.md#rn-048)），只捕获了业务规则是不够的。`in_progress`/`done` 也算，因为只有经过 `ready` 才能到达那里。来源与 Backlog 标签页已经使用的*相同*（`useBacklog`，`ProjectBacklogTab.tsx`，相同的 queryKey `['backlog', projectId]`）——没有新的往返。在没有已晋升故事期间，按钮在 `title` 中显示解释原因的提示。

- **位置：** `apps/web/src/routes/SessionPage.tsx`（`hasPromotedStory`，按钮的渲染）
- **测试：** `apps/web/src/routes/SessionPage.readiness-arquitetura-exige-historia.test.tsx`
- **来源：** 用户的请求——Arquiteto→Dev Lead 的 handoff 按钮没有任何闸门

这只在*客户端*生效：直接的 HTTP 调用会忽略这条规则。由
[RN-404](api.md#rn-404)（ADR 0094）关闭，它在后端重新校验。

### RN-161 — 当有效角色已经授权时，接受给 Dev Lead 的 handoff 会串联执行的激活 {#rn-161}

> **由 [RN-677](api.md#rn-677) 修订（ADR 0194，所有者在 10月1日的决定）：** 接受给 Dev Lead 的 handoff 不再串联执行的激活，对*所有*角色都是如此——接受只是让它来*规划*，激活的是对其计划（`propose_execution_plan`）的*批准*。下面的文本描述的是当时的合并方式。

当 `toAgent === 'dev-lead'` *且*接受者的*有效*角色——从与已经授权"自动模式"（[RN-153](api.md#rn-153)）以及审批/设置界面的同一个 `useCurrentWorkspaceWithRole()` 读取——是 `owner` 或 `maintainer` 时，`handleAcceptHandoff`（`SessionPage.tsx`）会自动串联 `activateExecution`。对于 `developer`（或尚未解析的角色），现有流程保持不变：接受不激活任何东西，"激活执行"仍作为第二个按钮。检查只在客户端——
`POST .../execution/activate` 在后端仍要求 `maintainer`
（[RN-137](#rn-137)）；合并只是为本来就拥有两个角色的人省去一次多余的点击。复用"激活执行"按钮已经调用的*同一个* `handleActivateExecution`，它处理自己的错误（toast +
`mensagemDaApi`）且从不重新抛出——避免一个迟来的激活错误被报告为"无法接受 handoff"。

- **位置：** `apps/web/src/routes/SessionPage.tsx`
  （`podeFundirHandoffComExecucao`、`handleAcceptHandoff`）
- **测试：** `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`，
  describe "problema 4"
- **架构决策：** [ADR 0069](../adr/0069-fusao-condicional-do-handoff-com-a-ativacao-de-execucao.md)
- **来源：** 用户的请求（已批准的设计）

### RN-172 — handoff 和审批是回合的*结果* {#rn-172}

在会话的消息流中，**提供的 handoff** 和**审批卡片**出现在它们诞生的那个回合的最后一句话*之后*——绝不在中间。

这**不修正排序**：RN-155 完整有效，时间线仍按事件日志的 `seq` 排序。日志记录的是事实：`po_server.ex`（`run_turn/2`）在*同一*次迭代中发出回合的 `agent.response`，*然后*是 `offer_handoff` 的 `tool.call`（写入 `handoff.offered`），*然后*才递归到收尾的 `agent.response`。handoff 的 `seq` 诚实地小于最后一句话的 `seq`。对于 `proposed_action.created` 也一样，它诞生于回合中间，而 agent 还有话要说。在对话中间显示"交出了接力棒"或"批准这个"，是对正确数据的错误解读——因此这条规则属于*呈现*，在一次单独且显式的处理（`afundarDesfechos`）中应用，在按 `seq` 的 `sort` 之后，而不是藏在一个有三项的比较器中。

不同的回合**永远不会混合**。一个结果向下沉到它正下方那一段的末尾，并停在第一个不满足以下三个条件中任何一个的条目处：

1. **同一回合**——回合是条目之前最后一个*开启*的 `seq`，而开启是执行者为 `user` 的事件（`chat.message`、`agent.activated`、故事的晋升/退回）。这保护了两个回合之间的边界没有任何*可见*条目的情形：`agent.activated` 开启回合，却不会成为消息流中的一项。
2. **同一作者**——在*执行*会话中，多个 agent 在用户一句话都不说的情况下写入，它们都在同一个回合中；一个 agent 的结果不能越过另一个 agent 的话。
3. **不是结果**——两个连续的结果保持彼此之间的顺序（在同一次确认中，Infra 的 `handoff.offered` 在 Dev Lead 的之前）。

执行者 `system` *不*开启回合：它是消息流中间的基础设施噪音，而不是对话者的决定。

- **位置：** `apps/web/src/routes/SessionPage.tsx`
  （`aberturasDeTurno`、`turnoDoSeq`、`afundarDesfechos`，以及 `TimelineEntry` 的
  `autor`/`turno`/`desfecho` 字段）
- **测试：** `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
  （describe "RN-172 — turno e desfecho (unidade)" 和 "RN-172 — a sequência
  REAL do engine, renderizada"）
- **来源：** `exp001` 中的真实使用——"a passagem de bastão do PO para o
  arquiteto está aparecendo acima da última mensagem do PO" 和 "a mensagem de
  aprovação apareceu acima do chat do arquiteto até ele finalizar a resposta"

---

### RN-173 — 消息流跟随一切增长的内容，且只跟随已经在末尾的人 {#rn-173}

当内容增长时，聊天滚动到末尾——**而不只是在新事件到达时**。时间线的两个来源是*分开*的查询（`events` 和 `actions`），而高度在两者都不变的情况下仍会变化：打开/关闭一个 `Disclosure`（RN-138 的按 agent 折叠、审批卡片的"详情"）、Markdown 重排、图表在之后渲染。因此有两种机制：effect 的依赖覆盖 React 知道的（`events.length`、`actions.length`、`streamingText`），而对消息流*内容*的 `ResizeObserver` 覆盖只有布局才知道的。

防护**保持不变且是刻意的**：只有已经在距离末尾 120px 以内的人才会被滚动。向上翻阅历史的人不会被拖走——消息流跟随对话，而不劫持阅读。

在同一消息流中，审批卡片不再占满整列的 780px：它获得 560px 的上限并居中，与 `.handoffCard`/`.handoffDivider` 本来的样子一样。像气泡那样缩进 45px 是错误的——卡片不是任何人的话，而是向用户请求的决定。审批标签页的队列不变：在那里卡片*应该*填满网格的列。自 AT-322 起，卡片在所有界面上都是*同一个*，并填满容器——在消息流中施加上限和居中的是它的容器（`.acaoNoFio`），而不再是卡片的变体。

- **位置：** `apps/web/src/routes/SessionPage.tsx`（`acompanharOFim` 以及调用它的两个 effect）；`apps/web/src/components/ApprovalCard.module.css`
  （`.card`）和 `apps/web/src/routes/SessionPage.module.css`（`.acaoNoFio`）
- **测试：** `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
  （describe "RN-173 — o fio acompanha o que cresce"，包括用户向上滚动过的情形）
- **来源：** `exp001` 中的真实使用——"o scroll do chat deve ficar sempre no
  final seguindo o chat" 和 "aprovação mal diagramado deve ficar ao centro"

### RN-174 — 触发 agent 回合的动作会武装消息流的指示器 {#rn-174}

"agent 正在工作"的指示器（5s 之后的三个点，
[RN-131](#rn-131)/[RN-156](#rn-156)）只在 `streaming` 或 `statusAgent` 有效时出现，而它们原来在三个地方被打开：输入框（`handleSend`）、就绪确认以及 Phoenix 通道。**界面上每一个在 engine 中触发同步回合的动作也开始武装它。**

有两个，都不是输入框：

1. **回答结构化问题表单**——
   `AnswerStructuredQuestionUseCase` 复用 `SendAgentMessageUseCase`
   （[RN-162](engine.md#rn-162)），调用只在整个回合之后才返回。
2. **把故事退还给 PO**——`ReturnStoryUseCase` 调用 `reviseStory`，即 `po_server` 中的 `handle_call({:revise, …})`：HTTP 响应要等 PO 重写故事。

Phoenix 通道并不能填补这个空缺，正是这一点让修正成为必要而不是多余：当它还没完成连接（ticket + join，[RN-108](#rn-108)）时，"working" 的 `agent.status` 广播没有监听者而丢失——界面会在几十秒内完全沉默，这与"什么都不会发生"无法区分。

这一对是在 `await` **之前**调用 `iniciarTurnoDoAgente(agente)`（通道的 `agent.status` 可能先到达，没有固定 agent 的话指示器诞生时会不知道谁在说话），以及在 `finally` 中调用 `finalizarTurnoDoAgente()`——在*两条*路径上，因为一个让 `streaming` 保持打开的错误会把输入框卡到下一个回合。调用返回作为回合结束的信号，与通道的 `agent.done` 一样可靠，而 `finalizarTurnoDoAgente` 是幂等的。5s 的期限不变：快速响应的回合仍然不显示任何东西。

- **位置：** `apps/web/src/routes/SessionPage.tsx`（`iniciarTurnoDoAgente`、
  `handleReturnStory`、`StructuredQuestionCard`）
- **测试：** `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx`
  和 `apps/web/src/routes/SessionPage.promocao-inline-e-volta.test.tsx`
  （RN-174 的 describe，失败用例证明指示器不会卡住）
- **来源：** `exp001` 中的真实使用——"caso a web, api e engine demore mais de
  5s para ter uma resposta, a web deve apresentar uma animação no chat
  mostrando que o agente está pensando"

### RN-176 — 消息流中的 Markdown 表格变成真正的表格 {#rn-176}

聊天的轻量 Markdown（[RN-158](#rn-158)）开始识别 **GFM 表格**，并用设计系统的 `Table` 渲染它——与设置、花费和执行者中的同一个组件，而不是自己的 `<table>`："Brabo 如何绘制表格"只是一个决定。以前，Arquiteto 在回复中写的模块映射表格会作为带字面竖线的段落输出。

区分表格与带 `|` 的散文的是**分隔行**，它与 GFM 中一样是必需的：没有它，块仍然是段落，因此"escolha entre a | b | c"不会被误认为表格。表头决定列数——短行获得空单元格，长行丢弃多余部分——，转义的 `\|` 留在单元格内，对齐来自分隔行的冒号。零新依赖：解析器仍然是自有的、基于正则的，数据树仍然直接变成 React 元素（没有任何 `dangerouslySetInnerHTML`）。

**`artifact.module_map` 工件仍然*不*进入消息流**，这个选择是刻意的：它是项目的*现行*状态，而不是按会话标注日期的工件——与 [RN-159](#rn-159) 中已记录的决定相同——，它位于概览中。用户要求的是*消息中*的表格，被绘制出来的正是它；这一修正服务于*任何*写表格的 agent，而不只是模块映射。

在气泡中，表格**水平滚动**而不是挤压列：消息流约 700px，而一个 `module_map` 有 4 列。

- **位置：** `apps/web/src/lib/markdown.ts`（`table` 块、`celulasDaLinha`），
  `apps/web/src/components/ui/MarkdownMessage.tsx`（`TabelaMarkdown`），
  `apps/web/src/components/ui/MarkdownMessage.module.css`
- **测试：** `apps/web/src/lib/markdown.test.ts`（describe "tabela (RN-176)"），
  `apps/web/src/components/ui/MarkdownMessage.test.tsx`
- **来源：** `exp001` 中的真实使用——"a tabela dentro da mensagem do Mapa de
  Módulos do arquiteto tem que ficar bem estruturada em formato tabela,
  utilizar design system do próprio Brabo"

### RN-177 — 日志显示一切，历史按*来源*折叠 {#rn-177}

活动信息流隐藏了六种事件类型（`tool.call`、`tool.result`、
`agent.response`、`agent.delta`、`agent.status`、`context.compacted`），**却不提供任何替代方案**：想看 agent 与 harness 之间交换了什么的人，只能去打开数据库。过滤器仍然存在，并且仍然**默认关闭**——它的理由没有变（193 个真实事件中有 116 个是这些类型，见 `isMachineEvent`）——，但它变成了一个**选择**：在类型芯片的同一轨道上的"机器事件"按钮。

显示一切只解决了一半：一个长会话会变成没有人浏览的列表。因此**最近的 5 条保持展开**，其余的进入按**来源**的折叠——一种*新*的分类，并不取代 `ActivityKind`：`kind` 说明事件谈论的是什么*主题*（commit、PR、权限），决定图标和颜色；`origem` 说明它来自哪一*层*，正是它让历史以小把的方式变得可读。六种来源出自现有的数据——`actor.kind` 和 `type` 的前缀——，绝不出自假设：

| 来源 | 落入其中的东西 |
|---|---|
| `harness` | `tool.*`、`toolloop.*`、`agent.status`、`context.compacted` |
| `llm` | `agent.response`、`agent.delta`、`llm.*` |
| `usuario` | 任何 `actor.kind === 'user'` 的事件 |
| `sistema` | 任何 `actor.kind === 'system'` 的事件 |
| `agente` | 其余的 `agent.*`、`handoff.*`、`delegation.*`、agent 的 `chat.*` |
| `eventos` | 领域事件日志（backlog、git、PR、工件、bootstrap……） |

**优先级**让分类可预测，它体现在 `if` 的顺序中：机制（`harness`、`llm`）胜过执行者，因为无论执行者是谁，`tool.call` 都属于 harness；执行者胜过 agent 前缀，因为 `chat.message` 两侧都存在，区分它们的是说话的人。没有人预见到的类型落入 `eventos`——绝不会消失，也绝不会发明类别。

**同一规则也适用于会话的*消息流***，只是轴相反：消息流是升序的（最新的靠近输入框），因此最后 5 条在下方保持展开，折叠的历史位于*顶部*。截断作用于已经按 agent 分组的列表（[RN-138](#rn-138)）——计数的是用户看到的，一个十二条消息的折叠在界面上是*一个*条目。**在消息流中由 [RN-644](#rn-644) 修订：**在那里截断只计算*消息*，回溯到回合的开启处，历史是*一个*按时间顺序的块，而不是按来源的分组（那会把回答放在问题之上）。日志面板仍按此处描述。

- **位置：** `apps/web/src/lib/activity.ts:94`（`OrigemDeEvento`），`:125`
  （`origemDoEvento`），`:152`（`agruparPorOrigem`）；
  `apps/web/src/components/ActivityFeed.tsx:34`（5 条的截断），`:66`（开关）；`apps/web/src/routes/session-fio.tsx:119`（消息流的截断），`:291`
  （`dividirFio`）；`apps/web/src/routes/SessionPage.tsx:516`（`fio`）
  toggle); `apps/web/src/routes/session-fio.tsx:119` (o corte do fio), `:291`
  (`dividirFio`); `apps/web/src/routes/SessionPage.tsx:516` (`fio`)
- **测试：** `apps/web/src/lib/activity-origem.test.ts`,
  `apps/web/src/components/ActivityFeed.test.tsx`（describe "ordem,
  agrupamento e o toggle de máquina"），
  `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`（describe
  "RN-177"）
- **来源：** `exp001` 中的真实使用——"em log de eventos mostrar também log do
  sistema, concentrar a mensagem em grupo, ou seja mantém as últimas 5
  mensagens mas abaixo vira o grupo de log de eventos, sistema, llm, harness,
  agente, usuário"

### RN-178 — 会话面板从最后一条读到第一条，规则列表分页 {#rn-178}

上下文面板的四个部分（业务规则、生成的工件、触及的文件和事件日志）原来是**升序**的：从会话开始处打开。在一个有数千事件的会话中，这交付的是错误的界面——打开面板的人想要的是刚刚发生的东西。四个部分都改为**降序**，包括 backlog 树内部（[RN-179](#rn-179)）。

随之而来的一个后果：信息流的"加载更早的"按钮（[RN-099](#rn-099)）**换了边**。它原来位于列表*上方*，因为列表是升序的，过去在上面；顺序反转后，过去在末尾，位于顶部的按钮会要求朝它所加载内容的相反方向滚动——与之前同一论点，只是符号相反。

并且**超过 5 条规则时列表分页**，而不是无止境地增长：面板只有一列宽，一个构思会话轻易就超过二十条规则。当前页通过*钳制*（`min(pagina, total - 1)`）解析，而不是通过同步 effect：一条通过轮询到达的新规则会让列表变长，而 `useEffect` 会先以无效的页渲染一次再修正。5 条或更少时，分页器**不存在**——什么都不分页的控件是占据高度的噪音。

- **位置：** `apps/web/src/routes/ContextAside.tsx:109`（`REGRAS_POR_PAGINA`）以及同一文件中四个部分的排序；
  `apps/web/src/components/ActivityFeed.tsx:98`（降序的 `sort`）
- **测试：** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  （describe "RN-178"），`apps/web/src/components/ActivityFeed.test.tsx`
- **来源：** `exp001` 中的真实使用——"mostrar log de eventos, arquivos tocados
  e regras de negócio sempre em ordem do último para o primeiro de acordo com
  a data" 和 "caso as regras de negócio ficar acima de 5, deve-se paginar"

### RN-179 — PO 的工件是一棵*树*：史诗 → 故事 → 任务 {#rn-179}

"生成的工件"面板（[RN-159](#rn-159)）把史诗和故事并排平铺，并且**忽略了 `backlog.task_created`**——而那正是 dev agent 领取来工作的东西。三者组成了一棵树，子节点位于父节点的折叠之内，任务以*折叠*状态诞生：一个有三十个任务的史诗会在没有人要求的情况下占据整个面板。

亲属关系来自**事件已经携带的关联**——
`backlog.story_created` 写入 `epicId`，`backlog.task_created` 写入 `storyId`
——，绝不来自日志中的相邻关系。父节点不在已加载事件中的节点**上升到根部**，而不是挂到最近的史诗上：编造亲属关系比显示一个孤立的节点更糟，而一个其故事落在窗口之外的任务是正常情形，不是错误。

每一层仍然是通往 Backlog 的**链接**，子节点的折叠位于该行*下方*，而不是在头部内部——`Disclosure` 的头部是 `<button>`，而 `<button>` 内的 `<a>` 是无效的 HTML，点击目标也有歧义。部分头部的计数器计算*整*棵树，而不只是根：在里面有十八个任务时说"3"，就是 [RN-151](api.md#rn-151) 从侧边栏中去掉的那种与任何东西都对应不上的数字。

- **位置：** `apps/web/src/lib/session-backlog-tree.ts:68`
  （`montarArvoreDeBacklog`），`apps/web/src/routes/ContextAside.tsx:210`（根变成项），`:225`（树的计数）
- **测试：** `apps/web/src/routes/SessionPage.artefatos-gerados.test.tsx`
  （用例 "épico/história/tarefa do PO viram árvore" 和 "nó sem pai carregado
  aparece na raiz"）
- **来源：** `exp001` 中的真实使用——"mostrar também as tarefas criadas no
  artefato do PO, mas abaixo do épico e ter opção de colapsar"

### RN-180 — 面板说明它*没有*显示什么 {#rn-180}

`useSessionEvents` 获取 `{ limit: 200, latest: true }`，上下文面板通过 prop 读取这个切片。后果：在一个有数千事件的会话中，四个部分把尾部显示得**好像就是整个会话**——在构思开始时捕获的业务规则就这样不存在了，没有任何提示。

面板开始读取概览的活动标签页已经在使用的同一份分页历史（[RN-099](#rn-099)），尾部的 `queryKey` 与消息流共享——在轮询周期中**零额外请求**（[RN-090](api.md#rn-090)/[RN-091](api.md#rn-091)）。随之改变了两件事：

1. **信息流获得了组件一直都有的分页器。** `onLoadOlder`/`hasOlder`/`loadingOlder` 这些 prop 自 RN-099 起就是可选的，而这个调用点从未传入它们——这正是会话悄无声息地丢失开头的原因。
2. **一条说明会计算还缺多少事件。** 数字来自对 `seq`（无间隙且按会话）的*减法*：`已下载的最小 seq − 1`。绝不来自多一次请求——与铃铛的"+ N 条更早的"（[RN-100](api.md#rn-100)）相同的机制。到达会话开头时，说明**消失**，而不是断言一个零。

派生的部分读取 `baixados`（已经到来的一切），而不是 `events`（信息流 100 条的窗口）：它们不逐项分页，把它们截断在窗口上会让它们显示的比这次变更之前*更少*。为两者提供数据的是同一个按钮。

`pausarPoll` 经由 `useSessionEventHistory` 下传到 `useSessionEvents`，这不是细节：重新获取的间隔属于每个*观察者*，而不是查询。同一键的第二个观察者如果开着计时器，就会复活界面在回合期间暂停的轮询——随之而来的是流式气泡的视觉重复。

- **位置：** `apps/web/src/lib/hooks.ts:262`（历史的 `pausarPoll`），
  `:388`（`baixados`）；`apps/web/src/routes/ContextAside.tsx:154`
  （`eventosAnteriores`）以及同一文件末尾带分页器的 `ActivityFeed`
- **测试：** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  （describe "RN-180"）
- **来源：** 本轮自身的审查——200 的上限在四个部分中悄无声息地存在

### RN-181 — 区域委派出现在消息流中 {#rn-181}

当一个区域（QA、Infra）委派给子 agent 并汇总裁决时，lead 记录的三种结果——`delegation.completed`、`delegation.failed` 和
`delegation.dispensed`——只存在于日志面板中。关注会话的人看到 gate 打开又关闭，**没有任何迹象**表明底下有过第二次尝试。

三者开始在消息流中以**紧凑提示**叙述，采用 [RN-157](#rn-157) 的格式——而不是气泡：这是关于区域内部发生了什么的通知，而不是一句话。*句子*来自 `classifyEvent`，与面板中的相同，因为同一事件的两种措辞会在 payload 第一次变更时分歧；而且它已经点名了子 agent 和区域，因此**不**加 lead 前缀（否则会产生"QA Lead QA Automação concluiu a delegação (qa)"）。

区域的外部契约**不变**（ADR 0038）：消息流并不开始寻址子 agent，只是叙述 lead 已经记录的东西。失败的来源随 `delegation.failed` 一起传输，理由与 [RN-059](engine.md#rn-059) 相同——正是它说明下一步是换密钥、等提供方还是开一个 bug。

- **位置：** `apps/web/src/routes/session-timeline-montagem.tsx:754`
- **测试：** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  （describe "RN-181"）
- **来源：** `exp001` 中的真实使用——"quando houver uma nova tentativa e
  consolidação de algum agente deve apresentar no chat"

### RN-182 — 主题被选择、持久化，并在首次绘制之前应用 {#rn-182}

浅色主题从一开始就存在于 `design/tokens.css` 中，位于
`[data-theme='light']` 之下，而 **`apps/web` 中没有任何东西写入这个属性**：看到浅色主题的唯一方法是在 DevTools 中输入该属性。现在它变得可以到达。

偏好存放在 `localStorage['brabo.theme']` 中，**只**接受 `'dark'` 或
`'light'`，默认是 `dark`——设计系统的主主题。应用它的是 `apps/web/public/theme-boot.js`，**在 `<head>` 中同步执行，且在 bundle 之前**：`data-theme` 决定整个 `tokens.css` 的颜色，在水合之后再应用会让浅色主题的用户在每次加载时看到一次深色闪烁。

它是**文件，而不是内联脚本**，理由与字体自托管（ADR 0036）相同：生产镜像在 `script-src 'self'`（`docker/web/nginx.conf`）下提供服务，没有 `'unsafe-inline'`，也没有 nonce。内联在 `pnpm dev:web` 中能工作，却会**在发布的镜像中被阻止**——最糟糕的失败模式，因为它只在部署之后出现。

整条路径都是降级而不是崩溃：`localStorage` 可能抛出（隐私模式、iframe 中存储被阻止），而主题是偏好，不是功能；未知值落到默认值，而不是变成一个 CSS 不认识、会在没有任何主题的情况下渲染的 `data-theme`。

- **位置：** `apps/web/public/theme-boot.js:41`,
  `apps/web/index.html:53`
- **测试：** `apps/web/src/lib/tema.test.ts`（describe "contrato com o script
  de boot"）
- **ADR：** [0074](../adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-183 — 主题偏好只有一个来源，`<html>` 的属性才是事实 {#rn-183}

读取、写入、切换和观察主题都由 `apps/web/src/lib/tema.ts` 负责——按钮位于 shell 中并使用这个 API，从不自行写入 `data-theme`。

其中有三个决定：

1. **`temaAtual()` 先读取*属性***，然后才是 `localStorage` 和默认值。属性才是界面正在显示的东西；在它之前回落到已写入的偏好，会让 UI 在启动失败的恰恰那种情形中断言一个与所见不同的主题。
2. **没有写入的偏好时，`lerTemaSalvo()` 返回 `null`，而不是默认值**。从未作出选择的人有一天可能会跟随操作系统（`prefers-color-scheme`），在这里抹掉这一区分，会让日后决定这件事的人失去信息。
3. **`observarTema()` 覆盖 `storage` 事件**，浏览器在同一源的*其他*标签页中触发它。没有这一点，两个打开的标签页会处于不同主题，直到下一次重新加载。

键和默认值在 `public/theme-boot.js` 中重复，因为它在 bundle 之前运行，不能导入任何东西。这是唯一可能悄无声息地分歧的重复，因此测试会读取启动文件，在两者不再一致时失败。

- **位置：** `apps/web/src/lib/tema.ts:73`
- **测试：** `apps/web/src/lib/tema.test.ts`
- **ADR：** [0074](../adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-184 — 对比度在*两个*主题中测量 {#rn-184}

当浅色主题无法到达时（[RN-182](#rn-182)），只测量深色是诚实的：测量一个没有人能打开的界面，就是在测量一个意图。有了主题按钮，不再测量浅色就会隐藏产品一半的可见表面——因此颜色对在两个主题中都被要求，下限相同（文本 4.5:1，界面元素 3:1）。

为此，**浅色主题的六个 token 改变了值**。浅色中要求最高的背景是 `--code-bg`（纸色，`#efe4d2`，与表面只差一级），能对它达标的就能对其余达标：`--accent`
3.56 → 4.81，`--warning` 3.15 → 4.98，`--success` 3.89 → 5.12，`--violet`
4.16 → 4.95，`--text-muted` 2.76 → 5.17，`--accent-hover` 跟随 accent 低一级。深色主题**没有改变任何一个值**，它已知的欠账一直被同样的五个数字锁定（3.89 / 3.10 / 3.88 / 3.88 / 4.41），直到 [RN-640](#rn-640)（ADR 0181）用中性调色板关闭了它，并把它变成了下限。

浅色的 `--text-muted` 不是欠账：在 `--surface-2` 上为 2.40:1，它连*界面元素*的下限都不满足，而那是存在的最低下限。那是缺陷，而浅色主题没有理由比主主题更差。

- **位置：** `design/tokens.css:208`
- **测试：** `apps/web/src/lib/contraste.test.ts`,
  `apps/web/src/design-contraste.test.ts`,
  `apps/web/test/design-contraste.test.ts`
- **ADR：** [0074](../adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-185 — 八个语法角色，handoff 的值只有在测量之后才进入 {#rn-185}

高亮调色板原来是三个自有 token（`--syntax-function`、
`--syntax-comment`、`--syntax-operator`）和五个复用的语义 token
（`--accent`、`--warning`、`--violet`、`--success`、`--text-primary`）。正是这种复用让调色板只在深色中被测量：在浅色中，语义 token 对纸色的 `--code-bg` 不达标。

现在它拥有 handoff 的**八个角色**，使用仓库已经在用的 `--syntax-*` 前缀，每个在每个主题中都有自己的值。给这八个命名，正是让高亮在需要的那天可以与语义分开的东西。

**handoff 的值只有在测量通过时才进入。** 对照 handoff 自己的 `--code-bg`，八个中有五个达不到代码文本要求的 4.5:1——`--syn-cm` 在深色中为 4.09:1、在浅色中为 2.32:1，`--syn-kw` 4.34:1，`--syn-str` 4.20:1，`--syn-fn` 4.14:1，`--syn-op` 4.00:1。handoff 不达标的地方，以测得的数字为准：这是 ADR 0036 的同一把尺子——handoff 的意图有效，破坏产品的机制（或数字）无效。

五个语义 token 仍然是真正上色的（`SyntaxTokens.module.css` 在这次交付中没有改变），因此它们与八个角色**并列测量**：只要它们是真正的像素，下限就向它们要求。在浅色主题中，每个角色目前的数字与为其上色的语义 token *相同*，这是刻意的——同一像素的两个来源有不同的数字，会在第一次只改一侧的修正时分歧。

- **位置：** `design/tokens.css:111`
- **测试：** `apps/web/src/lib/contraste.test.ts`（describe "contraste — paleta
  de sintaxe sobre --code-bg"）
- **ADR：** [0074](../adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-195 — 侧边栏可折叠为图标轨道，偏好会被持久化 {#rn-195}

`Shell.tsx` 原来是固定宽度（248px），没有任何收缩方式。现在它在 `--sidebar-w`（264px）和 `--sidebar-w-collapsed`（62px）之间切换——Onda 1/frente A 已经在 `design/tokens.css` 中创建的两个 token——，带 `transition: width .18s ease`。折叠时，它成为一条垂直轨道：每个项目一个首字母方块（边框为身份色，
[RN-197](#rn-197)）外加一个活动图标；在轨道上点击一个项目会重新展开栏、打开该项目并导航到它。

偏好属于用户，并能挺过重新加载：`apps/web/src/lib/sidebar-state.ts` 中的 `brabo.sidebar.collapsed`（`'1'`/`'0'`）。它**只是手动的**（`colapsadoManual`）：曾经有第二个*自动*状态（`autoColapsado`），由代码标签页以 OR 叠加，它被
[ADR 0126](../adr/0126-trilho-vertical-de-navegacao-do-projeto.md) 移除——见 [RN-201](#rn-201)。没有任何界面会自行折叠侧边栏；看到折叠的状态，是用户要求的，并且已被记录。

- **位置：** `apps/web/src/routes/Shell.tsx:340-351`（状态和开关），
  `apps/web/src/routes/Shell.module.css`（`.sidebar`、`.colapsado .sidebar`、
  `.trilha*`），`apps/web/src/lib/sidebar-state.ts`
  （`lerColapsado`/`gravarColapsado`）
- **测试：** `apps/web/src/lib/sidebar-state.test.ts`（describe "colapso"），
  `apps/web/src/routes/Shell.test.tsx`
- **来源：** PROGRAMA 28，Onda 2，frente B——
  `design_handoff_brabo/README.md` 的 "Navigation shell" 部分

### RN-196 — 可展开的项目会显示项目的标签页，可同时展开 N 个 {#rn-196}

侧边栏中的每个项目获得一个 chevron：点击它会展开该行，显示该项目的标签页列表（概览、执行者、Criativo、聊天、代码、Backlog、审批、洞察、花费、设置），每一个都是指向 `/projects/$projectId?tab=<chave>` 的链接。多个项目可以同时打开——状态是 id 的 `Set<string>`，持久化在 `brabo.sidebar.open` 中。

标签页列表和标签来自 `ABAS_DO_PROJETO`
（`apps/web/src/routes/project-tabs.ts`，属于 frente C，在这一波中并行进行）——侧边栏只**读取**导出的数组，从不重写标签页名称。**形状假设**，需要对照 frente C 的交付核对：`AbaDoProjeto` 有 `key: string`、`label: string` 和
`count?: (contagens: ContagensDeAba) => number | undefined`，其中
`ContagensDeAba = { promocoesPendentes, aprovacoesPendentes,
hipotesesPendentes }`。侧边栏只能免费填充
`aprovacoesPendentes`（`pendingApprovalsCount` 已经出现在仪表板摘要中，[RN-151](api.md#rn-151)）；`promocoesPendentes`/`hipotesesPendentes` 以 `0` 进入——计算它们需要对侧边栏中*每个打开的项目*做一次新查询，与 RN-090/091 在仪表板中关闭的同一类 N+1。这两个徽章在 `ProjectPage` 自己的尺子内仍然正确；只有侧边栏中的预览是不完整的，这是刻意的省略，而不是 bug。

*当前*路由的项目总是显示为展开（`projetosAbertosEfetivo`），即使它不在持久化的 `Set` 中——通过路由"免费"打开不会写入任何东西；只有显式点击 chevron 才会进入 `brabo.sidebar.open`。

**自 [ADR 0211](../adr/0211-uma-navegacao-so-a-sidebar-absorve-o-trilho.md)
（AT-404）起，这个列表是项目*唯一*的导航：**垂直轨道退出了，它接收了原来只有轨道才有的一切——三个带标题的分组、标记的当前标签页、以项目命名的垂直 `tablist`、键盘（`ArrowDown`/`ArrowUp`/`Home`/`End`，循环并跨越分组）以及*五个*计数器，各在自己的标签页上，绝不相加。上面那个刻意的省略对*关闭*的项目以及在项目框架之外打开的项目（例如在会话中）仍然有效：只有审批，来自摘要。当项目框架挂载时，五个数字来自它所使用的*同一个* hook（`useContagensDoProjeto`），没有新的请求。折叠时，打开的项目的方块会打开一个带相同标签页的浮出菜单。

- **位置：** `apps/web/src/routes/Shell.tsx:557` (`projetosAbertosEfetivo`),
  `:505` (`useContagensDoProjeto`), `:512` (`irParaAba`), `:527`
  (`flyoutAberto`), `:215` (`contagensDoResumo`);
  `apps/web/src/routes/AbasDoProjeto.tsx:78` (`AbasDoProjeto`), `:34`
  (`itensDasAbas`), `:95` (`aoTeclar`);
  `apps/web/src/lib/contagens-do-projeto.ts:22` (`useContagensDoProjeto`),
  `:70` (`publicarAbaAtiva`), `:86` (`pedirAba`);
  `apps/web/src/lib/sidebar-state.ts`（`lerProjetosAbertos`/`gravarProjetosAbertos`）
- **测试：** `apps/web/src/lib/sidebar-state.test.ts`（describe "conjuntos"），
  `apps/web/src/routes/Shell.test.tsx`（describe "Shell — abas do projeto
  aberto (ADR 0211)"：12 个标签页、五个分开的计数器、当前标签页、点击和方向键导航、折叠的浮出菜单、手机上的抽屉，以及失败用例——没有挂载框架时，只有摘要的数字），
  `apps/web/src/routes/AbasDoProjeto.test.tsx`（分组、当前标签页、计数器、键盘、roving tabindex、按项目的链接），`apps/web/src/routes/project-tabs.test.tsx`
- **来源：** PROGRAMA 28，Onda 2，frente B；ADR 0211（AT-404）

### RN-197 — 项目的两种颜色，两种用途：身份不是状态 {#rn-197}

handoff 要求在展开的行中有一个"项目颜色点"，并在折叠的轨道上使用同样的颜色原则。产品在那里已经有一个点——`NavStatusDot`——但它是**状态**（预算/最近活动，由 `useProjectsSummary`/`useProjectsStatus` 推导而无需自己的查询，RN-039），而不是身份：它的颜色会随时间*变化*。

决定是记录下来而不是解决：展开的行继续只显示 `NavStatusDot`（那是可操作的信息；在旁边再加第二个点是噪音）。*身份*颜色——每个项目稳定，基于 id 在一个固定 token 调色板上的确定性哈希（`corDoProjeto`，没有新表，与 `AGENTS[key].color` 同一思路）——只出现在折叠的轨道上，作为首字母方块的边框，那里放不下两个点，而在许多相似的方块中帮助找到正确项目的是身份（而不是状态）。

同样，handoff 要求项目上有"显示最近迭代总数的徽章"；产品自 RN-151 起使用 `pendingApprovalsCount`，它晚于 handoff，解决了一个真实的缺陷（一个点击后与任何可操作之事都对应不上的数字）。这个徽章**不变**——RN-151 仍然有效，在这里分歧的是 handoff。

- **位置：** `apps/web/src/lib/sidebar-state.ts`（`corDoProjeto`），
  `apps/web/src/routes/Shell.tsx`（`NavStatusDot`，关于分歧的注释）
- **测试：** `apps/web/src/lib/sidebar-state.test.ts`（describe "corDoProjeto"）
- **来源：** PROGRAMA 28，Onda 2，frente B——
  `design_handoff_brabo/CHECKLIST-CONFRONTO.md` 与 RN-151 之间的分歧

### RN-199 — 页脚的主题按钮，折叠时也可用 {#rn-199}

侧边栏的页脚新增了一个太阳/月亮按钮，它使用 Onda 1/frente A 的 `apps/web/src/lib/tema.ts` API（`temaAtual`、
`alternarTema`、`observarTema`），不重新实现任何东西——只有*按钮*是新的。在折叠状态（62px）下也能工作：文字标签消失，但 `aria-label`/`title` 仍描述当前主题，点击仍然切换。

- **位置：** `apps/web/src/routes/Shell.tsx:130-148`（`BotaoDeTema`）
- **测试：** `apps/web/src/lib/tema.test.ts`（API，未被本 RN 改变）
  ——`Shell.test.tsx` 不重复主题的测试套件，只挂载 Shell
- **来源：** PROGRAMA 28，Onda 2，frente B

### RN-200 — 只有项目和活动作为全局项 {#rn-200}

导航页脚中两个没有路由的项（"全局聊天"/"设置"，`title="em breve"`）被移除。handoff 很明确：只有项目和活动是*全局*项——其他一切都限定在某个项目内。"设置"仍然存在，作为展开行中的项目*标签页*（[RN-196](#rn-196)）——移除的是没有目标的孤立项。

- **位置：** `apps/web/src/routes/Shell.tsx`（FASE 17a 的 `.globalNav`/
  `.inertNavItem` 块被移除，没有全局替代）
- **测试：** `apps/web/src/routes/Shell.test.tsx`（describe "sem itens
  globais inertes"）
- **来源：** PROGRAMA 28，Onda 2，frente B——
  `design_handoff_brabo/README.md` 的 "Navigation shell" 部分

### RN-201 — 活跃的项目/标签页在页面之间持久化；侧边栏的折叠*只*属于用户 {#rn-201}

handoff 的最后两个键：`brabo.project`（活跃项目）和
`brabo.tab`（活跃标签页）——在用户点击*侧边栏中*的标签页链接（`LinhaDeAba`/项目名称链接）时写入。URL 中的 `?tab=` 只作为*初始*深链接有效（`project-tabs.ts`，FASE 24）——在 `ProjectPage.tsx` 内切换标签页是本地状态，第一次加载之后不写入 URL，因此这些键是偏好在一次导航与另一次导航之间存活的唯一途径。**这一半从未改变。**

**代码标签页的自动折叠被移除了（ADR 0126）。** 在此之前，代码标签页会自行折叠侧边栏，为编辑器腾出宽度，而不写入偏好：`sidebar-state.ts` 中的 `AutoCollapseContext`/`useAutoCollapseSidebar`，由 `ProjectCodeTab.tsx`（唯一调用者）注册，并在 `Shell` 中与手动折叠以 OR 叠加。上下文、hook、`autoColapsado` 状态、包裹 `<Outlet />` 的 `Provider` 以及折叠按钮的 `disabled`——它只为保护这条路径而存在——全部被移除。

原因是结构性的：在项目的垂直轨道（`routes/ProjectRail.tsx`，已在 ADR 0211 中移除）始终存在的情况下，保留自动折叠会让 Shell 的图标轨道紧贴项目轨道——在产品最重的标签页上，*两条*相邻的、永久的垂直轨道。

现在生效的是：**侧边栏的折叠是*用户*的决定，且只是他的。**它仍然是手动的，仍然持久化在 `brabo.sidebar.collapsed` 中（[RN-195](#rn-195)），没有任何界面会自行折叠侧边栏。

**接受并声明的代价：**代码标签页开始以*展开*的侧边栏（264px）+ 项目轨道（180px）+ `CodeShell` 自己的轨道（48px）打开——在第一个代码字符之前有 492px 的框架，在浏览器中*测得*，而之前约为 110px（62px 折叠的侧边栏 + 48px 代码轨道）。手动折叠仍然可行，并且仍然会让 Shell 的轨道挨着项目轨道——区别在于现在是用户选择的，而不是系统。

**由 [ADR 0211](../adr/0211-uma-navegacao-so-a-sidebar-absorve-o-trilho.md)
（AT-404）修订：**项目轨道退出了，代码标签页的框架在侧边栏展开时变为 **312px**（264 + `CodeShell` 的 48），折叠时为 **110px**（62 + 48）——两种情况下都没有双轨道。折叠仍然只属于用户。侧边栏标记的当前标签页来自项目框架（`publicarAbaAtiva`），而不只是 `brabo.tab`。

- **位置：** `apps/web/src/lib/sidebar-state.ts:80-105`
  （`lerProjetoAtivo`/`gravarProjetoAtivo`、`lerAbaAtiva`/`gravarAbaAtiva`，以及记录移除的注释），`apps/web/src/routes/Shell.tsx:366-369`
  （只剩 `colapsadoManual`），`apps/web/src/routes/ProjectCodeTab.tsx`
  （没有任何折叠调用）
- **测试：** `apps/web/src/lib/sidebar-state.test.ts`（describe "projeto e
  aba ativos"），`apps/web/src/routes/Shell.test.tsx`（describe "Shell —
  colapso da sidebar"：偏好只来自点击按钮，并且总会被写入）。describe "useAutoCollapseSidebar" 与 hook 一起被移除。
- **来源：** PROGRAMA 28，Onda 2，frente B——
  `design_handoff_brabo/CHECKLIST-CONFRONTO.md` 第 1 部分；自动折叠的那一半由
  [ADR 0126](../adr/0126-trilho-vertical-de-navegacao-do-projeto.md) 修订

### RN-202 — `sessions` 标签页仍然叫"Chat"，绝不叫"Chat RAG" {#rn-202}

PROGRAMA 28 最新的设计 handoff 把咨询标签页叫做"Chat RAG"（`designs/Brabo Chat.dc.html`），但产品没有这项功能：没有按项目的索引流水线，没有向量索引，没有引用来源的 UI。ADR 0075 把 `embed` 放进了 `LLMProvider` 的契约——这个操作存在并在 Ollama 上*经过证明*——，但还没有任何东西*消费*它。今天的 `sessions` 标签页是 [RN-104](#rn-104) 的普通咨询聊天：一个 agent 带着会话上下文回答，不产出 backlog，背后没有任何 RAG。

今天把标签页标为"Chat RAG"会宣告一种不存在的能力——与 [ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md) 已经对目录模型拒绝的错误相同（"不自动激活发现的模型"）。标签会在功能到来的那天改变，连同其背后的数据——绝不提前。

- **位置：** `apps/web/src/routes/project-tabs.ts:144`（条目 `key:
  'sessions'`）
- **测试：** `apps/web/src/routes/project-tabs.test.tsx`（describe "abas do
  projeto derivam de um registro só"，`'RN-202 — a aba \`sessions\` continua
  "Chat", nunca "Chat RAG"'`）
- **ADR：** [0078](../adr/0078-moldura-de-tela-e-o-registro-de-abas-diverge-do-handoff.md)

### RN-203 — handoff 是视觉参考，而不是产品标签页数量的上限 {#rn-203}

设计 handoff 列出了 7 个项目标签页（概览、Criativo、代码、Chat RAG、花费、审批、设置）；注册表（`apps/web/src/routes/project-tabs.ts`）有 10 个。多出的三个——
`executores`（[RN-121](#rn-121)）、`backlog`（[RN-048](api.md#rn-048)）和
`insights`（等待决定的 Psicólogo 假设）——都诞生于 handoff 设计*之后*，都有真实数据、由查询推导的计数器，以及至少一条带测试的自有 RN。

handoff 规定的是每个界面应该*看起来*怎样——颜色、字体、间距、框架的绘制——，这一部分在同一次变更中被严格遵循（头部、标尺、滚动、内容宽度）。它并不把标签页清单冻结在它被写下的那一天。为了与 handoff "对上"而删除这三个，会出于错误的原因摧毁产品本来已经会显示的信息。

- **位置：** `apps/web/src/routes/project-tabs.ts:91`（`REGISTRO`）
- **测试：** `apps/web/src/routes/project-tabs.test.tsx`（describe "abas do
  projeto derivam de um registro só"，`'RN-203 — as 3 abas que o handoff não
  previu continuam no registro'`）
- **ADR：** [0078](../adr/0078-moldura-de-tela-e-o-registro-de-abas-diverge-do-handoff.md)

### RN-210 — "推荐"是真实使用和成本，绝不是计算出的分数 {#rn-210}

"按能力的最佳模型"块（设置）没有分数列。handoff 为每种能力显示一个分数（代码 9.4、图像 9.1……），但那是 mock 的*虚构*数据——没有任何提供方公布"代码质量"，产品也不在任何地方测量它。在这里计算一个数字，就是 [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md) 对*模型*能力所禁止的那种"穿着数据外衣的猜测"，只是这次针对的是质量。

取而代之，"推荐"/"备选"来自两个真实信号，在*本* workspace 的策展为该能力标记的模型之中（`uses`，
[RN-057](api.md#rn-057)）：首先是*本*项目的 agent 使用最多的——与解析每个 agent 现行 binding 的同一级联——，以成本（来自目录，升序）作为平局决胜。"团队已经选择的"是在不编造分数的情况下可用的最诚实的信号。没有任何策展模型的能力显示"没有策展覆盖"——从不隐藏这一行，与 `ModelsSection` 的来源列已经为被跳过的 binding 使用的模式相同。

- **位置：** `apps/web/src/routes/settings/MelhoresModelosPorCapacidadeSection.tsx`
- **测试：** `apps/web/src/routes/ProjectSettingsTab.test.tsx`
  （describe "MelhoresModelosPorCapacidadeSection"）
- **ADR：** [0077](../adr/0077-ranking-de-modelos-por-capacidade-sem-nota-inventada.md)

### RN-211 — 界面上按提供方的花费是排名，而不是编造的分类调色板 {#rn-211}

handoff 要求按提供方堆叠的每日条形图以及按提供方的拆分。仓库的 dataviz skill 要求在使用分类调色板之前用脚本校验，绝不凭眼睛：`validate_palette.js` 拒绝 `design/tokens.css` 中每个 3 个以上 token 的组合在至少一个主题中——`--accent`+`--violet` 是唯一在两个主题中都通过的一对（若干 `--syntax-*` 字面上就是与 `--warning`/`--violet`/`--success` 相同的十六进制值，已测量）。有 9 个提供方（ADR 0043）而只有 2 种经过校验的颜色，循环使用调色板正是该 skill 自己点名的反模式（"a 9th series is never a generated hue"），而发明新的十六进制值会违反这一 frente 的指示。按提供方的拆分变成 `Ranking`——与"按模型"/"按项目"/"按 agent 和人"相同的组件，没有按颜色的身份。按提供方的*每日*序列没有交付：`sumGroupedBy`（ADR 0076）一次按一个维度分组，这一波的后端中不存在日×提供方的交叉聚合。

- **位置：** `apps/web/src/lib/spend.ts`（"Gasto por PROVIDER na
  tela"块），`apps/web/src/routes/ProjectSpendTab.tsx`（`GastoDoWorkspace`）
- **测试：** `apps/web/src/routes/ProjectSpendTab.test.tsx`（describe "a
  audiência do owner"——`'mostra os cinco recortes do workspace,
  incluindo provider'`）
- **ADR：** [0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-212 — "按项目"块是接入真实预算的 TokenMeter {#rn-212}

花费标签页新增了一个按*项目*（而不是按受众）的块：
`OrcamentoDoProjeto` 读取 `GET /projects/:id/budget`，并把结果直接放进已有的 `TokenMeter`，后者已经实现了 70/90 的阈值（`tokenThreshold`）——没有新组件。三种读取：加载中（静默，避免在角色解析出下方的受众之前闪烁）、没有定义预算（文字说明，没有 CTA）以及错误（静默——实际上几乎总是拥有 *workspace* 角色但在*项目*中不是 `maintainer` 的人得到的 403，刻意显示横幅对大多数成员而言是误报，与 `ProjectPage.tsx` 的紧凑 `TokenMeter` 已经使用的模式相同）。

- **位置：** `apps/web/src/routes/ProjectSpendTab.tsx`
  （`OrcamentoDoProjeto`）
- **测试：** `apps/web/src/routes/ProjectSpendTab.test.tsx`（describe "o
  orçamento do projeto"）

### RN-214 — 本地模型节省的 KPI 因缺少反事实价格而不在范围内 {#rn-214}

`TokenMeter` 已经准备好 `savingsBRL`/`savingsPct` 来接收数字，它们被刻意保持未填充。这张卡片需要一个*反事实*价格——同一次调用在付费模型上本会花费多少——而它在产品的任何地方都不存在：目录（ADR 0042）只冻结*实际*使用的模型的价格（RN-044），也没有声明的"本地模型 X ~ 付费模型 Y"映射。在这里编造它，就是 RN-210 已经为能力排名拒绝的那类"穿着数据外衣的分数"。待办事项记录在 backlog 中，等有了可辩护且带版本的反事实价格时再做。

- **位置：** `apps/web/src/routes/ProjectSpendTab.tsx`（注释 "KPI de
  economia com modelos locais — CORTE DECLARADO"，文件末尾）

### RN-215 — 问题标签页以诚实的空状态诞生 {#rn-215}

对所管理项目的代码没有集成的 lint 或测试；底部面板的问题标签页（handoff `design_handoff_brabo`）明确说明这一点，而不是显示编造的计数（handoff 的 mock 带有徽章"3"）。与终端（FASE 25b）以及轨道上被禁用的"测试"项已经使用的模式相同。

- **位置：** `apps/web/src/routes/code/CodeBottomPanel.tsx`
- **测试：** `apps/web/src/routes/code/CodeBottomPanel.test.tsx`——
  "Problemas diz honestamente que não há lint/teste integrado, sem
  contagem inventada"

### RN-216 — 输出标签页以诚实的空状态诞生 {#rn-216}

这个标签页中没有构建/部署命令的流——它依赖于交互式终端（FASE 25b），而那并不存在。标签页解释这一点，并提醒 `git push`/PR/部署无论如何都不会通过终端发出（RN-106）。

- **位置：** `apps/web/src/routes/code/CodeBottomPanel.tsx`
- **测试：** `apps/web/src/routes/code/CodeBottomPanel.test.tsx`——"Saída
  diz honestamente que não há stream de comando, sem simular execução"

### RN-217 — 代码标签页的状态栏只显示真实数据 {#rn-217}

24px 的状态栏（`CodeShell.tsx`）显示当前分支提交的 `↑N ↓M`（通过 `getCodeBranches`，与 `CodeBranchPicker` 相同的 `queryKey`——去重，零额外请求，RN-090/091）以及当前文件的语言（`linguagemPorCaminho`）。handoff mock 中的光标位置和错误/测试计数被排除在外：`CodeEditor` 不暴露可追踪的选区/插入符，也没有集成的 lint/测试（与 RN-215 相同的决定）。

- **位置：** `apps/web/src/routes/code/CodeShell.tsx`
- **测试：** `apps/web/src/routes/code/CodeShell.test.tsx`——"a status bar
  mostra ↑/↓ real da branch atual" 和 "sem ahead/behind (branch em dia), a
  status bar não mostra o par vazio"

### RN-218 — 底部面板自有标签页上的可见焦点 {#rn-218}

`CodeBottomPanel.tsx` 的标签页是自有实现（不是设计系统的 `Tabs`），没有继承 `Tabs.module.css` 在 Onda 2/frente C 中获得的校准过的 `:focus-visible`。用与 `Input.module.css`（ADR 0036）相同的模式修正，包括 `forced-colors`。

- **位置：** `apps/web/src/routes/code/CodeBottomPanel.module.css`

### RN-227 — 会话状态徽章覆盖 5 个真实状态，而不是 handoff 的 4 个 {#rn-227}

handoff 为状态机的 5 个真实状态（`created/active/closing/closed/closed_abnormally`）要求 4 个徽章（活跃/等待中/已关闭/已中止）。`closed_abnormally`→已中止和 `created`→等待中是直接对应的。`closing` *不*与"已关闭"合并：它获得自己的徽章（"正在结束"，色调 `accent`，脉动），因为在 `closing` 中结果（`closed` 或 `closed_abnormally`）还不知道——把它叫做"已关闭"会在这一点上撒谎。

- **位置：** `apps/web/src/routes/ProjectSessionsTab.tsx`（`SELO_DO_STATUS`）
- **测试：** `apps/web/src/routes/ProjectSessionsTab.test.tsx`——describe
  "ProjectSessionsTab — selo de status (RN-227)"

### RN-228 — 药丸过滤器按*轨迹*归并 2 个没有自己药丸的状态 {#rn-228}

handoff 的药丸过滤器（全部/活跃/已关闭/已中止）只覆盖 5 个状态中的 4 个。`created`（等待中）进入"活跃"药丸——它还没有到达任何地方，是"仍在进行中的会话"。`closing` 进入"已关闭"药丸——它已经在没有错误地走向关闭。每行的*徽章*（RN-227）从不被过滤器重写；药丸只做归并。

- **位置：** `apps/web/src/routes/ProjectSessionsTab.tsx`
  （`correspondeAoFiltro`）
- **测试：** `apps/web/src/routes/ProjectSessionsTab.test.tsx`——describe
  "filtro pill agrupa os 2 estados sem pill própria (RN-228)"

### RN-229 — Criativo 标签页的"本月成本"KPI 是*执行者*的消耗，而不是项目的总额 {#rn-229}

复用 `getMySpend(projectId, 30)`——与 `ProjectSpendTab.tsx#MeuConsumo` 用于成员视图的*同一个* queryKey（RN-101，ADR
0063），没有新的聚合。*绝不*显示把所有人加起来的项目总额（`getWorkspaceSpendReport` 中的 `porProjeto`），因为那个数据只属于 owner，而 Criativo 标签页对项目的任何成员可见——显示总额会把别人的花费泄露给 RN-060/101 不授权查看的人。

- **位置：** `apps/web/src/routes/ProjectSessionsTab.tsx`（`CriativoKpis`）
- **测试：** `apps/web/src/routes/ProjectSessionsTab.test.tsx`——describe
  "KPIs da aba Criativo"，用例 "caminho feliz" 和 "CASO DE FALHA"

### RN-230 — "构思 → 提交率"KPI 被声明为缺失，绝不计算 {#rn-230}

在产品的任何地方都不存在创意会话与其产生的提交之间的关联。Criativo 标签页显示"—"以及句子"não
medido: sessão não é vinculada a commit hoje"，而不是编造一个计算——与 ADR 0042 已经对模型分数拒绝的错误同类。

- **位置：** `apps/web/src/routes/ProjectSessionsTab.tsx`（`CriativoKpis`）
- **测试：** `apps/web/src/routes/ProjectSessionsTab.test.tsx`——"'Taxa
  ideação → commit' é DECLARADA ausente — nunca um número calculado"

## PROGRAMA 28 — 第 4 波，E2 战线：Code 标签页中的行虚拟化与小地图（RN-239..242）

### RN-239 — 行虚拟化：只有可见窗口变成 DOM 节点 {#rn-239}

`CodeEditor.tsx` 只把可见窗口内的行（加上
`OVERSCAN = 20` 的边距）渲染为 `[data-line-row]`；其余部分变成两个间隔元素，保留高度而不作为节点存在。**不**使用 `react-window`/`react-virtual` 的决定：行高是**固定**的
（`ALTURA_LINHA = 21`，等宽），这把“哪一行可见”简化为对 `scrollTop` 的整数除法——这些库真正解决的问题是每个条目**可变**的高度，而 Code 标签页并非如此。

- **位置：** `apps/web/src/routes/code/CodeEditor.tsx`（第 38-96、45、
  48 行）
- **测试：** `apps/web/src/routes/code/CodeEditor.test.tsx`——describe
  "CodeEditor — virtualização"、"caminho feliz: arquivo de 5.000 linhas
  renderiza uma janela pequena de nós, não o arquivo inteiro"（`< 150` 个
  `[data-line-row]` 节点）和 "rolar para o meio do arquivo troca a janela —
  linha 1 some, linhas do meio aparecem"

### RN-240 — 没有高度测量时，降级为宽裕的默认窗口，永不渲染全部 {#rn-240}

当 `containerHeight` 尚未测量时（第 1 次渲染，或测试中没有
`ResizeObserver` 的 jsdom），窗口回落到 `LINHAS_SEM_MEDICAO = 40`——宽裕到不会截断测试使用的小文件，又小到在真正的大文件中永远不会变成“全部渲染”。

- **位置：** `apps/web/src/routes/code/CodeEditor.tsx`（第 57 行）
- **测试：** `apps/web/src/routes/code/CodeEditor.test.tsx`——"falha/borda:
  sem medição de altura (jsdom sem ResizeObserver, clientHeight 0),
  degrada para uma janela padrão em vez de não renderizar nada"

### RN-241 — 小地图复用与虚拟化**相同**的分词——对文件零次第二遍处理 {#rn-241}

`minimap.ts` 不做任何分词：它汇总 `highlight.ts` 已经产生的输出（`highlightFile` 的 `HighlightToken[][]`，只调用一次）——与虚拟化用来给可见行着色的是**同一个**。仅为小地图重新分词会第二次付出读取文件的代价，因此小地图只在虚拟化就位之后才加入，从不在之前。

- **位置：** `apps/web/src/routes/code/minimap.ts`（第 1-18、39 行）
- **测试：** `apps/web/src/routes/code/minimap.test.ts`

### RN-242 — 小地图是 **CANVAS**，只有一个 DOM 节点，永远不是每行一个 `<div>` {#rn-242}

绘制在 `<canvas>` 中进行（`desenharMinimapa`），而不是每行一个元素：每行一个节点的小地图会把虚拟化（RN-239）刚刚削减的数量再次翻倍。没有可用的 2D canvas 上下文时（没有 `canvas` 包的 jsdom），可点击的覆盖层继续工作——只跳过绘制，从不跳过交互。

- **位置：** `apps/web/src/routes/code/minimap.ts`（第 14-16、91 行）
- **测试：** `apps/web/src/routes/code/CodeEditor.test.tsx`——describe
  "CodeEditor — minimapa"、"caminho feliz: clicar no minimapa rola o
  editor e troca a janela renderizada" 和 "falha: sem contexto de canvas
  2D (jsdom sem o pacote `canvas`), o overlay continua clicável e nada
  quebra"

## PROGRAMA 28 — 第 4 波，H4 战线：剩余的临时折叠迁移到 `Disclosure`（RN-249..251）

### RN-249 — 带细节的里程碑的点击目标从 20px 提升到 `Disclosure` 的 24px 下限 {#rn-249}

`AgentTimelineTree` 中**带**细节的里程碑在可点击标题上有 `min-height: 20px`——低于 WCAG 2.2 AA 2.5.8（Target Size，最小 24px），而之前的一条注释已经承诺过却没做到。迁移到共享的 `Disclosure` 免费修正了这一点：通用组件生来就是 24px，不需要记得在每个新消费者中设置这个尺度。

- **位置：** `apps/web/src/components/AgentTimelineTree.module.css`
  （第 135-155 行，`.marcoLinha`）
- **测试：** `apps/web/src/components/AgentTimelineTree.test.tsx`
- **ADR：** 无——点状的 a11y 修正，与 ADR 0036 的模式相同

### RN-250 — `ApprovalCard` 中 diff 的文件条**不**迁移到 `Disclosure`——自带的动画就是原因 {#rn-250}

`ApprovalCard` 中 diff 的文件条通过
`transform: rotate(90deg)` 旋转 chevron，并带有自己的过渡
（`.chevron.open`/`ApprovalCard.module.css`）；通用的 `Disclosure`
**替换**图标（右箭头 → 下箭头），没有任何动画。强制迁移会抹掉这个微交互而毫无收益——互斥性（一次只打开一个文件）已经来自外部（`expandedFile`），与受控的 `Disclosure` 会做的一样。缺少的——而且不是特殊性，正是 `Disclosure` 存在要关闭的同一个缺陷——是指向具名区域的
`aria-controls`：直接修正，不更换组件。

- **位置：** `apps/web/src/components/ApprovalCard.tsx`（第 511-539 行）
- **测试：** `apps/web/src/components/ApprovalCard.test.tsx`

### RN-251 — 五个调用点迁移到共享的 `Disclosure`；组件获得 `testId` 作为唯一的新 hook {#rn-251}

`ModelCatalogSection`（在 FASE 16 中催生该组件的原始参考）、`AgentTimelineTree`（分支 + 里程碑）、`code/CodeExplorer.tsx`
（树中的文件夹）和 `code/CodeShell.tsx`（底部面板）开始使用共享的 `Disclosure`——在 FASE 16 后幸存的六个临时实现中没有一个被落下，除了 RN-250 声明的例外。`testId` 是消费者唯一需要的新 prop（标题上的 `data-
testid`，让现有测试无需重写整个套件就能继续选中正确的按钮）。受控区域即使在关闭时也存在于 DOM 中——只是 `hidden` 且不挂载子元素——因为指向一个无法解析的 id 的 `aria-controls` 比没有这个属性更糟（屏幕阅读器会宣布控制着某个不存在的东西）；正是这一属性允许折叠昂贵的列表（OpenRouter 的目录有 338 个模型）而不挂载没人在看的内容。

- **位置：** `apps/web/src/components/ui/Disclosure.tsx`（第 33-71 行）、
  `apps/web/src/components/ModelCatalogSection.tsx`、
  `apps/web/src/components/AgentTimelineTree.tsx`、
  `apps/web/src/routes/code/CodeExplorer.tsx`、
  `apps/web/src/routes/code/CodeShell.tsx`
- **测试：** `apps/web/src/components/ui/Disclosure.test.tsx`、
  `apps/web/src/routes/code/CodeExplorer.test.tsx`、
  `apps/web/src/routes/code/CodeShell.test.tsx`

## PROGRAMA 28 — 第 5 波，G3 战线：Chat RAG 屏幕（RN-252..254，ADR 0082）

### RN-252 — Chat RAG 屏幕显示后端已经声明的两种诚实降级，从不隐藏它们 {#rn-252}

当 embedding 提供方没有响应时，`HybridSearchUseCase` 已经返回 `vectorAvailable: false`（RN-233），而 `GetRagCoverageUseCase` 已经从不包含索引时间戳（RN-237）——但后端的诚实契约并不能保证屏幕诚实，如果屏幕决定不读这两个字段的话。当 `vectorAvailable` 为 `false` 时，`ProjectRagTab` 在结果上方显示一条提示（存在时附带 `vectorUnavailableReason`），而 `RagCoveragePanel` 只渲染**真实**计数（`filesIndexed`/
`filesInRepo`、`sessionsIndexed`/`sessionsInProject`）——此屏幕不会产生任何“Xmin 前重新索引”之类的文本，因为响应不携带这项数据，编造它就是撒谎（与 ADR 0042 对模型说明采用的标准相同）。

- **位置：** `apps/web/src/routes/ProjectRagTab.tsx`（第 27-31、176-182 行）、
  `apps/web/src/components/rag/RagCoveragePanel.tsx`（第 27-34 行）
- **测试：** `apps/web/src/routes/ProjectRagTab.test.tsx`——"CASO DE FALHA
  (degradação honesta): vectorAvailable false avisa..."；`apps/web/src/components/rag/RagCoveragePanel.test.tsx`
  ——"CASO DE FALHA (degradação honesta): nunca escreve..."
- **ADR：** [0082](../adr/0082-chat-rag-aba-de-busca-hibrida.md)

### RN-253 — 来源为 `session` 的引用导航到确切的**事件**，复用 Psicólogo 的机制 {#rn-253}

`RagCitationCard` 不发明第二条导航路径：来源
`{ kind: 'session', sessionId, eventId }` 调用 `useNavigate` 前往
`/projects/:projectId/sessions/:sessionId`，并带 `search: { highlightEvent:
eventId }`——与 Psicólogo 的证据标签（`HypothesisCard.tsx`，第 4b 阶段）用来把线程滚动到事件并高亮它的**同一个**路由和**同一个**参数。来源 `{ kind: 'file' }` 以文本形式显示路径和
`headingPath`，没有链接：Code 标签页如今没有按路径的深链接，构建这种导航超出本战线的范围。

- **位置：** `apps/web/src/components/rag/RagCitationCard.tsx`（第
  32-38、49-56 行）
- **测试：** `apps/web/src/components/rag/RagCitationCard.test.tsx`——
  "caminho feliz: origem de sessão navega até o evento exato ao clicar"
- **ADR：** [0082](../adr/0082-chat-rag-aba-de-busca-hibrida.md)

### RN-254 — 重新索引按钮在**屏幕**上限 maintainer/owner，镜像路由的标准 {#rn-254}

`POST .../rag/reindex` 已经要求 `role:maintainer`（RN-238）——保证者是 api。`ProjectRagTab` 在**客户端**以 `ProjectSettingsTab`/`ProjectApprovalsTab` 对其他
`maintainer` gate 已在使用的相同模式镜像该标准（`useCurrentWorkspaceWithRole`，因为如今客户端没有**项目**角色，只有列表返回的工作区角色）：“立即重新索引”按钮对不是
`owner`/`maintainer` 的人根本不出现，而不是显示为禁用——重新索引会触发对项目仓库和 embedding 提供方的 N 次调用（与并行上限相同的“不经询问就改变产品花费”标准，RN-083），而一个可见却总被拒绝的按钮只会教人忽略 403。

- **位置：** `apps/web/src/routes/ProjectRagTab.tsx`（第 43-44、109 行）
- **测试：** `apps/web/src/routes/ProjectRagTab.test.tsx`——"botão de
  reindexar só aparece para maintainer/owner..."；"maintainer vê e pode
  disparar a reindexação"
- **ADR：** [0082](../adr/0082-chat-rag-aba-de-busca-hibrida.md)

### RN-268 — 终端标签页显示容器的**真实**状态，从不假装一个不存在的终端 {#rn-268}

本战线最初的计划是完整的交互式终端，但调查确认 FASE 25b 仍然被砍掉：没有服务挂载
`/var/run/docker.sock`，即使在 ADR 0081（第 4 波）之后，生产中也没有任何东西转换
`project_containers`。实现一个假装执行命令的终端——或者在 Brabo 单仓库的同一个容器中运行的终端，即 ADR 0055 已经描述为策略而非隔离的那笔债——就是在发明能力，与 ADR 0041/0042 对 LLM 提供方和目录模型已经拒绝的错误相同。

这个标签页**获得**的东西是诚实的：在已有的说明文字下方（FASE
26b），`CodeBottomPanel` 只在终端标签页打开时获取 `GET .../container/lifecycle`（RN-267）（`enabled: aba === 'terminal'`——没有后台轮询，与 RN-107 相同的流量纪律），并用一个 `Badge` 显示状态（`provisioning`/`running`/`stopped`/`failed`/
`removed`，以 pt-BR 显示）、已经持续多久，以及状态为
`failed` 时的 `failureReason`。从未开通的项目——如今的常见情况——显示“ainda não foi provisionado”这句话，从不显示编造的徽章。

- **位置：** `apps/web/src/routes/code/CodeBottomPanel.tsx`、
  `apps/web/src/routes/code/CodeBottomPanel.module.css`、
  `apps/web/src/lib/api-client.ts`（`getContainerLifecycle`）、
  `apps/web/src/lib/api-types.ts`（`CicloDeVidaDoContainer`）
- **测试：** `apps/web/src/routes/code/CodeBottomPanel.test.tsx`
  （describe "Terminal — o estado REAL do ciclo de vida do container"）
- **边界情况：** 交互式终端本身**不**在这里诞生——那是 FASE 25b，它仍然被砍掉，并依赖于容器的物理隔墙（智能体的 worktree 住在里面），而不是这条读取路由。
- **ADR：** [0083](../adr/0083-terminal-mostra-estado-real-do-container.md)

## UX Designer——第五个对话型智能体（RN-285..287，ADR 0087）

### RN-287 — 名册中的 `uxDesignerActive`，在**两个**来源中（RN-090） {#rn-287}

与 `infraActive` 相同的标准：会话中有指向“ux-designer”的 `accepted` handoff。`apps/web/src/lib/agent-status.ts`
（`rosterFactsFromEvents`/`rosterFromFacts`）获得了这项事实，并有条件地把它作为**独立**智能体推入名册——没有对应的 `pushAreaMembers`，因为它不是领域。

RN-090 要求**两个**来源同步（通过事件日志的团队面板；通过在 api 中计算的 `ProjectCardSummary.roster` 的仪表盘卡片），这样新智能体就不会在一处出现而在另一处缺失。这项事实进入了两者：`apps/api/src/infrastructure/persistence/drizzle/projects-summary.repository.ts`
扩展了 `infraActive` 的**同一个**查询（用一个 `inArray(handoffs.toAgent,
['infra', 'ux-designer'])` 取代单个 `eq`，再按 `toAgent` 拆成两个 `Set`）——没有新查询，`projects-summary.repository.spec.ts` 证明的十二个恒定查询的数量没有增长。

- **位置：** `apps/engine/lib/engine/agents/ux_designer_server.ex`、
  `ux_designer_tools.ex`、`ux_designer_supervisor.ex`；
  `apps/engine/lib/engine/harness/agents.ex`（身份）、
  `artifact_schemas.ex`（类型 `prototipo_navegavel`）；
  `apps/engine/lib/engine/application.ex`；
  `apps/engine/lib/engine_web/controllers/agent_command_controller.ex`；
  `apps/web/src/lib/agents.ts`、`agent-status.ts`；
  `apps/api/src/application/ports/projects-summary-repository.port.ts`、
  `apps/api/src/infrastructure/persistence/drizzle/projects-summary.repository.ts`
- **测试：** `apps/engine/test/engine/agents/ux_designer_server_test.exs`、
  `ux_designer_tools_test.exs`；`apps/web/src/lib/agent-status.test.ts`；
  `apps/api/test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  （同一会话中两个 `toAgent` 的 describe）
- **ADR：** [0087](../adr/0087-ux-designer-agente.md)

---

## ADR 0104 第 1 波——`execution_mode` 三个值，工作区由 runner 验证

### RN-428 — 用户故事晋升轮播在事件窗口之外依然存活 {#rn-428}

`promocoesPendentes`/PO 的晋升轮播（RN-148）不再依赖对 `useSessionEvents` 最近 200 个事件窗口的扫描。内容/计数的来源是 `useBacklog`（`Story.proposedReady`，按会话，完整且无窗口）——在长会话中，`backlog.story_promotion_proposed`
会滑出窗口，而用户故事仍然真正待处理，此前轮播会悄悄缩小（或消失）。与 RN-180 已为 `ContextAside` 修正的缺陷同类。

当用户故事不在已加载的 backlog 中时（查询尚未响应），逐个用户故事降级为一贯的窗口扫描。在时间线中的锚定仍然来自窗口内的事件（如果存在）；如果开启这一批的事件已经滑出窗口，轮播会锚定在可见片段的**顶部**而不是消失——从不因为读取截断而隐藏真实状态。

- **位置：** `apps/web/src/routes/SessionPage.tsx`（`useMemo` `timeline`）
- **测试：** `apps/web/src/routes/SessionPage.carrossel-janela-estourada.test.tsx`
- **ADR：** 无——缺陷修正，与 RN-180 已修正的同类
- **来源：** 通过真实使用发现（“o chat falhou em mostrar o carrossel do PO”）

---

### RN-431 — 架构标签页的徽章统计待验证项，从不统计“未生成图表” {#rn-431}

`contagens.arquiteturaPendente`（标签栏）来自
`architecture.pendencies.length`（用户故事↔模块交叉验证的分歧），而不是来自 `c4Diagram.status === 'sem_diagrama'`。标签栏的其他三个计数（`promocoesPendentes`、`aprovacoesPendentes`、
`hipotesesPendentes`）都意味着“有东西在等待**你的**决定”——生成图表是 Arquiteto 的工作，不是用户的决策队列，为此加徽章只会是噪音。

- **位置：** `apps/web/src/routes/ProjectPage.tsx`
- **测试：** `ProjectPage.test.tsx`
- **ADR：** 无
- **来源：** 在把架构标签页从概览中提取出来时做出的设计决定

---

### RN-432 — 语言偏好随登录/刷新的 payload 一起到达，从不额外调用 {#rn-432}

> 由 [RN-891](api.md#rn-891) 修订：该列也接受 `ru` 和 `zh-Hans`，web 的默认值从 `en` 改为 `pt-BR`（ADR 0216）。

界面 i18n 的基础（一个更大计划的第 6a 波——应用其余部分字符串的大规模提取是单独的、并行的步骤）。`users` 中的 `locale` 列（`'pt-BR' | 'en'`，默认 `'pt-BR'`——从不悄悄地翻转已有账户的人）。`EmitirSessaoUseCase` 是签发会话的**唯一**位置（登录、刷新、社交登录）——`locale` 由它嵌入 `/auth/login`/`/auth/refresh` 的响应体，没有额外的往返。`GET/PATCH /users/me/preferences` 作为**冗余**途径存在，让 `AccountPage` 无需等待下一次刷新就能重新确认该值。

`en` 从现在起是应用的**默认**语言（`react-i18next`，新依赖——与 `mermaid`/`@xterm/xterm` 已经遵循的“新依赖需要理由”相同的标准）；`pt-BR` 仍然可用。
`apps/web/src/lib/idioma.ts`（与 `tema.ts` 相同的设计）：**服务器**是事实来源，`localStorage['brabo.locale']` 只是缓存，避免首次绘制时闪现错误的语言。还没有账户的用户只把 `navigator.language` 作为**显示**的建议，在账户存在之前从不持久化任何东西。

- **位置：** `apps/api/src/application/use-cases/auth/emitir-sessao.use-case.ts`、
  `apps/api/src/interfaces/http/iam/user-preferences.controller.ts`、
  `apps/web/src/lib/idioma.ts`、`apps/web/src/lib/i18n.ts`、
  `apps/web/src/routes/AccountPage.tsx`
- **测试：** `apps/web/src/lib/idioma.test.ts`、
  `apps/web/src/routes/AccountPage.test.tsx`、
  `apps/api/test/application/use-cases/auth/*.spec.ts`、
  `apps/api/test/interfaces/route-surface.spec.ts`
- **ADR：** 无——对已有咽喉点的附加扩展，不为不使用新字段的任何人改变会话格式
- **来源：** 产品负责人的请求——界面和文档默认为英文，保留葡萄牙语

---

## Runner 的文件夹浏览器变成三列，`runner` 项目的创建不再等待最后一步（RN-436/436）

产品负责人在测试真实项目的创建后要求的两项变更：(1) 现有的文件夹浏览器
（`FolderBrowserModal`）是一个带面包屑的简单列表，而他发送的视觉参考（一个 GNOME Files/GTK 风格的三列选择器）早已作为现成可改编的设计 handoff 存在；(2) “Procurar
pasta...”在项目的**创建屏幕**上不起作用——只在创建之后才行——因为 Runner 频道的 ticket（ADR 0107）锚定在一个 `projectId` 上，而在这次修正之前，它只在确认时才诞生。

### RN-436 — `FolderBrowserModal` 变成三列的浏览器：快捷方式、单击选择/双击进入的列表，以及详情面板 {#rn-436}

单列表布局在 `Modal size="full"` 中变成三列：快捷方式（个人文件夹，调用 `diretorioInicial()`；根目录，`/`）、带面包屑的中间列表，以及右侧的详情面板。协议
（`FsEntrada`，位于 `apps/web/src/lib/fs-browser-channel.ts`）只有
`{ nome, isDir }`——没有大小也没有修改日期——并且没有被扩展（那会动到 `apps/engine`/`apps/runner`，超出这次交付的范围）；详情面板只显示能在客户端推导的内容：名称、类型，以及当显示的项目是**已打开**的文件夹时的条目计数（从不针对仅被选中的文件夹，那需要再调用一次 runner）。

之前合并在一次单击中（单击就已经进入文件夹）的**两个**手势被分开了：单击现在只**选择**（高亮该项目并更新详情面板），双击才**进入**。最终按钮（“Usar esta pasta”，由“Selecionar esta pasta”改名——`pt-BR`/`en` 的键 `folderBrowserModal.select` 一同修改）在有选中项时使用选中项（`selected.kind === 'dir' ? join(path,
selected.name) : path`），没有时使用当前打开的文件夹。列表不再过滤文件——现在显示整个列表，文件渲染为 `<div aria-disabled>` 而不是
`<button>`：视觉上变淡且没有任何手势，因为只有文件夹仍然可导航/可选择。

- **位置：** `apps/web/src/components/FolderBrowserModal.tsx`、
  `FolderBrowserModal.module.css`、
  `apps/web/src/locales/{pt-BR,en}/terminal.json`
- **测试：** `apps/web/src/components/FolderBrowserModal.test.tsx`——单击选择而不再次调用 `listarDiretorio`；双击导航；文件出现在列表中但无法通过 `getByRole('button')` 访问；“Pasta pessoal”/“Raiz”快捷方式；以及“Usar esta pasta”在有选中项时使用选中项，否则使用打开的文件夹
- **ADR：** 无——在已有组件上的 UI 重新设计，没有协议或数据边界的变化（ADR 0107 继续描述背后的机制）
- **来源：** 产品负责人的请求，在测试真实项目的创建后，觉得文件夹浏览器不太像真正的文件浏览器——他发送的视觉参考（三列选择器，GNOME Files/GTK 风格）

### RN-437 — 在 `runner` 模式下，“Procurar pasta...”**提前**创建项目，最终确认按身份**快照**复用 {#rn-437}

ADR 0107 已在自己的“后果”一节中声明了这一缺口：还没有项目时，频道的 ticket（RN-429）无处锚定，“Procurar pasta...”总是落入“项目存在后可用”的状态——即使在 `runner` 模式下也是如此，而在那里创建**不**依赖于校验磁盘（ADR 0104，第 2 项）。由 [ADR 0108](../adr/0108-projeto-runner-nasce-ao-navegar-pasta-no-wizard.md) 关闭：
`NewProjectWizard.tsx`（`handleProcurarPasta`）在 `modoDeWorkspace === 'runner'` 时点击“Procurar pasta...”就调用 `createProject`——使用已输入的路径，或在字段仍为空时使用一个词法有效且明显临时的占位符（`/workspace-a-confirmar`），从不阻止点击。`mounted` 模式**不变**：在确认之前继续使用 `projectId={null}`，因为在那里磁盘校验在创建时运行，用空路径提前创建会在用户甚至还没想到路径的时刻返回 RN-422 的拒绝。

一个身份**快照**（`{ name, externalId, adotando }`——从不包括
`caminhoLocal`，对它的细化正是浏览的**目的**）决定何时复用：身份不变时再次点击“Procurar pasta...”会以**同一个**项目重新打开弹窗，不会创建另一个；更改名称（或返回并更换要采用的仓库）会使快照失效，下一次浏览会创建一个新项目。`handleConfirm` 应用同样的标准——快照仍然一致时复用浏览时已创建的项目，只有在没有可复用的东西时才调用 `createProject`。`montarPayloadDeCriacao` 是从之前只存在于 `handleConfirm` 内部的代码中提取出的纯函数，被两条路径复用。

按钮的前提在点击**之前**说明（AT-214）：在这个模式下列表来自本地智能体，所以没有一个正在运行并连接到刚创建项目的 `brabo-runner`，弹窗只能显示等待和引导。屏幕改为在字段下方以**文本**说明这一点（`aviso-procurar-runner`，ADR 0064——从不用提示框），附上命令
`brabo-runner --project <id> --dir <pasta>`，以及不依赖任何东西的替代方案：在字段中输入路径，runner 连接时会确认它。机制（提前创建、经由本地智能体的传输）没有改变。

- **位置：** `apps/web/src/routes/NewProjectWizard.tsx`
  （`handleProcurarPasta`、`handleConfirm`、`montarPayloadDeCriacao`、
  `snapshotDeIdentidade`/`mesmaIdentidade`）
- **测试：** `apps/web/src/routes/NewProjectWizard.test.tsx`，describe
  `navegação de pasta antecipada no modo Runner`——创建项目并以真实 id 打开弹窗；字段为空时使用占位符；什么都不改再次点击不会创建另一个；更改名称使快照失效并创建不同的项目；`handleConfirm` 复用而不是复制。已有的测试“'Procurar pasta...' mostra o estado declarado”（`mounted` 模式）保持通过，未作修改——证明范围没有外溢
- **ADR：** [0108](../adr/0108-projeto-runner-nasce-ao-navegar-pasta-no-wizard.md)
  ——结构性变化（在创建流程中项目**何时**开始存在），附带被接受的副作用：向导未完成就关闭时会留下“未开通”的孤立项目（与如今任何中断的创建已经产生的状态**相同**，不是新的回归）
- **来源：** 产品负责人的请求，他在 Runner 模式下测试真实项目的创建，无法在确认前浏览文件夹——这正是 ADR 0107 已声明并推迟的缺口

### RN-438 — `fs-browser-channel.ts` 有与 RN-433 已在姊妹模块 `terminal-channel.ts` 中修正的**相同**的路径重复缺陷 {#rn-438}

在 Chrome 中针对真实 engine 端到端验证 RN-437 时发现：弹窗以正确的 `projectId` 打开，但连接立即断开，显示“A
conexão com o runner caiu — feche e reabra para tentar de novo.”，而不是显示 `RunnerOnboardingPanel`。`apps/web/src/lib/fs-browser-channel.ts`
把 `'/runner/websocket'` 拼接到一个 api 已经返回**完整**的 `engineWsUrl` 上（`ws://host:porta/runner`，来自 `engineWsUrlPublico()`）——`phoenix.js` 的同一个 `Socket` 还会在构造函数中自行追加 `/websocket`，结果以 `GET
/runner/runner/websocket/websocket` 打到 engine，被 `Phoenix.Router.NoRouteError`
拒绝。这**恰恰**是 RN-433 的第 3 项，只是在**姊妹**模块中——那里的修正从未在这里复制，也没有任何测试套件发现，因为这个模块直到现在都没有任何测试（它自己的 docblock 错误地说 `terminal-channel.test.ts`“间接”覆盖了它）。修复：与 RN-433 同样的一行——`engineWsUrl.replace(/^http/, 'ws')`，不拼接任何路径。

针对一个真实的 `runner` 项目**端到端**验证（owner 已登录，
`teste-navegacao`，由 RN-437 创建）：修正之前，弹窗直接落入连接错误；修正之后，在不到 2 秒内显示带有命令 `brabo-runner --project <id-real> --dir <pasta>` 的 `RunnerOnboardingPanel`——这是没有真实 runner 连接时的预期结果。

- **位置：** `apps/web/src/lib/fs-browser-channel.ts`
- **测试：** `apps/web/src/lib/fs-browser-channel.test.ts`（新增——在这次修正之前该模块没有任何自己的测试）。正常路径确认 `socket.url === engineWsUrl`，没有拼接；另外还有
  `diretorioInicial`/`listarDiretorio` 往返、获取 ticket 失败，以及幂等的 `fechar()`
- **ADR：** 无——恢复 ADR 0103/0107 和 RN-433 早已声明为意图的行为，只是在之前的修正没有触及的模块中
- **来源：** 针对 Chrome 和真实 engine 手动测试 RN-437（`runner` 项目的提前创建）时发现——这是 `FolderBrowserModal` 第一次针对真实连接被端到端地使用，因为在这次交付之前，“Procurar pasta...”在确认前从未到达过真实项目

## 附加的本地文件夹成为 RAG 索引的第四个范围，由**浏览器**读取（RN-455..457，ADR 0113）

### RN-456 — 聚合上限**拒绝**（400）整个上传；过大/二进制的单个文件只被**跳过** {#rn-456}

与 `docs`/`adr`（后台扫描，没人在看）不同，附加文件夹是屏幕上带文件夹选择器的**一次性**动作。当文件数量（`RAG_LOCAL_FILE_COUNT_LIMIT`，500）或总字节数（`RAG_LOCAL_TOTAL_BYTES_LIMIT`，8 MiB）超出时，`IndexLocalFolderUseCase` 拒绝（400）整批——从不静默截断，因为点击“附加”的人可以选择一个更小的文件夹。单个过大的文件（`RAG_LOCAL_FILE_BYTES_LIMIT`，512 KiB）或扩展名不被识别的文件（`RAG_LOCAL_ALLOWED_EXTENSIONS`，允许列表）只被**跳过**（`filesSkipped`），从不让整批失败——与 `IndexProjectDocsUseCase` 只筛选 `.md` 时已隐含的区分相同。含 `..` 或开头斜杠的路径被**拒绝**（400），从不静默接受，与从不信任来自客户端的路径（RN-092/095）相同的纪律，即使它“本不应”包含这些。`apps/web/src/lib/rag-local-limits.ts` 在客户端镜像相同的数字，只作为 UX 便利（发送前的摘要）——真正保证的是服务器。

- **位置：** `apps/api/src/domain/rag/rag-search-limits.ts`（`RAG_LOCAL_*`）、
  `apps/api/src/application/use-cases/rag/index-local-folder.use-case.ts`
- **测试：** `apps/api/test/application/use-cases/rag/index-local-folder.use-case.spec.ts`
  （数量和总字节上限拒绝；过大/二进制文件被跳过；含 `..`/开头斜杠的路径被拒绝）
- **ADR：** [0113](../adr/0113-pasta-local-anexada-via-navegador-vira-chunks-scope-local.md)
- **来源：** 产品负责人的请求

### RN-460 — 轮次活动条实时叙述，线程只在结束时收到回复 {#rn-460}

会话屏幕在输入框**上方**显示一条用人类语言叙述对话型智能体（Criativo、PO、Arquiteto、Dev Lead、UX Designer、Staff）在轮次**期间**正在做什么的条带——视觉参考：Claude Code 的状态行。线程只在轮次结束**之后**才收到回复气泡；该规则属于**聊天**（Phoenix 频道），只适用于这六个对话型智能体——没有活动智能体的咨询型聊天（SSE，`streamChatMessage`）保持一贯的流式气泡，不作改动。（自 [RN-682](api.md#rn-682) 起，屏幕不再调用这个 SSE：没有智能体的咨询型会话在发送前先请求一个智能体。）

**机制（engine）**：六个 server 早已在事件日志中发出**持久**的 `tool.call`；现在还会紧接着执行 `broadcast(state, "tool.call", %{tool:
name, agent: @agent})`——**临时**的，没有 `args`（从不发送原始 payload，与 RN-096/RN-412 相同的标准）——让 `session:<id>` 频道实时投递。六个
`dispatch_tool` 之间没有共享的 behaviour/宏（完整阅读确认了四种不同的结构形式）：这一变更是根据每个的本地形式做的六处改编编辑。

**机制（web）**：一个**纯** reducer
（`reduzirAtividadeDoTurno`/`lib/atividade-do-turno.ts`）把 `agent.delta` 的文本累积为“当前”；当频道的 `tool.call` 到达时，把非空的当前文本归档为一条**叙述**行，清零，并**总是**添加一条带 `fraseDaFerramenta(tool)` 的**工具**行（六个智能体 19 个工具的字典，`lib/narracao-de-ferramentas.ts`，没有自己的 RN——它只为这条规则存在）——两次之间没有增量的连续调用变成两条独立的行，从不合为一条。轮次结束时重置（`finalizarTurnoDoAgente`，**唯一**的重置点）。`turnoViaCanal`
是一个**独立**的标志（从不从 `statusAgent`/`streamingAgent` 推导，它们在轮次中途会合法地经过 `null` 的窗口），决定显示条带**还是**旧气泡——从不两者都显示。

**展示规则（历史）**：`agruparNarracoesDoTurno`，一个新的纯处理步骤，在同一个 `useMemo` 中于 `afundarDesfechos`（RN-172）**之后**运行——在同一个 `turno`+`autor` 内，连续的 `agent.response` 变成一个紧凑的 `Disclosure`（“Passos do turno · N”），只让最后一条保持完整并留在外面。`turno === 0`（`turnoDoSeq` 的哨兵序言）被有意排除在分组**之外**——它不是真正的轮次，而旧的测试夹具为了测试另一种机制堆叠了没有轮次边界的 `agent.response`（RN-138/RN-177）。该函数与智能体无关（只读取 `turno`/`autor`），`afundarDesfechos` 本身不变。

- **位置：** `apps/engine/lib/engine/agents/{po,criativo,arquiteto,
  dev_lead,ux_designer,staff}_server.ex`（`tool.call` 的广播）；
  `apps/web/src/lib/atividade-do-turno.ts`（reducer）；
  `apps/web/src/components/TurnActivityStrip.tsx`（组件）；
  `apps/web/src/lib/session-channel.ts:54`（`onToolCall`）；
  `apps/web/src/routes/session-fio.tsx:48`（`agruparNarracoesDoTurno`）、
  `apps/web/src/routes/SessionPage.tsx:197`（`turnoViaCanal`）
- **测试：** `apps/web/src/lib/atividade-do-turno.test.ts`、
  `apps/web/src/components/TurnActivityStrip.test.tsx`、
  `apps/web/src/lib/session-channel.test.ts`、
  `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
  （`agruparNarracoesDoTurno`）、`apps/engine/test/engine/agents/
  *_server_test.exs` 套件（不带原始 args 的 `tool.call` 广播）
- **来源：** 产品负责人的请求

## “需要你”面板（RN-467）

### RN-467 — 五个决策队列的面板**从不**求和，也**从不**执行：按队列分开并引导到决定 {#rn-467}

项目顶部的“需要你”标签打开一个面板，其中包含项目的**五个**决策队列——操作审批、PR 合并、用户故事晋升、架构待处理项和 Psicólogo 的假设。两项保证定义了它，而两者都不是审美问题：

**从不求和。** 每个队列都有**自己**的标题和计数，项目总数在任何地方都不存在：面板中没有，打开它的标签中也没有——标签宣告的是**存在**（一个点，`temAlgoEsperando`，按签名是布尔值），从不是数量。这与早已让标签栏的五个计数器保持分开的产品决定相同（ADR 0126）：求和会抹去**哪个**队列在请求注意，而这正是打开面板的人要问的问题。`montarFilas`
按声明的紧急顺序（`ORDEM_DAS_FILAS`）返回这五个队列，并且不导出求总数的函数——这种缺失本身就是机制，而不是遗忘。

唯一存在的去重是按**身份**，从不在队列之间：同一个 `git_merge` 的 `proposed_action` 通过两个 hook 到达（`usePendingActions` 属于会话且不按类型筛选；`useProjectPendingActions` 是项目范围的），会在同一列表中以两个标题出现两次。它留在更具体的组（`prs`）中。

**从不执行。** 面板中两个可操作的队列（`aprovacoes`、`prs`）渲染与审批标签页**相同**的 `ApprovalCard`（自 AT-322 起只有一个变体，细节折叠），按钮调用相同的决策端点——面板是通往决定的**捷径**，从不是决定的替代品。这对
`git_merge` 尤为重要：合并到受保护分支会被**无条件**降级为 `require_approval`（`apps/api/src/domain/actions/decide.ts`），这个上限 `agent_autonomy` 和 `permissions.json` 都无法提升，而面板中没有任何东西触碰这条路径。两个卡片中都有意**省略** `onActivateAutoMode`：开启“auto mode”（RN-153）是改变智能体的**策略**，而不是决定眼前的操作——想这样做的人在审批标签页中决定，那里已经检查工作区角色。其他三个队列在其上下文之外没有决策卡片，因此**引向**决定所在的标签页。

**架构待处理项没有自己的日期**——任何字段中都没有（`ArchitecturePendency`）：它是用户故事与 `module_map` 交叉产生的**派生**视图，每次读取时重新计算，从不写入。面板**借用**相关用户故事的日期并**说明**是借来的（“história
atualizada há 18 min”，`dataEmprestada`）；已加载的 backlog 中没有该用户故事时，显示“sem data”并把该项排在队列**末尾**。任何情况下都不会编造时刻：渲染“现在”会让屏幕上最紧急的那一行恰恰是了解最少的，而没有任何东西揭露这个谎言。在 api 中增加列和迁移会真正解决问题，那是单独的决定，不在本条范围内。

- **位置：** `apps/web/src/lib/precisa-de-voce.ts:108`（`ORDEM_DAS_FILAS`）、
  `:117`（`FILAS_ACIONAVEIS`）、`:139`（`montarFilas`——按身份去重和借用日期）、`:245`（`temAlgoEsperando`）；
  `apps/web/src/components/PainelPrecisaDeVoce.tsx:246-248`（`role="dialog"`、
  `aria-modal`、标签）和 `:279-284`（按队列分组，带各自的计数）；
  `apps/web/src/routes/ProjectPage.tsx:120`（从标签栏计数器已在使用的五个 hook 组装队列）
- **测试：** `apps/web/src/lib/precisa-de-voce.test.ts`（五个分开的队列及各自的条目；没有求和，也没有求总数的函数；重复的 `git_merge` 只出现一次，在 PR 队列中；按等待最久排序；借用的日期有标记，缺失时变为 `null` 并排到末尾）、
  `apps/web/src/components/PainelPrecisaDeVoce.test.tsx`（五个标题，各带队列计数；总数在任何地方都不出现；空状态有自己的句子；`ApprovalCard` 按操作**本身**的会话决定；不提供“Modo
  automático”；没有日期的架构行渲染而不崩溃；`Esc`、点击外部、焦点和 `aria-expanded`）
- **来源：** 产品负责人的设计评审（UI 改进画布的第 3 项）

## 屏幕上的环境状态（RN-468）

### RN-468 — 环境信号说出它**知道**的：`workspaceVerifiedAt` 是确认的记录，从不是 runner 活着的保证 {#rn-468}

产品在两个地方显示环境状态，每个地方的切分就是规则：**登录**屏幕只显示**没有**身份时为真的东西，而**项目概览**显示只有**有**身份时才为真的东西。

**登录前，切分由数据的范围强加，而不是审美选择。** 剩下的是两个 `/health`——在两个服务中有意公开（api 中的 `@Public()`；`router.ex` 中的“Sem auth de propósito”），与
`StatusPage` 在没有会话时已经消费的相同。runner 的存在以 `{user_id, project_id}`（`runner_device_keys`）为键，模型列表是带 `viewer` 角色的
`projects/:projectId/models`：登录之前，这两个主体都不存在，因此屏幕**声明缺失**（“Runner e
modelos locais dependem da sua conta e de um projeto”），而不是省略它——省略会让平台看起来不具备它所拥有的东西。两个 `/health` 保持**三种**状态分开（RN-088 应用于环境信号）：
`verificando…` 不是 `sem resposta`，两者都不是 `respondendo`。探测有**上限**（6 秒）：一个接受连接却从不响应的 api 会让这一行永远停在“verificando…”，这在半秒内是诚实的，十秒之后就是因遗漏而撒谎。

**而表单从不等待探测。** 状态是该区块本地的，而该区块是卡片的**兄弟**——api 宕机只改变一段文本，不会延迟或隐藏登录的任何一个像素。这恰恰在 api 宕机的那一刻很重要，那时最需要屏幕至少能**打开**。

**登录后，规则关于数据**不**断言什么。** runner 信号来自
`projects.workspace_verified_at`——`ConfirmProjectWorkspaceUseCase`
在 runner 连接并确认文件夹时写入的时间戳（RN-423），也是 engine 用作门槛的**同一个**字段（`TerminalExecutor` 拒绝在该字段为空的
`runner` 项目中执行命令）。它**不是心跳**，原因有两个，彼此独立：没有被观察的进程，而且**重新连接时报告相同路径不会重写时间戳**（用例的明确决定），所以连日期都不是“runner 最后一次出现的时间”。屏幕说“pasta
confirmada em `<data>`”并附上它不是什么的说明，**从不**说“在运行”“在线”，也不用绿点——色调是 `neutro`，那里的绿色会被读成数据无法支撑的活跃度保证。知道**此刻**情况的是 Code 标签页中的终端 socket（`TerminalPanel`/`RunnerOnboardingPanel`），说明指向那里。与 RN-467 借用用户故事 `updatedAt` 时相同的纪律。

runner 那一行只在 `runner` 模式的项目中存在：在另外两种模式中，该字段按定义为空（模式转换会清零它，RN-450），在那里显示“从未确认”的一行就是编造的缺失。

- **位置：** `apps/web/src/components/SinaisDoAmbiente.tsx:72`（`useSaude`——带上限的探测和对连接拒绝的 `.catch`）、`:133`
  （`SinaisDoAmbiente`，登录前的区块）；
  `apps/web/src/components/AmbienteDoProjeto.tsx:92`（`AmbienteDoProjeto`）、
  `:102`（runner 行，只在 `runner` 模式下，色调 `neutro` 并带说明）；
  `apps/web/src/routes/AuthLayout.tsx:46`（`colunaDeIdentidade`——那里没有可聚焦的东西，否则 `Tab` 的第一站就不再是邮箱字段）；
  `apps/api/src/application/use-cases/iam/confirm-project-workspace.use-case.ts:93`
  （路径不变时**不**重写时间戳——这就是日期不代表新近度的原因）
- **测试：** `apps/web/src/components/SinaisDoAmbiente.test.tsx`（三种不同的状态；连接拒绝变成“sem resposta”而不是沉默；非 OK 响应同上；挂起探测的上限；没有可聚焦元素；runner/模型的缺失被声明）、
  `apps/web/src/components/AmbienteDoProjeto.test.tsx`（`runner` 模式之外没有 runner 行；已确认时要求有说明，且区块不包含
  `de pé|online|conectado agora`；从未确认时教授路径；本地模型计数的单数、复数和零；复用的查询键）、`apps/web/src/routes/LoginPage.ambiente.test.tsx`（探测拒绝**以及**探测挂起时，表单都能渲染和提交；只有一个 `<h1>`；版本仍然只有一个来源）
- **来源：** 产品负责人的设计评审（UI 改进画布的第 6 项）

### RN-469 — 保存一个小节就是 N 次调用，屏幕从不断言它没有得到的结果 {#rn-469}

在“配置”中那些行是按键的**标量**调整的小节里（`Paralelismo por área` 和 `Teto de gasto por área`，两者都按 `agent_areas`），保存按钮只有**一个**，属于小节，而不是每行一个。保存会触发**每个脏行一次调用**——`PUT .../areas/:key/max-parallel` 和
`.../budget` 是按**领域**的端点，不存在“写入这 N 个上限”的事务性端点，本产品**也没有发明一个**。后果是一次点击的结果可能是部分的，而规则关乎屏幕那时能说什么。

**调用是**串行**的，按屏幕顺序，一次失败不会中断后续调用。** 串行是因为失败报告要点名各行，需要按人看到它们的顺序输出。不中断是因为点击的人请求了全部 N 个：在第一次拒绝时中止会让一些行根本没有被尝试，屏幕将无法区分“api 拒绝了”和“根本没尝试”。

**结果是按**行**的，UI 显示的就是它。** 只有 api **确认**了的草稿才被丢弃；失败的仍留在字段中，保留人输入的内容，该小节仍然恰好因这些行被标记为未保存——再次点击保存只会重试它们。三种结果彼此不同，没有一种伪装成另一种：全部通过 → 成功；**一个都**没通过 → API 给出的消息，从不是计数；**部分**通过 → 提示说出多少中的多少，并**点名**留下的那些。在第三种情况下，“已保存”和“未保存”都会是谎言，而这条 RN 存在正是为了保护它。

**小节在点击之前声明有**多少**行待处理。** 每个小节一个按钮，无论有一个脏行还是五个，都同样写着“保存”；计数（“2 alterações não salvas nesta seção”）是把 N 个按钮换成一个的代价。“脏”是按**解释后的值**比较，而不是按文本：`20` 和 `20.0` 是同一个上限，比较字符串会发出一个 api 视为空操作的调用。无效的草稿算作脏，并**取代**计数显示解释阻塞原因的消息——对同一集合给出两个数字是噪音，而有无效值的人需要知道是什么锁住了按钮。

**规则在哪里**不**适用，以及原因。** 控件为**具名**值选择的小节（`Promoção de história`、`Modelos por agente`、`Modelo por área`、
`Membros` 中的角色）在 `onChange` 时保存，没有按钮，并保持如此：确认是为**输入**的字段而存在的，在那里每按一个键就保存，会在通往 `12` 的路上发出 `1`。这句话衡量的是值属于谁：它适用于写入**自身**值的控件，而不涵盖一个其值是对其他行操作的**参数**的选择器——见
[RN-476](#rn-476)，它是例外并说明了原因。而 `Credenciais` 尽管也有按键的 `drafts`，仍保持每行一个按钮：凭据是只写的（ADR 0050），从不从服务器返回，因此没有可供比较以判断“脏”的值；该行的按钮根据该提供方是否已有密钥在“保存”和“更换”之间切换；它与“测试”和“删除”共享卡片，而这两者不可约地属于该行。

- **位置：** `apps/web/src/routes/settings/secao-salvavel.tsx:105`
  （`useSecaoSalvavel`——串行循环、按行的结果和三种 toast）、
  `:130`（按解释后的值判断脏）、`:241`（`MarcaDeNaoSalvo`——计数，以及无效值取代它）、
  `apps/web/src/routes/settings/ParallelismSection.tsx:31`、
  `apps/web/src/routes/settings/BudgetSection.tsx:37`（两个消费者）、
  `apps/web/src/routes/settings/CredentialsSection.tsx:57`（为什么这个小节被排除在外）
- **测试：** `apps/web/src/routes/settings/secao-salvavel.test.tsx`（脏行计数；回到服务器的值会清除标记；无效值取代计数并锁住按钮；一次点击持久化所有脏行；同一批中的数字和 `null`；部分失败说出多少中的多少并点名留下的；小节仍因失败的行被标记；第二次点击只重试它们；一次失败不中断后续；一个都没通过时显示 API 的消息而不是计数）
- **来源：** 产品负责人的设计评审（UI 改进画布的第 7 项——“salvar por seção em vez de por linha”）

### RN-470 — 模型来源区分自有 binding 与从 Criativo 继承，级联中的空值不与其他空值共用同一符号 {#rn-470}

api 响应中的 `origin: 'agent'` 意味着**两件不同的事**，而 api 不区分它们是正确的：agent 在 `model_bindings` 中有一行 `agent` 范围的记录，**或者**级联落在 `workspace` 上而
[`herdarModeloDeStart`](api.md#rn-102) 把值换成了 Criativo 的模型——读"来自哪里"的人需要看到它来自一个 *AGENT*，而不是来自一个数据库中不存在的范围。必须区分它们的是**界面**，而在此之前它没有区分：来源列打印原始枚举，在一个数据库中有 3 行 `agent` 的项目里，12 个 agent 都显示同一个词 `agent`。

**来源是一条*链*，而不是一个词。** `workspace › projeto › área ›
agente`，每个节点四种状态，四种都存在是因为它们说的是不同的事：**现行**（使用中的模型从这里来——唯一以 `Badge` 显示的节点）、**已定义**（这一层有自己的值，但一个更具体的层胜出了）、**空**（这里没有值）和**被跳过**（有值，但级联因 `unavailable`/`sem_tool_calling` 丢弃了它，[RN-043](api.md#rn-043)）。把"已定义"折叠成"空"会把原始枚举的问题带回低一层。

**在继承中，`agente` 节点保持为*空*，一个额外节点点名 Criativo。** 级联到达的层级（`workspace`）显示为"已定义"，而**不是**现行：workspace 的模型不是生效的那个，把它标为现行就是断言了错误的模型。Criativo 的节点是唯一一个不是数据库范围的节点，这是刻意的——它点名的是级联之后的那一步。同一条链也适用于*区域*部分，在那里 `origin: 'agent'` **只能**是这一步：区域查询不会把 agent 范围放进级联。

**推导属于*客户端*，它无法证明的东西仍然可以操作。** 没有新端点：界面已经获取了四个层级。当工作区之上没有任何层级有*可用*的值（被跳过的不会阻止下降）并且模型与解析出的 Criativo 模型相同时，`agent` 就是继承。剩下一个无法区分的情形：agent 有自己的行，指向与 Criativo 相同的模型，且没有区域或项目默认值。这就是为什么"恢复继承"在每个 `agent` 来源上都继续显示——动作恰恰在链无法证明的情形中保持可用，而在那种情形下它仍然会改变未来（没有这一行，agent 开始跟随 Criativo）。

**这个选择的另一半：404 有自己的结果。** 在每个 `agent` 来源上保留按钮，意味着*也*在没有行可删的地方提供它——在那里 `ClearModelBindingUseCase` 正确地响应 **404**（"删除了不存在的东西"和"删除了"不是同一个回答；把它们折叠起来会隐藏一个错误的 `agentSlug`）。然而对点击的人来说，这个 404 不是失败：所请求的状态——agent 在继承——**已经是事实**，把它称为错误就是界面与它所知道的东西相矛盾。因此它不像其他拒绝那样经过 `mensagemDaApi`，有两个原因：api 的句子是硬编码在代码中的 pt-BR，而 web 的默认语言是 `en`；并且这个端点只有**一个** 404 原因（角色不足是 `RolesGuard` 中的 403，格式错误的 `scope_id` 不是 404）——客户端*知道*这个 404 意味着什么，可以用读者的语言说出来。任何其他状态仍然是真正的失败，带 api 的句子和 `danger` 色调。在**两种**结果中都会重新读取该行：如果 api 说本来就没有 binding，过时的是界面。

**而自己的结果属于*端点*，而不是界面。** 同一行的另一个动作——通过现行模型列的 `ModelPicker` 更换模型——有七条拒绝路径，**没有任何一个状态能单独识别其中之一**（`SetModelBindingUseCase`）：格式错误的 `scope_id` 或 DTO 拒绝的 `modelId` 是 400，低于 `developer` 的角色是 403，**两个无法区分的原因是 404**（"Modelo não encontrado" 和 "Projeto não encontrado"），三个原因是 422（[RN-040](api.md#rn-040) 没有 tool calling；[RN-043](api.md#rn-043) 在 workspace 中被停用或从提供方消失）。在那里客户端*不能*点名 404——选择两句中的一句，就是界面断言它不知道的东西——因此每次拒绝都遵循正常语法，带 api 的句子和 `danger` 色调。这两个函数相邻，刻意以相反的方式处理同一个状态：授权自己结果的是*唯一*的原因，而不是界面。

**在拒绝时，现行模型列继续显示已确认的 binding。** `ModelPicker` 不在本地状态中保存选择（`selected` 来自 `selectedModelId` prop，它来自查询），因此拒绝不会在界面上留下 api 拒绝写入的模型——而该行只在成功时重新读取，因为拒绝时数据库中什么都没变。这是把这条 RN 的同一纪律应用于时间：界面不断言一个不存在的状态，不靠短横线，不靠枚举，也不靠乐观。

**空值有自己的文本，不同的空值有不同的文本。** 界面上的三个 `—` 用同一个符号说三件事，现在各说各的：`sem modelo em nenhum nível`（没有任何层级为该 agent 设置 binding）、`sem gasto ainda`（agent 没有记录消耗——不同于 `US$ 0,00`，那是免费运行过）以及 `sem padrão em nenhum nível`（区域及其上面的两层都为空）。与
[RN-180](#rn-180) 同一纪律：界面不用一条短横线断言它无法点名的东西。

- **位置：** `apps/web/src/routes/settings/cascata.tsx:119`（`montarCadeia`——四种状态和 Criativo 的节点），`:178`（`herdouDoCriativo`——推导及其限制），`:287`（`CadeiaDeCascata`），
  `apps/web/src/routes/settings/ModelsSection.tsx:149`（`cadeiaDoAgente`），
  `:329`（`handleModelChange`——为什么这里的 404 *没有*自己的结果，以及为什么该行只在成功时重新读取），`:385`（`handleClearAgentBinding`——三种结果，以及为什么 404 有它自己的），`:359`（来源列），`:429`
  （`não há nível abaixo`），`:448`（`sem gasto ainda`），
  `apps/web/src/components/ModelPicker.tsx:95`（`selected` 来自 prop——选择器不保存选择，这就是拒绝不会在界面上留下幽灵值的原因），
  `apps/api/src/application/use-cases/llm/set-model-binding.use-case.ts:38`
  （这个端点的两个 404 原因——这个文件*没有*改变），
  `apps/api/src/interfaces/http/shared/llm-binding-error.filter.ts:39`
  （策展拒绝的 400/422——这个文件*没有*改变），
  `apps/web/src/routes/settings/ModelsSection.tsx`（区域的链），
  `apps/api/src/application/use-cases/llm/clear-model-binding.use-case.ts:25`
  （api 抛出的 404——这个文件*没有*改变），
  `apps/api/src/domain/llm/binding-resolver.ts:140`（api 返回的 `origin: 'agent'`，以及解释它为何正确的注释——这个文件*没有*改变）
- **测试：** `apps/web/src/routes/settings/cascata.test.tsx`（自有 binding 结束于 `agente` 节点；继承让 `agente` 为空并点名 Criativo；workspace 在继承中从不显示为现行；区域部分同样；区分在 `en` 下保留；被丢弃的层级成为划线节点，竞争的徽章消失；三种空值三段文本；作为纯函数的 `montarCadeia` 和
  `herdouDoCriativo`，包括被*丢弃*的区域默认值不会阻止下降的情形），
  `apps/web/src/routes/settings/voltar-a-herdar.test.tsx`（点击的三种结果：删除并重新读取；404 不是错误，即使在 `en` 下也不转达 api 的 pt-BR 句子，并重新读取，因为过时的是界面；其他状态走 `mensagemDaApi` 且不重新读取），
  `apps/web/src/routes/settings/troca-de-modelo.test.tsx`（同一行的另一个动作：写入并重新读取；`unavailable` 模型的 422——可达的情形，因为选择器会显示带标记的不可用模型——走 `mensagemDaApi` 且不重新读取；现行模型列保持在旧模型上，绝不显示被拒绝的；而 404 *没有*自己的结果，这是与姊妹函数的对照）
- **来源：** 产品所有者的设计评审（UI 改进画布的第 9 项——"cascata de modelo como cadeia visível"）

## 成员小节尊重角色，而角色是项目的**有效**角色（RN-471）

### RN-471 — 成员小节中的角色：`maintainer`，并由项目行覆盖工作区行推导而来 {#rn-471}

`MembersSection` 过去不检查任何角色。该小节的**三个**操作——邀请、更改某人的角色和移除——对所有人都显示为可用，包括 `viewer`，而 api 以 403 拒绝。其中两个甚至不会说出来：`handleRoleChange` 和 `handleRemove` 没有 `try/catch`，而且是从 `onChange`/`onClick` 调用的，所以每次拒绝都变成 `unhandled promise rejection`——屏幕上沉默，控制台中噪音，与 [RN-102](api.md#rn-102) 在模型表中关闭的缺陷同类。静默地移除成员是三者中最糟的：这是有后果的操作，无法在屏幕上撤回，因为恢复需要被移除的那一行带走的 UUID。

**最低是 `maintainer`，并且是**端点**的。** 三条路径要求相同的角色（`projects.controller.ts`），而 `GET` 要求 `viewer`——因此不能编辑的人仍能看到整张表：

| 操作 | 端点 | 角色 |
|---|---|---|
| 邀请 | `POST :projectId/members` | `maintainer` |
| 更改角色 | `POST :projectId/members`（upsert） | `maintainer` |
| 移除 | `DELETE :projectId/members/:userId` | `maintainer` |
| 查看表格 | `GET :projectId/members` | `viewer` |

照抄模型小节的门槛（`developer`，在那里是正确的）会在这里向 api 拒绝的人提供三个控件。这是连续**第二个**最低要求与相邻小节不同的小节：标准仍然是端点，从不是旁边的屏幕。

**角色是**项目**的**有效**角色——这**关闭**了 RN-102 声明的缺口，而不是重复它。** 在那里，屏幕读取**工作区**角色，而授权者是
`ResolveEffectiveRoleUseCase.forProject`，关闭它需要一个 web 没有的按项目的角色查询。这里是从另一侧看到的**同一个**缺口：这个小节**已经**做了这个查询。`listProjectMembers` 就是对所有人一次性执行的 `findMemberRole`，而 `userIdDaSessao()`（access token 的 `sub`）说明哪一行属于正在查看的人。组合字面上就是用例的组合——`projectRole ?? workspaceRole`——而不是只在这个屏幕上发明的第二个角色来源。在列表到达之前，角色是**缺失**的，而不是工作区的：没有它就无法知道是否存在自己的行，而往禁用一侧出错，重新加载即可修复。

**覆盖在**两个**方向上都成立，而有**四个**地方说的是相反的。**
`forProject` 在 `project_members` 的行存在时返回该行，不与工作区比较。所以在这里设置 `viewer` 确实会降级——即使是工作区的 `owner`，之后只能由拥有 `maintainer` 的人恢复。代码从未做过相反的事，`resolve-effective-role.use-case.spec.ts` 本身也固定了这一点（"papel de projeto sobrepõe o de workspace"）。错误的承诺所在之处：

| 位置 | 说了什么 | 状态 |
|---|---|---|
| `POST :projectId/members` 的描述 | "the EFFECTIVE role is the higher of this one and what the person already has in the workspace"；"associating someone as `viewer` here doesn't downgrade a workspace `owner`" | **未修正**——这是 api 的变更 |
| `AddMemberDto.role` 的描述 | 同样的 "higher of" 句子 | **未修正**——这是 api 的变更 |
| `GET :projectId/members` 的摘要 | "with their effective role"；"includes whoever inherits access from the workspace" | **未修正**——这是 api 的变更 |
| `apps/web/src/lib/roles.ts:3` | “Papel efetivo nunca é rebaixado” | **在此修正** |

api 的三处被声明而不顺手改动：这些描述会传播到 `api-types.generated.ts`。web 的那一处比另外三处**更糟**，因此一并修正——api 的至少位于 OpenAPI 描述中，而这一处位于导出 `roleAtLeast` 和 `ROLE_ORDER` 的模块中，也就是说，在这一类修正的下一个人会打开和编辑的代码中，会在任何其他东西之前先读到错误的规则。同一行声明的线性层级仍然有效——它是 `roleAtLeast` 比较的顺序，没有改变。屏幕则**说出**什么有效，而不是让 `Select` 被读作无害的建议。

**去掉的是**控件**，从不是**信息**（ADR 0064）。没有 `maintainer` 的人仍然在变淡的 `Select` 本身中读到每个成员的角色——这是表格的核心信息，换成文本会把状态和操作一起藏起来。原因在说明中以文本说**一次**：`disabled` 元素上的 `title` 在 Chromium 中不会打开，而每个成员一行会把一个关于**查看者**的事实重复在列表中每个人的上方。

**表格是一个**切片**，并且声明了这一点（[RN-180](#rn-180)）。** `listMembers` 是对 `project_members` 的
`innerJoin`：只通过工作区接触到项目的人不会出现在任何一行中，尽管 `GET` 的摘要承诺 "includes whoever
inherits access from the workspace"。这项数据**不**在客户端的能力范围内——web 没有任何查询会列出带角色的工作区成员——因此说明会说列表有所省略，而不是让它被读作“所有有访问权限的人”。这是剩下的缺口，它被声明，而没有被处理。

**这些都不是安全边界：** 拒绝者仍然是
`RolesGuard`。

**邀请保留固定提示，这是一个决定。** 另外两个操作使用
`mensagemDaApi`，因为它们的 `userId` 来自列表且确实存在——剩下的是 403 和网络错误，而 api 的句子是最有用的信息。在邀请中，`userId` 是**输入**的，可能遇到的错误是指向一个不存在的用户：格式良好的 UUID 能通过 `@IsUUID()`，触发外键
`project_members.user_id → users.id` 错误，没有任何全局过滤器处理它，Nest 返回默认的 500。`mensagemDaApi` 会返回 "Internal server error"，比提示更糟——它的 `padrao` 只适用于不是 `ApiError` 的错误。统一形式会让这个输入框最可能的路径上的内容变得更糟。

- **位置：** `apps/api/src/interfaces/http/iam/projects.controller.ts:121`、
  `:135`、`:147`（三个角色——这些行**没有**改变）、
  `apps/api/src/application/use-cases/iam/resolve-effective-role.use-case.ts:14`
  （`projectRole ?? workspaceRole`，两个方向上的覆盖）、
  `apps/api/src/infrastructure/persistence/drizzle/project.repository.ts:194`
  （`listMembers`——使表格成为切片的 `innerJoin`）、
  `apps/web/src/routes/settings/MembersSection.tsx:62`（有效角色以及为什么是
  `maintainer`）、`:109`（为什么邀请不使用 `mensagemDaApi`）、`:142` 和
  `:162`（缺少的两个 `try/catch`）、
  `apps/web/src/lib/roles.ts:49`（`roleAtLeast`）、`:3`（`ROLE_ORDER` 的注释，它断言“papel efetivo nunca é rebaixado”——上表中的第四处，也是唯一被修正的一处）
- **测试：** `apps/web/src/routes/settings/papel-na-secao-de-membros.test.tsx`
  （`viewer` 和 `developer` 不能编辑，点击不会到达 api；`maintainer` 和
  `owner` 可以编辑，POST/DELETE 能到达；缺失的角色是惰性的；行的角色在变淡的控件中保留；证明两个方向覆盖的**一对**——工作区 `viewer` 有 `maintainer` 行时**可以**编辑，工作区 `owner` 有 `viewer` 行时**不能**编辑；两种拒绝都变成带 api 句子的 toast；屏幕不会转而显示 api 拒绝的角色；以及邀请在遇到 500 时保留固定提示）
- **来源：** #443 的评审——它声明的缺口，从拥有关闭它所需数据的小节看过去
- **补充（附加，上文未改动）：** 表中标为“未修正”的三处 OpenAPI 描述**之后已被修正**，由
  [RN-472](api.md#rn-472) / [ADR 0127](../adr/0127-tetos-de-rebaixamento-em-project-members.md)
  在把两个降级上限放进 api 的同一次变更中完成。不要重新打开表中的那一行。

---

## 文件夹优先，二进制不是阻断（RN-473/474）

### RN-473 — 通过浏览器配置 runner 从**文件夹**开始，二进制的失败从不丢弃已经配置好的内容 {#rn-473}

> **由 [RN-687](#rn-687)（[ADR 0203](../adr/0203-aposenta-o-fluxo-do-runner-pelo-navegador.md)，10月1日）修订：**
> 这条 RN 所排序的流程已被**移除**——`runner-bootstrap.ts` 及其测试随浏览器流程一起删除。它留存下来的是“人工步骤要**事先**说明”的标准，面板把它应用于安装程序的命令。

[RN-464](api.md#rn-464)..[466](runner.md#rn-466) 的流程按 `chave → registro
→ binário → pasta` 的顺序运行（`configurarPastaAutomaticamente`，
`apps/web/src/lib/runner-bootstrap.ts`）。四个步骤的风险并不相同：
二进制的下载是**唯一**依赖 GitHub 上已发布 release 的步骤（`RunnerReleasesController`，`releases/latest` 的代理），而当前 release 对任何平台都没有资产时，它返回 **502**。异常在 `showDirectoryPicker` 之前抛出，于是**文件夹选择器根本不会打开**——按钮看起来是惰性的，文件夹无法到达，整个配置因为最脆弱的步骤而丢失。

顺序变为 `pasta → config → chave → registro → chave privada →
binário`，最后一步是**尽力而为**：

| 步骤 | 失败会使流程中止吗？ | 原因 |
|---|---|---|
| 1. `showDirectoryPicker` | **是** | 没有文件夹就无处写入任何东西。取消（`AbortError`/`NotAllowedError`）**不是**失败——回到初始状态，没有警告 |
| 2. `brabo-runner.config.json` | **是** | 它是 [RN-466](runner.md#rn-466) 读取的那一对中的一半 |
| 3. Ed25519 密钥对 + `registerRunnerDeviceKey` + `…device-key.jwk.json` | **是** | 磁盘上的私钥在服务器上没有对应项就无法认证；因此注册在写入**之前**进行，且两者相邻 |
| 4. 二进制 | **否** | 返回填充了的 `falhaDoBinario`；最终指令变为 `npm install -g @brabo/runner && brabo-runner` |

替代路径**无需任何标志**就能工作，正是因为第 2 和第 3 步已经运行：CLI 从 `cwd` 读取这两个文件（RN-466）。这是 `CLAUDE.md` 声明的**三条**分发路径之一，也是唯一既不依赖 release 也不依赖单仓库检出的路径。`baixarKitManual`（Chromium 之外）遵循同样的标准，颠倒两次下载的顺序：**套件**先出，二进制最后。

**终端那一步是人工的，屏幕从不假装不是。** 网页不会在任何人的机器上执行二进制，File System Access API 也不保留可执行位——所以命令中仍保留 `chmod +x`。产品所做的是把这一步缩成一行、一次点击即可复制；任何 UI 文本都不说“自动安装”。

**而且它在点击**之前**就被宣告，而不只是之后。** 解释这一步的句子从一开始就存在，但只在**成功**状态下渲染——在人选择了文件夹、等待密钥注册和二进制下载之后。点击一个名为“自动配置文件夹”的按钮、之后才发现还需要打开终端的人是被惊到了，即使没有任何一句话撒谎：在最后宣告，是在还不算伪装的前提下最晚的时刻。现在初始状态中、按钮旁边有一条提示，而结尾的那一条**仍然保留**——两者说的是不同的事（一条预告这一步会到来，另一条解释它为什么存在）。按钮的标签**没有**改变：它说的是**文件夹**，而文件夹确实是自动配置的，更换它反而会更差地描述它做的事。

**当能确定是哪个文件夹时，最终命令会说在哪个文件夹中运行。** 指令过去说“在所选文件夹中运行：……”，却从未说出这个文件夹在哪里——File System Access API 只暴露基本名（`dirHandle.name`），从不暴露绝对路径。路径存在于另一边：就是人在创建项目时输入的 `projects.workspace_path`。当它的基本名与所选文件夹一致时，指令获得前缀
`cd <caminho> && `；**不**一致时，不带前缀输出——没有什么强制人在选择器中选择与输入相同的文件夹，而 `cd` 到错误的地方就是屏幕在断言它不知道的事。基本名是从这里所能证明的极限，而它对不同文件夹恰好相同的罕见情况会**大声**失败（`cd` 找不到路径，或者 `./brabo-runner` 不在那里），从不静默——这正是决定启发式能否进入的标准。手动套件（Chromium 之外的后备）**不**获得前缀，这不是遗忘：在那里文件落在下载文件夹中，`cd` 会把人送到文件还没到的地方。

**声明的缺口：** 在第 3 步和结束之间关闭标签页，会在项目中留下一个**孤立**的设备密钥。它是惰性的——对应的私钥只存在于那个标签页的内存中，没有它，密钥认证不了任何东西——但如今它是不可见的：`RunnerDeviceKeysController` 有 `POST` 和 `DELETE`，却没有**列表**路由，所以没有能撤销它的屏幕。重新执行流程会注册一个能工作的新密钥。列表是在已存在的 `DELETE` 之上的直接工作，等需要时再做。

- **位置：** `apps/web/src/lib/runner-bootstrap.ts`
  （`configurarPastaAutomaticamente`、`baixarKitManual`、`COMANDO_VIA_NPM`）、
  `apps/web/src/components/RunnerOnboardingPanel.tsx`
  （`ehCancelamentoDoSeletor`，结果区块）
- **测试：** `apps/web/src/lib/runner-bootstrap.test.ts`（以列表形式断言四个步骤的顺序；二进制 502 以及二进制**写入**失败时写入另外两个文件并返回替代命令；取消选择器时不注册密钥也不下载任何东西；即使二进制 502，套件仍然输出）、
  `apps/web/src/components/RunnerOnboardingPanel.test.tsx`（宣告文件夹，并在旁边给出失败原因；取消不变成警告）
- **ADR：** [0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)
  ——这条 RN 修订它所建立的流程的**顺序**，而不是机制
- **来源：** 产品负责人的请求

### RN-474 — 给出指令之后，屏幕**等待** runner：三种状态、上限，有效的路径是 runner 报告的那个 {#rn-474}

配置文件夹并显示命令会让人不知道是否成功了。第四步是一个自行解决的等待
（`apps/web/src/components/EsperaDoRunner.tsx`），由
`RunnerOnboardingPanel` 在配置一完成就挂载——在两条路径上（文件夹已写入和套件已下载）。

**机制是已经存在的那个。** 信号是 `project.workspaceVerifiedAt`，即 `ConfirmProjectWorkspaceUseCase` 在 runner 连接时写入的时间戳
（[RN-423](runner.md#rn-423)），engine 把它用作**门槛**（`terminal_executor.ex`
拒绝在 `workspace_verified_at` 为空的 `runner` 项目中执行）——产品自己对“这个项目有 runner”的定义。这是 `AmbienteDoProjeto` 已经读取的同一数据（[RN-468](#rn-468)），位于整个页面维护的同一个缓存键
`['project', id]` 中。考虑过的替代方案是探测 `connectFsBrowserChannel`（其错误 `'Nenhum runner conectado'` 由
`FolderBrowserModal` 检测）：它知道**此刻**的情况，这更强，但频道会按实例永久写入 `erroDeConexao`，因此每次探测都要付出**新**的 ticket + socket——在整个等待期间几十次——而且它仍然回答不了屏幕应该说出的后一半：runner 报告的是**哪个**路径。

**已确认是指时间戳**改变**，从不是“存在”。** 等待在第一次 `GET` 时取一个基线，并与之比较。没有这一点，一个之前就已确认的项目会在屏幕打开的瞬间被宣告为刚刚连接。

**三种状态不折叠，也没有一种是永久的**（[RN-088](#rn-088)、
[RN-468](#rn-468)）：

| 状态 | 屏幕说什么 |
|---|---|
| `esperando` | “正在寻找 runner”，并**声明**上限（“3 分钟后停止”） |
| `confirmado` | 时间戳的日期**以及** runner 报告的 `workspacePath`，说明它取代了输入的内容——屏幕不与真正在宿主机上运行的东西竞争 |
| `semResposta` | 上限已到，屏幕声明它**不**知道的：用已确认的文件夹重连不会重写时间戳，所以这里的缺失并不证明缺失，知道此刻情况的是 Code 标签页。一个按钮重新开始搜索而不必重做配置 |

- **位置：** `apps/web/src/components/EsperaDoRunner.tsx`（`INTERVALO_MS`、
  `TETO_MS`、`base` 中的基线）、
  `apps/web/src/components/RunnerOnboardingPanel.tsx`（挂载它的组件）
- **测试：** `apps/web/src/components/EsperaDoRunner.test.tsx`（三种状态逐一测试，每一种都断言另外两种**不**在屏幕上；已存在的时间戳不算作新连接；用假定时器让上限到期，以及重新开始的按钮）
- **ADR：** [0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)
- **来源：** 产品负责人的请求

## `kid` 是纽带，拒绝有名字（RN-475）

### RN-475 — 浏览器写入的私有 JWK 携带注册记录的 `kid`；CLI 区分“没有密钥”和“有密钥但不可用” {#rn-475}

> **由 [RN-687](#rn-687)（[ADR 0203](../adr/0203-aposenta-o-fluxo-do-runner-pelo-navegador.md)，10月1日）修订：**
> **浏览器**那一半随流程一起移除（连同在 Chromium 中证明它的 e2e）；盖上的 `kid` 对在终端中创建的密钥仍然有效（`device-key finish --id`，RN-551），而 CLI 的那一半——缺失 × 拒绝——完整保留。

[ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md) 的自动模式（[RN-464](api.md#rn-464)..[466](runner.md#rn-466)）自诞生以来**从未认证成功过一次**。这条 RN 的两半是缺陷和掩盖它的东西。

**`kid` 不是装饰——它是两边之间唯一的纽带。** `POST projects/:projectId/runner-device-keys` 返回的 `id` 标识保存**公**钥的 `runner_device_keys` 记录。它需要在私有 JWK **内部**到达磁盘，位于 `kid` 字段（RFC 7517），因为整条链正是这样携带它的：`lerChaveDeDispositivo` 只**传递** `jwk.kid`（从不编造或推导 id），`assinarTicketComChaveDeDispositivo` 把它放进 ticket JWT 的受保护头部，而 `PatAuthGuard` 恰恰用这个 `kid` 找到公钥并验证签名（[RN-465](api.md#rn-465)）。

浏览器在**两条**路径（`configurarPastaAutomaticamente` 和 `baixarKitManual`）中都**丢弃了** `registerRunnerDeviceKey` 的返回值，而
`crypto.subtle.exportKey` 导出的是**原始** JWK，不带任何 `kid`。生产者写入一个消费者**总是**拒绝的文件——而缺陷在两边都不可见：每个函数单独看都是对的。证据在数据库里：该流程注册的密钥 `last_used_at` 全部为空。

修正是结构性的，而不是一行：[RN-473](#rn-473) 的第 3 步（导出公钥、注册、导出私钥）变成**一个**函数
（`registrarChaveEExportarPrivada`），`id` 在其内部流动。再次丢弃它需要删除代码，而不是忘记一次赋值。`kid` 只放在**私**钥中：公钥不带它，因为正是公钥的注册产生了它。

**拒绝有名字。** `lerChaveDeDispositivo` 返回 `null` 而不抛出——这是有意的，并且不变：文件缺失是用 `--project`/`--dir`/`--token` 运行的人的**正常**路径。但 `null` 回答了两个不同的问题，CLI 对“你什么都没配置”和“你的文件夹已配置但密钥不可用”打印**相同**的 `uso()` 区块——它讲的是标志，而不提文件。一个拥有完美 `brabo-runner.config.json` 的人被引导去调查恰恰是正确的那一边。

| 状态 | 谁回应 | CLI 的输出 |
|---|---|---|
| `ausente` | 正常路径 | `uso()` 区块，不变 |
| `json-invalido` | 拒绝 | `explicacaoDaChaveRecusada`——点名文件、原因，以及两条出路（通过浏览器重新写入文件夹，或在此期间使用 `--token`） |
| `sem-kid` | 拒绝 | 同上，点名缺少的字段及其用途 |
| `valida` | 继续流程 | — |

`estadoDaChaveDeDispositivo` 和 `explicacaoDaChaveRecusada` 位于
`device-key.ts`，因为它们讲的是**文件**；对拒绝**做什么**（退出、用哪个代码、带不带用法区块）仍然属于 `index.ts`，正如模块的 docblock 早已说明的。`explicacaoDaChaveRecusada` 的类型排除了
`ausente` 和 `valida`：正常情况和成功都没有解释，而一段覆盖四种状态的含糊文本会再次成为同样的缺陷。

**是什么让它漏过的：** web 的测试断言文件被**打开**（以正确的名称调用 `getFileHandle`），从未断言其**中**有什么。一个证明文件被创建却不证明其内容的测试，允许写入任何东西。替身改为把名称 → 内容绑定起来，两个旧断言补上了缺少的那一半。

- **位置：** `apps/web/src/lib/runner-bootstrap.ts`
  （`registrarChaveEExportarPrivada`、`exportarJwkPrivada`）、
  `apps/runner/src/device-key.ts`（`estadoDaChaveDeDispositivo`、
  `explicacaoDaChaveRecusada`、`EstadoDaChaveLocal`）、
  `apps/runner/src/index.ts`（`lerArgumentos` 中的凭据分支）
- **测试：** `apps/web/src/lib/runner-bootstrap.test.ts`（写入的 `kid` **就是**返回的 `id`，用不同于默认值的 id 证明；两条路径——文件夹和手动套件；**不带** `kid` 的公钥；有用的密钥在二进制 502 时存活）、`apps/runner/src/device-key.spec.ts`（四种状态逐一测试；当 `lerChaveDeDispositivo` 把两者都折叠为 `null` 时 ausente ≠ sem-kid；两条拒绝的句子彼此不同）、
  `apps/runner/src/index.spec.ts`（**真正**的 CLI，在独立进程中：没有密钥的文件夹落入用法区块，有密钥但没有 `kid` 的文件夹落入具名拒绝，两种输出不相同——缺陷就在于它们相同）
- **ADR：** [0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)
  ——这条 RN 不修订它的机制，而是关闭它在两端之间留下的隐式契约
- **来源：** 产品负责人针对本地环境真实使用该流程

## 屏幕上的环境状态（RN-468）

### RN-476 — 把一个模型应用到**所有**智能体：一个值、N 次调用，以及尽管值是具名的仍有一个按钮 {#rn-476}

`Modelos por agente` 表每个智能体一行，每行一个选择器。为 17 个智能体选择同一个模型就要逐一走过 17 行，其代价不在时间：而在于没有人会核对 17 个下拉框，屏幕也无法说出是否落下了一个。该小节在表格**上方**获得一个条——一个选择器和一个按钮——一次性把**一个**模型应用到所有智能体。

**该操作在**智能体**级别写入，17 行——而不是项目级别。** “所有智能体一个模型”的两种解读都存在，并产生不同的状态：在项目级别写入并删除智能体和领域的绑定，会让 17 个都**继承**，这是级联本身的惯用法。没有选择它，有两个具体的代价：`PUT projects/:id/model-binding` 和领域端点要求
`maintainer`，而智能体绑定要求 `developer`——能逐行更改的同一个人将无法一次性更改——并且项目绑定也是**会话**的默认值，而
[RN-040](api.md#rn-040) 有意让它保持自由。这一选择的代价是声明的：17 行开始分歧，在“来源”列中显示 `agent`，回到继承仍然要逐行操作。

**尽管值是**具名**的，仍有按钮。** [RN-469](#rn-469) 的标准说具名值的选择在 `onChange` 时保存，它对**每一行**写入自身值的选择器仍然有效。条上的选择器不是任何东西的配置：它是旁边那个操作的参数。在 `onChange` 时应用会让下拉框中的一次探索性点击改写 17 个人并没有在编辑的行，而撤销需要 17 次点击。按钮**说出**它会触及多少行，因为这个数字就是后果。

**结果完全遵循 RN-469，这也是这个条不发明任何东西的原因。** 每个智能体一次调用，**串行**，按屏幕顺序，在第一次拒绝时不中止——中止会让 16 行没有被尝试，屏幕将无法区分“拒绝了”和“没尝试”。三种结果不互相伪装：全部通过 → 成功，并点名模型；**一个都**没通过 → api 的消息，从不是计数；**部分**通过 → 提示多少中的多少，并按智能体的**名称**点名留下的，这是人在第一列中读到的。只有 api **确认**了的行会被重新读取：使全部 17 行失效会从屏幕上抹去部分报告刚刚计算出的差异。

**门槛是**端点**的，而该端点与行控件的相同。**
`developer`，经由 `PUT projects/:projectId/agent-bindings/:agentSlug`——而不是相邻领域小节的 `maintainer`（[RN-102](api.md#rn-102)）。对达不到的人按钮保持惰性，原因在小节说明中以**文本**说**一次**，与另外两个惰性的操作一起：`disabled` 元素上的 `title` 在 Chromium 中不会打开（ADR 0064）。选择器的“适合智能体”筛选打开时是**勾选**的，与行选择器相同、出于同样的原因（[RN-040](api.md#rn-040)）——在这里理由更充分，因为在条上选择一个仅聊天的模型不会产生一个 422，而是 17 个，部分报告会把同一个拒绝数十七次。

- **位置：** `apps/web/src/routes/settings/aplicar-a-todos.tsx:66`
  （`useAplicacaoEmLote`——串行循环和三种结果）、
  `apps/web/src/routes/settings/ModelsSection.tsx`（条、所选模型的本地状态，以及只使已确认行失效）
- **测试：** `apps/web/src/routes/settings/aplicar-a-todos.test.tsx`（按屏幕顺序把同一模型写入所有智能体；一个都没通过时显示 api 的消息而**不是**计数，但仍尝试全部；部分失败说出多少中的多少并点名留下的；低于 `developer` 的角色让按钮惰性，原因仍以文本说明）
- **来源：** 产品负责人在只用一个提供方配置全新环境时的请求——所有智能体都需要同一个模型

---

## RAG 检索留下痕迹，痕迹冻结权重（RN-479..481）

### RN-491 — Infra 在 Arquiteto 的候选中选出一个，选择变成 `artifact.project_image` 的一个**新**版本 {#rn-491}

`propose_container_start` 关闭了 RN-487 声明为开放的那一半：Infra 从 Arquiteto 当前的路由（`artifact.module_routing`）中选出**一个** `imagemCandidata`，并提议启动项目的**真实**容器。选择之所以有效，只是因为 `ExecuteContainerStartUseCase` **复用**
`DecidirImagemDoProjetoUseCase` 来发出带 `decidedBy: 'infra-lead'` 的新版本 `artifact.project_image`——没有这一点，选择是可审计但**惰性**的：broker 通过读取 `GET
.../container-spec` 组装容器，而后者读取 `artifact.project_image`（RN-105），从不读取 `artifact.module_routing`。

**选出的镜像必须总是在候选列表中——在触碰制品**之前**校验。** 在列表之外，操作会失败，点名被拒绝的镜像并列出有效的候选，`DecidirImagemDoProjetoUseCase` 和 broker 都不会被调用：Infra 选出，从不编造。

**新的 `container_start`（`maintainer`，与 `open_infra_pr`/
`parallelize` 同一量级），有意不在 `decide.ts` 的绝对上限块中**——与那里已为
`propose_execution_plan`/`assess_implementability` 记录的推理相同：这是这个容器为这次选择**第一次**真正启动，而不是越过一个已授权的上限。与 `open_infra_pr` 不同，这个操作**不**在
`INFRA_AUTONOMY_SEEDS` 中播种——Infra Lead 从不通过 `open_infra_pr` 应用任何东西（只是提议一个仍需人来合并的 PR），但启动容器是真实的外部效果，所以默认保持 `require_approval`，由 `ApprovalCard` 逐案决定。`maintainer` **可以**之后配置自动批准，因此 `ProposeActionUseCase` 也在 `auto_approved` 路径上执行，与该文件中关于 `parallelize` 的注释相同的教训（“sem isto a ação nascia, era aprovada — e nada subia”）。

**由 [RN-671](api.md#rn-671)（ADR 0190，10月1日）修订：** `container_start` 改为在接受 Infra 的 handoff 时**播种**为 `auto_approve`，Infra Lead 的服务器在有路由时会自行提议第一次启动。本规则的其余部分——候选列表、`maintainer`、不在绝对上限中——保持不变。

**在 broker 确认之后，生命周期的转换遵循 ADR 0081 的状态机，从不无故重新开通。** 还没有行，或行处于 `failed`/`removed`：先 `provisioning`（读取刚决定的镜像并冻结 `imageVersion`），然后才 `running`。行处于 `stopped`：直接到 `running`——状态机甚至不允许 `stopped -> provisioning`，而重新开通会重新发出一个已经记录在该行中的镜像。行已处于 `provisioning`/`running`：完成待定的转换或什么都不做，依靠 broker 幂等的 `start`（`jaEstavaDePe`）。

**修订 RN-485。** “没有任何东西触发启动……如今存在的唯一调用方只做**读取**”不再成立：`container_start` 是 `ContainerBrokerPort.start` 的第一个真正调用方，属于 ADR 0128/0130 声明的五种操作。`RegistrarTransicaoDeContainerUseCase` 也获得了测试之外的第一个调用方。仍然成立的是：**没有任何东西**会自行触发——它总是一个 `proposed_action`，由人或明确的策略决定。

**dev agent 并**不**开始在这里启动的容器内工作。** 那一步是之后的 PR，在 CLAUDE.md 中被声明为开放——审批屏幕显示的句子（`apps/web/src/lib/aprovacoes.ts`）有意在承诺这一点之前停下。

- **位置：** `apps/api/src/application/use-cases/actions/execute-container-start.use-case.ts`、
  `apps/api/src/domain/actions/decide.ts`（`ACTION_TYPES`、
  `MIN_ROLE_FOR_ACTION_TYPE`）、`apps/api/src/domain/containers/container-start-execution-result.ts`、
  `apps/api/src/application/use-cases/actions/approve-action.use-case.ts`、
  `apps/api/src/application/use-cases/actions/propose-action.use-case.ts`、
  `apps/api/src/application/use-cases/execution/get-infra-context.use-case.ts`
  （`moduleRouting`，`GetModuleRoutingUseCase` 的第一个 HTTP 消费者）、
  `apps/web/src/lib/aprovacoes.ts`、
  `apps/engine/lib/engine/infra/tools/propose_container_start.ex`、
  `apps/engine/lib/engine/infra/infra_lead_server.ex`
- **测试：**
  `apps/api/test/application/use-cases/actions/execute-container-start.use-case.spec.ts`
  （选出候选的正常路径；候选之外的镜像被拒绝，不调用 `DecidirImagemDoProjetoUseCase` 也不调用 broker；`BrokerRecusouError`/
  `BrokerIndisponivelError` 变成 `failed`，从不传播；`stopped` 直接跳到 `running`）、
  `apps/api/test/domain/actions/decide.spec.ts`（`container_start` 要求
  `maintainer`；配置后**能够**达到 `auto_approve`——与 `parallelize`/受保护合并/`instruction_patch` 相反）、
  `apps/api/test/application/use-cases/execution/get-infra-context.use-case.spec.ts`
  （`moduleRouting` 存在和缺失）、
  `apps/web/src/lib/aprovacoes.test.ts`（句子不承诺 dev agent 在容器内）、
  `apps/engine/test/engine/infra/infra_lead_server_test.exs`
- **ADR：** [0130](../adr/0130-broker-de-container.md)、[0133](../adr/0133-infra-elege-imagem-do-roteamento.md)
- **来源：** 产品负责人的计划，第 1 部分 / PR 1.5

### RN-499 — Infra 的 handoff 有**自己**的可操作卡片，位于线程之外——不扩展 `AGENTES_DE_CHAT` {#rn-499}

`OfferInfraHandoffUseCase` 向 Infra Lead 提供 handoff
（`offer-infra-handoff.use-case.ts:43`），而在此之前**没有任何屏幕能接受它**。`offeredHandoff`（`SessionPage.tsx`）把线程中的卡片限制在
`AGENTES_DE_CHAT`（[RN-136](#rn-136)），其中不包括 `infra`，而
`acceptHandoff`（`api-client.ts`）只有**一个消费者**——就是那张卡片，位于那个筛选之后。代码自己的注释把后果记录为已接受：*“como Infra nunca é aceito por AQUI … na prática, nunca”*。

影响并非表面的：handoff 永远停留在 `offered`，Infra Lead 从未被激活，`propose_container_start` 从未被调用（[RN-491](#rn-491)），**任何模式的任何项目都从未有容器运行**。“Infra 接受 → 提议 `container_start` → 被批准 → `running`”这条链通过任何屏幕路径都无法到达。

**筛选**没有**被扩展，这就是规则。** `AGENTES_DE_CHAT` 排除 `infra` 是对的：engine 的 `agent_command_controller.ex` 没有 Infra Lead 的 `message` 子句，而最后一个子句（没有守卫）会把 `"infra"` 当作 Criativo 处理——把 `infra` 放进列表会让屏幕提供一个并不存在的对话线程，并让输入框把消息发给错误的智能体。（自 [RN-584](engine.md#rn-584) 起，engine 会具名拒绝，而不是交给 Criativo；筛选出于同样的原因仍然正确。）接受 Infra 是一个**提议性**的操作，而不是对话性的。

因此可操作卡片位于**线程之外**：在滚动区域与输入框之间的固定条中，与承载手动 handoff 的是同一个条（[RN-440](api.md#rn-440)），它本就声明自己是那些“不是对话，而是重定向”的 handoff 操作的位置。这个选择换来三个后果：Infra 的 `handoff.offered` **继续**在线程中以静默分隔线被叙述（时间线中没有任何变化）；没有任何对话型 handoff 改变形式；在长会话中当提议滑出 200 个事件的窗口时，按钮也不会消失——线程中的卡片会依赖于事件可见，这张不依赖。

卡片**说出点击的后果**，因为它并不显而易见：接受会激活 Infra Lead，后者接管开通并将**提议**启动容器；该提议仍然要经过一贯的审批流水线（`container_start`、`maintainer`，从不通过种子自动批准——[RN-491](#rn-491)）。接受不会启动任何容器。

关闭：与线程卡片相同的 `activeFor(h.toAgent)`——已接受的 handoff，或已通过任何其他路径在本会话中活动的 Infra，都不会重新打开邀请。点击调用的是**同一个** `handleAcceptHandoff`，没有第二条接受路径。

- **位置：** `apps/web/src/routes/SessionPage.tsx`
  （`handoffDaInfraOferecido`，以及位于
  `manualHandoffRow` 上方的 `styles.infraHandoffRow` 块）
- **测试：** `apps/web/src/routes/SessionPage.handoff-da-infra.test.tsx`——卡片出现并以正确的 id 接受；Infra 已活动时消失；在非活动会话中消失；线程中的静默分隔线仍在且没有线程按钮；以及 [RN-136](#rn-136) 的**非回归**：待处理的 Infra（较旧）+ Dev Lead（较新）显示**两张**卡片，各自接受自己的 handoff
- **来源：** 对“Nome e local na mesma tela, e container antes dos dev agents”计划（D0）的探索——这个阻断项使“dev agent 只在容器运行之后”这一要求等同于“dev agent 永远不开始”

## 由 api 提供的文件夹浏览器（RN-504）

### RN-504 — 文件夹浏览器限定于项目基准目录，**从不**离开它 {#rn-504}

`GET /workspaces/:workspaceId/project-folders` 列出一个路径的**子文件夹**，它的存在是因为项目创建向导一下子失去了它拥有的**两种**“浏览文件夹”机制：`FolderBrowserModal` 通过 **runner 的 websocket**（`fs_list_dir`/`fs_home_dir`）浏览，而
`RunnerOnboardingPanel` 使用 `showDirectoryPicker`，它返回浏览器句柄，从不返回绝对路径。没有 runner，浏览器就无法列出任何文件系统——而 `projects.workspace_path` 保存的正是绝对路径。

**约束只有**一个**，而且是硬性的。** `path` 是可选的，省略意味着基准（`baseDeProjetos()`）；每个提供的 `path` 都必须满足
`dentroDaBaseDeProjetos`（RN-500），它复用 `dentroDoEscopo`——ADR 0055 终端范围的同一个函数——因此能抓住前缀陷阱：
`/home/voce/brabo2` **不在** `/home/voce/brabo` 之内，尽管字符串开头相同。`..` 和 `.` 被**拒绝**而不是被解析，原因与 `caminhoDeWorkspaceLocalValido` 相同：解析就等于接受读取的路径不是请求的路径。

**离开基准是 400，不是 403。** 403 会说“你没有权限看这个”，暗示另一个角色能看到——事实并非如此。没有任何角色能在基准之外浏览，因为基准之外不是一个更有特权的区域，而是这个路由根本不寻址的区域。请求是**格式错误**的。

**上限是契约，而不是实现细节：** `entries` 中只有目录；最多 **500** 个，在截断**之前**排序（否则“前 500 个”就是文件系统返回的顺序，因机器而异）；不递归；以 `.` 开头的条目排除在外；符号链接**被报告，从不深入**——`readdirSync(withFileTypes)` 具有 `lstat` 语义，因此指向基准之外的链接不是出口。**被排除的东西会被**计数**（`arquivos`、`simbolicos`、`truncado`）：没有这一点，一个满是代码的文件夹会以空列表返回，屏幕会说“空文件夹”，对它没读到的东西做出断言（RN-180）。

**没有 POST。** 创建文件夹属于挂载工作区的物化，发生在容器启动的那一刻——从不属于选择器。

**最低要求是 `maintainer`**，与 `POST .../projects` 和
`.../projects-base` 相同，推理也相同，只是更进一步：`projects-base` 揭示运维人员机器上的**一个**路径，这个路由揭示它之下的**拓扑**。因为相邻路由是邻居就继承它们的 `viewer`，正是 RN-102 点名的缺陷——最低要求属于**端点**，从不属于小节。`workspaceId` 不参与计算：基准属于**安装**，它出现在路由中是因为它为 `RolesGuard` 提供范围。

**在客户端**，传输变成 `FsBrowser` 接口（`apps/web/src/lib/fs-browser.ts`）的**两种**实现之一：`criarFsBrowserViaApi`（新）和
`connectFsBrowserChannel`（runner 的频道，重新类型化）。`FolderBrowserModal` 按 `origem: { tipo: 'api'; workspaceId } | { tipo: 'runner'; projectId }` 选择
——带判别的联合，而不是两个可选 prop，因为“两者都没有”和“两者都有”会是组件不得不在运行时处理的可表示状态。从这里起，经由 runner 的传输在 web 中**没有调用方**，并按产品负责人声明的决定继续留在仓库中（runner 离开界面，二进制继续被打磨）；`apps/runner/src/channel.ts` 中的协议无论如何不被触碰。

- **位置：** `apps/api/src/infrastructure/filesystem/project-folders-browser.ts`
  （`listarPastasDeProjeto`、`TETO_DE_ENTRADAS`、`PastaForaDaBaseError`、
  `PastaNaoLegivelError`）；
  `apps/api/src/interfaces/http/iam/workspaces.controller.ts`
  （`listProjectFolders`）；`apps/web/src/lib/fs-browser.ts`；
  `apps/web/src/components/FolderBrowserModal.tsx`
- **测试：**
  `apps/api/test/infrastructure/filesystem/project-folders-browser.spec.ts`、
  `apps/api/test/interfaces/http/iam/workspaces-project-folders.controller.spec.ts`、
  `apps/web/src/lib/fs-browser.test.ts`、
  `apps/web/src/components/FolderBrowserModal.test.tsx`
- **ADR：** [0141](../adr/0141-base-unica-dos-projetos-montados.md)（这个路由所限定的基准）
- **来源：** 产品负责人的计划，PR 4

## 基准目录决定项目创建提供什么（RN-513）

### RN-513 — 有已同意的基准目录时，`mounted` 被预选并建议 `<base>/<slug>`；没有基准，或不知道时，不提供它 {#rn-513}

> **由 [RN-573](api.md#rn-573)（ADR 0161）修订：** `mounted` 的预选开始**还**要求已确认的容器 broker。有基准而没有 broker 时（通过 Release 安装），`runner` 被预选，`container`/`mounted` 以文本说明原因并保持惰性；broker 未知时，`container` 仍被选中。本规则的其余部分照旧有效。

这条规则的两半**早已是规则**，却从未到达客户端。“没有基准时不提供该模式”是 [RN-500](api.md#rn-500)；“建议 `<base>/<slug>`”是 [RN-501](api.md#rn-501)，而 ADR 0142 恰恰为了让向导能建议一个**尚不存在**的文件夹才推迟了磁盘校验。在此之前，`GET /workspaces/:workspaceId/projects-base` 在 web 中**没有任何调用方**，“挂载文件夹”卡片被无条件提供——在没有 `BRABO_PROJECTS_BASE` 的安装中，选择该模式会在用户选择、输入路径并走到向导末尾之后，以 api 的 400 拒绝告终。

**新**的是**预选**：配置了基准时，`mounted` 生来被选中。它修订了 ADR 0072 的默认值（在那里 `container` 是“正常的”，本地模式是逃生舱），并且**只针对本地安装**修订，在那里基准已由人在宿主机上同意（[RN-511](infra.md#rn-511)）。枚举 `project_execution_mode` 不变，没有新模式诞生，模式转换（ADR 0111）不被触碰。

**查询随向导诞生，而不是随步骤。** “代码将放在哪里”这一步是第五步；只在那里挂载的 `useQuery` 会让卡片在人已经看着屏幕之后才闪现。

**未知不会变成提供。** 在响应到达之前，以及查询**失败**时（403、网络、api 宕机），卡片都不出现，`container` 仍被选中。失败不是提供一个无法确认其前提的模式的许可：这与 [RN-088](#rn-088)/[RN-468](#rn-468) 是同一标准——产品不把“我不知道”和“没有”折叠在一起——也与 ADR 0041/0042 相同，在那里 capability 只有在被**证明**时才声明。

**预选从不覆盖人的选择。** 基准经由网络到达，总是在第一次渲染**之后**。屏幕把用户的选择与当前模式分开保存（`modoDeWorkspaceEscolhido` × `modoDeWorkspace`），预选只在没有人碰过卡片时才有效——在已经点击的人手底下更换模式是缺陷，不是便利。

**建议从不覆盖已输入的内容。** `<base>/<slug>` 只在两种情况下进入：字段为空且尚未建议过任何东西，或者字段恰好包含本屏幕之前的建议（名称在详情步骤中改变了，建议随之更新）。其他任何情况——包括用户删除建议**之后**的空字段——都保持原样。空 slug（采用仓库时，名称来自提供方）不会变成编造的路径段：字段保持为空，`canAdvanceFromWorkspace` 拦住这一步。字段始终**可编辑**；预选没有放宽任何前进标准。

**而模式的提示不再撒谎。** 之前的文本早于 ADR
0141：它说路径是自由的，只有用户挂载了它才会工作。如今有**两种状态，正是后端拥有的两种**——在基准之下，中性说明（创建会通过，文件夹甚至不需要存在：Infra 在启动容器时创建它，[RN-501](api.md#rn-501)）；在基准之外，提示说 api **会拒绝创建**（400，在 `resolverWorkspacePath` 中）并**点名**基准，而不是让人去找那个变量。空字段不是“在基准之外”：还没有可供 api 拒绝的路径，在人输入之前就发出警报就是屏幕在断言它没有的东西。比较按**路径段**进行，从不是原始的 `startsWith`——`/base-outra` 不在 `/base` 之内——与 api 的 `dentroDoEscopo` 相对应。

- **位置：** `apps/web/src/routes/NewProjectWizard.tsx:220`（查询）、
  `:238`（`podeOferecerMounted`/`baseDeProjetos`）、`:283`（当前模式）、
  `:333`（`caminhoForaDaBase`）、`:360`（建议）；
  `apps/web/src/lib/wizard.ts:143`（`caminhoSugeridoNaBase`）和 `:171`
  （`caminhoDentroDaBase`）——纯函数；
  `apps/web/src/lib/api-client.ts:296`（`getProjectsBase`）
- **测试：** `apps/web/src/routes/NewProjectWizard.test.tsx`
  （`describe('NewProjectWizard — a base de projetos decide o que é
  oferecido')`——基准存在、基准为 `null`、查询被 403 拒绝、基准到达之前的人工选择，以及提示的两种状态）；
  `apps/web/src/lib/wizard.test.ts`（`describe('caminhoSugeridoNaBase')` 和
  `describe('caminhoDentroDaBase')`）
- **ADR：** [0146](../adr/0146-base-consentida-no-bootstrap.md)，第 4 点
- **来源：** FASE 28，第 3 次会话

---

## Runner 模式的选择器重新读取「做选择的人」的磁盘（RN-533）

### RN-533 — 在 `runner` 模式下文件夹浏览器询问本地代理，界面说明磁盘是谁的 {#rn-533}

创建向导用**一个**文件夹浏览器服务于读取**不同**磁盘的**两种**模式。[RN-504](#rn-504) 把两者都指向 api——对 `mounted` 是对的，它的文件夹位于「服务器」上的 `BRABO_PROJECTS_BASE` 之下——并明文声明了代价：*"para `runner` a lista deixa de ser o disco da
máquina do usuário e passa a ser a base"*。这被接受是因为 *"o modo
`runner` sai da criação de projeto no PR seguinte"*，而这**并没有发生**：该模式仍被提供，而 [ADR 0151](../adr/0151-base-consentida-no-runner.md)（第 7 点）的方向正相反。在此期间，选择 `runner` 并点击「Procurar pasta…」浏览的是一个不属于那个项目的磁盘——而**界面上没有任何东西说明这一点**，所以错误只会通过列表的「内容」显现。

**「模式」决定传输方式，这是两个不同的问题。** `mounted` 逐字节照旧经过 api（`GET workspaces/:workspaceId/project-folders`，严格限定在基目录内——RN-504 不变）；`runner` 回到 `fs_list_dir`，它在两边一直存在，其在 web 中的传输从未离开仓库。这不是一个多余的传输获得了用途：这是「你的机器上有什么？」这个 api 无法回答的问题，重新交给能回答的一方。

**`runner` 模式的锚点是 [RN-437](#rn-437) 的「提前」创建。** 频道的票据限定在一个真实的 `projectId` 上，所以点击会在打开模态框之前创建项目——这正是那条规则的原始目的，而 RN-504 曾让它失去了消费者。这次创建失败时，**模态框不会以任何传输方式打开**：回退到 api 会在「你的机器」的标签下显示「服务器」的基目录，正是本规则所关闭的缺陷。

**没有本地代理连接时，该模式仍被提供——由「选择器」声明，而不是模式步骤。** [RN-513](#rn-513) 在基目录未知或不存在时隐藏 `mounted`，这是对的：那里 api「有」信号（`GET .../projects-base`），没有基目录的话，创建会在向导结束时以 400 告终，在界面上无法修复。这里两者都不成立。api 中不存在 runner 的存在信号——[RN-521](api.md#rn-521) 已经明文声明——，所以隐藏模式或熄灭按钮就是从「不知道」推出「没有」，即 [RN-088](#rn-088)/[RN-468](#rn-468) 所禁止的坍缩；而且该模式没有 runner 时**并未损坏**，因为路径之后由 CLI 确认（[RN-423](runner.md#rn-423)）——缺的只是「浏览」。所以声明放到唯一真正发问的地方：选择器，在它发问的那一刻。

**原因是「区分」的，两种结果不坍缩。**
`MotivoDeFalhaDoAgente` 是 `sem-agente`（engine「断言」没有 runner 连接——服务器的事实）或 `sem-resposta`（请求上限、套接字断开、票据被拒——无知，在界面上也作为无知说出）。在本规则之前，做决定的是「组件」中的 `erro?.includes('Nenhum runner conectado')`——一个界面在匹配 engine 某个 `.ex` 中 pt-BR 句子的子串，正是 [RN-532](runner.md#rn-532) 在另一边明文拒绝的东西（*"o texto é para um humano ler, o motivo é para o outro lado
DECIDIR"*）。这种匹配只剩在**一个**地方，即拥有频道协议的模块，而降级是点名的：engine 中改写的句子落入 `sem-resposta`——「不知道」状态——，绝不落入「有代理」。api 传输**绝不**填写 `motivo`，这是决定：api 的拒绝就是 api 的拒绝，有自己会「指导」的消息，也没有可以安装来修复它的本地代理。

**等待是 [RN-474](#rn-474) 的，「复用」而非重写。** 两个原因都通向 `EsperaDoRunner`——同样的三种状态（`esperando`/`confirmado`/
`semResposta`，绝不坍缩）、同样 3 分钟的「上限」、同样的措辞、同样的信号（`workspaceVerifiedAt` 「发生变化」，绝不是「存在」）。它获得了一个可选回调，因为这里的确认有「后果」：失败的列表会自动重做，而不必让人发现自己需要点什么。回调每个实例只触发「一次」——没有 `ref` 的话，探针的每一轮都会重新触发它，调用方会陷入循环——而且它**不断言「现在在运行」**（`workspaceVerifiedAt` 从未这么说过，RN-468）：因此收到它的一方会「重复」请求，如果代理又掉线了，界面回到同一状态，两次都诚实。等待每个界面「一个」：`RunnerOnboardingPanel` 获得了 `mostrarEspera`，只在挂载它的一方已显示自己的等待时为 `false`——两个等待就是两个探针、两个上限，最坏情况下两句关于同一个时间戳的相互矛盾的话。

**选择器在「两种」来源下都说明磁盘是「谁」的。** 在此之前唯一的信号是一个快捷方式的标签（「Base de projetos」× 「Pasta pessoal」），它命名的是一个地方，而不是一台机器。api 那句话不是为了对称的装饰：没有它，runner 那句会读起来像例外警告，而这是两者都应提供的信息。

- **位置：** `apps/web/src/lib/fs-browser.ts:60`
  （`MotivoDeFalhaDoAgente`，以及为什么只有 runner 的传输填写它）；
  `apps/web/src/lib/fs-browser-channel.ts:66`
  （`FRASE_DO_ENGINE_SEM_RUNNER`，仅剩的子串匹配）和
  `:68`（`motivoDaMensagem`）；`apps/web/src/components/FolderBrowserModal.tsx:227`
  （`agenteNaoRespondeu`，按原因做决定）以及两种来源下的来源说明行；`apps/web/src/components/EsperaDoRunner.tsx:91`（`onConfirmado`）和
  `:136`（只触发一次的 `ref`）；
  `apps/web/src/components/RunnerOnboardingPanel.tsx:131`（`mostrarEspera`）；
  `apps/web/src/routes/NewProjectWizard.tsx:304`（`origemDoNavegador`，按模式选择的传输，没有可锚定的项目时为 `undefined`）
- **测试：** `apps/web/src/components/FolderBrowserModal.test.tsx`（声明用户机器磁盘的列表；`sem-agente` 落入引导面板；按「原因」而不是文本做决定，使用一个没人承诺保持的措辞；`sem-resposta` 附带「这不证明不存在」的保留说明、只有「一个」等待以及宣布的上限；时间戳变化时列表自动重做）；`apps/web/src/routes/NewProjectWizard.test.tsx`（模式在两个方向上决定传输；提前创建锚定频道；「失败」的创建不打开任何浏览器）
- **ADR：** [0151](../adr/0151-base-consentida-no-runner.md) 第 7 点
- **来源：** FASE 29，第 9 次会话。已声明且「未」做：选择器**不**触发 `workspace_create`——选择文件夹就是选择，创建是另一回事。`Engine.Runners.PastaDoProjeto.criar/3`（RN-532）仍没有调用方，接上它需要在 api 中新增一个 HTTP 路由，不在本次会话范围内。子串匹配的彻底修复——engine 在文本旁发送一个代码，就像 runner 对 RN-532 的五个 `motivo` 已经做的那样——也属于 engine 一侧，已在代码中声明

---

## 创建项目不配置仓库（RN-541）

### RN-541 — 创建项目「不」创建 git 仓库；bootstrap 推迟到 Arquiteto 的 handoff {#rn-541}

创建项目和配置 git 在实践中曾是同一个动作——把它们联系在一起的是一个「界面」。`ProvisioningPage` 在挂载的 effect 中触发 `provisionRepository`，是 web 中它的**唯一**调用方；向导在确认时导航到那里，所以每个项目诞生时都带有完整的仓库和 Gitflow，而没有人要求过。

产品负责人想要的正相反：目前生成的东西保持**没有 git**，仓库只在开发真正开始时诞生——即 **Arquiteto 把 handoff 交给 Dev Lead** 的那一刻。

**推迟的机制就是不导航到那个界面。** 创建时，向导直接进入「项目」页面。不需要再关闭别的任何东西：由于触发位于一个不再被访问的路由的 `useEffect` 中，不再访问它「就是」推迟。该路由仍然存在、仍然可达——当配置**失败**需要恢复时，Dashboard 会带人去那里。

**Provider 和凭据离开创建，留在采用中。** 现在没有要创建的仓库，询问「托管在哪里」就是收集一个界面不会用到的决定，而凭据步骤会为一个没人会创建的仓库索要 PAT。采用按构造正好相反——它指向一个已经存在的仓库，没有 provider 就没有可指向的东西。向导在创建时有**三**步，在采用时有四或五步。

**确认界面不再承诺 Gitflow。** 它在创建时宣布「N 个 Gitflow 步骤」，计数 `BOOTSTRAP_STEPS`；在 bootstrap 不再在那里运行的那一刻，这就会成为谎言。它改为说明仓库「何时」诞生，而不是断言它已经在诞生。

**已声明的后果：** 在创建与 handoff 之间，项目存在但没有仓库。没有东西会坏——`GET .../repository` 回应 `null` 而不是 404，项目页面已有「仓库未配置」的状态，设置中的仓库部分直接不出现——，但在那之前，每条需要工作树的路径都会以「点名」方式失败（`remoto_de_trabalho` 返回 `:not_found`，`open_adr_pr` 以「Projeto sem repositório provisionado」拒绝）。这不再是边界情况，而成为项目开始时的正常状态。

**触发器是下一次交付**，没有它，今天创建的项目将永远没有仓库：Arquiteto → Dev Lead handoff 的接受开始配置 `local`，即唯一不要求凭据的 provider。自 [RN-582](api.md#rn-582) 起，这个触发器是**给 Arquiteto** 的 handoff 的接受（给 Dev Lead 的成为第二道门），没有仓库就激活执行会被拒绝。

「在 GitHub 免费计划中，私有仓库不接受分支保护」这一提示也随之离开界面——不是因为它不再为真，而是因为它变得**不可达**：条件是 `provider === 'github'`，而创建时不再有选中的 provider。

- **位置：** `apps/web/src/routes/NewProjectWizard.tsx:379`（`stepKeys`，现在依赖于 `adotando`）、`:540`（限于采用的 `provider` 守卫）和
  `:590`（导航到 `/projects/$projectId`）
- **测试：** `apps/web/src/routes/NewProjectWizard.test.tsx`，`describe('NewProjectWizard — o git é adiado')`
  ——"criar não passa mais pela página de provisionamento — vai direto ao
  projeto"、"criar tem TRÊS passos: provider e credencial saíram"、"adotar
  mantém provider e credencial" 和 "a tela de Confirmar não promete mais o
  Gitflow agora"
- **来源：** 产品负责人的要求——*"o que for gerado por hora segue sem
  git; git mesmo só será iniciado após iniciar desenvolvimento em projetos
  novos, neste momento que deve rodar o bootstrap"*

---

## 界面识别已配对的「机器」本地代理（RN-548，FASE 30）

### RN-548 — 有活动的「机器」密钥时，runner 面板不再要求配对，而是说明还缺什么——绝不断言代理在运行 {#rn-548}

[FASE 30](../explanation/fase-30-runner-por-maquina.md) 的第 7 次会话，由 [ADR 0154](../adr/0154-chave-de-dispositivo-de-maquina.md) 决定。这是机器身份的 WEB 一半：[RN-543](produto.md#rn-543) 让密钥列表标记「种类」（`projeto` | `maquina`）*"para que uma chave de máquina não ficasse
invisível em toda tela"*，却没有消费者。本 RN 就是消费者。

**缺陷，已测量。** `RunnerOnboardingPanel` 是「三个」引导点（`TerminalPanel`、`FolderBrowserModal` 以及 `NewProjectWizard` 的 `workspace` 步骤）都挂载的面板，而它只有一个问题：*"configure a pasta"*。有了 ADR 0154 的机器密钥，这个问题在最常见的情况下变成错误的——机器已经配对，缺的是代理在运行。
让人重复机器已有的配对，是面板在用一个最终落到她终端里的流程回答错误的问题。

**七种状态，没有一种会变成另一种（[RN-088](#rn-088)/[RN-470](#rn-470)）。** `semPapel`（我们没有问）、
`verificando`（问了还没回来）、`naoSei`（询问失败）、
`semChaveDeMaquina`（回来了，没有）、`revogada`（有过，已被吊销）、
`pareadaNuncaUsada`（有活动密钥，但没有任何代理用过——[RN-519](api.md#rn-519) 的「孤儿」在新种类中重生）以及 `pareada`。**「不知道」绝不变成「没有」**，两种空状态有不同的文字，因为动作不同：一个要求配对，另一个解释代理为什么不再连接。失败由 `isError` 推导，而不是由是否有 `status` 推导——网络错误没有状态码，从状态码推导会让一个被拒绝的 `fetch` 永远在「verificando…」中转圈，十秒之后这就是因省略而撒谎。`semChaveDeMaquina` 是唯一什么都不渲染的状态，而且是有意的：整个面板本身「就是」对「没有配对的机器」的回答。

**识别「不」等于说代理在运行，尺子还是那把。** `workspaceVerifiedAt` 是一次确认的记录，不是心跳（[RN-468](#rn-468)）；已登记的密钥是早一步的同一回事——它证明机器曾经被配对过，绝不证明现在有活着的进程。把两者混淆的界面会比今天的「更糟」，因为今天的至少不撒谎。因此提示的色调是 `accent`，绝不是 `success`（绿色会被读成「在运行」——与 `AmbienteDoProjeto` 在 runner 那一行做的是同一种算术），保留说明以文字写在旁边，而回答「现在」的仍然是 `EsperaDoRunner`（[RN-474](#rn-474)），「复用」而非重写：机器被识别后，缺的是代理「连接」，而这恰恰是它的问题。

**还有第二道界限，由数据施加，任何措辞都抹不掉：列表属于「账户」，不属于这个浏览器。** `runner_device_keys` 不知道浏览器在说哪台机器，所以界面最多能断言 *"sua
conta tem uma máquina pareada"*——绝不是 *"esta máquina está pareada"*。这就是为什么浏览器流程（[ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)）**没有被移除**：它换了「位置」，移到一个 `<details>` 中，其标签点名了它仍是答案的唯一情况（「estou em outra máquina」）。让它退役是 `BRB-031`，维护者的决定，而不是本次交付的后果。

**「种类」会显示，显示的是它的「代价」。** 面板不列出密钥，也不提供吊销——那是 web 从未获得的界面，即 RN-519 开放的一半，是另一条战线。它说的是这个种类对读者意味着什么：机器密钥服务其所有者在 `runner` 模式下的「所有」项目，吊销它会在所有项目中断开本地代理（[RN-520](api.md#rn-520)，其 `{projeto, usuário}` 范围在这里不变）。没有这句话，RN-543 的标记就只是装饰。

**角色是「端点」的，api 是权威。** 最低角色来自 `roleAtLeast`（[RN-102](api.md#rn-102)）对照 `developer`，即 `RunnerDeviceKeysController` 在三个路由上要求的——界面不再询问 api 会拒绝的东西，并以「文字」说明原因「一次」（`disabled` 元素上的 `title` 在 Chromium 中不会弹出）。这**不是安全边界**：拒绝的是 `RolesGuard`。真正的 403 落入「同一」状态，这不是冗余——读取的角色是 WORKSPACE 的，而授权的是项目的「有效」角色（[RN-471](#rn-471)），在两个方向上都是覆盖：代理（proxy）避免显然会输的询问，api 纠正这个代理。

**它出现在哪里，以及为什么在三个挂载方中不一样。** 识别是按「项目」的，因为路由是 `GET /projects/:projectId/runner-device-keys`——它存在于总有项目的 `TerminalPanel` 和 `FolderBrowserModal` 中，而在 `NewProjectWizard` 中只在提前创建（[RN-437](#rn-437)）「之后」才存在。没有 `projectId` 就没有可以询问的对象，面板逐字节保持原样。这种差异不是设计选择：而是端点的形态。

- **代码：** `apps/web/src/lib/agente-de-maquina.ts`（完整的推导——
  `reconhecerAgenteDeMaquina`、`podeLerChavesDeDispositivo`、
  `maquinaJaPareada`），`apps/web/src/components/RunnerOnboardingPanel.tsx:173`
  （两个查询以及 `ReconhecimentoDeMaquina`），
  `apps/web/src/components/RunnerOnboardingPanel.module.css`
  （`.reconhecimento`、`.gesto`），`apps/web/src/lib/api-client.ts:434`
  （`listRunnerDeviceKeys`），`apps/web/src/lib/api-types.ts:773`
  （`RunnerDeviceKeyListItem`、`RunnerDeviceKeyEspecie`），
  `apps/web/src/locales/{en,pt-BR}/terminal.json`（`agenteDeMaquina.*`）
- **测试：** `apps/web/src/lib/agente-de-maquina.test.ts`——正常路径（活动且已使用，在 N 把中取「最近」的使用）以及不坍缩的七种状态，包括「没有」状态码的失败和「不」算数的「项目」密钥；
  `apps/web/src/components/RunnerOnboardingPanel.test.tsx`——面板宣布配对并给出服务的动作、ADR 0118 的流程被折叠但仍可到达、两条保留说明（「não é agente rodando」、「é da sua CONTA」）加上范围的那条、被「吊销」的密钥重新要求配对、失败的查询说明自己不知道、低于 `developer` 的角色不调用路由，以及没有 `projectId` 的向导无从询问
- **已「声明」的缺口，之后由 [RN-552](api.md#rn-552)「关闭」：** 本 RN 关闭时，没有人「创建」机器密钥（那是 `install.sh`，ADR 0155 第 4 点，第 6 次会话），所以这个界面只能用手工登记的密钥演练——与 RN-543 和 RN-544 已经声明的同一半。面板提供的命令是 `brabo-runner service status --project <id>`，即「今天」存在的形式；按机器的形式随第 4 次会话的 unit 到来——**之后已关闭（AT-106）**：识别出「机器」密钥后，面板提供 `brabo-runner service status --machine`（[RN-545](runner.md#rn-545) 的机器 unit），「项目」密钥那一块继续提供 `--project <id>`；两个种类都活动时各显示各的。命令仍然是让人去「询问」——界面不断言答案（键 `agenteDeMaquina.comandoDeServico` 和
  `chaveDeProjeto.comandoDeServico`，测试在 `RunnerOnboardingPanel.test.tsx` 中，覆盖两个分支以及两者并存）。一把活动的「项目」密钥「不」改变面板：这是姊妹缺陷，低一层范围，关闭它是另一个决定——**之后已关闭（AT-107）**：面板识别「本」项目的活动「项目」密钥（`reconhecerChaveDeProjeto`，`lib/agente-de-maquina.ts`，同一个列表、同一个 `queryKey`，没有新路由），使用同样的词汇——色调 `accent`、已登记的密钥不等于代理在运行、动作是检查服务——并说明该「种类」的代价：吊销会断开「本」项目中的代理，而不是所有项目。其他项目的密钥和已吊销的不算，ADR 0118 的 `<details>` 仍可到达。而 web 仍然没有可以列出或吊销设备密钥的「界面」（[RN-519](api.md#rn-519) 开放的一半）——本次交付消费列表而不构建它。**之后由 [RN-561](#rn-561)「关闭」**，它构建了它：设置中的那一节复用这里的 `podeLerChavesDeDispositivo` 和「同一个」`queryKey`，因此在那里吊销会使这个面板的识别失效
- **ADR：** [0154](../adr/0154-chave-de-dispositivo-de-maquina.md)
- **来源：** FASE 30，第 7 次会话——
  [阶段的范围划定](../explanation/fase-30-runner-por-maquina.md)

---

## 模式转换不再是盲目一跳（RN-559，RN-560）

### RN-559 — 转换为 `mounted` 打开与向导「相同」的文件夹浏览器；`runner` 分支仍需输入，界面说明原因 {#rn-559}

`ExecutionModeSection` 曾是产品中选择文件夹的**五个地方中唯一一个**需要**盲目**输入路径的地方——其他四个自 [RN-473](#rn-473)/[RN-504](#rn-504) 起就打开 `FolderBrowserModal`。这一缺口已在 `CLAUDE.md` 中声明，声明的原因来自**另一个分支**：在转换保存「之前」引导 runner，会在一个还不是 `runner` 的项目上登记密钥，而 `ConfirmProjectWorkspaceUseCase` 会以 400 拒绝。这些对 `mounted` 都不适用，而这正是本规则要关闭的。

**相同的组件、相同的传输、没有新尺子。** `mounted` 分支以 `origem: { tipo: 'api', workspaceId }` 挂载 `FolderBrowserModal`——与 `NewProjectWizard` 对这种模式使用的同一个可辨识联合（[RN-533](#rn-533)），因为文件夹位于「服务器」的基目录之内（[ADR 0141](../adr/0141-base-unica-dos-projetos-montados.md)），看得到它的是服务器。不会诞生新的浏览器或新的端点，浏览器也**不保证**路径有效：负责校验的仍是 `validarExecutionModeEWorkspacePath` 和数据库的 CHECK。

**`runner` 分支「不」获得浏览器，这是决定，不是遗忘。** 它的传输（`{ tipo: 'runner', projectId }`）要求有 runner 连接到「本」项目，而一个还不是 `runner` 的项目没有任何 runner——等待会以一个看起来像 bug 的错误结束。*"converte, depois onboarda"* 的顺序仍是另一个产品决定。变化在于界面开始以文字**说明**这一点，而不是只不提供任何按钮，这是 [ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md) 的尺子：去掉的是控件，绝不是信息。

**基目录是一个「四值」状态，它们不会坍缩。** 路由 `GET workspaces/:workspaceId/projects-base`（[RN-500](api.md#rn-500)）可能正在进行、已失败、已回应 `null` 或已回应一个路径——每一种都有「自己的」文字，按 [RN-088](#rn-088)/[RN-468](#rn-468) 的尺子：*"不知道"* 绝不变成 *"没有"*。在前三种状态下按钮留在界面上并变暗，原因以「文字」写在其下方，而不是通过 `title`（在 `disabled` 元素上它在 Chromium 中不会弹出）。

| 基目录状态 | 按钮 | 界面说明 |
|---|---|---|
| 进行中 | 变暗 | "consultando a base de projetos desta instalação" |
| 查询失败 | 变暗 | 无法「得知」它是否存在；请重新加载 |
| 回应 `null` | 变暗 | 此安装未声明基目录 |
| 回应一个路径 | 可用 | 基目录，「点名」，以及浏览器就在其中打开 |

缺少基目录时 `mounted` 模式**不会离开选择器**，这是与向导（[RN-513](#rn-513)）的有意区别：一个「已经」是 `mounted` 的项目，不能因为一次进行中的查询而看到自己的模式从控件中消失。消失的是「浏览器」，不是转换。

**最低角色是「端点」的。** `PUT projects/:projectId/execution-mode` 和 `GET workspaces/:workspaceId/projects-base` 都要求 `maintainer`，通过 `roleAtLeast` 在 `ROLE_ORDER` 上读取，绝不通过手写的角色列表（[RN-102](api.md#rn-102)）——这一节原本写的是 `role === 'owner' || role === 'maintainer'`，在最低角色较高时碰巧正确。达不到最低角色的人不会触发基目录查询：它会以确定的 403 结束，而它产生的 *"不知道"* 会是关于授权的，而不是关于基目录的。

在浏览器中选定的值被当作「输入」的值对待：它填充字段，只在有人点击该节的按钮确认时才发往 api。这一节**不会变成自动保存**（[RN-469](#rn-469)）。

- **代码：** `apps/web/src/routes/settings/ExecutionModeSection.tsx:68`（基目录的四种状态，作为联合）、`:211`（通过 `roleAtLeast` 的最低角色）、`:220`（对达不到 `maintainer` 的人不发出的查询）、`:260`（四种状态的推导）、`:280`（浏览器存在所需的条件）、`:414`（按钮，变暗而不隐藏）、`:423`（`runner` 分支的文字）、`:475`（带 `origem: { tipo: 'api', workspaceId }` 的 `FolderBrowserModal`）；
  `apps/web/src/locales/pt-BR/settings.json:231` 和
  `apps/web/src/locales/en/settings.json:231`（`executionMode.path.*`，两种语言的五段文字）
- **测试：** `apps/web/src/routes/settings/conversao-de-modo.test.tsx`——正常路径（打开浏览器、选择 `loja`、字段被填充，转换在按钮点击「之后」才发送所「选」的值）、基目录查询「失败」（按钮惰性、自己的文字、模态框即使强制也不挂载、字段仍可编辑）、基目录「缺失」且文字与失败和加载时「不同」、没有按钮且以文字说明原因的 `runner` 分支，以及低于 `maintainer` 的角色（控件变暗、当前值仍可见、不触发基目录查询）
- **已「声明」的缺口：** 这一节的 `runner` 分支**仍然盲目输入**——`CLAUDE.md` 的缺口缩小到它，并未关闭。关闭它需要决定「先转换，后引导」的顺序，这是另一个产品决定，仍然无人负责。*更新：* 该顺序已在 [RN-612](#rn-612) 中决定并测量——`runner` 分支在保存「之后」获得引导，而浏览器出于那里所说明的另一个原因仍不在其中
- **ADR：** [0111](../adr/0111-conversao-de-execution-mode-de-projeto-existente.md)，
  [0141](../adr/0141-base-unica-dos-projetos-montados.md)
- **来源：** AT-049（EP-021/HS-033）

### RN-560 — 转换提示说明它拒绝什么、带走什么以及「不」带走什么——并点名旧路径 {#rn-560}

这一节的固定提示用两种语言断言 *"isto migra a pasta de trabalho do agente"*。`ConvertProjectExecutionModeUseCase` **没有一行代码复制或移动文件夹内容**：它移动 `permissions.json`（「策略」，allow/deny/ask 原样保留——[RN-448](api.md#rn-448)），清空 `workspaceVerifiedAt`（[RN-450](api.md#rn-450)）和 `mirrorPath`（[RN-515](api.md#rn-515)），在「离开」`container` 时撤销容器配置（[RN-449](api.md#rn-449)），并写入新的 `workspacePath`。`materializarWorkspaceMontado` 只是「创建」新文件夹（[RN-501](api.md#rn-501)）。旧文件夹中的任何东西——**包括未提交的工作**——都留在那里，成为孤儿。

自 [RN-447](api.md#rn-447)..[450](api.md#rn-450) 起，孤儿就已是 `CLAUDE.md` 中声明的缺口。本规则关闭的不是孤儿：而是界面断言了与服务器所做「相反」的事情。这是对断言的更正，不是功能——在模式之间迁移内容仍不在范围内，无人负责。

**三个事实，而不是一段话**，因为它们回答不同的问题：

1. **转换「拒绝」什么**——现在正在工作或卡住的 dev agent 会变成 409，出现在 toast 中的是 api 的语句（已有且仍然有效的文字）；
2. **它「带走」什么**——项目的策略改变范围，内容保持不变；
3. **它「不」带走什么**——文件夹的内容，包括未提交的工作，**并点名旧路径**。

**提示「点名」路径**，因为不说是哪个磁盘的 *"留在旧磁盘上"* 会让人去找。这个值就在一行之外（`project.workspacePath`），并在转换保存的那一刻**从界面上消失**。当没有可点名的路径时——项目是 `container`，旧文件夹是「服务器」上的卷——语句是「另一句」，指向托管文件夹：一个 `{{caminho}}` 为空的变体会说 *"o que estiver em "*，这是界面拒绝说出它知道的东西。而这恰恰是人最难猜到的情况。

**它不承诺检测。** 向磁盘询问 *"有未提交的工作吗？"* 是按模式的 I/O，对 `runner` 而言从 api 一侧不可能回答：文件夹在服务器看不到的机器上。不测量，就不断言（ADR [0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)/[0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)）。它也不阻止任何东西：转换仍然是同一次调用，带着同样的拒绝。

`Alert` 的色调从 `accent` 变为 `warning`，因为第三个事实是可达性的「丧失」，而不是中性信息。它仍然没有 `role="alert"`：这是界面打开时就已在其上的文字，那里的断言式实时区域会成为没有原因的打断。

- **代码：** `apps/web/src/routes/settings/ExecutionModeSection.tsx:333`（三个事实，每行一个）、`:337`（点名旧路径的变体 × 托管文件夹的变体）；
  `apps/web/src/locales/pt-BR/settings.json:220` 和
  `apps/web/src/locales/en/settings.json:220`（`executionMode.warning.*`，两种语言的四段文字——`en` 是应用的默认语言（[RN-425](api.md#rn-425)），一个只用葡萄牙语诚实的提示是带着口音的同一个谎言）
- **测试：** `apps/web/src/routes/settings/conversao-de-modo.test.tsx`——正常路径（提示包含旧路径「以及」「trabalho não
  commitado」这几个词）、没有旧路径的变体（`container` 项目指向托管文件夹，带路径的变体「不」渲染），以及在「两个」语言包中的否定证明：迁移的承诺在两者中都不幸存，四个键在两者中都存在
- **「条件性」后果（AT-144）。** 本规则留下的问题——列出「所有」后果，还是只列出误导人的那一个——已由维护者决定：**只列出对「本」项目成立的**。提示在三个事实之后，为每个适用的后果加一行，对不适用的「一行都不加」：

  | 行 | 何时出现 | 与用例相同的条件 |
  |---|---|---|
  | 镜像目标被清空，「点名」 | `mirrorPath` 有值 | 每次转换都会清空（[RN-515](api.md#rn-515)） |
  | 已登记的容器被停止并删除 | 项目「今天」是 `container`，且生命周期存在于 `removed` 之外 | `removerContainerSeExistir` 只在「离开」`container` 时运行（[RN-449](api.md#rn-449)） |
  | 「无法读取是否有容器」 | 项目是 `container`，且生命周期读取「失败」 | ——（「不知道」绝不变成「没有」，[RN-468](#rn-468)） |
  | 在 `<data>` 确认的文件夹不再有效 | `workspaceVerifiedAt` 有值 | 每次转换都会清空（[RN-450](api.md#rn-450)） |

  即使有已登记的容器，容器那一行在 `mounted`/`runner` 中也**不**出现，因为用例在那里不删除它——提示会说出与服务器相反的话，而这正是本规则存在就是为了关闭的缺陷。数据是这一节已有的（`Project`：`mirrorPath`、`workspaceVerifiedAt`、`executionMode`），再加上这一节原本「不」加载的容器生命周期：它来自「已」存在的路由 `GET projects/:projectId/container/lifecycle`（`viewer`），只在项目是 `container` 时查询——没有新端点。读取进行中时，这一行干脆不出现。
  - **代码：** `apps/web/src/routes/settings/ExecutionModeSection.tsx:102`
    （`consequenciasCondicionais`）、`:118`（`containerParaOAviso`，三种状态）、`:236`（`cicloQuery`，只在 `container` 中）、`:344`（`Alert` 中的四行）
  - **测试：** `apps/web/src/routes/settings/conversao-de-modo.test.tsx` 中的 `AT-144` describe——没有任何条件（不多加一行）、已登记的容器、不算数的 `removed` 行、以自己的文字表示的读取「失败」、带镜像的 `mounted`（镜像那一行有，容器那一行没有，查询也不发出）、文件夹已确认的 `runner`（带日期），以及 `en` 中的三个条件行
- **ADR：** [0111](../adr/0111-conversao-de-execution-mode-de-projeto-existente.md)
- **来源：** AT-050（EP-021/HS-034）；条件行，AT-144（EP-021/HS-034）

## 设备密钥获得界面，界面说明吊销的范围（RN-561）

### RN-561 — 设置标签页列出并吊销设备密钥，并标记「种类」——因为吊销「机器」密钥会在所有者的「所有」项目中断开本地代理 {#rn-561}

[RN-519](api.md#rn-519) 缺失的那一半，自那时起就在 `CLAUDE.md` 中以书面形式声明：*"o que segue aberto é só a TELA: `apps/web` não tem onde listar
nem revogar, então quem quiser revogar chama a rota"*。两个路由都存在——`DELETE` 自 [ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md) 起，`GET` 自 RN-519 起——，而**没有任何界面使用它们**。本 RN 就是那个界面，它**不开新路由**：列表已经返回的东西足以画出下面的一切。

**它放在哪里，以及为什么是「项目」的。** 它让设置标签页从 17 节变为 **18** 节，是**渲染顺序中的第 13 节**（`device-keys`，`pessoas` 组，紧接 `access-tokens`——对 PAT 做同样事情的邻居）；注册顺序与 barrel 「相同」，因为 scroll-spy 用的就是它。属于项目，是因为端点是 `/projects/:projectId/runner-device-keys`：一个「账户」界面需要新路由，而这次的范围是现有的那个。

**「种类」会显示，它不是装饰——它是界面上唯一不可逆操作的范围。** 自 [RN-543](produto.md#rn-543) 起列表标记 `projeto` | `maquina`，一把「机器」密钥（`project_id` 为空）**服务其所有者的所有项目**，因此出现在「所有」项目的列表中。不带标记地显示它，会让界面断言它是「本项目的密钥」，点击吊销的人会以为只在这里断开本地代理，而实际上会**在所有地方**断开——界面会恰恰在最不能出错的事情上撒谎。机器密钥的标记是 `warning`，项目密钥是 `muted`，**绝不是 `success`**：绿色会被读成「在运行」，这正是 [RN-548](#rn-548) 已经拒绝的算术。

**确认「取决于」种类，并且也说明附带代价。** 吊销会打开一个有「三」句话的对话框，中间那句会变：机器密钥那句点名 *todos os seus projetos em modo runner*（`RevokeRunnerDeviceKeyUseCase` 在 `listRunnerModeReachableBy` 上的循环），项目密钥那句点名 *o projeto dela*。两者共用一段文字会在其中一半撒谎。第三句是 [RN-520](api.md#rn-520) 声明而本次交付**不改变**的代价：断开连接的目标是 `{projeto, usuário}`，绝不是 `{chave}`，所以同一用户在同一项目中的另一个 runner 也会断开——即使以 PAT 或另一把密钥认证——如果其凭据仍然有效，它会自行重连。

**登记的使用「不」等于代理在运行，词汇与 RN-548「相同」。** `lastUsedAt` 与 `workspaceVerifiedAt`（[RN-468](#rn-468)）是同一类数据：一次确认的记录，绝不是心跳。保留说明以「文字」写在图例中，状态列谈论的是「吊销」（「ativa」/「revogada」，关于那一行的事实），绝不谈论连接——知道「现在」的仍然是终端的频道。为同一区分发明第二套词汇，就是界面用两种方式说同一件事，而其中一种会过时。

**五种状态，没有一种会变成另一种（[RN-088](#rn-088)/[RN-470](#rn-470)）。** 没有密钥（「Nenhuma chave de dispositivo sua serve este projeto」）、已「吊销」的密钥（按 RN-519 的决定**仍留在列表中**——让这一行消失会让界面断言它从未存在，它不获得按钮，因为再次吊销即使在 api 中是幂等的，也会暗示一个并未剩下的效果）、`lastUsedAt` 为空（[RN-473](#rn-473) 的「孤儿」密钥：由一个在流程中途关闭的标签页登记，从未被任何 runner 使用——有自己的文字，表格下方还有一段只在存在孤儿时才出现的解释，因为解释没有发生的事就是噪音）、「还没加载」以及「无法读取」。**「不知道」绝不变成「没有」。**

**角色是「端点」的，并且是项目的「有效」角色。** 最低角色是 `developer`——`RunnerDeviceKeysController` 在「三个」路由上都要求的（[RN-102](api.md#rn-102)）——比较来自 RN-548 创建的「同一个」函数（`podeLerChavesDeDispositivo`，基于 `roleAtLeast`），绝不是第二把尺子，也绝不是手写的 `role === 'x' || role === 'y'`。与 RN-548 相比改变的是「输入」：那里面板读取 WORKSPACE 角色并**声明**缺口，因为它挂载在不查询 `project_members` 的地方；这里数据就在手边——这一节与 `MembersSection` 在同一标签页，使用「同一个」`queryKey`，react-query 会去重——，所以角色像用例中那样组合（`projectRole ?? workspaceRole`，两个方向上的覆盖，[RN-471](#rn-471)），缺口**关闭**而不是重复。角色「缺失」不等于角色「不足」：成员列表还在进行中时，界面说明正在核实，不会指责读者达不到 `developer`。达不到的人**仍能看到**整节、设备密钥是什么以及吊销机器密钥的代价——消失的是「控件」，绝不是「信息」（[ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md)）——，原因以「文字」说明「一次」（`disabled` 元素上的 `title` 在 Chromium 中不会弹出）。由于三个路由要求「同一」角色，达不到的人也看不到「列表」：界面不再询问 api 会拒绝的东西，而不是把可预见的 403 变成「无法读取」。这**不是安全边界**——拒绝的是 `RolesGuard`。

**一次一个，所以没有批量结果。** 界面不提供「全部吊销」，所以 [RN-469](#rn-469) 的尺子——变成 N 次
调用的 UI 操作不是事务，界面要说明这一点——不适用：提供批量操作会为一个没人要求的动作制造一个需要叙述的部分结果。吊销失败会显示 api 「自己」的语句，那一行**仍留在**列表中。

- **代码：** `apps/web/src/routes/settings/RunnerDeviceKeysSection.tsx:76`
  （整节；有效角色在 `:107`，查询在 `:130`，按种类的确认在 `:326`）；
  `apps/web/src/routes/settings/sumario.ts:62`（新条目，18 节中渲染顺序的第 13 节）；
  `apps/web/src/routes/ProjectSettingsTab.tsx:86`（组合，按「同样」顺序）；`apps/web/src/locales/{en,pt-BR}/settings.json`
  （`runnerDeviceKeys.*`）。消费 `listRunnerDeviceKeys`/
  `revokeRunnerDeviceKey`（`apps/web/src/lib/api-client.ts:431`）和
  `podeLerChavesDeDispositivo`（`apps/web/src/lib/agente-de-maquina.ts:68`），两者都未改动
- **测试：** `apps/web/src/routes/settings/chaves-de-dispositivo.test.tsx`——同一列表中被标记的两个种类；留下的已吊销密钥，带标记且没有按钮；有自己文字的孤儿密钥，以及没有孤儿时「不」出现的解释；文字不同的空状态和失败；登记的使用不等于代理在运行的保留说明；「两个」种类的范围提示，调用只在确认之后发出；取消而不吊销；失败带来 api 的语句且密钥仍在列表中；`viewer` 不调用路由并以文字说明原因；项目角色在「两个」方向上的覆盖；以及缺失的角色说「verificando」而不是指责
- **已声明且「未」关闭的：** (1) **吊销的目标**仍然是 `{projeto, usuário}`，绝不是 `{chave}`——界面「说明」这一点且不改变它，因为改变它需要 `runner_socket_tickets` 中的新列和新的认证契约（RN-520），是带 ADR 的另一条战线；(2) 在**没有项目**的安装中，[RN-552](api.md#rn-552) 刚创建的机器密钥仍然**无法到达**：两个路由都是项目的，没有项目就没有可以询问的对象——已在 [RN-611](api.md#rn-611) 中「关闭」，有按「账户」的路由和节；(3) `maintainer` 的视图（列出/吊销任何用户的）仍按 RN-519 的决定排除在外，不是这个界面的遗漏；(4) 没有浏览器 E2E——这里证明的是界面「断言」的东西，而这由组件套件证明
- **来源：** AT-012（EP-003/HS-007）

---

### RN-568 — 团队面板中 QA、SecOps 和区域成员的存在由「整个」会话决定，而不是 200 个事件的窗口 {#rn-568}

概览和执行者标签页用 `deriveAgentRoster` 在会话的「最后」200 个事件上组装名册（`useSessionEvents`，`latest: true`）。其中两个存在事实来自这个窗口：`gatesEverOpened`（当已经发生过某个 `pr.gate_changed`/`infra.gate_changed` 时，qa 和 secops 进入）和 `delegatedSubagents`（有登记的委派时区域成员进入）。这两个事件是一次执行最早的事件之一——在长会话中它们会离开窗口，QA、SecOps 和 `qa-automacao` 就会**从仍在运行的执行的面板上消失**。这与 `executionActivated` 已经关闭过的是同一类缺陷，而 workspace 摘要（[RN-090](api.md#rn-090)）早已在整个会话上聚合这两个事实（`projects-summary.repository.ts` 中的 `bool_or` 和 `selectDistinct`）——两个界面都加载了它，却忽略了这两个字段。

**规则：** `deriveAgentRoster`/`rosterFactsFromEvents` 接受一个
「可选」的 `agregado`（`AgregadoDaSessao`），两个界面用摘要来填充它。四个决定，各有原因：

1. **缺失是「没读到」，绝不是「没有发生」。** 没有加载摘要时（首次绘制、错误），事实只来自窗口，与以前完全一样。缺失的读取绝不会变成「QA 不在这里」。
2. **聚合值「叠加」到窗口上，而不是取代它**（gate 上的逻辑或，委派上的并集）。这两个事实在一个会话内是「单调」的——打开过的 gate 不会撤销打开，登记的委派不会消失——，所以窗口只会产生假「阴性」，绝不会产生假阳性。一个与窗口中「看到」的 gate 不一致的聚合 `false`，是滞后的摘要（两种读取各有自己的轮询节奏），不能把 QA 藏起来。
3. **只有当摘要属于界面所读取的「同一」会话时才有效**（`latestSessionId === sessionId`）。摘要聚合的是项目「最近」的会话；概览读取的就是这个会话，但执行者标签页读取的是当前的「执行」会话（[RN-139](api.md#rn-139)）。之后打开的一次构思会让两者分歧，那时聚合值就属于「另一个」会话——界面回到只由窗口决定。
4. **只改变「存在」。** `rosterFromFacts`（唯一的规则，与 dashboard 卡片共享）保持不变，每个代理的「状态」（`gateStatus`、`subagentStatus`）仍从窗口读取。没有新请求，200 的上限不变。

`delegatedSubagents` 以「同一」模式加入，因为它无需改变规则就能放进来：摘要读取的 `delegations` 表与窗口读取的 `delegation.*` 事件在 `RecordDelegationUseCase` 中一起诞生（一行、一个事件、三种结果），所以两个集合描述的是同一件事。

**`executionActivated`（AT-130）。** 这是同一模式的第三个事实：执行者标签页原本从摘要读取它而「没有」第 3 项的守卫，所以当存在比执行会话更新的会话时，（属于它的）摘要会说 `false`，dev agent 就会消失——或者说 `true`，它们就会在没有证据的情况下出现。现在它只在 `latestSessionId === sessionId` 时进入 `agregado.executionActivated`，而 `deriveAgentRoster` 把它与窗口和参数「叠加」（逻辑或，单调），后者也开始查看事件中的 `execution.activated`。API 中没有新字段。测试：`ProjectExecutorsTab.test.tsx`（「另一个」会话的摘要，两个方向）。
**仍然开放：** 当执行会话很长「且」摘要属于另一个会话时，事件可能已经离开窗口，标签页又回到只由它决定——这是守卫的代价，与其他两个事实相同。

- **代码：** `apps/web/src/lib/agent-status.ts:324`（`AgregadoDaSessao`），

- **代码：** `apps/web/src/lib/agent-status.ts:324`（`AgregadoDaSessao`）、
  `:296`（`rosterFactsFromEvents` 的可选参数）、`:304`（委派的并集）、`:312`（gate 的或）、`:410`（由 `deriveAgentRoster` 转交的参数）；`apps/web/src/routes/ProjectOverviewTab.tsx:97` 和
  `apps/web/src/routes/ProjectExecutorsTab.tsx:111`（带会话守卫的聚合值）
- **测试：** `apps/web/src/lib/agent-status.test.ts:628`（整个块：
  `:633` 窗口之外的 gate 带回 QA/SecOps 并使用窗口中的状态，`:658` 没有聚合值时窗口独自决定，`:676` 聚合的 `false` 不会隐藏窗口中看到的 gate）；`apps/web/src/routes/ProjectExecutorsTab.test.tsx:385`
  （QA 和区域成员通过摘要回来）、`:397`（另一个会话的摘要不做决定）；`apps/web/src/routes/ProjectOverviewTab.test.tsx:301`（SecOps 通过摘要回来）
- **来源：** AT-047——在 `CLAUDE.md` 以及两个界面的注释中声明的缺口

### RN-572 — 团队的树翻译 engine 发出的每个 `dev.*` 类型，只在面板显示 `trabalhando` 的地方才说明正在进行的工作 {#rn-572}

在一次真实安装中（9月14日），dev agent「没有走出 *começou a task*」。event log 中有 `dev.started`，随后是 `dev.blocked_by_container`，带有完整的 `reason`（[RN-502](engine.md#rn-502)）。团队的树（`timeline-tree.ts`）没有阻塞的翻译——不在 `TRADUCAO` 中的会被丢弃——，于是分支停在前一个里程碑，而现在时的语句对一个已停下的代理断言了工作。同一执行界面上的团队面板对同一事件已经显示 `aguardando`（`DEV_STATUS_EVENTS`，[RN-411](ci.md#rn-411)）：两个界面、两张表，而只有其中一个被与 engine 词汇的比较所覆盖。

**规则**，分三部分：

1. **engine 发出的每个 `dev.*` 类型在树中都有决定**——在 `TRADUCAO` 中翻译，或在 `TRADUCAO_FORA` 中声明并附原因（目前为空）。遗漏不再可能：`scripts/ci/vocabulario-de-eventos-dev.spec.ts` 用与事件清单相同的提取器推导 engine 的词汇，并在缺少时点名该类型失败；也会在翻译了 engine 不发出的 `dev.*` 类型时失败。第一轮就发现了「两个」缺失（`dev.blocked_by_container` 和 `dev.error`）和「一个」多余（`dev.rearmed`，api 以 `user` 执行者写入，因此从未到达任何分支——树只挂载 `agent` 执行者的里程碑）。
2. **一个 dev agent 的最后里程碑是否是进行中的工作，不在树中决定。** 对 `dev.*` 里程碑而言，只有当面板对同一事件给出 `trabalhando` 时（`statusDoEventoDev`，读自 `DEV_STATUS_EVENTS`），分支才是「活动」的。`aguardando`、`ocioso`、`falhou` 和 `travado` 让分支停下——随之还有 `dev.idle`、`dev.blocked`、`dev.awaiting_gate`、`dev.awaiting_approval` 和 `dev.idle_tripped`，它们之前也算作活动。面板未决定的 `dev.*` 类型「不」变成活动：有疑问时界面不断言工作。
3. **因容器而阻塞是自己的里程碑**（`espera`，颜色为 `warning`，与 gate 相同），以 engine 的 `reason` 作为详情——正是它说明该做什么。而 `dev.started` 不再说「começou a task」：在 engine 中测得，它在「收到」工作命令时、在 `try_claim` 之前发出（`DevAgentServer.handle_cast(:work)`）；它改为说「procurando task」，断言 task 的是 `dev.working`，它现在显示 task 的标题。

**本规则「不」做的，以及原因：**

- **`container.start_failed` 不进入树。** 它是阻塞的原因，但执行者是 `system`（`action-executor`）：把它挂到某个 dev agent 的分支上就是捏造作者，而结构中唯一的另一个地方 `tronco` **没有被任何消费者渲染**（已测量：`AgentTimelineTree` 和 `Shell` 的活动部分只读取 `ramos`）。该事件仍在按时间排序的日志中，一点即达，而被阻塞的分支已经通过 `reason` 说明缺的是启动容器。
- **树的标签在这次修正中保持固定的 pt-BR**——迁移它们是整个界面的改动。AT-134 之后做了这次迁移，而它「没有」触动上面的规则：按类型的「决定」（是否成为节点、什么 `MarcoTipo`、什么详情）仍在代码的 `TRADUCAO` 中，spec 正是拿它与 engine 比较；移出去的只有「文字」，作为「键」（`ChaveDeRotulo`）在 `executors:timelineTree.label.*` 中解析，现在时的语句在 `timelineTree.now.*` 中，来源详情在 `timelineTree.detail.origin` 中，两种语言都有（`en` 是默认，[RN-425](api.md#rn-425)）。`montarArvore` 以参数接收语言（`getFixedT`），两个消费者（`AgentTimelineTree` 和 `Shell` 的活动部分）从 `useTranslation` 传入——切换语言会重建树。表中使用的键如果在两个语言包之一中没有文字，`timeline-tree.test.ts` 会失败。

- **代码：** `apps/web/src/lib/timeline-tree.ts:161`（`TRADUCAO`）、`:205`
  （`dev.started`）、`:206`（带标题的 `dev.working`）、`:222`
  （`dev.blocked_by_container`）、`:227`（`dev.error`）、`:246`
  （`TRADUCAO_FORA`）、`:307`（从面板读取的 `ativo`）、`:96`
  （`ChaveDeRotulo`，AT-134）、`:135`（`tradutorDaArvore`）；
  `apps/web/src/locales/{en,pt-BR}/executors.json`（`timelineTree.label`、
  `timelineTree.now`、`timelineTree.detail`）；
  `apps/web/src/lib/agent-status.ts:134`（`statusDoEventoDev`）；
  `apps/web/src/components/AgentTimelineTree.module.css`（`.espera`）
- **测试：** `scripts/ci/vocabulario-de-eventos-dev.spec.ts:300`（树的块：`:308` engine 的每个类型都已决定、`:324` 没有翻译 engine 不发出的东西、`:342` 两边都没有遗留）；
  `apps/web/src/lib/timeline-tree.test.ts:130`（测得的序列：
  `dev.started` + `dev.blocked_by_container` 让分支带着原因停下——失败用例）、`:149`（`dev.started` 不断言 task）、`:156`
  （面板不称为工作的状态让分支停下；`dev.working` 带标题保持活动）、`:168`（`dev.error` 以原因结束）、`:367`
  （AT-134：每个使用的键在两个语言包中都有文字，子树有相同的键，传入的语言优先于当前语言）
- **来源：** AT-087——9月14日的真实安装；标签的 i18n，AT-134

## 仓库在给 Arquiteto 的 handoff 接受时诞生，没有它执行就不开始（RN-582）

### RN-600 — 通过界面创建项目时不发送已知 api 会拒绝的请求体，一次只创建一个，拒绝显示在界面上 {#rn-600}

在 9月26日负责人的测试中，api 在约 4 秒内记录了 11 次 `POST /workspaces/:id/projects →
400`，而同一个 `runner` 项目通过 api 带路径创建时返回 201。通过阅读测量并在向导的 vitest 中复现：没有自动重试（`createProject` 被直接调用，没有 `useMutation`），所以每个 POST 都是一次「点击」。可能的原因是 `runner` 模式的「Procurar pasta...」，它会提前「创建」项目（[RN-437](#rn-437)）：在详情步骤中，路径字段位于名称「之上」，在输入名称之前点击会发送 `{ name: '', slug: '', executionMode: 'runner', workspacePath:
'/workspace-a-confirmar' }`——`CreateProjectDto` 拒绝少于 2 个字符的 `name` 和不是 kebab-case 的 `slug`——，而失败只变成 toast「Não deu
para preparar a navegação de pasta agora」，没有原因；再点一次是界面暗示的唯一回应。「一个」字母的名称能通过 `Continuar`，却在「Provisionar」时因同一个 `MinLength(2)` 返回 400。

三个部分，全部在界面上（api 拒绝是对的）：

1. **不发送已知会被拒绝的东西。** `nomeAceitoPelaApi` 镜像 DTO（2 个以上字符、去除首尾空白、slug 非空），并成为详情步骤的名称闸门。在 `runner` 模式中，当名称未通过，或「输入」的路径不合理时（`caminhoLocalParecePlausivel`），「Procurar pasta...」保持「惰性」，原因以文字写在字段下方（`procurar-bloqueado`，ADR 0064）。「空」路径仍然不阻止——[RN-437](#rn-437) 的临时占位符会覆盖它。这是对 RN-437 中「nunca bloqueando o clique」这句话的修订，那句话说的是「路径」，没有预见到空名称。名称以去除首尾空白后的形式进入请求体。
2. **一次一个创建。** `criacaoEmVoo`（一个 `useRef`）锁住「两条」创建路径——「Procurar pasta...」和「Provisionar」——，因为 `disabled` 要到下一次渲染才会到达按钮。在 jsdom 中 `disabled` 已经能挡住第二次点击；ref 才能挡住浏览器同一帧中的两个事件。
3. **拒绝显示在界面上。** 提前创建的 400 失败改为把 api 的语句（`mensagemDaApi`，合并 `class-validator` 的列表）放进「Provisionar」已经使用的同一步骤的「同一个」`Alert` 中（[RN-170](api.md#rn-170)）；其他错误仍只显示 toast。

**未测量的：** 负责人测试的 api 日志没有在容器重启后保留，所以 11 个 POST 中每一个的「请求体」都没有看到——上面的原因是阅读代码和 vitest 唯一能复现的，并不能证明就是它。相邻问题（[RN-437](#rn-437)）保持原样：以临时路径提前创建的项目，之后在「Provisionar」时不会收到细化后的路径（它被「复用」，而不是更新）——修正它的是连接时的 runner（RN-423）。

- **代码：** `apps/web/src/lib/wizard.ts:108`（`nomeAceitoPelaApi`）；
  `apps/web/src/routes/NewProjectWizard.tsx:112`（`montarPayloadDeCriacao`）、
  `:202`（`criacaoEmVoo`）、`:321`（`bloqueioDoProcurarNoRunner`）、`:486`
  （`handleProcurarPasta`）、`:536`（`handleConfirm`）
- **测试：** `apps/web/src/routes/NewProjectWizard.test.tsx:850`（describe
  `criar projeto sem rajada de 400`——没有名称，11 次点击且没有 POST；相对路径；一个字母的名称；去除首尾空白的名称；同一帧中的三次点击只创建一个；界面上 api 的拒绝）；`apps/web/src/lib/wizard.test.ts:210`
  （`nomeAceitoPelaApi`）
- **来源：** AT-215（负责人测试，9月26日），AT-214 的姊妹

## 模式转换不再是盲目一跳（RN-559，RN-560）

### RN-612 — 转换为 `runner` 是先转换、「之后」引导：保存会挂载现在已是 `runner` 的项目的引导面板，文件夹浏览器按构造不在其中 {#rn-612}

转换的 `runner` 分支曾是盲目输入的（[RN-559](#rn-559)），因为顺序尚未决定：在保存「之前」引导，会在一个还不是 `runner` 的项目上登记密钥，而 `ConfirmProjectWorkspaceUseCase` 以 400 拒绝确认。维护者的决定是用「机器」密钥（[RN-543](produto.md#rn-543)/[RN-548](#rn-548)）**测量**另一种顺序，如果摩擦可以接受就实现。测量是在「代码」上做的（没有启动环境），结果如下：

| 谁将服务这个项目 | 保存之后会发生什么 | 动作 |
|---|---|---|
| 正在等待的「机器」代理（零个 `runner` 项目，[RN-550](runner.md#rn-550)） | `GET /runner/projects` 的下一次查询会列出它，代理自行连接——`espera-de-projetos.ts` 的 15/30/60 秒节奏 | **零**，最多 60 秒 |
| 已在服务「另一个」项目的「机器」代理 | 列表在启动时只读「一次」，带活动连接（RN-550）——新项目**不会**进入 | **一个**：重启服务 |
| 没有机器密钥 | 与项目创建时相同的配对（[RN-473](#rn-473)） | 配对 + 一条命令 |

在三种情况下摩擦都等于或小于项目创建，所以转换变成**同一节中的两步**：保存为 `runner` 会在下方挂载与代码标签页和向导「相同」的 `RunnerOnboardingPanel`，使用一个现在「就是」`runner` 的项目的 `projectId`——对已配对机器的识别、`EsperaDoRunner` 以及 ADR 0118 的配对一并到来，没有新尺子。在面板上方，这一节「说明」机器代理的不对称（自行等待 × 重启），并附两个平台的重启命令（`systemctl --user restart brabo-runner.service`、`launchctl kickstart -k gui/$(id -u)/dev.brabo.runner`）：界面不知道代理是否有另一条活动连接，所以它点名两种情况，而不是断言其中一种。

当「已保存」的项目是 `runner`、选择器中没有待定的模式更换、且文件夹尚未确认时，面板出现——或者持续到转换保存的那次访问结束，这样 `EsperaDoRunner` 能显示确认，而不是在确认到达的那一刻消失。已经确认过的 `runner` 项目不会获得它。

**输入的路径是「临时」的，界面说明这一点。** 决定 `runner` 项目文件夹的是 runner：确认会「覆盖」`workspacePath`（[RN-423](runner.md#rn-423)），机器代理甚至不看输入的值——它使用 `<base>/<workspaceDirName>`（[RN-544](runner.md#rn-544)）。该字段仍是必填的，因为数据库的 CHECK 在 `container` 之外要求非空路径；这一节不捏造占位符。

**文件夹浏览器仍然不在 `runner` 分支中，现在是出于正确的原因。** 不再是顺序问题：而是传输 `{ tipo: 'runner', projectId }` 要求有 runner 连接到「本」项目，而已连接的 runner 已经确认了「自己的」文件夹（`--dir`，或从基目录推导的那个）。在那里选择另一个，就是一次下一次重连会撤销的 `runner → runner` 第二次转换。提供这个按钮就是一个什么都控制不了的控件；这一节以文字说明这一点（[ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md)）。

- **代码：** `apps/web/src/routes/settings/ExecutionModeSection.tsx:300`
  （`mostrarProximoPasso`）、`:313`（`setConvertidoParaRunner`，转换保存的那次访问）、`:452`（下一步的块）、`:483`
  （`RunnerOnboardingPanel`，与代码标签页的相同）；
  `apps/web/src/locales/pt-BR/settings.json:249` 和
  `apps/web/src/locales/en/settings.json:249`（`executionMode.nextStep.*`）以及
  `:241`（`executionMode.path.runnerTyped`，已重写）；测得的节奏在
  `apps/runner/src/espera-de-projetos.ts:60`（`CADENCIA_DA_ESPERA_MS`），只读一次的列表在 `apps/runner/src/index.ts`（`rodarComoAgenteDeMaquina`）
- **测试：** `apps/web/src/routes/settings/conversao-de-modo.test.tsx` 中的 `RN-612` describe——正常路径（保存之前没有面板；保存挂载下一步，带重启命令，面板询问「本」项目的密钥）、识别出的机器密钥、失败用例（已确认的 `runner` 项目不获得这一步）、另一种模式的草稿隐藏这一步，以及 `en` 中的文字
- **已「声明」的缺口：** 已在服务另一个项目的机器代理的重启仍是终端中的一个动作——带活动连接重新查询列表已被 RN-550 拒绝，本规则不重新打开它。而且测量是「代码」层面的，不是界面层面的：环境没有启动
- **ADR：** [0111](../adr/0111-conversao-de-execution-mode-de-projeto-existente.md)，
  [0154](../adr/0154-chave-de-dispositivo-de-maquina.md)
- **来源：** AT-143（EP-021/HS-033）

---

## 仓库在给 Arquiteto 的 handoff 接受时诞生，没有它执行就不开始（RN-582）

### RN-614 — 界面在两个地方用同一句话显示策略的原因和范围的根 {#rn-614}

[RN-567](api.md#rn-567) 在 `proposed_action.created` 中放入了做出决定的规则（`reason`），[RN-609](api.md#rn-609) 放入了范围的根（`scopeRoot`，只在 `terminal` 中）——两者都声明界面不变。通过界面审计一个「通过」了的操作的人，仍然不知道是哪条规则让它通过的。

**规则：** 数据出现在「两个」地方（维护者的决定），两者说的是由「一个」函数 `fraseDaDecisaoDaPolitica` 组装的「同一」句话：

- **日志面板中的事件行**——`classifyEvent` 获得 `proposed_action.created` 的分支（类型 `permission`，被拒绝时为 `bad`），带有策略的结果，破折号之后是这句话；
- **`ApprovalCard`**，紧接在说明会发生什么的语句（[RN-096](produto.md#rn-096)）下方的独立一行中——绝不在折叠的 payload 里。

操作（`proposed_actions`）不保存这两个字段中的任何一个：界面从它已经加载的「事件」中读取它们（`decisaoDaPoliticaDaAcao`，按 `actionId`）。因此卡片有「三」种状态，不会坍缩：不读取 event log 的界面（「precisa de você」面板、PR、容器）不传入数据，卡片「沉默」；读取的界面（会话聊天和审批标签页的队列，两者都基于最近的会话）在已加载的窗口中没有找到事件时说 *"fora dos eventos carregados nesta tela"*；找到事件则给出这句话。Insights 标签页没有 `ApprovalCard`——Psicólogo 的假设不是 `proposed_action`。

**自 AT-336（[RN-656](api.md#rn-656)）起，审批标签页的每张卡片都有「自己」的原因**，当已加载的日志不覆盖时按操作读取；下一段是它所取代的 AT-333 的状态——统一的说明只留给「失败」的读取。自 AT-340 起，聊天中「其他」会话待办的卡片也是如此（[RN-626](#rn-626)），它们以前是沉默的：线程的日志永远不覆盖另一个会话的操作。

**在 AT-333 中，审批标签页的队列开始只说明「一次」缺口。** 队列是「项目」的（[RN-638](#rn-638)），而事件是「一个」会话的，所以在那里 *"fora dos eventos carregados"* 几乎在每张卡片上都会出现——按卡片重复的事实，就是工具在解释自己。api 不按操作暴露原因（操作不保存它，事件读取也不按 `actionId` 过滤：已测量），而不带窗口的查找需要新端点。于是标签页改为「计数」没有事件的待办，并在队列上方的说明中说明有多少以及为什么（*"destas N ações"*，或 *"de N das M ações abaixo"*），仿照 [RN-180](#rn-180)；这些的卡片保持沉默（「不读取的界面」状态），事件已加载的卡片继续显示这句话。说明只在手中有日志时才计数：事件到达之前它不断言任何东西。会话聊天仍对每张卡片使用三种状态——那里的截断就是线程本身的截断。

**缺失不等于「没有原因」，绝对路径永远不会出现。** RN-567 之前的事件说 *"motivo da política não registrado"*；RN-609 之前的 `terminal` 说 *"raiz do escopo não registrada"*；其他类型没有 `scopeRoot`，不谈根（范围只在 `terminal` 中被查询）。四个锚点都有自己的文字——托管文件夹、项目基目录内的段、runner 机器上的文件夹名，以及 `indisponivel`（*"sem forma relativa"*，没有段）。界面不认识的锚点会说它不认识，并且不打印段：界面不重建任何路径。这些语句有 `en` 和 `pt-BR` 版本（`approvals.json`，键 `politica`）。

- **代码：** `apps/web/src/lib/decisao-da-politica.ts:111`
  （`fraseDaDecisaoDaPolitica`）、`:65`（`lerDecisaoDaPolitica`）、`:124`
  （`decisaoDaPoliticaDaAcao`）、`:145`（`linhaDoEventoDePolitica`）；
  `apps/web/src/lib/activity.ts:721`（`proposed_action.created` 的分支）；
  `apps/web/src/components/ApprovalCard.tsx:272`（卡片中的那一行）；
  `apps/web/src/routes/session-timeline-montagem.tsx:825` 和
  `apps/web/src/routes/ProjectApprovalsTab.tsx:307`（`decisoesDaPolitica`，自 AT-336 起通过 `useDecisoesDaPolitica`）以及 `:499`（传入数据的一方）
- **测试：** `apps/web/src/lib/decisao-da-politica.test.ts:43`（锚点，
  `:43`/`:54`/`:65`/`:76`）、`:87`（旧事件）、`:102`（未知锚点不泄露路径）、`:114`（两种语言）、`:144`（日志行「就是」卡片的语句）；`apps/web/src/components/ApprovalCard.test.tsx:733`（卡片使用同一个函数，以及三种状态）；
  `apps/web/src/routes/ProjectApprovalsTab.test.tsx:304`（自 AT-336 起，说明只计数失败的读取）
- **来源：** AT-148（EP-025/HS-043）；队列的说明，AT-333；按卡片的原因，AT-336

---

## 代理回复的语言（RN-618..620、RN-622..624、ADR 0177）

### RN-620 — 会话栏显示「查看者」回复的语言及其来源，在那里更改就是只针对此人、此会话的覆盖 {#rn-620}

1. **在模型选择器旁边，属于另一个范围。** 栏中的模型属于「会话」，对所有人有效；语言属于「人」（`GET
   .../sessions/:sessionId/response-language`，为调用者解析，[RN-618](api.md#rn-618)）。在那里更改就是按会话的覆盖——维护者的决定，AT-169 回答 2——，绝不改动其他参与者的设置，也不改动账户。
2. **绝不显示没有来源的值**（[RN-470](#rn-470) 的尺子）：「fixado
   por você nesta sessão」「escolhido por você na Conta」「detectado pelas
   suas mensagens e confirmado por você」和「o idioma da interface」是四段文字，没有一段坍缩成另一段。加载中和失败也有自己的文字——失败不假装是一种语言。检测到的语言绝不变成对人的断言（「você é brasileiro」），只是关于消息的（AT-080）。
3. **「Seguir a Conta」释放覆盖**（`language: null`），并说明这会得到「什么」语言——去掉会话这一级的同一条链，在客户端由路由已经返回的链推导，没有新端点。「Outro
   código…」打开一个只在按钮点击时才固定的字段（RN-469），api 的拒绝以其语句出现在 toast 中。一个链接通向账户，那里存放对所有会话都有效的选择。
4. **谁来更改**：`PUT` 的最低角色（`developer`），通过 `roleAtLeast` 基于 WORKSPACE 角色（不查询 `project_members` 的界面所声明的缺口）。低于它时，值和来源仍在栏中，选择器惰性，原因以文字给出。
5. **栏「不」断言的**：绝不把「代理以 X 回复」作为关于人的事实——只有有效语言和来源。自 [RN-622](engine.md#rn-622) 起，这个有效语言随查看者的消息到达模型，「ainda não
   chega aos agentes」的提示已从来源行中移除。这一行在栏的 60px 处截断，并在 `title` 中带有完整文本——文本在界面上，`title` 只还原省略号截掉的部分。
6. **在窄栏中，语言「换位置」而不消失**（AT-317）。栏按「自身」宽度排布（`modoDaBarra`，由 `ResizeObserver` 测量；宽度未知时为完整栏）：从 1720px 起所有东西在一行；低于此值时，模型、语言和预算变成「一个」控件，其触发器概括模型和语言代码（低于 920px 时只有图标，带可访问名称），它的面板带有完整的指示器，来源会「换行」而不是截断。检测的问题（[RN-624](api.md#rn-624)）住在面板中，存在期间触发器获得一个标记，可访问名称会宣布它。会话标题是唯一会收缩的项（有下限，完整名称在 `title` 中），按钮不换行——「Encerrar」只在最小栏中变成带可访问名称的图标。

- **代码：** `apps/web/src/routes/SessionLanguageIndicator.tsx:79`
  （`SessionLanguageIndicator`）、`:35`（`idiomaSemOverride`）、`:170`
  （`origemPorExtenso`）、`:219`（`podeTrocar`）；
  `apps/web/src/routes/SessionTopbar.tsx:247`（`SessionLanguageIndicator`）、
  `:120`（`modoDaBarra`）、`:364`（`AjustesAgrupados`）；
  `apps/web/src/lib/modo-da-barra-da-sessao.ts:35`（`modoDaBarra`）
- **测试：** `apps/web/src/routes/SessionTopbar.test.tsx:174`（1440px 的栏不是完整的）、`:191`（分组，面板带有含来源的语言）、
  `:236`（带可访问名称的最小栏）、`:256`（待定问题标记控件）、`:273`（语言读取失败——失败用例）；
  `apps/web/src/routes/SessionLanguageIndicator.test.tsx:99`
  （带来源的有效语言和链接，没有旧提示）、`:112`（检测到的不会变成「escolhido」）、`:126`（更改只固定于本会话）、`:151`（「Seguir a
  Conta」发送 `null`）、`:180`（api 的拒绝——失败用例）、`:202`
  （低于 `developer`）、`:213`（读取失败）、`:225`（去掉会话的链）
- **来源：** AT-165，基于 AT-169（回答 2）和 AT-168（回答 7）的决定

## 在聊天中决定，就在负责人所在的地方（RN-626）

### RN-626 — 会话聊天可以决定 agent 在另一个会话中提出的内容，显示正在进行的轮次并提议合并——不改变任何上限 {#rn-626}

2026-09-29 的真实使用测量了这样一种代价：负责人在一个会话中对话，而 dev agents 在另一个会话中提出提议：它们的审批从未出现在他所在的地方，173 次点击「Sempre permitir」中有 45 次返回 409（操作已离开 `pending` 后卡片仍可点击），而在有轮次进行中时重新打开会话，composer 是空闲的并返回 409。四项修正都在「界面」——api、engine 和所有上限保持不变。

1. **卡片变为不可操作并显示 api 的句子（AT-256）。** `ApprovalCard` 在决定进行中时锁住按钮（双击必然是 409），并且当调用返回被拒绝的 promise 时，在卡片「上」显示 api 发来的句子——绝不是通用的 toast。409（操作已不是 `pending`）会让按钮保持不可操作并以文字显示原因，直到列表把卡片换成结果行。调用方返回 promise，并且「即使」被拒绝也重新获取列表（`finally`）：每次点击「一次」失效，没有新的轮询，失效使用 [RN-579](engine.md#rn-579) 的通道和预算。
2. **重新打开会话会从日志恢复轮次（AT-268）。** 界面的轮次状态是本地 `useState`，离开就丢失。在首次读取一个 `active` 会话的事件时，`turnoEmCursoNoLog` 查看每个 agent 最近持久化的 `agent.status`（与 [RN-578](engine.md#rn-578) 的 `turnoTerminouNoLog` 相同的读取方式）；处于 `working` 的会重新打开状态条，并通过与已接受轮次相同的入口锁住 composer（`iniciarTurnoDoAgente` +
   `acompanharTurnoPeloLog`），日志尾部的读取会把它关闭。每个挂载的会话只运行「一次」（反复执行的 effect 会用缓存中仍存在的旧 `working` 重新武装状态条）。engine 重启留下的 `working` 会在启动时被新事件关闭（[RN-586](engine.md#rn-586)），所以剩下的是活着的轮次。**不排队消息：** 有轮次进行中时，消息仍以命名的 409 被拒绝——队列是负责人待定的决定（AT-267）。
3. **项目中「其他」会话的待处理项出现在聊天中（AT-265）。** `PendenciasDeOutrasSessoes` 读取 `GET /projects/:id/actions?status=pending`（与 PR 标签页和「需要你处理」面板相同的端点），并绘制「不」在本会话中产生的那些——本会话的由消息流来决定。它是「快捷方式」，绝不是替代（[RN-467](#rn-467)）：「同一个」`ApprovalCard`，同样的端点，使用操作本身携带的 `sessionId`；`onActivateAutoMode` 被排除（那是策略，不是决定）。两个队列——审批和 PR 合并——有「各自」的标题和计数，绝不相加，每一行注明来源会话。绘制上限为 20 张卡片，超出部分会说明（"Mostrando N de M"）：声明的截取，同 [RN-180](#rn-180)。轮询使用会话的节奏（通道断开时 5 秒，通道活着时 15 秒的回退——`intervaloDaSessao`），因为会话的通道不会通知另一个会话的写入。
4. **在已打开 PR 的卡片上「Mergear」（AT-266）。** 在已执行的 `pr_open` 卡片下方，且仅当 `action.pr_open` 事件带有 PR 的 id 并且该 PR 没有活着的 `git_merge`（待处理、已批准或自动批准）时，该按钮通过与 PR 标签页相同的端点「提议」`git_merge`（角色 `user`，在本会话中）。提议以常规卡片出现在消息流中，带「批准/拒绝」：**确认是同一个，并且由人来做**——在受保护分支上合并仍是无条件 `require_approval`（[RN-418](api.md#rn-418)），不自动批准，没有「始终允许」，没有自动模式。api 的去重和拒绝（PR 已合并、合并已提议——[RN-663](api.md#rn-663)）以 api 的句子传达给负责人；待处理的 gate 不是拒绝，而是按钮旁的文字提示。
5. **角色以「端点」为准，缺口已声明。** 决定操作和提议操作都要求 `developer`（`actions.controller.ts`）；界面对「工作区」角色使用 `roleAtLeast`，因为会话页不获取 `project_members`——这是 [RN-471](#rn-471) 的同一个缺口，在此声明而未关闭。达不到的人「能看到」待处理项和按钮，控件不可操作并以文字说明原因（`bloqueio`，属于 `ApprovalCard`）：去掉的是控件，绝不是信息。

**本规则「不」覆盖的内容，已声明：** (a)「Mergear」不会一次点击就提议「并」批准——需要两次点击，提议和确认，这是有意的；(b) 轮次恢复读取的是已加载的事件窗口，窗口之外的 `agent.status` 看不到（不知道不等于「正在工作」）；(c) 其他会话待处理项列表有 20 张卡片的上限，其余仍在「审批」标签页；(d) 架构待处理项和 Psicólogo 的假设仍然「没有」内联决定（它们没有 `ApprovalCard`）。

- **代码：** `apps/web/src/components/ApprovalCard.tsx:228`（`decidir`，进行中的决定和卡片上的拒绝）；`apps/web/src/lib/session-turno.ts:59`
  （`turnoEmCursoNoLog`），`:532`（`useRetomarTurnoDoLog`）；
  `apps/web/src/lib/pendencias-do-projeto.ts:24`（`usePendenciasDoProjeto`），
  `:56`（`separarPendenciasDeOutrasSessoes`）；
  `apps/web/src/components/PendenciasDeOutrasSessoes.tsx:65`
  （`PendenciasDeOutrasSessoes`）；`apps/web/src/routes/MergearNoChat.tsx:28`
  （`prAbertaDaAcao`），`:56`（`jaHaMergeDaPr`），`:89`（`MergearNoChat`）；
  `apps/web/src/routes/SessionPage.tsx:150`（`podeDecidir`），`:272`
  （`useRetomarTurnoDoLog`），`:767`（`PendenciasDeOutrasSessoes`）
- **测试：** `apps/web/src/components/ApprovalCard.decisao-em-voo.test.tsx:37`
  （双击），`:52`（卡片上的 409 和不可操作的按钮——失败情形），`:67`
  （非 409 的错误会恢复按钮）；`apps/web/src/lib/turno-em-curso-no-log.test.ts:18`
  （working），`:22`（idle 和 awaiting_approval 会关闭），`:38`（窗口中没有状态——失败情形）；`apps/web/src/routes/SessionPage.retomar-turno.test.tsx:159`
  （界面恢复，日志解锁），`:182`（idle 不会凭空造出轮次——失败情形）；`apps/web/src/components/PendenciasDeOutrasSessoes.test.tsx:71`
  （分开的队列，操作的 sessionId），`:99`（低于 developer 的角色——失败情形），`:109`（卡片上的 409），`:126`（截取）；
  `apps/web/src/routes/MergearNoChat.test.tsx:62`（事件中的 PR），`:75`
  （去重），`:100`（以用户身份提议，不批准），`:121`（api 拒绝——失败情形），`:134`（角色——失败情形）
- **来源：** AT-256、AT-268、AT-265 和 AT-266，来自对 2026-09-29 真实使用的分析（第 4、5 和 10a 项），第 27 轮，lane web-sessao

### RN-631 — 聊天的接收者是被选择且可见的，handoff 提议按 `handoffId` 匹配 {#rn-631}

composer 消息的接收者原先是「推导」出来的：「200 个事件窗口内最近的 `agent.activated`」（发现 9-fix）。这是「界面」一侧的默认接收者——[RN-584](engine.md#rn-584) 在 engine 中关闭的那一类缺陷——而且是「不可见」的：composer 不说明消息发给谁，在此界面接受 handoff 除了日志之外什么也不改变。在 9月29日的真实使用中，会话先后对 Infra 和 Arquiteto 有 `handoff.accepted`，用户的「oi」被 Arquiteto 回答了，界面没有任何提示。并且接受卡片按「角色/`toAgent`」对来匹配提议与事件（`e.actor.id ===
offeredHandoff.fromAgent`），尽管 `handoff.offered` 从一开始就带有 `handoffId`（AT-251）。

**规则：**

1. **「选项」** 是会对话的 agent（`AGENTES_DE_CHAT`）中已经在会话里的：窗口中的 `agent.activated`、项目摘要的 `roster.activatedAgents`（[RN-630](api.md#rn-630)，「整个」会话，只用「同一」会话的摘要，仿照 [RN-568](#rn-568)），或「已接受」的 handoff（handoff 列表没有窗口）。后两项就是 [RN-180](#rn-180)：agent 不会因为激活事件移出 200 个事件而从选择器中消失。在创意会话中，Criativo 在激活之前就是选项，因为第一条消息会激活它（发现 3）。
2. **接收者是该人「选择」的**——在 composer 的「Para」选择器中，或在「此」界面接受一个 handoff（召唤该 agent 的动作；失败的接受不改变任何东西）。日志中的任何内容都不会替她选择：在另一个标签页或经由其他路径完成的接受只会增加一个选项。
3. **「唯一」选项就是接收者，composer 在发送前点明它。** 这不是 [RN-584](engine.md#rn-584) 意义上的默认值——消息没有别的 agent 可去。
4. **有两个或更多选项且没有有效选择：没有接收者。** 「Enviar」（以及 Enter）被锁住，界面以「文字」说明需要选择——绝不是「最近的那个」。零选项是没有 agent 的会话聊天（SSE），界面同样会说明。**由 [RN-682](api.md#rn-682) 修订：** 零选项同样锁住发送——没有 agent 的咨询会话需要一个 agent，界面不再调用直达原始模型的 SSE。
5. **选择按会话记在 `localStorage` 中**——这是查看者的便利（没有存储时界面只是重新要求选择），绝不是产品状态。
6. **「Parar」停止的是「该轮」的 agent**（`turnoAgentRef`、`streamingAgent`、`statusAgent`），只有在没有它时才是接收者：在另一个 agent 的轮次中途切换选择器，不能停错对象。顶栏显示的模型跟随接收者。
7. **提议按 payload 的 `handoffId` 匹配**，绝不按角色：每个 `handoff.offered` 就是它自己那份提议的卡片，没有可混淆的配对，也没有要挑选的「最近」。发给已激活 agent（窗口「或」`roster.activatedAgents`）的提议不会再变得可接受。

8. **每个待处理的提议都可操作，没有一个会遮住另一个**（AT-253）。卡片原先只选「一个」提议（`handoffs.find`，最早的待处理项），而「手动」handoff（[ADR 0109](../adr/0109-handoff-manual-a-agente-a-escolha.md)，[RN-441](api.md#rn-441)）——以「人」为角色记录，因而从不按角色匹配——既没有「Aceitar」，又遮住了后续的提议。现在，发给会对话的 agent 的每个待处理提议（Infra 的除外，它有自己的卡片，[RN-499](#rn-499)）都在其事件上有按钮；发给「同一」agent 的两个待处理提议只给一个按钮，即最近那个的按钮，接受它会通过 `activeFor` 移除另一个。手动 handoff 的标签显示「Handoff manual」，而不是该人的 id。
9. **「已在会话中」从「没有」窗口、限定在「所请求」会话的来源中读取**（PR #759 的审查）。摘要中的 `roster.activatedAgents` 属于项目「最近」的会话，而激活执行会「创建」一个新会话，它随即成为最近的会话：聊天会话因此失去整个来源，又回到依赖 200 个事件的窗口。现在的合计有「三个」来源——摘要，仅当它属于本会话时；「本」会话的 handoff（接收了已接受 handoff 的，以及「提出」过 handoff 的，后者当时就在会话中）；以及「本」会话按 agent 的花费（`GET .../token-usage`，无窗口的聚合：在那里有记录的 agent 运行过轮次，而只有被激活的才会运行轮次）。每个来源只纠正假阴性，花费是「在场」的证据，绝不是缺席的证据。**声明的缺口：** 通过 `start` 直接激活、没有 handoff、从未运行过轮次、且所在会话已不是最近会话的 agent，仍依赖窗口——角色低于 `developer`（花费路由的最低要求）的人没有第三个来源。要关闭它需要 api 中「按会话」的激活聚合；此处没有做。
10. **事件已移出窗口的待处理提议，会在 composer 上方的固定条中获得按钮**（PR #759 的审查）。可操作的卡片属于 `handoff.offered`，而 handoff 列表没有窗口：在长会话中，提议仍是 `offered`，却在任何地方都没有按钮。标准是「截断」，而不是缺失——提议早于窗口中最早的事件（刚创建、事件尚未到达的提议不会在条上闪现），空窗口不能断言截断。固定条只有接受；Dev Lead 卡片上的「Ativar execução」快捷方式留在消息流中。

[RN-584](engine.md#rn-584) 的守护（`scripts/ci/destinos-do-composer.spec.ts`）改为读取 `DESTINATARIO_DA_SESSAO_CRIATIVA`，而不是 `SessionPage.tsx` 中的字面量：composer 可能给出的每个目标在 engine 中仍有自己的子句。api 和 engine 没有任何改动。

- **位置：** `apps/web/src/lib/session-destinatario.ts:210`（`agentesEmConversa`），
  `:237`（`resolverDestinatario`），`:272`（`useDestinatarioDoChat`），`:116`
  （`useAtivadosNaSessaoInteira`），`:141`（`ativadosSemJanela`）；
  `apps/web/src/routes/SessionComposer.tsx:287`（`destinatarioRow`），`:193`
  （`ofertasForaDaJanela`）；`apps/web/src/routes/SessionPage.tsx:350`
  （`aceitarHandoff`）；`apps/web/src/routes/session-timeline-montagem.tsx:547`
  （`handoffIdDoEvento`），`:555`（`origem`）；`apps/web/src/lib/session-handoffs.ts:68`
  （`activeFor`），`:120`（`ofertasAcionaveis`），`:142`（`ofertasForaDaJanela`）
- **测试：** `apps/web/src/routes/SessionPage.destinatario-do-chat.test.tsx`
  （选择 → 发送给所选者；两个 agent 且未选择时不发送并说明原因；唯一选项；窗口外已接受的 handoff；同一会话和另一会话的摘要；会改变接收者的接受和失败的接受；记住的选择；没有 agent 的会话；最近的执行会话，激活从本会话的 handoff 和花费中读取，以及花费被拒绝；窗口外的提议出现在固定条中，窗口内或比窗口更新的提议不在其中），
  `apps/web/src/lib/session-destinatario.test.ts`（`ativadosSemJanela`），
  `apps/web/src/routes/SessionPage.handoff-inline-e-links.test.tsx`（「其他」`handoffId` 的旧提议保持静默），
  `apps/web/src/routes/SessionPage.handoff-manual.test.tsx`（手动 handoff 获得「Aceitar」；待处理的手动 handoff 不遮住后续提议；发给同一 agent 的两个变成一个按钮）
- **来源：** AT-251，AT-253

### RN-632 — 「项目」读取按项目节奏轮询，所有监听会话通道的界面都通过「同一个」窗口失效 {#rn-632}

9月29日的真实使用在两个标签页打开时撞上了用户每分钟 300 次请求的上限（[RN-579](engine.md#rn-579)）：07:14 出现 192 次 429，其中 106 次在 `GET /projects/:id/sessions`，20 次在 `GET /projects/:id`，中途有三次 `approve_always` 点击被拒绝（AT-278）。RN-579 把「会话」界面的读取置于通道之下；「项目」的读取以及其他监听通道的界面被落下了。上限「不」变：降低的是请求。

**规则：**

1. **没有任何通道通知的项目读取以 15 秒轮询**（`INTERVALO_DO_PROJETO_MS`），「无条件」。`session:<id>` 通道只通知本会话的写入；项目的会话列表和侧轨的计数器（最近会话的审批、项目的待合并、待提升的故事、架构待处理项、假设）会因「任何」会话的写入而变化——没有可等待的通知，所以机制是长轮询，与 RN-579 已对会话接受的回退相同。适用于 `useProjectSessions`/`useLatestSession`（原为 5 秒）、`ProjectPage` 框架的五个计数器以及「执行者」标签页的架构。把该数据作为「主题」展示的标签页（Backlog、架构、PR）保持自己的轮询，最快的观察者决定该键的节奏。在此标签页写入的一方仍立即使该键失效。
2. **只在点击时才需要数据的不轮询。** `/containers` 的每一行读取其项目的最近会话，以便「提议」停止/移除/启动；在 5 秒轮询下，「每个项目」每分钟 12 次——九个项目，仅这个页面每分钟 108 次，与日志中的 106 次吻合。`useLatestSession(projectId, false)`：挂载和窗口获得焦点就够了。
3. **所有监听通道的界面都经过 `criarInvalidadorDoCanal`。** 「执行者」和「概览」标签页在「每个」`event.appended` 时都让事件失效，没有窗口：一个突发的 dev agent（每秒 10 次通知）仅在「执行者」标签页就造成每分钟 630 次事件 GET。现在两者使用与会话界面「相同」的失效器（按目标的窗口，由「类型」决定目标），并顺带得到了原先缺少的东西：dev agent 的操作提议会立即使操作失效，而不是等待 15 秒的回退。「概览」通过 `extras` 参数在每次通知时请求 backlog（被阻塞的 task 来自它），使用同一窗口。
4. **等待 runner 在结束时停止。** `EsperaDoRunner` 只在「上限」时停止对 `GET /projects/:id` 的探测（3 秒）；连接确认后，上限的 effect 提前退出，探测则永远继续——面板在屏幕上时每分钟 20 次，并且作为 `['project', id]` 最快的观察者，拖着整个页面的键。现在在上限「或」确认时停止。

**数字**（`duas-abas.orcamento.test.tsx`，真实的界面——`Shell`、`SessionPage`、处于「执行者」标签页的 `ProjectPage`、`ContainersPage`——基于按路由计数的 `fetch`；每个标签页单独测量，因为两个标签页是两个 JS 上下文，再相加；每分钟请求数，`dev` → 本规则）：

| 场景 | 之前 | 之后 |
|---|---|---|
| 会话聊天 + 执行者，通道活着 | 70 + 138 = 208 | 70 + 72 = 142 |
| 同上，dev agent 突发（每秒 10 次通知） | 70 + 764 = 834 | 70 + 97 = 167 |
| 同上，通道从未连接 | 155 + 186 = 341 | 155 + 120 = 275 |
| 9 个项目的 `/containers` | 132（其中 108 来自 `/sessions`） | 24 |

**本规则「不」覆盖的内容：** 两个标签页的通道都「断开」时，每分钟 275 次仍接近上限——会话界面回到一贯的 3 秒（RN-579：绝不比以前更差），每分钟 25 次的余量会被一阵点击消耗掉。`Shell` 仍以 5 秒轮询 `projects-summary` 和 `execution/session`，并在聊天标签页中以 3 秒轮询「执行」会话的事件（该标签页没有它的通道）——占聊天标签页每分钟 70 次中的 44 次。在另一个标签页创建的会话列表会在最多 15 秒内出现在这里（原为 5 秒）。事故的数字是「对上」的，不是复现的：日志没有说明打开了哪些标签页，而 `/containers` 在其中之一的判断是从 106 ≈ 9 × 12 推断出来的。

- **代码：** `apps/web/src/lib/canal-vivo.ts:54`（`INTERVALO_DO_PROJETO_MS`），
  `:255`（`aoEvento`，`extras`）；`apps/web/src/lib/hooks.ts:127`
  （`useProjectSessions`），`:158`（`useLatestSession`）；
  `apps/web/src/routes/ProjectPage.tsx:77`（侧轨的计数器）；
  `apps/web/src/routes/ContainersPage.tsx:62`（`useLatestSession`，不轮询）；
  `apps/web/src/routes/ProjectExecutorsTab.tsx:203`（`invalidador`），
  `apps/web/src/routes/ProjectOverviewTab.tsx:191`（`invalidador`）；
  `apps/web/src/components/EsperaDoRunner.tsx:73`（`confirmadoPor`）
- **测试：** `apps/web/src/routes/duas-abas.orcamento.test.tsx`（两个标签页，通道活着、突发、通道从未连接，以及 `/containers`；四者在 `dev` 上都不通过）；`apps/web/src/components/EsperaDoRunner.test.tsx`
  （"confirmada a espera, a sonda PARA" 以及失败情形：没有确认时继续）；`apps/web/src/routes/ContainersPage.test.tsx`（"a linha lê a sessão
  mais recente SEM poll"）
- **来源：** AT-278（[RN-579](engine.md#rn-579) 的扩展；不改变 RN-108——一次性 ticket 和手动重连保持不变）

### RN-633 — 手动 handoff 不声明就绪，提议的「已激活」以项目为准 {#rn-633}

会话界面的两处读取让 handoff 显得过时（AT-293、AT-294）：

1. **「手动」handoff 不会隐藏「Estou pronto para produzir」或「Confirmar arquitetura pronta」**（AT-293）。`prontidaoJaDeclarada` 和 `arquiteturaJaDeclarada` 只问「是否存在从 Criativo/Arquiteto 发出的 handoff？」，而手动 handoff（[ADR 0109](../adr/0109-handoff-manual-a-agente-a-escolha.md)，[RN-441](api.md#rn-441)）把「最后」激活的 agent 记为 `fromAgent`（`request-manual-handoff.use-case.ts`）：在 Criativo 活跃时向 Staff 请求手动 handoff，会在没有声明任何就绪的情况下隐藏就绪按钮。手动 handoff 通过 `handoff.offered` 的人类「角色」识别（按 `handoffId` 匹配，[RN-631](#rn-631)）——api 的 `Handoff` 不带角色。在 200 窗口之外角色未知，此时：对 Criativo 以 `artifactId` 为准（就绪 handoff 带有 `product_brief`，`criativo_server.ex`；手动 handoff 从不带产物）；对 Arquiteto，两种自动 handoff 都不带产物，因此来源未知的仍照旧计数。**声明的缺口：** 持久的标记应当是 api 的 `Handoff` 本身上的角色（或手动标记）；此处没有做（api 属于生命周期那条 lane，ADR 0182）。
2. **对已在项目另一会话中「活跃」的 agent 的提议不可操作**（AT-294）。「活跃」原先以「会话」为准：在「Ativar execução」之后，Dev Lead 在执行会话中运行，而聊天会话中给它的提议仍显示「Aceitar」。现在，提议（消息流中的卡片、窗口外的固定条和 Infra 的卡片）在「已进入本会话」之外再加上摘要的 `roster.activatedAgents`，它是项目「最近」的会话——激活后即执行会话。`activeFor` 仍以「本」会话为准，因为手动 handoff 的选择器使用它。**声明的缺口：** 既不是本会话也不是最近会话的会话看不到；关闭它需要 api 中「按项目」的激活聚合，而它不存在。

api 和 engine 没有任何改动。

- **位置：** `apps/web/src/lib/session-handoffs.ts:41`（`origemDoHandoff`），
  `:108`（`jaAtivo`），`:180`（`prontidaoJaDeclarada`），`:192`
  （`arquiteturaJaDeclarada`）；`apps/web/src/lib/session-destinatario.ts:156`
  （`useAtivosNoProjeto`）
- **测试：** `apps/web/src/routes/SessionPage.handoff-obsoleto.test.tsx`
  （Criativo 活跃时的手动 handoff 不隐藏「Estou pronto」；Arquiteto 活跃时的手动 handoff 不隐藏「Confirmar arquitetura pronta」；agent 的 handoff 仍会隐藏——失败情形；窗口外，带 brief 的 Criativo handoff 计数；Dev Lead 在执行会话中活跃会让提议静默；没有它时，提议仍可操作——失败情形）
- **来源：** AT-293，AT-294

### RN-634 — 「Ativar execução」之后，界面转到执行会话 {#rn-634}

执行在一个「新」会话中运行（RN-135、RN-139），而发起点击的聊天会话甚至可能关闭。给 Dev Lead 的 handoff 卡片上的「Ativar execução」快捷方式（RN-137）——以及与接受的合并（RN-161）——把人留在了聊天会话，看着工作出发的地方（AT-295）。现在 `handleActivateExecution` 读取 `sessionId`，即 `POST .../execution/activate` 返回的那个，并把界面带过去，提示「Levando você à sessão de execução.」。响应中没有 `sessionId`、与当前会话 id 相同，或没有可执行导航的一方（界面挂载在路由之外）时，只给出常规提示，界面保持不动。被拒绝的激活不导航，并显示 api 的句子。执行导航的是「路由」（`irParaSessao`，router 的 `navigate`）：界面不依赖 router。

- **位置：** `apps/web/src/lib/session-acoes-de-handoff.ts:147`
  （`handleActivateExecution`）；`apps/web/src/router.tsx:339`（`irParaSessao`）
- **测试：** `apps/web/src/routes/SessionPage.handoff-obsoleto.test.tsx`
  （导航到返回的 `sessionId`，带提示；拒绝不导航——失败情形；没有导航方时只提示）
- **来源：** AT-295

### RN-638 — 询问「什么在等待决定」的一方读取「项目」的队列，绝不是最近的会话 {#rn-638}

侧轨的「审批」计数器、「需要你处理」面板（[RN-467](#rn-467)）、「审批」标签页、「概览」的 roster 和「代码」标签页原先从 `useLatestSession`——最后「创建」的会话——读取待处理项，它碰巧才是执行会话。执行之后打开的一个构思或聊天会把计数器清零，并在 roster 中隐藏等待决定的 dev agents（AT-297）。而聊天中其他会话的待处理项块（[RN-626](#rn-626)）只存在于活跃会话中，可 Infra Lead 在「聊天」中提议的 `container_start` 解锁的却是出现在「执行」中的 `dev.blocked_by_container`（AT-298）。

**规则：**

1. **队列是项目的队列。** 这些界面读取 `useProjectPendingActions`（`GET /projects/:projectId/actions?status=pending`，任何会话），全部通过「同一个」键 `['project-pending-actions', projectId, undefined]`——按 [RN-632](#rn-632) 的项目节奏，只有在以它为主题的「审批」标签页中才是 3 秒。`ProjectPage` 框架从「同一次」读取中取出 PR 计数器（`git_merge`），而不是第二次查询。各队列仍然分开，各有自己的徽章——不做任何相加（RN-467）。
2. **每张卡片按操作「自身」携带的会话来决定。** 在「审批」标签页中，批准、拒绝、「始终允许」和批量操作都以 `action.sessionId` 调用端点，并按前缀使项目队列失效，以及该操作所在会话的操作失效。该标签页的 PR 和 gate 块读取当前「执行」会话的事件和操作（RN-139），只有在没有它时才读取最近的会话。
3. **其他会话的待处理项在任何状态下都会出现。** 聊天中的块在已结束的会话和技术会话中也会出现——决定针对的是「另一个」会话的操作，而不是在本会话中对话（RN-581 仍拒绝对话）——「执行者」标签页为执行会话获得「同一个」块：聊天中的 `container_start` 在出现阻塞的地方可见。
4. **提议通过通道到达，不等待轮询。** 界面所监听的任何会话通道上的每个 `proposed_action.*`/`action.*` 通知也会使项目队列失效（`pendenciasDoProjeto`，位于 `criarInvalidadorDoCanal`，2 秒窗口），`dev.blocked_by_container` 也一样——解锁它的提议产生在另一个会话中，那里的人没有监听其通道（AT-299）。没有增加任何轮询。
5. **该块放得进栏位并显示全部（AT-318）。** 宽度与消息流和 composer 一致（780px），可折叠，在标题中显示每个队列的「在场」——「Aprovações 3 · Merges de PR 1」，各有自己的数字，绝不相加（RN-467）——即使折叠也可见。卡片的详情初始为「收起」（`detalheRecolhido`，位于 `ApprovalCard`）：展开时它们覆盖了约 60% 的消息流，三张卡片中只能看到一张。来源标签每个会话只出现「一次」，带最早一项的时间——按卡片时它会在相邻卡片间重复。20 张卡片的上限和声明的截取（RN-180）保持不变。

**本规则「不」覆盖的内容：** 通知只到达有界面在监听会话通道的地方（会话；概览，最近的会话；执行者，执行会话）。在没有通道的标签页（审批、PR、Backlog……），或对于在没有任何打开界面监听其通道的会话中作出的提议，计数器通过项目轮询到达，最多 15 秒；在框架中打开一个会话通道会改变会话的生命周期（通道是 RN-064 的心跳），因此被排除。「审批」计数器仍像以前一样计入待处理的 `git_merge`——面板把它去重到 PR 队列。用「工作区」角色代替有效角色的缺口（RN-471）对执行者的新块和对聊天的块同样适用。

- **代码：** `apps/web/src/routes/ProjectPage.tsx:82`（计数器），
  `:121`（来自同一次读取的合并）；
  `apps/web/src/routes/ProjectApprovalsTab.tsx:111`（`pendentesQuery`），`:115`
  （`sessaoDeTrabalho`），`:322`（`handleApprove`）；
  `apps/web/src/routes/ProjectOverviewTab.tsx:114`（`pendentesDoProjeto`）；
  `apps/web/src/routes/ProjectExecutorsTab.tsx:107`（`pendentesQuery`），`:290`
  （该块）；`apps/web/src/routes/code/CodeShell.tsx:101`（`pendentesQuery`）；
  `apps/web/src/routes/SessionPage.tsx:782`（不带 `isActive` 的块）；
  `apps/web/src/lib/canal-vivo.ts:134`（`alvosDoEvento`），`:180`
  （按前缀的键）；`apps/web/src/components/PendenciasDeOutrasSessoes.tsx`
  （`porSessao`，`presenca`）；`apps/web/src/components/ApprovalCard.tsx`
  （`detalheRecolhido`）；`apps/web/src/lib/hooks.ts:455`
  （`useProjectPendingActions`）；`apps/web/src/lib/precisa-de-voce.ts`
  （`acoesPendentes`）
- **测试：** `apps/web/src/routes/ProjectApprovalsTab.test.tsx`（存在较新的构思会话时执行中的待处理项，按其自身会话决定；已决定的不进入——对照）；`apps/web/src/routes/project-tabs.test.tsx`（按项目队列的徽章）；`apps/web/src/routes/ProjectExecutorsTab.test.tsx`
  （聊天中的 `container_start` 出现在执行标签页；执行自身的待处理项不变成块——对照）；
  `apps/web/src/routes/SessionPage.sessao-encerrada.test.tsx`（`closed` 和 `closed_abnormally` 中的块；本会话自己的不进入）；
  `apps/web/src/lib/acoes-da-sessao.test.ts`（通道按前缀并带窗口使项目队列失效；`tool.call` 不会）；
  `apps/web/src/components/PendenciasDeOutrasSessoes.test.tsx`（三张卡片可见，详情收起，按队列的在场不相加；折叠时在场留在标题中；每个会话一个来源标签）；
  `apps/web/src/routes/duas-abas.orcamento.test.tsx`（突发在「执行者」标签页使项目队列失效，在 RN-632 的预算内）
- **来源：** AT-297，AT-298，AT-299（HS-076），AT-318（9月30日的视觉审计）

## 实时跟进而不狂轰滥炸（RN-639）

### RN-639 — 逐 token 变化的内容不会重新渲染界面，跟进 bootstrap 的以 3 秒轮询并在结束时停止 {#rn-639}

三个界面在做没人看见的工作（AT-301/AT-302）。会话界面在轮次的每个 token 都会「整个」重新渲染——进行中的文本存放在它所调用的 hook 的状态中。配置和接管界面以 1 秒轮询 bootstrap 的状态和技术会话的事件，事件轮询从不停止，即使仓库已就绪。而 `/status` 会永远去敲一个没有响应的服务。

1. **进行中的文本存放在外部 store 中。** 咨询聊天的文本和轮次的活动条存放在每个会话的 store 中（`criarStoreDoStreaming`），只由绘制它们的两个组件——消息流中的气泡和活动条——通过 `useSyncExternalStore` 订阅。页面订阅「一个」布尔问题（轮次是否已经显示了内容？），这正是「pensando」计时器（[RN-131](#rn-131)）所需要的，且每轮只变化一次。活动条的 reducer 不变；变的是谁保存状态。
2. **bootstrap 以 3 秒跟进。** 状态和事件，两个界面都是。
3. **并在结束时停止。** 状态和事件在 bootstrap 收敛（`provisioned`）以及查询出错时停止（`pollQueParaNoErro`）。「失败」（`provision_failed`）在接管中是终态，在配置中「不是」：在那里「Tentar novamente」会触发新的 bootstrap，界面需要看到它的进度（[RN-477](api.md#rn-477)）。
4. **`/status` 在出错时停止。** 有响应的服务——包括 5xx，它在已解析的响应体中变为 `status: 'error'`——继续每 5 秒一次。没有响应的服务不再被定时器询问；窗口获得焦点和重新挂载会再次询问，第一次成功会恢复节奏。

- **位置：** `apps/web/src/lib/streaming-do-turno.ts:48`（`criarStoreDoStreaming`），
  `apps/web/src/lib/streaming-do-turno.ts:98`（`useSemConteudoNoTurno`），
  `apps/web/src/lib/poll-do-bootstrap.ts:33`（`pollDoBootstrap`），
  `apps/web/src/lib/poll-do-bootstrap.ts:47`（`bootstrapTerminou`），
  `apps/web/src/routes/ProvisioningPage.tsx:41`（`acompanharBootstrap`），
  `apps/web/src/routes/StatusPage.tsx:78`（`pollQueParaNoErro`）
- **测试：** `apps/web/src/routes/SessionPage.streaming-isolado.test.tsx`（第一个之后的二十个 token 不会重新渲染页面；轮次结束会重新渲染），`apps/web/src/lib/streaming-do-turno.test.ts`，
  `apps/web/src/lib/poll-do-bootstrap.test.ts`，
  `apps/web/src/routes/StatusPage.test.tsx`
- **来源：** AT-301，AT-302

## 在聊天中决定，就在负责人所在的地方（RN-626）

### RN-640 — 中性调色板还清了对比度欠账，UI 颜色只来自 token {#rn-640}

深色主题不再是深青蓝色，而是带柔和赤陶色强调的中性黑；浅色主题变成同一系列的中性色（ADR 0181）。[RN-184](#rn-184) 的机制不变——颜色对在两个主题中都测量，下限相同——；改变的是要求的内容：

1. **深色主题的欠账变成了下限。** RN-184 曾以数字锁定的五对（3.89 / 3.10 / 3.88 / 3.88 / 4.41）现在在两个主题中都达到 4.5:1，测试会拒绝把它们调低的人——不再只是「记录」。最终值来自「测量」：草稿中的 `--text-muted`（`#71717a`）重复了欠账而被拒绝（深色用 `#86868f`，浅色用 `#696972`），muted 在三种表面上仍「低于」`--text-secondary`，测试也会检查这一点。
2. **品牌/状态纯色背景上的文字通过 AA。** 深色主题的 `--on-accent` 是中性黑（在强调色上 5.61:1，悬停时 7.25:1，在 `--success` 上 7.65:1，在 `--danger` 上 5.24:1）；主按钮的「已知例外」不复存在，强调色的色相在两个主题中仍是赤陶色（10°–30°）。
3. **UI 颜色只来自 token。** 通过运行时库着色的（Mermaid、xterm、小地图）读取当前主题的 token，没有时回落到 `TOKENS_PADRAO` 的默认值——这是 `:root` 的一份副本，测试会把它与 `design/tokens.css` 对比。agent 的颜色始终是 `var(--token)`；三个没有语义色的 agent 每个主题都有 `--agent-*`，按 3:1 测量。并且任何 CSS 模块都不使用没人声明的 `var(--x)`。

- **位置：** `design/tokens.css:118`，`design/tokens.css:126`，
  `apps/web/src/lib/tokens-padrao.ts:50`（`lerTokenDoTema`），
  `apps/web/src/lib/agents.ts:90`
- **测试：** `apps/web/src/lib/contraste.test.ts`（"a antiga dívida de
  contraste agora é piso"），`apps/web/src/design-contraste.test.ts`，
  `apps/web/test/design-contraste.test.ts`（"o botão primário — a exceção que
  deixou de existir"），`apps/web/src/lib/tokens-padrao.test.ts`，
  `apps/web/src/lib/agents.test.ts`（"cor de agente vem do design system"），
  `apps/web/src/design-tokens-existentes.test.ts`
- **ADR：** [0181](../adr/0181-tema-preto-neutro.md)
- **来源：** AT-283，AT-284

## 实时跟进而不狂轰滥炸（RN-639）

### RN-643 — 低于 768px 时侧边栏变成抽屉，项目侧轨变成横向栏；页面绝不横向滚动 {#rn-643}

第 29 轮的视觉审计（AT-290，发现 S1）测得产品在登录后没有移动布局：在 390px 时侧边栏（264px）和项目侧轨（180px）仍是「固定」的，框架合计 444px，内容只剩 0 到 126px 或向右溢出。「配置」页面多达 114 处文字被截断（`validacao-visual.js`）。

**规则：**

1. **一个断点，一个来源。** 断点是 `CONSULTA_MOVEL`（`(max-width: 767px)`），由 `useLayoutMovel` 读取。切换布局的一方读取这个 hook，并通过一个「类」应用移动设计；CSS 模块没有为此设置自己的 `@media`。这样 JS 决定的和 CSS 绘制的不会在边界像素上分歧，组件测试（jsdom，没有 CSS）证明的也是浏览器应用的同一个断点。没有 `matchMedia` 时布局是「桌面」布局：只有当查询断言时移动布局才生效。
2. **侧边栏变成抽屉。** 顶部的栏带有菜单按钮（`aria-expanded`、`aria-controls`）和标识。抽屉是一个模态对话框（`role="dialog"`、`aria-modal`）：打开时焦点进入其中；Tab 不会离开；Esc、X 和背景会关闭它并把焦点还给菜单按钮。点击其中任何链接（项目标签页只改变 `?tab=`）以及路由从外部改变时，它也会关闭。在抽屉中侧边栏始终「展开」，「Recolher menu」按钮消失：手动折叠（[RN-195](#rn-195)）是桌面的偏好，它被保存，并在窗口再次跨过断点时重新生效。
3. **项目侧轨变成横向栏。** 还是同样的 12 个叶子，同样的顺序，组标题内联，`aria-orientation="horizontal"`。可移动的方向键是左和右，当前标签页会被滚动到可见区域内。栏在「内部」滚动；页面不横向滚动。项目主体变成一列（栏在面板上方），「概览」把团队和活动堆叠起来，而不是在旁边保留 360px 的侧轨。

**测得**（390×844，深色主题，api 的 seed，注入 `validacao-visual.js`）：文档的 `scrollWidth` = 390，在所有已认证界面（dashboard、12 个标签页、`/containers`、`/account`）中，`<main>` 占满 390px。在「配置」中，`texto-cortado` 从 114 降到 33。剩余的是组件文字（表格和各节的标签），属于排版和空间问题，不是框架问题。「概览」和「审批」中剩下的 `fora-da-viewport` 是横向栏中超出边缘的标签页，内部滚动可以到达它们。

**由 [ADR 0211](../adr/0211-uma-navegacao-so-a-sidebar-absorve-o-trilho.md)
修订（AT-404）：** 第 3 项不再有效——项目侧轨被移除，横向栏也随之移除。在手机上，项目标签页位于「抽屉」中（第 2 项），带有分组、当前项和计数器；选择一个会关闭抽屉。项目主体不再变成一列：只是留白缩小。

**本规则「不」覆盖的内容：** 「代码」标签页保留 `CodeShell` 48px 的侧轨和分栏编辑器；它不是为手机设计的。会话界面继承了新框架，但顶栏和消息流仍有审计的发现 X1–X3。按标签页的导航重复（抽屉和栏）已在 ADR 0211 中关闭。

- **代码：** `apps/web/src/lib/layout-movel.ts:18`（`CONSULTA_MOVEL`），
  `:39`（`useLayoutMovel`）；`apps/web/src/routes/Shell.tsx:422`
  （`movel`），`:443`（`prenderFoco`），`:462`（`fecharAoSeguirLink`）；
  `apps/web/src/routes/ProjectPage.tsx:49`（`movel`）；
  `apps/web/src/routes/ProjectOverviewTab.tsx:68`（`movel`）
- **测试：** `apps/web/src/routes/Shell.test.tsx`（"Shell — layout móvel
  (RN-643)"：抽屉打开时焦点在内，Esc 关闭并归还焦点；通过链接、X、背景和路由切换关闭；忽略保存的折叠状态；跨过断点回到固定侧边栏；以及失败情形，没有 `matchMedia` 时既没有菜单也没有对话框）；
  `apps/web/src/routes/Shell.test.tsx`（"no telefone as abas estão na gaveta,
  e escolher uma fecha a gaveta (RN-643)"）和
  `apps/web/src/routes/AbasDoProjeto.test.tsx`（"no telefone continua
  VERTICAL"），自 ADR 0211 起，基于 mock
  `apps/web/src/test/match-media.ts`
- **来源：** AT-316（AT-290 的发现 S1）；不改变 ADR 0126，只是为窄屏给侧轨一种形态

## 在聊天中决定，就在负责人所在的地方（RN-626）

### RN-644 — 消息流按「消息」截断，绝不拆开一次往来，并按发生顺序折叠历史 {#rn-644}

第 29 轮的视觉调查（发现 X3，AT-319）测得 [RN-177](#rn-177) 消息流截断的三个缺陷，都在同一个函数中：(1)「最后 5 条」计算的是**条目**，handoff、审批和故事的卡片各算一条消息——在短对话中，第一个问题和第一个回答被放进了折叠的历史；(2) 截断落在计数指向的位置，可能让问题被折叠而回答展开；(3) 历史**按来源**分组，按来源的顺序排列，「LLM」组排在「Usuário」之前——展开后，Criativo 的回答出现在引出它的问题「之上」。

**规则，适用于消息流（日志面板「不」变——那里的轴是层）：**

1. **截断计算「消息」**：`chat.message`、`agent.response` 和 `chat.structured_question`（`TimelineEntry.mensagem`）。卡片和分隔符不计入；截断之后的那些与周围的消息一起保持展开。按 agent 的折叠（[RN-138](#rn-138)）和「Passos do turno」仍是「一个」条目，算作一条消息。
2. **截断绝不拆开一个轮次**（[RN-172](#rn-172)）：它回退到标记截断的那条消息所在轮次的开头，所以问题总是和回答在一起。因此展开的条目可能超过五条——绝不会出现半截往来。序章（轮次 `0`）没有开头，不回退；如果回退到了起点，就没有历史。
3. **历史是「一个」块，按时间顺序**，并「声明」截取（[RN-180](#rn-180)）：标题说明截断计算的是什么（"Antes das últimas 5
   mensagens"），`trailing` 区分其中的内容（"2 mensagens · 2
   outras entradas"）。「LLM」标签随按来源的分组一起从消息流中移除。

**声明的损失：** 只重新打开用户说过的话而不打开其余内容，是消息流中按来源分组的理由。它在时间顺序下无法保留——日志面板仍提供这种截取。

- **代码：** `apps/web/src/routes/session-fio.tsx:119`（`FIO_RECENTES_ABERTAS`），
  `:291`（`dividirFio`），`:141`（`entradaSimples`）；
  `apps/web/src/lib/session-timeline.ts:67`（`mensagem`）；
  `apps/web/src/routes/session-timeline-montagem.tsx:389`，`:426`，`:673`（三种消息）；`apps/web/src/routes/SessionFio.tsx:139`（单一的块）
- **测试：** `apps/web/src/routes/session-fio.test.ts`（卡片不计入，截断回退到开头，消息流的顺序，以及轮次大于截断的失败情形）；`apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  （describe "RN-177/RN-644"：测得的穿插卡片的情形，以及按顺序展开的历史）
- **来源：** AT-319，第 29 轮「之前」视觉调查的发现 X3

## 实时跟进而不狂轰滥炸（RN-639）

### RN-645 — 配置不在每次挂载时重新获取，不轮询，「配置」标签页有三条框架带而不是四条 {#rn-645}

第 29 轮的视觉调查（发现 G1，AT-321）在约 40 秒内浏览了「配置」的各节，整个项目页面变成了「Limite de requisições excedido」——每分钟 300 次请求的上限属于「用户」（[RN-579](engine.md#rn-579)）。脚本每节都「重新加载」页面，标签页的一次加载花费 55 次请求。用真实界面测量，缺陷有三部分，没有一部分需要提高上限：

**规则：**

1. **「配置」数据有效期为一分钟**（`FRESCOR_DA_CONFIGURACAO_MS`）。在 TanStack 的 `staleTime: 0` 下，每个在第一个之后「挂载」的观察者都会重新获取。各节只在项目到达后才挂载，因此 `GET /projects/:id`、`GET /projects/:id/git/repository` 和 `GET /workspaces` 在每次加载中都发出「两次」；切换标签页再回来会重新挂载 19 个节，重新获取 31 次。配置只通过「变更」改变，而标签页的每个变更都会使自己的键失效——失效会忽略 `staleTime`，因此保存的人立即看到新值。这一分钟延迟的是「其他人」所做的修改，它仍会在窗口获得焦点时以及一分钟之后的下一次挂载时到达。**运行状态不在此列**（容器的生命周期、按 agent 和按密钥的花费、带 `lastUsedAt` 的设备密钥、bootstrap 计划）：那里的问题是「现在什么在运行」。
2. **配置不轮询。** 熟练度档案和指令版本历史原先以 15 秒轮询——对两份只会由本节（它会使之失效）或已批准的补丁改变的列表，每分钟 8 次请求计入上限。
3. **目录「横放」在各节上方，无论宽度如何。** 作为挨着它们的 `sticky` 列时，它是第四条竖向带（侧边栏 264 + 侧轨 180 + 目录 208）：在 1440px 时内容只剩约 740px，模型表格把 agent 名称截到 79px、模型名称截到 91px（发现 G2）。即使在宽显示器上这一列也无法回本，因为 `.body` 的上限是 1040px（ADR 0078）。横放后，它把 208px 还给各节；代价是窄窗口本来就付出的——失去的是「钉」在屏幕上的「我在哪里」，而不是导航。没有改动任何 token。

**数字**（`configuracoes.orcamento.test.tsx`，`Shell` + 处于「配置」标签页的 `ProjectPage`，基于按路由计数的 `fetch`；`dev` → 本规则）：

| 场景 | 之前 | 之后 |
|---|---|---|
| 标签页加载（2.5 秒） | 53 | 50 |
| 在标签页上停留一分钟 | 76 | 68 |
| 配置 → 概览 → 返回（配置相关的获取） | 31 | 0 |
| 标签页加载，已解析的 binding 以「批量」获取（[RN-654](api.md#rn-654)，AT-334） | 49 | 30 |

前三行的「之后」是在与「之前」相同的基础上测得的；与带有 [RN-638](#rn-638) 的 `dev` 集成后（框架只读取一次项目队列），加载为 49，一分钟为 64。第四行是 [RN-654](api.md#rn-654)，在 94e5dc721d 处的 `dev` 上测得：按键解析的 20 个 binding 变成了「一次」读取，测试把加载锁定在 30，一分钟锁定在 64。

**本规则「不」覆盖的内容：** 在 [RN-654](api.md#rn-654) 之前，加载中有 20 次请求是每个 agent（17）和每个区域（3）的「已解析」binding，每个键一条路由（`GET projects/:projectId/agent-bindings/:agentSlug`）——这一部分随「批量」路由关闭了。像调查脚本那样每节都「重新加载」页面，每次加载仍花费 30（达到上限之前每分钟约 10 次加载）；在标签页「内」通过目录导航不会重新挂载任何东西，花费为零。一分钟内的 68 次全部来自「框架」（`Shell` 以 5 秒轮询 `projects-summary` 和 `execution/session`，以 3 秒轮询执行会话的事件），所有标签页共有——即 [RN-632](#rn-632) 声明的同一缺口。

- **代码：** `apps/web/src/lib/query-policy.ts:111`
  （`FRESCOR_DA_CONFIGURACAO_MS`）；`apps/web/src/lib/hooks.ts:29`
  （`useCurrentWorkspaceWithRole`），`:535`（`useProficiency`）；
  `apps/web/src/routes/settings/InstructionVersionsSection.tsx:31`
  （`instruction-versions`，不轮询）；`apps/web/src/routes/settings/` 的各节
  以及 `apps/web/src/components/ModelCatalogSection.tsx`；
  `apps/web/src/routes/settings/sumario.module.css:36`（`.layout`，横带）
- **测试：** `apps/web/src/routes/configuracoes.orcamento.test.tsx`（加载时每个资源只获取一次；一分钟内没有配置轮询；切换标签页再回来没有配置相关的获取——三者在 `dev` 上都不通过——以及失败情形：失效会立即获取，过了一分钟后返回会重新获取）
- **来源：** AT-321（第 29 轮视觉调查的发现 G1 和 G2；[RN-579](engine.md#rn-579) 和 [RN-632](#rn-632) 的扩展）

## 在聊天中决定，就在负责人所在的地方（RN-626）

### RN-646 — 阻塞和不可操作的控件说明的是「当前界面」的原因：PR 标签页讲 PR 列表，没有容器时的停止/移除说明没有容器 {#rn-646}

两个界面显示了正确的状态，却配着别处的文字（AT-323、AT-324——第 29 轮视觉调查的发现 P1 和 K1/K2）。

**PR 标签页与镜像关卡。** 阻塞是「真实」的，保持不变：PR 列表和 diff 经过与「代码」标签页「相同」的漏斗（`ReadProjectCodeUseCase.alvo` → `portaoDoContainer`），因此在镜像未决定时（RN-105，经 [RN-494](broker.md#rn-494) 适用于三种模式）api 在那里同样返回 409——这是测得的，不是假设的。错的是文字：PR 标签页显示「A aba Code ainda não está liberada」，讲的是「另一个」标签页，用的名字（「Code」）也不是侧轨上的（「Código」）。现在 `ContainerImageGateNotice` 接收被阻塞的「界面」（`'code' | 'prs'`），PR 标签页显示「A lista de PRs ainda não está liberada」，并说明它通过与「代码」标签页相同的路径读取仓库；文字中的标签页名称来自 `nav:tabs.*.label`，与侧轨「同一」来源——绝不是字面量，「Code」和「Código」正是这样分叉的。PR 标签页的说明「不」承诺会自行解除：「代码」标签页会查询状态并重新校验，而 PR 列表只有在查询失败时才发现 409。

**没有容器的 `/containers`。** 停止和移除本来就是 `disabled`，在 `registrado: null`（[RN-521](api.md#rn-521)，「从未配置」）和 `removed` 时，但没有任何东西说明原因，而 `danger` 变体（属于 `Button`）没有禁用状态——「Remover」显示为满红色，与可用时一样。现在该行以文字说明原因「一次」（`Nunca provisionado: não há container para
parar nem remover.` / `Container removido: …`），`.danger:disabled` 获得与其他变体相同的不透明度。有容器在运行的行不加任何文字。

**缺少 broker 的长原因。** 点名 `BROKER_URL` 的文字有九行，使表格行的高度变成三倍。单元格现在在 `<summary>` 中显示「一句」短句，长文字（仍为操作员点名该变量）在 `<details>` 中按需展开——原生且可用键盘访问，绝不是禁用按钮上的 `title`（ADR 0064）。当「同一个」broker 缺失同时锁住启动「和」停止/移除时，只有「一行」（「subir, parar e remover só terminariam em falha」），两份详情放在同一个 `<details>` 后面。

- **代码：** `apps/web/src/components/ContainerImageGate.tsx:33`
  （`ContainerImageGateNotice`），`:42`（`bloco`）；
  `apps/web/src/routes/ProjectPrsTab.tsx:157`（`superficie="prs"`）；
  `apps/web/src/routes/ContainersPage.tsx:261`（`semContainer`），`:276`
  （`chaveCurtaDoBroker`）；`apps/web/src/components/ui/Button.module.css:101`
  （`.danger:disabled`）
- **测试：** `apps/web/src/routes/ProjectPrsTab.test.tsx`（"409 do portão vira
  o estado dedicado, com o texto da aba PRs e não o da aba Código"，"409 no
  diff aberto por id também usa o texto da aba PRs"，以及失败情形：500 仍是带「Tentar de novo」的横幅）；`apps/web/src/routes/ProjectCodeTab.test.tsx`
  和 `apps/web/src/routes/code/CodeDiffPanel.test.tsx`（「代码」标签页显示「Código」）；`apps/web/src/routes/ContainersPage.test.tsx`，块 "Parar/Remover
  sem container e o motivo curto (AT-324)"（从未配置、已移除、失败情形 "container de pé: nenhum motivo"、关闭的 `<details>` 且 `BROKER_URL` 只在其中，以及 broker 锁住三者时的单行）
- **来源：** AT-323，AT-324。不改变 RN-105/RN-494 的关卡（没有已决定的镜像时 PR 列表仍被阻塞——它是否「应该」绕过关卡是负责人的决定），也不改变 RN-521/RN-574 的启动标准。

### RN-648 — 侧边栏、Dashboard 卡片和产物面板互不矛盾：每个空状态说明读取的是「哪个」会话，计数器和列表用同一单位计数 {#rn-648}

三个界面在显示了某些内容的界面旁边声称「什么都没有」（AT-325——AT-290 视觉调查的发现 S2/D2/X6）。在此环境中无法用真实 engine 复现（egress 阻止了 `repo.hex.pm` 和 Alpine，没有镜像能编译）；这三处矛盾是在代码中「测得」的，并由修正前会失败的测试证明。Dashboard 那一处在调查中源于 engine 存根在工作区摘要上的 500——但把它变成「sem atividade」的文字属于 web，用真实 engine 时摘要的任何失败都会产生同样结果。

**侧边栏读取「执行」会话，而且只读它。** 「Atividades」块（RN-198）请求当前执行会话的事件（`useActiveExecutionSession`）。在只有对话会话的项目中它是 `null`，列表为空，侧边栏显示「Nenhum agente entrou em ação ainda」，旁边却是 Criativo 正在等待的「概览」。现在：有当前执行时，侧边栏继续读取「它」（dev agents 和 `-2` 实例正是 RN-198 的分组要展示的，`queryKey` 与「执行者」标签页相同）；「没有」执行时，读取与「概览」和 Dashboard 卡片「相同」的会话——最近的工作会话（`useLatestSession`，`sessaoMaisRecente` 的规则）。原先合并为同一文字的状态被分开（[RN-470](#rn-470)）：加载中（不作断言）、错误（专属文字）、项目没有会话（「Este projeto ainda não tem sessão.」），以及读取的会话中没有 agent，文字「点明」是哪个（「…na sessão de execução…」/「…na sessão mais recente…」）。会话列表只在没有执行时请求，并带一个项目周期的新鲜度（`frescorMs`，位于 `useProjectSessions`）：侧边栏启用它时，项目框架已经把它取来了，[RN-632](#rn-632)/[RN-645](#rn-645) 的请求预算不会增加。

**Dashboard 卡片四种状态只有一个文字。** 「Sem atividade ainda」在工作区摘要「加载中」、摘要「失败」（调查中的情形：摘要返回 500，一个有十六个事件的项目的卡片说一个也没有）、项目「没有」会话以及最近会话为空时都会出现。现在是四个文字：「carregando atividade…」、「atividade indisponível」、「Nenhuma sessão ainda」和「Sem atividade na sessão mais recente ainda」。该行仍读取最近的工作会话（`latestSessionId`），与「概览」以及没有执行时的侧边栏相同——api 没有改变。

**「Artefatos gerados 3」上面只有一个「PO 1」分组。** 该节的标题计算的是 backlog 的「树」（史诗、故事和任务：3），而按 agent 的分组只计算「根」（1）。现在两者用同一单位计数——每个条目带有 `quantos`（1，作为 backlog 的根时再加上后代），标题是条目之和，每个分组是其条目之和，因此各分组之和「就是」标题，这是构造上保证的。该节的空状态说明它计算的是什么（「Nenhuma PR nem item de backlog nesta sessão ainda.」），而不是通用的「Nada ainda.」，后者放在同一会话的 brief 或规则旁边，看上去像在否认它们存在——该节的范围（PR 和 backlog，[RN-159](#rn-159)）不变。

- **代码：** `apps/web/src/routes/Shell.tsx:579`（`execucao`），`:587`
  （`origemDaAtividade`），`:594`（`estadoDaAtividade`）；
  `apps/web/src/lib/hooks.ts:127`（`useProjectSessions`，`frescorMs`）；
  `apps/web/src/routes/Dashboard.tsx:75`（`lastActivityText`）；
  `apps/web/src/routes/ContextAside.tsx:46`（`quantos`），`:340`
  （`totalDeArtefatos`）
- **测试：** `apps/web/src/routes/Shell.test.tsx`（"Shell — Atividades"：没有执行时读取「概览」的会话，Criativo 出现；有执行时读取执行会话，空状态说明是哪个；项目没有会话；以及失败情形，会话列表失败变为命名的错误，绝不是「没有 agent」）；
  `apps/web/src/routes/Dashboard.test.tsx`（"Dashboard — linha de atividade do
  card (RN-648)"：失败的摘要显示「indisponível」，加载中不作断言，没有会话 × 空会话的文字不同，有事件时不出现任何空状态）；`apps/web/src/routes/SessionPage.artefatos-gerados.test.tsx`（各分组之和就是标题；空状态说明计算的内容）；
  `apps/web/src/routes/configuracoes.orcamento.test.tsx` 和
  `apps/web/src/routes/duas-abas.orcamento.test.tsx` 仍在上限之内
- **来源：** AT-325（AT-290 的发现 S2/D2/X6）。不改变 [RN-159](#rn-159) 的范围，也不改变工作区摘要（[RN-090](api.md#rn-090)）；扩展了 [RN-198](api.md#rn-198)（侧边栏读取哪个会话）并应用了 [RN-470](#rn-470)

## 实时跟进而不狂轰滥炸（RN-639）

### RN-651 — 在手机上，会话面板是抽屉，栏会换行，表格变成卡片 {#rn-651}

第 29 轮「之后」的视觉审计（`docs/explanation/auditoria-visual-rodada-29.md`，发现 N1 以及 N3 到 N8）在 390px 下测得 [RN-643](#rn-643) 没有触及的问题：在会话中，「Contexto da sessão」面板保持约 320px，只给消息流留下约 70px（每行一个词），栏把「Iniciar ideação」和「Encerrar」挤出了边缘；在 `/containers` 中，七个按比例分配的列使标题重叠并截断了操作；在「Modelos por agente」中，agent 名称只有 6px，选择器 0px；`/status` 横向滚动（413px）；Dashboard 的搜索变成了「Bus」；Criativo 列表中的会话名称为 0px；移动侧轨让当前标签页被截断，也没有可滚动的迹象。

**规则**（断点与 [RN-643](#rn-643) 的 `useLayoutMovel` 相同，设计通过组件设置的「类」或属性实现，绝不用 `@media`）：

1. **会话的上下文面板在手机上初始为「关闭」**，并作为「抽屉」从右侧覆盖在消息流上打开：带面板名称的模态对话框，打开时焦点在 X 上，Esc、X 和背景会关闭它并把焦点还给打开它的一方。在桌面上它照常在消息流旁边以打开状态出现。跨过断点会回到新一侧的默认状态——在桌面上打开的面板不会在手机上重新出现并挤压消息流。例外是「来到」面板的导航（`highlightEvent`，Psicólogo 的证据标签）：此时它在手机上也以打开状态出现。
2. **会话栏换行，绝不截断。** 返回、状态、标题和面板切换器留在第一行；类型、设置、「Iniciar ideação」和「Encerrar」下移，必要时再下移。栏显示什么仍由它的宽度决定（[RN-620](#rn-620) 第 6 项）。
3. **每个 `Table` 在手机上变成卡片堆。** 每一行是一张卡片，每个单元格在值旁边带上列标签；表头消失。没有标签的列，或标记为 `largaNoMovel` 的列（一个选择器、一组操作），占据卡片宽度，标签在上方。
4. **页面不横向滚动，标识一行的内容不会消失。** `/status` 在自己的容器内滚动表格；Dashboard 的搜索占据整行；会话列表的行换行，名称完整地显示在上方。
5. **移动侧轨跟随当前标签页并提示可以滚动。** 当前标签页在挂载时、切换时、侧轨「内容」变化时（计数器稍后到达并加宽了前面的标签页）以及字体加载完成时被带入可见区域——绝不在每次渲染时，否则手动滚动过条带的人会被拉回去。隐藏了标签页的边缘会淡出（`data-rola-inicio`/`data-rola-fim`）。

**测得**（390×844，两个主题，带 seed 的原生 api，注入 `validacao-visual.js`）：七个界面的 `scrollWidth` 全部为 390；`texto-cortado` 为零：Dashboard、Criativo 列表、会话（有抽屉和没有抽屉）、`/containers` 和 `/status`；「配置」中的 33 降为零，在测量的三个标签页中，侧轨的当前标签页完整地位于可见区域内。

**本规则「不」覆盖的内容：** 在最小的栏中，「Encerrar」仍只有图标和可访问名称（[RN-620](#rn-620) 按栏宽决定这一点）。面板切换器只在「绘制」时（`order`）上移到标题行：Tab 顺序仍遵循 DOM。检查器在「配置」和「审批」中仍报告的 `fora-da-viewport` 是折叠线以下控件内部带 `position: absolute` 的装饰图标，不是被截断的东西。

- **代码：** `apps/web/src/lib/painel-de-contexto.ts:16`
  （`usePainelDeContexto`）；`apps/web/src/routes/GavetaDoContexto.tsx:14`
  （`GavetaDoContexto`）；`apps/web/src/routes/SessionTopbar.tsx:126`
  （`movel`）；`apps/web/src/components/ui/Table.tsx:13`（`largaNoMovel`），
  `:28`（`movel`）；`apps/web/src/routes/Dashboard.tsx:165`（`movel`）；
  `apps/web/src/routes/ProjectSessionsTab.tsx:149`（`movel`）
- **测试：** `apps/web/src/routes/SessionPage.layout-movel.test.tsx`（抽屉初始关闭，打开时焦点在 X 上，Esc 关闭并归还焦点；X 和背景会关闭；栏在操作之前换行；以及失败情形，在桌面上面板位于消息流旁边，没有抽屉也不换行；跨过断点会关闭面板）；`apps/web/src/components/ui/Table.test.tsx`（"layout estreito"）；
  `apps/web/src/routes/ContainersPage.test.tsx`，
  `apps/web/src/routes/settings/modelos-por-agente-no-movel.test.tsx`，
  `apps/web/src/routes/StatusPage.test.tsx`，
  `apps/web/src/routes/Dashboard.test.tsx`，
  `apps/web/src/routes/ProjectSessionsTab.test.tsx`（每个都有移动布局以及桌面或条带放得下时的失败情形）。项目标签页的条带（`ProjectRail`，发现 N8）在 [ADR 0211](../adr/0211-uma-navegacao-so-a-sidebar-absorve-o-trilho.md) 中被移除：标签页位于抽屉中
- **来源：** 第 29 轮视觉审计的 AT-328（发现 N1）和 AT-330（发现 N3 到 N8）；补全了 [RN-643](#rn-643)

## 消息流中每句话的作者是事件的角色（RN-652）

### RN-652 — `chat.message` 显示在事件的「角色」名下——人、agent 或未知——绝不在查看界面的人名下 {#rn-652}

此前每个 `chat.message` 都带着当前登录者的名字和头像显示：在共享会话中，另一个人的发言显示为「你的」名字，agent 的发言显示为你的电子邮件（第 29 轮视觉审计的发现 N2，在消息流按来源分组历史时被掩盖）。现在作者来自事件的 `actor`，api 用发送者的 id 记录它（`SendAgentMessageUseCase`、`SendChatMessageUseCase`），通用的追加事件路由接受任何类别的角色。各种结果不会合并：

1. **查看者本人**（`actor.id` 等于 token 的 `sub`；没有时按成员行的电子邮件）——成员行的名字或电子邮件，否则是会话的电子邮件，只有两者都没有时才是「Você」。
2. **界面知道如何称呼的另一个人**——她的名字，否则是电子邮件，来自合并为一个列表的「两次」读取（`comporMembros`），「项目」的在「工作区」的之前：`GET projects/:id/members`（最低 `viewer`），使用与「配置」标签页「相同」的 `queryKey`，以及自 AT-335 起的 `GET workspaces/:id/members`（[RN-655](api.md#rn-655)），即「该项目所属」的工作区。两行都有的人只出现一次，取项目的那一行——与角色覆盖的顺序相同（[RN-471](#rn-471)）。
3. **界面「不」知道如何称呼的另一个人**——「Outro membro」：既没有项目行也没有工作区行（已离开工作区但日志中仍有发言的人），或者两次读取都失败或尚未到达。失败的读取不会抹掉另一个，两者都不会让消息流崩溃。在 AT-335 之前，这是仅通过工作区角色进入的人的声明「缺口」，那时没有读取路由；该路由依负责人的决定而产生。
4. **Agent**——`nomeDoAgente` 以及 agent 的头像/颜色，同 `agent.response`。
5. **未知角色**（缺失、没有 id、`system` 或人/agent 之外的类别）——「Autor desconhecido」，绝不是「Você」。

叙述 `backlog.story_promotion_returned` 有同样的缺陷（查看者的名字显示在退回故事的人头上），现在也经过同一个函数。composer 的「乐观」消息仍带查看者的电子邮件——它始终属于他。

- **代码：** `apps/web/src/lib/autor-da-mensagem.ts:52`（`autorDaMensagem`）；
  `apps/web/src/lib/autoria-da-sessao.ts:45`（`useAutoriaDaSessao`），`:18`
  （`comporMembros`）；
  `apps/web/src/routes/session-timeline-montagem.tsx:154`（`rotuloDoAutor`），
  `:405`（`chat.message`），`:687`（故事的退回）；
  `apps/web/src/routes/SessionPage.tsx:133`（`autoria`）
- **测试：** `apps/web/src/routes/SessionPage.autor-da-mensagem.test.tsx:147`
  （两个人和一个 agent，每条消息在自己的作者名下——正常路径），`:168`（未知角色和成员之外的人有各自的文字——失败情形），`:186`（仅通过工作区角色进入的人被点名——AT-335），`:205`（被拒绝的工作区读取不会抹掉项目的读取），`:219`（成员读取被拒绝）；
  `apps/web/src/lib/autoria-da-sessao.test.ts:15`（项目行在工作区行之前），`:22`（一次读取失败不会抹掉另一个）；
  `apps/web/src/lib/autor-da-mensagem.test.ts:58`（缺失、没有 id 或类别未知的角色绝不会变成「você」）
- **来源：** AT-329（`docs/explanation/auditoria-visual-rodada-29.md` 的发现 N2）；工作区列表，AT-335

## 每张审批卡片上的策略原因（RN-656）

### RN-661 — 在执行开始时向团队批量「提供」自动模式，并且提议说明它不放行什么 {#rn-661}

在「执行者」标签页中，当执行处于活动状态且执行团队显示在界面上时，一张卡片提供一次性为团队的 agent 开启自动模式（RN-153）（AT-315）。这是「一个」控件，而且是提议：尚未处于自动模式的 agent 预先勾选，人可以取消不想要的，不点击「Ligar」就不写入任何东西。点击写入「同一个」通配符（`agent_autonomy`、`actionType: "*"`、`auto_approve`），通过与按 agent 开关「相同」的端点（`PUT .../agent-autonomy`，`maintainer`）——每个 agent 一次 PUT，串行，遇到第一次拒绝不中止，按 RN-469 的三种情况给出「按 agent」的结果（全部、一个都没有并附 api 的句子、部分并说明谁留在手动）。关闭仍在每个 agent 卡片的手动/自动开关上；没有「批量关闭」。当所有 agent 都已处于自动模式时，卡片消失。

卡片在点击「之前」说明自动模式「不」放行什么——绝对上限仍需审批（RN-154、RN-418）：在受保护分支上合并；`git push`、打开 PR 和 deploy；`sudo`/`doas`；`container_remove`；`instruction_patch`；并行化或提高并行上限。没有 `maintainer` 时控件不可操作，原因以文字说明；读取的角色是「工作区」角色，与其他自动模式界面有同样的已声明缺口（RN-471）。

- **代码：** `apps/web/src/components/ModoAutomaticoDoTime.tsx:73`
  （`ModoAutomaticoDoTime`），`:109`（`ligar`），`:44`
  （`agentesEmModoAutomatico`）；`apps/web/src/routes/ProjectExecutorsTab.tsx:89`
  （`podeLigarModoAutomatico`），`:308`（提议挂载的位置）
- **测试：** `apps/web/src/components/ModoAutomaticoDoTime.test.tsx:54`（挂载时不写入任何东西；点击为每个选中的 agent 写入通配符——正常路径），`:85`（api 拒绝一个 agent，结果点明谁留在手动——失败情形），`:74`（不放行的内容），`:102`（没有 `maintainer`），`:108`（全部已是自动，没有可提供的）
- **来源：** AT-315（AT-309 的调查，「Modo automático」一行）

## 通过浏览器配置 runner 的流程退役（RN-687，ADR 0203）

### RN-687 — runner 面板指向安装程序；浏览器不生成密钥、不下载二进制、不写入文件夹 {#rn-687}

[ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md) 的流程（[RN-464](api.md#rn-464)..[466](runner.md#rn-466)）依负责人的决定「退役」（10月1日，`BRB-031`）：它是唯一以手动 `chmod +x` 结束的安装路径，而 `install.sh` 已经在正确的一侧完成它的三件事——下载经签名 `checksums.txt` 校验的二进制并用 `install -m 0755` 安装（[RN-531](produto.md#rn-531)），以及在「机器上」创建密钥并注册（[RN-547](produto.md#rn-547)，[RN-551](runner.md#rn-551)，[RN-552](api.md#rn-552)）。

**规则：**

1. **`RunnerOnboardingPanel` 显示安装程序的命令**（`curl -fsSLO …/install.sh && bash install.sh`，与 runbook 和 `install.sh` 「相同」的句子，[RN-526](produto.md#rn-526)），可复制，用文字说明它做什么，注明它服务于安装所在的机器，下方是 `EsperaDoRunner`（[RN-474](#rn-474)）。web 中的命令是一份「副本」，该副本与安装程序的常量对照校验。
2. **识别到服务该项目的有效密钥后**——机器密钥（[RN-548](#rn-548)）或项目密钥（AT-107）——安装程序块「移除」，动作变为检查服务。带 PAT 的手动命令（`--token`）始终保留在 `<details>` 中，被命名为「另一台」机器的路径。
3. **没有配置文件夹、下载文件或选择平台的按钮**，web 不再调用 Web Crypto、File System Access 或二进制的代理。`runner-bootstrap.ts` 被整个移除。
4. **api 不再有 `POST /projects/:projectId/runner-device-keys`。** 它已没有调用方。`GET` 和 `DELETE` 保留（列出和撤销）；机器的内部路由（`POST /internal/machine-device-keys`）保留。
5. **「已经」注册的项目密钥仍然有效且可撤销**：数据库中没有任何变化，`PatAuthGuard` 仍接受它（[RN-465](api.md#rn-465)），CLI 仍读取配置的文件夹（[RN-466](runner.md#rn-466)）。在 ADR 0203 之前通过浏览器配置的 runner 不会损坏。

已声明排除在外的：有「团队」的安装失去了不用 PAT 配对第二台机器的路径（机器密钥路由在有两人或以上时为 409），改用手动命令；`GET /runner-releases/binary` 没有生产消费者，「没有」被移除——那是另一项决定。

- **位置：** `apps/web/src/components/RunnerOnboardingPanel.tsx:68`
  （`COMANDO_DO_INSTALADOR`），`:124`（`RunnerOnboardingPanel`）；
  `apps/api/src/interfaces/http/runner/runner-device-keys.controller.ts:75`
  （`RunnerDeviceKeysController`），`:96`（`listDeviceKeys`），`:119`
  （`revokeDeviceKey`）；`apps/api/src/interfaces/http/auth/pat-auth.guard.ts:152`
  （`autenticarChaveDeDispositivo`）
- **测试：** `apps/web/src/components/RunnerOnboardingPanel.test.tsx:91`
  （正常路径：安装程序的命令、已复制、以及等待），`:119`（浏览器流程已移除：没有它的按钮，没有 `chmod`），`:134`（失败情形：剪贴板被拒绝不会破坏界面），`:211`（机器密钥有效：安装程序移除）；`apps/api/test/interfaces/http/runner/runner-device-keys.controller.spec.ts:43`
  （没有 `POST` 的 handler）；`apps/api/test/interfaces/pat-auth.guard.spec.ts:345`
  （项目密钥仍被接受）；`scripts/dev/install-invocacao.spec.ts:162`
  （面板的命令就是安装程序的句子）；
  `scripts/ci/alvos-do-runner.spec.ts:70`（浏览器的目标列表不会回来）
- **架构决策：** [ADR 0203](../adr/0203-aposenta-o-fluxo-do-runner-pelo-navegador.md)
- **来源：** AT-014（`BRB-031`），负责人 10月1日的决定

## 类型化入口同样适用 RN-418 的上限（RN-689）

### RN-693 — 激活 agent 不是对话：开场提示留在消息流中直到第一条消息，会话的文本字段不招来自动填充 {#rn-693}

在 v7.0.0 的真实使用中测得：「Iniciar ideação」写入 `agent.activated`（以及 `agent.status`），Criativo 只在第一条消息之后才说话，而邀请——带有提示「Comece contando o que você quer construir…」——在点击时就消失了，因为「对话开始了吗？」的判断是 `events.length > 0`。消息流约有 25 秒是空的。

**规则：** agent 的「生命周期」事件（`agent.activated`、`agent.status`）不算对话。其他任何事件仍然算，以免邀请覆盖 git-bootstrap 会话或执行会话（[RN-131](#rn-131)）。Criativo 已激活但没有消息时，邀请保留提示但没有「Iniciar ideação」按钮；第一条消息会移除它。

composer 和结构化问题的文本字段带上 `autocomplete="off"` 以及密码管理器会遵守的属性（`data-1p-ignore`、`data-lpignore="true"`、`data-bwignore`、`data-form-type="other"`）：每次聚焦都会打开浏览器的自动填充弹窗。

- **位置：** `apps/web/src/lib/conversa-comecou.ts:15`（`conversaComecou`），
  `:29`（`SEM_AUTOFILL`）；`apps/web/src/routes/SessionPage.tsx:436`
  （`conversaComecou`）；`apps/web/src/routes/SessionComposer.tsx:389`
  （`SEM_AUTOFILL`）；`apps/web/src/routes/StructuredQuestionCard.tsx:206`
  （`SEM_AUTOFILL`）
- **测试：** `apps/web/src/routes/SessionPage.sessao.test.tsx:316`（Criativo 已激活但没有消息时保留提示；有消息时提示消失——失败情形；composer 的属性）；`apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx:201`
  （问题字段的属性）
- **来源：** AT-353

### RN-694 — 模型目录有搜索，凭据提供同步，第一个模型一次点击就交给团队 {#rn-694}

三个基于已有操作的快捷方式，没有新端点（AT-357）：

1. **搜索。** 目录有一个搜索字段，匹配模型的显示名称、`name` 或 `id`，不区分大小写。有搜索词时，每个有结果的 hub 分组和子分组自动展开；没有结果的搜索会「说明」没有匹配，并附搜索词——绝不是一个沉默的空列表。
2. **凭据旁边的同步。** provider 有密钥但目录中「没有」模型的凭据卡片会说明这一点，并提供「Atualizar catálogo」——与目录「相同」的操作（`POST .../models/sync`）。该按钮只对 `owner` 显示（端点的最低要求，RN-102）；读取目录需要 `maintainer`。谓词只有「一个」，`providersSemCatalogo`，目录的提示也使用它。
3. **激活并应用到团队。** 当「没有」模型处于激活状态且有「一个」被勾选时，批量栏提供「Ativar e aplicar aos N agentes」：激活（`POST .../models/activate`），激活通过后，按 RN-476 的同一路径应用到每个 agent，带有它的覆盖警告和 RN-469 的部分报告。激活被拒绝时什么也不应用。只在点击时，绝不自动，且只对 `owner`（两个最低要求中较高的）；低于它时控件不可操作，原因以文字说明。精选仍是手动的（ADR 0042）。

- **位置：** `apps/web/src/lib/models.ts:244`（`casaComBusca`），
  `apps/web/src/lib/models.ts:425`（`providersSemCatalogo`），
  `apps/web/src/lib/models.ts:441`（`algumModeloAtivo`），
  `apps/web/src/components/ModelCatalogSection.tsx:333`（`ativarEAplicarAoTime`），
  `apps/web/src/routes/settings/CredentialsSection.tsx:128`（`handleSync`）
- **测试：** `apps/web/src/components/catalogo-com-busca.test.tsx`
  （按 id 搜索和无结果；激活并应用、部分、激活被拒绝、低于 owner、已有激活模型；卡片上的同步，有目录和没有目录，以及失败）
- **来源：** AT-357

## 安装程序提供本地模型，并且不把 dev 环境误认为一次安装（RN-691，RN-692）

### RN-701 — 上下文面板不会对已移出窗口的规则断言「0」 {#rn-701}

「Contexto da sessão」面板读取已下载的事件（RN-180）。在事件多于窗口的会话中，开头发出的业务规则位于窗口「之前」，计数器显示 **0** 并写着「Nada ainda.」——对没读到的东西下了断言（在 10月2日有 268 个事件的会话中测得：5 条规则变成了 0）。有窗口之前的事件时，计数器改为显示「N na janela · há mais antes」，空的部分说明「在已加载的事件中」没有任何规则。没有新的读取：之前的数量仍由对 `seq` 的相减得出。

AT-365 的另一半——已执行的审批卡片再次要求决定——此处「没有」修正：消息流中的卡片已经按「操作」的 `status` 决定（`ApprovalCard`，`isPending`），而操作的读取是尾部加上待处理项（RN-637）；这个缺陷在 web 的代码中无法复现。

测量（10月2日，在 AT-015 的环境中）：会话 17d41c20 的 `GET .../actions?latest=true` 把两个 `open_adr_pr` 返回为 `executed`，重新加载会话（展开已折叠的块）后看不到任何「Aprovar」。待处理的卡片只在实时会话「期间」出现过——界面的瞬态，不是 api 或窗口的状态。AT-015 的下一轮会在它出现时捕获网络，然后再做任何修正。

- **位置：** `apps/web/src/routes/ContextAside.tsx:393`（`trailing`），`:415`
  （`nadaNaJanela`）
- **测试：** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  （"RN-701 (AT-365): com as regras fora da janela, o contador não afirma 0"；
  所避免的失败情形是旁边的「alcançando o começo da sessão」）
- **来源：** AT-365

### RN-708 — 新项目会说明下一步，由已读取的内容推导 {#rn-708}

新建项目的「概览」没有说明该做什么：没有 provider 密钥、没有模型、没有会话，界面上没有任何东西指明道路，而凭据和目录位于「配置」的末尾（在 10月2日的真实测试中测得，全新安装）。自 AT-372 起，「概览」以「Primeiros passos」卡片开头，包含「三个」步骤，每个都带有指向确切位置的链接：

- **凭据**——账户至少有一个 LLM 凭据（与「凭据」一节相同的 `['credentials']` 读取，带配置的新鲜度且不轮询，RN-645）。「概览」原先不做这个读取，而它的加载有预算：只在团队还没有模型时才运行；模型已解析时，该步骤视为已完成；
- **模型**——Criativo 的已解析 binding 不为空（RN-654 的批量，与「配置」相同的 `queryKey`）；
- **构思**——项目至少有一个会话（页面已在轮询的列表）。

没有新路由。尚未读取（或出错）的输入是「不知道」（RN-470），只要有一个这样的输入，卡片就「不」出现——没读就断言「缺少凭据」等于界面在撒谎。三步都完成后，卡片消失。同时，「配置」标签页改为从模型分组打开，凭据在前，目录跟随这一顺序。

- **位置：** `apps/web/src/lib/primeiros-passos.ts:37`（`derivarPrimeirosPassos`），
  `apps/web/src/components/PrimeirosPassos.tsx:22`（`PrimeirosPassos`）
- **测试：** `apps/web/src/lib/primeiros-passos.test.ts`（正常路径以及 "insumo
  não lido não vira pendente"）和 `apps/web/src/routes/ProjectOverviewTab.test.tsx`
  （"primeiros passos (RN-708, AT-372)"）
- **来源：** AT-372

### RN-709 — 卡片使用动词的正确时态，上限不提供「始终允许」，计划说明成本并只为有任务的模块启动 agent {#rn-709}

在 10月2日的测试项目中测得。同一张决定卡片的四个缺陷，一起关闭：

- **动词跟随操作的状态（AT-371）。** PR 的待处理卡片在打开之前就写着「abriu pull request (de ADR)」。`VERBO_DA_ACAO` 讲的是「提议」（「quer abrir pull request…」），`VERBO_DA_ACAO_EXECUTADA` 给出已发生之事的动词，只针对时态会变的类型；`verboDaAcao` 接收 `status`，是唯一来源。
- **ADR 和 infra 的 PR 属于 RN-418 的上限（AT-371）。** `open_adr_pr` 和 `open_infra_pr` 进入 `TIPOS_SEM_SEMPRE_PERMITIR`（api 以及 web 的副本，由测试校验），与 `pr_open` 一样——「始终允许」拒绝写入模式，卡片不提供该按钮，也不提供「Modo automático」。在终端之外，说明不再谈论命令（「npm test」、「roda qualquer comando」）：类型化的类型有自己的说明。
- **计划显示估算（AT-381）。** 提议 `propose_execution_plan` 时，api 在 payload 中加入 `orcamentoPorTarefaMicros`——「当前」的每任务预算，与激活所用的相同（项目设置或默认的 0.50 美元）——卡片的句子说明「até US$ X (N tarefas × US$ Y) — é o
  teto por tarefa, não o preço」。没有新路由。
- **没有任务的模块不获得 agent（AT-381）。** 应用计划时，把有 ≥ 1 个任务的模块传给激活（`modulosDoPlano`）；`module_map` 中没有任务的模块被排除，并在结果中说明（`modulosSemTarefa`），与 `tarefasPorModulo` 并列。「Ativar execução」按钮（没有计划）以及没有 `tarefas` 的计划仍启动整个映射。计算出的摘要在工具结果的文本中到达 Dev Lead（`resumo_do_plano/1`），让它引用数字而不是重新计数。

- **位置：** `apps/web/src/lib/aprovacoes.ts:428`（`verboDaAcao`），
  `apps/api/src/domain/actions/sempre-permitir.ts:33`（`TIPOS_SEM_SEMPRE_PERMITIR`），
  `apps/api/src/application/use-cases/actions/propose-action.use-case.ts:84`（`execute`），
  `apps/api/src/application/use-cases/execution/execute-execution-plan.use-case.ts:89`（`execute`），
  `apps/api/src/application/use-cases/execution/activate-execution.use-case.ts:123`（`execute`），
  `apps/engine/lib/engine/agents/dev_lead_tools.ex:587`（`resumo_do_plano`）
- **测试：** `apps/web/src/lib/aprovacoes.test.ts`（"AT-371 — o verbo segue o
  estado da ação"，"AT-381 — o plano mostra a estimativa de gasto"），
  `apps/web/src/components/ApprovalCard.test.tsx`（"open_adr_pr pendente"），
  `apps/api/test/domain/actions/sempre-permitir.spec.ts`，
  `apps/api/test/application/use-cases/execution/activate-execution.use-case.spec.ts`
  （"módulos do plano"），`apps/api/test/application/use-cases/execution/execute-execution-plan.use-case.spec.ts`，
  `apps/engine/test/engine/agents/dev_lead_tools_test.exs`（`resumo_do_plano/1`）
- **来源：** AT-371，AT-381

### RN-712 — 会话消息流显示刚刚发生的事，只显示一次且可读 {#rn-712}

在 10月2日的真实测试中测得（`loja-teste`）：轮次条显示原始 Markdown，结构化表单的回答出现两次，手动 handoff 选择器从构思的第一分钟起就提供 Dev Lead、QA 和 Infra，「Para」在 Arquiteto 已开始工作时仍停在 PO，「Iniciar ideação」按钮在会话中途重新出现，一个 80 行的 docker-compose 把对话推出了屏幕。自 AT-375 起：

- **轮次条**——预览和展开的行经过 `textoPlanoDoMarkdown`：`**`、`##`、分隔线、表格和反引号变成连续文本。条是预览；渲染后的回答仍是轮次结束时的气泡（RN-460），流式 store 不变（RN-639）；
- **已回答的表单**——api 把回答作为用户的 `chat.message` 重新发给 agent；文本「恰好」是 api 所组装内容（`"<n>. <rótulo>: <resposta>"`）、且是回答之后第一条用户消息的气泡从消息流中移除，因为已回答的卡片已经显示了它们。只是看起来像列表的手打消息保留；
- **接收者**——在 composer「选择器」中作出的选择是手动的，绝不被覆盖。来自某个动作的选择（在此界面接受 handoff、「Estou pronto」）跟随最后一个「已接受」handoff 的目标，包括由系统接受的（RN-660）。修订 RN-631 中「经由其他路径的接受『只增加选项』」这一条款——仅针对非手动的选择。没有任何选择且有两个选项时，发送仍被锁住；
- **手动 handoff**——选择器初始折叠在一个按钮后面；agent 列表没有变；
- **「Iniciar ideação」**——一旦有 agent 进入会话（agent 事件或 handoff），就从标题栏消失；
- **标题栏**——时间变为「iniciada às HH:MM:SS」，语言来源在省略之前最多折成两行，完整文本放在 `title` 中；
- **代码块**——超过 20 行时初始折叠为前 8 行，带「Mostrar as N linhas」。

已测得而排除在外的：Criativo 第一个气泡的「modelo não registrado」来自「ENGINE」——当轮次以交付表单结束时，`criativo_server.ex` 以空的 `modelName` 写入累积文本（`gravar_texto_do_turno(state,
"", nil)`），而不是来自界面。

- **位置：** `apps/web/src/lib/texto-plano.ts:7`（`textoPlanoDoMarkdown`），
  `apps/web/src/lib/eco-de-formulario.ts:17`（`ecosDeRespostaEstruturada`），
  `apps/web/src/lib/session-destinatario.ts:237`（`resolverDestinatario`），
  `apps/web/src/components/ui/MarkdownMessage.tsx:74`（`CodeFence`）
- **测试：** `apps/web/src/lib/texto-plano.test.ts`，
  `apps/web/src/lib/eco-de-formulario.test.ts`，
  `apps/web/src/lib/session-destinatario.test.ts`（"RN-712"），
  `apps/web/src/components/ui/MarkdownMessage.test.tsx`（"RN-712"）
- **来源：** AT-375

## 一个缓存键，一个问题（RN-718）

### RN-718 — 把会话操作写入缓存的一方，执行与消息流「相同」的读取 {#rn-718}

`['session-actions', projectId, sessionId]` 是 TanStack Query 缓存中的「一个」条目，而「会话」标签页在其中写入的是另一个问题的结果：「第一」页升序数据（`listActions({ limit: 200 })`，不带 `latest`），而会话消息流读取的是最新 200 条的尾部加上被它挤出去的待处理项（[RN-637](api.md#rn-637)）。两个界面互相替换对方的截取——打开该标签页后，消息流可能绘制会话中最「旧」的 200 个操作，即 RN-637 已经关闭的缺陷，从缓存这扇门又被打开了（AT-365）。

**规则：** 键和函数一起走，在 `consultaDasAcoesDaSessao` 中（`apps/web/src/lib/acoes-da-sessao.ts`）。为放入缓存而「读取」会话操作的一方使用这一对——`usePendingActions` 以及「会话」标签页按会话的摘要。曾考虑为该标签页使用专属的键并被否决：它会停止缓存的互换，但会让标签页继续汇总错误的截取。使用相同的读取，摘要也受益——长会话中新的待处理项开始计入「aguardando」。只「使」键失效的一方（审批界面中的决定、实时通道）仍手动编写列表：失效不写入数据。

- **位置：** `apps/web/src/lib/acoes-da-sessao.ts:76`（`chaveDasAcoesDaSessao`），
  `:80`（`consultaDasAcoesDaSessao`）；`apps/web/src/lib/hooks.ts:432`
  （`usePendingActions`）；`apps/web/src/routes/ProjectSessionsTab.tsx:270`
  （`acoesPorSessao`）
- **测试：** `apps/web/src/routes/ProjectSessionsTab.test.tsx`（describe "a
  leitura de ações é a mesma do fio"：在消息流已写入尾部的情况下，挂载标签页后缓存中是尾部 + 待处理项，且没有不带 `latest` 的调用——在旧代码上失败，旧代码写入最旧的 200 个；被挤出尾部的待处理项计入「aguardando」）
- **声明的缺口：** 其 `proposed_action.created` 已移出 200 个事件窗口的操作卡片仍会「跳」到消息流顶部（`ordemDaAcaoNaTimeline` 退化为 `createdAt` 并锚定在 0.5）——作为当前行为固定在 `apps/web/src/routes/SessionPage.acao-fora-da-janela.test.tsx` 中，其修正是另一项决定。同一测试证明已决定的卡片不会再次要求决定：AT-365 中看似「回来」的是「另一个」操作。
- **来源：** AT-365

## Anamnese 不为同一窗口付两次钱，gate 救援不重启正在等人的周期（RN-722）

### RN-728 — 用户的消息只有一个气泡，Dev Lead 的卡片只有一个主操作 {#rn-728}

- **规则：** (1) 发给 agent 的消息的「乐观」气泡，一旦 `chat.message` 出现在日志中，且带有 api 在接受时返回的 `mensagemId`，就从消息流中移除——按 id 匹配，绝不按文本，也不等轮次结束；它的名字来自与日志气泡「相同」的 `autorDaMensagem`（[RN-652](#rn-652)），token 的电子邮件只作为后备。此前两者在轮次期间并存，一个显示名字，另一个显示电子邮件。(2) 在「passou o bastão ao Dev Lead」卡片中，接受 handoff 是主操作，「Ativar execução」是「次要」操作，并提示它跳过了什么：没有计划时，dev 按原样领取任务（[RN-677](api.md#rn-677)）。
- **位置：** `apps/web/src/lib/mensagem-otimista.ts:14`（`otimistaJaNoLog`），
  `apps/web/src/lib/mensagem-otimista.ts:22`（`nomeDaMensagemOtimista`），
  `apps/web/src/routes/SessionPage.tsx:790`（`otimistaJaNoLog`），
  `apps/web/src/routes/session-timeline-montagem.tsx:609`
  （`handleActivateExecution`）
- **测试：** `apps/web/src/lib/mensagem-otimista.test.ts`（正常：日志中的 id 移除乐观气泡；失败：id 缺失或属于其他类型时保留它；名字是成员行的名字），`apps/web/src/routes/SessionPage.cancelar-turno.test.tsx`
  （"com o turno em curso, a otimista sai quando o chat.message do aceite chega
  ao log"），
  `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`
  （"o aceite é o primário; "Ativar execução" é secundário e diz o que pula"）
- **来源：** AT-409 和 AT-410（10月3日的 TP-01）；卡片的形式是负责人的决定（「Secundário com aviso」）

### RN-736 — 「Nome do projeto」字段不会自行获得焦点，也不叫「name」 {#rn-736}

- **规则：** 在项目向导的详情步骤中，「Nome do projeto」字段「不」带 `autoFocus`，并使用 `id`/`name` `project-title`（自 RN-834 起为 `projeto-slug`），绝不是单纯的「name」；关闭密码管理器的属性（`data-1p-ignore`、`data-lpignore`、`data-bwignore`、`data-form-type="other"`）仍来自单一来源 `SEM_AUTOFILL`（RN-729）。决定：任何情况下都不自动聚焦（键盘也不）——这些扩展的「Contact Info」菜单在「聚焦」时打开，忽略 `autocomplete="off"`，并遮住页面；多一次点击或 Tab 是代价。这些属性名是 1Password、LastPass、Bitwarden 和 Dashlane 公开记录的，此处没有针对每个扩展测量。
- **位置：** `apps/web/src/routes/NewProjectWizard.tsx:746`（`projeto-slug`），
  `apps/web/src/lib/conversa-comecou.ts:29`（`SEM_AUTOFILL`）
- **测试：** `apps/web/src/routes/NewProjectWizard.test.tsx`（"RN-736: o campo
  de nome não ganha foco sozinho nem se chama \"name\"" 以及 RN-729 的那个，它检查四个属性）
- **来源：** AT-418（TP-01，10月3日第 2 轮）

### RN-740 — 「Nome do projeto」字段声明它不提供任何建议，其余缺口属于扩展 {#rn-740}

- **规则：** `SEM_AUTOFILL` 增加 `aria-autocomplete="none"`（可访问性树说明该字段不提供建议）和 `data-protonpass-ignore`（Proton Pass 记录的属性）。可见标签和可访问名称仍是「Nome do projeto」：只改 `aria-label` 会破坏「名称中的标签」（WCAG 2.5.3），改可见标签是产品决定，没有作出。在 10月3日的 TP-01 中测得：即使有 RN-736 的属性，「Contact Info」菜单仍在聚焦/输入时打开——扩展可能是按标签的「文字」分类的。如果下一次 TP-01 在有这些属性时复现，缺口就属于「扩展」，并在此声明。
- **位置：** `apps/web/src/lib/conversa-comecou.ts:29`（`SEM_AUTOFILL`）
- **测试：** `apps/web/src/routes/NewProjectWizard.test.tsx`（"RN-740: …"）
- **来源：** AT-425（TP-01，10月3日第 3 轮）

### RN-747 — Dev Lead 的计划说明会启动多少个 dev agent，而不是它要求多少个 {#rn-747}

- **规则：** 批准 `propose_execution_plan` 会激活执行（RN-677），激活为每个模块启动「一个」dev agent；计划中按模块的 `agentes` 只是建议。审批卡片写明「sobe N dev agent(s), um por
  módulo」，当计划要求更多时，说明多出的 agent 只有在用户之后接受并行化时才会启动——并行化是 RN-154 的上限，绝不自动批准，也不嵌入计划的批准中。回到 Dev Lead 的工具结果说明同样的内容，`agentes` 的描述要求不要承诺并行化收益。在句子引用摘要之前，去掉模型放在摘要两端的引号，以免残留 `coberto."`。
- **位置：** `apps/web/src/lib/aprovacoes.ts:317`（`propose_execution_plan`），
  `apps/engine/lib/engine/agents/dev_lead_tools.ex:254`（`sobem`），`:245`
  （`classificar`），`:97`（`spec`）
- **测试：** `apps/web/src/lib/aprovacoes.test.ts`（"plano com 2 agentes num
  módulo único diz que sobe 1…"；"plano sem agente a mais não fala de
  paralelizar"），`apps/engine/test/engine/agents/dev_lead_tools_test.exs`
  （"agente a mais no plano é dito como NÃO subindo"）
- **来源：** AT-437（10月8日：批准的计划承诺「2 agentes no módulo
  único… ~40% de ganho」，执行只启动了 1 个 dev）

### RN-748 — 等待审批会关闭轮次条并把卡片带到视野内 {#rn-748}

- **规则：** 当 agent 挂起轮次等待人工审批时（`agent.status: awaiting_approval`，目前是 Dev Lead 在 `propose_execution_plan` 中，RN-284），会话界面也通过「通道」把它当作轮次「结束」——而不只是通过日志读取（`turnoTerminouNoLog`，它早已如此）：活动条移除，「Pôr na fila」和「Parar」也随之移除。并且当日志中出现「新」的等待时（最近一次等待的 `seq` 在打开之后改变），消息流滚动到底部，「不」受 RN-173 的 120px 守护约束，因为审批卡片正是此人需要看到的。带着旧的等待重新打开会话时，除了常规的打开之外不会滚动。
- **位置：** `apps/web/src/lib/session-channel.ts:232`（`awaiting_approval`），
  `apps/web/src/lib/session-turno.ts:418`（`awaiting_approval`），
  `apps/web/src/lib/session-rolagem.ts:30`（`seqDaEsperaPorAprovacao`），
  `:141`（`esperaPorAprovacao`）
- **测试：** `apps/web/src/lib/session-channel.test.ts`（`onAgentStatus repassa
  awaiting_approval (RN-748)`），`apps/web/src/lib/session-rolagem.test.ts`
  （`seqDaEsperaPorAprovacao (RN-748)`：最近的等待；没有等待时为 `null`）
- **来源：** AT-432（TP-01：Dev Lead 处于 `awaiting_approval`，「Montando o plano de execução」条仍活跃，卡片不在视野内）

### RN-749 — 被上限截断的回答提供一键继续 {#rn-749}

- **规则：** 收尾以 engine 附加给被输出上限截断的回答的那一行结束（RN-737，两种语言）的 agent 气泡，在会话活动时显示「Continuar de onde parou」按钮。点击通过与 composer 相同的发送方式，向「同一」agent 发送文本「Continue de onde parou.」（使用界面语言）——有轮次进行中时进入它的队列（RN-673）——此人正在写的草稿不受影响。只有收尾有按钮；轮次的步骤没有。界面按文本识别这一行，这两句话就是与 `Engine.Harness.RespostaCortada` 的契约。
- **位置：** `apps/web/src/lib/resposta-cortada.ts:14`（`respostaCortada`），
  `apps/web/src/routes/session-timeline-montagem.tsx:889`（`respostaCortada`），
  `apps/web/src/routes/SessionPage.tsx:447`（`continuarRespostaCortada`），
  `:686`（`enviarMensagem`）
- **测试：** `apps/web/src/lib/resposta-cortada.test.ts`（`respostaCortada
  (RN-749)`：两行都能识别；完整回答以及位于文本中间的这句话不被识别）
- **来源：** AT-434（TP-01：被截断的回答没有提供操作，用户只好猜着输入「continue」）

### RN-750 — 按 agent 的折叠让每个 agent 的收尾保持展开 {#rn-750}

- **规则：** 在 agent 交出接力棒之后按 agent 折叠消息（RN-138）时，绝不折叠该 agent 在消息流中的「最后」一条消息——收尾，在 handoff 中就是此人刚刚读过的摘要。折叠的是同一序列中它之前的内容，并且只在有两条或以上时（单独一条不会变成标题，RN-138 的常规标准）。同一 agent 被其他发言隔开的较早序列照旧折叠。消息流的截断（RN-644）不变：它在已分组的列表上运行。
- **位置：** `apps/web/src/routes/session-fio.tsx:155`（`fechoDeCadaAgente`），
  `:181`（`fechoPorAgente`），`:190`（`indiceDoFecho`）
- **测试：** `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`
  （`duas mensagens consecutivas do PO colapsam...`：两条折叠，收尾展开；`RN-750: com duas mensagens, o fecho fica aberto e a outra, sozinha,
  não vira grupo`）
- **来源：** AT-435（TP-01：在 handoff 时消息流折叠了 Criativo 的整个回答，「Criativo · 2 mensagens」，把摘要藏了起来）

### RN-751 — 会话和目录不会跳动：composer、当前标签页、批量栏和滚动 {#rn-751}

- **规则：** 四项布局修正，每项都是一条界面规则。
  (1) composer 在轮次期间不挤压输入框：按钮不收缩也不折行文字，放不下时换到下一行。(2) 项目框架未挂载时，侧边栏标记的标签页是「路由」所隐含的——在会话界面中是「Chat」——只有在此之外才用默认的。(3) 模型目录的批量操作栏「覆盖」在列表之上，固定在窗口底部，打开时该节在末尾增加留白；放在流中时它会推动列表，复选框会从光标下跑开。(4) 消息流在此人在高度变化「之前」处于底部时也会「跟随到底」（RN-173）——意图在滚动手势中测量，内容小于窗口时被夹住的滚动不会改变它。120px 的守护保留：向上滚动的人不会被拖走。Infra handoff 接受时跳到顶部的原因没有在浏览器中复现；修正覆盖的是这一类问题（内容缩小后又恢复）。
- **位置：** `apps/web/src/routes/project-tabs.ts:383`（`abaDaRota`），
  `apps/web/src/routes/Shell.tsx:510`（`abaDaRota`），
  `apps/web/src/lib/session-rolagem.ts:16`（`estaPertoDoFim`），`:82`
  （`estavaNoFimRef`），`:120`（`aoRolarOFio`），
  `apps/web/src/components/ModelCatalogSection.module.css`（`.barraDeLote`），
  `apps/web/src/routes/SessionPage.module.css`（`.composer`）
- **测试：** `apps/web/src/lib/session-rolagem-fim.test.ts`（`estaPertoDoFim`
  和 `abaDaRota`：正常路径和失败），`apps/web/src/routes/Shell.test.tsx`
  （`sem a moldura montada (ex.: tela de Sessão)`：标记 Chat），
  `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`（`não arrasta
  quem rolou pra cima`）
- **来源：** AT-442（TP-01，视觉调查）

### RN-755 — 开启自动模式不会批准开启它的那张卡片 {#rn-755}

- **规则：** 在 `ApprovalCard` 中（四个界面中都是同一个），「Modo automático」按钮写入 agent 的通配符（RN-153），「不」决定卡片本身的操作：它仍是待处理，「Aprovar」是主操作。凡是显示该按钮的地方，都会同时在点击前显示一条说明（「Ligar o
  modo automático não aprova esta ação: ela continua esperando o seu
  Aprovar.」）。在开启模式的同时批准卡片将是负责人的决定，「没有」做。
- **位置：** `apps/web/src/components/ApprovalCard.tsx:203`（`ApprovalCard`）
- **测试：** `apps/web/src/components/ApprovalCard.test.tsx`（`ligar o
  "Modo automático" não aprova o card, e o card diz isso`；没有按钮时说明不出现）
- **来源：** AT-443（TP-01：在待处理卡片上开启的模式没有批准它，界面上也没有任何东西说明原因）

### RN-766 — 等待点击而停住的 gate 会被说明，批量提议覆盖 QA 的子 agent {#rn-766}

- **规则：** 在「需要你处理」面板中（[RN-467](#rn-467)），由「gate」agent（QA 区域——`qa`、`qa-*`——或 SecOps）提出的待处理操作，在「同一个」`ApprovalCard` 上方获得一句话，说明该 gate 在决定之前处于「停止」状态；每张卡片一句，绝不是队列的总和。「执行者」标签页中自动模式的批量提议（[RN-661](#rn-661)）从激活起就列出 QA 区域的 agent（`AREAS.qa`），不等它们出现在 roster 中——此前 `qa-automacao` 只有在它的第一个事件之后才进入提议，而那时第一个操作已经在等待点击。默认的 `allow`（`permissions.json` 中）「不」变（负责人的决定）。
- **位置：** `apps/web/src/lib/precisa-de-voce.ts:256`（`gateEsperandoClique`）
  和 `apps/web/src/components/ModoAutomaticoDoTime.tsx:63`
  （`agentesDaOfertaEmLote`）
- **测试：** `apps/web/src/lib/precisa-de-voce.test.ts`（QA 和 SecOps 的 gate 被点名；dev agent 和人不被点名）和
  `apps/web/src/components/ModoAutomaticoDoTime.test.tsx`（提议在 roster 之前覆盖 QA 的子 agent，不重复）
- **来源：** AT-449（10月9日的 TP-01：`qa-automacao` 提议了 `ls; cat; for f in test/*.js…`，其中一个片段不在 `allow` 中，没有自动模式，待处理了 25 分钟，唯一的信号是「审批」计数器）

### RN-768 — 在 PR 标签页，Merge 旁边的文字说出按钮的真实情况 {#rn-768}

- **规则：** 待处理的 gate 仍是「提示」，不锁住合并（[RN-663](api.md#rn-663)）。「被阻塞」的任务（`task.blocked`）是另一回事，会禁用按钮；此时 PR 行「不」显示「o merge segue
  disponível」：它以文字说明合并不可用，因为任务被阻塞（点名待处理的 gate，如有，或阻塞原因）。项目中没有会话时也一样：原因以文字给出，绝不只放在 `title` 中（`disabled` 按钮的），后者在 Chromium 中不会弹出。被阻塞的任务是否应锁住合并是负责人的问题，此处不作决定。
- **位置：** `apps/web/src/routes/ProjectPrsTab.tsx:276`（`avisoDaLinha`）
- **测试：** `apps/web/src/routes/ProjectPrsTab.test.tsx`（"AT-451: tarefa
  bloqueada com gate pendente NÃO diz que o merge segue disponível"）
- **来源：** AT-451（10月9日的 TP-01：「O merge segue disponível — a decisão é
  sua」显示在一个禁用的「Merge」旁边）

### RN-769 — 结束有活动执行的会话会先询问，状态以翻译后的形式出现 {#rn-769}

- **规则：** 在有活动执行的会话中（窗口中有 `execution.activated` 事件，或整个会话的已激活者中有某个 `dev-<modulo>`——Dev Lead 不算，它在执行之前做规划）点击「Encerrar」，会打开一个确认，说明会停止什么：会话的 agent 立即停止，进行中的命令被截断，进行中的轮次不被写入，有执行的会话不能重新打开（[RN-650](api.md#rn-650)）。没有执行时，点击照旧直接结束。composer 中会话已结束的句子插入的是「翻译后」的状态（`pontoDaSessao(...).rotuloKey`），绝不是原始枚举（`closed`）。这一点在「代码」中守护，而不只在 locale 中：词汇标准读取的是 JSON，而枚举是在运行时通过插值进入的；`i18n-enum-cru.test.ts` 拒绝 `t(…, { status: x.status })`。
- **位置：** `apps/web/src/routes/ConfirmarEncerramento.tsx:13`
  （`useEncerrarComConfirmacao`）和 `apps/web/src/routes/SessionComposer.tsx:473`
  （`statusGenerico`）
- **测试：** `apps/web/src/routes/ConfirmarEncerramento.test.tsx`（没有执行时直接结束；有执行时只在确认后结束；取消不结束）和 `apps/web/src/lib/i18n-enum-cru.test.ts`（修正前会拒绝 `SessionComposer.tsx`）
- **来源：** AT-452（10月9日的 TP-01：「Encerrar」在 3 秒内关闭了执行会话，dev agent 正处在一次 `npm install` 中途，栏上显示「Sessão
  closed」）

### RN-788 — 团队的决定和时间线不对没读到的东西下断言 {#rn-788}

- **规则：** 在「Contexto da sessão」面板中，「Decisões registradas」遵循与规则相同的声明截取（[RN-701](#rn-701)）：有窗口之前的事件时，计数器显示「N na janela · há mais antes」，空状态说明之前的事件中可能有决定，绝不说「Nenhuma decisão registrada nesta
  sessão」。在「概览」中，「Linha do tempo do time」在存在「执行」会话时读取它（与侧边栏相同），并在它不是最近的会话时在副标题中说明。没有多一次请求：这些键是侧边栏已经订阅的，`useActiveExecutionSession` 获得与间隔相等的 `staleTime`，让第二个订阅者不重新获取（[RN-632](#rn-632)）。
- **位置：** `apps/web/src/routes/ContextAside.tsx:393`（`trailing`），
  `apps/web/src/routes/ProjectOverviewTab.tsx:86`（`linhaDoTempoNaExecucao`）
- **测试：** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  （窗口外的决定不会变成 0；整个会话都在窗口中时说明为空），
  `apps/web/src/routes/ProjectOverviewTab.test.tsx`（读取执行会话并说明；没有执行时读取最近的），`apps/web/src/routes/duas-abas.orcamento.test.tsx`
  （「概览」的加载仍在上限内）
- **来源：** AT-463（10月9日的 TP-01）

### RN-789 — 在会话界面，侧边栏标记会话所在列表的标签页 {#rn-789}

- **规则：** 会话界面发布会话「类型」所隐含的标签页——创意会话在「Criativo」（构思列表），咨询会话在「Chat」——侧边栏标记它，而不是总标记「Chat」（[RN-751](#rn-751)）；点击会带到会话出现的列表，也就是回到它的路径。会话仍在加载，或发布的标签页属于另一个项目时，落到「Chat」。没有新的读取：类型已随会话一起到来。
- **位置：** `apps/web/src/routes/project-tabs.ts:383`（`abaDaRota`），
  `apps/web/src/lib/session-kind.ts:94`（`usePublicarAbaDaSessao`）
- **测试：** `apps/web/src/lib/session-rolagem-fim.test.ts`（创意会话标记「Criativo」；其他项目的或无效的标签页无效）
- **来源：** AT-463（10月9日的 TP-01）

### RN-794 — 没有当前执行时，界面说明还剩下什么待处理，并通过同一路径重新启动 {#rn-794}

- **规则：** 当对当前执行会话的读取（[RN-139](api.md#rn-139)）「确认」没有任何执行会话，且 backlog 中有不是 `done` 的任务（`todo`——包括被 gate 退回的——、`in_progress`、`in_review`、阻塞）时，「执行者」标签页和「概览」的「执行」一节会说明有多少个，并提供「Religar execução」，它调用与「Ativar execução」按钮「相同」的 `POST .../execution/activate`（`ActivateExecutionUseCase`），不带 `originSessionId`（就像「概览」一直以来的调用：没有聊天会话需要 api 关闭，[RN-135](api.md#rn-135)）。拒绝（没有仓库的 409、咨询会话、角色）以 api 的句子显示。没有当前执行时，「Desbloquear」会提示任务只有在执行被重新启动后才会运行——按钮就在同一节中。在「执行者」标签页中，只有在确认缺失后才读取 backlog（执行运行时查询关闭，开启时按项目节奏，[RN-632](#rn-632)）。
- **位置：** `apps/web/src/components/ReligarExecucao.tsx:23`（`ReligarExecucao`），
  `apps/web/src/lib/execution.ts:21`（`contarTarefasPendentes`），
  `apps/web/src/routes/ProjectExecutorsTab.tsx:99`（`semExecucaoVigente`），
  `apps/web/src/routes/ProjectOverviewTab.tsx:506`（`semExecucaoVigente`）
- **测试：** `apps/web/src/routes/ProjectExecutorsTab.test.tsx`（重新启动执行），`apps/web/src/routes/ProjectOverviewTab.test.tsx`（重新启动已结束的执行）
- **来源：** AT-469

### RN-800 — 团队时间线按家族过滤，而不是按最近会话的 roster {#rn-800}

- **规则：** 「概览」的「Linha do tempo do time」树在有当前执行时读取「执行」会话（AT-463），并按角色的「家族」从中去掉 dev agent 和 QA 的事件（`isExecutorAgentId`，与「执行者」标签页相同的标准，RN-121）——绝不按 roster，它是从最近的会话推导出来的。按 roster 过滤会抹掉所有只在执行中行动过的 agent（handoff 在那里被接受的 Infra Lead），而在之后打开一个构思会话时，树会对一个正在工作的团队说「Nenhum agente entrou em ação nesta sessão ainda」。没有新的读取。
- **位置：** `apps/web/src/routes/ProjectOverviewTab.tsx:267`（`overviewEvents`）
- **测试：** `apps/web/src/routes/ProjectOverviewTab.test.tsx`（"AT-471: agente
  que só agiu na execução aparece na árvore…"；没有执行的情况仍读取最近的）
- **来源：** AT-471（10月10日的 TP-01）

### RN-801 — 新会话的名称不招来密码管理器 {#rn-801}

- **规则：** 新会话表单（Criativo 标签页和 Chat 标签页）的「Nome (opcional)」字段获得与 composer 和向导「相同」的 `SEM_AUTOFILL`（[RN-736](#rn-736)/[RN-740](#rn-740)）：`autocomplete="off"`、`aria-autocomplete="none"` 以及 1Password、LastPass、Bitwarden 和 Proton Pass 的忽略属性。会话的 composer 早已有它。该常量「没有」NordPass 的忽略属性，也没有捏造一个：如果 NordPass 仍然附着，其余缺口属于扩展，与 RN-740 一样。
- **位置：** `apps/web/src/routes/ProjectSessionsTab.tsx:319`（`SEM_AUTOFILL`），
  `apps/web/src/lib/conversa-comecou.ts:29`（`SEM_AUTOFILL`）
- **测试：** `apps/web/src/routes/ProjectSessionsTab.test.tsx`（"AT-472: o nome
  da nova ideação não convida o gerenciador de senhas"）
- **来源：** AT-472（10月10日的 TP-01）

### RN-803 — 自动模式的批量提议在知道谁已开启之前保持不可操作 {#rn-803}

- **规则：** 在项目 `agent_autonomy` 的读取到达之前，「执行者」标签页的「Ligar para N agentes」（[RN-661](#rn-661)）和 agent 复选框都是 `disabled`，以文字说明原因（「Lendo quais agentes já
  estão em modo automático…」）；这段时间内的点击不写入任何东西。此前列表以「所有」agent 作为猜测开始，读取到达时缩小，导航后的第一次点击会落到另一个元素上，既不写入也不说明。批量的结果（全部、一个都没有并附 api 的句子、部分）即使写入后的重新读取失败也会说明。已声明：PR 标签页的「Merge」、「Nova ideação」以及「Aplicar a
  todos os agentes」中的同样症状此处「没有」复现也没有修正。
- **位置：** `apps/web/src/components/ModoAutomaticoDoTime.tsx:98`（`carregando`）
- **测试：** `apps/web/src/components/ModoAutomaticoDoTime.test.tsx`（"AT-477
  (RN-803): antes de a leitura de agent_autonomy chegar, o botão fica inerte e
  diz por quê"）
- **来源：** AT-477（10月10日的 TP-01）

### RN-804 — Dev Lead 计划的卡片在批准之前提供批量自动模式 {#rn-804}

- **规则：** `ApprovalCard`（待处理的 `propose_execution_plan`）在「Aprovar」上方显示与「执行者」标签页「相同」的批量提议控件（[RN-661](#rn-661)）：计划启动的 `dev-<modulo>`（与 api 的 `devAgentId` 相同的推导）加上 gate 子 agent，全部勾选，不点击「Ligar」就不写入任何东西。相同的端点（`PUT .../agent-autonomy`，通配符 `*`），每个 agent 一次 PUT，按 agent 的结果，以及同一份自动模式不放行内容的列表。批准会激活执行（[RN-677](api.md#rn-677)），dev 紧接着请求第一个命令；之后再开启不会批准待处理项（[RN-755](#rn-755)）。只在调用方传入了自动模式回调（角色 `maintainer`）且有 `QueryClient` 时出现。卡片仍是唯一的（AT-322）：这是该类型多出的一块，而不是外观变体。
- **位置：** `apps/web/src/components/ApprovalCard.tsx:386`
  （`ModoAutomaticoDoPlano`），`apps/web/src/components/ModoAutomaticoDoPlano.tsx:17`
  （`agentesDoPlano`）
- **测试：** `apps/web/src/components/ApprovalCard.modo-automatico-do-plano.test.tsx`
- **来源：** AT-476（10月10日的 TP-01）

### RN-815 — 「Parar execução」统计进行中「和」审查中的任务，从 backlog 读取 {#rn-815}

- **规则：** 「Parar execução」的确认（[RN-763](engine.md#rn-763)）按「backlog」统计任务，只在确认打开时读取，而不是按事件窗口：`in_progress` 和 `in_review`（QA gate 正在运行）分句说明，每句说明停止时它会怎样——进行中的被阻塞，工作被保留；审查中的 gate 被停止，并在 PR 打开的情况下被阻塞；两者在解除后都回到队列。此前计数来自窗口中有 task 的 dev agents，而审查中的任务（没有 dev 在处理）让界面断言「Nenhuma tarefa está em curso」。backlog 加载中或出错时以专属文字说明，绝不说「nenhuma」。同时，Dev Lead 计划的卡片（[RN-804](#rn-804)）以专属文字（「Ao aprovar o plano, a execução começa」）开启批量提议，因为在那里执行尚未开始（[RN-677](api.md#rn-677)）。
- **位置：** `apps/web/src/lib/execution.ts:37`（`contarTarefasAfetadasAoParar`），
  `apps/web/src/components/PararExecucao.tsx:26`（`PararExecucao`），
  `apps/web/src/components/ModoAutomaticoDoTime.tsx:73`（`ModoAutomaticoDoTime`）
- **测试：** `apps/web/src/components/PararExecucao.test.tsx`（"RN-815 (AT-488):
  a tarefa em revisão de QA conta…"；"RN-815: sem backlog lido não afirma…"），
  `apps/web/src/components/ModoAutomaticoDoTime.test.tsx`（"RN-816 (AT-488): no
  cartão do plano não afirma que a execução começou"）
- **来源：** AT-488（10月10日的 TP-01）

### RN-816 — 迟到的块到达时按钮不会移位 {#rn-816}

- **规则：** 在首次绘制「之后」到达的块不会出现在此人要点击的按钮上方，需要位于上方的则在加载期间预留空间。在会话中，其他会话的待处理项（[RN-626](#rn-626)）位于消息流「上方」——在消息流和 composer 之间时，它们从下方挤压消息流，加上「跟随到底」（[RN-751](#rn-751)），最后的卡片（「Aceitar handoff e iniciar…」）会在光标下上移。在「执行者」标签页中，它们排在「Parar execução」和批量提议「之后」。在 PR 标签页中，Merge 排在行的列中第一个，依赖 backlog 的 gate 流水线在加载期间有预留高度（骨架）。已声明：流水线的预留是一行阶段的流水线高度，没有在浏览器中测量，jsdom 不做布局——测试证明的是「顺序」和预留，而不是像素位移。
- **位置：** `apps/web/src/routes/SessionPage.tsx`（`PendenciasDeOutrasSessoes`
  位于 `styles.messages` 之前），`apps/web/src/routes/ProjectExecutorsTab.tsx`，
  `apps/web/src/routes/ProjectPrsTab.tsx:103`（`ProjectPrsTab`），
  `apps/web/src/routes/ProjectPrsTab.module.css`（`.reservaDaEsteira`）
- **测试：** `apps/web/src/routes/salto-de-layout.test.ts`，
  `apps/web/src/routes/ProjectPrsTab.test.tsx`（"RN-816 (AT-480): o Merge não
  muda de lugar quando o backlog chega"）
- **来源：** AT-480（10月10日的 TP-01）

### RN-821 — 登记为运行而观察到已停止时提供「Subir de novo」 {#rn-821}

- **规则：** 在 `/containers` 中，记录为 `running` 而「观察」状态为 `exited` 的行不再是「已在运行」，而是提供该模式的启动操作（`acaoDeSubidaDoModo`），无需先停止，并以文字给出保留意见 `registrado_rodando_observado_parado`。只有观察结果能解锁：没有观察，或观察为 `running` 时，记录仍然有效。api 本来就接受：`ExecuteContainerStartUseCase` 遇到 `running` 行时不做任何转换（ADR 0081 的状态机不变），broker 对已停止的容器执行 `docker
  start`。
- **位置：** `apps/web/src/routes/containers-subida.ts:125`（`caiuPorFora`）
- **测试：** `apps/web/src/routes/containers-subida.test.ts`（"AT-494:
  registrado running e observado exited oferece subir de novo, com a ressalva"
  和 "AT-494: registrado running e observado running (ou não observado) continua
  já de pé"）
- **来源：** AT-494

### RN-822 — 第一次点击 Merge 就打开卡片，不等待队列 {#rn-822}

- **规则：** [RN-816](#rn-816) 的扩展。在 PR 标签页中，创建 `proposed_action`（`git_merge`）的「Merge」点击立即用 api「返回」的操作显示决定卡片，而不是等待项目队列（`useProjectPendingActions`）返回。此前，在提议的回应与队列重新获取之间，按钮恢复而没有任何卡片，此人会以为「点击没生效」。本地操作按 PR id 生效，仅在队列还没有比提议「更新」的读取（`dataUpdatedAt`）期间；有更新的读取时，由队列说明它是否仍待处理。作出决定（批准、拒绝、始终允许）会忘掉它。已声明：原因是在「代码」中测得的（卡片依赖重新获取），不是在浏览器中；重新获取慢到让点击看似丢失，是从 TP-01 推断出来的。
- **位置：** `apps/web/src/routes/ProjectPrsTab.tsx:125`（`acaoDaPr`）
- **测试：** `apps/web/src/routes/ProjectPrsTab.test.tsx`（"RN-822 (AT-493):
  o 1º clique em Merge abre o cartão sem esperar a fila do projeto voltar" 和
  "RN-822: a fila lida DEPOIS da proposta, sem ela, vence o cartão local"）
- **来源：** AT-493（10月10日的 TP-01）

### RN-824 — 有了模块映射之后，composer 说明下一步是确认架构 {#rn-824}

- **规则：** 向 Infra 的提议仍是「人」的点击（「Confirmar
  arquitetura pronta」）；变化的是界面会「提示」。当 Arquiteto 活跃、没有轮次进行中、它的 handoff 尚未提出，且会话中已写入 `artifact.module_map` 时，composer 以可见文字说明可以确认架构，让系统向 Infra 提出。没有已提升的故事时，同一位置以文字说明按钮不可操作的原因，一次（禁用按钮的 `title` 在 Chromium 中不会弹出，[RN-102](api.md#rn-102)）；启用的按钮在 `title` 中获得说明。推导读取界面已有的 `events`——没有新的查询（[RN-579](engine.md#rn-579)）。
- **位置：** `apps/web/src/lib/session-readiness.ts:149`（`temMapaDeModulos`），
  `apps/web/src/routes/SessionComposer.tsx:365`（`hasModuleMap`）
- **测试：** `apps/web/src/routes/SessionPage.proximo-passo-arquitetura.test.tsx`
  （"mapa gravado + história promovida + Arquiteto parado: o texto aparece"；
  失败："com o handoff do Arquiteto já oferecido, o texto some"，"com turno
  em curso (streaming), o texto não aparece"，"sem história promovida, o
  motivo vem em texto visível"）
- **来源：** AT-491（选项 a：人的动作是设计，缺陷在于界面没有提示）

### RN-825 — 聊天显示可以合并的 PR，并在那里提议合并 {#rn-825}

- **规则：** 在会话消息流上方，与其他会话的待处理项（[RN-626](#rn-626)）并列，「PRs prontas para merge」队列列出项目中「打开」的 PR，它们的任务 gates 已获批（`gateStatus: awaiting_user`）或者没有任务（ADR、infra），并且没有来自「另一个」会话的待处理 `git_merge`（那种已在「Merges de PR」中）。「Mergear」在本会话中「提议」合并，通过与 PR 标签页相同的端点，审批卡片以 api 返回的操作出现在 PR 行上（[RN-822](#rn-822)）；合并仍是手动的（[RN-418](api.md#rn-418)）。每个队列有自己的标题和计数，绝不相加（[RN-467](#rn-467)），读取就是 PR 标签页和 backlog 已在做的那些（相同的 `queryKey`，backlog 为 15 秒），没有新的紧密轮询（[RN-579](engine.md#rn-579)）。
- **位置：** `apps/web/src/lib/prontas-e-bloqueadas.ts:30`（`prsProntasParaMerge`），
  `apps/web/src/components/PendenciasDeOutrasSessoes.tsx:112`（`prontas`）
- **测试：** `apps/web/src/components/PendenciasDeOutrasSessoes.test.tsx`
  （"a PR com os gates aprovados aparece, a com gate pendente não, e Mergear
  mostra o cartão ali"）
- **来源：** AT-497（通过 Criativo 的聊天进行的 TP-01）

### RN-826 — 聊天列出被阻塞的任务并在那里解除阻塞 {#rn-826}

- **规则：** 在同一区域，「Tarefas bloqueadas」队列列出 backlog 中 `blocked` 的任务，带标题和原因（`blockedReason`，或「sem motivo
  registrado」），「Desbloquear」以打开的会话调用与「概览」相同的 `unblock`（[RN-794](#rn-794)）。结果在任务行上说明：成功以文字说明，拒绝附 api 的句子。低于 `developer` 的角色能看到队列，按钮不可操作并以文字说明原因。
- **位置：** `apps/web/src/lib/prontas-e-bloqueadas.ts:53`（`tarefasBloqueadas`），
  `apps/web/src/components/PendenciasDeOutrasSessoes.tsx:180`（`desbloquear`）
- **测试：** `apps/web/src/components/PendenciasDeOutrasSessoes.test.tsx`
  （"CASO DE FALHA: desbloquear com erro diz o erro da api na linha da tarefa"）
- **来源：** AT-497

### RN-829 — 消息流中说话者的头像是 agent 的，在流式期间和之后都一样 {#rn-829}

- **规则：** 流式中的 agent 气泡和回答的持久化气泡（`agent.response`）按 agent 的 id 绘制「同一个」头像 `AvatarDoAgente`。此前进行中的气泡显示 agent 的图标，持久化的显示模型的图标，轮次结束时头像当着此人的面切换。生成回答的模型仍只显示在名字旁边的标签中。不在 roster 中（或没有 id）的 agent 退化为通用图标，绝不是空框。
- **位置：** `apps/web/src/components/ui/AvatarDoAgente.tsx:22`（`AvatarDoAgente`），
  `apps/web/src/routes/SessionFio.tsx:284`（`BolhaDoStreaming`），
  `apps/web/src/routes/session-timeline-montagem.tsx:120`（`montarTimeline`）
- **测试：** `apps/web/src/routes/SessionFio.at503.test.tsx`（"a bolha
  persistida usa o avatar do agente, não o do modelo; o modelo segue no chip"，
  "a bolha em streaming usa o MESMO avatar"；退化："sem agente
  identificado, degrada para o avatar genérico"）
- **来源：** AT-503（TP-01 第 11 次，聊天 UX 说明 §2.1）

### RN-830 — composer 尊重重音组合输入，消息流与屏幕阅读器对话 {#rn-830}

- **规则：** 只有在没有进行中的组合输入时 Enter 才发送（`nativeEvent.isComposing`）——在 IME 或死键输入重音的过程中，它确认字符。消息流的容器是 `role="log"`（带名称），轮次的活动条（[RN-460](#rn-460)）是 `role="status"`，带 `aria-live="polite"`：屏幕阅读器播报新回答以及 agent 正在做什么，而不打断正在阅读的人。检查放在 composer 中，而不是页面中，页面已达到行数上限（[ADR 0176](../adr/0176-sessionpage-abaixo-de-mil-linhas.md)）。
- **位置：** `apps/web/src/routes/SessionComposer.tsx:81`（`ignorarComposicaoIme`），
  `apps/web/src/components/TurnActivityStrip.tsx:41`（`TurnActivityStrip`）
- **测试：** `apps/web/src/routes/SessionFio.at503.test.tsx`（"Enter sem
  composição chega ao handler de envio"，"a faixa do turno é uma região de
  status educada"；失败："Enter no meio da composição de acento NÃO envia"）
- **来源：** AT-503（聊天 UX 说明 §3）

### RN-831 — 未发送的消息留在消息流中，带「重试」 {#rn-831}

- **规则：** 当向 agent 发送消息失败时（会话已结束导致的拒绝除外，那会把文本还给输入框——AT-154），乐观气泡不会消失：文本留在消息流中，带「não enviada」徽章和「Tentar de
  novo」按钮，后者通过常规路径把「同一」文本重新发给「同一」接收者。一次只有一条；新的发送（或重发本身）会替换它。说明原因的 toast 仍然保留。
- **位置：** `apps/web/src/lib/mensagem-nao-enviada.ts:29`
  （`marcarMensagemNaoEnviada`），`apps/web/src/routes/SessionFio.tsx:52`
  （`SessionFio`）
- **测试：** `apps/web/src/routes/SessionFio.at503.test.tsx`（"mostra o texto
  com \"não enviada\" e reenvia ao clicar em tentar de novo"，"um envio novo
  (otimista acesa) substitui a não enviada"）；
  `apps/web/src/routes/SessionPage.turno-preso.test.tsx`（失败："CASO DE
  FALHA: erro no envio desarma o turno e a mensagem fica \"não enviada\"
  (RN-831)"）
- **来源：** AT-503（聊天 UX 说明 §3）

### RN-833 — web 的每个 Phoenix 套接字都会被丢弃，被替换的那个不再起作用 {#rn-833}

- **规则：** web 的每个 Phoenix 套接字都由 `criarSocket` 产生，由 `descartar()` 结束，后者执行 `disconnect()` 并移除 `phoenix@1.8.9` 构造函数在 `window` 上注册的三个监听器（`pagehide`、`pageshow`、`visibilitychange`）——单独的 `disconnect()` 会留下它们，而 `visibilitychange` 会重新打开旧套接字。在会话通道中，每次 `conectar()` 都是一个「代」：在新的一代产生之前，前一代被丢弃（leave、`descartar()` 以及「它的」ping），旧代的每个回调都是空操作——被替换套接字的 `onClose` 不会安排重连，不会清除当前的 ping，也不会把活着的通道标记为死亡。活通道（[RN-579](engine.md#rn-579)）是按会话的连接「计数」，不是布尔值。自动重连的中和（[RN-108](#rn-108)）在 `criarSocket` 的类型中仍是必需的。
- **位置：** `apps/web/src/lib/socket-phoenix.ts:31`（`criarSocket`），
  `apps/web/src/lib/session-channel.ts:92`（`descartarGeracao`），
  `apps/web/src/lib/session-channel.ts:136`（`ehAtual`），
  `apps/web/src/lib/canal-vivo.ts:70`（`marcarCanalDaSessao`）
- **测试：** `apps/web/src/lib/socket-phoenix.test.ts`（真实 Phoenix："50×
  criar + descartar deixa saldo líquido 0 nos três ouvintes de window"；
  失败："socket só desconectado (sem descartar) deixa os três ouvintes"），
  `apps/web/src/lib/session-channel.test.ts`（"gerações (AT-500, RN-833)"），
  `apps/web/src/lib/canal-vivo.test.ts`
- **来源：** AT-500

### RN-834 — 向导中的项目名称不叫「title」 {#rn-834}

- **规则：** 创建向导的「Nome do projeto」字段使用 `id`/`name` `projeto-slug`，它们不匹配任何联系人数据 token（`name`、`nome`、`title`、`first`、`last`、`company`、`contact`）。[RN-736](#rn-736) 的 `project-title` 去掉了「name」，但「title」在联系人填充中是称谓（先生/女士），NordPass 仍在字段上方打开联系人列表。可见标签「Nome do projeto」（通过 `htmlFor` 关联）和 [RN-740](#rn-740) 的 `SEM_AUTOFILL` 保留。这是「启发式」，未经测量：NordPass 没有记录忽略属性，`SEM_AUTOFILL` 也没有加入任何属性；证明靠 TP-01。
- **位置：** `apps/web/src/routes/NewProjectWizard.tsx:746`（`projeto-slug`）
- **测试：** `apps/web/src/routes/NewProjectWizard.test.tsx`（"RN-834: id e
  name do nome do projeto não parecem dado de contato…"）
- **来源：** AT-501（10月10日的 TP-01）

### RN-835 — 「概览」的「Desbloquear」不移位，并说明发生了什么 {#rn-835}

- **规则：** [RN-816](#rn-816) 和 [RN-794](#rn-794) 的扩展。在「概览」的执行一节中，被阻塞任务的列表排在「最前」，在「Religar execução」（依赖当前执行的读取）和 dev agents 网格（依赖事件）之前——这些块在首次绘制之后到达，会把按钮推到光标下。解除阻塞按「任务」给出反馈：进行中时按钮不可操作并显示「Desbloqueando…」（一次点击，一次调用），成功时显示「Tarefa desbloqueada」，直到重新读取的 backlog 移除该行，拒绝则在该行显示 api 的句子。没有读取到会话时，按钮不可操作并以文字说明原因——此前点击会静默返回。已声明：该节「上方」的内容（团队和活动树）没有预留高度，jsdom 不做布局——测试证明的是「顺序」，不是像素位移；TP-01 中第 1 次点击丢失是两个原因中的哪一个（跳动或会话未读取）没有在浏览器中测量。
- **位置：** `apps/web/src/routes/ProjectOverviewTab.tsx:485`（`desbloqueio`），
  `apps/web/src/routes/ProjectOverviewTab.tsx:611`（`blockedTasks`）
- **测试：** `apps/web/src/routes/ProjectOverviewTab.test.tsx`（"RN-835
  (AT-502): o desbloqueio chama uma vez, fica em voo e diz quando terminou"；
  失败："RN-835: a recusa do desbloqueio mostra a frase da api na linha"），
  `apps/web/src/routes/salto-de-layout.test.ts`（"RN-835 (AT-502): Visão
  geral — as tarefas bloqueadas vêm antes…"）
- **来源：** AT-502（10月10日的 TP-01）

### RN-836 — 有新内容到达而此人已向上滚动时，消息流提供「转到末尾」 {#rn-836}

- **规则：** 当此人远离消息流末尾（[RN-173](#rn-173) 的 120px 守护），且自她离开末尾后消息流增加了消息或审批卡片时，可滚动区域底部的悬浮按钮提供跳到末尾，并统计新消息（「3 mensagens novas」，i18next 复数，带 `_zero`/`_one`/`_other`）。新的审批卡片不计入数字：它「突出」按钮，并把标签换成「Há uma aprovação
  esperando」。按钮有自己的可访问标签，到达末尾时消失，对已在末尾的人从不出现——在那里 RN-173 的自动滚动仍起主导作用，按钮只是观察。
- **位置：** `apps/web/src/lib/session-rolagem.ts:206`（`estadoDoIrAoFim`），
  `apps/web/src/lib/session-rolagem.ts:227`（`useIrAoFimDoFio`），
  `apps/web/src/routes/IrAoFimDoFio.tsx:10`（`IrAoFimDoFio`）
- **测试：** `apps/web/src/routes/IrAoFimDoFio.test.tsx`（"caminho feliz: fora
  do fim e com mensagens novas, mostra o contador…"，"aprovação nova realça o
  botão"；失败："no fim, conteúdo novo não mostra botão"）
- **来源：** AT-506（聊天 UX 改进，第 1.3 项）

### RN-837 — 消息流的 Markdown：新的块类型，流的前缀不显示原始标记 {#rn-837}

- **规则：** 聊天的轻量 Markdown（自有解析器，无依赖）也识别分隔线（`---`、`***`、`___`；紧跟段落文本之后仍是文本）、引用（连续的 `>` 行，内部由同一解析器重新处理）、标题 `####`、「一」层嵌套列表（缩进 2 个以上空格的项归入前一项；更深的被拉平）以及清单（`- [ ]`/`- [x]`，复选框只是视觉的，已禁用）。在流模式下（`MarkdownMessage` 带 `emCurso`），文本先经过 `fecharMarcadoresAbertos`，它闭合未完成的围栏、反引号和 `**`，并去掉末尾孤立的标记——任何前缀都不会抛出或显示原始标记。最终文本从不经过它。仍然没有 `dangerouslySetInnerHTML`。
- **位置：** `apps/web/src/lib/markdown.ts:122`（`HR_RE`），
  `apps/web/src/lib/markdown.ts:123`（`CITACAO_RE`），
  `apps/web/src/lib/markdown.ts:124`（`TAREFA_RE`），
  `apps/web/src/lib/markdown.ts:374`（`fecharMarcadoresAbertos`），
  `apps/web/src/components/ui/MarkdownMessage.tsx:298`（`MarkdownMessage`）
- **测试：** `apps/web/src/lib/markdown.blocos-e-stream.test.ts`（"checklist
  marca cada item…"；失败："`---` logo depois de texto continua texto"），
  `apps/web/src/components/ui/MarkdownMessage.stream.test.tsx`（"nenhum
  prefixo lança nem mostra marcador cru"；失败："o texto final (sem
  emCurso) não é alterado"）
- **来源：** AT-507（聊天 UX 改进，10月10日，第 1.2-a 项）

### RN-841 — 「PRs prontas」队列不需刷新页面就会重新读取 {#rn-841}

- **规则：** [RN-825](#rn-825) 的扩展。打开的 PR 列表仍没有自己的轮询，在两个时刻重新读取：(1) 当聊天已在以 15 秒进行的 backlog 读取带来某个任务的 `status` 或 `gateStatus` 与上一次读取不同时（dev 的 PR 产生于「执行」会话，聊天不监听它的通道，而 gates 的批准会体现在那里）；以及 (2) 当本会话的通道通知 `adr.pr_opened`、`infra.pr_opened`、`action.pr_open`、`action.git_merge` 或 `action.failed` 时，通过带 2 秒窗口的失效器（[RN-579](engine.md#rn-579)，[RN-632](#rn-632)）。第一次读取和相同的读取不重新读取任何东西：新增轮询的成本为零。已声明排除在外：在另一个会话中打开、既不改变任务也不经过本通道的 infra PR，只会在由其他原因触发的下一次读取中出现。
- **位置：** `apps/web/src/lib/prontas-e-bloqueadas.ts:66`（`assinaturaDoBacklog`），
  `apps/web/src/components/PendenciasDeOutrasSessoes.tsx:91`（`assinaturaAnterior`），
  `apps/web/src/lib/canal-vivo.ts:134`（`alvosDoEvento`）
- **测试：** `apps/web/src/components/PendenciasDeOutrasSessoes.test.tsx`
  （"RN-841: a tarefa que entra em awaiting_user relê as PRs…" 和 "CASO DE FALHA
  RN-841…"），`apps/web/src/lib/acoes-da-sessao.test.ts`
- **来源：** AT-510

### RN-842 — 项目名称的标签不写「Nome」 {#rn-842}

- **规则：** 创建向导名称字段的可见标签是「Projeto」（en："Project"），而不是「Nome do projeto」/「Project name」：在 [RN-834](#rn-834) 的 `id`/`name` `projeto-slug` 下，NordPass 仍在字段上方打开「Contact info」（TP-01，第 12 次），`<label>` 的文本是剩下的信号。标签仍然可见并通过 `htmlFor` 关联，字段仍在 `<form>` 之外并带有 [RN-740](#rn-740) 的 `SEM_AUTOFILL`。这是「启发式」：搜索（NordPass 帮助中心、扩展商店、论坛）没有找到 NordPass 记录的忽略属性（没有类似 `data-np-ignore` 的东西），因此没有向 `SEM_AUTOFILL` 添加任何属性。之前已尝试过：去掉 `autoFocus`（RN-736）、`aria-autocomplete`/`data-protonpass-ignore`（RN-740）、不含联系人 token 的 `id`/`name`（RN-834）。证明靠 TP-01。
- **位置：** `apps/web/src/routes/NewProjectWizard.tsx:749`（`projeto-slug`），
  `apps/web/src/locales/pt-BR/newProject.json`（`nameLabel`）
- **测试：** `apps/web/src/routes/NewProjectWizard.test.tsx`（"RN-842: o
  rótulo visível do campo não traz \"nome\"…"）
- **来源：** AT-511（10月11日的 TP-01）

### RN-843 — 聊天中每个操作只有一张决定卡片 {#rn-843}

- **规则：** [RN-822](#rn-822) 的扩展。待处理项块在 PR 行（「PRs prontas para merge」）上绘制的「待处理」`git_merge` 是它在界面上「唯一」的 `ApprovalCard`：该块把它绘制的 id 记在客户端的一个轻量注册表中，而会话消息流在该操作待处理且已注册期间只显示一行指向队列的提示。决定之后，消息流回到卡片（历史）；没有挂载该块时（其他界面、PR 不在队列中），消息流显示完整卡片。注册只在卡片「挂载」期间有效：块折叠时（`Disclosure` 会卸载内容），消息流显示卡片。没有任何端点或上限改变。
- **位置：** `apps/web/src/lib/acoes-no-bloco.ts:48`（`useAcaoEstaNoBloco`），
  `apps/web/src/components/PendenciasDeOutrasSessoes.tsx:460`（`useRegistrarAcoesNoBloco`），
  `apps/web/src/components/CartaoOuReferenciaNoFio.tsx:11`（`CartaoOuReferenciaNoFio`），
  `apps/web/src/routes/session-timeline-montagem.tsx:1137`（`CartaoOuReferenciaNoFio`）
- **测试：** `apps/web/src/components/CartaoOuReferenciaNoFio.test.tsx`，
  `apps/web/src/components/PendenciasDeOutrasSessoes.test.tsx`（"a PR com os
  gates aprovados aparece…"）
- **来源：** AT-512

### RN-855 — 「概览」显示如何运行交付物，是声明的、未经验证的 {#rn-855}

- **规则：** 「概览」获得「Rodar na sua máquina」卡片，就在入门步骤卡片下方，内容是 Infra 在它的 PR 中声明的（`artifact.run_instructions`，RN-852）：放在带「Copiar」按钮的代码块中的命令，作为在新标签页打开的链接的 URL（`target="_blank"`、`rel="noopener noreferrer"`）——只有 `http://localhost:<porta>` 和 `http://127.0.0.1:<porta>`；其他 URL 不变成链接，即使 api 已经拒绝它——提醒 `cp .env.example .env`（当 `envExample` 时），以及说明「Declarado pela Infra na PR, não verificado na sua máquina」（RN-468：绝不是绿色，绝不是「rodando」）。没有声明（`null`）时卡片不出现，就像入门步骤卡片在无话可说时消失一样。读取是配置类的（`FRESCOR_DA_CONFIGURACAO_MS`，不轮询），会话通道的 `infra.pr_opened` 通知会重新读取它。
- **位置：** `apps/web/src/components/RodarNaSuaMaquina.tsx:32`（`RodarNaSuaMaquina`），`:20`（`urlLocalSegura`），
  `:13`（`releSeInfraAbriuPr`），
  `apps/web/src/routes/ProjectOverviewTab.tsx:202`（`releSeInfraAbriuPr`），
  `apps/web/src/lib/api-client.ts:832`（`getRunInstructions`）
- **测试：** `apps/web/src/components/RodarNaSuaMaquina.test.tsx`（"mostra
  comando, copiar, link local e a nota de não verificado"；"sem declaração
  (null) o cartão não aparece"；"só localhost/127.0.0.1 com porta vira link"；
  "infra.pr_opened relê o cartão; outro evento não"）
- **来源：** AT-517（ADR 0213）

### RN-861 — 未决问题在聊天中是独立的队列，就绪提示不阻塞 {#rn-861}

- **规则：** 聊天的待处理项块增加「Perguntas em
  aberto」队列，有「自己」的标题和计数（api 的 `total`，绝不与其他队列相加——RN-467），列表有上限时声明截取（RN-180）。每张卡片说明问题、提问的 agent、它影响什么、带「Aceitar sugestão」的建议以及带「Responder」的简短字段；因该问题被 QA gate 停放的任务（RN-860）在卡片本身显示为「esperando sua resposta」。只有来源会话的作者（`autorDaSessao`）有控件；其他人看到卡片，控件不可操作并以文字说明原因（ADR 0064）。拒绝时显示 api 的句子；成功时重新读取队列，问题移除。读取「不」轮询：通道在 `artifact.open_question`、`open_question.answered` 和 `pr.gate_changed` 时重新读取队列（目标 `perguntas`，2 秒窗口）。在「Estou pronto」和「Confirmar arquitetura pronta」旁边，composer 提示「N perguntas em
  aberto」并带有通往队列的快捷方式，读取「同一个」query——只是提示，按钮保持可用（ADR 0214）。
- **位置：** `apps/web/src/components/PerguntasEmAberto.tsx:47`
  （`PerguntasEmAberto`），`:117`（`eAutor`），`:282`
  （`AvisoDePerguntasEmAberto`），`apps/web/src/lib/canal-vivo.ts:135`
  （`alvosDoEvento`）
- **测试：** `apps/web/src/components/PerguntasEmAberto.test.tsx`（"fila
  própria com contagem própria; o autor responde e aceita a sugestão"，"o
  aviso do composer diz N e não bloqueia nada; some sem perguntas"；失败："a
  recusa 409 mostra a frase da api"，"quem não é o autor da sessão vê o
  cartão com o controle inerte e o motivo em texto"）
- **来源：** AT-521

### RN-867 — 已停放 gate 的提示说明记录的原因，未决问题指向它的卡片 {#rn-867}

- **规则：** `gate.rescue_parked` 有两个发出者：按时间的救援（`GateRescuer`，RN-722），它写入 `idadeSegundos`；以及等待未决问题回答而停放的 QA，它不写入。消息流按 `idadeSegundos` 的「存在与否」区分两者（`motivo` 是固定的 pt-BR 文本，不作为键读取）：「parado mais de 2 h」只出现在按时间的救援中；在另一种情况下，提示说明 gate 在等待回答，并指向「Perguntas em aberto」卡片（RN-861）。「Retomar gate」按钮（RN-724）在两种情况下都保留。
- **位置：** `apps/web/src/routes/RetomarGateEstacionado.tsx:18`
  （`cicloEstacionado`），`apps/web/src/routes/session-timeline-montagem.tsx`
  （`gateEstacionado.avisoPergunta`）
- **测试：** `apps/web/src/routes/RetomarGateEstacionado.test.tsx`（"o
  resgate por tempo grava idadeSegundos e lê como tempo"；失败："a pergunta
  em aberto não tem idadeSegundos e não fala em 2 h"）
- **来源：** AT-528

### RN-882 — 会话的 composer 在快速输入时不丢按键 {#rn-882}

- **规则：** composer 的字段在输入期间拥有「自己」的值：绘制的值是本地状态，在 `onChange` 中更新，页面的 `draft` 接收每个值（发送、队列和按钮仍从它读取）。作为 prop 回来的延迟 `draft`「绝不」改写字段——只采用字段没有发出过的值（发送后清空、失败时退回的文本、邀请中的示例）。此前 `<textarea>` 直接由 `draft`（属于 `SessionPage`）控制，页面延迟的重新渲染会用更旧的值改写字段：TP-01 中 1 010 个字符只剩 991 个，而同一页面上的普通 textarea 收到了 249/249。Enter、Shift+Enter 和重音组合输入（RN-830）不变。
- **位置：** `apps/web/src/components/CampoDoComposer.tsx:21`（`CampoDoComposer`）；
  `apps/web/src/routes/SessionComposer.tsx`
- **测试：** `apps/web/src/components/CampoDoComposer.test.tsx`（"digitação
  rápida com a página atrasada não perde tecla nenhuma"；失败/边界："a
  escrita de fora (esvaziar depois do envio) é adotada pelo campo"）
- **来源：** AT-533

### RN-883 — 自动模式的批量提议也出现在会话聊天中 {#rn-883}

- **规则：** 会话活动且有执行时（`sessaoTemExecucao`），聊天显示与「执行者」标签页「相同」的批量提议（RN-661）——同一个组件、同一个端点（每个 agent 一次 PUT）、同一份自动模式不放行内容的文本，不点击就不写入任何东西。agent 是整个会话中进入过的 `dev-<modulo>` 加上 gate 子 agent（`agentesDaOfertaEmLote`）；角色 `maintainer`（端点的角色）。没有执行时，什么也不出现，甚至不读取 `agent_autonomy`。所有 agent 都已处于自动模式时消失。
- **位置：** `apps/web/src/components/ModoAutomaticoNoChat.tsx:41`
  （`ModoAutomaticoNoChat`），`:18`（`agentesDoChat`）
- **测试：** `apps/web/src/components/ModoAutomaticoNoChat.test.tsx`（"caminho
  feliz: com execução, a oferta aparece e só o clique grava"；失败："sem
  execução, nada aparece e nem a leitura acontece"）
- **来源：** AT-537

### RN-884 — 已回答的问题提供「Corrigir a história」 {#rn-884}

- **规则：** 通过聊天的「Perguntas em aberto」面板（RN-861）回答的问题以已回答卡片保留，直到被关闭，backlog 中 `afeta.historias` 的每个故事，当按 RN-727 的标准仍可修正时（`draft`，没有 `in_progress`/`in_review` 任务，角色 `developer`），获得「Corrigir a história」——链接带到打开该故事的「故事」标签页（`?historia=`）。它不触发 PO（负责人的决定，10月14日）。不可修正时：链接不存在，原因以文字说明（RN-102）。标准与「故事」标签页使用的是「同一个」函数，已移到 `lib/`。
- **位置：** `apps/web/src/components/PerguntasEmAberto.tsx:222`
  （`CartaoRespondido`）；`apps/web/src/lib/correcao-de-historia.ts`
  （`motivoDeCorrecaoInerte`）；`apps/web/src/routes/ProjectBacklogTab.tsx:398`
  （`useHistoriaInicial`）
- **测试：** `apps/web/src/components/PerguntasRespondidas.test.tsx`（"caminho
  feliz: história draft sem tarefa em execução ganha o link para a aba
  Histórias"；失败："com tarefa em execução o botão não existe e o motivo é
  dito em texto"）
- **来源：** AT-538

### RN-887 — 任务的阻塞与状态正交，显示的一方读取两者 {#rn-887}

- **规则：** 被阻塞的任务仍是 `todo`/`in_progress`，带 `tasks.blocked = true`（以及 `blocked_reason`/`blocked_origin`）——枚举中没有 `blocked` 状态，依负责人的决定（10月14日）。「统计」或「显示」任务的一方读取这两个字段，`blocked` 胜过 `status`：「故事」标签页显示「Bloqueada」徽章（危险色调）并以文字说明原因，其余按状态显示（待做、进行中、审查中、已完成）；Dev Lead 读取的 backlog 任务列表把该行标记为 `| BLOQUEADA: <motivo, até 120 caracteres>`，任务仍在列表中。领取、解除阻塞和恢复不变。
- **位置：** `apps/web/src/lib/execution.ts:10`（`estadoDaTarefa`）；
  `apps/web/src/routes/ProjectBacklogTab.tsx`（任务列表的徽章）；
  `apps/engine/lib/engine/agents/dev_lead_tools.ex:410`（`bloqueio`）
- **测试：** `apps/web/src/lib/execution.test.ts`（"blocked vence o status"；
  失败："sem bloqueio, o status"）；`apps/web/src/routes/ProjectBacklogTab.test.tsx`
  （"a bloqueada mostra \"Bloqueada\" e o motivo, sem o selo \"a fazer\""）；
  `apps/engine/test/engine/agents/dev_lead_tools_test.exs`（"a tarefa
  bloqueada diz BLOQUEADA e o motivo; a todo normal não"）
- **来源：** AT-536

### RN-889 — 自动模式的批量提议出现在执行中项目的任何活动会话的聊天中 {#rn-889}

- **规则：** 扩展 RN-883。批准 Dev Lead 的计划会创建「执行」会话，与 Criativo 的会话分开，而用户是在 Criativo 的聊天中引导的。当「项目」有执行时，批量提议（RN-661）出现在每个「活动」会话的聊天中——项目摘要的 `roster.executionActivated`（最近的会话，即执行会话），与聊天已在进行的读取和 `queryKey`「相同」（`useAtivosNoProjeto`，RN-633），没有新的查询或轮询。那里的 dev agents（`roster.activatedAgents`）加到本会话的之上。同一个组件、同一个端点、同一段文本，不点击就不写入，等待知道谁已开启（RN-803），整个团队都处于自动模式时消失。项目没有执行时，什么也不出现，甚至不读取 `agent_autonomy`。声明的缺口：信号是最近会话的 `roster.executionActivated`，它说明该会话「曾有」`execution.activated`，而不是它仍然打开；执行会话已经结束时，提议仍会出现在 Criativo 的聊天中——已声明，未修正，因为区分它需要一次新的读取（请求预算）。
- **位置：** `apps/web/src/components/ModoAutomaticoNoChat.tsx:29`
  （`ofertaDoChat`）；`apps/web/src/lib/session-destinatario.ts:174`
  （`useExecucaoNoProjeto`）
- **测试：** `apps/web/src/components/ModoAutomaticoNoChat.test.tsx`（"caminho
  feliz: execução ativa noutra sessão do projeto, time em manual — a oferta
  aparece no chat do Criativo"；失败："time todo já em automático: nada
  aparece"，"sem execução no projeto: nada aparece e nem a leitura acontece"）
- **来源：** AT-540

### RN-901 — 聊天中的自动模式批量提议包含已批准计划的 dev 代理 {#rn-901}

- **规则：** 扩展 RN-889。项目摘要的 `roster.activatedAgents` 从不包含 dev 代理：dev 不记录 `agent.activated`，只记录 `dev.started`。聊天的批量提议（RN-883/889）只读取该列表，不显示正在执行的 `dev-<模块>`，用户必须在执行者标签页中手动开启。项目执行（`execucaoDoRoster`）现在仅在 `roster.executionActivated` 为真时，把 `roster.moduleNames`（当前 `module_map`）的 `dev-<模块>` 加入列表，使用与执行者标签页相同的 `devAgentId`（RN-661，`rosterFromFacts`），不做新的推导。没有活动执行时不加入任何 dev。已声明的缺口：列表来自当前 `module_map`；若已批准计划只用了部分模块，提议会沿用这一差异。没有任何上限改变，未经点击不写入任何内容。
- **位置：** `apps/web/src/lib/session-destinatario.ts:194`（`execucaoDoRoster`），由 `useExecucaoNoProjeto`（`apps/web/src/lib/session-destinatario.ts:175`）调用
- **测试：** `apps/web/src/lib/session-destinatario.test.ts`（"CAMINHO FELIZ：执行活动时把 module_map 的 dev-<模块> 加入已激活项"；失败："无活动执行时，计划的模块不成为 dev 代理"），以及 `apps/web/src/components/ModoAutomaticoNoChat.test.tsx`（由真实 roster 推导的夹具，"caminho feliz"）
- **来源：** AT-573（TP-01 第 18 轮，19/10：第一个任务因 dev 未处于自动模式而停在 `dev.awaiting_approval`）

### RN-911 — 提供商是全局的；项目设置只选择模型；矩阵位于账户中 {#rn-911}

- **规则：** LLM 凭据、模型目录（策展、价格、同步以及 Hugging Face 浏览器）和按密钥的支出报告已离开项目设置。它们位于 `/providers`（三个部分），按密钥的支出也在“支出”选项卡中，仅对 `owner` 开放（RN-060）。项目只保存选择：按 agent 和按区域的模型、“应用到全部”（RN-476）、路由标准和“最佳模型”。“谁可以批准什么”矩阵已离开设置，成为账户（`/account`）中的一个部分，对任何已登录的人可见。“启用并应用到 N 个 agent”快捷方式（RN-694 第 3 项）已不存在。旧链接 `?section=credentials`、`model-catalog`、`key-spend` 或 `approval-matrix` 会在顶部打开该选项卡，不报错。“按 agent 的模型”的空状态、“最佳模型”的副标题以及“入门步骤”（RN-708）都指向 `/providers`。修订 RN-694（第 3 项）和 RN-708（目的地）。无 ADR：这是屏幕边界。
- **位置：** `apps/web/src/routes/settings/sumario.ts:48`（`SECOES_DE_CONFIGURACOES`）、`apps/web/src/routes/ProjectSettingsTab.tsx:62`（`ProjectSettingsTab`）、`apps/web/src/routes/AccountPage.tsx:36`（`AccountPage`）
- **测试：** `apps/web/src/routes/settings/sumario.test.ts`（四个键不存在）；`apps/web/src/routes/settings/SumarioDeConfiguracoes.test.tsx`（该选项卡不挂载四个部分，即使对 `owner` 也是如此）；`apps/web/src/routes/AccountPage.test.tsx`（矩阵，以及语言中的失败情况）；`apps/web/src/routes/configuracoes.orcamento.test.tsx`（返回该选项卡时不获取凭据）；`apps/web/src/components/catalogo-com-busca.test.tsx`（无快捷方式）
- **来源：** AT-597 和 AT-598（EP-031），所有者于 22/10 的请求。

### RN-912 — 区域模型是 lead 行上的一个框，位于“按 agent 的模型”中 {#rn-912}

- **规则：** “按区域的模型”部分已不存在。区域的默认值（RN-102，RN-470 的 `area` 作用域）通过每个区域（`dev-lead`、`qa`、`infra`）**仅位于 lead 行**上的一个框来关联：“应用到整个 X 区域（lead + 子 agent）”。区域绑定是每个区域一个值，且不保存来源 agent，因此在每一行都放一个框会让两个框争夺同一个值。勾选 ⇔ lead 的生效值来自区域（`origin: 'area'`），从 RN-654 的批量数据中读取，无需新的查询。**勾选**会以 lead 的生效值和 lead 的路由标准写入区域（`PUT .../area-bindings/:area`），然后才删除 lead 自己的绑定（`DELETE .../agent-bindings/:lead`；复制它会把它留下，RN-102）。这是两次调用，结果按步骤报告（RN-469）：如果区域拒绝（包括 RN-040 的 422），什么都不会改变，提示会带上 API 的文字；如果区域已写入而 DELETE 失败，屏幕会说明区域的默认值已写入，但 lead 自己的模型未被移除（DELETE 的 404 视为已移除）。**取消勾选**会删除区域（`DELETE .../area-bindings/:area`），且不向 lead 写入任何内容；404 变为“已经在继承”。框被勾选时，lead 的选择器和路由标准写入的是区域。拥有自己绑定的 agent 会覆盖区域（RN-470），并且**不**跟随：屏幕以复数形式列出在这种情况下已知的子 agent（声明的范围，RN-180；动态的 `dev-<modulo>` 不包括在内，屏幕会说明这一点），且不删除它们的决定。“应用到全部”（RN-476）会为 17 个 agent 写入各自的绑定，因此会让子 agent 脱离区域默认值；其提示会说明这一点。**角色：** 框以及在勾选期间的 lead 选择器需要 `maintainer`（区域端点的最低要求，RN-102），通过 `roleAtLeast` 比较；低于此角色时它们保持不可用，原因在该部分的图例中以文字说明**一次**（ADR 0064）。其他行仍为 `developer`。若 lead 没有可复制的生效值，该框出生时即为禁用状态，并在框旁以文字说明原因（AT-601，键 `modelsSection.areaBox.needsModel`）。修订 RN-040、RN-102 和 RN-470 的 UI；级联、作用域和端点不变（无 ADR）。
- **位置：** `apps/web/src/routes/settings/ModelsSection.tsx:94`（`podeEditarArea`）、`:428`（`areaDoLead`）、`:446`（`handleMarcarArea`）、`:486`（`handleDesmarcarArea`）
- **测试：** `apps/web/src/routes/settings/ModelsSection.caixa-da-area.test.tsx`（AT-601：lead 没有生效值时的原因）；`apps/web/src/routes/ProjectSettingsTab.test.tsx`（勾选、区域拒绝、部分失败、带或不带 404 的取消勾选、lead 在区域上的选择器、非跟随者、`developer` 不可用）；`apps/web/src/routes/settings/papel-na-tabela-de-agentes.test.tsx`（两个最低角色）；`bindings-em-lote.test.tsx`（单一批量）；`cascata.test.tsx`；`heranca.test.tsx`；`filtro-de-aptos.test.tsx`（RN-040）；`preferencia-de-roteamento.test.tsx`（ADR 0166）
- **来源：** AT-600（EP-031），所有者于 22/10 的请求。

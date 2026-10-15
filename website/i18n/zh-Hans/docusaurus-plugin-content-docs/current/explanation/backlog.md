---
sidebar_position: 8
traducao_de: 929963d24eb727bd64875486f2f1889172f3084a
---

# 已分类的 backlog {#triaged-backlog}

**FASE 13c** 的产出。汇集了真实执行中仍未关闭的发现
（[achados-execucao-real.md](achados-execucao-real.md)）以及原本散落在各 ADR 和 CLAUDE.md
中的旧条目。

> 这是**提议**。下面的分类和分组是关于什么等待代价更高的论证；优先级的决定权在用户。

> [!warning] 历史——**不要**把它当作活的队列来读
> 这是 FASE 13c 的分类，它没有跟上仓库的变化。在 **2026-09-12** 测得：这里仍显示为未关闭
> 的条目中，至少有**十二**个**已不再复现**——执行器的隔离（`terminal_executor.ex` 拒绝
> 缺失的容器）、按聚合划分的 schema（ADR 0121）、语义 gate 的 golden-set（ADR 0123）、
> `git_local_repos` 的备份、安装用 compose、"FASE 29 只是规划"、Dependabot、runbook 的
> 两个缺口以及告警的严重级别，等等。
>
> 缺陷在于**节奏，而不是内容**：各阶段关闭了，却没有人回到这里标记它们。保留下来的——也是
> 保留这个文件的原因——是分类的**推理**：为什么每个条目等待比去做代价更高。把下面的每个
> 状态都视为**在重新测量之前未经验证**。

## 如何分类 {#how-its-classified}

**P1**——阻止产品做它承诺的事。**P2**——产品能做，但对观察者撒谎或造成困惑。**P3**——
质量问题，没有人被卡住。

**成本**：P（一个会话）、M（一个小阶段）、G（独立阶段，带 ADR）。

**等待风险**是决定平局的一列：会损坏数据或抹去证据的缺陷，晚做比今天做代价更高；外观上的
缺陷代价相同。

## 看板 {#the-board}

| 提议的阶段 | 条目 | 优先级 | 成本 | 等待风险 |
|---|---|---|---|---|
| ~~A — 解锁 task~~ | ~~ADR 0052, O/B~~ | **已完成** | — | RN-072 和 RN-073 |
| ~~B — 远程 provider 上的 engine~~ | ~~N~~ | **已完成** | — | RN-076；ADR 0056 已接受 |
| ~~F — 执行器的边界和上限~~ | ~~S, U~~ | **已完成** | — | RN-074 和 RN-075；ADR 0055 已接受 |
| ~~C — UI 不能对智能体撒谎~~ | ~~C, I, H, L, G~~ | **已完成** | — | 五个条目 |
| ~~D — 向导说真话并且有出路~~ | ~~D, E, F~~ | **已完成** | — | RN-078；E 和 F 之前已完成 |
| ~~G — 失败结果说真话~~ | ~~P, Q, T~~ | **已完成** | — | RN-077 |
| ~~H — 会话状态不撒谎~~ | ~~V~~ | **已完成** | — | RN-064 已扩展 |
| ~~E — 智能体产出的质量~~ | ~~K, R, J~~ | **已完成** | — | RN-079、RN-080 和 RN-081 |
| ~~— 零散~~ | ~~没有 spec 的 promotion-check~~ | **已完成** | — | 10 个用例，经变异验证 |
| ~~I — dev agent 从零开始~~ | ~~X, Y~~ | **已完成** | — | RN-085；Y 在 13b 关闭，X 在 FASE 14d 关闭 |

**覆盖：真实执行的 19 个发现中的 19 个**，另有来自 FASE 13b 验证的**八个新发现**
（W, X, Y, Z, AA, AB, AC, AD, AE）——见 [validacao-real.md](validacao-real.md)。

其中**五个已关闭**：W、Y、AA、AB 和 AC 在 13b 本身中关闭，X 由 FASE 14d 关闭
（[RN-085](../business-rules/custo.md#rn-085)）——迭代上限改为按智能体**类型**设定，这正是
分类提议的形式，也是缺失的产品决定。

**三个仍未关闭**，没有一个是需要修复的 bug：

| 发现 | 是什么 | 为什么不是修复 |
|---|---|---|
| **Z** 和 **AD** | 动词允许列表不收敛——动词、形式和调用是不同的空间 | 允许列表兑现了它的承诺，而对 `bash` 的拒绝证明边界守住了。这是关于按智能体画像制定策略的**产品**决定，需要 ADR |
| **AE** | QA 智能体试图修复它所评判的代码 | 没有任何东西泄漏：被两道独立的屏障拦住。数据是提示词要求的与模型所做的之间的分歧 |

13b 的实际结论已经实现，不再等待任何东西：出路不是放松策略，而是让智能体**等待**决定而不是
死掉（[ADR 0057](../adr/0057-o-gate-espera-a-aprovacao.md)，扩展了 0052）。

阶段字母（A–H）和发现字母（B–V）因继承自两个列表而冲突；有歧义的地方，文本会写"发现"。

自第一次分类以来，有两个条目离开了未关闭列表：**A**（[RN-067](../business-rules/custo.md#rn-067)）
和 **M**（[RN-066](../business-rules/custo.md#rn-066)），两者都已关闭并在生产中确认。而作为
阶段 A 一半的 **ADR 0052** 已实现并由测试证明——wake 的投递在那之后被修正并端到端覆盖。

其余（旧条目）在[之前的 backlog](#older-backlog) 中，没有分配优先级：它们是产品决定，不是
缺陷。

---

## 阶段 A — 解锁 task（P1）— **已完成** {#phase-a--unblock-the-task-p1--done}

**从来没有任何 dev agent 完成过一个 task。** 这是决定一切顺序的事实：FASE 15a 的 gate
登记显示 `qa-verificada`、`secops-segura` 和两个 infra gate 为 *"nunca passou"*——不是因为
缺少执行，而是因为从来不存在可供任何 gate 评判的 PR。

| 条目 | 曾经是什么 | 如何关闭 |
|---|---|---|
| **ADR 0052** | 待处理的审批把 `status pending` 作为工具结果返回并烧掉一次迭代；智能体在上限处死掉而什么也没写 | 循环**挂起**并恢复（[RN-073](../business-rules/custo.md#rn-073)）；结果的投递在之后被修正——事件诞生在一个 engine 排空器不读取的聚合中——这条路径现在已端到端覆盖 |
| **O / B** | 会话和 dev agents 诞生在本地的 `llama3.2:1b` 上，而 ADR 0020 在语义步骤中禁止它 | 当级联落到 workspace 默认值时，继承的模型是 **Criativo** 的（[RN-072](../business-rules/custo.md#rn-072)） |

继承填补**空位**而从不覆盖：会话、智能体或项目的 binding 是显式选择，仍然胜出。而继承的
模型经过与级联相同的过滤——从目录中消失或不支持 tool calling 的不会被继承。

关闭这个阶段**并不**足够，这是它最有用的发现：智能体开始运转了，又死于别的东西（阶段 F，
`413`）。*"从来没有任何 dev agent 完成过一个 task"* 依然成立——改变的是原因。

**等待风险：高。** 在它关闭之前，远程 PR、QA/SecOps 的 gates 以及 13b 的测量都被堵在后面——
而每一轮 dogfooding 都在花钱，只为再次确认同一个阻塞。

## 阶段 B — 远程 provider 上的 engine（P1）— **已完成** {#phase-b--engine-on-a-remote-provider-p1--done}

**N**——`get_local_repo_path/1` 对一切不是 `local` 的东西返回 `unsupported_provider`，四个
消费者随之停止。**api** 通过 HTTP 与 GitHub 对话；**engine** 在文件系统上工作，只认识本地
bare repo，因此远程项目会运行会话那一半，而在构建那一半停下。

由 [ADR 0056](../adr/0056-o-engine-trabalha-em-repositorio-remoto.md) 和
[RN-076](../business-rules/custo.md#rn-076) 关闭：engine 向 api 请求工作用的远程，api 持有
主密钥，凭据**按调用**传入——写入 `.git/config` 的 origin 是干净的。

**缩小问题的发现：** 四个消费者中有两个从来不需要凭据。`Diff` 和 `ProjectContext` 只使用
分支的**名称**——它们是因一个返回了比所需更多东西的函数而附带受损停止的。

### 阶段 B **没有**关闭的 {#what-phase-b-did-not-close}

- **隔离**，又一次。token 离开了磁盘，但智能体仍与 Brabo 的 monorepo 在同一个容器中。这是
  ADR 0055 已经声明的同一个待办，现在有两个阶段指向它。
- **针对真实 GitHub 的证明。** `fetch` 和 `push` 经过 `GitAuth`，测试端到端覆盖了本地路径
  （推送到达另一端的 bare）和命名的错误。没有任何测试能给出带真实 token 的真实远程仓库——
  那是 13b 的执行，它现在有条件发生了。

## 阶段 F — 执行器的边界和上限（P1）— **已完成** {#phase-f--executor-boundary-and-cap-p1--done}

`hello-limpo` 的执行死在这里，两个条目有同一个根源：终端执行器没有限制——既没有限制命令能
**到达哪里**，也没有限制它**返回多少**。

| 条目 | 曾经是什么 | 如何关闭 |
|---|---|---|
| **S** | 累积的上下文超出 provider 的字节限制，调用返回 `413`。每次终端输出都留在历史中，并随之后的每个轮次传递 | 执行器中的字节上限，带有写给模型的标记（[RN-074](../business-rules/custo.md#rn-074)） |
| **U** | 执行器内的 `/workspace` 是 **Brabo 自己**的 monorepo，而 `/data/project-workspaces/*/` 能访问其他项目的 worktree | 决策中的路径范围（[RN-075](../business-rules/custo.md#rn-075)，[ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) 已接受） |

范围一次性关闭了两个方向：**收紧**（指向外部的放行动词不再自动批准）和**放宽**（向内的 `cd`
不再让复合命令被拒，这是阶梯中代价最高的缺陷）。

### 阶段 F **没有**关闭的 {#what-phase-f-did-not-close}

记录在案，而不是当作已完成：

- **隔离。** ADR 0055 是策略，它自己也这么说。只要 Brabo 的 monorepo 挂载在执行命令的容器
  中，边界就取决于规则是否判断正确。规范化是词法上的：`..` 被拒绝，而从内部指向外部的
  符号链接不会被检测到。
- **ADR 第 6 点——"总是允许"的泛化。** 它仍然记录字面命令，而那永远不会再匹配。没有纳入，
  因为泛化会**扩大**一次点击授权的范围（批准 `cat foo` 将放行对任何东西的 `cat`），这是
  一个值得单独审视的产品决定，而不是顺带做。
- **ADR 第 7 点——事件记录是哪个范围授权的。** 决策的原因已经说明了，但没有持久化到
  `proposed_action.created` 中。

## 阶段 C — UI 不能对智能体撒谎（P2）— **已完成** {#phase-c--the-ui-cant-lie-about-agents-p2--done}

五个条目有同一个根源：界面讲的故事与 event log 不同。

| 条目 | 界面做了什么 | 状态 |
|---|---|---|
| **C** | 实时气泡带着**模型**的标签；智能体只在持久化事件到达时才出现——而消息在重新加载之前是重复的 | **已完成**——增量开始携带智能体，在轮次流式传输期间推迟重新获取 |
| **G** | 在已创建的项目中不出现 Criativo 的邀请，因为对话流中已经有 bootstrap 的卡片 | **已完成**——条件改为"对话已开始"，而不是"对话流为空" |
| **L** | 在离开 Criativo 的 handoff 之后，底部按钮仍是 "Estou pronto para produzir" | **已完成**——存在离开 Criativo 的 handoff 时消失 |
| **H** | bootstrap 的事件全部显示为 "atividade em system" | **已完成**——五种类型有了自己的族，步骤已翻译 |
| **I** | 更换会话的模型会追溯地改写旧动作的标签 | **已完成**——卡片不再断言一个它无从得知的模型 |

**C** 是五个中最严重的，是你在执行过程中指出的：说话的是智能体，模型是执行细节。

**I 值得一个决定，而不只是修复。** 卡片接收的是会话的**当前**模型，而不存在按动作的模型的
真实来源——`proposed_actions` 不保存它，`token_usage` 也不关联到动作。在编造一个和停止断言
之间，后者是唯一诚实的：提议者已经以粗体在卡片上，那是**智能体**，是不变的东西。标签随
prop 一起移除了，该 prop 没有其他任何消费者。

**H 变成了措辞问题**：五种 `bootstrap.step_*` 类型有了自己的族，步骤翻译成葡萄牙语，只有
`step_failed` 被标为坏——`degraded` 和 `skipped` 是预期的结果，把它们涂成红色会教人忽略
红色。`create_rc_branch` 即使已退役（ADR 0030）也仍然被翻译，因为之前 bootstrap 的项目在
日志中有这个事件。

## 阶段 D — 向导说真话并且有出路（P2）— **已完成** {#phase-d--the-wizard-tells-the-truth-and-has-an-exit-p2--done}

| 条目 | 曾经是什么 | 如何关闭 |
|---|---|---|
| **D** | `Protect branches` 在免费计划的私有仓库上失败，而向导**事先就提醒了这一点**。之后提供的唯一操作是"重试"，它总是失败 | [RN-078](../business-rules/custo.md#rn-078) |
| **E** | 仓库预览在撒谎：硬编码的 `repo: brabo/{slug}`，而真正的 owner 来自 PAT | 之前已完成（提交 `4dd7a073`）——标签只显示 slug，即实际知道的东西 |
| **F** | "Política de branches" 步骤把 `rc` 列为永久分支之一 | 之前已完成（提交 `4dd7a073`） |

**E 和 F 在我去处理它们时已经被修正**，在一个一次关闭四个发现的提交中。发现这一点花了一次
阅读；backlog 不知道，因为它是之前写的。

**条目 D 比描述所暗示的更大。** 它不只是"没有出路的界面"：`provision_failed` 让仪表板**把
对项目的点击重定向回配置页面**，于是项目永远不可达，卡在一个不可能成功的步骤里。出路需要
路由、用例和事件——而不只是一个按钮。

**只有保护步骤可以被确认**，这是关键的决定：它是最后一步，也是唯一一个失败后仍留下可用
仓库的步骤。在更早的失败上提供"继续"，会是叠加在第一个谎言之上的第二个谎言。

## 阶段 G — 失败结果说真话（P2）— **已完成** {#phase-g--the-failure-outcome-tells-the-truth-p2--done}

CLAUDE.md 的同一条规则被违反了三次：**P**（`dev.blocked` 带 `origin: null`）、**Q**
（`agent.error` 带 `"undetermined"`）和 **T**（复发：`dev.blocked` 带 `"undetermined"`，而
失败的 `diagnosis` 字段在**同一**行中就说出了原因）。

由 [RN-077](../business-rules/custo.md#rn-077) 关闭，对原因的诊断改变了修复的形式：**分类器
早已存在并且本可以判对**——`FalhaDeTurno.origem/1` 把 ≥ 400 的状态映射为 `codigo`，这正确
地分类了发现 T 的 `413`。缺陷从来不是缺少规则；而是 `block_task` 以 `"undetermined"` 作为
**默认值**，而调用点什么都不传。

所以修复是结构性的，而不是又一条规则：**默认值被删除了**。忘记来源现在是编译错误，而不是
一个语法上有效、语义上空洞的事件。

`indeterminada` 不再存在。它的意思是*分类器没有识别这种形式*——我们代码的缺口——而 `codigo`
是指向正确行动的来源。`indeterminada` 不指向任何行动，这正是该发现的抱怨。

## 阶段 H — 会话状态不撒谎（P2）— **已完成** {#phase-h--session-state-doesnt-lie-p2--done}

**V**——会话 `1f94de49` 自 23:34:42 起显示为 `closed`，而执行一直持续到 00:56。

原因不在状态机：而在**心跳**。会话在 23:34:12 诞生，在 23:34:42 关闭——正好是
`SESSION_HEARTBEAT_TIMEOUT_MS` 的 30 秒。[RN-064](../business-rules/custo.md#rn-064) 已经要求
在结束前检查是否有待处理的工作，但"待处理的工作"只是 **`offered` 状态的 handoff**——而自
23:34:13 起就有一个 `pending` 的动作，在会话诞生一秒后创建。

等待决定的动作开始被计入。这是低一层的同一个 handoff 缺陷：有人在等**你**，而一个智能体可能
正挂起等待结果（[RN-073](../business-rules/custo.md#rn-073)）。

**规则的前一个版本白纸黑字地写着，纳入智能体的工作"在没有证明这种交互的测试之前就是猜测"。**
执行产生了证明，这就是这次修复与一次猜测的区别。

### 阶段 H **没有**关闭的 {#what-phase-h-did-not-close}

- **没有待处理动作也没有 handoff 的 `in_progress` task。** 这个信号需要 api 读取
  `dev_agent_states`，而它属于 engine——这是边界决定，不是顺带修复。
- **`closed` 仍然接受审批。** 心跳修正后，会话不再在有悬挂动作时关闭，因此这种情况变得罕见。
  在已关闭的会话上阻止决定是一个有其自身后果的行为改变：一个已结束会话中的孤立动作将无人
  可以决定。

## 阶段 E — 智能体产出的质量（P3） {#phase-e--quality-of-what-agents-produce-p3}

| 条目 | 发生了什么 |
|---|---|
| **K** | 在同一个项目中运行两次 Criativo 留下了 10 条规则，5 条孤立——没有去重也没有提醒 |
| **R** | PO 生成了两个覆盖同一端点的用户故事 |
| **J** | Psicólogo 在刚打开的会话中带着前一个会话的假设和空日志运行，试图引用不存在的事件然后放弃 |

**已完成**，中间有一个声明的削减。

**与本节的假设相反，J 是机制问题。** 空日志是可验证的条件，缺陷在于决定是否值得运行的计数：
它把 bootstrap 的机器步骤以及——更糟——Psicólogo 自己在分析会话时留在会话中的痕迹都加了
进去，这使得一个空会话从第一次分析开始就显得有内容，并且每次重试都更"有内容"。由
[RN-079](../business-rules/custo.md#rn-079) 关闭，发现中的会话被复现为测试。

**K 和 R 是同一个提示词问题，因此只关闭到代码能触及的程度。** 规则的**完全**重复在发出时
被拒绝（[RN-080](../business-rules/custo.md#rn-080)）；标题相同的用户故事被拒绝，不增加覆盖
的用户故事变成提醒（[RN-081](../business-rules/custo.md#rn-081)）——是提醒而不是阻止，因为
同一规则的第二种切分可能是合理的，判断者是用户。

**没有**解决的，并写在三条 RN 中而不是不言而喻：语义重复。发现 R 中确切的那一对——
"Endpoint público de saudação determinística" 和 "Endpoint público GET /hello que responde
saudação imediata"——仍然通过，因为没有任何机械的东西把两者联系起来。有一个测试断言这一
限制，使它成为可见的决定，而不是被遗忘的缺口。

## 零散 {#standalone}

~~**没有自己 spec 的 `promotion-check`**~~——**已完成**。它是该家族中唯一没有测试的必需检查
（`pr-police`、`approval-ladder` 和 `gate` 都有）。在编写 gate 登记时发现（FASE 15a，
PR #145）。

`scripts/ci/promotion-check.spec.ts` 覆盖两个纯函数，断言的是**规则**而不是实现：每个目标
要求哪个印章（`qa` 要求 `dev`，`main` 要求 `qa`，`dev` 不要求任何东西），以及什么算作**那个**
特定提交的印章——另一个提交的 tag 不算，另一个阶段的 tag 不算，没有解析到 sha 的 tag 也不会
因遗漏而成为印章。正是这一组规则阻止 `qa` 接收从未经过 `dev` 的代码。

~~**生产 compose 的四个兄弟密钥**~~——**已完成**（[RN-114](../business-rules/custo.md#rn-114)）。
`AUTH_JWT_SECRET`、`BRABO_SERVICE_TOKEN`、`CREDENTIALS_MASTER_KEY` 和 `SECRET_KEY_BASE` 在
`docker/docker-compose.prod.yml` 中有开发用默认值，而它以 `NODE_ENV=production` 运行——与
[ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md) 已为 `GIT_OAUTH_STATE_SECRET`
关闭的模式相同，原因也相同：这个值是公开的，就在这个仓库里。

下面记录的担忧——每个都值得单独决定——并不指向四个不同的**决定**，只指向在不同位置的三处检查：
`passphraseAtual()`（`auth-key-material.ts`）、`tokenDeServicoAtual()`（`service-token.ts`）
以及 `EnvelopeEncryptionService` 的构造函数，每一处都使用与 `resolveOauthStateSecret()`
**相同**的规则（缺失/示例/过短会在生产中让启动失败）。`CREDENTIALS_MASTER_KEY` 拒绝**启动**并
不是所担心的问题——它不触及任何轮换，轮换仍通过 `CREDENTIALS_MASTER_KEY_PREVIOUS` +
`rewrap-deks.ts` 存在；检查只阻止示例密钥进入生产。`SECRET_KEY_BASE` 在 `runtime.exs` 中已经有
正确的 `raise`——真正的缺陷是 compose 用一个公开的回退值掩盖了它，修正只是删除这个回退值，
没有触碰任何 Elixir 代码。

~~**2026-08-28 外部审查，第 13 项——dev 容器以 root 运行**~~——**已完成**。
`docker/api/Dockerfile`、`docker/web/Dockerfile` 和 `docker/engine/Dockerfile` 没有 `USER`
指令，因此它们写入 bind mount 的一切（`node_modules`、`apps/api/dist`，以及智能体在
`mounted` 执行模式的项目中生成的东西）在宿主上都归 root 所有——本文档的 README 和入门指南
记录了一个手动的 `sudo chown -R $USER ...` 变通办法，而不是修正这一类问题。
`Dockerfile.prod` 镜像早已是非 root 的；这只涉及 dev。

修正把容器用户映射到**宿主**的 UID/GID，而不是以 root 运行再事后清理：构建参数
`DEV_UID`/`DEV_GID`（通过 `docker-compose.yml` 从 `.env`/环境读取，默认 `1000`/`1000`），
故意命名为 `DEV_*`，因为 `${UID}` 在 bash 中是只读的且默认不导出到环境——直接从 compose
文件读取它总会看到空值。每个 Dockerfile 只在该 UID/GID 不与基础镜像已带的冲突时才创建组/用户
（`node:24-alpine` 已有 1000:1000 的 `node`），并用 `USER <uid>:<gid>` 切换——数字形式，
因此哪个用户名最终拥有这个 id 并不重要。所有需要 root 的步骤（`apk add`、`pip install`、
gitleaks/hadolint/actionlint 的下载）都在切换**之前**；在 engine 镜像中，
`_build`/`deps`/`.mix`/`.hex`——位于 `/root` 下，因为 `mix local.hex`/`mix local.rebar`
写到那里，由 `docker-compose.yml` 作为命名卷挂载——在 `USER` 之前被 `mkdir`+`chown` 到目标
UID/GID，因此全新的命名卷在第一次挂载时继承正确的所有者（Docker 会用镜像中该路径已有的内容
填充新卷）。

通过运行真实的栈证明（`DEV_UID=$(id -u) DEV_GID=$(id -g)
docker compose -f docker/docker-compose.yml up --build postgres api web
engine`）：三个容器启动时零 `EACCES`/权限错误，宿主上的 `apps/api/dist` 归宿主用户所有，
而不是 root。一个真实的细节，而不是阻塞：在此修正之前的环境创建的命名卷（`*_node_modules`、
`engine_build`、`engine_deps`、`engine_mix`、`engine_hex`）仍保存着旧的 root 容器写入的内容——
升级需要对这些现有卷数据做一次 `chown`（或者用 `docker compose down -v` 删除卷，让下一次 `up`
重建它们），这与 `DEV_UID`/`DEV_GID` 的说明一起记录在 README 和入门指南中。

---

## 之前的 backlog {#older-backlog}

在本轮之前就已存在的条目。它们不是缺陷，而是被推迟的产品决定——因此这里没有优先级。

| 条目 | 在哪里决定 |
|---|---|
| ~~按领域的预算~~ | **已修正并关闭。** `agent_areas` 增加了 `budget_micros`/`spent_micros`——与项目/会话并列的**第三个**独立上限，叠加式（不是 ADR 0064 的级联），在同一行中镜像 `max_parallel` 的模式（[RN-443](../business-rules.md#rn-443)、[ADR 0110](../adr/0110-budget-por-area-aditivo-nao-cascata.md)） |
| Dev Lead 和通过 `module_map` 的领域 | **已离开 backlog**：ADR 0053，由 FASE 14d 实现 |
| ~~向任选智能体的手动 handoff~~ | **已关闭**——[ADR 0109](../adr/0109-handoff-manual-a-agente-a-escolha.md)/[RN-440](../business-rules.md#rn-440)/[RN-441](../business-rules.md#rn-441)。`SessionPage.tsx` 增加了一个基于 `addressableAgents()`（leads ∪ 独立智能体）的选择器，它对 `POST .../sessions/:sessionId/handoffs` 发起 POST——与智能体自己的 `offer_handoff` 使用的**同一个** `CreateHandoffUseCase`，用 `actor: {kind:'user'}` 记录是谁决定的。Staff（ADR 0088）和 `ux-designer`（ADR 0087）都被发现只能通过内部路由访问，在同一次改动中加入了 `AGENTES_DE_CHAT` |
| MFA、社交登录、OIDC、联邦 | [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)——社交登录（GitHub/GitLab）已**移出**禁令并已实现（ADR 0084）；其余仍不在范围内 |
| 部署（`DEPLOY_ENABLED` + Environments） | gate `operavel` 已声明为 `planned` |
| `rc`/`rcfix` 的回归 | [ADR 0030](../adr/0030-politica-de-branches-mecanizada.md) |
| ~~approval-ladder 的 community 模式~~ | **已修正并关闭。** "变成 gate 登记中 `aprovacao_humana` 的改动"这一说法不准确——它来自 ADR 0054 的一句推测，而不是真正缺失的东西。`community` 模式自 FASE 6 起已实现并测试（`scripts/ci/approval-ladder.ts`），只是被 `APPROVAL_MODE=solo`（默认）关闭；gate `aprovacoes-da-escada` 的 `aprovacao_humana` 在两种模式下都已是 `true`，schema 中不感知 `APPROVAL_MODE`。真正缺失的是 `branching-policy.md` 中的 `TODO(humano)`——谁进入每个审批人列表的标准——由 `GOVERNANCE.md`（仓库根目录）关闭。真正启用该模式仍是运营决定（为三个角色招募真人），不是工程待办 |
| ~~带手动汇率的货币偏好~~ | **不会做**——决定已记录。转换需要一个手工维护的汇率，而它会过时；一个错误的数字比一个诚实的 USD 数字更糟（与 `formatarCustoMicros`、`ProjectSettingsTab.tsx` 中已采用的原则相同） |
| 重新启用 Anamnese（`ANAMNESE_ENABLED=true`） | 2026-08-10 由用户决定暂停——"hoje ele não está trazendo dados de muito valor"（[RN-115](../business-rules/autenticacao.md#rn-115)）。没有删除任何数据（假设、熟练度画像和指令补丁仍完整可见）；暂停的只是新一轮的**路径**，等待未来对 Anamnese 所推导内容的改进后再重新开启 |
| 重新启用 Psicólogo（`PSYCHOLOGIST_ENABLED=true`） | 2026-08-10 由用户决定暂停，原因和模式与上面的 Anamnese 相同（[RN-117](../business-rules/autenticacao.md#rn-117)）。没有删除任何数据（已发出的分析和假设仍完整可见）；暂停的只是新一轮的**路径**（自动和按需） |
| 一行安装，以及签名我们发布的东西 | 由 **FASE 29** 承接（[fase-29-instalacao-de-uma-linha.md](fase-29-instalacao-de-uma-linha.md)），目前只是规划——这里没有任何东西关闭。FASE 28 书面拒绝了在工件仍未签名时提供一行安装器（**BRB-005**），因此该阶段先签名后安装。规划测量了本文件没有记录的三件事：`docker-compose.prod.yml` 中没有任何对 `ghcr.io` 的引用并自称是验证用 compose，因此需要一个新的安装用 compose；`make test-restore` 是 Kubernetes 路径，`backup.sh` 只覆盖 Postgres，因此迁移一个 compose 安装没有经过证明的路线；以及 **`git_local_repos`——`local` provider 项目的 bare repos——不在任何备份中**，这在任何环境中丢失卷就会丢失代码。BRB id 现在在 [BRB 登记](../reference/brb.md) 中有规范的家，在那里该阶段继承的六个条目中有三个被发现已经修正——只能通过测量发现，这正是登记存在的理由 |
| 代码标签页中的问题/lint/测试面板 | FASE 26 中声明的待办（`CLAUDE.md`），与 blame、PR 列表和分支详情一起——那三个在 FASE 26b 关闭，这一个没有且从未重新启动。目前还没有数据来源（产品中没有任何 lint/test-runner 集成）；记录在此，以免悄无声息地脱离跟踪 |

## runner/execution_mode 的 backlog（ADR 0104） {#backlog-of-the-runnerexecution_mode-adr-0104}

本文档中记录的第一个"两个 ADR 彼此分歧"类型的发现——下面的表格先例（`fluxo.yml`×代码的审计，
已关闭）一直是声明性文档 × 代码，从来不是 ADR × ADR。表格的形式被复用；发现的类型是新的。

**分歧，由 [ADR 0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
关闭——调和已**接受**，第 1 波（RN-421/422/423）已完成：**

| # | 严重性 | 条目 | 证据（arquivo:linha） |
|---|---|---|---|
| 1 | **已关闭**（RN-423） | RN-170 在创建时要求 bind-mount；RN-420 在同一标志 `workspace_mode == 'local'` 下路由到 runner，完全没有 bind-mount | `apps/api/src/application/use-cases/iam/confirm-project-workspace.use-case.ts`（runner 确认并成为事实来源）；`apps/engine/lib/engine/actions/terminal_executor.ex`（`decisao_de_execucao/1`，四种结果——在没有已验证的 workspace/已连接的 runner 时显式拒绝，绝不回落到容器） |
| 2 | **已关闭**（RN-422） | 向导只教 bind-mount，从不教 runner 的命令，尽管它已经存在 | `apps/web/src/routes/NewProjectWizard.tsx`——`MODOS_DE_WORKSPACE` 中的第三项（`runner`），命令 `brabo-runner --project <id> --dir <pasta>` 直接在"代码放在哪里"步骤中，而不只在终端中 |
| 3 | **已关闭**（RN-421） | 一个 2 值的枚举（`workspace_mode`）无法表达 3 种物理上不同的执行模式 | `apps/api/src/db/migrations/0048_quiet_iron_fist.sql`（`project_execution_mode`，三个值）；`apps/api/src/domain/iam/project.entity.ts`（`PROJECT_EXECUTION_MODES`） |

**在第 1 波实现期间记录的更正，单独关闭**（它本身不是本文档中 runner 编号的波次之一——见下）：
ADR 0104 的第 4 项断言，在三种模式之间转换一个**已有**项目"passa a ser permitido sem recriar
o projeto"。第 1 波发现这是不正确的——`UpdateProjectDto` 仍故意排除
`executionMode`/`workspacePath`，实际交付的只有**创建**时的三值字段。
**[ADR 0111](../adr/0111-conversao-de-execution-mode-de-projeto-existente.md) 让这句话重新成为
真的**，通过一条专门的路由（`PUT
.../execution-mode`、`ConvertProjectExecutionModeUseCase`、RN-447..450）——而不是编辑 ADR 0104
已接受的文本，它保持原样，当时是错的，在这里被更正：

| 条目 | 成本 | 激活标准 | 在哪里决定 |
|---|---|---|---|
| ~~转换一个**已有**项目的 `execution_mode`，无需重建~~ | **已关闭**（RN-447..450） | — | [ADR 0111](../adr/0111-conversao-de-execution-mode-de-projeto-existente.md) |

**第 2 波——PAT，[ADR 0105](../adr/0105-personal-access-token-do-runner-escopado-por-construcao.md)，已完成（RN-424/425/426；RN-427 之后在同一决策波次中关闭）：**

原始表格中"长期账户 token"这一项有**两处**文字错误，在实现期间被更正而不是盲目遵循——记录在
这里，因为下面的表格重复了它们：

1. **"数据库中的 argon2 哈希"是错的。** 产品中对**高**熵密钥（256 位 CSPRNG）的真实模式是
   通过 `hashDeToken()`/`TokenFactory` 的 HMAC-SHA256 + pepper——与 refresh tokens 和
   account tokens 相同的机制。Argon2 用于**低**熵密钥（密码），那里抗字典攻击很重要；在这里
   它只会破坏 `WHERE token_hash = $1` 的索引查找而毫无收益。
2. **"复用 refresh token 家族的轮换基础设施"不准确。** PAT 被反复出示且**不变**——从不像
   refresh token 那样被消费再重新签发。只复用了生成（`TokenFactory.gerar()`）和哈希；整个
   家族/轮换会是在发明 PAT 不需要的行为。

| # | 严重性 | 条目 | 证据（arquivo:linha） |
|---|---|---|---|
| 1 | **已关闭**（RN-424） | PAT 需要认证 `runner-ticket`，而不成为用户任何其他路由的有效凭据 | `apps/api/src/interfaces/http/auth/pat-route.decorator.ts`（`@RequirePatAuth()`）、`apps/api/src/interfaces/http/auth/jwt-auth.guard.ts`（第三个提前退出）、`apps/api/src/interfaces/http/auth/pat-auth.guard.ts`（`PatAuthGuard`，只应用于 `runnerTicket`） |
| 2 | **已关闭**（RN-425） | 验证高熵 token 而不泄漏三种拒绝原因（不存在/已撤销/已过期）中适用的是哪一种；`last_used_at` 在合法重连时不倒退 | `apps/api/src/infrastructure/persistence/drizzle/personal-access-token.repository.ts`（`validarEUsar`——单个条件 UPDATE，同一个 WHERE 中没有节流） |
| 3 | **已关闭**（RN-426） | 签发/撤销/列出而不把一个用户的 token 泄漏给另一个用户 | `apps/api/src/application/use-cases/auth/*-personal-access-token*.use-case.ts`，在查询的 WHERE 中按 `userId` 限定 |
| 4 | **已关闭**（RN-427） | `maintainer` 撤销**另一个**用户的 PAT（事件响应——一个开发者带着泄漏的 token 离开），当时声明为不在范围内 | `apps/api/src/application/use-cases/auth/*-personal-access-token-as-maintainer.use-case.ts`、`apps/api/src/interfaces/http/runner/personal-access-tokens.controller.ts`（`listAllPats`/`revokePatAsMaintainer`，独立路由，`@RequireRole('maintainer')`），在查询的 WHERE 中按 `projectId` 限定 |

`apps/runner/src/auth.ts` 完全失去了交互式登录、cookie 和 `~/.brabo/runner-credentials.json`——
它只验证格式并转发 `--token`/`BRABO_ACCOUNT_TOKEN`，CLI 从不把它写入磁盘。

**第 3 波——通过 npm 分发，[ADR 0106](../adr/0106-distribuicao-do-runner-via-tsup-e-npm-publish.md)，已完成：**

| # | 严重性 | 条目 | 证据（arquivo:linha） |
|---|---|---|---|
| 1 | **已关闭** | `apps/runner` 是 `"private": true`，`bin` 指向原始的 `.ts`，只能通过克隆 monorepo 访问 | `apps/runner/tsup.config.ts`（`format: cjs`，`external: ['node-pty']`）、`apps/runner/package.json`（`bin` → `dist/index.cjs`，`publishConfig.access: public`）、`.github/workflows/publish-runner.yml`（在每个最终 tag 时发布，独立 workflow，与 `release.yml` 并行） |

实现期间的真实发现，在进入代码之前经过经验测试：`index.ts` 自执行守卫的明显修复
（`import.meta.url === pathToFileURL(argv[1]).href`）恰好在这一波要启用的情况下是**坏**的——
通过已安装的 `bin` 调用（`npm install -g` 创建一个符号链接，而 `process.argv[1]` 从不经过
realpath 解析，`import.meta.url` 则总是）。最终修复在比较之前对 `argv[1]` 应用
`realpathSync`——见 ADR 0106。

**第 4 波——独立二进制，[ADR 0112](../adr/0112-binario-standalone-do-runner-via-bun-build-compile.md)，已完成，按平台有一个诚实的缺口：**

| # | 严重性 | 条目 | 证据（arquivo:linha） |
|---|---|---|---|
| 1 | **已关闭** | `node-pty` 通过运行时**计算**的路径解析其原生插件 `.node`——`bun build --compile` 不嵌入无法静态解析的东西，在设计修复之前经验确认（构建通过，运行时抛出 `Cannot find module`） | `apps/runner/src/native-pty-loader.ts`（真正解压到 `fs.mkdtempSync`，保留 `node-pty` 原始的相对布局，然后按绝对路径 `import()`——绝不按包名 `require('node-pty')`）；`apps/runner/scripts/build-bin.mjs`（生成 `native-pty-embed.generated.ts`，每个文件一个静态的 `with { type: 'file' }` import，这是 Bun 接受嵌入的唯一形式） |
| 2 | **已关闭** | `bun build --compile` 悄悄打包了**回退**的 `await import('node-pty')`（只在编译后的二进制之外使用），并在运行时而不是构建时抛出，在被隔离出来之前在一个误导性错误上花费了真实的调试时间 | `apps/runner/scripts/build-bin.mjs`（`bun build` 调用中的 `--external node-pty`） |
| 3 | **已关闭** | ADR 0106 自执行守卫的修复（对 `argv[1]` 的 `realpathSync`）在编译后的二进制中抛出未捕获的 `ENOENT`——在那里 `process.argv[1]` 是 `/$bunfs/root/<name>`，一个 `realpathSync` 无法解析的虚拟路径 | `apps/runner/src/index.ts`（**首先**检查 `import.meta.url.includes('/$bunfs/')`，在这种情况下无条件运行 `main()`） |
| 4 | **部分——构建那一半现已证明，附件那一半没有** | 只有 `linux-x64` 在这个沙箱中经过**真实**执行验证（`build:bin`+`smoke:bin` 反复通过，包括上面两个通过真正运行编译后二进制发现的 bug）；另外四个是通过阅读 `node-pty` 源码推理的，从未在该操作系统的真实机器上执行。第一个真实 tag 出现在 **2026-09-04（`v4.0.0`）**，解决了构建那一半：`linux-x64`、`linux-arm64`、`darwin-arm64` 和 `win32-x64` 各自在其原生 runner 上构建并通过 `smoke:bin`——**包括 Windows**，带着它的**三个**原生文件和 `worker_threads` 路径，最可能出问题的候选。失败的是构建**之后**的步骤，四者相同：附件步骤在 `release.yml` 发布 Release 之前运行了约 3m25s，因此**没有任何二进制被附加到任何 Release**。`darwin-x64`（`macos-13`）甚至没有开始——排队 40 多分钟，这是关于该 runner 标签的一个独立的、尚未调查的问题。附件步骤现在带上限地**等待** Release，因此下一个最终 tag 将证明附件和 `darwin-x64` | `.github/workflows/build-runner-binaries.yml`（5 个目标的矩阵，每个在其原生 runner 上；"Anexar à GitHub Release"步骤承载了测得的竞争）；ADR 0112 的目标矩阵表有每个平台的确切状态 |

没有在任何地方实现按平台的回退（更便宜的替代方案"二进制 + `node-pty-native/` 文件夹"，曾明确
提供给产品负责人并被他拒绝）——本次调查中发现的任何东西都没有**否定**真正单文件的方法，对五个
目标中的任何一个都没有。如果某个真实 tag 的构建表明其中一个确实不能这样工作（Windows 是最可能
的候选），那将在这里成为一个**新**的、单一平台的条目——而不是今天去猜测并预防性地绕开的东西。
`v4.0.0` 的构建回答了这一点：在运行的四个平台上不需要按平台的回退，包括 Windows，它产生的唯一
条目不是按平台的——是附件步骤与 `release.yml` 的竞争。

**留待以后的——由产品负责人排定优先级的 backlog，按此顺序：**

| 条目 | 成本 | 激活标准 | 在哪里决定 |
|---|---|---|---|
| runner 的排他性按 `{project_id, machine_id}` 而不只是 `project_id`（`apps/engine/lib/engine/runners/registry.ex`） | M | **推迟**——显式激活标准：第二个开发者确实在同一时间使用同一个项目 | ADR 0104 |
| 独立二进制的代码签名（macOS 上的公证，Windows 上的 Authenticode） | M | 运营者操作——需要产品负责人获取/支付一个签名身份，与 ADR 0106 中的 `NPM_TOKEN` 同类 | ADR 0112 |
| 把二进制附加到 Release，以及让 `darwin-x64` 真正运行——**构建**自 `v4.0.0`（2026-09-04）起在四个平台上已证明，附件一个都没有 | — | 在下一个 `vX.Y.Z` tag 时自动发生，因为附件步骤现在等待 Release，而不是在第一时间读到它不存在。`darwin-x64` 取决于某一天有 `macos-13` runner 被调度 | ADR 0112 |

`apps/runner/src/guard.ts`（对 `cwd` 的尽力而为的词法检查）**不是 backlog 条目**——它是自
ADR 0103 起声明、并由 ADR 0104 **重申**的不变量：runner 真正的安全边界是认证 + 一贯的审批
管道 + 用户同意，绝不是沙箱。

## 团队模型的 backlog（ADR 0085）——审计已关闭 {#backlog-of-the-team-model-adr-0085--audit-closed}

`fluxo.yml` × 代码审计的产出（[auditoria-fluxo-vs-codigo.md](auditoria-fluxo-vs-codigo.md)）。
这些是模型（`docs/fluxo.yml`）中关于已**激活**角色的声明条目——没有一个在等待某个
`proposto`/`planned` 角色先激活。计划的六波已关闭，这张表现在是**空**的：最后一个条目（B4，
PO 读取 `metricas-de-produto`）随 RN-407 关闭，没有新的 ADR——与 RN-164 已建立的模式相同
（限定于项目、无外部效果的智能体读取）。审计文档有完整的波次计划，每个条目带成本和验证标准，
供想看历史的人参考。

**自审计以来已关闭的**（没有从原始参考中移除，只从这张待办表中移除）：gate `implementavel`
（B3，ADR 0090）；`docs/gates.yml` 中 `paralelismo-autorizado` 过时（A1/B5，与 A3–A5/A8 一起
修正——`fluxo.yml` 中错误的 RN 引用和标签）；通过 `analise:funil` 获得的真实部署频率和前置时间
（B7 的一部分，ADR 0089）——B7 的其余部分（MTTR、变更失败率）没有关闭：它在 `fluxo.yml`
（角色 `delivery-metricas`）中仍被声明为**永久**缺口，不是工程待办；Dev Lead → dev 的委派（B1）
和在后端没有重新验证的 RN-160（A6/B6）——审计的第 2 波，ADR 0094，RN-404/405；gate
`necessidade-validada`（B2）——审计的第 6 波（最后一波），ADR 0095，RN-406；**产品指标 → PO
（B4）**——报告（`analise:funil`，ADR 0089）已经存在，缺的只是 PO **读取**
`metricas-de-produto`；随工具 `listar_metricas_de_produto` 以及抽取到
`apps/api/src/application/services/funil-metrics.ts` 的纯函数关闭（RN-407）——表中的最后一个
待办，结束了审计。

## 外部审查的 backlog（2026-08-28） {#external-review-backlog-2026-08-28}

一次外部的静态阅读审查（`melhorias-brabo-2026-08-28.md`，工作树根目录，没有运行任何测试套件）
提出了 15 个条目。已对照本文件、`architecture.md` 的[技术债务表](../architecture.md#divida-tecnica)、
[achados-execucao-real.md](achados-execucao-real.md)、ADR 0020 和 ADR 0027 以及工作树本身进行
核对。与本文档其余部分相同的规则：**这里不编造任何 P1/P2/P3**——下面的成本是审查者自己的
估算（P = 一个会话，M = 一个小阶段，G = 带 ADR 的独立阶段），不是优先级排名，优先级的决定权
在用户。

### 真正新的（在任何地方都没有先前记录） {#genuinely-new-no-prior-record-anywhere}

| 条目 | 成本 | 证据 | 说明 |
|---|---|---|---|
| ~~对 CI 下载的二进制（gitleaks、hadolint、actionlint、kustomize、kubeconform）做校验和 + GitHub Actions 按提交 SHA 而不是 tag 固定~~ | P | `.github/workflows/ci.yml` 没有任何 `sha256sum`/校验和验证；每个 action 都按可变 tag 固定 | **已完成**（[#408](https://github.com/daneiel/brabo/pull/408) + [#419](https://github.com/daneiel/brabo/pull/419)）——在 `ci.yml` 和 `docker/engine/Dockerfile`（dev 镜像；`Dockerfile.prod` 早已这样做）中每个 `curl` 之后做 `sha256sum -c`。固定花了两个 PR，原因就是发现本身：#408 把 **`ci.yml` 的** 9 个 action 改为提交 SHA，而这一行读起来像是全部——其余 15 个 workflow 仍停留在可变 tag 上，包括携带凭据的四个（`release.yml` → GHCR、`publish-runner.yml` → npm、`tag-release.yml`、`docs-deploy.yml` → `gh-pages`）。#419 固定了剩余的 49 个 `uses:`，并加上了缺失的机制：`scripts/ci/actions-pinadas.ts` 在任何按 tag 固定的 action 或任何没有版本注释的 SHA 上让 `lint` job 失败。记录在 [cadeia-de-suprimentos-do-ci.md](cadeia-de-suprimentos-do-ci.md) 中，它也声明了仍凭信任的东西（没有 Dependabot、没有依赖来源证明、没有工件签名） |
| ~~在两个 compose 中固定 `ollama/ollama:latest`~~ | P | `docker/docker-compose.yml:81,118` 和 `docker/docker-compose.prod.yml:328,346` 是两个文件中唯一没有固定的镜像 | **已完成**（[#401](https://github.com/daneiel/brabo/pull/401) + [#419](https://github.com/daneiel/brabo/pull/419)）——在 4 个 compose 位置固定为 `ollama/ollama:0.33.1`；**第五个** `deploy/k8s/base/ollama/job-model-loader.yaml` 在审查者的证据之外（它只点名了 compose），一直停留在 `latest`，直到 #419 |
| ~~从 OpenAPI 导出生成 `apps/web/src/lib/api-types.ts` 而不是手工复制~~ | M | `apps/api/src/scripts/export-openapi.ts` 存在；任何地方都没有 `openapi:types` 脚本和 `openapi-typescript` 依赖；`api-types.ts` 自己的文件头说它是手工镜像的 | **已完成**（[ADR 0116](../adr/0116-tipos-do-web-gerados-do-openapi.md)）——只迁移了 `ActionType`（在生产中被证明有重复成本的类型），而不是整个文件：`lib/api-types.generated.ts` 现在由 `openapi-typescript` 从 `docs/reference/openapi.json` 生成，`lib/api-types.ts` 从中重新导出 `ActionType`。`lib/aprovacoes.test.ts` 保留，收窄为编译器不做的内容断言（穷尽性现在由 `tsc` 通过 `Record<ActionType, ...>` 检查） |
| ~~针对关键路径的真实浏览器 E2E（Playwright）——cookie 认证、CSRF、Phoenix socket 的 ticket、流式传输~~ | M | 仓库中任何地方都没有 `playwright.config.*`、没有 `e2e/`、没有 `@playwright/test` 依赖 | **已完成**（[#420](https://github.com/daneiel/brabo/pull/420)，[ADR 0120](../adr/0120-e2e-de-navegador-contra-o-compose-de-producao.md)）——`e2e/`，只有 chromium，针对 `docker/smoke.sh` 已启动的**生产** compose（`SMOKE_KEEP_UP=1`）运行，并在同一个 `images` job 中，因为四个镜像占了该 job 挂钟时间的大部分。两个 spec，都经变异证明：cookie/CSRF/跨源路径（包括在重新加载后存活，这是证明内存中的 access token 是从 cookie **重建**的唯一方式），以及 RN-108 的一次性 socket ticket，对观察到的 WebSocket URL 而不是状态指示器作断言。`e2e/` 不是 workspace 的成员——独立 lockfile，与 ADR 0117 相同的形式，出于同样的审计原因。声明为**未**覆盖：浏览器之间的差异、内联审批和流式传输 |
| ~~分解 `SessionPage.tsx` / `ProjectSettingsTab.tsx`~~ | G | `SessionPage.tsx` 有 169 KiB，25 个测试文件导入它；`ProjectSettingsTab.tsx` 有 90 KiB | **已完成**（[ADR 0122](../adr/0122-sessionpage-dividido-em-cinco-prs.md) + [ADR 0124](../adr/0124-hook-do-canal-de-turno-do-sessionpage.md) + [ADR 0125](../adr/0125-projectsettingstab-dividido-por-secao.md)）——这一行的 `SessionPage.tsx` 那一半现已通过总共七个 PR **完成**。ADR 0122 的 5 个 PR 机械分解逐个合并（每个都在下一个开始之前，因为文件处于活跃变更中）：PR 1——timeline/轮次的纯辅助函数 → `apps/web/src/lib/session-timeline.ts`。PR 2——`StorySlide` → `apps/web/src/routes/StorySlide.tsx`。PR 3——`StructuredQuestionCard`（加上其私有辅助函数 `permiteOutra`）→ `apps/web/src/routes/StructuredQuestionCard.tsx`。PR 4——backlog 树的辅助函数（`urlDaPr`/`vinculoDeBacklog`/`montarArvoreDeBacklog`/`totalDeDescendentes`）→ `apps/web/src/lib/session-backlog-tree.ts`，以及 `ItemDeBacklog` + `ContextAside`（整个右侧边栏）→ `apps/web/src/routes/ContextAside.tsx`。PR 5——六个就绪派生（`criativoActive`/`arquitetoActive`/`hasBusinessRule`/`hasPromotedStory`/`hasProductBrief`/`activeAgent`）→ `apps/web/src/lib/session-readiness.ts` 中的 hook `useSessionReadiness`，五个 PR 中唯一不是机械文件移动的——明确声明轮次通道的状态集群（`turnoViaCanal`/`statusAgent`/`pensandoVisivel`/`atividadeDoTurno`）不在范围内，留给未来一个自己的 ADR。ADR 0124 就是那个 ADR，再加两个 PR：一个机械去重 PR（本身没有 ADR），让 `handleSend`/`handleReadiness`/`handleArchitectureReadiness` 调用已有的 `iniciarTurnoDoAgente`/`finalizarTurnoDoAgente` 而不是内联重复它们的分支，然后是抽取 PR，把状态、通道效果 `connectSessionHeartbeat` 和三个生命周期函数移到 `apps/web/src/lib/session-turno.ts` 中的 hook `useTurnoDoAgente`。`SessionPage.tsx` 在七个 PR 中从 3 807 行降到 2 479 行；全部 25 个（现在是 24 个，一个在 PR 1 中迁移为 `lib/` 的测试）`SessionPage.*.test.tsx` 文件始终未经编辑就通过。**ADR 0125 关闭这一行**，用**一个** PR 而不是五个：`ProjectSettingsTab.tsx`（2 532 行）拆分为 `apps/web/src/routes/settings/` 下每节一个文件——17 节加上一个只有两个符号的 `settings/shared.ts`（`ORIGIN_TONE`、`formatarCustoMicros`；其余十个模块级辅助函数各自恰好有一个调用方，去了那个调用方的文件）——并**留在**原路径作为入口和 barrel，77 行。barrel 是结构性的，不是装饰性的：`ProjectSettingsTab.test.tsx` 从该路径导入 11 个名称，`ProjectPage.test.tsx`/`project-tabs.test.tsx` **按路径**对它做 `vi.mock`。一个 PR 而不是五个，因为这个文件从未有 `SessionPage.tsx` 的形状——父组件什么都不保存（17 个 JSX 子组件，没有 hook，没有查询，没有 `t`，没有角色检查），没有任何一节接收多于 `{projectId}` 的东西（两节不接收 props），17 节中有 11 节已经导出。6 个私有节在自己的模块中获得了 `export`（机械性的——barrel 需要导入它们），但故意**不**由 barrel 重新导出，因此标签页的公开表面形状逐字节相同。web 的整个测试套件通过——142 个文件，1 537 个测试——**零**个测试文件被编辑 |
| ~~在 CI 本身中核对 `ci.yml` 与 `Dockerfile.prod` 之间固定的工具版本~~ | P | `ci.yml:45-46` 已经通过注释断言版本必须一致，但没有任何东西保证它 | **已完成**（[#408](https://github.com/daneiel/brabo/pull/408)）——`lint` job 中的新步骤对两个文件做 grep，在 `GITLEAKS_VERSION`/`HADOLINT_VERSION`/`ACTIONLINT_VERSION` 有任何不一致时失败 |
| ~~CI 中的覆盖率下限（在当前值上的棘轮）~~ | P–M | api/web/engine 中任何 `vitest.config.*` 或 `mix.exs` 都没有 `--coverage`/`--cover` 标志，也没有配置阈值 | **已完成**（[#410](https://github.com/daneiel/brabo/pull/410)）——下限设在测得的值（api 80/69/74/81，web 82/77/72/83，engine 78%，全部 vitest/`mix test --cover`）；没有添加 `excoveralls`，遵循不说明理由不安装库的规则 |
| ~~按领域拆分 `business-rules.md`；扩展 `readme-version.ts` 的模式来生成散文中的 RN/ADR 计数，而不是手工输入~~ | M | `business-rules.md` 有 650 KB，**334** 个 `RN-XXX` 标题，直到 RN-466——`README.md:200` 仍写着 "as 158 RNs"，这种偏离远大于文本老化所能解释的；`README.md:211` 中的 ADR 计数（115）比较之下是对的，因此今天只有 RN 计数需要修复 | **已完成**（[#417](https://github.com/daneiel/brabo/pull/417) + [#418](https://github.com/daneiel/brabo/pull/418)）——按这个顺序，而顺序就是关键：#417 教会 `docs:check` 从工件读取**计数**（ADR 来自 `docs/adr/` 中的文件，RN 来自 `### RN-NNN` 标题，provider 来自 `capabilities` 的字面量）并与散文比较，这就是阻止偏离回来的东西。然后 #418 按**大小而不是主题**拆分——仅 Custo 和 Autenticação 就占页面的一半——拆到 `docs/business-rules/custo.md` 和 `docs/business-rules/autenticacao.md`，内容一个逗号都没改，也没有重命名任何 `{#rn-NNN}` 锚点；293 个链接由脚本重写，计数仍是 334。编号从不按文件重新开始，检查按 glob 把三个文件加总 |
| ~~统一 `AGENTS.md`/`CLAUDE.md`（生成或符号链接 + 检查）~~ | P | 它们并不像假设的那样逐字节相同——大小相同（35043 字节），MD5 不同；有一行已经分歧（`AGENTS.md:444` 对 `CLAUDE.md:444`，各自引用自己的文件名） | **已完成**（[#402](https://github.com/daneiel/brabo/pull/402)）——自引用的那一行在两者中都改为中性，然后 `AGENTS.md` 变成指向 `CLAUDE.md` 的符号链接；分歧现在在文件系统层面就不可能发生，而不只是被检测 |
| ~~仓库卫生：去掉 `.env` 中残留的 `KEYCLOAK_*` 块（`.env.example` 中已没有）并退役 `migrate-keycloak-users.ts`；把 `spike/session-engine` 和 `design_handoff_brabo/` 移出/归档出仓库根目录；在 `docker-compose.prod.yml` 中把 Neo4j 的发布端口绑定到 `127.0.0.1`~~ | P | Keycloak 自 Fase 7 起已被移除（[ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)）；`docker-compose.prod.yml:80-82` 发布了 `7474`/`7687` 而没有绑定 | **已完成**（[#403](https://github.com/daneiel/brabo/pull/403)）——脚本及其 runbook 章节已删除，`spike/`/`design_handoff_brabo/` 已从树中删除（可在提交 `f5f771ac6` 中恢复），生产中 Neo4j 绑定到 `127.0.0.1`。`.env` 中 `KEYCLOAK_*` 的清理本身是本地的/gitignored，不是仓库中的改动——仍由用户负责 |
| ~~dev 容器以 root 运行；映射宿主的 uid/gid 而不是 `sudo chown -R` 变通~~ | M | dev Dockerfile（api/web/engine）中没有 `USER` 指令；`README.md:160` 和 `getting-started.md` 把这个变通作为公认事实记录 | **已完成**（[#406](https://github.com/daneiel/brabo/pull/406)）——见上面[零散](#standalone)中的详细说明；`DEV_UID`/`DEV_GID` 把容器映射到宿主用户，通过运行真实的栈证明 |
| ~~给 `website/` 一个自己的 lockfile，在产品的 `pnpm audit` 之外~~ | M | `website` 是 `pnpm-workspace.yaml` 的成员，共享单一 lockfile；13 个安全 override 中，8 个来自 Docusaurus/website 的依赖，3 个来自产品一侧（`js-yaml` 5.x、`lodash`、`esbuild`），1 个是混合的（`undici`，也被 `apps/web` 自己的 `jsdom` 使用） | **已完成**（[#414](https://github.com/daneiel/brabo/pull/414)，[ADR 0117](../adr/0117-lockfile-proprio-para-o-website.md)）——用 `pnpm why <pkg> -r` 审计这 13 个发现划分比这个估计更混乱：只有 2 个（`serialize-javascript`、`yaml@1.x`）是 website 独有；10 个而不是 1 个被证明是混合的（`mermaid`/`dompurify`/`uuid`/`postcss`/`nanoid` 也通过 `apps/web` 解析，`js-yaml`/`fast-uri`/`lodash` 通过 `apps/api`），在 `pnpm-workspace.yaml` 和新的 `website/pnpm-workspace.yaml` 中重复保留；`esbuild` 是唯一纯属产品一侧的 |

### 已声明、仍未估算成本的债务 {#already-declared-debt-still-uncosted}

这三项在 `architecture.md` 的[技术债务表](../architecture.md#divida-tecnica)中已经有行——审查
没有发现它们，而是为已记录但没有成本的东西估算了成本。**三项中有一项已经关闭**，正是审查认为
最贵的那一项：

| 债务 | 已在哪里声明 | 审查者的成本估算 |
|---|---|---|
| ~~把镜像发布到 registry，使生产部署可以端到端执行~~ | `architecture.md:552`，[ADR 0027](../adr/0027-fase5-backup-hardening-release.md) | **已完成**（[ADR 0119](../adr/0119-imagens-publicadas-no-ghcr-por-digest.md)）——四个镜像在每个最终 tag 时发布到 GHCR（公开），每个 tag 发布了什么**按 digest** 记录在 `.release/images.json` 中；overlay 保存标记，`make imagens-do-release` 应用它，因此仓库从不声明哪个版本在生产中。没有第三个 push 例外：该文件是 Release 的资产，放在 CHANGELOG 的 PR 中。做的时候发现、而**不**在这个估算中的：overlays 列出的是三个镜像而不是四个——备份的 CronJob 继承了 `brabo-backup:prod`，在任何 registry 中都无法解析。尚未完成也不声称：没有任何东西会自动部署（`DEPLOY_ENABLED` 仍不存在），镜像签名/证明不在其中，与 runner 二进制的代码签名条目一起 |
| 按聚合拆分 `schema.ts`（Drizzle 支持带重新导出的多文件 schema） | `architecture.md:546` | M |
| 针对 gate 语义路径的 golden-set（5–10 个用例，宽松的预期输出，固定模型，allow-failure） | `architecture.md:548`，[ADR 0020](../adr/0020-destravar-gates-qa-secops.md) | 审查者未估算 |

## 这次分类**不**做什么 {#what-this-triage-does-not-do}

它不修正任何东西。自 Fase 10 以来一直有效的纪律继续有效：每个发现等待处理它的阶段，在那之外
修正它会抹去它为何存在的证据。

它也不在没有数据的地方编造优先级：之前 backlog 的条目没有获得 P1/P2/P3，因为它们的决定属于
产品而不是工程——而披着分类外衣的猜测会比原始列表更糟。

---
id: glossary
title: 术语表
sidebar_label: 术语表
sidebar_position: 9
description: Brabo 的通用语言——出现在代码、界面和 ADR 中的术语，以及它们在这里承载的含义。
keywords: [glossary, ubiquitous language, harness, gate, handoff, DEK, outbox]
traducao_de: 19e47f4dc62d76241ca3d674b3a7638affb0e556
---

# 术语表 {#glossary}

下面的术语是**通用语言**：界面上显示的名称与代码、事件和 ADR 中的名称相同。其中一些在别处有更宽泛的
含义——本页说明它们**在本系统中**的含义。

按主题排序，因为在不知道 "harness" 是智能体概念的情况下去查它的情况很少见；常见的路径是按主题进入。

---

## 会话与事件 {#session-and-event}

**会话（Session）**——一次带有效果的对话，从开始到关闭。它是工作、成本和追踪的单位：一个会话在可观测性中是
一个根 trace，也是一个预算范围。它经历五种状态
（[RN-001](business-rules.md#rn-001)）。

**事件日志（Event log）**——`session_events` 表。只能追加：永远没有 `UPDATE`。每一行在会话内都有连续的
`seq`。它是"发生了什么"的事实来源，也是让 Psicólogo 的证据可追溯的东西
（[RN-002](business-rules.md#rn-002)）。

**`seq`**——事件在会话内的序号。稠密：从 1 开始且没有空缺。`seq` 中出现空缺就是数据损坏，恢复会因此失败。

**`closing`**——一个**过渡**状态，而不是停留状态。会话卡在 `closing` 意味着 drain 已开始但未完成；对此有告警。

**孤儿（Orphan）**——在 api 中处于 `active`、但在 engine 中没有存活的所有者进程的会话。它正是优雅关闭
要消除的失败模式；操作定义见 [runbook](runbook.md#quando-a-sessao-escapa)。

**Outbox**——*transactional outbox* 模式。api **在同一个事务中**写入事件以及发布它的意图；engine 随后
通过 Oban 消费它。这保证了"事件已写入"和"engine 已得知"永远不会分歧。没有 Redis——队列位于 Postgres 中。

---

## 智能体 {#agents}

**智能体（Agent）**——一个具有角色和身份的长期运行进程。目前有十一个规范角色，定义于
`apps/engine/lib/engine/harness/agents.ex`：

| slug | 角色 |
|---|---|
| `criativo` | 与用户一起引导构思，并产出业务规则 |
| `po` | 把简报变成带 DoD 和 DoR 的 backlog（史诗、用户故事、任务） |
| `arquiteto` | 技术决策（ADR）、模块图以及模块间契约（[RN-684](business-rules.md#rn-684)） |
| `dev-backend` · `dev-frontend` | 实现；在隔离的 worktree 中运行 |
| `infra` | 供应、部署和环境——**主动提案**，而不是执行者 |
| `qa` | 语义 gate：测试和验收标准 |
| `secops` | 确定性 gate：秘密、安全、合规 |
| `psicologo` · `psicologo-leve` | 分析会话并提出带证据的假设 |
| `anamnese` | 对用户的熟练度进行画像，并提出指令补丁 |

这些名称是**产品角色**，作名词使用时首字母大写（"Arquiteto 提出了一个 ADR"）。开发者是**动态的**：
每个 `module_map` 模块一个智能体，而不是固定列表。

**模块间契约**（[ADR 0200](adr/0200-contrato-entre-modulos-artefato-do-arquiteto.md)）——
Arquiteto 的带版本的 `artifact.module_contracts`：按模块说明它**暴露**什么（函数、路由、事件或数据形状，
附签名）。它消费什么则由 `module_map` 的 `dependsOn` 表示。dev agent 通过
`listar_contratos_de_modulos` 读取它，而不是读取另一个开发者的 worktree。

**领域（Area）**（第 8b/8c 阶段，[ADR 0038](adr/0038-hierarquia-de-agentes.md)）——
上表中的 `qa` 和 `infra` 成为了领域 LEAD：它们仍是唯一的对外联系人（相同的 slug，从外部看行为相同），
但现在会**委派**给子智能体——`qa-automacao`/`qa-performance-seguranca`（QA）、`infra-workflows`
（Infra）。委派是领域的**内部**机制，从来不是 handoff；领域对外返回的仍是单一产物（`qa_verdict`、
`open_infra_pr`）——使用方永远不会知道背后有多个智能体。

**Harness**——每个智能体必需的外壳。任何 LLM 调用或工具调用都不会在它之外发生。由五个部分组成：

| 部分 | 作用 |
|---|---|
| **PromptAssembler** | 以**有序层**构建提示词，每层有 token 预算，截断是**确定性**的——相同上下文，相同提示词 |
| **ContextManager** | 上下文增长时进行压缩 |
| **ToolLoop** | 工具请求 → 执行 → 结果的循环，带迭代上限 |
| **InstructionFiles** | 按优先级递增顺序解析 `AGENTS.md` 文件（根 → 目录 → 数据库） |
| **Hooks** | 循环周围的拦截点 |

**层（Layer，提示词的）**——一个带有 `id`、内容和截断策略（`truncate_tail`、`keep_or_drop`、
`drop_whole_units`）的块。预算按层计算，正是这一点让截断可预测，而不是"放得下就放"。

**ToolLoop**——智能体的循环。一个回合是：组装提示词 → 调用模型 → 模型请求一个工具 → 工具变成
`proposed_action` → 策略决定 → 执行 → 结果回到上下文。它有迭代上限；耗尽后，智能体以一个阻塞产物结束。

**回合（Turn，对话式智能体）**——会话范围内某个对话式智能体（Criativo、PO、Arquiteto、Dev Lead、
UX Designer、Staff——来自 ADR 0088，自动触发处于休眠，但可通过手动 handoff 激活——以及自
[RN-617](business-rules.md#rn-617) 起的 Infra Lead）的一轮工作：一次对 LLM 的流式调用，加上它触发的
工具循环。自 [RN-122](business-rules.md#rn-122) 起，它运行在一个受监督的 `Task`
（`Engine.Agents.TurnoAssincrono`）上，不再位于接收消息的 `handle_call` 内部——正是这一点让输入框的
**"停止"**按钮能真正取消回合（杀死任务，切断与 api 的连接），而不仅仅是停止客户端渲染。自
[RN-578](business-rules.md#rn-578) 起，启动回合的命令在**接受**时就得到响应：Task 一启动点击就返回，
回合的结束通过会话通道和事件日志到达，而永远不通过那个 HTTP 响应。每个智能体对循环轮数都有**自己的**上限
（Criativo 和 PO 为 12，Arquiteto、Dev Lead、UX Designer、Staff 和 Infra Lead 为 14）——这是智能体
自身服务器上的常量，而不是 `ToolLoop` 的上限（`Engine.Harness.Iteracoes`），后者适用于执行和 gate
智能体。Staff 是唯一没有 `kickoff/1` 的：它在第一条 `user_message` 之前保持空闲，因为没有会话产物可以
用来合成开场。在当时存在的四个智能体中，Criativo 是最后一个获得循环的，通过
[RN-163](business-rules/autenticacao.md#rn-163)：在此之前它每个回合只调用一次模型，并承诺一个从未发生的
修正。这个自有上限也不再沉默：耗尽时它发出**相同的** `toolloop.limit_reached`
（[RN-166](business-rules/autenticacao.md#rn-166)），因为这是同一个事实，阅读事件日志的人不应需要第二个名字。

**再水合（Rehydration，对话式智能体）**——当对话式智能体的进程在一个已有对话的会话上启动时（重启，或 PO
接手 Criativo），它如何从事件日志重建历史。七个智能体共用一条路径，`Engine.Agents.Reidratacao`
（[RN-580](business-rules.md#rn-580)）：它读取**尾部**（最后 200 个事件，而不是最前面的），带回结构化
问题和智能体自己的工具调用；当对话放不下时，以一条 system 消息开头，说明省略了多少更早的事件。

**Handoff**——工作从一个智能体到另一个智能体的显式移交。之所以是显式的，是因为目标和原因被记录在事件日志
中，而不是某个智能体隐式地"接管"另一个的上下文。

**产物（Artifact）**——智能体的结构化、经过验证的输出。十二个封闭的 schema（`note`、`business_rule`、
`product_brief`、`decision_record`、`plano_de_teste`、`prototipo_navegavel`、`threat_model`、
`task_blocked`、`qa_verdict`、`secops_verdict`、`infra_delegation_files`）：缺少字段会让产出失败。
这就是 gate 的裁决成为数据而非文本的方式。`business_rule` 还会因第二个原因失败：标题已在项目中登记
（[RN-080](business-rules/custo.md#rn-080)）——由于产物是不可变事件，产出是唯一可以拒绝重复的时刻。

**Worktree**——`git worktree`：每个 dev agent 一份隔离的工作副本，基于同一个仓库。两个开发者操作不同的
分支而不互相干扰。它是按**智能体**而不是按任务划分的：认领下一个任务的人会替换该目录，这迫使智能体在
gate 仍需读取它时保留它。

**工作区模式（Workspace mode）**——项目代码在磁盘上存放的位置，在创建时选择，之后**冻结**
（[ADR 0072](adr/0072-projeto-local-ou-container.md)，
[RN-169](business-rules/autenticacao.md#rn-169)）。`container` 是 `PROJECT_WORKSPACES_ROOT` 下的
受管理文件夹——默认且通常的行为；`local` 是用户自己的绝对路径，只有挂载进容器才能工作。不要把它与 IAM 的
**workspace**（项目和成员的分组）混淆：同一个词指不同的东西，而模式关乎磁盘。

**Dev agent 的状态**——`working`（正在实现）、`awaiting_approval`（提出了 commit/push/PR 且有一项待
审批——**没有 PR 就不会打开任何 gate**，[RN-050](business-rules/custo.md#rn-050)）、`awaiting_gate`
（PR 已打开，等待裁决）、`idle`（没有可认领的任务，进程存活）以及 `idle_tripped`（熔断器已触发，只能通过
显式重新武装退出——[RN-047](business-rules/custo.md#rn-047)）。前三个状态持有 worktree。

`idle` 有意涵盖**三种**不同原因：队列为空、认领失败，以及——自
[RN-502](business-rules.md#rn-502) 起——项目没有**已登记**为 `running` 的容器，这会在认领发生之前阻止它。
最后一种没有第四个状态：`idle` 是唤醒仍能救回的唯一状态，每个 `handle_info/2` 守卫都以它为键。区分这三者
的是**事件**（`dev.idle`、`dev.error`、`dev.blocked_by_container`），它是持久的，而从来不是状态。

---

## 审批 {#approval}

**`proposed_action`**——每个带外部效果的动作（终端命令、commit、push、PR、merge、花费）都在这里**诞生**，
从不直接执行。二十一种类型。六种状态（[RN-003](business-rules.md#rn-003)）。

**`permissions.json`**——项目的策略文件。匹配命令模式（结构化，不是子字符串），返回 `allow`、`deny` 或
`require_approval`。

**`deny` 优先于 `allow`**——贯穿整个系统的规则。决策依次评估 IAM → `agent_autonomy` →
`permissions.json`，任何阶段的 `deny` 都会立即返回（[RN-004](business-rules.md#rn-004)）。

**上限（Ceiling）**——在整个策略**之后**施加的降级，任何配置都无法越过它提升。有两个：合并到受保护分支
（[RN-006](business-rules.md#rn-006)）和指令补丁（[RN-007](business-rules.md#rn-007)）。上限就是
"默认不行"与"不行"之间的区别。

**`agent_autonomy`**——项目中智能体的运行模式：`manual`（每个动作都请求审批）或自动。它是成本事故中第一个
要拨动的开关。

**受保护分支**——`dev`、`qa`、`rc`、`main`。合并到其中任何一个**始终**是人的决定。平台（GitHub/GitLab）
上的等效保护在不同 provider 之间存在差异，并且**不是**闸门——领域才是闸门
（[ADR 0028](adr/0028-protecao-de-branch-divergencia-entre-providers.md)）。

---

## Gate 与执行 {#gates-and-execution}

**Gate**——开发者的 PR 与合并之间的强制关口。两个：**QA**（语义的，运行 LLM）和 **SecOps**（确定性的，
运行扫描器）。顺序不可变：`awaiting_qa → awaiting_secops → awaiting_user`
（[RN-014](business-rules.md#rn-014)）。

**`awaiting_user`**——gate 状态机的终止状态。有意设为终止：系统从不合并。

**`changes_requested`**——gate 把工作退回给开发者，**在同一分支上**。不会打开新的 PR。

**循环 K（Cycle K）**——每个任务的修正上限。每次退回消耗一轮；耗尽后，任务带着原因被阻塞，而不是永远打转。
子智能体继承基础智能体的上限（[RN-015](business-rules.md#rn-015)）。

**`task_blocked`**——任务停滞时产出的产物：带有 `reason` 和 `diagnosis`。它是可读的失败记录，而不是沉默。

**搁置的 gate 循环**——一个 QA/SecOps 循环处于 `in_progress` 且超过 2 小时没有活动。`GateRescuer` 不再
自行恢复它（无论在启动时还是在其定时器上）：它记录 `gate.rescue_parked` 并设置 `parked_at`，只有人的
操作才能恢复它——目前是通过运维人员的 `bin/engine rpc` 调用 `GateRescuer.retomar_estacionado/3`
（[ADR 0207](adr/0207-ciclo-de-gate-velho-estaciona.md)，
[RN-722](business-rules.md#rn-722)）。会话中有来自 gate 角色的待审批项的循环也不会被重启：它在等你。
被 engine 重启本身杀死的**近期** `in_progress` 循环既不会被搁置，也不会等待 15 分钟阈值：在启动时，当集群
中没有任何节点正在执行它时，救援者会记录 `gate.interrupted` 并立即重启它
（[RN-823](business-rules.md#rn-823)）。

**`implementavel`（可实现）gate**——一个**开发前**的关口，在 dev agent 或 worktree 存在之前：Dev Lead
根据用户故事本身和当前的 `module_map` 评估故事是否可实现（在
[ADR 0192](adr/0192-plano-de-teste-depois-da-entrega.md) 之前，输入是 QA 策略的测试计划）。
`dono: dev-lead`、`aprovacao_humana: true`、`severidade: warn`
（[ADR 0090](adr/0090-qa-estrategia-e-appsec-segundo-momento.md)）。

**QA 策略**——处于第二个**时刻**的 `qa-lead`（同一进程，与 PR 裁决分开的交付物）：它针对**一个**任务的
**交付**，在 dev agent 交付**之后**，产出**测试计划**（综述、可执行标准、自动化策略）——这是
`qa-verificada` 审查的第一步，作为其输入，从不是独立的裁决
（[RN-674](business-rules.md#rn-674)，
[ADR 0192](adr/0192-plano-de-teste-depois-da-entrega.md)）。从不挂起——它的工具都不经过动作流水线。

**AppSec**——处于第二个**时刻**的 `secops`，与 QA 策略相对于 `qa-lead` 的形态相同：**同一个**进程
（`SecOpsAgentServer.run_design/2`）针对用户故事的**设计**产出 STRIDE-lite **威胁模型**——没有
worktree，没有 `task_id`，在任何代码或 PR 存在之前。它从不批准或拒绝任何东西；它以产出
`artifact.threat_model` 并移交给 Arquiteto、Dev Lead 和 Infra 结束。由 Dev Lead 的
`assess_implementability` 触发，并行执行，每个用户故事一次
（[RN-360](business-rules.md#rn-360)、[RN-539](business-rules.md#rn-539)，
[ADR 0090](adr/0090-qa-estrategia-e-appsec-segundo-momento.md)）。

---

## Backlog 与架构 {#backlog-and-architecture}

**业务规则（RN）**——由 Criativo 产出并与用户故事关联的单元。没有用户故事的规则是**覆盖缺口**，而不是错误
（[RN-011](business-rules.md#rn-011)）。

**用户故事（Story）**——四种状态；离开 `draft` 需要 DoD、DoR、至少一个功能需求以及至少一条关联规则
（[RN-010](business-rules.md#rn-010)）。

**DoD / DoR**——Definition of Done 和 Definition of Ready。在这里它们不是形式：两者缺一，用户故事就不会
改变状态。

**`module_map`**——系统的模块图，来自 Arquiteto。它决定存在多少个 dev agent（每个模块一个）以及每个用户
故事属于哪个模块。不能有环（[RN-013](business-rules.md#rn-013)）；被移除的模块会降级依赖它的用户故事
（[RN-012](business-rules.md#rn-012)）。

**项目镜像（`artifact.project_image`）**——Arquiteto 关于哪个容器运行项目代码的决定：一个 OCI 镜像（必须
显式指定 tag，`latest` 被拒绝）、网络姿态（默认 `none`，`egress` 需授权）以及资源上限。与 `module_map`
一样在事件日志中带版本。在它存在之前，`sem_decisao`（无决定）状态会让 Code 标签页保持关闭
（[RN-105](business-rules/autenticacao.md#rn-105)）。

---

## 成本 {#cost}

**计量（Metering）**——在 `token_usage` 中按调用记录的消耗：token、以 micros 计的成本、延迟、模型、
智能体。它是**记录，而不是退款**。

**预算（Budget）**——具有排他范围的花费上限：项目**或**会话，从不两者兼有
（[RN-017](business-rules/custo.md#rn-017)）。在 70/90/100% 时通知，不重复。

**`policy`**——预算到达上限时的行为：`block` 拒绝调用，`allow` 只记录。处于 `allow` 的项目**不会自行停止**——
这是"预算没守住"最常见的原因（[RN-019](business-rules/custo.md#rn-019)）。

**Binding**——一个范围与一个 LLM 模型之间的绑定。按级联解析：**会话 > 智能体 > 领域 > 项目 > 工作区**，
取第一个存在的（[RN-020](business-rules/custo.md#rn-020)）。这就是为什么你可以只给 QA 配一个昂贵的模型。
`area` 是 lead 及其子智能体共享的**默认值**，智能体可以与之不同
（[RN-102](business-rules/custo.md#rn-102)）。

**能力维度（Capability facet）**——**provider 声明**的关于某个模型的信息：读取图像、生成图像、进行
thinking、接受 `tools`。在同步时来自远程目录；`false` 表示"未声明"，从不表示"做不到"
（[RN-056](business-rules/custo.md#rn-056)）。

**模型用途（Model use）**——**本工作区**把该模型用于什么（`codigo`、`documentacao`、`analise`、`imagem`、
`conversa`）。这是运维人员的意见，而不是能力：没有目录会发布"适合写代码"。标记一个用途**不会在**选择器中
启用该模型（[RN-057](business-rules/custo.md#rn-057)）。

---

## Psicólogo 与 Anamnese {#psychologist-and-anamnesis}

**假设（Hypothesis）**——Psicólogo 的输出：关于团队的一个论断，带有指向所分析会话中真实事件的
`evidenceEventIds`。没有有效证据就不会被记录（[RN-021](business-rules.md#rn-021)）。

**终止原因（Termination cause）**——对某件事为何失败的确定性分类：`infra`、`modelo`、`código` 或
`política`。来自记录的原因，从不来自 LLM 的判断，也从不通过排除法
（[RN-023](business-rules.md#rn-023)）。

**`proficiency_profile`**——由 Anamnese 维护的用户熟练度画像，按能力划分。六项流程能力，**封闭**
（`git`、`agile`、`arquitetura`、`testes`、`seguranca`、`infra`），加上从 `module_map` 推导出的技术栈。
目录之外的任何东西都没有写入路径（[RN-024](business-rules.md#rn-024)）——Anamnese 画像的是技术能力，
而不是这个人。

**合格主体（Eligible subject）**——一轮 Anamnese 可以画像的人：项目的**有效**成员（项目行，否则工作区行），
不在退出名单中，并且在窗口内有**自己的**交互。没有任何人时，这一轮不会调用 LLM
（[RN-680](business-rules.md#rn-680)）。

**画像事实（Profile fact，`FatoDoPerfil`）**——会话所属的人**接受**了的 Psicólogo 假设，从
`psychologist.hypothesis_accepted` 投影到图中，并作为临时 system 消息交给与此人对话的智能体
（[RN-680](business-rules.md#rn-680)）。

**`instruction_patch`**——修改智能体指令的带版本提案。从不可自动批准（[RN-007](business-rules.md#rn-007)）；
被拒绝的不会再次提出（[RN-026](business-rules.md#rn-026)）；回滚会创建新版本而不是删除
（[RN-027](business-rules.md#rn-027)）。

---

## Git 与秘密 {#git-and-secrets}

**GitProvider**——Local、GitHub 和 GitLab 实现的规范化十二操作契约。一套契约测试对三者全部运行。

**Capability**——该 provider 支持什么的声明。不支持的操作以显式错误被拒绝，从不静默失败
（[RN-028](business-rules.md#rn-028)）。

**Gitflow bootstrap**——准备仓库的六个步骤（永久分支、保护、基础文件）。幂等且可恢复：`skip` 即成功
（[RN-029](business-rules.md#rn-029)）。

**信封加密（Envelope encryption）**——每个用户秘密都用自己的 **DEK**（数据加密密钥）加密，而 DEK 由
`CREDENTIALS_MASTER_KEY` "包裹"。轮换主密钥会重新包裹 DEK 而不触碰密文——这就是为什么轮换可以中断
（[runbook](runbook.md#rotacao-da-chave-mestra)）。

**`wrapped_dek`**——被包裹的 DEK，即存储在数据库中的形式。**不能识别是哪个密钥包裹了它**——正是这个属性让
轮换成为三步流程，而不是替换一个变量。

---

## Infra {#infra}

**Oban**——使用 **Postgres** 作为后端的 Elixir 队列库。队列深度（`oban_queue_depth`）是驱动 engine HPA
的指标。

**Drain**——engine 的 `preStop` 阶段：`/ready` 变为 503，新会话被拒绝，节点上的每个会话都被提供给一个存活
的对等节点。未被接管的会以 `closed_abnormally / node_shutdown` 关闭——这是正确的终止，而不是孤儿。

**接管（Adoption）**——另一个节点接管会话的进程。发生在 drain 期间（主动移交）以及
`SessionAdoptionWorker` 中，后者每 30 秒扫描一次，以覆盖 `kill -9` 和 OOMKill，这些情况下 `preStop`
不会运行。

**`:global`**——Erlang 的分布式注册表。保证**整个集群中每个会话只有一个所有者**；没有形成 Erlang 集群时，
每个副本都会变成孤岛（[ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md)）。

**根 trace（Root trace）**——一个会话 = 一个 trace，跨越 api ↔ engine。`traceparent` 持久化在
`sessions.trace_parent` 中，你用它在 Tempo 中导航。`trace_id` 诞生于 **web**（浏览器生成
`traceparent`），即使没有 collector 也存在：导出与埋点是分开的决定
（[ADR 0035](adr/0035-observabilidade-legivel-e-trace-sem-coletor.md)）。

**跨层路径（Path across layers）**——请求在 api 中穿过的边界序列（`interfaces` → `application` →
`infrastructure`），附每一步的耗时，每个请求输出为**一行**日志。它来自由 `@Traced` 装饰器填充的
`AsyncLocalStorage`，而不是来自 span——正是这一点让它无需 collector 也能工作。参见
[可观测性](explanation/observability.md)。

**层（Layer）**——在上面的路径中，边界的标签：`interfaces`、`application`、`domain` 或
`infrastructure`。对应 `apps/api/src/` 下的目录以及它们之间的依赖规则。

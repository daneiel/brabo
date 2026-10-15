---
id: historico-de-fases
title: 阶段历史
sidebar_label: 阶段历史
sidebar_position: 14
description: Brabo 已完成阶段的不可变记录——每个阶段交付了什么、砍掉了什么、发现了什么，以及原因。
keywords: [历史, 阶段, ADR, RN, changelog]
traducao_de: a65c25acf8e673b8ee0d104512a284ee5f8606c5
---

# 阶段历史

> Brabo 已完成阶段的不可变记录，于 2026-08-23 从 CLAUDE.md 原样移出，未作改写。产品**当前**的状态位于 CLAUDE.md、RN（docs/business-rules.md）和 ADR 中——本文件回答的是“如何走到这里”，从不回答“今天什么有效”。已接受的 ADR 从不编辑；本文中记录的 ADR 更正在其所在位置依然有效。

## 状态 {#status}
- 第 1 阶段（MVP）——已完成：IAM/RBAC、带不可变 event log 的会话、带 LLM 路由器的聊天（Ollama + API）、token 的计量/预算、proposed_actions 管道 + permissions.json、带监督和终止事件的 Elixir/OTP 引擎。
- 第 2 阶段——已完成：带契约测试套件和 capabilities 的 GitProvider（Local/GitHub/GitLab）、加密凭据、通过管道实现的幂等且可恢复的 Gitflow bootstrap、带实时进度的向导。
- 第 3 阶段——已完成：Harness（PromptAssembler、ToolLoop、ContextManager、InstructionFiles、Hooks）、显式 handoff、带产物和领域校验的 Criativo、PO 和 Arquiteto agent。
- 第 4 阶段——已完成：执行型 agent（在隔离 worktree 中按模块动态生成的 dev、作为 PR gate 的 QA 和 SecOps、提议式的 Infra）、受保护的合并锁、实时团队面板；真正的 Psicólogo 和闭环的 Anamnese。gate 经真实执行验证（ADR 0020）。
- 第 5 阶段——已完成：非 root 生产镜像和 CI（ADR 0024），带 Kustomize 的 Kubernetes、按 Oban 队列的 HPA、NetworkPolicy 和 ESO（ADR 0025），graceful shutdown + OpenTelemetry + 仪表盘（ADR 0026），经测试可恢复的备份、运维手册和加固（ADR 0027）。
- DOC 阶段——已完成：docs/ 作为采用 Diátaxis 的唯一来源，website/ 中读取 docs/ 的 Docusaurus 站点，生成的参考文档，docs/.docmap.yml + CI 中的漂移检查（docs:check），社区层，已核实的 MIT，机制记录在 docs/explanation/documentation-workflow.md 中。
- 第 6 阶段——已完成：机械化的分支策略（ADR 0030）——pr-police、带两种模式的 approval-ladder、带计算版本和按目录树锚定的 promote/tag-release、带自动反向传播的 backmerge gate、版本化的 ruleset。流水线端到端演练（v0.1.0 → v0.2.0），hotfix 链路经真实执行验证。
- 第 7 阶段——已完成：取代 Keycloak 的 first-party auth——argon2id、Ed25519 access、带家族吊销的 refresh 轮换、渐进式 lockout、账号 token 和仅记日志的 MailSender（ADR 0031，RN-030..033）；以自有签发者进行原子切换，RBAC 不变，/internal/* 使用 service token，httpOnly cookie + CSRF，用户迁移并彻底移除 Keycloak（ADR 0032，RN-034/035）；23 个 controller 上的 OpenAPI，DTO 按类型锁定，表格测试要求元数据，生成带哈希清单的 docs/reference/api/（ADR 0033）。
- 第 8 阶段——带裁剪地完成：agent 层级——以唯一 lead 作为对外联系人的领域、私有的内部委派（`delegations` 表，`area` 为 TEXT）、可追溯的合并结论、带来源的失败；QA 作为领域（Lead + 自动化 + 性能/安全，gate 的外部契约不变——第 4 阶段的测试套件无需修改即为绿色）；Infra 作为领域，带有按 provider 生成 CI 的 Workflows 子 agent；按领域划分的团队面板，以及以子 agent 为目标的 Psicólogo/Anamnese（ADR 0038）。
  当时的范围裁剪，已被第 14d 阶段撤销：
  `agent_areas`/`agent_area_members` 自那以后按项目存在，`max_parallel` 可配置——迫使这一点的是 dev 领域，第一个**动态**领域。仍被裁剪的只有**按领域的预算**（真正的预算上限仍然是项目、会话和任务）。
  `apps/web/src/lib/agents.ts` 中的列表保留了颜色、图标和寻址**规则**；dev 的成员来自表。
- 第 9 阶段——已完成：针对现有 provider 运行的 LLMProvider 契约测试套件，基于 node:http、带**空闲**超时的 OpenAICompatibleProvider 基础，按 `code` 规范化的错误，两层 capabilities（ADR 0041）；目录同步——新发现的模型以禁用状态进入，消失的模型被标记而不是删除，价格冻结在 `token_usage` 中并带有仅追加的审计（ADR 0042）；按来源重新分组并带策展的 ModelPicker。
  第 9b 的六个 provider 由第 11 阶段引入（ADR 0043）。
- 第 10 阶段——已完成：Bitbucket + GenericGitProvider **通过** dogfooding 交付（Brabo 第一次真实地构建 Brabo 自身，在一个手工 seed 的 fork 中，分批进行、任务之间重启，Criativo 在链路中为必需）。收获写在第 12d 阶段的 docs/explanation/primeiro-dogfooding.md 中——带有 arquivo:linha 的 17 个发现是真实的；**定量**的那一半（重启、干预、成本）仍是 `não medido`，因为观察表从未填写。三个可运维性 P1 由第 12 阶段关闭。其余 14 个仍然开放并列在收获中——不要顺手修复。
- 第 11 阶段——已完成：第 9b 阶段的六个 provider 作为基础之上的配置，每个都对照官方文档从零调研（禁止继承怪癖）；LLM_PROVIDER_NAMES 从 3 个增加到 9 个；凭据 DTO 和连接测试器派生自单一列表；capability 只在经证明时才声明，现场有两次回退（DeepInfra 和 Vultr）；基础中唯一的新 hook（`parseErrorFrame`，+31 行）由 OpenRouter 证明为必要（ADR 0043）。
  使用真实凭据的 smoke 待办：由第 13 阶段吸收。
- 第 12 阶段——已完成：dogfooding 之后的可运维性，三个 P1 发现在一次执行中关闭并证明（ADR 0047）。
  12a——采纳已有仓库：独立路由、`getRepo` 在写入前校验访问权限、两张表中的 `origin`（created|adopted），以及作为闸门的**计划**——描述差异、在决定为空期间不做任何更改的 dry-run；重新采纳会收敛（ADR 0044，RN-045/046）。
  12b——按事件重新调度 dev agent：持久化的状态机（working|awaiting_gate|idle|idle_tripped）对现有 outbox 的两个事件作出反应，`awaiting_gate` 保留 worktree（它是按 **agent** 而不是按任务的）直到 gate 结束，并带有显式 rearm 的断路器（ADR 0045，RN-047）。
  12c——以用户权威推进故事：按项目的 `story_promotion`，以 `manual` 作为**新的默认值**（定向回填把已有项目设为 `auto`），`proposed_ready` 作为提议而非状态，推进复用 TransitionStoryUseCase（发现 #13 的死代码），拒绝会把原因固定在 PO 的会话中退回给他（ADR 0046，RN-048）。
  12d——Noop 进入了 12b 的状态机；脚本
  `pnpm --filter api validacao:fase-12` 在标准不满足时以非 0 退出，并从数据库提取证据；第 10 阶段的收获已写成；docmap 覆盖 engine/dev 和 engine/agents。
  待办（执行验证；声明的 Local/Noop 限制）：由第 13 阶段吸收。
- 未经明确请求，不要重构已完成的东西。

## 第 13 阶段——2026-08-07 完成（真正地证明并分诊） {#fase-13--concluída-em-2026-08-07-provar-de-verdade-e-triar}
没有新功能。该阶段关闭已声明的待办，证明 Local/Noop 验证明确无法证明的内容，并把 19 个开放的发现变成有优先级的计划。吸取的教训：第 10 阶段的手工表从未被填写——在这个阶段，**所有**指标都由脚本从 event log/token_usage 中提取，从不手工记录。

### 13a——关闭已声明的待办 {#13a--fechar-as-pendências-declaradas}
1. 2026-08-07 完成：`pnpm --filter api validacao:fase-12` 以 `0` 退出，event id 表在 docs/explanation/validacao-fase-12.md 中（TODO(humano) 已移除）。代价是四项修复——三项属于**工具**（实验对象诞生在 /tmp，engine 看不到；Noop 不打开 gate；Noop 死在 `pr_settled`），一项属于**产品**（发现 W：队列清空时 dev agent 会死掉）。
2. 2026-08-07 部分完成：**OpenRouter** 的 smoke 以真实凭据运行并通过（真实成本 US$ 0,000005，从 `token_usage` 读取）。其他五个仍被跳过——环境中没有它们的密钥。该 smoke 相对于 ADR 0049 已经腐坏，从未运行过；一并修正。带日期的结果在 docs/explanation/aceite-providers.md 中。

### 13b——2026-08-07 完成（v2.4.0） {#13b--concluída-em-2026-08-07-v240}
整条链路针对**真实** GitHub（`daneiel/test`）在十次执行中得到证明：远程采纳 → 带用户决定的计划 → 手动推进**一个**故事 → 真实的 dev agent 编写代码 → 提交、推送和**远程** PR → gate 打开 → 领域委派并附理由豁免 → 子 agent 在审批处**挂起** → 用户的拒绝**恢复**循环 → 由 LLM 给出 `changes_requested` 结论。engine 零重启。合并按设计排除在外（RN-014）。
3. 脚本是 `pnpm --filter api validacao:real`，按**成本**分阶段（`--ate adocao|backlog|execucao`）——便宜的先单独跑，配置错误就是这样在花钱之前暴露出来的。需要**在 api 容器内部**执行：策略是共享卷中的文件，从主机执行时它会诞生在 engine 看不到的文件系统中。
4. `pnpm --filter api medir:execucao` 是测量工具，并且已经**证明**：它独立复现了上一次 dogfooding 手工记录的数字（18 次调用，292.211 个 token，约 US$ 0,03）。
5. 结果在 docs/explanation/validacao-real.md 中，包含十次执行以及每一次的教训。

途中关闭了**七个** P1，全部由**执行**而非测试发现：W（队列为空时 dev agent 会死掉）、Y（搜索无法区分为空与未找到）、AA（git 凭据由点击者而不是付费者解析——RN-082）、AB（gate 把待决事项称作基础设施失败——ADR 0057）、AC（重定向让任何命令都无法批准）、路径范围中的 ReDoS（CodeQL HIGH），以及 postgrex 的 CVE。

在该阶段打开的发现中，X 后来关闭了（第 14d 阶段，RN-085——迭代上限改为按 agent **类型**）。**两个**仍然开放，它们的论证比数字更有价值：Z 和 AD（动词 allowlist **不**收敛：动词、形式和调用是不同的空间，第 6/7/8 次执行各卡在其中一个），以及 AE（QA agent 试图修复它所评判的代码，违背了自己的 prompt——由两道独立的屏障约束：allowlist 和范围）。两者都不是要修复的 bug：它们是产品决定，记录在 docs/explanation/achados-execucao-real.md 中。

该阶段交付的、比 PR 更重要的结论：通往自主的道路**不**经过放松策略。它经过让 agent **等待**决定而不是死掉——ADR 0057 为 gate 做到了这一点，扩展了 0052。

### 13c——完成：分诊变成了 docs/explanation/backlog.md {#13c--concluída-a-triagem-virou-docsexplanationbacklogmd}
19 个发现都已关闭（19 个中的 19 个）。该文档仍然是活的，并接收了 13b 的新发现。
6. 分诊会议：阅读 docs/explanation/primeiro-dogfooding.md，把 19 个发现分为 P1/P2/P3，并提出按内聚阶段分组的建议（按主题及其相互依赖）、估计的相对成本（P/M/G）以及等待的风险。产出是**提议**——优先级的决定属于用户。
7. 把完整的 backlog 整合到一份活文档中（docs/explanation/backlog.md 或等效文档）：已分诊的发现 + 旧条目——按领域的预算（ADR 0038；领域机制和 Dev Lead 随 ADR 0053 离开了 backlog，由第 14d 阶段实现）、手动 handoff 给所选 agent、MFA/社交/OIDC/联合（ADR 0031）、MailSender 中的真实 SMTP、部署（DEPLOY_ENABLED + Environments）、rc/rcfix 的回归（ADR 0030）、approval-ladder 的 community 模式、仪表盘上的“N 个 agent 在线”、带手动汇率的货币偏好。

## 第 14 阶段——2026-08-07 完成（真实执行所要求的） {#fase-14--concluída-em-2026-08-07-o-que-a-execução-real-exigiu}
hello world 的执行没有越过第一个回合，暴露了任何测试套件都没有捕获的缺陷，因为之前的一切都用**本地**模型运行。修复已经合入；剩下的是用户在执行期间决定的功能。

### 14a——agent 的可运维性（已完成） {#14a--operabilidade-dos-agentes-concluída}
- 回合失败变成了带来源的**持久** `agent.error`，agent 会在消息流中**说话**；四个对话型 agent 不再记录空的 `agent.response`（RN-059）。在最终帧中叙述、却不发出任何事件的错误路径也关闭了。
- Criativo 的聊天以邀请而不是空白开场：它被激活后等待用户先开口，界面现在会说明这一点——包括技术和代码**不**归它管。
- agent 消耗的密钥是 workspace **owner** 的（RN-058）。之前回合在一个 UUID 列中按 agent 的 **SLUG** 查找凭据：没有任何 agent 用过带凭据的 provider，只有 `ollama` 能工作。
- 密钥花费报告，仅限 owner，agent 与人分开（RN-060）。
- GitHub 上的 Gitflow bootstrap：新建的仓库在整个 Git Data API 上返回 409，第一次提交改走 Contents API。测试中的伪造后端撒了谎（在 GitHub 返回 409 的地方返回 404）——一并修正，正是它让测试套件在产品坏掉时仍然是绿色。

### 14b——树状时间线（已完成） {#14b--linha-do-tempo-em-árvore-concluída}
每个 agent 一个分支，从第一个里程碑到它**此刻**正在做的事，100% 派生自界面已经获取的 event log。按时间排序的动态仍保留在活动列中：它回答“发生了什么”，树回答“谁在做什么”。

在第 26 阶段之后重新审视（没有新阶段，与 12d/第 15 阶段之后同样的定点修正精神）：默认展开标准从仅“活跃/停止”改为活动**最近**的 5 个 agent——活跃的仍然优先（RN-118）；每个折叠的分支都有了自己的**新内容**计数器，在 `read-state.ts` 中按 agent 记录“最后查看”（与铃铛相同的机制，现在更细粒度）；`tool.call`/`tool.result`/`agent.response` 改为**逐个**展开（参数、结果、迭代），按 ToolLoop 的迭代边界分组。

### 14c——UI 的自动验证（已完成） {#14c--validação-automática-de-ui-concluída}
对比度变成了针对 `design/tokens.css` 的测试，已知的欠账被测量并锁定；布局（被截断的文本、视口外的菜单、被祖先裁切的下拉框、< 24px 的目标）变成了 `scripts/dev/validacao-visual.js` 中的浏览器检查器。没有新依赖。

### 14d——完成：并行度由 LEAD 决定，由你授权 {#14d--concluída-paralelismo-decidido-pelo-lead-autorizado-por-você}
分四个 PR 交付（#181、#182、#183、#184）。ADR 0053 变为**已接受**，彻底撤销了三项裁剪（Dev Lead、通过 module_map 的动态领域，以及通用的领域机制）。

1. **领域变成了数据**：按项目的 `agent_areas`/`agent_area_members`，`max_parallel` 默认 2。迫使这一点的是 **dev** 领域——第一个**动态**领域，其成员是 module_map 中每个模块各一个。无法在代码中枚举的东西必须是数据。
2. **上限属于会话，而不属于模块**（RN-083）。按模块计数会允许 N 个模块 × 2 而无需任何授权——换了个名字的旧漏洞。超过上限就变成 `proposed_action`。
3. **可在配置中按领域配置**，需要 `maintainer`，理由与激活执行相同：修改上限就是在不询问的情况下决定产品花多少钱。
4. **当授权变成例行公事时，Anamnese 会提议调高**——三次批准且**没有**拒绝（RN-086）。一次拒绝就会撤销这个信号：如果你曾经拒绝过，说明上限在发挥作用。
5. **Dev Lead 存在了**（RN-087），对话型，在已经交付给 Infra 的同一次确认中接收 Arquiteto 的 handoff，并提出计划：每个模块几个 agent 以及原因。`dev-<modulo>` 不再能通过 handoff 寻址——ADR 0038 的规则开始对 dev 生效，就像它早已对 QA 和 Infra 生效一样。

**发现 X** 在这里关闭（RN-085）：`TOOL_LOOP_MAX_ITERATIONS` 变成了按**类型**的上限——对话型 8，执行和 gate 60。谁能调高的标准**不是**“谁干得多”：而是谁底下有 `token_budget_micros` 在控制花费。`infra-workflows` 使用重型工具却保持在 8，因为它在没有预算的情况下运行。

**该阶段自身的三个缺口，是我在写下一个切片时发现的，而且全是同一种失败**：上限规则带着绿色测试合入，但产品并不演练它——没有任何路由调用该用例，批准动作并不执行任何东西，而该类型可以被 permissions.json 自动批准（由 RN-086 关闭）。测试零件不等于测试通往它的路径。

**按声明的决定不在范围内**（ADR 0053 第 5 项）：“Ativar execução”按钮更换所有者。同一项也声明过的、经由 `delegations` 表以 `area = "dev"` 进行的 Dev Lead → `dev-<modulo>` 委派，**已不再**超出范围——由 ADR 0094 关闭（fluxo.yml × 代码审计，第 2 波，RN-405）。按钮仍可撤销；执行仍走当前路径，gate 之后的修正仍直接交给打开 PR 的 dev。

## 第 15 阶段——2026-08-07 完成（gate 作为数据） {#fase-15--concluída-em-2026-08-07-gates-como-dado}
没有**新的** gate。该阶段把产品中**已经**隐式存在的 gate 提取到 docs/gates.yml 中，附带脚本验证和严重程度，与 docs/.docmap.yml 的精神相同。尚不存在的 agent gate（dev-lead、platform）以引用 backlog 的 `status: planned` 进入——从不是 active。gate 的外部契约**不**变。

### 15a——完成：声明式注册表 {#15a--concluída-registro-declarativo}
1. 包含现有 gate 的 docs/gates.yml（参见扩展了 ADR 0048 的 ADR 0054——event log 中的决定正是让 gate 的通过变得可测量的东西），schema 由测试校验。
2. api 中读取注册表的加载器；内部读取 endpoint。
3. 脚本 `pnpm --filter api validacao:gates`，从 event log 中提取每个 active gate 的最后一次通过，如果某个 `block` gate 没有脚本验证的证据就以非 0 退出。

并非每个 gate 在 event log 中都有证明，注册表会说明证明在哪里：`merge-protegida` 由**测试**保证（decide.ts 中的锁不发出自己的事件），`backmerge` 是 CI，状态在 .release/gate.json 中。因此每个 gate 都声明 `evidencia: event_log | teste | ci` 及其定位器——把它们降级为 `warn` 就是在产品最硬的锁上撒谎。

### 15b——完成：消费 {#15b--concluída-consumo}
4. 团队面板显示每个故事/PR 正在等待的 gate，派生自注册表（而非硬编码）。
5. docs/explanation/gates.md 解释该机制，纳入 docmap。

## 第 15 阶段之后——2026-08-08 完成（v2.5.0 和 v2.5.1） {#pós-fase-15--concluído-em-2026-08-08-v250-e-v251}
这不是计划中的阶段：它是第 15 阶段之后**使用**中发现的东西，之所以放在这里，是因为每一项的来源很重要。这些都不是来自脚本——而是来自在 Chrome 中浏览应用、阅读安全面板。

**UI 缺陷，浏览时发现**（RN-088..091）：
- `429` 会变成**白屏**，而应用以更多流量回应。规则变成了通用的：每个界面都区分**三种**状态——加载中、错误（带 `trace_id` 和按钮）和空。`if (!dado) return null` 会把三者合而为一。
- 仪表盘为每个项目发一次请求：**3.824 → 12 req/min**，借助
  `GET /workspaces/:id/projects-summary`。铃铛是缺失的另一半：每个周期 **289 → 一次**请求（RN-090/091）。

**安全加固，两个面板都清零**：
- ADR 0058——api 上封闭的 CSP（`default-src 'none'`），修订了 ADR 0027 的第 7 项；以及被限制在根目录内的 `projectId`（RN-092），它影响的不只是 `permissions.json`，还有**授权**终端的范围。
- ADR 0059——生产中没有默认值的 `GIT_OAUTH_STATE_SECRET`（RN-093）。默认值是**公开**的（`.env.example`），生产 compose 把它作为回退值提供：要求“非空”什么也抓不到，因为在真实的出错路径上该变量是**已定义**的。
- 站不住脚的告警被附上书面理由**驳回**，从不静默——而驳回是用户的决定，不是 agent 的。

**三条耗费了 CI 周期、值得作为规则的运维教训：**
1. **PR 上的 CodeQL 绿色不能证明旧告警已关闭**——PR 检查报告的是**新**告警。告警在**默认**分支的扫描中关闭，也就是说，只有在修复到达 `main` 之后。
2. **Gitleaks 扫描的是 `refs/heads/*` 可达的提交，而不是目录树。** 一个高熵值只要提交过一次，就会让那个分支的 CI 永远失败；在其上修正**不能**清除它。出路是让该提交变得不可达（从 `dev` 重建，并在打开新 PR **之前删除**旧分支）——绝不用 allowlist，那会让扫描器在那个路径上对所有提交失明。PR 的 ref 不在范围内。代表机密的 fixture 从一开始就**不带**熵。
3. **位于另一个函数中的屏障，CodeQL 看不到**——这就是三个 `js/path-injection` 在修复后仍然存在的原因。保留了集中检查（RN-092），在面板上付出代价：在每个调用方重复它，就会成为某天出现分歧的检查。

## 16–26 计划——浏览所要求的（执行中） {#programa-1626--o-que-a-navegação-pediu-em-execução}
十一个请求，诞生于数据库重置后对应用的**第一次**真实浏览。这不是脚本：这是使用。调查中的三个发现定义了计划的规模和**顺序**，值得逐一记录，因为它们都不在原始请求中：

1. 在 `design_handoff_brabo/` 中存在一个**完整**的设计 handoff——8 个高保真界面、token、字体和品牌。决定是**完整**且**首先**采用它：这样十一个请求从新视觉中诞生，而不是做两遍。
2. Code 标签页的终端成了**架构**决策。每个项目都拥有自己的容器，由 **Arquiteto** 决定镜像。在容器内 agent 是自由的；`git push`、PR 和部署仍由人负责。这偿还了产品最大的未清债务——如今 agent 在与 Brabo monorepo **相同**的容器中执行，而 ADR 0055 自己也说它是策略，不是隔离。
3. 途中出现了两个真实缺陷，没有一个是被请求的：`agent_areas` **从未**被写入（`upsert` 没有调用方，API 返回 `[]`），铃铛的抽屉在 SQL 中按 `seq ASC` 排序——显示的是**最旧**的。

执行上限：最多**四个**并行子 agent。阶段按**争用的文件**切分，而不是按主题——这正是让并行成为可能的原因。后端的限制因素是 `apps/api/src/db/migrations/meta/_journal.json` 和 drizzle 的快照：每一波**一个** migration，因为手工解决快照冲突是走向 schema 分歧的道路。RN 区间和 ADR 编号在波次开始前**预先分配**：两个并行阶段都写 `RN-094` 会导致其中一个在合并时重新编号，而重新编号的 RN 会破坏 `pnpm docs:check` 会判定失败的 `#rn-0xx` 链接。

### 第 16 阶段——完成：基础（解锁并行） {#fase-16--concluída-fundações-destravar-o-paralelismo}
十一个请求中没有一个在这里交付。这个阶段之所以存在，是因为其中三个触及 `router.tsx`/`ProjectPage.tsx` 中**相同**的四个点，另外三个则卡在缺少公共部件上。没有它，各波次会退化为串行执行。
1. `design/tokens.css` 获得 `--violet`（agent/AI）以及 handoff 定义的其他内容。字体**继续**自托管——在这一点上照搬 handoff 会让应用在 nginx 的 CSP 下坏掉（ADR 0036）。对比度测试覆盖新的配对，已知的 4 对欠账仍被锁定。
2. 标签页不再是在**两个**地方的封闭列表：唯一的注册表，`PROJECT_TABS`、`type TabKey`、标尺和渲染都从它派生。测试会在一个地方有键而另一个地方缺失时失败——这正是真实的缺陷。
3. 设计系统中的 `Disclosure`，语义取自已有的最完整实现（`ModelCatalogSection`）。**只是组件**：六个临时实现都不在这里迁移，否则这个阶段会打开计划中争用最激烈的三个文件。
4. 会话标签变成辅助函数，五处内联的 `slice(0, 8)` 迁移过去。正是这次迁移让第 20 阶段不与第 19 阶段冲突。
5. `CLAUDE.md` 进入完成的定义（参见文档一节），在 docmap 中带 `warn` 规则。**已交付**：该规则是 docs/.docmap.yml 中的 `claude-md`，由 `package.json`、`pnpm-workspace.yaml`、`apps/*/package.json`、`apps/engine/mix.exs`、`docs/adr/*.md` 和 `docs/gates.yml` 触发——这里曾经的那句“如今它的覆盖为零”描述的是阶段**之前**的状态，此后一直在撒谎。

### 第 17 阶段——完成：符合 handoff 的 8 个界面 {#fase-17--concluída-as-8-telas-conforme-o-handoff}
视觉保真**先于**行为，以免返工。没有任何业务规则改变：如果某个界面需要不存在的数据，就成为已声明的待办，而不是搭便车的功能。
6. 登录和应用/项目列表。
7. 项目和会话，保留 RN-088 的三种状态（错误先于空）。
8. 审批和配置——审批是第 19 阶段的视觉基础。
9. 保真已经实现的证明：在 token 上测量对比度，并在**所有**触及的界面上用 `scripts/dev/validacao-visual.js` 验证布局。`.dc.html` 是参考，**不是**要复制的代码——handoff 自己的 README 就是这么说的。

### 第 18 阶段——完成：领域存在于数据库中（缺陷，提前修复） {#fase-18--concluída-a-área-existe-no-banco-defeito-corrigido-antes}
10. `AgentAreaRepository.upsert` **没有任何**调用方，因此四个用例都在空表上运行。在创建项目时置备 + 回填，并用测试证明新建的项目**有**领域——这与第 14d 阶段是同一种失败：测试零件不等于测试通往它的路径。
11. 把领域列表的**三份**副本（api、web、engine）合并为一个来源。

### 第 19 阶段——完成：能读懂的审批 {#fase-19--concluída-aprovação-que-se-lê}
12. 去掉 `ApprovalCard` 的通用回退，它会倾倒
    `chave: JSON.stringify(valor)`——这很可能就是“难以阅读”的原因。每个类型都获得一句 pt-BR 的**句子**；没有句子的类型显示动词 + “ver detalhes”，原始 payload 以**折叠**状态出现，绝不倾倒。
13. 在**三个**地方折叠：审批、Insights 和聊天中的卡片，动词和句子来自**一个**模块。
14. 项目约束：折叠**不**为 `ApprovalCard` 引入新的必需 prop。正是这一点让 `SessionPage.tsx` 保持不动，并消除了与第 20 阶段的交叉。

### 第 20 阶段——完成：会话获得身份 {#fase-20--concluída-a-sessão-ganha-identidade}
15. `sessions` 在**同一个** migration 中获得 `kind` 和 `name`——同一张表上的两个 migration 会在 journal 和快照中冲突。
16. 与基于事件的派生调和：`kind` 分类的是创建时的**意图**，`execution.activated` 继续分类执行的**状态**，两者互不改写。咨询型会话中的 `execution.activated` 是显式错误，而不是静默转换。
17. 重命名时保留 hashtag；没有名字时，退化为只显示它。
18. 返回仪表盘的按钮——如今 `SessionPage.tsx` 既不导入 `Link` 也不导入 `useNavigate`，**没有任何**导航能离开这个界面。目标在之后一轮中修订：按钮返回会话所属的**项目**（`/projects/:projectId`），而不再返回根仪表盘——会话总是诞生在某个项目之内。

### 第 21 阶段——完成：事件的数量（RN-099/100） {#fase-21--concluída-o-volume-de-eventos-rn-099100}
19. `useSessionEvents` 仍然是**当前状态**（`latest`，四个使用方：名册、树、执行、审批）。**历史**变成了 `useSessionEventHistory`，只用于活动，使用 endpoint 本来就返回的 `afterSeq`。没有新路由，没有新参数。锚点是**尾部**，而不是会话的开头：endpoint 向前分页，不存在 `beforeSeq`，但在一个有数千事件的会话中从第 1 个事件打开动态，交付的是错误的界面。所以第一页是同一个 `latest` 读取（**相同**的 `queryKey`，已去重），每次点击向后回退一个固定窗口。
20. 铃铛在 SQL 中按 `DESC` 排序。“已读”截断的语义**没有**改变，所以没有 ADR：按 `seq` 截断标记的是一个**前缀**，而抽屉显示的是一个**后缀**，所以没有按事件的已读表，就无法表达“标记显示出来的 50 条”。改变的是抽屉不再隐藏推进所吞掉的内容——按项目的总数、`+ N mais antigos`，以及说明会标记多少条的按钮。缺少的数字来自**减法**（`latestSeq` 减去截断点），而不是请求。
21. RN-090/091 的节省没有倒退：每个周期一次请求，第一次“加载更早的”花费为**零**——`latest` 读取带来 200 条，窗口显示 100 条。旧页面具有 `staleTime: Infinity` 且没有 `refetchInterval`：不可变事件上封闭的 `seq` 窗口不会改变。

### 第 22 阶段——2026-08-09 完成（面向两类受众的花费） {#fase-22--concluída-em-2026-08-09-gasto-com-duas-audiências}
作为**花费**标签页交付（ADR 0063，RN-101）。
22. 缺失的**聚合**进入了一个方法——
    `sumGroupedBy(dimensao, escopo)`，维度为 `model`、`project`、`actor`、
    `session` 和 `day`。`provider` **不是**它的维度，这种缺失是结构性的：按 provider 拆分就是按**凭据**拆分，正是这一点防止成员视图因疏忽而获得这个轴——根本没有可以传入的参数。
23. 没有图表库：每日柱状图和排行用内联 SVG。每日序列从 api 以**密集**形式返回（没有花费的日子以零进入），否则三周内的三次调用会变成三根挤在一起的柱子。
24. 冲突通过分离**问题**而不是筛选器来解决。按**凭据**的报告仍然只属于 owner（RN-060），并在旁边增加了 workspace 按模型/项目/行动者/日的拆分，同样是 `owner`。成员视图按**行动者**，以 token 和估算成本显示，不带 provider 也不带凭据——行动者取自已认证的 **token**，没有可以写入他人 id 的参数。agent 不计入成员的账：`token_usage` 记录的是谁花了钱，而不是谁下令花钱。

没有 migration，但**有**测量：在 52.5 万行时，查询以顺序扫描分别耗时 55 ms 和 38 ms，而在 `token_usage(created_at)` 上建索引会让它们降到 32 ms 和 19 ms。数字记录在 ADR 中；索引在有空位的那一波中加入。

### 第 23 阶段——2026-08-09 完成（可按领域继承的模型） {#fase-23--concluída-em-2026-08-09-modelo-herdável-por-área}
25. `area` 范围进入了级联（`会话 > agent > 领域 > 项目 >
    workspace`），位于 agent 与项目**之间**：它是 lead 与子 agent 共享的默认值，agent 通过覆盖它来分歧（ADR 0064，RN-102）。
26. 在编码**之前**解决的不一致：agent 的 binding 曾是**全局**的（`scope_id` = 纯 slug，自第 9a 阶段起忽略路由中的 `:projectId`），而领域自 ADR 0053 起是按项目的。按项目的范围位于全局范围之上，会让同一个 agent 只在有领域的地方解析出不同的模型。决定：agent 的 binding 也改为按项目——`agent`/`area` 的 `scope_id` 变为复合的 `<projectId>:<slug|chave>`
    （RN-103）——而不是把领域放在 agent 之下，那会违背“可继承的默认值”（如今几乎所有 binding 都是 agent 的）。
27. UI 显示谁在**继承**、谁**分歧**了（`ProjectSettingsTab.tsx` 中的 `AreaModelsSection` 和 `ModelsSection` 的来源列）；“恢复继承”是对 agent/领域 binding 执行 `DELETE`，从不把下一级的模型写进去——复制会变成在领域下一次变更时自行分歧的副本。修改领域的模型需要 `maintainer` 角色（与并行上限同一标尺，RN-083）；agent 的仍是 `developer`。

### 第 24 阶段——完成：聊天和 Criativo 作为场所（RN-104） {#fase-24--concluída-chat-e-criativo-como-lugares-rn-104}
28. **项目**界面上的两个标签页，各自列出其 `kind` 的会话，并以该 `kind` 创建而无需再次询问。会话仍然是独立的界面——标签页没有变成聊天容器。
29. 冲突的解决方式是让“会话”**离开**标尺。它留下的是深链接的**键**：聊天带有 `key: 'sessions'`，正是这一点让旧的 `?tab=sessions` 在聊天中打开并**选中**该标签页。只在面板中解析别名，会打开正确的面板却让标尺没有选中项，因为 `Tabs` 把 `active` 与 `key` 比较，而写 `active` 的是 `ProjectPage`——这一波保持关闭的两个文件之一。
30. **关于“Iniciar ideação”的结论**：它**保留**。问题的一半在第 20 阶段已经关闭（按钮从咨询型会话中消失，RN-097），另一半并不是冗余：正是它带来了 Criativo，从那时起才开始消耗 owner 的密钥（RN-058）。错的是**位置**——邀请花了一段文字去指向顶栏。现在，邀请在界面上时动作就**在邀请之内**，邀请不在时回到顶栏；`conviteVisivel` 是两者共享的唯一问题，以免重复出现或消失。

### 第 25 阶段——带裁剪地完成：每个项目一个容器（边界不再只是策略） {#fase-25--concluída-com-corte-container-por-projeto-a-fronteira-deixa-de-ser-só-política}
计划中最大的架构变更，也偿还了 B 和 F 阶段已分别指出的债务。交付了 25a（Arquiteto 的决定和闸门）和 25c（外部效果边界）；25b（容器生命周期）被**裁剪**并声明——而不是实现一半（ADR 0065，RN-105 和 RN-106）。
30. 完成：**Arquiteto** 决定为项目启动哪个镜像，作为它的产物（event log 中的 `artifact.project_image`，版本化，无表）——可审计，而不是隐藏的配置。在它决定之前，Code 标签页返回 409 且不放行（RN-105）。
31. 当时**未交付**，已声明：按项目的生命周期（置备、回收、清理、真正施加的资源上限），agent 的 worktree 位于容器之内。容器状态是**可变**的，需要自己的表——仅仅为了不等待 migration 空位而在 event log 中临时拼凑，紧接着就会需要修正。
    被**部分撤销**——由 28 计划第 4 波/F1 前线：状态**表**（`project_containers`，ADR 0081）到来了。仍然缺失、不打折扣的是让这张表有意义的那一半：还没有任何真正的编排器调用 Docker，agent 的 worktree 仍在容器之外。终端策略中“容器内 agent 是自由的”那一半**仍未**改变——在容器真正启动之前，ADR 0055 照常有效。
32. 当时完成，后由本地 runner **修订**（ADR 0102/0103，RN-418）：外部效果的边界。`git push`、PR 和部署不能通过终端发出——即使在项目范围之内——当时的规则**是** `deny`
    （不是 `require_approval`，因为“sempre permitir”），消息会重定向到**类型化**的动作（`git_push`/`git_merge`/
    `pr_open`），后者以 `proposed_action` 诞生（RN-106，已修订）。`deny` 变成了**绝对上限**（无条件的 `require_approval`，绝不可自动批准）——产品所有者的决定，“sempre permitir”在源头关闭，以免它变成装饰（参见本地 runner 一节）。受保护分支上的合并仍是手动的（RN-014），未受影响。网络和花费在镜像的**产物**中有自己的结论（`network: none`/`egress`，cpus/内存/pids 上限会拒绝而不是静默降级）——一次性决定，而不是逐条命令，原因与 Z 和 AD 证明动词 allowlist 不收敛相同。Z 和 AD 本身的关闭取决于 25b（物理隔墙），而它尚未启动。

### 第 26 阶段——完成：Code，只读 {#fase-26--concluída-code-só-leitura}
33. 完成（26a）：`GitProviderContract` 获得了 `listTree` 和 PR diff（第 11/12 个操作），capability **只**在测试套件证明时才声明。
34. 完成（26b）：`code.controller.ts` 的四个路由——树、文件、搜索和 diff——位于 RN-092/095 的**集中**检查之后，搜索带有上限和缓存（搜索是**组合**操作，不是契约中的操作）。
35. 完成：界面（`ProjectCodeTab`/`code/*`），在 `project-tabs.ts` 中注册，无需触碰 `router.tsx`/`ProjectPage.tsx`。侧栏（资源管理器/搜索——唯一有真实数据的两个），按**目录**加载的资源管理器，带面包屑的编辑器标签页，带 `filesScanned`/`truncated` 的真实搜索，按已知 id 的 PR diff（`patch: null` 被当作“没有文本”，从不是“没有变化”）。语法高亮是基于正则的**自有**分词器（`code/highlight.ts`）——**零**新依赖，相比 Prism/highlight.js/Shiki 为标签页所需功能要付出的 15-90 KB；三个新的颜色 token（`--syntax-function/
    -comment/-operator`）在**两个**主题下针对 `--code-bg` 校准到 4,5:1。RN-088 的第四种状态——被 Arquiteto 的待决事项阻塞（RN-105）——成为 RN-107，在尝试读取代码**之前**询问，被阻塞期间每 15s 自行重新查询。

    **已声明**的待办，背后没有真实数据：交互式终端（第 25b 阶段，仍被裁剪——标签页中诚实的空状态）、blame、标签页内的 PR 列表（diff 只能通过来自审批的已知 id 访问）以及问题/lint/测试面板。行虚拟化当时也被排除——handoff 本身称代码标签页为“计划中代价最高的”；每个文件 512 KB 的上限（`GIT_BLOB_MAX_BYTES`）在那之前限制了最坏情况。由 28 计划第 4 波/E2 前线**关闭**（RN-239..242）：只有可见窗口会变成 DOM 节点，迷你地图复用同一次分词而不需第二遍。

### 第 26b 阶段——完成：blame 基础、可浏览的 PR 和丰富的分支 {#fase-26b--concluída-fundação-de-blame-prs-navegáveis-e-branch-rica}
该阶段一开始**只有** API 层，这里曾留下的“没有 UI”一句描述的是**第一批**的状态——它过时了，开始误导人。**三个** UI 都已存在：丰富的分支下拉框（第 38 项，`CodeBranchPicker.tsx`）、按需 blame 开关（`CodeEditor.tsx`，RN-113）和标签页内的 PR 列表（`CodeDiffPanel.tsx`），后两者在 v3.0.0 中交付。blame、丰富分支下拉框和 PR 列表这三项已声明的待办，如果由并行 agent 分别处理，会触及**相同**的文件（契约、三个 provider、用例、controller、契约测试套件）；决定是一次性把三者一起交付，把每一项的 UI 留给后续三个 agent，没有冲突风险。
36. `GitProviderContract` 获得了 `blame`、`listPullRequests` 和
    `listBranchesDetailed`（第 13、14、15 个操作——RN-110/111/112），capability 只在契约测试套件针对三个 provider 证明时才声明（`local` 针对真实 git；`github`/`gitlab` 为 mock——真实 smoke 在环境中没有 `GITHUB_TEST_TOKEN`/`GITLAB_TEST_TOKEN` 时仍被跳过，与第 13a 阶段情况相同）。`listBranchesDetailed` 是**独立**操作，而不是 `listBranches` 的扩展（RN-112）——丰富信息需要对 provider **每个分支**多调用一次，而 `listBranches` 仍是 Gitflow bootstrap 使用的那个，不承担这一成本。
37. `code.controller.ts` 中的三个新路由（`GET .../code/blame`、
    `GET .../code/pull-requests`、`GET .../code/branches`），与之前四个相同的 `role:
    viewer` 和相同的集中路径检查（RN-095）。`apps/web/src/lib/api-client.ts`/`api-types.ts` 获得了对应的函数和类型（`getCodeBlame`、`getCodePullRequests`、
    `getCodeBranches`）供下一波使用——`CodeShell.tsx` 和
    `CodeDiffPanel.tsx` 除了记录基础已存在的注释外**没有**被触碰。
38. 完成：丰富的分支下拉框（RN-112）——`CodeBranchPicker.tsx`，从 `CodeShell.tsx` 打开，把简单的文本框换成一个选择器，列出每个分支相对于默认分支的 `ahead`/`behind` 以及关联的 PR（如有，`aberta`/`mesclada`/`fechada`）。列表之外的 ref（tag 或 sha）仍可访问——`listBranchesDetailed` 不枚举这两种，所以下拉框底部有一个手动输入框。

**计划的冻结：**每个阶段都声明它不做什么，最严格的是第 26 阶段——代码**只读**，不能通过标签页保存。编辑是后续阶段，到时写入是外部效果：以 `proposed_action` 诞生。

## 16–26 计划之后——使用随后提出的要求（RN-148） {#pós-programa-1626--o-que-o-uso-pediu-depois-rn-148}
与第 15 阶段之后同样的精神：不是计划中的阶段，而是**使用**所要求的。PO 一次产出多个故事时，同时待推进的故事（RN-048/RN-126）会在 PO 会话的时间线上变成 N 张零散卡片。`Carousel`（`apps/web/src/components/ui/Carousel.tsx`）是设计系统中第一个逐项导航的组件——2 个以上的待办变成**一个**可导航的轮播（箭头、圆点、键盘），“Aprovar todas”在一次调用中推进整批（`promoteStories` 本来就是批量的，契约不变）；1 个待办仍是一贯的简单卡片。何时形成一“批”在每次渲染时重新评估——即会话中**仍待处理**的推进集合，而不是“连续不间断地创建”——这样在轮播中途解决一个故事会自动重新计算这一批，无需同步自身状态。

**本地项目或容器项目（RN-169/RN-170，ADR 0072）。** 产品所有者的请求：“越过只在容器中写代码的边界，能够从用户的目录写代码”，他选择了**自由输入路径**的变体，并清楚它只有挂载到容器中才能工作。`projects` 在 migration
`0043` 中获得（`workspace_mode`、`workspace_path`），默认 `container`——不选择的人什么都不变。ADR 0072 **修订**了 0065 的一部分，并触及 0055 的领域，它们曾决定相反的方向（容器隔墙），因此后果被如实写出，不打折扣：`join(env, coluna)` 的**结构性**约束——任何损坏的列都不会逃出受管根目录——对本地项目不复存在，剩下的是创建时的守卫加上读取时的词法再校验。第 25b 阶段仍被裁剪：本地项目在今天的**同一个**容器中运行，只是目录变了。

**Arquiteto 的 C4 图（RN-149，ADR 0068）。** 新的交付物：
`create_c4_diagram` 以 Mermaid 生成 Context + Container（Simon Brown），在概览中渲染。Container 层由用例从当前的 `module_map` **派生**——从不由模型重新输入——以免开启一个与第一个来源分歧的第二来源；只有 Context（系统名称和外部参与者）来自工具调用。`artifact.c4_diagram` 是无表的产物，在 event log 中版本化，与 `artifact.project_image` 的设计相同（ADR 0065）。`mermaid` 作为 `apps/web` 新的**运行时**依赖进入——同类中的第一个（文档站点已经使用 Mermaid，但在构建时）——隔离在 `apps/web/src/lib/mermaid-render.ts` 之后，通过动态 `import()` 加载；`vite build` 确认只有入口点是即时加载的，Mermaid 的大块按需加载，并且没有一个使用 `eval`/`new Function`——ADR 0058 的封闭 CSP 保持完好，配置无需改动。

## exp003 轮次——完成（RN-150..162，PR #278–#293） {#rodada-exp003--concluída-rn-150162-prs-278293}
这不是阶段：这是**使用**在 `exp003` 项目的一次现场测试会话中发现的 17 个问题，按**争用的文件**分五个顺序波次修复——其中四波汇聚到 `SessionPage.tsx`，迫使串行化。来源值得一提：没有一个是由测试发现的。

**这一轮教会我们的、比清单更有价值的东西**：最大的修复（RN-155）对任何测试套件都不可见，因为缺陷在于比较两个**不同**的数值空间，而它们碰巧都是 `number`——`event.seq`（无间隙，按**会话**）与 `action.seq`
（`proposed_actions.seq`，整张表的全局 `bigserial`，由系统中每个项目和每个会话共享，并在 schema 中被记录为有意的对照）。只有在表还小时，顺序才看起来是对的。修复没有发明新字段：它使用了 `ProposeActionUseCase` 已经在**同一个**事务中写入的 `proposed_action.created` 事件，其 `payload.actionId` 指回该动作。

**engine 与受控读取（RN-150）**——`search_workspace` 返回**所有**命中，没有上限：这是在修复 `read_file` 之后，PR 审查中 `413` 的第二个真实原因。两个**独立**的上限，因为搜索会以两种方式溢出——命中数量（`SEARCH_WORKSPACE_MAX_HITS`，500，作用于一个在 `max_hits + 1` 处**停止**扫描的 `Stream`）和最终文本的字节数（`SEARCH_WORKSPACE_MAX_BYTES`，32.768）。独立的变量，不复用另外两个：同一类溢出，调整一个不应要求触碰其他。截断标记是写给**模型**的（让它细化搜索词），从不编造总数，因为统计总数会再次付出上限所要避免的 I/O。

**会撒谎的数字（RN-151）**——侧栏中项目的徽标统计的是**任何**未读事件：`exp003` 显示 392，而同一项目的审批标签页显示 8。一个点击后不对应任何可操作内容的数字，比没有数字更糟。它变成了已有读模型（RN-090）中的 `pendingApprovalsCount`，在 `Promise.all` 中多一个聚合——从不 N+1。

**agent 产出的可追溯性（RN-152）**——Code 标签页下拉框中的 `feature/task-XXXXXXXX` 分支开始说明它属于哪个 dev agent 和模块。模块取自当前的 `module_map`，经由生成它的**同一组**函数，从不对名字做反向正则；没有关联时，退化为 `null` 而不是猜测。

**自动模式（RN-153/154，参见约定）**——通配符 `actionType: "*"`。重要的是它所在的位置：解析属于**仓库**（`findMode`），`decide.ts` 没有增加一行——正是这一点让三个绝对上限**从构造上**成立，而不是靠又一个某天有人会忘记的 `if`。

**能读懂的会话消息流（RN-155..159）**——排序（见上）；5s 指示器使用固定文本 "Reunindo informações..." 而不是插入 agent 名称，后者已出现在标题中（RN-156）；PO 创建史诗/故事变成紧凑提示，而不是与真正回复同等视觉权重的气泡（RN-157）；聊天中带高亮的轻量 Markdown，用**自有**正则解析器，零新依赖、没有
`dangerouslySetInnerHTML`，并且只渲染 agent 的**输出**——人输入的内容保持字面（RN-158）；以及按 agent 分组、使用 RN-138 的 `Disclosure` 的“Artefatos gerados”，每个产物都导航到它所在的位置（RN-159）。module_map/C4 按已记录的决定被**排除**：它是项目的**当前**状态，而不是按会话标注日期的产物。

**权威顺序（RN-160/161，ADR 0069）**——“Confirmar arquitetura
pronta”只在至少有 1 个**已推进**的故事时启用（仅有已捕获的规则还不够）；而当接受者的有效角色已经授权时，接受交给 Dev Lead 的 handoff 会串联激活执行。合并只发生在客户端：后端仍然要求 `maintainer`（RN-137），所以它省去了一次多余的点击，而没有移动授权边界。

**结构化输入（RN-162）**——Criativo 的 `ask_structured_questions`：模型以 schema 声明问题，表单由
`StructuredQuestionCard` 渲染，回答**复用** `SendAgentMessageUseCase`，而不是开辟第二条消息路径。回答是一次性动作——重新提交是 409，而不是覆盖。

## exp001 轮次——Criativo 兑现承诺（RN-163） {#rodada-exp001--o-criativo-cumpre-a-promessa-rn-163}
与其他轮次同样的精神：来自**使用**，而不是脚本。报告是“Criativo 在说它会修正并重试之后没有回应”，而这句话在代码中是字面成立的——`run_turn_capturing/1` 调用模型**一次**，分派工具，然后返回。工具的结果进入内存中的历史，再也没有人读取，所以承诺的修正只有在用户再发一条消息时才会发生。

Criativo 是唯一没有 tool use 循环的对话型 agent；它获得了与 PO 相同的循环，自己的上限为 12。修复之外的价值：**决定宣布什么的变成了上限**，而不是固定文本——只有在还有回合可以兑现时，重试的承诺才会出现在句子中。上限耗尽变成了被叙述的 `agent.error`（`po_server` 在这种情况下会沉默结束，这是下一个显而易见的债——紧接着由 RN-166 关闭），工具失败不再是 `agent.response`
——在 event log 中它与正常回复无法区分，也不说明任何来源，这正是 RN-059 为回合失败所关闭的问题。

## exp001 轮次——PO 读取已有内容并被督促（RN-164..166） {#rodada-exp001--o-po-lê-o-que-já-existe-e-é-cobrado-rn-164166}
这不是阶段：这是真实**使用**发现的缺陷，来源很重要，因为任何测试套件都抓不到。backlog 产出了史诗而**没有任何故事**——因此没有任务，因此执行被卡住而**没有任何错误**。调查发现四个叠加的原因，前三个其实是同一个：PO 没有办法知道，也没有办法提醒。

1. **PO 有四个工具，全部是**写入**工具。** 上下文只在 kickoff 时组装**一次**，取自**会话**最近的 200 个事件——此后它再也不重新读取任何东西：它不知道存在哪些规则、已覆盖了哪些，甚至不知道自己已经创建了什么。加入了
   `listar_regras_de_negocio` 和 `listar_backlog`（RN-164），由两个限定在**项目**范围的内部路由提供——范围正是要点：按会话读取恰恰是之前隐藏已捕获规则的原因。它们复用已有的管道（`listByTypeForProject`、`ListBacklogUseCase`、
   `computeCoverage`）；缺的是路由、客户端中的方法和工具。
2. **史诗之后没有任何东西督促故事**，并且**循环沉默地结束**。没有故事的史诗变成了**显式**结果——`backlog.epic_without_story`，持久化，遵循 RN-059 的模式（RN-165）——`PoServer` 的迭代上限开始发出 `toolloop.limit_reached`，与 `ToolLoop` **相同**的类型，而对话型 agent 因为有自己的循环从未发出过它（RN-166）。
3. **kickoff 指令对信息缺失时该怎么做只字未提**——面对没有指令的缺口，模型只能在编造和停止之间选择。它选择了停止。第三条出路被写了下来，并附上行使它的工具：`ask_structured_questions`，与 Criativo **相同**（RN-162），现在也提示给了 PO。

两个超出本案例价值的设计决定：只有**成功的** `create_story` 才能清偿史诗的义务（被 api 拒绝的故事什么也没覆盖，把它当作覆盖了就是用一种沉默替换另一种）；督促按**发生次数**进行，只报告一次，从不是每个回合都重复、直到有人学会忽略它的告警。

## exp001 轮次——消息流按回合发生的方式阅读（RN-172/173） {#rodada-exp001--o-fio-se-lê-como-o-turno-acontece-rn-172173}
与其他轮次相同的来源：**使用**，而不是脚本。关于会话界面的四条抱怨——PO 的 handoff 出现在他最后一句话的**上方**，审批跳到 Arquiteto 回复的中间、直到他说完才落下来，审批卡片“排版糟糕”，以及滚动不跟随对话。

**调查发现排序是**正确**的**，这就是这一轮的教训。RN-155 忠实于 event log；日志说的是
`po_server.ex#run_turn/2` 在**同一次**迭代中先发出 `agent.response`，**然后**是 `offer_handoff` 的 `tool.call`，**之后才**递归进入收尾发言——因此 handoff 的 `seq` 确实**小于**最后一句话的。`proposed_action.created` 也一样。所以修复不在排序：它是一条声明的**呈现**规则（RN-172），在按 `seq` 的 `sort` **之后**的单独一遍中（`afundarDesfechos`）——而不是一个一年后没人能解释的三项比较器。

防止回合相互混合的是三道屏障，每一道都源于一个真实案例：**回合**（两个回合之间的边界可能没有**可见**的条目——`agent.activated` 打开回合，但不会成为消息流中的条目）、**作者**（在执行会话中，多个 agent 在用户一次都没说话的情况下写入，它们都处于同一个回合）以及**非结果**（两个连续的结果保持彼此之间的顺序——Infra 先于 Dev Lead）。

RN-173 关闭了另外两条抱怨，而它们其实是同一个：滚动效果只依赖 `[events.length, streamingText]`，而 `actions` 是一个**单独**的查询——一张卡片到来会把对话推出屏幕而不滚动任何东西。修正了依赖，并在内容上加了一个 `ResizeObserver`，用于**任何**依赖列表都覆盖不到的情况（`Disclosure` 的折叠、Markdown 的重排）。距离底部 120px 的守卫故意保持不变：消息流跟随对话，而不劫持已经向上翻阅的人的阅读。

## exp001 轮次——消息流说明谁在说话、用哪个模型、问的是什么（RN-171/174/175/176） {#rodada-exp001--o-fio-diz-quem-fala-com-qual-modelo-e-o-que-pergunta-rn-171174175176}
相同的来源：**使用**。关于会话界面的四条抱怨，其中三条共享同一个教训——**产品知道这个信息却没有显示**。

**问题居中，并且有出口（RN-171）。** 报告是字面的：“当用户选择 Escreva 时，总是给出用户输入的选项”。模型提供了“自己写”之类的选项，而表单没有可以书写的地方——`ask_structured_questions` 的 schema 无法表达“除了这些，你想要的任何内容”。`allowOther` 以**默认 `true`** 进入 `select`，这种不对称就是论据：因**遗忘**而封闭的列表会卡住对话，用户无法从外部解锁；被误设为开放的列表只是多提供一个输入框。界面的哨兵值从不传到后端，提交按钮仍要求全部填写（后端无论如何都会以 400 拒绝）。这个框也改为居中，采用 `ApprovalCard` 的 560px 上限并加上了头像：它曾是消息流中唯一不与任何东西对齐的条目。

**触发回合的动作会启动指示器（RN-174）。** “思考中”的动画早已存在——缺的是**覆盖**。界面上有两个动作会在 engine 中触发同步回合，却什么也不开启：回答表单
（`AnswerStructuredQuestionUseCase` 复用 `SendAgentMessageUseCase`）和把故事退回给 PO（`ReturnStoryUseCase` 调用 `reviseStory`，即
`handle_call({:revise, …})`）。Phoenix 通道无法填补这个空洞：在 join 仍在进行时（RN-108），"working" 的 `agent.status` 没有监听者，会丢失。

**模型，对所有人（RN-175）。** 缺陷属于 PO 的前提站不住：四个对话型 agent 自 RN-146 起就记录 `modelName`，测试为绿色。从未记录的是 **`ToolLoop`**——每个执行型和 gate agent 的路径——以及 api 中没有活跃 agent 的聊天。没有新调用：`RunLlmTurnUseCase` 本来就在响应体中返回该字段。界面不再写一个孤零零的“modelo”一词（读起来像是模型就叫这个名字），而是变成可读的标签；没有数据时，它会**说明**未记录——按当前 binding 猜测，会把一个可能根本不存在的模型归给旧回复，这与 RN-044 的冻结价格所避免的错误相同。

**Markdown 中的表格成为表格（RN-176）。** 有两种可能的出路，选择的是在聊天的 Markdown 中支持表格，使用设计系统的 `Table`。在消息流中渲染 `artifact.module_map` 被一个已记录的决定**拒绝**：它是项目的**当前**状态，不是按会话标注日期的产物（RN-159），它位于概览中。此外，请求针对的是**消息之内**的表格——修复服务于任何写表格的 agent，而不只是模块地图。分隔行仍然是必需的（GFM），所以带有 `|` 的散文永远不会被误当作表格。

## exp001 轮次——面板会分组、排序，并说明它没有显示什么（RN-177..181） {#rodada-exp001--o-painel-agrupa-ordena-e-diz-o-que-não-mostra-rn-177181}
与其他轮次相同的来源：**使用**，而不是脚本。关于会话的上下文面板和日志的五条抱怨，这一轮的教训只有一个——**面板把一个切片当作全部来显示，而且同时在三个不同维度上**：它隐藏了六种事件类型却不提供替代方式，按从旧到新的顺序阅读，并且在没有说明的情况下把会话截断在 200 个事件。

**来源作为新的分类（RN-177）。** `ActivityKind` 回答“事件谈论的是什么**主题**”，决定图标和颜色；`origem` 回答“它来自哪一**层**”，正是它让历史可读——`eventos`、`sistema`、`llm`、
`harness`、`agente`、`usuario`，派生自**存在**的数据（`actor.kind` 和 `type` 的前缀）。优先级让它可预测，体现在 `if` 的顺序中：机制胜过行动者（一个 `tool.call` 属于 harness，不管是谁），行动者胜过 agent 前缀（`chat.message` 在两边都存在）。最近的 5 个保持展开，其余按来源折叠，**在两个地方都是如此**——日志面板和消息流，在消息流中轴是反向的（消息流是升序的，所以历史在**顶部**）。机器噪声过滤器**仍然默认开启**：它的理由没有变（193 个真实事件中有 116 个），变化的是它成了一种**选择**，而不是既成事实。

**顺序和分页（RN-178）。** 四个部分都改为降序，“Carregar mais antigos”按钮也因此换到另一边——还是之前的论证，只是符号反了过来。超过 5 条的业务规则会分页，页码通过 *clamp* 而不是同步副作用来解析。

**PO 的树（RN-179）。** `backlog.task_created` 从未进入面板；现在史诗 → 故事 → 任务形成一棵树，依据事件本身已携带的**关联**（`epicId`/`storyId`），从不依据日志中的邻近关系——父节点未加载的节点会上升到根部，而不是靠猜测挂上去。

**开始显现的上限（RN-180），这是最有价值的一项。** 面板通过 prop 读取 200 个事件，无法说明还有更多。它改为读取 RN-099 的分页历史（与尾部相同的 `queryKey`，**零**额外请求——RN-090/091），获得了 `ActivityFeed` 一直都有、但没有任何调用点传入的分页器，注释通过对 `seq` 做**减法**统计还缺多少，就像 RN-100 的铃铛一样。派生部分读取 `baixados`（已经到达的全部内容），而不是动态的窗口，否则它们会显示得比之前**更少**。

**消息流中的委派（RN-181）。** `delegation.completed|failed|dispensed` 只存在于日志面板中：gate 打开又关闭，而没有任何迹象表明底下发生过第二次尝试。它们变成了 RN-157 格式的紧凑提示，句子来自 `classifyEvent`——与面板中相同。领域的外部契约不变（ADR 0038）：消息流叙述 lead 记录的内容，而不是开始直接寻址子 agent。

## 28 计划——第 1 波，A 前线：主题不再无法访问（RN-182..185） {#programa-28--onda-1-frente-a-o-tema-deixa-de-ser-inalcançável-rn-182185}
浅色主题存在于 `design/tokens.css` 中，有奇偶测试，并且在 `design/README.md` 中被描述得像是一个界面——而**`apps/web` 中没有任何东西写入 `data-theme`**。看到它的唯一方法是在 DevTools 中手动输入该属性。两个对比度测试都知道并说了出来：其中一个用 `expect` 断言浅色主题中有**三**对不通过，“是对所继承内容的记录，而不是对所渲染内容的保证”。在此期间，这个论证是诚实的——测量一个谁都打不开的界面，就是在测量一个意图。随着主题按钮的到来，它的符号反了过来。

**启动是一个**文件**（`apps/web/public/theme-boot.js`），在 `<head>` 中同步执行，在 bundle 之前。handoff 要求使用**内联**脚本；镜像在 `script-src 'self'`（ADR 0058）下提供服务，所以内联在 `pnpm dev:web` 中能工作，在生产中却会被阻止——换了主角的 ADR 0036 式失败。`tema.ts` 是 shell 使用的 API；按钮不在其中。会抛异常的 `localStorage` 退化为“绘制但不持久化”，未知值退回到默认值。

**浅色主题的六个 token 改变了值**（ADR 0074），因为浅色中要求最高的背景是纸质的 `--code-bg`：accent 3,56 → 4,81，warning
3,15 → 4,98，success 3,89 → 5,12，violet 4,16 → 4,95，text-muted 2,76 → 5,17，再加上低一级的 accent-hover。**深色**主题没有改变任何一个，它的欠账仍锁定在同样的五个数字上。记录了两个副作用：在深色中属于欠账的五对在浅色中**通过**，而“设计系统的已知例外”（`--accent` 上的 `--on-accent`，3,20:1）在浅色中消失——测试注释所描述的修复，即加深到 `--terracota-500`，正是浅色主题现在所做的。

**handoff 的八个 `--syn-*` 值中有五个因测量而被**拒绝**（最差的 `--syn-cm` 在浅色中只有 2,32:1）。handoff 不通过的地方，以测得的数字为准：这与字体是同一把尺。八个角色以 `--syntax-*` 前缀开始存在；仍在着色的五个语义 token 被测量后放在它们旁边。

## 28 计划——第 1 波，D0 前线：按 provider 的花费（RN-186..188） {#programa-28--onda-1-frente-d0-gasto-por-provider-rn-186188}
**约束改变了性质，这才是重要的——而不是新的轴。**
`provider` 重新成为 `sumGroupedBy` 的维度，根据产品所有者的决定修订了 ADR 0063。之前，成员够不到按**凭据**的拆分，因为它不存在——ADR 0063 写道“没有可以传入的参数”。现在它存在了，约束它的是**类型**：两个重载，而携带 `actor` 的范围（成员视图唯一的范围）只接受
`Exclude<SpendDimension, 'provider'>`。保证从“无法表达”变成了“无法编译”，后者更弱——这就是为什么屏障有**两道**且相互独立：成员的路由也没有任何维度参数。故意没有任何针对该组合的 `if`（与 RN-153/154 相同的教训），证明是通过**反转**完成的：没有 `@ts-expect-error` 时，`tsc` 会在确切的行上报 `TS2769`。

`porOwner`/`porAgente` 是 `porAtor` 按 `actor_kind` 的划分，没有额外查询；`system` 不属于两者，仍计入总数。ADR 0063 测量并推迟的 `token_usage(created_at)` 索引进入了 migration `0044`。**界面**没有变化——那是后续的波次。

## 28 计划——第 2 波，H2 前线：不编造评分的模型排行（RN-210，ADR 0077） {#programa-28--onda-2-frente-h2-ranking-de-modelos-sem-nota-inventada-rn-210-adr-0077}
handoff 要求两样东西，它们都依赖产品所没有的**同一项**数据：按能力的质量评分（mock："código → claude-sonnet-4 /
qwen2.5-coder:14b (9.4)"），以及当模型覆盖“agent 所要求的所有能力”时在 `ModelPicker` 中显示“ideal”徽章。调查两次确认第二项数据不存在：`ModelsSection` 本身已因此把“Agente · capacidades”一列重命名为只有“Agente”，而 agent binding 的 `ModelPicker` 读取
`GET /projects/:id/models`（`viewer` 角色）——策展（`uses`，ADR 0051）只存在于 `ModelComCuradoria` 中，来自一个仅限 `maintainer` 的路由。徽章**没有**构建；“Melhores modelos por capacidade”表格**构建了**，使用两个真实信号：项目中已有多少 agent 通过级联解析到每个策展过的模型，以及作为平局决胜的目录成本——从不使用计算出的评分。
## 28 计划——第 2 波，B 前线：侧栏可折叠（RN-195..201） {#programa-28--onda-2-frente-b-sidebar-recolhe-rn-195201}
264px/62px，折叠时为图标轨道；可展开的项目会显示标签页（从 `project-tabs.ts` 读取，从不硬编码）；活动区按**真实**的基础 agent/实例分组——`extraDevAgentId` 的 `-2` 后缀，从不是编造的 `-01/-02` 计数器（第 1 波/B0 前线的发现）——并限定在当前路由的项目中，而不是全部，以免产生事件的 N+1。主题按钮在底部；两个无效的全局条目移除，只有项目和活动是全局的；代码标签页通过 `AutoCollapseContext`（`sidebar-state.ts`）自动折叠，不写入偏好。持久化集中在 `sidebar-state.ts` 中，即 handoff 的六个 `brabo.*` 键。

两处与 handoff 的分歧已记录且**未**解决（RN-197）：项目徽章仍然是 `pendingApprovalsCount`（RN-151 胜出，它更新），handoff 的身份颜色只出现在折叠的轨道中——展开的行只保留现有的状态圆点（RN-039），两个圆点会是噪声。
## 28 计划——第 2 波，C 前线：界面框架（RN-202/203，ADR 0078） {#programa-28--onda-2-frente-c-moldura-de-tela-rn-202203-adr-0078}
handoff 中“界面框架”检查清单的四项字面修正：
`.headerTop` 获得了 `min-height: var(--header-h)`——下限，而不是上限，因为项目的标题（身份 + 紧凑的 `TokenMeter`）比 handoff 中 6 个内部界面的通用标题更丰富，强制 60px 会截掉预算告警，这正是 RN-088 禁止的那类错误；活动标签页使用 `box-shadow: inset 0 -2px 0 var(--accent)` 而不是 `border-bottom`；标尺的水平滚动；文档式标签页中内容容器的 `max-width: 1040px`（不包括 `semRespiro` 的）。自第 16 阶段起作为后代 CSS 覆盖存在于 `ProjectPage.module.css` 中的标尺间距值迁移到了 `Tabs.module.css`，现在归属同一个所有者。

需要决定、而不只是 CSS 的部分：handoff 列出 7 个项目标签页，而注册表（`project-tabs.ts`）有 10 个。`executores`（RN-121）、`backlog`
（RN-048）和 `insights`（Psicólogo 的假设）诞生于 handoff **之后**，有真实数据和自己的 RN，它们**保留**——handoff 是**视觉**保真的参考，而不是产品标签页数量的上限（RN-203，ADR 0078）。并且 `sessions` 键仍标为“Chat”，从不是较新的 handoff 所要求的“Chat RAG”（RN-202）：“Chat RAG”会描述一个不存在的功能——embedding 契约已就绪（ADR 0075），但还没有任何东西使用它，没有索引管道，也没有引用 UI——今天重命名标签页，就是 ADR 0042 已经对目录模型拒绝过的错误：在能力存在之前就宣布它。导出的**形式**都没有改变（`AbaDoProjeto`、`ABAS_DO_PROJETO`）；只有 `code` 的标签从 "Code" 改为 "Código"。

## 28 计划——第 2 波，H1 前线：可见焦点（ADR 0036） {#programa-28--onda-2-frente-h1-foco-visível-adr-0036}
`Select`、`Modal`（关闭按钮）和 `ProjectCard` 获得了 `:focus-visible`，与 `Input.module.css` 采用同样经过校准的处理，包括 `forced-colors` 区块：三者都没有仅凭键盘可达的焦点指示。`Modal` 的关闭按钮从 30px 增加到 32px，即桌面端触控目标的下限。`Table` 和 `Badge` 经过审计，**不**需要修改——两者都不暴露自己的交互能力：`Table` 的行纯属展示（需要可点击行的地方已经在单元格内通过 `render` 使用 `<button>`/`<a>`），而 `Badge` 在产品中任何地方都没有配合 `onClick` 使用。

## 28 计划——第 3 波，H3 前线：Criativo 标签页获得 KPI，而不假装拥有不存在的数据（RN-227..230） {#programa-28--onda-3-frente-h3-a-aba-criativo-ganha-kpis-sem-fingir-dado-que-não-existe-rn-227230}
handoff 为会话的 5 种真实状态（`created/active/closing/closed/closed_abnormally`）要求 4 个状态标签。`closed_abnormally`→
中止、`created`→等待 是直接对应的；`closing` **没有**与“已关闭”合并——它获得自己的标签（“encerrando”，`accent` 色调，脉动），因为在 `closing` 状态下结果尚不可知，称它为“已关闭”会就此撒谎。药丸式筛选器（同样原因只有 4 个）按**轨迹**而不是外观把
`created` 和 `closing` 分组：`created` 归入“Ativas”（仍在进行中），`closing` 归入“Fechadas”（正在无错误地关闭）——行上的标签从不被筛选器改写，只改变分组。4 个 KPI 中有两个因数据缺失而保持诚实：“本月成本”**复用** `getMySpend`（与花费标签页相同的 `queryKey`，成员视图/RN-101），从不显示项目总额——那是 owner 的数据（`porProjeto`），而 Criativo 标签页对任何成员可见；“构思 → 提交 比率”被**声明**为缺失（显示“—”），因为如今产品中会话与提交之间不存在关联——编造计算就是 ADR 0042 对模型评分已经拒绝的那类错误。

## 28 计划——第 4 波，G2 前线：Chat RAG 获得索引管道和混合搜索（RN-231..238，ADR 0080） {#programa-28--onda-4-frente-g2-o-chat-rag-ganha-pipeline-de-indexação-e-busca-híbrida-rn-231238-adr-0080}
基于第 3 波的 `chunks` 表（ADR 0079）：对三个诚实的范围进行**手动**索引（没有 watcher，`POST .../rag/reindex`，幂等的完全重建——在重建之前删除该范围/会话）——`docs`/`adr` 通过 `ReadProjectCodeUseCase`（与 Code 标签页相同的凭据/闸门/路径检查），`session` 只取 `chat.message`/`agent.response`。按标题/段落分块，1200 个字符、150 个字符重叠——记录为起点，而不是针对真实数据的校准（目前还不存在针对索引运行的问题集）。混合搜索是**两个**独立的查询（通过 HNSW 的向量、通过 GIN 的词法），以加权和（0.6/0.4）融合，并在阈值（0.2）处截断——这些数字同样是起点。当 embedding provider（固定为
`ollama`）没有响应时，管道会写入**不带**向量的块，并在报告中声明这一缺口——从不假装索引完整，搜索会降级为仅词法并发出警告。界面（Chat RAG 作为独立标签页）属于第 5 波；这条前线只有后端。

## 28 计划——第 4 波，F1 前线：容器生命周期变成表，没有编排器（RN-243..248，ADR 0081） {#programa-28--onda-4-frente-f1-ciclo-de-vida-do-container-vira-tabela-sem-orquestrador-rn-243248-adr-0081}
参见第 25 阶段的第 31 项（**部分撤销**）：`project_containers`
（migration `0046`）记录可变的**状态**——`provisioning → running ⇄
stopped`，`failed` 可从三者到达，`removed` 只能通过重新置备离开——不同于 `artifact.project_image`（Arquiteto 不可变的**决定**）。经调查确认（grep，零出现）：产品中**没有任何**服务挂载 `/var/run/docker.sock` 或以 `privileged` 运行——两个用例都只**写入**和**读取**，没有对 Docker 的任何真实调用。第一次转换要求镜像已经决定（RN-105），并在行中**冻结**版本/资源；`local` 项目（ADR 0072）被拒绝，因为它不启动自己的容器。资源上限（`cpus`/`memory_mb`/`pids_limit`）是**声明**的，而不是施加的——没有任何界面断言“容器被限制为 X”，只说“记录的意图是 X”。当时没有新的 HTTP 路由：在还没有真实使用方时公开一个，就是在猜测契约——由紧随其后的第 5 波/F2 前线关闭。

## 28 计划——第 5 波，G3 前线：Chat RAG 获得独立标签页（RN-252..254，ADR 0082） {#programa-28--onda-5-frente-g3-o-chat-rag-ganha-aba-própria-rn-252254-adr-0082}
RN-202（第 2 波/C）推迟的界面——“Chat RAG”会描述一个尚不存在的能力——随第 4 波/G2 的后端一起到来：`key: 'rag'`，**新**标签页（`ordem: 28`，位于代码和 Backlog 之间），**从不**重命名 `sessions`。区别保持不变，只是理由变了：`sessions` 是与**已激活** agent 的对话（每个回合消耗 owner 的密钥，RN-058）；`rag` 是在已构建索引上的搜索，中间没有任何 agent，本质上只读。界面使用 ADR 0080 的三个契约而不猜测其形式，并显示后端早已声明、却没有任何界面读取的两种诚实降级——`vectorAvailable:
false` 变成可见的警告，覆盖率从不编造“Xmin 前重新索引”。来源为 `session` 的引用会导航到确切的**事件**，复用 Psicólogo 证据标签已在使用的机制；来源为 `file` 的引用以文本显示路径/标题，不带链接——代码标签页如今没有按路径的深链接，不在此范围内。

## 28 计划——第 5 波，F2 前线：容器生命周期的真实使用方（不是终端）（RN-267/268，ADR 0083） {#programa-28--onda-5-frente-f2-o-consumidor-real-do-ciclo-de-vida-do-container-não-o-terminal-rn-267268-adr-0083}
这条前线最初的计划是完整的交互式终端。调查确认第 25b 阶段仍被裁剪：没有服务挂载 `/var/run/docker.sock`，即使在 ADR 0081 之后，生产中也没有任何东西转换 `project_containers`——不存在可以在其**内部**打开终端的真实容器。实现一个假的终端，或者在 Brabo monorepo 的同一个容器中运行的终端（ADR 0055 已经描述为策略而非隔离的那笔债），就是在编造能力——与 ADR 0041/0042 对 LLM provider 和目录模型所拒绝的错误相同。真实的交付：`GET /projects/:projectId/container/lifecycle`
（role:viewer），生命周期第一次通过 HTTP 公开（修订了因缺少使用方而推迟该路由的 ADR
0081），以及显示该状态的终端标签页——翻译后的徽章、失败原因——位于已有说明文字**之下**，从不取代它，只在标签页打开时获取。`null`（从未置备）是如今诚实且最常见的结果。

## 28 计划——第 5 波，I 前线：社交登录撤销 ADR 0031 backlog 的禁令（RN-272..283，ADR 0084） {#programa-28--onda-5-frente-i-login-social-revoga-a-proibição-do-backlog-do-adr-0031-rn-272283-adr-0084}
产品所有者的明确请求，清楚其安全后果——禁令只对 GitHub/GitLab 解除；MFA、OIDC provider 和通用联合仍不在范围内（参见“O que NÃO fazer”）。
`SocialLoginCallbackUseCase` 最终落到与密码登录**相同**的 `EmitirSessaoUseCase`——没有第二种会话格式。它复用现有的 OAuth 客户端，但 `state` 有**自己的**用途
（`purpose: 'social_login'`，在任何其他字段**之前**检查）：从不接受把 git 连接到项目这一**连接**流程的 `state`，那会是权限提升。新表 `social_identities`（migration
`0047`），键为 `(provider, provider_user_id)`——从不是电子邮件/登录名。三步决策：已知身份 → 登录；电子邮件与现有账号匹配**并且**已由 provider 验证 → 关联（如果账号的电子邮件尚未验证，则一并验证）；电子邮件匹配但**未**验证 → 拒绝——输入的电子邮件不是所有权的证明，接受它会打开账号接管的口子；没有对应账号 → 置备一个没有密码的新账号，与 Keycloak 迁移时相同的“待定”状态。复用 git 连接的**同一个** OAuth 应用——零新环境变量，只是每个流程的 `redirect_uri`/`scope` 不同；**操作者**需要在 provider 中登记第二个回调，这一动作正是 `breaking/` 分支的理由。

## fluxo.yml × 代码审计——Dev Lead 的计划变成真正的审批（RN-284，ADR 0086） {#auditoria-fluxoyml--código--o-plano-do-dev-lead-vira-aprovação-de-verdade-rn-284-adr-0086}
这不是计划中的阶段：它关闭了一次只读审计在
`docs/fluxo.yml` × 代码之间发现的分歧（发现 A2，
`docs/explanation/auditoria-fluxo-vs-codigo.md`）——自 ADR 0085 起，流程就已把 `dev-lead` 的输出 `plano-de-paralelismo` 声明为 `via: proposed_action`，而代码从未调整以与之一致。产品所有者判定是代码错了。

`propose_execution_plan` 进入了 `decide.ts`（最低角色
`maintainer`），**故意**放在绝对上限区块之外——它可以被配置为自动批准，不同于
`parallelize`/`raise_max_parallel`。Dev Lead 是**第一个**挂起等待人工决定的对话型 agent（它们都通过最长 180s 的 `GenServer.call` 运行同步回合）——这种模式早已存在于 dev agent（ADR 0052）以及 QA/Infra 的 gate（ADR 0057）中，但这两者由 `cast` 触发，从不需要处理一个待决的同步 `from`。`TurnoAssincrono.tratar_resultado/2` 增加了一个分支：当存在 `:aguardando_aprovacao` 键时（按**值**检查，而不是按存在与否——Dev Lead 自 `init/1` 起就带着 `nil`），它以一贯的方式、在一贯的时刻回复 `from`，但只发出 `agent.status:
awaiting_approval` 而不是 `agent.done`——回合并没有结束。`LiveBroadcast.agent_status/4` 在守卫中加入了这个新状态。恢复使用 `QaLeadServer` 已为 QA 子 agent 复用的**同一个** `Engine.Dev.Wake`（投递按 **agent**，而不是按类型）。

**接受的缺口，已声明**：没有自己的状态表，engine 在 Dev Lead 挂起期间重启会丢失订阅——决定仍然被记录并在审批中可见，但它不会自行叙述结果。关闭这一点需要与 ADR
0052 相同的持久化机制；不在本次修正的范围内，本次修正只是让行为与
`docs/fluxo.yml` 早已声明的内容一致。

## UX Designer——第五个对话型 agent，提前引入（RN-285..287，ADR 0087） {#ux-designer--o-quinto-agente-conversacional-antecipado-rn-285287-adr-0087}
这不是被触发的拆分条件——`docs/fluxo.yml` 一直把“当**被管理**的项目有自己要设计的界面时”声明为标准，而它并没有触发：设计系统仍是静态输入。这是产品所有者**有意识**的决定，仍然提前引入这个角色。

`Engine.Agents.UxDesignerServer` 镜像了 `DevLeadServer`——每个会话一个 GenServer，上限 14 次迭代，由已有的**通用**机制通过寻址到 "ux-designer" 的 `accepted` handoff 激活（`ActivateAgentUseCase` 中没有改动一行）。**独立**：没有领域，没有子 agent。kickoff 读取最新的 `artifact.product_brief`——Criativo 产出的**同一个**“业务需求”，没有新产物——而设计系统（`design/tokens.css`、`design/COMPONENTS.md`）在 agent 的身份中被**描述**（`Engine.Harness.Agents`），是静态文本：对话型 agent 没有读取仓库文件的工具。

`propose_prototype` 是**唯一**的工具（`personas`、`jornadas`、带有 `telas`/`anotacoes` 的 `prototipo`、`resumo`）。它写入
`artifact.prototipo_navegavel`，**在 api 中没有专门的用例**——不同于 `choose_project_image`/`create_c4_diagram`，它们需要用例，是因为其内容**派生**自另一个产物或有共享的领域拒绝；这两个理由在这里都不成立，所以形式校验放在 engine 中（`ArtifactSchemas`），写入使用 api 已公开的通用 `append_event_returning`，与 `artifact.product_brief` 的路径相同。一个产物，基于它的两个 handoff——给 "po" 和给 "dev-lead"——从不为 "spec-visual" 创建第二个产物：原型（界面 + 注释）**就是**视觉规格，复制它会冒两份副本日后分歧的风险。复用了 ADR 0086 设计中脱离其挂起机制后仍成立的那一半：成功的 `propose_prototype` 结束回合，以免模型再次提议而重复产物——没有 "aguardando_aprovacao"，因为提议原型没有外部效果。

`apps/web/src/lib/agents.ts` 增加了条目（`color: var(--accent)`，名册中复用最少的语义 token；`icon: PencilIcon`）。
`uxDesignerActive` 进入了名册，位于 RN-090 要求保持同步的**两个**来源中——团队面板（`agent-status.ts`）和仪表盘卡片（`projects-summary.repository.ts`，扩展了 `infraActive` 的同一查询，没有新查询）。

**超出能力范围，已声明**：`teste-de-usabilidade` 需要真实的人类用户——任何 agent 都无法替代。`metricas-de-uso` 即使在 `analytics` 为 `active` 时仍是缺口（ADR 0089）：漏斗报告衡量的是
会话→提交→PR→合并，而不是 Brabo 所构建项目的**最终**用户对功能的采用——“按功能的采用证据”被**声明**为如今没有途径存在的指标，而不是下一轮要关闭的待办。

## Staff——代码就绪，自动触发处于休眠（RN-305/306，ADR 0088） {#staff--código-pronto-dormente-para-disparo-automático-rn-305306-adr-0088}
这不是计划中的阶段：自 ADR 0085 起，`docs/fluxo.yml` 就把 Staff/Principal Engineer 声明为 `status: planned`（“契约就绪，激活已决定，等待触发器”）。产品所有者**有意识**的决定：提前引入**代码**，即便知道**自动**触发器（Anamnese 注意到一个**反复出现**的系统性问题）不会触发——Anamnese 处于暂停状态（`ANAMNESE_ENABLED=false`，2026-08-10 的决定）。对自动触发是休眠的，对**手动**调用则不是。

第六个独立的对话型 agent（`Engine.Agents.StaffServer`），与 Criativo/PO/Arquiteto/Dev Lead/UX Designer 并列，镜像了 Arquiteto（有界循环，上限 14），有两点不同：**没有** `kickoff/1`（没有可总结的会话产物——它启动后保持空闲，直到第一条 `user_message`，即发出 handoff 的人如何说明问题），以及通过 `canActivateAgent` 的**通用**路径激活（寻址到 "staff" 的 `accepted` handoff），而不进入 `USER_STARTED_AGENTS`——调查确认 api 中不需要任何领域改动，因为
`assertHandoffTargetAllowed` 只拒绝领域的子 agent，而 Staff 没有领域。唯一的工具 `propose_rfc`（问题、带取舍的选项、建议、可丢弃的 PoC）通过 `append_event_returning` **直接**写入 `artifact.rfc_staff`——与 `emit_insight` 同样的无表模式，而不是 `artifact.c4_diagram` 的模式（后者在 api 中从 module_map 派生 Container 层）——并在**同一次**工具调用中把 handoff 交还给 Arquiteto，没有 `proposed_action`（记录一份文档不是外部效果）。

`staffActive` 进入了团队面板的名册和仪表盘卡片（`ProjectCardSummary.roster`），标准与 `infraActive` 相同，以免出现 `RosterFacts` 注释早已警告过的分歧。
**已声明，未隐藏**：`SessionPage.tsx`/`AGENTES_DE_CHAT` 没有被触碰——与已被接受的 `infra` 模式相同（一个**真实**且**活跃**的 lead 同样不在这个列表中）。如今端到端的使用路径是内部路由（`POST .../agent/message`，`agent: "staff"`），而不是会话界面；“手动 handoff 给所选 agent”的通用 UI 仍在 backlog 中。

## `implementavel` gate 激活——QA 策略作为 qa-lead 的第二个时刻（ADR 0090） {#o-gate-implementavel-ativo--qa-estratégia-como-segundo-momento-do-qa-lead-adr-0090}
产品所有者有意识地提前了 `docs/fluxo.yml` 早已预见的触发器（“当 implementavel gate 激活时”）——**这里**的触发器就是构建该机制的工作本身，而不是等待发生的使用症状。`docs/gates.yml`，`implementavel`：
`status: planned` → `active`（所有者 `dev-lead`，`severidade: warn` 不变——注册表早已写明“即使激活也以 warn 诞生”）。

**QA 策略不再是 `proposto` 角色**：它就是 `qa-lead` **本身**，在第二个**时刻**——同一个进程，与 PR 结论分开的交付物，正如 `docs/fluxo.yml` 早已声明的（“可以是 qa-lead 本身在第二个**时刻**，不一定是新 agent：拆分在于交付物”）。`Engine.Gates.QaLeadServer.run_design/3` 是一个**新的**、**附加的**入口（不触碰 `run/2`，即与 `DevAgentState.find_by_task_id` 绑定的一贯路径），由
`Engine.Gates.Dispatcher.run_qa_estrategia/3` 触发（与 `run_qa/2`/`run_secops/2` 已使用的测试中可替换的间接层相同）。

`Engine.Gates.QaEstrategiaAgent` 是**无状态**模块（不是 `GenServer`），与 `QaPerformanceSegurancaAgent` 形式相同——没有 `Terminal` 的注册表（`ReadFile`、`SearchWorkspace`、`EmitPlanoDeTeste`）——但**上下文**不同：`Engine.Gates.QaEstrategiaContext.fetch/3` **只**获取故事（来自 `list_backlog`）和当前的 `module_map`（来自 `get_infra_context`，只复用 `moduleMap` 字段——零新路由），没有 `dev_state` 也没有 `worktree_path`，因为该 gate 在 **DEV 之前**运行：还没有 dev agent、worktree 或 `task_id`。三个工具都不经过 `ActionPipeline`（只有 `terminal`/`write_file` 经过），所以这个 agent **从不**挂起——`run_design/3` 在自身的 `handle_cast` 中同步运行。迭代上限为 8（对话型），而不是 60（gate）——**故意如此**：底下没有 `token_budget_micros`（没有任务，DEV 之前），与 `infra-workflows` 即使使用工具也保持在 8 的原因相同（RN-085）。交付物（`emit_plano_de_teste`：综述、可执行的标准、**通用**且不绑定框架的自动化策略）在发起调用的会话的 event log 中成为 `artifact.plano_de_teste`。

`assess_implementability` 是 Dev Lead 的新工具，读取**自身**会话历史中该故事最新的 `artifact.plano_de_teste`：还没有计划时，触发评估并返回请求重试的错误（工具错误是循环的**输入**，而不是终点——RN-163）；有计划时，以 `proposed_action` 提出意见（`implementavel`/`inviavel` + 理由，计划嵌入 payload），与 `propose_execution_plan`（ADR 0086）**相同**的三结果模式——`maintainer`，**故意**放在 `decide.ts` 绝对上限区块之外。

**`appsec` 不再是 `proposto`**——SecOps 的第二个时刻在下一节中引入。

## appsec 获得 secops 的第二个时刻（RN-360/361，ADR 0090） {#o-appsec-ganha-o-segundo-momento-do-secops-rn-360361-adr-0090}
`docs/fluxo.yml`（`id: appsec`，camada_seguranca）预先声明了“与 QA 相同的模式：两个**时刻**，暂不是两个 agent”——产品所有者有意识地提前激活，不等待注册表本身作为触发器引用的 `implementavel` gate（`qa-estrategia` 前线，同属概念上的 ADR 0090）。

`Engine.Gates.SecOpsAgentServer.run_design/2` 在 PR 的 secops **同一个**进程中运行（相同的 `Registry` 键），没有任何 `Diff`/`Scanner`/
`DevAgentState`：它在 backlog 中获取故事 + 当前的 `module_map`
（`Engine.Gates.AppSecContextBuilder`，没有 `dev_state`/`worktree_path`），并调用 `Engine.Gates.AppSecAgent.run/3`——**无状态**模块（不是 GenServer，与 `QaPerformanceSegurancaAgent` 形式相同），工具注册表**没有** `Terminal`，通过 `ToolLoop.run/1` 在故事的**设计**上（从不是代码上）运行一个 STRIDE-lite 检查清单。它以发出 `artifact.threat_model` 结束，并为声明的三个 lead 创建 handoff（arquiteto、dev-lead、
`infra`——id `area-infra` 的可寻址 **agent**，RN-361）。

**已声明的缺口，不是 bug**：`run_design/2` 是**可触发**的，但还没有任何东西会自动触发它——自然的触发器是 Dev Lead 的 `assess_implementability`
（`qa-estrategia` 前线），不在本次交付范围内，本次交付保持自包含（`decide.ts`/`docs/gates.yml`/`dev_lead_tools.ex` 未被触碰）。

## `analytics`/`delivery-metricas` 变成报告（RN-320..322，ADR 0089） {#analyticsdelivery-metricas-viram-relatório-rn-320322-adr-0089}
产品所有者有意识地**提前**引入目标模型的两个角色（`docs/fluxo.yml`，`status: proposto`），而不等待它们各自已声明的自然触发器。形式正是流程本身所规定的：`analytics` “被 `medicao` 吸收”，直到**产品**指标成为 PO 的必需输入；`delivery-metricas` “从不成为 agent——成为 `medicao` 的**报告**”。两者变成**一个**脚本——
`apps/api/scripts/analise-funil.ts`（`pnpm --filter api analise:funil --
--projeto <uuid> [--json]`），与 `medir-execucao.ts`（第 13b 阶段）**相同**的格式：通过 Drizzle 纯读取，零写入，没有 GenServer，没有 LLM agent。

它基于 dev agent 三个 git 动作（`git_commit`/`pr_open`/`git_merge`，只取 `status:
'executed'`）的 `proposed_actions.execution_result` **真正**测量：真实漏斗（多少会话产生了提交 / 打开了 PR / 合并了 PR，以及各阶段之间的转化——计数的是**会话**，不是动作）、真实的前置时间（会话从第一次提交到第一次合并，依据**执行**的 `updated_at`，而不是提议的）以及真实的部署频率（合并到 `PROTECTED_BRANCHES` 分支，按天，通过引用与 `docs/gates.yml` 的 `backmerge` gate 交叉——后者的证据是 CI，超出了只读数据库的脚本的能力范围）。

三个指标放在“Não medido, de propósito”一节中——这是**永久**声明，而不是下一轮要关闭的缺口：**完整的产品漏斗 构思 → 提交**（`sessions` 没有 `storyId`，RN-230，需要新的 schema——本前线没有 migration）；**按功能的采用证据**（这不是缺少收集的数据——Brabo 不对它所**构建**的项目做埋点，如今没有任何途径让这种遥测存在）；**MTTR 和变更失败率**（需要真实生产**事件**的信号，与 `secops-runtime`/`platform` 相同的依赖——另一条前线）。

## `secops-runtime` 作为报告脚本（RN-375..377，ADR 0091） {#secops-runtime-como-script-de-relatório-rn-375377-adr-0091}
产品所有者决定提前引入 `secops-runtime` 角色
（`docs/fluxo.yml`，`camada_seguranca`，之前为 `proposto`），而不等待声明的触发器（“有真实流量的生产，在 `DEPLOY_ENABLED` +
`platform` 激活之后”）。只有触发器**不**需要的部分进入：`pnpm --filter api
relatorio:seguranca-runtime` 读取 `rate_limit_hits`——ADR 0027 的 `RateLimitGuard` 已经在写入的数据，包括在 dev/CI 流量下——并生成桶的排行（`user:<uuid>`/`ip:<endereço>`，仅有的两种记录格式；没有路由也没有原因，表从未保存过它们）以及固定时间片的时间分布。它是**脚本**，不是 LLM agent 也不是
`GenServer`：对数据没有要做的决定，只有聚合。

自动事件检测、事件响应和安全事后复盘仍然**排除在外**——它们依赖同一个未触发的触发器——报告把它们列在一个**永久**的“não medido”一节中，不模拟示例事件，也不编造数字（与 ADR 0041/0042/0077 相同的原则）。保留的窗口按设计很短
（`DomainGaugesCollector.pruneRateLimit` 删除早于
`2 × RATE_LIMIT_WINDOW_MS` 的命中，默认 240s），报告声明两个窗口——**配置的**和**观察到的**——从不让后者冒充比实际更长的历史。

## `platform` 获得第一个交付：按需遥测报告（RN-385/386，ADR 0092） {#platform-ganha-uma-primeira-entrega-relatório-de-telemetria-sob-demanda-rn-385386-adr-0092}
产品所有者有意识地提前引入 `platform` 角色的一部分
（`docs/fluxo.yml`，`camada_plataforma`）——其 `status` 仍为 `planned`，其 `ativacao` 仍与不存在的 `DEPLOY_ENABLED` 同步。
`pnpm --filter api relatorio:telemetria [--projeto <uuid>] [--json]` 是一个**脚本**（不是 LLM agent，不是 `GenServer`），按需读取 `DomainGaugesCollector` 已经为 Prometheus 抓取所收集的**相同**问题——按项目的活跃/closing 会话、按项目被阻塞的任务、最后一次备份的状态（总是**全局**的，从不按项目，因为产品备份的是整个数据库）——打印后即结束。SQL 查询是**复制**的，而不是从采集器导入的：采集器的方法是私有的，并且以写入 Prometheus gauge 结束，没有可以复用的纯“只查询”的一半，复用会把 CLI 脚本耦合到一个 `@Injectable` 的生命周期上。

输出总是带有“哪里可以看到更多”（`deploy/k8s/observability/dashboards/*.json` 中的版本化仪表盘、
`deploy/k8s/observability/alerts/brabo-alerts.yaml` 中的告警、`docs/runbook.md
#observabilidade`、用于本地可观测性的 `pnpm dev:obs`）——链接，从不重复——以及一个**声明**而不编造的“não medido”一节：产品中没有定义任何数值 SLO，事后复盘依赖尚未发生的真实事件，而以闭环方式回流到产品的遥测才是让 `platform` 变为 `active` 的东西——触发器（`DEPLOY_ENABLED`）仍然缺失。该角色的
`gate_saida: { id: operavel, status: planned }` 不变；`docs/fluxo.yml` 只在输出 `telemetria-consolidada` 上增加一条 `nota`，说明手动/按需版本已经是真实的。

## dbre 变成两个机械脚本（RN-400..403，ADR 0093） {#dbre-vira-dois-scripts-mecânicos-rn-400403-adr-0093}
fluxo.yml 的 `dbre` 角色的四个交付物中，只有两个依赖真实的数据量（`plano-de-capacidade`、`tuning`——仍是缺口，没有期限）。另外两个不需要真实负载：`parecer-de-
migracao` 是对 SQL 文本的模式识别
（`apps/api/scripts/lint-migracao.ts`，扫描 `apps/api/src/db/migrations/
*.sql`，标出 `DROP TABLE`/`TRUNCATE`/`DROP COLUMN`/`ALTER COLUMN ...
TYPE`/不带 `DEFAULT` 的 `ADD COLUMN ... NOT NULL`，发现任何情况就 `!= 0`——如今在已合并并被接受的 migration 中发现 3 处，仅供参考，没有顺手修正）；`backup-restore-testado` 自第 5 阶段起就已是真实的（CronJob + `backup_runs` + 已执行的 `make test-restore`，RTO 约 40s）——只缺一个按需报告（`relatorio:backup`，与 `DomainGaugesCollector.collectBackup()` 相同的读取）。两者都还没有进入 CI：linter 扫描的是整个仓库，而不是某个 PR 的 diff，会变成因不属于该 PR 的发现而让 PR 失败的 gate——当这一点改变时，范围限定的技术参见 ADR 0093（`pr-police.ts`）。“每波一个 migration”的规则（`meta/_journal.json`）不再被称为这个角色的“机械化版本”：它避免的是并行 agent 之间的快照冲突，这与“这段 SQL 有风险模式”是正交的关注点。

## fluxo.yml × 代码审计——第 1 波：fluxo.yml/gates.yml 保持最新 {#auditoria-fluxoyml--código--onda-1-fluxoymlgatesyml-em-dia}
审计计划（D 节，
`docs/explanation/auditoria-fluxo-vs-codigo.md`）六个波次中第一个关闭的——第 3、4、5 波已经提前且不按顺序完成（analytics/DORA、`implementavel` gate、QA 策略/appsec）；这一波只是元数据，没有 ADR，没有一行生产代码。

`docs/gates.yml`（`paralelismo-autorizado`）：`status: planned` → `active`，`evidencia` 与相邻的 `implementavel` gate **格式相同**——
`event_types: [proposed_action.created/approved/denied]`、`filtro: {
actionType: parallelize }`、`onde:
request-parallelization.use-case.ts`（发现 A1/B5——自 ADR 0053/第 14d 阶段起 `fluxo.yml` 就已写着 `ativo`，只有 `gates.yml` 落在后面）。
`docs/fluxo.yml` 又获得了审计的三项修正，全是引用或标签，没有一项涉及行为：`dev` 的状态机从 4 个状态变为 5 个（加入了 `awaiting_approval`，第 12e 阶段/ADR 0052——A3）；RN-160 的引用从 Arquiteto 的 `backlog-promovido` 输入移到了它真正适用的地方，即 `handoff-duplo` 输出（它所锁定的“Confirmar arquitetura pronta”按钮——A4）；RN-161 的引用从 `handoff-duplo` 移出，变成 Dev Lead 输入上的一条注释（串联激活执行的是**接受** handoff 这一步，而不是双重 handoff 本身——A5）；`dev` 的 `worktree-por-agente` 的来源不再写作
`harness`（`Engine.Dev.WorktreeManager` 不是 `harness` 角色的 4 个组件之一——A8）。`docs/explanation/backlog.md` 也已更新：过时的 `gates.yml` 那一行从待办表中移除（在此关闭），连同 `implementavel` gate（B3，在本波之前已由 ADR 0090 关闭，却没有人把它从表中删掉），以及 `analise:funil`
（ADR 0089）已经真正交付的 B7 部分（部署频率/前置时间）——MTTR/变更失败率仍被排除，但作为已在 `fluxo.yml` 中声明的**永久**缺口，而不是工程待办。

验证：`pnpm --filter api validacao:gates -- --sem-banco`（注册表有效，没有 `ativo-sem-evidencia`）和 `pnpm docs:check` 为绿色。脚本的第 3 阶段（event log 中的真实证据）需要针对有数据的数据库使用 `--projeto <uuid>`——超出本次只涉及元数据的修正范围。

**同一计划中的待办，不属于本波**：第 2 波（Dev Lead → dev 委派，RN-160 在后端重新校验）和第 6 波（`necessidade-validada` gate，编码前需要 ADR 和产品决定）。

## fluxo.yml × 代码审计——第 2 波：后端中的 RN-160 以及 Dev Lead → dev 委派（RN-404/405，ADR 0094） {#auditoria-fluxoyml--código--onda-2-rn-160-no-backend-e-delegação-dev-lead--dev-rn-404405-adr-0094}
审计计划（D 节）六个波次中的第二个，是第 1 波之后范围**最大的两项**——其余四个中，3、4、5 已提前且不按顺序完成；6 仍待处理，需要 ADR 和产品决定。两项都只存在于 `apps/api` 中；`engine`/`web` 不需要任何改动。

**B6——RN-160 在后端重新校验。** 该规则（“Confirmar arquitetura
pronta”至少需要 1 个已推进的故事）只在**客户端**得到保证
（`SessionPage.tsx`，`hasPromotedStory`）——直接对
`POST /agents/arquiteto/handoff-infra` 发起 HTTP 调用会完全绕过该规则。
`OfferInfraHandoffUseCase.execute` 现在会查询
`StoryRepository.findByProject`，当没有任何故事的 `status !== 'draft'` 时，在写入事件或调用 engine **之前**以 `BadRequestException` 拒绝。

**B1——Dev Lead → dev 委派变成数据。** ADR 0053（第 5 项）早已预见这一点，并在当时声明为超出范围——CLAUDE.md 将其列为可撤销的裁剪。在此关闭：`AcceptParallelizationUseCase.execute`
（API 侧，顺带覆盖直接路径**和**已批准路径，因为两者本来就汇聚于此）写入 `delegations`，`area: 'dev'`、`leadAgent:
'dev-lead'`、`subagent` = 刚激活的 `dev-<modulo>` 的 id。与 QA/Infra 不同（它们在 **ENGINE** 侧写入，因为子 agent 在那里产出意见），`status: 'completed'` 对这个领域被**重新定义**：它表示“委派已**生效**”（agent 已启动），而不是“已出具意见”——`parecerArtifactId` 指向项目最新的 `artifact.module_map`（通过 `SessionEventRepository.listByTypeForProject`，已有方法，没有新查询）。项目中没有 module_map 时——这本不该发生——委派不会以伪造的 id 写入：只记录这一意外状态并继续，因为在尝试写入时 dev agent 的激活已经成功；`RecordDelegationUseCase` 的失败出于同样理由也不会让激活失败。该决定记录在 ADR 0094 中，它也撤销了 ADR 0053 第 5 项的裁剪。

`docs/fluxo.yml`（`dev-lead`，输出 `delegacao`）：`status: lacuna` →
`status: ativo, regra: RN-405`。

## fluxo.yml × 代码审计——第 6 波（最后一波）：`necessidade-validada` gate（RN-406，ADR 0095） {#auditoria-fluxoyml--código--onda-6-última-o-gate-necessidade-validada-rn-406-adr-0095}
关闭审计计划（D 节，
`docs/explanation/auditoria-fluxo-vs-codigo.md`）六个波次中的**最后**一个——六个都已关闭：3、4、5 已提前且不按顺序完成（analytics/DORA、`implementavel` gate、QA 策略/appsec，ADR 0089/0090）；1 和 2 在之前的 PR 中关闭（fluxo.yml/gates.yml 保持最新；后端中的 RN-160 + Dev Lead → dev 委派）。这是第 6 个：`necessidade-validada` gate（Criativo → PO），自 ADR
0085 起声明为 `proposto`，背后没有任何机制。

`modelo-de-time.md` 早已记录它为何停滞：由 Criativo（模型）自行判定它自己产出的需求已经验证，是自我验证，而不是真正的 gate。产品所有者的决定是**单独**的人工确认——`SessionPage.tsx` 中的第三个按钮“Confirmar necessidade validada”，与“Confirmar arquitetura pronta”（RN-160）**相同**的模式：专用路由
（`POST .../agents/criativo/validate-necessity`）、专用用例
（`ValidateNecessityUseCase`）、自己的事件（`necessity.validated`）。从不复用 `confirm_readiness`/RN-142（它仍然只是结构性的底线，“≥1 条已捕获的规则”），也不复用 PO 对 handoff 的接受（`AcceptHandoffUseCase`，结构性的，不对内容作判断）。

选择的串联方式：按钮只在 `confirm_readiness` 已经整合出 `artifact.product_brief`（`hasProductBrief`）**之后**才启用——“验证”一个尚不存在的摘要没有意义，这也是与 `docs/fluxo.yml` 最一致的解读（该 gate 是 Criativo 的**输出** gate，即它的工作已交付具体产物的时刻）。与 `OfferInfraHandoffUseCase` 不同，这次确认**不**通知 engine——Criativo→PO 的 handoff 已经在 `confirm_readiness` 内部发生，所以新事件只是对**实质**的记录，没有任何触发器在等待它。

`docs/gates.yml` 增加了 `necessidade-validada` gate：`active`、
`aprovacao_humana: true`，但 `severidade: warn`——如今产品中没有任何东西会在放行 PO 之前**查询**这个 gate 的通过情况，不同于 `story-promovida`/`plano-de-adocao` 的 `block`，它们背后有真正的代码锁。`docs/fluxo.yml`（`criativo`，`gate_saida`）：`status:
proposto` → `status: ativo, regra: RN-406`。

## fluxo.yml × 代码审计——B4（**最后**一项待办）：PO 读取产品指标（RN-407） {#auditoria-fluxoyml--código--b4-a-última-pendência-o-po-lê-métricas-de-produto-rn-407}
关闭 B4 项——`docs/explanation/backlog.md` 中“团队模型 backlog（ADR 0085）”表格的最后一行；此次修正后该表为**空**，fluxo.yml × 代码审计到此结束。没有新 ADR：遵循 RN-164 已确立的模式（限定在项目范围的 agent 读取，没有外部效果，没有 `proposed_action`），只新增一条 RN。`docs/fluxo.yml`（`po` 角色，输入 `metricas-de-produto`）：
`status: lacuna` → `regra: RN-407`。

**数据**自 ADR 0089 起就已存在（`analise:funil`——真实漏斗 会话 → 提交 → PR → 合并、真实前置时间、真实部署频率）；缺的只是 PO 能在回合内**读取**这份报告。PO 的第三个读取工具 `listar_metricas_de_produto`
（`GET .../product-metrics`），与 RN-164 的两个姊妹工具设计完全相同——`:direct`，无参数，范围封闭在项目中。纯**计算**函数和查询（`calcularFunil`/`calcularLeadTimes`/
`leadTimeMedioMs`/`deploymentFrequencyPorDia`/`buscarAcoesGitDoFunil`）从 `apps/api/scripts/analise-funil.ts` 迁移到
`apps/api/src/application/services/funil-metrics.ts`——**机械且必要**的重构（`scripts/` 不能放在 `src/` 中，`src/` 也不从 `scripts/` 导入）：脚本改为从那里**重新导出**，签名和行为都不变，脚本的回归测试未经修改仍为绿色。JSON 响应体中没有字段表示脚本早已只用文字声明的三项永久缺失（完整的产品漏斗 构思 → 提交、按功能的采用证据、MTTR/变更失败率）——PO 的工具总是在它返回给模型的**文本**中点名它们，以免模型因数字缺席而得出不存在缺口的结论。

## GOVERNANCE.md——`community` 模式的标准，而不是它的机制 {#governancemd--o-critério-do-modo-community-não-o-mecanismo-dele}
之前 backlog 中的一项（“approval-ladder 的 community 模式”）变成了记录上的修正，而不是实现：调查确认 `community` 模式自第 6 阶段起就已存在于代码中（`scripts/ci/approval-ladder.ts`），两侧都经过测试，只是被 `APPROVAL_MODE=solo`（默认）关闭。backlog 中的那句话（“变成 gate 注册表中 `aprovacao_humana` 的变更”）来自 ADR 0054 中一行**推测性**的文字——按规则未编辑，但这种不精确已记录在 `docs/explanation/backlog.md` 中：`aprovacoes-da-escada` gate 的 `aprovacao_humana` 在两种模式下都已固定为 `true`，`Gate` 的 schema 中没有任何对 `APPROVAL_MODE` 作出反应的字段。

真正缺失的是另一个 `TODO(humano)`，位于
`docs/explanation/branching-policy.md`：每个审批人列表（`devs`/`po`/`gestão`）由谁加入的标准——谁加入、谁退出、依据什么。`GOVERNANCE.md`（仓库根目录，新文件）关闭了这一点：**机制**仍在 `branching-policy.md` 中（阶梯、不同的人、更换变量的分步说明），**标准**改为位于 `GOVERNANCE.md`。它是提议，而不是正在运作的委员会——项目仍然只有一位维护者，文档对此直言不讳：其大部分内容描述的是**当**有更多人时开始生效的东西，而不是已经运转的结构。docmap 中新的 `warn` 规则（`governanca`）在 `approval-ladder.ts`/
`branching-policy.md` 变化时要求复审——与现有的 `block` 规则
（`politica-de-branches`）分开，原因与 `checks-e-rulesets` 与它分开相同：**机制**源于代码，**标准**是人的决定。

## MailSender 中的真实 SMTP（RN-408，ADR 0096） {#smtp-real-no-mailsender-rn-408-adr-0096}
关闭自移除 Keycloak（ADR 0032，“真实 SMTP 仍是未来的配置”）以来一直开放的 backlog 项。基于纯 SMTP 传输的 `nodemailer`（带状态/MIME/STARTTLS/AUTH 的**行**协议，不同于产品其余部分集成的 JSON HTTP API），位于 `MAIL_TRANSPORT` 之后——`log`
（默认，**包括**生产：真正发送邮件是操作者的选择性开启）或 `smtp`，由 `AuthUseCasesModule` 中的 `useFactory` 选择，不触碰任何用例（`RegisterUseCase`、
`RequestPasswordResetUseCase`、`LoginUseCase`、脚本
`migrate-keycloak-users.ts` 仍然只是注入 `MailSender`）。
`SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` 在模式为 `smtp` 时在生产中遵循 RN-114 模式——但**没有**最初四个 RN-114 机密那样的公开默认值，所以只有当操作者选择了 `smtp` 时这把尺才会生效；校验在 `SmtpMailSender` 的构造函数中运行，由组装 provider 图时的 `useFactory` 触发（与 `CREDENTIALS_MASTER_KEY` 设计相同），而不是在 `main.ts` 中的即时调用。正文为**纯文本**，从不是 HTML——端口不承载富正文的结构，模板引擎会是毫无收益的注入面。

调查在编码前发现了一个真实缺口：`email_verification` 没有任何 web 路由——`verificarEmail` 自第 7a 阶段起就存在于
`apps/web/src/lib/auth.ts` 中，却**没有任何**调用方，所以一旦 SMTP 开始真正发送邮件，验证邮件中的链接将通往无处。`/verificar-email`
（`VerifyEmailPage.tsx`）关闭了这一点，镜像 `SetPasswordPage.tsx`——`router.tsx` 中相同的 `validateSearch` 模式，对不存在/过期/已使用的链接给出相同的唯一响应——只有一点不同：没有表单，确认在挂载时自动触发，所以界面需要 RN-088 的三种状态（加载中/错误/成功），而不只是两种。
## 仪表盘上的“N 个 agent 在线”——**实时**状态，从不是历史存在（RN-409，ADR 0097） {#n-agentes-online-no-dashboard--status-ao-vivo-nunca-presença-histórica-rn-409-adr-0097}
之前 backlog 中的一项已关闭。事先调查确认，无论按项目还是按 workspace，都不存在任何存活性聚合——只有**历史**存在（`RosterFacts`，“曾经出现过”），而真正的实时状态只在客户端，派生自 event log，并且只在项目**打开**时才有。`ProjectCardSummary.onlineAgentCount` 用**同一把**尺（“不空闲，不卡住”）把两个机制加总：dev agent
（`engine.dev_agent_states.status NOT IN ('idle', 'idle_tripped')`，在 engine 中批量聚合）和对话型 agent（最近会话的最后一个 `agent.status` 满足 `status !== 'idle'`，`payload` 只接受
`working`/`idle`/`awaiting_approval`）。QA/SecOps 从不计入——它们不发出
`agent.status`，每次调用只给出一个结论，在调用之间没有“空闲”的概念。

值得记录的架构决定：查询**直接**读取
`engine.dev_agent_states`，通过按 workspace 批处理的原始 SQL，放在 RN-090 读模型已经汇总十一个查询的**同一个** `Promise.all` 中（十二 → 十四，仍然**恒定**）——而不是在 engine 中打开一条新的内部 HTTP 路由。`api` 和 `engine` 共享**同一个**物理数据库，只由 Postgres schema 分隔，并且已有先例
（`apps/api/scripts/medir-execucao.ts` 已经读取 `engine.oban_peers`）；这个决定把这一模式从手动脚本提升为**经过测试**的生产代码（在
`test/support/global-setup.ts` 中为 engine 的表提供最小且声明的 fixture）。ADR
0097 中接受并声明的后果：查询假定运维产品的人会同时迁移两侧（`db:migrate` **和** `engine:migrate`），如果只有 api 迁移，它会响亮/可见地失败——没有 try/catch 隐藏错误。

## 有待处理 dev agent 时，执行会话不再关闭（RN-411） {#sessão-de-execução-não-fecha-mais-com-dev-agent-pendente-rn-411}
修复的是在一次**真实**执行会话中发现的缺陷，而不是脚本条目：五个 dev agent 启动，进入 `idle_tripped`（RN-047，断路器），卡住等待用户逐个解除任务阻塞，而会话 30s 的心跳（`Engine.Sessions.SessionServer`）在手动解除阻塞仍在进行时从底下关闭了会话。`GetSessionPendingWorkUseCase` 的第三个信号（RN-064）只读取
`agent.status`，即对话型 agent 的词汇——dev agent 使用 `dev.*`（`Engine.Dev.AgentIo`），从不发出 `agent.status`，所以没有任何 dev agent 曾经通过这个信号保住会话。第四个信号读取会话中每个 `dev-<modulo>`/`dev-<modulo>-2` 的最后一个 `dev.*` 事件：`dev.working`/`dev.blocked`/`dev.idle_tripped` 保住会话（卡住等待人工决定**就是**待处理的工作）；只有 `dev.idle`（真正排空）不保住。`dev.awaiting_gate`/`dev.awaiting_approval` 由 RN-412 **加入**了这把尺——见下文；本段所描述的残留缺口已关闭。
## 注册时自动创建个人 workspace（RN-410） {#workspace-pessoal-automático-no-cadastro-rn-410}
浏览时发现：仪表盘上的“Novo projeto”按钮什么也**不**做，也没有错误。根本原因：`RegisterUseCase` 和 `SocialLoginCallbackUseCase`（在置备新账号的分支中）创建了用户和凭据，却**从未**创建 workspace——**每一次**新注册都撞上这堵墙，之前没有显现只是因为 `seed.ts` 总是随演示数据一起创建一个 workspace。现在这两处都在创建账号的**同一个**事务中创建 workspace，并把用户添加为 `owner`。名称/slug 来自唯一的纯函数 `nomeESlugDoWorkspacePessoal`（`domain/auth/personal-workspace.ts`），以免规则在两个文件中分歧；slug 总是加上
`userId.slice(0, 8)` 后缀（与 `extraDevAgentId` 相同的模式），从而无需往返数据库即可唯一（RN-410）。

## PR 上的 413 与“没有执行”的执行者——两端以及串联（RN-412，ADR 0098） {#413-nas-prs-e-executores-sem-execução--as-duas-pontas-e-o-encadeamento-rn-412-adr-0098}
这不是计划中的阶段：由真实**使用**提出的修复（“nas PRs sempre está
estourando entity too large”），加上姊妹缺陷——执行者标签页在真实工作进行时显示为空。调查发现两者是串联的：gate 以 `413` 死掉 → dev 卡在
`dev.awaiting_gate` → 这个状态不保住会话（RN-411 的缺口）→ 30s 的心跳从底下关闭会话 → 标签页要求活跃会话，整个名册随之消失。

**413 的原因在 Brabo 的 API，而不在 LLM provider**——把错误归咎于 provider 的注释（`runtime.exs`、
`terminal_executor.ex`、`docker-compose.yml`）是错的；
`FalhaDeTurno.origem({413, _})` 早已把它归类为 `"codigo"`，这是对的。`apps/api/src/main.ts` 从未配置 Express 的请求体限制——使用的是 100 KB 的默认值，远低于 Phoenix 接受的 8 MB，而且是在传输最重的方向上（engine → api，
`POST /internal/sessions/:sessionId/llm-turn`，在 ToolLoop 的每次迭代中重新发送**整个**历史）。`API_JSON_BODY_LIMIT`（默认 10 MB）堵住了传输这一端。

第二端——没有它，提高限制只会推迟溢出：engine 的 `ContextManager`（ADR 0098）有**两个**缺陷，让压缩在请求体溢出之前无法触发——`estimate/1` 只计算 `content`，所以满是 `toolCalls` 的 `assistant` 消息在估算中几乎为零 token；压缩窗口只使用 `context_window`（gate agent 中为 128.000 个 token），这相当于压缩前约 350 KB——远远超过任何合理的传输上限。**有效**窗口现在是
`min(context_window, teto_de_transporte)`，截断总是在 ToolLoop 的**迭代边界**上（从不把带 `toolCalls` 的 `assistant` 与回应它的 `role: "tool"` 分开——那会破坏 provider 的 tool-use 协议）。

**RN-412** 扩展了 RN-411：`DEV_PENDING_TYPES` 加入了
`dev.awaiting_gate`（原始论证——gate 可能死掉，把 dev agent 无限期卡在这个状态），也加入了 `dev.awaiting_approval`，依据调查中发现的新论证：审批决定**同步**写入 `proposed_actions.status`，但通过 outbox/Oban 恢复 dev agent 是**异步**的——在两者之间的窗口中，没有任何东西保住会话，这是 RN-411 的同一缺陷，只是深了一层。

**执行者/概览标签页**在 web 侧有姊妹缺陷：
`executionActivated` 派生自对 `useSessionEvents` 仅 200 个事件窗口的 `events.some(...)`——`execution.activated` 是会话**最早**的事件之一，在任何真实执行中都会滑出窗口，抹掉整个名册。正确的值早已存在，聚合了**所有**事件，位于 workspace 摘要中（RN-090，
`projects-summary.repository.ts`）——两个界面都改为使用这个值。途中的额外发现：`ExecutionSection`（概览）又在同一个窗口上独立地重新计算了一次 `activated`——长时间的执行会再次提供“Ativar execução”，就像从未开始过一样；一并修复。`gatesEverOpened` 存在**同一类**缺陷，被**声明**为已知限制，这里没有修复——修复它需要改变 `deriveAgentRoster`/`rosterFactsFromEvents` 的签名，超出本次定点修正的范围。

## Neo4j 作为知识图谱——基础（RN-413/414/415，ADR 0099/0100） {#neo4j-como-grafo-de-conhecimento--a-fundação-rn-413414415-adr-00990100}
产品所有者的请求：Neo4j + `ollama-model-loader`（gemma:1b、
yi-coder:1.5b、nomic-embed-text），明确受到仓库
[ErickWendel/neo4j-ai-experiments](https://github.com/ErickWendel/neo4j-ai-experiments)
的启发——在 ADR 0099 和 `prompts/README.md` 中记录了致谢，感谢它对“prompt 作为版本化文件，而不是困在代码中的字符串”这一模式以及将图谱作为 agent 记忆的具体启发。

两项职责，一个基础：**版本化的 prompt 模板**
（`PromptTemplate`/`PromptVersion`，按哈希幂等——RN-413）和
**关系型记忆**（交互、带证据的 Psicólogo 假设、Anamnese 画像、handoff——真正的消费是未来的波次，本次交付只构建机制）。图谱是**派生**记忆，从不是事实来源；pgvector 仍然是块的向量索引，不在两个数据库中重复 embedding。驱动 `neo4j-driver` 在 api 中（而不是在 engine 中）——api 已经拥有全部持久化和 RAG，engine 一如既往通过带 service token 的内部 HTTP 使用它。

`rag_search`（RN-414）填补了现有 RAG 最大的空白：没有任何 agent 查询它，只有 web 的“Chat RAG”标签页。engine 中的新工具，有自己的上限（RN-150），降级总是在给模型的文本开头可见。
`ollama-model-loader`（RN-415）修复了一个独立的真实 bug：`nomic-embed-text` 从不会被自动拉取，在任何干净的环境中 RAG 都会静默地降级为仅词法。

第一批模板提取到 `prompts/*.md` 中（ux-designer、Psicólogo、Anamnese、`ContextManager` 的摘要）。

## 图谱的消费——模板不触碰 GenServer，相关性不取代时效性（RN-416/417，ADR 0101） {#consumo-do-grafo--templates-sem-tocar-genservers-relevância-sem-substituir-recência-rn-416417-adr-0101}
`InstructionFiles` 获得了 `:graph` 来源（`db > graph > dir > root`——用户的 `instruction_patch` 仍然胜过一切），**三个** agent 开始**尝试**在内联文本之前从图谱解析模板，内联文本变成了必需的回退：ux-designer（`graph_instruction_templates_enabled?`）、Psicólogo 和 Anamnese（`graph_templates_enabled?`，两者共用同一个键）。两个开关，而不是一个——如果共享键，在并行前线之间会因**相反**的默认值而冲突；两个默认值都是 `false`。在这批四个模板中，当时只有 `context-manager-summarize` 没有使用方——ADR 0101 声明为开放的缺口，后来由**同一个** `graph_templates_enabled?` 的**第四个**使用方关闭：`ContextManager` 的摘要 prompt（`prompt/1`，参见 RN-417）。

`Psychologist.ContextBuilder`/`Anamnese.ContextBuilder` 获得了**第二个**上下文来源——`rag_search`，查询派生自分析的触发器——与一贯的最近/时间窗口读取**组合**，从不取代：没有命中时，行为与以前完全相同。片段进入 `Triage` **现有**的预算，RAG 的 `degraded: true` 在上下文中总是可见，从不隐藏。

图谱自行写入：`GraphProjector`（api）排出**第二**条 outbox 行（`aggregateType: 'graph_projection'`，同一事务，engine 的过滤器——`IN ('session', 'task')`——永远不会匹配这个值，从而避免与已经在约 2s 内排出 `'session'` 的 `Engine.Outbox.Drain` 竞争），并调用已有的写入用例。engine **从不**直接写入图谱——这保持了 event log 作为唯一事实来源；图谱可以通过重放重建。

**验证期间的真实发现，之所以记录是因为它有教益**：RN-412 的请求体限制测试（`apps/api/test/main.spec.ts`）有一个**潜在**的 bug——在文件顶部**静态**导入的 `AppModule` 会在 `beforeAll` 能把 `DATABASE_URL` 指向测试库**之前**就求值 `DrizzleModule`（它在**模块**作用域、而不是在 Nest 的 factory 中创建连接池）。只要本地 dev 库也已迁移，问题就被掩盖了（同一张表，所以即使指向错误的地方，查询也“找得到”）；一旦 dev 库被重建为空（由这一波本身针对 Neo4j+Postgres 的真实冒烟测试导致），问题就暴露了。修复方法是在 `beforeAll` 中、在 `DATABASE_URL` 设置之后使用**动态**的 `await import(...)`——每当测试需要为真实的 `AppModule` 重定向 `DATABASE_URL` 时，都应遵循这一模式。

## 本地 runner——在用户机器上执行（RN-418/419/420，ADR 0102/0103） {#runner-local--execução-na-máquina-do-usuário-rn-418419420-adr-01020103}
产品所有者的请求：agent 在**用户的机器**上、在项目的本地目录中、通过用户的默认终端运行——外加 Code 标签页中真正的交互式终端。两项变更，一项依赖另一项。

**策略（ADR 0102——**全局**决定，在一条关于该变更的自动安全警告之后，由产品所有者明确确认）**：
`git push`/PR/部署（RN-106）和 `sudo`/`doas`（新增）从无条件的 `deny` 变为**绝对上限**——无条件的 `require_approval`，与相邻上限位于**同一**区块、采用**相同**模式（`current.policy ===
'auto_approve'`），永远不能被 `agent_autonomy`（通配符 `"*"`）或 `permissions.json` 自动批准。原先的 `deny` 强行堵住的缝隙在**源头**被关闭：`ApproveAlwaysActionUseCase`/`patternForAction` 拒绝为带 git 外部效果或特权命令的动作在 `allow` 中写入模式——对于这两种情况，“sempre permitir”只批准该实例，从不批准模式。没有这另一半，上限就只是装饰。`sudo`/`doas` 在 `comandoPrivilegiadoNoComando`
（`external-effect.ts`）中按**动词**匹配，扫描命令的所有段，与 `efeitoExternoNoComando` 原则相同。

**Runner（`apps/runner`，新的 Node/TS workspace，ADR 0103）**：用户在自己机器上运行的 CLI
（`brabo-runner --project <id> --dir <pasta> --token brb_...`），通过**新的** Phoenix 通道连接到 **ENGINE**
（`/runner`，
主题 `terminal:<projectId>`），由**一次性**ticket 认证（与 RN-108 模式相同，但 ticket 由 **ENGINE 签发**——schema `"engine"`，有自己的 migration——由 api 通过内部 HTTP 路由请求，与会话 ticket 的流程相反）。它在用户的 `$SHELL` 中执行 `exec`（**已经批准**的 agent 命令——`TerminalExecutor` 中的路由只在一贯的 `decide()`/`proposed_action` 管道**之后**发生，从不在之前），并为终端标签页提供交互式 PTY 模式（`pty_open`/`pty_data`/
`pty_input`/`pty_resize`/`pty_close`——engine 做纯粹的**中继**，从不解释字节）。每个项目只有**一个** runner（`Engine.Runners.Registry`、
`:global`，`:global.register_name/3` 的排他性）；`runner` 模式在**没有**已验证的 workspace 或**没有**已连接的 runner 时会显式**拒绝**——从不退回到 `System.cmd`/bind-mount，对 `runner` 项目来说那并不存在
（由 ADR 0104/RN-423 修订，见上文；退回到一贯路径的行为仍然有效，但只针对 `container`/`mounted`）。PTY 是已认证**用户**的动作，不经过 `proposed_action`，但会被审计（event log 中的 `terminal.session.started`/`ended`，包括标签页在没有显式 `pty_close` 的情况下掉线时）。

runner 的安全边界**不是**沙箱——而是认证（CLI 出示用户**账号**的 Personal Access Token）+ 一贯的审批管道 + 用户同意以自己的权限在自己的机器上运行 CLI。`apps/runner/src/guard.ts` 通过词法解析校验 `cwd` 位于根目录之内，但它被声明为**尽力而为**，不是真正的保证。

**PAT 填补了自动化 token 的缺口（ADR 0105/RN-424..426）。** 第 1 波的真实发现——“产品没有用于自动化的**长期**账号 token 机制，所以 runner 复制了浏览器的登录（cookie/CSRF 持久化在 `~/.brabo/runner-credentials.json` 中）”——在第 2 波中关闭：`personal_access_tokens`（`brb_…`，通过 `hashDeToken()` 的 HMAC-SHA256+pepper 哈希，从不用 argon2——它不适用于**高**熵机密）在项目配置中签发，限定于**一个**项目，可吊销，可选过期。`apps/runner/src/auth.ts` 完全去掉了交互式登录、cookie 和凭据文件——只校验格式并转发 `--token`/`BRABO_ACCOUNT_TOKEN`，CLI **从不**把它写入磁盘。PAT 从构造上**从不**在
`POST .../runner-ticket` 之外认证（`IS_PAT_ROUTE_KEY`/
`@RequirePatAuth()` + `PatAuthGuard`）——从不是全局 `JwtAuthGuard` 中的一个分支，那会让 `RolesGuard` 为用户角色的任何路由授权 PAT。

**`maintainer` 可以吊销其他用户的 PAT（RN-427）**，关闭了 ADR 0105 暂时声明为超出范围的条目（事件响应——离职的 dev 的 token 泄露）。同一模型的扩展，没有新 ADR：**单独**的路由（`GET .../personal-access-tokens/all`、
`DELETE .../personal-access-tokens/:tokenId/admin`），范围按
`projectId` 而不是 `userId`——每个用户的自我吊销（RN-426）不变。

`@xterm/xterm`/`@xterm/addon-fit`（web）和 `phoenix`/`node-pty`（runner）是四个新依赖——与 `mermaid` 同一把例外标尺（ADR 0068）：动态 `import()`，通过对已安装包的 grep 确认没有 `eval`/`new Function`（这不是针对混淆的正式保证，只是强证据——声明为不确定性，而不是断言为确定）。

**ADR 0104——第 1 波完成（RN-421/422/423）：** ADR 0072 和 0103 从未相互沟通——RN-170 在创建时要求 bind-mount，而到 runner 的路由（RN-420）复用了同一个 `workspace_mode == 'local'` 标志而没有任何 bind-mount，所以真正使用 runner 仍然必须通过挂载目录的校验。`workspace_mode`（2 个值）变成了
`execution_mode`（`container`/`mounted`/`runner`，migration `0048`）——RN-170（现为 RN-422）只对 `mounted` 生效；`runner` 诞生时路径只做**词法**校验（没有 I/O），`workspaceVerifiedAt: null`，当某个 runner 连接并在**主机**上确认路径时提升为已验证（`POST /internal/projects/:projectId/workspace-verification`，RN-423）——runner 是路径的**事实来源**，会覆盖向导中输入的内容。`Engine.Actions.TerminalExecutor.decisao_de_execucao/1`
获得了**四个**出口：只有在 workspace 已验证**且** runner 已连接时才路由；两者缺一时显式**拒绝**——从不退回到 `mounted` 的
`System.cmd`/bind-mount，对 `runner` 项目来说那并不存在。

**实现中的发现，更正 ADR（ADR 不被编辑——更正位于这里和
[backlog.md](backlog.md#backlog-of-the-runnerexecution_mode-adr-0104)）：**
ADR 0104 中所说的已有项目在三种模式之间的转换“开始被允许而无需重建项目”是**不正确**的。`UpdateProjectDto` 仍然故意排除 `executionMode`/`workspacePath`——这不是简单的 PATCH（worktree、permissions.json 和 engine 的缓存都指向旧的范围）。第 1 波只交付了**创建**时的三值字段；已有项目的转换是未来的波次，有自己的设计，尚未计划。runner 的 backlog：第 2 波（PAT，ADR 0105）关闭了阻碍 `npm publish @brabo/runner` 的条目，第 3 波（ADR 0106）交付了分发本身——`tsup` 把
`apps/runner` 打包成单个 `dist/index.cjs`（`node-pty` 作为必需的 `external`，原生绑定），由一个独立的 workflow（`publish-runner.yml`）在每个最终 tag 上发布，与 `release.yml` 并行。经实际测试的真实发现：`index.ts` 的自动运行守卫需要对 `process.argv[1]` 使用 `realpathSync`——没有它，当 CLI 通过 `npm install -g` 安装的 `bin` 调用时 `main()` 从不运行（符号链接，`process.argv[1]` 从不通过 realpath 解析，而 `import.meta.url` 总会解析）。声明的运维待办：真正的发布需要产品所有者创建 npm 的 Automation Token 并配置 secret `NPM_TOKEN`——没有它，workflow 会发出警告并跳过，从不失败。按 `{project_id, machine_id}` 的排他性继续推迟，直到真正出现第二个并发开发者；尽力而为的 `guard.ts` 是**重申**的不变量，而不是缺口。参见
[ADR 0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)/
[ADR 0105](../adr/0105-personal-access-token-do-runner-escopado-por-construcao.md)/
[ADR 0106](../adr/0106-distribuicao-do-runner-via-tsup-e-npm-publish.md)。

## 开发工具——`pnpm bootstrap` {#ferramenta-de-desenvolvimento--pnpm-bootstrap}
`scripts/dev/bootstrap.sh` 中的终端菜单，汇集日常要做的事：Docker、K8s、Database 和 Test。它之所以存在，是因为这些命令位于**三个**互不相通的地方——`package.json`、`Makefile` 以及 `deploy/k8s/`/`docker/` 中的脚本——而死记硬背的知识会腐烂。

它**不重新实现任何东西**：每个叶子都调用已有的命令。`--print-commands` 模式在没有 TTY、不执行的情况下解析整棵树，测试（`scripts/dev/bootstrap.spec.ts`）就运行在它之上——TUI 无法做单元测试，但菜单→命令的映射可以，而出错的正是它。零新依赖；颜色取自 `design/tokens.css`，以 24 位 ANSI 输出，并降级到 256 色和无色。

正在执行的命令的输出是**可滚动**的（SGR 鼠标滚轮、`j`/`k`、PageUp/PageDown、`G` 回到末尾）。缺的不是读取滚轮：而是**偏移**——`tail -n` 只会显示末尾——所以窗口变成了用 `sed -n 'a,bp'` 截取的片段，可以通过 `--print-window` 在没有 TTY 的情况下测试。页脚会说明两个后果：向后滚动会**冻结**窗口（像 `less +F` 一样，否则 5 Hz 的重绘会撤销滚动），而只在执行界面开启的鼠标追踪会在**每一种**退出时关闭——`restaurar_terminal` 中的 `\e[?1006l\e[?1000l`，由 EXIT trap 覆盖。转义解析器是通用 CSI 的（读取到结束字节为止）：读取固定的两个字节会把序列的其余部分留在缓冲区中，而菜单把 `[1-9]` 当作选择，滚轮一转就会触发菜单项。

记录的三项决定：`Create` 从零置备，`Deploy` 发布到已存在的环境（所以只有 `Deploy` 可以按服务选择）；在 K8s 中只有 `All` 可用，Api/Engine/Web 显示为**禁用**而不是消失，因为菜单应该说出产品不做什么；`Database › Delete` 会重建 pgvector 扩展，因为
`docker/postgres/init.sql` 只在卷首次初始化时运行——单纯的 `DROP SCHEMA` 会让下一次 migration 失败，而由于 engine 共享同一个数据库，恢复需要 `db:migrate` **和** `engine:migrate`。

**`Docker › Reset total`**（`scripts/dev/reset-total.sh`）把整个序列合并到一个叶子中——preflight、`up --build --wait`（Compose v2.17+ 的 `--wait` 就是“直到全部健康”，无需手写健康检查循环）、与 Delete 相同的 `DROP SCHEMA`、`db:migrate` +
`engine:migrate` 以及种子——带有**自己的**确认界面（`confirmar_reset`，要求输入 `RESET`），不同于 Delete 的确认界面（要求输入数据库**名称**），并且没有 Delete 的“postgres 已运行”前提，因为正是这个命令从零启动 compose。种子
（`apps/api/src/db/seed.ts`）增加了一个从 `.env` 激活 provider 凭据的步骤，复用 LLM smoke 已在使用的**同一组**
`<PROVIDER>_TEST_KEY` 变量
（`apps/api/test/infrastructure/llm/*.smoke.spec.ts`）——一个命名约定，两个使用方；没有定义变量的 provider 不会加入，也不报错，凭据归属 **OWNER**（RN-058）。

第一次运行重置时的两个发现，而不是因为这一项本身——两个都不是假设的，两个都破坏了真实执行：

1. `gemma:1b` 在 Ollama 的 registry 中不存在（`manifest unknown`——只有 `gemma3:1b` 存在），所以 `ollama-model-loader` 总是失败，`--wait` 从不以绿色结束。在以**代码**形式携带错误值的六个地方修正——`docker-compose.yml`/`.prod.yml`、
   `.env.example`、`docker/ollama/pull-models.sh`、
   `scripts/dev/verificar-modelos-ollama.sh`、
   `deploy/k8s/base/ollama/job-model-loader.yaml` 以及 `docs/business-rules.md` 中的 RN-415——不触碰 ADR 0099/0100（已接受），也不触碰 CLAUDE.md 同一节中的历史叙述，它们描述的是当时请求/决定的内容，而不是当前的运维值。
2. 更严重，也更久远——`Database › Delete`（第 3.4 项，自菜单创建时就存在）从未真正删除：`DROP SCHEMA public
   CASCADE` 触及不到 `engine.*`（Ecto/Oban 位于**自己的** schema `engine` 中），也触及不到 `drizzle.__drizzle_migrations`（drizzle-kit 的控制表位于**自己的** schema `drizzle` 中）。结果：`mix ecto.migrate` 在幸存的 engine 表上撞到 `duplicate_table`，而 `pnpm db:migrate`——更糟，**没有任何**错误——看到 drizzle-kit 的控制表完好，断定已经全部运行过，于是**没有**重建任何 api 的表。`Delete`/`Reset total` 现在也会删除 `engine` 和 `drizzle`，按此顺序，在 `public` 之前。


---
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
---

# 任务：第一次 dogfooding——由智能体亲手实现 Bitbucket 和 Generic

Fase 10 从 backlog 中交付两个 git provider——`BitbucketProvider` 和 `GenericGitProvider`——并同时交付
Brabo 构建生产软件的第一次真实执行。这个软件就是 Brabo 本身。

**方法是范围的一部分。** 本文档不是实施计划：它是实验的协议。实施者是智能体，在产品内部被引导。观察者
是你。偏离协议是发现，不是捷径。

这个文件不是网站页面——`docs/missions/**` 被排除在 Docusaurus 构建之外
（`website/docusaurus.config.ts:186-187`），这也是 `doc-mission.md` 住在这里的原因。它是版本化的工作
材料，在仓库中阅读。

---

## 测量的是什么 {#o-que-está-sendo-medido}

同时测量两件事，重要的是不要混淆它们：

1. **产品能交付吗？** 两个 provider 最终存在，并通过唯一的契约测试套件吗？
2. **与它共处是什么感觉？** 每个 task 有多少次审批点击。你有多少次需要手工介入，以及为什么。花了多少钱。
   QA Lead 的综合意见说的是有用的东西还是噪音。

第二件是事后无法恢复的。凌晨 2 点一个智能体卡住，一时冲动解锁而没有记录，就是永远丢失的数据。第 4 部分
的表格就是为此而存在的。

---

## 不可协商的原则 {#princípios-inegociáveis}

1. **卡住是价值极高的发现。** 如果智能体卡住了，答案**绝不**是打开编辑器在外部实现 provider。而是记录
   卡住及其来源（`infra` | `modelo` | `código` | `política`），通过表格中**有记录的**干预解锁，然后继续。
   从不卡住的实验什么也测量不了。

2. **不在 Anamnese 流程之外调整指令。** 如果一个智能体表现不好，这是需要观察的症状——而不是在半路上
   通过编辑提示词来修复的 bug。合法的路径是 Psicólogo 提出假设、Anamnese 把它变成补丁，由**你批准或
   拒绝**。在外部编辑指令会使整个循环失效，而这正是被测试的东西之一。

3. **阶段期间不重构产品。** 发现在收获（第 5 部分）中变成有优先级的 backlog，绝不是内嵌的修复。边测量
   边修正会破坏测量。

4. **仓库的流水线完全适用于智能体的 PR。** `pr-police`、`approval-ladder`、QA 和 SecOps 的 gates。
   没有例外，没有绕过，没有"这只是个测试"。

5. **受保护分支上的合并永远由你手动完成。** 这不是实验的规则——这是产品的保证（`decide.ts:149-160`：
   目标受保护的合并永远不能自动批准，无论是通过 `agent_autonomy` 还是 `permissions.json`）。写在这里只是
   为了说明没有什么可以放松的。

6. **在收获中不要编造数字。** 第 5 部分的每个指标都必须与 event log 对得上。对不上的作为"未测量"记入，
   而不是估计。

---

# 第 1 部分——搭建

## 1.1 决定搭建方式的阻塞 {#11-o-bloqueio-que-define-a-montagem}

原计划是让 Brabo 中的一个项目指向 Brabo 自己的仓库。**产品不会这样做**，而这个发现是本阶段的第一个
发现。

`ProvisionRepositoryUseCase` 只有两条路径：恢复已为该项目持久化的仓库，或调用
`provider.createRepo(...)`——无条件，无替代（`provision-repository.use-case.ts:144`）。唯一的配置路由是
`POST projects/:projectId/git/:provider/repository`（`git.controller.ts:159`），而 DTO 只接受 `name`、
`visibility` 和 `namespace`（`apps/api/src/interfaces/http/git/dto/provision-repository.dto.ts`）——没有
`externalId` 或现有仓库 URL 的字段。

按 id 读取他人仓库的方法 `getRepo` 存在于 provider 中（`github-provider.ts:82`），**没有被任何用例调用**。
对这个流程来说它是死掉的能力。

对一个已经存在的仓库，`createRepo` 抛出 `GitRepoAlreadyExistsError`（`github-provider.ts:73`）——被当作
错误处理，从不被当作采用的机会。

而强行走这条路会比做不到更糟。bootstrap 的 `protect_branches` 步骤以 `enforce_admins: true` 和
`required_approving_review_count: 1`（`github-provider.ts:170-175`）运行 `updateBranchProtection`，作用于
`PROTECTED_BRANCH_NAMES` 的四个分支（`bootstrap-steps.ts:94`：`main`、`rc`、`qa`、`dev`）。这会**覆盖
Fase 6 的保护**，并可能在单一所有者的仓库中阻止你自己的手动合并——
`docs/adr/0028-protecao-de-branch-divergencia-entre-providers.md:83-84` 已经用散文记录了这个风险。
bootstrap 还会创建一个 Brabo 分支策略不使用的 `rc` 分支（`bootstrap-steps.ts:195`）。

## 1.2 步骤：fork、手动播种、不做 bootstrap {#12-o-procedimento-fork-seed-manual-sem-bootstrap}

**决定：** 实验针对 `brabo` 的一个 **fork** 运行，已配置仓库的行手工插入，标记为已收敛。Gitflow 的
bootstrap **不运行**。

为什么是 fork 而不是通过向导创建的新仓库：新仓库生来是空的。智能体需要 Brabo 的代码来在其中实现 provider，
也需要 `pr-police`/`approval-ladder`/gates 的 workflow 让原则 4 成立。fork 免费带来这三样东西——历史、
`dev`/`qa`/`main` 以及 `.github/workflows/`。

为什么不运行 bootstrap：六个步骤是幂等的，对 fork 来说大多数会是 `skipped`（分支已经存在），但有两个会
**行动**——`create_rc_branch` 会创建 `rc`，`protect_branches` 会覆盖继承的保护。两者都不是想要的，而
"skip 就是成功"（RN-029）在步骤不是 skip 时没有帮助。

步骤：

1. 在你的账户中 fork `brabo`。记下得到的 `owner/repo`。
2. 通过 `POST users/me/git-credentials` 注册 GitHub 的 PAT。token 在被加密**之前**被测试
   （`register-git-credential.use-case.ts:23`），因此无效 token 不会写入任何东西。
3. 照常通过 UI 在 Brabo 中创建项目，**不**配置仓库。
4. 手工插入指向 fork 的 `provisioned_repositories` 行（`provider: 'github'`、
   `external_id: '<owner>/<repo>'`、`default_branch:
   'dev'`），以及对应的 `repo_bootstraps` 行，标记为已收敛——这样产品就不会尝试恢复任何 bootstrap。
5. 把这记录为观察表的**第 1 条**。这是实验的第一次人工干预，它发生在实验开始之前。

> **TODO(humano):** qual `owner/repo` do fork? O procedimento acima precisa do
> valor literal para a linha de `provisioned_repositories` — e a colheita vai
> querer citá-lo.

## 1.3 前提条件——真实状态 {#13-pré-condições--status-real}

对照代码调查，而不是对照 CLAUDE.md。

| # | 前提条件 | 状态 | 证据 |
|---|---|---|---|
| 1 | 项目指向 Brabo 的仓库 | ⛔ **被阻塞**——通过 fork 绕过（1.2） | `provision-repository.use-case.ts:144` |
| 2 | 有效的 GitHub 凭据 | ✅ 就绪——路由存在并在加密前测试连接 | `register-git-credential.use-case.ts:23` |
| 3 | QA 和 Infra 领域已激活 | ➖ **不适用**——没有可激活的东西（见 1.3.1） | `apps/api/src/db/schema.ts:781-786` |
| 4 | 按智能体的模型 binding | ✅ 就绪——`PUT projects/:projectId/agent-bindings/:agentSlug` | `model-bindings.controller.ts:153` |
| 5 | 按 task 的预算 | ✅ 就绪——`projects.task_budget_micros`，通过 `POST .../execution/activate` | `apps/api/src/db/schema.ts:288` |
| 5b | 按领域的预算 | ⛔ **不存在**——只在 ADR 0038 中设计 | 见 1.3.1 |
| 6 | 已同步的模型目录 | ⚠️ **部分**——只有 OpenAI 列出目录（见 1.3.2） | `openai-provider.ts:22` |
| 7 | 一切手动自治 | ✅ **默认**就绪——无需配置（见 2.1） | `decide.ts:125-128` |
| 8 | 基础种子 | ⚠️ 部分——创建 workspace、项目和 7 个模型；没有 git、没有预算、没有执行 | `apps/api/src/db/seed.ts` |

### 1.3.1 关于第 3 项：`agent_areas` 表不存在 {#131-sobre-o-item-3-a-tabela-agent_areas-não-existe}

ADR 0038 的通用领域机制在 Fase 8 被从范围中削减。schema 中的注释字面上这样说
（`apps/api/src/db/schema.ts:781-786`）：*"Sem `agent_areas`/`agent_area_members`
(o aparato genérico do ADR 0038)"*。

存在的是 `delegations` 表（`apps/api/src/db/schema.ts:791-831`），`area` 是自由 TEXT——目前只有 `"qa"`
和 `"infra"`。领域、lead 和成员是**硬编码**的：前端在 `apps/web/src/lib/agents.ts:167-180`，engine 中
固定的行为在 `apps/engine/lib/engine/gates/qa_lead_server.ex` 和
`apps/engine/lib/engine/infra/infra_lead_server.ex` 中。

实际后果：**不存在在项目中激活一个领域的路由**。当 Dispatcher 触发 QA 或 Infra 时，领域就登场——总是
如此。这不是待处理的配置；这是不存在的配置，因为它不可配置。

由于 `agent_areas.budget_micros` 也不存在，**没有按领域的预算上限**。可用的上限是：项目和会话
（`budgets` 表），以及 task（`projects.task_budget_micros`）。CLAUDE.md 把领域级别的预算描述为已完成的
Fase 8 的一部分——它没有实现。

### 1.3.2 关于第 6 项：实际存在哪些 LLM provider {#132-sobre-o-item-6-quais-providers-de-llm-existem-de-fato}

`LLM_PROVIDER_NAMES` 有三项——`ollama`、`anthropic`、`openai`
（`apps/api/src/domain/llm/llm-provider-names.ts`）。Fase 9b 中描述的六个 provider（OpenRouter、
NVIDIA NIM、Together、Deep Infra、Bitdeer、Vultr）**没有进入**；
`docs/adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md:147-156` 把它们记为"留待
以后"。

此外，只有 OpenAI 声明 `listModels: true`（`openai-provider.ts:22`）。Ollama（`ollama-provider.ts:34-40`）
和 Anthropic（`anthropic-provider.ts:48-53`）声明 `false` 并被同步跳过——诚实地，原因写在注释中。也就是说：
"已同步的目录"只对 OpenAI 有效；对 Anthropic，模型来自种子（`apps/api/src/db/seed.ts` 播种
`claude-opus-4-8`、`claude-sonnet-5` 和 `claude-haiku-4-5-20251001`）。

这不阻塞实验——Anthropic 和 OpenAI 足以满足 API 的 binding。但它改变了第 6 项的含义：对于你很可能在
dev 中使用的 provider，没有可同步的目录。

## 1.4 开始之前依赖你的事 {#14-o-que-depende-de-você-antes-de-começar}

- [ ] 创建 fork 并记下 `owner/repo`
- [ ] 注册 GitHub 的 PAT（范围 `repo`）
- [ ] 插入 `provisioned_repositories` 和 `repo_bootstraps` 的行
- [ ] 选择 dev 的模型并填写 2.2 的表格
- [ ] 定义结束标准的两个上限（4.4）
- [ ] 记录观察表的第 1 条

> ⛔ **在此停下。** 只有在上面六项都完成后第 2 部分才开始。只搭了一半，到第三个会话才发现 gate 的 binding
> 在一个本地 7B 模型上，会污染之前的一切。

---

# 第 2 部分——实验规则

## 2.1 手动自治：不配置，也不放松 {#21-autonomia-manual-não-configurar-e-não-relaxar}

**明确批准一切已经是默认行为。** 在没有任何配置的情况下，`decide()` 落到 `require_approval`，原因是
`"default (sem
regra aplicável)"`（`decide.ts:125-128`），新项目的 `permissions.json` 生来为空
（`permissions-file.ts:14-18`）。没有什么需要开启。

实验的规则与配置相反：**不放松**。

- 永远不使用 `approve_always`——它把模式写入 `allow`，从那以后点击就不再存在。点击就是数据；花掉它们就是
  抹掉测量。
- 永远不手工在 `permissions.json` 中填充 `allow`。
- 永远不在 `agent_autonomy` 中写入行。

如果审批疲劳变得无法忍受，**这就是结果**，而不是搭建问题。在自由备注列中记下来并继续。

有两个上限无论如何都保持有效，最好知道它们存在，以免把它们误认为 bug：受保护分支上的合并
（`decide.ts:149-160`）和指令补丁（`decide.ts:166-175`）永远不能自动批准。还有一组总是被拒绝的模式
（`decide.ts:84`）。

## 2.2 开始之前固定的 binding，之后不再触碰 {#22-bindings-fixados-antes-de-começar-e-não-tocados-depois}

中途更换模型会使会话之间成本和质量的比较失效。固定一次，在这里记录，如果需要改变——作为带原因的人工干预
记下来。

下面的 slug 是真实的，来自 `apps/web/src/lib/agents.ts:25-38`。注意 QA 的 lead 是 `qa`（不是 `qa-lead`；
那个名字只作为 engine 的内部执行者存在），并且固定花名册中没有通用的 `dev-<modulo>` slug——按模块的动态
dev 在运行时从 `module_map` 派生。

| 智能体 | 本阶段的角色 | 模型 | 为什么 |
|---|---|---|---|
| `po` | 构建史诗和用户故事 | | |
| `arquiteto` | 语义的 ADR，验证 module_map | | |
| `dev-backend` | 实现两个 provider | | |
| `qa` | 领域的 lead，合并裁决 | | |
| `qa-automacao` | 测试套件 + coverage matrix | | |
| `qa-performance-seguranca` | 非功能需求和对清单的支持 | | |
| `secops` | 自己的 gate，确定性 | — | 不使用 LLM |
| `infra` | infra 领域的 lead | | |
| `infra-workflows` | CI 流水线 | | |
| `psicologo` | 关于会话的假设 | | |
| `psicologo-leve` | 廉价步骤 | | |
| `anamnese` | 画像和指令补丁 | | |
| `criativo` | **免除**——范围已知 | — | |

> **TODO(humano):** qual modelo em cada linha? Duas restrições que a fase impõe:
> o dev precisa de modelo forte de API (o trabalho é implementar contra contrato,
> não completar boilerplate), e **nenhum gate pode ficar num 7B local no passo
> semântico** — foi exatamente essa combinação que o
> `docs/adr/0020-destravar-gates-qa-secops.md` levou nove execuções para
> diagnosticar.

每个绑定到智能体的模型都需要 `supports_tool_calling`；没有的话领域会以 422 拒绝 binding（RN-040）。通过
同步发现的模型以非活动状态进入，需要经过策展才会出现在 binding 中。

## 2.3 指令：唯一的路径是 Anamnese {#23-instruções-o-único-caminho-é-a-anamnese}

用机制重申原则 2：指令补丁以 `proposed_action` 诞生，**永远**不能自动批准（`decide.ts:166-175`）。你看到
diff 并作决定。

实验的规则：**故意拒绝至少一个补丁**。这是在演练 RN-026——被拒绝的补丁不会被重新提议，比较针对的是规范化
后的内容，因此对同一个补丁重新缩进不会把它变成新的提议。如果 Anamnese 重新提议了一个你拒绝过的补丁，这是
一个重大发现，也是只有在真实执行中才会出现的那种事情。

---

# 第 3 部分——引导（10b）

产品内部会话的顺序。每一节说明产品**实际上**做什么——在多处这与 `CLAUDE.md` 的描述不同，分歧记录在本文
末尾的发现表中。

## 3.0 会话 0 之前——栈的 smoke {#30-antes-da-sessão-0--smoke-da-stack}

不要在一个无法闭合循环的环境中浪费真实的会话。先运行：

```bash
pnpm --filter api demo:pr-gates-area-qa
```

它针对假服务器演练整个 QA 领域（委派给两个子专长，合并为单一裁决）。如果它不能闭合，任何会话都不会闭合。

engine 的两个守卫在这里很重要：

- **`START_OUTBOX_DRAIN=true` 是必需的。** 正是排空器把 `session.closed` 投递给 `PsychologistWorker`
  （`apps/engine/lib/engine/outbox/drain.ex:58-61`）。没有它 Psicólogo 永远不会运行，步骤 3.6 不会发生。
  dev 的 compose 已经带了 `true`。
- **`START_ANAMNESE`** 值得在执行期间关闭、在批次之间打开。`docs/runbook.md#ambiente-de-inferencia`
  记录了 Psicólogo 和 Anamnese 与执行智能体并行消耗 LLM 轮次，甚至会在周期中途断开连接。注意那里的警告：
  **守卫不会清空队列**——旧的 job 无论如何都会在下一次启动时运行。

也要核对 runbook 那一节的其余部分（`OLLAMA_CONTEXT_LENGTH`、常驻模型、GPU）。那是 ADR 0020 花了九次执行
才隔离出的五个原因。

## 3.1 会话 0——Criativo {#31-sessão-0--criativo}

**这个会话不在原计划中，并且是必需的。** 原因在发现 #9 中：没有 Criativo，没有任何用户故事能到达
`ready`，也没有任何 dev 能领取 task。Criativo 是唯一拥有 `emit_artifact` 的智能体，而业务规则是就绪的
前提条件。

1. 打开一个新会话。由 Criativo 引导。
2. 粘贴 `docs/missions/inputs/00-handoff-criativo.md` 的文本。
3. 对话直到它为**每个要覆盖的语义发出一个 `business_rule`**。
4. **退出标准，不可协商：** 在继续之前确认这些规则存在。它们作为已发出的工件出现在会话流中。如果你在没有
   它们的情况下前进，会话 1 生来就是死的，而你只会在会话 3+ 中发现，那时没有任何 dev 能领取 task。
5. 点击 **"Estou pronto para produzir"**。Criativo 向 PO 提供 handoff。
6. 接受 handoff（**"Aceitar handoff e iniciar po"**）。

不要让它决定 Bitbucket 的语义——那是 Arquiteto 的事，对照官方文档，在会话 2 中。

## 3.2 会话 1——PO {#32-sessão-1--po}

PO **不等待指令**：激活时它会自动做一次 `:kickoff`，并根据 Criativo 留在 event log 中的 brief 和规则一次性
生成整个 backlog（`apps/engine/lib/engine/agents/po_server.ex:68-80`）。

产品做的、与原计划不同的事：

- **不存在"晋升为 ready"。** 如果用户故事诞生时就带有 DoD、DoR、≥1 个 RF 和 ≥1 条关联规则，晋升在创建时
  自动发生（`create-story.use-case.ts:75-78`）。你控制的是输入的质量，而不是中间的一道闸门。
- **不存在退回给 PO。** 没有按钮、状态或事件。拒绝是在对话流中的对话——所以**只有你记下来它才存在于表中**。
  记下来：这是实验数据，也是唯一会留下的记录。
- **Backlog** 标签页是只读的。它用于事后审阅。

与它细化时的两条刻意的指令：

- **很多模块，每个少量 task。** 根据发现 #10，每个 dev agent 每次激活处理**一个** task。真正的并行来自
  不同的模块，而不是 task 队列。3 个模块 × 2 个 task 的 backlog 比 1 个模块 × 6 个跑得好得多。
- **至少一个带性能非功能需求的用户故事**，用 QA Lead 识别的关键词之一书写
  （`apps/engine/lib/engine/gates/qa_lead.ex:20-28`）：`performance`、`desempenho`、`latência`、
  `throughput`、`vazão`、`tempo de resposta`、`escalabilidade`。检查是子串而不是语义——
  "precisa ser rápido" **不**匹配。没有它，QA Lead 在每个 task 中都会免除 Performance/安全子专长，实验就
  永远不会演练第二次委派。

## 3.3 会话 2——Arquiteto {#33-sessão-2--arquiteto}

Arquiteto 对照 `module_map` 验证用户故事，并通过真实的 PR 带着 gates 产出语义的 ADR。这是你在本阶段第一次
阅读智能体的意见。

只在这里出现、如果被忽略就会阻塞执行的三件事：

- **`assign_story_modules` 是把 `module_ids` 放到用户故事上的东西。** 领取的 SQL 匹配
  `s.module_ids ? module`
  （`apps/api/src/infrastructure/persistence/drizzle/backlog.repository.ts:189`）。没有分配模块的用户故事
  对所有 dev 都不可见，即使是 `ready`。
- **发布新的 `module_map` 会把孤立的 `ready` 用户故事降级为 `draft`**
  （`create-module-map.use-case.ts:63-82`），执行者为 `system/module-map-revalidation`。如果 Arquiteto 在 PO
  关闭 backlog 之后重新发布映射，其中一部分会无声地回到 `draft`。
- **执行的激活需要现行的 `module_map`。** 没有它，响应是 400，消息为 "Projeto sem module_map vigente"
  （`activate-execution.use-case.ts:88-92`）——不是 409。

## 3.4 会话 3+——Dev，分批次 {#34-sessões-3--devs-em-tandas}

在这里现实与原计划相差很大，原因是发现 #10：**一个 dev agent 恰好处理一个 task 然后停止。** gate 之后没有
重新调度；没有 worker 会重新触发。重新激活执行也解决不了——监督者返回已有的智能体，`:work` 不被触发，还会
多生出一个没有关联智能体的会话（发现 #11）。

一个**批次**的周期：

1. 激活执行（`maintainer`）。这会创建会话，为每个模块启动一个 dev agent，并为每个触发一个 task。
2. 可选地接受并行化（见下）——增加 `dev-<módulo>-2`，它在该模块中再做一个 task。
3. 跟踪 gates（3.5）并在 GitHub 上合并——合并在产品之外，见 3.5。
4. **重启 engine。** dev agents 是 `restart: :temporary`（`dev_agent_server.ex:16`）：它们死掉后不会回来。
5. 重新激活执行。现在注册表是空的，智能体重新启动并领取下一个 task。

在表中记下重启次数。**这是本阶段最诚实的指标**：每交付一个 task 的手动重启次数，比任何其他列都更能说明
共处的情况。

**并行化。** 建议**在激活时计算一次**，针对每个有 ≥2 个可领取 task 的模块
（`activate-execution.use-case.ts:159-172`）——它从第一分钟起就会在那里，而不是"系统觉得合适时"才出现。
串行是默认的，因为你**不**点击 "Aceitar"。在后半段接受，并像计划的那样比较测量结果。

**K 周期。** `DEFAULT_MAX_GATE_CORRECTIONS = 3`（`record-gate-verdict.use-case.ts:21`），可在激活时配置。
耗尽后，task 变为 `blocked`，失去所有者并**离开自动领取**；解锁是手动的，通过
`POST .../sessions/:sessionId/tasks/:taskId/unblock`，在概览的 "Tasks bloqueadas" 一节中有按钮。

> **为免与规则 2.1 混淆的说明：** 激活会**自行写入**项目 `permissions.json` 中的
> `DEV_TERMINAL_ALLOW_PATTERNS`（`activate-execution.use-case.ts:115-118`）。这是产品的机制——没有它，dev
> 的每个 `terminal` 都会落入审批，任何测试套件都不会闭合。这不违反"永远不填充 `allow`"，那条规则**对你**
> 仍然有效。

## 3.5 每个 PR 上的 gates {#35-gates-em-toda-pr}

在哪里看：项目的 **Aprovações** 标签页，PR 的时间线组件。每份意见是一张可展开的卡片；里面是条目、
`coverageMatrix`、**按子专长的子裁决**以及带理由的**免除**。

- **QA Lead** 进行合并。免除从不是沉默：它变成带 `justification` 的 `delegation.dispensed`。
- **SecOps** 是确定性的，没有 LLM——对 diff 运行 semgrep 和 gitleaks。缺失的扫描器会被跳过并记录在摘要中，
  从不破坏 gate。
- 顺序是不可变的：`awaiting_qa → awaiting_secops → awaiting_user`。试图跳过阶段会在领域中被拒绝。

**合并不是产品的一个阶段。** `awaiting_user` 故意是终止状态——engine 不知道 `git_merge` 也不知道
`awaiting_user`。你阅读合并后的意见，点击 "ver PR" 并**在 GitHub 上合并**。这是设计，不是缺口（RN-014）。

## 3.6 每个会话结束时——必需的顺序 {#36-fim-de-cada-sessão--ordem-obrigatória}

按此顺序，不跳过：

1. **通过会话顶部的 "Encerrar" 按钮结束。** 它触发 `closing`，然后是 `closed`
   （`apps/web/src/routes/SessionPage.tsx:271-276`）。
2. **让 Psicólogo 处理。** 它通过 outbox 的排空器在约 2 秒内自行运行——没有要按的按钮。它是幂等的，只对
   两个终止事件作出反应。
3. **在打开下一个会话之前填写表格的那一行。** 干预那一列是会蒸发的那一列。
4. **不要阅读假设。** 它们只在收获时批量阅读。

具体的防污染协议——因为你需要的团队面板和你应该避开的假设位于**同一个标签页**（发现 #15）：

- 在 **Atividade** 信息流中，把类型过滤器固定为 "Delegações"。它是排他的：只显示选中的类型，假设会消失。
- **不要滚动到概览的 Insights 一节。** 它没有折叠。
- **不要点击假设的证据标签**：除了让你阅读假设之外，链接还会打开被分析的会话，并且事件日志已经展开。
- 在一个会话的对话流内部你是安全的："Log de eventos" 生来是折叠的。

---

# 第 4 部分——观察

## 4.1 表格 {#41-a-tabela}

每个会话一行。**在过程中**填写，而不是之后——干预那一列是会蒸发的那一列。

| # | 会话 | task | 审批点击 | 人工干预 + 原因 | engine 重启 | 成本 | gates 的裁决 | 自由备注 |
|---|---|---|---|---|---|---|---|---|
| 1 | —（实验前） | — | 0 | 手工播种指向 fork 的 `provisioned_repositories`/`repo_bootstraps`。原因：产品不会采用已有仓库（`provision-repository.use-case.ts:144`） | 0 | 0 | — | 本阶段的第一个发现，在第一个会话之前。在收获中成为 P1 |
| 2 | | | | | | | | |

填写约定：

- **审批点击**——该会话中你在 Aprovações 界面上的决定的原始计数，批准和拒绝加在一起。它是疲劳的代理指标，
  所以原始计数比比例更重要。没有任何界面替你加总（发现 #16）：计数在收获时从 event log 中得出。
- **人工干预**——你做的任何本应由智能体做、或本应由产品允许的事。总是带原因。如果原因是"卡住了"，记录
  **来源**（`infra` | `modelo` | `código` | `política`）——绝不靠排除法。
- **engine 重启**——你需要重启 engine 多少次才能让下一个批次运转（3.4）。与其他干预分开计数：它是衡量
  发现 #10 瓶颈的指标，也是收获时最有价值的那个。
- **成本**——以 USD 计，来自会话的 `TokenMeter`。与 event log 的核对留到收获。
- **gates 的裁决**——每个 gate 的 `approved` 或 `changes_requested`，以及是否有修正周期、有几个。

## 4.2 每一列在 event log 中的验证位置 {#42-onde-cada-coluna-se-valida-no-event-log}

表格是人工记录；event log 是证据。在收获（第 5 部分）中，每一列都对照这些类型核对——全部存在，已在
`docs/reference/events.md` 中核对：

> ⚠️ **更正（发现 #17）：** 表格中最重要的那一列**不**在 event log 中验证。`ApproveActionUseCase` 只把
> `proposed_action.approved` 写入 outbox（`approve-action.use-case.ts:98`），从不写入 `session_events`——
> 经查询确认，在一个有数百个动作的数据库中 `proposed_action.*` 事件为零。持久的来源是 `proposed_actions`
> 表，现成的查询在 `docs/missions/colheita-queries.sql` 中。

| 列 | 在哪里核对 |
|---|---|
| 审批点击 | `proposed_actions.decided_at IS NOT NULL`——**不是** event log。`decided_at` 只在有人作出决定时才填写。两个陷阱：按 `status` 计数会低估（执行了的已批准动作变为 `executed`），而 `status = 'denied'` 包括被策略拦下、根本没到人手里的（`resolved_policy = 'deny'`） |
| 成本 | `token_usage` 表——每一行记录产生成本的价格，因此昨天的数字仍可复现（RN-044）；加上阈值的 `budget.threshold_crossed` |
| gates 的裁决 | `pr.gate_changed` 和 `infra.gate_changed`；意见内容在 `qa_verdict` / `secops_verdict` 工件中 |
| 合并意见的质量 | `delegation.completed` / `delegation.failed` / `delegation.dispensed`——每个子专长一个，带有**内部**意见的 `parecerArtifactId`；免除带有 `justification` |
| 人工干预 | 执行阶段中执行者为 `user` 的 `chat.message`，与你手工记录的交叉核对 |
| 故障来源 | `delegation.failed` 中的 `payload.failureOrigin`，以及确定性的终止分类（RN-023） |
| Psicólogo 的循环 | `psychologist.hypothesis_proposed` / `_accepted` / `_dismissed` / `_accepted_for_anamnese`，以及 `anamnese.run_completed` |
| task 卡住 | `backlog.task_blocked`——修正上限耗尽或受阻 |

如果某一列与日志对不上，它在收获中作为**未测量**记入。不要估计。

## 4.3 Psicólogo → Anamnese 循环 {#43-o-loop-psicólogo--anamnese}

只有当假设在两个方向上都被决定时，循环才会被演练。接受一切的实验什么也没测试。

**阅读规则：** 假设**批量地、只在收获时**阅读。在中途阅读会改变你作为观察者的行为，并污染之后的会话。
例外是决定本身——它必须发生，循环才能运行。

要刻意作出的决定，以及每个决定演练了什么：

| 决定 | 演练 |
|---|---|
| 接受至少一个假设并转交给 Anamnese | 环节 `psychologist.hypothesis_accepted_for_anamnese`——闭合循环的唯一路径 |
| 驳回至少一个 | RN-022：周期是 compare-and-swap，`proposed → accepted \| dismissed` |
| 拒绝至少一个由此产生的指令补丁 | RN-026：被拒绝的补丁不会被重新提议（基于规范化内容的比较） |
| 如果某个补丁被批准且让智能体变差，就回滚 | RN-027：回滚是**向前**的操作——创建新版本，不删除历史 |

值得只观察不干预的：没有有效证据的假设根本不会被记录（RN-021，按批次的原子验证）。如果 Psicólogo 提出的
东西很少，可能是它在这道门上被拒——这是信息，不是缺陷。

## 4.4 结束标准 {#44-critério-de-encerramento}

当以下**任何一个**成立时，阶段结束：

1. **成功**——`BitbucketProvider` 和 `GenericGitProvider` 通过唯一的契约测试套件，对应的 PR 已由你通过正常
   流水线合并。
2. **成本上限**——实验的累计花费达到下面的值。
3. **时间上限**——实验达到下面的天数。

两个上限的存在是为了不让实验变成项目。达到其中一个**不是失败**：它是结果，收获照样写，用到那时为止得到的
东西。

> **TODO(humano):** qual o teto de custo total do experimento, em USD? Ele deve
> ser um número que você aceita gastar sem retorno nenhum — porque esse é o pior
> caso.

> **TODO(humano):** qual o teto de dias corridos? Contados do início da primeira
> sessão da 10b, não da montagem.

> **TODO(humano):** se a suite fechar nos dois providers antes dos tetos, o
> experimento continua para colher mais dados de convivência, ou encerra na
> hora? As duas respostas servem; a que não serve é decidir isso no calor do
> momento.

---

# 第 5 部分——收获（10c）

只在结束之后开始。**工具包已经准备好了：**

| 文件 | 是什么 |
|---|---|
| `docs/missions/colheita-queries.sql` | 产生每个数字的 11 个查询，已对照真实 schema 验证 |
| `docs/missions/colheita-esqueleto.md` | 报告的模板，每个数字都绑定到填写它的查询，外加 ADR 的大纲 |

在运行任何东西之前：**`pnpm --filter api db:migrate`**。成本查询使用 `input_price_per_million_micros`、
`output_price_per_million_micros` 和 `upstream_provider`，它们只在 Fase 9 的迁移之后才存在。

按此顺序：

1. **对照数据库核对表格**，逐列，按 4.2 的映射——记住发现 #17 的更正：点击来自 `proposed_actions`，而不是
   event log。对不上的在文本中明确地变成"未测量"。

2. **填写 `colheita-esqueleto.md` 并把它移到** `docs/explanation/primeiro-dogfooding.md`。只有这时它才成为
   网站页面，届时它需要 frontmatter（`id`、`title`、`sidebar_label`、`sidebar_position`、`description`、
   `keywords`，按 `docs/explanation/documentation-workflow.md` 的模式）以及 `website/sidebars.ts` 中的一个
   条目。内容：经验证的指标、按 provider 的真实成本、干预，以及用诚实的散文写出的承诺与现实之间的差异——
   **包括智能体做得比预期好的地方**。不编造数字。

3. **批量审阅 Psicólogo 的假设**，逐个审阅，并评估由此产生的 Anamnese 补丁。这里要回答循环是产生了有用的
   东西，还是只产生了昂贵的噪音。

4. 用下一个空闲编号写 **"第一次 dogfooding" 的 ADR**。经验和发现转换为**有优先级的 P1/P2/P3 backlog**——
   绝不是内嵌的修复。ADR 记录关于做什么的决定，而不去做。

5. **更新本阶段使之变错的东西。** 特别是 `docs/reference/git-providers.md`，它目前断言 Bitbucket 和 Generic
   不在范围内（见下面的发现 #6）。

---

# 第一个会话之前已知的发现

这些来自准备阶段（10a），带着建议的优先级进入收获。没有一个被修正——在阶段期间修正会违反原则 3。

| # | 发现 | 位置 | 优先级 |
|---|---|---|---|
| 1 | 产品不会把项目指向已有仓库。`createRepo` 是无条件的；`getRepo` 存在却没有任何用例调用；DTO 没有 `externalId` 字段 | `provision-repository.use-case.ts:144`, `github-provider.ts:82` | **P1** |
| 2 | GitHub 上的 `protectBranch` 在已有保护之上施加 `enforce_admins: true` + 1 名审阅者，而不读取当前状态——可能锁死所有者的手动合并 | `github-provider.ts:170-175`, ADR 0028:83-84 | **P1** |
| 3 | bootstrap 创建并保护一个 Brabo 分支策略（Fase 6）不使用的 `rc` 分支 | `bootstrap-steps.ts:94,195` | P2 |
| 4 | `agent_areas`/`agent_area_members` 不存在；领域、lead 和成员硬编码在两个可能分歧的地方（前端和 engine）。没有按领域的预算 | `apps/api/src/db/schema.ts:781-786`, `apps/web/src/lib/agents.ts:167-180` | P2 |
| 5 | Fase 9b 的六个 LLM provider 没有进入，而 CLAUDE.md 把 Fase 9 描述得好像它们进入了 | ADR 0042:147-156 | P2 |
| 6 | `docs/reference/git-providers.md:170-174` 断言 Bitbucket 和 Generic "fora de escopo — decisão, não backlog esquecido"；CLAUDE.md 把两者标为进行中的阶段。这是 PO 当作事实来读的文档 | `docs/reference/git-providers.md:170-174` | P2 |
| 7 | `git-errors.ts` 的注释写着 "8 operações"；契约有 10 个 | `apps/api/src/domain/git/git-errors.ts:3` | P3 |
| 8 | 契约测试套件的文件头说只有 Local 演练它；GitHub 和 GitLab 自 Fase 2 起就已运行它 | `apps/api/test/contract/git-provider.contract.ts:12-18` | P3 |

发现 #6 有一个额外的价值：修正它是智能体在本阶段要做的第一个文档改动，这使得修正本身成为对漂移检查的一次
测试。

## 引导调研中的发现（第 3 部分） {#achados-do-levantamento-da-condução-parte-3}

这些来自核查 10b 的步骤是否可执行。有四个不可执行。没有一个被修正，同样依据原则 3。

| # | 发现 | 位置 | 优先级 |
|---|---|---|---|
| 9 | **Criativo 不能被免除。** 领取需要 `ready` 的用户故事；`ready` 需要 ≥1 条业务规则；规则的 id 对照真实事件验证；而只有 Criativo 有 `emit_artifact`——PO 没有。没有 Criativo，没有任何 dev 能领取 task | `backlog.repository.ts:188`, `story-readiness.ts:46`, `create-story.use-case.ts:55-59`, `po_server.ex:18` | **P1** |
| 10 | **一个 dev agent 处理一个 task 然后停止。** `:work` 只在激活和接受并行化时触发；`report_done` 打开 gate 而不重新调度；没有任何 Oban worker 重新触发。每个模块的上限：1 个 task，或并行化时 2 个 | `execution_command_controller.ex:35,75`, `dev_agent_server.ex:76-91,306-327` | **P1** |
| 11 | 重新激活执行不会重新触发 `:work`（监督者返回 `:existing`），还会多创建一个没有关联智能体的会话。Swagger 承诺的 409 "execução já ativa" 在用例中**不存在** | `execution.controller.ts:50-52`, `dev_agent_supervisor.ex:33-52` | P2 |
| 12 | 不存在向你所选智能体的手动 handoff——只有 Criativo→PO（按钮）和 Arquiteto→Infra（web 中没有按钮的路由）。而 ADR 0038 的目标验证（`assertHandoffTargetAllowed`、`HandoffToSubagentError`）**从未实现**；`toAgent` 是自由字符串 | `SessionPage.tsx:403-407,476-478` | P2 |
| 13 | 不存在"晋升为 ready"：晋升在创建时自动发生。`TransitionStoryUseCase` 验证并发出 `backlog.story_transitioned`，但**没有接到任何路由**——是死代码。Backlog 标签页是只读的 | `create-story.use-case.ts:75-78` | P2 |
| 14 | 不存在退回给 PO——没有状态、事件或按钮。`backlog.story_demoted` 是另一回事（`module_map` 的重新验证）。拒绝只有在人类记录时才存在 | `create-module-map.use-case.ts:63-82` | P2 |
| 15 | 团队面板和 Psicólogo 的假设共用同一个标签页，而它是项目的默认标签页——批量阅读协议依赖过滤的纪律，而不是产品 | `ProjectOverviewTab.tsx:227-263,278-285,576-714` | P2 |
| 16 | 没有任何界面按会话加总审批；按需的 Anamnese 没有按钮（只有路由） | `hooks.ts:153-160`, `anamnese.controller.ts:71-81` | P3 |
| 17 | **本阶段的主要指标不在 event log 中。** `proposed_action.approved`/`.denied` 只进入 outbox，从不进入 `session_events`——第 4.2 部分原先断言相反，已被更正。持久的来源是 `proposed_actions.decided_at`；outbox 保留这些行（`processed_at`），可用于交叉核对 | `approve-action.use-case.ts:98`, `deny-action.use-case.ts:50` | **P1** |

其中两个不是缺陷，只作为记录进入，以免收获时把它们误认为缺口：**产品之外的合并**（`awaiting_user` 故意是
终止状态，RN-014——engine 甚至不知道 `git_merge`），以及非功能需求中**按关键词的 QA 免除**
（`qa_lead.ex:20-28`），这是声明的启发式，不是 NLP。

---

# 输入材料

在 10b 中没有人从零开始。`docs/missions/inputs/` 中的四个文件是输入材料：

| 文件 | 给谁 | 是什么 |
|---|---|---|
| `inputs/00-handoff-criativo.md` | 你，在会话 0 中 | 要粘贴给 Criativo 的**字面文本**，加上 PO 的细化提示词 |
| `inputs/01-contrato-gitprovider.md` | PO 和 Arquiteto | 已经存在的：10 个操作、capabilities、规范化的错误、唯一的测试套件 |
| `inputs/02-bitbucket-cloud-a-investigar.md` | Arquiteto | **问题**，而不是答案——编码之前要在 Bitbucket Cloud 官方文档中核实的东西 |
| `inputs/03-escopo-do-generic.md` | Arquiteto | "最小 capabilities" 意味着什么，以及如何诚实地降级 |

与原计划的预期相反，Criativo **不**被免除：它是通往 PO 的唯一路径，也是唯一能发出解锁执行的业务规则的
智能体（发现 #9）。范围仍然是已知的——改变的是它经过 Criativo，而不是直接进入 PO。

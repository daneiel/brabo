---
traducao_de: 2f301391630d5be632e27036026760d416d43da1
---

# ADR 0115 — 从 Hugging Face 拉取模型：独立的表、两步确认以及官方发布者 allowlist——绝不使用 `proposed_actions`

- **状态：** 已接受
- **日期：** 2026-08-26
- **背景：** 允许 workspace 的 owner/maintainer 从项目/workspace 设置中搜索 Hugging Face Hub，并把一个 GGUF 模型拉取到本地 Ollama daemon，填补本地 LLM 路径此前无法回答的一个缺口（获取一个不在 compose entrypoint 内置的少数模型之中的模型）
- **参考（不作编辑）：** [ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)（“绝不自动激活被发现的模型”——本决策把这条规则应用到一个新的表面）、[ADR 0100](0100-rag-search-e-modelos-garantidos-no-boot.md)（作为接收拉取的本地 daemon 的 Ollama）、引入 `proposed_actions` 和 `decide()` 的 FASE 1 原始 ADR

## 背景 {#contexto}

产品已经有一条“agent 提议，人决定”的流水线：`proposed_actions`、`permissions.json`/`decide()` 以及读取它的三个
界面（审批、会话聊天、洞察）。从 Hugging Face 把模型拉取到 Ollama，表面上看似乎可以放进去——这是一个有真实外部
效果的动作（几 GB 的下载，然后激活一个其他 agent 可以在其上花钱的模型），而产品希望在它运行前有一次深思熟虑的、
两步的确认，而不是一次点击。

它放不进去，而这种错配只有在追溯这条流水线实际是围绕什么构建的时候才会显现。

## 决策 {#decisão}

### `huggingface_model_pull_requests` 是一张新的小表——而不是 `proposed_actions` {#huggingface_model_pull_requests-é-uma-tabela-nova-e-pequena--não-proposed_actions}

在构建任何东西之前，这个机制追溯了 `proposed_actions` 要求的四样东西，并核对它们在这里是否适用：

- `proposed_actions.session_id` 是 `NOT NULL`（FK 指向 `sessions`，cascade）。这个功能没有会话——它从项目/
  workspace 设置中调用，而不是从会话内 agent 的回合中调用。把它硬塞进去，就意味着为一个与会话毫无关系的动作伪造
  一个会话。
- `actor_kind`/`actor_id` 记录**谁提议的**（`user`/`agent`/`system`），而 `resolved_policy` 总是针对
  `permissions.json`/`agent_autonomy` 运行 `decide()` 的输出——一个为**agent** 行为上的自主级别
  （`auto_approve`/`require_approval`/`deny`）构建的策略解析阶段。这里请求拉取的操作者**就是**人——已经被路由上的
  `@RequireRole('maintainer')` 拦住
  （`apps/api/src/interfaces/http/llm/huggingface-models.controller.ts:63-72`）——没有需要监督的 agent。让它经过
  `decide()`，就是把自主级别的语义应用到一个没有自主级别的情形上：一个 maintainer 第二次确认自己的请求。
- `action_type` 针对 `decide.ts` 中封闭的 `ActionType` 联合类型进行校验，而 CLAUDE.md 对这个联合类型的规则很
  直接：新类型需要在 `apps/web/src/lib/aprovacoes.ts` 中有一句话，并会出现在为 agent 监督构建的三个界面上。为
  “一个人在自己的设置动作中点击了确认”在那里伪造一个条目，会把它暴露在一个为回答另一个问题（“agent 在请我批准
  什么”）而构建的 UI 中，而这个动作从不提出那个问题。
- 这个功能需要的“第二次明确确认”是对**人的直接动作**的 UX/安全闸门，而不是对 agent 提议的审批闸门——是另一种
  形式的“你确定吗”，不是同一种。

鉴于此，把它强行塞进 `proposed_actions`，就意味着把一个为监督不可信 agent 而构建的机制，弯折到一个没有 agent 的
情形上——让这个功能与它不需要、也从未被设计来回答它的 `permissions.json`/`agent_autonomy` 语义耦合。

**新表** `huggingface_model_pull_requests`（migration `0053_optimal_sauron.sql`）：`id`、`workspace_id`（FK
`workspaces`，cascade）、`requested_by`（FK `users`）、`repo_id`、`estimated_size_bytes`（可为空——当 Hub 不公布
时绝不猜测）、`status`（`huggingface_model_pull_status`：`pending_confirmation` → `confirmed` → `pulling` →
`active` | `failed`）、`confirmed_at`、`failed_reason`（总是以 ADR 0020 的来源词汇——`infra`/`modelo`/`código`/
`política`——作为前缀）、时间戳以及 `workspace_id` 上的索引（`apps/api/src/db/schema.ts:2371-2393`）。

### 两步确认**就是**状态机，而不是多一个 flag {#a-confirmação-em-dois-passos-é-a-máquina-de-estados-não-uma-flag-a-mais}

`RequestModelPullUseCase`
（`apps/api/src/application/use-cases/llm/huggingface/request-model-pull.use-case.ts:23`）以
`pending_confirmation` 创建该行，此外什么都不做——没有网络调用，没有副作用。只有对 `ConfirmModelPullUseCase`
（`.../huggingface/confirm-model-pull.use-case.ts:45`）的一次**单独**调用——只能通过
`POST .../pull-requests/:id/confirm` 到达——才会把该行移到 `confirmed` → `pulling`，并真正调用
`OllamaProvider.pullModel`。没有第三个 flag，也没有记录“这已被确认”的列——`pending_confirmation → confirmed`
这一转换本身**就是**第二次确认，而 `ConfirmModelPullUseCase` 拒绝（409，`ConflictException`）运行它两次：一个不再
处于 `pending_confirmation` 的行不能再次被确认。

### `repoId` 在请求体中传递，而不是在路由中 {#repoid-viaja-no-corpo-do-request-não-na-rota}

Hub 的真实 id 格式是 `<publisher>/<model>`（例如：`meta-llama/Llama-3.1-8B-Instruct-GGUF`）——在本应是路径段
`:repoId` 的地方出现 `/`，会破坏 Nest/Express 的单段路由匹配。`POST .../pull-requests` 在请求体中接收它
（`RequestModelPullDto`），这与 `apps/api/src/interfaces/http/git/code.controller.ts` 中出于同样原因对文件路径所做
的选择相同。

### 拉取在确认的 HTTP 请求内部同步运行 {#o-pull-roda-de-forma-síncrona-dentro-do-request-http-que-confirma}

`ConfirmModelPullUseCase` 会等待整个下载完成后才返回。api 没有可从它到达的后台 job 执行器——Oban 住在 Elixir 的
engine 中，而为此不存在从 api 到它的同步命令通道。发起拉取后立即返回，意味着在调用函数返回的那一刻就会丢失未处理
的异常，用例 `catch` 中的 `markFailed` 永远不会运行。`GET .../pull-requests/:id` 是为不想一直保持连接的人准备的
（反向代理或网关常常在几 GB 的下载完成之前就超时）——拉取本身会继续在服务器上运行，无论是否还有人在查询。

### 官方发布者 allowlist——ADR 0042 的规则，应用于一个新徽章 {#allowlist-de-publicadores-oficiais--a-regra-do-adr-0042-aplicada-a-um-selo-novo}

`HUGGINFACE_OFFICIAL_PUBLISHERS`
（`apps/api/src/domain/llm/huggingface-official-publishers.ts:17-26`）是一份简短的、手工策展的、区分大小写的
Hub 组织列表，这些组织被认可为其所发布内容的实际制造者（`meta-llama`、`google`、`mistralai`、`microsoft`、`Qwen`、
`deepseek-ai`、`openai`、`nvidia`）——这与 ADR 0042 已经对 LLM 目录保持的“绝不自动激活被发现的模型，策展始终是
手动的”是同一种姿态，在这里应用于“官方”徽章而不是激活。`isOfficialPublisher` 精确比较 `repoId` 的发布者段，不做
大小写归一化：Hub 本身区分大小写（`Qwen`，不是 `qwen`），而归一化会让一个**不是**官方组织的小写重新上传意外获得
徽章。

`SearchHuggingFaceModelsUseCase`（`.../huggingface/search-huggingface-models.use-case.ts:28`）**默认**过滤出
`official: true` 的结果；`includeCommunity: true` 返回所有发布者，每个都标记为 `official`/非官方，并且从不隐藏这一
区别。web 一侧（`apps/web/src/components/HuggingFaceModelBrowser.tsx:190-203`）把这个选择画成一个默认关闭的开关，
外加一个持续存在的、明确的、危险色调（`Alert tone="danger"`）的警告横幅，它只在显示社区结果时出现——选择性启用
与风险警告是同一个动作，绝不是有人开启一次就忘了它已经开启的设置。

## 后果 {#consequências}

**调用者必须遵守的路由格式偏离。** `repoId` 是请求体字段，绝不插入 URL 路径——在路由中有记录，并在这里重复，以免
未来的某次编辑把它“简化”回路径参数，重新引入段内 `/` 的缺陷。

**一个真实且已声明的裁剪：没有队列。** 同步拉取是有意的交换，而不是疏忽——在用例自己的注释中被标为值得写 ADR，
本 ADR 就是那个 ADR。如果拉取量哪天证明额外的复杂度是值得的，api 中真正的后台队列是自然的下一步；这里没有任何东西
阻止以后构建它。

**拉取的模型以与任何其他本地 Ollama 模型相同的方式获得价格和激活。** `ConfirmModelPullUseCase` 以价格
`0`/`manualPricing: false` 插入 `models`（镜像 `sync-model-catalog.use-case.ts` 对其他每个本地 Ollama 条目的处理），
并通过 `WorkspaceModelRepository.setActive` **只为提出请求的 workspace** 激活该模型。这不是对 ADR 0042 “绝不自动
激活被发现的模型”规则的违反——那条规则针对的是后台同步发现了某个没人要求的东西；这里的激活是一个人两次（请求，
然后确认）要求这个确切模型的直接、可追溯的结果。

**显示的名称是原始的 `repoId`。** 拉取的模型的 `displayName` 就是 Hub 对它的称呼（例如：
`meta-llama/Llama-3.1-8B-Instruct-GGUF`），从不重新格式化——留作以后的产品/UX 问题，这里不解决。

**Hub 搜索的响应如今不带尺寸估计。** 确认时显示的估计只来自客户端在调用 `POST .../pull-requests` 时已知的东西
（`estimatedSizeBytes`，未提供时总是 `null`）——搜索端点不填写它，因此确认界面通常会显示“não informado pelo Hub”，
而不是一个真实的数字。这与产品声明的绝不伪造估计的规则一致；这不是 bug，而是 Hub 搜索响应目前所暴露内容的真实
限制。

## 考虑过的替代方案 {#alternativas-consideradas}

- **复用 `proposed_actions`。** 出于上文“决策”中追溯的理由被拒绝：没有可以挂靠的会话；一个为 agent 自主级别构建、
  不适用于人自己请求的策略解析阶段；一个封闭的 `ActionType` 词汇，其 UI 表面是为另一个问题构建的；以及一个“第二次
  确认”，它是直接动作的安全闸门，而不是批准/拒绝他人提议的闸门。
- **在单步请求上使用一个布尔 flag `confirmed`，而不是状态机。** 被拒绝：两次请求的形式（`create`，然后一次单独的
  `confirm` 调用，两条路由都按角色拦截）才是让确认**明确且可复查**的东西——在创建的同一个请求中翻转的 flag，会把
  产品明确希望分开的两步合并在一起，而 `ConfirmModelPullUseCase` 拒绝重新确认，正是直接源自把它建模为状态而不是
  flag。
- **对官方徽章使用不区分大小写的发布者匹配。** 被拒绝：Hub 本身把发布者名称视为区分大小写，而归一化会把“官方”
  徽章交给官方组织名称的小写重新上传——这恰恰是一个不那么谨慎的第三方发布者会故意选择的那种名字。

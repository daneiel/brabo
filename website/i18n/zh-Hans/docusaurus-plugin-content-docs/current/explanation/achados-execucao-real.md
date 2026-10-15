---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# 流水线真实执行中的发现

> 在 **2026-08-05** 通过浏览器引导的一次执行会话中调研，使用 API 模型（非本地）和真实的 git provider。这是
> FASE 13c 分类的输入：每个条目都有证明它的 arquivo:linha 或事件，没有一个是"顺带"修正的——已关闭的那些
> 都有命名的 PR。


通过向导在 GitHub 上**创建**（而非采用）的项目。真实仓库：`daneiel/hello-api`，私有。向导的会话：
`f15b0cc9`。健康的会话：`36abf7e7`。

## 执行期间修正的（曾阻塞） {#corrigidos-durante-a-execução-bloqueavam}

1. **测量器没有在测量**（PR #136，已合并）——`db.execute` 被当作数组解构 + 智能体从事件的执行者而不是载荷中
   读取。
2. **`llm_turn_stream` 没有 `receive_timeout`**（PR #137，已合并）——落到了 Req 默认的 15 秒；4 个会话型
   智能体只走这条路。
3. **`ApprovalCard` 让会话界面崩溃**（待提交）——web 的 `ActionType` 是后端的子集；对
   `git_repo_create`/`git_branch_create`/`git_branch_protect`，`ACTION_ICON[actionType]` → `undefined`，而这
   正是**每个**在 provider 上创建的项目都会生成的。"通用回退"只存在于注释中。它只是没有出现在**采用**的项目
   中（没有 bootstrap）。

## 未关闭的——供 13c 分类 {#abertos--para-a-triagem-da-13c}

### A. 配置阶段的会话诞生时在 engine 中没有进程（严重） {#a-sessão-do-provisionamento-nasce-sem-processo-no-engine-grave}

> **已关闭**——成为了 [RN-067](../business-rules/custo.md#rn-067)。下面引用的四个调用点改为通过
> `CreateSessionUseCase` 创建会话（`provision-repository:119` 和 `:125`、`adopt-repository`、
> `activate-execution`），而规则声明它是创建会话的**唯一**地方。之所以保留记录，是因为下面的对比证明是让缺陷
> 变得可见的东西。

`CreateSessionUseCase` 是唯一在 outbox 中发出 `session.created` 的地方。以下这些直接在仓库中创建会话，跳过了
它：
- `apps/api/src/application/use-cases/git/provision-repository.use-case.ts:112` 和 `:121`
- `apps/api/src/application/use-cases/git/adopt-repository.use-case.ts:176`
- `apps/api/src/application/use-cases/execution/activate-execution.use-case.ts:156`
  ← 这就是 DEV AGENTS 运行的会话

效果：engine 永远不知道会话存在 → 永远的 `REFUSED JOIN`，没有通道，没有实时更新，没有心跳，会话**永远不会
关闭**（永远保持 `active`）。UI 只在控制台中抱怨。

对比证明：
| 会话 | `session.created` | `engine.session_states` | 通道 |
|---|---|---|---|
| 向导 `f15b0cc9` | 否 | 空 | `REFUSED JOIN` |
| 正常路由 `36abf7e7` | 是 | `active` | `JOINED` |

### B. 启动模型（用户的决定） {#b-modelo-de-start-decisão-do-usuário}
会话总是诞生在 workspace 的默认值上（`llama3.2:1b`，本地）——ADR 0020 在语义步骤中禁止本地 7B/1B，在两个会话中
都必须手工更换。请求：可配置的启动模型，在这个场景下继承 **Criativo** 的模型，因为它总是项目的入口。

### C. 说话的是模型，而不是智能体（缺陷，由用户指出） {#c-quem-fala-é-o-modelo-não-o-agente-defeito-apontado-pelo-usuário}
实时传输的气泡带着**模型**的名字作为标签（"DeepSeek V4 Flash Latest"）；只有当持久化的事件到达时，智能体
（`po`）才出现。效果：错误的名字先出现，消息在屏幕上**重复**（流的气泡 + 事件的气泡）。流没有与持久化的事件
对账。

### D. 不可能的步骤把向导卡住而没有出路 {#d-passo-impossível-trava-o-wizard-sem-saída}
`Proteger branches` 在免费计划的私有仓库上失败——向导本身事先就**提醒**了这一点。但之后提供的唯一操作是
"重试"，它总是会失败。缺少确认并继续的方式。

### E. 仓库预览在撒谎 {#e-preview-do-repositório-mente}
`apps/web/src/routes/NewProjectWizard.tsx:331` 有硬编码的 `repo: brabo/{slug}`。真正的 owner 来自 PAT
（`createForAuthenticatedUser`），也就是 `daneiel/hello-api`。这个错误一直到达**确认**界面。

### F. 向导宣布了 `rc` {#f-wizard-anuncia-rc}
"Política de branches" 步骤把 `rc` 列在永久分支中，并在级联中列出 `rc ← qa`。现行策略只有
`dev`/`qa`/`main`；`rc` 的回归在 ADR 0030 的 backlog 中。

### G. Criativo 的邀请在已创建的项目中不出现 {#g-convite-do-criativo-não-aparece-em-projeto-criado}
空状态 "A vez é sua" 只在对话流为空时渲染。在已创建的项目中，对话流已经有 bootstrap 的卡片，因此用户收不到
任何邀请。

### H. 通用的活动信息流 {#h-feed-de-atividade-genérico}
bootstrap 的 10 个事件全部显示为 "atividade em system"，而不说明发生了什么。

### I. 动作卡片显示会话的**当前**模型 {#i-card-de-ação-mostra-o-modelo-atual-da-sessão}
更换会话的模型会追溯地改写旧动作卡片的标签。`token_usage` 冻结了正确的价格；只是界面的问题。

### J. Psicólogo 在空会话中运行 {#j-psicólogo-roda-em-sessão-vazia}

> **已关闭**——成为了 [RN-079](../business-rules/custo.md#rn-079)。分析只在有**可分析**的事件时才运行，而
> "可分析"排除了 bootstrap 的机器步骤和分析者自己的痕迹——没有第二个排除，第一次分析就会让会话永远显得有内容。
> 没有材料时，发出 `psychologist.analysis_skipped`，不花任何钱。发现中的会话被复现为测试（14 个事件，没有一个
> 可分析）。
在刚打开的会话 `b2fceb9e` 中：它收到了上一个会话的假设和新会话的日志（空的），试图引用不存在的 `seq 60-78`，
证据被拒绝 2 次后放弃了（`psychologist.analysis_failed`）。验证拦住了编造——但在没有事件的会话上运行分析是白白
花钱。

### K. 重复的业务规则没有去重 {#k-regra-de-negócio-duplicada-não-é-deduplicada}

> **部分关闭**——成为了 [RN-080](../business-rules/custo.md#rn-080)。**完全**重复（标题相同，忽略大小写、
> 重音和空格）在发出时被拒绝，范围是项目——它正是在会话之间产生的。**语义**重复仍未关闭并如此声明：把
> "Saudação com nome" 与 "Quem chama pode se identificar" 区分开是判断，不是 `if`。
在同一个项目中运行两次 Criativo 留下了 10 条规则，5 条孤立（"descoberta — sem história"）。这是我的剧本造成的
效果，不是产品的，但它表明既没有去重也没有提醒。

### L. 底部按钮变得过时 {#l-botão-do-rodapé-fica-obsoleto}
在对话流已经交给 PO 之后，它仍然是 "Estou pronto para produzir"。

## 按设计工作的（也要记录） {#funcionou-como-projetado-registrar-também}
- RN-059：持久的 `agent.error`，带 `origem: infra`，智能体在对话流中说话并回到 `idle`（在 15 秒超时中看到
  2 次）。
- Psicólogo 的证据验证拒绝了编造的事件 id。
- GitHub 上的 Gitflow bootstrap：5 步中 4 步，真实仓库带有 `main`/`dev`/`qa`。
- proposed_action 管道：bootstrap 的 6 个动作，由策略自动批准。
- 12c：手动晋升作为默认，`story_promotion_proposed` 作为提议。
- 规则 ↔ 用户故事的可追溯性，区分已覆盖和未覆盖。
- bootstrap 的实时进度，失败时显示 GitHub 的消息。

### M. ARQUITETO 看不见自己的 module_map（P1——这一轮的失败） {#m-o-arquiteto-é-cego-ao-próprio-module_map-p1--a-falha-da-rodada}

> **已关闭**——成为了 [RN-066](../business-rules/custo.md#rn-066)，并在本页最后一节中在生产中得到确认：
> `assign_story_modules` 调用 4 次而不是 18 次，零个编造的名字，1 个 module_map 而不是 4 个。

会话 `36abf7e7`，seq 80-131。Arquiteto 发出了映射（模块 `saudacao` 和 `api_http`），然后**无法重新读取它**。
没有读取现行 module_map 的工具，而 `assign_story_modules` 的拒绝不返回有效的名称。结果：暴力尝试。

18 次以上的猜测：`api`、`core`、`http`、`greeting`、`domain`、`web`、`hello-api`、`hello`、`greeting-api`、
`saudacao`（碰巧猜中）、`app`、`server`、`publico`、`public-api`、`api-publica`……

用它自己的话说（seq 94、99、124）：
> "os nomes que tentei (`api`, `core`) não batem. Vou **descobrir os nomes
> válidos testando candidatos plausíveis**"
> "Preciso **descobrir os nomes reais** dos 2 módulos. Vou **testar candidatos
> adicionais**."

三个后果，按严重程度排列：

1. **错误的数据，被宣称为正确。** 4 个用户故事都落在 `["saudacao"]` 上，包括 ENDPOINT 的那个。`api_http` 没有
   任何用户故事。而结果（seq 130）断言："Todas as 4 histórias foram vinculadas com sucesso aos módulos."
   日志以一个自信的谎言结束。
2. **破坏下游的执行。** `activate-execution` 为每个**模块**启动一个 dev agent。一切都在 `saudacao` 中时，模块
   `api_http` 收不到智能体，设计的架构也不是将要构建的那个。
3. **`assign_story_modules` 没有记录任何 `tool.result`。** 整个循环在 event log 中不可见——只能从重复的
   `tool.call` 推断。

循环的成本：Arquiteto 的 9 次 LLM 调用，27.804 输入 / 8.012 输出。会话总计：7.271 micros（US$ 0,007）——便宜
只是因为它是 flash 模型。

module_map 的循环（PR #135）是这个问题的**症状**：Arquiteto 重新发出映射，正是为了试图固定它无法读取的名称。
#135 关闭了数据损坏；盲目仍然存在。

## 执行（项目 17229425，执行会话 dbb84ce8）——2026-08-05 {#execução-projeto-17229425-sessão-de-execução-dbb84ce8--2026-08-05}

### N. 执行那一半只在 `local` provider 下工作（P1，阻塞 13b） {#n-a-metade-de-execução-só-funciona-com-provider-local-p1-bloqueia-a-13b}
`Engine.Projects.ProjectRepository.get_local_repo_path/1` 对任何不是 `local` 的 provider 返回
`{:error, {:unsupported_provider, "github"}}`。这在 moduledoc 中被记录为范围削减：

> "Só suporta o provider 'local' (github/gitlab remotos ficam fora de escopo do
> executor de terminal por ora)"
> — `apps/engine/lib/engine/projects/project_repository.ex:25-27`

五个调用点依赖它：
- `lib/engine/dev/worktree_manager.ex:20`——dev agent 的 worktree
- `lib/engine/actions/terminal_executor.ex:39`——命令执行
- `lib/engine/gates/diff.ex:17`——QA 和 SecOps 读取的 diff
- `lib/engine/harness/project_context.ex:30`——项目上下文

观察到的效果：我在 GitHub 项目上激活了执行，3 个 dev agent 启动了，各领取了一个 task，然后 3 个在同一秒内以
`falha ao preparar o worktree` 被阻塞。

不对称是关键：**api** 通过 HTTP 与 GitHub 对话（是它创建了仓库、提交了模板并创建了 dev/qa）。**engine** 在
文件系统上工作，只认识本地 bare repo。因此 GitHub 上的项目完成了**会话**那一半（Criativo、PO、Arquiteto）和
bootstrap，但没有完成**构建**那一半。

对 FASE 13b 的后果：CLAUDE.md 的剧本（"projeto ADOTADO do fork via GithubProvider remoto, DevAgent real, dev
implementa → PR remota → gates"）**今天无法执行**。这不是顺带的 bug：支持远程需要克隆、engine 内部的凭据和
推送——是一个带 ADR 的功能。

### O. dev agent 诞生在本地模型上（与发现 B 同根） {#o-dev-agent-nasce-no-modelo-local-mesma-raiz-do-achado-b}
三个 dev agent 以 `Llama 3.2 1B (local)` 启动，继承自 workspace 的默认值。ADR 0020 在语义步骤中禁止小型本地
模型，而写代码的 dev agent 是存在的最昂贵的语义步骤。

### P. 没有来源的阻塞事件 {#p-evento-de-bloqueio-sem-origem}
`{"origin": null, "reason": "falha ao preparar o worktree", "diagnosis":
"{:unsupported_provider, \"github\"}"}`。CLAUDE.md 要求每个失败结果都记录**来源**（infra | modelo | código |
política）。这里是 `código`（产品的已知限制），而它是 `null`。诊断救了场，但规则没有被遵守。

### Q. 带"不确定来源"的 `agent.error` {#q-agenterror-com-origem-indeterminada}
在 Criativo 中，轮次被中止：对话流显示 `falha · origem indeterminada`。RN-059 起了作用（持久的错误，智能体
说话了，干净的恢复），但"不确定"不是四种来源之一——它是 ADR 0020 禁止的排除法诊断。

### R. PO 生成了重叠的用户故事 {#r-po-gerou-histórias-sobrepostas}

> **部分关闭**——成为了 [RN-081](../business-rules/custo.md#rn-081)。标题相同的被拒绝；对其引用的规则不增加
> 覆盖的用户故事变成 `backlog.story_overlap_warned`，是提醒而不是阻止。**这个发现中确切的那一对仍然通过**——
> 同一端点的不同标题和理由，没有任何机械的东西把它们联系起来。有一个测试断言这个限制，使它可见而不是隐含。
"Endpoint público de saudação determinística" 和 "Endpoint público GET /hello que responde saudação
imediata" 覆盖同一个端点。没有去重也没有提醒。

## hello-limpo 的执行（项目 `9c7c84f0`，会话 `1f94de49`）——2026-08-06 {#execução-do-hello-limpo-projeto-9c7c84f0-sessão-1f94de49--2026-08-06}

真实的 dev agent，通过 OpenRouter 的 DeepSeek V4 Flash，审批管道开启，每个动作都手工决定。task 是
"Expor rota GET pública /api/saudacao"。它从未开始：**18 个轮次，292.211 个输入 token，US$ 0,0275，零行代码
被写下**，这一轮以 provider 的错误结束。

### S. 累积的上下文超出 provider 的限制并**杀死**执行（P1） {#s-o-contexto-acumulado-estoura-o-limite-do-provider-e-mata-a-execução-p1}

在第 18 个轮次，对模型的调用返回
`{413, %{"message" => "request entity too large", "statusCode" => 413}}`，`ToolLoop` 无法继续，task 被阻塞
（`dev.blocked`、`artifact.task_blocked`，seq 151–152）。

原因是机械的且累积的：每个终端命令都把完整输出倒进循环的历史中，而历史随之后的**每一个**轮次一起传送。
`token_usage` 中记录的最大**成功**请求是 28.993 个输入 token；失败的那个根本没有记录用量。溢出的是**请求的
字节大小**，而不是上下文窗口——一个输出很长的 `find` 或 `git ls-files` 按字节计比按有用 token 计重得多。

这与 [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) 直接相关，从一个 ADR 没有预见的角度：
审批阶梯不仅让执行更昂贵，它还**杀死**执行。每次向用户提问都会推动智能体再执行一个探索性命令，其输出永远进入
历史。这场赛跑在第一行代码被写下之前就以 413 结束。

分类需要决定的是修复归谁——`ContextManager`（按大小而不只是按时间压缩或截断工具输出）、终端执行器（每次输出的
字节上限，带截断标记），还是两者。目前路径上的任何地方都没有上限。

- **证据：** 会话 `1f94de49` 的 `session_events` seq 150–152；执行者 `dev-http-api` 的 `token_usage`。

### T. 故障来源仍在四种之外（P 和 Q 的复发） {#t-a-origem-da-falha-continua-fora-das-quatro-recorrência-de-p-e-q}

发现 S 的 `dev.blocked` 记录了：

```json
{
  "origem": "indeterminada",
  "reason": "parou sem concluir nem reportar bloqueio",
  "diagnosis": "falha na chamada ao modelo: {413, %{\"message\" => \"request entity too large\", \"statusCode\" => 413}}"
}
```

这不是新发现：它是同一条规则被违反的**第三次**，因此作为复发而不是单独条目记录。[P](#p-evento-de-bloqueio-sem-origem)
在一个 `dev.blocked` 中抓到了 `origin: null`；[Q](#q-agenterror-com-origem-indeterminada) 在一个 `agent.error`
中抓到了 `"indeterminada"`。这里两者相遇：阻塞事件，值为 `"indeterminada"`。

这次出现增加了什么、使这个案例比之前的更有力：**来源是可以轻易推导的**。provider 的一个已知 HTTP 状态就是
`modelo`，没有任何歧义——`diagnosis` 字段本身就在 `origem` 放弃的同一行中说出了它。这不是边界情况，而是错误
路径没有看自己刚刚写下的东西。

`reason` 也在撒谎："parou sem concluir nem reportar bloqueio" 描述的是沉默，而发生的是一次原因已识别的失败。
只在面板上读 `reason` 的人会得出模型迷路了的结论。

- **证据：** 会话 `1f94de49` 的 `session_events` seq 151。
- **被违反的规则：** CLAUDE.md（"todo desfecho de falha registra a ORIGEM —
  infra | modelo | código | política — nunca diagnóstico por eliminação"），来源于
  [ADR 0020](../adr/0020-destravar-gates-qa-secops.md)。

### U. 终端执行器没有项目边界（P1） {#u-o-executor-de-terminal-não-tem-fronteira-de-projeto-p1}

在执行动作的容器内部，`/workspace` 是 **Brabo 自己的 monorepo**——不是项目的 worktree，后者位于
`/data/project-workspaces/<projectId>/.worktrees/<agentId>`。

`hello-limpo` 的 dev agent 在那里花了好几个轮次，以为那是它的项目：读了 `apps/engine/mix.exs`，甚至提议
`cat lib/engine/actions/git_executor.ex` 和 `sed -n '1,120p' lib/engine/dev/context_builder.ex`——正在执行它的
平台的 git 执行器和上下文构建器。

而范围不止于 Brabo。对 `/data/project-workspaces/*/` 的一个 `for` 列出了**另一个项目**
（`dbd3e508-e0c7-4e29-b134-5d393f518269`）的 worktree 及其提交和文件；智能体提议的下一步是进入它读取
`git remote -v` 和 `git log`。这被手工拒绝了。

这一切都不是模型的恶意：它在寻找自己的项目，而文件系统不告诉它项目在哪里结束。在多租户部署中，同样的命令会
读取另一个客户的仓库。

[ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) 设计了其中的**策略**那一半，并明确说明它
不解决另一半：路径范围依赖于规则判断正确，缺少的是**隔离**——按项目的挂载，或按项目的容器。这个发现就是 ADR
声明为未决的那一半。

- **证据：** 会话 `1f94de49` 的 `proposed_actions` `d1bfeda3`（被拒绝）和 `56374def`（被批准，列出了另一个
  项目）。

### V. 执行仍在继续时会话显示为 `closed`（P2） {#v-sessão-consta-closed-enquanto-a-execução-continua-p2}

`1f94de49` 的 `sessions.status` 自 **23:34:42** 起就是 `closed`，即诞生三十秒后。执行一直持续到 **00:56**——
智能体工作了一个多小时，提议动作并花费 token，而数据库认为这个会话已经结束。

两边同时不一致：UI 显示 "Sessão closed — não é possível enviar mensagens"，**并且**渲染审批卡片，而它们正常
工作。在已关闭的会话中批准会真的执行命令。

这违背了 CLAUDE.md 声明的状态机（`created → active → closing → closed | closed_abnormally`）：`closed` 应该是
终止状态。它还毒害了任何按会话的测量——持续时间、成本以及"有多少会话顺利结束"读取的是一个不描述实际发生情况
的状态。

我没有调查是谁写入了 `closed` 以及为什么；那是处理它的阶段的工作，不是分类的工作。

- **证据：** `sessions.updated_at` = 23:34:42，`status = closed`；同一会话的 `session_events` 一直到 seq 152，
  在 00:56:46。

## 本轮在生产中确认的 {#confirmado-em-produção-nesta-rodada}
- **RN-066**（Arquiteto 的盲目）：`assign_story_modules` 调用 4 次而不是 18 次，零个编造的名字，1 个
  module_map 而不是 4 个，每个用户故事都在语义正确的模块中。会话成本从 7.271 降到 3.259 micros。
- **RN-067**（没有进程的会话）：执行会话 `dbb84ce8` 出现在 `sessions` **和** `engine.session_states` 中——之前
  `activate-execution` 的会话生来就是孤儿。

## Fase 12 验证的执行——2026-08-07 {#execução-da-validação-da-fase-12--2026-08-07}

`pnpm --filter api validacao:fase-12` 的第一次真实运行，即待办 13a.1。标准闭合了（退出码 `0`），但只是在四次
修正之后——三次在**工具**中，一次在**产品**中。工具的那些在 [validacao-fase-12.md](validacao-fase-12.md) 中
叙述；这是产品的那一次。

### W. 模块队列清空时 dev agent **死掉**（P1）——已关闭 {#w-dev-agent-morre-quando-a-fila-do-módulo-esvazia-p1--fechado}

队列为空时，`POST /internal/sessions/:id/tasks/claim` 以 `content-length: 0` 返回 `201`。用例返回 `null`，但
NestJS 把它序列化为**空**正文——`Req` 交付 `""`，而它不是 `nil`。

`AgentIo.try_claim/2` 匹配到找到 task 的子句并调用 `run_task("")`，在 `Map.get("", "id", nil)` 上抛出
`BadMapError`。由于服务器是 `restart: :temporary`，智能体彻底死掉，`Monitor` 紧随其后删除状态行。

**这对真实的 dev agent 也成立**，不只是 Noop：`try_claim/2` 位于共享的 `AgentIo` 中。而它在最常见的结果——
队列耗尽——时触发。效果恰好与 Fase 12b 交付的相反：不是受监督、可由事件唤醒的 `dev.idle`，而是死掉的进程。

测试套件从未抓到，因为假实现正确地返回 `nil`。**只有真实执行才会暴露**——这字面上就是本阶段的论点。

> **已关闭**——在边界处修正（`EngineApiClient.claim_task/4` 规范化空正文），并在契约中守护
> （`AgentIo.try_claim/2` 把 `""` 与 `nil` 一起接受），没有改动路由的 HTTP 状态。FASE 13 冻结的例外由用户
> 授权，理由与阶段 F 相同：没有它就无法进行测量。经变异验证。

## 针对远程 GitHub 的真实执行（FASE 13b）——2026-08-07 {#execução-real-com-github-remoto-fase-13b--2026-08-07}

第一次针对真实远程仓库（`daneiel/test`）的执行，使用真实 dev agent 和 `openai/gpt-5-mini`。直到晋升的链条完整
通过了；dev agent 没有。细节和测量在 [validacao-real.md](validacao-real.md) 中。

### X. dev agent 在空仓库中烧掉迭代上限（P1） {#x-o-dev-agent-queima-o-teto-de-iterações-em-repositório-vazio-p1}

在一个刚配置的仓库中的 task *"Expor GET /saudacao"*——只有 Gitflow 的模板，没有代码。智能体把八次迭代都花在
`search_workspace`/`read_file` 上寻找"项目在哪里"，**从未运行过命令，也从未写过文件**。阻塞：
`limite de iterações
atingido`，来源 `modelo`，诊断 `(nenhum terminal rodado)`。

来源 `modelo` 在技术上是对的，在实践上毫无用处：模型并没有判断错误，它根本没走到判断那一步。成本：8 次调用，
205 个输出 token。

这是 dev agent 从绝对零开始的**第一个**场景——所有测试和演示都从有代码的 workspace 开始。

### Y. `search_workspace` 不区分"空"与"没找到"——已关闭 {#y-search_workspace-não-distingue-vazio-de-não-encontrei--fechado}

前五次调用返回 `nenhum resultado`，智能体把它理解为"再仔细找找"，而不是"这里什么都没有"。它是发现 X 中可以
着手的那一块。

> **已关闭**——工具开始对不同的情况作出不同的回答。没有任何文件的 workspace 返回 *"o workspace
> está VAZIO […] CRIE os arquivos necessários (write_file) em vez de continuar
> procurando"*；有文件的 workspace 返回计数，说明搜索工作了，只是这个词没有出现。
>
> **修正是这句话，不是上限。** 智能体不需要更多迭代——它需要知道没有可找的东西。而发现中的情况（只有
> bootstrap 的 `.github/` 和 `docs/`）**不是**空的：有一个测试断言在那里正确的答案是计数，而不是创建的指示。
>
> **新的执行做了，而 X **没有**关闭。** 同样的结果——`limite de iterações atingido`，8 次调用，没有 PR。
> 行为改变了（一次搜索而不是五次），结果没有。认为这句话是原因的假设是**错的**：八次迭代中七次是探索，只剩
> 一次用来写、提交、推送并打开 PR。
>
> **上限才是原因。** 用 `TOOL_LOOP_MAX_ITERATIONS=25`，dev agent 进行了探索，写了**三个**文件并运行了
> `npm test`——并停在 `dev.awaiting_approval`，而不是阻塞。8 的上限是为会话型智能体而生的，不适合需要在行动
> 之前理解仓库的 dev agent（`apps/engine/config/runtime.exs:100`）。
>
> X 不再是"探索时烧掉上限"，而变成**"上限对这个智能体来说是错的"**。产品修复**不是**提高全局默认值——
> Criativo 对话不需要 25 次迭代。它是按智能体类型的上限，这是产品决定：留在分类中。
>
> **在 FASE 14d 关闭**（[RN-085](../business-rules/custo.md#rn-085)）。上限在 `Engine.Harness.Iteracoes` 中
> 改为按类型：对话者 `8`，dev agent 和 QA 子智能体 `60`。谁能提高的标准不是"工作量大"——而是下面有
> `token_budget_micros` 控制花费，这就是为什么 `infra-workflows` 使用重型工具却**保持 8**：它在没有预算的
> 情况下运行，对它来说上限是唯一存在的锁。

### Z. 终端允许列表管辖**动词**；范围只保护**路径** {#z-o-allowlist-de-terminal-governa-o-verbo-o-escopo-protege-só-o-caminho}

上限解决后，执行开始停在终端审批上。2026-08-06 的请求是 *"permita sempre comandos desde que seja na pasta do
projeto"*；ADR 0055 交付了一个**上限**（文件夹之外永远不自动批准），而动词仍由封闭列表管辖。

放行 `npm`/`pnpm`/`node`/`npx` 还不够：智能体运行了 `ls -la`。每个新动词都落入 `require_approval`。

这不是 ADR 0055 的缺陷，它从未承诺晋升动词——这是所请求与所交付之间的缺口，它让阶梯继续存在。

### 按设计工作的（也要记录） {#funcionou-como-projetado-registrar-também-1}

**Psicólogo 自己作出了诊断**，在重型层级，阅读失败执行的 event log——并以比脚本的任何断言都更高的精度说出了
两个原因：缺少终端的 `tool.call`，以及 `search_workspace` 误导了智能体。产品的内省是有效的。

### AA. 自动批准的 `pr_open` 没有凭据，在远程上总是失败（P1） {#aa-pr_open-auto-aprovado-não-tem-credencial-e-sempre-falha-em-remoto-p1}

> **已关闭**——成为了 [RN-082](../business-rules/custo.md#rn-082)。api 改为按 workspace 的 OWNER 解析 git
> 凭据，复用与 RN-058 相同的解析器，而不是重新实现这条规则。经变异验证。

在 13b 的第 5 次执行中发现，这是链条第一次到达 PR。

`ExecuteGitActionUseCase` 从 **`action.decidedBy`**——**决定**该动作的用户——解析 git token
（`execute-git-action.use-case.ts:100`）。当策略自动批准时，没有人决定：`decided_by` 保持 NULL，
`accessToken` 保持 `undefined`，GitHub 回应 `Requires authentication`。

同一次运行中的对比就是证明：

| 动作 | 谁执行 | 凭据 | 结果 |
|---|---|---|---|
| `git_push` | **engine** | 从 owner 注入（`git_auth.ex`，RN-076） | ✅ executed |
| `pr_open` | **api** | `action.decidedBy` → NULL | ❌ failed |

推送到达了 GitHub——分支 `feature/task-d4b36a5b` 存在于远程。失败的只是打开 PR 的 REST 调用。

这与 [RN-058](../business-rules/custo.md#rn-058) 为 LLM 修正的是同一类（"智能体花的密钥是 OWNER 的"）：api 的
git 路径仍按"谁决定的"而不是"workspace 是谁的"来解析。

**实际后果：** 在配置了自治的情况下——这正是阶段 F 要使之可行的模式——没有任何 dev agent 能在远程 provider
上打开 PR。这条路径只有在人类点击每个 PR 时才工作，而这正是被宣布不可行的阶梯。

### AB. **GATE** 智能体不会等待审批——变成 `infra` 失败（P1） {#ab-o-agente-de-gate-não-sabe-esperar-aprovação--vira-falha-infra-p1}

> **已关闭**——[ADR 0057](../adr/0057-o-gate-espera-a-aprovacao.md)。gate 智能体现在会**挂起**并恢复，就像
> 自 ADR 0052 起的 dev agent：子智能体返回带有整个 `ctx` 的 `{:awaiting, ...}`，`QaLeadServer` 保存进行中的
> 状态，为子智能体订阅 `Wake`，并在决定到达时从停下的地方继续该领域。
>
> 待处理期间，该领域**不**合并、不发出裁决，也不阻塞 task——它在等待。拒绝也会恢复，用原因代替结果。
>
> 声明的限制：在等待中途重启会丢失循环，因为 `pendente` 存在于 lead 的内存中。当 task 回到周期时，gate 由
> `Dispatcher` 重新运行。

### AC. 重定向（`2>/dev/null`）让任何命令都无法批准（P1） {#ac-redirecionamento-2devnull-torna-qualquer-comando-inaprovável-p1}

> **两个部件都已关闭。**
>
> 1. `parseCommand` 不再把 `>`/`>>`/`<` 当作分隔符——它们不串联任何命令。目标仍然作为片段的**词元**保留，
>    这是有意的：正是这样 `echo x > /etc/passwd` 仍被范围上限拦住。动词变得正确，而路径并没有因此放开。
> 2. `/dev/null`、`/dev/stdin`、`/dev/stdout` 和 `/dev/stderr` 不再算作用户路径。列表就是这些，而**不是**
>    整个 `/dev`——有一个测试断言 `/dev/sda` 仍在范围之外，因为放开 `/dev` 会把一个麻烦换成一个漏洞。
>
> 在两个方向上经变异验证：放宽 `/dev` 会让磁盘的测试失败，关闭串联会让 11 个测试失败。

在 13b 的第 7 次执行中发现，那是在把允许列表扩展到 25 个动词之后。QA 智能体运行了：

```
ls -la && echo "---" && cat package.json 2>/dev/null; echo "---"; ls *.md 2>/dev/null
```

**所有动词都已放行**——`ls`、`echo`、`cat`。即便如此它还是变成了 `require_approval`。对这个命令运行纯函数：

```
segmentos: [["ls","-la"],["echo","---"],["cat","package.json","2"],["/dev/null"],…]
tokens de caminho: ["/dev/null","/dev/null"]
no escopo? false
```

`parseCommand` 把 `>` 当作片段分隔符，因此 `2>/dev/null` 变成**一个独立的片段**。这以两种独立的方式出错：

1. 片段 `/dev/null` 的"动词"就是 `/dev/null` 本身，它永远不会在 `allow` 中——而复合命令要求**每个**片段都被
   放行；
2. `/dev/null` 是项目文件夹之外的**绝对**路径词元，因此 [RN-075](../business-rules/custo.md#rn-075) 的上限
   把 `auto_approve` 降级。

**影响很大，因为 `2>/dev/null` 是惯用法。** 模型一直用它来静默预期的错误。实际上，任何带输出重定向的命令
按策略都无法批准——只能靠人类点击通过。

这不是列表中缺了一个动词：是命令的**形式**。扩展允许列表解决不了，第 7 次执行就是证明——放行了 25 个动词，
还是卡住了。

两个不同的部件需要分类：

- `command-matcher.ts` 中按 `>` 的分段（预先存在的，而且有争议：重定向不像 `&&` 和 `|` 那样是命令的组合）；
- 把 `/dev/null` 当作用户路径的范围上限（`path-scope.ts`，来自阶段 F）。

### AD. 智能体把命令包在 `bash -lc` 里，而允许列表对此没有答案（P1） {#ad-o-agente-embrulha-comandos-em-bash--lc-e-o-allowlist-não-tem-resposta-p1}

13b 的第八次执行，发现 Y、AA、AB 和 AC 已经修正。dev agent 只做了**一次**工具调用：

```
bash -lc npm test --silent
```

动词是 `bash`。它不在 `allow` 中，变成了 `require_approval`。

**拒绝是对的，而且它对很重要。** 放行 `bash` 会让整个允许列表失效：`bash -lc <qualquer coisa>` 绕过动词检查，
包括内置的 `deny`。一个接受 `bash` 的允许列表就不是允许列表。

但这闭合了第 6、7、8 次执行一直在构建的论证：

| 执行 | 卡在哪里 | 我做了什么 |
|---|---|---|
| 第 6 次 | `head` 不在列表中 | 扩展到 25 个动词 |
| 第 7 次 | `2>/dev/null`（**形式**，不是动词） | 修正了解析器和范围（AC） |
| 第 8 次 | `bash -lc`（**调用方式**） | — |

每一轮都揭示了一个新类别，没有一个是"缺了一个动词"。**动词允许列表不收敛**，面对一个自由选择如何调用它想
运行之物的智能体——而这三种形态（动词、形式、调用）是不同的空间，而不是一个列表中的点。

这**不**意味着：允许列表是错的。它恰好做到了它承诺的，对 `bash` 的拒绝证明了边界有效。它做不到的是在没有人类
干预的情况下使智能体自治成为可能。

分类的两个方向，它们在性质上不同：

1. **可挂起的 gate 智能体**（发现 AB，未关闭的那一半）。它不消除审批——它让智能体**等待**审批而不是死掉，然后
   用户的点击是解锁而不是失败。这是 ADR 0052 已经为 dev agent 打开的路径。
2. **按智能体画像的策略。** 在隔离 worktree 中的 dev agent 与触碰用户 workspace 的智能体不同。目前两者使用同一个
   `permissions.json`。这是需要 ADR 的产品决定。

### AE. QA 智能体试图修复它所评判的代码（P2） {#ae-o-agente-de-qa-tenta-consertar-o-código-que-julga-p2}

在 13b 的最后几次执行中，基于 LLM 的 gates 终于运行起来，QA 子智能体**试图修正它正在评估的代码**——违背了
它自己的角色。评判者不修复：一个编辑它所分析之物的 gate 就不再是 gate，而变成又一个作者，裁决变成关于它自己的
工作。

**它没有成功，而原因首先是结构性的，其次才是策略性的。** QA 的工具注册表是
`[ReadFile, SearchWorkspace, Terminal, EmitQaVerdict]`
（`apps/engine/lib/engine/gates/qa_tools.ex:10`）：**不存在 `write_file`**。要写入，它必须经过 `terminal`——
在那里它遇到两道出于其他原因早已存在的屏障：

1. **动词允许列表**，管辖什么可以运行（[RN-075](../business-rules/custo.md#rn-075) 以及发现 Z/AD）；
2. **路径范围上限**，把项目文件夹之外的任何命令降级为 `require_approval`。

它们是**独立**的屏障：没有一个是为这种情况设计的，这就是为什么约束是可靠的——它不依赖于提示词说服模型。

**为什么是 P2 而不是 P1。** 没有任何东西泄漏：行为被尝试并被拦住了。发现记录的是**提示词要求的与模型所做的
之间的分歧**，而这种分歧就是数据——它说明单靠指令守不住角色，守住它的是结构性的屏障。

**没有测量的。** 尝试了多少次、确切在哪次执行、用的什么命令：第 9 次和第 10 次执行没有在
[validacao-real.md](validacao-real.md) 中记录细节，该文件只覆盖到第八次。在没有这些数字的情况下记录发现是有意
的——另一种选择是编造它们，而 Fase 10 的教训正是凭记忆记下的数字不作数。

**分类的方向**，与发现 AD 的"按智能体画像的策略"相同：gate 的正确工具与作者的不同。目前这种差异是通过遗漏获得
的（QA 的注册表不包括 `write_file`），这有效，但在任何地方都没有被声明为保证——等哪天有人"为了方便"加上这个
工具，它就消失了。

## **两个**模块的执行——2026-08-08 和 2026-08-09 {#execuções-com-dois-módulos--2026-08-08-e-2026-08-09}

两个用户故事，一个在 `api`，一个在 `web`，两个 dev agent **同时**启动。这样运行很重要，因为
[RN-083](../business-rules/custo.md#rn-083) 的并行上限只有在有真正独立的工作时才有意义——只有一个模块时，
Dev Lead 拒绝并行化，而且理由充分。

共三轮，它们的顺序就是论证：

1. **2026-08-08，出问题的那一轮。** `dev-web` 领取了 task，并在**第一个轮次之前**死于
   `fatal: not a git repository`：零 token 花费，task 被阻塞，智能体 `idle`。这就是下面的发现 AF。
2. **2026-08-08，紧接着修正之后。** `dev-web` 从 **0 次调用增加到 16 次**，两个模块被并行实现。
3. **2026-08-09（项目 `9443f1f1`，会话 `94428b1f`），测量。** 修正已就位的干净一轮，由 `medir:execucao` 完整
   提取：**3m56s，33 次调用，< US$ 0,01**，没有 engine 重启，没有沉默的轮次，两个 gate（`qa` 和 `secops`）
   都批准了。它可作为两个模块执行的成本基线。

### AF. 两个 dev agent 一起启动时会损坏彼此的 workspace（P1） {#af-dois-dev-agents-subindo-juntos-corrompem-o-workspace-um-do-outro-p1}

`Engine.Actions.Workspace.ensure!/4` 用 `:global.trans` 按项目串行化工作树的初始化——正是为了 N 个 dev agent
在执行激活时启动的情况。锁是对的。**决定是否值得去拿锁的守卫，不对。**

没有锁的快速路径询问 `.git` 是否存在（`apps/engine/lib/engine/actions/workspace.ex:51`）。而
`init_from_bare!` 以 `git init` 开始，它在**第一行**就创建了 `.git`——在 `fetch` 之前，也在 `checkout` 之前。
在这个窗口到达的人读到"就绪"，跳过整个锁，并对一个只做了一半的仓库运行 `git worktree add`：

```
fatal: not a git repository
```

**为什么它穿过十次执行都没有出现。** 只有当第二个智能体在初始化*期间*到达时窗口才存在，而激活只为每个模块启动
一个智能体。`module_map` 中只有一个条目时从来没有第二个智能体。这个缺陷属于 Fase 14d（并行），需要第一次真正
并行的执行才能显现。

**修正**是磁盘上的一个标记 `.brabo-workspace-pronto`，只在初始化**结束**时写入；快速路径改为询问它。锁没有换
地方——改变的是"已经就绪"的标准，它现在只在真正就绪时才为真。在标记存在之前创建的 workspace 被**采用并盖章**，
从不重新初始化：重新初始化会抹掉未提交的工作。

**这教会了我们关于没抓到它的测试的什么。** 已经有一个 8 个并发 `ensure/3` 的测试，而它**在有 bug 时通过**。
8 个全部一起出发，都看到空目录，都去拿锁——窗口从未被演练。尝试按时间复现它也行不通：对本地 bare 而言 `fetch`
结束得太快，一个追着窗口跑的测试总是通过而什么也没证明。

在 `apps/engine/test/engine/actions/workspace_test.exs` 中堵住漏洞的，是**手工构建中间状态**，而不是尝试为它
计时：在目录中做一次 `git init`，没有 fetch 也没有 checkout，这正是第二个智能体看到的东西。在旧守卫下
`ensure!` 返回目录而从不写入标记——而断言要求的正是标记的缺失。另外两个测试守护迁移（标记之前的 workspace 不被
重新初始化）以及两个并发 `ensure!` 的真实情况。

这与 Fase 14d 自身三个缺口的模式相同，记录在那里：**测试部件不等于测试通往它的路径。** 这里部件（锁）是正确的
并经过测试；做出错误决定的是通往它的路径。

---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0016 — Anamnese：熟练度画像、指令补丁与闭环

- 状态：已接受
- 日期：2026-07-24
- 阶段：4b（会话 2——结束第 4 阶段）

## 背景 {#contexto}

Psicólogo（ADR 0015）已经能产出带证据的假设，并发出
`psychologist.hypothesis_accepted_for_anamnese`——一个刻意没有消费者的事件，在那里被记录为“给 4.6 的钩子”。本次会话构建这个消费者：**Anamnese**，一个按项目周期运行的 Oban 任务，它从 event log 的时间窗口中按用户+能力推导 `proficiency_profile`，对 agent 文件提出 `instruction_patch`（带 diff、审批和回滚），并闭合“假设→补丁→版本”的循环。

验收标准：Anamnese 提出 1 个 diff 易懂的补丁；接受一个假设会让下一个补丁引用它；回滚会让 agent 回到之前的行为。

## 决策 {#decisões}

### 1. 护栏是结构性的，而不是一条 prompt 指令 {#1-guarda-corpo-é-estrutural-não-uma-instrução-de-prompt}

`domain/anamnese/competency-catalog.ts` 以确定性方式推导允许的目录：当前 `module_map` 中的技术栈（经规范化）+ 一份**硬编码**的流程能力列表
（`git`、`agile`、`arquitetura`、`testes`、`seguranca`、`infra`）。
只要任一条目引用了目录之外的内容，`validateProficiencyBatch` 就拒绝**整个批次**。

要点：一个试图输出“焦虑”、“心理健康”或“人格”的模型**没有任何会接受它的写入路径**——这项禁止不依赖 prompt 是否被遵守。prompt 加以强调，领域加以保证。有针对 8 个敏感属性的显式测试。

### 2. 删除画像就是真正删除——而退出（opt-out）阻止重新推导 {#2-apagar-o-perfil-apaga-de-verdade--e-o-opt-out-impede-a-re-derivação}

对这些行执行 `DELETE` + 在 `anamnese_opt_outs` 中写入一行。没有 opt-out，下一轮会重新推导出完全相同的画像，“删除”按钮就只是装饰。用户只有在显式 opt-in 后才会再次被画像。已 opt-out 的用户在**两**处被过滤（进入 prompt 的上下文和批次验证），因此既不会进入 prompt，也无法变成一行数据。

### 3. 指令历史存放在独立的只追加表中 {#3-histórico-de-instrução-em-tabela-append-only-separada}

`agent_instructions` 有 `unique(project_id, agent)`，并以破坏性方式递增 `version`——之前的内容会丢失，回滚不可能。

我们没有改造这张表，而是用 `agent_instruction_versions`（新建，只追加）保存历史，**`agent_instructions` 保持不动，作为“current”的指针**——这正是 engine 通过只读 Ecto 读取的内容。结果：engine 的 schema 及其测试 fixture 均无需任何改动。

**追溯回填**：本阶段之前播种的所有内容都有指令，但历史中没有任何版本。当历史为空时，`ApplyInstructionVersionService`
会在覆盖**之前**把当前内容捕获为一个版本——否则第一次回滚将无处可回。

### 4. 回滚是一个向前的操作 {#4-rollback-é-operação-pra-frente}

回退到 v2 会写入一个内容为 v2 的**新**版本。没有任何东西被删除或重写：可以“撤销撤销”，审计轨迹显示每次回退发生的时间。被恢复的版本保留原来的 `sourceHypothesisId`，因此可追溯性在回滚后依然存在。

`ApplyInstructionVersionService` 是内容变化的**唯一**入口（已批准的补丁和回滚都经过它），这保证了没有任何路径会忘记写入版本或使缓存失效。

### 5. 指令缓存：在所有根上执行 match-delete {#5-cache-de-instrução-match-delete-em-todas-as-raízes}

本次会话的发现：`InstructionFiles.invalidate/3` 存在，但**在生产中从未被调用**——只在测试中。更糟的是，缓存键是 `{project_id, agent, root}`，而 `root` 会变化（共享 workspace 为 nil，dev agents 为 worktree 路径），因此只使一个键失效会让 dev 继续提供旧指令。

新增 `Cache.delete_agent/2`（按
`{{project_id, agent, :_}, :_}` 执行 `:ets.match_delete`）+ `InstructionFiles.invalidate_all/2` +
内部端点 `POST /internal/projects/:id/agents/:agent/instructions/invalidate`，
由 api 在每次补丁/回滚后调用。

**已知且接受的限制**：每次 `run` 都组装 system prompt 的 agent（dev-*、QA、SecOps、Psicólogo、Anamnese——补丁的典型目标）在**下一次**执行时获得变更；对话型 agent（Criativo/PO/Arquiteto/Infra）在 `init` 时冻结 prompt，只有重启后才获得。在存活的 GenServer 中重建 prompt 被刻意放弃：那会触动第 3 阶段的 4 个 GenServer，而 CLAUDE.md 要求非必要不重构它们，并且验收标准不需要它也能满足。失效是**尽力而为**的——失效失败不会让补丁失败（内容已经在数据库里）。

### 6. 手写 LCS diff，不引入新依赖 {#6-diff-lcs-escrito-à-mão-sem-dependência-nova}

`domain/instructions/text-diff.ts`，约 60 行纯函数。理由（CLAUDE.md 要求为库给出理由）：输出格式已经由 `ApprovalCard.tsx` 中**已经存在**的渲染器决定
（`{kind: 'add'|'del'|'ctx', content, lineNo}`），指令文件只有几十到几百行（n·m 微不足道，不需要 Myers），而且仓库偏好经过测试的纯领域函数。`ProposeInstructionPatchUseCase` 已经以渲染器的格式交付 `files[].lines`——UI 没有获得自己的 differ。

### 7. “不重复提出被拒绝的补丁”，无需新表 {#7-não-repropor-patch-negado-sem-tabela-nova}

`isDuplicateOfRejected` 与状态为 `denied`、类型为 `instruction_patch` 的
`proposed_actions` 的内容进行比较——从已有数据推导，无需维护同步的新结构。规范化会忽略 CRLF、行尾空格和空白行填充（格式噪声），但**保留左侧缩进**（在 markdown 中可能改变含义），因此重新缩进算作不同的补丁。

### 8. 指令补丁永远不可自动批准 {#8-patch-de-instrução-nunca-é-auto-aprovável}

`decide.ts` 中的上限与合并锁同一精神：
`agent_autonomy` 和 `permissions.json` 都无法把
`instruction_patch` 提升为 `auto_approve`。这个功能的价值在于人先看到 diff；自动批准就成了 agent 在改写自己。

### 9. 通过显式队列而非 outbox 闭合循环 {#9-loop-fechado-por-fila-explícita-não-por-outbox}

`AcceptHypothesisUseCase` 在已发出的事件之外，向 `anamnese_queue`（按
`hypothesisId` 唯一，幂等）入队。在这里入队是确定性的——既不依赖 outbox 路由，也不依赖消费者在线。`Engine.Anamnese.Triage.should_run?/2` 让队列中的假设**总是强制**触发一轮（即使窗口内没有动静）：忽略它会破坏用户刚刚请求的循环。

完整链条：被接受的假设 → `anamnese_queue` → 该轮 prompt 中的“优先输入” → 带 `hypothesisId` 的 `propose_instruction_patch` → proposed_action 的 payload → 写入版本中的 `sourceHypothesisId` → UI 上的来源徽章。

### 10. 周期轮次：全局调度器，按项目扇出 {#10-rodada-periódica-scheduler-global-com-fan-out-por-projeto}

`AnamneseSchedulerWorker` 完全复用 `OutboxDrainWorker` 的惯用法
（`use` 中不带 `:unique`——正在执行的任务会与自己冲突并断掉链条；`unique:` 只在 `kickoff/0` 中，配合
`states: [:available, :scheduled, :retryable]`）。每 15 分钟一次 tick；
**子**任务按 `project_id` 设置 `unique`，因此一个慢项目不会堆积轮次。

Anamnese 是项目作用域的，但 `append_event`/`token_usage` 通过 FK 是会话作用域的——调度器选择项目最近的会话作为叙述的地址（先例：`repo_bootstraps` 使用一个专用会话）。没有任何会话的项目不运行。

未完成的轮次**不写入** `anamnese_runs`，因此该窗口会在下一轮重新处理（与 Psicólogo 同样的纪律）；没有新材料且队列为空的轮次**被跳过，不花费 LLM**。

## 后果 {#consequências}

- 新增 `SessionEventRepository.listForProjectInWindow`（api）和
  `Engine.SessionEvents.Event.list_for_project_window/4`（engine）——此前没有按时间窗口的查询。engine 直接从 Postgres 读取窗口（比通过 HTTP 传输日志更便宜），并 join
  `sessions`，因为 `session_events` 不带 `project_id`。
- 新增 `Engine.Sessions.ProjectSession`（只读）和
  `Engine.Projects.Project.list_ids/0`——engine 此前不知道如何列出项目，也找不到某个项目的会话。
- “批准/拒绝的命令”不是 session_events（只在 outbox + `proposed_actions` 表中，`rejectionReason` 以自由文本存放在那里）。本次会话中，窗口覆盖日志中的用户事件；从 `proposed_actions` 读取决策作为上下文的自然演进。
- UI：`ProjectSettingsTab` 中新增两个区块（带可点击证据和删除按钮的画像；带 diff 和回滚的版本历史），`ApprovalCard` 中新增 `instruction_patch` 分支并带来源假设徽章，以及 `activity.ts` 中的 `instruction.*`/`anamnese.*` 分支。
- `Engine.Harness.Agents`——`"anamnese"` 的 identity 原先描述的是项目 onboarding；已按真实角色重写（基于证据的画像，以及对敏感属性的明确禁止）。

## 范围与假设 {#escopo--assunções}

范围之外：把 web 的 `ActionType` 联合类型与后端的 12 种类型同步（既有债务——只加入了 `instruction_patch`，因为它有专门的渲染）；在存活的对话型 GenServer 中重建 prompt；在 `session_events` 上为按项目的窗口建立新索引（如果扫描成为瓶颈，再作为后续事项）；通过 UI 手动编辑指令（只有提出的补丁 + 回滚）。

熟练度等级是三级量表（`iniciante`/
`intermediario`/`avancado`）——刻意粗粒度：更细量表的精度无法由观察性证据支撑。

---
traducao_de: 2f301391630d5be632e27036026760d416d43da1
---

# ADR 0123 — 为 QA Automação agent 的语义判断建立回归用例 golden-set

- **状态：** 已接受
- **日期：** 2026-08-30
- **参考（不作编辑）：** [ADR 0020](0020-destravar-gates-qa-secops.md)
  （本 ADR 关闭的那个发现——它自己的验收标准记录了 QA gate 的语义步骤在本地模型下是不确定的，
  并点出了本 ADR 所构建的修正方向：“指向 API 模型，而不是祈祷”）。

## 背景 {#contexto}

ADR 0020 闭合了 PR gate 的验收标准，但在自己章节的标题中写明了保留：**已闭合，但不具确定性**。
针对本地 `qwen2.5-coder:7b`，这个标准——QA 在同一个 PR 中两次把一条业务规则与一个测试对上——
在 11 次执行中只在第 10 次闭合。紧接着、代码未变的第 11 次没有闭合：模型没有调用
`emit_qa_verdict` 就结束了循环。ADR 0020 明确把这称为语义步骤是“最不适合小模型的角色”，并在
没有构建的情况下声明了修正方向：“把 `DEMO_QA_MODEL` 指向一个 API 模型”。

这个方向从未变成机制——它被记录了，却没有被构建。一次对本会话工作的外部代码审查按优先级为 15 条
发现分了类；其中 14 条在会话过程中关闭。第 15 条、也是最后一条就是这一条，提出时没有附带构建
成本：“一个 golden-set（5-10 个用例，宽松的预期输出，固定模型，起初允许失败）会把‘演示依赖一个
7B 的判断’变成一个趋势信号”。

三个通过阅读代码确认、而非假设的事实，塑造了今天能构建的东西：

1. **判断可以被单独调用，不需要整个状态机。** `Engine.Gates.QaAutomacaoAgent.run/5` 已经在
   `qa_automacao_agent_test.exs` 中这样被调用——没有 `QaLeadServer`，没有 `GateState`，没有
   PR，没有 git 仓库，没有 backlog。现有测试与真正的 golden-set 之间唯一的区别，就是把假的 LLM
   客户端换成真的。
2. **真实客户端要求 api 确实在运行且可达。**
   `Engine.Sessions.EngineApiClient.Live.llm_turn/5` 读取
   `Application.fetch_env!(:engine, :api_url)`，它只由 `config/runtime.exs`（经由 `API_URL`）
   填充——从不由 `config/test.exs` 填充。这不是通常意义上的单元测试：实际上它是“针对开发栈
   运行”，与 `demo-pr-gates.ts` 已有的姿态相同。
3. **今天无法进入 CI——已确认，而非假设。** `.github/workflows/` 中零次提到 `ollama`；compose
   中的该服务位于 `profiles: ["local-llm"]` 之后，从不被 `docker/smoke.sh` 启动。仓库中没有任何
   LLM 机密。而且 CI 自身的文化拒绝无声的允许失败：`pr-police.yml` 是仓库中唯一使用
   `continue-on-error` 的地方，即便在那里，错误也会在最后一步被重新抛出。今天不存在可以变红而
   没有后果的检查。把这个接入 CI 需要一个 API LLM 的机密或新的基础设施（带 GPU 的 runner、一个
   拉取 Ollama 的步骤）——这是人的决定，不是靠选择就能构建的东西。

## 决策 {#decisão}

**放在哪里。** `apps/engine/test/engine/gates/qa_automacao_agent_golden_test.exs`，
`use Engine.DataCase`，复用 `qa_automacao_agent_test.exs` 中相同的
`dev_state`/`dev_context` 构造。它是 ExUnit，而不是新的 Mix task：目前 `apps/engine/lib` 中
任何地方都没有自己的 `Mix.Task`，而独立测试已经是这段代码处理这类事情的自然形式——与 api 一侧
不同，那里 `demo-pr-gates.ts` 是脚本，因为那里不存在“直接调用函数”的等价物。

**一个永久的排除 tag，绝不按可用性检测。** `test_helper.exs` 中针对
gitleaks/hadolint/yamllint/actionlint 的模式，会在机器上找到二进制时自动包含被标记的测试——
对于免费且确定性的工具是对的，在这里是错的。这台开发机已经持续运行着 Ollama；按可达性自动包含
会让 golden-set 在**任何** `mix test` 中触发，无声地消耗 token，并给一个今天 100% 确定性的
测试套件引入真实的不稳定。

```elixir
ExUnit.start(exclude: [:golden_set_qa | binary_exclusions])
```

只有 `mix test --only golden_set_qa` 会运行它，再加上一个别名 `mix golden_set.qa` 以便被找到——
与 `demo-pr-gates.ts` 在自己的头部注释中已声明的纪律相同：“NOT deterministic ... run
deliberately, not in CI.”当 api 在 `API_URL` 上不可达时，`setup_all` 会跳过（通过测试体中
ExUnit 的 `{:skip, reason}` 返回值，而不是抛出失败）——这是环境前提，而不是代码缺陷。

**通过外部 TS 脚本进行种子填充，由 `System.cmd` 调用。** engine 无法在不复制存在于 api 自身用例
中的业务规则的情况下创建真实的行（项目、会话、模型 binding）——而且无论如何，也没有能到达正确
数据库的原始 Ecto 路径。这就是本 ADR 公开声明而不是隐藏的管道成本：
`apps/api/scripts/seed-golden-set-qa.ts` 是一个**跨语言的 `System.cmd`**，在本仓库中是新的
（此前没有任何 Elixir 测试通过 shell 调用 `pnpm`/`ts-node` 的先例）。

第二个、一点也不显然的、必须如此的原因：golden 测试使用 `Engine.DataCase`，其 sandbox 指向
隔离的 `engine_test` 数据库（与 `qa_automacao_agent_test.exs` 已经使用的约定相同）。种子脚本
运行在 **api 自己的进程**中，写入真实的开发数据库（`DATABASE_URL`），也就是**正在运行**的 api
和 engine 服务器实际使用的那个。这是两个不同的数据库——golden 测试中 `Engine.Repo` 读取的任何
东西都看不到脚本写入的行，反之亦然。因此，`Engine.Actions.Workspace`/`Engine.Dev.WorktreeManager`
（它们通过 `Engine.Repo` 读取 `project_repositories`）无法为这个测试的用例实体化 worktree：
**种子脚本自己做 git checkout**（对它刚开通的 bare 仓库做一次简单的 `git clone`），并在 JSON
输出中返回已就绪的 worktree 路径。golden 测试只消费这个 JSON——从不查询 Postgres 去找任何东西。

种子脚本：

- 创建一个用户 + 一个 workspace，每个用例一个项目（一个已开通的本地 git 仓库与项目是 1:1 的——
  `ProjectRepository.remoto_de_trabalho/1` 按 `project_id` 只查一行）。
- 为 `GOLDEN_SET_QA_MODEL`（默认 `qwen2.5-coder:latest`）解析**或创建** `models` 行——与较早的
  演示不同，后者在模型不在种子固定目录（`seed.ts` 的 `MODEL_SEEDS`）中时会抛错。golden-set 按
  设计面向任意本地 Ollama 模型，把它绑在固定目录上，意味着每当有人想测一个新模型都要编辑
  `seed.ts`。
- 为 workspace 激活模型（`SetModelsActiveUseCase`）——较早的演示脚本跳过了这一步，而缺少它如今
  会让 `SetModelBindingUseCase` 抛出 `ModelNotBindableError('inativo')`（不在
  `workspace_models` 中意味着“关闭”，RN-043/ADR 0049）。这看起来是旧演示中的漂移，而不是本 ADR
  应该在那里悄悄修正的东西——它们不在范围内。
- 在 `chaveDeAgente(project.id, 'qa-automacao')` 上做模型 binding——**是 `'qa-automacao'`，
  绝不是 `'qa'`**：自阶段 8b 起，真正运行的 subagent 是 `qa-automacao`/`qa-performance-seguranca`；
  `'qa'` 上的 binding 没有效果（级联会落到项目的 binding）。照抄自
  `demo-pr-gates-area-qa.ts:281`，而不是仍使用旧键的较早的 `demo-pr-gates.ts`。
- 调用 `SeedAgentAreasUseCase.execute(project.id)`——没有它，对一个由原始 insert（而不是由
  `CreateProjectUseCase`）创建的项目，`agent_areas` 会是空的，QA agent 的**第一个** LLM 回合会
  因 `RecordLlmUsageUseCase` 返回 404 而失败（`AgentAreaRepository.incrementSpent` 要求该行存在——
  计量是强制的，RN-036，绝不是尽力而为）。这是通过实验发现的：在加上这次调用之前，这个 harness
  的第一次真实执行在六个用例中都返回了 `blocked(infra)`。
- 开通仓库，commit 用例的骨架，然后**在 `projectScopeRoot(project)` 内部**实体化 worktree
  （`git clone`，在写 `permissions.json` **之前**——clone 要求目标目录为空）。这个顺序和这个
  位置是承重的，并非偶然：ADR 0055 在 `decide()` 中的路径作用域上限，会拒绝自动批准**任何**
  `cwd` 落在项目自身作用域根之外的 `terminal` 动作，不管命令多么匹配某个 `allow` 模式。这个脚本的
  第一个版本是在 `os.tmpdir()` 下一个单独的草稿目录中 clone 的——每个用例都永远回到
  `awaiting_approval`，因为 `npm test` 从未通过作用域检查。与上面 `agent_areas` 的缺口一样，是
  通过实验发现的。
- 把 `DEV_TERMINAL_ALLOW_PATTERNS` 加到项目的 `permissions.json` 中（与
  `ActivateExecutionUseCase` 已在使用的机制相同）——没有它，`decide()` 对每个 `terminal` 调用的
  默认值都是 `require_approval`，`emit_qa_verdict` 永远无法在历史中看到一个退出码为 0 的
  `terminal`。
- 为每个用例创建并激活一个会话（`CreateSessionUseCase` +
  `TransitionSessionUseCase`）。
- 在 stdout 打印一个 JSON 对象——`{"model": "...", "cases": [{"id",
  "projectId", "sessionId", "worktreePath", "story", "task",
  "expectedVerdict"}, ...]}`。

不做清理——与 `demo-pr-gates.ts` 的姿态相同（时间戳后缀，从不删除）。

**六个用例**，每个探测一张 LLM 评估者真正可能判错的不同判断表——而不是同一个测试的六种变体：

1. `rf-covered`——`demo-pr-gates.ts` 的 RF_1，原样（已覆盖）→ `approved`。正向对照，已端到端
   证明。
2. `rf-uncovered`——`demo-pr-gates.ts` 的 RF_2，原样（明确没有覆盖）→ `changes_requested`。负向
   对照，已证明。
3. `rf-single-clean`——`demo-pr-gates-area-qa.ts` 的 RF_1（单条规则，已覆盖，干净的批准）→
   `approved`。
4. `rf-mismatched-filename`——一条关于 `enviar()` 的规则，被位于 `test/outro-modulo.test.js`
   （而不是 `enviar.test.js`）中的测试覆盖 → `approved`。探测 QA 是否读取测试的**内容**，而
   不只是文件命名约定。
5. `rf-partial-coverage`——一条点明一个正常路径和一个明确失败情形的规则（`cancelar(pedido)` 标记
   状态，并在已交付时抛错）；只有正常路径有测试 → `changes_requested`。探测 QA 是否把部分覆盖
   盖章为完整。
6. `rf-skipped-test`——唯一“覆盖”该规则的测试是 `test.skip(...)` → `changes_requested`。探测
   QA 是否把被关闭的测试算作覆盖。

ADR 0020 已记录的两个几近命中（工具调用幻觉、QA 试图修改被审查的代码）被有意排除在外——它们已经
是 `apps/engine/test/engine/harness/tool_call_recovery_test.exs:79` 中确定性的、廉价的回归，不涉及
真实模型。把它们加到这里会重复这部分覆盖，并稀释这个 harness 真正测量的东西：规则对测试的判断，
而不是 QA 的一般不当行为。

**一个下限，而不是二元的 gate。** 与 `scripts/ci/coverage-floor.ts` 中 `verificarPiso` 的棘轮
理念相同（`>=`，绝不 `>`；文件只由人编辑；脚本从不改写它）——恰好契合“宽松的预期输出，起初允许
失败”已经提出的要求。`apps/engine/test/fixtures/golden_set_qa/floor.json` 按**模型**作为键
（换模型会合理地改变可达到的下限），并保存一个计数加一个总数（`{"passRate": N, "of": 6}`，而
不是百分比）——这样，如果 golden-set 之后增长到超过六个用例，旧条目不会被悄悄地误读。所用模型
没有条目 → 测试**失败**，报告观察到的命中数，并请人添加条目——绝不自动写入，这与
`coverage-floor.ts` 已确立的不可妥协规则相同。

**一个测试，而不是六个。** 六个用例在单个 `test` 块中运行（标记为 `@moduletag :golden_set_qa`），
而不是六个独立的测试。`mix test` 不保证一个模块中测试之间的顺序；拆成六个会冒这样的风险：如果
一个假想的“第七个、聚合用的测试”在其他测试完成上下文填充之前运行，下限断言会读到不完整的子集。
运行全部六个并在最后聚合，也让人可以把六个结果一起读出来调试，打印在 stdout 上。

**`ownership_timeout` 必须在 `Engine.DataCase` 中变得可配置。** 这是针对 `gpt-oss:20b` 运行时
通过实验发现的：针对首次加载的大模型的一个真实 LLM 回合，可能几分钟都不触碰 Postgres。
`Ecto.Adapters.SQL.Sandbox` 默认 60s 的 `ownership_timeout` 在调用中途收回了 golden 测试借来的
连接；通过 `Engine.Repo` 的**下一次**查询——在 `ToolLoop.Default.init/1` 中读取指令文件，每个
gate agent 都会经过这里，无论它是否个性化 agent 指令——以 “owner process exited” 失败，把模型
的速度特性报告成了基础设施故障。`Engine.DataCase.setup_sandbox/1` 现在读取一个可选的
`tags[:ownership_timeout]`（nil 为套件中的其他每个测试保留现有的 60s 默认值）；golden 测试为
自己标记 `ownership_timeout: :infinity`。

## 后果 {#consequências}

**接入 CI 是一个已声明、未构建的 `TODO(humano)`。** 它需要一个 API LLM 的机密或新的基础设施
（带 GPU 的 runner、一个拉取 Ollama 模型的步骤）——这不是本次会话能做的选择；它需要人的决定，
就基础设施而言，还需要预算。记录在 `CLAUDE.md` 的 “Pendências com dono humano” 一节中，这类阻塞
已经住在那里。

**测得的真实命中率（2026-08-30，宿主机上的原生进程——api 经由 `pnpm --filter api start:dev`，
engine 经由 `mix phx.server`，两者都指向本地 Postgres 以及本机 `localhost:11434` 上的 Ollama，
这次特定的执行没有使用 Docker Compose）：**

| 模型 | 执行（命中/6） |
|---|---|
| `qwen2.5-coder:latest` | 1, 3, 2, 4, 5 |
| `gpt-oss:20b` | 5, 4 |

`qwen2.5-coder:latest` 明显不稳定——各次执行中占主导的失败模式是模型以**空的 `command` 参数**调用
`terminal` 工具，而 `decide()` 正确地拒绝自动批准（没有模式匹配空字符串），使该用例永远卡在
`awaiting_approval`。这正是 ADR 0020 已在这个模型家族中发现的那类工具调用不稳定——在这里被复现为
**测得的趋势**，而不是孤立的轶事。

`gpt-oss:20b` 明显更可靠（两次执行 4-5/6，每个用例约慢 4 倍）。它唯一反复出现的错误是
`rf-partial-coverage`——把一条有未测试失败情形的规则盖章为 `approved`——这正是该用例为暴露而存在
的判断缺口，不是 fixture 的缺陷。

鉴于此，**今后对任何依赖 QA gate 语义步骤可靠的流程，`gpt-oss:20b` 是推荐的默认值**——这与
ADR 0020 在无法测量时所预言的结论相同。`GOLDEN_SET_QA_MODEL`/种子脚本的默认值暂时仍是
`qwen2.5-coder:latest`（更改演示/harness 的默认值是与记录测量结果分开的决定）；下限文件的两个
条目让两个模型的真实上限并排可见，供做这个决定的人参考。

记录的下限（`floor.json`）有意低于每个模型观察到的最佳执行——是棘轮，而不是愿景：
`qwen2.5-coder:latest` 为 1/6，`gpt-oss:20b` 为 4/6。

**机制已被证明，但种子脚本的管道现在是承重的新表面。** 本 ADR 自己的实验执行发现的两个 api
一侧的缺口——由原始 insert 创建的项目没有填充 `agent_areas`，以及 worktree 必须位于
`projectScopeRoot` 之内，`decide()` 的路径作用域上限才会自动批准任何东西——不是 gate 或
`decide()` 的缺陷；它们恰恰是 ADR 0020 自己反复发现的那种“演示忘了一个通常由
`ActivateExecutionUseCase` 负责的步骤”的缺口。记录在这里而不是隐藏起来，就像 ADR 0020 在第十次
闭合之前记录了它的九次失败执行一样。

---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0168 — QA 的 golden-set 开始在 CI 中按周定时运行

## 状态 {#status}

**已接受。** 节奏由维护者于 2026-09-27 决定（AT-149）：**每周**。引用 [ADR 0123](0123-golden-set-regressao-qa-automacao.md)（QA 语义判断的 golden-set，最初是手动的）和 [ADR 0138](0138-golden-set-do-rag-em-ci-agendado.md)（RAG 的模子，它把 QA 的声明为“inteiramente manual”）。两者都不编辑。

## 背景 {#context}

ADR 0123 把 QA 的 golden-set 在 CI 方面留作 `TODO(humano)`，说接入它需要“segredo de LLM de API ou infra nova (GPU)”。ADR 0138 在把 RAG（embedding，确定性）与 QA（聊天，判断）分开时重复了这句话。两次测量改变了局面，两者都在 [`docs/explanation/gates.md`](../explanation/gates.md) 中：

- **AT-067（2026-09-13）：** 在没有 GPU 的 `ubuntu-latest` 上，在作业自己的 Ollama 中拉取 `qwen2.5-coder`，时间是够的（`mix golden_set.qa` 用 19–23 分钟）。“新基础设施”那一半不成立了。但比分在构造上就是 0/6：自 [RN-502](../business-rules.md#rn-502) 起，一个没有 `running` 容器的 `container` 项目的 `npm test` 会被拒绝，而种子从不启动容器。
- **AT-076（2026-09-27）：** 种子开始通过生产路径启动容器（提议并批准 `container_start`、broker、状态机），不触碰 RN-502。在 CI 中两轮：3/6 和 3/6，下限是 1/6，作业用时 52 和 86 分钟。

工具在测量了，缺的只是节奏。

这个工作流的验证轮（run 36327281774，临时的 `push` 触发器，在 PR 之前移除）又给出 3/6，用的是另一组用例，RN-502 拒绝为零，作业用时 13 分 41 秒——这一次没有用例重复命令直到上限。不同轮之间的用时从 14 到 86 分钟不等。

## 决策 {#decision}

**`.github/workflows/golden-set-qa.yml`，与 `ci.yml` 和 RAG 分开，每周 `schedule` + `workflow_dispatch`，绝不 `pull_request`。** 与 ADR 0138 同样的论点：`ci.yml` 只有 `pull_request`，而一个用聊天模型做判断的 golden-set 不应挡在合并的路上。周六 01:17 UTC：避开 RAG 的每日窗口（06:00）、属性证明的周日（04:00）和链接检查的周一（06:00）；选周六是为了让红色等到一周开始；选第 17 分钟是因为 Actions 的 `schedule` 会延迟，并可能丢弃整点的触发。

**每周而不是每晚。** RAG 的那个花费约 20 分钟且是确定性的：昨天的回归就是回归。这个测得要 52–86 分钟，而且会**变化**——AT-076 的两轮总分相同但用例不同。每天一轮会每周花掉几个小时的 runner，用更多噪声读取同一个趋势信号；每周一轮正是下限（ratchet）发现下降所需的，而 `workflow_dispatch` 覆盖了改了 QA prompt 并想立刻得到答案的人。

**`timeout-minutes: 150`。** 测得最长的作业用了 86 分钟；方差来自模型（一个用例在以 `blocked(modelo)` 结束之前重复了 30 次 `npm test`）。150 覆盖了不止一个用例撞上迭代上限的一轮，而不会因时钟变红——那不是作业要测量的东西。

**裁决就是测试的裁决。** 当命中数低于 `floor.json` 中该模型的 `passRate` 时，或者 api 有响应但种子失败时，ExUnit 失败。工作流增加两个工具层面的守卫，没有一个关乎判断：比分行必须存在（api 不响应时测试会**跳过**，而在定时运行中跳过就是没有测量的绿色），事件日志中不能有 RN-502 的拒绝（AT-067 的已知签名）。失败时，它做 RAG 那个做的事：打印日志。不开 issue。

**api、engine 和 broker 在 runner 上原生运行，Docker 的 socket 只给 broker。** 这是 AT-076 中测得的设计。三方使用同一个受管文件夹，因为 api 和 engine 在主机上运行（`PROJECT_WORKSPACES_ROOT` = `PROJECT_WORKSPACES_HOST_ROOT`）。用例的镜像在种子之前拉取，引用来自种子本身（`IMAGEM_DO_GOLDEN_SET_QA`，按索引的 digest 固定），而不是工作流中的第二个字面量：broker 的 `docker run` 在 Docker 端口 30 秒的控制上限下运行（[RN-604](../business-rules.md#rn-604)），作业拉取的东西与种子请求的东西之间的分歧会把拉取放进这个上限之内。

## 后果 {#consequences}

**ADR 0123 关于 CI 的 `TODO(humano)` 关闭。** 仍然由人负责的，是 ADR 0123 本身已经说过的：下限（`floor.json`）只由人在测量之后写入。本 ADR 不动它，也不动模型。

**没有任何 gate 改变。** QA 的 golden-set 在登记（`docs/gates.yml`）中没有自己的 gate；它是 `qa-verificada` 语义步骤的趋势信号，而定时作业不会阻挡任何合并。

**CI 的 broker 没有 compose 的五层。** 在临时的 runner 上没有 `internal` 网络，也没有关闭的端口：剩下的隔离是 broker **接受**的东西（五个操作，由 api 根据构件计算的规格）。runner 在作业结束时被丢弃，不保存这个工作流的任何密钥（`permissions: contents: read`，CI 的字面量服务 token）。

**已声明、此处不修正：** engine 的心跳在种子的会话创建后约 30 秒就关闭它们（`heartbeat_timeout`），而 QA 继续在其中提议命令（它在 `mix` 的进程中运行，在会话之外），在 AT-076 的比分上没有可见影响。而且修改这个工作流的 `pull_request` 并不执行它——PR 中的绿色不是证明；证明是 `workflow_dispatch` 或第一个周六。

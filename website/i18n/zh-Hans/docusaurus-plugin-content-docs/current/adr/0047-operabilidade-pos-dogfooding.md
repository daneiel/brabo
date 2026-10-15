---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# 0047 — dogfooding 之后的可运维性：Fase 12 的收尾

## 背景 {#contexto}

Fase 10 是 Brabo 第一次构建 Brabo 本身的真实执行。它产出了十七个发现，保存在 [O que o primeiro dogfooding ensinou](../explanation/primeiro-dogfooding.md) 中。其中三个关于**可运维性**——这正是区分一个手工进行的实验与一个可以与之共处的系统的东西：

| # | 是什么 | 由谁关闭 |
|---|---|---|
| 1 | 产品只会**创建**仓库；把项目指向已有的仓库需要在两张表中手工插入行 | [ADR 0044](0044-adocao-de-repositorio-existente.md) |
| 10 | 一个 dev agent 处理**一个**任务就停下；这一阶段分批运行，批次之间重启 engine | [ADR 0045](0045-reagendamento-por-evento-do-dev-agent.md) |
| 13 | `draft → ready` 的晋升在创建时是自动的——PO 独自决定什么进入 dev 的队列 | [ADR 0046](0046-promocao-de-story-com-autoridade-do-usuario.md) |

在编写本 ADR 时，这三个都已经有了自己的测试。缺的是另一样东西：**它们一起消亡的证明**。一个系统可以有这三项修正却仍然不可运维，如果它们只能各自孤立地工作——这正是 Fase 10 揭示的，关于在各自阶段的测试中通过、却熬不过与真实使用第一次接触的功能。

## 决策 {#decisão}

**验证是可执行的脚本，而不是散文写成的剧本。** `apps/api/scripts/validacao-fase-12.ts`，以 `demo-noop-execution.ts` 为模子：启动 Nest 上下文，调用真实的用例，并且**在某个标准没有达成时以非零代码退出**。替代方案——一份让人点击照做的清单——会产生一个静默老化的验证，就像 Fase 10 的观察表那样一直空着。

**证据从数据库中提取，而不是转录。** 脚本最后打印一张本次运行自身的 `session_events.id`（ULID）的 Markdown 表，可以直接粘贴到文档中。并且，如果它声称演练过的某个步骤没有在事件日志中留下证据，它会拒绝以成功结束——没有这个检查，一个错误的查询会产生一张短表而验证照样通过，这是生成式报告的经典故障模式。

**验证在本地运行且没有 LLM，这一点在文档的第一段就声明。** 不是在脚注中。两个具体的、都已核实的理由：

- **Fase 10 的 fork 从未被命名**——`dogfooding-mission.md:135` 仍然是一个 `TODO(humano)`，所以不存在可以重新接管的目标。接管路径在两个 provider 中是相同的；改变的是网络，由冒烟测试 `adopt-repository.smoke.spec.ts` 覆盖，以真实凭据为门槛；
- **用本地模型对 gate 的判断是不确定的**，[ADR 0020](0020-destravar-gates-qa-secops.md) 早已这样说。裁决经由 `RecordGateVerdictUseCase` 进入，它是 `task.gate_resolved` 诞生的**真实**漏斗。12b 需要证明的是裁决 → outbox → 唤醒 → 认领这条链，而不是一个 7B 模型能否读懂测试套件。

一个假装覆盖得比实际更多的验证，比没有验证更糟：它会把没有演练过的东西当作已经关闭。

**`NoopDevAgentServer` 进入了 12b 的状态机——而这是验证准备过程本身的一个发现。** Fase 12b 只改变了真实的 `DevAgentServer`。Noop 继续固定 `status: :working`，不订阅 `Engine.Dev.Wake`，处理一个任务就停下：**发现 #10 在唯一能不花 token 验证这一阶段的载体中依然存活。** 用它进行端到端执行，会因为工具的缺陷而不是产品的缺陷，让“零重启”标准失败。

修正不是把状态机复制到 Noop 中，而是把它移到 `Engine.Dev.AgentIo`——这个模块之所以存在，正是因为“um Noop que reimplementasse essas partes validaria uma cópia, não a infraestrutura”。这个论点自 Fase 4a 起就对 worktree 和提交身份成立；现在它也对重新调度成立。两个 agent 之间不同的是 `run_task`，而且只有它，所以它作为函数而不是 behaviour 进入。

**Fase 10 的收获现在写下了，漏洞已声明。** 自那一阶段结束起，`CLAUDE.md:77` 就引用 `docs/explanation/primeiro-dogfooding.md`，而这个文件从未存在。它根据可重建的内容写成——十七个带文件和行号的发现、批次的叙述、手工种子——而**一切依赖实时计数的内容都以 `não medido` 写入**，绝不是估计。这是收获本身的规则（`colheita-esqueleto.md:22-24`）：没有产生它的查询，任何数字都不进入。

在对照表中，“每交付一个任务重启 1 次”作为**从当时代码派生的属性**出现，而不是观察到的平均值——这一区分就写在单元格本身中。

## 后果 {#consequências}

Fase 12 以三个 P1 可运维性发现被解决、并在一次执行中被证明而结束。其他十四个仍然列在收获中且未关闭；没有一个被顺带修正，原则与 Fase 10 的使命所确立的相同——在处理它的阶段之外修正一个发现，会隐藏它为何存在的证据。

本阶段揭示的、作为 **backlog 而不是修理**进入的三件事：

1. **主要指标的插桩先于实验。** 发现 #17（P1，未关闭）说 `proposed_action.approved`/`.denied` 只进入 outbox，从不进入 `session_events`。Fase 10 收获的定量那一半很大程度上因此而不存在。下一次 dogfooding 如果不先解决 #17，会再次丢失同样的数字。
2. **没有编辑故事的工具。** 12c 的拒绝循环通过重新创建（`create_story`）来闭合，被拒绝的故事带着记录的原因留在 `draft`。这是可审计的，但会在 backlog 中留下残余。已记录在 [ADR 0046](0046-promocao-de-story-com-autoridade-do-usuario.md) 中。
3. **docmap 的覆盖恰好在本阶段改动最多的地方有缺口。** 没有任何规则观察 `apps/engine/lib/engine/dev/**` 或 `apps/engine/lib/engine/agents/**`：dev agent 的状态机和对话式 agent 可以改变而不被追讨任何文档。本 ADR 一并修正了这个缺口，因为让它敞开，会让文档机制本身对演练了它的这一阶段说谎。

Fase 12 **没有**改变的，值得明确说出，因为这是产品的轴心：审批管道与原来完全一样，受保护分支上的合并仍然是用户的手动决定。验证的第 6 步以 `auto_approve` 自主权和放行的 `permissions.json` 提议一次合并，并要求结果为 `pending`。重新调度 agent 不是授予自主权——只是让它不在任务之间死掉。

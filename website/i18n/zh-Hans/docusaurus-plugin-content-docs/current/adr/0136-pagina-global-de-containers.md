---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0136 — 全局容器页面：broker 按加载设上限，`container_remove` 纳入绝对上限

## Context {#context}

ADR 0130（容器 broker）声明了 `DockerPort` 的五个操作——`start`/`stop`/`remove`/`inspect`/`exec`——并在 `ContainerBrokerPort` 中有一条明确注释：*"`stop`/`remove` seguem sem chamador:
são EFEITO EXTERNO e não acontecem sem `proposed_action` própria, que ainda
não existe."* ADR 0133/0134（PR 1.5/1.6）接通了 `start`/`exec`；本 PR（1.8，“在真实容器中执行”计划第 1 部分的最后一个）关闭剩下的缺口，并交付 controller
`ContainersController`（按项目的 `lifecycle` 路由）的注释早已指向的界面：*"a
página global que a consome é outro PR."*

设计这个界面时出现了两个具体的架构决策，此前的 ADR 中都没有现成答案：

1. 该界面是**跨项目**的——workspace 中每个已有
   `project_containers` 的项目一行。**已登记**状态的聚合没有成本（是数据库读取，与 `ProjectsSummaryRepository` 同一模子），但**观测**状态——询问 broker 当前状态，ADR 0130——是每个项目一次**网络**调用。不设上限地询问**所有**项目会违反 CLAUDE.md 的规则：*"leitura
   composta que chama o provider N vezes tem orçamento e cache, senão vira
   amplificador de tráfego"*（ADR 0060）。
2. `container_remove` 与 `container_start`/
   `container_stop` 有质的不同：它丢弃容器并迫使从零重新配置。原计划没有规定确切的量级——只说这三个动作都以 `proposed_action` 诞生。

## Decision {#decision}

### 对 broker 调用的上限由**两**把尺子决定，而不是一把 {#o-teto-de-chamadas-ao-broker-é-por-duas-réguas-não-uma}

`ObterVisaoGeralDeContainersUseCase` 只对**已登记**状态为 `provisioning`/`running` 的行询问 broker（通过已有的
`ObterEstadoObservadoDoContainerUseCase`）——一个 `stopped`/`failed`/
`removed` 的容器不需要 daemon 确认界面就能讲得通，把它们排除在询问之外是免费的（保护它们的不是上限，而是资格）。在符合资格的行中，每次加载最多询问 `TETO_DE_VERIFICACOES_POR_CARGA`
（20，一个可修订的**数字**，而不是“全部”），并**并行**询问（`Promise.all`，绝不串行——串联会白白把延迟乘以上限）。

落在任一把尺子之外的行带有一个**专属**字段，
`naoVerificado`（`fora_do_escopo_da_verificacao` |
`teto_de_verificacoes_atingido`）——绝不与 `naoObservado`
（`broker-nao-configurado`/`broker-sem-resposta`/`broker-recusou`，早已存在，含义是“broker **被**询问了，但拒绝了/没有响应”）混淆。超出上限的行，其三个观测字段（`observado`/
`naoObservado`/`detalheDaObservacao`）全部为 `null`——界面从不编造 broker 没有给出的回答。

为什么是 20：今天（第 25b 阶段）不存在任何自动配置——容器只能通过手动批准的 `container_start` 启动——因此同时处于 `provisioning`/`running` 的容器数量往往很小。20 是对当前的宽裕余量，而不是对照真实数量测出的紧切线；修订这个数字只是一行代码，不是一次迁移。

### **已登记**状态用三次固定查询聚合，绝不每个项目一次 {#o-registrado-agrega-em-três-consultas-constantes-nunca-uma-por-projeto}

`ContainersOverviewRepository`/`DrizzleContainersOverviewRepository` 沿用与 `ProjectsSummaryRepository`（RN-090）**相同**的模子：第一次查询把 `projects` 与 `project_containers` 连接起来（INNER JOIN——只有已经**有**行的才进入，这就是界面的尺子），第二次批量获取所找到项目的
`artifact.project_image` 事件（用于解析每个**冻结**的 `imageVersion` 对应的镜像文本——不是当前的那个，它可能在容器诞生后被修订过；`decisaoNaVersao`，
`domain/containers/project-container.ts`，从
`ObterContainerDoProjetoUseCase` 中提取出来，以免重复验证/降级逻辑），第三次批量获取相同项目中待处理的容器类
`proposed_actions`——这让界面能把三个操作按钮换成内联的 `ApprovalCard`，而无需每个项目第四次查询。一个测试（`containers-overview.repository.spec.ts`，与 `ProjectsSummaryRepository` 的测试设计相同）证明 2 个和 20 个项目时查询次数**相同**。

### `container_remove` 进入 `decide.ts` 的绝对上限；`container_stop` 沿用 `container_start` 的量级 {#container_remove-entra-no-teto-absoluto-de-decidets-container_stop-segue-o-calibre-de-container_start}

`container_start`（RN-491）和 `container_stop`（RN-495）是 `maintainer`，默认 `require_approval`，并且**可以**配置为 `auto_approve`——没有哪个决定是不经重新配置就不可逆的：停止一个已登记为 `running` 的容器是可以回来的状态（`stopped -> running`）。`container_remove` 不同：它丢弃容器，而状态机（`container-lifecycle.ts`）只能通过**再次配置**离开 `removed`——绝不是“复活”。因此 `container_remove` 进入 `decide.ts` 中已覆盖 git push/特权命令的**同一个**绝对上限
（RN-418/ADR 0102）：无条件 `require_approval`，即使开启了“自动模式”，即使配置了 `permissions.json`——
`ApproveAlwaysActionUseCase` 拒绝（400）为它写入“总是允许”的模式，从**源头**堵住缝隙，与 RN-418 的机制相同。

`ContainerBrokerPort.remove` 本来就是（自 ADR 0128/0130 起，在
`packages/docker-port` 中实现）`docker rm --force`——即使是 `running` 的容器也在一次调用中移除。状态机**没有**增加 `running -> removed` 的捷径：当已登记状态仍是 `running` 时，`ExecuteContainerRemoveUseCase` 记录**两**跳（先 `stopped`，再 `removed`），如实反映 Docker 一侧真正发生的事情，而不为一条只为这个用例存在的路径拓宽状态机。

### “重新启动”复用 `container_start`——不是第四种类型 {#subir-de-novo-reusa-container_start--não-é-um-quarto-tipo}

已调查并确认：`ExecuteContainerStartUseCase` 已经能从**任何**状态处理完整流程——`provisioning`/`running`（幂等）、`stopped`（直接跳到 `running`，不重新配置）以及 `failed`/`removed`/无行（从零重新配置）——因为它本就为了服务 Infra 的选择（RN-491）而存在，而那也可能发生在容器倒下之后。界面（`ContainersPage.tsx`）根据项目的**当前决策**
（`GET .../container`，与 Code 标签页读取的是同一路由）——镜像、网络、资源——组装 `container_start` 的 payload，而不是发明一个新表单；如果 Arquiteto/Infra 尚未决定（对已存在的行不应发生，但读取会降级而不是假设），点击会以一条有名称的消息失败，绝不会提出空 payload。这第三个按钮不需要任何后端改动。

## Consequences {#consequences}

**`/containers` 页面是第一个把数据库（无 N+1）与受预算约束的外部 provider（带显式上限）结合起来的跨项目读取。** 这种模式——先资格、后上限、缺席原因**专属**且绝不与 provider 的原因混淆——可供下一个需要同样纪律的组合读取使用。

**ADR 0128/0130 五个操作中的 `stop`/`remove` 现在有了真实调用者。** 五个之中，只有 `inspect`（读取，无 `proposed_action`）保持原样；`start`/`stop`/`exec` 在本 PR 之前就已有调用者。
`container-lifecycle.ts` 有一段 docblock 声称“nenhum serviço do
produto monta `/var/run/docker.sock`”——自 ADR 0130 起就是错的，现在更错；本 PR 已修正，正是它因另一原因已在编辑的同一文件。

**20 这个上限是一个数字，而不是测量结果。** 没有关于同时处于 `provisioning`/`running` 的容器数量的生产数据——第 25b 阶段从未有过自动配置。如果数量增长，就修订这个数字；改它不需要另一项架构决策，只需要今天还不存在的测量（与 RAG 混合搜索权重所声明的同一把尺子，ADR 0080）。

**`container_remove` 永远不可自动批准，在任何地方、永远——只要本决策有效。** 这是刻意的：唯一的撤销方式是另一项明确的架构决策，而不是一项配置。

**考虑过并放弃的备选方案：给 `container-lifecycle.ts` 增加直接的 `running -> removed` 转换。** 它会建模 broker **做**了什么（强制移除），但会把状态机**建模**的东西（产品可观测的状态）与 Docker 作为机械捷径所允许的东西混为一谈——状态机关于“api 知道发生了什么”仍然是正确的，而 `ExecuteContainerRemoveUseCase` 通过记录两跳已解决此问题，无需触动系统其余部分共享的领域（包括依赖同一状态机的 `container_start`）。

**考虑过并放弃的备选方案：基于缓存/TTL 而非按加载计数的 broker 调用上限。** 缓存可以在快速连续加载时减少调用，但会引入一个窗口，在此期间观测状态可能已过时而界面**并不知道**——这是 RN-468 所禁止的（环境信号说出它**知道**的，绝不假装拥有它没有的新鲜度）。按加载设上限更简单也更坦诚：每次加载准确地说出它询问了什么。

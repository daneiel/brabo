---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0199 — 容器的最低资源从 `module_map` 派生：每个模块声明自己的，Infra 按总和启动

## 状态 {#status}

**已接受。** 2026-10-01（AT-261，故事 HS-065，史诗 EP-030，第 36 轮；所有者于 10月1日的决定：*"o recurso mínimo é derivado do `module_map` — o que
o Arquiteto declara por módulo —, não um preset fixo por stack"*）。改变构件 `artifact.module_map`（Fase 3b）的 schema，以及 `container_start` 的执行在省略 `resources` 时的做法，引用（不编辑）[ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)（镜像构件中带上限的资源）、[ADR 0130](0130-broker-de-container.md)（broker 规格中的 `pidsLimit`）、[ADR 0131](0131-roteamento-de-modulos-para-infra.md)（Arquiteto 的路由）、[ADR 0133](0133-infra-elege-imagem-do-roteamento.md)（Infra 选定）和 [ADR 0190](0190-a-infra-sobe-o-container-no-aceite.md)（接受时的服务器启动，它使用“recursos padrão”）。

## 背景 {#context}

2026-10-01 在修改之前于 `dev` 中测得：

- `apps/api/src/domain/containers/project-container.ts` 中的 `RECURSOS_PADRAO = {cpus 2, memoryMb 4096, pidsLimit 512}` 和上限 `RECURSOS_MAXIMOS = {8, 16384, 4096}`。省略的 `resources` 字段在 `validarDecisaoDeImagem` 中变成默认值；超过上限则拒绝。没有**最低**的概念。
- 接受时的服务器启动（`subir_no_aceite/2`，ADR 0190）总是发送 `resources: %{}`，所以经它启动的每个容器都得到默认值。9月29日使用中的真实容器有 `Mem=4 GiB`、`NanoCpus=2e9`、`Pids=512`——默认值。
- `module_map` 每个模块有 `{name, stack, responsibility, dependsOn}`（`domain/architecture/module-graph.ts` 中的 `ModuleNode`、JSONB 列 `module_maps.modules`、engine 的工具 `create_module_map`），没有任何资源字段。路由（`artifact.module_routing`）和镜像也没有。“兼容的最低值”无法从现有数据推导。
- 一个项目只有**一个**容器：`project_containers` 中的 `project_id UNIQUE`。

## 决策 {#decision}

1. **`module_map` 获得按模块的 `resources`。** 在构件中是可选的（旧的映射没有它；不需要迁移——它是 JSON 中的一个字段），带 broker 规格的**三个**数字：`cpus`、`memoryMb`、`pidsLimit`。它的含义是**该**模块单独在容器中所需要的。工具 `create_module_map` 开始要求它（在条目的 schema 中为 `required`，内部三个字段都是必需的）。api 在创建映射时验证：三个都有或都没有（只声明一半是 400——用默认值补全缺失的字段就是编造数字），每个都为正且在容器的上限内。
2. **最低值是模块之间的**总和**，而不是最大值。** 所有模块同时住在同一个容器中：每个模块的 dev agent 都在那里工作，当领域并行时同时进行，而一个模块的开发服务器不会为了另一个的运行而关闭。只有在永远不会有两个同时运行时，最大值才成立，而它的错误是在命令中途被 OOM-kill，而不是可读的拒绝。超过上限的总和在创建映射时**就**被拒绝（对 Arquiteto 返回 400，它是能够修正的一方），并在启动时作为防御再次拒绝。
3. **没有声明的模块以今天的默认值作为**下限**。** 绝不为它编造数字：唯一存在的数字就是它今天得到的，即容器的默认值。所以只要有模块没有声明，最低值就是已声明者之和与 `RECURSOS_PADRAO` 之间**较大**的那个，逐字段比较；只有全部都声明时，最低值才会低于默认值。没有任何声明的映射——本 ADR 之前的每个映射——恰好得到默认值，其行为不变。按**容器**设下限，而不是“每个模块的默认值相加”，是有意的：为每个未声明的模块加 2 个 cpu，会让一个五个模块的旧映射超过上限并无法启动。
4. **由 api 在执行 `container_start` 时派生。** `ExecuteContainerStartUseCase` 读取当前的 `module_map`（路由所提名的那个），派生最低值并逐字段解析资源：**省略**的变成最低值；**低于**最低值的是具名的 `failed`（不写入决定，也不启动）；高于的在上限内有效，像往常一样由 `validarDecisaoDeImagem` 检查。没有当前的 `module_map` 时，最低值就是默认值。engine **不**派生：服务器启动继续发送空的 `resources`，其 rationale 说资源是派生出的最低值——只有一把尺子，用 TypeScript，绝不在 Elixir 中有第二份总和。
5. **构件的 `rationale` 说明每个数字从哪里来。** `DecidirImagemDoProjetoUseCase` 写入的决定（`artifact.project_image`，`decidedBy: 'infra-lead'`）获得一句“Recursos mínimos (RN-683): …”，带被相加的模块、**没有**声明的模块（点名）以及映射的版本。审计容器的人可以读到它为什么有那些数字。

## 后果 {#consequences}

- 服务器启动（ADR 0190）开始以**最小**的合格资源启动：一个全部声明的项目可以低于 2 cpu/4 GiB/512 pids 的默认值，这正是 AT-261 测得的浪费。
- Arquiteto 开始按模块声明资源，而模型可能把数字弄错。**往高**错要花机器，并且在 `rationale` 中可审计；错到上限之上是带原因的 400；**往低**错是剩下的风险，它与 Arquiteto 选择镜像时已经在做的决定同一量级。这个数字是**声明的**，而不是测量的——测量容器的真实消耗是另一条战线，不在此进行。
- Infra Lead 想要时可以请求**高于**最低值（直到上限），绝不能低于。低于最低值的拒绝发生在**执行**时：一个资源低于最低值的 `pending` 提议只有在被批准时才失败，原因在 `executionResult` 中。在提议时就拒绝需要在 `ProposeActionUseCase` 中读取映射，这里没有做。
- `choose_project_image`（Arquiteto 从零决定镜像，RN-105）**不**变：在那里 Arquiteto 自己选择资源，而所有者的要求针对的是 Infra 的选择。经由 runner 的启动（`container_start_via_runner`）也不变：它启动已决定的镜像，带着其中记录的资源。
- 上限保持不变，其他上限也都不动。
- CPU 小数的总和四舍五入到三位小数，以免构件写入 `0.30000000000000004`。

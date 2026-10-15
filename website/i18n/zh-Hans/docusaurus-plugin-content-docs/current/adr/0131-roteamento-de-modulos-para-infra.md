---
traducao_de: e27637347c3751bbf825284e720697ab103880db
---

# ADR 0131 — Arquiteto 把模块路由给 infra：它**提名**，Infra **选定**

## 背景 {#context}

Arquiteto 已经有六个工具（`create_module_map`、`assign_story_modules`、`choose_project_image`、`create_c4_diagram`、`propose_adr`、`emit_insight`）以及一个镜像决定——`choose_project_image`（ADR 0065）——它是**按项目**的：一个镜像，用于整个项目的容器。在真实容器中执行的计划（ADR 0128/0130）要求更细的粒度：一个模块技术栈各不相同的项目（一个 Node 服务、一个 Python worker），当每个模块都需要单独启动时，放不进一个镜像。

设计问题不是“哪个镜像”，而是“谁决定什么”。Arquiteto 已经看到了架构（`module_map` 就是它写的），但它看不到已在使用的镜像群、多维护一个变体的成本，以及 Infra 遵循的运维约定——这些是 Infra 的职责，而不是架构的。赋予 Arquiteto **固定**每个模块镜像的权力（就像 `choose_project_image` 固定项目的镜像那样），会把一个运维决定推给只拥有设计一侧的人。

## 决策 {#decision}

**Arquiteto 提名；Infra 选定。** 本次交付只是 Arquiteto 那一半：一个新工具 `route_modules_to_infra`，产出一个**列表**——当前 `module_map` 的每个模块一项 `{modulo, imagemCandidata, porque}`——并把它写成 `artifact.module_routing`，与 `artifact.module_map`/`artifact.project_image`/`artifact.c4_diagram` 并列（与 ADR 0065 相同的无表设计，在此扩展：事件**就是**构件）。**选定**的那一半（Infra Lead 读取这个列表并做出决定，带自己的 `proposed_action`）是另一个 PR——路由在 Infra 拥有使用它的工具之前就已存在且可审计，这与 `module_map` 先于需要它的 `create_c4_diagram` 到位是同一种排序。

**`:direct`，不在全局 `@registry` 中——不是 `proposed_action`。** 路由没有外部效果：它不启动容器，不改变事件日志之外的任何东西。它是架构**内部**的决定，与 `choose_project_image` 和 `create_c4_diagram` 同一量级，它们也是 `:direct`。把它变成 `proposed_action`，会把一个草稿式的决定（Infra 还要审阅）放进批准 `git push` 的同一个队列。

**候选镜像逐项经过与 `choose_project_image` **相同**的验证。** `validarDecisaoDeImagem`（`domain/containers/project-container.ts`）已经知道拒绝没有 tag/digest 的镜像、`latest` 以及过短的 `rationale`——按模块重新实现这条规则会产生两个会分歧的版本。新的领域（`domain/architecture/module-routing.ts`）只增加列表**自身**的内容：不能为空（那不是一个决定）、不能重复模块（有歧义——两个镜像中哪个有效？），并且每个引用的 `modulo` 都必须存在于项目当前的 `module_map` 中（与 `assign_story_modules`/`missingModules` 相同的检查，理由也相同：拒绝时列出**有效**的名称，免得模型去猜）。

**没有 module_map 就没有可路由的东西——拒绝，而不是编造。** 该工具只有在 `create_module_map` 之后才有意义；`ArquitetoServer` 的 `build_kickoff/1`（模型学习工具**顺序**的唯一地方）开始把 `route_modules_to_infra` 列为第 4 步，紧跟在 module_map 之后。在没有当前 module_map 时调用会被拒绝，文字与 `create_c4_diagram` 相同——“defina o module_map antes”——而不是针对空的或编造的映射进行路由。

## 后果 {#consequences}

**还没有任何东西启动容器。** 本次交付不改变 RN-105 的闸门，不触碰 `RegistrarTransicaoDeContainerUseCase`，不引入新的 `proposed_action`。它之后存在的是：一份可审计的提名列表，由人在事件日志中阅读——Infra 还没有对它采取行动的工具（下一个 PR）。

**候选镜像可能与项目镜像（`choose_project_image`）不同。** 这是有意的：某个模块可以为不同于 Arquiteto 为整个项目固定的镜像给出理由——这正是本次交付要打开的粒度。调和两者（或者为按模块路由而淘汰 `choose_project_image`）是另一项产品决定，不在此作出。

**`EstadoDoRoteamento`/`GetModuleRoutingUseCase` 沿用 `GetC4DiagramUseCase` 的模子**——无表读取，当前版本取最大 `version`，以 `seq` 决胜。作为单独的用例存在（而不是内联在写入用例中），正是它在不重复“哪个是当前版本”逻辑的情况下提供正确的版本化——这与 `DecidirImagemDoProjetoUseCase` 使用 `ObterContainerDoProjetoUseCase` 的理由相同。

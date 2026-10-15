---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0072 — 项目选择代码存放在哪里：用户目录还是托管目录

## 状态 {#status}

已接受。

本 ADR **修订 [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md) 的一部分**，后者仍然被接受且不被编辑；并触及 [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md) 所描述的领域。两者决定的方向与本文档**相反**——走向容器之墙——这正是为什么后果一节是这里最重要的：它毫不打折地声明失去了什么。

## 背景 {#contexto}

### 需求 {#o-pedido}

> "Cruzar a fronteira de apenas escrever código no container e poder escrever
> código a partir de uma pasta do usuário. Ao criar o projeto separar **Local**
> para ter este propósito de ser alguma pasta do usuário e **Container** com a
> opção que já tem hoje."

关于路径的形式，产品所有者在知晓"只有当目录挂载到容器中才能工作"这一警告的情况下，明确选择了这种变体：**自由路径，由用户输入**。

### 领域：今天存在的唯一边界 {#o-terreno-a-única-fronteira-que-existe-hoje}

在本 ADR 之前，项目的根字面上就是一行：

```ts
join(PROJECT_WORKSPACES_ROOT, workspaceDirName)
```

其中 `workspaceDirName` 对照 `^[A-Za-z0-9_-]{1,64}$` 校验（`apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`）。这种形式的力量不在于校验，而在于 `join`。有一个不含 `/` 也不含 `..` 的段，结果**不可能离开**托管根，无论该列发生什么。这是**结构性**约束，它支撑着四个需要彼此一致的使用者：

| 使用者 | 位置 | 如果根不一致会坏掉什么 |
|---|---|---|
| `permissions.json` | `fs-permissions-file-store.ts` | 策略从一处读取，却应用到另一处 |
| 终端作用域（ADR 0055） | `propose-action.use-case.ts` → `decide.ts` | **授权**命令的作用域指向错误的目录 |
| Code 标签页的读取（RN-095） | `caminhoDeRepositorioContido` | 读取约束作用在错误的目录树上 |
| engine 的工作树 | `apps/engine/lib/engine/actions/workspace.ex` | agent 写在 api 不读的地方 |

### 变化 {#o-que-muda}

`projects` 增加一对（`workspace_mode`、`workspace_path`）。在 `container` 模式——默认，也是所有现有项目的行为——什么都不变。在 `local` 模式，根变成用户输入的绝对路径，`join` 退出舞台。

## 决策 {#decisão}

1. **模式属于**项目**，在创建时选择，默认为 `container`。** 迁移 `0043`。把 `container` 作为列的默认值，才能让现有项目不改变位置——并且该决定是 NOT NULL，与 `story_promotion`（ADR 0046）一样，因为值**就是**决定，而权威性的决定不应是隐式的。

2. **模式和路径是**一个**决定，由数据库中的 CHECK 锁定**（`(workspace_mode = 'local') = (workspace_path IS NOT NULL)`）。锁不只放在用例中，因为该列由**两个**进程（api 和 engine）读取，并由不经过用例的 seed 和回填脚本写入。没有路径的 `local` 会让终端作用域指向虚无；带路径的 `container` 会成为第二个事实来源，等着与第一个分歧。

3. **派生仍然是**唯一**的。** `projectScopeRoot` 改为接收**位置**（`{workspaceDirName, workspaceMode, workspacePath}`）而不是目录名，由它来选择分支。没有任何调用方获得自己的校验：让这个函数存在的理由——两种派生必须一致——在有两个分支的今天更加成立。PÓS-FASE 15 的规则适用：*在每个调用方中重复它，就是一个终有一天会分歧的检查*。

4. **创建时的守卫选择拒绝，而不是让它之后坏掉（RN-170）。** 一个没有挂载到容器中的路径，会产出一个在第一个 agent 的第一个工具调用时就卡住的项目，远离做出决定的那个界面。创建时进行校验，并以 400 拒绝，**附带如何挂载的说明**：绝对路径、不含 `..`、存在、是目录、并且进程可写（`access(W_OK|X_OK)`——镜像以非 root 运行，ADR 0024，属于其他所有者的主机目录实际上以只读方式到达）。

5. **拒绝涵盖系统根和 Brabo 的 checkout，两个方向都是。** `/`、系统目录及其下的一切都被排除，因为项目的根就是授权 agent 终端的作用域：一个根在 `/etc` 的项目会把"agent 可以写它的项目"变成"agent 可以重写容器"。与 Brabo checkout 的重叠在两个方向上都被拒绝——**包含** monorepo 的目录（需求的字面情况）和**在它内部**的目录，后者正是 ADR 0055 报告真实发生过的问题。拒绝一个而允许另一个，等于关上门却留着窗。

6. **守卫的词法部分在**读取**时也会运行。** 创建时的校验是关口，而绕过它的唯一方式是直接写数据库——一旦发生，得到的就是 `/` 上的终端作用域。因此 `projectScopeRoot` 在每次派生时重新应用词法谓词，并大声失败。不在那里重新校验的是磁盘部分（存在、可写）：那是 I/O，而该函数处在热路径上。

7. **Arquiteto 的镜像关口（RN-105）不适用于 Local 项目。** 它之所以存在，是因为容器让读取代码有意义；Local 项目不启动任何容器。没有这个决定，Code 标签页会在一个 Arquiteto 的决定永远不会发生的项目中永远返回 409——标签页因副作用而关闭，而不是因选择。豁免放在关口的同一个漏斗中，从不散布在各条路由里。

8. **engine 读取两列，并在**查询**中解析定位符。** `Engine.Projects.Project` 在 `container` 模式下返回目录**名**，在 `local` 模式下返回**绝对路径**，`Workspace.workspace_dir/2` 通过开头的斜杠区分两者——这是无歧义的，因为目录名对照一个不允许 `/` 的正则校验。在查询中而不是在每个调用方中解析，与第 3 项是同一个论据。

## 本 ADR 不做什么 {#o-que-este-adr-não-faz}

- **不按项目启动容器。** FASE 25b 仍被切分，ADR 0065 仍按原样有效。`local` 项目在与今天**相同**的容器中运行；变的是目录。
- **不改变外部效果的边界（RN-106）。** `git push`、打开 PR 和部署在终端中仍然是 `deny`，无论在作用域之内还是之外，在 Local 模式和 Container 模式中都一样。
- **不改变终端策略（ADR 0055）。** 路径作用域和狭窄的白名单仍是边界；变的是作用域从哪里开始。
- **不提供目录选择器。** 路径是输入的，这是产品所有者声明的决定。选择器需要 api 向浏览器枚举容器的文件系统，那是为了解决人体工学而新增的暴露面。

## 后果 {#consequências}

### 痛的那一条，也是本次交付声明的代价 {#a-que-dói-e-é-o-preço-declarado-desta-entrega}

**对于 Local 项目，`join` 的结构性约束不复存在。** 以前没有任何损坏的列能产生 `PROJECT_WORKSPACES_ROOT` 之外的根，现在根就是列所说的东西。取而代之的是一份拒绝列表（第 5 项）和读取时的重新校验（第 6 项）——而拒绝列表正是 **Z 和 AD** 发现证明对命令动词不会收敛的那类屏障。支撑这一决定的差别在于空间：绝对路径是一个封闭且有序的空间，"位于此根之下"可以用前缀判定，而动词/形式/调用是三个开放空间。这不是同一个问题，但它也不是一堵墙。

**ADR 0055 中声明的符号链接途径仍然开放，现在它指向用户的机器。** 规范化按契约是词法的（`decide()` 是纯函数，零 IO），所以项目目录**内部**指向外部的符号链接不会被检测到——而在 Local 模式下，"外部"可能是操作者的 `$HOME`。关闭它需要隔离而不是策略，仍然依赖于 FASE 25b。

**用户的目录变得可被 agent 写入。** 这是需求本身，不是副作用：agent 在用户的目录中写代码。值得大声说出来的是，该项目的 `permissions.json` 也会存放在其中，删除目录也会一并删除策略。

### 有帮助的那些 {#as-que-ajudam}

- **对不做选择的人来说什么都不变。** 默认值就是一贯的行为，现有测试套件在行为上没有任何修改就通过了——只有签名变了。
- **拒绝有明确时机并带有指导。** 最可能的失败模式（目录未挂载）在做出决定的界面上变成带有需要添加的 compose 行的 400，而不是之后变成一个卡住的 agent。
- **gate 的对外契约、RBAC 和合并锁（RN-014）都没有被触碰。**

### 对运维人员的要求 {#o-que-exige-do-operador}

在**两个**服务中、以**相同**的绝对路径挂载目录——见 `docs/runbook.md` 的"Projeto no modo Local"一节，以及 `docs/reference/configuration.md`。只在 api 中挂载，会产出一个 api 接受而 engine 看不到的项目：api 校验它看到的东西，而它无从得知另一个容器中挂载了什么。

## 考虑过的替代方案 {#alternativas-consideradas}

- **一个用户目录的根，项目从中选择一个**子目录**（`LOCAL_WORKSPACES_ROOT` + 名字）。** 它会保留 `join` 和完整的结构性约束，是最强的替代方案——但它不是需求：产品所有者在知晓警告的情况下选择了自由路径。
- **接受路径而不校验，让它在使用时失败。** 被放弃：这正是 RN-170 存在所要阻止的失败模式，而它会出现在远离做出决定的那个界面的地方。
- **把 Local 项目标记为"没有 Code 标签页"，而不是豁免 RN-105 的关口。** 那会因为一条不涉及新模式的规则而惩罚新模式。

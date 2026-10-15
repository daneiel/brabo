---
traducao_de: 11f3dbb485e7626c292e2f894b0d8ece64429d47
---

# 0141 — 挂载项目的唯一 base，按同一路径挂载

## 背景 {#context}

`mounted` 模式（旧称 `local`，ADR 0072/RN-169，由 ADR 0104/RN-421 重命名）把项目代码放在**用户**的目录中，而这个目录需要能从**两个**容器内部访问：api，它读写 `permissions.json` 并提供 Code 标签页；以及 engine，它组装 worktree 并编写代码。从一开始，机制就是 bind-mount。

从未被决定的是**谁来创建这个 bind-mount，以及何时**。存在的只是一条**说明**：`docker/docker-compose.yml` 在 `api` 和 `engine` 服务中带着一大段注释，教人为每个项目手工添加一行——

```yaml
- /home/voce/projetos/loja:/home/voce/projetos/loja
```

——而当目录不在那里时，项目创建会以 400 拒绝（RN-170/RN-422），消息中重复这一行。拒绝是好的，并且继续存在；问题在于它所教的补救办法的代价。

**每创建一个项目，就要编辑一次 compose 并重启 `api` + `engine`。** 重启这两个服务会杀死整个安装中所有进行中的 agent 轮次、所有打开的终端 socket 和所有进行中的 LLM 调用——只为了接入一个项目。当 `mounted` 只是给内行人用的应急出口时，这还可以容忍。一旦它成为一等选项，在创建界面上带着建议路径提供出来，就不再可以了。

还有第二个问题，建议路径让它变得具体。"项目目录不得与 Brabo 的 checkout 重叠"这条规则是 [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md) 的核心，由 `caminhoDeWorkspaceLocalValido` 通过与 `raizDoBrabo()` 比较来执行——后者是 `process.cwd()`，在 api 容器内部是 `/workspace`。开发者磁盘上**真实**的 checkout，api 无从得知。把 Brabo 克隆到 `$HOME/brabo` 并把项目目录指向那里的人，会通过**所有**现有校验，而 dev agent 就会开始在产品自身的目录树中执行命令——这恰恰是 ADR 0055 存在所要阻止的失败，从一扇它没有看守的门进来。

## 决策 {#decision}

**一个**唯一**的 base，由运维人员配置，在 `api` 和 `engine` 服务中**按同一路径**挂载。**

```
# .env
BRABO_PROJECTS_BASE=/home/voce/brabo
```

```yaml
# docker/docker-compose.yml — serviços api E engine
- ${BRABO_PROJECTS_BASE:-brabo_projects_base}:${BRABO_PROJECTS_BASE:-/data/brabo-projects-base}
```

运维人员**配置一次**，执行一次 `docker compose up -d api engine`，之后永远不再需要按项目编辑任何东西。每个 `mounted` 项目都位于 base 之内。

左侧 `${VAR:-nome_de_volume}`、右侧一个绝对且惰性的默认值，这个技巧与相邻行中 `PROJECT_WORKSPACES_HOST_DIR`/`GIT_LOCAL_REPOS_HOST_DIR` 已使用的**相同**：没有变量时，左侧是文件末尾声明的一个命名卷的名字，这一行仍然是合法的 Compose，并且不会从主机挂载任何东西。

没有变量时，api 报告 `projectsBase: null`（`GET
/workspaces/:workspaceId/projects-base`，`maintainer`——与 `POST
.../projects` 相同的最低要求，因为这个值存在正是为了决定那条路由提供什么），创建向导**不提供**"挂载目录"模式。绝不提供一个安装不支持的模式。

### 为什么是一个**新**变量，而不是 `PROJECT_WORKSPACES_HOST_DIR` {#por-que-uma-variável-nova-e-não-project_workspaces_host_dir}

已经有一个变量会把托管卷换成主机上的真实目录，复用它的诱惑很大。不这样做有三个理由，第一个关乎数据。

**1. 命名空间冲突，会在别人的目录中执行 `git init`。** 托管 workspace 由 `workspace_dir_name`（RN-109）命名，这是一个 UNIQUE 列；挂载项目由**用户**命名，用户输入路径。两个根指向同一个地方时，`<base>/loja` 和一个 `workspace_dir_name` 为 `loja` 的 `container` 项目会落到**同一个**物理目录——而 `Workspace.init_from_bare!` 会在另一个人的项目里执行 `git init`。schema 中没有任何东西阻止这一点：唯一性是在 `workspace_dir_name` 的值之间，从不针对 `workspace_path` 的 basename，而且也不可能有，因为一边由产品选择，另一边由输入的人选择。

**2. 归属语义相反。** `/data/project-workspaces` 属于**产品**：可丢弃、不透明，正是这一点让 `container` 项目随卷一起被删除变得可以接受。base 属于**用户**——是他的代码所在之处，在他的编辑器中打开，由他版本化。把两者合并，会让文档不得不说"这个目录是可丢弃的，又不是"。

**3. base 是可浏览的；托管根目录不应该是。** 由 api 提供的目录浏览器（下一个 PR）以 base 为作用域，让用户可以选择项目将存放在哪里。把两者混在一起，会把安装中每个 `container` 项目的内部暴露给任何正在创建项目的人。

### 为什么按**同一路径**（`$X:$X`），而不是固定挂载点 {#por-que-identidade-xx-e-não-um-ponto-de-montagem-fixo}

固定挂载——`${BRABO_PROJECTS_BASE}:/data/mounted`——写起来更短，但它是错的，原因有两个，并且相互叠加。

`projects.workspace_path` 的字符串**由用户输入，并展示回给用户**（`AmbienteDoProjeto`）。当主机 ≠ 容器时，产品必须选择保存两者中的哪一个，而任何选择都会让界面对某个人撒谎：保存内部路径会显示一个在他机器上不存在的目录；保存外部路径则需要在每个使用点做转换。

而同一路径恰恰免去了这种转换。`projectScopeRoot`（api）和 `Engine.Actions.Workspace.workspace_dir/2`（engine）按路径开头的斜杠区分模式，并按列中的原值使用。当主机 == 容器时，两者**无需一行新代码就继续正确**——而 ADR 0055 的终端作用域由同一个根派生，继续恰好授权用户所看到的那个目录。

### broker 获得**第二个**根 {#o-broker-ganha-uma-segunda-raiz}

`BRABO_PROJECTS_HOST_BASE` 进入 `broker` 服务，派生自 `BRABO_PROJECTS_BASE`（按定义它本来就是主机路径——`api`/`engine` 按同一路径挂载的正是它），与 `PROJECT_WORKSPACES_HOST_ROOT` 并列，理由与 [ADR 0130](0130-broker-de-container.md) 相同：`docker run` 的 `-v` 由**守护进程**针对主机文件系统解析，来自 api 内部的路径会挂载一个空目录。约束仍然**在 broker 中配置**，绝不由调用方断言——这是那个 ADR 真正的不变量。

目前还没有任何东西使用这个变量：针对这个根解析 `mounted` 项目的，是为"挂载目录"模式提供容器的那个 PR。它在这里诞生，是因为 base 在这里诞生，而一个晚半个 release 才出现的主机变量，是没人会把它和解释它的文件联系起来的变量。

### `/workspace` 的守卫，放在它能实现的地方 {#a-guarda-do-workspace-no-lugar-onde-ela-é-possível}

`scripts/dev/preflight.mjs` 开始在 `BRABO_PROJECTS_BASE` 与 Brabo 的 checkout 重叠时**拒绝启动**，两个方向都检查（base 包含 checkout；checkout 包含 base），使用 `git rev-parse
--show-toplevel`。

preflight 在**主机**上运行。它能回答 api 回答不了的问题，这也是守卫放在那里而不是放在领域层的原因：api 与 `process.cwd()` 比较，那在它的容器内部是 `/workspace`，永远看不到真实路径。纯逻辑位于 `scripts/dev/base-de-projetos.mjs`，一个独立且经过测试的模块——`preflight.mjs` 在顶层执行 `await main()`，从测试中导入它会把整个 preflight 跑起来。

## 后果 {#consequences}

**变好的地方。** 创建 `mounted` 项目不再需要编辑 compose 并重启 `api` + `engine`——不再付出整个安装中所有进行中的 agent 轮次、终端 socket 和 LLM 调用的代价。配置成为**运维人员**的一次性动作，而不是用户逐个项目的动作。而 api 的任何校验都触及不到的 ADR 0055 那条途径有了守卫，并附带一条消息，解释为什么别的东西都抓不住它。

**部署之前要求运维人员采取行动**，这也是分支以 `breaking/` 开头、版本提升 MAJOR 的原因：已经在使用 `mounted` 模式的人，在 compose 中手写了按项目的 bind-mount 行。它们继续有效——没有东西移除它们，本 PR 中也没有任何东西开始拒绝 base 之外的 `mounted` 项目（base 规则属于**创建**和**转换**，进入下一个 PR；在每次读取时运行的词法谓词不变）。但从这里开始，受支持的路径是 base，继续按项目逐行配置是没人再维护的债务。

**声明的代价 1：base 下的符号链接在两边解析不同。** base 内部指向其外部的符号链接，只有在目标也被挂载时，才会被容器**内部**的内核跟随——而它没有被挂载。目录浏览器拒绝进入符号链接（并统计跳过了多少，以免谎称"空目录"）；真正捕获分歧的是物化时的磁盘检查，表现为一个**具名**的 `failed`。这是带有已知漏洞的词法约束，与 ADR 0055 已经声明的相同，原因也相同：解析 `realpath` 需要在决策必须是纯函数的地方做 I/O。

**声明的代价 2：base 之外的代码需要移动目录。** 这个 v1 支持**一个** base。仓库散落在磁盘多处的人，需要把项目移到 base 内部——拒绝消息正是这样说的，而不是暗示存在某个隐藏配置。第二个 base（或一个列表）是一个在有人要求之前不作出的产品决策：每多一个根，就多一个目录浏览器要暴露、broker 要区分的根。

**本 ADR 不决定的内容。** 它不触碰 `caminhoDeWorkspaceLocalValido` 和 `projectScopeRoot`——要求 `mounted` 项目位于 base 之内属于下一个 PR，并且有意放在创建/转换中，而不是放在每次读取都运行的谓词中（否则 base 之外的遗留挂载项目会在被**读取**时崩溃）。它不改变 schema，没有迁移，`(modo, caminho)` 对的 CHECK 保持不变。它也不为 `mounted` 项目提供容器：那是另一个 PR，`BRABO_PROJECTS_HOST_BASE` 在那里获得使用者。

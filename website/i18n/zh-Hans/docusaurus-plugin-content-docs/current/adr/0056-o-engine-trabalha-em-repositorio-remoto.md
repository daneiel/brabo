---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# 0056 — engine 在远程仓库上工作

## 状态 {#status}

已接受——已在 backlog 的 Fase B 中实现并由测试证明（[RN-076](../business-rules/custo.md#rn-076)）。

实现中的一个发现，记录下来因为它改变了问题的规模：**四个使用者中有两个从来不需要凭据**。`Engine.Gates.Diff` 和 `Engine.Harness.ProjectContext` 只使用默认分支的**名称**——它们在远程 provider 上停下，是一个返回超出它们所需内容的函数造成的附带损害。把 `default_branch/1` 与 `remoto_de_trabalho/1` 分开，就在没有任何 token 的情况下解锁了这两者。

## 背景 {#contexto}

`Engine.Projects.ProjectRepository.get_local_repo_path/1` 对所有不是 `local` 的东西返回 `{:error, {:unsupported_provider, "github"}}`。四个使用者依赖它，全都一起停下：

| 使用者 | 不再工作的是什么 |
|---|---|
| `Engine.Dev.WorktreeManager` | dev agent 没有 worktree——写不了代码 |
| `Engine.Actions.TerminalExecutor` | 没有工作区，每个命令都失败 |
| `Engine.Gates.Diff` | QA 和 SecOps 没有它们要评判的 diff |
| `Engine.Harness.ProjectContext` | agent 在没有仓库的情况下组装上下文 |

不对称是根源：**api** 通过 **HTTP** 与 GitHub 对话——它创建了仓库、提交了 bootstrap 的文件、创建了分支——而 **engine** 在**文件系统**上工作，只认识本地的 bare repo。一个 GitHub 上的项目完成了对话那一半和 bootstrap，却停在构建那一半。

这就是今天阻止 FASE 13b 以书面形式存在的东西：它要求在一个通过远程 GithubProvider 从 fork **接管**的项目中进行一次测量的执行，而这次执行无法到达第一个命令。

### 已经就绪、不需要改变的 {#o-que-já-está-pronto-e-não-precisa-mudar}

`Engine.Actions.Workspace.init_from_bare!/3` 执行 `git init` + `remote add
origin <origem>` + `fetch` + `checkout`。**这已经是通用的**：`<origem>` 是本地路径只是 `local` provider 的偶然，而不是设计。把来源换成 URL，就能在不重写的情况下解决整条路径。

那么缺的不是 git 管道——而是**凭据**。

## 决策 {#decisão}

### 1. engine 向 api 请求一个工作远程，绝不保存凭据 {#1-o-engine-pede-um-remoto-de-trabalho-à-api-e-nunca-guarda-credencial}

token 以信封加密的方式加密存放在 `user_credentials` 中，主密钥属于 api。engine **不**接收主密钥，也**不**持久化 token：它在需要获取或推送的时刻，通过已经存在、带 service token 的 `/internal/*` 通道，向 api 请求项目的**工作远程**。

把主密钥交给 engine，会为了少一次 HTTP 调用而扩大产品最敏感密钥的爆炸半径。

### 2. token **绝不**进入 `.git/config` {#2-o-token-nunca-entra-no-gitconfig}

这是最重要的决定，它是 [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md) 的直接后果。

显而易见的路径——`remote add origin https://x-access-token:TOKEN@github.com/…`——把凭据以**明文**写进**项目文件夹内部**。而 [RN-075](../business-rules/custo.md#rn-075) 刚刚给了 dev agent 在这个文件夹内**自动批准**的读取：一个 `cat .git/config` 就会在不经任何审批的情况下返回 token，而它会在下一个回合中，在循环的历史里，传到 LLM 的 provider。

路径范围防止 agent 读取项目**之外**的东西。它不防止——也无法防止——产品自己放在**里面**的密钥。

所以：`origin` 保存**干净**的 URL，认证按调用注入，只在使用它的 git 进程期间存活。文件中没有凭据，`.git/config` 中没有，持久化的 helper 中也没有。

### 3. 凭据是 workspace **OWNER** 的 {#3-a-credencial-é-a-do-owner-do-workspace}

与 [RN-058](../business-rules/custo.md#rn-058) 对 LLM 密钥已经确立的规则相同，理由也相同：付费和授权的是 workspace 的所有者，而不是 agent，也不是打开会话的人。

### 4. `provider: local` 保持不变 {#4-provider-local-continua-igual}

这不是出于礼貌的向后兼容：local provider 是契约测试使用的，也是让 `pnpm dev` 无需任何凭据就能工作的。本地项目的工作远程就是 bare repo 的路径，路径的其余部分不知道其中的区别。

### 5. 凭据失败是 `infra`，并且会被说出来 {#5-falha-de-credencial-é-infra-e-é-dita}

缺失、过期或在仓库上没有权限的 token 以来源 `infra` 失败——不是 `modelo`，不是 `código`。这是 CLAUDE.md 关于失败来源的规则，而本轮的发现 T 表明，它恰恰在没人演练的错误路径上被违反。

## 后果 {#consequências}

**解锁的东西。** 远程 provider 上的项目开始拥有 worktree、终端、gate 的 diff 和上下文——也就是构建那一半。这是 FASE 13b 的前提：没有它，就不存在在远程仓库上测量的执行。

**变得更贵的东西。** engine 开始依赖 api 才能在文件系统上工作。一次 `fetch` 现在可能因为网络、token 过期或 api 宕机而失败——本地 bare repo 没有的三种故障模式。因此第 5 点是决定而不是细节。

**本 ADR **不**解决的东西。** 隔离仍然是 [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md) 中悬而未决的问题：token 不再在磁盘上，但 agent 仍然在与 Brabo monorepo 相同的容器中运行。在 git 进程运行的窗口期内对它执行 `env`，是比永久文件更小的攻击面，但不是零。

## 考虑过的替代方案 {#alternativas-consideradas}

**把主密钥交给 engine。** 省掉 HTTP 调用，却让产品的所有密钥可能泄漏的地方翻倍。拒绝。

**token 放在 `origin` 的 URL 中。** 这是几乎所有教程的做法，也正是 ADR 0055 让它变得危险的东西：把密钥写在 agent 拥有自动批准读取权限的地方。拒绝——并记录在这里，因为“简化”成这样的诱惑还会回来。

**把远程镜像到本地 bare 并同步。** 会让 engine 保持不变，却会产生仓库的第二个事实来源，当有人直接推送到 provider 时会静默分歧。拒绝。

**只保留 `local` 并推迟。** 这是当前状态，也是阻止 FASE 13b 的东西。

## 参考 {#referências}

- [achados-execucao-real.md](../explanation/achados-execucao-real.md) 的发现 N，[backlog](../explanation/backlog.md) 的 Fase B。
- [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md)——使决定 2 成为必需的范围。
- [RN-058](../business-rules/custo.md#rn-058)——agent 花费的凭据属于谁。
- `apps/engine/lib/engine/projects/project_repository.ex`、`apps/engine/lib/engine/actions/workspace.ex`、`apps/engine/lib/engine/actions/git_executor.ex`。

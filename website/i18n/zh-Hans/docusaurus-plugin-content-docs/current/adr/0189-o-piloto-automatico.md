---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0189 — 自动驾驶：自动模式批准一切（上限除外），作用域与真实执行目录比较，"始终允许"记录动词 + 子命令

## 状态 {#status}

**已接受。** 2026-10-01（AT-259、AT-255、AT-258 和 AT-257——后者关闭 AT-170——，故事 HS-066，史诗 EP-030，第 35 轮；所有者 10月1日的决定，写在各活动中）。引用 [ADR 0167](0167-modo-automatico-libera-o-escopo-de-caminho.md)（自动模式解除路径作用域）和 [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md)（终端策略的路径作用域），但不编辑它们：0167 **没有被撤销**——自动模式继续放行任何命令，包括目录之外的——而 0055 仍是上限，现在与命令**实际运行**的目录比较。

## 背景 {#context}

2026-09-29 的真实使用测得同一策略的三个缺陷（`analise-uso-real.md`，第 9 和第 11 项）：

1. **"始终允许"会关闭自动模式。** 七个 dev agent 在 06:48:28–34 收到通配规则 `*: auto_approve`，几秒钟后又得到由 dev agent 的"始终允许"写入的 `terminal: auto_approve` 一行（[RN-509](../business-rules.md#rn-509)）。仓储先于通配规则返回**具体**规则，来源为 `especifica`，而 `decide()` 只在来源为 `curinga` 时才识别自动模式（[RN-603](../business-rules/autenticacao.md#rn-603)）。结果：界面上自动模式亮着，却有 97 次"comando composto com ao menos um segmento não coberto por allow"请求和 37 次"escopo"请求。
2. **作用域与命令**不**运行的目录比较。** 那 37 次"escopo"全是 `/work/...` 或 `/tmp`，被拿去与**主机**根目录（`/home/<usuario>/projetos-brabo/<projeto>`）比较。有 `running` 容器时，engine 在容器**内部**执行命令（RN-492/RN-502），位于 `/work`，并且只是在之后、在 `terminal_executor.ex` 中才把主机 `cwd` 转换为 `/work`。
3. **自动模式没有在界面上说明它放行什么。** [RN-661](../business-rules.md#rn-661) 的批量卡片说了它**不**放行什么；agent 卡片的开关和 `ApprovalCard` 的措辞不同，而且没有一个说 `git commit` 和本地分支会通过。

活动 AT-259 提议撤销 RN-603 中解除作用域的那部分。所有者在 10月1日作出相反决定：*"RN-603 不撤销——由于命令在容器中运行，自动模式继续放行任何命令，包括目录之外的，只要加以保持，使 Brabo 正在运行的代码不出任何问题"*。

改动之前在 `dev` 中测得（在今天的代码上失败的测试）：`decide.spec.ts`（容器中根目录的 5 个用例）、`agent-autonomy.repository.spec.ts`（具体规则遮蔽通配规则）以及 `approve-always-action.use-case.spec.ts`（测得的场景，端到端）。**未复现的：** 打开通配规则时，自动驾驶本来就批准 `git commit`、`git checkout -b`/`switch -c`/`branch` 以及 `git_commit`/`git_branch_create` 类型，并且本来就拦住 push/PR/merge/deploy、`sudo`/`doas`、`container_remove`、`instruction_patch` 和并行度——AT-259 只通过 AT-255 和界面关闭。

## 决策 {#decision}

### 1. 自动模式就是**自动驾驶** {#1-o-modo-automático-é-o-piloto-automático}

通配规则 `*: auto_approve` 批准**一切**，包括从 `permissions.json` 合成的复合命令和目录之外的路径（RN-603，保留），以及 `git commit` 和**本地**分支的创建。以下仍在外面，永远不可自动批准：通过终端的 git push/PR/merge/deploy（[RN-418](../business-rules.md#rn-418)）、`sudo`/`doas`、受保护分支上的合并、`container_remove`、`instruction_patch` 以及 `parallelize`/`raise_max_parallel`。显式的 `deny` 仍然胜出，而写在文件中的 `ask` 仍然会请求——那是用户的规则，与 RN-603 中一样。

### 2. "始终允许"不会关闭自动驾驶（最简单的形式） {#2-sempre-permitir-não-desliga-o-piloto-a-forma-mais-simples}

通配规则 `auto_approve` 之下的具体规则 `auto_approve` 按**通配规则**解析，就在原本已经解析优先级的**同一个**仓储中（`DrizzleAgentAutonomyRepository.resolve`）。AT-255 提供的两种形式——有通配规则时不写入具体规则，或者让通配规则对带有具体规则 `auto_approve` 的豁免生效——选择了第二种，理由有三：它修复了真实使用中**已经**写入的行（第一种只会避免以后的）；点击仍然写入具体规则，若开关切回手动它就生效（一如既往带作用域）；而且没有新路径产生——`decide()` 规则不变，只是收到了正确的来源。说**别的**事情的具体规则（`require_approval`、`deny`）仍然胜过通配规则。

`AutonomiaResolvida` 增加了 `especifica`（具体行的模式，若存在），"始终允许"正是依据它——而不是依据解析后的模式——来判断 agent 的模式是否已经写入。

### 3. 作用域与**真实**执行目录比较 {#3-o-escopo-compara-com-a-pasta-real-de-execução}

在 `container` 或 `mounted` 项目中登记有 `running` 容器时，作用域上限的根是 `/work`（挂载点——项目的目录和 `.worktrees`）加上容器的 `/tmp`。主机 `cwd` 按 engine 的**同一**规则（`cwd_para_container/2`）转换为 `/work`：根变成 `/work`，其下的内容变成 `/work/...`，其外的内容原样保留。在 `mounted` 中，转换是双射的（bind-mount 就是目录的同一性）。没有容器时，根是主机上的项目目录，而主机的 `/tmp` 在**外面**——它属于整台机器，包括 Brabo。

这适用于**不**在自动驾驶中的情形——具体规则 `terminal`——因为自动驾驶不经过作用域。`projectScopeRoot` 不变，也**不**与 `permissionsFilePath` 合并（RN-478）：主机根仍是输入，容器中的根在 `path-scope.ts` 中由它**派生**。容器的自动批准**下限**（RN-493）仍只属于 `container` 模式；`DecideContext` 的新字段（`execucaoNoContainer`）是命令**在哪里**运行，那是另一回事。

`runner` 有意不在内：主机还是容器的选择是 runner 内部的（ADR 0137），而一个在容器运行时重启的 runner 会路由到**主机**（RN-558）——api 不知道会发生哪一种，为可能在主机上的情形放行 `/tmp`，就等于放行用户机器的 `/tmp`。

### 4. 界面说明自动驾驶放行什么、不放行什么 {#4-a-tela-diz-o-que-o-piloto-libera-e-o-que-não-libera}

**一份**列表（`OQueOPilotoLibera`），出现在开启自动模式的**三个**地方：执行者的批量卡片（展开）、`ApprovalCard` 以及 agent 卡片的开关（折叠，位于原有那句话之下）。"不放行"的一半是 RN-661 已有的文字，直接复用；"放行"的一半在这里诞生。

### 5. 所有者的保证：隔离，已证明 {#5-a-garantia-do-dono-a-contenção-provada}

决定的条件——Brabo 正在运行的代码不出任何问题——不是策略，而是容器的隔离，并在 `apps/broker/src/contencao-do-brabo.spec.ts` 中端到端证明：项目容器挂载**一个**目录，总是在 `/work`，**严格**位于 broker 根（托管或 base）之下，没有 Docker socket，没有 `--privileged`，没有主机网络，而空的/绝对的/带遍历的路径段会在调用 Docker 之前被拒绝。再加上阻止根目录包含 checkout 的守卫（`preflight.mjs` 中的 `baseSobrepoeOCheckout`，在 `scripts/dev/base-de-projetos.spec.ts` 中测试）以及没有容器就拒绝执行（RN-502/RN-507），自动驾驶的命令触及不到 Brabo 的 checkout。

### 6. "始终允许"的单位：动词 + 子命令，按段 {#6-a-unidade-do-sempre-permitir-verbo--subcomando-por-segmento}

所有者 10月1日的决定（AT-257，关闭 AT-170——ADR 0055 中留下未决的第 6 点）：点击不再逐字节写入整条命令，而是为命令的每个**段**写入**一个**模式，单位是**动词 + 子命令**（`npm test`、`git status`）；不是单词的参数泛化为动词（`cat src/x.ts` → `cat`）；动词 + 标志保持**精确**（那是形式，Z/AD 发现正说明动词与调用方式在此分歧）；而作为 RN-418 某个上限前缀的单位（`git remote`、`gh pr`）保持精确，若连精确形式都是上限则直接消失。AT-170 的四个子问题都得到了回答：单位就是这个；它**不**继承动词白名单（不会产生任何动词列表，参数与子命令之间的疑问落在窄的一边）；写入者是与今天相同的角色；与通配规则的优先级见第 2 点。详情见 [RN-675](../business-rules.md#rn-675)。

## 后果 {#consequences}

- 9月29日测得的场景不再请求审批：通配规则 + "始终允许"仍在自动驾驶中（`approve-always-action.use-case.spec.ts` 中的防回归测试）。
- 具体规则 `terminal: auto_approve` 在容器运行时不再因 `/work/...` 和 `/tmp` 请求审批，而开始因命令中的**主机**路径请求审批（它在容器内并不存在——engine 只转换 `cwd`，从不转换参数）。
- **隔离证明**不**覆盖的内容——在此声明，不在此修正（所有者的决定是描述，而不是修补策略）：**
  1. 在**生产** compose（`docker/docker-compose.prod.yml`）中，主机上没有任何东西核对 `BRABO_PROJECTS_BASE` 不包含 compose 运行所在的目录（checkout，或 `.env` 所在目录）。`preflight.mjs` 只在 `pnpm dev` 中运行，而 `caminhoDeWorkspaceLocalValido` 与 api **自身**的 `cwd`（`/app`）比较，那从来不是主机路径。有这样的 base 时，一个目录就是 checkout 的 `mounted` 项目会把 checkout 挂载到 `/work`——无论是否在自动驾驶中。
  2. 在**安装**中，`install.sh` 只在征得同意时（`consentir_base`）拒绝与安装目录重叠的 base，没有专门的测试；之后被编辑的 `.env` 不会再被核对。
  3. 在 `runner` 模式中，没有任何东西把项目目录（或本地 agent 的 base）与用户机器上的 Brabo checkout 或安装目录作比较——api 与自身的 `cwd` 比较，而 runner 的 `guard.ts` 只在 Linux 上限制到 `$HOME`。
  4. `segmentoDeProjetoValidado`（`packages/docker-port`）接受 `.` 作为段：`<raiz>/.` 会作为根本身通过 `raizDeProjetoValidada`，并会挂载该根下的**所有**项目。api 从不产生 `.`（挂载的段经过规范化，托管的是 `[A-Za-z0-9_-]`），所以今天不可达；但 broker 的存在就是为了不依赖调用方的正确性。它触及不到 checkout（根不包含它），触及的是**其他**项目。
  5. `egress` 网络是 `bridge`：容器能访问机器发布的端口，包括 api 和 engine 的端口。文件不行；服务可以——在认证之后。
- 对复合命令使用"始终允许"，开始放行以后具有相同动词和子命令的复合命令——对于没有子命令的动词（`cat`、`rm`、`cd`），则是带**任意**参数的该动词。这正是 AT-170 要求被决定而不是被推导的扩展；在自动驾驶之外，路径作用域仍然限制位置，而上限仍在文件之后运行。
- **类型化**的 `git_push` 和 `pr_open` 在 `decide()` 中不是上限：激活按 `dev-<modulo>` 为它们播种 `auto_approve`（ADR 0053），通配规则也批准它们；拦住它们的是"始终允许"拒绝写入它们（AT-320）以及受保护分支的合并上限。这里没有改变。

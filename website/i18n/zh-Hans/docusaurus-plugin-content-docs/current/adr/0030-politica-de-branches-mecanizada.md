---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0030 — 机制化的分支策略

## 背景 {#contexto}

Brabo 的分支策略过去以演示文稿和 `CLAUDE.md` 中约定的形式存在：流水线 `dev → qa → main`、分支分类法、只在相邻阶梯之间晋升、计算出的版本、hotfix 通过回传合并回来。

写下的约定不是机制。只要规则只存在于文档中，它就依赖每个人在错误的时刻记起它——而错误的时刻总是事故发生时，凌晨 3 点，恰恰是记不起来的时候。更糟的是：没人核查的规则无法被*可见地*违反。它被静默地违反，症状在几个月之后、远离原因的地方出现。

FASE 6 在 Brabo 自己的仓库中把整个策略机制化了。本 ADR 为该阶段收尾：映射**规则 → 机制**，记录被切掉的内容以及重新引入每一项切分的代价，并分出其中哪些会成为产品 Gitflow 引导的模板——那是将来的阶段，现在不是代码。

两个约束塑造了一切。第一：**这是一个用户仓库，不是组织仓库。** 这里不存在 GitHub 团队，而 `GITHUB_TOKEN` 即使在组织中也读不到团队成员关系。第二：**本阶段不能触碰产品。** FASE 6 是仓库的 CI/CD；它教给产品的东西成为本 ADR，而不是代码。

## 决策 {#decisão}

### 规则 → 机制 {#regra--mecanismo}

| 策略规则 | 机制 | 逻辑所在 |
|---|---|---|
| 名字 `funcao/descritivo`，正则 `^.{0,15}/\S{0,32}$` | 检查 `pr-police` | `scripts/ci/pr-police.ts` |
| 前缀属于 9 个功能的封闭列表 | `pr-police` | 同上 |
| 工作从 `dev` 诞生，`hotfix` 从 `main` 诞生 | `pr-police`，按**污染** | 同上 |
| 目标与功能一致 | `pr-police` | 同上 |
| 只在相邻阶梯之间晋升 | `pr-police` + `promote` | `pr-police.ts`, `version.ts` |
| 每个 PR 都有家族标签 | `pr-police` | 同上 |
| 按目标要求的审批 | 检查 `approval-ladder` | `scripts/ci/approval-ladder.ts` |
| 由变量决定的两种审批模式 | `approval-ladder` | 同上 |
| `main` 上不同的人 | 回溯匹配 | 同上 |
| 按周期最大影响定版本 | `promote` + `tag-release` | `scripts/ci/version.ts` |
| `N` 按每次驳回递增 | 统计已有的 tag | 同上 |
| 正式版锚定在最后一个 `-qa.N` | `tag-release`，按**树 + 父提交** | 同上 |
| hotfix 产生无锚点的 PATCH | `tag-release`，按**第二个父提交** | 同上 |
| 禁止直接推送 | ruleset | `docs/reference/rulesets.md` |
| 强制且有序的回传合并 | 检查 `backmerge-gate` | `scripts/ci/gate.ts` |
| 永久分支上的合并总是手动 | 按决定没有机制 | — |

所有逻辑都是**可测试的脚本**；workflow 是一层薄壳，读取环境并调用脚本。共有 149 个测试，覆盖正常路径和失败情况。

### 比代码更有价值的七条教训 {#as-sete-lições-que-valeram-mais-que-o-código}

它们在这里，是因为每一条都付出了一次实证发现的代价，而且在第三方文档中都不明显。

**1. 每一类触发器从不同的地方读取 workflow。** `pull_request` 和 `push` 从事件的分支读取；`pull_request_target` 和 `workflow_dispatch` 从**默认**分支读取。使用 `pull_request_target` 时，`pr-police` **零执行**——`main` 落后 65 个提交。这是先有鸡还是先有蛋：让流水线前进的检查，必须已经在 `main` 上才能运行。

**2. 用 `GITHUB_TOKEN` 创建的 tag 和 PR 不会触发 workflow。** 防递归规则。`v0.2.0` 的 Release 因此从未发布，而一个没有检查的回传合并 PR 永远不会变绿——链条会永远卡住。因此有了 `BRABO_BOT_TOKEN`。

**3. "我无法核实"绝不能变成"一切正常"。** `promotion-check` 用 `gh api --jq` 读取合并配置并与 `'true'` 比较。当 token 没有权限时，命令**成功并返回空**——而空不是 `'true'`，于是核实会以错误的理由失败，或者更糟，通过。现在有三种状态，不可能核实变成警告，而真正的保证看的是既成事实：提交有两个父提交。

**4. 树相等比提交相等更强。** 锚点曾比较 sha——不可能满足，因为 `--no-ff` 会创建新提交。比较**树**并要求 `-qa.N` 是**父提交**更强：如果合并的另一边带来了一个文件，树就会改变。

**5. 是污染，不是来源。** 事后查明一个分支从哪里诞生是不可判定的：当 `P ⊆ Q ⊆ head` 时，按距离取最小值会选出被包含的最靠前的永久分支，而不是来源分支。正确的问题是另一个——"这个分支是否携带了比它声明的更靠前的永久分支的顶端？"——而这个问题有答案。

**6. 按作者豁免，绝不按前缀。** 豁免以 `dependabot/` 开头的分支会是一个敞开的漏洞：任何人都可以这样给分支命名。

**7. 声明的状态必须可以核对。** `.release/gate.json` 随回传合并 PR 传到 `qa` 和 `dev`；一次晋升可能把那份旧副本带回来，复活一个背后没有 hotfix 的锁——永远锁住仓库，因为没有待处理的回传合并能解决它。检查会询问 git hotfix 是否已经下行，并丢弃已满足的锁。`locked` 是意图的记录；包含关系才是事实。

### 被切掉的内容，以及回来的代价 {#o-que-foi-cortado-e-o-custo-de-voltar}

| 切掉的 | 原因 | 重新引入的代价 |
|---|---|---|
| `rc` / UAT 阶梯 | 没有环境、没有人来执行它，它会是仪式性的阶梯 | 创建分支，`ESCADA` 中一行，`ESTAGIO_POR_BRANCH` 中一行，审批阶梯中一行，gate 的顺序多一级——hotfix 的链条变成四个 PR |
| 带 `rcfix` 的分类法 | 随 `rc` 阶梯一起消亡 | `FUNCOES_DE_CORRECAO_ALTA` 中的条目，加上来源和目标的测试 |
| 用 GitHub 团队表示角色 | 用户仓库没有团队，`GITHUB_TOKEN` 即使在组织中也读不到成员关系 | 角色是变量中的 handle 列表；迁移到团队需要组织和一个带 `read:org` 的 token |
| 部署 | 从不运行的步骤会腐烂：没人测试它，开启那天它会是错的 | 由 tag 触发的**独立** workflow，加上 Environments——这里没有什么需要重新连接 |
| GitHub Environments | 同上 | 有环境时再创建 |
| `GOVERNANCE.md` | 在 FASE DOC 中被切掉；标准存在于 `branching-policy.md` 中 | 写这个文件并把角色一节移过去 |

`community` 模式下的审批阶梯**没有**被切掉：它已实现、经过测试，并通过配置关闭。差别是有意的——由变量关闭、两边都有测试的代码今天就能演示；由变量关闭的流水线步骤则不能。

### 什么会成为产品引导的模板 {#o-que-vira-template-do-bootstrap-do-produto}

产品用 Gitflow 开通仓库（FASE 2）。FASE 6 学到的、应在将来的阶段进入该模板的内容：

| 进入模板 | 不进入 |
|---|---|
| 流水线和分类法作为**数据**而非代码——产品中的项目有不同的阶梯 | 照搬 Brabo 的 workflow |
| 回传合并的 gate：缺了它代价最高的规则 | `BRABO_BOT_TOKEN`——每个仓库都需要自己的凭据 |
| 由 tag 计算的版本，不需要 bump PR | 本仓库的审批人列表 |
| 在 gate 中把"我无法核实"作为明确的第三种状态 | — |
| 按作者豁免 bot | — |

`GitProvider` 早已暴露 `capabilities`，而 ADR 0028 记录了分支保护**在 provider 之间存在分歧**。模板必须降级：没有 ruleset 的地方，规则变成检查，消息说明什么无法被保证——而不是假装有保证。

## 后果 {#consequências}

**策略不再依赖记忆。** 错误的分支名、跳级晋升、没有回传合并的 hotfix 以及没有锚点的正式 tag，现在都是带有教学性消息的检查失败，而不是迟来的发现。

**流水线被端到端演练过，而不只是单元测试。** `v0.1.0 → v0.2.0-dev.1..4 → -qa.1..3 → v0.2.0`，在 `qa` 的戳记之间上演了一次驳回，以证明 `N` 会自己计数。正式版锚定在 `-qa.3` 上，树完全相同。

**一个从不运行的必需检查会永远锁住 PR。** 这是最令人不适的后果：必需检查的列表现在是 ruleset（手工应用）与 workflow（版本化）之间的耦合。CI 中的新 job 要么进入 `rulesets.md` 的列表，要么有意留在外面并由某人写下原因。这就是为什么 `backmerge-gate` 的 job 上没有 `if:`：粘在一个没有运行的 sha 上的旧裁决，会在锁定期间放行合并。

**gate 的绕过属于操作者，而不是路径。** GitHub 的 ruleset 不能按路径限制绕过。能写 `.release/gate.json` 的人，技术上可以在 `main` 中写任何东西。真正起限制作用的是 workflow 和历史。记录为工具的局限。

**ruleset 的应用仍然是手动的。** 仓库对来源版本化（`docs/reference/rulesets.md`）；应用是所有者的动作。自动化需要一个有权改变自身保护的 token——那会抵消保护的意义。

**角色集中于所有者，这一点是写明的，而不是默认的。** 在 `APPROVAL_MODE=solo` 期间，发布负责人和 hotfix 值班都是所有者。这两项职责在迁移到 `community` 时重新开放，届时值班的回退必须是记录在案的例外，绝不是变通。

**产品没有任何改变。** `apps/` 没有一行被触碰。本阶段教给产品的东西在上面的模板表中，成为计划，而不是代码。

参考：ADR [0028](0028-protecao-de-branch-divergencia-entre-providers.md)（provider 之间保护的分歧）、[0029](0029-sincronizacao-continua-da-documentacao.md)（本阶段使用的文档机制），以及完整的策略 [branching-policy](../explanation/branching-policy.md)。

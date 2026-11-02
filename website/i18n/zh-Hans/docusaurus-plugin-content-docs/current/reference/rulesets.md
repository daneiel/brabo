---
id: rulesets
title: 仓库 Rulesets
sidebar_position: 8
description: 三个永久分支和标签的 ruleset 的精确配置，供手动应用——仓库对来源做版本管理，GitHub 接收应用。
keywords: [rulesets, 分支保护, 必需检查, 标签, release]
traducao_de: f6d9c3688e413d451640bbae2d5606da150cc14e
---

# 仓库 Rulesets

本页是保护措施的**版本化来源**。在 GitHub 上应用它是一个**手动**步骤——仓库
无法保护自己，这种不对称是有意的：放宽保护的必须是一个人，并且留有记录。

这些规则所执行的策略见
[分支策略](../explanation/branching-policy.md)。

> **当前状态：** `gh api repos/daneiel/brabo/rulesets` 返回 **0**。
> 尚未应用任何内容。在那之前，这里的一切都是声明的意图，而不是真实的保护。

## 前提：三个分支必须存在

阶梯有三级，而 ruleset 无法指向不存在的东西。

```bash
git fetch origin
git push origin origin/dev:refs/heads/qa
```

`dev` 和 `main` 已经存在。`qa` 从 `dev` 诞生——阶梯一开始是空的，由晋升逐步填充。

> 分支 `rc` 已从阶梯中**移除**。如果它仍存在于某个旧克隆的远程中，请删除它：
> `git push origin --delete rc`。一个不在阶梯上的永久分支，等于邀请 PR 指向一个
> 已不存在的台阶。

## Ruleset 1 —— 三个永久分支

**名称：** `permanentes`
**Enforcement：** `Active`
**目标：** Branch → `Include by pattern`，三个条目：`dev`、`qa`、`main`

> 三个分支一个 ruleset，而不是三个 ruleset：所有分支的要求完全相同。
> 台阶之间不同的是**谁批准**，而这由 `approval-ladder` 根据目标决定，而不是由保护决定。

### 要勾选的规则

| 规则 | 值 | 原因 |
|---|---|---|
| **Restrict deletions** | ✅ | 意外删除 `main` 在界面上无法挽回 |
| **Block force pushes** | ✅ | 对永久分支 force-push 会改写已晋升的内容；台阶的标签最终会指向一个不存在的提交 |
| **Require a pull request before merging** | ✅ | 这是核心规则：没有 PR，任何变更都进不来 |
| ↳ Required approvals | **0** | 起作用的是 `approval-ladder`，它了解模式和目标。GitHub 的原生数字无法区分 `dev` 和 `main` |
| ↳ Dismiss stale approvals on push | ✅ | 对旧提交的批准不算数——被批准的不是将被合并的 |
| ↳ Require review from Code Owners | ✅ | `CODEOWNERS` 把所有者设为所有内容的审查者 |
| **Require status checks to pass** | ✅ | 见下方列表 |
| ↳ Require branches to be up to date | ❌ | 会迫使每次合并到 `dev` 都要 rebase；CI 已在合并提交上运行 |
| **Block merge queue** | — | 未使用 |

**Required approvals = 0 并不是放宽。** GitHub 只会计数；它不知道 `main` 需要
PO + 管理层而 `dev` 需要一名开发者，也不知道在 `solo` 模式下所有者自己的 PR
无需审查即可通过。这里填 `1` 会**破坏** solo 模式：所有者无法在界面上批准自己的
PR，PR 将永远卡住。真正的要求在 `approval-ladder` 中，它是必需检查——而必需检查无法绕过。

### 两种配置并列

两种模式下 ruleset **相同**。变化的是变量——这也是为什么迁移不经过 Settings → Rules。

| | `solo`（现在） | `community`（未来） |
|---|---|---|
| **ruleset 中的 Required approvals** | **0** | **0** |
| 由谁要求 | 检查 `Escada de aprovação` | 同一个检查 |
| 变量 | `APPROVAL_MODE=solo`、`OWNER_HANDLE` | `APPROVAL_MODE=community`、`APROVADORES_*` |
| `dev` | 所有者 1 人 | 1 × 开发者 |
| `qa` | 所有者 1 人 | 2 × 开发者 |
| `main` | 所有者 1 人 | 1 × PO + 1 × 管理层 |
| 所有者自己的 PR | 无需审查即通过 | 与其他人一样走阶梯 |
| 不同的人 | 暂停 | 在 `main` 上生效 |

**两种情况下 Required approvals 都为 0，这是有意为之。** GitHub 只会计数：它无法
区分 `dev` 和 `main`，不了解角色，也不知道在 solo 模式下所有者自己的 PR 无需审查即可
通过。在那里填 `1` 会**破坏 solo 模式**——所有者无法在界面上批准自己的 PR，他的每个
PR 都会永远卡住。真正的要求在检查中，它是必需的，无法绕过。

复制并粘贴以启用各模式：

```bash
# solo — what's in effect today
gh variable set APPROVAL_MODE --body solo
gh variable set OWNER_HANDLE  --body daneiel

# community — fill in the lists BEFORE flipping the switch
gh variable set APROVADORES_DEVS   --body "ana,bruno,carla"
gh variable set APROVADORES_PO     --body "paula"
gh variable set APROVADORES_GESTAO --body "gustavo"
gh variable set APPROVAL_MODE      --body community
```

### 必需检查

**精确**名称，与 GitHub 登记的一致（是 job 的 `name:`，而不是 workflow 的）：

耗时列是**测量**的，不是估计的——三次真实运行，冷缓存和热缓存。它的存在是为了让
"优化 CI"从数字开始，而不是从猜测开始。`*` 标记的是由一次真实运行而非三次测得的
行——该 job 是新的（或刚被重命名），尚未重新进行冷 × 热采样；在此之前同一数字同时
填入两列。

| 检查 | workflow | 冷 | 热 |
|---|---|---|---|
| `Build, scan e smoke das imagens de produção` | `ci.yml` | **295s** | 109s |
| `Testes TS (api)` | `ci.yml` | 177s\* | **177s**\* |
| `Testes TS (web)` | `ci.yml` | 169s\* | **169s**\* |
| `Testes TS (pacotes)` | `ci.yml` | 56s\* | **56s**\* |
| `Testes do engine (ExUnit)` | `ci.yml` | 124s | 39s |
| `Auditoria de dependências` | `ci.yml` | 99s | 85s |
| `Lint` | `ci.yml` | 66s | 69s |
| `Drift, gerados e build` | `docs-check.yml` | 53s | 51s |
| `Manifests de Kubernetes` | `ci.yml` | 14s | 13s |
| `Gitleaks no repositório` | `ci.yml` | 5s | 7s |
| `Política de branches` | `pr-police.yml` | 7s | 7s |
| `Escada de aprovação` | `approval-ladder.yml` | 13s | 15s |
| `Check de promoção` | `promotion-check.yml` | 9s | 9s |
| `Backmerge gate` | `backmerge-gate.yml` | 7s | 7s |

**AT-303..306 之后（只有免费的改动，没有付费 runner）。** 上表中的名称**没有**改变
——重命名一个必需检查会卡住所有 PR——上面的数字是"之前"。底层改变的是：

- **当 diff 不涉及镜像时，`Build, scan e smoke das imagens de produção` 跳过繁重的步骤**
  （AT-303）。第一步用 `scripts/ci/diff-toca-imagem.ts` 对 PR 的 diff 分类（一个
  允许列表，列出永远不会进入镜像、smoke 或 E2E 的内容：`docs/`（`docs/gates.yml`
  除外）、`website/`、`scripts/docs/`、`deploy/k8s/`、`.github/`（`ci.yml` 除外）、
  根目录的 `*.md`（`THIRD_PARTY_NOTICES.md` 除外）、`design/*.md`；spec 通过变异
  针对真实的 Dockerfile 证明该列表）。Bake、Trivy、broker、smoke 和 E2E **逐步**带
  `if:`，job 总会结束——绿色，并在 job 摘要中说明原因。绝不在触发器上用 `paths:`，
  也不在 job 上用 `if:`：两者都会让必需检查悬而未决，或粘在一个过时的结论上。有疑问时
  （diff 为空、HEAD 不是 PR 的合并提交、`git diff` 失败）就全部运行。
- **同一个 job 缓存 Playwright 浏览器、`e2e/` 的 pnpm store 和 Trivy 数据库**
  （AT-304）——见
  [镜像 job 缓存的内容](../explanation/cadeia-de-suprimentos-do-ci.md#images-job-caches)。
- **`Testes TS (api)` 和 `Testes TS (web)` 各自成为两个分片的聚合器**（AT-305）。
  job `Testes TS (api) — shard N/2` 和 `Testes TS (web) — shard N/2` 各运行一半文件，
  带覆盖率但下限归零，并写出一份 vitest 的 `blob` 报告；聚合器——保留必需的名称——
  确认两个分片都以 `success` 结束、两份报告都已到达，并运行
  `vitest --merge-reports --coverage`，它将 `vitest.config.ts`/`vite.config.ts` 中
  **未改变**的 `coverage.thresholds` 应用于合并后的覆盖率（本地测量：合并覆盖率与单次
  运行相同）。聚合器有意带 `if: always()`：没有它，一个红色分片会让它变成 `skipped`，
  而 `skipped` 对必需检查算作绿色。分片的名称**不是**必需检查，不应列入 ruleset。
  类型检查只在分片 1 中运行。
- **`Testes do engine (ExUnit)` 和 api 的分片等待一个新 job，
  `imagens / Ler as imagens do compose`**（ADR 0197）：它从 `docker/docker-compose.yml`
  读取 pgvector 的引用并交给它们的 `services:`，因此没有 workflow 保存镜像字面量。
  它**不是**必需检查，不应列入 ruleset——它的决定会体现在依赖它的 job 中。这些 job
  出于与上面聚合器相同的原因带 `if: ${{ !cancelled() }}`：如果 `imagens` 失败，默认会
  **跳过** `Testes do engine (ExUnit)`，而 `skipped` 对必需检查算作绿色；有了它，job
  会运行、收到空镜像并失败。
- `claude-code-review.yml` 增加了 `concurrency`（cancel-in-progress，按 PR）和
  `timeout-minutes: 30`；`docs-check.yml` 在两个 job 上都增加了 `timeout-minutes`
  （AT-306）。

| 检查 | 之前，冷 | 之前，热 | 之后，冷 | 之后，热 | 之后，仅文档 PR |
|---|---|---|---|---|---|
| `Build, scan e smoke das imagens de produção` | 295s | 109s | TODO(humano) | TODO(humano) | TODO(humano) |
| `Testes TS (api)`（分片 + 聚合器，挂钟时间） | 177s | 177s | TODO(humano) | TODO(humano) | — |
| `Testes TS (web)`（分片 + 聚合器，挂钟时间） | 169s | 169s | TODO(humano) | TODO(humano) | — |

> **TODO(humano):** 用本 PR 自身的运行填写"之后"各列（冷：第一次 push；热：同一提交的
> 重新运行；仅文档：一个只涉及 `docs/` 的 PR），然后把数字搬到主表中。

**对下面 `edited` 标准的影响：** 镜像 job 现在还依赖于 BASE（diff 是针对它取的），而
`ci.yml` 仍然不在 `edited` 时重新运行。唯一不安全的方向是：一个 PR 针对某个 base 跳过了
镜像，之后被重定向到一个其 diff 会涉及镜像的 base——这很少见，因为晋升从永久分支的末端
运行（其 diff 总会涉及某些内容），而重定向通常会缩小 diff。下一次 push 会重新分类。

**`ci.yml` 是并行的，除了两个聚合器**——`test-api` 和 `test-web` 对各自的分片有
`needs`，其他都没有 `needs:`。PR 的完整结论花费的是最慢的那条链，而不是总和（约 12 分钟
CPU）。在 AT-303..305 之前，想缩短 PR 的人有两个目标，且只有两个：

- **冷缓存：镜像 job**，295s 中有 195s 是 `docker buildx bake`——整个 CI 中最大的单项，
  是第二名的 3 倍。bakefile 已经用每个镜像的 `type=gha` 缓存并行构建四个镜像，其顶部的
  注释测量了为什么把它拆成 job 矩阵会**更糟**：每个 artifact 1.7 GB 的镜像比构建本身更贵，
  而 smoke 需要四个镜像在同一个 daemon 中；
- **旧的 job `Testes TS (api + web)`**，159s 中有 91s 是 `pnpm --filter api test`，
  由 `apps/api/vitest.config.ts` 中的 `fileParallelism: false` 串行化，因为约 80 个
  触及数据库的 spec 共享**一个** `brabo_test`，并在测试之间执行 TRUNCATE——并行到达会
  发生冲突。这已被修正（`perf/banco-por-worker-nos-testes-da-api`，CHANGELOG）：每个
  Vitest worker 获得**自己的**数据库——`test/support/global-setup.ts` 迁移一个
  TEMPLATE 一次，并通过 `CREATE DATABASE ... TEMPLATE` 为每个 worker 克隆一个数据库
  （便宜，只是页面复制，而不是重新执行 migrations），`test/support/test-db-name.ts`
  根据 `VITEST_POOL_ID` 解析 spec 连接到哪一个，`vitest.config.ts` 打开
  `fileParallelism: true` 并设 `maxWorkers: 4`（固定为 runner 的 4 个 vCPU，不自动检测
  ——这个数字在核数更多的开发机和 runner 上必须**相同**，否则本地测得的行为就不是那里运行
  的行为）。本地测量：api 套件自身的时长在一次干净运行中从 792.58s 降到 471.23s（约 40%，
  三次重复无不稳定）。在 GitHub 真实托管 runner 上重新采样（PR #491，`ci.yml`）：
  `pnpm --filter api test` 这一步本身降到 **96s**——正好在本表引用为理论最佳情况的
  `91s` 热缓存下限上，而不是一个侥幸的离群点。

  这一修正改变了它所在 job 的形态，正是这使**第二次**削减成为可能。`apps/web` 自己的
  测试步骤在测得该 job 总计 `343s` 的同一次运行中增长到了 125s（PR #494，job
  `101317149006`）——不再是下面要点所描述的小尾巴，而是与 api 的旗鼓相当。
  `perf/paraleliza-testes-ts`（CHANGELOG）把 job 拆成三个并行的——`test-api`（保留
  `postgres` 服务以及 `DATABASE_URL`/`TEST_DATABASE_URL` 环境，因为它是唯一触及数据库
  的）、`test-web` 和 `test-packages`（CI 脚本、Docker 端口、broker、runner——六个从不
  需要 Postgres 的组件）——每个都有自己的 `checkout` + `setup-node` + `pnpm install`。
  在 GitHub 真实托管 runner 上测量（PR #495，`ci.yml`）：**177s**（`test-api`）、
  **169s**（`test-web`）、**56s**（`test-packages`），对比它们替代的 job 的 **343s**
  ——卡住 PR 的检查现在是三者中**最慢**的那个，而不是它们的总和，真实削减约 **48%**。

  `test-web` 和 `test-packages` 在本 PR 的所有运行中都很稳定（164–169s 和 55–56s）。
  `test-api` 则不然：第二次 push 测得 **388s**——比旧 job 总计的 343s 还差——所有步骤
  仍为绿色，随后对**同一**提交的简单重新运行测得 **172s**。本 PR 中 `test-api` 的三个
  真实样本：177s、388s、172s。三个中有两个落在 `test-web` 和 `test-packages` 所在的
  区间（在约 4 分钟目标内绰绰有余）；388s 的那次运行与 GitHub 一侧共享 runner 的争用
  一致，而不是拆分的回归——在那次运行与测得 172s 的重新运行之间，job 中没有任何改变。
  按观察记录，不加修饰：追查下一次 `test-api` 慢运行的人应该知道，这种波动在 job 被拆分
  的那天就已存在，在假设出现新回归之前先检查争用。

> **原先在这里的"两项成本"警告不再成立——两个前提都变了。** 它说拆分
> `Testes TS (api + web)` 会 (1) 在重命名时抹掉一个必需检查，使所有 PR 永远卡住，除非
> 一个 fan-in job 或 Settings 中的修改保留该名称，以及 (2) 不划算，因为无论拆成多少个
> job，api 的 91s 都要承担 setup，净收益约 7s。
>
> 前提 2 在 web 套件增长到与 api 套件成本相当时不再成立——拆分三个规模相当的组件，而不是
> 一个大的加若干小尾巴，正是把"≈150s 对 159s"变成"177s 对 343s"的原因。前提 1 因一个
> 正交的原因不再成立：**本仓库尚未应用任何 ruleset**——`gh api
> repos/daneiel/brabo/branches/dev/protection` 仍返回 `404`，与本页顶部的"当前状态"
> 说明一致——所以没有可抹掉的必需检查。上面的必需检查表已反映新名称。**如果将来应用了
> ruleset**，请列出 `Testes TS (api)`、`Testes TS (web)` 和 `Testes TS (pacotes)`——
> 绝不要列出已退役的名称 `Testes TS (api + web)`，它会悄无声息地匹配不到任何东西并卡住
> 所有未来的 PR，正如下面的通用警告所述。

> **检查的名称比它守护的内容小。** `Drift, gerados e build` 标题里是三件事，job 里是
> **五个** gate：`.docmap.yml` 完整性、生成文件是否最新、drift、站点构建，以及——自从
> API 参考在两个 release 中以损坏状态发布之后——**API 参考能够渲染**
> （`scripts/docs/api-render-check.mjs`）。
>
> 最后这个存在，是因为构建绿色并不等于页面能渲染：MDX 能编译，SSR 写出了内容，
> `docs:build` 通过，而页面在浏览器的 hydration 中死掉。完整机制见
> `docs/explanation/documentation-workflow.md`。向此 job 添加 gate 时，检查名称**不**
> 改变——这就是为什么它不需要在上表中重新登记，但需要写在某个地方。就写在这里。

> **`pull_request_target` 要求 workflow 位于 DEFAULT 分支。** 位于 PR 的 base 分支上
> 并不够。这是测量出来的，不是假设的：使用 `pull_request_target` 时，`pr-police` 的运行
> 次数为**零**，而使用 `pull_request` 的 `approval-ladder` 和 `docs-check` 从同一提交
> 正常运行。由于 default 是 `main`，而它只通过该检查本身守护的阶梯前进，这个触发器会成为
> 先有鸡还是先有蛋的问题。两者都使用 `pull_request`。

> **GitHub 从哪里读取每个 workflow——三类，三个答案。** 这在本阶段花了三次独立的发现，
> 而且在任何地方都不明显：
>
> | 触发器 | 读取 workflow 的位置 | 在这里的后果 |
> |---|---|---|
> | `pull_request`、`push` | **事件的分支** | 从第一个 PR 起就能工作 |
> | `pull_request_target` | **default 分支** | 没有运行：`main` 落后 |
> | `workflow_dispatch` | **default 分支** | 甚至不出现在 workflow 列表中 |
>
> 当 default 分支过时时，后两者会造成先有鸡还是先有蛋的问题：推动流水线前进的 workflow
> 必须已经在 `main` 上才能被触发。绕过的办法是在第一次晋升时手动运行 `promote` 脚本——
> 同一个脚本，只是手动触发。`main` 收到这些 workflow 之后，dispatch 就永远可用了。

> **一个从不运行的必需检查会让 PR 永远卡住。** 这就是为什么 `ci.yml` 的触发器覆盖三个
> 永久分支——在 FASE 6 之前它只在指向 `dev` 的 PR 上触发，而在 `dev→qa` 晋升中要求这些
> 检查会产生一个永远悬而未决的 PR。`push` 触发器被移除了：既然 `pull_request` 覆盖了一切，
> 它只会重复运行。向 CI 添加新 job 时，要么它进入这个列表，要么有意排除并有人写下原因。

> **而一个不会重新运行的必需检查会粘在过时的结论上。** 这是上面教训的另一面，它让一个
> PR 付出了一次错误失败的代价。
>
> `pull_request` 的默认类型是 `opened`、`reopened` 和 `synchronize`——没有一个覆盖
> **更改 base**。而更改 base 是常规操作：GitHub 针对 default 分支打开 PR，作者随后把它
> 改成 `dev`。在 PR #71 中，`Drift, gerados e build` 在最初的几秒内针对
> `origin/main...HEAD` 运行，并在七个已在 #70 中审查并合并的文件上失败。重定向没有让它
> 重新运行；红色留了下来。
>
> 判断谁需要 `edited` 的标准是**检查依赖什么**：
>
> | 检查依赖于… | 需要 `edited`？ | 谁 |
> |---|---|---|
> | 只依赖 HEAD | 否 | `ci.yml`——测试提交，base 不改变结果（自 AT-303 起镜像 job 的跳过决定除外——见上面的"对 `edited` 标准的影响"） |
> | 依赖 BASE，或 PR 的正文 | **是** | `pr-police`、`approval-ladder`、`promotion-check`、`backmerge-gate`、`docs-check` |
>
> 在 `docs-check` 中两者兼有：drift 比较一个从 base 开始的区间，并在正文中查找
> `docs-not-needed:` 行。没有 `edited`，下面记录的逃生阀就无法触及——在正文中写下理由
> 不会重新评估任何东西，只有一个假提交才能解锁 PR。

**`claude-review` 有意不在此列表中**，这就是"有人写下原因"：LLM 审查带有主观意见且消耗
token，因此它为 PR 提供信息但不能阻止 PR。由于它不是必需的，job 可以被跳过而不让 PR 悬而
未决——在每个由**机器人**打开的 PR 上它都会被跳过。该 action 拒绝以非人类参与者运行
（*"Workflow initiated by non-human actor: &lt;name&gt; (type: Bot)"*），所以没有这个
`if`，检查每次都会失败。这发生过两次：在 `v0.3.1` 周期的 PR #64 和 #65（晋升，由
`github-actions[bot]` 打开），以及再次在 PR #526（Dependabot）。

第二次是条件**写法**的后果。它枚举了一个登录名——`github-actions[bot]`——在集合改变之前
是对的，而在新机器人出现的那天就悄无声息地错了；`dependabot.yml` 在 PR #520 中到来，随后
Dependabot 的下一个 PR 重现了教训早已写下的失败。现在条件测试作者的 `type`，镜像
`ehAutorBot`（`scripts/ci/pr-police.ts`），并以登录名的 `[bot]` 后缀作为安全网——GitHub
不允许人类登录名中出现 `[`，所以它无法伪造。

对于晋升 PR 还有第二个独立的理由：那会是同一个 diff 再次被审查，因为晋升只携带已在指向
`dev` 的 PR 中审查过的提交。对于 Dependabot 还有第三个，它本身就关上了门——它的 PR 使用
**Dependabot 的密钥保险库**运行，与 Actions 的分开，因此 `CLAUDE_CODE_OAUTH_TOKEN` 为空。
即便允许该参与者，审查也没有凭据，而因缺少密钥而失败的检查比被跳过的更糟：它会被读成代码缺陷。

### 永久分支之间的 PR 无法满足的内容

`Drift, gerados e build` **是**必需的，所以它在每个 PR 上运行——但当 head 是仓库自身的
永久分支时（晋升 `dev→qa`、`qa→main`；回合并 `main→qa`、`qa→dev`），**drift** 步骤声明
自己不适用。job 的其他步骤——docmap、生成文件和站点构建——继续运行：它们只依赖 HEAD，在
任何台阶上都有效。

原因与 `claude-review` 相同，外加一个加重因素。首先是冗余：永久分支之间的 PR 没有**作者
身份**，它打包的提交的 drift 已在指向 `dev` 的 PR 中逐文件收取过。再次收取就是在每个台阶
收取同一笔债。但与 LLM 审查不同，这里的要求是**不可能满足的**——正是它让 #72（`v1.0.1`
周期的晋升）因来自 #70 的 `docker/**` 文件而失败：

| 表面上的出路 | 为什么它不存在 |
|---|---|
| 在晋升 PR 中更新文档 | `promotion-check` 要求一个**干净的区间**——head 必须是来源的末端。在那里提交会让另一个必需检查失败 |
| 重复原 PR 的 `docs-not-needed:` | 晋升 PR 的正文由 `promote` 生成；#70 的理由不会跨越台阶 |
| 在每次晋升上贴标签 | 这是在教人条件反射地使用逃生阀，直到它不再有任何意义——与 `.docmap.yml` 所要求的相反 |

过滤器位于步骤**内部**，而不是 job 上的 `if:`，遵循 `promotion-check` 记录的同一原则：一个
按 sha 索引、却不运行的必需检查会让 PR 永远悬而未决。步骤运行，判定不适用，并把这一点写进
摘要——而不是消失。

> **来自 fork、名为 `main` 的 head 不是晋升。** 那是第三方的工作分支，和其他分支一样经过
> drift。这就是为什么条件既匹配名称**又**要求是同一仓库——与 `pr-police` 在对 PR 家族分类时
> 应用的保留条件相同。

### Bypass

| 谁 | 模式 | 用途 |
|---|---|---|
| `BRABO_BOT_TOKEN` 的参与者 | `Always` | 在 `main` 上写入 `.release/gate.json` |

**没有任何人拥有 bypass**——连所有者也没有。这个属于机器人，它的存在有一个无法绕开的理由：
gate 会锁住分支，而用来打开锁的 PR 会被 gate 本身阻止。该提交留在 `git log` 中，带有日期和
内容，`tag-release` 通过它触及的内容（`.release/`，别无其他）来识别它，而不是通过它声称的身份。

> **关于 bypass 范围的警告。** GitHub 的 ruleset 把 bypass 授予**参与者**，而不是某个路径：
> 能在 `main` 上写 `.release/gate.json` 的，从技术上说就能写任何东西。界面上无法按路径限制。
> 真正起限制作用的是 workflow——它只写那个文件——以及历史，任何其他直接提交都会立刻显眼。
> 按其本来面目记录：这是工具的限制，而不是一个决定。

### 密钥 `BRABO_BOT_TOKEN`

带 `repo` + `workflow` 作用域的经典 PAT，放在 **Settings → Secrets and variables →
Actions**：

```bash
gh secret set BRABO_BOT_TOKEN --body '<token>'
```

这不是为了方便。有两件事依赖它，没有它两者都会悄无声息地失败：

| 什么 | 为什么 |
|---|---|
| 标签触发 `Release` | **用 `GITHUB_TOKEN` 创建的标签不会触发 workflow** |
| 回合并 PR 诞生时带有检查 | **用 `GITHUB_TOKEN` 打开的 PR 不会触发 workflow** |

这是 GitHub 防止递归的规则，它已经收过代价：`v0.2.0` 的 Release 因此从未发布。第二种情况
更糟——一个没有检查的回合并 PR 永远不会变绿，链条会永远卡住。这就是为什么当密钥不存在时，
gate 的 job 会**大声失败**，而不是继续下去把仓库留在死胡同里。

`workflow` 作用域并不过分：回合并 PR 携带整个分支，它可能包含对 `.github/workflows/**` 的
修改。没有这个作用域，push 恰恰会在最重要的情况下被拒绝——传播一个 CI 修复。

> **当前状态：已配置并经过实践。** 在 `v1.1.1` 中，流水线第一次自行闭环——`tag-release`
> 跳过了警告步骤，用 PAT 推送了标签，这**触发**了 `release.yml`，后者发布了 Release。用
> `GITHUB_TOKEN` 推送的标签不会触发它；这次触发就是该 token 有效且具有 push 作用域的证明。
>
> **仍有六个标签是孤立的**——`v0.2.0`、`v0.3.0`、`v0.3.1`、`v1.0.0`、`v1.0.1` 和
> `v1.1.0`——来自密钥不存在的那段时期。PAT 无法恢复它们：它只对新标签有效。针对它们的
> 步骤见下文。

### 重新发布孤立的标签 {#republishing-a-tag-that-was-orphaned}

`release.yml` 有带标签输入的 `workflow_dispatch`，它的存在正是因为上面那六个。只有
`push: tags` 触发器会让失败**不可逆**：重新发布将需要删除并重建标签，也就是为了纠正记录的
后果而改写记录。

```bash
gh workflow run release.yml -f tag=v1.1.0
```

三道防护，每一道都因为一种具体的失败模式而存在：

| 防护 | 针对什么 |
|---|---|
| 只有 `OWNER_HANDLE` 能触发它（`solo` 模式） | 与 `promote` 相同的限制；push 触发器不经过这里，因为在那里授权的是标签 |
| 输入必须匹配 `^v[0-9]+\.[0-9]+\.[0-9]+$` | `workflow_dispatch` 接受任意文本。没有这个，`-qa.1` 会发布一个无人验证为最终版的 Release |
| 如果 Release 已存在则拒绝 | 已发布的说明是一份记录；悄悄覆盖它会抹掉已经有人读过或链接过的内容 |

而 `checkout` 是**在标签上**进行的，而不是在事件的 ref 上。在 dispatch 中，
`github.ref_name` 是 default 分支——没有这一点，重新发布会生成一个名为 `main`、带有 `main`
changelog 的 Release，而且没有任何错误。

> **dispatch 只有在这些到达 `main` 之后才能工作。** 这就是上面触发器表中先有鸡还是先有蛋
> 的问题：`workflow_dispatch` 从 **default** 分支读取 workflow。当变更只在 `dev` 上时，
> 输入甚至不会出现。

## Ruleset 2 —— 版本标签

**名称：** `tags-de-release`
**Enforcement：** `Active`
**目标：** Tag → `Include by pattern` → `v*`

| 规则 | 值 |
|---|---|
| **Restrict creations** | ✅ |
| **Restrict updates** | ✅ |
| **Restrict deletions** | ✅ |

模式 `v*` 覆盖流水线创建的三种形式：`-dev.N`、`-qa.N` 和最终版。只有 `tag-release` 能创建它们。

> **最终标签运行什么，以及为什么这些都不是必需检查。** 推送 `vX.Y.Z` 会并行触发
> `release.yml`、`build-runner-binaries.yml` 和 `publish-runner.yml`。它们的 job 从不出现在
> 上面的必需检查表中，这是结构性的而非遗漏：必需检查拦住的是 **pull request**，而当标签存在
> 时 PR 早已合并。拦住标签的是 ruleset——只有 `tag-release` 创建它，而且只在它运行于其末端的
> 流水线之后。
>
> 最终标签还会触发 `install-e2e.yml`，它在一台**干净的机器**上运行已发布的 `install.sh`——
> Actions 的临时 runner 正是这样的机器。自 [RN-549](../business-rules.md#rn-549) 起它一直
> 走到最后：完成安装的五个环节、本地代理启动并等待，以及第一个 `runner` 项目被接手。它不在
> `pull_request` 上运行，原因与让签名不进入 PR 的原因相同：签名清单只在最终标签之后才存在，
> 让脚本在那里运行就等于给它一扇跳过验证的门（[RN-534](../business-rules.md#rn-534)）。
> 后果被说出来而不是被隐藏——**写下此 workflow 变更的 PR 不会运行它**——在每个 PR 上运行的是
> `scripts/dev/install-e2e.spec.ts`，如果触发器加上了 `pull_request`，或 workflow 用 grep
> 查找的某句话从 `install.sh` 中消失，它就会失败。
>
> 自 [ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md) 起，
> `build-runner-binaries.yml` 有**两个** job 而不是一个：矩阵 `build`（四个目标，
> `fail-fast: false`）和一个 `checksums` job。自 [RN-565](../business-rules.md#rn-565) 起，
> 第二个在矩阵上没有 `needs:`——它带上限地等待 Release 的 **assets**，而不是等待最慢的
> job——因此一个构建失败或从未获得 runner 的目标，不会让其他目标失去签名清单。它在日志中点名
> 清单**没有**覆盖哪些目标，因为一个列出三个却对第四个沉默的 `checksums.txt` 比没有更糟：
> 验证了这三个的人会以为自己验证了整个 release。
>
> 目标 `darwin-x64`（Mac Intel）在 [ADR 0174](../adr/0174-runner-sem-binario-darwin-x64.md)
> 中**移出了矩阵**，原因是测量得出的（AT-065，2026-09-13）：它的 `macos-13` 标签指向一个
> GitHub 已于 2025 年 12 月退役的镜像，而 Intel 替代品 `macos-15-intel` 在几秒内被调度并
> 能构建，但在 Bun 下 `--self-test-pty` 失败（`node-pty` 的 `onData` 从不触发——
> oven-sh/bun#25822，未关闭）。同样的验证在 Node 下通过，因此 Mac Intel 用
> `npm install -g @brabo/runner` 安装 runner。以空的 `tag` 输入运行该 workflow 是一次演练：
> 构建并做 smoke 而不附加任何东西，这正是在不切标签的情况下测得这些的方式。

### Bypass

| 谁 | 模式 |
|---|---|
| 运行 release workflow 的 app/机器人 | `Always` |

这是策略所预见的 push 例外：**版本诞生于 workflow，永远不是手工**。手工创建的标签不会经过
"最终标签指向与最后一个 `-qa.N` 相同的提交"这一验证，而正是这个验证防止发布与已验证内容
不同的东西。

## 如何应用

界面：**Settings → Rules → Rulesets → New ruleset**。

通过 API，如果你更愿意对命令做版本管理：

```bash
gh api -X POST repos/daneiel/brabo/rulesets --input ruleset-permanentes.json
gh api repos/daneiel/brabo/rulesets --jq '.[] | "\(.name): \(.enforcement)"'
```

> **TODO(humano):** 两个 `.json` payload 文件没有在这里版本化，因为 rulesets API 需要
> `repository_id` 以及随安装而变化的 app id——一个固定文件会被错误地复制。如果想对它们做
> 版本管理，请在通过界面应用之后用
> `gh api repos/daneiel/brabo/rulesets/<id> > docs/reference/...` 生成，本文档届时会指向它们。

## Settings → Pages：来源是分支 `gh-pages`

**手动**应用，原因与 rulesets 相同：仓库对来源做版本管理，GitHub 接收应用。

**Settings → Pages → Build and deployment → Source：
`Deploy from a branch`**，分支 **`gh-pages`**，文件夹 **`/ (root)`**。

**已经应用。** `gh api repos/daneiel/brabo/pages` 返回 `"build_type": "legacy"` 和
`source.branch: "gh-pages"`，三个台阶都在线响应。

中间那一步值得记录，因为它令人困惑：当 `build_type` 为 `"workflow"` 时，`docs-deploy.yml`
向 `gh-pages` 提交，**而 Pages 并不从那里提供任何内容**——发布留在仓库里而没有上线，旧站点
仍从 `actions/deploy-pages` 的最后一个 artifact 响应。在这种状态下 CI 中没有任何东西变红。

为什么这个切换是必需的而不是偏好：`actions/deploy-pages` 把**一个 artifact 当作整个站点**
发布，不知道如何更新树的一部分，这与每个台阶一个子目录不兼容。完整设计、被放弃的替代方案以及
由此打开的 push 例外见
[ADR 0034](../explanation/../adr/0034-documentacao-publicada-por-degrau.md)。

| 分支 | URL | 被索引 |
|---|---|---|
| —（三者的索引） | `https://daneiel.github.io/brabo/` | ❌ `noindex, follow` |
| `main` | `https://daneiel.github.io/brabo/prd/` | ✅ |
| `qa` | `https://daneiel.github.io/brabo/qa/` | ❌ `noIndex` |
| `dev` | `https://daneiel.github.io/brabo/dev/` | ❌ `noIndex` |

三者在 [ADR 0071](../adr/0071-publicacao-simetrica-por-degrau.md) 中变得对称，该 ADR 也解释了
生成的根目录以及把旧链接转发到稳定台阶的 `404.html`。
[ADR 0073](../adr/0073-o-caminho-publicado-nomeia-o-ambiente.md) 把**路径**与**分支**分开：
`main` 发布到 `/prd/`，因为地址为读者命名的是环境。`404.html` 开始把
`/brabo/main/<某物>` 改写为 `/brabo/prd/<某物>`——旧目录从树中移出，`keep_files: false` 将其删除。

**Pages 的配置不因这两者中的任何一个而改变**——来源仍然是文件夹 `/ (root)` 中的分支
`gh-pages`；改变的是 workflow 在推送前组装的内容。而 `prd` **不是**分支：它不在任何 ruleset
中，不存在于 `git` 中，只是 `gh-pages` 中一个目录的名字。

> **`gh-pages` 不进入永久分支的 ruleset。** 它不是永久的，而机器人需要向它推送——把它包含
> 进来会锁住发布本身。这也是为什么在那里 `GITHUB_TOKEN` 就足够了，不需要 bypass，也不需要
> `BRABO_BOT_TOKEN`。

> **它也不在 Gitleaks 的范围内，原因是后来才出现的。** `gitleaks detect` 扫描**所有可达的
> 提交**，而不只是 HEAD 的历史——而 `fetch-depth: 0` 会带来所有 ref。`gh-pages` 一诞生，
> 构建出的站点就进入了扫描：单个提交中有 **112 个 `generic-api-key` 发现**，全部在
> `dev/assets/js/*.js` 中，它们是压缩 bundle 内的头像文件名，熵对该规则来说太高。这让晋升
> PR **#78**——它首次亮相后第一个被扫描的——失败了。
>
> `ci.yml` 现在在扫描前删除 `refs/remotes/origin/gh-pages`。**不是**通过 `.gitleaks.toml`
> 中的路径允许列表：那会对所有提交生效，而某天出现在源代码中的 `dev/` 将悄无声息地不再被
> 扫描。排除 ref 恰好排除那些不是源代码的提交。
>
> 用 CI 所用的 gitleaks 8.30.1 测量：之前 133 个提交、112 个发现，之后 132 个、零发现——
> 而一个植入 `apps/api/src/` 的、具有真实熵的 GitHub PAT 仍然被检测到，这证明没有打开漏洞。

## 家族标签必须存在

`pr-police` 会应用四个标签之一，而如果标签不存在，`gh pr edit --add-label` 会**失败**——
这会让 PR 悄无声息地没有分类。

```bash
gh label create trabalho        --color 0E8A16 --description "Work PR: taxonomy prefix for dev"
gh label create promocao        --color 1D76DB --description "Promotion between adjacent rungs, going up"
gh label create retropropagacao --color 5319E7 --description "Back-propagation between adjacent rungs, going down"
gh label create correcao-alta   --color D93F0B --description "hotfix: a fix that's born high on the ladder"
```

有意不加 `|| true`：如果命令失败，你需要看到。

## 确认它已生效

```bash
# do the rulesets exist and are they active?
gh api repos/daneiel/brabo/rulesets --jq '.[] | "\(.name): \(.enforcement)"'

# does the protection respond? (should be REJECTED)
git push origin HEAD:dev
```

第二条命令才是重要的测试。一个配置了却未经确认的 ruleset 与一个不存在的 ruleset 无法区分——
而区别只在有人直接向 `main` 推送的那一天才显现。

---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0139 — 流水线合并的告警获得接收方，以及 `dev` 的规则

## 背景 {#context}

政策从一开始就说，晋升是 `--no-ff`（[branching-policy.md](../explanation/branching-policy.md)）：*"a squash would
flatten the lower step's commits, and the stage's tag would end up pointing to a
commit that no longer exists"*。这条规则被打破了**三次**——#367（2026-08-24）、#394（2026-08-25）和 #464（2026-09-04）——而第三次是所有中代价最高的，因为它恰恰是修复前两次的那个 PR。

调查时发现的不是检测上的漏洞。恰恰相反：

**验证存在并且起作用了。** 自 2026-07-27 起，`tag-release` 就会拒绝 `qa` 中没有第二个父提交的合并，而 2026-08-25 那次运行的日志清清楚楚地写着：

```
[tag-release] o merge em `qa` não é merge commit (1 pai)
##[error]o merge em `qa` não é merge commit (1 pai)
```

它在两次被 squash 的晋升上都响了。而历史照样被破坏，持续了 293 个提交，直到下一次晋升打开时出现了 11 个处于“冲突”的文件，而那并不是冲突——只是丢失的祖先关系。

**缺的是**响给谁听**。** 在永久分支上失败的 `push` 工作流没有可以变红的 PR：合并已经发生了。剩下的只是 Actions 标签页中的一次运行，没人会打开，因为没有任何东西提醒它的存在。仓库在整个历史中**零个 issue**——这个渠道不存在。没有地址的检测，就是在空房间里响的警报。

### 为什么不直接关闭 squash {#por-que-não-simplesmente-desligar-o-squash}

这是考虑的第一个出路，也是唯一有绝对保证的：`allow_squash_merge: false` 让按钮不再存在。它被**测量并拒绝**，手里有数字：`dev` 中最近的六次合并都是单父的 squash——squash **就是**这里工作 PR 的约定——而 `scripts/changelog.mjs` 用 `git log --no-merges` 生成 CHANGELOG，依赖于这一点：今天一个 squash 是一行；用 merge commit 的话，每个中间的 WIP 提交都会变成条目。关闭 squash 修好了晋升，却向每个工作 PR 征税并改动 changelog 的生成。问题出在流水线；账单却会由工作来付。

同样记录下来的还有不管用的，以免有人再去找：**merge queue** 可以用每个队列固定的方法解决，而 CLAUDE.md 明确禁止它；GitHub 在这个领域按分支的原生控制是 `required_linear_history`，它做的是**相反**的事——禁止 merge commit。不存在按分支的“要求 merge commit”。

## 决策 {#decision}

**1. 告警获得一个有接收方的作业。** `tag-release.yml` 获得 `avisar`，`if: failure()`，它打开一个 issue，点名分支、提交、运行以及修复方法——并且**在已经打开的 issue 上评论**，而不是为同一分支打开第二个，因为一波相同的 issue 是教人忽视它们最快的方式。标题是去重的键，由测试锁定（`tituloDoAlarme`）。

它用 `github.token` 认证，**绝不用 PAT**：无效的 `BRABO_BOT_TOKEN` 正是它需要报告的失败之一（`checkout` 死于 `could not read Username`），而依赖可能已坏的东西的告警，恰恰会在需要它响的时候沉默。正文通过 `--body-file` 传递，绝不插值进 `run:`——文本有反引号和 `$`，在 `bash -e` 中插值内容就是注入。

**2. 规则开始覆盖 `dev`，而且覆盖是**狭窄**的。** `dev` 一直在接收工作，并且有意用 squash，所以“一个父提交就是缺陷”在那里不成立——会让每个 PR 失败。在 `dev` 中是缺陷的，是那个**带来一条新边**的 PR：它的 head 是一个合并，其第二个父提交还不在基线中。那就是 #464，它的全部交付就是那条边。

这一区分很重要，因为存在一个几乎相同却**无害**的邻居：在合并之前把 `dev` 拉进自身的工作 PR，其 head 也是合并——但第二个父提交已经在基线中，squash 不会丢失任何东西。

**3. 识别 PR 的查询按 `merge_commit_sha`，这不是风格问题。** `gh api repos/{repo}/commits/{sha}/pulls` 返回与该提交关联的**所有** PR——而由于 `dev` 是在整个周期中保持打开的晋升 PR 的 head，`dev` 的每个提交都会与它关联。读取 `.[0].head.ref` 会对任何工作 PR 的 squash 返回 `dev`（一个永久分支），而规则会让整个仓库失败。这个错误犯过，并在上线之前被针对真实数据的验证抓到；写在这里，以免再犯。

**4. `null` 也是答案，在 `dev` 中它不会变成缺陷。** 无法知道是否有边（API 宕机、PR 被删、clone 中缺少对象），不同于知道没有边。在 `dev` 中这会通过，因为基准率是合法的工作。在 `qa`/`main` 中什么都不变：那里只进入流水线，一个父提交无论来源是否已知都是缺陷。这有意与 `promotion-check` 的原则（“无法验证算作失败”）**相反**——那里的范围只有晋升，这里不是。

## 后果 {#consequences}

**这不是预防，而这一区分正是要点。** 方法是在点击时选择的；真正的预防需要上面被拒绝的两个出路之一，或者把合并从人手中拿走——这撞上了 CLAUDE.md 中受保护分支上的合并始终手动的规则。改变的是发现的时间：从“在下一个晋升周期”变为“一分钟之后，在一个有主人的 issue 中”，那时回滚仍然轻而易举。

**预防仍然悬而未决，它是产品决定。** 不向工作征税就能解决的出路是 `promote.yml`——它已经存在，已经是 `workflow_dispatch`，并且已经把流水线的那一对作为输入——开始自己执行 `git merge --no-ff`。这保留了权威（没有人工触发就没有合并），只是把方法机械化，但需要决定人工 dispatch 是否算作 CLAUDE.md 意义上的“手动合并”，并且会为“绝不直接推送到永久分支”开第三个例外。这里没有作出这一决定。

**针对真实数据验证，而不是靠推理。** 规则针对促成它的三个提交运行过：拒绝 `bf6db00c9`（#464 的 squash），批准 `1eb71c322` 和 `108d81cc7`（正常的工作 PR）——没有误报。

**途中的发现，超出本 ADR 的范围：** `BRABO_BOT_TOKEN` 自 2026-09-03 晚上起无效或已过期，因此**任何分支上都没有 tag 被盖上**——`tag-release` 的 `checkout` 在任何逻辑之前就失败了。只有轮换这个密钥能解决，而那是 `TODO(humano)`。已记录在 CLAUDE.md 中。

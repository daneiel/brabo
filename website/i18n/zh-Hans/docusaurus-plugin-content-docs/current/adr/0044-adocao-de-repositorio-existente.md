---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0044 — 采纳现有仓库，以及作为关口的计划

## 背景 {#contexto}

第一次 dogfooding（第 10 阶段）之所以能运行，只是因为有人手动插入了数据行。P1 发现 #1，逐字引自
`docs/missions/dogfooding-mission.md:638`：

> O produto não sabe apontar um projeto para repositório existente.
> `createRepo` é incondicional; `getRepo` existe e não é chamado por
> nenhum caso de uso; o DTO não tem campo para `externalId`.

任务的流程（`:102-134`）描述了绕过方法：在 `project_repositories` 和 `repo_bootstraps` 中 `INSERT`，后者“被标记为已收敛——这样产品就不会试图恢复任何 bootstrap”。也就是说：要在一个早已存在的仓库上使用 Brabo，就必须就一次从未运行过的 bootstrap 对数据库撒谎。

已有的三样东西塑造了这个方案：

1. **dry-run 早已写好，只是没有人这样称呼它。**
   `BootstrapStep.check(ctx)`（第 2 阶段，
   [ADR 0005](0005-repo-bootstrap-idempotent-steps.md)）重新读取**远程**状态并返回仍待处理的变更。它在每次执行时被调用，这正是幂等性和恢复的来源。计划就是这同一个列表，**不**调用 `run()`。
2. **在合约中，分支保护是一个布尔值。**
   [ADR 0028](0028-protecao-de-branch-divergencia-entre-providers.md)
   刻意拒绝给 `ProtectBranchInput` 加配置（“会创造一套只有一个 provider 能兑现的词汇，另一个将不得不静默忽略”），把规范化的 `ProtectionPolicy` 留到有真实需求的时候。合约只承诺可观测的东西：`listBranches` 返回 `protected: true`。
3. **bootstrap 本来就不覆盖保护。**
   自第 2 阶段起，`bootstrap-steps.ts:112` 会跳过 `protected: true` 的分支。缺的不是守卫——而是让它将要做的事**可见并被明确批准**。

值得记录的是，ADR 0028 **并没有**说“永远不要覆盖现有保护”。这条规则诞生于此；0028 是它只能在布尔层面运作的原因。

## 决策 {#decisão}

### `origin` 作为维度，在两张表中 {#origin-como-eixo-nas-duas-tabelas}

`project_repositories.origin` 和 `repo_bootstraps.origin`（`created` |
`adopted`），由写入者显式写入——而不是由列的默认值，这样采纳在代码中就是可见的选择，而不是缺省
（[RN-046](../business-rules/custo.md#rn-046)）。迁移 `0031` 的回填刻意是盲目的：在它之前不存在采纳，因此按定义每个既有行都是由 Brabo 创建的，没有会被分错的情况——不同于 `0026` 的定向回填。

### 计划住在游标里，而不是新表 {#o-plano-mora-no-cursor-não-em-tabela-nova}

`repo_bootstraps` 增加 `plan`（jsonb）、`plan_generated_at`、
`plan_decision`、`plan_decided_at`、`plan_decided_by`。

计划是**快照**，不是日志：与 ADR 0005 已定义的游标有相同的所有者、相同的键和相同的生命周期。一张专属表会暗示可查询的旧计划历史——而历史已经住在 `session_events` 和 `proposed_actions` 中，两份叙述不需要第三份。

### 关口在 runner **之前** {#o-portão-fica-antes-do-runner}

`plan_decision` 为空是重要的状态：计划已生成，尚无决定，**什么都不运行**。执行器内部没有过滤——`BootstrapRunner` 就是第 2 阶段的那个，原样提取出来（128 行逐字节核对）以便共享，它只是不被调用。加上 `:112` 的守卫，不存在任何在已批准计划之外保护分支的代码路径
（[RN-045](../business-rules/custo.md#rn-045)）。

批准是**全有或全无**：选择性批准会破坏级联
`dev←main, qa←dev, rc←qa`（批准 `qa` 而不批准 `dev` 无法满足），并需要重写 runner。运行的是执行时由 `check()` **重新推导**的计划——等于或小于所展示的那个。

**实现过程中的更正：** 第一个版本承诺的比它会执行的**更少**。`protect_branches.check()` 读取的是此刻的状态，而一个由计划本身将要创建的分支（第 10 阶段 fork 中的 `rc`）还不存在，无法被列为未保护——但在执行时它会存在，并会被保护。计划增加了一遍处理，用来推算计划中分支的保护。承诺得多是可以接受的（runner 会跳过已受保护的）；承诺得少恰恰会在最常见的采纳场景中使规则失效。

### “按原样采纳”不篡改游标 {#adotar-como-está-não-adultera-o-cursor}

免除 bootstrap 会记录 `plan_decision = 'as_is'` 和一个事件——并让游标保持原位。把游标移到“最后一步，done”就等于把第 10 阶段的手动 seed 变成官方行为：游标会说六个步骤运行过，而一个都没有。让项目可运作的是被记录的决定，`deriveProvisioningStatus` 尊重它。计划作为刻意未被应用之内容的证据保留下来。

由此也产生了新状态 `awaiting_plan_decision`：没有它，一个被采纳的项目将永远处于 `provisioning`，UI 对一项不存在的工作进行轮询。

### 独立的路由，而不是 DTO 中的 `mode` {#rota-separada-não-mode-no-dto}

`POST .../repository/adopt`，而不是一个可辨识的 DTO：
`@RequireRole` 和 OpenAPI 是按路由的，`route-surface.spec.ts` 按路由分类，而且响应确实不同（创建返回 bootstrap 的游标；采纳返回计划）。带 `@ValidateIf` 的 DTO 会在生成的文档中产生弱 schema——这正是那个 spec 存在所要捕获的。

### 为什么**不**经过 `decide()`/`ProposeActionUseCase` {#por-que-não-passa-pelo-decideproposeactionusecase}

通用的审批流水线是**按变更**决定的。这里的决定是**按计划**的：用户批准一个连贯的集合，而不是逐一批准十四个动作。此外，自第 2 阶段起 bootstrap 以 `auto_approved` 诞生并在专用会话中叙述，在 `decide()` 之外——而每个被批准的变更在 runner 运行时仍会变成 `proposed_action`，因此可追溯性没有换地方。

## 后果 {#consequências}

- `getRepo` 从孤儿变成有用之物：它自第 2 阶段起就存在，由合约测试套件覆盖，却从未被任何用例调用过。
- provider 的错误（404 vs 403）早已区分到达；缺的是**消息说明该怎么做**，而两种情况恰好相反——核对标识符 vs 更换凭据。把两者合并为一个“采纳失败”会是 [ADR 0020](0020-destravar-gates-qa-secops.md) 禁止重复的排除法诊断。
- **GitProvider 的合约测试套件保持不动**，合约中没有加入任何新方法。这是明确的验收标准，也正是它让 provider 之间的分歧留在 ADR 0028 留下它的地方。
- **顺手堵上的漏洞：** 在已采纳的项目上，`ProvisionRepositoryUseCase.execute` 会落入“两者都已存在”的分支，并在没有计划的情况下对第三方仓库运行 bootstrap。现在它以 409 拒绝。
- 向导在一切之前增加一步，而采纳会**跳过**分支策略这一步：为一个已有自己策略的仓库承诺模板就是撒谎。除了计划界面之外，没有新的 UI 组件。
- 计划界面自己渲染 `BootstrapSteps`，而不是导航到 `ProvisioningPage`——后者在挂载时触发 `provisionRepository`，那会**创建**一个仓库。

## 留待以后的 {#o-que-fica-para-depois}

- **规范化的 `ProtectionPolicy`**（被 ADR 0028 推迟）。在它存在之前，保护**配置**的分歧是不可见的：部分保护的分支算作未保护，可能被覆盖——在已批准的计划内。这是 dogfooding 的 P1 发现 #2，**未在此修正**。
- **第 6 阶段策略不使用的 `rc`**（发现 #3，P2）：模板继续创建并保护 `rc`。不在 12a 的范围内。
- **针对真实 fork 的验收**：`adopt-repository.smoke.spec.ts`
  存在，它是**只读**的，并由 `ADOPT_TEST_REPO` +
  `GITHUB_TEST_TOKEN` 控制运行。它从不批准——批准会改动一个真实仓库，那个决定是人的关口，不是测试。“之后项目可运作”仍是手动检查清单。
- **dogfooding 的收获报告并不存在。**
  `docs/explanation/primeiro-dogfooding.md` 被 CLAUDE.md 引用却从未写过；存在的是骨架
  `docs/missions/colheita-esqueleto.md`。这里引用的来源是
  `docs/missions/dogfooding-mission.md`。第 10 阶段的 ADR 也仍然开放。
- **采纳不迁移任何数据**（issue、历史 PR）——它只关乎访问和策略（CLAUDE.md，第 12 阶段）。

引用 [ADR 0005](0005-repo-bootstrap-idempotent-steps.md)，变成 dry-run 的 `check()` 来自那里；以及
[ADR 0028](0028-protecao-de-branch-divergencia-entre-providers.md)，它界定了为什么这里的“分歧保护”只能是布尔的。

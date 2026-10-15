---
traducao_de: 23e727d97992c1974a3df731360a293b67fd669c
---

# ADR 0054 — gate 作为声明式登记

## 状态 {#status}

已提议

## 背景 {#contexto}

流程中的 gate（QA、SecOps、故事的手动晋升、接管计划、手动合并、proposed_action 管道）存在并已通过真实执行验证（ADR 0020、0044–0046），但它们是**隐式**的：散布在 agent 的 prompt、engine 的代码、api 的纯规则和 CLAUDE.md 的约定之间。

Fase 10/13 的教训——指标由脚本提取，绝不靠标注——无法应用于一个不可枚举的 gate。

[ADR 0048](0048-decisao-no-log-e-a-ordem-do-gate.md) 解决了这个问题下面的那一半：它把动作的决定放进事件日志，带着真实的参与者，并让 `proposed_action.created` 携带 `status`——正是它区分了“用户点击了”与“策略自行决定了”。没有它，衡量 gate 的通过就是在计数不存在的事件。本 ADR 是上面的那一半：说明存在**哪些** gate，让 0048 变得可观察的东西也变得可枚举。

## 决策 {#decisão}

在 `docs/gates.yml` 中的声明式登记，版本化，带 schema：`id`、流程、所有者（agent/领域/用户）、输入、交付物、`verificacao`（script | humana）、`severidade`（block | warn）、`aprovacao_humana`、`status`（active | planned）。

规则：

- 没有验证脚本的 gate 以 `warn` 诞生；晋升为 `block` 要求脚本存在并已测量过通过（与文档的分阶段推出同样的理念）。
- 在章程声明为手动的 gate 中（受保护分支上的合并、手动模式下的故事晋升、接管计划、动作的决定），`aprovacao_humana: true` 不能通过产品配置改变——由测试保证，正如手动合并已经是这样。
- `status: planned` 声明未来角色的 gate 而不激活它。

### `evidencia`：证明存放在哪里 {#evidencia-onde-mora-a-prova}

原始规格没有预料到、而第一次阅读代码就使之成为必需的字段：**并非每个 gate 都能在事件日志中有证明**。

- `merge-protegida` 不发出自己的事件。它是最后应用在已计算出的裁决之上的上限（`decide.ts`），把 `auto_approve` 降为 `require_approval`；结局表现为一个待处理的 `proposed_action.created`，与任何其他待处理项无法区分。保证这一锁定的是**测试**。
- `backmerge` 完全存在于应用之外：它是 PR 的必需检查，状态版本化在 `main` 上的 `.release/gate.json` 中。

没有这个字段，“没有日志证据的 `active` + `block` gate 失败”这条规则会让这两者永远是红色——而它们是产品最硬的锁。于是每个 gate 声明 `evidencia: event_log | teste | ci`，并附带定位符（事件类型和 payload 过滤器、spec 路径或工作流）。脚本只对声明了事件日志的 gate 追讨事件日志；对 `teste` 和 `ci`，它确认目标存在。

替代方案——把两者降为 `warn`——被拒绝，因为它对真实的严重级别说谎，而这正是登记存在要终结的东西。

### 仓库的 gate 一起进入 {#os-gates-do-repositório-entram-junto}

`backmerge`、`pr-no-lugar-certo`、`aprovacoes-da-escada` 和 `promocao-conferida`（ADR 0030）按与其他 gate 相同的标准是 gate：它们有所有者、输入、交付物、机械验证和严重级别。而且它们是日常中最常让 PR 失败的。只包括 `backmerge` 会是武断的——它们是同一家族（纯脚本 + 工作流 + spec）。

`aprovacoes-da-escada` 是唯一带 `aprovacao_humana: true` 的 CI gate：它衡量的是人按角色进行审批。一个 gate 登记恰恰漏掉计数人类签名的 gate，会漏掉最明显的那个。

界限：登记是**索引**，不是政策。决定分支的仍然是 `docs/explanation/branching-policy.md`；`entrada` 和 `entregavel` 是一句话，`onde` 指向脚本。YAML 绝不复述规则——如果复述了，它就会变成它存在要避免的第二个事实来源。

### 过滤器与类型同样重要 {#o-filtro-importa-tanto-quanto-o-tipo}

`qa-verificada` 和 `secops-segura` **不是两种事件类型**：两者都写入 `pr.gate_changed`，由 `payload.gate` 区分。而同一类型在 gate **打开**时也会写入，不带 `veredito`。只保存类型名的登记会把打开算作通过，测出的是实际发生的两倍。因此 `evidencia` 携带 payload 过滤器，而不只是类型。

出于同样的原因，对 infra PR 的判断是**两个** gate（`infra-qa-verificada` 和 `infra-secops-segura`）：`infra.gate_changed` 也按 `payload.gate` 区分，把它们合在一起会把其中一个的通过报告成另一个的。测试断言登记中没有任何一对（`event_types` + `filtro`）重复——正是这种唯一性让测量有意义。

## 考虑过的替代方案 {#alternativas-consideradas}

- **保持在 prompt 中隐式：** 否决——不可测量。
- **用数据库中的表代替 YAML：** 暂时否决——gate 随经过评审的 PR 而变化，而不是在运行时；沿用 `.docmap.yml` 和版本化 ruleset 的先例（ADR 0030）。以 loader 为边界，迁移到数据库会很容易。

## 后果 {#consequências}

- approval-ladder 的社区模式（backlog）变成 `aprovacao_humana` 中值的改变，而不是重写 agent。
- Dev Lead（ADR 0053）和 Platform/SRE 获得输入契约：当它们被实现时，它们的 gate 已经被规定为 `planned`。
- 登记诞生时就知道原始列表遗忘的 gate——QA/SecOps 对 **infra** PR 的判断，它有自己的路径（`infra.gate_changed`），因为背后没有 backlog 任务。枚举找到了在统计之外的东西：这是登记的第一份红利，甚至在它测量任何东西之前。
- 它也找到了缺口：`promocao-conferida` 是**没有自己 spec** 的必需检查，与 `pr-police` 和 `approval-ladder` 不同。它的证据指向脚本而不是测试，缺口就写在那里。它作为一项进入 13c 的分类，不在此修正——本阶段只声明和测量，不修理。

## 参考 {#referências}

- [ADR 0048](0048-decisao-no-log-e-a-ordem-do-gate.md)——事件日志中的决定，没有它就没有可测量的东西
- [ADR 0020](0020-destravar-gates-qa-secops.md)——通过真实执行验证的 gate
- [ADR 0030](0030-politica-de-branches-mecanizada.md)——版本化的 ruleset，文件中配置的先例
- `docs/gates.yml`——登记本身

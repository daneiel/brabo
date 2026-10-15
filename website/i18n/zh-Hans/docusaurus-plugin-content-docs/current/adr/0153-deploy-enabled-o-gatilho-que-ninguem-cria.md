---
traducao_de: f56f3ba781c30b1696dcf68fb872242008c3a4a8
---

# 0153 — `DEPLOY_ENABLED`：十份文档引用、却无人创建的触发器

## 状态 {#status}

**Proposed.** 等待产品负责人对阶段 B（见下文）的决定，那不是工程选择。本文档本身不改变任何角色或 gate 的 `status`。

## Context {#context}

`DEPLOY_ENABLED` 是平台层所缺的一切的声明触发器。它被**十份文档**引用：

- [ADR 0091](0091-secops-runtime-relatorio-de-abuso.md) 和
  [ADR 0092](0092-platform-relatorio-de-telemetria-sob-demanda.md)，就在状态字段中——*"its activation stays synchronized with `DEPLOY_ENABLED`,
  which doesn't exist"*；
- [ADR 0089](0089-analytics-e-delivery-metricas-como-relatorio.md)；
- `docs/fluxo.yml`，在三个地方——`platform.ativacao`（“sincronizada com
  DEPLOY_ENABLED”）、`area-infra.gate_saida`（`deployavel`，`status: planned`，带注释 `# DEPLOY_ENABLED`）以及 `secops-runtime` 的**两个**缺口交付物（`resposta-a-incidente` 和 `postmortem-de-seguranca`，都带有 `motivo: exige tráfego de produção real (pós DEPLOY_ENABLED + platform
  ativo)`）；
- `docs/gates.yml`，在 gate `operavel` 中（`backlog: deploy (DEPLOY_ENABLED +
  Environments)`）；
- 以及 `business-rules.md`、`backlog.md`、`modelo-de-time.md`、
  `auditoria-fluxo-vs-codigo.md`、`historico-de-fases.md` 和 `CLAUDE.md`。

**在代码中它出现两次，都是注释**——
`apps/api/src/domain/actions/external-effect.ts:144`（"Estes não têm ação
tipada ainda (DEPLOY_ENABLED está no backlog)"）和
`apps/engine/lib/engine/harness/tools/listar_metricas_de_produto.ex:185`。
在 `apps/`、`docker/`、`deploy/`、`scripts/`、`.env.example` 或 `Makefile` 中没有任何定义，没有任何读取。

十份文档指向一个没有墙的开关。

### 卡在这上面的东西 {#o-que-fica-preso-nisso}

| 被卡住的 | 位置 | 后果 |
|---|---|---|
| `platform` | `fluxo.yml`，`status: planned` | 反馈回路的所有者不存在；SLO、仪表盘、runbook 和 postmortem 没有作者 |
| gate `operavel` | `gates.yml:312-321`，`status: planned` | 已声明，从未被评估 |
| gate `deployavel` | `fluxo.yml:247` | **不在注册表中**——见下面的发现 |
| `resposta-a-incidente` 和 `postmortem-de-seguranca` | `fluxo.yml:223-226` | `secops-runtime`（它是 `status: active`）的两个缺口交付物 |

### 一个与部署无关的发现 {#um-achado-que-não-é-sobre-deploy}

**gate `deployavel` 在 `docs/fluxo.yml:247` 中被声明为 `area-infra` 的 `gate_saida`，却不存在于 `docs/gates.yml` 中。**
[ADR 0054](0054-gates-como-registro-declarativo.md) 把注册表定义为声明现有 gate 的地方；一个被团队模型的一部分点名、却在另一部分缺席的 gate，正是 `agent-areas.ts`、`gates.yml` 和 `fluxo.yml` 之间的交叉测试会抓到的那种不一致——而这个测试是 `CLAUDE.md` 中声明的 backlog，今天并不存在。

这一点**无需**对部署做任何决定就能修复，也是本文档中唯一不依赖于有人购买服务器的部分。

### 决定次序的张力 {#a-tensão-que-ordena-a-decisão}

在没有带真实流量的生产环境的情况下开启 flag，**并不**会激活这些角色：它会造出空通过的 gate。一个因为没有可拒绝的东西而批准的 gate，比一个声明为 `planned` 的 gate 更糟，因为它会教读者以为回路已经闭合。这与 ADR 0091 和 0092 拒绝创建 agent、转而交付按需脚本的理由相同——那次拒绝依然正确。

## Decision {#decision}

两个阶段，在属于工程的与不属于工程的之间有一条硬边界。

### 阶段 A——今天可以决定的，刻意地少 {#etapa-a--o-que-é-decidível-hoje-e-é-pouco-de-propósito}

> **本次交付已经应用的：** 只有第 1 项。它修复的是**注册表**的一个漏洞，不依赖关于部署的决定——这是本文档中即使阶段 B 永远不发生也有价值的唯一部分。第 2 和第 3 项描述接受所意味着的东西；第 3 项（十份文档的文字）没有被应用，因为在决定之前改写措辞就等于断言一个尚未做出的选择。

1. **`deployavel` 进入 `docs/gates.yml`**，带 `status: planned`、`dono:
   area-infra`、`severidade: warn` 和 `aprovacao_humana: false`，完全按照 `operavel`（`gates.yml:312-321`）的模子。关闭注册表的漏洞。用 `warn` 而不是 `block`，因为注册表的规则（RN-070/RN-071）要求有 `verificacao: script` 才能提升，而没有脚本。
2. **两个提前交付的脚本不变。**
   `apps/api/scripts/relatorio-telemetria.ts` 和
   `apps/api/scripts/relatorio-seguranca-runtime.ts` 已经是 `active`，已经按需运行，已经交付了 ADR 0091/0092 承诺的东西。
3. **文字不再把 `DEPLOY_ENABLED` 当作变量。** 今天读到“与 `DEPLOY_ENABLED` 同步”的地方，改为点名这个表述一直以来所指的**里程碑**，并带有客观标准：*存在一个被运营的目标环境，接收真实流量，其交付流水线有人维护。*

### 阶段 B——被操作员阻塞，而不是被代码阻塞 {#etapa-b--bloqueada-por-operador-não-por-código}

一个带流量的生产环境。只有在那之后，`platform` 才离开 `planned`，`operavel` 和 `deployavel` 不再是 `planned`，`secops-runtime` 的两个缺口交付物才成为可能。

基础设施**已经就绪，不是瓶颈**：带有 `local`/`staging`/`prod` overlay 的 `deploy/k8s/`、自 [ADR 0119](0119-imagens-publicadas-no-ghcr-por-digest.md) 起按 digest 发布到 GHCR 的四个镜像、`make imagens-do-release`、`bootstrap.sh`、`smoke.sh`、`rollout-test.sh` 和 `test-restore.sh`。缺的是有人**运行并维护**——而这些都不会自己部署。

### 考虑过并被拒绝的备选方案 {#a-alternativa-considerada-e-recusada}

**现在就创建 `DEPLOY_ENABLED`，作为默认 `false` 的环境变量。** 这是第一版设计，而它得不偿失：一个没有任何代码读取的变量，正是本 ADR 存在所要揭露的空洞承诺，只是现在多了一行配置来支撑它。仓库已经有解决这一问题的规则——*capability 只在被测试套件证明时才声明；没有证明，就声明 `false` 并降级*（ADR 0041/0042）。flag 在拥有**第一个真实消费者**的 PR 中诞生，而那个 PR 就是阶段 B 的。

名字 `DEPLOY_ENABLED` 被保留：十份文档已经在用它，现在给这个里程碑改名只会把债务换个地方。

## 本 ADR 明确拒绝的 {#o-que-este-adr-recusa-explicitamente}

- **在 engine 中创建 `platform` 或 `secops-runtime` agent。** 那将是对一个不会闭合的回路凭空发明权威——ADR 0091/0092 的拒绝，因为问题会再次出现而在此重复。
- **在没有验证脚本的情况下把 `operavel` 或 `deployavel` 提升为 `block`**（RN-070/RN-071）。
- **把只取决于环境的东西标记为“永远不测量”**：MTTR 和变更失败率继续被声明为带理由的缺口，而不是不可能。

## Consequences {#consequences}

- gate 注册表开始包含团队模型所点名的所有 gate——`deployavel` 不再只存在于一侧。
- 运行时没有任何变化。没有新变量，没有被修改的默认值，没有任何以前不被评估的 gate 被评估。
- 平台层仍然停滞，**而现在它诚实地说出原因**：缺的不是一个 flag，而是一个环境。读 `fluxo.yml` 的人不再去代码里寻找一个从未存在过的变量。
- 记录在案的是，“已声明”与“存在”之间的距离已经付出过一次代价：十份文档彼此就一个机制达成了一致，而这种一致之所以存活，是因为没有任何东西把它们与代码交叉核对。团队模型三部分之间的交叉测试仍在 backlog 中，这是它本可以抓到的第二个发现。

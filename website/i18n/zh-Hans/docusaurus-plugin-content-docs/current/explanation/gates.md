---
sidebar_position: 7
traducao_de: 929963d24eb727bd64875486f2f1889172f3084a
---

# gates，以及如何测量它们

**gate** 是流程中的一个点，工作在那里停下，直到有人——人、智能体或脚本——说它可以继续。产品有十三个，而直到
FASE 15a，它们都不以列表的形式存在：散落在纯规则、用例、测试和 CI workflow 中。回答"有哪些 gate"需要阅读六个
文件。

`docs/gates.yml` 就是这个列表。本文档解释它是什么——更重要的是——它**不是**什么。

## 登记描述；它不执行 {#the-registry-describes-it-doesnt-execute}

没有任何 gate 因为这个文件而开始被强制执行。在其中改 `severidade` 不改变任何行为：阻止合并的仍是 `decide.ts`，
评判 PR 的仍是 QA 智能体，拒绝 backmerge 的仍是 CI workflow。

这是最容易弄错的假设，所以值得重复：**登记是索引，不是策略。** 分支策略仍然住在
[branching-policy.md](branching-policy.md) 中；`entrada` 和 `entregavel` 字段是一句葡萄牙语，而 `onde` 指向真正
起支配作用的代码。

登记买来的是另一样东西：让 gates **可枚举**。Fase 10 和 13 的教训——指标由脚本提取，绝不手工记录——不适用于无法
列出的东西。

## 如果不加定义就会变老的两个字段 {#the-two-fields-that-age-if-left-undefined}

**`verificacao`** 回答*如何证明这个 gate 通过了*，而不是谁评判它。`script` 意味着有一个机械的工件——一个事件、
一个测试、一个 job——作为证明。这就是为什么即使由 LLM 发出裁决，`qa-verificada` 也是 `script`：工件是带 `veredito`
的 `pr.gate_changed`。谁评判住在 `dono` 中。

**`aprovacao_humana: true`** 意味着决定属于用户——直接通过一次点击，**或者**通过用户自己写下的策略委派。这就是
让 `acao-aprovada` 能与 `status: auto_approved` 共存的原因：策略自行决定，就是用户事先已经决定了。
`merge-protegida` 是连委派都不存在的情况，因为即使开启了自治，上限也会把 `auto_approve` 降级为 `require_approval`。

在宪章声明为手动的四个 gate 中，这个字段是不变的，并由测试锁定（[RN-071](../business-rules/custo.md#rn-071)）。

## 三种证据形式，因为并非每个证明都住在日志中 {#three-forms-of-evidence-because-not-every-proof-lives-in-the-log}

| 类型 | 何时 | 定位器带什么 |
|---|---|---|
| `event_log` | 结果变成领域事件 | 事件类型 + 载荷过滤器 |
| `teste` | 保证是一个断言 | spec 的路径 |
| `ci` | gate 住在仓库中 | workflow + spec |

迫使这个字段存在的两种情况：

- **`merge-protegida`** 不发出自己的事件。它是最后施加在已计算裁决之上的一个上限，把 `auto_approve` 降级为
  `require_approval`；结果表现为一个待处理的 `proposed_action.created`，与任何其他待处理项无法区分。保证阻止的是
  测试。
- **`backmerge`** 住在应用之外：它是一个必需检查，状态版本化在 `main` 上的 `.release/gate.json` 中。

没有 `evidencia`，"没有证明的 `block` gate 会失败"这条规则会让产品最硬的两道锁永远是红的。

## 两层验证，只有一层在生产中运行 {#two-validations-and-only-one-of-them-runs-in-production}

登记在两层中被验证，而这种划分不是装饰性的：

| 层 | 断言什么 | 谁运行它 |
|---|---|---|
| `validarRegistro` | 关于**内容**的断言——`block` 要求 `script`，四个人工 gate 保持人工，`active` 要求证据，没有重复 id，没有孤立的 `entrada` | 读取登记的任何人，包括运行时的 api |
| `validarLocalizadores` | `teste`/`ci` 的**目标文件****存在** | 针对真实文件的测试以及 `validacao-gates.ts` 的第 2 阶段——从不是 api |

第一层在登记被读取的任何地方都有效。第二层是关于**仓库**的断言，只在检出目录内才有意义。

两者曾经是一个函数，而 api 的加载器调用它。后果在安装的 v6.1.0 上测得：`GET /gates` 以 `500` 回应，
`RegistroDeGatesInvalido` 把十一个目标都列为 "não existe"——大约 55 分钟内十二个 5xx 响应。登记本身没有任何问题。
生产镜像只带 `/app/docs/gates.yml`，`docs/` 中别无其他；`apps/api/test/`、`scripts/ci/` 和 `.github/` 从不进入其中，
因此对这棵树评估一个关于仓库的断言，会在每个安装中让每个 gate 失败。

什么都没有被放宽。规则仍然存在，仍然覆盖同样的目标，消失的目标仍然会失败——它只是在问题有意义的地方运行。两个
守卫维持这一点：一个上溯到仓库根目录并核对每个定位器的测试，以及一个在磁盘上重建镜像树（一个只有
`docs/gates.yml` 而别无其他的根）并断言登记能加载的加载器测试。把检查交还给加载器，会让第二个测试变红，并带着
安装产生的确切消息。

而 api 提供登记现在会针对生产镜像演练：`docker/smoke.sh` 调用 `GET /gates` 和 `GET /internal/gates`（服务
token），并要求两者都返回登记。正文的检查是一个 shell 函数 `checar_registro_de_gates`，由
`scripts/ci/smoke-gates.spec.ts` 在不启动栈的情况下针对三个正文运行。没有任何单元测试套件能抓到最初的失败——
vitest 和 ExUnit 从检出目录运行，在那里目标是存在的。

## 共享类型的陷阱 {#the-shared-type-trap}

`qa-verificada` 和 `secops-segura` **不是两种事件类型**：两者都写入 `pr.gate_changed`，以 `payload.gate` 区分。
更糟的是——当 gate **打开**时也写入同一类型，不带 `veredito`。

只保存类型名称的登记会把打开算作通过，测得的会是实际发生的两倍。因此需要过滤器，因此需要哨兵
`veredito: presente`。共享 `infra.gate_changed` 的两个 infra PR gate 也是如此。

测试断言登记中**没有任何一对**（`event_types` + `filtro`）重复。正是这种唯一性让测量有意义。

过滤器只能触及**载荷**，这是有意的：在 YAML 中接受任意列会开放整个查询。谁晋升了一个用户故事——一个人或 PO——
住在 `actor_kind` 列中，不在声明式词汇之内。

## 测量 {#measuring}

```bash
pnpm --filter api validacao:gates                    # full report
pnpm --filter api validacao:gates -- --sem-banco     # registry and locators only
pnpm --filter api validacao:gates -- --projeto <uuid>
```

三个阶段，按此顺序：**登记**（加载并验证）、**定位器**（`teste`/`ci` 的目标存在吗？）和 **event log**（最后一次
通过，带事件 id）。前两个从不触碰数据库——这正是让脚本在没有 Postgres 的 CI 中有用的原因。

第 2 阶段报告登记的**每个**定位器，而不只是 `active`+`block` 的 gate 的那些。它曾有一个自己的、更窄的循环，而 api
的加载器有一个更宽的，`rag-acertivo`——`active`、`warn`，引用一个 workflow 和一个测试——从未出现在表中。现在是一条
规则 `validarLocalizadores`，与测试共享。

| 退出码 | 何时 |
|---|---|
| `0` | 登记有效且定位器就位 |
| `1` | 不变量被违反、目标缺失，或**传了 `--projeto` 时** gate 没有通过 |
| `2` | 用法无效 |

不对称是有意的。登记和定位器是关于**仓库**的断言：总是有效。event log 的证据是关于一次**执行**的断言，只有在执行
发生过时才存在——没有 `--projeto` 时，第 3 阶段只是一份报告。在一个刚创建的数据库上要求通过会让脚本总是以 `1` 退出，
而总是失败的脚本会变成没人读的噪音。

## 枚举已经带来的回报 {#what-enumerating-already-paid-off}

在测量任何东西之前，写下列表就发现了两件没人看到的事：

- QA 和 SecOps 对 **infra** PR 的评判，它有自己的路径（`infra.gate_changed`，背后没有 backlog task），而不在 spec 中；
- `promotion-check` 是一个**没有自己 spec** 的必需检查，与 `pr-police` 和 `approval-ladder` 不同。证据指向脚本，缺口
  就写在那里，该条目进入了分类——阶段只声明和测量，不修正。**分类关闭了它：**`scripts/ci/promotion-check.spec.ts`
  存在了，gate 的证据现在指向它。这就是周期按设计运转——枚举发现，分类排定优先级，另一个阶段修正。

第三个发现来自测量器的第一次执行：`story-promovida` 的过滤器指向 `actor_kind`，它是**列**而不是载荷，而这个 gate 在
一个几小时前已经通过的数据库中显示为"从未通过"。没人运行的登记是会撒谎的登记。

## 激活一个 `planned` gate 与其他任何工作一样 {#activating-a-planned-gate-is-the-same-work-as-any-other}

`implementavel`（所有者 `dev-lead`）在 FASE 14d 以 `planned` 诞生，与 `docs/gates.yml`/`docs/fluxo.yml` 已经描述却
背后没有代码的目标组织架构的其余部分一起。[ADR 0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md) 激活了
它——而这个练习可作为示例，因为**登记的形式什么都没变**：`status: planned → active` 加上 `evidencia` 块（指向按
`actionType:
assess_implementability` 过滤的 `proposed_action.created`）是一个 `warn` gate 不再是愿望所需获得的**仅有**两行。
`severidade` 仍是 `warn`——文件中的注释已经写着 "nasce warn mesmo quando ativado"，激活与升级为 `block` 不是同一个
决定（那需要先测量真实的通过，与 FASE 15a 相同的纪律）。

真正的工作在文件之外：Dev Lead 需要一个新工具（`assess_implementability`），它把评估作为 `proposed_action` 提出；而
QA 策略——直到那时还是 `docs/fluxo.yml` 中一个 `proposto` 的角色，分离标准已经写在那里（"pode ser o próprio qa-lead
num segundo momento"）——需要存在，以便用一个真实的测试计划为评估提供输入。登记只是开始描述代码现在做的事。

这个入口没有在真实使用中幸存。[ADR 0192](../adr/0192-plano-de-teste-depois-da-entrega.md)
（[RN-674](../business-rules.md#rn-674)）把测试计划移到了 dev 交付**之后**——在 dev **之前**写的话，它没有代码可读并
耗尽了迭代——gate 的 `entrada` 从 `plano-de-teste` 改为 `module_map`：Dev Lead 评判用户故事和它已有的模块映射。计划
现在为 `qa-verificada` 提供输入，作为该 gate 已经给出的唯一裁决的输入。同一个教训的反方向：登记的那一行改变，是因为
**谁把什么交给谁**改变了，而不是为了让一个 gate 通过。

## 登记可能朝错误的方向变老——过时，而不是未激活 {#a-registry-can-age-in-the-wrong-direction--stale-not-inactive}

`implementavel` 是需要新代码才能离开 `planned` 的 gate 的例子。`paralelismo-autorizado` 正好相反：机制
（`RequestParallelizationUseCase`，[RN-083](../business-rules/custo.md#rn-083)）自 FASE 14d 起就在生产中——落后的是
登记，对在兄弟文件 `docs/fluxo.yml` 和代码中已经是 `active` 的东西声明 `planned`。fluxo.yml × 代码审计（发现 A1/B5，
[auditoria-fluxo-vs-codigo.md](auditoria-fluxo-vs-codigo.md)）发现了这个分歧；修正就是 `implementavel` 也获得的同样两行
——`status: active` 加上指向按 `actionType:
parallelize` 过滤的 `proposed_action.created` 的 `evidencia`。

值得注意的是，为什么这没有改变团队面板中的 PR 轨道：`paralelismo-autorizado` 是 `fluxo: execucao`，而界面只从
`fluxo: pr` 的 gate 派生步骤（见下面的"消费"）——如果一个 gate 的流程是另一种，它可以在登记中变成 `active` 而不出现在
界面的任何地方。

## gate 可以直接以 `active` 诞生——当机制和登记一起到来时 {#a-gate-can-be-born-active-directly--when-the-mechanism-and-the-registry-arrive-together}

`implementavel` 和 `paralelismo-autorizado` 是两个已经存在（声明为 `planned` 或过时）而**之后**才在登记中获得条目的
gate 的例子。`necessidade-validada`（[RN-406](../business-rules.md#rn-406)，[ADR 0095](../adr/0095-gate-necessidade-validada.md)）
是第三种模式：机制和登记在**同一次**改动中诞生，因为这个 gate 本身在任何地方都不存在——文件中没有 `planned`，背后也没有
代码。

选择 `severidade: warn` 遵循与 `implementavel` 相同的推理，但出于另一个原因。`implementavel` 是 `warn`，因为升级为
`block` 需要先测量真实的通过（FASE 15a）。`necessidade-validada` 是 `warn`，因为今天产品中**没有任何东西**在让 PO 继续
之前核对它的通过——Criativo→PO 的 handoff 已经在 `confirm_readiness` 内部发生，甚至在这个 gate 存在之前。`block` 会
承诺一道不存在的锁；`warn` 准确描述了这个 gate 是什么：一个人类验证了需求价值的测量，而不是一个阻止下一步的 gate。

`workspace-verificado`（[RN-423](../business-rules.md#rn-423)，
[ADR 0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)）是第四个例子，也是四个中最清楚
地说明 `warn` 不是"弱锁"的：在**这里**真正上锁的不是 gate，而是
`Engine.Actions.TerminalExecutor.decisao_de_execucao/1` 中的显式拒绝——没有已验证的 workspace 或已连接的 runner，命令
就被无条件拒绝，在代码深处，不经过登记。gate 的存在只是为了提供确认何时发生的**证据**（event log 中的
`project.workspace_verified`）；把它升级为 `block` 会描述一道已经存在于别处的锁，就像 `necessidade-validada` 会对一道
在任何地方都不存在的锁撒谎一样。

`rag-acertivo`（[RN-490](../business-rules.md#rn-490)/[RN-498](../business-rules.md#rn-498)，
[ADR 0132](../adr/0132-golden-set-de-acerto-do-rag.md)/[ADR 0138](../adr/0138-golden-set-do-rag-em-ci-agendado.md)）是第五个
例子，它保持 `warn` 的理由改变过一次形式，值得完整讲述。它以五个中最简单的理由诞生为 `warn`：没有运行真实 LLM 的 CI——
它测量的 golden-set（17 个由真实 RN/ADR 组成的问题，由真实的 `HybridSearchUseCase` 针对一个精选的真实语料库核对）只能
手工运行（`mix golden_set.rag`），与 QA Automation 的 golden-set（[ADR 0123](../adr/0123-golden-set-regressao-qa-automacao.md)）
至今仍持有的姿态相同。这已不再成立：`.github/workflows/golden-set-rag.yml` 现在真正运行 `mix golden_set.rag`，针对一个真实
的 Ollama 服务——它只调用 **embedding** 模型，在 CPU 上，确定性的，从不调用做判断的聊天模型。（QA golden-set *不能*以同样
方式处理的说法后来被测量了，时钟并没有成为障碍——见下一节。）阻止 `severidade: warn` 过时的不是 gate 保持手动——而是
workflow 是**定时的**（夜间 cron 加 `workflow_dispatch`），从不由 `pull_request` 触发。`block` 仍会承诺一个能拦住合并的
检查，而定时执行拦不住任何东西：回退会在一天之内可见，从不是在 PR 的时刻。理由从"没有 CI 能运行这个"变成了"这个 CI 不在
合并的路径上"——`warn` 仍然准确描述真实情况，只是不是之前的那个真实情况。

## CI 中的 QA golden-set：时钟够用，工具能测，每周运行 {#the-qa-golden-set-in-ci-the-clock-fits-the-instrument-measures-and-it-runs-weekly}

QA Automation 智能体语义判断的 golden-set（[ADR 0123](../adr/0123-golden-set-regressao-qa-automacao.md)）是能给
`qa-verificada` 的语义步骤一个趋势信号的东西。ADR 0123 和 [ADR 0138](../adr/0138-golden-set-do-rag-em-ci-agendado.md) 在没有
测量的情况下断言，在 CI 中运行它需要 API LLM 的密钥或新的基础设施（带 GPU 的 runner）。在 2026-09-13（AT-067），这一点被
测量了，完全按 `golden-set-rag.yml` 的模式：`ubuntu-latest`，没有 GPU，同样固定的 `pgvector` 和 `ollama` 服务镜像，
`qwen2.5-coder:latest` 下载到 job 自己的 Ollama 中（带 dev compose 的 `OLLAMA_KEEP_ALIVE=1h`/`OLLAMA_CONTEXT_LENGTH=16384`），
api **和 engine** 作为服务器运行——engine 是相对 RAG job 多出来的，因为正是 engine（由 api 通过
`POST /internal/actions/execute` 调用）运行 QA 请求的 `npm test`。

| 执行 | 模型拉取 | 到 mix task 的准备 | `mix golden_set.qa` | 整个 job | 得分 |
|---|---|---|---|---|---|
| [34769447405](https://github.com/daneiel/brabo/actions/runs/34769447405) | 15 s | ~3 min | 19 min 15 s | 22 min 09 s | 0/6 |
| [34770869429](https://github.com/daneiel/brabo/actions/runs/34770869429) | 13 s | ~3 min | 22 min 53 s | 25 min 45 s | 0/6 |

7B 模型在这个 runner 的 CPU 上的一个聊天轮次中位数约 20 s（api 日志保存的 23 个轮次中为 10–34 s）。**时钟够用**：一个
不到半小时的夜间或每周 job，无需密钥，无需 GPU。旧说法中"新基础设施"那一半被测量驳倒了。

**不够用的是工具。** 两次执行都是 0/6，低于记录的下限 1/6——而且不是因为模型的判断。第二次执行的 event log 显示了原因：
QA 提出的每个 `npm test` 都被自动批准（`permissions.json allow:
npm test`），然后**被 engine 拒绝**，因为自 [RN-502](../business-rules.md#rn-502)
（[ADR 0143](../adr/0143-agentes-de-dev-so-depois-do-container.md)，2026-09-04）起，没有 `running` 容器的 `container`
项目在任何地方都不运行终端命令。种子脚本是 2026-08-30 的，从不登记容器。所以没有任何用例能看到 `exit 0`，而
`emit_qa_verdict` 在没有它的情况下拒绝 `approved`——六个预期裁决中有三个变得不可能。拒绝消息说
"suba o container do projeto (a Infra propõe `container_start`)"，而模型照它读到的做了：在三个用例中它向终端请求
`container_start` 或 `docker-compose up`（保持 `pending`，于是 `awaiting_approval`），在一个用例中它把 `npm test` 重复了
六十次直到 `toolloop.limit_reached`（`blocked(modelo)`）。剩下两个在第一次调用时就以空的 `command` 卡住——ADR 0123 已经
为这个模型记录的不可靠性，与 RN-502 无关。这里没有任何东西是 CI 特有的：同样的拒绝对本地执行也有效。

这就是为什么没有提交任何 `golden-set-qa.yml`。一个因与其所测无关的原因而每次执行都变红的定时 workflow 比没有更糟——背景
中的红色教人忽略红色。被测量的设计留在仓库历史中（提交 `e7d7d1b16` 中的 workflow，包括一个临时的诊断步骤）。让它重新能够
测量意味着决定 golden-set 在 RN-502 下如何运行测试套件，而那是一个需要人类作出的决定。放宽拒绝让 harness 通过从来不是
选项之一：那会削弱 RN-502 所要保护的隔离，只为让一个测试通过。

### 决定，以及第二次测量（AT-076） {#the-decision-and-the-second-measurement-at-076}

在 2026-09-27，维护者选择了第一条路径：**种子通过 broker 启动一个真实的容器，并通过生产路径把它登记为 `running`。**
RN-502 保持不变；改变的是种子现在满足了它的前提条件。对每个用例，在把骨架克隆到项目的托管文件夹之后，
`apps/api/scripts/golden-set-qa-container.ts` 在一个自己的 `consultiva` 会话中走过真实项目走过的同样的用例：
`CreateModuleMapUseCase`（一个模块）、`RouteModulesToInfraUseCase`（一个候选镜像）、执行者为 `agent/infra` 的
`container_start` 的 `ProposeActionUseCase`，以及作为项目所有者的 `ApproveActionUseCase`。批准运行
`ExecuteContainerStartUseCase`，它通过 `DecidirImagemDoProjetoUseCase` 把选举记录为一个新的 `artifact.project_image`
（于是由 `validarDecisaoDeImagem` 评判镜像），调用 `ContainerBrokerPort.start`，并通过状态机登记
`provisioning → running`。种子提议并批准而不是直接调用执行用例，因为有两条规则住在提议一侧——命名的 409
`sem_broker_na_instalacao`（[RN-591](../business-rules.md#rn-591)）以及 `decide()` 对 `container_start` 的策略——而一个
跳过它们的 harness 会在其中任何一条改变的那天不再跟随生产。

镜像是 `node:24.11.1-bookworm-slim`，在种子中按多平台索引的 digest 固定（ADR 0159 的规则，尽管这个文件在
`imagens-pinadas.ts` 扫描的树之外）。是 Debian 而不是 Alpine，因为 broker 用 `sleep infinity` 让容器保持存活。让三方看到
同一份代码的几何结构：worktree **就是**项目的托管文件夹（`projectScopeRoot`），broker 把
`<PROJECT_WORKSPACES_HOST_ROOT>/<workspace_dir_name>` 挂载到 `/work`，engine 在 `exec` 之前把 QA 的 `cwd` 翻译为 `/work`。
在 CI job 中 api、engine 和 broker 全部原生运行在 runner 上，因此 `PROJECT_WORKSPACES_ROOT`（api、engine）和
`PROJECT_WORKSPACES_HOST_ROOT`（broker）是同一个路径；broker 是唯一与 Docker 对话的进程。

容器起不来的用例现在会以 `ContainerDoGoldenSetNaoSubiuError` 让种子失败，点名步骤和产品给出的原因，而当 api 在运行但种子
失败时，ExUnit 模块会**失败**。以前，它从测试主体返回 `{:skip, _}`——而 ExUnit 不把它当作 skip：测试通过，绿色，而什么都
没测。

用一个由分支上的 `push` 触发的临时 workflow 测量（在 PR 之前删除，就像 AT-067 做的那样）：

| 执行 | 模型拉取 | 镜像拉取 | 容器就绪（提议 → 执行） | `mix golden_set.qa` | 整个 job | 得分 |
|---|---|---|---|---|---|---|
| [36291440108](https://github.com/daneiel/brabo/actions/runs/36291440108) | 15 s | 6 s | 每个用例 0,20–0,28 s | 48 min 29 s | 52 min 38 s | 3/6 |
| [36294037297](https://github.com/daneiel/brabo/actions/runs/36294037297) | 15 s | 6 s | 每个用例 0,22–0,30 s | 83 min 16 s | 86 min 16 s | 3/6 |

对照三个标准，在两次执行中：event log 中 RN-502 的拒绝为**零**（没有任何终端动作或会话事件提到它）；`npm test` 在容器内
运行并 `exit 0`，第一次执行中六个用例有五个，第二次中全部六个（缺口是 broker 带名称拒绝的空 `command`——ADR 0123 已经
记录的模型不可靠性）；得分按原样报告，两次都是 3/6，对照下限 1/6。

| 用例 | 预期 | 36291440108 | 36294037297 |
|---|---|---|---|
| `rf-covered` | approved | ✓ approved | ✓ approved |
| `rf-uncovered` | changes_requested | ✓ changes_requested | ✓ changes_requested |
| `rf-single-clean` | approved | ✗ changes_requested | ✗ `blocked(modelo)` |
| `rf-mismatched-filename` | approved | ✗ changes_requested | ✓ approved |
| `rf-partial-coverage` | changes_requested | ✗ `blocked(modelo)` | ✗ `blocked(modelo)` |
| `rf-skipped-test` | changes_requested | ✓ changes_requested | ✗ approved |

同样的总数，不同的用例：错误现在是模型的判断及其方差，这正是 golden-set 要测量的——`rf-skipped-test` 有一次批准了，把一个
`test.skip` 算作覆盖，而 `rf-single-clean` 在第二次执行中运行了 30 次 `npm test` 才以 `blocked(modelo)` 结束。

执行变得更长（48 和 83 min，对比 19–23 min），因为用例现在在做工作：读取文件并推理覆盖率，而不是停在拒绝上，一个重复的
用例现在重复的是真实的执行。一个定时 job 需要高于这里看到的 86 min 的 `timeout-minutes`。有两件事被看到而没有在这里改变：
api→broker 的调用对每个操作（包括 `start`）都有 5 s 的上限，因此一个其镜像还不在 daemon 中的 `container_start` 会在拉取
继续时超时（job 事先拉取镜像；没有这一步的情况没有测量）；以及 engine 的心跳在种子之后约 30 s 关闭了空闲的会话
（`heartbeat_timeout`），而 QA 继续在其中提议和运行命令（QA 在 `mix` 的进程中运行，在任何会话进程之外），在这一轮中
没有可见的影响。

### 定时，每周（AT-149） {#scheduled-weekly-at-149}

在 2026-09-27，维护者选择了节奏：**每周**（[ADR 0168](../adr/0168-golden-set-do-qa-em-ci-semanal.md)）。
`.github/workflows/golden-set-qa.yml` 是 AT-076 的设计变为永久——api、engine 和 broker 原生运行在 runner 上，只有 broker
与 Docker 对话，三方是同一个托管文件夹——在 `schedule` 加 `workflow_dispatch` 上，从不 `pull_request`，与
`golden-set-rag.yml` 的姿态相同。

每周而不是像 RAG job 那样每晚，有两个测得的理由。RAG 的执行花费约 20 分钟且是确定性的，因此昨天的下降是真实的下降。这个
花费 52 到 86 分钟并且**会变化**：AT-076 的两次执行以不同的用例得到了同样的 3/6。每晚执行会每周花掉好几个小时的 runner
时间，用更多噪音读出同一个趋势；每周一次执行是棘轮下限显示下降所需要的，而 `workflow_dispatch` 在 QA 提示词或种子改变后
立即回答。它在周六 01:17 UTC 运行：远离 RAG 每天的 06:00、属性证明周日的 04:00 以及外部链接检查周一的 06:00；在周六，
让红色的执行等到一周开始；在第 17 分钟，因为 Actions 会在整点延迟甚至丢弃计划。`timeout-minutes` 是 150：测得的 86 min
加上一次有多个用例碰到迭代上限的执行的余量。这是模型的方差，而 job 不测量时钟。

裁决是测试本身的：低于 `floor.json` 为该模型记录的 `passRate`，ExUnit 就失败。workflow 只添加了两个工具守卫——得分那一行
必须存在（api 不在时测试会跳过，而在无人监督的执行中 skip 是一个什么都没测的绿色）以及 event log 中不能有 RN-502 的拒绝
（AT-067 的特征）——并在失败时打印日志，就像 RAG job 做的那样。要预先拉取的镜像从种子自己的常量
（`IMAGEM_DO_GOLDEN_SET_QA`）读取，而不是第二个字面量：broker 的 `docker run` 在 Docker 端口 30 s 的控制上限下运行
（[RN-604](../business-rules.md#rn-604)），一个在种子请求另一个镜像时拉取一个镜像的 job，会把拉取放进这个上限之内。

证明执行，在分支上用一个临时的 `push` 触发器，在 PR 之前删除：

| 执行 | 模型拉取 | 镜像拉取 | `mix golden_set.qa` | 整个 job | 得分 |
|---|---|---|---|---|---|
| [36327281774](https://github.com/daneiel/brabo/actions/runs/36327281774) | 15 s | 5 s | 10 min 13 s | 13 min 41 s | 3/6 |

event log 中 RN-502 的拒绝为零，六个容器在第一个用例之前都是 `running`。又一次同样的 3/6，又一组不同的用例——
`rf-covered`、`rf-uncovered` 和 `rf-skipped-test` 命中；`rf-single-clean` 和 `rf-mismatched-filename` 在期望 `approved`
的地方得到了 `changes_requested`，`rf-partial-coverage` 以部分覆盖被批准。这次执行用了 AT-076 那些执行的六分之一时间
（`mix golden_set.qa` 10 分钟对比 48–83 分钟）：这一次没有任何用例重复到迭代上限。超时仍按测得的最慢执行而不是最快执行
设定。

## gate 可能在登记中缺失，而 `fluxo.yml` 已经指派了它 {#a-gate-can-be-missing-from-the-registry-while-fluxoyml-already-assigns-it}

`deployavel` 是第四种模式，也是最不讨好的一种：它在 `docs/fluxo.yml` 中被声明为 `area-infra` 的 `gate_saida`，而
**完全不在 `docs/gates.yml` 中**——不是 `planned`，不是过时，就是不在那里。团队模型有三个部件（目录、流程、登记），而还
没有任何东西对它们做交叉核对，因此一个 gate 可以在一处是交付物而在另一处不存在。这是这种形式的**第二个**发现；第一个是
朝相反方向变老的 `paralelismo-autorizado`。

它以 `planned`/`warn` 进入，没有 `evidencia` 块也没有验证脚本，因为 [RN-070](../business-rules/custo.md#rn-070)/
[RN-071](../business-rules/custo.md#rn-071) 禁止没有它的 `block`——也因为阻塞它的不是代码。基础设施已经存在（overlays、按
digest 在 GHCR 中的镜像、smoke/rollout/restore 脚本）；缺少的是一个有真实流量的生产环境和维护它的人。见
[ADR 0153](../adr/0153-deploy-enabled-o-gatilho-que-ninguem-cria.md)，它也让十个文档不再把 `DEPLOY_ENABLED` 当作代码中
存在的变量来引用。

## 消费：界面派生，而不是重复 {#consumption-the-screen-derives-it-doesnt-repeat}

面板中的 PR 轨道——Dev → QA → SecOps → Você——曾是写在组件内部的列表。自 FASE 15b 起，它通过 `GET /gates` 来自登记。

在实践中改变的是一种属性，而不是外观：**离开登记的 gate 会自动离开界面。** 以前，停用 SecOps 会在轨道中留下一个死掉的
步骤，直到有人记得去编辑代码——这正是促使登记存在的那种老化。

值得解释的三个决定：

**路由与内部路由分开。** `/internal/gates` 是服务对服务的，带服务 token，服务于测量脚本；`/gates` 属于已登录用户，服务于
界面。同一个登记，不同的受众。

**没有 `projectId`。** 登记是关于**产品**的事实：同样的 gates 对每个项目都有效。把它绑定到项目会暗示每个项目可以有不同的
gates，而这正是 ADR 0054 故意保持开放的。

**只有 `active` 的 gates。** `planned` 的 gate 描述一个未来的角色（dev-lead、platform）。在一个说明现在正在发生什么的界面
中，它会显得好像正在发生。

### 界面仍然自己决定的 {#what-the-screen-still-decides-on-its-own}

每个步骤的**标签**（`QA`、`Você`）以及**每个 gate 代表哪个步骤**留在组件中。这不是不一致：登记描述策略，而如何向用户称呼
这些东西是界面的决定。从界面移出的是**列表**——有哪些步骤。

登记带来而界面还不知道如何绘制的 PR gate 会被**忽略**，有一个测试断言这一点：轨道中间一个 `undefined` 的步骤会比它不存在
更糟。

## 参考 {#references}

- [ADR 0054](../adr/0054-gates-como-registro-declarativo.md)——决定
- [ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md)——event log 中的决定，没有它就没有可测量的东西
- [RN-070](../business-rules/custo.md#rn-070)、[RN-071](../business-rules/custo.md#rn-071)

---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
id: validacao-real
title: 真实验证——远程 GitHub 与真实模型
sidebar_label: 真实验证（13b）
sidebar_position: 6
description: 针对真实远程仓库、使用真实 dev agent 和 API 模型的执行——它证明了什么、它否决了什么，以及为什么在这里失败比通过更有价值。
keywords: [验证, dogfooding, GitHub, dev agent, 测量, FASE 13b]
---

# 真实验证——远程 GitHub 与真实模型

[阶段 12 的验证](./validacao-fase-12.md)白纸黑字地声明了自己的局限：
`LocalGitProvider`、`NoopDevAgent`、由脚本自己写下的 gate 裁决。它的存在是为了在不依赖
网络、也不依赖模型判断的情况下证明这条**链路**，而它做得很好。

这一次恰好替换了那次留在外面的三样东西——远程 GitHub、真实 dev agent、API 模型——而
结果正是诚实的 dogfooding 所应得的：**便宜的那一半全部通过，昂贵的那一半以一种没有任何
测试曾经显示过的方式失败了。**

脚本是 `pnpm --filter api validacao:real -- --repo <owner/repo>`。

## 通过了什么，而且比看上去更多 {#o-que-passou-e-é-mais-do-que-parece}

下面的一切都针对真实 GitHub 上的 `daneiel/test` 运行，并且**一分钱都没花**——这是
`--ate backlog` 阶段。

| 内容 | 结果 |
|---|---|
| 远程接管（真实的 `getRepo`） | `origin: adopted`，默认分支 `main` |
| dry-run 计划 | 6 个变更、6 条诊断，**决策为空** |
| 在决策之前仓库未被触碰 | 经 API 验证：**零分支、零内容** |
| 重新接管会收敛 | 第 1 轮 6 个变更，**第 2 轮 3 个**（[RN-046](../business-rules/custo.md#rn-046)） |
| 唯一的 story 保持 `draft` + 提议 | 是，没有自动晋升 |
| 晋升前的 `claimNext` | `null`——没有可领取的 |
| 晋升 | 以**用户**为操作者记录 |

RN-045 不再只针对本地 bare 仓库证明：远程仓库在接管**之后**被检查过，而且确实是空的。

### 发现 D 真的发生了 {#o-achado-d-aconteceu-de-verdade}

bootstrap 在 `protect_branches` 处停下，报
`Upgrade to GitHub Pro or make this repository public`——免费计划上的私有仓库。这正是
阶段 D 记录的场景，现在在测试之外被观察到了。

而 [RN-078](../business-rules/custo.md#rn-078) 的前提也得到了确认：紧接着检查仓库，
`dev`、`main` 和 `qa` 都存在，文件也都已 commit。这是**最后**一步，也是唯一一个失败后
仍留下可用仓库的步骤。脚本识别出这一失败并继续执行，这正是为此设计的出口。

## 付费执行显示了什么 {#o-que-a-execução-paga-mostrou}

模型 `openai/gpt-5-mini`（经 OpenRouter）、真实 dev agent、一个带一个 task 的 story：
*"Expor GET /saudacao"*。

**task 因 `limite de iterações atingido` 被阻塞，来源为 `modelo`。** 没有打开任何 PR，
因此也没有任何 gate 进行评判。

记录下来的诊断清楚得令人不安：`(nenhum terminal rodado)`。

### 测量 {#a-medição}

由 `pnpm --filter api medir:execucao` 提取，绝非手工记录：

| | |
|---|---|
| 时间窗 | 1m36s |
| 会话 · 事件 | 3 · 59 |
| **中途 engine 重启** | **否** |
| gate 轮次 | 无（没有 PR） |
| 沉默的回合 | 无 |
| 用户干预 | 无 |

| agent | 调用 | in | out | 成本 | 模型 |
|---|---|---|---|---|---|
| dev-api | 8 | 5.671 | 205 | < US$ 0,01 | `openai/gpt-5-mini` |
| anamnese | 1 | 6.779 | 967 | < US$ 0,01 | deepseek-v4-flash |
| psicologo | 1 | 3.212 | 1.981 | < US$ 0,01 | deepseek-v4-flash |

**零重启**这一标准达成了。而成本是最不有趣的部分：八次调用只有 205 个输出 token，
说明这个 agent 什么都没写。

### 产品自己发现了什么 {#o-que-o-produto-descobriu-sozinho}

Psicólogo 以重型 tier 运行，产出了三条假设。第一条和第二条就是正确的诊断，无人指点：

> O dev-api não tinha (ou não utilizou) um ambiente terminal funcional […] em
> toda a sessão não existe nenhum tool.call de execução de comando […] apenas
> `search_workspace`/`read_file`.

> A ferramenta `search_workspace` está sub-indexada ou mal configurada para
> este repositório: não encontrou nenhum arquivo de código ou manifesto […]
> Isso enganou o agente, que ficou tentando entender "onde está o projeto".

这值得单独记录：产品的自省**奏效了**。Psicólogo 读取了一次失败执行的 event log，并以
比脚本中任何断言都更高的精度说出了原因。

## 发现，交给 13c 的分诊 {#os-achados-para-a-triagem-da-13c}

本阶段的纪律在这里和在任何地方一样适用：**新发现以条目形式进入，绝不以修复的形式
进入**。

### X. dev agent 在探索空仓库时耗尽了迭代上限 {#x-o-dev-agent-queima-o-teto-de-iterações-explorando-repositório-vazio}

给定一个新开通仓库中的 task——只有 Gitflow 模板，没有代码——agent 把八次迭代都花在
`search_workspace`/`read_file` 上寻找“项目在哪里”，从未运行过一条命令，也没写过一个
文件。

症状是来源为 `modelo` 的 `limite de iterações atingido`，这在技术上是事实，在实践上却
毫无用处：模型并没有判断失误，它根本没走到需要判断的地步。原因在于缺少**没什么可找**
的信号——凭可用的工具，空仓库与搜索失败的仓库无法区分。

值得注意的是，这是产品中 dev agent 从绝对零点开始的**第一个**场景。此前的每个测试和
每个演示都从带代码的 workspace 出发。

### Y. `search_workspace` 不区分“空”与“没找到” {#y-search_workspace-não-distingue-vazio-de-não-encontrei}

这是上一条的直接后果，而且很可能是可操作的那一环：前五次调用都返回 `nenhum resultado`，
agent 把它理解为“再找仔细点”，而不是“这里什么都没有”。Psicólogo 独自得出了同样的结论。

## 第二次执行：修复 Y 并没有解决 X {#a-segunda-execução-a-correção-do-y-não-fechou-o-x}

在关闭发现 Y 之后，同样的执行再跑了一次——同样的 story、同样的仓库、同样的模型。
**两次之间只有工具的那句话变了。**

| | 第 1 次执行 | 第 2 次执行 |
|---|---|---|
| dev-api 的调用 | 8 | 8 |
| 输出 token | 205 | 248 |
| 结果 | `limite de iterações atingido` | `limite de iterações atingido` |
| PR | 无 | 无 |

行为发生了可观察的变化——**一次**搜索而不是五次，随后是 `read_file`——而结果没有变。
新消息到达了 agent，并且对这个情形是正确的（`o workspace tem 2 arquivo(s), então a busca
funcionou`），因为仓库里有 Gitflow 模板，并不是空的。

**这里记录的假设是错的。** 之前的文字写着 *"a correção é a frase, não o teto"*。证据说的
却是另一回事：八次迭代中有七次是探索。只剩**一次**用来写文件、commit、push 并打开
PR——即使是完美的 agent 也做不完。

`TOOL_LOOP_MAX_ITERATIONS` 默认为 `8`
（`apps/engine/config/runtime.exs:100`）。这个数字是为对话型 agent 定的，从未针对需要在
行动前先探索仓库的 dev agent 重新评估过。

Psicólogo 再一次比脚本的断言更精确：

> o workspace não contém o código do projeto: não há package.json, nem src,
> nem README

> ficou apenas em modo leitura/exploração

### 这教会我们关于测量的什么 {#o-que-isso-ensina-sobre-medir}

记录负面结果正是重点所在。如果没有做第二次执行，发现 Y——它是真实的，并且有测试覆盖——
就很容易被误当成 X 的解决方案。这是一次正确的修复，却**没有**产生预期效果，而只有执行
才显示了这一点。

## 第三次执行：上限**就是**原因 {#a-terceira-execução-o-teto-era-a-causa}

用 `TOOL_LOOP_MAX_ITERATIONS=25` 代替 `8`，其他什么都不变，dev agent 上了一个台阶：

| 工具 | 第 2 次执行（上限 8） | 第 3 次执行（上限 25） |
|---|---|---|
| `search_workspace` | 2 | 4 |
| `read_file` | 5 | 6 |
| **`write_file`** | **0** | **3** |
| **`terminal`** | **0** | **1** |
| 结果 | 迭代上限 | `dev.awaiting_approval` |

它进行了探索，**写了三个文件**，并调用了 `npm test --silent`。上面记录的假设是对的：
从对话型 agent 继承来的上限 8，容不下一个需要在行动前先理解仓库的 dev agent。

**而停止的原因完全变了。** 没有发生阻塞：终端动作变成了带 `require_approval` 的
`proposed_action`，agent 进入 `dev.awaiting_approval`——挂起，保留 worktree 和历史，
正如 [ADR 0052](../adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md) 所设计的。它停下
来等待，而不是在门口反复敲门烧掉迭代次数。

## 第四次执行，以及它揭示的关于阶段 F 的事 {#a-quarta-execução-e-o-que-ela-revelou-sobre-a-fase-f}

在项目的 `allow` 中放开 `npm`、`pnpm`、`node` 和 `npx` 并没有解锁：agent 运行了
**`ls -la`**，这个动词不在列表中，于是又一次挂起待批。

这暴露了阶段 F 交付的东西与所要求的东西之间的差别。要求是
*"permita sempre comandos desde que seja na pasta do projeto"*。
[ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) 交付的是一个
**上限**：触及项目文件夹之外路径的命令永远不能自动批准，不管动词是否在 `allow` 中。
上限保护的是**路径**——**动词**仍由 allowlist 管理，而 allowlist 按设计是一个封闭列表。

实际后果：agent 发明的每一条新命令都会落入 `require_approval`。这个阶梯依然存在，只是
变得更安全了。

**我不把这当作缺陷**，而是当作范围：ADR 0055 从未承诺要晋升动词。但要求与交付之间的
差距是真实的，于是成为分诊条目。

### 测量工具自身的陷阱 {#uma-armadilha-do-próprio-instrumento}

第一次配置策略的尝试完全没有生效，原因值得记录，因为它是复发性的：脚本是**从宿主机**
运行的，于是 `PROJECT_WORKSPACES_ROOT` 落到默认值 `/tmp/brabo-project-workspaces`，而
`permissions.json` 生成在一个 engine 看不到的文件系统里。

这与 [阶段 12 的验证](./validacao-fase-12.md) 已经记录的 `/tmp` 中试验仓库的陷阱是同一个——
在同一天、以另一种途径再次出现。脚本的头部现在白纸黑字地要求从容器内部执行。

## 第五次执行：链路抵达 GitHub {#a-quinta-execução-a-cadeia-chega-ao-github}

**从容器内部**运行（这是之前缺少的条件），并放开了终端动词，链路完整地走通了：

| 动作 | 策略 | 结果 |
|---|---|---|
| `terminal` ×2 | `auto_approve` | ✅ executed |
| `git_commit` | `auto_approve` | ✅ executed |
| `git_push` | `auto_approve` | ✅ executed |
| `pr_open` | `auto_approve` | ❌ **failed** |

**agent 的分支存在于 GitHub 上**：`feature/task-d4b36a5b`，与 `dev`、`main` 和 `qa`
并列。由模型编写的代码，以 `dev-api[bot]` 身份 commit，并推送到真实的远程仓库。

`pr_open` 以 `Requires authentication` 失败，原因是**发现 AA**：api 通过
`action.decidedBy` 解析 git token，而当策略自动批准时它为 NULL。push 之所以成功，是因为
负责推送的是 engine，它会注入 owner 的凭据（RN-076）。

## 第六次执行：PR 在 GitHub 上打开了 {#a-sexta-execução-a-pr-abriu-no-github}

在 [RN-082](../business-rules/custo.md#rn-082) 就位后，链路一直闭合到了 PR：

> **PR #1 — "Rota pública de saudação — Expor GET /saudacao"**,
> de `feature/task-636ef1aa`, aberta em `daneiel/test`.

由模型编写的代码，以 `dev-api[bot]` 身份 commit，推送并作为 pull request 发布到真实的
远程仓库。**gate 打开了**（`pr.gate_changed`，`gateStatus: awaiting_qa`），QA 领域开始
运行。

`qa-performance-seguranca` 被**正确地豁免**（`delegation.dispensed`，理由
*"story sem RNF"*）——带理由的豁免，绝非沉默，正如 ADR 0038 所设计的。

`qa-automacao` 失败了，成为**发现 AB**：它调用了一个复合命令，其最后一段（`head`）不在
`allow` 中，ToolLoop 挂起于 `awaiting_approval`，而 QA Lead 把这次挂起归类为
*"desfecho inesperado"*，来源为 `infra`。这正是 ADR 0052 为 dev agent 修复、却没有延伸到
gate agent 的缺陷。

## 第七次执行：扩大 allowlist 不够，而这是可预见的 {#a-sétima-execução-ampliar-o-allowlist-não-bastou-e-isso-era-previsível}

放开了 25 个动词——明确的标准：**读**或**构建**的，绝不是从网络获取或破坏的——gate 又一次
卡住。而且不是因为缺少动词：

```
ls -la && echo "---" && cat package.json 2>/dev/null; …
```

`ls`、`echo` 和 `cat` 全都在 `allow` 中。拦住它的是 `2>/dev/null`，这成为**发现 AC**：
解析器把 `>` 当作分隔符，重定向变成一个动词为 `/dev/null` 的片段，而同一个 token 还是
项目之外的绝对路径。

**执行前记录的预测得到了证实。** allowlist 是封闭列表，而模型会发明命令；扩大列表只是
打补丁。第 7 次执行以难以反驳的方式证明了这一点：25 个动词，却因命令的**形式**而不是
动词卡住了。

## 第八次执行，以及它闭合的论证 {#a-oitava-execução-e-o-argumento-que-ela-fecha}

在 Y、AA、AB 和 AC 修复之后，dev agent 只做了一次调用：
`bash -lc npm test --silent`。动词 `bash`，不在列表中，`require_approval`。

**这个拒绝是对的**——放开 `bash` 会让整个 allowlist 失效，包括内置的 `deny`。但最近三次
执行合在一起，说出了它们各自单独都没说出的东西：

| 执行 | 卡在 | 类别 |
|---|---|---|
| 第 6 次 | `head` | **动词** |
| 第 7 次 | `2>/dev/null` | **形式** |
| 第 8 次 | `bash -lc` | **调用方式** |

三轮出现三个不同类别。扩大列表解决第一类，碰不到另外两类。面对一个能自由选择如何调用
想运行之物的 agent，**动词 allowlist 不会收敛**。

这不是 allowlist 的缺陷：它兑现了承诺，而对 `bash` 的拒绝正证明了这道边界守得住。这是
一个**范围**上的限制——它本就不是为实现自主而设计的，也实现不了。

13b 的实际结论就是这个，而且比 PR 更有价值：**通往由 LLM 把关的 gate 之路，不在于放松
策略。** 而在于让 agent 等待决策而不是死掉（发现 AB），这正是 ADR 0052 已经为 dev agent
做的事。

## 第九次执行：会毁掉保证的廉价修复 {#a-nona-execução-a-correção-barata-que-teria-destruído-a-garantia}

第九次卡在与第八次相同的 `bash` 上，显而易见的修复只有一行之遥：把 `bash` 放进 `allow`，
看着流水线变绿。

**没有这么做，而这正是这次执行的交付。** 放开 `bash` 不是扩大 allowlist——而是**取消**
它，因为每条被拦下的命令都会获得一种被允许的调用形式，包括内置的 `deny`。这一轮本会通过，
保证本会消失，而结果中没有任何东西会显示出这种交换。

于是，第九次固定下来的是诊断：问题从来不是列表中有**哪个**动词，而是当策略要求询问时
**gate agent 会死掉**。由此产生了 [ADR 0057](../adr/0057-o-gate-espera-a-aprovacao.md)，把
[ADR 0052](../adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md) 已经为 dev agent 做的事
延伸到 gate：面对需要决策的动作，**挂起并等待**，而不是把自己的挂起归类为 infra 故障
（发现 AB）。

## 第十次执行：完整链路，端到端 {#a-décima-execução-a-cadeia-inteira-ponta-a-ponta}

在 ADR 0057 就位后，第十次闭合了前九次留下的所有悬而未决之处，**engine 一次都没有
重启**：

| 步骤 | 结果 |
|---|---|
| 远程接管 | 针对 `daneiel/test` 的 `origin: adopted` |
| 仓库计划 | 只在**你的**决策之后执行 |
| story 的晋升 | 手动，以用户为操作者 |
| 真实 dev agent | 编写了代码，以 `<agente>[bot]` 身份 commit |
| push 与**远程 PR** | 在 GitHub 上发布 |
| gate | 打开（`pr.gate_changed`） |
| QA 领域 | 进行了委派并**带理由地豁免** |
| subagent | 在审批处**挂起**，没有死掉 |
| 你的拒绝 | **恢复**了循环而不是结束它 |
| 裁决 | `changes_requested`，由 LLM 评判 |

要紧的是最后两行。subagent 停下来并继续存活，这是 ADR 0057 在起作用；**用户的拒绝恢复
循环**，则是之前任何执行都未曾达到的点——人的决策进入 agent 工作的中途，而它从那里继续，
而不是重新开始或放弃。

而且裁决不是脚本写的：它来自模型对一个真实 PR 的评判。这正是本验证相对于
[确定性的姊妹验证](./validacao-fase-12.md) 所要覆盖的差别。

> **TODO(humano):** o custo em dólares e a contagem de chamadas destas duas
> execuções não foram extraídos com `medir:execucao` na época. Se ainda houver
> `token_usage` das sessões, vale preencher — as demais medições deste documento
> vêm todas de script, e estas duas são a exceção.

## 双模块的执行：对并行性的考验 {#as-execuções-com-dois-módulos-o-paralelismo-posto-à-prova}

前十次都只有**一个模块**。这足以证明链路，却不足以证明并行性：只有一个故事时，Dev Lead
会**拒绝**并行——“它们会撞上同样的文件”——而且它是对的。
[RN-083](../business-rules/custo.md#rn-083) 的上限从未被真实工作查询过。

于是有了三轮 `--modulos 2`（一个故事在 `api`，一个在 `web`）。前两轮记在
[发现 AF](./achados-execucao-real.md) 中——一轮出了故障，一轮证明了修复。下面是**第三轮**，
它的存在是为了测量。

Dev Lead 独立做了规划：

> **2 agentes em 2 módulos** — *"cada módulo tem exatamente uma história, então
> um agente por módulo é o mínimo justificável sem desperdício."*

这一轮闭合了，由 `medir:execucao` 而不是手工测量：

| | |
|---|---|
| 时长 | **3m56s**，3 个会话中 182 个事件 |
| 调用 | **33**（dev-api 10、dev-web 9、arquiteto 7、qa-automacao 6、dev-lead 1） |
| 成本 | **< US$ 0,01** |
| engine 重启 | **否** |
| 沉默的回合 | **无** |
| gate | `qa` **approved**，`secops` **approved** |

**上限要求了决策。** 两个 agent 都运行起来后，下一个请求停在
`aguardando_autorizacao`，`parallelize` 动作**在数据库中待处理**——2 个活跃，上限 2。什么
都没有启动：如果启动了，授权就成了作秀。

### 双模块在这一轮之前弄坏了什么 {#o-que-os-dois-módulos-quebraram-antes-desta-rodada}

这一轮干净地结束了，但它是双模块的**第三轮**，付出代价的是前两轮。第一轮中，`dev-web`
领取了 task，却在**第一个回合之前**死于 `fatal: not a git repository`——零 token 消耗，task
被阻塞。这就是 [发现 AF](./achados-execucao-real.md)：`Workspace.ensure!/4` 快速路径的守卫
询问 `.git` 是否存在，而 `git init` 会在 `fetch` 之前创建 `.git`；第二个 agent 读到“就绪”
就跳过了锁。

这把锁从阶段 4 就存在，而且是正确的。错的是决定是否值得获取它的标准——而**之前十次执行
中没有一次能暴露它**，因为没有一次有第二个 agent。修复后，`dev-web` 在下一轮从 0 次调用
变为 16 次，第三轮正是从那里继承了只做测量的资格。

测量工具也学到了东西：上限的断言原本断言的是**数字**（第 3 个请求会请求授权），这对一个
模块成立，却否决了一次产品行为正确的执行——双模块时激活就已经填满上限。现在它断言的是
**规则**：只要放得下，就不问直接启动；放不下时，就停下。

## 本验证仍然**没有**证明什么 {#o-que-esta-validação-ainda-não-prova}

对范围保持诚实，和它的姊妹验证一样：

- **合并。** 按设计继续排除在外
  （[RN-014](../business-rules.md#rn-014)），并将一直如此：在受保护分支上按下按钮的是你。
- **其余五个 provider。** 只有 OpenRouter 用真实凭据跑过；其余的因缺少 key 仍没有
  smoke，而对一个 provider 成立的结论，不能靠推理转移到其他 provider。
- **隔离。** agent 与这个 monorepo 在同一个容器中执行。
  [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) 自称是**策略**而不是
  隔离——`..` 会被否决，但从内部指向外部的 symlink 检测不到。
- **路径上没有策略的自主。** 动词 allowlist **不会收敛**（发现 Z 和 AD），这是范围上的
  限制，不是要修的 bug。
- **由 Dev Lead 自己提出的并行上限。** 双模块时它规划了 2 个 agent，上限是 2——放得下。
  突破上限的是脚本，它直接调用了用例。要看到 *lead* 请求超出可行范围，需要 3 个以上模块，
  而这还没跑过。

链路本身——从接管到由 LLM 给出的 gate 裁决——**已在真实网络上得到证明**。上面仍悬而未决
的不是链路：而是它运行的环境以及它覆盖的范围。

## 参考 {#referências}

- [validacao-fase-12.md](./validacao-fase-12.md) —— 确定性的姊妹验证
- [achados-execucao-real.md](./achados-execucao-real.md) —— 收获
- [backlog.md](./backlog.md) —— X 和 Y 的去处

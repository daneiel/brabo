---
id: fase-28-pasta-do-usuario
title: FASE 28 — 用户的目录
sidebar_label: FASE 28 — 用户的目录
sidebar_position: 15
description: FASE 28 的切分——在引导中征得同意的 base，mounted 作为本地默认，以及一个声明能力的本地 agent。决策位于 ADR 0146 和 0147。
keywords: [fase 28, 用户的目录, 项目 base, runner, 镜像, 能力]
traducao_de: 30db82e3431b60a20fdb35062732923d3ddb6a5a
---

# FASE 28 — 用户的目录

> 本文档是该阶段的**切分**：它追求什么、拒绝什么、按什么顺序。**决策**位于 [ADR 0146](../adr/0146-base-consentida-no-bootstrap.md) 和 [ADR 0147](../adr/0147-agente-local-com-capacidades.md)——在这里而不在那里的内容是意图，不是决策。

## 问题 {#o-problema}

自 [ADR 0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md) 起，产品有三种执行模式，而没有一种交付用户所期望的最简单的东西：**打开编辑器，在他自己的目录中看到工作正在进行**。

| 模式 | 用户的目录 | 代价 |
|---|---|---|
| `container` | 不存在 | 代码存放在一个他从不打开的卷中 |
| `mounted` | 有，位于 `BRABO_PROJECTS_BASE` 之下 | **实际上不可见**：没有这个变量，该模式根本不会被提供，而产品中没有任何东西要求去配置它 |
| `runner` | 有，真实目录 | 二进制、手动 `chmod +x`、配对，以及 Docker 作为硬性前提（RN-507/508） |

`mounted` 是最有启发性的情况。[ADR 0141](../adr/0141-base-unica-dos-projetos-montados.md) 构建了唯一的 base，[ADR 0142](../adr/0142-validacao-de-workspace-montado-adiada.md) 让建议一个尚不存在的路径成为可能——但这两样都没有到达界面。`GET /workspaces/:workspaceId/projects-base` 存在，web 中却没有人使用它，因此这个早已就绪的模式仍然在安装产品的人够不着的地方。

## 设计，分三层 {#o-desenho-em-três-camadas}

每一层只有一种机制，没有一层发明新的权限：

| 层 | 位置 | 机制 |
|---|---|---|
| 同意 | `pnpm bootstrap`，一次，在主机上 | 选择 base，写入 `BRABO_PROJECTS_BASE`，证明 Docker Desktop 的共享 |
| 活目录 | base 之内 | 按同一路径绑定（ADR 0141）——零同步 |
| base 之外的目标 | 可选，按项目 | 本地 agent 的 `espelho` 能力：单向，从不删除 |

第三层的存在有一个物理原因：**bind mount 不跨网络，也触及不到挂载范围之外的路径。** 要写入主机上的任意目录只有三条出路——原生运行 api/engine、在主机上有一个活着的进程，或者由浏览器通过 File System Access API 写入。第二条是唯一持续的，而 `brabo-runner` 已经是那个进程。

## 配置同意 ≠ 行动审批 {#consentimento-de-configuração--aprovação-de-ação}

两个 ADR 需要声明的要点，它决定了镜像的设计：

镜像的写入**不**经过 `proposed_action`，因为它不是 agent 请求采取行动——而是系统在用户自己创建项目时声明的路径上写入。通过终端命令同步则恰恰相反：它会落入 [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) 的路径作用域，变成例行审批的队列，并恰恰侵蚀让点击有意义的那道上限。


## 编号——数出来，而不是继承来的 {#numeração--contada-não-herdada}

> 仓库散文中的计数存在已知的漂移。`CONTRIBUTING.md` 说"68 个 ADR"；`docs/adr/index.md` 的 frontmatter 说"108"。本阶段没有任何会话信任写在散文中的数字。

方法，本阶段每次会话在保留任何编号之前都要重复：

```bash
# ADRs — arquivos, não prosa
ls docs/adr/ | grep -cE '^[0-9]{4}-.*\.md$'

# RNs — cabeçalhos, nos três arquivos que compartilham a numeração
git grep -h -E '^### RN-' -- 'docs/business-rules.md' 'docs/business-rules/*.md' \
  | grep -oE 'RN-[0-9]+' | sort -u | wc -l
```

在第 1 次会话开始时针对 `dev` 测得：**144 个 ADR**（最大 `0145`，`0062` 处有一个空缺）和 **371 条 RN**（最大 `509`，零重复锚点）。由此得出 `0146` 和 `0147`。

**为本阶段保留的范围是 RN-511 到 RN-520**，跳过 RN-510 是有意的。只数 `dev` 会得到 510——但 RN-510 已经被分配在一个尚未合并的工作分支上。在这里保留它，会重现 RN-505 恰恰发生过的冲突：两个 PR 相隔两分钟分配了同一个编号，锚点 `{#rn-505}` 重复了好几周。

值得记录那次冲突为何存活了那么久：**`docs:build` 抓不到重复的锚点。** `onBrokenAnchors: 'throw'` 会让指向*不存在*的锚点的链接失败；有两个相同的锚点时，Docusaurus 解析第一个，第二个则静默地无法到达。只数 `dev` 中的内容是必要条件而非充分条件——还必须数正在进行中的。

## 各次会话 {#as-sessões}

每次一个可交付物，按顺序。每次会话的完整提示在上一次结束时写出，带上它所发现的东西。

| # | 可交付物 | 依赖 |
|---|---|---|
| 1 | 本文档 + ADR 0146 + ADR 0147 + 保留的 RN 范围 | — |
| 2 | `bootstrap.sh`/`preflight.mjs` 中征得同意的 base、`.env.example`、共享证明 | 1 |
| 3 | base 存在时，向导默认提供 `mounted` | 2 |
| 4 | 按 ADR 0146 的结论在本地 compose 中启用 broker | 2 |
| 5 | 在本地 agent 协议中声明能力（尚无镜像） | 1 |
| 6 | `espelho` 能力：自有作用域、单向、从不删除 | 5 |
| 7 | 作为用户服务安装、停止/移除、服务端吊销 | 6 |
| 8 | web 上的镜像状态（最后一次同步、计数、错误） | 6 |
| 9 | E2E、`docs:check`、docmap 和 CHANGELOG 收尾 | 8 |

## 本阶段交付了什么，以及在哪里偏离了计划 {#o-que-a-fase-entregou-e-onde-ela-desviou-do-plano}

上表是计划。下面是实际发生之事的记录——差异放在这里，因为一个为迎合结果而重写自己的计划，就不再能教会任何东西。

| # | RN/ADR | 结果如何 |
|---|---|---|
| 1 | ADR 0146, ADR 0147 | 按计划；保留了 RN-511..520 范围，跳过 RN-510（已在未合并的分支中分配） |
| 2 | ADR 0146 第 1–2 点 | 按计划——默认 base 为 `$HOME/projetos-brabo`，由 Node 脚本写入，因为 `bootstrap.sh` 的菜单项以 `/dev/null` 为 stdin 运行，按构造无法提问 |
| 3 | RN-513 | 两半早已是规则（RN-500/RN-501），却从未到达界面；**新**的只有预选 |
| 4 | RN-512, ADR 0146 第 3 点 | broker 在**本地** compose 中移出 `profiles`，**并且只在那里**——两个 compose 有意分歧 |
| 5 | RN-514, ADR 0147 第 1 点 | 按计划；因缺少能力而拒绝在诞生时就已实现并测试，**却未被触发**——只有 RN-516 给了它第一次真实触发 |
| 6 | RN-515/RN-516, ADR 0147 第 2/3/4/8 点 | 拆成两半（目标 × 复制），决定在会话中作出 |
| 7 | RN-518, RN-519/520, ADR 0147 第 5–6 点 | 在第 8 次会话**之后**交付——两者都只依赖第 6 次，没有任何东西规定它们之间的顺序 |
| 8 | RN-517, ADR 0147 第 7 点 | 按计划 |
| 9 | — | 收尾：缺失的 E2E、`apps/runner/**` 的 docmap 规则，以及本记录 |

有三件事与计划的假设不同，三者都在要紧之处声明了：

- **第 7 次会话在第 8 次之后运行。** 两者都依赖第 6 次而别无其他，彼此之间也没有依赖——表格的顺序是阅读顺序，不是先后约束。
- **BRB-031 没有消亡。** [ADR 0147](../adr/0147-agente-local-com-capacidades.md) 期望作为服务安装能消灭 [ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md) 的手动 `chmod +x`。它消灭不了：能运行 `brabo-runner service install` 的人，为了到达这条命令已经需要让二进制可执行。这个副作用依赖于安装来自 [ADR 0146](../adr/0146-base-consentida-no-bootstrap.md) 的版本化引导，而本阶段没有接上它。
- **吊销作用于 `{projeto, usuário}`，从不作用于 `{chave}`。** ADR 第 6 点没有承诺按凭据的精确性，但那是它自然的解读。它不存在：`runner_socket_tickets` 保存 `project_id`/`user_id`/`kind`，而凭据的身份在 `PatAuthGuard` 中就消失了。代价写在 RN-520 和 `security-surface.md` 中，而不是被掩饰。

## 本阶段**不**触碰的内容 {#o-que-esta-fase-não-toca}

两个 ADR 中都已声明，在这里重复，因为正是它赋予其余部分意义：

- `decide.ts` 和绝对上限——没有任何上限获得例外，可配置的也没有
- `proposed_action` 作为 agent 一切外部效果的起点
- event log 的不可变性
- 三种模式下的镜像关口（[ADR 0135](../adr/0135-portao-de-imagem-nos-tres-modos.md)）
- broker 的五个操作和计算出的规格（[ADR 0128](../adr/0128-porta-de-docker-e-a-prova-de-empacotamento.md)/[0130](../adr/0130-broker-de-container.md)）
- 枚举 `project_execution_mode`——本阶段没有诞生新模式

## 本阶段触及但不解决的缺口 {#lacunas-que-a-fase-encosta-e-não-resolve}

- **在 `runner` 模式下 `docker exec` 路径中被丢弃的 git 凭据**——`apps/runner/src/index.ts:318-320`；`packages/docker-port` 没有 `env` 字段，这是 ADR 0130 的决定。在 ADR 0130/0145 中声明，这里不修正。
- **项目内部指向外部的符号链接**不会被 `decide()` 检测到，它是纯函数、不做 I/O——ADR 0055。`apps/runner/src/guard.ts:9-31` 出于同样原因声明自己是尽力而为。
- **BRB-005**——已发布的工件（GHCR 镜像、runner 二进制）没有签名。没有签名的一行安装程序比当前的下载更糟，这就是第 7 次会话不提供一行安装程序的原因。
- **BRB-031**——通过浏览器配置时的手动 `chmod +x`。如果安装改为来自版本化的引导，它会作为副作用消失。
- **`{project_id, machine_id}` 的排他性**推迟到出现第二个真正同时工作的开发者——ADR 0137。

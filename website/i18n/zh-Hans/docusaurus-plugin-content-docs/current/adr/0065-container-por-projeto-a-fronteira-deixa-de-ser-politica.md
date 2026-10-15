---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# 0065 — 每个项目一个容器：边界不再是策略

## 状态 {#status}

已接受，**带有已声明的裁剪**。本 ADR 交付的那一半——Arquiteto 的 artifact、闸门以及外部效果的边界——已经
实现并经测试证明。它**不**交付的那一半——开通、停止、回收和清理容器——在“本 ADR 不做什么”中声明，并附上
原因。裁剪的是范围，不是论证：架构决策整体有效，正是它规定了下一阶段要构建什么。

本 ADR **修订 [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md)**，后者仍然被接受且不被编辑。
0055 在其后果一节中说自己是*策略，不是隔离*，并把每项目一个容器记为明确的待办。本文档处理的正是这项待办。

## 背景 {#contexto}

### 这笔债，用创造它的文档的原话说 {#a-dívida-nas-palavras-do-documento-que-a-criou}

> **O que este ADR NÃO resolve.** Escopo é **política**, não isolamento.
> Enquanto o monorepo do Brabo estiver montado em `/workspace` dentro do
> container que executa os comandos, a fronteira depende da política acertar.
> — ADR 0055

还有同一文档的接受说明，它测量了剩下的漏洞：路径归一化是**词法的**，`..` 会被否决，而**从项目内部指向外部
的 symlink 检测不到**。关闭它不是写一条更好的规则——而是要有一堵墙。

如今 agent 在**与 Brabo monorepo 相同的容器中**执行。把它与执行它的平台代码隔开的，是 `decide.ts` 中的一次
字符串比较。

### 不收敛的发现 {#os-achados-que-não-convergem}

FASE 13b 留下了两个开放的发现，它们的论证比产生它们的执行列表更有价值
（`docs/explanation/achados-execucao-real.md`）：

- **Z 和 AD**——动词 allowlist **不收敛**。动词、形式和调用方式是不同的空间：`curl`、`wget`、
  `python -c "urllib..."` 以及一个做这三者之一的 `.sh` 脚本，是以四种方式写出的同一种出站。第 6、7、8 次
  执行各卡在其中一种上。
- **AE**——QA agent 违背自己的 prompt，试图修改它所评判的代码，由两道独立的屏障（allowlist 和作用域）
  拦住。

FASE 13 的结论在本阶段存在之前就写下了，与本 ADR 得出的相同：**通往自主的道路不在于放松策略**。

### 用户的决定 {#o-que-o-usuário-decidiu}

> "Cada projeto tenha sua própria infra apartada, ou seja, subirá via container
> por cada projeto, isolando assim o terminal e dando permissão total a ele; o
> code somente é liberado após definição do arquiteto, pois ele que definirá
> qual tipo de container subirá aquele código, pois será o decisor de melhor
> oportunidade para qual imagem ser a melhor."

以及，关于完全权限的范围：

> "Agente livre para o que quiser desde que não seja comandos de git ligado ao
> deploy e ao PR — estas ações ainda devem ser humanas."

两句话，三个决定：**谁**选择镜像，代码页**何时**放开，以及自由在**哪里**结束。

## 决策 {#decisão}

### 1. 项目的镜像是 Arquiteto 的**artifact** {#1-a-imagem-do-projeto-é-artefato-do-arquiteto}

event log 中的 `artifact.project_image`，带 `image`、`rationale`、`network` 和 `resources`。有版本——修订
就是发出一个新版本，现行的是 `version` 最大的那个。

是 artifact 而不是配置，因为**选择镜像的人决定了 agent 能做什么**：有哪个运行时、哪个包管理器、哪个编译器。
这是与 `module_map` 同等分量的架构决策，而架构决策有作者、日期和理由。环境变量这三样都没有。

**没有表，而且不是为了节省。** event log 已经提供了这项决策需要的三种属性——不可变、有版本、有作者——而且
`artifact.module_map` 和 `artifact.business_rule` 已经住在那里。一张表会提供同样的东西，外加一个可能的
`UPDATE`，而对架构决策的 `UPDATE` 就是它不再可审计的方式。

**显式的 tag，拒绝 `latest`。** 写着 `node:latest` 的 artifact 什么也没描述：三月的容器与今天的是同名的不同
镜像，审计就开始撒谎。

**资源上限是拒绝而不是降低。** 超过最大值的请求是附带原因的 400，绝不是无声的削减——一个承诺多于容器实际
所得的 artifact，是在对审计它的人撒谎。

### 2. 在 Arquiteto 做出决定之前，代码页不开放 {#2-enquanto-o-arquiteto-não-decidir-o-code-não-libera}

这个闸门是用户的字面命令，而它的理由是产品上的：容器才赋予在那里读代码以意义——读了之后去运行、构建、
修正。[ADR 0060](0060-superficie-de-leitura-de-codigo.md) 的读取表面在状态为 `sem_decisao` 时返回 **409**，
消息说明缺什么。

是 409 而不是 403：请求者及其权限都没有任何问题——这个资源在这个状态下还不存在。而这项检查与路径约束放在
**同一个漏斗**（`alvo`）中，而不是在四个路由中，理由同 [RN-092](../business-rules/custo.md#rn-092)：在四个
调用者中重复的检查，总有一天会在其中一个出现分歧。

### 3. 边界：内部是自由的，外部属于人 {#3-a-fronteira-dentro-é-livre-fora-é-humano}

在容器**内部**，agent 是自由的——读、写、安装、构建、测试、运行。正是这关闭了 Z 和 AD，而这是已知的唯一
关闭方法：用墙取代枚举。

**外部**仍然属于人。有三种效果会穿过墙到达外界——`git push`、打开 PR 和部署——调用它们的终端命令会被
**拒绝**，消息会说明应该使用哪个**类型化**动作。

**是 `deny` 而不是 `require_approval`**，这正是需要论证的部分。这些效果中的每一个都已经有类型化的路径
（`git_push`、`pr_open`、`git_merge`），它们以 `proposed_action` 诞生，有自己的最低角色，由平台执行，并在
event log 中留下**推送了什么、推到哪里**。终端会是通往同一效果的第二扇门，而没有任何这些保证：日志只会说
“一条命令运行了”。而 `require_approval` 不够，因为存在“总是允许”——一次点击就会把模式写进 `allow`，第二
扇门就会永远开着。`deny` 在任何阶段都优先于 `allow`，这就是它是这条规则正确形式的原因：它不是可配置的
偏好，而是容器结束的地方。

拒绝并没有剥夺 agent 的能力——而是**重定向**。dev agent 一直都是这样做的（`agent_io.ex` 提议
`git_push`）；改变的是现在它被保证了，而不只是约定。受保护分支上的合并仍按
[RN-014](../business-rules.md#rn-014) 手动进行，不受影响。

### 4. 网络是**容器**的姿态，只决定一次——而不是逐条命令 {#4-rede-é-postura-do-container-decidida-uma-vez--não-comando-a-comando}

这是针对网络所要求的独立裁决所产生的决定，它与直觉所提示的相反。

诱惑会是把出站加入 allowlist：禁止 `curl`、`wget`、`npm install`。**这恰恰是 Z 和 AD 证明不会收敛的尝试。**
出站 allowlist 会与动词 allowlist 有同样的形式、同样的规模和同样的命运。

因此网络**只决定一次**，在 artifact 中，在内核理解的边界上：`network: none` 是默认值，正是它让“内部 agent
是自由的”成为一句安全的话——在一个没有出口的地方自由。`egress` 是正当的请求（一个要下载依赖的技术栈没有它
就无法工作），Arquiteto 带理由声明，而**授权者是用户**，在开通时——与授权并行上限的理由相同
（[ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)）：访问互联网既是花费，也是攻击面。

**花费**得到同样的处理：artifact 中的 `cpus`、`memoryMb` 和 `pidsLimit`，带硬上限。`pidsLimit` 值得一提——
它能遏制 fork bomb 而不依赖任何动词 allowlist，是边界不再是词法的之后所改变之物最清晰的例子。

**token** 上限不变：仍然是项目、会话和 task。

## 本 ADR 不做什么 {#o-que-este-adr-não-faz}

**容器的生命周期（25b）。** 开通、停止、回收、清理；镜像变化时发生什么；什么能在重启后存活；agent 的
worktree 改为住在容器内部。

原因是具体的，而不是缺少设计：**容器状态需要表**。容器 id、状态、使用中的镜像、何时启动、对应 artifact 的
哪个版本——这些都不是事件，而是可变状态，把它硬塞进 event log 就是因为合适的工具被占用而使用了错误的工具。
这一波唯一的 migration 名额属于另一个阶段。

交付半个开通比不交付更糟：**一个能启动却不回收的容器比没有更糟**——它会累积，没人知道它属于谁，而第一个被
决定的镜像实际上会变成永久的。

**这一裁剪的诚实后果：**“内部 agent 是自由的”那一半**尚未生效**。ADR 0055 的终端策略保持原样——路径作用域、
狭窄的 allowlist、在作用域内放宽的 `cd`。在墙存在之前就放松，就是重复本文档前来纠正的错误，而 FASE 13 已经
写下了结论：通往自主的道路不在于放松策略。本阶段交付的是边界**外部**的那一半——需要先生效、而不是后生效的
那一半。

## 后果 {#consequências}

**现在改善了什么。** 镜像决策存在，有主人、版本和理由；代码页的闸门是真实的，并在四个路由上经过测试；而
push/PR/部署的第二扇门关上了——在它真正存在之前，这是关门的正确时机。

**对运维者改变了什么。** 现有项目**没有**镜像决策，因此代码页会返回 409，直到 Arquiteto 运行。这是一个刚刚
上线的表面（ADR 0060）的可观察行为变化，这就是这次变更诞生在 `breaking/` 中的原因：已经在用这个标签页的人
需要知道它为什么关了。

**失去了什么。** 执行上什么都没失去：没有任何原本能工作的命令停止工作，因为通过终端 `git push` 从来不是
dev agent 推送的方式。失去的是为 push/PR/部署配置一个终端捷径的*可能性*——而失去这一点正是目的。

**仍欠着的，已测量。** 从内部指向外部的 symlink **仍未被检测到**。本 ADR 没有关闭这个向量；它决定了如何关闭
（墙），并交付了墙所需要的镜像决策。在容器启动之前，0055 的弱点继续有效，这一点写在这里，而不是被误认为已经
解决。

## 考虑过的替代方案 {#alternativas-consideradas}

**现在放松策略，之后再启动容器。** 以本项目最有力的论证被拒绝：这字面上就是 FASE 13 结论的反面。没有墙的
自由是漏洞，不是解决方案。

**网络出站 allowlist。** 因 Z 和 AD 被拒绝：它会与动词 allowlist 有同样的形式和同样的命运。网络是容器的
属性。

**把镜像作为项目配置（列、`.env`、设置界面）。** 被拒绝，因为它从 Arquiteto 手中拿走了用户交给它的决定，
也因为配置没有理由。必需的 `rationale` 正是让决策可以被复审、而不是变成考古的东西。

**现在就建一张 `project_containers` 表。** 它是容器**状态**的正确设计，也正因如此它要留给有 migration 名额的
那一波。为了不等待而在 event log 中临时拼凑状态，紧接着就会产生修正用的 migration。

**在终端上用 `require_approval` 而不是 `deny`。** 因“总是允许”被拒绝：它会把模式写入 `allow`，一次点击就足以
让第二扇门永久敞开。

## 参考 {#referências}

- [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md)——本文档修订的策略，它自己声明了这项待办。
- [ADR 0060](0060-superficie-de-leitura-de-codigo.md)——代码页，这项决策关闭了它的闸门。
- [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)——授权花费的是为项目负责的人；网络遵循同样的标准。
- [ADR 0045](0045-reagendamento-por-evento-do-dev-agent.md)——worktree 是按 **agent** 的，而不是按 task；
  改为住在容器内部的是它。
- [RN-014](../business-rules.md#rn-014)、[RN-092](../business-rules/custo.md#rn-092)、
  [RN-105](../business-rules/autenticacao.md#rn-105)、[RN-106](../business-rules/autenticacao.md#rn-106)。
- `docs/explanation/achados-execucao-real.md`——发现 Z、AD 和 AE。
- `apps/api/src/domain/containers/project-container.ts`、
  `apps/api/src/domain/actions/external-effect.ts`、
  `apps/api/src/application/use-cases/containers/`、
  `apps/engine/lib/engine/harness/tools/choose_project_image.ex`。

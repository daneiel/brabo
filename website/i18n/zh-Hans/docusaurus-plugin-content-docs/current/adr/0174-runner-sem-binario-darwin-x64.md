---
traducao_de: 153a82109c8bd8c3a907dc2603c40953ecb4b4c1
---

# 0174 — runner 的独立二进制不再承诺 Mac Intel

## 状态 {#status}

**已接受。** 维护者于 2026-09-27 决定（AT-065，HS-035）。引用 [ADR 0112](0112-binario-standalone-do-runner-via-bun-build-compile.md)（通过 `bun build --compile` 的独立二进制，诞生时有五个目标）、[ADR 0106](0106-distribuicao-do-runner-via-tsup-e-npm-publish.md)（npm 包，它成为 Mac Intel 的路径）和 [ADR 0149](0149-assinatura-dos-artefatos-publicados.md)（覆盖二进制的已签名 `checksums.txt`）。三者都不编辑。

## 背景 {#context}

ADR 0112 承诺了五个目标——`linux-x64`、`linux-arm64`、`darwin-x64`、`darwin-arm64`、`win32-x64`——每个都在自己的原生 runner 上构建。`darwin-x64` **从未发布过**，原因在两层上测得：

1. **没有可用的 Intel runner。** 标签 `macos-13` 指向 GitHub 已经退役的镜像（2025-09-19 的 changelog，2025 年 12 月结束）。在现有的三个 tag（`v4.0.0`、`v4.0.1`、`v5.0.0`）中，作业在队列中停留了 **24h00m01s**，被 Actions 的上限取消——三者是**同一个**数字，也就是说，它从未被调度过。在一次 `workflow_dispatch` 演练中（2026-09-13，run `34769280227`），它在队列中停留了 30 分钟，同样没有 runner。
2. **替代品能调度、能构建，却失败。** GitHub 提供的替代 Intel 标签 `macos-15-intel` 在 3–22 秒内调度（五次运行），并**构建**了二进制，但在 `--self-test-pty` 上失败：在 Bun 下，`node-pty` 的 `onData` 从不交付子进程的输出——运行时的未解决 bug [oven-sh/bun#25822](https://github.com/oven-sh/bun/issues/25822)，没有已修复的发布版本。**同样**的证明在同一个 runner 上用 **Node** 通过（run `34770476634`）。

第二次测量改变了这一待办的性质：阻塞不再是 runner（付费买一个 Intel runner 解决不了），而是 Bun。剩下两条出路——等 Bun 修复后再换标签，或者去掉该平台——而 `CLAUDE.md` 把它记录为所有者的决定。

与此同时，五个目标的承诺在四个地方产生代价：矩阵排队一个从不运行的作业；`ALVOS_ESPERADOS` 让每个 `checksums.txt` 永远宣告缺少一个已知不会到来的目标（[RN-565](../business-rules.md#rn-565)）；代理 `GET /runner-releases/binary` 接受 `darwin-x64` 只是为了响应 502 `plataforma_nao_publicada`；而 `install.sh` 向 GitHub 请求一个返回 404 的资产——输出与“Release 没有发布”相同，与不完整的 Release 无法区分。

## 决策 {#decision}

**该平台退出。** 独立二进制改为承诺**四个**目标，Mac Intel 走 npm 路径——`npm install -g @brabo/runner`，它在 Node 下运行，在那里 `node-pty` 的证明能通过。

- `build-runner-binaries.yml` 把 `darwin-x64` 从矩阵和 `ALVOS_ESPERADOS` 中去掉。`checksums.txt` 开始只声明真正失败的缺失。
- 代理 `GET /runner-releases/binary` 接受这四个，并以**专门的 400**——而不是通用的“plataforma inválida”——拒绝 `darwin-x64`，点名本 ADR 和 npm 命令，不调用 GitHub。
- `install.sh` 在 `darwin-amd64` 上**不尝试下载**：它用文字说明 Mac Intel 没有二进制、安装的其余部分已经就绪以及 npm 命令是什么，并把 `RUNNER_BIN` 留空——收尾（[RN-547](../business-rules.md#rn-547)）本来就用这个信号报告密钥和服务的待办。安装本身在 Mac Intel 上仍受支持（为 `darwin-amd64` 固定的 `cosign` 保留），只是本地 agent 的二进制退出。
- 浏览器继续**检测** `darwin-x64`——检测 Mac Intel 是真实的，正是它让我们能说出正确的路径——但二进制步骤不请求下载：它预先失败，落入 [RN-473](../business-rules.md#rn-473) 的同一个尽力而为（`falhaDoBinario` → npm 命令）。
- `scripts/ci/alvos-do-runner.spec.ts` 用三种语言把枚举目标的四个地方绑在一起：矩阵、api 的列表、安装程序的 `case` 和浏览器的列表。在一个地方去掉（或加回）一个目标而忘了另一个，就会失败。

## 考虑过的替代方案 {#alternatives-considered}

- **等待 Bun 并把标签换成 `macos-15-intel`。** 承诺没有期限，而单独换标签并不会让目标发布——只是把 24 小时的排队换成每个 tag 一个红色作业。它仍然是回去的路（见下文），而不是今天的决定。
- **从 `darwin-arm64` 交叉编译 `darwin-x64`。** ADR 0112 拒绝交叉编译原生插件，而且 `self-test-pty` 不会在目标架构上运行——会发布一个没人证明过的二进制。
- **付费买 Intel runner。** 测量表明阻塞是运行时而不是机器：同样托管的 `macos-15-intel` 能构建，却失败。

## 后果 {#consequences}

- 独立二进制的承诺是四个目标，而 Release 继续只收到**两个**（`linux-x64`、`linux-arm64`），直到某个 tag 演练已经在 `dev` 中的 `win32-x64` 和 `darwin-arm64` 修正。本决定不涉及这一点。
- 使用 Mac Intel 的人需要安装 Node 才能拥有本地 agent。`install.sh` 和浏览器面板用文字说明这一点；两者都不会自行安装 Node。
- **未测量，已声明：** Bun 的 issue 是在 darwin ARM64 上开的。在 `spawn-helper` 修复之后，`darwin-arm64` 很可能会碰上同样的缺陷。如果发生，本 ADR 是先例，而不是自动的答案——决定 `darwin-arm64` 是另一个决定。
- **回去的路：** 当 Bun 在某个发布中修复了 `node-pty` 的 `onData`，重新接回该目标需要一个新的 ADR，把标签换成 `macos-15-intel`，以空 `tag` 运行 `workflow_dispatch` 演练，并把 `darwin-x64` 加回 spec 绑定的四个地方。

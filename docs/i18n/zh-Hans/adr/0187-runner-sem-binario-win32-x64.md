---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0187 — runner 的独立二进制不再承诺 Windows

## 状态 {#status}

**已接受。** 维护者于 2026-09-30 决定，并于 2026-10-01 确认（AT-343）。沿用 [ADR 0174](0174-runner-sem-binario-darwin-x64.md) 的模子——它以同样的方式去掉了 Mac Intel——并引用 [ADR 0112](0112-binario-standalone-do-runner-via-bun-build-compile.md)（通过 `bun build --compile` 的二进制）、[ADR 0106](0106-distribuicao-do-runner-via-tsup-e-npm-publish.md)（npm 包，它成为 Windows 的路径）和 [ADR 0150](0150-instalador-de-uma-linha.md)（`install.sh`，它本来就整体拒绝 Windows）。都不编辑。

## 背景 {#context}

自 ADR 0174 起，矩阵承诺四个目标，而 Release 只收到两个 Linux 的。`win32-x64` 在 `dev` 中有从未演练过的构建修正，而以空 `tag` 运行的 `workflow_dispatch` 演练（不附加任何东西的模式）演练了它。层层问题一个个倒下，而最后一个不属于 runner：

1. **Run `36775746724`**——二进制能**构建**，在不带参数使用时以代码 1 退出：`realpathSync` 中的 `ENOENT`。runner 只认识 Linux/macOS 编译二进制的虚拟路径（`/$bunfs/root/`）；Windows 的是 `B:/~BUN/root/`。已修正（AT-343，`apps/runner/src/binario-compilado.ts`）。
2. **Run `36779817686`**——用法通过，`--self-test-pty` 以 `Cannot find package 'node-pty'` 失败：加载器收到的是**不带**冒号的形式（`B/~BUN/root/`），落入普通的 `import('node-pty')`。已修正。在同一次运行中，`darwin-arm64` 和两个 Linux 使用 AT-342 自己的 PTY 读取器**通过**了（[RN-688](../business-rules.md#rn-688)）。
3. **Run `36780804339`**——`node-pty` 能加载，而从 `cmd.exe` 只到达 ConPTY 的初始序列（`ESC[?9001h ESC[?1004h`），连提示符都没有。自测增加了一个不依赖输入的**探针**，以区分输入和读取。
4. **Run `36781729045`**——探针作出判定：在第二个 PTY 中的 `cmd.exe /c echo` 交付 **1 块**（同样的两个序列），读取流给出 `end,close`，子进程以 `-1073741510` 退出——**0xC000013A**（`STATUS_CONTROL_C_EXIT`）。在 Bun 下，ConPTY 输出命名管道之上的 `net.Socket` 在第一块之后就结束；`node-pty` 把管道的结束当作终端的结束，关闭伪控制台，而 Windows 杀死子进程。不涉及输入——即使一个只写输出的命令也会死。

这与去掉 Mac Intel 的 [oven-sh/bun#25822](https://github.com/oven-sh/bun/issues/25822) 是同一家族：`node-pty` 之下 Bun 的流层。在 Unix 上它有绕过方法（主端的 fd 是普通 fd，AT-342 用 `fs.read` 读取它，在 `EAGAIN` 上等待）；在 Windows 上，读取端是 `node-pty` 自己作为 `net.Socket` 打开的命名管道，没有 runner 能从外部读取的 fd，除非重写 `node-pty` 的 Windows 那一半。在 **Node** 下，同一个 `node-pty` 就是 VS Code 在 Windows 上使用的那个。

## 决策 {#decision}

**该平台退出。** 独立二进制改为承诺**三个**目标（`linux-x64`、`linux-arm64`、`darwin-arm64`），Windows 走 npm 路径——`npm install -g @brabo/runner`，在 Node 下。ADR 0174 的同样四个地方一起改变：

- `build-runner-binaries.yml` 把 `win32-x64` 从矩阵和 `ALVOS_ESPERADOS` 中去掉。`checksums.txt` 只声明真正失败的缺失。
- 代理 `GET /runner-releases/binary` 接受这三个，并以**专门的 400** 拒绝 `win32-x64`——点名本 ADR 和 npm 命令，不调用 GitHub——放在与拒绝 `darwin-x64` **同一张**表中（`SEM_BINARIO_POR_DECISAO`，可读的名称以及按平台的 ADR）。
- `install.sh` 本来就在任何下载之前整体拒绝 Windows（ADR 0150），并继续如此：拒绝开始也**说明**那里的本地 agent 是 npm 包，点名本 ADR。`instalar_o_runner` 的 `case` 从来没有 `win32-x64`，也不会增加。
- 浏览器继续**检测** `win32-x64`，并不请求下载：它进入 `SEM_BINARIO_PUBLICADO`，预先失败并落入一贯的尽力而为（`falhaDoBinario` → npm 命令，[RN-473](../business-rules.md#rn-473)）。
- `scripts/ci/alvos-do-runner.spec.ts` 把这四个地方绑在一起，并开始拒绝矩阵中的 `windows-latest`。

演练产生的 Windows 修正（三种形式的虚拟路径、`node-pty` 的加载器、自测中的 `cmd.exe` 以及探针）**保留**：它们是回去之路的起点，对其他目标没有任何代价。

## 考虑过的替代方案 {#alternatives-considered}

- **保留目标并发布让终端失败的二进制。** 不带参数的用法能通过，但 Code 标签页的交互式终端会在第一块输出时死掉，子进程被 Ctrl+C 杀死。发布一个已知在其存在理由的功能上坏掉的二进制，比不发布更糟。
- **像 AT-342 在 Unix 上那样，在 `node-pty` 之外读取 ConPTY 的管道。** 这需要重新实现 `node-pty` 的 Windows 那一半（管道在它内部打开和连接），而针对运行时一个未解决的 bug 做这么大的绕过，是没有期限的债务。
- **只为 Windows 更换二进制的运行时（Node SEA）。** 这会为一个目标改变 ADR 0112 的分发机制，带来第二条构建和证明路径。这是比本决定更大的决定，如果 Bun 不修复，可以放在独立的 ADR 中。

## 后果 {#consequences}

- 独立二进制的承诺是**三个**目标，三者都已在演练中**证明**（runs `36779817686` 和 `36805241339`，后者已经是三个目标的矩阵）。在下一个最终 tag 演练 `darwin-arm64` 之前，Release 继续收到两个。
- 使用 Windows 的人需要安装 Node 才能拥有本地 agent，而用户服务仍然不在其中（ADR 0147 第 5 点）。浏览器面板用文字说明这一点；`install.sh` 也是。
- **回去的路：** 当 Bun 在某个发布中修复命名管道的流时，重新接回该目标需要一个新的 ADR，把 `win32-x64`/`windows-latest` 加回矩阵以及 spec 绑定的四个地方、代理中带 `.exe` 的名称，并以空 `tag` 运行 `workflow_dispatch` 演练——`--self-test-pty` 的探针会立刻说明读取是否恢复了。

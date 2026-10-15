---
traducao_de: 1ecc3883c1af3f1d2b34548c4e0fc82480119d61
---

# ADR 0128 — Docker 端口，以及选定实现的打包证明

## 背景 {#context}

在真实容器中执行的计划有两个需要与 Docker daemon 对话的地方：**runner**（用户机器上的 Docker，用于 `runner`
模式的项目）和一个即将诞生的服务器端 **broker**（PR 1.2，用于 `container` 模式的项目）。api 永远拿不到
socket，这是已定的决定。

库的选择以一次证明为条件，而不是以偏好为条件。`dockerode` 是事实上的 Docker Node 客户端，但 runner 通过**三**
条路径分发——克隆 monorepo、`npm install -g @brabo/runner`（ADR 0106）以及通过 `bun build --compile` 的独立
二进制（ADR 0112）——而第三条是三者中最脆弱的：它已经需要一个自己的清单生成器（`scripts/build-bin.mjs`）来
嵌入 `node-pty` 的 `.node`，因为 Bun 只嵌入通过**静态**说明符可达的文件。

`dockerode@5` 拖进来的依赖树很大——`docker-modem`、`ssh2`、`@grpc/grpc-js`、`protobufjs`、`tar-fs`——而
`ssh2` 带着一个**可选**的原生绑定（`cpu-features`）。因此有了产品负责人确定的顺序：**先证明，后设计**，两种
结果的决定都已写好——通过，`dockerode` 留下；失败，runner 退回到 `execFile('docker', …)`，本 ADR 把确切的
错误记录为理由。不打 bundler 补丁，也不加 shim：这里一个有创意的变通办法，会变成以后没人看得懂的债务。

## 决策 {#decision}

### 证明，以及它的结果 {#a-prova-e-o-que-ela-devolveu}

`dockerode@5.0.1` + `@types/dockerode@4.0.1` 进入了 `apps/runner`，带一个会**导入**、**实例化**
（`new Docker()`）并**调用**（`ping()`）的适配器——通过针对产物运行的 flag `--self-test-docker` 来执行，绝不
通过一个 bundler 可能删除的 `import`。

| 步骤 | 结果 |
|---|---|
| `pnpm --filter runner build`（tsup） | **通过**——但 `tsup` 把 `dependencies` 保留为外部 `require`（`jose` 如今就是这样存在的），所以 `dockerode` 根本没进入 bundle |
| `pnpm --filter runner smoke` | **通过**——`node dist/index.cjs --self-test-docker` 从 `node_modules` 解析了 `dockerode` 并与 daemon 通信 |
| `pnpm --filter runner build:bin`（`bun build --compile`） | **失败** |

错误，完整粘贴：

```
3 | const binding = require('../build/Release/cpufeatures.node');
                            ^
error: Could not resolve: "../build/Release/cpufeatures.node"
    at /…/node_modules/.pnpm/cpu-features@0.0.10/node_modules/cpu-features/lib/index.js:3:25
```

这条链是必然的，而不是偶然的——是在已安装的代码中读出来的，而不是假设的：

```
dockerode → docker-modem (lib/modem.js, linha 6: require('./ssh'))
          → ssh2 (lib/protocol/constants.js, linha 7: require('cpu-features'))
          → cpu-features/lib/index.js → require('../build/Release/cpufeatures.node')
```

`lib/modem.js` 在模块顶部执行 `require('./ssh')`：即使在这个只与本地 unix socket 对话的 runner 中，SSH 传输
也会进入依赖图。`cpu-features` 的 `require` 在 `ssh2` 内部被 `try/catch` 包住，并在**运行时**优雅降级——但
在这里解析依赖图的是**bundler**，在构建时，而 bundler 没有 `try/catch`。这与 ADR 0112 对 `node-pty` 记录的是
同一类问题，只有一个决定性的差别：那里的绑定是**必需的**（没有它就没有终端，所以值得构建嵌入机制），而这里是
一个我们不使用的传输的可选加速。

**测量过但没有采用，记录在案：** `bun build --compile --external
cpu-features` 能编译（280 个模块对 79 个），产出一个 84 473 032 B 的二进制（+1,7 MB），而 `dockerode` 在其中
**能工作**——`ping` 能针对真实 daemon 响应，因为 `ssh2` 的 `try/catch` 吞掉了 Bun 留在原处的 stub。写下这些，
是为了不需要任何人重做这次调查，而它恰恰是产品负责人的决定事先排除的变通办法：它把一棵死掉的 SSH 树中的一个
可选 `.node` 拖进每个平台的五个二进制里，半年之后这笔债就会无法辨读。

**因此：runner 使用 `execFile('docker', …)`。** `dockerode` 已从 `package.json` 和 lockfile 中移除；依赖树中
没有留下它的任何东西。broker（PR 1.2）**不**继承这个决定——它运行在我们构建的镜像中，永远不会变成独立二进制，
因此 `dockerode` 在那里仍是候选，而下面的端口恰恰为此而存在。

### 尺寸，经测量 {#tamanhos-medidos}

| 产物 | 之前 | 之后 | 增量 |
|---|---|---|---|
| `dist/index.cjs` | 91 843 B | 106 221 B | +14 378 B（+15,7 %） |
| `dist-bin/brabo-runner-linux-x64` | 82 777 288 B | 82 789 576 B | +12 288 B（+0,015 %） |

增长是新代码（端口 + 适配器 + 自测），不是依赖：`execFile` 来自 `node:child_process`，没有要嵌入的依赖树。作为
对比，被拒绝的替代方案的代价是**每个二进制 +1,7 MB，乘以五个平台**。

### 端口 {#a-porta}

`apps/runner/src/docker-port.ts`，采用仓库已用于隔离外部供应商的两个契约的同一形式（ADR 0041 的 `LLMProvider`
和阶段 2 的 `GitProviderContract`）：抽象类、领域自己的类型、按**类**归一化的错误——消费者按错误的类型做决定，
绝不按供应商消息的子串。

**五种操作，而不是六种：** `start`、`stop`、`remove`、`inspect`、`exec`。

**约束在于类型，而不在于调用者的纪律。** 端口不允许**写出**的那一半才是要紧的：

- `privileged` 和 `cap_add`——不存在这样的字段，也没有任何库的类型穿过端口：规格是**封闭**的，组装 payload 的
  是适配器。没有地方可以复制这个选项；
- `network: host`——`RedeDoContainer` 是联合类型 `'none' | 'egress'`，与 ADR 0065 的边界姿态相同。`host` 不是
  该类型的值，所以不是一句能说出口的话；
- **自由的 bind-mount**——没有挂载的**列表**。只有**一个**文件夹，目的地是常量 `PONTO_DE_MONTAGEM`（`/work`），
  而文件夹的类型是**品牌**类型（`RaizDeProjeto`）：只有 `raizDeProjetoValidada()` 能产生这种类型的值，它拒绝
  相对路径、带 `..` 的、带 NUL 的、文件系统根以及系统文件夹（`/etc`、`/var`——Docker 自己的 socket 就住在
  那里——、`/dev` 以及其他）。在这里挂载 `/` 不是“不推荐”：它编译不过。

**没有任何操作接收容器 id。** 全部都从 `workspaceDirName`（RN-109，创建时冻结）出发，推导出
`brabo-<workspace_dir_name>`，并通过按名称**且**按标签 `brabo.managed=true` **过滤**的 `docker ps` 来解析。
“停止容器 X”（X 任意）不是这个端口听得懂的一句话——而没有标签的同名容器会返回 `ContainerNaoGerenciadoError`，
绝不是 `null`：把它当作不存在，会让 `start` 试图在其上创建并以 “name already in use” 失败，这条消息对唯一真正
发生的事只字不提。

**端口住在哪里，以及为什么。** 在 `apps/runner/src/` 中，因为 runner 是如今唯一存在的消费者。`packages/shared`
被考虑过并被拒绝，原因是该包自己声明、且由 api 的一个测试（`packages-shared-so-tipos.spec.ts`）保持诚实的一个
不变量：它 100 % 是**类型**，那里不能有任何东西在 `tsc` 之后幸存，因为 `main` 指向原始的 `.ts`，api 的生产镜像会
死于 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`。一个带错误类和校验函数的端口是运行时代码。把契约拆成
“类型在那里，错误在这里”会为一件事创造两个来源——这正是端口存在要避免的缺陷。当 `apps/broker` 诞生时，这个文件
会**移动**到一个 workspace 包中；它不会被**复制**，这写在它的 docblock 中，因为一个有同样五种操作外加一个“只在
broker 中”的第六种的第二个文件，就是上述约束终结的开始。

### 失败分类 {#classificação-de-falha}

三种具名结果，使用产品的词汇（`infra | modelo | código |
política`），以及刻意**没有**来源的第四种：

| 类 | 来源 | 何时 |
|---|---|---|
| `DockerIndisponivelError` | `infra` | daemon 没有响应。消息说明该**做**什么（`docker info`，Linux 上的 `docker` 组），并说明没有任何容器被触碰 |
| `DockerCliAusenteError` | `infra` | `docker` 可执行文件不在 `PATH` 中。这是**独立**的错误，而不是“daemon 宕机”：两者的修复方式不同，把它们合并就是在低一层重犯 RN-475 的教训 |
| `ContainerNaoGerenciadoError` | `política` | 存在一个带推导名称、**没有**标签 `brabo.managed=true` 的容器 |
| `ComandoDeDockerFalhouError` | *无* | daemon 活着并拒绝了命令。它的消息完整地带上 |

第四种有意不声明来源：在 infra 和代码之间为 “No such image” 选一个，会是排除法诊断，正是 ADR 0020 记录为不可
重犯的缺陷。它说明自己是其余情况，并展示 daemon 说了什么。

“daemon 宕机”与“daemon 拒绝”之间的区分由**命令**做出，而不是由子串：任何非零输出都会触发一次确认用的
`docker version`，由**它**的结果决定类别。只在失败路径上多花一次调用——这是不按供应商文本分类的代价，ADR
0002（git）和 ADR 0041（LLM）已经从另外两侧禁止了按文本分类。

## 后果 {#consequences}

**还没有任何东西启动容器，这就是范围。** 端口存在，适配器存在，而没有人调用它们：Phoenix 通道中没有新消息，没有
可观察行为的变化。`start`/`stop`/`remove`/`inspect`/`exec` 在 `docker-cli.spec.ts` 中由测试替身覆盖，而**没有
一个**针对真实 daemon 执行过——只有 `ping` 执行过，经由 `--self-test-docker`。这与“能力只有在被证明时才声明”是
同一种纪律：证明这五个的是 PR 1.3，它把它们接到通道上。

**runner 开始要求 `PATH` 中有 `docker` 二进制，而不只是 socket。** 在运行 Docker 的人的机器上这几乎总是成立，
而它的缺失有自己的错误。这是这个选择与被拒绝的那个之间最显眼的差别：`dockerode` 直接与 socket 对话，不需要
CLI。

**CLI 的输出是文本，而文本不是有版本的契约。** 每次读取都使用 `--format '{{json .}}'` 和宽容的 `JSON.parse`
（无法读取的行变成 `null`，绝不抛异常），绝不按列切割。CLI 的版本是用户机器上的那个，因此不使用任何奇特的
flag——只用存在了许多版本的选项。即便如此：`docker ps` 格式的变化会弄坏读取，这是 `dockerode` 不会有的风险。

**`exec` 的超时杀死的是客户端，而不是命令。** 因超时而结束的 `docker exec` 会让进程在容器**内部**继续运行，而
没有第二次 exec 和这条路径不知道的 PID，就无法杀死它。输出会**说明**这一点，而不是让读者以为命令已经死了。

**这里没有诞生任何 RN，并且已声明。** 没有可供规则描述的可观察行为：产品不调用这个端口。要登记的规则——只有带
`brabo.managed=true` 的容器会被停止、删除或用作 `exec` 的目标——会在真正让容器启动的 PR 中诞生，连同覆盖它的
测试证据。

**证明保持鲜活。** `--self-test-docker` 在两个 smoke（`pnpm --filter runner smoke` 和 `smoke:bin`）中运行，并
在自测的**两种**结果下都通过——daemon 响应了、daemon 没响应——因为问题是关于**产物**而不是关于机器的：要求
daemon 会让 smoke 恰恰在最需要它运行的地方（CI，那里没有给 runner 用的 Docker）停止运行。从今往后它保证的是：
端口完整地进入 `dist` 和二进制，而缺少 Docker 会变成**具名**错误，而不是原始的堆栈跟踪。

**没有人应该重做的事。** 如果有一天有人再次提议在 runner 中使用 `dockerode`，答案已经在上面测量过了：它会弄坏
`build:bin`，而让它放得进去的唯一已知路径就是被拒绝的 `--external cpu-features`。在 **broker** 中，问题是另一个，
并且仍然开放——那里没有独立二进制，而端口正是让第二个答案成为一次实现而不是一次重写的东西。

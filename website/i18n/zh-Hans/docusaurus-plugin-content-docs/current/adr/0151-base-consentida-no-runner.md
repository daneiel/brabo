---
traducao_de: 213fbcc7470e8f4bae01648d030a1e3437751cf6
---

# ADR 0151 — runner 中经同意的基础目录，以及通过通道创建文件夹

## 状态 {#status}

**Proposed.** 刻意收窄的切分：**按机器**的 runner 不在
[FASE 29](../explanation/fase-29-instalacao-de-uma-linha.md) 范围内，并被声明为下一阶段的范围，测量已经完成（见
Consequences）。

## 背景 {#context}

产品方向是用户在 web 上选择一个项目，然后**看到文件夹出现**在自己的机器上。今天这并不会发生，原因不是缺少 agent——`brabo-runner` 已经住在那里。而是它诞生时不知道东西放在哪里。

**runner 没有基础目录。** 唯一的根是 `--dir`，由 `resolverDir`
（`apps/runner/src/guard.ts:221-227`）相对于 `INIT_CWD ?? process.cwd()` 解析；没有
`--dir` 时，根**就是 cwd**（`apps/runner/src/index.ts:242-250`）。`estado.dir`
（`index.ts:366-368`）是*一个*路径，单数，正是它被传给
`validarCwdDentroDaRaiz`、`GerenciadorDePty`、`cwdParaContainer` 和
`workspace_confirm`（`index.ts:725`）。`apps/runner/src/` 中没有基础目录的常量、环境变量或字段——这个词只出现在注释中。

**基础目录存在，但在 api 中，而且被禁止下沉。**
`apps/api/src/infrastructure/filesystem/project-workspaces-root.ts` 有
`baseDeProjetos()`（`:68`）、`dentroDaBaseDeProjetos`（`:93`）和
`segmentoSobABaseDeProjetos`（`:116`）——而同一文件**以书面形式禁止**
（`:421-438`）基础目录规则进入 `caminhoDeWorkspaceLocalValido`，因为该谓词在**每次读取**时运行，一个位于基础目录之外的遗留挂载项目在被读取时会崩溃。基础目录是**创建和转换**的规则。

**有一个确切的姊妹守卫先例。** `apps/runner/src/espelho-guard.ts`
诞生时复用了 `guard.ts` 的三个辅助函数（`:51`），并按**段**实现循环拒绝——`dentroDoEscopo(destino, workspace)` 和
`dentroDoEscopo(workspace, destino)`（`:214`、`:223`）——从不使用原始 `startsWith`，原因写在 `:152-154`：*"`/base-outra` NÃO está dentro de
`/base`"*。

**还有一个本 ADR 不能打破的不变式。** 自
[ADR 0130](0130-broker-de-container.md) 起，没有任何绝对路径穿过网络：拥有根的是执行者，传输的是**相对段**，外加一个说明它针对哪个根有效的判别值
（[ADR 0144](0144-a-segunda-raiz-do-broker.md)）。

## 决策 {#decision}

### 1. runner 诞生时带有一个在安装程序中经同意的基础目录 {#1-o-runner-nasce-com-uma-base-consentida-no-instalador}

`install.sh`（[ADR 0150](0150-instalador-de-uma-linha.md)）同意**一个**基础目录，并把它写入 runner 的本地配置。每个项目是它的一个**子文件夹**。`--dir` 继续存在，并继续表示它一直表示的含义——它是 RN-514 的遗留二进制，打破它将是没有收益的 `breaking/`。

基础目录是**本地**的，从不从网络接收。与 broker 的设计相同（ADR 0144）：根属于执行者；服务器发送**段**。

### 2. 守卫复用尺子，而不是复制它 {#2-a-guarda-reusa-a-régua-não-a-copia}

基础目录和子文件夹的验证复用 `guard.ts` 的 `semBarraFinal`、`dentroDoEscopo` 和
`realpathMaisProximo`——它们正是为此而导出的（`guard.ts:33-43`，在 `espelho-guard.ts` 诞生时）——以及 `espelho-guard.ts:208-233` 的按段循环拒绝。**不会诞生第四份尺子拷贝**：RN-515 已在 api 一侧确立了这一点，当时
`validarDestinoDeEspelho` 复用了 `caminhoDeWorkspaceLocalValido`
（`apps/api/src/application/services/workspace-location.ts:132-136`），而没有重写它。

以书面形式继承 `guard.ts:9-31` 和
`espelho-guard.ts:30-39` 同样的 TOCTOU 告诫：这是尽力而为的，不是安全边界，安全边界仍然是认证加审批流水线。

### 3. 新消息请求创建，确认复用已有的东西 {#3-a-mensagem-nova-pede-a-criação-e-a-confirmação-reusa-o-que-já-existe}

通道中新增一对，采用**带响应的请求**模式（`exec`/`exec_result`，
`terminal_channel.ex:563-567` 和 `:737-749`），因为请求方需要知道是否成功：

- `workspace_create`——engine → runner：`projectId` 和**相对于基础目录的段**。绝不是绝对路径。
- `workspace_create_result`——runner → engine：成功并附带最终路径，或**带名称**的错误。

runner 执行 `mkdir -p`，然后 `git init` 或 clone。成功后，它发送**已存在的 `workspace_confirm`**（`channel.ts:577-582`），由它来写入——经由已构建并测试过的路径：通道 → engine → 内部 HTTP
→ `ConfirmProjectWorkspaceUseCase`，它重新验证词法
（`confirm-project-workspace.use-case.ts:83`），是幂等的（`:93-95`），并写入
`workspaceVerifiedAt`。

这是刻意的，并省掉了一整条战线：**不诞生新的写入路由**，engine 继续**不写这张表**，唯一给 `workspace_verified_at` 盖章的路径仍然只有一条。

为精确起见做个记录，因为这个名字曾流传：**`workspace.verified` 在仓库中不存在**——既不是事件，也不是消息，也不是路由。存在的是事件 `project.workspace_verified`（`confirm-project-workspace.use-case.ts:107`）和列 `workspace_verified_at`。而 `workspace_confirm` 是**单向**的：
`terminal_channel.ex:356-373` 回复 `{:noreply, socket}`，不往回推送任何东西——这就是新的一对不能基于它建模的原因。

### 4. 只有实现了才声明能力 {#4-capacidade-declarada-só-quando-implementada}

`workspace` **在代码加入的那次会话中**进入 `Engine.Runners.Capacidades` 的词汇
（`capacidades.ex:72`），绝不提前——这是 RN-514 的教训，在那里不实现就声明 `espelho` 恰恰会是协商机制存在所要防止的静默缺陷。未知名称继续被忽略；被要求但未声明的能力继续以缺失项的名称拒绝 join。

### 5. 专属谓词，`RunnerReadiness` 逐字节不变 {#5-predicado-próprio-e-runnerreadiness-fica-byte-a-byte}

两个前置条件——runner 已连接、基础目录已同意——放在一个**专属**模块中，采用 `Engine.Runners.Espelho` 的模式（`espelho.ex:82-99`）。**不**要求容器：创建文件夹是用户机器上的文件系统操作，没有可以从中掉落的容器。

诱惑与拒绝都已写下，本 ADR 逐字采纳
（`espelho.ex:19-24`）：

> A tentação óbvia seria `RunnerReadiness.verificar(project_id, pular_container:
> true)`. O ADR 0147 recusa isso por escrito, e a razão é mecânica: uma função
> compartilhada com flag "pula container" é precisamente o caminho pelo qual a
> terceira pré-condição cai POR ACIDENTE para o `exec` numa refatoração futura
> — e o ADR 0145 existe para ela não cair.

### 6. 不是 `proposed_action` {#6-não-é-proposed_action}

创建用户刚刚请求的项目文件夹是**经同意的配置**，而不是 agent 请求行动。这些都不会变成 `proposed_action`，策略中也没有任何上限获得例外——与镜像已经确立的同一条线（RN-516）。

### 7. web 通过 runner 读取基础目录 {#7-a-web-lê-a-base-pelo-runner}

`runner` 模式下的创建选择器使用 `fs_list_dir`，它在两侧都存在（`apps/runner/src/fs-browser.ts:53`、
`terminal_channel.ex:489`），而它在 web 中的传输
（`apps/web/src/lib/fs-browser-channel.ts:66`）自 RN-504 起就**没有有效调用者**——按
`apps/web/src/routes/NewProjectWizard.tsx:880-882` 中声明的决定保留。它重新获得调用者。经由 api 的 `mounted` 模式路径
（`GET /workspaces/:workspaceId/project-folders`）保持**不变**。

## 本 ADR 明确拒绝的 {#o-que-este-adr-recusa-explicitamente}

- **本阶段的按机器 runner。** 见 Consequences：这是五个独立的耦合，与安装程序一起处理会把两个大风险集中在同一阶段。
- **带 flag 的 `RunnerReadiness`。** 理由见决策 5 的引文。
- **第四份路径尺子拷贝。**
- **穿过网络的绝对路径。** ADR 0130 的不变式。
- **把这件事与镜像合并。** 它们是不同的消息，方向和触发器都不同；镜像复制到基础目录之外，这个在基础目录之内创建。

## 后果 {#consequences}

- 用户在 web 上选择项目，文件夹就出现——无需终端，无需手动 `git init`。
- **runner 仍按项目配对。** 测得的五个耦合，FASE 30 必须穿越它们：主题 `terminal:<projectId>`
  （`channel.ts:422`、`terminal_channel.ex:172`）、socket id
  `runner_socket:<kind>:<project_id>:<user_id>`（`runner_socket.ex:71-73`）、按项目限定作用域的 ticket（`socket_ticket.ex:10-13`）、列
  `runner_device_keys.project_id NOT NULL`
  （`apps/api/src/db/schema/auth.ts:325`）以及 unit 的名称
  （`servico.ts:263-265`、`:392-394`）。其中一个是 migration；另一个是
  `breaking/`。
- **撤销仍然作用于 `{projeto, usuário}`**（RN-520），在本阶段保持当前成本。当 FASE 30 统一按机器的 runner 时，撤销将会断开那台机器上的**所有**项目——在此声明，免得在那时才被发现。
- 在 `runner` 模式下 `docker exec` 中被丢弃的 git 凭据
  （ADR 0130/0145）**不受影响**：本消息的初始 clone 在**宿主机**上运行，走带凭据的路径。缺口仍在原处。

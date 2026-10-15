---
traducao_de: 8430361a5eb1565035e5bda35db3531f112b2752
---

# ADR 0203 — 通过浏览器配置 runner 的流程退役，路径改为安装程序

## 状态 {#status}

**Accepted.** 2026-10-01（AT-014，`BRB-031`，第 36 轮；负责人 10月1日的决定：*"aposentar o fluxo do navegador do ADR 0118 — gerar chave, baixar
binário e gravar config pelo navegador; o caminho é o `install.sh`"*）。
在不编辑的前提下修订
[ADR 0118](0118-configuracao-automatica-do-runner-pelo-navegador.md)（通过浏览器自动配置 runner，RN-464..466），并关闭
`BRB-031`。保留 [ADR 0154](0154-chave-de-dispositivo-de-maquina.md)（两种密钥）、[ADR 0155](0155-a-primeira-conta-nasce-no-terminal.md)
（机器密钥在终端诞生，由安装程序登记，RN-547/551/552）以及 [ADR 0150](0150-instalador-de-uma-linha.md)（一行命令安装程序以及对自身来源的验证）。

## Context {#context}

ADR 0118 让浏览器**生成 Ed25519 密钥对**（Web Crypto）、**登记公钥**（`POST /projects/:projectId/runner-device-keys`）、**下载二进制文件**
（`GET /runner-releases/binary`），并通过 File System Access API **把三个文件写入**一个文件夹——或者在 Chromium 之外触发两次下载。它书面接受了一个限制：*"o navegador não preserva o bit de execução;
`chmod +x` em Linux/macOS continua manual"*。这是任何安装路径中最后一个手动步骤，也就是 `BRB-031`。

FASE 29 创建了没有这一步的第二条路径：`install.sh` 下载二进制文件，对照**已签名**的 `checksums.txt` 核对，并以
`install -m 0755` 安装（RN-531）。FASE 30 完成了机器一侧的配对：`brabo-runner device-key create` 在**机器上**生成密钥对（RN-551），安装程序用 service token 通过**机器**内部路由登记公钥（RN-552），并在安装结束时把两者串起来（RN-547）。从那以后，浏览器流程就成了**第二条**路径，折叠在 `RunnerOnboardingPanel` 的一个 `<details>` 中（RN-548），而让它退役被声明为维护者的决定，而不是那次交付的后果。

改动前在 `dev`（`ec0fbea52d`）上测量——谁在使用该流程所使用的东西：

- `apps/web/src/lib/runner-bootstrap.ts`（生成密钥对、导出 JWK、下载二进制、写入文件夹、手动套件）只有**一个**生产消费者，即 `RunnerOnboardingPanel`。在它之外，只有它自己的测试和
  `scripts/ci/alvos-do-runner.spec.ts`，后者把浏览器的平台列表当作枚举目标的第四个地方来读取。
- `registerRunnerDeviceKey`（`apps/web/src/lib/api-client.ts`）只被
  `runner-bootstrap.ts` 调用。
- `POST /projects/:projectId/runner-device-keys` 只被
  `runner-bootstrap.ts` 以及 `e2e/testes/chave-de-dispositivo.spec.ts` 调用，后者存在的目的**正是**证明在 Chromium 中生成的密钥。没有任何脚本、runner、workflow 或 `install.sh` 调用它——安装程序使用 `POST /internal/machine-device-keys`。
- 同一路由的 `GET` 和 `DELETE` 有**其他**消费者：设置中的密钥区块（RN-561）、面板的识别（RN-548）以及撤销。
- `PatAuthGuard` 按 `kid` 接受**项目**密钥，而真实安装中有通过浏览器流程登记的项目密钥。
- `GET /runner-releases/binary`（下载的代理）只有浏览器作为生产消费者。

## Decision {#decision}

1. **`RunnerOnboardingPanel` 指向 `install.sh`。** 面板的首要内容变成安装程序的命令
   （`curl -fsSLO …/install.sh && bash install.sh`，与 runbook 以及 `install.sh` 本身**相同**的语句，RN-526），可复制，并以文字说明它做什么——下载二进制、对照已签名清单核对、以可执行方式安装并配对机器——下方是 `EsperaDoRunner`（RN-474）。该命令是安装程序语句的 TS 副本，`scripts/dev/install-invocacao.spec.ts` 会拒绝产生分歧的副本。
2. **面板中**保留**的：** 对已配对密钥的识别（RN-548 以及**项目**密钥的识别，AT-107），带有同样的保留说明——并且在识别到服务该项目的密钥后，安装程序区块会**退出**。带 PAT 的手动命令（`--token`）留在 `<details>` 中，按它解决的情况重新命名为：
   *"Outra máquina, ou rodar manualmente"*。
3. **从 web 中**消失**的：** 整个 `runner-bootstrap.ts` 及其测试（通过 Web Crypto 生成密钥、通过浏览器下载二进制、通过 File System Access 写入以及两次下载的套件）、
   `registerRunnerDeviceKey` 和类型 `RunnerDeviceKeySummary`、流程中按钮和状态的 i18n 键，以及平台选择器。
4. **从 api 中**消失**的：** `POST /projects/:projectId/runner-device-keys`，连同 `RegisterRunnerDeviceKeyUseCase` 和只属于它的两个 DTO。它已没有调用者。**机器**内部路由（`POST /internal/machine-device-keys`）**保留**，JWK 的形式尺子（`exigirJwkPublicaEd25519`，在领域中）随它保留。
5. **已经登记的项目密钥继续有效，并可撤销。** 数据库中什么都不变：`runner_device_keys.project_id` 有值仍是一种有效的类别，`PatAuthGuard` 继续接受由它签名的 JWT，`GET` 继续列出，`DELETE` 继续撤销。**在本 ADR 之前通过浏览器配置的 runner 不会坏掉**：带有 `brabo-runner.config.json` 和 `brabo-runner-device-key.jwk.json` 的文件夹继续被 CLI 读取（RN-466 全部），它可能已安装的**项目** unit 也继续运行。不复存在的是创建**新的**项目密钥。
6. **浏览器生成密钥的 e2e 一并移除。** 它所证明的——由**浏览器**写入的 `kid` 被服务器接受——已没有生产者。使用真实密钥的 `kid` → JWT → `PatAuthGuard` 链仍由
   `apps/api/test/interfaces/pat-auth.guard.spec.ts` 覆盖，机器上生成的密钥对由
   `apps/runner/src/criar-chave-de-dispositivo.spec.ts` 覆盖。
7. **runner 的目标列表开始住在**三个**地方**，而不是四个：浏览器的那个随模块一起移除，`scripts/ci/alvos-do-runner.spec.ts` 锁定它不会悄悄回来。

分支是 `breaking/`：删除 OpenAPI 中有文档的公开路由，对调用它的人来说是合约变化，而版本策略
（`scripts/ci/version.ts`）说由**功能**决定——一个 patch 会说“不假思索地升级”。

## Consequences {#consequences}

**好的。**

- 产品中任何地方的安装路径都不再有手动 `chmod` 步骤：唯一有它的那条已移除。`BRB-031` 关闭。
- **新的**设备密钥只在一个地方诞生——机器的终端——并由一个登记者登记——安装程序。api 少了一条由会话 JWT 认证的写入路由。
- web 少了约 530 行加密、下载和磁盘写入的代码，这些是 jsdom 在没有替身的情况下无法演练的。

**坏的，已声明。**

- **团队安装失去了无需 PAT 的路径。** 创建**机器**密钥的路由只服务于**一个人**的安装（两人及以上返回 409，RN-552），而 `install.sh` 是在一台机器上安装整个 Brabo——它不能用来让**第二**台机器与已有安装配对。对这些人来说，路径变成带 PAT 的手动命令（`--token`），面板继续提供它并将其命名为另一台机器的路径。浏览器流程是在这种情况下无需 PAT 配对的唯一方式，而负责人的决定依然让它退役。
- **`GET /runner-releases/binary` 没有了生产消费者。** 代理**没有**在这里移除：决定点名的是密钥登记路由，而代理承载着 RN-525 的完整性验证以及 `BRB-005` 开放的来源证明那一半。移除还是保留是负责人另外的决定。
- **在部署时打开着该流程标签页的人**点击时会在 `POST` 上收到 404——旧 bundle 仍在调用该路由。刷新页面即可解决。
- RN 464..466 和 473/475 描述的是原来的流程；它们获得修订说明，绝不删除。

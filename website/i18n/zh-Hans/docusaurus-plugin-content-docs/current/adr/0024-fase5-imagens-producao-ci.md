---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0024 — 阶段 5（第 1 次会话）：生产镜像、compose.prod、CI 与冒烟测试

- 状态：已接受
- 日期：2026-07-26
- 阶段：5（第 1 次会话——需求的第 1 至 5 项）

## 背景 {#contexto}

到目前为止，仓库中存在的所有 Docker 内容都**仅用于开发**。三个镜像都是单阶段的，以 **root** 运行，
没有 `USER`、`EXPOSE` 或 `HEALTHCHECK`，而且没有一个会复制代码：全都依赖仓库的 bind mount，并在
容器启动时安装依赖。`web` 是一个 `vite dev`——任何地方都没有 nginx，也没有静态构建。engine 没有
`mix release` 的配置。

而且**没有 CI**：`.github/workflows/` 中的两个 workflow 是 Claude Code 的辅助工具，没有一个运行
测试、lint 或构建。

本次会话交付阶段 5 的第 1–5 项。不在范围内（第 6 项及以后）：Kubernetes/Helm、带 preStop 的优雅
关闭、OpenTelemetry/Prometheus、备份/恢复、限流。

## 决策 {#decisões}

### 1. 在任何镜像之前先有 `.dockerignore`：上下文从 742 MB → 5,2 MB {#1-dockerignore-antes-de-qualquer-imagem-742-mb--52-mb-de-contexto}

当时根本不存在 `.dockerignore`，两个构建上下文都是仓库根目录。每次构建都会把 `node_modules`
（543 MB）、`.pnpm-store`（220 MB）、`.git` 以及各个 `.env` 发给 daemon。

用一个探针镜像（`FROM alpine` + `COPY . /ctx`）测量，因为估算脚本会出错：我做的前两次测量是错的，
原因是我自己的前缀 bug，而不是 `.dockerignore` 的 bug。有了这个文件：**5,2 MB**。

有两个例外在被发现之前一直让构建失败，值得记录，因为它们与名字所暗示的相反：

- **`design/tokens.css` 是构建输入，不是文档。** `apps/web/src/index.css` 执行
  `@import '../../../design/tokens.css'`，Vite 在文件系统中解析它。排除整个 `design/` 会让
  `vite build` 失败。那里只有 `.md` 是文档。
- **`docker/web/` 必须进入上下文。** web 镜像从那里复制 `nginx.conf` 和 entrypoint，与另外两个
  不同。

### 2. api 构建中一个从未被触发的潜伏 bug {#2-um-bug-latente-na-build-da-api-que-nunca-tinha-sido-exercitado}

`apps/api/tsconfig.build.json` 没有 `include`。没有它，`tsc` 也会编译 `drizzle.config.ts`、
`vitest.config.ts` 和 `scripts/`，把包的根推断为 `rootDir`，并输出 **`dist/src/main.js`**——而
`start:prod` 是 `node dist/main`。生产命令从一开始就是坏的，没人发现，因为开发使用 `start:dev`。
是第一个生产镜像暴露了它。

### 3. migration 是一次性服务，而不是启动步骤 {#3-migração-é-serviço-one-shot-não-passo-de-boot}

如果每个副本在启动时都做 migration，两个同时启动的副本会争抢同一个 migration。在
`docker-compose.prod.yml` 中，它们是两个运行一次就结束的服务，应用通过
`service_completed_successfully` 依赖它们。

之所以是两个，是因为在不同镜像中有两个 schema 属主：

- **api**：`drizzle-kit` 是 `devDependency`，生产镜像一个都不带。我们创建了 `src/db/migrate.ts`，
  它使用 `drizzle-orm`（运行时依赖）的编程式 migrator——与 vitest 的 `globalSetup` 已在使用的机制
  相同。
- **engine**：release 中没有 Mix；镜像中不存在 `mix ecto.migrate`。`Engine.Release`（Ecto 的规范
  模式）通过 `bin/engine eval "Engine.Release.migrate()"` 调用。

已验证两者的 migration 之间没有交叉引用，因此它们并行运行。

### 4. 在生产镜像中，安装扫描器是**硬失败** {#4-na-imagem-de-produção-instalar-scanner-é-fail-hard}

在开发中，gitleaks/hadolint/semgrep 的安装有意是尽力而为（`|| echo`）：检测器会察觉缺失，gate
会跳过。在生产中这是不可接受的，原因就写在之前的 ADR 中：**没有 hadolint，infra 的 QA gate 会批准
任何 Dockerfile**（ADR 0021），**没有 gitleaks，SecOps gate 会在没有机密检查的情况下运行**
（ADR 0020）。构建中的一次网络故障，会产出一个绿色的镜像，而它的安全 gate 是 no-op。

因此：没有 `|| echo`，带**经过校验的 SHA256 checksum**（checksum 保证二进制是预期的那个，而不只是
下载了），版本固定在 `ARG` 中，以及一个执行每个二进制的最终验证步骤——包括真正的 `semgrep scan`，
而不只是 `--version`。这一步已经物有所值：见决策 8。

### 5. engine 的可写卷（需求第 2 项） {#5-volumes-graváveis-do-engine-item-2-do-enunciado}

两个用 `VOLUME` 声明、在构建时调整了属主的挂载点：

| 路径 | 写入什么 |
|---|---|
| `/data/project-workspaces` | 每个项目的工作树，以及位于 `<workspace>/.worktrees/<agent_id>` 的每个 agent 的 worktree；还有 `permissions.json` |
| `/data/git-repos` | 本地 bare 仓库，由 dev agent 的 `git push` 写入 |

另外还有 `/tmp`（4 个检测器以及 `InfraGateRunner` 的临时树）和 `$HOME`（semgrep 在第一次执行时
从 registry 下载并缓存规则）——这两个用 `tmpfs`，因为 rootfs 是只读的。

**这两个路径在 api 和 engine 中必须完全相同。** api 把 bare 仓库的绝对路径持久化到数据库中，
engine 原样使用它；挂载到不同位置会让 push 以 `remote unpack failed` 失败。

只有运行时才出现的推论：这些目录必须**在两个镜像中都存在，并具有正确的属主**。当一个具名卷以空的
状态诞生时，Docker 会从镜像中的该路径复制内容和属主——如果路径不存在，卷会以 root 诞生，非 root
进程无法写入。因此 api 镜像也创建 `/data` 并执行 `chown node:node`；`node` 和 `engine` 都是 uid
1000，所以两个容器共享这些卷而没有冲突（双向都验证过）。

### 6. Phoenix 的 `check_origin` 在生产中破坏了团队面板 {#6-check_origin-do-phoenix-quebrava-o-painel-do-time-em-produção}

在 `:prod` 中，Phoenix 的默认行为是把 websocket 的来源与 `url: [host: ...]`（即 `PHX_HOST`）比较。
实时团队面板（阶段 4a 第 7 项）从 web 通过 Phoenix 通道通信，而 web 由**另一个**来源提供——握手会
被拒绝，面板会沉默，服务器上没有可见的错误。

`runtime.exs` 改为接受 `WEB_ORIGIN`（逗号分隔的列表，与 api 已用于 CORS 的变量相同）。没有它，
保持严格的默认值。

### 7. nginx：安全 header 在提供应用的路由上消失了 {#7-nginx-os-headers-de-segurança-sumiam-na-rota-que-serve-o-app}

当子块声明任何 `add_header` 时，nginx 的 `add_header` 会**丢弃所有继承的 header**。由于缓存策略
需要在 `location = /index.html` 中有一个 `add_header Cache-Control`，`server` 的安全 header 恰好在
`/` 上消失了——CSP 存在于文件中，却没有到达浏览器。这是用 `curl -D-` 发现的，而不是通过阅读。

修正：缓存策略变成了一个 `map $uri`，header 在 `server` 中**只声明一次**，没有任何子块使用
`add_header`。出于同样的原因，`/healthz` 使用 `default_type` 而不是 `add_header Content-Type`。

按路由验证过：`/`、router 的路由（回退）、`/assets/<hash>.js`、`/healthz`，以及不存在的资源的 404
（它必须是 404 而不是 `index.html`，否则一个缺失的资源会以 HTML 到达浏览器，错误表现为无效语法）。

此外，nginx 镜像的官方 entrypoint 在这里**不适用**：它只有在进程是 root 时才运行
`/docker-entrypoint.d` 中的脚本（以 `nginx` 运行时它打印 “skipping auto-configuration”，变量替换
从不发生），并把渲染后的配置写入只读的 `/etc/nginx`。因此有了 `docker/web/entrypoint.sh`，它渲染到
`/tmp`，并在启动前用 `nginx -t` 校验。

### 8. 镜像安全：修正了什么、接受了什么 {#8-segurança-das-imagens-o-que-foi-corrigido-e-o-que-foi-aceito}

带 `--severity HIGH,CRITICAL --ignore-unfixed` 的 `trivy` 一开始就在三个镜像中报告了发现。CI 中的
`exit-code: 1` 会一诞生就是红的；应对**不是**放松 gate，而是修正：

| 修正 | 效果 |
|---|---|
| 三个镜像都执行 `apk upgrade --no-cache`（固定的 tag 也会冻结 Alpine 的补丁） | 系统包的 CVE 清零；**web 只剩 0 个发现** |
| 移除 Node 基础镜像中打包的 npm/npx/corepack | api 的 **24 个发现**清零——全都来自 `/usr/local/lib/node_modules/npm`，**没有一个来自我们的依赖**。运行时执行的是 `node main.js`；那里的包管理器只是攻击面 |
| gitleaks 的固定版本 8.21.2 → **8.30.1** | 8.21.2 的二进制是用 Go 1.23.2 编译的，带有 15 个标准库 CVE，其中 1 个 CRITICAL。已验证 `mix test --only gitleaks` 仍然通过 |

剩下的是**我们无法修正**的，在 `.trivyignore.yaml` 中被接受，每个条目有三个必备条件——不是我们编译
的第三方二进制、已经是最新发布的版本，以及 **`expired_at`**（2026-10-31），让这笔债重新使 CI 失败，
而不是悄无声息地腐烂：

- gitleaks 官方二进制中的 Go 标准库和 `golang.org/x/crypto`；
- `mcp` 1.23.3，semgrep 1.171.0 的**固定**依赖（`mcp==1.23.3`，不是范围），而 1.171.0 已经是最新
  发布。我们尝试过移除该包，因为 gate 只调用 `semgrep scan` 而从不调用 `semgrep mcp`：**行不通**——
  `semgrep/cli.py` 无条件地导入 `semgrep.commands.mcp`，二进制会死于 `ModuleNotFoundError`。抓住这
  一点的是 Dockerfile 验证步骤中真正的 `semgrep scan`（决策 4），而不是测试套件。

### 9. 校验模式下的 lint 暴露了 31 个积累的错误 {#9-lint-em-modo-verificação-expôs-31-erros-acumulados}

仓库的 lint 脚本以 `--fix`/`--write` 运行，因此没人见过校验模式。在 check 模式下：31 个错误。三十个
是格式问题（自动修正），一个是 `no-unnecessary-type-assertion`。剩下两个 `no-unused-vars`：一个死的
import（已移除），以及一个 rest 解构中的 `_modules`，**变量存在却不被使用正是重点**——通过在 eslint
中配置 `argsIgnorePattern: '^_'` 解决，这是仓库中已在使用的约定。之后重新运行 api 的测试套件：508 个
通过。

### 10. 宿主机的格式化工具不是项目的格式化工具 {#10-o-formatador-do-host-não-era-o-formatador-do-projeto}

在固定的 Elixir **1.17.3**（Dockerfile 和 CI）下运行 `mix format --check-formatted`，否决了**11 个
已 commit 的文件**。这不是疏忽造成的漂移：格式化规则在版本之间变了，代码是用更新的 Elixir 格式化
的——开发宿主机上的那个（这台机器上是 1.20.2）。在宿主机上运行 `mix format` 会为一个版本“修好”
文件，却为另一个版本弄坏它们，陷入循环。

由于固定版本是在整个基础设施中声明的那个，它就是事实来源：这 11 个文件在**1.17.3 的容器内部**进行了
格式化，README 开始指示在宿主机版本不同时在那里格式化。这是 CI 在远程存在之前就有的第一个发现。

方法上的说明：我第一次读这个检查时以为是绿的，因为包装器掩盖了退出码，而 `grep | head` 截断了文件
列表。只有一个显式的 `echo $?` 才显示出实际发生了什么。

### 11. CI 中防止假绿的守卫 {#11-o-guard-de-falso-verde-no-ci}

当机器上缺少二进制时，`test_helper.exs` 会排除 tag `:gitleaks`/`:hadolint`/`:yamllint`——而这三个
模块恰恰是证明 gate 不会空批准的回归测试（ADR 0020/0021）。在一个光秃秃的 runner 上，它们会悄无声息
地消失，CI 保持绿色，却从未测试过安全 gate。

`test-engine` job 以**与 Dockerfile.prod 相同的固定版本**安装这三个，并在 `mix test` 之后，如果输出
包含任何被排除的测试就明确失败。本地，之前：`254 passed, 9 excluded`。有了二进制之后：
**`263 passed`、0 excluded**。

出于同样的原因，仓库的 `gitleaks` 以完整历史运行（`fetch-depth: 0`）：在最后一个 commit 中删除的
机密仍然可以恢复。3 个发现是两个**为了被发现**而存在的合成 PAT（回归测试的 fixture），以及一个
NestJS 样板中的占位符——在 `.gitleaks.toml` 中按**规则和确切路径**限定作用域地加入 allowlist，绝不按
宽泛的模式，因为宽泛的 allowlist 就是之前 ADR 描述的同一种 no-op。

### 12. 构建、扫描和 smoke 在同一个 job 中 {#12-build-scan-e-smoke-no-mesmo-job}

三个镜像加起来约 1,3 GB；通过 artifact 在 job 之间传递它们，上传/下载所花的时间会比整个构建还长。它们
留在 runner 的本地 daemon 中。层缓存通过 `type=gha`，按镜像划分作用域。

## 已知限制（已记录，未解决） {#limitações-conhecidas-registradas-não-resolvidas}

1. **`VITE_*` 是编译期的。** Vite 把 `import.meta.env.VITE_*` 内联到 bundle 中，因此
   api/engine/Keycloak 的 URL 被烤进了 web 镜像：这是**每个环境一个镜像**，而不是在环境之间晋升的
   同一个镜像。解决这个问题（运行时注入）是下一次会话 Kubernetes 的前提。nginx 的
   `CSP_CONNECT_SRC` 倒是运行时的。
2. **Node 仍留在 engine 镜像中**，因为 DevAgent 在里面运行被管理项目的测试套件（`TerminalExecutor`）。
   这无法扩展到任意技术栈；真正的出路是每个项目一个沙箱，不在阶段 5 的范围内。
3. **`rtk` 被排除在镜像之外**——没有可以按 checksum 固定的可验证来源。检测器已经会降级，指标仍为
   `nil`。
4. **`docker-compose.prod.yml` 不加固第三方组件。** Keycloak 仍以 `start-dev` 运行开发 realm
   （硬编码的机密，`admin123`），Postgres 在容器中使用默认密码。那个文件的目标是**我们的三个镜像**；
   加固 Keycloak 和 Postgres 是另一次会话的工作，这在文件顶部有说明。
5. **分支保护如今在这个仓库中无法应用。** GitHub API 返回 403：*"Upgrade to GitHub Pro or make this
   repository public to enable this feature"*。目标配置记录在下面；在计划允许时应用它是用户的手动
   步骤。

## `dev` 分支保护的目标配置 {#configuração-alvo-da-proteção-da-branch-dev}

在 *Settings → Branches → Add branch protection rule* 中对 `dev` 应用：

- **Require a pull request before merging**——不允许直接 push。
- **Require status checks to pass before merging**，加上 *Require branches to be up to date*：
  `Lint`、`Testes TS (api + web)`、`Testes do engine (ExUnit)`、`Gitleaks no repositório`、
  `Build, scan e smoke das imagens de produção`。
- **Require conversation resolution before merging**。
- **Do not allow bypassing the above settings**（包括管理员）。
- **不要**启用 auto-merge 或 merge queue：CLAUDE.md 规定在受保护分支上的合并始终由用户手动完成，没有
  自动化选项。

## 后果 {#consequências}

- 三个应用都有了真实的生产路径，可以用一条命令在本地验证，而“测试套件通过”与“镜像能启动”之间的
  差别不再是不可见的。
- CI 覆盖 lint、测试、构建、镜像和机密扫描以及冒烟测试——并且**真正测试了安全 gate**，那曾是最大的
  漏洞。
- 镜像以非 root、只读 rootfs 运行，这也消除了一类已经在开发中出现过的摩擦（需要容器才能删除的
  root 属主的 `dist/`）。
- 留下了明确且有日期的债务：`.trivyignore.yaml` 于 2026-10-31 到期，上面的五个限制是下一次会话的
  输入。

## 数字 {#números}

| | 之前（dev） | 之后（prod） |
|---|---|---|
| 构建上下文 | 742 MB | **5,2 MB** |
| api 镜像 | 274 MB | 457 MB¹ |
| engine 镜像 | 1,17 GB | **796 MB** |
| web 镜像 | 255 MB | **93,5 MB** |
| engine 测试套件 | 254 passed，**9 excluded** | **263 passed，0 excluded** |
| 可修正的 trivy HIGH/CRITICAL | — | 三个镜像均为 **0** |

¹ api 的生产镜像更大，因为开发镜像**不带代码也不带依赖**：它使用 bind mount 和卷。它们不能作为同一
东西的“之前和之后”来比较。在 457 MB 中，165 MB 是生产的 `node_modules`（其中 51,7 MB 是
`gpt-tokenizer`）。

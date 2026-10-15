<div align="center">

[Português](README.md) · [English](README.en.md) · [Русский](README.ru.md) · **简体中文**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="website/static/img/logo.svg" />
  <source media="(prefers-color-scheme: light)" srcset="website/static/img/logo.svg" />
  <img src="website/static/img/logo.svg" alt="Brabo 标志" width="96" />
</picture>

<h1>Brabo</h1>

**一支 AI 智能体团队把你的应用从需求简报带到部署。
最终决定权始终在你手里——靠设计保证，而不是靠约定。**

[![CI](https://img.shields.io/github/actions/workflow/status/daneiel/brabo/ci.yml?branch=dev&label=CI&style=flat-square)](https://github.com/daneiel/brabo/actions/workflows/ci.yml)
[![许可证：MIT](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![版本](https://img.shields.io/github/v/release/daneiel/brabo?label=version&color=informational&style=flat-square)](CHANGELOG.md)
[![文档](https://img.shields.io/badge/docs-daneiel.github.io/brabo-8A2BE2.svg?style=flat-square)](https://daneiel.github.io/brabo/)

[文档](https://daneiel.github.io/brabo/) · [从零到交付物](https://daneiel.github.io/brabo/prd/zh-Hans/tutorials/from-zero-to-deliverable) · [CHANGELOG](CHANGELOG.md) · [安全](SECURITY.md) · [参与贡献](CONTRIBUTING.md)

<img src="docs/assets/readme/perguntas-no-chat.png" alt="Brabo 会话界面：创意智能体记录业务规则，并在聊天中返回待解决的问题，每个问题都附有建议答案和它影响的规则" />

<sub>想法变成规则，缺少的部分变成问题——创意智能体在聊天中把疑问交还给你。</sub>

[亮点](#亮点) · [功能](#功能) · [它是什么](#它是什么) · [开始](#三条命令开始) · [文档](#文档) · [许可证](#许可证)

</div>

> 源文本和受校验的版本是葡萄牙语的 [README.md](README.md)：其中写有当前版本和各项数量（规则、决策、提供方）。本译文有意不写这些数字。

---

## 亮点

<table>
  <tr>
    <td width="25%" valign="top">🛑 <b>未经批准，什么都不会发生</b><br />每个外部效果都以 <code>proposed_action</code> 的形式产生，并经过项目策略；合并到受保护分支永远由你决定。</td>
    <td width="25%" valign="top">🧱 <b>智能体在设计上不被信任</b><br />迭代、修正和预算的上限都写在代码里。提示词不是保证，代码才是。</td>
    <td width="25%" valign="top">📜 <b>一切都被记录且不可变</b><br />只追加的事件日志，每个会话内编号连续：成本可审计，备份可验证。</td>
    <td width="25%" valign="top">👥 <b>一支团队，从简报到交付物</b><br />创意、PO、架构师、Dev Lead、按模块划分的开发者、Infra、QA 和 SecOps，工作在真实的 git 仓库上。</td>
  </tr>
</table>

## 功能

### 想法变成规则，缺少的部分变成问题

<img src="docs/assets/readme/perguntas-no-chat.png" alt="创意智能体记录规则，并在聊天中返回待解决的问题，每个都附有建议答案" />

创意智能体在聊天中交还疑问，附上建议答案以及每个问题影响的规则。你就在那里回答，答案会变成业务规则。

### 架构师以书面方式做决定

<img src="docs/assets/readme/arquitetura-e-adr.png" alt="架构师以 pull request 的形式提出架构决策，并请你确认架构" />

架构决策以 pull request 的形式产生，架构只有在你确认后才继续推进。

### 开发者在容器内工作

<img src="docs/assets/readme/dev-agent-trabalhando.png" alt="开发智能体在容器内工作时说明它正在修复什么" />

每条命令都经过项目策略，开发智能体做的事情都留在会话记录中。

### 合并永远由你决定

<img src="docs/assets/readme/merges-pelo-chat.png" alt="创意智能体聊天中待合并的 pull request 队列，带有批准和拒绝按钮" />

通过各道关卡的 pull request 会出现在聊天中，点一下「批准」即可确认。

**从零到交付物，一次真实运行：** [带录屏的分步讲解](https://daneiel.github.io/brabo/prd/zh-Hans/tutorials/from-zero-to-deliverable)——8/8 个任务，102/102 个测试，US$ 1.07。

---

## 它是什么

Brabo 编排一组专业智能体——创意、PO、架构师、Dev Lead 与按模块划分的开发者、Infra、QA、SecOps、心理学家和 Anamnese（画像）——在真实的 git 仓库上工作，Gitflow 自动配置。

各个领域（dev、QA、Infra）都有一个 **lead** 作为唯一的对外地址：发起 handoff 的一方只与 lead 对话，而向子智能体委派是领域内部的事。

它与编程助手的区别：

**任何有外部效果的事情都不会自己发生。** 终端命令、commit、push、PR、合并、token 花费——一切都以 `proposed_action` 产生，经过项目策略（`deny` 永远压过 `allow`），然后才执行。有两种情况连策略也无法放行：**合并到受保护分支**和**修改智能体的指令**。它们是在整个策略之后施加的上限，而不是默认值。

**智能体在设计上不被信任，系统也按此假设。** 迭代上限、每个任务的修正上限、会拒绝调用的预算、Anamnese 可画像内容的封闭目录。提示词不是保证，代码才是。

**一切都被记录且不可变。** 事件日志只追加，每个会话内编号连续。正是这一点让心理学家的证据可追溯、成本可审计、备份可验证。

**团队在进步，而你始终在环路中。** 心理学家提出基于真实事件的假设；Anamnese 推导出你的熟练度画像，并提出带版本的指令补丁。每个补丁都需要你的同意，回滚会创建新版本，而不是抹掉历史。

## 三条命令开始

```bash
cp .env.example .env
pnpm install
pnpm dev
```

`pnpm dev` 启动 Docker Compose（Postgres 16 + pgvector、api、engine、web），支持热重载。首次启动时 api 和 engine 会各自执行迁移。`pnpm --filter api seed` 创建演示用户。

| 服务 | 地址 | 说明 |
|---|---|---|
| Web | <http://localhost:5173> | 登录 `owner@brabo.dev` / `brabo12345678`（来自 seed） |
| API | <http://localhost:3000> | `GET /health` |
| Engine | <http://localhost:4000> | `GET /health` |

`pnpm dev:down` 关闭全部服务。`pnpm dev:build` 强制重新构建。

### 菜单：不想记命令时用

```bash
pnpm bootstrap
```

日常命令分散在三个互不相通的地方：`package.json`（pnpm 脚本）、`Makefile`（Kubernetes 目标）以及 `deploy/k8s/` 和 `docker/` 中的零散脚本。菜单是唯一的入口。它**不重新实现任何东西**——每一项都恰好调用已经存在的 `pnpm`、`make` 或脚本。

| 按键 | 作用 |
|---|---|
| `1`–`6` | 选择条目，**无需回车** |
| `v` | 返回上一级 |
| `q` | 退出 |
| `↓` | 执行期间显示实时输出 |
| `↑` | 回到「执行中」界面 |
| 鼠标滚轮 · `j`/`k` · `PgUp`/`PgDn` | 显示输出时滚动整个日志 |
| `G` | 回到日志末尾（实时） |
| `Ctrl+C` | 中止当前命令 |

可用的快捷键显示在当前界面的底部——无需记忆。浏览、滚动或调整窗口大小时，横幅始终固定在顶部。

**滚动日志。** 展开的输出以前只显示文件末尾；现在它是一个可以向后移动的窗口，无需等待命令结束即可查看完整日志。底部会立即提示两个结果：

- **向后滚动会冻结窗口**（类似 `less +F`），否则每秒五次的重绘会在你读完一行之前撤销滚动。按 `G` 重新跟随末尾。
- **命令运行期间，菜单会开启鼠标追踪**以接收滚轮——开启后拖动不再选中文本。**按住 `Shift`** 使用终端原生的选择。离开该界面后追踪即关闭，退出时（包括 `Ctrl+C`）也会关闭。

**四个区域。** `Create` 从零准备环境，`Deploy` 把代码发布到已存在的环境（所以只有它可以按服务选择），`Destroy` 负责拆除：

| 区域 | 条目 |
|---|---|
| **1. Docker** | `Deploy` → All · Api · Engine · Web — `Create` — `Destroy` — `Reset total` — `Reconfigurar Ollama` — `Base de projetos` |
| **2. K8s** | `Deploy` → All — `Create` — `Destroy` |
| **3. Database** | `Generate` — `Migrate` — `Seed` — `Delete` |
| **4. Test** | All · Api · Engine · Web · Smoke · Docs |

菜单做的四件值得知道的事：

- **`Docker › Destroy` 保留数据卷**（`down`，从不 `down -v`）：销毁容器不等于销毁数据。
- **在 K8s 中只有 `All` 可用。** 集群的 bootstrap 会一起安装 api、engine 和 web；Api/Engine/Web 在菜单中显示为**禁用**并附上原因。隐藏它们会掩盖限制；执行它们则是虚构一条不存在的路径。
- **`Database › Delete` 是唯一需要回车的界面**，并要求输入数据库名。它会清空 schema 并**重新创建 pgvector 扩展**——`init.sql` 只在数据卷首次初始化时运行，因此单纯的 `DROP SCHEMA` 会让下一次迁移失败。由于 engine 共用同一个数据库，脚本会提示恢复需要 `pnpm db:migrate` **和** `pnpm engine:migrate`。
- **`Docker › Reset total` 在删除前先停止 api 和 engine**——只停这两个，不多不少：它们与数据库保持着活动连接，在它们底下执行 `DROP SCHEMA` 会杀死进程，而且没有东西会把它们重新拉起（engine 会在 drop 过程中死掉，因为 `Rehydrator` 查询了一张刚消失的表）。迁移后它会重新启动所有服务、等待其健康并执行 seed；最后在给出任何结论之前，它会**询问** api 和 engine 的 `/health` 以及 web 的 `/`——若有一个没有响应，它会点名并以退出码 1 结束，而不是宣布成功。这是第二个需要确认的界面（输入 `RESET`），它不删除数据卷——并在运行时说明这一点，因为另一面是 reset 永远无法复现首次克隆（只在新数据卷上出现的缺陷会被忽略）。详见 [`docs/runbook.md`](docs/runbook.md#reset-total)。

**命令行选项：**

```bash
pnpm bootstrap                                # 打开菜单（需要终端）
pnpm bootstrap --print-commands               # 打印整棵树后退出
pnpm bootstrap --print-commands --path 1.1    # 只打印一个子树
pnpm bootstrap --help                         # 用法说明
```

`--print-commands` 把菜单的每个叶子解析成真实命令，**但不执行任何东西**——这是审计菜单行为的方式，测试也基于它运行（`scripts/dev/bootstrap.spec.ts`）。没有交互式终端时，菜单会拒绝打开并指向这个选项，而不是卡住等待永远不会到来的按键。出于同样的原因还有 `--print-window <log> <行数> <偏移>`：滚动从日志中截取的片段是纯算术，这样就可以在没有 TTY 的情况下测试。

`NO_COLOR=1` 关闭颜色；否则它会以 24 位 ANSI 使用设计系统的 token，在终端不支持时降级为 256 色。

> **`pnpm dev` 与 `make deploy-local` 不能共存。** 两者把 api 和 engine 发布在相同端口上——这是有意的，以便冒烟测试对两者都有效。本地集群运行时，**5173 打不开**，web 位于 <http://localhost:8088>。`pnpm dev:preflight` 会告诉你当前处于哪种模式；`make k8s-down` 切回本模式。详见[入门指南](docs/getting-started.md#os-dois-modos-locais-não-coexistem)。

> `api`、`web` 和 `engine` 容器以与你的主机用户**相同**的 UID/GID 运行——绝不以 root 运行——这样 `apps/api/dist` 以及智能体在 bind mount 中写入的其他内容一产生就归**你**所有。用 `id -u` 和 `id -g` 查看你的组合；如果与默认值（1000/1000，单人开发的 Linux 机器上最常见）不符，请在首次 `docker compose up` 之前把 `DEV_UID`/`DEV_GID` 写入 `.env`（参见 `.env.example`）。在此改动之前就已存在的环境：`node_modules`/`_build`/`deps`/`.mix`/`.hex` 的命名卷中仍有旧容器以 root 写入的内容——执行一次 `sudo chown -R $USER apps/api/dist apps/*/node_modules`（或用 `docker compose down -v` 删除这些卷，让下一次 `up` 重新创建）来清理被卡住的部分。

## 文档

**📖 [daneiel.github.io/brabo](https://daneiel.github.io/brabo/)**——与下面相同的文档，可浏览、可搜索。站点读取 `docs/`，在合并到 `main` 时发布，因此比 `dev` 中的内容落后一个推进周期：想看最新状态，请直接阅读这里的文件。

| 文档 | 用途 |
|---|---|
| [简介](docs/intro.md) | 全景 |
| [入门指南](docs/getting-started.md) | 从克隆到第一个智能体回合 |
| [架构](docs/architecture.md) | 代码地图、边界、不变量、技术债 |
| [业务规则](docs/business-rules.md) | 各条 RN，每条都附 `文件:行号` 和覆盖它的测试（数量见[葡萄牙语 README](README.md)） |
| [Runbook](docs/runbook.md) | 部署、rollout、恢复、密钥轮换、成本事故 |
| [术语表](docs/glossary.md) | harness、gate、handoff、DEK、outbox、K 周期 |
| [可观测性](docs/explanation/observability.md) | 如何跨三个进程追踪一个动作：trace、日志和跨层路径 |
| [配置](docs/reference/configuration.md) | 所有环境变量 |
| [脚本](docs/reference/scripts.md) | 每个 `pnpm` 命令和 `Makefile` 目标，从源码提取 |
| [事件](docs/reference/events.md) | 事件日志的类型、广播和 span |
| [权限](docs/reference/permissions.md) | `permissions.json` 的格式和决策顺序 |
| [工件](docs/reference/artifacts.md) | 各个 schema 以及谁可以产生它们 |
| [Git 提供方](docs/reference/git-providers.md) | 操作契约和能力声明 |
| [内部 API](docs/reference/internal-api.md) | api ↔ engine 契约 |
| [安全](SECURITY.md) | 如何报告漏洞 |
| [参与贡献](CONTRIBUTING.md) | 流程、Definition of Done、接受什么 |
| [治理](GOVERNANCE.md) | 当前模式（单一维护者）、`community` 模式的三个角色及准入标准 |
| [获取帮助](SUPPORT.md) | 各类问题对应的渠道 |
| [行为准则](CODE_OF_CONDUCT.md) | Contributor Covenant 2.1 |

## 技术栈

| 层 | 技术 |
|---|---|
| `apps/api` | NestJS 11 + Drizzle ORM + PostgreSQL 16 + pgvector |
| `apps/engine` | Elixir/OTP + Phoenix（通道）+ Oban（队列在 Postgres 中） |
| `apps/web` | React 19 + Vite + TanStack Query/Router；运行时 `mermaid`（仅用于架构师的 C4 图，通过动态 `import()` 加载） |
| auth | api 自有（argon2id + Ed25519 access JWT + 带轮换的不透明 refresh）；RBAC 在 api 的领域中 |
| deploy | 通过 Kustomize 部署到 Kubernetes；开发用 Docker Compose |

没有 Redis：队列通过 Oban 存放在 Postgres 中，限流是 SQL 中的滑动窗口。

## 许可证

[MIT](LICENSE) © 2026 Daniel Souza——官方文本，无附加条款。

engine 镜像内置了关卡所依赖的第三方工具（gitleaks、hadolint、semgrep、yamllint），**其中一些采用 GPL**。以独立进程运行它们不会造成任何传染，但把**镜像发布**到 registry 会产生提供源码的义务。所有内容连同各自的版本和许可证都列在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 中——首次推送到 registry 之前请先阅读。

web 镜像内置了设计系统的三种字体，均采用 **OFL 1.1**——这是一种宽松的许可证，但要求随二进制文件一起分发版权声明。它位于 `apps/web/public/fonts/LICENSE.txt`，与其余静态文件一同提供，相关义务记录在同一个声明文件中。

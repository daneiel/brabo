---
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
---

# 任务：为本仓库编写完整且可自我维持的文档

你是一名 Staff Engineer + Technical Writer，负责为本仓库编写全部文档，将其发布为
Docusaurus 站点，并且——最重要的是——安装让文档在今后每次变更时都与代码保持同步的
机制。

受众有三类：
(a) 需要在第一周就提交 PR 的新开发者；
(b) 正在评估本项目能否解决自己问题的外部人员；
(c) 凌晨 3 点试图弄清某处为何出故障的维护者。

---

## 项目背景 {#contexto-do-projeto}
填写你知道的内容；其余部分通过阅读仓库来发现。

- **名称：** <<< >>>
- **仓库：** <<< https://github.com/owner/repo >>>
- **平台：** <<< GitHub | GitLab >>>
- **默认分支：** <<< main >>>
- **一句话描述业务领域：** <<< >>>
- **文档语言：** <<< pt-BR | en | 两者（Docusaurus 的 i18n） >>>
- **模式：** **协作式开源**项目。任何人都可以提 issue 和 PR，但**每次合并都需经过我的批准**（BDFL 模式）。
- **许可证：** **MIT** —— 权利人 <<<Nome/Org>>>，年份 <<<2026>>>
- **我的 handle：** <<< @usuario >>>
- **联系邮箱（安全 / 行为准则）：** <<< >>>
- **资金支持：** Buy Me a Coffee —— <<< https://buymeacoffee.com/usuario >>>
- **交流渠道：** <<< GitHub Discussions | Discord | 暂无 >>>
- **文档站点 URL：** <<< https://usuario.github.io/repo >>>

---

## 不可妥协的原则 {#princípios-inegociáveis}

1. **绝不编造。** 每条陈述都必须能追溯到代码、配置、commit、PR、issue 或已有文档。
   无法确定某事时，原样写下
   `> **TODO(humano):** <pergunta específica>`。我宁要简短而真实的文档，也不要冗长
   而编造的文档。
2. **绝不暴露机密。** 只记录变量的**名称**以及读取它们的位置。如果在历史中发现凭据，
   停下来并作为事故通知我。
3. **单一事实来源。** Markdown 存放在根目录的 `docs/` 中。Docusaurus 从那里**读取**，
   绝不复制。如果你创建了 `website/docs/`，你就错了。
4. **README 是橱窗，不是手册。** 超过约 20 行的章节迁移到 `docs/`，只留下链接。
5. **稳定的文档。** 写作方式要让正常的代码变更不会使文档失效（尤其是
   ARCHITECTURE.md）。
6. **写之前先征得许可。** 各阶段都有停止点。

---

# 阶段 1 —— 侦察
只读。本阶段不要创建或编辑任何文件。

## 1.1 结构与技术栈 {#11-estrutura-e-stack}
- `git ls-files | head -300` 以及最多 3 层的目录树
- 清单文件：`package.json`、`pom.xml`、`build.gradle`、`requirements.txt`、
  `pyproject.toml`、`go.mod`、`Gemfile`、`*.csproj`、`Cargo.toml`、`composer.json`
- 基础设施：`Dockerfile`、`docker-compose.yml`、`k8s/`、`helm/`、`terraform/`、
  `.github/workflows/`、`.gitlab-ci.yml`、`Makefile`、`Procfile`
- 配置：`.env.example`、`application.yml`、`appsettings.json`、`config/`。
  列出**所有**环境变量以及它们在代码中被读取的位置。
- 入口点（`main`、`index`、`app`、`cmd/`、`server`）以及一次典型请求端到端的热路径。
- 脚本（npm scripts、Makefile 的 target、`bin/`、`scripts/`）：名称、作用、何时使用、
  前置条件。
- 可自动生成的参考来源：OpenAPI/Swagger、GraphQL schema、JSON Schema、
  Protobuf、导出的 TS 类型、docstring。**逐一标记**——它们将在阶段 5 进入自动生成，
  而不是手工编写。
- 测试：框架、如何运行、当前覆盖率（如有）。

## 1.2 Git 历史 {#12-história-do-git}
```bash
git log --oneline -n 500
git log --pretty=format:'%h|%ad|%an|%s' --date=short -n 800
git shortlog -sne --all                                          # donos do código
git log --format='%ad' --date=format:'%Y-%m' | sort | uniq -c    # ritmo do projeto
git tag --sort=-creatordate | head -30                           # releases
git log --diff-filter=A --name-only --pretty=format:'%ad' --date=short | head -100
git log --numstat --pretty=format:'' | awk '{print $3}' \
  | sort | uniq -c | sort -rn | head -40                         # hotspots
git log --format='%s' | grep -iE 'BREAKING|revert|migrat|refactor|rename'
```
提取：架构转折点、不稳定的模块（hotspot = 要更好地记录，并在 `.docmap.yml` 中重点
关注）、实际在用的 commit 约定、各领域的负责人。

## 1.3 PR、issue 与讨论 {#13-prs-issues-e-discussões}
GitHub（如果 `gh` 已认证）：
```bash
gh repo view --json name,description,topics,homepageUrl,licenseInfo,defaultBranchRef
gh pr list --state merged --limit 150 --json number,title,body,labels,mergedAt,author,files
gh issue list --state all --limit 100 --json number,title,body,labels,state
gh release list --limit 30
gh api repos/{owner}/{repo}/labels
```
GitLab：`glab mr list --merged`、`glab issue list`、`glab release list`。
如果没有任何 CLI 可用，请明确说明，继续使用纯 Git，并向我索取导出数据。

寻找：解释某个决策**原因**的描述（ADR 的原材料）、讨论过的权衡、揭示隐含业务规则的
bug 修复、breaking 变更、被拒 PR 的模式。

## 1.4 业务规则 {#14-regras-de-negócio}
扫描代码，寻找**领域**逻辑，而不是管道代码：
- 校验、guard clause、带业务常量的 `if`、状态机、状态枚举、计算（利息、税、折扣、
  SLA、限额）
- 实体名称以及团队的通用语言
- **测试是现成规则的最佳来源**——阅读 `*_test`、`*.spec`、`features/`，并从用例名称中
  提取规则
- migration 和 schema：constraint、unique、not null、default 都是规则
  整理一份领域术语表，附上推断出的定义。

## 1.5 许可证审计 {#15-auditoria-de-licenças}
- Node：`npx license-checker --summary` · Python：`pip-licenses`
- Go：`go-licenses report ./...` · Java/.NET：阅读 POM/csproj
  标出强 copyleft（GPL-2.0/3.0、AGPL-3.0）或含义不明的许可证，因为它们与 MIT 的宽松
  承诺冲突。**不要得出任何法律结论**——记录
  `> **ATENÇÃO(humano):** dependência X sob AGPL-3.0, verificar`。如果全部都是宽松许可
  （MIT/BSD/Apache/ISC），就明确说明。同时查找需要署名的 vendor 进来的第三方代码、
  资源、字体和图标。

## ⛔ 阶段 1 交付——在此停止 {#-entrega-da-fase-1--pare-aqui}
提交以下内容并等待我的 OK：
1. 约 15 行的摘要，说明项目是什么、做什么
2. 主流程的文本图示
3. 历史中的发现（转折点、hotspot、约定、风险）
4. 许可证审计结果
5. 找到的可自动生成参考来源列表
6. 只有我能回答的开放问题
7. 你将要创建的文件计划

---

# 阶段 2 —— 核心文档
在我 OK 之后。一次一个文件，展示 diff。没有我的要求不要 commit。

`docs/` 中的每个文件都带有与 Docusaurus 兼容的 YAML frontmatter：
```yaml
---
id: architecture
title: Arquitetura
sidebar_label: Arquitetura
sidebar_position: 1
description: <uma frase, usada em SEO e nos cards de índice>
keywords: [arquitetura, code map]
---
```
纯内容使用 `.md` 扩展名，**只有**需要 React 组件时才使用 `.mdx`——严格的 MDX 语法会
破坏零散的 HTML 和字面量 `{`。

### `README.md` —— 橱窗 {#readmemd--a-vitrine}
1. 顶部的 **Banner**。如果不存在，生成 `docs/assets/banner.svg`（1200×300，
   醒目的字体，2 种与产品协调的颜色）和 `logo.svg`（512×512）。
   用 `<p align="center">` 居中。
2. 真实且可验证的 **Badges**：build、文档站点部署、`License: MIT`、
   版本（最新 tag）、语言、PRs welcome、last commit、contributors。
   不要装饰性的虚假 badge。
3. 一行 tagline + 一段“它解决的问题”。
4. **醒目的文档站点链接**，紧挨在 badges 下方。
5. 带锚点的目录。
6. **✨ Features** —— 简短的要点，每条写收益，而不是实现。
7. **🏗️ 30 秒看懂架构** —— 一张 Mermaid + 完整文档的链接。
8. **🚀 Quickstart** —— 到达“在我的机器上跑起来”的**最短**路径。
   可复制粘贴，前置条件带精确版本，并给出每条命令的**预期输出**，让人知道成功了。
9. **⚙️ 配置** —— 摘要表格 + 完整参考的链接。
10. **📜 Scripts** —— 表格 `Comando | O que faz | Quando usar`。
11. **🗺️ Roadmap** —— 从开放的 issue 和 label 推导。
12. **🤝 贡献** —— 直接的邀请 + 指向
    `/labels/good%20first%20issue` 和 `/labels/help%20wanted` 的链接。
13. **👥 贡献者** —— contrib.rocks 小组件或 all-contributors。
14. **☕ 支持本项目** —— 靠近末尾。诚实地说明项目免费、利用业余时间维护，放上
    Buy Me a Coffee 的 badge，以及支持能让什么成为可能。
    不制造内疚，不承诺回报，不暗示付费者享有优先权。
15. **📄 许可证** —— “Distribuído sob a licença MIT. Veja [LICENSE](LICENSE).”

### `docs/architecture.md` —— matklad 风格 {#docsarchitecturemd--no-estilo-matklad}
- **Bird's eye view**：一段话，把系统当作黑盒，输入与输出
- 用 Mermaid 画的**容器图**（C4 第 2 层风格）
- **Code map**：每个顶层目录——它是什么、从哪个文件开始读、以及它**不**用于什么。
  指出可搜索的起点（入口点、可以 grep 的符号）
- 用 `sequenceDiagram` 画一次请求/job 端到端的**流程**
- **层边界与不变量**——绝不能被违反的东西
  （例如：“domain 不导入任何 infra 的东西”）。这是文档中最有价值的部分
- **横切关注点**：auth、日志、错误、事务、缓存、feature flag
- **数据**：模型、`erDiagram`、migration 策略
- **已知技术债**——来自 hotspot 以及带债务 label 的 issue

### `docs/business-rules.md` {#docsbusiness-rulesmd}
- 目的与业务背景、参与者/画像
- 通用语言术语表
- 编号规则 `RN-001`，每条包含：陈述、所在位置（`arquivo:linha`）、覆盖它的测试、
  找到时的来源（PR/issue）
- 用 `stateDiagram` 画的状态机
- 边界情况以及出错时会发生什么

### `docs/adr/` {#docsadr}
每个从历史中重建的结构性决策一个 ADR。Nygard 格式：
**标题 / 状态 / 背景 / 决策 / 后果**，附日期以及指向来源 PR 或 commit 的链接。
只记录有分量的决策（数据库、单体 vs 服务、会话状态、一致性模型）——而不是“我们换了
日期库”。
先创建 `0001-registrar-decisoes-com-adr.md`。

### `docs/` 内的 Diátaxis 组织 {#organização-diátaxis-dentro-de-docs}
```
docs/
  intro.md                 # landing page do site
  getting-started.md       # TUTORIAL: do zero ao primeiro resultado
  how-to/                  # HOW-TO: uma tarefa real por arquivo
  reference/               # REFERÊNCIA: API, env vars, CLI, schema
  explanation/             # EXPLICAÇÃO: trade-offs, contexto histórico
  architecture.md · business-rules.md · runbook.md
  adr/ · assets/
```
绝不要在同一个文件中混合这四种类型。解释过多的教程，既是糟糕的教程，也是糟糕的解释。

### 其他 {#demais}
- `docs/runbook.md` —— 如果有部署：healthcheck、日志、回滚、告警
- `CHANGELOG.md` —— 从 tag 和 PR 重建，Keep a Changelog 格式
- `SECURITY.md` —— 受支持的版本和私密报告渠道

---

# 阶段 3 —— 社区层

### `.github/FUNDING.yml` {#githubfundingyml}
```yaml
buy_me_a_coffee: <<<handle>>>
```
不要编造我没有提到的其他平台。

### `CONTRIBUTING.md` {#contributingmd}
- **写代码之前**：先开一个 issue，等待达成一致。白纸黑字地写明——没有事先 issue 的
  大 PR 很可能会被拒绝。
- **5 分钟搭好开发环境。** 如果实际搭建耗时更长，标记 `TODO(humano)`——这是外部贡献
  的头号杀手。
- **如何在本地运行文档站点**（`npm run docs:start`），以及**改变行为的 PR 必须更新对应
  文档**的规则，并附上指向 `.docmap.yml` 的指针。
- **流程**：fork → branch（`feat/`、`fix/`、`docs/`）→ 按历史中使用的规范 commit →
  针对 `<<<branch>>>` 提 PR → 我的 review → squash merge。
- **我乐于接受的** vs **我大概不会接受的**（更换技术栈、未经讨论的大范围重构、新的
  重量级依赖、范围变更）。要具体——这一节能节省双方的时间。
- **Definition of Done**：测试通过、lint 干净、**文档已更新**、CHANGELOG 已改动、
  文档站点构建无断链、没有任何机密。
- **诚实的 SLA**：“我通常在 X 天内 review；这是业余时间项目，如果我消失了一周，请在
  PR 上礼貌地 ping 一下”。不要承诺 24 小时。
- **致谢**：贡献者如何被展示。
- **入站许可 = 出站许可**：提交 PR 即表示贡献者同意以同样的 MIT 许可授权。没有 CLA。
  把 DCO（`git commit -s`）作为**可选**项介绍，并解释它对偶尔贡献者造成的摩擦。

### `GOVERNANCE.md` {#governancemd}
BDFL 模式，不傲慢：谁有合并权、决策如何做出、如何表达异议（开一个 Discussion，而不是
在 review 里争吵）、决策如何变成 ADR，以及某人成为有合并权的维护者的标准。

### `CODE_OF_CONDUCT.md` {#code_of_conductmd}
Contributor Covenant 2.1，完整的官方文本，填上我的邮箱。
不要改写 CoC 的文本。

### `SUPPORT.md` {#supportmd}
分流：使用问题 → Discussions/Discord；可复现的 bug → bug issue；
想法 → feature issue；安全漏洞 → SECURITY.md，**绝不**使用公开 issue。

### `.github/ISSUE_TEMPLATE/`（`.yml` 格式，必填字段） {#githubissue_template-formato-yml-campos-obrigatórios}
- `bug_report.yml` —— 版本、环境、步骤、期望 vs 实际、日志、复选框
  “我已搜索过重复的 issue”
- `feature_request.yml` —— 解决的问题、考虑过的替代方案，以及
  **是否愿意实现（是/否）**：把想法与贡献区分开
- `doc_issue.yml` —— 页面、哪里错了或缺了什么、站点链接
- `config.yml` —— `blank_issues_enabled: false` + 指向 Discussions、文档站点和
  Buy Me a Coffee 的 contact_links

### `.github/pull_request_template.md` {#githubpull_request_templatemd}
描述、`Closes #`、变更类型、如何测试、涉及 UI 时的截图、DoD 检查清单
**包括“我已更新受影响的文档（见 `.docmap.yml`）”**，以及复选框
“我同意以本项目的 MIT 许可授权此贡献”。

### `CODEOWNERS` {#codeowners}
`* @<<<handle>>>` —— 让我成为所有内容的必需 reviewer。

### Labels {#labels}
精简的集合，附上现成的 `gh label create` 命令：`good first issue`、
`help wanted`、`bug`、`enhancement`、`docs`、`docs-needed`、`question`、`wontfix`、
`needs-triage`、`blocked`、`breaking`。

---

# 阶段 4 —— DOCUSAURUS 站点

## 4.1 脚手架 {#41-scaffold}
安装在 `website/` 中，**不**复制内容：
```bash
npx create-docusaurus@latest website classic --typescript
```
把依赖固定在 `3.x`——v4 正在开发中，带有 breaking 变更。

在根目录的 `package.json` 中添加（如果没有就创建一个）：
```json
"scripts": {
  "docs:start": "npm --prefix website start",
  "docs:build": "npm --prefix website build",
  "docs:serve": "npm --prefix website serve"
}
```

## 4.2 `website/docusaurus.config.ts` {#42-websitedocusaurusconfigts}
必须配置：
- `title`、`tagline`、`favicon`、`url`、`baseUrl`（GitHub Pages 用 `/<repo>/`）、
  `organizationName`、`projectName`、`trailingSlash: false`
- `docs` preset 中的 **`path: '../docs'`**——读取单一事实来源
- **`routeBasePath: '/'`**——文档位于站点根目录，没有单独的 landing page
- **`onBrokenLinks: 'throw'` 和 `onBrokenMarkdownLinks: 'throw'`**——这会把断链变成
  CI 失败，是防止文档腐烂的最便宜机制
- **`editUrl`** 指向 `blob/<branch>/docs/`——每个页面都有“编辑此页”按钮，
  把文档贡献的摩擦降到最低
- **`showLastUpdateTime: true` 和 `showLastUpdateAuthor: true`**——公开显示页面最后
  一次被改动的时间。陈旧的页面一目了然。
- **Mermaid**：`markdown: { mermaid: true }` + `themes: ['@docusaurus/theme-mermaid']`
- **Docusaurus Faster**（构建快 3–4 倍，已稳定）：
```ts
  future: { experimental_faster: true }
```
- **搜索**：如果我没有 Algolia DocSearch，使用
  `@easyops-cn/docusaurus-search-local` 并设 `hashed: true`。不要让站点没有搜索。
- **Blog**：作为 release notes 渠道启用；否则 `blog: false`
- **i18n**：仅当我要求双语文档时（`defaultLocale`、`locales`）
- **Dark mode**，设 `respectPrefersColorScheme: true`
- 导航栏包含：Docs、API 参考、Blog、GitHub 链接，以及一个指向 Buy Me a Coffee 的
  **☕ 支持**项
- 页脚包含 MIT 许可证、社区链接和版权信息

## 4.3 `website/sidebars.ts` {#43-websitesidebarsts}
手写，按 **Diátaxis** 组织，而不是杂乱的自动生成：
```
🚀 Comece aqui   → intro, getting-started
📘 Guias         → how-to/*
🏗️ Arquitetura   → architecture, adr/*
📐 Regras        → business-rules
📖 Referência    → reference/*  (parcialmente autogerada — Fase 5)
💡 Explicação    → explanation/*
🛠️ Operação      → runbook
🤝 Contribuir    → contributing
```

## 4.4 版本管理 {#44-versionamento}
如果项目有已发布的 release，配置 `versions`，并在 CONTRIBUTING 中记录命令
`npm run docusaurus docs:version X.Y`，连同**何时**做版本快照的规则（只在
major/minor 时，绝不在 patch 时——版本快照太多会让文档维护成本乘以 N）。

## 4.5 部署 —— `.github/workflows/docs-deploy.yml` {#45-deploy--githubworkflowsdocs-deployyml}
- 触发：push 到 `<<<branch>>>`，`paths: ['docs/**', 'website/**']`
- **每个 PR 都运行的 build** job（不部署），在合并前抓出断链和 MDX 错误
- 通过 `actions/deploy-pages` 部署到 GitHub Pages，并控制并发
- 缓存 `node_modules` 和 Rspack 的持久缓存

## 4.6 内容调整 {#46-ajustes-de-conteúdo}
- `docs/intro.md` 作为 landing：是什么、给谁用，以及三条路径（“我想使用”、
  “我想理解”、“我想贡献”）
- 把环境变量和脚本的表格转移到 `reference/`
- 把 GitHub 的绝对链接替换为文档之间的相对链接
- 对随操作系统或包管理器而变的命令使用 `<Tabs>`
- 确认 Mermaid 在浅色**和**深色主题下都能渲染

---

# 阶段 5 —— 持续同步
这是最重要的阶段。文档不是因为初期没写而死，而是因为漂移（drift）而死。
安装机制，而不是良好意愿。
优先顺序：**生成 > 校验 > 提醒**。

## 5.1 `.docmap.yml` —— 职责地图 {#51-docmapyml--o-mapa-de-responsabilidade}
在根目录创建，基于你在阶段 1 和 2 中学到的内容：
```yaml
# Mapa: mudança de código → documentação que precisa ser revisada.
# Usado pelo Claude Code (/sync-docs) e pelo CI (docs-drift).
version: 1

rules:
  - id: api-surface
    watch: ["src/routes/**", "src/controllers/**", "openapi.yaml"]
    docs:  ["docs/reference/api.md"]
    generated: true          # gerado do OpenAPI, não editar à mão
    severity: block          # bloqueia o PR

  - id: domain-rules
    watch: ["src/domain/**", "src/**/*.rules.*", "migrations/**"]
    docs:  ["docs/business-rules.md"]
    severity: block
    note: "Toda RN alterada precisa da referência arquivo:linha atualizada."

  - id: config
    watch: [".env.example", "src/config/**"]
    docs:  ["docs/reference/configuration.md"]
    generated: true
    severity: block

  - id: architecture
    watch: ["src/**/index.*", "docker-compose.yml", "package.json"]
    docs:  ["docs/architecture.md"]
    severity: warn           # apenas comenta no PR
    note: "Só atualize se mudou fronteira de camada ou dependência estrutural."

  - id: scripts
    watch: ["package.json", "Makefile", "scripts/**"]
    docs:  ["docs/reference/scripts.md", "README.md"]
    severity: warn

  - id: adr-trigger
    watch: ["src/infra/**", "docker-compose.yml", "terraform/**"]
    requires_adr: true
    severity: warn
    note: "Mudança estrutural? Provavelmente merece um ADR."
```
根据真实仓库调整路径。不要盲目照抄示例。

## 5.2 根目录的 `CLAUDE.md` —— 永久指令 {#52-claudemd-na-raiz--instruções-permanentes}
这让今后每个 Claude Code 会话默认都会更新文档，而无需我开口。写得简洁、命令式：
```markdown
# Instruções do projeto

## Documentação é parte da definição de pronto
Ao alterar código, consulte `.docmap.yml` e atualize os documentos mapeados
**na mesma mudança**. Não deixe para depois e não me pergunte se deve fazer —
faça, e mostre o diff da doc junto com o diff do código.

## Regras
- Fonte de verdade do Markdown: `docs/`. Nunca crie `website/docs/`.
- Arquivos marcados `generated: true` no `.docmap.yml` são gerados: rode o script
  de geração, não edite à mão. Se você editar, o próximo build sobrescreve.
- Mudou comportamento observável? Adicione entrada em `CHANGELOG.md` (Unreleased).
- Mudou fronteira arquitetural, banco, modelo de consistência ou dependência
  estrutural? Crie um ADR em `docs/adr/` com o número seguinte.
- Nova regra de negócio? Adicione `RN-XXX` em `docs/business-rules.md` com
  `arquivo:linha` e o teste que a cobre.
- Antes de finalizar, rode `npm run docs:build` — link quebrado falha o build.
- Nunca invente conteúdo de doc. Sem informação suficiente, use
  `> **TODO(humano):** <pergunta>`.

## Convenções
- Commits: <<<Conventional Commits>>>. Doc-only usa `docs:`.
- Diagramas em Mermaid, no próprio Markdown. Nunca imagem de diagrama.
```

## 5.3 生成的参考 —— 从源头消除漂移 {#53-referência-gerada--elimine-o-drift-na-origem}
能生成的东西绝不应手写。创建适用于真实技术栈的脚本，并把它们接到
`npm run docs:generate`：
- **API**：OpenAPI → `docusaurus-plugin-openapi-docs`，或 GraphQL schema →
  `docusaurus-graphql-plugin`
- **环境变量**：扫描代码中读取环境变量之处的脚本，用标记
  `<!-- BEGIN:GENERATED --> ... <!-- END:GENERATED -->` 重新生成
  `docs/reference/configuration.md`
- **CLI**：捕获每条命令的 `--help`
- **类型/SDK**：TypeDoc、pdoc、godoc、javadoc → 嵌入 `reference/`
- **Scripts**：从 `package.json` / `Makefile` 提取
- **ADR 索引**：根据文件及其状态生成 `docs/adr/index.md`
- **贡献者**：all-contributors 或更新该章节的 action
  每个生成的文件都以下面这行开头：
  `> ⚠️ Arquivo gerado por \`npm run docs:generate\`. Não edite à mão.`
  并作为校验进入 CI：如果生成的内容与已 commit 的不同，PR 失败。

## 5.4 `.github/workflows/docs-check.yml` —— 守门人 {#54-githubworkflowsdocs-checkyml--o-guardião}
在每个 PR 上运行：
1. 在 `onBrokenLinks: throw` 下**构建站点** → 抓出断链和无效 MDX
2. **Drift check**：读取 `.docmap.yml` 的脚本，与
   `git diff --name-only origin/<branch>...HEAD` 交叉比对，对每条被触发却没有改动对应
   文档的规则：
    - `severity: block` → 检查失败
    - `severity: warn` → 在 PR 中评论，列出需要复查的文件
    - 必须有逃生口：label `docs-not-needed` 或 PR 正文中的一行
      `docs-not-needed: <motivo>` 可以放行检查。没有逃生口，团队学会的是绕过规则而不是
      遵守它。
3. **生成内容是最新的**：运行 `docs:generate`，有 diff 就失败
4. **文字 lint**：Vale 或 textlint（可选，提出建议并询问）
5. **外部链接**：`lychee`，只在每周 schedule 中运行——不在 PR 中，以免因第三方站点宕机
   而导致构建失败

## 5.5 `.claude/commands/sync-docs.md` —— 手动命令 {#55-claudecommandssync-docsmd--comando-manual}
当我想按需运行同步时使用的 slash command：
```markdown
Compare o código atual com a documentação e corrija o drift.

1. `git diff --name-only <<<branch>>>...HEAD` (ou o range que eu passar como $ARGUMENTS)
2. Leia `.docmap.yml` e determine quais docs foram afetados
3. Para cada doc afetado: leia, compare com a realidade do código, e corrija
   **apenas o que está factualmente errado ou faltando**. Não reescreva estilo.
4. Rode `npm run docs:generate` e inclua o resultado
5. Atualize `CHANGELOG.md` se houver mudança observável
6. Verifique se algum ADR é necessário; se sim, proponha o texto
7. Rode `npm run docs:build` e conserte o que quebrar
8. Relatório final: o que mudou, o que ficou como TODO(humano), e o que você
   deliberadamente NÃO mudou e por quê
```

## 5.6 `.github/workflows/docs-audit.yml` —— 定期审计 {#56-githubworkflowsdocs-audityml--auditoria-periódica}
每月（`schedule: cron`），打开或更新一个带 label `docs` 的唯一 issue：
- `last_update` 早于 N 个月、而对应代码之后又有变化的页面
- 有待处理 `TODO(humano)` 的文档
- 不再能解析的 `arquivo:linha` 引用（文件被移动或删除）
- 处于 `proposed` 状态超过 60 天的 ADR
- 失效的外部链接（来自每周检查）
  不要每轮都开一个新 issue——更新已有的那个。

## 5.7 本地 hook（可选——提出建议并询问） {#57-hooks-locais-opcional--proponha-e-pergunte}
通过 husky/lefthook 的 `pre-push`，在本地运行 drift check，让贡献者在开 PR 之前、而不是
之后发现问题。只有我批准才安装：
慢 hook 是让人永远使用 `--no-verify` 的最快方式。

## 5.8 记录机制本身 {#58-documente-o-próprio-mecanismo}
创建 `docs/explanation/documentation-workflow.md`，解释这个系统如何运作、为何存在，
以及 drift check 不公正地报错时该怎么办。没人理解的机制，就是会被人关掉的机制。

---

# 阶段 6 —— MIT 许可

### `LICENSE` {#license}
**官方、未作任何修改**的 MIT 文本，放在根目录，无扩展名，填好年份和权利人。如果已有
其他许可证或占位符（`[year]`、`[fullname]`）的 LICENSE，予以修正并通知我。绝不要添加
条款——被修改的 MIT 将不再被工具和企业法务认可。

### 声明的一致性 {#coerência-declarada}
检查 `package.json`（根目录**和** `website/`）、`pyproject.toml`、
`Cargo.toml`、`pom.xml` 是否声明了 `"license": "MIT"`，并修正不一致。
在三个地方以不同的值声明许可证，是真实且常见的问题。

### `THIRD_PARTY_NOTICES.md` {#third_party_noticesmd}
如果阶段 1.5 发现了需要署名的 vendor 代码、资源、字体或图标，创建该文件并为每一项写上
署名。在 Docusaurus 的页脚中加入许可证说明。

### SPDX（可选——事先提出建议并询问） {#spdx-opcional--proponha-e-pergunte-antes}
在主要源文件中加入头部 `// SPDX-License-Identifier: MIT`。

---

# 写作规则
- 主动语态、现在时，步骤中使用第二人称。句子要短。
- 每条命令都放在标注正确语言的代码块中，并给出**预期输出**。
- 图示一律使用 **Mermaid**，写在 Markdown 本身中——在 GitHub 和 Docusaurus 上都能渲染，
  版本管理良好，经得起 diff。绝不要用图片做图示。
  最多约 12 个节点；超过就拆成两张。
- Emoji 只用于 README 的章节标题和侧边栏标签，且要节制。
- 文档之间使用**相对**链接，以便在 fork、镜像和站点中都能工作。
- 语气友好而具体，绝不官僚。“请先开一个 issue” >
  “É vedado ao contribuinte submeter alterações sem prévia anuência”。
- 尽早说“不”，并给出理由。在写了 300 行之后才拒绝 PR，是消耗维护者和贡献者的根源。
- 不要使用把资金支持变成支持合同的措辞。
- 零 lorem ipsum。零泛泛的 TODO——只用带具体问题的 `TODO(humano)`。

---

# 收尾
最后交付：
1. 已创建和已修改文件的目录树
2. 汇总的 `TODO(humano)` 与 `ATENÇÃO(humano)` 列表，按影响排序
3. 确认 `npm run docs:build` 通过且没有断链
4. Drift check 模拟：对最近 5 个 commit 运行，展示它本会报出什么——这是机制有效的证明
5. GitHub Community Standards 检查清单，列出尚未完成的项
6. Conventional Commits 格式的 commit 消息，按逻辑分组
7. 你在阅读历史时注意到、而我很可能不知道的三件事

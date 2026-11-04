---
traducao_de: 2f301391630d5be632e27036026760d416d43da1
---

# ADR 0117 — `website/` 拥有自己的 lockfile，脱离产品的 `pnpm audit`

- **状态：** 已接受
- **日期：** 2026-08-28

## 背景 {#contexto}

`website/`（发布 `docs/` 的 Docusaurus 站点）自创建起就是根目录
`pnpm-workspace.yaml` 的成员，与 `apps/api`、`apps/web`、`apps/runner`、`packages/*` 和
`scripts` 共享唯一的 `pnpm-lock.yaml`。`website/` 中没有任何东西进入生产镜像——站点由自己的 workflow
（`docs-deploy.yml`/`docs-check.yml`）构建和发布，从不被打包进 api、web 或 runner 的制品。

共享 lockfile 要付出两种与产品毫无关系的代价：

1. **`pnpm audit` 不再回答“产品安全吗？”**，而变成回答“产品**和**一个文档生成器安全吗？”。Docusaurus、`docusaurus-theme-openapi-docs` 及其传递依赖树（webpack、postman-collection、oas-validator、`@redocly/*`……）是一个庞大且变化迅速、从不交付的面，其中的每条 advisory 都出现在产品所依赖的同一道 `pnpm audit` 关口中（`ci.yml`，job“Auditoria de dependências”）。
2. **`pnpm-workspace.yaml` 中的大多数安全 override 只是为了修复站点的一个传递依赖而存在。** 在为本决策审计的 13 条中，`serialize-javascript` 和 `yaml@1.x` 范围**只**被 `website/` 的依赖树使用（用 `pnpm why <pkg> -r` 对共享 lockfile 确认，而不是重读注释——见下文“审计发现了什么”）。把它们留在根目录意味着把 `website/` 的漏洞面当作产品的来承担。

## 审计发现了什么 {#what-the-audit-found}

提出这件事的 backlog 条目假设分离会很干净：“website 的 override 移出去，产品的留下”。对分离前的 lockfile 就这 13 个 override 运行 `pnpm why <pkg> -r`，显示出更混乱的现实：好几个注释归属于 `website/` 的包，**也**被 `apps/api` 或 `apps/web` 拉入，且经由与注释所描述不同的链条：

| 包 | website 自己的链条 | 也被谁需要 |
|---|---|---|
| `js-yaml`（`<4.3.1`） | `openapi-to-postmanv2` / `@11ty/gray-matter` | `apps/api`，经由 `eslint` → `@eslint/eslintrc` |
| `js-yaml`（`<5.2.2`） | `@redocly/openapi-core` | `apps/api`，经由 `@nestjs/swagger`（已知） |
| `mermaid` | `@docusaurus/theme-mermaid` | `apps/web`，直接运行时依赖（ADR 0068） |
| `dompurify` | 经由 `mermaid` | `apps/web`，经由同一个 `mermaid` |
| `uuid` | `postman-collection`、`sockjs` | `apps/web`，经由 `mermaid` |
| `postcss` | `postcss-preset-env`（`docusaurus-theme-openapi-docs` 的传递依赖） | `apps/web`，经由 `vite` 自身的依赖 `postcss: ^8.5.17` |
| `nanoid` | 经由 `postcss` 自己的链条 | `apps/web`，经由 `vite` 下同一条 `postcss` 链 |
| `fast-uri` | `@redocly/ajv` | `apps/api`，经由 `ajv` → `@angular-devkit/core` → `@nestjs/schematics` |
| `lodash` | `@docusaurus/core`，直接 | `apps/api`，经由 `@nestjs/swagger`（已知） |
| `undici` | `cheerio`（本地搜索） | `apps/web`，devDependency `jsdom`（已知——backlog 条目唯一标为混合的情况） |

只有两个 override 被证实确实是 website 独有的
（`serialize-javascript`、`yaml@1.x`），一个被证实是产品独有的，在 `website/` 的树中完全不存在（`esbuild`，经由 `drizzle-kit`）。

这对下面的决策很重要：分离 lockfile **并不**意味着大多数 override 只是“搬家”。一个原先共享、修复两侧都存在的包的 override，在两棵树不再共享同一解析时必须继续保护**两**棵树——因为注释点名了另一侧就把它从一侧拿掉，会悄无声息地在失去它的一侧重新打开 CVE。

## 决策 {#decisão}

### 1. `website` 移出 `pnpm-workspace.yaml` 的 `packages:` 列表 {#1-website-sai-da-lista-packages-do-pnpm-workspaceyaml}

它不再是 workspace 的成员。在仓库根目录运行 `pnpm install` 不再触及 `website/` 下的任何东西，
`apps/api`/`apps/web`/`apps/runner`/`packages/*`/`scripts` 继续与之前完全一样地安装。

### 2. `website/` 拥有自己的 `pnpm-lock.yaml`，独立安装 {#2-website-ganha-o-próprio-pnpm-lockyaml-instalado-de-forma-independente}

在 `website/` **内部**运行的 `pnpm install`（不是在根目录运行 `pnpm --filter website`——该动词要求是 workspace 成员）单独解析并锁定 `website/` 的依赖，只对照 `website/package.json`。

### 3. override 按易受攻击的包实际解析的位置分开，而不是按哪条注释点了它的名 {#3-overrides-separados-por-onde-o-pacote-vulnerável-de-fato-resolve-não-por-qual-comentário-o-nomeava}

- **website 独有**（`serialize-javascript`、`yaml@1.x`）：从根目录 `pnpm-workspace.yaml` 中移除，加入 `website/package.json` 中新的
  `pnpm.overrides` 块（独立项目的语法——`website/` 内没有 `pnpm-workspace.yaml`，因此 workspace 级别的 `overrides:` 键在那里不生效）。
- **混合**（两个范围的 `js-yaml`、`mermaid`、`dompurify`、`uuid`、
  `postcss`、`nanoid`、`fast-uri`、`lodash`、`undici`）：保留在根目录，**并**复制到 `website/package.json`。两个 lockfile 现在独立解析这些包，所以各自都需要自己的下限。
- **产品独有**（`esbuild`）：只留在根目录。`website/` 从不解析它，在那里加一条是死重。

两个文件中的注释说明每条属于哪一类并指向本 ADR，这样下一个碰到某条混合条目的人不必从零运行 `pnpm why` 就能知道另一侧需要同样的修复。

### 4. 脚本和 workflow 从 `--filter website` 改为 `--dir website` {#4-scripts-e-workflows-passam-de---filter-website-para---dir-website}

`pnpm --filter <name>` 通过**属于 workspace** 来选择包——`website` 移出 workspace 后，根 `package.json` 中每个 `docs:*` 脚本
（`start`、`build`、`serve`、`clear`）都改为 `pnpm --dir website <script>`，它运行 pnpm 就好像是在那个目录内启动的，无论是否成员。大家已经在敲的脚本名（`pnpm docs:build`、
`pnpm docs:start`）不变。

`docs-deploy.yml` 和 `docs-check.yml` 各自增加一个单独的第二步
`pnpm install --frozen-lockfile`，作用域为 `website/`
（`working-directory: website`），紧跟在已有的根目录安装之后。根目录安装不再覆盖 `website/` 的依赖，没有这第二步，构建步骤会因缺少 `node_modules` 而失败。

## 后果 {#consequências}

- **根目录的 `pnpm audit` 现在只报告产品的依赖树。** Docusaurus、其主题、OpenAPI 插件及其传递包从 `ci.yml` 的“Auditoria de dependências”job 所运行的关口中消失——它报告的 CVE 面缩小到真正交付的东西。
- **单次安装的便利结束了。** 一个同时触及产品包和 `website/` 的变更（少见，但 `docs:generate` 的输出会同时触及两者）现在需要运行两次 `pnpm install`，一次在根目录，一次在 `website/` 内部，而不是一次。`docs-deploy.yml`/`docs-check.yml` 以第二个 CI 步骤付出同样的代价。
- **混合 override 有两个需要保持同步的位置。** 如果 `apps/web` 放弃 `mermaid`（或 `vite` 自己把 `postcss` 升到易受攻击范围之外），根目录的条目可以按常规方式移除（`pnpm audit` 不再抱怨），但 `website/package.json` 中的副本不会察觉，直到有人也在 `website/` **内部**运行 `pnpm audit`——目前还没有一次审计两棵树的单一命令。
- `docs/.docmap.yml` 的 `site-e-publicacao` 规则已经以 `warn` 监视 `website/**` 和
  `.github/workflows/docs-deploy.yml`，因此将来对任一者的改动仍会要求查看
  `docs/explanation/documentation-workflow.md`，它现在也记录了双 lockfile 的安排。

## 放弃的备选方案 {#alternativas-descartadas}

- **把 `website/` 留在 workspace 中，只是在 `pnpm audit` 中容忍它的 CVE**：现状。被拒绝，因为审计关口的全部目的是在交付的包有已知漏洞时提醒团队，而一个 Docusaurus 主题包会把这个信号淹没在无人能处理的噪声中，除了升级一个文档工具依赖之外。
- **把 `website/` 移到单独的仓库**：解决同样的问题甚至更多，但会失去文档源（`docs/` 留在本仓库）与渲染它的站点相邻，而直接读取 `apps/api` 代码来组装 OpenAPI 参考的 `docs:generate` 流水线将需要一个跨仓库步骤。超出 backlog 条目要求的范围。
- **“以防万一”把所有 override 都留在根目录**：写起来更简单，但与最初那些混合归属的注释错得一样——它掩盖了哪个包在哪一侧真正需要保护，下一次分离（或对这些条目的下一次审计）又得从零开始。

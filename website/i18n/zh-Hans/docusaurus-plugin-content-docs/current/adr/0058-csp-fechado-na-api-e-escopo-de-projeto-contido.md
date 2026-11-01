---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0058 — api 中封闭的 CSP，以及约束在根内的项目范围

- **状态：** 已接受
- **日期：** 2026-08-08
- **背景：** CodeQL 的未处理告警（2026-08-04 的扫描）
- **修订：** [ADR 0027](0027-fase5-backup-hardening-release.md)，第 7 项
- **涉及：** [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md)

## 背景 {#contexto}

CodeQL 的代码扫描留下了十个未处理的 HIGH 告警。其中七个是误报，已在 GitHub 上附书面理由驳回（列表在本文档末尾，因为驳回的理由同样是决策）。另外三个是真实的，并改变了设计，这正是本 ADR 所记录的。

### 1. `contentSecurityPolicy: false`（`js/insecure-helmet-configuration`） {#1-contentsecuritypolicy-false-jsinsecure-helmet-configuration}

[ADR 0027](0027-fase5-backup-hardening-release.md) 第 7 项决定“api 中用 helmet，CSP 只在 web”，并设置 `contentSecurityPolicy: false`。当时的论据是：api 提供 JSON，执行脚本的是 web，而 web 的 CSP 已经存在并且更具体（`docker/web/nginx.conf`，`connect-src` 按环境组装）。在 api 中开启一个**通用** CSP 会给人覆盖的印象，却不增加防御。

这个论据在它所断言的内容上依然正确，这就是它能撑过整整一个阶段的原因。它没有考虑到的是，通用 CSP 的替代方案不是没有任何头——而是一个**特定**的 CSP。而对一个只提供 JSON 的 api 来说，特定的就是最封闭的那个：`default-src 'none'`。它不加载脚本、样式表、图像、字体或 frame，因此拒绝一切的行为代价为零。

还有两条具体路径会让 api 的响应变成执行面，而 web 的 CSP 不在其中，因为 web 不在路径上：

- **直接导航**到 api 的路由——粘贴的链接、重定向、用户打开的标签页。浏览器在 **API 的源**上渲染响应，web 的 nginx CSP 在那里无效；
- **`frame-ancestors`**，它只对被嵌入的文档生效。web 的任何 CSP 都无法阻止第三方嵌入 api 的路由。

### 2. `join(raiz, projectId)` 而未验证 `projectId`（`js/path-injection`） {#2-joinraiz-projectid-sem-validar-o-projectid-jspath-injection}

`projectId` 通过 `@Param('projectId')` 到达，没有验证 pipe，而 Express **在交付之前会解码该段的百分号编码**：`..%2F..%2Fetc` 到达时就是 `../../etc`，`join` 会毫无怨言地解析到根之外。

影响范围不只是“读错文件”。`projectScopeRoot` 有两个消费者，而第二个才是痛处：

- `permissions.json` 会在任意路径上被读取**和写入**
  （`fs-permissions-file-store.ts`）；
- [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md) 的路径范围会授权该文件夹下的终端命令
  （`propose-action.use-case.ts` → `decide.ts`）。一个逃出根的范围，就是审批策略指向了错误的地方——**安全**失败，而不是文件未找到。

### 3. 不完整的表格单元格转义（`js/incomplete-sanitization`） {#3-escape-de-célula-de-tabela-incompleto-jsincomplete-sanitization}

在晋升 PR 的正文中（`scripts/ci/promote.ts`），PR 标题用 `.replace(/\|/g, '\\|')` 转义。只转义竖线会放过以反斜杠结尾的标题：`a\` 后跟 `|` 变成 `a\\|`，GFM 的表格解析器会把它读作被转义的反斜杠后跟一个列**分隔符**。

## 决策 {#decisão}

**1. api 发送 CSP，并且是封闭的。** helmet 的选项从 `main.ts` 中的字面量移到 `infrastructure/security/security-headers.ts`——与 `cors-origins.ts` 早已做过的同样的移动，理由也相同：在启动的字面量中它们无法测试，也没有任何测试看到 api 实际发送的是哪个头。

在生产中：

```
default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
```

在生产之外，`main.ts` 在 `/docs` 挂载 Swagger UI，那是真正的 HTML，需要自己的脚本、样式和图像——在 `default-src 'none'` 下页面会是空白的。开发配置只为 Swagger 放宽必要的部分，别无其他。条件与挂载 Swagger 的**完全**相同（`NODE_ENV !== 'production'`），这是刻意的：如果某天 Swagger 开始在生产中启动，CSP 会随之跟上，而不是静默地拦住它。

`'unsafe-inline'` 只出现在开发配置中，这是 Swagger UI 的限制（它内联注入初始化器），不是我们的选择。

`crossOriginResourcePolicy` 不再是 `false`，而变为
`{ policy: 'cross-origin' }`。在浏览器中的效果相同——web 是另一个源，需要消费这些响应——但意图从此在头中**说出来**，而不是在它的缺席中被省略。

**2. `projectId` 在推导根的地方被验证**，而不是在每个调用者中。`projectScopeRoot` 拒绝任何不是简单路径段的东西
（`^[A-Za-z0-9_-]{1,64}$`），并抛出异常。这项检查刻意比 UUID 更宽，以免绑定 id 的格式，又窄到足以保证结果绝不会逃出根。

在一个地方验证，正是这个函数存在的同一理由：两种推导必须一致，而重复的检查就是某天会分歧的检查。

**3. 单元格转义先转义反斜杠再转义竖线**，在 `celulaDeTabela` 中。适用于**文本**单元格；在 code span 单元格中反斜杠是字面的，转义它会渲染出可见的 `\\`——因此该函数不用于反引号中的列。

## 后果 {#consequências}

- api 开始在每个响应中发送 `Content-Security-Policy`。依赖于在浏览器中直接打开 api 路由并看到原始 JSON 之外内容的人，不再能这样依赖——而这种情况并不存在。
- 格式错误的 `projectId` 现在会**失败**，而不是解析到根之外。正常路径不变：每个真实 id 都是来自数据库的 UUID。
- 头不再对测试不可见。证明是针对中间件的真实请求，而不是对配置对象的断言——`false` 和一个指令对象都是“有效配置”，它们的差别只在 HTTP 响应中出现。

## 被驳回的，以及原因 {#o-que-foi-dispensado-e-por-quê}

附书面理由的驳回是一种回应；沉默地保持开放则不是。这七个：

| 告警 | 规则 | 原因 |
|---|---|---|
| #5 | `js/insufficient-password-hash` | 这里没有密码。`secret` 是 `GIT_OAUTH_STATE_SECRET`，服务器的 HMAC 密钥，而 HMAC-SHA256 是签名 OAuth `state` 的**正确**原语。在那里使用慢哈希反而是错误。产品中的用户密码使用 argon2id，在 `argon2-password-hasher.ts` 中。 |
| #4 | `js/loop-bound-injection` | 循环会终止。`b` 是 `String.prototype.split` 的结果——真正的数组，`.length` 无法伪造，`j` 每轮递增。规则的前提（带伪造 `.length` 的受控对象）在这里不成立。 |
| #7、#8 | `js/incomplete-sanitization` | 在 `scripts/docs/generate.mjs` 中两个单元格都是 **code span**（在反引号中），其中反斜杠是字面的：转义它会渲染出可见的 `\\`：所谓“修复”会破坏输出。输入是仓库自身的内容（`package.json` 的脚本、文档的章节标签），位于构建生成器中。 |
| #9 | `js/incomplete-multi-character-sanitization` | 这是**测试**文件。`replace` 从**本**仓库中受版本控制的 `index.html` 中去掉注释，以断言它不引用字体 CDN。这不是不受信任输入的清理边界。 |
| #1、#2、#3 | `js/path-injection` | 由上面的决策 2 关闭；驳回不适用——列在这里只是为了让十个凑齐。 |

在 Dependabot 中仍然开放的：`image-size`（两个 HIGH 告警）。没有发布修复版本——2.0.2 是 registry 中的最新版本，就是有漏洞的那个。它经由 `@docusaurus/mdx-loader` 进入，用于文档构建，读取本仓库中受版本控制的图像；路径中没有不受信任的输入。

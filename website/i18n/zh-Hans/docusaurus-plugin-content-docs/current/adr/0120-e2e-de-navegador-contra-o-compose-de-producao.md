---
traducao_de: 2f301391630d5be632e27036026760d416d43da1
---

# ADR 0120 — 针对生产 compose 的浏览器 E2E，放在 workspace 之外的包中

- **状态：** 已接受
- **日期：** 2026-08-29
- **引用（不编辑）：** [ADR 0032](0032-corte-do-keycloak-e-sessao-em-cookie.md)（这一层存在要证明的 cookie 会话）、[ADR 0117](0117-lockfile-proprio-para-o-website.md)（只用于开发、带自己 lockfile 的子树的先例）、[ADR 0027](0027-fase5-backup-hardening-release.md)（这一层复用而不是复制的生产冒烟测试）。

## 背景 {#contexto}

测试金字塔底部坚实，顶部有个洞。api 有 142 个 spec，engine 有 126 个，web 在 jsdom 下逐个组件测试，`docker/smoke.sh` 通过 HTTP 证明四个生产镜像能启动并彼此对话。

它们都没有演练**浏览器**。而承载会话的机制是浏览器的机制：

- access token 存在内存中，refresh 在 `httpOnly` cookie 中，与可读的 `brabo_csrf` 配对，后者作为 `X-CSRF-Token` 发送；
- web 在 `:8088` 提供，api 在 `:3000` 响应，所以每个已认证调用都是**跨源**的——预检、`SameSite`、`credentials: 'include'`；
- 会话通道需要一次性 ticket（[RN-108](../business-rules/autenticacao.md#rn-108)），以及在**第三个**源上对 engine 的真实 WebSocket 握手。

jsdom 这些都没有。它没有真实的源，不做预检，`httpOnly` 也不是它能强制执行的东西——一个断言 refresh 不可读的测试在那里会通过而什么都没证明。`apps/api/src/main.ts` 已经带有把这一点说得清清楚楚的注释：“teste não faz
preflight.”

这不是假设的缺口。最近的 cookie、CORS 和 socket 缺陷确实出现在那里，每一个都是手工发现的。

## 决策 {#decisão}

**一个浏览器 E2E 层，位于 `e2e/`，针对 CI 已经启动的生产 compose 运行。**

这个决定有三部分，各有其理由。

### 针对 `docker-compose.prod.yml` 运行，而不是 `vite dev` {#roda-contra-o-docker-composeprodyml-não-contra-o-vite-dev}

源的分离（`:8088` → `:3000` → `:4000`）只存在于生产 compose 中。针对开发服务器运行会演练一个没人部署的拓扑，并会静默地不再证明这一层存在要证明的唯一东西。所以作业以 `SMOKE_KEEP_UP=1` 复用 `docker/smoke.sh`：相同的镜像，相同的 compose，一次构建。

它还在镜像的**同一个 CI 作业**中运行。四个镜像占了那个作业的大部分时间；单独的作业会重新构建它们来演练同一个栈。

### `e2e/` 不是 pnpm workspace 的成员 {#e2e-não-é-membro-do-workspace-pnpm}

与 `website/` 相同的形式（[ADR 0117](0117-lockfile-proprio-para-o-website.md)）：自己的 `pnpm-workspace.yaml` 和 `pnpm-lock.yaml`，从文件夹**内部**用 `pnpm install` 安装，从根目录通过 `pnpm --dir e2e` 触发。

理由相同：Playwright 的依赖树从不进入产品的任何镜像，把它留在根 lockfile 中会让产品的 `pnpm audit` 把测试工具当作交付的攻击面报告。与 website 的区别——这个包*测试*产品——不改变论点，因为决定性的是依赖**去往**哪里，而不是它谈论什么。

### 证明机制，而不是界面 {#prova-mecanismos-não-telas}

spec 断言可观察的机制：浏览器报告的 `httpOnly` 标志、页面看到的 `document.cookie`、重新加载后的存活、带有 `ticket=` 的 WebSocket URL。选择器是结构性的（`input[type="email"]`），绝不是文本——界面的语言由服务器决定，绑定在“Sign in”上的测试会在语言切换时失败，而这种失败对产品什么也说明不了。

播种（workspace → 项目 → 会话）通过 HTTP 进行，镜像 `smoke.sh`。浏览器很贵，而项目向导不是这一层存在要证明的东西；慢的准备就是最终会被关掉的准备。

## 后果 {#consequências}

- 对于只有浏览器能到达的路径，缺口关闭了。两个 spec 都经过**变异证明**：错误的密码让认证 spec 变红，而把 socket 的断言指向一个不存在的路径会以“nenhum WebSocket foi aberto contra o engine.”失败。
- `images` 作业增长了：pnpm/Node 的设置、chromium 的下载以及执行本身。作为交换，它仍然是一个作业和一次镜像构建。
- 只有 Chromium。一个浏览器就证明了机制；另外两个会花下载和时间来再次证明同一件事。浏览器之间的差异是真实的风险，本决定**声明不覆盖**它。
- 浏览器的二进制在 CI 时从 Playwright 的 CDN 下载。它的版本由 lockfile 中 `@playwright/test` 的精确版本固定，这就是这次下载如何融入仓库的固定纪律——见 [cadeia-de-suprimentos-do-ci.md](../explanation/cadeia-de-suprimentos-do-ci.md)。
- **CI 中重试一次，本地不重试。** 针对活栈的 E2E 有外因造成的不稳定（容器仍在启动、socket 很慢）。零重试会把这变成教人忽视红色的噪声。
- 两个 spec 是下限，不是套件。内联审批和流式传输——在原始发现中点名的——**尚未**被覆盖。
- **套件有登录预算，而它来自真正运行它。** api 以按 IP 的渐进封锁保护 `/auth/login`，响应的是与错误密码**相同的统一 401**——区分它们会告诉攻击者他何时猜对了电子邮件。在 15 分钟窗口内反复运行套件会触发它，此时失败会指向登录，而缺陷并不在那里。由此得出两个后果：浏览器每次执行只登录**一次**（一个 `setup` 项目保存状态；只有 `autenticacao.spec.ts` 例外，因为证明登录需要干净的源），并且 `suporte/api.ts` 识别这个 401 并说明它可能是什么。替代方案——要求 compose 为套件提供更宽松的阈值以便随意登录——被拒绝：它会为了让测试方便而削弱被测试的东西。

## 考虑过的替代方案 {#alternativas-consideradas}

**`e2e/` 放在 pnpm workspace 内。** 一次安装，没有第二个 lockfile。出于 ADR 0117 刚刚付出代价的理由被拒绝：产品的审计会带上 Playwright 的依赖树。

**针对 `vite dev` 运行。** 更快，没有要构建的镜像。被拒绝，因为它测试的是一个不被部署的拓扑，而同源的开发服务器会让 `autenticacao.spec.ts` 的每个断言都变得空洞。

**专门的 E2E 作业。** 更干净的分离，那里的失败不会报告在“images”之下。因成本被拒绝：它会为到达同一个 compose 而重新构建四个镜像。

**通过向导驱动项目创建，而不是通过 HTTP 播种。** 更真实，并会覆盖向导。暂时被拒绝——它会让执行时间长好几倍，并把这一层与一个 git provider 耦合，而这种覆盖属于向导自己的 spec，如果有一天需要的话。

---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# 0036 — 忠实于设计的认证界面，以及三种无法加载的字体

## 背景 {#contexto}

四个认证界面——`/login`、`/registrar`、`/esqueci-senha`、`/definir-senha`——诞生于
[ADR 0032](0032-corte-do-keycloak-e-sessao-em-cookie.md)，与切掉 Keycloak 同时。它们诞生时是
**可用的**：能认证、能处理错误、能导航，[ADR 0031](0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)
的防枚举属性也全都在。从未存在过的是设计。

原因写在它们所取代的代码本身之中：这一表面原本由 Keycloak 提供，因此从未被设计过。
`design/SCREENS.md`，即设计系统的界面策展，**没有登录一节**——这个缺口早于这些界面。它们是根据
`design/COMPONENTS.md` 的基础规格和语义 token 组合出来的，这是没有 mock 时能做到的最好，结果是一张
没有品牌的灰色卡片，迁移提示作为松散的文字放在底部，也没有页脚。

两个发现改变了本次会话的框架。

### 1. mock 存在，但不在仓库中 {#1-o-mock-existe-mas-não-no-repositório}

一个登录 mock 是在生成 `design/tokens.css` 和 `design/COMPONENTS.md` 的 2026-07-23 策展**之后**，
在外部设计项目中创建的：

- 项目 `1c960ca8-5e00-4558-8ced-80dfbdf01027`，文件 `Brabo Login.dc.html`。

它是这项工作的权威规格，而它存在于版本控制之外。之后审查这项工作的人，如果没有该设计项目的访问权限，
就无法重新核对——因此有了决策 9 中记录的义务：该界面要进入 `design/SCREENS.md`。

### 2. 设计系统的三种字体在生产中无法加载 {#2-as-três-fontes-do-design-system-não-carregavam-em-produção}

`apps/web/index.html` 通过 `<link>` 从 Google Fonts 拉取 Space Grotesk、Archivo 和 IBM Plex
Mono。生产镜像的 CSP，在 `docker/web/nginx.conf` 中，是：

```
style-src 'self' 'unsafe-inline'; font-src 'self' data:
```

它**阻止了样式表和字体文件**。没有任何 `.woff2` 被纳入版本管理。因此，在 nginx 容器中，这三个
字体家族都落到了系统字体——而由于 `--font-heading` 和 `--font-body` 共享回退 `sans-serif`，**标题
与正文之间的排版区分直接消失了**。`index.css` 设有 `font-synthesis: none`，所以浏览器连 700 字重
都不会合成。

在 `pnpm dev` 中这是看不见的，那里没有 nginx，也没有 CSP。而 `design/tokens.css` 顶部的注释声称
加载是“via `<link>` no `<head>` do HTML que consome este arquivo”——准确地描述了一个生产镜像自己
所禁止的机制。

这不是假设，也不是未来的债务：这是生产中的缺陷，出在排版上，而排版是设计系统规定的第一件事。

## 决策 {#decisão}

### 1. 自托管这三个字体家族 {#1-auto-hospedar-as-três-famílias}

`apps/web/public/fonts/` 中的八个 `.woff2` 文件，在 `apps/web/src/index.css` 中用 `@font-face`
声明，`font-display: swap`。Google 的 `<link>` 被移除。这**无需放松**当前的 CSP 即可满足它——替代
方案是把 `fonts.googleapis.com` 和 `fonts.gstatic.com` 加到 `style-src` 和 `font-src` 中，那会用一个
缺陷换来渲染关键路径上的两个第三方依赖。

`@font-face` 放在 `index.css` 中，**不**放在 `design/tokens.css` 中：加载是使用 token 的一方的责任，
那个文件的注释改为说明这一点，而不是它原来所说的。

Space Grotesk 和 Archivo 是**可变**字体，以字重区间引入（`font-weight: 500 700` 和 `400 600`）；
IBM Plex Mono 是静态的，每个字重一个 `@font-face`。这一区分是通过解码每个 `.woff2` 的表目录并查找
`fvar` 表来验证的——在静态字体上声明区间会让浏览器合成缺失的字重，而这正是
`font-synthesis: none` 存在要阻止的。

**许可证义务。** 三者都是 OFL 1.1，它要求随二进制一起分发版权声明。
`apps/web/public/fonts/LICENSE.txt` 带有许可证和三份声明，`THIRD_PARTY_NOTICES.md` 不再写“carregadas
por CDN, não embutidas”——因为现在它们是嵌入的，义务也随之产生。

### 2. 两层验证，因为一层够不着 {#2-verificação-em-duas-camadas-porque-uma-não-alcança}

- **测试**（`apps/web/test/fontes.test.ts`）：`index.css` 中每个 `@font-face` 的 `url()` 都解析到
  存在的文件，签名为 `wOF2`；每个块都有 `font-display: swap` 和 `unicode-range`；字重区间与可变或
  静态相符；并且 `index.html` **不**提及 `fonts.googleapis.com`。
- **`docker/web/Dockerfile.prod` 中的 gate**：目录存在，有八个文件，并且发布的 `index.html` 不引用
  CDN。

两者都不能证明字体被**渲染**。jsdom 不应用 CSS Module，也不解析 `@import` 中的 `var()`，而
`getComputedStyle` 返回的是写下的东西，而不是解析后的东西。渲染的证明是在容器中手工核对，并且被如此
记录。

### 3. `AuthLayout` 成为整个外框 {#3-authlayout-passa-a-ser-a-moldura-inteira}

它原本只是卡片，别无其他。mock 加入了两个对四个界面同样适用的部件——卡片上方的品牌页头和下方的
页脚——它们放在外框中，而不是界面中。每个界面填充四个位置：`titulo`、`subtitulo`、`rodapeDoCartao`
和 `abaixoDoCartao`。

卡片标题是唯一的 `<h1>`；“Brabo” 是一个 `<span>`。把品牌提升为标题会产生两个 `<h1>`，并让读屏器
的标题列表在每个界面都从品牌开始，而不是说明在这里做什么。

### 4. 四个设计系统组件，以及每样东西放在哪里的标准 {#4-quatro-componentes-do-design-system-e-o-critério-de-onde-cada-coisa-mora}

| 部件 | 放在哪里 | 原因 |
|---|---|---|
| `Alert` | `components/ui/` 中的新组件 | 需要四种色调，并用于四个界面；以前每个界面都有自己的 `.aviso`/`.banner` 类，复制时间距略有不同 |
| `Button` 中的 `loading` | DS 中的 prop | 每个界面都手动更换标签；对使用读屏器的人来说，按钮只是被禁用，却没说正在进行工作 |
| 填充式字段 | `Input` 中的 prop `preenchido`，选择性启用 | `Input` 被认证之外的五个界面使用；更改默认值会悄悄地给这五个界面换样式 |
| 显示密码 | `Input` 中的 prop `revelavel` | 这是字段的解剖结构，而不是界面的：按钮定位在框内并切换 `type`。两个带密码的界面会继承它 |
| 品牌页头 | 本地，在 `AuthLayout` 中 | 是界面的外框，不是库组件 |
| `LogoMark` | 新图标 | 现有的 `BrandIcon` 是另一种图案（等轴测立方体）；mock 中的是一根竖条 + 两个尖角 |

**`Alert` 的 `role` 是 prop，不由色调推导。** `role="alert"` 是 assertive 的 live region：读屏器会
打断正在朗读的内容。这对用户刚刚触发的操作的结果是对的，对界面打开时就已经在那里的文字是错的。如果
由色调决定角色，迁移提示（色调 `warning`）会进入与凭据错误相同的 live region——“e-mail ou senha
incorretos” 的播报会开始包含 “a senha antiga não foi migrada”，这正是 ADR 0031 统一的 401 所要避免
的、关于账户的暗示。

**`Button` 的 `fullWidth` 是坏的。** 规则是 `flex: 1`，只有在父元素是 flex 或 grid 时才生效——而
使用这个 prop 的容器没有一个是。它在七个地方被传入，全都在认证界面中，却什么也没拉伸：“全宽按钮”
作为设计要求出现，而按钮的宽度只等于文字。它变成了 `width: 100%`。

### 5. 每种错误出现在哪里 {#5-onde-cada-erro-aparece}

凭据错误离开“密码”字段，变成卡片顶部的提示。表单错误和字段错误在四个界面中成为不同的东西：

- **字段的**（密码太短、确认不一致）：在字段下方，带 `aria-invalid`，因为要在那里修正；
- **表单的**（凭据被拒、链接无效、网络故障）：在顶部的提示中，因为它不指向任何字段。

被拒的凭据不会在任何字段上得到 `aria-invalid`：邮箱和密码都不是单独格式错误的，而 api 不说是两者中
的哪一个错了。两个都标记会断言超出所知的东西。

文案从 `E-mail ou senha inválidos.` 改为 `E-mail ou senha incorretos.`。403 的情况
（`Confirme seu e-mail…`）仍然有区别，正如 ADR 0032 和
[RN-032](../business-rules/autenticacao.md#rn-032) 所要求的：统一性存在于“不存在”、“密码错误”和
“账户被锁定”之间——而不包括“邮箱未验证”，后者只有在密码被证明**之后**才可达。

### 6. 页脚中的真实版本，以及原本不存在的链路 {#6-a-versão-real-no-rodapé-e-a-cadeia-que-não-existia}

页脚显示产物的版本。在把它接上时发现，`BRABO_VERSION` **在仓库中任何地方都从未被定义**：api 为
OpenTelemetry 资源的 `service.version` 读取它，却总是得到回退值 `dev`，因此每个环境的每个 span 都
写着 `dev`，这个属性恰恰在它的用途上毫无用处。而 `docs/reference/configuration.md` 声称“a imagem de
release injeta a tag”，并且它“aparece no `/health`”——两者都是假的。

现在这条链路存在了，而且两个服务共用一条：`release.yml` 计算 `versao=${TAG#v}` → 把 `VERSION` 传给
`docker buildx bake` → bakefile 把它转换为 `BRABO_VERSION`（目标 `api`）和 `VITE_BRABO_VERSION`
（目标 `web`）→ 每个 `Dockerfile.prod` 把它声明为默认值为 `dev` 的 `ARG` → Vite 内联 →
`runtime-config.ts` 读取 → `AuthLayout` 显示。

**构建期的，尽管 [ADR 0024](0024-fase5-imagens-producao-ci.md) 为 URL 选择了运行时。** 那里的理由是
在环境之间晋升**同一个**镜像，而 URL 是环境的属性。版本是**产物**的属性：`brabo-web:1.1.2` 不应该能
报告别的东西，否则页脚就成了一个可编辑的字段，而不是一种身份。

`VERSION` 在 bakefile 中与 `TAG` 分开，因为 `ci.yml` 使用 `TAG=prod`，而 “prod” 不是任何东西的版本。

### 7. `/status` 不再需要会话 {#7-status-deixa-de-exigir-sessão}

页脚指向 `/status`，而它原本在会话守卫之后：在登录界面点击 “Status” 会被重定向回登录界面——这是它
唯一不能有的目的地。它被移到一个新的 `publicLayout`，与认证的那个是兄弟。这是安全的：该页面只查询
api 和 engine 的 `/health`，它们本来就是公开的，因为调用它们的是 kubelet，在任何 token 存在之前。

### 8. 对比度由 token 计算，而不是由 axe 测量 {#8-contraste-calculado-dos-tokens-não-medido-pelo-axe}

axe 在四个界面上运行，覆盖空状态、错误状态和成功状态——但 `color-contrast` 规则被**明确关闭**。它
需要布局和解析后的颜色，而 jsdom 两者都没有：在那里运行它会在什么都没看的情况下产出“通过”，这比
没有测试更糟，因为它看起来像覆盖。

对比度通过直接在 `design/tokens.css` 上计算来验证，使用 WCAG 2.1 的亮度公式，针对界面实际使用的颜色
对。有四个未达到 4.5:1。其中三个用已存在的 token 修正：

| 颜色对 | 原来 | 改为 | 原因 |
|---|---|---|---|
| `Input` 的 `.hint` | `--text-muted`（3.89） | `--text-secondary`（8.00） | 对认证之外的五个界面同样适用 |
| 认证的 `.link` | `--accent`（3.88） | `--accent-hover`（4.90） | 同一色相，亮一级 |
| 填充式字段的占位符 | `--text-muted`（3.10） | `--text-secondary`（6.37） | 占位符是文字 |

第四个**没有**被修正，而它是最显眼的：主按钮上 `--on-accent` 对 `--accent` 只有 **3.20:1**，而它
要求 4.5（14px/600 的文字）。这是设计系统的赤陶色配对，用于应用中的每一个主按钮；修正它需要把
`--accent` 加深到 `--terracota-500`（5.27:1），那会改变整个 UI 的品牌色。这是设计决策，而不是实现
决策，它被记录为待办事项，数字被锁定在测试中，让它不能在无人察觉的情况下变得更糟。

### 9. 这个界面进入 `design/` {#9-a-tela-entra-no-design}

`design/` 是 UI 的事实来源，却没有提示、按钮加载状态和填充式字段的规格——正是这项工作创建的三样东西。
这三种解剖结构进入 `design/COMPONENTS.md`，`design/SCREENS.md` 获得从未存在过的登录一节。这关闭了
引发问题的那个缺口，也是让没有 mock 的人能够重新核对保真度的唯一方式。

## 后果 {#consequências}

### 相对于 mock 的有意偏离 {#as-divergências-deliberadas-em-relação-ao-mock}

| # | 偏离 | 原因 |
|---|---|---|
| 1 | 没有 “Continuar com GitHub” | 社交登录是阶段 7 有意识的 backlog，已记录在 ADR 0031 中并在 0032 中重申。这里没有新东西——只是确认 mock 画了一个本阶段决定不要的东西 |
| 2 | 没有 “N agentes online” | 认证前的动态数据会不必要地扩大攻击面：它需要一个统计 agent 的公开路由。它是内部面板的候选，而不是登录界面的 |
| 3 | 字段用 `--surface-2`，而不是 `--code-bg` | 明确的选择：凸起的字段而不是凹陷的。在 `--surface-1` 的卡片上，字段的默认背景与卡片**相同** |
| 4 | `.link` 用 `--accent-hover` | 对比度——见决策 8 |
| 5 | 使用 token 的 `--shadow`，而不是 mock 的重定义 | mock 是一个独立的文件，在自己的 `:root` 中覆盖了 token。token 的事实来源是设计系统 |
| 6 | “Esqueci minha senha” 是 `<label>` 的兄弟，而不是子元素 | 点击 `<label>` 的任何地方都会激活关联的字段；在标签内部，点击链接也会聚焦密码字段 |

**由第 1 条派生的后果**：mock 中的 “ou” 分隔符**只是**为了分开两个按钮而存在。没有第二个按钮，它也
随之移除——保留一个指向虚无的 “ou” 会比不对称更糟。

**第 2 条的后果**：卡片页脚只剩一项，因此 mock 的 `justify-content: space-between` 变为明确的左对齐。

### 仍待处理的，以及原因 {#o-que-fica-pendente-e-por-quê}

- **主按钮的对比度**（3.20:1）。需要关于品牌色的决策。这是这些界面上剩下的唯一一处 AA 不合格。
- **其他五个界面上同样的字段问题**：`Input` 默认是 `--surface-1`，放在 `--surface-1` 的卡片上，
  只靠 1px 边框分隔。这个变体是选择性启用的，所以那里什么都没变——也什么都没修。
- **`data-theme="light"` 仍未被执行。** 它存在于 token 中，却没有东西设置它。这些界面只使用语义
  token，所以如果有人开启浅色主题它们会继承，但它有三个颜色对未达到 AA——在对比度测试中作为记录
  被断言，而不是作为保证。
- **保真度是针对一个未纳入版本管理的文件。** 由决策 9 缓解，而不是消除。
- **没有测试能证明字体被渲染。** 见决策 2。

### 两个新依赖，都是开发依赖 {#duas-dependências-novas-as-duas-de-desenvolvimento}

`@testing-library/user-event`（焦点顺序）和 `axe-core`（结构性 a11y）。没有一个是运行时的——bundle
不变。

直接使用 `axe-core`，而不是本来最显然的包装器 `vitest-axe`：包装器为了节省六行代码，增加了一个
matcher 和一个依赖；而直接调用时，被关闭的规则列表在测试文件中可见，下一个关闭规则的人必须写下原因。

在信任绿色之前，harness 已针对真实的违规进行过核对——没有 `<label>` 的 input 和没有可访问名称的
按钮。因为没在看而通过的 a11y 测试，是这个工具在 jsdom 中的默认失败模式。

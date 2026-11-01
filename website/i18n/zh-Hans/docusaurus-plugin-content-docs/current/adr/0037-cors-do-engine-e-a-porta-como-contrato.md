---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0037 — engine 所缺的 CORS，以及端口作为契约的一部分

## 背景 {#contexto}

一份"web 与 api 之间存在 CORS 问题"的报告，引出了对系统**三对**通信的核查。结果是一对坏了，一对从未有过风险，而根本原因根本不在 CORS 中。

下面的一切都是测量出来的，用 `curl -H "Origin: …"` 以及读取控制台的无头 Chrome——而不是从读代码中推断出来的。

### 正确的部分 {#o-que-está-certo}

| 对 | 机制 | 结论 |
|---|---|---|
| web → api（HTTP） | Nest 的 CORS，`WEB_ORIGIN` | **正常**——preflight 返回 `allow-origin`、带四个请求头的 `allow-headers`、`allow-credentials` |
| web → engine（WebSocket） | Phoenix 的 `check_origin` | **正常**——握手返回 `101`；WebSocket 不经过 CORS，而 `check_origin` 自 Fase 4a 起就读取 `WEB_ORIGIN` |
| api → engine（`/internal/*`） | service token（RN-035） | **正常，且 CORS 不适用**——无 token 时 `401`，有 token 时为校验 `400`，带不带 `Origin` 响应**完全相同** |
| engine → api（`/internal/*`） | service token | **正常，且 CORS 不适用**——无 token 时 `403`，有 token 时 `400`，`Origin` 同上 |

最后两条值得完整说明，因为这个问题很自然，而答案是结构性的：**CORS 是浏览器的机制。** 在这两个方向上调用的是服务器端的 HTTP 客户端（api 中 Node 的 `fetch`，engine 中的 Finch），它们不实现同源策略，完全忽略这些头。没有什么要配置的，配置反而更糟——见决策 2。

### 坏掉的部分：web → engine 通过 HTTP {#o-que-está-quebrado-web--engine-por-http}

engine 的端点**完全没有 CORS**。`GET /health` 返回 `200` 和正确的响应体，却没有任何一个 `Access-Control-*` 头，于是浏览器丢弃了响应：

```
Access to fetch at 'http://localhost:4000/health' from origin
'http://localhost:5173' has been blocked by CORS policy: No
'Access-Control-Allow-Origin' header is present on the requested resource.
```

可见的效果：`StatusPage` 在 engine 完全健康的情况下显示 **`engine: error`**。没有任何测试抓到这一点，而且不是因为疏忽——在服务器一侧，响应是正确的。缺的是一个头，而 controller 测试不会断言 CORS 头。

这个缺陷早于本次会话，但现在变得更显眼了：[ADR 0036](0036-telas-de-auth-fieis-ao-design-e-fontes-auto-hospedadas.md) 把 `/status` 设为公开，并把它链接到认证界面的页脚，所以错误的那一行在登录之前就能被看到。

### 原始报告的根本原因，不是 CORS {#a-causa-raiz-do-relato-original-que-não-era-cors}

`vite.config.ts` 固定了 `port: 5173`，**却没有 `strictPort`**。当 5173 被占用时——另一个终端里被遗忘的 `pnpm dev`、同一主机上的开发 compose——Vite 会在 **5174** 上启动，并在启动日志中用一行提示。api 只接受 `http://localhost:5173`，所以应用正常打开，而**一切**都被拦截：

```
blocked by CORS policy: … 'http://localhost:3000/health'      (origin 5174)
blocked by CORS policy: … 'http://localhost:3000/auth/refresh' (origin 5174)
blocked by CORS policy: … 'http://localhost:4000/health'      (origin 5174)
```

被拦截的 `/auth/refresh` 正是让界面看起来像已登出的原因。而消息说的是 CORS，不是端口——于是时间全花在了错误的地方。更糟的是：自然的"修正"是放宽 api 的 CORS，那会修好 5174 却弄坏 5173。

## 决策 {#decisão}

### 1. engine 中一个自有的 CORS plug，而不是 Corsica {#1-um-plug-de-cors-próprio-no-engine-em-vez-do-corsica}

`EngineWeb.Plugs.Cors`，约 40 行逻辑。`Corsica` 是显而易见的选择，它解决的远多于所需：这个 plug 处理 `GET`/`HEAD`，不带凭据，三个固定路径，列表中两个头。`CLAUDE.md` 要求为新库说明理由，而"40 行"就是理由。

如果有一天 engine 暴露真正的浏览器 API——`POST`、cookie、自定义头——换成 Corsica 就会划算。moduledoc 记录了这一点，以便下一个人知道替代方案已被考虑过。

### 2. plug 放在 ENDPOINT 上，并按路径过滤 {#2-o-plug-fica-no-endpoint-e-filtra-por-caminho}

不放在 router 的 pipeline 中，理由是可测量的：router 的 pipeline 只有在路由匹配之后才运行。不存在 `OPTIONS` 路由，所以一个 preflight 会在 pipeline 的任何 plug 之前以 `404` 死掉——在修正之前已核实（`OPTIONS /health` → `404`）。一个看不到 preflight 的 CORS plug 只是半个 plug，而缺的那一半正是在 web 增加一个头的那天会坏掉的部分。

在 endpoint 上它能看到一切，代价是要明确说明它适用于哪里。这与 `EngineWeb.Plugs.AccessLog` 的设计相同，后者同样因为不能依赖 router 而按路径前缀过滤。

**允许列表是 `/health`、`/live` 和 `/ready`。** 两项有意的排除，两者都关乎安全：

- **`/internal/*`**——api 指挥 engine 的 13 条路由。如背景所述，CORS 在那里不会启用任何东西；它会做的是**告诉浏览器它是那条通道所期望的客户端**。这是我们不想给出的信息，关于一个我们不希望任何人尝试从浏览器触及的暴露面。
- **`/metrics`**——Prometheus 的抓取。内部指标没有理由被任何页面的 JavaScript 读取。

### 3. 未知来源得到响应，而不是 `403` {#3-origem-desconhecida-recebe-resposta-não-403}

请求被正常处理，返回时**不**带该头；阻止读取的是浏览器，这个决定本就属于它。回应 `403` 会把每一个没有 `Origin` 的合法请求——kubelet 探针、`curl`、`docker/smoke.sh`——变成一种新的失败模式，那是在修别的东西时意外造成的。

`vary: origin` 伴随 `allow-origin`。这不是装饰：没有它，缓存了某个来源响应的代理可能把它交给另一个来源，里面带着错误的头。

### 4. `WEB_ORIGIN` 只读取**一次**，供给两个使用者 {#4-web_origin-é-lido-uma-vez-e-alimenta-os-dois-consumidores}

socket 的 `check_origin` 早已读取这个变量；新 plug 需要同一个列表。重复读取正是**漏洞出现的方式**：socket 两个阶段之前就配置了来源，而 HTTP 什么都没有，因为没有任何东西迫使两者同步前进。

现在 `runtime.exs` 在顶部计算一次 `:web_origins`，`check_origin` 改为从它派生。

**在生产中没有开发默认值。** 缺少 `WEB_ORIGIN` 时 api 在启动时抛出异常（`cors-origins.ts`）；engine 则让列表保持**空**，这会关闭浏览器访问而不拖垮进程。这种不对称是有意的：CORS 是 api 那一段代码存在的理由，但在 engine 中它是边缘的——Oban 队列和 Phoenix 通道继续工作。一个因为状态面板而起不来的 engine，是用一个大问题替换一个小问题。

空列表也**不会**变成 `check_origin: []`，Phoenix 会把它读作"没有任何来源匹配"，并拖垮实时团队面板。在这种情况下采用 Phoenix 的严格默认值（`true`，与 `PHX_HOST` 比较）。

### 5. Vite 中的 `strictPort: true` {#5-strictport-true-no-vite}

端口是 CORS 契约的一部分，所以它不能被静默地选择。有了 `strictPort`，Vite 拒绝启动并说 `Port 5173 is already
in use`——这是真实的信息，而不是三个指向错误位置的 CORS 错误。

代价是真实的，并被接受：想同时运行两个开发服务器的人需要显式的 `--port`。显式选择正是我们想要的，因为另一个端口无论如何都需要加入 `WEB_ORIGIN`。

### 6. api 和 engine 的 CORS 中的 `maxAge` {#6-maxage-no-cors-da-api-e-do-engine}

web 对 api 的**每一次**调用都会触发 preflight：`api-client` 发送 `Authorization` 和 `traceparent`，它们不在安全列表中。没有 preflight 缓存，每个请求就是两次往返。浏览器的缓存按 URL+方法，而 TanStack Query 的 `refetchInterval` 一次又一次地访问同一个 URL，正是在那里它物有所值。

两边都是 10 分钟。短到足以让 `allowedHeaders` 的改动不会卡在开着标签页的人的缓存里。

## 后果 {#consequências}

- **`StatusPage` 开始说真话。** 之前：engine 在线时显示 `api: ok`、`engine: error`。之后：两者都是 `ok`，控制台中零 CORS 错误。
- **端口冲突不再伪装成 CORS 问题。** 这是把一种静默且误导的失败模式，换成一种响亮且正确的失败模式。
- **`/internal/*` 仍然没有 CORS，现在有测试断言这一点。** 边界变成了一个断言——包括一个关于路径列表恰好有三项的断言，以便移动边界会出现在 diff 中。
- **比显而易见的方案少一个依赖**，以及一个解释何时撤销这一决定的 moduledoc。
- **engine 有了它的第一个 HTTP 头测试。** 15 个用例覆盖了 controller 测试在结构上覆盖不到的东西：响应是对的，而头缺失了。

### 待办事项 {#o-que-fica-pendente}

- **两者都没有配置 `exposedHeaders`。** 今天 web 不读取任何响应头——`ApiError` 的 `trace_id` 来自客户端自己生成的 trace，而不是服务器。现在配置等于启用一项没有用途的能力。
- **engine 有意没有 `POST` 的 CORS**：浏览器中没有任何东西对它做 `POST`。当有了时，方法列表和头列表需要一起增长——preflight 测试就是会注意到这一点的地方。
- **`EngineWeb.RouteSurfaceTest` 在 `origin/dev` 上是红的**，早于本次改动（`SessionCommandController.create/2` 中的 `ActionClauseError`，原因是在断言内部路由接受有效 token 的测试中请求体为空）。已核实在不做本次交付任何改动的情况下同样失败，而这里没有任何提交在上述内容之外触及 `apps/engine`。记录在案，不予修正：那是另一回事。

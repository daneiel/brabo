---
traducao_de: e377ff4a1b1caac762cf61ae2001d296ee190e55
---

# ADR 0213 — 交付物通过 Infra 的 compose 在用户的机器上运行

## 状态 {#status}

**已接受。** 2026-10-11（AT-517；所有者于 10月11日的决定：“pelo compose da Infra”，broker 中不发布端口）。规则见 RN-851..855。引用（不编辑）[ADR 0130](0130-broker-de-container.md)、[ADR 0190](0190-a-infra-sobe-o-container-no-aceite.md) 和 [ADR 0199](0199-recurso-minimo-derivado-do-module-map.md)。

## 背景 {#context}

在一次执行结束时，用户拥有已合并的代码，却没有任何声明的方式能看到它运行。测得的情况：

- Infra 在 PR 中打开的 `docker-compose.yml` 是“开发用的”：它启动的是环境，而不是**应用**，而 Infra Lead 的 prompt 说项目容器不由它启动。
- `artifact.project_image` 中决定的镜像在 Infra 编写 compose 时并没有传到它那里，所以模块 Dockerfile 的 `FROM` 只是一个猜测。
- 应用的默认端口（3000）与同一台机器上 Brabo 的端口冲突。
- 项目容器没有 Docker（ADR 0130 的隔离），所以 Brabo 内部没有任何东西能运行 `docker compose up` 来证明 compose。
- 交付物的路由已经由 dev 记录在 README 中（[RN-850](../business-rules.md#rn-850)），QA 也已经能在后台启动进程并结束进程组（[RN-817](../business-rules.md#rn-817)），但没有任何东西把一个 URL 与用户打开的东西绑定起来。

## 决策 {#decision}

1. **路径是 Infra 的 compose**，由用户在交付的仓库中运行。broker **不**发布端口：ADR 0130 的隔离保持完整。
2. **compose 启动应用**（RN-851）：模块 Dockerfile 的 `build`，其 `FROM` 等于 `artifact.project_image` 的镜像，主机端口 `${APP_PORT:-8080}:<porta interna>`（8080 在 Brabo 的端口旁是空闲的：3000、4000、5173、5432、7474、7687、8088、11434），用于持久数据的卷，以及带已提交 `.env.example` 的 `env_file`——绝不是 `.env`。
3. **Infra 在它的 PR 中编写 README 的“Rodar na sua máquina”一节。** dev 继续负责“Rotas HTTP”（RN-850），并在创建 Swagger 或页面时加上其 URL。
4. **`propose_infra_pr` 获得**必需**字段 `run`**，在 engine 和 api 中验证：
   - `command`：非空字符串，最多 300 个字符（例如：`cp .env.example .env && docker compose up --build`）；
   - `urls`：1 到 5 项 `{ label, url, kind }`，`label` 最多 60 个字符，`kind` ∈ `api_docs` | `web`，`url` 以 `http://localhost:` 或 `http://127.0.0.1:` 开头；
   - `envExample`：布尔值——为 `true` 时，`.env.example` 在 PR 的 `files` 之中。
5. **api 发出 `artifact.run_instructions`**（RN-852），在成功执行 `open_infra_pr` 时：版本化，没有表，当前的替换旧的——`artifact.project_image` 的设计——payload 为 `{ command, urls, envExample, prUrl }`，由 `GET /projects/:projectId/infra-artifacts` 读取（如果它不合用，则用专门的 GET）。
6. **dev 暴露可以打开的东西**（RN-853），不绑定技术栈：HTTP 模块提供 `/openapi.json`（OpenAPI 3）和 `/docs`（Swagger UI）；在网络为 `none` 或没有该包时，`/docs` 是一个从 CDN 加载 `swagger-ui` 的 HTML 页面——下载它的是用户的浏览器，而不是容器。web 模块提供首页。该条款只在任务涉及入口点或路由时才加入。
7. **QA 在容器内部证明**（RN-854）：通过 README 的命令在后台启动应用，请求 `localhost:<porta interna>/openapi.json` 和 `/docs`（`curl`、`wget` 或 `node -e fetch`），并结束进程组（RN-817）。真实的 `docker compose up` 是**观察**（“只在用户的机器上证明”），绝不是计划中的一项。
8. **概览获得“Rodar na sua máquina”卡片**（RN-855）：带复制按钮的命令和可点击的 URL，配有文字“declarado pela Infra, não verificado na sua máquina”（[RN-468](../business-rules.md#rn-468)）——绝不是绿色。

## 后果 {#consequences}

- token 成本：`run` payload、README 一节以及 dev 和 QA 的条款，是在已有回合中多出的文字；没有新回合。
- 声明的缺口：真实的 `docker compose up` 从不在 Brabo 内部运行。QA 证明的是应用在容器内响应；主机端口、卷和通过 compose 的构建只在用户的机器上被证明，而界面会说明这一点。
- **不**改变的：ADR 0130 和 broker 的隔离（没有发布的端口，容器中没有 socket，`internal` 网络）、[ADR 0190](0190-a-infra-sobe-o-container-no-aceite.md) 的自动启动，以及 [ADR 0199](0199-recurso-minimo-derivado-do-module-map.md) 从 `module_map` 派生的资源。入口点能启动的证据（[RN-813](../business-rules.md#rn-813)）和 README 中的 HTTP 路由（[RN-846](../business-rules.md#rn-846)）仍然有效；本 ADR 增加的是可以打开的 URL，不替换证明。

## 考虑过的替代方案 {#alternatives-considered}

- **由 broker 发布端口**，让用户打开项目容器中的应用。按所有者的决定拒绝：这会为主机打开项目容器的第一个端口，并改变 ADR 0130 的隔离。
- **界面读取仓库的 README 或 compose** 来组装卡片。拒绝：那就是在客户端解析散文和 YAML，没有契约；经过验证的 `run` payload 和版本化的构件以固定的形式提供同样的数据。
